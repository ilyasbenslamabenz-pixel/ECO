// Tests automatisés des moteurs fiscal, économique, budgétaire, démographique et social.
import { describe, expect, it } from 'vitest';
import { createGame, schedulePolicy, tick, applyAction, sanitizePolicy } from '../shared/sim/engine';
import { activityCredit, groupIncomeTax, inequality, lognormalPoints, progressiveTax, sanitizeBrackets, wealthTaxBase } from '../shared/sim/fiscal';
import { generateCountry, DEFAULT_CONFIG } from '../shared/sim/country';
import type { GameState, Policy } from '../shared/sim/types';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const base = createGame();
const fresh = (): GameState => clone(base);
const run = (S: GameState, months: number) => { for (let i = 0; i < months; i++) tick(S); return S; };
const withPolicy = (S: GameState, f: (p: Policy) => void) => { const p = clone(S.policy); f(p); schedulePolicy(S, p); return S; };
const unemployment = (S: GameState) => S.demography.unemployed / S.demography.labourForce;
const pop = (S: GameState) => S.demography.cohorts.reduce((s, v) => s + v, 0);

describe('Fiscalité : barème progressif', () => {
  const brackets = [{ upTo: 10000, rate: 0 }, { upTo: 30000, rate: 0.1 }, { upTo: 80000, rate: 0.3 }, { upTo: null, rate: 0.45 }];
  it('applique chaque taux à la seule fraction de revenu de sa tranche', () => {
    expect(progressiveTax(5000, brackets)).toBe(0);
    expect(progressiveTax(20000, brackets)).toBeCloseTo(1000);
    expect(progressiveTax(30000, brackets)).toBeCloseTo(2000);
    expect(progressiveTax(100000, brackets)).toBeCloseTo(2000 + 15000 + 9000);
    expect(progressiveTax(-10, brackets)).toBe(0);
  });
  it("est croissant et le taux moyen ne dépasse jamais le taux marginal", () => {
    let prev = 0;
    for (let r = 0; r <= 400000; r += 5000) {
      const t = progressiveTax(r, brackets);
      expect(t).toBeGreaterThanOrEqual(prev);
      if (r > 0) expect(t / r).toBeLessThanOrEqual(0.45 + 1e-9);
      prev = t;
    }
  });
  it('normalise un barème invalide', () => {
    const b = sanitizeBrackets([{ upTo: 20000, rate: 2 }, { upTo: 10000, rate: 0.2 }, { upTo: 50000, rate: -1 }]);
    expect(b.at(-1)!.upTo).toBeNull();
    expect(b.every((x) => x.rate >= 0 && x.rate <= 0.9)).toBe(true);
    for (let i = 1; i < b.length - 1; i++) expect(b[i].upTo!).toBeGreaterThan(b[i - 1].upTo!);
  });
  it('conserve la moyenne de la distribution log-normale', () => {
    const pts = lognormalPoints(42000, 0.5);
    expect(pts.reduce((s, v) => s + v, 0) / pts.length).toBeCloseTo(42000, 0);
    expect(pts[0]).toBeLessThan(pts[19]);
  });
  it("calcule l'impôt d'un groupe : brut = net + cotisations + impôt − crédits", () => {
    const it = createGame().policy.incomeTax;
    const r = groupIncomeTax({ count: 1000, meanGross: 40000, sigma: 0.3, employeeRate: 0.145, childrenPerTaxpayer: 0.5, minWageAnnual: 21600, earned: true }, it);
    expect(r.gross).toBeCloseTo(40000 * 1000, -2);
    expect(r.gross - r.contributions - r.incomeTax + r.activityCredit).toBeCloseTo(r.net, 0);
    expect(r.incomeTax).toBeGreaterThan(0);
  });
  it("le crédit d'activité est dégressif et nul au-delà de 1,6 SMIC", () => {
    expect(activityCredit(20000, 21600, 1600)).toBe(1600);
    expect(activityCredit(30000, 21600, 1600)).toBeGreaterThan(0);
    expect(activityCredit(30000, 21600, 1600)).toBeLessThan(1600);
    expect(activityCredit(40000, 21600, 1600)).toBe(0);
  });
  it("l'assiette de l'impôt sur le patrimoine décroît avec le seuil", () => {
    expect(wealthTaxBase(2e12, 4e6, 1e6)).toBeGreaterThan(wealthTaxBase(2e12, 4e6, 5e6));
  });
  it('mesure les inégalités (Gini 0 pour une population égale)', () => {
    expect(inequality([{ income: 100, weight: 10 }]).gini).toBeCloseTo(0, 5);
    expect(inequality([{ income: 1, weight: 9 }, { income: 100, weight: 1 }]).gini).toBeGreaterThan(0.5);
  });
});

describe('Pays et état initial', () => {
  it('génère un pays déterministe et conforme à la configuration', () => {
    const a = generateCountry(DEFAULT_CONFIG);
    const b = generateCountry(DEFAULT_CONFIG);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.cities.filter((c) => c.kind === 'metropole').length).toBe(5);
    expect(a.cities.filter((c) => c.kind === 'ville').length).toBe(12);
    expect(a.cities.filter((c) => c.kind === 'commune').length).toBe(30);
    expect(a.cities.filter((c) => c.capital).length).toBe(1);
    expect(a.infra.some((i) => i.type === 'centrale_nucleaire')).toBe(true);
  });
  it('respecte un nombre de villes configurable', () => {
    const S = createGame({ metropoles: 3, villes: 6, communes: 10 });
    expect(S.country.cities.length).toBe(19);
    expect(S.cities.length).toBe(19);
  });
  it('démarre avec des agrégats plausibles', () => {
    const S = fresh();
    const A = S.accounts;
    const gdpPerCap = A.gdp / pop(S);
    expect(gdpPerCap).toBeGreaterThan(25000);
    expect(gdpPerCap).toBeLessThan(60000);
    expect(unemployment(S)).toBeGreaterThan(0.04);
    expect(unemployment(S)).toBeLessThan(0.12);
    expect(A.revenueTotal / A.gdp).toBeGreaterThan(0.3);
    expect(A.revenueTotal / A.gdp).toBeLessThan(0.55);
    expect(Math.abs(A.balance / A.gdp)).toBeLessThan(0.05);
    expect(S.cities.reduce((s, c) => s + c.popShare, 0)).toBeCloseTo(1, 6);
  });
});

describe('Cohérence comptable', () => {
  const S = run(fresh(), 24);
  it('PIB = consommation + investissement + achats publics + exportations − importations', () => {
    const A = S.accounts;
    expect(A.consumptionNet + A.investment + A.publicPurchases + A.exports - A.imports).toBeCloseTo(A.gdp, -3);
  });
  it('les totaux budgétaires sont la somme de leurs postes', () => {
    const A = S.accounts;
    expect(Object.values(A.revenue).reduce((s, v) => s + v, 0)).toBeCloseTo(A.revenueTotal, -2);
    expect(Object.values(A.spending).reduce((s, v) => s + v, 0)).toBeCloseTo(A.spendingTotal, -2);
    expect(A.revenueTotal - A.spendingTotal).toBeCloseTo(A.balance, -2);
  });
  it('la trésorerie et la dette évoluent selon le solde et les emprunts', () => {
    const T = fresh();
    for (let i = 0; i < 36; i++) {
      const cash0 = T.finance.cash;
      const debt0 = T.finance.debt;
      const reserve0 = T.finance.reserve;
      const bonds0 = T.finance.bondsIssued.reduce((s, b) => s + b.amount, 0);
      tick(T);
      const issued = T.finance.bondsIssued.reduce((s, b) => s + b.amount, 0) - bonds0;
      expect(T.finance.debt - debt0).toBeCloseTo(issued, -2);
      expect(T.finance.cash - cash0).toBeCloseTo(T.accounts.balance / 12 + (reserve0 * T.macro.policyRate) / 12 + issued, -2);
    }
  });
  it('la population varie de (naissances − décès + migrations) / 12', () => {
    const T = fresh();
    for (let i = 0; i < 12; i++) {
      const p0 = pop(T);
      tick(T);
      const d = T.demography;
      expect(pop(T) - p0).toBeCloseTo((d.births - d.deaths + d.migration) / 12, -1);
    }
  });
  it('les catégories socio-économiques couvrent toute la population', () => {
    const total = Object.values(S.demography.categories).reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(pop(S), -2);
  });
});

describe('Stabilité de long terme', () => {
  it('reste stable 30 ans sans intervention', () => {
    const S = run(fresh(), 360);
    expect(S.macro.inflation).toBeGreaterThan(-0.01);
    expect(S.macro.inflation).toBeLessThan(0.06);
    expect(unemployment(S)).toBeGreaterThan(0.03);
    expect(unemployment(S)).toBeLessThan(0.15);
    expect(S.finance.debt / S.accounts.gdp).toBeLessThan(1.5);
  });
});

describe('Effets des décisions (comparaison à un scénario de référence)', () => {
  const ref = run(fresh(), 36);

  it('une hausse de la TVA augmente ses recettes, les prix, et réduit la consommation réelle', () => {
    const S = run(withPolicy(fresh(), (p) => { p.vat.normal = 0.27; }), 36);
    expect(S.accounts.revenue.tva).toBeGreaterThan(ref.accounts.revenue.tva);
    expect(S.macro.priceLevel).toBeGreaterThan(ref.macro.priceLevel);
    expect(S.accounts.consumptionNet / S.macro.priceLevel).toBeLessThan(ref.accounts.consumptionNet / ref.macro.priceLevel);
  });

  it("une baisse de l'IS stimule l'investissement mais réduit les recettes d'IS", () => {
    const S = run(withPolicy(fresh(), (p) => { p.corporate.rate = 0.12; }), 36);
    expect(S.accounts.investment).toBeGreaterThan(ref.accounts.investment);
    expect(S.accounts.revenue.impotSocietes).toBeLessThan(ref.accounts.revenue.impotSocietes);
  });

  it('une hausse des taux des hautes tranches augmente les recettes et pèse sur les cadres', () => {
    const S = run(withPolicy(fresh(), (p) => { p.incomeTax.brackets[3].rate = 0.5; p.incomeTax.brackets[4].rate = 0.6; }), 12);
    const r12 = run(fresh(), 12);
    expect(S.accounts.revenue.impotRevenu).toBeGreaterThan(r12.accounts.revenue.impotRevenu);
    expect(S.accounts.taxByCategory.cadres.effectiveRate).toBeGreaterThan(r12.accounts.taxByCategory.cadres.effectiveRate);
    expect(S.satisfaction.byCategory.cadres).toBeLessThan(r12.satisfaction.byCategory.cadres);
  });

  it('une coupe du budget de santé améliore le solde mais dégrade les soins avec retard', () => {
    const cut = withPolicy(fresh(), (p) => { p.budget.sante *= 0.5; });
    tick(cut);
    tick(cut);
    const q2 = cut.services.sante;
    run(cut, 58);
    const r60 = run(fresh(), 60);
    expect(q2).toBeGreaterThan(cut.services.sante); // dégradation progressive
    expect(cut.services.sante).toBeLessThan(r60.services.sante - 0.1);
    expect(cut.demography.lifeExpectancy).toBeLessThan(r60.demography.lifeExpectancy);
    expect(cut.accounts.spending.sante).toBeLessThan(r60.accounts.spending.sante);
  });

  it('une hausse du salaire minimum relève les bas salaires et le coût du travail', () => {
    const S = run(withPolicy(fresh(), (p) => { p.labour.minWage = 2300; }), 36);
    expect(S.accounts.taxByCategory.employes.grossIncome).toBeGreaterThan(ref.accounts.taxByCategory.employes.grossIncome);
    expect(S.demography.employed).toBeLessThan(ref.demography.employed);
  });

  it('une taxe carbone élevée réduit les émissions au fil du temps', () => {
    const S = run(withPolicy(fresh(), (p) => { p.eco.carbon = 250; p.eco.industrial = 200; }), 60);
    const r = run(fresh(), 60);
    expect(S.accounts.emissions).toBeLessThan(r.accounts.emissions * 0.92);
  });

  it("le recul de l'âge de la retraite réduit les dépenses de pensions", () => {
    const S = run(withPolicy(fresh(), (p) => { p.labour.retirementAge = 67; }), 24);
    const r = run(fresh(), 24);
    expect(S.accounts.spending.retraites).toBeLessThan(r.accounts.spending.retraites);
    expect(S.satisfaction.byCategory.ouvriers).toBeLessThanOrEqual(r.satisfaction.byCategory.ouvriers + 1);
  });

  it("les décisions n'entrent en vigueur qu'au mois suivant", () => {
    const S = fresh();
    withPolicy(S, (p) => { p.vat.normal = 0.3; });
    expect(S.policy.vat.normal).toBe(0.2);
    tick(S);
    expect(S.policy.vat.normal).toBe(0.3);
  });

  it('borne les politiques absurdes', () => {
    const S = fresh();
    const p = clone(S.policy);
    p.vat.normal = 5;
    p.labour.hours = 2;
    (p.corporate as unknown as { rate: unknown }).rate = 'abc';
    const s = sanitizePolicy(p, S.policy);
    expect(s.vat.normal).toBeLessThanOrEqual(0.35);
    expect(s.labour.hours).toBeGreaterThanOrEqual(28);
    expect(s.corporate.rate).toBe(S.policy.corporate.rate);
  });
});

describe('Opérations financières', () => {
  it('émettre puis rembourser modifie dette et trésorerie du même montant', () => {
    const S = fresh();
    const d0 = S.finance.debt;
    const c0 = S.finance.cash;
    expect(applyAction(S, { type: 'bonds', amount: 5e9 }).ok).toBe(true);
    expect(S.finance.debt - d0).toBeCloseTo(5e9);
    expect(S.finance.cash - c0).toBeCloseTo(5e9);
    expect(applyAction(S, { type: 'repay', amount: 5e9 }).ok).toBe(true);
    expect(S.finance.debt).toBeCloseTo(d0);
    expect(applyAction(S, { type: 'repay', amount: 1e15 }).ok).toBe(false);
  });
});
