/**
 * Carrosserie galbée par sections (lofts le long de Z) :
 *  - caisse basse : sections en rectangle arrondi (épaulement, bas de caisse, galbe latéral),
 *    arrondi en plan à l'avant / l'arrière, passages de roues découpés dans le bas de caisse ;
 *  - pavillon (habitacle) : sections trapézoïdales arrondies (rentrée de caisse), pare-brise, lunette
 *    et vitres latérales délimités exactement par les stations (montants A/B/C en peinture).
 * Fournit aussi les requêtes de surface (sideX, frontZ, rearZ) pour poser les détails à fleur.
 */
import { VMesh, type Mat, type V3 } from './mesh';
import type { RegionName } from './textures';

export type Curve = [number, number][];

/** Interpolation cubique monotone (Fritsch-Carlson) d'une courbe (z, valeur) triée par z. */
export function interp(c: Curve, z: number): number {
  const n = c.length;
  if (z <= c[0]![0]) return c[0]![1];
  if (z >= c[n - 1]![0]) return c[n - 1]![1];
  let k = 0;
  while (k < n - 2 && z > c[k + 1]![0]) k++;
  const slope = (i: number): number => (c[i + 1]![1] - c[i]![1]) / (c[i + 1]![0] - c[i]![0]);
  const tan = (i: number): number => {
    if (i === 0) return slope(0);
    if (i === n - 1) return slope(n - 2);
    const a = slope(i - 1), b = slope(i);
    return a * b <= 0 ? 0 : (2 * a * b) / (a + b);
  };
  const [z0, y0] = c[k]!, [z1, y1] = c[k + 1]!;
  const h = z1 - z0, t = (z - z0) / h;
  const m0 = tan(k) * h, m1 = tan(k + 1) * h;
  const t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * m1;
}

export interface Arch { z: number; r: number }

export interface LowerSpec {
  /** Extrémités avant / arrière (z). */
  noseZ: number;
  tailZ: number;
  /** Demi-largeur maximale. */
  hw: number;
  /** Rayons d'arrondi en plan (avant, arrière). */
  planF: number;
  planR: number;
  /** Ligne haute (capot / ceinture / malle) et ligne basse (bas de caisse) en fonction de z. */
  top: Curve;
  bottom: Curve;
  /** Passages de roues (centre z, rayon), centre en y = archY. */
  arches: Arch[];
  archY: number;
  /** Rayons d'arrondi de la section (bas, haut) et galbe latéral (m). */
  rb: number;
  rt: number;
  bulge: number;
  /** Rentrée de l'épaulement (m) entre bas et haut du flanc. */
  tumble: number;
  /** Surcharge de matériau d'un quad selon (z, y moyen) : protections plastiques, bandes. */
  matAt?: (z: number, y: number) => { mat: Mat; region?: RegionName } | null;
}

export interface CabinSpec {
  /** Base du pare-brise, haut du pare-brise, fin du pavillon, bas de la lunette (z décroissants). */
  zWs0: number;
  zWs1: number;
  zRf1: number;
  zRw1: number;
  roofY: number;
  /** Bombé longitudinal du pavillon (m). */
  roofArc: number;
  /** Retrait du pavillon par rapport à la caisse (épaulement) et rentrée en haut. */
  inset: number;
  tumble: number;
  rt: number;
  /** Zones vitrées latérales [z0, z1] (z0 < z1). */
  sideGlass: [number, number][];
  /** Lunette vitrée (sinon pavillon tôlé, ex. fourgon). */
  rearGlass: boolean;
  /** Hauteur de l'allège sous les vitres latérales (m au-dessus de la ceinture). */
  sill: number;
  /** Retrait de la ligne de toit au-dessus des vitres (m). */
  header: number;
}

/** Demi-profil (x ≥ 0) d'une section de caisse basse, du bas (x = 0) au haut (x = 0). */
function lowerHalf(s: LowerSpec, hw: number, yb: number, yt: number, nArc: number): [number, number][] {
  const h = Math.max(0.002, yt - yb);
  const rb = Math.min(s.rb, h * 0.45, hw * 0.45);
  const rt = Math.min(s.rt, h * 0.45, hw * 0.45);
  const tum = Math.min(s.tumble, hw * 0.3);
  const pts: [number, number][] = [[0, yb], [(hw - rb) * 0.5, yb], [hw - rb, yb]];
  for (let k = 1; k <= nArc; k++) { const a = -Math.PI / 2 + (k / nArc) * (Math.PI / 2); pts.push([hw - rb + Math.cos(a) * rb, yb + rb + Math.sin(a) * rb]); }
  const y0 = yb + rb, y1 = yt - rt;
  const ns = 3;
  for (let k = 1; k < ns; k++) {
    const t = k / ns;
    pts.push([hw - tum * t + s.bulge * Math.sin(Math.PI * t), y0 + (y1 - y0) * t]);
  }
  pts.push([hw - tum, y1]);
  for (let k = 1; k <= nArc; k++) { const a = (k / nArc) * (Math.PI / 2); pts.push([hw - tum - rt + Math.cos(a) * rt, y1 + Math.sin(a) * rt]); }
  const xr = hw - tum - rt;
  pts.push([xr * 0.5, yt + 0.012 * (hw / 0.9)], [0, yt + 0.016 * (hw / 0.9)]);
  return pts;
}

export class CarBody {
  constructor(readonly lower: LowerSpec, readonly cabin: CabinSpec | null) {}

  hwAt(z: number): number {
    const s = this.lower;
    let hw = s.hw;
    const dF = z - (s.noseZ - s.planF);
    if (dF > 0) hw -= s.planF - Math.sqrt(Math.max(0, s.planF * s.planF - dF * dF));
    const dR = (s.tailZ + s.planR) - z;
    if (dR > 0) hw -= s.planR - Math.sqrt(Math.max(0, s.planR * s.planR - dR * dR));
    return Math.max(0.05, hw);
  }
  topAt(z: number): number { return interp(this.lower.top, z); }
  bottomAt(z: number): number {
    const s = this.lower;
    let y = interp(s.bottom, z);
    for (const a of s.arches) {
      const dz = z - a.z;
      if (Math.abs(dz) < a.r) y = Math.max(y, s.archY + Math.sqrt(a.r * a.r - dz * dz));
    }
    return Math.min(y, this.topAt(z) - 0.03);
  }
  /** Abscisse du flanc de la caisse basse à la station z et la hauteur y (0 si hors section). */
  sideX(z: number, y: number): number {
    const yb = this.bottomAt(z), yt = this.topAt(z);
    if (y < yb || y > yt + 0.02) return 0;
    const half = lowerHalf(this.lower, this.hwAt(z), yb, yt, 4);
    let best = 0;
    for (let k = 0; k + 1 < half.length; k++) {
      const [xa, ya] = half[k]!, [xb, yb2] = half[k + 1]!;
      if ((y - ya) * (y - yb2) <= 0 && ya !== yb2) best = Math.max(best, xa + ((y - ya) / (yb2 - ya)) * (xb - xa));
    }
    return best;
  }
  /** z de la surface avant au point (x, y) (recherche dichotomique depuis le nez). */
  frontZ(x: number, y: number): number {
    const s = this.lower;
    let lo = s.noseZ - Math.min(1.2, (s.noseZ - s.tailZ) / 2), hi = s.noseZ;
    if (this.sideX(hi, y) >= Math.abs(x)) return hi;
    for (let k = 0; k < 30; k++) {
      const m = (lo + hi) / 2;
      if (this.sideX(m, y) >= Math.abs(x)) lo = m; else hi = m;
    }
    return lo;
  }
  rearZ(x: number, y: number): number {
    const s = this.lower;
    let lo = s.tailZ + Math.min(1.2, (s.noseZ - s.tailZ) / 2), hi = s.tailZ;
    if (this.sideX(hi, y) >= Math.abs(x)) return hi;
    for (let k = 0; k < 30; k++) {
      const m = (lo + hi) / 2;
      if (this.sideX(m, y) >= Math.abs(x)) lo = m; else hi = m;
    }
    return lo;
  }

  /** Stations de la caisse basse. */
  private lowerStations(lod: number): number[] {
    const s = this.lower;
    const L = s.noseZ - s.tailZ;
    const n = lod === 0 ? Math.max(12, Math.round(L / 0.3)) : lod === 1 ? Math.max(6, Math.round(L / 0.65)) : Math.max(3, Math.round(L / 1.5));
    const set = new Set<number>();
    for (let k = 0; k <= n; k++) set.add(+(s.tailZ + (L * k) / n).toFixed(4));
    const nr = lod === 0 ? 3 : lod === 1 ? 2 : 1;
    for (let k = 1; k <= nr; k++) {
      const t = Math.sin((k / (nr + 1)) * (Math.PI / 2));
      set.add(+(s.noseZ - s.planF * (1 - t)).toFixed(4));
      set.add(+(s.tailZ + s.planR * (1 - t)).toFixed(4));
    }
    if (lod < 2) for (const a of s.arches) {
      const na = lod === 0 ? 8 : 4;
      for (let k = 0; k <= na; k++) set.add(+(a.z - a.r + (2 * a.r * k) / na).toFixed(4));
    }
    if (this.cabin) for (const z of [this.cabin.zWs0, this.cabin.zRw1]) set.add(+z.toFixed(4));
    return [...set].filter((z) => z >= s.tailZ - 1e-6 && z <= s.noseZ + 1e-6).sort((a, b) => a - b);
  }

  build(mb: VMesh): void {
    const s = this.lower;
    const lod = mb.lod;
    const nArc = lod === 0 ? 3 : lod === 1 ? 2 : 1;
    const zs = this.lowerStations(lod);
    const rows: V3[][] = [];
    const halfLen = lowerHalf(s, 1, 0, 1, nArc).length;
    for (const z of zs) {
      const half = lowerHalf(s, this.hwAt(z), this.bottomAt(z), this.topAt(z), nArc);
      const ring: V3[] = [];
      for (const [x, y] of half) ring.push([x, y, z]);
      for (let k = half.length - 2; k >= 1; k--) ring.push([-half[k]![0], half[k]![1], z]);
      rows.push(ring);
    }
    const matFn = s.matAt
      ? (i: number, j: number): { mat: Mat; region?: RegionName } | null => {
        const a = rows[i]![j % rows[i]!.length]!, b = rows[i + 1]![(j + 1) % rows[i]!.length]!;
        return s.matAt!((a[2] + b[2]) / 2, (a[1] + b[1]) / 2) ?? { mat: 'peinture' };
      }
      : 'peinture' as const;
    mb.surface(rows, { closedJ: true, mat: matFn, smoothAngle: 55 });
    // bouchons avant / arrière (faces planes, couvertes par calandre / plaques)
    for (const [row, sign] of [[rows[rows.length - 1]!, 1], [rows[0]!, -1]] as const) {
      const c: V3 = [0, (row[0]![1] + row[halfLen - 1]![1]) / 2, row[0]![2]];
      const n: V3 = [0, 0, sign];
      const ci = mb.vert('peinture', c, n, ...VMesh.paintUv(c, n));
      const ids = row.map((p) => mb.vert('peinture', p, n, ...VMesh.paintUv(p, n)));
      for (let k = 0; k < ids.length; k++) {
        const a = ids[k]!, b = ids[(k + 1) % ids.length]!;
        if (sign > 0) mb.tri('peinture', ci, a, b); else mb.tri('peinture', ci, b, a);
      }
    }
    if (this.cabin) this.buildCabin(mb);
  }

  /** Hauteur du pavillon à la station z. */
  roofAt(z: number): number {
    const c = this.cabin!;
    const belt = this.topAt(z);
    const mid = (c.zWs1 + c.zRf1) / 2, halfR = (c.zWs1 - c.zRf1) / 2;
    const arc = halfR > 0 ? c.roofArc * (1 - ((z - mid) / halfR) ** 2) : 0;
    if (z >= c.zWs1) {
      const t = (c.zWs0 - z) / (c.zWs0 - c.zWs1);
      const tt = Math.max(0, Math.min(1, t));
      return belt + (c.roofY - belt) * (tt * (1.25 - 0.25 * tt));
    }
    if (z <= c.zRf1) {
      const t = (z - c.zRw1) / (c.zRf1 - c.zRw1);
      const tt = Math.max(0, Math.min(1, t));
      return belt + (c.roofY - belt) * (tt * (1.3 - 0.3 * tt));
    }
    return c.roofY + arc;
  }

  private buildCabin(mb: VMesh): void {
    const c = this.cabin!;
    const lod = mb.lod;
    const set = new Set<number>([c.zWs0, c.zWs1, c.zRf1, c.zRw1]);
    for (const [a, b] of c.sideGlass) { set.add(a); set.add(b); }
    const nWs = lod === 0 ? 5 : lod === 1 ? 3 : 1;
    for (let k = 1; k < nWs; k++) { set.add(c.zWs0 + ((c.zWs1 - c.zWs0) * k) / nWs); set.add(c.zRw1 + ((c.zRf1 - c.zRw1) * k) / nWs); }
    const nRoof = lod === 0 ? 6 : lod === 1 ? 3 : 1;
    for (let k = 1; k < nRoof; k++) set.add(c.zRf1 + ((c.zWs1 - c.zRf1) * k) / nRoof);
    const zs = [...set].map((z) => +z.toFixed(4)).filter((z) => z <= c.zWs0 && z >= c.zRw1).sort((a, b) => a - b);
    const uniq = zs.filter((z, i) => i === 0 || z - zs[i - 1]! > 1e-3);
    const nArc = lod === 0 ? 3 : lod === 1 ? 2 : 1;
    // classes de points du demi-profil : 0 allège, 1 vitre, 2 arrondi, 3 dessus
    const cls: number[] = [];
    const rows: V3[][] = [];
    for (const z of uniq) {
      const yb = this.topAt(z) - 0.005;
      const yt = Math.max(yb + 0.002, this.roofAt(z));
      const hwb = this.hwAt(z) - this.lower.tumble - c.inset;
      const hwt = hwb - c.tumble * Math.min(1, (yt - yb) / Math.max(0.2, c.roofY - this.topAt(z)));
      const h = yt - yb;
      const rt = Math.min(c.rt, h * 0.4, hwt * 0.4);
      const ySill = Math.min(yb + c.sill, yb + h * 0.3);
      const yHead = Math.max(ySill, yt - rt - c.header);
      const X = (y: number): number => hwb + (hwt - hwb) * ((y - yb) / Math.max(1e-3, h));
      const half: [number, number][] = [[X(yb), yb], [X(ySill), ySill], [X(yHead), yHead], [X(yt - rt), yt - rt]];
      const k0: number[] = [0, 1, 2, 2];
      for (let k = 1; k <= nArc; k++) {
        const a = (k / nArc) * (Math.PI / 2);
        half.push([hwt - rt + Math.cos(a) * rt, yt - rt + Math.sin(a) * rt]); k0.push(k === nArc ? 3 : 2);
      }
      half.push([(hwt - rt) * 0.5, yt + 0.01], [0, yt + 0.014]);
      k0.push(3, 3);
      const ring: V3[] = half.map(([x, y]) => [x, y, z]);
      for (let k = half.length - 2; k >= 0; k--) ring.push([-half[k]![0], half[k]![1], z]);
      if (cls.length === 0) {
        for (let k = 0; k < half.length - 1; k++) cls.push(k0[k + 1]!); // classe du segment k -> k+1 (droite)
        for (let k = half.length - 2; k >= 0; k--) cls.push(k0[k + 1]!);
      }
      rows.push(ring);
    }
    const zMid = (i: number): number => (uniq[i]! + uniq[i + 1]!) / 2;
    const inGlass = (z: number): boolean => c.sideGlass.some(([a, b]) => z > a && z < b);
    const nHalf = cls.length / 2;
    const mat = (i: number, j: number): { mat: Mat; region?: RegionName } | null => {
      const z = zMid(i);
      const cl = cls[j] ?? 0;
      const segIsSideBand = (j < nHalf && j === 1) || (j >= nHalf && j === cls.length - 2);
      if (segIsSideBand) return { mat: inGlass(z) ? 'verre' : 'peinture' };
      if (cl === 3) {
        if (z > c.zWs1) return { mat: 'verre' };
        if (z < c.zRf1 && c.rearGlass) return { mat: 'verre' };
        return { mat: 'peinture' };
      }
      return { mat: 'peinture' };
    };
    mb.surface(rows, { mat, smoothAngle: 35, flip: true });
  }
}
