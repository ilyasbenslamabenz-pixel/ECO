// Orchestration des modules services publics / recherche / construction : politiques par défaut et bornes,
// initialisation calibrée, pas mensuel, actions des ministères, historique, parcs d'équipements par ville.
import { clamp } from './economy';
import { applyBuildAction, constructionAccounts, constructionProgress, initConstruction, type BuildAction, type BuildResult } from './construction';
import { DEFAULT_EDUCATION_POLICY, EDUCATION_BOUNDS, EDUCATION_ROLES, educationRecruit, educationStep, initEducation, SCHOOL_INFRA, UNI_INFRA, type EducationPolicy, type EducationRole } from './education';
import { DEFAULT_HEALTH_POLICY, HEALTH_BOUNDS, HEALTH_INFRA, HEALTH_ROLES, healthRecruit, healthStep, initHealth, type HealthPolicy, type HealthRole } from './health';
import { applyHousingAction, DEFAULT_HOUSING_POLICY, distributeHousing, housingStep, HOUSING_BOUNDS, initHousing, type HousingAction, type HousingPolicy } from './housing';
import { applyResearchAction, DEFAULT_RESEARCH_POLICY, initResearch, researchStep, type ResearchAction, type ResearchPolicy } from './research';
import { DEFAULT_SECURITY_POLICY, initSecurity, SECURITY_BOUNDS, SECURITY_ROLES, securityRecruit, securityStep, type SecurityPolicy, type SecurityRole } from './security';
import type { GameState, Notice, Policy } from './types';

export interface ServicesPolicy { health: HealthPolicy; education: EducationPolicy; housing: HousingPolicy; security: SecurityPolicy; research: ResearchPolicy }

export function defaultServicesPolicy(): ServicesPolicy {
  return { health: { ...DEFAULT_HEALTH_POLICY }, education: { ...DEFAULT_EDUCATION_POLICY }, housing: { ...DEFAULT_HOUSING_POLICY }, security: { ...DEFAULT_SECURITY_POLICY }, research: { ...DEFAULT_RESEARCH_POLICY } };
}

function bound<T extends object>(input: unknown, current: T | undefined, defaults: T, bounds: Record<string, [number, number]>): T {
  const cur = { ...defaults, ...(current ?? {}) } as Record<string, number>;
  const inp = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const k of Object.keys(defaults)) {
    const [a, b] = bounds[k] ?? [0, 1];
    const n = Number(inp[k]);
    out[k] = Number.isFinite(n) ? clamp(n, a, b) : cur[k];
  }
  return out as T;
}

/** Bornes des sous-politiques (appelé par `sanitizePolicy`). */
export function sanitizeServicesPolicy(i: Partial<Policy> | undefined, c: Partial<Policy>): ServicesPolicy {
  const d = defaultServicesPolicy();
  return {
    health: bound(i?.health, c.health, d.health, HEALTH_BOUNDS),
    education: bound(i?.education, c.education, d.education, EDUCATION_BOUNDS),
    housing: bound(i?.housing, c.housing, d.housing, HOUSING_BOUNDS),
    security: bound(i?.security, c.security, d.security, SECURITY_BOUNDS),
    research: bound(i?.research, c.research, d.research, { applied: [0, 1] }),
  };
}

/** Initialisation calibrée : à l'état initial, chaque module reproduit exactement une qualité de 0,80. */
export function initServicesModules(S: GameState) {
  const d = defaultServicesPolicy();
  S.policy.health ??= d.health;
  S.policy.education ??= d.education;
  S.policy.housing ??= d.housing;
  S.policy.security ??= d.security;
  S.policy.research ??= d.research;
  S.research = initResearch();
  S.construction = initConstruction(S);
  S.health = initHealth(S);
  S.education = initEducation(S);
  S.security = initSecurity(S);
  S.housing = initHousing(S);
  S.accounts.spending.equipements ??= 0;
}

/** Pour les sauvegardes antérieures aux modules : complète la politique et initialise les modules manquants. */
export function ensureServicesModules(S: GameState) {
  if (S.health && S.education && S.security && S.housing && S.research && S.construction && S.policy.health) return;
  initServicesModules(S);
}

/** Qualité produite par un module (null = ligne budgétaire non modélisée : formule générique de `servicesStep`). */
export function modeledQuality(S: GameState, line: string): number | null {
  if (line === 'sante' && S.health) return S.health.quality;
  if (line === 'education' && S.education) return S.education.quality;
  if (line === 'securite' && S.security) return S.security.quality;
  if (line === 'logement' && S.housing) return S.housing.quality;
  return null;
}

type Notify = (kind: Notice['kind'], title: string, text: string) => void;

/** Pas mensuel des modules (après l'économie, avant `servicesStep`). */
export function servicesModulesStep(S: GameState, notify: Notify) {
  ensureServicesModules(S);
  researchStep(S, notify);
  const installments = constructionProgress(S, notify);
  healthStep(S);
  educationStep(S);
  // capital humain : remplace l'effet instantané de la qualité de l'éducation sur la productivité
  const eff = S.education!.productivityEffect;
  if (eff) {
    for (const s of S.sectors) s.productivity *= 1 + eff / 12;
    S.macro.productivityGrowth += eff;
  }
  securityStep(S);
  const housingSpend = housingStep(S);
  constructionAccounts(S, installments, housingSpend);
}

/** Après `citiesStep` : répartition du parc de logements entre les villes. */
export function servicesPostStep(S: GameState) {
  distributeHousing(S);
}

// ---------- Actions des ministères ----------
export type RecruitAction = { type: 'recruter'; service: 'sante' | 'education' | 'securite'; role: HealthRole | EducationRole | SecurityRole; count: number };
export type ServicesAction = RecruitAction | ResearchAction | BuildAction | HousingAction;
export interface ServicesResult { ok: boolean; code?: string; msg: string; [k: string]: unknown }

const BUDGET_OF = { sante: 'sante', education: 'education', securite: 'securite' } as const;

export function applyServicesAction(S: GameState, a: ServicesAction, notify?: Notify): ServicesResult | BuildResult {
  ensureServicesModules(S);
  if (!a || typeof a !== 'object') return { ok: false, code: 'ACTION_INCONNUE', msg: 'Action invalide' };
  switch (a.type) {
    case 'recruter': {
      const count = Math.floor(Number(a.count) || 0);
      if (count <= 0) return { ok: false, code: 'MONTANT', msg: 'Nombre de postes invalide' };
      let r: { n: number; budget: number; delay: number } | null = null;
      let label = '';
      if (a.service === 'sante' && a.role in HEALTH_ROLES) { r = healthRecruit(S, a.role as HealthRole, count); label = HEALTH_ROLES[a.role as HealthRole].label; }
      if (a.service === 'education' && a.role in EDUCATION_ROLES) { r = educationRecruit(S, a.role as EducationRole, count); label = EDUCATION_ROLES[a.role as EducationRole].label; }
      if (a.service === 'securite' && a.role in SECURITY_ROLES) { r = securityRecruit(S, a.role as SecurityRole, count); label = SECURITY_ROLES[a.role as SecurityRole].label; }
      if (!r) return { ok: false, code: 'METIER_INCONNU', msg: 'Service ou métier inconnu' };
      const line = BUDGET_OF[a.service];
      S.policy.budget[line] += r.budget;
      if (S.pending) S.pending.policy.budget[line] += r.budget;
      const msg = `${Math.round(r.n).toLocaleString('fr-FR')} postes de ${label.toLowerCase()} ouverts : prise de poste dans ${r.delay} mois, budget relevé de ${(r.budget / 1e6).toFixed(0)} M€/an`;
      notify?.('info', 'Plan de recrutement', msg + '.');
      return { ok: true, msg, recruited: r.n, delay: r.delay, budget: r.budget };
    }
    case 'rechercher': case 'fileRecherche': case 'annulerRecherche':
      return applyResearchAction(S, a);
    case 'planLogement': case 'annulerPlanLogement':
      return applyHousingAction(S, a);
    case 'programme': case 'construire': case 'ameliorer': case 'renover': case 'demolir': case 'annulerChantier':
      return applyBuildAction(S, a, notify);
    default:
      return { ok: false, code: 'ACTION_INCONNUE', msg: 'Action inconnue' };
  }
}

// ---------- Parcs d'équipements par ville ----------
export interface CityFacilities {
  cityId: number;
  beds: number; schoolPlaces: number; uniPlaces: number; doctors: number; teachers: number; police: number; firefighters: number;
  housing: number; hospitals: number; schools: number; policeStations: number; underConstruction: number;
}

/**
 * Parc de capacités de chaque ville : les équipements de la carte situés dans la ville, complétés par une part
 * (au prorata de la population) des capacités nationales non représentées individuellement (petits établissements).
 * Le pays est ainsi entièrement équipé dès le départ, à un niveau de service cohérent.
 */
export function cityFacilities(S: GameState): CityFacilities[] {
  const H = S.health;
  const D = S.education;
  const X = S.security;
  const sum = (cityId: number, types: readonly string[]) => S.country.infra.filter((i) => i.cityId === cityId && types.includes(i.type) && i.status !== 'chantier').reduce((s, i) => s + i.capacity, 0);
  const count = (cityId: number, types: readonly string[]) => S.country.infra.filter((i) => i.cityId === cityId && types.includes(i.type) && i.status !== 'chantier').length;
  return S.cities.map((c, k) => {
    const sh = c.popShare;
    return {
      cityId: k,
      beds: sum(k, HEALTH_INFRA) + (H?.otherBeds ?? 0) * sh,
      schoolPlaces: sum(k, SCHOOL_INFRA) + (D?.otherSchoolPlaces ?? 0) * sh,
      uniPlaces: sum(k, UNI_INFRA) + (D?.otherUniPlaces ?? 0) * sh,
      doctors: (H?.doctors.staff ?? 0) * sh,
      teachers: (D?.teachers.staff ?? 0) * sh,
      police: (X?.police.staff ?? 0) * sh,
      firefighters: (X?.firefighters.staff ?? 0) * sh,
      housing: c.housingUnits,
      hospitals: count(k, HEALTH_INFRA) + Math.round((H?.clinics ?? 0) * sh),
      schools: count(k, SCHOOL_INFRA) + Math.round(((D?.otherSchoolPlaces ?? 0) * sh) / 450),
      policeStations: count(k, ['commissariat']) + Math.round(((X?.police.staff ?? 0) * sh) / 120),
      underConstruction: S.country.infra.filter((i) => i.cityId === k && i.status === 'chantier').length,
    };
  });
}

// ---------- Historique ----------
export const SERVICES_HISTORY_KEYS = [
  'sante_qualite', 'sante_attente', 'sante_medecins', 'sante_infirmiers', 'sante_lits', 'sante_couverture',
  'edu_qualite', 'edu_reussite', 'edu_decrochage', 'edu_capitalHumain', 'edu_enseignants', 'edu_etudiants',
  'logement_qualite', 'logement_prix', 'logement_loyer', 'logement_tension', 'logement_vacance', 'logement_parc', 'logement_chantiers',
  'securite_qualite', 'crime', 'securite_intervention', 'securite_policiers', 'justice_delai',
  'recherche_effort', 'recherche_technologies', 'equipements',
] as const;

export function recordServicesHistory(S: GameState, push: (k: string, v: number) => void) {
  const H = S.health, D = S.education, L = S.housing, X = S.security, R = S.research, K = S.construction;
  if (!H || !D || !L || !X || !R || !K) return;
  push('sante_qualite', H.quality); push('sante_attente', H.waitDays); push('sante_medecins', H.doctors.staff); push('sante_infirmiers', H.nurses.staff);
  push('sante_lits', H.openBeds); push('sante_couverture', H.coverage);
  push('edu_qualite', D.quality); push('edu_reussite', D.successRate); push('edu_decrochage', D.dropout); push('edu_capitalHumain', D.humanCapital);
  push('edu_enseignants', D.teachers.staff); push('edu_etudiants', D.students);
  push('logement_qualite', L.quality); push('logement_prix', L.avgPrice); push('logement_loyer', L.avgRent); push('logement_tension', L.tension);
  push('logement_vacance', L.vacancy); push('logement_parc', L.stock); push('logement_chantiers', L.startsPrivate + L.startsSocial);
  push('securite_qualite', X.quality); push('crime', X.crimeRate); push('securite_intervention', X.policeResponse); push('securite_policiers', X.police.staff); push('justice_delai', X.justiceDelay);
  push('recherche_effort', R.effortMonthly * 12); push('recherche_technologies', R.unlocked.length); push('equipements', K.spend.total);
}
