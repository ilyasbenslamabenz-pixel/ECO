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
// Eau : sources sur les reliefs de bordure (premiers points secs à 25 % du bord), puis remplissage.
const placed: string[] = [];
for (const [fx, fz] of [[0.12, 0.12], [0.88, 0.15], [0.15, 0.85], [0.5, 0.1]] as const) {
  const x = t.originX + t.samplesX * t.spacing * fx, z = t.originZ + t.samplesZ * t.spacing * fz;
  const r2 = s.runExt('terrainEdit', { edit: { k: 'source', x, z, q: 50 } });
  placed.push(r2.ok ? `${Math.round(x)},${Math.round(z)}` : r2.error.message);
}
// Cuvette creusée (pinceau Abaisser, forme dure) dans la zone libre, puis source : remplissage sur la durée.
for (let i = 0; i < 6; i++) s.runExt('terrainEdit', { edit: { k: 'lower', x: zx + 400, z: zz + 200, r: 80, d: 10, s: 1 } as never });
const pit = s.runExt('terrainEdit', { edit: { k: 'source', x: zx + 400, z: zz + 200, q: 5 } });
placed.push(pit.ok ? 'cuvette' : pit.error.message);
const fill: number[] = [], hydroMs: number[] = [];
let n0 = s.hydro.computeCount;
for (let i = 0; i < 600; i++) {
  const a = performance.now(); s.tick(); fill.push(performance.now() - a); s.takeDelta();
  if (s.hydro.computeCount !== n0) { hydroMs.push(s.hydro.lastMs); n0 = s.hydro.computeCount; }
}
const steady: number[] = [];
for (let i = 0; i < 200; i++) { const a = performance.now(); s.tick(); steady.push(performance.now() - a); s.takeDelta(); }
const st = s.runExt('hydroState', {} as never);
console.log(JSON.stringify({
  buildings: s.buildings.count, roads: s.net.segCount, dabMs: { mean: mean(dab), max: round(Math.max(...dab)) }, tickMsBefore: mean(ticks),
  sources: placed, tickMsFilling: mean(fill), hydroComputeMs: { n: hydroMs.length, mean: mean(hydroMs), max: round(Math.max(0, ...hydroMs)) },
  tickMsAfter: mean(steady), steady: st.ok ? st.data.steady : null, edits: s.terrainEditList.length,
}));
