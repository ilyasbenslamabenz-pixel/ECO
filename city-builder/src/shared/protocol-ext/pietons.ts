/**
 * Extension du protocole propre au module « Piétons » — propriété de la branche p2a-pietons.
 * Rétrocompatible par construction : ces données circulent dans `delta.ext.pietons`, `snapshot.ext.pietons`
 * et la commande générique `pluginCommand { plugin: 'pietons', name, payload }` (src/shared/protocol.ts).
 * Un client qui ignore le module ignore simplement ces clés.
 *
 * Tableaux typés volumineux : neufs à chaque envoi et listés sous `$transfer` pour être transférés.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */

/** Flottants par piéton dans `PietonsFrame.pos` : x, y (sol), z, cap (rad ; avant = (sin cap, cos cap) dans le plan XZ). */
export const PIETON_POS_STRIDE = 4;
/** Octets par piéton dans `PietonsFrame.meta` : profil, graine d'apparence, animation. */
export const PIETON_META_STRIDE = 3;

/** Classes d'âge (bits 0-1 de l'octet « profil »). */
export const PIETON_AGE = { enfant: 0, ado: 1, adulte: 2, senior: 3 } as const;
export type PietonAge = (typeof PIETON_AGE)[keyof typeof PIETON_AGE];
/** Bit 2 de l'octet « profil » : 0 = homme, 1 = femme. */
export const PIETON_GENRE_BIT = 4;
/** Bit 7 de l'octet « animation » : 1 = à l'arrêt (attente) ; bits 0-6 = vitesse en pas de PIETON_SPEED_UNIT. */
export const PIETON_IDLE_BIT = 0x80;
export const PIETON_SPEED_UNIT = 0.02;

/**
 * Trame des piétons visibles (un envoi par delta quand au moins un piéton marche). Tableaux parallèles,
 * dans un ordre QUELCONQUE et instable : le rendu apparie les trames successives par `ids`.
 */
export interface PietonsFrame {
  count: number;
  /** Identifiants stables (jamais réutilisés pendant une partie). */
  ids: Uint32Array;
  /** PIETON_POS_STRIDE flottants par piéton. */
  pos: Float32Array;
  /** PIETON_META_STRIDE octets par piéton : [profil (âge | genre), graine d'apparence 0..255, animation]. */
  meta: Uint8Array;
}

/** Statistiques du module (≈ 1 envoi par seconde, et dans l'instantané). */
export interface PietonsStats {
  /** Piétons actuellement dans la rue (compteur affiché). */
  pietons: number;
  /** Détail par état. */
  enMarche: number;
  enAttente: number;
  enTraversee: number;
  /** Marcheurs suivis (habitants avec emploi du temps), dont ceux qui sont à l'intérieur d'un bâtiment. */
  marcheurs: number;
  /** Répartition des marcheurs par rôle. */
  roles: { actifs: number; ecoliers: number; retraites: number; autres: number };
  /** Répartition des trajets en cours par motif. */
  motifs: { travail: number; ecole: number; courses: number; loisirs: number; retour: number; flanerie: number };
  /** Graphe piéton courant. */
  graphe: { noeuds: number; aretes: number; trottoirsM: number; passages: number; passagesMarques: number; passagesRegules: number };
  /** Vrai si le service « feux » de la circulation est raccordé (sinon : traversée prudente partout). */
  feux: boolean;
  /** Vrai si le service « trafic » (créneaux entre véhicules) est raccordé. */
  trafic: boolean;
  /** Compteurs cumulés depuis le début de la partie (ou le chargement). */
  cumul: { trajets: number; arrivees: number; traversees: number; traverseesAuVert: number; traverseesPrudentes: number; traverseesForcees: number; nonMarchables: number; itineraires: number };
  /** Coût du module par tick de simulation (ms) sur la fenêtre glissante. */
  tickMs: { moyenne: number; p95: number; max: number; echantillons: number };
}

export interface PietonsConfig {
  /** Module actif (false : plus aucun piéton, aucun coût). */
  actif: boolean;
  /** Plafond de piétons simultanément dans la rue. */
  maxPietons: number;
  /**
   * Foule minimale imposée (banc de mesure et démonstration) : le module complète par des passants sans emploi
   * du temps jusqu'à ce nombre de piétons. 0 = désactivé (seuls les emplois du temps génèrent des trajets).
   */
  foule: number;
}

/** Configuration par défaut (nouvelle partie, ancienne sauvegarde sans section « pietons »). */
export const PIETONS_CONFIG_DEFAUT: Readonly<PietonsConfig> = { actif: true, maxPietons: 3000, foule: 0 };

/** Charge utile de `delta.ext.pietons` (absente quand rien n'a changé). */
export interface PietonsDelta {
  /** Trame de positions (absente quand il n'y a aucun piéton et que le rendu est déjà vide). */
  frame?: PietonsFrame;
  stats?: PietonsStats;
  config?: PietonsConfig;
  /** Tableaux typés de la trame à transférer au lieu de les copier (voir PLUGIN_TRANSFER_KEY). */
  $transfer?: ArrayBufferView[];
}

/** Charge utile de `snapshot.ext.pietons` (état complet pour un rendu qui repart de zéro). */
export interface PietonsSnapshot {
  config: PietonsConfig;
  stats: PietonsStats;
}

/** Fiche d'un piéton (commande `inspecter`). */
export interface PietonInfo {
  id: number;
  etat: 'sortie' | 'marche' | 'attente' | 'traversee' | 'entree';
  age: 'enfant' | 'ado' | 'adulte' | 'senior';
  genre: 'homme' | 'femme';
  role: 'actif' | 'ecolier' | 'retraite' | 'autre' | 'passant';
  motif: 'travail' | 'ecole' | 'courses' | 'loisirs' | 'retour' | 'flanerie';
  x: number;
  z: number;
  vitesse: number;
  origine: number;
  destination: number;
  resteM: number;
}

/** Commandes du module : nom -> { payload, result }. */
export interface PietonsCommands {
  /** Lit ou modifie la configuration (champs absents inchangés). */
  config: { payload: Partial<PietonsConfig> | undefined; result: PietonsConfig };
  /** Statistiques complètes, calculées à la demande. */
  stats: { payload: undefined; result: PietonsStats };
  /** Fiche d'un piéton (NOT_FOUND s'il n'est plus dans la rue). */
  inspecter: { payload: { id: number }; result: PietonInfo };
  /** Piéton le plus proche d'un point (rayon en m, défaut 6). */
  proche: { payload: { x: number; z: number; rayon?: number }; result: PietonInfo };
}
