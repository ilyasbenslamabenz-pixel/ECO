/**
 * Événements de la ville (module `evenements`, docs/PROGRESSION.md) : types partagés simulation <-> interface.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */

export const EVENEMENTS_PLUGIN_ID = 'evenements';

export type EventKind = 'canicule' | 'panne_reseau' | 'epidemie' | 'greve_eboueurs' | 'afflux' | 'investisseur';
export const EVENT_KINDS: readonly EventKind[] = ['canicule', 'panne_reseau', 'epidemie', 'greve_eboueurs', 'afflux', 'investisseur'];

/** Réglage du joueur (Options) : fréquence des événements. */
export type EventFrequency = 'normal' | 'rares' | 'off';
export const EVENT_FREQUENCIES: readonly EventFrequency[] = ['normal', 'rares', 'off'];
export const EVENT_FREQUENCY_LABELS: Record<EventFrequency, string> = { normal: 'Normal', rares: 'Rares', off: 'Désactivés' };

export const EVENT_TITLES: Record<EventKind, string> = {
  canicule: 'Canicule', panne_reseau: 'Panne du réseau voisin', epidemie: 'Épidémie de grippe', greve_eboueurs: 'Grève des éboueurs',
  afflux: 'Afflux de nouveaux habitants', investisseur: 'Investisseur',
};

/** Tableau de bord où agir (bouton « Voir »). */
export type EventDash = 'energy' | 'water' | 'services' | 'waste' | 'population' | 'progression';

export interface EventView {
  kind: EventKind;
  title: string;
  /** Annonce (préavis : rien n'a encore changé) puis effet en cours. */
  phase: 'annonce' | 'actif';
  /** Ce qui va se passer / se passe. */
  text: string;
  /** Que faire (fenêtre de réaction). */
  advice: string;
  /** Effets chiffrés (« Demande d'eau +25 % »…). */
  effects: string[];
  /** Minutes de jeu : début de l'effet, fin prévue. */
  startsAt: number;
  endsAt: number;
  dash: EventDash;
  /** Investisseur : objectif visé, prime promise. */
  objective?: string;
  bonus?: number;
}

export interface EventRecord { kind: EventKind; title: string; at: number; outcome: string }

/** Charge utile `delta.ext.evenements` / `snapshot.ext.evenements` et résultat de `state`. */
export interface EvenementsState {
  setting: EventFrequency;
  current: EventView | null;
  history: EventRecord[];
  /** Aucun événement avant cette minute de jeu (délai de départ, répit après un événement). */
  quietUntil: number;
}
