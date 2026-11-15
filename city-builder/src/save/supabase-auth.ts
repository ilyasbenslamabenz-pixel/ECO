/**
 * Client d'authentification Supabase minimal (GoTrue, `fetch` direct, sans SDK) :
 * inscription, connexion e-mail + mot de passe, rafraîchissement du jeton, déconnexion,
 * mot de passe oublié, changement de mot de passe, retour des liens envoyés par e-mail.
 *
 * Session : seul le jeton de rafraîchissement et l'identité (id, e-mail) sont conservés
 * (localStorage, try/catch) ; le jeton d'accès reste en mémoire et est renouvelé ~1 min avant
 * expiration. Hors ligne au lancement : l'identité connue est gardée (sauvegardes locales du
 * compte), le rafraîchissement est retenté au retour du réseau.
 * Sécurité : aucun jeton ni mot de passe n'est journalisé ni inclus dans les messages d'erreur.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface KeyValueStorage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export interface AccountUser { id: string; email: string }

export interface Session {
  accessToken: string;
  refreshToken: string;
  /** Expiration du jeton d'accès (ms depuis l'époque). */
  expiresAt: number;
  user: AccountUser;
}

export type AuthErrorCode =
  | 'network' | 'invalid_credentials' | 'email_not_confirmed' | 'user_exists' | 'weak_password'
  | 'invalid_email' | 'rate_limited' | 'signup_disabled' | 'session_expired' | 'not_signed_in' | 'server';

export type AuthResult<T> = { ok: true; value: T } | { ok: false; code: AuthErrorCode; message: string };

/** 'signed-in' : jeton valide ; 'offline' : identité connue mais réseau indisponible ; 'signed-out'. */
export type AuthState = 'signed-in' | 'offline' | 'signed-out';

export interface AuthTimers { set(fn: () => void, ms: number): unknown; clear(h: unknown): void }

export interface SupabaseAuthOptions {
  url: string;
  anonKey: string;
  fetch?: FetchLike;
  storage?: KeyValueStorage | null;
  now?: () => number;
  timers?: AuthTimers;
  timeoutMs?: number;
  storageKey?: string;
}

export const SESSION_KEY = 'meknes:compte:session';
/** Marge avant expiration à laquelle le jeton est renouvelé (ms). */
export const REFRESH_MARGIN_MS = 60_000;

interface StoredSession { v: 1; refresh_token: string; user: AccountUser }

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  expires_at?: number;
  user?: { id?: string; email?: string } | null;
  id?: string;
  email?: string;
}

class NetworkError extends Error {}

const MESSAGES: Record<AuthErrorCode, string> = {
  network: 'Connexion impossible : vérifiez votre accès à Internet.',
  invalid_credentials: 'E-mail ou mot de passe incorrect.',
  email_not_confirmed: 'Adresse e-mail pas encore confirmée : ouvrez le lien reçu par e-mail, puis connectez-vous.',
  user_exists: 'Un compte existe déjà avec cette adresse : connectez-vous (ou « Mot de passe oublié »).',
  weak_password: 'Mot de passe trop faible : au moins 6 caractères (mélangez lettres et chiffres).',
  invalid_email: 'Adresse e-mail invalide.',
  rate_limited: 'Trop de tentatives : réessayez dans quelques minutes.',
  signup_disabled: 'La création de comptes est désactivée pour le moment.',
  session_expired: 'Session expirée : reconnectez-vous.',
  not_signed_in: 'Vous n\'êtes pas connecté.',
  server: 'Le service de comptes a rencontré une erreur. Réessayez plus tard.',
};

export function authMessage(code: AuthErrorCode): string { return MESSAGES[code]; }

/** Décode la charge utile d'un JWT (sans vérification : seul le serveur fait foi). */
function jwtPayload(token: string): Record<string, unknown> | null {
  const p = token.split('.')[1];
  if (!p) return null;
  try {
    const b64 = p.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(p.length / 4) * 4, '=');
    const json = new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
    const o = JSON.parse(json) as unknown;
    return o && typeof o === 'object' ? (o as Record<string, unknown>) : null;
  } catch { return null; }
}

/** Code d'erreur à partir de la réponse GoTrue (formats ancien et récent). */
function classify(status: number, body: Record<string, unknown> | null): AuthErrorCode {
  const code = String(body?.['error_code'] ?? body?.['error'] ?? '').toLowerCase();
  const text = String(body?.['msg'] ?? body?.['error_description'] ?? body?.['message'] ?? '').toLowerCase();
  if (code === 'email_not_confirmed' || text.includes('email not confirmed')) return 'email_not_confirmed';
  if (code === 'invalid_credentials' || text.includes('invalid login credentials')) return 'invalid_credentials';
  if (code === 'user_already_exists' || code === 'email_exists' || text.includes('already registered')) return 'user_exists';
  if (code === 'weak_password' || text.includes('password should')) return 'weak_password';
  if (code === 'email_address_invalid' || code === 'validation_failed' || text.includes('invalid format') || text.includes('unable to validate email')) return 'invalid_email';
  if (status === 429 || code.startsWith('over_') || text.includes('rate limit')) return 'rate_limited';
  if (code === 'signup_disabled' || text.includes('signups not allowed')) return 'signup_disabled';
  if (code.startsWith('refresh_token') || code === 'session_not_found' || code === 'session_expired' || code === 'invalid_grant' || code === 'bad_jwt' || status === 401 || status === 403) return 'session_expired';
  return 'server';
}

const fail = <T>(code: AuthErrorCode): AuthResult<T> => ({ ok: false, code, message: MESSAGES[code] });

export class SupabaseAuth {
  readonly url: string;
  readonly anonKey: string;
  private readonly fetchFn: FetchLike;
  private readonly storage: KeyValueStorage | null;
  private readonly now: () => number;
  private readonly timers: AuthTimers;
  private readonly timeoutMs: number;
  private readonly storageKey: string;
  private current: Session | null = null;
  /** Identité connue sans jeton valide (hors ligne). */
  private knownUser: AccountUser | null = null;
  /** Dernier échange avec le serveur impossible (réseau). */
  private networkDown = false;
  private refreshing: Promise<AuthResult<Session>> | null = null;
  private timer: unknown = null;
  private readonly listeners = new Set<(s: AuthState) => void>();

  constructor(o: SupabaseAuthOptions) {
    this.url = o.url.trim().replace(/\/+$/, '');
    this.anonKey = o.anonKey.trim();
    this.fetchFn = o.fetch ?? ((i, init) => globalThis.fetch(i, init));
    this.storage = o.storage === undefined ? defaultStorage() : o.storage;
    this.now = o.now ?? Date.now;
    this.timers = o.timers ?? { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };
    this.timeoutMs = o.timeoutMs ?? 20_000;
    this.storageKey = o.storageKey ?? SESSION_KEY;
    this.knownUser = this.readStored()?.user ?? null;
  }

  // ----- état -----

  get session(): Session | null { return this.current; }
  /** Joueur connecté (jeton valide) ou connu (hors ligne). */
  get user(): AccountUser | null { return this.current?.user ?? this.knownUser; }
  get state(): AuthState { return this.current && !this.networkDown ? 'signed-in' : this.user ? 'offline' : 'signed-out'; }

  onChange(fn: (s: AuthState) => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private notify(): void { const s = this.state; for (const f of [...this.listeners]) { try { f(s); } catch { /* écouteur fautif ignoré */ } } }

  // ----- stockage -----

  private readStored(): StoredSession | null {
    try {
      const raw = this.storage?.getItem(this.storageKey);
      if (!raw) return null;
      const o = JSON.parse(raw) as Partial<StoredSession>;
      if (o.v !== 1 || typeof o.refresh_token !== 'string' || !o.user || typeof o.user.id !== 'string' || !o.user.id) return null;
      return { v: 1, refresh_token: o.refresh_token, user: { id: o.user.id, email: String(o.user.email ?? '') } };
    } catch { return null; }
  }
  private writeStored(s: Session | null): void {
    try {
      if (!s) this.storage?.removeItem(this.storageKey);
      else this.storage?.setItem(this.storageKey, JSON.stringify({ v: 1, refresh_token: s.refreshToken, user: s.user } satisfies StoredSession));
    } catch { /* stockage indisponible (navigation privée) : session limitée à l'onglet */ }
  }

  private setSession(s: Session | null): void {
    this.current = s;
    this.knownUser = s ? s.user : null;
    this.networkDown = false;
    this.writeStored(s);
    this.schedule();
    this.notify();
  }

  private setNetworkDown(down: boolean): void {
    if (this.networkDown === down) return;
    this.networkDown = down;
    this.notify();
  }

  private schedule(): void {
    if (this.timer !== null) { this.timers.clear(this.timer); this.timer = null; }
    if (!this.current) return;
    const wait = Math.max(5_000, this.current.expiresAt - REFRESH_MARGIN_MS - this.now());
    this.timer = this.timers.set(() => { this.timer = null; void this.refresh(); }, wait);
  }

  // ----- HTTP -----

  private async call(method: string, path: string, body?: unknown, bearer?: string): Promise<{ status: number; json: Record<string, unknown> | null }> {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const h = setTimeout(() => ctrl?.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchFn(`${this.url}/auth/v1/${path}`, {
        method,
        headers: { apikey: this.anonKey, Authorization: `Bearer ${bearer ?? this.anonKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        ...(ctrl ? { signal: ctrl.signal } : {}),
      });
    } catch {
      throw new NetworkError('réseau indisponible');
    } finally { clearTimeout(h); }
    let json: Record<string, unknown> | null = null;
    try { const t = await res.text(); json = t ? (JSON.parse(t) as Record<string, unknown>) : null; } catch { json = null; }
    return { status: res.status, json };
  }

  private toSession(t: TokenResponse): Session | null {
    if (typeof t.access_token !== 'string' || typeof t.refresh_token !== 'string' || !t.access_token || !t.refresh_token) return null;
    const p = jwtPayload(t.access_token);
    const id = String(t.user?.id ?? p?.['sub'] ?? '');
    if (!id) return null;
    const email = String(t.user?.email ?? p?.['email'] ?? '');
    const expiresAt = typeof t.expires_at === 'number' ? t.expires_at * 1000
      : typeof t.expires_in === 'number' ? this.now() + t.expires_in * 1000
        : typeof p?.['exp'] === 'number' ? (p['exp'] as number) * 1000 : this.now() + 3_600_000;
    return { accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt, user: { id, email } };
  }

  private async guarded<T>(fn: () => Promise<AuthResult<T>>): Promise<AuthResult<T>> {
    try { return await fn(); } catch (e) { return fail(e instanceof NetworkError ? 'network' : 'server'); }
  }

  // ----- actions -----

  /**
   * Inscription. `needsConfirmation` : Supabase exige la confirmation de l'adresse (« Confirm email »)
   * — aucun jeton n'est rendu, le joueur doit ouvrir le lien reçu puis se connecter.
   */
  signUp(email: string, password: string, redirectTo?: string): Promise<AuthResult<{ needsConfirmation: boolean }>> {
    return this.guarded(async () => {
      const q = redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : '';
      const r = await this.call('POST', `signup${q}`, { email: email.trim(), password });
      if (r.status < 200 || r.status >= 300) return fail(classify(r.status, r.json));
      const s = r.json ? this.toSession(r.json as TokenResponse) : null;
      if (s) { this.setSession(s); return { ok: true, value: { needsConfirmation: false } }; }
      // Adresse déjà inscrite (Supabase rend alors un utilisateur sans identité, sans erreur) : même message neutre.
      return { ok: true, value: { needsConfirmation: true } };
    });
  }

  signIn(email: string, password: string): Promise<AuthResult<Session>> {
    return this.guarded(async () => {
      const r = await this.call('POST', 'token?grant_type=password', { email: email.trim(), password });
      if (r.status < 200 || r.status >= 300) return fail(classify(r.status, r.json));
      const s = r.json ? this.toSession(r.json as TokenResponse) : null;
      if (!s) return fail('server');
      this.setSession(s);
      return { ok: true, value: s };
    });
  }

  /** Renouvelle le jeton d'accès (une seule requête à la fois). */
  refresh(): Promise<AuthResult<Session>> {
    if (!this.refreshing) {
      this.refreshing = this.doRefresh().finally(() => { this.refreshing = null; });
    }
    return this.refreshing;
  }

  private async doRefresh(): Promise<AuthResult<Session>> {
    let token = this.current?.refreshToken ?? this.readStored()?.refresh_token;
    if (!token) return fail('not_signed_in');
    for (let attempt = 0; attempt < 2; attempt++) {
      let r: { status: number; json: Record<string, unknown> | null };
      try { r = await this.call('POST', 'token?grant_type=refresh_token', { refresh_token: token }); } catch (e) {
        if (e instanceof NetworkError) {
          // Hors ligne : identité et jeton de rafraîchissement gardés, nouvel essai au retour du réseau.
          this.setNetworkDown(true);
          return fail('network');
        }
        return fail('server');
      }
      if (r.status >= 200 && r.status < 300) {
        const s = r.json ? this.toSession(r.json as TokenResponse) : null;
        if (!s) return fail('server');
        this.setSession(s);
        return { ok: true, value: s };
      }
      const code = classify(r.status, r.json);
      if (code !== 'session_expired') return fail(code === 'rate_limited' ? code : 'server');
      // Jeton déjà utilisé : un autre onglet l'a peut-être renouvelé entre-temps (stockage partagé).
      const stored = this.readStored()?.refresh_token;
      if (stored && stored !== token) { token = stored; continue; }
      break;
    }
    this.setSession(null);
    return fail('session_expired');
  }

  /** Jeton d'accès valide (renouvelé si nécessaire) ; null si hors ligne ou déconnecté. */
  async accessToken(): Promise<string | null> {
    if (this.current && this.current.expiresAt - REFRESH_MARGIN_MS > this.now()) return this.current.accessToken;
    if (!this.user) return null;
    const r = await this.refresh();
    return r.ok ? r.value.accessToken : null;
  }

  /** Reconnexion silencieuse au lancement (jeton de rafraîchissement mémorisé). */
  async restore(): Promise<AuthState> {
    if (!this.readStored()) return this.state;
    await this.refresh();
    return this.state;
  }

  /** Déconnexion : session oubliée localement même si le serveur est injoignable. */
  async signOut(): Promise<void> {
    const token = this.current?.accessToken;
    this.setSession(null);
    if (token) { try { await this.call('POST', 'logout', {}, token); } catch { /* hors ligne : jeton expirera seul */ } }
  }

  /** Envoie l'e-mail « mot de passe oublié » (lien de retour vers `redirectTo`). */
  recover(email: string, redirectTo?: string): Promise<AuthResult<true>> {
    return this.guarded(async () => {
      const q = redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : '';
      const r = await this.call('POST', `recover${q}`, { email: email.trim() });
      if (r.status < 200 || r.status >= 300) return fail(classify(r.status, r.json));
      return { ok: true, value: true };
    });
  }

  /** Nouveau mot de passe (session ouverte, ex. après le lien « mot de passe oublié »). */
  updatePassword(password: string): Promise<AuthResult<true>> {
    return this.guarded(async () => {
      const token = await this.accessToken();
      if (!token) return fail('not_signed_in');
      const r = await this.call('PUT', 'user', { password }, token);
      if (r.status < 200 || r.status >= 300) {
        const c = classify(r.status, r.json);
        return fail(c === 'invalid_credentials' ? 'weak_password' : c);
      }
      return { ok: true, value: true };
    });
  }

  /**
   * Retour d'un lien envoyé par e-mail (`#access_token=…&type=signup|recovery`, ou `#error=…`) :
   * ouvre la session. Rend null si le fragment ne concerne pas l'authentification.
   */
  consumeRedirect(hash: string): { type: string; error?: string } | null {
    const h = hash.replace(/^#/, '');
    if (!h) return null;
    const p = new URLSearchParams(h);
    if (p.has('error') || p.has('error_code') || p.has('error_description')) {
      const code = p.get('error_code') ?? '';
      const error = code === 'otp_expired' ? 'Ce lien a expiré ou a déjà servi : demandez-en un nouveau.' : 'Lien invalide : demandez-en un nouveau.';
      return { type: p.get('type') ?? 'error', error };
    }
    if (!p.has('access_token') || !p.has('refresh_token')) return null;
    const expiresIn = Number(p.get('expires_in'));
    const expiresAt = Number(p.get('expires_at'));
    const s = this.toSession({
      access_token: p.get('access_token') ?? '', refresh_token: p.get('refresh_token') ?? '',
      ...(Number.isFinite(expiresAt) && expiresAt > 0 ? { expires_at: expiresAt } : Number.isFinite(expiresIn) && expiresIn > 0 ? { expires_in: expiresIn } : {}),
    });
    if (!s) return { type: p.get('type') ?? 'error', error: 'Lien invalide : demandez-en un nouveau.' };
    this.setSession(s);
    return { type: p.get('type') ?? 'signup' };
  }
}

function defaultStorage(): KeyValueStorage | null {
  try { return (globalThis as { localStorage?: KeyValueStorage }).localStorage ?? null; } catch { return null; }
}
