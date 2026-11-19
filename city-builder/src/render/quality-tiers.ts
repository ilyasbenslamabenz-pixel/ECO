/**
 * Paliers de qualité automatiques (qualité « Auto », ordinateur et téléphone, docs/PERFORMANCE_PC.md).
 *
 * La boucle d'affichage (src/render/scene.ts) mesure la cadence réelle. Quand elle décroche :
 *   1. la résolution 3D baisse d'abord (résolution dynamique existante), jusqu'à son plancher ;
 *   2. puis le palier descend d'un cran (ombres, LOD, végétation, véhicules et piétons lointains).
 * Quand la cadence a de la marge, l'ordre est inversé : le palier remonte d'abord, puis la résolution.
 * Anti-scintillement : au plus un changement de palier toutes les 4 s en descente, 12 s de cadence tenue avant une
 * montée, et pas de remontée vers un palier qui a décroché dans les 2 dernières minutes.
 *
 * Qualités Haute / Moyenne choisies par le joueur : aucun palier (palier 0, réglages inchangés) ; Basse : palier
 * « minimal » imposé (src/ui/options.ts, `fixedTierFor`).
 * `?palier=0..3` impose un palier fixe (mesures).
 */

export interface QualityTier {
  /** Nom affiché (page ?bench, réglages). */
  name: string;
  /** Plafond de la carte d'ombre (px), appliqué sous le réglage « Ombres » du joueur. */
  shadowCap: number;
  /** Distance caméra-cible (m) au-delà de laquelle les petits objets (feux, décor, piétons…) ne projettent plus d'ombre. */
  smallShadowDist: number;
  /** Dernier LOD de végétation qui projette une ombre (Infinity : tous). */
  vegShadowMaxLod: number;
  /** Multiplicateur des distances de LOD des bâtiments. */
  buildingLod: number;
  /** Multiplicateur des distances de la végétation (LOD, imposteurs, masquage). */
  vegScale: number;
  /** Véhicules dessinés au plus (les plus proches d'abord). */
  maxVehicles: number;
  /**
   * Distance d'affichage des véhicules (m). Toujours au-delà des vues aériennes usuelles (560 à 1 100 m) : une
   * première version à 420 m vidait les rues en vue aérienne (mesure du 16/11, docs/PERFORMANCE_PC.md).
   */
  vehicleDist: number;
  /** Distance d'affichage des piétons (m). */
  pedDist: number;
  /** Effets d'image (occlusion ambiante, src/render/post.ts) autorisés à ce palier. */
  ao: boolean;
}

export const QUALITY_TIERS: readonly QualityTier[] = [
  { name: 'élevé', shadowCap: 4096, smallShadowDist: 320, vegShadowMaxLod: Infinity, buildingLod: 1, vegScale: 1, maxVehicles: Infinity, vehicleDist: Infinity, pedDist: 1400, ao: true },
  { name: 'moyen', shadowCap: 2048, smallShadowDist: 200, vegShadowMaxLod: 1, buildingLod: 0.8, vegScale: 0.85, maxVehicles: 600, vehicleDist: 1800, pedDist: 500, ao: true },
  { name: 'réduit', shadowCap: 1024, smallShadowDist: 140, vegShadowMaxLod: 1, buildingLod: 0.65, vegScale: 0.7, maxVehicles: 400, vehicleDist: 1400, pedDist: 260, ao: false },
  { name: 'minimal', shadowCap: 1024, smallShadowDist: 90, vegShadowMaxLod: 0, buildingLod: 0.5, vegScale: 0.55, maxVehicles: 250, vehicleDist: 1100, pedDist: 160, ao: false },
];

/** Palier imposé par l'adresse (`?palier=0..3`), null sinon. */
export function urlTier(search = typeof location !== 'undefined' ? location.search : ''): number | null {
  const v = new URLSearchParams(search).get('palier');
  if (v === null || v === '') return null;
  const n = Number(v) | 0;
  return n >= 0 && n < QUALITY_TIERS.length ? n : null;
}

/**
 * Décisions de palier (pure, testable) : `down` / `up` sont appelés par la boucle d'affichage quand la cadence
 * décroche / a de la marge et que la résolution ne peut plus agir. Renvoient vrai si le palier a changé.
 */
export class TierController {
  tier = 0;
  /** Palier fixe (`?palier=`) : aucune adaptation. */
  fixed = false;
  private lastChange = -Infinity;
  private failTier = Infinity;
  private failUntil = 0;
  constructor(readonly count = QUALITY_TIERS.length, readonly downEveryMs = 4000, readonly upAfterMs = 12000, readonly failHoldMs = 120000) {}

  down(now: number): boolean {
    if (this.fixed || this.tier >= this.count - 1 || now - this.lastChange < this.downEveryMs) return false;
    // Le palier courant décroche : on n'y remonte pas avant `failHoldMs`.
    this.failTier = this.tier; this.failUntil = now + this.failHoldMs;
    this.tier++;
    this.lastChange = now;
    return true;
  }

  up(now: number): boolean {
    if (this.fixed || this.tier <= 0 || now - this.lastChange < this.upAfterMs) return false;
    if (this.tier - 1 <= this.failTier && now < this.failUntil) return false;
    this.tier--;
    this.lastChange = now;
    return true;
  }

  /** Remise au palier de départ (changement de réglage du joueur). */
  reset(tier = 0): void { this.tier = tier; this.lastChange = -Infinity; this.failTier = Infinity; this.failUntil = 0; }
}
