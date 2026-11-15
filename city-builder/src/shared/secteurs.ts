/**
 * Secteurs : zones rectangulaires nommées par le joueur, chacune avec ses politiques LOCALES (effets limités aux
 * bâtiments dont le centre est dans le secteur ; coût mensuel par bâtiment du secteur).
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
export interface DistrictPolicyDef {
  id: string;
  nameFr: string;
  descFr: string;
  /** Coût mensuel par bâtiment du secteur (CHF). */
  costPerBuilding: number;
  /** Points de bonheur ajoutés aux habitants du secteur. */
  happiness: number;
  /** Multiplicateur de la pollution subie dans le secteur (1 = sans effet). */
  pollution: number;
}

export const DISTRICT_POLICIES: readonly DistrictPolicyDef[] = [
  { id: 'embellissement', nameFr: 'Embellissement', descFr: 'Fleurs, bancs et façades rénovées : +3 points de bonheur pour les habitants du secteur.', costPerBuilding: 12, happiness: 3, pollution: 1 },
  { id: 'zone_apaisee', nameFr: 'Zone apaisée', descFr: 'Rues à 30 km/h, livraisons limitées : pollution subie −25 %, +1 point de bonheur.', costPerBuilding: 6, happiness: 1, pollution: 0.75 },
  { id: 'police_proximite', nameFr: 'Police de proximité', descFr: 'Îlotiers présents dans le secteur : +2 points de bonheur.', costPerBuilding: 10, happiness: 2, pollution: 1 },
  { id: 'parcs_poche', nameFr: 'Parcs de poche', descFr: 'Petits jardins entre les bâtiments : pollution subie −15 %, +1 point de bonheur.', costPerBuilding: 8, happiness: 1, pollution: 0.85 },
];

export interface SecteurView {
  id: number;
  name: string;
  x0: number; z0: number; x1: number; z1: number;
  policies: string[];
  buildings: number;
  monthlyCost: number;
}

export interface SecteursState { secteurs: SecteurView[]; totalCost: number; max: number }

/** Côté minimal et maximal d'un secteur (m), nombre maximal de secteurs. */
export const SECTEUR_LIMITS = { minSize: 64, maxSize: 2000, max: 24 } as const;
