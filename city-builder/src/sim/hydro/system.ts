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
import { DAM_FLOW_MAX, damGeometry, type DamGeometry, type EditPlan, type TerrainEdit } from '../terrain/edits';
import { NO_WATER, type SampleRect, type WorldTerrain } from '../terrain/types';
import { HydroSolver, type FeedResult, type HydroFeed, type HydroGrid } from './fill';

/** Pas de temps du remplissage (minutes de jeu) : 2 min = 10 ticks (une image d'eau par seconde à ×1). */
export const FILL_QUANTUM_MIN = 2;
/** Distance maximale entre une centrale hydroélectrique et l'axe d'un barrage (m, en plus de sa demi-taille). */
export const DAM_PLANT_REACH = 60;
/** Rayon de recherche d'une source à retirer (m). */
export const SOURCE_PICK_RADIUS = 30;
/** Nombre maximal de sources et de barrages actifs. */
export const MAX_SOURCES = 48;
export const MAX_DAMS = 24;

export interface HydroSource { id: number; x: number; z: number; q: number; t: number; cell: number }

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
  /** Débit entrant : rivière barrée + sources qui alimentent la retenue (m³/s). */
  flowM3s: number;
  crest: number;
  lengthM: number;
  /** Retenue pleine (l'eau atteint la crête ou s'écoule par un col). */
  full: boolean;
  x: number; z: number;
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

const segDist = (px: number, pz: number, ax: number, az: number, bx: number, bz: number): number => {
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
  const u = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L2));
  return Math.hypot(px - ax - dx * u, pz - az - dz * u);
};

export class HydroSystem {
  /** Eau de base séparée (null tant que le module est inactif : `terrain.waterSurface` en tient lieu). */
  base: Float32Array | null = null;
  sources: HydroSource[] = [];
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
    this.metrics.clear();
    this.ver++;
  }

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
      this.sources.push({ id: index, x: e.x, z: e.z, q: e.q, t: e.t ?? 0, cell: j * t.samplesX + i });
    } else if (e.k === 'unsource') {
      const s = this.sourceNear(e.x, e.z);
      if (s) this.sources = this.sources.filter((o) => o !== s);
    } else if (e.k === 'dam' && e.h !== undefined) {
      const up = e.up ?? 1;
      const geom = damGeometry(t, e.ax, e.az, e.bx, e.bz, up);
      this.dams.push({ id: index, ax: e.ax, az: e.az, bx: e.bx, bz: e.bz, crest: e.h, up, q: Math.min(DAM_FLOW_MAX, e.q ?? 0), t: e.t ?? 0, geom, seed: -1 });
      this.touchMask = null;
    } else if (!this.active) return;
    this.dirty = true;
  }

  /** Reconstruit sources et barrages depuis la liste des éditions (après une annulation). */
  rebuild(edits: readonly TerrainEdit[], t: WorldTerrain): void {
    this.sources = [];
    this.dams = [];
    this.touchMask = null;
    edits.forEach((e, i) => { if (e.k === 'source' || e.k === 'unsource' || e.k === 'dam') this.onEdit(e, i, t); });
    this.dirty = true;
  }

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
    return { samplesX: t.samplesX, samplesZ: t.samplesZ, spacing: t.spacing, ground, base, barrier: this.barrier, dug: this.dug.length ? this.dug : null, dugMask: this.dugMask, touchMask: this.touchMask };
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

  /** Alimentations ordonnées (ordre des éditions) avec leur volume à la minute `tq`. */
  private feeds(tq: number, ground: Float32Array, base: Float32Array, infinite: boolean): { feeds: HydroFeed[]; q: number[] } {
    const items: { id: number; feed: HydroFeed; q: number }[] = [];
    this.sources.forEach((s, i) => items.push({ id: s.id, q: s.q, feed: { cell: s.cell, volume: infinite ? Infinity : s.q * Math.max(0, tq - s.t) * 60, tag: i } }));
    this.dams.forEach((d, i) => {
      d.seed = d.q > 0 ? this.damSeed(d, ground, base) : -1;
      if (d.seed >= 0) items.push({ id: d.id, q: d.q, feed: { cell: d.seed, volume: infinite ? Infinity : d.q * Math.max(0, tq - d.t) * 60, tag: -(i + 1) } });
    });
    items.sort((a, b) => a.id - b.id);
    return { feeds: items.map((o) => o.feed), q: items.map((o) => o.q) };
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
    const { feeds, q } = this.feeds(quantum * FILL_QUANTUM_MIN, ground, base, false);
    const res = this.solver.solve(g, feeds);
    this.steady = res.every((r) => r.status !== 'partial');
    const rect = this.writeCombined(t, this.solver.water);
    this.measureDams(t, ground, feeds, res, q);
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

  private measureDams(t: WorldTerrain, ground: Float32Array, feeds: HydroFeed[], res: FeedResult[], q: number[]): void {
    const ws = t.waterSurface;
    const next = new Map<number, DamMetrics>();
    let changed = this.metrics.size !== this.dams.length;
    this.dams.forEach((d, i) => {
      let flow = 0, full = false;
      feeds.forEach((f, fi) => {
        const r = res[fi]!;
        const own = f.tag === -(i + 1);
        if (own || r.touched.includes(i + 1)) {
          flow += q[fi]!;
          if (r.status !== 'partial') full = true;
        }
      });
      let level = -Infinity, tail = Infinity;
      for (const k of d.geom.upFace) if (ws[k]! !== NO_WATER && ws[k]! > ground[k]! + 0.05) level = Math.max(level, ws[k]!);
      for (const k of d.geom.downFace) tail = Math.min(tail, ws[k]! !== NO_WATER && ws[k]! > ground[k]! ? ws[k]! : ground[k]!);
      if (!Number.isFinite(tail)) tail = d.crest;
      const lv = Number.isFinite(level) ? level : NaN;
      const headM = Number.isFinite(level) ? Math.max(0, Math.round((level - tail) * 10) / 10) : 0;
      const m: DamMetrics = { id: d.id, level: lv, tail, headM, flowM3s: Math.round(flow * 10) / 10, crest: d.crest, lengthM: Math.round(d.geom.length), full: full && headM > 0, x: (d.ax + d.bx) / 2, z: (d.az + d.bz) / 2 };
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
  preview(host: HydroHost, add: { source?: { x: number; z: number; q: number }; dam?: { plan: EditPlan } }): HydroPreview {
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
      this.sources = [...sources, { id: Number.MAX_SAFE_INTEGER, x: add.source.x, z: add.source.z, q: add.source.q, t: 0, cell: j * W + i }];
    }
    this.touchMask = null;
    try {
      const g = this.grid(host, ground, base);
      const { feeds, q } = this.feeds(0, ground, base, true);
      const res = this.previewSolver.solve(g, feeds);
      const last = res[res.length - 1];
      const out: HydroPreview = last ? { level: last.level, area: Math.round(last.area), stored: Math.round(last.stored), outlet: last.outlet, status: last.status } : { level: NaN, area: 0, stored: 0, outlet: '', status: 'none' };
      if (newDam) {
        const di = this.dams.length;
        let flow = 0;
        feeds.forEach((f, fi) => { if (f.tag === -di || res[fi]!.touched.includes(di)) flow += q[fi]!; });
        const water = this.previewSolver.water;
        let level = -Infinity, tail = Infinity;
        for (const k of newDam.geom.upFace) {
          const w = water[k]! !== NO_WATER && water[k]! > base[k]! ? water[k]! : base[k]!;
          if (w !== NO_WATER && w > ground[k]! + 0.05) level = Math.max(level, w);
        }
        for (const k of newDam.geom.downFace) {
          const w = water[k]! !== NO_WATER && water[k]! > base[k]! ? water[k]! : base[k]!;
          tail = Math.min(tail, w !== NO_WATER && w > ground[k]! ? w : ground[k]!);
        }
        const own = feeds.findIndex((f) => f.tag === -di);
        if (own >= 0) { out.level = res[own]!.level; out.area = Math.round(res[own]!.area); out.stored = Math.round(res[own]!.stored); out.outlet = res[own]!.outlet; out.status = res[own]!.status; }
        else if (!Number.isFinite(level)) { out.level = NaN; out.area = 0; out.stored = 0; out.status = 'none'; }
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
