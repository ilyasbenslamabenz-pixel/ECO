/**
 * Placement intelligent des bâtiments (pur TypeScript) :
 * - près d'une route : la façade (premier point `frontage` du catalogue) est tournée vers la
 *   route et le bâtiment est reculé juste au-delà de la chaussée, en glissant le long de la voie ;
 * - sinon : placement libre aligné sur la grille, rotation choisie par le joueur.
 * Le résultat n'est qu'une PROPOSITION : la validité réelle (collision, pente, eau, fonds)
 * est demandée au worker par un placeBuilding { dryRun: true }.
 * Propriétaire : agent construction/caméra/UI.
 */
import { TILE_SIZE } from '../../shared/constants';
import type { CatalogAsset } from '../../shared/catalog';
import { rotateQuarter } from '../../shared/math';
import { distPointRect, distSegmentRect, gridFootprint, type GridFootprint } from './geometry';
import { roadWidth, type WorldMirror } from './mirror';

export interface PlacementProposal {
  x: number;
  z: number;
  rot: number;
  /** Vrai si aligné automatiquement sur une route. */
  snapped: boolean;
  edgeId: number | null;
  rect: GridFootprint;
  /** Avertissement local (indicatif) : chevauchement prévisible avec une route ou un bâtiment. */
  localConflict: boolean;
}

/** Normale locale de façade (rot = 0) d'après le catalogue ; +Z par défaut. */
export function localFacade(asset: CatalogAsset): [number, number] {
  const f = asset.frontage[0];
  if (!f) return [0, 1];
  const ax = Math.abs(f.nx);
  const az = Math.abs(f.nz);
  // Les empreintes sont des rectangles de cases : on ramène la normale à l'axe dominant.
  return az >= ax ? [0, Math.sign(f.nz) || 1] : [Math.sign(f.nx), 0];
}

/** Rotation (0..3) qui oriente la façade le plus possible vers la direction (dx, dz). */
export function rotationFacing(asset: CatalogAsset, dx: number, dz: number): number {
  const [lx, lz] = localFacade(asset);
  let best = 0;
  let bestDot = -Infinity;
  for (let r = 0; r < 4; r++) {
    const [nx, nz] = rotateQuarter(lx, lz, r);
    const dot = nx * dx + nz * dz;
    if (dot > bestDot + 1e-9) { bestDot = dot; best = r; }
  }
  return best;
}

/** Vrai si le rectangle chevauche une route (demi-largeur) ou un bâtiment existant. */
export function rectConflicts(m: WorldMirror, r: { minX: number; minZ: number; maxX: number; maxZ: number }): boolean {
  for (const e of m.edges.values()) {
    const v = m.edgeView(e);
    if (v && distSegmentRect(v.ax, v.az, v.bx, v.bz, r.minX, r.minZ, r.maxX, r.maxZ) < roadWidth(v.type) / 2) return true;
  }
  for (const b of m.buildings.values()) {
    const o = m.buildingRect(b);
    if (o && r.minX < o.maxX - 0.01 && r.maxX > o.minX + 0.01 && r.minZ < o.maxZ - 0.01 && r.maxZ > o.minZ + 0.01) return true;
  }
  return false;
}

export interface SnapOptions {
  /** Rotation demandée par le joueur (utilisée en placement libre, ou si autoAlign = false). */
  rot: number;
  autoAlign: boolean;
  /** Distance supplémentaire (m) au-delà de laquelle on n'accroche plus la route. */
  reach?: number;
}

export function proposePlacement(m: WorldMirror, asset: CatalogAsset, x: number, z: number, opt: SnapOptions): PlacementProposal {
  const t = m.terrain;
  const ox = t?.originX ?? 0;
  const oz = t?.originZ ?? 0;
  const free = (): PlacementProposal => {
    const rect = gridFootprint(ox, oz, asset.footprint.tilesX, asset.footprint.tilesZ, x, z, opt.rot);
    return { x: rect.cx, z: rect.cz, rot: opt.rot & 3, snapped: false, edgeId: null, rect, localConflict: rectConflicts(m, rect) };
  };
  const fw = Math.max(asset.footprint.tilesX, asset.footprint.tilesZ) * TILE_SIZE;
  const reach = opt.reach ?? 10;
  const near = m.nearestEdge(x, z, fw / 2 + 12 + reach);
  if (!near) return free();
  const e = near.edge;
  const half = roadWidth(e.type) / 2;
  // Point de la route le plus proche et direction curseur -> route.
  const px = e.ax + (e.bx - e.ax) * near.t;
  const pz = e.az + (e.bz - e.az) * near.t;
  let dx = px - x;
  let dz = pz - z;
  let dl = Math.hypot(dx, dz);
  if (dl < 1e-6) {
    // Curseur sur l'axe : côté gauche par défaut (perpendiculaire à la voie).
    const ex = e.bx - e.ax; const ez = e.bz - e.az; const el = Math.hypot(ex, ez) || 1;
    dx = ez / el; dz = -ex / el; dl = 1;
  }
  dx /= dl; dz /= dl;
  const rot = opt.autoAlign ? rotationFacing(asset, dx, dz) : opt.rot & 3;
  const [lx, lz] = localFacade(asset);
  const [fx, fz] = rotateQuarter(lx, lz, rot);
  const depth = (lz !== 0 ? asset.footprint.tilesZ : asset.footprint.tilesX) * TILE_SIZE;
  // Candidats : on recule du point de route le long de -façade, case par case, jusqu'à 3 cases.
  let first: PlacementProposal | null = null;
  for (let k = 0; k <= 6; k++) {
    const s = half + depth / 2 + k * (TILE_SIZE / 2);
    const cx = px - fx * s;
    const cz = pz - fz * s;
    const rect = gridFootprint(ox, oz, asset.footprint.tilesX, asset.footprint.tilesZ, cx, cz, rot);
    // La façade doit rester à portée de la route (pas plus de 1,5 case de recul).
    const gap = distPointRect(px, pz, rect.minX, rect.minZ, rect.maxX, rect.maxZ) - half;
    if (gap > TILE_SIZE * 1.5) break;
    const conflict = rectConflicts(m, rect);
    const p: PlacementProposal = { x: rect.cx, z: rect.cz, rot, snapped: true, edgeId: e.id, rect, localConflict: conflict };
    if (!first) first = p;
    if (!conflict) return p;
  }
  // Si le curseur s'est éloigné au-delà de la portée, placement libre.
  if (near.dist > half + depth + reach) return free();
  return first ?? free();
}
