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
 * Moteur de synchronisation commun (file, limitation, plus récente gagne) : src/save/sync.ts.
 */
import { base64ToBytes, bytesToBase64, isGzip } from './codec';
import { SLOT_RE, type SaveStore, type SlotInfo } from './store';
import { CLOUD_LABELS, publishCloudStatus, SyncedSlotProvider, type RemoteMeta, type RemoteSlots, type SyncOptions } from './sync';

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

// ---------- État publié (indicateur d'interface) : src/save/sync.ts ----------

export {
  CLOUD_SAVE_EVENT, publishCloudStatus, sha256Hex,
  type CloudSaveState, type CloudSaveStatus, type Timers,
} from './sync';

// ---------- Format en ligne ----------

export const PART_CHARS = 180_000;
const MAX_PARTS = 200;
const FORMAT = 1;

export interface CloudMeta extends RemoteMeta {
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

// ---------- Transport : collection de documents claude.ai ----------

/** Transport « documents » : méta `save__<slot>` (écrite en dernier) + morceaux `save__<slot>__part__<n>`. */
export class DocCollectionRemote implements RemoteSlots<CloudMeta> {
  constructor(private readonly col: CollectionLike, private readonly partChars = PART_CHARS, private readonly timeoutMs = 20_000, private readonly now: () => number = Date.now) {}

  private t<T>(p: Promise<T>): Promise<T> {
    let h: ReturnType<typeof setTimeout> | undefined;
    const to = new Promise<never>((_, rej) => { h = setTimeout(() => rej(new Error('délai réseau dépassé')), this.timeoutMs); });
    return Promise.race([p, to]).finally(() => clearTimeout(h));
  }

  async get(slot: string): Promise<CloudMeta | null> {
    const snap = await this.t(this.col.doc(metaId(slot)).get());
    const m = exists(snap) ? parseMeta(snap.data()) : null;
    return m && m.slot === slot ? m : null;
  }

  async list(): Promise<CloudMeta[]> {
    const snap = await this.t(this.col.where('kind', '==', 'meta').get());
    const out: CloudMeta[] = [];
    for (const d of snap.docs) {
      const m = parseMeta(d.data());
      if (m && d.id === metaId(m.slot)) out.push(m);
    }
    return out;
  }

  async download(meta: CloudMeta): Promise<Uint8Array | null> {
    const chunks: string[] = [];
    for (let n = 0; n < meta.parts; n++) {
      const snap = await this.t(this.col.doc(partId(meta.slot, n)).get());
      if (!exists(snap)) return null;
      const p = snap.data() as { data?: unknown; sha256?: unknown } | null;
      if (!p || typeof p.data !== 'string' || p.sha256 !== meta.sha256) return null;
      chunks.push(p.data);
    }
    let bytes: Uint8Array;
    try { bytes = base64ToBytes(chunks.join('')); } catch { return null; }
    return bytes.length === meta.bytes ? bytes : null;
  }

  async upload(slot: string, bytes: Uint8Array, info: SlotInfo, sha: string, prev: CloudMeta | null): Promise<CloudMeta> {
    const parts = splitParts(bytesToBase64(bytes), this.partChars);
    if (parts.length > MAX_PARTS) throw new Error(`sauvegarde trop volumineuse (${bytes.length} octets)`);
    for (let n = 0; n < parts.length; n++) {
      await this.t(this.col.doc(partId(slot, n)).set({ kind: 'part', slot, n, sha256: sha, data: parts[n] }));
    }
    const meta: CloudMeta = {
      kind: 'meta', format: FORMAT, slot, name: info.cityName, savedAt: info.savedAt, version: info.version,
      bytes: bytes.length, compressed: isGzip(bytes), parts: parts.length, sha256: sha,
      uploadedAt: new Date(this.now()).toISOString(), info,
    };
    await this.t(this.col.doc(metaId(slot)).set(meta)); // méta en dernier : rend la nouvelle version visible
    for (let n = parts.length; prev && n < prev.parts; n++) {
      try { await this.t(this.col.doc(partId(slot, n)).delete()); } catch { /* morceau orphelin sans effet */ }
    }
    return meta;
  }

  async remove(slot: string): Promise<void> {
    const prev = await this.get(slot);
    if (!prev) return;
    await this.t(this.col.doc(metaId(slot)).delete()); // méta d'abord : la sauvegarde disparaît d'un coup
    for (let n = 0; n < prev.parts; n++) await this.t(this.col.doc(partId(slot, n)).delete());
  }
}

// ---------- Fournisseur ----------

export interface CloudOptions extends Omit<SyncOptions<CloudMeta>, 'remote' | 'slotOk'> {
  /** Collection privée du joueur (`data/users/<id>`) ; null = hors ligne (tout local). */
  col: CollectionLike | null;
  partChars?: number;
  /** Délai maximal d'une opération réseau (ms). Défaut : 20 s. */
  timeoutMs?: number;
}

/** SaveStore synchronisé avec la base de l'artifact claude.ai (moteur commun : src/save/sync.ts). */
export class CloudSlotProvider extends SyncedSlotProvider<CloudMeta> {
  constructor(local: SaveStore, opts: CloudOptions) {
    const { col, partChars, timeoutMs, ...rest } = opts;
    super(local, { ...rest, slotOk: cloudSlotOk, remote: col ? new DocCollectionRemote(col, partChars, timeoutMs, opts.now) : null });
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
  onStatus({ state: 'connecting', label: CLOUD_LABELS.connecting, lastSyncAt: null, pending: 0 });
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
