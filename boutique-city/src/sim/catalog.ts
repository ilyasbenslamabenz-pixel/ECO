/**
 * Catalogue du jeu : types de commerce, mobilier (grille de 1 m), produits, services du quartier, véhicules,
 * prêts, campagnes de publicité, repas et besoins du personnage. Prix en CHF. TypeScript pur.
 */

export type ShopType = 'epicerie' | 'cafe' | 'vetements' | 'fleuriste' | 'boulangerie' | 'fastfood' | 'primeur';
/** Meuble qui stocke et présente un produit. */
export type StoreKind = 'rayon' | 'frigo' | 'comptoir' | 'vitrine' | 'portant';
export type FurnitureKind = 'caisse' | StoreKind | 'machine' | 'table' | 'deco';

export interface FurnitureDef {
  id: string;
  nameFr: string;
  kind: FurnitureKind;
  /** Emprise en cases de 1 m (sans rotation : largeur selon x, profondeur selon z). */
  w: number;
  d: number;
  price: number;
  /** Unités de marchandise stockées (meubles de présentation). */
  capacity?: number;
  /** Places assises (tables). */
  seats?: number;
  /** Points de décoration. */
  decor?: number;
  /** Couleur de l'éditeur (CSS). */
  color: string;
}

export const FURNITURE: readonly FurnitureDef[] = [
  { id: 'caisse', nameFr: 'Caisse', kind: 'caisse', w: 2, d: 1, price: 1500, color: '#e0b04a' },
  { id: 'rayon', nameFr: 'Rayonnage', kind: 'rayon', w: 3, d: 1, price: 700, capacity: 80, color: '#8fa7c4' },
  { id: 'frigo', nameFr: 'Vitrine réfrigérée', kind: 'frigo', w: 2, d: 1, price: 1800, capacity: 60, color: '#7fd0e8' },
  { id: 'comptoir', nameFr: 'Comptoir', kind: 'comptoir', w: 2, d: 1, price: 900, capacity: 150, color: '#b58a62' },
  { id: 'vitrine', nameFr: 'Vitrine à pâtisseries', kind: 'vitrine', w: 2, d: 1, price: 1400, capacity: 50, color: '#e8a0b4' },
  { id: 'portant', nameFr: 'Portant à vêtements', kind: 'portant', w: 2, d: 1, price: 500, capacity: 40, color: '#b49ae0' },
  { id: 'machine', nameFr: 'Machine à café', kind: 'machine', w: 1, d: 1, price: 2800, color: '#6b5a50' },
  { id: 'table', nameFr: 'Table et 4 chaises', kind: 'table', w: 2, d: 2, price: 350, seats: 4, decor: 0.5, color: '#c9a37a' },
  { id: 'plante', nameFr: 'Plante', kind: 'deco', w: 1, d: 1, price: 150, decor: 1, color: '#5fae6a' },
  { id: 'lampe', nameFr: 'Lampadaire design', kind: 'deco', w: 1, d: 1, price: 220, decor: 1.2, color: '#f0d890' },
  { id: 'tapis', nameFr: 'Tapis', kind: 'deco', w: 2, d: 2, price: 300, decor: 2, color: '#c46a5a' },
  { id: 'etagere', nameFr: 'Étagère murale', kind: 'rayon', w: 2, d: 1, price: 420, capacity: 45, color: '#a7b8cc' },
  { id: 'tableau', nameFr: 'Tableau décoratif', kind: 'deco', w: 1, d: 1, price: 260, decor: 1.4, color: '#d2a24c' },
  // Mobilier ajouté avec les modèles Mini Market et Furniture Kit.
  { id: 'gondole', nameFr: 'Gondole de supermarché', kind: 'rayon', w: 3, d: 1, price: 950, capacity: 100, color: '#7f9ab8' },
  { id: 'presentoir-pain', nameFr: 'Présentoir à pain', kind: 'rayon', w: 2, d: 1, price: 650, capacity: 40, color: '#d9a55a' },
  { id: 'etal', nameFr: 'Étal de fruits', kind: 'rayon', w: 2, d: 1, price: 600, capacity: 45, color: '#e0533a' },
  { id: 'congelateur', nameFr: 'Congélateur bahut', kind: 'frigo', w: 2, d: 1, price: 1600, capacity: 70, color: '#9fd8ec' },
  { id: 'bar', nameFr: 'Bar et 3 tabourets', kind: 'table', w: 3, d: 2, price: 650, seats: 3, decor: 0.4, color: '#8a6a4a' },
  { id: 'salon', nameFr: 'Coin salon', kind: 'table', w: 3, d: 2, price: 950, seats: 3, decor: 1.5, color: '#6f86a8' },
  { id: 'bistrot', nameFr: 'Table bistrot et 2 chaises', kind: 'table', w: 2, d: 1, price: 220, seats: 2, decor: 0.3, color: '#b98a5e' },
  { id: 'caddies', nameFr: 'Chariots et paniers', kind: 'deco', w: 1, d: 1, price: 180, decor: 0.6, color: '#9aa3ad' },
  { id: 'consigne', nameFr: 'Machine à consigne', kind: 'deco', w: 1, d: 1, price: 900, decor: 0.8, color: '#4f9a6a' },
  { id: 'portemanteau', nameFr: 'Portemanteau', kind: 'deco', w: 1, d: 1, price: 120, decor: 0.6, color: '#b98a5e' },
  { id: 'enceintes', nameFr: 'Enceintes (musique)', kind: 'deco', w: 1, d: 1, price: 420, decor: 1.1, color: '#3a3f46' },
  { id: 'ecran', nameFr: 'Écran publicitaire', kind: 'deco', w: 2, d: 1, price: 1200, decor: 1.8, color: '#2b3440' },
  { id: 'fleurs', nameFr: 'Massif de fleurs', kind: 'deco', w: 1, d: 1, price: 140, decor: 0.9, color: '#d8344a' },
  { id: 'bibliotheque', nameFr: 'Bibliothèque décorative', kind: 'deco', w: 2, d: 1, price: 380, decor: 1.3, color: '#a07a5a' },
  // Décorations (un modèle Kenney chacune : Mini Arcade, Holiday Kit, Furniture Kit, Nature Kit, Mini Characters).
  ...([
    ['arcade', "Borne d'arcade", 1, 1, 1800, 1.6], ['flipper', 'Flipper', 1, 2, 2200, 1.8], ['pince', 'Machine à pince', 1, 1, 2000, 1.7],
    ['airhockey', 'Air hockey', 2, 1, 2500, 1.8], ['danse', 'Jeu de danse', 2, 1, 2600, 1.9], ['basket', 'Jeu de basket', 1, 2, 2400, 1.8],
    ['distributeur', 'Distributeur de boissons', 1, 1, 1500, 0.9], ['roue', 'Roue des lots', 1, 1, 900, 1.2], ['tickets', 'Machine à tickets', 1, 1, 700, 0.7],
    ['jackpot', 'Machine à sous', 1, 1, 1600, 1.2], ['lots', 'Vitrine de lots', 1, 1, 650, 1.0],
    ['sapin', 'Sapin décoré', 1, 1, 300, 1.6], ['bonhomme', 'Bonhomme de neige', 1, 1, 180, 1.0], ['cadeaux', 'Pile de cadeaux', 1, 1, 120, 0.8],
    ['cassenoisette', 'Casse-noisette', 1, 1, 150, 0.8], ['lanterne', 'Lanterne', 1, 1, 90, 0.6], ['renne', 'Renne décoratif', 1, 1, 220, 1.0],
    ['traineau', 'Traîneau', 2, 1, 260, 1.0], ['guirlande', 'Guirlande lumineuse', 2, 1, 160, 1.1], ['menorah', 'Chandelier de fête', 1, 1, 140, 0.8],
    ['nounours', 'Ours en peluche', 1, 1, 80, 0.7], ['tele-vintage', 'Télévision vintage', 1, 1, 350, 1.0], ['canape-angle', "Canapé d'angle", 2, 2, 900, 1.6],
    ['fauteuil-design', 'Fauteuil design', 1, 1, 380, 1.1], ['lampadaire-carre', 'Lampadaire carré', 1, 1, 240, 1.2],
    ['plante-grande', 'Grande plante en pot', 1, 1, 260, 1.3], ['palmier', 'Palmier en bac', 1, 1, 420, 1.6], ['statue', 'Statue', 1, 1, 650, 1.8],
    ['defibrillateur', 'Défibrillateur', 1, 1, 450, 0.5], ['banc', 'Banc', 2, 1, 220, 0.6], ['tapis-carre', 'Tapis carré', 2, 2, 280, 1.8],
    ['tapis-arrondi', 'Tapis arrondi', 2, 2, 300, 1.9], ['accueil', "Bureau d'accueil", 2, 2, 900, 1.0], ['radio', 'Radio rétro', 1, 1, 120, 0.6],
    ['tonneau', 'Tonneau décoratif', 1, 1, 110, 0.5], ['coffre', 'Coffre en bois', 1, 1, 160, 0.6],
  ] as const).map(([id, nameFr, w, d, price, decor]): FurnitureDef => ({ id, nameFr, kind: 'deco', w, d, price, decor, color: '#c9a37a' })),
];

export const FURNITURE_BY_ID: ReadonlyMap<string, FurnitureDef> = new Map(FURNITURE.map((f) => [f.id, f]));

export interface ProductDef {
  id: string;
  nameFr: string;
  shop: ShopType;
  /** Prix d'achat au grossiste (CHF / unité). */
  cost: number;
  /** Prix de vente habituel du quartier (CHF / unité) : référence de la sensibilité au prix. */
  basePrice: number;
  /** Meuble de présentation. */
  store: StoreKind;
  /** Vente impossible sans machine à café. */
  needsMachine?: boolean;
  /** Part de la demande du commerce (somme 1 par type). */
  share: number;
}

export const PRODUCTS: readonly ProductDef[] = [
  { id: 'pain', nameFr: 'Pain', shop: 'epicerie', cost: 1.2, basePrice: 3, store: 'rayon', share: 0.2 },
  { id: 'lait', nameFr: 'Lait', shop: 'epicerie', cost: 0.9, basePrice: 2.2, store: 'frigo', share: 0.15 },
  { id: 'fruits', nameFr: 'Fruits et légumes', shop: 'epicerie', cost: 1.5, basePrice: 3.9, store: 'rayon', share: 0.2 },
  { id: 'boissons', nameFr: 'Boissons fraîches', shop: 'epicerie', cost: 0.8, basePrice: 2.5, store: 'frigo', share: 0.17 },
  { id: 'conserves', nameFr: 'Conserves et épicerie', shop: 'epicerie', cost: 1.1, basePrice: 3.2, store: 'rayon', share: 0.15 },
  { id: 'snacks', nameFr: 'Snacks', shop: 'epicerie', cost: 0.7, basePrice: 2.4, store: 'rayon', share: 0.13 },
  { id: 'cafe', nameFr: 'Café', shop: 'cafe', cost: 0.4, basePrice: 4.5, store: 'comptoir', needsMachine: true, share: 0.36 },
  { id: 'the', nameFr: 'Thé à la menthe', shop: 'cafe', cost: 0.3, basePrice: 4, store: 'comptoir', needsMachine: true, share: 0.16 },
  { id: 'croissant', nameFr: 'Croissant', shop: 'cafe', cost: 0.6, basePrice: 2.8, store: 'vitrine', share: 0.2 },
  { id: 'sandwich', nameFr: 'Sandwich', shop: 'cafe', cost: 2.2, basePrice: 7.5, store: 'frigo', share: 0.16 },
  { id: 'jus', nameFr: "Jus d'orange pressé", shop: 'cafe', cost: 0.9, basePrice: 4.8, store: 'frigo', share: 0.12 },
  { id: 'tshirt', nameFr: 'T-shirt', shop: 'vetements', cost: 11, basePrice: 25, store: 'portant', share: 0.38 },
  { id: 'jean', nameFr: 'Jean', shop: 'vetements', cost: 30, basePrice: 69, store: 'portant', share: 0.27 },
  { id: 'veste', nameFr: 'Veste', shop: 'vetements', cost: 52, basePrice: 119, store: 'portant', share: 0.15 },
  { id: 'chaussures', nameFr: 'Chaussures', shop: 'vetements', cost: 38, basePrice: 89, store: 'rayon', share: 0.2 },
  { id: 'roses', nameFr: 'Roses à l’unité', shop: 'fleuriste', cost: 1.1, basePrice: 4, store: 'frigo', share: 0.34 },
  { id: 'bouquet', nameFr: 'Bouquet composé', shop: 'fleuriste', cost: 9, basePrice: 29, store: 'frigo', share: 0.3 },
  { id: 'plantes', nameFr: 'Plante en pot', shop: 'fleuriste', cost: 6.5, basePrice: 19, store: 'rayon', share: 0.24 },
  { id: 'cartes', nameFr: 'Cartes et rubans', shop: 'fleuriste', cost: 0.7, basePrice: 3.5, store: 'rayon', share: 0.12 },
  { id: 'baguette', nameFr: 'Baguette', shop: 'boulangerie', cost: 0.35, basePrice: 1.6, store: 'rayon', share: 0.34 },
  { id: 'campagne', nameFr: 'Pain de campagne', shop: 'boulangerie', cost: 1.2, basePrice: 4.5, store: 'rayon', share: 0.16 },
  { id: 'viennoiseries', nameFr: 'Viennoiseries', shop: 'boulangerie', cost: 0.5, basePrice: 2.2, store: 'vitrine', share: 0.26 },
  { id: 'patisseries', nameFr: 'Pâtisseries', shop: 'boulangerie', cost: 1.6, basePrice: 5.5, store: 'vitrine', share: 0.16 },
  { id: 'eau', nameFr: 'Eau et boissons', shop: 'boulangerie', cost: 0.3, basePrice: 1.8, store: 'frigo', share: 0.08 },
  { id: 'burger', nameFr: 'Burger', shop: 'fastfood', cost: 1.9, basePrice: 8.5, store: 'comptoir', share: 0.32 },
  { id: 'frites', nameFr: 'Frites', shop: 'fastfood', cost: 0.4, basePrice: 3.9, store: 'comptoir', share: 0.2 },
  { id: 'hotdog', nameFr: 'Hot-dog', shop: 'fastfood', cost: 1.1, basePrice: 5.5, store: 'comptoir', share: 0.12 },
  { id: 'pizza', nameFr: 'Part de pizza', shop: 'fastfood', cost: 1.0, basePrice: 4.5, store: 'vitrine', share: 0.12 },
  { id: 'soda', nameFr: 'Soda', shop: 'fastfood', cost: 0.5, basePrice: 3, store: 'frigo', share: 0.16 },
  { id: 'glace', nameFr: 'Glace', shop: 'fastfood', cost: 0.6, basePrice: 3.5, store: 'frigo', share: 0.08 },
  { id: 'legumes', nameFr: 'Légumes', shop: 'primeur', cost: 1.1, basePrice: 3.2, store: 'rayon', share: 0.32 },
  { id: 'fruitsfrais', nameFr: 'Fruits de saison', shop: 'primeur', cost: 1.3, basePrice: 3.8, store: 'rayon', share: 0.32 },
  { id: 'exotiques', nameFr: 'Fruits exotiques', shop: 'primeur', cost: 2.2, basePrice: 6.5, store: 'rayon', share: 0.14 },
  { id: 'herbes', nameFr: 'Herbes et champignons', shop: 'primeur', cost: 0.4, basePrice: 1.8, store: 'rayon', share: 0.1 },
  { id: 'jusfrais', nameFr: 'Jus pressés', shop: 'primeur', cost: 0.9, basePrice: 4.2, store: 'frigo', share: 0.12 },
];

export const PRODUCT_BY_ID: ReadonlyMap<string, ProductDef> = new Map(PRODUCTS.map((p) => [p.id, p]));

export interface ShopTypeDef {
  id: ShopType;
  nameFr: string;
  /** Part des passants qui entrent quand tout est au niveau du quartier (prix, choix, décoration). */
  capture: number;
  /** Articles achetés en moyenne par client. */
  basket: number;
  /** Demande relative par heure (0..23). */
  hourly: readonly number[];
  /** Multiplicateur du samedi et du dimanche. */
  weekend: number;
  /** Ouverture et fermeture par défaut (heures). */
  open: number;
  close: number;
  /** Couleur de l'enseigne. */
  color: string;
}

const H = (pairs: [number, number][]): number[] => { const a = new Array<number>(24).fill(0); for (const [h, v] of pairs) a[h] = v; return a; };

export const SHOP_TYPES: readonly ShopTypeDef[] = [
  {
    id: 'epicerie', nameFr: 'Épicerie', capture: 0.095, basket: 2.2, weekend: 1.15, open: 8, close: 20, color: '#4caf6a',
    hourly: H([[7, 0.35], [8, 0.6], [9, 0.55], [10, 0.5], [11, 0.65], [12, 0.85], [13, 0.7], [14, 0.5], [15, 0.5], [16, 0.65], [17, 0.95], [18, 1], [19, 0.8], [20, 0.45], [21, 0.25]]),
  },
  {
    id: 'cafe', nameFr: 'Café', capture: 0.04, basket: 1.5, weekend: 1.25, open: 7, close: 19, color: '#c0773a',
    hourly: H([[6, 0.3], [7, 0.85], [8, 1], [9, 0.8], [10, 0.6], [11, 0.55], [12, 0.8], [13, 0.75], [14, 0.5], [15, 0.55], [16, 0.6], [17, 0.5], [18, 0.35], [19, 0.2], [20, 0.1]]),
  },
  {
    id: 'vetements', nameFr: 'Boutique de vêtements', capture: 0.008, basket: 1.15, weekend: 1.6, open: 10, close: 19, color: '#8a5ad0',
    hourly: H([[9, 0.2], [10, 0.4], [11, 0.55], [12, 0.6], [13, 0.65], [14, 0.75], [15, 0.85], [16, 0.95], [17, 1], [18, 0.85], [19, 0.4], [20, 0.15]]),
  },
  {
    id: 'fleuriste', nameFr: 'Fleuriste', capture: 0.013, basket: 1.3, weekend: 1.5, open: 9, close: 19, color: '#d9578a',
    hourly: H([[8, 0.2], [9, 0.4], [10, 0.55], [11, 0.75], [12, 0.8], [13, 0.6], [14, 0.55], [15, 0.6], [16, 0.8], [17, 1], [18, 0.9], [19, 0.4], [20, 0.15]]),
  },
  {
    id: 'boulangerie', nameFr: 'Boulangerie', capture: 0.09, basket: 1.8, weekend: 1.3, open: 6, close: 19, color: '#d9a23a',
    hourly: H([[6, 0.6], [7, 1], [8, 0.95], [9, 0.6], [10, 0.45], [11, 0.55], [12, 0.75], [13, 0.5], [14, 0.3], [15, 0.35], [16, 0.5], [17, 0.8], [18, 0.75], [19, 0.3]]),
  },
  {
    id: 'fastfood', nameFr: 'Fast-food', capture: 0.032, basket: 1.9, weekend: 1.3, open: 11, close: 23, color: '#e04a3a',
    hourly: H([[11, 0.45], [12, 1], [13, 0.9], [14, 0.45], [15, 0.3], [16, 0.35], [17, 0.5], [18, 0.75], [19, 0.95], [20, 0.85], [21, 0.6], [22, 0.4], [23, 0.15]]),
  },
  {
    id: 'primeur', nameFr: 'Primeur', capture: 0.028, basket: 2.4, weekend: 1.25, open: 8, close: 19, color: '#6aa83a',
    hourly: H([[7, 0.2], [8, 0.5], [9, 0.75], [10, 0.85], [11, 0.9], [12, 0.7], [13, 0.45], [14, 0.4], [15, 0.5], [16, 0.75], [17, 1], [18, 0.8], [19, 0.3]]),
  },
];

export const SHOP_TYPE_BY_ID: ReadonlyMap<ShopType, ShopTypeDef> = new Map(SHOP_TYPES.map((t) => [t.id, t]));

export function productsOf(shop: ShopType): ProductDef[] { return PRODUCTS.filter((p) => p.shop === shop); }

/** Réglages de partie (modifiables) : somme de départ. */
export const CONFIG = {
  /** Trésorerie au début d'une nouvelle partie (CHF). */
  startCash: 40_000,
} as const;

/** Paramètres économiques généraux. */
export const ECONOMY = {
  startCash: CONFIG.startCash,
  /** Loyer mensuel de base (CHF / m²), modulé par l'emplacement. */
  rentPerM2: 22,
  /** Dépôt de garantie à la signature (en mois de loyer). */
  depositMonths: 1,
  /** Remise du grossiste à partir de `bulkQty` unités. */
  bulkQty: 100,
  bulkDiscount: 0.1,
  /** Heure de livraison des commandes (lendemain). */
  deliveryHour: 7,
  /** Clients servis par heure et par caisse tenue (employé de compétence 1). */
  servePerRegister: 28,
  /** Indemnité de licenciement (jours de salaire, 8 h / jour). */
  severanceDays: 3,
  /** Revente du mobilier (part du prix). */
  resale: 0.4,
  /** Livraison d'une commande du grossiste : forfait + part du montant. */
  deliveryBase: 40,
  deliveryRate: 0.06,
  /** Livraison des meubles achetés au magasin de meubles (par achat). */
  furnitureDelivery: 60,
  /** Marchandise portée à pied (unités). */
  carryOnFoot: 24,
  /** Distance maximale (m) entre un véhicule et une porte pour charger ou décharger. */
  loadDistance: 30,
  /** Revente d'un véhicule (part du prix). */
  vehicleResale: 0.6,
  /** Plafond d'endettement total (CHF). */
  maxDebt: 80_000,
  /** Taxi de retour quand le personnage s'effondre de fatigue (CHF). */
  faintCost: 40,
} as const;

/* ------------------------------ Services du quartier ------------------------------ */

export type ServiceKind = 'grossiste' | 'meubles' | 'banque' | 'emploi' | 'garage' | 'pub' | 'snack';
export interface ServiceDef { id: ServiceKind; nameFr: string; sign: string; color: string; hint: string }
export const SERVICES: readonly ServiceDef[] = [
  { id: 'grossiste', nameFr: 'Grossiste', sign: 'Grossiste Atlas', color: '#d9822b', hint: 'Marchandise : chargez-la dans votre véhicule ou faites-la livrer.' },
  { id: 'meubles', nameFr: 'Magasin de meubles', sign: 'Meubles & Agencement', color: '#3f8fd9', hint: 'Mobilier de magasin, livré dans la réserve du commerce choisi.' },
  { id: 'banque', nameFr: 'Banque', sign: 'Banque du Quartier', color: '#2e9e8f', hint: 'Prêts à rembourser chaque jour.' },
  { id: 'emploi', nameFr: "Agence pour l'emploi", sign: "Agence pour l'emploi", color: '#8c63d9', hint: 'Candidats à embaucher, nouveaux chaque lundi.' },
  { id: 'garage', nameFr: 'Garage', sign: 'Garage Utilitaires', color: '#c94f4f', hint: 'Scooters, citadines, voitures de luxe, camionnettes et camions.' },
  { id: 'pub', nameFr: 'Agence de publicité', sign: 'Agence Pub & Com', color: '#d94fa0', hint: 'Campagnes qui attirent plus de clients.' },
  { id: 'snack', nameFr: 'Snack', sign: 'Snack Express', color: '#e0b030', hint: 'Manger et boire un café : faim et énergie.' },
];
export const SERVICE_BY_ID: ReadonlyMap<ServiceKind, ServiceDef> = new Map(SERVICES.map((s) => [s.id, s]));

/* ------------------------------ Véhicules ------------------------------ */

export type VehicleType = 'scooter' | 'citadine' | 'sportive' | 'suv' | 'camionnette' | 'camion';
export interface VehicleDef { id: VehicleType; nameFr: string; price: number; cargo: number; /** Vitesse maximale (m/s). */ speed: number; /** Assurance (CHF / jour). */ insurance: number; color: string }
export const VEHICLES: readonly VehicleDef[] = [
  { id: 'scooter', nameFr: 'Scooter utilitaire', price: 2900, cargo: 60, speed: 13, insurance: 4, color: '#e2463a' },
  { id: 'citadine', nameFr: 'Citadine', price: 9800, cargo: 140, speed: 16, insurance: 8, color: '#3f9a5a' },
  { id: 'sportive', nameFr: 'Berline sportive', price: 38000, cargo: 90, speed: 21, insurance: 26, color: '#d02a2a' },
  { id: 'suv', nameFr: 'SUV de luxe', price: 46000, cargo: 320, speed: 17, insurance: 30, color: '#e0c040' },
  { id: 'camionnette', nameFr: 'Camionnette', price: 14500, cargo: 600, speed: 12, insurance: 14, color: '#f2f2ee' },
  { id: 'camion', nameFr: 'Camion de livraison', price: 34000, cargo: 1600, speed: 10, insurance: 32, color: '#d8d8d8' },
];
export const VEHICLE_BY_ID: ReadonlyMap<VehicleType, VehicleDef> = new Map(VEHICLES.map((v) => [v.id, v]));

/* ------------------------------ Banque ------------------------------ */

export interface LoanOffer { amount: number; days: number; /** Taux annuel. */ rate: number }
export const LOAN_OFFERS: readonly LoanOffer[] = [
  { amount: 10_000, days: 60, rate: 0.07 },
  { amount: 25_000, days: 120, rate: 0.09 },
  { amount: 50_000, days: 180, rate: 0.11 },
];
/** Total à rembourser (capital + intérêts simples). */
export const loanTotal = (o: LoanOffer): number => Math.round(o.amount * (1 + (o.rate * o.days) / 365));

/* ------------------------------ Publicité ------------------------------ */

export type CampaignKind = 'flyers' | 'affiches' | 'internet';
export interface CampaignDef { id: CampaignKind; nameFr: string; perDay: number; /** Clients en plus (part). */ boost: number; scope: 'shop' | 'all'; desc: string }
export const CAMPAIGNS: readonly CampaignDef[] = [
  { id: 'flyers', nameFr: 'Distribution de flyers', perDay: 90, boost: 0.25, scope: 'shop', desc: 'Un commerce : +25 % de clients dès le lancement, la notoriété grimpe pendant la campagne puis s’estompe.' },
  { id: 'affiches', nameFr: 'Affiches dans le quartier', perDay: 260, boost: 0.5, scope: 'shop', desc: 'Un commerce : +50 % de clients dès le lancement, la notoriété grimpe pendant la campagne puis s’estompe.' },
  { id: 'internet', nameFr: 'Publicité sur internet', perDay: 380, boost: 0.22, scope: 'all', desc: 'Tous vos commerces : +22 % de clients dès le lancement, la notoriété grimpe pendant la campagne puis s’estompe.' },
];
export const CAMPAIGN_BY_ID: ReadonlyMap<CampaignKind, CampaignDef> = new Map(CAMPAIGNS.map((c) => [c.id, c]));

/* ------------------------------ Finances : impôts, crédit, placements, notoriété ------------------------------ */

export const FINANCE = {
  /** Impôt sur le bénéfice : part du bénéfice positif de chaque semaine (7 jours), prélevée à minuit le 7e jour. */
  taxRate: 0.18,
  taxPeriod: 7,
  /** Semaines exonérées au début (aide à la création d'entreprise). */
  taxGraceWeeks: 1,
  /** Plafond de crédit = socle + part de la valeur nette positive + semaines de ventes récentes, borné par creditMax. */
  creditBase: 20_000,
  creditWorthShare: 1.5,
  /** Ventes des 7 derniers jours comptées `creditSalesWeeks` fois. */
  creditSalesWeeks: 2,
  creditMax: 300_000,
  /** Notoriété (part de clients en plus) : perte de 20 % par jour, gain quotidien de 25 % de l'effet de chaque campagne en cours. */
  awarenessDecay: 0.2,
  awarenessGain: 0.25,
  /** Notoriété maximale d'un commerce (+100 % de clients). */
  awarenessMax: 1,
  /** Placement minimal (CHF). */
  investMin: 100,
} as const;

export type InvestKind = 'epargne' | 'fonds';
export interface InvestDef {
  id: InvestKind; nameFr: string; desc: string;
  /** Rendement quotidien moyen et volatilité quotidienne (écart type). */
  dailyMean: number; dailyVol: number;
  /** Frais de retrait (part du montant retiré). */
  exitFee: number;
}
export const INVESTMENTS: readonly InvestDef[] = [
  { id: 'epargne', nameFr: 'Compte épargne', dailyMean: 0.00012, dailyVol: 0, exitFee: 0, desc: 'Sans risque : environ +0,36 % par mois, intérêts ajoutés chaque nuit. Retrait immédiat et gratuit.' },
  { id: 'fonds', nameFr: 'Fonds Croissance du quartier', dailyMean: 0.0003, dailyVol: 0.01, exitFee: 0.01, desc: 'Risqué : en moyenne +0,9 % par mois, mais la valeur varie chaque nuit (±1 % environ, parfois plus). Frais de retrait de 1 %.' },
];
export const INVEST_BY_ID: ReadonlyMap<InvestKind, InvestDef> = new Map(INVESTMENTS.map((i) => [i.id, i]));

/* ------------------------------ Personnage ------------------------------ */

export const NEEDS = {
  /** Perte d'énergie éveillé (points / minute de jeu) : 100 → 0 en 17 h. */
  energyPerMin: 100 / (17 * 60),
  /** Perte de satiété (points / minute) : 100 → 0 en 9 h. */
  hungerPerMin: 100 / (9 * 60),
  /** Récupération en dormant (points / minute, multipliée par le confort du logement) : 0 → 100 en 7 h. */
  sleepPerMin: 100 / (7 * 60),
  /** Seuil bas : marche ralentie, alertes. */
  low: 15,
} as const;

export interface FoodDef { id: string; nameFr: string; price: number; hunger: number; energy: number }
export const FOODS: readonly FoodDef[] = [
  { id: 'cafe', nameFr: 'Café serré', price: 4, hunger: 3, energy: 15 },
  { id: 'sandwich', nameFr: 'Sandwich', price: 9, hunger: 45, energy: 0 },
  { id: 'menu', nameFr: 'Menu du jour', price: 17, hunger: 85, energy: 5 },
];

/** Logements à louer (prix au jour). */
export interface HomeDef { id: string; nameFr: string; rentDay: number; comfort: number; gridW: number; gridD: number }
export const HOMES: readonly HomeDef[] = [
  { id: 'studio', nameFr: 'Studio', rentDay: 28, comfort: 1, gridW: 7, gridD: 6 },
  { id: 'deux', nameFr: 'Deux-pièces', rentDay: 55, comfort: 1.2, gridW: 9, gridD: 7 },
  { id: 'loft', nameFr: 'Loft', rentDay: 110, comfort: 1.45, gridW: 11, gridD: 8 },
];
export const HOME_BY_ID: ReadonlyMap<string, HomeDef> = new Map(HOMES.map((h) => [h.id, h]));

/* ------------------------------ Milieu de partie : gamme premium, formation, contrats ------------------------------ */

/**
 * Gamme premium d'un type de commerce : produits plus fins, vendus plus cher (prix de référence × priceMult) et
 * achetés plus cher (coût × costMult). La clientèle premium dépend de la réputation : peu de clients tant que le
 * commerce n'est pas reconnu, autant ou plus qu'en gamme standard quand il l'est. Coût unique de mise en place
 * (agencement, référencement chez les fournisseurs), puis bascule libre entre les deux gammes.
 */
export interface PremiumDef { type: ShopType; nameFr: string; cost: number; desc: string }
export const PREMIUM = {
  /** Prix de vente de référence du quartier pour la gamme premium (× prix habituel). */
  priceMult: 1.5,
  /** Prix d'achat au grossiste de la gamme premium (× coût habituel). */
  costMult: 1.4,
  /** Demande premium = base + slope × réputation (plafonnée à max). */
  demandBase: 0.2,
  demandSlope: 0.9,
  demandMax: 1.05,
  /** Formation minimale d'au moins un employé du commerce pour passer en premium. */
  minTraining: 1,
} as const;
export const PREMIUM_RANGES: readonly PremiumDef[] = [
  { type: 'epicerie', nameFr: 'Épicerie fine', cost: 6500, desc: 'Produits bio, fromages affinés, conserves de producteurs.' },
  { type: 'cafe', nameFr: 'Café de spécialité', cost: 5500, desc: 'Torréfaction artisanale, pâtisseries maison.' },
  { type: 'vetements', nameFr: 'Mode de créateurs', cost: 7000, desc: 'Pièces de créateurs locaux, matières nobles.' },
  { type: 'fleuriste', nameFr: 'Atelier floral', cost: 5500, desc: 'Compositions sur mesure, fleurs de saison rares.' },
  { type: 'boulangerie', nameFr: 'Boulangerie artisanale', cost: 5500, desc: 'Levain naturel, farines anciennes, pâtisserie fine.' },
  { type: 'fastfood', nameFr: 'Burgers gourmets', cost: 5500, desc: 'Viande locale, pains briochés, sauces maison.' },
  { type: 'primeur', nameFr: 'Primeur bio', cost: 5500, desc: 'Fruits et légumes bio de petits producteurs.' },
];
export const PREMIUM_BY_TYPE: ReadonlyMap<ShopType, PremiumDef> = new Map(PREMIUM_RANGES.map((p) => [p.type, p]));
/** Part de la demande premium selon la réputation (0..1). */
export const premiumDemand = (reputation: number): number => Math.min(PREMIUM.demandMax, PREMIUM.demandBase + PREMIUM.demandSlope * reputation);

/**
 * Formation des employés (cours du soir, payée une fois par niveau) : chaque niveau sert plus de clients par heure,
 * mais l'employé formé vaut plus cher sur le marché (il demandera une augmentation si son salaire ne suit pas).
 */
export const TRAINING = {
  maxLevel: 3,
  /** Coût du niveau n (1..3) : base + step × (n − 1). */
  base: 600,
  step: 500,
  /** Clients servis en plus par niveau (part de la capacité de caisse). */
  capacity: 0.12,
  /** Salaire du marché en plus par niveau (CHF / h). */
  wage: 2,
  /** Compétence gagnée par niveau (plafonnée à 100 %). */
  skill: 0.05,
} as const;
export const trainingCost = (level: number): number => TRAINING.base + TRAINING.step * (level - 1);

/**
 * Rôles des employés : caisse (sert les clients), rayon (conseille et présente : attire plus de clients),
 * entretien (garde le commerce propre). Un employé ne compte que pendant son équipe, aux heures d'ouverture.
 */
export type StaffRole = 'caisse' | 'rayon' | 'entretien';
export interface StaffRoleDef { id: StaffRole; nameFr: string; desc: string }
export const STAFF_ROLES: readonly StaffRoleDef[] = [
  { id: 'caisse', nameFr: 'Caisse', desc: 'Encaisse les clients : sans caissier présent, personne ne peut payer.' },
  { id: 'rayon', nameFr: 'Rayon', desc: 'Conseille les clients et soigne la présentation : attire plus de clients.' },
  { id: 'entretien', nameFr: 'Entretien', desc: 'Nettoie le commerce pendant son équipe.' },
];
export const STAFF_ROLE_BY_ID: ReadonlyMap<StaffRole, StaffRoleDef> = new Map(STAFF_ROLES.map((r) => [r.id, r]));

/** Équipes : matin (avant 14 h), soir (à partir de 14 h), journée complète. Limitées aux heures d'ouverture. */
export type ShiftKind = 'matin' | 'soir' | 'journee';
export interface ShiftDef { id: ShiftKind; nameFr: string; from: number; to: number }
export const SHIFTS: readonly ShiftDef[] = [
  { id: 'journee', nameFr: 'Journée complète', from: 0, to: 24 },
  { id: 'matin', nameFr: 'Matin', from: 0, to: 14 },
  { id: 'soir', nameFr: 'Soir', from: 14, to: 24 },
];
export const SHIFT_BY_ID: ReadonlyMap<ShiftKind, ShiftDef> = new Map(SHIFTS.map((s) => [s.id, s]));

export const STAFF = {
  /** Clients attirés en plus par employé de rayon présent (× compétence). */
  shelfBonus: 0.15,
  /** Plafond du bonus de rayon. */
  shelfBonusMax: 0.3,
  /** Baisse de la satisfaction visée quand l'équipe ne correspond pas au souhait du salarié. */
  shiftMood: 0.2,
  /** Baisse de la satisfaction visée quand le salaire passe sous le minimum demandé à l'embauche. */
  minWageMood: 0.3,
} as const;

/**
 * Contrats fournisseurs avec le grossiste : forfait quotidien contre une remise sur tous les achats (emportés ou
 * livrés). Intéressant seulement quand on achète beaucoup (plusieurs commerces).
 */
export type ContractKind = 'essentiel' | 'partenaire';
export interface ContractDef { id: ContractKind; nameFr: string; perDay: number; discount: number; /** Forfait de livraison offert. */ freeDelivery: boolean; desc: string }
export const CONTRACTS: readonly ContractDef[] = [
  { id: 'essentiel', nameFr: 'Contrat Essentiel', perDay: 45, discount: 0.08, freeDelivery: false, desc: '−8 % sur tous les achats.' },
  { id: 'partenaire', nameFr: 'Contrat Partenaire', perDay: 150, discount: 0.15, freeDelivery: true, desc: '−15 % sur tous les achats, forfait de livraison offert.' },
];
export const CONTRACT_BY_ID: ReadonlyMap<ContractKind, ContractDef> = new Map(CONTRACTS.map((c) => [c.id, c]));

/* ------------------------------ Propreté et revêtements ------------------------------ */

/**
 * Propreté d'un commerce (0..100 %) : baisse à chaque client servi et à chaque heure d'ouverture ; sous les seuils,
 * l'attrait (clients attendus) et la réputation baissent. Remontée : « Nettoyer » sur place (le joueur), employés
 * d'entretien, ou service de nettoyage de nuit sous contrat (forfait quotidien selon la surface).
 */
export const CLEANING = {
  /** Points perdus par client servi. */
  perCustomer: 0.12,
  /** Points perdus par heure d'ouverture. */
  perOpenHour: 0.5,
  /** Au-dessus de ce niveau, aucun effet sur l'attrait. */
  fine: 75,
  /** Attrait à 0 % de propreté (× ; linéaire jusqu'à `fine`). */
  minAppeal: 0.62,
  /** Réputation visée en moins à 0 % de propreté (points ; linéaire jusqu'à `fine`). */
  repPenalty: 0.2,
  /** Alerte (une fois par jour) sous ce niveau. */
  warn: 50,
  /** Nettoyage par le joueur : durée (minutes de jeu), points rendus, énergie dépensée. */
  playerMinutes: 30,
  playerGain: 45,
  playerEnergy: 6,
  /** Points rendus par heure d'ouverture pour 1 point d'entretien de l'équipe (cleaningPower). */
  perPower: 6,
  /**
   * Coup de balai des caissiers en heures creuses : points rendus par heure pour un caissier pleinement compétent et
   * inoccupé (× part de la caisse restée libre l'heure précédente), sans dépasser `cashierCap` (propre « passable »).
   */
  cashierPerHour: 6,
  cashierCap: 35,
  /** Service de nettoyage de nuit : CHF par m² et par jour (minimum `serviceMin`) ; remet à 100 % chaque nuit. */
  servicePerM2: 0.35,
  serviceMin: 25,
} as const;

/** Revêtement de sol ou de murs : prix au m² (sol : surface du local ; murs : 3 murs × 3 m de haut), bonus d'attrait. */
export interface SurfaceDef { id: string; nameFr: string; perM2: number; /** Attrait en plus (part, cumul sol + murs). */ appeal: number; /** Pastille de l'interface (CSS). */ color: string; desc: string }
export const FLOORINGS: readonly SurfaceDef[] = [
  { id: 'origine', nameFr: 'Sol d’origine', perM2: 0, appeal: 0, color: '#b9a88f', desc: 'Le sol livré avec le local.' },
  { id: 'lino', nameFr: 'Lino moucheté', perM2: 12, appeal: 0.02, color: '#9fb3a8', desc: 'Pratique et bon marché.' },
  { id: 'carrelage', nameFr: 'Grands carreaux clairs', perM2: 28, appeal: 0.04, color: '#e8e4dc', desc: 'Lumineux, facile à entretenir.' },
  { id: 'chene', nameFr: 'Parquet de chêne', perM2: 45, appeal: 0.06, color: '#b07a48', desc: 'Chaleureux, apprécié des clients.' },
  { id: 'marbre', nameFr: 'Marbre poli', perM2: 80, appeal: 0.09, color: '#eceae6', desc: 'Luxueux : l’effet « waouh ».' },
];
export const WALLINGS: readonly SurfaceDef[] = [
  { id: 'origine', nameFr: 'Peinture d’origine', perM2: 0, appeal: 0, color: '#d9d2c4', desc: 'Les murs livrés avec le local.' },
  { id: 'peinture', nameFr: 'Peinture fraîche', perM2: 6, appeal: 0.015, color: '#f3efe6', desc: 'Un coup de neuf, blanc cassé.' },
  { id: 'papier', nameFr: 'Papier peint à motifs', perM2: 14, appeal: 0.03, color: '#9cc0d8', desc: 'Motifs discrets, ambiance soignée.' },
  { id: 'lambris', nameFr: 'Lambris de bois', perM2: 24, appeal: 0.045, color: '#a8784c', desc: 'Bois clair du sol au plafond.' },
  { id: 'brique', nameFr: 'Briques apparentes', perM2: 38, appeal: 0.06, color: '#b5573a', desc: 'Style atelier, très tendance.' },
];
export const FLOORING_BY_ID: ReadonlyMap<string, SurfaceDef> = new Map(FLOORINGS.map((f) => [f.id, f]));
export const WALLING_BY_ID: ReadonlyMap<string, SurfaceDef> = new Map(WALLINGS.map((f) => [f.id, f]));
/** Surface (m²) concernée par un revêtement dans un local de W × D cases (murs : fond et côtés, 3 m de haut). */
export const surfaceArea = (part: 'sol' | 'murs', W: number, D: number): number => part === 'sol' ? W * D : (W + 2 * D) * 3;
/** Attrait selon la propreté (× sur la clientèle) pour un niveau 0..100. */
export const cleanAppeal = (clean: number): number => CLEANING.minAppeal + (1 - CLEANING.minAppeal) * Math.min(1, Math.max(0, clean) / CLEANING.fine);

/* ------------------------------ Logistique ------------------------------ */

/**
 * Logistique : entrepôts (locaux en périphérie, loyer réduit, étagères à palettes), importateur (achat en très gros,
 * par palettes, moins cher que le grossiste, livré seulement à l'entrepôt avec un délai) et tournées de nuit qui
 * réapprovisionnent les commerces sous leur stock minimum (transporteur payant, ou un de vos véhicules avec un
 * chauffeur à la tournée).
 */
export type TransportMode = 'aucun' | 'service' | 'vehicule';
export const LOGISTICS = {
  /** Locaux du quartier réservés aux entrepôts. */
  warehouses: 2,
  /** Loyer d'un entrepôt : part du loyer qu'aurait le local en boutique. */
  rentMult: 0.8,
  /** Étagère à palettes : prix (montée, livrée), capacité (unités), surface au sol par étagère (m²). */
  rackPrice: 450,
  rackCapacity: 250,
  m2PerRack: 6,
  /** Prix de l'importateur : remise sur le prix catalogue (fixe, ne suit pas le marché du grossiste). */
  importDiscount: 0.28,
  /** Unités par palette : produits bon marché, et produits chers (coût unitaire ≥ bigUnitCost). */
  palletUnits: 100,
  palletUnitsBig: 25,
  bigUnitCost: 5,
  /** Commande minimale (palettes, tous produits confondus) et frais de transport par commande. */
  minPallets: 5,
  importFee: 150,
  /** Délai : 1 jour jusqu'à fastPallets palettes, 2 jours au-delà ; arrivée à importHour. */
  fastPallets: 10,
  importHour: 14,
  /** Heure de la tournée de nuit (avant l'ouverture des commerces). */
  tourHour: 4,
  /** Transporteur : forfait par tournée, par commerce livré, par unité ; capacité de sa camionnette. */
  service: { base: 35, perStop: 8, perUnit: 0.03, cargo: 800 },
  /** Votre véhicule avec un chauffeur à la tournée : forfait, par commerce livré (capacité : soute du véhicule). */
  own: { base: 20, perStop: 5 },
} as const;
export const TRANSPORT_FR: Record<TransportMode, string> = { aucun: 'Aucun transport', service: 'Transporteur (service payant)', vehicule: 'Mon véhicule + chauffeur' };

/* ------------------------------ Rivaux ------------------------------ */

/** Entreprise rivale possible (noms inventés) : enseigne courte, couleur sur la carte, types de commerce de prédilection. */
export interface RivalDef { id: string; nameFr: string; brand: string; color: string; types: readonly ShopType[] }
export const RIVAL_COMPANIES: readonly RivalDef[] = [
  { id: 'altiva', nameFr: 'Groupe Altiva', brand: 'Altiva', color: '#b5482e', types: ['epicerie', 'primeur'] },
  { id: 'lumen', nameFr: 'Enseignes Lumen', brand: 'Lumen', color: '#5468d4', types: ['cafe', 'boulangerie'] },
  { id: 'marelle', nameFr: 'Maison Marelle', brand: 'Marelle', color: '#9e3f7a', types: ['vetements', 'fleuriste'] },
  { id: 'rapido', nameFr: 'Rapido & Cie', brand: 'Rapido', color: '#8a7b2a', types: ['fastfood', 'cafe'] },
  { id: 'verger', nameFr: 'Coopérative du Verger', brand: 'Le Verger', color: '#6b8e9e', types: ['primeur', 'boulangerie', 'epicerie'] },
];
/**
 * Concurrence active : 2 à 4 entreprises rivales tirées de la graine. Avant `startDay`, elles se contentent de
 * tenir leurs commerces ; ensuite elles ouvrent des commerces (locaux libres), ajustent leurs prix, lancent des
 * promotions qui prennent des clients aux commerces voisins du même type (au plus `promoMax`), et ferment les
 * commerces qui perdent de l'argent, voire font faillite. Le joueur peut racheter un commerce ou une entreprise.
 */
export const RIVALS = {
  countMin: 2,
  countMax: 4,
  /** Commerces existants repris par chaque entreprise au début (au plus). */
  startShops: 3,
  /** Trésorerie de départ (CHF, entre les deux bornes). */
  startCash: [18_000, 30_000] as const,
  /** Premier jour où les rivaux agissent (ouvertures, prix) ; promotions un peu plus tard. */
  startDay: 10,
  promoStartDay: 12,
  /** Ouverture : coût (aménagement et dépôt), chance quotidienne par entreprise, plafond de commerces, locaux libres laissés au joueur. */
  openCost: 12_000,
  openChance: 0.05,
  maxShops: 5,
  minFreeLeft: 8,
  /** Promotion : chance quotidienne, durée (jours), coût par commerce et par jour, remise affichée. */
  promoChance: 0.05,
  promoDays: [3, 5] as const,
  promoCost: 120,
  promoDiscount: 0.15,
  /** Effet d'une promotion sur un commerce du joueur du même type : jusqu'à `promoMax` de clients en moins, dans `promoRadius` m. */
  promoRadius: 260,
  promoMax: 0.12,
  /** Prix pratiqués (× prix habituel). */
  priceMin: 0.85,
  priceMax: 1.12,
  /** Rayon des menaces signalées (m). */
  nearRadius: 300,
  /** Attrait d'un commerce rival par rapport à un commerce du joueur bien tenu ; salaire horaire moyen de son personnel. */
  attract: 0.8,
  staffWage: 26,
  /** Frais de structure d'une entreprise rivale (CHF / jour, plus par commerce). */
  overhead: 150,
  overheadPerShop: 60,
  /** Fermeture après autant de jours de pertes d'affilée ; faillite sous cette trésorerie. */
  closeAfterLoss: 14,
  bankruptCash: -4_000,
  /** Rachat : jours de chiffre d'affaires × (0,5 + réputation), plancher, part des rayons remplis à la reprise. */
  buyRevenueDays: 20,
  buyMin: 8_000,
  buyStock: 0.6,
  /** Rachat d'une entreprise entière : remise sur la somme des commerces. */
  buyCompanyDiscount: 0.9,
} as const;
/** Mobilier livré avec un commerce racheté, par type. */
export const RIVAL_LAYOUTS: Record<ShopType, readonly string[]> = {
  epicerie: ['caisse', 'rayon', 'rayon', 'rayon', 'frigo', 'frigo', 'plante'],
  cafe: ['caisse', 'machine', 'comptoir', 'vitrine', 'frigo', 'table', 'table', 'plante'],
  vetements: ['caisse', 'portant', 'portant', 'portant', 'portant', 'rayon', 'plante'],
  fleuriste: ['caisse', 'frigo', 'frigo', 'rayon', 'plante', 'lampe'],
  boulangerie: ['caisse', 'rayon', 'rayon', 'vitrine', 'vitrine', 'frigo', 'plante'],
  fastfood: ['caisse', 'comptoir', 'comptoir', 'vitrine', 'frigo', 'table', 'plante'],
  primeur: ['caisse', 'rayon', 'rayon', 'rayon', 'rayon', 'frigo', 'plante'],
};
