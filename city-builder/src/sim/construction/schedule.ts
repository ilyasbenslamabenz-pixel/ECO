/**
 * Chantiers : durées et horaires de travail (fonctions pures).
 *
 * Horloge de jeu : 1 minute par tick, 10 ticks par seconde à ×1 → une journée dure 2 min 24 s réelles.
 * Les chantiers travaillent de 06:00 à 20:00 (840 minutes par jour) ; une durée est exprimée en minutes
 * TRAVAILLÉES. Ordres de grandeur (voir tests/chantiers) : pavillon ≈ 1,1 journée de travail (≈ 3 min 40 s
 * réelles à ×1 en comptant la nuit), immeuble moyen ≈ 3,4 journées, gratte-ciel de 230 m ≈ 16 journées
 * (≈ 26 jours calendaires : un peu plus d'une heure à ×1, 4 minutes à ×16).
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import type { CatalogAsset } from '../../shared/catalog';
import { CHANTIER_WORK_END_MIN, CHANTIER_WORK_START_MIN } from '../../shared/protocol-ext/chantiers';

const DAY = 24 * 60;
/** Minutes travaillées par jour. */
export const WORK_MINUTES_PER_DAY = CHANTIER_WORK_END_MIN - CHANTIER_WORK_START_MIN;

/** Bornes des durées de construction (minutes travaillées). */
export const MIN_BUILD_MINUTES = 480;
export const MAX_BUILD_MINUTES = 20 * WORK_MINUTES_PER_DAY;
/** Démolition : part de la durée de construction, bornée. */
export const DEMOLITION_SHARE = 0.15;
export const MIN_DEMOLITION_MINUTES = 150;
export const MAX_DEMOLITION_MINUTES = 2 * WORK_MINUTES_PER_DAY;

/** Vrai si la minute du jour tombe dans les heures de travail. */
export function isWorkMinute(minuteOfDay: number): boolean {
  const m = ((minuteOfDay % DAY) + DAY) % DAY;
  return m >= CHANTIER_WORK_START_MIN && m < CHANTIER_WORK_END_MIN;
}

/** Minutes travaillées cumulées de la minute 0 à la minute `t` (t ≥ 0, décimal accepté). */
function workedUntil(t: number): number {
  const days = Math.floor(t / DAY);
  const m = t - days * DAY;
  return days * WORK_MINUTES_PER_DAY + Math.min(WORK_MINUTES_PER_DAY, Math.max(0, m - CHANTIER_WORK_START_MIN));
}

/** Minutes travaillées dans l'intervalle de jeu [t0, t1[ (minutes absolues depuis le début de la partie). */
export function workedMinutesBetween(t0: number, t1: number): number {
  if (!(t1 > t0)) return 0;
  return workedUntil(Math.max(0, t1)) - workedUntil(Math.max(0, t0));
}

/** Minutes calendaires nécessaires, à partir de la minute absolue `now`, pour accomplir `work` minutes travaillées. */
export function calendarMinutesFor(now: number, work: number): number {
  if (!(work > 0)) return 0;
  const target = workedUntil(Math.max(0, now)) + work;
  // Inversion de workedUntil : jours entiers puis reste dans la journée de travail.
  let days = Math.floor(target / WORK_MINUTES_PER_DAY);
  let rest = target - days * WORK_MINUTES_PER_DAY;
  if (rest <= 1e-9 && days > 0) { days--; rest = WORK_MINUTES_PER_DAY; }
  return days * DAY + CHANTIER_WORK_START_MIN + rest - Math.max(0, now);
}

/**
 * Durée de construction (minutes travaillées) selon le coût, la hauteur et l'emprise du modèle :
 * 240 + 95·√(coût / 1000) + 6·hauteur(m) + 4·cases, arrondie à 10 minutes et bornée.
 */
export function buildDurationMinutes(asset: Pick<CatalogAsset, 'cost' | 'dimensions' | 'footprint'>): number {
  const cost = Math.max(0, asset.cost);
  const tiles = Math.max(1, asset.footprint.tilesX * asset.footprint.tilesZ);
  const raw = 240 + 95 * Math.sqrt(cost / 1000) + 6 * Math.max(0, asset.dimensions.height) + 4 * tiles;
  return Math.min(MAX_BUILD_MINUTES, Math.max(MIN_BUILD_MINUTES, Math.round(raw / 10) * 10));
}

/** Durée de démolition (minutes travaillées) d'un bâtiment construit à la fraction `bati` (0..1). */
export function demolitionDurationMinutes(asset: Pick<CatalogAsset, 'cost' | 'dimensions' | 'footprint'>, bati = 1): number {
  const full = buildDurationMinutes(asset) * DEMOLITION_SHARE;
  const share = 0.35 + 0.65 * Math.min(1, Math.max(0, bati));
  return Math.min(MAX_DEMOLITION_MINUTES, Math.max(MIN_DEMOLITION_MINUTES, Math.round((full * share) / 10) * 10));
}
