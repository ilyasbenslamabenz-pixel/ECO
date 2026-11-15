/**
 * Module « bus » (vague 3 : transports en commun tracés par le joueur) — types partagés simulation / rendu / interface.
 * Lignes de bus : arrêts posés sur les routes, boucle par le plus court chemin, dépôt requis, fréquence = nombre de bus,
 * tarif, fréquentation par ligne et par arrêt, charge, recettes et coûts, carte de couverture (400 m de marche).
 * Mécaniques inspirées des city-builders modernes ; formules, textes et valeurs propres au jeu.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */

export const BUS_PLUGIN = 'bus';
/** Version des charges utiles `delta.ext.bus` / `snapshot.ext.bus`. */
export const BUS_EXT_VERSION = 1;
/** Étiquette du catalogue d'un dépôt de bus (et capacité `bus:N`). */
export const BUS_DEPOT_TAG = 'depot_bus';
/** Limites d'édition. */
export const BUS_MAX_LINES = 32;
export const BUS_MAX_STOPS_PER_LINE = 40;
export const BUS_MAX_BUSES_PER_LINE = 40;
export const BUS_FARE_MAX = 5;
/** Rayon de couverture d'un arrêt (m de marche). */
export const BUS_WALK_COVER_M = 400;

/** Palette proposée (couleurs franches, lisibles sur le terrain de jour comme de nuit). */
export const BUS_COLORS: readonly string[] = ['#e5484d', '#2f81f7', '#30a46c', '#f5a524', '#8e4ec6', '#12a594', '#e93d82', '#6e56cf', '#ff8b3e', '#3e63dd'];

/** Réglages du modèle (valeurs du jeu, non sauvegardées). */
export interface BusTuning {
  /** Passagers par bus. */
  busCapacity: number;
  /** Vitesse commerciale sans encombrement (km/h, arrêts non compris). */
  busSpeedKmh: number;
  /** Arrêt à chaque station (s). */
  dwellS: number;
  /** Marche : vitesse (m/min) et détour par rapport à la ligne droite. */
  walkMPerMin: number;
  walkDetour: number;
  /** Voiture : détour, temps d'accès et de stationnement (min), coût au km et stationnement (CHF par trajet). */
  carDetour: number;
  carAccessMin: number;
  carCostPerKm: number;
  carParkingChf: number;
  /** Vitesse voiture de référence (km/h) quand le trafic est fluide, plancher en cas de bouchon. */
  carFreeKmh: number;
  carMinKmh: number;
  /** Valeur du temps (CHF par minute) et sensibilité du choix (logit, par CHF). */
  valueOfTimeChf: number;
  logitScale: number;
  /** Préférence propre à la voiture (CHF, confort). */
  carBonusChf: number;
  /** Attente plafonnée (min). */
  maxWaitMin: number;
  /** Part des voyages d'une journée dans l'heure de pointe (charge). */
  peakShare: number;
  /** Coût d'entretien d'un bus en service (CHF par mois) ; coût d'un nouvel arrêt (CHF, abribus du catalogue). */
  busUpkeepMonth: number;
  stopCost: number;
  /** Bus par dépôt sans étiquette `bus:N`. */
  depotDefaultCapacity: number;
  /** Portée supplémentaire de la recherche d'emploi pour un logement bien desservi (m). */
  jobReachBonusM: number;
  /** Satisfaction maximale apportée par une bonne desserte (points). */
  satisfactionBonus: number;
}

export const DEFAULT_BUS_TUNING: BusTuning = {
  busCapacity: 60,
  busSpeedKmh: 22,
  dwellS: 20,
  walkMPerMin: 75,
  walkDetour: 1.25,
  carDetour: 1.3,
  carAccessMin: 4,
  carCostPerKm: 0.3,
  carParkingChf: 1,
  carFreeKmh: 38,
  carMinKmh: 6,
  valueOfTimeChf: 0.25,
  logitScale: 0.55,
  carBonusChf: 0.6,
  maxWaitMin: 30,
  peakShare: 0.16,
  busUpkeepMonth: 1600,
  stopCost: 600,
  depotDefaultCapacity: 20,
  jobReachBonusM: 3000,
  satisfactionBonus: 4,
};

/** Arrêt tel que vu par le rendu et l'interface. */
export interface BusStopView {
  id: number;
  lineId: number;
  name: string;
  x: number;
  y: number;
  z: number;
  /** Arrêt raccordé à une route où un bus peut passer. */
  ok: boolean;
  /** Abscisse de l'arrêt le long du tracé de la ligne (m). */
  s: number;
  /** Montées / descentes par jour (moyenne attendue du dernier jour calculé). */
  boardings: number;
  alightings: number;
}

/** Problème bloquant d'une ligne (texte joueur) ; null si la ligne roule. */
export type BusLineProblem = string | null;

export interface BusLineStats {
  /** Voyages par jour (dernier jour). */
  ridersDay: number;
  /** Charge à l'heure de pointe sur le tronçon le plus chargé (0..1+, 1 = bus pleins). */
  load: number;
  /** Recettes et coût du mois en cours et du mois précédent (CHF). */
  revenueMonth: number;
  costMonth: number;
  revenueLastMonth: number;
  costLastMonth: number;
  /** Demande refusée faute de place (voyages par jour). */
  refusedDay: number;
}

export interface BusLineView {
  id: number;
  name: string;
  color: string;
  /** Bus demandés par le joueur ; bus réellement en service (dépôts). */
  buses: number;
  activeBuses: number;
  fare: number;
  stopIds: number[];
  /** Longueur de la boucle (m), durée d'un tour (min), intervalle entre deux bus (min ; 0 si la ligne ne roule pas). */
  lengthM: number;
  cycleMin: number;
  headwayMin: number;
  problem: BusLineProblem;
  stats: BusLineStats;
}

/** Géométrie d'une ligne pour le rendu : polyligne x, y, z (décalée sur la voie de droite) et abscisses cumulées. */
export interface BusLineGeometry {
  id: number;
  color: string;
  points: number[];
  cum: number[];
  /** Abscisses des arrêts (m) le long du tracé. */
  stopS: number[];
  activeBuses: number;
  /** Vitesse des bus (m/s de temps physique) et arrêt aux stations (s). */
  speed: number;
  dwellS: number;
}

export interface BusModalSplit { car: number; walk: number; bus: number }

export interface BusSummary {
  lines: number;
  stops: number;
  depots: number;
  depotCapacity: number;
  busesRequested: number;
  busesActive: number;
  /** Parts modales des trajets domicile-travail / école (dernier jour). */
  modal: BusModalSplit;
  /** Parts sans bus (référence) : la voiture y vaut 1 / facteur. */
  modalWithoutBus: BusModalSplit;
  /** Facteur appliqué à la demande automobile du trafic (1 = aucun effet). */
  carFactor: number;
  ridersDay: number;
  revenueMonth: number;
  costMonth: number;
  revenueLastMonth: number;
  costLastMonth: number;
  /** Habitants à moins de 400 m de marche d'un arrêt en service. */
  coveredResidents: number;
  coveredJobs: number;
  population: number;
  /** Recherches d'emploi infructueuses hier faute d'emploi accessible (démographie). */
  noReach: number;
  /** Embauches rendues possibles par le bus (portée étendue) ce mois. */
  transitHiresMonth: number;
  /** Durée du dernier calcul quotidien (ms, diagnostic). */
  costMs: number;
}

export interface BusState { summary: BusSummary; lines: BusLineView[]; stops: BusStopView[] }

/** Carte « Transports en commun » : grille de cellules (valeur 0 = non desservi, 1..255 = qualité de desserte). */
export interface BusLayer {
  originX: number;
  originZ: number;
  cellSize: number;
  cols: number;
  rows: number;
  quality: Uint8Array;
}

/** Charge utile `delta.ext.bus` (structure à chaque changement, temps physique ≈ 1 fois par seconde réelle). */
export interface BusDelta {
  version: number;
  /** Lignes et arrêts (remplacent tout l'affichage quand présents). */
  lines?: BusLineView[];
  stops?: BusStopView[];
  geometry?: BusLineGeometry[];
  /** Temps physique de la simulation (s : 0,1 s par minute de jeu, comme le trafic) et vitesse de jeu. */
  phys: number;
  speed: number;
  layer?: BusLayer | null;
}

/** Fiche d'arrêt (commande `stop`). */
export interface BusStopCard {
  stop: BusStopView;
  lineName: string;
  lineColor: string;
  headwayMin: number;
  residentsCovered: number;
  jobsCovered: number;
  /** Rang dans la ligne (1..n) et nombre d'arrêts. */
  index: number;
  count: number;
}

/** Ligne sérialisée (sauvegarde, annulation d'une suppression). */
export interface BusLineRecord {
  id: number;
  name: string;
  color: string;
  buses: number;
  fare: number;
  stops: { id: number; x: number; z: number; name: string }[];
}
