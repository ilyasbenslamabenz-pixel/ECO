/**
 * Quartiers — ÉVOLUTION : valorisation, densification, propositions de remplacement.
 *
 * État suivi par quartier : `stage` (stade de densité 0..4), `value` (valorisation 0..100), `ageMonths`.
 * Chaque mois, `updateDistrictState` recalcule la valeur à partir de MESURES du quartier :
 *   + occupation (habitants / capacité), accès route, équipements et commerces à proximité (tags `service:`),
 *     attractivité (`attractivite:`), diversité du bâti ;
 *   − nuisances (`pollution:`), lots sans accès route.
 * La valeur suit la cible par inertie (1/6 par mois) : un quartier ne change pas d'état en un tick.
 * Le stade monte quand la valeur et l'occupation dépassent des seuils plusieurs mois de suite, et descend
 * quand la valeur s'effondre (déclin).
 *
 * `proposeEvolutions` produit des propositions PURES (aucune écriture) :
 *   - « densification » : un bâtiment est remplacé par un modèle de la catégorie supérieure
 *     (house -> townhouse -> apartment_low -> apartment_mid -> apartment_high ; commercial -> skyscraper),
 *     admis dans le même type de quartier, d'emprise COMPATIBLE (≤ l'emprise actuelle, même orientation) ;
 *   - « valorisation » : même catégorie, modèle plus cher (ou simple changement de variante : ravalement)
 *     quand la valeur est haute mais la densification impossible.
 * L'application passe par `applyProposal` (./apply.ts) : démolition + construction aux règles du joueur.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import type { AssetCategory, CatalogAsset } from '../../shared/catalog';
import { districtTypesOf, tagNumber } from './profiles';
import type { DistrictType } from './types';

/** Échelle de densification par catégorie (catégorie suivante, ou null en bout de chaîne). */
export const DENSIFICATION_SCALE: Partial<Record<AssetCategory, AssetCategory>> = {
  house: 'townhouse',
  townhouse: 'apartment_low',
  apartment_low: 'apartment_mid',
  apartment_mid: 'apartment_high',
  apartment_high: 'skyscraper',
  commercial: 'skyscraper',
};

export interface DistrictState {
  /** 0 = tissu d'origine ; 4 = densité maximale atteinte. */
  stage: number;
  /** Valorisation 0..100. */
  value: number;
  ageMonths: number;
  /** Mois consécutifs au-dessus du seuil de densification. */
  pressure: number;
}

export function emptyDistrictState(): DistrictState {
  return { stage: 0, value: 50, ageMonths: 0, pressure: 0 };
}

/** Mesures d'un quartier, calculées par le module à partir des bâtiments réellement présents. */
export interface DistrictMeasures {
  buildings: number;
  residents: number;
  capacity: number;
  jobs: number;
  /** Part des bâtiments ayant un accès route (0..1). */
  roadAccessRate: number;
  /** Somme des `attractivite:` des bâtiments du quartier et de ses abords. */
  attractivity: number;
  /** Somme des `pollution:`. */
  pollution: number;
  /** Nombre de bâtiments de service (tag `service:`). */
  services: number;
  /** Indice de répétition du bâti (0..1 ; voir ./diversity.ts). */
  repetitionIndex: number;
}

export const EVOLUTION_THRESHOLDS = {
  /** Valeur minimale pour densifier. */
  value: 62,
  /** Occupation minimale (habitants / capacité) pour densifier. */
  occupancy: 0.8,
  /** Mois consécutifs de pression avant la première proposition. */
  months: 2,
  /** Valeur en dessous de laquelle le quartier décline (stade -1 à terme). */
  decline: 28,
  /** Valeur minimale pour une valorisation (ravalement / montée de gamme). */
  upgrade: 56,
} as const;

const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

/** Valeur cible (0..100) d'un quartier au vu de ses mesures. */
export function targetValue(m: DistrictMeasures): number {
  if (m.buildings === 0) return 50;
  const occ = m.capacity > 0 ? clamp(m.residents / m.capacity, 0, 1) : 0.5;
  let v = 34;
  v += occ * 26;
  v += clamp(m.roadAccessRate, 0, 1) * 12;
  v += clamp(m.services / Math.max(4, m.buildings * 0.12), 0, 1) * 12;
  v += clamp(m.attractivity / Math.max(2, m.buildings * 0.1), 0, 1) * 10;
  v += (1 - clamp(m.repetitionIndex, 0, 1)) * 6;
  v -= clamp(m.pollution / Math.max(2, m.buildings * 0.12), 0, 1) * 18;
  return clamp(v, 0, 100);
}

/** Met à jour l'état d'un quartier pour un mois écoulé (fonction pure : renvoie un nouvel état). */
export function updateDistrictState(state: DistrictState, m: DistrictMeasures): DistrictState {
  const target = targetValue(m);
  const value = clamp(state.value + (target - state.value) / 6, 0, 100);
  const occ = m.capacity > 0 ? m.residents / m.capacity : 0;
  const t = EVOLUTION_THRESHOLDS;
  let pressure = value >= t.value && occ >= t.occupancy ? state.pressure + 1 : 0;
  let stage = state.stage;
  if (pressure >= t.months && stage < 4) { stage++; pressure = 0; }
  else if (value < t.decline && stage > 0) stage--;
  return { stage, value, ageMonths: state.ageMonths + 1, pressure };
}

export type EvolutionKind = 'densification' | 'valorisation';

export interface EvolutionProposal {
  id: number;
  districtId: number;
  buildingId: number;
  fromAsset: string;
  fromVariant: number;
  toAsset: string;
  variant: number;
  /** Position et orientation conservées (le remplaçant occupe la même parcelle). */
  x: number;
  z: number;
  rot: number;
  kind: EvolutionKind;
  reason: string;
  /** Coût de construction du remplaçant (information pour l'interface). */
  cost: number;
}

/** Bâtiment candidat au remplacement (lu dans la simulation par le module). */
export interface EvolutionCandidate {
  buildingId: number;
  asset: CatalogAsset;
  variant: number;
  x: number;
  z: number;
  rot: number;
  /** Occupation propre du bâtiment (habitants / capacité) ; 1 pour un bâtiment sans habitant. */
  occupancy: number;
  roadAccess: boolean;
}

export interface ProposeOptions {
  districtId: number;
  type: DistrictType;
  state: DistrictState;
  measures: DistrictMeasures;
  /** Nombre maximal de propositions produites. */
  max?: number;
  /** Premier identifiant de proposition (les suivants sont incrémentés). */
  nextId: number;
  /** Tirage déterministe dans [0,1) (PRNG du module). */
  rand(): number;
}

function fits(from: CatalogAsset, to: CatalogAsset): boolean {
  return to.footprint.tilesX <= from.footprint.tilesX && to.footprint.tilesZ <= from.footprint.tilesZ;
}

/**
 * Propositions d'évolution pour un quartier. Rien n'est proposé tant que les seuils ne sont pas franchis
 * (valeur, occupation, pression) : un quartier calme ne bouge pas.
 */
export function proposeEvolutions(
  candidates: readonly EvolutionCandidate[], catalog: readonly CatalogAsset[], o: ProposeOptions,
): EvolutionProposal[] {
  const t = EVOLUTION_THRESHOLDS;
  const out: EvolutionProposal[] = [];
  const max = o.max ?? 2;
  const densify = o.state.value >= t.value && o.state.stage >= 1;
  const upgrade = o.state.value >= t.upgrade;
  if (!densify && !upgrade) return out;
  let id = o.nextId;
  // Les bâtiments les plus occupés d'abord, ordre stable.
  const sorted = [...candidates].sort((a, b) => b.occupancy - a.occupancy || a.buildingId - b.buildingId);
  for (const c of sorted) {
    if (out.length >= max) break;
    if (!c.roadAccess) continue;
    const from = c.asset;
    if (densify && c.occupancy >= t.occupancy) {
      const next = DENSIFICATION_SCALE[from.category];
      const pool = next
        ? catalog.filter((a) => a.category === next && fits(from, a) && districtTypesOf(a).includes(o.type))
        : [];
      if (pool.length > 0) {
        const pick = pool[Math.floor(o.rand() * pool.length) % pool.length]!;
        out.push({
          id: id++, districtId: o.districtId, buildingId: c.buildingId, fromAsset: from.id, fromVariant: c.variant,
          toAsset: pick.id, variant: pick.variants.length > 0 ? 0 : -1, x: c.x, z: c.z, rot: c.rot,
          kind: 'densification',
          reason: `Quartier recherché (valeur ${Math.round(o.state.value)}/100, occupation ${Math.round(c.occupancy * 100)} %) : ${from.nameFr} remplacé par ${pick.nameFr}.`,
          cost: pick.cost,
        });
        continue;
      }
    }
    if (upgrade) {
      // Montée de gamme : même catégorie, plus cher, emprise compatible.
      const better = catalog.filter((a) => a.category === from.category && a.id !== from.id && a.cost > from.cost * 1.15
        && fits(from, a) && districtTypesOf(a).includes(o.type));
      if (better.length > 0) {
        const pick = better[Math.floor(o.rand() * better.length) % better.length]!;
        out.push({
          id: id++, districtId: o.districtId, buildingId: c.buildingId, fromAsset: from.id, fromVariant: c.variant,
          toAsset: pick.id, variant: pick.variants.length > 0 ? 0 : -1, x: c.x, z: c.z, rot: c.rot,
          kind: 'valorisation',
          reason: `Valorisation du quartier (valeur ${Math.round(o.state.value)}/100) : ${from.nameFr} remplacé par ${pick.nameFr}.`,
          cost: pick.cost,
        });
        continue;
      }
      // À défaut : ravalement (changement de variante du même modèle).
      if (from.variants.length > 1 && o.state.value >= t.value) {
        const v = (c.variant + 1 + Math.floor(o.rand() * (from.variants.length - 1))) % from.variants.length;
        if (v !== c.variant) {
          out.push({
            id: id++, districtId: o.districtId, buildingId: c.buildingId, fromAsset: from.id, fromVariant: c.variant,
            toAsset: from.id, variant: v, x: c.x, z: c.z, rot: c.rot, kind: 'valorisation',
            reason: `Ravalement : ${from.nameFr} (${from.variants[v]!.nameFr}).`,
            cost: from.cost,
          });
        }
      }
    }
  }
  void tagNumber;
  return out;
}
