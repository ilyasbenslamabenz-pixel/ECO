/**
 * PROTOCOLE de messages typés entre le thread principal (client/rendu) et le
 * worker de simulation. Sérialisable (structured clone) ; les gros tableaux sont
 * transférés (Transferable) et non copiés. Pas de SharedArrayBuffer.
 * AUCUN import de three ni du DOM.
 */
import { PROTOCOL_VERSION, SIM_SPEEDS, type SimSpeed } from './constants';
import type { AssetCatalog } from './catalog';
// Type pur (aucun code) : le rapport périodique est défini avec les commandes étendues de la simulation.
import type { SimReport } from '../sim/sim-protocol';
import {
  ROAD_TYPES,
  type BuildingRecord,
  type CommandError,
  type NewGameParams,
  type RoadEdgeRecord,
  type RoadNodeRecord,
  type RoadKindId,
  type RoadTypeId,
  type SaveFile,
  type SimStats,
  type TerrainData,
} from './contracts';

/* ------------------------------------------------------------------ */
/* Commandes main -> worker (chacune reçoit une réponse ok / erreur)    */
/* ------------------------------------------------------------------ */

export interface CommandMap {
  init: { args: { protocolVersion: number; catalog: AssetCatalog }; result: { protocolVersion: number } };
  newGame: { args: NewGameParams; result: { seed: number } };
  buildRoad: {
    /** points = [x0, z0, x1, z1, ...] (m), au moins 2 points. dryRun : valide et chiffre sans construire. */
    args: {
      type: RoadTypeId;
      points: number[];
      dryRun?: boolean;
      /** Type exact (6 types) ; prioritaire sur `type`. */
      kind?: RoadKindId;
      /** Point de contrôle d'une courbe (quadratique) quand `points` contient exactement 2 points. */
      control?: [number, number];
    };
    result: { edgeIds: number[]; cost: number };
  };
  removeRoad: { args: { edgeId: number }; result: { refund: number } };
  placeBuilding: {
    args: { assetId: string; x: number; z: number; rot: number; variant?: number; dryRun?: boolean };
    result: { buildingId: number; cost: number };
  };
  demolish: { args: { buildingId: number }; result: { refund: number } };
  setSpeed: { args: { speed: SimSpeed }; result: { speed: SimSpeed } };
  terraform: { args: { x: number; z: number; radius: number; delta: number }; result: Record<string, never> };
  save: { args: { slot: string }; result: { slot: string; data: SaveFile } };
  load: { args: { data: SaveFile }; result: { buildings: number } };
}

export type CommandName = keyof CommandMap;
export type CommandArgs<K extends CommandName> = CommandMap[K]['args'];
export type CommandResult<K extends CommandName> = CommandMap[K]['result'];

export interface CommandMessage<K extends CommandName = CommandName> {
  kind: 'cmd';
  reqId: number;
  name: K;
  args: CommandArgs<K>;
}

export type MainToWorker = { [K in CommandName]: CommandMessage<K> }[CommandName];

/* ------------------------------------------------------------------ */
/* Messages worker -> main                                              */
/* ------------------------------------------------------------------ */

export interface ReadyMessage {
  kind: 'ready';
  protocolVersion: number;
}

export type ResultMessage =
  | { kind: 'result'; reqId: number; ok: true; data: unknown }
  | { kind: 'result'; reqId: number; ok: false; error: CommandError };

/** Instantané complet envoyé après newGame / load. `terrain.heights` est transféré. */
export interface SnapshotMessage {
  kind: 'snapshot';
  params: NewGameParams;
  terrain: TerrainData;
  buildings: BuildingRecord[];
  roads: { nodes: RoadNodeRecord[]; edges: RoadEdgeRecord[] };
  stats: SimStats;
}

/** Positions des véhicules : count * VEHICLE_STRIDE floats ; buffers transférés à chaque envoi. */
export interface VehicleFrame {
  count: number;
  positions: Float32Array;
  assetIndices: Uint16Array;
  /** Identifiants stables (interpolation entre deux ticks). */
  ids?: Uint32Array;
  /** Variante de peinture. */
  variants?: Uint8Array;
  /** Drapeaux : 1 freinage, 8 urgence. */
  flags?: Uint8Array;
}

/** Zone de la carte de hauteurs modifiée par la simulation (nivellement sous les routes, terraformation). */
export interface TerrainPatchMsg {
  i0: number;
  j0: number;
  i1: number;
  j1: number;
  /** (i1-i0+1) * (j1-j0+1) hauteurs, ligne par ligne (transférées). */
  heights: Float32Array;
  waterSurface: Float32Array;
}

/**
 * Feux tricolores : nombre de flottants par tête de feu (un « bras » = une voie d'arrivée régulée).
 * Disposition d'un bras : x, y, z du pied du poteau (trottoir de droite, à la ligne d'arrêt), cap des véhicules
 * qui arrivent (rad, même convention que les véhicules : atan2(dx, dz)), portée (distance latérale du poteau au
 * centre des voies d'arrivée, m), nombre de voies d'arrivée, rayon du carrefour (rognage, m), index du carrefour
 * dans la disposition (0..n-1, pour regrouper les bras).
 */
export const SIGNAL_HEAD_STRIDE = 8;

/** Disposition des feux (envoyée quand le réseau change ; `version` change alors). */
export interface SignalLayoutMsg {
  version: number;
  /** count * SIGNAL_HEAD_STRIDE flottants (transférés). */
  heads: Float32Array;
  /** Identifiant (monde) du nœud de chaque bras (transféré). */
  nodeIds: Int32Array;
}

/**
 * État des feux : envoyé seulement quand il change (ou avec une nouvelle disposition). Un octet par bras,
 * dans l'ordre de la disposition de même `version` : 0 vert, 1 orange, 2 rouge.
 */
export interface SignalFrame {
  version: number;
  states: Uint8Array;
  layout?: SignalLayoutMsg;
}

/** Delta par tick (ou groupe de ticks) : uniquement ce qui a changé. */
export interface DeltaMessage {
  kind: 'delta';
  tick: number;
  buildingsAdded: BuildingRecord[];
  buildingsRemoved: number[];
  roadNodesAdded: RoadNodeRecord[];
  roadEdgesAdded: RoadEdgeRecord[];
  roadEdgesRemoved: number[];
  vehicles: VehicleFrame | null;
  stats: SimStats;
  /** Zone de terrain modifiée depuis le dernier delta (transférée). */
  terrainPatch?: TerrainPatchMsg;
  /** Rapport économie / démographie / trafic (≈ 1 fois/s) : type SimReport de src/sim/sim-protocol.ts. */
  report?: SimReport;
  /** Feux tricolores (facultatif, rétrocompatible) : présent seulement quand un état ou la disposition change. */
  signals?: SignalFrame;
}

export interface LogMessage {
  kind: 'log';
  level: 'info' | 'warn' | 'error';
  message: string;
}

export type WorkerToMain = ReadyMessage | ResultMessage | SnapshotMessage | DeltaMessage | LogMessage;

/** Liste des buffers à transférer pour un message worker -> main. */
export function collectTransferables(msg: WorkerToMain): Transferable[] {
  const out = new Set<ArrayBuffer>();
  const add = (v: unknown): void => { if (ArrayBuffer.isView(v) && v.buffer instanceof ArrayBuffer) out.add(v.buffer); };
  if (msg.kind === 'snapshot') {
    // Carte de hauteurs + couches d'un WorldTerrain (eau, humidité, forêt, ressources, rivières), toutes copiées par la simulation.
    for (const v of Object.values(msg.terrain)) add(v);
    const rivers = (msg.terrain as { rivers?: { points?: unknown }[] }).rivers;
    if (Array.isArray(rivers)) for (const r of rivers) add(r.points);
  } else if (msg.kind === 'delta') {
    const v = msg.vehicles;
    if (v) { add(v.positions); add(v.assetIndices); add(v.ids); add(v.variants); add(v.flags); }
    if (msg.terrainPatch) { add(msg.terrainPatch.heights); add(msg.terrainPatch.waterSurface); }
    if (msg.signals) { add(msg.signals.states); if (msg.signals.layout) { add(msg.signals.layout.heads); add(msg.signals.layout.nodeIds); } }
  }
  return [...out];
}

/* ------------------------------------------------------------------ */
/* Validation à l'exécution des commandes entrantes (côté worker)       */
/* ------------------------------------------------------------------ */

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const ROAD_KIND_IDS: readonly RoadKindId[] = ['street', 'avenue', 'boulevard', 'oneway', 'pedestrian', 'highway'];
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const bad = (message: string): CommandError => ({ code: 'INVALID_ARGS', message });

/** Vérifie la forme d'un message entrant. Renvoie null si valide, sinon l'erreur. */
export function validateCommandMessage(msg: unknown): CommandError | null {
  if (!isObj(msg) || msg.kind !== 'cmd' || !isNum(msg.reqId) || typeof msg.name !== 'string') {
    return bad('Message mal formé');
  }
  const a = msg.args;
  if (!isObj(a)) return bad('Arguments manquants');
  switch (msg.name as CommandName) {
    case 'init':
      if (a.protocolVersion !== PROTOCOL_VERSION) return bad(`Version de protocole ${String(a.protocolVersion)} incompatible (attendu ${PROTOCOL_VERSION})`);
      if (!isObj(a.catalog) || !Array.isArray(a.catalog.assets)) return bad('Catalogue invalide');
      return null;
    case 'newGame':
      if (!isNum(a.seed) || !isNum(a.mapChunks) || !isNum(a.startMoney) || typeof a.cityName !== 'string') return bad('Paramètres de partie invalides');
      if (a.mapChunks < 1 || a.mapChunks > 32) return bad('Taille de carte hors limites (1..32 chunks)');
      if (a.startHour !== undefined && (!isNum(a.startHour) || a.startHour < 0 || a.startHour >= 24)) return bad('Heure de départ invalide');
      if (a.terrain !== undefined && (typeof a.terrain !== 'object' || a.terrain === null)) return bad('Paramètres de carte invalides');
      return null;
    case 'buildRoad': {
      if (typeof a.type !== 'string' || !(a.type in ROAD_TYPES)) return bad('Type de route inconnu');
      if (a.kind !== undefined && !ROAD_KIND_IDS.includes(a.kind as RoadKindId)) return bad('Type de route inconnu');
      const p = a.points;
      if (!Array.isArray(p) || p.length < 4 || p.length % 2 !== 0 || !p.every(isNum)) return bad('Tracé de route invalide');
      if (a.control !== undefined) {
        const c = a.control;
        if (!Array.isArray(c) || c.length !== 2 || !c.every(isNum) || p.length !== 4) return bad('Point de contrôle de courbe invalide');
      }
      return null;
    }
    case 'removeRoad':
      return isNum(a.edgeId) ? null : bad('edgeId invalide');
    case 'placeBuilding':
      if (typeof a.assetId !== 'string' || !isNum(a.x) || !isNum(a.z) || !isNum(a.rot)) return bad('Placement invalide');
      if (a.variant !== undefined && !isNum(a.variant)) return bad('Variante invalide');
      return null;
    case 'demolish':
      return isNum(a.buildingId) ? null : bad('buildingId invalide');
    case 'setSpeed':
      return (SIM_SPEEDS as readonly unknown[]).includes(a.speed) ? null : bad('Vitesse invalide');
    case 'terraform':
      return isNum(a.x) && isNum(a.z) && isNum(a.radius) && isNum(a.delta) ? null : bad('Terraformation invalide');
    case 'save':
      return typeof a.slot === 'string' && a.slot.length > 0 ? null : bad('Emplacement de sauvegarde invalide');
    case 'load':
      return isObj(a.data) ? null : bad('Données de sauvegarde absentes');
    default:
      return bad(`Commande inconnue : ${String(msg.name)}`);
  }
}
