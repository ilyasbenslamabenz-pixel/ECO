/**
 * Électricité (phase 2B, sous-étape 4) — types et constantes partagés simulation <-> rendu <-> interface.
 * Propriété de la branche p2b-electricite. TypeScript pur : AUCUN import de three ni du DOM.
 *
 * Unités : puissances en kW (le panneau affiche MW), énergies en kWh, distances en m, montants en centimes (¢).
 */

/** Identifiant du module (clé de `delta.ext`, `snapshot.ext`, `save.plugins`, `pluginCommand.plugin`). */
export const ELECTRICITE_ID = 'electricite';
/** Service inter-modules publié par la simulation (`ctx.use<ElectriciteService>(ELECTRICITE_SERVICE)`). */
export const ELECTRICITE_SERVICE = 'electricite';
/** Nom du réseau dans le contrat municipal (`m.networks.get(...)`). */
export const ELECTRICITE_NETWORK = 'electricite';
/** Modules ajoutés aux registres en plus de PHASE2_MODULES (src/shared/protocol-ext). */
export const ELECTRICITE_MODULES = [ELECTRICITE_ID] as const;

/** Types d'installations électriques (centrales + poste de transformation). */
export type PlantType = 'thermique' | 'eolien' | 'solaire' | 'hydro';
export const PLANT_TYPES: readonly PlantType[] = ['thermique', 'eolien', 'solaire', 'hydro'];
export type FacilityKind = PlantType | 'poste';

/** Source de production (les toitures solaires s'ajoutent aux centrales). */
export type SourceId = PlantType | 'toitures';
export const SOURCE_IDS: readonly SourceId[] = ['thermique', 'eolien', 'solaire', 'hydro', 'toitures'];
export const SOURCE_LABELS_FR: Record<SourceId, string> = {
  thermique: 'Thermique (gaz)', eolien: 'Éolien', solaire: 'Solaire (fermes)', hydro: 'Hydroélectrique', toitures: 'Solaire (toitures)',
};

/** Classes de consommateurs, délestées de la moins prioritaire à la plus prioritaire. */
export type ConsumerClass = 'sante' | 'services' | 'residentiel' | 'commerce' | 'industrie';
export const CONSUMER_CLASSES: readonly ConsumerClass[] = ['sante', 'services', 'residentiel', 'commerce', 'industrie'];
export const CLASS_LABELS_FR: Record<ConsumerClass, string> = {
  sante: 'Hôpitaux', services: 'Services publics', residentiel: 'Résidentiel', commerce: 'Commerces et bureaux', industrie: 'Industrie',
};
/** Ordre de priorité par défaut (le premier est servi en premier, le dernier coupé en premier). */
export const DEFAULT_PRIORITY_ORDER: readonly ConsumerClass[] = ['sante', 'services', 'residentiel', 'commerce', 'industrie'];

/** Bornes du financement de l'entretien (part du besoin nominal). */
export const FUNDING_MIN = 0.25;
export const FUNDING_MAX = 1.5;

/** Préfixe des étiquettes de catalogue qui désignent une installation électrique (`elec:centrale:eolien`, `elec:poste`). */
export const TAG_PLANT_PREFIX = 'elec:centrale:';
export const TAG_SUBSTATION = 'elec:poste';
/** Puissance nominale facultative inscrite au catalogue (`elec:kw:50000`). */
export const TAG_KW_PREFIX = 'elec:kw:';

/** Code d'état d'une cellule du calque « réseau électrique » (`ElectriciteCoverage.cells`). */
export const COVER_NONE = 0;      // aucun bâtiment consommateur
export const COVER_OK = 1;        // tous les bâtiments alimentés
export const COVER_PARTIAL = 2;   // une partie des bâtiments coupés
export const COVER_CUT = 3;       // tous coupés (délestage ou panne)
export const COVER_UNLINKED = 4;  // bâtiments hors de portée de tout poste / centrale

/** Installation (centrale ou poste) telle que vue par le rendu et l'interface. */
export interface FacilityView {
  /** Identifiant du bâtiment (simulation de base). */
  id: number;
  kind: FacilityKind;
  nameFr: string;
  x: number;
  y: number;
  z: number;
  /** Rotation (quarts de tour, convention du protocole). */
  rot: number;
  /** Puissance disponible cette heure (kW, 0 en panne) et puissance nominale. */
  availableKw: number;
  nominalKw: number;
  /** Production appelée par la répartition (kW). */
  outputKw: number;
  /** En panne jusqu'à cette minute de jeu (0 = en service). */
  failedUntil: number;
  /** Site valide (barrage : au bord d'un cours d'eau). */
  siteOk: boolean;
  /** Relié (directement ou par lignes) à au moins une centrale en service. */
  energized: boolean;
  /** Rayon de distribution locale (m). */
  radius: number;
}

/** Ligne haute tension (entre deux installations). */
export interface LineView {
  id: number;
  a: number;
  b: number;
  ax: number; az: number; bx: number; bz: number;
  lengthM: number;
  capacityKw: number;
  /** Charge (0..1) à la dernière répartition. */
  load: number;
  failedUntil: number;
}

/** Bilan par source (kW). */
export interface SourceBalance {
  source: SourceId;
  nominalKw: number;
  availableKw: number;
  outputKw: number;
  count: number;
}

/** Bilan par classe de consommateurs. */
export interface ClassBalance {
  cls: ConsumerClass;
  priority: number;
  demandKw: number;
  deliveredKw: number;
  buildings: number;
  cut: number;
  unlinked: number;
}

/** Bilan d'une heure de jeu. */
export interface ElectriciteSummary {
  /** Minute de jeu de la dernière répartition. */
  at: number;
  hour: number;
  /** Capacité disponible (kW), production appelée (kW), demande (kW), livré (kW), pertes en ligne (kW). */
  availableKw: number;
  producedKw: number;
  demandKw: number;
  deliveredKw: number;
  lossesKw: number;
  /** Demande non servie faute de production ou de capacité de réseau (kW, hors bâtiments non raccordés). */
  shortfallKw: number;
  /** Demande des bâtiments hors de portée du réseau (kW). */
  unlinkedKw: number;
  /** Surplus exportable : capacité disponible non appelée (kW) — valeur publiée pour les exportations (2B). */
  exportableKw: number;
  /** Vent (m/s) et ensoleillement (0..1) utilisés cette heure ; `windSource` = météo, profil ou forçage. */
  windMs: number;
  windSource: 'meteo' | 'profil' | 'force';
  sun: number;
  bySource: SourceBalance[];
  byClass: ClassBalance[];
  /** Bâtiments consommateurs, alimentés, coupés, non raccordés. */
  buildings: number;
  powered: number;
  cut: number;
  unlinked: number;
  /** Emplois et habitants dans des bâtiments sans courant. */
  jobsWithoutPower: number;
  residentsWithoutPower: number;
}

/** Réglages du joueur. */
export interface ElectriciteSettings {
  /** Financement de l'entretien (1 = 100 %). */
  funding: number;
  /** Ordre de priorité des classes (servie en premier -> coupée en premier). */
  priorities: ConsumerClass[];
  /** Programme de toitures solaires (installation progressive sur les logements). */
  rooftops: boolean;
}

/** Bilan budgétaire mensuel du service (¢). */
export interface ElectriciteBudget {
  /** Entretien mensuel nominal des lignes et du réseau (avant financement) et dépense réelle (après). */
  upkeepNominal: number;
  upkeepActual: number;
  /** Entretien des centrales et postes facturé par la simulation de base (catalogue). */
  facilitiesUpkeep: number;
  /** Recettes du mois passé (vente d'électricité). */
  lastIncome: number;
  lastExpense: number;
  /** Investissements cumulés (lignes, toitures). */
  investments: number;
  /** Énergie du mois en cours (kWh) : produite, livrée, délestée. */
  monthProducedKwh: number;
  monthDeliveredKwh: number;
  monthShedKwh: number;
  /** Pannes du mois en cours et du mois passé. */
  monthFailures: number;
  lastMonthFailures: number;
}

/** Panne ou événement récent (journal du panneau). */
export interface ElectriciteEvent {
  at: number;
  kind: 'panne' | 'reparation' | 'penurie' | 'fin_penurie' | 'ligne' | 'reglage' | 'site';
  message: string;
  ref?: number;
}

/** Calque « réseau électrique » : un code par cellule de la grille municipale (`COVER_*`). */
export interface ElectriciteCoverage {
  originX: number;
  originZ: number;
  cellSize: number;
  cols: number;
  rows: number;
  cells: Uint8Array;
  version: number;
}

/** Charge utile de `delta.ext.electricite` (envoyée quand quelque chose a changé). */
export interface ElectriciteDelta {
  summary?: ElectriciteSummary;
  facilities?: FacilityView[];
  lines?: LineView[];
  settings?: ElectriciteSettings;
  budget?: ElectriciteBudget;
  events?: ElectriciteEvent[];
  coverage?: ElectriciteCoverage;
  /** Bâtiments coupés (identifiants, triés). */
  cutIds?: number[];
  /** Mode d'hébergement du contrat municipal : `service` (module `municipal` enregistré) ou `integre`. */
  municipal?: 'service' | 'integre';
}

/** Charge utile de `snapshot.ext.electricite` : état complet. */
export type ElectriciteSnapshot = ElectriciteDelta;

/** Commandes `pluginCommand { plugin: 'electricite', name, payload }`. */
export interface ElectriciteCommands {
  /** État complet (mêmes champs que l'instantané). */
  state: { payload: undefined; result: ElectriciteSnapshot };
  /** Construit une ligne HT entre deux installations (identifiants de bâtiments). */
  buildLine: { payload: { a: number; b: number }; result: { line: LineView; cost: number } };
  /** Démolit une ligne. */
  removeLine: { payload: { id: number }; result: { removed: boolean } };
  /** Relie une installation à l'installation alimentée la plus proche (ligne au plus court). */
  autoConnect: { payload: { id: number }; result: { line: LineView; cost: number } };
  /** Devis d'une ligne (sans la construire). */
  quoteLine: { payload: { a: number; b: number }; result: { lengthM: number; cost: number; upkeepPerMonth: number } };
  /** Financement de l'entretien (0,25..1,5). */
  setFunding: { payload: { funding: number }; result: ElectriciteSettings };
  /** Ordre de priorité des classes (permutation de CONSUMER_CLASSES). */
  setPriorities: { payload: { order: ConsumerClass[] }; result: ElectriciteSettings };
  /** Programme de toitures solaires. */
  setRooftops: { payload: { enabled: boolean }; result: ElectriciteSettings };
  /** Forçage du vent (m/s) pour démonstration et tests ; `null` rend la météo / le profil. */
  forceWind: { payload: { ms: number | null }; result: { windMs: number } };
  /** Vérifie un site (barrage au bord de l'eau) avant de construire. */
  checkSite: { payload: { kind: FacilityKind; x: number; z: number; rot?: number }; result: { ok: boolean; reason: string; wetShare: number } };
  /** Recalcule la répartition immédiatement (sans tirage de pannes). */
  refresh: { payload: undefined; result: ElectriciteSummary };
  /** Effets électriques récents du registre municipal. */
  effects: { payload: { limit?: number }; result: unknown[] };
}

/** API publiée aux autres modules de simulation (service `electricite`). */
export interface ElectriciteService {
  /** Part de la demande servie pour un bâtiment (1 alimenté, 0 coupé ou non raccordé ; 1 si inconnu). */
  powerFactor(buildingId: number): number;
  /** Vrai si le bâtiment est alimenté (ou non consommateur). */
  isPowered(buildingId: number): boolean;
  /** Surplus exportable (kW) à la dernière répartition — pour le module des exportations (2B). */
  exportableKw(): number;
  /** Dernier bilan horaire (undefined avant la première répartition). */
  summary(): ElectriciteSummary | undefined;
}

/** Accès souple au module météo (phase 2C) s'il publie un service `weather` : vent (m/s) et nébulosité (0..1). */
export interface WeatherLike {
  wind?: number;
  cloud?: number;
  state?: () => { wind?: number; cloud?: number } | undefined;
}
export const WEATHER_SERVICE = 'weather';
