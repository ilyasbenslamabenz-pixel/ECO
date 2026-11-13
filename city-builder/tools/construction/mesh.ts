/**
 * Constructeur de maillages des modèles de CHANTIER (Node pur, sans three) — propriété p2a-chantiers.
 *
 * Unités : mètres, Y vers le haut, origine au sol au centre de l'emprise, avant des engins vers +Z.
 * Matériaux par RÔLE (acier peint, acier galvanisé, béton, bois, bâche, filet, terre, gravats, verre,
 * optique) ; chaque rôle renvoie à un jeu de textures PBR du catalogue (Poly Haven, CC0) par URI relative :
 * aucun pixel n'est dupliqué dans les GLB.
 *
 * Primitives disponibles : boîte (UV en mètres, chanfrein optionnel), tube/cylindre lissé, treillis
 * (membrures + diagonales : mât et flèche de grue), plancher, garde-corps, échelle, tas conique bruité,
 * roue, chenille. Le niveau de détail (0/1/2) pilote la finesse des cylindres et l'omission des petits
 * éléments (boulons, échelons, diagonales secondaires).
 */

export type V3 = [number, number, number];

/** Rôles de matériaux des modèles de chantier. */
export const ROLES = [
  'acier_jaune', 'acier_rouge', 'acier_galva', 'acier_sombre', 'beton', 'bois', 'bache', 'filet',
  'terre', 'gravats', 'verre', 'optique', 'caoutchouc',
] as const;
export type Role = (typeof ROLES)[number];

export interface Group { pos: number[]; nrm: number[]; uv: number[]; idx: number[] }

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
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

/** Bruit déterministe [0,1) (tas de terre, gravats). */
export function hash01(n: number): number {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

export interface BoxOpts {
  /** Taille d'une répétition de texture (m) ; défaut : celle du rôle. */
  tile?: number;
  /** Faces omises : 'y-' plancher, 'y+', 'x-', 'x+', 'z-', 'z+'. */
  skip?: readonly string[];
  /** Chanfrein (m) sur les arêtes verticales (0 = aucun). */
  bevel?: number;
}

export class CMesh {
  readonly groups: Record<string, Group> = {};
  private m: M = IDENT.slice();
  private readonly stack: M[] = [];
  /** Compteur de triangles (diagnostic). */
  tris = 0;

  constructor(readonly lod: number) {}

  group(role: Role): Group {
    let g = this.groups[role];
    if (!g) { g = { pos: [], nrm: [], uv: [], idx: [] }; this.groups[role] = g; }
    return g;
  }

  /* --------------------------- Pile de transformations --------------------------- */

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

  /** Point transformé (position d'un pivot exportée dans le manifeste). */
  point(p: V3): V3 { return this.tp(p); }

  /* ------------------------------- Primitives ------------------------------- */

  vert(role: Role, p: V3, n: V3, u: number, v: number): number {
    const g = this.group(role);
    const P = this.tp(p), N = this.tn(n);
    g.pos.push(P[0], P[1], P[2]);
    g.nrm.push(N[0], N[1], N[2]);
    g.uv.push(u, v);
    return g.pos.length / 3 - 1;
  }

  tri(role: Role, a: number, b: number, c: number): void {
    const g = this.group(role);
    if (this.det() < 0) g.idx.push(a, c, b); else g.idx.push(a, b, c);
    this.tris++;
  }

  quad(role: Role, a: number, b: number, c: number, d: number): void { this.tri(role, a, b, c); this.tri(role, a, c, d); }

  /** Quadrilatère plan à 4 coins (normale calculée), UV en mètres (projection sur le plan du quad). */
  face(role: Role, p0: V3, p1: V3, p2: V3, p3: V3, tile: number, uOff = 0, vOff = 0): void {
    const n = norm(cross(sub(p1, p0), sub(p3, p0)));
    const w = len(sub(p1, p0)), h = len(sub(p3, p0));
    const a = this.vert(role, p0, n, uOff, vOff);
    const b = this.vert(role, p1, n, uOff + w / tile, vOff);
    const c = this.vert(role, p2, n, uOff + w / tile, vOff + h / tile);
    const d = this.vert(role, p3, n, uOff, vOff + h / tile);
    this.quad(role, a, b, c, d);
  }

  /**
   * Boîte centrée en (0, h/2, 0) de dimensions (w, h, d), UV en mètres (projection par face).
   * `bevel` chanfreine les 4 arêtes verticales (prisme octogonal).
   */
  box(role: Role, w: number, h: number, d: number, o: BoxOpts = {}): void {
    const tile = o.tile ?? 1;
    const skip = new Set(o.skip ?? []);
    const bevel = Math.min(o.bevel ?? 0, Math.min(w, d) / 2.5);
    const x = w / 2, z = d / 2;
    if (bevel > 0) {
      // Prisme à 8 côtés : contour chanfreiné, extrudé de 0 à h.
      const ring: [number, number][] = [
        [-x + bevel, -z], [x - bevel, -z], [x, -z + bevel], [x, z - bevel],
        [x - bevel, z], [-x + bevel, z], [-x, z - bevel], [-x, -z + bevel],
      ];
      let u = 0;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
        const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
        this.face(role, [a[0], 0, a[1]], [b[0], 0, b[1]], [b[0], h, b[1]], [a[0], h, a[1]], tile, u / tile);
        u += seg;
      }
      if (!skip.has('y+')) {
        const c = this.vert(role, [0, h, 0], [0, 1, 0], 0, 0);
        const ids = ring.map((p) => this.vert(role, [p[0], h, p[1]], [0, 1, 0], p[0] / tile, p[1] / tile));
        for (let i = 0; i < ids.length; i++) this.tri(role, c, ids[i]!, ids[(i + 1) % ids.length]!);
      }
      if (!skip.has('y-')) {
        const c = this.vert(role, [0, 0, 0], [0, -1, 0], 0, 0);
        const ids = ring.map((p) => this.vert(role, [p[0], 0, p[1]], [0, -1, 0], p[0] / tile, p[1] / tile));
        for (let i = 0; i < ids.length; i++) this.tri(role, c, ids[(i + 1) % ids.length]!, ids[i]!);
      }
      return;
    }
    if (!skip.has('z+')) this.face(role, [-x, 0, z], [x, 0, z], [x, h, z], [-x, h, z], tile);
    if (!skip.has('z-')) this.face(role, [x, 0, -z], [-x, 0, -z], [-x, h, -z], [x, h, -z], tile);
    if (!skip.has('x+')) this.face(role, [x, 0, z], [x, 0, -z], [x, h, -z], [x, h, z], tile);
    if (!skip.has('x-')) this.face(role, [-x, 0, -z], [-x, 0, z], [-x, h, z], [-x, h, -z], tile);
    if (!skip.has('y+')) this.face(role, [-x, h, z], [x, h, z], [x, h, -z], [-x, h, -z], tile);
    if (!skip.has('y-')) this.face(role, [-x, 0, -z], [x, 0, -z], [x, 0, z], [-x, 0, z], tile);
  }

  /** Boîte centrée sur l'origine (pratique pour les pièces d'assemblage). */
  boxC(role: Role, w: number, h: number, d: number, o: BoxOpts = {}): void {
    this.push().translate(0, -h / 2, 0);
    this.box(role, w, h, d, o);
    this.pop();
  }

  /** Nombre de segments d'un cylindre selon le LOD. */
  segs(base: number): number { return Math.max(3, Math.round(base / (this.lod === 0 ? 1 : this.lod === 1 ? 2 : 3))); }

  /** Cylindre de rayon r de y=0 à y=h, normales lissées ; `caps` ferme les extrémités. */
  tube(role: Role, r: number, h: number, sides = 10, caps = true, tile = 1): void {
    const n = this.segs(sides);
    const ring: number[] = [];
    const ringTop: number[] = [];
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      const nn: V3 = [c, 0, s];
      ring.push(this.vert(role, [r * c, 0, r * s], nn, (a * r) / tile, 0));
      ringTop.push(this.vert(role, [r * c, h, r * s], nn, (a * r) / tile, h / tile));
    }
    for (let i = 0; i < n; i++) this.quad(role, ring[i]!, ring[i + 1]!, ringTop[i + 1]!, ringTop[i]!);
    if (!caps) return;
    const topC = this.vert(role, [0, h, 0], [0, 1, 0], 0, 0);
    const botC = this.vert(role, [0, 0, 0], [0, -1, 0], 0, 0);
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      const t0 = this.vert(role, [r * Math.cos(a0), h, r * Math.sin(a0)], [0, 1, 0], (r * Math.cos(a0)) / tile, (r * Math.sin(a0)) / tile);
      const t1 = this.vert(role, [r * Math.cos(a1), h, r * Math.sin(a1)], [0, 1, 0], (r * Math.cos(a1)) / tile, (r * Math.sin(a1)) / tile);
      this.tri(role, topC, t0, t1);
      const b0 = this.vert(role, [r * Math.cos(a0), 0, r * Math.sin(a0)], [0, -1, 0], (r * Math.cos(a0)) / tile, (r * Math.sin(a0)) / tile);
      const b1 = this.vert(role, [r * Math.cos(a1), 0, r * Math.sin(a1)], [0, -1, 0], (r * Math.cos(a1)) / tile, (r * Math.sin(a1)) / tile);
      this.tri(role, botC, b1, b0);
    }
  }

  /** Barre cylindrique entre deux points (membrure, diagonale, câble). */
  bar(role: Role, a: V3, b: V3, r: number, sides = 6): void {
    const d = sub(b, a);
    const l = len(d);
    if (l < 1e-6) return;
    const dir = norm(d);
    // Repère : Y le long de la barre.
    const up: V3 = Math.abs(dir[1]) > 0.99 ? [1, 0, 0] : [0, 1, 0];
    const ax = norm(cross(up, dir));
    const az = norm(cross(dir, ax));
    this.push();
    this.m = mul(this.m, [ax[0], dir[0], az[0], a[0], ax[1], dir[1], az[1], a[1], ax[2], dir[2], az[2], a[2]]);
    this.tube(role, r, l, sides, true, 0.5);
    this.pop();
  }

  /**
   * Treillis (mât ou flèche de grue) : 4 membrures parallèles le long de +Y sur `h` mètres, section
   * `w` × `d`, entretoises horizontales et diagonales en zigzag tous les `bay` mètres.
   */
  lattice(role: Role, h: number, w: number, d: number, bay: number, rChord = 0.06, rDiag = 0.035): void {
    const x = w / 2, z = d / 2;
    const corners: [number, number][] = [[-x, -z], [x, -z], [x, z], [-x, z]];
    const sides = this.lod === 0 ? 6 : 4;
    for (const [cx, cz] of corners) this.bar(role, [cx, 0, cz], [cx, h, cz], rChord, sides);
    const n = Math.max(1, Math.round(h / bay));
    const step = h / n;
    for (let i = 0; i <= n; i++) {
      const y = i * step;
      for (let k = 0; k < 4; k++) {
        const a = corners[k]!, b = corners[(k + 1) % 4]!;
        this.bar(role, [a[0], y, a[1]], [b[0], y, b[1]], rDiag, 4);
      }
    }
    if (this.lod > 1) return;
    for (let i = 0; i < n; i++) {
      const y0 = i * step, y1 = (i + 1) * step;
      for (let k = 0; k < 4; k++) {
        const a = corners[k]!, b = corners[(k + 1) % 4]!;
        const up = (i + k) % 2 === 0;
        this.bar(role, [a[0], up ? y0 : y1, a[1]], [b[0], up ? y1 : y0, b[1]], rDiag, 4);
      }
    }
  }

  /** Treillis horizontal le long de +Z (flèche) : section `w` × `hgt`, de z=0 à z=l, avec entretoises. */
  latticeZ(role: Role, l: number, w: number, hgt: number, bay: number, rChord = 0.05, rDiag = 0.03): void {
    const x = w / 2;
    const chords: [number, number][] = [[-x, hgt], [x, hgt], [x, 0], [-x, 0]];
    const sides = this.lod === 0 ? 6 : 4;
    for (const [cx, cy] of chords) this.bar(role, [cx, cy, 0], [cx, cy, l], rChord, sides);
    const n = Math.max(1, Math.round(l / bay));
    const step = l / n;
    for (let i = 0; i <= n; i++) {
      const z = i * step;
      for (let k = 0; k < 4; k++) {
        const a = chords[k]!, b = chords[(k + 1) % 4]!;
        this.bar(role, [a[0], a[1], z], [b[0], b[1], z], rDiag, 4);
      }
    }
    if (this.lod > 1) return;
    for (let i = 0; i < n; i++) {
      const z0 = i * step, z1 = (i + 1) * step;
      for (let k = 0; k < 4; k++) {
        const a = chords[k]!, b = chords[(k + 1) % 4]!;
        const up = (i + k) % 2 === 0;
        this.bar(role, [a[0], a[1], up ? z0 : z1], [b[0], b[1], up ? z1 : z0], rDiag, 4);
      }
    }
  }

  /** Garde-corps le long de +X sur `l` mètres : lisse haute, lisse basse, plinthe et montants. */
  railing(role: Role, l: number, h = 1, posts = 0): void {
    const n = posts > 0 ? posts : Math.max(2, Math.round(l / 1.5));
    for (let i = 0; i <= n; i++) {
      const x = -l / 2 + (l * i) / n;
      this.bar(role, [x, 0, 0], [x, h, 0], 0.025, 4);
    }
    this.bar(role, [-l / 2, h, 0], [l / 2, h, 0], 0.028, 4);
    if (this.lod < 2) this.bar(role, [-l / 2, h * 0.5, 0], [l / 2, h * 0.5, 0], 0.024, 4);
  }

  /** Échelle verticale (montants + échelons) de hauteur h, largeur w. */
  ladder(role: Role, h: number, w = 0.45): void {
    this.bar(role, [-w / 2, 0, 0], [-w / 2, h, 0], 0.025, 4);
    this.bar(role, [w / 2, 0, 0], [w / 2, h, 0], 0.025, 4);
    if (this.lod > 1) return;
    const n = Math.max(1, Math.round(h / 0.33));
    for (let i = 1; i < n; i++) {
      const y = (h * i) / n;
      this.bar(role, [-w / 2, y, 0], [w / 2, y, 0], 0.016, 4);
    }
  }

  /**
   * Tas conique bruité (terre excavée, gravats) : rayon `r`, hauteur `h`, surface irrégulière
   * déterministe (graine `seed`), base ouverte.
   */
  heap(role: Role, r: number, h: number, seed: number, tile = 2): void {
    const sides = this.segs(this.lod === 0 ? 16 : 12);
    const rings = this.lod === 0 ? 4 : 3;
    const grid: V3[][] = [];
    for (let j = 0; j <= rings; j++) {
      const t = j / rings;
      const row: V3[] = [];
      for (let i = 0; i <= sides; i++) {
        const a = (i / sides) * Math.PI * 2;
        const k = hash01(seed * 131 + i * 7 + j * 977);
        const k2 = hash01(seed * 17 + (i % sides) * 31 + j * 13);
        const rr = r * (1 - t * t) * (0.82 + 0.3 * k);
        const yy = h * Math.pow(1 - t, 0.75) * (0.85 + 0.28 * k2);
        row.push([rr * Math.cos(a), yy, rr * Math.sin(a)]);
      }
      // Couture : premier et dernier point identiques.
      row[sides] = [row[0]![0], row[0]![1], row[0]![2]];
      grid.push(row);
    }
    for (let j = 0; j < rings; j++) {
      for (let i = 0; i < sides; i++) {
        const p0 = grid[j]![i]!, p1 = grid[j]![i + 1]!, p2 = grid[j + 1]![i + 1]!, p3 = grid[j + 1]![i]!;
        const n = norm(cross(sub(p1, p0), sub(p3, p0)));
        const uv = (p: V3): [number, number] => [p[0] / tile, p[2] / tile];
        const a = this.vert(role, p0, n, ...uv(p0));
        const b = this.vert(role, p1, n, ...uv(p1));
        const c = this.vert(role, p2, n, ...uv(p2));
        const d = this.vert(role, p3, n, ...uv(p3));
        this.quad(role, a, b, c, d);
      }
    }
  }

  /** Roue (pneu + jante) dans le plan XY, axe selon Z, rayon r, largeur w. */
  wheel(r: number, w: number, hub: Role = 'acier_sombre'): void {
    const n = this.segs(14);
    this.push().rotX(Math.PI / 2);
    this.translate(0, -w / 2, 0);
    this.tube('caoutchouc', r, w, n, true, 0.6);
    this.pop();
    if (this.lod > 1) return;
    this.push().rotX(Math.PI / 2).translate(0, -w / 2 - 0.01, 0);
    this.tube(hub, r * 0.55, w + 0.02, n, true, 0.5);
    this.pop();
  }

  /**
   * Chenille (engin de terrassement) : boucle ovale de `l` mètres de long, `h` de haut, `w` de large,
   * avec galets. Centrée sur l'origine, axe long selon Z.
   */
  track(l: number, h: number, w: number): void {
    const n = this.segs(14);
    const r = h / 2;
    const zc = l / 2 - r;
    // Contour ovale (deux demi-cercles reliés), dans le plan (z, y).
    const outline: [number, number][] = [];
    const half = Math.max(4, Math.round(n / 2));
    for (let i = 0; i <= half; i++) {
      const a = -Math.PI / 2 + (i / half) * Math.PI;
      outline.push([zc + r * Math.sin(a), r * Math.cos(a)]);
    }
    for (let i = 0; i <= half; i++) {
      const a = Math.PI / 2 + (i / half) * Math.PI;
      outline.push([-zc + r * Math.sin(a), r * Math.cos(a)]);
    }
    const m = outline.length;
    for (let i = 0; i < m; i++) {
      const [z0, y0] = outline[i]!;
      const [z1, y1] = outline[(i + 1) % m]!;
      const nz = y1 - y0, ny = -(z1 - z0);
      const nn = norm([0, ny, nz]);
      const p0: V3 = [-w / 2, y0 + r, z0], p1: V3 = [w / 2, y0 + r, z0], p2: V3 = [w / 2, y1 + r, z1], p3: V3 = [-w / 2, y1 + r, z1];
      const seg = Math.hypot(z1 - z0, y1 - y0);
      const a0 = this.vert('caoutchouc', p0, nn, 0, i * seg / 0.4);
      const b0 = this.vert('caoutchouc', p1, nn, w / 0.4, i * seg / 0.4);
      const c0 = this.vert('caoutchouc', p2, nn, w / 0.4, (i + 1) * seg / 0.4);
      const d0 = this.vert('caoutchouc', p3, nn, 0, (i + 1) * seg / 0.4);
      this.quad('caoutchouc', a0, b0, c0, d0);
    }
    // Flancs (plaques latérales) et galets.
    for (const sx of [-1, 1]) {
      this.push().translate((sx * w) / 2 + sx * 0.01, r, 0).rotZ(Math.PI / 2);
      this.box('acier_sombre', h * 0.75, 0.02, l * 0.82, { tile: 0.6 });
      this.pop();
    }
    if (this.lod > 1) return;
    for (const z of [-zc, 0, zc]) {
      this.push().translate(0, r, z).rotZ(Math.PI / 2).translate(0, -w / 2 - 0.02, 0);
      this.tube('acier_sombre', r * 0.45, w + 0.04, 8, true, 0.4);
      this.pop();
    }
  }

  /** Boîte englobante du maillage. */
  bounds(): { min: V3; max: V3 } {
    const min: V3 = [Infinity, Infinity, Infinity];
    const max: V3 = [-Infinity, -Infinity, -Infinity];
    for (const g of Object.values(this.groups)) {
      for (let i = 0; i < g.pos.length; i += 3) {
        for (let k = 0; k < 3; k++) {
          const v = g.pos[i + k]!;
          if (v < min[k]!) min[k] = v;
          if (v > max[k]!) max[k] = v;
        }
      }
    }
    for (let k = 0; k < 3; k++) if (!Number.isFinite(min[k]!)) { min[k] = 0; max[k] = 0; }
    return { min, max };
  }
}
