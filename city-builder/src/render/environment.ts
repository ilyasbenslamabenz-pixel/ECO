/**
 * Environnement : ciel, brouillard, éclairage d'ambiance.
 * Version de fondation : ciel physique procédural (addon Sky de three).
 * À enrichir par l'agent terrain/environnement : HDRI Poly Haven (CC0), cycle jour/nuit.
 */
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import type { RenderContext } from './scene';

export interface EnvironmentHandle {
  sky: Sky;
  /** Oriente le soleil (élévation et azimut en degrés). */
  setSun(elevationDeg: number, azimuthDeg: number): void;
  /** Recentre la caméra d'ombre du soleil sur un point (suivi de la caméra). */
  follow(x: number, z: number): void;
  dispose(): void;
}

export function initEnvironment(ctx: RenderContext): EnvironmentHandle {
  const sky = new Sky();
  sky.scale.setScalar(10000);
  const u = sky.material.uniforms;
  u['turbidity']!.value = 6;
  u['rayleigh']!.value = 1.6;
  u['mieCoefficient']!.value = 0.004;
  u['mieDirectionalG']!.value = 0.85;
  ctx.scene.add(sky);
  ctx.scene.background = null;

  const sunDir = new THREE.Vector3();
  const pmrem = new THREE.PMREMGenerator(ctx.renderer);
  let envRT: THREE.WebGLRenderTarget | null = null;
  const envScene = new THREE.Scene();
  const envSky = new Sky();
  envSky.scale.setScalar(1000);
  envScene.add(envSky);

  const setSun = (elev: number, azim: number): void => {
    const phi = THREE.MathUtils.degToRad(90 - elev);
    const theta = THREE.MathUtils.degToRad(azim);
    sunDir.setFromSphericalCoords(1, phi, theta);
    u['sunPosition']!.value.copy(sunDir);
    // Carte d'environnement (réflexions PBR) dérivée du même ciel.
    const eu = envSky.material.uniforms;
    for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG'] as const) eu[k]!.value = u[k]!.value;
    eu['sunPosition']!.value.copy(sunDir);
    envRT?.dispose();
    envRT = pmrem.fromScene(envScene as unknown as THREE.Scene);
    ctx.scene.environment = envRT.texture;
    ctx.scene.environmentIntensity = 0.35;
    ctx.sun.position.copy(ctx.sun.target.position).addScaledVector(sunDir, 800);
  };
  setSun(38, 140);

  return {
    sky,
    setSun,
    follow(x, z) {
      ctx.sun.target.position.set(x, 0, z);
      ctx.sun.position.set(x, 0, z).addScaledVector(sunDir, 800);
      ctx.sun.target.updateMatrixWorld();
    },
    dispose() { envRT?.dispose(); pmrem.dispose(); ctx.scene.remove(sky); },
  };
}
