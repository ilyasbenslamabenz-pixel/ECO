/**
 * Démographie : citoyens individuels (nom, âge, éducation, ménage, logement, emploi, revenus,
 * bonheur), naissances, vieillissement, décès, emménagements selon l'attractivité,
 * décohabitation, recherche d'emploi selon la distance, scolarisation, emploi du temps
 * (réveil, trajet, travail, pause, retour, loisirs, sommeil) générant des demandes de trajet,
 * et LOD de simulation selon la distance à la caméra :
 *  - DÉTAILLÉ (< LOD_DETAILED_M) : activité évaluée à chaque tick, trajets individuels émis ;
 *  - SIMPLIFIÉ (< LOD_SIMPLIFIED_M) : activité évaluée toutes les 30 min de jeu, pas de trajet individuel ;
 *  - STATISTIQUE (au-delà) : activité non suivie, estimée par échantillonnage pour les statistiques.
 * Le cycle de vie (âge, emploi, naissances, décès, migrations) est simulé pour TOUS les citoyens
 * quel que soit leur LOD : seul le grain de l'emploi du temps change.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { isBuildingCategory, type AssetCatalog } from '../shared/catalog';
import { TILE_SIZE } from '../shared/constants';
import { MINUTES_PER_DAY, MINUTES_PER_YEAR, DAYS_PER_YEAR, isWeekend } from './clock';
import type { BuildingStore, ChunkIndex } from './ecs';
import type { TaxSector } from './economy';
import { fullName, randomFirstName, randomSurname } from './names';
import {
  Activity, ACTIVITY_NAMES_FR, EDUCATION_NAMES_FR, Education, Role, SimLod,
  createCitizenTable, createCompanyTable, createHouseholdTable,
  type CitizenTable, type ColumnsJSON, type CompanyTable, type HouseholdTable,
} from './population';
import type { Rng } from './rng';
import { LivingEconomy, type LivingMeta, type LivingReport } from './economie/living';
import { buildingLevel, CompanyStatus, CLOSURE_REASONS, eduTier, rentSatisfaction, SECTOR_FR } from './economie/tuning';
import { CityServices, type BuildingSafety, type ServiceStation, type ServicesReport } from './services/city-services';

/* ------------------------------------------------------------------ */
/* Paramètres                                                           */
/* ------------------------------------------------------------------ */

export const LOD_DETAILED_M = 600;
export const LOD_SIMPLIFIED_M = 1500;
export const SIMPLIFIED_EVERY_TICKS = 15;
export const STATISTICAL_SAMPLE = 8;
export const WORKING_AGE_MIN = 18;
export const RETIREMENT_AGE = 64;
export const SCHOOL_AGE_MIN = 6;
export const SCHOOL_AGE_MAX = 17;
export const MAX_COMMUTE_M = 4000;
/** Recherches d'emploi traitées par jour de jeu (borne le coût CPU). */
export const JOB_SEARCHES_PER_DAY = 4000;
/** Ménages arrivant au plus par vague de migration (toutes les 6 h de jeu). */
export const MAX_ARRIVALS_PER_WAVE = 60;
/** Distance façade-route maximale pour être desservi (m), en plus de la demi-largeur de la route. */
export const ROAD_ACCESS_MARGIN_M = TILE_SIZE;
export const TRIP_QUEUE_CAPACITY = 4096;
/**
 * Simulation agrégée (docs/SIMULATION.md, « Grandes villes ») : au-delà de AGGREGATE_THRESHOLD habitants, les NOUVEAUX
 * ménages (immigration) sont des ménages agrégés : une ligne représente `poids` ménages identiques logés dans le même
 * bâtiment, avec un poids qui croît avec la population (≈ AGGREGATE_ROWS_TARGET lignes) jusqu'à AGGREGATE_MAX_WEIGHT.
 * Naissances et décohabitations héritent du poids du ménage. Toutes les sommes (habitants, emplois, revenus, impôts,
 * demande, statistiques) sont pondérées : les grandeurs observables ne changent qu'au bruit d'échantillonnage près
 * (tests/sim/scale.test.ts). Les citoyens agrégés ne sont jamais en LOD détaillé (pas de trajet individuel : la demande
 * statistique du trafic les couvre).
 */
export const AGGREGATE_THRESHOLD = 100_000;
export const AGGREGATE_ROWS_TARGET = 100_000;
export const AGGREGATE_MAX_WEIGHT = 16;

/** Salaires mensuels de base par secteur (crédits), modulés par l'éducation. */
export const BASE_WAGE: Record<number, number> = { 1: 2000, 2: 2300, 3: 3200, 4: 2300 };
/** Chiffre d'affaires mensuel par employé et par secteur (crédits). */
export const REVENUE_PER_WORKER: Record<number, number> = { 1: 5200, 2: 6000, 3: 8000, 4: 0 };
export const PENSION = 1100;
/** Part imposable par la commune des revenus des ménages et des bénéfices des entreprises. */
export const RES_TAXABLE_SHARE = 0.25;
export const COMPANY_TAXABLE_SHARE = 0.5;
/** Un emploi commercial « nourri » pour N clients ; clientèle = habitants + part des actifs travaillant en ville. */
export const RESIDENTS_PER_COMMERCIAL_JOB = 20;
export const WORKER_CUSTOMER_SHARE = 0.5;

export const Sector = { None: 0, Commercial: 1, Industrial: 2, Office: 3, Public: 4 } as const;
const SECTOR_TAX: Record<number, TaxSector | null> = { 0: null, 1: 'commercial', 2: 'industrial', 3: 'office', 4: null };

/** Services couverts (indices dans les tableaux de couverture). */
export const Service = { Education: 0, Health: 1, Police: 2, Fire: 3, Leisure: 4 } as const;
export const SERVICE_NAMES_FR = ['Éducation', 'Santé', 'Sécurité', 'Secours incendie', 'Loisirs'] as const;
const SERVICE_COUNT = 5;
const SERVICE_TAG: Record<string, number> = {
  'service:education': Service.Education, 'service:sante': Service.Health, 'service:police': Service.Police,
  'service:incendie': Service.Fire, 'service:loisirs': Service.Leisure, 'service:culture': Service.Leisure,
  'service:patrimoine': Service.Leisure,
};

/**
 * Capacité des équipements : habitants desservis par unité de `capacite_service` (lits, patrouilles, engins). Un
 * équipement couvre les logements les plus proches de son rayon jusqu'à cette limite (au-delà : non couverts, il faut
 * un deuxième équipement ou une amélioration, +50 % de capacité par niveau). Sans étiquette : capacité illimitée.
 * L'éducation est limitée par les places d'élèves (`findSchool`).
 */
export const RESIDENTS_PER_SERVICE_UNIT: Partial<Record<number, number>> = { [Service.Health]: 20, [Service.Police]: 600, [Service.Fire]: 900 };

/** Pénalité de satisfaction (points) d'un logement sans électricité / sans eau, une fois la période de grâce passée. */
export const NO_POWER_PENALTY = 10;
export const NO_WATER_PENALTY = 10;
/** Croissance d'un logement sans service (part des arrivées conservée par service manquant, à pleine pénalité). */
export const NO_SERVICE_GROWTH = 0.4;

/**
 * Effet des impôts résidentiels sur la satisfaction (points, positif = pénalité) : linéaire autour du taux de
 * référence (9 %), puis nettement plus fort au-delà de 12 % (un taux élevé se voit tout de suite).
 */
export function residentialTaxPenalty(rate: number): number {
  return (rate - 0.09) * 150 + Math.max(0, rate - 0.12) * 450;
}
/** Effet des impôts résidentiels sur l'attractivité (0..1, positif = baisse). */
export function residentialTaxAttraction(rate: number): number {
  return (rate - 0.09) * 2 + Math.max(0, rate - 0.12) * 6;
}

/** Facteurs de satisfaction détaillés (rapport `satisfactionFactors`), dans l'ordre d'affichage. */
export const SATISFACTION_FACTORS = [
  ['emploi', 'Emploi'], ['loyer', 'Coût du logement'], ['logement', 'Accès routier'], ['electricite', 'Électricité'], ['eau', 'Eau'], ['dechets', 'Déchets'],
  ['sante', 'Santé'], ['police', 'Police'], ['pompiers', 'Pompiers'], ['education', 'Éducation'], ['loisirs', 'Loisirs'],
  ['equipements', 'Équipements remarquables'], ['pollution', 'Pollution'], ['bruit', 'Bruit et nuisances'], ['trajet', 'Temps de trajet'],
  ['impots', 'Impôts'], ['politiques', 'Politiques et quartier'],
] as const;
const F = Object.fromEntries(SATISFACTION_FACTORS.map(([k], i) => [k, i])) as Record<(typeof SATISFACTION_FACTORS)[number][0], number>;
const FACTOR_COUNT = SATISFACTION_FACTORS.length;

/** Raisons des logements vides (rapport `vacancyReasons`). */
export interface VacancyReasons { sansAcces: number; sansEau: number; sansElectricite: number; loyerEleve: number; demandeFaible: number }
/**
 * Indice de croissance bloquée (rapport `growthHint`). Économie vivante (après la période de grâce) : loyers trop
 * lourds, chômage élevé, emplois qualifiés tenus par des sous-qualifiés.
 */
export type GrowthHint = 'need-roads' | 'need-zones' | 'need-power' | 'need-water' | 'high-rent' | 'need-jobs' | 'need-education' | 'need-transit' | 'traffic-jam' | null;

/** Étiquette `service:*` dont la démographie lit la couverture (rayon, capacité, niveau d'amélioration). */
export const isCoverageServiceTag = (tag: string): boolean => SERVICE_TAG[tag] !== undefined;

export const TripPurpose = { Work: 0, Home: 1, Leisure: 2, School: 3 } as const;

/* ------------------------------------------------------------------ */
/* Types de rapport                                                     */
/* ------------------------------------------------------------------ */

export interface MonthCounters { births: number; deaths: number; immigrants: number; emigrants: number; householdsFormed: number; hires: number }

export interface DemographyReport {
  population: number;
  households: number;
  children: number;
  adults: number;
  seniors: number;
  /** Tranches d'âge de 10 ans (0-9 … 80+). */
  ageBands: number[];
  /** Adultes par niveau d'éducation (cf. EDUCATION_NAMES_FR). */
  education: number[];
  educationNames: readonly string[];
  laborForce: number;
  employed: number;
  unemployed: number;
  unemploymentRate: number;
  pupils: number;
  retirees: number;
  jobsTotal: number;
  jobsFilled: number;
  housingCapacity: number;
  housingFree: number;
  happiness: number;
  averageIncome: number;
  /** Part des habitants couverts par chaque service (0..1). */
  services: Record<string, number>;
  pollution: number;
  attractiveness: number;
  /** Demande -1..1 par secteur. */
  demand: { residential: number; commercial: number; industrial: number; office: number };
  month: MonthCounters;
  lastMonth: MonthCounters;
  /** Répartition des activités (citoyens suivis + estimation statistique). */
  activities: Record<string, number>;
  lod: { detailed: number; simplified: number; statistical: number };
  tripsEmitted: number;
  companies: number;
  /**
   * Détail de la satisfaction : points moyens par habitant apportés (+) ou retirés (−) par chaque facteur, mesurés au
   * dernier calcul quotidien (avant bornage 0..100 et lissage). Satisfaction cible ≈ 55 + somme des deltas.
   */
  satisfactionFactors: { key: string; label: string; delta: number }[];
  /** Logements (bâtiments résidentiels) entièrement vides, par raison principale (accès > eau > électricité > demande). */
  vacancyReasons: VacancyReasons;
  /** Croissance bloquée : ce qui manque à la ville (null si rien de particulier). */
  growthHint: GrowthHint;
  /**
   * Économie vivante (docs/ECONOMIE_VIVANTE.md) : loyers, ménages en difficulté, entreprises, chômage par quartier,
   * adéquation éducation / emploi. Calculé chaque jour ; null avant le premier calcul quotidien.
   */
  living: LivingReport | null;
  /**
   * Services qui comptent (docs/SERVICES.md) : criminalité, incendies, santé, couverture et capacité des équipements,
   * événements récents. Absent des simulations plus anciennes (lecture tolérante côté interface).
   */
  cityServices?: ServicesReport;
}

export interface CitizenInfo {
  id: number;
  name: string;
  age: number;
  education: string;
  householdId: number;
  homeBuildingId: number;
  jobBuildingId: number;
  schoolBuildingId: number;
  income: number;
  happiness: number;
  activity: string;
  status: string;
  schedule: { wake: string; workStart: string; workEnd: string; sleep: string };
}

export interface BuildingOccupancy {
  buildingId: number;
  residents: number;
  residentCapacity: number;
  workers: number;
  jobCapacity: number;
  roadAccess: boolean;
  company: {
    name: string; sector: string; revenue: number; profit: number;
    /** Économie vivante : loyer et impôt du dernier mois, état ('active' | 'difficulty' | 'closed'), raison. */
    rent?: number; tax?: number; status?: 'active' | 'difficulty' | 'closed'; reason?: string | null; lossMonths?: number;
  } | null;
  /** Économie vivante : valeur foncière (indice, 100 = référence), loyer d'un logement, ménages en difficulté. */
  economy?: { landValue: number; rent: number; householdsInDistress: number };
  /** Services (vague 2) : criminalité, risque d'incendie, santé, état (feu, endommagé, ruine), couverture. */
  safety?: BuildingSafety;
  /** Interface (vague 5) : éléments de la fiche « Pourquoi » (facultatif : absent des simulations plus anciennes). */
  diagnosis?: BuildingDiagnosis;
  services: string[];
  occupants: CitizenInfo[];
  employees: CitizenInfo[];
}

/**
 * Fiche « Pourquoi » d'un bâtiment (docs/INTERFACE.md) : données brutes, mises en mots par l'interface
 * (src/ui/why.ts). Aucune valeur inventée : tout vient des calculs quotidiens de la simulation.
 */
export interface BuildingDiagnosis {
  /** Points de satisfaction moyens par habitant du bâtiment, par facteur (même calcul que le jour), vide sans habitant. */
  factors: { key: string; label: string; delta: number }[];
  /** Logement entièrement vide : raison principale (même règle que `vacancyReasons`), null sinon. */
  vacancy: keyof VacancyReasons | null;
  /** Réseaux : 0 desservi, 1 coupé (raccordé mais délesté), 2 hors de tout réseau. */
  power: number;
  water: number;
  /** Pénalités « sans service » appliquées (0 pendant la période de grâce, 1 à plein). */
  ramp: number;
  /** Effort moyen des ménages du logement (loyer / ressources), null sans ménage ; part soutenable. */
  rentBurden: number | null;
  sustainableShare: number;
  /** Habitants actifs (18-63 ans hors études) et chômeurs du bâtiment. */
  labor: number;
  unemployed: number;
  /** Ville : chômeurs (dernier calcul quotidien) ; emplois offerts par ce bâtiment (courant, entreprise ouverte). */
  cityUnemployed: number;
  jobsOffered: boolean;
  /** Entreprise : employés sous-qualifiés, diplôme exigé, clientèle (1 = normale), part du loyer dans le chiffre d'affaires. */
  underqualified: number;
  requiredEducation: string | null;
  customers: number | null;
  rentShare: number | null;
  /** Clé de la raison des difficultés (`CLOSURE_REASONS`), null sinon. */
  reasonKey: string | null;
  /** Desserte en bus du logement (points de satisfaction, 0 sans ligne). */
  transit: number;
}

export interface DemographyJSON {
  nextCitizenId: number;
  nextHouseholdId: number;
  citizens: ColumnsJSON;
  households: ColumnsJSON;
  companies: ColumnsJSON;
  month: MonthCounters;
  lastMonth: MonthCounters;
  attractiveness: number;
  tripsEmitted: number;
  /** Économie vivante (facultatif : absent des anciennes sauvegardes). */
  living?: unknown;
  /** Services : criminalité, incendies, ruines (facultatif : absent des anciennes sauvegardes). */
  services?: unknown;
}

/* ------------------------------------------------------------------ */
/* Utilitaires                                                          */
/* ------------------------------------------------------------------ */

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const clampS = (v: number): number => (v < -1 ? -1 : v > 1 ? 1 : v);
const zeroCounters = (): MonthCounters => ({ births: 0, deaths: 0, immigrants: 0, emigrants: 0, householdsFormed: 0, hires: 0 });
const hhmm = (m: number): string => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Mortalité annuelle (loi de Gompertz simplifiée). */
export function annualMortality(age: number): number {
  if (age < 1) return 0.0035;
  return Math.min(0.6, 0.0004 * Math.exp(0.095 * (age - 30)));
}

interface AssetMeta {
  resCap: number;
  jobCap: number;
  sector: number;
  service: number; // -1 si aucun
  radius: number;
  serviceCapacity: number;
  attract: number;
  pollution: number;
  leisureVenue: boolean;
  /** Économie vivante : niveau du bâtiment (1..3), éducation minimale des emplois (niveau à 5 crans) et niveau simplifié. */
  level: number;
  reqEdu: number;
  reqTier: number;
}

export interface DemographyContext {
  catalog: AssetCatalog;
  buildings: BuildingStore;
  buildingIndex: ChunkIndex;
  rng: Rng;
}

/* ------------------------------------------------------------------ */
/* Système                                                              */
/* ------------------------------------------------------------------ */

export class DemographySystem {
  readonly citizens: CitizenTable = createCitizenTable();
  readonly households: HouseholdTable = createHouseholdTable();
  readonly companies: CompanyTable = createCompanyTable();
  nextCitizenId = 1;
  nextHouseholdId = 1;
  month: MonthCounters = zeroCounters();
  lastMonth: MonthCounters = zeroCounters();
  attractiveness = 0.5;
  tripsEmitted = 0;
  /** Habitants et ménages réels (somme des poids des lignes). */
  private popW = 0;
  private hhW = 0;
  /** Lignes agrégées (poids > 1) : citoyens. */
  private aggRows = 0;
  /**
   * Seuil d'activation de la simulation agrégée (habitants) ; Infinity la désactive. `forcedWeight` (tests, banc) impose
   * le poids des nouveaux ménages.
   */
  aggregateThreshold = AGGREGATE_THRESHOLD;
  forcedWeight = 0;

  // Point focal (caméra) pour le LOD de simulation.
  /** Événement « afflux de nouveaux habitants » (module `evenements`) : multiplicateur des arrivées (1 = aucun effet). */
  immigrationFactor = 1;
  focusX = 0;
  focusZ = 0;

  // File de demandes de trajet (anneau en typed arrays, sans allocation).
  readonly tripCitizen = new Int32Array(TRIP_QUEUE_CAPACITY);
  readonly tripFrom = new Int32Array(TRIP_QUEUE_CAPACITY);
  readonly tripTo = new Int32Array(TRIP_QUEUE_CAPACITY);
  readonly tripPurpose = new Uint8Array(TRIP_QUEUE_CAPACITY);
  readonly tripMinute = new Int32Array(TRIP_QUEUE_CAPACITY);
  private tripHead = 0;
  tripCount = 0;

  private meta: AssetMeta[] = [];
  private pupilsBySchool = new Map<number, number>();
  // Couverture par index de bâtiment (recalculée quand `coverageDirty`).
  private coverage: Uint8Array[] = [];
  /** Qualité de couverture (0 non couvert ; 1 − 0,5 · distance / rayon de l'équipement le plus proche qui couvre). */
  private coverageQ: Float32Array[] = [];
  private pollutionAt = new Float32Array(0);
  private attractAt = new Float32Array(0);
  private leisureTarget = new Int32Array(0);
  private coverageDirty = true;
  private readonly tmp: number[] = [];
  private readonly tmp2: number[] = [];
  // Tampons réutilisés pour les agrégats par ménage.
  private hhAdults = new Uint8Array(0);
  private hhFertile = new Uint8Array(0);
  private hhHappy = new Float32Array(0);
  private hhMembers = new Uint8Array(0);
  private tickCounter = 0;

  /** Économie vivante : loyers, difficultés des ménages, comptes et fermetures d'entreprises. */
  readonly living: LivingEconomy = new LivingEconomy(this);
  /** Services qui comptent : criminalité, incendies, santé (docs/SERVICES.md). */
  readonly services: CityServices = new CityServices(this);
  /** Change à chaque ajout / suppression de bâtiment (index des tableaux par bâtiment). */
  private buildingsVersion = 0;

  constructor(public ctx: DemographyContext) {}

  setContext(ctx: DemographyContext): void { this.ctx = ctx; this.buildMeta(); this.services.setCatalog(ctx.catalog); }

  private buildMeta(): void {
    this.meta = this.ctx.catalog.assets.map((a) => {
      const tags = a.tags;
      const num = (prefix: string, def: number): number => {
        const t = tags.find((x) => x.startsWith(prefix));
        const v = t ? Number(t.slice(prefix.length)) : NaN;
        return Number.isFinite(v) ? v : def;
      };
      let sector: number = Sector.None;
      if (isBuildingCategory(a.category) && a.capacity.jobs > 0) {
        if (a.category === 'skyscraper') sector = Sector.Office;
        else if (a.category === 'industrial') sector = Sector.Industrial;
        else if (a.category === 'public') sector = Sector.Public;
        else if (a.category === 'commercial') sector = tags.includes('bureaux') || tags.includes('tertiaire') ? Sector.Office : Sector.Commercial;
        else sector = Sector.Commercial;
      }
      let service = -1;
      for (const t of tags) if (SERVICE_TAG[t] !== undefined) { service = SERVICE_TAG[t]!; break; }
      const leisureVenue = service === Service.Leisure || (a.category === 'commercial' && (tags.includes('restaurant') || tags.includes('cafe') || tags.includes('galerie_marchande') || tags.includes('commerce_de_proximite')));
      // Éducation exigée : bureaux le bac (tours de bureaux : le supérieur), services publics et industrie avancée
      // (usines, manufactures, énergie) le brevet / CAP ; commerce et petite industrie : aucune.
      const advancedIndustry = sector === Sector.Industrial && (tags.includes('usine') || tags.includes('manufacture') || tags.includes('energie'));
      const reqEdu = sector === Sector.Office ? (a.category === 'skyscraper' ? Education.Higher : Education.Baccalaureate)
        : sector === Sector.Public || advancedIndustry ? Education.Secondary : Education.None;
      return {
        level: isBuildingCategory(a.category) ? buildingLevel(a.category, a.capacity.residents, a.capacity.jobs) : 1,
        reqEdu, reqTier: eduTier(reqEdu),
        resCap: isBuildingCategory(a.category) ? Math.max(0, a.capacity.residents) : 0,
        jobCap: isBuildingCategory(a.category) ? Math.max(0, a.capacity.jobs) : 0,
        sector, service, radius: num('rayon:', 800), serviceCapacity: num('capacite_service:', 0),
        attract: num('attractivite:', 0), pollution: num('pollution:', 0), leisureVenue,
      };
    });
  }

  reset(): void {
    this.citizens.clear();
    this.households.clear();
    this.companies.clear();
    this.nextCitizenId = 1;
    this.nextHouseholdId = 1;
    this.month = zeroCounters();
    this.lastMonth = zeroCounters();
    this.attractiveness = 0.5;
    this.tripsEmitted = 0;
    this.popW = 0;
    this.hhW = 0;
    this.aggRows = 0;
    this.tripHead = 0;
    this.tripCount = 0;
    this.pupilsBySchool.clear();
    this.coverageDirty = true;
    this.tickCounter = 0;
    this.living.reset();
    this.services.reset();
    this.buildingsVersion++;
  }

  /** Habitants (réels : somme des poids). */
  get population(): number { return this.popW; }
  /** Ménages (réels : somme des poids). */
  get householdCount(): number { return this.hhW; }
  /** Nombre d'habitants représentés par la ligne de citoyen `i` (1 hors simulation agrégée). */
  weightOf(i: number): number { return this.citizens.col.weight[i] || 1; }
  /** Nombre de ménages représentés par la ligne de ménage `k`. */
  hhWeightOf(k: number): number { return this.households.col.weight[k] || 1; }
  /** Poids d'un NOUVEAU ménage (immigration) selon la population : 1 sous le seuil d'activation. */
  newHouseholdWeight(): number {
    if (this.forcedWeight > 0) return Math.min(AGGREGATE_MAX_WEIGHT, Math.floor(this.forcedWeight));
    if (this.popW < this.aggregateThreshold) return 1;
    return Math.max(1, Math.min(AGGREGATE_MAX_WEIGHT, Math.ceil(this.popW / AGGREGATE_ROWS_TARGET)));
  }
  /** État de la simulation agrégée (rapport, banc d'essai). */
  aggregateInfo(): { rows: number; aggregatedRows: number; population: number; households: number; householdRows: number; nextWeight: number } {
    return { rows: this.citizens.count, aggregatedRows: this.aggRows, population: this.popW, households: this.hhW, householdRows: this.households.count, nextWeight: this.newHouseholdWeight() };
  }

  private metaOfIndex(bi: number): AssetMeta | undefined { return this.meta[this.ctx.buildings.assetIndex[bi]!]; }

  ageOf(ci: number, now: number): number { return (now - this.citizens.col.birth[ci]!) / MINUTES_PER_YEAR; }

  /* ------------------------- Événements bâtiments ------------------------- */

  /** À appeler après l'insertion d'un bâtiment dans le store. */
  onBuildingAdded(id: number, now: number): void {
    this.coverageDirty = true;
    this.buildingsVersion++;
    const bi = this.ctx.buildings.indexOf(id);
    const m = bi >= 0 ? this.metaOfIndex(bi) : undefined;
    this.services.onBuildingAdded(id, now);
    if (m && m.jobCap > 0 && !this.companies.has(id)) {
      const k = this.companies.add(id);
      this.companies.col.sector[k] = m.sector;
      this.companies.col.ownerSurname[k] = randomSurname(this.ctx.rng);
      this.companies.col.founded[k] = Math.floor(now);
    }
  }

  /**
   * À appeler AVANT la suppression d'un bâtiment du store : les ménages logés sont relogés
   * ailleurs si possible (sinon quittent la ville), les employés perdent leur emploi.
   */
  onBuildingRemoved(id: number, now: number): void {
    this.coverageDirty = true;
    this.buildingsVersion++;
    this.living.onBuildingRemoved(id);
    this.services.onBuildingRemoved(id);
    this.evacuateBuilding(id, now);
    this.companies.remove(id);
  }

  /**
   * Vide un bâtiment sans le supprimer (démolition, ou ruine après un incendie) : ménages relogés ailleurs s'il y a
   * de la place (sinon ils quittent la ville), employés licenciés, élèves désinscrits.
   */
  evacuateBuilding(id: number, now: number): void {
    const c = this.citizens.col;
    const leavingHouseholds = new Set<number>();
    const toRelocate = new Set<number>();
    for (let i = 0; i < this.citizens.count; i++) {
      if (c.job[i] === id) { c.job[i] = -1; c.income[i] = 0; c.commute[i] = 0; this.assignSchedule(i); }
      if (c.school[i] === id) { c.school[i] = -1; this.assignSchedule(i); }
      if (c.home[i] === id) toRelocate.add(c.household[i]!);
    }
    this.pupilsBySchool.delete(id);
    for (const hid of toRelocate) {
      const hk = this.households.indexOf(hid);
      if (hk < 0) continue;
      const size = this.households.col.size[hk]! * this.hhWeightOf(hk);
      const target = this.findHousing(size, id);
      if (target >= 0) this.moveHousehold(hid, target, now);
      else leavingHouseholds.add(hid);
    }
    if (leavingHouseholds.size) this.removeHouseholds(leavingHouseholds, true);
    // Compteurs remis à zéro APRÈS les déménagements (qui décrémentent l'ancien logement) : le bâtiment reste vide.
    const bi = this.ctx.buildings.indexOf(id);
    if (bi >= 0) { this.ctx.buildings.residents[bi] = 0; this.ctx.buildings.workers[bi] = 0; }
    this.coverageDirty = true;
  }

  /** Accès route ou bâtiments modifiés : la couverture des services sera recalculée. */
  markCoverageDirty(): void { this.coverageDirty = true; }

  /* ------------------------------ Couverture ------------------------------ */

  private ensureCoverage(): void {
    if (!this.coverageDirty) return;
    this.coverageDirty = false;
    const b = this.ctx.buildings;
    const n = b.count;
    if (this.coverage.length !== SERVICE_COUNT || this.coverage[0]!.length < n) {
      const cap = Math.max(16, b.capacity);
      this.coverage = [];
      this.coverageQ = [];
      for (let k = 0; k < SERVICE_COUNT; k++) { this.coverage.push(new Uint8Array(cap)); this.coverageQ.push(new Float32Array(cap)); }
      this.pollutionAt = new Float32Array(cap);
      this.attractAt = new Float32Array(cap);
      this.leisureTarget = new Int32Array(cap);
    }
    for (let k = 0; k < SERVICE_COUNT; k++) { this.coverage[k]!.fill(0, 0, n); this.coverageQ[k]!.fill(0, 0, n); }
    this.pollutionAt.fill(0, 0, n);
    this.attractAt.fill(0, 0, n);
    this.leisureTarget.fill(-1, 0, n);
    const bestLeisure = new Float32Array(n).fill(Infinity);
    const near: number[] = [];
    const nearD: number[] = [];
    for (let s = 0; s < n; s++) {
      const m = this.metaOfIndex(s);
      if (!m || !b.roadAccess[s]) continue;
      // Équipement en feu ou en ruine (incendie) : il ne couvre plus personne.
      if (m.service >= 0 && this.services.blocked(b.id[s]!)) continue;
      const sx = b.x[s]!, sz = b.z[s]!;
      const affects = m.service >= 0 || m.attract > 0 || m.pollution > 0 || m.leisureVenue;
      if (!affects) continue;
      const lvl = m.service >= 0 ? this.serviceLevel(b.id[s]!) : 1;
      const rad = m.radius * (1 + 0.25 * (lvl - 1));
      const R = Math.max(m.service >= 0 ? rad : 0, m.attract > 0 ? Math.max(m.radius, 800) : 0, m.pollution > 0 ? 400 : 0, m.leisureVenue ? 1500 : 0);
      this.ctx.buildingIndex.query(sx - R, sz - R, sx + R, sz + R, this.tmp);
      // Capacité (lits, patrouilles, engins) : habitants couverts au plus, logements les plus proches d'abord.
      const perUnit = m.service >= 0 && m.serviceCapacity > 0 ? RESIDENTS_PER_SERVICE_UNIT[m.service] ?? 0 : 0;
      const capped = perUnit > 0;
      if (capped) { near.length = 0; nearD.length = 0; }
      for (const id of this.tmp) {
        const j = b.indexOf(id);
        if (j < 0) continue;
        const dx = b.x[j]! - sx, dz = b.z[j]! - sz;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (m.service >= 0 && d <= rad) {
          if (capped) { near.push(j); nearD.push(d); }
          else { this.coverage[m.service]![j] = 1; const q = 1 - 0.5 * d / rad; if (q > this.coverageQ[m.service]![j]!) this.coverageQ[m.service]![j] = q; }
        }
        if (m.attract > 0 && d <= Math.max(m.radius, 800)) this.attractAt[j]! += m.attract * (1 - d / Math.max(m.radius, 800));
        if (m.pollution > 0 && d <= 400) this.pollutionAt[j]! += m.pollution * (1 - d / 400) * this.pollutionFactor * this.pollutionFactorOf(id);
        if (m.leisureVenue && j !== s && d <= 1500 && d < bestLeisure[j]!) { bestLeisure[j] = d; this.leisureTarget[j] = b.id[s]!; }
      }
      if (capped) {
        let room = m.serviceCapacity * (1 + 0.5 * (lvl - 1)) * perUnit;
        const order = near.map((_, k) => k).sort((p, q) => nearD[p]! - nearD[q]! || near[p]! - near[q]!);
        const cov = this.coverage[m.service]!;
        const cq = this.coverageQ[m.service]!;
        for (const k of order) {
          const j = near[k]!;
          const q = 1 - 0.5 * nearD[k]! / rad;
          if (cov[j]) { if (q > cq[j]!) cq[j] = q; continue; } // déjà couvert par un autre équipement : ne consomme pas cette capacité
          const r = b.residents[j]!;
          if (r > 0 && room <= 0) continue;
          cov[j] = 1;
          cq[j] = q;
          room -= r;
        }
      }
    }
  }

  /* ------------------------------- Logement ------------------------------- */

  /**
   * Activité d'un bâtiment (1 = actif) branchée par la simulation sur les services des modules : un bâtiment
   * privé de courant n'embauche pas et ses emplois ne sont pas offerts. 1 tant qu'aucun réseau n'existe.
   */
  activity: (buildingId: number) => number = () => 1;
  /**
   * Satisfaction apportée par les services des modules au logement (points, négatif = pénalité) : grille
   * municipale `satisfaction` (eau non desservie, qualité, égouts, bruit du port/aéroport, nuisances des
   * déchets…). 0 tant qu'aucun module n'y écrit.
   */
  serviceSatisfaction: (buildingId: number) => number = () => 0;
  /** Multiplicateur de la pollution industrielle subie (politiques, recherche) ; 1 = neutre. */
  pollutionFactor = 1;
  /** Multiplicateur de pollution subie par bâtiment (politiques locales des secteurs) ; 1 par défaut. */
  pollutionFactorOf: (buildingId: number) => number = () => 1;
  /** Niveau d'un équipement de service (améliorations, 1 à 3) : rayon +25 % et capacité +50 % par niveau. */
  serviceLevel: (buildingId: number) => number = () => 1;
  /** Filtres de croissance des modules (eau, électricité) : faux = le bâtiment n'accueille pas de nouveaux ménages. */
  growthGates: ((buildingId: number) => boolean)[] = [];
  /** État des réseaux d'un bâtiment (branchés par la simulation) : 0 desservi, 1 coupé (raccordé mais délesté), 2 hors de tout réseau. */
  powerState: (buildingId: number) => number = () => 0;
  waterState: (buildingId: number) => number = () => 0;
  /** Part (0..1) de la pénalité « sans service » appliquée : 0 pendant la période de grâce du début de partie. */
  noServiceRamp: () => number = () => 0;
  /**
   * Détail de `serviceSatisfaction` : remplit `out` (électricité, eau, déchets, bruit et nuisances, politiques et
   * quartier) et renvoie le total. Absent : tout `serviceSatisfaction` est compté dans « Bruit et nuisances ».
   */
  serviceSatisfactionParts: ((buildingId: number, out: Float64Array) => number) | null = null;
  /** Zonage résidentiel : cases zonées, cases libres constructibles, demande R (-1..1) ; null sans zonage actif. */
  residentialLots: () => { zoned: number; free: number; demand: number } | null = () => null;
  /**
   * Transports en commun (module « bus », docs/TRANSPORTS_COMMUN.md) — crochets neutres par défaut : préparation du
   * jour (couverture des arrêts, avant l'embauche), satisfaction d'un logement desservi, portée supplémentaire de la
   * recherche d'emploi (m) et desserte commune logement / emploi, aide de croissance proposée par le module.
   */
  transitPrepare: (now: number) => void = () => undefined;
  transitSatisfaction: (homeId: number) => number = () => 0;
  transitReach: (homeId: number) => number = () => 0;
  transitServes: (homeId: number, jobId: number) => boolean = () => false;
  extraGrowthHint: () => GrowthHint = () => null;
  /** Embauches rendues possibles par le bus (cumul) ; recherches d'emploi sans emploi accessible (dernier jour). */
  transitHires = 0;
  jobNoReachDay = 0;
  /** Chômeurs et actifs comptés à la dernière passe quotidienne. */
  lastUnemployed = 0;
  lastLaborForce = 0;
  /** Vrai si la ville a au moins une route (indice de croissance). */
  hasRoads: () => boolean = () => true;
  /** Économie vivante : décalage de valeur foncière de la grille municipale (indice, ±0,3) ; 0 sans grille. */
  landValueOffset: (buildingId: number) => number = () => 0;
  /** Quartier (secteur du joueur) d'un bâtiment ; null : îlot de la grille de 500 m. */
  districtOf: (buildingId: number) => { key: number; name: string } | null = () => null;
  /** Lot privé (zonage) : une ruine est reconstruite par son promoteur ; faux par défaut. */
  isPrivate: (buildingId: number) => boolean = () => false;
  /** Taux d'imposition d'un secteur d'entreprise (1 commerce, 2 industrie, 3 bureaux) ; 9 % par défaut. */
  companyTaxRate: (sector: number) => number = () => 0.09;
  /** Somme des points de satisfaction par facteur (dernier calcul quotidien) et habitants comptés. */
  private factorSum = new Float64Array(FACTOR_COUNT);
  private factorCount = 0;
  private readonly parts = new Float64Array(5);

  /** Poids de croissance d'un logement (1 desservi ; réduit par service manquant après la période de grâce). */
  private growthWeight(id: number): number {
    const ramp = this.noServiceRamp();
    if (ramp <= 0) return 1;
    let w = 1;
    if (this.powerState(id) === 2) w *= 1 - (1 - NO_SERVICE_GROWTH) * ramp;
    if (this.waterState(id) === 2) w *= 1 - (1 - NO_SERVICE_GROWTH) * ramp;
    return w;
  }

  private active(bi: number): boolean { const id = this.ctx.buildings.id[bi]!; return this.activity(id) >= 1 && !this.services.blocked(id); }
  /** Emplois offerts : bâtiment actif (courant) et entreprise ouverte (pas un local vacant après fermeture). */
  private jobOpen(bi: number): boolean { return this.active(bi) && this.living.isOpen(this.ctx.buildings.id[bi]!); }

  /* --------------------------- Économie vivante (hôte) --------------------------- */

  livingMeta(bi: number): LivingMeta | undefined { return this.metaOfIndex(bi); }
  private readonly amen = { services: 0, attract: 0, pollution: 0 };
  amenitiesAt(bi: number): { services: number; attract: number; pollution: number } {
    const a = this.amen;
    a.services = 0; a.attract = 0; a.pollution = 0;
    if (bi < 0 || this.coverage.length !== SERVICE_COUNT || bi >= this.coverage[0]!.length) return a;
    for (let k = 0; k < SERVICE_COUNT; k++) a.services += this.coverage[k]![bi]!;
    a.attract = this.attractAt[bi]!;
    a.pollution = this.pollutionAt[bi]!;
    return a;
  }
  randomOwner(): number { return randomSurname(this.ctx.rng); }

  /* --------------------------- Services (hôte) --------------------------- */

  coverageQuality(service: number, bi: number): number {
    if (bi < 0 || this.coverageQ.length !== SERVICE_COUNT || bi >= this.coverageQ[service]!.length) return 0;
    return this.coverage[service]![bi] ? this.coverageQ[service]![bi]! : 0;
  }
  pollutionOf(bi: number): number { return bi >= 0 && bi < this.pollutionAt.length ? this.pollutionAt[bi]! : 0; }
  householdInDistress(hk: number): boolean { return this.households.col.distressDays[hk]! > 0 && this.noServiceRamp() > 0; }
  /** Équipements d'un service desservis par une route : position, rayon et unités (capacité, améliorations comprises). */
  serviceStations(service: number): ServiceStation[] {
    const b = this.ctx.buildings, out: ServiceStation[] = [];
    for (let i = 0; i < b.count; i++) {
      const m = this.metaOfIndex(i);
      if (!m || m.service !== service || !b.roadAccess[i]) continue;
      const id = b.id[i]!;
      if (this.services.blocked(id)) continue;
      const lvl = this.serviceLevel(id);
      out.push({ id, x: b.x[i]!, z: b.z[i]!, radius: m.radius * (1 + 0.25 * (lvl - 1)), units: Math.max(1, m.serviceCapacity) * (1 + 0.5 * (lvl - 1)) });
    }
    return out;
  }

  freeHousingAt(bi: number): number {
    const m = this.metaOfIndex(bi);
    if (!m || m.resCap <= 0 || !this.ctx.buildings.roadAccess[bi]) return 0;
    if (this.services.blocksHousing(this.ctx.buildings.id[bi]!)) return 0;
    if (this.growthGates.length) { const id = this.ctx.buildings.id[bi]!; for (const g of this.growthGates) if (!g(id)) return 0; }
    return Math.max(0, m.resCap - this.ctx.buildings.residents[bi]!);
  }

  /**
   * Capacité de logement par index de bâtiment, filtres compris (accès route, incendie, réseaux des modules : 0 si l'un
   * refuse), relevée au début d'une vague d'immigration ou des décohabitations : `findHousing` n'appelle plus les
   * filtres des modules pour chaque bâtiment et chaque ménage (≈ 600 ms par jour à un million d'habitants). Les filtres
   * ne changent pas pendant ces passes et l'occupation est relue en direct : mêmes candidats, même tirage.
   */
  private housingCap: Int32Array | null = null;
  private beginHousingCache(): void {
    const b = this.ctx.buildings;
    const a = new Int32Array(b.count);
    for (let i = 0; i < b.count; i++) {
      const m = this.metaOfIndex(i);
      if (!m || m.resCap <= 0 || !b.roadAccess[i]) continue;
      const id = b.id[i]!;
      if (this.services.blocksHousing(id)) continue;
      let ok = true;
      for (const g of this.growthGates) if (!g(id)) { ok = false; break; }
      if (ok) a[i] = m.resCap;
    }
    this.housingCap = a;
  }

  /** Bâtiment (id) au hasard ayant au moins `size` places libres, -1 sinon. */
  private findHousing(size: number, excludeId = -1): number {
    const b = this.ctx.buildings;
    const cands = this.tmp2;
    cands.length = 0;
    const hc = this.housingCap;
    if (hc) { for (let i = 0; i < b.count; i++) if (hc[i]! - b.residents[i]! >= size && b.id[i] !== excludeId) cands.push(b.id[i]!); }
    else for (let i = 0; i < b.count; i++) if (b.id[i] !== excludeId && this.freeHousingAt(i) >= size) cands.push(b.id[i]!);
    if (!cands.length) return -1;
    return cands[Math.floor(this.ctx.rng.next() * cands.length)]!;
  }

  moveHousehold(hid: number, targetId: number, now: number): void {
    const b = this.ctx.buildings;
    const hk = this.households.indexOf(hid);
    if (hk < 0) return;
    const oldId = this.households.col.home[hk]!;
    const oi = b.indexOf(oldId);
    const ti = b.indexOf(targetId);
    const c = this.citizens.col;
    for (let i = 0; i < this.citizens.count; i++) {
      if (c.household[i] !== hid) continue;
      const w = this.weightOf(i);
      if (oi >= 0) b.residents[oi] = Math.max(0, b.residents[oi]! - w);
      if (ti >= 0) b.residents[ti]! += w;
      c.home[i] = targetId;
      this.updateCommute(i);
    }
    this.households.col.home[hk] = targetId;
    this.households.col.movedIn[hk] = Math.floor(now);
  }

  /** Retire des ménages entiers (émigration ou décès du dernier membre). */
  removeHouseholds(ids: Set<number>, emigrate: boolean): void {
    for (let i = this.citizens.count - 1; i >= 0; i--) {
      if (ids.has(this.citizens.col.household[i]!)) {
        if (emigrate) this.month.emigrants += this.weightOf(i);
        this.removeCitizenAt(i, false);
      }
    }
    for (const id of ids) this.removeHouseholdRow(id);
  }

  /** Supprime le citoyen d'index i (libère logement, emploi, école). */
  private removeCitizenAt(i: number, updateHousehold = true): void {
    const c = this.citizens.col;
    const b = this.ctx.buildings;
    const w = this.weightOf(i);
    const home = b.indexOf(c.home[i]!);
    if (home >= 0 && b.residents[home]! > 0) b.residents[home] = Math.max(0, b.residents[home]! - w);
    const job = b.indexOf(c.job[i]!);
    if (job >= 0 && b.workers[job]! > 0) b.workers[job] = Math.max(0, b.workers[job]! - w);
    if (c.school[i]! >= 0) this.pupilsBySchool.set(c.school[i]!, Math.max(0, (this.pupilsBySchool.get(c.school[i]!) ?? w) - w));
    if (updateHousehold) {
      const hk = this.households.indexOf(c.household[i]!);
      if (hk >= 0) {
        const s = --this.households.col.size[hk]!;
        if (s <= 0) this.removeHouseholdRow(c.household[i]!);
      }
    }
    this.popW -= w;
    if (w > 1) this.aggRows--;
    this.citizens.remove(c.id[i]!);
  }

  /** Retire une ligne de ménage (compteur pondéré tenu à jour). */
  private removeHouseholdRow(hid: number): void {
    const hk = this.households.indexOf(hid);
    if (hk < 0) return;
    this.hhW -= this.hhWeightOf(hk);
    this.households.remove(hid);
  }

  /* ------------------------------- Citoyens ------------------------------- */

  private addCitizen(householdId: number, homeId: number, sex: number, ageYears: number, education: number, role: number, now: number): number {
    const id = this.nextCitizenId++;
    const i = this.citizens.add(id);
    const c = this.citizens.col;
    const rng = this.ctx.rng;
    // Poids du ménage (1 hors simulation agrégée ; 0 stocké pour 1 : sauvegardes inchangées).
    const hk = this.households.indexOf(householdId);
    const w = hk >= 0 ? this.hhWeightOf(hk) : 1;
    c.weight[i] = w > 1 ? w : 0;
    this.popW += w;
    if (w > 1) this.aggRows++;
    c.household[i] = householdId;
    c.sex[i] = sex;
    c.firstName[i] = randomFirstName(rng, sex);
    c.birth[i] = Math.floor(now - ageYears * MINUTES_PER_YEAR - rng.next() * MINUTES_PER_DAY);
    c.education[i] = education;
    c.role[i] = role;
    c.home[i] = homeId;
    c.job[i] = -1;
    c.school[i] = -1;
    c.happiness[i] = 60;
    c.activity[i] = Activity.Home;
    c.lod[i] = SimLod.Statistical;
    const bi = this.ctx.buildings.indexOf(homeId);
    if (bi >= 0) this.ctx.buildings.residents[bi]! += w;
    this.assignSchedule(i);
    return i;
  }

  private newHousehold(homeId: number, surname: number, now: number, weight = 1): number {
    const id = this.nextHouseholdId++;
    const k = this.households.add(id);
    this.households.col.weight[k] = weight > 1 ? weight : 0;
    this.hhW += Math.max(1, weight);
    this.households.col.surname[k] = surname;
    this.households.col.home[k] = homeId;
    this.households.col.size[k] = 0;
    this.households.col.movedIn[k] = Math.floor(now);
    return id;
  }

  private addMember(hid: number): void {
    const k = this.households.indexOf(hid);
    if (k >= 0) this.households.col.size[k]!++;
  }

  /** Emploi du temps individuel (horaires variables, déterministes via le PRNG). */
  assignSchedule(i: number): void {
    const c = this.citizens.col;
    const rng = this.ctx.rng;
    c.sleep[i] = rng.int(1290, 1439);
    if (c.job[i]! >= 0) {
      c.wake[i] = rng.int(330, 480);
      c.workStart[i] = c.wake[i]! + rng.int(45, 95);
      c.workEnd[i] = Math.min(1260, c.workStart[i]! + rng.int(450, 540));
    } else if (c.school[i]! >= 0) {
      c.wake[i] = rng.int(400, 450);
      c.workStart[i] = 510;
      c.workEnd[i] = 990;
    } else {
      c.wake[i] = rng.int(420, 560);
      // Sortie de loisirs en matinée ou en après-midi pour les inactifs.
      const start = rng.chance(0.5) ? rng.int(600, 690) : rng.int(870, 990);
      c.workStart[i] = start;
      c.workEnd[i] = start + rng.int(60, 150);
    }
  }

  private updateCommute(i: number): void {
    const c = this.citizens.col;
    const b = this.ctx.buildings;
    const target = c.job[i]! >= 0 ? c.job[i]! : c.school[i]!;
    const hi = b.indexOf(c.home[i]!);
    const ti = target >= 0 ? b.indexOf(target) : -1;
    if (hi < 0 || ti < 0) { c.commute[i] = 0; return; }
    const dx = b.x[hi]! - b.x[ti]!, dz = b.z[hi]! - b.z[ti]!;
    c.commute[i] = Math.sqrt(dx * dx + dz * dz);
  }

  private wageFor(sector: number, education: number): number {
    return (BASE_WAGE[sector] ?? 2000) * (0.8 + 0.12 * education);
  }

  /** Cherche l'emploi libre le plus proche (anneaux de chunks), en respectant l'éducation requise si possible. */
  private findJob(ci: number): number {
    const c = this.citizens.col;
    const b = this.ctx.buildings;
    const hi = b.indexOf(c.home[ci]!);
    if (hi < 0) return -1;
    const hx = b.x[hi]!, hz = b.z[hi]!;
    const idx = this.ctx.buildingIndex;
    const [c0, r0] = idx.cellOf(hx, hz);
    // Transports en commun (module « bus ») : un logement bien desservi atteint des emplois plus lointains desservis par
    // la même ligne (portée supplémentaire nulle sans ligne : recherche inchangée).
    const homeId = c.home[ci]!;
    const extra = this.transitReach(homeId);
    const reach = MAX_COMMUTE_M + (extra > 0 ? extra : 0);
    const maxRing = Math.ceil(reach / idx.cellSize);
    const edu = c.education[ci]!;
    const w = this.weightOf(ci);
    let best = -1, bestD = Infinity, fallback = -1, fallbackD = Infinity, foundRing = -1;
    let partial = -1, partialD = Infinity, partialFree = 0;
    this.jobPartialFree = 0;
    for (let ring = 0; ring <= maxRing; ring++) {
      if (foundRing >= 0 && ring > foundRing + 1) break;
      for (let dr = -ring; dr <= ring; dr++) {
        for (let dc = -ring; dc <= ring; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
          // Passe quotidienne : cellules réduites aux bâtiments d'emploi ouverts et desservis (index déjà résolus).
          const jc = this.jobCells;
          const cc = c0 + dc, rr = r0 + dr;
          const pre = jc && cc >= 0 && rr >= 0 && cc < idx.cols && rr < idx.rows ? jc[rr * idx.cols + cc]! : null;
          const cell = pre ?? idx.cell(cc, rr);
          for (let k = 0; k < cell.length; k++) {
            const j = pre ? cell[k]! : b.indexOf(cell[k]!);
            if (j < 0 || !b.roadAccess[j]) continue;
            const m = this.metaOfIndex(j);
            if (!m || m.jobCap - b.workers[j]! <= 0 || !this.jobOpen(j)) continue;
            const free = m.jobCap - b.workers[j]!;
            const dx = b.x[j]! - hx, dz = b.z[j]! - hz;
            const d = Math.sqrt(dx * dx + dz * dz);
            if (d > MAX_COMMUTE_M && (d > reach || !this.transitServes(homeId, b.id[j]!))) continue;
            const qualified = edu >= m.reqEdu;
            // Ligne agrégée : un emploi qui n'a pas assez de places pour tout le poids reste un repli partiel.
            if (free < w) { if (d < partialD) { partialD = d; partial = b.id[j]!; partialFree = free; } continue; }
            if (qualified) { if (d < bestD) { bestD = d; best = b.id[j]!; } }
            else if (d < fallbackD) { fallbackD = d; fallback = b.id[j]!; }
          }
        }
      }
      if ((best >= 0 || fallback >= 0) && foundRing < 0) foundRing = ring;
    }
    let found = best >= 0 ? best : fallback;
    let foundD = best >= 0 ? bestD : fallbackD;
    // Aucun emploi n'accueille tout le poids : le plus proche qui a des places, pour une partie du ménage agrégé.
    if (found < 0 && partial >= 0) { found = partial; foundD = partialD; this.jobPartialFree = partialFree; }
    if (found >= 0 && foundD > MAX_COMMUTE_M) this.transitHires++;
    return found;
  }

  /**
   * Cellules de l'index spatial réduites aux bâtiments d'emploi ouverts et desservis (index de bâtiment, ordre des
   * cellules conservé), construites au premier besoin de la passe quotidienne : la recherche d'emploi ne parcourt plus
   * les logements (la grande majorité des bâtiments). Mêmes candidats, même ordre : résultat identique.
   */
  private jobCells: number[][] | null = null;
  private prepareJobCells(): void {
    const idx = this.ctx.buildingIndex, b = this.ctx.buildings;
    const cells: number[][] = new Array(idx.cols * idx.rows);
    for (let r = 0; r < idx.rows; r++) {
      for (let col = 0; col < idx.cols; col++) {
        const src = idx.cell(col, r);
        const out: number[] = [];
        for (let k = 0; k < src.length; k++) {
          const j = b.indexOf(src[k]!);
          if (j < 0 || !b.roadAccess[j]) continue;
          const m = this.metaOfIndex(j);
          if (m && m.jobCap > 0 && this.jobOpen(j)) out.push(j);
        }
        cells[r * idx.cols + col] = out;
      }
    }
    this.jobCells = cells;
  }

  /** Places libres de l'emploi renvoyé par `findJob` quand il ne peut pas accueillir tout le poids (0 sinon). */
  private jobPartialFree = 0;
  /** Membres (index de citoyens) par ménage, construit à la demande pendant la passe quotidienne (découpes). */
  private memberIndex: Map<number, number[]> | null = null;

  /**
   * Découpe le ménage agrégé du citoyen d'index `ci` : un nouveau ménage de poids `f` (copie du ménage et de tous ses
   * membres) est détaché ; l'ancien garde le reste du poids. Totaux inchangés (habitants, emplois, élèves, ménages).
   * Renvoie l'index de la copie de `ci`. N'ajoute que des lignes (aucun index existant ne change).
   */
  private splitHousehold(ci: number, f: number): number {
    const c = this.citizens.col;
    const hid = c.household[ci]!;
    const hk = this.households.indexOf(hid);
    if (hk < 0) return ci;
    const hw = this.hhWeightOf(hk);
    if (f <= 0 || f >= hw) return ci;
    if (!this.memberIndex) {
      this.memberIndex = new Map();
      for (let i = 0; i < this.citizens.count; i++) {
        const h = c.household[i]!;
        const l = this.memberIndex.get(h);
        if (l) l.push(i); else this.memberIndex.set(h, [i]);
      }
    }
    const nid = this.nextHouseholdId++;
    const k2 = this.households.cloneRow(hk, nid);
    const hc = this.households.col;
    hc.weight[k2] = f > 1 ? f : 0;
    hc.weight[hk] = hw - f > 1 ? hw - f : 0;
    const clones: number[] = [];
    let out = ci;
    for (const m of this.memberIndex.get(hid) ?? []) {
      const n = this.citizens.cloneRow(m, this.nextCitizenId++);
      const cc = this.citizens.col;
      cc.household[n] = nid;
      cc.weight[n] = f > 1 ? f : 0;
      cc.weight[m] = hw - f > 1 ? hw - f : 0;
      this.aggRows += (f > 1 ? 1 : 0) + (hw - f > 1 ? 1 : 0) - 1;
      clones.push(n);
      if (m === ci) out = n;
    }
    this.memberIndex.set(nid, clones);
    return out;
  }

  private hire(ci: number, jobId: number): void {
    const c = this.citizens.col;
    const b = this.ctx.buildings;
    const j = b.indexOf(jobId);
    if (j < 0) return;
    const w = this.weightOf(ci);
    b.workers[j]! += w;
    c.job[ci] = jobId;
    const m = this.metaOfIndex(j)!;
    c.income[ci] = this.wageFor(m.sector, c.education[ci]!);
    this.updateCommute(ci);
    this.assignSchedule(ci);
    this.month.hires += w;
  }

  quitJob(ci: number): void {
    const c = this.citizens.col;
    const b = this.ctx.buildings;
    const j = b.indexOf(c.job[ci]!);
    if (j >= 0 && b.workers[j]! > 0) b.workers[j] = Math.max(0, b.workers[j]! - this.weightOf(ci));
    c.job[ci] = -1;
    c.income[ci] = 0;
    c.commute[ci] = 0;
  }

  /**
   * Écoles desservies (index de bâtiment, position, rayon, capacité), relevées une fois par passe quotidienne : la
   * recherche d'école d'un élève parcourt cette liste (quelques dizaines d'écoles) au lieu d'interroger l'index
   * spatial sur 7 km de côté, ce qui coûtait ≈ 400 ms par jour à 54 000 habitants quand les écoles sont pleines.
   * Même résultat que la requête d'origine : les rayons d'école (≤ 900 m amélioration comprise) sont bien inférieurs à
   * la demi-largeur de la zone interrogée (3 500 m) ; seul l'ordre entre deux écoles exactement équidistantes peut
   * différer.
   */
  private schools: { id: number; x: number; z: number; rad: number; cap: number }[] = [];
  private schoolsFree = 0;

  private prepareSchools(): void {
    const b = this.ctx.buildings;
    this.schools = [];
    this.schoolsFree = 0;
    for (let j = 0; j < b.count; j++) {
      if (!b.roadAccess[j]) continue;
      const m = this.metaOfIndex(j);
      if (!m || m.service !== Service.Education) continue;
      const id = b.id[j]!;
      const lvl = this.serviceLevel(id);
      const cap = (m.serviceCapacity > 0 ? m.serviceCapacity : 300) * (1 + 0.5 * (lvl - 1));
      this.schools.push({ id, x: b.x[j]!, z: b.z[j]!, rad: m.radius * (1 + 0.25 * (lvl - 1)), cap });
    }
  }

  /** École (service éducation) couvrant le logement et ayant de la place. */
  private findSchool(ci: number): number {
    const b = this.ctx.buildings;
    const hi = b.indexOf(this.citizens.col.home[ci]!);
    if (hi < 0) return -1;
    const hx = b.x[hi]!, hz = b.z[hi]!;
    let best = -1, bestD = Infinity;
    for (const s of this.schools) {
      if ((this.pupilsBySchool.get(s.id) ?? 0) + this.weightOf(ci) > s.cap) continue;
      const dx = s.x - hx, dz = s.z - hz;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d <= s.rad && d < bestD) { bestD = d; best = s.id; }
    }
    return best;
  }

  /* --------------------------- Cycle quotidien --------------------------- */

  private ensureHouseholdBuffers(): void {
    const cap = this.households.capacity;
    if (this.hhAdults.length < cap) {
      this.hhAdults = new Uint8Array(cap);
      this.hhFertile = new Uint8Array(cap);
      this.hhHappy = new Float32Array(cap);
      this.hhMembers = new Uint8Array(cap);
    }
  }

  /**
   * Journée : vieillissement, décès, retraite, scolarité, diplômes, recherche d'emploi,
   * revenus, bonheur, naissances, décohabitation.
   */
  daily(now: number, residentialTaxRate: number): void {
    // Couverture recalculée chaque jour : la capacité des équipements suit les habitants logés.
    this.coverageDirty = true;
    this.ensureCoverage();
    this.transitPrepare(now);
    this.prepareSchools();
    const c = this.citizens.col;
    const b = this.ctx.buildings;
    const rng = this.ctx.rng;
    const yesterday = now - MINUTES_PER_DAY;
    const healthy = (bi: number): boolean => bi >= 0 && this.coverage[Service.Health]![bi] === 1;
    let searches = 0, noReach = 0, unemployedNow = 0, laborNow = 0;
    // Emplois libres desservis : inutile de chercher quand il n'y en a aucun (coût CPU).
    let freeJobs = 0;
    for (let k = 0; k < b.count; k++) {
      const m = this.metaOfIndex(k);
      if (m && b.roadAccess[k] && this.jobOpen(k)) freeJobs += Math.max(0, m.jobCap - b.workers[k]!);
    }

    // 1) Décès (parcours à rebours : suppression par permutation sûre).
    for (let i = this.citizens.count - 1; i >= 0; i--) {
      const age = this.ageOf(i, now);
      const bi = b.indexOf(c.home[i]!);
      const sf = c.sick[i]! > 0 ? this.services.mortalityFactor(i, bi) : 1;
      const p = (annualMortality(age) * (healthy(bi) ? 0.7 : 1) * sf) / DAYS_PER_YEAR;
      if (rng.next() < p) { const w = this.weightOf(i); if (sf > 1) this.services.month.sickDeaths += w; this.removeCitizenAt(i); this.month.deaths += w; }
    }

    // 2) Transitions individuelles.
    // Âge franchi hier -> aujourd'hui (fonction hors de la boucle : pas de fermeture créée par citoyen).
    const crossed = (agePrev: number, age: number, y: number): boolean => agePrev < y && age >= y;
    for (let i = 0; i < this.citizens.count; i++) {
      const age = this.ageOf(i, now);
      const agePrev = (yesterday - c.birth[i]!) / MINUTES_PER_YEAR;
      const w = this.weightOf(i);
      // Retraite.
      if (c.job[i]! >= 0 && age >= RETIREMENT_AGE) { this.quitJob(i); c.income[i] = PENSION; this.assignSchedule(i); }
      if (age >= RETIREMENT_AGE && c.job[i]! < 0) c.income[i] = PENSION;
      // Scolarité.
      if (age >= SCHOOL_AGE_MIN && age < SCHOOL_AGE_MAX + 1) {
        if (c.school[i]! < 0) {
          const s = this.findSchool(i);
          if (s >= 0) { c.school[i] = s; this.pupilsBySchool.set(s, (this.pupilsBySchool.get(s) ?? 0) + w); this.updateCommute(i); this.assignSchedule(i); }
        }
        if (c.school[i]! >= 0) {
          if (crossed(agePrev, age, 11) && c.education[i]! < Education.Primary) c.education[i] = Education.Primary;
          if (crossed(agePrev, age, 16) && c.education[i]! < Education.Secondary) c.education[i] = Education.Secondary;
        }
      } else if (c.school[i]! >= 0 && age >= SCHOOL_AGE_MAX + 1) {
        // Fin de scolarité : baccalauréat pour 80 % des lycéens.
        if (c.education[i]! >= Education.Secondary && rng.chance(0.8)) c.education[i] = Education.Baccalaureate;
        this.pupilsBySchool.set(c.school[i]!, Math.max(0, (this.pupilsBySchool.get(c.school[i]!) ?? w) - w));
        c.school[i] = -1;
        c.commute[i] = 0;
        this.assignSchedule(i);
      }
      // Économie vivante : études supérieures (bachelier de 21 ans dont le quartier est couvert par l'éducation) et
      // formation continue des adultes sans emploi (moins de 45 ans, quartier couvert).
      if (crossed(agePrev, age, 21) && c.education[i] === Education.Baccalaureate) {
        const hb = b.indexOf(c.home[i]!);
        if (hb >= 0 && this.coverage[Service.Education]![hb] === 1 && rng.chance(this.living.tuning.probaSuperieur)) { c.education[i] = Education.Higher; this.living.month.graduates += w; }
      } else if (c.job[i]! < 0 && c.school[i]! < 0 && age >= WORKING_AGE_MIN && age < 45 && c.education[i]! < Education.Baccalaureate) {
        const hb = b.indexOf(c.home[i]!);
        if (hb >= 0 && this.coverage[Service.Education]![hb] === 1 && rng.next() < this.living.tuning.probaFormationAn / DAYS_PER_YEAR) {
          c.education[i] = Math.max(Education.Secondary, c.education[i]! + 1);
          this.living.month.graduates += w;
        }
      }
      // Recherche d'emploi.
      // Plafond en habitants réels : une ligne agrégée compte pour son poids.
      if (freeJobs > 0 && age >= WORKING_AGE_MIN && age < RETIREMENT_AGE && c.job[i]! < 0 && c.school[i]! < 0 && searches + w <= JOB_SEARCHES_PER_DAY) {
        searches += w;
        if (!this.jobCells) this.prepareJobCells();
        const j = this.findJob(i);
        if (j >= 0) {
          const f = this.jobPartialFree;
          if (f > 0) { this.hire(this.splitHousehold(i, f), j); freeJobs -= f; } else { this.hire(i, j); freeJobs -= w; }
        } else noReach += w;
      }
      // Poids relu : une découpe (emploi partiel) a pu le réduire ; la copie détachée est comptée à son tour.
      if (age >= WORKING_AGE_MIN && age < RETIREMENT_AGE && c.school[i]! < 0) { const wn = this.weightOf(i); laborNow += wn; if (c.job[i]! < 0) unemployedNow += wn; }
    }

    this.memberIndex = null;
    this.jobCells = null;
    this.jobNoReachDay = noReach; this.lastUnemployed = unemployedNow; this.lastLaborForce = laborNow;

    // 2 bis) Services : criminalité, risque d'incendie, santé des logements, délits du jour, maladies.
    this.services.daily(now);

    // 2 ter) Économie vivante : loyers, ressources et effort des ménages, statistiques du jour.
    this.living.assess(now, this.buildingsVersion);

    // 3) Bonheur + agrégats par ménage.
    this.ensureHouseholdBuffers();
    const nh = this.households.count;
    this.hhAdults.fill(0, 0, nh); this.hhFertile.fill(0, 0, nh); this.hhHappy.fill(0, 0, nh); this.hhMembers.fill(0, 0, nh);
    const taxPenalty = residentialTaxPenalty(residentialTaxRate);
    const pending: number[] = [];
    // Détail par facteur (rapport) ; états des réseaux et satisfaction des modules calculés une fois par logement.
    const fs = this.factorSum;
    fs.fill(0);
    const ramp = this.noServiceRamp();
    this.lastTaxRate = residentialTaxRate;
    const homeCache = new Map<number, Float64Array>();
    const homeParts = (bi: number): Float64Array => {
      const id = b.id[bi]!;
      let v = homeCache.get(id);
      if (v) return v;
      v = this.homePartsOf(bi, ramp, new Float64Array(7));
      homeCache.set(id, v);
      return v;
    };
    for (let i = 0; i < this.citizens.count; i++) {
      const age = this.ageOf(i, now);
      const bi = b.indexOf(c.home[i]!);
      const hkr = this.households.indexOf(c.household[i]!);
      let t = this.scoreCitizen(i, age, bi, hkr, ramp, taxPenalty, homeParts, fs, this.weightOf(i));
      t = t < 0 ? 0 : t > 100 ? 100 : t;
      c.happiness[i] = c.happiness[i]! * 0.8 + t * 0.2;
      const hk = hkr;
      if (hk >= 0) {
        this.hhMembers[hk]!++;
        this.hhHappy[hk]! += c.happiness[i]!;
        if (age >= 18) this.hhAdults[hk]!++;
        if (c.sex[i] === 0 && age >= 18 && age <= 42) this.hhFertile[hk] = 1;
      }
      // Décohabitation : jeunes adultes actifs vivant chez leurs parents.
      if (c.role[i] === Role.Child && age >= 20 && c.job[i]! >= 0 && rng.next() < 0.3 / DAYS_PER_YEAR) pending.push(c.id[i]!);
    }

    this.factorCount = this.popW;

    // 4) Naissances.
    for (let hk = 0; hk < nh; hk++) {
      if (!this.hhFertile[hk] || this.hhAdults[hk]! < 2) continue;
      const hid = this.households.col.id[hk]!;
      const home = this.households.col.home[hk]!;
      const bi = b.indexOf(home);
      const hw = this.hhWeightOf(hk);
      if (bi < 0 || this.freeHousingAt(bi) < hw || this.households.col.size[hk]! >= 7) continue;
      const happy = this.hhMembers[hk]! ? this.hhHappy[hk]! / this.hhMembers[hk]! : 50;
      const p = (0.09 * (0.5 + happy / 100)) / DAYS_PER_YEAR;
      if (rng.next() < p) {
        this.addCitizen(hid, home, rng.int(0, 1), 0, Education.None, Role.Child, now);
        this.addMember(hid);
        this.month.births += hw;
      }
    }

    // 5) Décohabitation (nouveau ménage dans un logement libre).
    if (pending.length) this.beginHousingCache();
    for (const cid of pending) {
      const i = this.citizens.indexOf(cid);
      if (i < 0) continue;
      const w = this.weightOf(i);
      const target = this.findHousing(w);
      if (target < 0) { if (w === 1) break; continue; }
      const oldHk = this.households.indexOf(c.household[i]!);
      const surname = oldHk >= 0 ? this.households.col.surname[oldHk]! : randomSurname(rng);
      const hid = this.newHousehold(target, surname, now, w);
      if (oldHk >= 0) this.households.col.size[oldHk]!--;
      const oi = b.indexOf(c.home[i]!);
      if (oi >= 0 && b.residents[oi]! > 0) b.residents[oi] = Math.max(0, b.residents[oi]! - w);
      const ti = b.indexOf(target);
      if (ti >= 0) b.residents[ti]! += w;
      c.household[i] = hid;
      c.home[i] = target;
      c.role[i] = Role.Adult;
      this.addMember(hid);
      this.updateCommute(i);
      this.month.householdsFormed += w;
    }

    this.housingCap = null;
    // 6) Économie vivante : ménages en difficulté durable -> logement moins cher, sinon départ (plafonnés).
    this.living.resolve(now);
  }

  /** Taux de l'impôt résidentiel du dernier calcul quotidien (fiche « Pourquoi » d'un bâtiment). */
  private lastTaxRate = 0;

  /**
   * Satisfaction apportée au logement d'index `bi` par les modules : électricité, eau, déchets, bruit, politiques, total
   * (`v[0..5]`), pénalités « sans réseau » comprises après la période de grâce.
   */
  private homePartsOf(bi: number, ramp: number, v: Float64Array): Float64Array {
    const id = this.ctx.buildings.id[bi]!;
    const parts = this.parts;
    parts.fill(0);
    if (this.serviceSatisfactionParts) { v[5] = this.serviceSatisfactionParts(id, parts); for (let k = 0; k < 5; k++) v[k] = parts[k]!; }
    else { const t = this.serviceSatisfaction(id); v[3] = t; v[5] = t; }
    // Sans électricité / sans eau (hors de tout réseau, y compris avant la première installation) : pénalité
    // progressive après la période de grâce du début de partie.
    if (ramp > 0) {
      if (this.powerState(id) === 2) { v[0]! -= NO_POWER_PENALTY * ramp; v[5]! -= NO_POWER_PENALTY * ramp; }
      if (this.waterState(id) === 2) { v[1]! -= NO_WATER_PENALTY * ramp; v[5]! -= NO_WATER_PENALTY * ramp; }
    }
    return v;
  }

  /**
   * Satisfaction cible d'un habitant (avant bornage 0..100) : chaque facteur est ajouté à la fois au total et à
   * `fs[facteur]`, dans un ordre fixe (calcul quotidien et fiche « Pourquoi » d'un bâtiment donnent les mêmes points).
   */
  private scoreCitizen(i: number, age: number, bi: number, hkr: number, ramp: number, taxPenalty: number, homeParts: (bi: number) => Float64Array, fs: Float64Array, w = 1): number {
    const c = this.citizens.col;
    const b = this.ctx.buildings;
    let t = 55;
    const add = (f: number, v: number): void => { t += v; fs[f]! += v * w; };
    if (bi < 0 || !b.roadAccess[bi]) add(F.logement, -30);
    if (age >= WORKING_AGE_MIN && age < RETIREMENT_AGE && c.school[i]! < 0) add(F.emploi, c.job[i]! >= 0 ? 12 : -18);
    // Emploi très en dessous de son niveau (supérieur dans un poste sans diplôme) : légère insatisfaction.
    if (c.job[i]! >= 0 && c.education[i] === Education.Higher) { const jm = this.metaOfIndex(b.indexOf(c.job[i]!)); if (jm && jm.reqTier === 0) add(F.emploi, -3); }
    // Coût du logement (effort du ménage), après la période de grâce.
    if (ramp > 0 && hkr >= 0) add(F.loyer, rentSatisfaction(this.living.tuning, this.living.burdenOf(hkr), ramp));
    if (bi >= 0) {
      const cov = this.coverage;
      if (age < 18) add(F.education, cov[Service.Education]![bi] ? 8 : -10);
      add(F.sante, cov[Service.Health]![bi] ? 7 : -7);
      add(F.police, cov[Service.Police]![bi] ? 5 : -5);
      add(F.pompiers, cov[Service.Fire]![bi] ? 5 : -5);
      // Services qui comptent : criminalité du logement, maladie, santé du logement, dégâts d'un incendie.
      const hid = b.id[bi]!;
      const st = this.services.tuning;
      const crime = this.services.crimeOf(hid);
      if (crime > 0) add(F.police, -(crime / 100) * st.crimeSatisfaction);
      if (c.sick[i]! > 0) add(F.sante, -st.maladieSatisfaction);
      const hl = ramp > 0 ? this.services.healthOf(hid) : -1;
      if (hl >= 0 && hl < 60) add(F.sante, -(60 - hl) * st.santeSatisfaction * ramp);
      if (this.services.isDamaged(hid)) add(F.pompiers, -st.feuSatisfaction);
      add(F.loisirs, cov[Service.Leisure]![bi] ? 6 : -2);
      add(F.equipements, Math.min(8, this.attractAt[bi]! * 2));
      add(F.pollution, -Math.min(20, this.pollutionAt[bi]! * 6));
      const hp = homeParts(bi);
      add(F.electricite, hp[0]!); add(F.eau, hp[1]!); add(F.dechets, hp[2]!); add(F.bruit, hp[3]!); add(F.politiques, hp[4]!);
    }
    add(F.trajet, -Math.min(15, c.commute[i]! / 400));
    // Bonne desserte en bus du logement (0 sans ligne).
    if (bi >= 0) { const tb = this.transitSatisfaction(b.id[bi]!); if (tb !== 0) add(F.trajet, tb); }
    add(F.impots, -taxPenalty);
    return t;
  }

  /**
   * Agrégats des habitants par bâtiment (index) pour les cartes d'information : bonheur, éducation des adultes
   * (0..4), actifs et chômeurs. Une passe sur les citoyens ; tampons réutilisés (lecture seule pour l'appelant).
   */
  residentAggregates(now: number): { happy: Float32Array; count: Uint32Array; eduSum: Float32Array; adults: Uint32Array; labor: Uint32Array; unemployed: Uint32Array } {
    const b = this.ctx.buildings;
    const n = b.count;
    const a = this.agg;
    if (a.happy.length < n) {
      const cap = Math.max(16, b.capacity);
      a.happy = new Float32Array(cap); a.count = new Uint32Array(cap); a.eduSum = new Float32Array(cap);
      a.adults = new Uint32Array(cap); a.labor = new Uint32Array(cap); a.unemployed = new Uint32Array(cap);
    }
    a.happy.fill(0, 0, n); a.count.fill(0, 0, n); a.eduSum.fill(0, 0, n); a.adults.fill(0, 0, n); a.labor.fill(0, 0, n); a.unemployed.fill(0, 0, n);
    const c = this.citizens.col;
    for (let i = 0; i < this.citizens.count; i++) {
      const bi = b.indexOf(c.home[i]!);
      if (bi < 0) continue;
      const w = this.weightOf(i);
      a.happy[bi]! += c.happiness[i]! * w;
      a.count[bi]! += w;
      const age = this.ageOf(i, now);
      if (age >= 18) { a.adults[bi]! += w; a.eduSum[bi]! += c.education[i]! * w; }
      if (age >= WORKING_AGE_MIN && age < RETIREMENT_AGE && c.school[i]! < 0) { a.labor[bi]! += w; if (c.job[i]! < 0) a.unemployed[bi]! += w; }
    }
    return a;
  }
  private agg = { happy: new Float32Array(0), count: new Uint32Array(0), eduSum: new Float32Array(0), adults: new Uint32Array(0), labor: new Uint32Array(0), unemployed: new Uint32Array(0) };

  /** Logement résidentiel (index) : places de logement du modèle (0 pour un bâtiment sans logement). */
  housingCapacityAt(bi: number): number { return this.metaOfIndex(bi)?.resCap ?? 0; }

  /* ------------------------------ Migrations ------------------------------ */

  /** Attractivité (0..1) : emplois disponibles, bonheur moyen, services, impôts, équipements remarquables. */
  computeAttractiveness(residentialTaxRate: number): number {
    const s = this.summary();
    const jobAvail = clamp01((s.jobsTotal - s.jobsFilled) / Math.max(10, s.unemployed + 10));
    const happy = s.population ? s.happinessSum / s.population : 60;
    let services = 0;
    for (let k = 0; k < SERVICE_COUNT; k++) services += s.covered[k]! / Math.max(1, s.population);
    services /= SERVICE_COUNT;
    // Économie vivante : une ville où beaucoup de ménages peinent à payer leur loyer attire moins.
    const distress = this.livingDistressShare();
    // Services qui comptent : criminalité moyenne et part de malades.
    const st = this.services.tuning;
    const safety = st.crimeAttractivite * this.services.averageCrime() / 100 + st.maladieAttractivite * (s.population ? this.services.sickCount / s.population : 0);
    const a = 0.3 + 0.25 * jobAvail + 0.2 * ((happy - 50) / 50) + 0.15 * services + Math.min(0.1, s.attractSum * 0.01) - residentialTaxAttraction(residentialTaxRate) - 0.1 * distress - safety;
    return clamp01(a);
  }

  private livingDistressShare(): number {
    const nh = this.households.count;
    if (!nh || this.living.ramp <= 0) return 0;
    let d = 0;
    const col = this.households.col;
    for (let k = 0; k < nh; k++) if (col.distressDays[k]! > 0) d += this.hhWeightOf(k);
    return d / Math.max(1, this.hhW);
  }

  /** Vague de migration (toutes les 6 h de jeu) : arrivées selon l'attractivité et les logements libres. */
  migrationWave(now: number, residentialTaxRate: number): number {
    this.ensureCoverage();
    this.attractiveness = this.computeAttractiveness(residentialTaxRate);
    const b = this.ctx.buildings;
    const rng = this.ctx.rng;
    let free = 0;
    // Logements sans électricité / sans eau (hors de tout réseau, après la période de grâce) : arrivées freinées.
    this.beginHousingCache();
    const hc = this.housingCap!;
    for (let i = 0; i < b.count; i++) { const f = hc[i]! - b.residents[i]!; if (f > 0) free += f * this.growthWeight(b.id[i]!); }
    if (free <= 0) { this.housingCap = null; return 0; }
    // Proportionnel aux logements libres, avec un flux de base pour qu'une petite ville naissante (quelques
    // maisons desservies) se peuple en un ou deux jours de jeu au lieu d'une semaine (recette QA phase 1).
    const expected = ((free / 2.6) * this.attractiveness * 0.3 + Math.min(1, free / 4) * this.attractiveness * 0.6) * this.immigrationFactor;
    let arrivals = Math.floor(expected) + (rng.next() < expected - Math.floor(expected) ? 1 : 0);
    arrivals = Math.min(arrivals, MAX_ARRIVALS_PER_WAVE);
    // Simulation agrégée : les arrivées (en ménages réels) forment arrivals / W ménages agrégés de poids W (arrondi
    // aléatoire sans biais). Hors simulation agrégée (W = 1), aucun tirage supplémentaire : partie identique.
    const W = this.newHouseholdWeight();
    let rows = arrivals;
    if (W > 1) rows = Math.floor(arrivals / W) + (rng.next() < arrivals / W - Math.floor(arrivals / W) ? 1 : 0);
    let placed = 0;
    for (let k = 0; k < rows; k++) {
      // Composition du ménage.
      const kind = rng.weighted([0.3, 0.25, 0.32, 0.06, 0.07]);
      let adults = kind === 0 || kind === 3 ? 1 : 2;
      let kids = kind === 2 ? rng.int(1, 3) : kind === 3 ? rng.int(1, 2) : 0;
      const retired = kind === 4;
      let hw = W;
      let target = this.findHousing((adults + kids) * hw);
      // Ménage agrégé sans bâtiment assez grand : poids réduit (la composition est conservée).
      while (target < 0 && hw > 1) { hw = Math.max(1, hw >> 1); target = this.findHousing((adults + kids) * hw); }
      while (target < 0 && kids > 0) { kids--; target = this.findHousing(adults + kids); }
      if (target < 0 && adults > 1) { adults = 1; target = this.findHousing(1); }
      if (target < 0) break;
      const surname = randomSurname(rng);
      const hid = this.newHousehold(target, surname, now, hw);
      const baseAge = retired ? rng.int(65, 82) : kids > 0 ? rng.int(28, 46) : rng.int(20, 58);
      for (let a = 0; a < adults; a++) {
        const sex = adults === 2 ? a : rng.int(0, 1);
        const age = Math.max(18, baseAge + (a === 0 ? 0 : rng.int(-4, 4)));
        const edu = rng.weighted([0.08, 0.12, 0.3, 0.25, 0.25]);
        this.addCitizen(hid, target, sex, age, edu, Role.Adult, now);
        this.addMember(hid);
      }
      for (let kk = 0; kk < kids; kk++) {
        const age = rng.int(0, Math.min(17, Math.max(0, baseAge - 18)));
        const edu = age >= 16 ? Education.Secondary : age >= 11 ? Education.Primary : Education.None;
        this.addCitizen(hid, target, rng.int(0, 1), age, edu, Role.Child, now);
        this.addMember(hid);
      }
      this.month.immigrants += (adults + kids) * hw;
      placed += hw;
    }
    this.housingCap = null;
    return placed;
  }

  /* -------------------------------- Mensuel -------------------------------- */

  /**
   * Clôture mensuelle démographique : émigration des ménages durablement mécontents,
   * comptes des entreprises, assiettes fiscales. Renvoie les assiettes pour l'économie.
   */
  monthly(now: number): { taxBase: Record<TaxSector, number>; serviceWorkers: number } {
    const c = this.citizens.col;
    // Émigration.
    this.ensureHouseholdBuffers();
    const nh = this.households.count;
    this.hhHappy.fill(0, 0, nh); this.hhMembers.fill(0, 0, nh);
    for (let i = 0; i < this.citizens.count; i++) {
      const hk = this.households.indexOf(c.household[i]!);
      if (hk >= 0) { this.hhHappy[hk]! += c.happiness[i]!; this.hhMembers[hk]!++; }
    }
    const leaving = new Set<number>();
    for (let hk = 0; hk < nh; hk++) {
      const avg = this.hhMembers[hk]! ? this.hhHappy[hk]! / this.hhMembers[hk]! : 50;
      if (avg < 30) this.households.col.unhappyMonths[hk]!++;
      else this.households.col.unhappyMonths[hk] = 0;
      if (this.households.col.unhappyMonths[hk]! >= 3) leaving.add(this.households.col.id[hk]!);
    }
    if (leaving.size) this.removeHouseholds(leaving, true);
    const tb = this.computeTaxBase(true, now);
    this.lastMonth = this.month;
    this.month = zeroCounters();
    this.living.closeMonth();
    this.services.closeMonth();
    return tb;
  }

  private wageBuf = new Float64Array(0);
  private underBuf = new Uint32Array(0);
  private sickBuf = new Uint32Array(0);

  /**
   * Assiettes fiscales mensuelles (et comptes des entreprises si `commit`). Économie vivante : le chiffre d'affaires
   * tient compte des employés sous-qualifiés (productivité réduite) et, pour un commerce, de sa clientèle locale
   * (évaluée à chaque clôture) ; le bénéfice déduit le loyer du local. À la clôture (`commit`), les entreprises
   * déficitaires depuis longtemps ferment et les locaux vacants peuvent être repris (`LivingEconomy.monthlyCompanies`).
   */
  computeTaxBase(commit = false, now = this.lastNow): { taxBase: Record<TaxSector, number>; serviceWorkers: number } {
    const b = this.ctx.buildings;
    const c = this.citizens.col;
    const L = this.living, t = L.tuning;
    const taxBase: Record<TaxSector, number> = { residential: 0, commercial: 0, industrial: 0, office: 0 };
    let householdIncome = 0;
    for (let i = 0; i < this.citizens.count; i++) householdIncome += c.income[i]! * this.weightOf(i);
    taxBase.residential = householdIncome * RES_TAXABLE_SHARE;
    let commercialWorkers = 0, serviceWorkers = 0, employedTotal = 0;
    for (let i = 0; i < b.count; i++) {
      employedTotal += b.workers[i]!;
      const m = this.metaOfIndex(i);
      if (!m) continue;
      if (m.sector === Sector.Commercial) commercialWorkers += b.workers[i]!;
      if (m.sector === Sector.Public) serviceWorkers += b.workers[i]!;
    }
    const customers = this.popW + WORKER_CUSTOMER_SHARE * employedTotal;
    const demandFactor = commercialWorkers > 0 ? Math.min(1.25, Math.max(0.25, customers / RESIDENTS_PER_COMMERCIAL_JOB / commercialWorkers)) : 1;
    L.globalCustomers = demandFactor;
    // Salaires effectifs et employés sous-qualifiés par index de bâtiment (sans allocation).
    const n = b.count;
    if (this.wageBuf.length < b.capacity) { this.wageBuf = new Float64Array(b.capacity); this.underBuf = new Uint32Array(b.capacity); }
    if (this.sickBuf.length < b.capacity) this.sickBuf = new Uint32Array(b.capacity);
    const wages = this.wageBuf, under = this.underBuf, sickW = this.sickBuf;
    wages.fill(0, 0, n); under.fill(0, 0, n); sickW.fill(0, 0, n);
    for (let i = 0; i < this.citizens.count; i++) {
      if (c.job[i]! < 0) continue;
      const j = b.indexOf(c.job[i]!);
      if (j < 0) continue;
      const w = this.weightOf(i);
      wages[j]! += c.income[i]! * w;
      const m = this.metaOfIndex(j);
      if (m && c.education[i]! < m.reqEdu) under[j]! += w;
      if (c.sick[i]! > 0) sickW[j]! += w;
    }
    L.refreshBuildings(this.buildingsVersion);
    const cc = this.companies.col;
    const isCommercial = (j: number): boolean => this.metaOfIndex(j)?.sector === Sector.Commercial;
    if (commit) L.prepareCustomers(WORKER_CUSTOMER_SHARE, isCommercial);
    const accounts: ({ workers: number; jobCap: number; under: number; customers: number; revenue: number; rent: number; profit: number } | null)[] = commit ? new Array(this.companies.count).fill(null) : [];
    for (let k = 0; k < this.companies.count; k++) {
      const id = cc.id[k]!;
      const bi = b.indexOf(id);
      if (bi < 0) continue;
      const m = this.metaOfIndex(bi);
      if (!m) continue;
      const sector = cc.sector[k]!;
      if (cc.status[k] === CompanyStatus.Closed) { if (commit) { cc.revenue[k] = 0; cc.profit[k] = 0; cc.rent[k] = 0; cc.tax[k] = 0; } continue; }
      const workers = b.workers[bi]!;
      if (commit && sector === Sector.Commercial) cc.customers[k] = L.localCustomers(bi, m, RESIDENTS_PER_COMMERCIAL_JOB);
      const cust = sector === Sector.Commercial ? (cc.customers[k]! > 0 ? 0.5 * demandFactor + 0.5 * cc.customers[k]! : demandFactor) : 1;
      // Malades absents : ils ne produisent pas (salaire maintenu).
      const present = Math.max(0, workers - sickW[bi]!);
      const effective = present - (1 - t.productiviteSousQualifie) * Math.min(present, under[bi]!);
      const revenue = effective * (REVENUE_PER_WORKER[sector] ?? 0) * cust;
      const rent = L.businessRentAt(bi, m);
      const profit = revenue - wages[bi]! - revenue * t.fraisGeneraux - rent;
      const tax = SECTOR_TAX[sector];
      const taxable = Math.max(0, profit) * COMPANY_TAXABLE_SHARE;
      if (tax) taxBase[tax] += taxable;
      if (commit) {
        cc.revenue[k] = revenue; cc.profit[k] = profit; cc.rent[k] = rent; cc.tax[k] = tax ? taxable * this.companyTaxRate(sector) : 0;
        accounts[k] = { workers, jobCap: m.jobCap, under: Math.min(workers, under[bi]!), customers: cust, revenue, rent, profit };
      }
    }
    if (commit) {
      const s = this.summary();
      let unemployedQualified = -1;
      const qualifiedUnemployed = (): number => {
        if (unemployedQualified >= 0) return unemployedQualified;
        unemployedQualified = 0;
        for (let i = 0; i < this.citizens.count; i++) {
          if (c.job[i]! >= 0 || c.school[i]! >= 0 || c.education[i]! < Education.Baccalaureate) continue;
          const age = this.ageOf(i, now);
          if (age >= WORKING_AGE_MIN && age < RETIREMENT_AGE) unemployedQualified += this.weightOf(i);
        }
        return unemployedQualified;
      };
      L.monthlyCompanies(now, (k) => accounts[k] ?? null, (k) => {
        // Reprise d'un local vacant : clientèle suffisante (commerce) ou main-d'œuvre disponible (industrie, bureaux).
        const bi = b.indexOf(cc.id[k]!);
        const m = bi >= 0 ? this.metaOfIndex(bi) : undefined;
        if (!m || !b.roadAccess[bi]) return false;
        if (cc.sector[k] === Sector.Commercial) return demandFactor >= 0.9;
        const need = Math.max(5, 0.2 * m.jobCap);
        return cc.sector[k] === Sector.Office ? qualifiedUnemployed() >= need : s.unemployed >= need;
      });
    }
    return { taxBase, serviceWorkers };
  }

  /* --------------------------- Emploi du temps --------------------------- */

  /** Activité d'un citoyen à une minute du jour donnée (fonction pure de son emploi du temps). */
  activityAt(i: number, mod: number, weekend: boolean): number {
    const c = this.citizens.col;
    const wake = c.wake[i]!, sleep = c.sleep[i]!;
    if (mod < wake || mod >= sleep) return Activity.Sleep;
    // Malade : reste chez lui (ni travail, ni école, ni loisirs).
    if (c.sick[i]! > 0) return Activity.Home;
    const commuteMin = Math.min(90, 5 + Math.round(c.commute[i]! / 450));
    const start = c.workStart[i]!, end = c.workEnd[i]!;
    if (c.job[i]! >= 0 && !weekend) {
      if (mod < start - commuteMin) return Activity.Home;
      if (mod < start) return Activity.CommuteOut;
      if (mod < end) return mod >= 720 && mod < 780 ? Activity.Break : Activity.Work;
      if (mod < end + commuteMin) return Activity.CommuteBack;
      // Loisirs en soirée un jour sur trois environ (dépend de l'id : stable).
      if ((c.id[i]! * 2654435761) % 3 === 0 && mod >= end + commuteMin + 30 && mod < end + commuteMin + 150) return Activity.Leisure;
      return Activity.Home;
    }
    if (c.school[i]! >= 0 && !weekend) {
      if (mod < start - commuteMin) return Activity.Home;
      if (mod < start) return Activity.CommuteOut;
      if (mod < end) return Activity.School;
      if (mod < end + commuteMin) return Activity.CommuteBack;
      return Activity.Home;
    }
    // Inactifs, retraités, week-end : sortie de loisirs selon les horaires personnels.
    const ls = weekend && c.job[i]! >= 0 ? 870 : start;
    const le = weekend && c.job[i]! >= 0 ? 1020 : end;
    if (mod >= ls && mod < le) return Activity.Leisure;
    return Activity.Home;
  }

  /** Recalcule le LOD de simulation de chaque citoyen (distance du logement au point focal). */
  updateLod(): void {
    const c = this.citizens.col;
    const b = this.ctx.buildings;
    const d1 = LOD_DETAILED_M * LOD_DETAILED_M, d2 = LOD_SIMPLIFIED_M * LOD_SIMPLIFIED_M;
    for (let i = 0; i < this.citizens.count; i++) {
      const bi = b.indexOf(c.home[i]!);
      let lod: number = SimLod.Statistical;
      if (bi >= 0) {
        const dx = b.x[bi]! - this.focusX, dz = b.z[bi]! - this.focusZ;
        const d = dx * dx + dz * dz;
        lod = d <= d1 ? SimLod.Detailed : d <= d2 ? SimLod.Simplified : SimLod.Statistical;
        // Ligne agrégée : pas de trajet individuel (la demande statistique du trafic la couvre).
        if (lod === SimLod.Detailed && c.weight[i]! > 1) lod = SimLod.Simplified;
      }
      if (lod === SimLod.Statistical) c.activity[i] = Activity.Unknown;
      c.lod[i] = lod;
    }
  }

  setFocus(x: number, z: number): void {
    this.focusX = x;
    this.focusZ = z;
    this.updateLod();
  }

  private pushTrip(citizen: number, from: number, to: number, purpose: number, minute: number): void {
    if (from < 0 || to < 0 || from === to) return;
    if (this.tripCount === TRIP_QUEUE_CAPACITY) { this.tripHead = (this.tripHead + 1) % TRIP_QUEUE_CAPACITY; this.tripCount--; }
    const k = (this.tripHead + this.tripCount) % TRIP_QUEUE_CAPACITY;
    this.tripCitizen[k] = citizen;
    this.tripFrom[k] = from;
    this.tripTo[k] = to;
    this.tripPurpose[k] = purpose;
    this.tripMinute[k] = minute;
    this.tripCount++;
    this.tripsEmitted++;
  }

  /** Défile au plus `max` demandes de trajet ; `cb(citoyen, depuis, vers, motif)`. */
  drainTrips(max: number, cb: (citizen: number, from: number, to: number, purpose: number) => void): number {
    let n = 0;
    while (this.tripCount > 0 && n < max) {
      const k = this.tripHead;
      cb(this.tripCitizen[k]!, this.tripFrom[k]!, this.tripTo[k]!, this.tripPurpose[k]!);
      this.tripHead = (this.tripHead + 1) % TRIP_QUEUE_CAPACITY;
      this.tripCount--;
      n++;
    }
    return n;
  }

  /** Tick : emplois du temps selon le LOD ; trajets individuels pour le LOD détaillé. Sans allocation. */
  tick(now: number): void {
    this.tickCounter++;
    const c = this.citizens.col;
    const mod = Math.floor(now % MINUTES_PER_DAY);
    const weekend = isWeekend(now);
    const phase = this.tickCounter % SIMPLIFIED_EVERY_TICKS;
    for (let i = 0; i < this.citizens.count; i++) {
      const lod = c.lod[i]!;
      if (lod === SimLod.Statistical) continue;
      if (lod === SimLod.Simplified && (i % SIMPLIFIED_EVERY_TICKS) !== phase) continue;
      const prev = c.activity[i]!;
      const next = this.activityAt(i, mod, weekend);
      if (next === prev) continue;
      c.activity[i] = next;
      if (lod !== SimLod.Detailed) continue;
      const home = c.home[i]!;
      const dest = c.job[i]! >= 0 ? c.job[i]! : c.school[i]!;
      if (next === Activity.CommuteOut) this.pushTrip(c.id[i]!, home, dest, c.job[i]! >= 0 ? TripPurpose.Work : TripPurpose.School, now);
      else if (next === Activity.CommuteBack) this.pushTrip(c.id[i]!, dest, home, TripPurpose.Home, now);
      else if (next === Activity.Leisure || (prev === Activity.Leisure && next === Activity.Home)) {
        const bi = this.ctx.buildings.indexOf(home);
        const venue = bi >= 0 && bi < this.leisureTarget.length && !this.coverageDirty ? this.leisureTarget[bi]! : -1;
        if (venue >= 0) {
          if (next === Activity.Leisure) this.pushTrip(c.id[i]!, home, venue, TripPurpose.Leisure, now);
          else this.pushTrip(c.id[i]!, venue, home, TripPurpose.Home, now);
        }
      }
    }
  }

  /* ------------------------------ Statistiques ------------------------------ */

  private summary(): { population: number; jobsTotal: number; jobsFilled: number; unemployed: number; happinessSum: number; covered: number[]; attractSum: number } {
    const b = this.ctx.buildings;
    let jobsTotal = 0, jobsFilled = 0, attractSum = 0;
    for (let i = 0; i < b.count; i++) {
      const m = this.metaOfIndex(i);
      if (!m) continue;
      if (b.roadAccess[i] && this.jobOpen(i)) jobsTotal += m.jobCap;
      jobsFilled += b.workers[i]!;
      if (b.roadAccess[i]) attractSum += m.attract;
    }
    const c = this.citizens.col;
    let unemployed = 0, happinessSum = 0;
    const covered = [0, 0, 0, 0, 0];
    const now = this.lastNow;
    const covOk = !this.coverageDirty;
    for (let i = 0; i < this.citizens.count; i++) {
      const age = this.ageOf(i, now);
      const w = this.weightOf(i);
      if (age >= WORKING_AGE_MIN && age < RETIREMENT_AGE && c.job[i]! < 0 && c.school[i]! < 0) unemployed += w;
      happinessSum += c.happiness[i]! * w;
      if (covOk) {
        const bi = b.indexOf(c.home[i]!);
        if (bi >= 0) for (let k = 0; k < SERVICE_COUNT; k++) covered[k]! += this.coverage[k]![bi]! * w;
      }
    }
    return { population: this.popW, jobsTotal, jobsFilled, unemployed, happinessSum, covered, attractSum };
  }

  /** Dernière date connue (pour les âges dans les statistiques). */
  lastNow = 0;

  report(now: number, residentialTaxRate: number): DemographyReport {
    this.lastNow = now;
    this.ensureCoverage();
    const c = this.citizens.col;
    const b = this.ctx.buildings;
    const ageBands = new Array<number>(9).fill(0);
    const education = [0, 0, 0, 0, 0];
    let children = 0, adults = 0, seniors = 0, laborForce = 0, employed = 0, pupils = 0, retirees = 0, incomeSum = 0, earners = 0;
    let happinessSum = 0, pollutionSum = 0;
    const covered = [0, 0, 0, 0, 0];
    const acts: Record<number, number> = {};
    const lod = { detailed: 0, simplified: 0, statistical: 0 };
    const mod = Math.floor(now % MINUTES_PER_DAY);
    const weekend = isWeekend(now);
    let statSeen = 0;
    for (let i = 0; i < this.citizens.count; i++) {
      const age = this.ageOf(i, now);
      const w = this.weightOf(i);
      ageBands[Math.min(8, Math.floor(age / 10))]! += w;
      if (age < 18) children += w; else if (age < RETIREMENT_AGE) adults += w; else seniors += w;
      if (age >= 18) education[c.education[i]!]! += w;
      if (age >= WORKING_AGE_MIN && age < RETIREMENT_AGE && c.school[i]! < 0) { laborForce += w; if (c.job[i]! >= 0) employed += w; }
      if (c.job[i]! >= 0 && age >= RETIREMENT_AGE) employed += w;
      if (c.school[i]! >= 0) pupils += w;
      if (age >= RETIREMENT_AGE) retirees += w;
      if (c.income[i]! > 0) { incomeSum += c.income[i]! * w; earners += w; }
      happinessSum += c.happiness[i]! * w;
      const bi = b.indexOf(c.home[i]!);
      if (bi >= 0) {
        for (let k = 0; k < SERVICE_COUNT; k++) covered[k]! += this.coverage[k]![bi]! * w;
        pollutionSum += this.pollutionAt[bi]! * w;
      }
      const l = c.lod[i]!;
      if (l === SimLod.Detailed) lod.detailed += w;
      else if (l === SimLod.Simplified) lod.simplified += w;
      else lod.statistical += w;
      if (l !== SimLod.Statistical) acts[c.activity[i]!] = (acts[c.activity[i]!] ?? 0) + w;
      else if (statSeen++ % STATISTICAL_SAMPLE === 0) {
        const a = this.activityAt(i, mod, weekend);
        acts[a] = (acts[a] ?? 0) + STATISTICAL_SAMPLE * w;
      }
    }
    const pop = this.popW;
    let jobsTotal = 0, jobsFilled = 0, housingCapacity = 0, housingFree = 0;
    let commercialJobs = 0, freeIndustrial = 0, freeOffice = 0;
    for (let i = 0; i < b.count; i++) {
      const m = this.metaOfIndex(i);
      if (!m) continue;
      if (b.roadAccess[i]) {
        if (this.jobOpen(i)) jobsTotal += m.jobCap;
        housingCapacity += m.resCap;
        housingFree += Math.max(0, m.resCap - b.residents[i]!);
        if (m.sector === Sector.Commercial) commercialJobs += m.jobCap;
        const open = this.living.isOpen(b.id[i]!);
        if (m.sector === Sector.Industrial && open) freeIndustrial += Math.max(0, m.jobCap - b.workers[i]!);
        if (m.sector === Sector.Office && open) freeOffice += Math.max(0, m.jobCap - b.workers[i]!);
      }
      jobsFilled += b.workers[i]!;
    }
    const unemployed = laborForce - Math.min(laborForce, employed);
    const qualified = education[3]! + education[4]!;
    const activities: Record<string, number> = {};
    for (const [k, v] of Object.entries(acts)) activities[ACTIVITY_NAMES_FR[Number(k)] ?? k] = v;
    const services: Record<string, number> = {};
    SERVICE_NAMES_FR.forEach((n, k) => { services[n] = pop ? covered[k]! / pop : 0; });
    const freeJobs = jobsTotal - jobsFilled;
    // Logements vides par raison, indice de croissance bloquée.
    const ramp = this.noServiceRamp();
    const vacancyReasons: VacancyReasons = { sansAcces: 0, sansEau: 0, sansElectricite: 0, loyerEleve: 0, demandeFaible: 0 };
    // Logement trop cher : loyer d'un ménage moyen au-delà de la part soutenable des ressources moyennes (après la grâce).
    const living = this.living.report((r) => this.closureName(r.id, r.name), (m) => Math.floor(m / MINUTES_PER_DAY));
    const rentCap = living && ramp > 0 && living.householdIncomeAverage > 0 ? (this.living.tuning.partSoutenable * living.householdIncomeAverage) / 1.05 : Infinity;
    let resBuildings = 0;
    for (let i = 0; i < b.count; i++) {
      const m = this.metaOfIndex(i);
      if (!m || m.resCap <= 0) continue;
      resBuildings++;
      if (b.residents[i]! > 0) continue;
      const id = b.id[i]!;
      const ws = this.waterState(id), ps = this.powerState(id);
      if (!b.roadAccess[i]) vacancyReasons.sansAcces++;
      else if (ws === 1 || (ws === 2 && ramp > 0)) vacancyReasons.sansEau++;
      else if (ps === 1 || (ps === 2 && ramp > 0)) vacancyReasons.sansElectricite++;
      else if (i < this.living.rentUnit.length && this.living.rentUnit[i]! > rentCap) vacancyReasons.loyerEleve++;
      else vacancyReasons.demandeFaible++;
    }
    const demandR = clampS((freeJobs - housingFree * 0.5) / Math.max(50, jobsTotal * 0.2) + (this.attractiveness - 0.5));
    const lots = this.residentialLots();
    const blocked = Math.max(3, resBuildings * 0.2);
    let growthHint: GrowthHint = null;
    if (!this.hasRoads()) growthHint = 'need-roads';
    else if (vacancyReasons.sansEau >= blocked) growthHint = 'need-water';
    else if (vacancyReasons.sansElectricite >= blocked) growthHint = 'need-power';
    else if (!lots || lots.zoned === 0) growthHint = pop === 0 || (lots?.demand ?? demandR) > 0.2 ? 'need-zones' : null;
    else if (lots.free === 0 && (lots.demand > 0.3 || demandR > 0.3) && housingFree <= Math.max(4, housingCapacity * 0.03)) growthHint = 'need-roads';
    // Économie vivante (pleine pression à moitié installée, ville d'au moins 150 habitants).
    if (growthHint === null && living && ramp >= 0.5 && pop >= 150) {
      const ed = living.education;
      const skilledWorkers = ed.workers[1]! + ed.workers[2]!;
      if (living.distressShare > 0.12) growthHint = 'high-rent';
      else if (laborForce > 0 && unemployed / laborForce > 0.15) growthHint = 'need-jobs';
      else if (skilledWorkers >= 20 && ed.underqualified / skilledWorkers > 0.35) growthHint = 'need-education';
    }
    // Transports en commun : routes saturées, chômage dû au manque d'accès (module « bus »).
    // Le chômage dû au manque d'accès passe avant « créez des emplois » (les emplois existent, hors de portée).
    const transitHint = this.extraGrowthHint();
    if (transitHint && (growthHint === null || (transitHint === 'need-transit' && growthHint === 'need-jobs'))) growthHint = transitHint;
    const fc = Math.max(1, this.factorCount);
    const satisfactionFactors = SATISFACTION_FACTORS.map(([key, label], k) => ({ key, label, delta: Math.round((this.factorSum[k]! / fc) * 10) / 10 }));
    return {
      population: pop, households: this.hhW, children, adults, seniors, ageBands, education,
      educationNames: EDUCATION_NAMES_FR, laborForce, employed, unemployed,
      unemploymentRate: laborForce ? unemployed / laborForce : 0, pupils, retirees, jobsTotal, jobsFilled,
      housingCapacity, housingFree, happiness: pop ? happinessSum / pop : 0, averageIncome: earners ? incomeSum / earners : 0,
      services, pollution: pop ? pollutionSum / pop : 0,
      attractiveness: this.computeAttractiveness(residentialTaxRate),
      demand: {
        residential: clampS((freeJobs - housingFree * 0.5) / Math.max(50, jobsTotal * 0.2) + (this.attractiveness - 0.5)),
        commercial: clampS(((pop + WORKER_CUSTOMER_SHARE * jobsFilled) / RESIDENTS_PER_COMMERCIAL_JOB - commercialJobs) / Math.max(20, pop * 0.02)),
        industrial: clampS((unemployed - freeIndustrial) / Math.max(20, laborForce * 0.05)),
        office: clampS((Math.min(unemployed, qualified) - freeOffice) / Math.max(20, laborForce * 0.05)),
      },
      month: { ...this.month }, lastMonth: { ...this.lastMonth }, activities, lod,
      tripsEmitted: this.tripsEmitted, companies: this.companies.count,
      satisfactionFactors, vacancyReasons, growthHint, living,
      cityServices: this.services.report(now),
    };
  }

  /** Nom d'une entreprise (modèle du bâtiment + nom du propriétaire). */
  private closureName(buildingId: number, surname: number): string {
    const bi = this.ctx.buildings.indexOf(buildingId);
    const asset = bi >= 0 ? this.ctx.catalog.assets[this.ctx.buildings.assetIndex[bi]!] : undefined;
    return `${asset?.nameFr ?? 'Entreprise'} ${fullName(1, 0, surname).split(' ').slice(1).join(' ')}`.trim();
  }

  /* ------------------------------ Inspection ------------------------------ */

  citizenInfo(i: number, now: number): CitizenInfo {
    const c = this.citizens.col;
    const hk = this.households.indexOf(c.household[i]!);
    const surname = hk >= 0 ? this.households.col.surname[hk]! : 0;
    const age = this.ageOf(i, now);
    const status = c.job[i]! >= 0 ? 'Actif occupé' : c.school[i]! >= 0 ? 'Élève' : age < SCHOOL_AGE_MIN ? 'Jeune enfant'
      : age >= RETIREMENT_AGE ? 'Retraité' : age < WORKING_AGE_MIN ? 'Sans école (aucune place)' : 'Demandeur d\'emploi';
    return {
      id: c.id[i]!, name: fullName(c.sex[i]!, c.firstName[i]!, surname), age: Math.floor(age),
      education: EDUCATION_NAMES_FR[c.education[i]!] ?? '?', householdId: c.household[i]!, homeBuildingId: c.home[i]!,
      jobBuildingId: c.job[i]!, schoolBuildingId: c.school[i]!, income: Math.round(c.income[i]!), happiness: Math.round(c.happiness[i]!),
      activity: ACTIVITY_NAMES_FR[c.lod[i] === SimLod.Statistical ? this.activityAt(i, Math.floor(now % MINUTES_PER_DAY), isWeekend(now)) : c.activity[i]!] ?? '?',
      status,
      schedule: { wake: hhmm(c.wake[i]!), workStart: hhmm(c.workStart[i]!), workEnd: hhmm(c.workEnd[i]!), sleep: hhmm(c.sleep[i]!) },
    };
  }

  inspectBuilding(id: number, now: number, limit = 40): BuildingOccupancy | null {
    const b = this.ctx.buildings;
    const bi = b.indexOf(id);
    if (bi < 0) return null;
    this.ensureCoverage();
    const m = this.metaOfIndex(bi)!;
    const occupants: CitizenInfo[] = [];
    const employees: CitizenInfo[] = [];
    const c = this.citizens.col;
    // Fiche « Pourquoi » : facteurs de satisfaction de TOUS les habitants (même calcul que le jour), chômage, qualification.
    const ramp = this.noServiceRamp();
    const fsum = new Float64Array(FACTOR_COUNT);
    const hp = this.homePartsOf(bi, ramp, new Float64Array(7));
    const taxPenalty = residentialTaxPenalty(this.lastTaxRate);
    let scored = 0, labor = 0, unemployed = 0, under = 0;
    for (let i = 0; i < this.citizens.count; i++) {
      if (c.home[i] === id) {
        if (occupants.length < limit) occupants.push(this.citizenInfo(i, now));
        const age = this.ageOf(i, now);
        const w = this.weightOf(i);
        this.scoreCitizen(i, age, bi, this.households.indexOf(c.household[i]!), ramp, taxPenalty, () => hp, fsum, w);
        scored += w;
        if (age >= WORKING_AGE_MIN && age < RETIREMENT_AGE && c.school[i]! < 0) { labor += w; if (c.job[i]! < 0) unemployed += w; }
      }
      if (c.job[i] === id) {
        if (employees.length < limit) employees.push(this.citizenInfo(i, now));
        if (c.education[i]! < m.reqEdu) under += this.weightOf(i);
      }
    }
    let burdenSum = 0, burdenN = 0;
    for (let hk = 0; hk < this.households.count; hk++) if (this.households.col.home[hk] === id) { const hw = this.hhWeightOf(hk); burdenSum += this.living.burdenOf(hk) * hw; burdenN += hw; }
    let vacancy: keyof VacancyReasons | null = null;
    if (m.resCap > 0 && b.residents[bi] === 0) {
      const ws = this.waterState(id), ps = this.powerState(id);
      const inc = this.living.householdIncomeAverage;
      const rentCap = ramp > 0 && inc > 0 ? (this.living.tuning.partSoutenable * inc) / 1.05 : Infinity;
      vacancy = !b.roadAccess[bi] ? 'sansAcces' : ws === 1 || (ws === 2 && ramp > 0) ? 'sansEau' : ps === 1 || (ps === 2 && ramp > 0) ? 'sansElectricite'
        : bi < this.living.rentUnit.length && this.living.rentUnit[bi]! > rentCap ? 'loyerEleve' : 'demandeFaible';
    }
    const k = this.companies.indexOf(id);
    const sectorNames = SECTOR_FR;
    const asset = this.ctx.catalog.assets[b.assetIndex[bi]!];
    const cc = this.companies.col;
    const statusOf = (st: number): 'active' | 'difficulty' | 'closed' => (st === CompanyStatus.Closed ? 'closed' : st === CompanyStatus.Difficulty ? 'difficulty' : 'active');
    let distressHh = 0;
    for (let hk = 0; hk < this.households.count; hk++) if (this.households.col.home[hk] === id && this.households.col.distressDays[hk]! > 0) distressHh += this.hhWeightOf(hk);
    const L = this.living;
    const economy = bi < L.land.length && L.land[bi]! > 0
      ? { landValue: Math.round(L.land[bi]! * 100), rent: Math.round(L.rentUnit[bi]!), householdsInDistress: distressHh } : undefined;
    return {
      buildingId: id, residents: b.residents[bi]!, residentCapacity: m.resCap, workers: b.workers[bi]!, jobCapacity: m.jobCap,
      roadAccess: b.roadAccess[bi] === 1,
      company: k >= 0 ? {
        name: `${asset?.nameFr ?? 'Entreprise'} ${fullName(1, 0, this.companies.col.ownerSurname[k]!).split(' ').slice(1).join(' ')}`,
        sector: sectorNames[this.companies.col.sector[k]!] ?? '?',
        revenue: Math.round(this.companies.col.revenue[k]!), profit: Math.round(this.companies.col.profit[k]!),
        rent: Math.round(cc.rent[k]!), tax: Math.round(cc.tax[k]!), status: statusOf(cc.status[k]!),
        reason: cc.reason[k]! > 0 ? CLOSURE_REASONS[cc.reason[k]!]?.[1] ?? null : null, lossMonths: cc.lossMonths[k]!,
      } : null,
      ...(economy ? { economy } : {}),
      ...(() => { const sf = this.services.inspect(id, now); return sf ? { safety: sf } : {}; })(),
      diagnosis: {
        factors: scored ? SATISFACTION_FACTORS.map(([key, label], f) => ({ key, label, delta: Math.round((fsum[f]! / scored) * 10) / 10 })) : [],
        vacancy, power: this.powerState(id), water: this.waterState(id), ramp: Math.round(ramp * 100) / 100,
        rentBurden: burdenN ? Math.round((burdenSum / burdenN) * 1000) / 1000 : null, sustainableShare: this.living.tuning.partSoutenable,
        labor, unemployed, cityUnemployed: this.lastUnemployed, jobsOffered: m.jobCap > 0 && this.jobOpen(bi),
        underqualified: under, requiredEducation: m.jobCap > 0 && m.reqEdu > 0 ? EDUCATION_NAMES_FR[m.reqEdu] ?? null : null,
        customers: k >= 0 && cc.sector[k] === Sector.Commercial && cc.customers[k]! > 0 ? Math.round(cc.customers[k]! * 100) / 100 : null,
        rentShare: k >= 0 && cc.revenue[k]! > 0 ? Math.round((cc.rent[k]! / cc.revenue[k]!) * 1000) / 1000 : null,
        reasonKey: k >= 0 && cc.reason[k]! > 0 ? CLOSURE_REASONS[cc.reason[k]!]?.[0] ?? null : null,
        transit: Math.round(this.transitSatisfaction(id) * 10) / 10,
      },
      services: SERVICE_NAMES_FR.filter((_, s) => this.coverage[s]![bi] === 1),
      occupants, employees,
    };
  }

  /* ------------------------------ Sauvegarde ------------------------------ */

  toJSON(): DemographyJSON {
    const citizens = this.citizens.toJSON(), households = this.households.toJSON();
    // Colonne `weight` écrite seulement si la simulation agrégée est active (sinon sauvegarde identique à l'ancienne).
    if (this.aggRows === 0 && !households.weight?.some((v) => v > 1)) { delete citizens.weight; delete households.weight; }
    return {
      nextCitizenId: this.nextCitizenId, nextHouseholdId: this.nextHouseholdId,
      citizens, households, companies: this.companies.toJSON(),
      month: { ...this.month }, lastMonth: { ...this.lastMonth }, attractiveness: this.attractiveness, tripsEmitted: this.tripsEmitted,
      living: this.living.toJSON(),
      services: this.services.toJSON(),
    };
  }

  /**
   * Restaure la population. Les compteurs d'occupation des bâtiments (residents/workers) et
   * les effectifs scolaires sont RECALCULÉS à partir des citoyens (pas de double source de vérité).
   */
  fromJSON(j: DemographyJSON, now: number): void {
    this.reset();
    this.nextCitizenId = j.nextCitizenId;
    this.nextHouseholdId = j.nextHouseholdId;
    this.citizens.fromJSON(j.citizens);
    this.households.fromJSON(j.households);
    this.companies.fromJSON(j.companies);
    this.month = { ...zeroCounters(), ...j.month };
    this.lastMonth = { ...zeroCounters(), ...j.lastMonth };
    this.attractiveness = j.attractiveness;
    this.tripsEmitted = j.tripsEmitted;
    // Économie vivante : champ absent des anciennes sauvegardes -> valeurs neuves (colonnes nouvelles à 0).
    this.living.fromJSON(j.living);
    this.recount();
    // Services : champ absent des anciennes sauvegardes -> criminalité nulle, aucun feu, montée propre après chargement.
    this.services.fromJSON(j.services, now);
    this.lastNow = now;
    this.updateLod();
  }

  /** Recalcule occupation des bâtiments et effectifs scolaires depuis les citoyens. */
  recount(): void {
    const b = this.ctx.buildings;
    for (let i = 0; i < b.count; i++) { b.residents[i] = 0; b.workers[i] = 0; }
    this.pupilsBySchool.clear();
    const c = this.citizens.col;
    this.popW = 0; this.aggRows = 0; this.hhW = 0;
    for (let k = 0; k < this.households.count; k++) this.hhW += this.hhWeightOf(k);
    for (let i = 0; i < this.citizens.count; i++) {
      const w = this.weightOf(i);
      this.popW += w;
      if (w > 1) this.aggRows++;
      const h = b.indexOf(c.home[i]!);
      if (h >= 0) b.residents[h]! += w;
      const j = b.indexOf(c.job[i]!);
      if (j >= 0) b.workers[j]! += w;
      if (c.school[i]! >= 0) this.pupilsBySchool.set(c.school[i]!, (this.pupilsBySchool.get(c.school[i]!) ?? 0) + w);
    }
    this.coverageDirty = true;
  }
}
