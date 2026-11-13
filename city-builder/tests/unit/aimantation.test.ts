/**
 * Aimantation des outils (« mettre les choses droites ») et écart minimal entre maisons :
 * - route : angles de 0/45/90° par rapport au nord et à la route existante (prolongement, perpendiculaire),
 *   longueur arrondie au mètre, guide d'alignement ;
 * - bâtiments : côte à côte avec le voisin (façades alignées, écart minimal respecté) ;
 * - simulation : deux maisons ne peuvent plus se toucher (marge HOUSE_GAP), l'aperçu passe donc au rouge.
 * Lancer : npx tsx --test tests/unit/aimantation.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorldMirror } from '../../src/client/tools/mirror';
import { magnetPoint, snapRoadPoint } from '../../src/client/tools/road-draft';
import { proposePlacement } from '../../src/client/tools/snapping';
import { HOUSE_GAP, obbOverlap } from '../../src/shared/footprint';
import { MockSim } from '../../src/input/mocks';
import { Simulation } from '../../src/sim/world';
import { testAsset, testCatalog } from '../fixtures/catalog';

function mirror(buildings: { id: number; x: number; z: number; rot?: number }[] = []): WorldMirror {
  const cat = testCatalog();
  const m = new WorldMirror(cat);
  const heights = new Float32Array(33 * 33).fill(10);
  m.applySnapshot({
    kind: 'snapshot', params: { seed: 1, mapChunks: 1, startMoney: 0, cityName: 'T' },
    terrain: { samplesX: 33, samplesZ: 33, spacing: 8, originX: -128, originZ: -128, heights, waterLevel: 2 },
    buildings: buildings.map((b) => ({ id: b.id, assetId: 'maison_test', variant: 0, x: b.x, z: b.z, y: 10, rot: b.rot ?? 0 })),
    roads: { nodes: [{ id: 1, x: -100, y: 10, z: 0 }, { id: 2, x: 100, y: 10, z: 0 }], edges: [{ id: 7, a: 1, b: 2, type: 'avenue', length: 200 }] },
    stats: new MockSim(cat).stats(),
  });
  return m;
}

test('route aimantée : prolongement dans l\'axe depuis l\'extrémité, longueur au mètre', () => {
  const m = mirror();
  const p = magnetPoint(m, 160.4, 3, { x: 100, z: 0 })!;
  assert.equal(p.snap, 'angle');
  assert.ok(Math.abs(p.z) < 1e-9, `dans l'axe (z=${p.z})`);
  assert.ok(Math.abs(p.x - 160) < 1e-9, `60 m ronds (x=${p.x})`);
  assert.match(p.guide!.label, /axe de la route/);
});

test('route aimantée : perpendiculaire depuis un point de la route', () => {
  const m = mirror();
  const p = snapRoadPoint(m, 3, 49.6, { radius: 8, angleSnap: false, magnet: true }, { x: 0, z: 0 });
  assert.equal(p.snap, 'angle');
  assert.ok(Math.abs(p.x) < 1e-9 && Math.abs(p.z - 50) < 1e-9, `(${p.x}, ${p.z})`);
  assert.match(p.guide!.label, /perpendiculaire/);
});

test('route aimantée : 45° avec le nord loin de toute route ; angle quelconque = longueur arrondie seule', () => {
  const m = mirror();
  const d = magnetPoint(m, 40 + 32, 40 + 30, { x: 40, z: 40 })!;
  assert.equal(d.snap, 'angle');
  assert.ok(Math.abs((d.x - 40) - (d.z - 40)) < 1e-9, 'diagonale exacte');
  const f = magnetPoint(m, 40 + 30, 40 + 12.3, { x: 40, z: 40 })!; // ≈ 22°
  assert.equal(f.snap, 'free');
  const L = Math.hypot(f.x - 40, f.z - 40);
  assert.ok(Math.abs(L - Math.round(L)) < 1e-9, `longueur entière (${L})`);
  // Sans aimantation : point brut.
  const raw = snapRoadPoint(m, 70, 52.3, { radius: 8, angleSnap: false, magnet: false }, { x: 40, z: 40 });
  assert.deepEqual([raw.x, raw.z, raw.snap], [70, 52.3, 'free']);
});

test('bâtiment aimanté : côte à côte avec le voisin le long de la route, façades alignées, écart minimal', () => {
  const a = testAsset('maison_test');
  // Voisin posé à la profondeur que donne l'accroche à la route (avenue : 11,5 m + 8 m + 0,6 m).
  const zRow = 11.5 + 8 + 0.6;
  const m = mirror([{ id: 1, x: 40, z: zRow }]);
  const p = proposePlacement(m, a, 60, 18, { rot: 0, autoAlign: true, magnet: true });
  assert.equal(p.neighbor, true);
  assert.ok(Math.abs(p.z - zRow) < 0.01, `façade alignée (z=${p.z})`);
  const gap = p.x - 8 - (40 + 8);
  assert.ok(gap >= HOUSE_GAP && gap < HOUSE_GAP + 0.5, `écart ${gap}`);
  const other = m.buildingObb(m.buildings.get(1)!)!;
  assert.equal(obbOverlap(p.obb, other, -HOUSE_GAP + 0.01), false);
  // Aimantation coupée : la position suit le curseur.
  const q = proposePlacement(m, a, 60, 18, { rot: 0, autoAlign: true, magnet: false });
  assert.ok(!q.neighbor && Math.abs(q.x - 60) < 0.01);
});

test('simulation : deux maisons ne se touchent plus (écart minimal)', () => {
  const sim = new Simulation();
  sim.setCatalog(testCatalog());
  sim.newGame({ seed: 3, mapChunks: 2, startMoney: 1e7, cityName: 't', terrain: { hydrology: 'aucune', rivers: 0 } });
  let at: [number, number] | null = null;
  for (let r = 0; r < 400 && !at; r += 24) for (let k = 0; k < 8 && !at; k++) {
    const x = Math.cos(k) * r, z = Math.sin(k) * r;
    const ok = [0, 16.5, 33, 50].every((dx) => sim.placeBuilding({ assetId: 'maison_test', x: x + dx, z, rot: 0, dryRun: true }).ok);
    if (ok) at = [x, z];
  }
  assert.ok(at, 'terrain plat trouvé');
  const [x, z] = at!;
  assert.ok(sim.placeBuilding({ assetId: 'maison_test', x, z, rot: 0 }).ok);
  const touching = sim.placeBuilding({ assetId: 'maison_test', x: x + 16, z, rot: 0, dryRun: true });
  assert.equal(touching.ok, false, 'bord à bord refusé');
  assert.match(touching.ok ? '' : touching.error.message, /Trop près/);
  assert.equal(sim.placeBuilding({ assetId: 'maison_test', x: x + 16 + HOUSE_GAP + 0.05, z, rot: 0, dryRun: true }).ok, true, 'avec l\'écart : accepté');
});
