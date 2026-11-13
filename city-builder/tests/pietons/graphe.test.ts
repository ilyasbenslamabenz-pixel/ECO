/**
 * Graphe piéton : trottoirs des deux côtés, coins, passages peints aux abords des carrefours (même géométrie que
 * le rendu des routes), connexité, hauteurs, itinéraires (A*), accès des bâtiments, autoroutes exclues.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../../src/sim/world';
import {
  buildPedGraph, CROSSWALK_OFFSET, EDGE_CORNER, EDGE_CROSS_MARKED, EDGE_CROSS_UNMARKED, EDGE_LINK, EDGE_SIDEWALK, type PedGraph,
} from '../../src/sim/pedestrians/graph';
import { COST_CROSS_UNMARKED, PedRouter } from '../../src/sim/pedestrians/router';
import { computeJunction } from '../../src/sim/roads/junction';
import { ROAD_KINDS, carriagewayWidth } from '../../src/sim/roads/types';
import { townCatalog } from '../sim/fixtures';
import { GRID_X, GRID_Z, pedTown } from './fixtures';

function components(g: PedGraph): number {
  const seen = new Uint8Array(g.nodeCount);
  let n = 0;
  for (let s = 0; s < g.nodeCount; s++) {
    if (seen[s]) continue;
    n++;
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const u = stack.pop()!;
      for (let k = g.adjStart[u]!; k < g.adjStart[u + 1]!; k++) {
        const v = g.other(g.adjEdge[k]!, u);
        if (!seen[v]) { seen[v] = 1; stack.push(v); }
      }
    }
  }
  return n;
}

function emptySim(): Simulation {
  const s = new Simulation([]);
  s.setCatalog(townCatalog());
  s.newGame({ seed: 77, mapChunks: 4, startMoney: 500_000_000, cityName: 'Graphe', terrain: { hydrology: 'aucune', rivers: 0 } });
  return s;
}

test('graphe : une rue isolée = deux trottoirs reliés par les traversées de bout d\'impasse', () => {
  const s = emptySim();
  assert.ok(s.buildRoad({ type: 'street', points: [-100, 0, 100, 0] }).ok);
  const g = buildPedGraph(s.net);
  const k = ROAD_KINDS.street;
  const off = carriagewayWidth(k) / 2 + k.sidewalk / 2;
  const kinds = [0, 0, 0, 0, 0];
  for (let e = 0; e < g.edgeCount; e++) kinds[g.eKind[e]!]!++;
  // 200 m : deux traversées libres de pleine rue (tous les ~67 m) + deux bouts d'impasse ; chaque trottoir en 3 morceaux.
  assert.deepEqual(kinds, [6, 0, 0, 4, 0]);
  assert.equal(components(g), 1);
  assert.equal(g.stats.sidewalkM, 400);
  // Chaque point de trottoir est à `off` de l'axe (z = ±off) et relevé de la bordure au-dessus de la chaussée.
  for (let e = 0; e < g.edgeCount; e++) {
    if (g.eKind[e] !== EDGE_SIDEWALK) continue;
    for (let i = 0; i < g.ePtN[e]!; i++) {
      const o = (g.ePt0[e]! + i) * 3;
      assert.ok(Math.abs(Math.abs(g.pts[o + 2]!) - off) < 1e-3, `z=${g.pts[o + 2]}`);
      const road = s.net.profile(g.eSeg[e]!);
      const y = road.heights[Math.round((g.pts[o]! + 100) / road.step)]!;
      assert.ok(Math.abs(g.pts[o + 1]! - (y + k.curbHeight)) < 0.05, `y=${g.pts[o + 1]} route=${y}`);
    }
  }
});

test('graphe : carrefour à 4 branches — coins, passages peints à 2,8 m du recul, tout est connexe', () => {
  const s = emptySim();
  assert.ok(s.buildRoad({ type: 'avenue', kind: 'avenue', points: [-150, 0, 150, 0] }).ok);
  assert.ok(s.buildRoad({ type: 'street', points: [0, -120, 0, 120] }).ok);
  const g = buildPedGraph(s.net);
  assert.equal(components(g), 1);
  const node = s.net.nodeNear(0, 0, 1);
  assert.ok(node >= 0);
  const j = computeJunction(s.net, node);
  assert.equal(j.type, 'junction');
  let corners = 0, marked = 0;
  for (let e = 0; e < g.edgeCount; e++) {
    if (g.eKind[e] === EDGE_CORNER) { corners++; assert.equal(g.eNode[e], node); }
    if (g.eKind[e] !== EDGE_CROSS_MARKED) continue;
    marked++;
    assert.equal(g.eNode[e], node);
    const arm = j.arms.find((a) => a.segId === g.eSeg[e])!;
    // Milieu du passage : sur l'axe du bras, à (recul + 2,8 m) du carrefour — là où le rendu peint les bandes.
    const p0 = g.ePt0[e]! * 3, p1 = (g.ePt0[e]! + g.ePtN[e]! - 1) * 3;
    const mx = (g.pts[p0]! + g.pts[p1]!) / 2, mz = (g.pts[p0 + 2]! + g.pts[p1 + 2]!) / 2;
    assert.ok(Math.abs(Math.hypot(mx, mz) - (arm.setback + CROSSWALK_OFFSET)) < 0.05, `passage à ${Math.hypot(mx, mz)} m, attendu ${arm.setback + CROSSWALK_OFFSET}`);
    // Largeur traversée = chaussée + deux demi-trottoirs ; le milieu de la polyligne est au niveau de la chaussée.
    const k = ROAD_KINDS[arm.kind];
    assert.ok(Math.abs(g.eLen[e]! - (carriagewayWidth(k) + k.sidewalk)) < 0.05);
    const mid = (g.ePt0[e]! + 2) * 3, end = g.ePt0[e]! * 3;
    assert.ok(Math.abs(g.pts[end + 1]! - g.pts[mid + 1]! - k.curbHeight) < 0.02, 'descente de bordure');
  }
  assert.equal(corners, 4);
  assert.equal(marked, 4);
  assert.equal(g.stats.crossingsMarked, 4);
});

test('graphe : autoroute sans piétons, rue piétonne = deux files reliées librement', () => {
  const s = emptySim();
  assert.ok(s.buildRoad({ type: 'avenue', kind: 'highway', points: [-300, -200, 300, -200] }).ok);
  let g = buildPedGraph(s.net);
  assert.equal(g.edgeCount, 0);
  assert.ok(s.buildRoad({ type: 'street', kind: 'pedestrian', points: [-60, 0, 60, 0] }).ok);
  g = buildPedGraph(s.net);
  assert.ok(g.edgeCount > 0);
  for (let e = 0; e < g.edgeCount; e++) assert.ok(g.eKind[e] === EDGE_SIDEWALK || g.eKind[e] === EDGE_LINK, `nature ${g.eKind[e]}`);
  assert.equal(g.stats.crossings, 0);
  assert.equal(components(g), 1);
});

test('graphe : ville en quadrillage connexe ; clés d\'arêtes stables d\'une construction à l\'autre', () => {
  const t = pedTown({ attach: false });
  const g = buildPedGraph(t.sim.net);
  assert.equal(components(g), 1);
  // 12 carrefours ; les 2 carrefours intérieurs de l'avenue ont 4 branches à passages peints.
  assert.ok(g.stats.crossingsMarked >= 30, `${g.stats.crossingsMarked} passages peints`);
  const g2 = buildPedGraph(t.sim.net);
  assert.deepEqual(g2.eKey, g.eKey);
  assert.equal(new Set(g.eKey).size, g.edgeCount, 'clés uniques');
  // Longueur de trottoir ≈ 2 côtés × longueur du réseau, moins les carrefours.
  const total = t.sim.net.totalLength();
  assert.ok(g.stats.sidewalkM > total * 2 * 0.85 && g.stats.sidewalkM < total * 2, `${g.stats.sidewalkM} m pour ${total} m de voirie`);
  assert.equal(GRID_X.length * GRID_Z.length, 12);
});

test('itinéraires : plus court chemin, symétrie, préférence pour les passages peints, plafond de coût', () => {
  const t = pedTown({ attach: false });
  const g = buildPedGraph(t.sim.net);
  const r = new PedRouter(g);
  const buf = new Int32Array(64), len = [0];
  const hitA = { edge: 0, s: 0, x: 0, y: 0, z: 0, d: 0 }, hitB = { ...hitA };
  // De part et d'autre de l'avenue, loin d'un carrefour (x = 0 : milieu d'un îlot de 160 m).
  assert.ok(g.nearest(0, -9, 20, true, hitA));
  assert.ok(g.nearest(0, 9, 20, true, hitB));
  assert.notEqual(hitA.edge, hitB.edge);
  const n = r.route(hitA.edge, hitA.s, hitB.edge, hitB.s, buf, 0, 64, 2000, len);
  assert.ok(n >= 3);
  // Chemin continu : arêtes consécutives partageant un nœud ; une seule traversée, PEINTE (pas de traversée sauvage d'une avenue).
  let crossings = 0;
  for (let i = 0; i < n; i++) {
    const e = buf[i]!;
    if (g.isCrossing(e)) { crossings++; assert.equal(g.eKind[e], EDGE_CROSS_MARKED); }
    if (i > 0) { const p = buf[i - 1]!; assert.ok(g.ea[e] === g.ea[p] || g.ea[e] === g.eb[p] || g.eb[e] === g.ea[p] || g.eb[e] === g.eb[p], 'arêtes contiguës'); }
  }
  assert.equal(crossings, 1);
  // Détour jusqu'au carrefour le plus proche (≈ 80 m) et retour : entre 150 et 200 m.
  assert.ok(len[0]! > 150 && len[0]! < 200, `longueur ${len[0]}`);
  const back = [0];
  const m = r.route(hitB.edge, hitB.s, hitA.edge, hitA.s, buf, 0, 64, 2000, back);
  assert.equal(m, n);
  assert.ok(Math.abs(back[0]! - len[0]!) < 0.01, 'aller = retour');
  // Plafond de coût : même trajet refusé s'il est plafonné à 100 m.
  assert.equal(r.route(hitA.edge, hitA.s, hitB.edge, hitB.s, buf, 0, 64, 100, len), 0);
  // Même arête : trajet direct.
  assert.equal(r.route(hitA.edge, 5, hitA.edge, 30, buf, 0, 64, 2000, len), 1);
  assert.equal(len[0], 25);
  assert.ok(COST_CROSS_UNMARKED > 0);
  // Une rue calme se traverse en pleine rue (traversée libre) plutôt que d'aller jusqu'au carrefour.
  assert.ok(g.nearest(0, -120 - 6, 20, true, hitA));
  assert.ok(g.nearest(0, -120 + 6, 20, true, hitB));
  const q = r.route(hitA.edge, hitA.s, hitB.edge, hitB.s, buf, 0, 64, 2000, len);
  assert.ok(q >= 2);
  let wild = 0;
  for (let i = 0; i < q; i++) if (g.eKind[buf[i]!] === EDGE_CROSS_UNMARKED) wild++;
  assert.equal(wild, 1);
});

test('accès des bâtiments : porte en façade, point d\'accès sur le trottoir d\'en face de la porte', () => {
  const t = pedTown();
  t.sim.tick(); // construit le graphe
  const g = t.system.graph!;
  let withAccess = 0;
  for (const id of t.buildings) {
    const a = t.system.accessOf(t.ctx, id);
    if (!a) continue;
    withAccess++;
    assert.equal(g.eKind[a.edge], EDGE_SIDEWALK);
    const i = t.sim.buildings.indexOf(id);
    // La porte est du côté de la rue : plus proche de la route que le centre du bâtiment.
    const dDoor = Math.hypot(a.doorX - a.x, a.doorZ - a.z), dCenter = Math.hypot(t.sim.buildings.x[i]! - a.x, t.sim.buildings.z[i]! - a.z);
    assert.ok(dDoor < dCenter, `bâtiment ${id} : porte à ${dDoor} m du trottoir, centre à ${dCenter} m`);
    assert.ok(dDoor < 25);
  }
  assert.equal(withAccess, t.buildings.length);
  assert.equal(t.system.accessOf(t.ctx, 999_999), null);
});
