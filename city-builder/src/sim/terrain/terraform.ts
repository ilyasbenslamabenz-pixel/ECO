/**
 * Terraformation côté simulation (données de hauteur faisant foi). TypeScript pur.
 * Les opérations modifient `heights` (et `waterSurface` si présent) dans un disque de rayon donné
 * avec une atténuation douce, puis renvoient la région modifiée et le volume de terre déplacé
 * (pour le coût). Le rendu reçoit un `TerrainPatch` (extractPatch -> message -> applyPatch).
 */
import { clamp, smoothstep } from '../../shared/math';
import type { TerrainData } from '../../shared/contracts';
import { NO_WATER, type SampleRect, type TerrainPatch } from './types';

export type TerraformKind = 'raise' | 'lower' | 'flatten' | 'smooth';

export interface TerraformOp {
  kind: TerraformKind;
  /** Centre (m). */
  x: number;
  z: number;
  /** Rayon du pinceau (m), borné à [4, 200]. */
  radius: number;
  /** Intensité : mètres au centre pour raise/lower, fraction 0..1 pour flatten/smooth. */
  strength: number;
  /** flatten : altitude cible (m) ; défaut = altitude au centre. */
  targetHeight?: number;
}

export interface TerraformResult {
  rect: SampleRect;
  /** Volume de terre déplacé (m³, valeur absolue). */
  volume: number;
  /** Variation maximale d'un échantillon (m). */
  maxDelta: number;
}

/** Terrain optionnellement enrichi d'une surface d'eau (WorldTerrain). */
type TerrainLike = TerrainData & { waterSurface?: Float32Array };

export const TERRAFORM_LIMITS = { minHeight: -30, maxHeight: 400, minRadius: 4, maxRadius: 200, maxStrength: 20 } as const;

/** Région d'échantillons couverte par un disque, bornée à la carte ; null si hors carte. */
export function rectForDisc(t: TerrainData, x: number, z: number, radius: number): SampleRect | null {
  const i0 = Math.max(0, Math.floor((x - radius - t.originX) / t.spacing));
  const j0 = Math.max(0, Math.floor((z - radius - t.originZ) / t.spacing));
  const i1 = Math.min(t.samplesX - 1, Math.ceil((x + radius - t.originX) / t.spacing));
  const j1 = Math.min(t.samplesZ - 1, Math.ceil((z + radius - t.originZ) / t.spacing));
  if (i0 > i1 || j0 > j1) return null;
  return { i0, j0, i1, j1 };
}

/** Applique une opération ; renvoie null si l'opération est hors carte ou invalide. */
export function applyTerraform(t: TerrainLike, op: TerraformOp): TerraformResult | null {
  if (![op.x, op.z, op.radius, op.strength].every(Number.isFinite)) return null;
  const L = TERRAFORM_LIMITS;
  const radius = clamp(op.radius, L.minRadius, L.maxRadius);
  const rect = rectForDisc(t, op.x, op.z, radius);
  if (!rect) return null;
  const W = t.samplesX;
  const h = t.heights;
  const cellArea = t.spacing * t.spacing;
  const ci = clamp(Math.round((op.x - t.originX) / t.spacing), 0, W - 1);
  const cj = clamp(Math.round((op.z - t.originZ) / t.spacing), 0, t.samplesZ - 1);
  const target = op.targetHeight !== undefined && Number.isFinite(op.targetHeight) ? op.targetHeight : h[cj * W + ci]!;
  const strength = clamp(op.strength, -L.maxStrength, L.maxStrength);
  // Pour 'smooth' : copie locale de la région (lecture des voisins avant écriture).
  const rw = rect.i1 - rect.i0 + 1;
  const rh = rect.j1 - rect.j0 + 1;
  let src: Float32Array | null = null;
  if (op.kind === 'smooth') {
    src = new Float32Array(rw * rh);
    for (let j = 0; j < rh; j++) for (let i = 0; i < rw; i++) src[j * rw + i] = h[(rect.j0 + j) * W + rect.i0 + i]!;
  }
  let volume = 0;
  let maxDelta = 0;
  for (let j = rect.j0; j <= rect.j1; j++) {
    for (let i = rect.i0; i <= rect.i1; i++) {
      const x = t.originX + i * t.spacing;
      const z = t.originZ + j * t.spacing;
      const d = Math.hypot(x - op.x, z - op.z);
      if (d > radius) continue;
      const w = 1 - smoothstep(radius * 0.45, radius, d);
      const k = j * W + i;
      const old = h[k]!;
      let nv = old;
      switch (op.kind) {
        case 'raise': nv = old + Math.abs(strength) * w; break;
        case 'lower': nv = old - Math.abs(strength) * w; break;
        case 'flatten': nv = old + (target - old) * clamp(Math.abs(strength), 0, 1) * w; break;
        case 'smooth': {
          const li = i - rect.i0;
          const lj = j - rect.j0;
          let s = 0;
          let n = 0;
          for (let dj = -1; dj <= 1; dj++) {
            for (let di = -1; di <= 1; di++) {
              const a = li + di;
              const b = lj + dj;
              if (a < 0 || b < 0 || a >= rw || b >= rh) continue;
              s += src![b * rw + a]!;
              n++;
            }
          }
          nv = old + (s / n - old) * clamp(Math.abs(strength), 0, 1) * w;
          break;
        }
        default: return null;
      }
      nv = clamp(nv, L.minHeight, L.maxHeight);
      const dlt = nv - old;
      h[k] = nv;
      volume += Math.abs(dlt) * cellArea;
      if (Math.abs(dlt) > maxDelta) maxDelta = Math.abs(dlt);
    }
  }
  if (t.waterSurface) updateWaterInRect(t as TerrainLike & { waterSurface: Float32Array }, rect);
  return { rect, volume, maxDelta };
}

/**
 * Met à jour la surface d'eau d'une région après modification du relief :
 * un échantillon sous le niveau de la mer devient eau s'il touche une eau de mer/lac (propagation itérative) ;
 * un échantillon remonté au-dessus de sa surface d'eau reste marqué mais n'est plus « mouillé » (ws <= h).
 */
export function updateWaterInRect(t: TerrainData & { waterSurface: Float32Array }, rect: SampleRect): void {
  const W = t.samplesX;
  const ws = t.waterSurface;
  const h = t.heights;
  const lv = t.waterLevel;
  for (let pass = 0; pass < 64; pass++) {
    let changed = false;
    for (let j = Math.max(0, rect.j0 - 1); j <= Math.min(t.samplesZ - 1, rect.j1 + 1); j++) {
      for (let i = Math.max(0, rect.i0 - 1); i <= Math.min(W - 1, rect.i1 + 1); i++) {
        const k = j * W + i;
        if (h[k]! >= lv || ws[k]! >= lv) continue;
        const nb = (i > 0 && ws[k - 1]! >= lv && h[k - 1]! < lv) || (i < W - 1 && ws[k + 1]! >= lv && h[k + 1]! < lv)
          || (j > 0 && ws[k - W]! >= lv && h[k - W]! < lv) || (j < t.samplesZ - 1 && ws[k + W]! >= lv && h[k + W]! < lv);
        if (nb) { ws[k] = lv; changed = true; }
      }
    }
    if (!changed) break;
  }
  // Un échantillon de mer exondé redevient sec.
  for (let j = rect.j0; j <= rect.j1; j++) {
    for (let i = rect.i0; i <= rect.i1; i++) {
      const k = j * W + i;
      if (ws[k] === lv && h[k]! > lv + 0.5) ws[k] = NO_WATER;
    }
  }
}

/** Copie une région (à transférer au rendu). */
export function extractPatch(t: TerrainData & { waterSurface?: Float32Array }, rect: SampleRect): TerrainPatch {
  const rw = rect.i1 - rect.i0 + 1;
  const rh = rect.j1 - rect.j0 + 1;
  const heights = new Float32Array(rw * rh);
  const waterSurface = new Float32Array(rw * rh).fill(NO_WATER);
  for (let j = 0; j < rh; j++) {
    const row = (rect.j0 + j) * t.samplesX + rect.i0;
    heights.set(t.heights.subarray(row, row + rw), j * rw);
    if (t.waterSurface) waterSurface.set(t.waterSurface.subarray(row, row + rw), j * rw);
  }
  return { ...rect, heights, waterSurface };
}

/** Applique un patch reçu sur une copie locale du terrain (côté rendu). */
export function applyPatch(t: TerrainData & { waterSurface?: Float32Array; forest?: Uint8Array; quays?: number[] }, p: TerrainPatch): void {
  const rw = p.i1 - p.i0 + 1;
  const rh = p.j1 - p.j0 + 1;
  if (p.heights.length !== rw * rh) throw new Error('Patch de terrain incohérent');
  for (let j = 0; j < rh; j++) {
    const row = (p.j0 + j) * t.samplesX + p.i0;
    t.heights.set(p.heights.subarray(j * rw, (j + 1) * rw), row);
    if (t.waterSurface) t.waterSurface.set(p.waterSurface.subarray(j * rw, (j + 1) * rw), row);
    if (t.forest && p.forest && p.forest.length === rw * rh) t.forest.set(p.forest.subarray(j * rw, (j + 1) * rw), row);
  }
  if (p.quays) t.quays = p.quays.slice();
}

/** Fusionne deux régions. */
export function unionRect(a: SampleRect, b: SampleRect): SampleRect {
  return { i0: Math.min(a.i0, b.i0), j0: Math.min(a.j0, b.j0), i1: Math.max(a.i1, b.i1), j1: Math.max(a.j1, b.j1) };
}
