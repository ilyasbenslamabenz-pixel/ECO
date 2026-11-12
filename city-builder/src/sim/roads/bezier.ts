/**
 * Courbes de Bézier cubiques dans le plan XZ (tracés de routes). TypeScript pur.
 * Une courbe = 8 nombres [p0x, p0z, p1x, p1z, p2x, p2z, p3x, p3z].
 * Les fonctions écrivent dans des tableaux de sortie fournis (pas d'allocation dans les boucles).
 */

export type Cubic = Float64Array; // longueur 8

export function cubic(p0x: number, p0z: number, p1x: number, p1z: number, p2x: number, p2z: number, p3x: number, p3z: number): Cubic {
  const c = new Float64Array(8);
  c[0] = p0x; c[1] = p0z; c[2] = p1x; c[3] = p1z; c[4] = p2x; c[5] = p2z; c[6] = p3x; c[7] = p3z;
  return c;
}

/** Segment droit sous forme cubique (points de contrôle au tiers). */
export function straightCubic(ax: number, az: number, bx: number, bz: number): Cubic {
  return cubic(ax, az, ax + (bx - ax) / 3, az + (bz - az) / 3, ax + (2 * (bx - ax)) / 3, az + (2 * (bz - az)) / 3, bx, bz);
}

/** Courbe quadratique (début, contrôle, fin) élevée en cubique exacte. */
export function quadraticToCubic(ax: number, az: number, qx: number, qz: number, bx: number, bz: number): Cubic {
  return cubic(ax, az, ax + (2 / 3) * (qx - ax), az + (2 / 3) * (qz - az), bx + (2 / 3) * (qx - bx), bz + (2 / 3) * (qz - bz), bx, bz);
}

export function isStraight(c: Cubic, tol = 0.05): boolean {
  return distPointLine(c[2]!, c[3]!, c[0]!, c[1]!, c[6]!, c[7]!) < tol && distPointLine(c[4]!, c[5]!, c[0]!, c[1]!, c[6]!, c[7]!) < tol;
}

function distPointLine(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az;
  const l = Math.hypot(dx, dz);
  if (l < 1e-9) return Math.hypot(px - ax, pz - az);
  return Math.abs((px - ax) * dz - (pz - az) * dx) / l;
}

/** Point en t ; écrit [x, z] dans out. */
export function evalCubic(c: Cubic, t: number, out: Float64Array | number[], o = 0): void {
  const u = 1 - t;
  const b0 = u * u * u, b1 = 3 * u * u * t, b2 = 3 * u * t * t, b3 = t * t * t;
  out[o] = b0 * c[0]! + b1 * c[2]! + b2 * c[4]! + b3 * c[6]!;
  out[o + 1] = b0 * c[1]! + b1 * c[3]! + b2 * c[5]! + b3 * c[7]!;
}

/** Dérivée en t (non normalisée) ; écrit [dx, dz]. */
export function derivCubic(c: Cubic, t: number, out: Float64Array | number[], o = 0): void {
  const u = 1 - t;
  const a = 3 * u * u, b = 6 * u * t, d = 3 * t * t;
  out[o] = a * (c[2]! - c[0]!) + b * (c[4]! - c[2]!) + d * (c[6]! - c[4]!);
  out[o + 1] = a * (c[3]! - c[1]!) + b * (c[5]! - c[3]!) + d * (c[7]! - c[5]!);
}

/** Dérivée seconde. */
export function deriv2Cubic(c: Cubic, t: number, out: Float64Array | number[], o = 0): void {
  const u = 1 - t;
  out[o] = 6 * u * (c[4]! - 2 * c[2]! + c[0]!) + 6 * t * (c[6]! - 2 * c[4]! + c[2]!);
  out[o + 1] = 6 * u * (c[5]! - 2 * c[3]! + c[1]!) + 6 * t * (c[7]! - 2 * c[5]! + c[3]!);
}

/** Découpe de De Casteljau en t : renvoie [gauche, droite] (exact). */
export function splitCubic(c: Cubic, t: number): [Cubic, Cubic] {
  const lerp = (a: number, b: number): number => a + (b - a) * t;
  const x01 = lerp(c[0]!, c[2]!), z01 = lerp(c[1]!, c[3]!);
  const x12 = lerp(c[2]!, c[4]!), z12 = lerp(c[3]!, c[5]!);
  const x23 = lerp(c[4]!, c[6]!), z23 = lerp(c[5]!, c[7]!);
  const x012 = lerp(x01, x12), z012 = lerp(z01, z12);
  const x123 = lerp(x12, x23), z123 = lerp(z12, z23);
  const x = lerp(x012, x123), z = lerp(z012, z123);
  return [cubic(c[0]!, c[1]!, x01, z01, x012, z012, x, z), cubic(x, z, x123, z123, x23, z23, c[6]!, c[7]!)];
}

/** Courbe inversée (b -> a). */
export function reverseCubic(c: Cubic): Cubic {
  return cubic(c[6]!, c[7]!, c[4]!, c[5]!, c[2]!, c[3]!, c[0]!, c[1]!);
}

/**
 * Table d'abscisse curviligne : `n` intervalles réguliers en t, longueurs cumulées.
 * Permet de convertir s (m) <-> t. Précision < 1 cm pour n = 64 sur des tracés de route.
 */
export class ArcTable {
  readonly n: number;
  readonly cum: Float64Array;
  readonly length: number;
  constructor(readonly curve: Cubic, n = 64) {
    this.n = n;
    this.cum = new Float64Array(n + 1);
    const p = new Float64Array(2);
    let px = curve[0]!, pz = curve[1]!, acc = 0;
    for (let i = 1; i <= n; i++) {
      evalCubic(curve, i / n, p);
      acc += Math.hypot(p[0]! - px, p[1]! - pz);
      this.cum[i] = acc;
      px = p[0]!; pz = p[1]!;
    }
    this.length = acc;
  }

  /** Paramètre t pour une abscisse s (m). */
  tAt(s: number): number {
    if (s <= 0) return 0;
    if (s >= this.length) return 1;
    let lo = 0, hi = this.n;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid]! < s) lo = mid; else hi = mid;
    }
    const a = this.cum[lo]!, b = this.cum[hi]!;
    return (lo + (b > a ? (s - a) / (b - a) : 0)) / this.n;
  }

  /** Abscisse s pour un paramètre t. */
  sAt(t: number): number {
    if (t <= 0) return 0;
    if (t >= 1) return this.length;
    const f = t * this.n;
    const i = Math.floor(f);
    return this.cum[i]! + (this.cum[i + 1]! - this.cum[i]!) * (f - i);
  }
}

export function cubicLength(c: Cubic): number {
  return new ArcTable(c, 48).length;
}

/** Point le plus proche sur la courbe : renvoie { t, d, x, z }. Échantillonnage puis raffinement de Newton. */
export function closestOnCubic(c: Cubic, px: number, pz: number, samples = 32): { t: number; d: number; x: number; z: number } {
  const p = new Float64Array(2), d1 = new Float64Array(2), d2 = new Float64Array(2);
  let bestT = 0, bestD = Infinity;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    evalCubic(c, t, p);
    const d = (p[0]! - px) ** 2 + (p[1]! - pz) ** 2;
    if (d < bestD) { bestD = d; bestT = t; }
  }
  let t = bestT;
  for (let it = 0; it < 6; it++) {
    evalCubic(c, t, p); derivCubic(c, t, d1); deriv2Cubic(c, t, d2);
    const ex = p[0]! - px, ez = p[1]! - pz;
    const f = ex * d1[0]! + ez * d1[1]!;
    const fp = d1[0]! * d1[0]! + d1[1]! * d1[1]! + ex * d2[0]! + ez * d2[1]!;
    if (Math.abs(fp) < 1e-12) break;
    const nt = Math.min(1, Math.max(0, t - f / fp));
    if (Math.abs(nt - t) < 1e-7) { t = nt; break; }
    t = nt;
  }
  evalCubic(c, t, p);
  return { t, d: Math.hypot(p[0]! - px, p[1]! - pz), x: p[0]!, z: p[1]! };
}

/** Rayon de courbure minimal (m) estimé par échantillonnage (Infinity pour une droite). */
export function minRadius(c: Cubic, samples = 32): number {
  const d1 = new Float64Array(2), d2 = new Float64Array(2);
  let best = Infinity;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    derivCubic(c, t, d1); deriv2Cubic(c, t, d2);
    const sp = Math.hypot(d1[0]!, d1[1]!);
    const cross = Math.abs(d1[0]! * d2[1]! - d1[1]! * d2[0]!);
    if (cross < 1e-9 || sp < 1e-9) continue;
    const r = (sp * sp * sp) / cross;
    if (r < best) best = r;
  }
  return best;
}

/** Échantillonne la courbe en polyligne (n+1 points) dans out [x0,z0,x1,z1,...]. */
export function polyline(c: Cubic, n: number, out = new Float64Array((n + 1) * 2)): Float64Array {
  for (let i = 0; i <= n; i++) evalCubic(c, i / n, out, i * 2);
  return out;
}

/** Boîte englobante (via le polygone de contrôle, englobant garanti). */
export function cubicBounds(c: Cubic): [number, number, number, number] {
  return [
    Math.min(c[0]!, c[2]!, c[4]!, c[6]!), Math.min(c[1]!, c[3]!, c[5]!, c[7]!),
    Math.max(c[0]!, c[2]!, c[4]!, c[6]!), Math.max(c[1]!, c[3]!, c[5]!, c[7]!),
  ];
}

/**
 * Intersections de deux courbes (approximation par polylignes de `n` pas, puis raffinement local).
 * Renvoie les couples (t sur a, t sur b) triés selon ta.
 */
export function intersectCubics(a: Cubic, b: Cubic, n = 48): { ta: number; tb: number; x: number; z: number }[] {
  const pa = polyline(a, n), pb = polyline(b, n);
  const out: { ta: number; tb: number; x: number; z: number }[] = [];
  for (let i = 0; i < n; i++) {
    const ax = pa[i * 2]!, az = pa[i * 2 + 1]!, bx = pa[i * 2 + 2]!, bz = pa[i * 2 + 3]!;
    const e = 1e-6; // tolérance : contacts exacts (extrémités) malgré les arrondis d'évaluation
    const minAx = Math.min(ax, bx) - e, maxAx = Math.max(ax, bx) + e, minAz = Math.min(az, bz) - e, maxAz = Math.max(az, bz) + e;
    for (let j = 0; j < n; j++) {
      const cx = pb[j * 2]!, cz = pb[j * 2 + 1]!, dx = pb[j * 2 + 2]!, dz = pb[j * 2 + 3]!;
      if (Math.max(cx, dx) < minAx || Math.min(cx, dx) > maxAx || Math.max(cz, dz) < minAz || Math.min(cz, dz) > maxAz) continue;
      const r = segSeg(ax, az, bx, bz, cx, cz, dx, dz);
      if (!r) continue;
      const ta = (i + r[0]) / n, tb = (j + r[1]) / n;
      // évite les doublons sur les sommets partagés de la polyligne
      if (out.some((o) => Math.abs(o.ta - ta) < 0.5 / n && Math.abs(o.tb - tb) < 0.5 / n)) continue;
      const ref = refineIntersection(a, b, ta, tb);
      out.push(ref);
    }
  }
  out.sort((p, q) => p.ta - q.ta);
  return out;
}

/** Intersection de deux segments : [u, v] dans [0,1] ou null. */
export function segSeg(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): [number, number] | null {
  const rx = bx - ax, rz = bz - az, sx = dx - cx, sz = dz - cz;
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-12) return null;
  const qx = cx - ax, qz = cz - az;
  const u = (qx * sz - qz * sx) / den;
  const v = (qx * rz - qz * rx) / den;
  const e = 1e-7; // tolérance : contacts exacts aux extrémités (nœuds)
  if (u < -e || u > 1 + e || v < -e || v > 1 + e) return null;
  return [Math.min(1, Math.max(0, u)), Math.min(1, Math.max(0, v))];
}

function refineIntersection(a: Cubic, b: Cubic, ta: number, tb: number): { ta: number; tb: number; x: number; z: number } {
  const pa = new Float64Array(2), pb = new Float64Array(2), da = new Float64Array(2), db = new Float64Array(2);
  for (let it = 0; it < 8; it++) {
    evalCubic(a, ta, pa); evalCubic(b, tb, pb); derivCubic(a, ta, da); derivCubic(b, tb, db);
    // Résout pa + da*x = pb + db*y
    const den = da[0]! * -db[1]! - da[1]! * -db[0]!;
    if (Math.abs(den) < 1e-12) break;
    const ex = pb[0]! - pa[0]!, ez = pb[1]! - pa[1]!;
    const x = (ex * -db[1]! - ez * -db[0]!) / den;
    const y = (da[0]! * ez - da[1]! * ex) / den;
    const nta = Math.min(1, Math.max(0, ta + x)), ntb = Math.min(1, Math.max(0, tb + y));
    const done = Math.abs(nta - ta) + Math.abs(ntb - tb) < 1e-8;
    ta = nta; tb = ntb;
    if (done) break;
  }
  evalCubic(a, ta, pa);
  return { ta, tb, x: pa[0]!, z: pa[1]! };
}
