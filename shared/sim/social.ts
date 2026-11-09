// Moteur social : qualité des services publics, satisfaction par catégorie et par ville, confiance, risques.
import { BUDGET_DEFS, CATEGORY_IDS, SECTORS, type CategoryId } from './data';
import { averageConsumptionTax } from './fiscal';
import { clamp } from './economy';
import type { GameState, Policy, SatDriver, SatDyn, Services } from './types';
import { modeledQuality } from './services';
import { HEALTH_INFRA } from './health';
import { SCHOOL_INFRA } from './education';

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

// ---------- Satisfaction ressentie ----------
// La note « brute » de chaque facteur (qualité mesurée des services, revenu réel, impôts, emploi, air…) n'est pas perçue
// telle quelle. Trois mécanismes rendent les décisions lisibles sans toucher à l'état initial (ressenti = brut au départ) :
// 1. Amplification des écarts : ressenti = brut + (GAIN − 1) × (brut − référence), plafonnée en douceur (SAT_AMP_CAP). La référence d'accoutumance suit
//    lentement la note brute (constante de temps ≈ 6 ans) : un progrès est fortement ressenti, puis devient la norme.
// 2. Effet de surprise : un changement brusque de la note brute (hausse d'impôt, crise, choc de prix) est ressenti en plus,
//    puis l'impulsion s'estompe (−15 %/mois, demi-vie ≈ 4 mois).
// 3. Effet d'annonce budgétaire : relever (ou couper) le budget d'un service est perçu dès le mois suivant, avant que les
//    recrutements et les chantiers n'agissent ; les coupes sont plus mal vécues que les hausses ne sont appréciées.

/** Amplification des écarts à la référence, par facteur. */
export const SAT_GAIN: Record<Factor, number> = {
  pouvoirAchat: 2.2, fiscalite: 2, emploi: 2.2, sante: 5, education: 5, securite: 5, transports: 4.5, logement: 5,
  inegalites: 2, environnement: 4.5, services: 3, stabilite: 2, libertes: 1,
};
/**
 * Plafond doux de l'amplification (points de note) : les petits écarts sont pleinement amplifiés, les grands chocs
 * (coupes massives, crises) restent ressentis mais bornés, pour qu'une politique de rigueur reste jouable.
 */
export const SAT_AMP_CAP = 7;
/** Accoutumance : part de l'écart brut − référence absorbée chaque mois (1/72 ≈ constante de temps de 6 ans). */
export const SAT_HABIT = 1 / 72;
/** Effet de surprise : part de la variation mensuelle de la note brute ajoutée en impulsion. */
export const SAT_SURPRISE = 1.2;
/** Décroissance mensuelle des impulsions (annonce, surprise). */
export const SAT_IMPULSE_DECAY = 0.85;
/** Effet d'annonce : points de note par unité de variation relative du budget (borné), et aversion aux coupes. */
export const SAT_ANNOUNCE = 50;
export const SAT_CUT_AVERSION = 1.3;
/** Vitesse d'ajustement mensuelle de la satisfaction d'une catégorie vers sa cible. */
export const SAT_SPEED = 0.35;
/** Lignes budgétaires perçues par chaque facteur (effet d'annonce). */
const ANNOUNCE_MAP: Partial<Record<string, Partial<Record<Factor, number>>>> = {
  sante: { sante: 1 }, education: { education: 1 }, formation: { education: 0.3, emploi: 0.3 }, securite: { securite: 1 },
  transports: { transports: 1 }, infrastructures: { transports: 0.5 }, logement: { logement: 1 }, environnement: { environnement: 0.6 },
  administration: { services: 1 },
};
export const CRISIS_DRIVER = 'crises';

/** Notes brutes de chaque facteur pour chaque catégorie (0..100). */
function rawFactors(S: GameState, P: Policy, calibrate: boolean, fin0: number) {
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
    // stabilité : dérapage de la dette ou du déficit sanctionné ; un déficit réduit par rapport au début rassure (crédibilité)
    stabilite: clamp(72 - 120 * Math.max(0, debtRatio - 0.9) - 300 * Math.max(0, deficit - 0.04) + 300 * clamp(fin0 - deficit, -0.04, 0.04), 0, 100),
    libertes: 70,
  };
  const out = {} as Record<CategoryId, Record<Factor, number>>;
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
    out[c] = f;
  }
  return { raw: out, u, deficit };
}

/** Budgets rapportés aux besoins (population × coût salarial) : constants si l'on ne fait que suivre l'indexation. */
function budgetPerNeed(S: GameState, P: Policy) {
  const pop = Math.max(1, S.demography.cohorts.reduce((s, v) => s + v, 0));
  const priceRel = S.baseline.meanWage > 0 && S.accounts.meanWage > 0 ? S.accounts.meanWage / S.baseline.meanWage : S.macro.priceLevel;
  const out: Record<string, number> = {};
  for (const line of Object.keys(ANNOUNCE_MAP)) out[line] = (P.budget[line as keyof Policy['budget']] ?? 0) / (pop * priceRel);
  return out;
}

const zeroFactors = () => Object.fromEntries(FACTORS.map((k) => [k, 0])) as Record<Factor, number>;

export function satisfactionStep(S: GameState, P: Policy, calibrate: boolean) {
  const prevDyn = S.satisfaction.dyn;
  const deficitNow = -S.accounts.balance / Math.max(1, S.accounts.gdp);
  const fin0 = calibrate || !prevDyn ? deficitNow : prevDyn.fin0 ?? deficitNow;
  const { raw, u } = rawFactors(S, P, calibrate, fin0);
  const counts = S.demography.categories;
  const budget = budgetPerNeed(S, P);
  // Nouvelle partie (ou ancienne sauvegarde) : le ressenti part de la note brute, sans impulsion.
  const fresh = calibrate || !prevDyn;
  const dyn: SatDyn = fresh
    ? { ref: {}, prev: {}, imp: {}, budget, sc: {}, sc0: {}, fin0 }
    : { ref: prevDyn.ref, prev: prevDyn.prev, imp: prevDyn.imp, budget, sc: prevDyn.sc, sc0: prevDyn.sc0, fin0 };
  // effet d'annonce budgétaire (commun à toutes les catégories, pondéré ensuite par leurs priorités)
  const announce = zeroFactors();
  if (!fresh) {
    for (const [line, map] of Object.entries(ANNOUNCE_MAP)) {
      const before = prevDyn.budget[line];
      if (!before || !map) continue;
      const r = budget[line] / before - 1;
      if (Math.abs(r) < 0.002) continue; // indexation et arrondis
      const pts = clamp(SAT_ANNOUNCE * r * (r < 0 ? SAT_CUT_AVERSION : 1), -10, 10);
      for (const [k, wk] of Object.entries(map) as [Factor, number][]) announce[k] += pts * wk;
    }
  }
  const byCategory = {} as Record<CategoryId, number>;
  const factorsAvg: Record<string, number> = {};
  const feltAvg: Record<string, number> = {};
  const contrib = zeroFactors(); // contributions de chaque facteur à la cible générale (points)
  const annContrib = zeroFactors(); // dont impulsions (annonce + surprise)
  let overall = 0;
  let weightPop = 0;
  for (const c of CATEGORY_IDS) {
    const f = raw[c];
    if (fresh || !dyn.ref[c]) { dyn.ref[c] = { ...f }; dyn.prev[c] = { ...f }; dyn.imp[c] = zeroFactors(); }
    const ref = dyn.ref[c], prev = dyn.prev[c], imp = dyn.imp[c];
    const felt = {} as Record<Factor, number>;
    for (const k of FACTORS) {
      if (!fresh) {
        imp[k] = (imp[k] ?? 0) * SAT_IMPULSE_DECAY + SAT_SURPRISE * (f[k] - (prev[k] ?? f[k])) + announce[k];
        imp[k] = clamp(imp[k], -25, 25);
      }
      const r0 = ref[k] ?? f[k];
      felt[k] = clamp(f[k] + SAT_AMP_CAP * Math.tanh(((SAT_GAIN[k] - 1) * (f[k] - r0)) / SAT_AMP_CAP) + (imp[k] ?? 0), 0, 100);
      if (!fresh) ref[k] = r0 + (f[k] - r0) * SAT_HABIT;
      prev[k] = f[k];
    }
    const w = W[c];
    let sum = 0;
    let ws = 0;
    for (const [k, v] of Object.entries(w) as [Factor, number][]) { sum += felt[k] * v; ws += v; }
    const score = sum / ws;
    byCategory[c] = fresh || !S.satisfaction.byCategory[c] ? score : S.satisfaction.byCategory[c] + (score - S.satisfaction.byCategory[c]) * SAT_SPEED;
    const n = counts[c] || 0;
    overall += byCategory[c] * n;
    weightPop += n;
    for (const k of FACTORS) { factorsAvg[k] = (factorsAvg[k] || 0) + f[k] * n; feltAvg[k] = (feltAvg[k] || 0) + felt[k] * n; }
    for (const [k, v] of Object.entries(w) as [Factor, number][]) {
      contrib[k] += (n * v * felt[k]) / ws;
      annContrib[k] += (n * v * clamp(imp[k] ?? 0, -felt[k], 100)) / ws;
    }
  }
  const wp = Math.max(1, weightPop);
  for (const k of FACTORS) { factorsAvg[k] /= wp; feltAvg[k] /= wp; contrib[k] /= wp; annContrib[k] /= wp; }
  overall /= wp;
  // contributions lissées au même rythme que les catégories : leur somme suit la satisfaction générale ; l'écart restant
  // vient des chocs appliqués directement par les événements (crises, grèves…)
  const prevSc = { ...dyn.sc };
  for (const k of FACTORS) dyn.sc[k] = fresh || dyn.sc[k] === undefined ? contrib[k] : dyn.sc[k] + (contrib[k] - dyn.sc[k]) * SAT_SPEED;
  if (fresh) dyn.sc0 = { ...dyn.sc };
  const scSum = FACTORS.reduce((s, k) => s + dyn.sc[k], 0);
  const crisis = overall - scSum;
  const prevCrisis = fresh ? crisis : (prevSc[CRISIS_DRIVER] ?? crisis);
  dyn.sc[CRISIS_DRIVER] = crisis;
  if (fresh) dyn.sc0[CRISIS_DRIVER] = crisis;
  const drivers: SatDriver[] = FACTORS.map((k) => ({
    id: k, label: FACTOR_NAMES[k],
    level: dyn.sc[k] - (dyn.sc0[k] ?? dyn.sc[k]),
    delta: fresh ? 0 : dyn.sc[k] - (prevSc[k] ?? dyn.sc[k]),
    announce: annContrib[k],
  }));
  drivers.push({ id: CRISIS_DRIVER, label: 'Crises et événements', level: crisis - (dyn.sc0[CRISIS_DRIVER] ?? 0), delta: crisis - prevCrisis, announce: 0 });
  const prevOverall = S.satisfaction.overall || overall;
  const trust = calibrate ? overall : S.satisfaction.trust + (overall - S.satisfaction.trust) * 0.06;
  const sig = (x: number) => 1 / (1 + Math.exp(-x));
  const workers = ((byCategory.ouvriers || 50) + (byCategory.employes || 50)) / 2;
  return {
    overall,
    byCategory,
    factors: factorsAvg,
    felt: feltAvg,
    trust,
    protestRisk: sig((45 - overall) / 6 + (prevOverall - overall) * 0.5),
    strikeRisk: sig((45 - workers) / 6 + (u - 0.09) * 20),
    unrestRisk: sig((32 - overall) / 5 + (u - 0.15) * 15),
    drivers,
    dyn,
  };
}

function rateSum(P: Policy) {
  let s = 0;
  for (const b of Object.values(P.contributions)) s += b.employer + b.employee;
  return s;
}

/** Points de satisfaction d'un quartier par unité de log(accès relatif) aux équipements. */
const LOCAL_ACCESS_GAIN = 12;
const LOCAL_SERVICES: [readonly string[], (S: GameState) => number][] = [
  [HEALTH_INFRA, (S) => S.health?.otherBeds ?? 0],
  [SCHOOL_INFRA, (S) => S.education?.otherSchoolPlaces ?? 0],
  [['commissariat'], () => 0],
];
/**
 * Accès de chaque quartier aux équipements de proximité (soins, écoles, police) : moyenne des log des capacités par
 * habitant rapportées à la moyenne nationale. Les capacités agrégées (petits établissements) sont réparties au prorata
 * de la population ; un équipement construit (ou démoli) dans un quartier y change donc l'accès.
 */
function localAccess(S: GameState): number[] {
  const n = S.cities.length;
  const out = new Array(n).fill(0);
  for (const [types, other] of LOCAL_SERVICES) {
    const cap = new Array(n).fill(0);
    for (const i of S.country.infra) if (i.cityId !== null && i.cityId !== undefined && i.cityId < n && types.includes(i.type) && (!i.status || i.status === 'active')) cap[i.cityId] += i.capacity;
    const o = other(S);
    const total = cap.reduce((a, b) => a + b, 0) + o;
    if (total <= 0) continue;
    for (let k = 0; k < n; k++) {
      const sh = Math.max(1e-6, S.cities[k].popShare);
      // plancher : un quartier sans équipement garde un accès minimal (équipements voisins)
      out[k] += Math.log(Math.max(0.3, (cap[k] + o * sh) / (sh * total))) / LOCAL_SERVICES.length;
    }
  }
  return out;
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
  const access = localAccess(S);
  const attract: number[] = [];
  defs.forEach((c, k) => {
    const cs = S.cities[k];
    cs.population = pop * cs.popShare;
    const ratio = jobs[k] / Math.max(1, cs.population) / Math.max(1e-6, jobsRatioAvg);
    cs.unemployment = clamp(uNat + (1 - uNat) * (1 - ratio) * 0.45, 0.02, 0.4);
    const wi = jobs[k] > 0 ? wageIdx[k] / jobs[k] / natWage : 1;
    cs.income = perCapIncome * (1 + 0.8 * (wi - 1));
    // effet de quartier : emploi local, salaires, accès aux équipements (écart au début de partie), annonces locales
    if (cs.localRef === undefined || calibrate) cs.localRef = access[k];
    if (!calibrate) cs.localImpulse = (cs.localImpulse ?? 0) * SAT_IMPULSE_DECAY;
    const local = -400 * (cs.unemployment - uNat) + 20 * (wi - 1) + (c.capital ? 2 : 0) + clamp(LOCAL_ACCESS_GAIN * (access[k] - cs.localRef), -8, 8) + (cs.localImpulse ?? 0);
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

/**
 * Effet d'annonce d'une décision ponctuelle (recrutement, programme d'équipement, plan logement) : `pts` points de note
 * sur le facteur, ressentis dès le mois suivant par toutes les catégories (selon leurs priorités), puis s'estompant.
 * `line` : ligne budgétaire relevée par la décision, resynchronisée pour ne pas compter deux fois l'annonce.
 * `cityId` : quartier concerné, qui ressent en plus un effet local.
 */
export function announceDecision(S: GameState, factor: Factor, pts: number, opts: { line?: string; cityId?: number } = {}) {
  const dyn = S.satisfaction.dyn;
  if (!dyn) return;
  const v = clamp(pts, -12, 12);
  for (const c of Object.keys(dyn.imp)) dyn.imp[c][factor] = clamp((dyn.imp[c][factor] ?? 0) + v, -25, 25);
  if (opts.line && opts.line in dyn.budget) dyn.budget[opts.line] = budgetPerNeed(S, S.pending?.policy ?? S.policy)[opts.line];
  if (opts.cityId !== undefined && S.cities[opts.cityId]) {
    const cs = S.cities[opts.cityId];
    cs.localImpulse = clamp((cs.localImpulse ?? 0) + v * 0.6, -10, 10);
  }
}
