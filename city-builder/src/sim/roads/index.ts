/**
 * Module routier de la simulation (pur TS, exécuté dans le worker) : types de routes, courbes,
 * graphe, planification (snapping, découpe, intersections, ponts), profils, nivellement,
 * intersections, pathfinding (A*, cache, HPA*), voies, sérialisation.
 */
import type { RoadEdgeRecord, RoadNodeRecord } from '../../shared/contracts';
import type { RoadNetwork } from './network';
import { bridgeRuns, tunnelRuns } from './profile';
import { wallRuns } from './sides';
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
export * from './sides';
export * from './roundabout';

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
  /** Hauteur imposée au tracé (m, multiple de 4) ; absente = 0 (au niveau du terrain). */
  elev?: number;
  /** Plages de tunnel [début, fin[ (index d'échantillons du profil). */
  tunnelRuns?: number[];
  /** Murs de soutènement : triplets [côté 0 gauche / 1 droite, début, fin[ (index d'échantillons). */
  walls?: number[];
  /** Portion d'anneau de giratoire : centre x, z et rayon de l'axe de l'anneau (m). */
  ring?: [number, number, number];
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
    const rec: RoadEdgeRecordEx = {
      id, a, b, type: legacyRoadType(kind), length: net.length(id), kind, c1: [c[2]!, c[3]!], c2: [c[4]!, c[5]!],
      profile: Array.from(p.heights, (h) => Math.round(h * 100) / 100), bridgeRuns: bridgeRuns(p),
    };
    // Champs facultatifs : absents pour une route ordinaire (sauvegardes et messages inchangés).
    const elev = net.elevationOf(id);
    if (elev !== 0) rec.elev = elev;
    const tr = tunnelRuns(p);
    if (tr.length) rec.tunnelRuns = tr;
    const wr = wallRuns(p);
    if (wr.length) rec.walls = wr;
    const ring = net.ringOf(id);
    if (ring) rec.ring = [ring[0], ring[1], ring[2]];
    edges.push(rec);
  }
  return { nodes, edges };
}
