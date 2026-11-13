/**
 * Options graphiques : qualité (résolution), ombres, distance d'affichage.
 * Mémorisées dans le navigateur (localStorage, erreurs tolérées) et appliquées pour de vrai
 * au renderer Three.js par `applyGraphicsOptions`.
 * Propriétaire : agent construction/caméra/UI.
 */
import * as THREE from 'three';
import { deviceProfile } from '../render/device-profile';

export interface GraphicsOptions {
  /** « auto » : mode allégé sur téléphone / faible mémoire (src/render/device-profile.ts), sinon moyenne. */
  quality: 'auto' | 'basse' | 'moyenne' | 'haute';
  shadows: 'off' | 'low' | 'high' | 'ultra';
  /** Distance d'affichage (m) : plan lointain de la caméra et brouillard. */
  viewDistance: number;
}

export const DEFAULT_OPTIONS: GraphicsOptions = { quality: 'auto', shadows: 'high', viewDistance: 4500 };
const KEY = 'aube-urbaine:options:v1';

export function sanitizeOptions(o: Partial<GraphicsOptions> | null | undefined): GraphicsOptions {
  const q = o?.quality;
  const s = o?.shadows;
  const d = Number(o?.viewDistance);
  return {
    quality: q === 'auto' || q === 'basse' || q === 'moyenne' || q === 'haute' ? q : DEFAULT_OPTIONS.quality,
    shadows: s === 'off' || s === 'low' || s === 'high' || s === 'ultra' ? s : DEFAULT_OPTIONS.shadows,
    viewDistance: Number.isFinite(d) ? Math.min(8000, Math.max(1500, d)) : DEFAULT_OPTIONS.viewDistance,
  };
}

export function loadOptions(): GraphicsOptions {
  try { return sanitizeOptions(JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<GraphicsOptions> | null); } catch { return { ...DEFAULT_OPTIONS }; }
}

export function saveOptions(o: GraphicsOptions): void {
  try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* navigation privée : réglage non mémorisé */ }
}

export const SHADOW_SIZE: Record<GraphicsOptions['shadows'], number> = { off: 0, low: 1024, high: 2048, ultra: 4096 };

export interface GraphicsTargets {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  sun?: THREE.DirectionalLight;
  /** Contrôleur de caméra : reçoit la distance d'affichage (plan lointain). */
  camera?: { viewDistance: number };
}

export function applyGraphicsOptions(o: GraphicsOptions, t: GraphicsTargets): void {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const prof = deviceProfile(o.quality);
  const ratio = o.quality === 'basse' ? Math.min(dpr, 1) * 0.75 : o.quality === 'haute' ? Math.min(dpr, 2) : Math.min(dpr, prof.lite ? prof.maxPixelRatio : 1.5);
  t.renderer.setPixelRatio(ratio);
  const size = new THREE.Vector2();
  t.renderer.getSize(size);
  t.renderer.setSize(size.x, size.y, false);
  // Mode allégé : carte d'ombre plafonnée (mémoire graphique des téléphones).
  const sz = prof.lite ? Math.min(SHADOW_SIZE[o.shadows], prof.shadowSize) : SHADOW_SIZE[o.shadows];
  t.renderer.shadowMap.enabled = sz > 0;
  if (t.sun) {
    t.sun.castShadow = sz > 0;
    if (sz > 0 && t.sun.shadow.mapSize.x !== sz) {
      t.sun.shadow.mapSize.set(sz, sz);
      t.sun.shadow.map?.dispose();
      t.sun.shadow.map = null;
    }
  }
  // Les matériaux doivent recompiler leurs shaders quand les ombres changent.
  t.scene.traverse((obj) => {
    const m = (obj as THREE.Mesh).material;
    if (!m) return;
    for (const mat of Array.isArray(m) ? m : [m]) mat.needsUpdate = true;
  });
  if (t.camera) t.camera.viewDistance = o.viewDistance;
  if (t.scene.fog instanceof THREE.Fog) {
    t.scene.fog.far = o.viewDistance;
    t.scene.fog.near = o.viewDistance * 0.33;
  }
}
