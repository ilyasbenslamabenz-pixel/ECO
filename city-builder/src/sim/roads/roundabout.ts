/**
 * Giratoires posés d'un clic sur un carrefour ou sur une route : les branches sont coupées sur le cercle, leurs
 * parties intérieures supprimées, puis un anneau à sens unique (circulation à droite : sens antihoraire vu du
 * dessus, nord en haut) relie les points d'entrée. L'îlot central est dessiné par le rendu (tronçons marqués
 * `ring` : centre et rayon). `planRoundabout` ne modifie rien (aperçu, dryRun) ; `commitRoundabout` applique.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { ArcTable, closestOnCubic, evalCubic, type Cubic } from './bezier';
import type { RoadNetwork } from './network';
import type { PlanError, PlanOptions } from './planner';
import { profileIsBridge, profileIsTunnel } from './profile';
import { ROAD_KINDS, halfWidth } from './types';

export type RoundaboutSize = 'small' | 'large';
/** Rayon de l'axe de l'anneau (m). */
export const ROUNDABOUT_RADIUS: Record<RoundaboutSize, number> = { small: 18, large: 28 };
/** Type de route de l'anneau (sens unique, 2 voies, trottoirs). */
export const RING_KIND = 'oneway' as const;
/** Longueur minimale d'une branche restant au-delà de l'anneau (m). */
const MIN_ARM_REST = 10;

export interface RoundaboutRequest { x: number; z: number; size: RoundaboutSize }

interface ArmCut { segId: number; fromA: boolean; t: number; x: number; z: number; angle: number }

export interface RoundaboutPlan {
  cx: number;
  cz: number;
  r: number;
  /** Carrefour existant au centre, ou tronçon coupé au centre (t). */
  center: { type: 'node'; nodeId: number } | { type: 'segment'; segId: number; t: number };
  arms: ArmCut[];
  ringLength: number;
  cost: number;
  networkVersion: number;
}

export type RoundaboutResult = { ok: true; plan: RoundaboutPlan } | { ok: false; error: PlanError };

const fail = (message: string, code: PlanError['code'] = 'COLLISION'): RoundaboutResult => ({ ok: false, error: { code, message } });

/** Paramètre t où la courbe s'éloigne à la distance r de (cx, cz), en partant de l'extrémité a (fromA) ou b. */
function cutOnCircle(c: Cubic, arc: ArcTable, fromA: boolean, cx: number, cz: number, r: number): number | null {
  const p = new Float64Array(2);
  const dist = (s: number): number => { evalCubic(c, arc.tAt(s), p); return Math.hypot(p[0]! - cx, p[1]! - cz); };
  const L = arc.length;
  let prev = fromA ? 0 : L;
  for (let k = 1; k <= Math.ceil(L); k++) {
    const s = fromA ? Math.min(L, k) : Math.max(0, L - k);
    if (dist(s) >= r) {
      let lo = prev, hi = s;
      for (let it = 0; it < 30; it++) { const m = (lo + hi) / 2; if (dist(m) >= r) hi = m; else lo = m; }
      return arc.tAt(hi);
    }
    prev = s;
  }
  return null;
}

/** Arc de cercle (sens décroissant des angles) en Bézier cubique, |θ0 − θ1| ≤ 90°. */
export function ringArc(cx: number, cz: number, r: number, th0: number, th1: number): Cubic {
  const k = (4 / 3) * Math.tan(Math.abs(th0 - th1) / 4) * r;
  const x0 = cx + r * Math.cos(th0), z0 = cz + r * Math.sin(th0);
  const x3 = cx + r * Math.cos(th1), z3 = cz + r * Math.sin(th1);
  const t0x = Math.sin(th0), t0z = -Math.cos(th0), t1x = Math.sin(th1), t1z = -Math.cos(th1);
  return new Float64Array([x0, z0, x0 + k * t0x, z0 + k * t0z, x3 - k * t1x, z3 - k * t1z, x3, z3]);
}

/** Arcs de l'anneau (angles décroissants depuis chaque entrée jusqu'à la suivante), pour l'aperçu et la construction. */
function ringPieces(angles: number[], cx: number, cz: number, r: number): { from: number; th: number[] }[] {
  const sorted = [...angles.keys()].sort((a, b) => angles[b]! - angles[a]!);
  const out: { from: number; th: number[] }[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]!, b = sorted[(i + 1) % sorted.length]!;
    const th0 = angles[a]!;
    let th1 = angles[b]!;
    while (th1 >= th0) th1 -= 2 * Math.PI;
    const m = Math.max(1, Math.ceil((th0 - th1) / (Math.PI / 2 - 1e-6)));
    const th: number[] = [];
    for (let k = 0; k <= m; k++) th.push(th0 + ((th1 - th0) * k) / m);
    out.push({ from: a, th });
  }
  void cx; void cz; void r;
  return out;
}

export function planRoundabout(net: RoadNetwork, req: RoundaboutRequest, opts: PlanOptions = {}): RoundaboutResult {
  const r = ROUNDABOUT_RADIUS[req.size];
  if (!r || !Number.isFinite(req.x) || !Number.isFinite(req.z)) return fail('Giratoire : paramètres invalides', 'INVALID_ARGS');
  const ring = ROAD_KINDS[RING_KIND];
  // Centre : carrefour proche, sinon point de la route la plus proche.
  let center: RoundaboutPlan['center'];
  let cx: number, cz: number;
  const node = net.nodeNear(req.x, req.z, 14);
  if (node >= 0) {
    const p = net.nodePos(node);
    center = { type: 'node', nodeId: node }; cx = p.x; cz = p.z;
  } else {
    const s = net.segmentNear(req.x, req.z, 12);
    if (!s) return fail('Cliquez sur un carrefour ou sur une route pour poser un giratoire', 'INVALID_ARGS');
    center = { type: 'segment', segId: s.segId, t: s.t }; cx = s.x; cz = s.z;
  }
  // Branches : (tronçon, extrémité côté centre).
  const armSegs: { segId: number; fromA: boolean; tMin: number; tMax: number }[] = [];
  if (center.type === 'node') {
    for (const sid of net.incident(center.nodeId)) {
      const [a] = net.endpoints(sid);
      armSegs.push({ segId: sid, fromA: a === center.nodeId, tMin: 0, tMax: 1 });
    }
  } else {
    armSegs.push({ segId: center.segId, fromA: true, tMin: center.t, tMax: 1 });
    armSegs.push({ segId: center.segId, fromA: false, tMin: 0, tMax: center.t });
  }
  const arms: ArmCut[] = [];
  for (const a of armSegs) {
    const kind = ROAD_KINDS[net.kindOf(a.segId)];
    if (!kind.atGradeCrossing) return fail('Pas de giratoire sur une autoroute');
    if (net.ringOf(a.segId)) return fail('Il y a déjà un giratoire ici');
    if (net.elevationOf(a.segId) !== 0) return fail('Pas de giratoire sur une route surélevée ou en tunnel');
    const c = net.curve(a.segId), arc = net.arc(a.segId);
    // Sous-courbe utile (moitié d'un tronçon coupé au centre).
    const t = cutOnCircle(c, arc, a.fromA, cx, cz, r);
    const ok = t !== null && (a.fromA ? t > a.tMin : t < a.tMax);
    if (!ok) return fail(`Branche trop courte pour un giratoire de ${Math.round(r * 2)} m`);
    const sCut = arc.sAt(t);
    const rest = a.fromA ? arc.length - sCut : sCut;
    if (rest < MIN_ARM_REST) return fail(`Branche trop courte pour un giratoire de ${Math.round(r * 2)} m`);
    const prof = net.profile(a.segId);
    const sC = a.fromA ? arc.sAt(a.tMin) : arc.sAt(a.tMax);
    for (let s = Math.min(sC, sCut); s <= Math.max(sC, sCut); s += 2) {
      if (profileIsBridge(prof, s) || profileIsTunnel(prof, s)) return fail('Pas de giratoire sur un pont ou dans un tunnel');
    }
    const p = new Float64Array(2);
    evalCubic(c, t, p);
    arms.push({ segId: a.segId, fromA: a.fromA, t, x: p[0]!, z: p[1]!, angle: Math.atan2(p[1]! - cz, p[0]! - cx) });
  }
  if (arms.length > 6) return fail('Trop de branches pour un giratoire (6 maximum)');
  const sortedAng = arms.map((a) => a.angle).sort((p, q) => p - q);
  for (let i = 0; i < sortedAng.length && sortedAng.length > 1; i++) {
    let d = sortedAng[(i + 1) % sortedAng.length]! - sortedAng[i]!;
    if (d <= 0) d += 2 * Math.PI;
    if (d < (32 * Math.PI) / 180) return fail('Branches trop rapprochées pour un giratoire');
  }
  // Emprise : aucune autre route dans le disque, carte, bâtiments.
  const hw = halfWidth(RING_KIND);
  const near = net.segmentsIn(cx - r - hw, cz - r - hw, cx + r + hw, cz + r + hw, []);
  const armIds = new Set(armSegs.map((a) => a.segId));
  for (const sid of near) {
    if (armIds.has(sid)) continue;
    const q = closestOnCubic(net.curve(sid), cx, cz);
    if (q.d < r + hw + halfWidth(net.kindOf(sid)) - 1) return fail('Une autre route traverse l\'emprise du giratoire');
  }
  const pieces = ringPieces(arms.map((a) => a.angle), cx, cz, r);
  let ringLength = 0;
  for (const pc of pieces) {
    for (let k = 1; k < pc.th.length; k++) {
      const cv = ringArc(cx, cz, r, pc.th[k - 1]!, pc.th[k]!);
      ringLength += new ArcTable(cv).length;
      if (opts.bounds) {
        const b = opts.bounds;
        if (cv[0]! < b.minX + hw || cv[1]! < b.minZ + hw || cv[0]! > b.maxX - hw || cv[1]! > b.maxZ - hw) return fail('Giratoire hors de la carte', 'OUT_OF_BOUNDS');
      }
      const msg = opts.blocked?.(cv, hw);
      if (msg) return fail(msg);
    }
    const p = new Float64Array(2);
    evalCubic(ringArc(cx, cz, r, pc.th[0]!, pc.th[1]!), 0.5, p);
    if (net.env.heightAt(p[0]!, p[1]!) < net.env.waterLevel + 0.4) return fail('Giratoire dans l\'eau', 'UNDER_WATER');
  }
  const cost = Math.round(ringLength * ring.costPerMeter);
  return { ok: true, plan: { cx, cz, r, center, arms, ringLength, cost, networkVersion: net.version } };
}

/** Applique un plan valide (calculé sur la même version du réseau). Renvoie les tronçons de l'anneau. */
export function commitRoundabout(net: RoadNetwork, plan: RoundaboutPlan): { segmentIds: number[] } {
  if (plan.networkVersion !== net.version) throw new Error('Plan de giratoire périmé : le réseau a changé');
  const { cx, cz, r } = plan;
  // 1) Centre : nœud existant, ou découpe du tronçon.
  let centerNode: number;
  if (plan.center.type === 'node') centerNode = plan.center.nodeId;
  else centerNode = net.splitSegment(plan.center.segId, plan.center.t).nodeId;
  // 2) Chaque branche est coupée sur le cercle ; la partie intérieure est supprimée.
  const ringNodes: { node: number; angle: number }[] = [];
  for (const sid of [...net.incident(centerNode)]) {
    const [a] = net.endpoints(sid);
    const fromA = a === centerNode;
    const t = cutOnCircle(net.curve(sid), net.arc(sid), fromA, cx, cz, r);
    if (t === null) continue;
    const sp = net.splitSegment(sid, Math.min(0.999, Math.max(0.001, t)));
    const inner = fromA ? sp.first : sp.second;
    const q = net.nodePos(sp.nodeId);
    ringNodes.push({ node: sp.nodeId, angle: Math.atan2(q.z - cz, q.x - cx) });
    net.removeSegment(inner);
  }
  // 3) Anneau : arcs ≤ 90° entre entrées successives (angles décroissants).
  const pieces = ringPieces(ringNodes.map((n) => n.angle), cx, cz, r);
  const segmentIds: number[] = [];
  for (const pc of pieces) {
    const startNode = ringNodes[pc.from]!.node;
    const nextIdx = ringNodes.findIndex((n, i) => i !== pc.from && Math.abs(Math.atan2(Math.sin(n.angle - pc.th[pc.th.length - 1]!), Math.cos(n.angle - pc.th[pc.th.length - 1]!))) < 1e-6);
    const endNode = nextIdx >= 0 ? ringNodes[nextIdx]!.node : startNode;
    let prev = startNode;
    for (let k = 1; k < pc.th.length; k++) {
      const last = k === pc.th.length - 1;
      const th = pc.th[k]!;
      const nxt = last ? endNode : net.addNode(cx + r * Math.cos(th), cz + r * Math.sin(th));
      if (nxt === prev) continue;
      const id = net.addSegment(prev, nxt, RING_KIND, ringArc(cx, cz, r, pc.th[k - 1]!, th));
      net.setRing(id, [cx, cz, r]);
      segmentIds.push(id);
      prev = nxt;
    }
  }
  return { segmentIds };
}
