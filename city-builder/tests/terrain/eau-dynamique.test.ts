/**
 * Terraformation façon CS2 et eau dynamique (src/sim/terrain/edits.ts, src/sim/hydro) : pinceaux (forme, force,
 * Adoucir, Pente, hauteur cible), annulation, remplissage par niveaux (solveur pur), sources, barrages (retenue
 * jusqu'à la crête, chute), creux reliés à une rivière, sauvegarde et rejeu, production hydroélectrique.
 *   npx tsx --test tests/terrain/eau-dynamique.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../../src/sim/world';
import { HydroSolver, type HydroGrid } from '../../src/sim/hydro/fill';
import { NO_WATER, planEdit, type TerrainEdit } from '../../src/sim/terrain/index';
import { brushWeight } from '../../src/sim/terrain/edits';
import { validateCommandMessage } from '../../src/shared/protocol';
import { EDIT_COSTS } from '../../src/sim/terrain/edits';
import { hydroDamKw, hydroShare, HYDRO_MAX_FACTOR } from '../../src/shared/power/model';
import { townCatalog } from '../sim/fixtures';
import { powerTown } from '../electricite/fixtures';

type Priv = { naturalHeights: Float32Array };

function sim(money = 500_000_000): Simulation {
  const s = new Simulation();
  s.setCatalog(townCatalog());
  s.newGame({ seed: 7, mapChunks: 8, startMoney: money, cityName: 'Eau-Test' });
  return s;
}

const idx = (s: Simulation, x: number, z: number): number => {
  const t = s.terrain!;
  return Math.round((z - t.originZ) / t.spacing) * t.samplesX + Math.round((x - t.originX) / t.spacing);
};
const nat = (s: Simulation, x: number, z: number): number => (s as unknown as Priv).naturalHeights[idx(s, x, z)]!;
const ws = (s: Simulation, x: number, z: number): number => s.terrain!.waterSurface[idx(s, x, z)]!;

/**
 * Vallée synthétique (préparation du test : relief écrit directement) : fond descendant vers +x, versants à 50 %,
 * mur amont ; zone sèche. Région x ∈ [cx-200, cx+200], z ∈ [cz-150, cz+150].
 */
function carveValley(s: Simulation, cx: number, cz: number, floor0 = 40): void {
  const t = s.terrain!;
  const N = (s as unknown as Priv).naturalHeights;
  for (let j = 0; j < t.samplesZ; j++) for (let i = 0; i < t.samplesX; i++) {
    const x = t.originX + i * t.spacing, z = t.originZ + j * t.spacing;
    if (Math.abs(x - cx) > 200 || Math.abs(z - cz) > 150) continue;
    const k = j * t.samplesX + i;
    let h = floor0 + (cx + 200 - x) * 0.03 + 0.5 * Math.abs(z - cz);
    if (x < cx - 180) h += (cx - 180 - x) * 3;
    N[k] = h; t.heights[k] = h; t.waterSurface[k] = NO_WATER;
  }
}

/** Avance le temps (pas de 10 min) jusqu'à ce que l'eau soit en régime établi (ou `maxH` heures). */
function untilSteady(s: Simulation, maxH = 72): number {
  for (let i = 0; i < maxH * 6; i++) {
    s.tick(10);
    if (s.hydro.steady && !s.hydro.dirty) return (i + 1) * 10;
  }
  return -1;
}

test('pinceaux : forme douce identique à l\'origine, forme dure plus large, force, Adoucir, hauteur cible', () => {
  // Cloche d'origine (0,5 + 0,5 cos πu) conservée pour les éditions sans `s`.
  for (const u of [0, 0.3, 0.6, 0.99]) assert.ok(Math.abs(brushWeight(u, 0) - (0.5 + 0.5 * Math.cos(Math.PI * u))) < 1e-12);
  assert.equal(brushWeight(0.7, 0.75), 1, 'forme dure : plein effet jusqu\'à 75 %');
  const s = sim();
  const ed = { ...s.terrain!, heights: (s as unknown as Priv).naturalHeights, waterSurface: s.terrain!.waterSurface, forest: s.terrain!.forest };
  const soft = planEdit(ed, { k: 'raise', x: -450, z: 150, r: 40, d: 4 });
  const hard = planEdit(ed, { k: 'raise', x: -450, z: 150, r: 40, d: 4, s: 1 });
  assert.ok(soft.ok && hard.ok);
  if (soft.ok && hard.ok) assert.ok(hard.plan.volume > soft.plan.volume * 1.4, `volume dur ${hard.plan.volume} > doux ${soft.plan.volume}`);
  // Niveler à une hauteur cible choisie, à 50 % de force : à mi-chemin au centre.
  const h0 = nat(s, -450, 150);
  const r = s.terrainEdit({ edit: { k: 'flatten', x: -450, z: 150, r: 30, h: h0 + 6, f: 0.5 } });
  assert.ok(r.ok, r.ok ? '' : r.error.message);
  assert.ok(Math.abs(nat(s, -450, 150) - (h0 + 3)) < 0.05, 'mi-chemin vers la cible');
  // Adoucir : une marche s'atténue.
  assert.ok(s.terrainEdit({ edit: { k: 'raise', x: -450, z: -150, r: 12, d: 8, s: 1 } }).ok);
  const peak = nat(s, -450, -150) - nat(s, -426, -150);
  assert.ok(s.terrainEdit({ edit: { k: 'smooth', x: -450, z: -150, r: 40 } }).ok);
  assert.ok(nat(s, -450, -150) - nat(s, -426, -150) < peak * 0.8, 'bosse adoucie');
});

test('pente : rampe régulière entre les hauteurs des deux extrémités (fixées à la pose)', () => {
  const s = sim();
  const ha = nat(s, -600, -300), hb = nat(s, -400, -300);
  const r = s.terrainEdit({ edit: { k: 'slope', ax: -600, az: -300, bx: -400, bz: -300, w: 40 } });
  assert.ok(r.ok, r.ok ? '' : r.error.message);
  if (!r.ok) return;
  assert.equal(r.data.ah, Math.round(ha * 100) / 100);
  const mid = nat(s, -500, -300);
  assert.ok(Math.abs(mid - (ha + hb) / 2) < 0.2, `milieu ${mid} ≈ ${(ha + hb) / 2}`);
  assert.ok(!s.terrainEdit({ edit: { k: 'slope', ax: -600, az: -300, bx: -595, bz: -300, w: 40 } }).ok, 'trop courte');
});

test('annulation : un geste de plusieurs passes est annulé d\'un coup (relief, coût remboursé) ; refus sous un bâtiment construit depuis', () => {
  const s = sim();
  const N = (s as unknown as Priv).naturalHeights;
  const before = new Float32Array(N);
  const money = s.economy.money;
  const a = s.terrainEdit({ edit: { k: 'raise', x: -450, z: 0, r: 30, d: 2 } });
  const b = s.terrainEdit({ edit: { k: 'raise', x: -430, z: 0, r: 30, d: 2 } });
  assert.ok(a.ok && b.ok);
  if (!a.ok || !b.ok) return;
  assert.equal(a.data.seq, 0);
  assert.equal(b.data.seq, 1);
  assert.ok(s.economy.money <= money, 'terrassement gratuit');
  const u = s.runExt('terrainUndo', { since: 0 });
  assert.ok(u.ok, u.ok ? '' : u.error.message);
  assert.deepEqual(Array.from(N), Array.from(before));
  assert.ok(Math.abs(s.economy.money - money) < 1e-6, 'coût remboursé');
  assert.equal(s.terrainEditList.length, 0);
  // Bâtiment posé sur la zone : l'annulation est refusée clairement.
  assert.ok(s.terrainEdit({ edit: { k: 'flatten', x: -450, z: 0, r: 40, h: nat(s, -450, 0) + 2 } }).ok);
  const pb = s.placeBuilding({ assetId: s.catalog!.assets.find((x) => x.category === 'house')!.id, x: -450, z: 0, rot: 0 });
  assert.ok(pb.ok, pb.ok ? '' : pb.error.message);
  const u2 = s.runExt('terrainUndo', { since: 0 });
  assert.ok(!u2.ok && /bâtiment/.test(u2.error.message));
});

test('solveur : une source remplit la cuvette jusqu\'au col puis s\'écoule ; volume partiel = niveau intermédiaire', () => {
  // Grille 20 × 20 : cuvette centrale (fond 0) bordée à 10 m, col à 4 m côté +x, pente vers le bord.
  const W = 20, H = 20, n = W * H;
  const ground = new Float32Array(n), base = new Float32Array(n).fill(NO_WATER);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const inside = i >= 5 && i <= 10 && j >= 5 && j <= 10;
    ground[j * W + i] = inside ? 0 : 10;
  }
  // Col (une case à 4 m) puis ruisseau descendant vers le bord droit.
  ground[7 * W + 11] = 4;
  for (let i = 12; i < W; i++) ground[7 * W + i] = 3 - (i - 12) * 0.3;
  const g: HydroGrid = { samplesX: W, samplesZ: H, spacing: 8, ground, base, barrier: null, dug: null, dugMask: null };
  const sol = new HydroSolver();
  const area = 36 * 64; // 6 × 6 cases de 8 m
  const half = sol.solve(g, [{ cell: 7 * W + 7, volume: area * 2, tag: 0 }]);
  assert.equal(half[0]!.status, 'partial');
  assert.ok(Math.abs(sol.water[7 * W + 7]! - 2) < 1e-4, 'niveau 2 m pour un volume de 2 m × surface');
  const full = sol.solve(g, [{ cell: 7 * W + 7, volume: Infinity, tag: 0 }]);
  assert.equal(full[0]!.status, 'sink');
  assert.equal(full[0]!.outlet, 'bord');
  assert.ok(Math.abs(sol.water[7 * W + 7]! - 4) < 1e-4, 'niveau du col (4 m)');
  assert.ok(sol.water[7 * W + 15]! > ground[7 * W + 15]!, 'ruisseau de débordement en aval');
  // Barrière (bâtiment) : jamais mouillée.
  const bar = new Uint8Array(n); bar[6 * W + 6] = 1;
  sol.solve({ ...g, barrier: bar }, [{ cell: 7 * W + 7, volume: Infinity, tag: 0 }]);
  assert.equal(sol.water[6 * W + 6], NO_WATER);
  // Déterminisme : deux calculs identiques.
  const a = Array.from(sol.solve(g, [{ cell: 7 * W + 7, volume: area * 3.3, tag: 0 }]).map((r) => r.level));
  const b = Array.from(sol.solve(g, [{ cell: 7 * W + 7, volume: area * 3.3, tag: 0 }]).map((r) => r.level));
  assert.deepEqual(a, b);
});

test('barrage en travers d\'une vallée + source : la retenue monte jusqu\'à la crête, chute mesurée, production selon la chute', () => {
  const s = sim();
  const cx = 500, cz = -500;
  carveValley(s, cx, cz);
  // Barrage refusé : trop court, puis vallée trop peu profonde (extrémités dans le fond).
  assert.ok(!s.terrainEdit({ edit: { k: 'dam', ax: cx, az: cz - 5, bx: cx, bz: cz + 5 } }).ok);
  const shallow = s.terrainEdit({ edit: { k: 'dam', ax: cx, az: cz - 3, bx: cx, bz: cz + 30, dryRun: true } as TerrainEdit });
  assert.ok(!shallow.ok || (shallow.data.crest ?? 0) > 0);
  // Barrage de 15 m au-dessus du fond, en travers (axe nord-sud), source en amont.
  const dam: TerrainEdit = { k: 'dam', ax: cx, az: cz - 90, bx: cx, bz: cz + 90, hh: 15 };
  const dry = s.terrainEdit({ edit: dam, dryRun: true });
  assert.ok(dry.ok, dry.ok ? '' : dry.error.message);
  if (!dry.ok) return;
  let floor = Infinity;
  for (let z = cz - 90; z <= cz + 90; z += 2) floor = Math.min(floor, nat(s, cx, z));
  assert.ok(Math.abs(dry.data.crest! - (floor + 15)) < 0.5, `crête ${dry.data.crest} ≈ fond ${floor} + 15`);
  assert.equal(dry.data.water?.flowM3s, 0, 'vallée sèche : aucun débit avant la source');
  const d = s.terrainEdit({ edit: dam });
  assert.ok(d.ok, d.ok ? '' : d.error.message);
  assert.ok(nat(s, cx, cz) >= dry.data.crest! - 0.01, 'axe relevé jusqu\'à la crête');
  assert.ok((s.terrain!.quays?.length ?? 0) >= 16, 'deux parements');
  const src: TerrainEdit = { k: 'source', x: cx - 120, z: cz, q: 60 };
  const pv = s.terrainEdit({ edit: src, dryRun: true });
  assert.ok(pv.ok && pv.data.water, 'aperçu du lac');
  assert.ok(s.terrainEdit({ edit: src }).ok);
  // Remplissage progressif : le niveau monte avec le temps.
  s.tick(10);
  const early = ws(s, cx - 20, cz);
  const mins = untilSteady(s, 200);
  assert.ok(mins > 0, 'régime établi atteint');
  const lvl = ws(s, cx - 20, cz);
  assert.ok(early === NO_WATER || early < lvl, `le niveau monte (${early} → ${lvl})`);
  assert.ok(Math.abs(lvl - dry.data.crest!) < 0.3, `retenue au niveau de la crête (${lvl} ≈ ${dry.data.crest})`);
  const m = s.hydro.service.damNear(cx, cz, 30)!;
  assert.ok(m && m.full, 'retenue pleine');
  assert.equal(m.flowM3s, 60);
  assert.ok(m.headM > 10, `chute ${m.headM} m`);
  // Production : proportionnelle à la chute et au débit, plafonnée.
  assert.equal(hydroDamKw(30_000, 0, 60, 'printemps'), 0);
  assert.ok(Math.abs(hydroDamKw(30_000, 10, 60, 'printemps') - 30_000) < 1e-6);
  assert.ok(Math.abs(hydroDamKw(30_000, 20, 60, 'ete') - 60_000 * hydroShare('ete')) < 1e-6);
  assert.equal(hydroDamKw(30_000, 200, 200, 'printemps'), 30_000 * HYDRO_MAX_FACTOR);
  assert.ok(hydroDamKw(30_000, m.headM, m.flowM3s, 'printemps') > hydroDamKw(30_000, m.headM / 2, m.flowM3s, 'printemps'));
  // Aval : de l'eau déborde par-dessus la crête (ruisseau).
  let downstream = false;
  for (let x = cx + 16; x < cx + 190; x += 8) for (const z of [cz - 8, cz, cz + 8]) if (ws(s, x, z) > nat(s, x, z)) downstream = true;
  assert.ok(downstream, 'débordement en aval');
  // Bâtiment interdit dans la retenue ; une route tracée au sol passe automatiquement en pont au-dessus de l'eau.
  assert.ok(s.isWet(cx - 30, cz));
  const road = s.buildRoad({ type: 'street', points: [cx - 30, cz - 100, cx - 30, cz + 100] });
  assert.ok(road.ok, road.ok ? '' : road.error.message);
  const rec = s.roadRecords().edges.find((e) => road.ok && e.id === road.data.edgeIds[0]);
  assert.ok(rec && (rec.bridgeRuns?.length ?? 0) > 0, 'la route franchit la retenue en pont');
  // Ouvrage choisi par le joueur : viaduc (plus haut, plus cher) et tunnel sous le lac (simulation à blanc).
  const pont = s.buildRoad({ type: 'street', points: [cx - 50, cz - 100, cx - 50, cz + 100], dryRun: true });
  const viaduc = s.buildRoad({ type: 'street', points: [cx - 50, cz - 100, cx - 50, cz + 100], dryRun: true, waterCrossing: 'viaduc' });
  const tunnel = s.buildRoad({ type: 'street', points: [cx - 50, cz - 100, cx - 50, cz + 100], dryRun: true, waterCrossing: 'tunnel' });
  assert.ok(pont.ok && viaduc.ok && tunnel.ok, [pont, viaduc, tunnel].map((r) => (r.ok ? 'ok' : r.error.message)).join(' | '));
  assert.ok(pont.ok && viaduc.ok && viaduc.data.cost >= pont.data.cost, 'le viaduc coûte au moins autant que le pont');
});

test('sauvegarde : sources, barrage et retenue identiques après rechargement ; ancienne partie inchangée', () => {
  const s = sim();
  const cx = 500, cz = -500;
  carveValley(s, cx, cz);
  // Le relief écrit à la main n'est pas une édition : on le reproduit par des éditions (rejouables) avant la sauvegarde.
  // Ici : la vallée est déjà dans le terrain naturel ; la sauvegarde ne la contient pas. On compare donc deux
  // simulations construites de la même façon (vallée + éditions), l'une rechargée depuis la sauvegarde de l'autre
  // avec la même vallée réécrite avant le rejeu.
  assert.ok(s.terrainEdit({ edit: { k: 'dam', ax: cx, az: cz - 90, bx: cx, bz: cz + 90, hh: 12 } }).ok);
  assert.ok(s.terrainEdit({ edit: { k: 'source', x: cx - 120, z: cz, q: 40 } }).ok);
  for (let i = 0; i < 30; i++) s.tick(10);
  const save = JSON.parse(JSON.stringify(s.toSave()));
  assert.equal(save.hydro.spreadFrom, 0);
  assert.equal(save.terrainEdits.length, 2);
  assert.equal(save.terrainEdits[1].k, 'source');
  assert.ok(typeof save.terrainEdits[1].t === 'number');
  // Rechargement : la vallée synthétique est réécrite juste après la régénération (crochet du test), puis rejeu.
  const s2 = new Simulation();
  s2.setCatalog(townCatalog());
  const orig = (s2 as unknown as { replayEdit(e: TerrainEdit): void }).replayEdit.bind(s2);
  let carved = false;
  (s2 as unknown as { replayEdit(e: TerrainEdit): void }).replayEdit = (e) => { if (!carved) { carveValley(s2, cx, cz); carved = true; } orig(e); };
  assert.equal(s2.fromSave(save), null);
  const a = s.terrain!.waterSurface, b = s2.terrain!.waterSurface;
  let diff = 0;
  for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) diff++;
  assert.equal(diff, 0, 'même surface d\'eau (retenue en cours de remplissage)');
  assert.deepEqual(s2.hydro.damMetrics(), s.hydro.damMetrics());
  // Ancienne partie (sans éditions d'eau) : aucun champ `hydro`, module inactif.
  const s3 = sim();
  assert.ok(s3.terrainEdit({ edit: { k: 'clear', x: 300, z: 300, r: 40 } }).ok);
  const old = JSON.parse(JSON.stringify(s3.toSave()));
  delete old.hydro;
  const s4 = new Simulation();
  s4.setCatalog(townCatalog());
  assert.equal(s4.fromSave(old), null);
  assert.equal(s4.hydro.active, false);
  assert.deepEqual(Array.from(s4.terrain!.waterSurface), Array.from(s3.terrain!.waterSurface));
});

test('creux creusé au bord d\'une rivière : l\'eau le remplit jusqu\'à son niveau ; retirer une source', () => {
  const s = sim();
  const t = s.terrain!;
  // Rive d'une rivière (eau au-dessus de la mer) : premier échantillon sec voisin d'une case de rivière.
  let bank: { x: number; z: number; lv: number } | null = null;
  const W = t.samplesX;
  for (let k = W; k < t.heights.length - W && !bank; k++) {
    const w = t.waterSurface[k]!;
    if (!(w > t.waterLevel + 1 && w > t.heights[k]! + 0.3)) continue;
    for (const nb of [k - 1, k + 1, k - W, k + W]) {
      if (t.waterSurface[nb]! === NO_WATER && t.heights[nb]! > w + 0.5 && t.heights[nb]! < w + 3) {
        bank = { x: t.originX + (nb % W) * t.spacing, z: t.originZ + ((nb / W) | 0) * t.spacing, lv: w };
        break;
      }
    }
  }
  assert.ok(bank, 'rive trouvée');
  if (!bank) return;
  assert.ok(!s.isWet(bank.x, bank.z));
  const r = s.terrainEdit({ edit: { k: 'lower', x: bank.x, z: bank.z, r: 12, d: 6, s: 1 } });
  assert.ok(r.ok, r.ok ? '' : r.error.message);
  assert.ok(s.hydro.active);
  assert.ok(ws(s, bank.x, bank.z) > nat(s, bank.x, bank.z) + 0.05, 'le creux est en eau');
  assert.ok(Math.abs(ws(s, bank.x, bank.z) - bank.lv) < 0.6, 'au niveau de la rivière voisine');
  // Source posée puis retirée (l'eau qu'elle donnait disparaît).
  const sx = -450, sz = 300;
  assert.ok(s.terrainEdit({ edit: { k: 'source', x: sx, z: sz, q: 20 } }).ok);
  assert.equal(s.hydro.sources.length, 1);
  assert.ok(!s.terrainEdit({ edit: { k: 'unsource', x: sx + 200, z: sz } }).ok, 'aucune source ici');
  assert.ok(s.terrainEdit({ edit: { k: 'unsource', x: sx + 5, z: sz } }).ok);
  assert.equal(s.hydro.sources.length, 0);
});

test('centrale hydroélectrique au pied d\'un barrage : site validé par la retenue, production selon la chute et le débit', () => {
  const { sim: s, elec } = powerTown();
  const cx = 250, cz = 330;
  carveValley(s, cx, cz, 45);
  assert.ok(s.terrainEdit({ edit: { k: 'dam', ax: cx, az: cz - 90, bx: cx, bz: cz + 90, hh: 14 } }).ok);
  assert.ok(s.terrainEdit({ edit: { k: 'source', x: cx - 120, z: cz, q: 60 } }).ok);
  assert.ok(untilSteady(s, 200) > 0);
  const m = s.hydro.service.damNear(cx, cz, 30)!;
  assert.ok(m.headM > 8, `chute ${m.headM}`);
  // Centrale (4 × 4) au pied du barrage, côté aval, sur le versant.
  const ctx = (s as unknown as { plugins: { contextOf(id: string): unknown } }).plugins.contextOf('electricite')!;
  const sys = (elec as unknown as { systemOf?(c: unknown): unknown }).systemOf?.(ctx) ?? (elec as unknown as { system: unknown }).system;
  const scan = (sys as { scanFacilities(c: unknown): Map<number, { kind: string; siteOk: boolean; siteReason: string; damId?: number }> });
  // Plateforme nivelée sur le versant aval (pinceau Niveler, forme dure), puis la centrale.
  const pad = { x: cx + 44, z: cz + 44 };
  const fl = s.terrainEdit({ edit: { k: 'flatten', x: pad.x, z: pad.z, r: 34, s: 1 } });
  assert.ok(fl.ok, fl.ok ? '' : fl.error.message);
  const pr = s.placeBuilding({ assetId: 'barrage', x: pad.x, z: pad.z, rot: 0 });
  assert.ok(pr.ok, pr.ok ? '' : pr.error.message);
  const f = [...scan.scanFacilities(ctx).values()].find((o) => o.kind === 'hydro')!;
  assert.ok(f.siteOk && f.damId !== undefined, f.siteReason);
  assert.match(f.siteReason, /chute/);
  const kw = (sys as { availableKw(c: unknown, f: unknown, w: number, sun: number): number }).availableKw(ctx, f, 0, 0);
  const season = (ctx as { clock: { season: string } }).clock.season;
  assert.ok(Math.abs(kw - hydroDamKw(30_000 * 0 + (f as unknown as { nominalKw: number }).nominalKw, m.headM, m.flowM3s, season)) < 1, `production ${kw} kW`);
  assert.ok(kw > 0);
});

test('barrage en travers d\'une rivière de la carte : la rivière remplit la retenue jusqu\'à la crête ; aval inchangé', () => {
  const s = sim();
  const t = s.terrain!;
  const r = t.rivers[0]!;
  const P = r.points;
  const v = 18;
  const x = P[v * 4]!, z = P[v * 4 + 2]!;
  const dx = P[(v + 1) * 4]! - x, dz = P[(v + 1) * 4 + 2]! - z, L = Math.hypot(dx, dz);
  const nx = -dz / L, nz = dx / L;
  // Préparation : versants hauts (40 m) autour du cours amont, lit de la rivière intact.
  const N = (s as unknown as Priv).naturalHeights;
  for (let k = 0; k < N.length; k++) {
    const px = t.originX + (k % t.samplesX) * t.spacing, pz = t.originZ + Math.floor(k / t.samplesX) * t.spacing;
    if (px < x - 160 || px > x + 160 || pz < z - 230 || pz > z + 20) continue;
    if (t.waterSurface[k]! > N[k]! + 0.05) continue;
    N[k] = Math.max(N[k]!, 40); t.heights[k] = N[k]!;
  }
  // Aval (pour vérifier qu'il ne change pas) : surface de la rivière 100 m plus loin.
  const downK = idx(s, P[(v + 12) * 4]!, P[(v + 12) * 4 + 2]!);
  const downBefore = t.waterSurface[downK]!;
  const dam: TerrainEdit = { k: 'dam', ax: x - nx * 30, az: z - nz * 30, bx: x + nx * 30, bz: z + nz * 30, hh: 6 };
  const d = s.terrainEdit({ edit: dam });
  assert.ok(d.ok, d.ok ? '' : d.error.message);
  if (!d.ok) return;
  assert.ok((d.data.flow ?? 0) > 0, `débit de la rivière barrée ${d.data.flow} m³/s`);
  assert.ok(untilSteady(s, 400) > 0, 'retenue pleine');
  const m = s.hydro.service.damNear(x, z, 30)!;
  assert.ok(Math.abs(m.level - d.data.crest!) < 0.3, `retenue ${m.level} ≈ crête ${d.data.crest}`);
  assert.ok(m.headM > 3, `chute ${m.headM} m`);
  assert.equal(t.waterSurface[downK], downBefore, 'rivière aval inchangée');
});

test('ouvrage « Digue » : la route passe sur un remblai qui coupe la retenue ; coût selon le volume ; sauvegarde identique', () => {
  // Validation du protocole : 'digue' accepté, valeur inconnue refusée.
  const msg = (waterCrossing: unknown): unknown => ({ kind: 'cmd', reqId: 1, name: 'buildRoad', args: { type: 'street', points: [0, 0, 50, 0], waterCrossing } });
  assert.equal(validateCommandMessage(msg('digue')), null);
  assert.equal(validateCommandMessage(msg('barrage'))?.code, 'INVALID_ARGS');

  const s = sim();
  const cx = 500, cz = -500;
  carveValley(s, cx, cz);
  assert.ok(s.terrainEdit({ edit: { k: 'dam', ax: cx, az: cz - 90, bx: cx, bz: cz + 90, hh: 15 } }).ok);
  assert.ok(s.terrainEdit({ edit: { k: 'source', x: cx - 120, z: cz, q: 60 } }).ok);
  assert.ok(untilSteady(s, 200) > 0, 'retenue pleine');
  const xr = cx - 50;
  const level = ws(s, xr, cz);
  assert.ok(level !== NO_WATER && level - nat(s, xr, cz) > 5, 'retenue profonde sous le tracé');
  assert.ok(ws(s, cx - 20, cz) > nat(s, cx - 20, cz), 'eau entre le tracé et le barrage');
  // Une digue ne se pose pas avec l'outil Terrain (seulement par l'ouvrage « Digue » de l'outil Routes).
  assert.ok(!s.terrainEdit({ edit: { k: 'levee', pts: [xr, cz - 50, xr, cz + 50], w: 16, h: level + 1, ah: level, bh: level, g: 0.05 } }).ok);

  // Extrémités sur les rives, un peu au-dessus de l'eau (versants à 50 %).
  const pts = [xr, cz - 44, xr, cz + 44];
  const pont = s.buildRoad({ type: 'street', points: pts, dryRun: true });
  const natBefore = nat(s, xr, cz);
  const dry = s.buildRoad({ type: 'street', points: pts, dryRun: true, waterCrossing: 'digue' });
  assert.ok(pont.ok && dry.ok, [pont, dry].map((r) => (r.ok ? 'ok' : r.error.message)).join(' | '));
  if (!pont.ok || !dry.ok) return;
  assert.ok(dry.data.path && dry.data.path.length > 0, 'aperçu 3D du tracé sur la digue');
  assert.equal(nat(s, xr, cz), natBefore, 'la validation à blanc ne modifie pas le relief');
  const editsBefore = s.terrainEditList.length;
  const money0 = s.economy.money;
  const built = s.buildRoad({ type: 'street', points: pts, waterCrossing: 'digue' });
  assert.ok(built.ok, built.ok ? '' : built.error.message);
  if (!built.ok) return;
  assert.equal(built.data.cost, dry.data.cost, 'coût construit = coût annoncé');
  assert.ok(Math.abs(money0 - s.economy.money - built.data.cost) < 1, 'coût débité');
  // Remblai : édition 'levee' enregistrée, crête au-dessus de l'eau, terrain relevé sous la route.
  assert.equal(s.terrainEditList.length, editsBefore + 1);
  const lv = s.terrainEditList[editsBefore]!;
  assert.equal(lv.k, 'levee');
  if (lv.k !== 'levee') return;
  assert.ok(lv.h >= level + 1.4, `crête ${lv.h} au-dessus de l'eau ${level}`);
  assert.ok(nat(s, xr, cz) >= level + 1, 'terrain relevé sous la route jusqu\'à son niveau');
  const rec = s.roadRecords().edges.find((e) => e.id === built.data.edgeIds[0]);
  assert.ok(rec && rec.profile, 'profil en long');
  if (!rec?.profile) return;
  const mid = rec.profile[Math.floor(rec.profile.length / 2)]!;
  assert.ok(Math.abs(mid - lv.h) < 1.5, `chaussée au niveau de la digue (${mid} ≈ ${lv.h})`);
  const runs = rec.bridgeRuns ?? [];
  for (let q = 0; q + 1 < runs.length; q += 2) assert.ok(!(runs[q]! <= rec.length / 2 && runs[q + 1]! > rec.length / 2), 'pas de pont au milieu : la route est au sol sur la digue');
  for (let i = 0; i < 12; i++) s.tick(10);
  // L'eau dynamique se recalcule : la retenue est coupée (plus d'eau sous la route) ; les buses relient les deux
  // côtés : même niveau de part et d'autre, pas de lac perché derrière la route.
  assert.ok((lv.lk?.length ?? 0) >= 4, 'buses posées sous la digue');
  for (const dz of [-24, -8, 0, 8, 24]) assert.ok(!(ws(s, xr, cz + dz) > nat(s, xr, cz + dz)), `pas d'eau sur la digue (dz ${dz})`);
  const up = ws(s, cx - 100, cz), down = ws(s, cx - 20, cz);
  assert.ok(up > nat(s, cx - 100, cz) && down > nat(s, cx - 20, cz), 'eau des deux côtés de la digue');
  assert.ok(Math.abs(up - down) < 0.05 && Math.abs(up - level) < 0.5, `même niveau de part et d'autre (${up} / ${down}, avant ${level})`);
  assert.ok(lv.h > up, 'la crête de la digue reste au-dessus de l\'eau');

  // Sauvegarde : la digue est rejouée avant les routes, relief et eau identiques après rechargement.
  const save = JSON.parse(JSON.stringify(s.toSave()));
  assert.equal(save.terrainEdits[editsBefore].k, 'levee');
  const s2 = new Simulation();
  s2.setCatalog(townCatalog());
  const orig = (s2 as unknown as { replayEdit(e: TerrainEdit): void }).replayEdit.bind(s2);
  let carved = false;
  (s2 as unknown as { replayEdit(e: TerrainEdit): void }).replayEdit = (e) => { if (!carved) { carveValley(s2, cx, cz); carved = true; } orig(e); };
  assert.equal(s2.fromSave(save), null);
  let dh = 0, dw = 0;
  for (let k = 0; k < s.terrain!.heights.length; k++) {
    if (s.terrain!.heights[k] !== s2.terrain!.heights[k]) dh++;
    if (s.terrain!.waterSurface[k] !== s2.terrain!.waterSurface[k]) dw++;
  }
  assert.equal(dh, 0, 'même relief nivelé');
  assert.equal(dw, 0, 'même eau');
});

test('digue (plan pur) : coût proportionnel au volume de remblai, ne fait que remblayer, profondeur bornée', () => {
  const s = sim();
  const cx = 500, cz = -500;
  carveValley(s, cx, cz);
  const ed = (s as unknown as { editable(): Parameters<typeof planEdit>[0] }).editable();
  const mk = (h: number): TerrainEdit => ({ k: 'levee', pts: [cx - 50, cz - 100, cx - 50, cz + 100], w: 16, h, ah: nat(s, cx - 50, cz - 100), bh: nat(s, cx - 50, cz + 100), g: 0.06 });
  const floor = nat(s, cx - 50, cz);
  const a = planEdit(ed, mk(floor + 6)), b = planEdit(ed, mk(floor + 12));
  assert.ok(a.ok && b.ok);
  if (!a.ok || !b.ok) return;
  for (const p of [a.plan, b.plan]) {
    const expected = p.volume * EDIT_COSTS.leveePerM3 + p.forestM2 * EDIT_COSTS.clearPerM2;
    assert.ok(Math.abs(p.cost - expected) <= 2, `coût ${p.cost} ≈ volume ${p.volume} m³ × ${EDIT_COSTS.leveePerM3}`);
    for (let n = 0; n < p.idx.length; n++) assert.ok(p.h[n]! >= ed.heights[p.idx[n]!]! - 1e-3, 'remblai seulement');
  }
  assert.ok(b.plan.volume > a.plan.volume * 2, 'deux fois plus haut : bien plus de remblai');
  assert.ok(!planEdit(ed, mk(floor + 40)).ok, 'remblai > 30 m refusé');
});
