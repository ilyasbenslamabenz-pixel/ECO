/**
 * Module terrain de la simulation (propriétaire : agent terrain / environnement).
 * TypeScript pur, exécuté dans le worker de simulation : génération procédurale paramétrable,
 * hydrologie, couches environnementales, terraformation et patchs pour le rendu.
 */
export * from './types';
export { DEFAULT_WORLD_PARAMS, normalizeParams, generateWorld, computeFlow, erode, boxBlur, slopeAt, waterDistance } from './generate';
export { applyTerraform, applyPatch, extractPatch, rectForDisc, unionRect, updateWaterInRect, TERRAFORM_LIMITS } from './terraform';
export type { TerraformKind, TerraformOp, TerraformResult } from './terraform';
export { gradNoise2, fbm, ridged, hash01 } from './noise';

import type { WorldTerrain } from './types';

/** Buffers à transférer quand un WorldTerrain est envoyé au rendu (instantané). */
export function worldTransferables(t: WorldTerrain): ArrayBuffer[] {
  const out = [t.heights.buffer, t.waterSurface.buffer, t.moisture.buffer, t.forest.buffer, t.resources.buffer] as ArrayBuffer[];
  for (const r of t.rivers) out.push(r.points.buffer as ArrayBuffer);
  return out;
}

/** Vrai si l'objet reçu porte les couches environnementales d'un WorldTerrain. */
export function isWorldTerrain(t: unknown): t is WorldTerrain {
  const o = t as Partial<WorldTerrain> | null;
  return !!o && o.waterSurface instanceof Float32Array && o.forest instanceof Uint8Array && Array.isArray(o.rivers);
}
