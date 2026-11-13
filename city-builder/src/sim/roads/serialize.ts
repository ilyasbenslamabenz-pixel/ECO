/**
 * Sérialisation JSON versionnée du réseau routier (indépendante du moteur).
 * Les courbes sont stockées par leurs deux points de contrôle (les extrémités sont les nœuds).
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { cubic } from './bezier';
import { RoadNetwork } from './network';
import type { ProfileEnv } from './profile';
import { isRoadKind, type RoadKindId } from './types';

export const ROAD_NETWORK_FORMAT = 'aube-urbaine-roads';
export const ROAD_NETWORK_VERSION = 1;

export interface RoadNetworkJson {
  format: typeof ROAD_NETWORK_FORMAT;
  version: number;
  nextIds: { node: number; segment: number };
  /** [id, x, y, z] */
  nodes: [number, number, number, number][];
  /** id, a, b, type, points de contrôle c1 (x, z) et c2 (x, z) */
  segments: { id: number; a: number; b: number; kind: RoadKindId; c1: [number, number]; c2: [number, number]; elev?: number; ring?: [number, number, number] }[];
}

const r3 = (v: number): number => Math.round(v * 1000) / 1000;

export function serializeNetwork(net: RoadNetwork): RoadNetworkJson {
  const nodes: RoadNetworkJson['nodes'] = [];
  for (let i = 0; i < net.nodeCount; i++) nodes.push([net.nodeId[i]!, r3(net.nodeX[i]!), r3(net.nodeY[i]!), r3(net.nodeZ[i]!)]);
  const segments: RoadNetworkJson['segments'] = [];
  for (let i = 0; i < net.segCount; i++) {
    const id = net.segId[i]!;
    const c = net.curve(id);
    const seg: RoadNetworkJson['segments'][number] = { id, a: net.segA[i]!, b: net.segB[i]!, kind: net.kindOf(id), c1: [r3(c[2]!), r3(c[3]!)], c2: [r3(c[4]!), r3(c[5]!)] };
    const elev = net.elevationOf(id);
    if (elev !== 0) seg.elev = elev;
    const ring = net.ringOf(id);
    if (ring) seg.ring = [r3(ring[0]), r3(ring[1]), r3(ring[2])];
    segments.push(seg);
  }
  nodes.sort((p, q) => p[0] - q[0]);
  segments.sort((p, q) => p.id - q.id);
  return { format: ROAD_NETWORK_FORMAT, version: ROAD_NETWORK_VERSION, nextIds: { node: net.nextNodeId, segment: net.nextSegId }, nodes, segments };
}

export type DeserializeResult = { ok: true; network: RoadNetwork } | { ok: false; message: string };

/** Reconstruit un réseau ; valide la forme, les références et les types. */
export function deserializeNetwork(data: unknown, env: ProfileEnv): DeserializeResult {
  const fail = (message: string): DeserializeResult => ({ ok: false, message });
  if (typeof data !== 'object' || data === null) return fail('Réseau routier absent');
  const d = data as Partial<RoadNetworkJson>;
  if (d.format !== ROAD_NETWORK_FORMAT) return fail('Format de réseau routier non reconnu');
  if (d.version !== ROAD_NETWORK_VERSION) return fail(`Version de réseau routier ${String(d.version)} non prise en charge`);
  if (!Array.isArray(d.nodes) || !Array.isArray(d.segments) || !d.nextIds) return fail('Réseau routier incomplet');
  const net = new RoadNetwork(env, Math.max(16, d.nodes.length, d.segments.length));
  const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  for (const n of d.nodes) {
    if (!Array.isArray(n) || n.length !== 4 || !n.every(fin)) return fail('Nœud invalide');
    if (net.hasNode(n[0])) return fail(`Nœud ${n[0]} en double`);
    net.addNode(n[1], n[3], n[2], n[0]);
  }
  for (const s of d.segments) {
    if (!s || !fin(s.id) || !fin(s.a) || !fin(s.b) || !isRoadKind(s.kind)) return fail('Tronçon invalide');
    if (!net.hasNode(s.a) || !net.hasNode(s.b) || s.a === s.b) return fail(`Tronçon ${s.id} : nœuds invalides`);
    if (net.hasSegment(s.id)) return fail(`Tronçon ${s.id} en double`);
    if (!Array.isArray(s.c1) || !Array.isArray(s.c2) || ![...s.c1, ...s.c2].every(fin)) return fail(`Tronçon ${s.id} : courbe invalide`);
    const a = net.nodePos(s.a), b = net.nodePos(s.b);
    if (s.elev !== undefined && !fin(s.elev)) return fail(`Tronçon ${s.id} : hauteur invalide`);
    net.addSegment(s.a, s.b, s.kind, cubic(a.x, a.z, s.c1[0], s.c1[1], s.c2[0], s.c2[1], b.x, b.z), s.id, s.elev ?? 0);
    if (Array.isArray(s.ring) && s.ring.length === 3 && s.ring.every(fin)) net.setRing(s.id, s.ring);
  }
  for (const id of net.nodeIds()) if (net.incident(id).length === 0) return fail(`Nœud ${id} isolé`);
  net.nextNodeId = Math.max(net.nextNodeId, d.nextIds.node);
  net.nextSegId = Math.max(net.nextSegId, d.nextIds.segment);
  net.takeChanges();
  return { ok: true, network: net };
}
