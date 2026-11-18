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

/** Nom court de chaque carte (étiquette au survol). */
export const CARTE_LABEL_FR: Record<CarteKind, string> = {
  foncier: 'Valeur foncière', pollution: 'Pollution', bruit: 'Bruit', chomage: 'Chômage', education: 'Éducation',
  satisfaction: 'Satisfaction', ecoles: 'Écoles', dechets: 'Bacs à déchets',
};

const pct0 = (v: number): string => `${Math.round(v)} %`;
const dec1 = (v: number): string => v.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/**
 * Valeur d'une cellule en clair, dans l'unité du jeu (inverse des échelles `carteScale`) : affichée au survol de la
 * carte, comme une infobulle. `v` : valeur 0..100 de la cellule ; CARTE_NO_DATA : aucun bâtiment concerné.
 */
export function carteReadout(kind: CarteKind, v: number): string {
  const name = CARTE_LABEL_FR[kind];
  if (v === CARTE_NO_DATA) return `${name} : aucun bâtiment ici`;
  switch (kind) {
    case 'foncier': {
      const idx = 0.4 + (v / 100) * 1.2;
      return `${name} : indice ${dec1(idx)} (1,0 = moyenne) — loyers ${idx >= 1.2 ? 'chers' : idx <= 0.8 ? 'faibles' : 'moyens'}`;
    }
    case 'chomage': return `${name} : ${v >= 100 ? '25 % et plus' : pct0(v / 4)} des actifs du quartier`;
    case 'education': {
      const avg = (100 - v) / 25;
      const lvl = ['sans diplôme', 'primaire', 'brevet / CAP', 'baccalauréat', 'études supérieures'][Math.max(0, Math.min(4, Math.round(avg)))];
      return `${name} : niveau moyen ${dec1(avg)} / 4 (${lvl})`;
    }
    case 'satisfaction': {
      const h = 75 - (v / 100) * 50;
      return `${name} : ${v <= 0 ? '75 et plus' : v >= 100 ? '25 et moins' : Math.round(h)} / 100 (logement le moins satisfait)`;
    }
    case 'ecoles': return v >= 100 ? `${name} : aucune école à portée` : `${name} : école à portée (qualité ${pct0((1 - v / 60) * 100)})`;
    case 'dechets': return `${name} : remplis à ${v >= 100 ? '100 % ou plus' : pct0(v)}`;
    case 'pollution': return `${name} : ${Math.round(v)} / 100 (${v >= 67 ? 'très pollué' : v >= 34 ? 'pollué' : 'air sain'})`;
    case 'bruit': return `${name} : ${Math.round(v)} / 100 (${v >= 67 ? 'bruyant' : v >= 34 ? 'gênant' : 'calme'})`;
  }
}

/** Valeur (0..100, ou CARTE_NO_DATA) de la cellule sous un point monde ; null hors de la grille. */
export function carteValueAt(l: CarteLayer, x: number, z: number): number | null {
  const c = Math.floor((x - l.originX) / l.cellSize), r = Math.floor((z - l.originZ) / l.cellSize);
  if (c < 0 || r < 0 || c >= l.cols || r >= l.rows) return null;
  return l.values[r * l.cols + c] ?? null;
}
