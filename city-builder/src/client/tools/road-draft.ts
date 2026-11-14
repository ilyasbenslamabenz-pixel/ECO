/**
 * Tracé de route en cours (pur TypeScript) : droite (2 clics) ou courbe (départ, point de
 * contrôle, arrivée = Bézier quadratique échantillonnée en polyligne), accrochage aux nœuds
 * et aux tronçons existants, angle magnétique (pas de 15°) sur demande.
 * La polyligne produite est envoyée telle quelle à la commande `buildRoad` (contrat actuel :
 * points [x0,z0,x1,z1,…]) ; la simulation valide pente, eau, collisions et fonds.
 * Propriétaire : agent construction/caméra/UI.
 */
import type { RoadKindId } from '../../shared/contracts';
import { TILE_SIZE } from '../../shared/constants';
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
  /** Grille de construction : premier point sur une intersection, longueur en multiples de 8 m. */
  grid?: boolean;
  /**
   * Lignes guides (avec l'aimantation) : droites parallèles aux routes existantes, à cette distance d'axe à axe
   * (taille d'îlot, m). 0 ou absent = désactivées.
   */
  guideSpacing?: number;
}

/** Ligne guide parallèle à une route existante, à distance d'îlot. */
export interface ParallelGuide {
  /** Projection du curseur sur la ligne guide. */
  x: number; z: number;
  /** Point de la ligne et direction unitaire (celle du segment de route de référence). */
  ox: number; oz: number; ux: number; uz: number;
  /** Étendue utile du guide le long de la direction, depuis (ox, oz). */
  s0: number; s1: number;
  edgeId: number;
  /** Écart entre le curseur et la ligne (m). */
  err: number;
}

/**
 * Ligne guide la plus proche du curseur : parallèle à un segment de route existant, décalée de `spacing`
 * (d'un côté ou de l'autre), si le curseur en est à moins de `tol` m. Null sinon.
 */
export function parallelGuide(m: WorldMirror, x: number, z: number, spacing: number, tol: number): ParallelGuide | null {
  if (!(spacing > 0)) return null;
  let best: ParallelGuide | null = null;
  for (const e of m.edges.values()) {
    const v = m.edgeView(e);
    if (!v) continue;
    const p = v.poly;
    for (let k = 0; k + 3 < p.length; k += 2) {
      const ax = p[k]!, az = p[k + 1]!, ex = p[k + 2]! - ax, ez = p[k + 3]! - az;
      const len = Math.hypot(ex, ez);
      if (len < 6) continue;
      const ux = ex / len, uz = ez / len;
      const rx = x - ax, rz = z - az;
      const s = rx * ux + rz * uz;
      if (s < -spacing * 0.6 || s > len + spacing * 0.6) continue;
      const d = -rx * uz + rz * ux; // distance signée (normale (−uz, ux))
      const err = Math.abs(Math.abs(d) - spacing);
      if (err > tol || (best && err >= best.err)) continue;
      const sg = d >= 0 ? 1 : -1;
      const ox = ax - uz * spacing * sg, oz = az + ux * spacing * sg;
      best = { x: ox + ux * s, z: oz + uz * s, ox, oz, ux, uz, s0: Math.min(0, s) - 12, s1: Math.max(len, s) + 12, edgeId: v.id, err };
    }
  }
  return best;
}

/** Intersection de la demi-droite (from, direction vers p) avec la ligne guide ; null si parallèles ou derrière. */
function rayGuide(from: { x: number; z: number }, p: { x: number; z: number }, g: ParallelGuide): { x: number; z: number } | null {
  const dx = p.x - from.x, dz = p.z - from.z;
  const den = dx * g.uz - dz * g.ux;
  if (Math.abs(den) < 1e-6 * Math.hypot(dx, dz)) return null;
  // from + t·d = o + s·u  →  t = ((o − from) × u) / (d × u)
  const t = ((g.ox - from.x) * g.uz - (g.oz - from.z) * g.ux) / den;
  if (t <= 0.05) return null;
  return { x: from.x + dx * t, z: from.z + dz * t };
}

const fmtLen = (v: number): string => `${Math.round(v)} m`;

/** Aimantation à une ligne guide parallèle (combinée à l'angle magnétique depuis `from` s'il y en a un). */
function guideSnap(m: WorldMirror, x: number, z: number, s: SnapSettings, from?: { x: number; z: number }): SnapPoint | null {
  const spacing = s.guideSpacing ?? 0;
  if (!s.magnet || spacing <= 0) return null;
  const g = parallelGuide(m, x, z, spacing, Math.max(3, s.radius * 0.5));
  if (!g) return null;
  const guide = { x0: g.ox + g.ux * g.s0, z0: g.oz + g.uz * g.s0, x1: g.ox + g.ux * g.s1, z1: g.oz + g.uz * g.s1, label: `parallèle à la route · îlot ${fmtLen(spacing)}` };
  if (from) {
    // Angle magnétique (axe, perpendiculaire, 45°) prolongé jusqu'à la ligne guide : la rue s'arrête à distance d'îlot.
    const mp = magnetPoint(m, x, z, from, false);
    if (mp && mp.snap === 'angle') {
      const q = rayGuide(from, mp, g);
      if (q && Math.hypot(q.x - x, q.z - z) < Math.max(6, s.radius)) {
        return { x: q.x, z: q.z, snap: 'angle', guide: { ...guide, label: `${mp.guide?.label.replace(/ · \d+ m$/, '') ?? 'aimanté'} · jusqu'à l'îlot (${fmtLen(spacing)})` } };
      }
    }
  }
  return { x: g.x, z: g.z, snap: 'angle', guide };
}

/** Libellé d'angle du tracé : par rapport à la route au départ si le départ y est accroché, sinon cap (0° = nord). */
export function angleLabel(m: WorldMirror, start: SnapPoint, end: { x: number; z: number }): string {
  const dx = end.x - start.x, dz = end.z - start.z;
  if (Math.hypot(dx, dz) < 1e-6) return '';
  const a = Math.atan2(dz, dx);
  const refs = start.snap === 'node' || start.snap === 'edge' ? referenceDirs(m, start).filter((r) => r.road) : [];
  if (refs.length) {
    let best = Infinity;
    for (const r of refs) { const d = Math.abs(wrapPi(a - r.a)); best = Math.min(best, Math.min(d, Math.PI - d)); }
    return `${Math.round((best * 180) / Math.PI)}° / route`;
  }
  // Nord = −z (vue « nord en haut »), sens horaire.
  const cap = ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
  return `cap ${Math.round(cap) % 360}°`;
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
export function magnetPoint(m: WorldMirror, x: number, z: number, from: { x: number; z: number }, grid = false): SnapPoint | null {
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
  let L = Math.max(1, Math.round(len)); // longueur arrondie au mètre
  if (!best) {
    const u = L / len;
    return { x: from.x + dx * u, z: from.z + dz * u, snap: 'free' };
  }
  const ux = Math.cos(best.a), uz = Math.sin(best.a);
  // Grille de construction : sur un axe nord-sud / est-ouest, la longueur est un multiple de la case (8 m).
  const axial = Math.abs(Math.sin(2 * best.a)) < 1e-6;
  if (grid && axial) L = Math.max(TILE_SIZE, Math.round(len / TILE_SIZE) * TILE_SIZE);
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
  if (!s.angleSnap) {
    const g = guideSnap(m, x, z, s, from);
    if (g) return g;
  }
  if (s.angleSnap && from) {
    const dx = x - from.x;
    const dz = z - from.z;
    const len = Math.hypot(dx, dz);
    if (len > 1) {
      const a = snapAngle(Math.atan2(dz, dx), Math.PI / 12);
      // Longueur au mètre ; grille active : multiple de la case (8 m), l'extrémité tombe sur la grille.
      const l = s.grid ? Math.max(TILE_SIZE, Math.round(len / TILE_SIZE) * TILE_SIZE) : Math.max(1, Math.round(len));
      return { x: from.x + Math.cos(a) * l, z: from.z + Math.sin(a) * l, snap: 'angle' };
    }
  }
  if (s.magnet && from) {
    const p = magnetPoint(m, x, z, from, s.grid);
    if (p) return p;
  }
  // Premier point d'une route, grille active : intersection de la grille de construction la plus proche.
  if (s.grid && !from) return { x: Math.round(x / TILE_SIZE) * TILE_SIZE, z: Math.round(z / TILE_SIZE) * TILE_SIZE, snap: 'free' };
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

  reset(): void { this.phase = 'idle'; this.start = null; this.control = null; this.chained = 0; }

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

  /** Nombre de tronçons construits dans l'enchaînement en cours (0 = premier tronçon). */
  chained = 0;

  /** Après une construction réussie : le tracé continue depuis l'extrémité (enchaînement). */
  chainFrom(end: SnapPoint): void { this.start = end; this.control = null; this.phase = 'start'; this.chained++; }

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
