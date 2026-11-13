/**
 * Simulation : état complet du monde + exécution validée des commandes.
 * Indépendante du transport (testable en Node sans worker). TypeScript pur :
 * AUCUN import de three ni du DOM.
 *
 * Contenu : bâtiments et routes (SoA + index spatiaux par chunk), accès route des bâtiments
 * (façade), horloge + planificateur d'événements, démographie, économie, trafic
 * (TrafficSystem du module trafic), deltas pour le rendu, sauvegarde versionnée (v2).
 * Modules de phase 2 : crochets appelés via PluginHost (src/sim/plugins) ; registres vides = aucun effet.
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
  type BuildingRecord,
  type CommandError,
  type NewGameParams,
  type RoadEdgeRecord,
  type RoadNodeRecord,
  type SaveFile,
  type SimStats,
  type TerrainData,
} from '../shared/contracts';
import type { CommandArgs, CommandName, CommandResult, DeltaMessage, SignalFrame, SnapshotMessage } from '../shared/protocol';
import { dist2 } from '../shared/math';
import { distSegmentObb, footprintObb, makeObb, normRot, obbAabb, obbOverlap, obbToWorld, pointInObb, type Obb } from '../shared/footprint';
import { terrainBounds, terrainHeightAt } from '../shared/terrain-gen';
import { GameClock, MINUTES_PER_DAY, MINUTES_PER_MONTH, MINUTES_PER_YEAR, formatDateFr } from './clock';
import { DEMOLISH_REFUND_RATE, Economy } from './economy';
import { BuildingStore, ChunkIndex, VehicleStore } from './ecs';
import { DemographySystem, ROAD_ACCESS_MARGIN_M } from './demography';
import { TrafficSystem, inputFromRoadNetwork, buildingsFromStore } from './traffic';
import {
  ROAD_KINDS, RoadNetwork, commitRoadPlan, cubic, cubicBounds, gradeTerrainForRoads, halfWidth, isRoadKind,
  networkRecords, planRoad, polyline, SLOPE_WIDTH, type ProfileEnv, type RoadKindId, type RoadRequest,
} from './roads';
import { NO_WATER, extractPatch, generateWorld, type WorldTerrain } from './terrain';
import { Rng } from './rng';
import { EventScheduler, SimEvent } from './scheduler';
import { CURRENT_SAVE_VERSION, SAVE_FORMAT_ID, validateSave, type SaveFileV2 } from './save-format';
import { buildCity } from './city-builder';
import type { ExtCommandArgs, ExtCommandName, ExtCommandResult, SimNotice, SimReport } from './sim-protocol';
import { PluginHost, SIM_PLUGINS, type PluginSaveField, type SimPlugin } from './plugins';

export type CmdOutcome<K extends CommandName> = { ok: true; data: CommandResult<K> } | { ok: false; error: CommandError };
export type ExtOutcome<K extends ExtCommandName> = { ok: true; data: ExtCommandResult<K> } | { ok: false; error: CommandError };

const fail = (code: CommandError['code'], message: string, phase?: number): { ok: false; error: CommandError } =>
  ({ ok: false, error: phase === undefined ? { code, message } : { code, message, phase } });

/** Demi-largeur maximale d'une route (m) : marge des requêtes spatiales. */
const MAX_ROAD_HALF_WIDTH = Math.max(...(Object.keys(ROAD_KINDS) as RoadKindId[]).map((k) => halfWidth(k)));
/** Trajets individuels transmis au trafic au plus par tick. */
const TRIPS_PER_TICK = 8;
/**
 * Périodes (minutes de jeu) des événements au rythme réel fixe, indépendant de la durée de la journée :
 * une vague d'immigration toutes les 180 ticks (18 s réelles à x1), une synchronisation bâtiments -> trafic
 * toutes les 30 ticks (3 s).
 */
const REALTIME_PERIODS = {
  mig: Math.round(180 * GAME_MINUTES_PER_TICK * 1000) / 1000,
  sync: Math.round(30 * GAME_MINUTES_PER_TICK * 1000) / 1000,
};
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
  /** Modules de phase 2 (registre src/sim/plugins/index.ts ; les tests peuvent injecter leur propre liste). */
  readonly plugins: PluginHost;

  constructor(plugins: readonly SimPlugin[] = SIM_PLUGINS) {
    this.plugins = new PluginHost(this, plugins);
  }

  catalog: AssetCatalog | null = null;
  private assetIndex = new Map<string, number>();
  params: NewGameParams | null = null;
  /** Terrain de la simulation (WorldTerrain : hauteurs NIVELÉES sous les routes + couches eau/forêt/ressources). */
  terrain: WorldTerrain | null = null;
  /** Hauteurs naturelles (avant nivellement) : base stable des profils en long et du re-nivellement. */
  private naturalHeights = new Float32Array(0);
  readonly clock = new GameClock();
  readonly economy = new Economy();
  readonly buildings = new BuildingStore(INITIAL_BUILDING_CAPACITY);
  /** Réseau routier (module src/sim/roads : tronçons courbes, carrefours automatiques, ponts). */
  net: RoadNetwork = new RoadNetwork({ heightAt: () => 0, waterLevel: 0 }, INITIAL_ROAD_NODE_CAPACITY);
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
  /** Polylignes des tronçons (x, z alternés) pour les distances route / emprise. */
  private segPolys = new Map<number, Float64Array>();
  private readonly q: number[] = [];
  private readonly q2: number[] = [];

  /** Empreintes orientées des bâtiments (collisions exactes, angle libre). */
  private readonly obbs = new Map<number, Obb>();
  private tilesPerSide = 0;
  private nextBuildingId = 1;
  private roadLength = 0;
  /** Longueur et type par tronçon (pour entretien / remboursement après découpe). */
  private segInfo = new Map<number, { kind: RoadKindId; length: number }>();
  /** Zone de terrain modifiée depuis le dernier delta (union). */
  private pendingPatch: { i0: number; j0: number; i1: number; j1: number } | null = null;
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
    this.plugins.init();
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
    this.terrain = generateWorld({ ...(p.terrain ?? {}), seed: p.seed, mapChunks: p.mapChunks, samplesPerTile: 1 });
    this.naturalHeights = new Float32Array(this.terrain.heights);
    this.net = new RoadNetwork(this.profileEnv(), INITIAL_ROAD_NODE_CAPACITY);
    this.segPolys.clear();
    this.segInfo.clear();
    this.pendingPatch = null;
    this.tilesPerSide = this.terrain.samplesX - 1;
    this.obbs.clear();
    const size = this.tilesPerSide * TILE_SIZE;
    this.buildingIndex = new ChunkIndex(this.terrain.originX, this.terrain.originZ, size, CHUNK_SIZE);
    this.edgeIndex = new ChunkIndex(this.terrain.originX, this.terrain.originZ, size, CHUNK_SIZE);
    if (this.catalog) this.setCatalog(this.catalog);
    this.clock.totalMinutes = Math.round(Math.max(0, Math.min(23.99, p.startHour ?? 0)) * 60)
      + (Math.max(1, Math.min(12, Math.floor(p.startMonth ?? 1))) - 1) * MINUTES_PER_MONTH;
    this.economy.reset(p.startMoney);
    this.buildings.clear();
    this.vehicles.clear();
    this.roadLength = 0;
    this.nextBuildingId = 1;
    this.tickCount = 0;
    this.rng.setState(new Rng((p.seed ^ 0x5bd1e995) >>> 0).getState());
    this.demography?.reset();
    this.notices.length = 0;
    this.tripsToTraffic = 0;
    this.jobsDirty = true;
    this.scheduleRecurring();
    this.traffic.clear();
    this.traffic.setNetwork(inputFromRoadNetwork(this.net));
    this.trafficBuildingsDirty = true;
    this.clearPending();
    this.plugins.onNewGame();
  }

  /** Environnement des profils en long : terrain NATUREL, mer et surfaces d'eau locales (rivières, lacs). */
  private profileEnv(): ProfileEnv {
    const t = this.terrain!;
    const nat: TerrainData = { ...t, heights: this.naturalHeights };
    const W = t.samplesX, H = t.samplesZ, sp = t.spacing;
    return {
      heightAt: (x, z) => terrainHeightAt(nat, x, z),
      waterLevel: t.waterLevel,
      waterAt: (x, z) => {
        // Échantillon le plus proche ; une rivière est une surface d'eau au-dessus du terrain.
        const i = Math.round((x - t.originX) / sp), j = Math.round((z - t.originZ) / sp);
        if (i < 0 || j < 0 || i >= W || j >= H) return -Infinity;
        const k = j * W + i;
        const w = t.waterSurface[k]!;
        return w > NO_WATER / 2 && w > this.naturalHeights[k]! ? w : -Infinity;
      },
    };
  }

  /**
   * Test de charge : crée jusqu'à `n` trajets réels (itinéraires A*) entre bâtiments reliés, en plus de la demande.
   * Renvoie le nombre de véhicules en circulation.
   */
  seedTraffic(n: number): number {
    this.traffic.step(0, this.clock.hourOfDay); // reconstruit réseau et accès
    const m = this.traffic.accessCount;
    if (m < 2) return this.traffic.actCount;
    const target = this.traffic.actCount + n;
    const usages = ['prive', 'prive', 'prive', 'prive', 'livraison', 'bus', 'prive'] as const;
    for (let tries = 0; tries < n * 30 && this.traffic.actCount < target; tries++) {
      const a = Math.floor(this.rng.next() * m), b = Math.floor(this.rng.next() * m);
      this.traffic.spawnTrip(a, b, usages[tries % usages.length]!);
      // Les véhicules partent du trottoir : on avance de temps en temps pour libérer les voies d'accès.
      if (tries % 400 === 399) this.traffic.step(0.5, this.clock.hourOfDay);
    }
    return this.traffic.actCount;
  }

  /** Hauteur du terrain (nivelé) en (x, z) ; NaN hors de la carte. */
  groundHeight(x: number, z: number): number {
    const t = this.terrain;
    if (!t) return NaN;
    const b = terrainBounds(t);
    if (x < b.minX || z < b.minZ || x > b.maxX || z > b.maxZ) return NaN;
    return terrainHeightAt(t, x, z);
  }

  /** Vrai si de l'eau recouvre le terrain en (x, z). */
  isWet(x: number, z: number): boolean { return !!this.terrain && this.wetAt(x, z); }

  /** Emplacement libre pour un décor non simulé (ni eau, ni bâtiment, ni chaussée). */
  canHostDecor(x: number, z: number): boolean {
    const t = this.terrain;
    if (!t || !Number.isFinite(this.groundHeight(x, z)) || this.wetAt(x, z)) return false;
    if (this.buildingAtPoint(x, z, 0.5) !== 0) return false;
    return this.roadClearance(makeObb(x, z, 0.5, 0.5, 0), MAX_ROAD_HALF_WIDTH) > 0.3;
  }

  /** Vrai si de l'eau recouvre le terrain en (x, z) (mer, lac, rivière ; échantillons voisins). */
  private wetAt(x: number, z: number): boolean {
    const t = this.terrain!;
    const fx = (x - t.originX) / t.spacing, fz = (z - t.originZ) / t.spacing;
    const i0 = Math.floor(fx), j0 = Math.floor(fz);
    for (let dj = 0; dj <= 1; dj++) {
      for (let di = 0; di <= 1; di++) {
        const i = Math.min(t.samplesX - 1, Math.max(0, i0 + di)), j = Math.min(t.samplesZ - 1, Math.max(0, j0 + dj));
        const k = j * t.samplesX + i;
        if (t.waterSurface[k]! > t.heights[k]! + 0.05) return true;
      }
    }
    return false;
  }

  /** Événements récurrents de base (planifiés au démarrage d'une partie). */
  private scheduleRecurring(): void {
    this.scheduler.clear();
    const t = this.clock.totalMinutes;
    const next = (period: number, offset = 0): number => Math.floor((t - offset) / period) * period + period + offset;
    this.scheduler.schedule(next(MINUTES_PER_DAY), SimEvent.DayStart, 0, 0, MINUTES_PER_DAY);
    this.scheduler.schedule(next(MINUTES_PER_MONTH), SimEvent.MonthStart, 0, 0, MINUTES_PER_MONTH);
    this.scheduler.schedule(next(MINUTES_PER_YEAR), SimEvent.YearStart, 0, 0, MINUTES_PER_YEAR);
    const { mig, sync } = REALTIME_PERIODS;
    this.scheduler.schedule(next(mig, mig / 6), SimEvent.Migration, 0, 0, mig);
    this.scheduler.schedule(next(sync, sync / 2), SimEvent.TrafficSync, 0, 0, sync);
  }

  private clearPending(): void {
    this.pendingBuildingsAdded.length = 0;
    this.pendingBuildingsRemoved.length = 0;
    this.pendingNodesAdded.length = 0;
    this.pendingEdgesAdded.length = 0;
    this.pendingEdgesRemoved.length = 0;
    this.pendingPatch = null;
  }

  notify(level: SimNotice['level'], message: string): void {
    this.notices.push({ minute: this.clock.totalMinutes, level, message });
    if (this.notices.length > MAX_NOTICES) this.notices.splice(0, this.notices.length - MAX_NOTICES);
  }

  /* ---------------------------- Bâtiments ---------------------------- */

  /** Empreinte orientée d'un modèle posé en (x, z) avec la rotation `rot` (quarts de tour, décimal possible). */
  obbFor(asset: CatalogAsset, x: number, z: number, rot: number): Obb {
    return footprintObb(asset.footprint.tilesX, asset.footprint.tilesZ, x, z, rot);
  }

  /** Bâtiment dont l'empreinte contient le point (marge en m), 0 sinon. */
  private buildingAtPoint(x: number, z: number, margin: number): number {
    this.buildingIndex.query(x - margin, z - margin, x + margin, z + margin, this.q);
    for (const id of this.q) {
      const o = this.obbs.get(id);
      if (o && pointInObb(o, x, z, margin)) return id;
    }
    return 0;
  }

  /** Premier bâtiment dont l'empreinte recouvre `o` (0 si aucun). */
  private overlappingBuilding(o: Obb): number {
    const bb = obbAabb(o);
    this.buildingIndex.query(bb.minX, bb.minZ, bb.maxX, bb.maxZ, this.q);
    for (const id of this.q) {
      const other = this.obbs.get(id);
      if (other && obbOverlap(o, other, 0.05)) return id;
    }
    return 0;
  }

  /** Plus petite marge (distance - demi-largeur) entre une empreinte orientée et les routes voisines (tronçons courbes). */
  private roadClearance(o: Obb, reach: number): number {
    let best = Infinity;
    const bb = obbAabb(o);
    this.edgeIndex.query(bb.minX - reach, bb.minZ - reach, bb.maxX + reach, bb.maxZ + reach, this.q2);
    for (const id of this.q2) {
      const poly = this.segPolys.get(id);
      const info = this.segInfo.get(id);
      if (!poly || !info) continue;
      const half = halfWidth(info.kind);
      for (let k = 0; k + 3 < poly.length; k += 2) {
        const d = distSegmentObb(poly[k]!, poly[k + 1]!, poly[k + 2]!, poly[k + 3]!, o) - half;
        if (d < best) best = d;
      }
    }
    return best;
  }

  placeBuilding(a: CommandArgs<'placeBuilding'>): CmdOutcome<'placeBuilding'> {
    if (!this.terrain) return fail('NO_GAME', 'Aucune partie en cours');
    const asset = this.getAsset(a.assetId);
    if (!asset) return fail('UNKNOWN_ASSET', `Modèle inconnu : ${a.assetId}`);
    if (!isBuildingCategory(asset.category)) return fail('INVALID_ARGS', `${asset.nameFr} n'est pas un bâtiment`);
    // Angle libre (quarts de tour décimaux) et position libre au centimètre : un bâtiment peut
    // border une route en biais ou courbe ; seules les collisions exactes décident.
    const rot = normRot(a.rot);
    const variant = a.variant ?? -1;
    if (variant >= asset.variants.length || variant < -1 || !Number.isInteger(variant)) return fail('INVALID_ARGS', 'Variante inexistante');
    const x = Math.round(a.x * 100) / 100, z = Math.round(a.z * 100) / 100;
    const o = this.obbFor(asset, x, z, rot);
    const t = this.terrain;
    const tb = terrainBounds(t);
    const bb = obbAabb(o);
    if (bb.minX < tb.minX || bb.minZ < tb.minZ || bb.maxX > tb.maxX || bb.maxZ > tb.maxZ) return fail('OUT_OF_BOUNDS', 'Emplacement hors de la carte');
    if (this.overlappingBuilding(o) !== 0) return fail('COLLISION', 'Emplacement déjà occupé par un bâtiment');
    if (this.roadClearance(o, MAX_ROAD_HALF_WIDTH) < 0) return fail('COLLISION', 'Le bâtiment empiète sur une route');
    // Relief : échantillons sur une grille LOCALE de l'empreinte (pas d'environ une case).
    let hMin = Infinity;
    let hMax = -Infinity;
    let hSum = 0;
    let n = 0;
    const nx = Math.max(1, asset.footprint.tilesX), nz = Math.max(1, asset.footprint.tilesZ);
    for (let j = 0; j <= nz; j++) {
      for (let i = 0; i <= nx; i++) {
        const [wx, wz] = obbToWorld(o, -o.hx + (2 * o.hx * i) / nx, -o.hz + (2 * o.hz * j) / nz);
        const h = terrainHeightAt(t, wx, wz);
        if (h < hMin) hMin = h;
        if (h > hMax) hMax = h;
        hSum += h;
        n++;
        if (this.wetAt(wx, wz)) return fail('UNDER_WATER', 'Impossible de construire sur une rivière ou un lac');
      }
    }
    if (hMin < t.waterLevel + 0.3) return fail('UNDER_WATER', 'Impossible de construire dans l\'eau');
    const span = Math.max(asset.footprint.tilesX, asset.footprint.tilesZ) * TILE_SIZE;
    if ((hMax - hMin) / span > MAX_BUILDING_SLOPE) return fail('TOO_STEEP', 'Terrain trop pentu pour ce bâtiment');
    if (this.economy.bankrupt) return fail('INSUFFICIENT_FUNDS', 'Ville en faillite : constructions suspendues jusqu\'au retour d\'une trésorerie positive');
    if (!this.economy.canAfford(asset.cost)) return fail('INSUFFICIENT_FUNDS', `Fonds insuffisants (${asset.cost} crédits requis)`);
    if (a.dryRun) return { ok: true, data: { buildingId: 0, cost: asset.cost } };

    const id = this.nextBuildingId++;
    const y = hSum / n;
    this.insertBuilding({ id, assetId: asset.id, variant, x, z, y, rot });
    this.economy.spend(asset.cost);
    return { ok: true, data: { buildingId: id, cost: asset.cost } };
  }

  /** Insertion sans contrôle ni coût (utilisée par placeBuilding et le chargement). */
  private insertBuilding(r: BuildingRecord, silent = false): void {
    const asset = this.getAsset(r.assetId)!;
    const o = this.obbFor(asset, r.x, r.z, r.rot);
    this.obbs.set(r.id, o);
    const bi = this.buildings.add(r.id, this.assetIndex.get(asset.id)!, r.variant, r.x, r.y, r.z, normRot(r.rot), asset.footprint.tilesX, asset.footprint.tilesZ);
    const bb = obbAabb(o);
    this.buildingIndex.insert(r.id, bb.minX, bb.minZ, bb.maxX, bb.maxZ);
    this.buildings.roadAccess[bi] = this.computeRoadAccess(bi) ? 1 : 0;
    this.economy.addUpkeep(asset.upkeepPerMonth, 'buildings');
    this.demography?.onBuildingAdded(r.id, this.clock.totalMinutes);
    this.trafficBuildingsDirty = true;
    this.jobsDirty = true;
    if (!silent) this.pendingBuildingsAdded.push({ ...r });
  }

  /** Accès route : une route passe à moins de ROAD_ACCESS_MARGIN_M de l'empreinte. */
  private computeRoadAccess(bi: number): boolean {
    const o = this.obbs.get(this.buildings.id[bi]!);
    if (!o) return false;
    return this.roadClearance(o, MAX_ROAD_HALF_WIDTH + ROAD_ACCESS_MARGIN_M) <= ROAD_ACCESS_MARGIN_M;
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
    this.obbs.delete(a.buildingId);
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

  /** Obstacles du planificateur : emprises des bâtiments (polyligne du tracé courbe). */
  private readonly roadBlocked = (curve: Float64Array, half: number): string | null => {
    const [x0, z0, x1, z1] = cubicBounds(curve);
    this.buildingIndex.query(x0 - half, z0 - half, x1 + half, z1 + half, this.q);
    if (this.q.length === 0) return null;
    const n = Math.max(2, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 6));
    const poly = polyline(curve, n);
    for (const id of this.q) {
      const o = this.obbs.get(id);
      if (!o) continue;
      for (let k = 0; k + 3 < poly.length; k += 2) {
        if (distSegmentObb(poly[k]!, poly[k + 1]!, poly[k + 2]!, poly[k + 3]!, o) < half) {
          return 'Le tracé traverse un bâtiment';
        }
      }
    }
    return null;
  };

  private planOptions(): { bounds: { minX: number; minZ: number; maxX: number; maxZ: number }; blocked: (c: Float64Array, h: number) => string | null } {
    const b = terrainBounds(this.terrain!);
    const m = 24;
    return { bounds: { minX: b.minX + m, minZ: b.minZ + m, maxX: b.maxX - m, maxZ: b.maxZ - m }, blocked: this.roadBlocked };
  }

  /** Découpe la commande en requêtes du planificateur (2 points + contrôle = courbe ; polyligne = tronçons droits). */
  private roadRequests(a: CommandArgs<'buildRoad'>, kind: RoadKindId): RoadRequest[] {
    const pts = a.points;
    if (pts.length === 4) {
      const req: RoadRequest = { kind, start: { x: pts[0]!, z: pts[1]! }, end: { x: pts[2]!, z: pts[3]! } };
      if (a.control) req.control = { x: a.control[0], z: a.control[1] };
      return [req];
    }
    const out: RoadRequest[] = [];
    for (let k = 0; k + 3 < pts.length; k += 2) {
      if (dist2(pts[k]!, pts[k + 1]!, pts[k + 2]!, pts[k + 3]!) < 1) continue;
      out.push({ kind, start: { x: pts[k]!, z: pts[k + 1]! }, end: { x: pts[k + 2]!, z: pts[k + 3]! } });
    }
    return out;
  }

  buildRoad(a: CommandArgs<'buildRoad'>): CmdOutcome<'buildRoad'> {
    if (!this.terrain) return fail('NO_GAME', 'Aucune partie en cours');
    const kind: RoadKindId = a.kind && isRoadKind(a.kind) ? a.kind : a.type;
    const reqs = this.roadRequests(a, kind);
    if (reqs.length === 0) return fail('INVALID_ARGS', 'Tracé trop court');
    const opts = this.planOptions();
    // 1) Validation de chaque morceau sur le réseau actuel (dryRun : rien n'est modifié).
    let cost = 0;
    for (const r of reqs) {
      const p = planRoad(this.net, r, opts);
      if (!p.ok) return fail(p.error.code, p.error.message, p.error.phase);
      cost += p.plan.cost;
    }
    if (this.economy.bankrupt) return fail('INSUFFICIENT_FUNDS', 'Ville en faillite : constructions suspendues jusqu\'au retour d\'une trésorerie positive');
    if (!this.economy.canAfford(cost)) return fail('INSUFFICIENT_FUNDS', `Fonds insuffisants (${cost} crédits requis)`);
    if (a.dryRun) return { ok: true, data: { edgeIds: [], cost } };
    // 2) Construction : chaque morceau est re-planifié sur le réseau modifié par le précédent.
    const edgeIds: number[] = [];
    let spent = 0;
    for (const r of reqs) {
      const p = planRoad(this.net, r, opts);
      if (!p.ok) {
        if (edgeIds.length === 0) return fail(p.error.code, p.error.message, p.error.phase);
        this.notify('warn', `Tracé interrompu : ${p.error.message}`);
        break;
      }
      const c = commitRoadPlan(this.net, p.plan);
      edgeIds.push(...c.segmentIds);
      spent += p.plan.cost;
    }
    this.economy.spend(spent);
    this.applyNetworkChanges(true);
    return { ok: true, data: { edgeIds, cost: spent } };
  }

  /**
   * Répercute le journal du réseau : index spatiaux, entretien, longueur, accès route des bâtiments,
   * nivellement du terrain, trafic et deltas pour le rendu. `withDelta` = faux au chargement.
   */
  private applyNetworkChanges(withDelta: boolean): void {
    const ch = this.net.takeChanges();
    const t = this.terrain!;
    let bx0 = Infinity, bz0 = Infinity, bx1 = -Infinity, bz1 = -Infinity;
    const grow = (x0: number, z0: number, x1: number, z1: number): void => {
      bx0 = Math.min(bx0, x0); bz0 = Math.min(bz0, z0); bx1 = Math.max(bx1, x1); bz1 = Math.max(bz1, z1);
    };
    for (const id of ch.segmentsRemoved) {
      const info = this.segInfo.get(id);
      if (info) {
        this.roadLength -= info.length;
        this.economy.removeUpkeep(ROAD_KINDS[info.kind].upkeepPerMeterMonth * info.length, 'roads');
        this.segInfo.delete(id);
      }
      const poly = this.segPolys.get(id);
      if (poly) {
        for (let k = 0; k < poly.length; k += 2) grow(poly[k]!, poly[k + 1]!, poly[k]!, poly[k + 1]!);
        this.segPolys.delete(id);
      }
      this.edgeIndex.remove(id);
      if (withDelta && !ch.segmentsAdded.includes(id)) this.pendingEdgesRemoved.push(id);
    }
    const added = ch.segmentsAdded.filter((id) => this.net.hasSegment(id));
    for (const id of added) {
      const kind = this.net.kindOf(id);
      const length = this.net.length(id);
      this.segInfo.set(id, { kind, length });
      this.roadLength += length;
      this.economy.addUpkeep(ROAD_KINDS[kind].upkeepPerMeterMonth * length, 'roads');
      const curve = this.net.curve(id);
      const poly = polyline(curve, Math.max(2, Math.ceil(length / 8)));
      this.segPolys.set(id, poly);
      const [x0, z0, x1, z1] = cubicBounds(curve);
      const half = halfWidth(kind);
      this.edgeIndex.insert(id, x0 - half, z0 - half, x1 + half, z1 + half);
      grow(x0 - half, z0 - half, x1 + half, z1 + half);
    }
    if (bx0 <= bx1) {
      // Nivellement : hauteurs naturelles + plateforme/talus de TOUTES les routes (résultat indépendant de l'ordre
      // de construction, donc identique après chargement d'une sauvegarde). Zone modifiée = différence.
      const before = t.heights;
      const graded = new Float32Array(this.naturalHeights);
      t.heights = graded;
      if (this.net.segCount > 0) gradeTerrainForRoads(t, this.net);
      let i0 = t.samplesX, j0 = t.samplesZ, i1 = -1, j1 = -1;
      for (let j = 0; j < t.samplesZ; j++) {
        const row = j * t.samplesX;
        for (let i = 0; i < t.samplesX; i++) {
          if (graded[row + i] !== before[row + i]) {
            if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j;
          }
        }
      }
      if (withDelta && i1 >= 0) {
        const p = this.pendingPatch;
        this.pendingPatch = p ? { i0: Math.min(p.i0, i0), j0: Math.min(p.j0, j0), i1: Math.max(p.i1, i1), j1: Math.max(p.j1, j1) } : { i0, j0, i1, j1 };
      }
      if (withDelta) this.refreshRoadAccessNear(bx0, bz0, bx1, bz1);
    }
    if (withDelta) {
      const rec = networkRecords(this.net, ch.nodesAdded, added);
      this.pendingNodesAdded.push(...rec.nodes);
      this.pendingEdgesAdded.push(...rec.edges);
    }
    this.traffic.setNetwork(inputFromRoadNetwork(this.net));
  }

  removeRoad(a: CommandArgs<'removeRoad'>): CmdOutcome<'removeRoad'> {
    if (!this.terrain) return fail('NO_GAME', 'Aucune partie en cours');
    const info = this.segInfo.get(a.edgeId);
    if (!info || !this.net.hasSegment(a.edgeId)) return fail('NOT_FOUND', 'Tronçon introuvable');
    const refund = Math.round(ROAD_KINDS[info.kind].costPerMeter * info.length * DEMOLISH_REFUND_RATE);
    this.net.removeSegment(a.edgeId);
    this.economy.refund(refund);
    this.applyNetworkChanges(true);
    return { ok: true, data: { refund } };
  }

  /** Marge de recherche autour d'une route pour l'accès des bâtiments et le talus. */
  static readonly ROAD_REACH = MAX_ROAD_HALF_WIDTH + SLOPE_WIDTH;

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
        this.plugins.onDayStart();
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
        this.plugins.onMonthStart();
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

  /**
   * Un pas de simulation. `minutes` (minutes de jeu du pas) vaut GAME_MINUTES_PER_TICK en jeu ; les tests
   * l'augmentent pour faire défiler des journées entières rapidement (même logique, moins de pas).
   */
  tick(minutes: number = GAME_MINUTES_PER_TICK): void {
    if (!this.terrain) return;
    this.clock.advance(minutes);
    const now = this.clock.totalMinutes;
    this.scheduler.runDue(now, this.onEvent);
    const demo = this.demography;
    if (demo) {
      demo.tick(now);
      demo.drainTrips(TRIPS_PER_TICK, this.sendTrip);
    }
    this.traffic.step(0.1, this.clock.hourOfDay);
    this.plugins.onTick(minutes);
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
      + this.pendingEdgesAdded.length + this.pendingEdgesRemoved.length > 0 || this.pendingPatch !== null;
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
    if (this.pendingPatch && this.terrain) {
      msg.terrainPatch = extractPatch(this.terrain, this.pendingPatch);
      this.pendingPatch = null;
    }
    const signals = this.takeSignalFrame();
    if (signals) msg.signals = signals;
    const ext = this.plugins.takeDelta();
    if (ext) msg.ext = ext;
    return msg;
  }

  /** Dernière version de disposition des feux et derniers états envoyés au rendu (-1 : rien d'envoyé). */
  private signalVersionSent = -1;
  private signalStatesSent = new Uint8Array(0);

  /**
   * Feux tricolores pour le delta : disposition si le réseau a changé depuis le dernier envoi (ou après un
   * instantané), états seulement s'ils ont changé ; null sinon (aucun octet envoyé en régime établi).
   */
  takeSignalFrame(): SignalFrame | null {
    this.traffic.ensureNetwork();
    const version = this.traffic.signalLayoutVersion;
    const states = this.traffic.signalStateArray();
    const layoutChanged = version !== this.signalVersionSent;
    if (!layoutChanged) {
      const prev = this.signalStatesSent;
      let same = prev.length === states.length;
      for (let i = 0; same && i < states.length; i++) same = prev[i] === states[i];
      if (same) return null;
    }
    this.signalVersionSent = version;
    this.signalStatesSent = states.slice();
    const frame: SignalFrame = { version, states };
    if (layoutChanged) frame.layout = { version, ...this.traffic.signalLayout() };
    return frame;
  }

  /** Instantané complet ; la carte de hauteurs est COPIÉE (la copie sera transférée). */
  snapshot(): SnapshotMessage {
    const t = this.terrain!;
    this.clearPending();
    // Le rendu repart de zéro après un instantané : la disposition des feux sera renvoyée au prochain delta.
    this.signalVersionSent = -1;
    const msg: SnapshotMessage = {
      kind: 'snapshot',
      params: { ...this.params! },
      // Toutes les couches sont COPIÉES : les copies sont transférées (collectTransferables).
      terrain: {
        ...t, heights: new Float32Array(t.heights), waterSurface: new Float32Array(t.waterSurface), moisture: new Uint8Array(t.moisture),
        forest: new Uint8Array(t.forest), resources: new Uint8Array(t.resources),
        rivers: t.rivers.map((r) => ({ ...r, points: new Float32Array(r.points) })),
      } as WorldTerrain,
      buildings: this.buildingRecords(),
      roads: this.roadRecords(),
      stats: { ...this.getStats(), date: { ...this.stats.date } },
    };
    const ext = this.plugins.snapshot();
    if (ext) msg.ext = ext;
    return msg;
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
    const r = networkRecords(this.net);
    r.nodes.sort((a, b) => a.id - b.id);
    r.edges.sort((a, b) => a.id - b.id);
    return r;
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
        case 'buildCity': {
          const a = args as ExtCommandArgs<'buildCity'>;
          const r = buildCity(this, a.maxBuildings === undefined ? { preset: a.preset } : { preset: a.preset, maxBuildings: a.maxBuildings });
          const waves = a.settleWaves ?? (a.preset === 'demo' ? 30 : 40);
          if (waves > 0) this.runExt('settle', { waves });
          // Le trafic voit tout de suite les occupants (sinon : à la prochaine synchronisation horaire).
          this.trafficBuildingsDirty = true;
          this.onEvent(SimEvent.TrafficSync);
          const vehicles = a.vehicles ? this.seedTraffic(a.vehicles) : 0;
          return ok({ ...r, vehicles });
        }
      }
      return fail('INVALID_ARGS', 'Commande inconnue');
    })();
    return out as ExtOutcome<K>;
  }

  /** Commande d'un module de phase 2 (module inconnu : INVALID_ARGS ; exceptions du module attrapées). */
  pluginCommand(a: CommandArgs<'pluginCommand'>): CmdOutcome<'pluginCommand'> {
    if (!this.terrain) return fail('NO_GAME', 'Aucune partie en cours');
    return this.plugins.command(a.plugin, a.name, a.payload);
  }

  /* ---------------------------- Sauvegarde ---------------------------- */

  toSave(): SaveFileV2 & PluginSaveField {
    const save: SaveFileV2 & PluginSaveField = {
      format: SAVE_FORMAT_ID,
      version: CURRENT_SAVE_VERSION,
      savedAt: new Date().toISOString(),
      params: { ...this.params! },
      clock: { totalMinutes: this.clock.totalMinutes },
      economy: this.economy.toJSON(),
      buildings: this.buildingRecords(),
      roads: this.roadRecords(),
      nextIds: { building: this.nextBuildingId, roadNode: this.net.nextNodeId, roadEdge: this.net.nextSegId },
      population: this.demo.toJSON(),
      sim: { rng: this.rng.getState(), scheduler: this.scheduler.toJSON() },
    };
    // Sections des modules (champ facultatif, absent si aucune) : sections inconnues conservées telles quelles.
    const plugins = this.plugins.save();
    if (plugins) save.plugins = plugins;
    return save;
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
    // Réseau routier : nœuds et tronçons avec leurs identifiants et courbes (absentes en v1 = tronçons droits).
    for (const n of s.roads.nodes) this.net.addNode(n.x, n.z, n.y, n.id);
    for (const e of s.roads.edges) {
      const kind: RoadKindId = e.kind && isRoadKind(e.kind) ? e.kind : e.type;
      const a = this.net.nodePos(e.a), b = this.net.nodePos(e.b);
      const c1 = e.c1 ?? [a.x + (b.x - a.x) / 3, a.z + (b.z - a.z) / 3];
      const c2 = e.c2 ?? [a.x + ((b.x - a.x) * 2) / 3, a.z + ((b.z - a.z) * 2) / 3];
      if (![...c1, ...c2].every(Number.isFinite)) return { code: 'BAD_SAVE', message: `Tronçon ${e.id} : courbe invalide` };
      this.net.addSegment(e.a, e.b, kind, cubic(a.x, a.z, c1[0], c1[1], c2[0], c2[1], b.x, b.z), e.id);
    }
    for (const id of this.net.nodeIds()) if (this.net.incident(id).length === 0) return { code: 'BAD_SAVE', message: `Nœud routier ${id} isolé` };
    this.net.nextNodeId = Math.max(this.net.nextNodeId, s.nextIds.roadNode);
    this.net.nextSegId = Math.max(this.net.nextSegId, s.nextIds.roadEdge);
    this.applyNetworkChanges(false);
    for (const b of s.buildings) {
      const a = this.getAsset(b.assetId)!;
      const o = this.obbFor(a, b.x, b.z, b.rot);
      const bb = obbAabb(o), tb = terrainBounds(this.terrain!);
      if (bb.minX < tb.minX - 0.01 || bb.minZ < tb.minZ - 0.01 || bb.maxX > tb.maxX + 0.01 || bb.maxZ > tb.maxZ + 0.01) {
        return { code: 'BAD_SAVE', message: `Bâtiment ${b.id} hors de la carte` };
      }
      const other = this.overlappingBuilding(o);
      if (other !== 0) return { code: 'BAD_SAVE', message: `Bâtiments ${b.id} et ${other} superposés` };
      this.insertBuilding(b, true);
    }
    this.economy.fromJSON(s.economy);
    this.nextBuildingId = s.nextIds.building;
    this.demo.fromJSON(s.population, s.clock.totalMinutes);
    if (s.sim) {
      this.rng.setState(s.sim.rng);
      this.scheduler.fromJSON(s.sim.scheduler);
      // Sauvegardes antérieures au ralentissement de l'horloge : périodes « temps réel » remises à jour.
      this.scheduler.retime(SimEvent.Migration, REALTIME_PERIODS.mig, this.clock.totalMinutes);
      this.scheduler.retime(SimEvent.TrafficSync, REALTIME_PERIODS.sync, this.clock.totalMinutes);
    } else {
      this.scheduleRecurring();
    }
    // Assiettes fiscales et effectifs recalculés depuis la population restaurée.
    const tb = this.demo.computeTaxBase(false);
    Object.assign(this.economy.taxBase, tb.taxBase);
    this.economy.serviceWorkers = tb.serviceWorkers;
    this.trafficBuildingsDirty = true;
    this.jobsDirty = true;
    // Modules : après l'état de base ; une section en erreur est notifiée et n'empêche pas le chargement.
    this.plugins.load((s as SaveFileV2 & PluginSaveField).plugins);
    this.clearPending();
    return null;
  }
}
