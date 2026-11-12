/**
 * Planificateur d'événements de simulation : tas binaire (min-heap) trié par
 * (minute de jeu, ordre d'insertion). Événements ponctuels ou récurrents, données
 * numériques uniquement (sérialisables dans la sauvegarde, portables en C#/C++).
 * Pas d'allocation lors du dépilement des événements.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */

/** Types d'événements connus (valeurs stables : enregistrées dans les sauvegardes). */
export const SimEvent = {
  /** Début de journée (00:00) : démographie quotidienne. */
  DayStart: 1,
  /** Début de mois : économie mensuelle, historique. */
  MonthStart: 2,
  /** Début d'année : bilan annuel. */
  YearStart: 3,
  /** Mise à jour de l'attractivité et des immigrations (toutes les 6 h de jeu). */
  Migration: 4,
  /** Rappel ponctuel : avertissement de déficit. */
  DeficitWarning: 5,
  /** Synchronisation des occupants vers le module trafic (toutes les heures). */
  TrafficSync: 6,
} as const;
export type SimEventType = (typeof SimEvent)[keyof typeof SimEvent];

export interface ScheduledEvent {
  at: number;
  seq: number;
  type: number;
  /** Période de répétition en minutes (0 = ponctuel). */
  every: number;
  a: number;
  b: number;
}

export type EventHandler = (type: number, a: number, b: number, at: number) => void;

export class EventScheduler {
  private heap: ScheduledEvent[] = [];
  private seq = 0;

  get size(): number { return this.heap.length; }

  clear(): void { this.heap.length = 0; this.seq = 0; }

  schedule(at: number, type: number, a = 0, b = 0, every = 0): void {
    this.push({ at, seq: this.seq++, type, every, a, b });
  }

  /** Première échéance (Infinity si vide). */
  peekTime(): number { return this.heap.length ? this.heap[0]!.at : Infinity; }

  /** Exécute tous les événements dont l'échéance est <= now (récurrents replanifiés). Renvoie le nombre exécuté. */
  runDue(now: number, handler: EventHandler, maxEvents = 10_000): number {
    let n = 0;
    while (this.heap.length && this.heap[0]!.at <= now && n < maxEvents) {
      const e = this.heap[0]!;
      handler(e.type, e.a, e.b, e.at);
      n++;
      if (e.every > 0) {
        // Replanification en place (réutilise l'objet : aucune allocation).
        e.at += e.every;
        e.seq = this.seq++;
        this.siftDown(0);
      } else {
        this.popTop();
      }
    }
    return n;
  }

  /** Supprime tous les événements d'un type donné. */
  cancelType(type: number): void {
    const keep = this.heap.filter((e) => e.type !== type);
    this.heap.length = 0;
    for (const e of keep) this.push(e);
  }

  has(type: number): boolean { return this.heap.some((e) => e.type === type); }

  toJSON(): { seq: number; events: ScheduledEvent[] } {
    return { seq: this.seq, events: this.heap.map((e) => ({ ...e })).sort((x, y) => x.at - y.at || x.seq - y.seq) };
  }

  fromJSON(j: { seq: number; events: ScheduledEvent[] }): void {
    this.clear();
    for (const e of j.events) this.push({ ...e });
    this.seq = Math.max(j.seq, this.seq);
  }

  private less(i: number, j: number): boolean {
    const a = this.heap[i]!, b = this.heap[j]!;
    return a.at < b.at || (a.at === b.at && a.seq < b.seq);
  }

  private swap(i: number, j: number): void {
    const t = this.heap[i]!;
    this.heap[i] = this.heap[j]!;
    this.heap[j] = t;
  }

  private push(e: ScheduledEvent): void {
    this.heap.push(e);
    let i = this.heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p);
      i = p;
    }
  }

  private popTop(): void {
    const last = this.heap.pop()!;
    if (this.heap.length) {
      this.heap[0] = last;
      this.siftDown(0);
    }
  }

  private siftDown(i: number): void {
    const n = this.heap.length;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < n && this.less(l, m)) m = l;
      if (r < n && this.less(r, m)) m = r;
      if (m === i) return;
      this.swap(i, m);
      i = m;
    }
  }
}
