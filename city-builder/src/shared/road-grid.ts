/**
 * Trame locale d'une route : le quadrillage de construction aligné sur la route la plus proche (comme les cases
 * de zonage des city-builders modernes), partagé par le rendu (quadrillage au sol), l'outil de pose et la croissance
 * des zones. TypeScript pur, sans three ni DOM.
 *
 * Repère : T = tangente unitaire de la route au point le plus proche, orientée de façon canonique (même sens quel que
 * soit le sens de tracé du tronçon) ; N = (−T.z, T.x). Coordonnées d'un point P :
 *  - le long de la route : u = P·T − phase (mesuré depuis l'origine du MONDE, pas depuis le début du tronçon : une rue
 *    droite coupée en plusieurs tronçons par des carrefours garde la même trame) ;
 *  - en profondeur : v = |P·N − cn| − offset, où cn = O·N (O : point de l'axe) et offset = demi-largeur de la route
 *    (trottoirs compris) + recul de la façade, arrondi à la demi-case (`facadeOffset`) : v = 0 est la ligne des façades
 *    des deux côtés de la rue, et la bande entre elles est un nombre entier de cases (un seul quadrillage).
 * Les lignes sont aux multiples de `cell` (8 m) en u et en v (v ≥ 0 : rien sur la chaussée ni le trottoir).
 *
 * Les bâtiments posés face à la route (outil de pose, zonage) ont leur façade sur v = 0 et une profondeur multiple
 * de 8 m : leurs bords avant et arrière tombent sur des lignes. Le long de la route, `phase` vaut 0 (trame du monde)
 * ou, s'il existe un bâtiment parallèle à la route près du curseur, la phase de ses côtés : un quartier existant
 * (sauvegardes antérieures) est recalé à l'affichage sans rien reconstruire.
 */
import { TILE_SIZE } from './constants';
import type { Obb } from './footprint';

/** Recul minimal (m) entre le bord du trottoir et la façade (outil de pose et zonage). */
export const FACADE_GAP = 0.5;

/**
 * Distance (m) de l'axe d'une route de demi-largeur `half` (trottoirs compris) à la ligne des façades : la plus petite
 * valeur ≥ half + FACADE_GAP multiple d'une DEMI-case. La bande entre les deux lignes des façades (2 × offset) est
 * alors un nombre entier de cases : les lignes des deux côtés de la rue, et celles des routes parallèles ou
 * perpendiculaires calées sur le treillis du monde, forment UN SEUL quadrillage continu (retour joueur « le
 * quadrillage au sol n'est pas partout le même » : avec un recul fixe de 0,6 m, la bande d'une rue faisait 13,6 m et
 * l'autre côté de la rue était décalé de 5,6 m). Reculs obtenus : rue 1,8 m, sens unique 1,9, avenue 0,5,
 * voie rapide 1,9, piétonne 1,5, boulevard 3,6.
 */
export function facadeOffset(half: number, cell = TILE_SIZE): number {
  const q = cell / 2;
  return Math.ceil((half + FACADE_GAP) / q - 1e-9) * q;
}

/** Recul (m) de la façade depuis le bord du trottoir pour une route de demi-largeur `half`. */
export function facadeGap(half: number, cell = TILE_SIZE): number {
  return facadeOffset(half, cell) - half;
}

export interface RoadGridFrame {
  /** Tangente unitaire canonique. */
  tx: number;
  tz: number;
  /** Normale unitaire (−tz, tx). */
  nx: number;
  nz: number;
  /** Position de l'axe de la route selon N (O·N). */
  cn: number;
  /** Distance de l'axe à la ligne des façades (m). */
  offset: number;
  /** Phase de la trame le long de la route (m, dans [0, cell[). */
  phase: number;
  /** Côté d'une case (m). */
  cell: number;
}

const mod = (a: number, m: number): number => ((a % m) + m) % m;

/** Tangente orientée de façon canonique (x > 0, ou x = 0 et z > 0) : même trame quel que soit le sens du tronçon. */
export function canonicalTangent(tx: number, tz: number): [number, number] {
  const l = Math.hypot(tx, tz) || 1;
  let x = tx / l, z = tz / l;
  if (x < -1e-9 || (Math.abs(x) <= 1e-9 && z < 0)) { x = -x; z = -z; }
  return [x + 0, z + 0];
}

/** Trame d'une route : point (ox, oz) de l'axe, tangente (tx, tz), demi-largeur `half` (trottoirs compris). */
export function roadGridFrame(ox: number, oz: number, tx: number, tz: number, half: number, phase = 0, cell = TILE_SIZE): RoadGridFrame {
  const [cx, cz] = canonicalTangent(tx, tz);
  const nx = -cz, nz = cx;
  return { tx: cx, tz: cz, nx: nx + 0, nz: nz + 0, cn: ox * nx + oz * nz, offset: facadeOffset(half, cell), phase: mod(phase, cell), cell };
}

/** Coordonnées (u le long de la route, v en profondeur depuis la ligne des façades, côté : +1 / −1). */
export function gridCoords(f: RoadGridFrame, x: number, z: number): { u: number; v: number; side: number } {
  const n = x * f.nx + z * f.nz - f.cn;
  return { u: x * f.tx + z * f.tz - f.phase, v: Math.abs(n) - f.offset, side: n >= 0 ? 1 : -1 };
}

/** Distance (m) d'une coordonnée à la ligne de trame la plus proche. */
export function lineGap(c: number, cell = TILE_SIZE): number {
  const m = mod(c, cell);
  return Math.min(m, cell - m);
}

/** Demi-étendue d'une empreinte orientée selon une direction unitaire. */
export function obbExtentAlong(o: Obb, ux: number, uz: number): number {
  return o.hx * Math.abs(o.c * ux - o.s * uz) + o.hz * Math.abs(o.s * ux + o.c * uz);
}

/** Vrai si l'empreinte a ses côtés parallèles à la route (au 1/100 de radian près). */
export function obbParallel(f: RoadGridFrame, o: Obb): boolean {
  // Axe local x de l'empreinte en monde : (c, −s). Parallèle ou perpendiculaire à T : |sin 2Δ| ≈ 0.
  const cross = o.c * f.tz - -o.s * f.tx, dot = o.c * f.tx + -o.s * f.tz;
  return Math.abs(2 * cross * dot) < 0.02;
}

/**
 * Phase de la trame le long de la route donnée par une empreinte parallèle (son côté « gauche » sur une ligne) ;
 * null si l'empreinte est en biais par rapport à la route.
 */
export function phaseFromObb(f: RoadGridFrame, o: Obb): number | null {
  if (!obbParallel(f, o)) return null;
  const s = o.cx * f.tx + o.cz * f.tz;
  return mod(s - obbExtentAlong(o, f.tx, f.tz), f.cell);
}

/**
 * Phase locale : celle du bâtiment parallèle à la route le plus proche de (x, z) dont la façade est sur une ligne
 * de la trame en profondeur (ligne des façades ou rangée suivante, à `tol` m près) et qui est à moins de `reach` m le long de la route ; 0 (trame du monde) sinon.
 */
export function pickPhase(f: RoadGridFrame, obbs: Iterable<Obb>, x: number, z: number, reach = 48, tol = 1.5): number {
  let best = 0, bestD = Infinity;
  const pu = x * f.tx + z * f.tz;
  for (const o of obbs) {
    const g = gridCoords({ ...f, phase: 0 }, o.cx, o.cz);
    const hN = obbExtentAlong(o, f.nx, f.nz);
    // Façade sur la ligne des façades de cette route, ou sur une ligne de la trame derrière (2e, 3e rangée).
    const front = g.v - hN;
    if (front < -tol || lineGap(front, f.cell) > tol) continue;
    const du = Math.abs(g.u - pu);
    if (du > reach + obbExtentAlong(o, f.tx, f.tz)) continue;
    const ph = phaseFromObb(f, o);
    if (ph === null) continue;
    const d = Math.hypot(o.cx - x, o.cz - z);
    if (d < bestD) { bestD = d; best = ph; }
  }
  return best;
}

/**
 * Centre (x, z) recalé sur la trame le long de la route : les côtés de l'empreinte (demi-étendue `halfAlong` selon T)
 * tombent sur des lignes ; `step` décale de ce nombre de cases. La profondeur (selon N) n'est pas modifiée.
 */
export function snapAlong(f: RoadGridFrame, x: number, z: number, halfAlong: number, step = 0): [number, number] {
  const s = x * f.tx + z * f.tz;
  const left = s - halfAlong - f.phase;
  const target = f.phase + Math.round(left / f.cell + step) * f.cell + halfAlong;
  const d = target - s;
  return [x + f.tx * d, z + f.tz * d];
}
