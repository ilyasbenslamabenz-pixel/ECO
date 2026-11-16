/**
 * Aimantation du tracé de route au quadrillage affiché (retour joueur « le tracé n'est pas au milieu du
 * quadrillage »). TypeScript pur (aucun three).
 *
 * Une route posée a sa propre trame (src/shared/grid-field.ts) : ligne des façades à `demi-largeur + 0,6 m` de l'axe
 * des DEUX côtés, rangées tous les 8 m, lignes transversales en P·T ≡ 0 (mod 8, T canonique). Le tracé est calé pour
 * que cette trame prolonge les lignes affichées avant le tracé :
 *  1. direction : parallèle / perpendiculaire aux lignes affichées si l'écart est < ALIGN_TOL (8°) ;
 *  2. position en travers : la ligne des façades d'un côté (côté de la route de référence s'il y en a une, sinon le
 *     plus proche) tombe sur une ligne affichée ; l'axe est au milieu de la bande comprise entre les deux lignes des
 *     façades, et les rangées de cases des deux côtés sont entières ;
 *  3. extrémités libres sur les lignes transversales de la trame de la nouvelle route (longueur en cases entières
 *     quand les deux extrémités sont libres).
 * Priorités : un point accroché à un nœud ne bouge pas ; un point accroché à un tronçon ne glisse que le long de ce
 * tronçon (route perpendiculaire) ; un point posé sur une ligne guide d'îlot ne bouge pas.
 * Bâtiments : la route doit passer ENTRE les cases sans toucher aucune empreinte (aucune tolérance) ; si le calage
 * choisi en touche une, l'autre côté de la bande des façades puis le décalage d'une case sont essayés.
 */
import { TILE_SIZE } from '../../shared/constants';
import { FACADE_GAP } from '../../shared/road-grid';

/** Écart angulaire maximal (rad) pour aligner la direction du tracé sur le quadrillage. */
export const ALIGN_TOL = (8 * Math.PI) / 180;

/** Lignes affichées : P·T ≡ pu et P·N ≡ pv (mod cell), N = (−tz, tx) ; `kind` / `cn` : trame de route et position de son axe selon N. */
export interface AlignLines { tx: number; tz: number; pu: number; pv: number; kind?: string; cn?: number }

/** Extrémité du tracé : `fixed` (nœud, ligne guide), `slide` (tronçon : tangente le long de laquelle elle peut glisser). */
export interface AlignEnd { x: number; z: number; fixed?: boolean; slide?: { tx: number; tz: number } | null }

export interface AlignResult {
  start: { x: number; z: number };
  end: { x: number; z: number };
  /** Direction calée sur la trame. */
  aligned: boolean;
  /** Décalage en travers appliqué (m) et côté dont la ligne des façades est sur une ligne affichée (+1 / −1 selon n). */
  shift: number;
  side: number;
}

const mod = (a: number, m: number): number => ((a % m) + m) % m;
/** Plus petit décalage signé d tel que v + d ≡ target (mod m), d ∈ ]−m/2, m/2]. */
const nearestShift = (v: number, target: number, m: number): number => { let d = mod(target - v, m); if (d > m / 2) d -= m; return d; };

/** Vrai si le tracé droit (a → b) touche un bâtiment (emprise de la route, trottoirs compris). */
export type TraceCollides = (a: { x: number; z: number }, b: { x: number; z: number }) => boolean;

/**
 * Cale le tracé (start → end) d'une route de demi-largeur `half` (trottoirs compris) sur les lignes `L`.
 * Null si le tracé est trop court ou trop en biais (> ALIGN_TOL) : il reste tel quel.
 * `collides` (facultatif) : si le calage choisi touche un bâtiment, les autres positions de trame sont essayées.
 */
export function alignTrace(start: AlignEnd, end: AlignEnd, half: number, L: AlignLines, cell = TILE_SIZE, tol = ALIGN_TOL, collides?: TraceCollides): AlignResult | null {
  let sx = start.x, sz = start.z, ex = end.x, ez = end.z;
  const len = Math.hypot(ex - sx, ez - sz);
  if (len < 4) return null;
  const sFixed = !!start.fixed || !!start.slide, eFixed = !!end.fixed || !!end.slide;
  // 1. Direction.
  const a = Math.atan2(ez - sz, ex - sx), g = Math.atan2(L.tz, L.tx);
  let delta = mod(a - g, Math.PI / 2);
  if (delta > Math.PI / 4) delta -= Math.PI / 2;
  if (Math.abs(delta) > tol) return null;
  if (Math.abs(delta) > 1e-9) {
    if (sFixed && eFixed) return null; // deux extrémités accrochées : on ne tourne pas
    const b = a - delta, c = Math.cos(b), s = Math.sin(b);
    if (!sFixed && eFixed) { sx = ex - c * len; sz = ez - s * len; } else { ex = sx + c * len; ez = sz + s * len; }
  }
  const ux = (ex - sx) / len, uz = (ez - sz) / len, nx = -uz, nz = ux;
  // Familles de lignes : coordonnée P·n (lignes parallèles au tracé) et P·u (lignes transversales).
  const Nx = -L.tz, Nz = L.tx;
  const phaseAlong = (vx: number, vz: number): number => {
    const dT = vx * L.tx + vz * L.tz, dN = vx * Nx + vz * Nz;
    return Math.abs(dT) >= Math.abs(dN) ? Math.sign(dT) * L.pu : Math.sign(dN) * L.pv;
  };
  // 2. En travers : ligne des façades (axe ± off) sur une ligne affichée.
  const off = half + FACADE_GAP;
  const pc = phaseAlong(nx, nz);
  const c0 = sx * nx + sz * nz;
  const dPlus = nearestShift(c0 + off, pc, cell), dMinus = nearestShift(c0 - off, pc, cell);
  let side: number;
  if (L.kind === 'route' && L.cn !== undefined) {
    // Route de référence parallèle : côté qui lui fait face (les cases entre les deux routes sont entières).
    const refN = (L.cn ?? 0) * (Nx * nx + Nz * nz); // L.cn est mesuré selon N ; ±1 selon le sens de n
    const parallel = Math.abs(Nx * nx + Nz * nz) > 0.5;
    side = parallel ? (refN > c0 ? 1 : -1) : (Math.abs(dPlus) <= Math.abs(dMinus) ? 1 : -1);
  } else side = Math.abs(dPlus) <= Math.abs(dMinus) ? 1 : -1;
  // Qui peut se décaler en travers : point libre, ou glissant le long d'un tronçon parallèle à n.
  const canSlide = (e: AlignEnd): boolean => !e.fixed && (!e.slide || Math.abs(e.slide.tx * nx + e.slide.tz * nz) > 0.999);
  const slides = canSlide(start) && canSlide(end);
  // Calage en travers `shift` puis 3. extrémités libres sur les lignes transversales de la trame de la route :
  // P·T ≡ 0 (T canonique), soit P·u ≡ 0.
  const place = (shift: number, side: number): AlignResult => {
    let ax = sx + nx * shift, az = sz + nz * shift, bx = ex + nx * shift, bz = ez + nz * shift;
    if (!sFixed) {
      const d = nearestShift(ax * ux + az * uz, 0, cell);
      ax += ux * d; az += uz * d;
    }
    if (!eFixed) {
      let d = nearestShift(bx * ux + bz * uz, 0, cell);
      if ((bx + ux * d - ax) * ux + (bz + uz * d - az) * uz < cell - 1e-6) d += cell;
      bx += ux * d; bz += uz * d;
    }
    return { start: { x: ax, z: az }, end: { x: bx, z: bz }, aligned: true, shift, side };
  };
  const first = place(slides ? (side > 0 ? dPlus : dMinus) : 0, side);
  if (!collides || !slides || !collides(first.start, first.end)) return first;
  // Le calage choisi touche un bâtiment : autres positions de trame valides (aucune tolérance : la route doit passer
  // entre les cases), l'autre côté de la bande des façades sur la ligne, puis décalage d'une case ; la première
  // sans collision. Aucune : calage d'origine (la simulation refusera le tracé en nommant le bâtiment).
  const other = side > 0 ? dMinus : dPlus;
  const steps: [number, number][] = [];
  for (const [d, s] of [[first.shift, side], [other, -side]] as const) steps.push([d + cell, s], [d - cell, s]);
  steps.sort((a, b) => Math.abs(a[0]) - Math.abs(b[0]));
  for (const [d, s] of [[other, -side] as [number, number], ...steps]) {
    const r = place(d, s);
    if (!collides(r.start, r.end)) return r;
  }
  return first;
}
