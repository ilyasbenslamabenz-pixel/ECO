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
import { distPointSegment, projectOnSegment, rayBox, rotatedTiles, type Ray } from './geometry';

export interface RoadEdgeView extends RoadEdgeRecord { ax: number; az: number; bx: number; bz: number; ay: number; by: number }

/** Largeur d'un type de route ; tolère des types futurs (module routes) inconnus du contrat actuel. */
export function roadWidth(type: string): number {
  return (ROAD_TYPES as Record<string, RoadTypeDef | undefined>)[type]?.width ?? 10;
}

export function roadDef(type: string): RoadTypeDef | undefined {
  return (ROAD_TYPES as Record<string, RoadTypeDef | undefined>)[type];
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

  private changed(): void { this.version++; for (const l of this.listeners) l(); }

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
    const a = this.nodes.get(e.a);
    const b = this.nodes.get(e.b);
    if (!a || !b) return null;
    return { ...e, ax: a.x, az: a.z, ay: a.y, bx: b.x, bz: b.z, by: b.y };
  }

  /** Rectangle au sol occupé par un bâtiment (empreinte en cases, tournée). */
  buildingRect(b: BuildingRecord): { minX: number; minZ: number; maxX: number; maxZ: number } | null {
    const a = this.byId.get(b.assetId);
    if (!a) return null;
    const { tx, tz } = rotatedTiles(a.footprint.tilesX, a.footprint.tilesZ, b.rot);
    const hx = (tx * TILE_SIZE) / 2;
    const hz = (tz * TILE_SIZE) / 2;
    return { minX: b.x - hx, minZ: b.z - hz, maxX: b.x + hx, maxZ: b.z + hz };
  }

  /** Hauteur visuelle d'un bâtiment (catalogue × variante). */
  buildingHeight(b: BuildingRecord): number {
    const a = this.byId.get(b.assetId);
    if (!a) return 10;
    const v = b.variant >= 0 ? a.variants[b.variant] : undefined;
    return a.dimensions.height * (v?.heightScale ?? 1);
  }

  /** Route la plus proche d'un point au sol (distance à l'axe), dans un rayon maximal. */
  nearestEdge(x: number, z: number, maxDist: number): { edge: RoadEdgeView; dist: number; t: number } | null {
    let best: { edge: RoadEdgeView; dist: number; t: number } | null = null;
    for (const e of this.edges.values()) {
      const v = this.edgeView(e);
      if (!v) continue;
      const d = distPointSegment(x, z, v.ax, v.az, v.bx, v.bz);
      if (d <= maxDist && (!best || d < best.dist)) best = { edge: v, dist: d, t: projectOnSegment(x, z, v.ax, v.az, v.bx, v.bz) };
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
      const r = this.buildingRect(b);
      if (r && x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) return b;
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
      const r = this.buildingRect(b);
      if (!r) continue;
      const t = rayBox(ray, r.minX, b.y - 1, r.minZ, r.maxX, b.y + this.buildingHeight(b), r.maxZ);
      if (t >= 0 && (!best || t < best.distance)) best = { kind: 'building', id: b.id, record: b, asset: this.byId.get(b.assetId), distance: t };
    }
    if (best) return best;
    if (ground) {
      let bestD = Infinity;
      let bestE: RoadEdgeView | null = null;
      for (const e of this.edges.values()) {
        const v = this.edgeView(e);
        if (!v) continue;
        const d = distPointSegment(ground.x, ground.z, v.ax, v.az, v.bx, v.bz);
        if (d <= roadWidth(v.type) / 2 + 0.5 && d < bestD) { bestD = d; bestE = v; }
      }
      if (bestE) return { kind: 'road', id: bestE.id, edge: bestE, distance: bestD };
    }
    return null;
  }
}
