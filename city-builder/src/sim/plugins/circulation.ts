/**
 * Module de simulation « Circulation » — propriété de la branche p2a-circulation.
 *
 * Rôle : relier la simulation de trafic (src/sim/traffic, voies multiples, MOBIL, carrefours à conflits
 * réservés, feux à phases, réacheminement) au reste du jeu par les points d'extension :
 *  - publie l'**API des feux** (`ctx.provide('feux', …)`, types dans src/shared/protocol-ext/circulation.ts)
 *    que le module piétons consomme par `ctx.use('feux')` ;
 *  - envoie au rendu la **carte de congestion** (géométrie une fois par réseau, niveaux ≈ 1/s) et les
 *    indicateurs du trafic (`delta.ext.circulation`, `snapshot.ext.circulation`) ;
 *  - **sauvegarde** l'état des carrefours à feux et les réglages (section versionnée) ;
 *  - répond aux **commandes** du panneau d'interface (`pluginCommand { plugin: 'circulation', … }`).
 *
 * Accès au trafic : `PluginContext` ne l'expose pas encore (façade commune, lecture seule) ; le module passe
 * par le registre du module trafic (src/sim/traffic/registry.ts). Demande d'API au cœur : docs/requests/circulation.md.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import {
  CIRCULATION_EXT_VERSION, FEUX_SERVICE,
  type CirculationDelta, type CirculationSnapshot, type CirculationStats, type FeuxApi,
} from '../../shared/protocol-ext/circulation';
import { PLUGIN_TRANSFER_KEY } from '../../shared/protocol';
import { CIRCULATION_SAVE_VERSION, emptyCirculationSave, migrateCirculation, readCirculationSave, type CirculationSave } from '../../sim/save-sections/circulation';
import { activeTraffic } from '../traffic/registry';
import type { TrafficSystem } from '../traffic/system';
import type { PluginCommandResult, PluginContext, SimPlugin } from './types';

/**
 * Période d'envoi de la carte de congestion, en nombre de deltas (le worker en émet ≈ 10 par seconde réelle,
 * quelle que soit la vitesse de jeu) : une carte par seconde réelle.
 */
const MAP_PERIOD_DELTAS = 10;

interface State {
  save: CirculationSave;
  /** Version de réseau dont la géométrie a déjà été envoyée (−1 : aucune). */
  layoutSent: number;
  /** Deltas écoulés depuis le dernier envoi de carte. */
  sinceMap: number;
  /** Affichage demandé (envoyé au rendu quand il change). */
  overlay: boolean;
  overlaySent: boolean | null;
  started: boolean;
}

function freshState(): State {
  return { save: emptyCirculationSave(), layoutSent: -1, sinceMap: MAP_PERIOD_DELTAS, overlay: false, overlaySent: null, started: false };
}

let state: State = freshState();

/** Système de trafic de la simulation en cours (null hors partie). */
function traffic(): TrafficSystem | null { return activeTraffic(); }

/** Indicateurs du trafic pour l'interface. */
export function circulationStats(t: TrafficSystem): CirculationStats {
  const s = t.stats;
  const { congested, total } = t.congestedLength(2);
  return {
    vehicles: s.vehicles, meanSpeedKmh: s.meanSpeedKmh, stopped: s.stopped, arrived: s.arrived, spawned: s.spawned,
    removedStuck: s.removedStuck, laneChanges: s.laneChanges, mandatoryLaneChanges: s.mandatoryLaneChanges,
    rerouted: s.rerouted, unblocked: s.unblocked, pedestrianYields: s.pedestrianYields,
    signals: s.signals, priorityJunctions: s.priorityJunctions, yieldJunctions: s.yieldJunctions,
    connectedBuildings: s.connectedBuildings, routeQueries: s.routeQueries,
    congestedMeters: Math.round(congested), networkMeters: Math.round(total),
  };
}

/** Charge utile courante (deltas et instantané partagent la construction). */
function buildPayload(t: TrafficSystem, full: boolean): CirculationDelta {
  const out: CirculationDelta = { version: CIRCULATION_EXT_VERSION };
  const transfer: ArrayBufferLike[] = [];
  if (full || t.signalLayoutVersion !== state.layoutSent) {
    const layout = t.congestionLayout();
    out.layout = layout;
    state.layoutSent = layout.version;
    transfer.push(layout.edgeIds.buffer, layout.ptStart.buffer, layout.x.buffer, layout.y.buffer, layout.z.buffer, layout.half.buffer);
  }
  const map = t.congestionFrame();
  out.congestion = map;
  transfer.push(map.edgeIds.buffer, map.density.buffer, map.speed.buffer, map.ratio.buffer, map.level.buffer);
  out.stats = circulationStats(t);
  (out as unknown as Record<string, unknown>)[PLUGIN_TRANSFER_KEY] = transfer;
  return out;
}

export const circulationPlugin: SimPlugin = {
  id: 'circulation',
  saveVersion: CIRCULATION_SAVE_VERSION,

  init(ctx: PluginContext): void {
    // API des feux : façade stable, publiée une fois, qui suit le trafic de la partie en cours.
    const api: FeuxApi = {
      get version() { return traffic()?.signalLayoutVersion ?? 0; },
      crossings: () => traffic()?.crossings() ?? [],
      crossing: (id) => traffic()?.feuxApi().crossing(id) ?? null,
      crossingsNear: (x, z, r) => traffic()?.feuxApi().crossingsNear(x, z, r) ?? [],
      junctions: () => traffic()?.signalJunctions() ?? [],
      junction: (id) => traffic()?.feuxApi().junction(id) ?? null,
      announcePedestrians: (id, seconds) => traffic()?.announcePedestrians(id, seconds) ?? false,
    };
    ctx.provide<FeuxApi>(FEUX_SERVICE, api);
  },

  onNewGame(): void {
    state = freshState();
    const t = traffic();
    if (t) t.rerouteEnabled = true;
  },

  onTick(ctx: PluginContext, minutes: number): void {
    void minutes;
    state.started = ctx.inGame;
  },

  takeDelta(ctx: PluginContext): unknown | undefined {
    const t = traffic();
    if (!t || !ctx.inGame) return undefined;
    state.sinceMap++;
    const due = state.sinceMap >= MAP_PERIOD_DELTAS || t.signalLayoutVersion !== state.layoutSent;
    const overlayChanged = state.overlaySent !== state.overlay;
    if (!due && !overlayChanged) return undefined;
    const out: CirculationDelta = due ? buildPayload(t, false) : { version: CIRCULATION_EXT_VERSION };
    if (due) state.sinceMap = 0;
    if (overlayChanged) { out.overlay = state.overlay; state.overlaySent = state.overlay; }
    return out;
  },

  snapshot(ctx: PluginContext): unknown | undefined {
    const t = traffic();
    if (!t || !ctx.inGame) return undefined;
    state.layoutSent = -1; // le rendu repart de zéro : géométrie renvoyée
    const base = buildPayload(t, true);
    state.sinceMap = 0;
    state.overlaySent = state.overlay;
    const snap: CirculationSnapshot = { ...base, overlay: state.overlay };
    return snap;
  },

  save(): unknown {
    const t = traffic();
    const feux = t ? t.signalSnapshot().map((s) => ({ n: s.nodeId, p: s.phase, st: s.stage, t: +s.timer.toFixed(2) })) : [];
    const data: CirculationSave = { feux, reroute: t ? t.rerouteEnabled : true, overlay: state.overlay };
    state.save = data;
    return data;
  },

  load(ctx: PluginContext, data: unknown, version: number): void {
    const parsed = readCirculationSave(migrateCirculation(data, version));
    state = freshState();
    state.save = parsed;
    state.overlay = parsed.overlay;
    const t = traffic();
    if (t) {
      t.rerouteEnabled = parsed.reroute;
      t.restoreSignals(parsed.feux.map((f) => ({ nodeId: f.n, phase: f.p, stage: f.st, timer: f.t })));
    }
    void ctx;
  },

  command(ctx: PluginContext, name: string, payload: unknown): PluginCommandResult {
    const t = traffic();
    if (!t || !ctx.inGame) return { ok: false, code: 'NO_GAME', message: 'Aucune partie en cours' };
    const p = (payload ?? {}) as Record<string, unknown>;
    switch (name) {
      case 'stats':
        return { ok: true, data: circulationStats(t) };
      case 'congestion':
        return { ok: true, data: t.congestionFrame() };
      case 'feux':
        return { ok: true, data: t.signalJunctions() };
      case 'passages': {
        const x = Number(p['x']), z = Number(p['z']), r = Number(p['radius']);
        if (Number.isFinite(x) && Number.isFinite(z) && Number.isFinite(r)) return { ok: true, data: t.feuxApi().crossingsNear(x, z, r) };
        return { ok: true, data: t.crossings() };
      }
      case 'afficherCongestion': {
        state.overlay = p['on'] === true;
        return { ok: true, data: { on: state.overlay } };
      }
      case 'reglages': {
        if (typeof p['reroute'] === 'boolean') t.rerouteEnabled = p['reroute'];
        const d = Number(p['demandScale']);
        if (Number.isFinite(d) && d >= 0 && d <= 20) t.demandScale = d;
        return { ok: true, data: { reroute: t.rerouteEnabled, demandScale: t.demandScale } };
      }
      default:
        return { ok: false, code: 'INVALID_ARGS', message: `Commande inconnue : ${name}` };
    }
  },
};

/** Remise à neuf de l'état du module (tests). */
export function resetCirculationModule(): void { state = freshState(); }
