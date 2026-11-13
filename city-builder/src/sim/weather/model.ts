/**
 * Modèle météo déterministe (phase 2C « Atmosphère »).
 *
 * Épisodes de temps (ensoleillé, nuageux, pluie, orage, neige, brouillard) tirés selon la saison avec le PRNG
 * PROPRE au module ; les grandeurs physiques (nuages, précipitations, brouillard, vent, température, sol mouillé,
 * neige au sol) convergent vers les cibles de l'épisode par pas fixes de 10 minutes de jeu, alignés sur l'horloge
 * absolue : le résultat ne dépend que de la graine et du temps écoulé, pas du découpage des ticks.
 * La phase des précipitations (pluie / neige) découle de la température. Aucune allocation par pas.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { climateMean, diurnalShape, seasonOfDay } from '../../shared/weather/season';
import { WEATHER_ICONS, WEATHER_KINDS, WEATHER_LABELS_FR, type WeatherKind, type WeatherPayload } from '../../shared/weather/types';

/** Source pseudo-aléatoire (le PRNG du module, sfc32). */
export interface RandomSource { next(): number }

export const WEATHER_STEP_MIN = 10;
const MIN_PER_DAY = 1440;
/** Au-delà, le rattrapage saute directement au présent (chargement d'une très vieille horloge, tests). */
const MAX_CATCHUP_STEPS = 6 * 24 * 60;

/** État complet (sérialisable JSON, sauvegardé tel quel). */
export interface WeatherState {
  /** Épisode en cours et minutes restantes. */
  kind: WeatherKind;
  remaining: number;
  forced: boolean;
  /** Jour de l'année imposé (démonstration) ou null. */
  dayOverride: number | null;
  /** Dernière frontière de pas traitée (minutes absolues). */
  lastStep: number;
  /** Cibles de l'épisode. */
  tCloud: number; tPrecip: number; tFog: number; tStorm: number; tWind: number; windDir: number; anomaly: number;
  /** Valeurs courantes. */
  cloud: number; precip: number; fog: number; storm: number; wind: number; temp: number; wetness: number; snowCover: number;
}

type SeasonWeights = Record<WeatherKind, number>;
const WEIGHTS: Record<string, SeasonWeights> = {
  hiver: { ensoleille: 0.26, nuageux: 0.3, pluie: 0.16, orage: 0, neige: 0.18, brouillard: 0.1 },
  printemps: { ensoleille: 0.36, nuageux: 0.28, pluie: 0.24, orage: 0.05, neige: 0.02, brouillard: 0.05 },
  ete: { ensoleille: 0.56, nuageux: 0.19, pluie: 0.1, orage: 0.13, neige: 0, brouillard: 0.02 },
  automne: { ensoleille: 0.28, nuageux: 0.27, pluie: 0.27, orage: 0.04, neige: 0.02, brouillard: 0.12 },
};
/** Durée des épisodes (heures, bornes). */
const DURATION_H: Record<WeatherKind, [number, number]> = {
  ensoleille: [12, 36], nuageux: [6, 20], pluie: [3, 10], orage: [1.5, 4], neige: [4, 12], brouillard: [4, 9],
};

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
const smooth = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
/** Rapprochement exponentiel d'une valeur vers sa cible (constante de temps `tau` minutes, pas de 10 min). */
const approach = (v: number, target: number, tau: number): number => v + (target - v) * (1 - Math.exp(-WEATHER_STEP_MIN / tau));
const r1 = (v: number): number => Math.round(v * 10) / 10;
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

export function dayOfYearAt(totalMinutes: number): number {
  return Math.floor(totalMinutes / MIN_PER_DAY) % 360;
}

export function emptyWeatherState(): WeatherState {
  return {
    kind: 'ensoleille', remaining: 0, forced: false, dayOverride: null, lastStep: 0,
    tCloud: 0.1, tPrecip: 0, tFog: 0, tStorm: 0, tWind: 3, windDir: 4.7, anomaly: 0,
    cloud: 0.1, precip: 0, fog: 0, storm: 0, wind: 3, temp: 5, wetness: 0, snowCover: 0,
  };
}

export class WeatherModel {
  state: WeatherState = emptyWeatherState();
  /** Vrai quand l'état a changé depuis le dernier `consumeDirty`. */
  private dirty = true;

  /** Nouvelle partie : premier épisode de beau temps (ensoleillé ou nuageux), valeurs établies d'emblée. */
  reset(rng: RandomSource, totalMinutes: number): void {
    const s = (this.state = emptyWeatherState());
    s.lastStep = Math.floor(totalMinutes / WEATHER_STEP_MIN) * WEATHER_STEP_MIN;
    this.startEpisode(rng, rng.next() < 0.7 ? 'ensoleille' : 'nuageux', this.doy(s.lastStep));
    this.settle(s.lastStep);
    this.dirty = true;
  }

  private doy(t: number): number { return this.state.dayOverride ?? dayOfYearAt(t); }

  /** Choix pondéré du prochain épisode selon la saison (persistance partielle de l'épisode précédent). */
  pickNext(rng: RandomSource, doy: number): WeatherKind {
    const prev = this.state.kind;
    if (prev !== 'orage' && prev !== 'brouillard' && rng.next() < 0.3) return prev;
    const w = WEIGHTS[seasonOfDay(doy)]!;
    let total = 0;
    for (const k of WEATHER_KINDS) total += k === prev ? w[k] * 0.4 : w[k];
    let x = rng.next() * total;
    for (const k of WEATHER_KINDS) {
      x -= k === prev ? w[k] * 0.4 : w[k];
      if (x < 0) return k;
    }
    return 'nuageux';
  }

  /** Démarre un épisode : durée, cibles et anomalie de température tirées par le PRNG (nombre de tirages fixe). */
  startEpisode(rng: RandomSource, kind: WeatherKind, doy: number, hours?: number): void {
    const s = this.state;
    const [h0, h1] = DURATION_H[kind];
    const a = rng.next(), b = rng.next(), c = rng.next(), d = rng.next(), e = rng.next();
    s.kind = kind;
    s.remaining = Math.round((hours ?? h0 + (h1 - h0) * a) * 60);
    const season = seasonOfDay(doy);
    // Anomalie de température de l'épisode (≈ gaussienne, ±3 °C) + biais du temps.
    const bias = kind === 'ensoleille' ? (season === 'hiver' ? -1 : 1.2) : kind === 'pluie' || kind === 'orage' ? -1 : kind === 'neige' ? -3.5 : 0;
    s.anomaly = (b + c - 1) * 3 + bias;
    // Vent dominant d'ouest (± 70°).
    s.windDir = 1.5 * Math.PI + (d - 0.5) * 2.4;
    switch (kind) {
      case 'ensoleille': s.tCloud = 0.05 + 0.15 * e; s.tPrecip = 0; s.tFog = 0; s.tStorm = 0; s.tWind = 1.5 + 3 * e; break;
      case 'nuageux': s.tCloud = 0.6 + 0.25 * e; s.tPrecip = 0; s.tFog = 0; s.tStorm = 0; s.tWind = 3 + 4 * e; break;
      case 'pluie': s.tCloud = 0.97; s.tPrecip = 0.35 + 0.45 * e; s.tFog = 0.12; s.tStorm = 0; s.tWind = 4 + 5 * e; break;
      case 'orage': s.tCloud = 1; s.tPrecip = 0.7 + 0.3 * e; s.tFog = 0.08; s.tStorm = 0.6 + 0.4 * e; s.tWind = 7 + 8 * e; break;
      case 'neige': s.tCloud = 0.97; s.tPrecip = 0.35 + 0.45 * e; s.tFog = 0.2; s.tStorm = 0; s.tWind = 2 + 4 * e; break;
      case 'brouillard': s.tCloud = 0.45; s.tPrecip = 0; s.tFog = 0.75 + 0.25 * e; s.tStorm = 0; s.tWind = 0.5 + 1.5 * e; break;
    }
  }

  /** Température cible (°C) à l'instant t (sans lissage). */
  targetTemp(t: number): number {
    const s = this.state;
    return this.climateAt(t, s.cloud) + s.anomaly - 2.5 * s.precip;
  }

  /** Température climatique (normale + cycle diurnal amorti par les nuages), sans anomalie ni précipitations. */
  climateAt(t: number, cloud: number): number {
    const { mean, range } = climateMean(this.doy(t));
    return mean + range * diurnalShape((t % MIN_PER_DAY) / 60) * (1 - 0.6 * cloud);
  }

  /** Brouillard effectif : il se lève avec le réchauffement de la journée. */
  private fogTarget(t: number): number {
    const hour = (t % MIN_PER_DAY) / 60;
    const midday = smooth(9, 12.5, hour) * (1 - smooth(17, 20, hour));
    // Un brouillard imposé (démonstration) tient toute la journée.
    return this.state.tFog * (this.state.forced ? 1 : 1 - 0.6 * midday);
  }

  /** Applique immédiatement les cibles (pas de transition). */
  settle(t: number): void {
    const s = this.state;
    s.cloud = s.tCloud; s.precip = s.tPrecip; s.storm = s.tStorm; s.wind = s.tWind;
    s.fog = this.fogTarget(t);
    s.temp = this.targetTemp(t);
    this.dirty = true;
  }

  /** Un pas de 10 minutes à la frontière `t` (minutes absolues). */
  step(rng: RandomSource, t: number): void {
    const s = this.state;
    s.remaining -= WEATHER_STEP_MIN;
    if (s.remaining <= 0) {
      s.forced = false;
      this.startEpisode(rng, this.pickNext(rng, this.doy(t)), this.doy(t));
    }
    // Les précipitations n'arrivent qu'une fois le ciel couvert ; elles cessent avant que les nuages se dissipent.
    s.cloud = approach(s.cloud, s.tCloud, 70);
    const precipGate = smooth(0.7, 0.92, s.cloud);
    s.precip = approach(s.precip, s.tPrecip * precipGate, 35);
    s.storm = approach(s.storm, s.tStorm * precipGate, 30);
    s.fog = approach(s.fog, this.fogTarget(t), 60);
    // Rafales : petite variation déterministe autour du vent de l'épisode (un tirage par pas).
    s.wind = clamp(approach(s.wind, s.tWind, 50) + (rng.next() - 0.5) * (0.6 + s.storm * 3), 0, 30);
    s.temp = approach(s.temp, this.targetTemp(t), 60);
    const sf = this.snowFraction();
    const rain = s.precip * (1 - sf), snow = s.precip * sf;
    const hour = (t % MIN_PER_DAY) / 60;
    const daylight = smooth(6, 9, hour) * (1 - smooth(17, 20, hour));
    // Sol mouillé : la pluie humidifie, le soleil, la chaleur et le vent sèchent ; la fonte mouille.
    const melt = s.snowCover > 0 && s.temp > 0.5 ? Math.min(s.snowCover, 0.01 * s.temp * (1 + 2 * rain)) : 0;
    const dry = 0.004 + 0.02 * daylight * (1 - s.cloud) + 0.0015 * Math.max(0, s.temp) + 0.0015 * s.wind;
    s.wetness = clamp(s.wetness + rain * 0.12 + melt * 2 - dry * (1 - 0.8 * s.fog), 0, 1);
    // Neige au sol : accumulation sous la neige (si le sol est froid), fonte au-dessus de 0,5 °C.
    s.snowCover = clamp(s.snowCover + (s.temp < 1.5 ? snow * 0.07 : snow * 0.01) - melt, 0, 1);
  }

  /** Part neigeuse des précipitations (0 pluie .. 1 neige) selon la température. */
  snowFraction(): number { return 1 - smooth(-0.5, 2, this.state.temp); }

  /** Avance jusqu'à `totalMinutes` (pas de 10 min alignés). Renvoie le nombre de pas effectués. */
  advance(rng: RandomSource, totalMinutes: number): number {
    const s = this.state;
    let n = 0;
    if ((totalMinutes - s.lastStep) / WEATHER_STEP_MIN > MAX_CATCHUP_STEPS) {
      s.lastStep = Math.floor(totalMinutes / WEATHER_STEP_MIN) * WEATHER_STEP_MIN - MAX_CATCHUP_STEPS * WEATHER_STEP_MIN;
    }
    while (s.lastStep + WEATHER_STEP_MIN <= totalMinutes) {
      s.lastStep += WEATHER_STEP_MIN;
      this.step(rng, s.lastStep);
      n++;
    }
    if (n > 0) this.dirty = true;
    return n;
  }

  /** Forçage (démonstration / captures). */
  force(rng: RandomSource, totalMinutes: number, o: { kind?: WeatherKind; hours?: number; dayOfYear?: number | null; settle?: boolean; wetness?: number; snowCover?: number }): void {
    const s = this.state;
    if (o.dayOfYear !== undefined) s.dayOverride = o.dayOfYear === null ? null : ((Math.floor(o.dayOfYear) % 360) + 360) % 360;
    const t = s.lastStep;
    if (o.kind) {
      this.startEpisode(rng, o.kind, this.doy(t), clamp(o.hours ?? 6, 0.5, 240));
      s.forced = true;
      if (o.kind === 'neige') {
        // Neige crédible : on refroidit l'épisode jusqu'à environ -2 °C.
        s.anomaly = Math.min(s.anomaly, -2 - this.climateAt(t, s.tCloud) + 2.5 * s.tPrecip);
      } else if (o.kind === 'pluie' || o.kind === 'orage') {
        s.anomaly = Math.max(s.anomaly, 4 - this.climateAt(t, s.tCloud) + 2.5 * s.tPrecip);
      }
    }
    if (o.settle) {
      this.settle(t);
      const sf = this.snowFraction();
      if (s.precip > 0) {
        s.wetness = Math.max(s.wetness, 0.85 * (1 - sf) + 0.3 * sf);
        if (sf > 0.5) s.snowCover = Math.max(s.snowCover, 0.85);
      }
      if (o.kind && o.kind !== 'neige' && s.temp > 2) s.snowCover = 0;
      if (o.kind === 'ensoleille' || o.kind === 'nuageux' || o.kind === 'brouillard') s.wetness = o.kind === 'brouillard' ? 0.35 : 0;
    }
    if (o.wetness !== undefined) s.wetness = clamp(o.wetness, 0, 1);
    if (o.snowCover !== undefined) s.snowCover = clamp(o.snowCover, 0, 1);
    void totalMinutes;
    this.dirty = true;
  }

  consumeDirty(): boolean {
    const d = this.dirty;
    this.dirty = false;
    return d;
  }

  /** Temps dominant observé (dérivé des grandeurs courantes, pas de l'épisode). */
  observedKind(): WeatherKind {
    const s = this.state;
    const sf = this.snowFraction();
    if (s.storm > 0.3) return 'orage';
    if (s.precip * sf > 0.1) return 'neige';
    if (s.precip * (1 - sf) > 0.1) return 'pluie';
    if (s.fog > 0.45) return 'brouillard';
    if (s.cloud > 0.5) return 'nuageux';
    return 'ensoleille';
  }

  /** Charge utile pour le rendu et l'interface. */
  payload(totalMinutes: number): WeatherPayload {
    const s = this.state;
    const kind = this.observedKind();
    const hour = (totalMinutes % MIN_PER_DAY) / 60;
    const night = hour < 6.5 || hour >= 20;
    const sf = this.snowFraction();
    const doy = this.doy(totalMinutes);
    return {
      kind,
      label: WEATHER_LABELS_FR[kind],
      icon: night && kind === 'ensoleille' ? '🌙' : WEATHER_ICONS[kind],
      tempC: r1(s.temp),
      cloud: r3(s.cloud), rain: r3(s.precip * (1 - sf)), snow: r3(s.precip * sf), fog: r3(s.fog), storm: r3(s.storm),
      wind: r1(s.wind), windDir: r3(s.windDir), wetness: r3(s.wetness), snowCover: r3(s.snowCover),
      dayOfYear: doy, season: seasonOfDay(doy), forced: s.forced || s.dayOverride !== null,
    };
  }
}
