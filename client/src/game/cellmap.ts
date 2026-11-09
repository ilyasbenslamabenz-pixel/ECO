// Carte des îlots (maille de 200 m) partagée entre les bâtiments (cities.ts), le sol (landscape.ts) et le
// mobilier (roads.ts) : nature de chaque îlot, pour que le sol peigne ce que les volumes ne dessinent pas
// (lotissements lointains, jardins, squares arborés) sans aucun appel de rendu supplémentaire.
import { RawTexture, Texture, type Scene } from '@babylonjs/core';
import { HALF_D, HALF_W } from '../../../shared/sim/country';

export const CELL_KM = 0.2;
export const CI0 = Math.ceil(-HALF_W / CELL_KM);
export const CJ0 = Math.ceil(-HALF_D / CELL_KM);
export const CNI = Math.round((2 * HALF_W) / CELL_KM);
export const CNJ = Math.round((2 * HALF_D) / CELL_KM);

/** Nature d'un îlot (valeur × 40 dans la texture). */
export const CK = { none: 0, built: 1, tall: 2, lot: 3, square: 4, court: 5 } as const;

const data = new Uint8Array(CNI * CNJ);
let tex: RawTexture | null = null;

const idx = (i: number, j: number) => (i < CI0 || j < CJ0 || i >= CI0 + CNI || j >= CJ0 + CNJ ? -1 : (j - CJ0) * CNI + (i - CI0));

export function setCell(i: number, j: number, kind: number) {
  const k = idx(i, j);
  if (k >= 0) data[k] = kind * 40;
}
export function cellKind(i: number, j: number) {
  const k = idx(i, j);
  return k >= 0 ? Math.round(data[k] / 40) : 0;
}
/** Nature de l'îlot qui contient le point (x, z). */
export function cellAt(x: number, z: number) {
  return cellKind(Math.floor(x / CELL_KM), Math.floor(z / CELL_KM));
}

/** Square de quartier (îlot planté, sans bâtiment) : tirage déterministe par îlot, environ 1 îlot sur 22. */
export function squareCell(seed: number, i: number, j: number) {
  let h = (i * 374761393 + j * 668265263 + seed * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return ((h >>> 0) % 1000) / 1000 < 0.045;
}

/** Texture (luminance, échantillonnage au plus proche) lue par le sol. */
export function cellTexture(scene: Scene) {
  data.fill(0);
  tex?.dispose();
  tex = RawTexture.CreateLuminanceTexture(data, CNI, CNJ, scene, false, false, Texture.NEAREST_SAMPLINGMODE);
  tex.wrapU = tex.wrapV = Texture.CLAMP_ADDRESSMODE;
  return tex;
}
/** Envoie la carte modifiée au GPU. */
export function commitCells() {
  tex?.update(data);
}
