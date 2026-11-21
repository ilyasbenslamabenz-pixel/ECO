/**
 * Catalogue du jeu : types de commerce, mobilier (grille de 1 m), produits, services du quartier, véhicules,
 * prêts, campagnes de publicité, repas et besoins du personnage. Prix en CHF. TypeScript pur.
 */

export type ShopType = 'epicerie' | 'cafe' | 'vetements' | 'fleuriste';
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
];

export const SHOP_TYPE_BY_ID: ReadonlyMap<ShopType, ShopTypeDef> = new Map(SHOP_TYPES.map((t) => [t.id, t]));

export function productsOf(shop: ShopType): ProductDef[] { return PRODUCTS.filter((p) => p.shop === shop); }

/** Paramètres économiques généraux. */
export const ECONOMY = {
  startCash: 40_000,
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
  { id: 'garage', nameFr: 'Garage', sign: 'Garage Utilitaires', color: '#c94f4f', hint: 'Scooters et camionnettes pour transporter la marchandise.' },
  { id: 'pub', nameFr: 'Agence de publicité', sign: 'Agence Pub & Com', color: '#d94fa0', hint: 'Campagnes qui attirent plus de clients.' },
  { id: 'snack', nameFr: 'Snack', sign: 'Snack Express', color: '#e0b030', hint: 'Manger et boire un café : faim et énergie.' },
];
export const SERVICE_BY_ID: ReadonlyMap<ServiceKind, ServiceDef> = new Map(SERVICES.map((s) => [s.id, s]));

/* ------------------------------ Véhicules ------------------------------ */

export type VehicleType = 'scooter' | 'camionnette';
export interface VehicleDef { id: VehicleType; nameFr: string; price: number; cargo: number; /** Vitesse maximale (m/s). */ speed: number; /** Assurance (CHF / jour). */ insurance: number; color: string }
export const VEHICLES: readonly VehicleDef[] = [
  { id: 'scooter', nameFr: 'Scooter utilitaire', price: 2900, cargo: 60, speed: 13, insurance: 4, color: '#e2463a' },
  { id: 'camionnette', nameFr: 'Camionnette', price: 14500, cargo: 600, speed: 12, insurance: 14, color: '#f2f2ee' },
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
  { id: 'flyers', nameFr: 'Distribution de flyers', perDay: 90, boost: 0.25, scope: 'shop', desc: 'Un commerce, +25 % de clients.' },
  { id: 'affiches', nameFr: 'Affiches dans le quartier', perDay: 260, boost: 0.5, scope: 'shop', desc: 'Un commerce, +50 % de clients.' },
  { id: 'internet', nameFr: 'Publicité sur internet', perDay: 380, boost: 0.22, scope: 'all', desc: 'Tous vos commerces, +22 % de clients.' },
];
export const CAMPAIGN_BY_ID: ReadonlyMap<CampaignKind, CampaignDef> = new Map(CAMPAIGNS.map((c) => [c.id, c]));

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
