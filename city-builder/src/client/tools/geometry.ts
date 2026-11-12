/**
 * Géométrie pure des outils de construction (aucun import de three ni du DOM) :
 * distances point/segment/rectangle, intersection rayon/boîte, rayon/terrain,
 * échantillonnage de courbes de Bézier, alignement d'empreinte sur la grille.
 * Les formules d'empreinte reproduisent exactement Simulation.footprintFor (src/sim/world.ts)
 * pour que l'aperçu fantôme tombe là où la simulation posera le bâtiment.
 * Propriétaire : agent construction/caméra/UI.
 */
import { TILE_SIZE } from '../../shared/constants';

export interface Vec3 { x: number; y: number; z: number }
export interface Ray { ox: number; oy: number; oz: number; dx: number; dy: number; dz: number }

export function distPointSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const t = projectOnSegment(px, pz, ax, az, bx, bz);
  const qx = ax + (bx - ax) * t - px;
  const qz = az + (bz - az) * t - pz;
  return Math.sqrt(qx * qx + qz * qz);
}

/** Paramètre t ∈ [0,1] du projeté de p sur [a,b]. */
export function projectOnSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  if (l2 <= 1e-12) return 0;
  const t = ((px - ax) * dx + (pz - az) * dz) / l2;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** Distance exacte d'un segment à un rectangle aligné (0 si intersection). */
export function distSegmentRect(ax: number, az: number, bx: number, bz: number, minX: number, minZ: number, maxX: number, maxZ: number): number {
  if (segmentIntersectsRect(ax, az, bx, bz, minX, minZ, maxX, maxZ)) return 0;
  return Math.min(
    distPointRect(ax, az, minX, minZ, maxX, maxZ), distPointRect(bx, bz, minX, minZ, maxX, maxZ),
    distPointSegment(minX, minZ, ax, az, bx, bz), distPointSegment(maxX, minZ, ax, az, bx, bz),
    distPointSegment(minX, maxZ, ax, az, bx, bz), distPointSegment(maxX, maxZ, ax, az, bx, bz),
  );
}

export function distPointRect(px: number, pz: number, minX: number, minZ: number, maxX: number, maxZ: number): number {
  const dx = px < minX ? minX - px : px > maxX ? px - maxX : 0;
  const dz = pz < minZ ? minZ - pz : pz > maxZ ? pz - maxZ : 0;
  return Math.sqrt(dx * dx + dz * dz);
}

/** Test de Liang-Barsky segment / rectangle. */
export function segmentIntersectsRect(ax: number, az: number, bx: number, bz: number, minX: number, minZ: number, maxX: number, maxZ: number): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dz = bz - az;
  const p = [-dx, dx, -dz, dz];
  const q = [ax - minX, maxX - ax, az - minZ, maxZ - az];
  for (let i = 0; i < 4; i++) {
    const pi = p[i]!;
    const qi = q[i]!;
    if (pi === 0) { if (qi < 0) return false; continue; }
    const r = qi / pi;
    if (pi < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return true;
}

/** Intersection rayon / boîte alignée. Renvoie la distance t ≥ 0 d'entrée, ou -1. */
export function rayBox(r: Ray, minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): number {
  let tmin = 0;
  let tmax = Infinity;
  const o = [r.ox, r.oy, r.oz];
  const d = [r.dx, r.dy, r.dz];
  const lo = [minX, minY, minZ];
  const hi = [maxX, maxY, maxZ];
  for (let i = 0; i < 3; i++) {
    const di = d[i]!;
    const oi = o[i]!;
    if (Math.abs(di) < 1e-12) { if (oi < lo[i]! || oi > hi[i]!) return -1; continue; }
    let ta = (lo[i]! - oi) / di;
    let tb = (hi[i]! - oi) / di;
    if (ta > tb) { const s = ta; ta = tb; tb = s; }
    if (ta > tmin) tmin = ta;
    if (tb < tmax) tmax = tb;
    if (tmin > tmax) return -1;
  }
  return tmin;
}

/**
 * Intersection rayon / terrain par marche puis dichotomie. `heightAt` est la fonction partagée
 * avec la simulation. Renvoie null si le rayon ne touche pas le sol avant `maxDist`.
 */
export function rayTerrain(r: Ray, heightAt: (x: number, z: number) => number, maxDist = 8000, out?: Vec3): Vec3 | null {
  const above = (t: number): boolean => r.oy + r.dy * t > heightAt(r.ox + r.dx * t, r.oz + r.dz * t);
  if (!above(0)) {
    const o = out ?? { x: 0, y: 0, z: 0 };
    o.x = r.ox; o.z = r.oz; o.y = heightAt(r.ox, r.oz);
    return o;
  }
  // Pas adaptatif : fin près de la caméra, plus grossier au loin.
  let prev = 0;
  let t = 0.5;
  while (t <= maxDist) {
    if (!above(t)) {
      let lo = prev;
      let hi = t;
      for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (above(m)) lo = m; else hi = m; }
      const o = out ?? { x: 0, y: 0, z: 0 };
      o.x = r.ox + r.dx * hi; o.z = r.oz + r.dz * hi; o.y = heightAt(o.x, o.z);
      return o;
    }
    prev = t;
    t += Math.max(0.5, t * 0.02);
  }
  return null;
}

/** Point d'une Bézier quadratique. */
export function bezier2(ax: number, az: number, cx: number, cz: number, bx: number, bz: number, t: number): [number, number] {
  const u = 1 - t;
  return [u * u * ax + 2 * u * t * cx + t * t * bx, u * u * az + 2 * u * t * cz + t * t * bz];
}

/** Longueur approchée d'une Bézier quadratique (polyligne de 32 segments). */
export function bezier2Length(ax: number, az: number, cx: number, cz: number, bx: number, bz: number): number {
  let len = 0;
  let px = ax;
  let pz = az;
  for (let i = 1; i <= 32; i++) {
    const [x, z] = bezier2(ax, az, cx, cz, bx, bz, i / 32);
    len += Math.hypot(x - px, z - pz);
    px = x; pz = z;
  }
  return len;
}

/**
 * Échantillonne une Bézier quadratique en polyligne [x0,z0,x1,z1,…] avec des segments
 * d'environ `step` mètres (≥ 4 m : la simulation ignore les segments plus courts).
 */
export function sampleBezier2(ax: number, az: number, cx: number, cz: number, bx: number, bz: number, step = 12): number[] {
  const len = bezier2Length(ax, az, cx, cz, bx, bz);
  const n = Math.max(1, Math.min(48, Math.round(len / Math.max(4, step))));
  const pts: number[] = [ax, az];
  for (let i = 1; i < n; i++) {
    const [x, z] = bezier2(ax, az, cx, cz, bx, bz, i / n);
    pts.push(x, z);
  }
  pts.push(bx, bz);
  return pts;
}

export function polylineLength(points: readonly number[]): number {
  let len = 0;
  for (let k = 0; k + 3 < points.length; k += 2) len += Math.hypot(points[k + 2]! - points[k]!, points[k + 3]! - points[k + 1]!);
  return len;
}

/** Empreinte tournée (en cases) pour une rotation en quarts de tour. */
export function rotatedTiles(tilesX: number, tilesZ: number, rot: number): { tx: number; tz: number } {
  return (rot & 3) % 2 === 0 ? { tx: tilesX, tz: tilesZ } : { tx: tilesZ, tz: tilesX };
}

export interface GridFootprint { cx: number; cz: number; tx: number; tz: number; minX: number; minZ: number; maxX: number; maxZ: number }

/** Même calcul que Simulation.footprintFor : centre aligné sur la grille de TILE_SIZE. */
export function gridFootprint(originX: number, originZ: number, tilesX: number, tilesZ: number, x: number, z: number, rot: number): GridFootprint {
  const { tx, tz } = rotatedTiles(tilesX, tilesZ, rot);
  const i0 = Math.round((x - originX) / TILE_SIZE - tx / 2);
  const j0 = Math.round((z - originZ) / TILE_SIZE - tz / 2);
  const minX = originX + i0 * TILE_SIZE;
  const minZ = originZ + j0 * TILE_SIZE;
  return { cx: minX + (tx * TILE_SIZE) / 2, cz: minZ + (tz * TILE_SIZE) / 2, tx, tz, minX, minZ, maxX: minX + tx * TILE_SIZE, maxZ: minZ + tz * TILE_SIZE };
}

/** Normale de façade (rot = 0 : +Z) après rotation de `rot` quarts de tour (même convention que rotateQuarter / three). */
export function facadeNormal(rot: number): [number, number] {
  switch (rot & 3) {
    case 0: return [0, 1];
    case 1: return [1, 0];
    case 2: return [0, -1];
    default: return [-1, 0];
  }
}

/** Écart angulaire minimal entre deux caps (rad), dans [-π, π]. */
export function angleDelta(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/** Arrondit un angle (rad) au multiple de `stepRad` le plus proche. */
export function snapAngle(a: number, stepRad: number): number {
  return Math.round(a / stepRad) * stepRad;
}

/** Altitude retenue par la simulation pour un bâtiment : moyenne des coins de cases de l'empreinte. */
export function footprintGroundY(heightAt: (x: number, z: number) => number, r: { minX: number; minZ: number; tx: number; tz: number }): number {
  let sum = 0;
  let n = 0;
  for (let j = 0; j <= r.tz; j++) for (let i = 0; i <= r.tx; i++) { sum += heightAt(r.minX + i * TILE_SIZE, r.minZ + j * TILE_SIZE); n++; }
  return n ? sum / n : 0;
}
