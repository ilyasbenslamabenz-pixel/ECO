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
import { rotAngle } from '../../shared/footprint';
import { FrontYardLayer, frontOffset } from './front-yards';
import { BuildingShadowLayer, mergeableForShadow } from './shadow-proxy';
import { BuildingBatchPool } from './batched-parts';

const _off = new THREE.Vector3();
import { BuildingMaterials, nightFactorForHour, VARYING_ROLES } from './materials';

/** Source de modèles : la bibliothèque d'assets du jeu (src/render/assets.ts) convient. */
export interface ModelSource {
  readonly catalog: AssetCatalog;
  load(assetId: string, lod?: number): Promise<THREE.Group>;
  url(file: string): string;
}

/**
 * Sous-maillage d'un LOD. Rendu instancié : `mesh` (InstancedMesh). Rendu en lots par matériau : `bm` / `gid`
 * (géométrie dans le BatchedMesh de son matériau), `mesh` nul.
 */
interface Part {
  mesh: THREE.InstancedMesh | null;
  vary: boolean;
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
  cast: boolean;
  bm: THREE.BatchedMesh | null;
  gid: number;
}
interface LodSlot {
  state: 0 | 1 | 2 | 3; // 0 non demandé, 1 en cours, 2 prêt, 3 échec
  parts: Part[];
  matrices: THREE.InstancedBufferAttribute | null;
  colors: THREE.InstancedBufferAttribute | null;
  count: number;
  /** Dernière fois (performance.now) que ce LOD a été dessiné ou chargé : libéré après un long abandon. */
  lastUsed: number;
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
  /** Ombres fusionnées (si activées) : géométrie d'ombre par LOD et par côté (−1 : aucune), gardée au déchargement. */
  proxy: (Int32Array | null)[];
  /** Instance d'ombre par bâtiment et par côté (−1 : aucune). */
  sInst: Int32Array;
  /** LOD dont l'ombre est affichée par bâtiment (−1 : masquée). */
  sLod: Int8Array;
  /** Rendu en lots par matériau : LOD des instances existantes par bâtiment (−1 : aucune), visibilité, instances. */
  mLod: Int8Array;
  mVis: Uint8Array;
  mInst: (Int32Array | null)[];
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _frustum = new THREE.Frustum();
const _wide = new THREE.Matrix4();
const _pv = new THREE.Matrix4();
const _sphere = new THREE.Sphere();
const _camPos = new THREE.Vector3();
const _lastPos = new THREE.Vector3(Infinity, Infinity, Infinity);
const _lastQ = new THREE.Quaternion();
/** Par LOD du lot en cours de mise à jour : nombre d'instances précédent et contenu modifié (sans allocation). */
const _prevCount = new Int32Array(8);
const _changed = new Uint8Array(8);
/** Lot sans instance : ses LOD sont libérés au bout de 30 s (une démolition suivie d'une reconstruction les garde). */
const LOD_RELEASE_EMPTY_MS = 30_000;
/** LOD détaillé non dessiné depuis 90 s (caméra partie ailleurs) : libéré. */
const LOD_RELEASE_IDLE_MS = 90_000;

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
/** Géométrie vide : remplace celle d'un sous-maillage copiée dans un lot par matériau (mémoire libérée). */
const _emptyGeo = new THREE.BufferGeometry();

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
  /**
   * Ombres en lots fusionnés (shadow-proxy.ts) : ≈ 1 appel de rendu par côté de matériau dans la carte d'ombre au
   * lieu d'un par sous-maillage et par lot. Mémoire graphique en plus (positions des LOD 0 et 1) : ordinateur.
   */
  shadowProxies?: boolean;
  /**
   * Rendu principal en lots par matériau (batched-parts.ts) : un appel de rendu par matériau au lieu d'un par
   * sous-maillage et par modèle. Exige l'extension WEBGL_multi_draw ; ordinateur.
   */
  batchByMaterial?: boolean;
}

export class InstancedBuildingRenderer implements IBuildingRenderer {
  readonly group = new THREE.Group();
  /** Jardinets des maisons (haies, allées) ; modèles avancés vers la rue (front-yards.ts). */
  private readonly yards: FrontYardLayer;
  readonly materials: BuildingMaterials;
  private readonly batches = new Map<string, Batch>();
  private readonly batchList: Batch[] = [];
  private readonly idToBatch = new Map<number, Batch>();
  /** Teintes multiplicatives imposées par un module (zones spécialisées), appliquées par-dessus la patine. */
  private readonly tintOverride = new Map<number, readonly [number, number, number]>();
  private readonly assets: Map<string, CatalogAsset>;
  private camera: THREE.Camera | null = null;
  /** Rendu WebGL : les textures d'un LOD reçu lui sont envoyées par petites tranches avant son affichage. */
  private gl: THREE.WebGLRenderer | null = null;
  /** LOD reçus dont les textures restent à envoyer au GPU (affichés seulement une fois envoyées). */
  private readonly uploads: { texs: THREE.Texture[]; since: number; finish: () => void }[] = [];
  private pending = 0;
  private readonly waiters: (() => void)[] = [];
  private forceUpdate = true;
  private readonly lodBias: number;
  /** Multiplicateur des distances de LOD imposé par le palier de qualité automatique (src/render/quality-tiers.ts). */
  private lodScale = 1;
  private readonly castShadow: boolean;
  /** Ombres fusionnées (null : chaque sous-maillage projette sa propre ombre). */
  private readonly shadows: BuildingShadowLayer | null;
  /** Lots par matériau (null : rendu instancié par sous-maillage). */
  private readonly pool: BuildingBatchPool | null;
  /** Lots par matériau : copie des matériaux non partagés (GLB d'autres sources), par matériau source. */
  private readonly batchMats = new Map<THREE.Material, THREE.Material>();
  /** Bâtiments masqués (chantier en cours) : API de visibilité publiée aux modules (setBuildingsVisible). */
  private readonly hidden = new Set<number>();
  /** Débogage / vitrine : impose un LOD (−1 = selon la distance). */
  forceLod = -1;
  /** Statistiques de la dernière mise à jour (instances visibles par LOD). */
  readonly visible = new Int32Array(3);
  errors: string[] = [];

  constructor(scene: THREE.Object3D, private readonly lib: ModelSource, opts: BuildingRendererOptions = {}) {
    this.group.name = 'batiments';
    scene.add(this.group);
    this.yards = new FrontYardLayer(this.group);
    this.assets = new Map(lib.catalog.assets.map((a) => [a.id, a]));
    this.materials = new BuildingMaterials(lib.catalog, (f) => lib.url(f), opts.anisotropy ?? 8);
    this.lodBias = opts.lodBias ?? 1;
    this.castShadow = opts.castShadow ?? true;
    this.shadows = opts.shadowProxies && this.castShadow ? new BuildingShadowLayer(this.group) : null;
    this.pool = opts.batchByMaterial ? new BuildingBatchPool(this.group) : null;
  }

  /** Lots par matériau (diagnostic) : BatchedMesh et instances, null si rendu instancié. */
  batchStats(): { meshes: number; instances: number } | null { return this.pool?.stats() ?? null; }

  /** Lots par matériau : place le bâtiment `i` au LOD `l` (instances recréées si le LOD change) et le rend visible. */
  private showBatched(b: Batch, i: number, l: number): void {
    if (b.mLod[i] !== l) {
      this.dropBatched(b, i);
      const slot = b.lods[l]!;
      const ids = new Int32Array(slot.parts.length);
      for (let p = 0; p < slot.parts.length; p++) {
        const part = slot.parts[p]!;
        ids[p] = this.pool!.addInstance(part.bm!, part.gid, b.mats, i * 16, part.vary ? b.tints : null, i * 3);
      }
      b.mInst[i] = ids;
      b.mLod[i] = l;
      b.mVis[i] = 1;
      return;
    }
    if (b.mVis[i]) return;
    const ids = b.mInst[i]!, parts = b.lods[l]!.parts;
    for (let p = 0; p < ids.length; p++) this.pool!.show(parts[p]!.bm!, ids[p]!);
    b.mVis[i] = 1;
  }

  /** Lots par matériau : masque le bâtiment `i` (instances gardées). */
  private hideBatched(b: Batch, i: number): void {
    if (!b.mVis[i] || b.mLod[i]! < 0) return;
    const ids = b.mInst[i]!, parts = b.lods[b.mLod[i]!]!.parts;
    for (let p = 0; p < ids.length; p++) this.pool!.hide(parts[p]!.bm!, ids[p]!);
    b.mVis[i] = 0;
  }

  /** Lots par matériau : supprime les instances du bâtiment `i`. */
  private dropBatched(b: Batch, i: number): void {
    const l = b.mLod[i]!;
    const ids = b.mInst[i];
    if (l >= 0 && ids) {
      const parts = b.lods[l]!.parts;
      for (let p = 0; p < ids.length; p++) this.pool!.remove(parts[p]!.bm!, ids[p]!);
    }
    b.mInst[i] = null;
    b.mLod[i] = -1;
    b.mVis[i] = 0;
  }

  /** Masque / réaffiche des bâtiments (chantiers) : instances et ombres retirées du rendu, sans les supprimer. */
  setBuildingsVisible(ids: readonly number[], visible: boolean): void {
    for (const id of ids) { if (visible) this.hidden.delete(id); else this.hidden.add(id); }
    this.forceUpdate = true;
  }

  /** Ombres fusionnées (diagnostic) : lots et instances, null si désactivées. */
  shadowStats(): { meshes: number; instances: number } | null { return this.shadows?.stats() ?? null; }

  /** Affiche l'ombre du bâtiment `i` du lot au LOD `l` (−1 : masquée). */
  private setShadow(b: Batch, i: number, l: number): void {
    const sh = this.shadows!;
    const geo = l >= 0 ? b.proxy[l] ?? null : null;
    if (!geo) l = -1;
    if (b.sLod[i] === l) return;
    b.sLod[i] = l;
    for (let s = 0; s < 3; s++) {
      const g = geo ? geo[s]! : -1;
      const inst = b.sInst[i * 3 + s]!;
      if (g < 0) { if (inst >= 0) sh.hide(s, inst); continue; }
      if (inst < 0) b.sInst[i * 3 + s] = sh.addInstance(s, g, b.mats, i * 16);
      else sh.show(s, inst, g);
    }
  }

  get count(): number { return this.idToBatch.size; }

  /** Caméra pour le culling par instance (facultatif). */
  attachCamera(camera: THREE.Camera | null): void { this.camera = camera; this.forceUpdate = true; }

  /**
   * Rendu WebGL (facultatif) : sans lui, un LOD reçu s'affiche tout de suite et ses textures partent au GPU à la
   * première image qui le dessine (près d'une seconde d'un bloc pour une ville entière qui se charge).
   */
  attachRenderer(gl: THREE.WebGLRenderer | null): void { this.gl = gl; }

  /**
   * Envoie au GPU les textures des LOD reçus, dans la limite de `budgetMs` ; un LOD complet devient affichable.
   * Appelé à chaque mise à jour (petit budget) et pendant l'écran de chargement (budget large).
   * Renvoie le nombre de LOD encore en attente d'envoi.
   */
  pumpUploads(budgetMs: number): number {
    const gl = this.gl;
    const t0 = performance.now();
    for (let i = 0; i < this.uploads.length;) {
      const u = this.uploads[i]!;
      while (u.texs.length && performance.now() - t0 < budgetMs) {
        const t = u.texs[u.texs.length - 1]!;
        // Image pas encore décodée : on y reviendra (abandon de l'attente au bout de 5 s, comme sans file).
        if (t.version === 0 && performance.now() - u.since < 5000) break;
        u.texs.pop();
        if (gl && t.version > 0) gl.initTexture(t);
      }
      if (u.texs.length === 0) { this.uploads.splice(i, 1); u.finish(); } else i++;
      if (performance.now() - t0 >= budgetMs) break;
    }
    return this.uploads.length;
  }

  /** Palier de qualité : distances de LOD multipliées par `s` (recalcul à la prochaine mise à jour). */
  setLodScale(s: number): void { if (s !== this.lodScale) { this.lodScale = s; this.forceUpdate = true; } }

  /** Force le recalcul des LOD à la prochaine mise à jour. */
  invalidate(): void { this.forceUpdate = true; }
  /** Projection de la caméra au dernier recalcul du culling (rotation de l'écran / redimensionnement). */
  private lastProjX = NaN;
  private lastProjY = NaN;

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
          lods: a.lods.map(() => ({ state: 0, parts: [], matrices: null, colors: null, count: 0, lastUsed: 0 })),
          ids: [], mats: new Float32Array(16 * 16), spheres: new Float32Array(4 * 16), tints: new Float32Array(3 * 16),
          capacity: 16, dirty: true,
          proxy: a.lods.map(() => null), sInst: new Int32Array(16 * 3).fill(-1), sLod: new Int8Array(16).fill(-1),
          mLod: new Int8Array(16).fill(-1), mVis: new Uint8Array(16), mInst: [],
        };
        this.batches.set(key, b);
        this.batchList.push(b);
      }
      const i = b.ids.length;
      if (i >= b.capacity) this.grow(b, b.capacity * 2);
      b.ids.push(r.id);
      b.sInst.fill(-1, i * 3, i * 3 + 3);
      b.sLod[i] = -1;
      b.mLod[i] = -1; b.mVis[i] = 0; b.mInst[i] = null;
      _q.setFromAxisAngle(_up, rotAngle(r.rot));
      frontOffset(a, r.rot, _off);
      _p.set(r.x + _off.x, r.y, r.z + _off.z);
      this.yards.add(r.id, a, r.x, r.y, r.z, r.rot);
      _s.set(1, b.heightScale, 1);
      _m.compose(_p, _q, _s).toArray(b.mats, i * 16);
      const d = a.dimensions;
      const h = d.height * b.heightScale;
      b.spheres[i * 4] = r.x + _off.x;
      b.spheres[i * 4 + 1] = r.y + h / 2;
      b.spheres[i * 4 + 2] = r.z + _off.z;
      b.spheres[i * 4 + 3] = 0.5 * Math.hypot(d.width, d.depth, h);
      this.writeTint(b, i, r.id);
      b.dirty = true;
      this.idToBatch.set(r.id, b);
    }
    this.forceUpdate = true;
  }

  /** Patine propre au bâtiment (stable par identifiant), multipliée par la teinte imposée s'il y en a une. */
  private writeTint(b: Batch, i: number, id: number): void {
    const k = hash01(id);
    const k2 = hash01(id * 31 + 7);
    const bright = 0.9 + 0.16 * k;
    const o = this.tintOverride.get(id);
    b.tints[i * 3] = bright * (0.985 + 0.03 * k2) * (o ? o[0] : 1);
    b.tints[i * 3 + 1] = bright * (o ? o[1] : 1);
    b.tints[i * 3 + 2] = bright * (1.015 - 0.03 * k2) * (o ? o[2] : 1);
  }

  /**
   * Teinte multiplicative d'un bâtiment (null : patine d'origine). Utilisée par le module « ressources » pour
   * distinguer les bâtiments des zones spécialisées (mêmes modèles). Peut précéder l'ajout du bâtiment.
   */
  setBuildingTint(id: number, rgb: readonly [number, number, number] | null): void {
    if (rgb) this.tintOverride.set(id, rgb); else this.tintOverride.delete(id);
    const b = this.idToBatch.get(id);
    if (!b) return;
    const i = b.ids.indexOf(id);
    if (i < 0) return;
    this.writeTint(b, i, id);
    // Lots par matériau : la couleur est lue à la création des instances, qui sont donc recréées.
    if (this.pool) this.dropBatched(b, i);
    b.dirty = true;
    this.forceUpdate = true;
  }

  remove(ids: readonly number[]): void {
    for (const id of ids) {
      this.yards.remove(id);
      const b = this.idToBatch.get(id);
      if (!b) continue;
      const i = b.ids.indexOf(id);
      const last = b.ids.length - 1;
      if (this.shadows) for (let s = 0; s < 3; s++) { const inst = b.sInst[i * 3 + s]!; if (inst >= 0) this.shadows.remove(s, inst); }
      if (this.pool) this.dropBatched(b, i);
      if (i !== last) {
        b.mLod[i] = b.mLod[last]!; b.mVis[i] = b.mVis[last]!; b.mInst[i] = b.mInst[last] ?? null;
        b.mLod[last] = -1; b.mVis[last] = 0; b.mInst[last] = null;
        b.sInst.copyWithin(i * 3, last * 3, last * 3 + 3);
        b.sLod[i] = b.sLod[last]!;
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
    const si = new Int32Array(cap * 3).fill(-1); si.set(b.sInst); b.sInst = si;
    const sl = new Int8Array(cap).fill(-1); sl.set(b.sLod); b.sLod = sl;
    const ml = new Int8Array(cap).fill(-1); ml.set(b.mLod); b.mLod = ml;
    const mv = new Uint8Array(cap); mv.set(b.mVis); b.mVis = mv;
    b.capacity = cap;
    if (!this.pool) for (let l = 0; l < b.lods.length; l++) if (b.lods[l]!.state === 2) this.allocLod(b, l);
  }

  /** (Ré)alloue les tampons d'instances d'un LOD à la capacité du lot et les partage entre sous-maillages. */
  private allocLod(b: Batch, l: number): void {
    const slot = b.lods[l]!;
    // Anciens tampons d'instances (agrandissement du lot) : three ne libère le tampon GPU de `instanceMatrix` /
    // `instanceColor` qu'au dispose() de l'InstancedMesh (événement écouté par le rendu) ; sans cela, chaque
    // agrandissement laissait les anciens tampons orphelins sur le GPU. Le maillage reste utilisable.
    if (slot.matrices) for (const p of slot.parts) p.mesh?.dispose();
    const mat = new THREE.InstancedBufferAttribute(new Float32Array(b.capacity * 16), 16);
    mat.setUsage(THREE.DynamicDrawUsage);
    const col = new THREE.InstancedBufferAttribute(new Float32Array(b.capacity * 3).fill(1), 3);
    col.setUsage(THREE.DynamicDrawUsage);
    slot.matrices = mat;
    slot.colors = col;
    for (const p of slot.parts) {
      if (!p.mesh) continue;
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
        let mat = this.materials.resolve(srcMats[0]!, variant?.materialOverrides?.[name]);
        // Lots par matériau : un matériau GLB non partagé (autre source) peut servir ailleurs à des maillages
        // simples (aperçus) ; une copie propre aux lots évite que three alterne les deux variantes de programme.
        if (this.pool && mat === srcMats[0]) {
          let c = this.batchMats.get(mat);
          if (!c) { c = mat.clone(); this.batchMats.set(mat, c); }
          mat = c;
        }
        const glassy = (mat as THREE.MeshStandardMaterial).transparent;
        const cast = this.castShadow && !glassy && l < 2;
        const vary = VARYING_ROLES.has(name);
        if (this.pool) { slot.parts.push({ mesh: null, vary, geo, mat, cast, bm: null, gid: -1 }); return; }
        const mesh = new THREE.InstancedMesh(geo, mat, b.capacity);
        mesh.name = `${b.key}_lod${l}_${name}`;
        mesh.frustumCulled = false; // culling par instance dans update()
        mesh.castShadow = cast;
        mesh.receiveShadow = true;
        mesh.count = 0;
        slot.parts.push({ mesh, vary, geo, mat, cast, bm: null, gid: -1 });
        this.group.add(mesh);
      });
      // Ombres fusionnées : les sous-maillages opaques des LOD 0 et 1 n'ont plus d'ombre propre ; leur géométrie
      // d'ombre (créée une fois par LOD, gardée si le LOD est déchargé puis rechargé) la remplace.
      if (this.shadows) {
        const merged = slot.parts.filter((p) => p.cast && mergeableForShadow(p.mat));
        if (merged.length && !b.proxy[l]) b.proxy[l] = this.shadows.addLod(merged.map((p) => ({ geometry: p.geo, side: p.mat.side })));
        if (b.proxy[l]) for (const p of merged) { p.cast = false; if (p.mesh) p.mesh.castShadow = false; }
      }
      const finish = (): void => {
        slot.state = 2;
        slot.lastUsed = performance.now();
        if (this.pool) {
          // Géométries copiées dans les lots de leur matériau, puis libérées (seuls les lots restent en mémoire).
          for (const p of slot.parts) { const r = this.pool.addGeometry(p.geo, p.mat, p.cast); p.bm = r.bm; p.gid = r.gid; p.geo.dispose(); p.geo = _emptyGeo; }
        } else this.allocLod(b, l);
        this.forceUpdate = true;
      };
      if (!this.gl) { finish(); return; }
      const texs = new Set<THREE.Texture>();
      for (const p of slot.parts) {
        const m = p.mat as THREE.MeshStandardMaterial;
        for (const t of [m.map, m.normalMap, m.roughnessMap, m.metalnessMap, m.aoMap, m.emissiveMap, m.alphaMap]) if (t) texs.add(t);
      }
      // `pending` couvre aussi l'envoi : whenReady() résout quand les LOD demandés sont affichables.
      return new Promise<void>((res) => { this.uploads.push({ texs: [...texs], since: performance.now(), finish: () => { finish(); res(); } }); });
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
      // Boucle d'affichage éventuellement arrêtée (écran de chargement) : la file d'envois est vidée ici.
      while (this.pending > 0 && this.uploads.length > 0) {
        this.pumpUploads(30);
        await new Promise<void>((r) => setTimeout(r, 4));
      }
      if (this.pending > 0) await Promise.race([new Promise<void>((r) => this.waiters.push(r)), new Promise<void>((r) => setTimeout(r, 30))]);
      await this.materials.whenReady();
      if (this.pending === 0) { this.pool?.compact(); this.shadows?.compact(); return; }
    }
  }

  get loading(): number { return this.pending; }

  /**
   * Libère les LOD abandonnés (maillages instanciés, géométries propres au lot, tampons d'instances) :
   * lot vide depuis LOD_RELEASE_EMPTY_MS (tous ses LOD), ou LOD détaillé non dessiné depuis LOD_RELEASE_IDLE_MS
   * (le LOD le plus grossier d'un lot habité est gardé : jamais de bâtiment invisible le temps d'un rechargement).
   * Matériaux et textures sont partagés (BuildingMaterials) : non libérés ici. Un LOD libéré redevient
   * « non demandé » et sera rechargé à la demande. Renvoie le nombre de LOD libérés.
   */
  releaseUnusedLods(now = performance.now()): number {
    // Lots par matériau (ordinateur) : géométries partagées dans les lots, rien à libérer LOD par LOD.
    if (this.pool) return 0;
    let n = 0;
    for (const b of this.batchList) {
      const nl = b.lods.length;
      for (let l = 0; l < nl; l++) {
        const slot = b.lods[l]!;
        if (slot.state !== 2) continue;
        if (slot.count > 0) { slot.lastUsed = now; continue; }
        const empty = b.ids.length === 0;
        if (!empty && l === nl - 1) continue;
        if (now - slot.lastUsed < (empty ? LOD_RELEASE_EMPTY_MS : LOD_RELEASE_IDLE_MS)) continue;
        for (const p of slot.parts) { p.mesh?.removeFromParent(); p.mesh?.dispose(); p.geo.dispose(); }
        slot.parts = []; slot.matrices = null; slot.colors = null; slot.count = 0; slot.state = 0;
        n++;
      }
    }
    if (n) this.forceUpdate = true;
    return n;
  }
  private nextReleaseCheck = 0;

  update(cx: number, cy: number, cz: number): void {
    this.yards.update();
    const now = performance.now();
    if (now >= this.nextReleaseCheck) { this.nextReleaseCheck = now + 5000; this.releaseUnusedLods(now); }
    if (this.uploads.length) this.pumpUploads(6);
    _camPos.set(cx, cy, cz);
    const cam = this.camera;
    // Recalcul des instances visibles (et envoi à la carte graphique) seulement après un vrai déplacement :
    // ≥ 3 m ou ≥ ~2,5° de rotation ; champ élargi (~8 %) pour ne rien voir apparaître en retard au bord de l'écran.
    let moved = this.forceUpdate || _camPos.distanceToSquared(_lastPos) > 9;
    if (cam) {
      cam.updateMatrixWorld();
      if (!moved && Math.abs(cam.quaternion.dot(_lastQ)) < 0.99976) moved = true;
      // Changement de projection (rotation de l'écran, redimensionnement : rapport largeur/hauteur, champ) :
      // la caméra n'a pas bougé mais le champ de vision, si — recalcul obligatoire.
      const pe = cam.projectionMatrix.elements;
      if (!moved && (pe[0] !== this.lastProjX || pe[5] !== this.lastProjY)) moved = true;
    }
    for (let i = 0; i < this.batchList.length && !moved; i++) if (this.batchList[i]!.dirty) moved = true;
    if (!moved) return;
    this.forceUpdate = false;
    _lastPos.copy(_camPos);
    if (cam) {
      _lastQ.copy(cam.quaternion);
      this.lastProjX = cam.projectionMatrix.elements[0]!; this.lastProjY = cam.projectionMatrix.elements[5]!;
      _wide.copy(cam.projectionMatrix);
      _wide.elements[0]! *= 0.92; _wide.elements[5]! *= 0.92;
      _pv.multiplyMatrices(_wide, cam.matrixWorldInverse);
      _frustum.setFromProjectionMatrix(_pv);
    }
    this.visible[0] = this.visible[1] = this.visible[2] = 0;
    for (let bi = 0; bi < this.batchList.length; bi++) {
      const b = this.batchList[bi]!;
      const nl = b.lods.length;
      for (let l = 0; l < nl; l++) { _prevCount[l] = b.lods[l]!.count; _changed[l] = 0; b.lods[l]!.count = 0; }
      const bias = this.lodBias * this.lodScale;
      const d0 = b.asset.lods[0]!.maxDistance * bias;
      const d1 = nl > 1 ? b.asset.lods[1]!.maxDistance * bias : Infinity;
      const sh = this.shadows !== null;
      const pool = this.pool !== null;
      for (let i = 0; i < b.ids.length; i++) {
        const sx = b.spheres[i * 4]!;
        const sy = b.spheres[i * 4 + 1]!;
        const sz = b.spheres[i * 4 + 2]!;
        const sr = b.spheres[i * 4 + 3]!;
        if (this.hidden.size && this.hidden.has(b.ids[i]!)) { if (sh) this.setShadow(b, i, -1); if (pool) this.hideBatched(b, i); continue; }
        if (cam) {
          _sphere.center.set(sx, sy, sz);
          _sphere.radius = sr;
          if (!_frustum.intersectsSphere(_sphere)) { if (sh) this.setShadow(b, i, -1); if (pool) this.hideBatched(b, i); continue; }
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
        if (sh) this.setShadow(b, i, use);
        if (use < 0) { if (pool) this.hideBatched(b, i); continue; }
        const slot = b.lods[use]!;
        const c = slot.count++;
        if (pool) { this.showBatched(b, i, use); this.visible[use < 3 ? use : 2]!++; continue; }
        const ma = slot.matrices!.array as Float32Array;
        const src = b.mats;
        // Copie sans allocation ; on note si le contenu change (sinon rien n'est renvoyé à la carte graphique).
        let ch = 0;
        for (let k = 0, o = c * 16, si = i * 16; k < 16; k++) { const v = src[si + k]!; if (ma[o + k] !== v) { ma[o + k] = v; ch = 1; } }
        const ca = slot.colors!.array as Float32Array;
        const t0 = b.tints[i * 3]!, t1 = b.tints[i * 3 + 1]!, t2 = b.tints[i * 3 + 2]!;
        if (ca[c * 3] !== t0 || ca[c * 3 + 1] !== t1 || ca[c * 3 + 2] !== t2) { ca[c * 3] = t0; ca[c * 3 + 1] = t1; ca[c * 3 + 2] = t2; ch = 1; }
        if (ch) _changed[use] = 1;
        this.visible[use < 3 ? use : 2]!++;
      }
      for (let l = 0; l < nl; l++) {
        const slot = b.lods[l]!;
        if (slot.state !== 2 || pool) continue;
        // Un InstancedMesh à 0 instance coûte quand même un appel de rendu (et un dans la carte d'ombre) : masqué.
        for (let p = 0; p < slot.parts.length; p++) { const m = slot.parts[p]!.mesh!; m.count = slot.count; m.visible = slot.count > 0; }
        // Envoi limité aux instances dessinées (plage) et seulement si la liste a changé : avant, chaque recalcul
        // (caméra en mouvement) renvoyait les tampons entiers (capacité du lot) de tous les lots visibles.
        if (slot.count > 0 && (_changed[l] || slot.count !== _prevCount[l])) {
          const ma = slot.matrices!, ca = slot.colors!;
          ma.clearUpdateRanges(); ma.addUpdateRange(0, slot.count * 16); ma.needsUpdate = true;
          ca.clearUpdateRanges(); ca.addUpdateRange(0, slot.count * 3); ca.needsUpdate = true;
        }
      }
      b.dirty = false;
    }
  }

  dispose(): void {
    for (const b of this.batchList) for (const s of b.lods) for (const p of s.parts) { p.mesh?.dispose(); p.geo.dispose(); }
    this.shadows?.dispose();
    this.pool?.dispose();
    this.batches.clear();
    this.batchList.length = 0;
    this.idToBatch.clear();
    this.materials.dispose();
    this.yards.dispose();
    this.group.removeFromParent();
  }
}
