/** Restrictions d'eau : réglage du service et politique « Restrictions d'eau » ne se cumulent pas (−20 %, pas −36 %). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waterRestrictionFactor } from '../../src/sim/water-network/system';
import { POLICIES } from '../../src/shared/governance';

test('restrictions d’eau appliquées une seule fois', () => {
  const pol = POLICIES.find((p) => p.id === 'restrictions_eau')!.effect.waterDemandFactor!;
  assert.equal(waterRestrictionFactor(false, 1), 1);
  assert.equal(waterRestrictionFactor(true, 1), 0.8);
  assert.equal(waterRestrictionFactor(false, pol), pol);
  assert.equal(waterRestrictionFactor(true, pol), Math.min(0.8, pol), 'réglage + politique : une seule réduction');
  assert.equal(waterRestrictionFactor(true, NaN), 0.8);
});
