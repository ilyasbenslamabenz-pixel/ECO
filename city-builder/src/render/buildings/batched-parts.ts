/**
 * Rendu principal des bâtiments en lots par MATÉRIAU (ordinateur, extension WEBGL_multi_draw) : tous les
 * sous-maillages qui partagent un matériau (même rôle, même jeu de textures, même teinte), tous modèles et LOD
 * confondus, sont rangés dans un seul `THREE.BatchedMesh` et dessinés en UN appel (multi-draw) au lieu d'un appel
 * par sous-maillage et par modèle. Le rendu des bâtiments (renderer.ts) garde la main sur le LOD et le culling :
 * il ajoute / retire les instances au changement de LOD et bascule leur visibilité ; rien n'est recalculé par
 * image (pas de culling ni de tri internes), seules les instances modifiées sont envoyées à la carte graphique.
 */
import * as THREE from 'three';

const _mat = new THREE.Matrix4();
const _col = new THREE.Color();

/** Signature des attributs (un BatchedMesh exige les mêmes attributs pour toutes ses géométries). */
function attributeSignature(g: THREE.BufferGeometry): string {
  return Object.keys(g.attributes).sort().map((k) => `${k}:${g.getAttribute(k).itemSize}`).join(',') + (g.index ? '|i' : '|n');
}

interface Internals { _nextVertexStart: number; _nextIndexStart: number; _maxVertexCount: number; _maxIndexCount: number }

/** Ramène les tampons de géométrie d'un BatchedMesh à la place utilisée (+ 10 %), s'il y a au moins 10 % de vide de plus. */
export function compactBatch(bm: THREE.BatchedMesh): void {
  const it = bm as unknown as Internals;
  const v = Math.ceil(it._nextVertexStart * 1.1) + 16, i = Math.ceil(it._nextIndexStart * 1.1) + 16;
  if (it._nextVertexStart === 0) return;
  if (v < it._maxVertexCount * 0.9 || (bm.geometry.index && i < it._maxIndexCount * 0.9)) bm.setGeometrySize(Math.min(v, it._maxVertexCount), Math.min(i, it._maxIndexCount));
}

export class BuildingBatchPool {
  private readonly pools = new Map<string, THREE.BatchedMesh>();

  constructor(private readonly parent: THREE.Object3D) {}

  /** Ajoute une géométrie au lot de son matériau (créé au besoin) ; la géométrie source peut ensuite être libérée. */
  addGeometry(geo: THREE.BufferGeometry, mat: THREE.Material, cast: boolean): { bm: THREE.BatchedMesh; gid: number } {
    const key = `${mat.uuid}|${attributeSignature(geo)}|${cast ? 1 : 0}`;
    const nv = geo.getAttribute('position').count;
    const ni = geo.index ? geo.index.count : 0;
    let bm = this.pools.get(key);
    if (!bm) {
      // Petites réserves au départ (≈ 470 matériaux dans la ville de démo) : agrandies par doublement.
      bm = new THREE.BatchedMesh(32, Math.max(2048, nv * 2), Math.max(4096, ni * 2), mat);
      bm.name = `batiments_${mat.name || 'materiau'}`;
      bm.castShadow = cast;
      bm.receiveShadow = true;
      bm.frustumCulled = false;
      bm.perObjectFrustumCulled = false;
      bm.sortObjects = false;
      bm.visible = false;
      bm.userData['vis'] = 0;
      this.pools.set(key, bm);
      this.parent.add(bm);
    }
    if (bm.unusedVertexCount < nv || (geo.index && bm.unusedIndexCount < ni)) {
      const it = bm as unknown as Internals;
      bm.setGeometrySize(Math.max(it._maxVertexCount * 2, it._nextVertexStart + nv * 2), Math.max(it._maxIndexCount * 2, it._nextIndexStart + ni * 2));
    }
    return { bm, gid: bm.addGeometry(geo) };
  }

  /** Nouvelle instance (matrice lue dans `mats` à `mo`, teinte facultative dans `tints` à `to`), visible. */
  addInstance(bm: THREE.BatchedMesh, gid: number, mats: Float32Array, mo: number, tints: Float32Array | null, to: number): number {
    if (bm.instanceCount >= bm.maxInstanceCount) bm.setInstanceCount(bm.maxInstanceCount * 2);
    const id = bm.addInstance(gid);
    bm.setMatrixAt(id, _mat.fromArray(mats, mo));
    if (tints) bm.setColorAt(id, _col.setRGB(tints[to]!, tints[to + 1]!, tints[to + 2]!));
    this.count(bm, 1);
    return id;
  }

  /**
   * Instances visibles par lot : un lot sans instance visible est masqué (three préparerait sinon programme,
   * uniformes et textures pour un appel vide, ≈ 50 lots dans la vue aérienne de la démo).
   */
  private count(bm: THREE.BatchedMesh, d: number): void {
    const n = ((bm.userData['vis'] as number | undefined) ?? 0) + d;
    bm.userData['vis'] = n;
    bm.visible = n > 0;
  }

  show(bm: THREE.BatchedMesh, id: number): void { if (!bm.getVisibleAt(id)) { bm.setVisibleAt(id, true); this.count(bm, 1); } }
  hide(bm: THREE.BatchedMesh, id: number): void { if (bm.getVisibleAt(id)) { bm.setVisibleAt(id, false); this.count(bm, -1); } }
  remove(bm: THREE.BatchedMesh, id: number): void { if (bm.getVisibleAt(id)) this.count(bm, -1); bm.deleteInstance(id); }

  /** Réserve des lots ramenée à la place utilisée (après le chargement : la croissance par doublement en laisse ≈ la moitié). */
  compact(): void { for (const bm of this.pools.values()) compactBatch(bm); }

  /** Lots (diagnostic) : nombre de BatchedMesh et d'instances. */
  stats(): { meshes: number; instances: number } {
    let instances = 0;
    for (const bm of this.pools.values()) instances += bm.instanceCount;
    return { meshes: this.pools.size, instances };
  }

  dispose(): void {
    for (const bm of this.pools.values()) { bm.removeFromParent(); bm.dispose(); }
    this.pools.clear();
  }
}
