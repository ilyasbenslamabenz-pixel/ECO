/**
 * Module d'eau dynamique de la simulation (TypeScript pur, worker) : sources posées par le joueur, barrages
 * (retenues), creux creusés reliés à une eau. État DÉRIVÉ de la liste des éditions du terrain (sauvegardée et
 * rejouée) et de la minute de jeu : aucune donnée propre à sauvegarder hormis `spreadFrom`.
 *
 * Couches d'eau : `base` (mer, lacs et rivières de la carte, canaux et rivières creusés : ce que les éditions
 * écrivent) et surface COMBINÉE `terrain.waterSurface` = max(base, eau dynamique) : celle que voient le rendu, la pose
 * des bâtiments (`isWet`), les ponts des routes et les autres modules. Tant que rien n'est actif, `base` n'existe pas
 * (même tableau) : une partie sans source, barrage ni creusement relié à l'eau est identique à avant.
 *
 * Remplissage : le volume délivré par une alimentation = débit × temps de jeu écoulé depuis la pose, temps
 * QUANTIFIÉ (FILL_QUANTUM_MIN minutes) pour que l'état ne dépende que de la minute de jeu (sauvegarde = rejeu). Le
 * calcul n'est refait que lorsqu'un quantum passe ET qu'une alimentation n'a pas atteint son régime établi, ou
 * qu'une édition / un bâtiment / une route a changé.
 */
import { clamp } from '../../shared/math';
import { DAM_FLOW_MAX, DAM_FLOW_PER_M, damGeometry, EDIT_LIMITS, type DamGeometry, type EditPlan, type TerrainEdit } from '../terrain/edits';
import { NO_WATER, type SampleRect, type WorldTerrain } from '../terrain/types';
import { HydroSolver, MinHeap, STREAM_DEPTH, type FeedResult, type HydroFeed, type HydroGrid } from './fill';

/** Profondeur minimale d'une retenue contre un barrage (m) : un ruisseau de débordement n'en est pas une. */
const LAKE_MIN_DEPTH = STREAM_DEPTH + 0.15;

/** Pas de temps du remplissage (minutes de jeu) : 6 min = 6 ticks (≈ 1,7 image d'eau par seconde à ×1). */
export const FILL_QUANTUM_MIN = 6;
/** Distance maximale entre une centrale hydroélectrique et l'axe d'un barrage (m, en plus de sa demi-taille). */
export const DAM_PLANT_REACH = 60;
/** Rayon de recherche d'une source à retirer (m). */
export const SOURCE_PICK_RADIUS = 30;
/** Nombre maximal de sources et de barrages actifs. */
export const MAX_SOURCES = 48;
export const MAX_DAMS = 24;
/** Nombre maximal de sources de rivière (bord de la carte) : comptées à part des sources ordinaires. */
export const MAX_EDGE_SOURCES = 12;
/** Cases d'eau de base parcourues au plus pour suivre un cours d'eau vers l'aval (par arrivée). */
const ROUTE_MAX_CELLS = 60_000;

/**
 * Source : posée par le joueur (`id` = rang de l'édition), ou ARRIVÉE d'une rivière de la carte (`auto`, `id` < 0,
 * dérivée du terrain généré : jamais sauvegardée). `edge` : source de rivière au bord de la carte (l'eau entre par ce
 * bord, débit constant).
 */
export interface HydroSource { id: number; x: number; z: number; q: number; t: number; cell: number; edge?: boolean; auto?: boolean }

export interface HydroDam {
  id: number;
  ax: number; az: number; bx: number; bz: number;
  crest: number;
  up: 1 | -1;
  /** Débit de la rivière barrée (m³/s). */
  q: number;
  t: number;
  geom: DamGeometry;
  /** Échantillon d'arrivée de la rivière barrée (côté amont, le plus bas) ; -1 si aucune. */
  seed: number;
}

/** Mesures d'un barrage (après le dernier calcul). */
export interface DamMetrics {
  id: number;
  /** Niveau de la retenue (m) ; NaN si vide. */
  level: number;
  /** Niveau aval (m). */
  tail: number;
  /** Hauteur de chute = retenue − aval (m, ≥ 0). */
  headM: number;
  /**
   * Débit qui traverse l'ouvrage : rivière barrée (débit de ses arrivées suivi vers l'aval, sinon estimé à la pose)
   * + sources qui alimentent la retenue (m³/s).
   */
  flowM3s: number;
  crest: number;
  lengthM: number;
  /** Retenue pleine (l'eau atteint la crête ou s'écoule par un col). */
  full: boolean;
  x: number; z: number;
  /** Extrémités de l'axe (raccordement de la centrale du barrage au réseau électrique). */
  ax: number; az: number; bx: number; bz: number;
}

/** Service inter-modules `hydro` (publié pour l'électricité). */
export interface HydroService {
  /** Change quand une mesure de barrage change (cache des sites). */
  version(): number;
  /** Barrage dont l'axe passe à moins de `reach` m de (x, z), le plus proche ; null sinon. */
  damNear(x: number, z: number, reach: number): DamMetrics | null;
  dam(id: number): DamMetrics | null;
  dams(): DamMetrics[];
}

/**
 * Arrivées des rivières de la carte (génération) : une par cours d'eau, à son extrémité AMONT (au bord de la carte
 * quand la rivière le touche, sinon à sa tête), sur l'eau de base. Débit constant = largeur du lit × DAM_FLOW_PER_M
 * (borné aux débits d'une source). Dérivées du terrain généré seul : identiques à chaque chargement.
 */
export function riverInlets(t: WorldTerrain): HydroSource[] {
  const out: HydroSource[] = [];
  const W = t.samplesX, H = t.samplesZ, sp = t.spacing;
  const maxX = t.originX + (W - 1) * sp, maxZ = t.originZ + (H - 1) * sp;
  const wet = (k: number): boolean => { const w = t.waterSurface[k]!; return w !== NO_WATER && w > t.heights[k]! + 0.05 && w > t.waterLevel + 0.02; };
  t.rivers.forEach((r, ri) => {
    const P = r.points;
    if (P.length < 4) return;
    const x = P[0]!, z = P[2]!, w = P[3]!;
    const ci = Math.round((x - t.originX) / sp), cj = Math.round((z - t.originZ) / sp);
    // Case d'eau la plus proche de la tête (rayon 3 cases).
    let best = -1, bd = Infinity;
    for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) {
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= W || j >= H) continue;
      const k = j * W + i;
      const d = di * di + dj * dj;
      if (d < bd && wet(k)) { bd = d; best = k; }
    }
    if (best < 0) return;
    const edge = Math.min(x - t.originX, maxX - x, z - t.originZ, maxZ - z) <= 2 * sp;
    const q = Math.round(clamp(w * DAM_FLOW_PER_M, EDIT_LIMITS.minSourceFlow, EDIT_LIMITS.maxSourceFlow));
    out.push({ id: -(ri + 1), x: t.originX + (best % W) * sp, z: t.originZ + ((best / W) | 0) * sp, q, t: 0, cell: best, auto: true, ...(edge ? { edge: true } : {}) });
  });
  return out;
}

/** Ce que le module lit / écrit dans la simulation. */
export interface HydroHost {
  terrain: WorldTerrain;
  /** Relief naturel (barrages compris). */
  natural: Float32Array;
  /** Rasterise les barrières (bâtiments, chaussées hors ponts) dans `out` (remis à 0 par l'appelant). */
  rasterBarriers(out: Uint8Array): void;
}

/** Résultat d'un aperçu (régime établi) pour une source ou un barrage planifié. */
export interface HydroPreview {
  /** Niveau de la cuvette ou de la retenue (m), NaN si l'eau rejoint tout de suite une eau existante. */
  level: number;
  area: number;
  stored: number;
  outlet: '' | 'eau' | 'bord';
  status: FeedResult['status'];
  /** Barrage : chute et débit en régime établi, crête. */
  headM?: number;
  flowM3s?: number;
}

/** Alimentations d'un calcul et ce qu'il faut pour mesurer les débits des barrages. */
interface FeedSet {
  feeds: HydroFeed[];
  q: number[];
  /** Alimentations déjà suivies vers l'aval avant le calcul (source posée sur l'eau de base). */
  onBase: boolean[];
}

const segDist = (px: number, pz: number, ax: number, az: number, bx: number, bz: number): number => {
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
  const u = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L2));
  return Math.hypot(px - ax - dx * u, pz - az - dz * u);
};

export class HydroSystem {
  /** Eau de base séparée (null tant que le module est inactif : `terrain.waterSurface` en tient lieu). */
  base: Float32Array | null = null;
  sources: HydroSource[] = [];
  /** Arrivées des rivières de la carte (`riverInlets`) : conservées par `reset` (dérivées du terrain). */
  inlets: HydroSource[] = [];
  dams: HydroDam[] = [];
  /** Cases creusées par le joueur depuis `spreadFrom` (remplies par l'eau voisine). */
  dug: number[] = [];
  dugMask: Uint8Array | null = null;
  /** Index de la première édition dont les creusements se remplissent (anciennes parties : éditions antérieures exclues). */
  spreadFrom = 0;
  private barrier: Uint8Array | null = null;
  barrierDirty = true;
  /** Recalcul nécessaire (édition, barrière, chargement). */
  dirty = true;
  steady = true;
  private lastQuantum = -1;
  private readonly solver = new HydroSolver();
  private readonly previewSolver = new HydroSolver();
  private touchMask: Int32Array | null = null;
  /** Buses des digues : paires de cases (a, b) dans l'ordre des éditions, et table case -> case reliée + 1. */
  private culverts: number[] = [];
  private culvertMask: Int32Array | null = null;
  private metrics = new Map<number, DamMetrics>();
  private ver = 0;
  /** Durée du dernier calcul (ms) et nombre de calculs (mesures). */
  lastMs = 0;
  computeCount = 0;

  readonly service: HydroService = {
    version: () => this.ver,
    damNear: (x, z, reach) => {
      let best: DamMetrics | null = null, bd = Infinity;
      for (const d of this.dams) {
        const dist = segDist(x, z, d.ax, d.az, d.bx, d.bz);
        if (dist <= reach && dist < bd) { bd = dist; best = this.metrics.get(d.id) ?? null; }
      }
      return best;
    },
    dam: (id) => this.metrics.get(id) ?? null,
    dams: () => [...this.metrics.values()],
  };

  reset(spreadFrom = 0): void {
    this.base = null;
    this.sources = [];
    this.dams = [];
    this.dug = [];
    this.dugMask = null;
    this.spreadFrom = spreadFrom;
    this.barrier = null;
    this.barrierDirty = true;
    this.dirty = true;
    this.steady = true;
    this.lastQuantum = -1;
    this.touchMask = null;
    this.culverts = [];
    this.culvertMask = null;
    this.metrics.clear();
    this.ver++;
  }

  /** Bâtiments ou routes modifiés : barrières à recalculer (et l'eau, si le module est actif : état déterministe). */
  markBarrier(): void { this.barrierDirty = true; if (this.active) this.dirty = true; }

  get active(): boolean { return this.sources.length > 0 || this.dams.length > 0 || this.dug.length > 0; }

  /** Eau de base (là où les éditions écrivent). */
  baseWater(t: WorldTerrain): Float32Array { return this.base ?? t.waterSurface; }

  /** Avant l'application d'un plan : cases creusées (relief abaissé) par une édition postérieure à `spreadFrom`. */
  noteDug(plan: EditPlan, index: number, natural: Float32Array, n: number): void {
    if (index < this.spreadFrom || plan.idx.length === 0) return;
    for (let i = 0; i < plan.idx.length; i++) {
      const k = plan.idx[i]!;
      if (plan.h[i]! < natural[k]! - 0.05) {
        if (!this.dugMask) this.dugMask = new Uint8Array(n);
        if (!this.dugMask[k]) { this.dugMask[k] = 1; this.dug.push(k); }
      }
    }
  }

  /** Après l'application d'une édition (pose ou rejeu) : sources et barrages. */
  onEdit(e: TerrainEdit, index: number, t: WorldTerrain): void {
    if (e.k === 'source') {
      const i = Math.round((e.x - t.originX) / t.spacing), j = Math.round((e.z - t.originZ) / t.spacing);
      this.sources.push({ id: index, x: e.x, z: e.z, q: e.q, t: e.t ?? 0, cell: j * t.samplesX + i, ...(e.e === 1 ? { edge: true } : {}) });
    } else if (e.k === 'unsource') {
      const s = this.sourceNear(e.x, e.z);
      if (s) this.sources = this.sources.filter((o) => o !== s);
    } else if (e.k === 'dam' && e.h !== undefined) {
      const up = e.up ?? 1;
      const geom = damGeometry(t, e.ax, e.az, e.bx, e.bz, up);
      this.dams.push({ id: index, ax: e.ax, az: e.az, bx: e.bx, bz: e.bz, crest: e.h, up, q: Math.min(DAM_FLOW_MAX, e.q ?? 0), t: e.t ?? 0, geom, seed: -1 });
      this.touchMask = null;
    } else if (e.k === 'levee' && e.lk) {
      const W = t.samplesX, H = t.samplesZ;
      const cell = (x: number, z: number): number => {
        const i = Math.round((x - t.originX) / t.spacing), j = Math.round((z - t.originZ) / t.spacing);
        return i < 0 || j < 0 || i >= W || j >= H ? -1 : j * W + i;
      };
      for (let q = 0; q + 3 < e.lk.length; q += 4) {
        const a = cell(e.lk[q]!, e.lk[q + 1]!), b = cell(e.lk[q + 2]!, e.lk[q + 3]!);
        if (a >= 0 && b >= 0 && a !== b) this.culverts.push(a, b);
      }
      this.culvertMask = null;
      if (!this.active) return;
    } else if (!this.active) return;
    this.dirty = true;
  }

  /** Reconstruit sources et barrages depuis la liste des éditions (après une annulation). */
  rebuild(edits: readonly TerrainEdit[], t: WorldTerrain): void {
    this.sources = [];
    this.dams = [];
    this.touchMask = null;
    this.culverts = [];
    this.culvertMask = null;
    edits.forEach((e, i) => { if (e.k === 'source' || e.k === 'unsource' || e.k === 'dam' || e.k === 'levee') this.onEdit(e, i, t); });
    this.dirty = true;
  }

  /** Sources ordinaires et sources de rivière (bord de la carte), comptées séparément. */
  get plainSourceCount(): number { return this.sources.reduce((n, s) => n + (s.edge ? 0 : 1), 0); }
  get edgeSourceCount(): number { return this.sources.length - this.plainSourceCount; }

  /** Source la plus proche de (x, z) à moins de SOURCE_PICK_RADIUS m ; null sinon. */
  sourceNear(x: number, z: number): HydroSource | null {
    let best: HydroSource | null = null, bd = SOURCE_PICK_RADIUS;
    for (const s of this.sources) { const d = Math.hypot(s.x - x, s.z - z); if (d <= bd) { bd = d; best = s; } }
    return best;
  }

  /** Active la couche de base séparée (copie de la surface actuelle, sans eau dynamique). */
  private ensureBase(t: WorldTerrain): Float32Array {
    if (!this.base) this.base = new Float32Array(t.waterSurface);
    return this.base;
  }

  /** Après une édition appliquée à l'eau de base : la surface combinée de ces échantillons repart de la base. */
  syncBase(t: WorldTerrain, idx: Int32Array): void {
    if (!this.base) return;
    for (let i = 0; i < idx.length; i++) t.waterSurface[idx[i]!] = this.base[idx[i]!]!;
  }

  private grid(host: HydroHost, ground: Float32Array, base: Float32Array): HydroGrid {
    const t = host.terrain;
    const n = t.samplesX * t.samplesZ;
    if (this.barrierDirty || !this.barrier) {
      if (!this.barrier || this.barrier.length !== n) this.barrier = new Uint8Array(n); else this.barrier.fill(0);
      host.rasterBarriers(this.barrier);
      this.barrierDirty = false;
    }
    if (!this.touchMask || this.touchMask.length !== n) {
      this.touchMask = new Int32Array(n);
      this.dams.forEach((d, i) => { for (const k of d.geom.upFace) this.touchMask![k] = i + 1; });
    }
    if (this.culverts.length && (!this.culvertMask || this.culvertMask.length !== n)) {
      // Dernière buse posée gagnante pour une case partagée (ordre des éditions : déterministe).
      this.culvertMask = new Int32Array(n);
      for (let q = 0; q + 1 < this.culverts.length; q += 2) { const a = this.culverts[q]!, b = this.culverts[q + 1]!; this.culvertMask[a] = b + 1; this.culvertMask[b] = a + 1; }
    }
    return { samplesX: t.samplesX, samplesZ: t.samplesZ, spacing: t.spacing, ground, base, barrier: this.barrier, dug: this.dug.length ? this.dug : null, dugMask: this.dugMask, touchMask: this.touchMask, culvert: this.culverts.length ? this.culvertMask : null };
  }

  /** Arrivée de la rivière barrée : échantillon amont en eau (base) le plus bas, hors barrières. */
  private damSeed(d: HydroDam, ground: Float32Array, base: Float32Array): number {
    let best = -1, be = Infinity;
    for (const k of d.geom.upFace) {
      const b = base[k]!;
      if (!(b !== NO_WATER && b > ground[k]! + 0.05)) continue;
      if (this.barrier?.[k]) continue;
      if (b < be) { be = b; best = k; }
    }
    return best;
  }

  /**
   * Suit l'eau DE BASE vers l'aval (file de priorité sur la cote : le plus bas d'abord) depuis chaque arrivée et
   * ajoute son débit à chaque barrage dont la face amont est atteinte ; après un barrage, la suite repart de sa face
   * aval (barrages en cascade). Arrêt à la mer, au bord de la carte ou après ROUTE_MAX_CELLS cases. Ne dépend que de
   * l'eau de base, du relief et des barrières : déterministe.
   */
  private route(g: HydroGrid, starts: readonly { cell: number; q: number }[], out: Float64Array, seaLevel: number): void {
    if (!starts.length || !this.dams.length || !g.touchMask) return;
    const W = g.samplesX, H = g.samplesZ, n = W * H;
    if (!this.routeMark || this.routeMark.length !== n) { this.routeMark = new Int32Array(n); this.routeStamp = 0; }
    const mark = this.routeMark, heap = this.routeHeap, tm = g.touchMask, bar = g.barrier, base = g.base, ground = g.ground;
    const wet = (k: number): boolean => { const b = base[k]!; return b !== NO_WATER && b > ground[k]! + 0.05 && !(bar && bar[k]); };
    const reached = new Uint8Array(this.dams.length);
    for (const st of starts) {
      if (st.cell < 0 || st.cell >= n || !(st.q > 0) || !wet(st.cell)) continue;
      if (++this.routeStamp > 0x7ffffff0) { mark.fill(0); this.routeStamp = 1; }
      const stamp = this.routeStamp;
      const si = st.cell % W, sj = (st.cell / W) | 0;
      reached.fill(0);
      heap.clear();
      heap.push(base[st.cell]!, st.cell);
      mark[st.cell] = stamp;
      let seen = 0;
      while (heap.size && seen++ < ROUTE_MAX_CELLS) {
        const c = heap.pop();
        if (heap.lastKey <= seaLevel + 0.02) break; // la mer
        const i = c % W, j = (c / W) | 0;
        // Bord de la carte (hors de la portion d'arrivée) : l'eau quitte la carte.
        if ((i === 0 || j === 0 || i === W - 1 || j === H - 1) && Math.abs(i - si) + Math.abs(j - sj) > 6) break;
        const v = tm[c]!;
        if (v > 0 && !reached[v - 1]) {
          reached[v - 1] = 1;
          out[v - 1] = out[v - 1]! + st.q;
          // Suite en aval du barrage : case d'eau de base la plus basse de sa face aval.
          let nb = -1, nl = Infinity;
          for (const k of this.dams[v - 1]!.geom.downFace) if (wet(k) && mark[k] !== stamp && base[k]! < nl) { nl = base[k]!; nb = k; }
          if (nb >= 0) { mark[nb] = stamp; heap.push(nl, nb); }
        }
        if (i > 0 && mark[c - 1] !== stamp && wet(c - 1)) { mark[c - 1] = stamp; heap.push(base[c - 1]!, c - 1); }
        if (i < W - 1 && mark[c + 1] !== stamp && wet(c + 1)) { mark[c + 1] = stamp; heap.push(base[c + 1]!, c + 1); }
        if (j > 0 && mark[c - W] !== stamp && wet(c - W)) { mark[c - W] = stamp; heap.push(base[c - W]!, c - W); }
        if (j < H - 1 && mark[c + W] !== stamp && wet(c + W)) { mark[c + W] = stamp; heap.push(base[c + W]!, c + W); }
      }
    }
  }

  private routeMark: Int32Array | null = null;
  private routeStamp = 0;
  private readonly routeHeap = new MinHeap();

  /**
   * Alimentations ordonnées (ordre des éditions) avec leur volume à la minute `tq`. Rivière barrée : débit de ses
   * arrivées (rivières de la carte, sources posées sur l'eau de base) suivi jusqu'au barrage, sinon débit estimé à
   * la pose (`q` de l'édition).
   */
  private feeds(tq: number, g: HydroGrid, seaLevel: number, infinite: boolean): FeedSet {
    const { ground, base } = g;
    const isBase = (k: number): boolean => k >= 0 && k < base.length && base[k]! !== NO_WATER && base[k]! > ground[k]! + 0.05;
    const starts: { cell: number; q: number }[] = [];
    for (const s of this.inlets) starts.push({ cell: s.cell, q: s.q });
    const onBaseSrc = this.sources.map((s) => isBase(s.cell));
    this.sources.forEach((s, i) => { if (onBaseSrc[i]) starts.push({ cell: s.cell, q: s.q }); });
    const routed = new Float64Array(this.dams.length);
    this.route(g, starts, routed, seaLevel);
    const items: { id: number; feed: HydroFeed; q: number; onBase: boolean }[] = [];
    this.sources.forEach((s, i) => items.push({ id: s.id, q: s.q, onBase: onBaseSrc[i]!, feed: { cell: s.cell, volume: infinite ? Infinity : s.q * Math.max(0, tq - s.t) * 60, tag: i, ...(s.edge ? { inlet: true } : {}) } }));
    this.dams.forEach((d, i) => {
      const q = routed[i]! > 0 ? Math.min(DAM_FLOW_MAX, Math.round(routed[i]! * 100) / 100) : d.q;
      d.seed = q > 0 ? this.damSeed(d, ground, base) : -1;
      if (d.seed >= 0) items.push({ id: d.id, q, onBase: false, feed: { cell: d.seed, volume: infinite ? Infinity : q * Math.max(0, tq - d.t) * 60, tag: -(i + 1) } });
    });
    items.sort((a, b) => a.id - b.id);
    return { feeds: items.map((o) => o.feed), q: items.map((o) => o.q), onBase: items.map((o) => o.onBase) };
  }

  /**
   * Débit qui traverse chaque barrage : sa rivière (alimentation propre), les alimentations dont l'eau mouille sa
   * face amont, et les sources posées à terre dont le ruisseau rejoint une rivière qui mène au barrage. `full` : une
   * alimentation qui l'atteint est en régime établi.
   */
  private damFlows(g: HydroGrid, fs: FeedSet, res: FeedResult[], seaLevel: number): { flow: number[]; full: boolean[] } {
    const nd = this.dams.length;
    const flow = new Array<number>(nd).fill(0), full = new Array<boolean>(nd).fill(false);
    const post = new Float64Array(nd);
    const starts: { cell: number; q: number }[] = [];
    fs.feeds.forEach((f, fi) => { if (f.tag >= 0 && !fs.onBase[fi] && res[fi]!.join >= 0) starts.push({ cell: res[fi]!.join, q: fs.q[fi]! }); });
    this.route(g, starts, post, seaLevel);
    for (let i = 0; i < nd; i++) {
      let f = post[i]!;
      fs.feeds.forEach((fd, fi) => {
        const r = res[fi]!;
        if (fd.tag === -(i + 1) || r.touched.includes(i + 1)) {
          f += fs.q[fi]!;
          if (r.status !== 'partial') full[i] = true;
        }
      });
      flow[i] = f;
    }
    return { flow, full };
  }

  /**
   * Appelé à chaque tick : recalcule si nécessaire. Renvoie la région dont la surface combinée a changé (patch du
   * rendu) ou null. `force` : recalcul immédiat (édition appliquée, chargement).
   */
  update(host: HydroHost, now: number, force = false): SampleRect | null {
    if (!this.active) {
      if (!this.base) return null;
      // Plus rien d'actif (annulation) : la surface combinée redevient la base.
      return this.writeCombined(host.terrain, null);
    }
    const quantum = Math.floor(now / FILL_QUANTUM_MIN);
    if (!force && !this.dirty && (this.steady || quantum === this.lastQuantum)) return null;
    const t0 = performance.now();
    const t = host.terrain;
    const base = this.ensureBase(t);
    const ground = host.natural;
    const g = this.grid(host, ground, base);
    const fs = this.feeds(quantum * FILL_QUANTUM_MIN, g, t.waterLevel, false);
    const res = this.solver.solve(g, fs.feeds);
    this.steady = res.every((r) => r.status !== 'partial');
    const rect = this.writeCombined(t, this.solver.water);
    this.measureDams(t, ground, this.damFlows(g, fs, res, t.waterLevel));
    this.lastQuantum = quantum;
    this.dirty = false;
    this.lastMs = performance.now() - t0;
    this.computeCount++;
    return rect;
  }

  /** Surface combinée = max(base, eau dynamique) ; renvoie la région modifiée. */
  private writeCombined(t: WorldTerrain, water: Float32Array | null): SampleRect | null {
    const base = this.base!;
    const ws = t.waterSurface, W = t.samplesX;
    let i0 = W, j0 = t.samplesZ, i1 = -1, j1 = -1;
    for (let k = 0; k < ws.length; k++) {
      const b = base[k]!;
      const w = water ? water[k]! : NO_WATER;
      const v = w !== NO_WATER && w > b ? w : b;
      if (v !== ws[k]) {
        ws[k] = v;
        const i = k % W, j = (k / W) | 0;
        if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j;
      }
    }
    if (!water) this.base = null;
    return i1 < 0 ? null : { i0, j0, i1, j1 };
  }

  private measureDams(t: WorldTerrain, ground: Float32Array, df: { flow: number[]; full: boolean[] }): void {
    const ws = t.waterSurface;
    const next = new Map<number, DamMetrics>();
    let changed = this.metrics.size !== this.dams.length;
    this.dams.forEach((d, i) => {
      const flow = df.flow[i]!, full = df.full[i]!;
      let level = -Infinity, tail = Infinity;
      // Retenue : eau d'un lac (plus profonde qu'un ruisseau) contre la face amont, sous la crête.
      for (const k of d.geom.upFace) if (ground[k]! < d.crest && ws[k]! !== NO_WATER && ws[k]! > ground[k]! + LAKE_MIN_DEPTH) level = Math.max(level, ws[k]!);
      for (const k of d.geom.downFace) tail = Math.min(tail, ws[k]! !== NO_WATER && ws[k]! > ground[k]! ? ws[k]! : ground[k]!);
      if (!Number.isFinite(tail)) tail = d.crest;
      const lv = Number.isFinite(level) ? level : NaN;
      const headM = Number.isFinite(level) ? Math.max(0, Math.round((level - tail) * 10) / 10) : 0;
      const m: DamMetrics = { id: d.id, level: lv, tail, headM, flowM3s: Math.round(flow * 10) / 10, crest: d.crest, lengthM: Math.round(d.geom.length), full: full && headM > 0, x: (d.ax + d.bx) / 2, z: (d.az + d.bz) / 2, ax: d.ax, az: d.az, bx: d.bx, bz: d.bz };
      const old = this.metrics.get(d.id);
      if (!old || old.headM !== m.headM || old.flowM3s !== m.flowM3s || old.full !== m.full) changed = true;
      next.set(d.id, m);
    });
    this.metrics = next;
    if (changed) this.ver++;
  }

  /**
   * Aperçu en régime établi d'une source ou d'un barrage planifié (sans rien modifier). `plan` : barrage (relief
   * de l'axe appliqué sur une copie), `source` : position et débit.
   */
  preview(host: HydroHost, add: { source?: { x: number; z: number; q: number; edge?: boolean }; dam?: { plan: EditPlan } }): HydroPreview {
    const t = host.terrain;
    const W = t.samplesX;
    const baseLive = this.base ?? t.waterSurface;
    let ground = host.natural, base = baseLive;
    const dams = this.dams, sources = this.sources;
    const savedTouch = this.touchMask;
    let newDam: HydroDam | null = null;
    if (add.dam) {
      const p = add.dam.plan, e = p.edit as Extract<TerrainEdit, { k: 'dam' }>;
      ground = new Float32Array(host.natural);
      base = new Float32Array(baseLive);
      for (let i = 0; i < p.idx.length; i++) { ground[p.idx[i]!] = p.h[i]!; base[p.idx[i]!] = p.ws[i]!; }
      const up = e.up ?? 1;
      newDam = { id: Number.MAX_SAFE_INTEGER, ax: e.ax, az: e.az, bx: e.bx, bz: e.bz, crest: e.h ?? 0, up, q: e.q ?? 0, t: 0, geom: damGeometry(t, e.ax, e.az, e.bx, e.bz, up), seed: -1 };
      this.dams = [...dams, newDam];
    }
    if (add.source) {
      const i = Math.round((add.source.x - t.originX) / t.spacing), j = Math.round((add.source.z - t.originZ) / t.spacing);
      this.sources = [...sources, { id: Number.MAX_SAFE_INTEGER, x: add.source.x, z: add.source.z, q: add.source.q, t: 0, cell: j * W + i, ...(add.source.edge ? { edge: true } : {}) }];
    }
    this.touchMask = null;
    try {
      const g = this.grid(host, ground, base);
      const fs = this.feeds(0, g, t.waterLevel, true);
      const res = this.previewSolver.solve(g, fs.feeds);
      // Source : résultat de sa propre alimentation (la dernière posée).
      const si = add.source ? fs.feeds.findIndex((f) => f.tag === this.sources.length - 1) : -1;
      const last = si >= 0 ? res[si] : res[res.length - 1];
      const out: HydroPreview = last ? { level: last.level, area: Math.round(last.area), stored: Math.round(last.stored), outlet: last.outlet, status: last.status } : { level: NaN, area: 0, stored: 0, outlet: '', status: 'none' };
      if (newDam) {
        const di = this.dams.length;
        const flow = this.damFlows(g, fs, res, t.waterLevel).flow[di - 1]!;
        const water = this.previewSolver.water;
        let level = -Infinity, tail = Infinity;
        for (const k of newDam.geom.upFace) {
          const w = water[k]! !== NO_WATER && water[k]! > base[k]! ? water[k]! : base[k]!;
          if (ground[k]! < newDam.crest && w !== NO_WATER && w > ground[k]! + LAKE_MIN_DEPTH) level = Math.max(level, w);
        }
        for (const k of newDam.geom.downFace) {
          const w = water[k]! !== NO_WATER && water[k]! > base[k]! ? water[k]! : base[k]!;
          tail = Math.min(tail, w !== NO_WATER && w > ground[k]! ? w : ground[k]!);
        }
        // Retenue = eau au niveau mesuré contre la face amont (surface des cases à ce niveau).
        out.level = NaN; out.area = 0; out.stored = 0; out.status = 'none'; out.outlet = '';
        if (Number.isFinite(level)) {
          const A = t.spacing * t.spacing;
          let area = 0, stored = 0;
          for (let k = 0; k < water.length; k++) {
            const w = water[k]!;
            if (w !== NO_WATER && Math.abs(w - level) < 0.02 && w > ground[k]! + 0.05) { area += A; stored += (w - Math.max(ground[k]!, base[k]! === NO_WATER ? -Infinity : base[k]!)) * A; }
          }
          out.area = Math.round(area); out.stored = Math.round(stored); out.status = 'sink';
        }
        out.headM = Number.isFinite(level) && Number.isFinite(tail) ? Math.max(0, Math.round((level - tail) * 10) / 10) : 0;
        out.flowM3s = Math.round(flow * 10) / 10;
        if (Number.isFinite(level)) out.level = level;
      }
      return out;
    } finally {
      this.dams = dams;
      this.sources = sources;
      this.touchMask = savedTouch;
    }
  }

  /** Mesures publiques (diagnostic, tests, interface). */
  damMetrics(): DamMetrics[] { return [...this.metrics.values()]; }
}
