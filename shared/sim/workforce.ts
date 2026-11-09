// Outils communs aux services publics : effectifs avec délais de recrutement, plan de financement, prix relatifs.
import { clamp } from './economy';
import type { GameState } from './types';

/**
 * Corps de métier (médecins, enseignants, policiers…).
 * - `staff` : agents en poste ;
 * - `posts` : postes budgétés (financés par l'enveloppe du ministère) ;
 * - `pipeline[i]` : recrues qui prendront leur poste dans i + 1 mois (recrutement, formation, prise de fonctions).
 */
export interface Role { staff: number; posts: number; pipeline: number[] }

export interface RoleSpec {
  label: string;
  cost: number; // coût complet annuel d'un agent (€/an, prix de base, rémunération de référence)
  delay: number; // délai entre la décision de recruter et la prise de poste (mois, ≥ 1)
  attrition: number; // départs naturels annuels (retraites, démissions) à rémunération de référence
  hireRate: number; // part maximale de l'effectif recrutable par mois (vivier disponible)
}

export function makeRole(staff: number, spec: RoleSpec): Role {
  return { staff, posts: staff, pipeline: new Array(Math.max(1, spec.delay)).fill((staff * spec.attrition) / 12) };
}

export const pipelineSum = (r: Role) => r.pipeline.reduce((s, v) => s + v, 0);

export interface RoleStepOpts {
  attract: number; // attractivité du métier (1 = référence) : multiplie le vivier de recrutement
  quitMult: number; // multiplicateur des départs (rémunération, surcharge de travail)
  maxCut: number; // part maximale de l'effectif supprimable par mois au-delà des départs naturels (non-renouvellements)
}

/**
 * Avance un corps de métier d'un mois : arrivées des recrues, départs, recrutements pour combler les postes
 * budgétés (avec délai `spec.delay`), suppressions progressives si l'effectif dépasse les postes financés.
 */
export function roleStep(r: Role, spec: RoleSpec, o: RoleStepOpts) {
  const arrivals = r.pipeline.shift() ?? 0;
  r.staff += arrivals;
  const m = (spec.attrition / 12) * o.quitMult;
  const quits = r.staff * m;
  r.staff -= quits;
  const pipe = pipelineSum(r);
  // effectif projeté à l'horizon du délai de recrutement si l'on ne recrutait plus personne
  const projected = r.staff + pipe - r.staff * m * spec.delay;
  const gap = r.posts - projected;
  let hired = 0;
  if (gap > 0) hired = Math.min(gap, spec.hireRate * Math.max(r.staff, r.posts * 0.2) * Math.max(0.05, o.attract));
  r.pipeline.push(hired);
  while (r.pipeline.length < Math.max(1, spec.delay)) r.pipeline.unshift(0);
  let cut = 0;
  if (r.staff > r.posts) {
    cut = Math.min(r.staff - r.posts, o.maxCut * r.staff);
    r.staff -= cut;
  }
  return { arrivals, quits, hired, cut };
}

/** Ajoute une campagne de recrutement : `count` postes créés, recrues en poste après le délai du métier. */
export function recruit(r: Role, count: number) {
  r.posts += count;
  r.pipeline[r.pipeline.length - 1] += count;
}

/** Indice des coûts des services publics (effet Baumol : indexé sur le salaire moyen). 1 au départ. */
export function priceRel(S: GameState) {
  return S.baseline.meanWage > 0 && S.accounts.meanWage > 0 ? S.accounts.meanWage / S.baseline.meanWage : S.macro.priceLevel;
}

export const population = (S: GameState) => S.demography.cohorts.reduce((s, v) => s + v, 0);
export const unemploymentRate = (S: GameState) => S.demography.labourForce > 0 ? S.demography.unemployed / S.demography.labourForce : 0.075;

/** Qualité d'un service selon son ratio capacité / besoin (1 → 0,80), même forme que `serviceTarget`. */
export function qualityOf(ratio: number) {
  return clamp(0.05 + 0.75 * Math.pow(Math.max(0, ratio), 0.7), 0, 1);
}

/** Puissance sûre (base ≥ 1e-6). */
export const pw = (v: number, e: number) => Math.pow(Math.max(1e-6, v), e);

/**
 * Plan de financement : répartit l'enveloppe `core` (€/an, prix de base) entre des postes de dépense dont
 * les quantités sont mises à l'échelle proportionnellement. Renvoie le facteur d'échelle appliqué.
 */
export function scalePlan(items: { qty: number; unit: number; set: (q: number) => void }[], core: number) {
  const cost = items.reduce((s, i) => s + i.qty * i.unit, 0);
  const k = cost > 0 ? Math.max(0, core) / cost : 1;
  for (const i of items) i.set(i.qty * k);
  return k;
}

/** Capacité et état moyen des équipements d'un ensemble de types (lits, places…). */
export function infraCapacity(S: GameState, types: readonly string[]) {
  let cap = 0;
  let condW = 0;
  let count = 0;
  const works = new Set((S.construction?.sites ?? []).filter((s) => s.kind === 'renovation' || s.kind === 'amelioration').map((s) => s.infraId));
  for (const i of S.country.infra) {
    if (!types.includes(i.type) || i.status === 'chantier') continue;
    const cond = i.condition ?? 1;
    const eff = (0.6 + 0.4 * cond) * (works.has(i.id) ? 0.7 : 1);
    cap += i.capacity * eff;
    condW += cond * i.capacity;
    count += 1;
  }
  let raw = 0;
  for (const i of S.country.infra) if (types.includes(i.type) && i.status !== 'chantier') raw += i.capacity;
  return { capacity: cap, raw, condition: raw > 0 ? condW / raw : 1, count };
}
