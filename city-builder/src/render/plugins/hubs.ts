/**
 * Rendu du module « hubs » (port et aéroport, phase 2C) — propriété de la branche p2c-port-aeroport.
 * Composition et animations : src/render/hubs/scene.ts. Diagnostic e2e : `window.__hubs` (stats, poses, temps physique).
 */
import type { HubsDelta, HubsSnapshot } from '../../shared/protocol-ext/hubs';
import { HubsRenderer } from '../hubs/scene';
import type { RenderPlugin } from './types';

let renderer: HubsRenderer | null = null;

declare global { interface Window { __hubs?: { stats: () => unknown; phys: () => number } } }

export const hubsRenderPlugin: RenderPlugin = {
  id: 'hubs',
  init(ctx) {
    renderer = new HubsRenderer(ctx);
    if (typeof window !== 'undefined') window.__hubs = { stats: () => renderer?.stats() ?? null, phys: () => renderer?.physTime ?? 0 };
  },
  applySnapshotExt(payload) {
    if (!renderer) return;
    const s = payload as HubsSnapshot | undefined;
    if (!s) { renderer.clear(); return; }
    // Instantané = état complet (nouvelle partie, chargement) : on repart de zéro.
    renderer.clear();
    renderer.setState(s.hubs, s.movements, s.phys, s.speed);
  },
  applyDeltaExt(payload) {
    const d = payload as HubsDelta;
    renderer?.setState(d.hubs, d.movements, d.phys, d.speed);
  },
  frame(dt) { renderer?.frame(dt); },
  dispose() { renderer?.dispose(); renderer = null; },
};
