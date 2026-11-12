/**
 * Planification et construction d'une route : snapping aux nœuds et le long d'un tronçon (découpe),
 * croisements -> intersections automatiques, validations (longueur, rayon, angle, pente max, eau / ponts,
 * chevauchement, limites, obstacles), chiffrage. `planRoad` ne modifie rien (sert au dryRun / aperçu) ;
 * `commitRoadPlan` applique un plan valide. TypeScript pur : AUCUN import de three ni du DOM.
 */
import { ArcTable, derivCubic, evalCubic, intersectCubics, minRadius, quadraticToCubic, splitCubic, straightCubic, type Cubic } from './bezier';
import type { RoadNetwork } from './network';
import { MAX_BRIDGE_LENGTH, computeProfile, localWaterLevel, profileHeightAt, profileIsBridge, type RoadProfile } from './profile';
import { ROAD_KINDS, halfWidth, type RoadKindId } from './types';

export interface Point2 { x: number; z: number }

export interface RoadRequest {
  kind: RoadKindId;
  start: Point2;
  end: Point2;
  /** Point de contrôle (courbe quadratique) ; absent = tracé droit. */
  control?: Point2;
  /** Rayon d'accrochage (m) ; défaut : max(4, demi-largeur). */
  snapRadius?: number;
}

export type PlanErrorCode = 'INVALID_ARGS' | 'OUT_OF_BOUNDS' | 'COLLISION' | 'TOO_STEEP' | 'UNDER_WATER' | 'NOT_IMPLEMENTED';
export interface PlanError { code: PlanErrorCode; message: string; phase?: number }

export type Snap =
  | { type: 'node'; nodeId: number; x: number; z: number }
  | { type: 'segment'; segId: number; t: number; x: number; z: number }
  | { type: 'free'; x: number; z: number };

export interface Crossing { segId: number; tExisting: number; tNew: number; x: number; z: number; nodeId: number }

export interface RoadPlan {
  kind: RoadKindId;
  curve: Cubic;
  length: number;
  bridgeLength: number;
  cost: number;
  start: Snap;
  end: Snap;
  /** Points de découpe intermédiaires (croisements), triés le long du nouveau tracé. */
  crossings: Crossing[];
  /** Profils calculés des futurs tronçons (pour l'aperçu). */
  pieceProfiles: RoadProfile[];
  networkVersion: number;
}

export interface PlanOptions {
  bounds?: { minX: number; minZ: number; maxX: number; maxZ: number };
  /** Obstacle (bâtiments…) : renvoie un message si le tracé est bloqué. */
  blocked?: (curve: Cubic, halfWidth: number) => string | null;
}

export type PlanResult = { ok: true; plan: RoadPlan } | { ok: false; error: PlanError };

const MIN_ROAD_LENGTH = 8;
const MIN_PIECE_LENGTH = 4;
const MIN_CROSS_ANGLE = (22 * Math.PI) / 180;
const MIN_JOIN_ANGLE = (25 * Math.PI) / 180;

const err = (code: PlanErrorCode, message: string, phase?: number): { ok: false; error: PlanError } =>
  ({ ok: false, error: phase === undefined ? { code, message } : { code, message, phase } });

function snapPoint(net: RoadNetwork, p: Point2, radius: number): Snap {
  const n = net.nodeNear(p.x, p.z, radius);
  if (n >= 0) { const q = net.nodePos(n); return { type: 'node', nodeId: n, x: q.x, z: q.z }; }
  const s = net.segmentNear(p.x, p.z, radius);
  if (s) {
    // Près d'une extrémité du tronçon : on préfère le nœud.
    const arc = net.arc(s.segId);
    const sAt = arc.sAt(s.t);
    const [a, b] = net.endpoints(s.segId);
    if (sAt < radius * 1.5) { const q = net.nodePos(a); return { type: 'node', nodeId: a, x: q.x, z: q.z }; }
    if (arc.length - sAt < radius * 1.5) { const q = net.nodePos(b); return { type: 'node', nodeId: b, x: q.x, z: q.z }; }
    return { type: 'segment', segId: s.segId, t: s.t, x: s.x, z: s.z };
  }
  return { type: 'free', x: p.x, z: p.z };
}

/** Angle (rad) entre deux directions non orientées. */
function lineAngle(ax: number, az: number, bx: number, bz: number): number {
  const c = Math.abs(ax * bx + az * bz) / (Math.hypot(ax, az) * Math.hypot(bx, bz) || 1);
  return Math.acos(Math.min(1, c));
}

/** Direction sortante d'un tronçon depuis un de ses nœuds. */
export function outgoingDir(net: RoadNetwork, segId: number, nodeId: number): [number, number] {
  const c = net.curve(segId);
  const [a] = net.endpoints(segId);
  const d = new Float64Array(2);
  if (a === nodeId) { derivCubic(c, 0, d); return norm(d[0]!, d[1]!); }
  derivCubic(c, 1, d);
  return norm(-d[0]!, -d[1]!);
}

function norm(x: number, z: number): [number, number] {
  const l = Math.hypot(x, z) || 1;
  return [x / l, z / l];
}

function snapHeight(net: RoadNetwork, s: Snap): number {
  if (s.type === 'node') return net.nodePos(s.nodeId).y;
  if (s.type === 'segment') return profileHeightAt(net.profile(s.segId), net.arc(s.segId).sAt(s.t));
  return net.env.heightAt(s.x, s.z);
}

export function planRoad(net: RoadNetwork, req: RoadRequest, opts: PlanOptions = {}): PlanResult {
  const kind = ROAD_KINDS[req.kind];
  if (!kind) return err('INVALID_ARGS', 'Type de route inconnu');
  const hw = halfWidth(req.kind);
  const radius = req.snapRadius ?? Math.max(4, hw);
  let start = snapPoint(net, req.start, radius);
  let end = snapPoint(net, req.end, radius);
  if (start.type === 'node' && end.type === 'node' && start.nodeId === end.nodeId) return err('INVALID_ARGS', 'Le tracé revient sur son point de départ');

  const buildCurve = (): Cubic => (req.control
    ? quadraticToCubic(start.x, start.z, req.control.x, req.control.z, end.x, end.z)
    : straightCubic(start.x, start.z, end.x, end.z));
  let curve = buildCurve();
  let arc = new ArcTable(curve);
  if (arc.length < MIN_ROAD_LENGTH) return err('INVALID_ARGS', `Tracé trop court (${MIN_ROAD_LENGTH} m minimum)`);
  const r = minRadius(curve);
  if (r < kind.minRadius * 0.95) return err('INVALID_ARGS', `Virage trop serré : rayon ${Math.round(r)} m, minimum ${kind.minRadius} m pour ce type`);

  // Limites de la carte.
  if (opts.bounds) {
    const b = opts.bounds;
    const p = new Float64Array(2);
    for (let i = 0; i <= 32; i++) {
      evalCubic(curve, i / 32, p);
      if (p[0]! < b.minX + hw || p[1]! < b.minZ + hw || p[0]! > b.maxX - hw || p[1]! > b.maxZ - hw) return err('OUT_OF_BOUNDS', 'Tracé hors de la carte');
    }
  }

  // Croisements avec le réseau existant.
  const [x0, z0, x1, z1] = [Math.min(curve[0]!, curve[2]!, curve[4]!, curve[6]!), Math.min(curve[1]!, curve[3]!, curve[5]!, curve[7]!),
    Math.max(curve[0]!, curve[2]!, curve[4]!, curve[6]!), Math.max(curve[1]!, curve[3]!, curve[5]!, curve[7]!)];
  const near = net.segmentsIn(x0 - 1, z0 - 1, x1 + 1, z1 + 1, []);
  const touchesEnd = (snap: Snap, segId: number): boolean => {
    if (snap.type === 'segment') return snap.segId === segId;
    if (snap.type === 'node') return net.incident(snap.nodeId).includes(segId);
    return false;
  };
  let crossings: Crossing[] = [];
  for (const sid of near) {
    const other = net.curve(sid);
    for (const hit of intersectCubics(curve, other)) {
      const sNew = arc.sAt(hit.ta);
      // Intersection à une extrémité déjà accrochée à ce tronçon : ce n'est pas un croisement.
      if ((sNew < radius + 1 && touchesEnd(start, sid)) || (arc.length - sNew < radius + 1 && touchesEnd(end, sid))) continue;
      crossings.push({ segId: sid, tExisting: hit.tb, tNew: hit.ta, x: hit.x, z: hit.z, nodeId: -1 });
    }
  }
  crossings.sort((a, b) => a.tNew - b.tNew);

  // Croisement tout près d'une extrémité libre : l'extrémité s'accroche au croisement.
  const otherHw = (sid: number): number => halfWidth(net.kindOf(sid));
  if (crossings.length) {
    const first = crossings[0]!;
    if (start.type === 'free' && arc.sAt(first.tNew) < Math.max(radius, otherHw(first.segId)) * 1.5) {
      start = { type: 'segment', segId: first.segId, t: first.tExisting, x: first.x, z: first.z };
      crossings.shift();
    }
  }
  if (crossings.length) {
    const last = crossings[crossings.length - 1]!;
    if (end.type === 'free' && arc.length - arc.sAt(last.tNew) < Math.max(radius, otherHw(last.segId)) * 1.5) {
      end = { type: 'segment', segId: last.segId, t: last.tExisting, x: last.x, z: last.z };
      crossings.pop();
    }
  }
  if (start.type === 'segment' && end.type === 'segment' && start.segId === end.segId && Math.abs(start.t - end.t) < 1e-3) {
    return err('INVALID_ARGS', 'Le tracé revient sur son point de départ');
  }
  // Recalcule la courbe si les extrémités ont bougé (les paramètres tNew sont recalculés).
  curve = buildCurve();
  arc = new ArcTable(curve);
  if (arc.length < MIN_ROAD_LENGTH) return err('INVALID_ARGS', `Tracé trop court (${MIN_ROAD_LENGTH} m minimum)`);
  const recomputed: Crossing[] = [];
  for (const c of crossings) {
    const hits = intersectCubics(curve, net.curve(c.segId)).filter((h) => Math.abs(h.tb - c.tExisting) < 0.05);
    const h = hits[0];
    if (h) recomputed.push({ ...c, tNew: h.ta, tExisting: h.tb, x: h.x, z: h.z });
  }
  crossings = recomputed.sort((a, b) => a.tNew - b.tNew);

  // Croisements près d'un nœud existant du tronçon croisé : on réutilise le nœud.
  for (const c of crossings) {
    const oarc = net.arc(c.segId);
    const s = oarc.sAt(c.tExisting);
    const [a, b] = net.endpoints(c.segId);
    const snapD = Math.max(radius, otherHw(c.segId));
    if (s < snapD) c.nodeId = a;
    else if (oarc.length - s < snapD) c.nodeId = b;
  }
  // Passage par un carrefour existant : plusieurs tronçons croisés au même nœud -> un seul point.
  {
    const startNode = start.type === 'node' ? start.nodeId : -9, endNode = end.type === 'node' ? end.nodeId : -9;
    const seen = new Set<number>();
    crossings = crossings.filter((c) => {
      if (c.nodeId < 0) return true;
      if (c.nodeId === startNode || c.nodeId === endNode || seen.has(c.nodeId)) return false;
      seen.add(c.nodeId);
      const q = net.nodePos(c.nodeId);
      c.x = q.x; c.z = q.z;
      return true;
    });
  }

  // Règles des croisements : à niveau autorisé, angle suffisant, pas sur un pont.
  const dNew = new Float64Array(2), dOld = new Float64Array(2);
  for (const c of crossings) {
    const ok = net.kindOf(c.segId);
    if (!kind.atGradeCrossing || !ROAD_KINDS[ok].atGradeCrossing) {
      return err('NOT_IMPLEMENTED', 'Croisement d\'autoroute : les échangeurs et passages dénivelés arrivent en phase 4', 4);
    }
    derivCubic(curve, c.tNew, dNew);
    derivCubic(net.curve(c.segId), c.tExisting, dOld);
    if (lineAngle(dNew[0]!, dNew[1]!, dOld[0]!, dOld[1]!) < MIN_CROSS_ANGLE) return err('COLLISION', 'Croisement trop rasant avec une route existante');
    if (c.nodeId < 0 && profileIsBridge(net.profile(c.segId), net.arc(c.segId).sAt(c.tExisting))) {
      return err('COLLISION', 'Impossible de créer un carrefour sur un pont');
    }
  }
  // Raccord aux extrémités : type compatible et angle avec les branches existantes.
  for (const [snap, t] of [[start, 0], [end, 1]] as const) {
    if (snap.type === 'free') continue;
    derivCubic(curve, t, dNew);
    const dirX = t === 0 ? dNew[0]! : -dNew[0]!, dirZ = t === 0 ? dNew[1]! : -dNew[1]!;
    const segs = snap.type === 'node' ? net.incident(snap.nodeId) : [snap.segId];
    for (const sid of segs) {
      const ok = net.kindOf(sid);
      if ((!kind.atGradeCrossing || !ROAD_KINDS[ok].atGradeCrossing) && ok !== req.kind) {
        return err('NOT_IMPLEMENTED', 'Raccord à une autoroute : les bretelles et échangeurs arrivent en phase 4', 4);
      }
      if (snap.type === 'segment') {
        derivCubic(net.curve(sid), snap.t, dOld);
        if (lineAngle(dirX, dirZ, dOld[0]!, dOld[1]!) < MIN_JOIN_ANGLE) return err('COLLISION', 'Angle de raccord trop aigu');
      } else {
        const [ox, oz] = outgoingDir(net, sid, snap.nodeId);
        const ang = Math.acos(Math.max(-1, Math.min(1, (dirX * ox + dirZ * oz) / (Math.hypot(dirX, dirZ) || 1))));
        if (ang < MIN_JOIN_ANGLE) return err('COLLISION', 'Angle de raccord trop aigu avec une route existante');
      }
      if (snap.type === 'segment' && profileIsBridge(net.profile(sid), net.arc(sid).sAt(snap.t))) {
        return err('COLLISION', 'Impossible de se raccorder sur un pont');
      }
    }
    if (snap.type === 'node' && net.incident(snap.nodeId).length >= 6) return err('COLLISION', 'Trop de branches sur ce carrefour (6 maximum)');
  }

  // Points de découpe du nouveau tracé : départ, croisements, arrivée.
  const cuts: { t: number; x: number; z: number; h: number }[] = [{ t: 0, x: start.x, z: start.z, h: snapHeight(net, start) }];
  for (const c of crossings) {
    const h = c.nodeId >= 0 ? net.nodePos(c.nodeId).y : profileHeightAt(net.profile(c.segId), net.arc(c.segId).sAt(c.tExisting));
    cuts.push({ t: c.tNew, x: c.x, z: c.z, h });
  }
  cuts.push({ t: 1, x: end.x, z: end.z, h: snapHeight(net, end) });
  for (let i = 1; i < cuts.length; i++) {
    if (arc.sAt(cuts[i]!.t) - arc.sAt(cuts[i - 1]!.t) < MIN_PIECE_LENGTH) return err('COLLISION', 'Trop près d\'un carrefour existant');
  }
  // Extrémités libres dans l'eau.
  for (const s of [start, end]) {
    if (s.type === 'free' && net.env.heightAt(s.x, s.z) < localWaterLevel(net.env, s.x, s.z) + 0.3) return err('UNDER_WATER', 'Une route ne peut pas commencer ou finir dans l\'eau');
  }

  // Chevauchement d'une route existante (hors voisinage des points de raccord).
  {
    const p = new Float64Array(2);
    const n = Math.max(2, Math.ceil(arc.length / 3));
    const tmp: number[] = [];
    for (let i = 0; i <= n; i++) {
      evalCubic(curve, arc.tAt((i / n) * arc.length), p);
      const px = p[0]!, pz = p[1]!;
      net.segmentsIn(px - hw, pz - hw, px + hw, pz + hw, tmp);
      for (const sid of tmp) {
        const ohw = otherHw(sid);
        const clear = (hw + ohw) * 1.7 + 4;
        if (cuts.some((c) => Math.hypot(c.x - px, c.z - pz) < clear)) continue;
        const hit = net.segmentNear(px, pz, hw + ohw - 0.5, (id) => id !== sid);
        if (hit) return err('COLLISION', 'Le tracé chevauche une route existante');
      }
    }
  }

  // Profils en long des futurs tronçons : pente, ponts.
  const pieceProfiles: RoadProfile[] = [];
  let bridgeLength = 0;
  let rest = curve, tDone = 0;
  for (let i = 1; i < cuts.length; i++) {
    const tA = cuts[i - 1]!.t, tB = cuts[i]!.t;
    let piece: Cubic;
    if (i === cuts.length - 1) piece = rest;
    else {
      const local = (tB - tDone) / (1 - tDone);
      const [l, rr] = splitCubic(rest, local);
      piece = l; rest = rr; tDone = tB;
    }
    void tA;
    const parc = new ArcTable(piece);
    const prof = computeProfile(piece, parc, cuts[i - 1]!.h, cuts[i]!.h, kind.maxGrade, net.env);
    if (prof.maxGrade > kind.maxGrade * 1.05) return err('TOO_STEEP', `Pente trop forte : ${Math.round(prof.maxGrade * 100)} % (maximum ${Math.round(kind.maxGrade * 100)} %)`);
    if (prof.longestBridge > MAX_BRIDGE_LENGTH) return err('UNDER_WATER', `Pont trop long (${Math.round(prof.longestBridge)} m, maximum ${MAX_BRIDGE_LENGTH} m)`);
    if (prof.wet) return err('UNDER_WATER', 'Le tracé passe sous le niveau de l\'eau');
    for (let k = 0; k < prof.count; k++) {
      if (prof.ground[k]! < net.env.waterLevel + 0.4 && prof.heights[k]! < net.env.waterLevel + 2) {
        return err('UNDER_WATER', 'Pas assez de longueur pour monter le pont au-dessus de l\'eau');
      }
    }
    bridgeLength += prof.bridgeLength;
    pieceProfiles.push(prof);
  }

  if (opts.blocked) {
    const msg = opts.blocked(curve, hw);
    if (msg) return err('COLLISION', msg);
  }

  const cost = Math.round(arc.length * kind.costPerMeter + bridgeLength * kind.costPerMeter * (kind.bridgeCostFactor - 1));
  return { ok: true, plan: { kind: req.kind, curve, length: arc.length, bridgeLength, cost, start, end, crossings, pieceProfiles, networkVersion: net.version } };
}

export interface CommitResult {
  /** Tronçons du nouveau tracé, dans l'ordre. */
  segmentIds: number[];
  /** Nœuds du nouveau tracé, dans l'ordre (départ, carrefours, arrivée). */
  nodeIds: number[];
}

/** Applique un plan valide (calculé sur la même version du réseau). */
export function commitRoadPlan(net: RoadNetwork, plan: RoadPlan): CommitResult {
  if (plan.networkVersion !== net.version) throw new Error('Plan de route périmé : le réseau a changé');
  // 1) Découpes des tronçons existants, groupées par tronçon (t décroissants).
  interface SplitReq { t: number; key: number }
  const bySeg = new Map<number, SplitReq[]>();
  const nodeFor = new Map<number, number>(); // clé -> id de nœud
  const addSplit = (segId: number, t: number, key: number): void => {
    let l = bySeg.get(segId);
    if (!l) { l = []; bySeg.set(segId, l); }
    l.push({ t, key });
  };
  const KEY_START = -1, KEY_END = -2;
  if (plan.start.type === 'segment') addSplit(plan.start.segId, plan.start.t, KEY_START);
  if (plan.end.type === 'segment') addSplit(plan.end.segId, plan.end.t, KEY_END);
  plan.crossings.forEach((c, i) => {
    if (c.nodeId >= 0) nodeFor.set(i, c.nodeId);
    else addSplit(c.segId, c.tExisting, i);
  });
  for (const [segId, list] of bySeg) {
    list.sort((a, b) => b.t - a.t);
    let cur = segId, tScale = 1;
    for (const s of list) {
      const local = s.t / tScale;
      const r = net.splitSegment(cur, Math.min(0.999, Math.max(0.001, local)));
      nodeFor.set(s.key, r.nodeId);
      cur = r.first; tScale = s.t;
    }
  }
  // 2) Nœuds du nouveau tracé.
  const nodeOf = (snap: Snap, key: number): number => {
    if (snap.type === 'node') return snap.nodeId;
    if (snap.type === 'segment') return nodeFor.get(key)!;
    return net.addNode(snap.x, snap.z);
  };
  const nodes: number[] = [nodeOf(plan.start, KEY_START)];
  plan.crossings.forEach((_, i) => nodes.push(nodeFor.get(i)!));
  nodes.push(nodeOf(plan.end, KEY_END));
  // 3) Tronçons du nouveau tracé.
  const ts = [0, ...plan.crossings.map((c) => c.tNew), 1];
  const segmentIds: number[] = [];
  let rest = plan.curve, tDone = 0;
  for (let i = 1; i < ts.length; i++) {
    let piece: Cubic;
    if (i === ts.length - 1) piece = rest;
    else {
      const [l, r] = splitCubic(rest, (ts[i]! - tDone) / (1 - tDone));
      piece = l; rest = r; tDone = ts[i]!;
    }
    const a = nodes[i - 1]!, b = nodes[i]!;
    if (a === b) continue;
    // Pas de doublon exact (même paire de nœuds, même type).
    if (net.incident(a).some((s) => { const [p, q] = net.endpoints(s); return ((p === a && q === b) || (p === b && q === a)) && net.length(s) < new ArcTable(piece).length * 1.05; })) continue;
    segmentIds.push(net.addSegment(a, b, plan.kind, piece));
  }
  return { segmentIds, nodeIds: nodes };
}
