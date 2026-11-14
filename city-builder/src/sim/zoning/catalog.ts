/**
 * Zonage — bâtiments du catalogue autorisés par zone, et leur NIVEAU (1 à 3) pour la densification.
 *
 * Correspondance (catégories et étiquettes du catalogue, mêmes règles que la démographie) :
 *  - résidentiel faible  : maisons individuelles (`house`) ;
 *  - résidentiel moyen   : maisons mitoyennes (`townhouse`), petits immeubles (`apartment_low`) ;
 *  - résidentiel dense   : immeubles moyens (`apartment_mid`) et haute densité (`apartment_high`) ;
 *  - commerces           : `commercial` sans l'étiquette `bureaux` / `tertiaire` ;
 *  - bureaux             : `commercial` étiqueté `bureaux` / `tertiaire`, gratte-ciel (`skyscraper`) ;
 *  - industrie           : `industrial`, hors ouvrages de réseau (étiquettes `electricite`, `service:eau`).
 * Niveau : rang de la capacité (habitants + emplois) dans la zone, découpé en trois tiers ; les bâtiments
 * des niveaux supérieurs ne poussent que dans un quartier valorisé (densification).
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import type { AssetCatalog, CatalogAsset } from '../../shared/catalog';
import { ZONE_TYPES, type ZoneType } from '../../shared/protocol-ext/zonage';

export const MAX_LEVEL = 3;

/** Étiquettes qui excluent un bâtiment de la croissance automatique (ouvrages publics ou de réseau). */
const EXCLUDED_TAGS = ['electricite', 'service:eau', 'service:electricite'];

const isOffice = (a: CatalogAsset): boolean => a.tags.includes('bureaux') || a.tags.includes('tertiaire');

/** Zone d'un modèle du catalogue (null : ne pousse dans aucune zone). */
export function zoneForAsset(a: CatalogAsset): ZoneType | null {
  if (a.footprint.tilesX < 1 || a.footprint.tilesZ < 1 || a.frontage.length === 0) return null;
  if (a.tags.some((t) => EXCLUDED_TAGS.includes(t))) return null;
  switch (a.category) {
    case 'house': return 'res_faible';
    case 'townhouse': case 'apartment_low': return 'res_moyen';
    case 'apartment_mid': case 'apartment_high': return 'res_dense';
    case 'commercial': return isOffice(a) ? 'bureaux' : 'commerce';
    case 'skyscraper': return 'bureaux';
    case 'industrial': return 'industrie';
    default: return null;
  }
}

export interface ZoneAsset {
  asset: CatalogAsset;
  /** Index dans le catalogue. */
  index: number;
  level: number;
  capacity: number;
}

export type ZoneCatalog = Record<ZoneType, ZoneAsset[]>;

/** Modèles par zone, triés par capacité croissante, niveau par tiers. */
export function buildZoneCatalog(cat: AssetCatalog | null): ZoneCatalog {
  const out = Object.fromEntries(ZONE_TYPES.map((z) => [z, [] as ZoneAsset[]])) as ZoneCatalog;
  if (!cat) return out;
  cat.assets.forEach((a, index) => {
    const z = zoneForAsset(a);
    if (z) out[z].push({ asset: a, index, level: 1, capacity: Math.max(0, a.capacity.residents) + Math.max(0, a.capacity.jobs) });
  });
  for (const z of ZONE_TYPES) {
    const list = out[z];
    list.sort((a, b) => a.capacity - b.capacity || a.asset.cost - b.asset.cost || (a.asset.id < b.asset.id ? -1 : 1));
    const n = list.length;
    list.forEach((e, k) => { e.level = n <= 1 ? 1 : Math.min(MAX_LEVEL, 1 + Math.floor((k * MAX_LEVEL) / n)); });
  }
  return out;
}

/** Niveau maximal présent dans une zone (1 si la zone n'a qu'un niveau). */
export function maxLevelOf(list: readonly ZoneAsset[]): number {
  let m = 0;
  for (const e of list) if (e.level > m) m = e.level;
  return m;
}
