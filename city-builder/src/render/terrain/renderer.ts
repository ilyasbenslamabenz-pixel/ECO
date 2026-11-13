/**
 * Système de rendu du terrain : chunks de 256 m avec LOD par distance, coutures masquées par des jupes,
 * streaming piloté par la caméra (priorité : chunks visibles et proches) avec budget par image,
 * maillage dans un Web Worker (repli synchrone budgété), anneau d'horizon hors carte (visuel).
 * Implémente IRenderTerrain (heightAt identique à la simulation : terrainHeightAt bilinéaire).
 */
import * as THREE from 'three';
import { CHUNK_SIZE } from '../../shared/constants';
import type { IRenderTerrain, TerrainData } from '../../shared/contracts';
import type { AssetCatalog } from '../../shared/catalog';
import { terrainHeightAt } from '../../shared/terrain-gen';
import { applyPatch as applyPatchData } from '../../sim/terrain/terraform';
import { isWorldTerrain, type TerrainPatch, type WorldTerrain } from '../../sim/terrain/index';
import { chunkIndices, type ChunkMesh, type MeshSource } from './mesher';
import { TerrainMesher } from './mesher-worker';
import { createTerrainMaterial, loadTerrainTextures, type TerrainMaterialHandle, type TerrainTextures } from './material';

export interface TerrainSystemOptions {
  catalog: AssetCatalog;
  /** URL du dossier assets/ (catalogue, textures). */
  assetsBase: URL;
  anisotropy?: number;
  /** Maillage dans un worker (défaut vrai). */
  useWorker?: boolean;
  /** Largeur de l'anneau d'horizon (en chunks) ; 0 = aucun. Défaut 6. */
  horizonChunks?: number;
  /** Distances (m) de bascule LOD0->1, 1->2, 2->3. */
  lodDistances?: [number, number, number];
  /** Budget de maillage synchrone par image (ms) si le worker est indisponible. */
  syncBudgetMs?: number;
  /** Nombre maximal de travaux en vol dans le worker. */
  maxInFlight?: number;
  /** Résolution des textures de terrain (px). */
  textureSize?: number;
}

const LOD_STEPS = [1, 2, 4, 8] as const;

interface Chunk {
  cx: number;
  cz: number;
  i0: number;
  j0: number;
  ring: boolean;
  mesh: THREE.Mesh | null;
  lod: number;
  pendingLod: number;
  /** LOD voulu pour la dernière caméra vue (-1 : inconnu). */
  want: number;
  version: number;
  center: THREE.Vector3;
  radius: number;
  minY: number;
  maxY: number;
}

export interface TerrainStats {
  chunks: number;
  meshed: number;
  pending: number;
  lodCounts: number[];
  triangles: number;
  usesWorker: boolean;
  texturesReady: boolean;
}

export class TerrainSystem implements IRenderTerrain {
  readonly group = new THREE.Group();
  private data: (TerrainData & Partial<WorldTerrain>) | null = null;
  private chunks: Chunk[] = [];
  private mesher: TerrainMesher;
  private matHandle: TerrainMaterialHandle | null = null;
  private textures: TerrainTextures | null = null;
  private indexCache = new Map<number, Uint16Array | Uint32Array>();
  private cellsPerChunk = 32;
  private readonly opts: Required<Omit<TerrainSystemOptions, 'catalog' | 'assetsBase'>>;
  private readonly frustum = new THREE.Frustum();
  private readonly projView = new THREE.Matrix4();
  private readonly sphere = new THREE.Sphere();
  private readonly order: number[] = [];
  private readonly prio: Float32Array = new Float32Array(4096);
  /** Résout quand les textures sont chargées (rejet si une texture manque). */
  readonly ready: Promise<void>;
  private disposed = false;
  private readonly byPrio = (a: number, b: number): number => this.prio[a]! - this.prio[b]!;

  constructor(scene: THREE.Scene, private readonly options: TerrainSystemOptions) {
    this.opts = {
      anisotropy: options.anisotropy ?? 8,
      useWorker: options.useWorker ?? true,
      horizonChunks: options.horizonChunks ?? 6,
      lodDistances: options.lodDistances ?? [1300, 2600, 4800],
      syncBudgetMs: options.syncBudgetMs ?? 3,
      maxInFlight: options.maxInFlight ?? 6,
      textureSize: options.textureSize ?? 1024,
    };
    this.group.name = 'terrain';
    this.group.visible = false;
    scene.add(this.group);
    this.mesher = new TerrainMesher(this.opts.useWorker);
    this.ready = loadTerrainTextures(options.catalog, options.assetsBase, this.opts.anisotropy, this.opts.textureSize).then((tex) => {
      if (this.disposed) { tex.dispose(); return; }
      this.textures = tex;
      this.matHandle = createTerrainMaterial(tex, this.data?.waterLevel ?? 2);
      for (const c of this.chunks) if (c.mesh) c.mesh.material = this.matHandle.material;
      this.group.visible = true;
    });
  }

  get material(): THREE.MeshStandardMaterial | null { return this.matHandle?.material ?? null; }
  get terrainTextures(): TerrainTextures | null { return this.textures; }
  get terrain(): (TerrainData & Partial<WorldTerrain>) | null { return this.data; }

  /** Construit la grille de chunks ; le premier maillage (LOD grossier) est synchrone : jamais de trou. */
  build(t: TerrainData): void {
    this.clearChunks();
    this.data = t;
    if (this.matHandle) this.matHandle.uniforms.uWaterLevel.value = t.waterLevel;
    const world = isWorldTerrain(t) ? t : null;
    const src: MeshSource = {
      heights: t.heights,
      waterSurface: world ? world.waterSurface : new Float32Array(0),
      moisture: world ? world.moisture : new Uint8Array(0),
      forest: world ? world.forest : new Uint8Array(0),
      samplesX: t.samplesX,
      samplesZ: t.samplesZ,
      spacing: t.spacing,
      originX: t.originX,
      originZ: t.originZ,
      waterLevel: t.waterLevel,
      maxAltitude: world ? world.params.maxAltitude : 60,
    };
    this.mesher.setSource(src);
    this.cellsPerChunk = Math.round(CHUNK_SIZE / t.spacing);
    const nx = Math.ceil((t.samplesX - 1) / this.cellsPerChunk);
    const nz = Math.ceil((t.samplesZ - 1) / this.cellsPerChunk);
    const R = this.opts.horizonChunks;
    for (let cz = -R; cz < nz + R; cz++) {
      for (let cx = -R; cx < nx + R; cx++) {
        const ring = cx < 0 || cz < 0 || cx >= nx || cz >= nz;
        const i0 = cx * this.cellsPerChunk;
        const j0 = cz * this.cellsPerChunk;
        const c: Chunk = {
          cx, cz, i0, j0, ring, mesh: null, lod: -1, pendingLod: -1, want: -1, version: 0,
          center: new THREE.Vector3(t.originX + (i0 + this.cellsPerChunk / 2) * t.spacing, 0, t.originZ + (j0 + this.cellsPerChunk / 2) * t.spacing),
          radius: CHUNK_SIZE * 0.75, minY: 0, maxY: 0,
        };
        this.chunks.push(c);
        // Maillage initial grossier (LOD3) : immédiat et peu coûteux.
        const m = this.mesher.meshSync(this.request(c, 3));
        if (m) this.install(c, 3, m);
      }
    }
  }

  private request(c: Chunk, lod: number): { i0: number; j0: number; cells: number; step: number; skirt: number } {
    const step = LOD_STEPS[lod]!;
    return { i0: c.i0, j0: c.j0, cells: this.cellsPerChunk, step, skirt: 2 + step * this.data!.spacing * 0.6 };
  }

  private indices(step: number): Uint16Array | Uint32Array {
    let idx = this.indexCache.get(step);
    if (!idx) { idx = chunkIndices(this.cellsPerChunk, step); this.indexCache.set(step, idx); }
    return idx;
  }

  private install(c: Chunk, lod: number, m: ChunkMesh): void {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
    geo.setAttribute('splat', new THREE.BufferAttribute(m.splat, 4, true));
    geo.setAttribute('envw', new THREE.BufferAttribute(m.env, 4, true));
    geo.setIndex(new THREE.BufferAttribute(this.indices(LOD_STEPS[lod]!), 1));
    c.minY = m.minY;
    c.maxY = m.maxY;
    const half = (this.cellsPerChunk * this.data!.spacing) / 2;
    c.center.y = (m.minY + m.maxY) / 2;
    c.radius = Math.hypot(half, half, (m.maxY - m.minY) / 2);
    geo.boundingSphere = new THREE.Sphere(c.center.clone(), c.radius);
    geo.boundingBox = new THREE.Box3(new THREE.Vector3(c.center.x - half, m.minY, c.center.z - half), new THREE.Vector3(c.center.x + half, m.maxY, c.center.z + half));
    if (c.mesh) {
      c.mesh.geometry.dispose();
      c.mesh.geometry = geo;
    } else {
      c.mesh = new THREE.Mesh(geo, this.matHandle?.material ?? new THREE.MeshBasicMaterial({ visible: false }));
      c.mesh.name = `terrain_${c.cx}_${c.cz}`;
      c.mesh.matrixAutoUpdate = false;
      c.mesh.receiveShadow = true;
      this.group.add(c.mesh);
    }
    c.mesh.castShadow = lod <= 1 && !c.ring;
    c.lod = lod;
  }

  /** Mise à jour LOD / streaming selon la caméra (à appeler chaque image). */
  update(camera: THREE.Camera): void {
    if (!this.data || this.chunks.length === 0) return;
    this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView);
    const cam = camera.position;
    const [d0, d1, d2] = this.opts.lodDistances;
    const n = this.chunks.length;
    const order = this.order;
    order.length = 0;
    for (let k = 0; k < n; k++) {
      const c = this.chunks[k]!;
      const dx = Math.max(0, Math.abs(cam.x - c.center.x) - CHUNK_SIZE / 2);
      const dz = Math.max(0, Math.abs(cam.z - c.center.z) - CHUNK_SIZE / 2);
      const dy = Math.max(0, cam.y - c.maxY, c.minY - cam.y);
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      let want = d < d0 ? 0 : d < d1 ? 1 : d < d2 ? 2 : 3;
      if (c.ring) want = Math.max(want, 2);
      c.want = want;
      this.sphere.center.copy(c.center);
      this.sphere.radius = c.radius;
      const visible = this.frustum.intersectsSphere(this.sphere);
      if (c.mesh) c.mesh.visible = visible;
      if (want !== c.lod && c.pendingLod !== want) {
        // Priorité : visibles d'abord, puis distance ; affinage avant simplification.
        if (k < this.prio.length) this.prio[k] = d + (visible ? 0 : 5000) + (want > c.lod ? 2500 : 0);
        c.pendingLod = -2 - want; // marqueur : à demander
        order.push(k);
      }
    }
    if (order.length === 0) return;
    order.sort(this.byPrio);
    const t0 = performance.now();
    for (const k of order) {
      const c = this.chunks[k]!;
      const want = -2 - c.pendingLod;
      c.pendingLod = -1;
      if (this.mesher.workerAlive) {
        if (this.mesher.inFlight >= this.opts.maxInFlight) continue;
        const ver = c.version;
        c.pendingLod = want;
        this.mesher.request(this.request(c, want), (m) => {
          if (this.disposed || c.pendingLod !== want || c.version !== ver) return;
          c.pendingLod = -1;
          if (m) this.install(c, want, m);
        });
      } else {
        if (performance.now() - t0 > this.opts.syncBudgetMs) continue;
        const m = this.mesher.meshSync(this.request(c, want));
        if (m) this.install(c, want, m);
      }
    }
  }

  /**
   * Affinage SYNCHRONE autour d'un point regardé (ouverture d'une partie, chargement, recentrage) : les chunks
   * proches passent tout de suite au LOD que voudrait une caméra à `distance` m de ce point, les plus proches
   * d'abord, dans la limite de `budgetMs`. Sans cela, la vue d'ouverture garde quelques secondes le maillage
   * grossier initial (pas de 64 m) qui recouvre les rivières et découpe leurs berges par blocs.
   * Renvoie le nombre de chunks affinés.
   */
  refineAround(x: number, z: number, distance: number, budgetMs = 900): number {
    if (!this.data || this.chunks.length === 0) return 0;
    const [d0, d1, d2] = this.opts.lodDistances;
    const camH = Math.max(30, distance * 0.75);
    const list: { c: Chunk; want: number; d: number }[] = [];
    for (const c of this.chunks) {
      const dx = Math.max(0, Math.abs(x - c.center.x) - CHUNK_SIZE / 2);
      const dz = Math.max(0, Math.abs(z - c.center.z) - CHUNK_SIZE / 2);
      const d = Math.hypot(dx, dz, camH);
      let want = d < d0 ? 0 : d < d1 ? 1 : d < d2 ? 2 : 3;
      if (c.ring) want = Math.max(want, 2);
      if (c.lod >= 0 && want < c.lod) list.push({ c, want, d });
    }
    list.sort((a, b) => a.d - b.d);
    const t0 = performance.now();
    let n = 0;
    for (const { c, want } of list) {
      if (n > 0 && performance.now() - t0 > budgetMs) break;
      const m = this.mesher.meshSync(this.request(c, want));
      if (!m) continue;
      c.version++; // un maillage plus grossier encore en vol dans le worker sera ignoré
      c.pendingLod = -1;
      this.install(c, want, m);
      n++;
    }
    return n;
  }

  /** Vrai quand aucun chunk n'attend de maillage pour la vue courante. */
  get settled(): boolean {
    for (const c of this.chunks) if (c.pendingLod >= 0) return false;
    return this.mesher.inFlight === 0;
  }

  heightAt(x: number, z: number): number {
    return this.data ? terrainHeightAt(this.data, x, z) : 0;
  }

  /** Normale du terrain (différences centrales sur heightAt). */
  normalAt(x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    const e = this.data?.spacing ?? 8;
    out.set(this.heightAt(x - e, z) - this.heightAt(x + e, z), 2 * e, this.heightAt(x, z - e) - this.heightAt(x, z + e));
    return out.normalize();
  }

  /** Applique un patch de hauteurs (terraformation validée par la simulation) et re-maille les chunks touchés. */
  applyPatch(p: TerrainPatch): void {
    if (!this.data) return;
    applyPatchData(this.data, p);
    this.mesher.patch(p.i0, p.j0, p.i1 - p.i0 + 1, p.j1 - p.j0 + 1);
    const cs = this.cellsPerChunk;
    for (const c of this.chunks) {
      // Marge d'un échantillon : les normales des bords dépendent des voisins.
      if (c.i0 - 1 > p.i1 || c.i0 + cs + 1 < p.i0 || c.j0 - 1 > p.j1 || c.j0 + cs + 1 < p.j0) continue;
      c.version++;
      c.pendingLod = -1;
      // LOD de re-maillage : au moins aussi fin que celui que veut la caméra (0 si inconnu). Re-mailler au LOD
      // courant d'un chunk encore grossier (pas de 64 m) faisait déborder l'herbe sur la moitié d'une route
      // fraîchement nivelée jusqu'à l'affinage suivant.
      const lod = c.want >= 0 ? Math.min(Math.max(0, c.lod), c.want) : 0;
      const m = this.mesher.meshSync(this.request(c, lod));
      if (m) this.install(c, lod, m);
    }
  }

  stats(): TerrainStats {
    const lodCounts = [0, 0, 0, 0];
    let tris = 0;
    let meshed = 0;
    let pending = 0;
    for (const c of this.chunks) {
      if (c.mesh) { meshed++; lodCounts[c.lod] = (lodCounts[c.lod] ?? 0) + 1; tris += (c.mesh.geometry.index?.count ?? 0) / 3; }
      if (c.pendingLod >= 0) pending++;
    }
    return { chunks: this.chunks.length, meshed, pending, lodCounts, triangles: tris, usesWorker: this.mesher.workerAlive, texturesReady: !!this.textures };
  }

  private clearChunks(): void {
    for (const c of this.chunks) {
      if (c.mesh) { c.mesh.geometry.dispose(); this.group.remove(c.mesh); }
    }
    this.chunks = [];
    this.indexCache.clear();
  }

  dispose(): void {
    this.disposed = true;
    this.clearChunks();
    this.mesher.dispose();
    this.matHandle?.material.dispose();
    this.textures?.dispose();
    this.group.removeFromParent();
  }
}
