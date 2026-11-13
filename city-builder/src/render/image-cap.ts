/**
 * Plafond des images en mode allégé (téléphone) : chaque image de texture est réduite DÈS SON CHARGEMENT
 * (et non seulement à l'envoi au GPU), puis l'original est libéré. Sur iPhone, une ville entière décodée en
 * pleine taille côté CPU suffisait à faire planter Safari au chargement.
 * Réglé une fois au démarrage (main.ts) avant tout chargement ; Infinity = images d'origine.
 */
import type * as THREE from 'three';

export const imageLimits = {
  /** Côté maximal (px) des images de texture gardées en mémoire. */
  textureCap: Infinity,
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

/** Image réduite à `cap` px de côté au plus (même orientation), ou l'image d'origine si elle tient déjà. */
export function downscaleImage<T>(img: T, cap = imageLimits.textureCap): T | HTMLCanvasElement | OffscreenCanvas {
  if (!Number.isFinite(cap)) return img;
  const d = dims(img);
  if (!d || (d.w <= cap && d.h <= cap)) return img;
  const s = cap / Math.max(d.w, d.h);
  const w = Math.max(1, Math.round(d.w * s)), h = Math.max(1, Math.round(d.h * s));
  let canvas: HTMLCanvasElement | OffscreenCanvas;
  if (typeof OffscreenCanvas !== 'undefined') canvas = new OffscreenCanvas(w, h);
  else if (typeof document !== 'undefined') { canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h; }
  else return img;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) return img;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img as unknown as Img as CanvasImageSource, 0, 0, w, h);
  // Libère l'original au plus tôt (ImageBitmap : mémoire décodée rendue tout de suite).
  (img as { close?: () => void }).close?.();
  return canvas;
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
