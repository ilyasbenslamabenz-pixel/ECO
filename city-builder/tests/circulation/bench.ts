/**
 * Banc de charge de la circulation : ≥ 2 000 véhicules réels (itinéraires A*, voies, carrefours, feux)
 * sur un réseau maillé, avec mesure du temps de simulation par pas (moyenne, médiane, p95, maximum).
 *
 *   npx tsx tests/circulation/bench.ts [--vehicles=2000] [--ticks=600] [--grid=14] [--json=chemin]
 *
 * Écrit `tests/e2e/out/perf/circulation-bench.json` au format demandé par docs/ROADMAP_PHASE2.md §5
 * (nombre d'entités, temps par tick moyen / p95, configuration matérielle exacte). Mesure PROCESSEUR
 * uniquement : aucun rendu, donc les chiffres sont représentatifs d'une machine réelle (contrairement
 * aux images par seconde mesurées sous SwiftShader).
 */
import { cpus, totalmem, platform, release, arch } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { TrafficSystem } from '../../src/sim/traffic/system';
import { grid, gridBuildings, vehicleCatalog } from '../vehicles/fixtures';

const arg = (name: string, def: number): number => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? Number(a.slice(name.length + 3)) : def;
};

export interface BenchResult {
  vehicles: number;
  ticks: number;
  edges: number;
  lanes: number;
  junctions: { signals: number; priority: number; yield: number };
  tickMs: { mean: number; median: number; p95: number; max: number };
  meanSpeedKmh: number;
  stopped: number;
  arrived: number;
  removedStuck: number;
  laneChanges: number;
  rerouted: number;
  routeQueries: number;
  congestedShare: number;
  minDistanceM: number;
  hardware: Record<string, unknown>;
}

/** Monte un réseau maillé peuplé et lance `ticks` pas à `vehicles` véhicules maintenus. */
export function runBench(vehicles: number, ticks: number, side: number, step = 110): BenchResult {
  const t = new TrafficSystem({ seed: 2026, maxVehicles: vehicles, demand: false });
  t.setCatalog(vehicleCatalog());
  // une avenue toutes les trois rues (carrefours à feux et voies multiples)
  t.setNetwork(grid(side, side, step, (_h, i) => (i % 3 === 0 ? 'avenue' : 'rue')));
  t.setBuildings(gridBuildings(side, side, step));
  t.step(0, 8); // construction du graphe et des accès

  const usages = ['prive', 'prive', 'prive', 'livraison', 'bus', 'fret', 'taxi'] as const;
  let tries = 0;
  while (t.actCount < vehicles && tries < vehicles * 60) {
    const a = Math.floor(Math.random() * t.accessCount), b = Math.floor(Math.random() * t.accessCount);
    t.spawnTrip(a, b, usages[tries % usages.length]!);
    if (++tries % 500 === 0) t.step(0.1, 8); // libère les voies d'accès
  }
  const atteint = t.actCount;

  const pose = new Float32Array(4 * (vehicles + 64));
  let minD = Infinity;
  const times: number[] = [];
  for (let k = 0; k < ticks; k++) {
    // maintien de la charge : on remplace les véhicules arrivés
    while (t.actCount < atteint * 0.95) {
      const a = Math.floor(Math.random() * t.accessCount), b = Math.floor(Math.random() * t.accessCount);
      if (t.spawnTrip(a, b, 'prive') < 0) break;
    }
    const t0 = performance.now();
    t.step(0.1, 8 + (k * 0.1) / 3600);
    times.push(performance.now() - t0);
    if (k % 25 === 0) {
      const n = t.actCount;
      for (let i = 0; i < n; i++) t.vehiclePose(t.act[i]!, pose, i * 4);
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const dx = pose[i * 4]! - pose[j * 4]!, dz = pose[i * 4 + 2]! - pose[j * 4 + 2]!;
          if (Math.abs(dx) > 8 || Math.abs(dz) > 8) continue;
          const d = Math.hypot(dx, dz);
          if (d < minD) minD = d;
        }
      }
    }
  }
  times.sort((a, b) => a - b);
  const q = (p: number): number => +(times[Math.min(times.length - 1, Math.floor(times.length * p))] ?? 0).toFixed(3);
  const g = (t as unknown as { graph: { edgeCount: number; laneCount: number } }).graph;
  const { congested, total } = t.congestedLength(2);
  const c = cpus();
  return {
    vehicles: atteint,
    ticks,
    edges: g.edgeCount,
    lanes: g.laneCount,
    junctions: { signals: t.stats.signals, priority: t.stats.priorityJunctions, yield: t.stats.yieldJunctions },
    tickMs: {
      mean: +(times.reduce((s, x) => s + x, 0) / Math.max(1, times.length)).toFixed(3),
      median: q(0.5), p95: q(0.95), max: +(times[times.length - 1] ?? 0).toFixed(3),
    },
    meanSpeedKmh: +t.stats.meanSpeedKmh.toFixed(2),
    stopped: t.stats.stopped,
    arrived: t.stats.arrived,
    removedStuck: t.stats.removedStuck,
    laneChanges: t.stats.laneChanges,
    rerouted: t.stats.rerouted,
    routeQueries: t.stats.routeQueries,
    congestedShare: +(total > 0 ? congested / total : 0).toFixed(3),
    minDistanceM: +(minD === Infinity ? 0 : minD).toFixed(2),
    hardware: {
      cpu: c[0]?.model ?? 'inconnu', cores: c.length, ramGo: +(totalmem() / 2 ** 30).toFixed(1),
      os: `${platform()} ${release()} ${arch()}`, node: process.version,
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const vehicles = arg('vehicles', 2000), ticks = arg('ticks', 600), side = arg('grid', 14);
  const r = runBench(vehicles, ticks, side);
  const out = process.argv.find((x) => x.startsWith('--json='))?.slice(7)
    ?? join(import.meta.dirname, '..', 'e2e', 'out', 'perf', 'circulation-bench.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify({ generatedAt: new Date().toISOString(), ...r }, null, 2)}\n`);
  console.log(`Véhicules ${r.vehicles} · réseau ${r.edges} tronçons / ${r.lanes} voies · carrefours ${r.junctions.signals} à feux, ${r.junctions.priority} prioritaires, ${r.junctions.yield} cédez-le-passage`);
  console.log(`Tick : moyenne ${r.tickMs.mean} ms · médiane ${r.tickMs.median} ms · p95 ${r.tickMs.p95} ms · max ${r.tickMs.max} ms (${r.ticks} pas de 0,1 s)`);
  console.log(`Trafic : ${r.meanSpeedKmh} km/h en moyenne, ${r.stopped} à l'arrêt, ${r.arrived} arrivés, ${r.removedStuck} retirés, ${r.laneChanges} changements de voie, ${r.rerouted} réacheminements`);
  console.log(`Réseau saturé : ${(r.congestedShare * 100).toFixed(1)} % · distance minimale entre véhicules ${r.minDistanceM} m`);
  console.log(`Matériel : ${JSON.stringify(r.hardware)}`);
  console.log(`-> ${out}`);
}
