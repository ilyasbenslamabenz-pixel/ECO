/**
 * Graphe de circulation et pathfinding pour le trafic :
 *  - graphe orienté compact (CSR, typed arrays) dérivé du réseau : sens uniques respectés,
 *    rues piétonnes exclues des véhicules, coût = temps de parcours (longueur / vitesse) ;
 *  - A* sans allocation par requête (tampons réutilisés, marquage par génération) ;
 *  - cache de chemins (LRU) invalidé quand le réseau change ;
 *  - A* hiérarchique (HPA*) : partition en grappes, nœuds frontières, graphe abstrait avec distances
 *    intra-grappe exactes, raffinement local du chemin ;
 *  - graphe de VOIES (lanes) avec connexions de manœuvre aux carrefours, pour la simulation de trafic.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import type { RoadNetwork } from './network';
import { outgoingDir } from './planner';
import { ROAD_KINDS, laneOffset, type RoadKindId } from './types';

export type TravelMode = 'vehicle' | 'pedestrian';

const PED_SPEED = 1.4; // m/s

/** Graphe orienté (CSR) sur les INDEX de nœuds du graphe de circulation. */
export class RoutingGraph {
  readonly nodeCount: number;
  /** id de nœud du réseau pour chaque index. */
  readonly nodeIds: Int32Array;
  readonly x: Float64Array;
  readonly z: Float64Array;
  readonly offsets: Int32Array;
  readonly targets: Int32Array;
  readonly costs: Float32Array;
  /** Tronçon du réseau emprunté par chaque arc. */
  readonly arcSeg: Int32Array;
  readonly maxSpeed: number;
  readonly version: number;
  private readonly index = new Map<number, number>();

  constructor(net: RoadNetwork, readonly mode: TravelMode = 'vehicle') {
    this.version = net.version;
    const n = net.nodeCount;
    this.nodeCount = n;
    this.nodeIds = Int32Array.from(net.nodeId.subarray(0, n));
    this.x = Float64Array.from(net.nodeX.subarray(0, n));
    this.z = Float64Array.from(net.nodeZ.subarray(0, n));
    for (let i = 0; i < n; i++) this.index.set(this.nodeIds[i]!, i);
    const deg = new Int32Array(n + 1);
    const arcs: [number, number, number, number][] = [];
    let maxSpeed = 0.1;
    for (let s = 0; s < net.segCount; s++) {
      const sid = net.segId[s]!;
      const kind = ROAD_KINDS[net.kindOf(sid)];
      const ia = this.index.get(net.segA[s]!)!, ib = this.index.get(net.segB[s]!)!;
      const len = net.segLength[s]!;
      if (mode === 'vehicle') {
        if (!kind.vehicles) continue;
        const v = kind.speedKmh / 3.6;
        maxSpeed = Math.max(maxSpeed, v);
        if (kind.lanesForward > 0) arcs.push([ia, ib, len / v, sid]);
        if (kind.lanesBackward > 0) arcs.push([ib, ia, len / v, sid]);
      } else {
        if (!kind.pedestrians) continue;
        maxSpeed = PED_SPEED;
        arcs.push([ia, ib, len / PED_SPEED, sid], [ib, ia, len / PED_SPEED, sid]);
      }
    }
    this.maxSpeed = maxSpeed;
    for (const a of arcs) deg[a[0] + 1]!++;
    for (let i = 0; i < n; i++) deg[i + 1]! += deg[i]!;
    this.offsets = deg;
    this.targets = new Int32Array(arcs.length);
    this.costs = new Float32Array(arcs.length);
    this.arcSeg = new Int32Array(arcs.length);
    const fill = new Int32Array(n);
    for (const [a, b, c, s] of arcs) {
      const k = this.offsets[a]! + fill[a]!++;
      this.targets[k] = b; this.costs[k] = c; this.arcSeg[k] = s;
    }
  }

  indexOf(nodeId: number): number { return this.index.get(nodeId) ?? -1; }
}

/** Résultat de chemin : ids de nœuds du réseau et coût total (s). */
export interface PathResult { nodes: number[]; cost: number }

/**
 * A* réutilisable : tampons dimensionnés une fois par graphe, marquage par génération
 * (aucun remplissage de tableau ni allocation par requête, hors tableau de résultat).
 */
export class AStar {
  private g: Float64Array;
  private came: Int32Array;
  private stamp: Uint32Array;
  private closedStamp: Uint32Array;
  private gen = 0;
  private heapF = new Float64Array(256);
  private heapI = new Int32Array(256);
  private size = 0;
  /** Nombre de nœuds développés par la dernière requête (diagnostic). */
  expanded = 0;

  constructor(private graph: RoutingGraph) {
    const n = graph.nodeCount;
    this.g = new Float64Array(n);
    this.came = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closedStamp = new Uint32Array(n);
  }

  private push(f: number, i: number): void {
    if (this.size === this.heapF.length) {
      const nf = new Float64Array(this.size * 2); nf.set(this.heapF); this.heapF = nf;
      const ni = new Int32Array(this.size * 2); ni.set(this.heapI); this.heapI = ni;
    }
    const hf = this.heapF, hi = this.heapI;
    let k = this.size++;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (hf[p]! <= f) break;
      hf[k] = hf[p]!; hi[k] = hi[p]!; k = p;
    }
    hf[k] = f; hi[k] = i;
  }

  private pop(): number {
    const hf = this.heapF, hi = this.heapI;
    const top = hi[0]!;
    const lf = hf[--this.size]!, li = hi[this.size]!;
    let k = 0;
    for (;;) {
      let c = 2 * k + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && hf[c + 1]! < hf[c]!) c++;
      if (hf[c]! >= lf) break;
      hf[k] = hf[c]!; hi[k] = hi[c]!; k = c;
    }
    hf[k] = lf; hi[k] = li;
    return top;
  }

  /**
   * Chemin le plus rapide entre deux INDEX de nœuds. `allow(i)` restreint la recherche
   * (utilisé par HPA* pour rester dans une grappe). Renvoie le coût, ou Infinity.
   * Le chemin se lit ensuite avec `readPath`.
   */
  searchIndex(start: number, goal: number, allow?: (i: number) => boolean): number {
    const gr = this.graph;
    if (++this.gen === 0xffffffff) { this.stamp.fill(0); this.closedStamp.fill(0); this.gen = 1; }
    const gen = this.gen;
    this.size = 0;
    this.expanded = 0;
    const gx = gr.x[goal]!, gz = gr.z[goal]!, inv = 1 / gr.maxSpeed;
    this.g[start] = 0; this.came[start] = -1; this.stamp[start] = gen;
    this.push(Math.hypot(gr.x[start]! - gx, gr.z[start]! - gz) * inv, start);
    while (this.size > 0) {
      const cur = this.pop();
      if (this.closedStamp[cur] === gen) continue;
      if (cur === goal) return this.g[goal]!;
      this.closedStamp[cur] = gen;
      this.expanded++;
      const gc = this.g[cur]!;
      for (let k = gr.offsets[cur]!; k < gr.offsets[cur + 1]!; k++) {
        const nb = gr.targets[k]!;
        if (allow && !allow(nb)) continue;
        const ng = gc + gr.costs[k]!;
        if (this.stamp[nb] !== gen || ng < this.g[nb]!) {
          this.stamp[nb] = gen; this.g[nb] = ng; this.came[nb] = cur;
          this.push(ng + Math.hypot(gr.x[nb]! - gx, gr.z[nb]! - gz) * inv, nb);
        }
      }
    }
    return Infinity;
  }

  /** Index de nœuds du dernier chemin trouvé jusqu'à `goal`. */
  readPath(goal: number): number[] {
    const out: number[] = [];
    for (let i = goal; i !== -1; i = this.came[i]!) out.push(i);
    return out.reverse();
  }

  /** Recherche par ids du réseau. */
  find(fromNodeId: number, toNodeId: number): PathResult | null {
    const s = this.graph.indexOf(fromNodeId), t = this.graph.indexOf(toNodeId);
    if (s < 0 || t < 0) return null;
    const c = this.searchIndex(s, t);
    if (c === Infinity) return null;
    return { nodes: this.readPath(t).map((i) => this.graph.nodeIds[i]!), cost: c };
  }

  /** Dijkstra borné (sans heuristique) depuis `start` : coûts vers chaque index autorisé (Infinity sinon). */
  dijkstra(start: number, allow: (i: number) => boolean, out: Float64Array): void {
    const gr = this.graph;
    out.fill(Infinity);
    if (++this.gen === 0xffffffff) { this.stamp.fill(0); this.closedStamp.fill(0); this.gen = 1; }
    const gen = this.gen;
    this.size = 0;
    this.g[start] = 0; this.stamp[start] = gen; this.came[start] = -1;
    this.push(0, start);
    while (this.size > 0) {
      const cur = this.pop();
      if (this.closedStamp[cur] === gen) continue;
      this.closedStamp[cur] = gen;
      out[cur] = this.g[cur]!;
      for (let k = gr.offsets[cur]!; k < gr.offsets[cur + 1]!; k++) {
        const nb = gr.targets[k]!;
        if (!allow(nb)) continue;
        const ng = this.g[cur]! + gr.costs[k]!;
        if (this.stamp[nb] !== gen || ng < this.g[nb]!) {
          this.stamp[nb] = gen; this.g[nb] = ng; this.came[nb] = cur;
          this.push(ng, nb);
        }
      }
    }
  }
}

/** Planificateur avec cache : reconstruit le graphe quand la version du réseau change. */
export class PathPlanner {
  private graph: RoutingGraph | null = null;
  private astar: AStar | null = null;
  private cache = new Map<number, PathResult | null>();
  hits = 0;
  misses = 0;

  constructor(private net: RoadNetwork, readonly mode: TravelMode = 'vehicle', readonly cacheSize = 2048) {}

  private ensure(): void {
    if (!this.graph || this.graph.version !== this.net.version) {
      this.graph = new RoutingGraph(this.net, this.mode);
      this.astar = new AStar(this.graph);
      this.cache.clear();
    }
  }

  getGraph(): RoutingGraph { this.ensure(); return this.graph!; }

  find(fromNodeId: number, toNodeId: number): PathResult | null {
    this.ensure();
    const key = fromNodeId * 4194304 + toNodeId;
    if (this.cache.has(key)) {
      const v = this.cache.get(key)!;
      this.cache.delete(key); this.cache.set(key, v); // LRU : remis en fin
      this.hits++;
      return v;
    }
    this.misses++;
    const r = this.astar!.find(fromNodeId, toNodeId);
    this.cache.set(key, r);
    if (this.cache.size > this.cacheSize) this.cache.delete(this.cache.keys().next().value!);
    return r;
  }
}

/* -------------------------------------------------------------------------- */
/* A* hiérarchique (HPA*)                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Hiérarchie à un niveau : grappes carrées de `clusterSize` m. Les nœuds frontières (ayant un arc
 * vers une autre grappe) forment le graphe abstrait ; ses arcs sont (a) les arcs inter-grappes
 * d'origine et (b) les distances exactes entre frontières d'une même grappe (Dijkstra restreint).
 * Une requête relie départ et arrivée aux frontières de leur grappe, cherche sur le graphe abstrait,
 * puis raffine chaque arc intra-grappe par un A* restreint. Coût identique à l'A* plat.
 */
export class HierarchicalPlanner {
  readonly cluster: Int32Array;
  readonly borders: number[];
  private readonly isBorder: Uint8Array;
  /** Graphe abstrait : adjacence par index de nœud frontière (listes). */
  private readonly absAdj = new Map<number, { to: number; cost: number; intra: boolean }[]>();
  private readonly astar: AStar;
  private readonly dist: Float64Array;

  constructor(readonly graph: RoutingGraph, readonly clusterSize = 512) {
    const n = graph.nodeCount;
    this.cluster = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const cx = Math.floor(graph.x[i]! / clusterSize), cz = Math.floor(graph.z[i]! / clusterSize);
      this.cluster[i] = (cx + 1024) * 2048 + (cz + 1024);
    }
    this.isBorder = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      for (let k = graph.offsets[i]!; k < graph.offsets[i + 1]!; k++) {
        const j = graph.targets[k]!;
        if (this.cluster[j] !== this.cluster[i]) { this.isBorder[i] = 1; this.isBorder[j] = 1; }
      }
    }
    this.borders = [];
    for (let i = 0; i < n; i++) if (this.isBorder[i]) { this.borders.push(i); this.absAdj.set(i, []); }
    this.astar = new AStar(graph);
    this.dist = new Float64Array(n);
    // (a) arcs inter-grappes
    for (const i of this.borders) {
      for (let k = graph.offsets[i]!; k < graph.offsets[i + 1]!; k++) {
        const j = graph.targets[k]!;
        if (this.cluster[j] !== this.cluster[i]) this.absAdj.get(i)!.push({ to: j, cost: graph.costs[k]!, intra: false });
      }
    }
    // (b) distances intra-grappe entre frontières
    const byCluster = new Map<number, number[]>();
    for (const b of this.borders) {
      const c = this.cluster[b]!;
      let l = byCluster.get(c);
      if (!l) { l = []; byCluster.set(c, l); }
      l.push(b);
    }
    for (const [c, list] of byCluster) {
      const allow = (i: number): boolean => this.cluster[i] === c;
      for (const b of list) {
        this.astar.dijkstra(b, allow, this.dist);
        for (const o of list) {
          if (o === b || this.dist[o] === Infinity) continue;
          this.absAdj.get(b)!.push({ to: o, cost: this.dist[o]!, intra: true });
        }
      }
    }
  }

  get abstractEdgeCount(): number {
    let n = 0;
    for (const l of this.absAdj.values()) n += l.length;
    return n;
  }

  /** Chemin (ids de nœuds) entre deux ids du réseau. */
  find(fromNodeId: number, toNodeId: number): PathResult | null {
    const g = this.graph;
    const s = g.indexOf(fromNodeId), t = g.indexOf(toNodeId);
    if (s < 0 || t < 0) return null;
    const cs = this.cluster[s]!, ct = this.cluster[t]!;
    // Chemin direct restreint à la grappe commune (candidat).
    let best = Infinity;
    let bestPath: number[] | null = null;
    if (cs === ct) {
      const c = this.astar.searchIndex(s, t, (i) => this.cluster[i] === cs);
      if (c < Infinity) { best = c; bestPath = this.astar.readPath(t); }
    }
    // Départ -> frontières de sa grappe ; frontières de la grappe d'arrivée -> arrivée.
    const fromS = new Map<number, number>();
    this.astar.dijkstra(s, (i) => this.cluster[i] === cs, this.dist);
    for (const b of this.borders) if (this.cluster[b] === cs && this.dist[b]! < Infinity) fromS.set(b, this.dist[b]!);
    const toT = new Map<number, number>();
    for (const b of this.borders) {
      if (this.cluster[b] !== ct) continue;
      const c = this.astar.searchIndex(b, t, (i) => this.cluster[i] === ct);
      if (c < Infinity) toT.set(b, c);
    }
    // A* sur le graphe abstrait (petit : structures simples).
    const gS = new Map<number, number>();
    const prev = new Map<number, number>();
    const open: [number, number][] = [];
    const tx = g.x[t]!, tz = g.z[t]!, inv = 1 / g.maxSpeed;
    const h = (i: number): number => Math.hypot(g.x[i]! - tx, g.z[i]! - tz) * inv;
    for (const [b, c] of fromS) { gS.set(b, c); prev.set(b, -1); open.push([c + h(b), b]); }
    const closed = new Set<number>();
    let bestEnd = -1;
    while (open.length) {
      let bi = 0;
      for (let k = 1; k < open.length; k++) if (open[k]![0] < open[bi]![0]) bi = k;
      const [f, cur] = open[bi]!;
      open[bi] = open[open.length - 1]!; open.pop();
      if (f >= best) break;
      if (closed.has(cur)) continue;
      closed.add(cur);
      const gc = gS.get(cur)!;
      const tail = toT.get(cur);
      if (tail !== undefined && gc + tail < best) { best = gc + tail; bestEnd = cur; bestPath = null; }
      for (const e of this.absAdj.get(cur) ?? []) {
        const ng = gc + e.cost;
        if (ng < (gS.get(e.to) ?? Infinity)) { gS.set(e.to, ng); prev.set(e.to, cur); open.push([ng + h(e.to), e.to]); }
      }
    }
    if (best === Infinity) return null;
    if (bestPath) return { nodes: bestPath.map((i) => g.nodeIds[i]!), cost: best };
    // Raffinement : départ -> b0 -> … -> bk -> arrivée.
    const chain: number[] = [];
    for (let b = bestEnd; b !== -1; b = prev.get(b)!) chain.push(b);
    chain.reverse();
    const full: number[] = [];
    const appendLocal = (a: number, b: number): void => {
      if (a === b) { if (!full.length) full.push(a); return; }
      const ca = this.cluster[a]!, cb = this.cluster[b]!;
      const allow = ca === cb ? (i: number): boolean => this.cluster[i] === ca : undefined;
      this.astar.searchIndex(a, b, allow);
      const p = this.astar.readPath(b);
      for (let k = full.length ? 1 : 0; k < p.length; k++) full.push(p[k]!);
    };
    appendLocal(s, chain[0]!);
    for (let k = 1; k < chain.length; k++) appendLocal(chain[k - 1]!, chain[k]!);
    appendLocal(chain[chain.length - 1]!, t);
    return { nodes: full.map((i) => g.nodeIds[i]!), cost: best };
  }
}

/* -------------------------------------------------------------------------- */
/* Graphe de voies                                                             */
/* -------------------------------------------------------------------------- */

export type TurnKind = 'straight' | 'left' | 'right' | 'uturn';

/**
 * Voies (SoA) : une entrée par voie de chaque tronçon et chaque sens, avec son décalage latéral,
 * et connexions de manœuvre au nœud d'arrivée (CSR).
 */
export class LaneGraph {
  readonly count: number;
  readonly laneSeg: Int32Array;
  /** 1 = sens a -> b, 0 = sens b -> a. */
  readonly laneForward: Uint8Array;
  /** Rang de la voie (0 = la plus proche de l'axe / du terre-plein). */
  readonly laneRank: Uint8Array;
  /** Décalage latéral (m, positif à gauche du sens a -> b). */
  readonly laneOffset: Float32Array;
  /** Nœud d'arrivée de la voie. */
  readonly laneToNode: Int32Array;
  readonly connOffsets: Int32Array;
  readonly connTargets: Int32Array;
  readonly connTurn: Uint8Array;

  static readonly TURNS: readonly TurnKind[] = ['straight', 'left', 'right', 'uturn'];

  constructor(net: RoadNetwork) {
    const seg: number[] = [], fwd: number[] = [], rank: number[] = [], off: number[] = [], toNode: number[] = [];
    const lanesBySegDir = new Map<string, number[]>(); // `${seg}:${1|0}` -> index de voies
    for (let s = 0; s < net.segCount; s++) {
      const sid = net.segId[s]!;
      const kindId: RoadKindId = net.kindOf(sid);
      const k = ROAD_KINDS[kindId];
      if (!k.vehicles) continue;
      for (const forward of [true, false]) {
        const n = forward ? k.lanesForward : k.lanesBackward;
        const list: number[] = [];
        for (let r = 0; r < n; r++) {
          list.push(seg.length);
          seg.push(sid); fwd.push(forward ? 1 : 0); rank.push(r); off.push(laneOffset(k, forward, r));
          toNode.push(forward ? net.segB[s]! : net.segA[s]!);
        }
        lanesBySegDir.set(`${sid}:${forward ? 1 : 0}`, list);
      }
    }
    this.count = seg.length;
    this.laneSeg = Int32Array.from(seg);
    this.laneForward = Uint8Array.from(fwd);
    this.laneRank = Uint8Array.from(rank);
    this.laneOffset = Float32Array.from(off);
    this.laneToNode = Int32Array.from(toNode);
    // Connexions au nœud d'arrivée.
    const conns: [number, number, number][] = [];
    for (let l = 0; l < this.count; l++) {
      const sid = this.laneSeg[l]!;
      const node = this.laneToNode[l]!;
      const inDir = outgoingDir(net, sid, node); // vers l'arrière ; direction d'arrivée = -inDir
      const ax = -inDir[0], az = -inDir[1];
      const incident = net.incident(node);
      const nIn = lanesBySegDir.get(`${sid}:${this.laneForward[l]}`)!.length;
      const outs: { seg: number; turn: TurnKind; lanes: number[] }[] = [];
      for (const o of incident) {
        const [oa] = net.endpoints(o);
        const lanes = lanesBySegDir.get(`${o}:${oa === node ? 1 : 0}`);
        if (!lanes || lanes.length === 0) continue;
        let turn: TurnKind;
        if (o === sid) turn = 'uturn';
        else {
          const [ox, oz] = outgoingDir(net, o, node);
          const cross = ax * oz - az * ox; // > 0 : à droite (repère x vers l'est, z vers le sud, vu du dessus)
          const dot = ax * ox + az * oz;
          turn = dot > 0.7 ? 'straight' : cross > 0 ? 'right' : 'left';
        }
        outs.push({ seg: o, turn, lanes });
      }
      const nonU = outs.filter((o) => o.turn !== 'uturn');
      const usable = nonU.length ? nonU : outs; // demi-tour seulement en impasse
      const rankIn = this.laneRank[l]!;
      // rang 0 = voie de gauche (près de l'axe) ; la plus à droite = nIn - 1.
      for (const o of usable) {
        const okLane = o.turn === 'straight' || o.turn === 'uturn' || nIn === 1
          || (o.turn === 'left' && rankIn === 0) || (o.turn === 'right' && rankIn === nIn - 1);
        if (!okLane) continue;
        let targets: number[];
        if (o.turn === 'straight') targets = [o.lanes[Math.min(o.lanes.length - 1, Math.round((rankIn * (o.lanes.length - 1)) / Math.max(1, nIn - 1)))]!];
        else if (o.turn === 'left' || o.turn === 'uturn') targets = [o.lanes[0]!];
        else targets = [o.lanes[o.lanes.length - 1]!];
        for (const t of targets) conns.push([l, t, LaneGraph.TURNS.indexOf(o.turn)]);
      }
    }
    const deg = new Int32Array(this.count + 1);
    for (const c of conns) deg[c[0] + 1]!++;
    for (let i = 0; i < this.count; i++) deg[i + 1]! += deg[i]!;
    this.connOffsets = deg;
    this.connTargets = new Int32Array(conns.length);
    this.connTurn = new Uint8Array(conns.length);
    const fill = new Int32Array(this.count);
    for (const [a, b, t] of conns) {
      const k = this.connOffsets[a]! + fill[a]!++;
      this.connTargets[k] = b; this.connTurn[k] = t;
    }
  }

  lanesOf(segId: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.count; i++) if (this.laneSeg[i] === segId) out.push(i);
    return out;
  }
}
