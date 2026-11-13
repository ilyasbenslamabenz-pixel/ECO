/**
 * Placement intelligent des bâtiments (pur TypeScript) :
 * - près d'une route (droite, en biais ou courbe) : la façade (premier point `frontage` du catalogue)
 *   est tournée EXACTEMENT vers la route (angle libre, perpendiculaire à la tangente locale) et le
 *   bâtiment est reculé juste au-delà du trottoir, en glissant le long de la voie ;
 * - sinon : placement libre aligné sur la grille, rotation choisie par le joueur (quarts de tour).
 * Le résultat n'est qu'une PROPOSITION : la validité réelle (collision, pente, eau, fonds)
 * est demandée au worker par un placeBuilding { dryRun: true }.
 * Propriétaire : agent construction/caméra/UI.
 */
import { TILE_SIZE } from '../../shared/constants';
import type { CatalogAsset } from '../../shared/catalog';
import { rotateQuarter } from '../../shared/math';
import { angleToRot, distSegmentObb, footprintObb, normRot, obbAabb, obbOverlap, type Obb } from '../../shared/footprint';
import { roadWidth, type WorldMirror } from './mirror';

export interface PlacementProposal {
  x: number;
  z: number;
  /** Rotation en quarts de tour (décimale si alignée sur une route en biais). */
  rot: number;
  /** Vrai si aligné automatiquement sur une route. */
  snapped: boolean;
  edgeId: number | null;
  /** Empreinte orientée (identique à celle que la simulation occupera). */
  obb: Obb;
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

/** Rotation entière (0..3) qui oriente la façade le plus possible vers la direction (dx, dz). */
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

/** Vrai si l'empreinte orientée chevauche une route (demi-largeur, axe courbe) ou un bâtiment existant. */
export function obbConflicts(m: WorldMirror, o: Obb): boolean {
  const bb = obbAabb(o);
  for (const e of m.edges.values()) {
    const v = m.edgeView(e);
    if (!v) continue;
    const half = roadWidth(v.kindId) / 2;
    const p = v.poly;
    for (let k = 0; k + 3 < p.length; k += 2) {
      const x0 = Math.min(p[k]!, p[k + 2]!) - half, x1 = Math.max(p[k]!, p[k + 2]!) + half;
      const z0 = Math.min(p[k + 1]!, p[k + 3]!) - half, z1 = Math.max(p[k + 1]!, p[k + 3]!) + half;
      if (x1 < bb.minX || x0 > bb.maxX || z1 < bb.minZ || z0 > bb.maxZ) continue;
      if (distSegmentObb(p[k]!, p[k + 1]!, p[k + 2]!, p[k + 3]!, o) < half) return true;
    }
  }
  for (const b of m.buildings.values()) {
    const other = m.buildingObb(b);
    if (other && obbOverlap(o, other, 0.05)) return true;
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

/** Recul (m) entre le bord du trottoir et la façade. */
const FRONT_GAP = 0.6;

export function proposePlacement(m: WorldMirror, asset: CatalogAsset, x: number, z: number, opt: SnapOptions): PlacementProposal {
  const t = m.terrain;
  const ox = t?.originX ?? 0;
  const oz = t?.originZ ?? 0;
  const tX = asset.footprint.tilesX, tZ = asset.footprint.tilesZ;
  const free = (): PlacementProposal => {
    // Placement libre : centre aligné sur la grille des cases (rangées régulières), rotation du joueur.
    const rot = normRot(opt.rot);
    const o0 = footprintObb(tX, tZ, x, z, rot);
    const bb = obbAabb(o0);
    const w = bb.maxX - bb.minX, d = bb.maxZ - bb.minZ;
    const cx = ox + Math.round((x - ox - w / 2) / TILE_SIZE) * TILE_SIZE + w / 2;
    const cz = oz + Math.round((z - oz - d / 2) / TILE_SIZE) * TILE_SIZE + d / 2;
    const o = footprintObb(tX, tZ, cx, cz, rot);
    return { x: cx, z: cz, rot, snapped: false, edgeId: null, obb: o, localConflict: obbConflicts(m, o) };
  };
  const fw = Math.max(tX, tZ) * TILE_SIZE;
  const reach = opt.reach ?? 10;
  const near = m.nearestEdge(x, z, fw / 2 + 14 + reach);
  if (!near) return free();
  const e = near.edge;
  const half = roadWidth(e.kindId) / 2;
  // Normale à la route (perpendiculaire à la tangente locale), du côté du curseur.
  let nx = -near.tz, nz = near.tx;
  if ((x - near.px) * nx + (z - near.pz) * nz < 0) { nx = -nx; nz = -nz; }
  // La façade regarde la route : direction -n.
  const fx = -nx, fz = -nz;
  const [lx, lz] = localFacade(asset);
  const rot = opt.autoAlign ? angleToRot(Math.atan2(fx, fz) - Math.atan2(lx, lz)) : normRot(opt.rot);
  // Profondeur de l'empreinte mesurée selon la normale à la route.
  const probe = footprintObb(tX, tZ, 0, 0, rot);
  const halfDepth = Math.abs(probe.hx * (probe.c * fx - probe.s * fz)) + Math.abs(probe.hz * (probe.s * fx + probe.c * fz));
  let first: PlacementProposal | null = null;
  for (let k = 0; k <= 8; k++) {
    const s = half + halfDepth + FRONT_GAP + k * 1.5;
    const cx = Math.round((near.px + nx * s) * 100) / 100;
    const cz = Math.round((near.pz + nz * s) * 100) / 100;
    const o = footprintObb(tX, tZ, cx, cz, rot);
    const conflict = obbConflicts(m, o);
    const p: PlacementProposal = { x: cx, z: cz, rot, snapped: true, edgeId: e.id, obb: o, localConflict: conflict };
    if (!first) first = p;
    if (!conflict) return p;
  }
  // Si le curseur s'est éloigné au-delà de la portée, placement libre.
  if (near.dist > half + halfDepth * 2 + reach) return free();
  return first ?? free();
}
