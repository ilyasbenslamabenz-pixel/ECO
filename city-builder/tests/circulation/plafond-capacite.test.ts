/**
 * Plafond de capacité du réseau (src/sim/traffic/system.ts, VEH_PER_LANE_KM) : le nombre de voitures simultanées suit
 * les km de voie, pas seulement la population (sinon la vague du matin bouchait tout le réseau, jour et nuit).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAPACITY_CEILING_MIN, TrafficSystem, VEH_PER_LANE_KM } from '../../src/sim/traffic/system';

test('plafond de capacité : proportionnel aux km de voie, avec un plancher, désactivable', () => {
  const t = new TrafficSystem({ seed: 1, demand: false });
  t.laneKm = 76.7;
  assert.equal(t.capacityCeiling, Math.round(76.7 * VEH_PER_LANE_KM));
  t.laneKm = 1;
  assert.equal(t.capacityCeiling, CAPACITY_CEILING_MIN, 'petite ville : plancher');
  t.laneKm = 150;
  assert.ok(t.capacityCeiling > Math.round(76.7 * VEH_PER_LANE_KM), 'plus de routes : plus de voitures');
  assert.ok(t.demandCeiling(8) <= t.capacityCeiling, 'le plafond de demande ne dépasse pas la capacité');
  const libre = new TrafficSystem({ seed: 1, demand: false, vehPerLaneKm: 0 });
  assert.equal(libre.capacityCeiling, Infinity);
});
