/**
 * Ruisseau de débordement à la mesure du débit (src/sim/hydro/fill.ts, streamShape) : une source de 100 m³/s posée
 * sur une pente sans creux donne un cours d'eau large et profond (≈ 35 m × 1,9 m), plus un liseré d'une case
 * presque invisible. Sans débit connu : comportement d'origine (une case, STREAM_DEPTH).
 * Lancer : npx tsx --test tests/terrain/ruisseau-debit.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HydroSolver, STREAM_DEPTH, streamShape, type HydroGrid } from '../../src/sim/hydro/fill';
import { NO_WATER } from '../../src/sim/terrain/types';

/** Plan incliné vers l'est (−0,1 m par case), mer sur la dernière colonne. */
function slope(): HydroGrid {
  const W = 80, H = 41, n = W * H;
  const ground = new Float32Array(n), base = new Float32Array(n).fill(NO_WATER);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    ground[j * W + i] = 20 - 0.1 * i + 0.002 * Math.abs(j - 20); // léger creux au milieu : le ruisseau suit j = 20
    if (i === W - 1) { ground[j * W + i] = 5; base[j * W + i] = 6; } // mer : plus basse que le pied de la pente
  }
  return { samplesX: W, samplesZ: H, spacing: 8, ground, base, barrier: null, dug: null, dugMask: null };
}

const widthAt = (g: HydroGrid, water: Float32Array, i: number): number => {
  let n = 0;
  for (let j = 0; j < g.samplesZ; j++) { const k = j * g.samplesX + i; if (water[k] !== NO_WATER && water[k]! > g.ground[k]! + 0.05) n++; }
  return n;
};

test('géométrie hydraulique : largeur et profondeur croissent avec le débit', () => {
  const a = streamShape(1), b = streamShape(10), c = streamShape(100);
  assert.ok(a.width < b.width && b.width < c.width);
  assert.ok(Math.abs(c.width - 35) < 2, `100 m³/s : ${c.width.toFixed(1)} m de large`);
  assert.ok(Math.abs(c.depth - 1.87) < 0.1, `100 m³/s : ${c.depth.toFixed(2)} m de profondeur`);
  assert.equal(streamShape(0).depth, STREAM_DEPTH);
});

test('source de 100 m³/s sur une pente : cours d’eau de plusieurs cases jusqu’à la mer ; sans débit : une case', () => {
  const g = slope();
  const W = g.samplesX;
  const solver = new HydroSolver();
  const [wide] = solver.solve(g, [{ cell: 20 * W + 5, volume: Infinity, tag: 0, flow: 100 }]);
  const water = (solver as unknown as { water: Float32Array }).water.slice();
  assert.equal(wide!.status, 'sink');
  assert.equal(wide!.outlet, 'eau');
  assert.ok(widthAt(g, water, 40) >= 4, `largeur à mi-pente : ${widthAt(g, water, 40)} cases`);
  const k = 20 * W + 40;
  assert.ok(water[k]! - g.ground[k]! > 1.5, `profondeur au lit : ${(water[k]! - g.ground[k]!).toFixed(2)} m`);
  // Sans débit : comportement d'origine.
  const [thin] = solver.solve(g, [{ cell: 20 * W + 5, volume: Infinity, tag: 0 }]);
  const w2 = (solver as unknown as { water: Float32Array }).water;
  assert.equal(thin!.status, 'sink');
  assert.equal(widthAt(g, w2, 40), 1);
  assert.ok(Math.abs(w2[k]! - g.ground[k]! - STREAM_DEPTH) < 1e-4);
});
