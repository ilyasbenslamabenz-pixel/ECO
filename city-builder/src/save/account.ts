/**
 * COMPTES JOUEURS (Supabase) : sauvegardes en ligne liées à un compte e-mail + mot de passe.
 *
 * - `SupabaseSavesRemote` : transport PostgREST de la table `public.saves` (une ligne par emplacement :
 *   `data` = sauvegarde gzip en base64, `sha256`, `saved_at`, `meta` jsonb pour la liste). Upsert par
 *   POST `Prefer: resolution=merge-duplicates` (on_conflict=user_id,slot). Jeton expiré (401) :
 *   renouvelé puis requête rejouée une fois.
 * - `ScopedBackend` : espace local propre à un compte (`compte:<id>:…`) ; le mode invité garde les clés
 *   historiques, donc un autre joueur du même appareil ne voit pas les parties d'un compte.
 * - `AccountStore` : SaveStore unique donné au jeu, qui délègue au stockage du joueur courant
 *   (invité = SaveStore local d'avant ; compte = SyncedSlotProvider de src/save/sync.ts : écriture
 *   locale immédiate, envoi en arrière-plan, la plus récente gagne, autosauvegardes ≤ 1 / 2 min).
 * - `AccountManager` : session (reconnexion silencieuse, retour des liens e-mail), changement de
 *   compte, import des parties invité, resynchronisation au retour du réseau.
 * Configuration vide (src/save/account-config.ts) : `attachAccounts` rend null, aucune requête.
 * Mode d'emploi : docs/COMPTES.md.
 */
import type { SaveFile } from '../shared/contracts';
import type { SaveFileV2 } from '../sim/save-format';
import type { SaveBackend } from './backends';
import { base64ToBytes, bytesToBase64, isGzip, type Result } from './codec';
import { SaveStore, SLOT_RE, type SlotInfo } from './store';
import { ACCOUNT_SITE_URL, SUPABASE_ANON_KEY, SUPABASE_URL, accountsConfigured } from './account-config';
import { SupabaseAuth, authMessage, type AccountUser, type AuthResult, type AuthState, type FetchLike, type KeyValueStorage, type SupabaseAuthOptions } from './supabase-auth';
import {
  SyncedSlotProvider, publishCloudStatus,
  type CloudSaveStatus, type RemoteMeta, type RemoteSlots, type Timers,
} from './sync';

// ---------- Transport PostgREST ----------

export const SAVES_TABLE = 'saves';
const META_FORMAT = 1;

/** Contenu de la colonne `meta` (jsonb) : de quoi lister sans télécharger. */
export interface SaveRowMeta {
  format: number;
  name: string;
  population: number;
  gameMinutes: number;
  money: number;
  buildings: number;
  version: number;
  savedAt: string;
  bytes: number;
  compressed: boolean;
  info: SlotInfo;
}

export interface AccountMeta extends RemoteMeta { bytes: number; compressed: boolean }

function parseRow(row: unknown): AccountMeta | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as { slot?: unknown; sha256?: unknown; saved_at?: unknown; meta?: unknown };
  if (typeof r.slot !== 'string' || !SLOT_RE.test(r.slot)) return null;
  if (typeof r.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(r.sha256)) return null;
  const m = (r.meta && typeof r.meta === 'object' ? r.meta : {}) as Partial<SaveRowMeta>;
  const info = m.info && typeof m.info === 'object' ? m.info : null;
  const savedAt = typeof m.savedAt === 'string' ? m.savedAt : typeof info?.savedAt === 'string' ? info.savedAt : typeof r.saved_at === 'string' ? r.saved_at : null;
  if (!savedAt) return null;
  const bytes = Number.isInteger(m.bytes) && (m.bytes as number) > 0 ? (m.bytes as number) : 0;
  const fullInfo: SlotInfo = {
    cityName: typeof info?.cityName === 'string' ? info.cityName : typeof m.name === 'string' ? m.name : r.slot,
    savedAt,
    totalMinutes: Number(info?.totalMinutes ?? m.gameMinutes ?? 0) || 0,
    money: Number(info?.money ?? m.money ?? 0) || 0,
    population: Number(info?.population ?? m.population ?? 0) || 0,
    buildings: Number(info?.buildings ?? m.buildings ?? 0) || 0,
    version: Number(info?.version ?? m.version ?? 0) || 0,
    slot: r.slot, bytes, compressed: m.compressed !== false,
  };
  return { slot: r.slot, savedAt, sha256: r.sha256, info: fullInfo, bytes, compressed: fullInfo.compressed };
}

export class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export interface RemoteOptions { fetch?: FetchLike; timeoutMs?: number; now?: () => number }

/** Table `public.saves` d'un joueur (RLS : chaque joueur ne voit que ses lignes). */
export class SupabaseSavesRemote implements RemoteSlots<AccountMeta> {
  private readonly fetchFn: FetchLike;
  private readonly timeoutMs: number;
  private readonly now: () => number;

  constructor(private readonly auth: SupabaseAuth, private readonly userId: string, o: RemoteOptions = {}) {
    this.fetchFn = o.fetch ?? ((i, init) => globalThis.fetch(i, init));
    this.timeoutMs = o.timeoutMs ?? 30_000;
    this.now = o.now ?? Date.now;
  }

  private async send(method: string, query: string, body?: unknown, prefer?: string): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      const token = await this.auth.accessToken();
      if (!token) throw new Error(this.auth.state === 'signed-out' ? authMessage('session_expired') : 'hors ligne');
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const h = setTimeout(() => ctrl?.abort(), this.timeoutMs);
      let res: Response;
      try {
        res = await this.fetchFn(`${this.auth.url}/rest/v1/${SAVES_TABLE}${query}`, {
          method,
          headers: {
            apikey: this.auth.anonKey, Authorization: `Bearer ${token}`, Accept: 'application/json',
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
            ...(prefer ? { Prefer: prefer } : {}),
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
          ...(ctrl ? { signal: ctrl.signal } : {}),
        });
      } catch {
        throw new Error('réseau indisponible');
      } finally { clearTimeout(h); }
      if (res.status === 401 && attempt === 0) { await this.auth.refresh(); continue; } // jeton expiré : renouvelé, rejoué une fois
      const text = await res.text().catch(() => '');
      if (!res.ok) {
        let detail = '';
        try { const j = JSON.parse(text) as { message?: unknown; code?: unknown }; detail = typeof j.message === 'string' ? ` (${j.message.slice(0, 120)})` : ''; } catch { /* corps illisible */ }
        throw new HttpError(res.status, `erreur du serveur ${res.status}${detail}`);
      }
      if (!text) return null;
      try { return JSON.parse(text) as unknown; } catch { return null; }
    }
  }

  private static slotFilter(slot: string): string { return `slot=eq.${encodeURIComponent(slot)}`; }

  async list(): Promise<AccountMeta[]> {
    const rows = await this.send('GET', '?select=slot,sha256,saved_at,meta');
    return Array.isArray(rows) ? rows.map(parseRow).filter((m): m is AccountMeta => m !== null) : [];
  }

  async get(slot: string): Promise<AccountMeta | null> {
    const rows = await this.send('GET', `?select=slot,sha256,saved_at,meta&${SupabaseSavesRemote.slotFilter(slot)}`);
    const m = Array.isArray(rows) && rows.length ? parseRow(rows[0]) : null;
    return m && m.slot === slot ? m : null;
  }

  async download(meta: AccountMeta): Promise<Uint8Array | null> {
    const rows = await this.send('GET', `?select=data,sha256&${SupabaseSavesRemote.slotFilter(meta.slot)}`);
    const r = Array.isArray(rows) && rows.length ? (rows[0] as { data?: unknown; sha256?: unknown }) : null;
    if (!r || typeof r.data !== 'string' || r.sha256 !== meta.sha256) return null; // modifiée entre-temps
    let bytes: Uint8Array;
    try { bytes = base64ToBytes(r.data); } catch { return null; }
    return meta.bytes && bytes.length !== meta.bytes ? null : bytes;
  }

  async upload(slot: string, bytes: Uint8Array, info: SlotInfo, sha256: string): Promise<AccountMeta> {
    const compressed = isGzip(bytes);
    const full: SlotInfo = { ...info, slot, bytes: bytes.length, compressed };
    const meta: SaveRowMeta = {
      format: META_FORMAT, name: info.cityName, population: info.population, gameMinutes: info.totalMinutes,
      money: info.money, buildings: info.buildings, version: info.version, savedAt: info.savedAt,
      bytes: bytes.length, compressed, info: full,
    };
    const savedAt = Number.isFinite(Date.parse(info.savedAt)) ? info.savedAt : new Date(this.now()).toISOString();
    await this.send('POST', '?on_conflict=user_id,slot', {
      user_id: this.userId, slot, data: bytesToBase64(bytes), sha256, saved_at: savedAt, meta,
    }, 'resolution=merge-duplicates,return=minimal');
    return { slot, savedAt: info.savedAt, sha256, info: full, bytes: bytes.length, compressed };
  }

  async remove(slot: string): Promise<void> {
    await this.send('DELETE', `?${SupabaseSavesRemote.slotFilter(slot)}`, undefined, 'return=minimal');
  }
}

// ---------- Espace local par compte ----------

/** Préfixe des clés locales d'un compte (le mode invité garde les clés historiques sans préfixe). */
export const accountPrefix = (userId: string): string => `compte:${userId}:`;

export class ScopedBackend implements SaveBackend {
  constructor(private readonly base: SaveBackend, readonly prefix: string) {}
  get kind(): SaveBackend['kind'] { return this.base.kind; }
  get(key: string): Promise<Uint8Array | null> { return this.base.get(this.prefix + key); }
  put(key: string, bytes: Uint8Array): Promise<void> { return this.base.put(this.prefix + key, bytes); }
  delete(key: string): Promise<void> { return this.base.delete(this.prefix + key); }
  async keys(): Promise<string[]> {
    return (await this.base.keys()).filter((k) => k.startsWith(this.prefix)).map((k) => k.slice(this.prefix.length));
  }
}

// ---------- SaveStore délégué (joueur courant) ----------

export class AccountStore extends SaveStore {
  private inner: SaveStore;
  constructor(readonly guest: SaveStore) {
    super(guest.backend, guest.compress);
    this.inner = guest;
  }
  get current(): SaveStore { return this.inner; }
  /** Stockage synchronisé du compte, ou null en mode invité. */
  get synced(): SyncedSlotProvider<AccountMeta> | null { return this.inner instanceof SyncedSlotProvider ? this.inner : null; }
  use(store: SaveStore): void { this.inner = store; }

  override save(slot: string, data: SaveFile): Promise<Result<SlotInfo>> { return this.inner.save(slot, data); }
  override load(slot: string): Promise<Result<SaveFileV2>> { return this.inner.load(slot); }
  override getRaw(slot: string): Promise<{ bytes: Uint8Array; info: SlotInfo } | null> { return this.inner.getRaw(slot); }
  override putRaw(slot: string, bytes: Uint8Array, info: SlotInfo): Promise<Result<SlotInfo>> { return this.inner.putRaw(slot, bytes, info); }
  override has(slot: string): Promise<boolean> { return this.inner.has(slot); }
  override list(): Promise<SlotInfo[]> { return this.inner.list(); }
  override remove(slot: string): Promise<void> { return this.inner.remove(slot); }
  /** Envoie tout ce qui attend (sortie de page). */
  flush(): Promise<void> { return this.synced?.flush() ?? Promise.resolve(); }
  /** Sauvegardes en ligne actives (connecté et synchronisé). */
  get cloudActive(): boolean { const s = this.synced?.status.state; return s === 'online' || s === 'syncing'; }
}

// ---------- Gestionnaire de comptes ----------

export const ACCOUNT_EVENT = 'meknes:account';
export const IMPORT_KEY = (userId: string): string => `meknes:compte:import:${userId}`;

export interface AccountSnapshot {
  /** 'signed-in' | 'offline' (identité connue, réseau absent) | 'signed-out' (invité). */
  state: AuthState;
  user: AccountUser | null;
  sync: CloudSaveStatus;
  /** Retour d'un lien e-mail à traiter par l'interface (ex. 'recovery' : choisir un nouveau mot de passe). */
  redirect?: { type: string; error?: string };
  /** Message à afficher (session expirée…). */
  notice?: string;
}

export interface AccountManagerOptions {
  url?: string;
  anonKey?: string;
  fetch?: FetchLike;
  storage?: KeyValueStorage | null;
  now?: () => number;
  timers?: Timers;
  authTimers?: SupabaseAuthOptions['timers'];
  autoMinIntervalMs?: number;
  /** Adresse de retour des e-mails (défaut : page courante, sinon ACCOUNT_SITE_URL). */
  redirectTo?: string;
  onStatus?: (s: CloudSaveStatus) => void;
  /** Ne pas brancher les évènements de page (online, visibilitychange, pagehide). */
  noListeners?: boolean;
}

const DISABLED: CloudSaveStatus = { state: 'disabled', label: '', lastSyncAt: null, pending: 0 };

export class AccountManager {
  readonly auth: SupabaseAuth;
  readonly store: AccountStore;
  private readonly opts: AccountManagerOptions;
  private readonly storage: KeyValueStorage | null;
  private readonly onStatus: (s: CloudSaveStatus) => void;
  private readonly listeners = new Set<(s: AccountSnapshot) => void>();
  private scopedFor: string | null = null;
  private sync: CloudSaveStatus = { ...DISABLED };
  private pendingRedirect: AccountSnapshot['redirect'];
  private notice: string | undefined;
  private lastState: AuthState;

  constructor(local: SaveStore, o: AccountManagerOptions = {}) {
    this.opts = o;
    this.storage = o.storage === undefined ? safeLocalStorage() : o.storage;
    this.onStatus = o.onStatus ?? publishCloudStatus;
    this.auth = new SupabaseAuth({
      url: o.url ?? SUPABASE_URL, anonKey: o.anonKey ?? SUPABASE_ANON_KEY,
      ...(o.fetch ? { fetch: o.fetch } : {}), storage: this.storage, ...(o.now ? { now: o.now } : {}), ...(o.authTimers ? { timers: o.authTimers } : {}),
    });
    this.store = new AccountStore(local);
    this.lastState = this.auth.state;
    this.auth.onChange((s) => this.onAuth(s));
    this.applyUser(); // identité mémorisée : parties locales du compte visibles tout de suite, même hors ligne
  }

  get snapshot(): AccountSnapshot {
    return { state: this.auth.state, user: this.auth.user, sync: { ...this.sync }, ...(this.pendingRedirect ? { redirect: this.pendingRedirect } : {}), ...(this.notice ? { notice: this.notice } : {}) };
  }

  onChange(fn: (s: AccountSnapshot) => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  private emit(): void {
    const snap = this.snapshot;
    for (const f of [...this.listeners]) { try { f(snap); } catch { /* écouteur fautif ignoré */ } }
    const g = globalThis as { dispatchEvent?: (e: Event) => boolean };
    if (typeof g.dispatchEvent === 'function' && typeof CustomEvent !== 'undefined') {
      try { g.dispatchEvent(new CustomEvent(ACCOUNT_EVENT, { detail: snap })); } catch { /* sans importance */ }
    }
  }

  private setSync(s: CloudSaveStatus): void {
    this.sync = s;
    this.onStatus(s);
    this.emit();
  }

  private onAuth(s: AuthState): void {
    const was = this.lastState;
    this.lastState = s;
    if (s === 'signed-out' && was !== 'signed-out' && !this.signingOut) this.notice = authMessage('session_expired');
    this.applyUser();
    // Réseau revenu (ou jeton renouvelé) : liste + envoi de ce qui attend.
    if (s === 'signed-in' && was === 'offline') void this.resync();
    this.emit();
  }

  private signingOut = false;

  /** Branche le stockage du joueur courant (invité ou compte) si l'identité a changé. */
  private applyUser(): void {
    const user = this.auth.user;
    const id = user?.id ?? null;
    if (id === this.scopedFor) return;
    this.store.synced?.stop();
    this.scopedFor = id;
    if (!user) {
      this.store.use(this.store.guest);
      this.setSync({ ...DISABLED });
      return;
    }
    const local = new SaveStore(new ScopedBackend(this.store.guest.backend, accountPrefix(user.id)), this.store.guest.compress);
    const remote = new SupabaseSavesRemote(this.auth, user.id, { ...(this.opts.fetch ? { fetch: this.opts.fetch } : {}), ...(this.opts.now ? { now: this.opts.now } : {}) });
    let mine: SyncedSlotProvider<AccountMeta> | null = null;
    const p = new SyncedSlotProvider<AccountMeta>(local, {
      remote, slotOk: (s) => SLOT_RE.test(s),
      ...(this.opts.autoMinIntervalMs !== undefined ? { autoMinIntervalMs: this.opts.autoMinIntervalMs } : {}),
      ...(this.opts.now ? { now: this.opts.now } : {}), ...(this.opts.timers ? { timers: this.opts.timers } : {}),
      onStatus: (st) => { if (mine && this.store.synced === mine) this.setSync(st); },
    });
    mine = p;
    this.store.use(p);
    this.setSync(p.status);
    void p.start();
  }

  /** Liste en ligne + envoi des parties locales en attente (retour du réseau). */
  async resync(): Promise<void> {
    const p = this.store.synced;
    if (!p) return;
    await p.start();
    await p.flush();
  }

  private redirectUrl(): string {
    if (this.opts.redirectTo) return this.opts.redirectTo;
    const loc = (globalThis as { location?: Location }).location;
    if (loc && /^https?:$/.test(loc.protocol) && !/^(localhost|127\.)/.test(loc.hostname)) return `${loc.origin}${loc.pathname}`;
    return ACCOUNT_SITE_URL;
  }

  /**
   * Lancement : retour d'un lien e-mail (fragment d'URL) puis reconnexion silencieuse.
   * Ne bloque pas sur le réseau au-delà du délai d'une requête.
   */
  async init(hash?: string): Promise<AccountSnapshot> {
    const h = hash ?? (globalThis as { location?: Location }).location?.hash ?? '';
    const r = h ? this.auth.consumeRedirect(h) : null;
    if (r) {
      this.pendingRedirect = r;
      try {
        const g = globalThis as { history?: History; location?: Location };
        g.history?.replaceState?.(null, '', `${g.location?.pathname ?? ''}${g.location?.search ?? ''}`); // jetons retirés de l'adresse
      } catch { /* sans importance */ }
    }
    if (!r || r.error) await this.auth.restore();
    if (!this.opts.noListeners) this.installListeners();
    this.emit();
    return this.snapshot;
  }

  private listenersInstalled = false;
  private installListeners(): void {
    if (this.listenersInstalled) return;
    this.listenersInstalled = true;
    const g = globalThis as { document?: Document; addEventListener?: (t: string, f: () => void) => void };
    g.addEventListener?.('online', () => {
      if (!this.auth.user) return;
      void this.auth.refresh().then(() => this.resync());
    });
    g.document?.addEventListener('visibilitychange', () => { if (g.document?.visibilityState === 'hidden') void this.store.flush(); });
    g.addEventListener?.('pagehide', () => { void this.store.flush(); });
  }

  clearRedirect(): void { this.pendingRedirect = undefined; this.emit(); }
  clearNotice(): void { this.notice = undefined; this.emit(); }

  // ----- actions -----

  signUp(email: string, password: string): Promise<AuthResult<{ needsConfirmation: boolean }>> {
    this.notice = undefined;
    return this.auth.signUp(email, password, this.redirectUrl());
  }

  async signIn(email: string, password: string): Promise<AuthResult<AccountUser>> {
    this.notice = undefined;
    const r = await this.auth.signIn(email, password);
    return r.ok ? { ok: true, value: r.value.user } : r;
  }

  /** Déconnexion : envoie d'abord ce qui attend (au mieux), puis revient au mode invité. */
  async signOut(): Promise<void> {
    try { await withTimeout(this.store.flush(), 8000); } catch { /* hors ligne : reste en local dans l'espace du compte */ }
    this.signingOut = true;
    try { await this.auth.signOut(); } finally { this.signingOut = false; }
    this.notice = undefined;
    this.emit();
  }

  recover(email: string): Promise<AuthResult<true>> { return this.auth.recover(email, this.redirectUrl()); }
  updatePassword(password: string): Promise<AuthResult<true>> { return this.auth.updatePassword(password); }

  // ----- import des parties invité -----

  /** Parties invité proposées à l'import (première connexion de ce compte sur cet appareil). */
  async importCandidates(): Promise<SlotInfo[]> {
    const user = this.auth.user;
    if (!user || this.store.current === this.store.guest) return [];
    try { if (this.storage?.getItem(IMPORT_KEY(user.id))) return []; } catch { /* stockage indisponible */ }
    return this.store.guest.list();
  }

  /** Mémorise la réponse (« fait » ou « refusé ») : la question n'est plus posée pour ce compte. */
  private markImport(v: 'fait' | 'refuse'): void {
    const user = this.auth.user;
    if (!user) return;
    try { this.storage?.setItem(IMPORT_KEY(user.id), v); } catch { /* stockage indisponible */ }
  }

  declineImport(): void { this.markImport('refuse'); }

  /**
   * Copie les parties invité dans le compte (les copies invité restent sur l'appareil), puis les envoie.
   * Un emplacement déjà présent dans le compte n'est remplacé que par une version plus récente.
   */
  async importGuest(slots?: string[]): Promise<string[]> {
    const p = this.store.synced;
    if (!p) return [];
    const wanted = slots ?? (await this.store.guest.list()).map((s) => s.slot);
    const done: string[] = [];
    for (const slot of wanted) {
      const raw = await this.store.guest.getRaw(slot);
      if (!raw) continue;
      const mine = await p.getRaw(slot);
      if (mine && mine.info.savedAt >= raw.info.savedAt) continue;
      const w = await p.putRaw(slot, raw.bytes, raw.info);
      if (w.ok) done.push(slot);
    }
    this.markImport('fait');
    await p.start(); // envoie les parties absentes ou plus récentes en ligne
    return done;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let h: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<T>((_, rej) => { h = setTimeout(() => rej(new Error('délai dépassé')), ms); })]).finally(() => clearTimeout(h));
}

function safeLocalStorage(): KeyValueStorage | null {
  try { return (globalThis as { localStorage?: KeyValueStorage }).localStorage ?? null; } catch { return null; }
}

/**
 * Branchement : null si la configuration est vide (aucune requête, jeu inchangé) ; sinon le gestionnaire,
 * dont `store` remplace le SaveStore local. La reconnexion silencieuse part en arrière-plan.
 */
export function attachAccounts(local: SaveStore, o: AccountManagerOptions & { hash?: string } = {}): AccountManager | null {
  if (!accountsConfigured(o.url ?? SUPABASE_URL, o.anonKey ?? SUPABASE_ANON_KEY)) return null;
  const m = new AccountManager(local, o);
  void m.init(o.hash).catch(() => undefined); // échec réseau : reste en local, nouvel essai au retour du réseau
  return m;
}

export { authMessage };
