/**
 * Valeur d'une carte d'information au survol (src/shared/protocol-ext/cartes.ts, `carteReadout`, `carteValueAt`) :
 * la valeur 0..100 d'une cellule est rendue dans l'unité du jeu (inverse exact des échelles `carteScale`).
 * Lancer : npx tsx --test tests/unit/cartes-survol.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CARTE_KINDS, CARTE_NO_DATA, carteReadout, carteScale, carteValueAt, clampCarte, type CarteLayer } from '../../src/shared/protocol-ext/cartes';

test('lecture : inverse des échelles de la carte', () => {
  assert.match(carteReadout('chomage', clampCarte(carteScale.chomage(0.12))), /12 %/);
  assert.match(carteReadout('chomage', 100), /25 % et plus/);
  assert.match(carteReadout('dechets', clampCarte(carteScale.dechets(0.64))), /64 %/);
  assert.match(carteReadout('satisfaction', clampCarte(carteScale.satisfaction(52))), /52 \/ 100/);
  assert.match(carteReadout('foncier', clampCarte(carteScale.foncier(1))), /indice 1,0/);
  assert.match(carteReadout('education', clampCarte(carteScale.education(3))), /3,0 \/ 4 \(baccalauréat\)/);
  assert.match(carteReadout('ecoles', 100), /aucune école/);
  assert.match(carteReadout('ecoles', clampCarte(carteScale.ecoles(0.7))), /qualité 70 %/);
  for (const k of CARTE_KINDS) {
    assert.match(carteReadout(k, CARTE_NO_DATA), /aucun bâtiment/);
    for (const v of [0, 50, 100]) assert.ok(carteReadout(k, v).length > 5);
  }
});

test('cellule sous un point monde', () => {
  const l: CarteLayer = { kind: 'bruit', originX: -64, originZ: -64, cellSize: 32, cols: 4, rows: 4, values: new Uint8Array(16).fill(CARTE_NO_DATA), buildings: 1, mean: 40, high: 0, day: 0 };
  l.values[2 * 4 + 3] = 40; // colonne 3, rangée 2 : x ∈ [32, 64[, z ∈ [0, 32[
  assert.equal(carteValueAt(l, 40, 10), 40);
  assert.equal(carteValueAt(l, 0, 0), CARTE_NO_DATA);
  assert.equal(carteValueAt(l, 70, 0), null);
});
