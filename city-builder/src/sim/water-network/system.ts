/**
 * Service de l'eau et de l'assainissement d'une partie (phase 2B.5), branché sur le contrat municipal.
 *
 * Topologie : canalisations d'eau potable et égouts suivent la voirie (un nœud par carrefour, une arête par
 * tronçon, capacité selon le type de voie) dans deux réseaux municipaux distincts, `eau` et `egouts`. Chaque
 * bâtiment est branché à l'extrémité la plus proche du tronçon qui le dessert ; les installations (bâtiments du
 * catalogue `eau_*`) sont des producteurs (eau) ou des exutoires (égouts) branchés de la même façon.
 *
 * Pas horaire :
 *  1. production : pompage (surface si l'eau est à moins de 56 m, sinon forage selon la nappe) → potabilisation
 *     (capacité et rendement selon le financement) ; sans usine, l'eau brute est distribuée non traitée ;
 *  2. répartition `eau` (ordre de mérite : usines, pompages non traités, puis châteaux d'eau) ; les châteaux se
 *     vident à la pointe et se remplissent avec l'excédent des usines ;
 *  3. pression simplifiée : charge des châteaux (sol + 32 m) ou refoulement des usines (+22 m), moins altitude et
 *     pertes de charge (distance × utilisation²) ; desserte = part reçue × facteur de pression ;
 *  4. qualité livrée = mélange des sources (pollution de l'eau captée, abattement de l'usine) ;
 *  5. eaux usées (90 % de l'eau reçue) → réseau `egouts` : stations d'épuration (capacité et rendement selon le
 *     financement), puis émissaires (rejet brut) ; le reste déborde (rivière proche ou sol) ;
 *  6. rejets → charge par cellule → routage vers l'aval (river.ts) → indicateur `pollution_eau`.
 * Pas journalier : effets sur la satisfaction (`satisfaction`), grilles `eau:desserte`, `eau:qualite`,
 * `eau:risque_sanitaire`, mesures d'effets dans le registre. Pas mensuel : lignes budgétaires du service `eau`.
 *
 * Dormant (aucune grille, aucun réseau, aucune sauvegarde) tant qu'aucune installation n'a été posée.
 * Déterministe (aucun tirage aléatoire). TypeScript pur : AUCUN import de three ni du DOM.
 */
import type { IndicatorId } from '../../shared/municipal/types';
import {
  DEFAULT_WATER_SETTINGS, facilityKindOf, SETTINGS_BOUNDS, WATER_FACILITIES,
  type IntakeMode, type PipeGeometry, type RiverLayer, type WaterBalance, type WaterBudget, type WaterFacilityKind,
  type WaterFacilityState, type WaterLayerState, type WaterSettings,
} from '../../shared/water-network/types';
import type { EauDelta, EauSnapshot } from '../../shared/protocol-ext/eau';
import { decodeFloat32, encodeFloat32 } from '../municipal/codec';
import type { Municipal } from '../municipal/municipal';
import type { PluginContext } from '../plugins/types';
import {
  aquiferYield, BOREHOLE_FACTOR, buildingDemand, epurationEfficiency, fundingCapacity, headLoss, healthRisk,
  PIPE_CAPACITY, PIPE_LOSS, PIPE_UPKEEP_PER_KM, potabilisationEfficiency, pressureBar, pressureFactor, PUMP_HEAD,
  rawQuality, satisfactionContribution, SERVED_THRESHOLD, SEWAGE_RATIO, SURFACE_INTAKE_RADIUS, treatedQuality,
} from './model';
import { DEFAULT_ROUTING, RiverRouter, type RoutingParams } from './river';

export const NET_WATER = 'eau';
export const NET_SEWER = 'egouts';
export const GRID_SERVED: IndicatorId = 'eau:desserte';
export const GRID_QUALITY: IndicatorId = 'eau:qualite';
export const GRID_HEALTH: IndicatorId = 'eau:risque_sanitaire';
/** Rayon de recherche d'une route pour brancher un bâtiment / une installation (m). */
const ATTACH_RADIUS = 80;
/** Rayon de recherche de l'eau pour un rejet (m) : station / émissaire, débordement local. */
const OUTFALL_RADIUS = 400;
const OVERFLOW_RADIUS = 200;
/** Lissage horaire de la pollution des cours d'eau (part de l'écart rattrapée par heure). */
const RIVER_RESPONSE = 0.5;
/** Lissage de la desserte / qualité vue par les bâtiments (moyenne glissante horaire). */
const EMA = 0.25;
const HISTORY = 48;
const BIG = 1e9;

interface Facility {
  id: number;
  kind: WaterFacilityKind;
  x: number;
  z: number;
  y: number;
  /** Nœud routier de branchement (-1 = non raccordé). */
  road: number;
  /** Nœud du réseau (eau ou égouts selon le rôle). */
  net: number;
  mode: IntakeMode | undefined;
  /** Rendement de captage (1 en surface, BOREHOLE_FACTOR × nappe en forage). */
  yieldFactor: number;
  intakeCell: number;
  outfallCell: number;
  /** État de l'heure. */
  capacity: number;
  output: number;
  quality: number;
  efficiency: number;
}

interface Consumer {
  id: number;
  x: number;
  z: number;
  y: number;
  category: string;
  road: number;
}

export interface WaterSaveV1 {
  active: boolean;
  settings: WaterSettings;
  tanks: { id: number; stock: number; quality: number }[];
  /** Contribution du module à `pollution_eau` (grille complète, base64 Float32). */
  river: string;
  /** Contribution du module à `satisfaction` (grille complète). */
  satisfaction: string;
  /** Moyennes glissantes par bâtiment. */
  served: { ids: number[]; served: string; quality: string };
  month: WaterBudget;
  lastBudget: WaterBudget | null;
  history: WaterBalance[];
  version: number;
  causes: { shortage: number; discharge: number };
  pending: { cause: number; at: number; grids: { id: string; before: string }[] }[];
}

const emptyBudget = (): WaterBudget => ({ income: 0, expenses: 0, lines: {} });
const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);

export function normalizeSettings(cur: WaterSettings, p: Partial<WaterSettings>): WaterSettings {
  const n = (v: unknown, d: number, [a, b]: readonly [number, number]): number => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, a, b) : d);
  return {
    fundingWater: n(p.fundingWater, cur.fundingWater, SETTINGS_BOUNDS.funding),
    fundingSewer: n(p.fundingSewer, cur.fundingSewer, SETTINGS_BOUNDS.funding),
    tariff: n(p.tariff, cur.tariff, SETTINGS_BOUNDS.tariff),
    restrictions: typeof p.restrictions === 'boolean' ? p.restrictions : cur.restrictions,
  };
}

export class WaterSystem {
  active = false;
  settings: WaterSettings = { ...DEFAULT_WATER_SETTINGS };
  routing: RoutingParams = { ...DEFAULT_ROUTING };
  /** Version de l'état (augmente à chaque pas horaire / réglage). */
  version = 0;
  /** Version de la géométrie des canalisations. */
  pipesVersion = 0;
  balance: WaterBalance | null = null;
  history: WaterBalance[] = [];
  month: WaterBudget = emptyBudget();
  lastBudget: WaterBudget | null = null;
  alerts: string[] = [];

  private muni: Municipal | null = null;
  private river: RiverRouter | null = null;
  private topoKey = '';
  private facilities: Facility[] = [];
  private consumers: Consumer[] = [];
  private consumerIndex = new Map<number, number>();
  /** Nœuds routiers : identifiant -> index compact ; positions ; adjacence (index voisin, longueur). */
  private roadIds: number[] = [];
  private roadIndex = new Map<number, number>();
  private roadY = new Float32Array(0);
  private roadX = new Float32Array(0);
  private roadZ = new Float32Array(0);
  private roadAdj: { to: number; len: number }[][] = [];
  private roadComp = new Int32Array(0);
  private compCount = 0;
  /** Nœuds des réseaux par nœud routier compact. */
  private waterJunction: number[] = [];
  private sewerJunction: number[] = [];
  /** Nœuds consommateurs (eau / égouts) par nœud routier compact (-1 sans bâtiment). */
  private waterConsumer: number[] = [];
  private sewerConsumer: number[] = [];
  /** Tronçons : identifiants, nœuds compacts, arêtes eau / égouts. */
  private segIds: number[] = [];
  private segA: number[] = [];
  private segB: number[] = [];
  private segWaterEdge: number[] = [];
  private segSewerEdge: number[] = [];
  private segLength: number[] = [];
  pipes: PipeGeometry = { ids: new Int32Array(0), offsets: new Int32Array(1), points: new Float32Array(0) };
  private pipeKm = 0;
  /** Stocks des châteaux d'eau (par bâtiment). */
  private tanks = new Map<number, { stock: number; quality: number }>();
  /** Moyennes glissantes de desserte / qualité par bâtiment, dernier état instantané. */
  private servedEma = new Map<number, number>();
  private qualityEma = new Map<number, number>();
  private layer: WaterLayerState = emptyLayer();
  private nodeHead = new Float32Array(0);
  private nodeFed = new Uint8Array(0);
  /** Contributions du module aux grilles partagées. */
  private riverApplied: Float32Array = new Float32Array(0);
  private riverCurrent: Float32Array = new Float32Array(0);
  private riverTarget = new Float32Array(0);
  private emissions = new Float32Array(0);
  private satApplied: Float32Array = new Float32Array(0);
  private shortageCause = -1;
  private dischargeCause = -1;
  private pending: { cause: number; at: number; grids: { id: string; before: Float32Array }[] }[] = [];

  /* ------------------------------------------------------------------ */
  /* Cycle de vie                                                         */
  /* ------------------------------------------------------------------ */

  /** Nouvelle partie : état vidé (le contrat municipal a déjà été remis à neuf par son module). */
  reset(muni: Municipal): void {
    this.muni = muni;
    this.active = false;
    this.settings = { ...DEFAULT_WATER_SETTINGS };
    this.version = 0;
    this.pipesVersion = 0;
    this.balance = null;
    this.history = [];
    this.month = emptyBudget();
    this.lastBudget = null;
    this.alerts = [];
    this.river = null;
    this.topoKey = '';
    this.facilities = [];
    this.consumers = [];
    this.consumerIndex.clear();
    this.tanks.clear();
    this.servedEma.clear();
    this.qualityEma.clear();
    this.layer = emptyLayer();
    this.riverApplied = new Float32Array(0);
    this.riverCurrent = new Float32Array(0);
    this.satApplied = new Float32Array(0);
    this.shortageCause = -1;
    this.dischargeCause = -1;
    this.pending = [];
  }

  /** Façade municipale courante (lève si `reset` n'a pas été appelé). */
  get municipal(): Municipal {
    if (!this.muni) throw new Error('eau : contrat municipal absent');
    return this.muni;
  }

  /** Hydrographie (construite à l'activation). */
  get hydro(): RiverRouter | null { return this.river; }

  private gridCells(): number {
    const g = this.municipal.grids.defaultGeometry;
    return g.cols * g.rows;
  }

  /** Active le service à la première installation ; définit les grilles du module. */
  private activate(ctx: PluginContext): void {
    this.active = true;
    this.ensureGrids();
    ctx.notify('info', 'Service de l\'eau et de l\'assainissement mis en service.');
  }

  private ensureGrids(): void {
    const g = this.municipal.grids;
    // Pollution des cours d'eau : propagée par le routage aval du module (pas de diffusion isotrope sur la terre).
    g.ensure('pollution_eau', { diffusion: undefined });
    g.ensure('satisfaction');
    g.ensure('pollution_sol');
    g.ensure(GRID_SERVED, { nameFr: 'Desserte en eau', unit: 'part', base: 0, min: 0, max: 1 });
    g.ensure(GRID_QUALITY, { nameFr: 'Qualité de l\'eau distribuée', unit: 'part', base: 0, min: 0, max: 1 });
    g.ensure(GRID_HEALTH, { nameFr: 'Risque sanitaire lié à l\'eau', unit: 'part', base: 0, min: 0, max: 1 });
    const n = this.gridCells();
    if (this.riverApplied.length !== n) this.riverApplied = new Float32Array(n);
    if (this.riverCurrent.length !== n) this.riverCurrent = new Float32Array(n);
    if (this.satApplied.length !== n) this.satApplied = new Float32Array(n);
    this.riverTarget = new Float32Array(n);
    this.emissions = new Float32Array(n);
  }

  private ensureRiver(ctx: PluginContext): RiverRouter {
    if (!this.river) this.river = RiverRouter.build(this.municipal.grids.defaultGeometry, ctx.terrain);
    return this.river;
  }

  /* ------------------------------------------------------------------ */
  /* Topologie                                                            */
  /* ------------------------------------------------------------------ */

  private topologyKey(ctx: PluginContext): string {
    const st = ctx.buildings.store;
    let h = 2166136261;
    for (let i = 0; i < ctx.buildings.count; i++) { h ^= st.id[i]!; h = Math.imul(h, 16777619); }
    return `${ctx.roads.version}|${ctx.buildings.count}|${h >>> 0}`;
  }

  /** Reconstruit réseaux, branchements et géométrie si la voirie ou les bâtiments ont changé. */
  syncTopology(ctx: PluginContext, force = false): boolean {
    const key = this.topologyKey(ctx);
    if (!force && key === this.topoKey) return false;
    this.topoKey = key;
    const river = this.ensureRiver(ctx);
    const nets = this.municipal.networks;
    nets.remove(NET_WATER); nets.remove(NET_SEWER);
    const water = nets.ensure(NET_WATER), sewer = nets.ensure(NET_SEWER);
    const roads = ctx.roads;

    // Nœuds routiers.
    this.roadIds = roads.nodeIds().sort((a, b) => a - b);
    this.roadIndex = new Map(this.roadIds.map((id, i) => [id, i]));
    const n = this.roadIds.length;
    this.roadX = new Float32Array(n); this.roadY = new Float32Array(n); this.roadZ = new Float32Array(n);
    this.roadAdj = Array.from({ length: n }, () => []);
    this.waterJunction = new Array<number>(n); this.sewerJunction = new Array<number>(n);
    this.waterConsumer = new Array<number>(n).fill(-1); this.sewerConsumer = new Array<number>(n).fill(-1);
    for (let i = 0; i < n; i++) {
      const p = roads.nodePos(this.roadIds[i]!);
      this.roadX[i] = p.x; this.roadY[i] = p.y; this.roadZ[i] = p.z;
      this.waterJunction[i] = water.addNode({ role: 'junction', x: p.x, z: p.z, ref: this.roadIds[i]! });
      this.sewerJunction[i] = sewer.addNode({ role: 'junction', x: p.x, z: p.z, ref: this.roadIds[i]! });
    }
    // Tronçons.
    this.segIds = roads.segmentIds().sort((a, b) => a - b);
    this.segA = []; this.segB = []; this.segWaterEdge = []; this.segSewerEdge = []; this.segLength = [];
    const offsets = new Int32Array(this.segIds.length + 1);
    const pts: number[] = [];
    let km = 0;
    for (let s = 0; s < this.segIds.length; s++) {
      const id = this.segIds[s]!;
      const [a, b] = roads.endpoints(id);
      const ia = this.roadIndex.get(a)!, ib = this.roadIndex.get(b)!;
      const len = roads.length(id);
      const cap = PIPE_CAPACITY[roads.kindOf(id)] ?? 160;
      this.segA.push(ia); this.segB.push(ib); this.segLength.push(len);
      this.segWaterEdge.push(water.addEdge(this.waterJunction[ia]!, this.waterJunction[ib]!, cap, PIPE_LOSS));
      this.segSewerEdge.push(sewer.addEdge(this.sewerJunction[ia]!, this.sewerJunction[ib]!, cap * 1.5, 0));
      this.roadAdj[ia]!.push({ to: ib, len }); this.roadAdj[ib]!.push({ to: ia, len });
      km += len / 1000;
      // Tracé : courbe de Bézier échantillonnée.
      const c = roads.curve(id);
      const k = Math.max(2, Math.min(9, Math.ceil(len / 24) + 1));
      offsets[s] = pts.length / 2;
      for (let t = 0; t < k; t++) {
        const u = t / (k - 1), v = 1 - u;
        const x = v * v * v * c[0]! + 3 * v * v * u * c[2]! + 3 * v * u * u * c[4]! + u * u * u * c[6]!;
        const z = v * v * v * c[1]! + 3 * v * v * u * c[3]! + 3 * v * u * u * c[5]! + u * u * u * c[7]!;
        pts.push(x, z);
      }
    }
    offsets[this.segIds.length] = pts.length / 2;
    this.pipes = { ids: Int32Array.from(this.segIds), offsets, points: Float32Array.from(pts) };
    this.pipeKm = km;
    this.pipesVersion++;
    // Composantes connexes de la voirie.
    this.roadComp = new Int32Array(n).fill(-1);
    this.compCount = 0;
    for (let i = 0; i < n; i++) {
      if (this.roadComp[i]! >= 0) continue;
      const c = this.compCount++;
      const stack = [i];
      this.roadComp[i] = c;
      while (stack.length) {
        const q = stack.pop()!;
        for (const e of this.roadAdj[q]!) if (this.roadComp[e.to]! < 0) { this.roadComp[e.to] = c; stack.push(e.to); }
      }
    }

    // Bâtiments : installations et consommateurs.
    const st = ctx.buildings.store;
    const prevFac = new Map(this.facilities.map((f) => [f.id, f]));
    this.facilities = [];
    this.consumers = [];
    this.consumerIndex.clear();
    const ids: number[] = [];
    for (let i = 0; i < ctx.buildings.count; i++) ids.push(st.id[i]!);
    ids.sort((a, b) => a - b);
    for (const id of ids) {
      const bi = ctx.buildings.indexOf(id);
      const asset = ctx.buildings.assetOf(id);
      if (bi < 0 || !asset) continue;
      const x = st.x[bi]!, z = st.z[bi]!, y = st.y[bi]!;
      const road = this.attach(ctx, x, z);
      const kind = facilityKindOf(asset.id);
      if (kind) {
        const f: Facility = {
          id, kind, x, z, y, road, net: -1, mode: undefined, yieldFactor: 1, intakeCell: -1, outfallCell: -1,
          capacity: 0, output: 0, quality: 1, efficiency: 0,
        };
        if (kind === 'pompage') {
          const d = river.distanceToWater(x, z, 600);
          if (d <= SURFACE_INTAKE_RADIUS) { f.mode = 'surface'; f.yieldFactor = 1; f.intakeCell = river.nearestWet(x, z, SURFACE_INTAKE_RADIUS); }
          else {
            f.mode = 'forage';
            const wk = river.nearestWet(x, z, 600);
            const wh = wk >= 0 ? river.elev[wk]! : y;
            f.yieldFactor = BOREHOLE_FACTOR * aquiferYield(d, y - wh);
            f.intakeCell = wk;
          }
        }
        if (kind === 'epuration' || kind === 'emissaire') f.outfallCell = river.nearestWet(x, z, kind === 'emissaire' ? 120 : OUTFALL_RADIUS);
        if (kind === 'chateau' && !this.tanks.has(id)) this.tanks.set(id, { stock: 0, quality: 1 });
        if (road >= 0) {
          const ri = this.roadIndex.get(road)!;
          if (kind === 'epuration' || kind === 'emissaire') {
            f.net = sewer.addNode({ role: 'producer', x, z, ref: id, capacity: 0, cost: kind === 'epuration' ? 1 : 10 });
            sewer.addEdge(f.net, this.sewerJunction[ri]!, BIG, 0);
          } else {
            f.net = water.addNode({ role: 'producer', x, z, ref: id, capacity: 0, cost: kind === 'potabilisation' ? 1 : kind === 'pompage' ? 2 : 3 });
            water.addEdge(f.net, this.waterJunction[ri]!, BIG, 0);
          }
        }
        const prev = prevFac.get(id);
        if (prev) { f.output = prev.output; f.capacity = prev.capacity; }
        this.facilities.push(f);
        continue;
      }
      this.consumerIndex.set(id, this.consumers.length);
      this.consumers.push({ id, x, z, y, category: asset.category, road });
    }
    // Châteaux disparus.
    for (const id of [...this.tanks.keys()]) if (!this.facilities.some((f) => f.id === id && f.kind === 'chateau')) this.tanks.delete(id);
    // Consommateurs agrégés par nœud routier.
    for (const c of this.consumers) {
      if (c.road < 0) continue;
      const ri = this.roadIndex.get(c.road)!;
      if (this.waterConsumer[ri]! < 0) {
        const x = this.roadX[ri]!, z = this.roadZ[ri]!;
        this.waterConsumer[ri] = water.addNode({ role: 'consumer', x, z, demand: 0, ref: c.road });
        water.addEdge(this.waterConsumer[ri]!, this.waterJunction[ri]!, BIG, 0);
        this.sewerConsumer[ri] = sewer.addNode({ role: 'consumer', x, z, demand: 0, ref: c.road });
        sewer.addEdge(this.sewerConsumer[ri]!, this.sewerJunction[ri]!, BIG, 0);
      }
    }
    // Tableaux du calque.
    const m = this.consumers.length;
    const old = this.layer;
    const oldIdx = new Map<number, number>();
    for (let i = 0; i < old.buildingIds.length; i++) oldIdx.set(old.buildingIds[i]!, i);
    this.layer = {
      pipeLoad: new Float32Array(this.segIds.length), pipePressure: new Float32Array(this.segIds.length),
      sewerLoad: new Float32Array(this.segIds.length), pipeFed: new Uint8Array(this.segIds.length),
      buildingIds: new Int32Array(m), buildingXZ: new Float32Array(m * 2), buildingServed: new Float32Array(m),
      buildingQuality: new Float32Array(m), buildingSewer: new Uint8Array(m),
    };
    for (let i = 0; i < m; i++) {
      const c = this.consumers[i]!;
      this.layer.buildingIds[i] = c.id;
      this.layer.buildingXZ[2 * i] = c.x; this.layer.buildingXZ[2 * i + 1] = c.z;
      const o = oldIdx.get(c.id);
      if (o !== undefined) {
        this.layer.buildingServed[i] = old.buildingServed[o]!; this.layer.buildingQuality[i] = old.buildingQuality[o]!;
        this.layer.buildingSewer[i] = old.buildingSewer[o]!;
      }
    }
    for (const id of [...this.servedEma.keys()]) if (!this.consumerIndex.has(id)) { this.servedEma.delete(id); this.qualityEma.delete(id); }
    this.nodeHead = new Float32Array(n);
    this.nodeFed = new Uint8Array(n);
    return true;
  }

  /** Nœud routier de branchement d'un point : extrémité la plus proche du tronçon le plus proche (-1 sinon). */
  private attach(ctx: PluginContext, x: number, z: number): number {
    const s = ctx.roads.segmentNear(x, z, ATTACH_RADIUS);
    if (!s) return -1;
    const [a, b] = ctx.roads.endpoints(s.segId);
    const pa = ctx.roads.nodePos(a), pb = ctx.roads.nodePos(b);
    return Math.hypot(pa.x - s.x, pa.z - s.z) <= Math.hypot(pb.x - s.x, pb.z - s.z) ? a : b;
  }

  /* ------------------------------------------------------------------ */
  /* Pas horaire                                                          */
  /* ------------------------------------------------------------------ */

  /** Exécute un pas horaire (appelé par l'ordonnanceur municipal). `at` = minute de jeu de l'échéance. */
  hourly(ctx: PluginContext, at: number): void {
    if (!ctx.inGame || !this.muni) return;
    if (!this.active) {
      if (!this.hasFacility(ctx)) return;
      this.activate(ctx);
    }
    this.ensureGrids();
    this.syncTopology(ctx);
    const muni = this.municipal;
    const water = muni.networks.ensure(NET_WATER), sewer = muni.networks.ensure(NET_SEWER);
    const s = this.settings;
    const hour = (at / 60) % 24;
    const fw = fundingCapacity(s.fundingWater), fs = fundingCapacity(s.fundingSewer);
    const pollGrid = muni.grids.ensure('pollution_eau');
    const st = ctx.buildings.store;

    // 1. Demandes par bâtiment, agrégées par nœud routier.
    const nRoad = this.roadIds.length;
    const nodeDemand = new Float64Array(nRoad);
    const demand = new Float64Array(this.consumers.length);
    let totalDemand = 0;
    for (let i = 0; i < this.consumers.length; i++) {
      const c = this.consumers[i]!;
      const bi = ctx.buildings.indexOf(c.id);
      const res = bi >= 0 ? st.residents[bi]! : 0, wk = bi >= 0 ? st.workers[bi]! : 0;
      const d = buildingDemand(c.category, res, wk, hour, s);
      demand[i] = d;
      totalDemand += d;
      if (c.road >= 0) nodeDemand[this.roadIndex.get(c.road)!]! += d;
    }
    for (let r = 0; r < nRoad; r++) if (this.waterConsumer[r]! >= 0) water.setDemand(this.waterConsumer[r]!, nodeDemand[r]!);

    // 2. Production par composante : pompage -> potabilisation ; châteaux.
    const C = this.compCount;
    const raw = new Float64Array(C), rawPoll = new Float64Array(C), plantCap = new Float64Array(C);
    const fac = this.facilities;
    for (const f of fac) {
      f.output = 0; f.capacity = 0; f.efficiency = 0;
      if (f.road < 0) continue;
      const c = this.roadComp[this.roadIndex.get(f.road)!]!;
      const spec = WATER_FACILITIES[f.kind];
      if (f.kind === 'pompage') {
        f.capacity = spec.capacity * f.yieldFactor * fw;
        const p = f.intakeCell >= 0 && f.mode === 'surface' ? pollGrid.data[f.intakeCell]! : f.mode === 'forage' && f.intakeCell >= 0 ? pollGrid.data[f.intakeCell]! * 0.2 : 0;
        f.quality = rawQuality(f.mode ?? 'surface', p);
        raw[c]! += f.capacity;
        rawPoll[c]! += f.capacity * (1 - f.quality);
      } else if (f.kind === 'potabilisation') {
        f.capacity = spec.capacity * fw;
        f.efficiency = potabilisationEfficiency(s.fundingWater);
        plantCap[c]! += f.capacity;
      } else if (f.kind === 'chateau') {
        const t = this.tanks.get(f.id)!;
        f.capacity = s.fundingWater > 0 ? Math.min(t.stock, spec.capacity) : 0;
        f.quality = t.quality;
      } else if (f.kind === 'epuration') {
        f.capacity = spec.capacity * fs;
        f.efficiency = epurationEfficiency(s.fundingSewer);
      } else {
        f.capacity = spec.capacity;
      }
    }
    // Usines : capacité limitée par l'eau brute de la composante ; qualité = brute après abattement.
    const treatedC = new Float64Array(C);
    for (let c = 0; c < C; c++) treatedC[c] = Math.min(raw[c]!, plantCap[c]!);
    for (const f of fac) {
      if (f.road < 0 || f.net < 0) continue;
      const c = this.roadComp[this.roadIndex.get(f.road)!]!;
      if (f.kind === 'potabilisation') {
        const share = plantCap[c]! > 0 ? f.capacity / plantCap[c]! : 0;
        const avail = treatedC[c]! * share;
        const rawQ = raw[c]! > 0 ? 1 - rawPoll[c]! / raw[c]! : 1;
        f.quality = treatedQuality(rawQ, f.efficiency);
        water.setCapacity(f.net, avail);
      } else if (f.kind === 'pompage') {
        // Sans usine dans la composante : eau brute distribuée non traitée.
        water.setCapacity(f.net, plantCap[c]! > 0 ? 0 : f.capacity);
      } else if (f.kind === 'chateau') {
        water.setCapacity(f.net, f.capacity);
      } else if (f.kind === 'epuration' || f.kind === 'emissaire') {
        sewer.setCapacity(f.net, f.capacity);
      }
    }

    // 3. Répartition de l'eau potable.
    const rep = muni.networks.allocate(NET_WATER);
    const outByNode = new Map<number, number>();
    for (const p of rep.producers) outByNode.set(p.node, p.output);
    const ratioByNode = new Map<number, number>();
    for (const c of rep.consumers) ratioByNode.set(c.node, c.ratio);
    // Production, stockage, qualité par composante.
    const compOut = new Float64Array(C), compQ = new Float64Array(C), compSupply = new Float64Array(C), compDelivered = new Float64Array(C);
    const spare = new Float64Array(C), spareQ = new Float64Array(C);
    let pumped = 0, treated = 0, production = 0;
    for (const f of fac) {
      if (f.net < 0 || f.road < 0) continue;
      if (f.kind === 'epuration' || f.kind === 'emissaire') continue;
      const c = this.roadComp[this.roadIndex.get(f.road)!]!;
      const out = outByNode.get(f.net) ?? 0;
      const cap = water.node(f.net)?.capacity ?? 0;
      f.output = out;
      compOut[c]! += out; compQ[c]! += out * f.quality; compSupply[c]! += cap;
      production += cap;
      if (f.kind === 'potabilisation') { treated += out; spare[c]! += cap - out; spareQ[c]! += (cap - out) * f.quality; }
      if (f.kind === 'pompage' && cap > 0) { spare[c]! += cap - out; spareQ[c]! += (cap - out) * f.quality; }
      if (f.kind === 'chateau') { const t = this.tanks.get(f.id)!; t.stock = Math.max(0, t.stock - out); }
    }
    // Remplissage des châteaux avec l'excédent de capacité de la composante (usines, ou pompages sans usine).
    const towersByComp = new Map<number, Facility[]>();
    for (const f of fac) {
      if (f.kind !== 'chateau' || f.road < 0) continue;
      const c = this.roadComp[this.roadIndex.get(f.road)!]!;
      if (!towersByComp.has(c)) towersByComp.set(c, []);
      towersByComp.get(c)!.push(f);
    }
    let filledTreated = 0, filledRaw = 0;
    const filledC = new Float64Array(C);
    for (const [c, towers] of towersByComp) {
      let avail = spare[c]!;
      if (avail <= 1e-9 || s.fundingWater <= 0) continue;
      const q = spareQ[c]! / avail;
      for (const f of towers) {
        const t = this.tanks.get(f.id)!;
        const spec = WATER_FACILITIES.chateau;
        const room = (spec.storage ?? 0) - t.stock;
        const add = Math.max(0, Math.min(avail, room, spec.capacity));
        if (add <= 0) continue;
        t.quality = (t.stock * t.quality + add * q) / (t.stock + add);
        t.stock += add;
        avail -= add;
        if (plantCap[c]! > 0) filledTreated += add; else filledRaw += add;
        filledC[c]! += add;
      }
    }
    // Eau brute pompée = traitée (distribuée ou stockée) + distribuée / stockée sans traitement.
    let untreatedOut = 0;
    const plantOutC = new Float64Array(C);
    for (const f of fac) if (f.kind === 'potabilisation' && f.road >= 0) plantOutC[this.roadComp[this.roadIndex.get(f.road)!]!]! += f.output;
    for (const f of fac) {
      if (f.kind !== 'pompage' || f.road < 0) continue;
      const c = this.roadComp[this.roadIndex.get(f.road)!]!;
      if (plantCap[c]! > 0) f.output = raw[c]! > 0 ? (plantOutC[c]! + filledC[c]!) * (f.capacity / raw[c]!) : 0;
      else { untreatedOut += f.output; f.output += raw[c]! > 0 ? filledC[c]! * (f.capacity / raw[c]!) : 0; }
    }
    treated += filledTreated;
    pumped = treated + untreatedOut + filledRaw;
    for (let c = 0; c < C; c++) compQ[c] = compOut[c]! > 0 ? compQ[c]! / compOut[c]! : 1;

    // 4. Pression : charge maximale atteignable à chaque nœud (Dijkstra multi-sources).
    for (const cons of rep.consumers) {
      const ri = this.roadIndex.get(water.node(cons.node)!.ref);
      if (ri !== undefined) compDelivered[this.roadComp[ri]!]! += cons.delivered;
    }
    this.computePressure(fac, compSupply, compDelivered);

    // 5. Desserte par bâtiment.
    const delivered = new Float64Array(this.consumers.length);
    let served = 0, unserved = 0, totalDelivered = 0, qSum = 0, pSum = 0, pN = 0;
    const L = this.layer;
    for (let i = 0; i < this.consumers.length; i++) {
      const c = this.consumers[i]!;
      let sv = 0, q = 0;
      if (c.road >= 0) {
        const ri = this.roadIndex.get(c.road)!;
        if (this.nodeFed[ri]) {
          const ratio = ratioByNode.get(this.waterConsumer[ri]!) ?? 0;
          const bar = pressureBar(this.nodeHead[ri]!, c.y, 0);
          sv = ratio * pressureFactor(bar);
          q = compQ[this.roadComp[ri]!]!;
          pSum += bar; pN++;
        }
      }
      delivered[i] = demand[i]! * sv;
      totalDelivered += delivered[i]!;
      qSum += delivered[i]! * q;
      const e0 = this.servedEma.get(c.id), q0 = this.qualityEma.get(c.id);
      const es = e0 === undefined ? sv : e0 + EMA * (sv - e0);
      const eq = q0 === undefined ? q : q0 + EMA * (q - q0);
      this.servedEma.set(c.id, es); this.qualityEma.set(c.id, eq);
      L.buildingServed[i] = sv; L.buildingQuality[i] = q;
      if (sv >= SERVED_THRESHOLD) served++; else unserved++;
    }

    // 6. Eaux usées.
    const nodeSewage = new Float64Array(nRoad);
    let sewage = 0;
    for (let i = 0; i < this.consumers.length; i++) {
      const c = this.consumers[i]!;
      if (c.road < 0) continue;
      const v = delivered[i]! * SEWAGE_RATIO;
      nodeSewage[this.roadIndex.get(c.road)!]! += v;
      sewage += v;
    }
    for (let r = 0; r < nRoad; r++) if (this.sewerConsumer[r]! >= 0) sewer.setDemand(this.sewerConsumer[r]!, nodeSewage[r]!);
    const srep = muni.networks.allocate(NET_SEWER);
    const sOut = new Map<number, number>();
    for (const p of srep.producers) sOut.set(p.node, p.output);
    const sRatio = new Map<number, number>();
    for (const c of srep.consumers) sRatio.set(c.node, c.ratio);
    const river = this.river!;
    const em = this.emissions;
    em.fill(0);
    let sewageTreated = 0, sewageRaw = 0, sewageOverflow = 0, load = 0;
    const soil = muni.grids.ensure('pollution_sol');
    for (const f of fac) {
      if (f.kind !== 'epuration' && f.kind !== 'emissaire') continue;
      const out = f.net >= 0 ? sOut.get(f.net) ?? 0 : 0;
      f.output = out;
      if (out <= 0) continue;
      const residual = f.kind === 'epuration' ? out * (1 - f.efficiency) : out;
      if (f.kind === 'epuration') sewageTreated += out; else sewageRaw += out;
      if (f.outfallCell >= 0) { em[f.outfallCell]! += residual; load += residual; }
      else soil.stamp(f.x, f.z, 48, residual * 0.01, 'linear');
    }
    for (let r = 0; r < nRoad; r++) {
      const cn = this.sewerConsumer[r]!;
      if (cn < 0) continue;
      const over = nodeSewage[r]! * (1 - (sRatio.get(cn) ?? 0));
      if (over <= 1e-9) continue;
      sewageOverflow += over;
      const x = this.roadX[r]!, z = this.roadZ[r]!;
      const k = river.nearestWet(x, z, OVERFLOW_RADIUS);
      if (k >= 0) { em[k]! += over; load += over; }
      else soil.stamp(x, z, 48, over * 0.01, 'linear');
    }
    // Raccordement égout par bâtiment : part évacuée de son nœud.
    for (let i = 0; i < this.consumers.length; i++) {
      const c = this.consumers[i]!;
      const cn = c.road >= 0 ? this.sewerConsumer[this.roadIndex.get(c.road)!]! : -1;
      L.buildingSewer[i] = cn >= 0 && (sRatio.get(cn) ?? 0) >= 0.5 && (srep.supply > 0) ? 1 : 0;
    }

    // 7. Routage vers l'aval et mise à jour de `pollution_eau` (contribution du module).
    river.route(em, this.riverTarget, this.routing);
    let pMax = 0, pSumR = 0;
    for (const k of river.cells()) {
      const cur = this.riverCurrent[k]! + RIVER_RESPONSE * (this.riverTarget[k]! - this.riverCurrent[k]!);
      this.riverCurrent[k] = cur;
      const want = cur - this.riverApplied[k]!;
      if (Math.abs(want) > 1e-6) {
        const i = k % pollGrid.cols, j = (k - i) / pollGrid.cols;
        this.riverApplied[k]! += pollGrid.add(i, j, want);
      }
      const v = pollGrid.data[k]!;
      if (v > pMax) pMax = v;
      pSumR += v;
    }

    // 8. Calque par tronçon.
    for (let sI = 0; sI < this.segIds.length; sI++) {
      const a = this.segA[sI]!, b = this.segB[sI]!;
      L.pipeFed[sI] = this.nodeFed[a] || this.nodeFed[b] ? 1 : 0;
      L.pipePressure[sI] = L.pipeFed[sI] ? Math.min(pressureBar(this.nodeHead[a]!, this.roadY[a]!, 0), pressureBar(this.nodeHead[b]!, this.roadY[b]!, 0)) : 0;
    }
    const edgeLoad = new Map<number, number>();
    for (const e of rep.edges) edgeLoad.set(e.edge, e.load);
    const sEdgeLoad = new Map<number, number>();
    for (const e of srep.edges) sEdgeLoad.set(e.edge, e.load);
    for (let sI = 0; sI < this.segIds.length; sI++) {
      L.pipeLoad[sI] = edgeLoad.get(this.segWaterEdge[sI]!) ?? 0;
      L.sewerLoad[sI] = sEdgeLoad.get(this.segSewerEdge[sI]!) ?? 0;
    }

    // 9. Bilan, budget, alertes, registre d'effets.
    let stock = 0, storage = 0;
    for (const f of fac) if (f.kind === 'chateau') { stock += this.tanks.get(f.id)!.stock; storage += WATER_FACILITIES.chateau.storage ?? 0; }
    const nb = this.consumers.length;
    const bal: WaterBalance = {
      at, pumped, treated, production, demand: totalDemand, delivered: totalDelivered, stock, storage,
      quality: totalDelivered > 0 ? qSum / totalDelivered : 0, servedShare: nb ? served / nb : 0,
      buildings: nb, served, unserved, pressure: pN ? pSum / pN : 0,
      sewage, sewageTreated, sewageRaw, sewageOverflow,
      sewerCoverage: sewage > 0 ? (sewageTreated + sewageRaw) / sewage : 0,
      pollutionLoad: load,
      riverPollutionMean: river.wetCount ? pSumR / river.wetCount : 0, riverPollutionMax: pMax,
    };
    this.balance = bal;
    this.history.push(bal);
    if (this.history.length > HISTORY) this.history.splice(0, this.history.length - HISTORY);
    this.accountHour(bal, fac);
    this.updateAlerts(bal, fac);
    this.traceEffects(ctx, bal, at);
    this.version++;
  }

  private hasFacility(ctx: PluginContext): boolean {
    const st = ctx.buildings.store;
    for (let i = 0; i < ctx.buildings.count; i++) {
      const a = ctx.buildings.assetOf(st.id[i]!);
      if (a && facilityKindOf(a.id)) return true;
    }
    return false;
  }

  /** Charge (m) disponible à chaque nœud routier ; nœuds alimentés. */
  private computePressure(fac: Facility[], compSupply: Float64Array, compDelivered: Float64Array): void {
    const n = this.roadIds.length;
    const head = this.nodeHead, fed = this.nodeFed;
    head.fill(-BIG); fed.fill(0);
    const C = this.compCount;
    const hMax = new Float64Array(C).fill(-BIG);
    const srcs: { r: number; h: number }[] = [];
    for (const f of fac) {
      if (f.road < 0 || f.net < 0) continue;
      if (f.kind === 'epuration' || f.kind === 'emissaire') continue;
      const r = this.roadIndex.get(f.road)!;
      let h: number;
      if (f.kind === 'chateau') {
        if (this.tanks.get(f.id)!.stock <= 1e-6 && f.output <= 0) continue;
        h = f.y + (WATER_FACILITIES.chateau.head ?? 30);
      } else {
        if (f.output <= 0 && f.capacity <= 0) continue;
        if (f.kind === 'pompage' && compSupply[this.roadComp[r]!]! <= 0) continue;
        h = f.y + PUMP_HEAD;
      }
      srcs.push({ r, h });
      const c = this.roadComp[r]!;
      if (h > hMax[c]!) hMax[c] = h;
    }
    if (!srcs.length) return;
    const lossRate = new Float64Array(C);
    for (let c = 0; c < C; c++) {
      const u = compSupply[c]! > 0 ? compDelivered[c]! / compSupply[c]! : 0;
      lossRate[c] = headLoss(1, u);
    }
    // Dijkstra : clé = (hMax − h_source)/pertes + distance ; charge = hMax − pertes · clé.
    const key = new Float64Array(n).fill(Infinity);
    const heap: [number, number][] = [];
    const push = (k: number, v: number): void => {
      heap.push([k, v]);
      let i = heap.length - 1;
      while (i > 0) { const p = (i - 1) >> 1; if (heap[p]![0] < k || (heap[p]![0] === k && heap[p]![1] <= v)) break; heap[i] = heap[p]!; i = p; }
      heap[i] = [k, v];
    };
    const pop = (): [number, number] => {
      const top = heap[0]!; const last = heap.pop()!;
      if (heap.length) {
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          const lt = (a: [number, number], b: [number, number]): boolean => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
          const cand = (x: number): [number, number] => (x === i ? last : heap[x]!);
          if (l < heap.length && lt(heap[l]!, cand(m))) m = l;
          if (r < heap.length && lt(heap[r]!, cand(m))) m = r;
          if (m === i) break;
          heap[i] = heap[m]!; i = m;
        }
        heap[i] = last;
      }
      return top;
    };
    for (const s of srcs) {
      const c = this.roadComp[s.r]!;
      const k0 = (hMax[c]! - s.h) / Math.max(1e-9, lossRate[c]!);
      if (k0 < key[s.r]!) { key[s.r] = k0; push(k0, s.r); }
    }
    while (heap.length) {
      const [k, r] = pop();
      if (k > key[r]!) continue;
      for (const e of this.roadAdj[r]!) {
        const nk = k + e.len;
        if (nk < key[e.to]!) { key[e.to] = nk; push(nk, e.to); }
      }
    }
    for (let r = 0; r < n; r++) {
      if (!Number.isFinite(key[r]!)) continue;
      const c = this.roadComp[r]!;
      if (compSupply[c]! <= 0) continue;
      fed[r] = 1;
      head[r] = hMax[c]! - lossRate[c]! * key[r]!;
    }
  }

  /** Trésorerie de la ville (branchée par le plugin) : + recette, − dépense, à chaque heure. */
  onMoney: ((signed: number) => void) | null = null;

  private accountHour(b: WaterBalance, fac: Facility[]): void {
    const s = this.settings, m = this.month;
    const add = (k: string, v: number, side: 'income' | 'expense'): void => {
      if (!(v > 0)) return;
      this.onMoney?.(side === 'income' ? v : -v);
      m.lines[k] = (m.lines[k] ?? 0) + v;
      if (side === 'income') m.income += v; else m.expenses += v;
    };
    add('vente:eau', b.delivered * s.tariff, 'income');
    add('exploitation:pompage', b.pumped * WATER_FACILITIES.pompage.costPerM3 * s.fundingWater, 'expense');
    add('exploitation:potabilisation', b.treated * WATER_FACILITIES.potabilisation.costPerM3 * s.fundingWater, 'expense');
    add('exploitation:epuration', b.sewageTreated * WATER_FACILITIES.epuration.costPerM3 * s.fundingSewer, 'expense');
    let towers = 0;
    for (const f of fac) if (f.kind === 'chateau') towers += f.output;
    add('exploitation:chateaux', towers * WATER_FACILITIES.chateau.costPerM3 * s.fundingWater, 'expense');
    // Entretien des canalisations, réparti par heure (mois de 30 jours).
    add('entretien:canalisations', (this.pipeKm * PIPE_UPKEEP_PER_KM * (s.fundingWater + s.fundingSewer) / 2) / (30 * 24), 'expense');
  }

  private updateAlerts(b: WaterBalance, fac: Facility[]): void {
    const a: string[] = [];
    const has = (k: WaterFacilityKind): boolean => fac.some((f) => f.kind === k);
    if (!has('pompage')) a.push('Aucune station de pompage : pas de ressource en eau.');
    if (b.unserved > 0) a.push(`Pénurie : ${b.unserved} bâtiment(s) non desservi(s) sur ${b.buildings}.`);
    if (b.production > 0 && b.demand > b.production) a.push('Demande supérieure à la capacité de production.');
    if (has('pompage') && !has('potabilisation')) a.push('Eau distribuée sans potabilisation.');
    if (b.quality > 0 && b.quality < 0.7) a.push(`Qualité de l'eau médiocre (${Math.round(b.quality * 100)} %).`);
    if (b.sewageRaw + b.sewageOverflow > 0.01) a.push(`Rejets d'eaux usées non traitées : ${(b.sewageRaw + b.sewageOverflow).toFixed(1)} m³/h.`);
    if (this.settings.fundingSewer < 1 && has('epuration')) a.push('Station d\'épuration sous-financée : épuration partielle.');
    if (this.settings.fundingWater < 1) a.push('Service de l\'eau sous-financé : production réduite.');
    for (const f of fac) if (f.road < 0) a.push(`${WATER_FACILITIES[f.kind].nameFr} n° ${f.id} non raccordée (aucune route à 80 m).`);
    for (const f of fac) if ((f.kind === 'epuration' || f.kind === 'emissaire') && f.outfallCell < 0) a.push(`${WATER_FACILITIES[f.kind].nameFr} n° ${f.id} loin de l'eau : rejet au sol.`);
    this.alerts = a;
  }

  private traceEffects(ctx: PluginContext, b: WaterBalance, at: number): void {
    const fx = this.municipal.effects;
    if (b.unserved > 0 && this.shortageCause < 0) {
      this.shortageCause = fx.cause({ kind: 'penurie_eau', label: 'Pénurie d\'eau', source: 'eau', at });
      fx.record(this.shortageCause, 'eau:batiments_non_desservis', b.unserved, 'bâtiments', at, {}, `${b.delivered.toFixed(1)} / ${b.demand.toFixed(1)} m³/h livrés`);
    } else if (b.unserved === 0 && this.shortageCause >= 0) {
      fx.record(this.shortageCause, 'eau:batiments_non_desservis', 0, 'bâtiments', at, {}, 'pénurie résorbée');
      this.shortageCause = -1;
    }
    const raw = b.sewageRaw + b.sewageOverflow;
    if (raw > 0.01 && this.dischargeCause < 0) {
      this.dischargeCause = fx.cause({ kind: 'rejet_eaux_usees', label: 'Rejet d\'eaux usées non traitées', source: 'eau', at });
      fx.record(this.dischargeCause, 'eau:rejet_brut', raw, 'm³/h', at);
      this.pending.push({ cause: this.dischargeCause, at, grids: [{ id: 'pollution_eau', before: this.municipal.grids.ensure('pollution_eau').copyValues() }] });
    } else if (raw <= 0.01 && this.dischargeCause >= 0) {
      fx.record(this.dischargeCause, 'eau:rejet_brut', 0, 'm³/h', at, {}, 'rejets arrêtés');
      this.dischargeCause = -1;
    }
    void ctx;
  }

  /* ------------------------------------------------------------------ */
  /* Pas journalier et mensuel                                            */
  /* ------------------------------------------------------------------ */

  /** Effets journaliers sur les grilles (satisfaction, desserte, qualité, risque sanitaire) et mesures en attente. */
  daily(ctx: PluginContext, at: number): void {
    if (!this.active || !this.muni) return;
    this.ensureGrids();
    const g = this.municipal.grids;
    const sat = g.ensure('satisfaction'), served = g.ensure(GRID_SERVED), quality = g.ensure(GRID_QUALITY), health = g.ensure(GRID_HEALTH);
    const n = sat.size;
    const sumS = new Float64Array(n), sumQ = new Float64Array(n), sumC = new Float64Array(n), maxH = new Float64Array(n), cnt = new Uint16Array(n);
    for (let i = 0; i < this.consumers.length; i++) {
      const c = this.consumers[i]!;
      const k = sat.cellAt(c.x, c.z);
      if (k < 0) continue;
      const sv = this.servedEma.get(c.id) ?? 0, q = this.qualityEma.get(c.id) ?? 0;
      sumS[k]! += sv; sumQ[k]! += q;
      sumC[k]! += satisfactionContribution(sv, q, this.layer.buildingSewer[i] === 1, this.settings);
      maxH[k] = Math.max(maxH[k]!, healthRisk(sv, q));
      cnt[k]!++;
    }
    for (let k = 0; k < n; k++) {
      const i = k % sat.cols, j = (k - i) / sat.cols;
      const m = cnt[k]!;
      const want = m ? sumC[k]! / m : 0;
      const d = want - this.satApplied[k]!;
      if (Math.abs(d) > 1e-6) this.satApplied[k]! += sat.add(i, j, d);
      const sv = m ? sumS[k]! / m : 0, q = m ? sumQ[k]! / m : 0, h = m ? maxH[k]! : 0;
      if (served.data[k] !== sv) served.set(i, j, sv);
      if (quality.data[k] !== q) quality.set(i, j, q);
      if (health.data[k] !== h) health.set(i, j, h);
    }
    // Mesures d'effets différées (décisions du joueur, rejets) : variation des grilles depuis la cause.
    const fx = this.municipal.effects;
    const keep: typeof this.pending = [];
    for (const p of this.pending) {
      if (at - p.at < 1440) { keep.push(p); continue; }
      for (const gr of p.grids) {
        const grid = g.get(gr.id as IndicatorId);
        if (grid && grid.size === gr.before.length) fx.measureGrid(p.cause, grid, gr.before, at, 'mesure à J+1');
      }
    }
    this.pending = keep;
    this.version++;
    void ctx;
  }

  /** Clôture mensuelle : lignes budgétaires du service `eau` dans le contrat municipal. */
  monthly(): void {
    if (!this.active || !this.muni) return;
    const b = this.municipal.budget;
    for (const [k, v] of Object.entries(this.month.lines).sort(([a], [c]) => a.localeCompare(c))) {
      const amount = Math.round(v);
      if (amount <= 0) continue;
      b.post(k.startsWith('vente') ? 'income' : 'expense', k, amount, 'eau');
    }
    this.lastBudget = this.month;
    this.month = emptyBudget();
    this.version++;
  }

  /* ------------------------------------------------------------------ */
  /* Réglages, consultation                                               */
  /* ------------------------------------------------------------------ */

  /** Applique des réglages ; une décision du joueur est une cause du registre, son effet est mesuré à J+1. */
  applySettings(p: Partial<WaterSettings>, at: number): WaterSettings {
    const prev = this.settings;
    const next = normalizeSettings(prev, p);
    const changed = (Object.keys(next) as (keyof WaterSettings)[]).filter((k) => next[k] !== prev[k]);
    this.settings = next;
    if (changed.length && this.active && this.muni) {
      const fx = this.municipal.effects;
      const label = changed.map((k) => `${k} ${String(prev[k])} → ${String(next[k])}`).join(', ');
      const cause = fx.cause({ kind: 'reglage_eau', label: `Réglage du service de l'eau : ${label}`, source: 'joueur', at });
      const g = this.municipal.grids;
      const ids: IndicatorId[] = ['pollution_eau', 'satisfaction', GRID_SERVED];
      this.pending.push({ cause, at, grids: ids.filter((id) => g.has(id)).map((id) => ({ id, before: g.get(id)!.copyValues() })) });
    }
    this.version++;
    return next;
  }

  /** État d'un bâtiment : desserte (moyenne glissante), pression, qualité, égout, croissance autorisée. */
  buildingState(id: number): { served: number; pressure: number; quality: number; sewer: boolean; growthAllowed: boolean } | null {
    if (!this.active) return null;
    const i = this.consumerIndex.get(id);
    if (i === undefined) return null;
    const c = this.consumers[i]!;
    const ri = c.road >= 0 ? this.roadIndex.get(c.road) : undefined;
    const pressure = ri !== undefined && this.nodeFed[ri] ? pressureBar(this.nodeHead[ri]!, c.y, 0) : 0;
    const served = this.servedEma.get(id) ?? 0;
    return { served, pressure, quality: this.qualityEma.get(id) ?? 0, sewer: this.layer.buildingSewer[i] === 1, growthAllowed: served >= SERVED_THRESHOLD };
  }

  /** Croissance autorisée (service non encore créé : toujours vrai ; sinon bâtiment desservi). */
  growthAllowed(id: number): boolean {
    if (!this.active) return true;
    const st = this.buildingState(id);
    return st ? st.growthAllowed : true;
  }

  facilityStates(): WaterFacilityState[] {
    return this.facilities.map((f) => {
      const s: WaterFacilityState = { buildingId: f.id, kind: f.kind, x: f.x, z: f.z, connected: f.road >= 0, capacity: f.capacity, output: f.output };
      if (f.kind === 'pompage') {
        s.intake = f.mode ?? 'surface';
        s.intakePollution = f.intakeCell >= 0 && this.muni?.grids.get('pollution_eau') ? this.muni.grids.get('pollution_eau')!.data[f.intakeCell]! : 0;
      }
      if (f.kind === 'chateau') { s.stock = this.tanks.get(f.id)?.stock ?? 0; s.storage = WATER_FACILITIES.chateau.storage ?? 0; }
      if (f.kind === 'epuration') s.efficiency = f.efficiency;
      if (f.kind === 'epuration' || f.kind === 'emissaire') {
        s.outfall = f.outfallCell >= 0 && this.river ? [this.river.centerX(f.outfallCell), this.river.centerZ(f.outfallCell)] : null;
      }
      return s;
    });
  }

  riverLayer(): RiverLayer {
    const r = this.river;
    const g = this.municipal.grids.defaultGeometry;
    const cells = r ? Int32Array.from(r.cells()) : new Int32Array(0);
    const down = new Int32Array(cells.length);
    for (let i = 0; i < cells.length; i++) down[i] = r!.down[cells[i]!]!;
    return { originX: g.originX, originZ: g.originZ, cellSize: g.cellSize, cols: g.cols, cells, pollution: this.riverPollution(), downstream: down };
  }

  riverPollution(): Float32Array {
    const r = this.river;
    const grid = this.muni?.grids.get('pollution_eau');
    if (!r) return new Float32Array(0);
    const cells = r.cells();
    const out = new Float32Array(cells.length);
    if (grid) for (let i = 0; i < cells.length; i++) out[i] = grid.data[cells[i]!]!;
    return out;
  }

  /** Charge utile du delta (copies neuves ; `withPipes` ajoute la géométrie). */
  delta(withPipes: boolean): EauDelta {
    const L = this.layer;
    const d: EauDelta = {
      version: this.version,
      balance: this.balance ?? emptyBalance(),
      settings: { ...this.settings },
      facilities: this.facilityStates(),
      layer: {
        pipeLoad: L.pipeLoad.slice(), pipePressure: L.pipePressure.slice(), sewerLoad: L.sewerLoad.slice(), pipeFed: L.pipeFed.slice(),
        buildingIds: L.buildingIds.slice(), buildingXZ: L.buildingXZ.slice(), buildingServed: L.buildingServed.slice(),
        buildingQuality: L.buildingQuality.slice(), buildingSewer: L.buildingSewer.slice(),
      },
      riverPollution: this.riverPollution(),
      budget: { current: cloneBudget(this.month), last: this.lastBudget ? cloneBudget(this.lastBudget) : null },
      alerts: [...this.alerts],
    };
    if (withPipes) { d.pipes = clonePipes(this.pipes); d.river = this.riverLayer(); }
    return d;
  }

  snapshot(): EauSnapshot {
    const d = this.delta(false);
    const { pipes: _p, river: _r, ...rest } = d;
    void _p; void _r;
    return { ...rest, pipes: clonePipes(this.pipes), river: this.riverLayer() };
  }

  /* ------------------------------------------------------------------ */
  /* Sauvegarde                                                           */
  /* ------------------------------------------------------------------ */

  toJSON(): WaterSaveV1 {
    const ids = [...this.servedEma.keys()].sort((a, b) => a - b);
    return {
      active: this.active,
      settings: { ...this.settings },
      tanks: [...this.tanks.entries()].sort(([a], [b]) => a - b).map(([id, t]) => ({ id, stock: t.stock, quality: t.quality })),
      river: encodeFloat32(this.riverApplied),
      satisfaction: encodeFloat32(this.satApplied),
      served: { ids, served: encodeFloat32(Float32Array.from(ids.map((i) => this.servedEma.get(i)!))), quality: encodeFloat32(Float32Array.from(ids.map((i) => this.qualityEma.get(i) ?? 0))) },
      month: cloneBudget(this.month),
      lastBudget: this.lastBudget ? cloneBudget(this.lastBudget) : null,
      history: this.history.map((h) => ({ ...h })),
      version: this.version,
      causes: { shortage: this.shortageCause, discharge: this.dischargeCause },
      pending: this.pending.map((p) => ({ cause: p.cause, at: p.at, grids: p.grids.map((g) => ({ id: g.id, before: encodeFloat32(g.before) })) })),
    };
  }

  /** Recharge un état sauvegardé (après `reset`) ; la topologie est reconstruite au pas suivant. */
  load(d: WaterSaveV1): void {
    this.active = d.active;
    this.settings = normalizeSettings({ ...DEFAULT_WATER_SETTINGS }, d.settings);
    this.tanks = new Map(d.tanks.map((t) => [t.id, { stock: t.stock, quality: t.quality }]));
    const n = this.gridCells();
    const rv = decodeFloat32(d.river, n), sv = decodeFloat32(d.satisfaction, n);
    if (rv.length !== n || sv.length !== n) throw new Error('section eau : grilles de taille incohérente');
    this.riverApplied = rv;
    this.riverCurrent = rv.slice();
    this.satApplied = sv;
    const s = decodeFloat32(d.served.served, d.served.ids.length), q = decodeFloat32(d.served.quality, d.served.ids.length);
    this.servedEma = new Map(d.served.ids.map((id, i) => [id, s[i] ?? 0]));
    this.qualityEma = new Map(d.served.ids.map((id, i) => [id, q[i] ?? 0]));
    this.month = cloneBudget(d.month);
    this.lastBudget = d.lastBudget ? cloneBudget(d.lastBudget) : null;
    this.history = d.history.map((h) => ({ ...h }));
    this.balance = this.history[this.history.length - 1] ?? null;
    this.version = d.version;
    this.shortageCause = d.causes.shortage;
    this.dischargeCause = d.causes.discharge;
    this.pending = d.pending.map((p) => ({ cause: p.cause, at: p.at, grids: p.grids.map((g) => ({ id: g.id, before: decodeFloat32(g.before, n) })) }));
    this.topoKey = '';
    if (this.active) this.ensureGrids();
  }
}

function emptyLayer(): WaterLayerState {
  return {
    pipeLoad: new Float32Array(0), pipePressure: new Float32Array(0), sewerLoad: new Float32Array(0), pipeFed: new Uint8Array(0),
    buildingIds: new Int32Array(0), buildingXZ: new Float32Array(0), buildingServed: new Float32Array(0),
    buildingQuality: new Float32Array(0), buildingSewer: new Uint8Array(0),
  };
}

export function emptyBalance(): WaterBalance {
  return {
    at: 0, pumped: 0, treated: 0, production: 0, demand: 0, delivered: 0, stock: 0, storage: 0, quality: 0, servedShare: 0,
    buildings: 0, served: 0, unserved: 0, pressure: 0, sewage: 0, sewageTreated: 0, sewageRaw: 0, sewageOverflow: 0,
    sewerCoverage: 0, pollutionLoad: 0, riverPollutionMean: 0, riverPollutionMax: 0,
  };
}

const cloneBudget = (b: WaterBudget): WaterBudget => ({ income: b.income, expenses: b.expenses, lines: { ...b.lines } });
const clonePipes = (p: PipeGeometry): PipeGeometry => ({ ids: p.ids.slice(), offsets: p.offsets.slice(), points: p.points.slice() });
