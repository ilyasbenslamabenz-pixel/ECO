/** Modèle physique du service de l'eau : fonctions pures. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aquiferYield, buildingDemand, epurationEfficiency, fundingCapacity, headLoss, HOURLY_PROFILE, hourlyFactor, potabilisationEfficiency,
  pressureBar, pressureFactor, rawQuality, satisfactionContribution, tariffDemandFactor, treatedQuality,
} from '../../src/sim/water-network/model';
import { DEFAULT_WATER_SETTINGS, facilityKindOf, WATER_FACILITIES } from '../../src/shared/water-network/types';
import { normalizeSettings } from '../../src/sim/water-network/system';

test('profil horaire : moyenne 1, pointes du matin et du soir, creux nocturne', () => {
  const mean = HOURLY_PROFILE.reduce((a, b) => a + b, 0) / 24;
  assert.ok(Math.abs(mean - 1) < 1e-9);
  assert.ok(hourlyFactor(7.5) > 1.4 && hourlyFactor(19.2) > 1.4);
  assert.ok(hourlyFactor(3) < 0.4);
  assert.equal(hourlyFactor(24 + 7), hourlyFactor(7));
});

test('consommation : habitants et emplois, tarif et restrictions réduisent la demande', () => {
  const s = DEFAULT_WATER_SETTINGS;
  const d = (r: number, w: number, cat = 'house') => buildingDemand(cat, r, w, 12, s) * 24 / hourlyFactor(12);
  assert.ok(Math.abs(d(10, 0) - (0.05 + 1.5)) < 1e-9, 'm³/jour : socle + 150 L/habitant');
  assert.ok(d(0, 10, 'industrial') > d(0, 10, 'commercial'));
  assert.ok(buildingDemand('house', 10, 0, 12, { tariff: 5, restrictions: false }) < buildingDemand('house', 10, 0, 12, s));
  assert.ok(Math.abs(buildingDemand('house', 10, 0, 12, { tariff: 2, restrictions: true }) / buildingDemand('house', 10, 0, 12, s) - 0.8) < 1e-9);
  assert.equal(tariffDemandFactor(2), 1);
  assert.ok(tariffDemandFactor(0) <= 1.15 && tariffDemandFactor(6) >= 0.7);
});

test('financement : capacité et rendements croissants, nuls sans financement', () => {
  assert.equal(fundingCapacity(0), 0);
  assert.equal(fundingCapacity(1), 1);
  assert.ok(fundingCapacity(1.5) > 1 && fundingCapacity(1.5) <= 1.15);
  assert.equal(epurationEfficiency(0), 0);
  assert.ok(Math.abs(epurationEfficiency(1) - 0.92) < 1e-9);
  assert.ok(epurationEfficiency(0.5) < epurationEfficiency(1) && epurationEfficiency(1.5) > epurationEfficiency(1));
  assert.ok(potabilisationEfficiency(0.4) < potabilisationEfficiency(1));
});

test('qualité : surface polluée < surface propre < forage ; potabilisation', () => {
  assert.ok(rawQuality('surface', 60) < rawQuality('surface', 0));
  assert.ok(rawQuality('surface', 0) < rawQuality('forage', 0));
  assert.ok(treatedQuality(0.4, 0.97) > 0.98);
  assert.ok(treatedQuality(0.4, 0) === 0.4);
});

test('pression : altitude et pertes de charge ; facteur de service', () => {
  assert.ok(Math.abs(pressureBar(132, 100, 0) - 32 / 10.2) < 1e-9);
  assert.ok(headLoss(1000, 1) > headLoss(1000, 0.2));
  assert.equal(pressureFactor(0.2), 0);
  assert.equal(pressureFactor(2), 1);
  assert.ok(pressureFactor(0.9) > 0 && pressureFactor(0.9) < 1);
});

test('nappe : meilleure près de l\'eau et en contrebas', () => {
  assert.ok(aquiferYield(50, 2) > aquiferYield(500, 2));
  assert.ok(aquiferYield(100, 0) > aquiferYield(100, 35));
  assert.equal(aquiferYield(Infinity, 10), 0.25);
});

test('satisfaction : non desservi et eau médiocre pénalisés', () => {
  const s = DEFAULT_WATER_SETTINGS;
  assert.equal(satisfactionContribution(1, 1, true, s), 0);
  assert.ok(satisfactionContribution(0, 0, true, s) <= -30);
  assert.ok(satisfactionContribution(1, 0.5, true, s) < -5);
  assert.ok(satisfactionContribution(1, 1, false, s) < 0);
});

test('réglages bornés ; installations reconnues par leur modèle', () => {
  const n = normalizeSettings(DEFAULT_WATER_SETTINGS, { fundingWater: 9, tariff: -2, restrictions: true, fundingSewer: Number.NaN });
  assert.deepEqual(n, { fundingWater: 1.5, fundingSewer: 1, tariff: 0, restrictions: true });
  for (const k of Object.keys(WATER_FACILITIES) as (keyof typeof WATER_FACILITIES)[]) assert.equal(facilityKindOf(WATER_FACILITIES[k].assetId), k);
  assert.equal(facilityKindOf('maison'), undefined);
});
