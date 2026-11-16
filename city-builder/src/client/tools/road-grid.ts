/**
 * Quadrillage local côté client : trame de la route la plus proche d'un point (src/shared/road-grid.ts), recalée
 * le long de la route sur le bâtiment parallèle voisin s'il existe. Utilisé par le quadrillage au sol (outil Bâtiment)
 * et par l'aimantation de l'outil de pose : ce que le joueur voit est exactement là où le bâtiment se pose.
 * TypeScript pur (aucun three).
 */
import { pickPhase, roadGridFrame, type RoadGridFrame } from '../../shared/road-grid';
import type { Obb } from '../../shared/footprint';
import { roadWidth, type NearestEdge, type WorldMirror } from './mirror';

/** Au-delà de cette distance (m) au BORD de la route, le quadrillage reprend les axes du monde (pose libre). */
export const ROAD_GRID_REACH = 40;

/** Empreintes des bâtiments à moins de `r` m de (x, z). */
export function obbsNear(m: WorldMirror, x: number, z: number, r: number): Obb[] {
  const out: Obb[] = [];
  for (const b of m.buildings.values()) {
    if (Math.abs(b.x - x) > r || Math.abs(b.z - z) > r) continue;
    const o = m.buildingObb(b);
    if (o) out.push(o);
  }
  return out;
}

/** Trame d'une route trouvée par `nearestEdge`, avec la phase du voisin parallèle le plus proche de (x, z). */
export function frameForEdge(m: WorldMirror, near: NearestEdge, x: number, z: number): RoadGridFrame {
  const half = roadWidth(near.edge.kindId) / 2;
  const f = roadGridFrame(near.px, near.pz, near.tx, near.tz, half);
  f.phase = pickPhase(f, obbsNear(m, x, z, 90), x, z);
  return f;
}

/** Trame locale au point (x, z) ; null loin de toute route (quadrillage du monde). */
export function localRoadGrid(m: WorldMirror, x: number, z: number, reach = ROAD_GRID_REACH): { frame: RoadGridFrame; edgeId: number } | null {
  const near = m.nearestEdge(x, z, reach + 16);
  if (!near) return null;
  if (near.dist - roadWidth(near.edge.kindId) / 2 > reach) return null;
  return { frame: frameForEdge(m, near, x, z), edgeId: near.edge.id };
}
