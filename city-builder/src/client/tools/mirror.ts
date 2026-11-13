/**
 * Miroir LECTURE SEULE de l'état de la simulation côté thread principal, alimenté par les
 * instantanés et deltas du worker. Sert à la sélection (picking), au snapping et aux panneaux.
 * Il ne décide jamais de la validité d'une action : c'est le rôle du worker (dryRun).
 * Pur TypeScript (ni three ni DOM).
 * Propriétaire : agent construction/caméra/UI.
 */
import { TILE_SIZE, VEHICLE_STRIDE } from '../../shared/constants';
import type { AssetCatalog, CatalogAsset } from '../../shared/catalog';
import { ROAD_TYPES, type RoadTypeDef, type BuildingRecord, type RoadEdgeRecord, type RoadNodeRecord, type SimStats, type TerrainData } from '../../shared/contracts';
import type { DeltaMessage, SnapshotMessage } from '../../shared/protocol';
import { footprintObb, obbAabb, pointInObb, type Obb } from '../../shared/footprint';
import { cubic, polyline } from '../../sim/roads/bezier';
import { ROAD_KINDS, halfWidth, isRoadKind, type RoadKindId } from '../../sim/roads/types';
import { rayBox, type Ray } from './geometry';

export interface RoadEdgeView extends RoadEdgeRecord {
  ax: number; az: number; bx: number; bz: number; ay: number; by: number;
  /** Type exact (6 types de la simulation). */
  kindId: RoadKindId;
  /** Polyligne de l'axe (courbe échantillonnée, x/z alternés). */
  poly: Float64Array;
}

/**
 * Largeur TOTALE (chaussée + trottoirs) d'un type de route, identique à la simulation
 * (6 types de src/sim/roads/types.ts) ; repli sur le contrat hérité pour un type inconnu.
 */
export function roadWidth(type: string): number {
  if (isRoadKind(type)) return halfWidth(type) * 2;
  return (ROAD_TYPES as Record<string, RoadTypeDef | undefined>)[type]?.width ?? 10;
}

/** Type exact d'un enregistrement de tronçon. */
export function edgeKind(e: RoadEdgeRecord): RoadKindId {
  return e.kind && isRoadKind(e.kind) ? e.kind : isRoadKind(e.type) ? e.type : 'street';
}

export { ROAD_KINDS };

export interface NearestEdge {
  edge: RoadEdgeView;
  /** Distance à l'axe (m). */
  dist: number;
  /** Paramètre approché (0..1) le long du tronçon. */
  t: number;
  /** Point de l'axe le plus proche et tangente unitaire en ce point. */
  px: number; pz: number; tx: number; tz: number;
}

/** Fiche d'un type de route pour l'interface (données de la simulation : src/sim/roads/types.ts). */
export interface RoadKindInfo {
  id: RoadKindId;
  nameFr: string;
  /** Largeur totale chaussée + trottoirs (m). */
  width: number;
  lanesForward: number;
  lanesBackward: number;
  speedKmh: number;
  costPerMeter: number;
  upkeepPerMeterMonth: number;
}

export function roadDef(type: string): RoadKindInfo | undefined {
  if (!isRoadKind(type)) return undefined;
  const k = ROAD_KINDS[type];
  return { id: type, nameFr: k.nameFr, width: halfWidth(type) * 2, lanesForward: k.lanesForward, lanesBackward: k.lanesBackward, speedKmh: k.speedKmh, costPerMeter: k.costPerMeter, upkeepPerMeterMonth: k.upkeepPerMeterMonth };
}

export type PickResult =
  | { kind: 'building'; id: number; record: BuildingRecord; asset: CatalogAsset | undefined; distance: number }
  | { kind: 'road'; id: number; edge: RoadEdgeView; distance: number }
  | { kind: 'vehicle'; index: number; assetIndex: number; asset: CatalogAsset | undefined; x: number; y: number; z: number; heading: number; distance: number };

export class WorldMirror {
  readonly buildings = new Map<number, BuildingRecord>();
  readonly nodes = new Map<number, RoadNodeRecord>();
  readonly edges = new Map<number, RoadEdgeRecord>();
  terrain: TerrainData | null = null;
  stats: SimStats | null = null;
  cityName = '';
  /** Dernière trame véhicules reçue (références aux buffers transférés, lecture seule). */
  vehiclePositions: Float32Array | null = null;
  vehicleAssets: Uint16Array | null = null;
  vehicleCount = 0;
  /** Incrémenté à chaque changement de bâtiments/routes (invalidation des caches). */
  version = 0;
  private byId = new Map<string, CatalogAsset>();
  private views = new Map<number, RoadEdgeView>();
  private obbs = new Map<number, Obb>();
  private listeners: (() => void)[] = [];

  constructor(public catalog: AssetCatalog) { this.setCatalog(catalog); }

  setCatalog(c: AssetCatalog): void {
    this.catalog = c;
    this.byId = new Map(c.assets.map((a) => [a.id, a]));
  }

  asset(id: string): CatalogAsset | undefined { return this.byId.get(id); }

  onChange(fn: () => void): () => void {
    this.listeners.push(fn);
    return () => { this.listeners = this.listeners.filter((l) => l !== fn); };
  }

  private changed(): void { this.version++; this.views.clear(); this.obbs.clear(); for (const l of this.listeners) l(); }

  applySnapshot(s: SnapshotMessage): void {
    this.buildings.clear(); this.nodes.clear(); this.edges.clear();
    this.terrain = s.terrain;
    this.stats = s.stats;
    this.cityName = s.params.cityName;
    for (const b of s.buildings) this.buildings.set(b.id, b);
    for (const n of s.roads.nodes) this.nodes.set(n.id, n);
    for (const e of s.roads.edges) this.edges.set(e.id, e);
    this.vehicleCount = 0;
    this.changed();
  }

  applyDelta(d: DeltaMessage): void {
    this.stats = d.stats;
    if (d.vehicles) {
      this.vehiclePositions = d.vehicles.positions;
      this.vehicleAssets = d.vehicles.assetIndices;
      this.vehicleCount = d.vehicles.count;
    }
    if (!d.buildingsAdded.length && !d.buildingsRemoved.length && !d.roadNodesAdded.length && !d.roadEdgesAdded.length && !d.roadEdgesRemoved.length) return;
    for (const id of d.buildingsRemoved) this.buildings.delete(id);
    for (const b of d.buildingsAdded) this.buildings.set(b.id, b);
    for (const n of d.roadNodesAdded) this.nodes.set(n.id, n);
    for (const id of d.roadEdgesRemoved) this.edges.delete(id);
    for (const e of d.roadEdgesAdded) this.edges.set(e.id, e);
    this.changed();
  }

  edgeView(e: RoadEdgeRecord): RoadEdgeView | null {
    const cached = this.views.get(e.id);
    if (cached && cached.a === e.a && cached.b === e.b) return cached;
    const a = this.nodes.get(e.a);
    const b = this.nodes.get(e.b);
    if (!a || !b) return null;
    const c1 = e.c1 ?? [a.x + (b.x - a.x) / 3, a.z + (b.z - a.z) / 3];
    const c2 = e.c2 ?? [a.x + ((b.x - a.x) * 2) / 3, a.z + ((b.z - a.z) * 2) / 3];
    const curved = !!(e.c1 && e.c2);
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    // Même pas d'échantillonnage que la simulation (≈ 8 m) pour des distances route/emprise cohérentes.
    const poly = curved ? polyline(cubic(a.x, a.z, c1[0], c1[1], c2[0], c2[1], b.x, b.z), Math.max(2, Math.ceil((e.length || len) / 8))) : new Float64Array([a.x, a.z, b.x, b.z]);
    const v: RoadEdgeView = { ...e, ax: a.x, az: a.z, ay: a.y, bx: b.x, bz: b.z, by: b.y, kindId: edgeKind(e), poly };
    this.views.set(e.id, v);
    return v;
  }

  /** Empreinte orientée d'un bâtiment (angle libre). */
  buildingObb(b: BuildingRecord): Obb | null {
    const cached = this.obbs.get(b.id);
    if (cached && cached.cx === b.x && cached.cz === b.z) return cached;
    const a = this.byId.get(b.assetId);
    if (!a) return null;
    const o = footprintObb(a.footprint.tilesX, a.footprint.tilesZ, b.x, b.z, b.rot);
    this.obbs.set(b.id, o);
    return o;
  }

  /** Boîte englobante alignée de l'empreinte (sélection, marqueurs). */
  buildingRect(b: BuildingRecord): { minX: number; minZ: number; maxX: number; maxZ: number } | null {
    const o = this.buildingObb(b);
    return o ? obbAabb(o) : null;
  }

  /** Hauteur visuelle d'un bâtiment (catalogue × variante). */
  buildingHeight(b: BuildingRecord): number {
    const a = this.byId.get(b.assetId);
    if (!a) return 10;
    const v = b.variant >= 0 ? a.variants[b.variant] : undefined;
    return a.dimensions.height * (v?.heightScale ?? 1);
  }

  /** Route la plus proche d'un point au sol (distance à l'axe COURBE), dans un rayon maximal. */
  nearestEdge(x: number, z: number, maxDist: number): NearestEdge | null {
    let best: NearestEdge | null = null;
    for (const e of this.edges.values()) {
      const v = this.edgeView(e);
      if (!v) continue;
      const p = v.poly;
      const nSeg = p.length / 2 - 1;
      for (let k = 0; k + 3 < p.length; k += 2) {
        const ax = p[k]!, az = p[k + 1]!, ex = p[k + 2]! - ax, ez = p[k + 3]! - az;
        const l2 = ex * ex + ez * ez;
        const u = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2)) : 0;
        const px = ax + ex * u, pz = az + ez * u;
        const d = Math.hypot(x - px, z - pz);
        if (d <= maxDist && (!best || d < best.dist)) {
          const l = Math.sqrt(l2) || 1;
          best = { edge: v, dist: d, t: (k / 2 + u) / nSeg, px, pz, tx: ex / l, tz: ez / l };
        }
      }
    }
    return best;
  }

  /** Distance d'un point à l'axe (courbe) d'un tronçon. */
  distToEdge(v: RoadEdgeView, x: number, z: number): number {
    const p = v.poly;
    let best = Infinity;
    for (let k = 0; k + 3 < p.length; k += 2) {
      const ax = p[k]!, az = p[k + 1]!, ex = p[k + 2]! - ax, ez = p[k + 3]! - az;
      const l2 = ex * ex + ez * ez;
      const u = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2)) : 0;
      best = Math.min(best, Math.hypot(x - ax - ex * u, z - az - ez * u));
    }
    return best;
  }

  nearestNode(x: number, z: number, maxDist: number): RoadNodeRecord | null {
    let best: RoadNodeRecord | null = null;
    let bd = maxDist;
    for (const n of this.nodes.values()) {
      const d = Math.hypot(n.x - x, n.z - z);
      if (d <= bd) { bd = d; best = n; }
    }
    return best;
  }

  /** Bâtiment dont l'empreinte contient le point au sol. */
  buildingAt(x: number, z: number): BuildingRecord | null {
    for (const b of this.buildings.values()) {
      const o = this.buildingObb(b);
      if (o && pointInObb(o, x, z)) return b;
    }
    return null;
  }

  /**
   * Sélection sous le curseur. `ray` : rayon caméra (direction normalisée) ; `ground` : point
   * d'impact sur le terrain (ou null). Ordre : véhicule, bâtiment (boîte 3D, donc les tours
   * sont cliquables en hauteur), route (distance à l'axe ≤ demi-largeur).
   */
  pick(ray: Ray, ground: { x: number; z: number } | null): PickResult | null {
    let best: PickResult | null = null;
    // Véhicules : sphère de 3 m autour de la position.
    if (this.vehiclePositions && this.vehicleAssets) {
      const p = this.vehiclePositions;
      for (let i = 0; i < this.vehicleCount; i++) {
        const o = i * VEHICLE_STRIDE;
        const x = p[o]!; const y = p[o + 1]! + 1; const z = p[o + 2]!;
        const t = rayBox(ray, x - 2.5, y - 1.5, z - 2.5, x + 2.5, y + 1.5, z + 2.5);
        if (t >= 0 && (!best || t < best.distance)) {
          const ai = this.vehicleAssets[i]!;
          best = { kind: 'vehicle', index: i, assetIndex: ai, asset: this.catalog.assets[ai], x, y: p[o + 1]!, z, heading: p[o + 3]!, distance: t };
        }
      }
      if (best) return best;
    }
    for (const b of this.buildings.values()) {
      const o = this.buildingObb(b);
      if (!o) continue;
      // Rayon exprimé dans le repère local du bâtiment : boîte orientée exacte (angle libre).
      const [lox, loz] = [(ray.ox - o.cx) * o.c - (ray.oz - o.cz) * o.s, (ray.ox - o.cx) * o.s + (ray.oz - o.cz) * o.c];
      const local = { ox: lox, oy: ray.oy, oz: loz, dx: ray.dx * o.c - ray.dz * o.s, dy: ray.dy, dz: ray.dx * o.s + ray.dz * o.c };
      const t = rayBox(local, -o.hx, b.y - 1, -o.hz, o.hx, b.y + this.buildingHeight(b), o.hz);
      if (t >= 0 && (!best || t < best.distance)) best = { kind: 'building', id: b.id, record: b, asset: this.byId.get(b.assetId), distance: t };
    }
    if (best) return best;
    if (ground) {
      let bestD = Infinity;
      let bestE: RoadEdgeView | null = null;
      for (const e of this.edges.values()) {
        const v = this.edgeView(e);
        if (!v) continue;
        const near = this.distToEdge(v, ground.x, ground.z);
        if (near <= roadWidth(v.kindId) / 2 + 0.5 && near < bestD) { bestD = near; bestE = v; }
      }
      if (bestE) return { kind: 'road', id: bestE.id, edge: bestE, distance: bestD };
    }
    return null;
  }
}
