/**
 * Champ de trames du quadrillage : en CHAQUE point de la carte, les lignes de construction affichées (cases de 8 m),
 * comme les cases de zonage attachées aux routes des city-builders modernes. Partagé par le rendu (quadrillage au
 * sol de tous les outils, cases de l'outil Zones), l'aimantation de l'outil de pose et le zonage de la simulation :
 * ce que le joueur voit est exactement là où l'on construit et où l'on zone. TypeScript pur, sans three ni DOM.
 *
 * Lignes en un point P : P·T ≡ pu et P·N ≡ pv (mod 8 m), T unitaire, N = (−T.z, T.x). Règle (la plus proche gagne) :
 *  1. Route la plus proche (bord à moins de FIELD_ROAD_REACH m, toutes rangées de zonage comprises) : T = tangente
 *     locale (routes courbes : tangente au point le plus proche, phase le long de la voie mesurée en abscisse
 *     curviligne, donc continue), lignes en profondeur depuis la ligne des façades (demi-largeur + 0,6 m) ;
 *     le long de la voie, phase du bâtiment parallèle voisin (src/shared/road-grid.ts), sinon trame de la route.
 *     À moins de FIELD_BUILDING_SNAP m d'un bâtiment : ses côtés (parallèle à la route : phases recalées sur lui,
 *     rangées intérieures des anciennes parties comprises ; en biais : son propre repère).
 *  2. Sinon, bâtiment le plus proche à moins de FIELD_BUILDING_REACH m : son repère (côtés sur les lignes).
 *  3. Sinon : axes du monde (multiples de 8 m).
 * Fondu : là où deux trames différentes se touchent (deux routes, bâtiment recalé), les lignes s'estompent sur
 * FIELD_FADE m au lieu de se croiser en biais.
 */
import { TILE_SIZE } from './constants';
import type { Obb } from './footprint';
import { FACADE_GAP, canonicalTangent, lineGap, obbExtentAlong, type RoadGridFrame } from './road-grid';

/** Portée (m, depuis le bord) des trames de route : 6 rangées de cases et plus (zonage de 4 rangées + intérieur). */
export const FIELD_ROAD_REACH = 64;
/** Rayon (m) autour d'un bâtiment où ses côtés imposent les lignes. */
export const FIELD_BUILDING_SNAP = 6;
/** Loin des routes : repère du bâtiment le plus proche jusqu'à cette distance (m). */
export const FIELD_BUILDING_REACH = 40;
/** Rayon (m) de recherche du bâtiment parallèle voisin qui donne la phase le long de la route. */
const NEIGHBOUR_R = 28;
/** Largeur (m) du fondu entre deux trames différentes. */
export const FIELD_FADE = 3;

export type GridKind = 'route' | 'batiment' | 'monde';

/** Lignes affichées en un point. */
export interface GridLines {
  tx: number;
  tz: number;
  /** Lignes en P·T ≡ pu et P·N ≡ pv (mod cell), dans [0, cell[. */
  pu: number;
  pv: number;
  /** Intensité des lignes (fondu entre trames, 0..1). */
  weight: number;
  kind: GridKind;
  /** Route support (kind 'route'), sinon -1. */
  roadId: number;
  /** Côté de la route (+1 / −1), position de l'axe selon N (O·N), distance axe → ligne des façades, distance au bord. */
  side: number;
  cn: number;
  offset: number;
  edge: number;
}

/** Route vue par le champ : polyligne de l'axe [x0, z0, x1, z1, …], demi-largeur (trottoirs compris). */
export interface FieldRoad { id: number; poly: ArrayLike<number>; half: number }

/** Requête des empreintes de bâtiments dans un rectangle (les empreintes renvoyées peuvent déborder). */
export type ObbQuery = (minX: number, minZ: number, maxX: number, maxZ: number, out: Obb[]) => Obb[];

const mod = (a: number, m: number): number => ((a % m) + m) % m;
const smooth = (e0: number, e1: number, x: number): number => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

interface RoadData {
  id: number;
  poly: Float64Array;
  half: number;
  /** Abscisse curviligne cumulée par sommet. */
  s: Float64Array;
  /** Tangente unitaire aux sommets (moyenne des segments voisins, sens de tracé) : trame continue sur une courbe. */
  vt: Float64Array;
  /** Sens canonique de la corde (+1 / −1) et base : u(P) = sign·s(O) + (P−O)·T + base (u = P·T sur une route droite). */
  sign: number;
  base: number;
}

/** Distance d'un point à une empreinte orientée (0 dedans). */
export function obbDistance(o: Obb, x: number, z: number): number {
  const dx = x - o.cx, dz = z - o.cz;
  const lx = Math.abs(dx * o.c - dz * o.s) - o.hx, lz = Math.abs(dx * o.s + dz * o.c) - o.hz;
  const ax = lx > 0 ? lx : 0, az = lz > 0 ? lz : 0;
  return Math.sqrt(ax * ax + az * az);
}

/** Index par seaux d'un ensemble d'empreintes (requête rapide, sans allocation). */
export class ObbBuckets {
  private readonly map = new Map<number, { o: Obb; stamp: number }[]>();
  private stamp = 0;
  constructor(obbs: Iterable<Obb>, private readonly size = 32) {
    for (const ob of obbs) {
      const o = ob, e = { o, stamp: 0 };
      const ex = Math.abs(o.hx * o.c) + Math.abs(o.hz * o.s), ez = Math.abs(o.hx * o.s) + Math.abs(o.hz * o.c);
      const i0 = Math.floor((o.cx - ex) / size), i1 = Math.floor((o.cx + ex) / size);
      const j0 = Math.floor((o.cz - ez) / size), j1 = Math.floor((o.cz + ez) / size);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const k = key(i, j);
        let l = this.map.get(k);
        if (!l) this.map.set(k, (l = []));
        l.push(e);
      }
    }
  }
  readonly query: ObbQuery = (minX, minZ, maxX, maxZ, out) => {
    out.length = 0;
    const s = this.size, st = ++this.stamp;
    const i0 = Math.floor(minX / s), i1 = Math.floor(maxX / s), j0 = Math.floor(minZ / s), j1 = Math.floor(maxZ / s);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const l = this.map.get(key(i, j));
      if (!l) continue;
      for (const e of l) if (e.stamp !== st) { e.stamp = st; out.push(e.o); }
    }
    return out;
  };
}

const key = (i: number, j: number): number => (i + 32768) * 65536 + (j + 32768);

/** Phase (dans [0, cell[) qui met le côté « bas » d'une empreinte selon la direction (ux, uz) sur une ligne. */
function obbPhase(o: Obb, ux: number, uz: number, cell: number): number {
  return mod(o.cx * ux + o.cz * uz - obbExtentAlong(o, ux, uz), cell);
}

/** Vrai si l'empreinte a ses côtés parallèles / perpendiculaires à (tx, tz) (au 1/100 de radian près). */
function parallel(o: Obb, tx: number, tz: number, tol = 0.02): boolean {
  const cross = o.c * tz + o.s * tx, dot = o.c * tx - o.s * tz;
  return Math.abs(2 * cross * dot) < tol;
}
/** Tolérance de `parallel` (|sin 2Δ|) pour « presque parallèle » : ≈ 3°, tangente d'une courbe à quelques mètres. */
const NEAR_PARALLEL = 0.1;

/** Même trame (direction, phases) à `tol` m près. */
export function sameLines(a: GridLines, b: GridLines, cell = TILE_SIZE, tol = 0.05): boolean {
  const cross = a.tx * b.tz - a.tz * b.tx, dot = a.tx * b.tx + a.tz * b.tz;
  if (Math.abs(2 * cross * dot) > 0.002) return false;
  // Directions parallèles ou perpendiculaires : on compare les familles de lignes, quel que soit l'axe.
  const fam = (l: GridLines): [number, number, number, number][] => [[l.tx, l.tz, l.pu, 0], [-l.tz, l.tx, l.pv, 0]];
  for (const [ux, uz, p] of fam(a)) {
    let ok = false;
    for (const [vx, vz, q] of fam(b)) {
      const d = ux * vx + uz * vz;
      if (Math.abs(Math.abs(d) - 1) > 1e-3) continue;
      if (lineGap(d > 0 ? p - q : p + q, cell) <= tol) { ok = true; break; }
    }
    if (!ok) return false;
  }
  return true;
}

export class GridField {
  private readonly roads: RoadData[] = [];
  /** Seaux de segments : proches (recherche ≤ NEAR m du bord) et lointains (≤ FIELD_ROAD_REACH). */
  private readonly near = new Map<number, number[]>();
  private readonly far = new Map<number, number[]>();
  private maxHalf = 0;
  private readonly tmp: Obb[] = [];
  private static readonly NEAR = 16;
  private static readonly BUCKET = 32;

  constructor(roads: Iterable<FieldRoad>, private readonly obbs: ObbQuery, readonly cell = TILE_SIZE) {
    for (const r of roads) {
      const n = Math.floor(r.poly.length / 2);
      if (n < 2) continue;
      const poly = Float64Array.from(r.poly as ArrayLike<number>);
      const s = new Float64Array(n);
      for (let k = 1; k < n; k++) s[k] = s[k - 1]! + Math.hypot(poly[2 * k]! - poly[2 * k - 2]!, poly[2 * k + 1]! - poly[2 * k - 1]!);
      if (s[n - 1]! < 1e-6) continue;
      const [cx, cz] = canonicalTangent(poly[2 * n - 2]! - poly[0]!, poly[2 * n - 1]! - poly[1]!);
      const d0x = poly[2]! - poly[0]!, d0z = poly[3]! - poly[1]!;
      const sign = (poly[2 * n - 2]! - poly[0]!) * cx + (poly[2 * n - 1]! - poly[1]!) * cz >= 0 ? 1 : -1;
      const l0 = Math.hypot(d0x, d0z) || 1;
      const base = poly[0]! * (sign * d0x / l0) + poly[1]! * (sign * d0z / l0);
      const vt = new Float64Array(2 * n);
      for (let k = 0; k < n; k++) {
        let x = 0, z = 0;
        for (const q of [k - 1, k]) {
          if (q < 0 || q >= n - 1) continue;
          const dx = poly[2 * q + 2]! - poly[2 * q]!, dz = poly[2 * q + 3]! - poly[2 * q + 1]!, l = Math.hypot(dx, dz);
          if (l > 1e-9) { x += dx / l; z += dz / l; }
        }
        const l = Math.hypot(x, z) || 1;
        vt[2 * k] = x / l; vt[2 * k + 1] = z / l;
      }
      this.roads.push({ id: r.id, poly, half: r.half, s, vt, sign, base });
      if (r.half > this.maxHalf) this.maxHalf = r.half;
    }
    for (let ri = 0; ri < this.roads.length; ri++) {
      const r = this.roads[ri]!, p = r.poly;
      for (let k = 0; k + 3 < p.length; k += 2) {
        const code = ri * 4096 + k / 2;
        this.insert(this.near, code, p, k, r.half + GridField.NEAR);
        this.insert(this.far, code, p, k, r.half + FIELD_ROAD_REACH);
      }
    }
  }

  private insert(map: Map<number, number[]>, code: number, p: Float64Array, k: number, pad: number): void {
    const S = GridField.BUCKET;
    const i0 = Math.floor((Math.min(p[k]!, p[k + 2]!) - pad) / S), i1 = Math.floor((Math.max(p[k]!, p[k + 2]!) + pad) / S);
    const j0 = Math.floor((Math.min(p[k + 1]!, p[k + 3]!) - pad) / S), j1 = Math.floor((Math.max(p[k + 1]!, p[k + 3]!) + pad) / S);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const kk = key(i, j);
      let l = map.get(kk);
      if (!l) map.set(kk, (l = []));
      l.push(code);
    }
  }

  /** Deux routes les plus proches (bord), distinctes : [indice, segment, t, distance à l'axe, distance au bord]. */
  private nearestRoads(x: number, z: number): { a: number[] | null; b: number[] | null } {
    const S = GridField.BUCKET;
    const k = key(Math.floor(x / S), Math.floor(z / S));
    let res = this.scan(this.near.get(k), x, z, GridField.NEAR);
    if (!res.a || res.a[4]! > GridField.NEAR - FIELD_FADE) res = this.scan(this.far.get(k), x, z, FIELD_ROAD_REACH);
    return res;
  }

  private scan(list: number[] | undefined, x: number, z: number, reach: number): { a: number[] | null; b: number[] | null } {
    let a: number[] | null = null, b: number[] | null = null;
    if (!list) return { a, b };
    for (const code of list) {
      const ri = Math.floor(code / 4096), seg = code % 4096;
      const r = this.roads[ri]!, p = r.poly, k = seg * 2;
      const ax = p[k]!, az = p[k + 1]!, dx = p[k + 2]! - ax, dz = p[k + 3]! - az;
      const l2 = dx * dx + dz * dz;
      let t = l2 > 1e-12 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = x - ax - dx * t, ez = z - az - dz * t;
      const d = Math.sqrt(ex * ex + ez * ez);
      const e = d - r.half;
      if (e > reach) continue;
      if (!a || e < a[4]!) {
        if (a && a[0] !== ri) b = a;
        a = [ri, seg, t, d, e];
      } else if (ri !== a[0] && (!b || e < b[4]!)) b = [ri, seg, t, d, e];
    }
    if (a && b && b[0] === a[0]) b = null;
    return { a, b };
  }

  /** Trame d'une route au point le plus proche (sans bâtiment). */
  private roadLines(hit: number[], x: number, z: number): GridLines {
    const r = this.roads[hit[0]!]!, p = r.poly, k = hit[1]! * 2, t = hit[2]!;
    const dx = p[k + 2]! - p[k]!, dz = p[k + 3]! - p[k + 1]!, l = Math.hypot(dx, dz) || 1;
    // Tangente interpolée entre les sommets (courbe lisse) ; sur une route droite, direction du segment.
    const ix = r.vt[k]! * (1 - t) + r.vt[k + 2]! * t, iz = r.vt[k + 1]! * (1 - t) + r.vt[k + 3]! * t, il = Math.hypot(ix, iz) || 1;
    const tx = r.sign * ix / il, tz = r.sign * iz / il;
    const ox = p[k]! + dx * t, oz = p[k + 1]! + dz * t;
    const nx = -tz, nz = tx;
    const cn = ox * nx + oz * nz;
    const side = x * nx + z * nz - cn >= 0 ? 1 : -1;
    const offset = r.half + FACADE_GAP;
    const sO = r.s[hit[1]!]! + t * l;
    const pu = mod(ox * tx + oz * tz - r.sign * sO - r.base, this.cell);
    return { tx, tz, pu, pv: mod(cn + side * offset, this.cell), weight: 1, kind: 'route', roadId: r.id, side, cn, offset, edge: hit[4]! };
  }

  private obbLines(o: Obb, weight: number): GridLines {
    const [tx, tz] = canonicalTangent(o.c, -o.s);
    return { tx, tz, pu: obbPhase(o, tx, tz, this.cell), pv: obbPhase(o, -tz, tx, this.cell), weight, kind: 'batiment', roadId: -1, side: 1, cn: 0, offset: 0, edge: Infinity };
  }

  /** Trame de route en (x, z) recalée sur les bâtiments voisins (règle 1), sans fondu ; `plain` : sans le bâtiment proche. */
  private roadWithBuildings(hit: number[], x: number, z: number, obbs: readonly Obb[]): { lines: GridLines; snapDist: number; plain: GridLines; snap: Obb | null } {
    const plain = this.roadLines(hit, x, z);
    // Phase le long de la voie : bâtiment parallèle voisin dont la façade est sur une ligne de la trame en profondeur.
    const ph = this.neighbourPhase(plain, x, z, obbs);
    if (ph !== null) plain.pu = ph;
    // Bâtiment le plus proche à moins de FIELD_BUILDING_SNAP : ses côtés imposent les lignes.
    let bo: Obb | null = null, bd = Infinity;
    for (const o of obbs) { const d = obbDistance(o, x, z); if (d < bd) { bd = d; bo = o; } }
    if (!bo || bd > FIELD_BUILDING_SNAP) return { lines: { ...plain }, snapDist: bd, plain, snap: bo };
    return { lines: this.snapLines(plain, bo), snapDist: bd, plain, snap: bo };
  }

  /** Trame de route `L` recalée sur l'empreinte `o` (parallèle : phases ; en biais : repère de l'empreinte). */
  private snapLines(L: GridLines, o: Obb): GridLines {
    if (parallel(o, L.tx, L.tz, NEAR_PARALLEL)) {
      // Axes EXACTS du bâtiment (à quelques dixièmes de degré de la tangente locale sur une courbe), orientés comme T.
      const ax = o.c, az = -o.s, bx = o.s, bz = o.c;
      const da = ax * L.tx + az * L.tz, db = bx * L.tx + bz * L.tz;
      const [tx, tz] = Math.abs(da) >= Math.abs(db) ? (da >= 0 ? [ax, az] : [-ax, -az]) : (db >= 0 ? [bx, bz] : [-bx, -bz]);
      const nx = -tz, nz = tx;
      const side = o.cx * -L.tz + o.cz * L.tx - L.cn >= 0 ? 1 : -1;
      // Façade (côté route) sur une ligne : centre·N − côté × demi-profondeur.
      return { ...L, tx: tx + 0, tz: tz + 0, pu: obbPhase(o, tx, tz, this.cell), pv: mod(o.cx * nx + o.cz * nz - side * obbExtentAlong(o, nx, nz), this.cell) };
    }
    const B = this.obbLines(o, 1);
    B.roadId = L.roadId; B.edge = L.edge; B.side = L.side; B.cn = L.cn; B.offset = L.offset;
    return B;
  }

  private neighbourPhase(L: GridLines, x: number, z: number, obbs: readonly Obb[], reach = NEIGHBOUR_R, tol = 1.5): number | null {
    let best: number | null = null, bestD = Infinity;
    const nx = -L.tz, nz = L.tx;
    const pu = x * L.tx + z * L.tz;
    for (const o of obbs) {
      if (!parallel(o, L.tx, L.tz, NEAR_PARALLEL)) continue;
      const n = o.cx * nx + o.cz * nz - L.cn;
      if ((n >= 0 ? 1 : -1) !== L.side) continue;
      const front = Math.abs(n) - L.offset - obbExtentAlong(o, nx, nz);
      if (front < -tol || lineGap(front, this.cell) > tol) continue;
      if (Math.abs(o.cx * L.tx + o.cz * L.tz - pu) > reach + obbExtentAlong(o, L.tx, L.tz)) continue;
      const d = (o.cx - x) * (o.cx - x) + (o.cz - z) * (o.cz - z);
      if (d < bestD) { bestD = d; best = obbPhase(o, L.tx, L.tz, this.cell); }
    }
    return best;
  }

  /** Lignes affichées en (x, z). */
  linesAt(x: number, z: number): GridLines {
    const { a, b } = this.nearestRoads(x, z);
    const R = a ? NEIGHBOUR_R : FIELD_BUILDING_REACH + FIELD_FADE;
    const obbs = this.obbs(x - R, z - R, x + R, z + R, this.tmp);
    if (a) {
      const m = this.roadWithBuildings(a, x, z, obbs);
      let L = m.lines;
      // Fondu au bord de la zone d'un bâtiment recalé (trame différente de celle de la route), des deux côtés.
      if (m.snap && m.snapDist <= FIELD_BUILDING_SNAP + FIELD_FADE) {
        const shifted = m.snapDist <= FIELD_BUILDING_SNAP ? L : this.snapLines(m.plain, m.snap);
        if (!sameLines(shifted, m.plain, this.cell)) L.weight *= smooth(0, FIELD_FADE / 2, Math.abs(m.snapDist - FIELD_BUILDING_SNAP));
      }
      // Fondu entre deux routes de trames différentes.
      if (b && b[4]! - a[4]! < FIELD_FADE) {
        const L2 = this.roadWithBuildings(b, x, z, obbs).lines;
        if (!sameLines(L, L2, this.cell)) L = { ...L, weight: L.weight * smooth(0, FIELD_FADE, b[4]! - a[4]!) };
      }
      return L;
    }
    // Loin des routes : repère du bâtiment le plus proche.
    let o1: Obb | null = null, d1 = Infinity, o2: Obb | null = null, d2 = Infinity;
    for (const o of obbs) {
      const d = obbDistance(o, x, z);
      if (d < d1) { o2 = o1; d2 = d1; o1 = o; d1 = d; } else if (d < d2) { o2 = o; d2 = d; }
    }
    if (o1 && d1 <= FIELD_BUILDING_REACH) {
      const L = this.obbLines(o1, 1);
      if (o2 && d2 - d1 < FIELD_FADE && !sameLines(L, this.obbLines(o2, 1), this.cell)) L.weight = smooth(0, FIELD_FADE, d2 - d1);
      if (d1 > FIELD_BUILDING_REACH - FIELD_FADE) L.weight *= smooth(FIELD_BUILDING_REACH, FIELD_BUILDING_REACH - FIELD_FADE, d1);
      return L;
    }
    return worldLines();
  }

  /** Case de la trame contenant (x, z) : centre, direction, lignes. */
  cellAt(x: number, z: number, L = this.linesAt(x, z)): { cx: number; cz: number; tx: number; tz: number; lines: GridLines } {
    const c = this.cell, nx = -L.tz, nz = L.tx;
    const a = L.pu + (Math.floor((x * L.tx + z * L.tz - L.pu) / c) + 0.5) * c;
    const b = L.pv + (Math.floor((x * nx + z * nz - L.pv) / c) + 0.5) * c;
    return { cx: a * L.tx + b * nx, cz: a * L.tz + b * nz, tx: L.tx, tz: L.tz, lines: L };
  }

  /**
   * Case « propre » : la case `c` (calculée avec une trame voisine) recalculée dans la trame de son propre centre ;
   * gardée si elle ne bouge presque pas (même case : route droite, courbe, bâtiment), null sinon (case à cheval sur
   * deux trames, aux carrefours ou au bord d'une zone recalée). Utilisée pour les cases de zonage.
   */
  ownCell(c: { cx: number; cz: number; tx: number; tz: number }): { cx: number; cz: number; tx: number; tz: number; lines: GridLines } | null {
    const o = this.cellAt(c.cx, c.cz);
    const cross = Math.abs(o.tx * c.tz - o.tz * c.tx), dot = Math.abs(o.tx * c.tx + o.tz * c.tz);
    // Directions parallèles ou perpendiculaires (à ≈ 3° près : tangente d'une courbe à quelques mètres).
    if (Math.min(cross, dot) > 0.05) return null;
    return Math.hypot(o.cx - c.cx, o.cz - c.cz) < 0.75 ? o : null;
  }

  /** Case propre contenant (x, z) (voir `ownCell`). */
  ownCellAt(x: number, z: number): { cx: number; cz: number; tx: number; tz: number; lines: GridLines } | null {
    return this.ownCell(this.cellAt(x, z));
  }

  /** Trame de route au format de src/shared/road-grid.ts (aimantation), null hors route. */
  roadFrameAt(x: number, z: number): RoadGridFrame | null {
    const { a } = this.nearestRoads(x, z);
    if (!a) return null;
    const R = NEIGHBOUR_R;
    const L = this.roadWithBuildings(a, x, z, this.obbs(x - R, z - R, x + R, z + R, this.tmp)).lines;
    if (L.kind !== 'route') return null;
    return { tx: L.tx, tz: L.tz, nx: -L.tz + 0, nz: L.tx + 0, cn: L.cn, offset: L.offset, phase: L.pu, cell: this.cell };
  }

  /**
   * Remplit une texture RGBA (angle de T, pu, pv, intensité + 2 si axes du monde) de `n × n` texels de `texel` m,
   * coin (x0, z0), lignes [j0, j1[.
   */
  fill(out: Float32Array, x0: number, z0: number, n: number, texel: number, j0 = 0, j1 = n): void {
    for (let j = j0; j < j1; j++) {
      const z = z0 + (j + 0.5) * texel;
      for (let i = 0; i < n; i++) {
        const L = this.linesAt(x0 + (i + 0.5) * texel, z);
        const o = (j * n + i) * 4;
        out[o] = Math.atan2(L.tz, L.tx);
        out[o + 1] = L.pu;
        out[o + 2] = L.pv;
        out[o + 3] = L.weight + (L.kind === 'monde' ? 2 : 0);
      }
    }
  }
}

/** Axes du monde (lignes aux multiples de la case). */
export function worldLines(): GridLines {
  return { tx: 1, tz: 0, pu: 0, pv: 0, weight: 1, kind: 'monde', roadId: -1, side: 1, cn: 0, offset: 0, edge: Infinity };
}
