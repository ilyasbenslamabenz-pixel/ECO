/**
 * Matériaux des assets transport. Tous les GLB partagent les MÊMES fichiers de textures (aucun pixel dupliqué) :
 *  - `transport_peinture` (acier peint répétable, quasi blanc, teinté par baseColorFactor) ;
 *  - `transport_tole` (tôle nervurée trapézoïdale neutre : conteneurs, bardages ; teintée) ;
 *  - `transport_atlas` (atlas de détails 2048² : vitrages, livrées, logos, marquages, feux…) — matériau opaque
 *    `atlas` et matériau `decal` (alpha MASK) sur la même image ;
 *  - jeux Poly Haven déjà distribués par le jeu (béton, béton de façade, asphalte) ;
 *  - verre (sans texture).
 * Le nom glTF du matériau est la clé ci-dessous : les variantes du catalogue surchargent par ce nom.
 */
export type TexSetId = 'transport_peinture' | 'transport_tole' | 'transport_atlas' | 'sol_beton_brut' | 'beton_facade' | 'route_asphalte';

export interface MatDef {
  set: TexSetId | null;
  /** Couleur multiplicative #rrggbb. */
  color: string;
  /** Taille réelle d'une répétition (m) pour les UV « tuile » (ignorée pour l'atlas). */
  tile?: number;
  metal?: number;
  rough?: number;
  normalScale?: number;
  alpha?: 'MASK';
  emissive?: boolean;
  doubleSided?: boolean;
  role: string;
}

/** Pas de la tôle nervurée : 4 nervures par répétition. */
export const TOLE_TILE = 1.12;

const P = (color: string, role = 'peinture', metal = 1, rough = 1): MatDef => ({ set: 'transport_peinture', color, tile: 1.5, metal, rough, role });
const C = (color: string): MatDef => ({ set: 'transport_tole', color, tile: TOLE_TILE, metal: 1, rough: 1, role: 'conteneur' });
const B = (color: string): MatDef => ({ set: 'transport_tole', color, tile: TOLE_TILE * 1.25, metal: 1, rough: 1, role: 'bardage' });

export const MATERIALS = {
  // acier peint (teinté)
  jaune: P('#e0a321'),
  bleu: P('#2a5b8c'),
  bleu_nuit: P('#1d2f4a'),
  blanc: P('#e9e9e5'),
  creme: P('#e4dccb'),
  gris_clair: P('#aab0b5'),
  gris: P('#7b8187'),
  gris_fonce: P('#45494f'),
  noir: P('#202225'),
  rouge: P('#a3302a'),
  antifouling: P('#7d2a24'),
  vert_pont: P('#55704c'),
  orange: P('#dd6a1f'),
  livree: P('#1d4d96', 'livree'),
  livree_accent: P('#e0a83a', 'livree'),
  // conteneurs (tôle ondulée Poly Haven teintée)
  ct_rouge: C('#a33a2c'),
  ct_bleu: C('#2c5a8e'),
  ct_vert: C('#3f6e48'),
  ct_gris: C('#9a9fa3'),
  ct_orange: C('#c96b2c'),
  ct_blanc: C('#dcdcd6'),
  ct_jaune: C('#c9a236'),
  ct_brun: C('#734a33'),
  // sols et bâtiments (Poly Haven)
  beton: { set: 'sol_beton_brut', color: '#c9c6bf', tile: 2.5, metal: 1, rough: 1, role: 'beton' },
  beton_clair: { set: 'beton_facade', color: '#e6e3dc', tile: 2.71, metal: 1, rough: 1, role: 'facade' },
  asphalte: { set: 'route_asphalte', color: '#9a9a9a', tile: 4.04, metal: 1, rough: 1, role: 'asphalte' },
  bardage: B('#b9bec3'),
  bardage_bleu: B('#5f84a8'),
  bardage_blanc: B('#e6e5df'),
  bardage_gris: B('#6c7177'),
  // atlas
  atlas: { set: 'transport_atlas', color: '#ffffff', metal: 1, rough: 1, emissive: true, role: 'details' },
  decal: { set: 'transport_atlas', color: '#ffffff', metal: 1, rough: 1, alpha: 'MASK', doubleSided: true, emissive: true, role: 'decal' },
  verre: { set: null, color: '#0b1218', metal: 0.2, rough: 0.06, role: 'verre' },
} satisfies Record<string, MatDef>;

export type MatKey = keyof typeof MATERIALS;
export const MAT_KEYS = Object.keys(MATERIALS) as MatKey[];

/** Teintes de conteneurs utilisées pour remplir piles et navires (ordre pseudo-aléatoire). */
export const CONTAINER_MATS: MatKey[] = ['ct_rouge', 'ct_bleu', 'ct_vert', 'ct_gris', 'ct_orange', 'ct_blanc', 'ct_jaune', 'ct_brun'];

/** Accès typé uniforme aux définitions. */
export const MAT: Record<MatKey, MatDef> = MATERIALS;
