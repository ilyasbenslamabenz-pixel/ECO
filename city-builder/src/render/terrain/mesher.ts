/**
 * Maillage d'un chunk de terrain (sans three, sans DOM, sans aucune référence extérieure).
 *
 * `meshChunk` est volontairement AUTONOME (aucune variable ni import extérieur dans son corps) :
 * son code source est injecté tel quel dans un Web Worker créé depuis un Blob
 * (voir mesher-worker.ts), ce qui évite toute entrée de build supplémentaire.
 * Un test unitaire vérifie qu'il fonctionne une fois reconstruit depuis `meshChunk.toString()`.
 *
 * Sortie (par sommet) : position (x,y,z), normale (x,y,z), poids de mélange `splat` (Uint8 x4 :
 * terre, roche, sable, gravier ; l'herbe = 1 - somme). Les indices sont partagés par LOD (`chunkIndices`).
 * Coutures : une « jupe » verticale sur le pourtour masque les fissures entre chunks de LOD différents.
 * Hors carte (anneau d'horizon) : relief synthétique dans le prolongement des bords (visuel uniquement).
 */

export interface MeshSource {
  heights: Float32Array;
  /** Surface d'eau (m) par échantillon, ou longueur 0 si inconnue. */
  waterSurface: Float32Array;
  /** Humidité 0..255 par échantillon, ou longueur 0. */
  moisture: Uint8Array;
  /** Densité forestière 0..255 par échantillon, ou longueur 0. */
  forest: Uint8Array;
  samplesX: number;
  samplesZ: number;
  spacing: number;
  originX: number;
  originZ: number;
  waterLevel: number;
  /** Altitude de référence des sommets (m) pour la répartition roche/gravier. */
  maxAltitude: number;
}

export interface ChunkRequest {
  /** Indice du premier échantillon du chunk (peut être négatif ou au-delà de la carte : anneau d'horizon). */
  i0: number;
  j0: number;
  /** Nombre de cellules par côté au LOD 0. */
  cells: number;
  /** Pas en échantillons (1, 2, 4, 8...). */
  step: number;
  /** Profondeur de la jupe (m). */
  skirt: number;
}

export interface ChunkMesh {
  positions: Float32Array;
  normals: Float32Array;
  splat: Uint8Array;
  /** Environnement par sommet (Uint8 x4) : humidité, forêt, proximité d'une rivière, réservé. */
  env: Uint8Array;
  minY: number;
  maxY: number;
}

/** Nombre de sommets d'un chunk (grille + jupe). */
export function chunkVertexCount(cells: number, step: number): number {
  const n = cells / step + 1;
  return n * n + 4 * (n - 1);
}

/** Indices partagés d'un chunk (grille n x n puis jupe de 4(n-1) sommets). */
export function chunkIndices(cells: number, step: number): Uint16Array | Uint32Array {
  const n = cells / step + 1;
  const quads = (n - 1) * (n - 1) + 4 * (n - 1);
  const nv = n * n + 4 * (n - 1);
  const idx = nv < 65536 ? new Uint16Array(quads * 6) : new Uint32Array(quads * 6);
  let p = 0;
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      // Diagonale alternée : surface plus isotrope.
      if (((i + j) & 1) === 0) { idx[p++] = a; idx[p++] = c; idx[p++] = b; idx[p++] = b; idx[p++] = c; idx[p++] = d; }
      else { idx[p++] = a; idx[p++] = c; idx[p++] = d; idx[p++] = a; idx[p++] = d; idx[p++] = b; }
    }
  }
  // Pourtour parcouru dans le sens horaire vu du dessus : (0,0)->(n-1,0)->(n-1,n-1)->(0,n-1)->(0,0).
  const ring: number[] = [];
  for (let i = 0; i < n - 1; i++) ring.push(i);
  for (let j = 0; j < n - 1; j++) ring.push(j * n + n - 1);
  for (let i = n - 1; i > 0; i--) ring.push((n - 1) * n + i);
  for (let j = n - 1; j > 0; j--) ring.push(j * n);
  const base = n * n;
  const m = ring.length;
  for (let r = 0; r < m; r++) {
    const top0 = ring[r]!;
    const top1 = ring[(r + 1) % m]!;
    const bot0 = base + r;
    const bot1 = base + ((r + 1) % m);
    // Deux faces (jupe visible des deux côtés sans dépendre du sens).
    idx[p++] = top0; idx[p++] = bot0; idx[p++] = top1;
    idx[p++] = top1; idx[p++] = bot0; idx[p++] = bot1;
  }
  return idx.subarray(0, p);
}

/** Maille un chunk. AUTONOME : ne référencer aucun symbole extérieur dans ce corps. */
export function meshChunk(src: MeshSource, req: ChunkRequest): ChunkMesh {
  const W = src.samplesX;
  const H = src.samplesZ;
  const sp = src.spacing;
  const wl = src.waterLevel;
  const hasWs = src.waterSurface.length === W * H;
  const hasMoist = src.moisture.length === W * H;
  const hasForest = src.forest.length === W * H;
  const clampI = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
  const sstep = (e0: number, e1: number, x: number): number => {
    const t = clampI((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const hash = (ix: number, iz: number): number => {
    let h = (Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iz | 0, 0x165667b1)) | 0;
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const vnoise = (x: number, z: number): number => {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fz = z - iz;
    const ux = fx * fx * (3 - 2 * fx);
    const uz = fz * fz * (3 - 2 * fz);
    const a = hash(ix, iz);
    const b = hash(ix + 1, iz);
    const c = hash(ix, iz + 1);
    const d = hash(ix + 1, iz + 1);
    return (a + (b - a) * ux) * (1 - uz) + (c + (d - c) * ux) * uz;
  };
  // Hauteur d'un échantillon, avec prolongement synthétique hors carte (anneau d'horizon).
  const hAt = (i: number, j: number): number => {
    const ci = clampI(i, 0, W - 1);
    const cj = clampI(j, 0, H - 1);
    const e = src.heights[cj * W + ci]!;
    const out = Math.max(Math.abs(i - ci), Math.abs(j - cj));
    if (out === 0) return e;
    const t = Math.min(1, out / 24);
    if (e < wl) return e - out * sp * 0.04;
    const n = vnoise(i / 22, j / 22) * 0.65 + vnoise(i / 7, j / 7) * 0.35;
    return e + t * (n - 0.35) * Math.max(25, src.maxAltitude * 0.5) * Math.min(1, (e - wl) / 30 + 0.3);
  };
  const wsAt = (i: number, j: number): number => {
    if (!hasWs || i < 0 || j < 0 || i >= W || j >= H) return -10000;
    return src.waterSurface[j * W + i]!;
  };
  const n = req.cells / req.step + 1;
  const nv = n * n + 4 * (n - 1);
  const positions = new Float32Array(nv * 3);
  const normals = new Float32Array(nv * 3);
  const splat = new Uint8Array(nv * 4);
  const env = new Uint8Array(nv * 4);
  let minY = Infinity;
  let maxY = -Infinity;
  const st = req.step;
  for (let gj = 0; gj < n; gj++) {
    for (let gi = 0; gi < n; gi++) {
      const i = req.i0 + gi * st;
      const j = req.j0 + gj * st;
      const h = hAt(i, j);
      const v = gj * n + gi;
      positions[v * 3] = src.originX + i * sp;
      positions[v * 3 + 1] = h;
      positions[v * 3 + 2] = src.originZ + j * sp;
      if (h < minY) minY = h;
      if (h > maxY) maxY = h;
      // Normale par différences centrales sur la grille complète (identique de part et d'autre d'une couture).
      const d = st;
      const hl = hAt(i - d, j);
      const hr = hAt(i + d, j);
      const hd = hAt(i, j - d);
      const hu = hAt(i, j + d);
      let nx = hl - hr;
      let nz = hd - hu;
      let ny = 2 * d * sp;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx /= len; ny /= len; nz /= len;
      normals[v * 3] = nx;
      normals[v * 3 + 1] = ny;
      normals[v * 3 + 2] = nz;
      // Poids de mélange.
      const inMap = i >= 0 && j >= 0 && i < W && j < H;
      const k = inMap ? j * W + i : -1;
      const slope = Math.sqrt(1 - ny * ny) / Math.max(0.05, ny);
      const moist = hasMoist && k >= 0 ? src.moisture[k]! / 255 : 0.5;
      const forest = hasForest && k >= 0 ? src.forest[k]! / 255 : 0;
      const alt = (h - wl) / Math.max(10, src.maxAltitude);
      const nz1 = vnoise(i / 5.3, j / 5.3);
      const nz2 = vnoise(i / 17.7 + 40, j / 17.7 - 13);
      // Eau proche (rivière / lac d'altitude / mer) : distance (en échantillons, fenêtre 5×5) au plus proche
      // échantillon mouillé. Les berges de rivière reçoivent un poids PROGRESSIF selon cette distance (et un peu
      // de bruit) au lieu d'un tout-ou-rien sur les 8 voisins, qui dessinait des berges en escalier.
      let riverD = 9;
      let nearSea = 0;
      for (let dj = -2; dj <= 2; dj++) {
        for (let di = -2; di <= 2; di++) {
          const w = wsAt(i + di, j + dj);
          if (w > -1000 && w > hAt(i + di, j + dj)) {
            const dd = Math.sqrt(di * di + dj * dj);
            if (w > wl + 0.05) { if (dd < riverD) riverD = dd; } else if (dd <= 1.5) nearSea = 1;
          }
        }
      }
      const nearRiver = 1 - sstep(0.6, 2.4 + (nz1 - 0.5) * 0.8, riverD);
      let rock = sstep(0.42, 0.85, slope + (nz1 - 0.5) * 0.25) + sstep(0.62, 0.9, alt + (nz2 - 0.5) * 0.15) * 0.8;
      let sand = (1 - sstep(wl + 1.0, wl + 3.2 + nz1 * 1.5, h)) * (nearSea > 0 || h < wl + 2.5 ? 1 : 0.4);
      let gravel = nearRiver * 0.45 * (1 - sand) + sstep(0.5, 0.75, alt) * sstep(0.2, 0.45, slope) * 0.6;
      let dirt = nearRiver * 0.35 + sstep(0.2, 0.42, slope) * 0.55 + forest * 0.45 * sstep(0.35, 0.7, nz2) + (1 - moist) * sstep(0.62, 0.85, nz2) * 0.5;
      // Normalisation : somme <= 1 (le reste = herbe).
      rock = clampI(rock, 0, 1);
      sand = clampI(sand * (1 - rock), 0, 1);
      gravel = clampI(gravel * (1 - rock) * (1 - sand), 0, 1);
      dirt = clampI(dirt * (1 - rock - sand - gravel), 0, 1);
      const sum = rock + sand + gravel + dirt;
      const sc = sum > 1 ? 1 / sum : 1;
      splat[v * 4] = Math.round(dirt * sc * 255);
      splat[v * 4 + 1] = Math.round(rock * sc * 255);
      splat[v * 4 + 2] = Math.round(sand * sc * 255);
      splat[v * 4 + 3] = Math.round(gravel * sc * 255);
      env[v * 4] = Math.round(moist * 255);
      env[v * 4 + 1] = Math.round(forest * 255);
      env[v * 4 + 2] = nearRiver * 255;
    }
  }
  // Jupe : copie du pourtour (même ordre que chunkIndices) abaissée de `skirt`.
  let r = 0;
  const copySkirt = (top: number): void => {
    const v = n * n + r++;
    positions[v * 3] = positions[top * 3]!;
    positions[v * 3 + 1] = positions[top * 3 + 1]! - req.skirt;
    positions[v * 3 + 2] = positions[top * 3 + 2]!;
    normals[v * 3] = normals[top * 3]!;
    normals[v * 3 + 1] = normals[top * 3 + 1]!;
    normals[v * 3 + 2] = normals[top * 3 + 2]!;
    for (let c = 0; c < 4; c++) { splat[v * 4 + c] = splat[top * 4 + c]!; env[v * 4 + c] = env[top * 4 + c]!; }
  };
  for (let i = 0; i < n - 1; i++) copySkirt(i);
  for (let j = 0; j < n - 1; j++) copySkirt(j * n + n - 1);
  for (let i = n - 1; i > 0; i--) copySkirt((n - 1) * n + i);
  for (let j = n - 1; j > 0; j--) copySkirt(j * n);
  return { positions, normals, splat, env, minY: minY - req.skirt, maxY };
}
