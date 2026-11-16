/**
 * Graphe de circulation incrémental (docs/CIRCULATION.md §10) : après une série d'éditions aléatoires du réseau
 * (impasses, traversées d'îlot avec découpes, suppressions, mises à niveau, inversion de sens, giratoires, réglages de
 * carrefour, viaducs), le graphe reconstruit par le système de circulation — conversion et carrefours repris des
 * calculs précédents — est identique, tableau par tableau, au graphe recalculé entièrement sans aucune mémoire.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../../src/sim/world';
import { TrafficGraph, type JunctionMode, type TrafficNetworkInput } from '../../src/sim/traffic/network';
import { inputFromRoadNetwork } from '../../src/sim/traffic/adapters';
import { TrafficSystem } from '../../src/sim/traffic/system';
import { townCatalog } from '../sim/fixtures';

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function reliefSim(seed: number): Simulation {
  const s = new Simulation();
  s.setCatalog(townCatalog());
  s.newGame({ seed, mapChunks: 4, startMoney: 1e10, cityName: 'Incrémental', terrain: { hydrology: 'aucune', rivers: 0, relief: 0.5 } });
  return s;
}

/** Graphe recalculé de zéro : conversion sans mémoire, réglages des carrefours, aucun cache de carrefours. */
function fullGraph(s: Simulation): TrafficGraph {
  const input = inputFromRoadNetwork(s.net);
  const modes = s.traffic.junctionModes;
  const withModes: TrafficNetworkInput = { ...input, nodes: input.nodes.map((n) => (modes.has(n.id) ? { ...n, control: modes.get(n.id) } : n)) };
  return new TrafficGraph(withModes);
}

/** Différences entre deux graphes (tous les tableaux et compteurs publics), au plus quelques-unes. */
function diff(a: TrafficGraph, b: TrafficGraph): string[] {
  const out: string[] = [];
  const ra = a as unknown as Record<string, unknown>, rb = b as unknown as Record<string, unknown>;
  for (const k of Object.keys(ra)) {
    if (k === 'nodesComputed' || k === 'nodesReused') continue;
    const x = ra[k], y = rb[k];
    if (ArrayBuffer.isView(x)) {
      const X = x as unknown as ArrayLike<number>, Y = y as unknown as ArrayLike<number>;
      if (X.length !== Y.length) { out.push(`${k} : longueur ${X.length} ≠ ${Y.length}`); continue; }
      for (let i = 0; i < X.length; i++) if (!(X[i] === Y[i] || (Number.isNaN(X[i]) && Number.isNaN(Y[i])))) { out.push(`${k}[${i}] : ${X[i]} ≠ ${Y[i]}`); break; }
    } else if (typeof x === 'number' && x !== y) out.push(`${k} : ${x} ≠ ${y}`);
    if (out.length > 5) break;
  }
  return out;
}

const KINDS = ['street', 'avenue', 'boulevard', 'oneway'] as const;
const MODES: (JunctionMode | null)[] = ['signal', 'stop', 'priority', null];

for (const seed of [3, 17, 42, 1234]) {
  test(`graphe incrémental identique au graphe recalculé entièrement (graine ${seed})`, () => {
    const s = reliefSim(seed);
    const r = rng(seed);
    const S = 90;
    for (let k = -3; k <= 3; k++) {
      s.buildRoad({ type: 'street', kind: k === 0 ? 'avenue' : 'street', points: [-300, k * S, 300, k * S] });
      s.buildRoad({ type: 'street', kind: k === -2 ? 'boulevard' : 'street', points: [k * S, -300, k * S, 300] });
    }
    s.traffic.ensureNetwork();
    let done = 0, reusedTotal = 0, computedTotal = 0;
    for (let i = 0; i < 30; i++) {
      const ids = s.net.segmentIds();
      const id = ids[Math.floor(r() * ids.length)]!;
      const c = s.net.curve(id);
      const mx = (c[0]! + c[6]!) / 2, mz = (c[1]! + c[7]!) / 2;
      const horiz = Math.abs(c[6]! - c[0]!) > Math.abs(c[7]! - c[1]!);
      const side = r() < 0.5 ? -1 : 1;
      const x = r();
      let ok = false;
      if (x < 0.2) ok = s.buildRoad({ type: 'street', kind: 'street', points: horiz ? [mx, mz, mx, mz + side * 35] : [mx, mz, mx + side * 35, mz] }).ok;
      else if (x < 0.35) ok = s.buildRoad({ type: 'street', kind: KINDS[Math.floor(r() * 3)]!, points: horiz ? [mx, mz, mx, mz + side * S] : [mx, mz, mx + side * S, mz] }).ok;
      else if (x < 0.5) ok = s.removeRoad({ edgeId: id }).ok;
      else if (x < 0.65) ok = s.upgradeRoad({ edgeId: id, kind: KINDS[Math.floor(r() * KINDS.length)]! }).ok;
      else if (x < 0.72) ok = s.upgradeRoad({ edgeId: id, reverse: true }).ok;
      else if (x < 0.8) ok = s.runExt('buildRoundabout', { x: Math.round(mx / S) * S, z: Math.round(mz / S) * S, size: 'small' }).ok;
      else if (x < 0.9) {
        const nodes = s.net.nodeIds().filter((n) => s.net.incident(n).length >= 3);
        if (nodes.length) { s.traffic.setJunctionMode(nodes[Math.floor(r() * nodes.length)]!, MODES[Math.floor(r() * MODES.length)]!); ok = true; }
      } else ok = s.buildRoad({ type: 'street', kind: 'street', points: [mx - 60, mz + side * 40, mx + 60, mz + side * 45], elevation: 8 }).ok;
      if (!ok) continue;
      done++;
      s.tick(); // reconstruction par le système (conversion et carrefours mémorisés)
      s.takeDelta();
      const g = s.traffic.graph!;
      reusedTotal += g.nodesReused; computedTotal += g.nodesComputed;
      const d = diff(g, fullGraph(s));
      assert.deepEqual(d, [], `édition ${i} (tirage ${x.toFixed(2)}) : ${d.join(' ; ')}`);
    }
    assert.ok(done >= 15, `éditions réussies : ${done}`);
    // incrémental pour de vrai : l'essentiel des carrefours est repris d'une reconstruction à l'autre
    assert.ok(reusedTotal > computedTotal * 3, `repris ${reusedTotal}, recalculés ${computedTotal}`);
  });
}

test('accès des bâtiments repris hors des zones modifiées : identiques à un calcul complet', () => {
  const s = reliefSim(5);
  const S = 90;
  for (let k = -3; k <= 3; k++) {
    s.buildRoad({ type: 'street', kind: 'street', points: [-300, k * S, 300, k * S] });
    s.buildRoad({ type: 'street', kind: 'street', points: [k * S, -300, k * S, 300] });
  }
  // bâtiments fictifs au milieu des tronçons (aucune égalité de distance entre deux tronçons)
  const buildings = [];
  for (let k = -3; k < 3; k++) for (let c = -3; c < 3; c++) buildings.push({ id: buildings.length + 1, assetId: 'immeuble', category: 'apartment_mid', residents: 60, jobs: 10, x: c * S + S / 2 + 3, z: k * S + 14 });
  const inc = new TrafficSystem({ demand: false });
  const net = (): TrafficNetworkInput => inputFromRoadNetwork(s.net);
  inc.setNetwork(net());
  inc.setBuildings(buildings);
  inc.step(0.1, 8);
  const r = rng(9);
  let kept = 0;
  for (let i = 0; i < 12; i++) {
    const ids = s.net.segmentIds();
    const id = ids[Math.floor(r() * ids.length)]!;
    if (r() < 0.5) s.removeRoad({ edgeId: id });
    else { const c = s.net.curve(id); s.buildRoad({ type: 'street', kind: 'street', points: [(c[0]! + c[6]!) / 2, (c[1]! + c[7]!) / 2, (c[0]! + c[6]!) / 2 + 20, (c[1]! + c[7]!) / 2 + 25] }); }
    inc.setNetwork(net());
    inc.step(0.1, 8);
    kept += inc.lastRebuild.accessKept;
    const full = new TrafficSystem({ demand: false });
    full.setNetwork(net());
    full.setBuildings(buildings);
    full.step(0.1, 8);
    const A = (sys: TrafficSystem): string => JSON.stringify((sys as unknown as { access: { b: { id: number }; arc: number; sLane: number; edge: number }[] }).access.map((a) => [a.b.id, a.arc, a.sLane, a.edge]));
    assert.equal(A(inc), A(full), `édition ${i}`);
  }
  assert.ok(kept > 0, 'projections reprises');
});
