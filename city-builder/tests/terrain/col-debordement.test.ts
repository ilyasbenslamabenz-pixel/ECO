/**
 * Col de débordement (src/sim/hydro/fill.ts, `spills`) : une cuvette fermée par des rives à 10 m, avec une échancrure
 * à 6 m sur un côté, se remplit jusqu'à 6 m et le solveur désigne la case juste au-delà de l'échancrure — le point
 * montré au joueur (repère rouge de l'outil Barrage) par où l'eau contourne l'ouvrage.
 * Lancer : npx tsx --test tests/terrain/col-debordement.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HydroSolver, type HydroGrid } from '../../src/sim/hydro/fill';
import { NO_WATER } from '../../src/sim/terrain/types';

test('cuvette avec échancrure : niveau au col, col désigné', () => {
  const W = 30, H = 30, n = W * H;
  const ground = new Float32Array(n).fill(0), base = new Float32Array(n).fill(NO_WATER);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const ring = (i === 10 || i === 20) && j >= 10 && j <= 20 || (j === 10 || j === 20) && i >= 10 && i <= 20;
    ground[j * W + i] = ring ? 10 : i > 10 && i < 20 && j > 10 && j < 20 ? 2 : 1;
  }
  ground[15 * W + 20] = 6; // échancrure à l'est
  const g: HydroGrid = { samplesX: W, samplesZ: H, spacing: 8, ground, base, barrier: null, dug: null, dugMask: null };
  const solver = new HydroSolver();
  const [r] = solver.solve(g, [{ cell: 15 * W + 15, volume: Infinity, tag: 0 }]);
  assert.equal(r!.status, 'sink');
  assert.ok(Math.abs(r!.level - 6) < 1e-3, `niveau ${r!.level}`);
  assert.equal(solver.spills.length >= 2, true);
  assert.ok(Math.abs(solver.spills[0]! - 6) < 1e-3);
  const k = solver.spills[1]!;
  const i = k % W, j = Math.floor(k / W);
  assert.ok(Math.abs(i - 20) <= 1 && Math.abs(j - 15) <= 1, `col désigné en (${i}, ${j}), attendu près de (20, 15)`);
});
