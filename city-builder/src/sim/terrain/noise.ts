/**
 * Bruits procéduraux déterministes pour la génération de terrain (TypeScript pur,
 * ni three ni DOM : portable tel quel en C#/C++).
 * - `gradNoise2` : bruit de gradient 2D (type Perlin) dans [-1, 1], sans artefacts de grille marqués ;
 * - `fbm` : somme fractale ; `ridged` : bruit en crêtes (chaînes de montagnes) ;
 * - `warp` : distorsion de domaine (formes organiques).
 * Toutes les fonctions sont sans allocation.
 */

/** Hachage entier 2D -> entier 32 bits non signé. */
export function hashInt(ix: number, iz: number, seed: number): number {
  let h = (Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iz | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x2545f491)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Hachage 2D -> [0, 1). */
export function hash01(ix: number, iz: number, seed: number): number {
  return hashInt(ix, iz, seed) / 4294967296;
}

// 16 directions unitaires réparties sur le cercle.
const GX = new Float64Array(16);
const GZ = new Float64Array(16);
for (let k = 0; k < 16; k++) {
  GX[k] = Math.cos((k / 16) * Math.PI * 2);
  GZ[k] = Math.sin((k / 16) * Math.PI * 2);
}

function grad(ix: number, iz: number, seed: number, dx: number, dz: number): number {
  const k = hashInt(ix, iz, seed) & 15;
  return GX[k]! * dx + GZ[k]! * dz;
}

/** Bruit de gradient 2D dans [-1, 1] (≈ ±0,7 en pratique). */
export function gradNoise2(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const a = grad(ix, iz, seed, fx, fz);
  const b = grad(ix + 1, iz, seed, fx - 1, fz);
  const c = grad(ix, iz + 1, seed, fx, fz - 1);
  const d = grad(ix + 1, iz + 1, seed, fx - 1, fz - 1);
  const ab = a + (b - a) * ux;
  const cd = c + (d - c) * ux;
  return (ab + (cd - ab) * uz) * 1.41421356;
}

/** fBm normalisé dans ≈ [-1, 1]. */
export function fbm(x: number, z: number, seed: number, octaves: number, lacunarity = 2, gain = 0.5): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    // Légère rotation entre octaves pour casser l'alignement sur les axes.
    const rx = x * f * 0.8 - z * f * 0.6;
    const rz = x * f * 0.6 + z * f * 0.8;
    sum += amp * gradNoise2(rx + o * 17.13, rz - o * 9.71, seed + o * 1013);
    norm += amp;
    amp *= gain;
    f *= lacunarity;
  }
  return sum / norm;
}

/** Bruit en crêtes dans [0, 1] : 1 sur les arêtes (chaînes de montagnes). */
export function ridged(x: number, z: number, seed: number, octaves: number): number {
  let sum = 0;
  let amp = 0.5;
  let f = 1;
  let weight = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    let n = 1 - Math.abs(gradNoise2(x * f + o * 31.7, z * f - o * 11.3, seed + o * 7919));
    n *= n;
    n *= weight;
    weight = Math.min(1, Math.max(0, n * 2));
    sum += n * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

/** Résultat réutilisable de `warp` (évite toute allocation). */
export const warpOut = { x: 0, z: 0 };

/** Distorsion de domaine : écrit dans `warpOut` le point (x, z) déplacé d'au plus `amount`. */
export function warp(x: number, z: number, seed: number, scale: number, amount: number): typeof warpOut {
  warpOut.x = x + fbm(x * scale, z * scale, seed + 501, 3) * amount;
  warpOut.z = z + fbm(x * scale + 5.2, z * scale + 1.3, seed + 907, 3) * amount;
  return warpOut;
}
