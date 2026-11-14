/**
 * Éditions du terrain par le joueur (Défricher, Quai / remblai, Creuser) : simulation, cohérence terrain / eau,
 * bâtiments interdits sur l'eau, obstacles, coûts, deltas pour le rendu, sauvegarde et rejeu, anciennes sauvegardes.
 *   npx tsx --test tests/terrain/editions.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../../src/sim/world';
import { generateWorld, NO_WATER, planEdit, QUAY_STRIDE, type TerrainEdit, type TerrainPatch } from '../../src/sim/terrain/index';
import { handleCommand } from '../../src/sim/handler';
import { townCatalog } from '../sim/fixtures';

function seaSim(money = 50_000_000, terrain: Record<string, unknown> = {}): Simulation {
  const s = new Simulation();
  s.setCatalog(townCatalog());
  s.newGame({ seed: 7, mapChunks: 8, startMoney: money, cityName: 'Port-Test', terrain });
  return s;
}

/** Rayon depuis le centre vers la mer : direction et distance de la première eau de mer. */
function findSea(s: Simulation): { dx: number; dz: number; dist: number } {
  const t = s.terrain!;
  let best = { dx: 1, dz: 0, dist: Infinity };
  for (let a = 0; a < 32; a++) {
    const dx = Math.cos((a / 32) * Math.PI * 2), dz = Math.sin((a / 32) * Math.PI * 2);
    for (let d = 0; d < 1000; d += 4) {
      const x = dx * d, z = dz * d;
      if (s.isWet(x, z)) {
        // Mer (et non rivière) : terrain sous le niveau de la mer sur 60 m au-delà.
        let sea = true;
        for (let e = 8; e <= 60; e += 8) if (!(s.groundHeight(x + dx * e, z + dz * e) < t.waterLevel)) sea = false;
        if (sea && d < best.dist) best = { dx, dz, dist: d };
        break;
      }
    }
  }
  assert.ok(Number.isFinite(best.dist), 'mer introuvable');
  return best;
}

/** Ligne de quai parallèle à la côte, `off` m au large de la première eau, longue de 2 * half m. */
function quayLine(sea: { dx: number; dz: number; dist: number }, off = 40, half = 60): TerrainEdit {
  const cx = sea.dx * (sea.dist + off), cz = sea.dz * (sea.dist + off);
  const tx = -sea.dz, tz = sea.dx;
  return { k: 'quay', ax: cx - tx * half, az: cz - tz * half, bx: cx + tx * half, bz: cz + tz * half };
}

const hashTerrain = (s: Simulation): string => {
  const t = s.terrain!;
  let h = 0x811c9dc5;
  for (const a of [t.heights, t.waterSurface, t.forest]) {
    const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    for (let i = 0; i < u.length; i++) { h ^= u[i]!; h = Math.imul(h, 0x01000193) >>> 0; }
  }
  return h.toString(16);
};

test('quai / remblai : l\'eau côté terre est remblayée jusqu\'à une ligne droite, mur de quai, coût', () => {
  const s = seaSim();
  const sea = findSea(s);
  const edit = quayLine(sea);
  const money0 = s.economy.money;
  const dry = s.terrainEdit({ edit, dryRun: true });
  assert.ok(dry.ok, dry.ok ? '' : dry.error.message);
  assert.ok(dry.data.cost > 0 && dry.data.volume > 0 && dry.data.wallLength > 60, JSON.stringify({ ...dry.data, outline: undefined }));
  assert.equal(s.economy.money, money0, 'dryRun sans dépense');
  const r = s.terrainEdit({ edit });
  assert.ok(r.ok);
  assert.equal(r.data.cost, dry.data.cost);
  assert.equal(Math.round(money0 - s.economy.money), r.data.cost);
  // Entre la rive et la ligne (au milieu du tracé) : terre sèche au niveau du quai ; au-delà de la ligne : eau.
  const t = s.terrain!;
  for (const d of [sea.dist + 4, sea.dist + 20, sea.dist + 30]) {
    const x = sea.dx * d, z = sea.dz * d;
    assert.ok(!s.isWet(x, z), `sec à ${d} m`);
    assert.ok(s.groundHeight(x, z) > t.waterLevel + 0.8, `quai au-dessus de l'eau à ${d} m`);
  }
  for (const d of [sea.dist + 50, sea.dist + 80]) assert.ok(s.isWet(sea.dx * d, sea.dz * d), `eau à ${d} m`);
  // Mur : un mur au moins, normale tournée vers le large.
  const q = t.quays!;
  assert.ok(q.length >= QUAY_STRIDE && q.length % QUAY_STRIDE === 0);
  assert.ok(q[6]! * sea.dx + q[7]! * sea.dz > 0.9, 'normale du mur vers la mer');
  assert.ok(q[4]! > t.waterLevel && q[5]! < t.waterLevel, 'mur du dessus du quai au pied sous l\'eau');
  // Bâtiments : interdits devant le quai (eau), autorisés sur le remblai (à distance du mur).
  const water = s.placeBuilding({ assetId: 'maison', x: sea.dx * (sea.dist + 70), z: sea.dz * (sea.dist + 70), rot: 0, dryRun: true });
  assert.ok(!water.ok && water.error.code === 'UNDER_WATER');
  // Delta : patch avec la forêt de la région et les murs.
  const d = s.takeDelta();
  const p = d.terrainPatch as TerrainPatch;
  assert.ok(p && p.forest && p.forest.length === p.heights.length && p.quays && p.quays.length === q.length);
});

test('quai : refusé sans eau, trop court, ou sur une route ; fonds insuffisants', () => {
  const s = seaSim();
  const noWater = s.terrainEdit({ edit: { k: 'quay', ax: -40, az: 0, bx: 40, bz: 0 }, dryRun: true });
  assert.ok(!noWater.ok && /Aucune eau/.test(noWater.error.message));
  const short = s.terrainEdit({ edit: { k: 'quay', ax: 0, az: 0, bx: 5, bz: 0 } });
  assert.ok(!short.ok && /court/.test(short.error.message));
  const sea = findSea(s);
  // Route qui longe la côte sur le tracé du remblai.
  const e = quayLine(sea, 40, 60) as Extract<TerrainEdit, { k: 'quay' }>;
  const back = sea.dist - 2;
  const road = s.buildRoad({ type: 'street', points: [e.ax + sea.dx * (back - sea.dist - 40), e.az + sea.dz * (back - sea.dist - 40), e.bx + sea.dx * (back - sea.dist - 40), e.bz + sea.dz * (back - sea.dist - 40)] });
  if (road.ok) {
    const hit = s.terrainEdit({ edit: e, dryRun: true });
    assert.ok(!hit.ok && hit.error.code === 'COLLISION', hit.ok ? 'accepté' : hit.error.message);
  }
  const poor = seaSim(1000);
  const p = poor.terrainEdit({ edit: quayLine(findSea(poor)), dryRun: true });
  assert.ok(!p.ok && p.error.code === 'INSUFFICIENT_FUNDS');
});

test('creuser : canal droit en eau, berges à quai, bâtiments refusés dedans, pont pour le traverser', () => {
  const s = seaSim();
  const t = s.terrain!;
  const edit: TerrainEdit = { k: 'dig', ax: -120, az: 60, bx: 120, bz: 60, w: 24 };
  const r = s.terrainEdit({ edit });
  assert.ok(r.ok, r.ok ? '' : r.error.message);
  assert.ok(r.data.volume > 0 && r.data.wallLength > 200);
  for (const x of [-100, 0, 100]) {
    assert.ok(s.isWet(x, 60), `eau dans le canal en x=${x}`);
    assert.ok(!s.isWet(x, 60 + 24), `berge sèche en x=${x}`);
  }
  const ws = t.waterSurface[Math.round((60 - t.originZ) / t.spacing) * t.samplesX + Math.round((0 - t.originX) / t.spacing)]!;
  assert.ok(ws !== NO_WATER && ws >= t.waterLevel);
  const b = s.placeBuilding({ assetId: 'maison', x: 0, z: 60, rot: 0, dryRun: true });
  assert.ok(!b.ok && b.error.code === 'UNDER_WATER');
  const road = s.buildRoad({ type: 'street', points: [0, 0, 0, 120] });
  assert.ok(road.ok, road.ok ? '' : road.error.message);
  const edge = s.roadRecords().edges.find((e) => e.bridgeRuns && e.bridgeRuns.length > 0);
  assert.ok(edge, 'la route franchit le canal par un pont');
  // Un canal ne peut plus être creusé sous la route.
  const hit = s.terrainEdit({ edit: { k: 'dig', ax: -20, az: 100, bx: 20, bz: 100, w: 20 }, dryRun: true });
  assert.ok(!hit.ok && hit.error.code === 'COLLISION');
});

test('défricher : forêt retirée du disque, petit coût, zone transmise au rendu', () => {
  const s = seaSim();
  const t = s.terrain!;
  // Point le plus boisé de la carte.
  let best = 0, bk = 0;
  for (let k = 0; k < t.forest.length; k++) if (t.forest[k]! > best) { best = t.forest[k]!; bk = k; }
  assert.ok(best > 100);
  const x = t.originX + (bk % t.samplesX) * t.spacing, z = t.originZ + Math.floor(bk / t.samplesX) * t.spacing;
  const r = s.terrainEdit({ edit: { k: 'clear', x, z, r: 40 } });
  assert.ok(r.ok);
  assert.ok(r.data.cost >= 20 && r.data.cost < 5000, `coût ${r.data.cost}`);
  assert.equal(r.data.volume, 0);
  for (let k = 0; k < t.forest.length; k++) {
    const kx = t.originX + (k % t.samplesX) * t.spacing, kz = t.originZ + Math.floor(k / t.samplesX) * t.spacing;
    if (Math.hypot(kx - x, kz - z) <= 40) assert.equal(t.forest[k], 0);
  }
  const p = s.takeDelta().terrainPatch as TerrainPatch;
  assert.deepEqual(p.cleared, [Math.round(x * 100) / 100, Math.round(z * 100) / 100, 40]);
  // Rayon borné.
  assert.ok(s.terrainEdit({ edit: { k: 'clear', x, z, r: 5000 }, dryRun: true }).ok);
});

test('combler / dévier une rivière : une ligne en travers remblaie le cours d\'un côté', () => {
  const s = seaSim();
  const t = s.terrain!;
  const river = t.rivers[0]!;
  const n = river.points.length / 4;
  const m = Math.floor(n * 0.5);
  const px = river.points[m * 4]!, pz = river.points[m * 4 + 2]!;
  const dx = river.points[(m + 1) * 4]! - river.points[(m - 1) * 4]!, dz = river.points[(m + 1) * 4 + 2]! - river.points[(m - 1) * 4 + 2]!;
  const l = Math.hypot(dx, dz);
  const nx = -dz / l, nz = dx / l;
  assert.ok(s.isWet(px, pz), 'rivière au point choisi');
  const r = s.terrainEdit({ edit: { k: 'quay', ax: px - nx * 40, az: pz - nz * 40, bx: px + nx * 40, bz: pz + nz * 40 } });
  assert.ok(r.ok, r.ok ? '' : r.error.message);
  // Un côté du tracé est remblayé (sec), l'autre reste en eau.
  const a = s.isWet(px + (dx / l) * 24, pz + (dz / l) * 24), b = s.isWet(px - (dx / l) * 24, pz - (dz / l) * 24);
  assert.ok(a !== b, `un côté comblé (${a} / ${b})`);
});

test('sauvegarde : éditions rejouées au chargement (terrain, eau, forêt et murs identiques) ; argent conservé', () => {
  const s = seaSim();
  const sea = findSea(s);
  assert.ok(s.terrainEdit({ edit: quayLine(sea) }).ok);
  assert.ok(s.terrainEdit({ edit: { k: 'dig', ax: -100, az: -80, bx: 60, bz: -80, w: 20 } }).ok);
  assert.ok(s.terrainEdit({ edit: { k: 'clear', x: 300, z: 300, r: 60 } }).ok);
  const road = s.buildRoad({ type: 'street', points: [-60, -140, -60, -20] });
  assert.ok(road.ok, road.ok ? '' : road.error.message);
  const h0 = hashTerrain(s);
  const quays = s.terrain!.quays!.slice();
  const save = JSON.parse(JSON.stringify(s.toSave()));
  assert.equal(save.terrainEdits.length, 3);
  assert.equal(save.params.terrain.genVersion, 2);
  const s2 = new Simulation();
  s2.setCatalog(townCatalog());
  assert.equal(s2.fromSave(save), null);
  assert.equal(hashTerrain(s2), h0);
  assert.deepEqual(s2.terrain!.quays, quays);
  assert.equal(s2.terrainEditList.length, 3);
  assert.equal(Math.round(s2.economy.money), Math.round(s.economy.money));
  // Instantané : les murs de quai partent avec le terrain.
  assert.deepEqual((s2.snapshot().terrain as { quays?: number[] }).quays, quays);
  // Éditions mal formées : refus explicite, partie précédente conservée.
  const bad = { ...save, terrainEdits: [{ k: 'quay', ax: 'x' }] };
  assert.equal(s2.fromSave(bad)?.code, 'BAD_SAVE');
  assert.equal(hashTerrain(s2), h0);
});

test('ancienne sauvegarde (sans version de génération) : terrain d\'origine (v1) régénéré à l\'identique', () => {
  const s = seaSim();
  const save = JSON.parse(JSON.stringify(s.toSave()));
  delete save.params.terrain; // sauvegarde d'avant la v2 : pas de paramètres de carte enregistrés
  const s2 = new Simulation();
  s2.setCatalog(townCatalog());
  assert.equal(s2.fromSave(save), null);
  const v1 = generateWorld({ seed: 7, mapChunks: 8, genVersion: 1, samplesPerTile: 1 });
  assert.deepEqual(s2.terrain!.heights, v1.heights);
  assert.deepEqual(s2.terrain!.forest, v1.forest);
  assert.equal(s2.terrain!.rivers.length, v1.rivers.length);
  // Et elle se ré-enregistre en v1 (pas de bascule silencieuse du terrain au prochain chargement).
  assert.equal(s2.toSave().params.terrain?.genVersion, 1);
});

test('commande étendue terrainEdit via le répartiteur : validation des arguments', () => {
  const s = seaSim();
  const cmd = (args: unknown): ReturnType<typeof handleCommand> => handleCommand(s, { kind: 'cmd', reqId: 1, name: 'terrainEdit', args });
  const bad = cmd({ edit: { k: 'volcan' } });
  assert.equal((bad.result as { ok: boolean }).ok, false);
  const bad2 = cmd({ edit: { k: 'clear', x: 0, z: Number.NaN, r: 10 } });
  assert.equal((bad2.result as { ok: boolean }).ok, false);
  const ok = cmd({ edit: { k: 'clear', x: 0, z: 0, r: 30 }, dryRun: true });
  assert.equal((ok.result as { ok: boolean }).ok, true);
  assert.equal(ok.snapshot, false);
});

test('plan pur : planEdit ne modifie rien', () => {
  const t = generateWorld({ seed: 7, mapChunks: 4 });
  const h = new Float32Array(t.heights), ws = new Float32Array(t.waterSurface), f = new Uint8Array(t.forest);
  planEdit(t, { k: 'dig', ax: -50, az: 0, bx: 50, bz: 0, w: 30 });
  planEdit(t, { k: 'clear', x: 0, z: 0, r: 50 });
  assert.deepEqual(t.heights, h);
  assert.deepEqual(t.waterSurface, ws);
  assert.deepEqual(t.forest, f);
});
