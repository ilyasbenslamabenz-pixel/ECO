/**
 * Graphe routier des camions-bennes : nœuds du réseau + points d'arrêt insérés sur les tronçons (bâtiments,
 * installations), arcs pondérés en minutes de jeu (longueur / vitesse commerciale bornée par la voie), sens
 * uniques respectés, rues piétonnes exclues. Dijkstra (tas binaire) et tracé des itinéraires (polylignes sur
 * les courbes de Bézier, décalées sur la voie de droite).
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { ROAD_KINDS } from '../roads/types';
import { derivCubic, evalCubic, type Cubic } from '../roads/bezier';
import type { PluginRoads } from '../plugins/types';

/** Point à rattacher au réseau (bâtiment ou installation). */
export interface AttachRequest { ref: number; x: number; z: number }

/** Rattachement trouvé : nœud du graphe, tronçon et abscisse. */
export interface Attachment { ref: number; node: number; segId: number; t: number; x: number; z: number; d: number }

interface EdgeGeom { segId: number; t0: number; t1: number }

/** Distance maximale bâtiment → axe de la route pour être desservi (m). */
export const ATTACH_RADIUS = 70;
/** Décalage latéral des camions (voie de droite, m). */
const LANE_OFFSET = 1.7;
/** Pas d'échantillonnage des courbes (m). */
const SAMPLE_STEP = 12;

export class TruckGraph {
  /** Nombre de nœuds (nœuds routiers puis points d'arrêt). */
  n = 0;
  private start: Int32Array = new Int32Array(1);
  private to: Int32Array = new Int32Array(0);
  private w: Float64Array = new Float64Array(0);
  private geo: EdgeGeom[] = [];
  private curves = new Map<number, Cubic>();
  private lengths = new Map<number, number>();
  /** Rattachements par référence (ref -> rattachement). */
  readonly attached = new Map<number, Attachment>();
  // Dijkstra : tampons réutilisés.
  private dist: Float64Array = new Float64Array(0);
  private prevEdge: Int32Array = new Int32Array(0);
  private heap: Int32Array = new Int32Array(0);
  private heapKey: Float64Array = new Float64Array(0);

  /**
   * Construit le graphe depuis le réseau routier. `speedKmh` = vitesse commerciale maximale du camion.
   * Les demandes de rattachement sans tronçon carrossable à moins de `ATTACH_RADIUS` sont ignorées.
   */
  static build(roads: PluginRoads, requests: readonly AttachRequest[], speedKmh: number): TruckGraph {
    const g = new TruckGraph();
    const nodeIds = roads.nodeIds();
    const nodeIndex = new Map<number, number>();
    for (const id of nodeIds) nodeIndex.set(id, nodeIndex.size);
    let n = nodeIds.length;
    const drivable = (segId: number): boolean => ROAD_KINDS[roads.kindOf(segId)].vehicles;
    // 1. Rattachements : tronçon carrossable le plus proche.
    const bySeg = new Map<number, Attachment[]>();
    for (const r of requests) {
      const near = roads.segmentNear(r.x, r.z, ATTACH_RADIUS, (id) => !drivable(id));
      if (!near) continue;
      const a: Attachment = { ref: r.ref, node: -1, segId: near.segId, t: near.t, x: near.x, z: near.z, d: near.d };
      let l = bySeg.get(near.segId);
      if (!l) bySeg.set(near.segId, (l = []));
      l.push(a);
    }
    // 2. Arcs : chaque tronçon devient une chaîne a -> arrêts (t croissant) -> b.
    const from: number[] = [], to: number[] = [], w: number[] = [], geo: EdgeGeom[] = [];
    const addArc = (u: number, v: number, minutes: number, eg: EdgeGeom): void => { from.push(u); to.push(v); w.push(minutes); geo.push(eg); };
    for (const segId of roads.segmentIds()) {
      if (!drivable(segId)) continue;
      const kind = ROAD_KINDS[roads.kindOf(segId)];
      const [na, nb] = roads.endpoints(segId);
      const ia = nodeIndex.get(na), ib = nodeIndex.get(nb);
      if (ia === undefined || ib === undefined) continue;
      const L = roads.length(segId);
      g.lengths.set(segId, L);
      g.curves.set(segId, roads.curve(segId));
      const mpm = (Math.min(speedKmh, kind.speedKmh) * 1000) / 60; // m / min
      const atts = (bySeg.get(segId) ?? []).sort((p, q) => p.t - q.t || p.ref - q.ref);
      const chain: { node: number; t: number }[] = [{ node: ia, t: 0 }];
      for (const a of atts) {
        a.node = n++;
        g.attached.set(a.ref, a);
        chain.push({ node: a.node, t: a.t });
      }
      chain.push({ node: ib, t: 1 });
      const twoWay = kind.lanesBackward > 0;
      for (let k = 0; k + 1 < chain.length; k++) {
        const p = chain[k]!, q = chain[k + 1]!;
        const minutes = Math.max(1e-3, ((q.t - p.t) * L) / mpm);
        addArc(p.node, q.node, minutes, { segId, t0: p.t, t1: q.t });
        if (twoWay) addArc(q.node, p.node, minutes, { segId, t0: q.t, t1: p.t });
      }
      // Sens unique : demi-tour autorisé sur place à l'arrêt (le camion manœuvre), pour ne pas bloquer une impasse.
    }
    // 3. Structure compacte (CSR).
    g.n = n;
    g.start = new Int32Array(n + 1);
    for (const u of from) g.start[u + 1]!++;
    for (let i = 0; i < n; i++) g.start[i + 1]! += g.start[i]!;
    const fill = g.start.slice(0, n);
    g.to = new Int32Array(from.length);
    g.w = new Float64Array(from.length);
    g.geo = new Array<EdgeGeom>(from.length);
    for (let e = 0; e < from.length; e++) {
      const k = fill[from[e]!]!++;
      g.to[k] = to[e]!; g.w[k] = w[e]!; g.geo[k] = geo[e]!;
    }
    g.dist = new Float64Array(n);
    g.prevEdge = new Int32Array(n);
    g.heap = new Int32Array(Math.max(1, from.length + n));
    g.heapKey = new Float64Array(Math.max(1, from.length + n));
    return g;
  }

  /** Dijkstra depuis `src` : temps (min) vers chaque nœud (Infinity si inaccessible). Résultat valable jusqu'au prochain appel. */
  shortest(src: number): Float64Array {
    const { dist, prevEdge, heap, heapKey } = this;
    dist.fill(Infinity);
    prevEdge.fill(-1);
    if (src < 0 || src >= this.n) return dist;
    let size = 0;
    const push = (v: number, k: number): void => {
      let i = size++;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heapKey[p]! <= k) break;
        heap[i] = heap[p]!; heapKey[i] = heapKey[p]!; i = p;
      }
      heap[i] = v; heapKey[i] = k;
    };
    const pop = (): number => {
      const top = heap[0]!;
      const lv = heap[--size]!, lk = heapKey[size]!;
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= size) break;
        if (c + 1 < size && heapKey[c + 1]! < heapKey[c]!) c++;
        if (heapKey[c]! >= lk) break;
        heap[i] = heap[c]!; heapKey[i] = heapKey[c]!; i = c;
      }
      heap[i] = lv; heapKey[i] = lk;
      return top;
    };
    dist[src] = 0;
    push(src, 0);
    while (size > 0) {
      const k0 = heapKey[0]!;
      const u = pop();
      if (k0 > dist[u]!) continue;
      for (let e = this.start[u]!; e < this.start[u + 1]!; e++) {
        const v = this.to[e]!, nd = k0 + this.w[e]!;
        if (nd < dist[v]!) {
          dist[v] = nd; prevEdge[v] = e;
          if (size >= heap.length) this.growHeap();
          push(v, nd);
        }
      }
    }
    return dist;
  }

  private growHeap(): void {
    const h = new Int32Array(this.heap.length * 2); h.set(this.heap); this.heap = h;
    const k = new Float64Array(this.heapKey.length * 2); k.set(this.heapKey); this.heapKey = k;
  }

  /**
   * Itinéraire vers `dst` depuis la source du dernier `shortest` : ajoute à `out` les points (x, z) de la
   * polyligne (voie de droite) et renvoie le temps de parcours (min), ou -1 si inaccessible.
   */
  pathTo(dst: number, out: number[]): number {
    if (dst < 0 || dst >= this.n || !Number.isFinite(this.dist[dst]!)) return -1;
    const edges: number[] = [];
    for (let v = dst, guard = 0; this.prevEdge[v]! >= 0 && guard < this.n + 1; guard++) {
      const e = this.prevEdge[v]!;
      edges.push(e);
      v = this.edgeFrom(e);
    }
    edges.reverse();
    const p = [0, 0], d = [0, 0];
    for (const e of edges) {
      const eg = this.geo[e]!;
      const c = this.curves.get(eg.segId)!, L = this.lengths.get(eg.segId)!;
      const steps = Math.max(1, Math.ceil((Math.abs(eg.t1 - eg.t0) * L) / SAMPLE_STEP));
      const dir = eg.t1 >= eg.t0 ? 1 : -1;
      for (let s = out.length ? 1 : 0; s <= steps; s++) {
        const t = eg.t0 + ((eg.t1 - eg.t0) * s) / steps;
        evalCubic(c, t, p);
        derivCubic(c, t, d);
        const l = Math.hypot(d[0]!, d[1]!) || 1;
        // Normale à droite du sens de marche (x vers la droite, z vers l'avant : droite = (-dz, dx) en repère y-haut).
        const tx = (d[0]! / l) * dir, tz = (d[1]! / l) * dir;
        out.push(p[0]! - tz * LANE_OFFSET, p[1]! + tx * LANE_OFFSET);
      }
    }
    return this.dist[dst]!;
  }

  private edgeFrom(e: number): number {
    // Recherche du nœud de départ de l'arc (CSR : start[u] <= e < start[u+1]) par dichotomie.
    let lo = 0, hi = this.n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.start[mid]! <= e) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  /** Nombre d'arcs (diagnostic). */
  get edgeCount(): number { return this.to.length; }
}
