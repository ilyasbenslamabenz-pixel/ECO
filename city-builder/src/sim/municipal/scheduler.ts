/**
 * Ordonnanceur multi-fréquence (par tick, par heure, par jour, par mois) AU-DESSUS du planificateur de base.
 *
 * Sources des échéances :
 *  - `day(dayIndex)` / `month(monthIndex)` : appelés depuis les crochets `onDayStart` / `onMonthStart` du module,
 *    eux-mêmes déclenchés par les événements DayStart / MonthStart du planificateur de base (src/sim/scheduler.ts) ;
 *  - `advance(totalMinutes, minutes)` : appelé depuis `onTick` ; exécute les tâches horaires pour CHAQUE heure
 *    franchie depuis le tick précédent (rattrapage si un tick couvre plusieurs heures), puis les tâches par tick.
 * Ordre dans un tick de la simulation : mois → jour (événements de base) → heures franchies → tick.
 * Dans une fréquence : `order` croissant, puis ordre d'ajout. Une même échéance n'est jamais exécutée deux fois.
 * Une tâche en erreur est isolée (erreur comptée, les autres tâches continuent).
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import type { Frequency } from '../../shared/municipal/types';

export const MINUTES_PER_HOUR = 60;

export interface TaskInfo {
  freq: Frequency;
  /** Minute de jeu de l'exécution. */
  totalMinutes: number;
  /** Minutes de jeu couvertes (tick : durée du pas ; heure : 60 ; jour / mois : depuis l'exécution précédente, 0 la première fois). */
  minutes: number;
  /** Index de l'échéance (heure, jour ou mois absolu ; numéro de tick pour `tick`). */
  index: number;
}

export interface MunicipalTask {
  id: string;
  every: Frequency;
  /** Ordre d'exécution dans la fréquence (défaut 0). */
  order?: number;
  run(info: TaskInfo): void;
}

export interface TaskStats {
  id: string;
  every: Frequency;
  runs: number;
  errors: number;
  lastError?: string;
  /** Temps cumulé et maximal (ms, horloge murale) — diagnostic seulement, n'influence jamais la simulation. */
  totalMs: number;
  maxMs: number;
}

type Entry = { task: MunicipalTask; seq: number; stats: TaskStats };

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class MultiRateScheduler {
  private readonly entries: Entry[] = [];
  private seq = 0;
  /** Dernières échéances exécutées (-1 = aucune) : persistées pour ne rien rejouer après un chargement. */
  lastHour = -1;
  lastDay = -1;
  lastMonth = -1;
  private lastDayAt = -1;
  private lastMonthAt = -1;
  tickCount = 0;
  /** Journal des erreurs (remplaçable). */
  log: (message: string) => void = () => {};

  add(task: MunicipalTask): void {
    if (!task.id) throw new Error('ordonnanceur : tâche sans identifiant');
    if (this.entries.some((e) => e.task.id === task.id)) throw new Error(`ordonnanceur : tâche ${task.id} déjà enregistrée`);
    if (!['tick', 'hour', 'day', 'month'].includes(task.every)) throw new Error(`ordonnanceur : fréquence ${String(task.every)} inconnue`);
    this.entries.push({ task, seq: this.seq++, stats: { id: task.id, every: task.every, runs: 0, errors: 0, totalMs: 0, maxMs: 0 } });
    this.entries.sort((a, b) => (a.task.order ?? 0) - (b.task.order ?? 0) || a.seq - b.seq);
  }

  remove(id: string): boolean {
    const k = this.entries.findIndex((e) => e.task.id === id);
    if (k >= 0) this.entries.splice(k, 1);
    return k >= 0;
  }

  has(id: string): boolean { return this.entries.some((e) => e.task.id === id); }
  ids(freq?: Frequency): string[] { return this.entries.filter((e) => !freq || e.task.every === freq).map((e) => e.task.id); }
  stats(): TaskStats[] { return this.entries.map((e) => ({ ...e.stats })); }

  private run(freq: Frequency, info: TaskInfo): void {
    for (const e of this.entries) {
      if (e.task.every !== freq) continue;
      const t0 = now();
      try {
        e.task.run(info);
      } catch (err) {
        e.stats.errors++;
        e.stats.lastError = err instanceof Error ? err.message : String(err);
        if (e.stats.errors === 1) this.log(`[municipal] tâche ${e.task.id} (${freq}) en erreur : ${e.stats.lastError}`);
      }
      const dt = now() - t0;
      e.stats.runs++;
      e.stats.totalMs += dt;
      if (dt > e.stats.maxMs) e.stats.maxMs = dt;
    }
  }

  /** Début de mois (événement MonthStart de base). Ignoré si ce mois a déjà été traité. */
  month(monthIndex: number, totalMinutes: number): void {
    if (monthIndex <= this.lastMonth) return;
    const minutes = this.lastMonthAt >= 0 ? totalMinutes - this.lastMonthAt : 0;
    this.lastMonth = monthIndex;
    this.lastMonthAt = totalMinutes;
    this.run('month', { freq: 'month', totalMinutes, minutes, index: monthIndex });
  }

  /** Début de journée (événement DayStart de base). Ignoré si ce jour a déjà été traité. */
  day(dayIndex: number, totalMinutes: number): void {
    if (dayIndex <= this.lastDay) return;
    const minutes = this.lastDayAt >= 0 ? totalMinutes - this.lastDayAt : 0;
    this.lastDay = dayIndex;
    this.lastDayAt = totalMinutes;
    this.run('day', { freq: 'day', totalMinutes, minutes, index: dayIndex });
  }

  /**
   * Fin d'un pas de simulation de `minutes` minutes arrivant à `totalMinutes` : tâches horaires pour chaque heure
   * franchie (la toute première heure de la partie, 0, n'est pas une échéance), puis tâches par tick.
   */
  advance(totalMinutes: number, minutes: number): void {
    const h1 = Math.floor(totalMinutes / MINUTES_PER_HOUR);
    if (this.lastHour < 0) this.lastHour = Math.floor(Math.max(0, totalMinutes - minutes) / MINUTES_PER_HOUR);
    for (let h = this.lastHour + 1; h <= h1; h++) {
      this.lastHour = h;
      this.run('hour', { freq: 'hour', totalMinutes: h * MINUTES_PER_HOUR, minutes: MINUTES_PER_HOUR, index: h });
    }
    this.run('tick', { freq: 'tick', totalMinutes, minutes, index: this.tickCount++ });
  }

  /** Remise à zéro des échéances (nouvelle partie) ; les tâches restent enregistrées. */
  resetClock(): void {
    this.lastHour = this.lastDay = this.lastMonth = -1;
    this.lastDayAt = this.lastMonthAt = -1;
    this.tickCount = 0;
  }

  toJSON(): { lastHour: number; lastDay: number; lastMonth: number; lastDayAt: number; lastMonthAt: number; tickCount: number } {
    return { lastHour: this.lastHour, lastDay: this.lastDay, lastMonth: this.lastMonth, lastDayAt: this.lastDayAt, lastMonthAt: this.lastMonthAt, tickCount: this.tickCount };
  }

  fromJSON(j: ReturnType<MultiRateScheduler['toJSON']>): void {
    this.lastHour = j.lastHour; this.lastDay = j.lastDay; this.lastMonth = j.lastMonth;
    this.lastDayAt = j.lastDayAt; this.lastMonthAt = j.lastMonthAt; this.tickCount = j.tickCount;
  }
}
