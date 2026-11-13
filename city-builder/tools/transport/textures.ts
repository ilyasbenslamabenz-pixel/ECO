/**
 * Textures PBR des assets transport, GÉNÉRÉES par nos outils (aucune source externe, CC0) :
 *  - atlas de détails 2048² (`transport_atlas`) : vitrages, portes, livrées d'avions (fuselage + dérive),
 *    logos de compagnies maritimes FICTIVES, noms de navires, enseignes, marquages de piste, panneaux,
 *    feux (émissifs), garde-corps / treillis / échelles en découpe alpha (matériau `decal`, MASK) ;
 *    → albedo RGBA (alpha = découpe) + normale (carte de hauteurs) + ARM + émissive ;
 *  - `transport_peinture` 256² : acier peint répétable quasi blanc (teinté par matériau) ;
 *  - `transport_tole` 256² : tôle nervurée trapézoïdale (conteneurs, bardages), 4 nervures par répétition.
 * Les GLB référencent ces WebP par URI relative : une seule copie pour tous les modèles.
 * Toutes les marques (AUBE AIR, NORDA, KALIX, MERIDO, TAVRO…) sont inventées pour le projet.
 */
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ADVANCE, glyph, textWidthUnits } from '../vehicles/font';

export const ATLAS = 2048;
export type PxRect = [number, number, number, number];

export const REGIONS = {
  vitrage: [0, 0, 256, 256],
  bureaux: [256, 0, 512, 256],
  hangar_porte: [512, 0, 768, 256],
  porte_quai: [768, 0, 1024, 256],
  soufflet: [1024, 0, 1280, 128],
  passerelle_vitre: [1024, 128, 1280, 256],
  caillebotis: [1280, 0, 1408, 128],
  aeration: [1408, 0, 1536, 128],
  panneau: [1280, 128, 1408, 256],
  pneu: [1408, 128, 1536, 256],
  hublots: [1536, 0, 2048, 64],
  pont_vitres: [1536, 64, 2048, 128],
  defense: [1536, 128, 1664, 256],
  feu_blanc: [1664, 128, 1728, 192],
  feu_jaune: [1728, 128, 1792, 192],
  feu_rouge: [1664, 192, 1728, 256],
  feu_vert: [1728, 192, 1792, 256],
  feu_bleu: [1792, 128, 1856, 192],
  phare: [1856, 128, 1920, 192],
  feu_arriere: [1792, 192, 1856, 256],
  gyro: [1856, 192, 1920, 256],
  moteur: [1920, 128, 2048, 256],
  livree_mc: [0, 1408, 2048, 1600],
  livree_gp: [0, 1600, 2048, 1792],
  livree_cargo: [0, 1792, 2048, 1984],
  derive_mc: [0, 544, 256, 800],
  derive_gp: [256, 544, 512, 800],
  derive_cargo: [512, 544, 768, 800],
  logo_a: [768, 544, 1280, 608],
  logo_b: [768, 608, 1280, 672],
  logo_c: [768, 672, 1280, 736],
  logo_d: [768, 736, 1280, 800],
  nom_pc: [1280, 544, 1792, 608],
  nom_vrac: [1280, 608, 1792, 672],
  nom_ferry: [1280, 672, 1792, 736],
  nom_remorqueur: [1280, 736, 1792, 800],
  tuyere: [1792, 544, 1920, 672],
  calandre: [1920, 544, 2048, 672],
  cheminee_logo: [1792, 672, 2048, 800],
  ens_aeroport: [0, 800, 512, 864],
  ens_gare: [512, 800, 1024, 864],
  ens_capitainerie: [1024, 800, 1536, 864],
  ens_maintenance: [1536, 800, 2048, 864],
  marque_blanche: [0, 864, 64, 928],
  marque_jaune: [64, 864, 128, 928],
  marque_rouge: [128, 864, 192, 928],
  num_09: [256, 864, 512, 1120],
  num_27: [512, 864, 768, 1120],
  panneau_taxi: [768, 864, 1024, 928],
  panneau_piste: [768, 928, 1024, 992],
  hachures: [1024, 864, 1536, 928],
  bande_rr: [1024, 928, 1536, 992],
  garde_corps: [1536, 864, 2048, 928],
  treillis: [1536, 928, 2048, 1056],
  barres_porte: [0, 1120, 256, 1376],
  texte_jet: [256, 1120, 768, 1184],
  texte_bus: [256, 1184, 768, 1248],
  vitrage_tour: [768, 1120, 1024, 1376],
  echelle: [1024, 1120, 1152, 1376],
  fenetres_bus: [1408, 1120, 1920, 1184],
  porte_bus: [1408, 1184, 1536, 1376],
  coque_marques: [1536, 1184, 2048, 1248],
  ecoutille: [1152, 1120, 1408, 1376],
  numero_quai: [256, 1248, 768, 1312],
  noir: [1920, 1120, 2048, 1248],
} satisfies Record<string, PxRect>;
export type RegionName = keyof typeof REGIONS;

/** Régions en découpe alpha (à utiliser avec le matériau `decal`). */
export const DECAL_REGIONS: RegionName[] = ['logo_a', 'logo_b', 'logo_c', 'logo_d', 'nom_pc', 'nom_vrac', 'nom_ferry', 'nom_remorqueur', 'cheminee_logo',
  'ens_aeroport', 'ens_gare', 'ens_capitainerie', 'ens_maintenance', 'marque_blanche', 'marque_jaune', 'marque_rouge', 'num_09', 'num_27',
  'garde_corps', 'treillis', 'barres_porte', 'texte_jet', 'texte_bus', 'echelle', 'coque_marques', 'numero_quai'];

export interface UvRect { u0: number; v0: number; u1: number; v1: number }
export function regionUv(name: RegionName): UvRect {
  const [x0, y0, x1, y1] = REGIONS[name];
  const pad = 2;
  return { u0: (x0 + pad) / ATLAS, v0: (y0 + pad) / ATLAS, u1: (x1 - pad) / ATLAS, v1: (y1 - pad) / ATLAS };
}

/* ------------------------------------------------------------------ */
type RGB = [number, number, number];
const hex = (h: string): RGB => { const v = parseInt(h.replace('#', ''), 16); return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]; };
function hash(x: number, y: number, s: number): number {
  let h = (x * 374761393 + y * 668265263 + s * 982451653) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x: number, y: number, cell: number, seed: number, period = 1 << 20): number {
  const fx = x / cell, fy = y / cell, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const m = (a: number): number => ((a % period) + period) % period;
  const a = hash(m(ix), m(iy), seed), b = hash(m(ix + 1), m(iy), seed), c = hash(m(ix), m(iy + 1), seed), d = hash(m(ix + 1), m(iy + 1), seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const smooth = (e0: number, e1: number, x: number): number => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const mixc = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const shade = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];

interface Px { alb?: RGB; h?: number; rough?: number; metal?: number; ao?: number; emi?: RGB; a?: number }

class Canvas {
  readonly alb: Float32Array; readonly hgt: Float32Array; readonly rough: Float32Array; readonly metal: Float32Array;
  readonly ao: Float32Array; readonly emi: Float32Array; readonly alpha: Float32Array;
  constructor(readonly w: number, readonly h: number) {
    const n = w * h;
    this.alb = new Float32Array(n * 3).fill(0.5); this.hgt = new Float32Array(n).fill(0.5); this.rough = new Float32Array(n).fill(0.6);
    this.metal = new Float32Array(n); this.ao = new Float32Array(n).fill(1); this.emi = new Float32Array(n * 3); this.alpha = new Float32Array(n).fill(1);
  }
  /** Applique fn sur le rectangle ; (u, v) ∈ [0,1] locaux (v vers le bas). */
  each(r: PxRect, fn: (u: number, v: number, lx: number, ly: number) => Px | null): void {
    const [x0, y0, x1, y1] = r, w = x1 - x0, h = y1 - y0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const p = fn((x - x0 + 0.5) / w, (y - y0 + 0.5) / h, x - x0, y - y0);
      if (!p) continue;
      const i = y * this.w + x;
      if (p.alb) { this.alb[i * 3] = p.alb[0]; this.alb[i * 3 + 1] = p.alb[1]; this.alb[i * 3 + 2] = p.alb[2]; }
      if (p.h !== undefined) this.hgt[i] = p.h;
      if (p.rough !== undefined) this.rough[i] = p.rough;
      if (p.metal !== undefined) this.metal[i] = p.metal;
      if (p.ao !== undefined) this.ao[i] = p.ao;
      if (p.a !== undefined) this.alpha[i] = p.a;
      if (p.emi) { this.emi[i * 3] = p.emi[0]; this.emi[i * 3 + 1] = p.emi[1]; this.emi[i * 3 + 2] = p.emi[2]; }
    }
  }
  /** Mélange p selon la couverture fn ∈ [0,1]. */
  blend(r: PxRect, fn: (u: number, v: number, lx: number, ly: number) => number, p: Px): void {
    const [x0, y0, x1, y1] = r, w = x1 - x0, h = y1 - y0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const c = clamp01(fn((x - x0 + 0.5) / w, (y - y0 + 0.5) / h, x - x0, y - y0));
      if (c <= 0) continue;
      const i = y * this.w + x;
      const mix = (arr: Float32Array, k: number, v: number): void => { arr[k] = arr[k]! * (1 - c) + v * c; };
      if (p.alb) for (let k = 0; k < 3; k++) mix(this.alb, i * 3 + k, p.alb[k]!);
      if (p.emi) for (let k = 0; k < 3; k++) mix(this.emi, i * 3 + k, p.emi[k]!);
      if (p.h !== undefined) mix(this.hgt, i, p.h);
      if (p.rough !== undefined) mix(this.rough, i, p.rough);
      if (p.metal !== undefined) mix(this.metal, i, p.metal);
      if (p.ao !== undefined) mix(this.ao, i, p.ao);
      if (p.a !== undefined) mix(this.alpha, i, p.a);
    }
  }
  /**
   * Texte à traits (police du projet) dans le rectangle. rot180 : texte retourné (flanc gauche d'un fuselage).
   * cx, cy : centre (fractions du rectangle) ; heightPx : hauteur des capitales.
   */
  text(r: PxRect, text: string, heightPx: number, p: Px, o: { weight?: number; cx?: number; cy?: number; rot180?: boolean; stretch?: number; aniso?: number } = {}): void {
    const weight = o.weight ?? 0.16, st = o.stretch ?? 1;
    const unit = heightPx / 6;
    const tw = textWidthUnits(text) * unit * st;
    const [x0, y0, x1, y1] = r;
    const cx = x0 + (x1 - x0) * (o.cx ?? 0.5), cy = y0 + (y1 - y0) * (o.cy ?? 0.5);
    const ox = cx - tw / 2, oy = cy - heightPx / 2;
    const segs: number[] = [];
    [...text].forEach((ch, k) => {
      for (const s of glyph(ch)) for (let i = 0; i + 3 < s.length; i += 2) {
        let ax = ox + (k * ADVANCE + s[i]!) * unit * st, ay = oy + s[i + 1]! * unit, bx = ox + (k * ADVANCE + s[i + 2]!) * unit * st, by = oy + s[i + 3]! * unit;
        if (o.rot180) { ax = 2 * cx - ax; ay = 2 * cy - ay; bx = 2 * cx - bx; by = 2 * cy - by; }
        segs.push(ax, ay, bx, by);
      }
    });
    const half = Math.max(0.8, weight * heightPx * 0.5);
    const an = o.aniso ?? 1; // épaisseur horizontale ×an (texture anisotrope)
    const bx0 = Math.max(x0, Math.floor(cx - tw / 2 - half * an - 2)), bx1 = Math.min(x1, Math.ceil(cx + tw / 2 + half * an + 2));
    const by0 = Math.max(y0, Math.floor(cy - heightPx / 2 - half - 2)), by1 = Math.min(y1, Math.ceil(cy + heightPx / 2 + half + 2));
    this.blend([bx0, by0, bx1, by1], (_u, _v, lx, ly) => {
      const px = bx0 + lx + 0.5, py = by0 + ly + 0.5;
      let d = Infinity;
      for (let i = 0; i < segs.length; i += 4) {
        const ax = segs[i]!, ay = segs[i + 1]!, bx = segs[i + 2]!, by = segs[i + 3]!;
        const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
        const t = l2 > 0 ? clamp01(((px - ax) * dx + (py - ay) * dy) / l2) : 0;
        d = Math.min(d, Math.hypot((px - ax - t * dx) / an, py - ay - t * dy));
      }
      return half - d + 0.5;
    }, p);
  }
  normalRGB(strength: number): Uint8Array {
    const { w, h } = this, out = new Uint8Array(w * h * 3);
    const H = (x: number, y: number): number => this.hgt[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))]!;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength, dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1), i = (y * w + x) * 3;
      out[i] = Math.round((-dx / l * 0.5 + 0.5) * 255); out[i + 1] = Math.round((dy / l * 0.5 + 0.5) * 255); out[i + 2] = Math.round((1 / l * 0.5 + 0.5) * 255);
    }
    return out;
  }
  albedoRGBA(): Uint8Array {
    const n = this.w * this.h, out = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) { for (let k = 0; k < 3; k++) out[i * 4 + k] = Math.round(clamp01(this.alb[i * 3 + k]!) * 255); out[i * 4 + 3] = this.alpha[i]! >= 0.5 ? 255 : 0; }
    return out;
  }
  albedoRGB(): Uint8Array { const out = new Uint8Array(this.w * this.h * 3); for (let i = 0; i < out.length; i++) out[i] = Math.round(clamp01(this.alb[i]!) * 255); return out; }
  emissiveRGB(): Uint8Array { const out = new Uint8Array(this.w * this.h * 3); for (let i = 0; i < out.length; i++) out[i] = Math.round(clamp01(this.emi[i]!) * 255); return out; }
  armRGB(): Uint8Array {
    const n = this.w * this.h, out = new Uint8Array(n * 3);
    for (let i = 0; i < n; i++) { out[i * 3] = Math.round(clamp01(this.ao[i]!) * 255); out[i * 3 + 1] = Math.round(Math.max(0.03, clamp01(this.rough[i]!)) * 255); out[i * 3 + 2] = Math.round(clamp01(this.metal[i]!) * 255); }
    return out;
  }
}

/* ------------------------------------------------------------------ */
/* Peinture de l'atlas                                                  */
/* ------------------------------------------------------------------ */

const R = REGIONS;
const WHITE: RGB = [0.9, 0.9, 0.88];
/** Distance signée à un rectangle arrondi (coordonnées pixels). */
const rrect = (x: number, y: number, cx: number, cy: number, hw: number, hh: number, r: number): number => {
  const qx = Math.abs(x - cx) - hw + r, qy = Math.abs(y - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};

function glass(c: Canvas, r: PxRect, cols: number, rows: number, frame: RGB, tint: RGB, lit = 0.25, seed = 1): void {
  c.each(r, (u, v, lx, ly) => {
    const fu = u * cols, fv = v * rows, cu = Math.floor(fu), cv = Math.floor(fv);
    const du = Math.min(fu - cu, 1 - (fu - cu)), dv = Math.min(fv - cv, 1 - (fv - cv));
    const mull = du < 0.045 * cols / 2 || dv < 0.05 * rows / 2;
    if (mull) return { alb: frame, h: 0.8, rough: 0.4, metal: 0.8, ao: 1, emi: [0, 0, 0] };
    const sky = 0.75 + 0.35 * (1 - v) + (vnoise(lx, ly, 40, seed) - 0.5) * 0.15;
    const on = hash(cu, cv, seed) < lit;
    const refl = smooth(0.3, 0.7, (u + v * 0.6) % 1) * 0.06;
    return { alb: shade(tint, sky + refl), h: 0.45, rough: 0.08, metal: 0.25, ao: 1, emi: on ? [0.55, 0.47, 0.32] : [0.02, 0.025, 0.03] };
  });
}

function paintAtlas(c: Canvas): void {
  c.each([0, 0, ATLAS, ATLAS], () => ({ alb: [0.06, 0.06, 0.065], h: 0.5, rough: 0.7, metal: 0, ao: 1, a: 1 }));
  for (const d of DECAL_REGIONS) c.each(R[d], () => ({ a: 0, alb: [0.5, 0.5, 0.5] }));

  // --- vitrages
  glass(c, R.vitrage, 2, 2, [0.62, 0.65, 0.68], [0.32, 0.42, 0.5], 0.3, 3);
  c.each(R.bureaux, (u, v, lx, ly) => {
    if (v > 0.66) { const n = vnoise(lx, ly, 6, 4) * 0.08; return { alb: [0.74 + n, 0.73 + n, 0.7 + n], h: v > 0.68 ? 0.55 : 0.4, rough: 0.8, metal: 0, emi: [0, 0, 0] }; }
    const fu = u * 3, du = Math.min(fu % 1, 1 - (fu % 1));
    if (du < 0.04 || v < 0.04 || v > 0.62) return { alb: [0.3, 0.32, 0.34], h: 0.7, rough: 0.4, metal: 0.8, emi: [0, 0, 0] };
    const blind = v < 0.25 && hash(Math.floor(fu), 9, 2) < 0.6 ? 0.25 : 0;
    const on = hash(Math.floor(fu), 3, 5) < 0.35;
    return { alb: blind ? [0.6, 0.6, 0.58] : shade([0.3, 0.38, 0.44], 0.8 + 0.4 * (1 - v)), h: 0.45, rough: blind ? 0.7 : 0.08, metal: 0.2, emi: on ? [0.5, 0.44, 0.3] : [0.01, 0.01, 0.015] };
  });
  // porte de hangar : vantaux coulissants nervurés + bandeau vitré
  c.each(R.hangar_porte, (u, v, lx, ly) => {
    const n = vnoise(lx, ly, 10, 6) * 0.05;
    const panel = (u * 4) % 1, joint = panel < 0.015 || panel > 0.985;
    if (v > 0.12 && v < 0.2) { const w = (u * 16) % 1; return w < 0.1 ? { alb: [0.5, 0.52, 0.54], h: 0.7, rough: 0.4, metal: 0.7 } : { alb: [0.22, 0.28, 0.32], h: 0.4, rough: 0.1, metal: 0.3, emi: [0.08, 0.08, 0.07] }; }
    const rib = Math.abs(Math.sin(v * Math.PI * 22)) > 0.92;
    const base: RGB = v > 0.94 ? [0.85, 0.65, 0.15] : [0.56 + n, 0.6 + n, 0.64 + n];
    return { alb: joint ? [0.2, 0.22, 0.24] : shade(base, rib ? 0.85 : 1), h: joint ? 0.2 : rib ? 0.62 : 0.5, rough: 0.5, metal: 0.3 };
  });
  // porte de quai (porte sectionnelle + sas d'étanchéité)
  c.each(R.porte_quai, (u, v, lx, ly) => {
    if (u < 0.1 || u > 0.9 || v < 0.08) return { alb: [0.07, 0.07, 0.075], h: 0.6 + vnoise(lx, ly, 3, 2) * 0.1, rough: 0.9, metal: 0 };
    const sec = (v * 6) % 1, joint = sec < 0.04;
    const win = v > 0.3 && v < 0.4 && ((u - 0.1) * 6.25) % 1 > 0.2 && ((u - 0.1) * 6.25) % 1 < 0.8;
    if (win) return { alb: [0.15, 0.18, 0.2], h: 0.4, rough: 0.1, metal: 0.2 };
    const n = vnoise(lx, ly, 8, 9) * 0.05;
    const stripe = v > 0.92 ? (Math.floor((u + v) * 12) % 2 ? [0.08, 0.08, 0.08] as RGB : [0.85, 0.66, 0.1] as RGB) : null;
    return { alb: stripe ?? [0.72 + n, 0.74 + n, 0.76 + n], h: joint ? 0.25 : 0.5 + Math.sin(sec * Math.PI * 4) * 0.04, rough: 0.5, metal: 0.4 };
  });
  // soufflet (passerelle) : plis verticaux de caoutchouc
  c.each(R.soufflet, (u, _v, lx, ly) => { const f = Math.abs(Math.sin(u * Math.PI * 14)); return { alb: shade([0.09, 0.09, 0.1], 0.7 + f * 0.6), h: f, rough: 0.85, metal: 0, ao: 0.6 + f * 0.4 + vnoise(lx, ly, 4, 1) * 0 }; });
  // bandeau vitré de passerelle : tôle claire + fenêtres arrondies
  c.each(R.passerelle_vitre, (u, v) => {
    const fu = (u * 4) % 1;
    const d = rrect(fu, v, 0.5, 0.45, 0.32, 0.22, 0.1);
    if (d < 0) return { alb: [0.16, 0.2, 0.24], h: 0.4, rough: 0.08, metal: 0.3, emi: [0.12, 0.11, 0.09] };
    const rib = Math.abs(v - 0.82) < 0.02 || Math.abs(v - 0.12) < 0.02;
    return { alb: shade([0.82, 0.83, 0.84], rib ? 0.85 : 1), h: rib ? 0.6 : 0.5, rough: 0.45, metal: 0.5 };
  });
  c.each(R.caillebotis, (_u, _v, lx, ly) => { const g = lx % 8 < 2 || ly % 16 < 2; return g ? { alb: [0.5, 0.5, 0.48], h: 0.8, rough: 0.5, metal: 0.8 } : { alb: [0.03, 0.03, 0.03], h: 0.1, rough: 0.9, metal: 0, ao: 0.4 }; });
  c.each(R.aeration, (_u, v, lx) => { const s = (v * 16) % 1; return { alb: shade([0.55, 0.57, 0.58], s < 0.5 ? 0.6 : 1), h: s, rough: 0.5, metal: 0.6, ao: s < 0.3 ? 0.6 : 1, ...(lx < 3 || lx > 124 ? { alb: [0.5, 0.52, 0.53] as RGB } : {}) }; });
  c.each(R.panneau, (u, v, lx, ly) => {
    const n = vnoise(lx, ly, 12, 13) * 0.06, edge = Math.min(u, v, 1 - u, 1 - v);
    const rivet = edge < 0.06 && ((u * 10) % 1 < 0.15 || (v * 10) % 1 < 0.15) && edge > 0.025;
    return { alb: [0.6 + n, 0.62 + n, 0.63 + n], h: edge < 0.02 ? 0.3 : rivet ? 0.8 : 0.5, rough: 0.5, metal: 0.6 };
  });
  // pneu vu de face (flanc + jante)
  c.each(R.pneu, (u, v) => {
    const d = Math.hypot(u - 0.5, v - 0.5) * 2;
    if (d > 0.62) return { alb: [0.05, 0.05, 0.05], h: 0.5 + (d > 0.95 ? -0.2 : 0), rough: 0.85, metal: 0 };
    if (d > 0.58) return { alb: [0.2, 0.2, 0.2], h: 0.7, rough: 0.6, metal: 0.5 };
    const a = Math.atan2(v - 0.5, u - 0.5), hole = d > 0.25 && d < 0.5 && Math.cos(a * 6) > 0.6;
    if (hole) return { alb: [0.04, 0.04, 0.04], h: 0.2, rough: 0.9, metal: 0, ao: 0.4 };
    return { alb: d < 0.1 ? [0.3, 0.3, 0.3] : [0.68, 0.69, 0.7], h: 0.6 - d * 0.2, rough: 0.35, metal: 0.9 };
  });
  // hublots de navire (cabines) sur fond blanc
  c.each(R.hublots, (u, v) => {
    const fu = (u * 8) % 1;
    const d = rrect(fu, v, 0.5, 0.5, 0.3, 0.3, 0.08);
    if (d < 0) return { alb: [0.1, 0.13, 0.16], h: 0.35, rough: 0.08, metal: 0.3, emi: hash(Math.floor(u * 8), 1, 3) < 0.4 ? [0.5, 0.42, 0.28] : [0.01, 0.01, 0.01] };
    return { alb: d < 0.03 ? [0.6, 0.6, 0.6] : WHITE, h: d < 0.03 ? 0.6 : 0.5, rough: 0.45, metal: 0.1 };
  });
  c.each(R.pont_vitres, (u, v) => {
    const fu = (u * 10) % 1;
    if (v < 0.15 || v > 0.88 || fu < 0.06) return { alb: WHITE, h: 0.55, rough: 0.45, metal: 0.1 };
    return { alb: shade([0.14, 0.18, 0.22], 1 + (1 - v) * 0.4), h: 0.4, rough: 0.06, metal: 0.3, emi: [0.05, 0.06, 0.06] };
  });
  c.each(R.defense, (u, v, lx, ly) => { const f = Math.sin(v * Math.PI); return { alb: [0.06 + vnoise(lx, ly, 4, 7) * 0.03, 0.06, 0.06], h: 0.3 + f * 0.5 + (Math.abs(u - 0.5) < 0.05 ? -0.1 : 0), rough: 0.9, metal: 0 }; });
  const lamp = (r: PxRect, col: RGB, emi: number): void => c.each(r, (u, v) => {
    const d = Math.hypot(u - 0.5, v - 0.5) * 2;
    if (d > 0.9) return { alb: [0.12, 0.12, 0.12], h: 0.5, rough: 0.6, metal: 0.4 };
    const k = 1 - d * 0.4;
    return { alb: shade(col, 0.6 + 0.4 * k), h: 0.7 - d * 0.2, rough: 0.12, metal: 0, emi: shade(col, emi * k) };
  });
  lamp(R.feu_blanc, [1, 0.97, 0.9], 1); lamp(R.feu_jaune, [1, 0.75, 0.2], 1); lamp(R.feu_rouge, [1, 0.12, 0.08], 1);
  lamp(R.feu_vert, [0.2, 1, 0.35], 1); lamp(R.feu_bleu, [0.25, 0.45, 1], 1); lamp(R.phare, [1, 0.98, 0.92], 0.9);
  lamp(R.feu_arriere, [0.9, 0.08, 0.06], 0.7); lamp(R.gyro, [1, 0.55, 0.05], 0.9);
  // entrée d'air de réacteur (disque : u,v centrés)
  c.each(R.moteur, (u, v) => {
    const d = Math.hypot(u - 0.5, v - 0.5) * 2, a = Math.atan2(v - 0.5, u - 0.5);
    if (d > 0.93) return { alb: [0.75, 0.76, 0.78], h: 0.7, rough: 0.25, metal: 1 };
    if (d < 0.22) { const sp = Math.sin(a * 1 + d * 18) > 0.85; return { alb: sp ? [0.9, 0.9, 0.9] : [0.15, 0.15, 0.16], h: 0.8 - d, rough: 0.3, metal: 0.8 }; }
    const blade = Math.sin(a * 22 + d * 4) > 0.2;
    return { alb: blade ? [0.38, 0.39, 0.41] : [0.05, 0.05, 0.06], h: blade ? 0.6 : 0.3, rough: 0.35, metal: 0.9, ao: 0.5 + d * 0.3 };
  });
  c.each(R.tuyere, (u, v) => {
    const d = Math.hypot(u - 0.5, v - 0.5) * 2;
    if (d > 0.9) return { alb: [0.55, 0.55, 0.56], h: 0.6, rough: 0.35, metal: 1 };
    const a = Math.atan2(v - 0.5, u - 0.5), lobe = Math.cos(a * 12) * 0.05;
    return { alb: d < 0.35 + lobe ? [0.08, 0.07, 0.07] : [0.3, 0.28, 0.27], h: 0.5 - d * 0.3, rough: 0.5, metal: 0.8, ao: 0.6 };
  });
  c.each(R.calandre, (u, v) => {
    const slat = (v * 10) % 1 < 0.45, frame = u < 0.05 || u > 0.95 || v < 0.05 || v > 0.95;
    return frame ? { alb: [0.15, 0.15, 0.16], h: 0.7, rough: 0.4, metal: 0.4 } : { alb: slat ? [0.02, 0.02, 0.02] : [0.2, 0.2, 0.21], h: slat ? 0.2 : 0.6, rough: 0.6, metal: 0.3 };
  });
  c.each(R.noir, () => ({ alb: [0.04, 0.04, 0.045], h: 0.5, rough: 0.8, metal: 0 }));

  paintLiveries(c);
  paintLogos(c);
  paintMarkings(c);
  paintMisc(c);
}

/* --- livrées d'avions ---------------------------------------------- */
interface Livery { lenM: number; circM: number; region: RegionName; fin: RegionName; main: RGB; accent: RGB; belly: RGB; title: string; titleCol: RGB; windows: boolean; sub?: string }
const LIVERIES: Livery[] = [
  { lenM: 37.6, circM: 12.4, region: 'livree_mc', fin: 'derive_mc', main: hex('#1d4d96'), accent: hex('#e0a83a'), belly: hex('#c9ccd0'), title: 'AUBE AIR', titleCol: hex('#1d4d96'), windows: true },
  { lenM: 63, circM: 18.2, region: 'livree_gp', fin: 'derive_gp', main: hex('#13325f'), accent: hex('#e0a83a'), belly: hex('#13325f'), title: 'AUBE AIR', titleCol: hex('#13325f'), windows: true, sub: 'LONG COURRIER' },
  { lenM: 63, circM: 18.2, region: 'livree_cargo', fin: 'derive_cargo', main: hex('#d6631c'), accent: hex('#2b2f36'), belly: hex('#9ea3a8'), title: 'AUBE CARGO', titleCol: hex('#2b2f36'), windows: false },
];

/**
 * Fuselage : u = abscisse (0 = nez, 1 = queue), v = angle / 2π depuis le dessus (0,25 = flanc droit +X,
 * 0,5 = dessous, 0,75 = flanc gauche). Le flanc gauche est peint retourné à 180° (lecture correcte).
 */
function paintLiveries(c: Canvas): void {
  for (const L of LIVERIES) {
    const r = R[L.region];
    const W = r[2] - r[0], H = r[3] - r[1];
    const pxm = W / L.lenM, pxc = H / L.circM; // pixels par mètre (longueur / circonférence)
    const ratio = pxm / pxc;
    c.each(r, (u, v, lx, ly) => {
      const side = Math.abs(v - 0.5); // 0 = dessous, 0,5 = dessus
      const n = vnoise(lx, ly, 20, 31) * 0.02;
      let col: RGB = [0.93 + n, 0.93 + n, 0.92 + n];
      let rough = 0.32, h = 0.5;
      // ventre
      if (side < 0.13) col = mixc(col, L.belly, smooth(0.13, 0.11, side));
      // lignes de séparation
      const sw = L.region === 'livree_gp' ? 0.17 + 0.04 * Math.sin(u * 7) : 0.19;
      if (Math.abs(side - sw) < 0.018) col = L.accent;
      else if (Math.abs(side - sw + 0.035) < 0.015 && L.region !== 'livree_cargo') col = L.main;
      // balayage arrière vers la dérive
      const sweep = smooth(0.62, 0.95, u);
      if (side > 0.5 - sweep * 0.45 && u > 0.62) col = mixc(col, L.main, smooth(0, 0.02, side - (0.5 - sweep * 0.45)));
      if (L.region === 'livree_cargo' && u > 0.04 && u < 0.85 && side > 0.42) col = mixc(col, L.main, 0.0);
      // joints de panneaux discrets
      if ((u * 2048 * 0.25) % 64 < 0.6 || (v * 96 * 2) % 24 < 0.3) h = 0.45;
      // cockpit
      const cv = Math.min(Math.abs(v - 0.13), Math.abs(v - 0.87));
      const cu0 = 1.1 / L.lenM, cu1 = 2.6 / L.lenM;
      if (u > cu0 && u < cu1 && cv < 0.55 / L.circM) {
        const pane = Math.floor(((u - cu0) / (cu1 - cu0)) * 3);
        const fr = Math.abs(((u - cu0) / (cu1 - cu0)) * 3 - pane - 0.5) > 0.42;
        if (!fr) { col = [0.06, 0.08, 0.1]; rough = 0.05; h = 0.4; } else { col = [0.2, 0.2, 0.22]; }
      }
      return { alb: col, rough, h, metal: 0.15, ao: 1 };
    });
    // hublots
    if (L.windows) {
      const n = Math.round(L.region === 'livree_gp' ? 110 : 68);
      for (const vv of [0.205, 0.795]) {
        c.blend(r, (u, v, lx, ly) => {
          if (u < 0.1 || u > 0.86) return 0;
          const pitch = 0.76 / n, k = Math.floor((u - 0.1) / pitch), fu = (u - 0.1) / pitch - k;
          if (k % 17 === 5 || k % 29 === 13) return 0; // trumeaux (sorties, ailes)
          const dx = (fu - 0.5) * pitch * W / pxm, dy = (v - vv) * H / pxc; // mètres
          return (1 - Math.hypot(dx / 0.13, dy / 0.19)) * 4;
        }, { alb: [0.07, 0.09, 0.12], rough: 0.05, h: 0.35, emi: [0.25, 0.22, 0.15] });
      }
    }
    // portes (contours)
    const doors = L.windows ? [0.09, 0.3, 0.62, 0.88] : [0.08];
    for (const du of doors) for (const vv of [0.215, 0.785]) {
      c.blend(r, (u, v) => {
        const dx = (u - du) * L.lenM, dy = (v - vv) * L.circM;
        const d = Math.abs(rrect(dx, dy, 0, 0, 0.45, 0.95, 0.2));
        return 1.2 - d * pxm * 0.5;
      }, { alb: [0.45, 0.47, 0.5], h: 0.3 });
    }
    if (!L.windows) {
      // porte cargo principale (flanc gauche avant)
      c.blend(r, (u, v) => { const d = Math.abs(rrect((u - 0.2) * L.lenM, (v - 0.75) * L.circM, 0, 0, 1.7, 1.3, 0.2)); return 1.5 - d * pxm * 0.5; }, { alb: [0.4, 0.42, 0.45], h: 0.3 });
    }
    // titres (flanc droit normal, flanc gauche retourné)
    // hauteur des capitales : 1,3 m (moyen-courrier) à 2,2 m (cargo) ; étirement = anisotropie de la bande
    const th = (L.windows ? 1.3 : 2.2) * pxc;
    const st = ratio * 1.15;
    c.text(r, L.title, th, { alb: L.titleCol, h: 0.56 }, { cx: L.windows ? 0.3 : 0.42, cy: 0.15, weight: 0.2, stretch: st, aniso: ratio });
    c.text(r, L.title, th, { alb: L.titleCol, h: 0.56 }, { cx: L.windows ? 0.3 : 0.42, cy: 0.85, weight: 0.2, stretch: st, rot180: true, aniso: ratio });
    if (L.sub) {
      c.text(r, L.sub, 0.45 * pxc, { alb: L.accent, h: 0.55 }, { cx: 0.3, cy: 0.245, weight: 0.2, stretch: st, aniso: ratio });
      c.text(r, L.sub, 0.45 * pxc, { alb: L.accent, h: 0.55 }, { cx: 0.3, cy: 0.755, weight: 0.2, stretch: st, rot180: true, aniso: ratio });
    }
    // dérive : fond couleur principale + soleil levant stylisé (logo fictif)
    const f = R[L.fin];
    c.each(f, (u, v, lx, ly) => {
      const n = vnoise(lx, ly, 16, 5) * 0.02;
      let col: RGB = mixc(L.main, shade(L.main, 0.7), v * 0.6);
      const d = Math.hypot(u - 0.55, v - 0.55);
      if (v < 0.62 && d < 0.2) col = L.accent;
      else if (v < 0.62 && d > 0.24 && d < 0.4) { const a = Math.atan2(v - 0.55, u - 0.55); if (Math.cos(a * 9) > 0.55 && a < 0) col = mixc(col, L.accent, 0.9); }
      if (Math.abs(v - 0.62 - (u - 0.5) * 0.15) < 0.02) col = [0.94, 0.94, 0.92];
      return { alb: [col[0] + n, col[1] + n, col[2] + n], h: 0.5, rough: 0.32, metal: 0.15 };
    });
  }
}

/* --- logos de compagnies maritimes fictives, noms de navires, enseignes ---- */
function paintLogos(c: Canvas): void {
  const ink = (col: RGB): Px => ({ alb: col, h: 0.53, a: 1, rough: 0.5, metal: 0.1 });
  const logo = (r: PxRect, name: string, col: RGB, shape: 'losange' | 'vague' | 'etoile' | 'cercle'): void => {
    const [x0, y0] = r;
    c.blend(r, (_u, _v, lx, ly) => {
      const x = lx - 34, y = ly - 32;
      let d: number;
      if (shape === 'losange') d = Math.abs(x) + Math.abs(y) - 24;
      else if (shape === 'cercle') d = Math.abs(Math.hypot(x, y) - 20) - 5;
      else if (shape === 'vague') d = Math.abs(y - Math.sin(x / 7) * 7) - 5 + (Math.abs(x) > 26 ? 99 : 0);
      else { const a = Math.atan2(y, x), rr = 14 + 10 * Math.max(0, Math.cos(a * 5)); d = Math.hypot(x, y) - rr; }
      return 0.5 - d;
    }, ink(col));
    void x0; void y0;
    c.text([r[0] + 70, r[1], r[2], r[3]], name, 34, ink(col), { weight: 0.22, stretch: 1.15 });
  };
  logo(R.logo_a, 'NORDA', [0.95, 0.95, 0.93], 'vague');
  logo(R.logo_b, 'KALIX', [0.95, 0.95, 0.93], 'losange');
  logo(R.logo_c, 'MERIDO', [0.97, 0.82, 0.25], 'etoile');
  logo(R.logo_d, 'TAVRO LINES', [0.95, 0.95, 0.93], 'cercle');
  const name = (r: PxRect, t: string, col: RGB): void => c.text(r, t, 32, ink(col), { weight: 0.2, stretch: 1.05 });
  name(R.nom_pc, 'AUBE HORIZON', [0.95, 0.95, 0.93]);
  name(R.nom_vrac, 'MEKNES TRADER', [0.95, 0.95, 0.93]);
  name(R.nom_ferry, 'VILLE DE MEKNES', [0.12, 0.25, 0.5]);
  name(R.nom_remorqueur, 'AUBE ONE', [0.95, 0.95, 0.93]);
  // logo de cheminée : bande + soleil
  c.blend(R.cheminee_logo, (u, v) => { const d = Math.hypot((u - 0.5) * 2, v - 0.5); return (d < 0.28 ? 1 : 0) + (Math.abs(v - 0.5) < 0.42 && Math.abs(v - 0.5) > 0.36 ? 1 : 0); }, { alb: [0.88, 0.62, 0.15], a: 1, h: 0.55, rough: 0.45 });
  const sign = (r: PxRect, t: string): void => c.text(r, t, 40, { alb: [0.94, 0.95, 0.96], a: 1, h: 0.6, rough: 0.4, metal: 0.3, emi: [0.6, 0.62, 0.66] }, { weight: 0.18 });
  sign(R.ens_aeroport, 'AEROPORT'); sign(R.ens_gare, 'GARE MARITIME'); sign(R.ens_capitainerie, 'CAPITAINERIE'); sign(R.ens_maintenance, 'MAINTENANCE');
  c.text(R.texte_jet, 'JET A-1  INFLAMMABLE', 30, { alb: [0.75, 0.1, 0.08], a: 1, h: 0.55 }, { weight: 0.2 });
  c.text(R.texte_bus, 'AUBE AIR', 40, { alb: [0.11, 0.3, 0.6], a: 1, h: 0.55 }, { weight: 0.22, stretch: 1.4 });
  c.text(R.numero_quai, 'QUAI 1', 40, { alb: [0.95, 0.95, 0.93], a: 1, h: 0.55 }, { weight: 0.2 });
}

function paintMarkings(c: Canvas): void {
  const worn = (col: RGB, seed: number): (u: number, v: number, lx: number, ly: number) => Px => (_u, _v, lx, ly) => {
    const w = vnoise(lx, ly, 5, seed) * 0.6 + vnoise(lx, ly, 2, seed + 1) * 0.4;
    return { alb: shade(col, 0.88 + w * 0.12), a: w > 0.12 ? 1 : 0, h: 0.52, rough: 0.6, metal: 0 };
  };
  c.each(R.marque_blanche, worn([0.93, 0.93, 0.9], 3));
  c.each(R.marque_jaune, worn([0.92, 0.72, 0.12], 5));
  c.each(R.marque_rouge, worn([0.75, 0.12, 0.1], 7));
  const num = (r: PxRect, t: string): void => c.text(r, t, 200, { alb: [0.93, 0.93, 0.9], a: 1, h: 0.52, rough: 0.6 }, { weight: 0.17, stretch: 0.55 });
  num(R.num_09, '09'); num(R.num_27, '27');
  // panneaux de circulation aéroportuaire
  c.each(R.panneau_taxi, (u) => ({ alb: u < 0.5 ? [0.05, 0.05, 0.05] : [0.95, 0.78, 0.1], h: 0.5, rough: 0.5, metal: 0, emi: u < 0.5 ? [0, 0, 0] : [0.3, 0.25, 0.03] }));
  c.text([R.panneau_taxi[0], R.panneau_taxi[1], R.panneau_taxi[0] + 128, R.panneau_taxi[3]], 'A', 44, { alb: [0.95, 0.78, 0.1], emi: [0.4, 0.32, 0.04] }, { weight: 0.22 });
  c.text([R.panneau_taxi[0] + 128, R.panneau_taxi[1], R.panneau_taxi[2], R.panneau_taxi[3]], 'B 2', 44, { alb: [0.05, 0.05, 0.05], emi: [0, 0, 0] }, { weight: 0.22 });
  c.each(R.panneau_piste, () => ({ alb: [0.75, 0.08, 0.06], h: 0.5, rough: 0.5, metal: 0, emi: [0.25, 0.02, 0.02] }));
  c.text(R.panneau_piste, '09-27', 40, { alb: [0.95, 0.95, 0.93], emi: [0.4, 0.4, 0.4] }, { weight: 0.22 });
  c.each(R.hachures, (u, v) => ({ alb: Math.floor(u * 16 + v * 2) % 2 ? [0.06, 0.06, 0.06] : [0.9, 0.7, 0.1], h: 0.5, rough: 0.55, metal: 0.1 }));
  c.each(R.bande_rr, (u) => ({ alb: Math.floor(u * 8) % 2 ? [0.85, 0.1, 0.08] : [0.93, 0.93, 0.9], h: 0.52, rough: 0.35, metal: 0, emi: [0.04, 0.04, 0.04] }));
}

function paintMisc(c: Canvas): void {
  const steel = (k = 1): Px => ({ alb: [0.82 * k, 0.83 * k, 0.84 * k], a: 1, h: 0.7, rough: 0.45, metal: 0.6 });
  // garde-corps : 4 montants, main courante, lisse intermédiaire, plinthe (découpe alpha)
  c.blend(R.garde_corps, (u, v) => {
    const fu = (u * 4) % 1;
    const post = Math.abs(fu - 0.5) < 0.012 * 4 / 1.0 * 0.6;
    const rail = v < 0.1 || Math.abs(v - 0.5) < 0.05 || v > 0.84;
    return post || rail ? 1 : 0;
  }, steel());
  // treillis : membrures + croisillons en X (2 travées)
  c.blend(R.treillis, (u, v) => {
    const fu = (u * 4) % 1;
    const chord = v < 0.07 || v > 0.93, post = fu < 0.025 || fu > 0.975;
    const diag = Math.abs(fu - v) < 0.035 || Math.abs(fu - (1 - v)) < 0.035;
    return chord || post || diag ? 1 : 0;
  }, steel(0.95));
  // barres de verrouillage de portes de conteneur (4 barres, poignées, plaque CSC)
  c.blend(R.barres_porte, (u, v) => {
    const bars = [0.14, 0.36, 0.64, 0.86].some((b) => Math.abs(u - b) < 0.014);
    const cams = [0.14, 0.36, 0.64, 0.86].some((b) => Math.abs(u - b) < 0.03 && (Math.abs(v - 0.06) < 0.02 || Math.abs(v - 0.94) < 0.02));
    const handle = [0.14, 0.36, 0.64, 0.86].some((b) => Math.abs(v - 0.55) < 0.012 && u > b && u < b + 0.08);
    const seam = Math.abs(u - 0.5) < 0.006;
    const plate = Math.abs(u - 0.25) < 0.06 && Math.abs(v - 0.3) < 0.04;
    return bars || cams || handle || seam || plate ? 1 : 0;
  }, { alb: [0.45, 0.46, 0.47], a: 1, h: 0.75, rough: 0.5, metal: 0.7 });
  c.text(R.barres_porte, 'TCNU 482196', 9, { alb: [0.92, 0.92, 0.9], a: 1, h: 0.55 }, { cx: 0.74, cy: 0.2, weight: 0.18 });
  c.text(R.barres_porte, '45G1', 9, { alb: [0.92, 0.92, 0.9], a: 1, h: 0.55 }, { cx: 0.74, cy: 0.27, weight: 0.18 });
  // échelle
  c.blend(R.echelle, (u, v) => (u < 0.12 || u > 0.88 || (v * 12) % 1 < 0.08 ? 1 : 0), steel());
  // vitrage de tour de contrôle (vitres inclinées, montants fins, intérieur éclairé)
  c.each(R.vitrage_tour, (u, v, lx, ly) => {
    const fu = (u * 3) % 1;
    if (fu < 0.03 || fu > 0.97 || v < 0.03 || v > 0.97) return { alb: [0.25, 0.27, 0.3], h: 0.7, rough: 0.4, metal: 0.8 };
    const sky = 0.8 + (1 - v) * 0.4 + (vnoise(lx, ly, 50, 2) - 0.5) * 0.1;
    return { alb: shade([0.25, 0.36, 0.42], sky), h: 0.45, rough: 0.05, metal: 0.3, emi: v > 0.6 ? [0.18, 0.2, 0.2] : [0.05, 0.06, 0.06] };
  });
  // vitres de bus / cabines : bandeau sombre + montants
  c.each(R.fenetres_bus, (u, v) => {
    const fu = (u * 6) % 1;
    if (fu < 0.04 || v < 0.06 || v > 0.94) return { alb: [0.08, 0.08, 0.09], h: 0.6, rough: 0.5, metal: 0.2 };
    return { alb: shade([0.12, 0.15, 0.18], 1 + (1 - v) * 0.5), h: 0.42, rough: 0.05, metal: 0.3, emi: [0.12, 0.11, 0.09] };
  });
  c.each(R.porte_bus, (u, v) => {
    if (Math.abs(u - 0.5) < 0.02 || u < 0.05 || u > 0.95 || v < 0.03) return { alb: [0.1, 0.1, 0.11], h: 0.6, rough: 0.5, metal: 0.3 };
    if (v > 0.82) return { alb: [0.75, 0.76, 0.77], h: 0.5, rough: 0.4, metal: 0.4 };
    return { alb: [0.12, 0.15, 0.18], h: 0.42, rough: 0.05, metal: 0.3, emi: [0.1, 0.1, 0.08] };
  });
  // marques de coque : échelles de tirant d'eau (chiffres) et repère de franc-bord
  c.blend(R.coque_marques, (u, v, lx, ly) => {
    const disc = Math.abs(Math.hypot(lx - 420, ly - 32) - 20) < 3 || (Math.abs(ly - 32) < 2.5 && Math.abs(lx - 420) < 34);
    const scale = lx < 40 && (Math.abs(lx - 20) < 3 || ((ly % 16) < 3 && lx < 34));
    void u; void v;
    return disc || scale ? 1 : 0;
  }, { alb: [0.93, 0.93, 0.9], a: 1, h: 0.55 });
  c.text([R.coque_marques[0] + 60, R.coque_marques[1], R.coque_marques[0] + 340, R.coque_marques[3]], 'PORT DE MEKNES', 22, { alb: [0.93, 0.93, 0.9], a: 1, h: 0.55 }, { weight: 0.2 });
  // panneaux d'écoutille (vraquier) : nervures transversales, joints
  c.each(R.ecoutille, (u, v, lx, ly) => {
    const rib = (u * 8) % 1 < 0.08, edge = v < 0.04 || v > 0.96, mid = Math.abs(u - 0.5) < 0.01;
    const n = vnoise(lx, ly, 14, 21) * 0.08;
    return { alb: shade([0.72, 0.2, 0.15], (rib ? 0.85 : 1) + n - (edge || mid ? 0.4 : 0)), h: rib ? 0.75 : edge || mid ? 0.2 : 0.5, rough: 0.5, metal: 0.4 };
  });
}

/* ------------------------------------------------------------------ */
/* Textures répétables                                                  */
/* ------------------------------------------------------------------ */
function paintPeinture(c: Canvas): void {
  const P = 256;
  c.each([0, 0, P, P], (_u, _v, x, y) => {
    const peel = vnoise(x, y, 8, 3, P / 8) * 0.6 + vnoise(x, y, 4, 5, P / 4) * 0.4;
    const grime = vnoise(x, y, 64, 11, P / 64) * 0.5 + vnoise(x, y, 16, 12, P / 16) * 0.5;
    const scratch = hash(x, y, 77) > 0.996 ? 1 : 0;
    const seam = y % 128 === 0 || y % 128 === 1 ? 1 : 0; // joint de soudure horizontal (tôles de 0,75 m)
    const k = 0.9 - grime * 0.08 + peel * 0.02 - scratch * 0.15;
    return { alb: [k, k, k * 0.99], h: 0.5 + peel * 0.1 + seam * 0.25, rough: 0.48 + grime * 0.12 - peel * 0.04, metal: 0.05 + scratch * 0.6, ao: 1 - grime * 0.08 };
  });
}
function paintTole(c: Canvas): void {
  const P = 256;
  c.each([0, 0, P, P], (u, _v, x, y) => {
    // nervure trapézoïdale : 4 par répétition (x le long de u)
    const f = (u * 4) % 1;
    const prof = f < 0.18 ? 0 : f < 0.3 ? (f - 0.18) / 0.12 : f < 0.58 ? 1 : f < 0.7 ? 1 - (f - 0.58) / 0.12 : 0;
    const streak = vnoise(x, y, 6, 9, P / 6) * 0.3 + vnoise(x * 4, y, 64, 7, P * 4 / 64) * 0.7; // coulures verticales
    const dirt = vnoise(x, y, 32, 4, P / 32);
    const k = 0.88 - streak * 0.1 - dirt * 0.06 + (prof > 0.5 ? 0.03 : 0);
    return { alb: [k, k, k * 0.99], h: 0.2 + prof * 0.6, rough: 0.45 + dirt * 0.2, metal: 0.1, ao: 0.82 + prof * 0.18 };
  });
}

export interface TransportTextureFiles {
  atlas: { albedo: string; normal: string; arm: string; emissive: string };
  peinture: { albedo: string; normal: string; arm: string };
  tole: { albedo: string; normal: string; arm: string };
}

/** Écrit les textures dans `<assetsDir>/<dir>/textures/` ; renvoie les chemins relatifs à assets/. */
export async function writeTransportTextures(assetsDir: string, dir: string): Promise<TransportTextureFiles> {
  const rel = `${dir}/textures`;
  const out = join(assetsDir, rel);
  mkdirSync(out, { recursive: true });
  const write = async (name: string, data: Uint8Array, w: number, ch: 3 | 4, size: number, q: number): Promise<string> => {
    let img = sharp(Buffer.from(data), { raw: { width: w, height: w, channels: ch } });
    if (size !== w) img = img.resize(size, size, { kernel: 'lanczos3' });
    const buf = await img.webp({ quality: q, effort: 6, alphaQuality: 100 }).toBuffer();
    writeFileSync(join(out, name), buf);
    return `${rel}/${name}`;
  };
  const a = new Canvas(ATLAS, ATLAS);
  paintAtlas(a);
  const atlas = {
    albedo: await write('transport_atlas_albedo.webp', a.albedoRGBA(), ATLAS, 4, ATLAS, 86),
    normal: await write('transport_atlas_normal.webp', a.normalRGB(5), ATLAS, 3, 1024, 85),
    arm: await write('transport_atlas_arm.webp', a.armRGB(), ATLAS, 3, 1024, 85),
    emissive: await write('transport_atlas_emissive.webp', a.emissiveRGB(), ATLAS, 3, 512, 85),
  };
  const p = new Canvas(256, 256); paintPeinture(p);
  const t = new Canvas(256, 256); paintTole(t);
  return {
    atlas,
    peinture: { albedo: await write('transport_peinture_albedo.webp', p.albedoRGB(), 256, 3, 256, 90), normal: await write('transport_peinture_normal.webp', p.normalRGB(3), 256, 3, 256, 90), arm: await write('transport_peinture_arm.webp', p.armRGB(), 256, 3, 256, 90) },
    tole: { albedo: await write('transport_tole_albedo.webp', t.albedoRGB(), 256, 3, 256, 90), normal: await write('transport_tole_normal.webp', t.normalRGB(6), 256, 3, 256, 90), arm: await write('transport_tole_arm.webp', t.armRGB(), 256, 3, 256, 90) },
  };
}
