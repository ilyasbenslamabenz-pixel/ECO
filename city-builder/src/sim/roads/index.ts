/**
 * Module routier de la simulation (pur TS, exécuté dans le worker) : types de routes, courbes,
 * graphe, planification (snapping, découpe, intersections, ponts), profils, nivellement,
 * intersections, pathfinding (A*, cache, HPA*), voies, sérialisation.
 */
import type { RoadEdgeRecord, RoadNodeRecord } from '../../shared/contracts';
import type { RoadNetwork } from './network';
import { bridgeRuns } from './profile';
import type { RoadKindId } from './types';

export * from './types';
export * from './bezier';
export * from './profile';
export * from './spatial';
export * from './network';
export * from './planner';
export * from './junction';
export * from './routing';
export * from './serialize';
export * from './grading';
export * from './upgrade';

/**
 * Enregistrement de tronçon ÉTENDU (proposition de contrat, voir docs/requests/routes.md) :
 * `kind` porte les 6 types de routes, `c1`/`c2` les points de contrôle de la courbe.
 * Un consommateur qui ignore ces champs voit un tronçon droit du type `type`.
 */
export interface RoadEdgeRecordEx extends RoadEdgeRecord {
  kind?: RoadKindId;
  c1?: [number, number];
  c2?: [number, number];
  /** Profil en long validé par la simulation : hauteurs (m, au cm) au pas régulier, et plages de pont [début, fin[. */
  profile?: number[];
  bridgeRuns?: number[];
}

/** Type « contrat actuel » le plus proche d'un type de route (rétro-compatibilité de `RoadEdgeRecord.type`). */
export function legacyRoadType(kind: RoadKindId): RoadEdgeRecord['type'] {
  switch (kind) {
    case 'avenue': case 'highway': return 'avenue';
    case 'boulevard': return 'boulevard';
    default: return 'street';
  }
}

/** Enregistrements (nœuds + tronçons étendus) d'un réseau, ou d'une sélection d'ids. */
export function networkRecords(net: RoadNetwork, nodeIds?: readonly number[], segIds?: readonly number[]): { nodes: RoadNodeRecord[]; edges: RoadEdgeRecordEx[] } {
  const nodes: RoadNodeRecord[] = [];
  for (const id of nodeIds ?? net.nodeIds()) {
    if (!net.hasNode(id)) continue;
    const p = net.nodePos(id);
    nodes.push({ id, x: p.x, y: p.y, z: p.z });
  }
  const edges: RoadEdgeRecordEx[] = [];
  for (const id of segIds ?? net.segmentIds()) {
    if (!net.hasSegment(id)) continue;
    const [a, b] = net.endpoints(id);
    const c = net.curve(id);
    const kind = net.kindOf(id);
    const p = net.profile(id);
    edges.push({
      id, a, b, type: legacyRoadType(kind), length: net.length(id), kind, c1: [c[2]!, c[3]!], c2: [c[4]!, c[5]!],
      profile: Array.from(p.heights, (h) => Math.round(h * 100) / 100), bridgeRuns: bridgeRuns(p),
    });
  }
  return { nodes, edges };
}
