/**
 * Quadrillage local côté client : champ de trames de la carte (src/shared/grid-field.ts) construit sur le miroir de
 * la simulation (routes, empreintes des bâtiments), mis en cache par version du miroir. Utilisé par le quadrillage au
 * sol de tous les outils, les cases de l'outil Zones et l'aimantation de l'outil de pose : ce que le joueur voit est
 * exactement là où le bâtiment se pose. TypeScript pur (aucun three).
 */
import { FIELD_ROAD_REACH, GridField, ObbBuckets, type FieldRoad } from '../../shared/grid-field';
import { pickPhase, roadGridFrame, type RoadGridFrame } from '../../shared/road-grid';
import type { Obb } from '../../shared/footprint';
import { roadWidth, type NearestEdge, type WorldMirror } from './mirror';

/** Au-delà de cette distance (m) au BORD de la route, le quadrillage ne suit plus la route (champ : bâtiment voisin ou monde). */
export const ROAD_GRID_REACH = FIELD_ROAD_REACH;

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

const cache = new WeakMap<WorldMirror, { version: number; field: GridField }>();

/** Routes du miroir vues par le champ (axe, demi-largeur trottoirs compris). */
export function mirrorFieldRoads(m: WorldMirror): FieldRoad[] {
  const roads: FieldRoad[] = [];
  for (const e of m.edges.values()) {
    const v = m.edgeView(e);
    if (v) roads.push({ id: v.id, poly: v.poly, half: roadWidth(v.kindId) / 2 });
  }
  return roads;
}

/** Champ de trames du miroir (recalculé quand les routes ou les bâtiments changent). */
export function fieldFor(m: WorldMirror): GridField {
  const c = cache.get(m);
  if (c && c.version === m.version) return c.field;
  const obbs: Obb[] = [];
  for (const b of m.buildings.values()) { const o = m.buildingObb(b); if (o) obbs.push(o); }
  const field = new GridField(mirrorFieldRoads(m), new ObbBuckets(obbs).query);
  cache.set(m, { version: m.version, field });
  return field;
}

/**
 * Trame d'une route trouvée par `nearestEdge` en (x, z) : celle du champ (lignes affichées) si elle suit cette route,
 * sinon (bord de champ) la trame de la route avec la phase du voisin parallèle le plus proche.
 */
export function frameForEdge(m: WorldMirror, near: NearestEdge, x: number, z: number): RoadGridFrame {
  const half = roadWidth(near.edge.kindId) / 2;
  const f = roadGridFrame(near.px, near.pz, near.tx, near.tz, half);
  const g = fieldFor(m).roadFrameAt(x, z);
  const s = g && g.tx * f.tx + g.tz * f.tz > 0 ? 1 : -1;
  if (g && Math.abs(g.tx * f.tx + g.tz * f.tz) > 0.9995 && Math.abs(g.cn - s * f.cn) < 0.6 && Math.abs(g.offset - f.offset) < 0.01) {
    // Même route (même axe à la courbure près) : trame du champ, réexprimée dans le sens de `f`.
    f.phase = ((s * g.phase) % f.cell + f.cell) % f.cell;
    return f;
  }
  f.phase = pickPhase(f, obbsNear(m, x, z, 90), x, z);
  return f;
}

/** Trame locale de route au point (x, z) ; null loin de toute route. */
export function localRoadGrid(m: WorldMirror, x: number, z: number, reach = ROAD_GRID_REACH): { frame: RoadGridFrame; edgeId: number } | null {
  const near = m.nearestEdge(x, z, reach + 16);
  if (!near) return null;
  if (near.dist - roadWidth(near.edge.kindId) / 2 > reach) return null;
  return { frame: frameForEdge(m, near, x, z), edgeId: near.edge.id };
}
