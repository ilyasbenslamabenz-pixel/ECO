// Affiche les grands agrégats de l'état initial et leur évolution sans intervention (contrôle de calibrage).
import { createGame, tick } from '../shared/sim/engine';
import { SECTORS } from '../shared/sim/data';

const t0 = Date.now();
const S = createGame();
console.log('création', Date.now() - t0, 'ms');
const pct = (v: number) => (v * 100).toFixed(1) + '%';
const b = (v: number) => (v / 1e9).toFixed(1) + 'Md';
function report(label: string) {
  const A = S.accounts;
  const pop = S.demography.cohorts.reduce((s, v) => s + v, 0);
  const u = S.demography.unemployed / S.demography.labourForce;
  console.log(`\n== ${label} (mois ${S.month}) pop ${(pop / 1e6).toFixed(2)}M  PIB ${b(A.gdp)}  PIB/hab ${(A.gdp / pop).toFixed(0)}  P=${S.macro.priceLevel.toFixed(3)}`);
  console.log(`C ${pct(A.consumptionNet / A.gdp)} I ${pct(A.investment / A.gdp)} G ${pct(A.publicPurchases / A.gdp)} X ${pct(A.exports / A.gdp)} M ${pct(A.imports / A.gdp)} | identité ${(A.consumptionNet + A.investment + A.publicPurchases + A.exports - A.imports - A.gdp).toFixed(0)}`);
  console.log(`chômage ${pct(u)} infl ${pct(S.macro.inflation)} croissance ${pct(S.history.growth.at(-1)!)} taux dir ${pct(S.macro.policyRate)} salaire moyen ${A.meanWage.toFixed(0)} médian ${A.medianWage.toFixed(0)} gini ${A.gini.toFixed(3)} pauvreté ${pct(A.poverty)}`);
  console.log(`recettes ${pct(A.revenueTotal / A.gdp)} dépenses ${pct(A.spendingTotal / A.gdp)} solde ${pct(A.balance / A.gdp)} dette ${pct(S.finance.debt / A.gdp)} taux moyen ${pct(S.finance.avgRate)}`);
  console.log('recettes:', Object.entries(A.revenue).map(([k, v]) => `${k} ${pct(v / A.gdp)}`).join(', '));
  console.log('dépenses:', Object.entries(A.spending).map(([k, v]) => `${k} ${pct(v / A.gdp)}`).join(', '));
  console.log(`satisfaction ${S.satisfaction.overall.toFixed(1)} confiance ${S.satisfaction.trust.toFixed(1)}`, Object.entries(S.satisfaction.byCategory).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(' '));
  console.log('facteurs', Object.entries(S.satisfaction.factors).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(' '));
  console.log(`émissions ${(A.emissions / 1e6).toFixed(1)} Mt (${(A.emissions / pop).toFixed(1)} t/hab) naissances ${S.demography.births.toFixed(0)} décès ${S.demography.deaths.toFixed(0)} migr ${S.demography.migration.toFixed(0)} e0 ${S.demography.lifeExpectancy.toFixed(1)} fécondité ${S.demography.fertility.toFixed(2)}`);
  console.log('secteurs:', S.sectors.map((s, i) => `${SECTORS[i].id} E${(s.employees / 1e3).toFixed(0)}k m${pct(s.profit / s.output)}`).join(' '));
  console.log('impôts/catégorie:', Object.entries(A.taxByCategory).map(([k, v]) => `${k} brut ${v.grossIncome.toFixed(0)} taux ${pct(v.effectiveRate)}`).join(' | '));
}
report('initial');
for (let i = 0; i < 12; i++) tick(S);
report('1 an');
for (let i = 0; i < 108; i++) tick(S);
report('10 ans');
for (let i = 0; i < 120; i++) tick(S);
report('20 ans');
for (let i = 0; i < 360; i++) tick(S);
report('50 ans');
console.log('durée totale', Date.now() - t0, 'ms');
