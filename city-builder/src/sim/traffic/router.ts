/**
 * Calcul d'itinéraire A* sur les ARCS orientés (tronçon, sens) du graphe de circulation :
 * l'état est l'arc (et non le nœud), ce qui respecte les manœuvres réellement autorisées par les
 * connecteurs (pas de demi-tour hors impasse, sens uniques). Coût = temps de parcours libre
 * + retard observé (congestion, mis à jour par la simulation) + pénalités de carrefour / tourne-à-gauche.
 * Tampons réutilisés et marquage par génération : aucune allocation par requête hors tableau résultat.
 * TypeScript pur.
 */
import type { TrafficGraph } from './network';

export class ArcRouter {
  private g: Float64Array;
  private came: Int32Array;
  private stamp: Uint32Array;
  private closed: Uint32Array;
  private gen = 0;
  private heapF = new Float64Array(256);
  private heapI = new Int32Array(256);
  private size = 0;
  /** Retard additionnel par arc (s), alimenté par la simulation (congestion). */
  readonly delay: Float32Array;
  /** Nombre d'arcs développés par la dernière requête (diagnostic / tests). */
  expanded = 0;
  /** Nombre total de requêtes A* (diagnostic / tests). */
  queries = 0;
  private readonly maxSpeed: number;

  constructor(private readonly net: TrafficGraph) {
    const n = net.edgeCount * 2;
    this.g = new Float64Array(n);
    this.came = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.delay = new Float32Array(n);
    let ms = 1;
    for (let e = 0; e < net.edgeCount; e++) ms = Math.max(ms, net.edgeSpeed[e]!);
    this.maxSpeed = ms;
  }

  /** Coût (s) de parcours d'un arc. */
  arcCost(arc: number): number {
    const e = arc >> 1;
    const node = this.net.arcTo(arc);
    const ctl = this.net.nodeControl[node]!;
    return this.net.edgeLen[e]! / this.net.edgeSpeed[e]! + this.delay[arc]! + (ctl === 3 ? 6 : ctl === 1 || ctl === 2 ? 2.5 : 0);
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
   * Itinéraire de l'arc `from` (déjà engagé) à l'arc `to` (inclus). Écrit la suite d'arcs dans `out`
   * à partir de `outOff` (from inclus) et renvoie sa longueur, ou −1 si inaccessible / trop longue.
   */
  route(from: number, to: number, out: Int32Array, outOff: number, maxLen: number): number {
    this.queries++;
    this.expanded = 0;
    if (from === to) { if (maxLen < 1) return -1; out[outOff] = from; return 1; }
    const net = this.net;
    if (++this.gen === 0xffffffff) { this.stamp.fill(0); this.closed.fill(0); this.gen = 1; }
    const gen = this.gen;
    const goalNode = net.arcFrom(to);
    const gx = net.nodeX[goalNode]!, gz = net.nodeZ[goalNode]!;
    const h = (arc: number): number => {
      const n = net.arcTo(arc);
      return Math.hypot(net.nodeX[n]! - gx, net.nodeZ[n]! - gz) / this.maxSpeed;
    };
    this.size = 0;
    this.g[from] = 0; this.stamp[from] = gen; this.came[from] = -1;
    this.push(h(from), from);
    let found = false;
    while (this.size > 0) {
      const cur = this.pop();
      if (this.closed[cur] === gen) continue;
      this.closed[cur] = gen;
      this.expanded++;
      if (cur === to) { found = true; break; }
      const gc = this.g[cur]!;
      for (let k = net.arcNextStart[cur]!; k < net.arcNextStart[cur + 1]!; k++) {
        const nx = net.arcNext[k]!;
        const ng = gc + (nx === to ? 0 : this.arcCost(nx));
        if (this.stamp[nx] !== gen || ng < this.g[nx]!) {
          this.stamp[nx] = gen; this.g[nx] = ng; this.came[nx] = cur;
          this.push(ng + h(nx), nx);
        }
      }
    }
    if (!found) return -1;
    let n = 0;
    for (let a = to; a !== -1; a = this.came[a]!) n++;
    if (n > maxLen) return -1;
    let k = outOff + n - 1;
    for (let a = to; a !== -1; a = this.came[a]!) out[k--] = a;
    return n;
  }
}
