/**
 * Quartiers — types partagés du générateur de quartiers (module « Bâtiments & quartiers », phase 2A).
 *
 * Un quartier est décrit par une DEMANDE (type, graine, rectangle) et produit un PLAN : une liste de routes
 * puis de lots (bâtiments du catalogue, position, rotation, variante). Le plan n'est qu'une donnée : il est
 * exécuté par les mêmes opérations qu'un joueur (`buildRoad`, `placeBuilding`, voir ./apply.ts) et passe donc
 * par toutes les validations de la simulation (pente, eau, collisions, fonds).
 *
 * Repère : le rectangle de la demande est centré en (x, z), de taille `width` (axe X local) × `depth` (axe Z
 * local), tourné de `rot` quarts de tour (0..3, même convention que les bâtiments : src/shared/footprint.ts).
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import type { RoadKindId } from '../roads/types';

export const DISTRICT_TYPES = ['centre_historique', 'faubourg', 'pavillonnaire', 'affaires', 'activites', 'grands_ensembles'] as const;
export type DistrictType = (typeof DISTRICT_TYPES)[number];

export const DISTRICT_LABELS_FR: Record<DistrictType, string> = {
  centre_historique: 'Centre historique',
  faubourg: 'Faubourg',
  pavillonnaire: 'Quartier pavillonnaire',
  affaires: 'Quartier d\'affaires',
  activites: 'Zone d\'activités',
  grands_ensembles: 'Grands ensembles',
};

export function isDistrictType(v: unknown): v is DistrictType {
  return typeof v === 'string' && (DISTRICT_TYPES as readonly string[]).includes(v);
}

export interface DistrictRequest {
  type: DistrictType;
  /** Graine du plan (même graine + même catalogue + même environnement = même plan). */
  seed: number;
  /** Centre du rectangle (m, monde). */
  x: number;
  z: number;
  /** Dimensions locales (m). Bornées à [MIN_DISTRICT_SIZE, MAX_DISTRICT_SIZE]. */
  width: number;
  depth: number;
  /** Rotation en quarts de tour entiers (0 par défaut). */
  rot?: number;
}

export const MIN_DISTRICT_SIZE = 96;
export const MAX_DISTRICT_SIZE = 900;

export interface DistrictBounds { minX: number; minZ: number; maxX: number; maxZ: number }

export interface PlannedRoad {
  kind: RoadKindId;
  /** [x0, z0, x1, z1] (m, monde). */
  points: [number, number, number, number];
  /** Point de contrôle d'une courbe quadratique (facultatif). */
  control?: [number, number];
}

export type LotRole = 'bati' | 'commerce' | 'equipement';

export interface PlannedLot {
  assetId: string;
  /** Index de variante (-1 si le modèle n'en a pas). */
  variant: number;
  x: number;
  z: number;
  /** Quarts de tour ; la façade (+Z du modèle) regarde la voie. */
  rot: number;
  role: LotRole;
  /** Index, dans `DistrictPlan.roads`, de la voie que le lot borde (accès route). */
  road: number;
}

export interface DistrictPlanStats {
  roads: number;
  roadLength: number;
  lots: number;
  distinctAssets: number;
  /** Indice de répétition de voisinage (0 = aucune répétition, 1 = tout identique), voir ./diversity.ts. */
  repetitionIndex: number;
  /** Part des paires de lots contigus identiques (modèle + variante). */
  adjacentTwinRate: number;
  styles: number;
  residents: number;
  jobs: number;
  /** Coût total (routes estimées au mètre + bâtiments). */
  cost: number;
  meanHeight: number;
  equipments: number;
}

export interface DistrictPlan {
  type: DistrictType;
  seed: number;
  rot: number;
  /** Rectangle demandé (centre + dimensions locales) et son enveloppe alignée sur les axes du monde. */
  center: [number, number];
  size: [number, number];
  bounds: DistrictBounds;
  roads: PlannedRoad[];
  lots: PlannedLot[];
  stats: DistrictPlanStats;
}

/** Environnement facultatif du générateur (terrain et obstacles de la partie en cours). */
export interface DistrictEnv {
  heightAt?(x: number, z: number): number;
  isWet?(x: number, z: number): boolean;
  /** Vrai si l'emprise (rectangle aligné sur les axes du monde) est déjà occupée (bâtiment, route existante…). */
  blocked?(minX: number, minZ: number, maxX: number, maxZ: number): boolean;
}
