/**
 * Génération procédurale du monde (exécutée dans le worker de simulation ; TypeScript pur).
 *
 * Étapes (déterministes pour une graine et des paramètres donnés) :
 *  1. forme de base : plaine centrale, collines (fBm à domaine distordu), montagnes de bordure
 *     (bruit en crêtes), mer sur un côté ou lac intérieur ;
 *  2. érosion hydraulique simplifiée par gouttes (transport / dépôt de sédiments) ;
 *  3. aplanissement de la plaine centrale (zone constructible) ;
 *  4. hydrologie : remplissage des cuvettes (priority-flood), directions d'écoulement D8,
 *     accumulation du ruissellement, extraction des rivières ; les rivières creusent leur lit
 *     jusqu'à la mer / au lac / au bord de carte ; cuvettes profondes => lacs d'altitude ;
 *  5. plages adoucies autour du niveau de la mer ;
 *  6. couches : humidité (distance à l'eau + bruit), forêt, ressources.
 */
import { CHUNK_SIZE, MAX_TERRAIN_HEIGHT, TILE_SIZE, WATER_LEVEL } from '../../shared/constants';
import { clamp, mulberry32, smoothstep } from '../../shared/math';
import { fbm, hash01, ridged, warp } from './noise';
import { NO_WATER, RESOURCE, TERRAIN_GEN_VERSION, type RiverPath, type WorldGenParams, type WorldTerrain } from './types';

export const DEFAULT_WORLD_PARAMS: WorldGenParams = {
  seed: 1,
  mapChunks: 8,
  samplesPerTile: 1,
  maxAltitude: 140,
  relief: 0.5,
  forest: 0.55,
  hydrology: 'mer',
  rivers: 0.5,
  erosion: 0.6,
  resources: 0.5,
  genVersion: TERRAIN_GEN_VERSION,
  riverMode: 'une',
};

/** v2 : part du terrain sec couverte de bosquets par unité de `forest` (0,55 par défaut => ≈ 22 % du terrain sec). */
export const FOREST_V2_SHARE = 0.4;

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Complète et borne les paramètres (le worker ne fait pas confiance aux entrées). */
export function normalizeParams(p: Partial<WorldGenParams>): WorldGenParams {
  const d = DEFAULT_WORLD_PARAMS;
  const hyd = p.hydrology === 'lac' || p.hydrology === 'aucune' || p.hydrology === 'mer' ? p.hydrology : d.hydrology;
  return {
    seed: Math.floor(num(p.seed, d.seed)) | 0,
    mapChunks: clamp(Math.round(num(p.mapChunks, d.mapChunks)), 1, 32),
    samplesPerTile: p.samplesPerTile === 2 ? 2 : 1,
    maxAltitude: clamp(num(p.maxAltitude, d.maxAltitude), 20, 300),
    relief: clamp(num(p.relief, d.relief), 0, 1),
    forest: clamp(num(p.forest, d.forest), 0, 1),
    hydrology: hyd,
    rivers: clamp(num(p.rivers, d.rivers), 0, 1),
    erosion: clamp(num(p.erosion, d.erosion), 0, 1),
    resources: clamp(num(p.resources, d.resources), 0, 1),
    genVersion: p.genVersion === 1 ? 1 : 2,
    riverMode: p.riverMode === 'aucune' || p.riverMode === 'plusieurs' || p.riverMode === 'une' ? p.riverMode : d.riverMode,
  };
}

/* ------------------------------------------------------------------ */
/* Utilitaires grille                                                   */
/* ------------------------------------------------------------------ */

/** Flou boîte séparable (rayon en échantillons) : renvoie un nouveau tableau. */
export function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      let s = 0;
      let n = 0;
      for (let k = -r; k <= r; k++) {
        const ii = i + k;
        if (ii < 0 || ii >= w) continue;
        s += src[j * w + ii]!;
        n++;
      }
      tmp[j * w + i] = s / n;
    }
  }
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      let s = 0;
      let n = 0;
      for (let k = -r; k <= r; k++) {
        const jj = j + k;
        if (jj < 0 || jj >= h) continue;
        s += tmp[jj * w + i]!;
        n++;
      }
      out[j * w + i] = s / n;
    }
  }
  return out;
}

/** Tas binaire min (clé flottante, valeur entière) sans allocation par opération. */
class MinHeap {
  private keys: Float64Array;
  private vals: Int32Array;
  size = 0;
  constructor(cap: number) {
    this.keys = new Float64Array(cap);
    this.vals = new Int32Array(cap);
  }
  push(k: number, v: number): void {
    if (this.size === this.keys.length) {
      const nk = new Float64Array(this.size * 2);
      nk.set(this.keys);
      const nv = new Int32Array(this.size * 2);
      nv.set(this.vals);
      this.keys = nk;
      this.vals = nv;
    }
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p]! <= k) break;
      this.keys[i] = this.keys[p]!;
      this.vals[i] = this.vals[p]!;
      i = p;
    }
    this.keys[i] = k;
    this.vals[i] = v;
  }
  /** Retire le minimum et renvoie sa valeur ; `lastKey` reçoit sa clé. */
  lastKey = 0;
  pop(): number {
    const top = this.vals[0]!;
    this.lastKey = this.keys[0]!;
    const n = --this.size;
    if (n > 0) {
      const k = this.keys[n]!;
      const v = this.vals[n]!;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && this.keys[r]! < this.keys[l]! ? r : l;
        if (this.keys[c]! >= k) break;
        this.keys[i] = this.keys[c]!;
        this.vals[i] = this.vals[c]!;
        i = c;
      }
      this.keys[i] = k;
      this.vals[i] = v;
    }
    return top;
  }
}

const DI = [1, -1, 0, 0, 1, 1, -1, -1];
const DJ = [0, 0, 1, -1, 1, -1, 1, -1];

/* ------------------------------------------------------------------ */
/* 1. Forme de base                                                     */
/* ------------------------------------------------------------------ */

function baseShape(p: WorldGenParams, W: number, H: number, spacing: number, origin: number, half: number): { heights: Float32Array; basinT: Float32Array; basinFloor: Float32Array } {
  const heights = new Float32Array(W * H);
  const basinT = new Float32Array(W * H);
  const basinFloor = new Float32Array(W * H);
  const s = p.seed;
  const rnd = mulberry32(s ^ 0x5eed);
  const seaAngle = rnd() * Math.PI * 2;
  const seaDx = Math.cos(seaAngle);
  const seaDz = Math.sin(seaAngle);
  const lakeX = (rnd() - 0.5) * half * 0.5;
  const lakeZ = (rnd() - 0.5) * half * 0.5;
  const lakeR = half * (0.16 + rnd() * 0.08);
  const plainAlt = WATER_LEVEL + 5;
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const x = origin + i * spacing;
      const z = origin + j * spacing;
      const w = warp(x, z, s, 1 / 900, 220);
      const wx = w.x;
      const wz = w.z;
      // Distance « carrée arrondie » au centre (0 centre, 1 bord), distordue.
      const nx = wx / half;
      const nz = wz / half;
      const r = Math.pow(Math.pow(Math.abs(nx), 4) + Math.pow(Math.abs(nz), 4), 0.25);
      // Plaine : ondulations douces.
      let h = plainAlt + fbm(x / 600, z / 600, s + 3, 4) * (2 + 6 * p.relief) + fbm(x / 140, z / 140, s + 4, 3) * (0.6 + 1.4 * p.relief);
      // Collines (anneau intermédiaire) : fBm amplifié.
      const hillMask = smoothstep(0.25, 0.7, r);
      const hills = Math.max(0, fbm(wx / 520, wz / 520, s + 11, 5) * 0.5 + 0.35);
      h += hillMask * hills * p.relief * p.maxAltitude * 0.35;
      // Montagnes de bordure : crêtes.
      const mountMask = smoothstep(0.58, 0.98, r + fbm(x / 800, z / 800, s + 21, 3) * 0.12);
      const rid = ridged(wx / 700, wz / 700, s + 31, 6);
      h += mountMask * Math.pow(rid, 1.4) * p.maxAltitude * (0.65 + 0.35 * mountMask);
      // Mer sur un côté.
      if (p.hydrology === 'mer') {
        const along = (x * seaDx + z * seaDz) / half; // -1..1 vers la mer
        const coast = 0.42 + fbm(x / 500, z / 500, s + 41, 4) * 0.18;
        const seaT = smoothstep(coast - 0.12, coast + 0.12, along);
        const seaFloor = WATER_LEVEL - 6 - 18 * smoothstep(coast, 1.1, along);
        h = h * (1 - seaT) + seaFloor * seaT;
        basinT[j * W + i] = seaT;
        basinFloor[j * W + i] = seaFloor;
        // Pas de montagnes côté mer.
        h -= mountMask * Math.pow(rid, 1.4) * p.maxAltitude * smoothstep(coast - 0.5, coast, along) * 0.8 * (1 - seaT);
      } else if (p.hydrology === 'lac') {
        const dl = Math.hypot(wx - lakeX, wz - lakeZ) / lakeR + fbm(x / 300, z / 300, s + 51, 3) * 0.25;
        const lakeT = 1 - smoothstep(0.75, 1.15, dl);
        const lakeFloor = WATER_LEVEL - 2 - 9 * (1 - smoothstep(0, 0.9, dl));
        h = h * (1 - lakeT) + lakeFloor * lakeT;
        basinT[j * W + i] = lakeT;
        basinFloor[j * W + i] = lakeFloor;
      }
      heights[j * W + i] = h;
    }
  }
  return { heights, basinT, basinFloor };
}

/* ------------------------------------------------------------------ */
/* 2. Érosion hydraulique par gouttes                                   */
/* ------------------------------------------------------------------ */

/**
 * Érosion hydraulique simplifiée (gouttes avec inertie, capacité de transport, dépôt et évaporation).
 * Travaille en unités d'échantillons (hauteur / spacing) pour être indépendante de la résolution.
 */
export function erode(heights: Float32Array, W: number, H: number, spacing: number, droplets: number, seed: number): void {
  if (droplets <= 0) return;
  const inv = 1 / spacing;
  const hm = new Float32Array(heights.length);
  for (let k = 0; k < hm.length; k++) hm[k] = heights[k]! * inv;
  const rnd = mulberry32(seed ^ 0xe20d);
  const inertia = 0.06;
  const capacityK = 4;
  const minCap = 0.01;
  const depositK = 0.3;
  const erodeK = 0.3;
  const evap = 0.02;
  const gravity = 4;
  const maxSteps = 48;
  const R = 2;
  // Pinceau d'érosion (poids normalisés).
  const bw: number[] = [];
  const bi: number[] = [];
  const bj: number[] = [];
  let bs = 0;
  for (let dj = -R; dj <= R; dj++) {
    for (let di = -R; di <= R; di++) {
      const d = Math.hypot(di, dj);
      if (d > R) continue;
      const wgt = 1 - d / R;
      bw.push(wgt); bi.push(di); bj.push(dj); bs += wgt;
    }
  }
  for (let k = 0; k < bw.length; k++) bw[k]! /= bs;
  const bn = bw.length;

  for (let n = 0; n < droplets; n++) {
    let px = 1 + rnd() * (W - 3);
    let pz = 1 + rnd() * (H - 3);
    let dx = 0;
    let dz = 0;
    let speed = 1;
    let water = 1;
    let sed = 0;
    for (let step = 0; step < maxSteps; step++) {
      const ix = Math.floor(px);
      const iz = Math.floor(pz);
      const fx = px - ix;
      const fz = pz - iz;
      const c = iz * W + ix;
      const h00 = hm[c]!;
      const h10 = hm[c + 1]!;
      const h01 = hm[c + W]!;
      const h11 = hm[c + W + 1]!;
      const gx = (h10 - h00) * (1 - fz) + (h11 - h01) * fz;
      const gz = (h01 - h00) * (1 - fx) + (h11 - h10) * fx;
      const hOld = h00 * (1 - fx) * (1 - fz) + h10 * fx * (1 - fz) + h01 * (1 - fx) * fz + h11 * fx * fz;
      dx = dx * inertia - gx * (1 - inertia);
      dz = dz * inertia - gz * (1 - inertia);
      const len = Math.hypot(dx, dz);
      if (len < 1e-9) break;
      dx /= len;
      dz /= len;
      px += dx;
      pz += dz;
      if (px < 1 || px >= W - 2 || pz < 1 || pz >= H - 2) break;
      const jx = Math.floor(px);
      const jz = Math.floor(pz);
      const gfx = px - jx;
      const gfz = pz - jz;
      const c2 = jz * W + jx;
      const hNew = hm[c2]! * (1 - gfx) * (1 - gfz) + hm[c2 + 1]! * gfx * (1 - gfz) + hm[c2 + W]! * (1 - gfx) * gfz + hm[c2 + W + 1]! * gfx * gfz;
      const dh = hNew - hOld;
      const cap = Math.max(-dh * speed * water * capacityK, minCap);
      if (sed > cap || dh > 0) {
        // Dépôt (bilinéaire au point de départ).
        const dep = dh > 0 ? Math.min(dh, sed) : (sed - cap) * depositK;
        sed -= dep;
        hm[c] = h00 + dep * (1 - fx) * (1 - fz);
        hm[c + 1] = h10 + dep * fx * (1 - fz);
        hm[c + W] = h01 + dep * (1 - fx) * fz;
        hm[c + W + 1] = h11 + dep * fx * fz;
      } else {
        // Érosion au pinceau.
        const amount = Math.min((cap - sed) * erodeK, -dh);
        for (let b = 0; b < bn; b++) {
          const ii = ix + bi[b]!;
          const jj = iz + bj[b]!;
          if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue;
          const k = jj * W + ii;
          const take = Math.min(hm[k]!, amount * bw[b]!);
          hm[k] = hm[k]! - take;
          sed += take;
        }
      }
      speed = Math.sqrt(Math.max(0, speed * speed + dh * -gravity));
      water *= 1 - evap;
    }
  }
  for (let k = 0; k < hm.length; k++) heights[k] = hm[k]! * spacing;
}

/* ------------------------------------------------------------------ */
/* 4. Hydrologie                                                        */
/* ------------------------------------------------------------------ */

interface FlowResult {
  filled: Float32Array;
  /** Index du voisin aval, -1 pour un exutoire. */
  down: Int32Array;
  /** Ordre de traitement amont -> aval. */
  order: Int32Array;
  acc: Float32Array;
}

/** Priority-flood (Barnes 2014) + directions D8 + accumulation. Exutoires : bord de carte et échantillons sous l'eau. */
export function computeFlow(h: Float32Array, W: number, H: number, waterLevel: number): FlowResult {
  const N = W * H;
  const filled = new Float32Array(N);
  const down = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const popOrder = new Int32Array(N);
  const heap = new MinHeap(4 * (W + H) + 1024);
  for (let k = 0; k < N; k++) {
    const i = k % W;
    const j = (k / W) | 0;
    if (i === 0 || j === 0 || i === W - 1 || j === H - 1 || h[k]! < waterLevel) {
      closed[k] = 1;
      filled[k] = h[k]!;
      heap.push(h[k]!, k);
    }
  }
  let nPop = 0;
  const EPS = 1e-3;
  while (heap.size > 0) {
    const c = heap.pop();
    popOrder[nPop++] = c;
    const ci = c % W;
    const cj = (c / W) | 0;
    const fc = filled[c]!;
    for (let d = 0; d < 8; d++) {
      const ni = ci + DI[d]!;
      const nj = cj + DJ[d]!;
      if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      const nk = nj * W + ni;
      if (closed[nk]) continue;
      closed[nk] = 1;
      const fn = Math.max(h[nk]!, fc + EPS);
      filled[nk] = fn;
      down[nk] = c;
      heap.push(fn, nk);
    }
  }
  // Raffinement D8 : parmi les voisins strictement plus bas (surface remplie), le plus pentu.
  for (let k = 0; k < N; k++) {
    if (down[k] === -1) continue;
    const i = k % W;
    const j = (k / W) | 0;
    let best = down[k]!;
    let bestSlope = (filled[k]! - filled[best]!) / (Math.abs((best % W) - i) + Math.abs(((best / W) | 0) - j) > 1 ? 1.4142 : 1);
    for (let d = 0; d < 8; d++) {
      const ni = i + DI[d]!;
      const nj = j + DJ[d]!;
      if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      const nk = nj * W + ni;
      const drop = filled[k]! - filled[nk]!;
      if (drop <= 0) continue;
      const slope = drop / (d < 4 ? 1 : 1.4142);
      if (slope > bestSlope) { bestSlope = slope; best = nk; }
    }
    down[k] = best;
  }
  const order = new Int32Array(N);
  for (let k = 0; k < N; k++) order[k] = popOrder[N - 1 - k]!;
  const acc = new Float32Array(N).fill(1);
  for (let o = 0; o < N; o++) {
    const k = order[o]!;
    const d = down[k]!;
    if (d >= 0) acc[d] = acc[d]! + acc[k]!;
  }
  return { filled, down, order, acc };
}

/* ------------------------------------------------------------------ */
/* Génération complète                                                  */
/* ------------------------------------------------------------------ */

export function generateWorld(input: Partial<WorldGenParams>): WorldTerrain {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const p = normalizeParams(input);
  const size = p.mapChunks * CHUNK_SIZE;
  const spacing = TILE_SIZE / p.samplesPerTile;
  const W = Math.round(size / spacing) + 1;
  const H = W;
  const N = W * H;
  const origin = -size / 2;
  const half = size / 2;
  const s = p.seed;

  // 1. Forme de base.
  const base = baseShape(p, W, H, spacing, origin, half);
  let h = base.heights;

  // 2. Érosion. Les sédiments déposés dans la mer / le lac sont ensuite retirés (le bassin reste en eau).
  const droplets = Math.round(N * 0.9 * p.erosion);
  erode(h, W, H, spacing, droplets, s);
  for (let k = 0; k < N; k++) {
    const bt = base.basinT[k]!;
    if (bt > 0) h[k] = Math.min(h[k]!, h[k]! * (1 - bt) + base.basinFloor[k]! * bt);
  }

  // 3. Plaine centrale aplanie (zone constructible) : mélange avec une version très lissée.
  const blurR = Math.max(2, Math.round(48 / spacing));
  const smooth = boxBlur(h, W, H, blurR);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const k = j * W + i;
      const x = origin + i * spacing;
      const z = origin + j * spacing;
      const r = Math.max(Math.abs(x), Math.abs(z)) / half;
      const flat = (1 - smoothstep(0.18, 0.5, r + fbm(x / 400, z / 400, s + 61, 2) * 0.1)) * 0.85;
      if (h[k]! > WATER_LEVEL + 1) h[k] = h[k]! * (1 - flat) + Math.max(smooth[k]!, WATER_LEVEL + 1.5) * flat;
    }
  }

  // 4. Hydrologie.
  const waterSurface = new Float32Array(N).fill(NO_WATER);
  const rivers: RiverPath[] = [];
  const isRiver = new Uint8Array(N);
  if (p.rivers > 0 && p.genVersion === 2 && p.riverMode === 'une') {
    h = carveMainRiver(p, h, W, H, spacing, origin, waterSurface, rivers);
  } else if (p.rivers > 0 && (p.genVersion === 1 || p.riverMode === 'plusieurs')) {
    // Perturbation (non appliquée au terrain) : fait serpenter les cours d'eau sur les plaines.
    const hFlow = new Float32Array(N);
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const x = origin + i * spacing;
        const z = origin + j * spacing;
        hFlow[j * W + i] = h[j * W + i]! + fbm(x / 260, z / 260, s + 33, 4) * 7 + fbm(x / 70, z / 70, s + 34, 2) * 1.5;
      }
    }
    const flow = computeFlow(hFlow, W, H, WATER_LEVEL);
    // La surface de référence des rivières suit le terrain réel (et non la version perturbée).
    for (let o = 0; o < N; o++) {
      const k = flow.order[o]!;
      flow.filled[k] = Math.max(h[k]!, Math.min(flow.filled[k]!, h[k]! + Math.max(0, flow.filled[k]! - hFlow[k]!)));
    }
    // Seuil d'accumulation : plus `rivers` est grand, plus le réseau est dense.
    const thr = Math.max(40, N * (0.03 - 0.024 * p.rivers));
    const riverSurf = new Float32Array(N).fill(NO_WATER);
    // Surface lissée le long du cours (amont -> aval), monotone décroissante.
    for (let o = 0; o < N; o++) {
      const k = flow.order[o]!;
      if (flow.acc[k]! < thr || h[k]! < WATER_LEVEL) continue;
      isRiver[k] = 1;
      riverSurf[k] = flow.filled[k]!;
    }
    for (let o = 0; o < N; o++) {
      const k = flow.order[o]!;
      const d = flow.down[k]!;
      if (isRiver[k] && d >= 0 && isRiver[d]) riverSurf[d] = Math.min(riverSurf[d]!, riverSurf[k]! - 0.01);
    }
    // Creusement du lit : profil en U, berges en pente douce.
    const newH = new Float32Array(h);
    for (let k = 0; k < N; k++) {
      if (!isRiver[k]) continue;
      const a = flow.acc[k]! / thr;
      const width = clamp(10 + Math.sqrt(a) * 7, 12, 44);
      const depth = 1.2 + width * 0.05;
      const surf = Math.max(WATER_LEVEL, riverSurf[k]! - 0.8);
      riverSurf[k] = surf;
      const half_w = width / 2;
      const bank = 10 + width * 0.6;
      const rad = Math.ceil((half_w + bank) / spacing);
      const ci = k % W;
      const cj = (k / W) | 0;
      for (let dj = -rad; dj <= rad; dj++) {
        for (let di = -rad; di <= rad; di++) {
          const ni = ci + di;
          const nj = cj + dj;
          if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
          const nk = nj * W + ni;
          const d = Math.hypot(di, dj) * spacing;
          let target: number;
          if (d <= half_w) target = surf - depth * (1 - (d / half_w) ** 2) - 0.25;
          else if (d <= half_w + bank) target = surf - 0.25 + ((d - half_w) / bank) ** 1.5 * bank * 0.35;
          else continue;
          if (target < newH[nk]!) newH[nk] = target;
          if (d <= half_w + spacing * 0.5) waterSurface[nk] = Math.max(waterSurface[nk]!, surf);
        }
      }
    }
    h = newH;
    // Polylignes des rivières : depuis chaque source (cellule rivière sans amont rivière) jusqu'à l'aval.
    const hasUp = new Uint8Array(N);
    for (let k = 0; k < N; k++) if (isRiver[k] && flow.down[k]! >= 0 && isRiver[flow.down[k]!]) hasUp[flow.down[k]!] = 1;
    const visited = new Uint8Array(N);
    for (let o = 0; o < N; o++) {
      const k0 = flow.order[o]!;
      if (!isRiver[k0] || hasUp[k0]) continue;
      const pts: number[] = [];
      let k = k0;
      let lastFlow = 0;
      let guard = 0;
      while (k >= 0 && guard++ < N) {
        const a = flow.acc[k]! / thr;
        pts.push(origin + (k % W) * spacing, riverSurf[k] === NO_WATER ? WATER_LEVEL : riverSurf[k]!, origin + ((k / W) | 0) * spacing, clamp(10 + Math.sqrt(a) * 7, 12, 44));
        lastFlow = flow.acc[k]!;
        if (visited[k] && pts.length > 4) break; // rejoint un cours déjà tracé (confluence)
        visited[k] = 1;
        const d = flow.down[k]!;
        if (d < 0 || !isRiver[d]) {
          if (d >= 0) {
            // Embouchure : dernier point dans l'eau.
            pts.push(origin + (d % W) * spacing, WATER_LEVEL, origin + ((d / W) | 0) * spacing, pts[pts.length - 1]!);
          }
          break;
        }
        k = d;
      }
      if (pts.length >= 12) rivers.push({ points: new Float32Array(pts), flow: lastFlow });
    }
    rivers.sort((a, b) => b.flow - a.flow);
    // Lacs d'altitude : cuvettes profondes (> 1,5 m) et étendues.
    for (let k = 0; k < N; k++) {
      const depthPit = flow.filled[k]! - h[k]!;
      if (depthPit > 1.5 && h[k]! > WATER_LEVEL && flow.acc[k]! > thr * 0.25) waterSurface[k] = Math.max(waterSurface[k]!, flow.filled[k]! - 0.3);
    }
  }

  // 5. Plages : adoucissement de la bande littorale.
  const beachBlur = boxBlur(h, W, H, Math.max(1, Math.round(16 / spacing)));
  for (let k = 0; k < N; k++) {
    const v = h[k]!;
    const t = 1 - smoothstep(1.5, 4.5, Math.abs(v - (WATER_LEVEL + 0.6)));
    if (t > 0 && waterSurface[k] === NO_WATER) h[k] = v * (1 - t * 0.7) + beachBlur[k]! * t * 0.7;
  }
  // Mer / lac au niveau global.
  for (let k = 0; k < N; k++) {
    if (h[k]! < WATER_LEVEL) waterSurface[k] = Math.max(waterSurface[k]!, WATER_LEVEL);
    h[k] = clamp(h[k]!, -40, Math.max(MAX_TERRAIN_HEIGHT, p.maxAltitude) * 1.6);
  }

  // 6. Couches environnementales.
  const dist = waterDistance(waterSurface, h, W, H, spacing);
  const moisture = new Uint8Array(N);
  const forest = new Uint8Array(N);
  const resources = new Uint8Array(N);
  let buildable = 0;
  let water = 0;
  let forestN = 0;
  let minH = Infinity;
  let maxH = -Infinity;
  // v2 : champ des bosquets et seuil tel qu'une part `FOREST_V2_SHARE * forest` du terrain sec soit boisée.
  const grovesAt = (x: number, z: number): number => fbm(x / 520, z / 520, s + 83, 3) * 0.5 + 0.5 + fbm(x / 110, z / 110, s + 84, 2) * 0.07;
  let grovesThr = Infinity;
  if (p.genVersion === 2 && p.forest > 0) {
    const vals: number[] = [];
    for (let k = 0; k < N; k += 3) {
      if (waterSurface[k]! > h[k]! || dist[k]! <= 6) continue;
      vals.push(grovesAt(origin + (k % W) * spacing, origin + ((k / W) | 0) * spacing));
    }
    vals.sort((a, b) => a - b);
    const share = clamp(FOREST_V2_SHARE * p.forest, 0, 0.95);
    if (vals.length) grovesThr = vals[Math.min(vals.length - 1, Math.floor(vals.length * (1 - share)))]!;
  }
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const k = j * W + i;
      const x = origin + i * spacing;
      const z = origin + j * spacing;
      const v = h[k]!;
      if (v < minH) minH = v;
      if (v > maxH) maxH = v;
      const slope = slopeAt(h, W, H, i, j, spacing);
      const wet = waterSurface[k]! > v;
      if (wet) water++;
      else if (slope <= 0.12) buildable++;
      const altN = clamp((v - WATER_LEVEL) / Math.max(1, p.maxAltitude), 0, 1);
      const m = clamp(Math.exp(-dist[k]! / 260) * 0.55 + (fbm(x / 700, z / 700, s + 71, 4) * 0.5 + 0.5) * 0.5 - altN * 0.25 + 0.1, 0, 1);
      moisture[k] = Math.round(m * 255);
      // Forêt.
      if (!wet && dist[k]! > 6) {
        const r = Math.max(Math.abs(x), Math.abs(z)) / half;
        const patches = fbm(x / 380, z / 380, s + 81, 4) * 0.5 + 0.5 + fbm(x / 90, z / 90, s + 82, 2) * 0.12;
        const cover = p.forest;
        let f: number;
        if (p.genVersion === 1) {
          const thrP = 1 - cover * 0.85; // seuil des clairières
          f = smoothstep(thrP - 0.08, thrP + 0.12, patches * (0.6 + 0.6 * m));
        } else {
          // v2 : bosquets regroupés (bruit à grande échelle, lisières nettes) séparés de grandes clairières ; seuil
          // par quantile (part du terrain sec boisée stable d'une graine à l'autre).
          f = smoothstep(grovesThr - 0.02, grovesThr + 0.06, grovesAt(x, z)) * clamp(0.7 + 0.45 * m, 0, 1) * (0.8 + 0.2 * smoothstep(0.4, 0.8, patches));
        }
        f *= 1 - smoothstep(0.35, 0.8, slope); // pas sur les falaises
        f *= 1 - smoothstep(0.7, 0.92, altN); // limite de la végétation
        f *= 1 - smoothstep(WATER_LEVEL + 3.5, WATER_LEVEL + 1.5, v); // pas sur la plage
        if (p.genVersion === 1) f *= 0.35 + 0.65 * smoothstep(0.2, 0.42, r); // plaine centrale plus dégagée (place pour la ville)
        else f *= 0.1 + 0.9 * smoothstep(0.24, 0.55, r); // v2 : plaine centrale presque entièrement dégagée
        const fv = Math.round(clamp(f, 0, 1) * 255);
        forest[k] = fv;
        if (fv > 64) forestN++;
      }
      // Ressources.
      const rnoise = hash01(i >> 2, j >> 2, s + 91) * 0.15 + fbm(x / 250, z / 250, s + 92, 3) * 0.5 + 0.5;
      const ab = 0.35 + p.resources * 0.65;
      let res: number = RESOURCE.AUCUNE;
      if (!wet) {
        if (altN > 0.35 && slope > 0.25 && rnoise > 1.05 - ab * 0.45) res = RESOURCE.MINERAI;
        else if (altN > 0.15 && slope > 0.18 && rnoise > 0.95 - ab * 0.35) res = RESOURCE.PIERRE;
        else if (dist[k]! < 40 && v < WATER_LEVEL + 6 && rnoise > 0.9 - ab * 0.4) res = RESOURCE.SABLE_GRAVIER;
        else if (slope < 0.08 && m > 0.55 && altN < 0.2 && rnoise > 0.85 - ab * 0.4) res = RESOURCE.TERRE_FERTILE;
      }
      resources[k] = res;
    }
  }
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return {
    samplesX: W,
    samplesZ: H,
    spacing,
    originX: origin,
    originZ: origin,
    heights: h,
    waterLevel: WATER_LEVEL,
    params: p,
    waterSurface,
    moisture,
    forest,
    resources,
    rivers,
    stats: {
      minHeight: minH,
      maxHeight: maxH,
      buildableFraction: buildable / N,
      waterFraction: water / N,
      forestFraction: forestN / N,
      riverCount: rivers.length,
      generationMs: Math.round(t1 - t0),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Rivière principale unique (génération v2)                           */
/* ------------------------------------------------------------------ */

/** Hauteur bilinéaire dans une grille (coordonnées monde). */
function sampleGrid(h: Float32Array, W: number, H: number, spacing: number, origin: number, x: number, z: number): number {
  const fx = clamp((x - origin) / spacing, 0, W - 1.001);
  const fz = clamp((z - origin) / spacing, 0, H - 1.001);
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const tx = fx - i;
  const tz = fz - j;
  const k = j * W + i;
  return (h[k]! * (1 - tx) + h[k + 1]! * tx) * (1 - tz) + (h[k + W]! * (1 - tx) + h[k + W + 1]! * tx) * tz;
}

/**
 * Une seule rivière, de la source la plus lointaine du bassin principal jusqu'à la mer (ou au bord de carte) :
 * tracé D8 sur un relief peu perturbé, puis lissé (moyenne glissante) et rééchantillonné : peu de méandres,
 * pas d'escaliers à 45°. Lit étroit (8 à 22 m) creusé le long de la polyligne lissée. Renvoie le relief creusé ;
 * remplit `waterSurface` et `rivers` (un seul cours).
 */
function carveMainRiver(p: WorldGenParams, h: Float32Array, W: number, H: number, spacing: number, origin: number, waterSurface: Float32Array, rivers: RiverPath[]): Float32Array {
  const N = W * H;
  const s = p.seed;
  const hFlow = new Float32Array(N);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const x = origin + i * spacing;
      const z = origin + j * spacing;
      hFlow[j * W + i] = h[j * W + i]! + fbm(x / 700, z / 700, s + 33, 3) * 2.5;
    }
  }
  const flow = computeFlow(hFlow, W, H, WATER_LEVEL);
  // Embouchure : dernier échantillon émergé avant un exutoire (mer ou bord), d'accumulation maximale.
  let mouth = -1;
  let best = 0;
  for (let k = 0; k < N; k++) {
    const d = flow.down[k]!;
    if (d < 0 || flow.down[d]! !== -1 || h[k]! < WATER_LEVEL) continue;
    if (flow.acc[k]! > best) { best = flow.acc[k]!; mouth = k; }
  }
  // Seuil de source : plus `rivers` est grand, plus la rivière remonte loin.
  const thr = Math.max(30, N * (0.006 - 0.004 * p.rivers));
  if (mouth < 0 || best < thr * 2) return h;
  // Amont le plus fourni de chaque échantillon.
  const up = new Int32Array(N).fill(-1);
  for (let k = 0; k < N; k++) {
    const d = flow.down[k]!;
    if (d >= 0 && (up[d]! < 0 || flow.acc[k]! > flow.acc[up[d]!]!)) up[d] = k;
  }
  const cells: number[] = [];
  for (let k = mouth, guard = 0; k >= 0 && flow.acc[k]! >= thr && guard < N; guard++) { cells.push(k); k = up[k]!; }
  if (cells.length < 8) return h;
  cells.reverse(); // amont -> aval
  const n = cells.length;
  const px = new Float64Array(n);
  const pz = new Float64Array(n);
  const acc = new Float64Array(n);
  for (let q = 0; q < n; q++) {
    const k = cells[q]!;
    px[q] = origin + (k % W) * spacing;
    pz[q] = origin + ((k / W) | 0) * spacing;
    acc[q] = flow.acc[k]!;
  }
  // Lissage : moyennes glissantes successives (extrémités fixes).
  const R = 6;
  for (let pass = 0; pass < 3; pass++) {
    const sx = new Float64Array(px);
    const sz = new Float64Array(pz);
    for (let q = 1; q < n - 1; q++) {
      const r = Math.min(R, q, n - 1 - q);
      let ax = 0, az = 0;
      for (let o = -r; o <= r; o++) { ax += sx[q + o]!; az += sz[q + o]!; }
      px[q] = ax / (2 * r + 1);
      pz[q] = az / (2 * r + 1);
    }
  }
  // Rééchantillonnage à pas régulier (≈ spacing).
  const xs: number[] = [px[0]!];
  const zs: number[] = [pz[0]!];
  const as: number[] = [acc[0]!];
  let carry = 0;
  for (let q = 1; q < n; q++) {
    const dx = px[q]! - px[q - 1]!;
    const dz = pz[q]! - pz[q - 1]!;
    const L = Math.hypot(dx, dz);
    let t = spacing - carry;
    while (t <= L) {
      const u = t / L;
      xs.push(px[q - 1]! + dx * u);
      zs.push(pz[q - 1]! + dz * u);
      as.push(acc[q - 1]! + (acc[q]! - acc[q - 1]!) * u);
      t += spacing;
    }
    carry = L - (t - spacing);
  }
  xs.push(px[n - 1]!); zs.push(pz[n - 1]!); as.push(acc[n - 1]!);
  const m = xs.length;
  // Surface : suit le terrain réel, monotone décroissante vers l'aval.
  const surf = new Float64Array(m);
  const width = new Float64Array(m);
  let run = Infinity;
  for (let q = 0; q < m; q++) {
    run = Math.min(run, sampleGrid(h, W, H, spacing, origin, xs[q]!, zs[q]!));
    surf[q] = Math.max(WATER_LEVEL, run - 0.8);
    run = Math.min(run, surf[q]! + 0.8 - 0.01);
    width[q] = clamp(6 + Math.sqrt(as[q]! / thr) * 3.2, 8, 22);
  }
  // Creusement : profil en U, berges en pente douce, distance à la polyligne lissée.
  const newH = new Float32Array(h);
  for (let q = 0; q + 1 < m; q++) {
    const ax = xs[q]!, az = zs[q]!, bx = xs[q + 1]!, bz = zs[q + 1]!;
    const wMax = Math.max(width[q]!, width[q + 1]!);
    const reach = wMax / 2 + 6 + wMax * 0.4;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach - origin) / spacing));
    const i1 = Math.min(W - 1, Math.ceil((Math.max(ax, bx) + reach - origin) / spacing));
    const j0 = Math.max(0, Math.floor((Math.min(az, bz) - reach - origin) / spacing));
    const j1 = Math.min(H - 1, Math.ceil((Math.max(az, bz) + reach - origin) / spacing));
    const dx = bx - ax, dz = bz - az;
    const l2 = dx * dx + dz * dz || 1e-9;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x = origin + i * spacing;
        const z = origin + j * spacing;
        const u = clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1);
        const d = Math.hypot(x - (ax + dx * u), z - (az + dz * u));
        const w = width[q]! + (width[q + 1]! - width[q]!) * u;
        const sf = surf[q]! + (surf[q + 1]! - surf[q]!) * u;
        const halfW = w / 2;
        const bank = 6 + w * 0.4;
        const depth = 1.2 + w * 0.05;
        let target: number;
        if (d <= halfW) target = sf - depth * (1 - (d / halfW) ** 2) - 0.25;
        else if (d <= halfW + bank) target = sf - 0.25 + ((d - halfW) / bank) ** 1.5 * bank * 0.35;
        else continue;
        const k = j * W + i;
        if (target < newH[k]!) newH[k] = target;
        if (d <= halfW + spacing * 0.5) waterSurface[k] = Math.max(waterSurface[k]!, sf);
      }
    }
  }
  const pts: number[] = [];
  for (let q = 0; q < m; q++) pts.push(xs[q]!, surf[q]!, zs[q]!, width[q]!);
  const dm = flow.down[mouth]!;
  if (dm >= 0) pts.push(origin + (dm % W) * spacing, WATER_LEVEL, origin + ((dm / W) | 0) * spacing, width[m - 1]!);
  rivers.push({ points: new Float32Array(pts), flow: best });
  return newH;
}

/** Pente (dénivelé / distance) par différences centrales. */
export function slopeAt(h: Float32Array, W: number, H: number, i: number, j: number, spacing: number): number {
  const il = i > 0 ? i - 1 : i;
  const ir = i < W - 1 ? i + 1 : i;
  const jd = j > 0 ? j - 1 : j;
  const ju = j < H - 1 ? j + 1 : j;
  const gx = (h[j * W + ir]! - h[j * W + il]!) / ((ir - il) * spacing || 1);
  const gz = (h[ju * W + i]! - h[jd * W + i]!) / ((ju - jd) * spacing || 1);
  return Math.hypot(gx, gz);
}

/** Distance (m) à l'eau la plus proche, transformée de distance chanfrein 3-4 en deux passes. */
export function waterDistance(ws: Float32Array, h: Float32Array, W: number, H: number, spacing: number): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(W * H);
  for (let k = 0; k < d.length; k++) d[k] = ws[k]! > h[k]! ? 0 : INF;
  const a = spacing;
  const b = spacing * 1.4142;
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const k = j * W + i;
      let v = d[k]!;
      if (i > 0) v = Math.min(v, d[k - 1]! + a);
      if (j > 0) {
        v = Math.min(v, d[k - W]! + a);
        if (i > 0) v = Math.min(v, d[k - W - 1]! + b);
        if (i < W - 1) v = Math.min(v, d[k - W + 1]! + b);
      }
      d[k] = v;
    }
  }
  for (let j = H - 1; j >= 0; j--) {
    for (let i = W - 1; i >= 0; i--) {
      const k = j * W + i;
      let v = d[k]!;
      if (i < W - 1) v = Math.min(v, d[k + 1]! + a);
      if (j < H - 1) {
        v = Math.min(v, d[k + W]! + a);
        if (i < W - 1) v = Math.min(v, d[k + W + 1]! + b);
        if (i > 0) v = Math.min(v, d[k + W - 1]! + b);
      }
      d[k] = v;
    }
  }
  return d;
}
