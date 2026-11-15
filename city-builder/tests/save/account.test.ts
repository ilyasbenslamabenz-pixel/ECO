/**
 * Comptes joueurs (src/save/account.ts, src/save/supabase-auth.ts) contre un FAUX serveur Supabase
 * (fetch simulé : GoTrue + PostgREST avec RLS par jeton) : inscription, confirmation, connexion,
 * rafraîchissement, upsert, la plus récente gagne, conflit, hors ligne, séparation par compte,
 * import des parties invité, aucune requête si la configuration est vide.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryBackend } from '../../src/save/backends';
import { SaveStore } from '../../src/save/store';
import { AccountManager, attachAccounts, accountPrefix, IMPORT_KEY } from '../../src/save/account';
import { accountsConfigured } from '../../src/save/account-config';
import { SESSION_KEY, SupabaseAuth } from '../../src/save/supabase-auth';
import { sha256Hex, type CloudSaveStatus, type Timers } from '../../src/save/sync';
import { base64ToBytes } from '../../src/save/codec';
import type { SaveFile } from '../../src/shared/contracts';
import { buildTown, newTownSim, runDays } from '../sim/fixtures';

const URL_ = 'https://projet-test.supabase.co';
const KEY = 'anon-cle-publique-de-test-0123456789';

const b64url = (o: object): string => Buffer.from(JSON.stringify(o)).toString('base64url');

interface Row { user_id: string; slot: string; data: string; sha256: string; saved_at: string; meta: unknown }

/** Faux Supabase : utilisateurs, jetons (JWT factices), table saves protégée par jeton (RLS). */
class FakeSupabase {
  confirmEmail = true;
  down = false;
  now = 1_700_000_000_000;
  ttl = 3600;
  users = new Map<string, { id: string; email: string; password: string; confirmed: boolean }>();
  access = new Map<string, { uid: string; exp: number }>();
  refresh = new Map<string, string>(); // jeton de rafraîchissement -> uid (usage unique)
  rows: Row[] = [];
  log: Array<{ method: string; path: string; headers: Record<string, string>; body?: string }> = [];
  private seq = 0;

  private issue(uid: string): Record<string, unknown> {
    const u = [...this.users.values()].find((x) => x.id === uid)!;
    const exp = Math.floor(this.now / 1000) + this.ttl;
    const access = `h.${b64url({ sub: uid, email: u.email, exp, n: ++this.seq })}.s`;
    const refresh = `r-${uid}-${++this.seq}`;
    this.access.set(access, { uid, exp: exp * 1000 });
    this.refresh.set(refresh, uid);
    return { access_token: access, refresh_token: refresh, expires_in: this.ttl, token_type: 'bearer', user: { id: uid, email: u.email } };
  }

  confirm(email: string): void { const u = this.users.get(email); if (u) u.confirmed = true; }
  uidOf(email: string): string { return this.users.get(email)!.id; }

  readonly fetch = async (input: string, init: RequestInit = {}): Promise<Response> => {
    const method = init.method ?? 'GET';
    const headers = { ...(init.headers as Record<string, string>) };
    const body = typeof init.body === 'string' ? init.body : undefined;
    this.log.push({ method, path: input.slice(URL_.length), headers, ...(body !== undefined ? { body } : {}) });
    await new Promise((r) => setImmediate(r));
    if (this.down) throw new TypeError('Load failed');
    assert.equal(headers['apikey'], KEY, 'clé anon envoyée');
    const u = new URL(input);
    const json = (status: number, o: unknown): Response => new Response(o === undefined ? '' : JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
    const b = body ? (JSON.parse(body) as Record<string, string>) : {};
    const bearer = (headers['Authorization'] ?? '').replace(/^Bearer /, '');
    const authed = (): string | null => { const a = this.access.get(bearer); return a && a.exp > this.now ? a.uid : null; };

    if (u.pathname === '/auth/v1/signup') {
      if (this.users.has(b['email']!)) return json(200, { id: 'faux', email: b['email'], identities: [] });
      if ((b['password'] ?? '').length < 6) return json(422, { code: 422, error_code: 'weak_password', msg: 'Password should be at least 6 characters.' });
      const id = `00000000-0000-4000-8000-${String(this.users.size + 1).padStart(12, '0')}`;
      this.users.set(b['email']!, { id, email: b['email']!, password: b['password']!, confirmed: !this.confirmEmail });
      return json(200, this.confirmEmail ? { id, email: b['email'], confirmation_sent_at: 'x' } : this.issue(id));
    }
    if (u.pathname === '/auth/v1/token' && u.searchParams.get('grant_type') === 'password') {
      const usr = this.users.get(b['email']!);
      if (!usr || usr.password !== b['password']) return json(400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
      if (!usr.confirmed) return json(400, { code: 400, error_code: 'email_not_confirmed', msg: 'Email not confirmed' });
      return json(200, this.issue(usr.id));
    }
    if (u.pathname === '/auth/v1/token' && u.searchParams.get('grant_type') === 'refresh_token') {
      const uid = this.refresh.get(b['refresh_token']!);
      if (!uid) return json(400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
      this.refresh.delete(b['refresh_token']!); // rotation
      return json(200, this.issue(uid));
    }
    if (u.pathname === '/auth/v1/logout') { this.access.delete(bearer); return json(204, undefined); }
    if (u.pathname === '/auth/v1/recover') return json(200, {});
    if (u.pathname === '/auth/v1/user' && method === 'PUT') {
      const uid = authed();
      if (!uid) return json(401, { code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' });
      const usr = [...this.users.values()].find((x) => x.id === uid)!;
      usr.password = b['password']!;
      return json(200, { id: uid });
    }
    if (u.pathname === '/rest/v1/saves') {
      const uid = authed();
      if (!uid) return json(401, { code: 'PGRST301', message: 'JWT expired' });
      const slot = u.searchParams.get('slot')?.replace(/^eq\./, '');
      const mine = this.rows.filter((r) => r.user_id === uid && (slot === undefined || r.slot === slot));
      if (method === 'GET') {
        const cols = (u.searchParams.get('select') ?? '').split(',');
        return json(200, mine.map((r) => Object.fromEntries(cols.map((c) => [c, (r as unknown as Record<string, unknown>)[c]]))));
      }
      if (method === 'POST') {
        assert.equal(u.searchParams.get('on_conflict'), 'user_id,slot');
        assert.match(headers['Prefer'] ?? '', /resolution=merge-duplicates/);
        const row = JSON.parse(body!) as Row;
        if (row.user_id !== uid) return json(403, { code: '42501', message: 'new row violates row-level security policy' });
        const i = this.rows.findIndex((r) => r.user_id === uid && r.slot === row.slot);
        if (i >= 0) this.rows[i] = row; else this.rows.push(row);
        return json(201, undefined);
      }
      if (method === 'DELETE') { this.rows = this.rows.filter((r) => !mine.includes(r)); return json(204, undefined); }
    }
    return json(404, { message: 'inconnu' });
  };
}

class MemStorage { m = new Map<string, string>(); getItem(k: string) { return this.m.get(k) ?? null; } setItem(k: string, v: string) { this.m.set(k, v); } removeItem(k: string) { this.m.delete(k); } }

class ManualTimers implements Timers {
  pending: Array<{ fn: () => void; ms: number; id: number }> = [];
  private seq = 0;
  set(fn: () => void, ms: number): unknown { const id = ++this.seq; this.pending.push({ fn, ms, id }); return id; }
  clear(h: unknown): void { this.pending = this.pending.filter((p) => p.id !== h); }
  fire(): void { const p = this.pending.splice(0); for (const x of p) x.fn(); }
}

let town: ReturnType<typeof newTownSim> | null = null;
function saveAt(iso: string, name = 'Meknes City'): SaveFile {
  if (!town) { town = newTownSim(); buildTown(town); runDays(town, 1); }
  const s = town.toSave();
  return { ...s, savedAt: iso, params: { ...s.params, cityName: name } };
}

function device(srv: FakeSupabase, opts: { storage?: MemStorage; backend?: MemoryBackend } = {}) {
  const storage = opts.storage ?? new MemStorage();
  const backend = opts.backend ?? new MemoryBackend();
  const statuses: CloudSaveStatus[] = [];
  const timers = new ManualTimers();
  const m = new AccountManager(new SaveStore(backend), {
    url: URL_, anonKey: KEY, fetch: srv.fetch, storage, now: () => srv.now, timers, authTimers: new ManualTimers(),
    redirectTo: 'https://ilyasbenslamabenz-pixel.github.io/ECO/', onStatus: (s) => statuses.push(s), noListeners: true,
  });
  return { m, storage, backend, statuses, timers };
}

const settle = async (m: AccountManager): Promise<void> => { for (let i = 0; i < 3; i++) { await new Promise((r) => setImmediate(r)); await m.store.synced?.idle(); } };

test('configuration vide : aucun compte, aucune requête, SaveStore inchangé', async () => {
  assert.equal(accountsConfigured('', ''), false);
  assert.equal(accountsConfigured(URL_, KEY), true);
  let calls = 0;
  const fetch = async (): Promise<Response> => { calls++; return new Response('{}'); };
  const local = new SaveStore(new MemoryBackend());
  assert.equal(attachAccounts(local, { fetch }), null, 'config du dépôt vide -> null');
  assert.equal(attachAccounts(local, { url: '', anonKey: '', fetch }), null);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(calls, 0);
});

test('inscription avec e-mail de confirmation, connexion refusée avant confirmation, puis acceptée', async () => {
  const srv = new FakeSupabase();
  const { m, storage } = device(srv);
  const weak = await m.signUp('amina@example.com', '123');
  assert.ok(!weak.ok && weak.code === 'weak_password');
  const r = await m.signUp('amina@example.com', 'motdepasse-solide');
  assert.ok(r.ok && r.value.needsConfirmation, 'confirmation exigée');
  assert.match(srv.log.at(-1)!.path, /redirect_to=https%3A%2F%2Filyasbenslamabenz-pixel\.github\.io%2FECO%2F/);
  assert.equal(m.snapshot.state, 'signed-out');
  const early = await m.signIn('amina@example.com', 'motdepasse-solide');
  assert.ok(!early.ok && early.code === 'email_not_confirmed');
  assert.match(early.ok ? '' : early.message, /confirm/i);
  const bad = await m.signIn('amina@example.com', 'mauvais');
  assert.ok(!bad.ok && bad.code === 'invalid_credentials');
  srv.confirm('amina@example.com');
  const ok = await m.signIn('amina@example.com', 'motdepasse-solide');
  assert.ok(ok.ok);
  assert.equal(m.snapshot.state, 'signed-in');
  assert.equal(m.snapshot.user?.email, 'amina@example.com');
  // Stockage : jeton de rafraîchissement et identité seulement (ni mot de passe, ni jeton d'accès).
  const stored = storage.getItem(SESSION_KEY)!;
  assert.ok(stored.includes('refresh_token') && !stored.includes('motdepasse') && !stored.includes('access'));
  // Sans confirmation exigée : connecté dès l'inscription.
  srv.confirmEmail = false;
  const d2 = device(srv);
  const r2 = await d2.m.signUp('youssef@example.com', 'encore-un-secret');
  assert.ok(r2.ok && !r2.value.needsConfirmation);
  assert.equal(d2.m.snapshot.state, 'signed-in');
});

test('rafraîchissement : avant expiration, rotation mémorisée, reconnexion silencieuse, session expirée', async () => {
  const srv = new FakeSupabase();
  srv.confirmEmail = false;
  const { m, storage } = device(srv);
  await m.signUp('karim@example.com', 'secret-123');
  const t1 = await m.auth.accessToken();
  assert.ok(t1);
  srv.now += 3_000_000; // < 1 h, mais dans la marge d'1 min ? non : 50 min
  assert.equal(await m.auth.accessToken(), t1, 'jeton encore valide : pas de rafraîchissement');
  srv.now += 580_000; // à moins d'1 min de l'expiration
  const before = storage.getItem(SESSION_KEY);
  const t2 = await m.auth.accessToken();
  assert.ok(t2 && t2 !== t1, 'renouvelé avant expiration');
  assert.notEqual(storage.getItem(SESSION_KEY), before, 'nouveau jeton de rafraîchissement mémorisé');
  // Deux appels simultanés : une seule requête de rafraîchissement.
  srv.now += 3_590_000;
  const n = srv.log.filter((l) => l.path.includes('refresh_token')).length;
  await Promise.all([m.auth.accessToken(), m.auth.accessToken(), m.auth.refresh()]);
  assert.equal(srv.log.filter((l) => l.path.includes('refresh_token')).length, n + 1);
  // Relancement : reconnexion silencieuse avec le jeton mémorisé.
  const again = device(srv, { storage });
  assert.equal(again.m.snapshot.user?.email, 'karim@example.com', 'identité connue avant le réseau');
  await again.m.init('');
  assert.equal(again.m.snapshot.state, 'signed-in');
  // Jeton révoqué côté serveur : session expirée -> invité + message.
  srv.refresh.clear();
  srv.now += 4_000_000;
  assert.equal(await again.m.auth.accessToken(), null);
  assert.equal(again.m.snapshot.state, 'signed-out');
  assert.match(again.m.snapshot.notice ?? '', /reconnectez-vous/);
  assert.equal(storage.getItem(SESSION_KEY), null);
});

test('upsert : une ligne par emplacement (meta, empreinte, base64), en-têtes apikey + Bearer', async () => {
  const srv = new FakeSupabase();
  srv.confirmEmail = false;
  const { m } = device(srv);
  await m.signUp('salma@example.com', 'secret-123');
  await settle(m);
  assert.ok((await m.store.save('ma-ville', saveAt('2026-11-13T10:00:00.000Z'))).ok);
  await settle(m);
  assert.equal(srv.rows.length, 1);
  const row = srv.rows[0]!;
  assert.equal(row.user_id, srv.uidOf('salma@example.com'));
  assert.equal(row.slot, 'ma-ville');
  assert.equal(row.saved_at, '2026-11-13T10:00:00.000Z');
  assert.equal(await sha256Hex(base64ToBytes(row.data)), row.sha256);
  const meta = row.meta as { name: string; population: number; money: number; info: { cityName: string } };
  assert.equal(meta.name, 'Meknes City');
  assert.equal(meta.info.cityName, 'Meknes City');
  assert.ok(typeof meta.population === 'number' && typeof meta.money === 'number');
  const post = srv.log.find((l) => l.method === 'POST' && l.path.startsWith('/rest/v1/saves'))!;
  assert.match(post.headers['Authorization']!, /^Bearer h\./);
  // Nouvelle version : même ligne mise à jour ; contenu identique : aucun envoi.
  await m.store.save('ma-ville', saveAt('2026-11-13T11:00:00.000Z'));
  await settle(m);
  assert.equal(srv.rows.length, 1);
  assert.equal(srv.rows[0]!.saved_at, '2026-11-13T11:00:00.000Z');
  const posts = srv.log.filter((l) => l.method === 'POST' && l.path.startsWith('/rest/v1')).length;
  const raw = (await m.store.getRaw('ma-ville'))!;
  await m.store.putRaw('ma-ville', raw.bytes, raw.info);
  await m.resync();
  assert.equal(srv.log.filter((l) => l.method === 'POST' && l.path.startsWith('/rest/v1')).length, posts);
  // Suppression propagée.
  await m.store.remove('ma-ville');
  await settle(m);
  assert.equal(srv.rows.length, 0);
});

test('autre appareil : liste avec les métadonnées, lecture de la plus récente, conflit sans écrasement', async () => {
  const srv = new FakeSupabase();
  srv.confirmEmail = false;
  const a = device(srv);
  await a.m.signUp('nora@example.com', 'secret-123');
  await settle(a.m);
  await a.m.store.save('p', saveAt('2026-11-13T12:00:00.000Z', 'Fès'));
  await settle(a.m);

  // Appareil 2 : rien en local -> la liste montre la partie du compte, le chargement la rapatrie.
  const b = device(srv);
  await b.m.signIn('nora@example.com', 'secret-123');
  await settle(b.m);
  const list = await b.m.store.list();
  assert.deepEqual(list.map((s) => [s.slot, s.cityName]), [['p', 'Fès']]);
  const l = await b.m.store.load('p');
  assert.ok(l.ok && l.value.savedAt === '2026-11-13T12:00:00.000Z');
  assert.ok(await b.m.store.current.getRaw('p'), 'copie locale dans l\'espace du compte');

  // Appareil 3 : locale plus ancienne -> la version en ligne gagne ; plus récente -> la locale gagne.
  const c = device(srv);
  await c.m.signIn('nora@example.com', 'secret-123');
  await settle(c.m);
  await c.m.store.current.putRaw('p', (await b.m.store.getRaw('p'))!.bytes, { ...(await b.m.store.getRaw('p'))!.info, savedAt: '2026-11-13T08:00:00.000Z' });
  const lc = await c.m.store.load('p');
  assert.ok(lc.ok && lc.value.savedAt === '2026-11-13T12:00:00.000Z', 'en ligne plus récente');

  // Conflit : un appareil resté en retard n'écrase pas la version en ligne plus récente.
  await a.m.store.save('p', saveAt('2026-11-13T15:00:00.000Z', 'Fès'));
  await settle(a.m);
  const stale = device(srv);
  await stale.m.signIn('nora@example.com', 'secret-123');
  await settle(stale.m);
  await stale.m.store.current.putRaw('p', (await b.m.store.getRaw('p'))!.bytes, { ...(await b.m.store.getRaw('p'))!.info, savedAt: '2026-11-13T13:00:00.000Z' });
  await stale.m.resync();
  assert.equal(srv.rows[0]!.saved_at, '2026-11-13T15:00:00.000Z', 'version en ligne plus récente conservée');
  const ls = await stale.m.store.load('p');
  assert.ok(ls.ok && ls.value.savedAt === '2026-11-13T15:00:00.000Z', 'et rapatriée au chargement');
});

test('hors ligne : sauvegarde locale, état « Hors ligne », synchronisation au retour du réseau', async () => {
  const srv = new FakeSupabase();
  srv.confirmEmail = false;
  const { m, storage, backend, statuses, timers } = device(srv);
  await m.signUp('omar@example.com', 'secret-123');
  await settle(m);
  srv.down = true;
  assert.ok((await m.store.save('ville', saveAt('2026-11-13T10:00:00.000Z'))).ok, 'locale immédiate');
  await settle(m);
  assert.equal(statuses.at(-1)!.state, 'offline');
  assert.equal(statuses.at(-1)!.label, 'Hors ligne — sauvegarde locale');
  assert.ok((await m.store.load('ville')).ok);
  srv.down = false;
  timers.fire(); // créneau suivant
  await settle(m);
  assert.equal(srv.rows.length, 1, 'envoyée au retour du réseau');
  assert.equal(statuses.at(-1)!.label, 'Sauvegardé en ligne');

  // Lancement hors ligne : identité gardée, parties locales du compte visibles, envoi au retour.
  srv.down = true;
  const again = device(srv, { storage, backend });
  await again.m.init('');
  assert.equal(again.m.snapshot.state, 'offline');
  assert.equal(again.m.snapshot.user?.email, 'omar@example.com');
  assert.ok((await again.m.store.save('hors-ligne', saveAt('2026-11-13T11:00:00.000Z'))).ok);
  assert.ok((await again.m.store.list()).some((s) => s.slot === 'hors-ligne'));
  srv.down = false;
  await again.m.auth.refresh(); // évènement « online »
  await settle(again.m);
  await again.m.resync();
  assert.equal(again.m.snapshot.state, 'signed-in');
  assert.ok(srv.rows.some((r) => r.slot === 'hors-ligne'));
});

test('jeton expiré pendant une requête (401) : renouvelé puis requête rejouée', async () => {
  const srv = new FakeSupabase();
  srv.confirmEmail = false;
  const { m } = device(srv);
  await m.signUp('lina@example.com', 'secret-123');
  await settle(m);
  srv.access.clear(); // le serveur ne reconnaît plus le jeton d'accès (révoqué / horloge décalée)
  await m.store.save('x', saveAt('2026-11-13T10:00:00.000Z'));
  await settle(m);
  assert.equal(srv.rows.length, 1);
  assert.equal(m.store.synced!.status.state, 'online');
});

test('séparation par compte sur un même appareil, mode invité conservé, import des parties invité', async () => {
  const srv = new FakeSupabase();
  srv.confirmEmail = false;
  const backend = new MemoryBackend();
  const storage = new MemStorage();
  // Parties invité existantes (comportement actuel).
  const guest = new SaveStore(backend);
  await guest.save('ancienne', saveAt('2026-11-01T10:00:00.000Z', 'Rabat'));
  const { m } = device(srv, { storage, backend });
  await m.init('');
  assert.equal(m.snapshot.state, 'signed-out');
  assert.deepEqual((await m.store.list()).map((s) => s.slot), ['ancienne']);
  assert.equal(srv.log.length, 0, 'invité sans session : aucune requête');

  // Compte A : première connexion -> import proposé ; parties de A rangées sous son préfixe.
  await m.signUp('a@example.com', 'secret-aaa');
  await settle(m);
  assert.deepEqual((await m.store.list()).map((s) => s.slot), [], 'A ne voit pas les parties invité');
  assert.deepEqual((await m.importCandidates()).map((s) => s.slot), ['ancienne']);
  assert.deepEqual(await m.importGuest(), ['ancienne']);
  await settle(m);
  assert.deepEqual((await m.importCandidates()), [], 'question posée une seule fois');
  assert.equal(storage.getItem(IMPORT_KEY(srv.uidOf('a@example.com'))), 'fait');
  await m.store.save('ville-a', saveAt('2026-11-13T10:00:00.000Z', 'Ville A'));
  await settle(m);
  assert.deepEqual(srv.rows.map((r) => r.slot).sort(), ['ancienne', 'ville-a']);
  assert.ok((await backend.keys()).some((k) => k.startsWith(accountPrefix(srv.uidOf('a@example.com')))));

  // Déconnexion : retour aux seules parties invité (copie invité conservée).
  await m.signOut();
  assert.equal(m.snapshot.state, 'signed-out');
  assert.equal(m.snapshot.notice, undefined, 'déconnexion volontaire : pas de message « expirée »');
  assert.deepEqual((await m.store.list()).map((s) => s.slot), ['ancienne']);

  // Compte B sur le même appareil : ne voit ni les parties locales ni les lignes de A.
  await m.signUp('b@example.com', 'secret-bbb');
  await settle(m);
  assert.deepEqual((await m.store.list()).map((s) => s.slot), []);
  m.declineImport();
  assert.deepEqual(await m.importCandidates(), []);
  await m.store.save('ville-b', saveAt('2026-11-13T10:00:00.000Z', 'Ville B'));
  await settle(m);
  assert.deepEqual(srv.rows.filter((r) => r.user_id === srv.uidOf('b@example.com')).map((r) => r.slot), ['ville-b']);

  // Retour de A : ses parties reviennent (locales et en ligne).
  await m.signOut();
  await m.signIn('a@example.com', 'secret-aaa');
  await settle(m);
  assert.deepEqual((await m.store.list()).map((s) => s.slot).sort(), ['ancienne', 'ville-a']);
});

test('mot de passe oublié et retour du lien e-mail (fragment d\'URL) : session ouverte, nouveau mot de passe', async () => {
  const srv = new FakeSupabase();
  srv.confirmEmail = false;
  const first = device(srv);
  await first.m.signUp('rim@example.com', 'ancien-secret');
  await first.m.signOut();
  assert.ok((await first.m.recover('rim@example.com')).ok);
  assert.match(srv.log.at(-1)!.path, /^\/auth\/v1\/recover\?redirect_to=/);
  // Le lien ramène sur le jeu avec des jetons dans le fragment.
  const t = (await new SupabaseAuth({ url: URL_, anonKey: KEY, fetch: srv.fetch, storage: null, now: () => srv.now, timers: new ManualTimers() }).signIn('rim@example.com', 'ancien-secret'));
  assert.ok(t.ok);
  const hash = `#access_token=${t.value.accessToken}&expires_in=3600&refresh_token=${t.value.refreshToken}&token_type=bearer&type=recovery`;
  const d = device(srv);
  const snap = await d.m.init(hash);
  assert.equal(snap.state, 'signed-in');
  assert.equal(snap.redirect?.type, 'recovery');
  assert.ok((await d.m.updatePassword('nouveau-secret')).ok);
  await d.m.signOut();
  assert.ok((await d.m.signIn('rim@example.com', 'nouveau-secret')).ok);
  // Lien expiré : message clair, pas de session.
  const e = device(srv);
  const s2 = await e.m.init('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
  assert.equal(s2.state, 'signed-out');
  assert.match(s2.redirect?.error ?? '', /expiré/);
});
