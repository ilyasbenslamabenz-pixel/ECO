/**
 * Contrôleur de caméra (implémente ICameraController).
 *
 * AÉRIEN (orbite autour d'un point au sol, de ~2 000 m à ~8 m) :
 *   souris   : glisser gauche = saisir et déplacer le sol (outil Sélection) ; glisser droit ou
 *              milieu = pivoter / incliner ; molette = zoom VERS LE CURSEUR ;
 *   clavier  : ZQSD (AZERTY) / WASD (QWERTY) / flèches = déplacer ; A/E (AZERTY, Q/E en QWERTY) = pivoter ;
 *              R/F ou Page↑/Page↓ = incliner ; +/- = zoom ; T = vue de dessus ; N = nord en haut ;
 *              H = retour au point de départ ; C = mode cinématique (orbite lente) ;
 *   tactile  : 1 doigt = outil (ou déplacement avec l'outil Sélection) ; 2 doigts = déplacement
 *              du point milieu + pincer (zoom vers le milieu) + torsion (rotation) ;
 *              glisser vertical des 2 doigts ensemble = inclinaison.
 *   L'inclinaison suit automatiquement le zoom (vue plongeante de loin, rasante de près) ;
 *   le joueur garde un décalage personnel. Toutes les commandes visent une pose « but » que la
 *   caméra rejoint avec un amortissement exponentiel. Bornes de carte, distance et altitude
 *   minimale au-dessus du relief respectées ; la cible suit le relief.
 *
 * RUE (piéton, yeux à 1,7 m) : ZQSD/WASD/flèches = marcher (Maj = courir), glisser = regarder,
 *   molette = avancer ; tactile : 1 doigt = regarder, 2 doigts = avancer / pas latéral / tourner.
 *   Collision avec les bâtiments via `isBlocked` (fourni par le câblage, miroir de la simulation).
 *
 * Les gestes « primaires » (clic gauche, un doigt) sont délégués aux outils via `PointerToolSink`
 * quand l'outil actif en a besoin (route, bâtiment, bulldozer) ; un clic sans glisser est
 * transmis comme « tap » (sélection).
 * Propriétaire : agent construction/caméra/UI.
 */
import * as THREE from 'three';
import type { CameraMode, CameraPose, ICameraController } from '../shared/contracts';
import { clamp } from '../shared/math';
import { angleDelta, rayTerrain, type Ray } from '../client/tools/geometry';

export interface CameraBounds { minX: number; minZ: number; maxX: number; maxZ: number }

/** Ce que la caméra transmet aux outils (coordonnées écran relatives au canvas, en px CSS). */
export interface PointerToolSink {
  /** Vrai si l'outil actif utilise le geste primaire (sinon : déplacement de caméra + tap). */
  capturesPrimary(pointerType: string): boolean;
  hover(sx: number, sy: number, pointerType: string): void;
  down(sx: number, sy: number, pointerType: string): void;
  move(sx: number, sy: number, pointerType: string): void;
  /** Fin du geste ; `tap` = relâché sans glisser notable. */
  up(sx: number, sy: number, pointerType: string, tap: boolean): void;
  /** Geste interrompu (deuxième doigt posé, perte du pointeur). */
  cancel(): void;
  /** Clic droit sans glisser. */
  secondary(): void;
}

export const EYE_HEIGHT = 1.7;
export const MIN_DISTANCE = 8;
export const MAX_DISTANCE = 2000;
const MIN_PITCH = 0.06;
const MAX_PITCH = 1.54;
const TAP_SLOP_PX = 6;

/** Inclinaison automatique en fonction de la distance : rasante à 8 m, plongeante à 2 000 m. */
export function autoPitch(distance: number): number {
  const t = clamp((Math.log(distance) - Math.log(MIN_DISTANCE)) / (Math.log(MAX_DISTANCE) - Math.log(MIN_DISTANCE)), 0, 1);
  const s = t * t * (3 - 2 * t);
  return 0.2 + s * (1.12 - 0.2);
}

/** Amortissement exponentiel indépendant de la fréquence d'images. */
export function damp(current: number, goal: number, lambda: number, dt: number): number {
  return goal + (current - goal) * Math.exp(-lambda * dt);
}

interface Pose { tx: number; ty: number; tz: number; dist: number; yaw: number; pitchOffset: number }
type Gesture = 'none' | 'tool' | 'pan' | 'pan-pending' | 'orbit' | 'orbit-pending' | 'look' | 'pinch';

const _ray = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _v = new THREE.Vector3();

export class CameraController implements ICameraController {
  mode: CameraMode = 'aerial';
  /** Pose visée (les commandes l'écrivent) et pose courante (amortie). */
  private goal: Pose = { tx: 0, ty: 0, tz: 0, dist: 520, yaw: 0.6, pitchOffset: 0 };
  private cur: Pose = { ...this.goal };
  private home: Pose = { ...this.goal };
  /** Mode rue : position et orientation propres (amorties elles aussi). */
  private street = { x: 0, z: 0, yaw: 0, pitch: -0.05, gx: 0, gz: 0, gyaw: 0, gpitch: -0.05, y: 0 };
  private keys = new Set<string>();
  private pointers = new Map<number, { x: number; y: number; sx: number; sy: number; button: number; type: string }>();
  private gesture: Gesture = 'none';
  private lastPinch = { dist: 0, angle: 0, midX: 0, midY: 0 };
  private disposers: (() => void)[] = [];
  bounds: CameraBounds = { minX: -1000, minZ: -1000, maxX: 1000, maxZ: 1000 };
  /** Compatibilité fondation : le déplacement au glisser gauche est désormais décidé par `toolSink`. */
  leftDragPans = true;
  /** Outils (facultatif) : reçoivent survol, clics, taps. */
  toolSink: PointerToolSink | null = null;
  /** Mode rue : vrai si le point est dans un bâtiment (collision). */
  isBlocked: ((x: number, z: number) => boolean) | null = null;
  /** Mode cinématique : orbite lente, interrompue par toute action du joueur. */
  cinematic = false;
  /** Distance d'affichage (m) : plan lointain (option graphique). */
  viewDistance = 4500;
  /** Raideur de l'amortissement (1/s). */
  smoothing = 9;
  private streetPreset = false;
  private pinchDirty = false;
  private pinchMode: 'undecided' | 'tilt' | 'free' = 'undecided';
  private pinchAcc = { mx: 0, my: 0, d: 0, a: 0 };
  private onModeChange: ((m: CameraMode) => void) | null = null;
  private onCinematic: ((on: boolean) => void) | null = null;

  constructor(private camera: THREE.PerspectiveCamera, private dom: HTMLElement, private heightAt: (x: number, z: number) => number) {
    const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement | Window, type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions): void => {
      el.addEventListener(type, fn as EventListener, opts);
      this.disposers.push(() => el.removeEventListener(type, fn as EventListener, opts));
    };
    on(dom, 'contextmenu', (e) => e.preventDefault());
    on(dom, 'pointerdown', (e) => this.pointerDown(e));
    on(window, 'pointermove', (e) => this.pointerMove(e));
    on(window, 'pointerup', (e) => this.pointerUp(e));
    on(window, 'pointercancel', (e) => this.pointerUp(e, true));
    on(dom, 'wheel', (e) => this.wheel(e), { passive: false });
    on(window, 'keydown', (e) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      this.keys.add(e.code);
      this.quickKey(e.code);
    });
    on(window, 'keyup', (e) => this.keys.delete(e.code));
    on(window, 'blur', () => { this.keys.clear(); this.pointers.clear(); this.gesture = 'none'; });
    dom.style.touchAction = 'none';
  }

  setModeListener(fn: (m: CameraMode) => void): void { this.onModeChange = fn; }
  setCinematicListener(fn: (on: boolean) => void): void { this.onCinematic = fn; }

  setMode(mode: CameraMode): void {
    if (mode === this.mode) return;
    this.stopCinematic();
    if (mode === 'street') {
      const s = this.street;
      if (!this.streetPreset) {
        s.x = s.gx = this.cur.tx;
        s.z = s.gz = this.cur.tz;
        s.yaw = s.gyaw = this.cur.yaw;
      }
      this.streetPreset = false;
      s.pitch = s.gpitch = -0.05;
      s.y = 0;
      // Ne pas apparaître dans un bâtiment : on cherche un point libre en spirale.
      if (this.isBlocked?.(s.x, s.z)) {
        for (let r = 4; r < 80; r += 4) {
          let found = false;
          for (let a = 0; a < 8 && !found; a++) {
            const x = s.x + Math.cos((a * Math.PI) / 4) * r;
            const z = s.z + Math.sin((a * Math.PI) / 4) * r;
            if (!this.isBlocked(x, z)) { s.x = s.gx = x; s.z = s.gz = z; found = true; }
          }
          if (found) break;
        }
      }
    } else {
      this.goal.tx = this.cur.tx = this.street.x;
      this.goal.tz = this.cur.tz = this.street.z;
      this.goal.yaw = this.cur.yaw = this.street.yaw;
    }
    this.mode = mode;
    this.onModeChange?.(mode);
  }

  /** Pose courante (contrat neutre). `pitch` = inclinaison effective. */
  getPose(): CameraPose {
    const c = this.cur;
    return { targetX: c.tx, targetY: c.ty, targetZ: c.tz, distance: c.dist, yaw: c.yaw, pitch: this.pitchOf(c) };
  }

  /** Téléportation (but et pose courante). */
  setPose(p: Partial<CameraPose>): void {
    this.applyPose(this.goal, p);
    this.applyPose(this.cur, p);
  }

  /** Déplacement amorti vers une pose. */
  flyTo(p: Partial<CameraPose>): void { this.applyPose(this.goal, p); }

  /** Mémorise la pose de départ (touche H). */
  setHome(p?: Partial<CameraPose>): void {
    if (p) this.applyPose(this.home, p); else this.home = { ...this.goal };
  }

  private applyPose(o: Pose, p: Partial<CameraPose>): void {
    if (p.targetX !== undefined) o.tx = p.targetX;
    if (p.targetY !== undefined) o.ty = p.targetY;
    if (p.targetZ !== undefined) o.tz = p.targetZ;
    if (p.distance !== undefined) o.dist = clamp(p.distance, MIN_DISTANCE, MAX_DISTANCE);
    if (p.yaw !== undefined) o.yaw = p.yaw;
    if (p.pitch !== undefined) o.pitchOffset = p.pitch - autoPitch(o.dist);
  }

  /** Position piéton imposée (utilisée au prochain passage en vue rue au lieu du centre de vue). */
  setStreetPosition(x: number, z: number, yaw: number): void {
    const s = this.street;
    this.streetPreset = this.mode !== 'street';
    s.x = s.gx = x; s.z = s.gz = z; s.yaw = s.gyaw = yaw;
  }

  private pitchOf(p: Pose): number { return clamp(autoPitch(p.dist) + p.pitchOffset, MIN_PITCH, MAX_PITCH); }

  /* ------------------------------ Vues rapides ------------------------------ */

  setView(v: 'top' | 'north' | 'home' | 'oblique'): void {
    this.stopCinematic();
    if (this.mode === 'street') this.setMode('aerial');
    const g = this.goal;
    if (v === 'top') g.pitchOffset = MAX_PITCH - 0.02 - autoPitch(g.dist);
    else if (v === 'north') g.yaw = Math.round(g.yaw / (2 * Math.PI)) * 2 * Math.PI;
    else if (v === 'oblique') g.pitchOffset = 0;
    else { g.tx = this.home.tx; g.tz = this.home.tz; g.dist = this.home.dist; g.yaw = this.cur.yaw + angleDelta(this.cur.yaw, this.home.yaw); g.pitchOffset = this.home.pitchOffset; }
  }

  toggleCinematic(): void { if (this.cinematic) this.stopCinematic(); else this.startCinematic(); }

  startCinematic(): void {
    if (this.mode === 'street') this.setMode('aerial');
    this.cinematic = true;
    this.onCinematic?.(true);
  }

  stopCinematic(): void {
    if (!this.cinematic) return;
    this.cinematic = false;
    this.onCinematic?.(false);
  }

  private quickKey(code: string): void {
    switch (code) {
      case 'KeyT': this.setView('top'); break;
      case 'KeyN': this.setView('north'); break;
      case 'KeyH': case 'Home': this.setView('home'); break;
      case 'KeyC': this.toggleCinematic(); break;
      default: break;
    }
  }

  /* ------------------------------ Pointeurs ------------------------------ */

  private local(e: { clientX: number; clientY: number }): [number, number] {
    const r = this.dom.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  /** Rayon caméra passant par un point écran (px CSS relatifs au canvas). */
  screenRay(sx: number, sy: number, out?: Ray): Ray {
    const w = this.dom.clientWidth || 1;
    const h = this.dom.clientHeight || 1;
    _ndc.set((sx / w) * 2 - 1, -(sy / h) * 2 + 1);
    this.camera.updateMatrixWorld();
    _ray.setFromCamera(_ndc, this.camera);
    const o = out ?? { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 0 };
    o.ox = _ray.ray.origin.x; o.oy = _ray.ray.origin.y; o.oz = _ray.ray.origin.z;
    o.dx = _ray.ray.direction.x; o.dy = _ray.ray.direction.y; o.dz = _ray.ray.direction.z;
    return o;
  }

  /** Point du terrain sous un point écran, ou null (ciel). */
  groundAt(sx: number, sy: number): { x: number; y: number; z: number } | null {
    return rayTerrain(this.screenRay(sx, sy), this.heightAt, 9000);
  }

  /** Intersection avec le plan horizontal y = h (pour un déplacement stable par saisie). */
  private planeAt(sx: number, sy: number, h: number): { x: number; z: number } | null {
    const r = this.screenRay(sx, sy);
    if (r.dy > -1e-3) return null;
    const t = (h - r.oy) / r.dy;
    if (t < 0 || t > this.cur.dist * 8 + 500) return null;
    return { x: r.ox + r.dx * t, z: r.oz + r.dz * t };
  }

  private pointerDown(e: PointerEvent): void {
    this.dom.setPointerCapture?.(e.pointerId);
    const [sx, sy] = this.local(e);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx, sy, button: e.button, type: e.pointerType });
    this.stopCinematic();
    if (this.pointers.size === 1) {
      if (this.mode === 'street') { this.gesture = 'look'; return; }
      if (e.pointerType === 'mouse' && (e.button === 2 || e.button === 1)) { this.gesture = e.button === 2 ? 'orbit-pending' : 'orbit'; return; }
      if (e.pointerType === 'mouse' && e.shiftKey && !this.toolSink?.capturesPrimary('mouse')) { this.gesture = 'orbit'; return; }
      if (this.toolSink?.capturesPrimary(e.pointerType)) { this.gesture = 'tool'; this.toolSink.down(sx, sy, e.pointerType); return; }
      this.gesture = 'pan-pending';
    } else if (this.pointers.size === 2) {
      if (this.gesture === 'tool') this.toolSink?.cancel();
      this.gesture = 'pinch';
      this.resetPinch();
    }
  }

  private resetPinch(): void {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return;
    this.pinchMode = 'undecided';
    this.pinchAcc = { mx: 0, my: 0, d: 0, a: 0 };
    this.pinchDirty = false;
    this.lastPinch = { dist: Math.hypot(b.x - a.x, b.y - a.y), angle: Math.atan2(b.y - a.y, b.x - a.x), midX: (a.x + b.x) / 2, midY: (a.y + b.y) / 2 };
  }

  private pointerMove(e: PointerEvent): void {
    const p = this.pointers.get(e.pointerId);
    const [sx, sy] = this.local(e);
    if (!p) {
      // Survol sans bouton (souris / stylet) : aperçu des outils.
      if (this.pointers.size === 0 && e.target === this.dom) this.toolSink?.hover(sx, sy, e.pointerType);
      return;
    }
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    const psx = p.x; const psy = p.y;
    p.x = e.clientX; p.y = e.clientY;
    const moved = Math.hypot(sx - p.sx, sy - p.sy) > TAP_SLOP_PX;
    const h = this.dom.clientHeight || 800;
    switch (this.gesture) {
      case 'tool': this.toolSink?.move(sx, sy, e.pointerType); break;
      case 'look':
        if (this.pointers.size === 1) {
          this.street.gyaw -= dx * 0.0045;
          this.street.gpitch = clamp(this.street.gpitch - dy * 0.0045, -1.2, 1.2);
        }
        break;
      case 'orbit-pending':
      case 'orbit':
        if (this.gesture === 'orbit-pending') { if (!moved) break; this.gesture = 'orbit'; }
        this.goal.yaw -= dx * 0.006;
        this.goal.pitchOffset = this.clampOffset(this.goal.pitchOffset + dy * 0.005);
        break;
      case 'pan-pending':
      case 'pan': {
        if (this.gesture === 'pan-pending') { if (!moved) break; this.gesture = 'pan'; }
        const r = this.dom.getBoundingClientRect();
        this.panGrab(psx - r.left, psy - r.top, sx, sy, h);
        break;
      }
      case 'pinch': this.pinchDirty = true; break; // traité une fois par image (les doigts bougent l'un après l'autre)
      default: break;
    }
  }

  private pinchMove(): void {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return;
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    const dMidX = midX - this.lastPinch.midX;
    const dMidY = midY - this.lastPinch.midY;
    const dAngle = angleDelta(this.lastPinch.angle, angle);
    const dDist = dist - this.lastPinch.dist;
    const r = this.dom.getBoundingClientRect();
    if (this.mode === 'aerial') {
      // Classement du geste sur les premiers pixels, puis verrouillé jusqu'au lever des doigts :
      // glissé vertical des deux doigts ensemble (écart et angle quasi constants) = inclinaison ;
      // sinon déplacement + pincer + torsion combinés.
      const acc = this.pinchAcc;
      acc.mx += dMidX; acc.my += dMidY; acc.d += dDist; acc.a += dAngle;
      if (this.pinchMode === 'undecided') {
        const mag = Math.max(Math.hypot(acc.mx, acc.my), Math.abs(acc.d), Math.abs(acc.a) * 120);
        if (mag > 10) {
          const vertical = Math.abs(acc.my) > 2 * Math.abs(acc.mx) && Math.abs(acc.d) < 0.3 * Math.abs(acc.my) && Math.abs(acc.a) < 0.06;
          this.pinchMode = vertical ? 'tilt' : 'free';
        }
      }
      if (this.pinchMode === 'tilt') {
        this.goal.pitchOffset = this.clampOffset(this.goal.pitchOffset + dMidY * 0.004);
      } else {
        this.panGrab(this.lastPinch.midX - r.left, this.lastPinch.midY - r.top, midX - r.left, midY - r.top, this.dom.clientHeight || 800);
        if (this.lastPinch.dist > 0 && dist > 0) this.zoomAt(midX - r.left, midY - r.top, this.lastPinch.dist / dist);
        this.goal.yaw += dAngle;
      }
    } else {
      this.moveStreet(-dMidY * 0.06, dMidX * 0.06);
      this.street.gyaw += dAngle;
    }
    this.lastPinch = { dist, angle, midX, midY };
  }

  private pointerUp(e: PointerEvent, cancelled = false): void {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const [sx, sy] = this.local(e);
    const tap = !cancelled && Math.hypot(sx - p.sx, sy - p.sy) <= TAP_SLOP_PX;
    this.pointers.delete(e.pointerId);
    if (this.pointers.size === 0) {
      if (this.gesture === 'tool') { if (cancelled) this.toolSink?.cancel(); else this.toolSink?.up(sx, sy, e.pointerType, tap); }
      else if (this.gesture === 'pan-pending' && tap) this.toolSink?.up(sx, sy, e.pointerType, true);
      else if (this.gesture === 'orbit-pending' && tap) this.toolSink?.secondary();
      this.gesture = 'none';
    } else if (this.pointers.size === 1) {
      // Fin du pincement : on ne reprend pas de geste avec le doigt restant (évite les sauts).
      this.gesture = 'none';
    } else if (this.pointers.size === 2) this.resetPinch();
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    this.stopCinematic();
    const [sx, sy] = this.local(e);
    // deltaMode 1 = lignes (Firefox) : ~16 px par ligne.
    const d = e.deltaY * (e.deltaMode === 1 ? 16 : 1);
    if (this.mode === 'aerial') this.zoomAt(sx, sy, Math.exp(clamp(d, -300, 300) * 0.0015));
    else this.moveStreet(-d * 0.02, 0);
  }

  private clampOffset(o: number): number {
    const base = autoPitch(this.goal.dist);
    return clamp(o, MIN_PITCH - base, MAX_PITCH - base);
  }

  /**
   * Zoom vers un point écran : homothétie de centre P (point du sol sous le curseur), ce qui
   * garde P sous le curseur à orientation constante.
   */
  zoomAt(sx: number, sy: number, factor: number): void {
    const g = this.goal;
    const nd = clamp(g.dist * factor, MIN_DISTANCE, MAX_DISTANCE);
    const f = nd / g.dist;
    const p = this.groundAt(sx, sy);
    if (p && Math.hypot(p.x - g.tx, p.z - g.tz) < g.dist * 6) {
      g.tx = p.x + (g.tx - p.x) * f;
      g.tz = p.z + (g.tz - p.z) * f;
      this.clampTarget(g);
    }
    // Conserver l'inclinaison effective relative : le décalage personnel est borné pour la nouvelle distance.
    g.dist = nd;
    g.pitchOffset = this.clampOffset(g.pitchOffset);
  }

  /** Déplacement par « saisie » du sol : le point sous le doigt suit le doigt. */
  private panGrab(sx0: number, sy0: number, sx1: number, sy1: number, h: number): void {
    const a = this.planeAt(sx0, sy0, this.cur.ty);
    const b = this.planeAt(sx1, sy1, this.cur.ty);
    let dx: number; let dz: number;
    if (a && b) { dx = a.x - b.x; dz = a.z - b.z; } else {
      // Rayon proche de l'horizon : repli sur un déplacement proportionnel à la distance.
      const s = (this.cur.dist / h) * 1.2;
      const cy = Math.cos(this.goal.yaw); const syw = Math.sin(this.goal.yaw);
      const right = -(sx1 - sx0) * s; const fwd = (sy1 - sy0) * s;
      dx = right * cy - fwd * syw; dz = -right * syw - fwd * cy;
    }
    const lim = this.cur.dist * 0.5 + 20;
    const l = Math.hypot(dx, dz);
    if (l > lim) { dx *= lim / l; dz *= lim / l; }
    this.goal.tx += dx; this.goal.tz += dz;
    this.cur.tx += dx; this.cur.tz += dz; // saisie directe : pas de traînée
    this.clampTarget(this.goal); this.clampTarget(this.cur);
  }

  private panLocal(right: number, forward: number): void {
    const cy = Math.cos(this.goal.yaw);
    const sy = Math.sin(this.goal.yaw);
    this.goal.tx += right * cy - forward * sy;
    this.goal.tz += -right * sy - forward * cy;
    this.clampTarget(this.goal);
  }

  private clampTarget(p: Pose): void {
    p.tx = clamp(p.tx, this.bounds.minX, this.bounds.maxX);
    p.tz = clamp(p.tz, this.bounds.minZ, this.bounds.maxZ);
  }

  private moveStreet(forward: number, right: number): void {
    const s = this.street;
    const cy = Math.cos(s.gyaw);
    const sy = Math.sin(s.gyaw);
    const nx = clamp(s.gx + right * cy - forward * sy, this.bounds.minX, this.bounds.maxX);
    const nz = clamp(s.gz - right * sy - forward * cy, this.bounds.minZ, this.bounds.maxZ);
    // Collision : on glisse le long des murs (axes séparés).
    const blocked = this.isBlocked;
    if (!blocked || !blocked(nx, nz)) { s.gx = nx; s.gz = nz; return; }
    if (!blocked(nx, s.gz)) s.gx = nx;
    else if (!blocked(s.gx, nz)) s.gz = nz;
  }

  /* ------------------------------ Image par image ------------------------------ */

  update(dt: number): void {
    if (this.pinchDirty && this.gesture === 'pinch') { this.pinchDirty = false; this.pinchMove(); }
    const k = this.keys;
    const f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const r = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const c = this.camera;
    if (this.mode === 'aerial') {
      const g = this.goal;
      const anyKey = f || r || k.has('KeyE') || k.has('KeyQ') || k.has('KeyR') || k.has('KeyF') || k.has('PageUp') || k.has('PageDown') || k.has('Equal') || k.has('NumpadAdd') || k.has('Minus') || k.has('NumpadSubtract');
      if (anyKey) this.stopCinematic();
      const fast = k.has('ShiftLeft') || k.has('ShiftRight') ? 2.2 : 1;
      const speed = g.dist * 0.9 * dt * fast;
      if (f || r) this.panLocal(r * speed, f * speed);
      if (k.has('KeyE')) g.yaw -= 1.4 * dt;
      if (k.has('KeyQ')) g.yaw += 1.4 * dt;
      if (k.has('KeyR') || k.has('PageUp')) g.pitchOffset = this.clampOffset(g.pitchOffset + 0.9 * dt);
      if (k.has('KeyF') || k.has('PageDown')) g.pitchOffset = this.clampOffset(g.pitchOffset - 0.9 * dt);
      if (k.has('Equal') || k.has('NumpadAdd')) this.zoomAt((this.dom.clientWidth || 2) / 2, (this.dom.clientHeight || 2) / 2, Math.exp(-dt * 1.6));
      if (k.has('Minus') || k.has('NumpadSubtract')) this.zoomAt((this.dom.clientWidth || 2) / 2, (this.dom.clientHeight || 2) / 2, Math.exp(dt * 1.6));
      if (this.cinematic) g.yaw += 0.07 * dt;
      g.ty = this.heightAt(g.tx, g.tz);

      const cur = this.cur;
      const lam = this.smoothing;
      cur.tx = damp(cur.tx, g.tx, lam, dt);
      cur.tz = damp(cur.tz, g.tz, lam, dt);
      cur.ty = damp(cur.ty, g.ty, lam * 0.7, dt);
      // Zoom en espace logarithmique (vitesse perçue constante).
      cur.dist = Math.exp(damp(Math.log(cur.dist), Math.log(g.dist), lam, dt));
      cur.yaw = cur.yaw + angleDelta(cur.yaw, g.yaw) * (1 - Math.exp(-lam * dt));
      cur.pitchOffset = damp(cur.pitchOffset, g.pitchOffset, lam, dt);

      const pitch = this.pitchOf(cur);
      const cp = Math.cos(pitch);
      c.position.set(
        cur.tx + Math.sin(cur.yaw) * cp * cur.dist,
        cur.ty + Math.sin(pitch) * cur.dist,
        cur.tz + Math.cos(cur.yaw) * cp * cur.dist,
      );
      // Jamais sous le relief : on remonte la caméra (la cible reste en place).
      const ground = this.heightAt(c.position.x, c.position.z) + 1.4;
      if (c.position.y < ground) c.position.y = ground;
      c.lookAt(cur.tx, cur.ty + Math.min(1.6, cur.dist * 0.08), cur.tz);
      c.near = clamp(cur.dist / 300, 0.15, 4);
      c.far = Math.max(this.viewDistance, cur.dist * 3);
    } else {
      const s = this.street;
      const run = k.has('ShiftLeft') || k.has('ShiftRight') ? 3.5 : 1;
      if (f || r) this.moveStreet(f * 5 * run * dt, r * 5 * run * dt);
      if (k.has('KeyE')) s.gyaw -= 1.6 * dt;
      if (k.has('KeyQ')) s.gyaw += 1.6 * dt;
      const lam = this.smoothing * 1.3;
      s.x = damp(s.x, s.gx, lam, dt);
      s.z = damp(s.z, s.gz, lam, dt);
      s.yaw = s.yaw + angleDelta(s.yaw, s.gyaw) * (1 - Math.exp(-lam * dt));
      s.pitch = damp(s.pitch, s.gpitch, lam, dt);
      const gy = this.heightAt(s.x, s.z) + EYE_HEIGHT;
      s.y = s.y === 0 ? gy : damp(s.y, gy, 12, dt);
      c.position.set(s.x, s.y, s.z);
      const cp = Math.cos(s.pitch);
      _v.set(s.x - Math.sin(s.yaw) * cp, s.y + Math.sin(s.pitch), s.z - Math.cos(s.yaw) * cp);
      c.lookAt(_v);
      c.near = 0.15;
      c.far = this.viewDistance;
    }
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers = [];
  }
}
