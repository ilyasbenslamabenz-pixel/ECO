/**
 * Constructeur de maillages des véhicules (Node pur, sans three) :
 * 3 matériaux — `peinture` (carrosserie teintée par variante/instance), `atlas` (détails texturés,
 * optiques émissives), `verre` (vitrages). Surfaces en grille (lofts) avec lissage par angle
 * (arêtes vives conservées), tours (lathe), boîtes arrondies, décalques plaqués sur l'atlas.
 * Unités : mètres ; Y vers le haut ; avant du véhicule vers +Z ; origine au sol, au centre.
 */
import { regionUv, type RegionName } from './textures';

export type V3 = [number, number, number];
export type Mat = 'peinture' | 'atlas' | 'verre';
export const MATS: readonly Mat[] = ['peinture', 'atlas', 'verre'];

export interface Group { pos: number[]; nrm: number[]; uv: number[]; idx: number[] }

/** UV de la peinture : projection boîte en mètres / PAINT_TILE. */
export const PAINT_TILE = 0.75;

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: V3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** Matrice affine 3×4 (ligne par ligne). */
type M = number[];
const IDENT: M = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
function mul(a: M, b: M): M {
  const o = new Array<number>(12);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) o[r * 4 + c] = a[r * 4]! * b[c]! + a[r * 4 + 1]! * b[4 + c]! + a[r * 4 + 2]! * b[8 + c]!;
    o[r * 4 + 3] = a[r * 4]! * b[3]! + a[r * 4 + 1]! * b[7]! + a[r * 4 + 2]! * b[11]! + a[r * 4 + 3]!;
  }
  return o;
}

export type UvFn = (p: V3, n: V3, i: number, j: number) => [number, number];
export type MatFn = (i: number, j: number) => { mat: Mat; region?: RegionName } | null;

export interface SurfaceOpts {
  /** Grille fermée selon j (anneau). */
  closedJ?: boolean;
  /** Angle de lissage (degrés) ; au-delà l'arête reste vive. Défaut 50. */
  smoothAngle?: number;
  /** Matériau par quad (i, j) ; null = quad omis. */
  mat: Mat | MatFn;
  /** UV par sommet ; défaut : projection boîte (peinture) ou région d'atlas en (i, j) normalisés. */
  uv?: UvFn;
  /** Inverser l'orientation des faces. */
  flip?: boolean;
  /** Oriente automatiquement les faces vers l'extérieur (centroïde de la grille). Défaut : vrai si closedJ. */
  autoOrient?: boolean;
}

export class VMesh {
  readonly groups: Record<Mat, Group> = { peinture: { pos: [], nrm: [], uv: [], idx: [] }, atlas: { pos: [], nrm: [], uv: [], idx: [] }, verre: { pos: [], nrm: [], uv: [], idx: [] } };
  private m: M = IDENT.slice();
  private stack: M[] = [];
  /** Niveau de détail courant (0, 1, 2). */
  constructor(readonly lod: number) {}

  push(): this { this.stack.push(this.m.slice()); return this; }
  pop(): this { this.m = this.stack.pop() ?? IDENT.slice(); return this; }
  translate(x: number, y: number, z: number): this { this.m = mul(this.m, [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z]); return this; }
  rotY(a: number): this { const c = Math.cos(a), s = Math.sin(a); this.m = mul(this.m, [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0]); return this; }
  rotX(a: number): this { const c = Math.cos(a), s = Math.sin(a); this.m = mul(this.m, [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0]); return this; }
  rotZ(a: number): this { const c = Math.cos(a), s = Math.sin(a); this.m = mul(this.m, [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0]); return this; }
  scale(x: number, y: number, z: number): this { this.m = mul(this.m, [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0]); return this; }

  private tp(p: V3): V3 {
    const m = this.m;
    return [m[0]! * p[0] + m[1]! * p[1] + m[2]! * p[2] + m[3]!, m[4]! * p[0] + m[5]! * p[1] + m[6]! * p[2] + m[7]!, m[8]! * p[0] + m[9]! * p[1] + m[10]! * p[2] + m[11]!];
  }
  private tn(n: V3): V3 {
    // inverse-transposée de la partie linéaire
    const m = this.m;
    const a = m[0]!, b = m[1]!, c = m[2]!, d = m[4]!, e = m[5]!, f = m[6]!, g = m[8]!, h = m[9]!, i = m[10]!;
    const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
    const D = -(b * i - c * h), E = a * i - c * g, F = -(a * h - b * g);
    const G = b * f - c * e, H = -(a * f - c * d), I = a * e - b * d;
    // cofacteurs = (inverse-transposée) × déterminant ; le signe du déterminant est corrigé
    const det = a * A + b * B + c * C;
    const s = det < 0 ? -1 : 1;
    return norm([s * (A * n[0] + B * n[1] + C * n[2]), s * (D * n[0] + E * n[1] + F * n[2]), s * (G * n[0] + H * n[1] + I * n[2])]);
  }
  private det(): number {
    const m = this.m;
    return m[0]! * (m[5]! * m[10]! - m[6]! * m[9]!) - m[1]! * (m[4]! * m[10]! - m[6]! * m[8]!) + m[2]! * (m[4]! * m[9]! - m[5]! * m[8]!);
  }

  /** Ajoute un sommet (coordonnées locales, transformées par la pile). */
  vert(mat: Mat, p: V3, n: V3, u: number, v: number): number {
    const g = this.groups[mat];
    const P = this.tp(p), N = this.tn(n);
    g.pos.push(P[0], P[1], P[2]);
    g.nrm.push(N[0], N[1], N[2]);
    g.uv.push(u, v);
    return g.pos.length / 3 - 1;
  }
  tri(mat: Mat, a: number, b: number, c: number): void {
    if (this.det() < 0) this.groups[mat].idx.push(a, c, b);
    else this.groups[mat].idx.push(a, b, c);
  }

  /** UV peinture : projection boîte en coordonnées locales. */
  static paintUv(p: V3, n: V3): [number, number] {
    const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
    if (ax >= ay && ax >= az) return [p[2] / PAINT_TILE, -p[1] / PAINT_TILE];
    if (ay >= az) return [p[0] / PAINT_TILE, p[2] / PAINT_TILE];
    return [p[0] / PAINT_TILE, -p[1] / PAINT_TILE];
  }

  /**
   * Surface en grille : grid[i][j] (i = rangée, j = colonne). Quad (i, j) = (i,j)-(i+1,j)-(i+1,j+1)-(i,j+1).
   * Orientation : normale = (P[i+1][j] − P[i][j]) × (P[i][j+1] − P[i][j]) (inversée si flip).
   */
  surface(grid: V3[][], o: SurfaceOpts): void {
    const ni = grid.length, nj = grid[0]!.length;
    const qj = o.closedJ ? nj : nj - 1;
    const cosT = Math.cos(((o.smoothAngle ?? 50) * Math.PI) / 180);
    const P = (i: number, j: number): V3 => grid[i]![((j % nj) + nj) % nj]!;
    // normales de faces
    const fn: (V3 | null)[] = [];
    for (let i = 0; i < ni - 1; i++) for (let j = 0; j < qj; j++) {
      const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
      const n = cross(sub(c, a), sub(d, b));
      const l = len(n);
      fn.push(l > 1e-10 ? [n[0] / l, n[1] / l, n[2] / l] : null);
    }
    let flipped = !!o.flip;
    if (o.autoOrient ?? o.closedJ ?? false) {
      let cx = 0, cy = 0, cz = 0, cnt = 0;
      for (const row of grid) for (const p of row) { cx += p[0]; cy += p[1]; cz += p[2]; cnt++; }
      cx /= cnt; cy /= cnt; cz /= cnt;
      let acc = 0;
      for (let i = 0; i < ni - 1; i++) for (let j = 0; j < qj; j++) {
        const f = fn[i * qj + j];
        if (!f) continue;
        const a = P(i, j), c = P(i + 1, j + 1);
        acc += f[0] * ((a[0] + c[0]) / 2 - cx) + f[1] * ((a[1] + c[1]) / 2 - cy) + f[2] * ((a[2] + c[2]) / 2 - cz);
      }
      flipped = acc < 0;
    }
    if (flipped) for (let k = 0; k < fn.length; k++) { const f = fn[k]; if (f) fn[k] = [-f[0], -f[1], -f[2]]; }
    const F = (i: number, j: number): V3 | null => {
      if (i < 0 || i >= ni - 1) return null;
      if (o.closedJ) j = ((j % qj) + qj) % qj; else if (j < 0 || j >= qj) return null;
      return fn[i * qj + j] ?? null;
    };
    const matOf = (i: number, j: number): { mat: Mat; region?: RegionName } | null => typeof o.mat === 'function' ? o.mat(i, j) : { mat: o.mat };
    const cache = new Map<string, number>();
    const cornerNormal = (vi: number, vj: number, face: V3): V3 => {
      let s: V3 = [0, 0, 0];
      for (const [di, dj] of [[-1, -1], [-1, 0], [0, -1], [0, 0]] as const) {
        const f = F(vi + di, vj + dj);
        if (f && dot(f, face) >= cosT) s = [s[0] + f[0], s[1] + f[1], s[2] + f[2]];
      }
      return len(s) > 1e-9 ? norm(s) : face;
    };
    for (let i = 0; i < ni - 1; i++) for (let j = 0; j < qj; j++) {
      const face = F(i, j);
      if (!face) continue;
      const mm = matOf(i, j);
      if (!mm) continue;
      const corners: [number, number][] = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
      const ids = corners.map(([ci, cj]) => {
        const n = cornerNormal(ci, cj, face);
        const key = `${mm.mat}|${mm.region ?? ''}|${ci}|${((cj % nj) + nj) % nj}|${n[0].toFixed(2)},${n[1].toFixed(2)},${n[2].toFixed(2)}|${o.closedJ && cj === nj ? 'w' : ''}`;
        let id = cache.get(key);
        if (id === undefined) {
          const p = P(ci, cj);
          let uv: [number, number];
          if (o.uv) uv = o.uv(p, n, ci, cj);
          else if (mm.mat === 'atlas' && mm.region) {
            const r = regionUv(mm.region);
            uv = [r.u0 + (r.u1 - r.u0) * (cj / qj), r.v0 + (r.v1 - r.v0) * (ci / (ni - 1))];
          } else uv = VMesh.paintUv(p, n);
          if (mm.mat === 'atlas' && mm.region && o.uv) {
            const r = regionUv(mm.region);
            uv = [r.u0 + (r.u1 - r.u0) * uv[0], r.v0 + (r.v1 - r.v0) * uv[1]];
          }
          id = this.vert(mm.mat, p, n, uv[0], uv[1]);
          cache.set(key, id);
        }
        return id;
      });
      if (flipped) {
        this.tri(mm.mat, ids[0]!, ids[2]!, ids[1]!);
        this.tri(mm.mat, ids[0]!, ids[3]!, ids[2]!);
      } else {
        this.tri(mm.mat, ids[0]!, ids[1]!, ids[2]!);
        this.tri(mm.mat, ids[0]!, ids[2]!, ids[3]!);
      }
    }
  }

  /** Quad plan a-b-c-d (sens trigonométrique vu de la face). UV : région d'atlas (u le long de a→b, v de a→d) ou peinture. */
  quad(mat: Mat, a: V3, b: V3, c: V3, d: V3, region?: RegionName, uvRect?: [number, number, number, number]): void {
    const n = norm(cross(sub(b, a), sub(d, a)));
    let uvs: [number, number][];
    if (mat === 'atlas' && region) {
      const r = regionUv(region);
      const [s0, t0, s1, t1] = uvRect ?? [0, 0, 1, 1];
      const U = (s: number): number => r.u0 + (r.u1 - r.u0) * s;
      const V = (t: number): number => r.v0 + (r.v1 - r.v0) * t;
      // l'image a l'origine en haut : a (bas-gauche) -> v = t1
      uvs = [[U(s0), V(t1)], [U(s1), V(t1)], [U(s1), V(t0)], [U(s0), V(t0)]];
    } else uvs = [a, b, c, d].map((p) => VMesh.paintUv(p, n));
    const ids = [a, b, c, d].map((p, k) => this.vert(mat, p, n, uvs[k]![0], uvs[k]![1]));
    this.tri(mat, ids[0]!, ids[1]!, ids[2]!);
    this.tri(mat, ids[0]!, ids[2]!, ids[3]!);
  }

  /** Boîte (arêtes vives) ; `region` : même région d'atlas sur chaque face. `skip` : faces omises (px nx py ny pz nz). */
  box(mat: Mat, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, region?: RegionName, skip = ''): void {
    const f = (k: string, a: V3, b: V3, c: V3, d: V3): void => { if (!skip.includes(k)) this.quad(mat, a, b, c, d, region); };
    f('pz', [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
    f('nz', [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]);
    f('px', [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]);
    f('nx', [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]);
    f('py', [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]);
    f('ny', [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);
  }

  /**
   * Boîte à arêtes arrondies (rayon r, `seg` segments par quart) : anneaux de rectangles arrondis
   * le long de Z, extrémités arrondies elles aussi.
   */
  roundedBox(mat: Mat | MatFn, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, r: number, seg = 3, region?: RegionName): void {
    r = Math.min(r, sx / 2 - 1e-3, sy / 2 - 1e-3, sz / 2 - 1e-3);
    seg = Math.max(1, seg);
    const ring = (hx: number, hy: number, rr: number): [number, number][] => {
      const pts: [number, number][] = [];
      const cs: [number, number, number][] = [[hx - rr, -hy + rr, -Math.PI / 2], [hx - rr, hy - rr, 0], [-hx + rr, hy - rr, Math.PI / 2], [-hx + rr, -hy + rr, Math.PI]];
      for (const [ccx, ccy, a0] of cs) for (let k = 0; k <= seg; k++) {
        const a = a0 + (k / seg) * (Math.PI / 2);
        pts.push([ccx + Math.cos(a) * rr, ccy + Math.sin(a) * rr]);
      }
      return pts;
    };
    const rows: V3[][] = [];
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const zs: [number, number][] = []; // (z, inset)
    for (let k = 0; k <= seg; k++) { const a = (k / seg) * (Math.PI / 2); zs.push([-hz + r - Math.sin(a) * r, r - Math.cos(a) * r]); }
    zs.reverse();
    const front: [number, number][] = zs.map(([z, ins]): [number, number] => [-z, ins]).reverse();
    const all = [...zs, ...front];
    // collapse des extrémités : premier et dernier anneau réduits au rectangle intérieur
    for (const [z, ins] of all) {
      const rr = Math.max(1e-4, r - ins);
      rows.push(ring(hx - ins, hy - ins, rr).map(([x, y]) => [cx + x, cy + y, cz + z] as V3));
    }
    const mf: Mat | MatFn = typeof mat === 'function' ? mat : region ? (() => ({ mat, region })) : mat;
    this.surface(rows, { closedJ: true, mat: mf, smoothAngle: 60, ...(region ? { uv: (p: V3, n: V3) => boxUv01(p, n, cx, cy, cz, sx, sy, sz) } : {}) });
    // bouchons plats
    const cap = (z: number, sign: number): void => {
      const pts = ring(hx - r, hy - r, 1e-4).map(([x, y]) => [cx + x, cy + y, cz + z] as V3);
      const c: V3 = [cx, cy, cz + z];
      const m: Mat = typeof mat === 'function' ? (mat(0, 0)?.mat ?? 'peinture') : mat;
      const n: V3 = [0, 0, sign];
      const ci = this.vert(m, c, n, ...(region ? centerUv(region) : VMesh.paintUv(c, n)));
      const ids = pts.map((p) => this.vert(m, p, n, ...(region ? centerUv(region) : VMesh.paintUv(p, n))));
      for (let k = 0; k < ids.length; k++) {
        const a = ids[k]!, b = ids[(k + 1) % ids.length]!;
        if (sign > 0) this.tri(m, ci, a, b); else this.tri(m, ci, b, a);
      }
    };
    if (r < Math.min(hx, hy) - 1e-3) { cap(hz, 1); cap(-hz, -1); }
  }

  /**
   * Tour (lathe) autour de l'axe X local (roues) : profil [(rayon, x)], `seg` segments.
   * `uvMode` : 'radial' (disque : région centrée) ou 'band' (u = angle, v = abscisse du profil).
   */
  latheX(mat: Mat, profile: [number, number][], seg: number, region: RegionName | null, uvMode: 'radial' | 'band' | 'paint', smoothAngle = 40, uvMaxR = 0): void {
    const rows: V3[][] = profile.map(([r, x]) => {
      const row: V3[] = [];
      for (let k = 0; k <= seg; k++) { const a = (k / seg) * Math.PI * 2; row.push([x, Math.sin(a) * r, Math.cos(a) * r]); }
      return row;
    });
    const maxR = uvMaxR || Math.max(...profile.map((p) => p[0]));
    const uv: UvFn | undefined = region
      ? (p, _n, i, j) => uvMode === 'radial' ? [0.5 + (p[2] / maxR) * 0.5, 0.5 - (p[1] / maxR) * 0.5] : [j / seg, i / Math.max(1, profile.length - 1)]
      : undefined;
    this.surface(rows, { mat: region ? () => ({ mat, region }) : mat, smoothAngle, autoOrient: true, ...(uv ? { uv } : {}) });
  }

  triangleCount(): number { return MATS.reduce((s, m) => s + this.groups[m].idx.length / 3, 0); }

  bounds(): { min: V3; max: V3 } {
    const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
    for (const m of MATS) {
      const p = this.groups[m].pos;
      for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k]!, p[i + k]!); max[k] = Math.max(max[k]!, p[i + k]!); }
    }
    return { min, max };
  }
}

function centerUv(region: RegionName): [number, number] {
  const r = regionUv(region);
  return [(r.u0 + r.u1) / 2, (r.v0 + r.v1) / 2];
}

/** Projection boîte normalisée [0,1] sur les dimensions de la boîte (pour les régions d'atlas). */
function boxUv01(p: V3, n: V3, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number): [number, number] {
  const u = (p[0] - cx) / sx + 0.5, v = 0.5 - (p[1] - cy) / sy, w = (p[2] - cz) / sz + 0.5;
  const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
  const c = (x: number): number => Math.max(0, Math.min(1, x));
  if (ax >= ay && ax >= az) return [c(n[0] > 0 ? 1 - w : w), c(v)];
  if (ay >= az) return [c(u), c(w)];
  return [c(n[2] > 0 ? u : 1 - u), c(v)];
}
