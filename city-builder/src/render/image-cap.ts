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

/** Image réduite à `cap` px de côté au plus (même orientation), ou l'image d'origine si elle tient déjà. */
export function downscaleImage<T>(img: T, cap = imageLimits.textureCap): T | ImageData {
  if (!Number.isFinite(cap)) return img;
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
  // Libère l'original au plus tôt (ImageBitmap : mémoire décodée rendue tout de suite).
  (img as { close?: () => void }).close?.();
  return out;
}

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
      }
    }
  });
}
