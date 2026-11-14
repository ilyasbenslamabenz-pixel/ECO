/**
 * Plafond des images en mode allégé (téléphone) : chaque image de texture est réduite DÈS SON CHARGEMENT
 * (et non seulement à l'envoi au GPU), puis l'original est libéré. Sur iPhone, une ville entière décodée en
 * pleine taille côté CPU suffisait à faire planter Safari au chargement.
 * Réglé une fois au démarrage (main.ts) avant tout chargement ; Infinity = images d'origine.
 */
import type * as THREE from 'three';
import { Cache, Source } from 'three';

export const imageLimits = {
  /** Côté maximal (px) des images de texture gardées en mémoire (modèles). */
  textureCap: Infinity,
  /** Idem pour les arbres (feuillage alpha, plus sensible à la réduction). */
  treeTextureCap: Infinity,
  /** Nombre maximal de modèles GLB chargés en même temps. */
  maxConcurrentModels: Infinity,
};

/**
 * Mode allégé : adresse de la version 256 px d'une texture (`x.webp` -> `x.256.webp`, générée au build,
 * scripts/build.mjs). Le téléphone ne décode jamais l'image 1024 px : une maison neuve en demandait 27 d'un
 * coup (~110 Mo décodés) avant leur réduction, et Safari iPhone fermait la page à l'ouverture de l'outil
 * Bâtiments. Seules les textures communes (assets/textures, assets/buildings) ont une version réduite.
 */
export function liteTextureUrl(url: string): string {
  if (imageLimits.textureCap > 256) return url;
  if (!/\/assets\/(textures|buildings)\/.*\.webp(\?|$)/.test(url) || /\.256\.webp/.test(url)) return url;
  return url.replace(/\.webp(?=\?|$)/, '.256.webp');
}

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

/** Image réduite à `cap` px de côté au plus (même orientation), ou l'image d'origine si elle tient déjà. */
/**
 * Images déjà réduites, par image d'origine. THREE.Cache est activé : plusieurs modèles reçoivent la MÊME
 * ImageBitmap pour une texture commune (atlas). L'original étant libéré après réduction, les suivants
 * recevaient une image détachée (« ImageBitmap has been detached » dans WebKit) : ils reprennent ici la
 * version réduite.
 */
const reduced = new WeakMap<object, ImageData>();

export function downscaleImage<T>(img: T, cap = imageLimits.textureCap): T | ImageData {
  if (!Number.isFinite(cap)) return img;
  if (img && typeof img === 'object') { const r = reduced.get(img as object); if (r) return r; }
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
  reduced.set(img as object, out);
  // Le cache de three rend désormais la version réduite aux chargements suivants (même texture commune).
  const files = (Cache as unknown as { files: Record<string, unknown> }).files;
  for (const k of Object.keys(files)) if (files[k] === img) files[k] = out;
  // Libère l'original au plus tôt (ImageBitmap : mémoire décodée rendue tout de suite) : plus personne ne
  // peut le recevoir (cache remplacé, réductions suivantes servies par `reduced`).
  (img as { close?: () => void }).close?.();
  return out;
}

const sharedSources = new WeakMap<ImageData, Source<unknown>>();

/** Réduit en place les images des textures d'un modèle chargé (une fois par texture). */
export function capModelTextures(root: THREE.Object3D, cap = imageLimits.textureCap): void {
  if (!Number.isFinite(cap)) return;
  const seen = new Set<THREE.Texture>();
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (!m) return;
    for (const mat of Array.isArray(m) ? m : [m]) {
      for (const v of Object.values(mat)) {
        const t = v as THREE.Texture | null;
        if (!t || !t.isTexture || seen.has(t)) continue;
        seen.add(t);
        const img = t.image as unknown;
        const out = downscaleImage(img, cap);
        if (out !== img) { t.image = out; t.needsUpdate = true; }
        // Même image réduite (texture commune à plusieurs modèles) = une seule copie sur le GPU : three
        // partage la texture WebGL entre textures de même Source (et mêmes réglages).
        if (typeof ImageData !== 'undefined' && t.image instanceof ImageData) {
          const key = t.image as ImageData;
          const own = t.source as unknown as Source<unknown>;
          const src = sharedSources.get(key);
          if (!src) sharedSources.set(key, own);
          else if (own !== src) (t as unknown as { source: Source<unknown> }).source = src;
        }
      }
    }
  });
}
