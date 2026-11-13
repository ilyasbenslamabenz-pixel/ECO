/** Hydrographie : sens d'écoulement par priority-flood, accumulation, routage des charges vers l'aval. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RiverRouter } from '../../src/sim/water-network/river';

/** Rivière en Y sur une grille 20 × 12 : affluent nord (colonne 5) rejoignant un cours principal (ligne 6) qui descend vers l'est. */
function yRiver(): RiverRouter {
  const cols = 20, rows = 12;
  const wet = new Uint8Array(cols * rows), elev = new Float32Array(cols * rows).fill(50);
  for (let i = 0; i < cols; i++) { wet[6 * cols + i] = 1; elev[6 * cols + i] = 20 - i * 0.5; }
  for (let j = 0; j < 6; j++) { wet[j * cols + 5] = 1; elev[j * cols + 5] = 30 - j; }
  // creux local dans le lit (ne doit pas créer de cuvette sans issue)
  elev[6 * cols + 12] = 5;
  return RiverRouter.fromMask({ originX: 0, originZ: 0, cellSize: 32, cols, rows }, wet, elev);
}

test('sens d\'écoulement : tout s\'écoule vers l\'exutoire aval (est), sans cycle', () => {
  const r = yRiver();
  const cols = 20;
  assert.equal(r.wetCount, 20 + 6);
  const outlet = 6 * cols + 19;
  for (const k of r.cells()) {
    const path = r.pathFrom(k, 100);
    assert.ok(path.length < 100, 'pas de cycle');
    assert.equal(path[path.length - 1], outlet, `cellule ${k} -> exutoire`);
  }
  assert.equal(r.down[6 * cols + 3], 6 * cols + 4, 'le cours principal descend vers l\'est');
  assert.equal(r.accum[outlet], 26);
  assert.ok(r.accum[6 * cols + 6]! > r.accum[6 * cols + 4]!, 'l\'affluent s\'ajoute au débit');
});

test('routage : pollution à l\'exutoire du rejet, décroissante vers l\'aval, nulle en amont ; dilution par l\'affluent', () => {
  const r = yRiver();
  const cols = 20;
  const em = new Float32Array(cols * 12);
  em[6 * cols + 2] = 10; // rejet en amont de la confluence
  const out = new Float32Array(cols * 12);
  r.route(em, out);
  assert.equal(out[6 * cols + 1], 0, 'amont du rejet propre');
  assert.equal(out[2 * cols + 5], 0, 'affluent propre');
  let prev = Infinity;
  for (let i = 2; i < 20; i++) {
    const v = out[6 * cols + i]!;
    assert.ok(v > 0 && v <= prev + 1e-6, `décroissant vers l'aval (colonne ${i} : ${v})`);
    prev = v;
  }
  assert.ok(out[6 * cols + 5]! - out[6 * cols + 6]! > out[6 * cols + 7]! - out[6 * cols + 8]!, 'chute plus forte à la confluence (dilution)');
  // Linéarité de la charge : double rejet -> pollution plus forte partout en aval.
  em[6 * cols + 2] = 20;
  const out2 = new Float32Array(cols * 12);
  r.route(em, out2);
  for (let i = 2; i < 20; i++) assert.ok(out2[6 * cols + i]! > out[6 * cols + i]!);
});

test('eau la plus proche et distance', () => {
  const r = yRiver();
  const k = r.nearestWet(5 * 32 + 16, 9 * 32 + 16, 200);
  assert.equal(k, 6 * 20 + 5);
  assert.ok(Math.abs(r.distanceToWater(5 * 32 + 16, 9 * 32 + 16, 200) - (9 * 32 + 16 - 7 * 32)) < 1e-6);
  assert.equal(r.nearestWet(16, 11 * 32 + 16, 40), -1);
});
