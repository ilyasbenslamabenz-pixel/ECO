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
  company: { name: string; sector: string; revenue: number; profit: number } | null;
  services: string[];
  occupants: CitizenInfo[];
  employees: CitizenInfo[];
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

  // Point focal (caméra) pour le LOD de simulation.
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

  constructor(private ctx: DemographyContext) {}

  setContext(ctx: DemographyContext): void { this.ctx = ctx; this.buildMeta(); }

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
      return {
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
    this.tripHead = 0;
    this.tripCount = 0;
    this.pupilsBySchool.clear();
    this.coverageDirty = true;
    this.tickCounter = 0;
  }

  get population(): number { return this.citizens.count; }

  private metaOfIndex(bi: number): AssetMeta | undefined { return this.meta[this.ctx.buildings.assetIndex[bi]!]; }

  ageOf(ci: number, now: number): number { return (now - this.citizens.col.birth[ci]!) / MINUTES_PER_YEAR; }

  /* ------------------------- Événements bâtiments ------------------------- */

  /** À appeler après l'insertion d'un bâtiment dans le store. */
  onBuildingAdded(id: number, now: number): void {
    this.coverageDirty = true;
    const bi = this.ctx.buildings.indexOf(id);
    const m = bi >= 0 ? this.metaOfIndex(bi) : undefined;
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
    const c = this.citizens.col;
    const leavingHouseholds = new Set<number>();
    const toRelocate = new Set<number>();
    for (let i = 0; i < this.citizens.count; i++) {
      if (c.job[i] === id) { c.job[i] = -1; c.income[i] = 0; c.commute[i] = 0; this.assignSchedule(i); }
      if (c.school[i] === id) { c.school[i] = -1; this.assignSchedule(i); }
      if (c.home[i] === id) toRelocate.add(c.household[i]!);
    }
    this.pupilsBySchool.delete(id);
    const bi = this.ctx.buildings.indexOf(id);
    if (bi >= 0) { this.ctx.buildings.residents[bi] = 0; this.ctx.buildings.workers[bi] = 0; }
    for (const hid of toRelocate) {
      const hk = this.households.indexOf(hid);
      if (hk < 0) continue;
      const size = this.households.col.size[hk]!;
      const target = this.findHousing(size, id);
      if (target >= 0) this.moveHousehold(hid, target, now);
      else leavingHouseholds.add(hid);
    }
    if (leavingHouseholds.size) this.removeHouseholds(leavingHouseholds, true);
    this.companies.remove(id);
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
      for (let k = 0; k < SERVICE_COUNT; k++) this.coverage.push(new Uint8Array(cap));
      this.pollutionAt = new Float32Array(cap);
      this.attractAt = new Float32Array(cap);
      this.leisureTarget = new Int32Array(cap);
    }
    for (let k = 0; k < SERVICE_COUNT; k++) this.coverage[k]!.fill(0, 0, n);
    this.pollutionAt.fill(0, 0, n);
    this.attractAt.fill(0, 0, n);
    this.leisureTarget.fill(-1, 0, n);
    const bestLeisure = new Float32Array(n).fill(Infinity);
    for (let s = 0; s < n; s++) {
      const m = this.metaOfIndex(s);
      if (!m || !b.roadAccess[s]) continue;
      const sx = b.x[s]!, sz = b.z[s]!;
      const affects = m.service >= 0 || m.attract > 0 || m.pollution > 0 || m.leisureVenue;
      if (!affects) continue;
      const R = Math.max(m.service >= 0 ? m.radius : 0, m.attract > 0 ? Math.max(m.radius, 800) : 0, m.pollution > 0 ? 400 : 0, m.leisureVenue ? 1500 : 0);
      this.ctx.buildingIndex.query(sx - R, sz - R, sx + R, sz + R, this.tmp);
      for (const id of this.tmp) {
        const j = b.indexOf(id);
        if (j < 0) continue;
        const dx = b.x[j]! - sx, dz = b.z[j]! - sz;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (m.service >= 0 && d <= m.radius) this.coverage[m.service]![j] = 1;
        if (m.attract > 0 && d <= Math.max(m.radius, 800)) this.attractAt[j]! += m.attract * (1 - d / Math.max(m.radius, 800));
        if (m.pollution > 0 && d <= 400) this.pollutionAt[j]! += m.pollution * (1 - d / 400) * this.pollutionFactor;
        if (m.leisureVenue && j !== s && d <= 1500 && d < bestLeisure[j]!) { bestLeisure[j] = d; this.leisureTarget[j] = b.id[s]!; }
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
  /** Filtres de croissance des modules (eau, électricité) : faux = le bâtiment n'accueille pas de nouveaux ménages. */
  growthGates: ((buildingId: number) => boolean)[] = [];

  private active(bi: number): boolean { return this.activity(this.ctx.buildings.id[bi]!) >= 1; }

  private freeHousingAt(bi: number): number {
    const m = this.metaOfIndex(bi);
    if (!m || m.resCap <= 0 || !this.ctx.buildings.roadAccess[bi]) return 0;
    if (this.growthGates.length) { const id = this.ctx.buildings.id[bi]!; for (const g of this.growthGates) if (!g(id)) return 0; }
    return Math.max(0, m.resCap - this.ctx.buildings.residents[bi]!);
  }

  /** Bâtiment (id) au hasard ayant au moins `size` places libres, -1 sinon. */
  private findHousing(size: number, excludeId = -1): number {
    const b = this.ctx.buildings;
    const cands = this.tmp2;
    cands.length = 0;
    for (let i = 0; i < b.count; i++) if (b.id[i] !== excludeId && this.freeHousingAt(i) >= size) cands.push(b.id[i]!);
    if (!cands.length) return -1;
    return cands[Math.floor(this.ctx.rng.next() * cands.length)]!;
  }

  private moveHousehold(hid: number, targetId: number, now: number): void {
    const b = this.ctx.buildings;
    const hk = this.households.indexOf(hid);
    if (hk < 0) return;
    const oldId = this.households.col.home[hk]!;
    const oi = b.indexOf(oldId);
    const ti = b.indexOf(targetId);
    const c = this.citizens.col;
    for (let i = 0; i < this.citizens.count; i++) {
      if (c.household[i] !== hid) continue;
      if (oi >= 0) b.residents[oi]!--;
      if (ti >= 0) b.residents[ti]!++;
      c.home[i] = targetId;
      this.updateCommute(i);
    }
    this.households.col.home[hk] = targetId;
    this.households.col.movedIn[hk] = Math.floor(now);
  }

  /** Retire des ménages entiers (émigration ou décès du dernier membre). */
  private removeHouseholds(ids: Set<number>, emigrate: boolean): void {
    for (let i = this.citizens.count - 1; i >= 0; i--) {
      if (ids.has(this.citizens.col.household[i]!)) {
        if (emigrate) this.month.emigrants++;
        this.removeCitizenAt(i, false);
      }
    }
    for (const id of ids) this.households.remove(id);
  }

  /** Supprime le citoyen d'index i (libère logement, emploi, école). */
  private removeCitizenAt(i: number, updateHousehold = true): void {
    const c = this.citizens.col;
    const b = this.ctx.buildings;
    const home = b.indexOf(c.home[i]!);
    if (home >= 0 && b.residents[home]! > 0) b.residents[home]!--;
    const job = b.indexOf(c.job[i]!);
    if (job >= 0 && b.workers[job]! > 0) b.workers[job]!--;
    if (c.school[i]! >= 0) this.pupilsBySchool.set(c.school[i]!, Math.max(0, (this.pupilsBySchool.get(c.school[i]!) ?? 1) - 1));
    if (updateHousehold) {
      const hk = this.households.indexOf(c.household[i]!);
      if (hk >= 0) {
        const s = --this.households.col.size[hk]!;
        if (s <= 0) this.households.remove(c.household[i]!);
      }
    }
    this.citizens.remove(c.id[i]!);
  }

  /* ------------------------------- Citoyens ------------------------------- */

  private addCitizen(householdId: number, homeId: number, sex: number, ageYears: number, education: number, role: number, now: number): number {
    const id = this.nextCitizenId++;
    const i = this.citizens.add(id);
    const c = this.citizens.col;
    const rng = this.ctx.rng;
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
    if (bi >= 0) this.ctx.buildings.residents[bi]!++;
    this.assignSchedule(i);
    return i;
  }

  private newHousehold(homeId: number, surname: number, now: number): number {
    const id = this.nextHouseholdId++;
    const k = this.households.add(id);
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
    const maxRing = Math.ceil(MAX_COMMUTE_M / idx.cellSize);
    const edu = c.education[ci]!;
    let best = -1, bestD = Infinity, fallback = -1, fallbackD = Infinity, foundRing = -1;
    for (let ring = 0; ring <= maxRing; ring++) {
      if (foundRing >= 0 && ring > foundRing + 1) break;
      for (let dr = -ring; dr <= ring; dr++) {
        for (let dc = -ring; dc <= ring; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
          const cell = idx.cell(c0 + dc, r0 + dr);
          for (let k = 0; k < cell.length; k++) {
            const j = b.indexOf(cell[k]!);
            if (j < 0 || !b.roadAccess[j]) continue;
            const m = this.metaOfIndex(j);
            if (!m || m.jobCap - b.workers[j]! <= 0 || !this.active(j)) continue;
            const dx = b.x[j]! - hx, dz = b.z[j]! - hz;
            const d = Math.sqrt(dx * dx + dz * dz);
            if (d > MAX_COMMUTE_M) continue;
            const qualified = m.sector === Sector.Office ? edu >= Education.Baccalaureate : m.sector === Sector.Public ? edu >= Education.Secondary : true;
            if (qualified) { if (d < bestD) { bestD = d; best = b.id[j]!; } }
            else if (d < fallbackD) { fallbackD = d; fallback = b.id[j]!; }
          }
        }
      }
      if ((best >= 0 || fallback >= 0) && foundRing < 0) foundRing = ring;
    }
    return best >= 0 ? best : fallback;
  }

  private hire(ci: number, jobId: number): void {
    const c = this.citizens.col;
    const b = this.ctx.buildings;
    const j = b.indexOf(jobId);
    if (j < 0) return;
    b.workers[j]!++;
    c.job[ci] = jobId;
    const m = this.metaOfIndex(j)!;
    c.income[ci] = this.wageFor(m.sector, c.education[ci]!);
    this.updateCommute(ci);
    this.assignSchedule(ci);
    this.month.hires++;
  }

  private quitJob(ci: number): void {
    const c = this.citizens.col;
    const b = this.ctx.buildings;
    const j = b.indexOf(c.job[ci]!);
    if (j >= 0 && b.workers[j]! > 0) b.workers[j]!--;
    c.job[ci] = -1;
    c.income[ci] = 0;
    c.commute[ci] = 0;
  }

  /** École (service éducation) couvrant le logement et ayant de la place. */
  private findSchool(ci: number): number {
    const b = this.ctx.buildings;
    const hi = b.indexOf(this.citizens.col.home[ci]!);
    if (hi < 0) return -1;
    const hx = b.x[hi]!, hz = b.z[hi]!;
    this.ctx.buildingIndex.query(hx - 3500, hz - 3500, hx + 3500, hz + 3500, this.tmp);
    let best = -1, bestD = Infinity;
    for (const id of this.tmp) {
      const j = b.indexOf(id);
      if (j < 0 || !b.roadAccess[j]) continue;
      const m = this.metaOfIndex(j);
      if (!m || m.service !== Service.Education) continue;
      const cap = m.serviceCapacity > 0 ? m.serviceCapacity : 300;
      if ((this.pupilsBySchool.get(id) ?? 0) >= cap) continue;
      const dx = b.x[j]! - hx, dz = b.z[j]! - hz;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d <= m.radius && d < bestD) { bestD = d; best = id; }
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
    this.ensureCoverage();
    const c = this.citizens.col;
    const b = this.ctx.buildings;
    const rng = this.ctx.rng;
    const yesterday = now - MINUTES_PER_DAY;
    const healthy = (bi: number): boolean => bi >= 0 && this.coverage[Service.Health]![bi] === 1;
    let searches = 0;
    // Emplois libres desservis : inutile de chercher quand il n'y en a aucun (coût CPU).
    let freeJobs = 0;
    for (let k = 0; k < b.count; k++) {
      const m = this.metaOfIndex(k);
      if (m && b.roadAccess[k] && this.active(k)) freeJobs += Math.max(0, m.jobCap - b.workers[k]!);
    }

    // 1) Décès (parcours à rebours : suppression par permutation sûre).
    for (let i = this.citizens.count - 1; i >= 0; i--) {
      const age = this.ageOf(i, now);
      const bi = b.indexOf(c.home[i]!);
      const p = (annualMortality(age) * (healthy(bi) ? 0.7 : 1)) / DAYS_PER_YEAR;
      if (rng.next() < p) { this.removeCitizenAt(i); this.month.deaths++; }
    }

    // 2) Transitions individuelles.
    for (let i = 0; i < this.citizens.count; i++) {
      const age = this.ageOf(i, now);
      const agePrev = (yesterday - c.birth[i]!) / MINUTES_PER_YEAR;
      const crossed = (y: number): boolean => agePrev < y && age >= y;
      // Retraite.
      if (c.job[i]! >= 0 && age >= RETIREMENT_AGE) { this.quitJob(i); c.income[i] = PENSION; this.assignSchedule(i); }
      if (age >= RETIREMENT_AGE && c.job[i]! < 0) c.income[i] = PENSION;
      // Scolarité.
      if (age >= SCHOOL_AGE_MIN && age < SCHOOL_AGE_MAX + 1) {
        if (c.school[i]! < 0) {
          const s = this.findSchool(i);
          if (s >= 0) { c.school[i] = s; this.pupilsBySchool.set(s, (this.pupilsBySchool.get(s) ?? 0) + 1); this.updateCommute(i); this.assignSchedule(i); }
        }
        if (c.school[i]! >= 0) {
          if (crossed(11) && c.education[i]! < Education.Primary) c.education[i] = Education.Primary;
          if (crossed(16) && c.education[i]! < Education.Secondary) c.education[i] = Education.Secondary;
        }
      } else if (c.school[i]! >= 0 && age >= SCHOOL_AGE_MAX + 1) {
        // Fin de scolarité : baccalauréat pour 80 % des lycéens.
        if (c.education[i]! >= Education.Secondary && rng.chance(0.8)) c.education[i] = Education.Baccalaureate;
        this.pupilsBySchool.set(c.school[i]!, Math.max(0, (this.pupilsBySchool.get(c.school[i]!) ?? 1) - 1));
        c.school[i] = -1;
        c.commute[i] = 0;
        this.assignSchedule(i);
      }
      // Recherche d'emploi.
      if (freeJobs > 0 && age >= WORKING_AGE_MIN && age < RETIREMENT_AGE && c.job[i]! < 0 && c.school[i]! < 0 && searches < JOB_SEARCHES_PER_DAY) {
        searches++;
        const j = this.findJob(i);
        if (j >= 0) { this.hire(i, j); freeJobs--; }
      }
    }

    // 3) Bonheur + agrégats par ménage.
    this.ensureHouseholdBuffers();
    const nh = this.households.count;
    this.hhAdults.fill(0, 0, nh); this.hhFertile.fill(0, 0, nh); this.hhHappy.fill(0, 0, nh); this.hhMembers.fill(0, 0, nh);
    const taxPenalty = (residentialTaxRate - 0.09) * 150;
    const pending: number[] = [];
    for (let i = 0; i < this.citizens.count; i++) {
      const age = this.ageOf(i, now);
      const bi = b.indexOf(c.home[i]!);
      let t = 55;
      if (bi < 0 || !b.roadAccess[bi]) t -= 30;
      if (age >= WORKING_AGE_MIN && age < RETIREMENT_AGE && c.school[i]! < 0) t += c.job[i]! >= 0 ? 12 : -18;
      if (bi >= 0) {
        const cov = this.coverage;
        if (age < 18) t += cov[Service.Education]![bi] ? 8 : -10;
        t += cov[Service.Health]![bi] ? 7 : -7;
        t += cov[Service.Police]![bi] ? 5 : -5;
        t += cov[Service.Fire]![bi] ? 5 : -5;
        t += cov[Service.Leisure]![bi] ? 6 : -2;
        t += Math.min(8, this.attractAt[bi]! * 2);
        t -= Math.min(20, this.pollutionAt[bi]! * 6);
        t += this.serviceSatisfaction(b.id[bi]!);
      }
      t -= Math.min(15, c.commute[i]! / 400);
      t -= taxPenalty;
      t = t < 0 ? 0 : t > 100 ? 100 : t;
      c.happiness[i] = c.happiness[i]! * 0.8 + t * 0.2;
      const hk = this.households.indexOf(c.household[i]!);
      if (hk >= 0) {
        this.hhMembers[hk]!++;
        this.hhHappy[hk]! += c.happiness[i]!;
        if (age >= 18) this.hhAdults[hk]!++;
        if (c.sex[i] === 0 && age >= 18 && age <= 42) this.hhFertile[hk] = 1;
      }
      // Décohabitation : jeunes adultes actifs vivant chez leurs parents.
      if (c.role[i] === Role.Child && age >= 20 && c.job[i]! >= 0 && rng.next() < 0.3 / DAYS_PER_YEAR) pending.push(c.id[i]!);
    }

    // 4) Naissances.
    for (let hk = 0; hk < nh; hk++) {
      if (!this.hhFertile[hk] || this.hhAdults[hk]! < 2) continue;
      const hid = this.households.col.id[hk]!;
      const home = this.households.col.home[hk]!;
      const bi = b.indexOf(home);
      if (bi < 0 || this.freeHousingAt(bi) < 1 || this.households.col.size[hk]! >= 7) continue;
      const happy = this.hhMembers[hk]! ? this.hhHappy[hk]! / this.hhMembers[hk]! : 50;
      const p = (0.09 * (0.5 + happy / 100)) / DAYS_PER_YEAR;
      if (rng.next() < p) {
        this.addCitizen(hid, home, rng.int(0, 1), 0, Education.None, Role.Child, now);
        this.addMember(hid);
        this.month.births++;
      }
    }

    // 5) Décohabitation (nouveau ménage dans un logement libre).
    for (const cid of pending) {
      const i = this.citizens.indexOf(cid);
      if (i < 0) continue;
      const target = this.findHousing(1);
      if (target < 0) break;
      const oldHk = this.households.indexOf(c.household[i]!);
      const surname = oldHk >= 0 ? this.households.col.surname[oldHk]! : randomSurname(rng);
      const hid = this.newHousehold(target, surname, now);
      if (oldHk >= 0) this.households.col.size[oldHk]!--;
      const oi = b.indexOf(c.home[i]!);
      if (oi >= 0 && b.residents[oi]! > 0) b.residents[oi]!--;
      const ti = b.indexOf(target);
      if (ti >= 0) b.residents[ti]!++;
      c.household[i] = hid;
      c.home[i] = target;
      c.role[i] = Role.Adult;
      this.addMember(hid);
      this.updateCommute(i);
      this.month.householdsFormed++;
    }
  }

  /* ------------------------------ Migrations ------------------------------ */

  /** Attractivité (0..1) : emplois disponibles, bonheur moyen, services, impôts, équipements remarquables. */
  computeAttractiveness(residentialTaxRate: number): number {
    const s = this.summary();
    const jobAvail = clamp01((s.jobsTotal - s.jobsFilled) / Math.max(10, s.unemployed + 10));
    const happy = s.population ? s.happinessSum / s.population : 60;
    let services = 0;
    for (let k = 0; k < SERVICE_COUNT; k++) services += s.covered[k]! / Math.max(1, s.population);
    services /= SERVICE_COUNT;
    const a = 0.3 + 0.25 * jobAvail + 0.2 * ((happy - 50) / 50) + 0.15 * services + Math.min(0.1, s.attractSum * 0.01) - (residentialTaxRate - 0.09) * 2;
    return clamp01(a);
  }

  /** Vague de migration (toutes les 6 h de jeu) : arrivées selon l'attractivité et les logements libres. */
  migrationWave(now: number, residentialTaxRate: number): number {
    this.ensureCoverage();
    this.attractiveness = this.computeAttractiveness(residentialTaxRate);
    const b = this.ctx.buildings;
    const rng = this.ctx.rng;
    let free = 0;
    for (let i = 0; i < b.count; i++) free += this.freeHousingAt(i);
    if (free <= 0) return 0;
    // Proportionnel aux logements libres, avec un flux de base pour qu'une petite ville naissante (quelques
    // maisons desservies) se peuple en un ou deux jours de jeu au lieu d'une semaine (recette QA phase 1).
    const expected = (free / 2.6) * this.attractiveness * 0.3 + Math.min(1, free / 4) * this.attractiveness * 0.6;
    let arrivals = Math.floor(expected) + (rng.next() < expected - Math.floor(expected) ? 1 : 0);
    arrivals = Math.min(arrivals, MAX_ARRIVALS_PER_WAVE);
    let placed = 0;
    for (let k = 0; k < arrivals; k++) {
      // Composition du ménage.
      const kind = rng.weighted([0.3, 0.25, 0.32, 0.06, 0.07]);
      let adults = kind === 0 || kind === 3 ? 1 : 2;
      let kids = kind === 2 ? rng.int(1, 3) : kind === 3 ? rng.int(1, 2) : 0;
      const retired = kind === 4;
      let target = this.findHousing(adults + kids);
      while (target < 0 && kids > 0) { kids--; target = this.findHousing(adults + kids); }
      if (target < 0 && adults > 1) { adults = 1; target = this.findHousing(1); }
      if (target < 0) break;
      const surname = randomSurname(rng);
      const hid = this.newHousehold(target, surname, now);
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
      this.month.immigrants += adults + kids;
      placed++;
    }
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
    const tb = this.computeTaxBase(true);
    this.lastMonth = this.month;
    this.month = zeroCounters();
    void now;
    return tb;
  }

  /** Assiettes fiscales mensuelles (et comptes des entreprises si `commit`). */
  computeTaxBase(commit = false): { taxBase: Record<TaxSector, number>; serviceWorkers: number } {
    const b = this.ctx.buildings;
    const c = this.citizens.col;
    const taxBase: Record<TaxSector, number> = { residential: 0, commercial: 0, industrial: 0, office: 0 };
    let householdIncome = 0;
    for (let i = 0; i < this.citizens.count; i++) householdIncome += c.income[i]!;
    taxBase.residential = householdIncome * RES_TAXABLE_SHARE;
    let commercialWorkers = 0, serviceWorkers = 0;
    for (let i = 0; i < b.count; i++) {
      const m = this.metaOfIndex(i);
      if (!m) continue;
      if (m.sector === Sector.Commercial) commercialWorkers += b.workers[i]!;
      if (m.sector === Sector.Public) serviceWorkers += b.workers[i]!;
    }
    let employedTotal = 0;
    for (let i = 0; i < b.count; i++) employedTotal += b.workers[i]!;
    const customers = this.citizens.count + WORKER_CUSTOMER_SHARE * employedTotal;
    const demandFactor = commercialWorkers > 0 ? Math.min(1.25, Math.max(0.25, customers / RESIDENTS_PER_COMMERCIAL_JOB / commercialWorkers)) : 1;
    // Salaires effectifs par bâtiment (somme des revenus des employés).
    const wagesByBuilding = new Map<number, number>();
    for (let i = 0; i < this.citizens.count; i++) {
      if (c.job[i]! >= 0) wagesByBuilding.set(c.job[i]!, (wagesByBuilding.get(c.job[i]!) ?? 0) + c.income[i]!);
    }
    for (let k = 0; k < this.companies.count; k++) {
      const id = this.companies.col.id[k]!;
      const bi = b.indexOf(id);
      if (bi < 0) continue;
      const sector = this.companies.col.sector[k]!;
      const workers = b.workers[bi]!;
      const revenue = workers * (REVENUE_PER_WORKER[sector] ?? 0) * (sector === Sector.Commercial ? demandFactor : 1);
      const wages = wagesByBuilding.get(id) ?? 0;
      const profit = revenue - wages - revenue * 0.1;
      const tax = SECTOR_TAX[sector];
      if (tax) taxBase[tax] += Math.max(0, profit) * COMPANY_TAXABLE_SHARE;
      if (commit) { this.companies.col.revenue[k] = revenue; this.companies.col.profit[k] = profit; }
    }
    return { taxBase, serviceWorkers };
  }

  /* --------------------------- Emploi du temps --------------------------- */

  /** Activité d'un citoyen à une minute du jour donnée (fonction pure de son emploi du temps). */
  activityAt(i: number, mod: number, weekend: boolean): number {
    const c = this.citizens.col;
    const wake = c.wake[i]!, sleep = c.sleep[i]!;
    if (mod < wake || mod >= sleep) return Activity.Sleep;
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
      if (b.roadAccess[i] && this.active(i)) jobsTotal += m.jobCap;
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
      if (age >= WORKING_AGE_MIN && age < RETIREMENT_AGE && c.job[i]! < 0 && c.school[i]! < 0) unemployed++;
      happinessSum += c.happiness[i]!;
      if (covOk) {
        const bi = b.indexOf(c.home[i]!);
        if (bi >= 0) for (let k = 0; k < SERVICE_COUNT; k++) covered[k]! += this.coverage[k]![bi]!;
      }
    }
    return { population: this.citizens.count, jobsTotal, jobsFilled, unemployed, happinessSum, covered, attractSum };
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
      ageBands[Math.min(8, Math.floor(age / 10))]!++;
      if (age < 18) children++; else if (age < RETIREMENT_AGE) adults++; else seniors++;
      if (age >= 18) education[c.education[i]!]!++;
      if (age >= WORKING_AGE_MIN && age < RETIREMENT_AGE && c.school[i]! < 0) { laborForce++; if (c.job[i]! >= 0) employed++; }
      if (c.job[i]! >= 0 && age >= RETIREMENT_AGE) employed++;
      if (c.school[i]! >= 0) pupils++;
      if (age >= RETIREMENT_AGE) retirees++;
      if (c.income[i]! > 0) { incomeSum += c.income[i]!; earners++; }
      happinessSum += c.happiness[i]!;
      const bi = b.indexOf(c.home[i]!);
      if (bi >= 0) {
        for (let k = 0; k < SERVICE_COUNT; k++) covered[k]! += this.coverage[k]![bi]!;
        pollutionSum += this.pollutionAt[bi]!;
      }
      const l = c.lod[i]!;
      if (l === SimLod.Detailed) lod.detailed++;
      else if (l === SimLod.Simplified) lod.simplified++;
      else lod.statistical++;
      if (l !== SimLod.Statistical) acts[c.activity[i]!] = (acts[c.activity[i]!] ?? 0) + 1;
      else if (statSeen++ % STATISTICAL_SAMPLE === 0) {
        const a = this.activityAt(i, mod, weekend);
        acts[a] = (acts[a] ?? 0) + STATISTICAL_SAMPLE;
      }
    }
    const pop = this.citizens.count;
    let jobsTotal = 0, jobsFilled = 0, housingCapacity = 0, housingFree = 0;
    let commercialJobs = 0, freeIndustrial = 0, freeOffice = 0;
    for (let i = 0; i < b.count; i++) {
      const m = this.metaOfIndex(i);
      if (!m) continue;
      if (b.roadAccess[i]) {
        if (this.active(i)) jobsTotal += m.jobCap;
        housingCapacity += m.resCap;
        housingFree += Math.max(0, m.resCap - b.residents[i]!);
        if (m.sector === Sector.Commercial) commercialJobs += m.jobCap;
        if (m.sector === Sector.Industrial) freeIndustrial += Math.max(0, m.jobCap - b.workers[i]!);
        if (m.sector === Sector.Office) freeOffice += Math.max(0, m.jobCap - b.workers[i]!);
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
    return {
      population: pop, households: this.households.count, children, adults, seniors, ageBands, education,
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
    };
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
    for (let i = 0; i < this.citizens.count; i++) {
      if (c.home[i] === id && occupants.length < limit) occupants.push(this.citizenInfo(i, now));
      if (c.job[i] === id && employees.length < limit) employees.push(this.citizenInfo(i, now));
    }
    const k = this.companies.indexOf(id);
    const sectorNames: Record<number, string> = { 1: 'Commerce', 2: 'Industrie', 3: 'Bureaux', 4: 'Service public' };
    const asset = this.ctx.catalog.assets[b.assetIndex[bi]!];
    return {
      buildingId: id, residents: b.residents[bi]!, residentCapacity: m.resCap, workers: b.workers[bi]!, jobCapacity: m.jobCap,
      roadAccess: b.roadAccess[bi] === 1,
      company: k >= 0 ? {
        name: `${asset?.nameFr ?? 'Entreprise'} ${fullName(1, 0, this.companies.col.ownerSurname[k]!).split(' ').slice(1).join(' ')}`,
        sector: sectorNames[this.companies.col.sector[k]!] ?? '?',
        revenue: Math.round(this.companies.col.revenue[k]!), profit: Math.round(this.companies.col.profit[k]!),
      } : null,
      services: SERVICE_NAMES_FR.filter((_, s) => this.coverage[s]![bi] === 1),
      occupants, employees,
    };
  }

  /* ------------------------------ Sauvegarde ------------------------------ */

  toJSON(): DemographyJSON {
    return {
      nextCitizenId: this.nextCitizenId, nextHouseholdId: this.nextHouseholdId,
      citizens: this.citizens.toJSON(), households: this.households.toJSON(), companies: this.companies.toJSON(),
      month: { ...this.month }, lastMonth: { ...this.lastMonth }, attractiveness: this.attractiveness, tripsEmitted: this.tripsEmitted,
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
    this.recount();
    this.lastNow = now;
    this.updateLod();
  }

  /** Recalcule occupation des bâtiments et effectifs scolaires depuis les citoyens. */
  recount(): void {
    const b = this.ctx.buildings;
    for (let i = 0; i < b.count; i++) { b.residents[i] = 0; b.workers[i] = 0; }
    this.pupilsBySchool.clear();
    const c = this.citizens.col;
    for (let i = 0; i < this.citizens.count; i++) {
      const h = b.indexOf(c.home[i]!);
      if (h >= 0) b.residents[h]!++;
      const j = b.indexOf(c.job[i]!);
      if (j >= 0) b.workers[j]!++;
      if (c.school[i]! >= 0) this.pupilsBySchool.set(c.school[i]!, (this.pupilsBySchool.get(c.school[i]!) ?? 0) + 1);
    }
    this.coverageDirty = true;
  }
}
