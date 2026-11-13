/**
 * Extension du protocole propre au module « Chantiers » — propriété de la branche p2a-chantiers.
 * Rétrocompatible par construction : ces données circulent dans `delta.ext.chantiers`, `snapshot.ext.chantiers`
 * et la commande générique `pluginCommand { plugin: 'chantiers', name, payload }` (src/shared/protocol.ts).
 * Un client qui ignore le module ignore simplement ces clés.
 *
 * Modèle : un CHANTIER est une construction (bâtiment posé, pas encore achevé) ou une démolition (bâtiment
 * retiré, gravats à évacuer). Tous les chantiers avancent sur la même « horloge de travail » : le cumul des
 * minutes de jeu travaillées (06:00–20:00) depuis l'activation du module. L'avancement d'un chantier vaut
 * `(horloge − t0) / duree` : la simulation n'envoie donc que l'horloge (un nombre) à chaque delta, jamais
 * l'avancement de chaque chantier ; le rendu en déduit les phases.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */

/** Phases d'une construction, dans l'ordre. */
export const CHANTIER_PHASES = ['terrassement', 'fondations', 'structure', 'facades', 'finitions'] as const;
export type ChantierPhase = (typeof CHANTIER_PHASES)[number];
export const CHANTIER_PHASE_NAMES_FR: Record<ChantierPhase, string> = {
  terrassement: 'Terrassement', fondations: 'Fondations', structure: 'Structure', facades: 'Façades', finitions: 'Finitions',
};
/** Avancement (0..1) auquel chaque phase de construction se termine. */
export const CHANTIER_PHASE_ENDS: readonly number[] = [0.12, 0.26, 0.62, 0.88, 1];

/** Phases d'une démolition, dans l'ordre. */
export const DEMOLITION_PHASES = ['preparation', 'abattage', 'deblaiement'] as const;
export type DemolitionPhase = (typeof DEMOLITION_PHASES)[number];
export const DEMOLITION_PHASE_NAMES_FR: Record<DemolitionPhase, string> = {
  preparation: 'Préparation', abattage: 'Abattage', deblaiement: 'Déblaiement',
};
export const DEMOLITION_PHASE_ENDS: readonly number[] = [0.12, 0.62, 1];

/** Horaires de travail des chantiers (minute du jour, début inclus, fin exclue). */
export const CHANTIER_WORK_START_MIN = 6 * 60;
export const CHANTIER_WORK_END_MIN = 20 * 60;

export type ChantierKind = 'construction' | 'demolition';

/** Index de la phase atteinte à l'avancement `p` (0..1) pour la table de fins de phase donnée. */
export function phaseIndexAt(p: number, ends: readonly number[] = CHANTIER_PHASE_ENDS): number {
  for (let i = 0; i < ends.length; i++) if (p < ends[i]!) return i;
  return ends.length - 1;
}

/** Avancement (0..1) à l'intérieur de la phase `index`. */
export function phaseLocalProgress(p: number, index: number, ends: readonly number[] = CHANTIER_PHASE_ENDS): number {
  const a = index > 0 ? ends[index - 1]! : 0, b = ends[index]!;
  return b > a ? Math.min(1, Math.max(0, (p - a) / (b - a))) : 1;
}

/** Avancement (0..1) d'un chantier à l'horloge de travail `clock`. */
export function chantierProgress(s: { t0: number; duree: number }, clock: number): number {
  return s.duree > 0 ? Math.min(1, Math.max(0, (clock - s.t0) / s.duree)) : 1;
}

/** Un chantier tel qu'il circule (delta, instantané, sauvegarde) : valeurs JSON uniquement. */
export interface ChantierRecord {
  /** Identifiant du chantier (propre au module, croissant). */
  id: number;
  kind: ChantierKind;
  /** Bâtiment concerné (construction : bâtiment existant ; démolition : identifiant du bâtiment retiré). */
  buildingId: number;
  assetId: string;
  variant: number;
  x: number;
  y: number;
  z: number;
  /** Quarts de tour (convention des bâtiments). */
  rot: number;
  /** Horloge de travail au démarrage du chantier. */
  t0: number;
  /** Durée en minutes de jeu TRAVAILLÉES. */
  duree: number;
  /** Démolition : part du bâtiment qui était construite (1 = bâtiment achevé, < 1 = chantier abandonné). */
  bati: number;
}

/** Fin d'un chantier : achevé (construction livrée / terrain déblayé) ou annulé (bâtiment démoli en cours de chantier, terrain réutilisé). */
export interface ChantierEnd {
  id: number;
  raison: 'acheve' | 'annule';
}

/** Charge utile de `delta.ext.chantiers` (absente quand il n'y a ni chantier ni changement). */
export interface ChantiersDelta {
  /** Horloge de travail courante (minutes travaillées cumulées). */
  horloge: number;
  /** Vrai pendant les heures de travail (engins et grues en mouvement). */
  enTravail: boolean;
  ajoutes?: ChantierRecord[];
  termines?: ChantierEnd[];
}

/** Charge utile de `snapshot.ext.chantiers` (état complet pour un rendu qui repart de zéro). */
export interface ChantiersSnapshot {
  actif: boolean;
  horloge: number;
  enTravail: boolean;
  chantiers: ChantierRecord[];
}

/** État d'un chantier pour l'interface (commande `etat` / `inspecter`). */
export interface ChantierInfo extends ChantierRecord {
  nomFr: string;
  /** Avancement global 0..1. */
  avancement: number;
  phase: ChantierPhase | DemolitionPhase;
  phaseFr: string;
  /** Avancement 0..1 dans la phase courante. */
  avancementPhase: number;
  /** Minutes de jeu travaillées restantes. */
  resteTravail: number;
  /** Minutes de jeu calendaires restantes (nuits comprises). */
  resteCalendaire: number;
}

export interface ChantiersEtat {
  actif: boolean;
  horloge: number;
  enTravail: boolean;
  /** Vrai si le cœur de la simulation applique l'état de chantier (bâtiment inactif jusqu'à l'achèvement). */
  porteActivite: boolean;
  chantiers: ChantierInfo[];
}

/** Commandes du module : nom -> { payload, result }. */
export interface ChantiersCommands {
  /** Active ou désactive les chantiers (désactivé : construction et démolition instantanées, comme en phase 1). */
  configurer: { payload: { actif: boolean }; result: { actif: boolean } };
  /** État complet (panneau d'interface, tests). */
  etat: { payload?: undefined; result: ChantiersEtat };
  /** Chantier de construction d'un bâtiment (NOT_FOUND si le bâtiment n'est pas en chantier). */
  inspecter: { payload: { buildingId: number }; result: ChantierInfo };
}

/**
 * Service publié par le module (`ctx.use<ChantiersService>('chantiers')`) pour les autres modules de simulation
 * (ex. quartiers : ne pas compter un bâtiment en chantier ; piétons : pas de sortie d'un immeuble inachevé).
 */
export interface ChantiersService {
  /** Vrai si le bâtiment est en cours de construction. */
  enChantier(buildingId: number): boolean;
  /** Avancement 0..1 (1 si le bâtiment n'est pas en chantier). */
  avancement(buildingId: number): number;
  /** Nombre de chantiers en cours (constructions + démolitions). */
  readonly nombre: number;
}

/** Nom du service « portail d'activité » : `(buildingId) => boolean`, faux tant que le bâtiment est en chantier. */
export const SERVICE_ACTIVITE_BATIMENTS = 'activite-batiments';
export type ActiviteBatiments = (buildingId: number) => boolean;
