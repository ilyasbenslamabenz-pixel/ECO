/**
 * Maillage des chunks de terrain hors du thread principal.
 *
 * Le worker est créé depuis un Blob contenant le code source de `meshChunk` (fonction autonome) :
 * aucune entrée de build ni fichier supplémentaire n'est nécessaire, et la création reste
 * même-origine (pas de module worker cross-origin, pas de SharedArrayBuffer).
 * Si la création échoue (CSP, environnement sans Worker), `TerrainMesher` maille de façon
 * synchrone avec un budget de temps par image (voir renderer.ts) : le résultat est identique.
 */
import { meshChunk, type ChunkMesh, type ChunkRequest, type MeshSource } from './mesher';

export interface MeshJob extends ChunkRequest {
  id: number;
}

type WorkerIn =
  | { kind: 'source'; src: MeshSource }
  | { kind: 'patch'; i0: number; j0: number; w: number; h: number; heights: Float32Array; waterSurface: Float32Array }
  | { kind: 'mesh'; job: MeshJob };

type WorkerOut = { kind: 'mesh'; id: number; mesh: ChunkMesh } | { kind: 'error'; id: number; message: string };

/** Corps du worker (AUTONOME : sérialisé par toString()). */
function workerMain(scope: { onmessage: ((e: { data: WorkerIn }) => void) | null; postMessage(m: WorkerOut, t?: Transferable[]): void }, mesh: typeof meshChunk): void {
  let src: MeshSource | null = null;
  scope.onmessage = (e): void => {
    const m = e.data;
    if (m.kind === 'source') { src = m.src; return; }
    if (m.kind === 'patch') {
      if (!src) return;
      for (let j = 0; j < m.h; j++) {
        const row = (m.j0 + j) * src.samplesX + m.i0;
        src.heights.set(m.heights.subarray(j * m.w, (j + 1) * m.w), row);
        if (src.waterSurface.length) src.waterSurface.set(m.waterSurface.subarray(j * m.w, (j + 1) * m.w), row);
      }
      return;
    }
    if (!src) { scope.postMessage({ kind: 'error', id: m.job.id, message: 'source absente' }); return; }
    try {
      const r = mesh(src, m.job);
      scope.postMessage({ kind: 'mesh', id: m.job.id, mesh: r }, [r.positions.buffer, r.normals.buffer, r.splat.buffer, r.env.buffer]);
    } catch (err) {
      scope.postMessage({ kind: 'error', id: m.job.id, message: String(err) });
    }
  };
}

/** Code source complet du worker (exporté pour les tests). */
export function mesherWorkerSource(): string {
  return `"use strict";\nconst __name = (f) => f;\nconst __meshChunk = ${meshChunk.toString()};\n(${workerMain.toString()})(self, __meshChunk);\n`;
}

/** File de maillage : worker si possible, sinon synchrone. */
export class TerrainMesher {
  private worker: Worker | null = null;
  private url: string | null = null;
  private nextId = 1;
  private pending = new Map<number, (m: ChunkMesh | null) => void>();
  private src: MeshSource | null = null;
  /** Vrai si le maillage s'exécute dans un Web Worker. */
  readonly usesWorker: boolean;

  constructor(useWorker = true) {
    let ok = false;
    if (useWorker && typeof Worker !== 'undefined' && typeof Blob !== 'undefined' && typeof URL !== 'undefined') {
      try {
        this.url = URL.createObjectURL(new Blob([mesherWorkerSource()], { type: 'text/javascript' }));
        this.worker = new Worker(this.url);
        this.worker.onmessage = (e: MessageEvent<WorkerOut>): void => {
          const m = e.data;
          const cb = this.pending.get(m.id);
          this.pending.delete(m.id);
          cb?.(m.kind === 'mesh' ? m.mesh : null);
        };
        this.worker.onerror = (): void => {
          // Bascule en synchrone : les travaux en attente sont rejoués par l'appelant (null).
          this.worker?.terminate();
          this.worker = null;
          for (const cb of this.pending.values()) cb(null);
          this.pending.clear();
        };
        ok = true;
      } catch {
        this.worker = null;
      }
    }
    this.usesWorker = ok;
  }

  get workerAlive(): boolean { return this.worker !== null; }
  get inFlight(): number { return this.pending.size; }

  /** Fournit les données (copie envoyée au worker ; la source locale reste utilisable en synchrone). */
  setSource(src: MeshSource): void {
    this.src = src;
    if (this.worker) {
      const copy: MeshSource = {
        ...src,
        heights: new Float32Array(src.heights),
        waterSurface: new Float32Array(src.waterSurface),
        moisture: new Uint8Array(src.moisture),
        forest: new Uint8Array(src.forest),
      };
      this.worker.postMessage({ kind: 'source', src: copy } satisfies WorkerIn, [copy.heights.buffer, copy.waterSurface.buffer, copy.moisture.buffer, copy.forest.buffer]);
    }
  }

  /** Répercute une modification de région (après terraformation) dans la copie du worker. */
  patch(i0: number, j0: number, w: number, h: number): void {
    if (!this.worker || !this.src) return;
    const heights = new Float32Array(w * h);
    const ws = new Float32Array(this.src.waterSurface.length ? w * h : 0);
    for (let j = 0; j < h; j++) {
      const row = (j0 + j) * this.src.samplesX + i0;
      heights.set(this.src.heights.subarray(row, row + w), j * w);
      if (ws.length) ws.set(this.src.waterSurface.subarray(row, row + w), j * w);
    }
    this.worker.postMessage({ kind: 'patch', i0, j0, w, h, heights, waterSurface: ws } satisfies WorkerIn, [heights.buffer, ws.buffer]);
  }

  /** Maille de façon asynchrone (worker) ; `null` si le worker a échoué (rejouer en synchrone). */
  request(req: ChunkRequest, cb: (m: ChunkMesh | null) => void): void {
    if (!this.worker) { cb(this.meshSync(req)); return; }
    const id = this.nextId++;
    this.pending.set(id, cb);
    this.worker.postMessage({ kind: 'mesh', job: { ...req, id } } satisfies WorkerIn);
  }

  meshSync(req: ChunkRequest): ChunkMesh | null {
    return this.src ? meshChunk(this.src, req) : null;
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    if (this.url) URL.revokeObjectURL(this.url);
    this.pending.clear();
  }
}
