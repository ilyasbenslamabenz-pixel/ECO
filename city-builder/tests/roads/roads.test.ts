/**
 * Tests unitaires du module routier (src/sim/roads) : courbes, intersection, découpe, snapping,
 * pente, ponts, chevauchement, suppression, A* / cache / HPA*, voies, sérialisation, nivellement.
 *   npx tsx --test tests/roads/*.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AStar, ArcTable, HierarchicalPlanner, LaneGraph, PathPlanner, RoadNetwork, RoutingGraph, ROAD_KINDS,
  closestOnCubic, commitRoadPlan, computeJunction, cubicLength, deserializeNetwork, evalCubic, gradeTerrainForRoads,
  intersectCubics, planRoad, quadraticToCubic, serializeNetwork, splitCubic, straightCubic, networkRecords,
  GRADE_DEPTH, type ProfileEnv, type RoadRequest,
} from '../../src/sim/roads';
import { generateTerrain, terrainHeightAt } from '../../src/shared/terrain-gen';

const flat: ProfileEnv = { heightAt: () => 10, waterLevel: 2 };
/** Rivière : bande |z - 200| < 40 sous l'eau. */
const river: ProfileEnv = { heightAt: (_x, z) => (Math.abs(z - 200) < 40 ? -1 : 10), waterLevel: 2 };

function build(net: RoadNetwork, req: RoadRequest): number[] {
  const r = planRoad(net, req);
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return commitRoadPlan(net, r.plan).segmentIds;
}
const road = (kind: RoadRequest['kind'], x0: number, z0: number, x1: number, z1: number, control?: { x: number; z: number }): RoadRequest =>
  (control ? { kind, start: { x: x0, z: z0 }, end: { x: x1, z: z1 }, control } : { kind, start: { x: x0, z: z0 }, end: { x: x1, z: z1 } });

test('Bézier : découpe exacte, longueur, point le plus proche, intersection', () => {
  const c = quadraticToCubic(0, 0, 50, 80, 100, 0);
  const [l, r] = splitCubic(c, 0.3);
  const p = new Float64Array(2), q = new Float64Array(2);
  evalCubic(c, 0.3 + 0.7 * 0.5, p);
  evalCubic(r, 0.5, q);
  assert.ok(Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!) < 1e-9, 'la moitié droite reproduit la courbe');
  assert.ok(Math.abs(cubicLength(l) + cubicLength(r) - cubicLength(c)) < 0.05);
  assert.ok(Math.abs(cubicLength(straightCubic(0, 0, 30, 40)) - 50) < 1e-6);
  const cl = closestOnCubic(straightCubic(0, 0, 100, 0), 40, 7);
  assert.ok(Math.abs(cl.x - 40) < 1e-6 && Math.abs(cl.d - 7) < 1e-6);
  const hits = intersectCubics(straightCubic(0, 0, 100, 0), straightCubic(30, -50, 30, 50));
  assert.equal(hits.length, 1);
  assert.ok(Math.abs(hits[0]!.x - 30) < 1e-6 && Math.abs(hits[0]!.ta - 0.3) < 1e-6);
  const arc = new ArcTable(c);
  assert.ok(Math.abs(arc.sAt(arc.tAt(37)) - 37) < 0.01);
});

test('Route droite : 2 nœuds, 1 tronçon, coût = longueur × coût au mètre', () => {
  const net = new RoadNetwork(flat);
  const r = planRoad(net, road('street', 0, 0, 100, 0));
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.plan.cost, Math.round(100 * ROAD_KINDS.street.costPerMeter));
  const v = net.version;
  assert.equal(net.segCount, 0, 'planRoad (dryRun) ne modifie rien');
  assert.equal(net.version, v);
  const ids = commitRoadPlan(net, r.plan).segmentIds;
  assert.equal(ids.length, 1);
  assert.equal(net.nodeCount, 2);
  assert.ok(Math.abs(net.length(ids[0]!) - 100) < 1e-6);
});

test('Croisement : intersection automatique, découpe du tronçon existant (carrefour en +)', () => {
  const net = new RoadNetwork(flat);
  build(net, road('street', -100, 0, 100, 0));
  const ids = build(net, road('avenue', 0, -100, 0, 100));
  assert.equal(ids.length, 2, 'la nouvelle route est coupée au carrefour');
  assert.equal(net.segCount, 4);
  assert.equal(net.nodeCount, 5);
  const center = net.nodeNear(0, 0, 0.5);
  assert.ok(center >= 0, 'nœud de carrefour au point de croisement');
  assert.equal(net.incident(center).length, 4);
  const j = computeJunction(net, center);
  assert.equal(j.type, 'junction');
  assert.ok(j.arms.every((a) => a.setback > ROAD_KINDS.street.sidewalk), 'reculs dégagés pour la dalle');
  // Longueur totale conservée.
  assert.ok(Math.abs(net.totalLength() - 400) < 0.01);
  const ch = net.takeChanges();
  assert.ok(ch.segmentsAdded.length === 4 && ch.segmentsRemoved.length === 0, 'le tronçon créé puis découpé dans le même lot disparaît du journal');
});

test('Snapping : extrémité accrochée à un nœud, puis le long d\'un tronçon (T, découpe)', () => {
  const net = new RoadNetwork(flat);
  build(net, road('street', 0, 0, 100, 0));
  build(net, road('street', 102, 1.5, 100, 80)); // départ à 2,5 m du nœud (100,0)
  assert.equal(net.nodeCount, 3);
  const n = net.nodeNear(100, 0, 0.1);
  assert.equal(net.incident(n).length, 2);
  // T : arrivée sur le milieu du premier tronçon.
  build(net, road('street', 40, 60, 41, 2));
  assert.equal(net.segCount, 4, 'tronçon existant découpé en deux + nouveau');
  const t = net.nodeNear(41, 0, 1);
  assert.ok(t >= 0);
  assert.equal(net.incident(t).length, 3);
  assert.equal(computeJunction(net, t).type, 'junction');
});

test('Tracé courbe : longueur > corde ; virage trop serré refusé', () => {
  const net = new RoadNetwork(flat);
  const r = planRoad(net, road('avenue', 0, 0, 200, 0, { x: 100, z: 60 }));
  assert.ok(r.ok);
  if (r.ok) assert.ok(r.plan.length > 200);
  const bad = planRoad(net, road('highway', 0, 0, 60, 0, { x: 30, z: 60 }));
  assert.ok(!bad.ok && bad.error.message.includes('Virage'));
});

test('Pente maximale : la route lisse le relief mais refuse une pente trop forte', () => {
  const hill: ProfileEnv = { heightAt: (x) => 10 + x * 0.3, waterLevel: 2 };
  const net = new RoadNetwork(hill);
  const r = planRoad(net, road('street', 0, 0, 100, 0));
  assert.ok(!r.ok && r.error.code === 'TOO_STEEP');
  const gentle: ProfileEnv = { heightAt: (x, z) => 10 + x * 0.05 + Math.sin(z / 7) * 1.5, waterLevel: 2 };
  const net2 = new RoadNetwork(gentle);
  const ok = planRoad(net2, road('street', 0, 0, 0, 300));
  assert.ok(ok.ok);
  if (ok.ok) assert.ok(ok.plan.pieceProfiles[0]!.maxGrade <= ROAD_KINDS.street.maxGrade * 1.05);
});

test('Pont au-dessus de l\'eau : tablier, rampes, piles, surcoût ; pont trop court refusé', () => {
  const net = new RoadNetwork(river);
  const r = planRoad(net, road('street', 0, 0, 0, 400));
  assert.ok(r.ok, r.ok ? '' : r.error.message);
  if (!r.ok) return;
  const p = r.plan.pieceProfiles[0]!;
  assert.ok(r.plan.bridgeLength >= 70, `pont de ${r.plan.bridgeLength} m`);
  assert.ok(p.piers.length >= 1, 'piles de pont');
  for (let i = 0; i < p.count; i++) if (p.ground[i]! < 2) assert.ok(p.heights[i]! >= 2 + 5, 'tirant d\'air au-dessus de l\'eau');
  assert.ok(p.maxGrade <= ROAD_KINDS.street.maxGrade * 1.05);
  assert.ok(r.plan.cost > 400 * ROAD_KINDS.street.costPerMeter, 'surcoût du pont');
  const lowBanks: ProfileEnv = { heightAt: (_x, z) => (Math.abs(z - 200) < 40 ? -1 : 3), waterLevel: 2 };
  const short = planRoad(new RoadNetwork(lowBanks), road('street', 0, 157, 0, 243));
  assert.ok(!short.ok && short.error.code === 'UNDER_WATER', 'rampe impossible : extrémités trop proches de l\'eau');
  const wet = planRoad(new RoadNetwork(river), road('street', 0, 0, 0, 200));
  assert.ok(!wet.ok && wet.error.code === 'UNDER_WATER');
});

test('Règles : autoroute non croisable à niveau (phase 4), chevauchement refusé, croisement rasant refusé', () => {
  const net = new RoadNetwork(flat);
  build(net, road('highway', -300, 0, 300, 0));
  const x = planRoad(net, road('street', 0, -100, 0, 100));
  assert.ok(!x.ok && x.error.code === 'NOT_IMPLEMENTED' && x.error.phase === 4);
  const net2 = new RoadNetwork(flat);
  build(net2, road('street', 0, 0, 200, 0));
  const par = planRoad(net2, road('street', 20, 4, 180, 4));
  assert.ok(!par.ok && par.error.code === 'COLLISION', par.ok ? 'accepté' : par.error.message);
  const graze = planRoad(net2, road('street', 20, -15, 180, 15));
  assert.ok(!graze.ok && graze.error.code === 'COLLISION');
});

test('Suppression : nœuds orphelins supprimés, carrefour redevenu simple raccord', () => {
  const net = new RoadNetwork(flat);
  build(net, road('street', 0, 0, 100, 0));
  const t = build(net, road('street', 50, 60, 50, 2));
  const tNode = net.nodeNear(50, 0, 1);
  assert.equal(net.incident(tNode).length, 3);
  const orphans = net.removeSegment(t[0]!);
  assert.equal(orphans.length, 1, 'l\'extrémité libre de la branche disparaît');
  assert.equal(net.incident(tNode).length, 2);
  assert.equal(computeJunction(net, tNode).type, 'continuous');
  for (const id of net.segmentIds()) net.removeSegment(id);
  assert.equal(net.nodeCount, 0);
});

/** Grille de rues n x n, pas de `step` m. */
function grid(n: number, step: number, kind: RoadRequest['kind'] = 'street'): RoadNetwork {
  const net = new RoadNetwork(flat, 64);
  for (let i = 0; i < n; i++) {
    build(net, road(kind, 0, i * step, (n - 1) * step, i * step));
  }
  for (let i = 0; i < n; i++) build(net, road(kind, i * step, 0, i * step, (n - 1) * step));
  return net;
}

test('A* : plus court chemin sur une grille, sens unique respecté, rue piétonne réservée aux piétons', () => {
  const net = grid(5, 100);
  assert.equal(net.nodeCount, 25);
  const a = net.nodeNear(0, 0, 1), b = net.nodeNear(400, 400, 1);
  const pl = new PathPlanner(net);
  const p = pl.find(a, b)!;
  assert.ok(p);
  assert.equal(p.nodes.length, 9, 'chemin de Manhattan : 8 tronçons');
  assert.ok(Math.abs(p.cost - 800 / (40 / 3.6)) < 1e-3);
  // Sens unique : de B vers A seulement.
  const n2 = new RoadNetwork(flat);
  build(n2, road('oneway', 0, 0, 100, 0));
  const A = n2.nodeNear(0, 0, 1), B = n2.nodeNear(100, 0, 1);
  const pp = new PathPlanner(n2);
  assert.ok(pp.find(A, B));
  assert.equal(pp.find(B, A), null, 'contresens interdit');
  // Rue piétonne.
  const n3 = new RoadNetwork(flat);
  build(n3, road('pedestrian', 0, 0, 100, 0));
  const P = n3.nodeNear(0, 0, 1), Q = n3.nodeNear(100, 0, 1);
  assert.equal(new PathPlanner(n3, 'vehicle').find(P, Q), null);
  assert.ok(new PathPlanner(n3, 'pedestrian').find(P, Q));
});

test('Cache de chemins : réutilisation puis invalidation quand le réseau change', () => {
  const net = grid(4, 100);
  const pl = new PathPlanner(net);
  const a = net.nodeNear(0, 0, 1), b = net.nodeNear(300, 300, 1);
  pl.find(a, b); pl.find(a, b);
  assert.equal(pl.hits, 1);
  assert.equal(pl.misses, 1);
  build(net, road('street', 300, 300, 300, 400));
  pl.find(a, b);
  assert.equal(pl.misses, 2, 'nouvelle version du réseau : recalcul');
});

test('A* hiérarchique : même coût que l\'A* plat (grappes de 250 m)', () => {
  const net = grid(7, 100);
  // Quelques sens uniques et avenues pour casser la symétrie.
  const g = new RoutingGraph(net);
  const flatA = new AStar(g);
  const h = new HierarchicalPlanner(g, 250);
  assert.ok(h.borders.length > 0 && h.abstractEdgeCount > 0);
  const ids = net.nodeIds();
  let checked = 0;
  for (let k = 0; k < 40; k++) {
    const s = ids[(k * 7) % ids.length]!, t = ids[(k * 13 + 5) % ids.length]!;
    if (s === t) continue;
    const a = flatA.find(s, t)!, b = h.find(s, t)!;
    assert.ok(a && b);
    assert.ok(Math.abs(a.cost - b.cost) < 1e-3, `coûts ${a.cost} / ${b.cost}`);
    assert.equal(b.nodes[0], s); assert.equal(b.nodes[b.nodes.length - 1], t);
    // Chemin continu : chaque pas suit un arc du graphe.
    for (let i = 1; i < b.nodes.length; i++) {
      const u = g.indexOf(b.nodes[i - 1]!), v = g.indexOf(b.nodes[i]!);
      let found = false;
      for (let e = g.offsets[u]!; e < g.offsets[u + 1]!; e++) if (g.targets[e] === v) found = true;
      assert.ok(found, 'pas de saut dans le chemin raffiné');
    }
    checked++;
  }
  assert.ok(checked > 30);
});

test('Graphe de voies : voies par sens, connexions de manœuvre, pas de demi-tour hors impasse', () => {
  const net = new RoadNetwork(flat);
  build(net, road('avenue', -150, 0, 150, 0));
  build(net, road('oneway', 0, -150, 0, 150));
  const lg = new LaneGraph(net);
  const av = net.segmentIds().filter((id) => net.kindOf(id) === 'avenue');
  for (const s of av) assert.equal(lg.lanesOf(s).length, 4);
  const ow = net.segmentIds().filter((id) => net.kindOf(id) === 'oneway');
  for (const s of ow) {
    const lanes = lg.lanesOf(s);
    assert.equal(lanes.length, 2);
    assert.ok(lanes.every((l) => lg.laneForward[l] === 1));
  }
  const center = net.nodeNear(0, 0, 1);
  let uturns = 0, total = 0;
  for (let l = 0; l < lg.count; l++) {
    if (lg.laneToNode[l] !== center) continue;
    const n = lg.connOffsets[l + 1]! - lg.connOffsets[l]!;
    assert.ok(n >= 1, 'chaque voie entrante a une sortie');
    for (let k = lg.connOffsets[l]!; k < lg.connOffsets[l + 1]!; k++) {
      total++;
      if (LaneGraph.TURNS[lg.connTurn[k]!] === 'uturn') uturns++;
      // On ne rejoint jamais un sens unique à contresens.
      const t = lg.connTargets[k]!;
      if (net.kindOf(lg.laneSeg[t]!) === 'oneway') assert.equal(lg.laneForward[t], 1);
    }
  }
  assert.ok(total > 0);
  assert.equal(uturns, 0);
});

test('Sérialisation : aller-retour identique (courbes comprises), versions et références contrôlées', () => {
  const net = grid(3, 120);
  build(net, road('boulevard', -200, 400, 400, 400, { x: 100, z: 520 }));
  const j1 = serializeNetwork(net);
  const r = deserializeNetwork(JSON.parse(JSON.stringify(j1)), flat);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(serializeNetwork(r.network), j1);
  assert.equal(r.network.nextSegId, net.nextSegId);
  const curved = r.network.segmentIds().find((id) => r.network.kindOf(id) === 'boulevard')!;
  assert.ok(Math.abs(r.network.length(curved) - net.length(curved)) < 0.01);
  assert.ok(!deserializeNetwork({ ...j1, version: 99 }, flat).ok);
  const broken = JSON.parse(JSON.stringify(j1));
  broken.segments[0].b = 9999;
  assert.ok(!deserializeNetwork(broken, flat).ok);
  const recs = networkRecords(net);
  assert.equal(recs.edges.length, net.segCount);
  assert.ok(recs.edges.every((e) => e.kind && e.c1 && e.c2));
});

test('Nivellement : le terrain affleure sous la chaussée (hors pont)', () => {
  const t = generateTerrain(1234, 2);
  const env: ProfileEnv = { heightAt: (x, z) => terrainHeightAt(t, x, z), waterLevel: t.waterLevel };
  const net = new RoadNetwork(env);
  // tracé dans la plaine centrale
  const ids = build(net, road('street', -150, -120, 150, -60));
  const box = gradeTerrainForRoads(t, net);
  assert.ok(box);
  const prof = net.profile(ids[0]!);
  const arc = net.arc(ids[0]!);
  const c = net.curve(ids[0]!);
  const p = new Float64Array(2);
  for (const s of [40, 120, 200]) {
    evalCubic(c, arc.tAt(s), p);
    const h = terrainHeightAt(t, p[0]!, p[1]!);
    const road = prof.heights[Math.round(s / prof.step)]!;
    assert.ok(Math.abs(h - (road - GRADE_DEPTH)) < 0.35, `terrain ${h.toFixed(2)} / route ${road.toFixed(2)}`);
  }
});
