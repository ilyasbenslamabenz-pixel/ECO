/**
 * Sauvegarde automatique périodique, en rotation sur N emplacements (« auto-1 », « auto-2 »…)
 * pour ne jamais écraser la seule copie valide. Les minuteries sont injectables (tests).
 */
import type { SaveFile } from '../shared/contracts';
import type { Result } from './codec';
import type { SaveStore, SlotInfo } from './store';

export interface AutosaveOptions {
  /** Période (ms réelles). Défaut : 3 minutes. */
  intervalMs?: number;
  /** Nombre d'emplacements en rotation. Défaut : 3. */
  slots?: number;
  prefix?: string;
  onSaved?: (info: SlotInfo) => void;
  onError?: (message: string) => void;
  timers?: { set: (fn: () => void, ms: number) => unknown; clear: (h: unknown) => void };
}

export class Autosaver {
  private handle: unknown = null;
  private busy = false;
  private nextIndex = -1;
  readonly intervalMs: number;
  readonly slotCount: number;
  readonly prefix: string;

  constructor(private readonly requestSave: () => Promise<SaveFile>, private readonly store: SaveStore, private readonly opts: AutosaveOptions = {}) {
    this.intervalMs = Math.max(10_000, opts.intervalMs ?? 180_000);
    this.slotCount = Math.max(1, Math.min(10, opts.slots ?? 3));
    this.prefix = opts.prefix ?? 'auto-';
  }

  get running(): boolean { return this.handle !== null; }

  start(): void {
    if (this.handle !== null) return;
    const t = this.opts.timers ?? { set: (fn: () => void, ms: number) => setInterval(fn, ms), clear: (h: unknown) => clearInterval(h as ReturnType<typeof setInterval>) };
    this.handle = t.set(() => { void this.saveNow(); }, this.intervalMs);
  }

  stop(): void {
    if (this.handle === null) return;
    const t = this.opts.timers ?? { set: () => 0, clear: (h: unknown) => clearInterval(h as ReturnType<typeof setInterval>) };
    t.clear(this.handle);
    this.handle = null;
  }

  /** Emplacement à écrire : le plus ancien (ou le premier absent) parmi les emplacements de rotation. */
  private async pickSlot(): Promise<string> {
    if (this.nextIndex < 0) {
      const existing = await this.store.list();
      let oldest = 0, oldestAt = '￿';
      for (let i = 0; i < this.slotCount; i++) {
        const info = existing.find((s) => s.slot === `${this.prefix}${i + 1}`);
        const at = info ? info.savedAt : '';
        if (at < oldestAt) { oldestAt = at; oldest = i; }
      }
      this.nextIndex = oldest;
    }
    const slot = `${this.prefix}${this.nextIndex + 1}`;
    this.nextIndex = (this.nextIndex + 1) % this.slotCount;
    return slot;
  }

  async saveNow(): Promise<Result<SlotInfo>> {
    if (this.busy) return { ok: false, message: 'Sauvegarde automatique déjà en cours' };
    this.busy = true;
    try {
      const data = await this.requestSave();
      const slot = await this.pickSlot();
      const r = await this.store.save(slot, data);
      if (r.ok) this.opts.onSaved?.(r.value);
      else this.opts.onError?.(r.message);
      return r;
    } catch (e) {
      const message = `Sauvegarde automatique impossible : ${e instanceof Error ? e.message : String(e)}`;
      this.opts.onError?.(message);
      return { ok: false, message };
    } finally {
      this.busy = false;
    }
  }
}
