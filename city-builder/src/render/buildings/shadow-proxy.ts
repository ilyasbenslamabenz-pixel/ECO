/**
 * Ombres des bâtiments en lots fusionnés (ordinateur) : la carte d'ombre ne dessine plus chaque sous-maillage
 * (façade, toiture, encadrements… ≈ 10 par modèle) de chaque lot, mais une géométrie d'ombre par LOD
 * (positions + indices de tous les sous-maillages opaques fusionnés), rangée dans un `THREE.BatchedMesh` par côté
 * de matériau (avant / arrière / double face). Avec l'extension WEBGL_multi_draw, toutes les ombres de bâtiments
 * tiennent en 1 à 3 appels de rendu au lieu de ≈ 1 000 dans la ville de démonstration ;
 * sans elle, three dessine une instance par appel, toujours bien moins qu'un appel par sous-maillage.
 *
 * Les lots d'ombre sont sur le calque SHADOW_PROXY_LAYER : invisibles pour la caméra (calque 0), vus seulement par
 * la caméra d'ombre du soleil (`enableShadowProxyLayer`). Mêmes instances que le rendu principal : visibles quand le
 * bâtiment est dessiné à un LOD qui projette une ombre (LOD 0 ou 1), masquées sinon ; matrices posées une fois.
 * Les sous-maillages transparents ou découpés (alphaTest) gardent leur propre ombre (silhouette exacte).
 */
import * as THREE from 'three';
import { compactBatch } from './batched-parts';

/** Calque des géométries d'ombre (vu par la caméra d'ombre du soleil, pas par la caméra). */
export const SHADOW_PROXY_LAYER = 1;

/** La caméra d'ombre du soleil voit aussi le calque des géométries d'ombre (calque 0 conservé). */
export function enableShadowProxyLayer(light: THREE.DirectionalLight): void {
  light.shadow.camera.layers.enable(0);
  light.shadow.camera.layers.enable(SHADOW_PROXY_LAYER);
}

/** Vrai si l'ombre d'un sous-maillage peut être fusionnée (opaque, sans découpe ni déplacement). */
export function mergeableForShadow(m: THREE.Material): boolean {
  const s = m as THREE.MeshStandardMaterial;
  return !m.transparent && !(m.alphaTest > 0) && !s.alphaMap && !s.displacementMap && m.visible && !m.alphaToCoverage;
}

/** Fusionne des géométries (positions seules, indices recalés). Les géométries sans indices sont indexées à la suite. */
export function mergePositions(geos: readonly THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  let nv = 0, ni = 0;
  for (const g of geos) {
    const p = g.getAttribute('position');
    if (!p) continue;
    nv += p.count;
    ni += g.index ? g.index.count : p.count;
  }
  if (nv === 0 || ni === 0) return null;
  const pos = new Float32Array(nv * 3);
  const idx = new Uint32Array(ni);
  let vo = 0, io = 0;
  for (const g of geos) {
    const p = g.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!p) continue;
    for (let i = 0; i < p.count; i++) { pos[(vo + i) * 3] = p.getX(i); pos[(vo + i) * 3 + 1] = p.getY(i); pos[(vo + i) * 3 + 2] = p.getZ(i); }
    if (g.index) { const a = g.index; for (let i = 0; i < a.count; i++) idx[io + i] = a.getX(i) + vo; io += a.count; }
    else { for (let i = 0; i < p.count; i++) idx[io + i] = vo + i; io += p.count; }
    vo += p.count;
  }
  const w = weldPositions(pos, idx);
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(w, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

/**
 * Soude les sommets de positions identiques (bit à bit) et réécrit les indices en place. Les modèles dupliquent
 * chaque coin d'une arête vive (une normale et des UV par face) ; l'ombre n'a besoin que des positions :
 * 2 à 3 fois moins de sommets, à l'identique. Table de hachage à adressage ouvert (pas de chaînes, pas de Map).
 */
export function weldPositions(pos: Float32Array, idx: Uint32Array): Float32Array {
  const n = pos.length / 3;
  const bits = new Uint32Array(pos.buffer, pos.byteOffset, pos.length);
  let size = 1;
  while (size < n * 2) size <<= 1;
  const mask = size - 1;
  const table = new Int32Array(size).fill(-1);
  const remap = new Uint32Array(n);
  const ob = new Uint32Array(pos.length);
  let m = 0;
  for (let i = 0; i < n; i++) {
    const x = bits[i * 3]!, y = bits[i * 3 + 1]!, z = bits[i * 3 + 2]!;
    let h = (Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca77) ^ Math.imul(z, 0xc2b2ae3d)) & mask;
    for (;;) {
      const j = table[h]!;
      if (j < 0) { table[h] = m; ob[m * 3] = x; ob[m * 3 + 1] = y; ob[m * 3 + 2] = z; remap[i] = m++; break; }
      if (ob[j * 3] === x && ob[j * 3 + 1] === y && ob[j * 3 + 2] === z) { remap[i] = j; break; }
      h = (h + 1) & mask;
    }
  }
  for (let k = 0; k < idx.length; k++) idx[k] = remap[idx[k]!]!;
  return new Float32Array(ob.buffer.slice(0, m * 12));
}

const _mat = new THREE.Matrix4();
const SIDES = [THREE.FrontSide, THREE.BackSide, THREE.DoubleSide] as const;

/** Lots d'ombre (un par côté de matériau) d'un rendu de bâtiments. */
export class BuildingShadowLayer {
  private readonly meshes: (THREE.BatchedMesh | null)[] = [null, null, null];
  private readonly materials: THREE.MeshBasicMaterial[] = [];

  constructor(private readonly parent: THREE.Object3D) {}

  private mesh(side: number, verts: number, indices: number): THREE.BatchedMesh {
    let bm = this.meshes[side] ?? null;
    if (!bm) {
      const mat = new THREE.MeshBasicMaterial({ side: SIDES[side], colorWrite: false });
      mat.name = 'ombre_batiments';
      this.materials.push(mat);
      bm = new THREE.BatchedMesh(1024, Math.max(1 << 16, verts * 2), Math.max(1 << 17, indices * 2), mat);
      bm.name = `ombres_batiments_${side}`;
      bm.layers.set(SHADOW_PROXY_LAYER);
      bm.castShadow = true;
      bm.receiveShadow = false;
      // Visibilité tenue à jour par le rendu des bâtiments (culling caméra + LOD) : rien à recalculer par image.
      bm.frustumCulled = false;
      bm.perObjectFrustumCulled = false;
      bm.sortObjects = false;
      this.meshes[side] = bm;
      this.parent.add(bm);
    }
    // Agrandissement (copie des tampons) quand la place réservée ne suffit plus.
    if (bm.unusedVertexCount < verts || bm.unusedIndexCount < indices) {
      const usedV = (bm as unknown as { _nextVertexStart: number })._nextVertexStart;
      const usedI = (bm as unknown as { _nextIndexStart: number })._nextIndexStart;
      const maxV = (bm as unknown as { _maxVertexCount: number })._maxVertexCount;
      const maxI = (bm as unknown as { _maxIndexCount: number })._maxIndexCount;
      bm.setGeometrySize(Math.max(maxV * 2, usedV + verts * 2), Math.max(maxI * 2, usedI + indices * 2));
    }
    return bm;
  }

  /**
   * Géométries d'ombre d'un LOD : sous-maillages fusionnés par côté de matériau. Renvoie l'identifiant de géométrie
   * par côté (−1 : aucun sous-maillage de ce côté).
   */
  addLod(parts: readonly { geometry: THREE.BufferGeometry; side: THREE.Side }[]): Int32Array {
    const ids = new Int32Array(3).fill(-1);
    for (let s = 0; s < 3; s++) {
      const geo = mergePositions(parts.filter((p) => p.side === SIDES[s]).map((p) => p.geometry));
      if (!geo) continue;
      const bm = this.mesh(s, geo.getAttribute('position').count, geo.index!.count);
      ids[s] = bm.addGeometry(geo);
      geo.dispose();
    }
    return ids;
  }

  /** Nouvelle instance d'ombre (matrice lue dans `mats` à `offset`), visible avec la géométrie `geom`. */
  addInstance(side: number, geom: number, mats: Float32Array, offset: number): number {
    const bm = this.meshes[side]!;
    if (bm.instanceCount >= bm.maxInstanceCount) bm.setInstanceCount(bm.maxInstanceCount * 2);
    const id = bm.addInstance(geom);
    _mat.fromArray(mats, offset);
    bm.setMatrixAt(id, _mat);
    return id;
  }

  /** Change la géométrie d'une instance (LOD) et la rend visible. */
  show(side: number, id: number, geom: number): void {
    const bm = this.meshes[side]!;
    if (bm.getGeometryIdAt(id) !== geom) bm.setGeometryIdAt(id, geom);
    bm.setVisibleAt(id, true);
  }

  hide(side: number, id: number): void { this.meshes[side]!.setVisibleAt(id, false); }

  remove(side: number, id: number): void { this.meshes[side]!.deleteInstance(id); }

  /** Réserve des lots ramenée à la place utilisée (après le chargement). */
  compact(): void { for (const bm of this.meshes) if (bm) compactBatch(bm); }

  /** Nombre d'instances d'ombre visibles (diagnostic). */
  stats(): { meshes: number; instances: number } {
    let meshes = 0, instances = 0;
    for (const bm of this.meshes) if (bm) { meshes++; instances += bm.instanceCount; }
    return { meshes, instances };
  }

  dispose(): void {
    for (const bm of this.meshes) if (bm) { bm.removeFromParent(); bm.dispose(); }
    for (const m of this.materials) m.dispose();
    this.meshes.fill(null);
  }
}
