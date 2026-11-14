/**
 * Trajectoires des mouvements visibles (navires, avions) : fonction PURE du gabarit, du mouvement et du temps
 * physique écoulé. La simulation s'en sert pour libérer postes et pistes ; le rendu pour placer les modèles.
 * Repère local du pôle (voir ./layout.ts). Cap = angle autour de Y d'un modèle dont l'avant regarde +Z
 * (cap = atan2(dx, dz)).
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { CHANNEL_REACH, RUNWAY_LENGTH, RUNWAY_Z, TAXIWAY_Z, hubLayout, type HubLayout } from './layout';
import type { HubMovement, HubType } from './types';

export interface MovementPose {
  x: number;
  z: number;
  /** Altitude au-dessus du sol fini (avions) ou de la surface de l'eau (navires). */
  alt: number;
  heading: number;
  /** Assiette (radians, positif = nez haut). */
  pitch: number;
  phase: 'approche' | 'atterrissage' | 'roulage' | 'stationne' | 'repoussage' | 'decollage' | 'montee' | 'accostage' | 'a_quai' | 'appareillage';
  /** Avancement 0..1 dans la phase. */
  u: number;
  /** Remorqueur d'escorte (navires de commerce, approche et départ). */
  tug?: { x: number; z: number; heading: number };
}

type Ease = 'lin' | 'in' | 'out' | 'inout';
interface Seg {
  ax: number; az: number; bx: number; bz: number;
  alt0: number; alt1: number;
  dur: number;
  ease: Ease;
  phase: MovementPose['phase'];
  /** Recul (repoussage) : le nez regarde à l'opposé du déplacement. */
  backward?: boolean;
  /** Cap imposé (segment immobile). */
  heading?: number;
  pitch?: number;
}

const easeOf = (e: Ease, u: number): number => (e === 'lin' ? u : e === 'in' ? u * u : e === 'out' ? 1 - (1 - u) * (1 - u) : u * u * (3 - 2 * u));

function headingOf(s: Seg): number {
  if (s.heading !== undefined) return s.heading;
  const dx = s.bx - s.ax, dz = s.bz - s.az;
  const h = Math.atan2(dx, dz);
  return s.backward ? h + Math.PI : h;
}

const wrap = (a: number): number => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

class Track {
  readonly segs: Seg[] = [];
  private x: number; private z: number; private alt: number;
  constructor(x: number, z: number, alt = 0) { this.x = x; this.z = z; this.alt = alt; }
  to(bx: number, bz: number, dur: number, phase: Seg['phase'], o: { alt?: number; ease?: Ease; backward?: boolean; pitch?: number } = {}): this {
    const alt1 = o.alt ?? this.alt;
    const s: Seg = { ax: this.x, az: this.z, bx, bz, alt0: this.alt, alt1, dur, ease: o.ease ?? 'lin', phase };
    if (o.backward) s.backward = true;
    if (o.pitch !== undefined) s.pitch = o.pitch;
    this.segs.push(s);
    this.x = bx; this.z = bz; this.alt = alt1;
    return this;
  }
  /** Taxi à vitesse constante (durée = longueur / vitesse). */
  taxi(bx: number, bz: number, speed: number, phase: Seg['phase'] = 'roulage', backward = false): this {
    return this.to(bx, bz, Math.max(1, Math.hypot(bx - this.x, bz - this.z) / speed), phase, backward ? { backward: true } : {});
  }
  hold(dur: number, phase: Seg['phase'], heading: number): this {
    this.segs.push({ ax: this.x, az: this.z, bx: this.x, bz: this.z, alt0: this.alt, alt1: this.alt, dur, ease: 'lin', phase, heading });
    return this;
  }
  get duration(): number { return this.segs.reduce((s, g) => s + g.dur, 0); }

  pose(t: number, turn = 4): MovementPose | null {
    if (t < 0) return null;
    let acc = 0;
    let prevHeading = this.segs.length ? headingOf(this.segs[0]!) : 0;
    for (const s of this.segs) {
      if (t <= acc + s.dur) {
        const u = s.dur > 0 ? (t - acc) / s.dur : 1;
        const e = easeOf(s.ease, u);
        let h = headingOf(s);
        const local = t - acc;
        // Virage progressif en début de segment (évite les pivots instantanés aux angles).
        if (local < turn && s.heading === undefined) h = prevHeading + wrap(h - prevHeading) * (local / turn);
        return {
          x: s.ax + (s.bx - s.ax) * e, z: s.az + (s.bz - s.az) * e, alt: s.alt0 + (s.alt1 - s.alt0) * e,
          heading: wrap(h), pitch: s.pitch ?? 0, phase: s.phase, u,
        };
      }
      acc += s.dur;
      prevHeading = headingOf(s);
    }
    return null;
  }
}

/* --------------------------------------------------------------- Navires */

export const SHIP_APPROACH_S = 120;
export const SHIP_DOCK_S: Record<HubMovement['role'], number> = { cargo: 480, vraquier: 540, ferry: 300, passagers: 300, fret: 300 };

function shipTrack(l: HubLayout, mv: HubMovement): Track {
  const b = l.berths[mv.slot] ?? l.berths[0]!;
  const reach = CHANNEL_REACH + 100;
  const tr = new Track(b.x - reach, b.z);
  tr.to(b.x, b.z, SHIP_APPROACH_S, 'accostage', { ease: 'out' });
  tr.hold(SHIP_DOCK_S[mv.role], 'a_quai', Math.PI / 2);
  tr.to(b.x + reach, b.z, SHIP_APPROACH_S, 'appareillage', { ease: 'in' });
  return tr;
}

/* ---------------------------------------------------------------- Avions */

/** Pente de descente (3°), point de toucher, vitesse de roulage (m/s). */
const GLIDE = Math.tan((3 * Math.PI) / 180);
const CLIMB = Math.tan((8 * Math.PI) / 180);
const TOUCHDOWN_X = -RUNWAY_LENGTH / 2 + 120;
const TAXI_SPEED = 9;
export const PARKED_S: Record<HubMovement['role'], number> = { cargo: 300, vraquier: 300, ferry: 300, passagers: 300, fret: 420 };

function planeTrack(l: HubLayout, mv: HubMovement): Track {
  const st = l.stands[mv.slot] ?? l.stands[0]!;
  const approachLen = 1500;
  const tr = new Track(TOUCHDOWN_X - approachLen, RUNWAY_Z, approachLen * GLIDE);
  tr.to(TOUCHDOWN_X, RUNWAY_Z, 45, 'approche', { alt: 0, pitch: 0.05 });
  tr.to(330, RUNWAY_Z, 30, 'atterrissage', { ease: 'out' });
  tr.taxi(390, RUNWAY_Z, TAXI_SPEED).taxi(390, TAXIWAY_Z, TAXI_SPEED).taxi(st.x, TAXIWAY_Z, TAXI_SPEED).taxi(st.x, st.z, 4);
  tr.hold(PARKED_S[mv.role], 'stationne', 0);
  tr.taxi(st.x, TAXIWAY_Z, 2, 'repoussage', true);
  tr.hold(8, 'repoussage', -Math.PI / 2);
  tr.taxi(-390, TAXIWAY_Z, TAXI_SPEED).taxi(-390, RUNWAY_Z, TAXI_SPEED);
  tr.hold(10, 'roulage', Math.PI / 2);
  tr.to(250, RUNWAY_Z, 32, 'decollage', { ease: 'in' });
  const climbLen = 2800;
  tr.to(250 + climbLen, RUNWAY_Z, 40, 'montee', { alt: climbLen * CLIMB, pitch: -0.14 });
  return tr;
}

/* ---------------------------------------------------------------- Accès */

const trackCache = new Map<string, Track>();

function trackFor(type: HubType, mv: HubMovement): Track {
  const key = `${type}|${mv.role}|${mv.slot}`;
  let t = trackCache.get(key);
  if (!t) {
    const l = hubLayout(type);
    t = type === 'aeroport' ? planeTrack(l, mv) : shipTrack(l, mv);
    trackCache.set(key, t);
  }
  return t;
}

/** Durée totale d'un mouvement (s de temps physique). */
export function movementDuration(type: HubType, mv: HubMovement): number {
  return trackFor(type, mv).duration;
}

/** Pose d'un mouvement au temps physique `phys` (null avant le début ou après la fin). */
export function movementPose(type: HubType, mv: HubMovement, phys: number): MovementPose | null {
  const p = trackFor(type, mv).pose(phys - mv.t0);
  if (!p) return null;
  // Assiette de l'avion : nez haut en montée, cabré à la rotation (fin du roulage de décollage).
  if (p.phase === 'decollage' && p.u > 0.85) p.pitch = -0.14 * ((p.u - 0.85) / 0.15);
  if (p.phase === 'approche') p.pitch = -0.05;
  // Le signe de pitch suit la convention three (rotation.x négative = nez haut pour un modèle avant +Z).
  if ((p.phase === 'accostage' && p.u > 0.5) || (p.phase === 'appareillage' && p.u < 0.5)) {
    if (mv.role === 'cargo' || mv.role === 'vraquier') p.tug = { x: p.x - 30, z: p.z + 26, heading: Math.PI };
  }
  return p;
}

/** Vrai si le mouvement occupe encore son poste au temps `phys`. */
export function movementActive(type: HubType, mv: HubMovement, phys: number): boolean {
  return phys < mv.t0 + movementDuration(type, mv);
}

/** Durée d'occupation de la piste au début (arrivée) et à la fin (départ) d'une rotation d'avion. */
export function runwayWindows(mv: HubMovement): { arrival: [number, number]; departure: [number, number] } {
  const tr = trackFor('aeroport', mv);
  let acc = 0;
  let arrEnd = 0, depStart = 0;
  for (const s of tr.segs) {
    if (s.phase === 'atterrissage') arrEnd = acc + s.dur;
    if (s.phase === 'decollage' && depStart === 0) depStart = acc - 10;
    acc += s.dur;
  }
  return { arrival: [mv.t0, mv.t0 + arrEnd], departure: [mv.t0 + depStart, mv.t0 + acc] };
}
