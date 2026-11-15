/**
 * Objectifs et réalisations (module `objectifs`, docs/PROGRESSION.md) : types partagés simulation <-> interface.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */

export const OBJECTIFS_PLUGIN_ID = 'objectifs';
export const OBJECTIFS_SERVICE = 'objectifs';
/** Objectifs proposés en même temps au plus. */
export const MAX_ACTIVE_OBJECTIVES = 3;

/** Tableau de bord où agir (bouton « Voir » de l'interface). */
export type ObjectiveDash = 'population' | 'services' | 'transport' | 'finance' | 'energy' | 'waste' | 'progression';

export interface ObjectiveView {
  /** Identifiant unique de l'instance (ex. « chomage-3 »). */
  key: string;
  /** Modèle d'objectif (chomage, police, bus…). */
  id: string;
  title: string;
  /** Conseil : quoi faire pour y arriver. */
  hint: string;
  /** Valeur actuelle et cible (dans `unit`) ; `higher` : la valeur doit monter (sinon descendre). */
  current: number;
  target: number;
  unit: string;
  higher: boolean;
  /** Avancement 0..1 depuis la valeur de départ. */
  progress: number;
  /** Jours (ou mois) consécutifs où la condition est tenue, et durée exigée. */
  streak: number;
  streakNeeded: number;
  streakUnit: 'jours' | 'mois';
  rewardMoney: number;
  rewardXp: number;
  /** Minute de jeu de la proposition. */
  since: number;
  dash: ObjectiveDash;
}

export interface AchievementView { id: string; title: string; detail: string; xp: number; done: boolean; at: number | null }

export interface ObjectiveDone { key: string; title: string; at: number; rewardMoney: number; rewardXp: number }

/** Charge utile `delta.ext.objectifs` / `snapshot.ext.objectifs` et résultat de la commande `state`. */
export interface ObjectifsState {
  active: ObjectiveView[];
  recent: ObjectiveDone[];
  completedCount: number;
  achievements: AchievementView[];
  /** Remplacement d'un objectif possible à partir de cette minute de jeu. */
  replaceAt: number;
}

/** Service publié par le module (lu par les événements : investisseur). */
export interface ObjectifsService {
  active(): { key: string; title: string; rewardMoney: number }[];
  /** Vrai si l'instance `key` a été accomplie. */
  completed(key: string): boolean;
  /** Débloque une réalisation (événements : crise surmontée). */
  achieve(id: string): void;
}
