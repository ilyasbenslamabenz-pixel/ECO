/**
 * Module « connexions » : connexions extérieures (points d'entrée en bord de carte) — types partagés simulation / rendu /
 * interface. Une route du joueur qui aboutit au bord de la carte (impasse à moins de 60 m du bord) relie la ville au
 * reste du pays : trafic entrant et sortant (navetteurs, visiteurs, poids lourds), import et export de marchandises
 * (droits perçus par la ville), migrants qui arrivent par là. Mécaniques inspirées des city-builders modernes ;
 * formules, textes et valeurs propres au jeu.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */

export const CONNEXIONS_PLUGIN = 'connexions';
export const CONNEXIONS_EXT_VERSION = 1;
/** Distance maximale entre l'extrémité d'une route et le bord de la carte (m) ; le tracé s'arrête à 24 m du bord. */
export const CONNEXION_EDGE_M = 60;

export type ConnexionKind = 'autoroute' | 'route';

/** Réglages du modèle (valeurs du jeu, non sauvegardées). */
export interface ConnexionsTuning {
  /** Production exportable : tonnes par emploi industriel occupé et par jour ; tertiaire (bureaux, commerces). */
  industryTPerWorkerDay: number;
  officeTPerWorkerDay: number;
  /** Consommation : tonnes par habitant et par jour, par emploi commercial (stocks des commerces). */
  residentTPerDay: number;
  shopTPerWorkerDay: number;
  /** Droits perçus par la ville (CHF par tonne exportée, importée). */
  exportDutyChfPerT: number;
  importDutyChfPerT: number;
  /** Valeur marchande moyenne (CHF par tonne) : balance commerciale affichée. */
  exportValueChfPerT: number;
  importValueChfPerT: number;
  /** Capacité d'une connexion (tonnes par jour) : au-delà, le surplus reste en ville (invendu) ou manque. */
  roadCapacityT: number;
  highwayCapacityT: number;
  /** Part des trajets générés par le trafic qui passent par une connexion (par connexion, plafond). */
  roadTripShare: number;
  highwayTripShare: number;
  maxTripShare: number;
  /** Bonus d'immigration : par connexion reliée (plafond). */
  immigrationBonusRoad: number;
  immigrationBonusHighway: number;
  immigrationBonusMax: number;
}

export const DEFAULT_CONNEXIONS_TUNING: ConnexionsTuning = {
  industryTPerWorkerDay: 0.06,
  officeTPerWorkerDay: 0.004,
  residentTPerDay: 0.004,
  shopTPerWorkerDay: 0.03,
  exportDutyChfPerT: 3,
  importDutyChfPerT: 1.5,
  exportValueChfPerT: 240,
  importValueChfPerT: 280,
  roadCapacityT: 400,
  highwayCapacityT: 2500,
  roadTripShare: 0.03,
  highwayTripShare: 0.06,
  maxTripShare: 0.18,
  immigrationBonusRoad: 0.05,
  immigrationBonusHighway: 0.12,
  immigrationBonusMax: 0.25,
};

/** Connexion telle que vue par l'interface et le rendu. */
export interface ConnexionView {
  id: number;
  name: string;
  kind: ConnexionKind;
  /** Extrémité de la route au bord (x, y, z) et direction vers l'extérieur (unitaire). */
  x: number;
  y: number;
  z: number;
  dirX: number;
  dirZ: number;
  /** Côté de la carte. */
  side: 'nord' | 'sud' | 'est' | 'ouest';
  /** Reliée à au moins un bâtiment desservi par la route. */
  linked: boolean;
  /** Dernier jour : véhicules entrés / sortis, tonnes importées / exportées, migrants arrivés. */
  inDay: number;
  outDay: number;
  importT: number;
  exportT: number;
  migrantsDay: number;
}

export interface ConnexionsSummary {
  connexions: number;
  linked: number;
  /** Dernier jour : marchandises (t), droits perçus (CHF), valeur des échanges (CHF). */
  productionT: number;
  consumptionT: number;
  localT: number;
  exportT: number;
  importT: number;
  /** Surplus invendu / manque faute de capacité ou de connexion (t). */
  unsoldT: number;
  shortageT: number;
  dutiesDay: number;
  tradeBalanceDay: number;
  /** Véhicules entrés / sortis hier, dont poids lourds. */
  vehiclesInDay: number;
  vehiclesOutDay: number;
  trucksDay: number;
  /** Part des trajets passant par une connexion, bonus d'immigration appliqué. */
  tripShare: number;
  immigrationBonus: number;
  /** Mois en cours et précédent : migrants arrivés par une connexion, droits perçus. */
  migrantsMonth: number;
  dutiesMonth: number;
  migrantsLastMonth: number;
  dutiesLastMonth: number;
}

export interface ConnexionsState { summary: ConnexionsSummary; connexions: ConnexionView[] }

/** Charge utile `delta.ext.connexions` (à chaque changement des connexions ou des comptes du jour). */
export interface ConnexionsDelta {
  version: number;
  connexions: ConnexionView[];
}
