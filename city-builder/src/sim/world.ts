/**
 * Simulation : état complet du monde + exécution validée des commandes.
 * Indépendante du transport (testable en Node sans worker). TypeScript pur :
 * AUCUN import de three ni du DOM.
 *
 * Contenu : bâtiments et routes (SoA + index spatiaux par chunk), accès route des bâtiments
 * (façade), horloge + planificateur d'événements, démographie, économie, trafic
 * (TrafficSystem du module trafic), deltas pour le rendu, sauvegarde versionnée (v2).
 */
import {
  CHUNK_SIZE,
  GAME_MINUTES_PER_TICK,
  INITIAL_BUILDING_CAPACITY,
  INITIAL_ROAD_EDGE_CAPACITY,
  INITIAL_ROAD_NODE_CAPACITY,
  INITIAL_VEHICLE_CAPACITY,
  MAX_BUILDING_SLOPE,
  MAX_ROAD_SLOPE,
  TILE_SIZE,
  type SimSpeed,
} from '../shared/constants';
import { buildAssetIndex, isBuildingCategory, type AssetCatalog, type CatalogAsset } from '../shared/catalog';
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
} from '../shared/contracts';
import type { CommandArgs, CommandName, CommandResult, DeltaMessage, SnapshotMessage } from '../shared/protocol';
import { dist2 } from '../shared/math';
import { generateTerrain, terrainBounds, terrainHeightAt } from '../shared/terrain-gen';
import { GameClock, MINUTES_PER_DAY, MINUTES_PER_MONTH, MINUTES_PER_YEAR, formatDateFr } from './clock';
import { DEMOLISH_REFUND_RATE, Economy, roadCost, roadUpkeep } from './economy';
import { BuildingStore, ChunkIndex, RoadGraph, VehicleStore } from './ecs';
import { DemographySystem, ROAD_ACCESS_MARGIN_M } from './demography';
import { TrafficSystem, inputFromRoadGraph, buildingsFromStore } from './traffic';
import { ROAD_TYPE_ORDER } from './pathfinding';
import { Rng } from './rng';
import { EventScheduler, SimEvent } from './scheduler';
import { CURRENT_SAVE_VERSION, SAVE_FORMAT_ID, validateSave, type SaveFileV2 } from './save-format';
import type { ExtCommandArgs, ExtCommandName, ExtCommandResult, SimNotice, SimReport } from './sim-protocol';

export type CmdOutcome<K extends CommandName> = { ok: true; data: CommandResult<K> } | { ok: false; error: CommandError };
export type ExtOutcome<K extends ExtCommandName> = { ok: true; data: ExtCommandResult<K> } | { ok: false; error: CommandError };

const fail = (code: CommandError['code'], message: string, phase?: number): { ok: false; error: CommandError } =>
  ({ ok: false, error: phase === undefined ? { code, message } : { code, message, phase } });

/** Demi-largeur maximale d'une route (m) : marge des requêtes spatiales. */
const MAX_ROAD_HALF_WIDTH = Math.max(...Object.values(ROAD_TYPES).map((t) => t.width / 2));
/** Trajets individuels transmis au trafic au plus par tick. */
const TRIPS_PER_TICK = 8;
const MAX_NOTICES = 30;

/** Distance d'un point à un segment. */
function distPointSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return dist2(px, pz, ax + dx * t, az + dz * t);
}

/** Distance exacte d'un segment à un rectangle aligné sur les axes (0 si intersection). */
export function distSegmentRect(ax: number, az: number, bx: number, bz: number, minX: number, minZ: number, maxX: number, maxZ: number): number {
  const inside = (x: number, z: number): boolean => x >= minX && x <= maxX && z >= minZ && z <= maxZ;
  if (inside(ax, az) || inside(bx, bz)) return 0;
  // Intersection avec un des 4 côtés ?
  const cross = (x1: number, z1: number, x2: number, z2: number): boolean => {
    const d = (bx - ax) * (z2 - z1) - (bz - az) * (x2 - x1);
    if (d === 0) return false;
    const t = ((x1 - ax) * (z2 - z1) - (z1 - az) * (x2 - x1)) / d;
    const u = ((x1 - ax) * (bz - az) - (z1 - az) * (bx - ax)) / d;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
  };
  if (cross(minX, minZ, maxX, minZ) || cross(maxX, minZ, maxX, maxZ) || cross(maxX, maxZ, minX, maxZ) || cross(minX, maxZ, minX, minZ)) return 0;
  const clampD = (px: number, pz: number): number => {
    const cx = px < minX ? minX : px > maxX ? maxX : px;
    const cz = pz < minZ ? minZ : pz > maxZ ? maxZ : pz;
    return dist2(px, pz, cx, cz);
  };
  return Math.min(clampD(ax, az), clampD(bx, bz),
    distPointSegment(minX, minZ, ax, az, bx, bz), distPointSegment(maxX, minZ, ax, az, bx, bz),
    distPointSegment(minX, maxZ, ax, az, bx, bz), distPointSegment(maxX, maxZ, ax, az, bx, bz));
}

export class Simulation {
  catalog: AssetCatalog | null = null;
  private assetIndex = new Map<string, number>();
  params: NewGameParams | null = null;
  terrain: TerrainData | null = null;
  readonly clock = new GameClock();
  readonly economy = new Economy();
  readonly buildings = new BuildingStore(INITIAL_BUILDING_CAPACITY);
  readonly roads = new RoadGraph(INITIAL_ROAD_NODE_CAPACITY, INITIAL_ROAD_EDGE_CAPACITY);
  /** Conservé pour compatibilité ; les véhicules sont gérés par `traffic`. */
  readonly vehicles = new VehicleStore(INITIAL_VEHICLE_CAPACITY);
  readonly scheduler = new EventScheduler();
  readonly rng = new Rng(1);
  readonly traffic = new TrafficSystem({ seed: 1, maxVehicles: 3000 });
  demography: DemographySystem | null = null;
  speed: SimSpeed = 1;
  tickCount = 0;
  tickMs = 0;

  /** Index spatiaux par chunk (bâtiments : empreinte ; tronçons : boîte + demi-largeur ; nœuds : point). */
  buildingIndex = new ChunkIndex(0, 0, CHUNK_SIZE, CHUNK_SIZE);
  private edgeIndex = new ChunkIndex(0, 0, CHUNK_SIZE, CHUNK_SIZE);
  private nodeIndex = new ChunkIndex(0, 0, CHUNK_SIZE, CHUNK_SIZE);
  private readonly q: number[] = [];
  private readonly q2: number[] = [];

  /** Occupation des cases : 0 = libre, sinon id du bâtiment. */
  private occupancy = new Int32Array(0);
  private tilesPerSide = 0;
  private nextBuildingId = 1;
  private nextNodeId = 1;
  private nextEdgeId = 1;
  private roadLength = 0;
  private edgeTypeById = new Map<number, RoadTypeId>();
  private trafficBuildingsDirty = true;
  private tripsToTraffic = 0;
  private jobsCache = 0;
  private jobsDirty = true;
  readonly notices: SimNotice[] = [];

  // Deltas en attente (vidés par takeDelta).
  private pendingBuildingsAdded: BuildingRecord[] = [];
  private pendingBuildingsRemoved: number[] = [];
  private pendingNodesAdded: RoadNodeRecord[] = [];
  private pendingEdgesAdded: RoadEdgeRecord[] = [];
  private pendingEdgesRemoved: number[] = [];

  private readonly stats: SimStats = {
    date: { totalMinutes: 0, year: 1, month: 1, day: 1, hour: 0, minute: 0 },
    money: 0, population: 0, jobs: 0, buildings: 0, roadLengthM: 0, vehicles: 0, monthlyBalance: 0, speed: 1, tickMs: 0,
  };

  setCatalog(cat: AssetCatalog): void {
    this.catalog = cat;
    this.assetIndex = buildAssetIndex(cat);
    this.traffic.setCatalog(cat);
    const ctx = { catalog: cat, buildings: this.buildings, buildingIndex: this.buildingIndex, rng: this.rng };
    if (this.demography) this.demography.setContext(ctx);
    else { this.demography = new DemographySystem(ctx); this.demography.setContext(ctx); }
  }

  getAsset(id: string): CatalogAsset | undefined {
    const i = this.assetIndex.get(id);
    return i === undefined ? undefined : this.catalog?.assets[i];
  }

  private get demo(): DemographySystem {
    if (!this.demography) throw new Error('Catalogue non initialisé');
    return this.demography;
  }

  newGame(p: NewGameParams): void {
    this.params = { ...p };
    this.terrain = generateTerrain(p.seed, p.mapChunks);
    this.tilesPerSide = this.terrain.samplesX - 1;
    this.occupancy = new Int32Array(this.tilesPerSide * this.tilesPerSide);
    const size = this.tilesPerSide * TILE_SIZE;
    this.buildingIndex = new ChunkIndex(this.terrain.originX, this.terrain.originZ, size, CHUNK_SIZE);
    this.edgeIndex = new ChunkIndex(this.terrain.originX, this.terrain.originZ, size, CHUNK_SIZE);
    this.nodeIndex = new ChunkIndex(this.terrain.originX, this.terrain.originZ, size, CHUNK_SIZE);
    if (this.catalog) this.setCatalog(this.catalog);
    this.clock.totalMinutes = 0;
    this.economy.reset(p.startMoney);
    this.buildings.clear();
    this.roads.clear();
    this.vehicles.clear();
    this.edgeTypeById.clear();
    this.roadLength = 0;
    this.nextBuildingId = 1;
    this.nextNodeId = 1;
    this.nextEdgeId = 1;
    this.tickCount = 0;
    this.rng.setState(new Rng((p.seed ^ 0x5bd1e995) >>> 0).getState());
    this.demography?.reset();
    this.notices.length = 0;
    this.tripsToTraffic = 0;
    this.jobsDirty = true;
    this.scheduleRecurring();
    this.traffic.clear();
    this.traffic.setNetwork(inputFromRoadGraph(this.roads));
    this.trafficBuildingsDirty = true;
    this.clearPending();
  }

  /** Événements récurrents de base (planifiés au démarrage d'une partie). */
  private scheduleRecurring(): void {
    this.scheduler.clear();
    const t = this.clock.totalMinutes;
    const next = (period: number, offset = 0): number => Math.floor((t - offset) / period) * period + period + offset;
    this.scheduler.schedule(next(MINUTES_PER_DAY), SimEvent.DayStart, 0, 0, MINUTES_PER_DAY);
    this.scheduler.schedule(next(MINUTES_PER_MONTH), SimEvent.MonthStart, 0, 0, MINUTES_PER_MONTH);
    this.scheduler.schedule(next(MINUTES_PER_YEAR), SimEvent.YearStart, 0, 0, MINUTES_PER_YEAR);
    this.scheduler.schedule(next(360, 60), SimEvent.Migration, 0, 0, 360);
    this.scheduler.schedule(next(60, 30), SimEvent.TrafficSync, 0, 0, 60);
  }

  private clearPending(): void {
    this.pendingBuildingsAdded.length = 0;
    this.pendingBuildingsRemoved.length = 0;
    this.pendingNodesAdded.length = 0;
    this.pendingEdgesAdded.length = 0;
    this.pendingEdgesRemoved.length = 0;
  }

  notify(level: SimNotice['level'], message: string): void {
    this.notices.push({ minute: this.clock.totalMinutes, level, message });
    if (this.notices.length > MAX_NOTICES) this.notices.splice(0, this.notices.length - MAX_NOTICES);
  }

  /* ---------------------------- Bâtiments ---------------------------- */

  /** Calcule l'empreinte alignée sur la grille pour un placement demandé. */
  footprintFor(asset: CatalogAsset, x: number, z: number, rot: number): { cx: number; cz: number; tx: number; tz: number; i0: number; j0: number } {
    const r = ((Math.round(rot) % 4) + 4) % 4;
    const tx = r % 2 === 0 ? asset.footprint.tilesX : asset.footprint.tilesZ;
    const tz = r % 2 === 0 ? asset.footprint.tilesZ : asset.footprint.tilesX;
    const t = this.terrain!;
    const i0 = Math.round((x - t.originX) / TILE_SIZE - tx / 2);
    const j0 = Math.round((z - t.originZ) / TILE_SIZE - tz / 2);
    return { cx: t.originX + (i0 + tx / 2) * TILE_SIZE, cz: t.originZ + (j0 + tz / 2) * TILE_SIZE, tx, tz, i0, j0 };
  }

  private edgeEndpoints(edgeId: number): [number, number, number, number] | null {
    const e = this.roads.edgeIndex(edgeId);
    if (e < 0) return null;
    const na = this.roads.nodeIndex(this.roads.edgeA[e]!);
    const nb = this.roads.nodeIndex(this.roads.edgeB[e]!);
    if (na < 0 || nb < 0) return null;
    return [this.roads.nodeX[na]!, this.roads.nodeZ[na]!, this.roads.nodeX[nb]!, this.roads.nodeZ[nb]!];
  }

  /** Plus petite marge (distance - demi-largeur) entre un rectangle et les routes voisines. */
  private roadClearance(minX: number, minZ: number, maxX: number, maxZ: number, reach: number): number {
    let best = Infinity;
    this.edgeIndex.query(minX - reach, minZ - reach, maxX + reach, maxZ + reach, this.q2);
    for (const id of this.q2) {
      const p = this.edgeEndpoints(id);
      if (!p) continue;
      const half = ROAD_TYPES[this.edgeTypeById.get(id) ?? 'street'].width / 2;
      const d = distSegmentRect(p[0], p[1], p[2], p[3], minX, minZ, maxX, maxZ) - half;
      if (d < best) best = d;
    }
    return best;
  }

  placeBuilding(a: CommandArgs<'placeBuilding'>): CmdOutcome<'placeBuilding'> {
    if (!this.terrain) return fail('NO_GAME', 'Aucune partie en cours');
    const asset = this.getAsset(a.assetId);
    if (!asset) return fail('UNKNOWN_ASSET', `Modèle inconnu : ${a.assetId}`);
    if (!isBuildingCategory(asset.category)) return fail('INVALID_ARGS', `${asset.nameFr} n'est pas un bâtiment`);
    const rot = ((Math.round(a.rot) % 4) + 4) % 4;
    const variant = a.variant ?? -1;
    if (variant >= asset.variants.length || variant < -1 || !Number.isInteger(variant)) return fail('INVALID_ARGS', 'Variante inexistante');
    const f = this.footprintFor(asset, a.x, a.z, rot);
    if (f.i0 < 0 || f.j0 < 0 || f.i0 + f.tx > this.tilesPerSide || f.j0 + f.tz > this.tilesPerSide) {
      return fail('OUT_OF_BOUNDS', 'Emplacement hors de la carte');
    }
    for (let j = f.j0; j < f.j0 + f.tz; j++) {
      for (let i = f.i0; i < f.i0 + f.tx; i++) {
        if (this.occupancy[j * this.tilesPerSide + i] !== 0) return fail('COLLISION', 'Emplacement déjà occupé par un bâtiment');
      }
    }
    const t = this.terrain;
    const minX = t.originX + f.i0 * TILE_SIZE;
    const minZ = t.originZ + f.j0 * TILE_SIZE;
    const maxX = minX + f.tx * TILE_SIZE;
    const maxZ = minZ + f.tz * TILE_SIZE;
    if (this.roadClearance(minX, minZ, maxX, maxZ, MAX_ROAD_HALF_WIDTH) < 0) return fail('COLLISION', 'Le bâtiment empiète sur une route');
    let hMin = Infinity;
    let hMax = -Infinity;
    let hSum = 0;
    let n = 0;
    for (let j = 0; j <= f.tz; j++) {
      for (let i = 0; i <= f.tx; i++) {
        const h = terrainHeightAt(t, minX + i * TILE_SIZE, minZ + j * TILE_SIZE);
        if (h < hMin) hMin = h;
        if (h > hMax) hMax = h;
        hSum += h;
        n++;
      }
    }
    if (hMin < t.waterLevel + 0.3) return fail('UNDER_WATER', 'Impossible de construire dans l\'eau');
    const span = Math.max(f.tx, f.tz) * TILE_SIZE;
    if ((hMax - hMin) / span > MAX_BUILDING_SLOPE) return fail('TOO_STEEP', 'Terrain trop pentu pour ce bâtiment');
    if (this.economy.bankrupt) return fail('INSUFFICIENT_FUNDS', 'Ville en faillite : constructions suspendues jusqu\'au retour d\'une trésorerie positive');
    if (!this.economy.canAfford(asset.cost)) return fail('INSUFFICIENT_FUNDS', `Fonds insuffisants (${asset.cost} crédits requis)`);
    if (a.dryRun) return { ok: true, data: { buildingId: 0, cost: asset.cost } };

    const id = this.nextBuildingId++;
    const y = hSum / n;
    this.insertBuilding({ id, assetId: asset.id, variant, x: f.cx, z: f.cz, y, rot });
    this.economy.spend(asset.cost);
    return { ok: true, data: { buildingId: id, cost: asset.cost } };
  }

  /** Insertion sans contrôle ni coût (utilisée par placeBuilding et le chargement). */
  private insertBuilding(r: BuildingRecord, silent = false): void {
    const asset = this.getAsset(r.assetId)!;
    const f = this.footprintFor(asset, r.x, r.z, r.rot);
    for (let j = f.j0; j < f.j0 + f.tz; j++) {
      for (let i = f.i0; i < f.i0 + f.tx; i++) this.occupancy[j * this.tilesPerSide + i] = r.id;
    }
    const bi = this.buildings.add(r.id, this.assetIndex.get(asset.id)!, r.variant, r.x, r.y, r.z, r.rot, f.tx, f.tz);
    const hx = (f.tx * TILE_SIZE) / 2, hz = (f.tz * TILE_SIZE) / 2;
    this.buildingIndex.insert(r.id, r.x - hx, r.z - hz, r.x + hx, r.z + hz);
    this.buildings.roadAccess[bi] = this.computeRoadAccess(bi) ? 1 : 0;
    this.economy.addUpkeep(asset.upkeepPerMonth, 'buildings');
    this.demography?.onBuildingAdded(r.id, this.clock.totalMinutes);
    this.trafficBuildingsDirty = true;
    this.jobsDirty = true;
    if (!silent) this.pendingBuildingsAdded.push({ ...r });
  }

  /** Accès route : une route passe à moins de ROAD_ACCESS_MARGIN_M de l'empreinte. */
  private computeRoadAccess(bi: number): boolean {
    const b = this.buildings;
    const hx = (b.tilesX[bi]! * TILE_SIZE) / 2, hz = (b.tilesZ[bi]! * TILE_SIZE) / 2;
    const x = b.x[bi]!, z = b.z[bi]!;
    return this.roadClearance(x - hx, z - hz, x + hx, z + hz, MAX_ROAD_HALF_WIDTH + ROAD_ACCESS_MARGIN_M) <= ROAD_ACCESS_MARGIN_M;
  }

  /** Recalcule l'accès route des bâtiments proches d'une zone (après ajout/suppression de route). */
  private refreshRoadAccessNear(minX: number, minZ: number, maxX: number, maxZ: number): void {
    const m = MAX_ROAD_HALF_WIDTH + ROAD_ACCESS_MARGIN_M;
    this.buildingIndex.query(minX - m, minZ - m, maxX + m, maxZ + m, this.q);
    let changed = false;
    for (const id of this.q) {
      const bi = this.buildings.indexOf(id);
      if (bi < 0) continue;
      const v = this.computeRoadAccess(bi) ? 1 : 0;
      if (v !== this.buildings.roadAccess[bi]) { this.buildings.roadAccess[bi] = v; changed = true; }
    }
    if (changed) { this.demography?.markCoverageDirty(); this.trafficBuildingsDirty = true; this.jobsDirty = true; }
  }

  demolish(a: CommandArgs<'demolish'>): CmdOutcome<'demolish'> {
    if (!this.terrain) return fail('NO_GAME', 'Aucune partie en cours');
    const i = this.buildings.indexOf(a.buildingId);
    if (i < 0) return fail('NOT_FOUND', 'Bâtiment introuvable');
    const asset = this.catalog!.assets[this.buildings.assetIndex[i]!]!;
    const f = this.footprintFor(asset, this.buildings.x[i]!, this.buildings.z[i]!, this.buildings.rot[i]!);
    for (let j = f.j0; j < f.j0 + f.tz; j++) {
      for (let k = f.i0; k < f.i0 + f.tx; k++) this.occupancy[j * this.tilesPerSide + k] = 0;
    }
    const displaced = this.buildings.residents[i]!;
    this.demography?.onBuildingRemoved(a.buildingId, this.clock.totalMinutes);
    this.buildings.remove(a.buildingId);
    this.buildingIndex.remove(a.buildingId);
    this.economy.removeUpkeep(asset.upkeepPerMonth, 'buildings');
    const refund = Math.round(asset.cost * DEMOLISH_REFUND_RATE);
    this.economy.refund(refund);
    this.pendingBuildingsRemoved.push(a.buildingId);
    this.trafficBuildingsDirty = true;
    this.jobsDirty = true;
    if (displaced > 0) this.notify('warn', `${asset.nameFr} démoli : ${displaced} habitant(s) relogé(s) ou partis`);
    return { ok: true, data: { refund } };
  }

  /* ------------------------------ Routes ------------------------------ */

  private findNodeNear(x: number, z: number, radius: number): number {
    let best = -1;
    let bestD = radius;
    this.nodeIndex.query(x - radius, z - radius, x + radius, z + radius, this.q);
    for (const id of this.q) {
      const i = this.roads.nodeIndex(id);
      if (i < 0) continue;
      const d = dist2(x, z, this.roads.nodeX[i]!, this.roads.nodeZ[i]!);
      if (d <= bestD) { bestD = d; best = id; }
    }
    return best;
  }

  buildRoad(a: CommandArgs<'buildRoad'>): CmdOutcome<'buildRoad'> {
    if (!this.terrain) return fail('NO_GAME', 'Aucune partie en cours');
    const t = this.terrain;
    const def = ROAD_TYPES[a.type];
    const b = terrainBounds(t);
    const pts = a.points;
    let total = 0;
    const segs: [number, number, number, number][] = [];
    for (let k = 0; k + 3 < pts.length; k += 2) {
      const ax = pts[k]!, az = pts[k + 1]!, bx = pts[k + 2]!, bz = pts[k + 3]!;
      const len = dist2(ax, az, bx, bz);
      if (len < 4) continue;
      for (const [px, pz] of [[ax, az], [bx, bz]] as const) {
        if (px < b.minX + def.width || pz < b.minZ + def.width || px > b.maxX - def.width || pz > b.maxZ - def.width) {
          return fail('OUT_OF_BOUNDS', 'Tracé hors de la carte');
        }
      }
      const ha = terrainHeightAt(t, ax, az);
      const hb = terrainHeightAt(t, bx, bz);
      if (Math.abs(hb - ha) / len > MAX_ROAD_SLOPE) return fail('TOO_STEEP', 'Pente trop forte pour une route');
      const steps = Math.ceil(len / 4);
      for (let s = 0; s <= steps; s++) {
        const h = terrainHeightAt(t, ax + ((bx - ax) * s) / steps, az + ((bz - az) * s) / steps);
        if (h < t.waterLevel + 0.2) return fail('UNDER_WATER', 'Les ponts arrivent en phase 3', 3);
      }
      const half = def.width / 2;
      this.buildingIndex.query(Math.min(ax, bx) - half, Math.min(az, bz) - half, Math.max(ax, bx) + half, Math.max(az, bz) + half, this.q);
      for (const id of this.q) {
        const i = this.buildings.indexOf(id);
        if (i < 0) continue;
        const hx = (this.buildings.tilesX[i]! * TILE_SIZE) / 2;
        const hz = (this.buildings.tilesZ[i]! * TILE_SIZE) / 2;
        const cx = this.buildings.x[i]!;
        const cz = this.buildings.z[i]!;
        if (distSegmentRect(ax, az, bx, bz, cx - hx, cz - hz, cx + hx, cz + hz) < half) {
          return fail('COLLISION', 'Le tracé traverse un bâtiment');
        }
      }
      segs.push([ax, az, bx, bz]);
      total += len;
    }
    if (segs.length === 0) return fail('INVALID_ARGS', 'Tracé trop court (4 m minimum)');
    const cost = roadCost(a.type, total);
    if (this.economy.bankrupt) return fail('INSUFFICIENT_FUNDS', 'Ville en faillite : constructions suspendues jusqu\'au retour d\'une trésorerie positive');
    if (!this.economy.canAfford(cost)) return fail('INSUFFICIENT_FUNDS', `Fonds insuffisants (${cost} crédits requis)`);
    if (a.dryRun) return { ok: true, data: { edgeIds: [], cost } };

    const edgeIds: number[] = [];
    const typeIdx = ROAD_TYPE_ORDER.indexOf(a.type);
    const snap = Math.min(4, def.width / 2);
    const nodeAt = (x: number, z: number): number => {
      const existing = this.findNodeNear(x, z, snap);
      if (existing >= 0) return existing;
      const id = this.nextNodeId++;
      const y = terrainHeightAt(t, x, z);
      this.insertNode({ id, x, y, z });
      this.pendingNodesAdded.push({ id, x, y, z });
      return id;
    };
    for (const [ax, az, bx, bz] of segs) {
      const na = nodeAt(ax, az);
      const nb = nodeAt(bx, bz);
      if (na === nb) continue;
      const len = dist2(ax, az, bx, bz);
      const id = this.nextEdgeId++;
      this.insertEdge({ id, a: na, b: nb, type: a.type, length: len }, typeIdx);
      edgeIds.push(id);
    }
    this.economy.spend(cost);
    this.traffic.setNetwork(inputFromRoadGraph(this.roads));
    return { ok: true, data: { edgeIds, cost } };
  }

  private insertNode(n: RoadNodeRecord): void {
    this.roads.addNode(n.id, n.x, n.y, n.z);
    this.nodeIndex.insert(n.id, n.x, n.z, n.x, n.z);
  }

  private insertEdge(e: RoadEdgeRecord, typeIdx: number, silent = false): void {
    this.roads.addEdge(e.id, e.a, e.b, typeIdx, e.length);
    this.edgeTypeById.set(e.id, e.type);
    this.roadLength += e.length;
    this.economy.addUpkeep(roadUpkeep(e.type, e.length), 'roads');
    const p = this.edgeEndpoints(e.id);
    if (p) {
      const half = ROAD_TYPES[e.type].width / 2;
      const minX = Math.min(p[0], p[2]) - half, minZ = Math.min(p[1], p[3]) - half;
      const maxX = Math.max(p[0], p[2]) + half, maxZ = Math.max(p[1], p[3]) + half;
      this.edgeIndex.insert(e.id, minX, minZ, maxX, maxZ);
      if (!silent) this.refreshRoadAccessNear(minX, minZ, maxX, maxZ);
    }
    if (!silent) this.pendingEdgesAdded.push({ ...e });
  }

  removeRoad(a: CommandArgs<'removeRoad'>): CmdOutcome<'removeRoad'> {
    if (!this.terrain) return fail('NO_GAME', 'Aucune partie en cours');
    const ei = this.roads.edgeIndex(a.edgeId);
    if (ei < 0) return fail('NOT_FOUND', 'Tronçon introuvable');
    const type = this.edgeTypeById.get(a.edgeId) ?? 'street';
    const len = this.roads.edgeLength[ei]!;
    const p = this.edgeEndpoints(a.edgeId);
    const orphans = this.roads.removeEdge(a.edgeId);
    for (const n of orphans) this.nodeIndex.remove(n);
    this.edgeIndex.remove(a.edgeId);
    this.edgeTypeById.delete(a.edgeId);
    this.roadLength -= len;
    this.economy.removeUpkeep(roadUpkeep(type, len), 'roads');
    const refund = Math.round(roadCost(type, len) * DEMOLISH_REFUND_RATE);
    this.economy.refund(refund);
    this.pendingEdgesRemoved.push(a.edgeId);
    if (p) this.refreshRoadAccessNear(Math.min(p[0], p[2]), Math.min(p[1], p[3]), Math.max(p[0], p[2]), Math.max(p[1], p[3]));
    this.traffic.setNetwork(inputFromRoadGraph(this.roads));
    return { ok: true, data: { refund } };
  }

  /* ------------------------------ Tick ------------------------------ */

  private readonly onEvent = (type: number): void => {
    const now = this.clock.totalMinutes;
    const demo = this.demography;
    switch (type) {
      case SimEvent.DayStart:
        if (demo) {
          demo.daily(now, this.economy.taxRates.residential);
          const tb = demo.computeTaxBase(false);
          Object.assign(this.economy.taxBase, tb.taxBase);
          this.economy.serviceWorkers = tb.serviceWorkers;
          this.trafficBuildingsDirty = true;
        }
        break;
      case SimEvent.Migration:
        if (demo) {
          const n = demo.migrationWave(now, this.economy.taxRates.residential);
          if (n > 0) { demo.updateLod(); this.trafficBuildingsDirty = true; }
        }
        break;
      case SimEvent.MonthStart: {
        let ctx = { monthIndex: this.clock.monthIndex - 1, population: 0, jobs: 0, unemploymentRate: 0, happiness: 0 };
        if (demo) {
          const tb = demo.monthly(now);
          Object.assign(this.economy.taxBase, tb.taxBase);
          this.economy.serviceWorkers = tb.serviceWorkers;
          const r = demo.report(now, this.economy.taxRates.residential);
          ctx = { ...ctx, population: r.population, jobs: r.jobsTotal, unemploymentRate: r.unemploymentRate, happiness: r.happiness };
        }
        const wasBankrupt = this.economy.bankrupt;
        const rec = this.economy.onMonth(ctx);
        if (this.economy.bankrupt && !wasBankrupt) this.notify('danger', 'Faillite : trésorerie négative depuis trois mois. Constructions et emprunts suspendus.');
        else if (!this.economy.bankrupt && wasBankrupt) this.notify('info', 'Sortie de faillite : la trésorerie est redevenue positive.');
        else if (this.economy.monthsInDeficit > 0) this.notify('warn', `Trésorerie négative (${rec.moneyEnd} crédits) : faillite dans ${3 - this.economy.monthsInDeficit} mois sans redressement.`);
        break;
      }
      case SimEvent.YearStart:
        if (demo) {
          const r = demo.report(now, this.economy.taxRates.residential);
          this.notify('info', `Nouvelle année : ${r.population} habitants, chômage ${(r.unemploymentRate * 100).toFixed(1)} %.`);
        }
        break;
      case SimEvent.TrafficSync:
        if (this.trafficBuildingsDirty && this.catalog) {
          this.trafficBuildingsDirty = false;
          const list = buildingsFromStore(this.buildings, this.catalog);
          for (let i = 0; i < list.length; i++) {
            // Le trafic voit les occupants RÉELS (pas les capacités) : pas d'habitants, pas de voitures.
            list[i]!.residents = this.buildings.residents[i]!;
            list[i]!.jobs = this.buildings.workers[i]!;
          }
          this.traffic.setBuildings(list);
          if (demo) {
            const pop = Math.max(1, demo.population);
            let detailed = 0;
            const lod = demo.citizens.col.lod;
            for (let i = 0; i < demo.citizens.count; i++) if (lod[i] === 0) detailed++;
            // La demande statistique du trafic couvre les citoyens non détaillés ; les détaillés émettent leurs trajets.
            this.traffic.demandScale = Math.max(0, 1 - detailed / pop);
          }
        }
        break;
    }
  };

  tick(): void {
    if (!this.terrain) return;
    this.clock.advance(GAME_MINUTES_PER_TICK);
    const now = this.clock.totalMinutes;
    this.scheduler.runDue(now, this.onEvent);
    const demo = this.demography;
    if (demo) {
      demo.tick(now);
      demo.drainTrips(TRIPS_PER_TICK, this.sendTrip);
    }
    this.traffic.step(0.1, this.clock.hourOfDay);
    this.tickCount++;
  }

  private readonly sendTrip = (_citizen: number, from: number, to: number): void => {
    const a = this.traffic.accessIndexOf(from);
    const b = this.traffic.accessIndexOf(to);
    if (a >= 0 && b >= 0 && this.traffic.spawnTrip(a, b, 'prive') >= 0) this.tripsToTraffic++;
  };

  private jobsTotal(): number {
    if (!this.jobsDirty || !this.catalog) return this.jobsCache;
    let s = 0;
    for (let i = 0; i < this.buildings.count; i++) {
      if (this.buildings.roadAccess[i]) s += Math.max(0, this.catalog.assets[this.buildings.assetIndex[i]!]?.capacity.jobs ?? 0);
    }
    this.jobsCache = s;
    this.jobsDirty = false;
    return s;
  }

  getStats(): SimStats {
    const s = this.stats;
    this.clock.toDate(s.date);
    s.money = Math.round(this.economy.money);
    s.population = this.demography?.population ?? 0;
    s.jobs = this.jobsTotal();
    s.buildings = this.buildings.count;
    s.roadLengthM = Math.round(this.roadLength);
    s.vehicles = this.traffic.actCount;
    s.monthlyBalance = Math.round(this.economy.monthlyBalance);
    s.speed = this.speed;
    s.tickMs = this.tickMs;
    return s;
  }

  hasPendingChanges(): boolean {
    return this.pendingBuildingsAdded.length + this.pendingBuildingsRemoved.length + this.pendingNodesAdded.length
      + this.pendingEdgesAdded.length + this.pendingEdgesRemoved.length > 0;
  }

  /** Construit le message delta et vide les files d'attente. Les buffers véhicules sont neufs (ils seront transférés). */
  takeDelta(): DeltaMessage {
    const vehicles: DeltaMessage['vehicles'] = this.traffic.actCount > 0 ? this.traffic.takeFrame() : null;
    const msg: DeltaMessage = {
      kind: 'delta',
      tick: this.tickCount,
      buildingsAdded: this.pendingBuildingsAdded.splice(0),
      buildingsRemoved: this.pendingBuildingsRemoved.splice(0),
      roadNodesAdded: this.pendingNodesAdded.splice(0),
      roadEdgesAdded: this.pendingEdgesAdded.splice(0),
      roadEdgesRemoved: this.pendingEdgesRemoved.splice(0),
      vehicles,
      stats: { ...this.getStats(), date: { ...this.stats.date } },
    };
    return msg;
  }

  /** Instantané complet ; la carte de hauteurs est COPIÉE (la copie sera transférée). */
  snapshot(): SnapshotMessage {
    const t = this.terrain!;
    this.clearPending();
    return {
      kind: 'snapshot',
      params: { ...this.params! },
      terrain: { ...t, heights: new Float32Array(t.heights) },
      buildings: this.buildingRecords(),
      roads: this.roadRecords(),
      stats: { ...this.getStats(), date: { ...this.stats.date } },
    };
  }

  buildingRecords(): BuildingRecord[] {
    const b = this.buildings;
    const out: BuildingRecord[] = [];
    for (let i = 0; i < b.count; i++) {
      out.push({ id: b.id[i]!, assetId: this.catalog!.assets[b.assetIndex[i]!]!.id, variant: b.variant[i]!, x: b.x[i]!, y: b.y[i]!, z: b.z[i]!, rot: b.rot[i]! });
    }
    return out;
  }

  roadRecords(): { nodes: RoadNodeRecord[]; edges: RoadEdgeRecord[] } {
    const r = this.roads;
    const nodes: RoadNodeRecord[] = [];
    const edges: RoadEdgeRecord[] = [];
    for (let i = 0; i < r.nodeCount; i++) nodes.push({ id: r.nodeId[i]!, x: r.nodeX[i]!, y: r.nodeY[i]!, z: r.nodeZ[i]! });
    for (let i = 0; i < r.edgeCount; i++) {
      const id = r.edgeId[i]!;
      edges.push({ id, a: r.edgeA[i]!, b: r.edgeB[i]!, type: this.edgeTypeById.get(id) ?? 'street', length: r.edgeLength[i]! });
    }
    return { nodes, edges };
  }

  /* --------------------------- Commandes étendues --------------------------- */

  report(fullHistory = false): SimReport {
    const now = this.clock.totalMinutes;
    const date = { totalMinutes: 0, year: 1, month: 1, day: 1, hour: 0, minute: 0 };
    this.clock.toDate(date);
    const e = this.economy;
    const ts = this.traffic.stats;
    const demography = this.demo.report(now, e.taxRates.residential);
    return {
      date, season: this.clock.season, weekday: this.clock.weekday, dateFr: formatDateFr(date),
      economy: {
        money: Math.round(e.money), taxRates: { ...e.taxRates }, forecast: e.forecast(), loans: e.loans.map((l) => ({ ...l })),
        debt: Math.round(e.debt()), loanCapacity: Math.floor(e.loanCapacity()), currentLoanRate: e.currentLoanRate(),
        monthsInDeficit: e.monthsInDeficit, bankrupt: e.bankrupt,
        history: (fullHistory ? e.history : e.history.slice(-24)).map((h) => ({ ...h, income: { ...h.income }, expenses: { ...h.expenses } })),
      },
      demography,
      traffic: { vehicles: this.traffic.actCount, meanSpeedKmh: ts.meanSpeedKmh, arrived: ts.arrived, connectedBuildings: ts.connectedBuildings, tripsFromCitizens: this.tripsToTraffic },
      notices: this.notices.slice(),
    };
  }

  runExt<K extends ExtCommandName>(name: K, args: ExtCommandArgs<K>): ExtOutcome<K> {
    const ok = <T>(data: T): { ok: true; data: T } => ({ ok: true, data });
    if (!this.terrain) return fail('NO_GAME', 'Aucune partie en cours');
    const now = this.clock.totalMinutes;
    const e = this.economy;
    const out = ((): ExtOutcome<ExtCommandName> => {
      switch (name) {
        case 'setTaxRate': {
          const a = args as ExtCommandArgs<'setTaxRate'>;
          const rate = e.setTaxRate(a.sector, a.rate);
          return ok({ sector: a.sector, rate });
        }
        case 'loanOffer': {
          const a = args as ExtCommandArgs<'loanOffer'>;
          const o = e.loanOffer(a.amount, a.months);
          return 'error' in o ? fail('INVALID_ARGS', o.error) : ok(o);
        }
        case 'takeLoan': {
          const a = args as ExtCommandArgs<'takeLoan'>;
          const l = e.takeLoan(a.amount, a.months, now);
          if ('error' in l) return fail('INVALID_ARGS', l.error);
          this.notify('info', `Emprunt de ${l.principal} crédits sur ${l.months} mois à ${(l.annualRate * 100).toFixed(2)} % (mensualité ${Math.round(l.monthlyPayment)}).`);
          return ok({ loan: { ...l }, money: Math.round(e.money) });
        }
        case 'repayLoan': {
          const a = args as ExtCommandArgs<'repayLoan'>;
          const r = e.repayLoan(a.loanId);
          return 'error' in r ? fail(r.error.startsWith('Fonds') ? 'INSUFFICIENT_FUNDS' : 'NOT_FOUND', r.error) : ok({ paid: r.paid, money: Math.round(e.money) });
        }
        case 'getReport':
          return ok(this.report((args as ExtCommandArgs<'getReport'>).fullHistory === true));
        case 'inspectBuilding': {
          const r = this.demo.inspectBuilding((args as ExtCommandArgs<'inspectBuilding'>).buildingId, now);
          return r ? ok(r) : fail('NOT_FOUND', 'Bâtiment introuvable');
        }
        case 'inspectCitizen': {
          const i = this.demo.citizens.indexOf((args as ExtCommandArgs<'inspectCitizen'>).citizenId);
          return i >= 0 ? ok(this.demo.citizenInfo(i, now)) : fail('NOT_FOUND', 'Citoyen introuvable');
        }
        case 'setFocus': {
          const a = args as ExtCommandArgs<'setFocus'>;
          this.demo.setFocus(a.x, a.z);
          const lod = { detailed: 0, simplified: 0, statistical: 0 };
          const col = this.demo.citizens.col.lod;
          for (let i = 0; i < this.demo.citizens.count; i++) {
            if (col[i] === 0) lod.detailed++; else if (col[i] === 1) lod.simplified++; else lod.statistical++;
          }
          return ok(lod);
        }
        case 'settle': {
          const waves = Math.floor((args as ExtCommandArgs<'settle'>).waves);
          for (let w = 0; w < waves; w++) this.demo.migrationWave(now, e.taxRates.residential);
          // Une journée de transitions (recherche d'emploi, scolarité) sans avancer l'horloge.
          this.demo.daily(now, e.taxRates.residential);
          const tb = this.demo.computeTaxBase(false);
          Object.assign(e.taxBase, tb.taxBase);
          e.serviceWorkers = tb.serviceWorkers;
          this.demo.updateLod();
          this.trafficBuildingsDirty = true;
          return ok({ population: this.demo.population, households: this.demo.households.count });
        }
      }
      return fail('INVALID_ARGS', 'Commande inconnue');
    })();
    return out as ExtOutcome<K>;
  }

  /* ---------------------------- Sauvegarde ---------------------------- */

  toSave(): SaveFileV2 {
    return {
      format: SAVE_FORMAT_ID,
      version: CURRENT_SAVE_VERSION,
      savedAt: new Date().toISOString(),
      params: { ...this.params! },
      clock: { totalMinutes: this.clock.totalMinutes },
      economy: this.economy.toJSON(),
      buildings: this.buildingRecords(),
      roads: this.roadRecords(),
      nextIds: { building: this.nextBuildingId, roadNode: this.nextNodeId, roadEdge: this.nextEdgeId },
      population: this.demo.toJSON(),
      sim: { rng: this.rng.getState(), scheduler: this.scheduler.toJSON() },
    };
  }

  /**
   * Charge une sauvegarde (toute version connue, migrée). Validation complète AVANT toute
   * modification ; si une incohérence n'apparaît qu'au chargement (empreinte hors carte,
   * chevauchement), l'état précédent est restauré. Ne lève jamais.
   */
  fromSave(raw: SaveFile | unknown): CommandError | null {
    if (!this.catalog) return { code: 'NO_GAME', message: 'Catalogue non initialisé' };
    const v = validateSave(raw);
    if (!v.ok) return { code: 'BAD_SAVE', message: v.message };
    const s = v.save;
    for (const b of s.buildings) {
      const a = this.getAsset(b.assetId);
      if (!a) return { code: 'BAD_SAVE', message: `Modèle absent du catalogue : ${b.assetId}` };
      if (!isBuildingCategory(a.category)) return { code: 'BAD_SAVE', message: `${b.assetId} n'est pas un bâtiment` };
      if (b.variant >= a.variants.length || b.variant < -1) return { code: 'BAD_SAVE', message: `Variante inexistante pour ${b.assetId}` };
    }
    const backup = this.terrain ? this.toSave() : null;
    try {
      const err = this.applySave(s);
      if (err) {
        if (backup) this.applySave(backup);
        return err;
      }
    } catch (e) {
      if (backup) this.applySave(backup);
      return { code: 'BAD_SAVE', message: `Sauvegarde inutilisable : ${e instanceof Error ? e.message : String(e)}` };
    }
    if (v.migratedFrom < CURRENT_SAVE_VERSION) this.notify('info', `Sauvegarde convertie depuis la version ${v.migratedFrom}.`);
    return null;
  }

  private applySave(s: SaveFileV2): CommandError | null {
    this.newGame(s.params);
    this.clock.totalMinutes = s.clock.totalMinutes;
    for (const n of s.roads.nodes) this.insertNode(n);
    for (const e of s.roads.edges) this.insertEdge(e, ROAD_TYPE_ORDER.indexOf(e.type), true);
    for (const b of s.buildings) {
      const a = this.getAsset(b.assetId)!;
      const f = this.footprintFor(a, b.x, b.z, b.rot);
      if (f.i0 < 0 || f.j0 < 0 || f.i0 + f.tx > this.tilesPerSide || f.j0 + f.tz > this.tilesPerSide) {
        return { code: 'BAD_SAVE', message: `Bâtiment ${b.id} hors de la carte` };
      }
      for (let j = f.j0; j < f.j0 + f.tz; j++) {
        for (let i = f.i0; i < f.i0 + f.tx; i++) {
          if (this.occupancy[j * this.tilesPerSide + i] !== 0) return { code: 'BAD_SAVE', message: `Bâtiments ${b.id} et ${this.occupancy[j * this.tilesPerSide + i]} superposés` };
        }
      }
      this.insertBuilding(b, true);
    }
    this.economy.fromJSON(s.economy);
    this.nextBuildingId = s.nextIds.building;
    this.nextNodeId = s.nextIds.roadNode;
    this.nextEdgeId = s.nextIds.roadEdge;
    this.demo.fromJSON(s.population, s.clock.totalMinutes);
    if (s.sim) {
      this.rng.setState(s.sim.rng);
      this.scheduler.fromJSON(s.sim.scheduler);
    } else {
      this.scheduleRecurring();
    }
    // Assiettes fiscales et effectifs recalculés depuis la population restaurée.
    const tb = this.demo.computeTaxBase(false);
    Object.assign(this.economy.taxBase, tb.taxBase);
    this.economy.serviceWorkers = tb.serviceWorkers;
    this.traffic.setNetwork(inputFromRoadGraph(this.roads));
    this.trafficBuildingsDirty = true;
    this.jobsDirty = true;
    this.clearPending();
    return null;
  }
}
