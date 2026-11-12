/** Horloge de jeu : calendrier simplifié (12 mois de 30 jours). TypeScript pur. */
import type { GameDate } from '../shared/contracts';

export const MINUTES_PER_DAY = 24 * 60;
export const DAYS_PER_MONTH = 30;
export const MONTHS_PER_YEAR = 12;
export const MINUTES_PER_MONTH = MINUTES_PER_DAY * DAYS_PER_MONTH;

export class GameClock {
  totalMinutes = 0;

  advance(minutes: number): { monthChanged: boolean } {
    const before = Math.floor(this.totalMinutes / MINUTES_PER_MONTH);
    this.totalMinutes += minutes;
    const after = Math.floor(this.totalMinutes / MINUTES_PER_MONTH);
    return { monthChanged: after !== before };
  }

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
