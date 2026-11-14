/**
 * Modèle physique simplifié du service de l'eau : consommation par bâtiment et par heure, rendement de la nappe,
 * pression, effets du financement. Fonctions pures (testées dans tests/eau/model.test.ts).
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import type { BuildingCategory } from '../../shared/catalog';
import type { WaterSettings } from '../../shared/water-network/types';

/** Profil horaire de consommation (facteurs dont la moyenne sur 24 h vaut 1) : creux nocturne, pointes 7-9 h et 19-21 h. */
const RAW_PROFILE = [0.35, 0.3, 0.28, 0.28, 0.35, 0.6, 1.1, 1.7, 1.6, 1.25, 1.1, 1.1, 1.2, 1.1, 1.0, 1.0, 1.05, 1.2, 1.45, 1.6, 1.45, 1.15, 0.8, 0.5];
const PROFILE_MEAN = RAW_PROFILE.reduce((a, b) => a + b, 0) / 24;
export const HOURLY_PROFILE: readonly number[] = RAW_PROFILE.map((v) => v / PROFILE_MEAN);

/** Facteur horaire de consommation à l'heure décimale `hour` (0..24). */
export function hourlyFactor(hour: number): number {
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  return HOURLY_PROFILE[h]!;
}

/** Besoins journaliers (m³/jour) : par habitant, par emploi selon le secteur, socle par bâtiment occupé. */
export const DAILY_PER_RESIDENT = 0.15;
export const DAILY_PER_JOB: Readonly<Record<string, number>> = { industrial: 0.3, commercial: 0.04, public: 0.06 };
export const DAILY_PER_JOB_DEFAULT = 0.04;
/** Socle d'un bâtiment sans occupant (nettoyage, arrosage, réseaux techniques). */
export const DAILY_BASE = 0.05;

/** Élasticité-prix : demande × (tarif de référence / tarif)^0,25, bornée à [0,7 ; 1,15]. */
export function tariffDemandFactor(tariff: number): number {
  const t = Math.max(0.25, tariff);
  return Math.min(1.15, Math.max(0.7, Math.pow(2 / t, 0.25)));
}

/** Demande horaire (m³/h) d'un bâtiment. */
export function buildingDemand(category: BuildingCategory | string, residents: number, workers: number, hour: number, s: Pick<WaterSettings, 'tariff' | 'restrictions'>): number {
  const perJob = DAILY_PER_JOB[category] ?? DAILY_PER_JOB_DEFAULT;
  const daily = DAILY_BASE + residents * DAILY_PER_RESIDENT + workers * perJob;
  return (daily / 24) * hourlyFactor(hour) * tariffDemandFactor(s.tariff) * (s.restrictions ? 0.8 : 1);
}

/** Part des eaux usées dans l'eau consommée. */
export const SEWAGE_RATIO = 0.9;

/**
 * Rendement d'un forage (0,15..1) : nappe d'autant meilleure que l'eau de surface est proche et que le site est
 * bas. `distWater` en m (Infinity si aucune eau à 600 m), `heightAboveWater` en m.
 */
export function aquiferYield(distWater: number, heightAboveWater: number): number {
  const near = Number.isFinite(distWater) ? Math.max(0, 1 - distWater / 600) : 0;
  const low = Math.max(0, 1 - Math.max(0, heightAboveWater) / 40);
  return Math.max(0.15, Math.min(1, 0.25 + 0.75 * near * (0.4 + 0.6 * low)));
}
/** Rendement relatif d'un forage par rapport à un pompage en eau de surface (débit nominal × ce facteur × nappe). */
export const BOREHOLE_FACTOR = 0.45;
/** Distance maximale (m) entre une station de pompage et l'eau pour un captage de surface. */
export const SURFACE_INTAKE_RADIUS = 56;

/** Effet du financement sur la capacité (0 → 0, 100 % → 1, plafonné à 1,15 au-delà). */
export function fundingCapacity(f: number): number {
  return Math.max(0, Math.min(1.15, f <= 1 ? f : 1 + (f - 1) * 0.3));
}

/** Rendement d'abattement d'une usine de potabilisation selon le financement. */
export function potabilisationEfficiency(f: number): number {
  return Math.max(0, Math.min(0.99, 0.97 * Math.min(1, f) + (f > 1 ? 0.02 * Math.min(1, (f - 1) * 2) : 0)));
}

/**
 * Rendement d'épuration (abattement de la charge polluante) selon le financement : 92 % à 100 %, 96 % au-delà ;
 * une station sous-financée épure partiellement (rendement proportionnel), à 0 % elle ne traite rien.
 */
export function epurationEfficiency(f: number): number {
  return Math.max(0, Math.min(0.96, 0.92 * Math.min(1, f) + (f > 1 ? 0.04 * Math.min(1, (f - 1) * 2) : 0)));
}

/** Qualité de l'eau captée non traitée : surface (selon la pollution 0..100) ou forage (nappe filtrée). */
export function rawQuality(mode: 'surface' | 'forage', pollution: number): number {
  const p = Math.max(0, Math.min(100, pollution)) / 100;
  return mode === 'forage' ? 0.9 - 0.3 * p : 0.7 * (1 - p);
}

/** Qualité après potabilisation. */
export function treatedQuality(rawQ: number, efficiency: number): number {
  return Math.max(0, Math.min(1, 1 - (1 - rawQ) * (1 - efficiency)));
}

/** Pression de service (bar) : charge disponible (m) − altitude − pertes, ÷ 10,2. */
export function pressureBar(sourceHead: number, nodeHeight: number, lossM: number): number {
  return (sourceHead - nodeHeight - lossM) / 10.2;
}

/** Pertes de charge (m) sur `distM` m de canalisations, selon le taux d'utilisation du réseau (0..1+). */
export function headLoss(distM: number, utilization: number): number {
  const u = Math.max(0, utilization);
  return distM * 0.004 * (0.25 + u * u);
}

/** Facteur de service lié à la pression : nul sous 0,3 bar, plein à partir de 1,5 bar. */
export function pressureFactor(bar: number): number {
  return Math.max(0, Math.min(1, (bar - 0.3) / 1.2));
}

/** Hauteur de refoulement (m) d'une usine ou d'une station sans château d'eau. */
export const PUMP_HEAD = 22;

/** Capacités des canalisations (m³/h) selon le type de voie (eau potable ; égouts : × 1,5). */
export const PIPE_CAPACITY: Readonly<Record<string, number>> = {
  boulevard: 420, avenue: 320, street: 160, oneway: 160, pedestrian: 90, highway: 120,
};
/** Fuites par tronçon (fraction). */
export const PIPE_LOSS = 0.004;
/** Entretien mensuel des canalisations (crédits / km de réseau, financement 100 %). */
export const PIPE_UPKEEP_PER_KM = 180;

/** Seuil de desserte : un bâtiment est « desservi » s'il reçoit au moins cette part de son besoin. */
export const SERVED_THRESHOLD = 0.5;

/** Contribution d'un bâtiment à la satisfaction (points, ≤ 0). */
export function satisfactionContribution(served: number, quality: number, sewer: boolean, s: Pick<WaterSettings, 'tariff' | 'restrictions'>): number {
  let c = -30 * (1 - served) - 20 * (1 - quality) * served;
  if (!sewer) c -= 6;
  c -= Math.max(0, s.tariff - 2) * 2.5;
  if (s.restrictions) c -= 3;
  return Math.max(-60, c) + 0;
}

/** Risque sanitaire (0..1) : eau de mauvaise qualité effectivement bue. */
export function healthRisk(served: number, quality: number): number {
  return Math.max(0, Math.min(1, (1 - quality) * Math.min(1, served * 1.5)));
}
