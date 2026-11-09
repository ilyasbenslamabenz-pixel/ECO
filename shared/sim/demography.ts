// Moteur démographique : cohortes quinquennales, naissances, décès, migrations, structure par âge.
import { AGE_BANDS, BASE_MORTALITY } from './data';
import type { Demography } from './types';

export interface AgeGroups {
  total: number;
  children: number; // 0-17 ans
  students: number; // 18-24 ans en études
  workingAge: number; // de la fin des études à l'âge légal de départ
  retirees: number; // au-delà de l'âge légal
  women1549: number;
}

/** Découpe la pyramide des âges en grands groupes selon l'âge de la retraite et le taux de scolarisation supérieure. */
export function ageGroups(cohorts: number[], retirementAge: number, enrollment: number): AgeGroups {
  const total = cohorts.reduce((s, v) => s + v, 0);
  const children = cohorts[0] + cohorts[1] + cohorts[2] + cohorts[3] * 0.6;
  const students = cohorts[3] * 0.4 * enrollment + cohorts[4] * enrollment * 0.85;
  const rb = Math.min(AGE_BANDS - 1, Math.floor(retirementAge / 5));
  const frac = (retirementAge - rb * 5) / 5; // part de la tranche encore active
  let retirees = cohorts[rb] * (1 - frac);
  for (let b = rb + 1; b < AGE_BANDS; b++) retirees += cohorts[b];
  const workingAge = Math.max(0, total - children - students - retirees);
  let women1549 = 0;
  for (let b = 3; b <= 9; b++) women1549 += cohorts[b] * 0.5;
  return { total, children, students, workingAge, retirees, women1549 };
}

export function mortalityMultiplier(healthQuality: number, airQuality: number) {
  return Math.max(0.55, Math.min(1.9, 1 + 1.1 * (0.78 - healthQuality) + 0.25 * (0.65 - airQuality)));
}

/** Espérance de vie à la naissance (table de mortalité du moment). */
export function lifeExpectancy(mult: number) {
  let alive = 1;
  let years = 0;
  for (let b = 0; b < AGE_BANDS; b++) {
    const q = 1 - Math.pow(1 - Math.min(0.95, BASE_MORTALITY[b] * mult), 5);
    const dead = alive * q;
    years += 5 * (alive - dead / 2);
    alive -= dead;
    if (b === AGE_BANDS - 1) years += alive * 3;
  }
  return years;
}

export interface DemoContext {
  healthQuality: number;
  airQuality: number;
  satisfaction: number; // 0..100
  unemployment: number; // 0..1
  familyAllowance: number; // €/enfant/mois
  housingPressure: number; // 0 (détendu) .. 1 (crise)
  priceLevel: number;
}

/** Avance la démographie d'un mois. Les flux renvoyés sont annualisés. */
export function demographyStep(d: Demography, ctx: DemoContext): Demography {
  const cohorts = d.cohorts.slice();
  const mult = mortalityMultiplier(ctx.healthQuality, ctx.airQuality);
  // Décès
  let deaths = 0;
  for (let b = 0; b < AGE_BANDS; b++) {
    const qm = 1 - Math.pow(1 - Math.min(0.95, BASE_MORTALITY[b] * mult), 1 / 12);
    const dd = cohorts[b] * qm;
    cohorts[b] -= dd;
    deaths += dd;
  }
  // Naissances (indicateur conjoncturel de fécondité / 35 ans de vie féconde)
  let women = 0;
  for (let b = 3; b <= 9; b++) women += cohorts[b] * 0.5;
  const realAllowance = ctx.familyAllowance / Math.max(0.5, ctx.priceLevel);
  const fertility = Math.max(1.05, Math.min(2.5,
    1.72 * (1 + 0.004 * (ctx.satisfaction - 55) - 1.2 * (ctx.unemployment - 0.07) - 0.15 * ctx.housingPressure) + 0.0009 * (realAllowance - 150)));
  const births = (fertility / 35) * women / 12;
  // Vieillissement : 1/60 de chaque tranche passe à la suivante chaque mois
  for (let b = AGE_BANDS - 1; b >= 0; b--) {
    if (b === AGE_BANDS - 1) continue;
    const move = cohorts[b] / 60;
    cohorts[b] -= move;
    cohorts[b + 1] += move;
  }
  cohorts[0] += births;
  // Migrations nettes : attractivité (satisfaction, emploi, logement)
  const total = cohorts.reduce((s, v) => s + v, 0);
  const attract = 0.5 * (ctx.satisfaction - 55) / 100 - 1.6 * (ctx.unemployment - 0.07) - 0.4 * ctx.housingPressure;
  const migRate = Math.max(-0.012, Math.min(0.015, 0.0022 + 0.012 * attract)); // annuel
  const migration = (total * migRate) / 12;
  const ages = [4, 5, 6, 7, 8]; // 20-44 ans
  const base = ages.reduce((s, b) => s + cohorts[b], 0) || 1;
  for (const b of ages) cohorts[b] = Math.max(0, cohorts[b] + (migration * cohorts[b]) / base);

  return {
    ...d,
    cohorts,
    births: births * 12,
    deaths: deaths * 12,
    migration: migration * 12,
    fertility,
    lifeExpectancy: lifeExpectancy(mult),
  };
}
