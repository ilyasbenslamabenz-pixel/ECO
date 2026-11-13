/**
 * Coques de navires et superstructures (porte-conteneurs, vraquier, ferry, remorqueur).
 * Repère : avant (étrave) vers +Z, y = 0 = ligne de flottaison, quille à y = −T, pont au livet à y = D − T.
 */
import type { MatKey } from './materials';
import { TMesh, type V3 } from './mesh';
import type { RegionName } from './textures';

export interface HullSpec {
  L: number; B: number; D: number; T: number;
  /** Fractions de longueur des formes avant / arrière. */
  bow: number; stern: number;
  /** Hauteur relative (0 quille – 1 pont) du bas du tableau arrière. */
  transom: number;
  /** Relevé du pont à l'avant (m). */
  sheer: number;
  /** Élancement de l'étrave au niveau du pont (m). */
  rake: number;
  top: MatKey; bottom: MatKey;
  /** Hauteur (m, au-dessus de la flottaison) de la limite des couleurs. */
  boot: number;
  bulb?: boolean;
  /** Bande décorative (matériau, y0, y1 au-dessus de la flottaison). */
  band?: { mat: MatKey; y0: number; y1: number };
  deck?: MatKey;
}

/** Demi-largeur relative f(s, yn) ∈ [0, 1] : s = 0 arrière, 1 avant ; yn = 0 quille, 1 pont. */
function hb(h: HullSpec, s: number, yn: number): number {
  const rb = 0.12; // bouchain
  let f = 1;
  if (yn < rb) f = 1 - rb + Math.sqrt(Math.max(0, rb * rb - (rb - yn) * (rb - yn)));
  f = Math.min(1, f / 1);
  const fb = 1 - h.bow;
  if (s > fb) {
    const t = (s - fb) / h.bow;
    const e = 1.7 - 0.9 * yn;
    f *= Math.pow(Math.max(0, Math.cos((t * Math.PI) / 2)), e);
  }
  if (s < h.stern) {
    const t = (h.stern - s) / h.stern;
    f *= 1 - 0.28 * t * t;
    if (yn < h.transom) f *= Math.max(0.03, 1 - Math.pow(t, 0.75) * Math.pow(1 - yn / h.transom, 0.7));
  }
  return Math.max(0, f);
}

export function deckY(h: HullSpec, s: number): number {
  const t = Math.max(0, (s - 0.8) / 0.2);
  return h.D - h.T + h.sheer * t * t;
}

/** Coque complète (bordé, pont, tableau, bulbe, gouvernail, hélice). Renvoie le contour du pont (x, z). */
export function hull(mb: TMesh, h: HullSpec): [number, number][] {
  const lod = mb.lod;
  const ns = lod === 0 ? 56 : lod === 1 ? 28 : 14;
  const ss = Array.from({ length: ns + 1 }, (_, k) => 0.5 - 0.5 * Math.cos((Math.PI * k) / ns));
  // niveaux verticaux (de la quille au pont), dont la limite de couleur et la bande
  const yLevels = new Set<number>([0, 0.03, 0.08, 0.14, 1]);
  const add = (y: number): void => { const yn = (y + h.T) / h.D; if (yn > 0 && yn < 1) yLevels.add(+yn.toFixed(4)); };
  for (let k = 1; k < (lod === 0 ? 7 : lod === 1 ? 4 : 2); k++) yLevels.add(+(0.14 + (0.86 * k) / (lod === 0 ? 7 : lod === 1 ? 4 : 2)).toFixed(4));
  add(h.boot); add(0);
  if (h.band) { add(h.band.y0); add(h.band.y1); }
  const lv = [...yLevels].sort((a, b) => a - b);
  const zOf = (s: number, yn: number): number => {
    let z = -h.L / 2 + s * h.L;
    const fb = 1 - h.bow;
    if (s > fb) z += h.rake * Math.pow((s - fb) / h.bow, 2) * yn;
    return z;
  };
  const grid: V3[][] = ss.map((s) => {
    const row: V3[] = [];
    const top = deckY(h, s);
    const yAt = (yn: number): number => (yn >= 1 ? top : -h.T + yn * h.D);
    for (let k = lv.length - 1; k >= 0; k--) { const yn = lv[k]!; row.push([-hb(h, s, yn) * h.B / 2, yAt(yn), zOf(s, yn)]); }
    for (let k = 0; k < lv.length; k++) { const yn = lv[k]!; row.push([hb(h, s, yn) * h.B / 2, yAt(yn), zOf(s, yn)]); }
    return row;
  });
  const matAt = (i: number, j: number): MatKey => {
    const y = (grid[i]![j]![1] + grid[i]![j + 1]![1] + grid[i + 1]![j]![1]) / 3;
    if (h.band && y > h.band.y0 && y < h.band.y1) return h.band.mat;
    return y < h.boot ? h.bottom : h.top;
  };
  mb.surface(grid, { mat: matAt, smoothAngle: 35, autoOrient: false, flip: true });
  // pont (contour au livet)
  const outline: [number, number][] = [];
  for (const s of ss) outline.push([hb(h, s, 1) * h.B / 2, zOf(s, 1)]);
  for (let k = ss.length - 1; k >= 0; k--) outline.push([-hb(h, ss[k]!, 1) * h.B / 2, zOf(ss[k]!, 1)]);
  // pont : bande de triangles entre bords (gère le relevé du pont)
  const dm: MatKey = h.deck ?? 'vert_pont';
  for (let k = 0; k < ss.length - 1; k++) {
    const s0 = ss[k]!, s1 = ss[k + 1]!;
    const w0 = hb(h, s0, 1) * h.B / 2, w1 = hb(h, s1, 1) * h.B / 2;
    const y0 = deckY(h, s0), y1 = deckY(h, s1), z0 = zOf(s0, 1), z1 = zOf(s1, 1);
    mb.quad(dm, [-w0, y0, z0], [-w1, y1, z1], [w1, y1, z1], [w0, y0, z0]);
  }
  // tableau arrière : polygone de la section s = 0
  const s0 = 0;
  const pts: [number, number][] = [];
  for (let k = lv.length - 1; k >= 0; k--) pts.push([-hb(h, s0, lv[k]!) * h.B / 2, lv[k]! >= 1 ? deckY(h, 0) : -h.T + lv[k]! * h.D]);
  for (let k = 0; k < lv.length; k++) pts.push([hb(h, s0, lv[k]!) * h.B / 2, lv[k]! >= 1 ? deckY(h, 0) : -h.T + lv[k]! * h.D]);
  const clean = pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1]![0], p[1] - pts[i - 1]![1]) > 1e-4);
  mb.polygon(h.top, clean, -h.L / 2, -1);
  // bulbe d'étrave
  if (h.bulb) {
    const r = h.T * 0.32;
    mb.push().translate(0, -h.T * 0.55, h.L / 2 - 6).rotX(Math.PI / 2);
    mb.lathe(h.bottom, [[0.001, -6], [r * 0.7, -3], [r, 0], [r * 0.95, 2.5], [r * 0.6, 4.5], [0.001, 5.6]], lod === 0 ? 12 : 8, 50);
    mb.pop();
  }
  // gouvernail et hélice
  if (lod < 2) {
    const zr = -h.L / 2 + 1.2;
    mb.box(h.bottom, -0.4, -h.T * 0.95, zr - 1.6, 0.4, -h.T * 0.2, zr + 1.6);
    mb.push().translate(0, -h.T * 0.55, zr + 4.2);
    mb.tube('gris', [0, 0, -0.6], [0, 0, 0.8], 0.6, 8, true);
    const blades = 4, R = h.T * 0.38;
    for (let k = 0; k < blades; k++) {
      mb.push().rotZ((k / blades) * Math.PI * 2 + 0.3);
      mb.push().rotY(0.35);
      mb.box('jaune', -0.08, 0.4, -0.6, 0.08, R, 0.6);
      mb.pop();
      mb.pop();
    }
    mb.pop();
  }
  return outline;
}

/** Demi-largeur au livet à l'abscisse z (pour poser des équipements). */
export function beamAt(h: HullSpec, z: number): number {
  const s = (z + h.L / 2) / h.L;
  return hb(h, Math.max(0, Math.min(1, s)), 1) * h.B / 2;
}

/**
 * Bande d'atlas (fenêtres, hublots) sur une face verticale de a à b (vue de l'extérieur : a à gauche),
 * découpée en tronçons de `chunk` m (chaque tronçon reprend toute la région).
 */
export function band(mb: TMesh, a: [number, number], b: [number, number], y0: number, y1: number, region: RegionName, chunk: number, mat: MatKey = 'atlas'): void {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(1, Math.round(L / chunk));
  for (let k = 0; k < n; k++) {
    const t0 = k / n, t1 = (k + 1) / n;
    const p0: [number, number] = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0], p1: [number, number] = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1];
    mb.quad(mat, [p0[0], y0, p0[1]], [p1[0], y0, p1[1]], [p1[0], y1, p1[1]], [p0[0], y1, p0[1]], { region });
  }
}

/** Bandes sur les 4 faces d'un bloc [x0,x1]×[z0,z1] (décalées de 3 cm). faces : 'pz nz px nx'. */
export function bandsBox(mb: TMesh, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, region: RegionName, chunk: number, faces = 'pz nz px nx', mat: MatKey = 'atlas'): void {
  const e = 0.03;
  if (faces.includes('pz')) band(mb, [x0, z1 + e], [x1, z1 + e], y0, y1, region, chunk, mat);
  if (faces.includes('nz')) band(mb, [x1, z0 - e], [x0, z0 - e], y0, y1, region, chunk, mat);
  if (faces.includes('px')) band(mb, [x1 + e, z1], [x1 + e, z0], y0, y1, region, chunk, mat);
  if (faces.includes('nx')) band(mb, [x0 - e, z0], [x0 - e, z1], y0, y1, region, chunk, mat);
}

/** Canot de sauvetage (capsule orange) le long de Z, centré en p, avec bossoirs. */
export function lifeboat(mb: TMesh, p: V3, len = 8, side: 1 | -1 = 1): void {
  if (mb.lod >= 2) { mb.box('orange', p[0] - 1.3, p[1], p[2] - len / 2, p[0] + 1.3, p[1] + 2.4, p[2] + len / 2); return; }
  const seg = mb.lod === 0 ? 10 : 6;
  mb.push().translate(p[0], p[1] + 1.2, p[2]).scale(1, 0.95, 1).rotX(Math.PI / 2);
  mb.lathe('orange', [[0.001, -len / 2], [0.8, -len / 2 + 0.6], [1.3, -len / 2 + 2], [1.35, 0], [1.3, len / 2 - 2], [0.8, len / 2 - 0.5], [0.001, len / 2]], seg, 45);
  mb.pop();
  mb.box('blanc', p[0] - 1.36, p[1] + 1.1, p[2] - len / 2 + 0.6, p[0] + 1.36, p[1] + 1.3, p[2] + len / 2 - 0.6);
  if (mb.lod === 0) for (const dz of [-len / 2 + 1, len / 2 - 1]) {
    mb.beam('gris', [p[0] - side * 1.8, p[1] - 1, p[2] + dz], [p[0] - side * 1.8, p[1] + 3.2, p[2] + dz], 0.25);
    mb.beam('gris', [p[0] - side * 1.8, p[1] + 3.2, p[2] + dz], [p[0], p[1] + 3.0, p[2] + dz], 0.22);
  }
}

/** Cheminée (section arrondie) avec bande de logo. */
export function funnel(mb: TMesh, x: number, y: number, z: number, w: number, d: number, hgt: number, mat: MatKey, logo: boolean): void {
  const seg = mb.lod === 0 ? 14 : 8;
  mb.push().translate(x, y, z).scale(w / 2, 1, d / 2);
  mb.lathe(mat, [[1, 0], [1, hgt * 0.9], [0.96, hgt], [0.001, hgt]], seg, 50);
  mb.pop();
  mb.push().translate(x, y, z).scale(w / 2, 1, d / 2);
  mb.lathe('noir', [[1.01, hgt * 0.84], [1.01, hgt * 0.99]], seg, 50);
  mb.pop();
  if (mb.lod < 2) for (const sx of [-1, 1]) mb.tube('gris_fonce', [x + sx * w * 0.18, y + hgt * 0.9, z - d * 0.1], [x + sx * w * 0.18, y + hgt + 1.2, z - d * 0.1], 0.35, 8, true);
  if (logo) {
    const lw = d * 0.7, yc = y + hgt * 0.62, lh = lw / 4;
    for (const sx of [1, -1] as const) {
      const xx = x + sx * (w / 2 + 0.04);
      const zA = sx > 0 ? z + lw / 2 : z - lw / 2, zB = sx > 0 ? z - lw / 2 : z + lw / 2;
      mb.quad('decal', [xx, yc - lh / 2, zA], [xx, yc - lh / 2, zB], [xx, yc + lh / 2, zB], [xx, yc + lh / 2, zA], { region: 'cheminee_logo' });
    }
  }
}

/** Mât avec feux et radar. */
export function mast(mb: TMesh, x: number, y: number, z: number, hgt: number): void {
  mb.tube('blanc', [x, y, z], [x, y + hgt, z], [0.35, 0.18], mb.lod === 0 ? 8 : 6, true);
  if (mb.lod >= 2) return;
  mb.beam('blanc', [x - 2.5, y + hgt * 0.7, z], [x + 2.5, y + hgt * 0.7, z], 0.18);
  mb.box('atlas', x - 0.15, y + hgt, z - 0.15, x + 0.15, y + hgt + 0.35, z + 0.15, 'ny', { region: 'feu_blanc' });
  for (const sx of [-1, 1]) mb.box('atlas', x + sx * 2.5 - 0.12, y + hgt * 0.7, z - 0.12, x + sx * 2.5 + 0.12, y + hgt * 0.7 + 0.3, z + 0.12, 'ny', { region: sx > 0 ? 'feu_vert' : 'feu_rouge' });
}

/** Radar (antenne tournante) posé en (x, y, z). */
export function radar(mb: TMesh, x: number, y: number, z: number): void {
  if (mb.lod >= 2) return;
  mb.tube('gris_clair', [x, y, z], [x, y + 0.8, z], 0.2, 6, true);
  mb.box('blanc', x - 1.8, y + 0.8, z - 0.15, x + 1.8, y + 1.1, z + 0.15);
}
