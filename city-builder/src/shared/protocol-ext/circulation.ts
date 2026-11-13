/**
 * Extension du protocole propre au module « Circulation » — propriété de la branche p2a-circulation.
 * Rétrocompatible par construction : ces données circulent dans `delta.ext.circulation`, `snapshot.ext.circulation`
 * et la commande générique `pluginCommand { plugin: 'circulation', name, payload }` (src/shared/protocol.ts).
 * Un client qui ignore le module ignore simplement ces clés.
 *
 * Ce fichier porte aussi les types de l'**API des feux** publiée par la simulation du trafic sous le nom de
 * service « feux » (`ctx.provide('feux', api)`), que le module piétons consomme par `ctx.use<FeuxApi>('feux')`.
 * Voir docs/CIRCULATION.md.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */

/* -------------------------------------------------------------------------- */
/* API des feux (service « feux »)                                             */
/* -------------------------------------------------------------------------- */

/** Nom du service inter-modules publié par la circulation. */
export const FEUX_SERVICE = 'feux';

/** États d'un feu : vert, orange (dégagement), rouge. Mêmes valeurs pour les véhicules et les piétons. */
export const FEU_VERT = 0, FEU_ORANGE = 1, FEU_ROUGE = 2;
export type FeuState = 0 | 1 | 2;

/**
 * État d'un passage piéton (une traversée par BRAS de carrefour : elle coupe la chaussée de ce bras,
 * entre la ligne d'arrêt et le cœur du carrefour, au même endroit que le marquage peint par le rendu).
 */
export interface CrossingState {
  /** Identifiant stable : `idTronçon × 2 + (0 extrémité a | 1 extrémité b)`. */
  id: number;
  /** Identifiant du nœud (carrefour) du monde. */
  junctionId: number;
  /** Feu PIÉTON : vert (traverser), orange (dégager, ne plus s'engager), rouge (attendre). */
  walk: FeuState;
  /** Temps restant (s) dans l'état courant ; 0 quand le carrefour n'est pas régulé. */
  remaining: number;
  /** Feu VÉHICULES du bras entrant (−1 : bras sans feu ou sans voie entrante). */
  vehicle: FeuState | -1;
  /** Faux : carrefour sans feux — les piétons traversent prudemment (`walk` vaut alors toujours vert). */
  controlled: boolean;
  /** Centre du passage (coordonnées monde, y = surface de la chaussée). */
  x: number; y: number; z: number;
  /** Extrémités du passage sur les bordures : a = gauche, b = droite dans le sens qui SORT du carrefour. */
  ax: number; az: number; bx: number; bz: number;
  /** Largeur de chaussée traversée (m). */
  widthM: number;
}

/** État d'un bras (voie d'arrivée régulée) d'un carrefour. */
export interface FeuArmState {
  /** Index du bras dans le carrefour (stable tant que le réseau ne change pas). */
  arm: number;
  /** Feu véhicules du bras. */
  state: FeuState;
  /** Temps restant (s) dans cet état. */
  remaining: number;
  /** Phase du cycle à laquelle ce bras appartient. */
  phase: number;
  /** Cap d'arrivée des véhicules (rad, atan2(dx, dz)). */
  heading: number;
  /** Identifiant du passage piéton de ce bras (−1 : aucun). */
  crossingId: number;
}

/** État d'un carrefour à feux. */
export interface FeuJunctionState {
  /** Identifiant du nœud du monde. */
  junctionId: number;
  x: number; y: number; z: number;
  /** Nombre de phases du cycle. */
  phases: number;
  /** Phase courante. */
  phase: number;
  /** Étape : 0 vert, 1 orange, 2 rouge intégral. */
  stage: number;
  /** Temps restant (s) dans l'étape courante. */
  remaining: number;
  arms: FeuArmState[];
}

/**
 * API publiée par la circulation pour les autres modules (piétons en premier lieu) :
 *   `const feux = ctx.use<FeuxApi>(FEUX_SERVICE); if (!feux) { /* traversée prudente *\/ }`
 * Toutes les méthodes sont des LECTURES sans effet de bord, sauf `announcePedestrians`.
 * Les identifiants de passage et de carrefour sont stables tant que `version` ne change pas.
 */
export interface FeuxApi {
  /** Version de la disposition : change dès que le réseau routier est reconstruit (caches à invalider). */
  readonly version: number;
  /** Tous les passages piétons connus (un par bras de carrefour qui en porte un). */
  crossings(): CrossingState[];
  /** État d'un passage par identifiant (null s'il n'existe plus). */
  crossing(id: number): CrossingState | null;
  /** Passages dont le centre est à moins de `radius` m de (x, z), du plus proche au plus éloigné. */
  crossingsNear(x: number, z: number, radius: number): CrossingState[];
  /** Carrefours à feux avec l'état de chaque bras. */
  junctions(): FeuJunctionState[];
  /** État d'un carrefour à feux (null s'il n'existe pas ou n'a pas de feux). */
  junction(junctionId: number): FeuJunctionState | null;
  /**
   * Annonce que des piétons occupent le passage `crossingId` pendant `seconds` (≤ 30) : les véhicules qui le
   * franchissent (entrée ou sortie du carrefour) leur cèdent le passage. Renvoie faux si le passage est inconnu.
   */
  announcePedestrians(crossingId: number, seconds: number): boolean;
}

/* -------------------------------------------------------------------------- */
/* Deltas, instantanés et commandes du module                                  */
/* -------------------------------------------------------------------------- */

/** Version du format des charges utiles du module. */
export const CIRCULATION_EXT_VERSION = 1;

/**
 * Carte de congestion par tronçon (tableaux parallèles, un élément par tronçon ayant du trafic suivi).
 * `level` : 0 fluide, 1 dense, 2 saturé, 3 à l'arrêt (seuils de `congestionLevel`).
 */
export interface CongestionFrame {
  /** Identifiants des tronçons du monde. */
  edgeIds: Int32Array;
  /** Densité (véh/km/voie), moyenne glissante. */
  density: Float32Array;
  /** Vitesse moyenne observée (m/s). */
  speed: Float32Array;
  /** Rapport vitesse observée / vitesse libre (0..1). */
  ratio: Float32Array;
  /** Niveau 0..3 par tronçon. */
  level: Uint8Array;
}

/**
 * Géométrie des tronçons suivis (envoyée une seule fois par version de réseau, tampons transférés) :
 * polylignes de l'axe en CSR (`ptStart[i]..ptStart[i+1]` dans x/y/z) et demi-largeur de chaussée.
 */
export interface CongestionLayout {
  version: number;
  edgeIds: Int32Array;
  ptStart: Int32Array;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  half: Float32Array;
}

/** Indicateurs agrégés du trafic (panneau d'interface). */
export interface CirculationStats {
  vehicles: number;
  meanSpeedKmh: number;
  stopped: number;
  arrived: number;
  spawned: number;
  removedStuck: number;
  laneChanges: number;
  mandatoryLaneChanges: number;
  rerouted: number;
  unblocked: number;
  pedestrianYields: number;
  signals: number;
  priorityJunctions: number;
  yieldJunctions: number;
  connectedBuildings: number;
  routeQueries: number;
  /** Longueur de réseau saturée (niveau ≥ 2) en mètres, et longueur totale suivie. */
  congestedMeters: number;
  networkMeters: number;
}

/** Charge utile de `delta.ext.circulation` (absente quand rien n'a changé). */
export interface CirculationDelta {
  version: number;
  /** Géométrie des tronçons : seulement après un changement de réseau. */
  layout?: CongestionLayout;
  /** Carte de congestion (renvoyée au plus une fois par seconde réelle). */
  congestion?: CongestionFrame;
  stats?: CirculationStats;
  /** Affichage de la carte de congestion demandé par le joueur (présent quand il change). */
  overlay?: boolean;
}

/** Charge utile de `snapshot.ext.circulation` (état complet pour un rendu qui repart de zéro). */
export interface CirculationSnapshot {
  version: number;
  layout?: CongestionLayout;
  congestion?: CongestionFrame;
  stats?: CirculationStats;
  overlay: boolean;
}

/** Commandes du module : nom -> { payload, result }. */
export interface CirculationCommands {
  /** Indicateurs courants. */
  stats: { payload: undefined; result: CirculationStats };
  /** Carte de congestion courante. */
  congestion: { payload: undefined; result: CongestionFrame };
  /** État de tous les carrefours à feux. */
  feux: { payload: undefined; result: FeuJunctionState[] };
  /** Passages piétons (tous, ou autour d'un point). */
  passages: { payload: { x?: number; z?: number; radius?: number } | undefined; result: CrossingState[] };
  /** Affichage de la carte de congestion (le rendu colore les tronçons). */
  afficherCongestion: { payload: { on: boolean }; result: { on: boolean } };
  /** Réglages : réacheminement, densité de la demande. */
  reglages: { payload: { reroute?: boolean; demandScale?: number }; result: { reroute: boolean; demandScale: number } };
}

/** Couleurs des niveaux de congestion (sRGB) : fluide, dense, saturé, à l'arrêt — rendu et légende de l'interface. */
export const CONGESTION_COLORS = ['#2fbf6b', '#e8d44d', '#f08a2e', '#e03b3b'] as const;

/** Seuils de niveau de congestion à partir du rapport vitesse observée / vitesse libre. */
export function congestionLevel(ratio: number): 0 | 1 | 2 | 3 {
  if (ratio >= 0.75) return 0;
  if (ratio >= 0.5) return 1;
  if (ratio >= 0.25) return 2;
  return 3;
}
