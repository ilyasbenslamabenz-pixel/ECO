/**
 * Vie dans un commerce : chaque vente de la simulation affiche aussitôt son montant doré au-dessus d'une caisse et
 * fait entrer un client qui va aux meubles des produits achetés, fait la queue (file ordonnée, en ligne puis le long
 * des murs) à une caisse, paie et ressort. Les employés se tiennent derrière les caisses (les autres passent entre les
 * rayons). Chemins sur la grille (recherche en largeur), vitesse proportionnelle au temps de jeu. Dépend de three.
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
interface Customer extends Mover { bubble?: Label; bubbleT?: number; arrive: Step | null; plan: Step[]; state: 'walk' | 'browse' | 'queue' | 'pay' | 'done' | 'react' | 'leave'; timer: number; reg: Register | null; slot: number; jx: number; jz: number; spot?: number }
interface Staff extends Mover { id: number; idle: number }
/** Montant flottant d'une ou plusieurs ventes rapprochées à une caisse (uid), et âge depuis son dernier ajout (s). */
interface Float { l: Label; t: number; x: number; z: number; reg: number; amount: number; pop: number }

/** Longueur maximale d'une file d'attente dessinée : une place par client possible. */
const MAX_LINE = MAX_CUSTOMERS;
/** Au plus 3 clients mécontents (entrés pour montrer leur avis) à la fois. */
const MAX_REACT = 3;
/** Durée de vie (s) d'un montant de vente ; ventes cumulées dans le même montant pendant MERGE_T s. */
const FLOAT_LIFE = 1.9, MERGE_T = 0.45;
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
  /** Magasin sale : les clients ne repartent plus avec un sourire. */
  dirty = false;

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

  /**
   * Un client entre pour acheter `products` (figuration de la vente : le montant, lui, s'affiche dès la vente, voir
   * `sale`).
   */
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
    const h = makePerson(Math.floor(this.rand() * 1e6), undefined, 0.94 + this.rand() * 0.1);
    this.group.add(h.group);
    const [dx, dz] = this.view.cellCenter(...this.door());
    this.customers.push({ h, x: ox + (this.rand() - 0.5) * 2, z: oz + 1, heading: 0, face: null, route: [[dx, dz]], speed: 1.25 + this.rand() * 0.35, arrive: null, plan, state: 'walk', timer: 0, reg: null, slot: 0, jx: (this.rand() - 0.5) * 0.3, jz: (this.rand() - 0.5) * 0.3 });
  }

  /**
   * Vente encaissée (au moment où la simulation l'enregistre) : « +2,90 CHF » doré au-dessus d'une caisse, celle du
   * joueur s'il la tient, sinon les caisses tenues à tour de rôle. Des ventes rapprochées (moins de MERGE_T s) à la
   * même caisse s'additionnent dans le même montant, qui rebondit : lisible même en temps accéléré.
   */
  sale(amount: number): void {
    if (!(amount > 0) || !this.registers.length) return;
    const mine = this.registers.find((r) => r.uid === this.playerRegister);
    const tended = this.registers.filter((r) => r.tended && r.back.length);
    const r = mine ?? (tended.length ? tended[this.turn++ % tended.length]! : this.registers[0]!);
    const last = this.floats.filter((f) => f.reg === r.uid && f.t < MERGE_T).at(-1);
    if (last) {
      last.amount += amount; last.pop = 0;
      drawMoney(last.l.sp.material as THREE.SpriteMaterial, last.amount);
      return;
    }
    // Au-dessus de la caisse enregistreuse, côté caissier, plus haut qu'une tête.
    const x = r.center[0] - r.dir[0] * 0.25, z = r.center[1] - r.dir[1] * 0.25;
    const l = this.label(moneyMaterial(amount), 1.75, 0.55, 3, 22);
    l.at.set(x, 2.2, z);
    // Ventes rapprochées à la même caisse : le montant prend le plus bas créneau libre de la pile. Tous montent à la
    // même vitesse : deux créneaux espacés d'une hauteur ne se recouvrent jamais, et la pile ne grimpe pas sans fin.
    const step = l.h + LABEL_GAP;
    const near = this.floats.filter((f) => Math.hypot(f.x - x, f.z - z) < 1.2).map((f) => f.l.rise);
    l.rise = [0, ...near.map((v) => v + step)].sort((a, b) => a - b).find((v) => near.every((o) => Math.abs(o - v) >= step - 1e-6)) ?? 0;
    this.floats.push({ l, t: 0, x, z, reg: r.uid, amount, pop: 0 });
  }
  /** Tour de rôle des caisses tenues pour les montants (ventes des employés). */
  private turn = 0;

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
    // Au plus MAX_REACT mécontents à la fois (la plainte reste comptée dans le bilan), chacun sur sa case, en
    // retrait de l'entrée : pas d'attroupement devant la porte.
    if (this.customers.length >= MAX_CUSTOMERS || this.customers.filter((x) => x.spot !== undefined).length >= MAX_REACT) return;
    const spot = this.reactSpot();
    const [ox, oz] = this.view.outside();
    const [dx, dz] = this.view.cellCenter(...this.door());
    const h = makePerson(Math.floor(this.rand() * 1e6), undefined, 0.94 + this.rand() * 0.1);
    this.group.add(h.group);
    const c: Customer = { h, x: ox + (this.rand() - 0.5) * 2, z: oz + 1, heading: 0, face: null, route: [[dx + (this.rand() - 0.5) * 0.8, dz - 1.2]], speed: 1.3, arrive: null, plan: [{ kind: 'react', t: 1.8 }, { kind: 'exit' }], state: 'walk', timer: 0, reg: null, slot: 0, jx: 0, jz: 0, spot: spot ?? -1 };
    this.customers.push(c);
    this.say(c, kind);
    this.next(c);
    // Entrée par la porte, puis la case choisie par le plus court chemin (sans traverser de meuble).
    if (spot !== null && this.routeTo(c, [spot % this.view.W, Math.floor(spot / this.view.W)])) c.route.unshift([dx, dz]);
  }

  /**
   * Case libre où un client mécontent s'arrête : à deux ou trois rangées de la porte, hors de l'entrée et des files
   * d'attente, loin des autres mécontents. Null si aucune.
   */
  private reactSpot(): number | null {
    const v = this.view, W = v.W, D = v.D;
    const door = doorCells(W, D);
    const dcx = door.reduce((a, c) => a + c[0], 0) / door.length;
    const taken = new Set(this.customers.flatMap((c) => (c.spot !== undefined && c.spot >= 0 ? [c.spot] : [])));
    const lines = new Set(this.registers.flatMap((r) => (r.line ?? []).slice(0, 4).map(([x, z]) => z * W + x)));
    let best: number | null = null, bestCost = Infinity;
    for (let z = D - 4; z <= D - 2; z++) {
      for (let x = Math.floor(dcx) - 3; x <= Math.ceil(dcx) + 3; x++) {
        const k = z * W + x;
        if (!v.inside(x, z) || v.walkBlocked(x, z) || taken.has(k) || lines.has(k)) continue;
        if (door.some(([a, b]) => a === x && (b === z || b - 1 === z))) continue;
        // Proche de la porte, mais à distance des autres mécontents.
        let cost = Math.abs(x - dcx) * 0.6 + Math.abs(z - (D - 3)) + this.rand() * 0.8;
        for (const t of taken) cost += 2 * Math.max(0, 2.2 - Math.hypot((t % W) - x, Math.floor(t / W) - z));
        if (cost < bestCost) { bestCost = cost; best = k; }
      }
    }
    return best;
  }

  /** Montants des ventes : montent vers le haut de l'écran et s'effacent en FLOAT_LIFE s. */
  private floats: Float[] = [];

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
   * Case de la k-ième place de la file d'une caisse (une case par client, donc 1 m d'écart), voir `queueLine`.
   */
  private slotCell(r: Register, k: number): [number, number] {
    if (!r.line) r.line = this.queueLine(r);
    return r.line[Math.min(k, r.line.length - 1)] ?? r.front[0]!;
  }

  /**
   * File d'attente lisible, case après case : droit devant la caisse enregistreuse ; quand un meuble, un mur ou
   * l'entrée (cases de la porte et celles juste devant) l'arrête, elle tourne du côté qui l'éloigne de la porte (puis
   * le plus dégagé) et repart en ligne droite : file en ligne, en L ou en serpentin le long des murs, jamais en tas.
   * Une file coincée avant MAX_LINE cases se prolonge par les cases libres les plus proches de la dernière.
   */
  private queueLine(r: Register): [number, number][] {
    const v = this.view, W = v.W, D = v.D;
    const doors = doorCells(W, D);
    const lane = new Set(doors.flatMap(([x, z]) => [z * W + x, (z - 1) * W + x]));
    const dcx = doors.reduce((a, c) => a + c[0], 0) / doors.length, dcz = D - 1;
    const used = new Set<number>();
    const free = (x: number, z: number): boolean => v.inside(x, z) && !v.walkBlocked(x, z) && !lane.has(z * W + x) && !used.has(z * W + x);
    /** Cases libres en ligne droite depuis (x, z) dans une direction (au plus 6). */
    const run = (x: number, z: number, dx: number, dz: number): number => { let n = 0; while (n < 6 && free(x + dx * (n + 1), z + dz * (n + 1))) n++; return n; };
    /** Case collée à l'entrée (les clients qui entrent y passent). */
    const byLane = (x: number, z: number): boolean => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => lane.has((z + b!) * W + x + a!));
    const out: [number, number][] = [];
    let [x, z] = r.front[0]!;
    let [dx, dz] = r.dir;
    out.push([x, z]); used.add(z * W + x);
    while (out.length < MAX_LINE) {
      if (!free(x + dx, z + dz)) {
        // Virage : côté qui éloigne de la porte, puis le plus dégagé ; jamais collé à l'entrée si on peut l'éviter.
        const opts = ([[dz, dx], [-dz, -dx]] as [number, number][]).filter(([a, b]) => free(x + a, z + b));
        if (!opts.length) break;
        const score = ([a, b]: [number, number]): number => 2 * Math.hypot(x + a - dcx, z + b - dcz) + run(x, z, a, b) - (byLane(x + a, z + b) ? 6 : 0);
        [dx, dz] = opts.sort((p, q) => score(q) - score(p))[0]!;
      }
      x += dx; z += dz;
      out.push([x, z]); used.add(z * W + x);
    }
    // Suite (file coincée) : cases libres les plus proches de la dernière, en privilégiant les côtés de la ligne.
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
        // Nouvelle place dans la file : y aller d'abord (l'arrivée de l'image précédente ne compte plus, sinon le client
        // paierait là où il se trouve, au rayon ou dans l'entrée, et bloquerait les suivants).
        let here = arrived;
        if (k !== c.slot) { c.slot = k; this.routeTo(c, this.slotCell(c.reg, k)); here = c.route.length === 0; }
        // Dans la file : regarde la caisse (le client devant lui).
        if (here) c.face = headingTo(c.reg.center[0] - c.x, c.reg.center[1] - c.z);
        if (here && k === 0) { c.state = 'pay'; c.timer = 2.2; c.face = headingTo(-c.reg.dir[0], -c.reg.dir[1]); c.h.gesture('interact-right'); }
      } else if (c.state === 'pay') {
        // Paiement seulement si quelqu'un tient la caisse (employé ou joueur) ; sinon le client patiente.
        const served = !c.reg || c.reg.tended || c.reg.uid === this.playerRegister || !this.registers.some((r) => r.tended);
        if (served) c.timer -= dt * ts;
        if (c.timer <= 0) {
          // Payé (le montant s'est affiché à la vente, voir `sale`) : client satisfait (visage souriant).
          c.reg?.queue.shift(); c.reg = null;
          c.state = 'done'; c.timer = 0.8;
          c.h.gesture('emote-yes');
          if (!this.dirty) this.sayIcon(c, 'content');
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
    // Montants : montent, rebondissent à chaque vente ajoutée, s'effacent en fin de vie.
    for (const f of this.floats) {
      f.t += dt; f.pop += dt; f.l.rise += dt * 0.5;
      (f.l.sp.material as THREE.SpriteMaterial).opacity = Math.max(0, Math.min(1, (FLOAT_LIFE - f.t) / 0.5));
      // Apparition : rebond d'échelle ; vente ajoutée à un montant affiché : petite pulsation.
      const a = Math.min(1, f.pop / 0.3), e = a - 1;
      const s = f.t === f.pop ? 0.55 + 0.45 * (1 + 2.70158 * e * e * e + 1.70158 * e * e) : 1 + 0.3 * e * e;
      f.l.sp.scale.set(f.l.w * s, f.l.h * s, 1);
    }
    for (const f of this.floats.filter((x) => x.t >= FLOAT_LIFE)) this.dropFloat(f.l);
    this.floats = this.floats.filter((x) => x.t < FLOAT_LIFE);
    this.separate();
    this.separate();
    for (const c of this.customers) { c.h.group.position.set(c.x, 0, c.z); c.h.group.rotation.y = c.heading; }
    this.layout(dt);
  }

  /**
   * Séparation minimale : deux clients arrêtés à moins de MIN_GAP m s'écartent l'un de l'autre (jamais dans un
   * meuble) ; les employés et le joueur comptent pour eux comme obstacles fixes. Un client en marche passe sans
   * pousser ni être poussé : sinon ceux qui entrent ensemble se bloquent à la porte (chacun visant le même point) et
   * ceux qui rejoignent le bout de la file restent coincés derrière un client arrêté dans un couloir.
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
        if (a.route.length || b.route.length) continue;
        const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
        if (d >= MIN_GAP) continue;
        const k = (MIN_GAP - d) / 2, ux = d > 1e-4 ? dx / d : 1, uz = d > 1e-4 ? dz / d : 0;
        push(a, -ux * k, -uz * k); push(b, ux * k, uz * k);
      }
      // En marche, un client passe au plus près (sans être bloqué par le joueur dans l'entrée).
      if (a.route.length) continue;
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

const MONEY_2 = new Intl.NumberFormat('fr-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MONEY_0 = new Intl.NumberFormat('fr-CH', { maximumFractionDigits: 0 });
/** « +2,90 CHF » (centimes sous 100 CHF, francs ronds au-delà). */
export function moneyText(amount: number): string { return `+${(amount < 100 ? MONEY_2 : MONEY_0).format(amount)} CHF`; }

/** Montant d'une vente : pastille sombre bordée d'or, pièce, texte doré. Un matériau par montant (libéré ensuite). */
function moneyMaterial(amount: number): THREE.SpriteMaterial {
  const cv = document.createElement('canvas');
  cv.width = 384; cv.height = 120;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const m = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  drawMoney(m, amount);
  return m;
}

/** (Re)dessine le montant d'un matériau de `moneyMaterial` (ventes cumulées). */
function drawMoney(m: THREE.SpriteMaterial, amount: number): void {
  const tex = m.map as THREE.CanvasTexture, cv = tex.image as HTMLCanvasElement, g = cv.getContext('2d')!;
  g.clearRect(0, 0, cv.width, cv.height);
  const gold = g.createLinearGradient(0, 8, 0, 112);
  gold.addColorStop(0, '#fff3b0'); gold.addColorStop(0.5, '#ffcc4d'); gold.addColorStop(1, '#e09a1a');
  g.fillStyle = 'rgba(30, 20, 4, 0.93)'; g.strokeStyle = gold; g.lineWidth = 6;
  g.beginPath(); g.roundRect(6, 6, 372, 108, 54); g.fill(); g.stroke();
  // Pièce : disque doré, listel et reflet.
  g.fillStyle = gold; g.beginPath(); g.arc(62, 60, 33, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#a86d0c'; g.lineWidth = 4; g.beginPath(); g.arc(62, 60, 24, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = 'rgba(255, 255, 255, 0.75)'; g.lineWidth = 5; g.lineCap = 'round'; g.beginPath(); g.arc(62, 60, 15, Math.PI * 1.1, Math.PI * 1.45); g.stroke();
  g.textAlign = 'center'; g.textBaseline = 'middle';
  // Montant : texte doré cerné de brun (lisible sur tous les sols).
  g.font = '800 54px Rubik, system-ui, sans-serif';
  g.lineJoin = 'round'; g.lineWidth = 8; g.strokeStyle = '#3a2600';
  const text = moneyText(amount);
  g.strokeText(text, 236, 63, 262);
  g.fillStyle = gold; g.fillText(text, 236, 63, 262);
  tex.needsUpdate = true;
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
