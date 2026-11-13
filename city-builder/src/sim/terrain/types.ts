/**
 * Types du terrain côté simulation (données faisant foi, partagées avec le rendu par message).
 * TypeScript pur : ni three, ni DOM.
 */
import type { TerrainData } from '../../shared/contracts';

/** Type d'étendue d'eau principale. */
export type HydrologyKind = 'mer' | 'lac' | 'aucune';

/** Réseau de rivières (génération v2) : aucune, une seule rivière principale, ou réseau complet (dense selon `rivers`). */
export type RiverMode = 'aucune' | 'une' | 'plusieurs';

/**
 * Version de l'algorithme de génération. 1 = génération d'origine (forêts denses, réseau de rivières) : conservée
 * à l'identique pour les sauvegardes antérieures, dont le terrain est régénéré au chargement. 2 = génération actuelle
 * (forêt ≈ ÷3 en bosquets avec grandes clairières, une rivière principale plus étroite et moins sinueuse par défaut).
 */
export const TERRAIN_GEN_VERSION = 2;

/** Paramètres de génération du monde (tous bornés par `normalizeParams`). */
export interface WorldGenParams {
  seed: number;
  /** Côté de la carte en chunks de 256 m (8..16 => 2..4 km ; 1..32 acceptés pour les tests). */
  mapChunks: number;
  /** Échantillons de hauteur par case de 8 m (1 = 8 m, 2 = 4 m). Défaut 1 (compatible avec world.ts). */
  samplesPerTile: 1 | 2;
  /** Altitude maximale des montagnes de bordure (m), 20..300. */
  maxAltitude: number;
  /** Relief des collines 0..1 (0 = plaine quasi plate). */
  relief: number;
  /** Couverture forestière 0..1. */
  forest: number;
  /** Étendue d'eau principale : mer sur un côté, lac intérieur, ou aucune. */
  hydrology: HydrologyKind;
  /** Densité du réseau de rivières 0..1 (0 = aucune rivière). */
  rivers: number;
  /** Intensité de l'érosion hydraulique 0..1. */
  erosion: number;
  /** Abondance des ressources 0..1. */
  resources: number;
  /** Version de l'algorithme (1 = d'origine, 2 = actuelle) ; défaut : TERRAIN_GEN_VERSION. */
  genVersion: 1 | 2;
  /** Réseau de rivières (v2) ; défaut 'une'. Ignoré en v1 (réseau selon `rivers`). `rivers` = 0 : aucune rivière. */
  riverMode: RiverMode;
}

/** Ressources naturelles par échantillon (Uint8). */
export const RESOURCE = {
  AUCUNE: 0,
  TERRE_FERTILE: 1,
  MINERAI: 2,
  PIERRE: 3,
  SABLE_GRAVIER: 4,
} as const;
export type ResourceKind = (typeof RESOURCE)[keyof typeof RESOURCE];

export const RESOURCE_NAMES_FR: Record<ResourceKind, string> = {
  0: 'Aucune',
  1: 'Terre fertile',
  2: 'Minerai',
  3: 'Pierre',
  4: 'Sable et gravier',
};

/** Valeur de `waterSurface` pour un échantillon sec. */
export const NO_WATER = -10000;

/** Rivière : polyligne de l'amont vers l'aval. `points` = [x, ySurface, z, largeur] * n. */
export interface RiverPath {
  points: Float32Array;
  /** Débit relatif à l'embouchure (accumulation de ruissellement, en échantillons). */
  flow: number;
}

export interface WorldStats {
  minHeight: number;
  maxHeight: number;
  /** Part des échantillons secs de pente <= 12 % (constructibles pour une route). */
  buildableFraction: number;
  waterFraction: number;
  forestFraction: number;
  riverCount: number;
  generationMs: number;
}

/**
 * Terrain complet généré : compatible `TerrainData` (heights, waterLevel...) + couches
 * environnementales. Toutes les couches ont samplesX * samplesZ éléments, même indexation que heights.
 */
export interface WorldTerrain extends TerrainData {
  params: WorldGenParams;
  /** Altitude de la surface de l'eau (m) ; mer/lac = waterLevel, rivières et lacs d'altitude au-dessus ; NO_WATER si sec. */
  waterSurface: Float32Array;
  /** Humidité 0..255. */
  moisture: Uint8Array;
  /** Densité forestière 0..255 (0 = pas d'arbre). */
  forest: Uint8Array;
  /** Ressource dominante (ResourceKind). */
  resources: Uint8Array;
  rivers: RiverPath[];
  stats: WorldStats;
  /**
   * Murs de quai des éditions du joueur (src/sim/terrain/edits.ts), à plat : QUAY_STRIDE nombres par mur
   * (ax, az, bx, bz, dessus, pied, normale x/z vers l'eau). Tableau simple (copié, jamais transféré). Absent = aucun.
   */
  quays?: number[];
}

/** Région rectangulaire d'échantillons (bornes incluses). */
export interface SampleRect {
  i0: number;
  j0: number;
  i1: number;
  j1: number;
}

/**
 * Patch de hauteurs envoyé au rendu après une terraformation (message proposé `terrainPatch`).
 * `heights` contient (i1-i0+1) * (j1-j0+1) valeurs, ligne par ligne ; à transférer (Transferable).
 */
export interface TerrainPatch extends SampleRect {
  heights: Float32Array;
  waterSurface: Float32Array;
  /** Forêt de la région (éditions du joueur : défrichage, remblai, creusement). */
  forest?: Uint8Array;
  /** Murs de quai de TOUTE la carte (remplace la liste du rendu) quand ils ont changé. */
  quays?: number[];
  /** Zones où le rendu retire la végétation naturelle : disques (x, z, rayon) à plat. */
  cleared?: number[];
}
