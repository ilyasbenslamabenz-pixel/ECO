/**
 * Constructeur de maillages des assets transport (Node pur, sans three).
 *  - matériaux nommés (voir materials.ts) : peintures teintées partageant une texture, atlas de détails,
 *    jeux Poly Haven réutilisés (béton, asphalte, bac acier, tôle de conteneur), verre ;
 *  - UV : projection boîte en mètres (matériaux « tuile ») ou rectangle d'une région de l'atlas ;
 *  - primitives : quad, boîte, boîte à rectangle d'atlas par face, tube entre deux points, tour (lathe),
 *    grille/loft avec lissage par angle, extrusion de polygone (triangulation par oreilles) ;
 *  - pile de transformations affines.
 * Unités : mètres ; Y vers le haut ; façade / avant vers +Z.
 */
import { MAT, type MatKey } from './materials';
import { regionUv, type RegionName } from './textures';

export type V3 = [number, number, number];
export interface Group { pos: number[]; nrm: number[]; uv: number[]; idx: number[] }

export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scl = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: V3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

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

/** Rectangle UV dans une région d'atlas : [s0, t0, s1, t1] (fractions de la région, t vers le bas). */
export type SubRect = [number, number, number, number];
export type UvSpec = { region: RegionName; rect?: SubRect } | undefined;

export interface SurfaceOpts {
  closedJ?: boolean;
  smoothAngle?: number;
  /** Matériau par quad (i, j) ; null = quad omis. */
  mat: MatKey | ((i: number, j: number) => MatKey | null);
  /** UV par sommet de grille (i, j) normalisés [0,1] → mappés dans la région ; sinon projection boîte. */
  region?: RegionName | ((i: number, j: number) => RegionName | null);
  uv?: (i: number, j: number, p: V3) => [number, number];
  flip?: boolean;
  autoOrient?: boolean;
}

export class TMesh {
  readonly groups = new Map<MatKey, Group>();
  private m: M = IDENT.slice();
  private stack: M[] = [];
  constructor(readonly lod: number) {}

  push(): this { this.stack.push(this.m.slice()); return this; }
  pop(): this { this.m = this.stack.pop() ?? IDENT.slice(); return this; }
  translate(x: number, y: number, z: number): this { this.m = mul(this.m, [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z]); return this; }
  rotY(a: number): this { const c = Math.cos(a), s = Math.sin(a); this.m = mul(this.m, [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0]); return this; }
  rotX(a: number): this { const c = Math.cos(a), s = Math.sin(a); this.m = mul(this.m, [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0]); return this; }
  rotZ(a: number): this { const c = Math.cos(a), s = Math.sin(a); this.m = mul(this.m, [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0]); return this; }
  scale(x: number, y: number, z: number): this { this.m = mul(this.m, [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0]); return this; }

  private g(mat: MatKey): Group {
    let g = this.groups.get(mat);
    if (!g) { g = { pos: [], nrm: [], uv: [], idx: [] }; this.groups.set(mat, g); }
    return g;
  }
  tp(p: V3): V3 {
    const m = this.m;
    return [m[0]! * p[0] + m[1]! * p[1] + m[2]! * p[2] + m[3]!, m[4]! * p[0] + m[5]! * p[1] + m[6]! * p[2] + m[7]!, m[8]! * p[0] + m[9]! * p[1] + m[10]! * p[2] + m[11]!];
  }
  private tn(n: V3): V3 {
    const m = this.m;
    const a = m[0]!, b = m[1]!, c = m[2]!, d = m[4]!, e = m[5]!, f = m[6]!, g = m[8]!, h = m[9]!, i = m[10]!;
    const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
    const D = -(b * i - c * h), E = a * i - c * g, F = -(a * h - b * g);
    const G = b * f - c * e, H = -(a * f - c * d), I = a * e - b * d;
    const det = a * A + b * B + c * C;
    const s = det < 0 ? -1 : 1;
    return norm([s * (A * n[0] + B * n[1] + C * n[2]), s * (D * n[0] + E * n[1] + F * n[2]), s * (G * n[0] + H * n[1] + I * n[2])]);
  }
  private det(): number {
    const m = this.m;
    return m[0]! * (m[5]! * m[10]! - m[6]! * m[9]!) - m[1]! * (m[4]! * m[10]! - m[6]! * m[8]!) + m[2]! * (m[4]! * m[9]! - m[5]! * m[8]!);
  }

  /** UV « tuile » : projection boîte des coordonnées (transformées) en mètres / taille de tuile du matériau. */
  static tileUv(mat: MatKey, P: V3, N: V3): [number, number] {
    const t = MAT[mat].tile ?? 1;
    const ax = Math.abs(N[0]), ay = Math.abs(N[1]), az = Math.abs(N[2]);
    if (ax >= ay && ax >= az) return [(N[0] > 0 ? -P[2] : P[2]) / t, -P[1] / t];
    if (ay >= az) return [P[0] / t, P[2] / t];
    return [(N[2] > 0 ? P[0] : -P[0]) / t, -P[1] / t];
  }

  /** Ajoute un sommet ; si (u, v) absent, UV tuile calculée sur la position transformée. */
  vert(mat: MatKey, p: V3, n: V3, u?: number, v?: number): number {
    const g = this.g(mat);
    const P = this.tp(p), N = this.tn(n);
    g.pos.push(P[0], P[1], P[2]);
    g.nrm.push(N[0], N[1], N[2]);
    if (u === undefined || v === undefined) { const t = TMesh.tileUv(mat, P, N); g.uv.push(t[0], t[1]); } else g.uv.push(u, v);
    return g.pos.length / 3 - 1;
  }
  tri(mat: MatKey, a: number, b: number, c: number): void {
    if (this.det() < 0) this.g(mat).idx.push(a, c, b);
    else this.g(mat).idx.push(a, b, c);
  }

  /** Quad plan a-b-c-d (anti-horaire vu de la face). uv : région d'atlas (u le long de a→b, v de a→d). */
  quad(mat: MatKey, a: V3, b: V3, c: V3, d: V3, uv?: UvSpec): void {
    const n = norm(cross(sub(b, a), sub(d, a)));
    let ids: number[];
    if (uv) {
      const r = regionUv(uv.region);
      const [s0, t0, s1, t1] = uv.rect ?? [0, 0, 1, 1];
      const U = (s: number): number => r.u0 + (r.u1 - r.u0) * s;
      const V = (t: number): number => r.v0 + (r.v1 - r.v0) * t;
      const uvs: [number, number][] = [[U(s0), V(t1)], [U(s1), V(t1)], [U(s1), V(t0)], [U(s0), V(t0)]];
      ids = [a, b, c, d].map((p, k) => this.vert(mat, p, n, uvs[k]![0], uvs[k]![1]));
    } else ids = [a, b, c, d].map((p) => this.vert(mat, p, n));
    this.tri(mat, ids[0]!, ids[1]!, ids[2]!);
    this.tri(mat, ids[0]!, ids[2]!, ids[3]!);
  }

  /**
   * Boîte (arêtes vives). `uv` : région d'atlas appliquée à chaque face, ou par face {pz, nz, px, nx, py, ny}.
   * `skip` : faces omises (ex. 'ny' pour une boîte posée au sol).
   */
  box(mat: MatKey, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, skip = '', uv?: UvSpec | Partial<Record<'pz' | 'nz' | 'px' | 'nx' | 'py' | 'ny', UvSpec>>, faceMat?: Partial<Record<'pz' | 'nz' | 'px' | 'nx' | 'py' | 'ny', MatKey>>): void {
    const faces: ['pz' | 'nz' | 'px' | 'nx' | 'py' | 'ny', V3, V3, V3, V3][] = [
      ['pz', [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
      ['nz', [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]],
      ['px', [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]],
      ['nx', [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]],
      ['py', [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]],
      ['ny', [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],
    ];
    for (const [k, a, b, c, d] of faces) {
      if (skip.includes(k)) continue;
      const u = uv && 'region' in uv ? uv as UvSpec : (uv as Record<string, UvSpec> | undefined)?.[k];
      this.quad(faceMat?.[k] ?? mat, a, b, c, d, u);
    }
  }
  /** Boîte centrée (cx, cz) posée sur y0. */
  boxC(mat: MatKey, cx: number, y0: number, cz: number, sx: number, sy: number, sz: number, skip = '', uv?: UvSpec): void {
    this.box(mat, cx - sx / 2, y0, cz - sz / 2, cx + sx / 2, y0 + sy, cz + sz / 2, skip, uv);
  }

  /** Tube (cylindre) entre a et b, rayon r (ou [ra, rb] tronconique), `seg` côtés ; caps : bouchons. */
  tube(mat: MatKey, a: V3, b: V3, r: number | [number, number], seg: number, caps = true, region?: RegionName): void {
    const [ra, rb] = typeof r === 'number' ? [r, r] : r;
    const ax = norm(sub(b, a));
    const ref: V3 = Math.abs(ax[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u = norm(cross(ax, ref)), v = cross(ax, u);
    const ring = (c: V3, rr: number): V3[] => { const o: V3[] = []; for (let k = 0; k <= seg; k++) { const t = (k / seg) * Math.PI * 2; o.push(add(c, add(scl(u, Math.cos(t) * rr), scl(v, Math.sin(t) * rr)))); } return o; };
    const r0 = ring(a, ra), r1 = ring(b, rb);
    const smooth = seg >= 6;
    const reg = region ? regionUv(region) : null;
    for (let k = 0; k < seg; k++) {
      const t0 = (k / seg) * Math.PI * 2, t1 = ((k + 1) / seg) * Math.PI * 2;
      const n0 = add(scl(u, Math.cos(t0)), scl(v, Math.sin(t0))), n1 = add(scl(u, Math.cos(t1)), scl(v, Math.sin(t1)));
      const nf = norm(add(n0, n1));
      const N0 = smooth ? n0 : nf, N1 = smooth ? n1 : nf;
      const U0 = reg ? reg.u0 + (reg.u1 - reg.u0) * (k / seg) : undefined, U1 = reg ? reg.u0 + (reg.u1 - reg.u0) * ((k + 1) / seg) : undefined;
      const ia = this.vert(mat, r0[k]!, N0, U0, reg?.v1), ib = this.vert(mat, r0[k + 1]!, N1, U1, reg?.v1);
      const ic = this.vert(mat, r1[k + 1]!, N1, U1, reg?.v0), id = this.vert(mat, r1[k]!, N0, U0, reg?.v0);
      this.tri(mat, ia, ib, ic); this.tri(mat, ia, ic, id);
    }
    if (caps) {
      for (const [c, rr, nn, rev] of [[a, r0, scl(ax, -1), true], [b, r1, ax, false]] as [V3, V3[], V3, boolean][]) {
        const ci = this.vert(mat, c, nn, reg ? (reg.u0 + reg.u1) / 2 : undefined, reg ? (reg.v0 + reg.v1) / 2 : undefined);
        const ids = rr.slice(0, seg).map((p) => this.vert(mat, p, nn, reg ? (reg.u0 + reg.u1) / 2 : undefined, reg ? (reg.v0 + reg.v1) / 2 : undefined));
        for (let k = 0; k < seg; k++) { const p = ids[k]!, q = ids[(k + 1) % seg]!; if (rev) this.tri(mat, ci, q, p); else this.tri(mat, ci, p, q); }
      }
    }
  }

  /** Poutre de section rectangulaire w×h entre a et b (membrures, treillis). */
  beam(mat: MatKey, a: V3, b: V3, w: number, h = w): void {
    const ax = norm(sub(b, a));
    const ref: V3 = Math.abs(ax[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0];
    const u = scl(norm(cross(ax, ref)), w / 2), v = scl(norm(cross(u, ax)), h / 2);
    const c = (p: V3, su: number, sv: number): V3 => add(p, add(scl(u, su), scl(v, sv)));
    const A = [c(a, -1, -1), c(a, 1, -1), c(a, 1, 1), c(a, -1, 1)], B = [c(b, -1, -1), c(b, 1, -1), c(b, 1, 1), c(b, -1, 1)];
    for (let k = 0; k < 4; k++) { const k1 = (k + 1) % 4; this.quad(mat, A[k]!, A[k1]!, B[k1]!, B[k]!); }
    this.quad(mat, A[3]!, A[2]!, A[1]!, A[0]!);
    this.quad(mat, B[0]!, B[1]!, B[2]!, B[3]!);
  }

  /** Tour autour de Y : profil [(rayon, y)] du bas vers le haut, `seg` côtés. */
  lathe(mat: MatKey, profile: [number, number][], seg: number, smoothAngle = 40, region?: RegionName): void {
    const rows: V3[][] = profile.map(([r, y]) => { const row: V3[] = []; for (let k = 0; k < seg; k++) { const a = (k / seg) * Math.PI * 2; row.push([Math.cos(a) * r, y, -Math.sin(a) * r]); } return row; });
    this.surface(rows, { mat, closedJ: true, smoothAngle, ...(region ? { region } : {}) });
  }

  /**
   * Surface en grille grid[i][j]. Quad (i,j)-(i+1,j)-(i+1,j+1)-(i,j+1). Lissage par angle des normales.
   */
  surface(grid: V3[][], o: SurfaceOpts): void {
    const ni = grid.length, nj = grid[0]!.length;
    const qj = o.closedJ ? nj : nj - 1;
    const cosT = Math.cos(((o.smoothAngle ?? 40) * Math.PI) / 180);
    const P = (i: number, j: number): V3 => grid[i]![((j % nj) + nj) % nj]!;
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
        const f = fn[i * qj + j]; if (!f) continue;
        const a = P(i, j), c = P(i + 1, j + 1);
        acc += f[0] * ((a[0] + c[0]) / 2 - cx) + f[1] * ((a[1] + c[1]) / 2 - cy) + f[2] * ((a[2] + c[2]) / 2 - cz);
      }
      flipped = acc < 0 ? !o.flip : !!o.flip;
    }
    if (flipped) for (let k = 0; k < fn.length; k++) { const f = fn[k]; if (f) fn[k] = [-f[0], -f[1], -f[2]]; }
    const F = (i: number, j: number): V3 | null => {
      if (i < 0 || i >= ni - 1) return null;
      if (o.closedJ) j = ((j % qj) + qj) % qj; else if (j < 0 || j >= qj) return null;
      return fn[i * qj + j] ?? null;
    };
    const cache = new Map<string, number>();
    for (let i = 0; i < ni - 1; i++) for (let j = 0; j < qj; j++) {
      const face = F(i, j); if (!face) continue;
      const mat = typeof o.mat === 'function' ? o.mat(i, j) : o.mat; if (!mat) continue;
      const region = typeof o.region === 'function' ? o.region(i, j) : o.region;
      const ids = ([[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]] as [number, number][]).map(([ci, cj]) => {
        let s: V3 = [0, 0, 0];
        for (const [di, dj] of [[-1, -1], [-1, 0], [0, -1], [0, 0]] as const) { const f = F(ci + di, cj + dj); if (f && dot(f, face) >= cosT) s = add(s, f); }
        const n = len(s) > 1e-9 ? norm(s) : face;
        const key = `${mat}|${region ?? ''}|${ci}|${cj}|${n[0].toFixed(2)},${n[1].toFixed(2)},${n[2].toFixed(2)}`;
        let id = cache.get(key);
        if (id === undefined) {
          const p = P(ci, cj);
          if (region) {
            const r = regionUv(region);
            const [s0, t0] = o.uv ? o.uv(ci, cj, p) : [cj / qj, ci / (ni - 1)];
            id = this.vert(mat, p, n, r.u0 + (r.u1 - r.u0) * s0, r.v0 + (r.v1 - r.v0) * t0);
          } else id = this.vert(mat, p, n);
          cache.set(key, id);
        }
        return id;
      });
      if (flipped) { this.tri(mat, ids[0]!, ids[2]!, ids[1]!); this.tri(mat, ids[0]!, ids[3]!, ids[2]!); }
      else { this.tri(mat, ids[0]!, ids[1]!, ids[2]!); this.tri(mat, ids[0]!, ids[2]!, ids[3]!); }
    }
  }

  /** Polygone plan (plan XY local, z donné) triangulé par oreilles ; normale ±Z selon `facing`. */
  polygon(mat: MatKey, pts: [number, number][], z: number, facing: 1 | -1, region?: RegionName, bounds?: [number, number, number, number]): void {
    const tris = earcut(pts);
    const n: V3 = [0, 0, facing];
    const reg = region ? regionUv(region) : null;
    const [bx0, by0, bx1, by1] = bounds ?? polyBounds(pts);
    const ids = pts.map(([x, y]) => reg
      ? this.vert(mat, [x, y, z], n, reg.u0 + (reg.u1 - reg.u0) * ((facing > 0 ? x - bx0 : bx1 - x) / (bx1 - bx0 || 1)), reg.v0 + (reg.v1 - reg.v0) * ((by1 - y) / (by1 - by0 || 1)))
      : this.vert(mat, [x, y, z], n));
    for (const [a, b, c] of tris) { if (facing > 0) this.tri(mat, ids[a]!, ids[b]!, ids[c]!); else this.tri(mat, ids[a]!, ids[c]!, ids[b]!); }
  }

  /** Extrusion le long de Z (z0 → z1) d'un polygone XY (sens quelconque), avec bouchons. */
  extrude(mat: MatKey, pts: [number, number][], z0: number, z1: number, capMat?: MatKey, sideRegion?: RegionName, capRegion?: RegionName): void {
    const ccw = signedArea(pts) > 0 ? pts : pts.slice().reverse();
    const n = ccw.length;
    for (let k = 0; k < n; k++) {
      const [x0, y0] = ccw[k]!, [x1, y1] = ccw[(k + 1) % n]!;
      // côté : normale sortante (polygone anti-horaire en XY → normale = (dy, -dx))
      this.quad(mat, [x1, y1, z0], [x0, y0, z0], [x0, y0, z1], [x1, y1, z1], sideRegion ? { region: sideRegion } : undefined);
    }
    const bb = polyBounds(ccw);
    this.polygon(capMat ?? mat, ccw, z1, 1, capRegion, bb);
    this.polygon(capMat ?? mat, ccw, z0, -1, capRegion, bb);
  }

  triangleCount(): number { let s = 0; for (const g of this.groups.values()) s += g.idx.length / 3; return s; }

  bounds(): { min: V3; max: V3 } {
    const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
    for (const g of this.groups.values()) for (let i = 0; i < g.pos.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k]!, g.pos[i + k]!); max[k] = Math.max(max[k]!, g.pos[i + k]!); }
    return { min, max };
  }
  /** Décale toutes les positions (recentrage). */
  shift(dx: number, dy: number, dz: number): void {
    for (const g of this.groups.values()) for (let i = 0; i < g.pos.length; i += 3) { g.pos[i] = g.pos[i]! + dx; g.pos[i + 1] = g.pos[i + 1]! + dy; g.pos[i + 2] = g.pos[i + 2]! + dz; }
  }
}

function signedArea(p: [number, number][]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const [x0, y0] = p[i]!, [x1, y1] = p[(i + 1) % p.length]!; a += x0 * y1 - x1 * y0; }
  return a / 2;
}
function polyBounds(p: [number, number][]): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of p) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return [x0, y0, x1, y1];
}

/** Triangulation par oreilles d'un polygone simple ; renvoie des triangles anti-horaires (indices). */
export function earcut(pts: [number, number][]): [number, number, number][] {
  const n = pts.length;
  const idx = Array.from({ length: n }, (_, i) => i);
  if (signedArea(pts) < 0) idx.reverse();
  const out: [number, number, number][] = [];
  const area2 = (a: number, b: number, c: number): number => {
    const [ax, ay] = pts[a]!, [bx, by] = pts[b]!, [cx, cy] = pts[c]!;
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  };
  const inside = (p: number, a: number, b: number, c: number): boolean => area2(a, b, p) >= -1e-12 && area2(b, c, p) >= -1e-12 && area2(c, a, p) >= -1e-12;
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let cut = false;
    for (let k = 0; k < idx.length; k++) {
      const a = idx[(k + idx.length - 1) % idx.length]!, b = idx[k]!, c = idx[(k + 1) % idx.length]!;
      if (area2(a, b, c) <= 1e-12) continue;
      let ok = true;
      for (const p of idx) { if (p === a || p === b || p === c) continue; if (inside(p, a, b, c)) { ok = false; break; } }
      if (!ok) continue;
      out.push([a, b, c]); idx.splice(k, 1); cut = true; break;
    }
    if (!cut) break;
  }
  if (idx.length === 3) out.push([idx[0]!, idx[1]!, idx[2]!]);
  return out;
}

/* ------------------------------------------------------------------ */
/* Modèle multi-nœuds (pièces animables)                                */
/* ------------------------------------------------------------------ */

export interface AnimSpec { kind: 'translate' | 'rotate' | 'scale'; axis: 'x' | 'y' | 'z'; min: number; max: number; note: string }

export interface TNode {
  name: string;
  mesh: TMesh;
  /** Translation par rapport au parent (pivot) ; nulle pour la racine. */
  t: V3;
  /** Échelle initiale (nœuds étirables : câbles) ; défaut 1. */
  s?: V3;
  parent: TNode | null;
  anim?: AnimSpec;
}

/**
 * Modèle : un nœud racine `structure` (sans transformation, géométrie au repère du modèle)
 * et des nœuds enfants animables placés à leur pivot (translation seule).
 */
export class TModel {
  readonly nodes: TNode[] = [];
  readonly root: TNode;
  constructor(readonly lod: number) {
    this.root = { name: 'structure', mesh: new TMesh(lod), t: [0, 0, 0], parent: null };
    this.nodes.push(this.root);
  }
  get mb(): TMesh { return this.root.mesh; }
  node(name: string, parent: TNode, pivot: V3, anim?: AnimSpec, scale?: V3): TNode {
    const n: TNode = { name, mesh: new TMesh(this.lod), t: pivot, parent, ...(anim ? { anim } : {}), ...(scale ? { s: scale } : {}) };
    this.nodes.push(n);
    return n;
  }
  worldOffset(n: TNode): V3 { let o: V3 = [0, 0, 0]; for (let c: TNode | null = n; c; c = c.parent) o = add(o, c.t); return o; }
  bounds(): { min: V3; max: V3 } {
    const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
    for (const n of this.nodes) {
      const b = n.mesh.bounds(), o = this.worldOffset(n), sc = n.s ?? [1, 1, 1];
      if (!Number.isFinite(b.min[0])) continue;
      for (let k = 0; k < 3; k++) {
        const a = b.min[k]! * sc[k]!, c = b.max[k]! * sc[k]!;
        min[k] = Math.min(min[k]!, Math.min(a, c) + o[k]!); max[k] = Math.max(max[k]!, Math.max(a, c) + o[k]!);
      }
    }
    return { min, max };
  }
  /** Recentrage : centre de l'emprise en (0, 0), base à y = 0. */
  recenter(): void {
    const b = this.bounds();
    const d: V3 = [-(b.min[0] + b.max[0]) / 2, -b.min[1], -(b.min[2] + b.max[2]) / 2];
    this.root.mesh.shift(d[0], d[1], d[2]);
    for (const n of this.nodes) if (n.parent === this.root) n.t = add(n.t, d);
  }
  triangleCount(): number { return this.nodes.reduce((s, n) => s + n.mesh.triangleCount(), 0); }
}
