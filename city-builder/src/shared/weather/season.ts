/**
 * Saisons continues (calendrier de jeu : 12 mois de 30 jours, jour 0 = 1er janvier) : paramètres visuels lissés
 * au fil de l'année pour la végétation, l'herbe et le soleil. Fonctions pures et déterministes, partagées par la
 * simulation (température) et le rendu (teintes). TypeScript pur : AUCUN import de three ni du DOM.
 */
import type { SeasonId } from './types';

export const GAME_DAYS_PER_YEAR = 360;

/** Jour de l'année 0..359 depuis le mois (1..12) et le jour (1..30). */
export function dayOfYearOf(month: number, day: number): number {
  return ((month - 1) * 30 + (day - 1)) % GAME_DAYS_PER_YEAR;
}

/** Saison météorologique (hémisphère nord) d'un jour de l'année. */
export function seasonOfDay(doy: number): SeasonId {
  const m = 1 + Math.floor((((doy % 360) + 360) % 360) / 30);
  if (m >= 3 && m <= 5) return 'printemps';
  if (m >= 6 && m <= 8) return 'ete';
  if (m >= 9 && m <= 11) return 'automne';
  return 'hiver';
}

/** Jour de l'année astronomique (0..364) équivalent, pour la course du soleil. */
export function astronomicalDay(doy: number): number {
  return Math.round((((doy % 360) + 360) % 360) * (365 / 360));
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (e0: number, e1: number, x: number): number => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
/** Bosse lisse : 0 avant a, 1 entre b et c, 0 après d (jours, cycle annuel non replié). */
const bump = (x: number, a: number, b: number, c: number, d: number): number => smooth(a, b, x) * (1 - smooth(c, d, x));

export interface SeasonVisuals {
  /** Coloration automnale du feuillage caduc 0..1 (jaune -> orange -> roux). */
  autumn: number;
  /** Défoliation des feuillus 0..1 (0 = pleine frondaison, 1 = arbres nus). */
  bare: number;
  /** Vert tendre printanier 0..1. */
  spring: number;
  /** Herbe sèche / jaunie (été chaud, fin d'automne) 0..1. */
  dryGrass: number;
  /** Herbe terne d'hiver 0..1. */
  dormant: number;
  /** Floraison des arbres d'ornement 0..1 (printemps). */
  bloom: number;
}

/**
 * Paramètres visuels d'un jour de l'année (lissés, sans saut au changement de mois). Climat tempéré d'Europe
 * de l'Ouest (plateau suisse / moyen Atlas) : débourrement fin mars, pleine frondaison mai-septembre,
 * coloration de fin septembre à mi-novembre, chute des feuilles en novembre, arbres nus de décembre à mars.
 */
export function seasonVisuals(doyIn: number): SeasonVisuals {
  const d = (((doyIn % 360) + 360) % 360);
  // Années « dépliées » pour les bosses qui chevauchent le 1er janvier.
  const dw = d < 180 ? d + 360 : d;
  const autumn = bump(d, 245, 285, 318, 338);
  const bare = Math.max(bump(dw, 300, 335, 440, 465), 0);
  const spring = bump(d, 75, 100, 135, 165);
  const dryGrass = Math.max(bump(d, 180, 215, 240, 262) * 0.3, bump(d, 285, 310, 330, 345) * 0.5);
  const dormant = bump(dw, 320, 345, 420, 445);
  const bloom = bump(d, 80, 95, 115, 130);
  return { autumn, bare, spring, dryGrass, dormant, bloom };
}

/**
 * Normale climatique de température (°C) d'un jour de l'année (moyenne journalière), interpolée entre milieux de
 * mois. Climat de piémont tempéré (Meknès en altitude / plateau suisse) : 2 °C en janvier, 22 °C en juillet.
 */
export const MONTHLY_MEAN_C = [2, 3.5, 7, 11, 15, 19, 22, 21.5, 17, 12, 6.5, 3] as const;
/** Amplitude diurne (écart moyen max - min, °C) par mois. */
export const MONTHLY_RANGE_C = [6, 7, 9, 10, 11, 12, 13, 12, 11, 9, 7, 6] as const;

export function climateMean(doy: number): { mean: number; range: number } {
  const x = ((((doy % 360) + 360) % 360) - 15) / 30; // 0 = milieu de janvier
  const i0 = Math.floor(x);
  const t = x - i0;
  const a = ((i0 % 12) + 12) % 12, b = (a + 1) % 12;
  const st = t * t * (3 - 2 * t);
  return {
    mean: MONTHLY_MEAN_C[a]! + (MONTHLY_MEAN_C[b]! - MONTHLY_MEAN_C[a]!) * st,
    range: MONTHLY_RANGE_C[a]! + (MONTHLY_RANGE_C[b]! - MONTHLY_RANGE_C[a]!) * st,
  };
}

/** Variation diurne normalisée -0.5..0.5 (minimum vers 6 h, maximum vers 15 h). */
export function diurnalShape(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  // Montée rapide 6 h -> 15 h, descente lente 15 h -> 6 h (+24).
  if (h >= 6 && h < 15) return -0.5 + 0.5 * (1 - Math.cos((Math.PI * (h - 6)) / 9));
  const t = (h >= 15 ? h - 15 : h + 9) / 15;
  return 0.5 - 0.5 * (1 - Math.cos(Math.PI * t));
}
