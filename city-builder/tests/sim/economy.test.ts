/** Économie : impôts, entretien, salaires, emprunts, faillite, prévisions, historique. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BANKRUPTCY_MONTHS, Economy, MUNICIPAL_WAGE_SHARE, SERVICE_WAGE, annuity } from '../../src/sim/economy';
import { MINUTES_PER_MONTH } from '../../src/sim/clock';
import { buildTown, newTownSim, runDays } from './fixtures';

test('mensualité d\'emprunt : formule d\'annuité (valeur de référence)', () => {
  // 100 000 à 6 %/an sur 12 mois -> 8 606,64 / mois (table d'amortissement classique).
  assert.equal(Math.round(annuity(100_000, 0.06, 12) * 100) / 100, 8606.64);
  assert.equal(annuity(1200, 0, 12), 100);
});

test('emprunt : amortissement complet, capital remboursé, intérêts payés', () => {
  const e = new Economy();
  e.reset(0);
  const l = e.takeLoan(120_000, 24, 0);
  assert.ok(!('error' in l));
  assert.equal(e.money, 120_000);
  let interest = 0, principal = 0;
  for (let m = 0; m < 24; m++) {
    const r = e.onMonth();
    interest += r.expenses.loanInterest;
    principal += r.expenses.loanPrincipal;
  }
  assert.equal(e.loans.length, 0, 'emprunt soldé après 24 échéances');
  assert.ok(Math.abs(principal - 120_000) < 1, `capital remboursé ${principal}`);
  const expectedInterest = annuity(120_000, l.annualRate, 24) * 24 - 120_000;
  assert.ok(Math.abs(interest - expectedInterest) < 1, `intérêts ${interest} vs ${expectedInterest}`);
  assert.ok(Math.abs(e.money - (120_000 - 120_000 - expectedInterest)) < 1);
});

test('emprunt : taux croissant avec l\'endettement, capacité plafonnée, remboursement anticipé', () => {
  const e = new Economy();
  e.reset(100_000);
  const r1 = e.currentLoanRate();
  const l1 = e.takeLoan(300_000, 60, 0);
  assert.ok(!('error' in l1));
  assert.ok(e.currentLoanRate() > r1);
  const over = e.takeLoan(10_000_000, 60, 0);
  assert.ok('error' in over && /Capacité/.test(over.error));
  const short = e.loanOffer(50_000, 3);
  assert.ok('error' in short);
  e.money = 10;
  const fail = e.repayLoan(l1.id);
  assert.ok('error' in fail && /Fonds/.test(fail.error));
  e.money = 1_000_000;
  const ok = e.repayLoan(l1.id);
  assert.ok(!('error' in ok) && ok.paid === 300_000);
  assert.equal(e.loans.length, 0);
  assert.equal(e.money, 700_000);
  assert.ok('error' in e.repayLoan(999));
});

test('faillite : après 3 mois de trésorerie négative ; sortie quand elle redevient positive', () => {
  const e = new Economy();
  e.reset(1000);
  e.addUpkeep(2000);
  e.onMonth();
  assert.equal(e.monthsInDeficit, 1);
  assert.equal(e.bankrupt, false);
  for (let m = 1; m < BANKRUPTCY_MONTHS; m++) e.onMonth();
  assert.equal(e.bankrupt, true);
  assert.equal(e.canAfford(1), false, 'aucune dépense d\'investissement en faillite');
  assert.ok('error' in e.loanOffer(100_000, 24), 'aucun emprunt en faillite');
  e.money = 100_000;
  e.removeUpkeep(2000);
  e.onMonth();
  assert.equal(e.bankrupt, false);
  assert.equal(e.monthsInDeficit, 0);
});

test('impôts : recettes = assiette x taux, taux bornés, salaires des services, historique', () => {
  const e = new Economy();
  e.reset(0);
  e.taxBase.residential = 100_000;
  e.taxBase.industrial = 50_000;
  assert.equal(e.setTaxRate('residential', 0.5), 0.25, 'taux plafonné à 25 %');
  assert.equal(e.setTaxRate('industrial', -1), 0, 'taux plancher 0 %');
  e.setTaxRate('industrial', 0.1);
  e.serviceWorkers = 100;
  e.addUpkeep(1000);
  e.addUpkeep(500, 'roads');
  const f = e.forecast();
  assert.equal(f.totalIncome, 25_000 + 5_000);
  assert.equal(f.expenses.salaries, 100 * SERVICE_WAGE * MUNICIPAL_WAGE_SHARE);
  assert.equal(f.projection.length, 12);
  const rec = e.onMonth({ monthIndex: 0, population: 10, jobs: 5, unemploymentRate: 0.1, happiness: 70 });
  assert.equal(rec.income.residential, 25_000);
  assert.equal(rec.income.industrial, 5_000);
  assert.equal(rec.expenses.buildings, 1000);
  assert.equal(rec.expenses.roads, 500);
  assert.equal(e.money, 30_000 - 1500 - f.expenses.salaries);
  assert.equal(rec.moneyEnd, Math.round(e.money));
  assert.equal(e.history.length, 1);
  assert.equal(rec.population, 10);
});

test('prévision : mois avant trésorerie négative', () => {
  const e = new Economy();
  e.reset(2500);
  e.addUpkeep(1000);
  const f = e.forecast();
  assert.equal(f.balance, -1000);
  assert.equal(f.monthsUntilNegative, 3);
  assert.deepEqual(f.projection.slice(0, 3), [1500, 500, -500]);
});

test('monde : une ville habitée paie des impôts réels ; une ville vide n\'encaisse rien', () => {
  const empty = newTownSim();
  runDays(empty, 31);
  assert.equal(empty.economy.history[0]!.income.residential, 0);
  const s = newTownSim();
  buildTown(s);
  const spent = 50_000_000 - s.economy.money;
  runDays(s, 31);
  const rec = s.economy.history[0]!;
  assert.ok(rec.income.residential > 0, 'impôts résidentiels perçus');
  assert.ok(rec.population > 0);
  assert.ok(rec.expenses.salaries > 0, 'agents publics rémunérés');
  assert.equal(rec.construction, spent, 'investissements du mois enregistrés dans le bilan');
});

test('monde : faillite bloque les constructions, message explicite', () => {
  const s = newTownSim(200_000);
  assert.ok(s.buildRoad({ type: 'boulevard', points: [-200, 0, 200, 0] }).ok);
  s.economy.money = -10;
  s.economy.addUpkeep(1_000_000);
  runDays(s, 30 * BANKRUPTCY_MONTHS + 1);
  assert.equal(s.economy.bankrupt, true);
  const r = s.placeBuilding({ assetId: 'maison', x: 0, z: -40, rot: 0 });
  assert.ok(!r.ok && r.error.code === 'INSUFFICIENT_FUNDS' && /faillite/.test(r.error.message));
  assert.ok(s.notices.some((n) => n.level === 'danger' && /Faillite/.test(n.message)));
  assert.ok(s.economy.history.length >= BANKRUPTCY_MONTHS);
  assert.equal(s.clock.totalMinutes >= MINUTES_PER_MONTH * BANKRUPTCY_MONTHS, true);
});
