/**
 * Vie dans un commerce : chaque vente de la simulation fait entrer un client qui va aux meubles des produits
 * achetés, fait la queue à une caisse, paie et ressort. Les employés se tiennent derrière les caisses (les autres
 * passent entre les rayons). Chemins sur la grille (recherche en largeur), vitesse proportionnelle au temps de jeu.
 * Dépend de three.
 */
import * as THREE from 'three';
import { FURNITURE_BY_ID, PRODUCT_BY_ID } from '../sim/catalog';
import { doorCells, frontDir, neighbourCells, registerSides } from '../sim/layout';
import { findPath } from '../world/pathfind';
import { Humanoid, lookFrom, type Look } from './humanoid';
import type { InteriorItem, InteriorView } from './interior-view';

const MAX_CUSTOMERS = 22;

type Step = { kind: 'browse'; cell: [number, number]; look: [number, number] } | { kind: 'pay' } | { kind: 'exit' };

interface Register { uid: number; front: [number, number][]; back: [number, number][]; dir: [number, number]; queue: Customer[]; tended: boolean }

interface Mover { h: Humanoid; x: number; z: number; heading: number; route: [number, number][]; speed: number }
interface Customer extends Mover { arrive: Step | null; plan: Step[]; state: 'walk' | 'browse' | 'queue' | 'pay' | 'leave'; timer: number; reg: Register | null; slot: number; jx: number; jz: number }
interface Staff extends Mover { id: number; idle: number }

const headingTo = (dx: number, dz: number): number => Math.atan2(-dx, -dz);

export class InteriorAgents {
  readonly group = new THREE.Group();
  private customers: Customer[] = [];
  private staff: Staff[] = [];
  private registers: Register[] = [];
  private seed = 1;
  /** Caisse tenue par le joueur (uid), à exclure des employés. */
  playerRegister: number | null = null;

  constructor(private readonly view: InteriorView, private readonly accent: string) { view.scene.add(this.group); }

  get customerCount(): number { return this.customers.length; }

  /** À appeler après un changement de mobilier. */
  refreshLayout(): void {
    const old = new Map(this.registers.map((r) => [r.uid, r]));
    this.registers = this.view.items.filter((i) => i.def === 'caisse').map((it) => {
      const s = registerSides(it, FURNITURE_BY_ID.get('caisse')!);
      const ok = (c: [number, number]): boolean => !this.view.walkBlocked(c[0], c[1]);
      return { uid: it.uid, front: s.front.filter(ok), back: s.back.filter(ok), dir: frontDir(it.rot), queue: old.get(it.uid)?.queue ?? [], tended: false };
    });
    // Les clients dont la caisse a disparu repartent.
    for (const c of this.customers) if (c.reg && !this.registers.includes(c.reg) && !this.registers.some((r) => r.uid === c.reg!.uid)) { c.reg = null; c.plan = [{ kind: 'exit' }]; this.next(c); }
    for (const c of this.customers) if (c.reg) c.reg = this.registers.find((r) => r.uid === c.reg!.uid) ?? null;
  }

  /** Point où se tient le caissier d'une caisse (pour le joueur), ou null. */
  registerSpot(uid: number): { x: number; z: number; heading: number } | null {
    const r = this.registers.find((x) => x.uid === uid);
    if (!r || !r.back.length) return null;
    const [x, z] = this.view.cellCenter(r.back[0]![0], r.back[0]![1]);
    return { x, z, heading: headingTo(r.dir[0], r.dir[1]) };
  }

  /** Caisse sans employé la plus proche d'un point (pour le joueur). */
  freeRegisterNear(x: number, z: number, maxDist: number): number | null {
    let best: number | null = null, bd = maxDist;
    for (const [k, r] of this.registers.entries()) {
      if (k < this.staff.length || !r.back.length) continue;
      const [bx, bz] = this.view.cellCenter(r.back[0]![0], r.back[0]![1]);
      const d = Math.hypot(bx - x, bz - z);
      if (d < bd) { bd = d; best = r.uid; }
    }
    return best;
  }

  /** Employés présents (ouvert) : un par caisse, les autres en rayon. */
  setStaff(list: { id: number; look: number }[]): void {
    const ids = new Set(list.map((e) => e.id));
    for (const s of this.staff) if (!ids.has(s.id)) this.group.remove(s.h.group);
    this.staff = this.staff.filter((s) => ids.has(s.id));
    for (const e of list) {
      if (this.staff.some((s) => s.id === e.id)) continue;
      const h = new Humanoid(lookFrom(e.look, this.accent));
      const [x, z] = this.view.cellCenter(...this.door());
      this.group.add(h.group);
      this.staff.push({ id: e.id, h, x, z, heading: Math.PI, route: [], speed: 0, idle: 0 });
    }
  }

  private door(): [number, number] { return doorCells(this.view.W, this.view.D)[0]!; }

  /** Un client entre pour acheter `products`. */
  spawn(products: string[]): void {
    if (this.customers.length >= MAX_CUSTOMERS || !this.registers.length) return;
    const plan: Step[] = [];
    const seen = new Set<string>();
    for (const pid of products) {
      if (seen.has(pid)) continue;
      seen.add(pid);
      const store = PRODUCT_BY_ID.get(pid)?.store;
      const cands = this.view.items.filter((i) => FURNITURE_BY_ID.get(i.def)?.kind === store || (store === 'comptoir' && i.def === 'machine'));
      if (!cands.length) continue;
      const it = cands[Math.floor(this.rand() * cands.length)]!;
      const cell = this.accessCell(it);
      if (cell) plan.push({ kind: 'browse', cell, look: this.itemCenter(it) });
    }
    plan.push({ kind: 'pay' }, { kind: 'exit' });
    const [ox, oz] = this.view.outside();
    const look: Look = lookFrom(Math.floor(this.rand() * 1e6));
    const h = new Humanoid(look, 0.94 + this.rand() * 0.1);
    this.group.add(h.group);
    const [dx, dz] = this.view.cellCenter(...this.door());
    this.customers.push({ h, x: ox + (this.rand() - 0.5) * 2, z: oz + 1, heading: 0, route: [[dx, dz]], speed: 1.25 + this.rand() * 0.35, arrive: null, plan, state: 'walk', timer: 0, reg: null, slot: 0, jx: (this.rand() - 0.5) * 0.3, jz: (this.rand() - 0.5) * 0.3 });
  }

  private rand(): number { this.seed = (this.seed * 16807) % 2147483647; return this.seed / 2147483647; }

  private itemCenter(it: InteriorItem): [number, number] {
    const def = FURNITURE_BY_ID.get(it.def)!;
    const w = it.rot % 2 ? def.d : def.w, d = it.rot % 2 ? def.w : def.d;
    return [it.x + w / 2 - this.view.W / 2, it.z + d / 2 - this.view.D / 2];
  }

  private accessCell(it: InteriorItem): [number, number] | null {
    const def = FURNITURE_BY_ID.get(it.def)!;
    const cells = neighbourCells(it, def).filter(([x, z]) => !this.view.walkBlocked(x, z));
    if (!cells.length) return null;
    const front = cells.slice(0, Math.max(1, Math.min(3, cells.length)));
    return front[Math.floor(this.rand() * front.length)]!;
  }

  private routeTo(m: Mover, cell: [number, number], jx = 0, jz = 0): boolean {
    let from = this.view.cellAt(m.x, m.z);
    if (!this.view.inside(from[0], from[1])) from = this.door();
    const path = findPath(this.view.W, this.view.D, (x, z) => this.view.walkBlocked(x, z), from, cell);
    if (!path) return false;
    m.route = path.map(([x, z]) => { const [wx, wz] = this.view.cellCenter(x, z); return [wx + jx, wz + jz] as [number, number]; });
    return true;
  }

  /** Étape suivante du plan d'un client. */
  private next(c: Customer): void {
    const st = c.plan.shift();
    if (!st) { c.state = 'leave'; return; }
    if (st.kind === 'browse') {
      if (!this.routeTo(c, st.cell, c.jx, c.jz)) { this.next(c); return; }
      c.state = 'walk';
    } else if (st.kind === 'pay') {
      const regs = this.registers.filter((r) => r.front.length);
      if (!regs.length) { this.next(c); return; }
      const staffed = regs.filter((r, k) => k < this.staff.length || r.uid === this.playerRegister);
      const pool = staffed.length ? staffed : regs;
      const reg = pool.reduce((a, b) => (b.queue.length < a.queue.length ? b : a));
      reg.queue.push(c);
      c.reg = reg;
      c.slot = -1;
      c.state = 'queue';
    } else {
      const [dx, dz] = this.view.cellCenter(...this.door());
      this.routeTo(c, this.door());
      const [ox, oz] = this.view.outside();
      c.route.push([dx, dz], [ox + c.jx * 4, oz + 2.5]);
      c.state = 'leave';
    }
    c.arrive = st;
  }

  private slotCell(r: Register, k: number): [number, number] {
    const f = r.front[0]!;
    for (let i = k; i >= 0; i--) {
      const c: [number, number] = [f[0] + r.dir[0] * i, f[1] + r.dir[1] * i];
      if (!this.view.walkBlocked(c[0], c[1])) return c;
    }
    return f;
  }

  /** Avance d'un pas le long de la route ; vrai à l'arrivée. */
  private step(m: Mover, dt: number, ts: number): boolean {
    const t = m.route[0];
    if (!t) { m.h.update(dt, 0); return true; }
    const dx = t[0] - m.x, dz = t[1] - m.z, d = Math.hypot(dx, dz);
    const v = m.speed * ts;
    if (d <= v * dt) { m.x = t[0]; m.z = t[1]; m.route.shift(); }
    else { m.x += (dx / d) * v * dt; m.z += (dz / d) * v * dt; m.heading = turn(m.heading, headingTo(dx, dz), dt * 10); }
    m.h.update(dt, Math.min(2.5, v));
    return m.route.length === 0;
  }

  update(dt: number, timeScale: number, open: boolean): void {
    const ts = Math.max(0.5, Math.min(4, timeScale));
    // Employés.
    this.registers.forEach((r) => { r.tended = false; });
    this.staff.forEach((s, k) => {
      s.h.group.visible = open;
      const r = this.registers[k];
      if (r && r.back.length && r.uid !== this.playerRegister) {
        r.tended = true;
        const [tx, tz] = this.view.cellCenter(r.back[0]![0], r.back[0]![1]);
        if (Math.hypot(tx - s.x, tz - s.z) > 0.05 && !s.route.length) this.routeTo(s, r.back[0]!);
        if (this.step(s, dt, ts)) s.heading = turn(s.heading, headingTo(r.dir[0], r.dir[1]), dt * 8);
      } else {
        s.idle -= dt * ts;
        if (s.idle <= 0 && !s.route.length) {
          s.idle = 6 + this.rand() * 8;
          const shelf = this.view.items.filter((i) => FURNITURE_BY_ID.get(i.def)?.capacity);
          const it = shelf[Math.floor(this.rand() * shelf.length)];
          const cell = it ? this.accessCell(it) : null;
          if (cell) this.routeTo(s, cell);
        }
        this.step(s, dt, ts);
      }
      s.h.group.position.set(s.x, 0, s.z);
      s.h.group.rotation.y = s.heading;
    });
    // Clients.
    const keep: Customer[] = [];
    for (const c of this.customers) {
      const arrived = this.step(c, dt, ts);
      const arrive = c.arrive;
      if (c.state === 'walk' && arrived) {
        if (arrive?.kind === 'browse') { c.state = 'browse'; c.timer = 1.6 + this.rand() * 2; c.heading = headingTo(arrive.look[0] - c.x, arrive.look[1] - c.z); }
        else this.next(c);
      } else if (c.state === 'browse') {
        c.timer -= dt * ts;
        if (c.timer <= 0) this.next(c);
      } else if (c.state === 'queue' && c.reg) {
        const k = c.reg.queue.indexOf(c);
        if (k !== c.slot) { c.slot = k; this.routeTo(c, this.slotCell(c.reg, k), c.jx * 0.5, c.jz * 0.5); }
        if (arrived && k === 0) { c.state = 'pay'; c.timer = 2.2; c.heading = headingTo(-c.reg.dir[0], -c.reg.dir[1]); }
      } else if (c.state === 'pay') {
        c.timer -= dt * ts;
        if (c.timer <= 0) { c.reg?.queue.shift(); c.reg = null; this.next(c); }
      } else if (c.state === 'leave' && arrived) {
        this.group.remove(c.h.group);
        continue;
      }
      c.h.group.position.set(c.x, 0, c.z);
      c.h.group.rotation.y = c.heading;
      keep.push(c);
    }
    this.customers = keep;
  }

  clear(): void {
    for (const c of this.customers) this.group.remove(c.h.group);
    this.customers = [];
    for (const r of this.registers) r.queue = [];
  }
}

function turn(a: number, b: number, k: number): number {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * Math.min(1, k);
}
