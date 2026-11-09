// Logement : parc social et privé, construction (délai de chantier), démolitions, rénovation énergétique,
// vacance (taxe sur les logements vacants), prix et loyers, densité. Offre vs demande (ménages = population / 2,2) :
// une offre insuffisante provoque une crise (prix et loyers ↑, `services.logement` ↓ → natalité et migrations ↓).
import { clamp } from './economy';
import type { GameState } from './types';
import { population, priceRel, pw } from './workforce';

export interface HousingPolicy {
  socialProgram: number; // logements sociaux construits par l'État en plus du rythme des bailleurs (logements/an)
  renovationProgram: number; // rénovations énergétiques financées directement par l'État (logements/an)
  insulationSubsidy: number; // part du coût des rénovations privées subventionnée (0..0,8)
  buildSubsidy: number; // prime à la construction neuve (€ par logement)
  rentControl: number; // encadrement des loyers (0 = libre, 1 = gel en termes réels)
  permits: number; // facilité d'urbanisme : terrains constructibles et délivrance des permis (1 = référence)
  greenStandard: number; // part des logements neufs aux normes écologiques (bâtiments bas carbone)
}
export const DEFAULT_HOUSING_POLICY: HousingPolicy = { socialProgram: 0, renovationProgram: 0, insulationSubsidy: 0, buildSubsidy: 0, rentControl: 0, permits: 1, greenStandard: 0.2 };
export const HOUSING_BOUNDS: Record<keyof HousingPolicy, [number, number]> = {
  socialProgram: [0, 200000], renovationProgram: [0, 500000], insulationSubsidy: [0, 0.8], buildSubsidy: [0, 60000], rentControl: [0, 1], permits: [0.1, 2.5], greenStandard: [0, 1],
};

export const HOUSING_CONST = {
  householdSize: 2.2,
  unitCost: 210000, // coût de construction d'un logement (€, prix de base)
  socialUnitCost: 180000,
  renovationCost: 32000, // rénovation énergétique complète
  demolition: 0.0025, // part du parc démolie par an
  buildMonths: 24, // durée moyenne d'un chantier de logements
  pricePerM2: 3300, // prix moyen de départ (€/m²)
  rentPerM2: 13, // loyer moyen de départ (€/m²/mois)
};

export interface HousingState {
  stock: number; // logements (résidences principales + vacants)
  social: number; // dont logements sociaux
  efficient: number; // part des logements performants (rénovés ou récents)
  pipelinePrivate: number[]; // logements privés en chantier (livrés dans i + 1 mois)
  pipelineSocial: number[];
  extraByCity: Record<number, number>; // logements des zones construites par le joueur, par ville
  plans: HousingPlan[]; // plans ponctuels décidés par le ministère (rénovation, construction sociale)
  priceIdx: number; // prix réel (1 = départ)
  rentIdx: number; // loyer réel (1 = départ)
  ref: { tension: number; incomePerCap: number; socialShare: number; efficient: number; baseRate: number; area: number };
  // indicateurs
  households: number;
  vacancy: number; // part de logements vacants
  structuralVacancy: number; // vacance de rotation (réduite par la taxe sur les logements vacants)
  tension: number; // ménages / logements disponibles (1 = équilibre de départ)
  startsPrivate: number; // mises en chantier privées (logements/an)
  startsSocial: number;
  completions: number; // livraisons (logements/an)
  renovations: number; // rénovations (logements/an)
  avgPrice: number; // €/m² courants
  avgRent: number; // €/m²/mois courants
  effortRate: number; // part du revenu consacrée au logement (locataires)
  socialWaiting: number; // ménages en attente d'un logement social
  density: number; // habitants par km² urbanisé
  energyFactor: number; // consommation d'énergie des logements (1 = départ), lue par le moteur énergie
  quality: number; // 0..1 → `services.logement`
  publicSpend: number; // dépenses publiques de logement hors aides (€/an courants)
}

/** Plan ponctuel : `total` logements traités à raison de `perMonth` par mois (coût payé au fil de l'eau). */
export interface HousingPlan { id: number; kind: 'renovation' | 'social'; total: number; done: number; perMonth: number; started: number }

export type HousingAction = { type: 'planLogement'; kind: 'renovation' | 'social'; units: number; months?: number } | { type: 'annulerPlanLogement'; planId: number };

/** Lance un plan (« rénover 50 000 logements en 36 mois », « construire 10 000 logements sociaux »). */
export function applyHousingAction(S: GameState, a: HousingAction): { ok: boolean; code?: string; msg: string; planId?: number; cost?: number } {
  const L = S.housing;
  if (!L) return { ok: false, code: 'INDISPONIBLE', msg: 'Module logement indisponible' };
  if (a.type === 'annulerPlanLogement') {
    const p = L.plans.find((x) => x.id === Number(a.planId));
    if (!p) return { ok: false, code: 'INTROUVABLE', msg: 'Plan introuvable' };
    L.plans = L.plans.filter((x) => x !== p);
    return { ok: true, msg: `Plan arrêté (${Math.round(p.done).toLocaleString('fr-FR')} logements traités)` };
  }
  if (a.type !== 'planLogement' || (a.kind !== 'renovation' && a.kind !== 'social')) return { ok: false, code: 'ACTION_INCONNUE', msg: 'Action inconnue' };
  const units = Math.floor(Number(a.units) || 0);
  const max = a.kind === 'renovation' ? L.stock * 0.2 : L.stock * 0.05;
  if (units < 100 || units > max) return { ok: false, code: 'MONTANT', msg: `Nombre de logements invalide (100 à ${Math.round(max).toLocaleString('fr-FR')})` };
  const months = clamp(Math.round(Number(a.months) || 36), 6, 120);
  const id = L.plans.reduce((m, p) => Math.max(m, p.id), 0) + 1;
  L.plans.push({ id, kind: a.kind, total: units, done: 0, perMonth: units / months, started: S.month });
  const unit = a.kind === 'renovation' ? HOUSING_CONST.renovationCost : HOUSING_CONST.socialUnitCost;
  const cost = units * unit * priceRel(S);
  const label = a.kind === 'renovation' ? 'rénovation énergétique' : 'construction de logements sociaux';
  return { ok: true, planId: id, cost, msg: `Plan de ${label} : ${units.toLocaleString('fr-FR')} logements sur ${months} mois (≈ ${(cost / 1e9).toFixed(2).replace('.', ',')} Md€)` };
}

const pipeSum = (a: number[]) => a.reduce((s, v) => s + v, 0);
const structuralVacancy = (S: GameState) => 0.075 * clamp(1 - 3 * S.policy.property.vacancyRate, 0.4, 1) + 0.01 * S.policy.housing.rentControl;
const realIncomePerCap = (S: GameState) => S.accounts.disposableIncome / Math.max(1, population(S)) / S.macro.priceLevel;
export const urbanArea = (S: GameState) => S.country.cities.reduce((s, c) => s + Math.PI * c.radius * c.radius, 0);

export function initHousing(S: GameState): HousingState {
  const pop = population(S);
  const households = pop / HOUSING_CONST.householdSize;
  const vac = structuralVacancy(S);
  const stock = households / (1 - vac);
  const baseRate = 0.005; // mises en chantier privées de référence (part du parc par an) : démolitions + croissance des ménages
  const monthly = (stock * baseRate) / 12;
  const socialMonthly = (stock * 0.17 * 0.006) / 12;
  return {
    stock, social: stock * 0.17, efficient: 0.25,
    pipelinePrivate: new Array(HOUSING_CONST.buildMonths).fill(monthly), pipelineSocial: new Array(HOUSING_CONST.buildMonths).fill(socialMonthly),
    extraByCity: {}, plans: [], priceIdx: 1, rentIdx: 1,
    ref: { tension: 1, incomePerCap: realIncomePerCap(S), socialShare: 0.17, efficient: 0.25, baseRate, area: urbanArea(S) },
    households, vacancy: vac, structuralVacancy: vac, tension: 1, startsPrivate: monthly * 12, startsSocial: socialMonthly * 12, completions: (monthly + socialMonthly) * 12,
    renovations: stock * 0.008, avgPrice: HOUSING_CONST.pricePerM2, avgRent: HOUSING_CONST.rentPerM2, effortRate: 0.22, socialWaiting: Math.max(0, households * S.accounts.poverty * 0.5 - stock * 0.17 * 0.95),
    density: pop / Math.max(1, urbanArea(S)), energyFactor: 1, quality: 0.8, publicSpend: 0,
  };
}

/** Un mois du marché du logement. Renvoie la dépense publique du mois hors budget « logement » (€/an courants). */
export function housingStep(S: GameState): number {
  const L = S.housing!;
  const P = S.policy.housing;
  const pr = priceRel(S);
  const pop = population(S);
  const T = S.research?.effects;
  L.households = pop / HOUSING_CONST.householdSize;
  // ----- Livraisons, démolitions -----
  const donePrivate = L.pipelinePrivate.shift() ?? 0;
  const doneSocial = L.pipelineSocial.shift() ?? 0;
  const demolished = (L.stock * HOUSING_CONST.demolition) / 12;
  const newEff = P.greenStandard + (1 - P.greenStandard) * 0.6; // les logements neufs sont majoritairement performants
  const effUnits = L.efficient * L.stock - demolished * Math.min(L.efficient, 0.1) + (donePrivate + doneSocial) * newEff;
  L.social += doneSocial - demolished * (L.social / L.stock);
  L.stock += donePrivate + doneSocial - demolished;
  // ----- Vacance, tension, prix, loyers -----
  L.structuralVacancy = structuralVacancy(S);
  const available = L.stock * (1 - L.structuralVacancy);
  L.tension = L.households / Math.max(1, available) / L.ref.tension;
  L.vacancy = clamp(1 - L.households / L.stock, 0, 0.5);
  const income = realIncomePerCap(S) / Math.max(1, L.ref.incomePerCap);
  const rateF = clamp(1 - 5 * (S.finance.marketRate - 0.03), 0.7, 1.3);
  const priceTarget = pw(L.tension, 5) * pw(income, 1) * rateF;
  L.priceIdx += (priceTarget - L.priceIdx) * 0.02;
  let rentTarget = pw(L.tension, 3) * pw(income, 0.7);
  if (P.rentControl > 0 && rentTarget > 1) rentTarget = 1 + (rentTarget - 1) * (1 - P.rentControl);
  L.rentIdx += (rentTarget - L.rentIdx) * 0.03;
  // ----- Mises en chantier -----
  const costIdx = (1 + 0.08 * Math.max(0, P.greenStandard - 0.2)) * (T?.housing.buildCost ?? 1);
  const subsidyF = 1 + 1.5 * (P.buildSubsidy / (HOUSING_CONST.unitCost * pr));
  const conf = clamp(0.7 + 0.6 * S.macro.confidence, 0.5, 1.3);
  const vacF = clamp(pw(L.structuralVacancy / Math.max(0.01, L.vacancy), 3), 0.2, 2); // les promoteurs ralentissent quand les logements vides s'accumulent
  // réponse des promoteurs à la rentabilité (prix / coût) et à la vacance, plafonnée par le foncier constructible (permis)
  const market = clamp(pw(L.priceIdx / (costIdx * Math.max(0.3, income)), 3) * vacF * rateF * (1 - 0.2 * P.rentControl) * subsidyF * conf, 0.05, 4);
  const startsPrivate = L.ref.baseRate * L.stock * Math.min(market, 1.6 * P.permits) * pw(P.permits, 0.5);
  // plans ponctuels du ministère
  let planSocial = 0;
  let planReno = 0;
  for (const p of L.plans) {
    const n = Math.min(p.perMonth, p.total - p.done);
    p.done += n;
    if (p.kind === 'social') planSocial += n; else planReno += n;
  }
  L.plans = L.plans.filter((p) => p.done < p.total - 1e-6);
  const startsSocial = L.social * 0.006 * pw(P.permits, 0.3) + P.socialProgram + planSocial * 12;
  L.pipelinePrivate.push(startsPrivate / 12);
  L.pipelineSocial.push(startsSocial / 12);
  L.startsPrivate = startsPrivate;
  L.startsSocial = startsSocial;
  L.completions = (donePrivate + doneSocial) * 12;
  // ----- Rénovation énergétique -----
  const privateReno = L.stock * 0.008 * (1 + 2.5 * P.insulationSubsidy) * clamp(1 - 0.3 * P.rentControl, 0.7, 1);
  L.renovations = privateReno + P.renovationProgram + planReno * 12;
  const renoEff = (L.renovations / 12) * (1 - L.efficient);
  L.efficient = clamp((effUnits + renoEff) / L.stock, 0, 1);
  L.energyFactor = clamp(1 - 0.45 * (L.efficient - L.ref.efficient), 0.4, 1.2) * (T?.housing.energy ?? 1);
  // ----- Indicateurs -----
  L.avgPrice = HOUSING_CONST.pricePerM2 * L.priceIdx * S.macro.priceLevel;
  L.avgRent = HOUSING_CONST.rentPerM2 * L.rentIdx * S.macro.priceLevel;
  L.effortRate = clamp(0.22 * L.rentIdx / Math.max(0.3, income), 0.05, 0.7);
  L.socialWaiting = Math.max(0, L.households * S.accounts.poverty * 0.5 - L.social * 0.95);
  const extra = Object.values(L.extraByCity).reduce((s, v) => s + v, 0);
  L.density = pop / Math.max(1, L.ref.area + extra / 4000);
  const socialShare = L.social / L.stock;
  L.quality = clamp(0.8 - 3 * (L.tension - 1) - 0.35 * (L.rentIdx / Math.max(0.3, income) - 1) - 0.1 * (L.priceIdx / Math.max(0.3, income) - 1) + 0.4 * (socialShare - L.ref.socialShare) + 0.1 * (L.efficient - L.ref.efficient), 0, 1);
  // ----- Dépense publique (€/an courants) -----
  const spend = (P.socialProgram + planSocial * 12) * HOUSING_CONST.socialUnitCost * costIdx * pr
    + (P.renovationProgram + planReno * 12) * HOUSING_CONST.renovationCost * pr
    + P.insulationSubsidy * privateReno * HOUSING_CONST.renovationCost * pr
    + P.buildSubsidy * startsPrivate;
  L.publicSpend = spend;
  return spend;
}

/** Logements en chantier (privés + sociaux). */
export const housingUnderConstruction = (L: HousingState) => pipeSum(L.pipelinePrivate) + pipeSum(L.pipelineSocial);

/** Ajoute des logements livrés par une zone construite (quartier, éco-quartier, résidence sociale). */
export function addHousingUnits(S: GameState, units: number, opts: { social?: boolean; efficient?: boolean; cityId: number | null }) {
  const L = S.housing;
  if (!L) return;
  const eff = L.efficient * L.stock + (opts.efficient ? units : units * 0.6);
  L.stock += units;
  if (opts.social) L.social += units;
  L.efficient = clamp(eff / L.stock, 0, 1);
  if (opts.cityId !== null) L.extraByCity[opts.cityId] = (L.extraByCity[opts.cityId] ?? 0) + units;
}

/** Répartit le parc entre les villes (après `citiesStep`, qui recalcule la population locale). */
export function distributeHousing(S: GameState) {
  const L = S.housing;
  if (!L) return;
  const extra = Object.values(L.extraByCity).reduce((s, v) => s + v, 0);
  const base = Math.max(0, L.stock - extra);
  S.cities.forEach((c, k) => { c.housingUnits = base * c.popShare + (L.extraByCity[k] ?? 0); });
}
