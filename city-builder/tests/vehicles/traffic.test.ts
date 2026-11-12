/**
 * Tests du trafic : IDM, graphe de voies (sens, décalages, connecteurs, conflits, régimes de carrefour),
 * A* sur arcs (utilisé par la simulation, sens uniques respectés), priorité à droite, feux tricolores,
 * absence de collision, embouteillages et densité, trame transférable, changement de réseau en cours de route.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDM_BY_KIND, idmAccel, FREE_GAP } from '../../src/sim/traffic/idm';
import { Control, TrafficGraph, Turn, type TrafficNetworkInput } from '../../src/sim/traffic/network';
import { ArcRouter } from '../../src/sim/traffic/router';
import { TrafficSystem, demandShare } from '../../src/sim/traffic/system';
import { inputFromRoadGraph } from '../../src/sim/traffic/adapters';
import { RoadGraph } from '../../src/sim/ecs';
import { VEHICLE_STRIDE } from '../../src/shared/constants';
import { edge, grid, gridBuildings, vehicleCatalog } from './fixtures';

/* ------------------------------- IDM ------------------------------- */

test('IDM : route libre -> la vitesse converge vers la vitesse désirée', () => {
  const p = IDM_BY_KIND.car;
  let v = 0;
  for (let t = 0; t < 600; t++) v = Math.max(0, v + idmAccel(v, 13.9, FREE_GAP, 0, p.aMax, p.bComf, p.T, p.s0) * 0.1);
  assert.ok(Math.abs(v - 13.9) < 0.6, `v=${v}`);
});

test('IDM : arrêt derrière un obstacle immobile, sans jamais le toucher', () => {
  const p = IDM_BY_KIND.car;
  let v = 15, gap = 90, minGap = Infinity;
  for (let t = 0; t < 1200; t++) {
    const a = idmAccel(v, 15, gap, v, p.aMax, p.bComf, p.T, p.s0);
    const nv = Math.max(0, v + a * 0.1);
    gap -= (v + nv) * 0.05;
    v = nv;
    minGap = Math.min(minGap, gap);
  }
  assert.ok(v < 0.05, `v=${v}`);
  assert.ok(minGap > p.s0 * 0.8 && minGap < p.s0 + 1.5, `gap=${minGap}`);
});

test('IDM : poursuite à vitesse constante -> écart d’équilibre ≈ s0 + v·T (borné par la vitesse désirée)', () => {
  const p = IDM_BY_KIND.car;
  let v = 0, gap = 60;
  const vl = 10;
  for (let t = 0; t < 3000; t++) {
    const a = idmAccel(v, 16, gap, v - vl, p.aMax, p.bComf, p.T, p.s0);
    const nv = Math.max(0, v + a * 0.1);
    gap += (vl - (v + nv) / 2) * 0.1;
    v = nv;
  }
  const sStar = p.s0 + vl * p.T;
  const expected = sStar / Math.sqrt(1 - (vl / 16) ** 4);
  assert.ok(Math.abs(v - vl) < 0.1, `v=${v}`);
  assert.ok(Math.abs(gap - expected) < 0.6, `gap=${gap} attendu ${expected}`);
});

/* ------------------------------- réseau ------------------------------- */

/** Carrefour en croix centré en (0, 0), bras de 100 m (ouest, est, sud, nord). */
function cross(kindEW: 'rue' | 'avenue' = 'rue', kindNS: 'rue' | 'avenue' = 'rue'): TrafficNetworkInput {
  return {
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: -100, y: 0, z: 0 }, { id: 3, x: 100, y: 0, z: 0 }, { id: 4, x: 0, y: 0, z: -100 }, { id: 5, x: 0, y: 0, z: 100 }],
    edges: [edge(10, 2, 1, -100, 0, 0, 0, kindEW), edge(11, 1, 3, 0, 0, 100, 0, kindEW), edge(12, 4, 1, 0, -100, 0, 0, kindNS), edge(13, 1, 5, 0, 0, 0, 100, kindNS)],
  };
}

test('Voies : circulation à droite, décalage latéral du bon côté, rognage au carrefour', () => {
  const g = new TrafficGraph(cross());
  const e = g.edgeIndex(11); // de (0,0) vers (100,0) : sens +X
  const lane = g.arcFirstLane[e * 2]!;
  const out = new Float32Array(4);
  g.linkPoint(lane, g.linkLen[lane]! / 2, 0, out, 0);
  // dans le sens +X, la droite du conducteur est +Z
  assert.ok(out[2]! > 1 && out[2]! < 2.5, `z=${out[2]}`);
  assert.ok(Math.abs(Math.sin(out[3]!) - 1) < 1e-3, 'cap vers +X');
  const back = g.arcFirstLane[e * 2 + 1]!;
  g.linkPoint(back, 1, 0, out, 0);
  assert.ok(out[2]! < -1, 'sens inverse : côté −Z');
  assert.ok(g.linkS0[lane]! > 3, 'voie rognée au carrefour (nœud de degré 4)');
});

test('Connecteurs : 3 manœuvres par voie entrante, conflits tourne-à-gauche / tout droit opposé', () => {
  const g = new TrafficGraph(cross());
  assert.equal(g.nodeControl[g.nodeIndex(1)], Control.Priority, 'rues égales : priorité à droite');
  const nc = g.linkCount - g.laneCount;
  const atCenter = [...Array(nc).keys()].filter((c) => g.linkToNode[g.laneCount + c] === g.nodeIndex(1));
  assert.equal(atCenter.length, 12);
  const turns = atCenter.map((c) => g.connTurn[c]!);
  assert.equal(turns.filter((t) => t === Turn.Straight).length, 4);
  assert.equal(turns.filter((t) => t === Turn.Left).length, 4);
  assert.equal(turns.filter((t) => t === Turn.Right).length, 4);
  // depuis l'ouest (arc 10 avant) : gauche vers le nord ou le sud ? tout droit vers l'est
  const fromW = g.arcFirstLane[g.edgeIndex(10) * 2]!;
  const conns = [...g.laneConns.subarray(g.laneConnStart[fromW]!, g.laneConnStart[fromW + 1]!)];
  const left = conns.find((c) => g.connTurn[c - g.laneCount] === Turn.Left)!;
  const right = conns.find((c) => g.connTurn[c - g.laneCount] === Turn.Right)!;
  // venant de l'ouest en roulant vers +X : la droite est +Z (bras 13, nœud 5), la gauche −Z (bras 12 inverse)
  assert.equal(g.linkArc[right]! >> 1, g.edgeIndex(13));
  assert.equal(g.linkArc[left]! >> 1, g.edgeIndex(12));
  // tout droit opposé (depuis l'est vers l'ouest)
  const fromE = g.arcFirstLane[g.edgeIndex(11) * 2 + 1]!;
  const oppStraight = [...g.laneConns.subarray(g.laneConnStart[fromE]!, g.laneConnStart[fromE + 1]!)].find((c) => g.connTurn[c - g.laneCount] === Turn.Straight)!;
  const confl = (a: number, b: number): boolean => [...g.conflicts.subarray(g.conflictStart[a - g.laneCount]!, g.conflictStart[a - g.laneCount + 1]!)].includes(b - g.laneCount);
  assert.ok(confl(left, oppStraight), 'gauche ⟂ tout droit opposé');
  assert.ok(!confl(right, oppStraight), 'droite et tout droit opposé : pas de conflit');
});

test('Régimes : avenues -> feux tricolores à phases ; rue débouchant sur une avenue (T) -> cédez-le-passage', () => {
  const sig = new TrafficGraph(cross('avenue', 'avenue'));
  const n = sig.nodeIndex(1);
  assert.equal(sig.nodeControl[n], Control.Signal);
  assert.equal(sig.nodePhases[n], 2);
  const t = cross('avenue', 'rue');
  const yld = new TrafficGraph({ nodes: t.nodes, edges: t.edges.filter((e) => e.id !== 13) });
  const m = yld.nodeIndex(1);
  assert.equal(yld.nodeControl[m], Control.Yield);
  for (let a = yld.nodeArmStart[m]!; a < yld.nodeArmStart[m + 1]!; a++) {
    const e = yld.armArc[a]! >> 1;
    assert.equal(yld.armRankPrio[a], yld.edgeRank[e] === 1 ? 1 : 0, 'les bras de l’avenue sont prioritaires');
  }
  // voies multiples : tourner à droite depuis la voie de droite seulement
  const fromW = sig.arcFirstLane[sig.edgeIndex(10) * 2]!; // 2 voies : rangs 0 et 1
  const inner = [...sig.laneConns.subarray(sig.laneConnStart[fromW]!, sig.laneConnStart[fromW + 1]!)].map((c) => sig.connTurn[c - sig.laneCount]);
  const outer = [...sig.laneConns.subarray(sig.laneConnStart[fromW + 1]!, sig.laneConnStart[fromW + 2]!)].map((c) => sig.connTurn[c - sig.laneCount]);
  assert.ok(inner.includes(Turn.Left) && !inner.includes(Turn.Right));
  assert.ok(outer.includes(Turn.Right) && !outer.includes(Turn.Left));
});

/* ------------------------------- A* ------------------------------- */

test('A* sur arcs : plus court chemin, heuristique efficace, sens unique respecté', () => {
  const net = grid(8, 8, 100);
  const g = new TrafficGraph(net);
  const r = new ArcRouter(g);
  const from = g.edgeIndex(1) * 2; // première rue horizontale, sens +X
  const to = g.edgeIndex(7) * 2; // dernière rue de la même ligne
  const out = new Int32Array(64);
  const n = r.route(from, to, out, 0, 64);
  assert.equal(n, 7, 'tout droit le long de la ligne');
  assert.ok(r.expanded < g.edgeCount, `A* guidé (${r.expanded} arcs développés sur ${g.edgeCount * 2})`);
  // sens unique : l'arc inverse n'existe pas et n'est jamais emprunté
  const one: TrafficNetworkInput = {
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 100, y: 0, z: 0 }, { id: 3, x: 100, y: 0, z: 100 }, { id: 4, x: 0, y: 0, z: 100 }],
    edges: [edge(1, 1, 2, 0, 0, 100, 0, 'sens_unique'), edge(2, 2, 3, 100, 0, 100, 100), edge(3, 3, 4, 100, 100, 0, 100), edge(4, 4, 1, 0, 100, 0, 0)],
  };
  const g2 = new TrafficGraph(one);
  const r2 = new ArcRouter(g2);
  assert.equal(g2.arcFirstLane[g2.edgeIndex(1) * 2 + 1], -1, 'pas de voie à contresens');
  // de 2 vers 1 : impossible par le sens unique, détour par 3 et 4
  const n2 = r2.route(g2.edgeIndex(2) * 2 + 1, g2.edgeIndex(4) * 2 + 1, out, 0, 64);
  assert.equal(n2, -1, 'le seul arc menant en 2→1 est interdit ; la boucle par 3/4 exige un demi-tour hors impasse');
  const n3 = r2.route(g2.edgeIndex(1) * 2, g2.edgeIndex(4) * 2, out, 0, 64);
  assert.deepEqual([...out.subarray(0, n3)].map((a) => g2.edgeId[a >> 1]), [1, 2, 3, 4]);
});

test('La simulation calcule ses itinéraires avec A* (requêtes comptées) et les véhicules arrivent à destination', () => {
  const t = new TrafficSystem({ seed: 3, maxVehicles: 300, demandScale: 1 });
  t.setCatalog(vehicleCatalog());
  t.setNetwork(grid(5, 5, 110));
  t.setBuildings(gridBuildings(5, 5, 110));
  for (let k = 0; k < 2500; k++) t.step(0.1, 8);
  assert.ok(t.stats.connectedBuildings > 20);
  assert.ok(t.stats.spawned > 50, `spawned=${t.stats.spawned}`);
  assert.ok(t.router!.queries >= t.stats.spawned, 'un A* par trajet');
  assert.ok(t.stats.arrived > 20, `arrived=${t.stats.arrived}`);
  assert.ok(t.stats.meanSpeedKmh > 5, `vitesse moyenne ${t.stats.meanSpeedKmh}`);
});

/* ------------------------------- carrefours ------------------------------- */

function scenario(input: TrafficNetworkInput): TrafficSystem {
  const t = new TrafficSystem({ seed: 1, demand: false });
  t.setCatalog(vehicleCatalog());
  t.setNetwork(input);
  t.step(0.1, 12); // construit le graphe
  return t;
}

test('Priorité à droite : le véhicule venant de la droite s’engage le premier', () => {
  const t = scenario(cross());
  const g = t.graph!;
  // A : du sud (z = −100) vers le nord, roule vers +Z ; sa droite est −X -> B vient de l'ouest et roule vers +X
  const aArc = g.edgeIndex(12) * 2, aDest = g.edgeIndex(13) * 2;
  const bArc = g.edgeIndex(10) * 2, bDest = g.edgeIndex(11) * 2;
  const lA = g.arcFirstLane[aArc]!, lB = g.arcFirstLane[bArc]!;
  const A = t.spawnVehicle(aArc, 0, g.linkLen[lA]! - 40, aDest, 50, 0, 0, 8);
  const B = t.spawnVehicle(bArc, 0, g.linkLen[lB]! - 40, bDest, 50, 0, 0, 8);
  assert.ok(A >= 0 && B >= 0);
  let enterA = -1, enterB = -1;
  for (let k = 0; k < 600 && (enterA < 0 || enterB < 0); k++) {
    t.step(0.1, 12);
    if (enterA < 0 && t.alive[A] && g.linkKind[t.link[A]!] === 1) enterA = k;
    if (enterB < 0 && t.alive[B] && g.linkKind[t.link[B]!] === 1) enterB = k;
  }
  assert.ok(enterB >= 0 && enterA >= 0, `A=${enterA} B=${enterB}`);
  assert.ok(enterB < enterA, `B (droite) passe avant A : B=${enterB} A=${enterA}`);
});

test('Feux tricolores : arrêt au rouge avant la ligne, passage au vert', () => {
  const t = scenario(cross('avenue', 'avenue'));
  const g = t.graph!;
  const node = g.nodeIndex(1);
  const arc = g.edgeIndex(12) * 2, dest = g.edgeIndex(13) * 2;
  const lane = g.arcFirstLane[arc]! + 1;
  let arm = -1;
  for (let a = g.nodeArmStart[node]!; a < g.nodeArmStart[node + 1]!; a++) if (g.armArc[a] === arc) arm = a;
  // attendre que ce bras passe au rouge
  let guard = 0;
  while (t.signalState(node, arm) !== 2 && guard++ < 2000) t.step(0.1, 12);
  const v = t.spawnVehicle(arc, 1, g.linkLen[lane]! - 60, dest, 40, 0, 0, 10);
  assert.ok(v >= 0);
  let sawStopAtRed = false, enteredOnGreen = false;
  for (let k = 0; k < 1200; k++) {
    const st = t.signalState(node, arm);
    t.step(0.1, 12);
    if (!t.alive[v]) break;
    const onConn = g.linkKind[t.link[v]!] === 1;
    if (st === 2 && !onConn && t.v[v]! < 0.1 && g.linkLen[t.link[v]!]! - t.s[v]! < 6) sawStopAtRed = true;
    if (onConn) { enteredOnGreen = st === 0 || st === 1; break; }
    assert.ok(!(st === 2 && onConn), 'ne franchit pas au rouge');
  }
  assert.ok(sawStopAtRed, 'arrêt au rouge');
  assert.ok(enteredOnGreen, 'franchit au vert');
});

test('Aucune collision : distance minimale entre véhicules sur une grille chargée (feux, priorités, changements de voie)', () => {
  const t = new TrafficSystem({ seed: 11, maxVehicles: 600, demandScale: 2.5 });
  t.setCatalog(vehicleCatalog());
  t.setNetwork(grid(6, 6, 120, (_h, i) => (i === 2 ? 'avenue' : 'rue')));
  t.setBuildings(gridBuildings(6, 6, 120));
  const P = new Float32Array(4 * 4096);
  let minD = Infinity;
  for (let k = 0; k < 3000; k++) {
    t.step(0.1, 8);
    if (k % 10 !== 0) continue;
    const n = t.actCount;
    for (let i = 0; i < n; i++) t.vehiclePose(t.act[i]!, P, i * 4);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const d = Math.hypot(P[i * 4]! - P[j * 4]!, P[i * 4 + 2]! - P[j * 4 + 2]!);
      if (d < minD) minD = d;
    }
  }
  assert.ok(t.stats.spawned > 200, `spawned=${t.stats.spawned}`);
  assert.ok(t.stats.laneChanges > 10, 'changements de voie effectués');
  assert.ok(minD > 2.0, `distance minimale entre centres ${minD.toFixed(2)} m`);
});

test('Embouteillage émergent et compteur de densité par tronçon', () => {
  // un seul axe à une voie, deux feux : forte demande -> files d'attente
  const t = new TrafficSystem({ seed: 5, maxVehicles: 800, demandScale: 8, spawnPerStep: 12 });
  t.setCatalog(vehicleCatalog());
  t.setNetwork(grid(5, 2, 110));
  t.setBuildings(gridBuildings(5, 2, 110));
  for (let k = 0; k < 2000; k++) t.step(0.1, 8);
  const d = t.densityFrame();
  assert.equal(d.edgeIds.length, t.graph!.edgeCount);
  const max = Math.max(...d.density);
  assert.ok(max > 25, `densité max ${max.toFixed(1)} véh/km/voie`);
  assert.ok([...d.density].every((x) => x >= 0 && Number.isFinite(x)));
  assert.ok(t.stats.stopped > 5, `véhicules à l'arrêt : ${t.stats.stopped}`);
  assert.ok(Math.min(...d.speed) < t.graph!.edgeSpeed[0]! * 0.5, 'vitesse dégradée sur le tronçon le plus chargé');
});

test('Trame transférable : identifiants uniques et stables, positions finies', () => {
  const t = new TrafficSystem({ seed: 9, maxVehicles: 200, demandScale: 2 });
  t.setCatalog(vehicleCatalog());
  t.setNetwork(grid(4, 4, 100));
  t.setBuildings(gridBuildings(4, 4, 100));
  for (let k = 0; k < 400; k++) t.step(0.1, 8);
  const f1 = t.takeFrame();
  t.step(0.1, 8);
  const f2 = t.takeFrame();
  assert.equal(f1.count, f1.ids.length);
  assert.equal(f1.positions.length, f1.count * VEHICLE_STRIDE);
  assert.equal(new Set(f1.ids).size, f1.count);
  assert.ok([...f1.positions].every(Number.isFinite));
  // un véhicule présent dans les deux trames n'a parcouru que quelques mètres (identité stable)
  const idx = new Map([...f2.ids].map((id, i) => [id, i]));
  let common = 0;
  f1.ids.forEach((id, i) => {
    const j = idx.get(id);
    if (j === undefined) return;
    common++;
    const d = Math.hypot(f1.positions[i * 4]! - f2.positions[j * 4]!, f1.positions[i * 4 + 2]! - f2.positions[j * 4 + 2]!);
    assert.ok(d < 4, `saut de ${d.toFixed(1)} m`);
  });
  assert.ok(common > 10);
});

test('Changement de réseau en cours : véhicules reportés, tronçon supprimé -> véhicules retirés', () => {
  const t = new TrafficSystem({ seed: 4, maxVehicles: 300, demandScale: 2 });
  t.setCatalog(vehicleCatalog());
  const net = grid(5, 5, 100);
  t.setNetwork(net);
  t.setBuildings(gridBuildings(5, 5, 100));
  for (let k = 0; k < 500; k++) t.step(0.1, 8);
  const before = t.actCount;
  assert.ok(before > 20);
  // ajout d'un tronçon : les véhicules sont conservés
  const n2: TrafficNetworkInput = { nodes: [...net.nodes, { id: 999, x: 450, y: 0, z: 0 }], edges: [...net.edges, edge(999, 5, 999, 400, 0, 450, 0)] };
  t.setNetwork(n2);
  t.step(0.1, 8);
  assert.ok(t.actCount >= before - 3, `${t.actCount} / ${before}`);
  // suppression des tronçons de la ligne z = 0 : les véhicules qui y roulent ou y vont disparaissent
  const n3: TrafficNetworkInput = { nodes: net.nodes, edges: net.edges.filter((e) => !(e.points[2] === 0 && e.points[5] === 0)) };
  t.setNetwork(n3);
  t.step(0.1, 8);
  const g = t.graph!;
  for (let i = 0; i < t.actCount; i++) {
    const v = t.act[i]!;
    const l = t.link[v]!;
    const e = g.linkArc[l]! >> 1;
    assert.ok(!(g.ptZ[g.edgePtStart[e]!] === 0 && g.ptZ[g.edgePtStart[e]! + 1] === 0));
  }
  for (let k = 0; k < 300; k++) t.step(0.1, 8);
});

test('Adaptateur RoadGraph -> réseau de trafic (types de voies du monde)', () => {
  const rg = new RoadGraph(8, 8);
  rg.addNode(1, 0, 0, 0); rg.addNode(2, 100, 0, 0); rg.addNode(3, 100, 0, 100);
  rg.addEdge(1, 1, 2, 1, 100); rg.addEdge(2, 2, 3, 0, 100);
  const input = inputFromRoadGraph(rg);
  assert.equal(input.edges.length, 2);
  assert.equal(input.edges[0]!.lanesForward, 2, 'avenue : 2 voies par sens');
  const g = new TrafficGraph(input);
  assert.equal(g.laneCount, 6);
});

test('Profil de demande journalier : pointes du matin et du soir', () => {
  assert.ok(demandShare(8) > demandShare(3) * 5);
  assert.ok(demandShare(17.5) > demandShare(13));
});
