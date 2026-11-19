/**
 * Zonage — système de simulation : grille, demande, CROISSANCE et DENSIFICATION.
 *
 * Croissance (chaque heure de jeu, si la croissance est active) : pour chaque type de zone dont le secteur a une
 * demande positive, `demande × naissancesParHeure` tentatives (partie fractionnaire tirée au sort, PRNG du module).
 * Une tentative choisit une case zonée libre et desservie à au plus trois rangées de la route, puis un bâtiment
 * du niveau 1 de la zone ; il est posé FAÇADE VERS LA ROUTE avec la même règle que l'outil de pose du joueur
 * (src/client/tools/snapping.ts : façade perpendiculaire à la tangente locale, recul de 0,6 m après le trottoir),
 * et seulement si son emprise tient dans des cases de la même zone. Case INTÉRIEURE (2e ou 3e rangée) : le
 * bâtiment est posé derrière la rangée de devant, façade au bord de la case, desservi par une allée (accès des lots
 * privés : PRIVATE_ACCESS_MARGIN_M, src/sim/world.ts) — toute la profondeur peinte par l'outil se construit. La pose passe par `ctx.development.place`
 * (contrôles de la simulation de base, sans coût pour la ville) : le module « chantiers », s'il est présent,
 * ouvre alors un chantier comme pour toute pose.
 *
 * Densification (chaque jour) : un bâtiment né du zonage, assez âgé, dans un quartier VALORISÉ (valeur ≥ seuil
 * du niveau) et dont le secteur est demandé, est remplacé par un bâtiment du niveau supérieur de la même zone,
 * aligné sur la même façade. En cas d'échec de la pose (pente, collision), l'ancien bâtiment est reposé.
 *
 * Valeur d'un quartier (0..1, `landValue`) : occupation du bâtiment, services publics proches, densité bâtie
 * voisine, demande du secteur, moins la proximité de l'industrie pour les zones non industrielles.
 * Les bâtiments posés par le joueur ne sont jamais démolis ni remplacés par le zonage.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { governanceModifiers } from '../../shared/governance';
import type { CatalogAsset } from '../../shared/catalog';
import { TILE_SIZE } from '../../shared/constants';
import { angleToRot, buildingGap, footprintObb, obbAabb, obbOverlap, obbToLocal, obbToWorld, type Obb } from '../../shared/footprint';
import { FACADE_GAP, facadeGap, obbParallel, phaseFromObb, pickPhase, roadGridFrame, snapAlong, type RoadGridFrame } from '../../shared/road-grid';
import { GridField, type ObbQuery } from '../../shared/grid-field';
import {
  ZONE_COUNT, ZONE_TYPES, zoneOf,
  type DemandSector, type ZonageDelta, type ZonageDemand, type ZonageDemandInputs, type ZonageSnapshot, type ZonageStats, type ZoneCode, type ZoneType,
} from '../../shared/protocol-ext/zonage';
import type { PluginContext } from '../plugins/types';
import { buildZoneCatalog, maxLevelOf, type ZoneAsset, type ZoneCatalog } from './catalog';
import {
  computeDemand, DEFAULT_DEMAND_TUNING, DEMAND_PROVIDER_SERVICE, smoothDemand, zeroDemand,
  type DemandInputs, type DemandProvider, type DemandTuning,
} from './demand';
import { MIN_EDGE_M, ZoneGrid } from './grid';
import { RoadGeometry, type RoadHit } from './roads';
import type { ZonageSave } from './save';
import { DEFAULT_RESSOURCES_TUNING } from '../ressources/model';

/** Réglages de la croissance et de la densification (avec ceux de la demande : commande `tuning`). */
export interface GrowthTuning {
  /** Tentatives par heure de jeu pour une demande de 1, par type de zone. */
  naissancesParHeure: number;
  /** Plafond de bâtiments nés par heure et par type de zone. */
  maxParHeure: number;
  /** Demande minimale pour qu'une zone pousse. */
  demandeMin: number;
  /** Chantiers simultanés au-delà desquels la croissance attend (si le module chantiers est présent). */
  maxChantiers: number;
  /** Âge minimal (jours de jeu) avant densification. */
  ageMinJours: number;
  /** Seuils de valeur pour passer du niveau 1 au 2, et du 2 au 3. */
  seuilNiveau2: number;
  seuilNiveau3: number;
  /** Probabilité quotidienne de densifier un bâtiment éligible ; plafond par jour. */
  probaDensification: number;
  maxDensificationsParJour: number;
  /** Demande minimale du secteur pour densifier. */
  demandeMinDensification: number;
}

export const DEFAULT_GROWTH_TUNING: Readonly<GrowthTuning> = Object.freeze({
  naissancesParHeure: 1.2,
  maxParHeure: 3,
  demandeMin: 0.05,
  maxChantiers: 16,
  ageMinJours: 20,
  seuilNiveau2: 0.6,
  seuilNiveau3: 0.72,
  probaDensification: 0.35,
  maxDensificationsParJour: 2,
  demandeMinDensification: 0.1,
});

export type ZonageTuning = DemandTuning & GrowthTuning;
const DEFAULT_TUNING: Readonly<ZonageTuning> = Object.freeze({ ...DEFAULT_DEMAND_TUNING, ...DEFAULT_GROWTH_TUNING });

/** Recul (m) entre le bord du trottoir et la façade (même valeur que l'outil de pose du joueur). */
export const FRONT_GAP = FACADE_GAP;
/** Une case est « de première rangée » si son centre est à moins de cette distance du bord de la route. */
const FRONT_ROW_M = TILE_SIZE + 1.5;
/** Cases constructibles : centre à moins de cette distance du bord de la route (trois rangées, profondeur par défaut de l'outil). */
export const BUILD_DEPTH_M = 3 * TILE_SIZE + 1.5;
/** Échecs consécutifs de croissance résidentielle au-delà desquels la zone est considérée pleine (indice « need-roads »). */
const FULL_AFTER_FAILS = 6;
/**
 * Zone pleine (allègement, partie de 11 000 habitants : ≈ 100 ms de calcul à chaque heure de jeu pour des poses qui
 * échouent toutes) : après ce nombre d'échecs consécutifs dans une zone, ses tentatives sont suspendues tant que rien
 * ne change (zonage, routes, bâtiments), et au plus STALL_HOURS heures de jeu (nouvel essai ensuite).
 */
const STALL_AFTER_FAILS = 12;
const STALL_HOURS = 24;
const SAMPLE_INSET = 1.2;
const MINUTES_PER_DAY = 1440;

interface Owned { zone: ZoneCode; level: number; born: number }

/**
 * Service facultatif publié par le module « ressources » : demande brute (−1..1) des zones forêt et agricole à
 * partir de la demande industrielle lissée ; null = repli sur la demande industrielle.
 */
export interface SpecialDemandProvider {
  demand(zone: 'foret' | 'agricole', industryDemand: number): number | null;
}
export const SPECIAL_DEMAND_SERVICE = 'ressources:demande';

/** Service publié par le zonage (lecture seule) pour les modules qui exploitent les zones (ressources). */
export interface ZonageEtat {
  readonly active: boolean;
  /** Change à chaque modification des zones (peinture, chargement, nouvelle partie). */
  readonly version: number;
  /** Côté d'une case (m). */
  readonly cell: number;
  cellsOf(zone: ZoneType): readonly number[];
  zoneAt(idx: number): ZoneType | null;
  index(x: number, z: number): number;
  centerX(idx: number): number;
  centerZ(idx: number): number;
  /** Identifiants des bâtiments nés du zonage dans une zone. */
  buildingsOf(zone: ZoneType): number[];
  /** Demande lissée d'une zone (zones spécialisées comprises). */
  demandOf(zone: ZoneType): number;
}
export const ZONAGE_ETAT_SERVICE = 'zonage:etat';

const RES_ZONES: readonly ZoneType[] = ['res_faible', 'res_moyen', 'res_dense'];
const INDUSTRY_ZONES: readonly ZoneType[] = ['industrie', 'foret', 'agricole'];

/** Service « chantiers » (facultatif) : nombre de chantiers en cours, bâtiment en chantier. */
interface ChantiersLike { readonly nombre: number; enChantier(id: number): boolean }

const jobsSector = (a: CatalogAsset): DemandSector | 'public' | null => {
  if (a.capacity.jobs <= 0) return null;
  switch (a.category) {
    case 'skyscraper': return 'B';
    case 'industrial': return 'I';
    case 'public': return 'public';
    case 'commercial': return a.tags.includes('bureaux') || a.tags.includes('tertiaire') ? 'B' : 'C';
    default: return 'C';
  }
};

/** Normale locale de façade (rot = 0), ramenée à l'axe dominant (même règle que l'outil de pose). */
export function localFacade(a: CatalogAsset): [number, number] {
  const f = a.frontage[0];
  if (!f) return [0, 1];
  return Math.abs(f.nz) >= Math.abs(f.nx) ? [0, Math.sign(f.nz) || 1] : [Math.sign(f.nx), 0];
}

/** Demi-étendue d'une empreinte orientée selon la direction unitaire (ux, uz). */
function extentAlong(o: { hx: number; hz: number; c: number; s: number }, ux: number, uz: number): number {
  return o.hx * Math.abs(o.c * ux - o.s * uz) + o.hz * Math.abs(o.s * ux + o.c * uz);
}

export class ZoningSystem {
  readonly grid = new ZoneGrid();
  readonly roads = new RoadGeometry();
  zcat: ZoneCatalog = buildZoneCatalog(null);
  readonly owned = new Map<number, Owned>();
  demand: ZonageDemand = zeroDemand();
  /** Demande lissée des zones forêt et agricole (service « ressources », sinon demande industrielle). */
  special = { foret: 0, agricole: 0 };
  inputs: ZonageDemandInputs | null = null;
  growth = true;
  tuning: ZonageTuning = { ...DEFAULT_TUNING };
  grown = 0;
  densified = 0;
  /** Vrai dès qu'une zone a été peinte (ou chargée) : sinon le module est totalement inerte. */
  active = false;
  private lastHour = -1;
  /** Recalage des lots chargés sur la trame à faire au prochain tick (voir `realign`). */
  private realignPending = false;
  /** Cases résidentielles zonées / libres constructibles (recomptées chaque heure), échecs consécutifs de croissance R. */
  private lots = { zoned: 0, free: 0 };
  private resFails = 0;
  /** Échecs consécutifs par zone et suspensions en cours (signature du monde, heure de reprise). */
  private zoneFails = new Array<number>(ZONE_COUNT + 1).fill(0);
  private stalls = new Map<number, { sig: string; until: number }>();
  /** Signature du monde du dernier comptage des lots (recompté seulement si elle change). */
  private lotsSig = '';
  private demandDirty = false;
  private statsDirty = false;
  private settingsDirty = false;
  private readonly q: number[] = [];
  private readonly qf: number[] = [];
  /** Champ de trames du quadrillage (src/shared/grid-field.ts) : mêmes lignes que l'affichage du client. */
  private fieldCache: { gen: number; buildings: unknown; field: GridField } | null = null;

  /* ------------------------------ Cycle de vie ------------------------------ */

  setCatalog(ctx: PluginContext): void { this.zcat = buildZoneCatalog(ctx.catalog); }

  reset(ctx: PluginContext): void {
    this.grid.reset(ctx.inGame ? ctx.terrain.bounds() : null);
    this.roads.invalidate();
    this.owned.clear();
    this.demand = zeroDemand();
    this.special = { foret: 0, agricole: 0 };
    this.inputs = null;
    this.growth = true;
    this.tuning = { ...DEFAULT_TUNING };
    this.grown = 0;
    this.densified = 0;
    this.active = false;
    this.lots = { zoned: 0, free: 0 };
    this.resFails = 0;
    this.zoneFails.fill(0);
    this.stalls.clear();
    this.lotsSig = '';
    this.realignPending = false;
    this.lastHour = Math.floor(ctx.clock.totalMinutes / 60);
    this.demandDirty = this.statsDirty = this.settingsDirty = false;
    this.zcat = buildZoneCatalog(ctx.catalog);
  }

  private activate(): void {
    if (this.active) return;
    this.active = true;
    this.demandDirty = this.statsDirty = this.settingsDirty = true;
  }

  /**
   * Champ de trames du quadrillage affiché (routes de la simulation, empreintes lues en direct dans l'index des
   * bâtiments) : cases de la trame des routes pour la peinture, l'emprise des zones et la pose.
   */
  field(ctx: PluginContext): GridField {
    this.syncRoads(ctx);
    const b = ctx.buildings;
    const c = this.fieldCache;
    if (c && c.gen === this.roads.generation && c.buildings === b) return c.field;
    const ids = this.qf;
    const query: ObbQuery = (x0, z0, x1, z1, out) => {
      out.length = 0;
      const st = b.store;
      for (const id of b.query(x0, z0, x1, z1, ids)) {
        const k = b.indexOf(id);
        if (k >= 0) out.push(footprintObb(st.tilesX[k]!, st.tilesZ[k]!, st.x[k]!, st.z[k]!, st.rot[k]!));
      }
      return out;
    };
    const field = new GridField(this.roads.fieldRoads, query);
    this.fieldCache = { gen: this.roads.generation, buildings: b, field };
    return field;
  }

  /** Synchronise la géométrie des routes ; met à jour la desserte des cases si le réseau a changé. */
  private syncRoads(ctx: PluginContext): void {
    if (this.roads.sync(ctx.roads)) { this.grid.refreshConnectivity(this.roads); this.statsDirty = true; }
  }

  tick(ctx: PluginContext): void {
    if (!this.active || !ctx.inGame) return;
    this.syncRoads(ctx);
    // Partie chargée : anciens lots hors de leur case recalés sur la trame (une fois, au premier tick).
    if (this.realignPending) { this.realignPending = false; this.realign(ctx); }
    const hour = Math.floor(ctx.clock.totalMinutes / 60);
    if (hour === this.lastHour) return;
    this.lastHour = hour;
    this.prune(ctx);
    this.updateDemand(ctx);
    if (this.growth) this.growHour(ctx);
    this.countLots(ctx);
  }

  /** Cases résidentielles zonées et libres constructibles (desservies, à trois rangées au plus, non bâties). */
  private countLots(ctx: PluginContext): void {
    const sig = this.worldSig(ctx);
    if (sig === this.lotsSig) return;
    this.lotsSig = sig;
    let zoned = 0, free = 0;
    for (const t of ['res_faible', 'res_moyen', 'res_dense'] as const) {
      const code = ZONE_TYPES.indexOf(t) + 1;
      for (const idx of this.grid.cellsOf(code as ZoneCode)) {
        zoned++;
        if (this.grid.edgeM(idx) > BUILD_DEPTH_M || !this.grid.connected(idx)) continue;
        if (!this.occupied(ctx, this.grid.centerX(idx), this.grid.centerZ(idx), 2.5)) free++;
      }
    }
    this.lots = { zoned, free };
  }

  /**
   * Zonage résidentiel pour l'indice de croissance de la démographie : cases zonées, cases libres constructibles
   * (0 si les dernières tentatives de croissance ont toutes échoué : il reste des cases, mais trop petites ou
   * enclavées), demande R lissée.
   */
  residentialLots(): { zoned: number; free: number; demand: number } {
    return { zoned: this.lots.zoned, free: this.resFails >= FULL_AFTER_FAILS ? 0 : this.lots.free, demand: this.demand.R };
  }

  day(ctx: PluginContext): void {
    if (!this.active || !ctx.inGame || !this.growth) return;
    this.syncRoads(ctx);
    this.densifyDay(ctx);
  }

  /** Oublie les bâtiments démolis par le joueur. */
  private prune(ctx: PluginContext): void {
    for (const id of [...this.owned.keys()]) if (ctx.buildings.indexOf(id) < 0) { this.owned.delete(id); this.statsDirty = true; }
  }

  /* ------------------------------- Demande ------------------------------- */

  /** Entrées du modèle lues dans la simulation de base. */
  readInputs(ctx: PluginContext): DemandInputs {
    const jobs: DemandInputs['jobsBySector'] = { R: 0, C: 0, B: 0, I: 0, public: 0 };
    const b = ctx.buildings, st = b.store, cat = ctx.catalog;
    for (let i = 0; i < b.count; i++) {
      if (!st.roadAccess[i]) continue;
      const a = cat?.assets[st.assetIndex[i]!];
      if (!a) continue;
      const s = jobsSector(a);
      if (s) jobs[s] += a.capacity.jobs;
    }
    const demo = ctx.demography;
    let population = demo?.population ?? 0, workforce = population * 0.6, housingCapacity = 0, housingFree = 0;
    if (demo) {
      const r = demo.report();
      population = r.population;
      workforce = r.laborForce;
      housingCapacity = r.housingCapacity;
      housingFree = r.housingFree;
    }
    const tr = ctx.economy.taxRates;
    return {
      population, workforce, jobsBySector: jobs, housingCapacity, housingFree,
      tax: { R: tr.residential, C: tr.commercial, B: tr.office, I: tr.industrial },
    };
  }

  updateDemand(ctx: PluginContext): void {
    const inp = this.readInputs(ctx);
    const ext = ctx.use<DemandProvider>(DEMAND_PROVIDER_SERVICE);
    let raw: ZonageDemand | null = null;
    try { raw = ext?.demand(inp) ?? null; } catch { raw = null; }
    const source = raw ? 'externe' : 'zonage';
    raw ??= computeDemand(inp, this.tuning);
    // Politiques et recherche : bonus de demande par secteur (borné comme la demande calculée).
    const gd = governanceModifiers((n) => ctx.use(n)).demand;
    if (gd.R || gd.C || gd.I || gd.B) {
      const cl = (v: number): number => Math.max(-1, Math.min(1, v));
      raw = { R: cl(raw.R + gd.R), C: cl(raw.C + gd.C), I: cl(raw.I + gd.I), B: cl(raw.B + gd.B) };
    }
    smoothDemand(this.demand, raw, this.tuning.lissage);
    // Zones spécialisées : demande fournie par le module « ressources » (manque de bois / de nourriture), lissée.
    const sp = ctx.use<SpecialDemandProvider>(SPECIAL_DEMAND_SERVICE);
    const a = Math.max(0, Math.min(1, this.tuning.lissage));
    for (const z of ['foret', 'agricole'] as const) {
      let v: number | null = null;
      try { v = sp?.demand(z, this.demand.I) ?? null; } catch { v = null; }
      const target = v === null || !Number.isFinite(v) ? this.demand.I : Math.max(-1, Math.min(1, v));
      this.special[z] = Math.max(-1, Math.min(1, this.special[z] + (target - this.special[z]) * a));
    }
    this.inputs = {
      population: inp.population, workforce: Math.round(inp.workforce), jobs: inp.jobsBySector.R + inp.jobsBySector.C + inp.jobsBySector.B + inp.jobsBySector.I + inp.jobsBySector.public,
      jobsBySector: { ...inp.jobsBySector }, housingCapacity: inp.housingCapacity, housingFree: inp.housingFree, source,
    };
    this.demandDirty = true;
  }

  /**
   * Demande d'une zone : celle de son secteur ; zone mixte = moyenne des parts positives de R et C (elle pousse si
   * l'un des deux secteurs est demandé) ; forêt et agricole = demande spécialisée.
   */
  zoneDemand(zone: ZoneType): number {
    switch (zone) {
      case 'res_faible': case 'res_moyen': case 'res_dense': return this.demand.R;
      case 'commerce': return this.demand.C;
      case 'bureaux': return this.demand.B;
      case 'industrie': return this.demand.I;
      case 'foret': return this.special.foret;
      case 'agricole': return this.special.agricole;
      case 'mixte': {
        const r = this.demand.R, c = this.demand.C;
        return r > 0 || c > 0 ? 0.5 * (Math.max(0, r) + Math.max(0, c)) : Math.max(r, c);
      }
    }
  }

  /* ------------------------------- Peinture ------------------------------- */

  /**
   * Condition de terrain des zones spécialisées : forêt naturelle (densité ≥ `foretMin`) pour l'exploitation
   * forestière ; sol fertile et plat (fertilité ≥ `fertiliteMin`) pour l'agricole. Sans accès au terrain (façade de
   * test), aucune condition.
   */
  terrainRule(ctx: PluginContext, zone: ZoneType | null): ((x: number, z: number) => boolean) | undefined {
    const t = ctx.terrain;
    const forestAt = t.forestAt, fertilityAt = t.fertilityAt;
    if (zone === 'foret' && forestAt) return (x, z) => forestAt(x, z) >= DEFAULT_RESSOURCES_TUNING.foretMin;
    if (zone === 'agricole' && fertilityAt) return (x, z) => fertilityAt(x, z) >= DEFAULT_RESSOURCES_TUNING.fertiliteMin;
    return undefined;
  }

  paint(ctx: PluginContext, points: readonly number[], zone: ZoneType | null, depth: number, radius: number): number {
    if (!this.grid.info) this.grid.reset(ctx.terrain.bounds());
    this.syncRoads(ctx);
    const code = (zone ? ZONE_TYPES.indexOf(zone) + 1 : 0) as ZoneCode;
    // Cases du quadrillage affiché (trame des routes), écrites dans la grille du monde sauvegardée.
    const n = this.grid.paintRoadCells(points, code, depth, radius, this.roads, this.field(ctx), (x, z) => ctx.terrain.isWet(x, z), this.terrainRule(ctx, zone));
    if (n > 0 || code !== 0) this.activate();
    if (n > 0) this.statsDirty = true;
    if (this.active && !this.inputs) this.updateDemand(ctx);
    return n;
  }

  /* ------------------------------- Croissance ------------------------------- */

  private chantiersBusy(ctx: PluginContext): boolean {
    const c = ctx.use<ChantiersLike>('chantiers');
    try { return !!c && typeof c.nombre === 'number' && c.nombre >= this.tuning.maxChantiers; } catch { return false; }
  }

  /**
   * Signature du monde vue par la croissance : zonage, réseau routier, bâtiments (nombre, identifiants, positions).
   * Même signature = mêmes cases libres : un comptage ou une tentative refaits donneraient le même résultat.
   */
  private worldSig(ctx: PluginContext): string {
    const st = ctx.buildings.store;
    let h = 0;
    for (let i = 0; i < ctx.buildings.count; i++) h = (h * 31 + st.id[i]! + Math.round(st.x[i]! * 4) * 7 + Math.round(st.z[i]! * 4) * 13 + st.rot[i]!) | 0;
    return `${this.grid.version}|${ctx.roads.version}|${ctx.buildings.count}|${h}`;
  }

  growHour(ctx: PluginContext): number {
    if (!ctx.development || this.chantiersBusy(ctx)) return 0;
    let grown = 0;
    const hour = Math.floor(ctx.clock.totalMinutes / 60);
    let sig: string | null = null;
    this.zoneMemo = new Map();
    try {
    for (let code = 1; code <= ZONE_COUNT; code++) {
      if (this.grid.counts[code] === 0) continue;
      const zone = zoneOf(code)!;
      const d = this.zoneDemand(zone);
      if (d < this.tuning.demandeMin) continue;
      // Zone suspendue (pleine) : rien n'a changé depuis et la reprise n'est pas encore due.
      const stall = this.stalls.get(code);
      if (stall) {
        sig ??= this.worldSig(ctx);
        if (stall.sig === sig && hour < stall.until) continue;
        this.stalls.delete(code);
        this.zoneFails[code] = 0;
      }
      const expected = d * this.tuning.naissancesParHeure;
      const n = Math.min(this.tuning.maxParHeure, Math.floor(expected + ctx.rng.next()));
      const residential = RES_ZONES.includes(zone);
      for (let k = 0; k < n; k++) {
        const ok = this.tryGrow(ctx, code as ZoneCode);
        if (ok) grown++;
        this.zoneFails[code] = ok ? 0 : this.zoneFails[code]! + 1;
        if (residential) this.resFails = ok ? 0 : this.resFails + 1;
      }
      if (this.zoneFails[code]! >= STALL_AFTER_FAILS) {
        if (grown > 0 || sig === null) sig = this.worldSig(ctx); // un bâtiment posé cette heure change la signature
        this.stalls.set(code, { sig, until: hour + STALL_HOURS });
      }
    }
    } finally { this.zoneMemo = null; }
    return grown;
  }

  /** Une tentative de croissance dans une zone ; vrai si un bâtiment a été posé. */
  tryGrow(ctx: PluginContext, code: ZoneCode): boolean {
    const dev = ctx.development;
    const zone = zoneOf(code);
    if (!dev || !zone) return false;
    const list = this.zcat[zone];
    if (list.length === 0) return false;
    const cells = this.grid.cellsOf(code);
    if (cells.length === 0) return false;
    const minLevel = list[0]!.level;
    const starters = list.filter((e) => e.level === minLevel);
    for (let attempt = 0; attempt < 16; attempt++) {
      const idx = cells[Math.floor(ctx.rng.next() * cells.length)]!;
      const edge = this.grid.edgeM(idx);
      if (edge > BUILD_DEPTH_M) continue;
      const interior = edge > FRONT_ROW_M;
      const cx = this.grid.centerX(idx), cz = this.grid.centerZ(idx);
      if (this.occupied(ctx, cx, cz, 2.5)) continue;
      const hit = this.roads.nearest(cx, cz, interior ? BUILD_DEPTH_M + 2 : FRONT_ROW_M);
      if (!hit) continue;
      // Ordre aléatoire des modèles, en préférant les moins représentés (variété des rues).
      const order = this.shuffleByRarity(ctx, starters);
      for (const e of order.slice(0, 4)) {
        const id = interior ? this.placeBehind(ctx, e, code, hit, cx, cz, edge) : this.placeFacing(ctx, e, code, hit, cx, cz);
        if (id > 0) {
          this.zoneMemo?.clear(); // nouveau bâtiment : la trame alentour peut changer
          this.owned.set(id, { zone: code, level: e.level, born: ctx.clock.totalMinutes });
          this.grown++;
          this.statsDirty = true;
          return true;
        }
      }
    }
    return false;
  }

  private shuffleByRarity(ctx: PluginContext, list: readonly ZoneAsset[]): ZoneAsset[] {
    const count = new Map<number, number>();
    const st = ctx.buildings.store;
    for (const id of this.owned.keys()) {
      const i = ctx.buildings.indexOf(id);
      if (i >= 0) count.set(st.assetIndex[i]!, (count.get(st.assetIndex[i]!) ?? 0) + 1);
    }
    return list.map((e) => ({ e, k: ctx.rng.next() / (1 + (count.get(e.index) ?? 0)) })).sort((a, b) => b.k - a.k).map((x) => x.e);
  }

  /**
   * Vrai si l'emprise d'un bâtiment passe à moins de `r` m de (x, z). L'index spatial ne renvoie que des
   * CANDIDATS (par chunk) : le test exact se fait sur l'empreinte orientée.
   */
  private occupied(ctx: PluginContext, x: number, z: number, r: number): boolean {
    const b = ctx.buildings, st = b.store;
    for (const id of b.query(x - r, z - r, x + r, z + r, this.q)) {
      const k = b.indexOf(id);
      if (k < 0) continue;
      const o = footprintObb(st.tilesX[k]!, st.tilesZ[k]!, st.x[k]!, st.z[k]!, st.rot[k]!);
      const [lx, lz] = obbToLocal(o, x, z);
      if (Math.abs(lx) <= o.hx + r && Math.abs(lz) <= o.hz + r) return true;
    }
    return false;
  }

  /** Rotation et normale (côté de la case) pour un modèle face à la route. */
  private orient(a: CatalogAsset, hit: RoadHit, px: number, pz: number): { rot: number; nx: number; nz: number } {
    let nx = -hit.tz, nz = hit.tx;
    if ((px - hit.x) * nx + (pz - hit.z) * nz < 0) { nx = -nx; nz = -nz; }
    const [lx, lz] = localFacade(a);
    return { rot: angleToRot(Math.atan2(-nx, -nz) - Math.atan2(lx, lz)), nx, nz };
  }

  /**
   * Positions candidates d'un bâtiment dont le centre est près de (bx, bz), TOUTES sur la trame locale de la route
   * (src/shared/road-grid.ts : côtés de l'empreinte sur les lignes du quadrillage affiché, phase du voisin parallèle
   * le plus proche) : case la plus proche puis ses voisines. Aucun repli hors trame (un bâtiment qui déborde de sa
   * case gênerait le tracé des routes calées sur le quadrillage) : si rien ne tient, on ne construit pas là.
   */
  private candidates(ctx: PluginContext, hit: RoadHit, probe: Obb, bx: number, bz: number, gridSteps = 2): [number, number][] {
    const out: [number, number][] = [];
    const r2 = (v: number): number => Math.round(v * 100) / 100;
    const f = this.gridFrame(ctx, hit, bx, bz);
    const halfAlong = extentAlong(probe, f.tx, f.tz);
    const steps = [0];
    for (let k = 1; k <= gridSteps; k++) steps.push(k, -k);
    for (const step of steps) {
      const [x, z] = snapAlong(f, bx, bz, halfAlong, step);
      out.push([r2(x), r2(z)]);
    }
    return out;
  }

  /**
   * Trame de la route `hit` en (x, z) : celle du champ (quadrillage affiché) si elle suit cette route, sinon la trame
   * de la route recalée sur le voisin parallèle (comportement précédent).
   */
  private gridFrame(ctx: PluginContext, hit: RoadHit, x: number, z: number): RoadGridFrame {
    const f = roadGridFrame(hit.x, hit.z, hit.tx, hit.tz, hit.half);
    const g = this.field(ctx).roadFrameAt(x, z);
    const s = g && g.tx * f.tx + g.tz * f.tz > 0 ? 1 : -1;
    if (g && Math.abs(g.tx * f.tx + g.tz * f.tz) > 0.9995 && Math.abs(g.cn - s * f.cn) < 0.6 && Math.abs(g.offset - f.offset) < 0.01) {
      f.phase = ((s * g.phase) % f.cell + f.cell) % f.cell;
      return f;
    }
    const st = ctx.buildings.store, obbs: Obb[] = [];
    for (const id of ctx.buildings.query(x - 90, z - 90, x + 90, z + 90, this.q)) {
      const k = ctx.buildings.indexOf(id);
      if (k >= 0) obbs.push(footprintObb(st.tilesX[k]!, st.tilesZ[k]!, st.x[k]!, st.z[k]!, st.rot[k]!));
    }
    f.phase = pickPhase(f, obbs, x, z);
    return f;
  }

  /** Zone affichée au point (x, z) : celle de la case du monde sous le centre de la case de la trame qui le contient. */
  private zoneUnder(field: GridField, x: number, z: number): { idx: number; cx: number; cz: number } {
    const memo = this.zoneMemo;
    const key = memo ? `${x},${z}` : '';
    const hit = memo?.get(key);
    if (hit) return hit;
    const c = field.cellAt(x, z);
    const u = { idx: this.grid.index(c.cx, c.cz), cx: c.cx, cz: c.cz };
    memo?.set(key, u);
    return u;
  }
  /**
   * Cache de `zoneUnder` pendant une passe de croissance (allègement) : la trame dépend des routes et des bâtiments,
   * qui ne changent pas pendant la passe sauf quand elle pose un bâtiment (cache alors vidé). Clé : point exact.
   */
  private zoneMemo: Map<string, { idx: number; cx: number; cz: number }> | null = null;

  /**
   * Vrai si l'emprise tient dans des cases de la zone `code` (ou dans la bande non zonable du bord de route) : cases
   * de la trame des routes, comme l'affichage de l'outil Zones (zone de la case du monde sous leur centre).
   */
  fits(a: CatalogAsset, x: number, z: number, rot: number, code: number, segId: number, field?: GridField): boolean {
    const o = footprintObb(a.footprint.tilesX, a.footprint.tilesZ, x, z, rot);
    const ix = Math.max(0, o.hx - SAMPLE_INSET), iz = Math.max(0, o.hz - SAMPLE_INSET);
    const nxs = Math.max(2, a.footprint.tilesX + 1), nzs = Math.max(2, a.footprint.tilesZ + 1);
    for (let j = 0; j < nzs; j++) {
      for (let i = 0; i < nxs; i++) {
        const [sx, sz] = obbToWorld(o, -ix + (2 * ix * i) / (nxs - 1), -iz + (2 * iz * j) / (nzs - 1));
        if (field) {
          const u = this.zoneUnder(field, sx, sz);
          if (u.idx < 0) return false;
          if (this.grid.zone[u.idx] === code) continue;
          // Case de bord de route (jamais zonée) : tolérée côté façade.
          if (this.grid.zone[u.idx] === 0 && this.roads.edgeDistance(segId, u.cx, u.cz) < MIN_EDGE_M + 0.5) continue;
          return false;
        }
        const idx = this.grid.index(sx, sz);
        if (idx < 0) return false;
        if (this.grid.zone[idx] === code) continue;
        // Case de bord de route (jamais zonée) : tolérée côté façade.
        if (this.grid.zone[idx] === 0 && this.roads.edgeDistance(segId, this.grid.centerX(idx), this.grid.centerZ(idx)) < MIN_EDGE_M + 0.5) continue;
        return false;
      }
    }
    return true;
  }

  /** Pose `e` face à la route près de la case (cx, cz) ; identifiant du bâtiment, 0 si impossible. */
  private placeFacing(ctx: PluginContext, e: ZoneAsset, code: ZoneCode, hit: RoadHit, cx: number, cz: number): number {
    const a = e.asset;
    const field = this.field(ctx);
    const { rot, nx, nz } = this.orient(a, hit, cx, cz);
    const probe = footprintObb(a.footprint.tilesX, a.footprint.tilesZ, 0, 0, rot);
    const halfDepth = extentAlong(probe, nx, nz);
    const s = hit.half + halfDepth + facadeGap(hit.half);
    for (const [x, z] of this.candidates(ctx, hit, probe, hit.x + nx * s, hit.z + nz * s)) {
      if (!this.fits(a, x, z, rot, code, hit.segId, field)) continue;
      const variant = a.variants.length > 0 ? Math.floor(ctx.rng.next() * a.variants.length) : -1;
      const r = ctx.development!.place({ assetId: a.id, x, z, rot, variant });
      if (r.ok) return r.data.buildingId;
    }
    return 0;
  }

  /**
   * Case intérieure (2e ou 3e rangée) : pose `e` face à la route, façade au bord de la case côté route (derrière la
   * rangée de devant), desservi par une allée. Collisions vérifiées avant la pose (essais peu coûteux).
   */
  private placeBehind(ctx: PluginContext, e: ZoneAsset, code: ZoneCode, hit: RoadHit, cx: number, cz: number, edge: number): number {
    const a = e.asset;
    const field = this.field(ctx);
    const { rot, nx, nz } = this.orient(a, hit, cx, cz);
    const probe = footprintObb(a.footprint.tilesX, a.footprint.tilesZ, 0, 0, rot);
    const halfDepth = extentAlong(probe, nx, nz);
    const gap = facadeGap(hit.half);
    const front0 = Math.max(gap, edge - TILE_SIZE / 2);
    // Façade sur une ligne de la trame de la route (recul + k × 8 m depuis le bord) : rangée la plus proche, la
    // suivante, puis la ligne des façades si la rangée de devant est encore libre. Aucun recul hors trame.
    const k0 = Math.max(1, Math.round((front0 - gap) / TILE_SIZE));
    const fronts = [k0, k0 + 1, k0 - 1].map((k) => gap + k * TILE_SIZE);
    for (let fi = 0; fi < fronts.length; fi++) {
      const s = hit.half + fronts[fi]! + halfDepth;
      for (const [x, z] of this.candidates(ctx, hit, probe, hit.x + nx * s, hit.z + nz * s)) {
        if (!this.fits(a, x, z, rot, code, hit.segId, field)) continue;
        if (this.collidesOthers(ctx, a, x, z, rot, -1)) continue;
        const variant = a.variants.length > 0 ? Math.floor(ctx.rng.next() * a.variants.length) : -1;
        const r = ctx.development!.place({ assetId: a.id, x, z, rot, variant });
        if (r.ok) return r.data.buildingId;
      }
    }
    return 0;
  }

  /* ------------------------------ Densification ------------------------------ */

  /** Valeur du quartier autour d'un bâtiment (0..1). */
  landValue(ctx: PluginContext, id: number): number {
    const b = ctx.buildings, i = b.indexOf(id);
    if (i < 0) return 0;
    const st = b.store, a = ctx.catalog?.assets[st.assetIndex[i]!];
    if (!a) return 0;
    const x = st.x[i]!, z = st.z[i]!;
    const cap = Math.max(0, a.capacity.residents) + Math.max(0, a.capacity.jobs);
    const occ = cap > 0 ? Math.min(1, (st.residents[i]! + st.workers[i]!) / cap) : 0;
    let services = 0, neighbors = 0, industry = 0;
    const R = 350;
    for (const nid of b.query(x - R, z - R, x + R, z + R, this.q)) {
      if (nid === id) continue;
      const k = b.indexOf(nid);
      if (k < 0) continue;
      const na = ctx.catalog?.assets[st.assetIndex[k]!];
      if (!na) continue;
      const d = Math.hypot(st.x[k]! - x, st.z[k]! - z);
      if (na.category === 'public') services++;
      if (d <= 80) neighbors++;
      if (na.category === 'industrial' && d <= 140) industry++;
    }
    const code = this.owned.get(id)?.zone ?? 0;
    const zone = zoneOf(code);
    const sectorDemand = zone ? Math.max(0, this.zoneDemand(zone)) : 0;
    const nuisance = zone && !INDUSTRY_ZONES.includes(zone) ? 0.3 * Math.min(1, industry / 2) : 0;
    const v = 0.2 + 0.25 * occ + 0.2 * Math.min(1, services / 3) + 0.2 * Math.min(1, neighbors / 8) + 0.15 * sectorDemand - nuisance;
    return Math.max(0, Math.min(1, v));
  }

  densifyDay(ctx: PluginContext): number {
    if (!ctx.development) return 0;
    const chantiers = ctx.use<ChantiersLike>('chantiers');
    const now = ctx.clock.totalMinutes;
    const t = this.tuning;
    const eligible: number[] = [];
    for (const [id, o] of this.owned) {
      const zone = zoneOf(o.zone);
      if (!zone) continue;
      if (o.level >= maxLevelOf(this.zcat[zone])) continue;
      if (now - o.born < t.ageMinJours * MINUTES_PER_DAY) continue;
      if (this.zoneDemand(zone) < t.demandeMinDensification) continue;
      try { if (chantiers?.enChantier(id)) continue; } catch { /* service facultatif */ }
      const i = ctx.buildings.indexOf(id);
      if (i < 0) continue;
      // La zone doit toujours être là (zonage retiré : le bâtiment reste, sans évoluer).
      const idx = this.grid.index(ctx.buildings.store.x[i]!, ctx.buildings.store.z[i]!);
      if (idx < 0 || this.grid.zone[idx] !== o.zone) continue;
      if (this.landValue(ctx, id) < (o.level >= 2 ? t.seuilNiveau3 : t.seuilNiveau2)) continue;
      eligible.push(id);
    }
    let done = 0;
    for (const id of eligible) {
      if (done >= t.maxDensificationsParJour) break;
      if (ctx.rng.next() > t.probaDensification) continue;
      if (this.upgrade(ctx, id)) done++;
    }
    return done;
  }

  /** Remplace un bâtiment né du zonage par un plus grand de la même zone (même façade). */
  upgrade(ctx: PluginContext, id: number): boolean {
    const o = this.owned.get(id), dev = ctx.development;
    const zone = o ? zoneOf(o.zone) : null;
    const i = ctx.buildings.indexOf(id);
    if (!o || !zone || !dev || i < 0) return false;
    const st = ctx.buildings.store;
    const old = ctx.catalog?.assets[st.assetIndex[i]!];
    if (!old) return false;
    const ox = st.x[i]!, oz = st.z[i]!, orot = st.rot[i]!, ovar = st.variant[i]!;
    // Façade du bâtiment actuel : direction et point avant.
    const [lx, lz] = localFacade(old);
    const oo = footprintObb(old.footprint.tilesX, old.footprint.tilesZ, ox, oz, orot);
    const fx = lx * oo.c + lz * oo.s, fz = -lx * oo.s + lz * oo.c;
    const oldHalf = extentAlong(oo, fx, fz);
    const frontX = ox + fx * oldHalf, frontZ = oz + fz * oldHalf;
    const idx = this.grid.index(ox, oz);
    const segId = idx >= 0 ? this.grid.seg[idx]! : 0;
    // Route que regarde la façade : le remplaçant est recalé sur sa trame (côtés sur les lignes, comme à la naissance).
    const hit = this.roads.nearest(frontX + fx * 0.5, frontZ + fz * 0.5, BUILD_DEPTH_M + 2);
    if (!hit || Math.abs(hit.tx * fx + hit.tz * fz) > 0.1) return false;
    const next = this.zcat[zone].filter((e) => e.level === o.level + 1);
    const order = this.shuffleByRarity(ctx, next);
    for (const e of order) {
      const a = e.asset;
      const [nlx, nlz] = localFacade(a);
      const rot = angleToRot(Math.atan2(fx, fz) - Math.atan2(nlx, nlz));
      const probe = footprintObb(a.footprint.tilesX, a.footprint.tilesZ, 0, 0, rot);
      const half = extentAlong(probe, fx, fz);
      // Façade au même endroit (profondeur multiple de la case : arrière sur une ligne) ; le long de la route, case
      // de la trame la plus proche puis ses voisines.
      let pos: [number, number] | null = null;
      for (const [x, z] of this.candidates(ctx, hit, probe, frontX - fx * half, frontZ - fz * half, 1)) {
        if (!this.fits(a, x, z, rot, o.zone, segId, this.field(ctx))) continue;
        if (this.collidesOthers(ctx, a, x, z, rot, id)) continue;
        pos = [x, z];
        break;
      }
      if (!pos) continue;
      const [x, z] = pos;
      if (!dev.demolish(id).ok) return false;
      this.owned.delete(id);
      const variant = a.variants.length > 0 ? Math.floor(ctx.rng.next() * a.variants.length) : -1;
      const r = dev.place({ assetId: a.id, x, z, rot, variant });
      if (r.ok) {
        this.owned.set(r.data.buildingId, { zone: o.zone, level: e.level, born: ctx.clock.totalMinutes });
        this.densified++;
        this.statsDirty = true;
        return true;
      }
      // Échec (pente, eau…) : l'ancien bâtiment est reposé à l'identique.
      const back = dev.place({ assetId: old.id, x: ox, z: oz, rot: orot, variant: ovar });
      if (back.ok) this.owned.set(back.data.buildingId, o);
      this.statsDirty = true;
      return false;
    }
    return false;
  }

  /* ------------------------- Recalage des anciens lots ------------------------- */

  /**
   * Parties existantes : chaque lot né du zonage qui déborde de sa case (posé avant l'alignement sur la trame, ou par
   * les anciens replis hors trame) est déplacé sur la position de trame la plus proche si elle est libre (contrôles de
   * l'outil Déplacer, `ctx.development.move`) ; sinon il reste où il est. Les bâtiments du joueur ne sont jamais
   * touchés (seuls les lots possédés par le zonage sont examinés, et `move` refuse tout bâtiment non privé).
   */
  realign(ctx: PluginContext): { offGrid: number; moved: number } {
    const res = { offGrid: 0, moved: 0 };
    const dev = ctx.development;
    if (!dev?.move || !ctx.inGame) return res;
    this.syncRoads(ctx);
    const b = ctx.buildings, st = b.store;
    for (const id of [...this.owned.keys()].sort((p, q) => p - q)) {
      const i = b.indexOf(id);
      const a = i >= 0 ? ctx.catalog?.assets[st.assetIndex[i]!] : undefined;
      if (!a) continue;
      const rot = st.rot[i]!;
      const t = this.gridTarget(ctx, id, a, st.x[i]!, st.z[i]!, rot);
      if (!t) continue;
      res.offGrid++;
      if (dev.move(id, t[0], t[1], rot).ok) { res.moved++; this.statsDirty = true; }
    }
    return res;
  }

  /**
   * Position de trame la plus proche d'un lot face à sa route (façade sur une ligne en profondeur, côtés sur les
   * lignes transversales) ; null s'il est déjà dans sa case, en biais, ou loin de toute route desservante.
   * Phase le long de la route : celle de la majorité des bâtiments voisins parallèles qui regardent la même route du
   * même côté (le quadrillage affiché suit ces bâtiments), la trame propre de la route départageant (seule voix d'un
   * lot isolé).
   */
  gridTarget(ctx: PluginContext, id: number, a: CatalogAsset, x: number, z: number, rot: number): [number, number] | null {
    const cell = TILE_SIZE;
    const o = footprintObb(a.footprint.tilesX, a.footprint.tilesZ, x, z, rot);
    const [lx, lz] = localFacade(a);
    const fx = lx * o.c + lz * o.s, fz = -lx * o.s + lz * o.c;
    const halfDepth = extentAlong(o, fx, fz);
    const frontX = x + fx * halfDepth, frontZ = z + fz * halfDepth;
    const hit = this.roads.nearest(frontX + fx * 0.5, frontZ + fz * 0.5, BUILD_DEPTH_M + 2);
    if (!hit || Math.abs(hit.tx * fx + hit.tz * fz) > 0.02) return null;
    if ((hit.x - frontX) * fx + (hit.z - frontZ) * fz <= 0) return null;
    const f = roadGridFrame(hit.x, hit.z, hit.tx, hit.tz, hit.half);
    if (!obbParallel(f, o)) return null;
    const side = x * f.nx + z * f.nz - f.cn >= 0 ? 1 : -1;
    // Vote des voisins (phase arrondie au 1/20 de m, modulo la case).
    const votes = new Map<number, { phase: number; score: number }>();
    const vote = (ph: number, w: number): void => {
      const k = Math.round(ph * 20) % (cell * 20);
      const v = votes.get(k);
      if (v) v.score += w; else votes.set(k, { phase: ph, score: w });
    };
    vote(0, 0.5);
    const R = 48 + 2 * TILE_SIZE * Math.max(a.footprint.tilesX, a.footprint.tilesZ);
    const b = ctx.buildings, st = b.store;
    const u0 = x * f.tx + z * f.tz;
    for (const nid of b.query(x - R, z - R, x + R, z + R, this.q)) {
      if (nid === id) continue;
      const k = b.indexOf(nid);
      const na = k >= 0 ? ctx.catalog?.assets[st.assetIndex[k]!] : undefined;
      if (!na) continue;
      const on = footprintObb(st.tilesX[k]!, st.tilesZ[k]!, st.x[k]!, st.z[k]!, st.rot[k]!);
      if (!obbParallel(f, on)) continue;
      const n = on.cx * f.nx + on.cz * f.nz - f.cn;
      if ((n >= 0 ? 1 : -1) !== side) continue;
      // Façade vers cette route (normale selon −côté × N).
      const [nlx, nlz] = localFacade(na);
      const nfx = nlx * on.c + nlz * on.s, nfz = -nlx * on.s + nlz * on.c;
      if ((nfx * f.nx + nfz * f.nz) * side > -0.98) continue;
      const front = Math.abs(n) - f.offset - extentAlong(on, f.nx, f.nz);
      if (front < -0.5 || front > BUILD_DEPTH_M) continue;
      if (Math.abs(on.cx * f.tx + on.cz * f.tz - u0) > R) continue;
      const ph = phaseFromObb(f, on);
      if (ph !== null) vote(ph, 1);
    }
    const own = phaseFromObb(f, o) ?? 0;
    let best = { phase: 0, score: -1 };
    for (const v of votes.values()) if (v.score > best.score) best = v;
    const ownVotes = votes.get(Math.round(own * 20) % (cell * 20));
    f.phase = ownVotes && ownVotes.score >= best.score ? own : best.phase;
    // Le long de la route : côtés sur les lignes ; en profondeur : façade sur la ligne des façades ou une rangée.
    const halfAlong = extentAlong(o, f.tx, f.tz);
    const [sx, sz] = snapAlong(f, x, z, halfAlong, 0);
    const vFront = side * (frontX * f.nx + frontZ * f.nz - f.cn) - f.offset;
    const dv = Math.max(0, Math.round(vFront / cell)) * cell - vFront;
    const tx = Math.round((sx + side * f.nx * dv) * 100) / 100, tz = Math.round((sz + side * f.nz * dv) * 100) / 100;
    if (Math.abs(tx - x) < 0.01 && Math.abs(tz - z) < 0.01) return null;
    return [tx, tz];
  }

  /** Collision avec un autre bâtiment que `except` (écart minimal autour des maisons compris). */
  private collidesOthers(ctx: PluginContext, a: CatalogAsset, x: number, z: number, rot: number, except: number): boolean {
    const o = footprintObb(a.footprint.tilesX, a.footprint.tilesZ, x, z, rot);
    const bb = obbAabb(o);
    const b = ctx.buildings, st = b.store;
    for (const nid of b.query(bb.minX - 2, bb.minZ - 2, bb.maxX + 2, bb.maxZ + 2, this.q)) {
      if (nid === except) continue;
      const k = b.indexOf(nid);
      if (k < 0) continue;
      const na = ctx.catalog?.assets[st.assetIndex[k]!];
      if (!na) continue;
      const other = footprintObb(st.tilesX[k]!, st.tilesZ[k]!, st.x[k]!, st.z[k]!, st.rot[k]!);
      const gap = buildingGap(a.category, na.category);
      if (obbOverlap(o, other, gap > 0 ? -gap : 0.05)) return true;
    }
    return false;
  }

  /* --------------------------- Statistiques, réseau --------------------------- */

  stats(ctx: PluginContext): ZonageStats {
    const cells = Object.fromEntries(ZONE_TYPES.map((z, k) => [z, this.grid.counts[k + 1]!])) as Record<ZoneType, number>;
    const buildings = Object.fromEntries(ZONE_TYPES.map((z) => [z, 0])) as Record<ZoneType, number>;
    let residents = 0, jobs = 0;
    const st = ctx.buildings.store;
    for (const [id, o] of this.owned) {
      const z = zoneOf(o.zone);
      const i = ctx.buildings.indexOf(id);
      if (!z || i < 0) continue;
      buildings[z]++;
      residents += st.residents[i]!;
      jobs += st.workers[i]!;
    }
    let connected = 0;
    const zz = this.grid.zone;
    for (let i = 0; i < zz.length; i++) if (zz[i] && this.grid.connected(i)) connected++;
    return { cells, connected, buildings, grown: this.grown, densified: this.densified, residents, jobs };
  }

  takeDelta(ctx: PluginContext): ZonageDelta | undefined {
    if (!this.active) return undefined;
    const d: ZonageDelta = {};
    const cells = this.grid.takeChanged();
    if (cells) d.cells = cells;
    if (this.demandDirty) { d.demand = { ...this.demand }; d.special = this.specialDemand(); if (this.inputs) d.inputs = this.inputs; this.demandDirty = false; }
    if (this.statsDirty) { d.stats = this.stats(ctx); this.statsDirty = false; }
    if (this.settingsDirty) { d.settings = { growth: this.growth }; this.settingsDirty = false; }
    return Object.keys(d).length > 0 ? d : undefined;
  }

  full(ctx: PluginContext): ZonageSnapshot {
    if (!this.grid.info) this.grid.reset(ctx.terrain.bounds());
    this.grid.changed.clear();
    const g = this.grid.info ?? { originX: 0, originZ: 0, cell: TILE_SIZE, w: 0, h: 0 };
    const snap: ZonageSnapshot = {
      grid: { ...g }, rle: g.w > 0 ? this.grid.wireRle() : [], demand: { ...this.demand }, special: this.specialDemand(), stats: this.stats(ctx), settings: { growth: this.growth },
    };
    if (this.inputs) snap.inputs = this.inputs;
    this.demandDirty = this.statsDirty = this.settingsDirty = false;
    return snap;
  }

  /** Demande des zones spécialisées (jauge de l'interface). */
  specialDemand(): { foret: number; agricole: number; mixte: number } {
    return { foret: this.special.foret, agricole: this.special.agricole, mixte: this.zoneDemand('mixte') };
  }

  /** Vue en lecture seule publiée sous `ZONAGE_ETAT_SERVICE`. */
  etat(): ZonageEtat {
    const grid = this.grid, owned = this.owned;
    const isActive = (): boolean => this.active;
    const demandOf = (zone: ZoneType): number => this.zoneDemand(zone);
    return {
      get active() { return isActive(); },
      get version() { return grid.version; },
      get cell() { return grid.info?.cell ?? TILE_SIZE; },
      cellsOf: (zone) => grid.cellsOf(ZONE_TYPES.indexOf(zone) + 1),
      zoneAt: (idx) => (idx >= 0 && idx < grid.size ? zoneOf(grid.zone[idx]!) : null),
      index: (x, z) => grid.index(x, z),
      centerX: (idx) => grid.centerX(idx),
      centerZ: (idx) => grid.centerZ(idx),
      buildingsOf: (zone) => {
        const code = ZONE_TYPES.indexOf(zone) + 1;
        const out: number[] = [];
        for (const [id, o] of owned) if (o.zone === code) out.push(id);
        return out;
      },
      demandOf,
    };
  }

  setGrowth(enabled: boolean): void { this.growth = enabled; this.settingsDirty = true; this.activate(); }

  /** Lecture et fusion partielle des réglages (clés inconnues ou valeurs non finies ignorées). */
  setTuning(patch: Record<string, unknown>): ZonageTuning {
    for (const [k, v] of Object.entries(patch)) {
      if (k in DEFAULT_TUNING && typeof v === 'number' && Number.isFinite(v)) (this.tuning as unknown as Record<string, number>)[k] = v;
    }
    return { ...this.tuning };
  }

  /* -------------------------------- Sauvegarde -------------------------------- */

  toSave(): ZonageSave | undefined {
    if (!this.active) return undefined;
    const g = this.grid.info;
    const tuning: Record<string, number> = {};
    for (const [k, v] of Object.entries(this.tuning)) if ((DEFAULT_TUNING as unknown as Record<string, number>)[k] !== v) tuning[k] = v;
    return {
      grid: g ? { ...g, rle: this.grid.zonesRle() } : null,
      owned: [...this.owned].map(([id, o]) => [id, o.zone, o.level, o.born]),
      demand: { ...this.demand },
      settings: { growth: this.growth },
      tuning,
      counters: { grown: this.grown, densified: this.densified },
      ...(this.special.foret !== 0 || this.special.agricole !== 0 ? { special: { ...this.special } } : {}),
    };
  }

  load(ctx: PluginContext, s: ZonageSave): void {
    if (!this.grid.info) this.grid.reset(ctx.terrain.bounds());
    if (s.grid) this.grid.loadZones(s.grid, s.grid.rle);
    this.owned.clear();
    for (const [id, zone, level, born] of s.owned) {
      if (ctx.buildings.indexOf(id) >= 0) this.owned.set(id, { zone: zone as ZoneCode, level, born });
    }
    this.demand = { ...s.demand };
    this.special = s.special ? { ...s.special } : { foret: 0, agricole: 0 };
    this.growth = s.settings.growth;
    this.tuning = { ...DEFAULT_TUNING };
    this.setTuning(s.tuning);
    this.grown = s.counters.grown;
    this.densified = s.counters.densified;
    this.lastHour = Math.floor(ctx.clock.totalMinutes / 60);
    this.active = true;
    this.realignPending = true;
    this.roads.sync(ctx.roads);
    this.grid.refreshConnectivity(this.roads);
    this.grid.changed.clear();
    this.demandDirty = this.statsDirty = this.settingsDirty = true;
  }
}
