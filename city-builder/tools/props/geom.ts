/**
 * Kit géométrique minimal du mobilier généré : primitives paramétriques (boîte, cylindre/tronc de cône,
 * tour (lathe), tube le long d'une polyligne, prisme à décor, sphère) écrites directement en tampons
 * (positions, normales, UV dans l'atlas partagé), par matériau. Mètres, Y vers le haut, face avant vers +Z.
 * Le niveau de détail `lod` (0, 1, 2) règle le nombre de segments ; `detail` masque les petites pièces au LOD2.
 */
import { cellRect, paletteRect, type CellName, type PaletteName } from './atlas';

export type V3 = [number, number, number];
export type MatName = 'atlas' | 'verre';
/** Rectangle UV dans l'atlas : une cellule ou un aplat de palette. */
export type Skin = CellName | `p:${PaletteName}`;
const rectOf = (s: Skin): [number, number, number, number] => (s.startsWith('p:') ? paletteRect(s.slice(2) as PaletteName) : cellRect(s as CellName));

/** Transformation affine (matrice 3 × 4, colonnes). */
export interface Tf { m: number[] }
export const I: Tf = { m: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0] };
export function mul(a: Tf, b: Tf): Tf {
  const A = a.m, B = b.m, r = new Array<number>(12);
  for (let c = 0; c < 4; c++) for (let row = 0; row < 3; row++) {
    r[c * 3 + row] = A[row]! * B[c * 3]! + A[3 + row]! * B[c * 3 + 1]! + A[6 + row]! * B[c * 3 + 2]! + (c === 3 ? A[9 + row]! : 0);
  }
  return { m: r };
}
export const T = (x: number, y: number, z: number): Tf => ({ m: [1, 0, 0, 0, 1, 0, 0, 0, 1, x, y, z] });
export const Ry = (a: number): Tf => { const c = Math.cos(a), s = Math.sin(a); return { m: [c, 0, -s, 0, 1, 0, s, 0, c, 0, 0, 0] }; };
export const Rx = (a: number): Tf => { const c = Math.cos(a), s = Math.sin(a); return { m: [1, 0, 0, 0, c, s, 0, -s, c, 0, 0, 0] }; };
export const Rz = (a: number): Tf => { const c = Math.cos(a), s = Math.sin(a); return { m: [c, s, 0, -s, c, 0, 0, 0, 1, 0, 0, 0] }; };
/** Composition de gauche à droite : chain(A, B, C) = A·B·C (C appliquée en premier). */
export const chain = (...t: Tf[]): Tf => t.reduce((a, b) => mul(a, b), I);
const apply = (t: Tf, p: V3): V3 => { const m = t.m; return [m[0]! * p[0] + m[3]! * p[1] + m[6]! * p[2] + m[9]!, m[1]! * p[0] + m[4]! * p[1] + m[7]! * p[2] + m[10]!, m[2]! * p[0] + m[5]! * p[1] + m[8]! * p[2] + m[11]!]; };
const applyN = (t: Tf, n: V3): V3 => { const m = t.m; const r: V3 = [m[0]! * n[0] + m[3]! * n[1] + m[6]! * n[2], m[1]! * n[0] + m[4]! * n[1] + m[7]! * n[2], m[2]! * n[0] + m[5]! * n[1] + m[8]! * n[2]]; const l = Math.hypot(...r) || 1; return [r[0] / l, r[1] / l, r[2] / l]; };

export interface Buffers { pos: number[]; nor: number[]; uv: number[]; idx: number[] }

export class Model {
  readonly parts = new Map<MatName, Buffers>();
  constructor(readonly lod: number) {}
  /** Segments circulaires selon le LOD (base au LOD0). */
  seg(base: number): number { return this.lod === 0 ? base : this.lod === 1 ? Math.max(6, Math.round(base / 2)) : Math.max(4, Math.round(base / 4)); }
  /** Vrai si les petites pièces doivent être modélisées à ce LOD (absentes au LOD2 par défaut). */
  detail(maxLod = 1): boolean { return this.lod <= maxLod; }
  private buf(mat: MatName): Buffers {
    let b = this.parts.get(mat);
    if (!b) { b = { pos: [], nor: [], uv: [], idx: [] }; this.parts.set(mat, b); }
    return b;
  }
  /** Ajoute des sommets (repère local) et des triangles. */
  private add(mat: MatName, tf: Tf, verts: { p: V3; n: V3; uv: [number, number] }[], tris: number[]): void {
    const b = this.buf(mat);
    const base = b.pos.length / 3;
    for (const v of verts) { b.pos.push(...apply(tf, v.p)); b.nor.push(...applyN(tf, v.n)); b.uv.push(...v.uv); }
    for (const i of tris) b.idx.push(base + i);
  }
  triangles(): number { let t = 0; for (const b of this.parts.values()) t += b.idx.length / 3; return t; }

  /** Quadrilatère plan (4 coins dans l'ordre trigonométrique vu de la face), UV = rectangle complet du skin. */
  quad(c: [V3, V3, V3, V3], skin: Skin, tf: Tf = I, mat: MatName = 'atlas', uvRect?: [number, number, number, number]): void {
    const [u0, v0, u1, v1] = uvRect ?? rectOf(skin);
    const e1: V3 = [c[1][0] - c[0][0], c[1][1] - c[0][1], c[1][2] - c[0][2]];
    const e2: V3 = [c[3][0] - c[0][0], c[3][1] - c[0][1], c[3][2] - c[0][2]];
    const n: V3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const l = Math.hypot(...n) || 1;
    const nn: V3 = [n[0] / l, n[1] / l, n[2] / l];
    this.add(mat, tf, [
      { p: c[0], n: nn, uv: [u0, v1] }, { p: c[1], n: nn, uv: [u1, v1] }, { p: c[2], n: nn, uv: [u1, v0] }, { p: c[3], n: nn, uv: [u0, v0] },
    ], [0, 1, 2, 0, 2, 3]);
  }

  /**
   * Boîte centrée en (0, y0 + sy/2, 0) : base à y = 0 du repère local. `front` : skin de la face +Z (décor plaqué).
   * Les autres faces utilisent `skin` (aplat ou matière, plaquée sur la face entière).
   */
  box(sx: number, sy: number, sz: number, skin: Skin, tf: Tf = I, opts: { front?: Skin; back?: Skin; mat?: MatName; noBottom?: boolean } = {}): void {
    const x = sx / 2, z = sz / 2, y0 = 0, y1 = sy;
    const P = (a: number, b: number, c: number): V3 => [a, b, c];
    const mat = opts.mat ?? 'atlas';
    this.quad([P(-x, y0, z), P(x, y0, z), P(x, y1, z), P(-x, y1, z)], opts.front ?? skin, tf, mat); // +Z
    this.quad([P(x, y0, -z), P(-x, y0, -z), P(-x, y1, -z), P(x, y1, -z)], opts.back ?? skin, tf, mat); // -Z
    this.quad([P(x, y0, z), P(x, y0, -z), P(x, y1, -z), P(x, y1, z)], skin, tf, mat); // +X
    this.quad([P(-x, y0, -z), P(-x, y0, z), P(-x, y1, z), P(-x, y1, -z)], skin, tf, mat); // -X
    this.quad([P(-x, y1, z), P(x, y1, z), P(x, y1, -z), P(-x, y1, -z)], skin, tf, mat); // +Y
    if (!opts.noBottom) this.quad([P(-x, y0, -z), P(x, y0, -z), P(x, y0, z), P(-x, y0, z)], skin, tf, mat); // -Y
  }

  /**
   * Surface de révolution autour de Y : profil [rayon, y] du bas vers le haut. Chaque segment du profil a ses
   * propres sommets (arêtes vives entre anneaux), normales lisses autour de l'axe. Bouchons optionnels.
   */
  lathe(profile: [number, number][], n: number, skin: Skin, tf: Tf = I, opts: { capTop?: boolean; capBottom?: boolean; mat?: MatName; arc?: number } = {}): void {
    const [u0, v0, u1, v1] = rectOf(skin);
    const arc = opts.arc ?? Math.PI * 2;
    const closed = arc >= Math.PI * 2 - 1e-6;
    let len = 0;
    for (let i = 1; i < profile.length; i++) len += Math.hypot(profile[i]![0] - profile[i - 1]![0], profile[i]![1] - profile[i - 1]![1]);
    let acc = 0;
    for (let i = 1; i < profile.length; i++) {
      const [ra, ya] = profile[i - 1]!, [rb, yb] = profile[i]!;
      const sl = Math.hypot(rb - ra, yb - ya);
      if (sl < 1e-6) continue;
      // normale du segment dans le plan (r, y)
      const nr = (yb - ya) / sl, ny = -(rb - ra) / sl;
      const verts: { p: V3; n: V3; uv: [number, number] }[] = [];
      const tris: number[] = [];
      const va = v1 - (acc / len) * (v1 - v0), vb = v1 - ((acc + sl) / len) * (v1 - v0);
      for (let k = 0; k <= n; k++) {
        const a = (k / n) * arc, c = Math.cos(a), s = Math.sin(a);
        const u = u0 + (k / n) * (u1 - u0);
        verts.push({ p: [ra * s, ya, ra * c], n: [nr * s, ny, nr * c], uv: [u, va] });
        verts.push({ p: [rb * s, yb, rb * c], n: [nr * s, ny, nr * c], uv: [u, vb] });
      }
      for (let k = 0; k < n; k++) { const a = 2 * k; tris.push(a, a + 2, a + 3, a, a + 3, a + 1); }
      this.add(opts.mat ?? 'atlas', tf, verts, tris);
      acc += sl;
    }
    const cap = (r: number, y: number, up: boolean): void => {
      if (r < 1e-4) return;
      const verts: { p: V3; n: V3; uv: [number, number] }[] = [{ p: [0, y, 0], n: [0, up ? 1 : -1, 0], uv: [(u0 + u1) / 2, (v0 + v1) / 2] }];
      for (let k = 0; k <= n; k++) {
        const a = (k / n) * arc;
        verts.push({ p: [r * Math.sin(a), y, r * Math.cos(a)], n: [0, up ? 1 : -1, 0], uv: [(u0 + u1) / 2 + Math.sin(a) * (u1 - u0) / 2, (v0 + v1) / 2 + Math.cos(a) * (v1 - v0) / 2] });
      }
      const tris: number[] = [];
      for (let k = 1; k <= n; k++) up ? tris.push(0, k, k + 1) : tris.push(0, k + 1, k);
      this.add(opts.mat ?? 'atlas', tf, verts, tris);
    };
    if (closed && opts.capTop !== false) cap(profile[profile.length - 1]![0], profile[profile.length - 1]![1], true);
    if (closed && opts.capBottom) cap(profile[0]![0], profile[0]![1], false);
  }

  /** Cylindre (ou tronc de cône r0 -> r1) de hauteur h, base en y = 0. */
  cyl(r0: number, h: number, n: number, skin: Skin, tf: Tf = I, opts: { r1?: number; capBottom?: boolean; capTop?: boolean; mat?: MatName } = {}): void {
    this.lathe([[r0, 0], [opts.r1 ?? r0, h]], n, skin, tf, { capBottom: opts.capBottom, capTop: opts.capTop, mat: opts.mat });
  }

  /** Tube de rayon r le long d'une polyligne (repère transporté), extrémités bouchées si `caps`. */
  tube(path: V3[], r: number, n: number, skin: Skin, tf: Tf = I, opts: { closed?: boolean; caps?: boolean } = {}): void {
    const [u0, v0, u1, v1] = rectOf(skin);
    const pts = opts.closed ? [...path, path[0]!] : path;
    const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const norm = (a: V3): V3 => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
    const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const tang: V3[] = pts.map((_, i) => {
      if (opts.closed && (i === 0 || i === pts.length - 1)) return norm([...sub(pts[1]!, pts[0]!)].map((v, k) => v + sub(pts[pts.length - 1]!, pts[pts.length - 2]!)[k]!) as V3);
      const a = pts[Math.max(0, i - 1)]!, b = pts[Math.min(pts.length - 1, i + 1)]!;
      return norm(sub(b, a));
    });
    const ref: V3 = Math.abs(tang[0]![1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let nx = norm(cross(ref, tang[0]!));
    const verts: { p: V3; n: V3; uv: [number, number] }[] = [];
    const tris: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const t = tang[i]!;
      // transport parallèle
      nx = norm(sub(nx, t.map((v) => v * (nx[0] * t[0] + nx[1] * t[1] + nx[2] * t[2])) as V3));
      const ny = cross(t, nx);
      for (let k = 0; k <= n; k++) {
        const a = (k / n) * Math.PI * 2;
        const d: V3 = [nx[0] * Math.cos(a) + ny[0] * Math.sin(a), nx[1] * Math.cos(a) + ny[1] * Math.sin(a), nx[2] * Math.cos(a) + ny[2] * Math.sin(a)];
        const p = pts[i]!;
        verts.push({ p: [p[0] + d[0] * r, p[1] + d[1] * r, p[2] + d[2] * r], n: d, uv: [u0 + (k / n) * (u1 - u0), v0 + (i / Math.max(1, pts.length - 1)) * (v1 - v0)] });
      }
    }
    const row = n + 1;
    for (let i = 0; i < pts.length - 1; i++) for (let k = 0; k < n; k++) {
      const a = i * row + k, b = a + row;
      tris.push(a, a + 1, b + 1, a, b + 1, b);
    }
    this.add('atlas', tf, verts, tris);
    if (opts.caps && !opts.closed) {
      for (const [i, sgn] of [[0, -1], [pts.length - 1, 1]] as const) {
        const t = tang[i]!;
        const cv: { p: V3; n: V3; uv: [number, number] }[] = [{ p: pts[i]!, n: [t[0] * sgn, t[1] * sgn, t[2] * sgn], uv: [(u0 + u1) / 2, (v0 + v1) / 2] }];
        for (let k = 0; k <= n; k++) cv.push({ ...verts[i * row + k]!, n: [t[0] * sgn, t[1] * sgn, t[2] * sgn] });
        const ct: number[] = [];
        for (let k = 1; k <= n; k++) sgn > 0 ? ct.push(0, k, k + 1) : ct.push(0, k + 1, k);
        this.add('atlas', tf, cv, ct);
      }
    }
  }

  /** Arc de cercle (pour tubes cintrés) : centre (cx, cy) dans le plan local XY, de a0 à a1. */
  static arc(cx: number, cy: number, r: number, a0: number, a1: number, n: number, z = 0): V3[] {
    return Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [cx + r * Math.cos(a), cy + r * Math.sin(a), z] as V3; });
  }

  /**
   * Plaque (prisme) de contour polygonal 2D (plan XY, sens trigonométrique), épaisseur `d` selon Z, face avant
   * en +Z plaquée avec `front` (UV = boîte englobante du contour -> cellule entière), dos et chants en `side`.
   */
  plate(poly: [number, number][], d: number, front: Skin, side: Skin, tf: Tf = I): void {
    const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const fan = (z: number, skin: Skin, nz: number): void => {
      const [u0, v0, u1, v1] = rectOf(skin);
      const verts = poly.map(([x, y]) => ({ p: [x, y, z] as V3, n: [0, 0, nz] as V3, uv: [u0 + ((x - minX) / (maxX - minX)) * (u1 - u0), v1 - ((y - minY) / (maxY - minY)) * (v1 - v0)] as [number, number] }));
      const tris: number[] = [];
      for (let i = 1; i < poly.length - 1; i++) nz > 0 ? tris.push(0, i, i + 1) : tris.push(0, i + 1, i);
      this.add('atlas', tf, verts, tris);
    };
    fan(d / 2, front, 1);
    fan(-d / 2, side, -1);
    for (let i = 0; i < poly.length; i++) {
      const [ax, ay] = poly[i]!, [bx, by] = poly[(i + 1) % poly.length]!;
      this.quad([[ax, ay, d / 2], [ax, ay, -d / 2], [bx, by, -d / 2], [bx, by, d / 2]], side, tf);
    }
  }

  /** Sphère centrée à l'origine (ou portion depuis le pôle bas jusqu'à `phiMax` ; `squashY` aplatit). */
  sphere(r: number, n: number, skin: Skin, tf: Tf = I, opts: { phiMax?: number; squashY?: number } = {}): void {
    const phiMax = opts.phiMax ?? Math.PI;
    const rings = Math.max(3, Math.round(n / 2));
    const prof: [number, number][] = [];
    for (let i = 0; i <= rings; i++) {
      const phi = (i / rings) * phiMax; // angle depuis le pôle bas
      prof.push([r * Math.sin(phi), -r * Math.cos(phi) * (opts.squashY ?? 1)]);
    }
    this.lathe(prof, n, skin, tf, { capTop: phiMax < Math.PI - 1e-3 });
  }
}

/** Polygones usuels (plan XY, centrés). */
export const shapes = {
  regular(n: number, r: number, phase = 0): [number, number][] { return Array.from({ length: n }, (_, i) => { const a = phase + (i / n) * Math.PI * 2; return [r * Math.cos(a), r * Math.sin(a)] as [number, number]; }); },
  rect(w: number, h: number): [number, number][] { return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]; },
  roundedRect(w: number, h: number, r: number, n: number): [number, number][] {
    const out: [number, number][] = [];
    const cs: [number, number, number][] = [[w / 2 - r, -h / 2 + r, -Math.PI / 2], [w / 2 - r, h / 2 - r, 0], [-w / 2 + r, h / 2 - r, Math.PI / 2], [-w / 2 + r, -h / 2 + r, Math.PI]];
    for (const [cx, cy, a0] of cs) for (let i = 0; i <= n; i++) { const a = a0 + (i / n) * (Math.PI / 2); out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
    return out;
  },
};
