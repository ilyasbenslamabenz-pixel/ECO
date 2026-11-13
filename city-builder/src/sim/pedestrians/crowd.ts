/**
 * Foule : piétons dans la rue (structure de tableaux, suppression par permutation avec le dernier).
 *
 * Déplacement « 1,5 D » : chaque piéton suit la polyligne de l'arête courante de son chemin (abscisse `s`) avec un
 * décalage latéral `lat` (positif = à droite du sens de marche) borné par la demi-largeur utile de l'arête : un
 * piéton ne quitte jamais le trottoir. Évitement local par voisinage (grille hachée de 3 m) : on se croise à
 * droite, on double un piéton plus lent s'il reste de la place, sinon on le suit ; on contourne ou on fait la
 * queue derrière un piéton arrêté. Anti-blocage : un piéton immobilisé trop longtemps « se faufile ».
 *
 * Traversées : feu piéton du service « feux » s'il existe (on ne s'engage qu'au vert, avec le temps de traverser),
 * sinon TRAVERSÉE PRUDENTE (arrêt au bord, temps d'observation, créneau entre véhicules si le service « trafic »
 * existe, effet de groupe). Compteurs d'occupation par traversée (publiés pour la circulation).
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { PIETON_IDLE_BIT, PIETON_META_STRIDE, PIETON_POS_STRIDE, PIETON_SPEED_UNIT, type PietonsFrame } from '../../shared/protocol-ext/pietons';
import { FEU_VERT, type EtatPassage, type FeuxPort, type TraficPort } from './feux';
import type { NearestHit, PedGraph } from './graph';

export const ST_LEG_OUT = 0;
export const ST_WALK = 1;
export const ST_WAIT = 2;
export const ST_LEG_IN = 3;

/** Longueur maximale d'un chemin (arêtes). */
export const MAX_PATH = 64;
/** Pas de temps physique d'un tick (s) — identique au trafic (world.ts : `traffic.step(0.1)`). */
export const PED_DT = 0.1;

const GRID_CELL = 3;
const LOOKAHEAD = 3.5;
const BODY = 0.6;
/** Attente maximale à un feu avant de traverser prudemment quand même (feu bloqué, phase jamais servie). */
export const MAX_WAIT_SIGNAL = 150;
/** Attente maximale d'un créneau entre véhicules avant de s'engager quand même. */
export const MAX_WAIT_GAP = 45;
const QUEUE_ZONE = 3;

export const CROSS_NO = 0;
export const CROSS_GREEN = 1;
export const CROSS_PRUDENT = 2;
export const CROSS_FORCED = 3;

export interface SpawnParams {
  persona: number;
  look: number;
  seed: number;
  motif: number;
  v0: number;
  from: number;
  dest: number;
  /** Porte d'origine (x, y, z) ; le piéton rejoint le trottoir en ligne droite. `skipLeg` : apparaît déjà sur le trottoir. */
  ox: number; oy: number; oz: number;
  skipLeg?: boolean;
  /** Porte de destination. */
  dx: number; dy: number; dz: number;
  /** Abscisse de départ sur la première arête et d'arrivée sur la dernière. */
  s0: number;
  s1: number;
}

export interface CrowdCounters { crossings: number; green: number; prudent: number; forced: number }

const tmpP = new Float32Array(5);
const tmpEtat: EtatPassage = { etat: 0, restant: 0 };

function wrapPi(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

export class Crowd {
  count = 0;
  cap = 0;
  nextId = 1;
  id = new Uint32Array(0);
  persona = new Int32Array(0);
  state = new Uint8Array(0);
  x = new Float32Array(0);
  y = new Float32Array(0);
  z = new Float32Array(0);
  heading = new Float32Array(0);
  /** Direction de marche unitaire courante. */
  tdx = new Float32Array(0);
  tdz = new Float32Array(0);
  speed = new Float32Array(0);
  v0 = new Float32Array(0);
  lat = new Float32Array(0);
  latT = new Float32Array(0);
  lat0 = new Float32Array(0);
  edge = new Int32Array(0);
  fwd = new Uint8Array(0);
  s = new Float32Array(0);
  pi = new Int32Array(0);
  pathPos = new Uint8Array(0);
  pathLen = new Uint8Array(0);
  path = new Int32Array(0);
  endS = new Float32Array(0);
  /** Cible du trajet hors graphe en cours (porte ou point d'accès) et porte de destination. */
  ox = new Float32Array(0); oy = new Float32Array(0); oz = new Float32Array(0);
  dx = new Float32Array(0); dy = new Float32Array(0); dz = new Float32Array(0);
  /** Temps d'attente (bord de traversée) ou de blocage ; négatif = en train de se faufiler. */
  wait = new Float32Array(0);
  stuck = new Float32Array(0);
  obs = new Float32Array(0);
  /** Traversée autorisée (index d'arête) ou -1. */
  goEdge = new Int32Array(0);
  onCross = new Uint8Array(0);
  /** 1 : chemin invalidé par une modification du réseau, à recalculer. */
  reroute = new Uint8Array(0);
  look = new Uint8Array(0);
  seed = new Uint8Array(0);
  motif = new Uint8Array(0);
  from = new Int32Array(0);
  dest = new Int32Array(0);

  /** Occupation des traversées (par arête du graphe). */
  crossOn = new Uint16Array(0);
  crossWait = new Uint16Array(0);
  private crossLast = new Float32Array(0);

  /** Indices des piétons arrivés pendant le dernier `step` (à retirer par l'appelant). */
  arrived: number[] = [];
  readonly counters: CrowdCounters = { crossings: 0, green: 0, prudent: 0, forced: 0 };
  walking = 0;
  waiting = 0;
  crossing = 0;

  private g: PedGraph | null = null;
  private gridHead = new Int32Array(1024);
  private gridNext = new Int32Array(0);
  private gridMask = 1023;
  private time = 0;
  feux: FeuxPort | null = null;
  trafic: TraficPort | null = null;
  /** Source de hasard (PRNG du module) : valeur dans [0, 1). */
  random: () => number = () => 0.5;

  constructor(capacity = 256) { this.grow(capacity); }

  private grow(n: number): void {
    const f32 = (a: Float32Array, k = 1): Float32Array<ArrayBuffer> => { const b = new Float32Array(n * k); b.set(a); return b; };
    const i32 = (a: Int32Array, k = 1): Int32Array<ArrayBuffer> => { const b = new Int32Array(n * k); b.set(a); return b; };
    const u8 = (a: Uint8Array): Uint8Array<ArrayBuffer> => { const b = new Uint8Array(n); b.set(a); return b; };
    const id = new Uint32Array(n); id.set(this.id); this.id = id;
    this.persona = i32(this.persona); this.state = u8(this.state);
    this.x = f32(this.x); this.y = f32(this.y); this.z = f32(this.z); this.heading = f32(this.heading);
    this.tdx = f32(this.tdx); this.tdz = f32(this.tdz);
    this.speed = f32(this.speed); this.v0 = f32(this.v0);
    this.lat = f32(this.lat); this.latT = f32(this.latT); this.lat0 = f32(this.lat0);
    this.edge = i32(this.edge); this.fwd = u8(this.fwd); this.s = f32(this.s); this.pi = i32(this.pi);
    this.pathPos = u8(this.pathPos); this.pathLen = u8(this.pathLen); this.path = i32(this.path, MAX_PATH); this.endS = f32(this.endS);
    this.ox = f32(this.ox); this.oy = f32(this.oy); this.oz = f32(this.oz);
    this.dx = f32(this.dx); this.dy = f32(this.dy); this.dz = f32(this.dz);
    this.wait = f32(this.wait); this.stuck = f32(this.stuck); this.obs = f32(this.obs);
    this.goEdge = i32(this.goEdge); this.onCross = u8(this.onCross); this.reroute = u8(this.reroute);
    this.look = u8(this.look); this.seed = u8(this.seed); this.motif = u8(this.motif);
    this.from = i32(this.from); this.dest = i32(this.dest);
    this.gridNext = new Int32Array(n);
    let size = 1024;
    while (size < n * 2) size *= 2;
    this.gridHead = new Int32Array(size);
    this.gridMask = size - 1;
    this.cap = n;
  }

  clear(): void {
    this.count = 0;
    this.arrived.length = 0;
    this.crossOn.fill(0); this.crossWait.fill(0);
    this.walking = this.waiting = this.crossing = 0;
    this.counters.crossings = this.counters.green = this.counters.prudent = this.counters.forced = 0;
    this.time = 0;
  }

  get graph(): PedGraph | null { return this.g; }

  /**
   * Change de graphe. Les chemins sont transposés par les clés stables des arêtes ; les piétons dont une arête
   * a disparu sont marqués `reroute` (ils s'arrêtent jusqu'au recalcul par le système).
   */
  setGraph(g: PedGraph): void {
    const old = this.g;
    this.g = g;
    this.crossOn = new Uint16Array(g.edgeCount);
    this.crossWait = new Uint16Array(g.edgeCount);
    this.crossLast = new Float32Array(g.edgeCount).fill(-1e9);
    for (let i = 0; i < this.count; i++) {
      this.goEdge[i] = -1;
      if (!old || this.reroute[i]) { this.reroute[i] = 1; this.onCross[i] = 0; continue; }
      const base = i * MAX_PATH;
      let ok = true;
      for (let k = this.pathPos[i]!; k < this.pathLen[i]!; k++) {
        const oe = this.path[base + k]!;
        const ne = g.keyIndex.get(old.eKey[oe]!);
        // Même clé = mêmes extrémités ; on vérifie aussi la longueur (géométrie inchangée).
        if (ne === undefined || Math.abs(g.eLen[ne]! - old.eLen[oe]!) > 0.05) { ok = false; break; }
        this.path[base + k] = ne;
      }
      if (!ok) { this.reroute[i] = 1; this.onCross[i] = 0; if (this.state[i] === ST_WAIT) this.state[i] = ST_WALK; continue; }
      this.edge[i] = this.path[base + this.pathPos[i]!]!;
      this.pi[i] = 0;
      if (this.onCross[i]) this.crossOn[this.edge[i]!]!++;
      if (this.state[i] === ST_WAIT) {
        const nxt = this.path[base + this.pathPos[i]! + 1];
        if (nxt !== undefined && this.pathPos[i]! + 1 < this.pathLen[i]!) this.crossWait[nxt]!++;
        else this.state[i] = ST_WALK;
      }
    }
  }

  /** Ajoute un piéton dont le chemin (arêtes) est `path[0..n)`. Renvoie son index. */
  spawn(p: SpawnParams, path: Int32Array, n: number): number {
    const g = this.g!;
    if (this.count === this.cap) this.grow(this.cap * 2);
    const i = this.count++;
    this.id[i] = this.nextId++;
    this.persona[i] = p.persona;
    this.look[i] = p.look; this.seed[i] = p.seed; this.motif[i] = p.motif;
    this.v0[i] = p.v0; this.speed[i] = 0;
    this.from[i] = p.from; this.dest[i] = p.dest;
    this.dx[i] = p.dx; this.dy[i] = p.dy; this.dz[i] = p.dz;
    this.wait[i] = 0; this.stuck[i] = 0; this.obs[i] = 0; this.goEdge[i] = -1; this.onCross[i] = 0; this.reroute[i] = 0;
    this.setPath(i, path, n, p.s0, p.s1);
    const half = g.eHalf[this.edge[i]!]!;
    this.lat0[i] = half * (0.25 + 0.5 * this.random());
    this.lat[i] = 0; this.latT[i] = this.lat0[i]!;
    g.pointAt(this.edge[i]!, this.s[i]!, tmpP, 0);
    if (p.skipLeg) {
      this.state[i] = ST_WALK;
      this.lat[i] = this.lat0[i]!;
      this.place(i);
      this.heading[i] = Math.atan2(this.tdx[i]!, this.tdz[i]!);
    } else {
      this.state[i] = ST_LEG_OUT;
      this.x[i] = p.ox; this.y[i] = p.oy; this.z[i] = p.oz;
      // Cible du trajet de sortie : point d'accès sur le trottoir.
      this.ox[i] = tmpP[0]!; this.oy[i] = tmpP[1]!; this.oz[i] = tmpP[2]!;
      const ddx = tmpP[0]! - p.ox, ddz = tmpP[2]! - p.oz, l = Math.hypot(ddx, ddz) || 1;
      this.tdx[i] = ddx / l; this.tdz[i] = ddz / l;
      this.heading[i] = Math.atan2(ddx, ddz);
    }
    return i;
  }

  /** Installe un chemin (appelé aussi après un recalcul). Le piéton doit se trouver sur `path[0]` à l'abscisse `s0`. */
  setPath(i: number, path: Int32Array, n: number, s0: number, s1: number): void {
    const g = this.g!;
    const base = i * MAX_PATH;
    for (let k = 0; k < n; k++) this.path[base + k] = path[k]!;
    this.pathLen[i] = n; this.pathPos[i] = 0;
    const e0 = path[0]!;
    this.edge[i] = e0; this.s[i] = s0; this.pi[i] = 0; this.endS[i] = s1;
    if (n === 1) this.fwd[i] = s1 >= s0 ? 1 : 0;
    else {
      // Sens sur la première arête : vers l'extrémité partagée avec la suivante.
      const e1 = path[1]!;
      const b = g.eb[e0]!;
      this.fwd[i] = b === g.ea[e1] || b === g.eb[e1] ? 1 : 0;
    }
    this.reroute[i] = 0;
    this.goEdge[i] = -1;
  }

  /** Retire un piéton (permutation avec le dernier). */
  remove(i: number): void {
    const g = this.g;
    if (g && !this.reroute[i]) {
      if (this.onCross[i]) { const e = this.edge[i]!; if (this.crossOn[e]! > 0) this.crossOn[e]!--; }
      if (this.state[i] === ST_WAIT) { const nxt = this.path[i * MAX_PATH + this.pathPos[i]! + 1]!; if (this.crossWait[nxt]! > 0) this.crossWait[nxt]!--; }
    }
    const last = --this.count;
    if (i === last) return;
    this.id[i] = this.id[last]!; this.persona[i] = this.persona[last]!; this.state[i] = this.state[last]!;
    this.x[i] = this.x[last]!; this.y[i] = this.y[last]!; this.z[i] = this.z[last]!; this.heading[i] = this.heading[last]!;
    this.tdx[i] = this.tdx[last]!; this.tdz[i] = this.tdz[last]!;
    this.speed[i] = this.speed[last]!; this.v0[i] = this.v0[last]!;
    this.lat[i] = this.lat[last]!; this.latT[i] = this.latT[last]!; this.lat0[i] = this.lat0[last]!;
    this.edge[i] = this.edge[last]!; this.fwd[i] = this.fwd[last]!; this.s[i] = this.s[last]!; this.pi[i] = this.pi[last]!;
    this.pathPos[i] = this.pathPos[last]!; this.pathLen[i] = this.pathLen[last]!; this.endS[i] = this.endS[last]!;
    this.path.copyWithin(i * MAX_PATH, last * MAX_PATH, last * MAX_PATH + this.pathLen[last]!);
    this.ox[i] = this.ox[last]!; this.oy[i] = this.oy[last]!; this.oz[i] = this.oz[last]!;
    this.dx[i] = this.dx[last]!; this.dy[i] = this.dy[last]!; this.dz[i] = this.dz[last]!;
    this.wait[i] = this.wait[last]!; this.stuck[i] = this.stuck[last]!; this.obs[i] = this.obs[last]!;
    this.goEdge[i] = this.goEdge[last]!; this.onCross[i] = this.onCross[last]!; this.reroute[i] = this.reroute[last]!;
    this.look[i] = this.look[last]!; this.seed[i] = this.seed[last]!; this.motif[i] = this.motif[last]!;
    this.from[i] = this.from[last]!; this.dest[i] = this.dest[last]!;
  }

  /** Position monde depuis (arête, abscisse, décalage latéral) ; met à jour la direction de marche. */
  private place(i: number): void {
    const g = this.g!;
    this.pi[i] = g.pointAt(this.edge[i]!, this.s[i]!, tmpP, this.pi[i]!);
    const sg = this.fwd[i] ? 1 : -1;
    const tx = tmpP[3]! * sg, tz = tmpP[4]! * sg;
    if (tx !== 0 || tz !== 0) { this.tdx[i] = tx; this.tdz[i] = tz; }
    // Droite du sens de marche : (-tz, tx).
    this.x[i] = tmpP[0]! - this.tdz[i]! * this.lat[i]!;
    this.y[i] = tmpP[1]!;
    this.z[i] = tmpP[2]! + this.tdx[i]! * this.lat[i]!;
  }

  /** Longueur restante (m) du chemin d'un piéton. */
  remaining(i: number): number {
    const g = this.g;
    if (!g || this.reroute[i]) return 0;
    const base = i * MAX_PATH, n = this.pathLen[i]!, pos = this.pathPos[i]!;
    const e = this.edge[i]!;
    if (pos === n - 1) return Math.abs(this.endS[i]! - this.s[i]!);
    let d = this.fwd[i] ? g.eLen[e]! - this.s[i]! : this.s[i]!;
    for (let k = pos + 1; k < n - 1; k++) d += g.eLen[this.path[base + k]!]!;
    // Dernière arête : depuis son extrémité d'entrée jusqu'à endS.
    const le = this.path[base + n - 1]!, prev = this.path[base + n - 2]!;
    const entersAtA = g.ea[le] === g.ea[prev] || g.ea[le] === g.eb[prev];
    d += entersAtA ? this.endS[i]! : g.eLen[le]! - this.endS[i]!;
    return d;
  }

  /* ----------------------------- Traversées ----------------------------- */

  /** Autorisation de s'engager sur la traversée `c` (voir en-tête). `atCurb` : le piéton attend au bord. */
  canCross(i: number, c: number, atCurb: boolean): number {
    const g = this.g!;
    const node = g.eNode[c]!, seg = g.eSeg[c]!;
    const need = g.eLen[c]! / (this.v0[i]! * 1.12);
    const waited = this.wait[i]!;
    let forced = false;
    if (this.feux && node >= 0 && this.feux.passage(node, seg, tmpEtat)) {
      if (tmpEtat.etat === FEU_VERT && tmpEtat.restant >= need * 0.8 + (atCurb ? 0 : 1.5)) return CROSS_GREEN;
      if (!atCurb || waited < MAX_WAIT_SIGNAL) return CROSS_NO;
      forced = true;
    }
    // Traversée prudente.
    const platoon = this.crossOn[c]! > 0 && this.time - this.crossLast[c]! < 1.5;
    if (!atCurb) return platoon && !forced ? CROSS_PRUDENT : CROSS_NO;
    if (waited < this.obs[i]! && !platoon) return CROSS_NO;
    if (this.trafic && this.trafic.creneau(seg, g.eRoadS[c]!) < need + 1.5) {
      if (waited < MAX_WAIT_GAP) return CROSS_NO;
      forced = true;
    }
    return forced ? CROSS_FORCED : CROSS_PRUDENT;
  }

  private grant(i: number, c: number, how: number): void {
    this.goEdge[i] = c;
    this.counters.crossings++;
    if (how === CROSS_GREEN) this.counters.green++;
    else if (how === CROSS_FORCED) this.counters.forced++;
    else this.counters.prudent++;
  }

  /** Passe sur l'arête suivante du chemin. */
  private enter(i: number): void {
    const g = this.g!;
    const e = this.edge[i]!;
    const node = this.fwd[i] ? g.eb[e]! : g.ea[e]!;
    if (this.onCross[i]) { if (this.crossOn[e]! > 0) this.crossOn[e]!--; this.onCross[i] = 0; }
    const pos = ++this.pathPos[i]!;
    const nxt = this.path[i * MAX_PATH + pos]!;
    this.edge[i] = nxt;
    const f = g.ea[nxt] === node;
    this.fwd[i] = f ? 1 : 0;
    this.s[i] = f ? 0 : g.eLen[nxt]!;
    this.pi[i] = f ? 0 : g.ePtN[nxt]! - 2;
    if (g.isCrossing(nxt)) { this.crossOn[nxt]!++; this.onCross[i] = 1; this.crossLast[nxt] = this.time; }
    this.goEdge[i] = -1;
  }

  /* ----------------------------- Voisinage ----------------------------- */

  private buildGrid(): void {
    const head = this.gridHead, next = this.gridNext, mask = this.gridMask;
    head.fill(-1);
    for (let i = 0; i < this.count; i++) {
      const cx = Math.floor(this.x[i]! / GRID_CELL), cz = Math.floor(this.z[i]! / GRID_CELL);
      const h = (Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663)) & mask;
      next[i] = head[h]!;
      head[h] = i;
    }
  }

  /* ------------------------------- Pas ------------------------------- */

  /** Avance tous les piétons de `dt` secondes. Les piétons arrivés sont listés dans `arrived` (index décroissants). */
  step(dt: number): void {
    const g = this.g;
    this.arrived.length = 0;
    this.walking = this.waiting = this.crossing = 0;
    if (!g || this.count === 0) return;
    this.time += dt;
    this.buildGrid();
    const head = this.gridHead, next = this.gridNext, mask = this.gridMask;
    for (let i = 0; i < this.count; i++) {
      const st = this.state[i]!;
      if (st === ST_LEG_OUT || st === ST_LEG_IN) {
        this.walking++;
        const tx = st === ST_LEG_OUT ? this.ox[i]! : this.dx[i]!, ty = st === ST_LEG_OUT ? this.oy[i]! : this.dy[i]!, tz = st === ST_LEG_OUT ? this.oz[i]! : this.dz[i]!;
        const ddx = tx - this.x[i]!, ddz = tz - this.z[i]!;
        const d = Math.hypot(ddx, ddz);
        const v = this.speed[i] = Math.min(this.v0[i]!, this.speed[i]! + 1.5 * dt);
        const stepLen = v * dt;
        if (d <= stepLen + 0.05) {
          if (st === ST_LEG_IN) { this.arrived.push(i); continue; }
          if (this.reroute[i]) { this.speed[i] = 0; continue; }
          this.state[i] = ST_WALK;
          this.lat[i] = 0;
          this.place(i);
        } else {
          const f = stepLen / d;
          this.x[i] = this.x[i]! + ddx * f; this.z[i] = this.z[i]! + ddz * f;
          this.y[i] = this.y[i]! + (ty - this.y[i]!) * f;
          this.tdx[i] = ddx / d; this.tdz[i] = ddz / d;
        }
        this.heading[i] = this.heading[i]! + wrapPi(Math.atan2(this.tdx[i]!, this.tdz[i]!) - this.heading[i]!) * 0.35;
        continue;
      }
      if (this.reroute[i]) { this.speed[i] = 0; this.waiting++; continue; }
      const e = this.edge[i]!;
      const L = g.eLen[e]!, half = g.eHalf[e]!;
      const sg = this.fwd[i] ? 1 : -1;
      const base = i * MAX_PATH;
      const pos = this.pathPos[i]!, isLast = pos === this.pathLen[i]! - 1;
      const target = isLast ? this.endS[i]! : this.fwd[i] ? L : 0;
      const distToEnd = (target - this.s[i]!) * sg;
      const nxt = isLast ? -1 : this.path[base + pos + 1]!;
      const nextIsCross = nxt >= 0 && g.isCrossing(nxt);

      if (st === ST_WAIT) {
        this.waiting++;
        this.wait[i] = this.wait[i]! + dt;
        this.speed[i] = 0;
        const how = this.canCross(i, nxt, true);
        if (how !== CROSS_NO) {
          this.grant(i, nxt, how);
          if (this.crossWait[nxt]! > 0) this.crossWait[nxt]!--;
          this.state[i] = ST_WALK;
          this.wait[i] = 0; this.stuck[i] = 0;
        }
        continue;
      }

      // --- Marche : évitement local ---
      if (this.onCross[i]) this.crossing++; else this.walking++;
      const fx = this.tdx[i]!, fz = this.tdz[i]!;
      const rx = -fz, rz = fx;
      const px = this.x[i]!, pz = this.z[i]!, py = this.y[i]!;
      const v0 = this.v0[i]! * (this.onCross[i] ? 1.12 : 1);
      let vmax = v0;
      let conflict = -1, conflictAhead = LOOKAHEAD, conflictSide = 0, conflictRel = 0, conflictV = 0;
      const ghost = this.stuck[i]! < 0;
      if (!ghost) {
        const cx = Math.floor(px / GRID_CELL), cz = Math.floor(pz / GRID_CELL);
        for (let ax = cx - 1; ax <= cx + 1; ax++) {
          for (let az = cz - 1; az <= cz + 1; az++) {
            for (let j = head[(Math.imul(ax, 73856093) ^ Math.imul(az, 19349663)) & mask]!; j >= 0; j = next[j]!) {
              if (j === i) continue;
              const sj = this.state[j]!;
              if (sj !== ST_WALK && sj !== ST_WAIT) continue;
              const ddx = this.x[j]! - px, ddz = this.z[j]! - pz;
              const ahead = ddx * fx + ddz * fz;
              if (ahead < -0.15 || ahead > LOOKAHEAD) continue;
              const side = ddx * rx + ddz * rz;
              const aside = side < 0 ? -side : side;
              if (aside > 0.85 || Math.abs(this.y[j]! - py) > 1.5) continue;
              const rel = this.tdx[j]! * fx + this.tdz[j]! * fz;
              const vj = this.speed[j]! * rel;
              const still = sj === ST_WAIT || this.speed[j]! < 0.12;
              // Un piéton autorisé à traverser ne s'arrête pas derrière ceux qui attendent le même passage (ils partent aussi).
              if (still && this.goEdge[i]! >= 0 && this.goEdge[j] === this.goEdge[i]) continue;
              if (aside < BODY) {
                if (rel < -0.3 && !still) {
                  // Croisement de face : on ralentit au contact, sans jamais s'arrêter (pas de face-à-face bloqué).
                  if (ahead < 0.8 && aside < 0.4) vmax = Math.min(vmax, 0.4 * v0);
                } else if (still || vj < v0 - 0.1 || ahead < 0.9) {
                  // Suivi : on garde ses distances derrière plus lent que soi.
                  if (rel > -0.3 || still) vmax = Math.min(vmax, Math.max(0, (still ? 0 : vj) + (ahead - 0.55) * 1.5));
                }
              }
              if (ahead < conflictAhead && (still || rel < -0.3 || vj < v0 - 0.1)) {
                conflict = j; conflictAhead = ahead; conflictSide = side; conflictRel = rel; conflictV = vj;
              }
            }
          }
        }
      }
      // Décalage latéral pour le conflit le plus proche.
      let latT = this.latT[i]!;
      if (conflict >= 0) {
        const aside = Math.abs(conflictSide);
        const need = BODY + 0.1 - aside;
        if (need > 0) {
          // Voisin à ma droite -> je me décale à gauche ; de face et dans l'axe -> chacun serre à droite.
          let away = conflictSide >= 0 ? -1 : 1;
          if (conflictRel < -0.3 && aside < 0.15) away = 1;
          const lat = this.lat[i]!;
          const a = lat + away * need, b = lat - away * (BODY + 0.1 + aside);
          if (Math.abs(a) <= half) latT = a;
          else if (Math.abs(b) <= half) latT = b;
          else latT = away * half;
        }
        void conflictV;
      } else {
        latT += (this.lat0[i]! * Math.min(1, half / 0.5) - latT) * 0.04;
      }
      if (latT > half) latT = half; else if (latT < -half) latT = -half;
      this.latT[i] = latT;
      const dl = latT - this.lat[i]!;
      const maxL = 0.7 * dt;
      this.lat[i] = this.lat[i]! + (dl > maxL ? maxL : dl < -maxL ? -maxL : dl);

      // Autorisation anticipée à l'approche d'une traversée (feu vert, ou groupe qui s'engage).
      if (nextIsCross && this.goEdge[i] !== nxt && distToEnd < QUEUE_ZONE) {
        const how = this.canCross(i, nxt, false);
        if (how !== CROSS_NO) this.grant(i, nxt, how);
        else if (vmax < 0.05 && this.speed[i]! < 0.05) {
          // Bloqué derrière ceux qui attendent : on attend sur place (file).
          this.state[i] = ST_WAIT;
          this.wait[i] = 0;
          this.obs[i] = 0.6 + this.random() * 1.2 + (g.eKind[nxt] === 3 ? 0.8 : 0);
          this.crossWait[nxt]!++;
          this.speed[i] = 0;
          continue;
        }
      }

      // Vitesse.
      let v = this.speed[i]!;
      const dv = vmax - v;
      v += dv > 1.5 * dt ? 1.5 * dt : dv < -3 * dt ? -3 * dt : dv;
      if (v < 0) v = 0;
      this.speed[i] = v;
      // Anti-blocage.
      if (ghost) this.stuck[i] = Math.min(0, this.stuck[i]! + dt);
      else if (v < 0.05 && vmax < 0.05) {
        this.stuck[i] = this.stuck[i]! + dt;
        if (this.stuck[i]! > 5) this.stuck[i] = -2.5;
      } else this.stuck[i] = 0;

      const adv = v * dt;
      if (adv >= distToEnd - 1e-4) {
        if (isLast) {
          this.s[i] = target;
          this.place(i);
          this.state[i] = ST_LEG_IN;
          if (this.onCross[i]) { if (this.crossOn[e]! > 0) this.crossOn[e]!--; this.onCross[i] = 0; }
          continue;
        }
        if (nextIsCross && this.goEdge[i] !== nxt) {
          this.s[i] = target;
          this.place(i);
          this.state[i] = ST_WAIT;
          this.wait[i] = 0;
          this.obs[i] = 0.6 + this.random() * 1.2 + (g.eKind[nxt] === 3 ? 0.8 : 0);
          this.crossWait[nxt]!++;
          this.speed[i] = 0;
          continue;
        }
        this.enter(i);
        this.s[i] = this.s[i]! + (this.fwd[i] ? 1 : -1) * Math.max(0, adv - Math.max(0, distToEnd));
      } else {
        this.s[i] = this.s[i]! + sg * adv;
      }
      this.place(i);
      this.heading[i] = this.heading[i]! + wrapPi(Math.atan2(this.tdx[i]!, this.tdz[i]!) - this.heading[i]!) * 0.3;
    }
    if (this.arrived.length > 1) this.arrived.sort((a, b) => b - a);
  }

  /** Recale un piéton marqué `reroute` sur le graphe courant ; renvoie false s'il est hors de portée de tout trottoir. */
  relocate(i: number, hit: NearestHit, maxR = 40): boolean {
    const g = this.g!;
    return g.nearest(this.x[i]!, this.z[i]!, maxR, false, hit);
  }

  /** Trame pour le rendu (tableaux neufs, transférables). */
  frame(): PietonsFrame {
    const n = this.count;
    const ids = new Uint32Array(n);
    const pos = new Float32Array(n * PIETON_POS_STRIDE);
    const meta = new Uint8Array(n * PIETON_META_STRIDE);
    ids.set(this.id.subarray(0, n));
    for (let i = 0; i < n; i++) {
      const o = i * PIETON_POS_STRIDE;
      pos[o] = this.x[i]!; pos[o + 1] = this.y[i]!; pos[o + 2] = this.z[i]!; pos[o + 3] = this.heading[i]!;
      const m = i * PIETON_META_STRIDE;
      meta[m] = this.look[i]!; meta[m + 1] = this.seed[i]!;
      const v = this.speed[i]!;
      meta[m + 2] = v < 0.12 ? PIETON_IDLE_BIT : Math.min(127, Math.round(v / PIETON_SPEED_UNIT));
    }
    return { count: n, ids, pos, meta };
  }
}
