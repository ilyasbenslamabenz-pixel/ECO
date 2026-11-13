/**
 * Graphe de réseau générique (électricité, eau, égouts…) : nœuds producteurs / consommateurs / jonctions,
 * arêtes non orientées avec capacité de transit et pertes, et répartition offre / demande avec délestage
 * par priorité.
 *
 * Algorithme de répartition (`allocate`) — déterministe, documenté dans docs/MUNICIPAL.md :
 *  1. les consommateurs en service sont triés par priorité décroissante, puis identifiant croissant ;
 *  2. pour chacun, on augmente le flux le long de chemins successifs : Dijkstra depuis le consommateur sur les
 *     arêtes en service ayant une capacité résiduelle, coût = -ln(1 - pertes) (chemin aux pertes minimales) ;
 *     le producteur appelé est celui de plus petit `cost` (ordre de mérite) ayant encore de la capacité, puis
 *     le chemin le moins dissipatif, puis le plus petit identifiant ;
 *  3. quantité envoyée x = min(capacité restante du producteur, besoin / M, min_k(résiduel_k / m_k)), où m_k est
 *     le facteur de conservation à l'entrée de l'arête k et M celui du chemin entier ; le consommateur reçoit x·M ;
 *  4. un consommateur « tout ou rien » non entièrement servi est annulé (ses flux sont rendus) ;
 *  5. ce qui n'est pas livré est délesté : les priorités basses sont donc coupées en premier.
 * Limite connue : glouton sans annulation de flux (pas de chemins résiduels inverses) — la répartition n'est pas
 * toujours le flot maximal sur des maillages complexes ; elle respecte toujours capacités, pertes et priorités.
 * Coût : O(augmentations · E log V) par répartition.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import type {
  ConsumerAllocation, NetworkEdgeJSON, NetworkJSON, NetworkKind, NetworkNodeJSON, NetworkNodeRole, NetworkReport,
} from '../../shared/municipal/types';

const EPS = 1e-9;
/** Nombre maximal de chemins augmentants par consommateur (borne de sécurité). */
const MAX_AUGMENT_PER_CONSUMER = 256;

export type NodeInit = Partial<Omit<NetworkNodeJSON, 'id' | 'role'>> & { role: NetworkNodeRole };

export class ResourceNetwork {
  readonly kind: NetworkKind;
  private readonly nodes = new Map<number, NetworkNodeJSON>();
  private readonly edges = new Map<number, NetworkEdgeJSON>();
  private nextId = 1;
  /** Change à chaque modification de topologie ou de paramètre (invalidation des bilans). */
  version = 0;
  private adj: Map<number, number[]> | null = null;

  constructor(kind: NetworkKind) { this.kind = kind; }

  get nodeCount(): number { return this.nodes.size; }
  get edgeCount(): number { return this.edges.size; }
  node(id: number): Readonly<NetworkNodeJSON> | undefined { return this.nodes.get(id); }
  edge(id: number): Readonly<NetworkEdgeJSON> | undefined { return this.edges.get(id); }
  nodeIds(): number[] { return [...this.nodes.keys()].sort((a, b) => a - b); }
  edgeIds(): number[] { return [...this.edges.keys()].sort((a, b) => a - b); }

  private touch(topology: boolean): void { this.version++; if (topology) this.adj = null; }

  /* ------------------------------ Édition ------------------------------ */

  addNode(init: NodeInit): number {
    const n: NetworkNodeJSON = {
      id: this.nextId++, role: init.role, x: init.x ?? 0, z: init.z ?? 0,
      capacity: Math.max(0, init.capacity ?? 0), demand: Math.max(0, init.demand ?? 0),
      priority: init.priority ?? 0, cost: init.cost ?? 0, allOrNothing: init.allOrNothing ?? false,
      enabled: init.enabled ?? true, ref: init.ref ?? -1,
    };
    if (!['producer', 'consumer', 'junction'].includes(n.role)) throw new Error(`réseau ${this.kind} : rôle ${String(n.role)} inconnu`);
    if (![n.x, n.z, n.capacity, n.demand, n.priority, n.cost].every(Number.isFinite)) throw new Error(`réseau ${this.kind} : valeur de nœud invalide`);
    this.nodes.set(n.id, n);
    this.touch(true);
    return n.id;
  }

  private mustNode(id: number): NetworkNodeJSON {
    const n = this.nodes.get(id);
    if (!n) throw new Error(`réseau ${this.kind} : nœud ${id} inconnu`);
    return n;
  }

  /** Modifie les paramètres d'un nœud (demande, capacité, priorité, panne…). */
  updateNode(id: number, patch: Partial<Omit<NetworkNodeJSON, 'id' | 'role'>>): void {
    const n = this.mustNode(id);
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      if (typeof v === 'number' && !Number.isFinite(v)) throw new Error(`réseau ${this.kind} : ${k} invalide`);
      (n as unknown as Record<string, unknown>)[k] = v;
    }
    n.capacity = Math.max(0, n.capacity);
    n.demand = Math.max(0, n.demand);
    this.touch(false);
  }

  setDemand(id: number, demand: number): void { this.updateNode(id, { demand }); }
  setCapacity(id: number, capacity: number): void { this.updateNode(id, { capacity }); }
  setNodeEnabled(id: number, enabled: boolean): void { this.updateNode(id, { enabled }); }

  /** Supprime un nœud et ses arêtes. */
  removeNode(id: number): boolean {
    if (!this.nodes.delete(id)) return false;
    for (const [eid, e] of this.edges) if (e.a === id || e.b === id) this.edges.delete(eid);
    this.touch(true);
    return true;
  }

  addEdge(a: number, b: number, capacity: number, loss = 0): number {
    this.mustNode(a); this.mustNode(b);
    if (a === b) throw new Error(`réseau ${this.kind} : arête en boucle`);
    if (!(capacity >= 0) || !Number.isFinite(capacity)) throw new Error(`réseau ${this.kind} : capacité invalide`);
    if (!(loss >= 0 && loss < 1)) throw new Error(`réseau ${this.kind} : pertes dans [0, 1[ attendues`);
    const e: NetworkEdgeJSON = { id: this.nextId++, a, b, capacity, loss, enabled: true };
    this.edges.set(e.id, e);
    this.touch(true);
    return e.id;
  }

  updateEdge(id: number, patch: Partial<Pick<NetworkEdgeJSON, 'capacity' | 'loss' | 'enabled'>>): void {
    const e = this.edges.get(id);
    if (!e) throw new Error(`réseau ${this.kind} : arête ${id} inconnue`);
    if (patch.capacity !== undefined) { if (!(patch.capacity >= 0)) throw new Error('capacité invalide'); e.capacity = patch.capacity; }
    if (patch.loss !== undefined) { if (!(patch.loss >= 0 && patch.loss < 1)) throw new Error('pertes invalides'); e.loss = patch.loss; }
    if (patch.enabled !== undefined) e.enabled = patch.enabled;
    this.touch(false);
  }

  setEdgeEnabled(id: number, enabled: boolean): void { this.updateEdge(id, { enabled }); }

  removeEdge(id: number): boolean {
    const ok = this.edges.delete(id);
    if (ok) this.touch(true);
    return ok;
  }

  private adjacency(): Map<number, number[]> {
    if (this.adj) return this.adj;
    const m = new Map<number, number[]>();
    for (const id of this.nodes.keys()) m.set(id, []);
    for (const id of this.edgeIds()) {
      const e = this.edges.get(id)!;
      m.get(e.a)!.push(id);
      m.get(e.b)!.push(id);
    }
    this.adj = m;
    return m;
  }

  /** Composantes connexes (arêtes et nœuds en service) : identifiant de nœud -> numéro de composante. */
  components(): Map<number, number> {
    const adj = this.adjacency();
    const comp = new Map<number, number>();
    let c = 0;
    for (const start of this.nodeIds()) {
      if (comp.has(start) || !this.nodes.get(start)!.enabled) continue;
      const stack = [start];
      comp.set(start, c);
      while (stack.length) {
        const u = stack.pop()!;
        for (const eid of adj.get(u)!) {
          const e = this.edges.get(eid)!;
          if (!e.enabled) continue;
          const v = e.a === u ? e.b : e.a;
          if (comp.has(v) || !this.nodes.get(v)!.enabled) continue;
          comp.set(v, c);
          stack.push(v);
        }
      }
      c++;
    }
    return comp;
  }

  /* ---------------------------- Répartition ---------------------------- */

  /** Répartit l'offre sur la demande (voir l'en-tête du fichier). N'altère pas le réseau. */
  allocate(): NetworkReport {
    const adj = this.adjacency();
    const nodeIds = this.nodeIds();
    const remaining = new Map<number, number>();
    const produced = new Map<number, number>();
    let supply = 0, demand = 0;
    for (const id of nodeIds) {
      const n = this.nodes.get(id)!;
      if (!n.enabled) continue;
      if (n.role === 'producer') { remaining.set(id, n.capacity); produced.set(id, 0); supply += n.capacity; }
      if (n.role === 'consumer') demand += n.demand;
    }
    const used = new Map<number, number>();   // capacité consommée (somme des deux sens)
    const flow = new Map<number, number>();   // flux net entrant, sens a -> b positif
    for (const id of this.edges.keys()) { used.set(id, 0); flow.set(id, 0); }

    const consumers = nodeIds.map((id) => this.nodes.get(id)!).filter((n) => n.enabled && n.role === 'consumer');
    consumers.sort((p, q) => q.priority - p.priority || p.id - q.id);

    // Tampons de Dijkstra réutilisés.
    const dist = new Map<number, number>();
    const prevEdge = new Map<number, number>();
    const allocations: ConsumerAllocation[] = [];
    let delivered = 0;

    for (const c of consumers) {
      let need = c.demand;
      const augs: { producer: number; x: number; path: number[]; enter: number[]; dirs: number[] }[] = [];
      for (let it = 0; it < MAX_AUGMENT_PER_CONSUMER && need > EPS; it++) {
        // Dijkstra depuis le consommateur.
        dist.clear(); prevEdge.clear();
        const heap = new MinHeap();
        dist.set(c.id, 0);
        heap.push(0, c.id);
        while (heap.size) {
          const [d, u] = heap.pop();
          if (d > dist.get(u)! + EPS) continue;
          for (const eid of adj.get(u)!) {
            const e = this.edges.get(eid)!;
            if (!e.enabled || e.capacity - used.get(eid)! <= EPS) continue;
            const v = e.a === u ? e.b : e.a;
            if (!this.nodes.get(v)!.enabled) continue;
            const nd = d - Math.log(1 - e.loss);
            const old = dist.get(v);
            // Inégalité stricte : en cas d'égalité, le premier chemin trouvé (ordre du tas puis des arêtes) est gardé.
            if (old === undefined || nd < old - EPS) {
              dist.set(v, nd); prevEdge.set(v, eid); heap.push(nd, v);
            }
          }
        }
        // Producteur appelé : ordre de mérite, puis pertes, puis identifiant.
        let best = -1, bestCost = Infinity, bestDist = Infinity;
        for (const [pid, rem] of remaining) {
          if (rem <= EPS) continue;
          const d = dist.get(pid);
          if (d === undefined) continue;
          const pc = this.nodes.get(pid)!.cost;
          if (pc < bestCost - EPS || (Math.abs(pc - bestCost) <= EPS && (d < bestDist - EPS || (Math.abs(d - bestDist) <= EPS && pid < best)))) {
            best = pid; bestCost = pc; bestDist = d;
          }
        }
        if (best < 0) break;
        // Chemin producteur -> consommateur (en remontant les prédécesseurs depuis le producteur).
        const path: number[] = [], dirs: number[] = [];
        let u = best;
        while (u !== c.id) {
          const eid = prevEdge.get(u)!;
          const e = this.edges.get(eid)!;
          path.push(eid);
          dirs.push(e.a === u ? 1 : -1); // le flux va de u vers l'autre extrémité
          u = e.a === u ? e.b : e.a;
        }
        const enter: number[] = [];
        let m = 1, xMax = remaining.get(best)!;
        for (const eid of path) {
          const e = this.edges.get(eid)!;
          enter.push(m);
          xMax = Math.min(xMax, (e.capacity - used.get(eid)!) / m);
          m *= 1 - e.loss;
        }
        xMax = Math.min(xMax, need / m);
        if (!(xMax > EPS)) break;
        for (let k = 0; k < path.length; k++) {
          const eid = path[k]!;
          used.set(eid, used.get(eid)! + xMax * enter[k]!);
          flow.set(eid, flow.get(eid)! + dirs[k]! * xMax * enter[k]!);
        }
        remaining.set(best, remaining.get(best)! - xMax);
        produced.set(best, produced.get(best)! + xMax);
        need -= xMax * m;
        augs.push({ producer: best, x: xMax, path, enter, dirs });
      }
      if (need < EPS * Math.max(1, c.demand)) need = 0;
      if (c.allOrNothing && need > 0) {
        // Annulation : flux rendus aux arêtes et aux producteurs.
        for (const a of augs) {
          for (let k = 0; k < a.path.length; k++) {
            const eid = a.path[k]!;
            used.set(eid, used.get(eid)! - a.x * a.enter[k]!);
            flow.set(eid, flow.get(eid)! - a.dirs[k]! * a.x * a.enter[k]!);
          }
          remaining.set(a.producer, remaining.get(a.producer)! + a.x);
          produced.set(a.producer, produced.get(a.producer)! - a.x);
        }
        need = c.demand;
      }
      const got = c.demand - need;
      delivered += got;
      allocations.push({ node: c.id, demand: c.demand, delivered: got, ratio: c.demand > 0 ? got / c.demand : 1, priority: c.priority, shed: need > 0 });
    }

    let totalProduced = 0;
    const producers: NetworkReport['producers'] = [];
    for (const [pid, out] of produced) {
      const o = Math.max(0, out);
      totalProduced += o;
      producers.push({ node: pid, output: o, capacity: this.nodes.get(pid)!.capacity });
    }
    const edges: NetworkReport['edges'] = this.edgeIds().map((eid) => {
      const e = this.edges.get(eid)!;
      const f = flow.get(eid)!;
      return { edge: eid, flow: Math.abs(f) < EPS ? 0 : f, load: e.capacity > 0 ? used.get(eid)! / e.capacity : 0 };
    });
    const shedByPriority: Record<number, number> = {};
    for (const a of allocations) if (a.shed) shedByPriority[a.priority] = (shedByPriority[a.priority] ?? 0) + 1;
    allocations.sort((p, q) => p.node - q.node);
    return {
      kind: this.kind, supply, demand, delivered, produced: totalProduced, losses: Math.max(0, totalProduced - delivered),
      shortfall: Math.max(0, demand - delivered), consumers: allocations, producers, edges, shedByPriority,
    };
  }

  /* ----------------------------- Sauvegarde ----------------------------- */

  toJSON(): NetworkJSON {
    return {
      kind: this.kind, nextId: this.nextId,
      nodes: this.nodeIds().map((id) => ({ ...this.nodes.get(id)! })),
      edges: this.edgeIds().map((id) => ({ ...this.edges.get(id)! })),
    };
  }

  static fromJSON(j: NetworkJSON): ResourceNetwork {
    const n = new ResourceNetwork(j.kind);
    for (const nd of j.nodes) n.nodes.set(nd.id, { ...nd });
    for (const e of j.edges) {
      if (!n.nodes.has(e.a) || !n.nodes.has(e.b)) throw new Error(`réseau ${j.kind} : arête ${e.id} vers un nœud inconnu`);
      n.edges.set(e.id, { ...e });
    }
    let maxId = 0;
    for (const id of n.nodes.keys()) maxId = Math.max(maxId, id);
    for (const id of n.edges.keys()) maxId = Math.max(maxId, id);
    n.nextId = Math.max(j.nextId, maxId + 1);
    return n;
  }
}

/** Tas binaire minimal (priorité, nœud) : ordre (priorité, nœud) pour un résultat déterministe. */
class MinHeap {
  private readonly k: number[] = [];
  private readonly v: number[] = [];
  get size(): number { return this.k.length; }
  private less(i: number, j: number): boolean { return this.k[i]! < this.k[j]! || (this.k[i] === this.k[j] && this.v[i]! < this.v[j]!); }
  private swap(i: number, j: number): void {
    const tk = this.k[i]!, tv = this.v[i]!;
    this.k[i] = this.k[j]!; this.v[i] = this.v[j]!; this.k[j] = tk; this.v[j] = tv;
  }
  push(key: number, val: number): void {
    this.k.push(key); this.v.push(val);
    let i = this.k.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (!this.less(i, p)) break; this.swap(i, p); i = p; }
  }
  pop(): [number, number] {
    const top: [number, number] = [this.k[0]!, this.v[0]!];
    const lk = this.k.pop()!, lv = this.v.pop()!;
    if (this.k.length) {
      this.k[0] = lk; this.v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.k.length && this.less(l, m)) m = l;
        if (r < this.k.length && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m); i = m;
      }
    }
    return top;
  }
}

/** Registre des réseaux d'une partie (un par famille) et de leurs derniers bilans. */
export class Networks {
  private readonly nets = new Map<NetworkKind, ResourceNetwork>();
  private readonly reports = new Map<NetworkKind, NetworkReport>();

  get count(): number { return this.nets.size; }
  kinds(): NetworkKind[] { return [...this.nets.keys()].sort(); }
  get(kind: NetworkKind): ResourceNetwork | undefined { return this.nets.get(kind); }
  ensure(kind: NetworkKind): ResourceNetwork {
    let n = this.nets.get(kind);
    if (!n) { n = new ResourceNetwork(kind); this.nets.set(kind, n); }
    return n;
  }
  remove(kind: NetworkKind): boolean { this.reports.delete(kind); return this.nets.delete(kind); }

  /** Répartit un réseau et conserve le bilan (consultable par `lastReport`). */
  allocate(kind: NetworkKind): NetworkReport {
    const r = this.ensure(kind).allocate();
    this.reports.set(kind, r);
    return r;
  }
  lastReport(kind: NetworkKind): NetworkReport | undefined { return this.reports.get(kind); }
  allReports(): NetworkReport[] { return this.kinds().map((k) => this.reports.get(k)).filter((r): r is NetworkReport => !!r); }

  toJSON(): NetworkJSON[] { return this.kinds().map((k) => this.nets.get(k)!.toJSON()); }
  static fromJSON(list: NetworkJSON[]): Networks {
    const r = new Networks();
    for (const j of list) r.nets.set(j.kind, ResourceNetwork.fromJSON(j));
    return r;
  }
}
