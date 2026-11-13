/**
 * Zonage — géométrie des routes vue par le zonage : polylignes des tronçons (cache invalidé par
 * `roads.version`), route la plus proche d'un point avec sa tangente et sa demi-largeur.
 * Seules les voies carrossables ouvrent une façade : pas d'autoroute (aucun accès riverain), pas de rue piétonne.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { ROAD_KINDS, halfWidth, polyline, type RoadKindId } from '../roads';
import type { PluginRoads } from '../plugins/types';

/** Vrai si un type de route peut desservir des bâtiments nés du zonage. */
export function servesZoning(kind: RoadKindId): boolean {
  return ROAD_KINDS[kind].vehicles && kind !== 'highway';
}

/** Route la plus proche : point de l'axe, tangente unitaire, distance à l'axe, demi-largeur (trottoirs compris). */
export interface RoadHit {
  segId: number;
  kind: RoadKindId;
  half: number;
  /** Point le plus proche sur l'axe. */
  x: number;
  z: number;
  tx: number;
  tz: number;
  /** Distance à l'axe (m). */
  d: number;
}

interface SegGeom { poly: Float64Array; half: number; kind: RoadKindId }

export class RoadGeometry {
  private version = -1;
  private roads: PluginRoads | null = null;
  private readonly segs = new Map<number, SegGeom>();
  private readonly q: number[] = [];
  /** Plus grande demi-largeur des voies desservantes (rayon de recherche). */
  maxHalf = 0;

  /** Oublie le cache (nouvelle partie : le réseau est un nouvel objet dont la version peut coïncider). */
  invalidate(): void { this.roads = null; this.version = -1; this.segs.clear(); this.maxHalf = 0; }

  /** Recharge le cache si le réseau a changé ; renvoie vrai dans ce cas. */
  sync(roads: PluginRoads): boolean {
    if (roads === this.roads && roads.version === this.version) return false;
    this.roads = roads;
    this.version = roads.version;
    this.segs.clear();
    this.maxHalf = 0;
    for (const id of roads.segmentIds()) {
      const kind = roads.kindOf(id);
      if (!servesZoning(kind)) continue;
      const n = Math.max(2, Math.min(64, Math.ceil(roads.length(id) / 4)));
      const half = halfWidth(kind);
      this.segs.set(id, { poly: polyline(roads.curve(id), n), half, kind });
      if (half > this.maxHalf) this.maxHalf = half;
    }
    return true;
  }

  get segmentCount(): number { return this.segs.size; }

  /** Polyligne d'un tronçon desservant (undefined sinon). */
  geom(segId: number): Readonly<SegGeom> | undefined { return this.segs.get(segId); }

  /**
   * Route desservante la plus proche dont le BORD est à moins de `maxEdge` m de (x, z) ; null sinon.
   * Classement par distance au bord (une avenue large l'emporte sur une rue étroite à axe égal).
   */
  nearest(x: number, z: number, maxEdge: number): RoadHit | null {
    const roads = this.roads;
    if (!roads || this.segs.size === 0) return null;
    const r = maxEdge + this.maxHalf;
    roads.segmentsIn(x - r, z - r, x + r, z + r, this.q);
    let best: RoadHit | null = null;
    let bestEdge = maxEdge;
    for (const id of this.q) {
      const g = this.segs.get(id);
      if (!g) continue;
      const p = g.poly;
      for (let k = 0; k + 3 < p.length; k += 2) {
        const ax = p[k]!, az = p[k + 1]!, bx = p[k + 2]!, bz = p[k + 3]!;
        const dx = bx - ax, dz = bz - az;
        const l2 = dx * dx + dz * dz;
        if (l2 < 1e-9) continue;
        let t = ((x - ax) * dx + (z - az) * dz) / l2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const cx = ax + dx * t, cz = az + dz * t;
        const d = Math.hypot(x - cx, z - cz);
        const edge = d - g.half;
        if (edge <= bestEdge) {
          const l = Math.sqrt(l2);
          bestEdge = edge;
          best = { segId: id, kind: g.kind, half: g.half, x: cx, z: cz, tx: dx / l, tz: dz / l, d };
        }
      }
    }
    return best;
  }

  /** Distance (m) de (x, z) au BORD du tronçon `segId` (Infinity s'il n'est pas desservant). */
  edgeDistance(segId: number, x: number, z: number): number {
    const g = this.segs.get(segId);
    if (!g) return Infinity;
    const p = g.poly;
    let best = Infinity;
    for (let k = 0; k + 3 < p.length; k += 2) {
      const ax = p[k]!, az = p[k + 1]!, bx = p[k + 2]!, bz = p[k + 3]!;
      const dx = bx - ax, dz = bz - az;
      const l2 = dx * dx + dz * dz;
      let t = l2 > 1e-9 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
      if (d < best) best = d;
    }
    return best - g.half;
  }
}
