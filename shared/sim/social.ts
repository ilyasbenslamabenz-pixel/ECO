// Moteur social : qualité des services publics, satisfaction par catégorie et par ville, confiance, risques.
import { BUDGET_DEFS, CATEGORY_IDS, SECTORS, type CategoryId } from './data';
import { averageConsumptionTax } from './fiscal';
import { clamp } from './economy';
import type { GameState, Policy, Services } from './types';
import { modeledQuality } from './services';

export const FACTORS = ['pouvoirAchat', 'fiscalite', 'emploi', 'sante', 'education', 'securite', 'transports', 'logement', 'inegalites', 'environnement', 'services', 'stabilite', 'libertes'] as const;
export type Factor = (typeof FACTORS)[number];
export const FACTOR_NAMES: Record<Factor, string> = {
  pouvoirAchat: "Pouvoir d'achat", fiscalite: 'Niveau des impôts', emploi: 'Emploi', sante: 'Qualité des soins', education: "Qualité de l'éducation",
  securite: 'Sécurité', transports: 'Transports', logement: 'Logement', inegalites: 'Inégalités', environnement: "Qualité de l'air et environnement",
  services: 'Services publics', stabilite: 'Stabilité politique et financière', libertes: 'Libertés',
};

// Pondération des facteurs pour chaque catégorie (somme normalisée dans le calcul).
const W: Record<CategoryId, Partial<Record<Factor, number>>> = {
  enfants: { education: 4, sante: 3, securite: 2, environnement: 2, pouvoirAchat: 2, logement: 2 },
  etudiants: { education: 4, logement: 3, emploi: 3, transports: 2, environnement: 2, pouvoirAchat: 2, libertes: 1 },
  cadres: { fiscalite: 3, pouvoirAchat: 3, services: 2, transports: 2, securite: 2, education: 2, emploi: 1, environnement: 1, stabilite: 1 },
  employes: { pouvoirAchat: 4, emploi: 3, logement: 2, sante: 2, transports: 2, fiscalite: 2, inegalites: 1 },
  ouvriers: { pouvoirAchat: 4, emploi: 4, inegalites: 2, logement: 2, sante: 2, fiscalite: 1, securite: 1 },
  independants: { fiscalite: 4, pouvoirAchat: 3, stabilite: 2, services: 1, emploi: 1, sante: 1 },
  entrepreneurs: { fiscalite: 5, stabilite: 3, services: 2, pouvoirAchat: 2, transports: 1, education: 1 },
  retraites: { sante: 5, pouvoirAchat: 4, securite: 3, stabilite: 1, services: 1, environnement: 1 },
  chomeurs: { emploi: 6, pouvoirAchat: 4, inegalites: 2, logement: 2, sante: 1 },
  inactifs: { pouvoirAchat: 4, logement: 3, sante: 2, inegalites: 2, services: 1 },
};

/** Qualité cible d'un service selon le ratio dépense / besoin (1 → 0,80). */
export function serviceTarget(ratio: number) {
  return clamp(0.05 + 0.75 * Math.pow(Math.max(0, ratio), 0.7), 0, 1);
}

export function servicesStep(S: GameState, P: Policy, calibrate: boolean): Services {
  const pop = S.demography.cohorts.reduce((s, v) => s + v, 0);
  // coût des services : indexé sur le salaire moyen (effet Baumol)
  const priceRel = S.baseline.meanWage > 0 && S.accounts.meanWage > 0 ? S.accounts.meanWage / S.baseline.meanWage : S.macro.priceLevel;
  const next = { ...S.services };
  for (const b of BUDGET_DEFS) {
    if (!(b.id in next)) continue;
    // --- modules services publics/recherche/construction --- : santé, éducation, sécurité, logement modélisés
    const modeled = modeledQuality(S, b.id);
    if (modeled !== null) { next[b.id as keyof Services] = modeled; continue; }
    const need = pop * b.refPerCapita * priceRel;
    let target = serviceTarget(P.budget[b.id] / Math.max(1, need));
    if (b.id === 'sante') {
      const si = SECTORS.findIndex((s) => s.id === 'sante');
      const vac = S.sectors[si].vacancies / Math.max(1, S.sectors[si].employees);
      target *= 1 - clamp(vac * 1.5, 0, 0.4); // pénurie de personnel soignant
    }
    const key = b.id as keyof Services;
    next[key] = calibrate ? target : next[key] + (target - next[key]) * 0.035; // délai de recrutement / construction
  }
  return next;
}

export function airQuality(S: GameState) {
  if (S.environment) return S.environment.airQuality; // module environnement : polluants locaux réels (énergie, transports, chauffage, industrie, agriculture)
  const pop = S.demography.cohorts.reduce((s, v) => s + v, 0);
  const perCap = S.accounts.emissions / Math.max(1, pop);
  return clamp(1 - 0.35 * perCap / Math.max(0.1, S.baseline.emissionsPerCap), 0, 1);
}

/** Revenu réel par personne de chaque catégorie (€/an aux prix de base). */
export function categoryIncome(S: GameState): Record<string, number> {
  const A = S.accounts;
  const pop = S.demography.cohorts.reduce((s, v) => s + v, 0);
  const out: Record<string, number> = {};
  const generic = A.disposableIncome / Math.max(1, pop) / S.macro.priceLevel;
  for (const c of CATEGORY_IDS) out[c] = generic;
  for (const [k, v] of Object.entries(A.taxByCategory)) out[k] = (v.grossIncome * (1 - v.effectiveRate)) / S.macro.priceLevel;
  return out;
}

export function satisfactionStep(S: GameState, P: Policy, calibrate: boolean) {
  const A = S.accounts;
  const u = S.demography.unemployed / Math.max(1, S.demography.labourForce);
  const gdp = Math.max(1, A.gdp);
  const debtRatio = S.finance.debt / gdp;
  const deficit = -A.balance / gdp;
  const incomes = categoryIncome(S);
  const consTax = averageConsumptionTax(P);
  const base = S.baseline;
  const sv = S.services;
  const common: Record<Factor, number> = {
    pouvoirAchat: 55,
    fiscalite: 55,
    emploi: clamp(100 - 700 * u, 0, 100),
    sante: sv.sante * 100,
    education: sv.education * 100,
    securite: sv.securite * 100,
    transports: S.transport ? S.transport.satisfaction : (sv.transports * 0.7 + sv.infrastructures * 0.3) * 100, // moteur des transports (phase 4b)
    logement: clamp(48 + 60 * (sv.logement - 0.8), 0, 100),
    inegalites: clamp(100 - (A.gini - 0.18) * 350, 0, 100),
    environnement: clamp(airQuality(S) * 100 * 0.7 + sv.environnement * 30, 0, 100),
    services: sv.administration * 100,
    stabilite: clamp(72 - 120 * Math.max(0, debtRatio - 0.9) - 300 * Math.max(0, deficit - 0.04), 0, 100),
    libertes: 70,
  };
  const byCategory = {} as Record<CategoryId, number>;
  const factorsAvg: Record<string, number> = {};
  let overall = 0;
  let weightPop = 0;
  const counts = S.demography.categories;
  for (const c of CATEGORY_IDS) {
    const f = { ...common };
    const ratio = base.catIncome[c] ? incomes[c] / base.catIncome[c] : 1;
    // accoutumance : la référence de revenu suit lentement le niveau atteint (≈ 3 %/an de l'écart)
    if (!calibrate && base.catIncome[c]) base.catIncome[c] += (incomes[c] - base.catIncome[c]) * (0.08 / 12);
    f.pouvoirAchat = clamp(55 + 220 * (ratio - 1), 0, 100);
    const t = A.taxByCategory[c]?.effectiveRate;
    let fisc = 55 - 200 * (consTax - (base.catTaxRate._cons ?? consTax));
    if (t !== undefined && base.catTaxRate[c] !== undefined) fisc -= 350 * (t - base.catTaxRate[c]);
    if (c === 'entrepreneurs' || c === 'independants') fisc -= 150 * (P.corporate.rate - (base.catTaxRate._cit ?? P.corporate.rate)) + 400 * P.wealth.rate;
    if (c === 'cadres') fisc -= 200 * P.wealth.rate;
    if (c === 'cadres' || c === 'employes' || c === 'ouvriers') fisc -= 100 * (rateSum(P) - (base.catTaxRate._contrib ?? rateSum(P)));
    f.fiscalite = clamp(fisc, 0, 100);
    if (c === 'cadres') f.emploi = clamp(100 - 400 * u, 0, 100);
    const w = W[c];
    let sum = 0;
    let ws = 0;
    for (const [k, v] of Object.entries(w) as [Factor, number][]) { sum += f[k] * v; ws += v; }
    const score = sum / ws;
    byCategory[c] = calibrate || !S.satisfaction.byCategory[c] ? score : S.satisfaction.byCategory[c] + (score - S.satisfaction.byCategory[c]) * 0.25;
    const n = counts[c] || 0;
    overall += byCategory[c] * n;
    weightPop += n;
    for (const k of FACTORS) factorsAvg[k] = (factorsAvg[k] || 0) + f[k] * n;
  }
  for (const k of FACTORS) factorsAvg[k] /= Math.max(1, weightPop);
  overall /= Math.max(1, weightPop);
  const prevOverall = S.satisfaction.overall || overall;
  const trust = calibrate ? overall : S.satisfaction.trust + (overall - S.satisfaction.trust) * 0.06;
  const sig = (x: number) => 1 / (1 + Math.exp(-x));
  const workers = ((byCategory.ouvriers || 50) + (byCategory.employes || 50)) / 2;
  return {
    overall,
    byCategory,
    factors: factorsAvg,
    trust,
    protestRisk: sig((45 - overall) / 6 + (prevOverall - overall) * 0.8),
    strikeRisk: sig((45 - workers) / 6 + (u - 0.09) * 20),
    unrestRisk: sig((32 - overall) / 5 + (u - 0.15) * 15),
  };
}

function rateSum(P: Policy) {
  let s = 0;
  for (const b of Object.values(P.contributions)) s += b.employer + b.employee;
  return s;
}

/** Données locales des villes : emploi, revenus, satisfaction, attractivité. */
export function citiesStep(S: GameState, P: Policy, calibrate: boolean) {
  const defs = S.country.cities;
  const nat = S.demography;
  const uNat = nat.unemployed / Math.max(1, nat.labourForce);
  const pop = S.demography.cohorts.reduce((s, v) => s + v, 0);
  // emplois locaux : chaque secteur répartit ses emplois selon la population et la spécialisation des villes
  const jobs = new Array(defs.length).fill(0);
  const wageIdx = new Array(defs.length).fill(0);
  SECTORS.forEach((sec, i) => {
    let denom = 0;
    defs.forEach((c, k) => (denom += S.cities[k].popShare * c.sectorWeights[i]));
    defs.forEach((c, k) => {
      const e = (S.sectors[i].employees * S.cities[k].popShare * c.sectorWeights[i]) / Math.max(1e-9, denom);
      jobs[k] += e;
      wageIdx[k] += e * S.sectors[i].wage;
    });
    void sec;
  });
  const natWage = S.sectors.reduce((s, x) => s + x.wage * x.employees, 0) / Math.max(1, S.sectors.reduce((s, x) => s + x.employees, 0));
  const perCapIncome = S.accounts.disposableIncome / Math.max(1, pop);
  const jobsRatioAvg = jobs.reduce((s, v) => s + v, 0) / Math.max(1, pop);
  const attract: number[] = [];
  defs.forEach((c, k) => {
    const cs = S.cities[k];
    cs.population = pop * cs.popShare;
    const ratio = jobs[k] / Math.max(1, cs.population) / Math.max(1e-6, jobsRatioAvg);
    cs.unemployment = clamp(uNat + (1 - uNat) * (1 - ratio) * 0.45, 0.02, 0.4);
    const wi = jobs[k] > 0 ? wageIdx[k] / jobs[k] / natWage : 1;
    cs.income = perCapIncome * (1 + 0.8 * (wi - 1));
    const local = -400 * (cs.unemployment - uNat) + 20 * (wi - 1) + (c.capital ? 2 : 0);
    const target = clamp(S.satisfaction.overall + local, 0, 100);
    cs.satisfaction = calibrate ? target : cs.satisfaction + (target - cs.satisfaction) * 0.2;
    cs.housingUnits = (cs.population / 2.2) * 1.08;
    cs.localRevenue = (P.property.localTax * cs.population) / 2.2 + 0.5 * S.accounts.revenue.foncier * cs.popShare;
    attract.push(Math.max(0.05, (1 - cs.unemployment) * (cs.satisfaction / 100) * (c.kind === 'metropole' ? 1.06 : c.kind === 'ville' ? 1 : 0.96)));
  });
  if (!calibrate) {
    const avg = attract.reduce((s, v, k) => s + v * S.cities[k].popShare, 0);
    let tot = 0;
    S.cities.forEach((cs, k) => {
      cs.popShare *= 1 + (0.03 / 12) * (attract[k] / avg - 1);
      tot += cs.popShare;
    });
    S.cities.forEach((cs) => (cs.popShare /= tot));
  }
}
