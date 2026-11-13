/**
 * Extension du protocole propre au module « Bâtiments & quartiers » — propriété de la branche p2a-batiments.
 * Rétrocompatible par construction : ces données circulent dans `delta.ext.batiments`, `snapshot.ext.batiments`
 * et la commande générique `pluginCommand { plugin: 'batiments', name, payload }` (src/shared/protocol.ts).
 * Un client qui ignore le module ignore simplement ces clés.
 *
 * Le module n'envoie rien tant qu'aucun quartier n'est enregistré (aucune clé `ext.batiments`).
 * Charges utiles JSON uniquement (aucun tableau typé : les volumes sont petits — quelques dizaines de quartiers).
 * TypeScript pur : AUCUN import de three ni du DOM.
 */

/** Les six types de quartiers (copie littérale de `DistrictType`, côté protocole). */
export type BatimentsDistrictType = 'centre_historique' | 'faubourg' | 'pavillonnaire' | 'affaires' | 'activites' | 'grands_ensembles';

/** Quartier suivi par le module, tel que transmis au rendu et à l'interface. */
export interface BatimentsDistrictView {
  id: number;
  type: BatimentsDistrictType;
  nameFr: string;
  /** Centre et dimensions locales (m) ; `rot` en quarts de tour entiers. */
  x: number;
  z: number;
  width: number;
  depth: number;
  rot: number;
  seed: number;
  /** Enveloppe alignée sur les axes du monde (contours de l'overlay). */
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number };
  /** Stade de densité (0..4) et valorisation (0..100). */
  stage: number;
  value: number;
  ageMonths: number;
  /** Dernières mesures connues (mises à jour au début de chaque mois). */
  buildings: number;
  distinctAssets: number;
  repetitionIndex: number;
  residents: number;
  capacity: number;
  jobs: number;
}

export interface BatimentsProposalView {
  id: number;
  districtId: number;
  buildingId: number;
  fromAsset: string;
  toAsset: string;
  variant: number;
  x: number;
  z: number;
  rot: number;
  kind: 'densification' | 'valorisation';
  reason: string;
  cost: number;
}

/** Charge utile de `delta.ext.batiments` (absente quand rien n'a changé). */
export interface BatimentsDelta {
  version: 1;
  /** Vrai si le rendu doit afficher les contours des quartiers. */
  overlay: boolean;
  autoEvolve: boolean;
  districts: BatimentsDistrictView[];
  proposals: BatimentsProposalView[];
}

/** Charge utile de `snapshot.ext.batiments` (état complet pour un rendu qui repart de zéro). */
export type BatimentsSnapshot = BatimentsDelta;

/** Description d'un quartier demandée au module (commandes `planDistrict`, `registerDistrict`, `applyDistrict`). */
export interface BatimentsDistrictSpec {
  type: BatimentsDistrictType;
  x: number;
  z: number;
  width: number;
  depth: number;
  rot?: number;
  /** Graine ; tirée du PRNG du module si absente. */
  seed?: number;
}

/** Plan renvoyé par `planDistrict` (voir src/sim/districts/types.ts pour le détail). */
export interface BatimentsPlanView {
  type: BatimentsDistrictType;
  seed: number;
  rot: number;
  center: [number, number];
  size: [number, number];
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number };
  roads: { kind: string; points: [number, number, number, number]; control?: [number, number] }[];
  lots: { assetId: string; variant: number; x: number; z: number; rot: number; role: string }[];
  stats: Record<string, number>;
}

export interface BatimentsApplyReport {
  roadsOk: number;
  roadsRefused: number;
  lotsOk: number;
  lotsRefused: number;
  cost: number;
  errors: string[];
}

/** Commandes du module : nom -> { payload, result }. */
export interface BatimentsCommands {
  /** Calcule un plan sans rien construire ni enregistrer. */
  planDistrict: { payload: BatimentsDistrictSpec; result: { plan: BatimentsPlanView } };
  /** Enregistre un quartier (rectangle + type) pour le suivi et l'évolution ; ne construit rien. */
  registerDistrict: { payload: BatimentsDistrictSpec; result: { district: BatimentsDistrictView } };
  /** Enregistre puis exécute le plan (nécessite l'API d'écriture du cœur : docs/requests/batiments.md). */
  applyDistrict: { payload: BatimentsDistrictSpec; result: { district: BatimentsDistrictView; report: BatimentsApplyReport } };
  listDistricts: { payload: undefined; result: { districts: BatimentsDistrictView[] } };
  /** Mesures à jour d'un quartier (recalculées à la demande). */
  districtReport: { payload: { id: number }; result: { district: BatimentsDistrictView; diversity: Record<string, number> } };
  forgetDistrict: { payload: { id: number }; result: { removed: boolean } };
  listProposals: { payload: undefined; result: { proposals: BatimentsProposalView[] } };
  applyProposal: { payload: { id: number }; result: { buildingId: number; cost: number } };
  dismissProposal: { payload: { id: number }; result: { removed: boolean } };
  setOverlay: { payload: { on: boolean }; result: { overlay: boolean } };
  setAutoEvolve: { payload: { on: boolean }; result: { autoEvolve: boolean } };
}
