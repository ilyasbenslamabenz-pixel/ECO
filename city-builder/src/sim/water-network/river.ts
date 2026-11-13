/**
 * Hydrographie sur la grille municipale : cellules en eau, sens d'écoulement (vers l'aval), accumulation
 * (nombre de cellules en eau drainées, approximation du débit) et routage des charges polluantes.
 *
 * Sens d'écoulement par « priority-flood » : chaque composante d'eau connexe est inondée depuis ses exutoires
 * (cellules en eau au bord de la carte ; à défaut, sa cellule la plus basse) en dépilant toujours la cellule de
 * plus faible cote ; chaque cellule atteinte s'écoule vers celle qui l'a atteinte. Résultat : un arbre orienté
 * vers les exutoires, robuste aux creux locaux du lit, sans cycle. Le routage parcourt les cellules de l'amont
 * vers l'aval : charge(aval) += charge(cellule) · (1 − autoépuration), concentration = charge / (accumulation · q0).
 *
 * Données dérivées du terrain (recalculées à chaque partie) : rien à sauvegarder.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import type { GridGeometry } from '../../shared/municipal/types';

export interface RiverTerrain {
  heightAt(x: number, z: number): number;
  isWet(x: number, z: number): boolean;
}

/** Paramètres du routage (valeurs par défaut calibrées dans tests/eau). */
export interface RoutingParams {
  /** Autoépuration par cellule traversée (fraction de charge perdue). */
  decayPerCell: number;
  /** Débit de dilution par cellule drainée (unités de charge / h pour une concentration 1). */
  q0: number;
}

export const DEFAULT_ROUTING: Readonly<RoutingParams> = { decayPerCell: 0.004, q0: 0.6 };

const N8: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/** Tas binaire minimal (clé flottante, valeur entière) ; égalités départagées par l'index (déterminisme). */
class MinHeap {
  private k: number[] = [];
  private v: number[] = [];
  get size(): number { return this.k.length; }
  private less(i: number, j: number): boolean { return this.k[i]! < this.k[j]! || (this.k[i] === this.k[j] && this.v[i]! < this.v[j]!); }
  private swap(i: number, j: number): void {
    const tk = this.k[i]!; this.k[i] = this.k[j]!; this.k[j] = tk;
    const tv = this.v[i]!; this.v[i] = this.v[j]!; this.v[j] = tv;
  }
  push(key: number, val: number): void {
    this.k.push(key); this.v.push(val);
    let i = this.k.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (!this.less(i, p)) break; this.swap(i, p); i = p; }
  }
  pop(): [number, number] {
    const top: [number, number] = [this.k[0]!, this.v[0]!];
    const lk = this.k.pop()!, lv = this.v.pop()!;
    if (this.k.length) {
      this.k[0] = lk; this.v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.k.length && this.less(l, m)) m = l;
        if (r < this.k.length && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m); i = m;
      }
    }
    return top;
  }
}

export class RiverRouter {
  readonly cols: number;
  readonly rows: number;
  readonly originX: number;
  readonly originZ: number;
  readonly cellSize: number;
  /** 1 si la cellule est en eau. */
  readonly wet: Uint8Array;
  /** Cote du lit (m, minimum des échantillons en eau). */
  readonly elev: Float32Array;
  /** Cellule aval (-1 = exutoire ou cellule sèche). */
  readonly down: Int32Array;
  /** Cellules en eau dans l'ordre amont -> aval. */
  readonly order: Int32Array;
  /** Nombre de cellules en eau drainées (cellule comprise). */
  readonly accum: Float32Array;
  /** Charge routée (tampon réutilisé). */
  private readonly load: Float32Array;

  private constructor(g: GridGeometry) {
    this.cols = g.cols; this.rows = g.rows; this.originX = g.originX; this.originZ = g.originZ; this.cellSize = g.cellSize;
    const n = g.cols * g.rows;
    this.wet = new Uint8Array(n);
    this.elev = new Float32Array(n);
    this.down = new Int32Array(n).fill(-1);
    this.accum = new Float32Array(n);
    this.load = new Float32Array(n);
    this.order = new Int32Array(0);
  }

  /** Nombre de cellules en eau. */
  get wetCount(): number { return this.order.length; }

  /** Cellules en eau (ordre amont -> aval). */
  cells(): Int32Array { return this.order; }

  centerX(k: number): number { return this.originX + ((k % this.cols) + 0.5) * this.cellSize; }
  centerZ(k: number): number { return this.originZ + (Math.floor(k / this.cols) + 0.5) * this.cellSize; }
  cellAt(x: number, z: number): number {
    const i = Math.floor((x - this.originX) / this.cellSize), j = Math.floor((z - this.originZ) / this.cellSize);
    return i >= 0 && j >= 0 && i < this.cols && j < this.rows ? j * this.cols + i : -1;
  }

  /** Analyse le terrain : une cellule est en eau si au moins 3 de ses 9 échantillons le sont. */
  static build(g: GridGeometry, terrain: RiverTerrain): RiverRouter {
    const r = new RiverRouter(g);
    const { cols, rows, cellSize: cs } = g;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        let wetN = 0, minH = Infinity;
        for (let b = 0; b < 3; b++) {
          for (let a = 0; a < 3; a++) {
            const x = g.originX + (i + (a + 0.5) / 3) * cs, z = g.originZ + (j + (b + 0.5) / 3) * cs;
            if (terrain.isWet(x, z)) {
              wetN++;
              const h = terrain.heightAt(x, z);
              if (Number.isFinite(h) && h < minH) minH = h;
            }
          }
        }
        const k = j * cols + i;
        if (wetN >= 3) { r.wet[k] = 1; r.elev[k] = Number.isFinite(minH) ? minH : 0; }
      }
    }
    r.flood();
    return r;
  }

  /** Construit une hydrographie à partir d'un masque et de cotes (tests). */
  static fromMask(g: GridGeometry, wet: ArrayLike<number>, elev: ArrayLike<number>): RiverRouter {
    const r = new RiverRouter(g);
    for (let k = 0; k < r.wet.length; k++) { r.wet[k] = wet[k] ? 1 : 0; r.elev[k] = elev[k] ?? 0; }
    r.flood();
    return r;
  }

  private flood(): void {
    const { cols, rows, wet, elev, down } = this;
    const n = cols * rows;
    // Composantes connexes (8 voisins) pour garantir un exutoire par composante.
    const comp = new Int32Array(n).fill(-1);
    const compSeeds: number[][] = [];
    const compMin: number[] = [];
    const stack: number[] = [];
    for (let k = 0; k < n; k++) {
      if (!wet[k] || comp[k]! >= 0) continue;
      const c = compSeeds.length;
      compSeeds.push([]); compMin.push(k);
      comp[k] = c; stack.push(k);
      while (stack.length) {
        const q = stack.pop()!;
        const i = q % cols, j = (q - i) / cols;
        if (i === 0 || j === 0 || i === cols - 1 || j === rows - 1) compSeeds[c]!.push(q);
        if (elev[q]! < elev[compMin[c]!]! || (elev[q] === elev[compMin[c]!] && q < compMin[c]!)) compMin[c] = q;
        for (const [di, dj] of N8) {
          const a = i + di, b = j + dj;
          if (a < 0 || b < 0 || a >= cols || b >= rows) continue;
          const m = b * cols + a;
          if (wet[m] && comp[m]! < 0) { comp[m] = c; stack.push(m); }
        }
      }
    }
    const heap = new MinHeap();
    const key = new Float32Array(n);
    const seen = new Uint8Array(n);
    for (let c = 0; c < compSeeds.length; c++) {
      const seeds = compSeeds[c]!.length ? compSeeds[c]! : [compMin[c]!];
      for (const s of seeds) { seen[s] = 1; key[s] = elev[s]!; heap.push(elev[s]!, s); }
    }
    const popped: number[] = [];
    while (heap.size) {
      const [kk, q] = heap.pop();
      popped.push(q);
      const i = q % cols, j = (q - i) / cols;
      for (const [di, dj] of N8) {
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= cols || b >= rows) continue;
        const m = b * cols + a;
        if (!wet[m] || seen[m]) continue;
        seen[m] = 1;
        down[m] = q;
        key[m] = Math.max(elev[m]!, kk);
        heap.push(key[m]!, m);
      }
    }
    // Exutoires de bord situés en AMONT (rivière entrant dans la carte) : on les raccorde à leur voisin en eau le
    // plus bas dont le chemin ne repasse pas par eux (aucun cycle possible).
    for (let c = 0; c < compSeeds.length; c++) {
      for (const sd of compSeeds[c]!) {
        if (down[sd]! >= 0) continue;
        const i = sd % cols, j = (sd - i) / cols;
        let best = -1;
        for (const [di, dj] of N8) {
          const a = i + di, b = j + dj;
          if (a < 0 || b < 0 || a >= cols || b >= rows) continue;
          const m = b * cols + a;
          if (!wet[m] || elev[m]! >= elev[sd]!) continue;
          let q = m, loops = false;
          for (let guard = 0; q >= 0 && guard < n; guard++) { if (q === sd) { loops = true; break; } q = down[q]!; }
          if (loops) continue;
          if (best < 0 || elev[m]! < elev[best]! || (elev[m] === elev[best] && m < best)) best = m;
        }
        if (best >= 0) down[sd] = best;
      }
    }
    // Ordre amont -> aval (tri topologique de Kahn sur les liens aval, égalités par index).
    const indeg = new Int32Array(n);
    for (const q of popped) { const d = down[q]!; if (d >= 0) indeg[d]!++; }
    const queue: number[] = [];
    for (let k = 0; k < n; k++) if (wet[k] && indeg[k] === 0) queue.push(k);
    const order = new Int32Array(popped.length);
    let t = 0;
    for (let h = 0; h < queue.length; h++) {
      const q = queue[h]!;
      order[t++] = q;
      const d = down[q]!;
      if (d >= 0 && --indeg[d]! === 0) queue.push(d);
    }
    (this as { order: Int32Array }).order = order;
    this.accum.fill(0);
    for (const k of order) {
      this.accum[k]! += 1;
      const d = down[k]!;
      if (d >= 0) this.accum[d]! += this.accum[k]!;
    }
  }

  /** Cellule en eau la plus proche de (x, z) à moins de `maxDist` m (-1 sinon). */
  nearestWet(x: number, z: number, maxDist: number): number {
    const cs = this.cellSize;
    const ci = Math.floor((x - this.originX) / cs), cj = Math.floor((z - this.originZ) / cs);
    const R = Math.ceil(maxDist / cs) + 1;
    let best = -1, bestD = Infinity;
    for (let j = Math.max(0, cj - R); j <= Math.min(this.rows - 1, cj + R); j++) {
      for (let i = Math.max(0, ci - R); i <= Math.min(this.cols - 1, ci + R); i++) {
        const k = j * this.cols + i;
        if (!this.wet[k]) continue;
        // Distance au bord de la cellule (0 si le point est dedans).
        const x0 = this.originX + i * cs, z0 = this.originZ + j * cs;
        const dx = Math.max(x0 - x, 0, x - (x0 + cs)), dz = Math.max(z0 - z, 0, z - (z0 + cs));
        const d = Math.hypot(dx, dz);
        if (d <= maxDist && (d < bestD || (d === bestD && k < best))) { bestD = d; best = k; }
      }
    }
    return best;
  }

  /** Distance (m) de (x, z) à l'eau la plus proche, Infinity au-delà de `maxDist`. */
  distanceToWater(x: number, z: number, maxDist: number): number {
    const k = this.nearestWet(x, z, maxDist);
    if (k < 0) return Infinity;
    const cs = this.cellSize, i = k % this.cols, j = Math.floor(k / this.cols);
    const x0 = this.originX + i * cs, z0 = this.originZ + j * cs;
    return Math.hypot(Math.max(x0 - x, 0, x - (x0 + cs)), Math.max(z0 - z, 0, z - (z0 + cs)));
  }

  /** Chemin aval depuis une cellule (au plus `max` cellules). */
  pathFrom(k: number, max = 100_000): number[] {
    const out: number[] = [];
    let c = k;
    while (c >= 0 && out.length < max) { out.push(c); c = this.down[c]!; }
    return out;
  }

  /**
   * Route les émissions (`emissions[k]` = charge rejetée dans la cellule k, unités / h) vers l'aval et écrit dans
   * `out[k]` l'indice de pollution 0..100 de chaque cellule en eau (les autres cellules sont laissées à 0).
   */
  route(emissions: Float32Array, out: Float32Array, p: RoutingParams = DEFAULT_ROUTING): void {
    const load = this.load;
    load.set(emissions);
    out.fill(0);
    const keep = 1 - p.decayPerCell;
    for (const k of this.order) {
      const L = load[k]!;
      if (L <= 0) continue;
      const conc = L / (this.accum[k]! * p.q0);
      out[k] = 100 * (1 - Math.exp(-conc));
      const d = this.down[k]!;
      if (d >= 0) load[d]! += L * keep;
    }
  }
}
