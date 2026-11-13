/**
 * Générateur d'assets d'ENVIRONNEMENT (propriétaire : agent terrain / environnement).
 *
 * 1. Essences d'arbres générées procéduralement par nos outils (CC0, aucune source externe) :
 *    - « Épicéa » (conifère de montagne et de forêt) : tronc effilé, verticilles de rameaux en cartes
 *      croisées tombantes, texture d'aiguilles dessinée par programme ;
 *    - « Peuplier d'Italie » (arbre d'alignement, silhouette colonnaire) : tronc, charpentières,
 *      bouquets de feuilles en cartes à normales sphériques ;
 *    textures (écorce albedo + normale, feuillage avec alpha) rastérisées ici puis encodées en WebP (sharp).
 * 2. Décors naturels Poly Haven (CC0) traités par le pipeline du technical artist (tools/assets/models.ts) :
 *    rochers, buisson, fleurs, touffe d'herbe — copiés dans assets/models/nature/ (hors du dossier
 *    nettoyé par l'étape Poly Haven), avec un cache de construction propre (.cache/nature/).
 *
 * Utilisation : enregistré dans tools/generators/index.ts (demande à l'agent assets), ou en autonome :
 *   npx tsx tools/generators/environment.ts   (écrit les GLB + .cache/nature/catalog-fragment.json)
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Document, NodeIO, type Material, type Texture } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import sharp from 'sharp';
import type { CatalogAsset } from '../../src/shared/catalog';
import type { Generator, GeneratorOutput } from './index';
import type { ModelSpec } from '../assets/selection';

const root = join(import.meta.dirname, '..', '..');
const CACHE = join(root, '.cache', 'nature');
const GEN_VERSION = 4;

/* ------------------------------------------------------------------ */
/* Aléatoire déterministe                                               */
/* ------------------------------------------------------------------ */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ */
/* Rastérisation de textures                                            */
/* ------------------------------------------------------------------ */
class Raster {
  readonly px: Float32Array;
  constructor(readonly w: number, readonly h: number) { this.px = new Float32Array(w * h * 4); }
  /** Disque plein (coordonnées en pixels), couleur sRGB 0..1, alpha. */
  disc(x: number, y: number, r: number, c: [number, number, number], a = 1): void {
    const x0 = Math.max(0, Math.floor(x - r - 1));
    const x1 = Math.min(this.w - 1, Math.ceil(x + r + 1));
    const y0 = Math.max(0, Math.floor(y - r - 1));
    const y1 = Math.min(this.h - 1, Math.ceil(y + r + 1));
    for (let j = y0; j <= y1; j++) {
      for (let i = x0; i <= x1; i++) {
        const d = Math.hypot(i + 0.5 - x, j + 0.5 - y);
        const cov = Math.max(0, Math.min(1, r + 0.5 - d)) * a;
        if (cov <= 0) continue;
        const o = (j * this.w + i) * 4;
        for (let k = 0; k < 3; k++) this.px[o + k] = this.px[o + k]! * (1 - cov) + c[k]! * cov;
        this.px[o + 3] = Math.max(this.px[o + 3]!, cov);
      }
    }
  }
  line(x0: number, y0: number, x1: number, y1: number, r0: number, r1: number, c: [number, number, number], c1?: [number, number, number]): void {
    const n = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 0.6));
    for (let s = 0; s <= n; s++) {
      const t = s / n;
      const col: [number, number, number] = c1 ? [c[0] + (c1[0] - c[0]) * t, c[1] + (c1[1] - c[1]) * t, c[2] + (c1[2] - c[2]) * t] : c;
      this.disc(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r0 + (r1 - r0) * t, col);
    }
  }
  /** Ellipse orientée (feuille). */
  leaf(x: number, y: number, len: number, wid: number, ang: number, c: [number, number, number]): void {
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const R = len;
    for (let j = Math.max(0, Math.floor(y - R)); j <= Math.min(this.h - 1, Math.ceil(y + R)); j++) {
      for (let i = Math.max(0, Math.floor(x - R)); i <= Math.min(this.w - 1, Math.ceil(x + R)); i++) {
        const dx = i + 0.5 - x;
        const dy = j + 0.5 - y;
        const u = (dx * ca + dy * sa) / len;
        const v = (-dx * sa + dy * ca) / wid;
        // Forme de feuille : pointue aux deux bouts.
        const e = u * u + v * v * (1 + 1.5 * u * u);
        if (e > 1) continue;
        const cov = Math.min(1, (1 - e) * 6);
        const o = (j * this.w + i) * 4;
        const shade = 0.82 + 0.25 * (1 - Math.abs(v)) - 0.1 * u; // nervure et volume
        for (let k = 0; k < 3; k++) this.px[o + k] = this.px[o + k]! * (1 - cov) + c[k]! * shade * cov;
        this.px[o + 3] = Math.max(this.px[o + 3]!, cov);
      }
    }
  }
  async webp(size?: number, alpha = true): Promise<Uint8Array> {
    const buf = Buffer.alloc(this.w * this.h * 4);
    for (let k = 0; k < this.w * this.h; k++) {
      const a = this.px[k * 4 + 3]!;
      for (let c = 0; c < 3; c++) buf[k * 4 + c] = Math.round(Math.max(0, Math.min(1, this.px[k * 4 + c]!)) * 255);
      buf[k * 4 + 3] = alpha ? Math.round(Math.max(0, Math.min(1, a)) * 255) : 255;
    }
    let img = sharp(buf, { raw: { width: this.w, height: this.h, channels: 4 } });
    if (size && size !== this.w) img = img.resize(size, Math.round((size * this.h) / this.w));
    return new Uint8Array(await img.webp({ quality: 88, alphaQuality: 95, effort: 5 }).toBuffer());
  }
}

/** Bruit de valeur tuilable 2D (période en cellules). */
function tileNoise(x: number, y: number, period: number, seed: number): number {
  const h = (a: number, b: number): number => {
    let v = Math.imul(((a % period) + period) % period, 374761393) + Math.imul(((b % period) + period) % period, 668265263) + seed * 97;
    v = Math.imul(v ^ (v >>> 13), 1274126177);
    return ((v ^ (v >>> 16)) >>> 0) / 4294967296;
  };
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  return (h(ix, iy) * (1 - ux) + h(ix + 1, iy) * ux) * (1 - uy) + (h(ix, iy + 1) * (1 - ux) + h(ix + 1, iy + 1) * ux) * uy;
}

/** Écorce : albedo + normale (tuilables), sillons verticaux et lenticelles. */
async function barkTextures(kind: 'epicea' | 'peuplier', size: number): Promise<{ albedo: Uint8Array; normal: Uint8Array }> {
  const W = size;
  const H = size * 2;
  const hgt = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = (x / W) * 8;
      const v = (y / H) * 4;
      let h = 0;
      if (kind === 'epicea') {
        // Plaques écailleuses.
        h = tileNoise(u * 2, v * 3, 16, 1) * 0.5 + tileNoise(u * 4, v * 8, 32, 2) * 0.3 + Math.pow(tileNoise(u * 1.5, v * 0.6, 12, 3), 3) * 0.6;
      } else {
        // Écorce lisse grise et fissures sombres en losanges.
        const crack = Math.abs(tileNoise(u * 1.2, v * 0.5, 10, 4) - 0.5) < 0.04 ? -0.6 : 0;
        h = 0.5 + tileNoise(u * 3, v * 2, 24, 5) * 0.2 + crack;
      }
      hgt[y * W + x] = h;
    }
  }
  const alb = new Raster(W, H);
  const nor = new Raster(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const h = hgt[y * W + x]!;
      const o = (y * W + x) * 4;
      const n1 = tileNoise((x / W) * 40, (y / H) * 40, 40, 9);
      if (kind === 'epicea') {
        alb.px[o] = 0.26 + h * 0.18 + n1 * 0.05; alb.px[o + 1] = 0.17 + h * 0.11 + n1 * 0.03; alb.px[o + 2] = 0.11 + h * 0.07;
      } else {
        const lent = Math.pow(tileNoise((x / W) * 30, (y / H) * 6, 30, 11), 6) > 0.3 ? 0.55 : 1;
        alb.px[o] = (0.42 + h * 0.2 + n1 * 0.05) * lent; alb.px[o + 1] = (0.41 + h * 0.19 + n1 * 0.05) * lent; alb.px[o + 2] = (0.37 + h * 0.16) * lent;
      }
      alb.px[o + 3] = 1;
      const hl = hgt[y * W + ((x + W - 1) % W)]!;
      const hr = hgt[y * W + ((x + 1) % W)]!;
      const hd = hgt[((y + H - 1) % H) * W + x]!;
      const hu = hgt[((y + 1) % H) * W + x]!;
      const k = 3.5;
      const nx = (hl - hr) * k;
      const ny = (hd - hu) * k;
      const l = Math.hypot(nx, ny, 1);
      nor.px[o] = nx / l * 0.5 + 0.5; nor.px[o + 1] = ny / l * 0.5 + 0.5; nor.px[o + 2] = 1 / l * 0.5 + 0.5; nor.px[o + 3] = 1;
    }
  }
  return { albedo: await alb.webp(undefined, false), normal: await nor.webp(undefined, false) };
}

/** Rameau d'épicéa vu de dessus : axe de u=0 (base) à u=1 (pointe), aiguilles denses. */
async function needleTexture(size: number, seed: number): Promise<Uint8Array> {
  const S = 512;
  const r = new Raster(S, S);
  const rnd = rng(seed);
  const dark: [number, number, number] = [0.07, 0.17, 0.07];
  const mid: [number, number, number] = [0.12, 0.26, 0.1];
  const tip: [number, number, number] = [0.24, 0.38, 0.14];
  const twig = (x0: number, y0: number, x1: number, y1: number, depth: number, w: number): void => {
    // Masse d'aiguilles sous-jacente (couverture opaque, indispensable une fois la texture réduite).
    const lenM = Math.hypot(x1 - x0, y1 - y0);
    r.line(x0, y0, x1, y1, depth ? 7 : 12, depth ? 3 : 5, [0.06, 0.15, 0.06], [0.1, 0.22, 0.08]);
    void lenM;
    r.line(x0, y0, x1, y1, w, w * 0.4, [0.22, 0.15, 0.09]);
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.floor(len / 2.2);
    const ux = (x1 - x0) / len;
    const uy = (y1 - y0) / len;
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const px = x0 + (x1 - x0) * t;
      const py = y0 + (y1 - y0) * t;
      for (const side of [-1, 1]) {
        const ang = Math.atan2(uy, ux) + side * (0.7 + rnd() * 0.5);
        const nl = (13 + rnd() * 7) * (1 - t * 0.4) * (depth ? 0.85 : 1);
        const c = t > 0.8 ? tip : rnd() < 0.5 ? dark : mid;
        r.line(px, py, px + Math.cos(ang) * nl, py + Math.sin(ang) * nl, 1.6, 0.7, c, t > 0.6 ? tip : mid);
      }
    }
    if (depth === 0) {
      for (let k = 1; k < 7; k++) {
        const t = 0.12 + k * 0.12;
        const px = x0 + (x1 - x0) * t;
        const py = y0 + (y1 - y0) * t;
        for (const side of [-1, 1]) {
          const ang = Math.atan2(uy, ux) + side * (0.75 + rnd() * 0.25);
          const l = (S * 0.36) * (1 - t * 0.7);
          twig(px, py, px + Math.cos(ang) * l, py + Math.sin(ang) * l, 1, w * 0.55);
        }
      }
    }
  };
  twig(S * 0.02, S * 0.5, S * 0.98, S * 0.5, 0, 3.2);
  return r.webp(size);
}

/** Bouquet de feuilles (peuplier) : rameaux et feuilles losangiques, couleur variée. */
async function leafTexture(size: number, seed: number): Promise<Uint8Array> {
  const S = 512;
  const r = new Raster(S, S);
  const rnd = rng(seed);
  const greens: [number, number, number][] = [[0.16, 0.3, 0.08], [0.22, 0.38, 0.1], [0.12, 0.25, 0.07], [0.28, 0.42, 0.13]];
  // Rameaux.
  const twigs: [number, number, number, number][] = [];
  for (let k = 0; k < 7; k++) {
    const a = -Math.PI / 2 + (rnd() - 0.5) * 1.6;
    const x0 = S / 2 + (rnd() - 0.5) * 60;
    const y0 = S * 0.95;
    const l = S * (0.55 + rnd() * 0.3);
    twigs.push([x0, y0, x0 + Math.cos(a) * l, y0 + Math.sin(a) * l]);
    r.line(x0, y0, x0 + Math.cos(a) * l, y0 + Math.sin(a) * l, 2.2, 0.8, [0.2, 0.15, 0.1]);
  }
  for (let k = 0; k < 230; k++) {
    const tw = twigs[Math.floor(rnd() * twigs.length)]!;
    const t = 0.2 + rnd() * 0.8;
    const x = tw[0] + (tw[2] - tw[0]) * t + (rnd() - 0.5) * 30;
    const y = tw[1] + (tw[3] - tw[1]) * t + (rnd() - 0.5) * 30;
    const len = 15 + rnd() * 10;
    r.leaf(x, y, len, len * 0.62, rnd() * Math.PI * 2, greens[Math.floor(rnd() * greens.length)]!);
  }
  return r.webp(size);
}

/* ------------------------------------------------------------------ */
/* Géométrie                                                           */
/* ------------------------------------------------------------------ */
class MeshBuilder {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  idx: number[] = [];
  vert(p: [number, number, number], n: [number, number, number], uv: [number, number]): number {
    this.pos.push(...p);
    const l = Math.hypot(...n) || 1;
    this.nor.push(n[0] / l, n[1] / l, n[2] / l);
    this.uv.push(...uv);
    return this.pos.length / 3 - 1;
  }
  tri(a: number, b: number, c: number): void { this.idx.push(a, b, c); }
  get triangles(): number { return this.idx.length / 3; }
}

/** Cylindre effilé (tronc / branche) de p0 à p1. */
function taperedCylinder(m: MeshBuilder, p0: [number, number, number], p1: [number, number, number], r0: number, r1: number, seg: number, rings: number, vRepeat: number): void {
  const d = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]] as [number, number, number];
  const len = Math.hypot(...d);
  const ax = d.map((v) => v / len) as [number, number, number];
  const ref: [number, number, number] = Math.abs(ax[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u: [number, number, number] = [ax[1] * ref[2] - ax[2] * ref[1], ax[2] * ref[0] - ax[0] * ref[2], ax[0] * ref[1] - ax[1] * ref[0]];
  const ul = Math.hypot(...u);
  u[0] /= ul; u[1] /= ul; u[2] /= ul;
  const w: [number, number, number] = [ax[1] * u[2] - ax[2] * u[1], ax[2] * u[0] - ax[0] * u[2], ax[0] * u[1] - ax[1] * u[0]];
  const base = m.pos.length / 3;
  for (let r = 0; r <= rings; r++) {
    const t = r / rings;
    const rad = r0 + (r1 - r0) * t;
    const c = [p0[0] + d[0] * t, p0[1] + d[1] * t, p0[2] + d[2] * t];
    for (let s = 0; s <= seg; s++) {
      const a = (s / seg) * Math.PI * 2;
      const n: [number, number, number] = [u[0] * Math.cos(a) + w[0] * Math.sin(a), u[1] * Math.cos(a) + w[1] * Math.sin(a), u[2] * Math.cos(a) + w[2] * Math.sin(a)];
      m.vert([c[0]! + n[0] * rad, c[1]! + n[1] * rad, c[2]! + n[2] * rad], n, [s / seg, t * vRepeat]);
    }
  }
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < seg; s++) {
      const a = base + r * (seg + 1) + s;
      const b = a + seg + 1;
      m.tri(a, b, a + 1);
      m.tri(a + 1, b, b + 1);
    }
  }
}

/** Carte de feuillage arquée : de `o` vers `dir` (longueur L, largeur W), tombante. Normales « sphériques ». */
function foliageCard(m: MeshBuilder, o: [number, number, number], dirAng: number, L: number, W: number, droop: number, roll: number, crownC: [number, number, number], segs = 2): void {
  const dx = Math.cos(dirAng);
  const dz = Math.sin(dirAng);
  // Axe latéral (tourné de `roll` autour de l'axe du rameau).
  const sx = -dz * Math.cos(roll);
  const sy = Math.sin(roll);
  const sz = dx * Math.cos(roll);
  const rows: number[][] = [];
  for (let s = 0; s <= segs; s++) {
    const t = s / segs;
    const cx = o[0] + dx * L * t;
    const cy = o[1] - droop * L * t * t + Math.sin(t * Math.PI) * L * 0.06;
    const cz = o[2] + dz * L * t;
    const row: number[] = [];
    for (const side of [-1, 1]) {
      const p: [number, number, number] = [cx + sx * side * W / 2 * (1 - 0.35 * t), cy + sy * side * W / 2, cz + sz * side * W / 2 * (1 - 0.35 * t)];
      // Normale orientée vers l'extérieur de la couronne (éclairage doux et volumique).
      const n: [number, number, number] = [p[0] - crownC[0], (p[1] - crownC[1]) * 0.6 + 0.6, p[2] - crownC[2]];
      row.push(m.vert(p, n, [t, side < 0 ? 0 : 1]));
    }
    rows.push(row);
  }
  for (let s = 0; s < segs; s++) {
    const a = rows[s]!;
    const b = rows[s + 1]!;
    m.tri(a[0]!, b[0]!, a[1]!);
    m.tri(a[1]!, b[0]!, b[1]!);
  }
}

interface TreeGeo { trunk: MeshBuilder; foliage: MeshBuilder; height: number }

function spruce(lod: number, seed: number): TreeGeo {
  const rnd = rng(seed);
  const H = 22;
  const trunk = new MeshBuilder();
  const fol = new MeshBuilder();
  taperedCylinder(trunk, [0, -0.3, 0], [0, H, 0], 0.32, 0.03, lod === 0 ? 12 : lod === 1 ? 8 : 5, lod === 0 ? 6 : 3, 6);
  const y0 = 2.2;
  const tiers = lod === 0 ? 26 : lod === 1 ? 15 : 8;
  const perTier = lod === 0 ? 9 : lod === 1 ? 7 : 6;
  for (let t = 0; t < tiers; t++) {
    const f = t / (tiers - 1);
    const y = y0 + (H - 0.6 - y0) * Math.pow(f, 0.92);
    const crownR = 3.6 * Math.pow(1 - f, 0.85) + 0.35;
    const n = Math.max(4, Math.round(perTier * (0.55 + 0.45 * (1 - f))));
    const off = rnd() * Math.PI * 2;
    for (let k = 0; k < n; k++) {
      const a = off + (k / n) * Math.PI * 2 + (rnd() - 0.5) * 0.4;
      const L = crownR * (0.85 + rnd() * 0.3);
      const Wd = Math.max(0.8, L * 0.75);
      const droop = 0.18 + 0.25 * (1 - f) * rnd();
      foliageCard(fol, [Math.cos(a) * 0.15, y, Math.sin(a) * 0.15], a, L, Wd, droop, 0.12, [0, y + 0.8, 0], lod === 2 ? 1 : 2);
      if (lod < 2) foliageCard(fol, [Math.cos(a) * 0.15, y + 0.1, Math.sin(a) * 0.15], a, L * 0.92, Wd * 0.7, droop, Math.PI / 2 - 0.3, [0, y + 0.8, 0], 2);
    }
  }
  // Flèche sommitale.
  foliageCard(fol, [0, H - 1.6, 0], 0, 0.01, 0.7, 0, 0, [0, H - 2, 0], 1);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2;
    foliageCard(fol, [0, H - 1.8, 0], a, 1.1, 0.8, -0.9, 0.2, [0, H - 2.5, 0], 1);
  }
  return { trunk, foliage: fol, height: H };
}

export function poplar(lod: number, seed: number): TreeGeo {
  const rnd = rng(seed);
  const H = 21;
  const trunk = new MeshBuilder();
  const fol = new MeshBuilder();
  taperedCylinder(trunk, [0, -0.3, 0], [0, H * 0.82, 0], 0.36, 0.06, lod === 0 ? 12 : 7, lod === 0 ? 6 : 3, 5);
  // Charpentières dressées.
  const nb = lod === 0 ? 14 : lod === 1 ? 8 : 0;
  for (let b = 0; b < nb; b++) {
    const y = 2.5 + (b / nb) * H * 0.6;
    const a = rnd() * Math.PI * 2;
    const l = 3 + rnd() * 3;
    taperedCylinder(trunk, [0, y, 0], [Math.cos(a) * 1.1, y + l, Math.sin(a) * 1.1], 0.09, 0.02, 5, 1, 1);
  }
  // Couronne colonnaire : ellipsoïde (rayon 2,3 m) de y = 2,5 à H.
  const cards = lod === 0 ? 210 : lod === 1 ? 110 : 45;
  const cy = (2.6 + H) / 2;
  const ry = (H - 2.6) / 2;
  for (let c = 0; c < cards; c++) {
    const u = rnd() * 2 - 1;
    const th = rnd() * Math.PI * 2;
    const rr = Math.pow(rnd(), 0.35);
    const y = cy + u * ry * 0.95;
    const radAt = 2.4 * Math.sqrt(Math.max(0.04, 1 - u * u)) * (u > 0 ? 1 - u * 0.25 : 1);
    const x = Math.cos(th) * radAt * rr;
    const z = Math.sin(th) * radAt * rr;
    const size = (lod === 2 ? 2.6 : lod === 1 ? 2.1 : 1.7) * (0.8 + rnd() * 0.4);
    // Carte orientée vers l'extérieur, légèrement inclinée vers le haut.
    foliageCard(fol, [x - Math.cos(th) * size * 0.3, y - size * 0.4, z - Math.sin(th) * size * 0.3], th + (rnd() - 0.5) * 0.8, size, size, -0.35 - rnd() * 0.3, (rnd() - 0.5) * 1.2, [0, cy, 0], 1);
  }
  return { trunk, foliage: fol, height: H };
}

/* ------------------------------------------------------------------ */
/* Écriture GLB                                                        */
/* ------------------------------------------------------------------ */
async function writeTreeGlb(file: string, geo: TreeGeo, tex: { bark: { albedo: Uint8Array; normal: Uint8Array }; foliage: Uint8Array }, names: { trunk: string; foliage: string }): Promise<{ bytes: number; triangles: number; dims: { width: number; depth: number; height: number } }> {
  const doc = new Document();
  doc.createExtension(EXTTextureWebP).setRequired(true);
  const buffer = doc.createBuffer();
  const tx = (img: Uint8Array, name: string): Texture => doc.createTexture(name).setImage(img).setMimeType('image/webp');
  const barkMat = doc.createMaterial(names.trunk).setBaseColorTexture(tx(tex.bark.albedo, `${names.trunk}_albedo`)).setNormalTexture(tx(tex.bark.normal, `${names.trunk}_normal`))
    .setRoughnessFactor(0.92).setMetallicFactor(0);
  const folMat = doc.createMaterial(names.foliage).setBaseColorTexture(tx(tex.foliage, `${names.foliage}_albedo`)).setAlphaMode('MASK').setAlphaCutoff(0.42)
    .setDoubleSided(true).setRoughnessFactor(0.8).setMetallicFactor(0);
  const mesh = doc.createMesh('arbre');
  const addPrim = (m: MeshBuilder, mat: Material): void => {
    const p = doc.createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(m.pos)).setBuffer(buffer))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(m.nor)).setBuffer(buffer))
      .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(m.uv)).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(m.pos.length / 3 < 65536 ? new Uint16Array(m.idx) : new Uint32Array(m.idx)).setBuffer(buffer))
      .setMaterial(mat);
    mesh.addPrimitive(p);
  };
  addPrim(geo.trunk, barkMat);
  addPrim(geo.foliage, folMat);
  const node = doc.createNode('arbre').setMesh(mesh);
  doc.createScene('scene').addChild(node);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const bin = await io.writeBinary(doc);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, bin);
  let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity; let maxY = -Infinity; let minY = Infinity;
  for (const m of [geo.trunk, geo.foliage]) {
    for (let k = 0; k < m.pos.length; k += 3) {
      minX = Math.min(minX, m.pos[k]!); maxX = Math.max(maxX, m.pos[k]!);
      minY = Math.min(minY, m.pos[k + 1]!); maxY = Math.max(maxY, m.pos[k + 1]!);
      minZ = Math.min(minZ, m.pos[k + 2]!); maxZ = Math.max(maxZ, m.pos[k + 2]!);
    }
  }
  return { bytes: bin.byteLength, triangles: geo.trunk.triangles + geo.foliage.triangles, dims: { width: +(maxX - minX).toFixed(3), depth: +(maxZ - minZ).toFixed(3), height: +(maxY - Math.max(0, minY)).toFixed(3) } };
}

interface ProcTreeSpec {
  id: string;
  nameFr: string;
  fn: (lod: number, seed: number) => TreeGeo;
  bark: 'epicea' | 'peuplier';
  foliage: (size: number, seed: number) => Promise<Uint8Array>;
  tags: string[];
  cost: number;
  heights: number[];
}

const PROC_TREES: ProcTreeSpec[] = [
  { id: 'arbre_epicea', nameFr: 'Épicéa (conifère)', fn: spruce, bark: 'epicea', foliage: needleTexture, tags: ['arbre', 'conifere', 'foret', 'montagne', 'parc'], cost: 450, heights: [0.75, 1.0, 1.2] },
  // arbre_peuplier : remplacé par le peuplier dense de tools/generators/generate_trees.py (Blender) ; `poplar` reste disponible.
];

const LOD_DIST: [number, number] = [90, 260];

async function buildProcTree(spec: ProcTreeSpec, assetsDir: string): Promise<CatalogAsset> {
  const relDir = 'models/nature/tree';
  const files = [0, 1, 2].map((l) => `${relDir}/${spec.id}_lod${l}.glb`);
  const texSize = [512, 256, 128];
  const bark = await barkTextures(spec.bark, 256);
  const barkSmall = await barkTextures(spec.bark, 128);
  const tris: number[] = [];
  let dims = { width: 0, depth: 0, height: 0 };
  for (let l = 0; l < 3; l++) {
    const geo = spec.fn(l, 1234);
    const fol = await spec.foliage(texSize[l]!, 77);
    const r = await writeTreeGlb(join(assetsDir, files[l]!), geo, { bark: l === 0 ? bark : barkSmall, foliage: fol }, { trunk: `${spec.id}_ecorce`, foliage: `${spec.id}_feuillage` });
    tris.push(r.triangles);
    if (l === 0) dims = r.dims;
  }
  return {
    id: spec.id,
    nameFr: spec.nameFr,
    category: 'tree',
    lods: files.map((file, i) => ({ file, maxDistance: i === 0 ? LOD_DIST[0] : i === 1 ? LOD_DIST[1] : 1e9, triangles: tris[i] })),
    dimensions: dims,
    footprint: { tilesX: 0, tilesZ: 0 },
    cost: spec.cost,
    upkeepPerMonth: 0,
    capacity: { residents: 0, jobs: 0 },
    frontage: [],
    variants: [{ id: 'standard', nameFr: 'Standard' }, ...spec.heights.filter((h) => h !== 1).map((h) => ({ id: `h${Math.round(h * 100)}`, nameFr: `Taille ×${h.toFixed(2).replace('.', ',')}`, heightScale: h }))],
    textureSets: [],
    license: { spdx: 'CC0-1.0', source: `tools/generators/environment.ts#${spec.id}`, author: 'Aube Urbaine — générateur procédural (agent environnement)' },
    tags: ['procedural', ...spec.tags],
  };
}

/* ------------------------------------------------------------------ */
/* Fontaine de place (mobilier urbain généré)                           */
/* ------------------------------------------------------------------ */

/** Révolution d'un profil (r, y) autour de Y. `flat` : facettes planes (bassin octogonal). */
function lathe(m: MeshBuilder, profile: [number, number][], seg: number, tile: number, flat: boolean): void {
  // Longueur curviligne du profil (coordonnée v).
  const vs: number[] = [0];
  for (let i = 1; i < profile.length; i++) vs.push(vs[i - 1]! + Math.hypot(profile[i]![0] - profile[i - 1]![0], profile[i]![1] - profile[i - 1]![1]));
  for (let i = 0; i < profile.length - 1; i++) {
    const [r0, y0] = profile[i]!;
    const [r1, y1] = profile[i + 1]!;
    // Normale 2D du segment de profil (vers l'extérieur si le profil monte).
    let nr = y1 - y0;
    let ny = -(r1 - r0);
    const l = Math.hypot(nr, ny) || 1;
    nr /= l; ny /= l;
    for (let s = 0; s < seg; s++) {
      const a0 = (s / seg) * Math.PI * 2;
      const a1 = ((s + 1) / seg) * Math.PI * 2;
      const am = (a0 + a1) / 2;
      const nA = (a: number): [number, number, number] => (flat ? [Math.cos(am) * nr, ny, Math.sin(am) * nr] : [Math.cos(a) * nr, ny, Math.sin(a) * nr]);
      const circ = Math.max(r0, r1, 0.3) * Math.PI * 2;
      const u0 = (s / seg) * circ / tile;
      const u1 = ((s + 1) / seg) * circ / tile;
      const a = m.vert([Math.cos(a0) * r0, y0, Math.sin(a0) * r0], nA(a0), [u0, vs[i]! / tile]);
      const b = m.vert([Math.cos(a1) * r0, y0, Math.sin(a1) * r0], nA(a1), [u1, vs[i]! / tile]);
      const c = m.vert([Math.cos(a0) * r1, y1, Math.sin(a0) * r1], nA(a0), [u0, vs[i + 1]! / tile]);
      const d = m.vert([Math.cos(a1) * r1, y1, Math.sin(a1) * r1], nA(a1), [u1, vs[i + 1]! / tile]);
      m.tri(a, c, b);
      m.tri(b, c, d);
    }
  }
}

/** Disque horizontal (surface d'eau). */
function disc(m: MeshBuilder, r: number, y: number, seg: number, tile: number): void {
  const c = m.vert([0, y, 0], [0, 1, 0], [0.5, 0.5]);
  for (let s = 0; s < seg; s++) {
    const a0 = (s / seg) * Math.PI * 2;
    const a1 = ((s + 1) / seg) * Math.PI * 2;
    const p = m.vert([Math.cos(a0) * r, y, Math.sin(a0) * r], [0, 1, 0], [0.5 + Math.cos(a0) * r / tile, 0.5 + Math.sin(a0) * r / tile]);
    const q = m.vert([Math.cos(a1) * r, y, Math.sin(a1) * r], [0, 1, 0], [0.5 + Math.cos(a1) * r / tile, 0.5 + Math.sin(a1) * r / tile]);
    m.tri(c, q, p);
  }
}

/** Carte de normales de vaguelettes concentriques (eau du bassin), tuilable. */
async function rippleNormal(size: number): Promise<Uint8Array> {
  const r = new Raster(size, size);
  const h = (x: number, y: number): number => {
    let v = 0;
    for (let k = 1; k <= 5; k++) v += Math.sin((x * k * 3 + y * (6 - k) * 2) / size * Math.PI * 2 + k) / k;
    return v + tileNoise((x / size) * 16, (y / size) * 16, 16, 21) * 0.8;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (h(x - 1, y) - h(x + 1, y)) * 1.2;
      const ny = (h(x, y - 1) - h(x, y + 1)) * 1.2;
      const l = Math.hypot(nx, ny, 1);
      const o = (y * size + x) * 4;
      r.px[o] = nx / l * 0.5 + 0.5; r.px[o + 1] = ny / l * 0.5 + 0.5; r.px[o + 2] = 1 / l * 0.5 + 0.5; r.px[o + 3] = 1;
    }
  }
  return r.webp(undefined, false);
}

async function buildFountain(assetsDir: string): Promise<CatalogAsset> {
  const id = 'fontaine_place';
  const relDir = 'models/nature/street_furniture';
  const files = [0, 1, 2].map((l) => `${relDir}/${id}_lod${l}.glb`);
  const granite = (f: string): string => join(assetsDir, 'textures', 'bordure_granit', `bordure_granit_${f}.webp`);
  if (!existsSync(granite('albedo'))) throw new Error('Texture bordure_granit absente : lancer l’étape Poly Haven d’abord');
  const tris: number[] = [];
  let dims = { width: 0, depth: 0, height: 0 };
  for (let l = 0; l < 3; l++) {
    const segBasin = 8;
    const segRound = [28, 16, 8][l]!;
    const tex = [512, 256, 128][l]!;
    const stone = new MeshBuilder();
    const water = new MeshBuilder();
    // Bassin octogonal : paroi extérieure, margelle, paroi intérieure, fond.
    lathe(stone, [[3.0, -0.05], [3.0, 0.5], [3.12, 0.56], [3.12, 0.64], [2.62, 0.64], [2.62, 0.58], [2.55, 0.15], [0.01, 0.15]], segBasin, 1.2, true);
    // Vasque sur piédestal, puis fût et pomme de pin.
    lathe(stone, [[0.55, 0.15], [0.55, 0.32], [0.36, 0.42], [0.3, 0.9], [0.36, 1.05], [0.9, 1.2], [1.22, 1.38], [1.28, 1.5], [1.16, 1.52], [0.6, 1.38], [0.2, 1.42], [0.16, 1.7], [0.13, 2.05], [0.24, 2.12], [0.2, 2.3], [0.08, 2.45], [0.01, 2.5]], segRound, 0.8, false);
    disc(water, 2.56, 0.5, segRound, 2.0);
    disc(water, 1.14, 1.44, segRound, 1.2);
    const doc = new Document();
    doc.createExtension(EXTTextureWebP).setRequired(true);
    const buffer = doc.createBuffer();
    const img = async (f: string): Promise<Uint8Array> => new Uint8Array(await sharp(granite(f)).resize(tex, tex).webp({ quality: 86 }).toBuffer());
    const t = (b: Uint8Array, n: string): Texture => doc.createTexture(n).setImage(b).setMimeType('image/webp');
    const stoneMat = doc.createMaterial('fontaine_pierre').setBaseColorTexture(t(await img('albedo'), 'granit_albedo')).setNormalTexture(t(await img('normal'), 'granit_normal'))
      .setBaseColorFactor([0.93, 0.9, 0.86, 1]).setRoughnessFactor(0.75).setMetallicFactor(0);
    const waterMat = doc.createMaterial('fontaine_eau').setBaseColorFactor([0.1, 0.24, 0.26, 1]).setNormalTexture(t(await rippleNormal(tex), 'eau_normal'))
      .setRoughnessFactor(0.04).setMetallicFactor(0);
    const mesh = doc.createMesh('fontaine');
    for (const [mb, mat] of [[stone, stoneMat], [water, waterMat]] as const) {
      mesh.addPrimitive(doc.createPrimitive()
        .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(mb.pos)).setBuffer(buffer))
        .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(mb.nor)).setBuffer(buffer))
        .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(mb.uv)).setBuffer(buffer))
        .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(mb.idx)).setBuffer(buffer))
        .setMaterial(mat));
    }
    doc.createScene('scene').addChild(doc.createNode('fontaine').setMesh(mesh));
    const bin = await new NodeIO().registerExtensions(ALL_EXTENSIONS).writeBinary(doc);
    mkdirSync(join(assetsDir, relDir), { recursive: true });
    writeFileSync(join(assetsDir, files[l]!), bin);
    tris.push(stone.triangles + water.triangles);
    if (l === 0) dims = { width: 6.24, depth: 6.24, height: 2.55 };
  }
  return {
    id,
    nameFr: 'Fontaine de place (vasque en granit)',
    category: 'street_furniture',
    lods: files.map((file, i) => ({ file, maxDistance: i === 0 ? 60 : i === 1 ? 180 : 1e9, triangles: tris[i] })),
    dimensions: dims,
    footprint: { tilesX: 0, tilesZ: 0 },
    cost: 2500,
    upkeepPerMonth: 0,
    capacity: { residents: 0, jobs: 0 },
    frontage: [],
    variants: [{ id: 'standard', nameFr: 'Granit clair' }, { id: 'sombre', nameFr: 'Granit sombre', materialOverrides: { fontaine_pierre: { color: '#9a958e' } } }],
    textureSets: ['bordure_granit'],
    license: { spdx: 'CC0-1.0', source: 'tools/generators/environment.ts#fontaine_place (texture Poly Haven granite_tile_03, CC0)', author: 'Aube Urbaine — générateur procédural (agent environnement)' },
    tags: ['procedural', 'fontaine', 'place', 'parc', 'mobilier'],
  };
}

/* ------------------------------------------------------------------ */
/* Décors naturels Poly Haven (via le pipeline du technical artist)     */
/* ------------------------------------------------------------------ */
const NATURE_LODS: [number, number] = [45, 140];
export const NATURE_PH: ModelSpec[] = [
  { id: 'rocher_mousse', ph: 'rock_moss_set_01', nameFr: 'Rochers moussus', category: 'prop', lod0Triangles: 6000, textureSize: 512, lodDistances: NATURE_LODS, tags: ['rocher', 'nature', 'foret'], heightVariants: [0.8, 1.0, 1.3] },
  { id: 'rocher_granite', ph: 'namaqualand_boulder_04', nameFr: 'Rocher de granite', category: 'prop', lod0Triangles: 6000, textureSize: 512, lodDistances: NATURE_LODS, tags: ['rocher', 'nature', 'montagne'], heightVariants: [0.6, 1.0, 1.5] },
  { id: 'buisson_sauvage', ph: 'shrub_02', nameFr: 'Massif d’arbustes sauvages', category: 'vegetation', lod0Triangles: 8000, textureSize: 512, lodDistances: NATURE_LODS, tags: ['arbuste', 'nature', 'lisiere', 'haie'], heightVariants: [0.8, 1.0, 1.2] },
  { id: 'fleurs_gazania', ph: 'flower_gazania', nameFr: 'Massif de fleurs (gazanias)', category: 'vegetation', lod0Triangles: 5000, textureSize: 512, lodDistances: [35, 100], tags: ['fleur', 'massif', 'parc', 'nature'] },
  { id: 'herbes_hautes', ph: 'grass_medium_02', nameFr: 'Touffe d’herbes hautes', category: 'vegetation', lod0Triangles: 5000, textureSize: 512, lodDistances: [35, 100], tags: ['fleur', 'herbe', 'prairie', 'nature'] },
];

async function buildNaturePh(spec: ModelSpec, assetsDir: string): Promise<CatalogAsset> {
  const files = [0, 1, 2].map((l) => `models/nature/${spec.category}/${spec.id}_lod${l}.glb`);
  const stamp = join(CACHE, `${spec.id}.json`);
  const hash = createHash('sha1').update(JSON.stringify({ spec: { ...spec, nodes: spec.nodes?.source ?? null }, v: GEN_VERSION })).digest('hex');
  if (existsSync(stamp) && files.every((f) => existsSync(join(assetsDir, f)))) {
    const s = JSON.parse(readFileSync(stamp, 'utf8')) as { hash: string; asset: CatalogAsset };
    if (s.hash === hash) return s.asset;
  }
  const { buildModel } = await import('../assets/models');
  const built = await buildModel(spec, assetsDir);
  for (let l = 0; l < 3; l++) {
    const src = join(assetsDir, built.asset.lods[l]!.file);
    const dst = join(assetsDir, files[l]!);
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(src, dst);
    unlinkSync(src); // le dossier polyhaven/ appartient à l'étape Poly Haven : on n'y laisse rien
    built.asset.lods[l]!.file = files[l]!;
  }
  const asset: CatalogAsset = { ...built.asset, tags: [...built.asset.tags.filter((t) => t !== 'polyhaven'), 'polyhaven'] };
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(stamp, JSON.stringify({ hash, asset }, null, 1));
  return asset;
}

/** Générateur à enregistrer dans tools/generators/index.ts. */
export const environmentGenerator: Generator = async ({ assetsDir }): Promise<GeneratorOutput> => {
  const assets: CatalogAsset[] = [];
  for (const t of PROC_TREES) {
    const a = await buildProcTree(t, assetsDir);
    console.log(`  ${a.id.padEnd(24)} tri ${a.lods.map((l) => l.triangles).join('/')}  ${a.dimensions.width}×${a.dimensions.depth}×${a.dimensions.height} m`);
    assets.push(a);
  }
  {
    const f = await buildFountain(assetsDir);
    console.log(`  ${f.id.padEnd(24)} tri ${f.lods.map((l) => l.triangles).join('/')}  ${f.dimensions.width}×${f.dimensions.depth}×${f.dimensions.height} m`);
    assets.push(f);
  }
  for (const s of NATURE_PH) {
    const a = await buildNaturePh(s, assetsDir);
    console.log(`  ${a.id.padEnd(24)} tri ${a.lods.map((l) => l.triangles).join('/')}  ${a.dimensions.width}×${a.dimensions.depth}×${a.dimensions.height} m`);
    assets.push(a);
  }
  return { assets, textureSets: [] };
};

// Exécution autonome : écrit les GLB et un fragment de catalogue (utilisé par la démo environnement).
if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const assetsDir = join(root, 'assets');
  const out = await environmentGenerator({ assetsDir });
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(join(CACHE, 'catalog-fragment.json'), JSON.stringify(out, null, 1));
  console.log(`Fragment de catalogue : ${join(CACHE, 'catalog-fragment.json')} (${out.assets.length} assets)`);
}
