/**
 * Outils géométriques repris de Meknes City (city-builder/src/shared/math.ts, src/client/tools/geometry.ts) :
 * bornage, rayon, intersection rayon / sol, écart d'angles. TypeScript pur.
 */
export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export interface Vec3 { x: number; y: number; z: number }
export interface Ray { ox: number; oy: number; oz: number; dx: number; dy: number; dz: number }

/** Intersection d'un rayon avec un sol de hauteur `heightAt` (pas adaptatif puis dichotomie). */
export function rayTerrain(r: Ray, heightAt: (x: number, z: number) => number, maxDist = 8000, out?: Vec3): Vec3 | null {
  const above = (t: number): boolean => r.oy + r.dy * t > heightAt(r.ox + r.dx * t, r.oz + r.dz * t);
  if (!above(0)) {
    const o = out ?? { x: 0, y: 0, z: 0 };
    o.x = r.ox; o.z = r.oz; o.y = heightAt(r.ox, r.oz);
    return o;
  }
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

export function angleDelta(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}
