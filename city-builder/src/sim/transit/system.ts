/**
 * Système des lignes de bus (module « bus », docs/TRANSPORTS_COMMUN.md).
 *
 *  - Lignes tracées par le joueur : arrêts posés sur des routes, dans l'ordre ; boucle par le plus court chemin
 *    (`LineRouter`), recalculée quand le réseau change (arrêts réaccrochés à la route la plus proche).
 *  - Dépôts (bâtiments du catalogue étiquetés `depot_bus`, capacité `bus:N`) : sans dépôt relié à la route, aucune
 *    ligne ne roule ; au-delà de la capacité, les bus sont répartis au prorata.
 *  - Demande agrégée, une fois par jour : chaque actif ou élève (domicile -> travail / école) choisit entre voiture,
 *    marche et bus (logit sur un coût généralisé = valeur du temps × temps porte à porte + coût monétaire). Bus : marche
 *    jusqu'à l'arrêt (400 m au plus), attente (moitié de l'intervalle), trajet le long de la boucle avec arrêts, marche
 *    finale ; aller et retour peuvent utiliser des arrêts différents (ligne aller-retour sur deux rues). Aucun agent
 *    par passager : espérances sommées par arrêt et par tronçon de ligne (charge de pointe, capacité des bus).
 *  - Effets : demande automobile du trafic multipliée par le facteur voiture (`TrafficSystem.carFactor`), portée de la
 *    recherche d'emploi étendue pour les logements bien desservis (vers un emploi desservi par la même ligne),
 *    satisfaction, recettes des tarifs et entretien des bus au budget (`applyService`).
 *  - Tramway (`mode: 'tram'`) : même système de lignes ; les rames ne roulent que sur les tronçons équipés de voies
 *    (`TramTracks`, voie partagée ou site propre), partent de dépôts de tram (`depot_tram`, `tram:N`), emportent plus de
 *    voyageurs (180 places) ; en site propre leur vitesse ne dépend pas des bouchons.
 * Sans ligne : aucun effet (facteur 1, aucune portée ni satisfaction ajoutée, aucun delta, aucune section).
 * Coût : O(bâtiments × arrêts voisins) + O(navetteurs × 36) par jour ; rien par tick hors suivi horaire de la vitesse.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import {
  BUS_COLORS, BUS_DEPOT_TAG, BUS_EXT_VERSION, TRAM_DEPOT_TAG, BUS_FARE_MAX, BUS_MAX_BUSES_PER_LINE, BUS_MAX_LINES, BUS_MAX_STOPS_PER_LINE, BUS_WALK_COVER_M,
  DEFAULT_BUS_TUNING,
  type BusDelta, type BusLayer, type BusLineGeometry, type BusLineRecord, type BusLineView, type BusModalSplit, type BusState, type BusStopCard,
  type BusStopView, type BusSummary, type BusTuning, type TramTrackRecord, type TransitMode,
} from '../../shared/protocol-ext/bus';
import { readTracks, TramTracks, trackAllowed } from './tracks';
import { ROAD_KINDS } from '../roads/types';

import type { PluginContext } from '../plugins/types';
import type { DemographySystem } from '../demography';
import type { TrafficSystem } from '../traffic/system';
import { LineRouter, snapStop, type LineRoute, type RouteFailure, type StopSnap } from './route';

/** Arrêts retenus par bâtiment (les plus proches à pied, toutes lignes en service). */
const K = 6;
/** Taille des cellules de la grille des arrêts et de la carte (m). */
const STOP_CELL = 200;
const LAYER_CELL = 32;
/** Temps physique : 0,1 s par minute de jeu (comme le trafic). */
const PHYS_PER_MINUTE = 0.1;

export interface TransitCore { demography: DemographySystem | null; traffic: TrafficSystem | null }

export type BusResult<T> = { ok: true; data: T } | { ok: false; code: string; message: string };
const fail = (code: string, message: string): { ok: false; code: string; message: string } => ({ ok: false, code, message });

interface Stop {
  id: number;
  name: string;
  x: number;
  z: number;
  snap: StopSnap | null;
  boardings: number;
  alightings: number;
}

interface Line {
  id: number;
  mode: TransitMode;
  name: string;
  color: string;
  buses: number;
  fare: number;
  stops: Stop[];
  route: LineRoute | null;
  fail: RouteFailure | null;
  activeBuses: number;
  cycleMin: number;
  headwayMin: number;
  /** Vitesse commerciale (m/min) du dernier calcul. */
  speedMpm: number;
  /** Part du tracé en site propre (tram : vitesse indépendante des bouchons). */
  dedShare: number;
  ridersDay: number;
  refusedDay: number;
  load: number;
  revenueMonth: number;
  costMonth: number;
  revenueLastMonth: number;
  costLastMonth: number;
}

export interface BusSave {
  nextLineId: number;
  nextStopId: number;
  lines: (BusLineRecord & { m?: [number, number, number, number] })[];
  carFactor: number;
  carKmh: number;
  month: { revenue: number; cost: number; hires: number };
  lastMonth: { revenue: number; cost: number };
  /** Voies de tram (absent : aucune). */
  tracks?: TramTrackRecord[];
}

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
const finite = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const isColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
const cleanName = (v: unknown, d: string): string => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 40) : d);

export class BusSystem {
  readonly tuning: BusTuning = { ...DEFAULT_BUS_TUNING };
  private lines: Line[] = [];
  private nextLineId = 1;
  private nextStopId = 1;
  private readonly router = new LineRouter();
  /** Graphe du tram : seulement les tronçons équipés de voies. */
  private readonly tramRouter = new LineRouter();
  readonly tracks = new TramTracks();
  private sentTracks = -1;
  /** Dépôts de tram : nombre et capacité (rames). */
  private tramDepots = 0;
  private tramDepotCapacity = 0;
  private core: TransitCore = { demography: null, traffic: null };
  private routesVersion = -1;
  /** Dépôts : nombre et capacité totale (recalculés avec les bus en service). */
  private depots = 0;
  private depotCapacity = 0;
  /** Versions : structure (lignes, arrêts), géométrie (tracés), carte. */
  private structVersion = 0;
  private geomVersion = 0;
  private sentStruct = 0;
  private sentGeom = 0;
  private sinceTime = 0;
  /** Une charge vide a été envoyée après la suppression de la dernière ligne. */
  private clearedSent = true;
  // Couverture par identifiant de bâtiment.
  private covN = new Uint8Array(0);
  private covStop = new Int32Array(0);
  private covWalk = new Float32Array(0);
  private covQ = new Float32Array(0);
  private covMask = new Uint32Array(0);
  private covDay = -1;
  private covDirty = true;
  /** Arrêts en service à plat (index global -> ligne, arrêt, rang). */
  private flatLine: number[] = [];
  private flatStop: Stop[] = [];
  private flatRank: number[] = [];
  // Agrégats du dernier jour.
  carFactor = 1;
  private carKmh = DEFAULT_BUS_TUNING.carFreeKmh;
  private modal: BusModalSplit = { car: 0, walk: 0, bus: 0 };
  private modal0: BusModalSplit = { car: 0, walk: 0, bus: 0 };
  private coveredResidents = 0;
  private coveredJobs = 0;
  private month = { revenue: 0, cost: 0, hires: 0 };
  private lastMonth = { revenue: 0, cost: 0 };
  private lastHires = 0;
  private costMs = 0;
  /** Aide de croissance proposée (null : rien à signaler), évaluée chaque heure. */
  hint: 'need-transit' | 'traffic-jam' | null = null;
  private lastHour = -1;
  private layerOn = false;
  private layerSent = -1;

  constructor() {
    this.tramRouter.allow = (id) => this.tracks.has(id);
  }

  attach(core: TransitCore): void { this.core = core; }
  get lineCount(): number { return this.lines.length; }
  get active(): boolean { return this.lines.length > 0 || this.tracks.size > 0; }

  /* ------------------------------- Mode ------------------------------- */

  private capacityOf(m: TransitMode): number { return m === 'tram' ? this.tuning.tramCapacity : this.tuning.busCapacity; }
  private upkeepOf(m: TransitMode): number { return m === 'tram' ? this.tuning.tramUpkeepMonth : this.tuning.busUpkeepMonth; }
  private stopCostOf(m: TransitMode): number { return m === 'tram' ? this.tuning.tramStopCost : this.tuning.stopCost; }
  private depotsOf(m: TransitMode): number { return m === 'tram' ? this.tramDepots : this.depots; }
  private routerOf(m: TransitMode): LineRouter { return m === 'tram' ? this.tramRouter : this.router; }
  /** Accroche d'un arrêt selon le mode (tram : tronçons équipés de voies seulement). */
  private snapFor(ctx: PluginContext, m: TransitMode, x: number, z: number): StopSnap | null {
    if (m === 'tram') { this.syncTracks(ctx); return snapStop(ctx.roads, x, z, undefined, this.tramRouter.arcs, (id) => this.tracks.has(id)); }
    return snapStop(ctx.roads, x, z, undefined, this.router.arcs);
  }
  private offMsg(m: TransitMode): string {
    return m === 'tram' ? 'Posez l’arrêt sur une route équipée de voies de tram' : 'Posez l’arrêt sur une route où un bus peut passer';
  }

  /** Voies de tram recalées sur le réseau courant ; lignes de tram retracées si l'ensemble a changé. */
  private syncTracks(ctx: PluginContext): void {
    const before = this.tracks.rev;
    this.tracks.sync(ctx.roads);
    if (this.tracks.rev !== before) this.onTracksChanged(ctx);
  }

  private onTracksChanged(ctx: PluginContext): void {
    this.tramRouter.allowKey = this.tracks.rev;
    let any = false;
    for (const l of this.lines) if (l.mode === 'tram') { this.routeLine(ctx, l); any = true; }
    if (any) { this.refreshDepots(ctx); this.touch(true); }
    this.clearedSent = false;
  }

  reset(): void {
    this.lines = [];
    this.nextLineId = 1; this.nextStopId = 1;
    this.routesVersion = -1;
    this.depots = 0; this.depotCapacity = 0; this.depotSigCount = -1; this.depotSigRoads = -1;
    this.tramDepots = 0; this.tramDepotCapacity = 0;
    this.tracks.reset(); this.tramRouter.allowKey = this.tracks.rev; this.sentTracks = this.tracks.rev;
    this.structVersion = 0; this.geomVersion = 0; this.sentStruct = 0; this.sentGeom = 0; this.sinceTime = 0; this.clearedSent = true;
    this.covN = new Uint8Array(0); this.covStop = new Int32Array(0); this.covWalk = new Float32Array(0); this.covQ = new Float32Array(0); this.covMask = new Uint32Array(0);
    this.covDay = -1; this.covDirty = true;
    this.flatLine = []; this.flatStop = []; this.flatRank = [];
    this.carKmh = this.tuning.carFreeKmh;
    this.modal = { car: 0, walk: 0, bus: 0 }; this.modal0 = { car: 0, walk: 0, bus: 0 };
    this.coveredResidents = 0; this.coveredJobs = 0;
    this.month = { revenue: 0, cost: 0, hires: 0 }; this.lastMonth = { revenue: 0, cost: 0 };
    this.lastHires = 0; this.costMs = 0; this.hint = null; this.lastHour = -1; this.layerSent = -1;
    this.setCarFactor(1);
  }

  private setCarFactor(f: number): void {
    this.carFactor = f;
    if (this.core.traffic) this.core.traffic.carFactor = f;
  }

  private touch(geom: boolean): void { this.structVersion++; if (geom) this.geomVersion++; this.covDirty = true; }

  /* ------------------------------- Réseau ------------------------------- */

  /** Signature bâtiments + réseau : dépôts recalculés quand elle change (contrôle en O(1) à chaque tick). */
  private depotSigCount = -1;
  private depotSigRoads = -1;
  private readonly pairs = new Map<number, number>();
  private syncDepots(ctx: PluginContext): void {
    if (ctx.buildings.count !== this.depotSigCount || ctx.roads.version !== this.depotSigRoads) this.refreshDepots(ctx);
  }

  /** Dépôts reliés à la route et bus en service par ligne. */
  private refreshDepots(ctx: PluginContext): void {
    this.depotSigCount = ctx.buildings.count; this.depotSigRoads = ctx.roads.version;
    const st = ctx.buildings.store, assets = ctx.catalog?.assets ?? [];
    let n = 0, cap = 0, tn = 0, tcap = 0;
    for (let i = 0; i < ctx.buildings.count; i++) {
      const a = assets[st.assetIndex[i]!];
      if (!a || !st.roadAccess[i]) continue;
      if (a.tags.includes(BUS_DEPOT_TAG)) {
        n++;
        const tag = a.tags.find((t) => t.startsWith('bus:'));
        const v = tag ? Number(tag.slice(4)) : NaN;
        cap += Number.isFinite(v) && v > 0 ? v : this.tuning.depotDefaultCapacity;
      }
      if (a.tags.includes(TRAM_DEPOT_TAG)) {
        tn++;
        const tag = a.tags.find((t) => t.startsWith('tram:'));
        const v = tag ? Number(tag.slice(5)) : NaN;
        tcap += Number.isFinite(v) && v > 0 ? v : this.tuning.tramDepotDefaultCapacity;
      }
    }
    const changed = n !== this.depots || cap !== this.depotCapacity || tn !== this.tramDepots || tcap !== this.tramDepotCapacity;
    this.depots = n; this.depotCapacity = cap;
    this.tramDepots = tn; this.tramDepotCapacity = tcap;
    this.allocate('bus', cap);
    this.allocate('tram', tcap);
    if (changed) this.touch(false);
    this.updateTimes();
  }

  /** Répartition des véhicules d'un mode : tous ceux demandés si la capacité suffit, sinon au prorata (reste aux premières lignes). */
  private allocate(mode: TransitMode, cap: number): void {
    const lines = this.lines.filter((l) => l.mode === mode);
    const runnable = lines.filter((l) => l.route && l.buses > 0);
    const want = runnable.reduce((s, l) => s + l.buses, 0);
    let left = cap;
    for (const l of lines) {
      let act = 0;
      if (l.route && l.buses > 0 && cap > 0) act = want <= cap ? l.buses : Math.floor((l.buses * cap) / want);
      left -= act;
      if (act !== l.activeBuses) { l.activeBuses = act; this.touch(true); }
    }
    for (const l of runnable) {
      if (left <= 0 || want <= cap) break;
      if (l.activeBuses < l.buses) { l.activeBuses++; left--; this.touch(true); }
    }
  }

  /** Vitesse commerciale (selon l'encombrement), durée du tour et intervalle de chaque ligne. */
  private updateTimes(): void {
    const t = this.tuning;
    const slow = clamp(this.carKmh / 35, 0.35, 1);
    const v = (t.busSpeedKmh * 1000 / 60) * slow;
    const vt = t.tramSpeedKmh * 1000 / 60;
    for (const l of this.lines) {
      // Tram : en site propre, la rame ne subit pas les bouchons ; en voie partagée, comme le bus.
      l.speedMpm = l.mode === 'tram' ? vt * (l.dedShare + (1 - l.dedShare) * slow) : v;
      if (!l.route) { l.cycleMin = 0; l.headwayMin = 0; continue; }
      l.cycleMin = l.route.length / l.speedMpm + (l.stops.length * t.dwellS) / 60;
      l.headwayMin = l.activeBuses > 0 ? l.cycleMin / l.activeBuses : 0;
    }
  }

  /** Recalcule les tracés si le réseau a changé (arrêts réaccrochés). */
  private ensureRoutes(ctx: PluginContext, force = false): void {
    this.syncTracks(ctx);
    if (!force && this.routesVersion === ctx.roads.version) return;
    this.routesVersion = ctx.roads.version;
    for (const l of this.lines) this.routeLine(ctx, l);
    this.touch(true);
  }

  private routeLine(ctx: PluginContext, l: Line): void {
    for (const s of l.stops) {
      s.snap = this.snapFor(ctx, l.mode, s.x, s.z);
      if (s.snap) { s.x = s.snap.x; s.z = s.snap.z; }
    }
    const r = this.routerOf(l.mode).route(ctx.roads, l.stops.map((s) => s.snap));
    l.route = r.ok ? r.route : null;
    l.fail = r.ok ? null : r;
    l.dedShare = 0;
    if (l.route && l.mode === 'tram' && l.route.length > 0) {
      let ded = 0;
      l.route.segs.forEach((id, k) => { if (this.tracks.dedicated(id)) ded += l.route!.segLens[k]!; });
      l.dedShare = clamp(ded / l.route.length, 0, 1);
    }
  }

  problemOf(l: Pick<Line, 'fail' | 'buses' | 'activeBuses'> & { mode?: TransitMode }): string | null {
    const tram = l.mode === 'tram';
    if (l.fail) {
      const k = l.fail.stopIndex + 1;
      if (l.fail.reason === 'few') return 'Il faut au moins deux arrêts';
      if (l.fail.reason === 'offroad') return tram ? `Arrêt ${k} : plus de voie de tram à proximité` : `Arrêt ${k} : plus de route praticable à proximité`;
      return tram ? `Arrêt ${k} injoignable par les voies de tram depuis le précédent (voies à compléter, sens unique ?)` : `Arrêt ${k} injoignable depuis le précédent (sens unique, route coupée ?)`;
    }
    if (l.buses <= 0) return tram ? 'Aucune rame affectée à la ligne' : 'Aucun bus affecté à la ligne';
    if (tram && this.tramDepots === 0) return 'Aucun dépôt de tram relié à la route (Transports › Gares)';
    if (!tram && this.depots === 0) return 'Aucun dépôt de bus relié à la route (Transports › Gares)';
    if (l.activeBuses <= 0) return tram ? 'Dépôts pleins : aucune rame disponible pour cette ligne' : 'Dépôts pleins : aucun bus disponible pour cette ligne';
    return null;
  }

  private running(l: Line): boolean { return !!l.route && l.activeBuses > 0 && this.depotsOf(l.mode) > 0; }

  /* ------------------------------ Couverture ------------------------------ */

  private grow(maxId: number): void {
    if (this.covN.length > maxId) return;
    const n = Math.max(maxId + 1, this.covN.length * 2, 256);
    const g = <T extends Uint8Array | Int32Array | Float32Array | Uint32Array>(a: T, size: number, C: new (n: number) => T): T => { const b = new C(size); b.set(a); return b; };
    this.covN = g(this.covN, n, Uint8Array); this.covQ = g(this.covQ, n, Float32Array); this.covMask = g(this.covMask, n, Uint32Array);
    this.covStop = g(this.covStop, n * K, Int32Array); this.covWalk = g(this.covWalk, n * K, Float32Array);
  }

  /** Arrêts en service à plat + couverture de chaque bâtiment (arrêts à moins de 400 m de marche). */
  private computeCoverage(ctx: PluginContext): void {
    this.covDirty = false;
    this.covDay = ctx.clock.dayIndex;
    const t = this.tuning;
    this.flatLine = []; this.flatStop = []; this.flatRank = [];
    const grid = new Map<number, number[]>();
    const key = (cx: number, cz: number): number => (cx + 4096) * 8192 + (cz + 4096);
    this.lines.forEach((l, li) => {
      if (!this.running(l)) return;
      l.stops.forEach((s, rank) => {
        if (!s.snap) return;
        const g = this.flatStop.length;
        this.flatLine.push(li); this.flatStop.push(s); this.flatRank.push(rank);
        const k = key(Math.floor(s.x / STOP_CELL), Math.floor(s.z / STOP_CELL));
        let c = grid.get(k);
        if (!c) { c = []; grid.set(k, c); }
        c.push(g);
      });
    });
    const st = ctx.buildings.store;
    let maxId = 0;
    for (let i = 0; i < ctx.buildings.count; i++) if (st.id[i]! > maxId) maxId = st.id[i]!;
    this.grow(maxId);
    this.covN.fill(0); this.covQ.fill(0); this.covMask.fill(0);
    let res = 0, jobs = 0;
    const reach = BUS_WALK_COVER_M / t.walkDetour;
    const r = Math.ceil(reach / STOP_CELL);
    const cand: number[] = [], dist: number[] = [];
    if (!this.flatStop.length) { this.coveredResidents = 0; this.coveredJobs = 0; return; }
    const assets = ctx.catalog?.assets ?? [];
    for (let i = 0; i < ctx.buildings.count; i++) {
      // Logements et lieux d'emploi (même encore vides : un emploi libre desservi attire les chômeurs).
      const a = assets[st.assetIndex[i]!];
      if (!st.roadAccess[i] || !a || (a.capacity.residents <= 0 && a.capacity.jobs <= 0)) continue;
      const id = st.id[i]!, x = st.x[i]!, z = st.z[i]!;
      const cx = Math.floor(x / STOP_CELL), cz = Math.floor(z / STOP_CELL);
      cand.length = 0; dist.length = 0;
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        const c = grid.get(key(cx + dx, cz + dz));
        if (!c) continue;
        for (const g of c) {
          const s = this.flatStop[g]!;
          const d = Math.hypot(s.x - x, s.z - z);
          if (d > reach) continue;
          // Insertion triée (K petits).
          let p = cand.length;
          while (p > 0 && dist[p - 1]! > d) p--;
          if (p >= K) continue;
          cand.splice(p, 0, g); dist.splice(p, 0, d);
          if (cand.length > K) { cand.pop(); dist.pop(); }
        }
      }
      if (!cand.length) continue;
      this.covN[id] = cand.length;
      let q = 0, mask = 0;
      for (let k = 0; k < cand.length; k++) {
        const g = cand[k]!, walk = dist[k]! * t.walkDetour;
        this.covStop[id * K + k] = g; this.covWalk[id * K + k] = walk;
        const l = this.lines[this.flatLine[g]!]!;
        const freq = clamp(10 / Math.max(1, l.headwayMin), 0.2, 1);
        q = Math.max(q, (1 - 0.5 * walk / BUS_WALK_COVER_M) * freq);
        mask |= 1 << (this.flatLine[g]! & 31);
      }
      this.covQ[id] = q; this.covMask[id] = mask;
      res += st.residents[i]!; jobs += st.workers[i]!;
    }
    this.coveredResidents = res; this.coveredJobs = jobs;
  }

  /** Avant la passe quotidienne de la démographie (embauche, satisfaction) : tracés, dépôts, couverture du jour. */
  prepareDay(ctx: PluginContext): void {
    if (!this.lines.length) return;
    this.ensureRoutes(ctx);
    this.refreshDepots(ctx);
    this.computeCoverage(ctx);
  }

  /* ------------------------------ Effets ------------------------------ */

  /** Satisfaction ajoutée aux habitants d'un logement bien desservi (0 sans ligne). */
  satisfactionOf(homeId: number): number { return homeId < this.covQ.length ? this.tuning.satisfactionBonus * this.covQ[homeId]! : 0; }
  /** Portée supplémentaire de la recherche d'emploi depuis ce logement (m ; 0 sans desserte). */
  jobReachOf(homeId: number): number { return homeId < this.covQ.length ? this.tuning.jobReachBonusM * this.covQ[homeId]! : 0; }
  /** Une même ligne dessert le logement et l'emploi. */
  serves(homeId: number, jobId: number): boolean {
    return homeId < this.covMask.length && jobId < this.covMask.length && (this.covMask[homeId]! & this.covMask[jobId]!) !== 0;
  }

  /* ------------------------------- Demande ------------------------------- */

  /** Choix modal du jour, fréquentation, charge, recettes et entretien, facteur voiture. */
  dailyDemand(ctx: PluginContext): void {
    // Entretien des voies de tram (même sans ligne), compté avec les coûts du réseau.
    let trackUpkeep = 0;
    if (this.tracks.size) {
      this.syncTracks(ctx);
      trackUpkeep = (this.tracks.lengths(ctx.roads).total * this.tuning.trackUpkeepPerMMonth) / 30;
      if (!this.lines.length && trackUpkeep > 0) { ctx.economy.applyService(-trackUpkeep); this.month.cost += trackUpkeep; this.structVersion++; }
    }
    if (!this.lines.length) return;
    const t0 = performance.now();
    if (this.covDirty || this.covDay !== ctx.clock.dayIndex) this.prepareDay(ctx);
    const t = this.tuning;
    const demo = this.core.demography;
    for (const l of this.lines) { l.ridersDay = 0; l.refusedDay = 0; l.load = 0; for (const s of l.stops) { s.boardings = 0; s.alightings = 0; } }
    const nL = this.lines.length;
    const lineCommuters = new Float64Array(nL);
    const flows = this.lines.map((l) => new Float64Array(l.stops.length + 1));
    const board = this.lines.map((l) => new Float64Array(l.stops.length));
    const alight = this.lines.map((l) => new Float64Array(l.stops.length));
    let sumCar = 0, sumCar0 = 0, sumWalk = 0, sumWalk0 = 0, sumBus = 0, n = 0;
    if (demo && this.flatStop.length) {
      const c = demo.citizens.col, b = ctx.buildings;
      const carMpm = Math.max(t.carMinKmh, this.carKmh) * 1000 / 60;
      const vot = t.valueOfTimeChf, mu = t.logitScale;
      // Abscisse de chaque arrêt sur le tracé, par index global.
      const sOf = this.flatStop.map((s, g) => this.lines[this.flatLine[g]!]!.route!.stopS[this.flatRank[g]!]!);
      const ride = (g1: number, g2: number): number => {
        const l = this.lines[this.flatLine[g1]!]!;
        const L = l.route!.length, ns = l.stops.length;
        let d = sOf[g2]! - sOf[g1]!;
        if (d <= 0) d += L;
        let between = this.flatRank[g2]! - this.flatRank[g1]! - 1;
        if (between < 0) between += ns;
        return d / l.speedMpm + ((between + 1) * t.dwellS) / 60;
      };
      // Navetteurs regroupés par paire (logement, destination) : un calcul par paire, pondéré par son effectif
      // (ordre d'insertion de la table = ordre des citoyens : sommes déterministes).
      const pairs = this.pairs;
      pairs.clear();
      for (let i = 0; i < demo.citizens.count; i++) {
        const tgt = c.job[i]! >= 0 ? c.job[i]! : c.school[i]!;
        if (tgt < 0) continue;
        const key = c.home[i]! * 4294967296 + tgt;
        pairs.set(key, (pairs.get(key) ?? 0) + demo.weightOf(i));
      }
      for (const [key, w] of pairs) {
        const home = Math.floor(key / 4294967296), tgt = key - home * 4294967296;
        const hi = b.indexOf(home), ti = b.indexOf(tgt);
        if (hi < 0 || ti < 0) continue;
        const dist = Math.hypot(b.store.x[hi]! - b.store.x[ti]!, b.store.z[hi]! - b.store.z[ti]!);
        const carMin = (dist * t.carDetour) / carMpm + t.carAccessMin;
        const carCost = vot * carMin + (t.carCostPerKm * dist * t.carDetour) / 1000 + t.carParkingChf - t.carBonusChf;
        const walkCost = vot * (dist * t.walkDetour) / t.walkMPerMin;
        const eC = Math.exp(-mu * carCost), eW = Math.exp(-mu * walkCost);
        sumCar0 += w * eC / (eC + eW); sumWalk0 += w * eW / (eC + eW);
        n += w;
        // Meilleur bus : aller (domicile -> destination) et retour, arrêts éventuellement différents, même ligne.
        let pB = 0, gm1 = -1, gm2 = -1, ge1 = -1, ge2 = -1, busCost = Infinity;
        const nh = home < this.covN.length ? this.covN[home]! : 0, nd = tgt < this.covN.length ? this.covN[tgt]! : 0;
        if (nh && nd) {
          let bestM = Infinity, bestE = Infinity, lineM = -1;
          for (let a = 0; a < nh; a++) {
            const g1 = this.covStop[home * K + a]!, w1 = this.covWalk[home * K + a]!;
            for (let d = 0; d < nd; d++) {
              const g2 = this.covStop[tgt * K + d]!;
              if (g1 === g2 || this.flatLine[g1] !== this.flatLine[g2]) continue;
              const w2 = this.covWalk[tgt * K + d]!;
              const walk = (w1 + w2) / t.walkMPerMin;
              const m = walk + ride(g1, g2);
              if (m < bestM) { bestM = m; gm1 = g1; gm2 = g2; lineM = this.flatLine[g1]!; }
            }
          }
          if (lineM >= 0) {
            for (let d = 0; d < nd; d++) {
              const g1 = this.covStop[tgt * K + d]!, w1 = this.covWalk[tgt * K + d]!;
              if (this.flatLine[g1] !== lineM) continue;
              for (let a = 0; a < nh; a++) {
                const g2 = this.covStop[home * K + a]!;
                if (g1 === g2 || this.flatLine[g2] !== lineM) continue;
                const e = (w1 + this.covWalk[home * K + a]!) / t.walkMPerMin + ride(g1, g2);
                if (e < bestE) { bestE = e; ge1 = g1; ge2 = g2; }
              }
            }
            const l = this.lines[lineM]!;
            const wait = Math.min(t.maxWaitMin, l.headwayMin / 2);
            if (Number.isFinite(bestE)) busCost = vot * ((bestM + bestE) / 2 + wait) + l.fare - (l.mode === 'tram' ? t.tramComfortChf : 0);
          }
        }
        const eB = Number.isFinite(busCost) ? Math.exp(-mu * busCost) : 0;
        const sum = eC + eW + eB;
        const pC = eC / sum;
        pB = w * eB / sum;
        sumCar += w * pC; sumWalk += w * eW / sum;
        if (pB > 0) {
          sumBus += pB;
          const li = this.flatLine[gm1]!;
          lineCommuters[li]! += pB;
          const f = flows[li]!;
          const add = (g1: number, g2: number): void => {
            const r1 = this.flatRank[g1]!, r2 = this.flatRank[g2]!;
            board[li]![r1]! += pB; alight[li]![r2]! += pB;
            f[r1]! += pB; f[r2]! -= pB;
            if (r2 <= r1) f[0]! += pB;
          };
          add(gm1, gm2);
          add(ge1, ge2);
        }
      }
    }
    // Capacité : charge de pointe sur le tronçon le plus chargé ; demande excédentaire renvoyée vers la voiture.
    const weekend = ctx.clock.weekday >= 5;
    const dayFactor = weekend ? 0.45 : 1;
    let refused = 0, riders = 0, revenue = 0, cost = trackUpkeep;
    this.lines.forEach((l, li) => {
      const f = flows[li]!;
      let acc = 0, max = 0;
      for (let k = 0; k < l.stops.length; k++) { acc += f[k]!; if (acc > max) max = acc; }
      const running = this.running(l);
      const capH = running && l.cycleMin > 0 ? (l.activeBuses * this.capacityOf(l.mode) * 60) / l.cycleMin : 0;
      const load = capH > 0 ? (t.peakShare * max) / capH : 0;
      const scale = load > 1 ? 1 / load : 1;
      l.load = load;
      refused += lineCommuters[li]! * (1 - scale);
      l.ridersDay = 2 * lineCommuters[li]! * scale * dayFactor;
      l.refusedDay = 2 * lineCommuters[li]! * (1 - scale) * dayFactor;
      l.stops.forEach((s, k) => { s.boardings = board[li]![k]! * scale * dayFactor; s.alightings = alight[li]![k]! * scale * dayFactor; });
      const rev = l.ridersDay * l.fare;
      const up = running ? (l.activeBuses * this.upkeepOf(l.mode)) / 30 : 0;
      l.revenueMonth += rev; l.costMonth += up;
      riders += l.ridersDay; revenue += rev; cost += up;
    });
    if (revenue - cost !== 0) ctx.economy.applyService(revenue - cost);
    this.month.revenue += revenue; this.month.cost += cost;
    const nn = Math.max(1, n);
    this.modal = { car: (sumCar + refused) / nn, walk: sumWalk / nn, bus: Math.max(0, sumBus - refused) / nn };
    this.modal0 = { car: sumCar0 / nn, walk: sumWalk0 / nn, bus: 0 };
    this.setCarFactor(sumCar0 > 0 ? clamp((sumCar + refused) / sumCar0, 0.3, 1) : 1);
    void riders;
    if (demo) { this.month.hires += demo.transitHires - this.lastHires; this.lastHires = demo.transitHires; }
    this.structVersion++;
    this.costMs = performance.now() - t0;
  }

  onMonth(): void {
    this.lastMonth = { revenue: this.month.revenue, cost: this.month.cost };
    this.month = { revenue: 0, cost: 0, hires: 0 };
    for (const l of this.lines) { l.revenueLastMonth = l.revenueMonth; l.costLastMonth = l.costMonth; l.revenueMonth = 0; l.costMonth = 0; }
    this.structVersion++;
  }

  /** Chaque tick : tracés à jour si le réseau change ; chaque heure : vitesse des voitures, aide de croissance. */
  tick(ctx: PluginContext): void {
    if (this.tracks.size) this.syncTracks(ctx);
    if (this.lines.length) this.syncDepots(ctx);
    const hour = Math.floor(ctx.clock.totalMinutes / 60);
    if (hour === this.lastHour) {
      if (this.lines.length && this.routesVersion !== ctx.roads.version) { this.ensureRoutes(ctx); this.refreshDepots(ctx); }
      return;
    }
    this.lastHour = hour;
    const tr = this.core.traffic;
    if (this.lines.length) {
      this.ensureRoutes(ctx);
      // Vitesse des voitures en journée (moyenne glissante) : temps de trajet en voiture, vitesse des bus.
      const h = ctx.clock.hourOfDay;
      if (tr && h >= 7 && h < 20 && tr.actCount >= 20) {
        this.carKmh += (clamp(tr.stats.meanSpeedKmh, 2, 90) - this.carKmh) * 0.15;
        this.updateTimes();
      }
      this.refreshDepots(ctx);
    }
    this.hint = this.evalHint(ctx);
  }

  private evalHint(ctx: PluginContext): 'need-transit' | 'traffic-jam' | null {
    const demo = this.core.demography, tr = this.core.traffic;
    const pop = ctx.demography?.population ?? 0;
    if (!demo || pop < 300) return null;
    const unemployed = demo.lastUnemployed, labor = demo.lastLaborForce;
    if (labor > 0 && unemployed / labor > 0.08 && demo.jobNoReachDay >= Math.max(10, 0.3 * unemployed)) return 'need-transit';
    if (tr && tr.actCount >= 50) {
      const { congested, total } = tr.congestedLength(2);
      if (total > 0 && congested / total > 0.25) return 'traffic-jam';
    }
    return null;
  }

  /* ------------------------------ Édition ------------------------------ */

  private lineById(id: number): Line | undefined { return this.lines.find((l) => l.id === id); }
  private stopById(id: number): { line: Line; stop: Stop; index: number } | null {
    for (const line of this.lines) { const index = line.stops.findIndex((s) => s.id === id); if (index >= 0) return { line, stop: line.stops[index]!, index }; }
    return null;
  }

  snap(ctx: PluginContext, x: number, z: number, mode: TransitMode = 'bus'): BusResult<{ x: number; z: number; segId: number }> {
    const s = this.snapFor(ctx, mode, x, z);
    return s ? { ok: true, data: { x: s.x, z: s.z, segId: s.segId } } : fail('INVALID_ARGS', mode === 'tram' ? this.offMsg('tram') : 'Posez l’arrêt sur une route où un bus peut passer (ni rue piétonne, ni autoroute)');
  }

  /** Aperçu d'un tracé (rien n'est modifié). */
  preview(ctx: PluginContext, pts: { x: number; z: number }[], mode: TransitMode = 'bus'): BusResult<{ points: number[]; stops: { x: number; z: number; ok: boolean }[]; lengthM: number; cycleMin: number; problem: string | null; cost: number }> {
    const snaps = pts.map((p) => this.snapFor(ctx, mode, p.x, p.z));
    const stops = pts.map((p, i) => ({ x: snaps[i]?.x ?? p.x, z: snaps[i]?.z ?? p.z, ok: !!snaps[i] }));
    const cost = pts.length * this.stopCostOf(mode);
    if (pts.length < 2) return { ok: true, data: { points: [], stops, lengthM: 0, cycleMin: 0, problem: pts.length ? 'Posez au moins un deuxième arrêt' : null, cost } };
    const r = this.routerOf(mode).route(ctx.roads, snaps);
    if (!r.ok) return { ok: true, data: { points: [], stops, lengthM: 0, cycleMin: 0, problem: this.problemOf({ fail: r, buses: 1, activeBuses: 1, mode }), cost } };
    const v = (mode === 'tram' ? this.tuning.tramSpeedKmh : this.tuning.busSpeedKmh) * 1000 / 60 * clamp(this.carKmh / 35, 0.35, 1);
    return { ok: true, data: { points: r.route.points, stops, lengthM: Math.round(r.route.length), cycleMin: r.route.length / v + (pts.length * this.tuning.dwellS) / 60, problem: null, cost } };
  }

  private charge(ctx: PluginContext, nStops: number, mode: TransitMode = 'bus'): BusResult<number> {
    const cost = nStops * this.stopCostOf(mode);
    if (cost <= 0) return { ok: true, data: 0 };
    if (ctx.economy.bankrupt) return fail('INSUFFICIENT_FUNDS', 'Ville en faillite : travaux suspendus');
    if (ctx.economy.money < cost) return fail('INSUFFICIENT_FUNDS', `Fonds insuffisants (${cost} CHF requis pour ${nStops} ${mode === 'tram' ? 'quais de tram' : 'abribus'})`);
    ctx.economy.applyService(-cost, true);
    return { ok: true, data: cost };
  }

  private newStop(x: number, z: number, name?: unknown, id?: number): Stop {
    const sid = id ?? this.nextStopId++;
    if (id !== undefined) this.nextStopId = Math.max(this.nextStopId, id + 1);
    return { id: sid, name: cleanName(name, `Arrêt ${sid}`), x, z, snap: null, boardings: 0, alightings: 0 };
  }

  private newLine(id: number, name: unknown, color: unknown, mode: TransitMode = 'bus'): Line {
    return {
      id, mode, name: cleanName(name, mode === 'tram' ? `Tram ${id}` : `Ligne ${id}`), color: isColor(color) ? color : BUS_COLORS[(id - 1) % BUS_COLORS.length]!,
      buses: mode === 'tram' ? 2 : 3, fare: 1.5, stops: [], route: null, fail: null, activeBuses: 0, cycleMin: 0, headwayMin: 0, speedMpm: 1, dedShare: 0,
      ridersDay: 0, refusedDay: 0, load: 0, revenueMonth: 0, costMonth: 0, revenueLastMonth: 0, costLastMonth: 0,
    };
  }

  private afterEdit(ctx: PluginContext, l: Line | null): void {
    if (l) this.routeLine(ctx, l);
    this.routesVersion = ctx.roads.version;
    this.refreshDepots(ctx);
    this.touch(true);
    if (this.lines.length) this.clearedSent = false;
  }

  createLine(ctx: PluginContext, p: { name?: unknown; color?: unknown; stops?: unknown; buses?: unknown; fare?: unknown; mode?: unknown }): BusResult<{ line: BusLineView; cost: number; warning: string | null }> {
    const mode: TransitMode = p.mode === 'tram' ? 'tram' : 'bus';
    if (this.lines.length >= BUS_MAX_LINES) return fail('INVALID_ARGS', `Au plus ${BUS_MAX_LINES} lignes`);
    const pts = Array.isArray(p.stops) ? (p.stops as unknown[]).filter((s): s is { x: number; z: number } => typeof s === 'object' && s !== null && Number.isFinite((s as { x?: unknown }).x) && Number.isFinite((s as { z?: unknown }).z)) : [];
    if (pts.length < 2) return fail('INVALID_ARGS', 'Une ligne demande au moins deux arrêts');
    if (pts.length > BUS_MAX_STOPS_PER_LINE) return fail('INVALID_ARGS', `Au plus ${BUS_MAX_STOPS_PER_LINE} arrêts par ligne`);
    const snaps = pts.map((s) => this.snapFor(ctx, mode, s.x, s.z));
    const bad = snaps.findIndex((s) => !s);
    if (bad >= 0) return fail('INVALID_ARGS', mode === 'tram' ? `Arrêt ${bad + 1} : aucune voie de tram à proximité` : `Arrêt ${bad + 1} : aucune route praticable à proximité`);
    const r = this.routerOf(mode).route(ctx.roads, snaps);
    if (!r.ok) return fail('INVALID_ARGS', this.problemOf({ fail: r, buses: 1, activeBuses: 1, mode }) ?? 'Tracé impossible');
    const paid = this.charge(ctx, pts.length, mode);
    if (!paid.ok) return paid;
    const l = this.newLine(this.nextLineId++, p.name, p.color, mode);
    if (p.buses !== undefined) l.buses = clamp(Math.round(finite(p.buses, 3)), 0, BUS_MAX_BUSES_PER_LINE);
    if (p.fare !== undefined) l.fare = clamp(Math.round(finite(p.fare, 1.5) * 4) / 4, 0, BUS_FARE_MAX);
    l.stops = pts.map((s) => this.newStop(s.x, s.z));
    this.lines.push(l);
    this.afterEdit(ctx, l);
    const warning = mode === 'tram'
      ? (this.tramDepots === 0 ? 'Aucun dépôt de tram : la ligne ne roulera qu’avec un dépôt relié à la route' : null)
      : (this.depots === 0 ? 'Aucun dépôt de bus : la ligne ne roulera qu’avec un dépôt relié à la route' : null);
    return { ok: true, data: { line: this.lineView(l), cost: paid.data, warning } };
  }

  updateLine(ctx: PluginContext, p: { id?: unknown; name?: unknown; color?: unknown; buses?: unknown; fare?: unknown }): BusResult<{ line: BusLineView; previous: { name: string; color: string; buses: number; fare: number } }> {
    const l = this.lineById(finite(p.id, -1));
    if (!l) return fail('NOT_FOUND', 'Ligne introuvable');
    const previous = { name: l.name, color: l.color, buses: l.buses, fare: l.fare };
    if (p.name !== undefined) l.name = cleanName(p.name, l.name);
    if (p.color !== undefined) { if (!isColor(p.color)) return fail('INVALID_ARGS', 'Couleur #rrggbb attendue'); l.color = p.color; }
    if (p.buses !== undefined) l.buses = clamp(Math.round(finite(p.buses, l.buses)), 0, BUS_MAX_BUSES_PER_LINE);
    if (p.fare !== undefined) l.fare = clamp(Math.round(finite(p.fare, l.fare) * 4) / 4, 0, BUS_FARE_MAX);
    this.afterEdit(ctx, null);
    return { ok: true, data: { line: this.lineView(l), previous } };
  }

  deleteLine(ctx: PluginContext, id: number): BusResult<{ record: BusLineRecord }> {
    const i = this.lines.findIndex((l) => l.id === id);
    if (i < 0) return fail('NOT_FOUND', 'Ligne introuvable');
    const record = this.record(this.lines[i]!);
    this.lines.splice(i, 1);
    this.afterEdit(ctx, null);
    if (!this.lines.length) { this.clearedSent = false; this.setCarFactor(1); this.covN.fill(0); this.covQ.fill(0); this.covMask.fill(0); }
    return { ok: true, data: { record } };
  }

  /** Rétablit une ligne supprimée (annulation) : mêmes identifiants si libres, arrêts déjà payés. */
  restoreLine(ctx: PluginContext, rec: unknown): BusResult<{ line: BusLineView }> {
    const r = readRecord(rec);
    if (!r) return fail('INVALID_ARGS', 'Ligne illisible');
    if (this.lines.length >= BUS_MAX_LINES) return fail('INVALID_ARGS', `Au plus ${BUS_MAX_LINES} lignes`);
    const id = this.lineById(r.id) ? this.nextLineId++ : r.id;
    this.nextLineId = Math.max(this.nextLineId, id + 1);
    const l = this.newLine(id, r.name, r.color, r.mode ?? 'bus');
    l.buses = r.buses; l.fare = r.fare;
    l.stops = r.stops.map((s) => this.newStop(s.x, s.z, s.name, this.stopById(s.id) ? undefined : s.id));
    this.lines.push(l);
    this.afterEdit(ctx, l);
    return { ok: true, data: { line: this.lineView(l) } };
  }

  /** Ajoute un arrêt : à `index` s'il est donné, sinon là où il allonge le moins la boucle. */
  addStop(ctx: PluginContext, lineId: number, x: number, z: number, index?: number): BusResult<{ stop: BusStopView; index: number; cost: number }> {
    const l = this.lineById(lineId);
    if (!l) return fail('NOT_FOUND', 'Ligne introuvable');
    if (l.stops.length >= BUS_MAX_STOPS_PER_LINE) return fail('INVALID_ARGS', `Au plus ${BUS_MAX_STOPS_PER_LINE} arrêts par ligne`);
    const sn = this.snapFor(ctx, l.mode, x, z);
    if (!sn) return fail('INVALID_ARGS', this.offMsg(l.mode));
    let at = index !== undefined && Number.isInteger(index) ? clamp(index, 0, l.stops.length) : bestInsert(l.stops, sn.x, sn.z);
    if (!Number.isFinite(at)) at = l.stops.length;
    const paid = this.charge(ctx, 1, l.mode);
    if (!paid.ok) return paid;
    const s = this.newStop(sn.x, sn.z);
    l.stops.splice(at, 0, s);
    this.afterEdit(ctx, l);
    return { ok: true, data: { stop: this.stopView(l, s), index: at, cost: paid.data } };
  }

  moveStop(ctx: PluginContext, stopId: number, x: number, z: number): BusResult<{ stop: BusStopView; previous: { x: number; z: number } }> {
    const f = this.stopById(stopId);
    if (!f) return fail('NOT_FOUND', 'Arrêt introuvable');
    const sn = this.snapFor(ctx, f.line.mode, x, z);
    if (!sn) return fail('INVALID_ARGS', this.offMsg(f.line.mode));
    const previous = { x: f.stop.x, z: f.stop.z };
    f.stop.x = sn.x; f.stop.z = sn.z;
    this.afterEdit(ctx, f.line);
    return { ok: true, data: { stop: this.stopView(f.line, f.stop), previous } };
  }

  removeStop(ctx: PluginContext, stopId: number): BusResult<{ lineId: number; index: number; x: number; z: number; name: string }> {
    const f = this.stopById(stopId);
    if (!f) return fail('NOT_FOUND', 'Arrêt introuvable');
    if (f.line.stops.length <= 2) return fail('INVALID_ARGS', 'Une ligne garde au moins deux arrêts : supprimez plutôt la ligne');
    f.line.stops.splice(f.index, 1);
    this.afterEdit(ctx, f.line);
    return { ok: true, data: { lineId: f.line.id, index: f.index, x: f.stop.x, z: f.stop.z, name: f.stop.name } };
  }

  renameStop(stopId: number, name: unknown): BusResult<{ previous: string; name: string }> {
    const f = this.stopById(stopId);
    if (!f) return fail('NOT_FOUND', 'Arrêt introuvable');
    const previous = f.stop.name;
    f.stop.name = cleanName(name, previous);
    this.structVersion++;
    return { ok: true, data: { previous, name: f.stop.name } };
  }

  /* ---------------------------- Voies de tram ---------------------------- */

  /**
   * Pose, change ou retire la voie de tram d'un tronçon (désigné par `segId` ou par le point x, z le plus proche à 28 m).
   * Pose : longueur × prix au mètre (site propre plus cher) ; passage en site propre : la différence ; retrait et passage
   * en voie partagée : rien n'est remboursé. `dryRun` : coût seulement.
   */
  setTrack(ctx: PluginContext, p: { segId?: number; x?: number; z?: number; on?: boolean; dedicated?: boolean; dryRun?: boolean }): BusResult<{ segId: number; on: boolean; dedicated: boolean; lengthM: number; cost: number; previous: { on: boolean; dedicated: boolean } }> {
    this.syncTracks(ctx);
    const roads = ctx.roads;
    let segId = p.segId ?? -1;
    if (!(segId >= 0 && roads.hasSegment(segId))) {
      if (p.x === undefined || p.z === undefined) return fail('INVALID_ARGS', 'Tronçon ou position attendus');
      const hit = roads.segmentNear(p.x, p.z, 28, (id) => !trackAllowed(ROAD_KINDS[roads.kindOf(id)]));
      if (!hit) return fail('INVALID_ARGS', 'Posez les voies sur une route existante (ni rue piétonne, ni autoroute)');
      segId = hit.segId;
    }
    if (!trackAllowed(ROAD_KINDS[roads.kindOf(segId)])) return fail('INVALID_ARGS', 'Pas de voie de tram sur une rue piétonne ni sur une autoroute');
    const on = p.on !== false;
    const was = this.tracks.has(segId), wasDed = this.tracks.dedicated(segId);
    const dedicated = on && (p.dedicated ?? (was ? wasDed : false));
    const len = roads.length(segId);
    const t = this.tuning;
    let cost = 0;
    if (on && !was) cost = len * (dedicated ? t.dedicatedTrackCostPerM : t.trackCostPerM);
    else if (on && dedicated && !wasDed) cost = len * (t.dedicatedTrackCostPerM - t.trackCostPerM);
    cost = Math.round(cost);
    const out = { segId, on, dedicated, lengthM: Math.round(len), cost, previous: { on: was, dedicated: wasDed } };
    if (p.dryRun) return { ok: true, data: out };
    if (cost > 0) {
      if (ctx.economy.bankrupt) return fail('INSUFFICIENT_FUNDS', 'Ville en faillite : travaux suspendus');
      if (ctx.economy.money < cost) return fail('INSUFFICIENT_FUNDS', `Fonds insuffisants (${cost} CHF requis pour ${Math.round(len)} m de voie de tram)`);
      ctx.economy.applyService(-cost, true);
    }
    const before = this.tracks.rev;
    this.tracks.set(roads, segId, on, dedicated);
    if (this.tracks.rev !== before) this.onTracksChanged(ctx);
    return { ok: true, data: out };
  }

  /** Tronçons équipés : identifiant, longueur, site propre. */
  trackList(ctx: PluginContext): { segId: number; lengthM: number; dedicated: boolean }[] {
    this.syncTracks(ctx);
    return this.tracks.ids().filter((id) => ctx.roads.hasSegment(id)).map((id) => ({ segId: id, lengthM: Math.round(ctx.roads.length(id)), dedicated: this.tracks.dedicated(id) }));
  }

  /* ------------------------------- Vues ------------------------------- */

  private stopView(l: Line, s: Stop): BusStopView {
    const rank = l.stops.indexOf(s);
    return {
      id: s.id, lineId: l.id, name: s.name, x: s.x, y: 0, z: s.z, ok: !!s.snap, s: l.route?.stopS[rank] ?? 0,
      boardings: Math.round(s.boardings * 10) / 10, alightings: Math.round(s.alightings * 10) / 10,
    };
  }

  private lineView(l: Line): BusLineView {
    return {
      id: l.id, mode: l.mode, name: l.name, color: l.color, buses: l.buses, activeBuses: this.running(l) ? l.activeBuses : 0, fare: l.fare,
      stopIds: l.stops.map((s) => s.id), lengthM: Math.round(l.route?.length ?? 0), cycleMin: Math.round(l.cycleMin * 10) / 10,
      headwayMin: this.running(l) ? Math.round(l.headwayMin * 10) / 10 : 0, problem: this.problemOf(l),
      stats: {
        ridersDay: Math.round(l.ridersDay), load: Math.round(l.load * 1000) / 1000, revenueMonth: Math.round(l.revenueMonth), costMonth: Math.round(l.costMonth),
        revenueLastMonth: Math.round(l.revenueLastMonth), costLastMonth: Math.round(l.costLastMonth), refusedDay: Math.round(l.refusedDay),
      },
    };
  }

  private geometry(): BusLineGeometry[] {
    return this.lines.filter((l) => l.route).map((l) => ({
      id: l.id, mode: l.mode, color: l.color, points: l.route!.points.map((v) => Math.round(v * 100) / 100), cum: l.route!.cum.map((v) => Math.round(v * 100) / 100),
      stopS: [...l.route!.stopS], activeBuses: this.running(l) ? l.activeBuses : 0,
      speed: (l.speedMpm / 60) || 5, dwellS: this.tuning.dwellS,
    }));
  }

  summary(ctx: PluginContext): BusSummary {
    // Résultat identique à celui du tick suivant (fonction de l'état du monde seul) : sans effet sur le déterminisme.
    this.syncDepots(ctx);
    let req = 0, act = 0, riders = 0, stops = 0;
    let tLines = 0, tReq = 0, tAct = 0, tRiders = 0;
    for (const l of this.lines) {
      riders += l.ridersDay; stops += l.stops.length;
      if (l.mode === 'tram') { tLines++; tReq += l.buses; tAct += this.running(l) ? l.activeBuses : 0; tRiders += l.ridersDay; continue; }
      req += l.buses; act += this.running(l) ? l.activeBuses : 0;
    }
    const r3 = (v: number): number => Math.round(v * 1000) / 1000;
    const tl = this.tracks.size ? this.tracks.lengths(ctx.roads) : { total: 0, dedicated: 0 };
    return {
      tram: { lines: tLines, depots: this.tramDepots, depotCapacity: this.tramDepotCapacity, vehiclesRequested: tReq, vehiclesActive: tAct, ridersDay: Math.round(tRiders), trackM: Math.round(tl.total), dedicatedM: Math.round(tl.dedicated) },
      lines: this.lines.length, stops, depots: this.depots, depotCapacity: this.depotCapacity, busesRequested: req, busesActive: act,
      modal: { car: r3(this.modal.car), walk: r3(this.modal.walk), bus: r3(this.modal.bus) },
      modalWithoutBus: { car: r3(this.modal0.car), walk: r3(this.modal0.walk), bus: 0 },
      carFactor: r3(this.carFactor), ridersDay: Math.round(riders),
      revenueMonth: Math.round(this.month.revenue), costMonth: Math.round(this.month.cost),
      revenueLastMonth: Math.round(this.lastMonth.revenue), costLastMonth: Math.round(this.lastMonth.cost),
      coveredResidents: this.coveredResidents, coveredJobs: this.coveredJobs, population: ctx.demography?.population ?? 0,
      noReach: this.core.demography?.jobNoReachDay ?? 0, transitHiresMonth: this.month.hires, costMs: Math.round(this.costMs * 100) / 100,
    };
  }

  state(ctx: PluginContext): BusState {
    const stops: BusStopView[] = [];
    for (const l of this.lines) for (const s of l.stops) stops.push(this.stopView(l, s));
    return { summary: this.summary(ctx), lines: this.lines.map((l) => this.lineView(l)), stops };
  }

  stopCard(ctx: PluginContext, stopId: number): BusResult<BusStopCard> {
    const f = this.stopById(stopId);
    if (!f) return fail('NOT_FOUND', 'Arrêt introuvable');
    const ids: number[] = [];
    const R = BUS_WALK_COVER_M / this.tuning.walkDetour;
    ctx.buildings.query(f.stop.x - R, f.stop.z - R, f.stop.x + R, f.stop.z + R, ids);
    let res = 0, jobs = 0;
    for (const id of ids) {
      const i = ctx.buildings.indexOf(id);
      if (i < 0) continue;
      if (Math.hypot(ctx.buildings.store.x[i]! - f.stop.x, ctx.buildings.store.z[i]! - f.stop.z) > R) continue;
      res += ctx.buildings.store.residents[i]!; jobs += ctx.buildings.store.workers[i]!;
    }
    return { ok: true, data: { stop: this.stopView(f.line, f.stop), lineName: f.line.name, lineColor: f.line.color, headwayMin: this.running(f.line) ? Math.round(f.line.headwayMin * 10) / 10 : 0, residentsCovered: res, jobsCovered: jobs, index: f.index + 1, count: f.line.stops.length } };
  }

  /** Carte « Transports en commun » : qualité de desserte des bâtiments, par cellule. */
  layer(ctx: PluginContext): BusLayer | null {
    const bd = ctx.terrain.bounds();
    if (!bd) return null;
    if (this.lines.length && this.covDirty) { this.ensureRoutes(ctx); this.refreshDepots(ctx); this.computeCoverage(ctx); }
    const cols = Math.max(1, Math.ceil((bd.maxX - bd.minX) / LAYER_CELL)), rows = Math.max(1, Math.ceil((bd.maxZ - bd.minZ) / LAYER_CELL));
    const quality = new Uint8Array(cols * rows);
    const st = ctx.buildings.store;
    for (let i = 0; i < ctx.buildings.count; i++) {
      if (!st.roadAccess[i] || st.residents[i]! + st.workers[i]! <= 0) continue;
      const id = st.id[i]!;
      const ci = Math.floor((st.x[i]! - bd.minX) / LAYER_CELL), cj = Math.floor((st.z[i]! - bd.minZ) / LAYER_CELL);
      if (ci < 0 || cj < 0 || ci >= cols || cj >= rows) continue;
      const k = cj * cols + ci;
      // 1 = bâtiment occupé non desservi ; 2..255 = desservi (qualité croissante).
      const q = id < this.covQ.length && this.covN[id]! > 0 ? 2 + Math.round(253 * this.covQ[id]!) : 1;
      if (q > quality[k]!) quality[k] = q;
    }
    return { originX: bd.minX, originZ: bd.minZ, cellSize: LAYER_CELL, cols, rows, quality };
  }

  setLayer(on: boolean): void { this.layerOn = on; this.layerSent = -1; }

  /* ------------------------------ Protocole ------------------------------ */

  private payload(ctx: PluginContext, full: boolean): BusDelta {
    const out: BusDelta = { version: BUS_EXT_VERSION, phys: ctx.clock.totalMinutes * PHYS_PER_MINUTE, speed: ctx.speed };
    const st = this.state(ctx);
    if (full || this.structVersion !== this.sentStruct) { out.lines = st.lines; out.stops = st.stops; this.sentStruct = this.structVersion; }
    if (full || this.geomVersion !== this.sentGeom) { out.geometry = this.geometry(); this.sentGeom = this.geomVersion; }
    if (full || this.tracks.rev !== this.sentTracks) { out.tracks = this.tracks.geometry(ctx.roads); this.sentTracks = this.tracks.rev; }
    return out;
  }

  takeDelta(ctx: PluginContext): BusDelta | undefined {
    if (!this.lines.length) {
      if (this.clearedSent && this.tracks.rev === this.sentTracks) return undefined;
      this.clearedSent = true;
      this.sentStruct = this.structVersion; this.sentGeom = this.geomVersion; this.sentTracks = this.tracks.rev;
      return { version: BUS_EXT_VERSION, phys: ctx.clock.totalMinutes * PHYS_PER_MINUTE, speed: ctx.speed, lines: [], stops: [], geometry: [], tracks: this.tracks.geometry(ctx.roads), layer: this.layerOn ? this.layer(ctx) : null };
    }
    this.sinceTime++;
    const changed = this.structVersion !== this.sentStruct || this.geomVersion !== this.sentGeom || this.tracks.rev !== this.sentTracks;
    const layerDue = this.layerOn && this.layerSent !== this.structVersion;
    if (!changed && !layerDue && this.sinceTime < 10) return undefined;
    this.sinceTime = 0;
    const out = changed ? this.payload(ctx, false) : { version: BUS_EXT_VERSION, phys: ctx.clock.totalMinutes * PHYS_PER_MINUTE, speed: ctx.speed };
    if (layerDue) { out.layer = this.layer(ctx); this.layerSent = this.structVersion; }
    return out;
  }

  snapshot(ctx: PluginContext): BusDelta | undefined {
    if (!this.lines.length && !this.tracks.size) return undefined;
    const out = this.payload(ctx, true);
    if (this.layerOn) { out.layer = this.layer(ctx); this.layerSent = this.structVersion; }
    return out;
  }

  /* ------------------------------ Sauvegarde ------------------------------ */

  private record(l: Line): BusLineRecord {
    return { id: l.id, ...(l.mode === 'tram' ? { mode: 'tram' as const } : {}), name: l.name, color: l.color, buses: l.buses, fare: l.fare, stops: l.stops.map((s) => ({ id: s.id, x: Math.round(s.x * 1000) / 1000, z: Math.round(s.z * 1000) / 1000, name: s.name })) };
  }

  save(): BusSave | undefined {
    if (!this.lines.length && !this.tracks.size) return undefined;
    return {
      ...(this.tracks.size ? { tracks: this.tracks.serialize() } : {}),
      nextLineId: this.nextLineId, nextStopId: this.nextStopId,
      lines: this.lines.map((l) => ({ ...this.record(l), m: [l.revenueMonth, l.costMonth, l.revenueLastMonth, l.costLastMonth] })),
      carFactor: this.carFactor, carKmh: this.carKmh,
      month: { ...this.month }, lastMonth: { ...this.lastMonth },
    };
  }

  load(ctx: PluginContext, s: BusSave): void {
    this.reset();
    this.nextLineId = s.nextLineId; this.nextStopId = s.nextStopId;
    this.tracks.load(readTracks(s.tracks));
    for (const r of s.lines) {
      const l = this.newLine(r.id, r.name, r.color, r.mode ?? 'bus');
      l.buses = r.buses; l.fare = r.fare;
      l.stops = r.stops.map((st) => this.newStop(st.x, st.z, st.name, st.id));
      if (r.m) [l.revenueMonth, l.costMonth, l.revenueLastMonth, l.costLastMonth] = r.m;
      this.lines.push(l);
    }
    this.nextLineId = Math.max(this.nextLineId, ...this.lines.map((l) => l.id + 1));
    this.carKmh = s.carKmh;
    this.month = { ...s.month }; this.lastMonth = { ...s.lastMonth };
    this.lastHires = this.core.demography?.transitHires ?? 0;
    this.setCarFactor(s.carFactor);
    this.routesVersion = -1;
    if (ctx.inGame) { this.ensureRoutes(ctx); this.refreshDepots(ctx); }
    this.tramRouter.allowKey = this.tracks.rev;
    this.clearedSent = !this.lines.length && !this.tracks.size;
    this.touch(true);
  }
}

/** Rang d'insertion qui allonge le moins la boucle (distance à vol d'oiseau). */
export function bestInsert(stops: readonly { x: number; z: number }[], x: number, z: number): number {
  const n = stops.length;
  if (n < 2) return n;
  let best = n, bc = Infinity;
  for (let i = 0; i < n; i++) {
    const a = stops[i]!, b = stops[(i + 1) % n]!;
    const c = Math.hypot(a.x - x, a.z - z) + Math.hypot(b.x - x, b.z - z) - Math.hypot(a.x - b.x, a.z - b.z);
    if (c < bc) { bc = c; best = i + 1; }
  }
  return best;
}

/** Lecture tolérante d'une ligne sérialisée ; null si inutilisable. */
export function readRecord(v: unknown): BusLineRecord | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  const id = finite(o.id, NaN);
  if (!Number.isInteger(id) || id < 1 || !Array.isArray(o.stops)) return null;
  const stops = (o.stops as unknown[]).flatMap((s) => {
    if (typeof s !== 'object' || s === null) return [];
    const q = s as Record<string, unknown>;
    const sid = finite(q.id, NaN), x = finite(q.x, NaN), z = finite(q.z, NaN);
    return Number.isInteger(sid) && sid >= 1 && Number.isFinite(x) && Number.isFinite(z) ? [{ id: sid, x, z, name: cleanName(q.name, `Arrêt ${sid}`) }] : [];
  });
  if (stops.length < 2) return null;
  return {
    id, ...(o.mode === 'tram' ? { mode: 'tram' as const } : {}), name: cleanName(o.name, `Ligne ${id}`), color:
 isColor(o.color) ? o.color : BUS_COLORS[(id - 1) % BUS_COLORS.length]!,
    buses: clamp(Math.round(finite(o.buses, 3)), 0, BUS_MAX_BUSES_PER_LINE), fare: clamp(finite(o.fare, 1.5), 0, BUS_FARE_MAX),
    stops: stops.slice(0, BUS_MAX_STOPS_PER_LINE),
  };
}
