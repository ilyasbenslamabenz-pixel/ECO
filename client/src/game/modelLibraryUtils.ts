// Fonctions pures (sans Babylon) de la bibliothèque de modèles : testables sous Node.
// Voir modelLibrary.ts pour le chargement des GLB et tools/blender/ pour leur génération.

/** 1 unité de jeu = 1 km : les modèles sont en mètres. */
export const METRES_EN_KM = 0.001;

/** Codes émissifs portés par la composante u des UV (voir manifest.json, `convention_emissive`). */
export const EMISSIVE = {
  phare: 1,
  feuArriere: 2,
  vitrage: 3,
  gyrophare: 4,
  orange: 5,
  vert: 6,
  flash: 7,
  eclairage: 8,
  vitrageSombre: 9,
} as const;

/** Couleur émissive (sRGB 0..1) par code. Le code 9 (vitrage sombre) n'est pas allumé par défaut. */
export const EMISSIVE_COLORS: Record<number, [number, number, number]> = {
  1: [1.0, 0.95, 0.82],
  2: [1.0, 0.08, 0.05],
  3: [1.0, 0.82, 0.52],
  4: [0.15, 0.35, 1.0],
  5: [1.0, 0.62, 0.1],
  6: [0.1, 1.0, 0.35],
  7: [1.0, 1.0, 1.0],
  8: [1.0, 0.86, 0.62],
  9: [0.25, 0.32, 0.4],
};

/** Codes allumés la nuit par défaut. */
export const DEFAULT_NIGHT_CODES = [1, 2, 3, 4, 5, 6, 7, 8];

export interface ManifestPart {
  nom: string;
  type: 'rotation' | 'translation' | 'emissif';
  axe?: 'x' | 'y' | 'z';
  pivot_m?: [number, number, number];
  course_m?: [number, number];
  vitesse_tr_min?: [number, number];
  description: string;
}

export interface ManifestEntry {
  id: string;
  fichier: string;
  categorie: string;
  dimensions_m: { largeur: number; hauteur: number; longueur: number };
  triangles: number;
  triangles_par_noeud: Record<string, number>;
  origine: 'sol' | 'ligne_de_flottaison';
  parties_animees: ManifestPart[];
  lods: { noeud: string; triangles: number; usage: string }[];
  codes_emissifs: number[];
  peignable: boolean;
  taille_octets: number;
  source: string;
  licence: string;
  notes?: string;
}

export interface Manifest {
  version: number;
  description: string;
  modeles: ManifestEntry[];
}

/** Composante linéaire -> sRGB (les couleurs de sommets glTF sont linéaires, StandardMaterial attend du sRGB). */
export function linearToSrgb(x: number): number {
  if (x <= 0.0031308) return 12.92 * x;
  return 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

/** Convertit en place un tableau RGBA linéaire en sRGB et force l'alpha à 1. */
export function colorsLinearToSrgb(colors: Float32Array | number[]): void {
  for (let i = 0; i < colors.length; i += 4) {
    colors[i] = linearToSrgb(colors[i]);
    colors[i + 1] = linearToSrgb(colors[i + 1]);
    colors[i + 2] = linearToSrgb(colors[i + 2]);
    colors[i + 3] = 1;
  }
}

export interface RawGeometry {
  positions: ArrayLike<number>;
  normals: ArrayLike<number>;
  uvs: ArrayLike<number> | null;
  indices: ArrayLike<number>;
}

export interface LightsGeometry {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  /** Nombre de triangles émissifs par code. */
  parCode: Record<number, number>;
}

/**
 * Extrait les triangles dont le code émissif (u arrondi, lu sur le premier sommet) est dans `codes`.
 * Les sommets sont dupliqués par triangle (géométrie plate, peu de faces).
 */
export function extractEmissiveTriangles(
  g: RawGeometry,
  codes: readonly number[] = DEFAULT_NIGHT_CODES,
  colors: Record<number, [number, number, number]> = EMISSIVE_COLORS,
): LightsGeometry | null {
  if (!g.uvs) return null;
  const want = new Set(codes);
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const parCode: Record<number, number> = {};
  for (let t = 0; t < g.indices.length; t += 3) {
    const a = g.indices[t];
    const code = Math.round(g.uvs[a * 2]);
    if (!want.has(code)) continue;
    parCode[code] = (parCode[code] ?? 0) + 1;
    const c = colors[code] ?? [1, 1, 1];
    for (let k = 0; k < 3; k++) {
      const v = g.indices[t + k];
      pos.push(g.positions[v * 3], g.positions[v * 3 + 1], g.positions[v * 3 + 2]);
      nor.push(g.normals[v * 3], g.normals[v * 3 + 1], g.normals[v * 3 + 2]);
      col.push(c[0], c[1], c[2], 1);
    }
  }
  if (!pos.length) return null;
  const n = pos.length / 3;
  const indices = new Uint32Array(n);
  for (let i = 0; i < n; i++) indices[i] = i;
  return { positions: new Float32Array(pos), normals: new Float32Array(nor), colors: new Float32Array(col), indices, parCode };
}

/**
 * Écrit dans `buf` (16 flottants par instance, ordre colonne de Babylon) la matrice
 * échelle × rotation autour de Y (lacet, radians) × translation.
 * Lacet 0 : l'avant du modèle regarde vers +Z ; lacet π/2 : vers +X.
 */
export function writeInstanceMatrix(
  buf: Float32Array,
  i: number,
  x: number,
  y: number,
  z: number,
  yaw = 0,
  scale = 1,
): void {
  const c = Math.cos(yaw) * scale;
  const s = Math.sin(yaw) * scale;
  const o = i * 16;
  buf[o] = c; buf[o + 1] = 0; buf[o + 2] = -s; buf[o + 3] = 0;
  buf[o + 4] = 0; buf[o + 5] = scale; buf[o + 6] = 0; buf[o + 7] = 0;
  buf[o + 8] = s; buf[o + 9] = 0; buf[o + 10] = c; buf[o + 11] = 0;
  buf[o + 12] = x; buf[o + 13] = y; buf[o + 14] = z; buf[o + 15] = 1;
}

/** Boîte englobante (min, max) d'un tableau de positions. */
export function boundsOf(positions: ArrayLike<number>): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max };
}
