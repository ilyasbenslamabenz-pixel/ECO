/**
 * Tracé de route en cours (pur TypeScript) : droite (2 clics) ou courbe (départ, point de
 * contrôle, arrivée = Bézier quadratique échantillonnée en polyligne), accrochage aux nœuds
 * et aux tronçons existants, angle magnétique (pas de 15°) sur demande.
 * La polyligne produite est envoyée telle quelle à la commande `buildRoad` (contrat actuel :
 * points [x0,z0,x1,z1,…]) ; la simulation valide pente, eau, collisions et fonds.
 * Propriétaire : agent construction/caméra/UI.
 */
import type { RoadTypeId } from '../../shared/contracts';
import { polylineLength, sampleBezier2, snapAngle } from './geometry';
import type { WorldMirror } from './mirror';

export type RoadMode = 'straight' | 'curve';

export interface SnapPoint {
  x: number;
  z: number;
  /** Ce sur quoi le point est accroché. */
  snap: 'node' | 'edge' | 'angle' | 'free';
  nodeId?: number;
  edgeId?: number;
}

export interface SnapSettings {
  /** Rayon d'accrochage aux nœuds / tronçons (m), à adapter au zoom par l'appelant. */
  radius: number;
  /** Angle magnétique par pas de 15° depuis le point précédent. */
  angleSnap: boolean;
}

export function snapRoadPoint(m: WorldMirror, x: number, z: number, s: SnapSettings, from?: { x: number; z: number }): SnapPoint {
  const n = m.nearestNode(x, z, s.radius);
  if (n) return { x: n.x, z: n.z, snap: 'node', nodeId: n.id };
  const e = m.nearestEdge(x, z, s.radius * 0.7);
  if (e) {
    const v = e.edge;
    return { x: v.ax + (v.bx - v.ax) * e.t, z: v.az + (v.bz - v.az) * e.t, snap: 'edge', edgeId: v.id };
  }
  if (s.angleSnap && from) {
    const dx = x - from.x;
    const dz = z - from.z;
    const len = Math.hypot(dx, dz);
    if (len > 1) {
      const a = snapAngle(Math.atan2(dz, dx), Math.PI / 12);
      const l = Math.round(len / 4) * 4; // longueur par pas de 4 m
      return { x: from.x + Math.cos(a) * l, z: from.z + Math.sin(a) * l, snap: 'angle' };
    }
  }
  return { x, z, snap: 'free' };
}

export type DraftPhase = 'idle' | 'start' | 'control';

/** Machine à états du tracé : idle → (clic) start → [courbe : (clic) control] → (clic) construit. */
export class RoadDraft {
  type: RoadTypeId = 'street';
  mode: RoadMode = 'straight';
  phase: DraftPhase = 'idle';
  start: SnapPoint | null = null;
  control: SnapPoint | null = null;
  /** Point courant sous le curseur (déjà accroché). */
  hover: SnapPoint | null = null;

  reset(): void { this.phase = 'idle'; this.start = null; this.control = null; }

  /** Clic principal. Renvoie 'build' quand le tracé est complet et doit être envoyé. */
  click(p: SnapPoint): 'build' | 'continue' {
    this.hover = p;
    if (this.phase === 'idle') { this.start = p; this.phase = 'start'; return 'continue'; }
    if (this.phase === 'start' && this.mode === 'curve') {
      if (this.start && Math.hypot(p.x - this.start.x, p.z - this.start.z) < 4) return 'continue';
      this.control = p; this.phase = 'control'; return 'continue';
    }
    return 'build';
  }

  /** Après une construction réussie : le tracé continue depuis l'extrémité (enchaînement). */
  chainFrom(end: SnapPoint): void { this.start = end; this.control = null; this.phase = 'start'; }

  /** Retour d'une étape (clic droit / Échap). Renvoie false si rien à annuler. */
  back(): boolean {
    if (this.phase === 'control') { this.control = null; this.phase = 'start'; return true; }
    if (this.phase === 'start') { this.reset(); return true; }
    return false;
  }

  /** Polyligne du tracé courant (vers `hover`), ou null si incomplet. */
  points(): number[] | null {
    const a = this.start;
    const b = this.hover;
    if (!a || !b || this.phase === 'idle') return null;
    if (Math.hypot(b.x - a.x, b.z - a.z) < 4) return null;
    if (this.mode === 'curve') {
      const c = this.control;
      if (!c) return [a.x, a.z, b.x, b.z]; // 2e clic pas encore posé : aperçu droit
      return sampleBezier2(a.x, a.z, c.x, c.z, b.x, b.z, 12);
    }
    return [a.x, a.z, b.x, b.z];
  }

  length(): number { const p = this.points(); return p ? polylineLength(p) : 0; }
}
