/**
 * Adaptateurs : stockages du monde -> descriptions neutres du trafic.
 *  - `inputFromRoadGraph` : graphe routier actuel de la simulation (src/sim/ecs.ts, tronçons droits, 3 types) ;
 *  - `inputFromRoadNetwork` : réseau courbe du module routes (src/sim/roads, Bézier + profils en long, 6 types) ;
 *  - `buildingsFromStore` : bâtiments posés (BuildingStore + catalogue) avec leur point d'accès en façade.
 * TypeScript pur.
 */
import { buildAssetIndex, type AssetCatalog } from '../../shared/catalog';
import { ROAD_TYPES } from '../../shared/contracts';
import { rotAngle } from '../../shared/footprint';
import type { BuildingStore, RoadGraph } from '../ecs';
import { ROAD_TYPE_ORDER } from '../pathfinding';
import { evalCubic, profileHeightAt, ROAD_KINDS, ROAD_KIND_ORDER, type ArcTable, type RoadNetwork, type RoadProfile } from '../roads/index';
import { computeJunction, segmentTrims, type JunctionInfo } from '../roads/junction';
import { carriagewayWidth } from '../roads/types';
import type { TrafficEdgeInput, TrafficNetworkInput } from './network';
import type { TrafficBuilding } from './system';

/** Anneau de giratoire (module routes) : prioritaire, les entrées cèdent le passage. */
export const RING_RANK = 4;
const RANK: Record<string, number> = { street: 0, oneway: 0, pedestrian: 0, avenue: 1, boulevard: 2, highway: 3 };

export function inputFromRoadGraph(g: RoadGraph): TrafficNetworkInput {
  const nodes = [];
  for (let i = 0; i < g.nodeCount; i++) nodes.push({ id: g.nodeId[i]!, x: g.nodeX[i]!, y: g.nodeY[i]!, z: g.nodeZ[i]! });
  const edges: TrafficEdgeInput[] = [];
  for (let e = 0; e < g.edgeCount; e++) {
    const ia = g.nodeIndex(g.edgeA[e]!), ib = g.nodeIndex(g.edgeB[e]!);
    if (ia < 0 || ib < 0) continue;
    const type = ROAD_TYPE_ORDER[g.edgeType[e]!] ?? 'street';
    const def = ROAD_TYPES[type];
    const lanes = def.lanesPerDirection;
    const laneWidth = 3.25;
    const median = Math.max(0, def.width - 5 - lanes * 2 * laneWidth);
    edges.push({
      id: g.edgeId[e]!, a: g.edgeA[e]!, b: g.edgeB[e]!,
      points: [g.nodeX[ia]!, g.nodeY[ia]!, g.nodeZ[ia]!, g.nodeX[ib]!, g.nodeY[ib]!, g.nodeZ[ib]!],
      lanesForward: lanes, lanesBackward: lanes, laneWidth, median, speedKmh: def.speedKmh, rank: RANK[type] ?? 0,
    });
  }
  return { nodes, edges };
}

/** Distance (m) du recul de carrefour au centre du passage piéton peint, et à la ligne d'arrêt (mêmes cotes que src/render/roads/builder.ts). */
export const CROSSWALK_CENTER = 2.8;
export const STOP_LINE_SIDEWALK = 5.6;
export const STOP_LINE_PLAIN = 1.5;
/** Longueur minimale de chaussée (entre reculs) pour que le rendu peigne passages et lignes d'arrêt. */
export const MARKINGS_MIN_LENGTH = 14;

/**
 * Échantillonne les tronçons courbes du module routes (pas ≈ 6 m, hauteurs du profil en long).
 * Les lignes d'arrêt et les passages piétons sont placés aux MÊMES cotes que les marquages peints par le rendu
 * (recul du carrefour + 5,6 m / + 2,8 m) : les véhicules s'arrêtent avant le passage dessiné.
 */
export function inputFromRoadNetwork(net: RoadNetwork, step = 6, cache?: RoadInputCache): TrafficNetworkInput {
  const junctions = new Map<number, JunctionInfo>();
  if (cache) {
    // Carrefours : repris tant que les tronçons incidents (instances, dans l'ordre) sont les mêmes.
    if (cache.step !== step) { cache.junctions.clear(); cache.edges.clear(); cache.step = step; }
    for (let i = 0; i < net.nodeCount; i++) {
      const nid = net.nodeId[i]!;
      const inc = net.incident(nid);
      const hit = cache.junctions.get(nid);
      let ok = !!hit && hit.arcs.length === inc.length;
      for (let j = 0; ok && j < inc.length; j++) ok = hit!.arcs[j] === net.arc(inc[j]!);
      if (ok) junctions.set(nid, hit!.info);
      else {
        const info = computeJunction(net, nid);
        junctions.set(nid, info);
        cache.junctions.set(nid, { arcs: inc.map((s) => net.arc(s)), info });
      }
    }
    if (cache.junctions.size > net.nodeCount) for (const k of cache.junctions.keys()) if (!net.hasNode(k)) cache.junctions.delete(k);
  }
  const nodes = [];
  for (let i = 0; i < net.nodeCount; i++) nodes.push({ id: net.nodeId[i]!, x: net.nodeX[i]!, y: net.nodeY[i]!, z: net.nodeZ[i]! });
  const edges: TrafficEdgeInput[] = [];
  const p = new Float64Array(2);
  for (let k = 0; k < net.segCount; k++) {
    const id = net.segId[k]!;
    const kindId = ROAD_KIND_ORDER[net.segKind[k]!]!;
    const kind = ROAD_KINDS[kindId];
    if (!kind.vehicles) continue;
    const arc = net.arc(id);
    const prof = net.profile(id);
    const ring = net.ringOf(id);
    const tr = segmentTrims(net, id, junctions);
    if (cache) {
      // Tronçon inchangé (même instance, même profil, même anneau, mêmes reculs) : même entrée (même objet),
      // que le graphe de circulation reconnaît par identité.
      const hit = cache.edges.get(id);
      if (hit && hit.arc === arc && hit.profile === prof && hit.ring === (ring ? `${ring[0]},${ring[1]},${ring[2]}` : '')
        && hit.start === tr.start && hit.end === tr.end && hit.startType === tr.startType && hit.endType === tr.endType) {
        edges.push(hit.edge);
        continue;
      }
    }
    const curve = net.curve(id);
    const n = Math.max(1, Math.ceil(arc.length / step));
    const pts: number[] = [];
    for (let i = 0; i <= n; i++) {
      const s = (arc.length * i) / n;
      evalCubic(curve, arc.tAt(s), p);
      pts.push(p[0]!, profileHeightAt(prof, s), p[1]!);
    }
    const edge: TrafficEdgeInput = {
      id, a: net.segA[k]!, b: net.segB[k]!, points: pts,
      lanesForward: kind.lanesForward, lanesBackward: kind.lanesBackward, laneWidth: kind.laneWidth, median: kind.medianWidth,
      speedKmh: kind.speedKmh, rank: ring ? RING_RANK : RANK[kindId] ?? 0, crossHalf: carriagewayWidth(kind) / 2,
    };
    const L = arc.length;
    const s0 = Math.min(tr.start, L * 0.49), s1 = Math.max(L - tr.end, L * 0.51);
    const marked = s1 - s0 >= MARKINGS_MIN_LENGTH;
    const walk = kind.pedestrians && kind.sidewalk > 0;
    const stopOff = marked ? (kind.sidewalk > 0 ? STOP_LINE_SIDEWALK : STOP_LINE_PLAIN) : 0.5;
    if (tr.startType === 'junction') { edge.stopA = s0 + stopOff; edge.crossA = marked && walk ? s0 + CROSSWALK_CENTER : -1; }
    if (tr.endType === 'junction') { edge.stopB = L - s1 + stopOff; edge.crossB = marked && walk ? L - s1 + CROSSWALK_CENTER : -1; }
    edges.push(edge);
    if (cache) cache.edges.set(id, { arc, profile: prof, ring: ring ? `${ring[0]},${ring[1]},${ring[2]}` : '', start: tr.start, end: tr.end, startType: tr.startType, endType: tr.endType, edge });
  }
  if (cache && cache.edges.size > net.segCount) for (const k of cache.edges.keys()) if (!net.hasSegment(k)) cache.edges.delete(k);
  return { nodes, edges };
}

/**
 * Mémoire de la conversion réseau routier -> circulation (`inputFromRoadNetwork`), conservée par le monde d'un appel
 * à l'autre : reculs des carrefours (par nœud, tant que les tronçons incidents sont les mêmes instances) et entrée de
 * chaque tronçon (même instance — table d'abscisses —, même profil en long, même anneau, mêmes reculs). Un tronçon
 * inchangé redonne le MÊME objet d'entrée : le graphe de circulation reconnaît ainsi par identité les carrefours
 * intacts. Résultat identique à une conversion sans mémoire (test « graphe incrémental »).
 */
export interface RoadInputCache {
  step: number;
  junctions: Map<number, { arcs: ArcTable[]; info: JunctionInfo }>;
  edges: Map<number, { arc: ArcTable; profile: RoadProfile; ring: string; start: number; end: number; startType: string; endType: string; edge: TrafficEdgeInput }>;
}
export function createRoadInputCache(): RoadInputCache { return { step: 6, junctions: new Map(), edges: new Map() }; }

/** Bâtiments posés -> entrées du trafic (accès = premier point de façade du catalogue, rotation appliquée). */
export function buildingsFromStore(b: BuildingStore, cat: AssetCatalog): TrafficBuilding[] {
  const out: TrafficBuilding[] = [];
  void buildAssetIndex;
  for (let i = 0; i < b.count; i++) {
    const a = cat.assets[b.assetIndex[i]!];
    if (!a) continue;
    const f = a.frontage[0];
    // rotation par quarts de tour autour de Y (même convention que le rendu des bâtiments)
    const th = rotAngle(b.rot[i]!);
    const c = Math.cos(th), s = Math.sin(th);
    const lx = f ? f.x : 0, lz = f ? f.z + 1 : a.dimensions.depth / 2 + 1;
    out.push({
      id: b.id[i]!, assetId: a.id, category: a.category, residents: a.capacity.residents, jobs: a.capacity.jobs,
      x: b.x[i]! + lx * c + lz * s, z: b.z[i]! - lx * s + lz * c,
    });
  }
  return out;
}
