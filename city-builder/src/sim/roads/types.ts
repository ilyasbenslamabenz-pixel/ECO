/**
 * Types de routes (DONNÉES, pas de code de rendu) : profil en travers, voies, sens, vitesse,
 * coûts. Lu par la simulation (validation, coûts, voies, pathfinding) ET par le rendu (maillage).
 * TypeScript pur : AUCUN import de three ni du DOM. Portable tel quel (JSON) vers Unity/Unreal.
 *
 * Profil en travers (du bord gauche au bord droit, dans le sens a -> b) :
 *   [trottoir] [bande] [voies sens inverse] [terre-plein] [voies sens direct] [bande] [trottoir]
 */

export type RoadKindId = 'street' | 'avenue' | 'boulevard' | 'oneway' | 'pedestrian' | 'highway';

export type MedianKind = 'none' | 'planted' | 'barrier';
export type SurfaceKind = 'asphalt' | 'asphalt_worn' | 'pavers';

export interface RoadKindDef {
  id: RoadKindId;
  nameFr: string;
  /** Voies dans le sens a -> b (direct) et b -> a (inverse). Sens unique : backward = 0. */
  lanesForward: number;
  lanesBackward: number;
  laneWidth: number;
  /** Bande dérasée / accotement de chaque côté de la chaussée (m). */
  shoulder: number;
  /** Terre-plein central (m) et sa nature. */
  medianWidth: number;
  median: MedianKind;
  /** Largeur de chaque trottoir (0 = pas de trottoir). */
  sidewalk: number;
  /** Hauteur de bordure (m). */
  curbHeight: number;
  surface: SurfaceKind;
  speedKmh: number;
  costPerMeter: number;
  upkeepPerMeterMonth: number;
  /** Multiplicateur de coût d'un mètre de pont. */
  bridgeCostFactor: number;
  /** Pente maximale (dénivelé / distance). */
  maxGrade: number;
  /** Rayon de courbure minimal du tracé (m). */
  minRadius: number;
  /** Ouvert aux véhicules (la rue piétonne ne l'est pas : livraisons phase 3). */
  vehicles: boolean;
  /** Ouvert aux piétons (trottoirs ou plateau piéton). */
  pedestrians: boolean;
  /** Peut être croisée à niveau (une autoroute non : échangeurs en phase 4). */
  atGradeCrossing: boolean;
  /** Espacement des lampadaires (m), 0 = aucun. */
  lampSpacing: number;
  /** Arbres d'alignement (terre-plein ou trottoirs), espacement (m), 0 = aucun. */
  treeSpacing: number;
}

const base = { laneWidth: 3.25, shoulder: 0.5, curbHeight: 0.15, bridgeCostFactor: 3.5, surface: 'asphalt' as SurfaceKind, vehicles: true, pedestrians: true, atGradeCrossing: true };

export const ROAD_KINDS: Record<RoadKindId, RoadKindDef> = {
  street: {
    ...base, id: 'street', nameFr: 'Rue (2 voies)', lanesForward: 1, lanesBackward: 1, laneWidth: 3.2,
    medianWidth: 0, median: 'none', sidewalk: 2.5, speedKmh: 40, costPerMeter: 60, upkeepPerMeterMonth: 0.4,
    maxGrade: 0.12, minRadius: 12, lampSpacing: 26, treeSpacing: 0,
  },
  avenue: {
    ...base, id: 'avenue', nameFr: 'Avenue (4 voies, terre-plein planté)', lanesForward: 2, lanesBackward: 2, laneWidth: 3.25,
    medianWidth: 3, median: 'planted', sidewalk: 3, speedKmh: 50, costPerMeter: 150, upkeepPerMeterMonth: 0.9,
    maxGrade: 0.1, minRadius: 25, lampSpacing: 28, treeSpacing: 11,
  },
  boulevard: {
    ...base, id: 'boulevard', nameFr: 'Boulevard (6 voies)', lanesForward: 3, lanesBackward: 3, laneWidth: 3.3,
    medianWidth: 4, median: 'planted', sidewalk: 4, speedKmh: 60, costPerMeter: 270, upkeepPerMeterMonth: 1.6,
    maxGrade: 0.08, minRadius: 40, lampSpacing: 30, treeSpacing: 12,
  },
  oneway: {
    ...base, id: 'oneway', nameFr: 'Rue à sens unique', lanesForward: 2, lanesBackward: 0, laneWidth: 3.1,
    medianWidth: 0, median: 'none', sidewalk: 2.5, speedKmh: 40, costPerMeter: 70, upkeepPerMeterMonth: 0.45,
    maxGrade: 0.12, minRadius: 12, lampSpacing: 26, treeSpacing: 0,
  },
  pedestrian: {
    ...base, id: 'pedestrian', nameFr: 'Rue piétonne', lanesForward: 1, lanesBackward: 1, laneWidth: 2.5,
    shoulder: 0, medianWidth: 0, median: 'none', sidewalk: 0, curbHeight: 0, surface: 'pavers',
    speedKmh: 5, costPerMeter: 80, upkeepPerMeterMonth: 0.35, maxGrade: 0.15, minRadius: 6,
    vehicles: false, lampSpacing: 18, treeSpacing: 0,
  },
  highway: {
    ...base, id: 'highway', nameFr: 'Autoroute (2×2 voies)', lanesForward: 2, lanesBackward: 2, laneWidth: 3.5,
    shoulder: 2.5, medianWidth: 1.2, median: 'barrier', sidewalk: 0, curbHeight: 0, surface: 'asphalt_worn',
    speedKmh: 110, costPerMeter: 420, upkeepPerMeterMonth: 2.2, bridgeCostFactor: 3, maxGrade: 0.06, minRadius: 120,
    pedestrians: false, atGradeCrossing: false, lampSpacing: 0, treeSpacing: 0,
  },
};

/** Ordre stable des types (index stocké dans les typed arrays et les sauvegardes binaires). */
export const ROAD_KIND_ORDER: readonly RoadKindId[] = ['street', 'avenue', 'boulevard', 'oneway', 'pedestrian', 'highway'];

export function isRoadKind(v: unknown): v is RoadKindId {
  return typeof v === 'string' && v in ROAD_KINDS;
}

/** Largeur de la chaussée (voies + bandes + terre-plein), hors trottoirs. */
export function carriagewayWidth(k: RoadKindDef): number {
  return (k.lanesForward + k.lanesBackward) * k.laneWidth + 2 * k.shoulder + k.medianWidth;
}

/** Largeur totale (chaussée + trottoirs). */
export function totalWidth(k: RoadKindDef): number {
  return carriagewayWidth(k) + 2 * k.sidewalk;
}

export function halfWidth(kind: RoadKindId): number {
  return totalWidth(ROAD_KINDS[kind]) / 2;
}

/**
 * Décalage latéral (m, positif = à gauche dans le sens a -> b) du centre de la voie `lane`.
 * Voies directes : lane = 0 la plus proche du centre ; voies inverses : idem, côté gauche.
 * Circulation à droite.
 */
export function laneOffset(k: RoadKindDef, forward: boolean, lane: number): number {
  const half = k.medianWidth / 2;
  if (k.lanesBackward === 0) {
    // Sens unique : voies centrées sur l'axe.
    const w = k.lanesForward * k.laneWidth;
    return w / 2 - (lane + 0.5) * k.laneWidth;
  }
  const d = half + (lane + 0.5) * k.laneWidth;
  return forward ? -d : d;
}
