/**
 * CONTRATS partagés : types de données du jeu + interfaces des modules de rendu.
 *
 * Ce fichier ne dépend NI de three NI du DOM : les interfaces de rendu sont
 * exprimées en données neutres (nombres, typed arrays, identifiants) pour pouvoir
 * être réimplémentées telles quelles en C# (Unity) ou C++ (Unreal).
 * Les implémentations Three.js vivent dans src/render/** et src/input/**.
 */
import type { SimSpeed } from './constants';
import type { AssetCatalog } from './catalog';

/* ------------------------------------------------------------------ */
/* Données de jeu                                                       */
/* ------------------------------------------------------------------ */

export type RoadTypeId = 'street' | 'avenue' | 'boulevard';

export interface RoadTypeDef {
  id: RoadTypeId;
  nameFr: string;
  /** Largeur totale chaussée + trottoirs (m). */
  width: number;
  lanesPerDirection: number;
  speedKmh: number;
  costPerMeter: number;
  upkeepPerMeterMonth: number;
}

export const ROAD_TYPES: Record<RoadTypeId, RoadTypeDef> = {
  street: { id: 'street', nameFr: 'Rue', width: 10, lanesPerDirection: 1, speedKmh: 40, costPerMeter: 60, upkeepPerMeterMonth: 0.4 },
  avenue: { id: 'avenue', nameFr: 'Avenue', width: 16, lanesPerDirection: 2, speedKmh: 50, costPerMeter: 140, upkeepPerMeterMonth: 0.9 },
  boulevard: { id: 'boulevard', nameFr: 'Boulevard arboré', width: 24, lanesPerDirection: 3, speedKmh: 60, costPerMeter: 260, upkeepPerMeterMonth: 1.6 },
};

export interface NewGameParams {
  seed: number;
  /** Taille de la carte en chunks par côté (cf. CHUNK_SIZE). */
  mapChunks: number;
  startMoney: number;
  cityName: string;
  /** Si vrai, la simulation pré-construit la ville de démonstration (fournie par le rendu/demo). */
  demo?: boolean;
}

/** Carte de hauteurs : grille (samplesX x samplesZ) de hauteurs en mètres, espacement `spacing`. */
export interface TerrainData {
  samplesX: number;
  samplesZ: number;
  spacing: number;
  /** Origine monde du coin (0,0). La carte va de (originX, originZ) à (originX + (samplesX-1)*spacing, ...). */
  originX: number;
  originZ: number;
  heights: Float32Array;
  waterLevel: number;
}

export interface GameDate {
  /** Minutes écoulées depuis le début de la partie. */
  totalMinutes: number;
  year: number;
  /** 1..12 */
  month: number;
  /** 1..30 (calendrier simplifié de 30 jours/mois) */
  day: number;
  hour: number;
  minute: number;
}

export interface SimStats {
  date: GameDate;
  money: number;
  population: number;
  jobs: number;
  buildings: number;
  roadLengthM: number;
  vehicles: number;
  /** Bilan mensuel prévisionnel (recettes - dépenses), crédits/mois. */
  monthlyBalance: number;
  speed: SimSpeed;
  /** Durée moyenne d'un tick de simulation (ms), mesurée dans le worker. */
  tickMs: number;
}

export interface BuildingRecord {
  id: number;
  assetId: string;
  /** Variante visuelle choisie (index dans asset.variants, -1 = aucune). */
  variant: number;
  /** Centre de l'empreinte (m). */
  x: number;
  z: number;
  /** Altitude du sol retenue (m). */
  y: number;
  /** Rotation en quarts de tour (0..3). */
  rot: number;
}

export interface RoadNodeRecord {
  id: number;
  x: number;
  y: number;
  z: number;
}

export interface RoadEdgeRecord {
  id: number;
  a: number;
  b: number;
  type: RoadTypeId;
  length: number;
}

/** Sauvegarde JSON versionnée (indépendante du moteur). */
export interface SaveFile {
  format: 'aube-urbaine-save';
  version: number;
  savedAt: string;
  params: NewGameParams;
  clock: { totalMinutes: number };
  economy: { money: number };
  buildings: BuildingRecord[];
  roads: { nodes: RoadNodeRecord[]; edges: RoadEdgeRecord[] };
  nextIds: { building: number; roadNode: number; roadEdge: number };
}

/* ------------------------------------------------------------------ */
/* Erreurs de commande                                                  */
/* ------------------------------------------------------------------ */

export type CommandErrorCode =
  | 'NO_GAME'
  | 'INVALID_ARGS'
  | 'UNKNOWN_ASSET'
  | 'OUT_OF_BOUNDS'
  | 'INSUFFICIENT_FUNDS'
  | 'COLLISION'
  | 'TOO_STEEP'
  | 'UNDER_WATER'
  | 'NOT_FOUND'
  | 'BAD_SAVE'
  | 'NOT_IMPLEMENTED';

export interface CommandError {
  code: CommandErrorCode;
  /** Message lisible en français pour l'interface. */
  message: string;
  /** Pour NOT_IMPLEMENTED : phase prévue. */
  phase?: number;
}

/* ------------------------------------------------------------------ */
/* Interfaces des modules de rendu / entrée (neutres vis-à-vis du moteur) */
/* ------------------------------------------------------------------ */

export interface CameraPose {
  /** Point visé au sol (m). */
  targetX: number;
  targetY: number;
  targetZ: number;
  /** Distance caméra -> cible (m), mode aérien. */
  distance: number;
  /** Cap (rad), 0 = regarde vers -Z. */
  yaw: number;
  /** Inclinaison (rad), 0 = horizontal, PI/2 = vue de dessus. */
  pitch: number;
}

export type CameraMode = 'aerial' | 'street';

export interface ICameraController {
  readonly mode: CameraMode;
  setMode(mode: CameraMode): void;
  getPose(): CameraPose;
  setPose(pose: Partial<CameraPose>): void;
  /** Appelé à chaque frame. */
  update(dtSeconds: number): void;
  dispose(): void;
}

export type ToolId = 'select' | 'road' | 'building' | 'bulldoze' | 'terraform';

export interface IToolController {
  readonly activeTool: ToolId;
  setTool(tool: ToolId, options?: { roadType?: RoadTypeId; assetId?: string }): void;
  dispose(): void;
}

export interface IRenderTerrain {
  build(terrain: TerrainData): void;
  /** Hauteur interpolée du terrain (m) ; doit donner le même résultat que la simulation. */
  heightAt(x: number, z: number): number;
  dispose(): void;
}

export interface IRoadRenderer {
  addRoads(nodes: readonly RoadNodeRecord[], edges: readonly RoadEdgeRecord[]): void;
  removeRoadEdges(edgeIds: readonly number[]): void;
  dispose(): void;
}

export interface IBuildingRenderer {
  add(records: readonly BuildingRecord[]): void;
  remove(ids: readonly number[]): void;
  /** Mise à jour des LOD / culling selon la position caméra. Sans allocation. */
  update(cameraX: number, cameraY: number, cameraZ: number): void;
  readonly count: number;
  dispose(): void;
}

export interface IVehicleRenderer {
  /**
   * Positions courantes : `positions` contient count * VEHICLE_STRIDE floats (x, y, z, cap),
   * `assetIndices[i]` est l'index de l'asset véhicule dans le catalogue.
   */
  setVehicles(positions: Float32Array, assetIndices: Uint16Array, count: number): void;
  update(dtSeconds: number): void;
  dispose(): void;
}

/** Bibliothèque d'assets : chargement GLB avec cache, LOD et préparation à l'instancing. */
export interface IAssetLibrary<TModel> {
  readonly catalog: AssetCatalog;
  /** Charge (ou renvoie depuis le cache) le modèle d'un asset pour un LOD donné. */
  load(assetId: string, lod?: number): Promise<TModel>;
  isLoaded(assetId: string, lod?: number): boolean;
  /** Préchargement progressif avec suivi d'avancement (0..1). */
  preload(assetIds: readonly string[], onProgress?: (done: number, total: number) => void): Promise<void>;
  dispose(): void;
}
