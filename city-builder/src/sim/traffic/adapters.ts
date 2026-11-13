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
import { evalCubic, profileHeightAt, ROAD_KINDS, ROAD_KIND_ORDER, type RoadNetwork } from '../roads/index';
import type { TrafficEdgeInput, TrafficNetworkInput } from './network';
import type { TrafficBuilding } from './system';

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

/** Échantillonne les tronçons courbes du module routes (pas ≈ 6 m, hauteurs du profil en long). */
export function inputFromRoadNetwork(net: RoadNetwork, step = 6): TrafficNetworkInput {
  const nodes = [];
  for (let i = 0; i < net.nodeCount; i++) nodes.push({ id: net.nodeId[i]!, x: net.nodeX[i]!, y: net.nodeY[i]!, z: net.nodeZ[i]! });
  const edges: TrafficEdgeInput[] = [];
  const p = new Float64Array(2);
  for (let k = 0; k < net.segCount; k++) {
    const id = net.segId[k]!;
    const kindId = ROAD_KIND_ORDER[net.segKind[k]!]!;
    const kind = ROAD_KINDS[kindId];
    if (!kind.vehicles) continue;
    const curve = net.curve(id);
    const arc = net.arc(id);
    const prof = net.profile(id);
    const n = Math.max(1, Math.ceil(arc.length / step));
    const pts: number[] = [];
    for (let i = 0; i <= n; i++) {
      const s = (arc.length * i) / n;
      evalCubic(curve, arc.tAt(s), p);
      pts.push(p[0]!, profileHeightAt(prof, s), p[1]!);
    }
    edges.push({
      id, a: net.segA[k]!, b: net.segB[k]!, points: pts,
      lanesForward: kind.lanesForward, lanesBackward: kind.lanesBackward, laneWidth: kind.laneWidth, median: kind.medianWidth,
      speedKmh: kind.speedKmh, rank: RANK[kindId] ?? 0,
    });
  }
  return { nodes, edges };
}

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
