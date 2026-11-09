// Éducation : écoles, collèges, lycées, universités ; enseignants et enseignants-chercheurs (recrutement avec
// délais, formation), capacités d'accueil, réussite, décrochage, étudiants, qualification, capital humain
// (productivité future). Sortie : `services.education` (qualité 0..1) et `education.humanCapital`.
import { clamp } from './economy';
import type { GameState } from './types';
import {
  infraCapacity, makeRole, population, priceRel, pw, qualityOf, recruit, roleStep, scalePlan, unemploymentRate,
  type Role, type RoleSpec,
} from './workforce';

export interface EducationPolicy {
  wageIndex: number; // rémunération des enseignants (1 = référence)
  investment: number; // part du budget consacrée à l'investissement (bâtiments, équipements)
  tuition: number; // frais d'inscription universitaires (€/an)
  vocational: number; // part des lycéens en filière professionnelle / apprentissage
  trainingSlots: number; // places aux concours et en formation des enseignants (1 = référence ; effet après ~4 ans)
}
export const DEFAULT_EDUCATION_POLICY: EducationPolicy = { wageIndex: 1, investment: 0.06, tuition: 300, vocational: 0.3, trainingSlots: 1 };
export const EDUCATION_BOUNDS: Record<keyof EducationPolicy, [number, number]> = {
  wageIndex: [0.7, 1.6], investment: [0, 0.3], tuition: [0, 15000], vocational: [0.1, 0.6], trainingSlots: [0.3, 3],
};

export const EDUCATION_ROLES = {
  enseignants: { label: 'Enseignants', cost: 56000, delay: 8, attrition: 0.045, hireRate: 0.008 } as RoleSpec,
  chercheurs: { label: 'Enseignants-chercheurs', cost: 78000, delay: 10, attrition: 0.04, hireRate: 0.006 } as RoleSpec,
};
export type EducationRole = keyof typeof EDUCATION_ROLES;
export const SCHOOL_INFRA = ['ecole', 'college', 'lycee'] as const;
export const UNI_INFRA = ['universite'] as const;
export const TRAINING_INFRA = ['centre_formation'] as const;
const PLACE_COST = 1900; // fonctionnement annuel d'une place (bâtiment, énergie, entretien) hors enseignants
const PUPILS_PER_TEACHER = 14.5;
const STUDENTS_PER_LECTURER = 19;

export interface EducationState {
  teachers: Role;
  lecturers: Role;
  plan: { ops: number }; // fonctionnement (€/an, prix de base)
  supply: number; // moyens de fonctionnement 0..1,4
  condition: number; // état du bâti scolaire 0..1
  training: number; // vivier de candidats aux concours (1 = référence)
  schoolPlaces: number; uniPlaces: number; otherSchoolPlaces: number; otherUniPlaces: number;
  pupils: { primaire: number; college: number; lycee: number };
  students: number; // étudiants du supérieur
  apprentices: number; // adultes en formation professionnelle
  humanCapital: number; // qualification moyenne de la population active (0..1, 0,8 au départ) : lente (≈ 20 ans)
  ref: { teachers: number; lecturers: number; ops: number; pupils: number; students: number; invest: number; costScale: number; poverty: number; unemployment: number };
  // indicateurs
  ratio: number;
  quality: number;
  pupilsPerTeacher: number;
  studentsPerLecturer: number;
  occupancySchool: number;
  occupancyUni: number;
  successRate: number; // taux de réussite au baccalauréat
  dropout: number; // part des jeunes sortant sans diplôme
  enrollment: number; // taux d'accès à l'enseignement supérieur (18-24 ans)
  qualification: number; // part des 25-64 ans diplômés du supérieur
  innovation: number; // indice d'innovation (100 = référence)
  productivityEffect: number; // contribution du capital humain à la croissance de la productivité (points/an)
  costPerPupil: number; // €/élève ou étudiant/an
}

function pupilsOf(S: GameState) {
  const c = S.demography.cohorts;
  return { primaire: 0.4 * c[0] + c[1] + 0.2 * c[2], college: 0.8 * c[2], lycee: 0.6 * c[3] };
}
const baseEnrollment = (q: number) => clamp(0.5 + 0.25 * (q - 0.75), 0.3, 0.75); // même formule que le moteur économique

function studentsOf(S: GameState, q: number) {
  const c = S.demography.cohorts;
  const P = S.policy.education;
  const fee = clamp(1 - 0.000025 * (P.tuition - 300), 0.6, 1.02);
  const voc = clamp(1 - 0.3 * (P.vocational - 0.3), 0.85, 1.1);
  return (0.4 * c[3] + 0.85 * c[4]) * baseEnrollment(q) * fee * voc;
}

export function initEducation(S: GameState): EducationState {
  const P = S.policy.education;
  const E = S.policy.budget.education;
  const pupils = pupilsOf(S);
  const nP = pupils.primaire + pupils.college + pupils.lycee;
  const students = studentsOf(S, 0.8);
  const teachers = nP / PUPILS_PER_TEACHER;
  const lecturers = students / STUDENTS_PER_LECTURER;
  const school = infraCapacity(S, SCHOOL_INFRA).capacity;
  const uni = infraCapacity(S, UNI_INFRA).capacity;
  const core = E * (1 - P.investment);
  const placesCost = (nP + students) * 1.05 * PLACE_COST;
  const fixed = teachers * EDUCATION_ROLES.enseignants.cost + lecturers * EDUCATION_ROLES.chercheurs.cost + placesCost;
  const costScale = Math.min(1, (core * 0.75) / fixed);
  const ops = core - (fixed - placesCost) * costScale;
  return {
    teachers: makeRole(teachers, EDUCATION_ROLES.enseignants),
    lecturers: makeRole(lecturers, EDUCATION_ROLES.chercheurs),
    plan: { ops }, supply: 1, condition: 1, training: 1,
    schoolPlaces: nP * 1.05, uniPlaces: students * 1.05, otherSchoolPlaces: Math.max(0, nP * 1.05 - school), otherUniPlaces: Math.max(0, students * 1.05 - uni),
    pupils, students, apprentices: S.demography.labourForce * 0.02,
    humanCapital: 0.8,
    ref: { teachers, lecturers, ops, pupils: nP, students, invest: E * P.investment, costScale, poverty: S.accounts.poverty, unemployment: unemploymentRate(S) },
    ratio: 1, quality: qualityOf(1), pupilsPerTeacher: PUPILS_PER_TEACHER, studentsPerLecturer: STUDENTS_PER_LECTURER, occupancySchool: 1 / 1.05, occupancyUni: 1 / 1.05,
    successRate: 0.82, dropout: 0.08, enrollment: baseEnrollment(0.8), qualification: 0.42, innovation: 100, productivityEffect: 0, costPerPupil: E / (nP + students),
  };
}

/** Un mois du système éducatif. */
export function educationStep(S: GameState) {
  const D = S.education!;
  const P = S.policy.education;
  const T = S.research?.effects;
  const pr = priceRel(S);
  const k = D.ref.costScale;
  const w = P.wageIndex;
  const cT = EDUCATION_ROLES.enseignants.cost * k * w;
  const cL = EDUCATION_ROLES.chercheurs.cost * k * w;
  const E = Math.max(0, S.policy.budget.education) / pr;
  const invest = E * P.investment;
  const core = E - invest;
  scalePlan([
    { qty: D.teachers.posts, unit: cT, set: (q) => (D.teachers.posts = q) },
    { qty: D.lecturers.posts, unit: cL, set: (q) => (D.lecturers.posts = q) },
    { qty: D.plan.ops, unit: 1, set: (q) => (D.plan.ops = q) },
  ], core);
  // effectifs scolarisés
  D.pupils = pupilsOf(S);
  const nP = D.pupils.primaire + D.pupils.college + D.pupils.lycee;
  D.students = studentsOf(S, D.quality);
  D.apprentices = S.demography.labourForce * 0.02 * clamp(S.services.formation / 0.8, 0.3, 1.5);
  const pupilIdx = nP / D.ref.pupils;
  const studIdx = D.students / D.ref.students;
  // personnel
  D.training += (P.trainingSlots - D.training) / 48;
  const tProd = T?.education.teacherProductivity ?? 1;
  const tR = (D.teachers.staff * tProd) / (D.ref.teachers * pupilIdx);
  const lR = D.lecturers.staff / (D.ref.lecturers * studIdx);
  const overload = clamp(1 / Math.max(0.2, tR), 0.5, 3);
  const quit = pw(w, -1.2) * (1 + 0.6 * Math.max(0, overload - 1.05));
  roleStep(D.teachers, EDUCATION_ROLES.enseignants, { attract: pw(w, 1.5) * D.training, quitMult: quit, maxCut: 0.008 });
  roleStep(D.lecturers, EDUCATION_ROLES.chercheurs, { attract: pw(w, 1.5) * D.training, quitMult: quit, maxCut: 0.006 });
  // capacités d'accueil (places de la carte + établissements non représentés)
  const school = infraCapacity(S, SCHOOL_INFRA);
  const uni = infraCapacity(S, UNI_INFRA);
  D.schoolPlaces = school.capacity + D.otherSchoolPlaces;
  D.uniPlaces = uni.capacity + D.otherUniPlaces;
  D.occupancySchool = nP / Math.max(1, D.schoolPlaces);
  D.occupancyUni = D.students / Math.max(1, D.uniPlaces);
  const placeR = pw(Math.min(1.08, (1 / Math.max(0.3, D.occupancySchool)) / 1.05), 0.8) * pw(Math.min(1.08, (1 / Math.max(0.3, D.occupancyUni)) / 1.05), 0.2);
  // fonctionnement : reste après les agents en poste (le fonctionnement des places est inclus dans `ops`)
  const opsAvail = core - D.teachers.staff * cT - D.lecturers.staff * cL;
  D.supply += (clamp(opsAvail / Math.max(1, D.ref.ops * (0.8 * pupilIdx + 0.2 * studIdx)), 0, 1.4) - D.supply) / 12;
  const investR = invest / Math.max(1, D.ref.invest);
  const conds = [school, uni].filter((x) => x.count > 0);
  D.condition = conds.length ? conds.reduce((s, x) => s + x.condition, 0) / conds.length : clamp(D.condition + (clamp(investR, 0.3, 1) - D.condition) * 0.0015, 0.3, 1);
  // qualité
  const r = pw(tR, 0.4) * pw(lR, 0.15) * pw(placeR, 0.15) * pw(D.supply, 0.15) * pw(D.condition, 0.15);
  D.ratio = r;
  D.quality = qualityOf(r);
  // résultats
  const u = unemploymentRate(S);
  const pov = S.accounts.poverty;
  D.successRate = clamp(0.82 + 0.5 * (D.quality - 0.8) - 0.4 * (pov - D.ref.poverty) + 0.05 * (P.vocational - 0.3), 0.4, 0.98);
  D.dropout = clamp(0.08 * (1 - 2.5 * (D.quality - 0.8)) * (1 + 2 * (u - D.ref.unemployment)) * (1 - 0.5 * (P.vocational - 0.3)) * (T?.education.dropout ?? 1), 0.01, 0.3);
  D.enrollment = D.students / Math.max(1, 0.4 * S.demography.cohorts[3] + 0.85 * S.demography.cohorts[4]);
  const flow = D.quality * (1 + 0.6 * (0.08 - D.dropout)) * pw(D.enrollment / baseEnrollment(0.8), 0.15) * (T?.education.humanCapital ?? 1);
  D.humanCapital += (flow - D.humanCapital) / 240;
  D.qualification = clamp(0.42 + 0.6 * (D.humanCapital - 0.8), 0.1, 0.9);
  const effort = S.research ? S.research.effortMonthly * 12 / Math.max(1, S.policy.budget.recherche * 0.4 / pr) : 1;
  D.innovation = 100 * pw(Math.max(0.05, effort), 0.3) * pw(D.humanCapital / 0.8, 1.5) * pw(lR, 0.3);
  D.pupilsPerTeacher = nP / Math.max(1, D.teachers.staff);
  D.studentsPerLecturer = D.students / Math.max(1, D.lecturers.staff);
  D.costPerPupil = S.policy.budget.education / Math.max(1, nP + D.students);
  // productivité future : le moteur économique utilise la qualité instantanée de l'éducation ;
  // on remplace cet effet par celui du capital humain accumulé (effet différé de 10 à 20 ans)
  D.productivityEffect = 0.012 * (D.humanCapital - S.services.education);
}

/** Recrutement exceptionnel d'enseignants : postes créés, budget relevé du coût annuel. */
export function educationRecruit(S: GameState, role: EducationRole, count: number) {
  const D = S.education!;
  const P = S.policy.education;
  const r = role === 'enseignants' ? D.teachers : D.lecturers;
  const spec = EDUCATION_ROLES[role];
  const n = Math.min(count, r.staff * 0.12);
  recruit(r, n);
  const annual = n * spec.cost * D.ref.costScale * P.wageIndex * priceRel(S);
  return { n, budget: annual / (1 - P.investment), delay: spec.delay };
}
