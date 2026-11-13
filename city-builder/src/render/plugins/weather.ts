/**
 * Rendu du module « weather » (phase 2C « Atmosphère ») — implémentation dans src/render/weather/.
 * Reçoit `snapshot.ext.weather` / `delta.ext.weather` (WeatherPayload, src/shared/weather/types.ts).
 * Accès de diagnostic (e2e, captures) : `window.__atmo` = { quality, setQuality, state, stats, strike }.
 */
import type { WeatherPayload } from '../../shared/weather/types';
import { AtmosphereSystem, type AtmosphereQuality, type AtmosphereStats } from '../weather/atmosphere';
import type { RenderPlugin } from './types';

export interface AtmosphereDebug {
  quality(): AtmosphereQuality;
  setQuality(q: AtmosphereQuality): void;
  state(): WeatherPayload | null;
  stats(): AtmosphereStats | null;
  strike(): void;
  /** Applique immédiatement une charge utile (résultat d'une commande `force`, simulation en pause). */
  apply(p: WeatherPayload): void;
}

let system: AtmosphereSystem | null = null;

/** Système d'atmosphère courant (null avant l'initialisation du rendu). */
export function getAtmosphere(): AtmosphereSystem | null { return system; }

export const weatherRenderPlugin: RenderPlugin = {
  id: 'weather',
  init(ctx) {
    system = new AtmosphereSystem({ scene: ctx.scene, camera: ctx.camera, catalog: ctx.catalog, nightFactor: ctx.nightFactor });
    const dbg: AtmosphereDebug = {
      quality: () => system?.currentQuality ?? 'off',
      setQuality: (q) => system?.setQuality(q),
      state: () => system?.payload ?? null,
      stats: () => system?.stats() ?? null,
      strike: () => system?.strike(),
      apply: (p) => system?.apply(p, true),
    };
    (globalThis as unknown as { __atmo?: AtmosphereDebug }).__atmo = dbg;
  },
  applySnapshotExt(payload) { system?.apply(payload as WeatherPayload | undefined, true); },
  applyDeltaExt(payload) { system?.apply(payload as WeatherPayload, false); },
  frame(dt) { system?.frame(dt); },
  dispose() { system?.dispose(); system = null; },
};
