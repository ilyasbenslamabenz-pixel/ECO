/**
 * Tracé de route en cours (pur TypeScript) : droite (2 clics) ou courbe (départ, point de
 * contrôle, arrivée = Bézier quadratique échantillonnée en polyligne), accrochage aux nœuds
 * et aux tronçons existants, angle magnétique (pas de 15°) sur demande.
 * La polyligne produite est envoyée telle quelle à la commande `buildRoad` (contrat actuel :
 * points [x0,z0,x1,z1,…]) ; la simulation valide pente, eau, collisions et fonds.
 * Propriétaire : agent construction/caméra/UI.
 */
import type { RoadKindId } from '../../shared/contracts';
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
  /** Guide d'aimantation (droite d'alignement depuis le point de départ) et son libellé. */
  guide?: { x0: number; z0: number; x1: number; z1: number; label: string };
}

export interface SnapSettings {
  /** Rayon d'accrochage aux nœuds / tronçons (m), à adapter au zoom par l'appelant. */
  radius: number;
  /** Angle magnétique par pas de 15° depuis le point précédent (touche Maj). */
  angleSnap: boolean;
  /**
   * Aimantation « droite » (activée par défaut) : angles de 0/45/90° par rapport au nord et à la route existante
   * au point de départ (prolongement dans l'axe, perpendiculaire, 45°), longueur arrondie au mètre.
   */
  magnet?: boolean;
}

/** Tolérance angulaire de l'aimantation (rad). */
const MAGNET_TOL = (7 * Math.PI) / 180;

/** Directions de référence au point de départ : axes nord/est, et directions des routes qui y passent. */
function referenceDirs(m: WorldMirror, from: { x: number; z: number }): { a: number; road: boolean }[] {
  const out: { a: number; road: boolean }[] = [{ a: 0, road: false }];
  const node = m.nearestNode(from.x, from.z, 0.6);
  if (node) {
    for (const e of m.edges.values()) {
      if (e.a !== node.id && e.b !== node.id) continue;
      const v = m.edgeView(e);
      if (!v) continue;
      const p = v.poly, n = p.length;
      // Direction sortante du nœud vers le tronçon (premier ou dernier segment de la polyligne).
      const [dx, dz] = e.a === node.id ? [p[2]! - p[0]!, p[3]! - p[1]!] : [p[n - 4]! - p[n - 2]!, p[n - 3]! - p[n - 1]!];
      if (Math.hypot(dx, dz) > 1e-6) out.push({ a: Math.atan2(dz, dx), road: true });
    }
  } else {
    const e = m.nearestEdge(from.x, from.z, 0.6);
    if (e) out.push({ a: Math.atan2(e.tz, e.tx), road: true });
  }
  return out;
}

const wrapPi = (a: number): number => { let r = a % (2 * Math.PI); if (r > Math.PI) r -= 2 * Math.PI; if (r < -Math.PI) r += 2 * Math.PI; return r; };

/** Aimantation d'angle et de longueur depuis `from` (null si le curseur est trop près du départ). */
export function magnetPoint(m: WorldMirror, x: number, z: number, from: { x: number; z: number }): SnapPoint | null {
  const dx = x - from.x, dz = z - from.z;
  const len = Math.hypot(dx, dz);
  if (len < 2) return null;
  const cur = Math.atan2(dz, dx);
  let best: { a: number; d: number; label: string; road: boolean } | null = null;
  for (const r of referenceDirs(m, from)) {
    for (let k = 0; k < 8; k++) {
      const a = r.a + (k * Math.PI) / 4;
      const d = Math.abs(wrapPi(cur - a));
      if (d > MAGNET_TOL) continue;
      // Plus petit écart ; à égalité (axes confondus), la route existante l'emporte sur les axes nord / est.
      if (best && !(d < best.d - 0.01 || (Math.abs(d - best.d) <= 0.01 && r.road && !best.road))) continue;
      // Libellé : par rapport à la route, k = 4 (sens opposé à la branche existante) = prolongement dans l'axe.
      const label = r.road ? (k === 4 ? 'dans l\'axe de la route' : k === 2 || k === 6 ? 'perpendiculaire à la route' : k === 0 ? 'le long de la route' : '45° avec la route')
        : (k % 2 === 0 ? (k % 4 === 0 ? 'est-ouest' : 'nord-sud') : 'diagonale 45°');
      best = { a, d, label, road: r.road };
    }
  }
  const L = Math.max(1, Math.round(len)); // longueur arrondie au mètre
  if (!best) {
    const u = L / len;
    return { x: from.x + dx * u, z: from.z + dz * u, snap: 'free' };
  }
  const ux = Math.cos(best.a), uz = Math.sin(best.a);
  const ext = Math.max(L + 40, L * 1.6);
  return {
    x: from.x + ux * L, z: from.z + uz * L, snap: 'angle',
    guide: { x0: from.x - ux * 12, z0: from.z - uz * 12, x1: from.x + ux * ext, z1: from.z + uz * ext, label: `${best.label} · ${L} m` },
  };
}

export function snapRoadPoint(m: WorldMirror, x: number, z: number, s: SnapSettings, from?: { x: number; z: number }): SnapPoint {
  const n = m.nearestNode(x, z, s.radius);
  if (n) return { x: n.x, z: n.z, snap: 'node', nodeId: n.id };
  const e = m.nearestEdge(x, z, s.radius * 0.7);
  if (e) return { x: e.px, z: e.pz, snap: 'edge', edgeId: e.edge.id };
  if (s.angleSnap && from) {
    const dx = x - from.x;
    const dz = z - from.z;
    const len = Math.hypot(dx, dz);
    if (len > 1) {
      const a = snapAngle(Math.atan2(dz, dx), Math.PI / 12);
      const l = Math.max(1, Math.round(len)); // longueur au mètre
      return { x: from.x + Math.cos(a) * l, z: from.z + Math.sin(a) * l, snap: 'angle' };
    }
  }
  if (s.magnet && from) {
    const p = magnetPoint(m, x, z, from);
    if (p) return p;
  }
  return { x, z, snap: 'free' };
}

export type DraftPhase = 'idle' | 'start' | 'control';

/** Machine à états du tracé : idle → (clic) start → [courbe : (clic) control] → (clic) construit. */
export class RoadDraft {
  type: RoadKindId = 'street';
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

  /**
   * Arguments de la commande buildRoad : en mode courbe, UNE vraie courbe (2 extrémités + point de
   * contrôle quadratique, convertie en Bézier cubique par la simulation) ; sinon un tronçon droit.
   */
  command(): { points: number[]; control?: [number, number] } | null {
    const a = this.start;
    const b = this.hover;
    if (!a || !b || this.phase === 'idle' || Math.hypot(b.x - a.x, b.z - a.z) < 4) return null;
    if (this.mode === 'curve' && this.control) return { points: [a.x, a.z, b.x, b.z], control: [this.control.x, this.control.z] };
    return { points: [a.x, a.z, b.x, b.z] };
  }
}
