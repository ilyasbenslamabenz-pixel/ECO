/**
 * Section de sauvegarde versionnée du module « weather » (phase 2C « Atmosphère ») : format et migrations ;
 * la spécification de section (`weatherSaveSection`) est dans src/sim/save-sections/weather.ts.
 * Écrite sous `save.plugins.weather = { v, data, rng }` par l'hôte des modules (src/sim/plugins/host.ts) :
 * l'état complet du modèle (épisode, cibles, valeurs courantes, sol mouillé, neige au sol) + le PRNG du module.
 * Toute modification du format incrémente `WEATHER_SAVE_VERSION` et ajoute une étape à `STEPS`.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { emptyWeatherState, type WeatherState } from './model';
import { WEATHER_KINDS } from '../../shared/weather/types';

export const WEATHER_SAVE_VERSION = 1;
export type WeatherSave = WeatherState;

export function emptyWeatherSave(): WeatherSave {
  return emptyWeatherState();
}

/** Étapes de migration : STEPS[v] transforme des données v en v+1. */
const STEPS: Record<number, (d: Record<string, unknown>) => Record<string, unknown>> = {};

/** Même contrat que `runMigrations` (src/sim/save-sections/types.ts), sans dépendance vers la sauvegarde. */
function migrateSteps(data: unknown, fromVersion: number): Record<string, unknown> {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new Error('section weather : objet attendu');
  if (!Number.isInteger(fromVersion) || fromVersion < 1) throw new Error(`section weather : version ${fromVersion} invalide`);
  if (fromVersion > WEATHER_SAVE_VERSION) throw new Error(`section weather : version ${fromVersion} plus récente que ${WEATHER_SAVE_VERSION}`);
  let d = data as Record<string, unknown>;
  for (let v = fromVersion; v < WEATHER_SAVE_VERSION; v++) {
    const step = STEPS[v];
    if (!step) throw new Error(`section weather : aucune migration depuis la version ${v}`);
    d = step(d);
  }
  return d;
}

const NUMERIC: readonly (keyof WeatherState)[] = [
  'remaining', 'lastStep', 'tCloud', 'tPrecip', 'tFog', 'tStorm', 'tWind', 'windDir', 'anomaly',
  'cloud', 'precip', 'fog', 'storm', 'wind', 'temp', 'wetness', 'snowCover',
];

/** Migre puis valide (lève si les données sont inutilisables : l'hôte notifie et remet le module à neuf). */
export function migrateWeather(data: unknown, fromVersion: number): WeatherSave {
  const d = migrateSteps(data, fromVersion);
  const out = emptyWeatherState();
  if (typeof d['kind'] !== 'string' || !(WEATHER_KINDS as readonly string[]).includes(d['kind'])) {
    // Section vide (gabarit) acceptée : état par défaut.
    if (Object.keys(d).length === 0) return out;
    throw new Error('section weather : temps inconnu');
  }
  out.kind = d['kind'] as WeatherState['kind'];
  for (const k of NUMERIC) {
    const v = d[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`section weather : champ ${k} invalide`);
    (out as unknown as Record<string, number>)[k] = v;
  }
  out.forced = d['forced'] === true;
  const ov = d['dayOverride'];
  out.dayOverride = typeof ov === 'number' && Number.isFinite(ov) ? ((Math.floor(ov) % 360) + 360) % 360 : null;
  return out;
}
