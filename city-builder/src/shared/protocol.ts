/**
 * PROTOCOLE de messages typés entre le thread principal (client/rendu) et le
 * worker de simulation. Sérialisable (structured clone) ; les gros tableaux sont
 * transférés (Transferable) et non copiés. Pas de SharedArrayBuffer.
 * AUCUN import de three ni du DOM.
 */
import { PROTOCOL_VERSION, SIM_SPEEDS, type SimSpeed } from './constants';
import type { AssetCatalog } from './catalog';
import {
  ROAD_TYPES,
  type BuildingRecord,
  type CommandError,
  type NewGameParams,
  type RoadEdgeRecord,
  type RoadNodeRecord,
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
    args: { type: RoadTypeId; points: number[]; dryRun?: boolean };
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
}

export interface LogMessage {
  kind: 'log';
  level: 'info' | 'warn' | 'error';
  message: string;
}

export type WorkerToMain = ReadyMessage | ResultMessage | SnapshotMessage | DeltaMessage | LogMessage;

/** Liste des buffers à transférer pour un message worker -> main. */
export function collectTransferables(msg: WorkerToMain): Transferable[] {
  if (msg.kind === 'snapshot') return [msg.terrain.heights.buffer as ArrayBuffer];
  if (msg.kind === 'delta' && msg.vehicles) {
    return [msg.vehicles.positions.buffer as ArrayBuffer, msg.vehicles.assetIndices.buffer as ArrayBuffer];
  }
  return [];
}

/* ------------------------------------------------------------------ */
/* Validation à l'exécution des commandes entrantes (côté worker)       */
/* ------------------------------------------------------------------ */

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
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
      return null;
    case 'buildRoad': {
      if (typeof a.type !== 'string' || !(a.type in ROAD_TYPES)) return bad('Type de route inconnu');
      const p = a.points;
      if (!Array.isArray(p) || p.length < 4 || p.length % 2 !== 0 || !p.every(isNum)) return bad('Tracé de route invalide');
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
