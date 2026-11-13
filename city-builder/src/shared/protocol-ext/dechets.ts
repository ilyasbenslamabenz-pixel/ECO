/**
 * Extension du protocole propre au module « Déchets » (phase 2B.6) — propriété de la branche p2b-dechets.
 * Données dans `delta.ext.dechets`, `snapshot.ext.dechets` et `pluginCommand { plugin: 'dechets', name, payload }`.
 * Tableaux typés neufs à chaque envoi, listés sous `$transfer` (transférés, non copiés).
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import type { WasteSettings, WasteSummary } from '../waste/types';

/** Calque « déchets » : grille des nuisances et remplissage des bacs. */
export interface DechetsLayer {
  /** Géométrie de la grille (coin, taille de cellule, colonnes, rangées). */
  originX: number;
  originZ: number;
  cellSize: number;
  cols: number;
  rows: number;
  /** Nuisances (0..100) par cellule, index j·cols + i. */
  nuisance: Float32Array;
  /** Pollution du sol (0..100) par cellule. */
  soil: Float32Array;
  /** Bacs : [x, z, remplissage 0..1] par bâtiment producteur. */
  bins: Float32Array;
}

/** Charge utile de `delta.ext.dechets` (absente quand rien n'a changé). */
export interface DechetsDelta {
  /** Camions en tournée : [x, z, cap (rad, atan2(dx, dz)), charge 0..1] par camion (vide = aucun camion). */
  trucks?: Float32Array;
  /** Synthèse (quand elle a changé, au plus une fois par heure de jeu ou après une commande). */
  summary?: WasteSummary;
  /** Calque (au plus une fois par heure de jeu). */
  layer?: DechetsLayer;
  /** Points d'apport (conteneurs de tri), envoyés avec le calque. */
  containers?: Float32Array;
  $transfer?: ArrayBufferLike[];
}

/** Charge utile de `snapshot.ext.dechets` : état complet. */
export interface DechetsSnapshot {
  trucks: Float32Array;
  summary: WasteSummary;
  layer: DechetsLayer | null;
  /** Points d'apport (conteneurs de tri de rue) : [x, z, cap] par groupe de conteneurs. */
  containers: Float32Array;
}

/** Commandes du module : nom -> { payload, result }. */
export interface DechetsCommands {
  /** Synthèse courante. */
  etat: { payload: undefined; result: WasteSummary };
  /** Modifie les réglages (bornés) ; renvoie la synthèse. */
  reglages: { payload: Partial<WasteSettings>; result: WasteSummary };
  /** Lance immédiatement les tournées (diagnostic / tests) ; renvoie le nombre de tournées. */
  collecter: { payload: undefined; result: { tours: number } };
  /** Bacs d'un bâtiment. */
  bacs: { payload: { buildingId: number }; result: { rec: number; res: number; cap: number } | null };
}
