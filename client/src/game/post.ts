// Rendu cinématographique : pipeline de post-traitement (HDR, bloom, étalonnage chaud, vignettage, anticrénelage,
// occlusion ambiante en qualité haute) et réglage de l'heure (heure dorée par défaut, comme l'image de référence).
import { Color4, ColorCurves, DefaultRenderingPipeline, ImageProcessingConfiguration, SSAO2RenderingPipeline, type Camera, type Scene } from '@babylonjs/core';
import type { Quality, TimeMode } from '../store';
import { ENV } from './terrain';

export type { TimeMode };

/** Position du soleil dans la journée (0 = minuit, 0,5 = midi) selon le mode d'heure choisi. */
export function timeOfDay(mode: TimeMode, elapsedSec: number, dayLength: number): number {
  if (mode === 'golden') return 0.7228 + Math.sin(elapsedSec * 0.05) * 0.002; // soleil à ~10° au-dessus de l'horizon : lumière rasante dorée, ombres longues, la ville commence à s'allumer
  if (mode === 'day') return 0.56;
  if (mode === 'night') return 0.93;
  return ((elapsedSec / dayLength) + 0.35) % 1;
}

/** Courbes d'étalonnage : hautes lumières dorées, ombres bleutées (contraste chaud/froid de l'heure dorée). */
function gradeCurves() {
  const c = new ColorCurves();
  c.globalSaturation = 14;
  c.highlightsHue = 38;
  c.highlightsDensity = 32;
  c.highlightsSaturation = 38;
  c.midtonesHue = 30;
  c.midtonesDensity = 6;
  c.shadowsHue = 220;
  c.shadowsDensity = 18;
  c.shadowsSaturation = 22;
  c.shadowsExposure = 0;
  return c;
}

export function createPostProcessing(scene: Scene, camera: Camera, quality: Quality) {
  if (quality === 'low') {
    // qualité basse : étalonnage appliqué directement dans les matériaux (aucune passe supplémentaire)
    const ipc = scene.imageProcessingConfiguration;
    ipc.toneMappingEnabled = true;
    ipc.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    ipc.exposure = 1.08;
    ipc.contrast = 1.12;
    ipc.colorCurvesEnabled = true;
    ipc.colorCurves = gradeCurves();
    return { update: () => { ipc.exposure = 1.08 + ENV.night * 0.12; }, dispose: () => {} };
  }
  const p = new DefaultRenderingPipeline('cine', true, scene, [camera]);
  p.samples = quality === 'high' ? 4 : 1;
  p.fxaaEnabled = quality !== 'high';
  p.bloomEnabled = true;
  p.bloomKernel = 64;
  p.bloomScale = 0.5;
  p.bloomWeight = 0.35;
  p.bloomThreshold = 0.8;
  p.imageProcessingEnabled = true;
  const ip = p.imageProcessing;
  ip.toneMappingEnabled = true;
  ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
  ip.exposure = 1.08;
  ip.contrast = 1.2;
  ip.vignetteEnabled = true;
  ip.vignetteWeight = 1.3;
  ip.vignetteStretch = 0.3;
  ip.vignetteColor = new Color4(0.1, 0.04, 0.02, 0);
  ip.colorCurvesEnabled = true;
  ip.colorCurves = gradeCurves();
  p.sharpenEnabled = quality === 'high';
  if (p.sharpenEnabled) p.sharpen.edgeAmount = 0.25;
  let ssao: SSAO2RenderingPipeline | null = null;
  if (quality === 'high') {
    ssao = new SSAO2RenderingPipeline('ssao', scene, { ssaoRatio: 0.5, blurRatio: 0.5 }, [camera]);
    ssao.radius = 0.02;
    ssao.totalStrength = 1.1;
    ssao.samples = 16;
    ssao.maxZ = 60;
  }
  return {
    update: () => {
      // bloom réservé aux vraies sources (soleil, reflets, fenêtres, lampadaires) : seuil haut, pas de voile laiteux
      p.bloomWeight = 0.28 + ENV.night * 0.22;
      p.bloomThreshold = 0.82 - ENV.night * 0.12;
      ip.exposure = 1.08 + ENV.night * 0.15;
    },
    dispose: () => { p.dispose(); ssao?.dispose(); },
  };
}
