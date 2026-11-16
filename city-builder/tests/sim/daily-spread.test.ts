/**
 * Grandes villes (docs/SIMULATION.md) : passe quotidienne étalée sur plusieurs ticks et fusion des ménages identiques.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../../src/sim/world';
import { MINUTES_PER_DAY } from '../../src/sim/clock';
import { buildDistrict, buildStreet, newTownSim, runDays, townCatalog } from './fixtures';

/** Ville moyenne (≈ 4 700 logements) ; `spread` : passe étalée imposée (en 8 tranches) quelle que soit la taille. */
function city(seed: number, spread: boolean): Simulation {
  const s = newTownSim(5e9, seed);
  const demo = s.demography!;
  demo.aggregateThreshold = Infinity;
  if (spread) { demo.dailySpreadMinRows = 0; demo.dailySlices = 8; demo.dailyMinSliceRows = 1; }
  buildDistrict(s, 6);
  buildStreet(s, 60, -220, 220, ['bureaux', 'usine', 'bureaux', 'usine', 'boutique', 'bureaux', 'usine', 'boutique', 'bureaux', 'usine']);
  buildStreet(s, 100, -220, 220, ['usine', 'bureaux', 'usine', 'bureaux', 'ecole', 'hopital', 'commissariat', 'caserne', 'parc', 'boutique']);
  buildStreet(s, 140, -220, 220, ['bureaux', 'usine', 'bureaux', 'usine', 'bureaux', 'usine', 'ecole', 'boutique', 'boutique', 'boutique']);
  return s;
}

function observe(s: Simulation): Record<string, number> {
  const r = s.report().demography;
  const tb = s.economy.taxBase;
  return {
    population: r.population, households: r.households, employed: r.employed, laborForce: r.laborForce, pupils: r.pupils,
    happiness: r.happiness, unemploymentRate: r.unemploymentRate, taxRes: tb.residential, taxCom: tb.commercial, taxInd: tb.industrial, taxOff: tb.office,
  };
}

const mean = (xs: Record<string, number>[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const k of Object.keys(xs[0]!)) out[k] = xs.reduce((a, x) => a + x[k]!, 0) / xs.length;
  return out;
};

/** Données de la population sans les champs dérivés du temps réel. */
const popOf = (s: Simulation): string => JSON.stringify(s.demography!.toJSON());

test('passe quotidienne étalée : grandeurs dans les tolérances de la passe d’un seul tenant (3 graines, 30 jours)', () => {
  const seeds = [3, 17, 29];
  const run = (spread: boolean): Record<string, number> => mean(seeds.map((g) => { const s = city(g, spread); runDays(s, 30, 10); return observe(s); }));
  const one = run(false), spread = run(true);
  const msg = `d’un seul tenant ${JSON.stringify(one)}\nétalée ${JSON.stringify(spread)}`;
  if (process.env.SCALE_DEBUG) console.log(msg);
  const rel = (k: string): number => Math.abs(spread[k]! - one[k]!) / Math.max(1, Math.abs(one[k]!));
  assert.ok(one.population! > 2000, msg);
  // Mêmes tolérances que la simulation agrégée (tests/sim/scale.test.ts).
  for (const k of ['population', 'households', 'employed', 'laborForce', 'taxRes']) assert.ok(rel(k) <= 0.06, `${k} : écart ${(rel(k) * 100).toFixed(1)} %\n${msg}`);
  for (const k of ['taxCom', 'taxInd', 'taxOff']) assert.ok(rel(k) <= 0.12, `${k} : écart ${(rel(k) * 100).toFixed(1)} %\n${msg}`);
  assert.ok(Math.abs(spread.unemploymentRate! - one.unemploymentRate!) <= 0.15, msg);
  assert.ok(Math.abs(spread.happiness! - one.happiness!) <= 4, msg);
});

test('passe quotidienne étalée : une étape par tick, déterministe, sauvegarde en cours de journée cohérente', () => {
  const a = city(5, true), b = city(5, true);
  runDays(a, 3, 10); runDays(b, 3, 10);
  assert.equal(popOf(a), popOf(b), 'même graine, même suite');
  // Juste après minuit : la passe est en cours et avance d'une étape par tick.
  const demo = a.demography!;
  const toMidnight = MINUTES_PER_DAY - (a.clock.totalMinutes % MINUTES_PER_DAY);
  a.tick(toMidnight);
  assert.ok(demo.dailyPending, 'passe en cours après minuit');
  for (let i = 0; i < 5; i++) a.tick(1);
  assert.ok(demo.dailyPending, 'toujours en cours après 5 ticks (8 tranches par boucle)');
  // Sauvegarde : la passe est terminée avant l'écriture ; la partie rechargée se poursuit à l'identique.
  const save = JSON.parse(JSON.stringify(a.toSave()));
  assert.equal(demo.dailyPending, false);
  const t = new Simulation();
  t.setCatalog(townCatalog());
  assert.equal(t.fromSave(save), null);
  t.demography!.aggregateThreshold = Infinity;
  t.demography!.dailySpreadMinRows = 0; t.demography!.dailySlices = 8; t.demography!.dailyMinSliceRows = 1;
  assert.equal(popOf(t), popOf(a));
  runDays(a, 2, 1); runDays(t, 2, 1);
  assert.equal(popOf(t), popOf(a), 'même suite après rechargement');
  // Occupation = somme des poids, même au milieu d'une passe.
  const toM = MINUTES_PER_DAY - (a.clock.totalMinutes % MINUTES_PER_DAY);
  a.tick(toM); a.tick(1); a.tick(1);
  assert.ok(demo.dailyPending);
  let res = 0;
  for (let i = 0; i < a.buildings.count; i++) res += a.buildings.residents[i]!;
  assert.equal(res, demo.population);
});

test('passe quotidienne étalée : démolitions pendant la passe (ménages et bâtiments supprimés entre deux tranches)', () => {
  const s = city(23, true);
  s.demography!.forcedWeight = 3;
  runDays(s, 6, 10);
  const demo = s.demography!;
  s.tick(MINUTES_PER_DAY - (s.clock.totalMinutes % MINUTES_PER_DAY));
  assert.ok(demo.dailyPending);
  // Un logement habité démoli tous les 7 ticks jusqu'à la fin de la passe (toutes les étapes sont touchées).
  let n = 0, demolished = 0;
  const fails: string[] = [];
  while (demo.dailyPending && n < 2000) {
    s.tick(1); n++;
    if (n % 7 === 0) {
      for (let i = 0; i < s.buildings.count; i++) {
        if (s.buildings.residents[i]! > 0) { const r = s.demolish({ buildingId: s.buildings.id[i]! }); if (r.ok) demolished++; else fails.push(r.error.message); break; }
      }
    }
  }
  assert.equal(demo.dailyPending, false, `passe terminée en ${n} ticks`);
  assert.ok(demolished >= 3, `démolitions ${demolished} en ${n} ticks ; refus : ${fails.join(' | ')}`);
  let res = 0, wk = 0, emp = 0;
  for (let i = 0; i < s.buildings.count; i++) { res += s.buildings.residents[i]!; wk += s.buildings.workers[i]!; }
  const c = demo.citizens.col;
  for (let i = 0; i < demo.citizens.count; i++) if (c.job[i]! >= 0) emp += demo.weightOf(i);
  assert.equal(res, demo.population);
  assert.equal(wk, emp);
  for (let i = 0; i < demo.citizens.count; i++) assert.ok(s.buildings.indexOf(c.home[i]!) >= 0, 'logement existant');
  // Les étapes suivantes (et la sauvegarde) restent cohérentes.
  runDays(s, 2, 10);
  assert.equal(JSON.parse(JSON.stringify(s.toSave())).population.citizens.id.length, demo.citizens.count);
});

test('passe quotidienne : petite ville d’un seul tenant (seuil de lignes), comportement inchangé', () => {
  const s = city(7, false);
  runDays(s, 2, 10);
  const toMidnight = MINUTES_PER_DAY - (s.clock.totalMinutes % MINUTES_PER_DAY);
  s.tick(toMidnight);
  assert.equal(s.demography!.dailyPending, false);
});

/** Sommes qui doivent être conservées par une fusion. */
function totals(s: Simulation): Record<string, number> {
  const demo = s.demography!;
  const b = s.buildings;
  let residents = 0, workers = 0, employed = 0, income = 0;
  const perBuilding: number[] = [];
  for (let i = 0; i < b.count; i++) { residents += b.residents[i]!; workers += b.workers[i]!; perBuilding.push(b.residents[i]! * 1000 + b.workers[i]!); }
  const c = demo.citizens.col;
  for (let i = 0; i < demo.citizens.count; i++) { const w = demo.weightOf(i); if (c.job[i]! >= 0) employed += w; income += c.income[i]! * w; }
  const tb = demo.computeTaxBase(false, s.clock.totalMinutes);
  const r = s.report().demography;
  return {
    population: demo.population, households: demo.householdCount, residents, workers, employed, income, pupils: r.pupils, laborForce: r.laborForce,
    unemployed: r.unemployed, jobsFilled: r.jobsFilled, taxRes: tb.taxBase.residential, taxCom: tb.taxBase.commercial, taxInd: tb.taxBase.industrial,
    taxOff: tb.taxBase.office, serviceWorkers: tb.serviceWorkers, buildingsHash: perBuilding.reduce((a, v, k) => a + v * (k + 1), 0),
  };
}

test('fusion des ménages identiques : population, ménages, emplois, élèves et impôts conservés', () => {
  const s = city(11, false);
  runDays(s, 12, 10);
  const demo = s.demography!;
  const before = totals(s);
  const rows = demo.citizens.count, hhRows = demo.households.count;
  const merged = demo.mergeHouseholds(s.clock.totalMinutes, 4);
  const after = totals(s);
  if (process.env.SCALE_DEBUG) console.log(`fusion : ${merged} ménages, lignes ${rows} -> ${demo.citizens.count}`);
  assert.ok(merged > 0, 'au moins une fusion');
  assert.equal(demo.households.count, hhRows - merged);
  assert.ok(demo.citizens.count < rows, `lignes ${rows} -> ${demo.citizens.count}`);
  for (const k of Object.keys(before)) {
    const tol = k.startsWith('tax') || k === 'income' ? 1e-6 * Math.max(1, Math.abs(before[k]!)) : 0;
    assert.ok(Math.abs(after[k]! - before[k]!) <= tol, `${k} : ${before[k]} -> ${after[k]}`);
  }
  // Plafond de poids respecté ; poids des membres = poids du ménage.
  for (let k = 0; k < demo.households.count; k++) assert.ok(demo.hhWeightOf(k) <= 4);
  const c = demo.citizens.col;
  for (let i = 0; i < demo.citizens.count; i++) assert.equal(demo.weightOf(i), demo.hhWeightOf(demo.households.indexOf(c.household[i]!)));
  // Sauvegarde aller-retour.
  const save = JSON.parse(JSON.stringify(s.toSave()));
  const t = new Simulation();
  t.setCatalog(townCatalog());
  assert.equal(t.fromSave(save), null);
  assert.equal(t.demography!.population, demo.population);
  assert.equal(t.demography!.householdCount, demo.householdCount);
  // La ville continue (naissances, décès, emplois) avec des comptes cohérents.
  runDays(s, 5, 10);
  let res = 0, wk = 0, emp = 0;
  for (let i = 0; i < s.buildings.count; i++) { res += s.buildings.residents[i]!; wk += s.buildings.workers[i]!; }
  for (let i = 0; i < demo.citizens.count; i++) if (c.job[i]! >= 0) emp += demo.weightOf(i);
  assert.equal(res, demo.population);
  assert.equal(wk, emp);
});

test('fusion automatique dans la passe quotidienne au-delà du seuil d’agrégation (étalée par groupes de logements)', () => {
  const s = city(13, true);
  runDays(s, 10, 10);
  const demo = s.demography!;
  const rows = demo.citizens.count;
  // Seuil franchi : poids des nouveaux ménages 4, fusion des ménages existants par la passe quotidienne (une fois par
  // semaine).
  demo.aggregateThreshold = 1;
  demo.forcedWeight = 4;
  runDays(s, 8, 2);
  if (process.env.SCALE_DEBUG) console.log(`fusion automatique : ${demo.mergedHouseholds} ménages, lignes ${rows} -> ${demo.citizens.count}`);
  assert.ok(demo.mergedHouseholds > 0, 'fusions effectuées');
  assert.ok(demo.citizens.count < rows, `lignes ${rows} -> ${demo.citizens.count}`);
  let res = 0;
  for (let i = 0; i < s.buildings.count; i++) res += s.buildings.residents[i]!;
  assert.equal(res, demo.population);
});

test('passe quotidienne étalée avec lignes agrégées (découpes à l’embauche) : comptes cohérents, déterministe', () => {
  const run = (): Simulation => { const s = city(19, true); s.demography!.forcedWeight = 4; runDays(s, 8, 5); return s; };
  const a = run(), b = run();
  assert.equal(popOf(a), popOf(b));
  const demo = a.demography!;
  assert.ok(demo.aggregateInfo().aggregatedRows > 0);
  let res = 0, wk = 0, emp = 0;
  for (let i = 0; i < a.buildings.count; i++) { res += a.buildings.residents[i]!; wk += a.buildings.workers[i]!; }
  const c = demo.citizens.col;
  for (let i = 0; i < demo.citizens.count; i++) if (c.job[i]! >= 0) emp += demo.weightOf(i);
  assert.equal(res, demo.population);
  assert.equal(wk, emp);
  assert.ok(emp > 1000, `emplois ${emp}`);
});
