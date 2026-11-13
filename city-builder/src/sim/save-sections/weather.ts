/**
 * Section de sauvegarde versionnée du module « weather » (phase 2C « Atmosphère »).
 * Écrite sous `save.plugins.weather = { v, data, rng }` ; format, version et migrations : src/sim/weather/save.ts.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { emptyWeatherSave, migrateWeather, WEATHER_SAVE_VERSION, type WeatherSave } from '../weather/save';
import type { SaveSectionSpec } from './types';

export { emptyWeatherSave, migrateWeather, WEATHER_SAVE_VERSION, type WeatherSave };

export const weatherSaveSection: SaveSectionSpec<WeatherSave> = {
  id: 'weather', version: WEATHER_SAVE_VERSION, empty: emptyWeatherSave, migrate: migrateWeather,
};
