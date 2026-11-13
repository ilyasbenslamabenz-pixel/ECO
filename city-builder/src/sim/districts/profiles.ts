/**
 * Quartiers — PROFILS des six types : trame viaire, règles de parcelles, poids de sélection des modèles,
 * équipements et gradient de hauteur. Données seules (aucune logique) : lues par ./generator.ts.
 *
 * Appartenance d'un modèle du catalogue à un type de quartier (`districtTypesOf`) :
 *  1. tags `quartier:<type>` du catalogue (bâtiments procéduraux de la phase 2A) — prioritaire ;
 *  2. table de repli par identifiant (les 40 bâtiments de la phase 1 n'ont pas ce tag) ;
 *  3. repli par catégorie (+ tags `bureaux`, `grande_surface`…) pour tout autre catalogue (tests, mods).
 * Les équipements (catégorie `public` et commerces de service) sont choisis à part, par les tags `service:`.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import type { AssetCategory, CatalogAsset } from '../../shared/catalog';
import type { RoadKindId } from '../roads/types';
import { DISTRICT_TYPES, isDistrictType, type DistrictType } from './types';

export interface EquipmentSpec {
  /** Libellé (rapports). */
  label: string;
  /** Le modèle doit porter l'un de ces tags (ex. `service:education`) ou avoir l'un de ces identifiants. */
  tags: string[];
  ids?: string[];
  /** Un équipement par tranche de `perHa` hectares, borné à [min, max]. */
  perHa: number;
  min: number;
  max: number;
}

export interface DistrictProfile {
  type: DistrictType;
  /** Dimensions visées d'un îlot (m, axe à axe des voies) et irrégularité relative (0 = grille régulière). */
  blockW: number;
  blockD: number;
  jitter: number;
  /** Voies : pourtour, voie principale (rangée et colonne centrales), voies ordinaires. */
  edgeKind: RoadKindId;
  mainKind: RoadKindId;
  streetKind: RoadKindId;
  /** Type particulier donné à une voie intérieure sur `specialEvery` (0 = jamais) : rue piétonne, sens unique. */
  specialKind: RoadKindId | null;
  specialEvery: number;
  /** Probabilité de supprimer un tronçon de colonne intérieure (îlots plus longs, carrefours en T). */
  dropSegment: number;
  /** Probabilité qu'un tronçon supprimé devienne une impasse (voie en cul-de-sac de demi-longueur). */
  impasse: number;
  /** Recul de la façade derrière le trottoir (m) : [min, max] ; `alignement` = même recul sur toute une rive. */
  setback: [number, number];
  aligned: boolean;
  /** Espacement latéral entre deux lots (m) : [min, max] ; les modèles `mitoyen` se touchent si `attached`. */
  gap: [number, number];
  attached: boolean;
  /** Poids de sélection par catégorie (0 ou absent = exclu du bâti ordinaire). */
  categories: Partial<Record<AssetCategory, number>>;
  /** Multiplicateur des modèles explicitement tagués `quartier:<type>` (vs repli). */
  taggedBoost: number;
  /** Hauteur visée (m) en bordure et au centre du quartier ; `heightSharpness` = sévérité de l'écart. */
  heightEdge: number;
  heightCentre: number;
  heightSharpness: number;
  /** Multiplicateur des commerces le long de la voie principale. */
  commerceOnMain: number;
  equipments: EquipmentSpec[];
}

const school: EquipmentSpec = { label: 'école', tags: ['service:education'], perHa: 8, min: 0, max: 2 };
const park: EquipmentSpec = { label: 'parc', tags: ['service:loisirs', 'espace_vert'], perHa: 6, min: 1, max: 3 };
const shop: EquipmentSpec = { label: 'commerce de proximité', tags: ['commerce_de_proximite', 'service:alimentation', 'service:restauration'], perHa: 3, min: 1, max: 4 };

export const DISTRICT_PROFILES: Record<DistrictType, DistrictProfile> = {
  centre_historique: {
    type: 'centre_historique', blockW: 72, blockD: 58, jitter: 0.28,
    edgeKind: 'street', mainKind: 'street', streetKind: 'street', specialKind: 'pedestrian', specialEvery: 2,
    dropSegment: 0.22, impasse: 0,
    setback: [0, 0.4], aligned: true, gap: [0, 0.6], attached: true,
    categories: { townhouse: 3, apartment_low: 3, apartment_mid: 3, commercial: 1.6, house: 0.25 },
    taggedBoost: 3, heightEdge: 13, heightCentre: 22, heightSharpness: 1.1, commerceOnMain: 2,
    equipments: [
      { label: 'église', tags: ['service:patrimoine', 'culte'], perHa: 10, min: 1, max: 1 },
      { label: 'mairie', tags: ['service:administration'], perHa: 12, min: 0, max: 1 },
      { label: 'culture', tags: ['service:culture'], perHa: 14, min: 0, max: 1 },
      shop,
    ],
  },
  faubourg: {
    type: 'faubourg', blockW: 96, blockD: 72, jitter: 0.14,
    edgeKind: 'street', mainKind: 'avenue', streetKind: 'street', specialKind: 'oneway', specialEvery: 3,
    dropSegment: 0.1, impasse: 0,
    setback: [0.5, 2.5], aligned: true, gap: [0, 2], attached: true,
    categories: { townhouse: 3, apartment_low: 3, apartment_mid: 1.4, house: 1, commercial: 1 },
    taggedBoost: 3, heightEdge: 10, heightCentre: 17, heightSharpness: 0.9, commerceOnMain: 2.5,
    equipments: [school, park, shop],
  },
  pavillonnaire: {
    type: 'pavillonnaire', blockW: 120, blockD: 64, jitter: 0.12,
    edgeKind: 'street', mainKind: 'street', streetKind: 'street', specialKind: null, specialEvery: 0,
    dropSegment: 0.45, impasse: 0.7,
    setback: [3, 6], aligned: false, gap: [4, 9], attached: false,
    categories: { house: 6, townhouse: 0.8 },
    taggedBoost: 2.5, heightEdge: 8, heightCentre: 9, heightSharpness: 0.5, commerceOnMain: 1,
    equipments: [school, park, { ...shop, perHa: 6, max: 2 }],
  },
  affaires: {
    type: 'affaires', blockW: 128, blockD: 104, jitter: 0.05,
    edgeKind: 'avenue', mainKind: 'boulevard', streetKind: 'avenue', specialKind: 'street', specialEvery: 2,
    dropSegment: 0, impasse: 0,
    setback: [1, 3], aligned: true, gap: [2, 8], attached: false,
    categories: { skyscraper: 3, commercial: 3, apartment_mid: 0.8, apartment_high: 0.8 },
    taggedBoost: 3, heightEdge: 26, heightCentre: 120, heightSharpness: 1.3, commerceOnMain: 1.5,
    equipments: [
      { label: 'restauration', tags: ['service:restauration'], perHa: 5, min: 1, max: 3 },
      { label: 'place plantée', tags: ['service:loisirs'], perHa: 12, min: 0, max: 1 },
    ],
  },
  activites: {
    type: 'activites', blockW: 168, blockD: 120, jitter: 0.08,
    edgeKind: 'street', mainKind: 'avenue', streetKind: 'street', specialKind: null, specialEvery: 0,
    dropSegment: 0.15, impasse: 0.3,
    setback: [3, 6.5], aligned: false, gap: [6, 14], attached: false,
    categories: { industrial: 5, commercial: 1.2 },
    taggedBoost: 3, heightEdge: 10, heightCentre: 12, heightSharpness: 0.25, commerceOnMain: 2,
    equipments: [
      { label: 'carburant', tags: ['service:carburant'], perHa: 12, min: 0, max: 1 },
      { label: 'secours', tags: ['service:incendie'], perHa: 16, min: 0, max: 1 },
    ],
  },
  grands_ensembles: {
    type: 'grands_ensembles', blockW: 152, blockD: 112, jitter: 0.06,
    edgeKind: 'avenue', mainKind: 'avenue', streetKind: 'street', specialKind: null, specialEvery: 0,
    dropSegment: 0.2, impasse: 0.2,
    setback: [4, 6.5], aligned: false, gap: [10, 22], attached: false,
    categories: { apartment_high: 5, apartment_mid: 2, apartment_low: 0.8 },
    taggedBoost: 3, heightEdge: 22, heightCentre: 45, heightSharpness: 0.7, commerceOnMain: 1,
    equipments: [
      { ...school, perHa: 6, min: 1 }, { ...park, perHa: 5 },
      { label: 'grande surface', tags: ['grande_surface', 'service:alimentation'], perHa: 10, min: 1, max: 1 },
    ],
  },
};

/** Repli par identifiant pour les bâtiments de la phase 1 (sans tag `quartier:`). */
const BY_ID: Record<string, DistrictType[]> = {
  maison_pavillon_enduit: ['pavillonnaire'], maison_brique_pignon: ['pavillonnaire', 'faubourg'], maison_chalet_bois: ['pavillonnaire'],
  maison_villa_moderne: ['pavillonnaire'], maison_longere_pierre: ['pavillonnaire'], maison_mas_provencal: ['pavillonnaire'],
  maison_ville_etroite: ['faubourg', 'centre_historique'],
  mitoyennes_brique: ['faubourg', 'pavillonnaire'], mitoyennes_modernes: ['faubourg', 'pavillonnaire'],
  immeuble_petit_enduit: ['faubourg', 'grands_ensembles'], immeuble_brique_1930: ['faubourg', 'centre_historique'],
  immeuble_haussmannien: ['centre_historique'], immeuble_commerces_moderne: ['faubourg', 'affaires', 'grands_ensembles'],
  barre_logements_r9: ['grands_ensembles'], residence_gradins: ['grands_ensembles', 'affaires'],
  tour_residentielle_balcons: ['grands_ensembles', 'affaires'], tour_brique_gradins: ['grands_ensembles', 'affaires'],
  commerce_boulangerie: ['centre_historique', 'faubourg', 'pavillonnaire'], commerce_cafe_terrasse: ['centre_historique', 'faubourg', 'affaires'],
  commerce_supermarche: ['activites', 'grands_ensembles'], commerce_station_service: ['activites'],
  commerce_centre_commercial: ['affaires', 'activites'], bureaux_brise_soleil: ['affaires'],
};

/** Repli par catégorie (catalogues sans tags ni identifiants connus). */
const BY_CATEGORY: Partial<Record<AssetCategory, DistrictType[]>> = {
  house: ['pavillonnaire', 'faubourg'],
  townhouse: ['faubourg', 'centre_historique', 'pavillonnaire'],
  apartment_low: ['faubourg', 'centre_historique', 'grands_ensembles'],
  apartment_mid: ['centre_historique', 'faubourg', 'affaires', 'grands_ensembles'],
  apartment_high: ['grands_ensembles', 'affaires'],
  skyscraper: ['affaires'],
  commercial: ['centre_historique', 'faubourg', 'affaires', 'activites'],
  industrial: ['activites'],
};

const cache = new WeakMap<CatalogAsset, { types: DistrictType[]; tagged: boolean }>();

function resolve(a: CatalogAsset): { types: DistrictType[]; tagged: boolean } {
  let r = cache.get(a);
  if (r) return r;
  const tagged: DistrictType[] = [];
  for (const t of a.tags) {
    if (!t.startsWith('quartier:')) continue;
    const v = t.slice(9);
    if (isDistrictType(v) && !tagged.includes(v)) tagged.push(v);
  }
  if (tagged.length > 0) r = { types: tagged, tagged: true };
  else if (BY_ID[a.id]) r = { types: BY_ID[a.id]!, tagged: false };
  else {
    let types = BY_CATEGORY[a.category] ?? [];
    if (a.category === 'commercial') {
      if (a.tags.includes('bureaux') || a.tags.includes('tertiaire')) types = ['affaires'];
      else if (a.tags.includes('grande_surface')) types = ['activites', 'grands_ensembles'];
    }
    r = { types, tagged: false };
  }
  cache.set(a, r);
  return r;
}

/** Types de quartier où un modèle peut être posé comme bâti ordinaire (liste vide : équipement ou non-bâtiment). */
export function districtTypesOf(a: CatalogAsset): readonly DistrictType[] {
  return resolve(a).types;
}

/** Vrai si l'appartenance vient d'un tag `quartier:` explicite du catalogue. */
export function isTaggedForDistrict(a: CatalogAsset): boolean {
  return resolve(a).tagged;
}

/** Style d'un modèle (tag `style:<id>`), « inconnu » à défaut. */
export function styleOf(a: CatalogAsset): string {
  for (const t of a.tags) if (t.startsWith('style:')) return t.slice(6);
  return 'inconnu';
}

/** Valeur numérique d'un tag `cle:nombre` (0 si absent). */
export function tagNumber(a: CatalogAsset, key: string): number {
  const p = `${key}:`;
  for (const t of a.tags) {
    if (t.startsWith(p)) { const n = Number(t.slice(p.length)); if (Number.isFinite(n)) return n; }
  }
  return 0;
}

export function matchesEquipment(a: CatalogAsset, e: EquipmentSpec): boolean {
  if (e.ids?.includes(a.id)) return true;
  return a.tags.some((t) => e.tags.includes(t));
}

export { DISTRICT_TYPES };
