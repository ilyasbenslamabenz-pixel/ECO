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
import { angleToRot, buildingGap, distSegmentObb, footprintObb, normRot, obbAabb, obbOverlap, type Obb } from '../../shared/footprint';
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
  /** Vrai si la position a été aimantée contre un bâtiment voisin (côte à côte, façades alignées). */
  neighbor?: boolean;
}

/** Demi-étendue d'une empreinte orientée selon la direction unitaire (ux, uz). */
function extentAlong(o: Obb, ux: number, uz: number): number {
  // Axe local x en monde = (c, −s), axe z = (s, c).
  return o.hx * Math.abs(o.c * ux - o.s * uz) + o.hz * Math.abs(o.s * ux + o.c * uz);
}

/**
 * Aimantation au voisin : dans le repère (t, n) — t le long de la rangée, n vers l'arrière (−n = côté façade) —,
 * cherche la position la plus proche (déplacement ≤ maxShift) où le bâtiment se place côte à côte avec un voisin
 * (écart minimal respecté, pas de chevauchement) et façade alignée sur la sienne. Renvoie le centre, ou null.
 * `parallelOnly` : voisins d'orientation parallèle seulement (placement libre).
 */
export function snapToNeighbor(m: WorldMirror, asset: CatalogAsset, o: Obb, tx: number, tz: number, nx: number, nz: number, maxShift: number, parallelOnly = false): { x: number; z: number } | null {
  const hT = extentAlong(o, tx, tz), hN = extentAlong(o, nx, nz);
  let best: { x: number; z: number; cost: number } | null = null;
  for (const b of m.buildings.values()) {
    const ob = m.buildingObb(b);
    if (!ob) continue;
    const dx = ob.cx - o.cx, dz = ob.cz - o.cz;
    if (dx * dx + dz * dz > (hT + 60) * (hT + 60)) continue;
    if (parallelOnly) {
      // Axes parallèles (au quart de tour près) : |sin(2·Δ)| ≈ 0.
      const cross = ob.c * o.s - ob.s * o.c, dot = ob.c * o.c + ob.s * o.s;
      if (Math.abs(2 * cross * dot) > 0.02) continue;
    }
    const dt = dx * tx + dz * tz, dn = dx * nx + dz * nz;
    const hTb = extentAlong(ob, tx, tz), hNb = extentAlong(ob, nx, nz);
    // Même rangée : les profondeurs se recouvrent.
    if (Math.abs(dn) > hN + hNb) continue;
    const gap = buildingGap(asset.category, m.asset(b.assetId)?.category ?? '') + 0.1;
    // Façades alignées (bord côté −n).
    const sn = dn - hNb + hN;
    for (const side of [-1, 1]) {
      const st = dt + side * (hTb + hT + gap);
      if (Math.abs(st) > maxShift || Math.abs(sn) > maxShift) continue;
      const cost = Math.abs(st) + Math.abs(sn) * 0.5;
      if (!best || cost < best.cost) best = { x: o.cx + tx * st + nx * sn, z: o.cz + tz * st + nz * sn, cost };
    }
  }
  return best ? { x: Math.round(best.x * 100) / 100, z: Math.round(best.z * 100) / 100 } : null;
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

/**
 * Vrai si l'empreinte orientée chevauche une route (demi-largeur, axe courbe) ou un bâtiment existant (avec
 * l'écart minimal exigé par la simulation autour des maisons quand `category` est donnée).
 */
export function obbConflicts(m: WorldMirror, o: Obb, category?: string): boolean {
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
    if (!other) continue;
    const gap = category ? buildingGap(category, m.asset(b.assetId)?.category ?? '') : 0;
    if (obbOverlap(o, other, gap > 0 ? -gap : 0.05)) return true;
  }
  return false;
}

export interface SnapOptions {
  /** Rotation demandée par le joueur (utilisée en placement libre, ou si autoAlign = false). */
  rot: number;
  autoAlign: boolean;
  /** Distance supplémentaire (m) au-delà de laquelle on n'accroche plus la route. */
  reach?: number;
  /** Aimantation contre les bâtiments voisins (côte à côte, façades alignées). */
  magnet?: boolean;
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
    if (opt.magnet) {
      // Voisin parallèle le plus proche : repère de ses propres axes, essayé dans les deux sens.
      const r = Math.round(normRot(rot)) % 4;
      const [ax, az] = r % 2 === 0 ? [1, 0] : [0, 1];
      for (const [tx, tz, nx, nz] of [[ax, az, -az, ax], [-az, ax, ax, az]] as const) {
        const q = snapToNeighbor(m, asset, o, tx, tz, nx, nz, TILE_SIZE * 0.75, true);
        if (!q) continue;
        const o2 = footprintObb(tX, tZ, q.x, q.z, rot);
        if (!obbConflicts(m, o2, asset.category)) return { x: q.x, z: q.z, rot, snapped: false, edgeId: null, obb: o2, localConflict: false, neighbor: true };
      }
    }
    return { x: cx, z: cz, rot, snapped: false, edgeId: null, obb: o, localConflict: obbConflicts(m, o, asset.category) };
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
    const conflict = obbConflicts(m, o, asset.category);
    const p: PlacementProposal = { x: cx, z: cz, rot, snapped: true, edgeId: e.id, obb: o, localConflict: conflict };
    if (!first) first = p;
    if (opt.magnet && k === 0) {
      // Le long de la route : côte à côte avec le voisin le plus proche, façades alignées (n = vers l'arrière).
      const q = snapToNeighbor(m, asset, o, near.tx, near.tz, nx, nz, Math.max(4, Math.min(12, halfDepth)));
      if (q) {
        const o2 = footprintObb(tX, tZ, q.x, q.z, rot);
        if (!obbConflicts(m, o2, asset.category)) return { x: q.x, z: q.z, rot, snapped: true, edgeId: e.id, obb: o2, localConflict: false, neighbor: true };
      }
    }
    if (!conflict) return p;
  }
  // Si le curseur s'est éloigné au-delà de la portée, placement libre.
  if (near.dist > half + halfDepth * 2 + reach) return free();
  return first ?? free();
}
