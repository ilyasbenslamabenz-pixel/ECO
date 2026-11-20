/**
 * Clavier (déplacement par position physique des touches : ZQSD sur AZERTY = WASD sur QWERTY, flèches aussi) et
 * manette tactile à l'écran (joystick) sur les appareils sans clavier. Les touches d'action passent par onKey.
 */
export class Controls {
  private readonly down = new Set<string>();
  private joy = { x: 0, y: 0 };
  onKey: ((key: string, e: KeyboardEvent) => void) | null = null;
  /** Faux quand un champ de saisie a le focus. */
  enabled = true;

  constructor() {
    window.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      this.down.add(e.code);
      if (!e.repeat) this.onKey?.(e.key.length === 1 ? e.key.toLowerCase() : e.key, e);
      if (e.code.startsWith('Arrow') || e.code === 'Space' || e.key === 'Tab') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
  }

  private has(...codes: string[]): boolean { return codes.some((c) => this.down.has(c)); }

  /** Axe de déplacement : x = droite, y = avant (−1..1). */
  axis(): { x: number; y: number } {
    let x = 0, y = 0;
    if (this.has('KeyW', 'ArrowUp')) y += 1;
    if (this.has('KeyS', 'ArrowDown')) y -= 1;
    if (this.has('KeyD', 'ArrowRight')) x += 1;
    if (this.has('KeyA', 'ArrowLeft')) x -= 1;
    x += this.joy.x; y += this.joy.y;
    const l = Math.hypot(x, y);
    return l > 1 ? { x: x / l, y: y / l } : { x, y };
  }
  get run(): boolean { return this.has('ShiftLeft', 'ShiftRight') || Math.hypot(this.joy.x, this.joy.y) > 0.92; }
  get brake(): boolean { return this.has('Space'); }

  /** Joystick tactile (affiché sur écran tactile). */
  mountJoystick(parent: HTMLElement): void {
    const base = document.createElement('div');
    base.className = 'joy';
    const knob = document.createElement('div');
    knob.className = 'joy-knob';
    base.append(knob);
    parent.append(base);
    let id = -1, cx = 0, cy = 0;
    const R = 46;
    base.addEventListener('pointerdown', (e) => { id = e.pointerId; base.setPointerCapture(id); const r = base.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; move(e); e.stopPropagation(); });
    const move = (e: PointerEvent): void => {
      if (e.pointerId !== id) return;
      let dx = e.clientX - cx, dy = e.clientY - cy;
      const l = Math.hypot(dx, dy);
      if (l > R) { dx = (dx / l) * R; dy = (dy / l) * R; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.joy = { x: dx / R, y: -dy / R };
    };
    base.addEventListener('pointermove', move);
    const end = (): void => { id = -1; this.joy = { x: 0, y: 0 }; knob.style.transform = ''; };
    base.addEventListener('pointerup', end);
    base.addEventListener('pointercancel', end);
  }
}
