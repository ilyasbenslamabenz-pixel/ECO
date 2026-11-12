/**
 * Index spatial en grille (hachage de cases) pour les nœuds et tronçons : requêtes de voisinage
 * en O(k) au lieu de O(n) (snapping, croisements, collisions). TypeScript pur.
 */
export class SpatialHash {
  private readonly cells = new Map<number, number[]>();
  private readonly itemCells = new Map<number, number[]>();
  constructor(readonly cellSize = 64) {}

  private key(ix: number, iz: number): number {
    return (ix + 32768) * 65536 + (iz + 32768);
  }

  insert(id: number, minX: number, minZ: number, maxX: number, maxZ: number): void {
    this.remove(id);
    const cs = this.cellSize;
    const i0 = Math.floor(minX / cs), i1 = Math.floor(maxX / cs);
    const j0 = Math.floor(minZ / cs), j1 = Math.floor(maxZ / cs);
    const keys: number[] = [];
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const k = this.key(i, j);
        let c = this.cells.get(k);
        if (!c) { c = []; this.cells.set(k, c); }
        c.push(id);
        keys.push(k);
      }
    }
    this.itemCells.set(id, keys);
  }

  remove(id: number): void {
    const keys = this.itemCells.get(id);
    if (!keys) return;
    for (const k of keys) {
      const c = this.cells.get(k);
      if (!c) continue;
      const i = c.indexOf(id);
      if (i >= 0) { c[i] = c[c.length - 1]!; c.pop(); }
      if (c.length === 0) this.cells.delete(k);
    }
    this.itemCells.delete(id);
  }

  /** Ids dont la boîte touche la zone (sans doublon), écrits dans `out` (vidé). */
  query(minX: number, minZ: number, maxX: number, maxZ: number, out: number[] = []): number[] {
    out.length = 0;
    const cs = this.cellSize;
    const i0 = Math.floor(minX / cs), i1 = Math.floor(maxX / cs);
    const j0 = Math.floor(minZ / cs), j1 = Math.floor(maxZ / cs);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const c = this.cells.get(this.key(i, j));
        if (!c) continue;
        for (const id of c) if (!out.includes(id)) out.push(id);
      }
    }
    return out;
  }

  clear(): void {
    this.cells.clear();
    this.itemCells.clear();
  }

  get size(): number { return this.itemCells.size; }
}
