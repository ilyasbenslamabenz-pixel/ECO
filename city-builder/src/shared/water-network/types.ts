/**
 * Eau et assainissement (phase 2B.5) — constantes et types partagés simulation / rendu / interface.
 * Unités : volumes en m³, débits en m³/h, pressions en bar, qualité 0..1 (1 = eau potable parfaite),
 * pollution des cours d'eau = indicateur municipal standard `pollution_eau` (indice 0..100).
 * TypeScript pur : AUCUN import de three ni du DOM.
 */

/** Rôle d'une installation du service de l'eau. */
export type WaterFacilityKind = 'pompage' | 'potabilisation' | 'chateau' | 'epuration' | 'emissaire';

export interface WaterFacilitySpec {
  kind: WaterFacilityKind;
  /** Identifiant du modèle dans le catalogue (bâtiment de catégorie `public`). */
  assetId: string;
  nameFr: string;
  /**
   * Capacité nominale (financement 100 %) :
   *  - pompage : débit en eau de surface (m³/h) ; en forage, multiplié par le rendement de la nappe ;
   *  - potabilisation, épuration : débit traité (m³/h) ;
   *  - château : débit de sortie maximal (m³/h) ;
   *  - émissaire : débit rejetable (m³/h).
   */
  capacity: number;
  /** Château d'eau : volume stocké maximal (m³). */
  storage?: number;
  /** Château d'eau : hauteur de la cuve au-dessus du sol (m) — fixe la pression de service. */
  head?: number;
  /** Coût d'exploitation (crédits par m³ traité / pompé, financement 100 %). */
  costPerM3: number;
}

export const WATER_FACILITIES: Readonly<Record<WaterFacilityKind, WaterFacilitySpec>> = {
  pompage: { kind: 'pompage', assetId: 'eau_station_pompage', nameFr: 'Station de pompage', capacity: 160, costPerM3: 0.08 },
  potabilisation: { kind: 'potabilisation', assetId: 'eau_usine_potabilisation', nameFr: 'Usine de potabilisation', capacity: 220, costPerM3: 0.18 },
  chateau: { kind: 'chateau', assetId: 'eau_chateau_eau', nameFr: 'Château d\'eau', capacity: 140, storage: 900, head: 32, costPerM3: 0.02 },
  epuration: { kind: 'epuration', assetId: 'eau_station_epuration', nameFr: 'Station d\'épuration', capacity: 180, costPerM3: 0.22 },
  emissaire: { kind: 'emissaire', assetId: 'eau_emissaire', nameFr: 'Émissaire de rejet', capacity: 100_000, costPerM3: 0 },
};

export const WATER_FACILITY_KINDS: readonly WaterFacilityKind[] = ['pompage', 'potabilisation', 'chateau', 'epuration', 'emissaire'];

/** Installation correspondant à un modèle du catalogue (undefined si ce n'est pas une installation d'eau). */
export function facilityKindOf(assetId: string): WaterFacilityKind | undefined {
  for (const k of WATER_FACILITY_KINDS) if (WATER_FACILITIES[k].assetId === assetId) return k;
  return undefined;
}

/** Réglages du joueur (commande `settings`). */
export interface WaterSettings {
  /** Financement du service d'eau potable (pompage, traitement, stockage) : 0..1,5 (1 = 100 %). */
  fundingWater: number;
  /** Financement de l'assainissement (épuration) : 0..1,5. */
  fundingSewer: number;
  /** Tarif de l'eau (crédits / m³) : 0..6. Un tarif élevé réduit la consommation et la satisfaction. */
  tariff: number;
  /** Restrictions d'usage (arrosage, lavage) : demande −20 %, léger mécontentement. */
  restrictions: boolean;
}

export const DEFAULT_WATER_SETTINGS: Readonly<WaterSettings> = { fundingWater: 1, fundingSewer: 1, tariff: 2, restrictions: false };
export const SETTINGS_BOUNDS = { funding: [0, 1.5], tariff: [0, 6] } as const;

/** Mode de captage d'une station de pompage. */
export type IntakeMode = 'surface' | 'forage';

/** État d'une installation (panneau, inspection). */
export interface WaterFacilityState {
  buildingId: number;
  kind: WaterFacilityKind;
  x: number;
  z: number;
  /** Raccordée au réseau (route à moins de 60 m). */
  connected: boolean;
  /** Débit disponible ce pas (m³/h) après financement, nappe, etc. */
  capacity: number;
  /** Débit réellement fourni / traité / rejeté au dernier pas (m³/h). */
  output: number;
  /** Pompage : mode de captage et indice de pollution de l'eau captée (0..100). */
  intake?: IntakeMode;
  intakePollution?: number;
  /** Château : stock (m³) et capacité de stockage. */
  stock?: number;
  storage?: number;
  /** Épuration : rendement d'abattement de la pollution (0..1). */
  efficiency?: number;
  /** Point de rejet dans l'eau (épuration, émissaire) ; null si aucune eau à proximité (rejet au sol). */
  outfall?: [number, number] | null;
}

/** Bilan d'une heure de service (et cumul du jour). */
export interface WaterBalance {
  /** Heure de jeu (minutes totales) du bilan. */
  at: number;
  /** Eau brute captée (m³/h). */
  pumped: number;
  /** Eau traitée par les usines (m³/h). */
  treated: number;
  /** Capacité de production potable (m³/h) : usines + pompages non traités + châteaux. */
  production: number;
  /** Demande (m³/h) des bâtiments raccordables. */
  demand: number;
  /** Livré (m³/h). */
  delivered: number;
  /** Stock total des châteaux (m³) / capacité totale. */
  stock: number;
  storage: number;
  /** Qualité moyenne de l'eau livrée (0..1, pondérée par les volumes). */
  quality: number;
  /** Part des bâtiments desservis (au moins 50 % de leur besoin et pression suffisante). */
  servedShare: number;
  /** Bâtiments (occupés ou non) : total, desservis, non desservis. */
  buildings: number;
  served: number;
  unserved: number;
  /** Pression moyenne aux nœuds alimentés (bar). */
  pressure: number;
  /** Eaux usées produites (m³/h), évacuées vers une station, rejetées brutes par émissaire, débordées. */
  sewage: number;
  sewageTreated: number;
  sewageRaw: number;
  sewageOverflow: number;
  /** Part des eaux usées collectées (épuration + émissaire) / produites. */
  sewerCoverage: number;
  /** Charge polluante rejetée dans les cours d'eau (unités de charge / h). */
  pollutionLoad: number;
  /** Indice moyen / maximal de `pollution_eau` sur les cellules en eau. */
  riverPollutionMean: number;
  riverPollutionMax: number;
}

/** Ligne budgétaire du service (mois en cours ou dernier mois clos). */
export interface WaterBudget {
  /** Recettes de vente d'eau (crédits). */
  income: number;
  /** Dépenses d'exploitation (pompage, traitement, épuration, entretien des canalisations). */
  expenses: number;
  /** Détail par poste. */
  lines: Record<string, number>;
}

/** Géométrie des canalisations (une entrée par tronçon de route ; eau et égouts suivent la voirie). */
export interface PipeGeometry {
  /** Identifiant de tronçon (= segment routier). */
  ids: Int32Array;
  /** Décalage de début de chaque tronçon dans `points` (en nombre de points), longueur ids.length + 1. */
  offsets: Int32Array;
  /** Points x, z successifs (polyligne du tracé). */
  points: Float32Array;
}

/** État du réseau par tronçon et par bâtiment (couleurs de la vue « eau »). */
export interface WaterLayerState {
  /** Par tronçon (même ordre que PipeGeometry.ids) : charge eau 0..1+, pression (bar), charge égouts 0..1+, alimenté (0/1). */
  pipeLoad: Float32Array;
  pipePressure: Float32Array;
  sewerLoad: Float32Array;
  pipeFed: Uint8Array;
  /** Par bâtiment desservable : id, x, z, part servie (0..1), qualité (0..1), raccordé égout (0/1). */
  buildingIds: Int32Array;
  buildingXZ: Float32Array;
  buildingServed: Float32Array;
  buildingQuality: Float32Array;
  buildingSewer: Uint8Array;
}

/** Cellules en eau et leur pollution (calque « pollution » de la vue eau). */
export interface RiverLayer {
  /** Géométrie de la grille municipale. */
  originX: number;
  originZ: number;
  cellSize: number;
  cols: number;
  /** Index des cellules en eau (j·cols + i). */
  cells: Int32Array;
  /** Indice de pollution (0..100) de chaque cellule de `cells`. */
  pollution: Float32Array;
  /** Index de la cellule aval (-1 = exutoire), pour dessiner le sens d'écoulement. */
  downstream: Int32Array;
}
