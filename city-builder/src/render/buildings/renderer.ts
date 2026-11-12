/**
 * Rendu instancié des bâtiments : implémente IBuildingRenderer.
 *
 * - Un LOT par (asset, variante) ; pour chaque LOD chargé, un InstancedMesh par sous-maillage (matériau),
 *   tous les sous-maillages d'un même LOD partageant LE MÊME tampon de matrices et de couleurs d'instance
 *   (une seule écriture de 16 flottants par instance et par mise à jour, un seul envoi GPU par LOD).
 * - LOD par distance caméra (distances du catalogue), chargement PROGRESSIF : un LOD n'est demandé à la
 *   bibliothèque que lorsqu'une instance en a besoin ; en attendant, le LOD chargé le plus proche le remplace.
 * - Culling par instance contre le frustum de la caméra (si `attachCamera`), sinon tout est visible.
 * - Variantes : surcharges de matériaux du catalogue (`materialOverrides`) et `heightScale` (échelle Y).
 * - Variation par instance : teinte légèrement modulée (patine) sur les rôles de façade / toiture,
 *   motif d'allumage nocturne des fenêtres propre à chaque instance (voir materials.ts).
 * - `update()` n'alloue rien (tableaux préalloués, objets temporaires de module).
 */
import * as THREE from 'three';
import type { AssetCatalog, CatalogAsset } from '../../shared/catalog';
import type { BuildingRecord, IBuildingRenderer } from '../../shared/contracts';
import { BuildingMaterials, nightFactorForHour, VARYING_ROLES } from './materials';

/** Source de modèles : la bibliothèque d'assets du jeu (src/render/assets.ts) convient. */
export interface ModelSource {
  readonly catalog: AssetCatalog;
  load(assetId: string, lod?: number): Promise<THREE.Group>;
  url(file: string): string;
}

interface Part { mesh: THREE.InstancedMesh; vary: boolean }
interface LodSlot {
  state: 0 | 1 | 2 | 3; // 0 non demandé, 1 en cours, 2 prêt, 3 échec
  parts: Part[];
  matrices: THREE.InstancedBufferAttribute | null;
  colors: THREE.InstancedBufferAttribute | null;
  count: number;
}
interface Batch {
  key: string;
  asset: CatalogAsset;
  variant: number;
  heightScale: number;
  lods: LodSlot[];
  ids: number[];
  /** 16 flottants par instance. */
  mats: Float32Array;
  /** x, y, z (centre), rayon par instance. */
  spheres: Float32Array;
  /** Couleur (patine) r, g, b par instance. */
  tints: Float32Array;
  capacity: number;
  dirty: boolean;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _frustum = new THREE.Frustum();
const _pv = new THREE.Matrix4();
const _sphere = new THREE.Sphere();
const _camPos = new THREE.Vector3();
const _lastPos = new THREE.Vector3(Infinity, Infinity, Infinity);
const _lastQ = new THREE.Quaternion();

/**
 * Géométrie flottante prête pour l'instanciation : attributs quantifiés (KHR_mesh_quantization) convertis en
 * float32, transformation du nœud (échelle / translation de déquantification) appliquée, UV ramenées en mètres
 * (plage `uvq` = [minU, minV, plageU, plageV] des extras du kit). Exécuté une fois par chargement de LOD.
 */
export function dequantize(src: THREE.BufferGeometry, matrix: THREE.Matrix4, uvq?: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(src.attributes)) {
    const a = attr as THREE.BufferAttribute;
    if (a.array instanceof Float32Array && !(a as unknown as { isInterleavedBufferAttribute?: boolean }).isInterleavedBufferAttribute) {
      g.setAttribute(name, a.clone());
      continue;
    }
    const out = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) {
      out[i * a.itemSize] = a.getX(i);
      if (a.itemSize > 1) out[i * a.itemSize + 1] = a.getY(i);
      if (a.itemSize > 2) out[i * a.itemSize + 2] = a.getZ(i);
      if (a.itemSize > 3) out[i * a.itemSize + 3] = a.getW(i);
    }
    g.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize));
  }
  if (src.index) g.setIndex(src.index.clone());
  const uv = g.getAttribute('uv') as THREE.BufferAttribute | undefined;
  if (uv && uvq && uvq.length === 4 && src.getAttribute('uv') && !(src.getAttribute('uv').array instanceof Float32Array)) {
    const arr = uv.array as Float32Array;
    for (let i = 0; i < uv.count; i++) {
      arr[i * 2] = uvq[0]! + uvq[2]! * arr[i * 2]!;
      arr[i * 2 + 1] = uvq[1]! + uvq[3]! * arr[i * 2 + 1]!;
    }
  }
  if (!matrix.equals(_ident)) g.applyMatrix4(matrix);
  const n = g.getAttribute('normal') as THREE.BufferAttribute | undefined;
  if (n) n.normalized = false;
  g.computeBoundingSphere();
  return g;
}
const _ident = new THREE.Matrix4();

/** Hachage entier -> [0,1) déterministe (variation par instance). */
function hash01(n: number): number {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

export interface BuildingRendererOptions {
  /** Multiplicateur global des distances de LOD (qualité). */
  lodBias?: number;
  anisotropy?: number;
  castShadow?: boolean;
}

export class InstancedBuildingRenderer implements IBuildingRenderer {
  readonly group = new THREE.Group();
  readonly materials: BuildingMaterials;
  private readonly batches = new Map<string, Batch>();
  private readonly batchList: Batch[] = [];
  private readonly idToBatch = new Map<number, Batch>();
  private readonly assets: Map<string, CatalogAsset>;
  private camera: THREE.Camera | null = null;
  private pending = 0;
  private readonly waiters: (() => void)[] = [];
  private forceUpdate = true;
  private readonly lodBias: number;
  private readonly castShadow: boolean;
  /** Débogage / vitrine : impose un LOD (−1 = selon la distance). */
  forceLod = -1;
  /** Statistiques de la dernière mise à jour (instances visibles par LOD). */
  readonly visible = new Int32Array(3);
  errors: string[] = [];

  constructor(scene: THREE.Object3D, private readonly lib: ModelSource, opts: BuildingRendererOptions = {}) {
    this.group.name = 'batiments';
    scene.add(this.group);
    this.assets = new Map(lib.catalog.assets.map((a) => [a.id, a]));
    this.materials = new BuildingMaterials(lib.catalog, (f) => lib.url(f), opts.anisotropy ?? 8);
    this.lodBias = opts.lodBias ?? 1;
    this.castShadow = opts.castShadow ?? true;
  }

  get count(): number { return this.idToBatch.size; }

  /** Caméra pour le culling par instance (facultatif). */
  attachCamera(camera: THREE.Camera | null): void { this.camera = camera; this.forceUpdate = true; }

  /** Force le recalcul des LOD à la prochaine mise à jour. */
  invalidate(): void { this.forceUpdate = true; }

  /** Facteur de nuit 0..1 (fenêtres allumées). */
  setNight(f: number): void {
    const n = Math.max(0, Math.min(1, f));
    this.materials.night.uNight.value = n;
    this.materials.night.uLitRatio.value = 0.3 + 0.35 * n;
  }
  static nightFactorForHour = nightFactorForHour;

  add(records: readonly BuildingRecord[]): void {
    for (const r of records) {
      const a = this.assets.get(r.assetId);
      if (!a) { this.errors.push(`asset inconnu ${r.assetId}`); continue; }
      if (this.idToBatch.has(r.id)) this.remove([r.id]);
      const vi = r.variant >= 0 && r.variant < a.variants.length ? r.variant : 0;
      const key = `${a.id}#${vi}`;
      let b = this.batches.get(key);
      if (!b) {
        const hs = a.variants[vi]?.heightScale ?? 1;
        b = {
          key, asset: a, variant: vi, heightScale: hs,
          lods: a.lods.map(() => ({ state: 0, parts: [], matrices: null, colors: null, count: 0 })),
          ids: [], mats: new Float32Array(16 * 16), spheres: new Float32Array(4 * 16), tints: new Float32Array(3 * 16),
          capacity: 16, dirty: true,
        };
        this.batches.set(key, b);
        this.batchList.push(b);
      }
      const i = b.ids.length;
      if (i >= b.capacity) this.grow(b, b.capacity * 2);
      b.ids.push(r.id);
      _q.setFromAxisAngle(_up, (r.rot & 3) * (Math.PI / 2));
      _p.set(r.x, r.y, r.z);
      _s.set(1, b.heightScale, 1);
      _m.compose(_p, _q, _s).toArray(b.mats, i * 16);
      const d = a.dimensions;
      const h = d.height * b.heightScale;
      b.spheres[i * 4] = r.x;
      b.spheres[i * 4 + 1] = r.y + h / 2;
      b.spheres[i * 4 + 2] = r.z;
      b.spheres[i * 4 + 3] = 0.5 * Math.hypot(d.width, d.depth, h);
      const k = hash01(r.id);
      const k2 = hash01(r.id * 31 + 7);
      const bright = 0.9 + 0.16 * k;
      b.tints[i * 3] = bright * (0.985 + 0.03 * k2);
      b.tints[i * 3 + 1] = bright;
      b.tints[i * 3 + 2] = bright * (1.015 - 0.03 * k2);
      b.dirty = true;
      this.idToBatch.set(r.id, b);
    }
    this.forceUpdate = true;
  }

  remove(ids: readonly number[]): void {
    for (const id of ids) {
      const b = this.idToBatch.get(id);
      if (!b) continue;
      const i = b.ids.indexOf(id);
      const last = b.ids.length - 1;
      if (i !== last) {
        b.ids[i] = b.ids[last]!;
        b.mats.copyWithin(i * 16, last * 16, last * 16 + 16);
        b.spheres.copyWithin(i * 4, last * 4, last * 4 + 4);
        b.tints.copyWithin(i * 3, last * 3, last * 3 + 3);
      }
      b.ids.pop();
      b.dirty = true;
      this.idToBatch.delete(id);
    }
    this.forceUpdate = true;
  }

  private grow(b: Batch, cap: number): void {
    const m = new Float32Array(cap * 16); m.set(b.mats); b.mats = m;
    const s = new Float32Array(cap * 4); s.set(b.spheres); b.spheres = s;
    const t = new Float32Array(cap * 3); t.set(b.tints); b.tints = t;
    b.capacity = cap;
    for (let l = 0; l < b.lods.length; l++) if (b.lods[l]!.state === 2) this.allocLod(b, l);
  }

  /** (Ré)alloue les tampons d'instances d'un LOD à la capacité du lot et les partage entre sous-maillages. */
  private allocLod(b: Batch, l: number): void {
    const slot = b.lods[l]!;
    const mat = new THREE.InstancedBufferAttribute(new Float32Array(b.capacity * 16), 16);
    mat.setUsage(THREE.DynamicDrawUsage);
    const col = new THREE.InstancedBufferAttribute(new Float32Array(b.capacity * 3).fill(1), 3);
    col.setUsage(THREE.DynamicDrawUsage);
    slot.matrices = mat;
    slot.colors = col;
    for (const p of slot.parts) {
      p.mesh.instanceMatrix = mat;
      if (p.vary) p.mesh.instanceColor = col;
      (p.mesh as unknown as { _maxInstanceCount: number })._maxInstanceCount = b.capacity;
    }
  }

  private requestLod(b: Batch, l: number): void {
    const slot = b.lods[l]!;
    if (slot.state !== 0) return;
    slot.state = 1;
    this.pending++;
    const variant = b.asset.variants[b.variant];
    this.lib.load(b.asset.id, l).then((root) => {
      root.updateMatrixWorld(true);
      root.traverse((o) => {
        const src = o as THREE.Mesh;
        if (!src.isMesh) return;
        const srcMats = Array.isArray(src.material) ? src.material : [src.material];
        const geo = dequantize(src.geometry, src.matrixWorld, (srcMats[0]?.userData as { aube?: { uvq?: number[] } }).aube?.uvq);
        const name = srcMats[0]?.name ?? '';
        const mat = this.materials.resolve(srcMats[0]!, variant?.materialOverrides?.[name]);
        const mesh = new THREE.InstancedMesh(geo, mat, b.capacity);
        mesh.name = `${b.key}_lod${l}_${name}`;
        mesh.frustumCulled = false; // culling par instance dans update()
        const glassy = (mat as THREE.MeshStandardMaterial).transparent;
        mesh.castShadow = this.castShadow && !glassy && l < 2;
        mesh.receiveShadow = true;
        mesh.count = 0;
        slot.parts.push({ mesh, vary: VARYING_ROLES.has(name) });
        this.group.add(mesh);
      });
      slot.state = 2;
      this.allocLod(b, l);
      this.forceUpdate = true;
    }).catch((e: unknown) => {
      slot.state = 3;
      this.errors.push(`${b.asset.id} LOD${l} : ${e instanceof Error ? e.message : String(e)}`);
    }).finally(() => {
      this.pending--;
      if (this.pending === 0) for (const w of this.waiters.splice(0)) w();
    });
  }

  /** Charge d'avance tous les LOD utiles des lots existants. */
  preloadAll(): void {
    for (const b of this.batchList) for (let l = 0; l < b.lods.length; l++) this.requestLod(b, l);
  }

  /** Résout quand aucun chargement de modèle n'est en cours et que les textures sont décodées. */
  async whenReady(): Promise<void> {
    for (;;) {
      if (this.pending > 0) await new Promise<void>((r) => this.waiters.push(r));
      await this.materials.whenReady();
      if (this.pending === 0) return;
    }
  }

  get loading(): number { return this.pending; }

  update(cx: number, cy: number, cz: number): void {
    _camPos.set(cx, cy, cz);
    const cam = this.camera;
    let moved = this.forceUpdate || _camPos.distanceToSquared(_lastPos) > 0.25;
    if (cam) {
      cam.updateMatrixWorld();
      if (!moved && Math.abs(cam.quaternion.dot(_lastQ)) < 0.99999) moved = true;
    }
    for (let i = 0; i < this.batchList.length && !moved; i++) if (this.batchList[i]!.dirty) moved = true;
    if (!moved) return;
    this.forceUpdate = false;
    _lastPos.copy(_camPos);
    if (cam) {
      _lastQ.copy(cam.quaternion);
      _pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      _frustum.setFromProjectionMatrix(_pv);
    }
    this.visible[0] = this.visible[1] = this.visible[2] = 0;
    for (let bi = 0; bi < this.batchList.length; bi++) {
      const b = this.batchList[bi]!;
      const nl = b.lods.length;
      for (let l = 0; l < nl; l++) b.lods[l]!.count = 0;
      const d0 = b.asset.lods[0]!.maxDistance * this.lodBias;
      const d1 = nl > 1 ? b.asset.lods[1]!.maxDistance * this.lodBias : Infinity;
      for (let i = 0; i < b.ids.length; i++) {
        const sx = b.spheres[i * 4]!;
        const sy = b.spheres[i * 4 + 1]!;
        const sz = b.spheres[i * 4 + 2]!;
        const sr = b.spheres[i * 4 + 3]!;
        if (cam) {
          _sphere.center.set(sx, sy, sz);
          _sphere.radius = sr;
          if (!_frustum.intersectsSphere(_sphere)) continue;
        }
        const dist = Math.max(0, Math.hypot(sx - cx, sy - cy, sz - cz) - sr * 0.5);
        let want = this.forceLod >= 0 ? this.forceLod : dist < d0 ? 0 : dist < d1 ? 1 : 2;
        if (want >= nl) want = nl - 1;
        // LOD voulu non chargé : le demander, utiliser le plus proche disponible
        let use = -1;
        if (b.lods[want]!.state === 2) use = want;
        else {
          this.requestLod(b, want);
          for (let k = 1; k < nl && use < 0; k++) {
            if (want + k < nl && b.lods[want + k]!.state === 2) use = want + k;
            else if (want - k >= 0 && b.lods[want - k]!.state === 2) use = want - k;
          }
        }
        if (use < 0) continue;
        const slot = b.lods[use]!;
        const c = slot.count++;
        const ma = slot.matrices!.array as Float32Array;
        const src = b.mats;
        for (let k = 0, o = c * 16, si = i * 16; k < 16; k++) ma[o + k] = src[si + k]!; // copie sans allocation
        const ca = slot.colors!.array as Float32Array;
        ca[c * 3] = b.tints[i * 3]!;
        ca[c * 3 + 1] = b.tints[i * 3 + 1]!;
        ca[c * 3 + 2] = b.tints[i * 3 + 2]!;
        this.visible[use < 3 ? use : 2]!++;
      }
      for (let l = 0; l < nl; l++) {
        const slot = b.lods[l]!;
        if (slot.state !== 2) continue;
        // Un InstancedMesh à 0 instance coûte quand même un appel de rendu (et un dans la carte d'ombre) : masqué.
        for (let p = 0; p < slot.parts.length; p++) { const m = slot.parts[p]!.mesh; m.count = slot.count; m.visible = slot.count > 0; }
        if (slot.count > 0) {
          slot.matrices!.needsUpdate = true;
          slot.colors!.needsUpdate = true;
        }
      }
      b.dirty = false;
    }
  }

  dispose(): void {
    for (const b of this.batchList) for (const s of b.lods) for (const p of s.parts) p.mesh.dispose();
    this.batches.clear();
    this.batchList.length = 0;
    this.idToBatch.clear();
    this.materials.dispose();
    this.group.removeFromParent();
  }
}
