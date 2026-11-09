// Serveur ECO NATION : source de vérité de la simulation, API REST, temps réel (Socket.IO), sauvegardes.
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { Server, type Socket } from 'socket.io';
import { applyAction, applyGovAction, applyProgramAction, createGame, migrate, schedulePolicy, snapshot, tick, type FinanceAction, type GovAction, type GameAction, type SectorAction } from '../../shared/sim/engine';
// --- modules services publics/recherche/construction ---
import { applyServiceAction, type ServicesAction } from '../../shared/sim/engine';
import { cityFacilities } from '../../shared/sim/services';
import type { CountryConfig, GameState, Policy } from '../../shared/sim/types';
import { db } from './db';

const PORT = Number(process.env.PORT) || 3002;
const app = express();
app.use(express.json({ limit: '200kb' }));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: process.env.CORS_ORIGIN?.split(',') ?? true }, perMessageDeflate: { threshold: 4096 }, maxHttpBufferSize: 5e5 });

export const SPEEDS: Record<number, number> = { 0: 0, 1: 4000, 2: 2000, 5: 800, 10: 400 }; // ms par mois simulé

interface Live {
  state: GameState;
  owner: string;
  speed: number;
  timer: NodeJS.Timeout | null;
  sockets: Set<string>;
  lastSavedMonth: number;
  lastNotice: number;
  unloadTimer: NodeJS.Timeout | null;
  overNotified: boolean; // fin de mandat déjà signalée
  infraVersion: number; // dernière version de `country.infra` envoyée aux clients
}

/** Renvoie la liste des équipements aux clients si elle a changé (chantiers ouverts, mises en service, démolitions). */
function emitInfra(L: Live) {
  // signature : version du module de construction + nombre d'équipements + chantiers en cours (sites énergétiques et sectoriels inclus)
  const inf = L.state.country.infra;
  const v = (L.state.construction?.infraVersion ?? 0) * 1e6 + inf.length * 1000 + inf.filter((i) => i.status).length;
  if (v === L.infraVersion) return;
  L.infraVersion = v;
  io.to(L.state.id).emit('game:infra', { infra: L.state.country.infra, version: v });
}
const live = new Map<string, Live>();

const ownerOf = (v: unknown) => (typeof v === 'string' && /^[a-f0-9]{32}$/.test(v) ? v : '');

async function persist(L: Live) {
  try {
    await db.save(L.state.id, L.owner, L.state.name, L.state.month, JSON.stringify(L.state));
    L.lastSavedMonth = L.state.month;
  } catch (e) {
    console.error('Erreur de sauvegarde', e);
  }
}

function setSpeed(L: Live, speed: number) {
  L.speed = SPEEDS[speed] !== undefined ? speed : 0;
  if (L.timer) clearInterval(L.timer);
  L.timer = null;
  if (L.speed > 0) L.timer = setInterval(() => step(L), SPEEDS[L.speed]);
  io.to(L.state.id).emit('game:speed', L.speed);
}

/** Diffuse l'instantané courant (après une décision du joueur, hors pas de simulation). */
function broadcast(L: Live) {
  const S = L.state;
  io.to(S.id).emit('game:tick', { snap: snapshot(S), last: null, notices: S.notices.filter((n) => n.id > L.lastNotice) });
  L.lastNotice = S.noticeSeq - 1;
}

function step(L: Live) {
  const t0 = performance.now();
  const evBefore = new Set((L.state.events?.active ?? []).map((e) => e.uid));
  const elecBefore = L.state.politics?.elections.length ?? 0;
  tick(L.state);
  const S = L.state;
  const last: Record<string, number> = {};
  for (const [k, v] of Object.entries(S.history)) last[k] = v[v.length - 1];
  const notices = S.notices.filter((n) => n.id > L.lastNotice);
  if (notices.length) L.lastNotice = notices[notices.length - 1].id;
  io.to(S.id).emit('game:tick', { snap: snapshot(S), last, notices });
  // --- modules politique/international/événements/victoire ---
  // nouvel événement en attente de décision : le jeu continue (pas de pause côté serveur), l'interface le met en évidence
  for (const ev of S.events?.active ?? []) if (!evBefore.has(ev.uid)) io.to(S.id).emit('game:event', ev);
  if ((S.politics?.elections.length ?? 0) > elecBefore) io.to(S.id).emit('game:election', S.politics!.elections.at(-1));
  if (S.victory?.status === 'defaite' && !L.overNotified) {
    L.overNotified = true;
    setSpeed(L, 0); // fin de mandat : la partie est suspendue jusqu'à la décision du joueur
    io.to(S.id).emit('game:over', S.victory.defeat);
  } else if (S.victory?.status !== 'defaite') L.overNotified = false;
  emitInfra(L);
  if (S.month - L.lastSavedMonth >= 12) void persist(L); // sauvegarde automatique annuelle
  const dt = performance.now() - t0;
  if (dt > 200) console.warn(`Pas de simulation lent : ${dt.toFixed(0)} ms`);
}

async function openGame(id: string, owner: string): Promise<Live | null> {
  const existing = live.get(id);
  if (existing) return existing.owner === owner ? existing : null;
  const raw = await db.load(id, owner);
  if (!raw) return null;
  const state = migrate(JSON.parse(raw) as GameState);
  const L: Live = { state, owner, speed: 0, timer: null, sockets: new Set(), lastSavedMonth: state.month, lastNotice: state.noticeSeq - 1, unloadTimer: null, overNotified: state.victory?.status === 'defaite', infraVersion: -1 };
  live.set(id, L);
  return L;
}

function release(L: Live, socketId: string) {
  L.sockets.delete(socketId);
  if (L.sockets.size === 0) {
    setSpeed(L, 0); // une partie n'avance que lorsqu'elle est ouverte
    void persist(L);
    if (L.unloadTimer) clearTimeout(L.unloadTimer);
    L.unloadTimer = setTimeout(() => {
      if (L.sockets.size === 0) live.delete(L.state.id);
    }, 60000);
  }
}

// ---------- API REST ----------
const auth = (req: express.Request) => ownerOf(req.header('x-player'));

app.get('/api/health', (_req, res) => res.json({ ok: true, games: live.size }));

app.get('/api/games', async (req, res) => {
  const owner = auth(req);
  if (!owner) return res.status(401).json({ error: 'Identifiant joueur manquant' });
  res.json(await db.list(owner));
});

app.post('/api/games', async (req, res) => {
  const owner = auth(req);
  if (!owner) return res.status(401).json({ error: 'Identifiant joueur manquant' });
  const b = (req.body ?? {}) as Partial<CountryConfig> & { name?: string };
  const cfg: Partial<CountryConfig> = {
    name: String(b.name ?? "République d'Ilyas").replace(/[<>]/g, '').slice(0, 40) || "République d'Ilyas",
    seed: Number.isFinite(Number(b.seed)) ? Math.abs(Math.floor(Number(b.seed))) % 1e9 : Math.floor(Math.random() * 1e6),
    metropoles: Number(b.metropoles) || 5,
    villes: Number(b.villes) || 12,
    communes: Number(b.communes) || 30,
    population: Number(b.population) || 9_600_000,
  };
  const id = crypto.randomBytes(8).toString('hex');
  const state = createGame(cfg, id, cfg.name);
  await db.save(id, owner, state.name, state.month, JSON.stringify(state));
  res.json({ id });
});

app.post('/api/games/:id/copy', async (req, res) => {
  const owner = auth(req);
  const L = live.get(req.params.id);
  const raw = L && L.owner === owner ? JSON.stringify(L.state) : await db.load(req.params.id, owner);
  if (!owner || !raw) return res.status(404).json({ error: 'Partie introuvable' });
  const state = JSON.parse(raw) as GameState;
  state.id = crypto.randomBytes(8).toString('hex');
  state.name = String(req.body?.name ?? `${state.name} (copie)`).replace(/[<>]/g, '').slice(0, 40);
  await db.save(state.id, owner, state.name, state.month, JSON.stringify(state));
  res.json({ id: state.id });
});

app.delete('/api/games/:id', async (req, res) => {
  const owner = auth(req);
  if (!owner) return res.status(401).json({ error: 'Identifiant joueur manquant' });
  const L = live.get(req.params.id);
  if (L && L.owner === owner) {
    setSpeed(L, 0);
    live.delete(req.params.id);
  }
  res.json({ ok: await db.remove(req.params.id, owner) });
});

const dist = path.resolve(process.cwd(), 'client/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get(/^(?!\/api|\/socket\.io).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
} else {
  app.get('/', (_req, res) => res.send('Serveur ECO NATION actif. Lancez le client avec « npm run dev » ou construisez-le avec « npm run build ».'));
}

// ---------- Temps réel ----------
type Ack = (r: unknown) => void;
const ack = (a: unknown): Ack => (typeof a === 'function' ? (a as Ack) : () => {});

io.on('connection', (socket: Socket) => {
  const owner = ownerOf(socket.handshake.auth?.player);
  let current: Live | null = null;

  socket.on('game:open', async (msg: { id?: string }, cb) => {
    const reply = ack(cb);
    if (!owner) return reply({ ok: false, msg: 'Identifiant joueur manquant' });
    if (current) { socket.leave(current.state.id); release(current, socket.id); current = null; }
    const L = await openGame(String(msg?.id ?? ''), owner);
    if (!L) return reply({ ok: false, msg: 'Partie introuvable' });
    if (L.unloadTimer) { clearTimeout(L.unloadTimer); L.unloadTimer = null; }
    current = L;
    L.sockets.add(socket.id);
    socket.join(L.state.id);
    reply({ ok: true, country: L.state.country, history: L.state.history, snap: snapshot(L.state), speed: L.speed });
  });

  socket.on('game:speed', (speed: number) => {
    if (current) setSpeed(current, Number(speed));
  });

  socket.on('game:step', () => {
    if (current && current.speed === 0) step(current);
  });

  socket.on('game:policy', (policy: Policy, cb) => {
    if (!current) return ack(cb)({ ok: false, msg: 'Aucune partie ouverte' });
    try {
      // procédure parlementaire : décrets pour les petits ajustements, projets de loi votés pour les réformes majeures
      const r = schedulePolicy(current.state, policy, { parliament: true });
      io.to(current.state.id).emit('game:pending', current.state.pending);
      if (r.bills.length) broadcast(current);
      ack(cb)({ ok: true, pending: current.state.pending, bills: r.bills.map((b) => ({ id: b.id, title: b.title, voteMonth: b.voteMonth })) });
    } catch (e) {
      console.error(e);
      ack(cb)({ ok: false, msg: 'Politique invalide' });
    }
  });

  socket.on('game:cancelPending', (cb) => {
    if (!current) return;
    current.state.pending = null;
    io.to(current.state.id).emit('game:pending', null);
    ack(cb)({ ok: true });
  });

  socket.on('game:action', (a: GameAction, cb) => { // finances, programmes énergétiques et environnementaux
    if (!current) return ack(cb)({ ok: false, msg: 'Aucune partie ouverte' });
    const r = applyAction(current.state, a);
    if (r.ok) io.to(current.state.id).emit('game:tick', { snap: snapshot(current.state), last: null, notices: current.state.notices.filter((n) => n.id > current!.lastNotice) });
    if (r.ok) current.lastNotice = current.state.noticeSeq - 1;
    ack(cb)(r);
  });

  // décisions d'événements, diplomatie, accords, parlement (confiance, dissolution, coalition, retrait de loi), poursuite après défaite
  socket.on('game:gov', (a: GovAction, cb) => {
    if (!current) return ack(cb)({ ok: false, msg: 'Aucune partie ouverte' });
    try {
      const r = applyGovAction(current.state, a);
      if (r.ok) broadcast(current);
      if (r.ok && (a as { type?: string })?.type === 'climatCard') emitInfra(current); // --- plan climat --- : chantiers ouverts par une carte
      ack(cb)(r);
    } catch (e) {
      console.error(e);
      ack(cb)({ ok: false, msg: 'Action invalide' });
    }
  });
  // programmes sectoriels (transports, industrie, agriculture, déchets) : placement automatique par le moteur
  socket.on('game:program', (a: SectorAction, cb) => {
    if (!current) return ack(cb)({ ok: false, msg: 'Aucune partie ouverte' });
    let r: { ok: boolean; msg: string };
    try { r = applyProgramAction(current.state, a); } catch (e) { console.error(e); r = { ok: false, msg: 'Programme invalide' }; }
    if (r.ok) io.to(current.state.id).emit('game:tick', { snap: snapshot(current.state), last: null, notices: current.state.notices.filter((n) => n.id > current!.lastNotice) });
    if (r.ok) current.lastNotice = current.state.noticeSeq - 1;
    ack(cb)(r);
  });
  // --- modules services publics/recherche/construction ---
  // Actions des ministères : recrutements, programmes d'investissement (placement automatique validé côté serveur),
  // plans logement, recherche. `game:build` est un alias historique de `game:service`.
  const onService = (a: ServicesAction, cb: unknown) => {
    if (!current) return ack(cb)({ ok: false, code: 'AUCUNE_PARTIE', msg: 'Aucune partie ouverte' });
    if (!a || typeof a !== 'object' || typeof (a as { type?: unknown }).type !== 'string') return ack(cb)({ ok: false, code: 'ACTION_INCONNUE', msg: 'Action invalide' });
    let r;
    try {
      r = applyServiceAction(current.state, a);
    } catch (e) {
      console.error(e);
      return ack(cb)({ ok: false, code: 'ERREUR', msg: 'Action impossible' });
    }
    if (r.ok) {
      const L = current;
      io.to(L.state.id).emit('game:tick', { snap: snapshot(L.state), last: null, notices: L.state.notices.filter((n) => n.id > L.lastNotice) });
      L.lastNotice = L.state.noticeSeq - 1;
      emitInfra(L);
    }
    ack(cb)(r);
  };
  socket.on('game:service', onService);
  socket.on('game:build', onService);

  socket.on('game:facilities', (cb) => {
    if (!current) return ack(cb)({ ok: false, msg: 'Aucune partie ouverte' });
    ack(cb)({ ok: true, facilities: cityFacilities(current.state) });
  });

  socket.on('game:save', async (cb) => {
    if (!current) return ack(cb)({ ok: false });
    await persist(current);
    ack(cb)({ ok: true, month: current.state.month });
  });

  socket.on('disconnect', () => {
    if (current) release(current, socket.id);
  });
});

async function shutdown() {
  console.log('\nSauvegarde des parties ouvertes…');
  await Promise.allSettled([...live.values()].map(persist));
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, () => console.log(`🌍 ECO NATION — serveur prêt sur http://localhost:${PORT}`));
