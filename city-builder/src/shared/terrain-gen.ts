/**
 * Génération déterministe de la carte de hauteurs (partagée : la simulation la
 * calcule dans le worker et l'envoie au rendu ; les tests l'utilisent en Node).
 * AUCUN import de three ni du DOM.
 */
import { CHUNK_SIZE, MAX_TERRAIN_HEIGHT, TILE_SIZE, WATER_LEVEL } from './constants';
import type { TerrainData } from './contracts';
import { clamp, fbm2, smoothstep } from './math';

export function generateTerrain(seed: number, mapChunks: number): TerrainData {
  const size = mapChunks * CHUNK_SIZE;
  const spacing = TILE_SIZE;
  const samples = Math.round(size / spacing) + 1;
  const heights = new Float32Array(samples * samples);
  const origin = -size / 2;
  const half = size / 2;
  for (let j = 0; j < samples; j++) {
    for (let i = 0; i < samples; i++) {
      const x = origin + i * spacing;
      const z = origin + j * spacing;
      // Distance normalisée au centre (0 au centre, 1 au bord).
      const r = Math.max(Math.abs(x), Math.abs(z)) / half;
      // Plaine centrale constructible, collines vers les bords.
      const hills = fbm2(x / 420, z / 420, seed, 5);
      const detail = fbm2(x / 90, z / 90, seed + 77, 3);
      const edge = smoothstep(0.45, 1.0, r);
      let h = 8 + (detail - 0.5) * 3 + edge * hills * MAX_TERRAIN_HEIGHT;
      // Rivière sinueuse traversant la carte selon X.
      const riverZ = Math.sin(x / 310 + seed * 0.001) * size * 0.08 + size * 0.28;
      const dRiver = Math.abs(z - riverZ);
      const riverCarve = 1 - smoothstep(18, 70, dRiver);
      h = h * (1 - riverCarve) + (WATER_LEVEL - 3) * riverCarve;
      heights[j * samples + i] = clamp(h, -5, MAX_TERRAIN_HEIGHT + 10);
    }
  }
  return { samplesX: samples, samplesZ: samples, spacing, originX: origin, originZ: origin, heights, waterLevel: WATER_LEVEL };
}

/** Hauteur bilinéaire en (x,z). Hors carte : hauteur du bord le plus proche. */
export function terrainHeightAt(t: TerrainData, x: number, z: number): number {
  const fx = clamp((x - t.originX) / t.spacing, 0, t.samplesX - 1);
  const fz = clamp((z - t.originZ) / t.spacing, 0, t.samplesZ - 1);
  const i0 = Math.min(Math.floor(fx), t.samplesX - 2);
  const j0 = Math.min(Math.floor(fz), t.samplesZ - 2);
  const tx = fx - i0;
  const tz = fz - j0;
  const w = t.samplesX;
  const h00 = t.heights[j0 * w + i0]!;
  const h10 = t.heights[j0 * w + i0 + 1]!;
  const h01 = t.heights[(j0 + 1) * w + i0]!;
  const h11 = t.heights[(j0 + 1) * w + i0 + 1]!;
  return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
}

export function terrainBounds(t: TerrainData): { minX: number; minZ: number; maxX: number; maxZ: number } {
  return {
    minX: t.originX,
    minZ: t.originZ,
    maxX: t.originX + (t.samplesX - 1) * t.spacing,
    maxZ: t.originZ + (t.samplesZ - 1) * t.spacing,
  };
}
