// Santé : personnels (médecins, infirmiers) avec délais de recrutement et de formation, lits, réseau de soins
// (cliniques, centres médicaux, pharmacies, ambulances, urgences), capacité face aux besoins d'une population
// vieillissante, temps d'attente, couverture, satisfaction des patients. Sortie : `services.sante` (0..1).
import { AGE_BANDS } from './data';
import { clamp } from './economy';
import type { GameState } from './types';
import {
  infraCapacity, makeRole, population, priceRel, pw, qualityOf, recruit, roleStep, scalePlan,
  type Role, type RoleSpec,
} from './workforce';

export interface HealthPolicy {
  wageIndex: number; // rémunération du personnel soignant (1 = référence)
  prevention: number; // part du budget santé consacrée à la prévention
  investment: number; // part du budget consacrée à l'investissement (équipements, rénovation des hôpitaux)
  bedOpening: number; // part des lits installés effectivement ouverts
  copay: number; // reste à charge moyen des patients (part du coût des soins) : accès aux soins
  trainingSlots: number; // places de formation médicale et paramédicale (1 = référence ; effet après 3 à 6 ans)
}
export const DEFAULT_HEALTH_POLICY: HealthPolicy = { wageIndex: 1, prevention: 0.03, investment: 0.06, bedOpening: 0.95, copay: 0.12, trainingSlots: 1 };
export const HEALTH_BOUNDS: Record<keyof HealthPolicy, [number, number]> = {
  wageIndex: [0.7, 1.6], prevention: [0, 0.15], investment: [0, 0.3], bedOpening: [0.5, 1], copay: [0, 0.5], trainingSlots: [0.3, 3],
};

export const HEALTH_ROLES = {
  medecins: { label: 'Médecins', cost: 118000, delay: 6, attrition: 0.035, hireRate: 0.006 } as RoleSpec,
  infirmiers: { label: 'Infirmiers', cost: 52000, delay: 3, attrition: 0.06, hireRate: 0.012 } as RoleSpec,
};
export type HealthRole = keyof typeof HEALTH_ROLES;
const BED_COST = 125000; // coût annuel de fonctionnement d'un lit ouvert (aides-soignants, logistique, hors médecins/infirmiers)
const TRAINING_SHARE = 0.01; // part du budget consacrée aux écoles de santé à `trainingSlots` = 1
export const HEALTH_INFRA = ['hopital', 'clinique'] as const;
// consommation de soins relative par tranche d'âge quinquennale (0-4 … 100+)
const CARE_WEIGHT = [1.2, 0.5, 0.5, 0.6, 0.7, 0.7, 0.75, 0.8, 0.85, 0.95, 1.05, 1.15, 1.3, 1.5, 1.75, 2.1, 2.5, 3, 3.5, 3.8, 4];

export interface HealthState {
  doctors: Role;
  nurses: Role;
  plan: { beds: number; ops: number }; // lits financés et fonctionnement (€/an, prix de base)
  openBeds: number;
  installedBeds: number; // lits installés (hôpitaux et cliniques de la carte + autres établissements)
  otherBeds: number; // lits des petits établissements non représentés sur la carte
  clinics: number; medicalCenters: number; pharmacies: number; ambulances: number; emergencyUnits: number;
  supply: number; // approvisionnement (médicaments, consommables) 0..1,4
  condition: number; // état moyen des établissements 0..1
  prevention: number; // stock de prévention (1 = référence)
  trainingDoctors: number; // vivier de diplômés (1 = référence), suit les places de formation avec ~6 ans de retard
  trainingNurses: number; // ~3 ans de retard
  need: number; // besoins de soins (unités pondérées par l'âge)
  ref: { doctors: number; nurses: number; beds: number; ops: number; need: number; invest: number; prevention: number; clinics: number; centers: number; pharmacies: number; ambulances: number; emergency: number; costScale: number };
  // indicateurs
  ratio: number; // capacité / besoins (1 = référence)
  quality: number; // 0..1
  waitDays: number; // délai moyen d'accès à un spécialiste (jours)
  emergencyWait: number; // délai d'intervention des secours médicaux (minutes)
  coverage: number; // part de la population ayant un accès effectif aux soins
  patientSatisfaction: number; // 0..100
  costPerCapita: number; // €/hab/an (budget public)
  mortality: number; // décès pour 1 000 habitants
  overload: number; // charge de travail du personnel (1 = normale)
  hiredYear: number; // recrutements sur 12 mois glissants
}

const ageNeed = (S: GameState) => {
  let n = 0;
  for (let b = 0; b < AGE_BANDS; b++) n += S.demography.cohorts[b] * CARE_WEIGHT[b];
  return n;
};

export function initHealth(S: GameState): HealthState {
  const pop = population(S);
  const P = S.policy.health;
  const E = S.policy.budget.sante;
  const core = E * (1 - P.investment - P.prevention - TRAINING_SHARE * P.trainingSlots);
  const doctors = pop * 0.0033;
  const nurses = pop * 0.0082;
  const beds = pop * 0.0054;
  const infraBeds = infraCapacity(S, HEALTH_INFRA).capacity;
  const installed = beds / P.bedOpening;
  // les coûts unitaires sont réduits si le budget initial ne couvre pas un fonctionnement minimal (petits PIB)
  const fixed = doctors * HEALTH_ROLES.medecins.cost + nurses * HEALTH_ROLES.infirmiers.cost + beds * BED_COST;
  const costScale = Math.min(1, (core * 0.6) / fixed);
  const ops = core - fixed * costScale;
  const need = ageNeed(S);
  const H: HealthState = {
    doctors: makeRole(doctors, HEALTH_ROLES.medecins),
    nurses: makeRole(nurses, HEALTH_ROLES.infirmiers),
    plan: { beds, ops }, openBeds: beds, installedBeds: installed, otherBeds: Math.max(0, installed - infraBeds),
    clinics: pop / 45000, medicalCenters: pop / 14000, pharmacies: pop / 3100, ambulances: pop / 2600, emergencyUnits: pop / 150000,
    supply: 1, condition: 1, prevention: 1, trainingDoctors: 1, trainingNurses: 1, need,
    ref: { doctors, nurses, beds, ops, need, invest: E * P.investment, prevention: E * P.prevention, clinics: pop / 45000, centers: pop / 14000, pharmacies: pop / 3100, ambulances: pop / 2600, emergency: pop / 150000, costScale },
    ratio: 1, quality: qualityOf(1), waitDays: 30, emergencyWait: 18, coverage: 0.97, patientSatisfaction: 68, costPerCapita: E / pop, mortality: 0, overload: 1, hiredYear: 0,
  };
  H.installedBeds = installed;
  return H;
}

/** Un mois du système de santé. */
export function healthStep(S: GameState) {
  const H = S.health!;
  const P = S.policy.health;
  const T = S.research?.effects;
  const pr = priceRel(S);
  const pop = population(S);
  const k = H.ref.costScale;
  const w = P.wageIndex;
  const cDoc = HEALTH_ROLES.medecins.cost * k * w;
  const cNur = HEALTH_ROLES.infirmiers.cost * k * w;
  const cBed = BED_COST * k * (0.5 + 0.5 * w);
  // ----- Enveloppe (prix de base) et plan de financement -----
  const E = Math.max(0, S.policy.budget.sante) / pr;
  const invest = E * P.investment;
  const prev = E * P.prevention;
  const core = E - invest - prev - E * TRAINING_SHARE * P.trainingSlots;
  scalePlan([
    { qty: H.doctors.posts, unit: cDoc, set: (q) => (H.doctors.posts = q) },
    { qty: H.nurses.posts, unit: cNur, set: (q) => (H.nurses.posts = q) },
    { qty: H.plan.beds, unit: cBed, set: (q) => (H.plan.beds = q) },
    { qty: H.plan.ops, unit: 1, set: (q) => (H.plan.ops = q) },
  ], core);
  // lits : plafonnés par les lits installés et le taux d'ouverture ; l'excédent finance le personnel et le fonctionnement
  const infra = infraCapacity(S, HEALTH_INFRA);
  H.installedBeds = infra.capacity + H.otherBeds;
  const maxBeds = H.installedBeds * P.bedOpening;
  if (H.plan.beds > maxBeds) {
    const excess = (H.plan.beds - maxBeds) * cBed;
    H.plan.beds = maxBeds;
    scalePlan([
      { qty: H.doctors.posts, unit: cDoc, set: (q) => (H.doctors.posts = q) },
      { qty: H.nurses.posts, unit: cNur, set: (q) => (H.nurses.posts = q) },
      { qty: H.plan.ops, unit: 1, set: (q) => (H.plan.ops = q) },
    ], H.doctors.posts * cDoc + H.nurses.posts * cNur + H.plan.ops + excess);
  }
  H.openBeds += clamp(H.plan.beds - H.openBeds, -0.03 * H.openBeds, 0.05 * H.openBeds);
  // ----- Besoins : population, vieillissement, prévention, reste à charge -----
  H.prevention += (prev / Math.max(1, H.ref.prevention) - H.prevention) / 36;
  const preventionF = clamp(1 - 0.08 * (H.prevention - 1), 0.85, 1.12);
  const copayF = clamp(1 - 0.6 * (P.copay - 0.12), 0.7, 1.1);
  H.need = ageNeed(S) * preventionF * copayF;
  const needIdx = H.need / H.ref.need;
  // ----- Personnel : formation (vivier), attractivité, surcharge -----
  H.trainingDoctors += (P.trainingSlots - H.trainingDoctors) / 72;
  H.trainingNurses += (P.trainingSlots - H.trainingNurses) / 36;
  const docProd = T?.health.doctorProductivity ?? 1;
  const docR = (H.doctors.staff * docProd) / (H.ref.doctors * needIdx);
  const nurseR = H.nurses.staff / (H.ref.nurses * needIdx);
  const bedR = H.openBeds / (H.ref.beds * needIdx);
  H.overload = clamp(1 / Math.max(0.2, pw(docR, 0.5) * pw(nurseR, 0.5)), 0.5, 3);
  const quit = pw(w, -1.2) * (1 + 0.8 * Math.max(0, H.overload - 1.05));
  const a1 = roleStep(H.doctors, HEALTH_ROLES.medecins, { attract: pw(w, 1.5) * H.trainingDoctors, quitMult: quit, maxCut: 0.008 });
  const a2 = roleStep(H.nurses, HEALTH_ROLES.infirmiers, { attract: pw(w, 1.5) * H.trainingNurses, quitMult: quit, maxCut: 0.01 });
  H.hiredYear = H.hiredYear * (11 / 12) + a1.hired + a2.hired;
  // ----- Fonctionnement : ce qui reste une fois payés les agents en poste et les lits ouverts -----
  const opsAvail = core - H.doctors.staff * cDoc - H.nurses.staff * cNur - H.openBeds * cBed;
  const supplyTarget = clamp(opsAvail / Math.max(1, H.ref.ops * needIdx), 0, 1.4);
  H.supply += (supplyTarget - H.supply) / 12; // stocks, reports d'achats
  // ----- Réseau de soins (investissement public pour centres, ambulances, urgences) -----
  const investR = invest / Math.max(1, H.ref.invest);
  const built = (t: string) => S.country.infra.filter((i) => i.type === t && i.custom && i.status !== 'chantier').length;
  const popR = pop / Math.max(1, H.ref.pharmacies * 3100);
  const toward = (cur: number, target: number) => cur + (target - cur) * 0.01;
  H.clinics = toward(H.clinics, H.ref.clinics * popR) ;
  H.pharmacies = toward(H.pharmacies, H.ref.pharmacies * popR * clamp(1 - 0.5 * (P.copay - 0.12), 0.8, 1.1));
  H.medicalCenters = toward(H.medicalCenters, H.ref.centers * popR * pw(investR, 0.4));
  H.ambulances = toward(H.ambulances, H.ref.ambulances * popR * pw(investR, 0.5));
  H.emergencyUnits = toward(H.emergencyUnits, H.ref.emergency * popR * pw(investR, 0.3));
  H.condition = infra.count ? infra.condition : clamp(H.condition + (clamp(investR, 0.3, 1) - H.condition) * 0.0015, 0.3, 1);
  const clinicsAll = H.clinics + built('clinique');
  const centersAll = H.medicalCenters + built('centre_medical') * 1.5;
  // ----- Capacité, qualité et indicateurs -----
  const r = pw(docR, 0.3) * pw(nurseR, 0.25) * pw(bedR, 0.2) * pw(H.supply, 0.15) * pw(H.condition, 0.1);
  H.ratio = r;
  H.quality = clamp(qualityOf(r) + (T?.health.qualityBonus ?? 0), 0, 1);
  const access = pw(docR * pw(clinicsAll / Math.max(1, H.ref.clinics * popR), 0.2), 0.6) * pw(bedR, 0.4);
  H.waitDays = clamp(30 * pw(access, -2.2), 3, 365);
  const emerR = pw(H.ambulances / Math.max(1, H.ref.ambulances * needIdx), 0.5) * pw(H.emergencyUnits / Math.max(1, H.ref.emergency * needIdx), 0.3) * pw(bedR, 0.2);
  H.emergencyWait = clamp(18 * pw(emerR, -0.8) * (S.research?.effects.security.response ?? 1), 5, 120);
  const centersR = centersAll / Math.max(1, H.ref.centers * popR);
  H.coverage = clamp(0.97 * (1 - 0.7 * (P.copay - 0.12)) * Math.min(1.02, pw(docR, 0.15) * pw(centersR, 0.08)) * (T?.health.access ?? 1), 0.4, 1);
  H.patientSatisfaction = clamp(68 + 120 * (H.quality - 0.8) - 0.25 * (H.waitDays - 30) - 80 * (P.copay - 0.12) + 60 * (H.coverage - 0.97), 0, 100);
  H.costPerCapita = S.policy.budget.sante / Math.max(1, pop);
  H.mortality = (S.demography.deaths / Math.max(1, pop)) * 1000;
}

/** Recrutement exceptionnel : crée `count` postes et relève le budget santé de leur coût annuel. */
export function healthRecruit(S: GameState, role: HealthRole, count: number) {
  const H = S.health!;
  const P = S.policy.health;
  const r = role === 'medecins' ? H.doctors : H.nurses;
  const spec = HEALTH_ROLES[role];
  const n = Math.min(count, r.staff * 0.15);
  recruit(r, n);
  const annual = n * spec.cost * H.ref.costScale * P.wageIndex * priceRel(S);
  return { n, budget: annual / (1 - P.investment - P.prevention - TRAINING_SHARE * P.trainingSlots), delay: spec.delay };
}
