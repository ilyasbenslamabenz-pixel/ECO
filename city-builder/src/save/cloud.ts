/**
 * Sauvegardes EN LIGNE privées par joueur (artifact claude.ai, API `window.claude.use("db")`).
 *
 * `CloudSlotProvider` est un SaveStore (même interface : save/load/has/list/remove) qui enveloppe le
 * stockage local : écriture locale immédiate puis envoi en ligne en arrière-plan ; lecture = la plus
 * récente des deux (`savedAt`). Hors artifact (`window.claude` absent) `attachCloudSaves` rend le
 * SaveStore local INCHANGÉ ; dans l'artifact sans connexion (db/user null) tout reste local.
 *
 * Stockage : collection privée `data/users/<id>` ; par emplacement, un document méta `save__<slot>`
 * (écrit EN DERNIER) et des morceaux `save__<slot>__part__<n>` (gzip -> base64, ≤ 180 000 caractères
 * chacun, sous la limite de 256 Kio par document). À la lecture : morceaux complets + empreinte
 * SHA-256 + décodage validé, sinon la sauvegarde en ligne est ignorée (la locale est gardée).
 * Une seule opération à la fois par emplacement (file par emplacement), aucun envoi si l'empreinte
 * n'a pas changé, autosauvegardes (« auto-* ») envoyées au plus une fois toutes les 2 min, plus un
 * envoi forcé à la sortie (visibilitychange caché / pagehide). Détails : docs/SAUVEGARDES.md.
 */
import type { SaveFile } from '../shared/contracts';
import type { SaveFileV2 } from '../sim/save-format';
import { base64ToBytes, bytesToBase64, decodeSave, isGzip, type Result } from './codec';
import { SaveStore, SLOT_RE, type SlotInfo } from './store';

// ---------- API minimale de la base (sous-ensemble du runtime claude.ai) ----------

export interface DocSnapshotLike { readonly exists: boolean | (() => boolean); data(): unknown }
export interface DocRefLike {
  get(): Promise<DocSnapshotLike>;
  set(data: object): Promise<unknown>;
  delete(): Promise<unknown>;
}
export interface QuerySnapshotLike { readonly docs: ReadonlyArray<{ readonly id: string; data(): unknown }> }
export interface QueryLike { get(): Promise<QuerySnapshotLike> }
export interface CollectionLike {
  doc(id: string): DocRefLike;
  where(field: string, op: string, value: unknown): QueryLike;
}
export interface DbLike { collection(path: string): CollectionLike }
export interface ClaudeLike { use?(name: string): Promise<unknown> }

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

const LABELS: Record<CloudSaveState, string> = {
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

// ---------- Format en ligne ----------

export const PART_CHARS = 180_000;
const MAX_PARTS = 200;
const FORMAT = 1;

export interface CloudMeta {
  kind: 'meta';
  format: number;
  slot: string;
  name: string;
  savedAt: string;
  version: number;
  bytes: number;
  compressed: boolean;
  parts: number;
  sha256: string;
  uploadedAt: string;
  info: SlotInfo;
}

export const metaId = (slot: string): string => `save__${slot}`;
export const partId = (slot: string, n: number): string => `save__${slot}__part__${n}`;
/** Emplacements synchronisables (« __part__ » interdit : ambiguïté avec les identifiants de morceaux). */
export const cloudSlotOk = (slot: string): boolean => SLOT_RE.test(slot) && !slot.includes('__');

export function splitParts(text: string, size = PART_CHARS): string[] {
  if (size <= 0) throw new Error('taille de morceau invalide');
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out.length ? out : [''];
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('SHA-256 indisponible (contexte non sécurisé)');
  const h = new Uint8Array(await subtle.digest('SHA-256', bytes as BufferSource));
  let s = '';
  for (const b of h) s += b.toString(16).padStart(2, '0');
  return s;
}

function parseMeta(raw: unknown): CloudMeta | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Partial<CloudMeta>;
  if (m.kind !== 'meta' || m.format !== FORMAT || typeof m.slot !== 'string' || !cloudSlotOk(m.slot)) return null;
  if (typeof m.savedAt !== 'string' || typeof m.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(m.sha256)) return null;
  if (!Number.isInteger(m.parts) || (m.parts as number) < 1 || (m.parts as number) > MAX_PARTS) return null;
  if (!Number.isInteger(m.bytes) || (m.bytes as number) < 1) return null;
  if (!m.info || typeof m.info !== 'object') return null;
  return m as CloudMeta;
}

const exists = (s: DocSnapshotLike): boolean => (typeof s.exists === 'function' ? s.exists() : !!s.exists);
const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// ---------- Fournisseur ----------

export interface Timers { set(fn: () => void, ms: number): unknown; clear(h: unknown): void }

export interface CloudOptions {
  /** Collection privée du joueur (`data/users/<id>`) ; null = hors ligne (tout local). */
  col: CollectionLike | null;
  partChars?: number;
  /** Intervalle minimal entre deux envois d'autosauvegarde (ms). Défaut : 2 min. */
  autoMinIntervalMs?: number;
  autoPrefix?: string;
  /** Délai maximal d'une opération réseau (ms). Défaut : 20 s. */
  timeoutMs?: number;
  now?: () => number;
  timers?: Timers;
  onStatus?: (s: CloudSaveStatus) => void;
  /** Message affiché quand `col` est null. */
  offlineReason?: string;
}

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export class CloudSlotProvider extends SaveStore {
  private readonly col: CollectionLike | null;
  private readonly partChars: number;
  private readonly minInterval: number;
  private readonly autoPrefix: string;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly timers: Timers;
  private readonly onStatus: (s: CloudSaveStatus) => void;
  /** Dernières métadonnées en ligne connues, par emplacement. */
  private readonly metas = new Map<string, CloudMeta>();
  private readonly chains = new Map<string, Promise<void>>();
  private readonly queued = new Set<string>();
  /** Envois différés (autosauvegardes limitées, ou envoi échoué à retenter). */
  private readonly dirty = new Set<string>();
  /** Suppressions en cours (masquées dans la liste jusqu'à leur fin). */
  private readonly removing = new Set<string>();
  private lastDeferredFlush = Number.NEGATIVE_INFINITY;
  private timer: unknown = null;
  private busy = 0;
  private current: CloudSaveStatus;

  constructor(local: SaveStore, opts: CloudOptions) {
    super(local.backend, local.compress);
    this.col = opts.col;
    this.partChars = opts.partChars ?? PART_CHARS;
    this.minInterval = opts.autoMinIntervalMs ?? 120_000;
    this.autoPrefix = opts.autoPrefix ?? 'auto-';
    this.timeoutMs = opts.timeoutMs ?? 20_000;
    this.now = opts.now ?? Date.now;
    this.timers = opts.timers ?? realTimers;
    this.onStatus = opts.onStatus ?? publishCloudStatus;
    this.current = { state: this.col ? 'connecting' : 'offline', label: '', lastSyncAt: null, pending: 0 };
    if (!this.col) this.current.message = opts.offlineReason ?? 'Sauvegardes en ligne indisponibles';
    this.emit();
  }

  get online(): boolean { return this.col !== null; }
  get status(): CloudSaveStatus { return { ...this.current }; }

  // ----- état -----

  private emit(patch: Partial<CloudSaveStatus> = {}): void {
    Object.assign(this.current, patch);
    if (this.busy > 0 && this.current.state === 'online') this.current.state = 'syncing';
    if (this.busy === 0 && this.current.state === 'syncing') this.current.state = 'online';
    this.current.pending = this.queued.size + this.dirty.size;
    this.current.label = LABELS[this.current.state];
    this.onStatus({ ...this.current });
  }
  private succeeded(): void {
    this.emit({ state: 'online', lastSyncAt: new Date(this.now()).toISOString(), message: undefined });
  }
  private failed(e: unknown): void {
    this.emit({ state: 'offline', message: `Sauvegarde en ligne impossible : ${errMsg(e)}` });
  }

  private t<T>(p: Promise<T>): Promise<T> {
    let h: ReturnType<typeof setTimeout> | undefined;
    const to = new Promise<never>((_, rej) => { h = setTimeout(() => rej(new Error('délai réseau dépassé')), this.timeoutMs); });
    return Promise.race([p, to]).finally(() => clearTimeout(h));
  }

  private isAuto(slot: string): boolean { return slot.startsWith(this.autoPrefix); }

  /** Une opération à la fois par emplacement (donc par document). */
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

  private async fetchMeta(slot: string): Promise<CloudMeta | null> {
    const snap = await this.t(this.col!.doc(metaId(slot)).get());
    const m = exists(snap) ? parseMeta(snap.data()) : null;
    if (m && m.slot === slot) { this.metas.set(slot, m); return m; }
    this.metas.delete(slot);
    return null;
  }

  private async refreshMetas(): Promise<void> {
    const snap = await this.t(this.col!.where('kind', '==', 'meta').get());
    this.metas.clear();
    for (const d of snap.docs) {
      const m = parseMeta(d.data());
      if (m && d.id === metaId(m.slot)) this.metas.set(m.slot, m);
    }
  }

  /** Morceaux complets, taille et empreinte vérifiées ; null sinon (sauvegarde ignorée). */
  private async download(meta: CloudMeta): Promise<Uint8Array | null> {
    const chunks: string[] = [];
    for (let n = 0; n < meta.parts; n++) {
      const snap = await this.t(this.col!.doc(partId(meta.slot, n)).get());
      if (!exists(snap)) return null;
      const p = snap.data() as { data?: unknown; sha256?: unknown } | null;
      if (!p || typeof p.data !== 'string' || p.sha256 !== meta.sha256) return null;
      chunks.push(p.data);
    }
    let bytes: Uint8Array;
    try { bytes = base64ToBytes(chunks.join('')); } catch { return null; }
    if (bytes.length !== meta.bytes) return null;
    return (await sha256Hex(bytes)) === meta.sha256 ? bytes : null;
  }

  private async upload(slot: string): Promise<void> {
    const raw = await this.getRaw(slot);
    if (!raw) return;
    this.busy++;
    this.emit();
    try {
      const sha = await sha256Hex(raw.bytes);
      const prev = await this.fetchMeta(slot);
      if (prev && (prev.sha256 === sha || prev.savedAt > raw.info.savedAt)) { this.succeeded(); return; } // inchangé, ou plus récent en ligne
      const parts = splitParts(bytesToBase64(raw.bytes), this.partChars);
      if (parts.length > MAX_PARTS) throw new Error(`sauvegarde trop volumineuse (${raw.bytes.length} octets)`);
      for (let n = 0; n < parts.length; n++) {
        await this.t(this.col!.doc(partId(slot, n)).set({ kind: 'part', slot, n, sha256: sha, data: parts[n] }));
      }
      const meta: CloudMeta = {
        kind: 'meta', format: FORMAT, slot, name: raw.info.cityName, savedAt: raw.info.savedAt, version: raw.info.version,
        bytes: raw.bytes.length, compressed: isGzip(raw.bytes), parts: parts.length, sha256: sha,
        uploadedAt: new Date(this.now()).toISOString(), info: raw.info,
      };
      await this.t(this.col!.doc(metaId(slot)).set(meta)); // méta en dernier : rend la nouvelle version visible
      this.metas.set(slot, meta);
      for (let n = parts.length; prev && n < prev.parts; n++) {
        try { await this.t(this.col!.doc(partId(slot, n)).delete()); } catch { /* morceau orphelin sans effet */ }
      }
      this.succeeded();
    } catch (e) {
      this.failed(e);
      this.defer(slot); // nouvel essai au prochain créneau
    } finally {
      this.busy--;
      this.emit();
    }
  }

  private enqueueUpload(slot: string): Promise<void> {
    if (this.queued.has(slot)) return this.chains.get(slot) ?? Promise.resolve();
    this.queued.add(slot);
    return this.enqueue(slot, async () => { this.queued.delete(slot); await this.upload(slot); });
  }

  private defer(slot: string): void {
    this.dirty.add(slot);
    if (this.timer !== null) return;
    const wait = Math.max(0, this.lastDeferredFlush + this.minInterval - this.now());
    this.timer = this.timers.set(() => { this.timer = null; void this.flushDeferred(); }, wait);
  }

  private flushDeferred(): Promise<void> {
    if (!this.dirty.size) return Promise.resolve();
    this.lastDeferredFlush = this.now();
    const slots = [...this.dirty];
    this.dirty.clear();
    return Promise.all(slots.map((s) => this.enqueueUpload(s))).then(() => undefined);
  }

  /** Envoie tout ce qui attend, sans limitation (sortie de page). */
  async flush(): Promise<void> {
    if (!this.col) return;
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
    if (!this.col) return [];
    try { await this.refreshMetas(); } catch (e) { this.failed(e); return []; }
    this.succeeded();
    const toSend = (await super.list())
      .filter((l) => { const m = this.metas.get(l.slot); return cloudSlotOk(l.slot) && (!m || m.savedAt < l.savedAt); })
      .map((l) => l.slot);
    await Promise.all(toSend.map((s) => this.enqueueUpload(s)));
    return toSend;
  }

  // ----- interface SaveStore -----

  override async save(slot: string, data: SaveFile): Promise<Result<SlotInfo>> {
    const r = await super.save(slot, data);
    if (r.ok && this.col && cloudSlotOk(slot)) {
      this.removing.delete(slot);
      if (this.isAuto(slot)) this.defer(slot);
      else void this.enqueueUpload(slot);
    }
    return r;
  }

  override async load(slot: string): Promise<Result<SaveFileV2>> {
    if (this.col && cloudSlotOk(slot)) {
      try { await this.enqueue(slot, () => this.pullIfNewer(slot)); } catch (e) { this.failed(e); }
    }
    return super.load(slot);
  }

  override async has(slot: string): Promise<boolean> {
    return (await super.has(slot)) || (this.metas.has(slot) && !this.removing.has(slot));
  }

  override async list(): Promise<SlotInfo[]> {
    const local = await super.list();
    if (!this.col) return local;
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
    if (!this.col || !cloudSlotOk(slot)) return;
    this.dirty.delete(slot);
    this.removing.add(slot);
    void this.enqueue(slot, async () => {
      try {
        const prev = await this.fetchMeta(slot);
        if (prev) {
          await this.t(this.col!.doc(metaId(slot)).delete()); // méta d'abord : la sauvegarde disparaît d'un coup
          for (let n = 0; n < prev.parts; n++) await this.t(this.col!.doc(partId(slot, n)).delete());
        }
        this.metas.delete(slot);
        this.removing.delete(slot);
        this.succeeded();
      } catch (e) { this.failed(e); }
    });
  }
}

// ---------- Branchement ----------

/** Collection privée du joueur, ou null (non connecté, API indisponible, identifiant inutilisable). */
export async function connectCollection(claude: ClaudeLike, timeoutMs = 20_000): Promise<CollectionLike | null> {
  let h: ReturnType<typeof setTimeout> | undefined;
  const to = new Promise<null>((res) => { h = setTimeout(() => res(null), timeoutMs); });
  const go = async (): Promise<CollectionLike | null> => {
    const db = (await claude.use?.('db')) as DbLike | null | undefined;
    if (!db || typeof db.collection !== 'function') return null;
    const user = (await claude.use?.('user')) as { id?: () => Promise<unknown> } | null | undefined;
    const id = typeof user?.id === 'function' ? await user.id() : null;
    if (typeof id !== 'string' || !id || id.includes('/') || new TextEncoder().encode(id).length > 200) return null;
    return db.collection(`data/users/${id}`);
  };
  try { return await Promise.race([go().catch(() => null), to]); } finally { clearTimeout(h); }
}

export interface AttachOptions extends Omit<CloudOptions, 'col'> {
  /** Objet `window.claude` (injection pour les tests) ; défaut : globalThis.claude. */
  claude?: ClaudeLike | null;
  /** Ne pas lancer la migration/synchronisation initiale en arrière-plan. */
  noStart?: boolean;
}

/**
 * Hors artifact : renvoie `local` tel quel (état « disabled »). Dans l'artifact : renvoie un
 * CloudSlotProvider (hors ligne si non connecté) et lance la synchronisation initiale sans bloquer.
 */
export async function attachCloudSaves(local: SaveStore, opts: AttachOptions = {}): Promise<SaveStore> {
  const claude = 'claude' in opts ? opts.claude : (globalThis as { claude?: ClaudeLike }).claude;
  const onStatus = opts.onStatus ?? publishCloudStatus;
  if (!claude || typeof claude.use !== 'function') {
    onStatus({ state: 'disabled', label: '', lastSyncAt: null, pending: 0 });
    return local;
  }
  onStatus({ state: 'connecting', label: LABELS.connecting, lastSyncAt: null, pending: 0 });
  const col = await connectCollection(claude, opts.timeoutMs);
  const p = new CloudSlotProvider(local, { ...opts, onStatus, col, offlineReason: 'Non connecté : sauvegardes uniquement sur cet appareil' });
  if (col) {
    const g = globalThis as { document?: Document; addEventListener?: (t: string, f: () => void) => void };
    g.document?.addEventListener('visibilitychange', () => { if (g.document?.visibilityState === 'hidden') void p.flush(); });
    g.addEventListener?.('pagehide', () => { void p.flush(); });
    if (!opts.noStart) void p.start();
  }
  return p;
}
