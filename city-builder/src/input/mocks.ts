/**
 * IMPLÉMENTATIONS FACTICES pour les démos et tests du module construction/caméra/UI
 * (jamais importées par le jeu : uniquement par src/input/demo/** et tests/construction/**).
 *
 * MockSim implémente `SimPort` (même surface que SimBridge) avec des règles proches de la
 * simulation (src/sim/world.ts) : limites, eau, pente, collisions bâtiments/routes, fonds,
 * remboursement de 25 %, accrochage des nœuds à 4 m. Terrain : le générateur partagé
 * déterministe (src/shared/terrain-gen.ts). Il émet un instantané puis des deltas (~10/s),
 * avec quelques véhicules qui circulent sur les routes construites (pour tester leur sélection).
 * Propriétaire : agent construction/caméra/UI.
 */
import { MAX_BUILDING_SLOPE, MAX_ROAD_SLOPE, TILE_SIZE, VEHICLE_STRIDE, type SimSpeed } from '../shared/constants';
import { buildAssetIndex, isBuildingCategory, type AssetCatalog, type CatalogAsset } from '../shared/catalog';
import { ROAD_TYPES, type BuildingRecord, type CommandError, type RoadEdgeRecord, type RoadNodeRecord, type SimStats, type TerrainData } from '../shared/contracts';
import type { CommandArgs, CommandName, CommandResult, DeltaMessage, SnapshotMessage } from '../shared/protocol';
import { generateTerrain, terrainBounds, terrainHeightAt } from '../shared/terrain-gen';
import { distSegmentRect, gridFootprint } from '../client/tools/geometry';
import type { SimPort } from '../client/tools/machine';

class MockError extends Error {
  constructor(readonly error: CommandError) { super(error.message); }
}
const fail = (code: CommandError['code'], message: string, phase?: number): never => { throw new MockError(phase ? { code, message, phase } : { code, message }); };

export class MockSim implements SimPort {
  readonly terrain: TerrainData;
  money: number;
  speed: SimSpeed = 1;
  minutes = 8 * 60;
  readonly buildings = new Map<number, BuildingRecord & { rect: { minX: number; minZ: number; maxX: number; maxZ: number } }>();
  readonly nodes = new Map<number, RoadNodeRecord>();
  readonly edges = new Map<number, RoadEdgeRecord>();
  private nextB = 1; private nextN = 1; private nextE = 1;
  private snapL: ((s: SnapshotMessage) => void)[] = [];
  private deltaL: ((d: DeltaMessage) => void)[] = [];
  private pend = { bA: [] as BuildingRecord[], bR: [] as number[], nA: [] as RoadNodeRecord[], eA: [] as RoadEdgeRecord[], eR: [] as number[] };
  private byId: Map<string, CatalogAsset>;
  private vehicleAssets: number[];
  private vehicles: { edge: number; t: number; dir: number; asset: number; speed: number }[] = [];
  private tick = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Commandes reçues (diagnostic de test). */
  readonly log: string[] = [];

  constructor(readonly catalog: AssetCatalog, readonly seed = 7, readonly mapChunks = 4, startMoney = 5_000_000, readonly cityName = 'Ville d’essai') {
    this.terrain = generateTerrain(seed, mapChunks);
    this.money = startMoney;
    this.byId = new Map(catalog.assets.map((a) => [a.id, a]));
    const idx = buildAssetIndex(catalog);
    this.vehicleAssets = catalog.assets.filter((a) => a.category === 'vehicle').map((a) => idx.get(a.id)!);
  }

  heightAt = (x: number, z: number): number => terrainHeightAt(this.terrain, x, z);

  onSnapshot(l: (s: SnapshotMessage) => void): void { this.snapL.push(l); }
  onDelta(l: (d: DeltaMessage) => void): void { this.deltaL.push(l); }

  /** Émet l'instantané puis démarre les deltas (≈10/s). */
  start(intervalMs = 100): void {
    const t = this.terrain;
    const snap: SnapshotMessage = {
      kind: 'snapshot', params: { seed: this.seed, mapChunks: this.mapChunks, startMoney: this.money, cityName: this.cityName },
      terrain: { ...t, heights: t.heights.slice() }, buildings: [...this.buildings.values()].map(strip), roads: { nodes: [...this.nodes.values()], edges: [...this.edges.values()] }, stats: this.stats(),
    };
    for (const l of this.snapL) l(snap);
    if (this.timer) clearInterval(this.timer);
    if (intervalMs > 0) this.timer = setInterval(() => this.step(), intervalMs);
  }

  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }

  stats(): SimStats {
    const days = Math.floor(this.minutes / 1440);
    let upkeep = 0;
    for (const b of this.buildings.values()) upkeep += this.byId.get(b.assetId)?.upkeepPerMonth ?? 0;
    let roadLen = 0;
    for (const e of this.edges.values()) { roadLen += e.length; upkeep += e.length * ROAD_TYPES[e.type].upkeepPerMeterMonth; }
    return {
      date: { totalMinutes: this.minutes, year: Math.floor(days / 360) + 1, month: Math.floor((days % 360) / 30) + 1, day: (days % 30) + 1, hour: Math.floor((this.minutes % 1440) / 60), minute: this.minutes % 60 },
      money: Math.round(this.money), population: 0, jobs: 0, buildings: this.buildings.size, roadLengthM: Math.round(roadLen), vehicles: this.vehicles.length,
      monthlyBalance: -Math.round(upkeep), speed: this.speed, tickMs: 0.1,
    };
  }

  /** Un pas : horloge, véhicules, delta. */
  step(): void {
    this.tick++;
    const month0 = Math.floor(this.minutes / 43200);
    this.minutes += 2 * this.speed;
    // Entretien prélevé à chaque changement de mois (comme l'économie de la simulation).
    if (Math.floor(this.minutes / 43200) !== month0) this.money += this.stats().monthlyBalance;
    this.moveVehicles(0.1 * this.speed);
    const n = this.vehicles.length;
    const positions = new Float32Array(n * VEHICLE_STRIDE);
    const assets = new Uint16Array(n);
    this.vehicles.forEach((v, i) => {
      const e = this.edges.get(v.edge);
      const a = e && this.nodes.get(e.a); const b = e && this.nodes.get(e.b);
      if (!a || !b) return;
      const dx = b.x - a.x; const dz = b.z - a.z; const len = Math.hypot(dx, dz) || 1;
      const side = 2.2 * v.dir;
      const x = a.x + dx * v.t + (-dz / len) * side; const z = a.z + dz * v.t + (dx / len) * side;
      positions.set([x, this.heightAt(x, z), z, Math.atan2(dx * v.dir, dz * v.dir)], i * VEHICLE_STRIDE);
      assets[i] = v.asset;
    });
    const d: DeltaMessage = {
      kind: 'delta', tick: this.tick, buildingsAdded: this.pend.bA, buildingsRemoved: this.pend.bR, roadNodesAdded: this.pend.nA, roadEdgesAdded: this.pend.eA, roadEdgesRemoved: this.pend.eR,
      vehicles: n || this.tick % 10 === 0 ? { count: n, positions, assetIndices: assets } : null, stats: this.stats(),
    };
    this.pend = { bA: [], bR: [], nA: [], eA: [], eR: [] };
    for (const l of this.deltaL) l(d);
  }

  private moveVehicles(dt: number): void {
    for (const v of this.vehicles) {
      const e = this.edges.get(v.edge);
      if (!e) { v.edge = -1; continue; }
      v.t += (v.speed * dt * v.dir) / Math.max(1, e.length);
      if (v.t > 1 || v.t < 0) { v.dir = -v.dir; v.t = Math.min(1, Math.max(0, v.t)); }
    }
    this.vehicles = this.vehicles.filter((v) => v.edge >= 0);
  }

  async send<K extends CommandName>(name: K, args: CommandArgs<K>): Promise<CommandResult<K>> {
    this.log.push(name);
    await Promise.resolve();
    return this.exec(name, args) as CommandResult<K>;
  }

  private exec(name: CommandName, a: unknown): unknown {
    switch (name) {
      case 'placeBuilding': return this.placeBuilding(a as CommandArgs<'placeBuilding'>);
      case 'demolish': return this.demolish(a as CommandArgs<'demolish'>);
      case 'buildRoad': return this.buildRoad(a as CommandArgs<'buildRoad'>);
      case 'removeRoad': return this.removeRoad(a as CommandArgs<'removeRoad'>);
      case 'setSpeed': this.speed = (a as CommandArgs<'setSpeed'>).speed; return { speed: this.speed };
      case 'terraform': return fail('NOT_IMPLEMENTED', 'La terraformation arrive en phase 2', 2);
      default: return fail('NOT_IMPLEMENTED', `Commande ${name} non simulée par MockSim`);
    }
  }

  placeBuilding(a: CommandArgs<'placeBuilding'>): CommandResult<'placeBuilding'> {
    const asset = this.byId.get(a.assetId);
    if (!asset || !isBuildingCategory(asset.category)) return fail('UNKNOWN_ASSET', 'Bâtiment inconnu');
    const rot = a.rot & 3;
    const t = this.terrain;
    const f = gridFootprint(t.originX, t.originZ, asset.footprint.tilesX, asset.footprint.tilesZ, a.x, a.z, rot);
    const b = terrainBounds(t);
    if (f.minX < b.minX || f.minZ < b.minZ || f.maxX > b.maxX || f.maxZ > b.maxZ) return fail('OUT_OF_BOUNDS', 'Hors de la carte');
    for (const o of this.buildings.values()) {
      if (f.minX < o.rect.maxX && f.maxX > o.rect.minX && f.minZ < o.rect.maxZ && f.maxZ > o.rect.minZ) return fail('COLLISION', 'Emplacement occupé par un autre bâtiment');
    }
    for (const e of this.edges.values()) {
      const na = this.nodes.get(e.a)!; const nb = this.nodes.get(e.b)!;
      if (distSegmentRect(na.x, na.z, nb.x, nb.z, f.minX, f.minZ, f.maxX, f.maxZ) < ROAD_TYPES[e.type].width / 2) return fail('COLLISION', 'Emplacement occupé par une route');
    }
    let lo = Infinity; let hi = -Infinity; let sum = 0; let n = 0;
    for (let j = 0; j <= f.tz; j++) for (let i = 0; i <= f.tx; i++) {
      const h = this.heightAt(f.minX + i * TILE_SIZE, f.minZ + j * TILE_SIZE);
      lo = Math.min(lo, h); hi = Math.max(hi, h); sum += h; n++;
    }
    if (lo < t.waterLevel + 0.3) return fail('UNDER_WATER', 'Impossible de construire dans l\'eau');
    if ((hi - lo) / (Math.max(f.tx, f.tz) * TILE_SIZE) > MAX_BUILDING_SLOPE) return fail('TOO_STEEP', 'Terrain trop pentu pour ce bâtiment');
    if (this.money < asset.cost) return fail('INSUFFICIENT_FUNDS', `Fonds insuffisants (${asset.cost} crédits requis)`);
    if (a.dryRun) return { buildingId: 0, cost: asset.cost };
    const id = this.nextB++;
    const rec = { id, assetId: asset.id, variant: a.variant ?? -1, x: f.cx, z: f.cz, y: sum / n, rot, rect: { minX: f.minX, minZ: f.minZ, maxX: f.maxX, maxZ: f.maxZ } };
    this.buildings.set(id, rec);
    this.money -= asset.cost;
    this.pend.bA.push(strip(rec));
    return { buildingId: id, cost: asset.cost };
  }

  demolish(a: CommandArgs<'demolish'>): CommandResult<'demolish'> {
    const b = this.buildings.get(a.buildingId);
    if (!b) return fail('NOT_FOUND', 'Bâtiment introuvable');
    this.buildings.delete(b.id);
    const refund = Math.round((this.byId.get(b.assetId)?.cost ?? 0) * 0.25);
    this.money += refund;
    this.pend.bR.push(b.id);
    return { refund };
  }

  buildRoad(a: CommandArgs<'buildRoad'>): CommandResult<'buildRoad'> {
    const def = ROAD_TYPES[a.type];
    const t = this.terrain;
    const bnd = terrainBounds(t);
    const segs: [number, number, number, number, number][] = [];
    let total = 0;
    for (let k = 0; k + 3 < a.points.length; k += 2) {
      const ax = a.points[k]!; const az = a.points[k + 1]!; const bx = a.points[k + 2]!; const bz = a.points[k + 3]!;
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 4) continue;
      for (const [px, pz] of [[ax, az], [bx, bz]] as const) if (px < bnd.minX + def.width || pz < bnd.minZ + def.width || px > bnd.maxX - def.width || pz > bnd.maxZ - def.width) return fail('OUT_OF_BOUNDS', 'Tracé hors de la carte');
      if (Math.abs(this.heightAt(bx, bz) - this.heightAt(ax, az)) / len > MAX_ROAD_SLOPE) return fail('TOO_STEEP', 'Pente trop forte pour une route');
      const steps = Math.ceil(len / 4);
      for (let s = 0; s <= steps; s++) if (this.heightAt(ax + ((bx - ax) * s) / steps, az + ((bz - az) * s) / steps) < t.waterLevel + 0.2) return fail('UNDER_WATER', 'Les ponts arrivent en phase 3', 3);
      for (const o of this.buildings.values()) if (distSegmentRect(ax, az, bx, bz, o.rect.minX, o.rect.minZ, o.rect.maxX, o.rect.maxZ) < def.width / 2) return fail('COLLISION', 'Le tracé traverse un bâtiment');
      segs.push([ax, az, bx, bz, len]);
      total += len;
    }
    if (!segs.length) return fail('INVALID_ARGS', 'Tracé trop court (4 m minimum)');
    const cost = Math.round(total * def.costPerMeter);
    if (this.money < cost) return fail('INSUFFICIENT_FUNDS', `Fonds insuffisants (${cost} crédits requis)`);
    if (a.dryRun) return { edgeIds: [], cost };
    const nodeAt = (x: number, z: number): number => {
      for (const n of this.nodes.values()) if (Math.hypot(n.x - x, n.z - z) <= Math.min(4, def.width / 2)) return n.id;
      const id = this.nextN++;
      const n = { id, x, y: this.heightAt(x, z), z };
      this.nodes.set(id, n); this.pend.nA.push(n);
      return id;
    };
    const edgeIds: number[] = [];
    for (const [ax, az, bx, bz, len] of segs) {
      const na = nodeAt(ax, az); const nb = nodeAt(bx, bz);
      if (na === nb) continue;
      const e = { id: this.nextE++, a: na, b: nb, type: a.type, length: len };
      this.edges.set(e.id, e); this.pend.eA.push(e); edgeIds.push(e.id);
      if (this.vehicleAssets.length && len > 30) {
        const asset = this.vehicleAssets[(e.id * 7) % this.vehicleAssets.length]!;
        this.vehicles.push({ edge: e.id, t: 0.3, dir: e.id % 2 ? 1 : -1, asset, speed: 9 });
      }
    }
    this.money -= cost;
    return { edgeIds, cost };
  }

  removeRoad(a: CommandArgs<'removeRoad'>): CommandResult<'removeRoad'> {
    const e = this.edges.get(a.edgeId);
    if (!e) return fail('NOT_FOUND', 'Tronçon introuvable');
    this.edges.delete(e.id);
    const refund = Math.round(e.length * ROAD_TYPES[e.type].costPerMeter * 0.25);
    this.money += refund;
    this.pend.eR.push(e.id);
    return { refund };
  }
}

function strip(b: BuildingRecord & { rect?: unknown }): BuildingRecord {
  return { id: b.id, assetId: b.assetId, variant: b.variant, x: b.x, z: b.z, y: b.y, rot: b.rot };
}

/** Fusionne le catalogue principal et des fragments `{ assets, textureSets }` (démo uniquement). */
export function mergeCatalogs(base: AssetCatalog, ...frags: { assets?: CatalogAsset[]; textureSets?: AssetCatalog['textureSets'] }[]): AssetCatalog {
  const out: AssetCatalog = { ...base, assets: [...base.assets], textureSets: [...base.textureSets] };
  const ids = new Set(out.assets.map((a) => a.id));
  const tex = new Set(out.textureSets.map((t) => t.id));
  for (const f of frags) {
    for (const a of f.assets ?? []) if (!ids.has(a.id)) { ids.add(a.id); out.assets.push(a); }
    for (const t of f.textureSets ?? []) if (!tex.has(t.id)) { tex.add(t.id); out.textureSets.push(t); }
  }
  return out;
}
