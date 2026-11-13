/**
 * Horloge de jeu : calendrier simplifié (12 mois de 30 jours, semaines de 7 jours),
 * heure, jour de la semaine et saisons. TypeScript pur, sans allocation dans advance().
 */
import type { GameDate } from '../shared/contracts';

export const MINUTES_PER_HOUR = 60;
export const MINUTES_PER_DAY = 24 * 60;
export const DAYS_PER_MONTH = 30;
export const MONTHS_PER_YEAR = 12;
export const MINUTES_PER_MONTH = MINUTES_PER_DAY * DAYS_PER_MONTH;
export const MINUTES_PER_YEAR = MINUTES_PER_MONTH * MONTHS_PER_YEAR;
export const DAYS_PER_YEAR = DAYS_PER_MONTH * MONTHS_PER_YEAR;

export type Season = 'printemps' | 'ete' | 'automne' | 'hiver';
export const SEASON_NAMES_FR: Record<Season, string> = { printemps: 'Printemps', ete: 'Été', automne: 'Automne', hiver: 'Hiver' };
export const MONTH_NAMES_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'] as const;
export const WEEKDAY_NAMES_FR = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'] as const;

/** Changements survenus pendant un advance() (objet réutilisé : ne pas conserver de référence). */
export interface ClockFlags {
  hourChanged: boolean;
  dayChanged: boolean;
  monthChanged: boolean;
  yearChanged: boolean;
}

/** Saison d'un mois 1..12 (hémisphère nord, découpage météorologique). */
export function seasonOfMonth(month: number): Season {
  if (month >= 3 && month <= 5) return 'printemps';
  if (month >= 6 && month <= 8) return 'ete';
  if (month >= 9 && month <= 11) return 'automne';
  return 'hiver';
}

/** Jour de la semaine (0 = lundi .. 6 = dimanche) ; la partie commence un lundi. */
export function weekdayOf(totalMinutes: number): number {
  return Math.floor(totalMinutes / MINUTES_PER_DAY) % 7;
}

export function isWeekend(totalMinutes: number): boolean {
  return weekdayOf(totalMinutes) >= 5;
}

/** Date lisible en français, ex. « lundi 3 mars an 2, 08:05 ». */
export function formatDateFr(d: GameDate): string {
  const wd = WEEKDAY_NAMES_FR[weekdayOf(d.totalMinutes)];
  const hh = String(d.hour).padStart(2, '0');
  const mm = String(d.minute).padStart(2, '0');
  return `${wd} ${d.day} ${MONTH_NAMES_FR[d.month - 1]} an ${d.year}, ${hh}:${mm}`;
}

export class GameClock {
  totalMinutes = 0;
  private readonly flags: ClockFlags = { hourChanged: false, dayChanged: false, monthChanged: false, yearChanged: false };

  advance(minutes: number): ClockFlags {
    const t0 = this.totalMinutes;
    // Arrondi au millionième de minute : pas de dérive en cumulant des pas non représentables (0,2 min).
    const t1 = Math.round((t0 + minutes) * 1e6) / 1e6;
    this.totalMinutes = t1;
    const f = this.flags;
    f.hourChanged = Math.floor(t1 / MINUTES_PER_HOUR) !== Math.floor(t0 / MINUTES_PER_HOUR);
    f.dayChanged = Math.floor(t1 / MINUTES_PER_DAY) !== Math.floor(t0 / MINUTES_PER_DAY);
    f.monthChanged = Math.floor(t1 / MINUTES_PER_MONTH) !== Math.floor(t0 / MINUTES_PER_MONTH);
    f.yearChanged = Math.floor(t1 / MINUTES_PER_YEAR) !== Math.floor(t0 / MINUTES_PER_YEAR);
    return f;
  }

  /** Heure décimale du jour (0..24). */
  get hourOfDay(): number { return (this.totalMinutes % MINUTES_PER_DAY) / MINUTES_PER_HOUR; }
  /** Minute du jour (0..1439). */
  get minuteOfDay(): number { return Math.floor(this.totalMinutes % MINUTES_PER_DAY); }
  /** Index absolu du jour depuis le début de la partie. */
  get dayIndex(): number { return Math.floor(this.totalMinutes / MINUTES_PER_DAY); }
  get monthIndex(): number { return Math.floor(this.totalMinutes / MINUTES_PER_MONTH); }
  get month(): number { return 1 + (this.monthIndex % MONTHS_PER_YEAR); }
  get year(): number { return 1 + Math.floor(this.monthIndex / MONTHS_PER_YEAR); }
  get season(): Season { return seasonOfMonth(this.month); }
  get weekday(): number { return weekdayOf(this.totalMinutes); }

  /** Remplit `out` (pas d'allocation si un objet est réutilisé). */
  toDate(out: GameDate): GameDate {
    const t = Math.floor(this.totalMinutes);
    const dayIndex = Math.floor(t / MINUTES_PER_DAY);
    const monthIndex = Math.floor(dayIndex / DAYS_PER_MONTH);
    out.totalMinutes = this.totalMinutes;
    out.year = 1 + Math.floor(monthIndex / MONTHS_PER_YEAR);
    out.month = 1 + (monthIndex % MONTHS_PER_YEAR);
    out.day = 1 + (dayIndex % DAYS_PER_MONTH);
    out.hour = Math.floor((t % MINUTES_PER_DAY) / 60);
    out.minute = t % 60;
    return out;
  }
}
