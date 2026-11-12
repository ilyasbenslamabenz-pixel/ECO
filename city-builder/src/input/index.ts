/**
 * Point d'entrée du module entrées : caméra + outils.
 * `initInput` garde la signature de la fondation ; les outils de construction s'activent
 * ensuite avec `initConstruction()` (./construction.ts).
 */
import type * as THREE from 'three';
import { CameraController } from './camera';
import { ToolController } from './tools';

export { initConstruction, type ConstructionHandle, type ConstructionOptions } from './construction';

export interface InputHandle {
  camera: CameraController;
  tools: ToolController;
}

export function initInput(camera: THREE.PerspectiveCamera, dom: HTMLElement, heightAt: (x: number, z: number) => number): InputHandle {
  return { camera: new CameraController(camera, dom, heightAt), tools: new ToolController() };
}
