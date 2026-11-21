/**
 * Partie de Boutique City : l'entrepreneur (position, faim, énergie, logement, marchandise portée), ses commerces
 * (aménagement, réserve de meubles, stocks, prix, horaires), ses employés, ses véhicules (cargaison), ses prêts et
 * ses campagnes de publicité. Clients minute par minute, salaires à l'heure, loyers et remboursements chaque jour.
 * Les achats se font sur place : l'interface déclare le lieu où se trouve le personnage (setPlace) et la partie
 * refuse un achat hors du bon service. Aucune valeur inventée à l'affichage : l'interface lit uniquement cet état.
 * TypeScript pur (aucun DOM).
 */
import {
  CONFIG, PRODUCTS, SHOP_TYPES,
  CAMPAIGN_BY_ID, CONTRACT_BY_ID, ECONOMY, FOODS, FURNITURE_BY_ID, HOME_BY_ID, LOAN_OFFERS, NEEDS, PREMIUM, PREMIUM_BY_TYPE,
  PRODUCT_BY_ID, SHOP_TYPE_BY_ID, TRAINING, VEHICLE_BY_ID, loanTotal, premiumDemand, productsOf, trainingCost,
  type CampaignKind, type ContractDef, type ContractKind, type ProductDef, type ServiceKind, type ShopType, type VehicleType,
} from './catalog';
import { SHIFT_BY_ID, STAFF, STAFF_ROLE_BY_ID, type ShiftKind, type StaffRole } from './catalog';
import { CLEANING, FLOORING_BY_ID, WALLING_BY_ID, cleanAppeal, surfaceArea } from './catalog';
import { FINANCE, INVESTMENTS, INVEST_BY_ID, type InvestKind } from './catalog';
import { MINUTES_PER_DAY, START_MINUTE, clockView } from './clock';
import { emptyLogi, logisticsHour, logisticsNight, restoreLogi, saveLogi, type LogiState } from './logistics';
import { FACE_N, SIDEWALK_W, generateDistrict, type Building, type District, type Premise } from './district';
import { canPlace, layoutStats, type LayoutStats, type PlacedItem, type Rot } from './layout';
import { randomName } from './names';
import { OBJECTIVES, netWorth } from './objectives';
import { Rng } from './rng';
import { Rivalry, type RivalSave } from './rivals';

export const SAVE_VERSION = 2;

export interface Employee {
  id: number; name: string; skill: number; wage: number; shopId: number | null; hiredDay: number; look: number;
  /** Satisfaction 0..1 (salaire par rapport au marché) : vitesse de service, démission si trop basse. */
  mood?: number;
  /** Jours consécutifs très mécontent. */
  unhappy?: number;
  /** A demandé une augmentation (en attente). */
  askedRaise?: boolean;
  /** Niveau de formation 0..TRAINING.maxLevel (absent : 0). */
  training?: number;
  /** Rôle (absent : caisse). */
  role?: StaffRole;
  /** Équipe (absent : journée complète). */
  shift?: ShiftKind;
  /** Souhaits exprimés à l'embauche : équipe préférée, salaire minimum (CHF / h). Absents : aucun souhait. */
  wantShift?: ShiftKind;
  minWage?: number;
}
export interface Candidate {
  id: number; name: string; skill: number; wage: number; look: number;
  /** Équipe souhaitée (absent : journée complète). */
  wantShift?: ShiftKind;
  /** Salaire minimum accepté (absent : le salaire demandé). */
  minWage?: number;
}
export interface ProductState { price: number; stock: number; auto: boolean }
export interface Order { id: number; shopId: number; productId: string; qty: number; cost: number; deliverAt: number }
export interface Vehicle { id: number; type: VehicleType; x: number; z: number; heading: number; cargo: Record<string, number> }
export interface Loan { id: number; amount: number; total: number; remaining: number; daily: number; daysLeft: number }
export interface Campaign { id: number; kind: CampaignKind; shopId: number | null; daysLeft: number; perDay: number }
/** Impôt d'une semaine : semaine (0 = jours 1 à 7), bénéfice imposable, montant prélevé (0 : déficit ou exonération). */
export interface TaxRecord { week: number; base: number; amount: number }
/** État financier sauvegardé (placements, notoriété, impôts) ; absent des anciennes sauvegardes. */
export interface FinanceSave {
  invest: Record<InvestKind, number>;
  principal: Record<InvestKind, number>;
  fundReturns: number[];
  awareness: Record<string, number>;
  taxes: TaxRecord[];
}

/** Lieu du personnage, déclaré par l'interface. */
export type Place =
  | { kind: 'rue' }
  | { kind: 'commerce'; shopId: number }
  | { kind: 'logement'; homeId: number }
  | { kind: 'service'; service: ServiceKind; buildingId: number }
  | { kind: 'local'; premiseId: number };

export interface Player {
  x: number; z: number; heading: number;
  /** 0..100 */
  energy: number;
  hunger: number;
  home: number | null;
  /** Marchandise portée à pied. */
  carry: Record<string, number>;
  /** Commerce dont le personnage tient la caisse. */
  tending: number | null;
  sleeping: boolean;
  /** Véhicule conduit. */
  driving: number | null;
  place: Place;
  /** Retour forcé au logement (évanouissement) : l'interface téléporte puis remet à faux. */
  teleportHome: boolean;
  /** Jours de loyer du logement déjà payés d'avance (première semaine) ; absent : 0. */
  homePrepaid?: number;
}

export interface DayStats {
  day: number;
  customers: number;
  /** Clients perdus : rupture de stock, attente trop longue (caisses), personne à la caisse. */
  lostStock: number;
  lostCapacity: number;
  /** Articles reposés par les clients parce que trop chers. */
  refusedPrice: number;
  lostStaff: number;
  revenue: number;
  /** Coût d'achat des articles vendus (marge = revenue − costOfSales). */
  costOfSales: number;
  /** Sorties de trésorerie. */
  purchases: number;
  wages: number;
  rent: number;
  equipment: number;
  marketing: number;
  /** Remboursements de prêts. */
  finance: number;
  /** Logement, repas, assurance des véhicules, taxi. */
  living: number;
  /** Loyers encaissés des sous-locations (appartements et locaux). */
  rentalIncome: number;
  /** Impôt sur le bénéfice prélevé ce jour-là (fin de semaine) ; absent : 0. */
  tax?: number;
  /** Part de capital dans les remboursements de prêts (incluse dans finance, mais pas une charge imposable) ; absent : 0. */
  principal?: number;
  /**
   * Gains (+) ou pertes (−) des placements cette nuit-là : intérêts de l'épargne, variation du fonds. Valeur placée,
   * pas encore encaissée : hors bénéfice d'exploitation et hors impôt. Absent : 0.
   */
  investGain?: number;
}

/**
 * Sous-location : un appartement ou un local pris à bail par le joueur pour le relouer. Le joueur paie `cost` par
 * jour au propriétaire et encaisse `ask` par jour quand un locataire est en place.
 */
export type Weather = 'soleil' | 'nuages' | 'pluie';
export const WEATHER_FR: Record<Weather, string> = { soleil: 'Ensoleillé', nuages: 'Nuageux', pluie: 'Pluie' };

export interface Sublet {
  id: number;
  kind: 'logement' | 'local';
  /** Logement (homeId) ou local (premiseId). */
  ref: number;
  cost: number;
  ask: number;
  tenant: string | null;
  /** Jours d'occupation du locataire actuel. */
  since: number;
  /** Dépôt de garantie (locaux). */
  deposit: number;
  /** Jours de loyer payés d'avance (appartement : première semaine) ; absent : 0. */
  prepaid?: number;
}

export interface Shop {
  id: number;
  premiseId: number;
  type: ShopType;
  name: string;
  items: PlacedItem[];
  nextUid: number;
  /** Meubles livrés, pas encore posés (id du meuble → nombre). */
  storage: Record<string, number>;
  products: Record<string, ProductState>;
  open: number;
  close: number;
  reputation: number;
  deposit: number;
  /** Loyer provisionné depuis la dernière échéance (prélevé tous les 30 jours). */
  rentDue?: number;
  /** Jour de signature du bail (échéances mensuelles à partir de ce jour). */
  leaseDay?: number;
  today: DayStats;
  history: DayStats[];
  /** Taux d'arrivée et capacité de l'heure courante (clients / h). */
  rate: number;
  capacity: number;
  servedThisHour: number;
  /** Clients servis et perdus par heure aujourd'hui (affluence). */
  hourServed?: number[];
  hourLost?: number[];
  warned: string[];
  /** Gamme premium active (absent : gamme standard). */
  premium?: boolean;
  /** Mise en place de la gamme premium déjà payée (bascule libre ensuite). */
  premiumOwned?: boolean;
  /** Propreté 0..100 (absent : 100). */
  clean?: number;
  /** Revêtements de sol et de murs (ids de FLOORINGS / WALLINGS ; absent : « origine », rendu par type). */
  floorId?: string;
  wallId?: string;
  /** Service de nettoyage de nuit sous contrat (forfait quotidien). */
  cleanService?: boolean;
}

export interface Notice { at: number; level: 'info' | 'ok' | 'warn' | 'error'; text: string }
/** Événement visuel : un client a acheté dans un commerce du joueur. */
export interface ClientEvent { shopId: number; premiseId: number; products: string[] }
/** Avis visible d'un client (bulle dans le magasin) : raison d'un départ sans achat, client ravi, ou magasin sale. */
export type FeedbackKind = 'prix' | 'rupture' | 'attente' | 'caisse' | 'content' | 'sale';
export interface Feedback { shopId: number; kind: FeedbackKind }

export type Result<T = undefined> = { ok: true; data: T } | { ok: false; message: string };
const ok = <T>(data: T): Result<T> => ({ ok: true, data });
const fail = (message: string): Result<never> => ({ ok: false, message });

const emptyDay = (day: number): DayStats => ({ day, customers: 0, lostStock: 0, lostCapacity: 0, lostStaff: 0, refusedPrice: 0, revenue: 0, costOfSales: 0, purchases: 0, wages: 0, rent: 0, equipment: 0, marketing: 0, finance: 0, living: 0, rentalIncome: 0, tax: 0 });
const r2 = (v: number): number => Math.round(v * 100) / 100;
const sumValues = (r: Record<string, number>): number => Object.values(r).reduce((a, b) => a + b, 0);

/** Résultat d'une journée (toutes dépenses comprises). */
export function dayProfit(d: DayStats): number {
  return d.revenue + (d.rentalIncome ?? 0) - d.purchases - d.wages - d.rent - d.equipment - d.marketing - d.finance - d.living - (d.tax ?? 0);
}

/** Réglages en lot : commerces visés (un type, ou tous les commerces). */
export type BatchTarget = ShopType | 'tous';
/** Réglages à appliquer d'un coup ; un champ absent n'est pas modifié. */
export interface BatchSettings {
  /** Prix de chaque produit = coefficient × prix du quartier (0,3 à 3). */
  priceFactor?: number;
  /** Prix fixés par produit (CHF), prioritaires sur le coefficient ; ignorés là où le produit n'est pas vendu. */
  prices?: Record<string, number>;
  /** Réassort automatique de tous les produits. */
  auto?: boolean;
  /** Horaires d'ouverture (5 h à 23 h, au moins 4 h). */
  hours?: { open: number; close: number };
  /** Service de nettoyage de nuit. */
  cleanService?: boolean;
}
/** Une modification prévue par un réglage en lot (aperçu avant validation). */
export interface BatchChange {
  shopId: number;
  kind: 'prix' | 'auto' | 'horaires' | 'nettoyage';
  /** Produit concerné (prix, réassort). */
  productId?: string;
  label: string;
  from: string;
  to: string;
  /** Valeur appliquée (prix en CHF ; 1/0 pour un interrupteur ; horaires : ouverture × 100 + fermeture). */
  value: number;
  /** Variation de coût par jour (service de nettoyage). */
  perDay?: number;
}

export interface GameSave {
  v: number;
  seed: number;
  companyName: string;
  total: number;
  cash: number;
  player: Player;
  shops: Shop[];
  employees: Employee[];
  candidates: Candidate[];
  orders: Order[];
  vehicles: Vehicle[];
  loans: Loan[];
  campaigns: Campaign[];
  ledger: DayStats[];
  achieved?: string[];
  sublets?: Sublet[];
  market?: Record<string, number>;
  rivals?: Record<string, number>;
  /** Entreprises et commerces rivaux (absent : tirés de la graine, comme en début de partie). */
  rivalry?: RivalSave;
  weather?: Weather;
  marketDay?: boolean;
  /** Contrat fournisseur en cours (absent : aucun). */
  contract?: ContractKind | null;
  /** Placements, notoriété, impôts (absent : rien de placé, aucune notoriété). */
  finance?: FinanceSave;
  /** Logistique : entrepôts, importations, stocks minimums, tournées (absent : aucun entrepôt). */
  logi?: LogiState;
  nextId: number;
  rng: number[];
}

export class Game {
  readonly district: District;
  companyName: string;
  total: number;
  cash: number;
  player: Player;
  shops: Shop[] = [];
  employees: Employee[] = [];
  candidates: Candidate[] = [];
  orders: Order[] = [];
  vehicles: Vehicle[] = [];
  loans: Loan[] = [];
  campaigns: Campaign[] = [];
  /** Bilan quotidien de l'entreprise (tous commerces). */
  ledger: DayStats[] = [];
  today: DayStats;
  notices: Notice[] = [];
  events: ClientEvent[] = [];
  feedback: Feedback[] = [];
  /** Objectifs atteints (ids, dans l'ordre). */
  achieved: string[] = [];
  /** Sous-locations en cours. */
  sublets: Sublet[] = [];
  /** Indice des prix du grossiste par produit (1 = prix catalogue), varie chaque jour. */
  market: Record<string, number> = {};
  /** Prix pratiqués par les concurrents, par type de commerce (1 = prix habituel ; baisse quand vous leur prenez des clients). */
  rivals: Record<string, number> = {};
  /** Météo du jour (tirée à minuit). */
  weather: Weather = 'soleil';
  /** Jour de marché dans le quartier (plus de passants toute la journée). */
  marketDay = false;
  /** Contrat fournisseur avec le grossiste (remise sur les achats contre un forfait quotidien). */
  contract: ContractKind | null = null;
  /** Placements : valeur actuelle et montant net versé, par produit. */
  invest: Record<InvestKind, number> = { epargne: 0, fonds: 0 };
  investPrincipal: Record<InvestKind, number> = { epargne: 0, fonds: 0 };
  /** Rendements quotidiens du fonds (14 derniers jours, part : 0.01 = +1 %). */
  fundReturns: number[] = [];
  /** Notoriété (part de clients en plus) par commerce (id) et pour toute l'entreprise ('all'). */
  awareness: Record<string, number> = {};
  /** Impôts des dernières semaines (12 au plus). */
  taxes: TaxRecord[] = [];
  /** Logistique : entrepôts, importations en cours, stocks minimums des commerces, tournées (voir logistics.ts). */
  logi: LogiState = emptyLogi();
  private rng: Rng;
  /** Concurrence active : entreprises rivales, leurs commerces, promotions, rachats (src/sim/rivals.ts). */
  readonly rivalry: Rivalry = new Rivalry(this, { newId: () => this.nextId++, bump: () => this.bump() });
  private nextId = 1;
  /** Version de l'état (l'interface ne redessine que si elle change). */
  version = 0;

  constructor(readonly seed: number, companyName = 'Mon entreprise', save?: GameSave) {
    this.district = generateDistrict(seed);
    this.companyName = companyName;
    this.rng = new Rng(seed ^ 0x5bd1e995);
    this.total = START_MINUTE;
    this.cash = CONFIG.startCash;
    this.today = emptyDay(0);
    const home = this.district.homes.find((h) => h.id === this.district.startHome);
    this.player = {
      x: home?.doorX ?? 0, z: home?.doorZ ?? 0, heading: 0, energy: 90, hunger: 75, home: home?.id ?? null, carry: {},
      tending: null, sleeping: false, driving: null, place: home ? { kind: 'logement', homeId: home.id } : { kind: 'rue' }, teleportHome: false,
    };
    if (save) this.restore(save);
    else this.refreshCandidates();
    this.rivalry.init(save?.rivalry);
  }

  /* ------------------------------ Lecture ------------------------------ */

  premise(id: number): Premise | undefined { return this.district.premises.find((p) => p.id === id); }
  building(id: number): Building | undefined { return this.district.buildings.find((b) => b.id === id); }
  shop(id: number): Shop | undefined { return this.shops.find((s) => s.id === id); }
  shopAt(premiseId: number): Shop | undefined { return this.shops.find((s) => s.premiseId === premiseId); }
  staffOf(shopId: number): Employee[] { return this.employees.filter((e) => e.shopId === shopId); }
  vehicle(id: number): Vehicle | undefined { return this.vehicles.find((v) => v.id === id); }
  get debt(): number { return this.loans.reduce((a, l) => a + l.remaining, 0); }
  get day(): number { return Math.floor(this.total / MINUTES_PER_DAY); }

  /** Statistiques d'aménagement (en cache jusqu'au prochain changement de mobilier). */
  stats(shop: Shop): LayoutStats {
    const c = this.statsCache.get(shop.id);
    if (c && c.rev === this.layoutRev) return c.st;
    const p = this.premise(shop.premiseId)!;
    const st = layoutStats(shop.items, p.gridW, p.gridD);
    this.statsCache.set(shop.id, { rev: this.layoutRev, st });
    return st;
  }
  private readonly statsCache = new Map<number, { rev: number; st: LayoutStats }>();
  /** Incrémenté à chaque changement de mobilier (tous commerces). */
  layoutRev = 0;

  isFree(p: Premise): boolean { return !p.warehouse && !p.competitor && !this.shopAt(p.id) && !this.sublets.some((x) => x.kind === 'local' && x.ref === p.id); }
  /** Logement libre : ni le vôtre, ni déjà pris à bail. */
  homeFree(homeId: number): boolean { return this.player.home !== homeId && !this.sublets.some((x) => x.kind === 'logement' && x.ref === homeId); }
  subletOf(kind: Sublet['kind'], ref: number): Sublet | undefined { return this.sublets.find((x) => x.kind === kind && x.ref === ref); }

  /** Prix de vente de référence d'un produit dans le quartier (prix habituel × prix des concurrents). */
  refPrice(pr: ProductDef, shop?: Shop): number { return r2(pr.basePrice * (this.rivals[pr.shop] ?? 1) * (shop?.premium ? PREMIUM.priceMult : 1)); }
  /** Coût d'achat catalogue d'un produit pour un commerce (gamme premium plus chère). */
  unitCost(pr: ProductDef, shop?: Shop): number { return pr.cost * (shop?.premium ? PREMIUM.costMult : 1); }
  /** Contrat fournisseur en cours (définition), ou null. */
  contractDef(): ContractDef | null { return this.contract ? CONTRACT_BY_ID.get(this.contract) ?? null : null; }
  /** Effet de la météo sur la fréquentation selon le type de commerce. */
  weatherFactor(type: ShopType): number {
    if (this.weather === 'pluie') return type === 'cafe' || type === 'fastfood' ? 1.05 : type === 'fleuriste' || type === 'primeur' ? 0.7 : 0.82;
    if (this.weather === 'nuages') return 0.96;
    return type === 'fleuriste' || type === 'primeur' ? 1.08 : 1;
  }
  /** Indice du grossiste pour un produit (1 = prix catalogue). */
  marketIndex(productId: string): number { return this.market[productId] ?? 1; }

  /** Loyer de marché par jour d'une sous-location : appartement (loyer du logement) ou local (loyer / 30). */
  marketRent(kind: Sublet['kind'], ref: number): number {
    if (kind === 'logement') { const h = this.district.homes.find((x) => x.id === ref); return h ? HOME_BY_ID.get(h.def)!.rentDay : 0; }
    const p = this.premise(ref);
    return p ? r2(p.rent / 30) : 0;
  }

  /**
   * Prend à bail un appartement ou un local pour le sous-louer (sur place). Appartement : une semaine d'avance ;
   * local : dépôt d'un mois. Le loyer demandé au locataire part à +25 % du loyer payé.
   */
  leaseForSublet(kind: Sublet['kind'], ref: number): Result<Sublet> {
    const pl = this.player.place;
    if (kind === 'logement') {
      const h = this.district.homes.find((x) => x.id === ref);
      if (!h) return fail('Logement introuvable');
      if (!this.homeFree(ref)) return fail('Ce logement n’est pas libre.');
      if (!(pl.kind === 'rue' || (pl.kind === 'logement'))) return fail('Rendez-vous devant l’immeuble pour signer.');
    } else {
      const p = this.premise(ref);
      if (!p) return fail('Local introuvable');
      if (!this.isFree(p)) return fail('Ce local est déjà occupé');
    }
    const cost = this.marketRent(kind, ref);
    const upfront = kind === 'logement' ? r2(cost * 7) : r2(cost * 30 * ECONOMY.depositMonths);
    if (this.cash < upfront) return fail(`Trésorerie insuffisante : ${Math.round(upfront)} CHF à verser.`);
    this.cash -= upfront;
    if (kind === 'logement') this.today.rent += upfront;
    const sl: Sublet = { id: this.nextId++, kind, ref, cost, ask: r2(cost * 1.25), tenant: null, since: 0, deposit: kind === 'local' ? upfront : 0, prepaid: kind === 'logement' ? 7 : 0 };
    this.sublets.push(sl);
    this.notify('ok', `Bail signé pour sous-louer ${kind === 'logement' ? 'un appartement' : 'un local'} (${Math.round(cost)} CHF / jour). Fixez le loyer demandé dans l’appli Immobilier.`);
    this.bump();
    return ok(sl);
  }

  /** Loyer demandé au locataire (CHF / jour), entre 50 % et 250 % du loyer de marché. */
  setSubletAsk(id: number, ask: number): Result<number> {
    const sl = this.sublets.find((x) => x.id === id);
    if (!sl) return fail('Sous-location introuvable');
    if (!Number.isFinite(ask) || ask <= 0) return fail('Loyer invalide');
    const m = this.marketRent(sl.kind, sl.ref);
    sl.ask = r2(Math.min(m * 2.5, Math.max(m * 0.5, ask)));
    this.bump();
    return ok(sl.ask);
  }

  /** Résilie une sous-location (le locataire part ; dépôt du local rendu). */
  endSublet(id: number): Result<number> {
    const sl = this.sublets.find((x) => x.id === id);
    if (!sl) return fail('Sous-location introuvable');
    // Jours payés d'avance et non utilisés : remboursés.
    const unused = r2((sl.prepaid ?? 0) * sl.cost);
    this.cash += sl.deposit + unused;
    if (unused > 0) this.today.rent -= unused;
    this.sublets = this.sublets.filter((x) => x !== sl);
    this.notify('info', `Bail résilié${sl.tenant ? ` (locataire ${sl.tenant} parti)` : ''}.${sl.deposit ? ` Dépôt rendu : ${Math.round(sl.deposit)} CHF.` : ''}${unused > 0 ? ` Loyer payé d’avance rendu : ${Math.round(unused)} CHF.` : ''}`);
    this.bump();
    return ok(r2(sl.deposit + unused));
  }

  /**
   * Événements de 11 h : contrôle d'hygiène (amende si rayons vides, pas de caisse ou meubles inaccessibles ; sinon
   * bonus de réputation) et vol à l'étalage (stock perdu ; moins probable avec deux employés ou plus).
   */
  private dayEvents(): void {
    for (const s of this.shops) {
      const st = this.stats(s);
      if (this.day >= 3 && this.rng.next() < 0.06) {
        const empty = productsOf(s.type).filter((p) => st.capacity[p.store] > 0 && s.products[p.id]!.stock === 0).length;
        const faults: string[] = [];
        if (st.registers === 0) faults.push('pas de caisse');
        if (empty > 0) faults.push(`${empty} rayon(s) vide(s)`);
        if (st.blocked.length) faults.push('meubles inaccessibles');
        if (this.cleanliness(s) < CLEANING.warn) faults.push(`magasin sale (${Math.round(this.cleanliness(s))} %)`);
        if (faults.length) {
          const fine = 150 + 100 * faults.length;
          this.cash -= fine; s.today.equipment += fine; this.today.equipment += fine;
          s.reputation = Math.max(0, s.reputation - 0.05);
          this.notify('error', `Contrôle d’hygiène chez ${s.name} : amende de ${fine} CHF (${faults.join(', ')}).`);
        } else {
          s.reputation = Math.min(1, s.reputation + 0.03);
          this.notify('ok', `Contrôle d’hygiène réussi chez ${s.name} : réputation en hausse.`);
        }
      }
      const staff = this.onDuty(s.id).length;
      if (s.rate > 0 && this.rng.next() < (staff >= 2 ? 0.02 : 0.05)) {
        const stocked = productsOf(s.type).filter((p) => s.products[p.id]!.stock > 0);
        if (stocked.length) {
          const p = this.rng.pick(stocked), n = Math.min(s.products[p.id]!.stock, this.rng.int(3, 8));
          s.products[p.id]!.stock -= n;
          this.notify('warn', `Vol à l’étalage chez ${s.name} : ${n} ${p.nameFr.toLowerCase()} disparu(s). Deux employés présents ou plus découragent les voleurs.`);
        }
      }
    }
    this.bump();
  }

  /** Salaire du marché (CHF / h) pour une compétence donnée. */
  marketWage(skill: number, training = 0): number { return Math.round(20 + skill * 14 + 1.5 + TRAINING.wage * training); }

  /** Augmente (ou fixe) le salaire horaire d'un employé ; la satisfaction monte aussitôt. */
  raiseWage(employeeId: number, wage: number): Result<number> {
    const e = this.employees.find((x) => x.id === employeeId);
    if (!e) return fail('Employé introuvable');
    const w = Math.round(wage);
    if (!(w >= 15 && w <= 80)) return fail('Salaire : de 15 à 80 CHF / h');
    const up = w > e.wage;
    e.wage = w;
    if (up) { e.mood = Math.min(1, (e.mood ?? 0.75) + 0.25); e.askedRaise = false; e.unhappy = 0; }
    this.notify(up ? 'ok' : 'warn', `${e.name} : nouveau salaire ${w} CHF / h.`);
    this.bump();
    return ok(w);
  }

  /* ------------------------------ Milieu de partie : formation, gamme premium, contrats ------------------------------ */

  /** Coût du prochain niveau de formation d'un employé, ou null s'il est au maximum. */
  nextTrainingCost(e: Employee): number | null {
    const lv = e.training ?? 0;
    return lv >= TRAINING.maxLevel ? null : trainingCost(lv + 1);
  }

  /**
   * Forme un employé (niveau suivant, payé aussitôt) : +12 % de clients servis en caisse et +5 points de compétence
   * par niveau, satisfaction en hausse ; mais son salaire de marché monte (TRAINING.wage CHF / h par niveau).
   */
  train(employeeId: number): Result<number> {
    const e = this.employees.find((x) => x.id === employeeId);
    if (!e) return fail('Employé introuvable');
    const cost = this.nextTrainingCost(e);
    if (cost === null) return fail(`${e.name} a déjà suivi toutes les formations.`);
    if (this.cash < cost) return fail(`Trésorerie insuffisante (${cost} CHF)`);
    this.cash -= cost;
    this.today.wages += cost;
    const s = e.shopId === null ? undefined : this.shop(e.shopId);
    if (s) s.today.wages += cost;
    e.training = (e.training ?? 0) + 1;
    e.skill = Math.min(1, r2(e.skill + TRAINING.skill));
    e.mood = Math.min(1, (e.mood ?? 0.75) + 0.1);
    this.notify('ok', `${e.name} a suivi la formation niveau ${e.training} : sert ${Math.round(TRAINING.capacity * e.training * 100)} % de clients en plus. Salaire du marché : ${this.marketWage(e.skill, e.training)} CHF / h.`);
    this.refreshCapacities();
    this.bump();
    return ok(cost);
  }

  /** Meilleur niveau de formation parmi les employés d'un commerce. */
  bestTraining(shopId: number): number { return this.staffOf(shopId).reduce((m, e) => Math.max(m, e.training ?? 0), 0); }

  /**
   * Passe un commerce en gamme premium (ou revient en standard). Première mise en place payante, et il faut au moins
   * un employé formé dans le commerce. Les prix de vente suivent (× ou ÷ PREMIUM.priceMult).
   */
  setPremium(shopId: number, on: boolean): Result<number> {
    const s = this.shop(shopId);
    if (!s) return fail('Commerce introuvable');
    if (!!s.premium === on) return ok(0);
    const def = PREMIUM_BY_TYPE.get(s.type)!;
    let cost = 0;
    if (on) {
      if (this.bestTraining(s.id) < PREMIUM.minTraining) return fail('Il faut au moins un employé formé dans ce commerce (onglet Employés › Former).');
      if (!s.premiumOwned) {
        cost = def.cost;
        if (this.cash < cost) return fail(`Trésorerie insuffisante (${cost} CHF)`);
        this.cash -= cost;
        s.today.equipment += cost; this.today.equipment += cost;
        s.premiumOwned = true;
      }
    }
    const k = on ? PREMIUM.priceMult : 1 / PREMIUM.priceMult;
    for (const pr of productsOf(s.type)) s.products[pr.id]!.price = r2(s.products[pr.id]!.price * k);
    s.premium = on;
    this.notify(on ? 'ok' : 'info', on
      ? `${s.name} passe en gamme premium (${def.nameFr}) : prix et coûts d’achat plus élevés, clientèle selon la réputation.`
      : `${s.name} revient à la gamme standard.`);
    this.bump();
    return ok(cost);
  }

  /** Signe (ou résilie avec null) un contrat fournisseur, chez le grossiste. Le premier jour est payé à la signature. */
  signContract(kind: ContractKind | null): Result<number> {
    const here = this.needService('grossiste', 'chez le grossiste');
    if (!here.ok) return here;
    if (kind === this.contract) return ok(0);
    if (kind === null) {
      this.contract = null;
      this.notify('info', 'Contrat fournisseur résilié.');
      this.bump();
      return ok(0);
    }
    const def = CONTRACT_BY_ID.get(kind);
    if (!def) return fail('Contrat inconnu');
    if (this.cash < def.perDay) return fail(`Trésorerie insuffisante (${def.perDay} CHF)`);
    this.cash -= def.perDay;
    this.today.purchases += def.perDay;
    this.contract = kind;
    this.notify('ok', `${def.nameFr} signé : ${Math.round(def.discount * 100)} % de remise sur vos achats, ${def.perDay} CHF par jour.`);
    this.bump();
    return ok(def.perDay);
  }

  /** Probabilité quotidienne de trouver un locataire selon le loyer demandé (rapport au loyer de marché). */
  tenantChance(sl: Sublet): number {
    const ratio = sl.ask / Math.max(1, this.marketRent(sl.kind, sl.ref));
    return Math.max(0.04, Math.min(0.85, 0.75 * Math.exp(-3.2 * (ratio - 1.05))));
  }

  /** Unités stockables d'un produit (capacité du meuble partagée entre les produits qu'il présente). */
  storageFor(shop: Shop, prod: ProductDef, st = this.stats(shop)): number {
    const same = productsOf(shop.type).filter((p) => p.store === prod.store).length;
    return Math.floor(st.capacity[prod.store] / Math.max(1, same));
  }

  pendingQty(shopId: number, productId: string): number {
    return this.orders.filter((o) => o.shopId === shopId && o.productId === productId).reduce((a, o) => a + o.qty, 0);
  }

  competition(p: Premise, type: ShopType): number {
    return this.rivalry.pressure(p, type);
  }

  /** Clients attendus par heure à l'heure de pointe pour un type de commerce dans ce local (aménagement moyen). */
  estimatePeak(p: Premise, type: ShopType): number {
    const t = SHOP_TYPE_BY_ID.get(type)!;
    return p.footfall * t.capture * (1 / (1 + 0.6 * this.competition(p, type)));
  }

  /** Capacité de transport (unités) : à pied ou dans un véhicule. */
  capacityOf(carrier: 'pied' | number): number {
    if (carrier === 'pied') return ECONOMY.carryOnFoot;
    const v = this.vehicle(carrier);
    return v ? VEHICLE_BY_ID.get(v.type)!.cargo : 0;
  }
  loadOf(carrier: 'pied' | number): Record<string, number> {
    if (carrier === 'pied') return this.player.carry;
    return this.vehicle(carrier)?.cargo ?? {};
  }
  freeLoad(carrier: 'pied' | number): number { return this.capacityOf(carrier) - sumValues(this.loadOf(carrier)); }

  /** Véhicules du joueur garés à moins de ECONOMY.loadDistance de (x, z). */
  vehiclesNear(x: number, z: number): Vehicle[] {
    return this.vehicles.filter((v) => Math.hypot(v.x - x, v.z - z) <= ECONOMY.loadDistance);
  }

  /** Service où se trouve le personnage (bâtiment), ou null. */
  private serviceHere(kind: ServiceKind): Building | null {
    const pl = this.player.place;
    if (pl.kind !== 'service' || pl.service !== kind) return null;
    return this.building(pl.buildingId) ?? null;
  }
  private needService(kind: ServiceKind, label: string): Result<Building> {
    const b = this.serviceHere(kind);
    return b ? ok(b) : fail(`Rendez-vous ${label} pour cela.`);
  }

  /** Bonus de clientèle des campagnes en cours pour un commerce. */
  /**
   * Bonus de clientèle d'un commerce : sa notoriété (campagnes ciblées) plus celle de l'entreprise (internet),
   * plafonnée. Chaque campagne l'augmente dès le lancement puis chaque jour qu'elle dure ; elle s'estompe chaque nuit.
   */
  marketingBoost(shopId: number): number {
    return Math.min(FINANCE.awarenessMax, (this.awareness[shopId] ?? 0) + (this.awareness['all'] ?? 0));
  }
  /** Notoriété prévue demain (après la nuit) pour une clé ('all' ou id de commerce), campagnes en cours comprises. */
  private awarenessNext(key: string): number {
    let gain = 0;
    for (const c of this.campaigns) if (String(c.shopId ?? 'all') === key) gain += CAMPAIGN_BY_ID.get(c.kind)!.boost * FINANCE.awarenessGain;
    return Math.min(FINANCE.awarenessMax, (this.awareness[key] ?? 0) * (1 - FINANCE.awarenessDecay) + gain);
  }
  /** Notoriété d'un commerce aujourd'hui et demain (tendance). */
  awarenessView(shopId: number): { now: number; next: number; trend: number } {
    const now = this.marketingBoost(shopId);
    const next = Math.min(FINANCE.awarenessMax, this.awarenessNext(String(shopId)) + this.awarenessNext('all'));
    return { now, next, trend: next - now };
  }

  /* ------------------------------ Finances : impôts, crédit, placements ------------------------------ */

  /**
   * Impôt de la semaine en cours : bénéfice depuis le début de la semaine (avant impôt), montant estimé, jours avant
   * le prélèvement (0 : ce soir à minuit). Les premières semaines sont exonérées.
   */
  taxEstimate(): { week: number; base: number; due: number; daysLeft: number; exempt: boolean } {
    const P = FINANCE.taxPeriod, week = Math.floor(this.today.day / P);
    const days = [...this.ledger.filter((d) => Math.floor(d.day / P) === week), this.today];
    // Le remboursement du capital d'un prêt n'est pas une charge : seuls les intérêts réduisent le bénéfice imposable.
    const base = r2(days.reduce((a, d) => a + dayProfit(d) + (d.tax ?? 0) + (d.principal ?? 0), 0));
    const exempt = week < FINANCE.taxGraceWeeks;
    return { week, base, due: exempt ? 0 : r2(Math.max(0, base) * FINANCE.taxRate), daysLeft: week * P + P - 1 - this.today.day, exempt };
  }

  /** Plafond de crédit : socle + 150 % de la valeur nette positive + deux semaines de ventes récentes (borné). */
  creditLimit(): { limit: number; base: number; worth: number; fromWorth: number; sales7: number; fromSales: number; capped: boolean; available: number } {
    const worth = netWorth(this);
    const sales7 = r2(this.ledger.slice(-7).reduce((a, d) => a + d.revenue, 0));
    const fromWorth = Math.round(Math.max(0, worth) * FINANCE.creditWorthShare);
    const fromSales = Math.round(sales7 * FINANCE.creditSalesWeeks);
    const raw = FINANCE.creditBase + fromWorth + fromSales;
    const limit = Math.min(FINANCE.creditMax, raw);
    return { limit, base: FINANCE.creditBase, worth, fromWorth, sales7, fromSales, capped: raw > FINANCE.creditMax, available: Math.max(0, r2(limit - this.debt)) };
  }

  /** Valeur de rachat des placements (frais de retrait déduits). */
  investValue(kind?: InvestKind): number {
    const kinds = kind ? [kind] : INVESTMENTS.map((i) => i.id);
    return r2(kinds.reduce((a, k) => a + (this.invest[k] ?? 0) * (1 - INVEST_BY_ID.get(k)!.exitFee), 0));
  }

  /** Place de l'argent (banque en ligne, depuis le téléphone). */
  deposit(kind: InvestKind, amount: number): Result<number> {
    const def = INVEST_BY_ID.get(kind);
    if (!def) return fail('Placement inconnu');
    if (!Number.isFinite(amount) || amount < FINANCE.investMin) return fail(`Placement minimal : ${FINANCE.investMin} CHF.`);
    const a = r2(amount);
    if (this.cash < a) return fail(`Trésorerie insuffisante (${Math.round(this.cash)} CHF disponibles).`);
    this.cash -= a;
    this.invest[kind] = r2((this.invest[kind] ?? 0) + a);
    this.investPrincipal[kind] = r2((this.investPrincipal[kind] ?? 0) + a);
    this.notify('ok', `${def.nameFr} : ${Math.round(a)} CHF placés.`);
    this.bump();
    return ok(a);
  }

  /** Retire `amount` CHF de valeur d'un placement (tout si amount ≥ solde) ; renvoie la somme versée, frais déduits. */
  withdraw(kind: InvestKind, amount: number): Result<number> {
    const def = INVEST_BY_ID.get(kind);
    if (!def) return fail('Placement inconnu');
    const bal = this.invest[kind] ?? 0;
    if (bal <= 0) return fail('Rien n’est placé sur ce produit.');
    if (!Number.isFinite(amount) || amount <= 0) return fail('Montant invalide');
    const take = Math.min(bal, r2(amount));
    const fee = r2(take * def.exitFee), paid = r2(take - fee);
    this.investPrincipal[kind] = take >= bal ? 0 : r2((this.investPrincipal[kind] ?? 0) * (1 - take / bal));
    this.invest[kind] = take >= bal ? 0 : r2(bal - take);
    this.cash += paid;
    this.notify('ok', `${def.nameFr} : ${Math.round(paid)} CHF retirés${fee > 0 ? ` (frais ${Math.round(fee)} CHF)` : ''}.`);
    this.bump();
    return ok(paid);
  }

  /* ------------------------------ Lieu, position ------------------------------ */

  setPlace(place: Place): void {
    this.player.place = place;
    if (this.player.tending !== null && !(place.kind === 'commerce' && place.shopId === this.player.tending)) this.tend(null);
    this.bump();
  }
  setPlayerPose(x: number, z: number, heading: number): void { this.player.x = x; this.player.z = z; this.player.heading = heading; }
  setVehiclePose(id: number, x: number, z: number, heading: number): void {
    const v = this.vehicle(id);
    if (v) { v.x = x; v.z = z; v.heading = heading; }
  }
  setDriving(id: number | null): void { this.player.driving = id; this.bump(); }

  /* ------------------------------ Locaux et aménagement ------------------------------ */

  rent(premiseId: number, type: ShopType, name?: string): Result<Shop> {
    const p = this.premise(premiseId);
    if (!p) return fail('Local introuvable');
    if (!this.isFree(p)) return fail('Ce local est déjà occupé');
    const deposit = p.rent * ECONOMY.depositMonths;
    if (this.cash < deposit) return fail(`Trésorerie insuffisante : dépôt de garantie de ${deposit} CHF`);
    const t = SHOP_TYPE_BY_ID.get(type);
    if (!t) return fail('Type de commerce inconnu');
    this.cash -= deposit;
    const products: Record<string, ProductState> = {};
    for (const pr of productsOf(type)) products[pr.id] = { price: pr.basePrice, stock: 0, auto: false };
    const shop: Shop = {
      id: this.nextId++, premiseId, type, name: name?.trim() || `${t.nameFr} ${this.companyName}`.slice(0, 40), items: [], nextUid: 1, storage: {}, products,
      open: t.open, close: t.close, reputation: 0.22, deposit, rentDue: 0, leaseDay: this.day, today: emptyDay(this.day), history: [], rate: 0, capacity: 0, servedThisHour: 0, warned: [],
    };
    this.shops.push(shop);
    this.notify('ok', `Local loué : ${shop.name} (${p.area} m², ${p.rent} CHF / mois). Achetez des meubles au magasin de meubles, puis aménagez.`);
    this.bump();
    return ok(shop);
  }

  /**
   * Décompte d'une résiliation : dépôt rendu, mobilier revendu, commandes non livrées et jours de publicité restants
   * remboursés, loyer provisionné retenu ; stock en rayon perdu (unités et valeur d'achat).
   */
  releaseQuote(shopId: number): { deposit: number; resale: number; refunds: number; rentDue: number; stockUnits: number; stockValue: number; total: number } | null {
    const s = this.shop(shopId);
    if (!s) return null;
    let stored = 0;
    for (const [id, n] of Object.entries(s.storage)) stored += (FURNITURE_BY_ID.get(id)?.price ?? 0) * n;
    const resale = Math.round((this.stats(s).value + stored) * ECONOMY.resale);
    const refunds = r2(this.orders.filter((o) => o.shopId === s.id).reduce((a, o) => a + o.cost, 0)
      + this.campaigns.filter((c) => c.shopId === s.id).reduce((a, c) => a + c.daysLeft * c.perDay, 0));
    let stockUnits = 0, stockValue = 0;
    for (const pr of productsOf(s.type)) { const n = s.products[pr.id]!.stock; stockUnits += n; stockValue += n * this.unitCost(pr, s); }
    const rentDue = r2(s.rentDue ?? 0);
    return { deposit: s.deposit, resale, refunds, rentDue, stockUnits, stockValue: r2(stockValue), total: r2(s.deposit + resale + refunds - rentDue) };
  }

  release(shopId: number): Result<number> {
    const s = this.shop(shopId), q = this.releaseQuote(shopId);
    if (!s || !q) return fail('Commerce introuvable');
    this.cash += q.total;
    for (const e of this.staffOf(s.id)) e.shopId = null;
    this.orders = this.orders.filter((o) => o.shopId !== s.id);
    this.campaigns = this.campaigns.filter((c) => c.shopId !== s.id);
    delete this.awareness[s.id];
    if (this.player.tending === s.id) this.player.tending = null;
    this.shops = this.shops.filter((x) => x !== s);
    const parts = [`dépôt rendu ${Math.round(q.deposit)} CHF`, `mobilier revendu ${q.resale} CHF`];
    if (q.refunds > 0) parts.push(`commandes et publicité remboursées ${Math.round(q.refunds)} CHF`);
    if (q.rentDue > 0) parts.push(`loyer dû retenu ${Math.round(q.rentDue)} CHF`);
    this.notify('info', `Bail résilié : ${s.name}. ${parts.join(', ')} : ${Math.round(q.total)} CHF au total.${q.stockUnits > 0 ? ` ${q.stockUnits} articles en rayon perdus.` : ''}`);
    this.bump();
    return ok(q.total);
  }

  /** Achat de meubles au magasin de meubles, livrés dans la réserve du commerce. */
  buyFurniture(defId: string, qty: number, shopId: number): Result<number> {
    const here = this.needService('meubles', 'au magasin de meubles');
    if (!here.ok) return here;
    const def = FURNITURE_BY_ID.get(defId), s = this.shop(shopId);
    if (!def || !s) return fail('Meuble ou commerce inconnu');
    const n = Math.floor(qty);
    if (!(n > 0 && n <= 20)) return fail('Quantité : de 1 à 20');
    const cost = def.price * n + ECONOMY.furnitureDelivery;
    if (this.cash < cost) return fail(`Trésorerie insuffisante (${cost} CHF)`);
    this.cash -= cost;
    s.today.equipment += cost; this.today.equipment += cost;
    s.storage[defId] = (s.storage[defId] ?? 0) + n;
    this.notify('ok', `${n} × ${def.nameFr} livré(s) dans la réserve de ${s.name}.`);
    this.bump();
    return ok(cost);
  }

  /** Pose d'un meuble de la réserve. */
  place(shopId: number, defId: string, x: number, z: number, rot: Rot): Result<PlacedItem> {
    const s = this.shop(shopId), def = FURNITURE_BY_ID.get(defId);
    if (!s || !def) return fail('Commerce ou meuble inconnu');
    if (!(s.storage[defId]! > 0)) return fail(`Aucun « ${def.nameFr} » en réserve : achetez-en au magasin de meubles.`);
    const p = this.premise(s.premiseId)!;
    const why = canPlace(s.items, p.gridW, p.gridD, def, x, z, rot);
    if (why) return fail(why);
    s.storage[defId]!--;
    if (s.storage[defId] === 0) delete s.storage[defId];
    const it: PlacedItem = { uid: s.nextUid++, def: defId, x, z, rot };
    s.items.push(it);
    this.layoutChanged(s);
    return ok(it);
  }

  moveItem(shopId: number, uid: number, x: number, z: number, rot: Rot): Result<PlacedItem> {
    const s = this.shop(shopId);
    const it = s?.items.find((i) => i.uid === uid);
    if (!s || !it) return fail('Meuble introuvable');
    const p = this.premise(s.premiseId)!;
    const why = canPlace(s.items, p.gridW, p.gridD, FURNITURE_BY_ID.get(it.def)!, x, z, rot, uid);
    if (why) return fail(why);
    it.x = x; it.z = z; it.rot = rot;
    this.layoutChanged(s);
    return ok(it);
  }

  /** Remet un meuble posé dans la réserve. */
  pickUp(shopId: number, uid: number): Result<string> {
    const s = this.shop(shopId);
    const it = s?.items.find((i) => i.uid === uid);
    if (!s || !it) return fail('Meuble introuvable');
    s.items = s.items.filter((i) => i !== it);
    s.storage[it.def] = (s.storage[it.def] ?? 0) + 1;
    this.layoutChanged(s);
    return ok(it.def);
  }

  /** Revend un meuble de la réserve (ECONOMY.resale du prix). */
  sellStored(shopId: number, defId: string): Result<number> {
    const s = this.shop(shopId), def = FURNITURE_BY_ID.get(defId);
    if (!s || !def || !(s.storage[defId]! > 0)) return fail('Aucun meuble de ce type en réserve');
    s.storage[defId]!--;
    if (s.storage[defId] === 0) delete s.storage[defId];
    const refund = Math.round(def.price * ECONOMY.resale);
    this.cash += refund;
    this.bump();
    return ok(refund);
  }

  private layoutChanged(s: Shop): void {
    this.layoutRev++;
    // Stock en trop pour la nouvelle capacité : mis de côté dans la réserve n'existe pas, il est perdu (signalé).
    const st = this.stats(s);
    for (const pr of productsOf(s.type)) {
      const ps = s.products[pr.id]!, cap = this.storageFor(s, pr, st);
      if (ps.stock > cap) { this.notify('warn', `${s.name} : ${ps.stock - cap} ${pr.nameFr.toLowerCase()} jetés (plus de place en rayon).`); ps.stock = cap; }
    }
    s.capacity = this.capacityNow(s);
    this.bump();
  }

  setPrice(shopId: number, productId: string, price: number): Result<number> {
    const s = this.shop(shopId), pr = PRODUCT_BY_ID.get(productId);
    if (!s || !pr || !s.products[productId]) return fail('Produit inconnu');
    if (!Number.isFinite(price) || price <= 0) return fail('Prix invalide');
    const base = pr.basePrice * (s.premium ? PREMIUM.priceMult : 1);
    const v = r2(Math.min(base * 3, Math.max(base * 0.3, price)));
    s.products[productId]!.price = v;
    this.bump();
    return ok(v);
  }

  setAuto(shopId: number, productId: string, on: boolean): Result {
    const ps = this.shop(shopId)?.products[productId];
    if (!ps) return fail('Produit inconnu');
    ps.auto = on;
    this.bump();
    return ok(undefined);
  }

  setHours(shopId: number, open: number, close: number): Result {
    const s = this.shop(shopId);
    if (!s) return fail('Commerce introuvable');
    if (!(Number.isInteger(open) && Number.isInteger(close) && open >= 5 && close <= 23 && close - open >= 4)) return fail('Horaires : de 5 h à 23 h, au moins 4 h d’ouverture');
    s.open = open; s.close = close;
    this.bump();
    return ok(undefined);
  }

  /* ------------------------------ Réglages en lot ------------------------------ */

  /** Commerces visés par un réglage en lot. */
  batchShops(target: BatchTarget): Shop[] {
    return target === 'tous' ? [...this.shops] : this.shops.filter((s) => s.type === target);
  }

  /** Prix de vente borné comme setPrice (30 % à 300 % du prix de base de la gamme). */
  private clampPrice(s: Shop, pr: ProductDef, price: number): number {
    const base = pr.basePrice * (s.premium ? PREMIUM.priceMult : 1);
    return r2(Math.min(base * 3, Math.max(base * 0.3, price)));
  }

  /** Aperçu d'un réglage en lot : la liste de ce qui changerait (rien n'est modifié). */
  previewBatch(target: BatchTarget, set: BatchSettings): Result<BatchChange[]> {
    const shops = this.batchShops(target);
    if (!shops.length) return fail(target === 'tous' ? 'Aucun commerce.' : `Aucun commerce de type ${SHOP_TYPE_BY_ID.get(target)?.nameFr.toLowerCase() ?? target}.`);
    const f = set.priceFactor;
    if (f !== undefined && !(Number.isFinite(f) && f >= 0.3 && f <= 3)) return fail('Coefficient de prix : entre ×0,3 et ×3.');
    for (const [pid, v] of Object.entries(set.prices ?? {})) {
      if (!PRODUCT_BY_ID.has(pid)) return fail('Produit inconnu');
      if (!Number.isFinite(v) || v <= 0) return fail(`Prix invalide pour ${PRODUCT_BY_ID.get(pid)!.nameFr.toLowerCase()}.`);
    }
    const hrs = set.hours;
    if (hrs && !(Number.isInteger(hrs.open) && Number.isInteger(hrs.close) && hrs.open >= 5 && hrs.close <= 23 && hrs.close - hrs.open >= 4)) return fail('Horaires : de 5 h à 23 h, au moins 4 h d’ouverture');
    const out: BatchChange[] = [];
    const money = (v: number): string => `${v.toFixed(2).replace('.', ',')} CHF`;
    for (const s of shops) {
      for (const pr of productsOf(s.type)) {
        const ps = s.products[pr.id]!;
        const want = set.prices?.[pr.id] ?? (f !== undefined ? this.refPrice(pr, s) * f : undefined);
        if (want !== undefined) {
          const v = this.clampPrice(s, pr, want);
          if (Math.abs(v - ps.price) >= 0.005) out.push({ shopId: s.id, kind: 'prix', productId: pr.id, label: `Prix · ${pr.nameFr}`, from: money(ps.price), to: money(v), value: v });
        }
        if (set.auto !== undefined && ps.auto !== set.auto) out.push({ shopId: s.id, kind: 'auto', productId: pr.id, label: `Réassort auto · ${pr.nameFr}`, from: ps.auto ? 'oui' : 'non', to: set.auto ? 'oui' : 'non', value: set.auto ? 1 : 0 });
      }
      if (hrs && (hrs.open !== s.open || hrs.close !== s.close)) out.push({ shopId: s.id, kind: 'horaires', label: 'Horaires', from: `${s.open} h – ${s.close} h`, to: `${hrs.open} h – ${hrs.close} h`, value: hrs.open * 100 + hrs.close });
      if (set.cleanService !== undefined && !!s.cleanService !== set.cleanService) {
        const fee = this.cleanServiceCost(s.id);
        out.push({ shopId: s.id, kind: 'nettoyage', label: 'Nettoyage de nuit', from: s.cleanService ? 'oui' : 'non', to: set.cleanService ? `oui (${fee} CHF / jour)` : 'non', value: set.cleanService ? 1 : 0, perDay: set.cleanService ? fee : -fee });
      }
    }
    return ok(out);
  }

  /** Applique un réglage en lot à tous les commerces visés ; renvoie le nombre de commerces et de modifications. */
  applyBatch(target: BatchTarget, set: BatchSettings): Result<{ shops: number; changes: number }> {
    const plan = this.previewBatch(target, set);
    if (!plan.ok) return plan;
    const touched = new Set<number>();
    for (const c of plan.data) {
      const s = this.shop(c.shopId)!;
      touched.add(s.id);
      if (c.kind === 'prix') s.products[c.productId!]!.price = c.value;
      else if (c.kind === 'auto') s.products[c.productId!]!.auto = c.value === 1;
      else if (c.kind === 'horaires') { s.open = Math.floor(c.value / 100); s.close = c.value % 100; }
      else s.cleanService = c.value === 1;
    }
    if (plan.data.some((c) => c.kind === 'horaires')) this.refreshCapacities();
    const n = plan.data.length;
    if (n) this.notify('ok', `Réglages en lot appliqués : ${n} modification${n > 1 ? 's' : ''} dans ${touched.size} commerce${touched.size > 1 ? 's' : ''}.`);
    this.bump();
    return ok({ shops: touched.size, changes: n });
  }

  /* ------------------------------ Marchandise ------------------------------ */

  /**
   * Prix d'achat : remise de gros au-delà de ECONOMY.bulkQty unités, remise du contrat fournisseur ; gamme premium
   * plus chère si la commande est destinée à un commerce premium.
   */
  orderCost(productId: string, qty: number, shopId?: number): number {
    const pr = PRODUCT_BY_ID.get(productId)!;
    const shop = shopId === undefined ? undefined : this.shop(shopId);
    const contract = 1 - (this.contractDef()?.discount ?? 0);
    const unit = this.unitCost(pr, shop) * this.marketIndex(productId) * contract;
    // Remise de gros sans effet de seuil : en dessous de bulkQty, on ne paie jamais plus que bulkQty unités remisées.
    const bulk = ECONOMY.bulkQty * unit * (1 - ECONOMY.bulkDiscount);
    return r2(qty >= ECONOMY.bulkQty ? qty * unit * (1 - ECONOMY.bulkDiscount) : Math.min(qty * unit, bulk));
  }
  /** Frais de livraison : forfait une fois par livraison et par commerce (offert si une commande part déjà ce jour-là), plus une part du montant. */
  deliveryFee(goods: number, shopId?: number): number {
    const at = this.nextDelivery();
    const grouped = (shopId !== undefined && this.orders.some((o) => o.shopId === shopId && o.deliverAt === at)) || !!this.contractDef()?.freeDelivery;
    return r2((grouped ? 0 : ECONOMY.deliveryBase) + goods * ECONOMY.deliveryRate);
  }

  /** Place libre pour un produit (capacité − stock − commandes en cours). */
  room(shop: Shop, productId: string): number {
    const pr = PRODUCT_BY_ID.get(productId)!;
    return Math.max(0, this.storageFor(shop, pr) - shop.products[productId]!.stock - this.pendingQty(shop.id, productId));
  }

  /** Achat au grossiste, emporté : porté à pied ou chargé dans un véhicule garé devant. */
  buyStock(productId: string, qty: number, carrier: 'pied' | number): Result<number> {
    const here = this.needService('grossiste', 'chez le grossiste');
    if (!here.ok) return here;
    const pr = PRODUCT_BY_ID.get(productId);
    if (!pr) return fail('Produit inconnu');
    if (carrier !== 'pied') {
      const v = this.vehicle(carrier);
      if (!v) return fail('Véhicule introuvable');
      if (Math.hypot(v.x - here.data.doorX, v.z - here.data.doorZ) > ECONOMY.loadDistance) return fail(`${VEHICLE_BY_ID.get(v.type)!.nameFr} trop loin : garez-la devant le grossiste.`);
    }
    const free = this.freeLoad(carrier);
    if (free <= 0) return fail(carrier === 'pied' ? 'Vos bras sont pleins : déposez la marchandise ou prenez un véhicule.' : 'Véhicule plein.');
    const n = Math.min(Math.floor(qty), free);
    if (!(n > 0)) return fail('Quantité invalide');
    const cost = this.orderCost(productId, n);
    if (this.cash < cost) return fail(`Trésorerie insuffisante (${cost} CHF)`);
    this.cash -= cost;
    this.today.purchases += cost;
    const load = this.loadOf(carrier);
    load[productId] = (load[productId] ?? 0) + n;
    this.bump();
    return ok(n);
  }

  /** Commande livrée au commerce le lendemain à 7 h (frais de livraison). */
  order(shopId: number, productId: string, qty: number): Result<Order> {
    const s = this.shop(shopId), pr = PRODUCT_BY_ID.get(productId);
    if (!s || !pr || !s.products[productId]) return fail('Produit inconnu');
    const n = Math.floor(qty);
    if (!(n > 0)) return fail('Quantité invalide');
    const room = this.room(s, productId);
    if (room <= 0) return fail(`Plus de place pour ${pr.nameFr.toLowerCase()} : ajoutez un meuble adapté.`);
    const q = Math.min(n, room);
    const goods = this.orderCost(productId, q, shopId);
    const cost = r2(goods + this.deliveryFee(goods, shopId));
    if (this.cash < cost) return fail(`Trésorerie insuffisante (${cost} CHF)`);
    this.cash -= cost;
    s.today.purchases += cost; this.today.purchases += cost;
    const o: Order = { id: this.nextId++, shopId, productId, qty: q, cost, deliverAt: this.nextDelivery() };
    this.orders.push(o);
    this.bump();
    return ok(o);
  }

  /**
   * Déchargement dans un commerce (le personnage doit y être) : marchandise portée et cargaison des véhicules garés
   * devant, dans la limite de la place en rayon. Rend le nombre d'unités rangées.
   */
  unload(shopId: number): Result<number> {
    const s = this.shop(shopId);
    if (!s) return fail('Commerce introuvable');
    if (!(this.player.place.kind === 'commerce' && this.player.place.shopId === shopId)) return fail('Entrez dans le commerce pour décharger.');
    const p = this.premise(s.premiseId)!;
    const loads = [this.player.carry, ...this.vehiclesNear(p.doorX, p.doorZ).map((v) => v.cargo)];
    let moved = 0, extra = 0;
    for (const load of loads) {
      for (const [pid, n] of Object.entries(load)) {
        if (!s.products[pid]) continue;
        let q = Math.min(n, this.room(s, pid));
        // Commerce premium : la marchandise emportée est standard, le grossiste facture le supplément premium au rangement.
        const sup = s.premium ? this.orderCost(pid, 1, s.id) - this.orderCost(pid, 1) : 0;
        if (sup > 0) q = Math.min(q, Math.floor(Math.max(0, this.cash) / sup));
        if (q <= 0) continue;
        if (sup > 0) { const c = r2(sup * q); this.cash -= c; s.today.purchases += c; this.today.purchases += c; extra += c; }
        s.products[pid]!.stock += q;
        load[pid] = n - q;
        if (load[pid] === 0) delete load[pid];
        moved += q;
      }
    }
    if (moved === 0) return fail('Rien à décharger ici (mauvais produits ou rayons pleins).');
    this.notify('ok', `${moved} unités rangées dans ${s.name}.${extra > 0 ? ` Supplément gamme premium : ${Math.round(extra)} CHF.` : ''}`);
    this.bump();
    return ok(moved);
  }

  /** Marchandise transportable vers ce commerce (portée + véhicules garés devant). */
  unloadable(shopId: number): number {
    const s = this.shop(shopId);
    if (!s) return 0;
    const p = this.premise(s.premiseId)!;
    let n = 0;
    for (const load of [this.player.carry, ...this.vehiclesNear(p.doorX, p.doorZ).map((v) => v.cargo)]) for (const [pid, q] of Object.entries(load)) if (s.products[pid]) n += q;
    return n;
  }

  /* ------------------------------ Employés ------------------------------ */

  /** Embauche un candidat (par défaut : caissier en journée complète, au salaire demandé). */
  hire(candidateId: number, shopId: number, opts: { role?: StaffRole; shift?: ShiftKind } = {}): Result<Employee> {
    const here = this.needService('emploi', "à l'agence pour l'emploi");
    if (!here.ok) return here;
    const c = this.candidates.find((x) => x.id === candidateId);
    if (!c) return fail('Candidat introuvable');
    if (!this.shop(shopId)) return fail('Commerce introuvable');
    const role = opts.role ?? 'caisse', shift = opts.shift ?? 'journee';
    if (!STAFF_ROLE_BY_ID.has(role)) return fail('Rôle inconnu');
    if (!SHIFT_BY_ID.has(shift)) return fail('Équipe inconnue');
    if (this.cash < c.wage * 8) return fail(`Trésorerie insuffisante : il faut au moins une journée de salaire (${c.wage * 8} CHF).`);
    const e: Employee = {
      id: c.id, name: c.name, skill: c.skill, wage: c.wage, shopId, hiredDay: this.day, look: c.look, mood: 0.75, unhappy: 0,
      role, shift, wantShift: c.wantShift ?? 'journee', minWage: c.minWage ?? c.wage,
    };
    this.employees.push(e);
    this.candidates = this.candidates.filter((x) => x !== c);
    this.notify('ok', `${e.name} rejoint ${this.shop(shopId)!.name} : ${STAFF_ROLE_BY_ID.get(role)!.nameFr.toLowerCase()}, ${SHIFT_BY_ID.get(shift)!.nameFr.toLowerCase()} (${e.wage} CHF / h).`);
    if (e.wantShift !== shift) this.notify('warn', `${e.name} préférait l’équipe « ${SHIFT_BY_ID.get(e.wantShift!)!.nameFr} » : sa satisfaction va baisser.`);
    this.warnGaps(e);
    this.refreshCapacities();
    this.bump();
    return ok(e);
  }

  /** Change le rôle d'un employé (caisse, rayon, entretien). */
  setRole(employeeId: number, role: StaffRole): Result {
    const e = this.employees.find((x) => x.id === employeeId);
    if (!e) return fail('Employé introuvable');
    if (!STAFF_ROLE_BY_ID.has(role)) return fail('Rôle inconnu');
    e.role = role;
    this.warnGaps(e);
    this.refreshCapacities();
    this.bump();
    return ok(undefined);
  }

  /** Change l'équipe d'un employé (matin, soir, journée complète). */
  setShift(employeeId: number, shift: ShiftKind): Result {
    const e = this.employees.find((x) => x.id === employeeId);
    if (!e) return fail('Employé introuvable');
    if (!SHIFT_BY_ID.has(shift)) return fail('Équipe inconnue');
    e.shift = shift;
    if (e.wantShift && e.wantShift !== shift) this.notify('warn', `${e.name} préfère l’équipe « ${SHIFT_BY_ID.get(e.wantShift)!.nameFr} » : sa satisfaction va baisser.`);
    this.warnGaps(e);
    this.refreshCapacities();
    this.bump();
    return ok(undefined);
  }

  /** Avertit si le commerce de l'employé a des heures d'ouverture sans caissier. */
  private warnGaps(e: Employee): void {
    if (e.shopId === null) return;
    const gaps = this.cashierGaps(e.shopId);
    if (gaps.length) this.notify('warn', `${this.shop(e.shopId)!.name} : aucun caissier ${gaps.map(([a, b]) => `de ${a} h à ${b} h`).join(', ')}.`);
  }

  roleOf(e: Employee): StaffRole { return e.role ?? 'caisse'; }
  shiftOf(e: Employee): ShiftKind { return e.shift ?? 'journee'; }

  /** L'employé est-il à son poste à l'heure h (commerce ouvert et dans son équipe) ? */
  worksAt(e: Employee, h: number): boolean {
    const s = e.shopId === null ? undefined : this.shop(e.shopId);
    if (!s || !(h >= s.open && h < s.close)) return false;
    const sh = SHIFT_BY_ID.get(this.shiftOf(e))!;
    return h >= sh.from && h < sh.to;
  }

  /** Employés présents dans un commerce à l'heure h (par défaut l'heure courante), éventuellement d'un rôle donné. */
  onDuty(shopId: number, role?: StaffRole, h = clockView(this.total).hour): Employee[] {
    return this.staffOf(shopId).filter((e) => this.worksAt(e, h) && (!role || this.roleOf(e) === role));
  }

  /** Heures travaillées (et payées) par jour selon l'équipe et les horaires du commerce. */
  hoursPerDay(e: Employee): number {
    let n = 0;
    for (let h = 0; h < 24; h++) if (this.worksAt(e, h)) n++;
    return n;
  }

  /** Plages d'ouverture sans aucun caissier présent, ex. [[14, 19]] = de 14 h à 19 h. */
  cashierGaps(shopId: number): [number, number][] {
    const s = this.shop(shopId);
    if (!s) return [];
    const out: [number, number][] = [];
    for (let h = s.open; h < s.close; h++) {
      if (this.onDuty(shopId, 'caisse', h).length) continue;
      const last = out.at(-1);
      if (last && last[1] === h) last[1] = h + 1; else out.push([h, h + 1]);
    }
    return out;
  }

  /** Souhaits non respectés d'un employé (texte court pour l'interface). */
  unmetWishes(e: Employee): string[] {
    const out: string[] = [];
    if (e.wantShift && e.wantShift !== this.shiftOf(e)) out.push(`préfère l’équipe « ${SHIFT_BY_ID.get(e.wantShift)!.nameFr} »`);
    if (e.minWage && e.wage < e.minWage) out.push(`veut au moins ${e.minWage} CHF / h`);
    return out;
  }

  /**
   * Puissance d'entretien d'un commerce à l'heure courante : somme des compétences des employés d'entretien
   * présents (1 ≈ un agent d'entretien pleinement compétent). 0 si fermé ou personne.
   */
  cleaningPower(s: Shop): number {
    return this.onDuty(s.id, 'entretien').reduce((a, e) => a + e.skill, 0);
  }

  /** Bonus de clients attirés par les employés de rayon présents (STAFF.shelfBonus × compétence chacun, plafonné). */
  shelfBonus(s: Shop): number {
    return Math.min(STAFF.shelfBonusMax, this.onDuty(s.id, 'rayon').reduce((a, e) => a + STAFF.shelfBonus * e.skill, 0));
  }

  assign(employeeId: number, shopId: number | null): Result {
    const e = this.employees.find((x) => x.id === employeeId);
    if (!e) return fail('Employé introuvable');
    if (shopId !== null && !this.shop(shopId)) return fail('Commerce introuvable');
    e.shopId = shopId;
    this.refreshCapacities();
    this.bump();
    return ok(undefined);
  }

  fire(employeeId: number): Result<number> {
    const e = this.employees.find((x) => x.id === employeeId);
    if (!e) return fail('Employé introuvable');
    const pay = Math.round(e.wage * 8 * ECONOMY.severanceDays);
    if (this.cash < pay) return fail(`Trésorerie insuffisante pour l’indemnité de licenciement (${pay} CHF).`);
    this.cash -= pay;
    this.today.wages += pay;
    this.employees = this.employees.filter((x) => x !== e);
    this.notify('info', `${e.name} quitte l'entreprise (indemnité ${pay} CHF).`);
    this.refreshCapacities();
    this.bump();
    return ok(pay);
  }

  /** Le personnage tient (ou lâche) la caisse d'un commerce où il se trouve. */
  tend(shopId: number | null): Result {
    if (shopId !== null) {
      const s = this.shop(shopId);
      if (!s) return fail('Commerce introuvable');
      if (!(this.player.place.kind === 'commerce' && this.player.place.shopId === shopId)) return fail('Vous devez être dans le commerce.');
      if (this.stats(s).registers === 0) return fail("Il n'y a pas de caisse.");
    }
    this.player.tending = shopId;
    this.refreshCapacities();
    this.bump();
    return ok(undefined);
  }

  /* ------------------------------ Véhicules ------------------------------ */

  buyVehicle(type: VehicleType): Result<Vehicle> {
    const here = this.needService('garage', 'au garage');
    if (!here.ok) return here;
    const def = VEHICLE_BY_ID.get(type);
    if (!def) return fail('Véhicule inconnu');
    if (this.cash < def.price) return fail(`Trésorerie insuffisante (${def.price} CHF)`);
    this.cash -= def.price;
    this.today.equipment += def.price;
    const b = here.data, n = FACE_N[b.face]!;
    // Garé sur la chaussée devant le garage, parallèle au trottoir.
    const off = SIDEWALK_W / 2 + 2.2 + this.vehicles.length * 0.01;
    const shift = (this.vehicles.length % 3) * 6 - 6;
    const v: Vehicle = {
      id: this.nextId++, type, x: b.doorX + n[0] * off + n[1] * shift, z: b.doorZ + n[1] * off - n[0] * shift,
      heading: Math.atan2(n[1], -n[0]), cargo: {},
    };
    this.vehicles.push(v);
    this.notify('ok', `${def.nameFr} achetée : elle vous attend devant le garage.`);
    this.bump();
    return ok(v);
  }

  sellVehicle(id: number): Result<number> {
    const here = this.needService('garage', 'au garage');
    if (!here.ok) return here;
    const v = this.vehicle(id);
    if (!v) return fail('Véhicule introuvable');
    if (sumValues(v.cargo) > 0) return fail('Videz la cargaison avant de vendre.');
    const def = VEHICLE_BY_ID.get(v.type)!;
    const price = Math.round(def.price * ECONOMY.vehicleResale);
    this.cash += price;
    this.vehicles = this.vehicles.filter((x) => x !== v);
    if (this.player.driving === id) this.player.driving = null;
    this.bump();
    return ok(price);
  }

  /* ------------------------------ Vie du personnage ------------------------------ */

  eat(foodId: string): Result<number> {
    const here = this.needService('snack', 'au snack');
    if (!here.ok) return here;
    const f = FOODS.find((x) => x.id === foodId);
    if (!f) return fail('Plat inconnu');
    if (this.cash < f.price) return fail('Pas assez d’argent');
    this.cash -= f.price;
    this.today.living += f.price;
    this.player.hunger = Math.min(100, this.player.hunger + f.hunger);
    this.player.energy = Math.min(100, this.player.energy + f.energy);
    this.bump();
    return ok(f.price);
  }

  rentHome(homeId: number): Result {
    const h = this.district.homes.find((x) => x.id === homeId);
    if (!h) return fail('Logement introuvable');
    if (this.player.home === homeId) return fail('Vous habitez déjà ici.');
    if (this.subletOf('logement', homeId)) return fail('Ce logement est sous-loué : résiliez d’abord le bail de sous-location.');
    const def = HOME_BY_ID.get(h.def)!;
    const first = def.rentDay * 7;
    if (this.cash < first) return fail(`Il faut ${first} CHF (une semaine d'avance).`);
    // Ancien logement : jours payés d'avance et non utilisés remboursés.
    const oldH = this.player.home === null ? undefined : this.district.homes.find((x) => x.id === this.player.home);
    const unused = oldH ? (this.player.homePrepaid ?? 0) * HOME_BY_ID.get(oldH.def)!.rentDay : 0;
    this.cash += unused - first;
    this.today.living += first - unused;
    this.player.home = homeId;
    this.player.homePrepaid = 7;
    this.notify('ok', `Nouveau logement : ${def.nameFr} (${def.rentDay} CHF / jour, première semaine payée).`);
    this.bump();
    return ok(undefined);
  }

  sleep(): Result {
    const pl = this.player.place;
    if (!(pl.kind === 'logement' && pl.homeId === this.player.home)) return fail('Rentrez chez vous pour dormir.');
    if (this.player.energy > 85) return fail('Vous n’êtes pas fatigué.');
    this.player.sleeping = true;
    this.player.tending = null;
    this.bump();
    return ok(undefined);
  }
  wake(): void { if (this.player.sleeping) { this.player.sleeping = false; this.bump(); } }

  /* ------------------------------ Banque et publicité ------------------------------ */

  takeLoan(offerIndex: number): Result<Loan> {
    const here = this.needService('banque', 'à la banque');
    if (!here.ok) return here;
    const o = LOAN_OFFERS[offerIndex];
    if (!o) return fail('Offre inconnue');
    const total = loanTotal(o);
    const cl = this.creditLimit();
    if (this.debt + total > cl.limit) return fail(`La banque refuse : plafond de crédit ${Math.round(cl.limit).toLocaleString('fr-CH')} CHF (déjà dû : ${Math.round(this.debt).toLocaleString('fr-CH')} CHF, ce prêt : ${total.toLocaleString('fr-CH')} CHF à rembourser). Le plafond monte avec vos ventes et votre valeur nette.`);
    const l: Loan = { id: this.nextId++, amount: o.amount, total, remaining: total, daily: r2(total / o.days), daysLeft: o.days };
    this.loans.push(l);
    this.cash += o.amount;
    this.notify('ok', `Prêt accordé : ${o.amount} CHF, ${l.daily} CHF par jour pendant ${o.days} jours.`);
    this.bump();
    return ok(l);
  }

  repayLoan(id: number): Result<number> {
    const here = this.needService('banque', 'à la banque');
    if (!here.ok) return here;
    const l = this.loans.find((x) => x.id === id);
    if (!l) return fail('Prêt introuvable');
    // Remboursement anticipé : capital restant seulement (intérêts restants remis à moitié).
    const due = this.repayAmount(l);
    if (this.cash < due) return fail(`Il faut ${Math.ceil(due)} CHF.`);
    this.cash -= due;
    this.today.finance += due;
    this.today.principal = r2((this.today.principal ?? 0) + Math.min(due, l.remaining * (l.amount / l.total)));
    this.loans = this.loans.filter((x) => x !== l);
    this.bump();
    return ok(due);
  }

  /** Remboursement anticipé : reste dû, moins la moitié des intérêts qui restaient à payer. */
  repayAmount(l: Loan): number { return r2(l.remaining - ((l.total - l.amount) * (l.remaining / l.total)) / 2); }

  startCampaign(kind: CampaignKind, shopId: number | null, days: number): Result<Campaign> {
    const here = this.needService('pub', "à l'agence de publicité");
    if (!here.ok) return here;
    const def = CAMPAIGN_BY_ID.get(kind);
    if (!def) return fail('Campagne inconnue');
    if (def.scope === 'shop' && (shopId === null || !this.shop(shopId))) return fail('Choisissez un commerce');
    if (!(Number.isInteger(days) && days >= 1 && days <= 30)) return fail('Durée : de 1 à 30 jours');
    const cost = def.perDay * days;
    if (this.cash < cost) return fail(`Trésorerie insuffisante (${cost} CHF)`);
    this.cash -= cost;
    this.today.marketing += cost;
    if (def.scope === 'shop') this.shop(shopId!)!.today.marketing += cost;
    const c: Campaign = { id: this.nextId++, kind, shopId: def.scope === 'all' ? null : shopId, daysLeft: days, perDay: def.perDay };
    this.campaigns.push(c);
    const key = String(c.shopId ?? 'all');
    this.awareness[key] = Math.min(FINANCE.awarenessMax, (this.awareness[key] ?? 0) + def.boost);
    this.notify('ok', `${def.nameFr} lancée pour ${days} jour(s).`);
    this.bump();
    return ok(c);
  }

  /* ------------------------------ Propreté et revêtements ------------------------------ */

  /** Propreté d'un commerce, 0..100 (sauvegardes antérieures : 100). */
  cleanliness(s: Shop): number { return s.clean ?? 100; }

  /** Bonus d'attrait des revêtements (part, sol + murs). */
  surfaceAppeal(s: Shop): number {
    return (FLOORING_BY_ID.get(s.floorId ?? 'origine')?.appeal ?? 0) + (WALLING_BY_ID.get(s.wallId ?? 'origine')?.appeal ?? 0);
  }

  /** Prix de pose d'un revêtement dans un commerce (selon la surface du local). */
  surfaceCost(shopId: number, part: 'sol' | 'murs', id: string): number {
    const s = this.shop(shopId), def = (part === 'sol' ? FLOORING_BY_ID : WALLING_BY_ID).get(id);
    if (!s || !def) return 0;
    const p = this.premise(s.premiseId)!;
    return Math.round(def.perM2 * surfaceArea(part, p.gridW, p.gridD));
  }

  /** Fait poser un revêtement de sol ou de murs (sur place, payé aussitôt ; l'ancien n'est pas remboursé). */
  setSurface(shopId: number, part: 'sol' | 'murs', id: string): Result<number> {
    const s = this.shop(shopId), def = (part === 'sol' ? FLOORING_BY_ID : WALLING_BY_ID).get(id);
    if (!s || !def) return fail('Revêtement inconnu');
    if (((part === 'sol' ? s.floorId : s.wallId) ?? 'origine') === id) return ok(0);
    if (!(this.player.place.kind === 'commerce' && this.player.place.shopId === shopId)) return fail('Rendez-vous dans le commerce pour changer les revêtements.');
    const cost = this.surfaceCost(shopId, part, id);
    if (this.cash < cost) return fail(`Trésorerie insuffisante (${cost} CHF)`);
    this.cash -= cost;
    s.today.equipment += cost; this.today.equipment += cost;
    if (part === 'sol') s.floorId = id; else s.wallId = id;
    this.notify('ok', `${s.name} : ${part === 'sol' ? 'nouveau sol' : 'nouveaux murs'} « ${def.nameFr} »${cost ? ` posé${part === 'sol' ? '' : 's'} pour ${cost} CHF` : ''}.${def.appeal ? ` Attrait +${Math.round(def.appeal * 1000) / 10} %.` : ''}`);
    this.bump();
    return ok(cost);
  }

  /**
   * Le personnage nettoie le commerce où il se trouve : CLEANING.playerMinutes minutes de jeu passent (le commerce
   * continue de tourner), la propreté remonte de CLEANING.playerGain points, un peu d'énergie dépensée.
   */
  cleanShop(shopId: number): Result<number> {
    const s = this.shop(shopId);
    if (!s) return fail('Commerce introuvable');
    if (!(this.player.place.kind === 'commerce' && this.player.place.shopId === shopId)) return fail('Entrez dans le commerce pour le nettoyer.');
    if (this.cleanliness(s) >= 98) return fail(`${s.name} est déjà impeccable.`);
    if (this.player.energy < CLEANING.playerEnergy + 2) return fail('Vous êtes trop fatigué pour nettoyer : allez dormir.');
    this.advance(CLEANING.playerMinutes);
    s.clean = Math.min(100, this.cleanliness(s) + CLEANING.playerGain);
    this.player.energy = Math.max(0, this.player.energy - CLEANING.playerEnergy);
    this.bump();
    return ok(Math.round(s.clean));
  }

  /** Forfait quotidien du service de nettoyage de nuit pour un commerce (selon la surface). */
  cleanServiceCost(shopId: number): number {
    const s = this.shop(shopId);
    if (!s) return 0;
    return Math.max(CLEANING.serviceMin, Math.round(this.premise(s.premiseId)!.area * CLEANING.servicePerM2));
  }

  /** Souscrit (ou résilie) le service de nettoyage de nuit : propreté remise à 100 % chaque nuit, forfait prélevé à minuit. */
  setCleanService(shopId: number, on: boolean): Result<number> {
    const s = this.shop(shopId);
    if (!s) return fail('Commerce introuvable');
    if (!!s.cleanService === on) return ok(0);
    s.cleanService = on;
    const cost = this.cleanServiceCost(shopId);
    this.notify(on ? 'ok' : 'info', on ? `${s.name} : service de nettoyage de nuit souscrit (${cost} CHF par jour). Le magasin sera impeccable chaque matin.` : `${s.name} : service de nettoyage résilié.`);
    this.bump();
    return ok(cost);
  }

  /** Salissure due à un client servi ; avis « c'est sale » de temps en temps sous le seuil d'alerte. */
  private soil(s: Shop): void {
    const c = this.cleanliness(s);
    s.clean = Math.max(0, c - CLEANING.perCustomer);
    if (c < CLEANING.warn && this.rng.next() < 0.3 * (CLEANING.warn - c) / CLEANING.warn) this.feel(s, 'sale');
  }

  /**
   * Nettoyage de base par les caissiers présents pendant les heures creuses (points pour cette heure) : proportionnel
   * à leur compétence et à la part de capacité de caisse restée inutilisée l'heure précédente.
   */
  cashierSweep(s: Shop): number {
    const h = clockView(this.total).hour;
    const served = s.hourServed?.[h - 1] ?? 0;
    const slack = s.capacity > 0 ? Math.max(0, 1 - served / s.capacity) : 1;
    return CLEANING.cashierPerHour * slack * this.onDuty(s.id, 'caisse', h).reduce((a, e) => a + e.skill, 0);
  }

  /** Heure d'ouverture : salissure, entretien par l'équipe, coup de balai des caissiers, alerte une fois par jour sous le seuil. */
  private cleanHour(s: Shop): void {
    const regain = CLEANING.perPower * this.cleaningPower(s);
    s.clean = Math.max(0, Math.min(100, this.cleanliness(s) - CLEANING.perOpenHour + regain));
    s.clean = Math.max(s.clean, Math.min(CLEANING.cashierCap, s.clean + this.cashierSweep(s)));
    if (s.clean < CLEANING.warn) this.warnOnce(s, '__sale', `${s.name} est sale (propreté ${Math.round(s.clean)} %) : moins de clients et réputation en baisse. Nettoyez (bouton « Nettoyer » sur place), embauchez un employé d’entretien ou souscrivez le service de nettoyage.`);
  }

  /* ------------------------------ Simulation ------------------------------ */

  /** Avance de `minutes` minutes de jeu (minute par minute). */
  advance(minutes: number): void {
    for (let k = 0; k < minutes; k++) this.minute();
  }

  private minute(): void {
    this.total++;
    const c = clockView(this.total);
    this.needs();
    if (c.minute === 0) this.hour(c.hour, c.weekday);
    if (c.minute === 0 && c.hour === 11) this.dayEvents();
    for (const s of this.shops) {
      if (s.rate <= 0) continue;
      const n = this.rng.poisson(s.rate / 60);
      for (let k = 0; k < n; k++) this.customer(s);
    }
    if (c.hour === 0 && c.minute === 0) this.newDay(c.weekday);
  }

  private needs(): void {
    const p = this.player;
    if (p.sleeping) {
      const comfort = p.home ? HOME_BY_ID.get(this.district.homes.find((h) => h.id === p.home)!.def)!.comfort : 0.7;
      p.energy = Math.min(100, p.energy + NEEDS.sleepPerMin * comfort);
      p.hunger = Math.max(0, p.hunger - NEEDS.hungerPerMin * 0.4);
      if (p.energy >= 100) { p.sleeping = false; this.notify('ok', 'Vous êtes reposé.'); this.bump(); }
      return;
    }
    p.hunger = Math.max(0, p.hunger - NEEDS.hungerPerMin);
    p.energy = Math.max(0, p.energy - NEEDS.energyPerMin * (p.hunger <= 0 ? 2 : 1));
    if (p.energy <= 0) {
      this.cash -= ECONOMY.faintCost;
      this.today.living += ECONOMY.faintCost;
      p.tending = null;
      p.driving = null;
      p.sleeping = true;
      if (p.home) { p.teleportHome = true; p.place = { kind: 'logement', homeId: p.home }; }
      this.notify('error', `Épuisé, vous vous effondrez : taxi jusqu'à chez vous (${ECONOMY.faintCost} CHF) et longue nuit de sommeil.`);
      this.refreshCapacities();
      this.bump();
    }
  }

  /** Vérifie les objectifs (appelée chaque heure de jeu et par l'interface). */
  checkObjectives(): void {
    for (const o of OBJECTIVES) {
      if (this.achieved.includes(o.id)) continue;
      if (o.progress(this).p >= 1) { this.achieved.push(o.id); this.notify('ok', `Objectif atteint : ${o.title} !`); this.bump(); }
    }
  }

  private hour(h: number, weekday: number): void {
    this.checkObjectives();
    const due = this.orders.filter((o) => o.deliverAt <= this.total);
    if (due.length) {
      this.orders = this.orders.filter((o) => o.deliverAt > this.total);
      for (const o of due) {
        const s = this.shop(o.shopId);
        if (!s) continue;
        // Plus de place en rayon (meubles retirés depuis la commande) : le surplus est repris et remboursé.
        const ps = s.products[o.productId]!, pr = PRODUCT_BY_ID.get(o.productId)!;
        const q = Math.max(0, Math.min(o.qty, this.storageFor(s, pr) - ps.stock));
        ps.stock += q;
        if (q < o.qty) {
          const back = r2(o.cost * (o.qty - q) / o.qty);
          this.cash += back; s.today.purchases -= back; this.today.purchases -= back;
          this.notify('warn', `${s.name} : ${o.qty - q} ${pr.nameFr.toLowerCase()} repris par le livreur faute de place en rayon (${Math.round(back)} CHF remboursés).`);
        }
      }
      this.notify('info', `Livraison reçue : ${due.length} commande(s).`);
    }
    logisticsHour(this, h);
    if (h === 21 || h === 11) this.autoReorder();
    if (this.player.hunger < NEEDS.low && !this.player.sleeping) this.notify('warn', 'Vous avez faim : allez manger au snack.');
    else if (this.player.energy < NEEDS.low && !this.player.sleeping) this.notify('warn', 'Vous êtes épuisé : rentrez dormir.');
    for (const s of this.shops) {
      this.updateReputation(s);
      s.servedThisHour = 0;
      const open = h >= s.open && h < s.close;
      if (!open) { s.rate = 0; s.capacity = 0; continue; }
      this.cleanHour(s);
      // Salaires : seuls les employés dont l'équipe couvre cette heure travaillent (et sont payés).
      for (const e of this.onDuty(s.id, undefined, h)) {
        s.today.wages += e.wage; this.today.wages += e.wage; this.cash -= e.wage;
        // Expérience : la compétence progresse avec les heures travaillées (jusqu'à 100 %).
        const before = Math.floor(e.skill * 10);
        e.skill = Math.min(1, Math.round((e.skill + 0.0025) * 10000) / 10000);
        if (Math.floor(e.skill * 10) > before) this.notify('ok', `${e.name} progresse : compétence ${Math.round(e.skill * 100)} % (${s.name}).`);
      }
      const st = this.stats(s);
      const t = SHOP_TYPE_BY_ID.get(s.type)!;
      const p = this.premise(s.premiseId)!;
      const weekend = weekday >= 5 ? t.weekend : 1;
      s.rate = p.footfall * t.hourly[h]! * weekend * this.weatherFactor(s.type) * (this.marketDay ? 1.25 : 1) * t.capture * this.attractiveness(s, st) * (1 + this.marketingBoost(s.id));
      s.rate *= 1 + this.shelfBonus(s);
      s.capacity = this.capacityNow(s);
      if (s.capacity <= 0 && s.rate > 0) {
        if (st.registers === 0) this.warnOnce(s, '__caisse', `${s.name} n'a pas de caisse : aucun client ne peut payer (Aménager).`);
        else if (this.staffOf(s.id).length) this.warnOnce(s, '__shift', `${s.name} : aucun caissier présent à ${h} h. Vérifiez les rôles et les équipes (onglet Employés), ou tenez la caisse vous-même.`);
        else this.warnOnce(s, '__staff', `${s.name} est ouvert mais personne ne tient la caisse : embauchez à l'agence pour l'emploi, ou tenez-la vous-même.`);
      }
    }
    this.bump();
  }

  /** Clients servis par heure : caisses tenues (employés par compétence, le personnage compte pour 1). */
  capacityNow(s: Shop): number {
    const c = clockView(this.total);
    if (!(c.hour >= s.open && c.hour < s.close)) return 0;
    const st = this.stats(s);
    const staff = this.onDuty(s.id, 'caisse', c.hour).map((e) => this.serviceSkill(e)).sort((a, b) => b - a);
    const tended = Math.min(st.registers, staff.length);
    let skill = staff.slice(0, tended).reduce((a, b) => a + b, 0);
    if (this.player.tending === s.id && st.registers > tended) skill += 1;
    return ECONOMY.servePerRegister * skill;
  }
  /** Efficacité en caisse d'un employé : compétence × formation × satisfaction (1 ≈ 28 clients / h). */
  serviceSkill(e: Employee): number { return e.skill * (1 + TRAINING.capacity * (e.training ?? 0)) * (0.8 + 0.3 * (e.mood ?? 0.75)); }
  private refreshCapacities(): void {
    // Tous les commerces ouverts (y compris ceux encore sans clients ni capacité : premier caissier embauché).
    const h = clockView(this.total).hour;
    for (const s of this.shops) if (s.rate > 0 || s.capacity > 0 || (h >= s.open && h < s.close)) s.capacity = this.capacityNow(s);
  }

  /** Attrait du commerce (1 ≈ commerce moyen du quartier). */
  attractiveness(s: Shop, st = this.stats(s)): number {
    let shareAvail = 0, priceAcc = 0;
    for (const pr of productsOf(s.type)) {
      if (!this.sellable(s, pr, st)) continue;
      const ps = s.products[pr.id]!;
      shareAvail += pr.share;
      priceAcc += pr.share * Math.min(1.8, Math.max(0.05, Math.exp(-2.2 * (ps.price / this.refPrice(pr, s) - 1))));
    }
    if (shareAvail <= 0) return 0;
    const price = priceAcc / shareAvail;
    const variety = 0.3 + 0.7 * shareAvail;
    const decor = 0.85 + 0.25 * Math.min(1, st.decor) + (s.type === 'cafe' ? 0.3 * Math.min(1, st.seats / 16) - 0.1 : 0);
    const rep = 0.5 + s.reputation;
    const comp = 1 / (1 + 0.6 * this.competition(this.premise(s.premiseId)!, s.type));
    // Gamme premium : la clientèle suit la réputation (peu de clients tant que le commerce n'est pas reconnu).
    const range = s.premium ? premiumDemand(s.reputation) : 1;
    // Revêtements (sol et murs) : bonus d'attrait ; saleté : moins de clients sous CLEANING.fine.
    const surfaces = (1 + this.surfaceAppeal(s)) * cleanAppeal(this.cleanliness(s));
    // Promotions des rivaux voisins du même type : jusqu'à RIVALS.promoMax de clients en moins.
    return price * variety * decor * rep * comp * range * surfaces * this.rivalry.promoFactor(s);
  }

  private sellable(s: Shop, pr: ProductDef, st: LayoutStats): boolean {
    return s.products[pr.id]!.stock > 0 && st.capacity[pr.store] > 0 && (!pr.needsMachine || st.machines > 0);
  }

  private customer(s: Shop): void {
    const st = this.stats(s);
    const t = SHOP_TYPE_BY_ID.get(s.type)!;
    if (s.capacity <= 0) { s.today.lostStaff++; this.today.lostStaff++; this.feel(s, 'caisse'); return; }
    if (s.servedThisHour >= s.capacity) { s.today.lostCapacity++; this.today.lostCapacity++; this.feel(s, 'attente'); return; }
    const avail = productsOf(s.type).filter((pr) => this.sellable(s, pr, st));
    if (!avail.length) { s.today.lostStock++; this.today.lostStock++; this.feel(s, 'rupture'); return; }
    let refused = 0, missing = 0;
    const items = Math.max(1, this.rng.poisson(t.basket - 1) + 1);
    const bought: string[] = [];
    for (let k = 0; k < items; k++) {
      let r = this.rng.next(), want = productsOf(s.type)[0]!;
      for (const pr of productsOf(s.type)) { r -= pr.share; if (r <= 0) { want = pr; break; } }
      const ps = s.products[want.id]!;
      if (!this.sellable(s, want, st)) {
        if (st.capacity[want.store] > 0 && ps.stock <= 0) this.warnOnce(s, want.id, `${s.name} : rupture de ${want.nameFr.toLowerCase()}.`);
        missing++;
        continue;
      }
      if (this.rng.next() > Math.min(1, Math.exp(-2.2 * (ps.price / this.refPrice(want, s) - 1)))) { refused++; s.today.refusedPrice++; this.today.refusedPrice++; continue; }
      ps.stock--;
      // Alerte une fois par jour quand le stock passe sous 20 % de la place en rayon (sauf réassort automatique).
      if (!ps.auto && ps.stock === Math.floor(this.storageFor(s, want) * 0.2) && this.pendingQty(s.id, want.id) === 0) this.warnOnce(s, `bas-${want.id}`, `${s.name} : stock bas de ${want.nameFr.toLowerCase()} (${ps.stock} restants, moins de 20 %).`);
      bought.push(want.id);
      s.today.revenue += ps.price; this.today.revenue += ps.price; this.cash += ps.price;
      const uc = this.unitCost(want, s);
      s.today.costOfSales += uc; this.today.costOfSales += uc;
    }
    if (bought.length === 0) { s.today.lostStock++; this.today.lostStock++; this.feel(s, refused >= missing ? 'prix' : 'rupture'); return; }
    if (refused > 0 && this.rng.next() < 0.5) this.feel(s, 'prix');
    else if (missing === 0 && refused === 0 && this.cleanliness(s) >= CLEANING.warn && this.rng.next() < 0.12) this.feel(s, 'content');
    this.soil(s);
    s.servedThisHour++;
    (s.hourServed ??= new Array(24).fill(0))[clockView(this.total).hour]++;
    s.today.customers++; this.today.customers++;
    if (this.events.length < 300) this.events.push({ shopId: s.id, premiseId: s.premiseId, products: bought });
  }

  private feel(s: Shop, kind: FeedbackKind): void {
    if (kind !== 'content' && kind !== 'sale') { const h = clockView(this.total).hour; (s.hourLost ??= new Array(24).fill(0))[h]++; }
    if (this.feedback.length < 100) this.feedback.push({ shopId: s.id, kind });
  }

  private updateReputation(s: Shop): void {
    const d = s.today;
    const served = d.customers, lost = d.lostStock + d.lostCapacity + d.lostStaff;
    if (served + lost < 3) return;
    // Magasin sale : la réputation visée baisse (jusqu'à −CLEANING.repPenalty à 0 % de propreté).
    const dirt = CLEANING.repPenalty * (1 - Math.min(1, this.cleanliness(s) / CLEANING.fine));
    const target = Math.min(1, Math.max(0, (served / (served + lost)) * 1.05 - 0.05 - dirt));
    s.reputation += (target - s.reputation) * 0.04;
  }

  private autoReorder(): void {
    for (const s of this.shops) {
      for (const pr of productsOf(s.type)) {
        const ps = s.products[pr.id]!;
        if (!ps.auto) continue;
        const cap = this.storageFor(s, pr);
        if (cap <= 0 || ps.stock + this.pendingQty(s.id, pr.id) > cap * 0.75) continue;
        const q = this.room(s, pr.id);
        if (q > 0) { const r = this.order(s.id, pr.id, q); if (!r.ok) this.warnOnce(s, `__auto${pr.id}`, `${s.name} : réassort automatique de ${pr.nameFr.toLowerCase()} impossible (${r.message}).`); }
      }
    }
  }

  private newDay(weekday: number): void {
    for (const s of this.shops) {
      const p = this.premise(s.premiseId)!;
      // Loyer : provision du jour dans les comptes (bénéfice lisible), prélevé une fois par mois.
      const rent = r2(p.rent / 30);
      s.today.rent += rent; this.today.rent += rent;
      s.rentDue = r2((s.rentDue ?? 0) + rent);
      if (this.day > (s.leaseDay ?? 0) && (this.day - (s.leaseDay ?? 0)) % 30 === 0) {
        this.cash -= s.rentDue;
        this.notify('info', `${s.name} : loyer du mois prélevé (${Math.round(s.rentDue)} CHF).`);
        s.rentDue = 0;
      }
      // Service de nettoyage de nuit : forfait du jour (compté avec le personnel), magasin impeccable au matin.
      if (s.cleanService) {
        const fee = this.cleanServiceCost(s.id);
        this.cash -= fee; s.today.wages += fee; this.today.wages += fee;
        s.clean = 100;
      }
      s.history.push(s.today);
      if (s.history.length > 60) s.history.shift();
      s.today = emptyDay(this.day);
      s.warned = [];
      s.hourServed = new Array(24).fill(0);
      s.hourLost = new Array(24).fill(0);
    }
    // Logement, assurance des véhicules, prêts, campagnes.
    if (this.player.home) {
      const def = HOME_BY_ID.get(this.district.homes.find((h) => h.id === this.player.home)!.def)!;
      // Jours payés d'avance (première semaine) consommés avant tout nouveau débit.
      if ((this.player.homePrepaid ?? 0) > 0) this.player.homePrepaid! -= 1;
      else { this.cash -= def.rentDay; this.today.living += def.rentDay; }
    }
    logisticsNight(this);
    for (const v of this.vehicles) { const ins = VEHICLE_BY_ID.get(v.type)!.insurance; this.cash -= ins; this.today.living += ins; }
    // Employés : satisfaction selon le salaire comparé au marché ; demande d'augmentation ; démission.
    for (const e of [...this.employees]) {
      const ratio = e.wage / this.marketWage(e.skill, e.training ?? 0);
      // Souhaits de l'embauche non respectés (équipe préférée, salaire minimum) : satisfaction visée plus basse.
      const badShift = !!e.wantShift && e.wantShift !== this.shiftOf(e), lowWage = !!e.minWage && e.wage < e.minWage;
      const target = Math.max(0, Math.min(1, 0.7 + (ratio - 1) * 2.2 - (badShift ? STAFF.shiftMood : 0) - (lowWage ? STAFF.minWageMood : 0)));
      e.mood = r2((e.mood ?? 0.75) + (target - (e.mood ?? 0.75)) * 0.35);
      if (ratio < 0.94 && !e.askedRaise) { e.askedRaise = true; this.notify('warn', `${e.name} demande une augmentation : le marché paie ${this.marketWage(e.skill, e.training ?? 0)} CHF / h pour sa compétence (actuellement ${e.wage}).`); }
      e.unhappy = e.mood < 0.3 ? (e.unhappy ?? 0) + 1 : 0;
      if (e.unhappy >= 3) {
        this.employees = this.employees.filter((x) => x !== e);
        this.notify('error', `${e.name} a démissionné (${badShift && ratio >= 0.94 && !lowWage ? 'équipe imposée qui ne lui convenait pas' : 'salaire trop bas'}).`);
      }
    }
    // Sous-locations : loyer payé, loyer encaissé, arrivées et départs de locataires.
    for (const sl of this.sublets) {
      if ((sl.prepaid ?? 0) > 0) sl.prepaid! -= 1;
      else { this.cash -= sl.cost; this.today.rent += sl.cost; }
      if (sl.tenant) {
        this.cash += sl.ask; this.today.rentalIncome += sl.ask;
        sl.since++;
        const ratio = sl.ask / Math.max(1, this.marketRent(sl.kind, sl.ref));
        if (this.rng.next() < 0.02 + Math.max(0, ratio - 1.3) * 0.15) { this.notify('info', `Votre locataire ${sl.tenant} est parti (${sl.kind === 'logement' ? 'appartement' : 'local'} à relouer).`); sl.tenant = null; sl.since = 0; }
      } else if (this.rng.next() < this.tenantChance(sl)) {
        sl.tenant = sl.kind === 'logement' ? randomName(this.rng) : this.rng.pick(['Agence Horizon', 'Cabinet Benjelloun', 'Atelier Couture Nadia', 'Studio Photo Lumière', 'Pharmacie du Parc', 'Coiffure Élégance', 'Opticien Vision', 'Librairie Al Kitab']);
        sl.since = 0;
        this.notify('ok', `Nouveau locataire : ${sl.tenant} (${Math.round(sl.ask)} CHF / jour).`);
      }
    }
    // Contrat fournisseur : forfait quotidien (compté dans les achats).
    const ct = this.contractDef();
    if (ct) { this.cash -= ct.perDay; this.today.purchases += ct.perDay; }
    this.rivalry.night();
    this.updateMarket();
    // Météo du lendemain : pluie un jour sur cinq environ, nuages un sur trois.
    const w = this.rng.next();
    this.weather = w < 0.2 ? 'pluie' : w < 0.52 ? 'nuages' : 'soleil';
    if (this.weather === 'pluie') this.notify('info', 'Pluie annoncée aujourd’hui : moins de passants, mais cafés et fast-foods attirent les gens à l’abri.');
    this.marketDay = this.weather !== 'pluie' && this.rng.next() < 0.12;
    if (this.marketDay) this.notify('ok', 'Jour de marché dans le quartier : +25 % de passants aujourd’hui. Pensez au stock !');
    for (const l of this.loans) {
      // Dernière échéance : le solde exact (pas de reliquat d'arrondi).
      const pay = l.daysLeft <= 1 ? l.remaining : Math.min(l.daily, l.remaining);
      this.cash -= pay; this.today.finance += pay;
      this.today.principal = r2((this.today.principal ?? 0) + pay * (l.amount / l.total));
      l.remaining = r2(l.remaining - pay);
      l.daysLeft--;
    }
    const done = this.loans.filter((l) => l.remaining <= 0.01 || l.daysLeft <= 0);
    if (done.length) { this.loans = this.loans.filter((l) => !done.includes(l)); this.notify('ok', `Prêt remboursé (${done.length}).`); }
    this.financeNight();
    for (const c of this.campaigns) c.daysLeft--;
    const ended = this.campaigns.filter((c) => c.daysLeft <= 0);
    if (ended.length) { this.campaigns = this.campaigns.filter((c) => c.daysLeft > 0); this.notify('info', `Campagne de publicité terminée (${ended.length}).`); }
    const y = this.today;
    this.ledger.push(y);
    if (this.ledger.length > 120) this.ledger.shift();
    this.today = emptyDay(this.day);
    if (this.shops.length) {
      const profit = dayProfit(y);
      this.notify(profit >= 0 ? 'ok' : 'info', `Bilan du jour ${y.day + 1} : ${Math.round(y.revenue)} CHF de ventes, ${y.customers} clients, solde ${profit >= 0 ? '+' : ''}${Math.round(profit)} CHF.`);
    }
    if (this.cash < 0) this.notify('error', `Trésorerie négative (${Math.round(this.cash)} CHF) : réduisez les dépenses, empruntez ou résiliez un bail.`);
    const tx = this.taxEstimate();
    if (tx.daysLeft === 0 && !tx.exempt && this.shops.length) this.notify('info', `Impôt sur le bénéfice prélevé ce soir à minuit : environ ${Math.round(Math.max(0, tx.base) * FINANCE.taxRate)} CHF (${Math.round(FINANCE.taxRate * 100)} % du bénéfice de la semaine, selon la journée).`);
    if (weekday === 0) this.refreshCandidates();
  }

  /**
   * Nuit, côté finances (avant la fin des campagnes) : la notoriété s'estompe et les campagnes en cours la font
   * remonter ; intérêts du compte épargne et variation du fonds (tirage déterministe propre au jour, sans toucher au
   * générateur principal) ; en fin de semaine, impôt sur le bénéfice inscrit au bilan du jour qui s'achève.
   */
  private financeNight(): void {
    const keys = new Set([...Object.keys(this.awareness), ...this.campaigns.map((c) => String(c.shopId ?? 'all'))]);
    const next: Record<string, number> = {};
    for (const k of keys) {
      if (k !== 'all' && !this.shop(Number(k))) continue;
      const v = this.awarenessNext(k);
      if (v >= 0.005) next[k] = Math.round(v * 10000) / 10000;
    }
    this.awareness = next;
    const y = this.today;
    for (const def of INVESTMENTS) {
      let r = def.dailyMean;
      if (def.dailyVol > 0) {
        r = Math.max(-0.08, Math.min(0.08, def.dailyMean + def.dailyVol * new Rng(((this.seed ^ 0x6a09e667) + y.day * 0x9e3779b1) >>> 0).normal()));
        this.fundReturns.push(Math.round(r * 100000) / 100000);
        if (this.fundReturns.length > 14) this.fundReturns.shift();
      }
      const bal = this.invest[def.id] ?? 0;
      if (bal > 0) {
        this.invest[def.id] = r2(bal * (1 + r));
        y.investGain = r2((y.investGain ?? 0) + this.invest[def.id] - bal);
      }
    }
    const P = FINANCE.taxPeriod;
    if (y.day % P === P - 1) {
      const t = this.taxEstimate();
      if (!t.exempt) {
        const rec: TaxRecord = { week: t.week, base: t.base, amount: t.due };
        this.taxes.push(rec);
        if (this.taxes.length > 12) this.taxes.shift();
        if (t.due > 0) {
          this.cash -= t.due; y.tax = r2((y.tax ?? 0) + t.due);
          this.notify('info', `Impôt sur le bénéfice de la semaine ${t.week + 1} prélevé : ${Math.round(t.due)} CHF (${Math.round(FINANCE.taxRate * 100)} % de ${Math.round(t.base)} CHF de bénéfice).`);
        } else if (this.shops.length) this.notify('ok', `Semaine ${t.week + 1} sans bénéfice (${Math.round(t.base)} CHF) : aucun impôt à payer.`);
      } else if (this.shops.length && t.week === FINANCE.taxGraceWeeks - 1) {
        this.notify('info', `Fin de la période d’exonération : dès maintenant, ${Math.round(FINANCE.taxRate * 100)} % du bénéfice de chaque semaine est prélevé en impôt (provision visible dans l’appli Finances).`);
      }
    }
  }

  /**
   * Marché du jour : chaque prix du grossiste suit une marche aléatoire (entre −15 % et +20 %) ; les concurrents
   * baissent leurs prix quand vous avez plusieurs commerces du même type (jusqu'à −15 %) et les remontent sinon.
   */
  private updateMarket(): void {
    for (const pr of PRODUCTS) {
      const m = this.market[pr.id] ?? 1;
      this.market[pr.id] = r2(Math.min(1.2, Math.max(0.85, m + (this.rng.next() - 0.5) * 0.08 + (1 - m) * 0.15)));
    }
    for (const t of SHOP_TYPES) {
      // Appelée à minuit : la journée écoulée est déjà dans l'historique (today vient d'être remis à zéro).
      const mine = this.shops.filter((x) => x.type === t.id && (x.history.at(-1)?.customers ?? 0) > 0).length;
      const target = Math.max(0.85, 1 - 0.05 * mine);
      const cur = this.rivals[t.id] ?? 1;
      const next = r2(cur + (target - cur) * 0.3);
      if (next < cur - 0.015 && next <= 0.97) this.notify('warn', `Les concurrents (${t.nameFr.toLowerCase()}) baissent leurs prix : ${Math.round((1 - next) * 100)} % sous le prix habituel.`);
      this.rivals[t.id] = next;
    }
  }

  private refreshCandidates(): void {
    this.candidates = [];
    for (let k = 0; k < 6; k++) {
      const skill = r2(0.55 + this.rng.next() * 0.45);
      const c: Candidate = { id: this.nextId++, name: randomName(this.rng), skill, wage: Math.round(20 + skill * 14 + this.rng.next() * 3), look: this.rng.int(0, 999) };
      // Souhaits tirés de l'allure (aucun tirage aléatoire de plus) : une moitié veut la journée complète, un quart le
      // matin, un quart le soir ; salaire minimum accepté de 0 à 3 CHF / h sous le salaire demandé.
      c.wantShift = (['journee', 'journee', 'matin', 'soir'] as const)[c.look % 4]!;
      c.minWage = c.wage - (Math.floor(c.look / 4) % 4);
      this.candidates.push(c);
    }
  }

  /** Moment d'une livraison en clair : « aujourd’hui à 14 h », « demain à 7 h » (par défaut : la prochaine livraison). */
  deliveryLabel(at = this.nextDelivery()): string {
    const d = Math.floor(at / MINUTES_PER_DAY) - this.day, h = Math.floor((at % MINUTES_PER_DAY) / 60);
    return `${d <= 0 ? 'aujourd’hui' : d === 1 ? 'demain' : `dans ${d} jours`} à ${h} h`;
  }

  /** Prochaine livraison du grossiste : 7 h ou 14 h (commande au moins 2 h avant), sinon le lendemain à 7 h. */
  private nextDelivery(): number {
    const c = clockView(this.total);
    const base = c.day * MINUTES_PER_DAY;
    for (const h of [ECONOMY.deliveryHour, 14]) if (c.hour < h - 2 || (c.hour === h - 2 && c.minute === 0)) return base + h * 60;
    return base + MINUTES_PER_DAY + ECONOMY.deliveryHour * 60;
  }

  private warnOnce(s: Shop, key: string, text: string): void {
    if (s.warned.includes(key)) return;
    s.warned.push(key);
    this.notify('warn', text);
  }

  notify(level: Notice['level'], text: string): void {
    this.notices.push({ at: this.total, level, text });
    if (this.notices.length > 100) this.notices.shift();
  }

  private bump(): void { this.version++; }

  /* ------------------------------ Sauvegarde ------------------------------ */

  save(): GameSave {
    return {
      v: SAVE_VERSION, seed: this.seed, companyName: this.companyName, total: this.total, cash: this.cash,
      player: structuredClone(this.player), shops: structuredClone(this.shops), employees: structuredClone(this.employees),
      candidates: structuredClone(this.candidates), orders: structuredClone(this.orders), vehicles: structuredClone(this.vehicles),
      loans: structuredClone(this.loans), campaigns: structuredClone(this.campaigns), ledger: structuredClone([...this.ledger, this.today]), achieved: [...this.achieved], sublets: structuredClone(this.sublets), market: { ...this.market }, rivals: { ...this.rivals }, rivalry: this.rivalry.save(), weather: this.weather, marketDay: this.marketDay, contract: this.contract,
      finance: { invest: { ...this.invest }, principal: { ...this.investPrincipal }, fundReturns: [...this.fundReturns], awareness: { ...this.awareness }, taxes: structuredClone(this.taxes) },
      logi: saveLogi(this.logi),
      nextId: this.nextId, rng: this.rng.state(),
    };
  }

  private restore(s: GameSave): void {
    if (s.v !== SAVE_VERSION) throw new Error(`Sauvegarde de version ${s.v} non prise en charge`);
    this.companyName = s.companyName; this.total = s.total; this.cash = s.cash;
    this.player = structuredClone(s.player);
    this.shops = structuredClone(s.shops); this.employees = structuredClone(s.employees); this.candidates = structuredClone(s.candidates);
    this.orders = structuredClone(s.orders); this.vehicles = structuredClone(s.vehicles);
    this.loans = structuredClone(s.loans); this.campaigns = structuredClone(s.campaigns);
    const led = structuredClone(s.ledger);
    this.today = led.pop() ?? emptyDay(this.day);
    this.ledger = led;
    this.nextId = s.nextId;
    this.rng = new Rng(s.rng);
    // Objectifs : on ne garde que ceux qui existent encore (la liste a pu changer entre deux versions).
    this.achieved = (s.achieved ?? []).filter((id) => OBJECTIVES.some((o) => o.id === id));
    this.sublets = structuredClone(s.sublets ?? []);
    this.market = { ...(s.market ?? {}) };
    this.rivals = { ...(s.rivals ?? {}) };
    this.weather = s.weather ?? 'soleil';
    this.marketDay = s.marketDay ?? false;
    this.contract = s.contract && CONTRACT_BY_ID.has(s.contract) ? s.contract : null;
    const f = s.finance;
    this.invest = { epargne: f?.invest?.epargne ?? 0, fonds: f?.invest?.fonds ?? 0 };
    this.investPrincipal = { epargne: f?.principal?.epargne ?? 0, fonds: f?.principal?.fonds ?? 0 };
    this.fundReturns = [...(f?.fundReturns ?? [])];
    this.awareness = { ...(f?.awareness ?? {}) };
    // Anciennes sauvegardes : les campagnes en cours gardent leur effet (notoriété de départ).
    if (!f) for (const c of this.campaigns) { const k = String(c.shopId ?? 'all'); this.awareness[k] = Math.min(FINANCE.awarenessMax, (this.awareness[k] ?? 0) + (CAMPAIGN_BY_ID.get(c.kind)?.boost ?? 0)); }
    this.taxes = structuredClone(f?.taxes ?? []);
    this.logi = restoreLogi(s.logi);
    // Sauvegardes antérieures : employés sans rôle ni équipe → caisse, journée complète ; candidats sans souhait.
    for (const e of this.employees) { e.role ??= 'caisse'; e.shift ??= 'journee'; }
    for (const c of this.candidates) { c.wantShift ??= 'journee'; c.minWage ??= c.wage; }
    // Sauvegardes antérieures : champs ajoutés depuis.
    for (const d of [...this.ledger, this.today, ...this.shops.flatMap((x) => [x.today, ...x.history])]) { d.refusedPrice ??= 0; d.rentalIncome ??= 0; d.tax ??= 0; }
  }
}
