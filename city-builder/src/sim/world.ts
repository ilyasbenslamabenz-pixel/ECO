/**
 * Simulation : état complet du monde + exécution validée des commandes.
 * Indépendante du transport (testable en Node sans worker). TypeScript pur :
 * AUCUN import de three ni du DOM.
 */
import {
  GAME_MINUTES_PER_TICK,
  INITIAL_BUILDING_CAPACITY,
  INITIAL_ROAD_EDGE_CAPACITY,
  INITIAL_ROAD_NODE_CAPACITY,
  INITIAL_VEHICLE_CAPACITY,
  MAX_BUILDING_SLOPE,
  MAX_ROAD_SLOPE,
  SAVE_FORMAT_VERSION,
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
import { GameClock } from './clock';
import { DEMOLISH_REFUND_RATE, Economy, roadCost, roadUpkeep } from './economy';
import { BuildingStore, RoadGraph, VehicleStore } from './ecs';
import { updateDemography, type DemographyResult } from './demography';
import { updateTraffic } from './traffic';
import { ROAD_TYPE_ORDER } from './pathfinding';

export type CmdOutcome<K extends CommandName> = { ok: true; data: CommandResult<K> } | { ok: false; error: CommandError };

const fail = (code: CommandError['code'], message: string, phase?: number): { ok: false; error: CommandError } =>
  ({ ok: false, error: phase === undefined ? { code, message } : { code, message, phase } });

/** Distance d'un point à un segment. */
function distPointSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return dist2(px, pz, ax + dx * t, az + dz * t);
}

/** Distance d'un segment à un rectangle aligné sur les axes (0 si intersection). Approximation par échantillonnage fin. */
function distSegmentRect(ax: number, az: number, bx: number, bz: number, minX: number, minZ: number, maxX: number, maxZ: number): number {
  const len = dist2(ax, az, bx, bz);
  const steps = Math.max(1, Math.ceil(len / 1));
  let best = Infinity;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const px = ax + (bx - ax) * t;
    const pz = az + (bz - az) * t;
    const cx = px < minX ? minX : px > maxX ? maxX : px;
    const cz = pz < minZ ? minZ : pz > maxZ ? maxZ : pz;
    const d = dist2(px, pz, cx, cz);
    if (d < best) best = d;
  }
  // Les coins du rectangle vers le segment (cas segment entièrement hors échantillons).
  best = Math.min(best,
    distPointSegment(minX, minZ, ax, az, bx, bz), distPointSegment(maxX, minZ, ax, az, bx, bz),
    distPointSegment(minX, maxZ, ax, az, bx, bz), distPointSegment(maxX, maxZ, ax, az, bx, bz));
  return best;
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
  readonly vehicles = new VehicleStore(INITIAL_VEHICLE_CAPACITY);
  speed: SimSpeed = 1;
  tickCount = 0;
  tickMs = 0;

  /** Occupation des cases : 0 = libre, sinon id du bâtiment. */
  private occupancy = new Int32Array(0);
  private tilesPerSide = 0;
  private nextBuildingId = 1;
  private nextNodeId = 1;
  private nextEdgeId = 1;
  private roadLength = 0;
  private edgeTypeById = new Map<number, RoadTypeId>();

  // Deltas en attente (vidés par takeDelta).
  private pendingBuildingsAdded: BuildingRecord[] = [];
  private pendingBuildingsRemoved: number[] = [];
  private pendingNodesAdded: RoadNodeRecord[] = [];
  private pendingEdgesAdded: RoadEdgeRecord[] = [];
  private pendingEdgesRemoved: number[] = [];

  private readonly demo: DemographyResult = { population: 0, jobs: 0 };
  private readonly stats: SimStats = {
    date: { totalMinutes: 0, year: 1, month: 1, day: 1, hour: 0, minute: 0 },
    money: 0, population: 0, jobs: 0, buildings: 0, roadLengthM: 0, vehicles: 0, monthlyBalance: 0, speed: 1, tickMs: 0,
  };

  setCatalog(cat: AssetCatalog): void {
    this.catalog = cat;
    this.assetIndex = buildAssetIndex(cat);
  }

  getAsset(id: string): CatalogAsset | undefined {
    const i = this.assetIndex.get(id);
    return i === undefined ? undefined : this.catalog?.assets[i];
  }

  newGame(p: NewGameParams): void {
    this.params = { ...p };
    this.terrain = generateTerrain(p.seed, p.mapChunks);
    this.tilesPerSide = this.terrain.samplesX - 1;
    this.occupancy = new Int32Array(this.tilesPerSide * this.tilesPerSide);
    this.clock.totalMinutes = 0;
    this.economy.money = p.startMoney;
    this.economy.monthlyUpkeep = 0;
    this.economy.monthlyIncome = 0;
    this.buildings.clear();
    this.roads.clear();
    this.vehicles.clear();
    this.edgeTypeById.clear();
    this.roadLength = 0;
    this.nextBuildingId = 1;
    this.nextNodeId = 1;
    this.nextEdgeId = 1;
    this.tickCount = 0;
    this.clearPending();
  }

  private clearPending(): void {
    this.pendingBuildingsAdded.length = 0;
    this.pendingBuildingsRemoved.length = 0;
    this.pendingNodesAdded.length = 0;
    this.pendingEdgesAdded.length = 0;
    this.pendingEdgesRemoved.length = 0;
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

  placeBuilding(a: CommandArgs<'placeBuilding'>): CmdOutcome<'placeBuilding'> {
    if (!this.terrain) return fail('NO_GAME', 'Aucune partie en cours');
    const asset = this.getAsset(a.assetId);
    if (!asset) return fail('UNKNOWN_ASSET', `Modèle inconnu : ${a.assetId}`);
    if (!isBuildingCategory(asset.category)) return fail('INVALID_ARGS', `${asset.nameFr} n'est pas un bâtiment`);
    const rot = ((Math.round(a.rot) % 4) + 4) % 4;
    const variant = a.variant ?? -1;
    if (variant >= asset.variants.length) return fail('INVALID_ARGS', 'Variante inexistante');
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
    for (let e = 0; e < this.roads.edgeCount; e++) {
      const na = this.roads.nodeIndex(this.roads.edgeA[e]!);
      const nb = this.roads.nodeIndex(this.roads.edgeB[e]!);
      const type = ROAD_TYPE_ORDER[this.roads.edgeType[e]!] ?? 'street';
      const d = distSegmentRect(this.roads.nodeX[na]!, this.roads.nodeZ[na]!, this.roads.nodeX[nb]!, this.roads.nodeZ[nb]!, minX, minZ, maxX, maxZ);
      if (d < ROAD_TYPES[type].width / 2) return fail('COLLISION', 'Le bâtiment empiète sur une route');
    }
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
    if (!this.economy.canAfford(asset.cost)) return fail('INSUFFICIENT_FUNDS', `Fonds insuffisants (${asset.cost} crédits requis)`);
    if (a.dryRun) return { ok: true, data: { buildingId: 0, cost: asset.cost } };

    const id = this.nextBuildingId++;
    const y = hSum / n;
    this.insertBuilding({ id, assetId: asset.id, variant, x: f.cx, z: f.cz, y, rot });
    this.economy.spend(asset.cost);
    return { ok: true, data: { buildingId: id, cost: asset.cost } };
  }

  /** Insertion sans contrôle ni coût (utilisée par placeBuilding et le chargement). */
  private insertBuilding(r: BuildingRecord): void {
    const asset = this.getAsset(r.assetId)!;
    const f = this.footprintFor(asset, r.x, r.z, r.rot);
    for (let j = f.j0; j < f.j0 + f.tz; j++) {
      for (let i = f.i0; i < f.i0 + f.tx; i++) this.occupancy[j * this.tilesPerSide + i] = r.id;
    }
    this.buildings.add(r.id, this.assetIndex.get(asset.id)!, r.variant, r.x, r.y, r.z, r.rot, f.tx, f.tz);
    this.economy.addUpkeep(asset.upkeepPerMonth);
    this.pendingBuildingsAdded.push({ ...r });
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
    this.buildings.remove(a.buildingId);
    this.economy.removeUpkeep(asset.upkeepPerMonth);
    const refund = Math.round(asset.cost * DEMOLISH_REFUND_RATE);
    this.economy.refund(refund);
    this.pendingBuildingsRemoved.push(a.buildingId);
    return { ok: true, data: { refund } };
  }

  /* ------------------------------ Routes ------------------------------ */

  private findNodeNear(x: number, z: number, radius: number): number {
    let best = -1;
    let bestD = radius;
    for (let i = 0; i < this.roads.nodeCount; i++) {
      const d = dist2(x, z, this.roads.nodeX[i]!, this.roads.nodeZ[i]!);
      if (d <= bestD) { bestD = d; best = this.roads.nodeId[i]!; }
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
      for (let i = 0; i < this.buildings.count; i++) {
        const hx = (this.buildings.tilesX[i]! * TILE_SIZE) / 2;
        const hz = (this.buildings.tilesZ[i]! * TILE_SIZE) / 2;
        const cx = this.buildings.x[i]!;
        const cz = this.buildings.z[i]!;
        if (distSegmentRect(ax, az, bx, bz, cx - hx, cz - hz, cx + hx, cz + hz) < def.width / 2) {
          return fail('COLLISION', 'Le tracé traverse un bâtiment');
        }
      }
      segs.push([ax, az, bx, bz]);
      total += len;
    }
    if (segs.length === 0) return fail('INVALID_ARGS', 'Tracé trop court (4 m minimum)');
    const cost = roadCost(a.type, total);
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
      this.roads.addNode(id, x, y, z);
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
    return { ok: true, data: { edgeIds, cost } };
  }

  private insertEdge(e: RoadEdgeRecord, typeIdx: number): void {
    this.roads.addEdge(e.id, e.a, e.b, typeIdx, e.length);
    this.edgeTypeById.set(e.id, e.type);
    this.roadLength += e.length;
    this.economy.addUpkeep(roadUpkeep(e.type, e.length));
    this.pendingEdgesAdded.push({ ...e });
  }

  removeRoad(a: CommandArgs<'removeRoad'>): CmdOutcome<'removeRoad'> {
    if (!this.terrain) return fail('NO_GAME', 'Aucune partie en cours');
    const ei = this.roads.edgeIndex(a.edgeId);
    if (ei < 0) return fail('NOT_FOUND', 'Tronçon introuvable');
    const type = this.edgeTypeById.get(a.edgeId) ?? 'street';
    const len = this.roads.edgeLength[ei]!;
    this.roads.removeEdge(a.edgeId);
    this.edgeTypeById.delete(a.edgeId);
    this.roadLength -= len;
    this.economy.removeUpkeep(roadUpkeep(type, len));
    const refund = Math.round(roadCost(type, len) * DEMOLISH_REFUND_RATE);
    this.economy.refund(refund);
    this.pendingEdgesRemoved.push(a.edgeId);
    return { ok: true, data: { refund } };
  }

  /* ------------------------------ Tick ------------------------------ */

  tick(): void {
    if (!this.terrain) return;
    const { monthChanged } = this.clock.advance(GAME_MINUTES_PER_TICK);
    if (monthChanged) this.economy.onMonth();
    updateDemography(this.buildings, this.demo);
    updateTraffic(this.roads, this.vehicles, GAME_MINUTES_PER_TICK);
    this.tickCount++;
  }

  getStats(): SimStats {
    const s = this.stats;
    this.clock.toDate(s.date);
    s.money = Math.round(this.economy.money);
    s.population = this.demo.population;
    s.jobs = this.demo.jobs;
    s.buildings = this.buildings.count;
    s.roadLengthM = Math.round(this.roadLength);
    s.vehicles = this.vehicles.count;
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
    const v = this.vehicles;
    let vehicles: DeltaMessage['vehicles'] = null;
    if (v.count > 0) {
      const positions = new Float32Array(v.count * 4);
      const assetIndices = new Uint16Array(v.count);
      for (let i = 0; i < v.count; i++) {
        positions[i * 4] = v.x[i]!;
        positions[i * 4 + 1] = v.y[i]!;
        positions[i * 4 + 2] = v.z[i]!;
        positions[i * 4 + 3] = v.heading[i]!;
        assetIndices[i] = v.assetIndex[i]!;
      }
      vehicles = { count: v.count, positions, assetIndices };
    }
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

  /* ---------------------------- Sauvegarde ---------------------------- */

  toSave(): SaveFile {
    return {
      format: 'aube-urbaine-save',
      version: SAVE_FORMAT_VERSION,
      savedAt: new Date().toISOString(),
      params: { ...this.params! },
      clock: { totalMinutes: this.clock.totalMinutes },
      economy: { money: this.economy.money },
      buildings: this.buildingRecords(),
      roads: this.roadRecords(),
      nextIds: { building: this.nextBuildingId, roadNode: this.nextNodeId, roadEdge: this.nextEdgeId },
    };
  }

  fromSave(s: SaveFile): CommandError | null {
    if (s.format !== 'aube-urbaine-save') return { code: 'BAD_SAVE', message: 'Fichier de sauvegarde non reconnu' };
    if (s.version !== SAVE_FORMAT_VERSION) return { code: 'BAD_SAVE', message: `Version de sauvegarde ${s.version} non prise en charge` };
    if (!this.catalog) return { code: 'NO_GAME', message: 'Catalogue non initialisé' };
    for (const b of s.buildings) if (!this.getAsset(b.assetId)) return { code: 'BAD_SAVE', message: `Modèle absent du catalogue : ${b.assetId}` };
    this.newGame(s.params);
    this.clock.totalMinutes = s.clock.totalMinutes;
    for (const n of s.roads.nodes) this.roads.addNode(n.id, n.x, n.y, n.z);
    for (const e of s.roads.edges) this.insertEdge(e, ROAD_TYPE_ORDER.indexOf(e.type));
    for (const b of s.buildings) this.insertBuilding(b);
    this.economy.money = s.economy.money;
    this.nextBuildingId = s.nextIds.building;
    this.nextNodeId = s.nextIds.roadNode;
    this.nextEdgeId = s.nextIds.roadEdge;
    this.clearPending();
    return null;
  }
}
