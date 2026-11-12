/**
 * Modèle de poursuite IDM (Intelligent Driver Model, Treiber et al.) : accélération d'un véhicule
 * selon sa vitesse, la vitesse désirée, l'écart au véhicule qui précède et la vitesse d'approche.
 * TypeScript pur, sans allocation.
 */

export interface IdmParams {
  /** Accélération maximale (m/s²). */
  aMax: number;
  /** Décélération confortable (m/s²). */
  bComf: number;
  /** Temps inter-véhiculaire désiré (s). */
  T: number;
  /** Distance minimale à l'arrêt (m). */
  s0: number;
}

/** Profils par type de véhicule (catalogue : vehicle.kind). */
export const IDM_BY_KIND: Record<'car' | 'van' | 'bus' | 'truck' | 'service', IdmParams> = {
  car: { aMax: 1.6, bComf: 2.2, T: 1.2, s0: 2.0 },
  van: { aMax: 1.2, bComf: 2.0, T: 1.4, s0: 2.5 },
  bus: { aMax: 0.9, bComf: 1.6, T: 1.6, s0: 3.0 },
  truck: { aMax: 0.8, bComf: 1.5, T: 1.7, s0: 3.0 },
  service: { aMax: 1.4, bComf: 2.0, T: 1.3, s0: 2.5 },
};

/** Décélération maximale physiquement admise (m/s²). */
export const B_MAX = 8;
/** Écart considéré comme « pas de meneur » (m). */
export const FREE_GAP = 1e4;

/**
 * Accélération IDM.
 * @param v vitesse (m/s) @param v0 vitesse désirée (m/s) @param gap écart pare-chocs à pare-chocs (m)
 * @param dv vitesse d'approche v − vMeneur (m/s)
 */
export function idmAccel(v: number, v0: number, gap: number, dv: number, aMax: number, bComf: number, T: number, s0: number): number {
  const vr = v0 > 0.1 ? v / v0 : 10;
  const free = 1 - vr * vr * vr * vr;
  if (gap >= FREE_GAP) return Math.max(-B_MAX, aMax * free);
  const sStar = s0 + Math.max(0, v * T + (v * dv) / (2 * Math.sqrt(aMax * bComf)));
  const g = Math.max(0.05, gap);
  const r = sStar / g;
  return Math.max(-B_MAX, aMax * (free - r * r));
}
