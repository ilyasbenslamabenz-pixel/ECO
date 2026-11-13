/**
 * Modèle de changement de voie MOBIL (« Minimizing Overall Braking Induced by Lane changes », Kesting, Treiber
 * & Helbing, 2007), au-dessus du modèle de poursuite IDM.
 *
 * Un changement de voie est accepté s'il est
 *  - SÛR : la décélération imposée au nouveau suiveur (et au véhicule lui-même) reste au-dessus de −bSafe ;
 *  - AVANTAGEUX : gain d'accélération du véhicule + politesse × (gain des suiveurs concernés) + biais de voie
 *    > seuil. Le biais favorise le retour sur la voie de droite (circulation à droite, dépassement par la gauche).
 * Un changement OBLIGATOIRE (présélection avant une manœuvre) ne demande que la sécurité, avec une décélération
 * admise croissante à l'approche de la fin de voie.
 * TypeScript pur, sans allocation.
 */

export interface MobilParams {
  /** Facteur de politesse p (0 = égoïste, 1 = altruiste). */
  politeness: number;
  /** Seuil de gain (m/s²) : évite les changements pour un avantage marginal (hystérésis). */
  threshold: number;
  /** Décélération maximale admise pour le nouveau suiveur (m/s², positive). */
  bSafe: number;
  /** Biais vers la voie de droite (m/s²). */
  biasRight: number;
}

export const MOBIL_DEFAULT: MobilParams = { politeness: 0.3, threshold: 0.2, bSafe: 2.5, biasRight: 0.15 };

/** Décélération admise (m/s², positive) pour un changement obligatoire à `remain` mètres de la fin de voie. */
export function mandatoryBSafe(remain: number): number {
  const u = remain >= 120 ? 0 : remain <= 20 ? 1 : (120 - remain) / 100;
  return 3 + 3 * u;
}

/**
 * Critère de sécurité : accélération du nouveau suiveur après insertion (`aFollowerAfter`) et du véhicule dans
 * la voie cible (`aSelfAfter`), toutes deux ≥ −bSafe.
 */
export function mobilSafe(aFollowerAfter: number, aSelfAfter: number, bSafe: number): boolean {
  return aFollowerAfter >= -bSafe && aSelfAfter >= -bSafe;
}

/**
 * Gain MOBIL (m/s²) d'un changement de voie.
 * @param aSelfAfter / aSelfBefore accélération du véhicule dans la voie cible / actuelle
 * @param aNewFolAfter / aNewFolBefore accélération du suiveur de la voie cible avec / sans le véhicule devant lui
 * @param aOldFolAfter / aOldFolBefore accélération du suiveur de la voie actuelle sans / avec le véhicule devant lui
 * @param toRight +1 si la voie cible est à droite, −1 à gauche
 */
export function mobilGain(
  aSelfAfter: number, aSelfBefore: number,
  aNewFolAfter: number, aNewFolBefore: number,
  aOldFolAfter: number, aOldFolBefore: number,
  toRight: number, p: MobilParams,
): number {
  return (aSelfAfter - aSelfBefore)
    + p.politeness * ((aNewFolAfter - aNewFolBefore) + (aOldFolAfter - aOldFolBefore))
    + p.biasRight * toRight;
}
