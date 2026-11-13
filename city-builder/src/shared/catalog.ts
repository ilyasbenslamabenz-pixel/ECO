/**
 * Format du catalogue d'assets (assets/catalog.json -> dist/assets/catalog.json).
 * Indépendant du moteur : le même JSON peut être importé par un outil Unity/Unreal.
 * AUCUN import de three ni du DOM.
 */
import { CATALOG_SCHEMA_VERSION } from './constants';

/** Catégories de bâtiments (exigence client : variété d'architectures). */
export const BUILDING_CATEGORIES = [
  'house',          // maison individuelle
  'townhouse',      // maison mitoyenne
  'apartment_low',  // petit immeuble résidentiel (R+1 à R+3)
  'apartment_mid',  // immeuble moyen (R+4 à R+8)
  'apartment_high', // haute densité (R+9 et plus, hors gratte-ciel)
  'skyscraper',     // gratte-ciel
  'commercial',     // commerces, bureaux bas
  'industrial',     // industrie, entrepôts
  'public',         // services publics (mairie, école, hôpital, pompiers...)
] as const;
export type BuildingCategory = (typeof BUILDING_CATEGORIES)[number];

export const OTHER_CATEGORIES = [
  'vehicle',
  'tree',
  'vegetation',       // haies, buissons, massifs
  'street_furniture', // bancs, lampadaires, abribus, poubelles...
  'prop',             // autres décors
  'transport',        // pièces du port et de l'aéroport (composées par le module `hubs`, phase 2C)
] as const;
export type OtherCategory = (typeof OTHER_CATEGORIES)[number];

export type AssetCategory = BuildingCategory | OtherCategory;

export const ASSET_CATEGORIES: readonly AssetCategory[] = [...BUILDING_CATEGORIES, ...OTHER_CATEGORIES];

export function isBuildingCategory(c: string): c is BuildingCategory {
  return (BUILDING_CATEGORIES as readonly string[]).includes(c);
}

/** Seuils minimaux de triangles (LOD0) par catégorie : garde-fou anti-placeholder. */
export const MIN_TRIANGLES_LOD0: Record<AssetCategory, number> = {
  house: 300,
  townhouse: 300,
  apartment_low: 400,
  apartment_mid: 500,
  apartment_high: 600,
  skyscraper: 600,
  commercial: 400,
  industrial: 400,
  public: 500,
  vehicle: 250,
  tree: 200,
  vegetation: 100,
  street_furniture: 60,
  prop: 60,
  transport: 200,
};

/** Un niveau de détail : un fichier GLB et la distance caméra max à laquelle il s'affiche. */
export interface AssetLod {
  /** Chemin relatif à dist/assets/ (ex. "models/buildings/maison_ardoise_lod0.glb"). */
  file: string;
  /** Distance maximale (m) d'affichage de ce LOD ; le dernier LOD peut valoir Infinity -> on écrit 1e9. */
  maxDistance: number;
  /** Nombre de triangles mesuré par le pipeline (renseigné automatiquement). */
  triangles?: number;
}

/** Point de connexion en façade (accès route), en coordonnées locales du modèle (m), orientation rot=0. */
export interface FrontagePoint {
  x: number;
  z: number;
  /** Normale sortante de la façade (vecteur unitaire XZ). */
  nx: number;
  nz: number;
  kind: 'pedestrian' | 'vehicle' | 'delivery';
}

/** Variante visuelle (évite la répétition) : surcharges de matériaux et échelle verticale. */
export interface AssetVariant {
  id: string;
  nameFr: string;
  /** Surcharges par nom de matériau glTF : couleur multiplicative (#rrggbb) et/ou jeu de textures du catalogue. */
  materialOverrides?: Record<string, { color?: string; textureSet?: string }>;
  /** Échelle verticale appliquée (1 = hauteur d'origine). Bornée à [0.6, 1.6]. */
  heightScale?: number;
}

export interface AssetLicense {
  /** Identifiant SPDX, ex. "CC0-1.0". */
  spdx: string;
  /** Provenance exacte : URL Poly Haven ou outil générateur interne (ex. "tools/generators/houses.ts#maisonArdoise"). */
  source: string;
  author: string;
}

export interface CatalogAsset {
  id: string;
  nameFr: string;
  category: AssetCategory;
  /** LODs triés du plus détaillé (0) au moins détaillé. Au moins un. */
  lods: AssetLod[];
  /** Dimensions de la boîte englobante du LOD0 (m). */
  dimensions: { width: number; depth: number; height: number };
  /** Empreinte au sol en cases de TILE_SIZE (bâtiments) ; 0x0 pour véhicules/décors non bloquants. */
  footprint: { tilesX: number; tilesZ: number };
  /** Bâtiments : coût de construction et entretien mensuel (crédits). */
  cost: number;
  upkeepPerMonth: number;
  /** Capacités (bâtiments) : habitants, emplois. */
  capacity: { residents: number; jobs: number };
  frontage: FrontagePoint[];
  variants: AssetVariant[];
  /** Identifiants des jeux de textures du catalogue utilisés (pour vérification). */
  textureSets: string[];
  license: AssetLicense;
  tags: string[];
  /** Véhicules uniquement. */
  vehicle?: { kind: 'car' | 'van' | 'bus' | 'truck' | 'service'; maxSpeedKmh: number; lengthM: number };
}

/** Jeu de textures PBR (fichiers relatifs à dist/assets/). */
export interface TextureSet {
  id: string;
  nameFr: string;
  albedo: string;
  normal: string;
  roughness?: string;
  metalness?: string;
  ao?: string;
  /** ARM empaqueté (AO/Roughness/Metalness) si fourni à la place des trois cartes séparées. */
  arm?: string;
  /** Taille réelle couverte par une répétition de la texture (m). */
  tileSizeM: number;
  license: AssetLicense;
}

export interface HdriEntry {
  id: string;
  nameFr: string;
  file: string;
  license: AssetLicense;
}

export interface AssetCatalog {
  schemaVersion: number;
  generatedAt: string;
  assets: CatalogAsset[];
  textureSets: TextureSet[];
  hdris: HdriEntry[];
}

export interface CatalogIssue {
  assetId: string;
  message: string;
}

/** Validation structurelle du catalogue (sans accès disque). Renvoie la liste des problèmes. */
export function validateCatalog(cat: AssetCatalog): CatalogIssue[] {
  const issues: CatalogIssue[] = [];
  const push = (assetId: string, message: string): void => { issues.push({ assetId, message }); };
  if (cat.schemaVersion !== CATALOG_SCHEMA_VERSION) {
    push('*', `schemaVersion ${cat.schemaVersion} != ${CATALOG_SCHEMA_VERSION}`);
  }
  const ids = new Set<string>();
  const texIds = new Set(cat.textureSets.map((t) => t.id));
  for (const t of cat.textureSets) {
    if (!t.albedo || !t.normal) push(t.id, 'jeu de textures sans albedo ou normal');
    if (!t.license?.spdx || !t.license.source) push(t.id, 'licence/source manquante');
  }
  for (const h of cat.hdris) {
    if (!h.license?.spdx || !h.license.source) push(h.id, 'licence/source HDRI manquante');
  }
  for (const a of cat.assets) {
    if (!/^[a-z0-9_]+$/.test(a.id)) push(a.id, 'id invalide (attendu [a-z0-9_]+)');
    if (ids.has(a.id)) push(a.id, 'id en double');
    ids.add(a.id);
    if (!a.nameFr) push(a.id, 'nameFr manquant');
    if (!ASSET_CATEGORIES.includes(a.category)) push(a.id, `catégorie inconnue ${a.category}`);
    if (!a.lods || a.lods.length === 0) push(a.id, 'aucun LOD');
    else {
      for (let i = 1; i < a.lods.length; i++) {
        const prev = a.lods[i - 1]!;
        const cur = a.lods[i]!;
        if (cur.maxDistance <= prev.maxDistance) push(a.id, `LOD${i} : maxDistance non croissante`);
      }
      for (const l of a.lods) if (!l.file.endsWith('.glb')) push(a.id, `LOD non GLB : ${l.file}`);
    }
    const d = a.dimensions;
    if (!(d.width > 0 && d.depth > 0 && d.height > 0)) push(a.id, 'dimensions invalides');
    if (isBuildingCategory(a.category)) {
      if (a.footprint.tilesX < 1 || a.footprint.tilesZ < 1) push(a.id, 'empreinte bâtiment < 1 case');
      if (a.cost <= 0) push(a.id, 'coût <= 0');
      if (a.frontage.length === 0) push(a.id, 'aucun point de connexion façade');
    }
    if (a.category === 'vehicle' && !a.vehicle) push(a.id, 'véhicule sans bloc vehicle');
    for (const v of a.variants) {
      if (v.heightScale !== undefined && (v.heightScale < 0.6 || v.heightScale > 1.6)) {
        push(a.id, `variante ${v.id} : heightScale hors [0.6,1.6]`);
      }
      for (const o of Object.values(v.materialOverrides ?? {})) {
        if (o.textureSet && !texIds.has(o.textureSet)) push(a.id, `variante ${v.id} : textureSet inconnu ${o.textureSet}`);
      }
    }
    for (const t of a.textureSets) if (!texIds.has(t)) push(a.id, `textureSet inconnu ${t}`);
    if (!a.license?.spdx || !a.license.source || !a.license.author) push(a.id, 'licence/source/auteur manquant');
  }
  return issues;
}

/** Index rapide id -> index numérique (utilisé par la simulation pour stocker un Uint16). */
export function buildAssetIndex(cat: AssetCatalog): Map<string, number> {
  const m = new Map<string, number>();
  cat.assets.forEach((a, i) => m.set(a.id, i));
  return m;
}

export function emptyCatalog(): AssetCatalog {
  return { schemaVersion: CATALOG_SCHEMA_VERSION, generatedAt: new Date(0).toISOString(), assets: [], textureSets: [], hdris: [] };
}
