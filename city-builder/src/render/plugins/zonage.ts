/**
 * Module de RENDU « Zonage » (phase 2B) : superposition des zones (src/render/zoning/overlay.ts), visible
 * seulement avec l'outil Zones. L'état reçu (`snapshot.ext.zonage` / `delta.ext.zonage`) est fusionné dans
 * `zoningView` (src/client/zoning-view.ts), partagé avec l'outil et les jauges de demande (src/ui/panels/zonage.ts).
 * Diagnostic e2e : `window.__zonage`.
 */
import type { ZonageDelta } from '../../shared/protocol-ext/zonage';
import { zoningView } from '../../client/zoning-view';
import { ZoningOverlay } from '../zoning/overlay';
import type { RenderPlugin } from './types';

let overlay: ZoningOverlay | null = null;

declare global {
  interface Window {
    __zonage?: { view: typeof zoningView; instances(): number; visible(): boolean };
  }
}

export const zonageRenderPlugin: RenderPlugin = {
  id: 'zonage',
  init(ctx) {
    overlay = new ZoningOverlay(ctx.scene, zoningView, ctx.heightAt);
    if (typeof window !== 'undefined') {
      window.__zonage = { view: zoningView, instances: () => overlay?.instances ?? 0, visible: () => overlay?.mesh.visible ?? false };
    }
  },
  applySnapshotExt(payload) { zoningView.reset(payload as ZonageDelta | undefined); },
  applyDeltaExt(payload) { zoningView.merge(payload as ZonageDelta); },
  dispose() { overlay?.dispose(); overlay = null; },
};
