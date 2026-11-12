/**
 * Nivellement du terrain sous les chaussées : la carte de hauteurs est modifiée pour que le sol
 * affleure sous la route (déblai / remblai) avec un talus progressif, hors travées de pont.
 * À appliquer côté simulation (le terrain est la vérité de la simulation) puis renvoyé au rendu.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import type { TerrainData } from '../../shared/contracts';
import { evalCubic, derivCubic } from './bezier';
import type { RoadNetwork } from './network';
import { profileHeightAt, profileIsBridge } from './profile';
import { ROAD_KINDS, totalWidth } from './types';

/** Profondeur de la plateforme sous la surface de roulement (m) : évite le z-fighting avec le terrain. */
export const GRADE_DEPTH = 0.2;
/** Largeur du talus de part et d'autre de la plateforme (m). */
export const SLOPE_WIDTH = 10;

/**
 * Modifie `terrain.heights` en place pour les tronçons donnés (tous si absent).
 * Renvoie la boîte des échantillons modifiés (pour ne remailler que les chunks concernés) ou null.
 */
export function gradeTerrainForRoads(terrain: TerrainData, net: RoadNetwork, segIds?: readonly number[]): { i0: number; j0: number; i1: number; j1: number } | null {
  const ids = segIds ?? net.segmentIds();
  const W = terrain.samplesX, H = terrain.samplesZ, sp = terrain.spacing;
  // Hauteur cible et poids par échantillon (le plus fort poids gagne ; à poids égal, la route la plus proche).
  const target = new Map<number, { h: number; w: number; lon: number }>();
  const p = new Float64Array(2), d = new Float64Array(2);
  const platform = new Map<number, number>();
  let bi0 = W, bj0 = H, bi1 = -1, bj1 = -1;
  for (const id of ids) {
    if (!net.hasSegment(id)) continue;
    const kind = ROAD_KINDS[net.kindOf(id)];
    const half = totalWidth(kind) / 2 + 0.5;
    const reach = half + SLOPE_WIDTH;
    const prof = net.profile(id);
    const arc = net.arc(id);
    const c = net.curve(id);
    const step = Math.min(2, sp / 2);
    const local = new Map<number, { h: number; lon: number }>();
    const n = Math.max(2, Math.ceil(arc.length / step));
    for (let k = 0; k <= n; k++) {
      const s = (k / n) * arc.length;
      if (profileIsBridge(prof, s)) continue;
      const t = arc.tAt(s);
      evalCubic(c, t, p); derivCubic(c, t, d);
      const l = Math.hypot(d[0]!, d[1]!) || 1;
      const nx = d[1]! / l, nz = -d[0]! / l;
      const h = profileHeightAt(prof, s) - GRADE_DEPTH;
      const i0 = Math.max(0, Math.floor((p[0]! - reach - terrain.originX) / sp));
      const i1 = Math.min(W - 1, Math.ceil((p[0]! + reach - terrain.originX) / sp));
      const j0 = Math.max(0, Math.floor((p[1]! - reach - terrain.originZ) / sp));
      const j1 = Math.min(H - 1, Math.ceil((p[1]! + reach - terrain.originZ) / sp));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const x = terrain.originX + i * sp, z = terrain.originZ + j * sp;
          const dx = x - p[0]!, dz = z - p[1]!;
          // Distance latérale (perpendiculaire) et longitudinale au point d'échantillonnage.
          const lat = Math.abs(dx * nx + dz * nz);
          const lon = Math.abs(dx * -nz + dz * nx);
          if (lon > step * 0.75 + sp * 0.75) continue;
          if (lat > reach) continue;
          const w = lat <= half + sp * 0.5 ? 1 : 1 - (lat - half - sp * 0.5) / (reach - half - sp * 0.5);
          if (w <= 0) continue;
          const key = j * W + i;
          if (w >= 1) {
            // Plateforme de CE tronçon : échantillon le plus proche en long.
            const lp = local.get(key);
            if (!lp || lon < lp.lon) local.set(key, { h, lon });
          }
          const cur = target.get(key);
          if (!cur || w > cur.w + 1e-6 || (w > cur.w - 1e-6 && lon < cur.lon)) target.set(key, { h, w, lon });
        }
      }
    }
    // Le terrain reste sous TOUTES les chaussées qui le recouvrent (carrefours) : minimum entre tronçons.
    for (const [key, { h }] of local) {
      const pm = platform.get(key);
      if (pm === undefined || h < pm) platform.set(key, h);
    }
  }
  for (const [key, { h, w }] of target) {
    const i = key % W, j = (key - i) / W;
    const old = terrain.heights[key]!;
    const ws = w * w * (3 - 2 * w); // talus adouci
    // Au cœur de la plateforme le terrain affleure ; sur le talus on mélange.
    const pm = platform.get(key);
    terrain.heights[key] = pm !== undefined ? pm : old + (h - old) * ws;
    if (i < bi0) bi0 = i; if (j < bj0) bj0 = j; if (i > bi1) bi1 = i; if (j > bj1) bj1 = j;
  }
  return bi1 < 0 ? null : { i0: bi0, j0: bj0, i1: bi1, j1: bj1 };
}
