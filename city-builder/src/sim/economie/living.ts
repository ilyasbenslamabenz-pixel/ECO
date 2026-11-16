/**
 * Économie vivante (vague 1) : valeur foncière et loyers, ressources et difficultés des ménages (déménagement vers
 * un logement moins cher, puis départ de la ville), comptes complets des entreprises (clientèle locale, loyer,
 * qualification, impôt), fermetures avec raison consultable et reprise des locaux vacants, statistiques d'emploi
 * par quartier et d'adéquation éducation / emploi.
 *
 * Appelé par la démographie (qui possède les tables citoyens / ménages / entreprises) :
 *  - `assess` chaque jour, après les transitions individuelles : valeur foncière et loyer de chaque bâtiment,
 *    ressources et effort de chaque ménage, jours de difficulté, statistiques (quartiers, éducation) ;
 *  - `resolve` en fin de journée : déménagements vers moins cher, départs (plafonnés) ;
 *  - `companyAccounts` dans le calcul des assiettes (quotidien, sans effet) et `monthlyCompanies` à la clôture
 *    mensuelle (pertes, fermetures, reprises).
 * La pression est progressive : rampe « sans service » de la démographie (30 j de grâce + 30 j de montée).
 * Coût : O(bâtiments + citoyens + ménages) par jour, une requête spatiale par commerce et par mois. Aucune boucle O(n²).
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { MINUTES_PER_DAY } from '../clock';
import type { BuildingStore, ChunkIndex } from '../ecs';
import type { CitizenTable, CompanyTable, HouseholdTable } from '../population';
import type { Rng } from '../rng';
import {
  CLOSURE_REASONS, CompanyStatus, DEFAULT_LIVING_TUNING, EDU_TIERS_FR, Reason, SECTOR_FR,
  businessRent, distressThreshold, dwellingRent, eduTier, householdSizeFactor, landValueIndex, marketFactor,
  type LivingTuning,
} from './tuning';

/** Métadonnées d'un modèle utiles à l'économie (sous-ensemble de celles de la démographie). */
export interface LivingMeta {
  resCap: number;
  jobCap: number;
  sector: number;
  radius: number;
  /** Niveau du bâtiment (1 à 3). */
  level: number;
  /** Niveau d'éducation simplifié exigé par les emplois (0 à 2). */
  reqTier: number;
}

/** Ce que la démographie expose à l'économie vivante (mêmes objets, aucune copie). */
export interface LivingHost {
  readonly ctx: { buildings: BuildingStore; buildingIndex: ChunkIndex; rng: Rng };
  readonly citizens: CitizenTable;
  readonly households: HouseholdTable;
  readonly companies: CompanyTable;
  livingMeta(bi: number): LivingMeta | undefined;
  /** Nombre de services couverts (0..5), équipements remarquables et pollution subie au bâtiment d'index `bi`. */
  amenitiesAt(bi: number): { services: number; attract: number; pollution: number };
  /** Places libres d'un logement (filtres des réseaux compris). */
  freeHousingAt(bi: number): number;
  moveHousehold(hid: number, targetId: number, now: number): void;
  removeHouseholds(ids: Set<number>, emigrate: boolean): void;
  quitJob(ci: number): void;
  assignSchedule(ci: number): void;
  ageOf(ci: number, now: number): number;
  randomOwner(): number;
  /** Rampe de pression (0 pendant la période de grâce, 1 ensuite). */
  noServiceRamp(): number;
  /** Décalage de valeur foncière de la grille municipale au bâtiment (indice, ±0,3). */
  landValueOffset(buildingId: number): number;
  /** Quartier d'un bâtiment (secteur du joueur) ; null : îlot de la grille de 500 m. */
  districtOf(buildingId: number): { key: number; name: string } | null;
  /** Taux d'imposition d'un secteur d'entreprise (1 commerce, 2 industrie, 3 bureaux). */
  companyTaxRate(sector: number): number;
  /** Simulation agrégée : habitants représentés par une ligne de citoyen, ménages par une ligne de ménage, ménages réels. */
  weightOf(ci: number): number;
  hhWeightOf(hk: number): number;
  readonly householdCount: number;
}

export interface LivingCounters { relocations: number; departuresRent: number; closures: number; reopenings: number; graduates: number }
export interface ClosureRecord { id: number; name: number; sector: number; reason: number; minute: number }

export interface LivingDistrict { name: string; population: number; laborForce: number; unemployed: number; rate: number; rent: number }
export interface LivingReport {
  /** Rampe de pression (0 : période de grâce ; 1 : pleine pression). */
  pressure: number;
  rentAverage: number;
  /** Effort moyen : loyer / ressources du ménage. */
  rentBurden: number;
  householdIncomeAverage: number;
  householdsInDistress: number;
  distressShare: number;
  /** Valeur foncière moyenne des logements occupés (indice, 100 = référence). */
  landValueAverage: number;
  businessRentAverage: number;
  companiesActive: number;
  companiesInDifficulty: number;
  companiesClosed: number;
  /** Locaux vacants par raison de fermeture, entreprises en difficulté par raison. */
  closureReasons: { key: string; label: string; count: number }[];
  difficultyReasons: { key: string; label: string; count: number }[];
  recentClosures: { name: string; sector: string; reason: string; day: number }[];
  jobsVacant: number;
  /** Production perdue faute de personnel (part des postes vacants des entreprises ouvertes). */
  vacancyRate: number;
  districts: LivingDistrict[];
  education: { tiers: string[]; adults: number[]; jobs: number[]; workers: number[]; underqualified: number; overqualified: number; mismatchShare: number };
  month: LivingCounters;
  lastMonth: LivingCounters;
}

export interface LivingJSON { v: 1; closures: ClosureRecord[]; month: LivingCounters; lastMonth: LivingCounters }

const zero = (): LivingCounters => ({ relocations: 0, departuresRent: 0, closures: 0, reopenings: 0, graduates: 0 });
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const WORK_MIN = 18, WORK_MAX = 64;
const GRID_M = 500;
/** Case de la grille de clientèle des commerces (m). */
const CELL_M = 100;
const MAX_LOG = 24;

/** Nom d'îlot de la grille de 500 m (colonne en lettre, rangée en chiffre). */
export function gridName(cx: number, cz: number): string {
  const col = Math.max(0, Math.min(25, cx + 13));
  return `Îlot ${String.fromCharCode(65 + col)}${cz + 14}`;
}

export class LivingEconomy {
  tuning: LivingTuning = { ...DEFAULT_LIVING_TUNING };
  month: LivingCounters = zero();
  lastMonth: LivingCounters = zero();
  closures: ClosureRecord[] = [];
  /** Bâtiments (id) dont l'entreprise est fermée : leurs emplois ne sont pas offerts. */
  readonly closed = new Set<number>();

  // Par index de bâtiment (recalculé chaque jour, ou quand les bâtiments changent).
  land = new Float32Array(0);
  rentUnit = new Float32Array(0);
  private builtVersion = -1;
  private lastRamp = 0;
  // Par index de ménage (calcul du jour).
  private hhRes = new Float64Array(0);
  private hhBurden = new Float32Array(0);
  private pending: { hid: number; res: number; size: number; rent: number; days: number; w?: number }[] = [];
  private stats: LivingReport | null = null;
  /** Facteur de clientèle de la ville entière (commerces), calculé avec les assiettes. */
  globalCustomers = 1;

  constructor(private readonly host: LivingHost) {}

  reset(): void {
    this.month = zero();
    this.lastMonth = zero();
    this.closures = [];
    this.closed.clear();
    this.builtVersion = -1;
    this.pending = [];
    this.stats = null;
    this.globalCustomers = 1;
  }

  /** Entreprise du bâtiment ouverte (emplois offerts). */
  isOpen(buildingId: number): boolean { return this.closed.size === 0 || !this.closed.has(buildingId); }

  /* ------------------------------ Valeur foncière ------------------------------ */

  /** Valeur foncière et loyer de chaque bâtiment (si les bâtiments ont changé depuis le dernier calcul, ou `force`). */
  refreshBuildings(version: number, force = false): void {
    if (!force && version === this.builtVersion) return;
    this.builtVersion = version;
    const b = this.host.ctx.buildings;
    const n = b.count;
    if (this.land.length < b.capacity) { this.land = new Float32Array(b.capacity); this.rentUnit = new Float32Array(b.capacity); }
    let cap = 0, free = 0;
    for (let i = 0; i < n; i++) {
      const m = this.host.livingMeta(i);
      this.land[i] = 0; this.rentUnit[i] = 0;
      if (!m || (m.resCap <= 0 && (m.jobCap <= 0 || m.sector === 4))) continue;
      const a = this.host.amenitiesAt(i);
      this.land[i] = landValueIndex(a.services, a.attract, a.pollution, this.host.landValueOffset(b.id[i]!));
      if (m.resCap > 0 && b.roadAccess[i]) { cap += m.resCap; free += Math.max(0, m.resCap - b.residents[i]!); }
    }
    const market = marketFactor(this.tuning, cap > 0 ? free / cap : this.tuning.vacanceCible);
    for (let i = 0; i < n; i++) {
      const m = this.host.livingMeta(i);
      if (m && m.resCap > 0 && this.land[i]! > 0) this.rentUnit[i] = dwellingRent(this.tuning, this.land[i]!, m.level, market);
    }
  }

  /** Effort (loyer / ressources) du ménage d'index `hk` au dernier calcul quotidien (0 si inconnu). */
  burdenOf(hk: number): number { return hk >= 0 && hk < this.hhBurden.length ? this.hhBurden[hk]! : 0; }

  /* ------------------------------ Journée ------------------------------ */

  /**
   * Calcul quotidien : loyers, ressources et effort des ménages, jours de difficulté, statistiques. Prépare la liste
   * des ménages qui chercheront un logement moins cher ou quitteront la ville (`resolve`). Ne déplace personne.
   */
  assess(now: number, version: number): void {
    const h = this.host, t = this.tuning;
    const ramp = h.noServiceRamp();
    this.lastRamp = ramp;
    this.refreshBuildings(version, true);
    const b = h.ctx.buildings, c = h.citizens.col, hh = h.households;
    const nh = hh.count;
    if (this.hhRes.length < hh.capacity) { this.hhRes = new Float64Array(hh.capacity); this.hhBurden = new Float32Array(hh.capacity); }
    this.hhRes.fill(0, 0, nh);
    this.hhBurden.fill(0, 0, nh);
    // Quartiers : clé par bâtiment résidentiel.
    const districtIdx = new Map<number, number>();
    const dNames: string[] = [];
    const dPop: number[] = [], dLf: number[] = [], dUn: number[] = [], dRent: number[] = [], dHh: number[] = [];
    const keyOf = new Int32Array(b.count).fill(-1);
    const districtOfIndex = (bi: number): number => {
      if (bi < 0) return -1;
      if (keyOf[bi]! >= 0) return keyOf[bi]!;
      const id = b.id[bi]!;
      const d = h.districtOf(id);
      let key: number, name: string;
      if (d) { key = d.key; name = d.name; } else {
        const cx = Math.floor(b.x[bi]! / GRID_M), cz = Math.floor(b.z[bi]! / GRID_M);
        key = -1_000_000 - ((cx + 500) * 1000 + (cz + 500));
        name = gridName(cx, cz);
      }
      let k = districtIdx.get(key);
      if (k === undefined) { k = dNames.length; districtIdx.set(key, k); dNames.push(name); dPop.push(0); dLf.push(0); dUn.push(0); dRent.push(0); dHh.push(0); }
      keyOf[bi] = k;
      return k;
    };
    // Éducation : adultes par niveau simplifié, emplois et employés par niveau exigé, inadéquations.
    const adults = [0, 0, 0], jobs = [0, 0, 0], workersByTier = [0, 0, 0];
    let under = 0, over = 0, employed = 0;
    for (let i = 0; i < h.citizens.count; i++) {
      const hk = hh.indexOf(c.household[i]!);
      const age = h.ageOf(i, now);
      const bi = b.indexOf(c.home[i]!);
      const dk = districtOfIndex(bi);
      // Ligne agrégée : statistiques pondérées ; les ressources restent celles d'UN ménage représentatif.
      const w = h.weightOf(i);
      if (dk >= 0) dPop[dk]! += w;
      if (hk >= 0) this.hhRes[hk]! += c.income[i]!;
      const working = age >= WORK_MIN && age < WORK_MAX && c.school[i]! < 0;
      if (working) {
        if (dk >= 0) dLf[dk]! += w;
        if (c.job[i]! < 0) { if (hk >= 0) this.hhRes[hk]! += t.allocationChomage; if (dk >= 0) dUn[dk]! += w; }
      }
      if (age >= WORK_MIN) adults[eduTier(c.education[i]!)]! += w;
      if (c.job[i]! >= 0) {
        const j = b.indexOf(c.job[i]!);
        const m = j >= 0 ? h.livingMeta(j) : undefined;
        if (m) {
          const tier = eduTier(c.education[i]!);
          employed += w;
          workersByTier[m.reqTier]! += w;
          if (tier < m.reqTier) under += w;
          else if (tier >= m.reqTier + 2) over += w;
        }
      }
    }
    // Ménages : loyer, effort, jours de difficulté.
    const threshold = distressThreshold(t, ramp);
    const col = hh.col;
    let rentSum = 0, resSum = 0, burdenSum = 0, rented = 0, distress = 0, landSum = 0, landN = 0;
    this.pending = [];
    for (let k = 0; k < nh; k++) {
      const bi = b.indexOf(col.home[k]!);
      const unit = bi >= 0 ? this.rentUnit[bi]! : 0;
      const rent = unit * householdSizeFactor(col.size[k]!);
      col.rent[k] = rent;
      const res = this.hhRes[k]!;
      const burden = rent > 0 ? rent / Math.max(100, res) : 0;
      this.hhBurden[k] = burden;
      const hw = h.hhWeightOf(k);
      if (rent > 0) {
        rented += hw; rentSum += rent * hw; resSum += res * hw; burdenSum += Math.min(2, burden) * hw;
        landSum += this.land[bi]! * hw; landN += hw;
        const dk = districtOfIndex(bi);
        if (dk >= 0) { dRent[dk]! += rent * hw; dHh[dk]! += hw; }
      }
      if (ramp > 0 && rent > 0 && burden > threshold) {
        col.distressDays[k] = Math.min(60_000, col.distressDays[k]! + 1);
        distress += hw;
        if (col.distressDays[k]! >= t.joursAvantDemenagement) this.pending.push({ hid: col.id[k]!, res, size: col.size[k]!, rent: unit, days: col.distressDays[k]!, w: hw });
      } else col.distressDays[k] = Math.max(0, col.distressDays[k]! - 3);
    }
    // Les plus anciennes difficultés d'abord (départs plafonnés).
    this.pending.sort((p, q) => q.days - p.days || p.hid - q.hid);
    // Emplois par niveau exigé (entreprises ouvertes, desservies) et postes vacants.
    let jobsOpen = 0, filled = 0;
    for (let i = 0; i < b.count; i++) {
      const m = h.livingMeta(i);
      if (!m || m.jobCap <= 0 || !b.roadAccess[i] || !this.isOpen(b.id[i]!)) continue;
      jobs[m.reqTier]! += m.jobCap;
      if (m.sector !== 4) { jobsOpen += m.jobCap; filled += Math.min(m.jobCap, b.workers[i]!); }
    }
    // Entreprises (état du dernier mois clos).
    const cc = h.companies.col;
    const reasonsClosed = new Array<number>(CLOSURE_REASONS.length).fill(0);
    const reasonsDiff = new Array<number>(CLOSURE_REASONS.length).fill(0);
    let active = 0, diff = 0, closedN = 0, bRent = 0, bRentN = 0;
    for (let k = 0; k < h.companies.count; k++) {
      if (cc.sector[k] === 4 || cc.sector[k] === 0) continue;
      const st = cc.status[k]!;
      if (st === CompanyStatus.Closed) { closedN++; reasonsClosed[cc.reason[k]!]!++; continue; }
      active++;
      if (st === CompanyStatus.Difficulty) { diff++; reasonsDiff[cc.reason[k]!]!++; }
      if (cc.rent[k]! > 0) { bRent += cc.rent[k]!; bRentN++; }
    }
    const list = (arr: number[]): { key: string; label: string; count: number }[] => arr
      .map((count, r) => ({ key: CLOSURE_REASONS[r]![0], label: CLOSURE_REASONS[r]![1], count }))
      .filter((x) => x.key && x.count > 0).sort((p, q) => q.count - p.count);
    const districts: LivingDistrict[] = dNames.map((name, k) => ({
      name, population: dPop[k]!, laborForce: dLf[k]!, unemployed: dUn[k]!, rate: dLf[k]! ? dUn[k]! / dLf[k]! : 0, rent: dHh[k]! ? Math.round(dRent[k]! / dHh[k]!) : 0,
    })).filter((d) => d.population > 0).sort((p, q) => q.population - p.population || (p.name < q.name ? -1 : 1)).slice(0, 8);
    const r1 = (v: number): number => Math.round(v * 1000) / 1000;
    this.stats = {
      pressure: r1(ramp),
      rentAverage: rented ? Math.round(rentSum / rented) : 0,
      rentBurden: rented ? r1(burdenSum / rented) : 0,
      householdIncomeAverage: rented ? Math.round(resSum / rented) : 0,
      householdsInDistress: distress,
      distressShare: nh ? r1(distress / Math.max(1, h.householdCount)) : 0,
      landValueAverage: landN ? Math.round((100 * landSum) / landN) : 0,
      businessRentAverage: bRentN ? Math.round(bRent / bRentN) : 0,
      companiesActive: active, companiesInDifficulty: diff, companiesClosed: closedN,
      closureReasons: list(reasonsClosed), difficultyReasons: list(reasonsDiff),
      recentClosures: [],
      jobsVacant: Math.max(0, jobsOpen - filled), vacancyRate: jobsOpen ? r1(1 - filled / jobsOpen) : 0,
      districts,
      education: { tiers: [...EDU_TIERS_FR], adults, jobs, workers: workersByTier, underqualified: under, overqualified: over, mismatchShare: employed ? r1((under + over) / employed) : 0 },
      month: { ...this.month }, lastMonth: { ...this.lastMonth },
    };
  }

  /**
   * Fin de journée : un ménage en difficulté depuis assez longtemps cherche un logement libre qu'il peut payer, moins
   * cher que le sien ; sans solution, il quitte la ville après `joursAvantDepart` jours. Plafonné par jour.
   */
  resolve(now: number): void {
    const h = this.host, t = this.tuning;
    if (!this.pending.length) return;
    const b = h.ctx.buildings;
    let moves = 0, departures = 0, departedW = 0;
    const leaving = new Set<number>();
    for (const p of this.pending) {
      if (moves >= t.maxDemenagementsParJour && departures >= t.maxDepartsParJour) break;
      const hk = h.households.indexOf(p.hid);
      if (hk < 0) continue;
      let target = -1;
      if (moves < t.maxDemenagementsParJour) {
        const sf = householdSizeFactor(p.size);
        const budget = t.partSoutenable * Math.max(100, p.res);
        let best = Infinity;
        for (let i = 0; i < b.count; i++) {
          const u = this.rentUnit[i]!;
          if (u <= 0 || u >= p.rent * 0.92 || u * sf > budget || u >= best) continue;
          if (h.freeHousingAt(i) < p.size * (p.w ?? 1)) continue;
          best = u; target = b.id[i]!;
        }
      }
      if (target >= 0) {
        h.moveHousehold(p.hid, target, now);
        h.households.col.distressDays[hk] = 0;
        moves++;
        this.month.relocations += p.w ?? 1;
      } else if (p.days >= t.joursAvantDepart && departures < t.maxDepartsParJour) {
        leaving.add(p.hid);
        departures++;
        departedW += p.w ?? 1;
      }
    }
    if (leaving.size) {
      this.month.departuresRent += departedW;
      h.removeHouseholds(leaving, true);
    }
    this.pending = [];
  }

  /* ------------------------------ Entreprises ------------------------------ */

  /** Loyer mensuel du local d'activité d'index `bi` (0 pour un service public ou un local inconnu). */
  businessRentAt(bi: number, m: LivingMeta): number {
    if (m.sector === 4 || m.jobCap <= 0) return 0;
    const land = bi < this.land.length && this.land[bi]! > 0 ? this.land[bi]! : 1;
    return businessRent(this.tuning, land, m.level, m.jobCap);
  }

  // Grille de clientèle (cases de CELL_M) : habitants, actifs et employés des commerces par case, construite une fois
  // par clôture mensuelle (O(bâtiments)) ; chaque commerce somme ensuite les cases de son rayon (O(cases du rayon)).
  private gridRes = new Float64Array(0);
  private gridCom = new Float64Array(0);
  private gx0 = 0; private gz0 = 0; private gw = 0; private gh = 0;

  /** Prépare la grille de clientèle (à appeler avant `localCustomers`, une fois par clôture). */
  prepareCustomers(workerShare: number, commercial: (bj: number) => boolean): void {
    const b = this.host.ctx.buildings;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < b.count; i++) { const x = b.x[i]!, z = b.z[i]!; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
    if (!(x1 >= x0)) { this.gw = this.gh = 0; return; }
    this.gx0 = x0; this.gz0 = z0;
    this.gw = Math.floor((x1 - x0) / CELL_M) + 1; this.gh = Math.floor((z1 - z0) / CELL_M) + 1;
    const n = this.gw * this.gh;
    if (this.gridRes.length < n) { this.gridRes = new Float64Array(n); this.gridCom = new Float64Array(n); }
    this.gridRes.fill(0, 0, n); this.gridCom.fill(0, 0, n);
    for (let i = 0; i < b.count; i++) {
      const k = Math.floor((b.z[i]! - z0) / CELL_M) * this.gw + Math.floor((b.x[i]! - x0) / CELL_M);
      this.gridRes[k]! += b.residents[i]! + workerShare * b.workers[i]!;
      if (commercial(i)) this.gridCom[k]! += b.workers[i]!;
    }
  }

  /**
   * Clientèle locale d'un commerce (0,25..1,25) : habitants et actifs dans son rayon d'attraction (pondérés par
   * 1 − d / 2R), partagés avec les employés des commerces du même rayon (1 emploi commercial « nourri » pour
   * `perJob` clients). Utilise la grille de `prepareCustomers`.
   */
  localCustomers(bi: number, m: LivingMeta, perJob: number): number {
    const b = this.host.ctx.buildings;
    if (this.gw === 0) return 1;
    const R = Math.max(250, Math.min(1500, m.radius));
    const x = b.x[bi]!, z = b.z[bi]!;
    const c0 = Math.max(0, Math.floor((x - R - this.gx0) / CELL_M)), c1 = Math.min(this.gw - 1, Math.floor((x + R - this.gx0) / CELL_M));
    const r0 = Math.max(0, Math.floor((z - R - this.gz0) / CELL_M)), r1 = Math.min(this.gh - 1, Math.floor((z + R - this.gz0) / CELL_M));
    let customers = 0, competitors = 0;
    for (let r = r0; r <= r1; r++) {
      const cz = this.gz0 + (r + 0.5) * CELL_M - z;
      for (let c = c0; c <= c1; c++) {
        const cx = this.gx0 + (c + 0.5) * CELL_M - x;
        const d2 = cx * cx + cz * cz;
        if (d2 > R * R) continue;
        const k = r * this.gw + c;
        const w = 1 - 0.5 * Math.sqrt(d2) / R;
        customers += this.gridRes[k]! * w;
        competitors += this.gridCom[k]! * w;
      }
    }
    competitors = Math.max(competitors, b.workers[bi]!, 1);
    const f = customers / perJob / competitors;
    return f < 0.25 ? 0.25 : f > 1.25 ? 1.25 : f;
  }

  /**
   * Clôture mensuelle des entreprises (après les comptes) : pertes lissées, état, raison principale, fermetures
   * (plafonnées) et reprise des locaux vacants. `info(k)` donne les éléments du compte de l'entreprise d'index k.
   */
  monthlyCompanies(now: number, info: (k: number) => { workers: number; jobCap: number; under: number; customers: number; revenue: number; rent: number; profit: number } | null,
    canReopen: (k: number) => boolean): void {
    const h = this.host, t = this.tuning;
    const ramp = h.noServiceRamp();
    const cc = h.companies.col;
    const n = h.companies.count;
    const maxClose = Math.max(1, Math.floor(n * t.partFermeturesParMois));
    const closing: number[] = [];
    for (let k = 0; k < n; k++) {
      const sector = cc.sector[k]!;
      if (sector === 4 || sector === 0) continue;
      if (cc.status[k] === CompanyStatus.Closed) {
        if (now - cc.closedAt[k]! >= t.joursAvantReprise * MINUTES_PER_DAY && canReopen(k)) {
          cc.status[k] = CompanyStatus.Active; cc.reason[k] = Reason.None; cc.lossMonths[k] = 0; cc.closedAt[k] = 0;
          cc.founded[k] = Math.floor(now); cc.ownerSurname[k] = h.randomOwner();
          this.closed.delete(cc.id[k]!);
          this.month.reopenings++;
        }
        continue;
      }
      const a = info(k);
      if (!a) continue;
      const young = now - cc.founded[k]! < t.ageMinEntrepriseJours * MINUTES_PER_DAY;
      if (ramp <= 0 || young) { cc.lossMonths[k] = 0; cc.status[k] = CompanyStatus.Active; cc.reason[k] = Reason.None; continue; }
      if (a.profit < 0) {
        cc.lossMonths[k] = Math.min(250, cc.lossMonths[k]! + 1);
        cc.status[k] = CompanyStatus.Difficulty;
        const staffing = a.jobCap > 0 ? a.workers / a.jobCap : 0;
        // Raison principale : loyer écrasant d'abord, puis personnel, clientèle, qualification, loyer, charges.
        cc.reason[k] = a.rent > 0.35 * Math.max(1, a.revenue) && staffing >= 0.25 ? Reason.Rent
          : staffing < 0.5 ? Reason.Labor
          : sector === 1 && a.customers < 0.75 ? Reason.Customers
          : a.workers > 0 && a.under / a.workers > 0.35 ? Reason.Qualification
          : a.rent > 0.25 * Math.max(1, a.revenue) ? Reason.Rent : Reason.Costs;
        if (cc.lossMonths[k]! >= t.moisAvantFermeture && ramp >= 1) closing.push(k);
      } else {
        cc.lossMonths[k] = Math.max(0, cc.lossMonths[k]! - 1);
        if (cc.lossMonths[k] === 0) { cc.status[k] = CompanyStatus.Active; cc.reason[k] = Reason.None; }
      }
    }
    if (!closing.length) return;
    // Les plus longues pertes d'abord, plafonnées.
    closing.sort((p, q) => cc.lossMonths[q]! - cc.lossMonths[p]! || cc.id[p]! - cc.id[q]!);
    const ids = new Set<number>();
    for (const k of closing.slice(0, maxClose)) {
      cc.status[k] = CompanyStatus.Closed; cc.closedAt[k] = Math.max(1, Math.floor(now)); cc.revenue[k] = 0; cc.profit[k] = 0; cc.rent[k] = 0; cc.tax[k] = 0;
      ids.add(cc.id[k]!);
      this.closed.add(cc.id[k]!);
      this.closures.push({ id: cc.id[k]!, name: cc.ownerSurname[k]!, sector: cc.sector[k]!, reason: cc.reason[k]!, minute: Math.floor(now) });
      this.month.closures++;
    }
    if (this.closures.length > MAX_LOG) this.closures.splice(0, this.closures.length - MAX_LOG);
    // Licenciements.
    const c = h.citizens.col;
    for (let i = 0; i < h.citizens.count; i++) if (ids.has(c.job[i]!)) { h.quitJob(i); h.assignSchedule(i); }
  }

  /** Bâtiment démoli : son entreprise (et son local vacant) disparaît. */
  onBuildingRemoved(id: number): void { this.closed.delete(id); }

  /** Mois écoulé : compteurs du mois. */
  closeMonth(): void { this.lastMonth = this.month; this.month = zero(); }

  /* ------------------------------ Rapport ------------------------------ */

  /** Statistiques du dernier calcul quotidien (null avant le premier jour) ; `nameOf` nomme une fermeture. */
  report(nameOf: (r: ClosureRecord) => string, minutesToDay: (m: number) => number): LivingReport | null {
    const s = this.stats;
    if (!s) return null;
    return {
      ...s, pressure: Math.round(this.host.noServiceRamp() * 1000) / 1000,
      month: { ...this.month }, lastMonth: { ...this.lastMonth },
      closureReasons: s.closureReasons.map((x) => ({ ...x })), difficultyReasons: s.difficultyReasons.map((x) => ({ ...x })),
      districts: s.districts.map((d) => ({ ...d })),
      education: { ...s.education, tiers: [...s.education.tiers], adults: [...s.education.adults], jobs: [...s.education.jobs], workers: [...s.education.workers] },
      recentClosures: this.closures.slice(-8).reverse().map((r) => ({ name: nameOf(r), sector: SECTOR_FR[r.sector] ?? '?', reason: CLOSURE_REASONS[r.reason]?.[1] ?? '?', day: minutesToDay(r.minute) })),
    };
  }

  get ramp(): number { return this.lastRamp; }
  /** Ressources moyennes des ménages logés au dernier calcul quotidien (0 avant le premier jour). */
  get householdIncomeAverage(): number { return this.stats?.householdIncomeAverage ?? 0; }

  /* ------------------------------ Sauvegarde ------------------------------ */

  toJSON(): LivingJSON {
    return { v: 1, closures: this.closures.map((r) => ({ ...r })), month: { ...this.month }, lastMonth: { ...this.lastMonth } };
  }

  /** Recharge (tolérant : champ absent ou mal formé = valeurs neuves) et reconstruit les locaux fermés. */
  fromJSON(j: unknown): void {
    this.reset();
    const o = j && typeof j === 'object' ? j as Partial<LivingJSON> : {};
    const counters = (x: unknown): LivingCounters => {
      const r = zero();
      if (x && typeof x === 'object') for (const k of Object.keys(r) as (keyof LivingCounters)[]) { const v = (x as Record<string, unknown>)[k]; if (fin(v)) r[k] = v; }
      return r;
    };
    this.month = counters(o.month);
    this.lastMonth = counters(o.lastMonth);
    if (Array.isArray(o.closures)) {
      for (const r of o.closures) {
        if (r && fin(r.id) && fin(r.name) && fin(r.sector) && fin(r.reason) && fin(r.minute) && r.reason >= 0 && r.reason < CLOSURE_REASONS.length) {
          this.closures.push({ id: r.id, name: r.name, sector: r.sector, reason: r.reason, minute: r.minute });
        }
      }
      if (this.closures.length > MAX_LOG) this.closures.splice(0, this.closures.length - MAX_LOG);
    }
    const cc = this.host.companies.col;
    for (let k = 0; k < this.host.companies.count; k++) if (cc.status[k] === CompanyStatus.Closed) this.closed.add(cc.id[k]!);
  }
}
