/**
 * Horloge de jeu : minutes écoulées depuis le début de la partie (lundi 1er jour, 7 h). TypeScript pur.
 */
export const MINUTES_PER_DAY = 1440;
export const START_MINUTE = 7 * 60;

export const WEEKDAYS_FR = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'] as const;

export interface ClockView {
  /** Minutes depuis le début de la partie. */
  total: number;
  /** Jour de jeu (0 = premier jour). */
  day: number;
  /** Jour de la semaine (0 = lundi). */
  weekday: number;
  /** Heure entière (0..23). */
  hour: number;
  /** Minute dans l'heure (0..59). */
  minute: number;
}

export function clockView(total: number): ClockView {
  const day = Math.floor(total / MINUTES_PER_DAY);
  const m = total - day * MINUTES_PER_DAY;
  return { total, day, weekday: day % 7, hour: Math.floor(m / 60), minute: m % 60 };
}

/** « mardi, jour 3, 14:05 » */
export function formatClock(total: number): string {
  const c = clockView(total);
  return `${WEEKDAYS_FR[c.weekday]} · jour ${c.day + 1} · ${String(c.hour).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}`;
}
