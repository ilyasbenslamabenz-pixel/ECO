/**
 * Caméra à la troisième personne : orbite autour du personnage (glisser à la souris ou au doigt), molette ou
 * pincement pour la distance, raccourcie quand un immeuble masque le personnage. Un appui bref (sans glisser) est
 * transmis comme « clic » (onTap), avec le bouton utilisé. Dépend de three.
 */
import * as THREE from 'three';

export class FollowCamera {
  yaw = 0.5;
  pitch = 0.38;
  dist = 9;
  minDist = 2.5;
  maxDist = 45;
  minPitch = 0.05;
  maxPitch = 1.4;
  readonly focus = new THREE.Vector3();
  private cur = 9;
  private curPitch = 0.38;
  /** Le glisser du bouton gauche fait-il tourner la caméra ? (faux en mode aménagement : le gauche pose). */
  leftRotates = true;
  onTap: ((x: number, y: number, button: number) => void) | null = null;
  onHover: ((x: number, y: number) => void) | null = null;
  private readonly pointers = new Map<number, { x: number; y: number; sx: number; sy: number; button: number; moved: boolean }>();
  private pinch = 0;

  constructor(private readonly el: HTMLElement) {
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, button: e.button, moved: false });
      if (this.pointers.size === 2) this.pinch = this.spread();
    });
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      this.onHover?.(e.clientX - r.left, e.clientY - r.top);
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (Math.hypot(p.x - p.sx, p.y - p.sy) > 6) p.moved = true;
      if (this.pointers.size === 2) {
        const s = this.spread();
        if (this.pinch > 0 && s > 0) this.dist = clamp(this.dist * (this.pinch / s), this.minDist, this.maxDist);
        this.pinch = s;
        return;
      }
      if (p.button === 0 && !this.leftRotates && e.pointerType === 'mouse') return;
      if (!p.moved) return;
      this.yaw -= dx * 0.006;
      this.pitch = clamp(this.pitch + dy * 0.005, this.minPitch, this.maxPitch);
    });
    const up = (e: PointerEvent): void => {
      const p = this.pointers.get(e.pointerId);
      this.pointers.delete(e.pointerId);
      if (p && !p.moved && this.pointers.size === 0) { const r = el.getBoundingClientRect(); this.onTap?.(e.clientX - r.left, e.clientY - r.top, p.button); }
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', (e) => this.pointers.delete(e.pointerId));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('wheel', (e) => { e.preventDefault(); this.dist = clamp(this.dist * Math.exp(e.deltaY * 0.0012), this.minDist, this.maxDist); }, { passive: false });
  }

  private spread(): number {
    const ps = [...this.pointers.values()];
    return ps.length >= 2 ? Math.hypot(ps[0]!.x - ps[1]!.x, ps[0]!.y - ps[1]!.y) : 0;
  }

  /** Avant (direction de la caméra vers le personnage, à plat) et droite. */
  basis(): { f: [number, number]; r: [number, number] } {
    return { f: [-Math.sin(this.yaw), -Math.cos(this.yaw)], r: [Math.cos(this.yaw), -Math.sin(this.yaw)] };
  }

  /**
   * Place la caméra. `target` : point visé (tête du personnage) ; `clear` : part libre (0..1) du segment cible →
   * caméra (occlusion par les immeubles), facultatif.
   */
  apply(camera: THREE.PerspectiveCamera, target: THREE.Vector3, dt: number, clear?: (a: THREE.Vector3, b: THREE.Vector3) => number, snap = false): void {
    const k = snap ? 1 : 1 - Math.exp(-dt * 14);
    this.focus.lerp(target, k);
    const dirAt = (p: number): THREE.Vector3 => new THREE.Vector3(Math.sin(this.yaw) * Math.cos(p), Math.sin(p), Math.cos(this.yaw) * Math.cos(p));
    let want = this.dist, pitch = this.pitch;
    if (clear) {
      // Masqué par un immeuble : la caméra monte d'abord (vue plongeante), puis se rapproche si cela ne suffit pas.
      let best = 0, bestP = this.pitch;
      for (let p = this.pitch; p <= Math.max(this.pitch, 1.15) + 1e-6; p += 0.15) {
        const f = clear(this.focus, this.focus.clone().addScaledVector(dirAt(p), this.dist));
        if (f > best + 0.05) { best = f; bestP = p; }
        if (f > 0.97) break;
      }
      pitch = bestP;
      want = Math.max(1.4, this.dist * best - 0.4);
      // Fortement masqué et le joueur ne tourne pas la caméra : elle pivote d'elle-même vers l'angle dégagé le plus
      // proche (de 20° en 20°), en douceur.
      if (best < 0.5 && this.pointers.size === 0 && !snap) {
        for (const off of [0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.4, -1.4, 1.75, -1.75, 2.1, -2.1, 2.45, -2.45, Math.PI]) {
          const y = this.yaw + off;
          const d = new THREE.Vector3(Math.sin(y) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(y) * Math.cos(this.pitch));
          if (clear(this.focus, this.focus.clone().addScaledVector(d, this.dist)) > 0.9) { this.yaw += off * Math.min(1, dt * 2.5); break; }
        }
      }
    }
    this.curPitch += (pitch - this.curPitch) * (snap ? 1 : Math.min(1, dt * 5));
    const dir = dirAt(this.curPitch);
    // Se rapproche vite (pour ne pas traverser un mur), s'éloigne doucement.
    this.cur += (want - this.cur) * (snap ? 1 : want < this.cur ? Math.min(1, dt * 20) : Math.min(1, dt * 3));
    camera.position.copy(this.focus).addScaledVector(dir, this.cur);
    camera.lookAt(this.focus);
  }
}

const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
