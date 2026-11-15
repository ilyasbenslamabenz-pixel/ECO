/**
 * Tracé des lignes de bus sur le réseau routier : accroche d'un arrêt à une route (`snapStop`) et boucle par le plus
 * court chemin entre arrêts successifs (`LineRouter.route`). Réutilise le pathfinding du trafic (`RoutingGraph` +
 * `AStar` de src/sim/roads/routing.ts : sens uniques respectés, rues piétonnes exclues) sur une vue du réseau
 * construite depuis la façade en lecture seule des modules (`PluginRoads`). Le graphe est reconstruit seulement quand la
 * version du réseau change. Géométrie : polyligne sur la voie de droite, hauteur de la chaussée (ponts, tunnels).
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { ArcTable, evalCubic } from '../roads/bezier';
import { profileHeightAt } from '../roads/profile';
import { AStar, RoutingGraph } from '../roads/routing';
import { ROAD_KINDS, type RoadKindDef } from '../roads/types';
import type { RoadNetwork } from '../roads/network';
import type { PluginRoads } from '../plugins/types';

/** Distance maximale entre le point visé et la route pour poser un arrêt (m). */
export const STOP_SNAP_RADIUS = 28;
/** Pas d'échantillonnage de la géométrie (m). */
const SAMPLE_M = 8;

/** Arrêt accroché à un tronçon : abscisse curviligne `s` depuis l'extrémité a. */
export interface StopSnap { segId: number; s: number; len: number; x: number; z: number }

/** Un bus peut s'y arrêter : véhicules ET piétons admis (ni rue piétonne, ni autoroute). */
export function stopAllowed(kind: RoadKindDef): boolean { return kind.vehicles && kind.pedestrians; }

/** Accroche le point (x, z) à la route praticable la plus proche ; null si aucune à portée. */
export function snapStop(roads: PluginRoads, x: number, z: number, radius = STOP_SNAP_RADIUS, arcs?: ArcCache): StopSnap | null {
  const hit = roads.segmentNear(x, z, radius, (id) => !stopAllowed(ROAD_KINDS[roads.kindOf(id)]));
  if (!hit) return null;
  const arc = arcs ? arcs.get(roads, hit.segId) : new ArcTable(roads.curve(hit.segId));
  return { segId: hit.segId, s: arc.sAt(hit.t), len: arc.length, x: hit.x, z: hit.z };
}

/** Tables d'abscisse par tronçon (vidées à chaque version du réseau). */
export class ArcCache {
  private version = -1;
  private map = new Map<number, ArcTable>();
  get(roads: PluginRoads, segId: number): ArcTable {
    if (roads.version !== this.version) { this.version = roads.version; this.map.clear(); }
    let a = this.map.get(segId);
    if (!a) { a = new ArcTable(roads.curve(segId)); this.map.set(segId, a); }
    return a;
  }
}

/** Morceau de trajet le long d'un tronçon, de l'abscisse s0 à s1 (s1 < s0 : sens b -> a). */
interface Piece { seg: number; s0: number; s1: number }

/** Résultat du tracé d'une ligne. */
export interface LineRoute {
  /** Polyligne x, y, z (voie de droite). */
  points: number[];
  /** Abscisses cumulées de chaque point (m). */
  cum: number[];
  length: number;
  /** Abscisse de chaque arrêt sur le tracé. */
  stopS: number[];
  /** Temps de parcours à vitesse libre (s) : somme longueur / vitesse du type de route. */
  freeTimeS: number;
}

export type RouteFailure = { ok: false; stopIndex: number; reason: 'offroad' | 'unreachable' | 'few' };
export type RouteResult = { ok: true; route: LineRoute } | RouteFailure;

/** Vue « réseau » minimale lue par `RoutingGraph`, construite depuis la façade des modules. */
function networkView(roads: PluginRoads): RoadNetwork {
  const nodeIds = roads.nodeIds(), segIds = roads.segmentIds();
  const n = nodeIds.length, m = segIds.length;
  const nodeId = Int32Array.from(nodeIds), nodeX = new Float64Array(n), nodeZ = new Float64Array(n);
  for (let i = 0; i < n; i++) { const p = roads.nodePos(nodeIds[i]!); nodeX[i] = p.x; nodeZ[i] = p.z; }
  const segId = Int32Array.from(segIds), segA = new Int32Array(m), segB = new Int32Array(m), segLength = new Float64Array(m);
  for (let k = 0; k < m; k++) { const [a, b] = roads.endpoints(segIds[k]!); segA[k] = a; segB[k] = b; segLength[k] = roads.length(segIds[k]!); }
  const view = { version: roads.version, nodeCount: n, segCount: m, nodeId, nodeX, nodeZ, segId, segA, segB, segLength, kindOf: (id: number) => roads.kindOf(id) };
  return view as unknown as RoadNetwork;
}

/** Décalage vers la droite du sens de marche (m) : voie la plus à droite. */
function rightOffset(k: RoadKindDef, forward: boolean): number {
  if (k.lanesBackward === 0 || k.lanesForward === 0) {
    const nl = k.lanesForward + k.lanesBackward;
    return k.laneWidth * (nl / 2 - 0.5);
  }
  const nl = forward ? k.lanesForward : k.lanesBackward;
  return k.medianWidth / 2 + (nl - 0.5) * k.laneWidth;
}

const speedOf = (k: RoadKindDef): number => Math.max(1, k.speedKmh / 3.6);

/** Planificateur des lignes : graphe de circulation et A* partagés, reconstruits à chaque version du réseau. */
export class LineRouter {
  private version = -1;
  private graph: RoutingGraph | null = null;
  private astar: AStar | null = null;
  readonly arcs = new ArcCache();

  private ensure(roads: PluginRoads): RoutingGraph {
    if (!this.graph || this.version !== roads.version) {
      this.version = roads.version;
      this.graph = new RoutingGraph(networkView(roads), 'vehicle');
      this.astar = new AStar(this.graph);
    }
    return this.graph;
  }

  /** Segment emprunté par l'arc i -> j (le plus rapide si plusieurs). */
  private arcSeg(g: RoutingGraph, i: number, j: number): number {
    let best = -1, bc = Infinity;
    for (let k = g.offsets[i]!; k < g.offsets[i + 1]!; k++) if (g.targets[k] === j && g.costs[k]! < bc) { bc = g.costs[k]!; best = g.arcSeg[k]!; }
    return best;
  }

  /** Trajet le plus rapide d'un arrêt au suivant (morceaux, temps en s) ; null si impossible. */
  private leg(roads: PluginRoads, a: StopSnap, b: StopSnap): { pieces: Piece[]; time: number } | null {
    const g = this.ensure(roads);
    const ka = ROAD_KINDS[roads.kindOf(a.segId)], kb = ROAD_KINDS[roads.kindOf(b.segId)];
    const va = speedOf(ka), vb = speedOf(kb);
    let best: { pieces: Piece[]; time: number } | null = null;
    // Même tronçon, dans un sens permis : trajet direct.
    if (a.segId === b.segId) {
      if (b.s >= a.s && ka.lanesForward > 0) best = { pieces: [{ seg: a.segId, s0: a.s, s1: b.s }], time: (b.s - a.s) / va };
      else if (b.s < a.s && ka.lanesBackward > 0) best = { pieces: [{ seg: a.segId, s0: a.s, s1: b.s }], time: (a.s - b.s) / va };
    }
    const [aa, ab] = roads.endpoints(a.segId), [ba, bb] = roads.endpoints(b.segId);
    const exits: { node: number; time: number; piece: Piece }[] = [];
    if (ka.lanesForward > 0) exits.push({ node: ab, time: (a.len - a.s) / va, piece: { seg: a.segId, s0: a.s, s1: a.len } });
    if (ka.lanesBackward > 0) exits.push({ node: aa, time: a.s / va, piece: { seg: a.segId, s0: a.s, s1: 0 } });
    const entries: { node: number; time: number; piece: Piece }[] = [];
    if (kb.lanesForward > 0) entries.push({ node: ba, time: b.s / vb, piece: { seg: b.segId, s0: 0, s1: b.s } });
    if (kb.lanesBackward > 0) entries.push({ node: bb, time: (b.len - b.s) / vb, piece: { seg: b.segId, s0: b.len, s1: b.s } });
    for (const ex of exits) {
      const si = g.indexOf(ex.node);
      if (si < 0) continue;
      for (const en of entries) {
        const ti = g.indexOf(en.node);
        if (ti < 0) continue;
        const mid = si === ti ? 0 : this.astar!.searchIndex(si, ti);
        if (!Number.isFinite(mid)) continue;
        const time = ex.time + mid + en.time;
        if (best && time >= best.time) continue;
        const pieces: Piece[] = [ex.piece];
        if (si !== ti) {
          const path = this.astar!.readPath(ti);
          for (let k = 0; k + 1 < path.length; k++) {
            const seg = this.arcSeg(g, path[k]!, path[k + 1]!);
            if (seg < 0) continue;
            const [sa] = roads.endpoints(seg);
            const len = this.arcs.get(roads, seg).length;
            const forward = g.nodeIds[path[k]!] === sa;
            pieces.push({ seg, s0: forward ? 0 : len, s1: forward ? len : 0 });
          }
        }
        pieces.push(en.piece);
        best = { pieces, time };
      }
    }
    return best;
  }

  /** Boucle complète d'une ligne (arrêts dans l'ordre, retour au premier). */
  route(roads: PluginRoads, snaps: readonly (StopSnap | null)[]): RouteResult {
    const n = snaps.length;
    for (let i = 0; i < n; i++) if (!snaps[i]) return { ok: false, stopIndex: i, reason: 'offroad' };
    if (n < 2) return { ok: false, stopIndex: 0, reason: 'few' };
    const points: number[] = [], cum: number[] = [], stopS: number[] = [];
    let length = 0, freeTimeS = 0;
    let lx = NaN, lz = NaN;
    const push = (x: number, y: number, z: number): void => {
      if (Number.isFinite(lx)) { const d = Math.hypot(x - lx, z - lz); if (d < 0.05) return; length += d; }
      points.push(x, y, z); cum.push(length); lx = x; lz = z;
    };
    const p = new Float64Array(2), q = new Float64Array(2);
    for (let i = 0; i < n; i++) {
      const a = snaps[i]!, b = snaps[(i + 1) % n]!;
      const lg = this.leg(roads, a, b);
      if (!lg) return { ok: false, stopIndex: (i + 1) % n, reason: 'unreachable' };
      stopS.push(length);
      freeTimeS += lg.time;
      for (const pc of lg.pieces) {
        const span = Math.abs(pc.s1 - pc.s0);
        if (span < 0.01) continue;
        const arc = this.arcs.get(roads, pc.seg);
        const curve = roads.curve(pc.seg);
        const prof = roads.profile(pc.seg);
        const kind = ROAD_KINDS[roads.kindOf(pc.seg)];
        const forward = pc.s1 >= pc.s0;
        const off = rightOffset(kind, forward);
        const steps = Math.max(1, Math.ceil(span / SAMPLE_M));
        for (let k = 0; k <= steps; k++) {
          const s = pc.s0 + ((pc.s1 - pc.s0) * k) / steps;
          const t = arc.tAt(s);
          evalCubic(curve, t, p);
          // Tangente (sens de marche) par différence finie.
          const ds = forward ? 0.5 : -0.5;
          evalCubic(curve, arc.tAt(Math.max(0, Math.min(arc.length, s + ds))), q);
          let fx = q[0]! - p[0]!, fz = q[1]! - p[1]!;
          if (Math.hypot(fx, fz) < 1e-6) { evalCubic(curve, arc.tAt(Math.max(0, Math.min(arc.length, s - ds))), q); fx = p[0]! - q[0]!; fz = p[1]! - q[1]!; }
          const fl = Math.hypot(fx, fz) || 1;
          fx /= fl; fz /= fl;
          const y = profileHeightAt(prof, (s / arc.length) * prof.length) + 0.3;
          push(p[0]! - fz * off, y, p[1]! + fx * off);
        }
      }
    }
    // Fermeture de la boucle sur le premier point.
    if (points.length >= 3) push(points[0]!, points[1]!, points[2]!);
    return { ok: true, route: { points, cum, length, stopS, freeTimeS } };
  }
}
