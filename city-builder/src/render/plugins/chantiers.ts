/**
 * Rendu du module « Chantiers (grues, échafaudages, démolition) » — propriété de la branche p2a-chantiers.
 * Point d'entrée seulement : tout le rendu est dans src/render/construction/ (chargement des modèles,
 * pools d'instances, chantiers animés, masquage du bâtiment en cours de construction).
 */
import type { RenderPlugin, RenderPluginContext } from './types';
import { ChantiersRenderer } from '../construction';
import type { BuildingVisibilityApi } from '../construction/mask';

/** Renderer courant (exposé pour les tests e2e et la porte visuelle via `window.__aube`). */
let renderer: ChantiersRenderer | null = null;
/** Facteur de nuit fourni par le contexte de rendu (capturé à l'initialisation). */
let nightFactor: () => number = () => 0;

/** Accès au rendu des chantiers (diagnostic ; null hors partie). */
export function chantiersRenderer(): ChantiersRenderer | null { return renderer; }

export const chantiersRenderPlugin: RenderPlugin = {
  id: 'chantiers',

  async init(ctx: RenderPluginContext) {
    // API de visibilité des bâtiments si le rendu de base en publie une (demande n° 1bis) ; sinon repli.
    const visibility = (ctx as unknown as { buildings?: BuildingVisibilityApi }).buildings ?? null;
    const r = new ChantiersRenderer({
      scene: ctx.scene,
      camera: ctx.camera,
      catalog: ctx.catalog,
      url: (file) => ctx.lib.url(file),
      heightAt: ctx.heightAt,
      visibility: visibility && typeof visibility.setBuildingsVisible === 'function' ? visibility : null,
    });
    renderer = r;
    nightFactor = ctx.nightFactor;
    await r.load();
    const debug = (globalThis as { __aube?: Record<string, unknown> }).__aube;
    if (debug) debug['chantiers'] = () => r.debug();
  },

  applySnapshotExt(payload) { renderer?.applySnapshot(payload); },
  applyDeltaExt(payload) { renderer?.applyDelta(payload); },

  frame(dt) {
    const r = renderer;
    if (!r) return;
    r.setNight(nightFactor());
    r.frame(dt);
  },

  dispose() {
    renderer?.dispose();
    renderer = null;
  },
};
