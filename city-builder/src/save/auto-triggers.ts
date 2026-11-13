/**
 * Déclencheurs de sauvegarde ENTIÈREMENT AUTOMATIQUE (aucune action du joueur), en plus de
 * l'autosauvegarde périodique (Autosaver, 3 min) :
 * - après chaque action importante (construction, démolition) : au plus une fois par minute, avec
 *   une sauvegarde « de rattrapage » en fin de minute pour ne pas perdre la dernière action ;
 * - onglet en arrière-plan / fermeture (visibilitychange caché, pagehide) : sauvegarde + envoi en ligne ;
 * - retour au menu : sauvegarde + envoi en ligne.
 * Les sauvegardes passent par l'Autosaver (emplacements tournants auto-1..3) ; l'envoi en ligne est
 * celui du CloudSlotProvider (src/save/cloud.ts). Minuteries et horloge injectables (tests).
 */
import type { Timers } from './cloud';

/** Commandes de simulation qui déclenchent une sauvegarde automatique. */
export const IMPORTANT_COMMANDS: ReadonlySet<string> = new Set(['placeBuilding', 'demolish', 'buildRoad', 'removeRoad']);

export interface AutoTriggerOptions {
  /** Sauvegarde locale immédiate (ex. `autosaver.saveNow()`). */
  saveNow: () => Promise<unknown>;
  /** Envoi en ligne de tout ce qui attend (ex. `cloud.flush()`), sans limitation. */
  flushCloud?: () => Promise<void>;
  /** Partie en cours (pas de sauvegarde au menu principal ni en démonstration). */
  isActive: () => boolean;
  actionMinIntervalMs?: number;
  now?: () => number;
  timers?: Timers;
}

export class AutoSaveTriggers {
  private last = Number.NEGATIVE_INFINITY;
  private timer: unknown = null;
  private readonly minInterval: number;
  private readonly now: () => number;
  private readonly timers: Timers;
  /** Nombre de sauvegardes déclenchées (diagnostic / tests). */
  saves = 0;

  constructor(private readonly o: AutoTriggerOptions) {
    this.minInterval = o.actionMinIntervalMs ?? 60_000;
    this.now = o.now ?? Date.now;
    this.timers = o.timers ?? { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };
  }

  private async save(): Promise<void> {
    this.last = this.now();
    this.saves++;
    try { await this.o.saveNow(); } catch { /* erreur déjà signalée par l'Autosaver */ }
  }

  private cancel(): void {
    if (this.timer !== null) { this.timers.clear(this.timer); this.timer = null; }
  }

  /** Une action importante vient d'être appliquée. */
  noteAction(): Promise<void> {
    if (!this.o.isActive() || this.timer !== null) return Promise.resolve();
    const wait = this.last + this.minInterval - this.now();
    if (wait <= 0) return this.save();
    this.timer = this.timers.set(() => { this.timer = null; if (this.o.isActive()) void this.save(); }, wait);
    return Promise.resolve();
  }

  /** Onglet caché, fermeture, retour au menu : sauvegarde locale puis envoi en ligne immédiat. */
  async saveAndFlush(): Promise<void> {
    if (!this.o.isActive()) return;
    this.cancel();
    await this.save();
    try { await this.o.flushCloud?.(); } catch { /* hors ligne : la locale suffit */ }
  }

  /** Écoute visibilitychange (caché) et pagehide. */
  install(win: { addEventListener(t: string, f: () => void): void } = globalThis as never, doc?: { visibilityState: string; addEventListener(t: string, f: () => void): void }): void {
    const d = doc ?? (globalThis as { document?: Document }).document;
    d?.addEventListener('visibilitychange', () => { if (d.visibilityState === 'hidden') void this.saveAndFlush(); });
    win.addEventListener?.('pagehide', () => { void this.saveAndFlush(); });
  }
}

/** Emplacement à proposer pour « Continuer » : la partie la plus récente (locale ou en ligne). */
export function latestSlot(list: ReadonlyArray<{ slot: string; savedAt: string }>): string | null {
  let best: { slot: string; savedAt: string } | null = null;
  for (const s of list) if (!best || s.savedAt > best.savedAt) best = s;
  return best?.slot ?? null;
}
