/**
 * Options graphiques : qualité (résolution), ombres, distance d'affichage ; navigation (pavé tactile / souris,
 * glissement au bord de l'écran).
 * Mémorisées dans le navigateur (localStorage, erreurs tolérées) et appliquées pour de vrai
 * au renderer Three.js par `applyGraphicsOptions`.
 * Propriétaire : agent construction/caméra/UI.
 */
import * as THREE from 'three';
import { deviceProfile } from '../render/device-profile';
import { setColorMode } from '../render/palette';

export interface GraphicsOptions {
  /** « auto » : mode allégé sur téléphone / faible mémoire (src/render/device-profile.ts), sinon moyenne. */
  quality: 'auto' | 'basse' | 'moyenne' | 'haute';
  shadows: 'off' | 'low' | 'high' | 'ultra';
  /** Distance d'affichage (m) : plan lointain de la caméra et brouillard. */
  viewDistance: number;
  /** Images par seconde maximales : « auto » = 60 sur téléphone, sans limite ailleurs. */
  fps: 'auto' | '30' | '60' | 'max';
  /** Thème de l'interface : nuit (bleu nuit, par défaut), clair (verre dépoli) ou sombre (thème d'origine). */
  theme: 'nuit' | 'clair' | 'sombre';
  /**
   * Résolution dynamique (ordinateur) : seule la résolution de la 3D baisse pour tenir la cadence de l'écran
   * (interface toujours nette), jusqu'à 0,6 × la densité de la qualité choisie. « auto » : activée en qualité Auto.
   */
  dynRes: 'auto' | 'on' | 'off';
  /**
   * Anticrénelage (MSAA ×4 du contexte WebGL, appliqué au prochain chargement). « auto » : désactivé sur ordinateur
   * quand la densité de rendu est ≥ 1,25 (pixels déjà fins ; c'était le coût dominant mesuré sur processeur
   * graphique intégré), activé sinon ; téléphone : inchangé (activé).
   */
  aa: 'auto' | 'on' | 'off';
  /** Événements de la ville (canicule, épidémie…, docs/PROGRESSION.md) : fréquence, envoyée à la simulation. */
  events: 'normal' | 'rares' | 'off';
  /**
   * Navigation : périphérique des gestes de défilement. « auto » : pavé tactile ou molette détecté à chaque session
   * de défilement (src/input/camera.ts, `WheelClassifier`) ; « touchpad » : deux doigts = déplacer ; « mouse » : molette = zoom.
   */
  pointer: 'auto' | 'touchpad' | 'mouse';
  /** Navigation : glissement de la carte quand le curseur touche le bord de la fenêtre (désactivé par défaut). */
  edgeScroll: boolean;
  /** Couleurs du rendu : vives (direction artistique actuelle, par défaut) ou naturelles (ancien rendu), src/render/palette.ts. */
  colors: 'vives' | 'naturelles';
}

export const DEFAULT_OPTIONS: GraphicsOptions = { quality: 'auto', shadows: 'high', viewDistance: 4500, fps: 'auto', theme: 'nuit', dynRes: 'auto', aa: 'auto', events: 'normal', pointer: 'auto', edgeScroll: false, colors: 'vives' };

/** Applique le thème de l'interface (attribut lu par les feuilles de style). */
export function applyTheme(t: GraphicsOptions['theme']): void {
  if (typeof document !== 'undefined') document.documentElement.dataset['theme'] = t;
}
const KEY = 'aube-urbaine:options:v1';

export function sanitizeOptions(o: Partial<GraphicsOptions> | null | undefined): GraphicsOptions {
  const q = o?.quality;
  const s = o?.shadows;
  const d = Number(o?.viewDistance);
  return {
    quality: q === 'auto' || q === 'basse' || q === 'moyenne' || q === 'haute' ? q : DEFAULT_OPTIONS.quality,
    shadows: s === 'off' || s === 'low' || s === 'high' || s === 'ultra' ? s : DEFAULT_OPTIONS.shadows,
    viewDistance: Number.isFinite(d) ? Math.min(8000, Math.max(1500, d)) : DEFAULT_OPTIONS.viewDistance,
    fps: o?.fps === '30' || o?.fps === '60' || o?.fps === 'max' || o?.fps === 'auto' ? o.fps : DEFAULT_OPTIONS.fps,
    theme: o?.theme === 'sombre' || o?.theme === 'clair' || o?.theme === 'nuit' ? o.theme : DEFAULT_OPTIONS.theme,
    dynRes: o?.dynRes === 'on' || o?.dynRes === 'off' || o?.dynRes === 'auto' ? o.dynRes : DEFAULT_OPTIONS.dynRes,
    aa: o?.aa === 'on' || o?.aa === 'off' || o?.aa === 'auto' ? o.aa : DEFAULT_OPTIONS.aa,
    events: o?.events === 'normal' || o?.events === 'rares' || o?.events === 'off' ? o.events : DEFAULT_OPTIONS.events,
    pointer: o?.pointer === 'auto' || o?.pointer === 'touchpad' || o?.pointer === 'mouse' ? o.pointer : DEFAULT_OPTIONS.pointer,
    edgeScroll: typeof o?.edgeScroll === 'boolean' ? o.edgeScroll : DEFAULT_OPTIONS.edgeScroll,
    colors: o?.colors === 'vives' || o?.colors === 'naturelles' ? o.colors : DEFAULT_OPTIONS.colors,
  };
}

/** Qualité imposée par l'adresse (`?qualite=haute|moyenne|basse|auto`, page de mesure) : prioritaire, jamais mémorisée seule. */
export function urlQuality(search = typeof location !== 'undefined' ? location.search : ''): GraphicsOptions['quality'] | null {
  const q = new URLSearchParams(search).get('qualite');
  return q === 'auto' || q === 'basse' || q === 'moyenne' || q === 'haute' ? q : null;
}

/** Résolution dynamique imposée par l'adresse (`?dyn=1|0`, page de mesure), jamais mémorisée seule. */
export function urlDynRes(search = typeof location !== 'undefined' ? location.search : ''): GraphicsOptions['dynRes'] | null {
  const d = new URLSearchParams(search).get('dyn');
  return d === '1' ? 'on' : d === '0' ? 'off' : null;
}

/** Résolution dynamique effective (option « auto » : activée en qualité Auto). */
export function dynResEnabled(o: Pick<GraphicsOptions, 'quality' | 'dynRes'>): boolean {
  return o.dynRes === 'on' || (o.dynRes === 'auto' && o.quality === 'auto');
}

/** Ombres imposées par l'adresse (`?ombres=off|low|high|ultra`, page de mesure), jamais mémorisées seules. */
export function urlShadows(search = typeof location !== 'undefined' ? location.search : ''): GraphicsOptions['shadows'] | null {
  const s = new URLSearchParams(search).get('ombres');
  return s === 'off' || s === 'low' || s === 'high' || s === 'ultra' ? s : null;
}

/** Anticrénelage imposé par l'adresse (`?msaa=1|0`, page de mesure), jamais mémorisé seul. */
export function urlAa(search = typeof location !== 'undefined' ? location.search : ''): GraphicsOptions['aa'] | null {
  const a = new URLSearchParams(search).get('msaa');
  return a === '1' ? 'on' : a === '0' ? 'off' : null;
}

/** Rapport de pixels de départ d'une qualité (avant résolution dynamique). */
export function baseRatio(quality: GraphicsOptions['quality'], dpr: number, lite: boolean, liteMax: number): number {
  return quality === 'basse' ? Math.min(dpr, 1) : quality === 'haute' ? Math.min(dpr, 2) : Math.min(dpr, lite ? liteMax : 1.5);
}

/** MSAA du contexte : « auto » = sur ordinateur, seulement si la densité de rendu est < 1,25 ; téléphone : toujours. */
export function wantMsaa(o: Pick<GraphicsOptions, 'quality' | 'aa'>, dpr: number, lite: boolean, liteMax = 1.5): boolean {
  if (o.aa !== 'auto') return o.aa === 'on';
  if (lite) return true;
  return baseRatio(o.quality, dpr, lite, liteMax) < 1.25;
}

export function loadOptions(): GraphicsOptions {
  let o: GraphicsOptions;
  try { o = sanitizeOptions(JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<GraphicsOptions> | null); } catch { o = { ...DEFAULT_OPTIONS }; }
  const q = urlQuality(), d = urlDynRes(), sh = urlShadows(), aa = urlAa();
  if (q) o = { ...o, quality: q };
  if (aa) o = { ...o, aa };
  if (d) o = { ...o, dynRes: d };
  if (sh) o = { ...o, shadows: sh };
  return o;
}

export function saveOptions(o: GraphicsOptions): void {
  try {
    // Qualité imposée par l'adresse : la qualité mémorisée du joueur reste celle d'avant.
    const q = urlQuality(), d = urlDynRes(), sh = urlShadows(), aa = urlAa();
    const stored = sanitizeOptions(JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<GraphicsOptions> | null);
    if (q && o.quality === q) o = { ...o, quality: stored.quality };
    if (d && o.dynRes === d) o = { ...o, dynRes: stored.dynRes };
    if (sh && o.shadows === sh) o = { ...o, shadows: stored.shadows };
    if (aa && o.aa === aa) o = { ...o, aa: stored.aa };
    localStorage.setItem(KEY, JSON.stringify(o));
  } catch { /* navigation privée : réglage non mémorisé */ }
}

export const SHADOW_SIZE: Record<GraphicsOptions['shadows'], number> = { off: 0, low: 1024, high: 2048, ultra: 4096 };

export interface GraphicsTargets {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  sun?: THREE.DirectionalLight;
  /** Contrôleur de caméra : reçoit la distance d'affichage (plan lointain) et les réglages de navigation. */
  camera?: { viewDistance: number; inputPref?: GraphicsOptions['pointer']; edgeScroll?: boolean };
  /** Cadence du rendu (src/render/scene.ts) : plafond d'images, ombres, résolution adaptative. */
  perf?: { maxFps: number; shadowEvery: number; adaptive: { min: number; max: number } | null; ratio: number };
}

/**
 * Ordinateur, résolution dynamique : plage du rapport de pixels de la 3D. Plancher 0,6 × la densité de la qualité
 * choisie ; plafond = cette densité (qualité Auto : jusqu'à 2 sur écran Retina / 4K, comme avant).
 */
export function desktopDynamic(quality: GraphicsOptions['quality'], ratio: number, dpr: number): { min: number; max: number } | null {
  const max = quality === 'auto' ? Math.max(ratio, Math.min(dpr, 2)) : ratio;
  const min = Math.max(0.5, Math.round(ratio * 0.6 * 20) / 20);
  return max - min > 1e-3 ? { min, max } : null;
}

export function applyGraphicsOptions(o: GraphicsOptions, t: GraphicsTargets): void {
  applyTheme(o.theme);
  setColorMode(o.colors);
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const prof = deviceProfile(o.quality);
  // Basse : 1 pixel par point au plus (0,75 rendait l'image trop floue) ; la résolution adaptative remonte au-delà si l'appareil suit.
  const ratio = baseRatio(o.quality, dpr, prof.lite, prof.maxPixelRatio);
  t.renderer.setPixelRatio(ratio);
  if (t.perf) {
    t.perf.maxFps = o.fps === '30' ? 30 : o.fps === '60' ? 60 : o.fps === 'max' ? 0 : prof.lite ? 60 : 0;
    // Téléphone : ombres recalculées au plus 1 image sur 4 tant que rien ne bouge autour du soleil.
    t.perf.shadowEvery = prof.lite ? 4 : 1;
    // Téléphone : résolution qui monte quand l'appareil suit (plafond prudent : 1,25 en auto/basse, 1,5 en moyenne).
    t.perf.adaptive = prof.lite
      ? (o.quality !== 'haute' ? { min: ratio, max: Math.min(dpr, o.quality === 'moyenne' ? 1.5 : 1.25) } : null)
      : dynResEnabled(o) ? desktopDynamic(o.quality, ratio, dpr) : null;
    t.perf.ratio = ratio;
  }
  const size = new THREE.Vector2();
  t.renderer.getSize(size);
  t.renderer.setSize(size.x, size.y, false);
  // Mode allégé : carte d'ombre plafonnée (mémoire graphique des téléphones).
  const sz = prof.lite ? Math.min(SHADOW_SIZE[o.shadows], prof.shadowSize) : SHADOW_SIZE[o.shadows];
  // Recompilation des shaders seulement si l'état des ombres change (un changement de thème, purement CSS, ou de
  // distance de vue ne doit pas recompiler toute la scène).
  const shadowsChanged = t.renderer.shadowMap.enabled !== sz > 0 || (!!t.sun && t.sun.castShadow !== sz > 0);
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
  if (shadowsChanged) t.scene.traverse((obj) => {
    const m = (obj as THREE.Mesh).material;
    if (!m) return;
    for (const mat of Array.isArray(m) ? m : [m]) mat.needsUpdate = true;
  });
  if (t.camera) {
    t.camera.viewDistance = o.viewDistance;
    if ('inputPref' in t.camera) t.camera.inputPref = o.pointer;
    if ('edgeScroll' in t.camera) t.camera.edgeScroll = o.edgeScroll;
  }
  if (t.scene.fog instanceof THREE.Fog) {
    t.scene.fog.far = o.viewDistance;
    t.scene.fog.near = o.viewDistance * 0.33;
  }
}
