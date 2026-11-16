/**
 * Module « cartes » (vague 5, docs/INTERFACE.md) : cartes d'information nouvelles, calculées par la simulation à la
 * demande (une seule à la fois) et drapées sur le terrain par le rendu. Les cartes existantes (électricité, eau,
 * déchets, circulation, bus, quartiers, criminalité, incendie, santé) restent pilotées par leurs modules.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */

/** Cartes calculées par ce module. */
export type CarteKind = 'foncier' | 'pollution' | 'bruit' | 'chomage' | 'education' | 'satisfaction' | 'ecoles' | 'dechets';
export const CARTE_KINDS: readonly CarteKind[] = ['foncier', 'pollution', 'bruit', 'chomage', 'education', 'satisfaction', 'ecoles', 'dechets'];

/** Valeur « aucun bâtiment concerné » d'une cellule. */
export const CARTE_NO_DATA = 255;

/**
 * Grille d'une carte : une valeur 0..100 par cellule (255 = aucune donnée). Pour les cartes « problème » (palette
 * `risque`), 0 = bien, 100 = problème (pire bâtiment de la cellule) ; pour la valeur foncière (palette `valeur`),
 * moyenne des bâtiments de la cellule, 0 = bas, 100 = élevé.
 */
export interface CarteLayer {
  kind: CarteKind;
  originX: number;
  originZ: number;
  cellSize: number;
  cols: number;
  rows: number;
  values: Uint8Array;
  /** Bâtiments pris en compte et moyenne des valeurs (0..100) : résumé affiché sous la légende. */
  buildings: number;
  mean: number;
  /** Bâtiments dans le tiers haut de l'échelle (≥ 67 : problème marqué, ou valeur élevée). */
  high: number;
  /** Jour de jeu du calcul. */
  day: number;
}

export interface CartesDelta {
  layer?: CarteLayer;
  $transfer?: ArrayBufferView[];
}

/** Palette de rendu : `risque` vert → jaune → rouge ; `valeur` bleu → cyan → jaune. */
export type CartePalette = 'risque' | 'valeur';
export const CARTE_PALETTE: Record<CarteKind, CartePalette> = {
  foncier: 'valeur', pollution: 'risque', bruit: 'risque', chomage: 'risque', education: 'risque', satisfaction: 'risque', ecoles: 'risque', dechets: 'risque',
};

/** Échelles (valeur 0..100 de la carte) — partagées par la simulation et les tests. */
export const carteScale = {
  /** Indice de valeur foncière V (0,4..1,6) → 0..100. */
  foncier: (v: number): number => ((v - 0.4) / 1.2) * 100,
  /** Pollution subie (indice de la démographie, ×6 points de satisfaction) et pollution de l'air (0..100). */
  pollution: (industry: number, air: number): number => Math.max(industry * 30, air),
  /** Bruit (0..100) et nuisances des déchets (0..100). */
  bruit: (noise: number, nuisance: number): number => Math.max(noise, nuisance),
  /** Taux de chômage du quartier (0..1) → 0..100 (25 % et plus = 100). */
  chomage: (rate: number): number => rate * 400,
  /** Éducation moyenne des adultes (0 sans diplôme .. 4 supérieur) → 0..100 (100 = sans diplôme). */
  education: (avg: number): number => 100 - avg * 25,
  /** Satisfaction moyenne (0..100) → 0..100 (75 et plus = 0, 25 et moins = 100). */
  satisfaction: (h: number): number => ((75 - h) / 50) * 100,
  /** Couverture d'une école (qualité 0..1, 0 = non couvert) → 0..100. */
  ecoles: (q: number): number => (q > 0 ? (1 - q) * 60 : 100),
  /** Remplissage du bac (0..1, > 1 débordé) → 0..100. */
  dechets: (fill: number): number => fill * 100,
};

export const clampCarte = (v: number): number => (v < 0 ? 0 : v > 100 ? 100 : Math.round(v));
