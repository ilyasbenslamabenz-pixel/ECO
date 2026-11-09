// Communication avec le serveur : REST (parties) et Socket.IO (simulation en direct).
import { io } from 'socket.io-client';
import { useStore } from './store';
import type { Snapshot, FinanceAction, GovAction, GameAction, SectorAction } from '../../shared/sim/engine';
import type { GameEvent } from '../../shared/sim/events';
import type { ElectionResult } from '../../shared/sim/politics';
import type { CountryDef, Notice, Policy } from '../../shared/sim/types';
import type { ServicesAction } from '../../shared/sim/engine';
import type { CityFacilities } from '../../shared/sim/services';

const KEY = 'eco_player';
export const player: string = (() => {
  let t = localStorage.getItem(KEY);
  if (!t || !/^[a-f0-9]{32}$/.test(t)) {
    t = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(KEY, t);
  }
  return t;
})();

const st = () => useStore.getState();
export const socket = io(import.meta.env.VITE_SERVER_URL || undefined, { transports: ['websocket', 'polling'], auth: { player } });

socket.on('connect', () => {
  st().set({ connected: true });
  const id = st().gameId;
  if (id && st().screen === 'game') void openGame(id, true);
});
socket.on('disconnect', () => st().set({ connected: false }));

socket.on('game:tick', (m: { snap: Snapshot; last: Record<string, number> | null; notices: Notice[] }) => {
  const s = st();
  const history = s.history;
  if (m.last) for (const [k, v] of Object.entries(m.last)) (history[k] ??= []).push(v);
  const notices = m.notices?.length ? [...s.notices, ...m.notices].slice(-80) : s.notices;
  s.set({ snap: m.snap, history: { ...history }, notices, unread: s.unread + (m.notices?.length ?? 0) });
  // --- missions --- : une mise en service décidée par le joueur a déjà son toast « avant → après » (ui/Missions.tsx)
  const fbMonths = new Set((m.snap.missions?.feedback ?? []).filter((f) => f.kind === 'chantier').map((f) => f.month));
  for (const n of m.notices ?? []) if ((n.kind !== 'info' || n.title.startsWith('Réformes')) && !(n.title === 'Mise en service' && fbMonths.has(n.month))) s.toast(`${n.title} — ${n.text}`, n.kind);
});
socket.on('game:speed', (speed: number) => st().set({ speed }));
// --- modules politique/international/événements/victoire ---
socket.on('game:event', (ev: GameEvent) => st().toast(`${ev.icon} ${ev.title} : décision attendue !`, ev.kind === 'opportunite' ? 'good' : 'warn'));
socket.on('game:election', (e: ElectionResult) => st().toast(`🗳️ Élections : ${e.text}`, e.outcome === 'defaite' ? 'bad' : e.outcome === 'cohabitation' ? 'warn' : 'good'));
socket.on('game:over', (d: { text: string } | null) => { st().toast(`⛔ ${d?.text ?? 'Fin de mandat'}`, 'bad'); st().set({ panel: 'objectifs' }); });
socket.on('game:pending', (pending: Snapshot['pending']) => {
  const s = st();
  if (s.snap) s.set({ snap: { ...s.snap, pending } });
});

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { 'content-type': 'application/json', 'x-player': player, ...(init?.headers || {}) } });
  if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || r.statusText);
  return r.json();
}

export interface GameMeta { id: string; name: string; month: number; updatedAt: number; createdAt: number }
export const listGames = () => api<GameMeta[]>('/api/games');
export const createGameReq = (cfg: Record<string, unknown>) => api<{ id: string }>('/api/games', { method: 'POST', body: JSON.stringify(cfg) });
export const copyGame = (id: string, name: string) => api<{ id: string }>(`/api/games/${id}/copy`, { method: 'POST', body: JSON.stringify({ name }) });
export const deleteGame = (id: string) => api<{ ok: boolean }>(`/api/games/${id}`, { method: 'DELETE' });

export function openGame(id: string, silent = false): Promise<boolean> {
  return new Promise((resolve) => {
    socket.emit('game:open', { id }, (r: { ok: boolean; msg?: string; country: CountryDef; history: Record<string, number[]>; snap: Snapshot; speed: number }) => {
      if (!r.ok) {
        st().toast(r.msg || 'Impossible d\'ouvrir la partie', 'bad');
        return resolve(false);
      }
      localStorage.setItem('eco_last', id);
      st().set({ screen: 'game', gameId: id, country: r.country, history: r.history, snap: r.snap, speed: r.speed, notices: r.snap.notices, unread: 0, draft: silent ? st().draft : null, selection: null });
      resolve(true);
    });
  });
}

export const setSpeed = (s: number) => socket.emit('game:speed', s);
export const stepOnce = () => socket.emit('game:step');
export function submitPolicy(p: Policy): Promise<boolean> {
  return new Promise((resolve) => socket.emit('game:policy', p, (r: { ok: boolean; msg?: string; bills?: { id: number; title: string }[] }) => {
    if (r.ok) {
      st().set({ draft: null });
      if (r.bills?.length) st().toast(`Décrets programmés au mois prochain ; ${r.bills.length} projet${r.bills.length > 1 ? 's' : ''} de loi soumis au vote du parlement.`, 'info');
      else st().toast('Décrets adoptés : entrée en vigueur au 1er du mois prochain.', 'good');
    }
    else st().toast(r.msg || 'Réforme refusée', 'bad');
    resolve(r.ok);
  }));
}
export const cancelPending = () => socket.emit('game:cancelPending', () => st().toast('Réformes en attente annulées.'));
export function financeAction(a: FinanceAction): Promise<boolean> {
  return new Promise((resolve) => socket.emit('game:action', a, (r: { ok: boolean; msg: string }) => {
    st().toast(r.msg, r.ok ? 'good' : 'bad');
    resolve(r.ok);
  }));
}
/** Décision d'événement, diplomatie, accord, action parlementaire ou poursuite après défaite. */
export function govAction(a: GovAction): Promise<boolean> {
  return new Promise((resolve) => socket.emit('game:gov', a, (r: { ok: boolean; msg: string }) => {
    st().toast(r.msg, r.ok ? 'good' : 'bad');
    resolve(r.ok);
  }));
}
// --- plan climat --- : carte-action ou choix de trajectoire, validés par le moteur (canal game:gov)
export function climatAction(a: Extract<GovAction, { type: 'climatCard' | 'climatTrajectoire' }>): Promise<boolean> {
  return govAction(a);
}
/** Programmes énergétiques et environnementaux (construction, fermeture, reboisement…) : même canal que les opérations financières. */
export function gameAction(a: GameAction): Promise<boolean> {
  return new Promise((resolve) => socket.emit('game:action', a, (r: { ok: boolean; msg: string }) => {
    st().toast(r.msg, r.ok ? 'good' : 'bad');
    resolve(r.ok);
  }));
}
/** Programme sectoriel (nouvelle ligne, installation, plan) : placé et réalisé par le moteur du serveur. */
export function programAction(a: SectorAction): Promise<boolean> {
  return new Promise((resolve) => socket.emit('game:program', a, (r: { ok: boolean; msg: string }) => {
    st().toast(r.msg, r.ok ? 'good' : 'bad');
    resolve(r.ok);
  }));
}
// --- modules services publics/recherche/construction ---
socket.on('game:infra', (m: { infra: CountryDef['infra'] }) => {
  const c = st().country;
  if (c && Array.isArray(m?.infra)) st().set({ country: { ...c, infra: m.infra } });
});
export interface ServiceReply { ok: boolean; code?: string; msg: string; [k: string]: unknown }
/** Action d'un ministère : recrutement, programme d'investissement, plan logement, recherche, travaux. */
export function serviceAction(a: ServicesAction, quiet = false): Promise<ServiceReply> {
  return new Promise((resolve) => socket.emit('game:service', a, (r: ServiceReply) => {
    if (!quiet || !r.ok) st().toast(r.msg, r.ok ? 'good' : 'bad');
    resolve(r);
  }));
}
export function fetchFacilities(): Promise<CityFacilities[]> {
  return new Promise((resolve) => socket.emit('game:facilities', (r: { ok: boolean; facilities?: CityFacilities[] }) => resolve(r.ok ? r.facilities ?? [] : [])));
}

export const saveNow = () => socket.emit('game:save', (r: { ok: boolean }) => st().toast(r.ok ? 'Partie sauvegardée.' : 'Échec de la sauvegarde', r.ok ? 'good' : 'bad'));
export function leaveGame() {
  setSpeed(0);
  socket.emit('game:save', () => {});
  st().set({ screen: 'menu', gameId: null, snap: null, country: null, panel: null, draft: null });
}
