/**
 * Zonage sur la trame du quadrillage (exigence joueur : « la tolérance doit être de 0 car les bâtiments ne doivent pas
 * déborder ») : un bâtiment privé n'est posé que dans ses cases (côtés sur les lignes de la trame de sa route, façade
 * sur une ligne), sans repli hors trame ; les lots des parties existantes qui débordent sont recalés au premier tick
 * après le chargement si la place est libre ; les bâtiments du joueur ne bougent jamais.
 * Lancer : npx tsx --test tests/zonage/trame.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AssetCatalog } from '../../src/shared/catalog';
import { footprintObb, obbAabb } from '../../src/shared/footprint';
import { facadeOffset, lineGap } from '../../src/shared/road-grid';
import { zoneCode } from '../../src/shared/protocol-ext/zonage';
import { Simulation } from '../../src/sim/world';
import { createZonagePlugin } from '../../src/sim/plugins/zonage';
import { advanceHours, zoningTown, type ZoningTown } from './fixtures';

const HALF = 6.2; // rue (trottoirs compris)

/** Écart maximal (m) des côtés d'un bâtiment aux lignes de la trame d'une rue droite d'axe z = 0 (phase 0). */
function gridGap(t: { sim: Simulation }, id: number): number {
  const st = t.sim.buildings, i = st.indexOf(id);
  const b = obbAabb(footprintObb(st.tilesX[i]!, st.tilesZ[i]!, st.x[i]!, st.z[i]!, st.rot[i]!));
  const near = Math.min(Math.abs(b.minZ), Math.abs(b.maxZ)), far = Math.max(Math.abs(b.minZ), Math.abs(b.maxZ));
  const off = facadeOffset(HALF);
  return Math.max(lineGap(b.minX), lineGap(b.maxX), lineGap(near - off), lineGap(far - off));
}

function realTown(seed: number): ZoningTown {
  const plugin = createZonagePlugin();
  const sim = new Simulation([plugin]);
  sim.setCatalog(JSON.parse(readFileSync(join(import.meta.dirname, '../../assets/catalog.json'), 'utf8')) as AssetCatalog);
  sim.newGame({ seed, mapChunks: 4, startMoney: 20_000_000, cityName: 'Trame', terrain: { hydrology: 'aucune', rivers: 0 } });
  const ctx = sim.plugins.contextOf('zonage')!;
  return {
    sim, plugin, ctx, get sys() { return plugin.systemOf(ctx); },
    cmd: (name, payload) => { const r = sim.plugins.command('zonage', name, payload); return r.ok ? { ok: true, data: r.data.data } : { ok: false, error: r.error }; },
  };
}

test('croissance et densification : toutes les empreintes privées sur les lignes de la trame de leur route', () => {
  for (const [label, t] of [['catalogue de test', zoningTown({ seed: 11 })], ['catalogue réel', realTown(23)]] as const) {
    assert.ok(t.sim.buildRoad({ type: 'street', points: [-300, 0, 300, 0] }).ok);
    t.cmd('paint', { points: [-290, 0, -100, 0], zone: 'res_dense', depth: 3 });
    t.cmd('paint', { points: [-90, 0, 90, 0], zone: 'res_faible', depth: 3 });
    t.cmd('paint', { points: [100, 0, 290, 0], zone: 'industrie', depth: 3 });
    advanceHours(t.sim, 24 * 6);
    t.cmd('tuning', { ageMinJours: 0, seuilNiveau2: 0, seuilNiveau3: 0, probaDensification: 1, maxDensificationsParJour: 20, demandeMinDensification: -1 });
    for (let d = 0; d < 4; d++) t.sys.densifyDay(t.ctx);
    const ids = [...t.sys.owned.keys()];
    assert.ok(ids.length >= 30, `${label} : ${ids.length} bâtiments`);
    const off = ids.filter((id) => gridGap(t, id) >= 0.01);
    assert.deepEqual(off.map((id) => `${id} : ${gridGap(t, id).toFixed(2)} m`), [], `${label} : bâtiments hors trame`);
    assert.ok(t.sys.densified > 0, `${label} : densification exercée`);
  }
});

test('parties existantes : les lots privés hors de leur case sont recalés au premier tick, sauf si la place est prise ; ceux du joueur restent', () => {
  const t = zoningTown({ seed: 4 });
  assert.ok(t.sim.buildRoad({ type: 'street', points: [-200, 0, 200, 0] }).ok);
  t.cmd('paint', { points: [-190, 0, 190, 0], zone: 'res_moyen', depth: 3 });
  t.cmd('setGrowth', { enabled: false });
  const dev = t.ctx.development!;
  const code = zoneCode('res_moyen');
  const face = facadeOffset(6.2) + 8; // centre d'un 2 × 2 (16 m) dont la façade est sur la ligne des façades (8 m de l'axe), côté z > 0
  const lot = (x: number, z: number): number => {
    const r = dev.place({ assetId: 'collectif', x, z, rot: 2 });
    assert.ok(r.ok, `pose privée en ${x}, ${z} : ${JSON.stringify(r)}`);
    t.sys.owned.set(r.data.buildingId, { zone: code, level: 1, born: 0 });
    return r.data.buildingId;
  };
  const onGrid = lot(8, face); // côtés 0..16
  const along = lot(44, face); // côtés 36..52 : 4 m hors trame (ancien repli ±4 m)
  const deep = lot(-40, face + 1.2); // recul hors trame de 1,2 m (ancien repli de la 2e rangée)
  const blocked = lot(-73, face); // côtés −81..−65 : sa case (−80..−64) empiète sur le bâtiment du joueur
  const mine = t.sim.placeBuilding({ assetId: 'collectif', x: -56.5, z: face, rot: 2 }); // côtés −64,5..−48,5
  assert.ok(mine.ok);
  const mineOff = t.sim.placeBuilding({ assetId: 'collectif', x: 121.3, z: face + 0.7, rot: 2 });
  assert.ok(mineOff.ok);
  const pos = (id: number): [number, number] => { const i = t.sim.buildings.indexOf(id); return [t.sim.buildings.x[i]!, t.sim.buildings.z[i]!]; };
  const before = new Map([onGrid, along, deep, blocked, mine.data.buildingId, mineOff.data.buildingId].map((id) => [id, pos(id)]));
  const offBefore = [...t.sys.owned.keys()].filter((id) => gridGap(t, id) >= 0.01).length;
  assert.equal(offBefore, 3);

  // Sauvegarde puis chargement dans une simulation neuve : recalage au premier tick.
  const save = JSON.parse(JSON.stringify(t.sim.toSave()));
  const u = zoningTown({ seed: 4 });
  assert.equal(u.sim.fromSave(save), null);
  assert.ok(u.sim.isPrivateBuilding(along) && !u.sim.isPrivateBuilding(mine.data.buildingId));
  u.sim.tick(10);
  const p = (id: number): [number, number] => { const i = u.sim.buildings.indexOf(id); return [u.sim.buildings.x[i]!, u.sim.buildings.z[i]!]; };
  const near = (a: [number, number], b: readonly number[] | undefined, msg: string): void => assert.ok(b && Math.hypot(a[0] - b[0]!, a[1] - b[1]!) < 1e-3, `${msg} : ${a} au lieu de ${b}`);
  near(p(onGrid), before.get(onGrid), 'lot déjà dans sa case : immobile');
  near(p(along), [48, face], 'recalé le long de la route sur la case la plus proche');
  near(p(deep), [-40, face], 'recalé en profondeur sur la ligne des façades');
  near(p(blocked), before.get(blocked), 'case occupée : laissé en place');
  near(p(mine.data.buildingId), before.get(mine.data.buildingId), 'bâtiment du joueur : jamais déplacé');
  near(p(mineOff.data.buildingId), before.get(mineOff.data.buildingId), 'bâtiment du joueur hors trame : jamais déplacé');
  const offAfter = [...u.sys.owned.keys()].filter((id) => gridGap(u, id) >= 0.01);
  assert.deepEqual(offAfter, [blocked]);
  // Mêmes identifiants (occupants, zonage conservés) ; `move` refuse un bâtiment du joueur.
  assert.ok(u.sys.owned.has(along) && u.sys.owned.has(deep));
  assert.equal(u.ctx.development!.move!(mine.data.buildingId, -56, face, 2).ok, false);
  // Une seule fois : un second tick ne refait rien (le lot bloqué reste).
  u.sim.tick(10);
  near(p(blocked), before.get(blocked), 'lot bloqué');
});
