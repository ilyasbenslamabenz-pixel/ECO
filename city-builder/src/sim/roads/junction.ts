/**
 * Géométrie des intersections (pure, partagée simulation / rendu) : branches triées par angle,
 * reculs (setbacks) des tronçons pour dégager la dalle de carrefour, coins arrondis.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import type { RoadNetwork } from './network';
import { outgoingDir } from './planner';
import { ROAD_KINDS, carriagewayWidth, totalWidth, type RoadKindId } from './types';

export interface JunctionArm {
  segId: number;
  /** Vrai si le nœud est l'extrémité a du tronçon (le tronçon part du nœud). */
  atStart: boolean;
  /** Direction sortante unitaire (du nœud vers le tronçon). */
  dirX: number;
  dirZ: number;
  angle: number;
  kind: RoadKindId;
  halfCarriage: number;
  halfTotal: number;
  /** Recul (m) le long du tronçon où commence la chaussée du tronçon. */
  setback: number;
}

export type JunctionType = 'none' | 'end' | 'continuous' | 'junction';

export interface JunctionInfo {
  nodeId: number;
  type: JunctionType;
  /** Branches triées par angle croissant (atan2(z, x)). */
  arms: JunctionArm[];
}

/** Rayon de bordure des coins de carrefour (m). */
export const CORNER_RADIUS = 3;

export function computeJunction(net: RoadNetwork, nodeId: number): JunctionInfo {
  const segs = net.incident(nodeId);
  const arms: JunctionArm[] = segs.map((segId) => {
    const kind = net.kindOf(segId);
    const k = ROAD_KINDS[kind];
    const [dx, dz] = outgoingDir(net, segId, nodeId);
    const [a] = net.endpoints(segId);
    return { segId, atStart: a === nodeId, dirX: dx, dirZ: dz, angle: Math.atan2(dz, dx), kind, halfCarriage: carriagewayWidth(k) / 2, halfTotal: totalWidth(k) / 2, setback: 0 };
  });
  arms.sort((p, q) => p.angle - q.angle);
  if (arms.length === 0) return { nodeId, type: 'none', arms };
  if (arms.length === 1) return { nodeId, type: 'end', arms };
  if (arms.length === 2) {
    const [p, q] = arms as [JunctionArm, JunctionArm];
    const dot = p.dirX * q.dirX + p.dirZ * q.dirZ;
    // Même profil en travers et virage léger (< ~20°) : tronçons raccordés sans dalle (onglet). Au-delà (angle
    // obtus, droit ou aigu), une dalle de raccord arrondit le coin : l'onglet donnait des angles vifs, et des
    // bords et trottoirs qui se chevauchaient dans les virages serrés.
    if (p.kind === q.kind && dot < -0.94) return { nodeId, type: 'continuous', arms };
  }
  const n = arms.length;
  for (let i = 0; i < n; i++) {
    const a = arms[i]!;
    let need = 0;
    // Voisins des deux côtés. Avec deux branches, c'est la MÊME branche des deux côtés : les deux angles (aigu et
    // rentrant) doivent être évalués, sinon l'une des branches ne recule pas du côté aigu et ses trottoirs
    // traversent la chaussée de l'autre.
    for (const [j, next] of [[(i + 1) % n, true], [(i + n - 1) % n, false]] as const) {
      if (j === i) continue;
      const b = arms[j]!;
      // Angle entre les branches, côté du voisin.
      let alpha = next ? b.angle - a.angle : a.angle - b.angle;
      while (alpha <= 0) alpha += 2 * Math.PI;
      while (alpha > 2 * Math.PI) alpha -= 2 * Math.PI;
      let t: number;
      if (alpha < (170 * Math.PI) / 180) {
        t = (b.halfTotal + a.halfTotal * Math.cos(alpha)) / Math.sin(alpha);
      } else {
        t = a.halfTotal * 0.25; // branches presque opposées : simple raccord
      }
      need = Math.max(need, t);
    }
    a.setback = Math.max(need + CORNER_RADIUS, a.halfCarriage * 0.6);
    a.setback = Math.min(a.setback, net.length(a.segId) * 0.45);
  }
  return { nodeId, type: 'junction', arms };
}

/** Reculs aux deux extrémités d'un tronçon (m). */
export function segmentTrims(net: RoadNetwork, segId: number, cache?: Map<number, JunctionInfo>): { start: number; end: number; startType: JunctionType; endType: JunctionType } {
  const [a, b] = net.endpoints(segId);
  const ja = cache?.get(a) ?? computeJunction(net, a);
  const jb = cache?.get(b) ?? computeJunction(net, b);
  cache?.set(a, ja); cache?.set(b, jb);
  const armA = ja.arms.find((x) => x.segId === segId && x.atStart) ?? ja.arms.find((x) => x.segId === segId);
  const armB = jb.arms.find((x) => x.segId === segId && !x.atStart) ?? jb.arms.find((x) => x.segId === segId);
  return { start: armA?.setback ?? 0, end: armB?.setback ?? 0, startType: ja.type, endType: jb.type };
}

/** Intersection de deux droites p + t·d et q + u·e ; renvoie t (ou NaN si parallèles). */
export function lineIntersectT(px: number, pz: number, dx: number, dz: number, qx: number, qz: number, ex: number, ez: number): number {
  const den = dx * ez - dz * ex;
  if (Math.abs(den) < 1e-9) return NaN;
  return ((qx - px) * ez - (qz - pz) * ex) / den;
}
