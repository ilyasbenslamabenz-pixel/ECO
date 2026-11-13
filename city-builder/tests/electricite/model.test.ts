/** Tests unitaires du modèle électrique (src/shared/power/model.ts) et de la section de sauvegarde. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  baseDemandKw, consumerClassOf, facilityKindOf, failureMultiplier, hourlyFactor, hydroShare, hydroSiteCheck, lineCost,
  nominalKwOf, solarShare, windPowerShare, windProfile,
} from '../../src/shared/power/model';
import { electriciteSaveSection, migrateElectricite } from '../../src/sim/save-sections/electricite';
import { emptyPowerState } from '../../src/sim/power/system';

test('éolien : courbe de puissance (démarrage 3 m/s, nominal 12 m/s, arrêt 25 m/s) ; profil de vent borné et déterministe', () => {
  assert.equal(windPowerShare(0), 0);
  assert.equal(windPowerShare(2.9), 0);
  assert.ok(windPowerShare(6) > 0 && windPowerShare(6) < windPowerShare(9));
  assert.equal(windPowerShare(12), 1);
  assert.equal(windPowerShare(20), 1);
  assert.equal(windPowerShare(26), 0);
  let min = Infinity, max = -Infinity;
  for (let t = 0; t < 30 * 1440; t += 60) { const w = windProfile(t, 42); min = Math.min(min, w); max = Math.max(max, w); }
  assert.ok(min >= 0 && max < 20 && max - min > 5, `vent ${min.toFixed(1)}..${max.toFixed(1)} m/s`);
  assert.equal(windProfile(1234, 7), windProfile(1234, 7));
});

test('solaire : nul la nuit, maximal vers 13 h, plus faible en hiver et par temps couvert', () => {
  assert.equal(solarShare(2, 'ete'), 0);
  assert.equal(solarShare(23, 'hiver'), 0);
  assert.ok(solarShare(13, 'ete') > 0.95);
  assert.ok(solarShare(13, 'hiver') < solarShare(13, 'ete'));
  assert.ok(solarShare(13, 'ete', 1) < solarShare(13, 'ete') * 0.3);
  assert.ok(solarShare(7, 'hiver') === 0 && solarShare(7, 'ete') > 0, 'jour plus court en hiver');
});

test('hydro : site au bord de l\'eau validé, plein champ et plein lac refusés ; débit saisonnier', () => {
  const river = (x: number) => x > 30 && x < 90;           // rivière à l'est du barrage
  assert.equal(hydroSiteCheck(0, 0, 16, river).ok, true);
  assert.equal(hydroSiteCheck(0, 0, 16, () => false).ok, false);
  assert.equal(hydroSiteCheck(0, 0, 16, () => true).ok, false);
  assert.ok(hydroShare('printemps') > hydroShare('ete'));
});

test('consommation : classes, courbes horaires, taille et occupation', () => {
  assert.equal(consumerClassOf({ category: 'public', tags: ['service:sante'] }), 'sante');
  assert.equal(consumerClassOf({ category: 'public', tags: ['service:education'] }), 'services');
  assert.equal(consumerClassOf({ category: 'house', tags: [] }), 'residentiel');
  assert.equal(consumerClassOf({ category: 'industrial', tags: [] }), 'industrie');
  assert.ok(hourlyFactor('residentiel', 19) > hourlyFactor('residentiel', 3) * 2.5, 'pointe du soir');
  assert.ok(hourlyFactor('commerce', 11) > hourlyFactor('commerce', 2) * 3, 'commerces ouverts le jour');
  assert.ok(Math.abs(hourlyFactor('sante', 3) - hourlyFactor('sante', 15)) < 0.4, 'hôpital presque constant');
  assert.ok(baseDemandKw('residentiel', 4, 50, 0, 0) > baseDemandKw('residentiel', 4, 5, 0, 0));
  assert.ok(baseDemandKw('industrie', 9, 0, 60, 60) > baseDemandKw('commerce', 9, 0, 60, 60));
});

test('installations du catalogue : type et puissance lus dans les étiquettes', () => {
  assert.equal(facilityKindOf({ tags: ['elec:centrale:eolien'] }), 'eolien');
  assert.equal(facilityKindOf({ tags: ['elec:poste'] }), 'poste');
  assert.equal(facilityKindOf({ tags: ['industrie'] }), undefined);
  assert.equal(nominalKwOf({ tags: ['elec:kw:1234'] }, 'thermique'), 1234);
  assert.equal(nominalKwOf({ tags: [] }, 'hydro'), 30_000);
});

test('fiabilité et coûts : sous-financer multiplie les pannes, lignes facturées au mètre', () => {
  assert.equal(failureMultiplier(1), 1);
  assert.equal(failureMultiplier(0.5), 4);
  assert.ok(failureMultiplier(1.5) < 0.5);
  assert.equal(failureMultiplier(0.01), failureMultiplier(0.25), 'borné');
  const c = lineCost(1000);
  assert.ok(c.cost > 0 && c.upkeepPerMonth > 0);
  assert.equal(lineCost(2000).cost, 2 * c.cost);
});

test('section de sauvegarde : vide, version future refusée, état complété, priorités invalides refusées', () => {
  assert.deepEqual(electriciteSaveSection.migrate(electriciteSaveSection.empty(), 1), {});
  assert.throws(() => migrateElectricite({}, 2), /plus récente/);
  assert.throws(() => migrateElectricite('x', 1), /objet attendu/);
  const st = emptyPowerState();
  const partial = { ...st } as Record<string, unknown>;
  delete partial.month;
  const back = migrateElectricite({ power: partial }, 1);
  assert.deepEqual(back.power?.month, st.month);
  assert.throws(() => migrateElectricite({ power: { ...st, settings: { funding: 1, priorities: ['sante'], rooftops: false } } }, 1), /priorités/);
});
