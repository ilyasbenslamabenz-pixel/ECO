/**
 * Services qui comptent (vague 2) : criminalité par bâtiment, incendies (départs, intervention des pompiers, dégâts,
 * ruines, reconstruction), santé des logements et maladies individuelles. Comme l'économie vivante, ce système fait
 * partie de la démographie (il lit citoyens, ménages, couverture des équipements) ; le module de simulation
 * `services` (src/sim/plugins/services.ts) le pilote heure par heure (incendies), relaie les événements en
 * notifications et expose cartes et synthèses à l'interface.
 *
 * Aucun tirage dans le PRNG de la partie : les événements utilisent un hachage déterministe (`hash01`) ; rien n'arrive
 * pendant la période de grâce (pression progressive commune : 30 j de grâce puis 30 j de montée).
 * Coût : O(bâtiments + citoyens) par jour, O(bâtiments) par heure, voisinage par l'index spatial (aucune boucle en n²).
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { isBuildingCategory, type AssetCatalog } from '../../shared/catalog';
import { MINUTES_PER_DAY, MINUTES_PER_YEAR } from '../clock';
import type { BuildingStore, ChunkIndex } from '../ecs';
import type { CitizenTable, HouseholdTable } from '../population';
import { buildingLevel } from '../economie/tuning';
import {
  CrimeKind, DEFAULT_SERVICES_TUNING, crimeOwn, crimeTarget, fireBaseRisk, fireBurnHours, fireResponseHours, fireRisk,
  fireRiskDisplay, hash01, healthTarget, sicknessChance, type ServicesTuning,
} from './tuning';

/** Indices des services de couverture (identiques à `Service` de la démographie). */
export const SVC = { Health: 1, Police: 2, Fire: 3 } as const;

export interface ServiceStation { id: number; x: number; z: number; radius: number; units: number }

/** Ce que la démographie offre au système (lecture, et deux écritures : évacuation d'un bâtiment détruit). */
export interface ServicesHost {
  ctx: { catalog: AssetCatalog; buildings: BuildingStore; buildingIndex: ChunkIndex };
  citizens: CitizenTable;
  households: HouseholdTable;
  ageOf(ci: number, now: number): number;
  /** Qualité de couverture (0 non couvert, sinon 0,5..1 selon la distance à l'équipement) d'un service. */
  coverageQuality(service: number, bi: number): number;
  /** Pollution subie par le bâtiment (unités `pollution:N`). */
  pollutionOf(bi: number): number;
  /** Pression « sans service » commune (0 pendant la grâce, 1 à plein effet). */
  noServiceRamp(): number;
  /** Équipements d'un service (accès route), unités = capacité × niveau. */
  serviceStations(service: number): ServiceStation[];
  /** Bâtiment détruit : ménages relogés (sinon partis), employés licenciés, élèves désinscrits. */
  evacuateBuilding(id: number, now: number): void;
  /** Lot privé (zonage) : reconstruit par son promoteur. */
  isPrivate(id: number): boolean;
  /** Quartier (secteur du joueur) ; null : îlot de 500 m. */
  districtOf(id: number): { key: number; name: string } | null;
  /** Ménage en difficulté de loyer (économie vivante). */
  householdInDistress(hk: number): boolean;
  /** Simulation agrégée : habitants (ligne de citoyen) et ménages (ligne de ménage) représentés ; habitants réels. */
  weightOf(ci: number): number;
  hhWeightOf(hk: number): number;
  readonly population: number;
}

interface AssetInfo { crimeKind: number; level: number; fireBase: number; resCap: number; jobCap: number; name: string; cost: number; upkeep: number }

/** État d'un bâtiment (conservé par identifiant : les index changent à chaque suppression). */
class Rec {
  crime = 0;
  risk = 0;
  health = -1;
  builtAt = 0;
  /** Incendie en cours : minute de départ (-1 sinon), dégâts 0..1, arrivée des pompiers (minute ; -1 en attente d'un engin ; -2 aucune caserne ne couvre). */
  fireStart = -1;
  damage = 0;
  arrival = -1;
  station = -1;
  lastFireUpdate = 0;
  /** Bâtiment endommagé jusqu'à cette minute (0 sinon) ; ruine depuis cette minute (-1 sinon). */
  damagedUntil = 0;
  ruinedAt = -1;
  /** Délits du jour (statistique). */
  incidents = 0;
}

export type ServicesEventKind = 'fire' | 'fire_out' | 'fire_damage' | 'ruin' | 'rebuild' | 'crime';
export interface ServicesEvent { kind: ServicesEventKind; id: number; minute: number; level: 'info' | 'warn' | 'danger'; text: string; x: number; z: number }

export interface ServicesCounters { fires: number; firesOut: number; destroyed: number; damaged: number; incidents: number; sickCases: number; sickDeaths: number; rebuilt: number }
const zero = (): ServicesCounters => ({ fires: 0, firesOut: 0, destroyed: 0, damaged: 0, incidents: 0, sickCases: 0, sickDeaths: 0, rebuilt: 0 });

/** Synthèse du rapport (`report.demography.services`). */
export interface ServicesReport {
  pressure: number;
  crime: { average: number; high: number; incidentsToday: number; hotspots: { name: string; crime: number; buildings: number }[] };
  fire: { burning: number; damaged: number; ruins: number; riskAverage: number; uncovered: number; occupied: number };
  health: { average: number; sick: number; sickShare: number; uncoveredResidents: number; residents: number };
  coverage: { police: number; fire: number; health: number };
  /** Équipements par service : nombre, unités (patrouilles, engins, lits), habitants desservis au plus, entretien mensuel (catalogue). */
  stations: { service: 'police' | 'pompiers' | 'sante'; count: number; units: number; capacity: number; upkeep: number }[];
  month: ServicesCounters;
  lastMonth: ServicesCounters;
  recent: { kind: ServicesEventKind; day: number; text: string }[];
}

/** Détail d'un bâtiment (fiche). */
export interface BuildingSafety {
  crime: number; fireRisk: number; health: number | null; sick: number;
  state: 'normal' | 'feu' | 'endommage' | 'ruine';
  damage: number; police: number; fire: number; care: number;
  /** Ruine : coût de reconstruction (null pour un lot privé, reconstruit par son promoteur). */
  rebuildCost: number | null; rebuildInDays: number | null;
}

export interface ServicesJSON {
  v: 1;
  startedAt: number;
  /** [id, criminalité ×1000, construit à, risque ×10 000, santé ×100 (−100 : pas un logement)] par bâtiment. */
  recs: number[];
  /** [id, départ, dégâts ×10⁶, arrivée, caserne, endommagé jusqu'à, ruine depuis, dernière mise à jour] par bâtiment touché par le feu. */
  fires: number[];
  /** Malades et délits du jour, date du dernier calcul quotidien. */
  sick?: number;
  incidents?: number;
  lastDaily?: number;
  month: ServicesCounters;
  lastMonth: ServicesCounters;
  recent: { kind: ServicesEventKind; minute: number; text: string }[];
}

const SALT_FIRE = 0x51f15e, SALT_SPREAD = 0x5bd1e9, SALT_CRIME = 0x27d4eb, SALT_SICK = 0x165667;
const MAX_RECENT = 12;
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const r1 = (v: number): number => Math.round(v * 10) / 10;

export class CityServices {
  tuning: ServicesTuning = { ...DEFAULT_SERVICES_TUNING };
  /** Événements (canicule, épidémie : module `evenements`) : multiplicateurs du risque de feu et de maladie (1 = aucun effet). */
  eventFireFactor = 1;
  eventSickFactor = 1;
  private assets: AssetInfo[] = [];
  private recs = new Map<number, Rec>();
  /** Bâtiments en feu / endommagés / en ruine (petits ensembles : parcours horaires bornés). */
  private readonly burningIds = new Set<number>();
  private readonly ruinIds = new Set<number>();
  private readonly damagedIds = new Set<number>();
  /** Engins engagés par caserne. */
  private readonly engaged = new Map<number, number>();
  /** Minute de démarrage des services (chargement d'une sauvegarde antérieure : montée propre) ; -1 partie neuve. */
  startedAt = -1;
  month: ServicesCounters = zero();
  lastMonth: ServicesCounters = zero();
  private recent: { kind: ServicesEventKind; minute: number; text: string }[] = [];
  /** Événements pas encore relayés au joueur (vidés par le module `services`). */
  readonly events: ServicesEvent[] = [];
  /** Change à chaque événement ou calcul quotidien (deltas du module). */
  version = 0;
  /** Valeurs dérivées (risque, santé) à recalculer (après chargement). */
  private derivedStale = true;
  private incidentsToday = 0;
  private sickNow = 0;
  private lastDailyNow = 0;
  // Tampons par index de bâtiment (agrégats quotidiens).
  private aLabor = new Float32Array(0);
  private aUnemp = new Float32Array(0);
  private aHh = new Float32Array(0);
  private aDistress = new Float32Array(0);
  private aAge = new Float32Array(0);
  private aRes = new Float32Array(0);
  private aOwn = new Float32Array(0);
  private readonly q: number[] = [];
  /** Rapport mis en cache (recalculé à chaque événement ou chaque heure de jeu : le rapport part ≈ 1 fois/s). */
  private reportCache: { key: string; r: ServicesReport } | null = null;

  constructor(private readonly host: ServicesHost) {}

  setCatalog(cat: AssetCatalog): void {
    this.assets = cat.assets.map((a) => {
      const bld = isBuildingCategory(a.category);
      const res = bld ? Math.max(0, a.capacity.residents) : 0, jobs = bld ? Math.max(0, a.capacity.jobs) : 0;
      const office = a.category === 'skyscraper' || (a.category === 'commercial' && (a.tags.includes('bureaux') || a.tags.includes('tertiaire')));
      const crimeKind = !bld || a.category === 'public' ? CrimeKind.None : res > 0 ? CrimeKind.Housing
        : office ? CrimeKind.Office : a.category === 'industrial' ? CrimeKind.Industry : jobs > 0 ? CrimeKind.Commerce : CrimeKind.None;
      return { crimeKind, level: bld ? buildingLevel(a.category, res, jobs) : 1, fireBase: bld ? fireBaseRisk(a.category, a.tags) : 0, resCap: res, jobCap: jobs, name: a.nameFr, cost: a.cost, upkeep: a.upkeepPerMonth };
    });
  }

  reset(): void {
    this.recs.clear(); this.burningIds.clear(); this.ruinIds.clear(); this.damagedIds.clear(); this.engaged.clear();
    this.startedAt = -1; this.month = zero(); this.lastMonth = zero(); this.recent = []; this.events.length = 0;
    this.derivedStale = true; this.incidentsToday = 0; this.sickNow = 0; this.lastDailyNow = 0; this.reportCache = null; this.version++;
  }

  /* ------------------------------ Accès ------------------------------ */

  private rec(id: number): Rec {
    let r = this.recs.get(id);
    if (!r) { r = new Rec(); r.builtAt = Math.floor(this.lastDailyNow); this.recs.set(id, r); }
    return r;
  }
  private info(bi: number): AssetInfo | undefined { return this.assets[this.host.ctx.buildings.assetIndex[bi]!]; }

  /** Pression des services : commune (grâce + montée), et montée propre après le chargement d'une ancienne sauvegarde. */
  ramp(now: number): number {
    const base = this.host.noServiceRamp();
    if (this.startedAt < 0) return base;
    const own = (now - this.startedAt) / (this.tuning.rampeChargementJours * MINUTES_PER_DAY);
    return Math.max(0, Math.min(base, own));
  }

  isBurning(id: number): boolean { return this.burningIds.has(id); }
  isRuined(id: number): boolean { return this.ruinIds.has(id); }
  isDamaged(id: number): boolean { return this.damagedIds.has(id); }
  /** Bâtiment hors d'usage (feu ou ruine) : ni habitant nouveau, ni emploi offert. */
  blocked(id: number): boolean { return (this.burningIds.size > 0 || this.ruinIds.size > 0) && (this.burningIds.has(id) || this.ruinIds.has(id)); }
  /** Pas de nouveaux ménages (hors d'usage ou en réparation). */
  blocksHousing(id: number): boolean { return this.blocked(id) || (this.damagedIds.size > 0 && this.damagedIds.has(id)); }
  crimeOf(id: number): number { return this.recs.get(id)?.crime ?? 0; }
  healthOf(id: number): number { return this.recs.get(id)?.health ?? -1; }
  /** Baisse de l'indice de valeur foncière due à la criminalité (0..`crimeFoncier`). */
  landPenalty(id: number): number { return (this.crimeOf(id) / 100) * this.tuning.crimeFoncier; }
  get burningCount(): number { return this.burningIds.size; }
  get ruinCount(): number { return this.ruinIds.size; }
  get damagedCount(): number { return this.damagedIds.size; }
  burningList(): number[] { return [...this.burningIds]; }
  ruinList(): number[] { return [...this.ruinIds]; }

  onBuildingAdded(id: number, now: number): void {
    const r = this.rec(id);
    r.builtAt = Math.floor(now);
  }

  onBuildingRemoved(id: number): void {
    const r = this.recs.get(id);
    if (r && r.station >= 0 && r.arrival >= 0) this.release(r.station);
    this.recs.delete(id); this.burningIds.delete(id); this.ruinIds.delete(id); this.damagedIds.delete(id);
    if (this.engaged.has(id)) this.engaged.delete(id); // caserne démolie
    this.version++;
  }

  private release(station: number): void {
    const n = (this.engaged.get(station) ?? 0) - 1;
    if (n > 0) this.engaged.set(station, n); else this.engaged.delete(station);
  }

  /* ------------------------------ Journée ------------------------------ */

  private ensureBuffers(cap: number): void {
    if (this.aLabor.length >= cap) return;
    this.aLabor = new Float32Array(cap); this.aUnemp = new Float32Array(cap); this.aHh = new Float32Array(cap);
    this.aDistress = new Float32Array(cap); this.aAge = new Float32Array(cap); this.aRes = new Float32Array(cap); this.aOwn = new Float32Array(cap);
  }

  /**
   * Valeurs dérivées de l'état de la ville : agrégats par logement (chômage, pauvreté, âge), criminalité cible,
   * risque d'incendie, santé ; met à jour la criminalité (inertie) si `advance`. Renvoie rien ; écrit les `Rec`.
   */
  private computeDerived(now: number, advance: boolean): void {
    const h = this.host, t = this.tuning, b = h.ctx.buildings, n = b.count;
    const c = h.citizens.col, hh = h.households;
    this.ensureBuffers(b.capacity);
    this.aLabor.fill(0, 0, n); this.aUnemp.fill(0, 0, n); this.aHh.fill(0, 0, n); this.aDistress.fill(0, 0, n); this.aAge.fill(0, 0, n); this.aRes.fill(0, 0, n);
    for (let i = 0; i < h.citizens.count; i++) {
      const bi = b.indexOf(c.home[i]!);
      if (bi < 0) continue;
      const age = h.ageOf(i, now);
      const w = h.weightOf(i);
      this.aRes[bi]! += w; this.aAge[bi]! += age * w;
      if (age >= 18 && age < 64 && c.school[i]! < 0) { this.aLabor[bi]! += w; if (c.job[i]! < 0) this.aUnemp[bi]! += w; }
    }
    for (let k = 0; k < hh.count; k++) {
      const bi = b.indexOf(hh.col.home[k]!);
      if (bi < 0) continue;
      const hw = h.hhWeightOf(k);
      this.aHh[bi]! += hw;
      if (h.householdInDistress(k)) this.aDistress[bi]! += hw;
    }
    // Criminalité propre puis moyenne du voisinage (îlots de `crimeIlotM` m, une passe).
    const cell = t.crimeIlotM;
    const sum = new Map<number, number>(), cnt = new Map<number, number>();
    for (let bi = 0; bi < n; bi++) {
      const a = this.info(bi);
      const occupied = b.residents[bi]! + b.workers[bi]! > 0;
      if (!a || a.crimeKind === CrimeKind.None || !occupied) { this.aOwn[bi] = -1; continue; }
      const own = crimeOwn(t, a.crimeKind, a.level, this.aLabor[bi]! > 0 ? this.aUnemp[bi]! / this.aLabor[bi]! : 0, this.aHh[bi]! > 0 ? this.aDistress[bi]! / this.aHh[bi]! : 0);
      this.aOwn[bi] = own;
      const key = Math.floor(b.x[bi]! / cell) * 100_003 + Math.floor(b.z[bi]! / cell);
      sum.set(key, (sum.get(key) ?? 0) + own); cnt.set(key, (cnt.get(key) ?? 0) + 1);
    }
    const ramp = this.ramp(now);
    for (let bi = 0; bi < n; bi++) {
      const id = b.id[bi]!;
      const r = this.rec(id);
      const a = this.info(bi);
      const own = this.aOwn[bi]!;
      if (advance) {
        let target = 0;
        if (own >= 0) {
          const key = Math.floor(b.x[bi]! / cell) * 100_003 + Math.floor(b.z[bi]! / cell);
          target = crimeTarget(t, own, sum.get(key)! / cnt.get(key)!, h.coverageQuality(SVC.Police, bi), ramp);
        }
        r.crime += (target - r.crime) * t.crimeInertie;
        // Quantifiée (millièmes) : la sauvegarde la restitue exactement.
        r.crime = r.crime < 0.05 ? 0 : Math.round(r.crime * 1000) / 1000;
      }
      if (!a) { r.risk = 0; r.health = -1; continue; }
      const age = Math.max(0, (now - r.builtAt) / MINUTES_PER_YEAR);
      r.risk = this.ruinIds.has(id) ? 0 : Math.round(fireRisk(t, a.fireBase, a.level, age, h.coverageQuality(SVC.Fire, bi)) * 10_000) / 10_000;
      r.health = a.resCap > 0 ? Math.round(healthTarget(t, h.pollutionOf(bi), this.aRes[bi]! > 0 ? this.aAge[bi]! / this.aRes[bi]! : 35, h.coverageQuality(SVC.Health, bi)) * 100) / 100 : -1;
    }
    this.derivedStale = false;
  }

  /**
   * Valeurs dérivées à jour pour l'affichage : après un chargement, et avant le premier calcul quotidien d'une partie
   * neuve (bâtiments posés le premier jour). Sans effet sur la simulation : pendant ce premier jour, la pression est
   * nulle (aucun départ de feu ni maladie) et le calcul quotidien recalcule tout.
   */
  ensureDerived(now: number): void { if (this.derivedStale || this.lastDailyNow === 0) this.computeDerived(now, false); }

  /**
   * Calcul quotidien (appelé par la démographie après la recherche d'emploi, avant les loyers et le bonheur) :
   * criminalité, risque, santé, délits du jour, maladies (début, guérison), réparations et reconstructions privées.
   */
  daily(now: number): void {
    this.lastDailyNow = now;
    const h = this.host, t = this.tuning, b = h.ctx.buildings;
    this.computeDerived(now, true);
    const ramp = this.ramp(now);
    const day = Math.floor(now / MINUTES_PER_DAY);
    // Délits du jour.
    let incidents = 0, topId = -1, topN = 0, topCrime = 0;
    for (let bi = 0; bi < b.count; bi++) {
      const id = b.id[bi]!;
      const r = this.recs.get(id)!;
      r.incidents = 0;
      if (r.crime <= 0) continue;
      const e = (r.crime / 100) * (b.residents[bi]! + b.workers[bi]!) * t.delitsParOccupant;
      const k = Math.floor(e) + (hash01(id, day, SALT_CRIME) < e - Math.floor(e) ? 1 : 0);
      if (!k) continue;
      r.incidents = k; incidents += k;
      if (k > topN || (k === topN && r.crime > topCrime)) { topN = k; topId = id; topCrime = r.crime; }
    }
    this.incidentsToday = incidents;
    this.month.incidents += incidents;
    if (incidents > 0 && topId >= 0) {
      const bi = b.indexOf(topId);
      const where = this.placeName(topId);
      const level = topCrime >= t.crimeEleve ? 'warn' : 'info';
      // Notification : délits nombreux ou criminalité élevée seulement (sinon : compte du rapport, sans bandeau).
      if (incidents >= 3 || topCrime >= t.crimeEleve) {
        this.push({ kind: 'crime', id: topId, minute: now, level, text: `Délits signalés aujourd'hui : ${incidents} — le plus touché : ${this.assetName(topId)} (${where}, criminalité ${Math.round(topCrime)})${h.coverageQuality(SVC.Police, bi) > 0 ? '' : ' — aucun commissariat ne couvre ce secteur'}` }, false);
      }
    }
    // Maladies : guérison, puis nouveaux cas (logement : santé du jour).
    const c = h.citizens.col;
    let sick = 0;
    for (let i = 0; i < h.citizens.count; i++) {
      if (c.sick[i]! > 0) { c.sick[i]!--; if (c.sick[i]! > 0) sick += h.weightOf(i); continue; }
      if (ramp <= 0) continue;
      const bi = b.indexOf(c.home[i]!);
      if (bi < 0) continue;
      const r = this.recs.get(b.id[bi]!);
      const health = r && r.health >= 0 ? r.health : 70;
      if (hash01(c.id[i]!, day, SALT_SICK) < sicknessChance(t, health, h.ageOf(i, now), ramp) * this.eventSickFactor) {
        c.sick[i] = h.coverageQuality(SVC.Health, bi) > 0 ? t.maladieDureeSoins : t.maladieDureeSans;
        const w = h.weightOf(i);
        this.month.sickCases += w;
        sick += w;
      }
    }
    this.sickNow = sick;
    // Réparations terminées, reconstructions par les promoteurs (lots privés).
    for (const id of [...this.damagedIds]) { const r = this.recs.get(id); if (!r || r.damagedUntil <= now) { this.damagedIds.delete(id); if (r) r.damagedUntil = 0; } }
    for (const id of [...this.ruinIds]) {
      const r = this.recs.get(id);
      if (r && h.isPrivate(id) && now - r.ruinedAt >= t.reconstructionPriveeJours * MINUTES_PER_DAY) {
        this.rebuild(id, now);
        this.push({ kind: 'rebuild', id, minute: now, level: 'info', text: `Reconstruit par son promoteur : ${this.assetName(id)} (${this.placeName(id)})` });
      }
    }
    this.version++;
  }

  /** Mortalité : multiplicateur d'un citoyen malade (soigné ou non). */
  mortalityFactor(ci: number, bi: number): number {
    if (this.host.citizens.col.sick[ci]! <= 0) return 1;
    return this.host.coverageQuality(SVC.Health, bi) > 0 ? this.tuning.maladieMortaliteSoins : this.tuning.maladieMortaliteSans;
  }

  /** Clôture du mois (compteurs). */
  closeMonth(): void { this.lastMonth = this.month; this.month = zero(); this.version++; }

  /* ------------------------------ Incendies (chaque heure) ------------------------------ */

  /**
   * Heure de jeu : départs de feu (risque × pression, tirage déterministe), envoi des pompiers (caserne couvrante la
   * plus proche ayant un engin libre), progression des dégâts, extinction, propagation légère aux voisins, ruines.
   */
  hourly(now: number): void {
    const ramp = this.ramp(now);
    if (ramp <= 0 && !this.burningIds.size) return;
    const t = this.tuning, hour = Math.floor(now / 60);
    const b = this.host.ctx.buildings;
    if (ramp > 0) {
      // Départs de feu : bâtiments occupés, ni en feu ni en ruine (risque du dernier calcul quotidien).
      const k = t.feuProbaHeure * ramp * this.eventFireFactor;
      for (let bi = 0; bi < b.count; bi++) {
        if (b.residents[bi]! + b.workers[bi]! <= 0) continue;
        const id = b.id[bi]!;
        const r = this.recs.get(id);
        if (!r || r.risk <= 0 || r.fireStart >= 0 || this.ruinIds.has(id)) continue;
        if (hash01(id, hour, SALT_FIRE) < r.risk * k) this.ignite(id, now, false);
      }
    }
    if (!this.burningIds.size) return;
    let stations: ServiceStation[] | null = null;
    for (const id of [...this.burningIds]) {
      const r = this.recs.get(id);
      const bi = b.indexOf(id);
      if (!r || bi < 0) { this.burningIds.delete(id); continue; }
      const a = this.info(bi);
      const dtH = Math.max(0, (now - r.lastFireUpdate) / 60);
      r.lastFireUpdate = now;
      // Pompiers : en attente d'un engin libre ou d'une caserne nouvellement construite.
      if (r.arrival < 0) {
        stations ??= this.host.serviceStations(SVC.Fire);
        this.dispatch(id, bi, r, now, stations);
      }
      const onSite = r.arrival >= 0 && now >= r.arrival;
      r.damage = Math.min(1, r.damage + (dtH / fireBurnHours(t, a?.level ?? 1)) * (onSite ? 0.4 : 1));
      if (r.damage >= 1) { this.destroy(id, r, now); continue; }
      if (onSite && now >= r.arrival + t.feuExtinctionH * 60) { this.extinguish(id, r, now); continue; }
      // Propagation légère : feu non maîtrisé avancé -> voisins proches.
      if (!onSite && r.damage > 0.5) {
        const R = t.feuVoisinM, x = b.x[bi]!, z = b.z[bi]!;
        this.host.ctx.buildingIndex.query(x - R, z - R, x + R, z + R, this.q);
        for (const nid of this.q) {
          if (nid === id || this.burningIds.has(nid) || this.ruinIds.has(nid)) continue;
          const nj = b.indexOf(nid);
          const na = nj >= 0 ? this.info(nj) : undefined;
          if (!na || na.fireBase <= 0 || Math.hypot(b.x[nj]! - x, b.z[nj]! - z) > R + 12) continue;
          if (hash01(nid, hour, SALT_SPREAD ^ id) < t.feuPropagation) this.ignite(nid, now, true);
        }
      }
    }
  }

  /** Départ de feu (aussi utilisé par les tests et la commande de diagnostic). */
  ignite(id: number, now: number, spread: boolean): boolean {
    const b = this.host.ctx.buildings;
    const bi = b.indexOf(id);
    if (bi < 0 || this.burningIds.has(id) || this.ruinIds.has(id)) return false;
    const r = this.rec(id);
    r.fireStart = now; r.damage = 0; r.arrival = -1; r.station = -1; r.lastFireUpdate = now;
    this.burningIds.add(id);
    this.month.fires++;
    this.dispatch(id, bi, r, now, this.host.serviceStations(SVC.Fire));
    const help = r.arrival >= 0 ? `pompiers en route (arrivée dans ≈ ${Math.max(5, Math.round((r.arrival - now) / 5) * 5)} min)`
      : r.arrival === -1 ? 'toutes les équipes sont occupées' : 'aucune caserne ne couvre ce bâtiment';
    this.push({ kind: 'fire', id, minute: now, level: r.arrival >= 0 ? 'warn' : 'danger', text: `${spread ? 'Le feu se propage' : 'Incendie'} : ${this.assetName(id)} (${this.placeName(id)}) — ${help}` });
    return true;
  }

  private dispatch(id: number, bi: number, r: Rec, now: number, stations: ServiceStation[]): void {
    const b = this.host.ctx.buildings, x = b.x[bi]!, z = b.z[bi]!;
    let best: ServiceStation | null = null, bestD = Infinity, anyCover = false;
    for (const s of stations) {
      const d = Math.hypot(s.x - x, s.z - z);
      if (d > s.radius) continue;
      anyCover = true;
      if ((this.engaged.get(s.id) ?? 0) >= s.units) continue;
      if (d < bestD) { bestD = d; best = s; }
    }
    if (!best) { r.arrival = anyCover ? -1 : -2; return; }
    const q = 1 - 0.5 * (bestD / Math.max(1, best.radius));
    r.arrival = Math.round(now + fireResponseHours(this.tuning, q) * 60);
    r.station = best.id;
    this.engaged.set(best.id, (this.engaged.get(best.id) ?? 0) + 1);
    void id;
  }

  private endFire(id: number, r: Rec): void {
    if (r.station >= 0 && r.arrival >= 0) this.release(r.station);
    r.fireStart = -1; r.arrival = -1; r.station = -1;
    this.burningIds.delete(id);
  }

  private extinguish(id: number, r: Rec, now: number): void {
    const t = this.tuning, dmg = r.damage;
    this.endFire(id, r);
    this.month.firesOut++;
    if (dmg >= t.feuSeuilDegats) {
      r.damagedUntil = now + t.feuReparationJours * MINUTES_PER_DAY;
      this.damagedIds.add(id);
      this.month.damaged++;
      this.push({ kind: 'fire_damage', id, minute: now, level: 'warn', text: `Incendie maîtrisé : ${this.assetName(id)} (${this.placeName(id)}) endommagé à ${Math.round(dmg * 100)} %, en réparation ${t.feuReparationJours} jours` });
    } else {
      this.push({ kind: 'fire_out', id, minute: now, level: 'info', text: `Incendie maîtrisé : ${this.assetName(id)} (${this.placeName(id)}), dégâts légers` });
    }
    r.damage = 0;
  }

  private destroy(id: number, r: Rec, now: number): void {
    this.endFire(id, r);
    r.damage = 1;
    r.ruinedAt = now;
    r.crime = 0;
    this.ruinIds.add(id);
    this.damagedIds.delete(id);
    this.month.destroyed++;
    this.host.evacuateBuilding(id, now);
    const priv = this.host.isPrivate(id);
    this.push({ kind: 'ruin', id, minute: now, level: 'danger', text: `Bâtiment détruit par le feu : ${this.assetName(id)} (${this.placeName(id)}) — ${priv ? `ruine reconstruite par son promoteur dans ${this.tuning.reconstructionPriveeJours} jours, ou démolissez-la` : 'démolissez la ruine ou reconstruisez-la (fiche du bâtiment)'}` });
  }

  /** Coût de reconstruction d'une ruine (null : pas une ruine ou lot privé). */
  rebuildCost(id: number): number | null {
    if (!this.ruinIds.has(id) || this.host.isPrivate(id)) return null;
    const bi = this.host.ctx.buildings.indexOf(id);
    const a = bi >= 0 ? this.info(bi) : undefined;
    return a ? Math.round(a.cost * this.tuning.reconstructionPart) : null;
  }

  /** Remet une ruine en état (le paiement est fait par l'appelant). */
  rebuild(id: number, now: number): boolean {
    if (!this.ruinIds.has(id)) return false;
    const r = this.rec(id);
    this.ruinIds.delete(id);
    r.ruinedAt = -1; r.damage = 0; r.builtAt = Math.floor(now); r.damagedUntil = 0;
    this.month.rebuilt++;
    this.version++;
    return true;
  }

  /* ------------------------------ Événements ------------------------------ */

  private push(ev: Omit<ServicesEvent, 'x' | 'z'>, keep = true): void {
    const b = this.host.ctx.buildings, bi = b.indexOf(ev.id);
    const e: ServicesEvent = { ...ev, x: bi >= 0 ? b.x[bi]! : 0, z: bi >= 0 ? b.z[bi]! : 0 };
    this.events.push(e);
    if (this.events.length > 64) this.events.splice(0, this.events.length - 64);
    if (keep || e.kind === 'crime') {
      this.recent.push({ kind: e.kind, minute: e.minute, text: e.text });
      if (this.recent.length > MAX_RECENT) this.recent.splice(0, this.recent.length - MAX_RECENT);
    }
    this.version++;
  }

  private assetName(id: number): string {
    const bi = this.host.ctx.buildings.indexOf(id);
    return (bi >= 0 ? this.info(bi)?.name : undefined) ?? 'Bâtiment';
  }

  placeName(id: number): string {
    const d = this.host.districtOf(id);
    if (d) return d.name;
    const b = this.host.ctx.buildings, bi = b.indexOf(id);
    if (bi < 0) return '—';
    const cx = Math.floor(b.x[bi]! / 500), cz = Math.floor(b.z[bi]! / 500);
    return `Îlot ${String.fromCharCode(65 + Math.max(0, Math.min(25, cx + 13)))}${cz + 14}`;
  }

  /* ------------------------------ Rapport ------------------------------ */

  report(now: number): ServicesReport {
    const key = `${this.version}|${Math.floor(now / 60)}|${this.host.ctx.buildings.count}`;
    if (this.reportCache?.key === key) return this.reportCache.r;
    const r = this.computeReport(now);
    this.reportCache = { key, r };
    return r;
  }

  private computeReport(now: number): ServicesReport {
    this.ensureDerived(now);
    const h = this.host, b = h.ctx.buildings, t = this.tuning;
    let crimeW = 0, crimeN = 0, high = 0, riskSum = 0, riskN = 0, uncovered = 0, occupied = 0, healthSum = 0, healthN = 0, uncoveredRes = 0, residents = 0;
    let covP = 0, covF = 0, covH = 0;
    const hot = new Map<string, { sum: number; n: number }>();
    for (let bi = 0; bi < b.count; bi++) {
      const id = b.id[bi]!;
      const r = this.recs.get(id);
      const a = this.info(bi);
      if (!r || !a) continue;
      const occ = b.residents[bi]! + b.workers[bi]!;
      const res = b.residents[bi]!;
      if (occ > 0 && a.crimeKind !== CrimeKind.None) {
        crimeW += r.crime * occ; crimeN += occ;
        if (r.crime >= t.crimeEleve) high++;
        if (r.crime >= 15) { const k = this.placeName(id); const e = hot.get(k) ?? { sum: 0, n: 0 }; e.sum += r.crime; e.n++; hot.set(k, e); }
      }
      if (occ > 0 && a.fireBase > 0) {
        occupied++; riskSum += fireRiskDisplay(r.risk); riskN++;
        if (h.coverageQuality(SVC.Fire, bi) <= 0) uncovered++;
      }
      if (res > 0) {
        residents += res;
        if (r.health >= 0) { healthSum += r.health * res; healthN += res; }
        if (h.coverageQuality(SVC.Health, bi) <= 0) uncoveredRes += res;
        if (h.coverageQuality(SVC.Police, bi) > 0) covP += res;
        if (h.coverageQuality(SVC.Fire, bi) > 0) covF += res;
        if (h.coverageQuality(SVC.Health, bi) > 0) covH += res;
      }
    }
    const pop = h.population;
    const per: Record<number, number> = { [SVC.Police]: 600, [SVC.Fire]: 900, [SVC.Health]: 20 };
    const station = (svc: number, key: 'police' | 'pompiers' | 'sante'): ServicesReport['stations'][number] => {
      const list = h.serviceStations(svc);
      const units = list.reduce((s, x) => s + x.units, 0);
      const upkeep = list.reduce((s, x) => { const bi = b.indexOf(x.id); return s + (bi >= 0 ? this.info(bi)?.upkeep ?? 0 : 0); }, 0);
      return { service: key, count: list.length, units: r1(units), capacity: Math.round(units * per[svc]!), upkeep };
    };
    const hotspots = [...hot.entries()].map(([name, e]) => ({ name, crime: Math.round(e.sum / e.n), buildings: e.n }))
      .sort((p, q) => q.crime - p.crime || q.buildings - p.buildings).slice(0, 5);
    return {
      pressure: Math.round(this.ramp(now) * 1000) / 1000,
      crime: { average: crimeN ? r1(crimeW / crimeN) : 0, high, incidentsToday: this.incidentsToday, hotspots },
      fire: { burning: this.burningIds.size, damaged: this.damagedIds.size, ruins: this.ruinIds.size, riskAverage: riskN ? Math.round(riskSum / riskN) : 0, uncovered, occupied },
      health: { average: healthN ? r1(healthSum / healthN) : 0, sick: this.sickNow, sickShare: pop ? Math.round((this.sickNow / pop) * 1000) / 1000 : 0, uncoveredResidents: uncoveredRes, residents },
      coverage: { police: residents ? covP / residents : 0, fire: residents ? covF / residents : 0, health: residents ? covH / residents : 0 },
      stations: [station(SVC.Police, 'police'), station(SVC.Fire, 'pompiers'), station(SVC.Health, 'sante')],
      month: { ...this.month }, lastMonth: { ...this.lastMonth },
      recent: this.recent.slice().reverse().map((e) => ({ kind: e.kind, day: Math.floor(e.minute / MINUTES_PER_DAY), text: e.text })),
    };
  }

  /** Malades actuels (dernier calcul quotidien). */
  get sickCount(): number { return this.sickNow; }

  /** Criminalité moyenne pondérée par les occupants (attractivité). */
  averageCrime(): number {
    const b = this.host.ctx.buildings;
    let w = 0, n = 0;
    for (let bi = 0; bi < b.count; bi++) {
      const occ = b.residents[bi]! + b.workers[bi]!;
      if (occ <= 0) continue;
      const r = this.recs.get(b.id[bi]!);
      if (r) { w += r.crime * occ; n += occ; }
    }
    return n ? w / n : 0;
  }

  /** Fiche d'un bâtiment. */
  inspect(id: number, now: number): BuildingSafety | null {
    const b = this.host.ctx.buildings, bi = b.indexOf(id);
    if (bi < 0) return null;
    this.ensureDerived(now);
    const r = this.rec(id);
    const a = this.info(bi);
    let sick = 0;
    const c = this.host.citizens.col;
    for (let i = 0; i < this.host.citizens.count; i++) if (c.home[i] === id && c.sick[i]! > 0) sick += this.host.weightOf(i);
    const state = this.burningIds.has(id) ? 'feu' : this.ruinIds.has(id) ? 'ruine' : this.damagedIds.has(id) ? 'endommage' : 'normal';
    const priv = this.host.isPrivate(id);
    return {
      crime: Math.round(r.crime), fireRisk: fireRiskDisplay(r.risk), health: a && a.resCap > 0 && r.health >= 0 ? Math.round(r.health) : null, sick, state,
      damage: Math.round(r.damage * 100) / 100,
      police: r2(this.host.coverageQuality(SVC.Police, bi)), fire: r2(this.host.coverageQuality(SVC.Fire, bi)), care: r2(this.host.coverageQuality(SVC.Health, bi)),
      rebuildCost: this.rebuildCost(id),
      rebuildInDays: state === 'ruine' && priv ? Math.max(0, Math.ceil(this.tuning.reconstructionPriveeJours - (now - r.ruinedAt) / MINUTES_PER_DAY)) : null,
    };
  }

  /** Couverture d'un bâtiment (index) : bit 1 police, 2 pompiers, 4 soins. */
  coverageMask(bi: number): number {
    const h = this.host;
    return (h.coverageQuality(SVC.Police, bi) > 0 ? 1 : 0) | (h.coverageQuality(SVC.Fire, bi) > 0 ? 2 : 0) | (h.coverageQuality(SVC.Health, bi) > 0 ? 4 : 0);
  }

  /** Valeurs par bâtiment pour les cartes : [criminalité, risque affiché, santé (-1 : pas un logement), état (0..3)]. */
  layerValues(id: number): [number, number, number, number] {
    const r = this.recs.get(id);
    if (!r) return [0, 0, -1, 0];
    const st = this.burningIds.has(id) ? 1 : this.ruinIds.has(id) ? 3 : this.damagedIds.has(id) ? 2 : 0;
    return [r.crime, fireRiskDisplay(r.risk), r.health, st];
  }

  /* ------------------------------ Sauvegarde ------------------------------ */

  toJSON(): ServicesJSON {
    const recs: number[] = [], fires: number[] = [];
    for (const [id, r] of this.recs) {
      recs.push(id, Math.round(r.crime * 1000), r.builtAt, Math.round(r.risk * 10_000), Math.round(r.health * 100));
      if (r.fireStart >= 0 || r.ruinedAt >= 0 || r.damagedUntil > 0) fires.push(id, r.fireStart, Math.round(r.damage * 1e6), r.arrival, r.station, r.damagedUntil, r.ruinedAt, r.lastFireUpdate);
    }
    return {
      v: 1, startedAt: this.startedAt, recs, fires, month: { ...this.month }, lastMonth: { ...this.lastMonth }, recent: this.recent.map((e) => ({ ...e })),
      sick: this.sickNow, incidents: this.incidentsToday, lastDaily: this.lastDailyNow,
    };
  }

  /**
   * Recharge (tolérant). Champ absent (sauvegarde antérieure aux services) : criminalité nulle, aucun feu, montée
   * propre de `rampeChargementJours` jours à partir du chargement (le joueur n'avait aucune raison de bâtir ces services).
   */
  fromJSON(j: unknown, now: number): void {
    this.reset();
    this.lastDailyNow = now;
    const o = j && typeof j === 'object' ? j as Partial<ServicesJSON> : null;
    if (!o) { this.startedAt = Math.floor(now); return; }
    this.startedAt = fin(o.startedAt) ? o.startedAt : -1;
    const counters = (x: unknown): ServicesCounters => {
      const r = zero();
      if (x && typeof x === 'object') for (const k of Object.keys(r) as (keyof ServicesCounters)[]) { const v = (x as Record<string, unknown>)[k]; if (fin(v)) r[k] = v; }
      return r;
    };
    this.month = counters(o.month); this.lastMonth = counters(o.lastMonth);
    const b = this.host.ctx.buildings;
    if (fin(o.lastDaily)) this.lastDailyNow = o.lastDaily;
    if (fin(o.sick)) this.sickNow = o.sick;
    if (fin(o.incidents)) this.incidentsToday = o.incidents;
    let complete = Array.isArray(o.recs);
    if (Array.isArray(o.recs)) for (let k = 0; k + 4 < o.recs.length; k += 5) {
      const v = o.recs.slice(k, k + 5);
      if (!v.every(fin) || b.indexOf(v[0]!) < 0) continue;
      const [id, crime, built, risk, health] = v as number[];
      const r = this.rec(id!);
      r.crime = Math.max(0, Math.min(100, crime! / 1000)); r.builtAt = built!; r.risk = Math.max(0, risk! / 10_000); r.health = health! < 0 ? -1 : Math.min(100, health! / 100);
    }
    // Valeurs dérivées sauvegardées pour chaque bâtiment : pas de recalcul avant le prochain jour (reprise à l'identique).
    for (let bi = 0; bi < b.count && complete; bi++) if (!this.recs.has(b.id[bi]!)) complete = false;
    this.derivedStale = !complete;
    if (Array.isArray(o.fires)) for (let k = 0; k + 7 < o.fires.length; k += 8) {
      const v = o.fires.slice(k, k + 8);
      if (!v.every(fin) || b.indexOf(v[0]!) < 0) continue;
      const [id, start, dmg, arrival, station, damagedUntil, ruinedAt, last] = v as number[];
      const r = this.rec(id!);
      r.damage = Math.max(0, Math.min(1, dmg! / 1e6)); r.damagedUntil = damagedUntil!; r.ruinedAt = ruinedAt!;
      if (ruinedAt! >= 0) this.ruinIds.add(id!);
      else if (start! >= 0) {
        r.fireStart = start!; r.arrival = arrival!; r.station = station!; r.lastFireUpdate = last!;
        this.burningIds.add(id!);
        if (arrival! >= 0 && station! >= 0) this.engaged.set(station!, (this.engaged.get(station!) ?? 0) + 1);
      }
      if (damagedUntil! > 0 && ruinedAt! < 0) this.damagedIds.add(id!);
    }
    if (Array.isArray(o.recent)) for (const e of o.recent) if (e && typeof e.text === 'string' && fin(e.minute) && typeof e.kind === 'string') this.recent.push({ kind: e.kind, minute: e.minute, text: e.text });
    if (this.recent.length > MAX_RECENT) this.recent.splice(0, this.recent.length - MAX_RECENT);
  }
}

const r2 = (v: number): number => Math.round(v * 100) / 100;
