/**
 * Nivellement du terrain sous les chaussées : la carte de hauteurs est modifiée pour que le sol
 * affleure sous la route (plateforme) et passe JUSTE SOUS le talus maillé par le rendu (remblai : terrain relevé
 * sous la pente 1/2 ; déblai : terrain creusé sous la pente 1/1,5), hors ponts, tunnels et au-delà des murs de
 * soutènement. La carte (8 m) est trop grossière pour dessiner le talus : le rendu le maille finement
 * (src/render/roads/builder.ts) et le raccorde au terrain ; le nivellement garantit seulement que le terrain ne
 * traverse ni la chaussée ni le talus.
 * À appliquer côté simulation (le terrain est la vérité de la simulation) puis renvoyé au rendu.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import type { TerrainData } from '../../shared/contracts';
import { evalCubic, derivCubic } from './bezier';
import type { RoadNetwork } from './network';
import { profileHeightAt } from './profile';
import { CUT_RATIO, FILL_RATIO, MAX_TALUS_WIDTH, edgeTopY } from './sides';
import { ROAD_KINDS, totalWidth } from './types';

/** Profondeur de la plateforme sous la surface de roulement (m) : évite le z-fighting avec le terrain. */
export const GRADE_DEPTH = 0.2;
/** Marge (m) du terrain sous le talus maillé. */
const TALUS_MARGIN = 0.3;
/** Largeur maximale de terrain touché de part et d'autre de la chaussée (m) : talus + une maille. */
export const SLOPE_WIDTH = MAX_TALUS_WIDTH + 8;

const enum C { Platform = 0, Lower = 1, Upper = 2 }

/**
 * Modifie `terrain.heights` en place pour les tronçons donnés (tous si absent).
 * Renvoie la boîte des échantillons modifiés (pour ne remailler que les chunks concernés) ou null.
 */
export function gradeTerrainForRoads(terrain: TerrainData, net: RoadNetwork, segIds?: readonly number[]): { i0: number; j0: number; i1: number; j1: number } | null {
  const ids = segIds ?? net.segmentIds();
  const W = terrain.samplesX, H = terrain.samplesZ, sp = terrain.spacing;
  const natural = terrain.heights;
  // Contraintes fusionnées entre tronçons : plateforme (min), borne basse des remblais (max), borne haute des déblais (min).
  const platform = new Map<number, number>();
  const lower = new Map<number, number>();
  const upper = new Map<number, number>();
  const p = new Float64Array(2), d = new Float64Array(2);
  for (const id of ids) {
    if (!net.hasSegment(id)) continue;
    const kind = ROAD_KINDS[net.kindOf(id)];
    const ht = totalWidth(kind) / 2;
    const top = edgeTopY(kind);
    const reach = ht + MAX_TALUS_WIDTH + sp;
    const prof = net.profile(id);
    const arc = net.arc(id);
    const c = net.curve(id);
    const step = Math.min(2, sp / 2);
    const n = Math.max(2, Math.ceil(arc.length / step));
    // Contrainte de CE tronçon par échantillon : celle de la station la plus proche en long.
    const local = new Map<number, { lon: number; c: C; v: number }>();
    const at = (s: number): number => Math.min(prof.count - 1, Math.max(0, Math.round(s / prof.step)));
    const open = (s: number): boolean => { const i = at(s); return !prof.bridge[i] && !prof.tunnel[i]; };
    for (let k = 0; k <= n; k++) {
      const s = (k / n) * arc.length;
      if (!open(s)) continue;
      const t = arc.tAt(s);
      evalCubic(c, t, p); derivCubic(c, t, d);
      const l = Math.hypot(d[0]!, d[1]!) || 1;
      const tx = d[0]! / l, tz = d[1]! / l;
      const nx = tz, nz = -tx;
      const road = profileHeightAt(prof, s);
      const edgeY = road + top;
      const idx = at(s);
      const wl = prof.wallL?.[idx] === 1, wr = prof.wallR?.[idx] === 1;
      const i0 = Math.max(0, Math.floor((p[0]! - reach - terrain.originX) / sp));
      const i1 = Math.min(W - 1, Math.ceil((p[0]! + reach - terrain.originX) / sp));
      const j0 = Math.max(0, Math.floor((p[1]! - reach - terrain.originZ) / sp));
      const j1 = Math.min(H - 1, Math.ceil((p[1]! + reach - terrain.originZ) / sp));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const x = terrain.originX + i * sp, z = terrain.originZ + j * sp;
          const dx = x - p[0]!, dz = z - p[1]!;
          const latS = dx * nx + dz * nz;
          const lonS = dx * tx + dz * tz;
          const lat = Math.abs(latS), lon = Math.abs(lonS);
          if (lon > step * 0.75 + sp * 0.75) continue;
          if (lat > reach) continue;
          // Pas de nivellement au-delà d'un portail de tunnel ou d'une culée de pont.
          if (!open(s + lonS)) continue;
          const key = j * W + i;
          const nat = natural[key]!;
          const e = lat - ht;
          let cst: C, v: number;
          if (e <= 0.3) { cst = C.Platform; v = road - GRADE_DEPTH; }
          else {
            const wall = latS > 0 ? wl : wr;
            if (nat > edgeY - GRADE_DEPTH) {
              // Déblai : bande voisine creusée au niveau de la chaussée (le terrain ne doit pas traverser le bord),
              // puis terrain sous le talus (sauf derrière un mur : terrain naturel).
              if (e <= sp) { cst = C.Upper; v = road - GRADE_DEPTH; }
              else if (wall) continue;
              else { cst = C.Upper; v = edgeY + e / CUT_RATIO - TALUS_MARGIN; if (v >= nat) continue; }
            } else {
              if (wall) continue;
              cst = C.Lower; v = edgeY - e / FILL_RATIO - TALUS_MARGIN;
              if (v <= nat) continue;
            }
          }
          const cur = local.get(key);
          if (!cur || lon < cur.lon) local.set(key, { lon, c: cst, v });
        }
      }
    }
    for (const [key, { c: cst, v }] of local) {
      const m = cst === C.Platform ? platform : cst === C.Lower ? lower : upper;
      const old = m.get(key);
      if (old === undefined || (cst === C.Lower ? v > old : v < old)) m.set(key, v);
    }
  }
  let bi0 = W, bj0 = H, bi1 = -1, bj1 = -1;
  const touch = (key: number, h: number): void => {
    if (terrain.heights[key] === h) return;
    terrain.heights[key] = h;
    const i = key % W, j = (key - i) / W;
    if (i < bi0) bi0 = i; if (j < bj0) bj0 = j; if (i > bi1) bi1 = i; if (j > bj1) bj1 = j;
  };
  for (const [key, h] of platform) touch(key, h);
  for (const key of new Set([...lower.keys(), ...upper.keys()])) {
    if (platform.has(key)) continue;
    let h = natural[key]!;
    const lo = lower.get(key), up = upper.get(key);
    if (lo !== undefined && lo > h) h = lo;
    if (up !== undefined && up < h) h = up;
    touch(key, h);
  }
  return bi1 < 0 ? null : { i0: bi0, j0: bj0, i1: bi1, j1: bj1 };
}
