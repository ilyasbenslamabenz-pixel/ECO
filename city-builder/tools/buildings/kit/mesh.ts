/**
 * Kit bâtiments — constructeur de maillage multi-matériaux (Node, sans three).
 *
 * - Une primitive glTF par matériau (nom du matériau = rôle : « facade », « toiture »…).
 * - Coordonnées de texture :
 *     'meters' : projection planaire automatique en MÈTRES dans l'espace du modèle (repère dérivé de la
 *                normale de la face : u horizontal le long du mur, v vers le haut/la pente). Les faces
 *                coplanaires voisines se raccordent sans couture ; l'échelle réelle du jeu de textures
 *                est appliquée par KHR_texture_transform (1 / tileSizeM) à l'export ;
 *     'unit'   : UV explicites 0..1 fournies par l'appelant (portes, portes de garage : une image = un panneau).
 * - Pile de transformations (translation + rotation autour de Y) pour poser des composants.
 * - Attribut `_LIT` (verres) : graine 0..1 par fenêtre (allumage nocturne au rendu) ; 2 = vitrine (toujours allumée la nuit),
 *   -1 = jamais allumé (garde-corps vitrés).
 */

export type V3 = [number, number, number];

export const v3 = (x: number, y: number, z: number): V3 => [x, y, z];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: V3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
/** a + b*s + c*t */
export const madd = (a: V3, b: V3, s: number, c?: V3, t = 0): V3 =>
  c ? [a[0] + b[0] * s + c[0] * t, a[1] + b[1] * s + c[1] * t, a[2] + b[2] * s + c[2] * t] : [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];

export type UvMode = 'meters' | 'unit';

/** Données d'une primitive (un matériau). */
export interface PrimData {
  pos: number[];
  nor: number[];
  uv: number[];
  lit: number[];
  idx: number[];
}

interface Xf { tx: number; ty: number; tz: number; c: number; s: number }

/** Repère UV planaire d'une face : u horizontal (vers la droite vue de l'extérieur), v vers le haut / la pente. */
export function planarBasis(n: V3): { U: V3; V: V3 } {
  if (Math.abs(n[1]) > 0.999) {
    const U: V3 = [1, 0, 0];
    return { U, V: cross(n, U) };
  }
  const U = norm(cross([0, 1, 0], n));
  return { U, V: cross(n, U) };
}

export class MeshBuilder {
  readonly prims = new Map<string, PrimData>();
  /** Graine d'allumage appliquée aux sommets des verres ajoutés (voir `_LIT`). */
  lit = 0.5;
  private stack: Xf[] = [];
  private xf: Xf = { tx: 0, ty: 0, tz: 0, c: 1, s: 0 };

  /** @param uvModes mode d'UV de chaque matériau ; @param glassMats matériaux qui portent l'attribut `_LIT`. */
  constructor(private readonly uvModes: Record<string, UvMode>, private readonly glassMats: ReadonlySet<string>) {}

  /* ---------------- transformations ---------------- */
  /** Empile une transformation locale : translation puis rotation `rotY` (rad, sens trigonométrique vu de dessus, +X -> -Z). */
  push(tx: number, ty: number, tz: number, rotY = 0): void {
    this.stack.push(this.xf);
    const p = this.xf;
    const c = Math.cos(rotY);
    const s = Math.sin(rotY);
    // nouvelle = parent ∘ (T ∘ R)
    const [wx, wy, wz] = this.apply([tx, ty, tz]);
    this.xf = { tx: wx, ty: wy, tz: wz, c: p.c * c - p.s * s, s: p.s * c + p.c * s };
  }
  pop(): void { this.xf = this.stack.pop() ?? { tx: 0, ty: 0, tz: 0, c: 1, s: 0 }; }
  /** Point local -> espace modèle. Rotation Y : x' = c x + s z ; z' = -s x + c z. */
  apply(p: V3): V3 {
    const { c, s } = this.xf;
    return [this.xf.tx + c * p[0] + s * p[2], this.xf.ty + p[1], this.xf.tz - s * p[0] + c * p[2]];
  }
  applyDir(d: V3): V3 {
    const { c, s } = this.xf;
    return [c * d[0] + s * d[2], d[1], -s * d[0] + c * d[2]];
  }

  private prim(mat: string): PrimData {
    let p = this.prims.get(mat);
    if (!p) {
      if (!(mat in this.uvModes)) throw new Error(`Matériau inconnu dans la palette : ${mat}`);
      p = { pos: [], nor: [], uv: [], lit: [], idx: [] };
      this.prims.set(mat, p);
    }
    return p;
  }

  /**
   * Polygone plan convexe (points locaux, ordre anti-horaire vu de l'extérieur).
   * `uvs` requis pour un matériau 'unit' (sinon projection planaire en mètres).
   */
  poly(mat: string, pts: V3[], uvs?: [number, number][]): void {
    if (pts.length < 3) return;
    const w = pts.map((p) => this.apply(p));
    // normale de Newell (robuste pour polygones légèrement non plans)
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < w.length; i++) {
      const a = w[i]!;
      const b = w[(i + 1) % w.length]!;
      nx += (a[1] - b[1]) * (a[2] + b[2]);
      ny += (a[2] - b[2]) * (a[0] + b[0]);
      nz += (a[0] - b[0]) * (a[1] + b[1]);
    }
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-9) return; // dégénéré
    const n: V3 = [nx / l, ny / l, nz / l];
    const pr = this.prim(mat);
    const base = pr.pos.length / 3;
    const mode = this.uvModes[mat];
    const { U, V } = planarBasis(n);
    const isGlass = this.glassMats.has(mat);
    for (let i = 0; i < w.length; i++) {
      const p = w[i]!;
      pr.pos.push(p[0], p[1], p[2]);
      pr.nor.push(n[0], n[1], n[2]);
      if (mode === 'unit' && uvs) pr.uv.push(uvs[i]![0], uvs[i]![1]);
      else pr.uv.push(dot(p, U), -dot(p, V));
      if (isGlass) pr.lit.push(this.lit);
    }
    for (let i = 1; i < w.length - 1; i++) pr.idx.push(base, base + i, base + i + 1);
  }

  /** Polygone orienté de sorte que sa normale ait une composante positive selon `dir` (local). */
  polyFacing(mat: string, pts: V3[], dir: V3): void {
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      nx += (a[1] - b[1]) * (a[2] + b[2]);
      ny += (a[2] - b[2]) * (a[0] + b[0]);
      nz += (a[0] - b[0]) * (a[1] + b[1]);
    }
    this.poly(mat, nx * dir[0] + ny * dir[1] + nz * dir[2] < 0 ? [...pts].reverse() : pts);
  }

  quad(mat: string, a: V3, b: V3, c: V3, d: V3, uvs?: [number, number][]): void { this.poly(mat, [a, b, c, d], uvs); }
  tri(mat: string, a: V3, b: V3, c: V3): void { this.poly(mat, [a, b, c]); }

  /** Maillage indexé lisse quelconque (points et normales locaux), UV en mètres si non fournies. */
  smooth(mat: string, pts: V3[], nors: V3[], tris: number[], uvs?: [number, number][]): void {
    const pr = this.prim(mat);
    const base = pr.pos.length / 3;
    const isGlass = this.glassMats.has(mat);
    for (let i = 0; i < pts.length; i++) {
      const p = this.apply(pts[i]!);
      const n = this.applyDir(nors[i]!);
      pr.pos.push(p[0], p[1], p[2]);
      pr.nor.push(n[0], n[1], n[2]);
      if (uvs) pr.uv.push(uvs[i]![0], uvs[i]![1]);
      else {
        const { U, V } = planarBasis(n);
        pr.uv.push(dot(p, U), -dot(p, V));
      }
      if (isGlass) pr.lit.push(this.lit);
    }
    for (const t of tris) pr.idx.push(base + t);
  }

  /**
   * Boîte alignée sur les axes locaux. `skip` : faces omises parmi 'px','nx','py','ny','pz','nz'
   * (faces cachées : économiser des triangles).
   */
  box(mat: string, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, skip = ''): void {
    if (x1 < x0) [x0, x1] = [x1, x0];
    if (y1 < y0) [y0, y1] = [y1, y0];
    if (z1 < z0) [z0, z1] = [z1, z0];
    const P = (x: number, y: number, z: number): V3 => [x, y, z];
    if (!skip.includes('pz')) this.quad(mat, P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1));
    if (!skip.includes('nz')) this.quad(mat, P(x1, y0, z0), P(x0, y0, z0), P(x0, y1, z0), P(x1, y1, z0));
    if (!skip.includes('px')) this.quad(mat, P(x1, y0, z1), P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1));
    if (!skip.includes('nx')) this.quad(mat, P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), P(x0, y1, z0));
    if (!skip.includes('py')) this.quad(mat, P(x0, y1, z1), P(x1, y1, z1), P(x1, y1, z0), P(x0, y1, z0));
    if (!skip.includes('ny')) this.quad(mat, P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1));
  }

  /** Boîte orientée : centre, axe horizontal `u` (unitaire, XZ), demi-tailles (le long de u, en y, le long de la normale). */
  obox(mat: string, c: V3, u: V3, hu: number, hy: number, hn: number, skip = ''): void {
    const ang = Math.atan2(-u[2], u[0]);
    this.push(c[0], c[1], c[2], ang);
    this.box(mat, -hu, -hy, -hn, hu, hy, hn, skip);
    this.pop();
  }

  /** Cylindre vertical (ou tronc de cône si r1 ≠ r0), facettes lisses. */
  cylinder(mat: string, x: number, y0: number, z: number, r0: number, h: number, seg = 10, caps = true, r1 = r0): void {
    const pts: V3[] = [];
    const nors: V3[] = [];
    const tris: number[] = [];
    const slope = (r0 - r1) / h;
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const cx = Math.cos(a);
      const sz = Math.sin(a);
      const n = norm([cx, slope, sz]);
      pts.push([x + cx * r0, y0, z + sz * r0], [x + cx * r1, y0 + h, z + sz * r1]);
      nors.push(n, n);
      if (i < seg) {
        const k = i * 2;
        tris.push(k, k + 1, k + 3, k, k + 3, k + 2);
      }
    }
    this.smooth(mat, pts, nors, tris);
    if (caps) {
      const top: V3[] = [];
      for (let i = seg - 1; i >= 0; i--) {
        const a = (i / seg) * Math.PI * 2;
        top.push([x + Math.cos(a) * r1, y0 + h, z + Math.sin(a) * r1]);
      }
      this.poly(mat, top);
    }
  }

  /** Tube entre deux points (gouttières horizontales, descentes, rambardes rondes). */
  tube(mat: string, a: V3, b: V3, r: number, seg = 6, open = false): void {
    const d = sub(b, a);
    const L = len(d);
    if (L < 1e-6) return;
    const ax = norm(d);
    const ref: V3 = Math.abs(ax[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const e1 = norm(cross(ax, ref));
    const e2 = cross(ax, e1);
    const pts: V3[] = [];
    const nors: V3[] = [];
    const tris: number[] = [];
    const n = open ? Math.ceil(seg / 2) : seg;
    const span = open ? Math.PI : Math.PI * 2;
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * span; // ouvert : demi-tube inférieur (gouttière)
      const nn = madd([0, 0, 0], e1, Math.cos(t), e2, Math.sin(t));
      pts.push(madd(a, nn, r), madd(b, nn, r));
      nors.push(nn, nn);
      if (i < n) { const k = i * 2; tris.push(k, k + 2, k + 3, k, k + 3, k + 1); }
    }
    this.smooth(mat, pts, nors, tris);
  }

  /** Extrusion verticale d'un polygone XZ (ordre anti-horaire vu de dessus = sens -> +X puis -Z). */
  extrude(mat: string, poly: [number, number][], y0: number, y1: number, opts: { top?: string | null; bottom?: boolean; sides?: boolean } = {}): void {
    const n = poly.length;
    if (opts.sides !== false) {
      for (let i = 0; i < n; i++) {
        const [ax, az] = poly[i]!;
        const [bx, bz] = poly[(i + 1) % n]!;
        this.quad(mat, [ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az]);
      }
    }
    const tris = triangulate(poly);
    const topMat = opts.top === undefined ? mat : opts.top;
    if (topMat) for (const [i, j, k] of tris) this.tri(topMat, [poly[i]![0], y1, poly[i]![1]], [poly[j]![0], y1, poly[j]![1]], [poly[k]![0], y1, poly[k]![1]]);
    if (opts.bottom) for (const [i, j, k] of tris) this.tri(mat, [poly[k]![0], y0, poly[k]![1]], [poly[j]![0], y0, poly[j]![1]], [poly[i]![0], y0, poly[i]![1]]);
  }

  /** Nombre total de triangles. */
  triangles(): number {
    let t = 0;
    for (const p of this.prims.values()) t += p.idx.length / 3;
    return t;
  }

  /** Boîte englobante (espace modèle). */
  bounds(): { min: V3; max: V3 } {
    const min: V3 = [Infinity, Infinity, Infinity];
    const max: V3 = [-Infinity, -Infinity, -Infinity];
    for (const p of this.prims.values()) {
      for (let i = 0; i < p.pos.length; i += 3) {
        for (let k = 0; k < 3; k++) {
          const v = p.pos[i + k]!;
          if (v < min[k]!) min[k] = v;
          if (v > max[k]!) max[k] = v;
        }
      }
    }
    return { min, max };
  }

  /** Translation globale de tous les sommets (recentrage). */
  translateAll(dx: number, dy: number, dz: number): void {
    for (const p of this.prims.values()) {
      for (let i = 0; i < p.pos.length; i += 3) { p.pos[i]! += dx; p.pos[i + 1]! += dy; p.pos[i + 2]! += dz; }
    }
    // Les UV 'meters' restent attachées au modèle (aucune modification nécessaire).
  }
}

/**
 * Triangulation par oreilles d'un polygone simple XZ (convexe ou concave).
 * Le polygone doit être anti-horaire vu de dessus (aire signée > 0 avec la convention x, -z).
 * Renvoie des triangles orientés vers +Y.
 */
export function triangulate(poly: [number, number][]): [number, number, number][] {
  const n = poly.length;
  const idx = Array.from({ length: n }, (_, i) => i);
  // aire signée dans le plan (x, -z) : >0 = anti-horaire vu de dessus
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % n]!;
    area += a[0] * -b[1] - b[0] * -a[1];
  }
  if (area < 0) idx.reverse();
  const out: [number, number, number][] = [];
  const P = (i: number): [number, number] => [poly[i]![0], -poly[i]![1]];
  const crossZ = (a: [number, number], b: [number, number], c: [number, number]): number => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inside = (p: [number, number], a: [number, number], b: [number, number], c: [number, number]): boolean =>
    crossZ(a, b, p) >= -1e-9 && crossZ(b, c, p) >= -1e-9 && crossZ(c, a, p) >= -1e-9;
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let cut = false;
    for (let i = 0; i < idx.length; i++) {
      const i0 = idx[(i + idx.length - 1) % idx.length]!;
      const i1 = idx[i]!;
      const i2 = idx[(i + 1) % idx.length]!;
      const a = P(i0), b = P(i1), c = P(i2);
      if (crossZ(a, b, c) <= 1e-12) continue;
      let ok = true;
      for (const j of idx) {
        if (j === i0 || j === i1 || j === i2) continue;
        if (inside(P(j), a, b, c)) { ok = false; break; }
      }
      if (!ok) continue;
      out.push([i0, i1, i2]);
      idx.splice(i, 1);
      cut = true;
      break;
    }
    if (!cut) break;
  }
  if (idx.length === 3) out.push([idx[0]!, idx[1]!, idx[2]!]);
  return out;
}

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hachage FNV-1a d'une chaîne -> graine. */
export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
