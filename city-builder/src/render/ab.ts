/**
 * Bascules A/B de la page de mesure (?bench), lues dans l'adresse et jamais mémorisées : chacune rétablit
 * l'ancien comportement d'un changement de rendu pour le comparer sur la machine du joueur.
 *  - `ordre=0`  : ancien ordre de dessin (terrain et surfaces de routes au même rang que les autres objets) ;
 *  - `terrain=0`: ancien shader du terrain (toutes les couches de poids > 0,004 lues) ;
 *  - `aniso=8`  : ancienne anisotropie (8 aussi pour les normales et la rugosité) ;
 *  - `trace=0`  : sans la ventilation processeur de la page de mesure.
 */
function param(name: string): string | null {
  try { return new URLSearchParams(globalThis.location?.search ?? '').get(name); } catch { return null; }
}

export const ab = {
  /** Terrain dessiné après les objets opaques, surfaces de routes juste avant lui. */
  drawOrder: param('ordre') !== '0',
  /** Shader du terrain allégé (couches sans effet sautées). */
  terrainOpt: param('terrain') !== '0',
  /** Anisotropie maximale des textures non colorées (normales, rugosité, occlusion). */
  dataAniso: param('aniso') === '8' ? 16 : 4,
  /** Ventilation processeur de la page de mesure. */
  trace: param('trace') !== '0',
};

/** Résumé lisible (tableau de la page de mesure). */
export function abSummary(): string {
  return `ordre de dessin ${ab.drawOrder ? 'nouveau' : 'ancien'} · shader terrain ${ab.terrainOpt ? 'allégé' : 'ancien'} · anisotropie normales ${ab.dataAniso >= 8 ? 'complète' : '4'} · trace CPU ${ab.trace ? 'oui' : 'non'}`;
}
