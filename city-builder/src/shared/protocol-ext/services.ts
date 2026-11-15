/**
 * Module « services » (vague 2 : criminalité, incendies, santé) : charges utiles échangées avec le rendu et
 * l'interface. La synthèse chiffrée part dans le rapport (`report.demography.cityServices`) ; ce fichier décrit la
 * carte d'information (grille par cellule) envoyée seulement quand une carte est affichée.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */

/** Cartes d'information proposées. */
export type ServicesLayerKind = 'crime' | 'fire' | 'health';
export const SERVICES_LAYER_KINDS: readonly ServicesLayerKind[] = ['crime', 'fire', 'health'];

/**
 * Grille de la carte : une valeur 0..100 par cellule (255 = aucun bâtiment concerné). `crime` = criminalité maximale
 * des bâtiments de la cellule ; `fire` = risque d'incendie maximal (prévention des casernes comprise) ; `health` =
 * santé minimale des logements ; `state` = 0 normal, 1 en feu, 2 endommagé, 3 ruine (pire de la cellule).
 * `cover*` = 1 si au moins un bâtiment de la cellule est couvert par le service (commissariat, caserne, soins).
 */
export interface ServicesLayer {
  originX: number;
  originZ: number;
  cellSize: number;
  cols: number;
  rows: number;
  crime: Uint8Array;
  fire: Uint8Array;
  health: Uint8Array;
  state: Uint8Array;
  coverPolice: Uint8Array;
  coverFire: Uint8Array;
  coverHealth: Uint8Array;
}

export interface ServicesDelta {
  layer?: ServicesLayer;
  $transfer?: ArrayBufferView[];
}

/** Valeur « aucun bâtiment » d'une cellule. */
export const SERVICES_NO_DATA = 255;
