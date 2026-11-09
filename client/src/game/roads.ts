// Réseau routier et ferroviaire en 3D : voies rapides à chaussées séparées, avenues plantées, rampes
// d'échangeurs, voies ferrées, ponts en pierre à arches sur la rivière, quais plantés, giratoires,
// passages piétons, lampadaires, arbres d'alignement et feux tricolores.
// Le profil en long de chaque voie (ponts, sauts-de-mouton) est calculé une seule fois et partagé
// avec la circulation (traffic.ts) pour que les véhicules roulent exactement sur les tabliers.
import {
  Color3, DynamicTexture, Matrix, Mesh, MeshBuilder, StandardMaterial, Texture, VertexData, type GlowLayer, type ArcRotateCamera, type Scene,
} from '@babylonjs/core';
import { CustomMaterial } from '@babylonjs/materials/custom/customMaterial';
import { mulberry32 } from '../../../shared/noise';
import { HALF_D, HALF_W, coastX, parkMask, urbanDensity } from '../../../shared/sim/country';
import type { CountryDef } from '../../../shared/sim/types';
import { ENV, RES, VS, densify, type Grid } from './terrain';
import { setThinCount } from './thin';
import { whenModels } from './cityModels';
import { createThinInstances, type ModelLibrary, type ThinInstanceBuffer } from './modelLibrary';

// ---------------------------------------------------------------------------------------------
// Surface du relief telle qu'elle est maillée (triangulation identique à createTerrain)
// ---------------------------------------------------------------------------------------------
let STEP = 2;
/** Appelé par createTerrain : pas du maillage du relief (3 = low, 2 = medium, 1 = high). */
export function setTerrainStep(step: number) { STEP = step; }
export function qualityLevel(): 0 | 1 | 2 { return STEP >= 3 ? 0 : STEP === 2 ? 1 : 2; }

export function surfaceY(grid: Grid, x: number, z: number) {
  const cs = STEP * RES;
  const nxm = Math.floor((grid.nx - 1) / STEP);
  const nzm = Math.floor((grid.nz - 1) / STEP);
  const fx = Math.max(0, Math.min(nxm - 1e-4, (x + HALF_W) / cs));
  const fz = Math.max(0, Math.min(nzm - 1e-4, (z + HALF_D) / cs));
  const i = Math.floor(fx), j = Math.floor(fz);
  const tx = fx - i, tz = fz - j;
  const h = grid.h, nx = grid.nx;
  const H = (ii: number, jj: number) => h[jj * STEP * nx + ii * STEP] * VS;
  if (tx + tz <= 1) { const a = H(i, j); return a + (H(i + 1, j) - a) * tx + (H(i, j + 1) - a) * tz; }
  const d = H(i + 1, j + 1);
  return d + (H(i, j + 1) - d) * (1 - tx) + (H(i + 1, j) - d) * (1 - tz);
}

// ---------------------------------------------------------------------------------------------
// Profils en travers (mètres) et atlas de texture
// ---------------------------------------------------------------------------------------------
export const TILE = 0.036; // longueur (km) d'une répétition de l'atlas le long des voies
export const QUAY_HALF = 0.17; // demi-largeur du plan d'eau des rivières (ruban de landscape.ts)
const QUAY_OUT = 0.4;
const AW = 2048, AH = 1024; // atlas virtuel (px)
const PXM = 24; // px par mètre en travers
const PYM = AH / (TILE * 1000); // px par mètre en long
export type PathKind = 'autoroute' | 'nationale' | 'rail' | 'ramp';
// régions de l'atlas (px) : début et largeur en mètres
const REG = {
  autoroute: { x: 8, m: 32 },
  nationale: { x: 792, m: 22.6 },
  ramp: { x: 1350, m: 9 },
  rail: { x: 1582, m: 12.5 },
  zebra: { x: 1898, m: 64 / PXM },
  concrete: { x: 1974, m: 32 / PXM },
  metal: { x: 2016, m: 24 / PXM },
};
const U = (px: number) => px / AW;
const regU = (k: keyof typeof REG) => [U(REG[k].x), U(REG[k].x + REG[k].m * PXM)] as const;
const U_CONCRETE = U(REG.concrete.x + 16);
const U_METAL = U(REG.metal.x + 12);
const U_ASPHALT = U(REG.nationale.x + 5.2 * PXM); // milieu d'une voie d'avenue : asphalte nu
const U_PLANTED = U(REG.nationale.x + 11.3 * PXM); // terre-plein planté
export const HALF: Record<PathKind, number> = { autoroute: 0.016, nationale: 0.0113, ramp: 0.0045, rail: 0.00625 };
/** Décalage latéral (km) du centre de la voie `lane` (0 = voie de droite) par rapport à l'axe. */
export const LANES = { autoroute: [0.0107, 0.0072, 0.0037], nationale: [0.00598, 0.00273] };
const LIFT: Record<PathKind, number> = { nationale: 0.0013, ramp: 0.0015, autoroute: 0.0017, rail: 0.0019 };
const CLEAR = 0.0088; // gabarit sous ouvrage + épaisseur du tablier
const DECK = 0.0013; // épaisseur du tablier

function paintAtlas(ctx: CanvasRenderingContext2D, img: Record<string, HTMLImageElement | null>) {
  const pat = (name: string, metres: number, fallback: string) => {
    const im = img[name];
    if (!im) return fallback;
    const p = ctx.createPattern(im, 'repeat');
    if (!p) return fallback;
    p.setTransform(new DOMMatrix().scaleSelf((metres * PXM) / im.width, (metres * PYM) / im.height));
    return p;
  };
  const asphalt = pat('Road012A', 7, '#3b3c3e');
  const asphalt2 = pat('Asphalt025C', 6, '#343537');
  const concrete = pat('Concrete034', 6, '#b9b7b1');
  const paving = pat('PavingStones138', 2.5, '#a9a397');
  const grass = pat('grass', 30, '#4f6a3a');
  const fill = (x0: number, m0: number, m1: number, style: string | CanvasPattern, alpha = 1) => {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = style;
    ctx.fillRect(x0 + m0 * PXM, 0, (m1 - m0) * PXM, AH);
    ctx.globalAlpha = 1;
  };
  // ligne (m = centre, w = largeur), pointillée si dash > 0 (mètres), phase en mètres
  const line = (x0: number, m: number, w: number, dash = 0, gap = 0, color = '#ecebe4', phase = 0) => {
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.92;
    const px = x0 + (m - w / 2) * PXM;
    const pw = Math.max(1.5, w * PXM);
    if (!dash) ctx.fillRect(px, 0, pw, AH);
    else for (let y = phase; y < TILE * 1000; y += dash + gap) ctx.fillRect(px, y * PYM, pw, dash * PYM);
    ctx.globalAlpha = 1;
  };
  const tracks = (x0: number, m0: number, m1: number, alpha: number) => { // traces d'usure des roues
    fill(x0, m0, m1, 'rgba(20,20,22,1)', alpha);
  };
  ctx.fillStyle = '#3a3b3d';
  ctx.fillRect(0, 0, AW, AH);
  // --- voie rapide 2×3 voies ---
  {
    const x = REG.autoroute.x;
    fill(x, 0, 32, asphalt);
    for (const side of [0, 1]) {
      const M = (m: number) => (side ? 32 - m : m);
      const lo = (a: number, b: number) => [Math.min(M(a), M(b)), Math.max(M(a), M(b))] as const;
      fill(x, ...lo(0, 0.8), concrete);
      fill(x, ...lo(0.8, 3.3), asphalt2, 0.55); // bande d'arrêt d'urgence
      line(x, M(3.42), 0.25);
      for (const lc of [5.3, 8.8, 12.3]) { tracks(x, ...lo(lc - 1.1, lc - 0.6), 0.1); tracks(x, ...lo(lc + 0.6, lc + 1.1), 0.1); }
      line(x, M(7.05), 0.15, 6, 12, '#ecebe4', side * 9);
      line(x, M(10.55), 0.15, 6, 12, '#ecebe4', side * 9);
      line(x, M(14.17), 0.2);
      fill(x, ...lo(15.0, 15.6), asphalt2, 0.6);
    }
    fill(x, 15.6, 16.4, concrete); // séparateur béton (GBA)
    fill(x, 15.95, 16.05, 'rgba(0,0,0,0.25)');
  }
  // --- avenue 2×2 voies, terre-plein planté, trottoirs ---
  {
    const x = REG.nationale.x;
    fill(x, 0, 22.6, asphalt);
    for (const side of [0, 1]) {
      const M = (m: number) => (side ? 22.6 - m : m);
      const lo = (a: number, b: number) => [Math.min(M(a), M(b)), Math.max(M(a), M(b))] as const;
      fill(x, ...lo(0, 3.5), paving);
      fill(x, ...lo(0, 3.5), 'rgba(150,145,138,1)', 0.35);
      fill(x, ...lo(3.45, 3.7), concrete);
      fill(x, ...lo(3.68, 3.74), 'rgba(0,0,0,0.35)');
      for (const lc of [5.3, 8.6]) { tracks(x, ...lo(lc - 0.95, lc - 0.55), 0.09); tracks(x, ...lo(lc + 0.55, lc + 0.95), 0.09); }
      line(x, M(3.9), 0.12);
      line(x, M(6.95), 0.12, 3, 6, '#ecebe4', side * 4.5);
      fill(x, ...lo(10.2, 10.4), concrete);
      fill(x, ...lo(10.38, 10.42), 'rgba(0,0,0,0.3)');
    }
    fill(x, 10.4, 12.2, grass);
    fill(x, 10.4, 12.2, 'rgba(60,90,40,1)', 0.25);
  }
  // --- bretelle (une voie) / anneau de giratoire ---
  {
    const x = REG.ramp.x;
    fill(x, 0, 9, asphalt);
    fill(x, 0, 0.4, concrete);
    fill(x, 8.6, 9, concrete);
    line(x, 1.1, 0.2);
    line(x, 7.9, 0.2);
    tracks(x, 3.3, 3.8, 0.1);
    tracks(x, 5.2, 5.7, 0.1);
  }
  // --- double voie ferrée : ballast, traverses, rails ---
  {
    const x = REG.rail.x;
    const rnd = mulberry32(9);
    ctx.fillStyle = '#6f6a62';
    ctx.fillRect(x, 0, 12.5 * PXM, AH);
    for (let k = 0; k < 9000; k++) {
      const g = 70 + Math.floor(rnd() * 80);
      ctx.fillStyle = `rgb(${g},${g - 6},${g - 12})`;
      ctx.fillRect(x + rnd() * 12.5 * PXM, rnd() * AH, 2, 2);
    }
    fill(x, 0, 0.6, 'rgba(60,70,40,1)', 0.5);
    fill(x, 11.9, 12.5, 'rgba(60,70,40,1)', 0.5);
    for (const c of [4.25, 8.25]) {
      ctx.fillStyle = '#8d8a84';
      for (let y = 0; y < TILE * 1000; y += 0.6) ctx.fillRect(x + (c - 1.3) * PXM, y * PYM, 2.6 * PXM, 0.24 * PYM);
      ctx.fillStyle = 'rgba(30,25,20,0.5)';
      for (const r of [-0.72, 0.72]) ctx.fillRect(x + (c + r - 0.08) * PXM, 0, 0.16 * PXM + 1, AH);
      ctx.fillStyle = '#c9c9c6';
      for (const r of [-0.72, 0.72]) ctx.fillRect(x + (c + r - 0.035) * PXM, 0, 2, AH);
    }
  }
  // --- bandes de passage piéton (rayures dans le sens v, pas de 1 m) ---
  {
    const x = REG.zebra.x;
    ctx.fillStyle = asphalt;
    ctx.fillRect(x, 0, 64, AH);
    ctx.fillStyle = '#efeee8';
    ctx.globalAlpha = 0.93;
    for (let y = 0; y < TILE * 1000; y += 1) ctx.fillRect(x, y * PYM, 64, 0.5 * PYM);
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = concrete;
  ctx.fillRect(REG.concrete.x, 0, 32, AH);
  ctx.fillStyle = '#a5abb0';
  ctx.fillRect(REG.metal.x, 0, 24, AH);
}

/** Pierre de taille (calcaire blond) : appareil régulier, 8 m × 8 m par répétition. */
function paintStone(ctx: CanvasRenderingContext2D, size: number, concrete: HTMLImageElement | null) {
  const rnd = mulberry32(17);
  const m = size / 8;
  ctx.fillStyle = '#c7b28c';
  ctx.fillRect(0, 0, size, size);
  for (let row = 0; row < 8 / 0.45; row++) {
    const y = row * 0.45 * m;
    const off = (row % 2) * 0.55;
    for (let xm = -off; xm < 8; xm += 1.1) {
      const t = 0.85 + rnd() * 0.25;
      ctx.fillStyle = `rgb(${Math.floor(199 * t)},${Math.floor(178 * t)},${Math.floor(140 * t)})`;
      ctx.fillRect(xm * m + 1, y + 1, 1.1 * m - 2, 0.45 * m - 2);
    }
  }
  if (concrete) { ctx.globalAlpha = 0.35; ctx.globalCompositeOperation = 'multiply'; ctx.drawImage(concrete, 0, 0, size, size); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; }
}

// ---------------------------------------------------------------------------------------------
// Réseau : profils en long, croisements, ponts, giratoires
// ---------------------------------------------------------------------------------------------
export interface NetPath {
  kind: PathKind; link: number; n: number; closed: boolean; half: number; stone: boolean;
  x: Float64Array; z: Float64Array; g: Float64Array; y: Float64Array; cum: Float64Array; len: number;
}
interface Crossing { a: number; b: number; ia: number; ta: number; ib: number; tb: number; sa: number; sb: number; x: number; z: number; sin: number; dax: number; daz: number; dbx: number; dbz: number }
interface Quad { pts: number[]; uv: number[] } // 4 sommets (x,y,z) et (u,v)
export interface Network {
  paths: NetPath[];
  roundabouts: { x: number; z: number; y: number; r: number }[];
  plates: Quad[];
  zebras: Quad[];
  bridges: { p: number; s0: number; s1: number; water: number }[];
  /** Grille d'occupation (cellules de 25 m) : bit 1 = voie, bit 2 = obstacle pour la grille des rues. */
  occ: Uint8Array; occN: number; occM: number;
  rivers: { x: Float64Array; z: Float64Array; w: Float64Array; nx: Float64Array; nz: Float64Array; ok: Uint8Array }[];
  crossings: Crossing[];
}
const OCC = 0.025;
export function occAt(net: Network, x: number, z: number) {
  const i = Math.floor((x + HALF_W) / OCC), j = Math.floor((z + HALF_D) / OCC);
  if (i < 0 || j < 0 || i >= net.occN || j >= net.occM) return 2;
  return net.occ[j * net.occN + i];
}

export function sampleAt(p: NetPath, s: number, out: { x: number; y: number; z: number; tx: number; tz: number }) {
  if (p.closed) s = ((s % p.len) + p.len) % p.len;
  else s = Math.max(0, Math.min(p.len, s));
  let lo = 0, hi = p.n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (p.cum[mid] < s) lo = mid; else hi = mid; }
  const L = p.cum[hi] - p.cum[lo] || 1e-6;
  const t = (s - p.cum[lo]) / L;
  out.x = p.x[lo] + (p.x[hi] - p.x[lo]) * t;
  out.z = p.z[lo] + (p.z[hi] - p.z[lo]) * t;
  out.y = p.y[lo] + (p.y[hi] - p.y[lo]) * t;
  out.tx = (p.x[hi] - p.x[lo]) / L;
  out.tz = (p.z[hi] - p.z[lo]) / L;
  return out;
}

function nearestRiver(country: CountryDef, x: number, z: number) {
  let best = Infinity, bx = 0, bz = 0;
  for (const r of country.rivers) {
    const P = r.points;
    for (let i = 0; i < P.length - 1; i++) {
      const ax = P[i][0], az = P[i][1], qx = P[i + 1][0], qz = P[i + 1][1];
      if ((x < ax - 1 && x < qx - 1) || (x > ax + 1 && x > qx + 1)) continue;
      const dx = qx - ax, dz = qz - az, l2 = dx * dx + dz * dz;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
      const px = ax + dx * t, pz = az + dz * t;
      const d = Math.hypot(x - px, z - pz);
      if (d < best) { best = d; bx = px; bz = pz; }
    }
  }
  return { d: best, x: bx, z: bz };
}
/** Niveau de l'eau (même formule que le ruban des rivières dans landscape.ts). */
export const waterY = (grid: Grid, x: number, z: number) => Math.max(0.02, grid.y(x, z)) + 0.03;

const cache = new WeakMap<CountryDef, { step: number; net: Network }>();

export function getNetwork(grid: Grid, country: CountryDef): Network {
  const c = cache.get(country);
  if (c && c.step === STEP) return c.net;
  const net = buildNetwork(grid, country);
  cache.set(country, { step: STEP, net });
  return net;
}

function buildNetwork(grid: Grid, country: CountryDef): Network {
  const seed = country.seed;
  // terrasse des quais : le sol est remonté au niveau du quai le long des rivières
  const quayAt = (x: number, z: number) => {
    const r = nearestRiver(country, x, z);
    if (r.d > QUAY_OUT || r.x < coastX(seed, r.z) + 0.8) return { d: r.d, yq: -Infinity };
    return { d: r.d, yq: waterY(grid, r.x, r.z) + 0.006 };
  };
  const ground = (x: number, z: number) => {
    const s = surfaceY(grid, x, z);
    const q = quayAt(x, z);
    return q.d >= QUAY_HALF ? Math.max(s, q.yq) : s;
  };

  // 1. polylignes densifiées
  // Le métro passe en souterrain dans le centre dense : on ne dessine pas les voies ferrées à moins de METRO_TUNNEL km
  // de la capitale (sinon une dizaine de lignes formeraient une étoile au-dessus des îlots du centre).
  const capCity = country.cities.find((c) => c.capital) ?? country.cities[0];
  const METRO_TUNNEL = 4.5;
  const raw: { kind: PathKind; link: number; pts: [number, number][] }[] = [];
  country.links.forEach((l, k) => {
    const pts = densify(l.points, 0.04);
    if (l.kind !== 'rail') { raw.push({ kind: l.kind, link: k, pts }); return; }
    let cur: [number, number][] = [];
    for (const q of pts) {
      if (Math.hypot(q[0] - capCity.x, q[1] - capCity.z) < METRO_TUNNEL) { if (cur.length > 1) raw.push({ kind: 'rail', link: k, pts: cur }); cur = []; }
      else cur.push(q);
    }
    if (cur.length > 1) raw.push({ kind: 'rail', link: k, pts: cur });
  });
  // 2. giratoires aux centres des quartiers où convergent plusieurs avenues
  const roundabouts: Network['roundabouts'] = [];
  for (const city of country.cities) {
    const ends: { r: (typeof raw)[number]; atStart: boolean; ang: number }[] = [];
    for (const r of raw) {
      if (r.kind !== 'nationale') continue;
      for (const atStart of [true, false]) {
        const p = atStart ? r.pts[0] : r.pts[r.pts.length - 1];
        if (Math.hypot(p[0] - city.x, p[1] - city.z) > 0.03) continue;
        const q = atStart ? r.pts[Math.min(3, r.pts.length - 1)] : r.pts[Math.max(0, r.pts.length - 4)];
        ends.push({ r, atStart, ang: Math.atan2(q[1] - city.z, q[0] - city.x) });
      }
    }
    if (ends.length < 2) continue;
    const angs = ends.map((e) => e.ang).sort((a, b) => a - b);
    let minA = Math.PI * 2 - (angs[angs.length - 1] - angs[0]);
    for (let i = 1; i < angs.length; i++) minA = Math.min(minA, angs[i] - angs[i - 1]);
    const R = Math.max(0.045, Math.min(0.12, (HALF.nationale * 2) / (2 * Math.sin(Math.max(0.05, minA) / 2)) + 0.012));
    roundabouts.push({ x: city.x, z: city.z, y: 0, r: R });
    for (const e of ends) {
      const keep = (p: [number, number]) => Math.hypot(p[0] - city.x, p[1] - city.z) > R - 0.004;
      if (e.atStart) { let k = 0; while (k < e.r.pts.length - 2 && !keep(e.r.pts[k])) k++; e.r.pts = e.r.pts.slice(k); }
      else { let k = e.r.pts.length - 1; while (k > 1 && !keep(e.r.pts[k])) k--; e.r.pts = e.r.pts.slice(0, k + 1); }
    }
  }
  for (const rb of roundabouts) rb.y = ground(rb.x, rb.z) + LIFT.nationale;

  // 3. chemins avec sol et profil initial
  const mk = (kind: PathKind, link: number, pts: [number, number][]): NetPath => {
    const n = pts.length;
    const x = new Float64Array(n), z = new Float64Array(n), g = new Float64Array(n), y = new Float64Array(n), cum = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      x[i] = pts[i][0]; z[i] = pts[i][1];
      g[i] = ground(x[i], z[i]);
      y[i] = g[i] + LIFT[kind];
      if (i) cum[i] = cum[i - 1] + Math.hypot(x[i] - x[i - 1], z[i] - z[i - 1]);
    }
    const closed = n > 4 && Math.hypot(x[0] - x[n - 1], z[0] - z[n - 1]) < 0.02;
    return { kind, link, n, closed, half: HALF[kind], stone: kind === 'nationale' || kind === 'rail', x, z, g, y, cum, len: cum[n - 1] };
  };
  const paths = raw.filter((r) => r.pts.length >= 2).map((r) => mk(r.kind, r.link, r.pts));

  // 4. croisements (grille de seaux de 300 m)
  const B = 0.3;
  const buckets = new Map<number, number[]>();
  const bkey = (i: number, j: number) => (i + 200) * 1000 + (j + 200);
  paths.forEach((p, pi) => {
    for (let i = 0; i < p.n - 1; i++) {
      const i0 = Math.floor(Math.min(p.x[i], p.x[i + 1]) / B), i1 = Math.floor(Math.max(p.x[i], p.x[i + 1]) / B);
      const j0 = Math.floor(Math.min(p.z[i], p.z[i + 1]) / B), j1 = Math.floor(Math.max(p.z[i], p.z[i + 1]) / B);
      for (let a = i0; a <= i1; a++) for (let b = j0; b <= j1; b++) {
        const k = bkey(a, b);
        let l = buckets.get(k);
        if (!l) buckets.set(k, (l = []));
        l.push(pi * 100000 + i);
      }
    }
  });
  const crossings: Crossing[] = [];
  for (const [k, list] of buckets) {
    const ci = Math.floor(k / 1000) - 200, cj = (k % 1000) - 200;
    for (let m = 0; m < list.length; m++) {
      const pa = Math.floor(list[m] / 100000), ia = list[m] % 100000;
      const A = paths[pa];
      for (let q = m + 1; q < list.length; q++) {
        const pb = Math.floor(list[q] / 100000), ib = list[q] % 100000;
        if (pa === pb) continue;
        const Bp = paths[pb];
        const ax = A.x[ia], az = A.z[ia], dax = A.x[ia + 1] - ax, daz = A.z[ia + 1] - az;
        const bx = Bp.x[ib], bz = Bp.z[ib], dbx = Bp.x[ib + 1] - bx, dbz = Bp.z[ib + 1] - bz;
        const den = dax * dbz - daz * dbx;
        if (Math.abs(den) < 1e-12) continue;
        const ex = bx - ax, ez = bz - az;
        const t = (ex * dbz - ez * dbx) / den;
        const u = (ex * daz - ez * dax) / den;
        if (t < 0 || t >= 1 || u < 0 || u >= 1) continue;
        const x = ax + dax * t, z = az + daz * t;
        if (Math.floor(x / B) !== ci || Math.floor(z / B) !== cj) continue;
        const la = Math.hypot(dax, daz), lb = Math.hypot(dbx, dbz);
        crossings.push({ a: pa, b: pb, ia, ta: t, ib, tb: u, sa: A.cum[ia] + la * t, sb: Bp.cum[ib] + lb * u, x, z, sin: Math.abs(den) / (la * lb), dax: dax / la, daz: daz / la, dbx: dbx / lb, dbz: dbz / lb });
      }
    }
  }

  // 5. profils en long : ponts sur les rivières, sauts-de-mouton, viaducs au-dessus des giratoires
  const rank = (p: NetPath) => (p.kind === 'nationale' ? 0 : p.kind === 'rail' ? 1 : 2);
  const order = paths.map((_, i) => i).sort((a, b) => rank(paths[a]) - rank(paths[b]) || paths[a].link - paths[b].link);
  const done = new Uint8Array(paths.length);
  const yAt = (p: NetPath, i: number, t: number) => p.y[i] + (p.y[Math.min(p.n - 1, i + 1)] - p.y[i]) * t;
  const bridges: Network['bridges'] = [];
  for (const pi of order) {
    const p = paths[pi];
    const req = new Float64Array(p.n).fill(-Infinity);
    // rivières : tablier au-dessus du quai sur toute la traversée
    let run = -1;
    let deck = 0, water = 0;
    for (let i = 0; i <= p.n; i++) {
      const q = i < p.n ? quayAt(p.x[i], p.z[i]) : { d: 9, yq: -Infinity };
      const inside = q.d < QUAY_HALF + 0.012 && q.yq > -Infinity;
      if (inside) {
        if (run < 0) { run = i; deck = -Infinity; }
        deck = Math.max(deck, q.yq + 0.011);
        water = q.yq - 0.006;
        req[i] = Math.max(req[i], deck);
      } else if (run >= 0) {
        for (let k = run; k < i; k++) req[k] = deck;
        if (run > 0 && i < p.n) bridges.push({ p: pi, s0: p.cum[run], s1: p.cum[i - 1], water });
        run = -1;
      }
    }
    // ouvrages au-dessus des voies de rang inférieur
    for (const c of crossings) {
      if (c.a !== pi && c.b !== pi) continue;
      const other = c.a === pi ? c.b : c.a;
      if (!done[other] || c.sin < 0.25) continue;
      const o = paths[other];
      if (rank(o) === 0 && rank(p) === 0) continue; // avenues : carrefour à niveau
      const yo = c.a === pi ? yAt(o, c.ib, c.tb) : yAt(o, c.ia, c.ta);
      const s = c.a === pi ? c.sa : c.sb;
      const plateau = o.half / c.sin + 0.012;
      for (let i = 0; i < p.n; i++) if (Math.abs(p.cum[i] - s) <= plateau) req[i] = Math.max(req[i], yo + CLEAR);
    }
    if (p.kind !== 'nationale') for (const rb of roundabouts) {
      for (let i = 0; i < p.n; i++) if (Math.hypot(p.x[i] - rb.x, p.z[i] - rb.z) < rb.r + 0.015) req[i] = Math.max(req[i], rb.y + CLEAR);
    }
    const SL = p.kind === 'rail' ? 0.035 : 0.045;
    for (let i = 0; i < p.n; i++) p.y[i] = Math.max(p.y[i], req[i]);
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 1; i < p.n; i++) p.y[i] = Math.max(p.y[i], p.y[i - 1] - SL * (p.cum[i] - p.cum[i - 1]));
      for (let i = p.n - 2; i >= 0; i--) p.y[i] = Math.max(p.y[i], p.y[i + 1] - SL * (p.cum[i + 1] - p.cum[i]));
    }
    const tmp = new Float64Array(p.n);
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < p.n; i++) tmp[i] = (p.y[Math.max(0, i - 1)] + 2 * p.y[i] + p.y[Math.min(p.n - 1, i + 1)]) / 4;
      for (let i = 0; i < p.n; i++) p.y[i] = Math.max(tmp[i], req[i], p.g[i] + LIFT[p.kind]);
    }
    done[pi] = 1;
  }

  // 6. échangeurs : bretelles en quart de trèfle aux croisements de voies rapides
  for (const c of crossings) {
    const A = paths[c.a], Bp = paths[c.b];
    if (A.kind !== 'autoroute' || Bp.kind !== 'autoroute' || c.sin < 0.5) continue;
    const lowerIsA = A.link < Bp.link;
    const [ax, az, bx, bz] = lowerIsA ? [c.dax, c.daz, c.dbx, c.dbz] : [c.dbx, c.dbz, c.dax, c.daz];
    const L = 0.26, off = HALF.autoroute + HALF.ramp;
    for (const sa of [1, -1]) for (const sb of [1, -1]) {
      const pax = -az, paz = ax, pbx = -bz, pbz = bx;
      const sA = Math.sign(pax * sb * bx + paz * sb * bz) || 1;
      const sB = Math.sign(pbx * sa * ax + pbz * sa * az) || 1;
      const Ax = c.x + sa * ax * L + pax * sA * off, Az = c.z + sa * az * L + paz * sA * off;
      const Bx = c.x + sb * bx * L + pbx * sB * off, Bz = c.z + sb * bz * L + pbz * sB * off;
      const den = ax * bz - az * bx;
      const t = ((Bx - Ax) * bz - (Bz - Az) * bx) / den;
      const Kx = Ax + ax * t, Kz = Az + az * t;
      const pts: [number, number][] = [];
      for (let k = 0; k <= 28; k++) {
        const u = k / 28, w0 = (1 - u) * (1 - u), w1 = 2 * u * (1 - u), w2 = u * u;
        pts.push([w0 * Ax + w1 * Kx + w2 * Bx, w0 * Az + w1 * Kz + w2 * Bz]);
      }
      paths.push(mk('ramp', -1, pts));
    }
  }

  // 7. carrefours d'avenues (plateaux) et passages piétons
  const plates: Quad[] = [];
  const zebras: Quad[] = [];
  const quad = (list: Quad[], cx: number, cz: number, y: number, ux: number, uz: number, ea: number, eb: number, u0: number, u1: number, vMode: 'world' | 'across') => {
    const vx = -uz, vz = ux; // perpendiculaire
    const P: number[] = [], UV: number[] = [];
    for (const [sa, sb] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const x = cx + ux * ea * sa + vx * eb * sb, z = cz + uz * ea * sa + vz * eb * sb;
      P.push(x, y, z);
      UV.push(sa < 0 ? u0 : u1, vMode === 'world' ? (x + z * 0.7) / TILE : (eb * (sb + 1)) / TILE);
    }
    list.push({ pts: P, uv: UV });
  };
  const [zu0, zu1] = regU('zebra');
  const CW = 0.0076; // demi-chaussée d'avenue (axe → bordure)
  const plateCenters: [number, number][] = [];
  for (const c of crossings) {
    const A = paths[c.a], Bp = paths[c.b];
    if (A.kind !== 'nationale' || Bp.kind !== 'nationale' || c.sin < 0.3) continue;
    const ya = yAt(A, c.ia, c.ta), yb = yAt(Bp, c.ib, c.tb);
    if (Math.abs(ya - yb) > 0.003 || ya - A.g[c.ia] > 0.003) continue;
    const m = 0.002;
    const ea = A.half / c.sin + m, eb = Bp.half / c.sin + m;
    // parallélogramme : côtés le long de A (étendue eb) et de B (étendue ea)
    const P: number[] = [], UV: number[] = [];
    const y = Math.max(ya, yb) + 0.0004;
    for (const [s1, s2] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const x = c.x + c.dax * eb * s1 + c.dbx * ea * s2, z = c.z + c.daz * eb * s1 + c.dbz * ea * s2;
      P.push(x, y, z);
      UV.push(U_ASPHALT, (x + z * 0.7) / TILE);
    }
    plates.push({ pts: P, uv: UV });
    plateCenters.push([c.x, c.z]);
    for (const [ux, uz, e, h] of [[c.dax, c.daz, eb, CW], [c.dbx, c.dbz, ea, CW]]) {
      for (const s of [1, -1]) quad(zebras, c.x + ux * s * (e + 0.0028), c.z + uz * s * (e + 0.0028), y, ux, uz, 0.002, h, zu0, zu1, 'across');
    }
  }
  // passages piétons des avenues aux croisements avec la grille des rues
  for (const p of paths) {
    if (p.kind !== 'nationale') continue;
    for (let i = 0; i < p.n - 1; i++) {
      for (const axis of [0, 1]) {
        const a0 = axis ? p.z[i] : p.x[i], a1 = axis ? p.z[i + 1] : p.x[i + 1];
        const k0 = Math.ceil(Math.min(a0, a1) / 0.2 - 1e-9), k1 = Math.floor(Math.max(a0, a1) / 0.2 + 1e-9);
        for (let k = k0; k <= k1; k++) {
          const line = k * 0.2;
          if (a1 === a0) continue;
          const t = (line - a0) / (a1 - a0);
          if (t < 0 || t >= 1) continue;
          const x = p.x[i] + (p.x[i + 1] - p.x[i]) * t, z = p.z[i] + (p.z[i + 1] - p.z[i]) * t;
          const s = p.cum[i] + (p.cum[i + 1] - p.cum[i]) * t;
          const L = p.cum[i + 1] - p.cum[i];
          const tx = (p.x[i + 1] - p.x[i]) / L, tz = (p.z[i + 1] - p.z[i]) / L;
          const sin = Math.abs(axis ? tz : tx); // angle entre l'avenue et la rue (rue // à l'autre axe)
          if (sin < 0.45 || s < 0.04 || s > p.len - 0.04) continue;
          const y = p.y[i] + (p.y[i + 1] - p.y[i]) * t;
          if (y - p.g[i] > 0.0025 || urbanDensity(country, x, z) < 0.3) continue;
          if (plateCenters.some(([px, pz]) => Math.abs(px - x) < 0.05 && Math.abs(pz - z) < 0.05)) continue;
          if (roundabouts.some((rb) => Math.hypot(rb.x - x, rb.z - z) < rb.r + 0.03)) continue;
          const C = Math.abs(k) % 5 === 0 ? 0.0105 : 0.0047;
          for (const sg of [1, -1]) {
            const d = C / sin + 0.0035;
            quad(zebras, x + tx * sg * d, z + tz * sg * d, y + 0.0004, tx, tz, 0.002, CW, zu0, zu1, 'across');
          }
        }
      }
    }
  }

  // 8. rivières : géométrie des quais (identique au ruban d'eau)
  const rivers: Network['rivers'] = country.rivers.map((r) => {
    const pts = densify(r.points, 0.1);
    const n = pts.length;
    const R = { x: new Float64Array(n), z: new Float64Array(n), w: new Float64Array(n), nx: new Float64Array(n), nz: new Float64Array(n), ok: new Uint8Array(n) };
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      let dx = b[0] - a[0], dz = b[1] - a[1];
      const l = Math.hypot(dx, dz) || 1;
      dx /= l; dz /= l;
      R.x[i] = pts[i][0]; R.z[i] = pts[i][1];
      R.nx[i] = -dz; R.nz[i] = dx;
      R.w[i] = waterY(grid, pts[i][0], pts[i][1]);
      R.ok[i] = pts[i][0] > coastX(seed, pts[i][1]) + 0.8 && Math.abs(pts[i][0]) < HALF_W - 0.2 && Math.abs(pts[i][1]) < HALF_D - 0.2 ? 1 : 0;
    }
    return R;
  });

  // 9. grille d'occupation
  const occN = Math.ceil((HALF_W * 2) / OCC), occM = Math.ceil((HALF_D * 2) / OCC);
  const occ = new Uint8Array(occN * occM);
  const mark = (x: number, z: number, r: number, bits: number) => {
    const i0 = Math.max(0, Math.floor((x - r + HALF_W) / OCC)), i1 = Math.min(occN - 1, Math.floor((x + r + HALF_W) / OCC));
    const j0 = Math.max(0, Math.floor((z - r + HALF_D) / OCC)), j1 = Math.min(occM - 1, Math.floor((z + r + HALF_D) / OCC));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) occ[j * occN + i] |= bits;
  };
  for (const p of paths) {
    for (let i = 0; i < p.n - 1; i++) {
      const L = p.cum[i + 1] - p.cum[i];
      const k = Math.max(1, Math.ceil(L / 0.0125));
      for (let q = 0; q < k; q++) {
        const t = q / k;
        const x = p.x[i] + (p.x[i + 1] - p.x[i]) * t, z = p.z[i] + (p.z[i + 1] - p.z[i]) * t;
        const elevated = p.y[i] - p.g[i] > 0.005;
        mark(x, z, p.half + 0.004, p.kind !== 'nationale' && !elevated ? 3 : 1);
      }
    }
  }
  for (const rb of roundabouts) mark(rb.x, rb.z, rb.r + 0.004, 1);
  for (const r of country.rivers) for (const [x, z] of densify(r.points, 0.0125)) mark(x, z, 0.2, 3);
  for (const l of country.lakes) mark(l.x, l.z, l.r * 1.3, 3);

  return { paths, roundabouts, plates, zebras, bridges, occ, occN, occM, rivers, crossings };
}

/**
 * Masque des chenaux (distance à l'axe des rivières, 0..0,5 km sur 8 bits) : le relief est découpé
 * entre les murs de quai pour que l'eau et le lit restent visibles quel que soit le pas du maillage.
 */
export const MASK_W = 2048, MASK_H = 1536;
export function riverMask(net: Network) {
  const data = new Uint8Array(MASK_W * MASK_H).fill(255);
  const sx = MASK_W / (HALF_W * 2), sz = MASK_H / (HALF_D * 2);
  for (const r of net.rivers) {
    for (let i = 0; i < r.x.length - 1; i++) {
      if (!r.ok[i] || !r.ok[i + 1]) continue;
      const ax = r.x[i], az = r.z[i], bx = r.x[i + 1], bz = r.z[i + 1];
      const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1e-9;
      const m = 0.3;
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - m + HALF_W) * sx)), i1 = Math.min(MASK_W - 1, Math.ceil((Math.max(ax, bx) + m + HALF_W) * sx));
      const j0 = Math.max(0, Math.floor((Math.min(az, bz) - m + HALF_D) * sz)), j1 = Math.min(MASK_H - 1, Math.ceil((Math.max(az, bz) + m + HALF_D) * sz));
      for (let j = j0; j <= j1; j++) {
        const z = -HALF_D + (j + 0.5) / sz;
        for (let k = i0; k <= i1; k++) {
          const x = -HALF_W + (k + 0.5) / sx;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
          const d = Math.hypot(ax + dx * t - x, az + dz * t - z);
          const v = Math.min(255, Math.round((d / 0.5) * 255));
          if (v < data[j * MASK_W + k]) data[j * MASK_W + k] = v;
        }
      }
    }
  }
  return data;
}

// ---------------------------------------------------------------------------------------------
// Feux tricolores (partagés avec la circulation)
// ---------------------------------------------------------------------------------------------
export const CLOCK = { t: 0 };
const CYCLE = 26;
/** Le carrefour (kx, kz) de la grille porte-t-il des feux ? (boulevards tous les 1 km) */
export const hasSignal = (kx: number, kz: number) => kx % 5 === 0 || kz % 5 === 0;
/** État du feu pour la circulation dans l'axe `axis` (0 = le long de x) : 0 vert, 1 orange, 2 rouge. */
export function signalState(kx: number, kz: number, axis: number, t = CLOCK.t) {
  const off = (((kx * 73856093) ^ (kz * 19349663)) >>> 0) % 1000 / 1000 * CYCLE;
  const ph = (t + off) % CYCLE;
  const a = ph < 13 ? 0 : 1; // axe vert
  const local = ph % 13;
  if (a !== axis) return 2;
  return local < 10.5 ? 0 : local < 12.5 ? 1 : 2;
}

// ---------------------------------------------------------------------------------------------
// Construction des maillages
// ---------------------------------------------------------------------------------------------
class Geo {
  pos: number[] = []; nrm: number[] = []; uv: number[] = []; idx: number[] = []; extra: number[] = [];
  get count() { return this.pos.length / 3; }
  v(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, w: number, e = 0) {
    this.pos.push(x, y, z); this.nrm.push(nx, ny, nz); this.uv.push(u, w); this.extra.push(e);
    return this.count - 1;
  }
  quad(a: number, b: number, c: number, d: number) { this.idx.push(a, b, c, a, c, d); }
  /** Paroi verticale entre (x0,z0) et (x1,z1), du bas yb au haut yt. */
  wall(x0: number, z0: number, yb0: number, yt0: number, x1: number, z1: number, yb1: number, yt1: number, u: number, v0: number, v1: number, e = 0) {
    let nx = z1 - z0, nz = -(x1 - x0);
    const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
    const a = this.v(x0, yb0, z0, nx, 0, nz, u, v0, e), b = this.v(x1, yb1, z1, nx, 0, nz, u, v1, e);
    const c = this.v(x1, yt1, z1, nx, 0, nz, u, v1, e), d = this.v(x0, yt0, z0, nx, 0, nz, u, v0, e);
    this.quad(a, b, c, d);
  }
  mesh(name: string, scene: Scene, extraName?: string) {
    const m = new Mesh(name, scene);
    const vd = new VertexData();
    vd.positions = this.pos; vd.normals = this.nrm; vd.uvs = this.uv; vd.indices = this.idx;
    vd.applyToMesh(m);
    if (extraName) m.setVerticesData(extraName, this.extra, false, 1);
    m.isPickable = false;
    m.receiveShadows = true;
    m.freezeWorldMatrix();
    return m;
  }
}

function loadImages(names: Record<string, string>, done: (imgs: Record<string, HTMLImageElement | null>) => void) {
  const out: Record<string, HTMLImageElement | null> = {};
  const keys = Object.keys(names);
  let left = keys.length;
  for (const k of keys) {
    const im = new Image();
    im.onload = () => { out[k] = im; if (--left === 0) done(out); };
    im.onerror = () => { out[k] = null; if (--left === 0) done(out); };
    im.src = names[k];
  }
}

function addShadowCaster(scene: Scene, m: Mesh) {
  for (const l of scene.lights) {
    const sg = (l as unknown as { getShadowGenerator?: () => { addShadowCaster: (m: Mesh) => void } | null }).getShadowGenerator?.();
    sg?.addShadowCaster(m);
  }
}
function excludeFromGlow(scene: Scene, m: Mesh) {
  for (const l of scene.effectLayers ?? []) (l as GlowLayer).addExcludedMesh?.(m);
}

export function createRoads(scene: Scene, grid: Grid, country: CountryDef) {
  const net = getNetwork(grid, country);
  const ql = qualityLevel();
  const rnd = mulberry32(country.seed + 404);

  // --- atlas des chaussées ---
  const scale = ql === 0 ? 0.5 : 1;
  const canvas = document.createElement('canvas');
  canvas.width = AW * scale; canvas.height = AH * scale;
  const ctx = canvas.getContext('2d')!;
  const stoneCanvas = document.createElement('canvas');
  const SS = ql === 0 ? 256 : 512;
  stoneCanvas.width = stoneCanvas.height = SS;
  const sctx = stoneCanvas.getContext('2d')!;
  const paint = (imgs: Record<string, HTMLImageElement | null>) => {
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    paintAtlas(ctx, imgs);
    paintStone(sctx, SS, imgs.Concrete034 ?? null);
  };
  paint({});
  const atlas = new DynamicTexture('roadAtlas', canvas, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
  atlas.wrapU = Texture.CLAMP_ADDRESSMODE;
  atlas.wrapV = Texture.WRAP_ADDRESSMODE;
  atlas.anisotropicFilteringLevel = ql === 0 ? 4 : 8;
  atlas.update(false);
  const stoneTex = new DynamicTexture('stoneTex', stoneCanvas, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
  stoneTex.wrapU = stoneTex.wrapV = Texture.WRAP_ADDRESSMODE;
  stoneTex.update(false);
  loadImages({
    Road012A: '/assets/acg/Road012A/color.jpg', Asphalt025C: '/assets/acg/Asphalt025C/color.jpg', Concrete034: '/assets/acg/Concrete034/color.jpg',
    PavingStones138: '/assets/acg/PavingStones138/color.jpg', grass: '/assets/textures/aerial_grass_rock.jpg',
  }, (imgs) => { paint(imgs); atlas.update(false); stoneTex.update(false); });

  const roadMat = new StandardMaterial('roadMat', scene);
  roadMat.diffuseTexture = atlas;
  // éclairage public : flaques de lumière chaude tous les TILE (36 m), alignées sur les lampadaires
  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = 256; glowCanvas.height = 128;
  {
    const gc = glowCanvas.getContext('2d')!;
    const img = gc.createImageData(256, 128);
    for (let y = 0; y < 128; y++) {
      const f = (y + 0.5) / 128 - 0.5;
      const pool = Math.exp(-(((f * 36) / 7) ** 2));
      for (let x = 0; x < 256; x++) {
        const u = (x + 0.5) / 256;
        const k = u < U(REG.rail.x) ? 0.22 + 0.78 * pool : u < U(REG.zebra.x) ? 0.08 : u < U(REG.concrete.x) ? 0.22 + 0.78 * pool : 0.45;
        const o = (y * 256 + x) * 4;
        img.data[o] = 255 * k; img.data[o + 1] = 175 * k; img.data[o + 2] = 95 * k; img.data[o + 3] = 255;
      }
    }
    gc.putImageData(img, 0, 0);
  }
  const glowTex = new DynamicTexture('roadGlow', glowCanvas, scene, true);
  glowTex.wrapU = Texture.CLAMP_ADDRESSMODE;
  glowTex.wrapV = Texture.WRAP_ADDRESSMODE;
  glowTex.update(false);
  roadMat.emissiveTexture = glowTex;
  roadMat.emissiveColor = Color3.Black();
  roadMat.specularColor = new Color3(0.06, 0.06, 0.06);
  roadMat.backFaceCulling = false;
  roadMat.zOffset = -2;
  roadMat.zOffsetUnits = -4;
  const plateMat = roadMat.clone('plateMat');
  plateMat.zOffset = -4;
  plateMat.zOffsetUnits = -8;

  // --- rubans des voies, garde-corps, glissières, tabliers ---
  const g = new Geo();
  const stone = new Geo(); // extra : 0 pierre, 1 pavés, 2 pelouse
  const piers: number[] = []; // x, yBas, z, hauteur, largeur, profondeur, angle
  const stoneSpan = (pi: number, s: number) => net.bridges.some((b) => b.p === pi && net.paths[pi].stone && s > b.s0 - 0.006 && s < b.s1 + 0.006);
  net.paths.forEach((p, pi) => {
    const [u0, u1] = regU(p.kind);
    const h = p.half;
    const base = g.count;
    const nx = new Float64Array(p.n), nz = new Float64Array(p.n);
    for (let i = 0; i < p.n; i++) {
      let a = Math.max(0, i - 1), b = Math.min(p.n - 1, i + 1);
      if (p.closed && (i === 0 || i === p.n - 1)) { a = p.n - 2; b = 1; }
      let dx = p.x[b] - p.x[a], dz = p.z[b] - p.z[a];
      const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      nx[i] = -dz; nz[i] = dx; // gauche
      const v = p.cum[i] / TILE;
      g.v(p.x[i] + nx[i] * h, p.y[i], p.z[i] + nz[i] * h, 0, 1, 0, u0, v);
      g.v(p.x[i] - nx[i] * h, p.y[i], p.z[i] - nz[i] * h, 0, 1, 0, u1, v);
      if (i < p.n - 1) g.quad(base + i * 2, base + i * 2 + 2, base + i * 2 + 3, base + i * 2 + 1);
    }
    // éléments verticaux par segment
    for (let i = 0; i < p.n - 1; i++) {
      const j = i + 1;
      const v0 = p.cum[i] / TILE, v1 = p.cum[j] / TILE;
      const e0 = p.y[i] - p.g[i], e1 = p.y[j] - p.g[j];
      const elevated = e0 > 0.0025 || e1 > 0.0025;
      const inStone = stoneSpan(pi, p.cum[i]) || stoneSpan(pi, p.cum[j]);
      const L = (k: number, side: number) => [p.x[k] + nx[k] * h * side, p.z[k] + nz[k] * h * side] as const;
      for (const side of [1, -1]) {
        const [x0, z0] = L(i, side), [x1, z1] = L(j, side);
        if (p.kind === 'autoroute') g.wall(x0, z0, p.y[i], p.y[i] + 0.0008, x1, z1, p.y[j], p.y[j] + 0.0008, U_METAL, v0, v1);
        else if (elevated && !inStone) g.wall(x0, z0, p.y[i], p.y[i] + 0.0011, x1, z1, p.y[j], p.y[j] + 0.0011, U_CONCRETE, v0, v1);
        if (elevated && !inStone) g.wall(x0, z0, p.y[i] - DECK, p.y[i], x1, z1, p.y[j] - DECK, p.y[j], U_CONCRETE, v0, v1);
      }
      if (p.kind === 'autoroute') g.wall(p.x[i], p.z[i], p.y[i], p.y[i] + 0.0009, p.x[j], p.z[j], p.y[j], p.y[j] + 0.0009, U_CONCRETE, v0, v1);
      if (elevated && !inStone) { // sous-face du tablier
        const [ax, az] = L(i, 1), [bx, bz] = L(j, 1), [cx, cz] = L(j, -1), [dx, dz] = L(i, -1);
        const a = g.v(ax, p.y[i] - DECK, az, 0, -1, 0, U_CONCRETE, v0), b = g.v(bx, p.y[j] - DECK, bz, 0, -1, 0, U_CONCRETE, v1);
        const c = g.v(cx, p.y[j] - DECK, cz, 0, -1, 0, U_CONCRETE, v1), d = g.v(dx, p.y[i] - DECK, dz, 0, -1, 0, U_CONCRETE, v0);
        g.quad(a, b, c, d);
      }
    }
    // piles des ouvrages en béton
    const spacing = p.kind === 'autoroute' ? 0.036 : 0.03;
    for (let s = spacing / 2; s < p.len; s += spacing) {
      const o = sampleAt(p, s, { x: 0, y: 0, z: 0, tx: 0, tz: 0 });
      // sol réel (terrasses des quais comprises), interpolé sur le profil
      let lo = 0, hi = p.n - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (p.cum[mid] < s) lo = mid; else hi = mid; }
      const tg = (s - p.cum[lo]) / Math.max(1e-6, p.cum[hi] - p.cum[lo]);
      const gy = Math.min(p.g[lo] + (p.g[hi] - p.g[lo]) * tg, o.y);
      if (o.y - gy < 0.0045 || stoneSpan(pi, s)) continue;
      // pas de pile sur une voie inférieure
      const blocked = net.crossings.some((c) => {
        if (c.a !== pi && c.b !== pi) return false;
        const o2 = net.paths[c.a === pi ? c.b : c.a];
        const dx = c.a === pi ? c.dbx : c.dax, dz = c.a === pi ? c.dbz : c.daz;
        const d = Math.abs((o.x - c.x) * -dz + (o.z - c.z) * dx);
        return d < o2.half + 0.003 && Math.hypot(o.x - c.x, o.z - c.z) < 0.15;
      });
      if (blocked) continue;
      const ang = Math.atan2(o.tx, o.tz);
      const top = o.y - DECK;
      const cols = p.kind === 'autoroute' ? [-0.62, 0, 0.62] : p.kind === 'rail' ? [0] : [-0.5, 0.5];
      for (const c of cols) piers.push(o.x - o.tz * c * h, gy - 0.002, o.z + o.tx * c * h, top - gy + 0.002, 0.0016, 0.0016, ang);
      piers.push(o.x, top - 0.0011, o.z, 0.0011, h * 1.7, 0.002, ang); // chevêtre
    }
    // ponts en pierre à arches (avenues et voies ferrées sur les rivières)
    for (const b of net.bridges) {
      if (b.p !== pi || !p.stone) continue;
      const span = b.s1 - b.s0;
      const nA = Math.max(1, Math.round(span / 0.05));
      const pw = 0.0042; // demi-largeur des piles
      const step = ql === 0 ? 0.004 : 0.0025;
      const spring = b.water + 0.0015;
      const tmp = { x: 0, y: 0, z: 0, tx: 0, tz: 0 };
      const W = h + 0.0004;
      const sideData = (s: number) => {
        const o = sampleAt(p, s, tmp);
        const k = Math.min(nA - 1, Math.max(0, Math.floor((s - b.s0) / (span / nA))));
        const a0 = b.s0 + k * (span / nA), a1 = a0 + span / nA;
        const bed = Math.min(surfaceY(grid, o.x, o.z), b.water) - 0.004;
        let bottom = bed;
        if (s > a0 + pw && s < a1 - pw) {
          const t = (s - a0 - pw) / (a1 - a0 - 2 * pw);
          const crown = o.y - 0.0045;
          bottom = Math.max(bed, spring + (crown - spring) * Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2)));
        }
        return { x: o.x, z: o.z, y: o.y, tx: o.tx, tz: o.tz, bottom, arch: bottom > bed + 1e-5 };
      };
      let prev = sideData(b.s0 - pw - 0.004);
      for (let s = b.s0 - pw - 0.004 + step; s <= b.s1 + pw + 0.004 + 1e-9; s += step) {
        const cur = sideData(s);
        for (const side of [1, -1]) {
          const px0 = prev.x - prev.tz * W * side, pz0 = prev.z + prev.tx * W * side;
          const px1 = cur.x - cur.tz * W * side, pz1 = cur.z + cur.tx * W * side;
          const sv = (yy: number, ytop: number) => (ytop - yy) / 0.008;
          // tympan : du dessous (arche ou pile) jusqu'au parapet
          const top0 = prev.y + 0.0011, top1 = cur.y + 0.0011;
          const nxw = (pz1 - pz0) * side, nzw = -(px1 - px0) * side;
          const l = Math.hypot(nxw, nzw) || 1;
          const a = stone.v(px0, prev.bottom, pz0, nxw / l, 0, nzw / l, (s - step) / 0.008, sv(prev.bottom, top0), 0);
          const bb = stone.v(px1, cur.bottom, pz1, nxw / l, 0, nzw / l, s / 0.008, sv(cur.bottom, top1), 0);
          const c = stone.v(px1, top1, pz1, nxw / l, 0, nzw / l, s / 0.008, 0, 0);
          const d = stone.v(px0, top0, pz0, nxw / l, 0, nzw / l, (s - step) / 0.008, 0, 0);
          stone.quad(a, bb, c, d);
          // face intérieure du parapet
          const ix0 = prev.x - prev.tz * (W - 0.0005) * side, iz0 = prev.z + prev.tx * (W - 0.0005) * side;
          const ix1 = cur.x - cur.tz * (W - 0.0005) * side, iz1 = cur.z + cur.tx * (W - 0.0005) * side;
          const a2 = stone.v(ix0, prev.y, iz0, -nxw / l, 0, -nzw / l, (s - step) / 0.008, 0.14, 0);
          const b2 = stone.v(ix1, cur.y, iz1, -nxw / l, 0, -nzw / l, s / 0.008, 0.14, 0);
          const c2 = stone.v(ix1, top1, iz1, -nxw / l, 0, -nzw / l, s / 0.008, 0, 0);
          const d2 = stone.v(ix0, top0, iz0, -nxw / l, 0, -nzw / l, (s - step) / 0.008, 0, 0);
          stone.quad(a2, b2, c2, d2);
          const a3 = stone.v(px0, top0, pz0, 0, 1, 0, (s - step) / 0.008, 0.02, 0), b3 = stone.v(px1, top1, pz1, 0, 1, 0, s / 0.008, 0.02, 0);
          const c3 = stone.v(ix1, top1, iz1, 0, 1, 0, s / 0.008, 0.08, 0), d3 = stone.v(ix0, top0, iz0, 0, 1, 0, (s - step) / 0.008, 0.08, 0);
          stone.quad(a3, b3, c3, d3);
        }
        // intrados (voûte) sous les arches, sinon sous-face
        {
          const L0 = [prev.x - prev.tz * W, prev.z + prev.tx * W], R0 = [prev.x + prev.tz * W, prev.z - prev.tx * W];
          const L1 = [cur.x - cur.tz * W, cur.z + cur.tx * W], R1 = [cur.x + cur.tz * W, cur.z - cur.tx * W];
          const dy = cur.bottom - prev.bottom;
          let ny = -step, nt = dy; // normale vers le bas/l'intérieur de la voûte
          const l = Math.hypot(ny, nt) || 1; ny /= l; nt /= l;
          const nxx = prev.tx * nt, nzz = prev.tz * nt;
          const a = stone.v(L0[0], prev.bottom, L0[1], nxx, ny, nzz, 0, (s - step) / 0.008, 0);
          const bb = stone.v(R0[0], prev.bottom, R0[1], nxx, ny, nzz, (2 * W) / 0.008, (s - step) / 0.008, 0);
          const c = stone.v(R1[0], cur.bottom, R1[1], nxx, ny, nzz, (2 * W) / 0.008, s / 0.008, 0);
          const d = stone.v(L1[0], cur.bottom, L1[1], nxx, ny, nzz, 0, s / 0.008, 0);
          stone.quad(a, bb, c, d);
        }
        prev = cur;
      }
      // avant-becs des piles (côté amont et aval)
      for (let k = 1; k < nA; k++) {
        const s = b.s0 + k * (span / nA);
        const o = sampleAt(p, s, tmp);
        const top = b.water + 0.006;
        const bed = Math.min(surfaceY(grid, o.x, o.z), b.water) - 0.004;
        for (const side of [1, -1]) {
          const cx = o.x - o.tz * W * side, cz = o.z + o.tx * W * side;
          const tipx = o.x - o.tz * (W + 0.004) * side, tipz = o.z + o.tx * (W + 0.004) * side;
          for (const sg of [1, -1]) {
            const ex = cx + o.tx * pw * sg, ez = cz + o.tz * pw * sg;
            const [ax, az, bx2, bz2] = sg * side > 0 ? [ex, ez, tipx, tipz] : [tipx, tipz, ex, ez];
            stone.wall(ax, az, bed, top, bx2, bz2, bed, top, 0, s / 0.008, (s + 0.004) / 0.008, 0);
            const t0 = stone.v(ex, top, ez, 0, 1, 0, 0.1, 0.1, 0), t1 = stone.v(tipx, top, tipz, 0, 1, 0, 0.3, 0.1, 0), t2 = stone.v(cx, top, cz, 0, 1, 0, 0.2, 0.3, 0);
            stone.idx.push(t0, t1, t2, t0, t2, t1);
          }
        }
      }
    }
  });
  // giratoires : anneau de chaussée et îlot central planté
  for (const rb of net.roundabouts) {
    const [ru0, ru1] = regU('ramp');
    const seg = 48, Ri = rb.r - 0.009;
    const reps = Math.max(1, Math.round((2 * Math.PI * rb.r) / TILE));
    const base = g.count;
    const y = rb.y + 0.0005;
    const c0 = g.v(rb.x, y, rb.z, 0, 1, 0, U_PLANTED, 0);
    for (let k = 0; k <= seg; k++) {
      const a = (k / seg) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      const v = (k / seg) * reps;
      g.v(rb.x + ca * rb.r, y, rb.z + sa * rb.r, 0, 1, 0, ru0, v);
      g.v(rb.x + ca * Ri, y, rb.z + sa * Ri, 0, 1, 0, ru1, v);
      g.v(rb.x + ca * Ri, y + 0.0002, rb.z + sa * Ri, 0, 1, 0, U_PLANTED, v);
      if (k < seg) {
        const i = base + 1 + k * 3;
        g.quad(i, i + 3, i + 4, i + 1);
        g.idx.push(c0, i + 5, i + 2);
      }
    }
    void c0;
  }
  const roads = g.mesh('roads', scene);
  roads.material = roadMat;
  excludeFromGlow(scene, roads);

  // plateaux de carrefour et passages piétons (décalage de profondeur supérieur)
  const pg = new Geo();
  for (const q of [...net.plates, ...net.zebras]) {
    const b = pg.count;
    for (let k = 0; k < 4; k++) pg.v(q.pts[k * 3], q.pts[k * 3 + 1], q.pts[k * 3 + 2], 0, 1, 0, q.uv[k * 2], q.uv[k * 2 + 1]);
    pg.quad(b, b + 1, b + 2, b + 3);
  }
  const plates = pg.count ? pg.mesh('roadPlates', scene) : null;
  if (plates) { plates.material = plateMat; excludeFromGlow(scene, plates); }

  // --- quais : mur en pierre, promenade pavée, terrasse plantée ---
  const QL: [number, number][] = [[QUAY_HALF, 1], [0.2, 1], [0.2, 2], [0.24, 2], [0.29, 2], [0.34, 2], [QUAY_OUT, 2]];
  for (const r of net.rivers) {
    const n = r.x.length;
    for (const side of [1, -1]) {
      const rows: number[][] = [];
      for (let i = 0; i < n; i++) {
        const yq = r.w[i] + 0.006;
        const row: number[] = [];
        for (const [d, kind] of QL) {
          const x = r.x[i] + r.nx[i] * d * side, z = r.z[i] + r.nz[i] * d * side;
          const y = d <= 0.2 ? yq : Math.max(surfaceY(grid, x, z) + 0.0012, yq);
          row.push(stone.v(x, y, z, 0, 1, 0, x / 0.008, z / 0.008, kind));
        }
        rows.push(row);
      }
      for (let i = 0; i < n - 1; i++) {
        if (!r.ok[i] || !r.ok[i + 1]) continue;
        for (let k = 0; k < QL.length - 1; k++) {
          if (k === 1) continue; // couture pavés / pelouse
          const a = rows[i][k], b = rows[i][k + 1], c = rows[i + 1][k + 1], d = rows[i + 1][k];
          if (side > 0) stone.quad(a, d, c, b); else stone.quad(a, b, c, d);
        }
        // mur de quai et parapet
        const x0 = r.x[i] + r.nx[i] * QUAY_HALF * side, z0 = r.z[i] + r.nz[i] * QUAY_HALF * side;
        const x1 = r.x[i + 1] + r.nx[i + 1] * QUAY_HALF * side, z1 = r.z[i + 1] + r.nz[i + 1] * QUAY_HALF * side;
        const y0 = r.w[i] + 0.006, y1 = r.w[i + 1] + 0.006;
        const b0 = r.w[i] - 0.061, b1 = r.w[i + 1] - 0.061;
        const v0 = (i * 0.1) / 0.008, v1 = ((i + 1) * 0.1) / 0.008;
        const sw = (ax: number, az: number, ya: number, yb: number, bx: number, bz: number, yc: number, yd: number) => {
          // pierre : u le long, v vertical
          let nx = bz - az, nz = -(bx - ax); const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
          if (side < 0) { nx = -nx; nz = -nz; }
          const a = stone.v(ax, ya, az, -nx, 0, -nz, v0, (yb - ya) / 0.008, 0), b = stone.v(bx, yc, bz, -nx, 0, -nz, v1, (yd - yc) / 0.008, 0);
          const c = stone.v(bx, yd, bz, -nx, 0, -nz, v1, 0, 0), d = stone.v(ax, yb, az, -nx, 0, -nz, v0, 0, 0);
          stone.quad(a, b, c, d); stone.quad(a, d, c, b);
        };
        sw(x0, z0, b0, y0 + 0.0009, x1, z1, b1, y1 + 0.0009);
        const ix0 = x0 + r.nx[i] * 0.0006 * side, iz0 = z0 + r.nz[i] * 0.0006 * side, ix1 = x1 + r.nx[i + 1] * 0.0006 * side, iz1 = z1 + r.nz[i + 1] * 0.0006 * side;
        sw(ix0, iz0, y0, y0 + 0.0009, ix1, iz1, y1, y1 + 0.0009);
        const t0 = stone.v(x0, y0 + 0.0009, z0, 0, 1, 0, v0, 0.02, 0), t1 = stone.v(x1, y1 + 0.0009, z1, 0, 1, 0, v1, 0.02, 0);
        const t2 = stone.v(ix1, y1 + 0.0009, iz1, 0, 1, 0, v1, 0.09, 0), t3 = stone.v(ix0, y0 + 0.0009, iz0, 0, 1, 0, v0, 0.09, 0);
        stone.quad(t0, t1, t2, t3); stone.quad(t0, t3, t2, t1);
      }
    }
  }
  // lit du chenal entre les quais (le relief y est découpé, voir riverMask)
  for (const r of net.rivers) {
    for (let i = 0; i < r.x.length - 1; i++) {
      if (!r.ok[i] || !r.ok[i + 1]) continue;
      const q: number[] = [];
      for (const [k, sd] of [[i, 1], [i + 1, 1], [i + 1, -1], [i, -1]]) {
        const x = r.x[k] + r.nx[k] * (QUAY_HALF + 0.001) * sd, z = r.z[k] + r.nz[k] * (QUAY_HALF + 0.001) * sd;
        q.push(stone.v(x, r.w[k] - 0.06, z, 0, 1, 0, x / 0.008, z / 0.008, 3));
      }
      stone.quad(q[0], q[1], q[2], q[3]);
    }
  }
  const stoneMesh = stone.mesh('stoneworks', scene, 'surf');
  stoneMesh.setVerticesData('suv', stone.uv, false, 2);
  const stoneMat = new CustomMaterial('stoneMat', scene);
  stoneMat.specularColor = new Color3(0.05, 0.05, 0.05);
  stoneMat.backFaceCulling = false;
  stoneMat.zOffset = -2;
  stoneMat.zOffsetUnits = -4;
  stoneMat.AddUniform('tStone', 'sampler2D', stoneTex);
  stoneMat.AddUniform('tPave', 'sampler2D', new Texture('/assets/acg/PavingStones138/color.jpg', scene));
  stoneMat.AddUniform('tGrassQ', 'sampler2D', new Texture('/assets/textures/aerial_grass_rock.jpg', scene));
  stoneMat.AddUniform('uNightS', 'float', 0);
  stoneMat.AddAttribute('surf');
  stoneMat.AddAttribute('suv');
  stoneMat.Vertex_Definitions('attribute float surf; attribute vec2 suv; varying float vSurf; varying vec2 vSuv;');
  stoneMat.Vertex_MainEnd('vSurf = surf; vSuv = suv;');
  stoneMat.Fragment_Definitions('varying float vSurf; varying vec2 vSuv;');
  stoneMat.Fragment_Custom_Diffuse(/* glsl */ `
    vec3 sc = texture2D(tStone, vSuv).rgb;
    vec3 pv = mix(texture2D(tPave, vPositionW.xz / 0.0035).rgb, vec3(0.62, 0.6, 0.56), 0.45);
    vec3 gr = texture2D(tGrassQ, vPositionW.xz * 4.0).rgb * vec3(0.55, 0.68, 0.45);
    diffuseColor = vSurf < 0.5 ? sc : vSurf < 1.5 ? pv : vSurf < 2.5 ? gr : vec3(0.09, 0.11, 0.1);
  `);
  stoneMat.Fragment_Before_FragColor(/* glsl */ `
    // mise en lumière chaude de la pierre et des promenades la nuit
    float lit = vSurf < 0.5 ? 0.55 : vSurf < 1.5 ? 0.35 : vSurf < 2.5 ? 0.05 : 0.0;
    color.rgb += uNightS * lit * diffuseColor * vec3(1.0, 0.72, 0.42);
  `);
  stoneMat.onBindObservable.add(() => { stoneMat.getEffect()?.setFloat('uNightS', ENV.night); });
  stoneMesh.material = stoneMat;
  addShadowCaster(scene, stoneMesh);

  // --- piles (instances fines) ---
  const pierBox = MeshBuilder.CreateBox('piers', { size: 1 }, scene);
  pierBox.bakeTransformIntoVertices(Matrix.Translation(0, 0.5, 0));
  const pierMat = new StandardMaterial('pierMat', scene);
  pierMat.diffuseColor = new Color3(0.72, 0.71, 0.68);
  pierMat.specularColor = Color3.Black();
  pierBox.material = pierMat;
  pierBox.isPickable = false;
  const np = piers.length / 7;
  if (np) {
    const buf = new Float32Array(np * 16);
    const m = new Matrix();
    for (let k = 0; k < np; k++) {
      const [x, y, z, hh, w, d, a] = piers.slice(k * 7, k * 7 + 7);
      Matrix.ScalingToRef(w, hh, d, m);
      m.multiplyToRef(Matrix.RotationY(a), m);
      m.setTranslationFromFloats(x, y, z);
      m.copyToArray(buf, k * 16);
    }
    pierBox.thinInstanceSetBuffer('matrix', buf, 16, true);
    pierBox.alwaysSelectAsActiveMesh = true;
    addShadowCaster(scene, pierBox);
  } else pierBox.setEnabled(false);

  // --- équipements de rue autour de la caméra ---
  const furniture = createFurniture(scene, grid, country, net, ql, rnd);

  scene.onBeforeRenderObservable.add(() => {
    const n = ENV.night;
    roadMat.emissiveColor.set(0.75 * n, 0.75 * n, 0.75 * n);
    plateMat.emissiveColor.copyFrom(roadMat.emissiveColor);
    const wet = 0.06 + ENV.wet * 0.25;
    roadMat.specularColor.set(wet, wet, wet);
    furniture.update();
  });
  return { roads, plates, stoneMesh, piers: pierBox };
}

// ---------------------------------------------------------------------------------------------
// Lampadaires, arbres d'alignement, feux tricolores : régénérés autour de la caméra
// Avec la bibliothèque de modèles (cityModels.ts) : lampadaires routiers à crosse, lampadaires classiques sur
// les quais et les ponts, platanes d'alignement (avenues, boulevards, quais), arbres de parc (parcs urbains,
// giratoires), peupliers le long des routes de campagne (avec niveau de détail lointain), feux tricolores
// (lampe allumée selon l'état du carrefour) et abribus sur les avenues.
// ---------------------------------------------------------------------------------------------
/** Espèces d'arbres de la bibliothèque (indice `k` des candidats arbres). */
const TREE_IDS = ['arbre_platane', 'arbre_parc_rond', 'arbre_parc_large', 'arbre_peuplier'] as const;
/** Échelle appliquée au modèle par espèce (le facteur aléatoire du candidat s'y ajoute). */
const TREE_SCALE = [0.72, 1.0, 0.75, 0.85];
interface LibFurniture {
  lamps: [ThinInstanceBuffer, ThinInstanceBuffer] | null; // routier, classique
  trees: [ThinInstanceBuffer, ThinInstanceBuffer][] | null; // par espèce : [proche, lointain]
  sig: ThinInstanceBuffer | null;
  abri: ThinInstanceBuffer | null;
}
function createFurniture(scene: Scene, grid: Grid, country: CountryDef, net: Network, ql: 0 | 1 | 2, rnd: () => number) {
  const LAMPS = [3500, 9000, 16000][ql];
  const TREES = [5000, 14000, 28000][ql];
  const RADIUS = [1.8, 2.6, 3.4][ql];
  // modèles
  const pole = MeshBuilder.CreateBox('lampPole', { width: 0.00022, height: 0.0095, depth: 0.00022 }, scene);
  pole.bakeTransformIntoVertices(Matrix.Translation(0, 0.00475, 0));
  const arm = MeshBuilder.CreateBox('lampArm', { width: 0.0018, height: 0.00012, depth: 0.00012 }, scene);
  arm.bakeTransformIntoVertices(Matrix.Translation(0.0009, 0.0094, 0));
  const lampBody = Mesh.MergeMeshes([pole, arm], true, true)!;
  lampBody.name = 'lampadaires';
  const poleMat = new StandardMaterial('lampPoleMat', scene);
  poleMat.diffuseColor = new Color3(0.48, 0.5, 0.52);
  poleMat.specularColor = new Color3(0.2, 0.2, 0.2);
  lampBody.material = poleMat;
  const head = MeshBuilder.CreateBox('lampHead', { width: 0.0007, height: 0.00018, depth: 0.0003 }, scene);
  head.bakeTransformIntoVertices(Matrix.Translation(0.0017, 0.0093, 0));
  const headMat = new StandardMaterial('lampHeadMat', scene);
  headMat.diffuseColor = new Color3(0.85, 0.85, 0.8);
  headMat.specularColor = Color3.Black();
  head.material = headMat;
  // arbre d'alignement (feuillu) : houppier + tronc, couleurs de sommets
  const crown = MeshBuilder.CreateIcoSphere('crown', { radius: 0.0032, subdivisions: 1, flat: true }, scene);
  crown.scaling.set(1, 0.9, 1);
  crown.bakeCurrentTransformIntoVertices();
  crown.bakeTransformIntoVertices(Matrix.Translation(0, 0.0072, 0));
  const trunk = MeshBuilder.CreateBox('trunk', { width: 0.0005, height: 0.0045, depth: 0.0005 }, scene);
  trunk.bakeTransformIntoVertices(Matrix.Translation(0, 0.00225, 0));
  const paintV = (m: Mesh, c: Color3) => { const n = m.getTotalVertices(); const a = new Float32Array(n * 4); for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b, 1], i * 4); m.setVerticesData('color', a); };
  paintV(crown, new Color3(1, 1, 1));
  paintV(trunk, new Color3(0.45, 0.36, 0.3));
  const tree = Mesh.MergeMeshes([crown, trunk], true, true)!;
  tree.name = 'arbresAlignement';
  const treeMat = new StandardMaterial('streetTreeMat', scene);
  treeMat.diffuseColor = Color3.White();
  treeMat.specularColor = Color3.Black();
  tree.material = treeMat;
  // feux tricolores
  const sigPole = MeshBuilder.CreateBox('sigPole', { width: 0.00018, height: 0.0042, depth: 0.00018 }, scene);
  sigPole.bakeTransformIntoVertices(Matrix.Translation(0, 0.0021, 0));
  sigPole.material = poleMat;
  const sigHead = MeshBuilder.CreateBox('sigHead', { width: 0.00035, height: 0.0009, depth: 0.00035 }, scene);
  sigHead.bakeTransformIntoVertices(Matrix.Translation(0, 0.0038, 0));
  const sigMat = new StandardMaterial('sigMat', scene);
  sigMat.disableLighting = true;
  sigMat.emissiveColor = Color3.Black();
  sigMat.diffuseColor = Color3.White();
  sigHead.material = sigMat;
  for (const m of [lampBody, head, tree, sigPole, sigHead]) { m.isPickable = false; m.alwaysSelectAsActiveMesh = true; }

  const lampBuf = new Float32Array(LAMPS * 16);
  const treeBuf = new Float32Array(TREES * 16);
  const treeCol = new Float32Array(TREES * 4);
  const SIGS = 1200;
  const sigBuf = new Float32Array(SIGS * 16);
  const sigCol = new Float32Array(SIGS * 4).fill(1);
  const sigInfo: { kx: number; kz: number; axis: number }[] = [];
  lampBody.thinInstanceSetBuffer('matrix', lampBuf, 16, false);
  head.thinInstanceSetBuffer('matrix', lampBuf, 16, false);
  tree.thinInstanceSetBuffer('matrix', treeBuf, 16, false);
  tree.thinInstanceSetBuffer('color', treeCol, 4, false);
  sigPole.thinInstanceSetBuffer('matrix', sigBuf, 16, false);
  sigHead.thinInstanceSetBuffer('matrix', sigBuf, 16, false);
  sigHead.thinInstanceSetBuffer('color', sigCol, 4, false);
  for (const m of [lampBody, head, tree, sigPole, sigHead]) setThinCount(m, 0);
  addShadowCaster(scene, tree);

  // ---- modèles de la bibliothèque (asynchrone ; chaque groupe garde son repli procédural) ----
  const L: LibFurniture = { lamps: null, trees: null, sig: null, abri: null };
  // lampe allumée des feux tricolores (une par feu, déplacée selon l'état : rouge en haut, vert en bas)
  let sigLamp: Mesh | null = null;
  const sigLampBuf = new Float32Array(SIGS * 16);
  const sigYaw = new Float32Array(SIGS);
  const sigPos = new Float32Array(SIGS * 3);
  let lastSigKey = '';
  whenModels((lib: ModelLibrary) => {
    if (scene.isDisposed) return;
    const mk = (id: string, cap: number, name: string, source?: 'lod' | 'noLights') => {
      const t = lib.get(id);
      if (!t) return null;
      return createThinInstances(t, cap, { dynamic: true, name, colors: id.startsWith('arbre'), noLights: source === 'noLights', source: source === 'lod' && t.lods[0] ? t.lods[0] : undefined });
    };
    const lr = mk('lampadaire', LAMPS, 'mobilier_lampadaires'), lc = mk('lampadaire_classique', Math.ceil(LAMPS / 2), 'mobilier_lampadaires_classiques');
    if (lr && lc) {
      L.lamps = [lr, lc];
      lampBody.dispose(); head.dispose();
    } else { lr?.dispose(); lc?.dispose(); }
    const trees = TREE_IDS.map((id, k) => {
      const near = mk(id, k === 0 ? Math.min(TREES, 5000) : Math.ceil(TREES / 4), 'mobilier_' + id);
      const far = mk(id, k === 0 ? TREES : Math.ceil(TREES / 2), 'mobilier_' + id + '_loin', 'lod');
      return near && far ? ([near, far] as [ThinInstanceBuffer, ThinInstanceBuffer]) : null;
    });
    if (trees.every((t) => t)) {
      L.trees = trees as [ThinInstanceBuffer, ThinInstanceBuffer][];
      for (const pair of L.trees) for (const b of pair) addShadowCaster(scene, b.body);
      tree.dispose();
    } else for (const t of trees) t?.forEach((b) => b.dispose());
    const sig = mk('feu_tricolore', SIGS, 'mobilier_feux_tricolores', 'noLights');
    if (sig) {
      // le modèle sert de support ; la lampe allumée est un petit carré émissif (couleur selon l'état)
      L.sig = sig;
      sigPole.dispose(); sigHead.dispose();
      sigLamp = MeshBuilder.CreateBox('mobilier_feux_lampes', { width: 0.00021, height: 0.00021, depth: 0.00004 }, scene);
      sigLamp.material = sigMat;
      sigLamp.isPickable = false;
      sigLamp.alwaysSelectAsActiveMesh = true;
      sigLamp.thinInstanceSetBuffer('matrix', sigLampBuf, 16, false);
      sigLamp.thinInstanceSetBuffer('color', sigCol, 4, false);
      setThinCount(sigLamp, 0);
    }
    L.abri = mk('abribus', [150, 400, 800][ql], 'mobilier_abribus');
    cx = 1e9; // régénération immédiate avec les nouveaux modèles
  });

  const write = (buf: Float32Array, k: number, x: number, y: number, z: number, ang: number, s: number) => {
    const c = Math.cos(ang) * s, sn = Math.sin(ang) * s, o = k * 16;
    buf[o] = c; buf[o + 1] = 0; buf[o + 2] = -sn; buf[o + 3] = 0;
    buf[o + 4] = 0; buf[o + 5] = s; buf[o + 6] = 0; buf[o + 7] = 0;
    buf[o + 8] = sn; buf[o + 9] = 0; buf[o + 10] = c; buf[o + 11] = 0;
    buf[o + 12] = x; buf[o + 13] = y; buf[o + 14] = z; buf[o + 15] = 1;
  };
  const hash = (a: number, b: number) => { const h = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return h - Math.floor(h); };

  const nearGrid = (x: number, z: number) => {
    const gx = Math.abs(x - Math.round(x / 0.2) * 0.2), gz = Math.abs(z - Math.round(z / 0.2) * 0.2);
    return gx < 0.009 || gz < 0.009;
  };
  const nearPlate = (x: number, z: number) => net.plates.some((q) => Math.abs(q.pts[0] - x) < 0.04 && Math.abs(q.pts[2] - z) < 0.04);
  // k : variante (lampadaires : 0 routier, 1 classique ; arbres : indice dans TREE_IDS)
  type Cand = { x: number; y: number; z: number; a: number; s: number; d: number; k?: number };
  let cx = 1e9, cz = 1e9, lastR = 0, lastAutumn = -1, wasHidden = false, camRadius = 1;
  const regen = (X: number, Z: number, R: number) => {
    const lamps: Cand[] = [], trees: Cand[] = [], abris: Cand[] = [];
    const libTrees = !!L.trees;
    const RPOP = Math.min(R, [0.9, 1.3, 1.8][ql]);
    const dist = (x: number, z: number) => Math.hypot(x - X, z - Z);
    const urban = (x: number, z: number) => urbanDensity(country, x, z);
    // (a) voies du réseau
    const tmp = { x: 0, y: 0, z: 0, tx: 0, tz: 0 };
    net.paths.forEach((p, pi) => {
      if (p.kind === 'rail' || p.kind === 'ramp') return;
      // test grossier de proximité
      let near = false;
      for (let i = 0; i < p.n; i += 8) if (dist(p.x[i], p.z[i]) < R + 0.5) { near = true; break; }
      if (!near) return;
      const isA = p.kind === 'autoroute';
      const step = TILE; // un lampadaire par flaque de lumière de l'atlas
      for (let s = TILE / 2, k = 0; s < p.len; s += step, k++) {
        const o = sampleAt(p, s, tmp);
        const d = dist(o.x, o.z);
        if (d > R) continue;
        const nx = -o.tz, nz = o.tx;
        const ang = Math.atan2(o.tx, o.tz);
        if (isA) {
          lamps.push({ x: o.x, y: o.y, z: o.z, a: ang, s: 1.25, d }, { x: o.x, y: o.y, z: o.z, a: ang + Math.PI, s: 1.25, d });
          continue;
        }
        const onBridge = net.bridges.some((b) => b.p === pi && s > b.s0 - 0.01 && s < b.s1 + 0.01);
        const u = onBridge ? 1 : urban(o.x, o.z);
        const elevated = o.y - surfaceY(grid, o.x, o.z) > 0.004;
        if (!onBridge && u < 0.18) {
          // routes de campagne : rangées de peupliers par tronçons (modèles de la bibliothèque seulement)
          if (libTrees && d < RPOP && o.y - surfaceY(grid, o.x, o.z) < 0.012 && hash(pi, Math.floor(s / 0.25)) > 0.45) {
            for (const f of [0, 0.34, 0.67]) {
              const o2 = sampleAt(p, s + f * step, tmp);
              for (const side of [1, -1]) {
                const tx = o2.x + nx * (p.half + 0.0055) * side, tz = o2.z + nz * (p.half + 0.0055) * side;
                if (grid.sample(tx, tz) < 0.027) continue;
                trees.push({ x: tx, y: surfaceY(grid, tx, tz), z: tz, a: hash(tx, tz) * 6.28, s: 0.85 + hash(tz, tx) * 0.3, d: d + 0.2, k: 3 });
              }
            }
          }
          continue;
        }
        // lampadaires en quinconce au bord des trottoirs (sur les ponts : des deux côtés, modèle classique)
        const sides = onBridge ? [1, -1] : [k % 2 ? 1 : -1];
        for (const side of sides) {
          const off = onBridge ? p.half - 0.0006 : 0.0081;
          lamps.push({ x: o.x + nx * off * side, y: o.y, z: o.z + nz * off * side, a: side > 0 ? ang : ang + Math.PI, s: onBridge ? 0.7 : 1, d, k: onBridge ? 1 : 0 });
        }
        // abribus sur les avenues denses (un tous les ~320 m, côté alterné), face à la chaussée
        if (L.abri && !onBridge && !elevated && k % 9 === 4 && u > 0.35) {
          const side = (Math.floor(s / 0.3) % 2) ? 1 : -1;
          const o3 = sampleAt(p, s + step * 0.25, tmp);
          if (!nearGrid(o3.x, o3.z) && !nearPlate(o3.x, o3.z)) {
            const n3x = -o3.tz, n3z = o3.tx;
            abris.push({ x: o3.x + n3x * 0.0103 * side, y: o3.y, z: o3.z + n3z * 0.0103 * side, a: Math.atan2(-n3x * side, -n3z * side), s: 1, d });
          }
          sampleAt(p, s, tmp); // (o pointe sur tmp)
        }
        // arbres du terre-plein central
        if (!elevated && !onBridge) for (const f of [0, 0.5]) {
          const o2 = sampleAt(p, s + f * step, tmp);
          if (nearGrid(o2.x, o2.z) || nearPlate(o2.x, o2.z)) continue;
          trees.push({ x: o2.x, y: o2.y, z: o2.z, a: hash(o2.x, o2.z) * 6.28, s: 0.85 + hash(o2.z, o2.x) * 0.35, d });
          // et le long des trottoirs
          for (const side of [1, -1]) trees.push({ x: o2.x + nx * 0.0098 * side, y: o2.y, z: o2.z + nz * 0.0098 * side, a: hash(o2.z, s) * 6.28, s: 0.8 + hash(s, o2.x) * 0.4, d: d + 0.001 });
        }
      }
    });
    // (b) grille des rues : lampadaires au bord des trottoirs, arbres sur les boulevards
    const k0x = Math.ceil((X - R) / 0.2), k1x = Math.floor((X + R) / 0.2);
    const k0z = Math.ceil((Z - R) / 0.2), k1z = Math.floor((Z + R) / 0.2);
    for (const axis of [0, 1]) {
      const [ka, kb] = axis ? [k0z, k1z] : [k0x, k1x];
      for (let k = ka; k <= kb; k++) {
        const line = k * 0.2;
        const boul = k % 5 === 0;
        const C = boul ? 0.0102 : 0.0046, S = boul ? 0.016 : 0.0075;
        const cen = axis ? X : Z; // l'autre coordonnée
        const half = Math.sqrt(Math.max(0, R * R - (line - (axis ? Z : X)) ** 2));
        const spacing = boul ? 0.03 : 0.034;
        for (let t = Math.ceil((cen - half) / spacing) * spacing, idx = 0; t <= cen + half; t += spacing, idx++) {
          // distance au carrefour le plus proche
          const kc = Math.round(t / 0.2), cross = Math.abs(t - kc * 0.2);
          const Sc = kc % 5 === 0 ? 0.016 : 0.0075;
          if (cross < Sc + 0.003) continue;
          const side = (Math.round(t / spacing) % 2) ? 1 : -1;
          const off = (C + 0.0007) * side;
          const x = axis ? t : line + off, z = axis ? line + off : t;
          if (urban(x, z) < 0.3 || occAt(net, x, z) & 1 || grid.sample(x, z) < 0.027) continue;
          const y = surfaceY(grid, x, z);
          const ang = axis ? (side > 0 ? Math.PI : 0) : (side > 0 ? Math.PI / 2 : -Math.PI / 2);
          lamps.push({ x, y, z, a: ang, s: 1, d: dist(x, z) + 0.2 });
        }
        if (!boul) continue;
        for (let t = Math.ceil((cen - half) / 0.011) * 0.011; t <= cen + half; t += 0.011) {
          const kc = Math.round(t / 0.2), cross = Math.abs(t - kc * 0.2);
          const Sc = kc % 5 === 0 ? 0.016 : 0.0075;
          if (cross < Sc + 0.004) continue;
          for (const side of [1, -1]) {
            const off = 0.0132 * side;
            const x = axis ? t : line + off, z = axis ? line + off : t;
            if (urban(x, z) < 0.3 || occAt(net, x, z) & 1 || grid.sample(x, z) < 0.027) continue;
            trees.push({ x, y: surfaceY(grid, x, z), z, a: hash(x, z) * 6.28, s: 0.85 + hash(z, x) * 0.35, d: dist(x, z) + 0.1 });
          }
        }
      }
    }
    // (c) quais plantés et éclairés
    for (const r of net.rivers) {
      const n = r.x.length;
      for (let i = 0; i < n - 1; i++) {
        if (!r.ok[i] || dist(r.x[i], r.z[i]) > R + 0.15) continue;
        const yq = r.w[i] + 0.006;
        for (let f = 0; f < 1; f += 0.125) {
          const bx = r.x[i] + (r.x[i + 1] - r.x[i]) * f, bz = r.z[i] + (r.z[i + 1] - r.z[i]) * f;
          const nx = r.nx[i], nz = r.nz[i];
          const ang = Math.atan2(r.x[i + 1] - r.x[i], r.z[i + 1] - r.z[i]);
          for (const side of [1, -1]) {
            const lx = bx + nx * (QUAY_HALF + 0.003) * side, lz = bz + nz * (QUAY_HALF + 0.003) * side;
            const d = dist(lx, lz);
            if (d > R) continue;
            if (urban(lx, lz) < 0.15) {
              // berges de campagne : rideaux de peupliers (bibliothèque seulement)
              if (libTrees && d < RPOP && hash(i, side) > 0.3) {
                const tx = bx + nx * 0.212 * side, tz = bz + nz * 0.212 * side;
                if (grid.sample(tx, tz) >= 0.027) trees.push({ x: tx, y: surfaceY(grid, tx, tz), z: tz, a: hash(tx, tz) * 6.28, s: 0.85 + hash(tz, tx) * 0.3, d: d + 0.2, k: 3 });
              }
              continue;
            }
            if (f === 0 || f === 0.5) lamps.push({ x: lx, y: yq, z: lz, a: side > 0 ? ang : ang + Math.PI, s: 0.75, d: d - 0.3, k: 1 });
            for (const dd of [0.012, 0.024, 0.045]) {
              const tx = bx + nx * (0.2 + dd) * side + (hash(bx, dd) - 0.5) * 0.004, tz = bz + nz * (0.2 + dd) * side + (hash(bz, dd) - 0.5) * 0.004;
              if (dd > 0.03 && hash(tx, tz) < 0.5) continue;
              if (occAt(net, tx, tz) & 1 && dd > 0.03) continue;
              // platanes en bord de quai, arbres de parc sur la terrasse arrière
              trees.push({ x: tx, y: Math.max(yq, surfaceY(grid, tx, tz) + 0.0012), z: tz, a: hash(tx, tz) * 6.28, s: 1.0 + hash(tz, tx) * 0.45, d: d - 0.3, k: dd > 0.03 ? 1 : 0 });
            }
          }
        }
      }
    }
    // (d) îlots des giratoires
    for (const rb of net.roundabouts) {
      if (dist(rb.x, rb.z) > R) continue;
      const Ri = rb.r - 0.012;
      for (let a = 0; a < 6.28; a += 0.0075 / Math.max(0.01, Ri)) trees.push({ x: rb.x + Math.cos(a) * Ri, y: rb.y, z: rb.z + Math.sin(a) * Ri, a, s: 1.1, d: 0, k: 1 });
    }
    // (e) parcs urbains : grands arbres de parc (bibliothèque seulement ; les forêts y mettent déjà des conifères)
    if (libTrees) {
      const RP = Math.min(R, [0.8, 1.2, 1.7][ql]), st = 0.02;
      for (let gx = Math.floor((X - RP) / st) * st; gx <= X + RP; gx += st) {
        for (let gz = Math.floor((Z - RP) / st) * st; gz <= Z + RP; gz += st) {
          const h1 = hash(gx, gz), h2 = hash(gz, gx);
          const x = gx + (h1 - 0.5) * st * 0.9, z = gz + (h2 - 0.5) * st * 0.9;
          const d = dist(x, z);
          // même seuil que cities.ts (pas de bâtiment au-delà de 0,5)
          if (d > RP || parkMask(country.seed, x, z) < 0.5 || urban(x, z) < 0.1) continue;
          if (nearGrid(x, z) || occAt(net, x, z) & 1 || grid.sample(x, z) < 0.027) continue;
          trees.push({ x, y: surfaceY(grid, x, z), z, a: h1 * 6.28, s: 0.8 + h2 * 0.45, d: d + 0.05, k: h1 < 0.4 ? 2 : 1 });
        }
      }
    }
    const fill = (list: Cand[], cap: number, buf: Float32Array, after?: (k: number, c: Cand) => void) => {
      if (list.length > cap) list.sort((a, b) => a.d - b.d);
      const n = Math.min(cap, list.length);
      for (let k = 0; k < n; k++) { const c = list[k]; write(buf, k, c.x, c.y, c.z, c.a, c.s); after?.(k, c); }
      return n;
    };
    if (L.lamps) {
      if (lamps.length > LAMPS) lamps.sort((a, b) => a.d - b.d);
      const [lr, lc] = L.lamps;
      let nr = 0, nc = 0;
      for (let q = 0; q < Math.min(LAMPS, lamps.length); q++) {
        const c = lamps[q];
        // crosse du modèle selon +Z (procédural : +X) ; le lampadaire classique est plus bas (3,9 m)
        if (c.k === 1) { if (nc < lc.capacity) lc.set(nc++, c.x, c.y, c.z, c.a + Math.PI / 2, 1); }
        else if (nr < lr.capacity) lr.set(nr++, c.x, c.y, c.z, c.a + Math.PI / 2, c.s > 1.1 ? 1.25 : 1);
      }
      lr.count = nr; lc.count = nc; lr.commit(); lc.commit();
    } else {
      const nl = fill(lamps, LAMPS, lampBuf);
      setThinCount(lampBody, nl); setThinCount(head, nl);
      lampBody.thinInstanceBufferUpdated('matrix'); head.thinInstanceBufferUpdated('matrix');
    }
    if (L.trees) {
      if (trees.length > TREES) trees.sort((a, b) => a.d - b.d);
      const lod = 0.3 + camRadius * 0.12; // au-delà : niveau de détail lointain
      const cnt = L.trees.map(() => [0, 0]);
      for (let q = 0; q < Math.min(TREES, trees.length); q++) {
        const c = trees[q];
        const sp = c.k ?? 0, far = c.d > lod ? 1 : 0;
        const b = L.trees[sp][far];
        const i = cnt[sp][far];
        if (i >= b.capacity) continue;
        cnt[sp][far]++;
        b.set(i, c.x, c.y, c.z, c.a, c.s * TREE_SCALE[sp]);
        // teinte saisonnière (multipliée par les couleurs du modèle)
        const hv = hash(c.x * 3.1, c.z * 1.7);
        const aut = ENV.autumn * (sp === 3 ? 0.9 : hv > 0.3 ? 0.85 : 0.25);
        let r = 0.92 + hv * 0.16 + aut * 0.45, g = 0.95 + hv * 0.1 - aut * 0.2, bl = 0.95 - aut * 0.55;
        const w = ENV.winter * 0.55;
        r += (0.85 - r) * w; g += (0.78 - g) * w; bl += (0.72 - bl) * w;
        b.setColor(i, r, g, bl);
      }
      L.trees.forEach((pair, sp) => pair.forEach((b, f) => { b.count = cnt[sp][f]; b.commit(); }));
    } else {
      const nt = fill(trees, TREES, treeBuf, (k, c) => {
        const hv = hash(c.x * 3.1, c.z * 1.7);
        const green = new Color3(0.2 + hv * 0.08, 0.36 + hv * 0.1, 0.14 + hv * 0.04);
        const aut = new Color3(0.62 + hv * 0.2, 0.36 + hv * 0.12, 0.1);
        const col = Color3.Lerp(green, aut, ENV.autumn * (hv > 0.3 ? 0.85 : 0.2));
        const w = Color3.Lerp(col, new Color3(0.42, 0.38, 0.33), ENV.winter * 0.6);
        treeCol.set([w.r, w.g, w.b, 1], k * 4);
      });
      setThinCount(tree, nt);
      tree.thinInstanceBufferUpdated('matrix'); tree.thinInstanceBufferUpdated('color');
    }
    if (L.abri) {
      const ab = L.abri;
      if (abris.length > ab.capacity) abris.sort((a, b) => a.d - b.d);
      ab.count = 0;
      for (let q = 0; q < Math.min(ab.capacity, abris.length); q++) { const c = abris[q]; ab.set(q, c.x, c.y, c.z, c.a, 1); }
      ab.commit();
    }
    // feux tricolores aux carrefours des boulevards proches
    sigInfo.length = 0;
    const RS = Math.min(R, 1.2);
    for (let kx = Math.ceil((X - RS) / 0.2); kx <= Math.floor((X + RS) / 0.2); kx++) {
      for (let kz = Math.ceil((Z - RS) / 0.2); kz <= Math.floor((Z + RS) / 0.2); kz++) {
        if (!hasSignal(kx, kz) || sigInfo.length >= SIGS - 4) continue;
        const x0 = kx * 0.2, z0 = kz * 0.2;
        if (urbanDensity(country, x0, z0) < 0.3 || occAt(net, x0, z0) & 1 || grid.sample(x0, z0) < 0.027) continue;
        const Cx = (kx % 5 === 0 ? 0.0102 : 0.0046) + 0.0009, Cz = (kz % 5 === 0 ? 0.0102 : 0.0046) + 0.0009;
        for (const [sx, sz, axis] of [[1, 1, 1], [-1, 1, 0], [-1, -1, 1], [1, -1, 0]]) {
          const x = x0 + sx * Cx, z = z0 + sz * Cz, y = surfaceY(grid, x, z);
          const n = sigInfo.length;
          if (L.sig) {
            // lampes face aux véhicules qui arrivent dans l'axe contrôlé
            const yaw = axis ? Math.atan2(0, sz) : Math.atan2(sx, 0);
            L.sig.set(n, x, y, z, yaw, 1);
            sigYaw[n] = yaw; sigPos[n * 3] = x; sigPos[n * 3 + 1] = y; sigPos[n * 3 + 2] = z;
          } else write(sigBuf, n, x, y, z, 0, 1);
          sigInfo.push({ kx, kz, axis });
        }
      }
    }
    if (L.sig) {
      L.sig.count = sigInfo.length; L.sig.commit();
      lastSigKey = '';
    } else {
      setThinCount(sigPole, sigInfo.length); setThinCount(sigHead, sigInfo.length);
      sigPole.thinInstanceBufferUpdated('matrix'); sigHead.thinInstanceBufferUpdated('matrix');
    }
    void rnd;
  };

  return {
    update() {
      const cam = scene.activeCamera as ArcRotateCamera | null;
      if (!cam) return;
      const t = cam.target ?? cam.position;
      const radius = cam.radius ?? 10;
      const R = Math.min(RADIUS, Math.max(0.8, radius * 0.9));
      const hidden = radius > 14;
      camRadius = radius;
      for (const m of [lampBody, tree, sigPole, sigHead]) if (!m.isDisposed()) m.setEnabled(!hidden);
      if (!head.isDisposed()) head.setEnabled(!hidden || ENV.night > 0.3);
      if (hidden !== wasHidden) {
        // modèles de la bibliothèque : on vide les tampons (les feux de nuit suivent le niveau d'éclairage global)
        wasHidden = hidden;
        if (hidden) {
          const all = [...(L.lamps ?? []), ...(L.trees ?? []).flat(), ...(L.sig ? [L.sig] : []), ...(L.abri ? [L.abri] : [])];
          for (const b of all) { b.count = 0; b.commit(); }
          if (sigLamp) setThinCount(sigLamp, 0);
        } else cx = 1e9;
      }
      if (!hidden && (Math.hypot(t.x - cx, t.z - cz) > R * 0.3 || Math.abs(R - lastR) > lastR * 0.35 || Math.abs(ENV.autumn + ENV.winter - lastAutumn) > 0.08)) {
        cx = t.x; cz = t.z; lastR = R; lastAutumn = ENV.autumn + ENV.winter;
        regen(cx, cz, R);
      }
      const n = ENV.night;
      headMat.emissiveColor.set(1.0 * n, 0.78 * n, 0.5 * n);
      // couleurs des feux (et position de la lampe allumée sur le modèle de la bibliothèque)
      if (!hidden && sigInfo.length) {
        let key = '';
        for (let k = 0; k < sigInfo.length; k++) {
          const s = signalState(sigInfo[k].kx, sigInfo[k].kz, sigInfo[k].axis);
          key += s;
          if (s === 0) sigCol.set([0.1, 1, 0.35, 1], k * 4);
          else if (s === 1) sigCol.set([1, 0.65, 0.05, 1], k * 4);
          else sigCol.set([1, 0.08, 0.05, 1], k * 4);
          if (sigLamp) {
            const yaw = sigYaw[k], dy = s === 2 ? 0.00028 : s === 1 ? 0 : -0.00028;
            write(sigLampBuf, k, sigPos[k * 3] + Math.sin(yaw) * 0.000222, sigPos[k * 3 + 1] + 0.00275 + dy, sigPos[k * 3 + 2] + Math.cos(yaw) * 0.000222, yaw, 1);
          }
        }
        if (sigLamp) {
          if (key !== lastSigKey) {
            lastSigKey = key;
            setThinCount(sigLamp, sigInfo.length);
            sigLamp.thinInstanceBufferUpdated('matrix'); sigLamp.thinInstanceBufferUpdated('color');
          }
        } else sigHead.thinInstanceBufferUpdated('color');
      }
    },
  };
}
