/**
 * Module de simulation « weather » (phase 2C « Atmosphère ») : météo déterministe calculée dans le worker.
 *  - `onNewGame` : premier épisode de beau temps tiré avec le PRNG du module ;
 *  - `onTick` : pas fixes de 10 min de jeu (src/sim/weather/model.ts) ;
 *  - `takeDelta` : `delta.ext.weather` (WeatherPayload) après chaque pas ou forçage ; rien sinon ;
 *  - `snapshot` : état complet ; `save` / `load` : section src/sim/save-sections/weather.ts ;
 *  - commandes : `state`, `force` (démonstration / captures, voir WeatherCommands).
 * N'utilise que le PRNG propre au module : la simulation de base est inchangée (tests/weather).
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { WEATHER_KINDS, WEATHER_PLUGIN_ID, type WeatherKind } from '../../shared/weather/types';
import { migrateWeather, WEATHER_SAVE_VERSION } from './save';
import type { PluginContext, SimPlugin } from '../plugins/types';
import { WeatherModel } from './model';

/**
 * Fabrique le module. L'état vit dans un modèle PAR SIMULATION (clé : le contexte du module, propre à chaque
 * hôte) : plusieurs simulations du même processus (tests) ne partagent rien.
 */
export function createWeatherPlugin(): SimPlugin & { modelOf(ctx: PluginContext): WeatherModel } {
  const models = new WeakMap<PluginContext, WeatherModel>();
  const modelOf = (ctx: PluginContext): WeatherModel => {
    let m = models.get(ctx);
    if (!m) { m = new WeatherModel(); models.set(ctx, m); }
    return m;
  };
  return {
    id: WEATHER_PLUGIN_ID,
    saveVersion: WEATHER_SAVE_VERSION,
    modelOf,
    onNewGame(ctx) { modelOf(ctx).reset(ctx.rng, ctx.clock.totalMinutes); },
    onTick(ctx) { if (ctx.inGame) modelOf(ctx).advance(ctx.rng, ctx.clock.totalMinutes); },
    takeDelta(ctx) {
      const model = modelOf(ctx);
      return ctx.inGame && model.consumeDirty() ? model.payload(ctx.clock.totalMinutes) : undefined;
    },
    snapshot(ctx) { return ctx.inGame ? modelOf(ctx).payload(ctx.clock.totalMinutes) : undefined; },
    save(ctx) { return ctx.inGame ? { ...modelOf(ctx).state } : undefined; },
    load(ctx, data, version) {
      const model = modelOf(ctx);
      model.state = migrateWeather(data, version);
      model.consumeDirty();
    },
    command(ctx, name, payload) {
      const model = modelOf(ctx);
      if (name === 'state') return { ok: true, data: model.payload(ctx.clock.totalMinutes) };
      if (name === 'force') {
        const p = (payload ?? {}) as Record<string, unknown>;
        const kind = p['kind'];
        if (kind !== undefined && !(typeof kind === 'string' && (WEATHER_KINDS as readonly string[]).includes(kind))) {
          return { ok: false, code: 'INVALID_ARGS', message: `Temps inconnu : ${String(kind)}` };
        }
        const hours = p['hours'];
        if (hours !== undefined && (typeof hours !== 'number' || !Number.isFinite(hours) || hours <= 0)) {
          return { ok: false, code: 'INVALID_ARGS', message: 'Durée invalide' };
        }
        const doy = p['dayOfYear'];
        if (doy !== undefined && doy !== null && (typeof doy !== 'number' || !Number.isFinite(doy))) {
          return { ok: false, code: 'INVALID_ARGS', message: 'Jour de l\'année invalide' };
        }
        model.force(ctx.rng, ctx.clock.totalMinutes, {
          ...(kind !== undefined ? { kind: kind as WeatherKind } : {}),
          ...(hours !== undefined ? { hours: hours as number } : {}),
          ...(doy !== undefined ? { dayOfYear: doy as number | null } : {}),
          settle: p['settle'] === true,
          ...(typeof p['wetness'] === 'number' && Number.isFinite(p['wetness']) ? { wetness: p['wetness'] } : {}),
          ...(typeof p['snowCover'] === 'number' && Number.isFinite(p['snowCover']) ? { snowCover: p['snowCover'] } : {}),
        });
        return { ok: true, data: model.payload(ctx.clock.totalMinutes) };
      }
      return { ok: false, code: 'INVALID_ARGS', message: `Commande inconnue : ${name}` };
    },
  };
}
