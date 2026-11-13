/**
 * Rendu du module « Circulation (véhicules, feux) » — propriété de la branche p2a-circulation.
 *
 * Reçoit `snapshot.ext.circulation` / `delta.ext.circulation` (types dans src/shared/protocol-ext/circulation.ts)
 * et entretient la CARTE DE CONGESTION (src/render/traffic/congestion.ts) : géométrie reconstruite à chaque
 * changement de réseau, couleurs mises à jour ≈ 1/s, affichage commandé par le panneau d'interface.
 * Les véhicules et les feux restent dessinés par les systèmes de base (src/render/vehicles, src/render/traffic).
 * Exceptions attrapées par l'hôte : un module en erreur ne casse ni l'image ni les autres modules.
 */
import { snapshotExt, type CirculationDelta, type CirculationSnapshot } from '../../shared/protocol-ext';
import { CongestionOverlay } from '../traffic/congestion';
import type { RenderPlugin, RenderPluginContext } from './types';

/** Couche de congestion de la partie en cours (exposée pour les tests et les captures). */
export const congestionOverlay = new CongestionOverlay();

function apply(payload: CirculationDelta | CirculationSnapshot | undefined): void {
  if (!payload) { congestionOverlay.visible = false; return; }
  if (payload.layout) congestionOverlay.setLayout(payload.layout);
  if (payload.congestion) congestionOverlay.setLevels(payload.congestion);
  if (payload.overlay !== undefined) congestionOverlay.visible = payload.overlay;
}

export const circulationRenderPlugin: RenderPlugin = {
  id: 'circulation',

  init(ctx: RenderPluginContext): void {
    ctx.scene.add(congestionOverlay.group);
  },

  applySnapshotExt(payload: unknown): void {
    const snap = snapshotExt({ circulation: payload }, 'circulation');
    if (!payload) congestionOverlay.dispose();
    apply(snap);
  },

  applyDeltaExt(payload: unknown): void {
    apply(payload as CirculationDelta);
  },

  dispose(): void {
    congestionOverlay.dispose();
    congestionOverlay.group.removeFromParent();
  },
};
