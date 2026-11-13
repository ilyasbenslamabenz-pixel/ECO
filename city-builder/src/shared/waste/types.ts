/**
 * Déchets (phase 2B.6) — types et paramètres partagés par la simulation, le rendu et le panneau.
 * Propriété de la branche p2b-dechets. TypeScript pur : AUCUN import de three ni du DOM.
 *
 * Unités : masses en kg, durées en minutes de jeu, montants en centimes (¢, unité interne de l'économie).
 */

/** Rôle d'une installation de traitement, lu dans les étiquettes du catalogue (`dechets:<rôle>`). */
export type WasteFacilityKind = 'depot' | 'tri' | 'incinerateur' | 'decharge';
export const WASTE_FACILITY_KINDS: readonly WasteFacilityKind[] = ['depot', 'tri', 'incinerateur', 'decharge'];

export const WASTE_FACILITY_FR: Record<WasteFacilityKind, string> = {
  depot: 'Dépôt de camions-bennes',
  tri: 'Centre de tri',
  incinerateur: 'Incinérateur',
  decharge: 'Décharge',
};

/** Réglages du joueur. */
export interface WasteSettings {
  /** Passages de collecte par semaine (1..7). */
  collectsPerWeek: number;
  /** Part des déchets triés à la source (0..0,8) : collectée à part et envoyée au centre de tri. */
  sortShare: number;
  /** Financement du service (0..1) : part de la flotte de camions mise en service (et payée). */
  funding: number;
}

export const DEFAULT_WASTE_SETTINGS: Readonly<WasteSettings> = { collectsPerWeek: 3, sortShare: 0.25, funding: 1 };
export const WASTE_SETTINGS_LIMITS = {
  collectsPerWeek: [1, 7],
  sortShare: [0, 0.8],
  funding: [0, 1],
} as const;

/** Jours de collecte (0 = lundi) selon le nombre de passages hebdomadaires. */
export const COLLECTION_DAYS: Readonly<Record<number, readonly number[]>> = {
  1: [0], 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 3, 4], 6: [0, 1, 2, 3, 4, 5], 7: [0, 1, 2, 3, 4, 5, 6],
};

/** Paramètres du modèle (valeurs d'ordre de grandeur européen, documentées dans docs/DECHETS.md). */
export const WASTE_PARAMS = {
  /** Production des ménages : kg / habitant / jour. */
  kgPerResident: 1.2,
  /** Production des activités : kg / emploi / jour, par catégorie du catalogue. */
  kgPerJob: { commercial: 1.0, industrial: 2.5, public: 0.6, skyscraper: 0.5, apartment_mid: 0.8, apartment_high: 0.8 } as Record<string, number>,
  kgPerJobDefault: 0.6,
  /** Stockage local (bacs) : jours de production tenus, minimum en kg. */
  storageDays: 4,
  storageMinKg: 30,
  /** Camion-benne : charge utile (kg), coût de fonctionnement mensuel (¢, salaires + carburant + entretien). */
  truckCapacityKg: 8000,
  truckCostPerMonth: 1800,
  /** Tournée : départ du dépôt (minute du jour), durée maximale (min), service par arrêt, vidage. */
  departureMinute: 6 * 60,
  shiftMinutes: 7 * 60,
  serviceMinutesPerStop: 1,
  /** Chargement des bacs : minutes par 100 kg levés (bacs de 660 L ≈ 60–80 kg, ~45 s chacun). */
  serviceMinutesPer100Kg: 0.8,
  unloadMinutes: 15,
  /** Vidages au plus par tournée (pratique des équipages : 2 rotations par service). */
  maxTripsPerShift: 2,
  /** Vitesse commerciale d'un camion-benne (km/h) : bornée par la vitesse de la voie. */
  truckSpeedKmh: 18,
  /** Arrêt de collecte minimal (kg en stock pour justifier un arrêt). */
  minStopKg: 20,
  /** Valorisation : part récupérée au centre de tri, prix de reprise (¢/t), énergie (MWh/t), prix (¢/MWh). */
  sortRecoveryRate: 0.7,
  recyclePricePerTonne: 60,
  incinerationMWhPerTonne: 0.55,
  energyPricePerMWh: 45,
  /** Pollution (indice des grilles municipales) par tonne. */
  airPerTonneBurned: 0.9,
  soilPerTonneLandfilled: 0.06,
  waterPerTonneLandfilled: 0.03,
  soilPerTonneUncollected: 40,
  nuisancePerTonneUncollected: 400,
  soilPerTonneOverflow: 0.5,
  waterPerTonneOverflow: 0.25,
  nuisancePerTonneOverflow: 6,
  /** Effet des nuisances (indice 0..100) : satisfaction et valeur foncière (décalage par point de nuisance). */
  satisfactionPerNuisance: -0.25,
  landValuePerNuisance: -0.3,
} as const;

/** Installation (état public). */
export interface WasteFacilityInfo {
  buildingId: number;
  kind: WasteFacilityKind;
  x: number;
  z: number;
  /** Orientation du bâtiment (rad, comme `Object3D.rotation.y`). */
  rot: number;
  /** Desservie par la route (accès trouvé sur le réseau des camions). */
  connected: boolean;
  /** Dépôt : camions ; autres : capacité journalière (kg/j) ; décharge : capacité totale (kg). */
  capacity: number;
  /** Décharge : masse enfouie (kg). Tri / incinérateur : masse traitée la veille (kg). */
  amount: number;
}

/** Statistiques journalières (dernier jour clos) et cumuls. */
export interface WasteDayStats {
  day: number;
  producedKg: number;
  collectedKg: number;
  /** Déchets qui débordent des bacs (non collectés à temps). */
  uncollectedKg: number;
  sortedKg: number;
  recycledKg: number;
  burnedKg: number;
  landfilledKg: number;
  /** Déchets refusés faute de capacité (décharge pleine / aucune filière) et déversés autour. */
  overflowKg: number;
  energyMWh: number;
  tours: number;
  stops: number;
}

export interface WasteTotals {
  producedKg: number;
  collectedKg: number;
  uncollectedKg: number;
  recycledKg: number;
  burnedKg: number;
  landfilledKg: number;
  overflowKg: number;
  energyMWh: number;
  tours: number;
  /** Recettes (¢) : reprise des matériaux, vente d'énergie. Dépenses (¢) : exploitation des camions. */
  incomeRecycling: number;
  incomeEnergy: number;
  expenseTrucks: number;
}

/** Synthèse envoyée au rendu et au panneau. */
export interface WasteSummary {
  settings: WasteSettings;
  /** Stock total en attente dans les bacs (kg) et capacité totale des bacs. */
  storedKg: number;
  storageKg: number;
  /** Bâtiments dont les bacs débordent. */
  overflowingBuildings: number;
  producers: number;
  /** Production courante (kg/j). */
  productionPerDay: number;
  fleet: number;
  activeTrucks: number;
  trucksOnRoad: number;
  /** Bilan du dernier mois budgétaire (¢) et budget mensuel prévu. */
  monthlyBudget: number;
  facilities: WasteFacilityInfo[];
  lastDay: WasteDayStats | null;
  totals: WasteTotals;
  /** Pollution moyenne / max (grilles municipales) et nuisance. */
  pollution: { air: number; soil: number; water: number; nuisance: number; airMax: number; soilMax: number; nuisanceMax: number };
  /** Raison pour laquelle la collecte ne fonctionne pas (null si elle fonctionne). */
  blocked: string | null;
  /** Prochain jour de collecte (index de jour). */
  nextCollectionDay: number;
}

/** Valeur bornée d'un réglage. */
export function clampSetting(key: keyof WasteSettings, v: number): number {
  const [lo, hi] = WASTE_SETTINGS_LIMITS[key];
  if (!Number.isFinite(v)) return DEFAULT_WASTE_SETTINGS[key];
  const c = Math.min(hi, Math.max(lo, v));
  return key === 'collectsPerWeek' ? Math.round(c) : c;
}

/** Rôle d'installation d'un modèle d'après ses étiquettes (`dechets:depot`…), null sinon. */
export function facilityKindOfTags(tags: readonly string[] | undefined): WasteFacilityKind | null {
  if (!tags) return null;
  for (const t of tags) {
    if (!t.startsWith('dechets:')) continue;
    const k = t.slice(8) as WasteFacilityKind;
    if (WASTE_FACILITY_KINDS.includes(k)) return k;
  }
  return null;
}

/** Valeur numérique d'une étiquette `nom:valeur` (undefined si absente). */
export function tagNumber(tags: readonly string[] | undefined, name: string): number | undefined {
  if (!tags) return undefined;
  const p = `${name}:`;
  for (const t of tags) if (t.startsWith(p)) { const v = Number(t.slice(p.length)); if (Number.isFinite(v)) return v; }
  return undefined;
}

/** Capacité par défaut d'une installation (si l'étiquette manque). */
export const DEFAULT_FACILITY_CAPACITY: Record<WasteFacilityKind, number> = {
  depot: 4, tri: 30_000, incinerateur: 60_000, decharge: 25_000_000,
};

/**
 * Repères des modèles d'installations (repère local du modèle, façade vers +Z, origine au centre de l'emprise),
 * partagés par le générateur (tools/waste) et le rendu (src/render/waste).
 */
export const WASTE_MODEL_IDS = {
  depot: 'dechets_depot_camions',
  tri: 'dechets_centre_tri',
  incinerateur: 'dechets_incinerateur',
  decharge: 'dechets_decharge',
  conteneurs: 'dechets_conteneurs_tri',
  tumulus: 'dechets_tumulus',
  camion: 'vehicule_benne_ordures',
} as const;

export const WASTE_MODEL_ANCHORS = {
  /** Sommet de la cheminée de l'incinérateur (x, y, z). */
  chimneyTop: [9, 46, -6] as const,
  /** Casier de la décharge : centre (x, z) et taille du tumulus à 100 % (largeur, profondeur, hauteur). */
  moundCenter: [0, -5] as const,
  moundSize: [50, 42, 14] as const,
};
