/**
 * Coût de la terraformation et de l'eau sur la ville de charge (Node) : passes de pinceau, puis source d'eau et
 * barrage, pas de simulation pendant le remplissage. Imprime une ligne JSON.
 *   npx tsx tests/perf/terraform-bench.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Simulation } from '../../src/sim/world';
import type { AssetCatalog } from '../../src/shared/catalog';

const root = join(import.meta.dirname, '..', '..');
const catalog = JSON.parse(readFileSync(join(root, 'assets/catalog.json'), 'utf8')) as AssetCatalog;
const s = new Simulation();
s.setCatalog(catalog);
s.newGame({ seed: 7, mapChunks: 10, startMoney: 4e9, cityName: 'Charge', startHour: 11, terrain: { hydrology: 'lac', rivers: 0.2 } });
const r = s.runExt('buildCity', { preset: 'stress', maxBuildings: 500, vehicles: 1000 });
if (!r.ok) throw new Error(r.error.message);
const round = (v: number): number => Math.round(v * 100) / 100;
const mean = (a: number[]): number => round(a.reduce((x, y) => x + y, 0) / Math.max(1, a.length));
const t = s.terrain!;
// Zone libre loin du centre (pas de bâtiment) : bande au nord.
const zx = t.originX + t.samplesX * t.spacing * 0.2, zz = t.originZ + t.samplesZ * t.spacing * 0.2;
const dab: number[] = [];
for (let i = 0; i < 40; i++) {
  const a = performance.now();
  s.runExt('terrainEdit', { edit: { k: i % 2 ? 'lower' : 'raise', x: zx + i * 6, z: zz, r: 30, d: 2 } as never });
  dab.push(performance.now() - a);
  s.takeDelta();
}
const ticks: number[] = [];
for (let i = 0; i < 200; i++) { const a = performance.now(); s.tick(); ticks.push(performance.now() - a); s.takeDelta(); }
console.log(JSON.stringify({ buildings: s.buildings.count, roads: s.net.segCount, dabMs: { mean: mean(dab), max: round(Math.max(...dab)) }, tickMs: mean(ticks), edits: s.terrainEditList.length }));
