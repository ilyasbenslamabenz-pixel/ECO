/**
 * Stockage façon ECS en structure-de-tableaux (SoA) avec typed arrays.
 * - indices denses (0..count-1), suppression par permutation avec le dernier (swap-remove) ;
 * - table id -> index pour les références stables ;
 * - croissance par doublement (aucune allocation dans les boucles de tick).
 * TypeScript pur : AUCUN import de three ni du DOM.
 */

function growF32(a: Float32Array, n: number): Float32Array { const b = new Float32Array(n); b.set(a); return b; }
function growI32(a: Int32Array, n: number): Int32Array { const b = new Int32Array(n); b.set(a); return b; }
function growU16(a: Uint16Array, n: number): Uint16Array { const b = new Uint16Array(n); b.set(a); return b; }
function growU8(a: Uint8Array, n: number): Uint8Array { const b = new Uint8Array(n); b.set(a); return b; }

/** Bâtiments : une ligne par bâtiment posé. */
export class BuildingStore {
  count = 0;
  capacity: number;
  id: Int32Array;
  assetIndex: Uint16Array;
  variant: Int32Array;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  rot: Uint8Array;
  /** Empreinte en cases, après rotation. */
  tilesX: Uint16Array;
  tilesZ: Uint16Array;
  /** Habitants / emplois effectivement occupés (démographie, phase 2). */
  residents: Int32Array;
  workers: Int32Array;
  /** 1 si une route passe devant la façade (accès véhicules/piétons), recalculé par le monde. */
  roadAccess: Uint8Array;
  private idToIndex = new Map<number, number>();

  constructor(capacity: number) {
    this.capacity = capacity;
    this.id = new Int32Array(capacity);
    this.assetIndex = new Uint16Array(capacity);
    this.variant = new Int32Array(capacity);
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.z = new Float32Array(capacity);
    this.rot = new Uint8Array(capacity);
    this.tilesX = new Uint16Array(capacity);
    this.tilesZ = new Uint16Array(capacity);
    this.residents = new Int32Array(capacity);
    this.workers = new Int32Array(capacity);
    this.roadAccess = new Uint8Array(capacity);
  }

  private grow(): void {
    const n = this.capacity * 2;
    this.id = growI32(this.id, n);
    this.assetIndex = growU16(this.assetIndex, n);
    this.variant = growI32(this.variant, n);
    this.x = growF32(this.x, n);
    this.y = growF32(this.y, n);
    this.z = growF32(this.z, n);
    this.rot = growU8(this.rot, n);
    this.tilesX = growU16(this.tilesX, n);
    this.tilesZ = growU16(this.tilesZ, n);
    this.residents = growI32(this.residents, n);
    this.workers = growI32(this.workers, n);
    this.roadAccess = growU8(this.roadAccess, n);
    this.capacity = n;
  }

  add(id: number, assetIndex: number, variant: number, x: number, y: number, z: number, rot: number, tilesX: number, tilesZ: number): number {
    if (this.count === this.capacity) this.grow();
    const i = this.count++;
    this.id[i] = id;
    this.assetIndex[i] = assetIndex;
    this.variant[i] = variant;
    this.x[i] = x;
    this.y[i] = y;
    this.z[i] = z;
    this.rot[i] = rot;
    this.tilesX[i] = tilesX;
    this.tilesZ[i] = tilesZ;
    this.residents[i] = 0;
    this.workers[i] = 0;
    this.roadAccess[i] = 0;
    this.idToIndex.set(id, i);
    return i;
  }

  indexOf(id: number): number {
    return this.idToIndex.get(id) ?? -1;
  }

  remove(id: number): boolean {
    const i = this.idToIndex.get(id);
    if (i === undefined) return false;
    const last = this.count - 1;
    if (i !== last) {
      this.id[i] = this.id[last]!;
      this.assetIndex[i] = this.assetIndex[last]!;
      this.variant[i] = this.variant[last]!;
      this.x[i] = this.x[last]!;
      this.y[i] = this.y[last]!;
      this.z[i] = this.z[last]!;
      this.rot[i] = this.rot[last]!;
      this.tilesX[i] = this.tilesX[last]!;
      this.tilesZ[i] = this.tilesZ[last]!;
      this.residents[i] = this.residents[last]!;
      this.workers[i] = this.workers[last]!;
      this.roadAccess[i] = this.roadAccess[last]!;
      this.idToIndex.set(this.id[i]!, i);
    }
    this.idToIndex.delete(id);
    this.count--;
    return true;
  }

  clear(): void {
    this.count = 0;
    this.idToIndex.clear();
  }
}

/** Graphe routier : nœuds et arêtes en SoA + listes d'adjacence reconstruites à la demande. */
export class RoadGraph {
  nodeCount = 0;
  nodeCapacity: number;
  nodeId: Int32Array;
  nodeX: Float32Array;
  nodeY: Float32Array;
  nodeZ: Float32Array;
  /** Nombre d'arêtes incidentes (un nœud orphelin est supprimé). */
  nodeDegree: Int32Array;

  edgeCount = 0;
  edgeCapacity: number;
  edgeId: Int32Array;
  edgeA: Int32Array; // id de nœud
  edgeB: Int32Array; // id de nœud
  edgeType: Uint8Array; // index dans ROAD_TYPE_ORDER
  edgeLength: Float32Array;

  private nodeIdToIndex = new Map<number, number>();
  private edgeIdToIndex = new Map<number, number>();

  constructor(nodeCapacity: number, edgeCapacity: number) {
    this.nodeCapacity = nodeCapacity;
    this.nodeId = new Int32Array(nodeCapacity);
    this.nodeX = new Float32Array(nodeCapacity);
    this.nodeY = new Float32Array(nodeCapacity);
    this.nodeZ = new Float32Array(nodeCapacity);
    this.nodeDegree = new Int32Array(nodeCapacity);
    this.edgeCapacity = edgeCapacity;
    this.edgeId = new Int32Array(edgeCapacity);
    this.edgeA = new Int32Array(edgeCapacity);
    this.edgeB = new Int32Array(edgeCapacity);
    this.edgeType = new Uint8Array(edgeCapacity);
    this.edgeLength = new Float32Array(edgeCapacity);
  }

  addNode(id: number, x: number, y: number, z: number): number {
    if (this.nodeCount === this.nodeCapacity) {
      const n = this.nodeCapacity * 2;
      this.nodeId = growI32(this.nodeId, n);
      this.nodeX = growF32(this.nodeX, n);
      this.nodeY = growF32(this.nodeY, n);
      this.nodeZ = growF32(this.nodeZ, n);
      this.nodeDegree = growI32(this.nodeDegree, n);
      this.nodeCapacity = n;
    }
    const i = this.nodeCount++;
    this.nodeId[i] = id;
    this.nodeX[i] = x;
    this.nodeY[i] = y;
    this.nodeZ[i] = z;
    this.nodeDegree[i] = 0;
    this.nodeIdToIndex.set(id, i);
    return i;
  }

  nodeIndex(id: number): number { return this.nodeIdToIndex.get(id) ?? -1; }
  edgeIndex(id: number): number { return this.edgeIdToIndex.get(id) ?? -1; }

  removeNode(id: number): void {
    const i = this.nodeIdToIndex.get(id);
    if (i === undefined) return;
    const last = this.nodeCount - 1;
    if (i !== last) {
      this.nodeId[i] = this.nodeId[last]!;
      this.nodeX[i] = this.nodeX[last]!;
      this.nodeY[i] = this.nodeY[last]!;
      this.nodeZ[i] = this.nodeZ[last]!;
      this.nodeDegree[i] = this.nodeDegree[last]!;
      this.nodeIdToIndex.set(this.nodeId[i]!, i);
    }
    this.nodeIdToIndex.delete(id);
    this.nodeCount--;
  }

  addEdge(id: number, a: number, b: number, type: number, length: number): number {
    if (this.edgeCount === this.edgeCapacity) {
      const n = this.edgeCapacity * 2;
      this.edgeId = growI32(this.edgeId, n);
      this.edgeA = growI32(this.edgeA, n);
      this.edgeB = growI32(this.edgeB, n);
      this.edgeType = growU8(this.edgeType, n);
      this.edgeLength = growF32(this.edgeLength, n);
      this.edgeCapacity = n;
    }
    const i = this.edgeCount++;
    this.edgeId[i] = id;
    this.edgeA[i] = a;
    this.edgeB[i] = b;
    this.edgeType[i] = type;
    this.edgeLength[i] = length;
    this.edgeIdToIndex.set(id, i);
    const ia = this.nodeIndex(a);
    const ib = this.nodeIndex(b);
    if (ia >= 0) this.nodeDegree[ia]!++;
    if (ib >= 0) this.nodeDegree[ib]!++;
    return i;
  }

  /** Supprime une arête ; renvoie les ids des nœuds devenus orphelins (eux aussi supprimés). */
  removeEdge(id: number): number[] {
    const i = this.edgeIdToIndex.get(id);
    if (i === undefined) return [];
    const a = this.edgeA[i]!;
    const b = this.edgeB[i]!;
    const last = this.edgeCount - 1;
    if (i !== last) {
      this.edgeId[i] = this.edgeId[last]!;
      this.edgeA[i] = this.edgeA[last]!;
      this.edgeB[i] = this.edgeB[last]!;
      this.edgeType[i] = this.edgeType[last]!;
      this.edgeLength[i] = this.edgeLength[last]!;
      this.edgeIdToIndex.set(this.edgeId[i]!, i);
    }
    this.edgeIdToIndex.delete(id);
    this.edgeCount--;
    const orphans: number[] = [];
    for (const n of a === b ? [a] : [a, b]) {
      const ni = this.nodeIndex(n);
      if (ni < 0) continue;
      this.nodeDegree[ni]!--;
      if (this.nodeDegree[ni]! <= 0) { this.removeNode(n); orphans.push(n); }
    }
    return orphans;
  }

  clear(): void {
    this.nodeCount = 0;
    this.edgeCount = 0;
    this.nodeIdToIndex.clear();
    this.edgeIdToIndex.clear();
  }
}

/** Véhicules : positions et état de déplacement (rempli par le module trafic, phase 3). */
export class VehicleStore {
  count = 0;
  capacity: number;
  assetIndex: Uint16Array;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  heading: Float32Array;
  /** Arête courante (id) et progression [0,1] le long de l'arête. */
  edge: Int32Array;
  progress: Float32Array;
  speed: Float32Array;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.assetIndex = new Uint16Array(capacity);
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.z = new Float32Array(capacity);
    this.heading = new Float32Array(capacity);
    this.edge = new Int32Array(capacity);
    this.progress = new Float32Array(capacity);
    this.speed = new Float32Array(capacity);
  }

  add(assetIndex: number, x: number, y: number, z: number, heading: number): number {
    if (this.count === this.capacity) {
      const n = this.capacity * 2;
      this.assetIndex = growU16(this.assetIndex, n);
      this.x = growF32(this.x, n);
      this.y = growF32(this.y, n);
      this.z = growF32(this.z, n);
      this.heading = growF32(this.heading, n);
      this.edge = growI32(this.edge, n);
      this.progress = growF32(this.progress, n);
      this.speed = growF32(this.speed, n);
      this.capacity = n;
    }
    const i = this.count++;
    this.assetIndex[i] = assetIndex;
    this.x[i] = x;
    this.y[i] = y;
    this.z[i] = z;
    this.heading[i] = heading;
    this.edge[i] = -1;
    this.progress[i] = 0;
    this.speed[i] = 0;
    return i;
  }

  clear(): void { this.count = 0; }
}

/**
 * Index spatial par chunk (grille régulière, cellule = CHUNK_SIZE par défaut).
 * Chaque entité (id) est rangée dans toutes les cellules couvertes par sa boîte englobante.
 * Requêtes par rectangle sans allocation (tableau de sortie et tampon de marquage réutilisés).
 * Remplace les parcours O(n) pour les collisions, l'accrochage des nœuds et les recherches
 * de proximité (emplois, services).
 */
export class ChunkIndex {
  readonly cols: number;
  readonly rows: number;
  private readonly cells: number[][];
  /** id -> [c0, r0, c1, r1] (cellules couvertes). */
  private readonly ranges = new Map<number, [number, number, number, number]>();
  private readonly stamp = new Map<number, number>();
  private stampValue = 0;

  constructor(readonly originX: number, readonly originZ: number, readonly size: number, readonly cellSize: number) {
    this.cols = Math.max(1, Math.ceil(size / cellSize));
    this.rows = this.cols;
    this.cells = [];
    for (let i = 0; i < this.cols * this.rows; i++) this.cells.push([]);
  }

  get count(): number { return this.ranges.size; }

  private col(x: number): number { const c = Math.floor((x - this.originX) / this.cellSize); return c < 0 ? 0 : c >= this.cols ? this.cols - 1 : c; }
  private row(z: number): number { const r = Math.floor((z - this.originZ) / this.cellSize); return r < 0 ? 0 : r >= this.rows ? this.rows - 1 : r; }

  insert(id: number, minX: number, minZ: number, maxX: number, maxZ: number): void {
    if (this.ranges.has(id)) this.remove(id);
    const c0 = this.col(minX), c1 = this.col(maxX), r0 = this.row(minZ), r1 = this.row(maxZ);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) this.cells[r * this.cols + c]!.push(id);
    this.ranges.set(id, [c0, r0, c1, r1]);
  }

  remove(id: number): boolean {
    const rg = this.ranges.get(id);
    if (!rg) return false;
    for (let r = rg[1]; r <= rg[3]; r++) {
      for (let c = rg[0]; c <= rg[2]; c++) {
        const cell = this.cells[r * this.cols + c]!;
        const k = cell.indexOf(id);
        if (k >= 0) { cell[k] = cell[cell.length - 1]!; cell.pop(); }
      }
    }
    this.ranges.delete(id);
    return true;
  }

  /** Ids dont les cellules recoupent le rectangle (candidats, sans doublon). `out` est vidé puis rempli. */
  query(minX: number, minZ: number, maxX: number, maxZ: number, out: number[]): number[] {
    out.length = 0;
    const s = ++this.stampValue;
    const c0 = this.col(minX), c1 = this.col(maxX), r0 = this.row(minZ), r1 = this.row(maxZ);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const cell = this.cells[r * this.cols + c]!;
        for (let k = 0; k < cell.length; k++) {
          const id = cell[k]!;
          if (this.stamp.get(id) === s) continue;
          this.stamp.set(id, s);
          out.push(id);
        }
      }
    }
    return out;
  }

  /** Ids d'une seule cellule (col, row) — parcours en anneaux pour les recherches de proximité. */
  cell(col: number, row: number): readonly number[] {
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return EMPTY;
    return this.cells[row * this.cols + col]!;
  }

  cellOf(x: number, z: number): [number, number] { return [this.col(x), this.row(z)]; }

  clear(): void {
    for (const c of this.cells) c.length = 0;
    this.ranges.clear();
    this.stamp.clear();
  }
}
const EMPTY: readonly number[] = [];
