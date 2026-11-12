/**
 * Simulation de trafic (worker, TypeScript pur, structure-de-tableaux).
 *
 * - Véhicules en SoA indexés par EMPLACEMENT (identifiant stable transmis au rendu pour l'interpolation),
 *   liste active dense + pile d'emplacements libres ; aucune allocation dans `step()` en régime établi.
 * - Itinéraires A* sur les arcs (ArcRouter) stockés dans une arène d'entiers ; coût mis à jour par la
 *   congestion observée (réacheminement émergent).
 * - Voies et sens, changements de voie (obligatoires avant une manœuvre, et de confort) avec contrôle
 *   de sécurité de type MOBIL ; poursuite IDM avec le véhicule qui précède sur la voie ET au-delà
 *   (connecteur puis voie suivante).
 * - Carrefours : priorité à droite, cédez-le-passage (rangs des voies), feux tricolores à phases
 *   (vert / orange / rouge intégral) ; réservation des trajectoires en conflit (aucune collision dans le
 *   carrefour), interdiction de s'engager si la sortie est bloquée, engagement irrévocable si l'arrêt est
 *   impossible, déblocage des interblocages de priorité à droite.
 * - Demande de phase 1 : trajets domicile ↔ travail / commerces entre bâtiments RELIÉS par la route,
 *   modulés par l'heure ; véhicules de service et de livraison depuis les bâtiments correspondants.
 * - Densité par tronçon (véh/km/voie, moyenne glissante) et vitesse moyenne pour cartes de chaleur.
 */
import type { AssetCatalog } from '../../shared/catalog';
import { VEHICLE_STRIDE } from '../../shared/constants';
import type { VehicleFrame } from '../../shared/protocol';
import { FREE_GAP, IDM_BY_KIND, idmAccel } from './idm';
import { Control, EdgeGrid, TrafficGraph, Turn, type TrafficNetworkInput } from './network';
import { ArcRouter } from './router';

/** Trame véhicules étendue (champs optionnels compris par src/render/vehicles). */
export interface TrafficVehicleFrame extends VehicleFrame {
  ids: Uint32Array;
  variants: Uint8Array;
  /** 1 freinage, 8 urgence (gyrophares). */
  flags: Uint8Array;
}

/** Bâtiment vu par le trafic (fourni par le monde). */
export interface TrafficBuilding {
  id: number;
  assetId: string;
  category: string;
  residents: number;
  jobs: number;
  /** Point d'accès (façade) en coordonnées monde. */
  x: number;
  z: number;
}

export interface TrafficOptions {
  seed?: number;
  /** Plafond de véhicules simultanés. */
  maxVehicles?: number;
  /** Multiplicateur de la demande (part de la population en déplacement). */
  demandScale?: number;
  /** Apparitions maximales par pas. */
  spawnPerStep?: number;
  /** Distance maximale bâtiment → route pour être « relié » (m). */
  accessDistance?: number;
  /** Génération automatique des trajets (défaut vrai ; faux pour des scénarios pilotés). */
  demand?: boolean;
}

export interface TrafficStats {
  vehicles: number;
  spawned: number;
  arrived: number;
  removedStuck: number;
  meanSpeedKmh: number;
  stopped: number;
  signals: number;
  priorityJunctions: number;
  yieldJunctions: number;
  connectedBuildings: number;
  routeQueries: number;
  laneChanges: number;
}

type Usage = 'prive' | 'taxi' | 'police' | 'livraison' | 'ambulance' | 'fret' | 'bus' | 'pompiers' | 'proprete';
const RESIDENTIAL = new Set(['house', 'townhouse', 'apartment_low', 'apartment_mid', 'apartment_high']);
const WORK = new Set(['commercial', 'industrial', 'public', 'skyscraper', 'apartment_mid']);
const ROUTE_MAX = 512;
const APPROACH = 45; // m : distance de demande d'accès au carrefour

/** Part de la population résidente circulant en voiture selon l'heure (profil journalier). */
export function demandShare(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  const pts: [number, number][] = [[0, 0.004], [5, 0.006], [6.5, 0.03], [8, 0.05], [9.5, 0.025], [12, 0.03], [14, 0.022], [17, 0.05], [19, 0.03], [21, 0.012], [24, 0.004]];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [h0, v0] = pts[i]!, [h1, v1] = pts[i + 1]!;
    if (h >= h0 && h <= h1) return v0 + ((v1 - v0) * (h - h0)) / (h1 - h0);
  }
  return 0.004;
}

export class TrafficSystem {
  graph: TrafficGraph | null = null;
  router: ArcRouter | null = null;
  private grid: EdgeGrid | null = null;
  private catalog: AssetCatalog | null = null;
  private rng: number;
  private readonly maxVehicles: number;
  demandScale: number;
  demandEnabled: boolean;
  private readonly spawnPerStep: number;
  private readonly accessDistance: number;
  private time = 0;
  private dt = 0.1;
  private laneStamp = new Uint32Array(0);
  private tickStamp = 1;

  // ---- véhicules (SoA, par emplacement) ----
  cap = 0;
  alive = new Uint8Array(0);
  asset = new Uint16Array(0);
  variant = new Uint8Array(0);
  link = new Int32Array(0);
  s = new Float32Array(0);
  v = new Float32Array(0);
  acc = new Float32Array(0);
  len = new Float32Array(0);
  vDes = new Float32Array(0);
  aMax = new Float32Array(0);
  bComf = new Float32Array(0);
  T = new Float32Array(0);
  s0 = new Float32Array(0);
  routeOff = new Int32Array(0);
  routeLen = new Int32Array(0);
  routeIdx = new Int32Array(0);
  destS = new Float32Array(0);
  nextLink = new Int32Array(0);
  needLane = new Int8Array(0); // −1 / +1 : direction du changement de voie requis, 0 sinon
  latOff = new Float32Array(0);
  lcCool = new Float32Array(0);
  waitT = new Float32Array(0);
  holdConn = new Int32Array(0);
  granted = new Uint8Array(0);
  /** Diagnostic : raison du dernier refus d'accès au carrefour (0 aucun, 1 feu, 2 priorité, 3 conflit occupé, 4 sortie encombrée). */
  denyReason = new Uint8Array(0);
  wasGranted = new Uint8Array(0);
  flags = new Uint8Array(0);
  // liste active
  act = new Int32Array(0);
  actCount = 0;
  private actPos = new Int32Array(0);
  /** Emplacements libres en FILE (FIFO) : un emplacement libéré n'est réutilisé qu'après tous les autres (identités stables pour l'interpolation du rendu). */
  private free = new Int32Array(0);
  private freeHead = 0;
  private freeTop = 0; // nombre d'emplacements libres
  // arène d'itinéraires
  private arena = new Int32Array(1 << 16);
  private arenaUsed = 0;
  private arenaLive = 0;
  // seaux par lien
  private bucketStart = new Int32Array(0);
  private bucketVeh = new Int32Array(0);
  private bucketPos = new Int32Array(0);
  private linkFill = new Int32Array(0);
  // carrefours
  private connOcc = new Int32Array(0);
  private connRes = new Uint32Array(0);
  private sigTimer = new Float32Array(0);
  private sigPhase = new Uint8Array(0);
  private sigStage = new Uint8Array(0); // 0 vert, 1 orange, 2 rouge intégral
  private nodeIdle = new Float32Array(0);
  private nodeGrantStamp = new Uint32Array(0);
  private reqKey = new Float64Array(0);
  private reqVeh = new Int32Array(0);
  private reqConn = new Int32Array(0);
  private reqEta = new Float32Array(0);
  private reqOk = new Uint8Array(0);
  private reqCan = new Uint8Array(0);
  private reqCount = 0;
  // densité / vitesses par tronçon
  edgeDensity = new Float32Array(0);
  edgeSpeed = new Float32Array(0);
  private edgeCountTmp = new Float32Array(0);
  private edgeSpeedTmp = new Float32Array(0);
  private statTimer = 0;
  // bâtiments
  private buildings: TrafficBuilding[] = [];
  private access: { b: TrafficBuilding; arc: number; sLane: number; edge: number }[] = [];
  private homes: number[] = [];
  private works: number[] = [];
  private shops: number[] = [];
  private depots: Record<'pompiers' | 'ambulance' | 'police' | 'industrie' | 'gare', number[]> = { pompiers: [], ambulance: [], police: [], industrie: [], gare: [] };
  private homeWeight = 0;
  private assetsByUsage = new Map<Usage, number[]>();
  private networkInput: TrafficNetworkInput | null = null;
  private networkDirty = false;
  private buildingsDirty = false;
  private readonly tmp4 = new Float32Array(4);

  readonly stats: TrafficStats = { vehicles: 0, spawned: 0, arrived: 0, removedStuck: 0, meanSpeedKmh: 0, stopped: 0, signals: 0, priorityJunctions: 0, yieldJunctions: 0, connectedBuildings: 0, routeQueries: 0, laneChanges: 0 };

  constructor(opts: TrafficOptions = {}) {
    this.rng = (opts.seed ?? 12345) >>> 0 || 1;
    this.maxVehicles = opts.maxVehicles ?? 3000;
    this.demandScale = opts.demandScale ?? 1;
    this.spawnPerStep = opts.spawnPerStep ?? 8;
    this.accessDistance = opts.accessDistance ?? 40;
    this.demandEnabled = opts.demand ?? true;
    this.growVehicles(256);
  }

  /* ------------------------------------------------------------------ */
  /* Entrées                                                              */
  /* ------------------------------------------------------------------ */

  setCatalog(cat: AssetCatalog): void {
    this.catalog = cat;
    this.assetsByUsage.clear();
    cat.assets.forEach((a, i) => {
      if (a.category !== 'vehicle') return;
      const tag = a.tags.find((t) => t.startsWith('usage:'));
      const u = (tag?.slice(6) ?? (a.vehicle?.kind === 'car' ? 'prive' : a.vehicle?.kind === 'van' ? 'livraison' : a.vehicle?.kind === 'bus' ? 'bus' : a.vehicle?.kind === 'truck' ? 'fret' : 'prive')) as Usage;
      let l = this.assetsByUsage.get(u); if (!l) { l = []; this.assetsByUsage.set(u, l); } l.push(i);
    });
  }

  /** Nouveau réseau (reconstruit au prochain pas ; les véhicules sont reportés sur le nouveau graphe). */
  setNetwork(input: TrafficNetworkInput): void { this.networkInput = input; this.networkDirty = true; }
  setBuildings(b: TrafficBuilding[]): void { this.buildings = b; this.buildingsDirty = true; }

  /* ------------------------------------------------------------------ */
  /* Allocation                                                           */
  /* ------------------------------------------------------------------ */

  private growVehicles(n: number): void {
    const old = this.cap;
    const f32 = (a: Float32Array): Float32Array<ArrayBuffer> => { const b = new Float32Array(n); b.set(a); return b; };
    const i32 = (a: Int32Array): Int32Array<ArrayBuffer> => { const b = new Int32Array(n); b.set(a); return b; };
    const u8 = (a: Uint8Array): Uint8Array<ArrayBuffer> => { const b = new Uint8Array(n); b.set(a); return b; };
    this.alive = u8(this.alive); { const b = new Uint16Array(n); b.set(this.asset); this.asset = b; }
    this.variant = u8(this.variant); this.link = i32(this.link); this.s = f32(this.s); this.v = f32(this.v); this.acc = f32(this.acc);
    this.len = f32(this.len); this.vDes = f32(this.vDes); this.aMax = f32(this.aMax); this.bComf = f32(this.bComf); this.T = f32(this.T); this.s0 = f32(this.s0);
    this.routeOff = i32(this.routeOff); this.routeLen = i32(this.routeLen); this.routeIdx = i32(this.routeIdx); this.destS = f32(this.destS);
    this.nextLink = i32(this.nextLink); { const b = new Int8Array(n); b.set(this.needLane); this.needLane = b; }
    this.latOff = f32(this.latOff); this.lcCool = f32(this.lcCool); this.waitT = f32(this.waitT); this.holdConn = i32(this.holdConn);
    this.granted = u8(this.granted); this.denyReason = u8(this.denyReason); this.wasGranted = u8(this.wasGranted); this.flags = u8(this.flags);
    this.act = i32(this.act); this.actPos = i32(this.actPos);
    const nf = new Int32Array(n);
    for (let k = 0; k < this.freeTop; k++) nf[k] = this.free[(this.freeHead + k) % Math.max(1, old)]!;
    this.free = nf; this.freeHead = 0;
    for (let i = old; i < n; i++) this.free[this.freeTop++] = i;
    this.bucketVeh = new Int32Array(n); this.bucketPos = i32(this.bucketPos);
    this.reqKey = new Float64Array(n); this.reqVeh = new Int32Array(n); this.reqConn = new Int32Array(n); this.reqEta = new Float32Array(n); this.reqOk = new Uint8Array(n); this.reqCan = new Uint8Array(n);
    this.cap = n;
  }

  private rand(): number {
    let t = (this.rng = (this.rng + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  private allocRoute(n: number): number {
    if (this.arenaUsed + n > this.arena.length) {
      // compactage (rare) : recopie des itinéraires vivants
      if (this.arenaLive * 2 < this.arena.length && this.arenaLive + n <= this.arena.length) this.compactArena();
      if (this.arenaUsed + n > this.arena.length) {
        const b = new Int32Array(Math.max(this.arena.length * 2, this.arenaUsed + n)); b.set(this.arena); this.arena = b;
      }
    }
    const off = this.arenaUsed;
    this.arenaUsed += n;
    this.arenaLive += n;
    return off;
  }
  private compactArena(): void {
    const b = new Int32Array(this.arena.length);
    let k = 0;
    for (let i = 0; i < this.actCount; i++) {
      const v = this.act[i]!;
      const n = this.routeLen[v]!;
      b.set(this.arena.subarray(this.routeOff[v]!, this.routeOff[v]! + n), k);
      this.routeOff[v] = k; k += n;
    }
    this.arena = b; this.arenaUsed = k; this.arenaLive = k;
  }

  /* ------------------------------------------------------------------ */
  /* Réseau et bâtiments                                                  */
  /* ------------------------------------------------------------------ */

  private rebuildNetwork(): void {
    const input = this.networkInput!;
    // mémorise la position des véhicules en coordonnées de tronçon (ids stables du monde)
    const old = this.graph;
    const keep: { v: number; edgeId: number; dir: number; rank: number; sAxis: number; destEdgeId: number; destDir: number; destAxis: number }[] = [];
    if (old) {
      for (let i = 0; i < this.actCount; i++) {
        const v = this.act[i]!;
        let l = this.link[v]!, s = this.s[v]!;
        if (old.linkKind[l] === 1) { l = old.connTo[l - old.laneCount]!; s = 0; }
        const arc = old.linkArc[l]!;
        const dArc = this.arena[this.routeOff[v]! + this.routeLen[v]! - 1]!;
        const destLane = old.arcFirstLane[dArc]!;
        keep.push({ v, edgeId: old.edgeId[arc >> 1]!, dir: arc & 1, rank: old.linkRank[l]!, sAxis: old.linkS0[l]! + s, destEdgeId: old.edgeId[dArc >> 1]!, destDir: dArc & 1, destAxis: old.linkS0[destLane]! + this.destS[v]! });
      }
    }
    this.graph = new TrafficGraph(input);
    this.router = new ArcRouter(this.graph);
    this.grid = new EdgeGrid(this.graph);
    const g = this.graph;
    this.connOcc = new Int32Array(g.linkCount - g.laneCount);
    this.connRes = new Uint32Array(g.linkCount - g.laneCount);
    this.bucketStart = new Int32Array(g.linkCount + 1);
    this.linkFill = new Int32Array(g.linkCount);
    this.laneStamp = new Uint32Array(g.linkCount);
    this.sigTimer = new Float32Array(g.nodeCount);
    this.sigPhase = new Uint8Array(g.nodeCount);
    this.sigStage = new Uint8Array(g.nodeCount);
    this.nodeIdle = new Float32Array(g.nodeCount);
    this.nodeGrantStamp = new Uint32Array(g.nodeCount);
    this.edgeDensity = new Float32Array(g.edgeCount);
    this.edgeSpeed = new Float32Array(g.edgeCount);
    this.edgeCountTmp = new Float32Array(g.edgeCount);
    this.edgeSpeedTmp = new Float32Array(g.edgeCount);
    let sig = 0, pr = 0, yi = 0;
    for (let n = 0; n < g.nodeCount; n++) {
      const c = g.nodeControl[n]!;
      if (c === Control.Signal) { sig++; this.sigTimer[n] = (n * 7.3) % g.nodeGreen[n * 4]!; }
      else if (c === Control.Priority) pr++;
      else if (c === Control.Yield) yi++;
    }
    this.stats.signals = sig; this.stats.priorityJunctions = pr; this.stats.yieldJunctions = yi;
    // report des véhicules
    for (const k of keep) {
      const e = g.edgeIndex(k.edgeId), de = g.edgeIndex(k.destEdgeId);
      const arc = e * 2 + k.dir, dArc = de * 2 + k.destDir;
      if (e < 0 || de < 0 || g.arcFirstLane[arc]! < 0 || g.arcFirstLane[dArc]! < 0) { this.despawn(k.v); continue; }
      const lane = g.arcFirstLane[arc]! + Math.min(k.rank, g.arcLaneCount[arc]! - 1);
      this.holdConn[k.v] = -1;
      this.link[k.v] = lane;
      this.s[k.v] = Math.max(0, Math.min(g.linkLen[lane]!, k.sAxis - g.linkS0[lane]!));
      this.destS[k.v] = Math.max(0, k.destAxis - g.linkS0[g.arcFirstLane[dArc]!]!);
      const off = this.allocRoute(ROUTE_MAX);
      const n = this.router.route(arc, dArc, this.arena, off, ROUTE_MAX);
      this.arenaLive -= this.routeLen[k.v]!;
      if (n < 1) { this.routeLen[k.v] = 0; this.despawn(k.v); continue; }
      this.routeOff[k.v] = off; this.routeLen[k.v] = n; this.routeIdx[k.v] = 0;
      this.arenaUsed = off + n; this.arenaLive -= ROUTE_MAX - n;
      this.chooseNext(k.v);
    }
    this.networkDirty = false;
    this.buildingsDirty = true;
  }

  private rebuildAccess(): void {
    const g = this.graph;
    this.access = [];
    this.homes = []; this.works = []; this.shops = [];
    this.depots = { pompiers: [], ambulance: [], police: [], industrie: [], gare: [] };
    this.homeWeight = 0;
    if (!g) { this.buildingsDirty = false; return; }
    for (const b of this.buildings) {
      const hit = g.nearestEdge(b.x, b.z, this.accessDistance, this.grid ?? undefined);
      if (!hit) continue;
      let arc = hit.edge * 2 + (hit.side > 0 ? 0 : 1);
      if (g.arcFirstLane[arc]! < 0) arc ^= 1;
      if (g.arcFirstLane[arc]! < 0) continue;
      const lane = g.arcFirstLane[arc]! + g.arcLaneCount[arc]! - 1;
      const sAxis = (arc & 1) === 0 ? hit.s : g.edgeLen[hit.edge]! - hit.s;
      const sLane = Math.max(1, Math.min(g.linkLen[lane]! - 1, sAxis - g.linkS0[lane]!));
      const k = this.access.length;
      this.access.push({ b, arc, sLane, edge: hit.edge });
      if (RESIDENTIAL.has(b.category) && b.residents > 0) { this.homes.push(k); this.homeWeight += b.residents; }
      if (WORK.has(b.category) && b.jobs > 0) this.works.push(k);
      if (b.category === 'commercial') this.shops.push(k);
      const id = b.assetId;
      if (id.includes('pompier') || id.includes('caserne')) this.depots.pompiers.push(k);
      if (id.includes('hopital')) this.depots.ambulance.push(k);
      if (id.includes('commissariat') || id.includes('police')) this.depots.police.push(k);
      if (b.category === 'industrial') this.depots.industrie.push(k);
      if (id.includes('gare')) this.depots.gare.push(k);
    }
    this.stats.connectedBuildings = this.access.length;
    this.buildingsDirty = false;
  }

  /* ------------------------------------------------------------------ */
  /* Apparition / disparition                                             */
  /* ------------------------------------------------------------------ */

  private pick(list: number[]): number { return list.length ? list[Math.floor(this.rand() * list.length)]! : -1; }

  private pickHome(): number {
    if (!this.homes.length) return -1;
    // tirage pondéré par le nombre d'habitants (rejet simple)
    let maxR = 1;
    for (let t = 0; t < 4; t++) maxR = Math.max(maxR, this.access[this.homes[Math.floor(this.rand() * this.homes.length)]!]!.b.residents);
    for (let t = 0; t < 8; t++) {
      const k = this.homes[Math.floor(this.rand() * this.homes.length)]!;
      if (this.rand() * maxR <= this.access[k]!.b.residents) return k;
    }
    return this.homes[Math.floor(this.rand() * this.homes.length)]!;
  }

  private pickAsset(u: Usage): number {
    const l = this.assetsByUsage.get(u);
    return l && l.length ? l[Math.floor(this.rand() * l.length)]! : -1;
  }

  /** Tente de créer un trajet entre deux bâtiments reliés (index d'accès) ; renvoie l'emplacement ou −1. */
  spawnTrip(fromK: number, toK: number, usage: Usage): number {
    const g = this.graph;
    if (!g || fromK < 0 || toK < 0 || fromK === toK) return -1;
    let ai = this.pickAsset(usage);
    if (ai < 0) ai = this.pickAsset('prive');
    if (ai < 0) return -1;
    const A = this.access[fromK]!, B = this.access[toK]!;
    if (A.arc === B.arc && B.sLane <= A.sLane + 5) return -1;
    const v = this.spawnVehicle(A.arc, g.arcLaneCount[A.arc]! - 1, A.sLane, B.arc, B.sLane, ai, 2.5);
    if (v >= 0 && (usage === 'pompiers' || usage === 'ambulance' || usage === 'police')) this.flags[v] = 8;
    return v;
  }

  /** Index d'accès d'un bâtiment relié (−1 si non relié à la route). */
  accessIndexOf(buildingId: number): number { return this.access.findIndex((a) => a.b.id === buildingId); }

  /**
   * Crée un véhicule sur l'arc `arc` (voie de rang `rank`, abscisse sLane depuis le début de la voie)
   * à destination de l'arc `destArc` (abscisse destS) ; itinéraire A*. Renvoie l'emplacement ou −1.
   */
  spawnVehicle(arc: number, rank: number, sLane: number, destArc: number, destS: number, assetIndex: number, lateral = 0, v0 = 2): number {
    const g = this.graph, router = this.router, cat = this.catalog;
    if (!g || !router || !cat || arc < 0 || destArc < 0 || g.arcFirstLane[arc]! < 0 || g.arcFirstLane[destArc]! < 0) return -1;
    const asset = cat.assets[assetIndex];
    if (!asset) return -1;
    const lane = g.arcFirstLane[arc]! + Math.max(0, Math.min(rank, g.arcLaneCount[arc]! - 1));
    const len = asset.vehicle?.lengthM ?? asset.dimensions.depth;
    if (!this.laneHasRoom(lane, sLane, len)) return -1;
    if (this.actCount >= this.cap || this.freeTop === 0) this.growVehicles(this.cap * 2);
    const off = this.allocRoute(ROUTE_MAX);
    const n = router.route(arc, destArc, this.arena, off, ROUTE_MAX);
    if (n < 1) { this.arenaUsed = off; this.arenaLive -= ROUTE_MAX; return -1; }
    this.arenaUsed = off + n; this.arenaLive -= ROUTE_MAX - n;
    const v = this.free[this.freeHead]!;
    this.freeHead = (this.freeHead + 1) % this.cap;
    this.freeTop--;
    this.alive[v] = 1;
    this.asset[v] = assetIndex;
    this.variant[v] = Math.floor(this.rand() * Math.max(1, asset.variants.length));
    this.link[v] = lane;
    this.s[v] = Math.max(0, Math.min(g.linkLen[lane]!, sLane));
    this.v[v] = v0;
    this.acc[v] = 0;
    this.len[v] = len;
    const kind = asset.vehicle?.kind ?? 'car';
    const p = IDM_BY_KIND[kind];
    const driver = 0.9 + this.rand() * 0.22;
    this.vDes[v] = ((asset.vehicle?.maxSpeedKmh ?? 130) / 3.6) * driver;
    this.aMax[v] = p.aMax * driver; this.bComf[v] = p.bComf; this.T[v] = p.T / driver; this.s0[v] = p.s0;
    this.routeOff[v] = off; this.routeLen[v] = n; this.routeIdx[v] = 0;
    this.destS[v] = destS;
    this.latOff[v] = lateral; // sortie du bas-côté (amortie)
    this.lcCool[v] = 2;
    this.waitT[v] = 0;
    this.holdConn[v] = -1;
    this.granted[v] = 0; this.wasGranted[v] = 0;
    this.flags[v] = 0;
    this.actPos[v] = this.actCount;
    this.act[this.actCount++] = v;
    this.chooseNext(v);
    this.stats.spawned++;
    return v;
  }

  private laneHasRoom(lane: number, s: number, len: number): boolean {
    // parcours simple des véhicules actifs de la voie (appelé au plus spawnPerStep fois par pas)
    for (let i = 0; i < this.actCount; i++) {
      const u = this.act[i]!;
      if (this.link[u] !== lane) continue;
      const d = this.s[u]! - s;
      if (d > -(len + 10) && d < len + 6) return false;
    }
    return true;
  }

  despawn(v: number): void {
    if (!this.alive[v]) return;
    const g = this.graph;
    if (g && this.holdConn[v]! >= 0) this.connOcc[this.holdConn[v]! - g.laneCount]!--;
    this.holdConn[v] = -1;
    this.alive[v] = 0;
    this.arenaLive -= this.routeLen[v]!;
    this.routeLen[v] = 0;
    const p = this.actPos[v]!;
    const last = this.act[--this.actCount]!;
    this.act[p] = last; this.actPos[last] = p;
    this.free[(this.freeHead + this.freeTop) % this.cap] = v;
    this.freeTop++;
  }

  /** Choisit le lien suivant (connecteur vers l'arc suivant de l'itinéraire) depuis la voie courante. */
  private chooseNext(v: number): void {
    const g = this.graph!;
    const l = this.link[v]!;
    this.needLane[v] = 0;
    if (g.linkKind[l] === 1) { this.nextLink[v] = g.connTo[l - g.laneCount]!; return; }
    const ri = this.routeIdx[v]!;
    if (ri + 1 >= this.routeLen[v]!) { this.nextLink[v] = -1; return; }
    const nextArc = this.arena[this.routeOff[v]! + ri + 1]!;
    let best = -1;
    for (let k = g.laneConnStart[l]!; k < g.laneConnStart[l + 1]!; k++) {
      const c = g.laneConns[k]!;
      if (g.linkArc[c] === nextArc) { best = c; break; }
    }
    this.nextLink[v] = best;
    if (best >= 0) return;
    // aucune manœuvre depuis cette voie : changement de voie nécessaire (vers la voie qui la permet)
    const arc = g.linkArc[l]!;
    const first = g.arcFirstLane[arc]!, n = g.arcLaneCount[arc]!;
    const r = g.linkRank[l]!;
    let target = -1;
    for (let k = 0; k < n; k++) {
      const lane = first + k;
      for (let q = g.laneConnStart[lane]!; q < g.laneConnStart[lane + 1]!; q++) if (g.linkArc[g.laneConns[q]!] === nextArc) { if (target < 0 || Math.abs(k - r) < Math.abs(target - r)) target = k; }
    }
    this.needLane[v] = target < 0 ? 0 : target > r ? 1 : -1;
  }

  /* ------------------------------------------------------------------ */
  /* Pas de simulation                                                    */
  /* ------------------------------------------------------------------ */

  /** Avance la simulation de `dt` secondes (temps physique) ; `hour` = heure du jeu (demande). */
  step(dt: number, hour: number): void {
    if (this.networkDirty && this.networkInput) this.rebuildNetwork();
    if (this.buildingsDirty) this.rebuildAccess();
    const g = this.graph;
    if (!g) return;
    this.time += dt;
    this.dt = dt;
    this.tickStamp++;
    this.updateSignals(dt);
    this.buildBuckets();
    this.junctionRequests();
    this.laneChanges(dt);
    this.buildBuckets();
    this.move(dt);
    if (this.demandEnabled) this.spawn(hour);
    this.statTimer += dt;
    if (this.statTimer >= 1) { this.updateStats(this.statTimer); this.statTimer = 0; }
    this.stats.vehicles = this.actCount;
    this.stats.routeQueries = this.router!.queries;
  }

  private updateSignals(dt: number): void {
    const g = this.graph!;
    for (let n = 0; n < g.nodeCount; n++) {
      if (g.nodeControl[n] !== Control.Signal) continue;
      this.sigTimer[n]! += dt;
      const st = this.sigStage[n]!;
      const dur = st === 0 ? g.nodeGreen[n * 4 + this.sigPhase[n]!]! : st === 1 ? 3 : 2;
      if (this.sigTimer[n]! >= dur) {
        this.sigTimer[n] = 0;
        if (st === 0) this.sigStage[n] = 1;
        else if (st === 1) this.sigStage[n] = 2;
        else { this.sigStage[n] = 0; this.sigPhase[n] = (this.sigPhase[n]! + 1) % Math.max(1, g.nodePhases[n]!); }
      }
    }
  }

  /** État d'un bras de feu : 0 vert, 1 orange, 2 rouge. */
  signalState(node: number, arm: number): number {
    const g = this.graph!;
    if (g.nodeControl[node] !== Control.Signal) return 0;
    if (this.sigStage[node] === 2 || g.armPhase[arm] !== this.sigPhase[node]) return 2;
    return this.sigStage[node]!;
  }

  private buildBuckets(): void {
    const g = this.graph!;
    const B = this.bucketStart, F = this.linkFill;
    B.fill(0);
    for (let i = 0; i < this.actCount; i++) B[this.link[this.act[i]!]! + 1]!++;
    for (let l = 0; l < g.linkCount; l++) B[l + 1]! += B[l]!;
    F.fill(0);
    for (let i = 0; i < this.actCount; i++) {
      const v = this.act[i]!;
      const l = this.link[v]!;
      this.bucketVeh[B[l]! + F[l]!++] = v;
    }
    // tri par abscisse décroissante (le meneur en tête) : insertion, quasi trié d'un pas à l'autre
    for (let l = 0; l < g.linkCount; l++) {
      const a = B[l]!, b = B[l + 1]!;
      for (let i = a + 1; i < b; i++) {
        const v = this.bucketVeh[i]!;
        const sv = this.s[v]!;
        let j = i - 1;
        while (j >= a && this.s[this.bucketVeh[j]!]! < sv) { this.bucketVeh[j + 1] = this.bucketVeh[j]!; j--; }
        this.bucketVeh[j + 1] = v;
      }
      for (let i = a; i < b; i++) this.bucketPos[this.bucketVeh[i]!] = i;
    }
  }

  /** Dernier véhicule (le plus en arrière) d'un lien, ou −1. */
  private tailOf(l: number): number {
    const b = this.bucketStart[l + 1]!;
    return b > this.bucketStart[l]! ? this.bucketVeh[b - 1]! : -1;
  }

  /* ----------------------------- carrefours ----------------------------- */

  private junctionRequests(): void {
    const g = this.graph!;
    const nl = g.laneCount;
    this.reqCount = 0;
    for (let i = 0; i < this.actCount; i++) {
      const v = this.act[i]!;
      this.wasGranted[v] = this.granted[v]!;
      this.granted[v] = 0;
      const l = this.link[v]!;
      if (g.linkKind[l] !== 0) { this.granted[v] = 1; continue; }
      const c = this.nextLink[v]!;
      if (c < 0) { this.granted[v] = 1; continue; }
      const node = g.linkToNode[l]!;
      const ctl = g.nodeControl[node]!;
      if (ctl === Control.None || ctl === Control.DeadEnd) { this.granted[v] = 1; continue; }
      const dist = g.linkLen[l]! - this.s[v]! - this.len[v]! / 2;
      if (dist > APPROACH) { this.granted[v] = 0; continue; }
      // tous les véhicules proches demandent l'accès (peloton : un suiveur est autorisé avec son meneur,
      // ce qui évite un arrêt à la ligne pour chaque véhicule) ; l'ordre de passage reste celui de la file (IDM)
      const k = this.reqCount++;
      const eta = Math.max(0, dist) / Math.max(1.5, this.v[v]!);
      const committed = this.wasGranted[v] === 1 && dist < (this.v[v]! * this.v[v]!) / (2 * this.bComf[v]!) + 1.5;
      const arm = g.connArm[c - nl]!;
      const turn = g.connTurn[c - nl]!;
      // attente prolongée : le conducteur finit par s'engager (anti-famine), traité avant les autres
      const forcing = this.waitT[v]! > 15;
      const cls = committed || forcing ? 0 : 1 + (g.armRankPrio[arm] ? 0 : 2) + (turn === Turn.Left ? 1 : 0);
      const etaQ = Math.min(8191, Math.round(eta * 100));
      this.reqKey[k] = ((node * 8 + cls) * 8192 + etaQ) * 65536 + k;
      this.reqVeh[k] = v; this.reqConn[k] = c; this.reqEta[k] = eta; this.reqOk[k] = committed ? 1 : forcing ? 2 : 0;
    }
    const keys = this.reqKey.subarray(0, this.reqCount);
    keys.sort();
    const stamp = this.tickStamp;
    let i = 0;
    while (i < this.reqCount) {
      const node = Math.floor(keys[i]! / (8 * 8192 * 65536));
      let j = i;
      while (j < this.reqCount && Math.floor(keys[j]! / (8 * 8192 * 65536)) === node) j++;
      this.resolveNode(node, i, j, stamp);
      i = j;
    }
  }

  private conflictsBusy(c: number, stamp: number): boolean {
    const g = this.graph!;
    const ci = c - g.laneCount;
    for (let k = g.conflictStart[ci]!; k < g.conflictStart[ci + 1]!; k++) {
      const o = g.conflicts[k]!;
      if (this.connOcc[o]! > 0 || this.connRes[o] === stamp) return true;
    }
    return false;
  }

  private conflicting(a: number, b: number): boolean {
    const g = this.graph!;
    const ai = a - g.laneCount, bi = b - g.laneCount;
    if (ai === bi) return false;
    for (let k = g.conflictStart[ai]!; k < g.conflictStart[ai + 1]!; k++) if (g.conflicts[k] === bi) return true;
    return false;
  }

  private resolveNode(node: number, i0: number, i1: number, stamp: number): void {
    const g = this.graph!;
    const nl = g.laneCount;
    const ctl = g.nodeControl[node]!;
    const idx = (k: number): number => this.reqKey[k]! % 65536; // index de requête dans les tableaux
    let any = false;
    // passe 1 : requêtes physiquement possibles (sortie libre, feu vert ou engagé) ; les autres
    // n'imposent pas de priorité (un véhicule arrêté par un bouchon devant lui ne bloque pas le carrefour)
    for (let k = i0; k < i1; k++) {
      const r = idx(k);
      const v = this.reqVeh[r]!, c = this.reqConn[r]!, ci = c - nl;
      // feu : vert ; à l'orange, seul le véhicule déjà arrêté à la ligne qui tourne à gauche dégage le carrefour
      const sig = ctl === Control.Signal ? this.signalState(node, g.connArm[ci]!) : 0;
      let can = this.reqOk[r] === 1 || sig === 0 || (sig === 1 && this.reqEta[r]! < 1 && g.connTurn[ci] === Turn.Left);
      if (can && this.reqOk[r] !== 1) {
        const t = this.tailOf(g.connTo[ci]!);
        if (t >= 0 && this.s[t]! - this.len[t]! / 2 < this.len[v]! + 1.5 && this.v[t]! < 2) can = false;
        const inConn = this.tailOf(c);
        if (can && inConn >= 0 && this.v[inConn]! < 0.5) can = false;
      }
      this.reqCan[r] = can ? 1 : 0;
      this.denyReason[v] = can ? 0 : ctl === Control.Signal && this.reqOk[r] !== 1 && this.signalState(node, g.connArm[ci]!) !== 0 ? 1 : 4;
    }
    for (let k = i0; k < i1; k++) {
      const r = idx(k);
      const v = this.reqVeh[r]!, c = this.reqConn[r]!, ci = c - nl;
      const arm = g.connArm[ci]!;
      const turn = g.connTurn[ci]!;
      const committed = this.reqOk[r] === 1;
      const forcing = this.reqOk[r] === 2;
      let ok = this.reqCan[r] === 1;
      const clearing = ctl === Control.Signal && this.signalState(node, arm) === 1;
      if (ok && !committed && !forcing && !clearing) {
        // priorités : céder aux requêtes en conflit plus prioritaires et proches
        for (let q = i0; q < i1 && ok; q++) {
          const rq = idx(q);
          if (rq === r) continue;
          const cq = this.reqConn[rq]!;
          if (!this.conflicting(c, cq)) continue;
          const armQ = g.connArm[cq - nl]!;
          if (armQ === arm) continue;
          const etaQ = this.reqEta[rq]!;
          if (etaQ > 5.5 || this.reqCan[rq] === 0) continue;
          const turnQ = g.connTurn[cq - nl]!;
          if (ctl === Control.Priority) {
            // priorité à droite : le véhicule venant de la droite passe d'abord
            const a = g.armAngle[arm]!, b = g.armAngle[armQ]!;
            const cross = Math.sin(a) * Math.cos(b) - Math.cos(a) * Math.sin(b); // dirA × dirB (XZ)
            if (cross < -0.5) { ok = false; this.denyReason[v] = 2; }
          } else if (ctl === Control.Yield) {
            if (g.armRankPrio[armQ]! > g.armRankPrio[arm]!) { ok = false; this.denyReason[v] = 2; }
            else if (g.armRankPrio[armQ] === g.armRankPrio[arm] && turn === Turn.Left && turnQ !== Turn.Left) { ok = false; this.denyReason[v] = 2; }
          } else if (ctl === Control.Signal) {
            if (turn === Turn.Left && turnQ !== Turn.Left) { ok = false; this.denyReason[v] = 2; } // tourne-à-gauche permissif
          }
        }
      }
      // trajectoires en conflit occupées ou réservées : on attend (même engagé : sécurité)
      if (ok && this.conflictsBusy(c, stamp)) { ok = false; this.denyReason[v] = 3; }
      if (ok) {
        this.connRes[ci] = stamp;
        this.granted[v] = 1;
        any = true;
      }
    }
    // déblocage : personne ne passe depuis longtemps alors que des véhicules attendent
    if (!any) {
      let busy = false;
      for (let k = i0; k < i1 && !busy; k++) if (this.connOcc[this.reqConn[idx(k)]! - nl]! > 0) busy = true;
      if (!busy && ctl !== Control.Signal) {
        this.nodeIdle[node]! += this.dt;
        if (this.nodeIdle[node]! > 3) {
          let bestK = -1, bestW = -1;
          for (let k = i0; k < i1; k++) {
            const r = idx(k);
            const v = this.reqVeh[r]!;
            if (this.reqEta[r]! < 3 && this.waitT[v]! > bestW && !this.conflictsBusy(this.reqConn[r]!, stamp)) { bestW = this.waitT[v]!; bestK = r; }
          }
          if (bestK >= 0) { this.granted[this.reqVeh[bestK]!] = 1; this.connRes[this.reqConn[bestK]! - nl] = stamp; this.nodeIdle[node] = 0; }
        }
      }
    } else this.nodeIdle[node] = 0;
  }

  /* ----------------------------- changements de voie ----------------------------- */

  /** Meneur et suiveur sur la voie `lane` autour de l'abscisse s (seaux triés). */
  private neighbours(lane: number, s: number, out: Int32Array): void {
    const a = this.bucketStart[lane]!, b = this.bucketStart[lane + 1]!;
    let lead = -1, follow = -1;
    for (let i = a; i < b; i++) {
      const u = this.bucketVeh[i]!;
      if (this.s[u]! >= s) lead = u; else { follow = u; break; }
    }
    out[0] = lead; out[1] = follow;
  }
  private readonly nb = new Int32Array(2);

  private laneChanges(dt: number): void {
    const g = this.graph!;
    for (let i = 0; i < this.actCount; i++) {
      const v = this.act[i]!;
      if (this.lcCool[v]! > 0) { this.lcCool[v]! -= dt; continue; }
      const l = this.link[v]!;
      if (g.linkKind[l] !== 0) continue;
      const arc = g.linkArc[l]!;
      const n = g.arcLaneCount[arc]!;
      if (n < 2) continue;
      const r = g.linkRank[l]!;
      const s = this.s[v]!;
      const remain = g.linkLen[l]! - s;
      let dirWanted = this.needLane[v]!;
      let mandatory = dirWanted !== 0;
      if (!mandatory) {
        // confort : meneur lent et proche
        const pos = this.bucketPos[v]!;
        const lead = pos > this.bucketStart[l]! ? this.bucketVeh[pos - 1]! : -1;
        if (lead < 0 || remain < 40 || this.v[lead]! > this.vDes[v]! * 0.75 || this.s[lead]! - s > 45) continue;
        dirWanted = r + 1 < n ? 1 : -1;
        mandatory = false;
      }
      const tr = r + dirWanted;
      if (tr < 0 || tr >= n) continue;
      const target = g.arcFirstLane[arc]! + tr;
      if (this.laneStamp[target] === this.tickStamp) continue; // un seul changement vers une voie par pas
      if (!mandatory) {
        // incitation (MOBIL) : la voie cible doit offrir nettement plus d'espace devant
        this.neighbours(target, s, this.nb);
        const pos = this.bucketPos[v]!;
        const curLead = pos > this.bucketStart[l]! ? this.bucketVeh[pos - 1]! : -1;
        const curGap = curLead >= 0 ? this.s[curLead]! - s : 1e4;
        const newGap = this.nb[0]! >= 0 ? this.s[this.nb[0]!]! - s : 1e4;
        if (newGap < curGap + 12) continue;
        // la voie cible doit permettre la suite de l'itinéraire
        const ri = this.routeIdx[v]!;
        if (ri + 1 < this.routeLen[v]!) {
          const nextArc = this.arena[this.routeOff[v]! + ri + 1]!;
          let okNext = false;
          for (let q = g.laneConnStart[target]!; q < g.laneConnStart[target + 1]!; q++) if (g.linkArc[g.laneConns[q]!] === nextArc) okNext = true;
          if (!okNext) continue;
        }
      }
      this.neighbours(target, s, this.nb);
      const lead = this.nb[0]!, fol = this.nb[1]!;
      const halfV = this.len[v]! / 2;
      // sécurité (MOBIL) : écarts suffisants et décélération imposée au suiveur acceptable
      let safe = true;
      if (lead >= 0) {
        const gap = this.s[lead]! - this.len[lead]! / 2 - (s + halfV);
        if (gap < this.s0[v]! + 0.5) safe = false;
        else if (!mandatory && gap < this.v[v]! * this.T[v]! * 0.8) safe = false;
      }
      if (safe && fol >= 0) {
        const gap = s - halfV - (this.s[fol]! + this.len[fol]! / 2);
        if (gap < this.s0[fol]! + 0.5) safe = false;
        else {
          const aF = idmAccel(this.v[fol]!, this.vDes[fol]!, gap, this.v[fol]! - this.v[v]!, this.aMax[fol]!, this.bComf[fol]!, this.T[fol]!, this.s0[fol]!);
          if (aF < (mandatory ? -3.5 : -1.5)) safe = false;
        }
      }
      if (!safe) continue;
      this.link[v] = target;
      this.laneStamp[target] = this.tickStamp;
      this.laneStamp[l] = this.tickStamp;
      // décalage latéral résiduel animé (rendu) : la voie cible est à droite si dirWanted > 0
      this.latOff[v] = -dirWanted * g.edgeLaneWidth[arc >> 1]!;
      this.lcCool[v] = mandatory ? 1.5 : 4;
      this.stats.laneChanges++;
      this.chooseNext(v);
    }
  }

  /* ----------------------------- déplacement ----------------------------- */

  private move(dt: number): void {
    const g = this.graph!;
    const nl = g.laneCount;
    for (let i = 0; i < this.actCount; i++) {
      const v = this.act[i]!;
      const l = this.link[v]!;
      const s = this.s[v]!;
      const half = this.len[v]! / 2;
      const L = g.linkLen[l]!;
      let gap = FREE_GAP, vl = 0;
      // meneur sur le même lien
      const pos = this.bucketPos[v]!;
      // (les seaux datent du début du pas : un meneur a pu changer de lien entre-temps)
      const u0 = pos > this.bucketStart[l]! ? this.bucketVeh[pos - 1]! : -1;
      if (u0 >= 0 && this.alive[u0] && this.link[u0] === l) {
        gap = this.s[u0]! - this.len[u0]! / 2 - (s + half);
        vl = this.v[u0]!;
      } else if (u0 >= 0 && this.alive[u0] && this.link[u0] === this.nextLink[v]) {
        gap = L - s - half + this.s[u0]! - this.len[u0]! / 2;
        vl = this.v[u0]!;
      } else {
        // au-delà : lien suivant puis le suivant
        let ahead = L - s - half;
        let nx = this.nextLink[v]!;
        let found = false;
        for (let k = 0; k < 2 && nx >= 0 && ahead < 120; k++) {
          const nnx = g.linkKind[nx] === 1 ? g.connTo[nx - nl]! : -1;
          const u = this.tailOf(nx);
          if (u >= 0 && this.alive[u]) {
            // seaux du début du pas : le dernier véhicule du lien a pu passer au lien suivant
            if (this.link[u] === nx) { gap = ahead + this.s[u]! - this.len[u]! / 2; vl = this.v[u]!; found = true; break; }
            if (this.link[u] === nnx) { gap = ahead + g.linkLen[nx]! + this.s[u]! - this.len[u]! / 2; vl = this.v[u]!; found = true; break; }
          }
          ahead += g.linkLen[nx]!;
          nx = nnx;
        }
        void found;
      }
      // ligne d'arrêt au carrefour si l'accès n'est pas accordé
      if (g.linkKind[l] === 0 && this.nextLink[v]! >= 0 && !this.granted[v]) {
        const stopGap = L - s - half - 0.5;
        if (stopGap < gap) { gap = stopGap; vl = 0; }
      }
      // voie sans issue pour l'itinéraire (changement de voie raté) : s'arrêter en fin de voie
      if (g.linkKind[l] === 0 && this.nextLink[v]! < 0 && this.routeIdx[v]! + 1 < this.routeLen[v]!) {
        const stopGap = L - s - half - 0.5;
        if (stopGap < gap) { gap = stopGap; vl = 0; }
      }
      let v0 = Math.min(this.vDes[v]!, g.linkSpeed[l]! * 1.05);
      // ralentir avant un virage
      const nx = this.nextLink[v]!;
      if (nx >= 0 && g.linkKind[nx] === 1) {
        const dTurn = Math.max(0, L - s);
        const vt = g.linkSpeed[nx]!;
        const vAllowed = Math.sqrt(vt * vt + 2 * 1.5 * dTurn);
        if (vAllowed < v0) v0 = vAllowed;
      }
      const vv = this.v[v]!;
      let a = idmAccel(vv, v0, gap, vv - vl, this.aMax[v]!, this.bComf[v]!, this.T[v]!, this.s0[v]!);
      let nv = vv + a * dt;
      if (nv < 0) { nv = 0; a = -vv / dt; }
      let ds = (vv + nv) * 0.5 * dt;
      // garde-fou anti-chevauchement
      if (gap < FREE_GAP && ds > gap - 0.2) { ds = Math.max(0, gap - 0.2); nv = Math.min(nv, ds / dt); }
      this.v[v] = nv;
      this.acc[v] = a;
      this.flags[v] = (this.flags[v]! & ~1) | (a < -1 ? 1 : 0);
      // temps d'attente : cumulé tant que le véhicule ne roule pas franchement (le « grignotage » à la ligne ne compte pas)
      this.waitT[v] = nv < 1.5 ? this.waitT[v]! + dt : nv > 3 ? 0 : this.waitT[v]!;
      // décalage latéral (changement de voie, sortie de bas-côté) amorti
      this.latOff[v] = this.latOff[v]! * Math.exp(-dt * 1.6);
      let ns = s + ds;
      let cur = l;
      // arrivée
      if (g.linkKind[cur] === 0 && this.routeIdx[v]! + 1 >= this.routeLen[v]! && ns >= this.destS[v]!) {
        this.stats.arrived++;
        this.despawn(v); i--; continue;
      }
      // transitions de lien
      let guard = 0;
      while (ns > g.linkLen[cur]! && guard++ < 4) {
        const next = this.nextLink[v]!;
        if (next < 0) { ns = g.linkLen[cur]!; this.v[v] = 0; break; }
        if (g.linkKind[cur] === 0 && !this.granted[v]) { ns = g.linkLen[cur]!; this.v[v] = 0; break; }
        ns -= g.linkLen[cur]!;
        if (g.linkKind[next] === 1) {
          // entrée dans le carrefour : occupation du connecteur jusqu'à dégagement de l'arrière
          if (this.holdConn[v]! >= 0) this.connOcc[this.holdConn[v]! - nl]!--;
          this.holdConn[v] = next;
          this.connOcc[next - nl]!++;
        } else {
          this.routeIdx[v]!++;
        }
        cur = next;
        this.link[v] = cur;
        this.chooseNext(v);
      }
      this.s[v] = ns;
      // libère le connecteur quand l'arrière du véhicule a quitté le carrefour
      if (this.holdConn[v]! >= 0 && g.linkKind[cur] === 0 && ns - half > 0.5) {
        this.connOcc[this.holdConn[v]! - nl]!--;
        this.holdConn[v] = -1;
      }
      // véhicule bloqué très longtemps (interblocage) : retiré (compté)
      if (this.waitT[v]! > 150) { this.stats.removedStuck++; this.despawn(v); i--; }
    }
  }

  /* ----------------------------- demande ----------------------------- */

  private spawn(hour: number): void {
    if (!this.homes.length) return;
    const target = Math.min(this.maxVehicles, Math.round(this.homeWeight * demandShare(hour) * this.demandScale));
    let budget = this.spawnPerStep;
    let tries = budget * 3;
    while (this.actCount < target && budget > 0 && tries-- > 0) {
      const h = ((hour % 24) + 24) % 24;
      const morning = h >= 5 && h < 11, evening = h >= 15 && h < 21;
      const r = this.rand();
      let from = -1, to = -1;
      let usage: Usage = this.rand() < 0.05 ? 'taxi' : 'prive';
      if (r < 0.025 && this.depots.pompiers.length) { from = this.pick(this.depots.pompiers); to = this.pick(this.homes); usage = 'pompiers'; }
      else if (r < 0.05 && this.depots.ambulance.length) { const home = this.pick(this.homes); const hosp = this.pick(this.depots.ambulance); [from, to] = this.rand() < 0.5 ? [hosp, home] : [home, hosp]; usage = 'ambulance'; }
      else if (r < 0.08 && this.depots.police.length) { from = this.pick(this.depots.police); to = this.pick(this.rand() < 0.5 ? this.homes : this.works); usage = 'police'; }
      else if (r < 0.1 && this.depots.industrie.length) { from = this.pick(this.depots.industrie); to = this.pick(this.homes); usage = 'proprete'; }
      else if (r < 0.17 && this.depots.industrie.length && this.shops.length) { from = this.pick(this.depots.industrie); to = this.pick(this.shops); usage = this.rand() < 0.6 ? 'livraison' : 'fret'; }
      else if (r < 0.19 && this.works.length) { const a = this.pick(this.depots.gare.length ? this.depots.gare : this.works); const b = this.pickHome(); [from, to] = this.rand() < 0.5 ? [a, b] : [b, a]; usage = 'bus'; }
      else {
        const toWork = morning ? this.rand() < 0.75 : evening ? this.rand() < 0.25 : this.rand() < 0.5;
        const other = this.rand() < 0.65 || !this.shops.length ? this.pick(this.works) : this.pick(this.shops);
        const home = this.pickHome();
        if (other < 0 || home < 0) { from = home; to = this.pickHome(); }
        else if (toWork) { from = home; to = other; } else { from = other; to = home; }
      }
      if (this.spawnTrip(from, to, usage) >= 0) budget--;
    }
  }

  private updateStats(dt: number): void {
    const g = this.graph!;
    const C = this.edgeCountTmp, S = this.edgeSpeedTmp;
    C.fill(0); S.fill(0);
    let sum = 0, stopped = 0;
    for (let i = 0; i < this.actCount; i++) {
      const v = this.act[i]!;
      sum += this.v[v]!;
      if (this.v[v]! < 0.5) stopped++;
      const l = this.link[v]!;
      if (g.linkKind[l] !== 0) continue;
      const e = g.linkArc[l]! >> 1;
      C[e]!++; S[e]! += this.v[v]!;
    }
    this.stats.meanSpeedKmh = this.actCount ? (sum / this.actCount) * 3.6 : 0;
    this.stats.stopped = stopped;
    const k = 1 - Math.exp(-dt / 10);
    const router = this.router!;
    for (let e = 0; e < g.edgeCount; e++) {
      const lanes = Math.max(1, g.edgeLanes[e * 2]! + g.edgeLanes[e * 2 + 1]!);
      const dens = C[e]! / Math.max(0.01, g.edgeLen[e]! / 1000) / lanes;
      this.edgeDensity[e] = this.edgeDensity[e]! + (dens - this.edgeDensity[e]!) * k;
      const sp = C[e]! > 0 ? S[e]! / C[e]! : g.edgeSpeed[e]!;
      this.edgeSpeed[e] = this.edgeSpeed[e]! + (sp - this.edgeSpeed[e]!) * k;
      // retard observé -> coût A* (congestion)
      const free = g.edgeLen[e]! / g.edgeSpeed[e]!;
      const obs = g.edgeLen[e]! / Math.max(1, this.edgeSpeed[e]!);
      const d = Math.max(0, obs - free);
      router.delay[e * 2] = d; router.delay[e * 2 + 1] = d;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Sorties                                                              */
  /* ------------------------------------------------------------------ */

  /** Position monde (x, y, z, cap) du véhicule v dans out[o..o+3]. */
  vehiclePose(v: number, out: Float32Array, o: number): void {
    this.graph!.linkPoint(this.link[v]!, this.s[v]!, this.latOff[v]!, out, o);
  }

  /** Trame transférable pour le rendu (tampons neufs : ils sont transférés au thread principal). */
  takeFrame(): TrafficVehicleFrame {
    const n = this.actCount;
    const positions = new Float32Array(n * VEHICLE_STRIDE);
    const assetIndices = new Uint16Array(n);
    const ids = new Uint32Array(n);
    const variants = new Uint8Array(n);
    const flags = new Uint8Array(n);
    if (this.graph) {
      for (let i = 0; i < n; i++) {
        const v = this.act[i]!;
        this.vehiclePose(v, positions, i * VEHICLE_STRIDE);
        assetIndices[i] = this.asset[v]!; ids[i] = v; variants[i] = this.variant[v]!; flags[i] = this.flags[v]!;
      }
    }
    return { count: n, positions, assetIndices, ids, variants, flags };
  }

  /** Densité par tronçon (ids du monde, véh/km/voie, vitesse moyenne m/s) pour cartes de chaleur. */
  densityFrame(): { edgeIds: Int32Array; density: Float32Array; speed: Float32Array } {
    const g = this.graph;
    if (!g) return { edgeIds: new Int32Array(0), density: new Float32Array(0), speed: new Float32Array(0) };
    return { edgeIds: g.edgeId.slice(), density: this.edgeDensity.slice(), speed: this.edgeSpeed.slice() };
  }

  /** États des feux (nœud, bras, état 0/1/2, x, z de l'entrée) — diagnostic, rendu des feux. */
  signalStates(): { nodeId: number; arc: number; state: number }[] {
    const g = this.graph;
    const out: { nodeId: number; arc: number; state: number }[] = [];
    if (!g) return out;
    for (let n = 0; n < g.nodeCount; n++) {
      if (g.nodeControl[n] !== Control.Signal) continue;
      for (let a = g.nodeArmStart[n]!; a < g.nodeArmStart[n + 1]!; a++) out.push({ nodeId: g.nodeId[n]!, arc: g.armArc[a]!, state: this.signalState(n, a) });
    }
    return out;
  }

  clear(): void {
    while (this.actCount) this.despawn(this.act[0]!);
    this.arenaUsed = 0; this.arenaLive = 0;
  }
}
