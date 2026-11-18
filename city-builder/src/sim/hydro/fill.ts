/**
 * Eau dynamique sur la grille du terrain (simulation, TypeScript pur, déterministe) : modèle « remplir puis
 * déborder » (fill and spill).
 *
 * Entrées : relief NATUREL (barrages compris : leur axe est relevé jusqu'à la crête), eau DE BASE (mer, lacs et
 * rivières de la carte, canaux et rivières creusés par le joueur : jamais modifiée ici), barrières (bâtiments et
 * chaussées hors ponts : l'eau ne les recouvre jamais), cases creusées par le joueur, alimentations ordonnées
 * (sources et rivières barrées) avec le volume déjà délivré.
 *
 *  1. Creux reliés à une eau : une case CREUSÉE par le joueur, plus basse que la surface d'une eau voisine, se
 *     remplit à ce niveau (propagation de proche en proche, la surface la plus haute d'abord).
 *  2. Chaque alimentation remplit sa cuvette par niveaux croissants (file de priorité sur la cote du fond ou de la
 *     surface déjà en eau) : le volume reçu fait monter le niveau ; quand il atteint le col le plus bas, l'eau
 *     déborde, suit la plus grande pente (ruisseau d'une case) jusqu'au creux suivant, qui se remplit à son tour,
 *     ou jusqu'à une eau de base ou le bord de la carte (exutoire : l'alimentation est alors en régime établi).
 *
 * Le résultat ne dépend que des entrées : même partie, même minute de jeu => même eau (sauvegarde, rejeu).
 */
import { NO_WATER } from '../terrain/types';

/** Profondeur minimale d'un ruisseau de débordement (m) ; débit inconnu : ruisseau d'une case à cette profondeur. */
export const STREAM_DEPTH = 0.35;

/**
 * Géométrie hydraulique d'un cours d'eau selon son débit Q (m³/s), relations de Leopold et Maddock (ordres de
 * grandeur des rivières naturelles) : largeur ≈ 2,7 · Q^0,56 m, profondeur ≈ 0,39 · Q^0,34 m (au moins
 * STREAM_DEPTH). 1 m³/s : ≈ 2,7 m × 0,39 m ; 10 m³/s : ≈ 10 m × 0,85 m ; 100 m³/s : ≈ 35 m × 1,9 m.
 */
export function streamShape(q: number): { width: number; depth: number } {
  const Q = Math.max(0, q);
  return { width: 2.7 * Q ** 0.56, depth: Math.max(STREAM_DEPTH, 0.39 * Q ** 0.34) };
}
/** Demi-largeur maximale d'un ruisseau élargi (cases). */
const STREAM_MAX_HALF = 4;
/** Taille maximale d'une cuvette (échantillons) : au-delà, le niveau n'augmente plus (≈ 3,8 km² en cases de 8 m). */
export const MAX_LAKE_CELLS = 60_000;
/** Nombre maximal de cuvettes enchaînées par alimentation et longueur maximale d'un ruisseau (cases). */
const MAX_LAKES = 48;
const MAX_STREAM = 6000;

export interface HydroGrid {
  samplesX: number;
  samplesZ: number;
  spacing: number;
  /** Relief naturel (barrages compris). */
  ground: Float32Array;
  /** Eau de base (NO_WATER : sec). */
  base: Float32Array;
  /** 1 = l'eau ne recouvre jamais cette case (bâtiment, chaussée) ; null : aucune. */
  barrier: Uint8Array | null;
  /** Cases creusées par le joueur (remplies par l'eau voisine) ; null : aucune. */
  dug: readonly number[] | null;
  dugMask: Uint8Array | null;
  /** Repères (> 0) des cases à signaler quand une alimentation les mouille (faces amont des barrages) ; null : aucun. */
  touchMask?: Int32Array | null;
  /**
   * Buses sous les digues : case reliée + 1 (0 : aucune). Une cuvette qui atteint une extrémité se prolonge par
   * l'autre (vases communicants) ; null : aucune.
   */
  culvert?: Int32Array | null;
}

export interface HydroFeed {
  /** Échantillon d'arrivée de l'eau. */
  cell: number;
  /** Volume délivré depuis la pose (m³) ; Infinity : régime établi (aperçu). */
  volume: number;
  /** Repère libre (index de l'alimentation, ou du barrage pour une rivière barrée). */
  tag: number;
  /**
   * Source de rivière posée au bord de la carte : l'eau ENTRE par ce bord ; les cases du bord à moins de
   * INLET_GUARD cases de l'arrivée ne sont pas un exutoire (l'eau ne ressort pas aussitôt par où elle entre).
   */
  inlet?: boolean;
  /**
   * Débit (m³/s) : largeur et profondeur du ruisseau de débordement (streamShape). Absent : ruisseau d'une case à
   * STREAM_DEPTH (comportement d'origine).
   */
  flow?: number;
}

/** Demi-largeur (cases) de la portion de bord qui n'est pas un exutoire autour d'une source de rivière. */
export const INLET_GUARD = 6;

export type FeedStatus = 'sink' | 'partial' | 'capped' | 'none';

export interface FeedResult {
  status: FeedStatus;
  /** Niveau de la première cuvette (m) ; NaN si l'eau rejoint tout de suite une eau existante. */
  level: number;
  /** Surface en eau ajoutée (m²) et volume stocké (m³) par cette alimentation. */
  area: number;
  stored: number;
  /** Exutoire : 'eau' (eau de base), 'bord' (bord de la carte), '' (aucun : cuvette en remplissage ou fermée). */
  outlet: '' | 'eau' | 'bord';
  /** Repères de `touchMask` atteints (sans doublon). */
  touched: number[];
  /** Case d'eau DE BASE rejointe (exutoire 'eau') ; -1 sinon. */
  join: number;
}

/** Tas binaire min (clé flottante, valeur entière) réutilisable, sans allocation en régime établi. */
export class MinHeap {
  private keys = new Float64Array(1024);
  private vals = new Int32Array(1024);
  size = 0;
  clear(): void { this.size = 0; }
  push(key: number, val: number): void {
    if (this.size === this.keys.length) {
      const k = new Float64Array(this.size * 2); k.set(this.keys); this.keys = k;
      const v = new Int32Array(this.size * 2); v.set(this.vals); this.vals = v;
    }
    let i = this.size++;
    const K = this.keys, V = this.vals;
    while (i > 0) {
      const p = (i - 1) >> 1;
      // Égalité : la plus petite valeur d'abord (ordre total, déterministe).
      if (K[p]! < key || (K[p] === key && V[p]! <= val)) break;
      K[i] = K[p]!; V[i] = V[p]!; i = p;
    }
    K[i] = key; V[i] = val;
  }
  /** Retire le minimum ; renvoie sa valeur (la clé est dans `lastKey`). */
  lastKey = 0;
  pop(): number {
    const K = this.keys, V = this.vals;
    const topV = V[0]!;
    this.lastKey = K[0]!;
    const n = --this.size;
    if (n > 0) {
      const key = K[n]!, val = V[n]!;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        if (l >= n) break;
        const r = l + 1;
        let c = l;
        if (r < n && (K[r]! < K[l]! || (K[r] === K[l] && V[r]! < V[l]!))) c = r;
        if (key < K[c]! || (key === K[c] && val <= V[c]!)) break;
        K[i] = K[c]!; V[i] = V[c]!; i = c;
      }
      K[i] = key; V[i] = val;
    }
    return topV;
  }
}

/** Solveur réutilisable (tableaux alloués une fois par taille de carte). */
export class HydroSolver {
  /** Surface de l'eau dynamique (NO_WATER : rien) ; valide après solve(). */
  water = new Float32Array(0);
  /** Cote effective : max(relief, eau de base, eau dynamique déjà posée). */
  private E = new Float32Array(0);
  private mark = new Int32Array(0);
  private stamp = 0;
  /** Cases du ruisseau (lit et élargissement) de l'alimentation en cours : jamais prises pour un exutoire. */
  private own = new Int32Array(0);
  private ownStamp = 0;
  private readonly heap = new MinHeap();
  private readonly cells: number[] = [];
  /**
   * Cols de débordement du dernier solve() : paires (niveau de la cuvette, case juste au-delà du col) dans l'ordre
   * des cuvettes. Sert à montrer au joueur par où l'eau contourne un barrage.
   */
  readonly spills: number[] = [];

  private ensure(n: number): void {
    if (this.E.length === n) return;
    this.E = new Float32Array(n);
    this.water = new Float32Array(n);
    this.mark = new Int32Array(n);
    this.stamp = 0;
    this.own = new Int32Array(n);
    this.ownStamp = 0;
  }

  /** Calcule l'eau dynamique ; renvoie un résultat par alimentation (même ordre). */
  solve(g: HydroGrid, feeds: readonly HydroFeed[]): FeedResult[] {
    const W = g.samplesX, H = g.samplesZ, n = W * H;
    this.ensure(n);
    const E = this.E, water = this.water, ground = g.ground, base = g.base;
    for (let k = 0; k < n; k++) {
      const b = base[k]!, h = ground[k]!;
      E[k] = b !== NO_WATER && b > h + 0.05 ? b : h;
    }
    water.fill(NO_WATER);
    this.spills.length = 0;
    if (g.dug && g.dug.length && g.dugMask) this.spread(g);
    const out: FeedResult[] = [];
    for (const f of feeds) out.push(this.cascade(g, f));
    return out;
  }

  private baseWet(g: HydroGrid, k: number): boolean {
    const b = g.base[k]!;
    return b !== NO_WATER && b > g.ground[k]! + 0.05;
  }

  /** 1. Cases creusées plus basses qu'une eau voisine : remplies à son niveau (surface la plus haute d'abord). */
  private spread(g: HydroGrid): void {
    const W = g.samplesX, H = g.samplesZ;
    const E = this.E, water = this.water, dm = g.dugMask!, bar = g.barrier;
    // Tas max par le niveau (clé négative) : graines = eaux voisines d'une case creusée plus basse.
    const heap = this.heap;
    heap.clear();
    for (const k of g.dug!) {
      // Seules les cases creusées SÈCHES se remplissent (un canal ou une rivière creusés gardent leur niveau).
      if ((bar && bar[k]) || this.baseWet(g, k)) continue;
      const i = k % W, j = (k / W) | 0;
      for (let d = 0; d < 4; d++) {
        const nb = d === 0 ? (i > 0 ? k - 1 : -1) : d === 1 ? (i < W - 1 ? k + 1 : -1) : d === 2 ? (j > 0 ? k - W : -1) : (j < H - 1 ? k + W : -1);
        if (nb < 0 || !this.baseWet(g, nb)) continue;
        const lv = g.base[nb]!;
        if (lv > E[k]! + 0.02) heap.push(-lv, k);
      }
    }
    while (heap.size) {
      const k = heap.pop();
      const lv = -heap.lastKey;
      if (water[k]! !== NO_WATER && water[k]! >= lv) continue;
      if (!(lv > E[k]! + 0.02)) continue;
      water[k] = lv;
      E[k] = lv;
      const i = k % W, j = (k / W) | 0;
      for (let d = 0; d < 4; d++) {
        const nb = d === 0 ? (i > 0 ? k - 1 : -1) : d === 1 ? (i < W - 1 ? k + 1 : -1) : d === 2 ? (j > 0 ? k - W : -1) : (j < H - 1 ? k + W : -1);
        if (nb < 0 || !dm[nb] || (bar && bar[nb]) || this.baseWet(g, nb)) continue;
        if (lv > E[nb]! + 0.02) heap.push(-lv, nb);
      }
    }
  }

  /** 2. Une alimentation : cuvettes successives et ruisseaux de débordement. */
  private cascade(g: HydroGrid, f: HydroFeed): FeedResult {
    const W = g.samplesX, H = g.samplesZ;
    const E = this.E, water = this.water, mark = this.mark, bar = g.barrier;
    const cul = g.culvert ?? null;
    const A = g.spacing * g.spacing;
    const res: FeedResult = { status: 'none', level: NaN, area: 0, stored: 0, outlet: '', touched: [], join: -1 };
    const tm = g.touchMask ?? null;
    const touch = (k: number): void => { const v = tm ? tm[k]! : 0; if (v > 0 && !res.touched.includes(v)) res.touched.push(v); };
    if (f.cell < 0 || f.cell >= W * H || (bar && bar[f.cell])) return res;
    // Ruisseau à la mesure du débit : profondeur, et demi-largeur en cases (au-delà de la case du lit).
    const own = this.own;
    if (++this.ownStamp > 0x7ffffff0) { own.fill(0); this.ownStamp = 1; }
    const os = this.ownStamp;
    const shape = f.flow !== undefined && f.flow > 0 ? streamShape(f.flow) : null;
    const sDepth = shape ? shape.depth : STREAM_DEPTH;
    const sHalf = shape ? Math.max(0, Math.min(STREAM_MAX_HALF, Math.round((shape.width / 2 - g.spacing / 2) / g.spacing))) : 0;
    let V = f.volume;
    let cur = f.cell;
    const heap = this.heap, cells = this.cells;
    // Source de rivière (bord) : la portion de bord autour de l'arrivée n'est pas un exutoire.
    const fi = f.cell % W, fj = (f.cell / W) | 0;
    const border = (k: number): boolean => {
      const i = k % W, j = (k / W) | 0;
      if (!(i === 0 || j === 0 || i === W - 1 || j === H - 1)) return false;
      return !(f.inlet && Math.abs(i - fi) <= INLET_GUARD && Math.abs(j - fj) <= INLET_GUARD);
    };
    for (let lake = 0; lake < MAX_LAKES; lake++) {
      this.stamp++;
      if (this.stamp > 0x7ffffff0) { mark.fill(0); this.stamp = 1; }
      const st = this.stamp;
      heap.clear();
      cells.length = 0;
      heap.push(E[cur]!, cur);
      mark[cur] = st;
      let level = E[cur]!;
      let outflow = -1;
      let status: FeedStatus = 'partial';
      let ended = false;
      while (heap.size) {
        const c = heap.pop();
        const e = heap.lastKey;
        if (cells.length && e < level - 1e-3) { outflow = c; status = 'sink'; ended = true; break; }
        if (cells.length && e > level) {
          const need = (e - level) * cells.length * A;
          if (need >= V) { level += V / (cells.length * A); V = 0; status = 'partial'; ended = true; break; }
          V -= need;
          level = e;
        }
        cells.push(c);
        // Bord de la carte atteint : l'eau s'en va (exutoire).
        if (cells.length > 1 && border(c)) { status = 'sink'; res.outlet = 'bord'; ended = true; break; }
        if (cells.length >= MAX_LAKE_CELLS) { status = 'capped'; ended = true; break; }
        const i = c % W, j = (c / W) | 0;
        if (i > 0 && mark[c - 1] !== st && !(bar && bar[c - 1])) { mark[c - 1] = st; heap.push(E[c - 1]!, c - 1); }
        if (i < W - 1 && mark[c + 1] !== st && !(bar && bar[c + 1])) { mark[c + 1] = st; heap.push(E[c + 1]!, c + 1); }
        if (j > 0 && mark[c - W] !== st && !(bar && bar[c - W])) { mark[c - W] = st; heap.push(E[c - W]!, c - W); }
        if (j < H - 1 && mark[c + W] !== st && !(bar && bar[c + W])) { mark[c + W] = st; heap.push(E[c + W]!, c + W); }
        if (cul && cul[c]) { const o = cul[c]! - 1; if (mark[o] !== st && !(bar && bar[o])) { mark[o] = st; heap.push(E[o]!, o); } }
      }
      if (!ended && cells.length) {
        // Cuvette entièrement fermée (barrières) : le volume restant la remplit (plafonné à +50 m).
        level += Number.isFinite(V) ? Math.min(50, V / (cells.length * A)) : 0;
        status = Number.isFinite(V) ? 'partial' : 'capped';
        V = 0;
      }
      // Pose de l'eau de la cuvette.
      for (const k of cells) {
        if (tm) touch(k);
        if (level > E[k]! + 0.01) {
          res.stored += (level - E[k]!) * A;
          if (water[k] === NO_WATER) res.area += A;
          water[k] = water[k] === NO_WATER ? level : Math.max(water[k]!, level);
          E[k] = level;
        }
      }
      if (lake === 0) res.level = cells.length > 1 ? level : NaN;
      if (status === 'sink' && cells.length > 1) this.spills.push(level, outflow >= 0 ? outflow : cells[cells.length - 1]!);
      if (status !== 'sink' || outflow < 0) { res.status = status; return res; }
      // Débordement : ruisseau par la plus grande pente jusqu'au creux suivant, une eau existante ou le bord.
      let c = outflow;
      let next = -1;
      for (let s = 0; s < MAX_STREAM; s++) {
        if (this.baseWet(g, c) || (water[c] !== NO_WATER && water[c]! > g.ground[c]! + 0.05 && E[c]! < level - 1e-3 && mark[c] !== st && own[c] !== os)) {
          // Eau de base ou eau dynamique plus basse déjà posée : exutoire.
          res.status = 'sink';
          res.outlet = res.outlet || 'eau';
          if (this.baseWet(g, c)) res.join = c;
          return res;
        }
        if (border(c)) { res.status = 'sink'; res.outlet = 'bord'; return res; }
        const i = c % W, j = (c / W) | 0;
        let best = -1, be = E[c]!;
        if (i > 0 && !(bar && bar[c - 1]) && E[c - 1]! < be) { be = E[c - 1]!; best = c - 1; }
        if (i < W - 1 && !(bar && bar[c + 1]) && E[c + 1]! < be) { be = E[c + 1]!; best = c + 1; }
        if (j > 0 && !(bar && bar[c - W]) && E[c - W]! < be) { be = E[c - W]!; best = c - W; }
        if (j < H - 1 && !(bar && bar[c + W]) && E[c + W]! < be) { be = E[c + W]!; best = c + W; }
        if (best < 0) { next = c; break; }
        if (tm) touch(c);
        const sv = g.ground[c]! + sDepth;
        if (water[c] === NO_WATER || water[c]! < sv) { if (water[c] === NO_WATER) res.area += A; water[c] = sv; }
        own[c] = os;
        // Élargissement : les cases voisines (disque) plus basses que la surface du ruisseau sont en eau à ce niveau
        // (jamais à travers une barrière ni sur une eau de base).
        for (let dj = -sHalf; dj <= sHalf; dj++) {
          const jj = j + dj;
          if (jj < 0 || jj >= H) continue;
          for (let di = -sHalf; di <= sHalf; di++) {
            if ((di === 0 && dj === 0) || di * di + dj * dj > sHalf * sHalf + sHalf) continue;
            const ii = i + di;
            if (ii < 0 || ii >= W) continue;
            const nb = jj * W + ii;
            if ((bar && bar[nb]) || this.baseWet(g, nb) || g.ground[nb]! > sv - 0.05) continue;
            if (tm) touch(nb);
            if (water[nb] === NO_WATER) res.area += A;
            if (water[nb] === NO_WATER || water[nb]! < sv) water[nb] = sv;
            own[nb] = os;
          }
        }
        c = best;
      }
      if (next < 0) { res.status = 'capped'; return res; }
      if (!Number.isFinite(V) || V > 0) cur = next;
      else { res.status = 'partial'; return res; }
    }
    res.status = 'capped';
    return res;
  }
}
