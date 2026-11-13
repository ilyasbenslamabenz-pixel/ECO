/**
 * Module de RENDU « Électricité » (phase 2B, sous-étape 4) — propriété de la branche p2b-electricite.
 * Rotors animés, pylônes et câbles des lignes HT, calque « réseau électrique » : src/render/power/renderer.ts.
 * Les centrales, éoliennes (mâts), fermes solaires, barrages et postes sont des bâtiments du catalogue dessinés
 * par le rendu de base. L'état reçu est fusionné dans `powerView` (src/shared/power/view.ts), partagé avec le panneau.
 *
 * Tant que l'interface ne monte pas les panneaux du registre UI_PANELS (§1bis), ce module installe le lanceur du
 * panneau Énergie (bouton « ⚡ Énergie ») : voir `mountElectriciteLauncher` dans src/ui/panels/electricite.ts.
 */
import type { ElectriciteDelta } from '../../shared/power/types';
import { powerView } from '../../shared/power/view';
import { PowerRenderer } from '../power/renderer';
import { mountElectriciteLauncher } from '../../ui/panels/electricite';
import type { RenderPlugin } from './types';

const renderer = new PowerRenderer();

declare global { interface Window { __electricite?: { debug(): unknown; view: typeof powerView } } }

export const electriciteRenderPlugin: RenderPlugin = {
  id: 'electricite',
  async init(ctx) {
    if (typeof window !== 'undefined') {
      window.__electricite = { debug: () => renderer.debug(), view: powerView };
      mountElectriciteLauncher();
    }
    await renderer.init(ctx);
  },
  applySnapshotExt(payload) {
    powerView.reset(payload as ElectriciteDelta | undefined);
    renderer.apply(powerView.state);
  },
  applyDeltaExt(payload) {
    powerView.merge(payload as ElectriciteDelta);
    renderer.apply(powerView.state);
  },
  frame(dt) { renderer.frame(dt); },
  dispose() { renderer.dispose(); },
};
