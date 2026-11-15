/**
 * Économie vivante (docs/ECONOMIE_VIVANTE.md) : loyers dérivés de la valeur foncière, période de grâce puis pression
 * progressive, ménages en difficulté (déménagement vers moins cher, départ), entreprises déficitaires fermées avec
 * raison consultable, emplois des locaux vacants retirés, éducation (niveaux simplifiés, inadéquations), chômage par
 * quartier (secteurs), rapport exposé au client, ANCIENNE sauvegarde chargée avec des valeurs par défaut sensées.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../../src/sim/world';
import { validateSave } from '../../src/sim/save-format';
import type { DemographyReport } from '../../src/sim/demography';
import { CompanyStatus, DEFAULT_LIVING_TUNING, distressThreshold, dwellingRent, eduTier, householdSizeFactor, landValueIndex, marketFactor, rentSatisfaction } from '../../src/sim/economie/tuning';
import { buildStreet, buildTown, newTownSim, runDays, townCatalog } from '../sim/fixtures';

const report = (s: Simulation): DemographyReport => s.demography!.report(s.clock.totalMinutes, s.economy.taxRates.residential);
const reload = (s: Simulation, mutate?: (save: any) => void): Simulation => {
  const save = JSON.parse(JSON.stringify(s.toSave()));
  mutate?.(save);
  const c = new Simulation(); c.setCatalog(townCatalog());
  assert.equal(c.fromSave(save), null);
  return c;
};

/* ------------------------------ Formules ------------------------------ */

test('formules : valeur foncière, loyer, marché, seuil progressif, satisfaction, niveaux d\'éducation', () => {
  const t = { ...DEFAULT_LIVING_TUNING };
  // Services et équipements valorisent, la pollution déprécie ; bornes.
  assert.ok(landValueIndex(5, 2, 0, 0) > landValueIndex(0, 0, 0, 0));
  assert.ok(landValueIndex(0, 0, 4, 0) < landValueIndex(0, 0, 0, 0));
  assert.equal(landValueIndex(0, 0, 100, -1), 0.4);
  assert.equal(landValueIndex(5, 100, 0, 1), 1.6);
  // Loyer : proportionnel à la valeur foncière, plus cher aux niveaux supérieurs, marché tendu plus cher.
  assert.ok(dwellingRent(t, 1.2, 1, 1) > dwellingRent(t, 1, 1, 1));
  assert.ok(dwellingRent(t, 1, 3, 1) > dwellingRent(t, 1, 1, 1));
  assert.ok(marketFactor(t, 0) > 1 && marketFactor(t, 0.3) < 1 && marketFactor(t, 0.06) === 1);
  assert.ok(householdSizeFactor(4) > householdSizeFactor(1));
  // Seuil : très tolérant au début de la montée, part soutenable à pleine pression.
  assert.ok(distressThreshold(t, 0) > distressThreshold(t, 0.5) && distressThreshold(t, 1) === t.partSoutenable);
  assert.equal(rentSatisfaction(t, 0.9, 0), 0, 'aucun effet pendant la grâce');
  assert.ok(rentSatisfaction(t, 0.9, 1) < -10 && rentSatisfaction(t, 0.1, 1) > 0);
  assert.deepEqual([0, 1, 2, 3, 4].map(eduTier), [0, 0, 1, 1, 2]);
});

/* ------------------------------ Loyers, grâce, difficultés ------------------------------ */

test('loyers : calculés chaque jour ; période de grâce sans difficulté ; puis pression progressive et départs', () => {
  const s = newTownSim(); buildTown(s);
  const L = s.demography!.living;
  // Réglage sévère pour l'essai : tout ménage dépasse la part soutenable à pleine pression.
  L.tuning.partSoutenable = 0.01;
  L.tuning.joursAvantDemenagement = 4;
  L.tuning.joursAvantDepart = 8;
  runDays(s, 25, 10);
  let r = report(s);
  assert.ok(r.population > 50);
  assert.ok(r.living, 'rapport de l\'économie vivante');
  assert.ok(r.living!.rentAverage > 150 && r.living!.rentAverage < 1500, `loyer moyen ${r.living!.rentAverage}`);
  assert.equal(r.living!.pressure, 0, 'période de grâce');
  assert.equal(r.living!.householdsInDistress, 0, 'aucune difficulté pendant la grâce');
  assert.equal(r.satisfactionFactors.find((f) => f.key === 'loyer')!.delta, 0);
  const hh = s.demography!.households;
  for (let k = 0; k < hh.count; k++) assert.ok(hh.col.rent[k]! > 0, 'chaque ménage logé a un loyer');
  runDays(s, 50, 10); // jour 75 : pleine pression depuis 15 jours
  r = report(s);
  assert.equal(r.living!.pressure, 1);
  const departed = r.living!.month.departuresRent + r.living!.lastMonth.departuresRent + r.living!.month.relocations + r.living!.lastMonth.relocations;
  assert.ok(departed > 0, `ménages partis ou relogés : ${JSON.stringify([r.living!.month, r.living!.lastMonth])}`);
  assert.ok(r.satisfactionFactors.find((f) => f.key === 'loyer')!.delta < 0, 'coût du logement visible dans la satisfaction');
});

test('ménage en difficulté : relogé dans un logement libre moins cher qu\'il peut payer', () => {
  const s = newTownSim(); buildTown(s);
  runDays(s, 62, 10);
  const demo = s.demography!, L = demo.living;
  // Maison neuve, vide, sur une rue à part.
  const [cheap] = buildStreet(s, -160, -220, 0, ['maison']);
  const bi = s.buildings.indexOf(cheap!);
  assert.equal(s.buildings.residents[bi], 0);
  const now = s.clock.totalMinutes;
  for (let k = 0; k < demo.households.count; k++) demo.households.col.distressDays[k] = 30;
  L.tuning.partSoutenable = 0; // tous en difficulté…
  L.assess(now, -1);
  L.tuning.partSoutenable = 1; // …mais la maison neuve est abordable
  L.rentUnit[bi] = 1;          // et la moins chère de la ville
  const before = L.month.relocations;
  L.resolve(now);
  assert.ok(L.month.relocations >= before + 1, 'ménages relogés');
  assert.ok(s.buildings.residents[bi]! > 0, 'la maison neuve est occupée');
});

/* ------------------------------ Entreprises ------------------------------ */

test('entreprises : pertes durables -> fermeture (raison consultable), emplois retirés ; sauvegarde fidèle', () => {
  const s = newTownSim(); buildTown(s);
  const L = s.demography!.living;
  L.tuning.loyerParPoste = 1_000_000; // loyer intenable : toutes les entreprises perdent de l'argent
  runDays(s, 50, 10);
  assert.equal(report(s).living!.companiesClosed, 0, 'jeunes entreprises et période de grâce : aucune fermeture');
  runDays(s, 110, 10); // jour 160
  const r = report(s);
  const living = r.living!;
  assert.ok(living.companiesClosed >= 1, `fermées : ${living.companiesClosed}`);
  assert.ok(living.closureReasons.some((x) => x.key === 'loyer'), JSON.stringify(living.closureReasons));
  assert.ok(living.recentClosures.length >= 1 && living.recentClosures[0]!.reason === 'Loyer trop élevé');
  assert.ok(living.companiesInDifficulty >= 1, 'les autres sont en difficulté');
  // Local vacant : plus d'employés, emplois non offerts, fiche du bâtiment explicite.
  const cc = s.demography!.companies.col;
  let closedId = -1;
  for (let k = 0; k < s.demography!.companies.count; k++) if (cc.status[k] === CompanyStatus.Closed) { closedId = cc.id[k]!; break; }
  assert.ok(closedId > 0);
  const bi = s.buildings.indexOf(closedId);
  assert.equal(s.buildings.workers[bi], 0, 'employés licenciés');
  const info = s.demography!.inspectBuilding(closedId, s.clock.totalMinutes)!;
  assert.equal(info.company!.status, 'closed');
  assert.equal(info.company!.reason, 'Loyer trop élevé');
  const jobsOpen = r.jobsTotal;
  const capacity = (() => { let n = 0; for (let i = 0; i < s.buildings.count; i++) n += s.catalog!.assets[s.buildings.assetIndex[i]!]!.capacity.jobs; return n; })();
  assert.ok(jobsOpen < capacity, `emplois offerts ${jobsOpen} < capacité ${capacity}`);
  // Sauvegarde : état, raison, journal des fermetures ; même suite après rechargement (mêmes réglages).
  const c = reload(s);
  c.demography!.living.tuning.loyerParPoste = 1_000_000;
  assert.ok(c.demography!.living.closed.has(closedId), 'local vacant reconnu au chargement');
  assert.equal(c.demography!.inspectBuilding(closedId, c.clock.totalMinutes)!.company!.reason, 'Loyer trop élevé');
  assert.equal(c.demography!.living.closures.length, s.demography!.living.closures.length);
  runDays(s, 3, 10); runDays(c, 3, 10);
  assert.equal(c.demography!.population, s.demography!.population);
  assert.equal(c.economy.money, s.economy.money);
});

test('rentabilité : le loyer des locaux et la qualification entrent dans les comptes', () => {
  const s = newTownSim(); buildTown(s);
  runDays(s, 31, 10);
  const cc = s.demography!.companies.col;
  let seen = 0;
  for (let k = 0; k < s.demography!.companies.count; k++) {
    if (cc.sector[k] === 4) continue;
    assert.ok(cc.rent[k]! > 0, 'loyer du local');
    if (cc.revenue[k]! > 0) { assert.ok(cc.profit[k]! < cc.revenue[k]! - cc.rent[k]!, 'bénéfice net du loyer'); seen++; }
  }
  assert.ok(seen > 0);
  const r = report(s).living!;
  // Éducation : adultes par niveau simplifié = adultes du rapport ; emplois qualifiés (bureaux, services publics).
  assert.equal(r.education.adults.reduce((a, b) => a + b, 0), report(s).education.reduce((a, b) => a + b, 0));
  assert.ok(r.education.jobs[1]! >= 60, `emplois exigeant le secondaire : ${r.education.jobs[1]}`);
  assert.ok(r.education.underqualified >= 0 && r.education.mismatchShare >= 0 && r.education.mismatchShare <= 1);
});

/* ------------------------------ Quartiers, rapport, sauvegardes ------------------------------ */

test('chômage par quartier : îlots de 500 m, ou secteurs du joueur', () => {
  const s = newTownSim(); buildTown(s);
  runDays(s, 3, 10);
  let r = report(s).living!;
  assert.ok(r.districts.length >= 1 && r.districts.every((d) => d.name.startsWith('Îlot ')), JSON.stringify(r.districts));
  assert.equal(r.districts.reduce((a, d) => a + d.population, 0), s.demography!.population);
  const st = s.buildings;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < st.count; i++) { x0 = Math.min(x0, st.x[i]!); z0 = Math.min(z0, st.z[i]!); x1 = Math.max(x1, st.x[i]!); z1 = Math.max(z1, st.z[i]!); }
  assert.ok((s.plugins.command('secteurs', 'create', { name: 'Centre', x0: x0 - 20, z0: z0 - 20, x1: x1 + 20, z1: z1 + 20 }) as { ok: boolean }).ok);
  runDays(s, 1, 10);
  r = report(s).living!;
  assert.deepEqual(r.districts.map((d) => d.name), ['Centre']);
  assert.ok(r.districts[0]!.rate >= 0 && r.districts[0]!.rate <= 1);
  // Chemin exposé au client (getReport).
  assert.ok(s.report(false).demography.living);
});

test('ancienne sauvegarde (sans économie vivante) : chargée, valeurs par défaut sensées, la partie continue', () => {
  const s = newTownSim(); buildTown(s);
  runDays(s, 6, 10);
  const strip = (save: any): void => {
    const pop = save.population;
    for (const k of ['rent', 'distressDays']) delete pop.households[k];
    for (const k of ['rent', 'tax', 'customers', 'lossMonths', 'status', 'reason', 'closedAt']) delete pop.companies[k];
    delete pop.living;
  };
  const save = JSON.parse(JSON.stringify(s.toSave()));
  strip(save);
  assert.equal(save.population.households.rent, undefined);
  const v = validateSave(save);
  assert.ok(v.ok, v.ok ? '' : v.message);
  const c = reload(s, strip);
  const demo = c.demography!;
  assert.equal(demo.population, s.demography!.population, 'population conservée');
  for (let k = 0; k < demo.companies.count; k++) assert.equal(demo.companies.col.status[k], CompanyStatus.Active, 'entreprises en activité');
  for (let k = 0; k < demo.households.count; k++) assert.equal(demo.households.col.distressDays[k], 0);
  assert.equal(demo.living.closed.size, 0);
  assert.deepEqual(demo.living.month, { relocations: 0, departuresRent: 0, closures: 0, reopenings: 0, graduates: 0 });
  runDays(c, 2, 10);
  const r = report(c);
  assert.ok(r.living && r.living.rentAverage > 0, 'loyers recalculés dès le premier jour');
  assert.ok(r.population >= s.demography!.population * 0.95, 'la partie continue normalement');
  // Une colonne obligatoire manquante reste refusée (la tolérance ne vaut que pour les colonnes nouvelles).
  const bad = JSON.parse(JSON.stringify(s.toSave()));
  delete bad.population.households.size;
  assert.equal(validateSave(bad).ok, false);
});
