/**
 * Contrôleur de caméra : mode aérien (orbite autour d'un point au sol) et mode rue
 * (hauteur de piéton, déplacement au sol). Souris + clavier + tactile.
 *
 * Aérien : clic gauche glissé = déplacer, clic droit glissé = pivoter/incliner,
 *          molette = zoom ; ZQSD (AZERTY) / WASD (QWERTY) / flèches = déplacer,
 *          A/E (AZERTY) = pivoter, R/F = incliner, +/- = zoom.
 *          Tactile : 1 doigt = déplacer, pincer = zoom, 2 doigts : rotation (torsion),
 *          inclinaison (glissé vertical), déplacement (glissé du point milieu).
 * Rue :    ZQSD/WASD/flèches = marcher, glisser = regarder ; Maj = courir.
 *          Tactile : 1 doigt = regarder, 2 doigts glissés = avancer/reculer/pas latéral.
 * Implémente ICameraController. Propriétaire : agent construction/caméra/UI.
 */
import * as THREE from 'three';
import type { CameraMode, CameraPose, ICameraController } from '../shared/contracts';
import { clamp } from '../shared/math';

export interface CameraBounds { minX: number; minZ: number; maxX: number; maxZ: number }

const EYE_HEIGHT = 1.7;

export class CameraController implements ICameraController {
  mode: CameraMode = 'aerial';
  private pose: CameraPose = { targetX: 0, targetY: 0, targetZ: 0, distance: 520, yaw: 0.6, pitch: 0.85 };
  /** Mode rue : position et orientation propres. */
  private street = { x: 0, z: 0, yaw: 0, pitch: 0 };
  private keys = new Set<string>();
  private pointers = new Map<number, { x: number; y: number; button: number }>();
  private lastPinch = { dist: 0, angle: 0, midX: 0, midY: 0 };
  private disposers: (() => void)[] = [];
  bounds: CameraBounds = { minX: -1000, minZ: -1000, maxX: 1000, maxZ: 1000 };
  /** Désactive le déplacement au clic gauche (quand un outil l'utilise). */
  leftDragPans = true;
  private onModeChange: ((m: CameraMode) => void) | null = null;

  constructor(private camera: THREE.PerspectiveCamera, private dom: HTMLElement, private heightAt: (x: number, z: number) => number) {
    const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement | Window, type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions): void => {
      el.addEventListener(type, fn as EventListener, opts);
      this.disposers.push(() => el.removeEventListener(type, fn as EventListener));
    };
    on(dom, 'contextmenu', (e) => e.preventDefault());
    on(dom, 'pointerdown', (e) => this.pointerDown(e));
    on(window, 'pointermove', (e) => this.pointerMove(e));
    on(window, 'pointerup', (e) => this.pointerUp(e));
    on(window, 'pointercancel', (e) => this.pointerUp(e));
    on(dom, 'wheel', (e) => this.wheel(e), { passive: false });
    on(window, 'keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      this.keys.add(e.code);
    });
    on(window, 'keyup', (e) => this.keys.delete(e.code));
    on(window, 'blur', () => { this.keys.clear(); this.pointers.clear(); });
    dom.style.touchAction = 'none';
  }

  setModeListener(fn: (m: CameraMode) => void): void { this.onModeChange = fn; }

  setMode(mode: CameraMode): void {
    if (mode === this.mode) return;
    if (mode === 'street') {
      this.street.x = this.pose.targetX;
      this.street.z = this.pose.targetZ;
      this.street.yaw = this.pose.yaw;
      this.street.pitch = -0.05;
    } else {
      this.pose.targetX = this.street.x;
      this.pose.targetZ = this.street.z;
      this.pose.yaw = this.street.yaw;
    }
    this.mode = mode;
    this.onModeChange?.(mode);
  }

  getPose(): CameraPose { return { ...this.pose }; }
  setPose(p: Partial<CameraPose>): void { Object.assign(this.pose, p); }
  setStreetPosition(x: number, z: number, yaw: number): void { this.street.x = x; this.street.z = z; this.street.yaw = yaw; }

  private pointerDown(e: PointerEvent): void {
    this.dom.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button });
    if (this.pointers.size === 2) this.resetPinch();
  }

  private resetPinch(): void {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return;
    this.lastPinch = { dist: Math.hypot(b.x - a.x, b.y - a.y), angle: Math.atan2(b.y - a.y, b.x - a.x), midX: (a.x + b.x) / 2, midY: (a.y + b.y) / 2 };
  }

  private pointerMove(e: PointerEvent): void {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    const h = this.dom.clientHeight || 800;
    if (this.pointers.size === 1) {
      if (this.mode === 'street') {
        this.street.yaw -= dx * 0.004;
        this.street.pitch = clamp(this.street.pitch - dy * 0.004, -1.2, 1.2);
      } else if (p.button === 2 || e.shiftKey) {
        this.pose.yaw -= dx * 0.005;
        this.pose.pitch = clamp(this.pose.pitch + dy * 0.004, 0.2, 1.45);
      } else if (this.leftDragPans || e.pointerType === 'touch') {
        this.panScreen(dx, dy, h);
      }
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      if (!a || !b) return;
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      const dMidX = midX - this.lastPinch.midX;
      const dMidY = midY - this.lastPinch.midY;
      let dAngle = angle - this.lastPinch.angle;
      if (dAngle > Math.PI) dAngle -= 2 * Math.PI;
      if (dAngle < -Math.PI) dAngle += 2 * Math.PI;
      if (this.mode === 'aerial') {
        if (this.lastPinch.dist > 0 && dist > 0) this.zoomBy(this.lastPinch.dist / dist);
        this.pose.yaw += dAngle;
        // Glissé vertical à deux doigts : inclinaison ; horizontal + vertical : déplacement.
        this.pose.pitch = clamp(this.pose.pitch + dMidY * 0.003, 0.2, 1.45);
        this.panScreen(dMidX, 0, h);
      } else {
        this.moveStreet(-dMidY * 0.08, dMidX * 0.08);
        this.street.yaw += dAngle;
      }
      this.lastPinch = { dist, angle, midX, midY };
    }
  }

  private pointerUp(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size === 2) this.resetPinch();
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    if (this.mode === 'aerial') this.zoomBy(Math.exp(e.deltaY * 0.0012));
    else this.moveStreet(-e.deltaY * 0.02, 0);
  }

  private zoomBy(f: number): void {
    this.pose.distance = clamp(this.pose.distance * f, 25, 2200);
  }

  private panScreen(dx: number, dy: number, h: number): void {
    const s = (this.pose.distance / h) * 1.2;
    this.panLocal(-dx * s, -dy * s);
  }

  private panLocal(right: number, forward: number): void {
    const cy = Math.cos(this.pose.yaw);
    const sy = Math.sin(this.pose.yaw);
    // Avant = direction de visée projetée au sol.
    this.pose.targetX += right * cy - forward * sy;
    this.pose.targetZ += -right * sy - forward * cy;
    this.pose.targetX = clamp(this.pose.targetX, this.bounds.minX, this.bounds.maxX);
    this.pose.targetZ = clamp(this.pose.targetZ, this.bounds.minZ, this.bounds.maxZ);
  }

  private moveStreet(forward: number, right: number): void {
    const cy = Math.cos(this.street.yaw);
    const sy = Math.sin(this.street.yaw);
    this.street.x = clamp(this.street.x + right * cy - forward * sy, this.bounds.minX, this.bounds.maxX);
    this.street.z = clamp(this.street.z - right * sy - forward * cy, this.bounds.minZ, this.bounds.maxZ);
  }

  update(dt: number): void {
    const k = this.keys;
    // e.code = position physique : WASD en QWERTY = ZQSD en AZERTY.
    const f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const r = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    if (this.mode === 'aerial') {
      const speed = this.pose.distance * 0.9 * dt;
      if (f || r) this.panLocal(r * speed, f * speed);
      if (k.has('KeyE')) this.pose.yaw -= 1.5 * dt;
      if (k.has('KeyQ')) this.pose.yaw += 1.5 * dt;
      if (k.has('KeyR')) this.pose.pitch = clamp(this.pose.pitch + dt, 0.2, 1.45);
      if (k.has('KeyF')) this.pose.pitch = clamp(this.pose.pitch - dt, 0.2, 1.45);
      if (k.has('Equal') || k.has('NumpadAdd')) this.zoomBy(Math.exp(-dt * 1.5));
      if (k.has('Minus') || k.has('NumpadSubtract')) this.zoomBy(Math.exp(dt * 1.5));
      const ty = this.heightAt(this.pose.targetX, this.pose.targetZ);
      this.pose.targetY += (ty - this.pose.targetY) * Math.min(1, dt * 6);
      const cp = Math.cos(this.pose.pitch);
      const c = this.camera;
      c.position.set(
        this.pose.targetX + Math.sin(this.pose.yaw) * cp * this.pose.distance,
        this.pose.targetY + Math.sin(this.pose.pitch) * this.pose.distance,
        this.pose.targetZ + Math.cos(this.pose.yaw) * cp * this.pose.distance,
      );
      const ground = this.heightAt(c.position.x, c.position.z) + 5;
      if (c.position.y < ground) c.position.y = ground;
      c.lookAt(this.pose.targetX, this.pose.targetY, this.pose.targetZ);
      c.near = Math.max(0.5, this.pose.distance / 400);
    } else {
      const run = k.has('ShiftLeft') || k.has('ShiftRight') ? 4 : 1;
      if (f || r) this.moveStreet(f * 6 * run * dt, r * 6 * run * dt);
      const c = this.camera;
      const y = this.heightAt(this.street.x, this.street.z) + EYE_HEIGHT;
      c.position.set(this.street.x, y, this.street.z);
      const cp = Math.cos(this.street.pitch);
      c.lookAt(this.street.x - Math.sin(this.street.yaw) * cp, y + Math.sin(this.street.pitch), this.street.z - Math.cos(this.street.yaw) * cp);
      c.near = 0.2;
    }
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers = [];
  }
}
