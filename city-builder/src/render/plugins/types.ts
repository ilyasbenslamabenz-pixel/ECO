/**
 * Points d'extension du RENDU (phase 2, §0 de docs/ROADMAP_PHASE2.md).
 *
 * Un module de phase 2 ajoute son rendu sous la forme d'un `RenderPlugin` déclaré dans SON fichier
 * `src/render/plugins/<module>.ts` (enregistré une fois dans `./index.ts`). `initRender` (src/render/index.ts) :
 *  - appelle `init(ctx)` une fois, après la création des systèmes de base (attendu s'il renvoie une promesse) ;
 *  - à chaque instantané : `applySnapshotExt(snapshot.ext?.[id])` — TOUJOURS appelé, avec `undefined` si le
 *    module de simulation n'a rien envoyé (le rendu du module doit alors se vider) ;
 *  - à chaque delta portant `delta.ext[id]` : `applyDeltaExt(payload)` ;
 *  - à chaque image (boucle ou `renderNow`) : `frame(dt)` après les systèmes de base ;
 *  - `dispose()` à la destruction du rendu (`RenderHandle.disposePlugins`).
 * Le rendu ne modifie JAMAIS l'état du jeu. Les exceptions sont attrapées et journalisées (console.error, une
 * fois par module et par crochet) : un module en erreur ne casse ni l'image ni les autres modules.
 * Types des charges utiles : src/shared/protocol-ext/<module>.ts (`deltaExt` / `snapshotExt`).
 */
import type * as THREE from 'three';
import type { AssetCatalog } from '../../shared/catalog';
import type { AssetLibrary } from '../assets';

export interface RenderPluginContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  /** Lumière du soleil (ombres) : lecture seule pour les modules. */
  sun: THREE.DirectionalLight;
  catalog: AssetCatalog;
  /** Bibliothèque de modèles GLB (cache + dédoublonnage + LOD). */
  lib: AssetLibrary;
  /** Hauteur du terrain rendu en (x, z). */
  heightAt(x: number, z: number): number;
  /** Facteur de nuit courant (0 jour .. 1 nuit), mis à jour avec l'heure simulée. */
  nightFactor(): number;
  /** Végétation du terrain : dégagement d'une emprise (rectangle orienté, angle en radians). Facultatif. */
  vegetation?: { removeInFootprint(cx: number, cz: number, halfW: number, halfD: number, angle: number, margin?: number): number };
}

export interface RenderPlugin {
  /** Même identifiant que le module de simulation (clé de `ext`). */
  readonly id: string;
  init?(ctx: RenderPluginContext): void | Promise<void>;
  applySnapshotExt?(payload: unknown): void;
  applyDeltaExt?(payload: unknown): void;
  frame?(dt: number): void;
  dispose?(): void;
}
