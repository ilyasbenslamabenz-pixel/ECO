/**
 * Outil « Quadrillage » (pur TypeScript) : un rectangle tracé au sol devient un îlot de rues sur la grille
 * de construction (cases de 8 m), avec une taille d'îlot réglable (48 / 64 / 96 m, multiples de la case).
 *
 * Le rectangle part d'un coin posé sur la grille ; l'autre coin est arrondi à un nombre entier d'îlots dans
 * chaque direction (au moins un). Les rues sont les droites de la grille d'îlots : (nz + 1) rues est-ouest et
 * (nx + 1) rues nord-sud. Les tronçons déjà couverts par une route existante colinéaire (bord d'un quadrillage
 * voisin) sont retirés, pour que deux quadrillages partagent leur rue commune. Les carrefours sont créés par la
 * simulation (buildRoad découpe les croisements) ; c'est elle qui valide chaque rue (dryRun) et la chiffre.
 * Propriétaire : agent construction/caméra/UI.
 */
import { TILE_SIZE } from '../../shared/constants';
import type { WorldMirror } from './mirror';

/** Tailles d'îlot proposées (m, axe à axe des rues). */
export const GRID_BLOCK_SIZES = [48, 64, 96] as const;
export const DEFAULT_GRID_BLOCK = 64;
/** Nombre maximal d'îlots par côté (garde le nombre de commandes raisonnable). */
export const GRID_MAX_BLOCKS = 12;
/** Longueur minimale d'un morceau de rue conservé après retrait des parties déjà construites. */
const MIN_PIECE = TILE_SIZE;

export interface GridLayout {
  x0: number; z0: number; x1: number; z1: number;
  /** Nombre d'îlots selon x et selon z. */
  nx: number; nz: number;
  block: number;
  /** Rues à construire : [xa, za, xb, zb] (droites). */
  lines: [number, number, number, number][];
  /** Longueur totale des rues à construire (m). */
  length: number;
  /** Vrai si le nombre d'îlots a été plafonné. */
  clamped: boolean;
}

const snap = (v: number): number => Math.round(v / TILE_SIZE) * TILE_SIZE;

/** Coin de départ du quadrillage : intersection de la grille de construction la plus proche. */
export function gridCorner(x: number, z: number): { x: number; z: number } {
  return { x: snap(x), z: snap(z) };
}

/**
 * Disposition du quadrillage entre le coin `a` (déjà sur la grille) et le curseur `b`.
 * `mirror` (facultatif) : retire les morceaux déjà couverts par une route existante colinéaire.
 */
export function gridLayout(a: { x: number; z: number }, b: { x: number; z: number }, block: number, mirror?: WorldMirror): GridLayout {
  const B = Math.max(TILE_SIZE, snap(block));
  const sx = b.x >= a.x ? 1 : -1, sz = b.z >= a.z ? 1 : -1;
  let nx = Math.max(1, Math.round(Math.abs(b.x - a.x) / B));
  let nz = Math.max(1, Math.round(Math.abs(b.z - a.z) / B));
  const clamped = nx > GRID_MAX_BLOCKS || nz > GRID_MAX_BLOCKS;
  nx = Math.min(nx, GRID_MAX_BLOCKS); nz = Math.min(nz, GRID_MAX_BLOCKS);
  const x0 = Math.min(a.x, a.x + sx * nx * B), x1 = Math.max(a.x, a.x + sx * nx * B);
  const z0 = Math.min(a.z, a.z + sz * nz * B), z1 = Math.max(a.z, a.z + sz * nz * B);
  const raw: [number, number, number, number][] = [];
  for (let i = 0; i <= nz; i++) raw.push([x0, z0 + i * B, x1, z0 + i * B]);
  for (let j = 0; j <= nx; j++) raw.push([x0 + j * B, z0, x0 + j * B, z1]);
  const lines = mirror ? raw.flatMap((l) => uncoveredPieces(l, mirror)) : raw;
  let length = 0;
  for (const l of lines) length += Math.hypot(l[2] - l[0], l[3] - l[1]);
  return { x0, z0, x1, z1, nx, nz, block: B, lines, length, clamped };
}

/**
 * Morceaux d'une rue droite qui ne sont pas déjà couverts par un tronçon existant colinéaire
 * (extrémités à moins de 0,75 m de l'axe et tronçon quasi droit).
 */
export function uncoveredPieces(l: [number, number, number, number], mirror: WorldMirror): [number, number, number, number][] {
  const [ax, az, bx, bz] = l;
  const L = Math.hypot(bx - ax, bz - az);
  if (L < 1e-6) return [];
  const ux = (bx - ax) / L, uz = (bz - az) / L;
  const covered: [number, number][] = [];
  for (const e of mirror.edges.values()) {
    const v = mirror.edgeView(e);
    if (!v) continue;
    const p = v.poly;
    let onAxis = true;
    for (let k = 0; k < p.length && onAxis; k += 2) {
      const dx = p[k]! - ax, dz = p[k + 1]! - az;
      if (Math.abs(dx * uz - dz * ux) > 0.75) onAxis = false;
    }
    if (!onAxis) continue;
    const s0 = (v.ax - ax) * ux + (v.az - az) * uz, s1 = (v.bx - ax) * ux + (v.bz - az) * uz;
    const lo = Math.max(0, Math.min(s0, s1)), hi = Math.min(L, Math.max(s0, s1));
    if (hi - lo > 0.5) covered.push([lo, hi]);
  }
  if (covered.length === 0) return [l];
  covered.sort((p, q) => p[0] - q[0]);
  const out: [number, number, number, number][] = [];
  let cur = 0;
  const push = (s0: number, s1: number): void => {
    if (s1 - s0 < MIN_PIECE) return;
    out.push([ax + ux * s0, az + uz * s0, ax + ux * s1, az + uz * s1]);
  };
  for (const [lo, hi] of covered) {
    if (lo > cur) push(cur, lo);
    cur = Math.max(cur, hi);
  }
  if (cur < L) push(cur, L);
  return out;
}

/** Vrai si le tronçon (polyligne) est posé sur l'une des rues du quadrillage (pour l'annulation groupée). */
export function edgeOnGrid(poly: ArrayLike<number>, g: { x0: number; z0: number; x1: number; z1: number; block: number }): boolean {
  const n = poly.length;
  if (n < 4) return false;
  const ax = poly[0]!, az = poly[1]!, bx = poly[n - 2]!, bz = poly[n - 1]!;
  const tol = 0.75;
  const inX = (x: number): boolean => x >= g.x0 - tol && x <= g.x1 + tol;
  const inZ = (z: number): boolean => z >= g.z0 - tol && z <= g.z1 + tol;
  if (!inX(ax) || !inX(bx) || !inZ(az) || !inZ(bz)) return false;
  const onLine = (v: number, o: number): boolean => { const k = Math.round((v - o) / g.block); return Math.abs(v - o - k * g.block) < tol; };
  if (Math.abs(az - bz) < tol) return onLine(az, g.z0);
  if (Math.abs(ax - bx) < tol) return onLine(ax, g.x0);
  return false;
}
