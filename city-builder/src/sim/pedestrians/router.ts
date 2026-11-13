/**
 * Itinéraires piétons : A* sur le graphe piéton entre deux points situés SUR des arêtes (accès de bâtiments).
 * Coût = longueur, majorée sur les traversées (un passage peint coûte un peu, une traversée libre davantage :
 * les piétons préfèrent les passages sans s'interdire de couper une rue calme). Tampons réutilisés : aucune
 * allocation par requête. TypeScript pur : AUCUN import de three ni du DOM.
 */
import { EDGE_CROSS_MARKED, EDGE_CROSS_UNMARKED, type PedGraph } from './graph';

/** Pénalités (m équivalents) ajoutées à la longueur d'une traversée. */
export const COST_CROSS_MARKED = 8;
export const COST_CROSS_UNMARKED = 28;
export const COST_CROSS_FACTOR = 1.25;

export class PedRouter {
  private g: PedGraph;
  private dist = new Float32Array(0);
  private fromEdge = new Int32Array(0);
  private stamp = new Uint32Array(0);
  private closed = new Uint32Array(0);
  private gen = 0;
  private heapNode = new Int32Array(1024);
  private heapKey = new Float32Array(1024);
  private heapN = 0;
  private rev = new Int32Array(256);
  /** Nombre de requêtes servies (statistiques). */
  queries = 0;

  constructor(g: PedGraph) {
    this.g = g;
    this.setGraph(g);
  }

  setGraph(g: PedGraph): void {
    this.g = g;
    if (this.dist.length < g.nodeCount) {
      this.dist = new Float32Array(g.nodeCount);
      this.fromEdge = new Int32Array(g.nodeCount);
      this.stamp = new Uint32Array(g.nodeCount);
      this.closed = new Uint32Array(g.nodeCount);
      this.gen = 0;
    }
  }

  edgeCost(e: number): number {
    const g = this.g, k = g.eKind[e]!;
    if (k === EDGE_CROSS_MARKED) return g.eLen[e]! * COST_CROSS_FACTOR + COST_CROSS_MARKED;
    if (k === EDGE_CROSS_UNMARKED) return g.eLen[e]! * COST_CROSS_FACTOR + COST_CROSS_UNMARKED;
    return g.eLen[e]!;
  }

  private push(node: number, key: number): void {
    if (this.heapN === this.heapNode.length) {
      const n = this.heapN * 2;
      const hn = new Int32Array(n); hn.set(this.heapNode); this.heapNode = hn;
      const hk = new Float32Array(n); hk.set(this.heapKey); this.heapKey = hk;
    }
    let i = this.heapN++;
    const hn = this.heapNode, hk = this.heapKey;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hk[p]! <= key) break;
      hn[i] = hn[p]!; hk[i] = hk[p]!;
      i = p;
    }
    hn[i] = node; hk[i] = key;
  }

  private pop(): number {
    const hn = this.heapNode, hk = this.heapKey;
    const top = hn[0]!;
    const n = --this.heapN;
    if (n > 0) {
      const node = hn[n]!, key = hk[n]!;
      let i = 0;
      for (;;) {
        let c = i * 2 + 1;
        if (c >= n) break;
        if (c + 1 < n && hk[c + 1]! < hk[c]!) c++;
        if (hk[c]! >= key) break;
        hn[i] = hn[c]!; hk[i] = hk[c]!;
        i = c;
      }
      hn[i] = node; hk[i] = key;
    }
    return top;
  }

  /**
   * Chemin de (arête e0, abscisse s0) à (arête e1, abscisse s1). Écrit la suite d'arêtes (e0 … e1) dans
   * `out` à partir de `o` (au plus `max` arêtes) et renvoie leur nombre ; 0 si aucun chemin, si le chemin dépasse
   * `maxCost` (m équivalents) ou `max` arêtes. `lengthOut[0]` reçoit la longueur réelle (m) à parcourir.
   */
  route(e0: number, s0: number, e1: number, s1: number, out: Int32Array, o: number, max: number, maxCost: number, lengthOut?: Float32Array | number[]): number {
    const g = this.g;
    this.queries++;
    if (e0 === e1) {
      out[o] = e0;
      if (lengthOut) lengthOut[0] = Math.abs(s1 - s0);
      return 1;
    }
    if (++this.gen === 0xffffffff) { this.stamp.fill(0); this.closed.fill(0); this.gen = 1; }
    const gen = this.gen;
    this.heapN = 0;
    const ta = g.ea[e1]!, tb = g.eb[e1]!;
    const L1 = g.eLen[e1]!;
    // Cible : point sur e1 ; heuristique = distance à vol d'oiseau au point d'arrivée (admissible).
    const P = [0, 0, 0, 0, 0];
    g.pointAt(e1, s1, P);
    const tx = P[0]!, tz = P[2]!;
    const h = (n: number): number => Math.hypot(g.nx[n]! - tx, g.nz[n]! - tz);
    const seed = (n: number, d: number): void => {
      if (this.stamp[n] === gen && this.dist[n]! <= d) return;
      this.stamp[n] = gen; this.dist[n] = d; this.fromEdge[n] = e0;
      this.push(n, d + h(n));
    };
    seed(g.ea[e0]!, s0);
    seed(g.eb[e0]!, g.eLen[e0]! - s0);
    let best = Infinity, bestNode = -1;
    while (this.heapN > 0) {
      const key = this.heapKey[0]!;
      const n = this.pop();
      if (this.closed[n] === gen) continue;
      this.closed[n] = gen;
      const d = this.dist[n]!;
      if (key >= best || d > maxCost) break;
      if (n === ta || n === tb) {
        const total = d + (n === ta ? s1 : L1 - s1);
        if (total < best) { best = total; bestNode = n; }
        // on continue : l'autre extrémité peut donner un chemin plus court
      }
      for (let k = g.adjStart[n]!; k < g.adjStart[n + 1]!; k++) {
        const e = g.adjEdge[k]!;
        if (e === e0 || e === e1) continue;
        const m = g.ea[e] === n ? g.eb[e]! : g.ea[e]!;
        if (this.closed[m] === gen) continue;
        const nd = d + this.edgeCost(e);
        if (this.stamp[m] === gen && this.dist[m]! <= nd) continue;
        this.stamp[m] = gen; this.dist[m] = nd; this.fromEdge[m] = e;
        this.push(m, nd + h(m));
      }
    }
    if (bestNode < 0 || best > maxCost) return 0;
    // Remontée.
    let n = bestNode, count = 0, len = bestNode === ta ? s1 : L1 - s1;
    for (;;) {
      const e = this.fromEdge[n]!;
      if (count === this.rev.length) { const r = new Int32Array(count * 2); r.set(this.rev); this.rev = r; }
      this.rev[count++] = e;
      if (e === e0) { len += g.ea[e0] === n ? s0 : g.eLen[e0]! - s0; break; }
      len += g.eLen[e]!;
      n = g.ea[e] === n ? g.eb[e]! : g.ea[e]!;
    }
    if (count + 1 > max) return 0;
    for (let i = 0; i < count; i++) out[o + i] = this.rev[count - 1 - i]!;
    out[o + count] = e1;
    if (lengthOut) lengthOut[0] = len;
    return count + 1;
  }
}
