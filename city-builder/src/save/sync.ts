/**
 * Synchronisation générique « local d'abord » des emplacements de sauvegarde avec un stockage en ligne.
 *
 * `SyncedSlotProvider` est un SaveStore (même interface : save/load/has/list/remove) qui enveloppe le
 * stockage local : écriture locale immédiate puis envoi en ligne en arrière-plan ; lecture = la plus
 * récente des deux (`savedAt`). Une seule opération à la fois par emplacement (file par emplacement),
 * aucun envoi si l'empreinte SHA-256 n'a pas changé ou si la version en ligne est plus récente,
 * autosauvegardes (« auto-* ») envoyées au plus une fois toutes les 2 min (+ `flush()` à la sortie).
 *
 * Le transport est abstrait par `RemoteSlots` :
 *  - src/save/cloud.ts : base de l'artifact claude.ai (documents découpés en morceaux) ;
 *  - src/save/account.ts : comptes joueurs Supabase (une ligne par emplacement, PostgREST).
 */
import type { SaveFile } from '../shared/contracts';
import type { SaveFileV2 } from '../sim/save-format';
import { decodeSave, isGzip, type Result } from './codec';
import { SaveStore, SLOT_RE, type SlotInfo } from './store';

// ---------- État publié (indicateur d'interface) ----------

export const CLOUD_SAVE_EVENT = 'meknes:cloudsave';
export type CloudSaveState = 'disabled' | 'connecting' | 'online' | 'syncing' | 'offline';
export interface CloudSaveStatus {
  state: CloudSaveState;
  /** Libellé court pour l'interface (vide si désactivé). */
  label: string;
  /** Dernière synchronisation réussie (ISO) ou null. */
  lastSyncAt: string | null;
  /** Envois en attente (file + autosauvegardes différées). */
  pending: number;
  message?: string;
}

export const CLOUD_LABELS: Record<CloudSaveState, string> = {
  disabled: '',
  connecting: 'Connexion aux sauvegardes en ligne…',
  online: 'Sauvegardé en ligne',
  syncing: 'Envoi en ligne…',
  offline: 'Hors ligne — sauvegarde locale',
};

/** Publie l'état dans `window.__aube.cloudSave` et l'évènement `meknes:cloudsave` (si navigateur). */
export function publishCloudStatus(s: CloudSaveStatus): void {
  const g = globalThis as { __aube?: { cloudSave?: CloudSaveStatus }; dispatchEvent?: (e: Event) => boolean };
  if (g.__aube) g.__aube.cloudSave = s;
  if (typeof g.dispatchEvent === 'function' && typeof CustomEvent !== 'undefined') {
    try { g.dispatchEvent(new CustomEvent(CLOUD_SAVE_EVENT, { detail: s })); } catch { /* sans importance */ }
  }
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('SHA-256 indisponible (contexte non sécurisé)');
  const h = new Uint8Array(await subtle.digest('SHA-256', bytes as BufferSource));
  let s = '';
  for (const b of h) s += b.toString(16).padStart(2, '0');
  return s;
}

export const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// ---------- Transport ----------

/** Métadonnées minimales d'une sauvegarde en ligne. */
export interface RemoteMeta {
  slot: string;
  /** `savedAt` de la sauvegarde elle-même (sert à choisir la plus récente). */
  savedAt: string;
  sha256: string;
  info: SlotInfo;
}

export interface RemoteSlots<M extends RemoteMeta = RemoteMeta> {
  /** Toutes les métadonnées en ligne (entrées invalides ignorées). */
  list(): Promise<M[]>;
  /** Métadonnées d'un emplacement, ou null s'il n'existe pas en ligne. */
  get(slot: string): Promise<M | null>;
  /** Octets de la sauvegarde ; null si incomplète ou incohérente (l'empreinte est vérifiée ensuite). */
  download(meta: M): Promise<Uint8Array | null>;
  /** Écrit la sauvegarde (prev = version en ligne lue juste avant) et rend ses nouvelles métadonnées. */
  upload(slot: string, bytes: Uint8Array, info: SlotInfo, sha256: string, prev: M | null): Promise<M>;
  remove(slot: string): Promise<void>;
}

export interface Timers { set(fn: () => void, ms: number): unknown; clear(h: unknown): void }

export const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export interface SyncOptions<M extends RemoteMeta = RemoteMeta> {
  /** Stockage en ligne ; null = hors ligne (tout local). */
  remote: RemoteSlots<M> | null;
  /** Emplacements synchronisables (défaut : SLOT_RE). */
  slotOk?: (slot: string) => boolean;
  /** Intervalle minimal entre deux envois d'autosauvegarde (ms). Défaut : 2 min. */
  autoMinIntervalMs?: number;
  autoPrefix?: string;
  now?: () => number;
  timers?: Timers;
  onStatus?: (s: CloudSaveStatus) => void;
  /** Message affiché quand `remote` est null. */
  offlineReason?: string;
}

// ---------- Fournisseur ----------

export class SyncedSlotProvider<M extends RemoteMeta = RemoteMeta> extends SaveStore {
  protected readonly remote: RemoteSlots<M> | null;
  protected readonly slotOk: (slot: string) => boolean;
  private readonly minInterval: number;
  private readonly autoPrefix: string;
  protected readonly now: () => number;
  private readonly timers: Timers;
  private readonly onStatus: (s: CloudSaveStatus) => void;
  /** Dernières métadonnées en ligne connues, par emplacement. */
  protected readonly metas = new Map<string, M>();
  private readonly chains = new Map<string, Promise<void>>();
  private readonly queued = new Set<string>();
  /** Envois différés (autosauvegardes limitées, ou envoi échoué à retenter). */
  private readonly dirty = new Set<string>();
  /** Suppressions en cours (masquées dans la liste jusqu'à leur fin). */
  private readonly removing = new Set<string>();
  private lastDeferredFlush = Number.NEGATIVE_INFINITY;
  private timer: unknown = null;
  private busy = 0;
  private stopped = false;
  private current: CloudSaveStatus;

  constructor(local: SaveStore, opts: SyncOptions<M>) {
    super(local.backend, local.compress);
    this.remote = opts.remote;
    this.slotOk = opts.slotOk ?? ((s) => SLOT_RE.test(s));
    this.minInterval = opts.autoMinIntervalMs ?? 120_000;
    this.autoPrefix = opts.autoPrefix ?? 'auto-';
    this.now = opts.now ?? Date.now;
    this.timers = opts.timers ?? realTimers;
    this.onStatus = opts.onStatus ?? publishCloudStatus;
    this.current = { state: this.remote ? 'connecting' : 'offline', label: '', lastSyncAt: null, pending: 0 };
    if (!this.remote) this.current.message = opts.offlineReason ?? 'Sauvegardes en ligne indisponibles';
    this.emit();
  }

  get online(): boolean { return this.remote !== null; }
  get status(): CloudSaveStatus { return { ...this.current }; }

  /** Arrête les envois différés et ne publie plus d'état (déconnexion, changement de compte). */
  stop(): void {
    this.stopped = true;
    if (this.timer !== null) { this.timers.clear(this.timer); this.timer = null; }
  }

  // ----- état -----

  protected emit(patch: Partial<CloudSaveStatus> = {}): void {
    Object.assign(this.current, patch);
    if (this.busy > 0 && this.current.state === 'online') this.current.state = 'syncing';
    if (this.busy === 0 && this.current.state === 'syncing') this.current.state = 'online';
    this.current.pending = this.queued.size + this.dirty.size;
    this.current.label = CLOUD_LABELS[this.current.state];
    if (!this.stopped) this.onStatus({ ...this.current });
  }
  protected succeeded(): void {
    this.emit({ state: 'online', lastSyncAt: new Date(this.now()).toISOString(), message: undefined });
  }
  protected failed(e: unknown): void {
    this.emit({ state: 'offline', message: `Sauvegarde en ligne impossible : ${errMsg(e)}` });
  }

  private isAuto(slot: string): boolean { return slot.startsWith(this.autoPrefix); }

  /** Une opération à la fois par emplacement. */
  private enqueue(slot: string, fn: () => Promise<void>): Promise<void> {
    const prev = this.chains.get(slot) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(fn);
    this.chains.set(slot, next);
    void next.catch(() => undefined).then(() => { if (this.chains.get(slot) === next) this.chains.delete(slot); });
    return next;
  }

  /** Attend la fin de toutes les opérations en cours (tests, sortie). */
  async idle(): Promise<void> {
    while (this.chains.size) await Promise.all([...this.chains.values()].map((p) => p.catch(() => undefined)));
  }

  // ----- réseau -----

  private async fetchMeta(slot: string): Promise<M | null> {
    const m = await this.remote!.get(slot);
    if (m && m.slot === slot) { this.metas.set(slot, m); return m; }
    this.metas.delete(slot);
    return null;
  }

  private async refreshMetas(): Promise<void> {
    const all = await this.remote!.list();
    this.metas.clear();
    for (const m of all) if (this.slotOk(m.slot)) this.metas.set(m.slot, m);
  }

  /** Octets complets et empreinte vérifiée ; null sinon (sauvegarde ignorée). */
  private async download(meta: M): Promise<Uint8Array | null> {
    const bytes = await this.remote!.download(meta);
    if (!bytes) return null;
    return (await sha256Hex(bytes)) === meta.sha256 ? bytes : null;
  }

  private async upload(slot: string): Promise<void> {
    if (this.stopped) return;
    const raw = await this.getRaw(slot);
    if (!raw) return;
    this.busy++;
    this.emit();
    try {
      const sha = await sha256Hex(raw.bytes);
      const prev = await this.fetchMeta(slot);
      if (prev && (prev.sha256 === sha || prev.savedAt > raw.info.savedAt)) { this.succeeded(); return; } // inchangé, ou plus récent en ligne
      const meta = await this.remote!.upload(slot, raw.bytes, raw.info, sha, prev);
      this.metas.set(slot, meta);
      this.succeeded();
    } catch (e) {
      this.failed(e);
      this.defer(slot); // nouvel essai au prochain créneau
    } finally {
      this.busy--;
      this.emit();
    }
  }

  protected enqueueUpload(slot: string): Promise<void> {
    if (this.queued.has(slot)) return this.chains.get(slot) ?? Promise.resolve();
    this.queued.add(slot);
    return this.enqueue(slot, async () => { this.queued.delete(slot); await this.upload(slot); });
  }

  private defer(slot: string): void {
    if (this.stopped) return;
    this.dirty.add(slot);
    if (this.timer !== null) return;
    const wait = Math.max(0, this.lastDeferredFlush + this.minInterval - this.now());
    this.timer = this.timers.set(() => { this.timer = null; void this.flushDeferred(); }, wait);
  }

  private flushDeferred(): Promise<void> {
    if (!this.dirty.size || this.stopped) return Promise.resolve();
    this.lastDeferredFlush = this.now();
    const slots = [...this.dirty];
    this.dirty.clear();
    return Promise.all(slots.map((s) => this.enqueueUpload(s))).then(() => undefined);
  }

  /** Envoie tout ce qui attend, sans limitation (sortie de page, retour du réseau). */
  async flush(): Promise<void> {
    if (!this.remote || this.stopped) return;
    if (this.timer !== null) { this.timers.clear(this.timer); this.timer = null; }
    await this.flushDeferred();
    await this.idle();
  }

  private async pullIfNewer(slot: string): Promise<void> {
    const meta = await this.fetchMeta(slot);
    if (!meta) return;
    const local = await this.getRaw(slot);
    if (local && local.info.savedAt >= meta.savedAt) return;
    const bytes = await this.download(meta);
    if (!bytes) return; // incomplète ou corrompue : on garde la locale
    const d = await decodeSave(bytes);
    if (!d.ok) return;
    await this.putRaw(slot, bytes, { ...meta.info, slot, compressed: isGzip(bytes) });
  }

  /**
   * Premier contact : liste les sauvegardes en ligne et envoie les locales absentes ou plus récentes
   * (migration des sauvegardes existantes ; idempotent grâce aux empreintes).
   */
  async start(): Promise<string[]> {
    if (!this.remote || this.stopped) return [];
    try { await this.refreshMetas(); } catch (e) { this.failed(e); return []; }
    this.succeeded();
    const toSend = (await super.list())
      .filter((l) => { const m = this.metas.get(l.slot); return this.slotOk(l.slot) && (!m || m.savedAt < l.savedAt); })
      .map((l) => l.slot);
    await Promise.all(toSend.map((s) => this.enqueueUpload(s)));
    return toSend;
  }

  // ----- interface SaveStore -----

  override async save(slot: string, data: SaveFile): Promise<Result<SlotInfo>> {
    const r = await super.save(slot, data);
    if (r.ok && this.remote && this.slotOk(slot)) {
      this.removing.delete(slot);
      if (this.isAuto(slot)) this.defer(slot);
      else void this.enqueueUpload(slot);
    }
    return r;
  }

  override async load(slot: string): Promise<Result<SaveFileV2>> {
    if (this.remote && this.slotOk(slot)) {
      try { await this.enqueue(slot, () => this.pullIfNewer(slot)); } catch (e) { this.failed(e); }
    }
    return super.load(slot);
  }

  override async has(slot: string): Promise<boolean> {
    return (await super.has(slot)) || (this.metas.has(slot) && !this.removing.has(slot));
  }

  override async list(): Promise<SlotInfo[]> {
    const local = await super.list();
    if (!this.remote) return local;
    try { await this.refreshMetas(); this.succeeded(); } catch (e) { this.failed(e); }
    const bySlot = new Map(local.map((l) => [l.slot, l]));
    for (const [slot, m] of this.metas) {
      if (this.removing.has(slot)) continue;
      const l = bySlot.get(slot);
      if (!l || m.savedAt > l.savedAt) bySlot.set(slot, { ...m.info, slot });
    }
    return [...bySlot.values()].filter((l) => !this.removing.has(l.slot)).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }

  override async remove(slot: string): Promise<void> {
    await super.remove(slot);
    if (!this.remote || !this.slotOk(slot)) return;
    this.dirty.delete(slot);
    this.removing.add(slot);
    void this.enqueue(slot, async () => {
      try {
        await this.remote!.remove(slot);
        this.metas.delete(slot);
        this.removing.delete(slot);
        this.succeeded();
      } catch (e) { this.failed(e); }
    });
  }
}
