/**
 * Grille d'indicateur par cellule (Float32Array, résolution configurable) avec diffusion / propagation.
 *
 * Repère : cellule (i, j) couvre [originX + i·cellSize, originX + (i+1)·cellSize[ × idem en z ; index = j·cols + i.
 * Les écritures sont bornées à [spec.min, spec.max]. Aucune allocation dans `diffuse` (tampon réutilisé).
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import type { DiffusionSpec, GridGeometry, GridStats, IndicatorSpec } from '../../shared/municipal/types';

export type Falloff = 'flat' | 'linear' | 'smooth';

/** Vérifie une géométrie (lève si invalide). */
export function checkGeometry(g: GridGeometry): void {
  if (!(g.cellSize > 0) || !Number.isFinite(g.cellSize)) throw new Error('grille : cellSize > 0 attendu');
  if (!Number.isInteger(g.cols) || !Number.isInteger(g.rows) || g.cols < 1 || g.rows < 1) throw new Error('grille : cols et rows entiers ≥ 1 attendus');
  if (g.cols * g.rows > 4_194_304) throw new Error('grille : plus de 4 194 304 cellules');
  if (!Number.isFinite(g.originX) || !Number.isFinite(g.originZ)) throw new Error('grille : origine invalide');
}

/** Géométrie couvrant un rectangle monde avec des cellules de `cellSize` m (arrondi au supérieur). */
export function geometryFor(bounds: { minX: number; minZ: number; maxX: number; maxZ: number }, cellSize: number): GridGeometry {
  const g: GridGeometry = {
    originX: bounds.minX, originZ: bounds.minZ, cellSize,
    cols: Math.max(1, Math.ceil((bounds.maxX - bounds.minX) / cellSize)),
    rows: Math.max(1, Math.ceil((bounds.maxZ - bounds.minZ) / cellSize)),
  };
  checkGeometry(g);
  return g;
}

/** Vérifie une diffusion (stabilité du schéma explicite : 4·rate + |advectX| + |advectZ| ≤ 1). */
export function checkDiffusion(d: DiffusionSpec): void {
  if (!(d.rate >= 0 && d.rate <= 0.25)) throw new Error('diffusion : rate dans [0, 0,25] attendu');
  if (!(d.decay >= 0 && d.decay <= 1)) throw new Error('diffusion : decay dans [0, 1] attendu');
  if (!Number.isInteger(d.steps) || d.steps < 1 || d.steps > 64) throw new Error('diffusion : steps entier 1..64 attendu');
  const ax = Math.abs(d.advectX ?? 0), az = Math.abs(d.advectZ ?? 0);
  if (ax > 0.25 || az > 0.25) throw new Error('diffusion : advection dans [-0,25, 0,25] attendue');
  if (4 * d.rate + ax + az > 1 + 1e-9) throw new Error('diffusion : schéma instable (4·rate + |advect| > 1)');
}

export class IndicatorGrid {
  readonly spec: Readonly<IndicatorSpec>;
  readonly geometry: Readonly<GridGeometry>;
  readonly cols: number;
  readonly rows: number;
  readonly cellSize: number;
  readonly originX: number;
  readonly originZ: number;
  /** Valeurs (lecture directe autorisée ; écrire via set/add pour respecter les bornes). */
  readonly data: Float32Array;
  private scratch: Float32Array | null = null;
  /** Incrémenté à chaque modification (invalidation des caches / deltas). */
  version = 0;

  constructor(spec: IndicatorSpec, geometry: GridGeometry, data?: Float32Array) {
    checkGeometry(geometry);
    if (!(spec.min <= spec.base && spec.base <= spec.max)) throw new Error(`indicateur ${spec.id} : min ≤ base ≤ max attendu`);
    if (spec.diffusion) checkDiffusion(spec.diffusion);
    this.spec = { ...spec, diffusion: spec.diffusion ? { ...spec.diffusion } : undefined };
    this.geometry = { ...geometry };
    this.cols = geometry.cols; this.rows = geometry.rows; this.cellSize = geometry.cellSize;
    this.originX = geometry.originX; this.originZ = geometry.originZ;
    const n = this.cols * this.rows;
    if (data) {
      if (data.length !== n) throw new Error(`indicateur ${spec.id} : ${data.length} valeurs pour ${n} cellules`);
      this.data = data;
    } else {
      this.data = new Float32Array(n).fill(spec.base);
    }
  }

  get size(): number { return this.data.length; }

  /* ------------------------------ Adressage ------------------------------ */

  inBounds(i: number, j: number): boolean { return i >= 0 && j >= 0 && i < this.cols && j < this.rows; }
  index(i: number, j: number): number { return j * this.cols + i; }
  /** Colonne de la coordonnée monde x (peut être hors grille). */
  colOf(x: number): number { return Math.floor((x - this.originX) / this.cellSize); }
  rowOf(z: number): number { return Math.floor((z - this.originZ) / this.cellSize); }
  /** Index de la cellule contenant (x, z), -1 hors grille. */
  cellAt(x: number, z: number): number {
    const i = this.colOf(x), j = this.rowOf(z);
    return this.inBounds(i, j) ? j * this.cols + i : -1;
  }
  centerX(i: number): number { return this.originX + (i + 0.5) * this.cellSize; }
  centerZ(j: number): number { return this.originZ + (j + 0.5) * this.cellSize; }

  /* ---------------------------- Lecture typée ---------------------------- */

  /** Valeur de la cellule (i, j) ; valeur de fond hors grille. */
  get(i: number, j: number): number { return this.inBounds(i, j) ? this.data[j * this.cols + i]! : this.spec.base; }
  /** Valeur de la cellule contenant (x, z). */
  at(x: number, z: number): number { return this.get(this.colOf(x), this.rowOf(z)); }

  /** Échantillonnage bilinéaire entre centres de cellules (bords prolongés). */
  sample(x: number, z: number): number {
    const fx = (x - this.originX) / this.cellSize - 0.5, fz = (z - this.originZ) / this.cellSize - 0.5;
    const cx = Math.min(this.cols - 1, Math.max(0, fx)), cz = Math.min(this.rows - 1, Math.max(0, fz));
    const i0 = Math.floor(cx), j0 = Math.floor(cz);
    const i1 = Math.min(this.cols - 1, i0 + 1), j1 = Math.min(this.rows - 1, j0 + 1);
    const tx = cx - i0, tz = cz - j0;
    const d = this.data, c = this.cols;
    const a = d[j0 * c + i0]! * (1 - tx) + d[j0 * c + i1]! * tx;
    const b = d[j1 * c + i0]! * (1 - tx) + d[j1 * c + i1]! * tx;
    return a * (1 - tz) + b * tz;
  }

  /** Moyenne des cellules dont le centre est à moins de `radius` m de (x, z) ; valeur de fond si aucune. */
  meanIn(x: number, z: number, radius: number): number {
    let s = 0, n = 0;
    this.forEachIn(x, z, radius, (k) => { s += this.data[k]!; n++; });
    return n ? s / n : this.spec.base;
  }

  /** Appelle `fn(index, distance)` pour chaque cellule dont le centre est à moins de `radius` de (x, z). */
  forEachIn(x: number, z: number, radius: number, fn: (k: number, dist: number) => void): void {
    const r = Math.max(0, radius);
    const i0 = Math.max(0, this.colOf(x - r)), i1 = Math.min(this.cols - 1, this.colOf(x + r));
    const j0 = Math.max(0, this.rowOf(z - r)), j1 = Math.min(this.rows - 1, this.rowOf(z + r));
    for (let j = j0; j <= j1; j++) {
      const dz = this.centerZ(j) - z;
      for (let i = i0; i <= i1; i++) {
        const dx = this.centerX(i) - x;
        const d = Math.hypot(dx, dz);
        if (d <= r) fn(j * this.cols + i, d);
      }
    }
  }

  stats(): GridStats {
    const d = this.data;
    let min = Infinity, max = -Infinity, sum = 0;
    for (let k = 0; k < d.length; k++) { const v = d[k]!; if (v < min) min = v; if (v > max) max = v; sum += v; }
    return { min, max, mean: sum / d.length, sum };
  }

  /* ---------------------------- Écriture typée ---------------------------- */

  private clamp(v: number): number {
    if (!Number.isFinite(v)) return this.spec.base;
    return v < this.spec.min ? this.spec.min : v > this.spec.max ? this.spec.max : v;
  }

  /** Écrit la cellule (i, j) (bornée) ; renvoie la variation réellement appliquée (0 hors grille). */
  set(i: number, j: number, v: number): number {
    if (!this.inBounds(i, j)) return 0;
    const k = j * this.cols + i, old = this.data[k]!;
    this.data[k] = this.clamp(v);
    this.version++;
    return this.data[k]! - old;
  }

  add(i: number, j: number, dv: number): number { return this.set(i, j, this.get(i, j) + dv); }
  /** Ajoute à la cellule contenant (x, z). */
  addAt(x: number, z: number, dv: number): number { return this.add(this.colOf(x), this.rowOf(z), dv); }
  setAt(x: number, z: number, v: number): number { return this.set(this.colOf(x), this.rowOf(z), v); }

  /**
   * Émission locale : ajoute `amount` (valeur au centre) aux cellules à moins de `radius` m, pondéré par la
   * décroissance (`flat` = constant, `linear` = 1 - d/r, `smooth` = (1 - (d/r)²)²). Un rayon plus petit qu'une
   * demi-cellule touche au moins la cellule contenant le point. Renvoie la somme des variations appliquées.
   */
  stamp(x: number, z: number, radius: number, amount: number, falloff: Falloff = 'linear'): number {
    let total = 0;
    let touched = false;
    const r = Math.max(radius, 1e-9);
    this.forEachIn(x, z, radius, (k, d) => {
      touched = true;
      const t = d / r;
      const w = falloff === 'flat' ? 1 : falloff === 'linear' ? Math.max(0, 1 - t) : Math.pow(Math.max(0, 1 - t * t), 2);
      const old = this.data[k]!;
      this.data[k] = this.clamp(old + amount * w);
      total += this.data[k]! - old;
    });
    if (!touched) total += this.addAt(x, z, amount);
    this.version++;
    return total;
  }

  fill(v: number): void { this.data.fill(this.clamp(v)); this.version++; }
  reset(): void { this.data.fill(this.spec.base); this.version++; }
  /** Remplace les valeurs (même taille) — copie. */
  assign(values: ArrayLike<number>): void {
    if (values.length !== this.data.length) throw new Error('grille : taille différente');
    for (let k = 0; k < values.length; k++) this.data[k] = this.clamp(values[k]!);
    this.version++;
  }

  copyValues(): Float32Array { return this.data.slice(); }

  /* ------------------------------ Diffusion ------------------------------ */

  /**
   * Un pas de propagation : diffusion explicite à 4 voisins (`rate`), transport amont (`advectX/Z`), puis
   * atténuation vers la valeur de fond (`decay`). Bords `closed` : flux nul ; `open` : l'extérieur vaut `base`
   * (le surplus s'échappe). Sans atténuation et bords fermés, la somme est conservée (aux bornes près).
   */
  diffuseStep(d: DiffusionSpec = this.spec.diffusion!): void {
    if (!d) return;
    const cols = this.cols, rows = this.rows, a = this.data;
    const out = this.scratch && this.scratch.length === a.length ? this.scratch : (this.scratch = new Float32Array(a.length));
    const base = this.spec.base, open = d.boundary === 'open', rate = d.rate;
    const ax = d.advectX ?? 0, az = d.advectZ ?? 0;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const k = j * cols + i, v = a[k]!;
        const w = i > 0 ? a[k - 1]! : open ? base : v;
        const e = i < cols - 1 ? a[k + 1]! : open ? base : v;
        const n = j > 0 ? a[k - cols]! : open ? base : v;
        const s = j < rows - 1 ? a[k + cols]! : open ? base : v;
        let nv = v + rate * (w + e + n + s - 4 * v);
        // Transport amont (upwind) : part |a|·v quitte la cellule vers l'aval, part |a|·amont y entre.
        if (ax !== 0) {
          const up = ax > 0 ? (i > 0 ? a[k - 1]! : open ? base : 0) : (i < cols - 1 ? a[k + 1]! : open ? base : 0);
          const leaves = ax > 0 ? (i < cols - 1 || open) : (i > 0 || open);
          nv += Math.abs(ax) * (up - (leaves ? v : 0));
        }
        if (az !== 0) {
          const up = az > 0 ? (j > 0 ? a[k - cols]! : open ? base : 0) : (j < rows - 1 ? a[k + cols]! : open ? base : 0);
          const leaves = az > 0 ? (j < rows - 1 || open) : (j > 0 || open);
          nv += Math.abs(az) * (up - (leaves ? v : 0));
        }
        out[k] = nv;
      }
    }
    const keep = 1 - d.decay, min = this.spec.min, max = this.spec.max;
    for (let k = 0; k < a.length; k++) {
      let v = base + (out[k]! - base) * keep;
      if (v < min) v = min; else if (v > max) v = max;
      a[k] = v;
    }
    this.version++;
  }

  /** Applique `steps` pas de la diffusion de la spécification (ou de `d`). */
  diffuse(d: DiffusionSpec | undefined = this.spec.diffusion): void {
    if (!d) return;
    for (let s = 0; s < d.steps; s++) this.diffuseStep(d);
  }

  /** Nouvelle grille de même indicateur rééchantillonnée (bilinéaire) sur une autre géométrie. */
  resample(geometry: GridGeometry): IndicatorGrid {
    const g = new IndicatorGrid(this.spec, geometry);
    for (let j = 0; j < g.rows; j++) for (let i = 0; i < g.cols; i++) g.data[j * g.cols + i] = this.sample(g.centerX(i), g.centerZ(j));
    return g;
  }
}
