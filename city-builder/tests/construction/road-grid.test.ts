/**
 * Quadrillage local des routes (src/shared/road-grid.ts) : le quadrillage affiché au sol avec l'outil Bâtiment suit la
 * route la plus proche (rotation, ligne des façades, côtés des bâtiments voisins) et les bâtiments posés à la main
 * (aimantation) ou par le zonage ont leurs bords sur ses lignes, y compris le long d'une rue en biais.
 * Lancer : npx tsx --test tests/construction/road-grid.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorldMirror } from '../../src/client/tools/mirror';
import { localRoadGrid } from '../../src/client/tools/road-grid';
import { proposePlacement } from '../../src/client/tools/snapping';
import { footprintObb, obbCorners, type Obb } from '../../src/shared/footprint';
import { canonicalTangent, gridCoords, lineGap, pickPhase, roadGridFrame, snapAlong, type RoadGridFrame } from '../../src/shared/road-grid';
import { MockSim } from '../../src/input/mocks';
import { testCatalog } from '../fixtures/catalog';
import { zoningTown } from '../zonage/fixtures';

/** Écart maximal (m) des coins d'une empreinte aux lignes de la trame (u et v), et profondeur minimale v. */
function cornerGaps(f: RoadGridFrame, o: Obb): { u: number; v: number; vMin: number } {
  const c = obbCorners(o);
  let u = 0, v = 0, vMin = Infinity;
  for (let k = 0; k < 8; k += 2) {
    const g = gridCoords(f, c[k]!, c[k + 1]!);
    u = Math.max(u, lineGap(g.u)); v = Math.max(v, lineGap(g.v)); vMin = Math.min(vMin, g.v);
  }
  return { u, v, vMin };
}

const ANG = 0.47; // ≈ 27° : rue en biais (cas de la capture du joueur)
const T: [number, number] = [Math.cos(ANG), Math.sin(ANG)];

function diagMirror(buildings: { id: number; x: number; z: number; rot: number }[] = []): WorldMirror {
  const cat = testCatalog();
  const m = new WorldMirror(cat);
  const heights = new Float32Array(65 * 65).fill(10);
  m.applySnapshot({
    kind: 'snapshot', params: { seed: 1, mapChunks: 2, startMoney: 0, cityName: 'T' },
    terrain: { samplesX: 65, samplesZ: 65, spacing: 8, originX: -256, originZ: -256, heights, waterLevel: 2 },
    buildings: buildings.map((b) => ({ id: b.id, assetId: 'maison_test', variant: 0, x: b.x, z: b.z, y: 10, rot: b.rot })),
    // Tracé dans le sens « négatif » (b -> a) : la trame ne dépend pas du sens du tronçon.
    roads: { nodes: [{ id: 1, x: 150 * T[0] + 3, y: 10, z: 150 * T[1] + 5 }, { id: 2, x: -150 * T[0] + 3, y: 10, z: -150 * T[1] + 5 }], edges: [{ id: 7, a: 1, b: 2, type: 'street', length: 300 }] },
    stats: new MockSim(cat).stats(),
  });
  return m;
}

test('trame : tangente canonique, même trame quel que soit le sens du tronçon ; v = 0 sur la ligne des façades', () => {
  assert.deepEqual(canonicalTangent(-1, 0), [1, 0]);
  assert.deepEqual(canonicalTangent(0, -2), [0, 1]);
  const a = roadGridFrame(10, 5, T[0], T[1], 6.2), b = roadGridFrame(10, 5, -T[0], -T[1], 6.2);
  assert.deepEqual([a.tx, a.tz, a.cn, a.offset], [b.tx, b.tz, b.cn, b.offset]);
  // Point à 6,8 m de l'axe (6,2 m de demi-largeur + 0,6 m de recul) des deux côtés : ligne des façades.
  for (const side of [1, -1]) {
    const g = gridCoords(a, 10 + a.nx * 6.8 * side, 5 + a.nz * 6.8 * side);
    assert.ok(Math.abs(g.v) < 1e-9, `v=${g.v}`);
    assert.equal(g.side, side);
  }
  // snapAlong : côté gauche de l'empreinte sur une ligne, profondeur inchangée.
  const f = { ...a, phase: 3 };
  const [x, z] = snapAlong(f, 40, 30, 8);
  const g0 = gridCoords(f, 40, 30), g1 = gridCoords(f, x, z);
  assert.ok(lineGap(g1.u - 8) < 1e-9 && Math.abs(g1.v - g0.v) < 1e-9 && Math.abs(g1.u - g0.u) <= 4 + 1e-9);
});

test('pose à la main (aimantation) le long d\'une rue en biais : les bords de l\'emprise tombent sur les lignes affichées', () => {
  const m = diagMirror();
  const a = m.asset('maison_test')!;
  for (const [cx, cz] of [[20, 30], [-37, 2], [61, 18]] as const) {
    const p = proposePlacement(m, a, cx, cz, { rot: 0, autoAlign: true, magnet: true });
    assert.equal(p.snapped, true);
    const loc = localRoadGrid(m, cx, cz)!;
    assert.ok(loc, 'quadrillage local près de la route');
    const gaps = cornerGaps(loc.frame, p.obb);
    assert.ok(gaps.u < 0.02 && gaps.v < 0.02, `coins sur la trame (écarts u=${gaps.u.toFixed(3)} v=${gaps.v.toFixed(3)})`);
    assert.ok(gaps.vMin > -0.02, 'aucun coin sur la chaussée');
  }
  // Sans aimantation : la position suit le curseur (comportement inchangé), la façade reste sur la ligne des façades.
  const q = proposePlacement(m, a, 20, 30, { rot: 0, autoAlign: true, magnet: false });
  assert.ok(cornerGaps(localRoadGrid(m, 20, 30)!.frame, q.obb).v < 0.02);
});

test('partie existante : la trame se recale sur le bâtiment voisin (phase), sans le déplacer', () => {
  // Maison existante posée face à la route à une position quelconque le long de la rue (ancienne sauvegarde).
  const f0 = roadGridFrame(3, 5, T[0], T[1], 6.2);
  const along = 23.7, depth = 6.8 + 8; // façade sur la ligne des façades, côté +N
  const bx = 3 + T[0] * along + f0.nx * depth, bz = 5 + T[1] * along + f0.nz * depth;
  const rot = ((Math.atan2(-f0.nx, -f0.nz) - Math.atan2(0, 1)) / (Math.PI / 2) + 4) % 4;
  const o = footprintObb(2, 2, bx, bz, rot);
  const m = diagMirror([{ id: 1, x: bx, z: bz, rot }]);
  const loc = localRoadGrid(m, bx + T[0] * 20, bz + T[1] * 20)!;
  const gaps = cornerGaps(loc.frame, o);
  assert.ok(gaps.u < 0.02 && gaps.v < 0.02, `bâtiment existant sur la trame affichée (u=${gaps.u.toFixed(3)} v=${gaps.v.toFixed(3)})`);
  // Loin (> 48 m le long de la route) : trame du monde (phase 0).
  assert.equal(pickPhase(f0, [o], bx + T[0] * 120, bz + T[1] * 120), 0);
  // Un bâtiment en biais par rapport à la route ne donne pas de phase.
  assert.equal(pickPhase(f0, [footprintObb(2, 2, bx, bz, rot + 0.3)], bx, bz), 0);
});

test('zonage : les bâtiments qui poussent le long d\'une rue en biais ont leurs bords sur la trame de la route', () => {
  const t = zoningTown({ seed: 5 });
  // Rue en biais sur une zone plate, zonée des deux côtés, croissance forcée.
  let placed: [number, number, number, number] | null = null;
  for (let r = 0; r < 300 && !placed; r += 24) for (let k = 0; k < 8 && !placed; k++) {
    const x = Math.cos(k) * r, z = Math.sin(k) * r;
    const pts = [x - 90 * T[0], z - 90 * T[1], x + 90 * T[0], z + 90 * T[1]];
    if (t.sim.buildRoad({ type: 'street', points: pts }).ok) placed = pts as [number, number, number, number];
  }
  assert.ok(placed, 'rue en biais construite');
  const [x0, z0, x1, z1] = placed!;
  // Résidentiel moyen (maisons de ville mitoyennes : aucun écart imposé entre voisins, rangées continues).
  t.cmd('paint', { points: [x0, z0, x1, z1], zone: 'res_moyen', depth: 3 });
  t.cmd('tuning', { demandeMin: -1, naissancesParHeure: 3, maxParHeure: 3, maxChantiers: 1000 });
  t.cmd('grow', { attempts: 40 });
  const sys = t.sys, st = t.ctx.buildings.store;
  let n = 0, onGrid = 0;
  for (const id of sys.owned.keys()) {
    const i = t.ctx.buildings.indexOf(id);
    const o = footprintObb(st.tilesX[i]!, st.tilesZ[i]!, st.x[i]!, st.z[i]!, st.rot[i]!);
    const hit = sys.roads.nearest(o.cx, o.cz, 40)!;
    const f = roadGridFrame(hit.x, hit.z, hit.tx, hit.tz, hit.half);
    // Phase locale telle que l'affiche le quadrillage (voisin parallèle le plus proche : lui-même).
    f.phase = pickPhase(f, [o], o.cx, o.cz);
    const g = cornerGaps(f, o);
    n++;
    // Profondeur : façade (et dos) sur une ligne de la trame — vrai pour CHAQUE bâtiment.
    assert.ok(g.v < 0.05 && g.vMin > -0.05, `bâtiment ${id} : façade sur la trame (v=${g.v.toFixed(3)})`);
    // Le long de la route : voisins sur la même phase que la trame locale (lignes communes).
    const others: Obb[] = [];
    for (const j of sys.owned.keys()) if (j !== id) { const k = t.ctx.buildings.indexOf(j); others.push(footprintObb(st.tilesX[k]!, st.tilesZ[k]!, st.x[k]!, st.z[k]!, st.rot[k]!)); }
    const ph = pickPhase(f, others, o.cx, o.cz);
    if (lineGap(ph - f.phase) < 0.05) onGrid++;
  }
  assert.ok(n >= 4, `${n} bâtiments ont poussé`);
  assert.ok(onGrid >= n * 0.9, `${onGrid}/${n} bâtiments alignés sur la trame de leurs voisins`);
});
