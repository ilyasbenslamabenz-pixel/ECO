/**
 * Extension du protocole propre au module « Eau et assainissement » (phase 2B.5).
 * Rétrocompatible : `delta.ext.eau`, `snapshot.ext.eau`, commandes `pluginCommand { plugin: 'eau', name, payload }`.
 * Le module est DORMANT (aucune clé, aucune section de sauvegarde) tant qu'aucune installation d'eau n'a été posée.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import type {
  PipeGeometry, RiverLayer, WaterBalance, WaterBudget, WaterFacilityState, WaterLayerState, WaterSettings,
} from '../water-network/types';

export type {
  PipeGeometry, RiverLayer, WaterBalance, WaterBudget, WaterFacilityKind, WaterFacilitySpec, WaterFacilityState,
  WaterLayerState, WaterSettings, IntakeMode,
} from '../water-network/types';

/** Charge utile de `delta.ext.eau` (envoyée après chaque pas horaire du service). */
export interface EauDelta {
  /** Version de l'état (augmente à chaque pas horaire). */
  version: number;
  balance: WaterBalance;
  settings: WaterSettings;
  facilities: WaterFacilityState[];
  layer: WaterLayerState;
  /** Pollution des cellules en eau (même ordre que `RiverLayer.cells`). */
  riverPollution: Float32Array;
  /** Géométrie des canalisations : présente seulement quand la voirie a changé. */
  pipes?: PipeGeometry;
  /** Cellules en eau (géométrie) : présentes avec `pipes` (premier envoi, voirie modifiée). */
  river?: RiverLayer;
  /** Budget du mois en cours et du dernier mois clos. */
  budget: { current: WaterBudget; last: WaterBudget | null };
  /** Alertes lisibles (pénurie, pollution, sous-financement…). */
  alerts: string[];
}

/** Charge utile de `snapshot.ext.eau` (état complet). */
export interface EauSnapshot extends Omit<EauDelta, 'pipes' | 'river'> {
  pipes: PipeGeometry;
  river: RiverLayer;
}

/** Commandes du module : nom -> { payload, result }. */
export interface EauCommands {
  /** Réglages (champs facultatifs, bornés) ; renvoie les réglages appliqués. */
  settings: { payload: Partial<WaterSettings>; result: WaterSettings };
  /** État courant complet (bilan, installations, budget, alertes). */
  state: { payload: undefined; result: { active: boolean; balance: WaterBalance | null; settings: WaterSettings; facilities: WaterFacilityState[]; budget: { current: WaterBudget; last: WaterBudget | null }; alerts: string[] } };
  /** État d'un bâtiment (desserte, pression, qualité, égout, croissance autorisée). */
  building: { payload: { id: number }; result: { served: number; pressure: number; quality: number; sewer: boolean; growthAllowed: boolean } | null };
  /** Historique horaire des 48 derniers bilans. */
  history: { payload: undefined; result: WaterBalance[] };
}
