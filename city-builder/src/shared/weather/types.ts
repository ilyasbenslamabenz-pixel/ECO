/**
 * Météo simulée (phase 2C « Atmosphère ») : types partagés simulation <-> rendu <-> interface.
 * La simulation (src/sim/weather) publie un `WeatherPayload` dans `delta.ext.weather` (quand l'état change) et
 * `snapshot.ext.weather` (état complet). Le rendu (src/render/plugins/weather.ts) en tire ciel, précipitations,
 * brouillard, sol mouillé, neige et saison ; la barre supérieure peut afficher `icon` + `tempC`.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */

/** Identifiant du module (clé de `ext`, `save.plugins`, `pluginCommand.plugin`). */
export const WEATHER_PLUGIN_ID = 'weather';

/** Modules d'atmosphère ajoutés aux registres en plus de PHASE2_MODULES (src/shared/protocol-ext). */
export const ATMOSPHERE_MODULES = [WEATHER_PLUGIN_ID] as const;

export type WeatherKind = 'ensoleille' | 'nuageux' | 'pluie' | 'orage' | 'neige' | 'brouillard';
export const WEATHER_KINDS: readonly WeatherKind[] = ['ensoleille', 'nuageux', 'pluie', 'orage', 'neige', 'brouillard'];

export const WEATHER_LABELS_FR: Record<WeatherKind, string> = {
  ensoleille: 'Ensoleillé', nuageux: 'Nuageux', pluie: 'Pluie', orage: 'Orage', neige: 'Neige', brouillard: 'Brouillard',
};

/** Icône courte pour la barre supérieure (emoji, sans ressource externe). */
export const WEATHER_ICONS: Record<WeatherKind, string> = {
  ensoleille: '☀️', nuageux: '⛅', pluie: '🌧️', orage: '⛈️', neige: '🌨️', brouillard: '🌫️',
};

export type SeasonId = 'printemps' | 'ete' | 'automne' | 'hiver';

/** Charge utile de `delta.ext.weather` et `snapshot.ext.weather` (valeurs instantanées, lissées par la simulation). */
export interface WeatherPayload {
  /** Temps dominant (icône, libellé). */
  kind: WeatherKind;
  /** Libellé français du temps. */
  label: string;
  /** Icône (emoji) du temps ; la nuit, « ensoleillé » devient une lune. */
  icon: string;
  /** Température de l'air (°C, une décimale). */
  tempC: number;
  /** Couverture nuageuse 0..1. */
  cloud: number;
  /** Intensité de pluie 0..1. */
  rain: number;
  /** Intensité de neige qui tombe 0..1. */
  snow: number;
  /** Brouillard 0..1 (0 = air limpide, 1 = visibilité ≈ 150 m). */
  fog: number;
  /** Activité orageuse 0..1 (fréquence des éclairs). */
  storm: number;
  /** Vent moyen (m/s). */
  wind: number;
  /** Direction d'où vient le vent (rad, 0 = nord, sens horaire). */
  windDir: number;
  /** Humidité du sol 0..1 (sol mouillé, flaques). */
  wetness: number;
  /** Couverture neigeuse au sol 0..1. */
  snowCover: number;
  /** Jour de l'année du calendrier de jeu 0..359 (saisons, course du soleil). */
  dayOfYear: number;
  /** Saison du calendrier (mois). */
  season: SeasonId;
  /** Vrai si une forçage de démonstration (commande `force`) est actif. */
  forced: boolean;
}

/** Commandes `pluginCommand { plugin: 'weather', name, payload }`. */
export interface WeatherCommands {
  /** État courant complet. */
  state: { payload: undefined; result: WeatherPayload };
  /**
   * Forçage (démonstration, captures) : `kind` impose un temps pour `hours` heures (défaut 6, transitions comprises) ;
   * `dayOfYear` fige le jour de l'année vu par la météo et le rendu (saisons) ; `null` rend le calendrier.
   * `settle: true` applique immédiatement les valeurs cibles (pas de transition), y compris sol mouillé / neige au sol.
   */
  force: { payload: { kind?: WeatherKind; hours?: number; dayOfYear?: number | null; settle?: boolean }; result: WeatherPayload };
}
