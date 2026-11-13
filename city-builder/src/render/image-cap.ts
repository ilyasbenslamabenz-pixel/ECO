/**
 * Plafond des images en mode allégé (téléphone) : chaque image de texture est réduite DÈS SON CHARGEMENT
 * (et non seulement à l'envoi au GPU), puis l'original est libéré. Sur iPhone, une ville entière décodée en
 * pleine taille côté CPU suffisait à faire planter Safari au chargement.
 * Réglé une fois au démarrage (main.ts) avant tout chargement ; Infinity = images d'origine.
 */
import type * as THREE from 'three';

export const imageLimits = {
  /** Côté maximal (px) des images de texture gardées en mémoire (modèles). */
  textureCap: Infinity,
  /** Idem pour les arbres (feuillage alpha, plus sensible à la réduction). */
  treeTextureCap: Infinity,
  /** Nombre maximal de modèles GLB chargés en même temps. */
  maxConcurrentModels: Infinity,
};

type Img = HTMLImageElement | ImageBitmap | HTMLCanvasElement | OffscreenCanvas;

function dims(img: unknown): { w: number; h: number } | null {
  const o = img as { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number } | null;
  if (!o) return null;
  const w = o.naturalWidth || o.width || 0, h = o.naturalHeight || o.height || 0;
  return w > 0 && h > 0 ? { w, h } : null;
}

/**
 * Un seul canevas de travail pour toutes les réductions : sur iPhone, Safari plafonne la mémoire TOTALE des
 * canevas et ferme la page au-delà ; garder un canevas par texture (des centaines) la faisait planter juste
 * après le chargement. Le résultat est un ImageData (simple tableau d'octets, accepté par three comme image).
 */
let work: { canvas: HTMLCanvasElement | OffscreenCanvas; ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D } | null = null;

function workCanvas(w: number, h: number): typeof work {
  if (!work) {
    let canvas: HTMLCanvasElement | OffscreenCanvas;
    if (typeof OffscreenCanvas !== 'undefined') canvas = new OffscreenCanvas(w, h);
    else if (typeof document !== 'undefined') canvas = document.createElement('canvas');
    else return null;
    const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) return null;
    work = { canvas, ctx };
  }
  if (work.canvas.width < w) work.canvas.width = w;
  if (work.canvas.height < h) work.canvas.height = h;
  return work;
}

/**
 * Réductions déjà faites, par image d'origine. THREE.Cache partage une même ImageBitmap entre tous les GLB qui
 * citent la même texture (même URL) : la première réduction la ferme (`close()`, largeur 0). Sans cette table,
 * les modèles suivants recevaient l'image fermée et l'envoyaient vide au GPU : façades noires (vignettes des
 * bâtiments, accessoires) en mode allégé.
 */
const reduced = new WeakMap<object, ImageData>();
/** Image d'origine d'une réduction (partage des textures entre modèles, voir capModelTextures). */
const originalOf = new WeakMap<object, object>();

/** Image réduite à `cap` px de côté au plus (même orientation), ou l'image d'origine si elle tient déjà. */
export function downscaleImage<T>(img: T, cap = imageLimits.textureCap): T | ImageData {
  if (!Number.isFinite(cap)) return img;
  if (img && typeof img === 'object') {
    const done = reduced.get(img);
    if (done) return done;
  }
  const d = dims(img);
  if (!d || (d.w <= cap && d.h <= cap)) return img;
  const s = cap / Math.max(d.w, d.h);
  const w = Math.max(1, Math.round(d.w * s)), h = Math.max(1, Math.round(d.h * s));
  const wk = workCanvas(w, h);
  if (!wk) return img;
  const { ctx } = wk;
  ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img as unknown as Img as CanvasImageSource, 0, 0, w, h);
  const out = ctx.getImageData(0, 0, w, h);
  refillTransparent(out);
  reduced.set(img as object, out);
  originalOf.set(out, img as object);
  // Libère l'original au plus tôt (ImageBitmap : mémoire décodée rendue tout de suite).
  (img as { close?: () => void }).close?.();
  return out;
}

/**
 * Le canevas 2D stocke ses pixels prémultipliés : la couleur des texels TOTALEMENT transparents est perdue (noir).
 * Les feuillages des arbres ont un fond coloré (vert dilaté autour des feuilles) justement pour que le filtrage
 * et les mipmaps ne mêlent pas de noir aux bords : réduits en mode allégé, ils sortaient cerclés de noir (arbres
 * sombres et granuleux, imposteurs compris). On rétablit ce fond : dilatation de la couleur des texels voisins sur
 * quelques pixels, puis couleur moyenne des texels opaques pour le reste.
 */
export function refillTransparent(img: ImageData, passes = 4): void {
  const { data, width: w, height: h } = img;
  let holes = 0, sr = 0, sg = 0, sb = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) holes++;
    else if (data[i + 3]! > 127) { sr += data[i]!; sg += data[i + 1]!; sb += data[i + 2]!; n++; }
  }
  if (!holes || !n) return;
  // 1 = couleur connue (texel non transparent ou déjà rempli).
  const known = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) known[p] = data[p * 4 + 3]! > 0 ? 1 : 0;
  const next = new Uint8Array(w * h);
  for (let pass = 0; pass < passes; pass++) {
    next.set(known);
    let filled = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (known[p]) continue;
        let r = 0, g = 0, b = 0, c = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w || (!dx && !dy)) continue;
            const q = yy * w + xx;
            if (!known[q]) continue;
            r += data[q * 4]!; g += data[q * 4 + 1]!; b += data[q * 4 + 2]!; c++;
          }
        }
        if (!c) continue;
        data[p * 4] = r / c; data[p * 4 + 1] = g / c; data[p * 4 + 2] = b / c;
        next[p] = 1; filled++;
      }
    }
    known.set(next);
    if (!filled) break;
  }
  const mr = sr / n, mg = sg / n, mb = sb / n;
  for (let p = 0; p < w * h; p++) if (!known[p]) { data[p * 4] = mr; data[p * 4 + 1] = mg; data[p * 4 + 2] = mb; }
}

/** Réduit en place les images des textures d'un modèle chargé (une fois par texture). */
export function capModelTextures(root: THREE.Object3D, cap = imageLimits.textureCap): void {
  if (!Number.isFinite(cap)) return;
  const seen = new Set<THREE.Texture>();
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (!m) return;
    for (const mat of Array.isArray(m) ? m : [m]) {
      const slots = mat as unknown as Record<string, unknown>;
      for (const [key, v] of Object.entries(slots)) {
        const t = v as THREE.Texture | null;
        if (!t || !t.isTexture) continue;
        // Même image d'origine et mêmes réglages qu'une texture d'un modèle déjà chargé : on réutilise celle-ci
        // (une seule copie au GPU au lieu d'une par modèle qui cite le fichier).
        const shared = canonical(t);
        if (shared !== t) { slots[key] = shared; continue; }
        if (seen.has(t)) continue;
        seen.add(t);
        const img = t.image as unknown;
        const out = downscaleImage(img, cap);
        if (out !== img) { t.image = out; t.needsUpdate = true; }
      }
    }
  });
}

/** Textures déjà réduites, par image d'origine puis par réglages d'échantillonnage et de transformation. */
const shared = new WeakMap<object, Map<string, THREE.Texture>>();

function canonical(t: THREE.Texture): THREE.Texture {
  const img = t.image as unknown;
  if (!img || typeof img !== 'object') return t;
  // Image déjà remplacée par sa réduction : on retrouve l'original par la table inverse.
  const src = originalOf.get(img as object) ?? (img as object);
  const k = [t.colorSpace, t.wrapS, t.wrapT, t.flipY, t.channel, t.offset.x, t.offset.y, t.repeat.x, t.repeat.y, t.rotation, t.center.x, t.center.y,
    t.magFilter, t.minFilter, t.premultiplyAlpha, t.generateMipmaps].join('|');
  let byKey = shared.get(src);
  if (!byKey) { byKey = new Map(); shared.set(src, byKey); }
  const c = byKey.get(k);
  if (c) return c;
  byKey.set(k, t);
  return t;
}
