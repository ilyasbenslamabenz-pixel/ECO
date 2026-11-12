/** Mesure Node du test de charge (appelée par tests/e2e/stress.mjs) : imprime une ligne JSON. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Simulation } from '../../src/sim/world';
import type { AssetCatalog } from '../../src/shared/catalog';

const root = join(import.meta.dirname, '..', '..');
const catalog = JSON.parse(readFileSync(join(root, 'assets/catalog.json'), 'utf8')) as AssetCatalog;
const s = new Simulation();
s.setCatalog(catalog);
let t = performance.now();
s.newGame({ seed: 7, mapChunks: 10, startMoney: 4e9, cityName: 'Charge', startHour: 11, terrain: { hydrology: 'lac', rivers: 0.2 } });
const genMs = performance.now() - t;
t = performance.now();
const r = s.runExt('buildCity', { preset: 'stress', maxBuildings: 500, vehicles: 1000 });
if (!r.ok) throw new Error(r.error.message);
const buildMs = performance.now() - t;
const ticks: number[] = [];
let deltaMs = 0;
for (let i = 0; i < 600; i++) {
  const a = performance.now();
  s.tick();
  ticks.push(performance.now() - a);
  const b = performance.now();
  s.takeDelta();
  deltaMs += performance.now() - b;
}
ticks.sort((x, y) => x - y);
const round = (v: number): number => Math.round(v * 100) / 100;
const mem = process.memoryUsage();
console.log(JSON.stringify({
  buildings: s.buildings.count, distinct: r.data.distinctBuildings, roads: s.net.segCount, vehicles: r.data.vehicles, vehiclesAfter600: s.traffic.actCount,
  population: s.demography?.population ?? 0, generationMs: Math.round(genMs), buildCityMs: Math.round(buildMs),
  tick: { mean: round(ticks.reduce((a, b) => a + b, 0) / ticks.length), p95: round(ticks[Math.floor(ticks.length * 0.95)]!), max: round(ticks[ticks.length - 1]!) },
  takeDeltaMeanMs: round(deltaMs / 600), heapMB: Math.round(mem.heapUsed / 1048576),
}));
