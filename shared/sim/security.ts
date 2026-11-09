// Sécurité et justice : police, pompiers et protection civile, magistrats et greffes, prisons, centres d'appels
// d'urgence. Criminalité et délinquance liées au chômage, à la pauvreté, au décrochage scolaire et aux effectifs.
// Sortie : `services.securite` (0..1).
import { clamp } from './economy';
import type { GameState } from './types';
import {
  infraCapacity, makeRole, population, priceRel, pw, qualityOf, recruit, roleStep, scalePlan, unemploymentRate,
  type Role, type RoleSpec,
} from './workforce';

export interface SecurityPolicy {
  wageIndex: number; // rémunération des agents (1 = référence)
  investment: number; // part du budget consacrée à l'investissement (véhicules, casernes, tribunaux)
  prevention: number; // part du budget consacrée à la prévention de la délinquance (médiation, éducateurs)
  sentencing: number; // sévérité pénale (1 = référence) : dissuasion mais surpopulation carcérale
}
export const DEFAULT_SECURITY_POLICY: SecurityPolicy = { wageIndex: 1, investment: 0.06, prevention: 0.04, sentencing: 1 };
export const SECURITY_BOUNDS: Record<keyof SecurityPolicy, [number, number]> = {
  wageIndex: [0.7, 1.6], investment: [0, 0.3], prevention: [0, 0.2], sentencing: [0.5, 1.6],
};

export const SECURITY_ROLES = {
  policiers: { label: 'Policiers et gendarmes', cost: 62000, delay: 9, attrition: 0.04, hireRate: 0.008 } as RoleSpec,
  pompiers: { label: 'Pompiers et protection civile', cost: 56000, delay: 6, attrition: 0.04, hireRate: 0.01 } as RoleSpec,
  magistrats: { label: 'Magistrats et greffiers', cost: 72000, delay: 18, attrition: 0.035, hireRate: 0.006 } as RoleSpec,
};
export type SecurityRole = keyof typeof SECURITY_ROLES;
export const SECURITY_INFRA = ['commissariat', 'caserne_pompiers', 'tribunal'] as const;
export const PRISON_INFRA = ['prison'] as const;
const PRISON_PLACE_COST = 42000; // coût annuel d'une place de prison (surveillants compris)
const CRIME_BASE = 52; // crimes et délits enregistrés pour 1 000 habitants par an

export interface SecurityState {
  police: Role;
  firefighters: Role;
  justice: Role;
  plan: { prison: number; ops: number };
  prisonPlaces: number; // places installées
  otherPrisonPlaces: number;
  openPlaces: number; // places financées et ouvertes
  prisoners: number;
  supply: number; condition: number; prevention: number;
  ref: { police: number; firefighters: number; justice: number; ops: number; invest: number; prevention: number; prisoners: number; unemployment: number; poverty: number; costScale: number; pop: number };
  // indicateurs
  crimeRate: number; // crimes et délits pour 1 000 hab./an
  delinquency: number; // indice de délinquance juvénile (100 = référence)
  policeResponse: number; // délai d'intervention de la police (minutes)
  fireResponse: number; // délai d'intervention des pompiers (minutes)
  justiceDelay: number; // délai moyen de jugement (mois)
  prisonOccupancy: number; // détenus / places
  feeling: number; // sentiment de sécurité 0..100
  ratio: number;
  quality: number;
  costPerCapita: number;
}

export function initSecurity(S: GameState): SecurityState {
  const pop = population(S);
  const P = S.policy.security;
  const E = S.policy.budget.securite;
  const police = pop * 0.0031;
  const firefighters = pop * 0.0007;
  const justice = pop * 0.0004;
  const prisoners = pop * 0.00095;
  const places = prisoners / 1.0;
  const core = E * (1 - P.investment - P.prevention);
  const fixed = police * SECURITY_ROLES.policiers.cost + firefighters * SECURITY_ROLES.pompiers.cost + justice * SECURITY_ROLES.magistrats.cost + places * PRISON_PLACE_COST;
  const costScale = Math.min(1, (core * 0.7) / fixed);
  const ops = core - fixed * costScale;
  const prisonInfra = infraCapacity(S, PRISON_INFRA).capacity;
  return {
    police: makeRole(police, SECURITY_ROLES.policiers),
    firefighters: makeRole(firefighters, SECURITY_ROLES.pompiers),
    justice: makeRole(justice, SECURITY_ROLES.magistrats),
    plan: { prison: places, ops }, prisonPlaces: places, otherPrisonPlaces: Math.max(0, places - prisonInfra), openPlaces: places, prisoners,
    supply: 1, condition: 1, prevention: 1,
    ref: { police, firefighters, justice, ops, invest: E * P.investment, prevention: E * P.prevention, prisoners, unemployment: unemploymentRate(S), poverty: S.accounts.poverty, costScale, pop },
    crimeRate: CRIME_BASE, delinquency: 100, policeResponse: 12, fireResponse: 11, justiceDelay: 11, prisonOccupancy: 1, feeling: 62, ratio: 1, quality: qualityOf(1), costPerCapita: E / pop,
  };
}

/** Un mois de sécurité et de justice. */
export function securityStep(S: GameState) {
  const X = S.security!;
  const P = S.policy.security;
  const pr = priceRel(S);
  const pop = population(S);
  const popIdx = pop / X.ref.pop;
  const k = X.ref.costScale;
  const w = P.wageIndex;
  const cP = SECURITY_ROLES.policiers.cost * k * w;
  const cF = SECURITY_ROLES.pompiers.cost * k * w;
  const cJ = SECURITY_ROLES.magistrats.cost * k * w;
  const cPr = PRISON_PLACE_COST * k * (0.4 + 0.6 * w);
  const E = Math.max(0, S.policy.budget.securite) / pr;
  const invest = E * P.investment;
  const prev = E * P.prevention;
  const core = E - invest - prev;
  scalePlan([
    { qty: X.police.posts, unit: cP, set: (q) => (X.police.posts = q) },
    { qty: X.firefighters.posts, unit: cF, set: (q) => (X.firefighters.posts = q) },
    { qty: X.justice.posts, unit: cJ, set: (q) => (X.justice.posts = q) },
    { qty: X.plan.prison, unit: cPr, set: (q) => (X.plan.prison = q) },
    { qty: X.plan.ops, unit: 1, set: (q) => (X.plan.ops = q) },
  ], core);
  X.prisonPlaces = infraCapacity(S, PRISON_INFRA).capacity + X.otherPrisonPlaces;
  if (X.plan.prison > X.prisonPlaces) {
    const excess = (X.plan.prison - X.prisonPlaces) * cPr;
    X.plan.prison = X.prisonPlaces;
    X.plan.ops += excess;
  }
  X.openPlaces += clamp(X.plan.prison - X.openPlaces, -0.02 * X.openPlaces, 0.05 * X.openPlaces);
  // personnel
  const policeR = X.police.staff / (X.ref.police * popIdx);
  const fireR = X.firefighters.staff / (X.ref.firefighters * popIdx);
  const quit = pw(w, -1.2) * (1 + 0.5 * Math.max(0, 1 / Math.max(0.2, policeR) - 1.05));
  roleStep(X.police, SECURITY_ROLES.policiers, { attract: pw(w, 1.5), quitMult: quit, maxCut: 0.006 });
  roleStep(X.firefighters, SECURITY_ROLES.pompiers, { attract: pw(w, 1.5), quitMult: pw(w, -1.2), maxCut: 0.006 });
  roleStep(X.justice, SECURITY_ROLES.magistrats, { attract: pw(w, 1.3), quitMult: pw(w, -1.2), maxCut: 0.004 });
  const opsAvail = core - X.police.staff * cP - X.firefighters.staff * cF - X.justice.staff * cJ - X.openPlaces * cPr;
  X.supply += (clamp(opsAvail / Math.max(1, X.ref.ops * popIdx), 0, 1.4) - X.supply) / 12;
  X.prevention += (prev / Math.max(1, X.ref.prevention) - X.prevention) / 36;
  const investR = invest / Math.max(1, X.ref.invest);
  const infra = infraCapacity(S, SECURITY_INFRA);
  X.condition = infra.count ? infra.condition : clamp(X.condition + (clamp(investR, 0.3, 1) - X.condition) * 0.0015, 0.3, 1);
  // capacité de la justice : affaires à traiter (∝ criminalité) / magistrats
  const justiceR = X.justice.staff / (X.ref.justice * popIdx);
  const load = (X.crimeRate / CRIME_BASE) / Math.max(0.1, justiceR * pw(X.supply, 0.3));
  X.justiceDelay = clamp(11 * pw(load, 1.5), 2, 60);
  // criminalité cible : facteurs sociaux, dissuasion (effectifs, justice, sanctions), prévention, surpopulation carcérale
  const u = unemploymentRate(S);
  const pov = S.accounts.poverty;
  const dropout = S.education?.dropout ?? 0.08;
  const housing = clamp((0.8 - S.services.logement) * 2, 0, 1);
  const overcrowd = Math.max(0, X.prisonOccupancy - 1.15);
  const social = clamp((1 + 2.5 * (u - X.ref.unemployment)) * (1 + 2 * (pov - X.ref.poverty)) * (1 + 0.8 * (dropout - 0.08)) * (1 + 0.1 * housing), 0.4, 3);
  const deterrence = pw(policeR * pw(X.supply, 0.3), -0.35) * pw(Math.min(2, 1 / pw(load, 0.5)), -0.1) * pw(P.sentencing, -0.08);
  const target = CRIME_BASE * social * deterrence * clamp(1 - 0.1 * (X.prevention - 1), 0.75, 1.15) * (1 + 0.25 * overcrowd);
  X.crimeRate += (target - X.crimeRate) * 0.04;
  X.delinquency = clamp(100 * pw(dropout / 0.08, 0.5) * (1 + 3 * (u - X.ref.unemployment)) * clamp(1 - 0.15 * (X.prevention - 1), 0.7, 1.2) * pw(policeR, -0.15), 20, 400);
  // détenus et prisons
  const prisonersTarget = X.ref.prisoners * popIdx * (X.crimeRate / CRIME_BASE) * pw(P.sentencing, 1.2) * pw(Math.min(1.5, justiceR), 0.3);
  X.prisoners += (prisonersTarget - X.prisoners) * 0.02;
  X.prisonOccupancy = X.prisoners / Math.max(1, X.openPlaces);
  // délais d'intervention
  const response = S.research?.effects.security.response ?? 1;
  X.policeResponse = clamp(12 * pw(policeR * pw(X.supply, 0.5) * X.condition, -0.5) * response, 4, 60);
  X.fireResponse = clamp(11 * pw(fireR * pw(X.supply, 0.4) * X.condition, -0.5) * response, 4, 60);
  // qualité et sentiment de sécurité
  const r = pw(policeR, 0.35) * pw(fireR, 0.15) * pw(justiceR, 0.15) * pw(X.supply, 0.1) * pw(X.condition, 0.1) * pw(CRIME_BASE / X.crimeRate, 0.15);
  X.ratio = r;
  X.quality = qualityOf(r);
  X.feeling = clamp(62 - 0.9 * (X.crimeRate - CRIME_BASE) - 0.6 * (X.policeResponse - 12) + 60 * (X.quality - 0.8), 0, 100);
  X.costPerCapita = S.policy.budget.securite / Math.max(1, pop);
}

/** Recrutement exceptionnel : postes créés, budget sécurité relevé du coût annuel. */
export function securityRecruit(S: GameState, role: SecurityRole, count: number) {
  const X = S.security!;
  const P = S.policy.security;
  const r = role === 'policiers' ? X.police : role === 'pompiers' ? X.firefighters : X.justice;
  const spec = SECURITY_ROLES[role];
  const n = Math.min(count, r.staff * 0.15);
  recruit(r, n);
  const annual = n * spec.cost * X.ref.costScale * P.wageIndex * priceRel(S);
  return { n, budget: annual / (1 - P.investment - P.prevention), delay: spec.delay };
}
