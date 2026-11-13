/**
 * Sélection curatée d'assets Poly Haven (tous CC0) pour Aube Urbaine.
 * Chaque entrée référence un identifiant Poly Haven ; le pipeline télécharge (cache),
 * optimise et inscrit l'asset au catalogue avec sa licence et sa source exacte.
 * Modifier ce fichier puis relancer `npm run assets`.
 */
import type { AssetCategory } from '../../src/shared/catalog';

// ---------------------------------------------------------------------------
// Textures PBR (1k Poly Haven -> WebP : albedo et normal 1024 px, ARM 512 px)
// ---------------------------------------------------------------------------
export type TextureRole =
  | 'route' | 'trottoir' | 'paves' | 'bordure' | 'sol_beton'
  | 'terrain' | 'brique' | 'enduit' | 'bardage' | 'beton_facade' | 'toiture' | 'metal';

export interface TextureSpec {
  /** Identifiant du jeu dans le catalogue (dossier assets/textures/<id>/). */
  id: string;
  /** Identifiant Poly Haven. */
  ph: string;
  nameFr: string;
  role: TextureRole;
  /** Taille (px) de l'albedo et de la normale ; ARM = moitié. Défaut 1024. */
  size?: number;
}

export const TEXTURES: TextureSpec[] = [
  // Voirie
  { id: 'route_asphalte', ph: 'asphalt_04', nameFr: 'Asphalte de chaussée', role: 'route' },
  { id: 'route_asphalte_use', ph: 'asphalt_02', nameFr: 'Asphalte usé (fissuré)', role: 'route' },
  { id: 'trottoir_dalles', ph: 'concrete_pavement', nameFr: 'Trottoir en dalles de béton', role: 'trottoir' },
  { id: 'paves_granit', ph: 'cobblestone_pavement', nameFr: 'Pavés de place', role: 'paves' },
  { id: 'bordure_granit', ph: 'granite_tile_03', nameFr: 'Bordure en granit', role: 'bordure' },
  { id: 'sol_beton_brut', ph: 'brushed_concrete', nameFr: 'Béton brossé (parkings, cours)', role: 'sol_beton' },
  // Terrain (dossiers terrain_* : utilisés par l'agent terrain pour le splatting)
  { id: 'terrain_herbe', ph: 'leafy_grass', nameFr: 'Herbe', role: 'terrain' },
  { id: 'terrain_terre', ph: 'dirt', nameFr: 'Terre', role: 'terrain' },
  { id: 'terrain_roche', ph: 'rock_face', nameFr: 'Roche', role: 'terrain' },
  { id: 'terrain_sable', ph: 'coast_sand_01', nameFr: 'Sable', role: 'terrain' },
  { id: 'terrain_gravier', ph: 'gravel_floor', nameFr: 'Gravier', role: 'terrain' },
  // Façades : briques
  { id: 'brique_rouge', ph: 'red_brick_03', nameFr: 'Brique rouge sombre', role: 'brique' },
  { id: 'brique_orange', ph: 'large_red_bricks', nameFr: 'Brique orangée', role: 'brique' },
  { id: 'brique_parement', ph: 'exterior_wall_cladding_02', nameFr: 'Parement de briques moderne', role: 'brique' },
  // Façades : enduits
  { id: 'enduit_blanc', ph: 'white_stucco', nameFr: 'Enduit blanc', role: 'enduit' },
  { id: 'enduit_creme', ph: 'beige_wall_001', nameFr: 'Enduit crème', role: 'enduit' },
  { id: 'enduit_peint', ph: 'painted_plaster_wall', nameFr: 'Enduit peint', role: 'enduit' },
  // Façades : bardages
  { id: 'bardage_bois', ph: 'weathered_plank_siding', nameFr: 'Bardage bois horizontal', role: 'bardage' },
  { id: 'bardage_blanc', ph: 'white_planks_clean', nameFr: 'Bardage bois peint blanc', role: 'bardage' },
  { id: 'bardage_composite', ph: 'exterior_wall_cladding_03', nameFr: 'Bardage composite clair', role: 'bardage' },
  // Façades : béton
  { id: 'beton_facade', ph: 'concrete_wall_008', nameFr: 'Béton de façade lisse', role: 'beton_facade' },
  { id: 'panneaux_facade_sombres', ph: 'concrete_tile_facade', nameFr: 'Panneaux de façade sombres', role: 'beton_facade' },
  { id: 'carreaux_facade', ph: 'rectangular_facade_tiles', nameFr: 'Carreaux de façade gris', role: 'beton_facade' },
  // Toitures
  { id: 'toit_tuiles', ph: 'clay_roof_tiles_02', nameFr: 'Tuiles de terre cuite', role: 'toiture' },
  { id: 'toit_ardoise', ph: 'roof_slates_02', nameFr: 'Ardoise', role: 'toiture' },
  { id: 'toit_tuiles_grises', ph: 'grey_roof_tiles', nameFr: 'Tuiles grises', role: 'toiture' },
  { id: 'toit_bac_acier', ph: 'box_profile_metal_sheet', nameFr: 'Bac acier rouge', role: 'toiture' },
  { id: 'toit_tole_ondulee', ph: 'corrugated_iron_02', nameFr: 'Tôle ondulée (zinc)', role: 'toiture' },
  // Métal
  { id: 'metal_rideau', ph: 'painted_metal_shutter', nameFr: 'Rideau métallique', role: 'metal' },
  { id: 'metal_conteneur', ph: 'container_side', nameFr: 'Tôle de conteneur', role: 'metal' },
  { id: 'metal_larme', ph: 'metal_plate', nameFr: 'Tôle larmée', role: 'metal' },
];

// ---------------------------------------------------------------------------
// HDRI (éclairage par environnement + ciel)
// ---------------------------------------------------------------------------
export interface HdriSpec { id: string; ph: string; nameFr: string }
export const HDRIS: HdriSpec[] = [
  { id: 'ciel_jour', ph: 'kloofendal_48d_partly_cloudy_puresky', nameFr: 'Ciel de jour partiellement nuageux' },
  { id: 'ciel_crepuscule', ph: 'qwantani_dusk_2_puresky', nameFr: 'Ciel de crépuscule' },
];

// ---------------------------------------------------------------------------
// Modèles
// ---------------------------------------------------------------------------
export interface ModelSpec {
  /** Identifiant catalogue ([a-z0-9_]). */
  id: string;
  /** Identifiant Poly Haven. */
  ph: string;
  nameFr: string;
  category: AssetCategory;
  /**
   * Nœuds racine à conserver (expression régulière sur le nom). Les packs Poly Haven
   * regroupent souvent plusieurs variantes côte à côte : on en extrait une par asset.
   */
  nodes?: RegExp;
  /** Budget de triangles du LOD0 (LOD1 ≈ 35 %, LOD2 ≈ 10 %). */
  lod0Triangles: number;
  /** Taille max des textures du LOD0 (px). LOD1 = /2, LOD2 = /4 (min 128). */
  textureSize: number;
  /** Rotation autour de Y (degrés) pour orienter la face principale vers +Z. */
  rotateY?: number;
  /** Distances d'affichage des LOD (m). */
  lodDistances: [number, number];
  /** Coût de pose (crédits) pour les décors plaçables ; 0 = décor non vendu. */
  cost?: number;
  tags: string[];
  /** Variantes d'échelle verticale (anti-répétition), ex. [0.85, 1.15]. */
  heightVariants?: number[];
}

const TREE_LODS: [number, number] = [90, 260];
const FURN_LODS: [number, number] = [45, 140];
const PROP_LODS: [number, number] = [35, 100];

export const MODELS: ModelSpec[] = [
  // Arbres
  { id: 'arbre_jacaranda', ph: 'jacaranda_tree', nameFr: 'Jacaranda (grand arbre d’avenue)', category: 'tree', lod0Triangles: 24000, textureSize: 1024, lodDistances: TREE_LODS, cost: 900, tags: ['arbre', 'feuillu', 'parc', 'avenue'], heightVariants: [0.8, 1.0, 1.15] },
  // arbre_feuillu_rond / arbre_feuillu_jeune : remplacés par les arbres denses de tools/generators/generate_trees.py (Blender).
  { id: 'arbre_petit_ornement', ph: 'tree_small_02', nameFr: 'Petit arbre d’ornement', category: 'tree', lod0Triangles: 16000, textureSize: 1024, lodDistances: TREE_LODS, cost: 300, tags: ['arbre', 'jardin', 'ornement'], heightVariants: [0.9, 1.1, 1.3] },
  // Végétation basse
  { id: 'arbuste_searsia_a', ph: 'searsia_lucida', nodes: /_a_LOD0$/, nameFr: 'Arbuste persistant (grand)', category: 'vegetation', lod0Triangles: 9000, textureSize: 512, lodDistances: FURN_LODS, cost: 120, tags: ['arbuste', 'jardin', 'haie'], heightVariants: [0.8, 1.0, 1.2] },
  { id: 'arbuste_searsia_d', ph: 'searsia_lucida', nodes: /_d_LOD0$/, nameFr: 'Arbuste persistant (moyen)', category: 'vegetation', lod0Triangles: 7000, textureSize: 512, lodDistances: FURN_LODS, cost: 90, tags: ['arbuste', 'jardin'], heightVariants: [0.8, 1.0, 1.2] },
  { id: 'arbuste_searsia_b', ph: 'searsia_lucida', nodes: /_b_LOD0$/, nameFr: 'Arbuste persistant arrondi', category: 'vegetation', lod0Triangles: 8000, textureSize: 512, lodDistances: FURN_LODS, cost: 110, tags: ['arbuste', 'jardin', 'haie'], heightVariants: [0.8, 1.0, 1.2] },
  { id: 'arbuste_searsia_e', ph: 'searsia_lucida', nodes: /_e_LOD0$/, nameFr: 'Petit arbuste (massif)', category: 'vegetation', lod0Triangles: 5000, textureSize: 512, lodDistances: FURN_LODS, cost: 50, tags: ['arbuste', 'massif'], heightVariants: [0.8, 1.0, 1.25] },
  { id: 'jardiniere_plante_a', ph: 'potted_plant_01', nameFr: 'Plante en pot (terrasse)', category: 'vegetation', lod0Triangles: 8000, textureSize: 512, lodDistances: PROP_LODS, cost: 40, tags: ['pot', 'terrasse', 'commerce'] },
  { id: 'jardiniere_plante_b', ph: 'potted_plant_02', nameFr: 'Plante en pot basse', category: 'vegetation', lod0Triangles: 6000, textureSize: 512, lodDistances: PROP_LODS, cost: 35, tags: ['pot', 'terrasse', 'commerce'] },
  // Mobilier urbain
  { id: 'lampadaire_fonte', ph: 'street_lamp_01', nameFr: 'Lampadaire en fonte', category: 'street_furniture', lod0Triangles: 8000, textureSize: 1024, lodDistances: FURN_LODS, cost: 250, tags: ['éclairage', 'rue', 'parc'] },
  { id: 'poteau_electrique_a', ph: 'modular_electricity_poles', nodes: /^preset_01_/, nameFr: 'Poteau électrique avec transformateur', category: 'street_furniture', lod0Triangles: 9000, textureSize: 512, lodDistances: FURN_LODS, cost: 300, tags: ['réseau', 'électricité', 'périphérie'] },
  { id: 'poteau_electrique_b', ph: 'modular_electricity_poles', nodes: /^preset_02_/, nameFr: 'Poteau électrique à traverse', category: 'street_furniture', lod0Triangles: 9000, textureSize: 512, lodDistances: FURN_LODS, cost: 250, tags: ['réseau', 'électricité', 'périphérie'] },
  { id: 'borne_incendie', ph: 'fire_hydrant', nodes: /^fire_hydrant(_cap_01|_chain)?$/, nameFr: 'Borne d’incendie', category: 'street_furniture', lod0Triangles: 5000, textureSize: 512, lodDistances: PROP_LODS, cost: 80, tags: ['pompiers', 'trottoir'] },
  { id: 'poubelle_metal', ph: 'metal_trash_can', nodes: /^metal_trash_can(_handle_left|_handle_right|_lid)?$/, nameFr: 'Poubelle métallique', category: 'street_furniture', lod0Triangles: 4000, textureSize: 512, lodDistances: PROP_LODS, cost: 30, tags: ['propreté', 'trottoir'] },
  { id: 'banc_bois', ph: 'painted_wooden_bench', nameFr: 'Banc en bois peint', category: 'street_furniture', lod0Triangles: 2000, textureSize: 512, lodDistances: PROP_LODS, cost: 60, tags: ['assise', 'parc', 'trottoir'] },
  { id: 'table_pique_nique', ph: 'wooden_picnic_table', nameFr: 'Table de pique-nique', category: 'street_furniture', lod0Triangles: 5000, textureSize: 512, lodDistances: PROP_LODS, cost: 90, tags: ['parc', 'assise'] },
  { id: 'terrasse_cafe', ph: 'outdoor_table_chair_set_01', nameFr: 'Table et chaises de terrasse', category: 'street_furniture', lod0Triangles: 6000, textureSize: 512, lodDistances: PROP_LODS, cost: 70, tags: ['terrasse', 'commerce', 'café'] },
  { id: 'armoire_electrique', ph: 'utility_box_02', nameFr: 'Armoire électrique de rue', category: 'street_furniture', lod0Triangles: 4000, textureSize: 512, lodDistances: PROP_LODS, cost: 120, tags: ['réseau', 'trottoir'] },
  { id: 'coffret_technique', ph: 'utility_box_01', nameFr: 'Coffret technique', category: 'street_furniture', lod0Triangles: 3000, textureSize: 512, lodDistances: PROP_LODS, cost: 80, tags: ['réseau', 'trottoir'] },
  { id: 'separateur_beton', ph: 'concrete_road_barrier', nameFr: 'Séparateur de voie en béton', category: 'street_furniture', lod0Triangles: 3000, textureSize: 512, lodDistances: PROP_LODS, cost: 50, tags: ['chantier', 'voirie'] },
  // Décors
  { id: 'caisse_bois', ph: 'wooden_crate_01', nameFr: 'Caisse en bois', category: 'prop', lod0Triangles: 3000, textureSize: 512, lodDistances: PROP_LODS, tags: ['industrie', 'marché'] },
  { id: 'tonneau_metal', ph: 'Barrel_01', nameFr: 'Fût métallique', category: 'prop', lod0Triangles: 2500, textureSize: 512, lodDistances: PROP_LODS, tags: ['industrie'] },
  { id: 'sac_poubelle', ph: 'trashbag', nameFr: 'Sac poubelle', category: 'prop', lod0Triangles: 2000, textureSize: 512, lodDistances: PROP_LODS, tags: ['propreté', 'ruelle'] },
  { id: 'voiture_bachee', ph: 'covered_car', nameFr: 'Voiture sous bâche (décor)', category: 'prop', lod0Triangles: 6000, textureSize: 1024, lodDistances: FURN_LODS, tags: ['stationnement', 'garage'] },
];

// ---------------------------------------------------------------------------
// Phase 2C — mobilier urbain européen (Poly Haven, CC0 ; licence vérifiée asset par asset :
// docs/ASSET_LICENSES_STUDY.md). Construits aussi par `npx tsx tools/props/build.ts`.
// ---------------------------------------------------------------------------
export const P2C_STREET_FURNITURE_PH: ModelSpec[] = [
  { id: 'banc_modulaire', ph: 'modular_street_seating', nodes: /^(crossbar|legs_double|legs_single|suspended_support_01|back_support_r|back_support_l|arm_rest_01|seat|seat_back)$/, nameFr: 'Banc urbain à dossier (bois et acier)', category: 'street_furniture', lod0Triangles: 6000, textureSize: 512, lodDistances: PROP_LODS, cost: 80, tags: ['assise', 'place', 'trottoir'] },
  { id: 'jardiniere_bac_bois', ph: 'planter_box_02', nameFr: 'Jardinière longue en bois', category: 'street_furniture', lod0Triangles: 5000, textureSize: 256, lodDistances: PROP_LODS, cost: 45, tags: ['jardinière', 'terrasse', 'rue piétonne'] },
  { id: 'jardiniere_haute_bois', ph: 'planter_box_03', nameFr: 'Jardinière haute en bois', category: 'street_furniture', lod0Triangles: 5000, textureSize: 256, lodDistances: PROP_LODS, cost: 55, tags: ['jardinière', 'terrasse', 'rue piétonne'] },
  { id: 'plaque_egout', ph: 'water_manhole_cover', nameFr: 'Plaque d’égout en fonte', category: 'street_furniture', lod0Triangles: 2500, textureSize: 256, lodDistances: [30, 80], cost: 0, tags: ['réseau', 'chaussée', 'trottoir', 'au sol'] },
  { id: 'separateur_beton_bas', ph: 'concrete_road_barrier_02', nameFr: 'Bloc béton de protection (bas)', category: 'street_furniture', lod0Triangles: 3000, textureSize: 256, lodDistances: PROP_LODS, cost: 50, tags: ['chantier', 'voirie', 'sécurité'] },
];
// Écarté : modular_chainlink_fence (grillage) — l'opacité du grillage est une carte séparée non fusionnée par
// le pipeline (rendu opaque) ; à reprendre si models.ts gère un jour les cartes alpha séparées.
MODELS.push(...P2C_STREET_FURNITURE_PH);
