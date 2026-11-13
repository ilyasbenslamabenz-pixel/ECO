/**
 * Câblage de la construction : miroir de la simulation, machine à états des outils, aperçus 3D,
 * barre de construction illustrée, panneaux, collisions de la caméra rue.
 * L'agent intégration n'a qu'à appeler, dans main.ts, après la création du pont et de l'UI :
 *
 *   const cons = initConstruction({ sim: bridge, ui, input, scene: render.ctx.scene,
 *     models: lib, catalog, heightAt: (x, z) => render.terrain.heightAt(x, z) });
 *   render.ctx.onFrame.push((dt) => cons.update(dt));
 *
 * (voir docs/requests/construction-ui.md). Tout passe par des commandes au worker.
 * Propriétaire : agent construction/caméra/UI.
 */
import type * as THREE from 'three';
import type { AssetCatalog } from '../shared/catalog';
import { WorldMirror } from '../client/tools/mirror';
import { ConstructionTools, type SimPort } from '../client/tools/machine';
import type { UIHandle } from '../ui/hud';
import { ThumbnailRenderer, type ThumbnailSource } from '../ui/thumbnails';
import type { InputHandle } from './index';
import type { ModelSource } from './previews';

export interface ConstructionOptions {
  sim: SimPort;
  ui: UIHandle;
  input: InputHandle;
  scene: THREE.Scene;
  models: ModelSource;
  catalog: AssetCatalog;
  heightAt: (x: number, z: number) => number;
  /** Vignettes : fournies, ou rendues à la demande depuis `models` (défaut). `null` = sans vignettes. */
  thumbs?: ThumbnailSource | null;
  /** Renderer principal, partagé par les vignettes (aucun contexte WebGL supplémentaire). */
  renderer?: THREE.WebGLRenderer;
  /** Mode allégé (téléphone) : vignettes 128×96 tirées du LOD le plus léger. */
  lite?: boolean;
}

export interface ConstructionHandle {
  mirror: WorldMirror;
  machine: ConstructionTools;
  thumbs: ThumbnailSource | null;
  update(dt: number): void;
}

export function initConstruction(o: ConstructionOptions): ConstructionHandle {
  const mirror = new WorldMirror(o.catalog);
  o.sim.onSnapshot((s) => { mirror.applySnapshot(s); o.ui.resetFinance(); });
  o.sim.onDelta((d) => mirror.applyDelta(d));
  const machine = new ConstructionTools(mirror, o.sim, (t, k) => o.ui.toast(t, k));
  // Mode allégé : 192×144 (128×96 paraissait flou, étiré dans le panneau d'information d'un écran 3×) ; le
  // modèle reste le plus léger et ses textures sont libérées après la vignette.
  const thumbs = o.thumbs === undefined
    ? new ThumbnailRenderer(o.models, { renderer: o.renderer ?? null, ...(o.lite ? { width: 192, height: 144, lod: Infinity, releaseAfter: true } : {}) })
    : o.thumbs;
  const { camera, tools } = o.input;
  tools.attach({ scene: o.scene, camera, machine, models: o.models, heightAt: o.heightAt }, o.ui.toolHooks());
  // Caméra rue : on ne traverse pas les bâtiments (marge de 0,4 m).
  camera.isBlocked = (x, z) => {
    for (const b of mirror.buildings.values()) {
      const r = mirror.buildingRect(b);
      if (r && x > r.minX - 0.4 && x < r.maxX + 0.4 && z > r.minZ - 0.4 && z < r.maxZ + 0.4) return true;
    }
    return false;
  };
  o.ui.enableConstruction({ mirror, machine, tools, camera, thumbs });
  return { mirror, machine, thumbs, update: (dt) => tools.update(dt) };
}
