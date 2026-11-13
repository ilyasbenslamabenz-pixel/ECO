/**
 * Textures PBR des véhicules, GÉNÉRÉES par nos outils (aucune source externe, CC0) :
 *  - atlas de détails 1024² (pneus, jantes, chromes, plastiques, calandres, optiques, plaques,
 *    lettrages, bandes rétroréfléchissantes, rideaux de coffres, tôle striée, girouette LED…)
 *    → albedo + normale (dérivée d'une carte de hauteurs) + ARM (AO/rugosité/métal) + émissive ;
 *  - peinture carrosserie 256² répétable (peau d'orange, paillettes) → albedo quasi blanc teinté
 *    par variante / instance, normale, ARM.
 * Les GLB référencent ces WebP par URI relative (une seule copie pour toute la flotte).
 */
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ADVANCE, glyph, textWidthUnits } from './font';

export const ATLAS_SIZE = 1024;

/** Plaques d'immatriculation : une par bande de 256 × 64 px dans une texture dédiée (variété par instance). */
export const PLATE_W = 256, PLATE_H = 64, PLATE_ROWS = 24;

/**
 * Numéros des plaques (format européen à deux lettres, trois chiffres, deux lettres), tirés d'une suite
 * déterministe : la texture est reproductible et le rendu choisit une bande par véhicule.
 */
export function plateNumbers(rows = PLATE_ROWS): string[] {
  const L = 'ABCDEFGHJKLMNPRSTUVWXYZ';
  let st = 20260413 >>> 0;
  const r = (): number => { st = (Math.imul(st ^ (st >>> 15), st | 1) + 0x6d2b79f5) >>> 0; return st / 4294967296; };
  const out: string[] = [];
  const vus = new Set<string>();
  while (out.length < rows) {
    const p = `${L[Math.floor(r() * L.length)]}${L[Math.floor(r() * L.length)]}-${String(Math.floor(r() * 900) + 100)}-${L[Math.floor(r() * L.length)]}${L[Math.floor(r() * L.length)]}`;
    if (vus.has(p)) continue;
    vus.add(p); out.push(p);
  }
  return out;
}

/** Rectangle en pixels de l'atlas [x0, y0, x1, y1]. */
export type PxRect = [number, number, number, number];

/** Régions de l'atlas (pixels). Les UV glTF ont l'origine en haut à gauche : u = x / 1024, v = y / 1024. */
export const REGIONS = {
  bande_roulement: [0, 0, 512, 64],
  flanc: [512, 0, 640, 128],
  alu: [640, 0, 768, 128],
  chrome: [768, 0, 896, 128],
  plastique: [896, 0, 1024, 128],
  bande_roulement_pl: [0, 64, 512, 128],
  calandre: [0, 128, 256, 256],
  phare: [256, 128, 384, 256],
  feu: [384, 128, 512, 256],
  clignotant: [512, 128, 576, 192],
  recul: [512, 192, 576, 256],
  plaque: [576, 128, 832, 192],
  interieur: [576, 192, 832, 256],
  gyro_bleu: [832, 128, 960, 192],
  gyro_orange: [832, 192, 960, 256],
  caoutchouc: [960, 128, 1024, 256],
  txt_police: [0, 256, 512, 320],
  txt_taxi: [512, 256, 768, 320],
  txt_samu: [768, 256, 1024, 320],
  txt_ambulance: [0, 320, 512, 384],
  txt_pompiers: [512, 320, 1024, 384],
  bande_tricolore: [0, 384, 512, 416],
  bande_jaune: [0, 416, 512, 448],
  damier: [0, 448, 512, 512],
  chevrons: [512, 384, 768, 512],
  bande_blanche: [768, 384, 1024, 448],
  bande_rouge: [768, 448, 1024, 512],
  rideau: [0, 512, 256, 768],
  girouette: [256, 512, 768, 576],
  calandre_pl: [256, 576, 512, 768],
  jante_disque: [512, 576, 640, 704],
  jante_pl: [640, 576, 768, 704],
  tole_striee: [768, 512, 1024, 768],
  grille_aeration: [512, 704, 768, 768],
  noir_mat: [0, 768, 128, 896],
  dessous: [128, 768, 256, 896],
  feu_gabarit: [256, 768, 320, 832],
  catadioptre: [320, 768, 384, 832],
  txt_bus: [384, 768, 768, 832],
  logo_croix: [768, 768, 896, 896],
  echelle: [896, 768, 1024, 896],
  benne: [256, 832, 768, 896],
  tuyau: [0, 896, 256, 1024],
  pare_choc_pl: [256, 896, 512, 1024],
  vitre_peinte: [512, 896, 768, 1024],
  tableau: [768, 896, 1024, 1024],
} satisfies Record<string, PxRect>;
export type RegionName = keyof typeof REGIONS;

export interface UvRect { u0: number; v0: number; u1: number; v1: number }
/** Région en UV, rétrécie d'un demi-texel ×2 pour éviter les débordements de filtrage. */
export function regionUv(name: RegionName): UvRect {
  const [x0, y0, x1, y1] = REGIONS[name];
  const pad = 2;
  return { u0: (x0 + pad) / ATLAS_SIZE, v0: (y0 + pad) / ATLAS_SIZE, u1: (x1 - pad) / ATLAS_SIZE, v1: (y1 - pad) / ATLAS_SIZE };
}

/* ------------------------------------------------------------------ */
/* Canevas PBR                                                          */
/* ------------------------------------------------------------------ */

type RGB = [number, number, number];
const hex = (h: string): RGB => {
  const v = parseInt(h.replace('#', ''), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
};

function hash(x: number, y: number, s: number): number {
  let h = (x * 374761393 + y * 668265263 + s * 982451653) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
/** Bruit de valeur lissé périodique (période p en cellules). */
function vnoise(x: number, y: number, cell: number, seed: number, period = 1 << 20): number {
  const fx = x / cell, fy = y / cell;
  const ix = Math.floor(fx), iy = Math.floor(fy);
  const tx = fx - ix, ty = fy - iy;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const m = (a: number): number => ((a % period) + period) % period;
  const a = hash(m(ix), m(iy), seed), b = hash(m(ix + 1), m(iy), seed);
  const c = hash(m(ix), m(iy + 1), seed), d = hash(m(ix + 1), m(iy + 1), seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

interface Px { alb?: RGB; h?: number; rough?: number; metal?: number; ao?: number; emi?: RGB }

export class PbrCanvas {
  readonly alb: Float32Array;
  readonly hgt: Float32Array;
  readonly rough: Float32Array;
  readonly metal: Float32Array;
  readonly ao: Float32Array;
  readonly emi: Float32Array;
  constructor(readonly w: number, readonly h: number) {
    const n = w * h;
    this.alb = new Float32Array(n * 3).fill(0.5);
    this.hgt = new Float32Array(n).fill(0.5);
    this.rough = new Float32Array(n).fill(0.6);
    this.metal = new Float32Array(n);
    this.ao = new Float32Array(n).fill(1);
    this.emi = new Float32Array(n * 3);
  }
  set(x: number, y: number, p: Px): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = y * this.w + x;
    if (p.alb) { this.alb[i * 3] = p.alb[0]; this.alb[i * 3 + 1] = p.alb[1]; this.alb[i * 3 + 2] = p.alb[2]; }
    if (p.h !== undefined) this.hgt[i] = p.h;
    if (p.rough !== undefined) this.rough[i] = p.rough;
    if (p.metal !== undefined) this.metal[i] = p.metal;
    if (p.ao !== undefined) this.ao[i] = p.ao;
    if (p.emi) { this.emi[i * 3] = p.emi[0]; this.emi[i * 3 + 1] = p.emi[1]; this.emi[i * 3 + 2] = p.emi[2]; }
  }
  getAlb(x: number, y: number): RGB { const i = (y * this.w + x) * 3; return [this.alb[i]!, this.alb[i + 1]!, this.alb[i + 2]!]; }
  /** Applique fn à chaque pixel du rectangle ; (u, v) locaux dans [0, 1], (lx, ly) en pixels locaux. */
  each(r: PxRect, fn: (u: number, v: number, lx: number, ly: number, x: number, y: number) => Px | null): void {
    const [x0, y0, x1, y1] = r;
    const w = x1 - x0, h = y1 - y0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const lx = x - x0, ly = y - y0;
      const p = fn((lx + 0.5) / w, (ly + 0.5) / h, lx, ly, x, y);
      if (p) this.set(x, y, p);
    }
  }
  /** Mélange une couleur sur le rectangle selon une couverture [0, 1] calculée par fn. */
  blend(r: PxRect, fn: (u: number, v: number, lx: number, ly: number) => number, p: Px): void {
    const [x0, y0, x1, y1] = r;
    const w = x1 - x0, h = y1 - y0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const lx = x - x0, ly = y - y0;
      const c = Math.max(0, Math.min(1, fn((lx + 0.5) / w, (ly + 0.5) / h, lx, ly)));
      if (c <= 0) continue;
      const i = y * this.w + x;
      const mix = (arr: Float32Array, k: number, v: number): void => { arr[k] = arr[k]! * (1 - c) + v * c; };
      if (p.alb) for (let k = 0; k < 3; k++) mix(this.alb, i * 3 + k, p.alb[k]!);
      if (p.emi) for (let k = 0; k < 3; k++) mix(this.emi, i * 3 + k, p.emi[k]!);
      if (p.h !== undefined) mix(this.hgt, i, p.h);
      if (p.rough !== undefined) mix(this.rough, i, p.rough);
      if (p.metal !== undefined) mix(this.metal, i, p.metal);
      if (p.ao !== undefined) mix(this.ao, i, p.ao);
    }
  }
  /**
   * Texte à traits (police du projet) centré dans le rectangle. `heightPx` = hauteur des capitales,
   * `weight` = épaisseur relative du trait. `p` = propriétés de l'encre (relief compris).
   */
  text(r: PxRect, text: string, heightPx: number, p: Px, weight = 0.16, align: 'center' | 'left' = 'center', padX = 0): void {
    const unit = heightPx / 6;
    const tw = textWidthUnits(text) * unit;
    const [x0, y0, x1, y1] = r;
    const ox = align === 'center' ? x0 + (x1 - x0 - tw) / 2 : x0 + padX;
    const oy = y0 + (y1 - y0 - heightPx) / 2;
    const segs: number[] = [];
    [...text].forEach((ch, k) => {
      for (const s of glyph(ch)) {
        for (let i = 0; i + 3 < s.length; i += 2) {
          segs.push(ox + (k * ADVANCE + s[i]!) * unit, oy + s[i + 1]! * unit, ox + (k * ADVANCE + s[i + 2]!) * unit, oy + s[i + 3]! * unit);
        }
      }
    });
    const half = Math.max(0.8, weight * heightPx * 0.5);
    this.blend(r, (_u, _v, lx, ly) => {
      const px = x0 + lx + 0.5, py = y0 + ly + 0.5;
      let d = Infinity;
      for (let i = 0; i < segs.length; i += 4) {
        const ax = segs[i]!, ay = segs[i + 1]!, bx = segs[i + 2]!, by = segs[i + 3]!;
        const dx = bx - ax, dy = by - ay;
        const l2 = dx * dx + dy * dy;
        const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
        d = Math.min(d, Math.hypot(px - ax - t * dx, py - ay - t * dy));
      }
      return half - d + 0.5;
    }, p);
  }

  /** Normal map (convention OpenGL / glTF) dérivée de la hauteur ; `strength` en pixels de relief. */
  normalRGB(strength: number): Uint8Array {
    const { w, h } = this;
    const out = new Uint8Array(w * h * 3);
    const H = (x: number, y: number): number => this.hgt[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))]!;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const nx = -dx, ny = dy, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      const i = (y * w + x) * 3;
      out[i] = Math.round((nx / l * 0.5 + 0.5) * 255);
      out[i + 1] = Math.round((ny / l * 0.5 + 0.5) * 255);
      out[i + 2] = Math.round((nz / l * 0.5 + 0.5) * 255);
    }
    return out;
  }
  albedoRGB(): Uint8Array {
    const out = new Uint8Array(this.w * this.h * 3);
    for (let i = 0; i < out.length; i++) out[i] = Math.round(Math.max(0, Math.min(1, this.alb[i]!)) * 255);
    return out;
  }
  emissiveRGB(): Uint8Array {
    const out = new Uint8Array(this.w * this.h * 3);
    for (let i = 0; i < out.length; i++) out[i] = Math.round(Math.max(0, Math.min(1, this.emi[i]!)) * 255);
    return out;
  }
  armRGB(): Uint8Array {
    const n = this.w * this.h;
    const out = new Uint8Array(n * 3);
    for (let i = 0; i < n; i++) {
      out[i * 3] = Math.round(Math.max(0, Math.min(1, this.ao[i]!)) * 255);
      out[i * 3 + 1] = Math.round(Math.max(0.02, Math.min(1, this.rough[i]!)) * 255);
      out[i * 3 + 2] = Math.round(Math.max(0, Math.min(1, this.metal[i]!)) * 255);
    }
    return out;
  }
}

/* ------------------------------------------------------------------ */
/* Peinture de l'atlas                                                  */
/* ------------------------------------------------------------------ */

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const smooth = (e0: number, e1: number, x: number): number => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const mixc = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const shade = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];

function paintAtlas(c: PbrCanvas): void {
  const R = REGIONS;
  // fond : plastique noir neutre partout (sécurité si une UV déborde)
  c.each([0, 0, ATLAS_SIZE, ATLAS_SIZE], () => ({ alb: [0.05, 0.05, 0.055], h: 0.5, rough: 0.7, metal: 0, ao: 1 }));

  // --- bande de roulement (u = circonférence, v = largeur) : pains et rainures
  const tread = (r: PxRect, blocks: number, heavy: boolean): void => c.each(r, (u, v, lx, ly) => {
    const gW = heavy ? 0.06 : 0.045;
    const groove1 = Math.abs(v - 0.33) < gW || Math.abs(v - 0.67) < gW;
    const shoulder = v < 0.1 || v > 0.9;
    const bu = (u * blocks + (v < 0.5 ? 0 : 0.5)) % 1;
    const sipe = heavy ? Math.abs(bu - 0.5) < 0.1 && !shoulder : Math.abs(bu - (0.5 + (v - 0.5) * 0.6)) < 0.07;
    const n = vnoise(lx, ly, 3, 7) * 0.05;
    let hh = 0.75 + n;
    if (groove1 || sipe) hh = 0.15;
    if (shoulder) hh = 0.55 + 0.2 * Math.abs(Math.sin(u * blocks * Math.PI));
    const k = 0.07 + n * 0.3;
    return { alb: [k, k, k * 1.04], h: hh, rough: 0.92, metal: 0, ao: groove1 || sipe ? 0.45 : 1 };
  });
  tread(R.bande_roulement, 48, false);
  tread(R.bande_roulement_pl, 36, true);

  // --- flanc (disque : centre de la région) : caoutchouc + lettrage en relief + liseré
  c.each(R.flanc, (u, v, lx, ly) => {
    const dx = u - 0.5, dy = v - 0.5;
    const rr = Math.hypot(dx, dy) * 2; // 0 centre .. 1 bord
    const ang = Math.atan2(dy, dx);
    let hh = 0.5 + 0.2 * smooth(0.55, 0.75, rr) * (1 - smooth(0.92, 1, rr));
    const letters = rr > 0.74 && rr < 0.86 && Math.abs(Math.sin(ang * 14)) > 0.55 && Math.sin(ang * 2) > 0.2;
    if (letters) hh += 0.15;
    const k = 0.075 + vnoise(lx, ly, 2, 11) * 0.02;
    return { alb: [k, k, k], h: hh, rough: 0.85, metal: 0, ao: rr > 0.97 ? 0.6 : 1 };
  });

  // --- aluminium brossé, chrome, plastique grainé
  c.each(R.alu, (_u, _v, lx, ly) => {
    const b = vnoise(lx * 0.15, ly * 6, 1, 3) * 0.08;
    return { alb: [0.78 + b, 0.79 + b, 0.81 + b], h: 0.5 + b, rough: 0.32 + b, metal: 1, ao: 1 };
  });
  c.each(R.chrome, (_u, v) => ({ alb: [0.92, 0.93, 0.95], h: 0.5, rough: 0.08 + 0.04 * Math.sin(v * 9), metal: 1, ao: 1 }));
  const grain = (r: PxRect, base: number, rough: number): void => c.each(r, (_u, _v, lx, ly) => {
    const g = vnoise(lx, ly, 1.5, 5) * 0.6 + vnoise(lx, ly, 5, 9) * 0.4;
    const k = base + g * 0.025;
    return { alb: [k, k, k * 1.05], h: 0.45 + g * 0.1, rough, metal: 0, ao: 1 };
  });
  grain(R.plastique, 0.045, 0.72);
  grain(R.noir_mat, 0.03, 0.85);
  grain(R.dessous, 0.06, 0.95);
  grain(R.caoutchouc, 0.035, 0.9);

  // --- calandre voiture : nid d'abeille sombre avec cadre chromé
  c.each(R.calandre, (u, v, lx, ly) => {
    const frame = u < 0.04 || u > 0.96 || v < 0.06 || v > 0.94;
    if (frame) return { alb: [0.85, 0.86, 0.88], h: 0.9, rough: 0.12, metal: 1, ao: 1 };
    const cx = lx / 11, cy = ly / 9.5;
    const row = Math.floor(cy);
    const fx = (cx + (row % 2) * 0.5) % 1, fy = cy % 1;
    const cell = Math.max(Math.abs(fx - 0.5) * 1.15, Math.abs(fy - 0.5));
    const hole = cell < 0.36;
    return { alb: hole ? [0.015, 0.015, 0.018] : [0.09, 0.09, 0.1], h: hole ? 0.1 : 0.7, rough: hole ? 0.95 : 0.45, metal: hole ? 0 : 0.3, ao: hole ? 0.3 : 1 };
  });
  // --- calandre poids lourd : lames horizontales chromées
  c.each(R.calandre_pl, (u, v) => {
    const frame = u < 0.05 || u > 0.95 || v < 0.05 || v > 0.95;
    const slat = (v * 12) % 1 < 0.55;
    if (frame) return { alb: [0.2, 0.2, 0.22], h: 0.9, rough: 0.4, metal: 0.4, ao: 1 };
    return slat ? { alb: [0.8, 0.81, 0.83], h: 0.75, rough: 0.15, metal: 1, ao: 1 } : { alb: [0.02, 0.02, 0.02], h: 0.15, rough: 0.9, metal: 0, ao: 0.35 };
  });

  // --- optiques : phare (réflecteurs + LED), feu arrière rouge segmenté, clignotant, recul
  c.each(R.phare, (u, v) => {
    const pods = [0.27, 0.73];
    let d = 1;
    for (const p of pods) d = Math.min(d, Math.hypot(u - p, (v - 0.55) * 1.2));
    const reflector = d < 0.2;
    const led = v > 0.12 && v < 0.24 && u > 0.08 && u < 0.92;
    const ring = Math.abs(d - 0.14) < 0.02;
    const base: RGB = reflector ? [0.85, 0.87, 0.9] : [0.22, 0.23, 0.25];
    const emi: RGB = led ? [1, 1, 0.97] : reflector ? [0.95, 0.93, 0.85] : [0.05, 0.05, 0.05];
    return { alb: led ? [0.95, 0.96, 1] : base, h: ring ? 0.8 : reflector ? 0.3 : 0.55, rough: 0.08, metal: reflector ? 0.9 : 0.2, ao: 1, emi };
  });
  c.each(R.feu, (u, v) => {
    const seg = Math.floor(u * 6);
    const inner = Math.abs(((u * 6) % 1) - 0.5) < 0.42 && v > 0.15 && v < 0.85;
    const strip = v > 0.42 && v < 0.58;
    const red: RGB = inner ? [0.62, 0.03, 0.03] : [0.32, 0.01, 0.01];
    return { alb: red, h: inner ? 0.6 + (seg % 2) * 0.05 : 0.4, rough: 0.1, metal: 0, ao: 1, emi: strip ? [1, 0.08, 0.05] : inner ? [0.75, 0.02, 0.01] : [0.25, 0, 0] };
  });
  c.each(R.clignotant, (_u, v) => ({ alb: [0.9, 0.48, 0.05], h: 0.5 + 0.1 * Math.sin(v * 30), rough: 0.12, metal: 0, ao: 1, emi: [0.18, 0.08, 0] }));
  c.each(R.recul, (_u, v) => ({ alb: [0.9, 0.9, 0.92], h: 0.5 + 0.1 * Math.sin(v * 30), rough: 0.1, metal: 0, ao: 1, emi: [0.1, 0.1, 0.1] }));
  c.each(R.feu_gabarit, () => ({ alb: [0.95, 0.55, 0.08], h: 0.6, rough: 0.15, metal: 0, ao: 1, emi: [0.9, 0.45, 0.05] }));
  c.each(R.catadioptre, (u, v) => {
    const hexa = (Math.floor(u * 10) + Math.floor(v * 10)) % 2 === 0;
    return { alb: [0.6, 0.03, 0.02], h: hexa ? 0.65 : 0.4, rough: 0.15, metal: 0, ao: 1, emi: [0.2, 0, 0] };
  });

  // --- plaque d'immatriculation (format générique : bande bleue, caractères sombres embossés)
  c.each(R.plaque, (u, v) => {
    const border = u < 0.012 || u > 0.988 || v < 0.06 || v > 0.94;
    const band = u < 0.085 || u > 0.915;
    return { alb: border ? [0.1, 0.1, 0.1] : band ? [0.08, 0.2, 0.62] : [0.93, 0.93, 0.9], h: border ? 0.7 : 0.5, rough: 0.35, metal: 0, ao: 1 };
  });
  c.text([R.plaque[0] + 24, R.plaque[1], R.plaque[2] - 24, R.plaque[3]], 'AU-207-BE', 25, { alb: [0.06, 0.06, 0.07], h: 0.75 }, 0.15);

  // --- intérieur (sièges tissu) — vu à travers rien (verre opaque) mais sert aux tableaux de bord visibles en vue rue
  c.each(R.interieur, (u, v, lx, ly) => {
    const seam = (u * 8) % 1 < 0.06;
    const k = 0.07 + vnoise(lx, ly, 1.2, 13) * 0.03;
    return { alb: [k, k, k * 1.1], h: seam ? 0.3 : 0.55, rough: 0.95, metal: 0, ao: seam ? 0.6 : 1 };
  });
  c.each(R.tableau, (u, v, lx, ly) => {
    const screen = u > 0.35 && u < 0.65 && v > 0.25 && v < 0.6;
    const k = 0.06 + vnoise(lx, ly, 2, 17) * 0.02;
    return { alb: screen ? [0.02, 0.05, 0.08] : [k, k, k], h: screen ? 0.45 : 0.55, rough: screen ? 0.1 : 0.8, metal: 0, ao: 1, emi: screen ? [0.04, 0.12, 0.18] : [0, 0, 0] };
  });

  // --- gyrophares
  c.each(R.gyro_bleu, (u, v) => {
    const fac = Math.abs(((u * 8) % 1) - 0.5) < 0.38;
    return { alb: fac ? [0.12, 0.3, 1] : [0.05, 0.15, 0.55], h: fac ? 0.6 : 0.4, rough: 0.1, metal: 0, ao: 1, emi: fac ? [0.15, 0.35, 1] : [0.05, 0.12, 0.45] };
  });
  c.each(R.gyro_orange, (u) => {
    const fac = Math.abs(((u * 8) % 1) - 0.5) < 0.38;
    return { alb: fac ? [1, 0.6, 0.08] : [0.6, 0.3, 0.02], h: fac ? 0.6 : 0.4, rough: 0.1, metal: 0, ao: 1, emi: fac ? [1, 0.55, 0.05] : [0.5, 0.22, 0] };
  });

  // --- lettrages (bandes de couleur + texte blanc / sombre)
  const band = (r: PxRect, bg: RGB, edge: RGB | null): void => c.each(r, (_u, v) => {
    const e = edge && (v < 0.1 || v > 0.9);
    return { alb: e ? edge! : bg, h: 0.5, rough: 0.4, metal: 0, ao: 1 };
  });
  band(R.txt_police, hex('#1f3b8c'), hex('#c8102e'));
  c.text(R.txt_police, 'POLICE', 36, { alb: [0.97, 0.97, 0.97], h: 0.56 }, 0.2);
  // enseigne de toit de taxi (lumineuse la nuit)
  c.each(R.txt_taxi, (u, v) => {
    const frame = u < 0.03 || u > 0.97 || v < 0.08 || v > 0.92;
    return { alb: frame ? [0.08, 0.08, 0.08] : [0.98, 0.9, 0.55], h: 0.5, rough: 0.3, metal: 0, ao: 1, emi: frame ? [0, 0, 0] : [0.95, 0.82, 0.4] };
  });
  c.text(R.txt_taxi, 'TAXI', 38, { alb: [0.05, 0.05, 0.05], h: 0.55, emi: [0.05, 0.04, 0.02] }, 0.22);
  band(R.txt_samu, hex('#f2f2f0'), hex('#1c4fa0'));
  c.text(R.txt_samu, 'URGENCES', 26, { alb: hex('#1c4fa0'), h: 0.55 }, 0.2);
  band(R.txt_ambulance, hex('#f2f2f0'), hex('#1c4fa0'));
  c.text(R.txt_ambulance, 'AMBULANCE', 36, { alb: hex('#1c4fa0'), h: 0.55 }, 0.2);
  band(R.txt_pompiers, hex('#f4f2ec'), hex('#c8102e'));
  c.text(R.txt_pompiers, 'SAPEURS-POMPIERS', 34, { alb: hex('#b40c1e'), h: 0.55 }, 0.2);
  band(R.txt_bus, hex('#1d6f5f'), hex('#e3c417'));
  c.text(R.txt_bus, 'LIGNE 4', 30, { alb: [0.95, 0.95, 0.95], h: 0.55 }, 0.18);

  // --- bandes : tricolore (police), jaune fluo, damier rétroréfléchissant, chevrons, blanche, rouge
  c.each(R.bande_tricolore, (_u, v) => ({ alb: v < 0.33 ? hex('#1f3b8c') : v < 0.66 ? [0.95, 0.95, 0.95] : hex('#c8102e'), h: 0.5, rough: 0.35, metal: 0, ao: 1 }));
  c.each(R.bande_jaune, (_u, v) => ({ alb: v < 0.15 || v > 0.85 ? [0.1, 0.1, 0.1] : hex('#d9e021'), h: 0.5, rough: 0.35, metal: 0, ao: 1, emi: [0.04, 0.05, 0] }));
  c.each(R.damier, (u, v) => {
    const on = (Math.floor(u * 16) + Math.floor(v * 2)) % 2 === 0;
    return { alb: on ? hex('#1c4fa0') : hex('#e8d21b'), h: 0.5, rough: 0.35, metal: 0, ao: 1 };
  });
  c.each(R.chevrons, (u, v) => {
    const on = ((u * 4 + v * 2) % 1) < 0.5;
    return { alb: on ? hex('#d0101e') : [0.95, 0.95, 0.92], h: 0.5, rough: 0.3, metal: 0, ao: 1, emi: on ? [0.06, 0, 0] : [0.06, 0.06, 0.06] };
  });
  c.each(R.bande_blanche, () => ({ alb: [0.95, 0.95, 0.93], h: 0.5, rough: 0.3, metal: 0, ao: 1 }));
  c.each(R.bande_rouge, () => ({ alb: hex('#b80f1f'), h: 0.5, rough: 0.35, metal: 0, ao: 1 }));
  c.each(R.logo_croix, (u, v) => {
    const cross = (Math.abs(u - 0.5) < 0.12 && Math.abs(v - 0.5) < 0.38) || (Math.abs(v - 0.5) < 0.12 && Math.abs(u - 0.5) < 0.38);
    const disk = Math.hypot(u - 0.5, v - 0.5) < 0.47;
    return { alb: cross ? [0.95, 0.95, 0.95] : disk ? hex('#1c4fa0') : [0.95, 0.95, 0.93], h: 0.5, rough: 0.35, metal: 0, ao: 1 };
  });

  // --- rideau de coffre (aluminium à lames), tôle striée, grille d'aération, échelle, benne
  c.each(R.rideau, (u, v, lx, ly) => {
    const slat = (v * 18) % 1;
    const hh = 0.35 + 0.4 * Math.sin(slat * Math.PI);
    const handle = v > 0.9 && Math.abs(u - 0.5) < 0.18;
    const b = vnoise(lx * 0.2, ly * 4, 1, 21) * 0.05;
    return { alb: handle ? [0.15, 0.15, 0.16] : [0.74 + b, 0.75 + b, 0.77 + b], h: handle ? 0.9 : hh, rough: 0.35, metal: 1, ao: slat < 0.08 ? 0.5 : 1 };
  });
  c.each(R.tole_striee, (u, v) => {
    const gx = (u * 14) % 1, gy = (v * 14) % 1;
    const a = (Math.floor(u * 14) + Math.floor(v * 14)) % 2 === 0;
    const d = a ? Math.abs((gx - 0.5) + (gy - 0.5)) : Math.abs((gx - 0.5) - (gy - 0.5));
    const bump = d < 0.12 && Math.abs(gx - 0.5) < 0.35 && Math.abs(gy - 0.5) < 0.35;
    return { alb: [0.62, 0.63, 0.65], h: bump ? 0.85 : 0.4, rough: 0.4, metal: 1, ao: 1 };
  });
  c.each(R.grille_aeration, (u, v) => {
    const slot = (u * 24) % 1 < 0.55 && v > 0.15 && v < 0.85;
    return { alb: slot ? [0.02, 0.02, 0.02] : [0.15, 0.15, 0.16], h: slot ? 0.2 : 0.6, rough: 0.6, metal: 0.4, ao: slot ? 0.4 : 1 };
  });
  c.each(R.echelle, (u, v) => {
    const rail = u < 0.12 || u > 0.88;
    const rung = (v * 8) % 1 < 0.18;
    const on = rail || rung;
    return { alb: on ? [0.8, 0.81, 0.83] : [0.02, 0.02, 0.02], h: on ? 0.75 : 0.2, rough: 0.3, metal: on ? 1 : 0, ao: on ? 1 : 0.3 };
  });
  c.each(R.benne, (u, v, lx, ly) => {
    const rib = (u * 10) % 1 < 0.12;
    const dirt = vnoise(lx, ly, 6, 31) * 0.15 * smooth(0.6, 1, v);
    return { alb: shade([0.85, 0.85, 0.85], 1 - dirt), h: rib ? 0.8 : 0.5, rough: 0.5 + dirt, metal: 0.2, ao: rib ? 1 : 0.9 };
  });
  c.each(R.tuyau, (u, v) => {
    const coil = Math.abs(((v * 6) % 1) - 0.5) < 0.42;
    return { alb: coil ? hex('#b8b2a2') : [0.05, 0.05, 0.05], h: coil ? 0.5 + 0.3 * Math.sin(((v * 6) % 1) * Math.PI) : 0.1, rough: 0.8, metal: 0, ao: coil ? 1 : 0.4 };
  });
  c.each(R.pare_choc_pl, (u, v, lx, ly) => {
    const step = v > 0.55 && ((u * 6) % 1) > 0.08;
    const g = vnoise(lx, ly, 2, 41) * 0.03;
    return { alb: step ? [0.55, 0.56, 0.58] : [0.06 + g, 0.06 + g, 0.065 + g], h: step ? 0.6 : 0.5, rough: step ? 0.4 : 0.7, metal: step ? 1 : 0, ao: 1 };
  });
  c.each(R.vitre_peinte, (_u, v) => ({ alb: mixc([0.02, 0.025, 0.03], [0.1, 0.12, 0.13], v), h: 0.5, rough: 0.1, metal: 0.2, ao: 1 }));

  // --- girouette LED du bus (points orange sur fond noir)
  c.each(R.girouette, () => ({ alb: [0.01, 0.01, 0.01], h: 0.4, rough: 0.2, metal: 0, ao: 1, emi: [0, 0, 0] }));
  const gir: PxRect = R.girouette;
  const tmp = new PbrCanvas(gir[2] - gir[0], gir[3] - gir[1]);
  tmp.each([0, 0, tmp.w, tmp.h], () => ({ alb: [0, 0, 0] }));
  tmp.text([0, 0, tmp.w, tmp.h], '4  CENTRE-VILLE', 34, { alb: [1, 1, 1] }, 0.2);
  c.each(gir, (_u, _v, lx, ly) => {
    const cx = Math.floor(lx / 4) * 4 + 2, cy = Math.floor(ly / 4) * 4 + 2;
    const on = tmp.getAlb(Math.min(tmp.w - 1, cx), Math.min(tmp.h - 1, cy))[0] > 0.4;
    const dot = Math.hypot(lx - cx + 0.5, ly - cy + 0.5) < 1.6;
    if (!dot) return null;
    return on ? { alb: [1, 0.62, 0.1], emi: [1, 0.55, 0.05], h: 0.6 } : { alb: [0.06, 0.04, 0.02], h: 0.5 };
  });

  // --- jantes « disque » (LOD éloignés) : rayons peints, et jante acier de poids lourd
  c.each(R.jante_disque, (u, v) => {
    const dx = u - 0.5, dy = v - 0.5;
    const r = Math.hypot(dx, dy) * 2;
    const a = Math.atan2(dy, dx);
    const spoke = Math.abs(Math.sin(a * 2.5)) < 0.35 && r > 0.22 && r < 0.9;
    const hub = r < 0.24;
    const lip = r > 0.88 && r < 0.98;
    const on = spoke || hub || lip;
    return { alb: on ? [0.75, 0.76, 0.78] : [0.03, 0.03, 0.03], h: on ? 0.7 : 0.2, rough: on ? 0.3 : 0.8, metal: on ? 1 : 0, ao: on ? 1 : 0.4 };
  });
  c.each(R.jante_pl, (u, v) => {
    const dx = u - 0.5, dy = v - 0.5;
    const r = Math.hypot(dx, dy) * 2;
    const a = Math.atan2(dy, dx);
    const hole = r > 0.5 && r < 0.68 && Math.abs(Math.sin(a * 5)) > 0.75;
    const nut = r > 0.24 && r < 0.34 && Math.abs(Math.sin(a * 5)) < 0.25;
    const hub = r < 0.22;
    if (hole) return { alb: [0.01, 0.01, 0.01], h: 0.1, rough: 0.9, metal: 0, ao: 0.3 };
    return { alb: hub ? [0.12, 0.12, 0.12] : nut ? [0.8, 0.8, 0.8] : [0.72, 0.72, 0.7], h: nut ? 0.85 : r > 0.92 ? 0.7 : 0.5, rough: 0.45, metal: 0.8, ao: 1 };
  });
}

function paintPaint(c: PbrCanvas): void {
  // Peinture : base quasi blanche (la couleur vient de la variante / de l'instance), peau d'orange
  // très douce, paillettes métalliques. Répétable (bruit périodique).
  const P = 256;
  c.each([0, 0, P, P], (_u, _v, x, y) => {
    const peel = vnoise(x, y, 6, 3, P / 6) * 0.6 + vnoise(x, y, 3, 5, P / 3) * 0.4;
    const flake = hash(x, y, 77) > 0.992 ? 1 : 0;
    const k = 0.93 + peel * 0.02 + flake * 0.02;
    return { alb: [k, k, k], h: 0.5 + peel * 0.12, rough: 0.3 + peel * 0.04 - flake * 0.05, metal: 0.12 + flake * 0.3, ao: 1 };
  });
}

export interface VehicleTextureFiles {
  atlas: { albedo: string; normal: string; arm: string; emissive: string };
  paint: { albedo: string; normal: string; arm: string };
  /** Planche de plaques d'immatriculation : `rows` bandes empilées (une par numéro). */
  plates: { albedo: string; normal: string; arm: string; rows: number };
}

/** Écrit les textures dans `<assetsDir>/vehicles/textures/` ; renvoie les chemins relatifs à assets/. */
/** Peint la planche des plaques : fond réfléchissant, liseré, bande bleue d'identification, numéro embossé. */
export function paintPlates(c: PbrCanvas, numbers: string[]): void {
  numbers.forEach((num, i) => {
    const y0 = i * PLATE_H;
    const rect: PxRect = [0, y0, PLATE_W, y0 + PLATE_H];
    c.each(rect, (u, v) => {
      const border = u < 0.012 || u > 0.988 || v < 0.06 || v > 0.94;
      const band = u < 0.085;
      return { alb: border ? [0.1, 0.1, 0.1] : band ? [0.08, 0.2, 0.62] : [0.93, 0.93, 0.9], h: border ? 0.7 : 0.5, rough: 0.35, metal: 0, ao: 1 };
    });
    // étoiles européennes stylisées sur la bande bleue
    c.text([2, y0 + 6, 20, y0 + 26], '*', 14, { alb: [0.95, 0.85, 0.12], h: 0.55 }, 0.22);
    c.text([2, y0 + 40, 20, y0 + 58], 'CH', 12, { alb: [0.95, 0.95, 0.95], h: 0.55 }, 0.16);
    c.text([28, y0, PLATE_W - 10, y0 + PLATE_H], num, 30, { alb: [0.06, 0.06, 0.07], h: 0.78 }, 0.15);
  });
}

export async function writeVehicleTextures(assetsDir: string): Promise<VehicleTextureFiles> {
  const rel = 'vehicles/textures';
  const dir = join(assetsDir, rel);
  mkdirSync(dir, { recursive: true });
  const atlas = new PbrCanvas(ATLAS_SIZE, ATLAS_SIZE);
  paintAtlas(atlas);
  const paint = new PbrCanvas(256, 256);
  paintPaint(paint);
  const plates = new PbrCanvas(PLATE_W, PLATE_H * PLATE_ROWS);
  paintPlates(plates, plateNumbers());
  const write = async (name: string, data: Uint8Array, w: number, h: number, size: number, q: number, lossless = false): Promise<string> => {
    let img = sharp(Buffer.from(data), { raw: { width: w, height: h, channels: 3 } });
    if (size !== w && w === h) img = img.resize(size, size, { kernel: 'lanczos3' });
    const buf = await img.webp(lossless ? { lossless: true } : { quality: q, effort: 6 }).toBuffer();
    writeFileSync(join(dir, name), buf);
    return `${rel}/${name}`;
  };
  return {
    atlas: {
      albedo: await write('vehicules_atlas_albedo.webp', atlas.albedoRGB(), ATLAS_SIZE, ATLAS_SIZE, 1024, 90),
      normal: await write('vehicules_atlas_normal.webp', atlas.normalRGB(6), ATLAS_SIZE, ATLAS_SIZE, 1024, 88),
      arm: await write('vehicules_atlas_arm.webp', atlas.armRGB(), ATLAS_SIZE, ATLAS_SIZE, 512, 90),
      emissive: await write('vehicules_atlas_emissive.webp', atlas.emissiveRGB(), ATLAS_SIZE, ATLAS_SIZE, 512, 88),
    },
    paint: {
      albedo: await write('vehicules_peinture_albedo.webp', paint.albedoRGB(), 256, 256, 256, 92),
      normal: await write('vehicules_peinture_normal.webp', paint.normalRGB(3), 256, 256, 256, 92),
      arm: await write('vehicules_peinture_arm.webp', paint.armRGB(), 256, 256, 256, 92),
    },
    plates: {
      albedo: await write('vehicules_plaques_albedo.webp', plates.albedoRGB(), PLATE_W, PLATE_H * PLATE_ROWS, PLATE_W, 94),
      normal: await write('vehicules_plaques_normal.webp', plates.normalRGB(3), PLATE_W, PLATE_H * PLATE_ROWS, PLATE_W, 90),
      arm: await write('vehicules_plaques_arm.webp', plates.armRGB(), PLATE_W, PLATE_H * PLATE_ROWS, PLATE_W, 92),
      rows: PLATE_ROWS,
    },
  };
}
