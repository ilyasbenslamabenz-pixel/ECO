/**
 * Réglages de carrefour du joueur : « stop » impose un arrêt complet à la ligne ; « priorité » donne un axe
 * principal qui passe sans arrêt (les autres branches cèdent), et non une priorité à droite.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TrafficSystem } from '../../src/sim/traffic/system';
import { Control, TrafficGraph, mainAxis, type JunctionMode, type TrafficNetworkInput } from '../../src/sim/traffic/network';
import { edge, vehicleCatalog } from '../vehicles/fixtures';

const G = (t: TrafficSystem): TrafficGraph => (t as unknown as { graph: TrafficGraph }).graph;
const C = 5;
/** Croisement de 4 rues de 150 m : 1 (ouest), 2 (est), 3 (sud), 4 (nord) -> centre 5. */
function cross(mode: JunctionMode | null): { t: TrafficSystem; g: TrafficGraph } {
  const t = new TrafficSystem({ seed: 3, maxVehicles: 20, demand: false });
  t.setCatalog(vehicleCatalog());
  const net: TrafficNetworkInput = {
    nodes: [{ id: 1, x: -150, y: 0, z: 0 }, { id: 2, x: 150, y: 0, z: 0 }, { id: 3, x: 0, y: 0, z: -150 }, { id: 4, x: 0, y: 0, z: 150 }, { id: C, x: 0, y: 0, z: 0 }],
    edges: [edge(1, 1, C, -150, 0, 0, 0), edge(2, C, 2, 0, 0, 150, 0), edge(3, 3, C, 0, -150, 0, 0), edge(4, C, 4, 0, 0, 0, 150)],
  };
  t.setNetwork(net);
  if (mode) t.setJunctionMode(C, mode);
  t.step(0, 9);
  return { t, g: G(t) };
}
const node = (g: TrafficGraph): number => { for (let n = 0; n < g.nodeCount; n++) if (g.nodeId[n] === C) return n; return -1; };
/** Arc entrant (vers le centre) et sortant (depuis le centre) d'un tronçon. */
const inArc = (g: TrafficGraph, e: number): number => { const i = g.edgeIndex(e); return g.edgeB[i] === node(g) ? i * 2 : i * 2 + 1; };
const outArc = (g: TrafficGraph, e: number): number => inArc(g, e) ^ 1;

/** Fait rouler un véhicule de `from` vers `to` ; renvoie sa vitesse minimale sur la voie d'approche. */
function drive(t: TrafficSystem, g: TrafficGraph, from: number, to: number, steps = 400): { minV: number; crossed: boolean } {
  const v = t.spawnVehicle(inArc(g, from), 0, 60, outArc(g, to), 100, 0, 0, 10);
  assert.ok(v >= 0);
  t.vDes[v] = 12;
  let minV = Infinity, crossed = false;
  const startLink = t.link[v]!;
  for (let k = 0; k < steps && t.alive[v]; k++) {
    t.step(0.1, 12);
    if (!t.alive[v]) break;
    if (t.link[v] === startLink) minV = Math.min(minV, t.v[v]!); else crossed = true;
  }
  return { minV, crossed };
}

test('carrefour « stop » : arrêt complet à la ligne même sans aucun autre véhicule', () => {
  const a = cross('stop');
  assert.equal(a.g.nodeStop[node(a.g)], 1);
  const r = drive(a.t, a.g, 1, 2);
  assert.ok(r.crossed, 'le véhicule finit par traverser');
  assert.ok(r.minV < 0.3, `arrêt complet (vitesse minimale ${r.minV.toFixed(2)} m/s)`);
  // Sans réglage (priorité à droite automatique), un véhicule seul ne s'arrête pas.
  const b = cross(null);
  const q = drive(b.t, b.g, 1, 2);
  assert.ok(q.crossed && q.minV > 2, `passage sans arrêt (${q.minV.toFixed(2)} m/s)`);
});

test('carrefour « priorité » : axe principal prioritaire (cédez-le-passage sur les autres branches)', () => {
  const { t, g } = cross('priority');
  const n = node(g);
  assert.equal(g.nodeControl[n], Control.Yield);
  const prio: number[] = [];
  for (let a = g.nodeArmStart[n]!; a < g.nodeArmStart[n + 1]!; a++) if (g.armRankPrio[a]) prio.push(a);
  assert.equal(prio.length, 2, 'deux bras prioritaires');
  let da = Math.abs(g.armAngle[prio[0]!]! - g.armAngle[prio[1]!]!) % (Math.PI * 2);
  if (da > Math.PI) da = Math.PI * 2 - da;
  assert.ok(da > Math.PI * 0.9, 'en face l’un de l’autre (axe traversant)');
  // Panneaux « cédez le passage » sur les deux branches secondaires.
  assert.equal(t.signLayout().length / 5, 2);
  // Un véhicule de l'axe principal passe sans s'arrêter même si des véhicules arrivent des deux côtés.
  const mainEdge = [1, 2, 3, 4].find((e) => { const arc = inArc(g, e); for (let a = g.nodeArmStart[n]!; a < g.nodeArmStart[n + 1]!; a++) if (g.armArc[a] === arc) return g.armRankPrio[a] === 1; return false; })!;
  const opp = (e: number): number => ({ 1: 2, 2: 1, 3: 4, 4: 3 } as Record<number, number>)[e]!;
  const opposite = opp(mainEdge);
  // Véhicules des deux branches secondaires, tout droit, même distance au carrefour.
  for (const e of [1, 2, 3, 4].filter((x) => x !== mainEdge && x !== opposite)) { const u = t.spawnVehicle(inArc(g, e), 0, 60, outArc(g, opp(e)), 100, 0, 0, 10); t.vDes[u] = 12; }
  const r = drive(t, g, mainEdge, opposite);
  assert.ok(r.crossed);
  assert.ok(r.minV > 2, `axe principal sans arrêt (${r.minV.toFixed(2)} m/s)`);
});

test('axe principal : la paire en face de plus haut rang', () => {
  const arms = [{ angle: 0, rank: 0, lanes: 1 }, { angle: Math.PI / 2, rank: 1, lanes: 2 }, { angle: Math.PI, rank: 0, lanes: 1 }, { angle: -Math.PI / 2, rank: 1, lanes: 2 }];
  assert.deepEqual([...mainAxis(arms)].sort(), [1, 3]);
  assert.deepEqual([...mainAxis([{ angle: 0, rank: 0, lanes: 1 }, { angle: 1.2, rank: 2, lanes: 1 }])], [1], 'sans paire : bras de plus haut rang');
});
