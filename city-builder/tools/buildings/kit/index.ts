/**
 * KIT MODULAIRE DE BÂTIMENTS — API publique (voir docs/BUILDING_KIT.md).
 * Propriétaire : directeur artistique / artiste bâtiments résidentiels. Utilisé aussi par l'artiste
 * bâtiments commerciaux / industriels / publics / gratte-ciel.
 */
export * from './mesh';
export * from './materials';
export * from './facade';
export * from './roofs';
export * from './building';
export { writeGlb, hexToLinear } from './glb';
export { KIT_TEXTURES, buildKitTextureSets, mergeTextureSets } from './textures';
