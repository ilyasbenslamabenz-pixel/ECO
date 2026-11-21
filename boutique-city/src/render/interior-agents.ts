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
import { makePerson, type Person } from './humanoid';
import type { InteriorItem, InteriorView } from './interior-view';
import { disposeOwn } from './kit';
import type { FeedbackKind } from '../sim/game';

const MAX_CUSTOMERS = 14;

type Step = { kind: 'browse'; cell: [number, number]; look: [number, number] } | { kind: 'pay' } | { kind: 'react'; t: number } | { kind: 'exit' };

/**
 * Caisse : cases devant (clients) et derrière (caissier), triées de la plus proche à la plus éloignée de la caisse
 * enregistreuse posée sur le comptoir ; `line` : cases de la file d'attente (calculées à la demande).
 */
interface Register { uid: number; front: [number, number][]; back: [number, number][]; dir: [number, number]; queue: Customer[]; tended: boolean; center: [number, number]; line: [number, number][] | null }

/**
 * Étiquette flottante (bulle d'avis, humeur, montant d'une vente) : sprite dans le repère de la scène, replacé à
 * chaque image par `layout` pour ne jamais en recouvrir une autre à l'écran.
 */
interface Label {
  sp: THREE.Sprite;
  /** Taille (m), priorité de placement (montants 3, plaintes 2, avis positifs 1, humeurs 0), date de création (s). */
  w: number; h: number; prio: number; born: number;
  /** Ancrage (bas de l'étiquette) et centre sans décalage ; montée propre (montants) et décalage de mise en page lissé, en m vers le haut de l'écran. */
  at: THREE.Vector3; base: THREE.Vector3; rise: number; lift: number;
  /** Déjà mise en page une fois (le premier placement se fait d'emblée, sans lissage). */
  placed: boolean;
}

interface Mover { h: Person; x: number; z: number; heading: number; route: [number, number][]; speed: number; face: number | null }
interface Customer extends Mover { amount?: number; bubble?: Label; bubbleT?: number; arrive: Step | null; plan: Step[]; state: 'walk' | 'browse' | 'queue' | 'pay' | 'done' | 'react' | 'leave'; timer: number; reg: Register | null; slot: number; jx: number; jz: number }
interface Staff extends Mover { id: number; idle: number }

/** Longueur maximale d'une file d'attente dessinée (au-delà, les clients se rangent au plus près). */
const MAX_LINE = 10;
/** Au plus 3 bulles d'avis (voir `bubble` : la moins importante cède sa place) et 3 humeurs affichées à la fois. */
const MAX_BUBBLES = 3, MAX_ICONS = 3;
/** Écart (m) entre deux étiquettes voisines à l'écran. */
const LABEL_GAP = 0.08;
const UP = new THREE.Vector3(), V = new THREE.Vector3();

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
      // Caisse enregistreuse du modèle : à x = −0,45 m (repère du meuble, face avant +z), tournée avec le meuble.
      const center = this.itemCenter(it), a = (it.rot * Math.PI) / 2;
      const till: [number, number] = [center[0] - 0.45 * Math.cos(a), center[1] + 0.45 * Math.sin(a)];
      const near = (c: [number, number]): number => { const [x, z] = this.view.cellCenter(c[0], c[1]); return Math.hypot(x - till[0], z - till[1]); };
      const byNear = (l: [number, number][]): [number, number][] => l.filter(ok).sort((p, q) => near(p) - near(q));
      return { uid: it.uid, front: byNear(s.front), back: byNear(s.back), dir: frontDir(it.rot), queue: old.get(it.uid)?.queue ?? [], tended: false, center, line: null };
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
      const h = makePerson(e.look, this.accent, 1, true);
      const [x, z] = this.view.cellCenter(...this.door());
      this.group.add(h.group);
      // Employés : allure de marche normale (vitesse 0 = jamais arrivés à leur poste).
      this.staff.push({ id: e.id, h, x, z, heading: Math.PI, face: null, route: [], speed: 1.4, idle: 0 });
    }
  }

  private door(): [number, number] { return doorCells(this.view.W, this.view.D)[0]!; }

  /** Un client entre pour acheter `products`. */
  spawn(products: string[], amount = 0): void {
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
    const h = makePerson(Math.floor(this.rand() * 1e6), undefined, 0.94 + this.rand() * 0.1);
    this.group.add(h.group);
    const [dx, dz] = this.view.cellCenter(...this.door());
    this.customers.push({ h, x: ox + (this.rand() - 0.5) * 2, z: oz + 1, heading: 0, face: null, route: [[dx, dz]], speed: 1.25 + this.rand() * 0.35, arrive: null, plan, amount, state: 'walk', timer: 0, reg: null, slot: 0, jx: (this.rand() - 0.5) * 0.3, jz: (this.rand() - 0.5) * 0.3 });
  }

  /**
   * Avis d'un client, en bulle au-dessus de sa tête : « content » sur un client présent ; sinon un client entre,
   * montre la raison de son départ (trop cher, rupture, attente, personne en caisse) et ressort.
   */
  feedback(kind: FeedbackKind): void {
    // Avis d'un client servi (ravi, ou gêné par la saleté) : sur un client déjà présent.
    if (kind === 'content' || kind === 'sale') {
      const c = this.customers.find((x) => !x.bubble && (x.state === 'pay' || x.state === 'queue' || x.state === 'browse'));
      if (c) this.say(c, kind);
      return;
    }
    if (this.customers.length >= MAX_CUSTOMERS) return;
    const [ox, oz] = this.view.outside();
    const [dx, dz] = this.view.cellCenter(...this.door());
    const h = makePerson(Math.floor(this.rand() * 1e6), undefined, 0.94 + this.rand() * 0.1);
    this.group.add(h.group);
    const c: Customer = { h, x: ox + (this.rand() - 0.5) * 2, z: oz + 1, heading: 0, face: null, route: [[dx + (this.rand() - 0.5) * 0.8, dz - 1.2]], speed: 1.3, arrive: null, plan: [{ kind: 'react', t: 1.8 }, { kind: 'exit' }], state: 'walk', timer: 0, reg: null, slot: 0, jx: 0, jz: 0 };
    this.customers.push(c);
    this.say(c, kind);
    this.next(c);
  }

  /** Montants des ventes : montent vers le haut de l'écran et s'effacent en 1,6 s. */
  private floats: { l: Label; t: number; x: number; z: number }[] = [];
  private floatText(text: string, x: number, z: number): void {
    const l = this.label(moneyMaterial(text), 1.25, 0.4, 3, 22);
    l.at.set(x, 1.55, z);
    // Ventes rapprochées à la même caisse : le montant prend le plus bas créneau libre de la pile. Tous montent à la
    // même vitesse : deux créneaux espacés d'une hauteur ne se recouvrent jamais, et la pile ne grimpe pas sans fin.
    const step = l.h + LABEL_GAP;
    const near = this.floats.filter((f) => Math.hypot(f.x - x, f.z - z) < 1.2).map((f) => f.l.rise);
    l.rise = [0, ...near.map((r) => r + step)].sort((a, b) => a - b).find((r) => near.every((o) => Math.abs(o - r) >= step - 1e-6)) ?? 0;
    this.floats.push({ l, t: 0, x, z });
  }

  /** Horloge (s) des étiquettes, et caméra du dernier rendu, relevée par les étiquettes elles-mêmes (voir `label`). */
  private clock = 0;
  private cam: THREE.PerspectiveCamera | null = null;
  private readonly peek = (_r: THREE.WebGLRenderer, _s: THREE.Scene, cam: THREE.Camera): void => {
    if ((cam as THREE.PerspectiveCamera).isPerspectiveCamera) this.cam = cam as THREE.PerspectiveCamera;
  };

  private label(material: THREE.SpriteMaterial, w: number, h: number, prio: number, order: number): Label {
    const sp = new THREE.Sprite(material);
    sp.scale.set(w, h, 1);
    sp.renderOrder = order;
    sp.onBeforeRender = this.peek;
    this.group.add(sp);
    return { sp, w, h, prio, born: this.clock, at: new THREE.Vector3(), base: new THREE.Vector3(), rise: 0, lift: 0, placed: false };
  }

  /** Bulle (plainte : prio 2, avis positif : 1, humeur : 0) au-dessus d'un client, à la place de la précédente. */
  private bubble(c: Customer, material: THREE.SpriteMaterial, w: number, prio: number, life: number): void {
    this.unbubble(c);
    // Au plus MAX_BUBBLES bulles d'avis : les plaintes passent avant les avis positifs, les récentes avant les
    // anciennes (la plus faible s'efface ; une nouvelle bulle plus faible que toutes n'est pas montrée).
    const shown = prio > 0 ? this.customers.filter((o) => o.bubble && o.bubble.prio > 0) : [];
    if (shown.length >= MAX_BUBBLES) {
      const weakest = shown.reduce((a, b) => (b.bubble!.prio < a.bubble!.prio || (b.bubble!.prio === a.bubble!.prio && b.bubble!.born < a.bubble!.born) ? b : a));
      if (weakest.bubble!.prio > prio) return;
      this.unbubble(weakest);
    }
    c.bubble = this.label(material, w, 0.6, prio, 20);
    c.bubbleT = life;
  }

  private unbubble(c: Customer): void {
    if (!c.bubble) return;
    this.group.remove(c.bubble.sp);
    c.bubble = undefined;
  }

  /** Humeur (visage dessiné, lisible sans police d'émojis) au-dessus d'un client. */
  private sayIcon(c: Customer, mood: Mood): void { this.bubble(c, iconMaterial(mood), 0.6, 0, 1.6); }

  private say(c: Customer, kind: FeedbackKind): void { this.bubble(c, bubbleMaterial(kind), 1.8, kind === 'content' ? 1 : 2, 3.2); }

  /**
   * Mise en page des étiquettes à l'écran : chacune part de son ancrage (au-dessus de la tête du client, ou de la
   * caisse) et s'élève selon l'axe « haut » de la caméra, donc vers le haut de l'écran quel que soit l'angle de vue,
   * jusqu'à ne plus recouvrir aucune étiquette déjà placée. Montants et bulles d'avis sont placés de bas en haut de
   * l'écran (chaque bulle reste près de son client ; une bulle déjà relevée reste au-dessus de sa voisine, sans
   * permutation au moindre pas), les humeurs ensuite, là où il reste de la place. Une humeur sans place proche (ou
   * au-delà de MAX_ICONS) est masquée, de même qu'une bulle d'avis repoussée trop loin. Décalages lissés.
   */
  private layout(dt: number): void {
    for (const c of this.customers) if (c.bubble) c.bubble.at.set(c.x, c.h.top * c.h.group.scale.y + 0.12, c.z);
    const labels = [...this.customers.flatMap((c) => (c.bubble ? [c.bubble] : [])), ...this.floats.map((f) => f.l)];
    if (!labels.length) return;
    const cam = this.cam;
    const up = cam ? UP.setFromMatrixColumn(cam.matrixWorld, 1).normalize() : UP.set(0, 1, 0);
    const tanHalf = cam ? Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) / cam.zoom : 1;
    // Rectangle de chaque étiquette à l'écran (coordonnées normalisées), sans décalage ; `unit` : mètres par unité
    // d'écran à sa profondeur (0 : hors champ ou caméra inconnue, pas de mise en page).
    const recs = labels.map((l) => {
      l.base.copy(l.at).addScaledVector(up, l.h / 2 + l.rise);
      if (cam) V.copy(l.base).applyMatrix4(cam.matrixWorldInverse);
      if (!cam || -V.z <= cam.near) return { l, unit: 0, x: 0, y: 0, hw: 0, hh: 0 };
      const unit = -V.z * tanHalf;
      V.applyMatrix4(cam.projectionMatrix);
      return { l, unit, x: V.x, y: V.y, hw: l.w / (unit * cam.aspect) / 2, hh: l.h / unit / 2 };
    });
    const key = (r: (typeof recs)[number]): number => r.y - r.hh + (r.l.lift > 1e-3 ? r.hh : 0);
    recs.sort((a, b) => Number(a.l.prio === 0) - Number(b.l.prio === 0) || key(a) - key(b));
    const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
    const k = 1 - Math.exp(-dt * 12);
    let icons = 0;
    for (const { l, unit, x, y, hw, hh } of recs) {
      let lift = 0, show = true;
      if (unit > 0) {
        const gap = LABEL_GAP / unit;
        let s = 0;
        for (let moved = true, n = 0; moved && n <= placed.length; n++) {
          moved = false;
          for (const q of placed) {
            if (x - hw < q.x1 && x + hw > q.x0 && y - hh + s < q.y1 + gap && y + hh + s > q.y0 - gap) { s = q.y1 + gap - (y - hh); moved = true; }
          }
        }
        // Montants toujours affichés ; bulle d'avis relevée de plus de trois hauteurs, humeur de plus d'une : masquée.
        show = l.prio >= 3 || (l.prio > 0 ? s <= 6 * hh : icons < MAX_ICONS && s <= 2 * hh);
        if (show) placed.push({ x0: x - hw, x1: x + hw, y0: y - hh + s, y1: y + hh + s });
        // Montant : décalage seulement croissant (il continue de monter, sans redescendre quand un voisin s'efface).
        lift = l.prio >= 3 && l.placed ? Math.max(l.lift, s * unit) : s * unit;
      }
      if (show && l.prio === 0) icons++;
      l.lift = l.placed ? l.lift + (lift - l.lift) * k : lift;
      l.placed = true;
      l.sp.visible = show;
      l.sp.position.copy(l.base).addScaledVector(up, l.lift);
      // Apparition des bulles : léger rebond d'échelle.
      if (l.prio < 3) { const a = Math.min(1, (this.clock - l.born) / 0.22), e = a - 1, pop = 0.55 + 0.45 * (1 + 2.70158 * e * e * e + 1.70158 * e * e); l.sp.scale.set(l.w * pop, l.h * pop, 1); }
    }
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
      const staffed = regs.filter((r) => r.tended || r.uid === this.playerRegister);
      const pool = staffed.length ? staffed : regs;
      const reg = pool.reduce((a, b) => (b.queue.length < a.queue.length ? b : a));
      reg.queue.push(c);
      c.reg = reg;
      c.slot = -1;
      c.state = 'queue';
    } else if (st.kind === 'react') {
      c.state = 'react'; c.timer = st.t; c.route = c.route.slice(0, 1);
    } else {
      const [dx, dz] = this.view.cellCenter(...this.door());
      this.routeTo(c, this.door());
      const [ox, oz] = this.view.outside();
      c.route.push([dx, dz], [ox + c.jx * 4, oz + 2.5]);
      c.state = 'leave';
    }
    c.arrive = st;
  }

  /**
   * Case de la k-ième place de la file d'une caisse : en ligne droite devant la caisse enregistreuse, dans l'axe de
   * la caisse (une case par client, donc 1 m d'écart) ; si un meuble ou un mur coupe la ligne, la file tourne vers
   * les cases libres les plus proches (recherche en largeur). Jamais sur les cases de la porte.
   */
  private slotCell(r: Register, k: number): [number, number] {
    if (!r.line) r.line = this.queueLine(r);
    return r.line[Math.min(k, r.line.length - 1)] ?? r.front[0]!;
  }

  private queueLine(r: Register): [number, number][] {
    const W = this.view.W;
    const door = new Set(doorCells(this.view.W, this.view.D).map(([x, z]) => z * W + x));
    const used = new Set<number>();
    const free = (x: number, z: number): boolean => this.view.inside(x, z) && !this.view.walkBlocked(x, z) && !door.has(z * W + x) && !used.has(z * W + x);
    const out: [number, number][] = [];
    let [x, z] = r.front[0]!;
    out.push([x, z]); used.add(z * W + x);
    while (out.length < MAX_LINE && free(x + r.dir[0], z + r.dir[1])) { x += r.dir[0]; z += r.dir[1]; out.push([x, z]); used.add(z * W + x); }
    // Suite : cases libres les plus proches de la dernière, en privilégiant les côtés de la ligne.
    const q: [number, number][] = [[x, z]];
    const seen = new Set<number>([z * W + x]);
    for (let h = 0; h < q.length && out.length < MAX_LINE; h++) {
      const [cx, cz] = q[h]!;
      for (const [dx, dz] of [[r.dir[1], r.dir[0]], [-r.dir[1], -r.dir[0]], [r.dir[0], r.dir[1]], [-r.dir[0], -r.dir[1]]] as const) {
        const nx = cx + dx, nz = cz + dz, key = nz * W + nx;
        if (seen.has(key) || !this.view.inside(nx, nz) || this.view.walkBlocked(nx, nz)) continue;
        seen.add(key);
        q.push([nx, nz]);
        if (free(nx, nz)) { out.push([nx, nz]); used.add(key); }
      }
    }
    return out;
  }

  /** Avance d'un pas le long de la route ; vrai à l'arrivée. */
  private step(m: Mover, dt: number, ts: number): boolean {
    const t = m.route[0];
    if (!t) {
      // À l'arrêt : se tourne en douceur vers ce qu'il regarde (caisse, rayon, clients).
      if (m.face !== null) m.heading = turn(m.heading, m.face, dt * 7);
      m.h.update(dt, 0);
      return true;
    }
    const dx = t[0] - m.x, dz = t[1] - m.z, d = Math.hypot(dx, dz);
    const v = m.speed * ts;
    // Arrivée tolérante (0,3 m ; 0,45 m pour un point de passage) : deux clients qui visent la même case ne se
    // bloquent plus mutuellement à cause de l'écart minimal.
    if (d <= v * dt || v <= 0) { m.x = t[0]; m.z = t[1]; m.route.shift(); }
    else if (d < (m.route.length > 1 ? 0.45 : 0.3)) m.route.shift();
    else { m.x += (dx / d) * v * dt; m.z += (dz / d) * v * dt; m.heading = turn(m.heading, headingTo(dx, dz), dt * 10); }
    m.h.update(dt, Math.min(2.5, v));
    return m.route.length === 0;
  }

  update(dt: number, timeScale: number, open: boolean): void {
    const ts = Math.max(0.5, Math.min(4, timeScale));
    this.clock += dt;
    // Employés : un par caisse, derrière la caisse enregistreuse, face aux clients ; geste d'encaissement pendant un
    // paiement. Les autres passent entre les rayons.
    this.registers.forEach((r) => { r.tended = false; });
    this.staff.forEach((s, k) => {
      s.h.group.visible = open;
      const r = this.registers[k];
      if (r && r.back.length && r.uid !== this.playerRegister) {
        r.tended = true;
        const [tx, tz] = this.view.cellCenter(r.back[0]![0], r.back[0]![1]);
        if (Math.hypot(tx - s.x, tz - s.z) > 0.05 && !s.route.length) this.routeTo(s, r.back[0]!);
        s.face = headingTo(r.dir[0], r.dir[1]);
        s.h.gesture(r.queue[0]?.state === 'pay' ? 'interact-left' : null);
        this.step(s, dt, ts);
      } else {
        s.idle -= dt * ts;
        if (s.idle <= 0 && !s.route.length) {
          s.idle = 6 + this.rand() * 8;
          const shelf = this.view.items.filter((i) => FURNITURE_BY_ID.get(i.def)?.capacity);
          const it = shelf[Math.floor(this.rand() * shelf.length)];
          const cell = it ? this.accessCell(it) : null;
          if (it && cell && this.routeTo(s, cell)) { const [lx, lz] = this.itemCenter(it), [cx, cz] = this.view.cellCenter(cell[0], cell[1]); s.face = headingTo(lx - cx, lz - cz); }
        }
        // Mise en rayon : bras tendus vers le meuble une fois arrivé.
        s.h.gesture(s.route.length ? null : 'interact-right');
        this.step(s, dt, ts);
      }
      s.h.group.position.set(s.x, 0, s.z);
      s.h.group.rotation.y = s.heading;
    });
    // Clients.
    const keep: Customer[] = [];
    for (const c of this.customers) {
      const arrived = this.step(c, dt, ts);
      if (c.bubble && (c.bubbleT! -= dt) <= 0) this.unbubble(c);
      const arrive = c.arrive;
      if (c.state === 'walk' && arrived) {
        if (arrive?.kind === 'browse') {
          c.state = 'browse'; c.timer = 1.6 + this.rand() * 2;
          c.face = headingTo(arrive.look[0] - c.x, arrive.look[1] - c.z);
          c.h.gesture(this.rand() < 0.5 ? 'pick-up' : 'interact-right');
        } else this.next(c);
      } else if (c.state === 'browse') {
        c.timer -= dt * ts;
        if (c.timer <= 0) { c.h.gesture(null); c.face = null; this.next(c); }
      } else if (c.state === 'react') {
        // Client mécontent : s'arrête, fait « non » de la tête, puis ressort.
        if (arrived) { c.h.gesture('emote-no'); c.timer -= dt * ts; }
        if (c.timer <= 0) { c.h.gesture(null); this.next(c); }
      } else if (c.state === 'queue' && c.reg) {
        const k = c.reg.queue.indexOf(c);
        if (k !== c.slot) { c.slot = k; this.routeTo(c, this.slotCell(c.reg, k)); }
        // Dans la file : regarde la caisse (le client devant lui).
        if (arrived) c.face = headingTo(c.reg.center[0] - c.x, c.reg.center[1] - c.z);
        if (arrived && k === 0) { c.state = 'pay'; c.timer = 2.2; c.face = headingTo(-c.reg.dir[0], -c.reg.dir[1]); c.h.gesture('interact-right'); }
      } else if (c.state === 'pay') {
        // Paiement seulement si quelqu'un tient la caisse (employé ou joueur) ; sinon le client patiente.
        const served = !c.reg || c.reg.tended || c.reg.uid === this.playerRegister || !this.registers.some((r) => r.tended);
        if (served) c.timer -= dt * ts;
        if (c.timer <= 0) {
          // Vente : « +X CHF » au-dessus de la caisse (côté caissier), puis client satisfait (visage souriant).
          if (c.reg && c.amount) this.floatText(`+${c.amount.toFixed(c.amount < 10 ? 2 : 0)} CHF`, c.reg.center[0] - c.reg.dir[0] * 0.25, c.reg.center[1] - c.reg.dir[1] * 0.25);
          c.reg?.queue.shift(); c.reg = null;
          c.state = 'done'; c.timer = 0.8;
          c.h.gesture('emote-yes');
          this.sayIcon(c, 'content');
        }
      } else if (c.state === 'done') {
        c.timer -= dt * ts;
        if (c.timer <= 0) { c.h.gesture(null); c.face = null; this.next(c); }
      } else if (c.state === 'leave' && arrived) {
        this.unbubble(c);
        this.group.remove(c.h.group);
        disposeOwn(c.h.group);
        continue;
      }
      keep.push(c);
    }
    this.customers = keep;
    for (const f of this.floats) { f.t += dt; f.l.rise += dt * 0.55; (f.l.sp.material as THREE.SpriteMaterial).opacity = Math.max(0, Math.min(1, (1.6 - f.t) / 0.5)); }
    for (const f of this.floats.filter((x) => x.t >= 1.6)) this.dropFloat(f.l);
    this.floats = this.floats.filter((x) => x.t < 1.6);
    this.separate();
    this.separate();
    for (const c of this.customers) { c.h.group.position.set(c.x, 0, c.z); c.h.group.rotation.y = c.heading; }
    this.layout(dt);
  }

  /**
   * Séparation minimale : deux personnes à moins de MIN_GAP m s'écartent l'une de l'autre (jamais dans un meuble).
   * Les employés et le joueur comptent comme obstacles fixes.
   */
  private separate(): void {
    const MIN_GAP = 0.75;
    const fixed = this.staff.map((s) => [s.x, s.z] as const);
    if (this.playerPos) fixed.push([this.playerPos[0], this.playerPos[1]]);
    const cs = this.customers;
    const push = (c: Customer, dx: number, dz: number): void => {
      const nx = c.x + dx, nz = c.z + dz;
      const [cx, cz] = this.view.cellAt(nx, nz);
      if (this.view.inside(cx, cz) && this.view.walkBlocked(cx, cz)) return;
      c.x = nx; c.z = nz;
    };
    for (let i = 0; i < cs.length; i++) {
      const a = cs[i]!;
      for (let j = i + 1; j < cs.length; j++) {
        const b = cs[j]!;
        const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
        if (d >= MIN_GAP) continue;
        // Deux clients en marche se frôlent (écart souple) pour se croiser dans les passages et l'entrée.
        const soft = (a.state === 'walk' || a.state === 'leave') && (b.state === 'walk' || b.state === 'leave') ? 0.35 : 1;
        const k = ((MIN_GAP - d) / 2) * soft, ux = d > 1e-4 ? dx / d : 1, uz = d > 1e-4 ? dz / d : 0;
        push(a, -ux * k, -uz * k); push(b, ux * k, uz * k);
      }
      // En marche, un client contourne au plus près (sans être bloqué par le joueur dans l'entrée).
      if (a.state === 'walk' || a.state === 'leave') continue;
      for (const [fx, fz] of fixed) {
        const dx = a.x - fx, dz = a.z - fz, d = Math.hypot(dx, dz);
        if (d < MIN_GAP && d > 1e-4) push(a, (dx / d) * (MIN_GAP - d), (dz / d) * (MIN_GAP - d));
      }
    }
  }

  /** Position du joueur dans l'intérieur (obstacle pour les clients). */
  playerPos: [number, number] | null = null;

  clear(): void {
    for (const c of this.customers) { this.unbubble(c); this.group.remove(c.h.group); }
    this.customers = [];
    for (const r of this.registers) r.queue = [];
    for (const f of this.floats) this.dropFloat(f.l);
    this.floats = [];
  }

  /** Retire un montant et libère son matériau (propre à chaque montant). */
  private dropFloat(l: Label): void {
    this.group.remove(l.sp);
    const m = l.sp.material as THREE.SpriteMaterial;
    m.map?.dispose(); m.dispose();
  }
}

function turn(a: number, b: number, k: number): number {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * Math.min(1, k);
}

type Mood = 'content' | 'fache' | 'bof';
const BUBBLES: Record<FeedbackKind, [string, string, Mood]> = {
  prix: ['Trop cher !', '#ef6b6b', 'fache'], rupture: ['Rupture…', '#f0b84a', 'bof'], attente: ['Trop d’attente', '#f0b84a', 'bof'],
  caisse: ['Personne en caisse ?', '#ef6b6b', 'fache'], content: ['Super boutique !', '#5cc77a', 'content'],
  sale: ['C’est sale ici…', '#b08a5a', 'bof'],
};

/**
 * Visage dessiné (cercle jaune, yeux, bouche souriante, neutre ou fâchée, sourcils froncés) : lisible sur tous les
 * systèmes, même sans police d'émojis. Centre (cx, cy), rayon r.
 */
function drawFace(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, mood: Mood): void {
  g.fillStyle = mood === 'fache' ? '#ff8a5c' : '#ffd23f';
  g.strokeStyle = '#1d2733'; g.lineWidth = r * 0.1;
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill(); g.stroke();
  g.fillStyle = '#1d2733';
  for (const s of [-1, 1]) { g.beginPath(); g.ellipse(cx + s * r * 0.36, cy - r * 0.18, r * 0.11, r * 0.16, 0, 0, Math.PI * 2); g.fill(); }
  g.lineCap = 'round'; g.lineWidth = r * 0.12;
  g.beginPath();
  if (mood === 'content') g.arc(cx, cy + r * 0.05, r * 0.5, 0.15 * Math.PI, 0.85 * Math.PI);
  else if (mood === 'fache') g.arc(cx, cy + r * 0.62, r * 0.4, 1.2 * Math.PI, 1.8 * Math.PI);
  else { g.moveTo(cx - r * 0.35, cy + r * 0.42); g.lineTo(cx + r * 0.35, cy + r * 0.36); }
  g.stroke();
  if (mood === 'fache') for (const s of [-1, 1]) { g.beginPath(); g.moveTo(cx + s * r * 0.58, cy - r * 0.5); g.lineTo(cx + s * r * 0.18, cy - r * 0.34); g.stroke(); }
}

const bubbleCache = new Map<FeedbackKind, THREE.SpriteMaterial>();
/** Bulle d'avis (visage + texte, canevas → sprite), mise en cache par type. */
function bubbleMaterial(kind: FeedbackKind): THREE.SpriteMaterial {
  const c = bubbleCache.get(kind);
  if (c) return c;
  const [text, color, mood] = BUBBLES[kind];
  const cv = document.createElement('canvas');
  cv.width = 384; cv.height = 128;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#ffffff'; g.strokeStyle = color; g.lineWidth = 8;
  g.beginPath(); g.roundRect(6, 6, 372, 90, 40); g.fill(); g.stroke();
  g.beginPath(); g.moveTo(170, 94); g.lineTo(192, 124); g.lineTo(214, 94); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(170, 98); g.lineTo(192, 124); g.lineTo(214, 98); g.stroke();
  g.fillStyle = '#ffffff'; g.fillRect(166, 88, 52, 8);
  drawFace(g, 56, 51, 30, mood);
  g.fillStyle = '#1d2733'; g.font = '800 38px Rubik, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 230, 53, 280);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const m = new THREE.SpriteMaterial({ map: tex, depthTest: false });
  bubbleCache.set(kind, m);
  return m;
}

/** Montant d'une vente (texte vert vif bordé, sur fond sombre), un matériau par texte (libéré après l'animation). */
function moneyMaterial(text: string): THREE.SpriteMaterial {
  const cv = document.createElement('canvas');
  cv.width = 320; cv.height = 104;
  const g = cv.getContext('2d')!;
  g.fillStyle = 'rgba(16, 22, 32, 0.9)'; g.strokeStyle = '#7dffa8'; g.lineWidth = 5;
  g.beginPath(); g.roundRect(5, 5, 310, 94, 46); g.fill(); g.stroke();
  g.fillStyle = '#7dffa8'; g.font = '800 54px Rubik, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 160, 55, 286);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
}
const iconCache = new Map<Mood, THREE.SpriteMaterial>();
/** Icône d'humeur (visage dessiné sur pastille blanche) au-dessus d'un client. */
function iconMaterial(mood: Mood): THREE.SpriteMaterial {
  const c = iconCache.get(mood);
  if (c) return c;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#ffffff'; g.beginPath(); g.arc(64, 64, 60, 0, Math.PI * 2); g.fill();
  drawFace(g, 64, 64, 46, mood);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.SpriteMaterial({ map: tex, depthTest: false });
  iconCache.set(mood, m);
  return m;
}
