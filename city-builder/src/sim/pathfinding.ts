/**
 * Pathfinding A* sur le graphe routier (coût = longueur d'arête / vitesse).
 * Tas binaire sur typed arrays. TypeScript pur, exécuté dans le worker.
 */
import { ROAD_TYPES, type RoadTypeId } from '../shared/contracts';
import type { RoadGraph } from './ecs';

export const ROAD_TYPE_ORDER: RoadTypeId[] = ['street', 'avenue', 'boulevard'];

interface Adjacency {
  /** Pour chaque index de nœud : début dans `targets`. */
  offsets: Int32Array;
  targets: Int32Array; // index de nœud
  costs: Float32Array; // secondes
}

export function buildAdjacency(g: RoadGraph): Adjacency {
  const n = g.nodeCount;
  const deg = new Int32Array(n + 1);
  for (let e = 0; e < g.edgeCount; e++) {
    const a = g.nodeIndex(g.edgeA[e]!);
    const b = g.nodeIndex(g.edgeB[e]!);
    if (a < 0 || b < 0) continue;
    deg[a + 1]!++;
    deg[b + 1]!++;
  }
  for (let i = 0; i < n; i++) deg[i + 1]! += deg[i]!;
  const offsets = deg;
  const fill = new Int32Array(n);
  const targets = new Int32Array(offsets[n]!);
  const costs = new Float32Array(offsets[n]!);
  for (let e = 0; e < g.edgeCount; e++) {
    const a = g.nodeIndex(g.edgeA[e]!);
    const b = g.nodeIndex(g.edgeB[e]!);
    if (a < 0 || b < 0) continue;
    const type = ROAD_TYPE_ORDER[g.edgeType[e]!] ?? 'street';
    const c = g.edgeLength[e]! / (ROAD_TYPES[type].speedKmh / 3.6);
    let k = offsets[a]! + fill[a]!++;
    targets[k] = b; costs[k] = c;
    k = offsets[b]! + fill[b]!++;
    targets[k] = a; costs[k] = c;
  }
  return { offsets, targets, costs };
}

/** Renvoie la liste des ids de nœuds du plus court chemin (temps), ou null si inaccessible. */
export function findPath(g: RoadGraph, fromNodeId: number, toNodeId: number, adj: Adjacency = buildAdjacency(g)): number[] | null {
  const start = g.nodeIndex(fromNodeId);
  const goal = g.nodeIndex(toNodeId);
  if (start < 0 || goal < 0) return null;
  const n = g.nodeCount;
  const gScore = new Float64Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const maxSpeed = ROAD_TYPES.boulevard.speedKmh / 3.6;
  const hx = g.nodeX[goal]!;
  const hz = g.nodeZ[goal]!;
  const h = (i: number): number => Math.hypot(g.nodeX[i]! - hx, g.nodeZ[i]! - hz) / maxSpeed;
  // tas binaire (f, index)
  let heapF = new Float64Array(64);
  let heapI = new Int32Array(64);
  let size = 0;
  const push = (f: number, i: number): void => {
    if (size === heapF.length) {
      const nf = new Float64Array(size * 2); nf.set(heapF); heapF = nf;
      const ni = new Int32Array(size * 2); ni.set(heapI); heapI = ni;
    }
    let k = size++;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heapF[p]! <= f) break;
      heapF[k] = heapF[p]!; heapI[k] = heapI[p]!; k = p;
    }
    heapF[k] = f; heapI[k] = i;
  };
  const pop = (): number => {
    const top = heapI[0]!;
    const lf = heapF[--size]!;
    const li = heapI[size]!;
    let k = 0;
    for (;;) {
      let c = 2 * k + 1;
      if (c >= size) break;
      if (c + 1 < size && heapF[c + 1]! < heapF[c]!) c++;
      if (heapF[c]! >= lf) break;
      heapF[k] = heapF[c]!; heapI[k] = heapI[c]!; k = c;
    }
    heapF[k] = lf; heapI[k] = li;
    return top;
  };
  gScore[start] = 0;
  push(h(start), start);
  while (size > 0) {
    const cur = pop();
    if (closed[cur]) continue;
    if (cur === goal) break;
    closed[cur] = 1;
    for (let k = adj.offsets[cur]!; k < adj.offsets[cur + 1]!; k++) {
      const nb = adj.targets[k]!;
      const ng = gScore[cur]! + adj.costs[k]!;
      if (ng < gScore[nb]!) {
        gScore[nb] = ng;
        came[nb] = cur;
        push(ng + h(nb), nb);
      }
    }
  }
  if (gScore[goal] === Infinity) return null;
  const path: number[] = [];
  for (let i = goal; i !== -1; i = came[i]!) path.push(g.nodeId[i]!);
  path.reverse();
  return path;
}
