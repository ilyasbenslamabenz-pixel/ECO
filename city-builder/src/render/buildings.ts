/**
 * Rendu des bâtiments par InstancedMesh : un lot par (asset, sous-maillage).
 * Version de fondation : LOD0 uniquement, frustum culling par lot.
 * À compléter par l'agent bâtiments : sélection de LOD par distance, variantes
 * (instanceColor / jeux de textures), culling par chunk, animation de construction.
 * Implémente IBuildingRenderer. Aucune allocation dans update().
 */
import * as THREE from 'three';
import type { BuildingRecord, IBuildingRenderer } from '../shared/contracts';
import { rotAngle } from '../shared/footprint';
import type { AssetLibrary } from './assets';

interface SubMesh { geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[]; local: THREE.Matrix4; inst: THREE.InstancedMesh | null }
interface Batch {
  assetId: string;
  ready: boolean;
  subs: SubMesh[];
  ids: number[];
  matrices: THREE.Matrix4[];
  capacity: number;
  dirty: boolean;
}

const tmp = new THREE.Matrix4();
const q = new THREE.Quaternion();
const up = new THREE.Vector3(0, 1, 0);
const one = new THREE.Vector3(1, 1, 1);
const p = new THREE.Vector3();

export class BuildingRenderer implements IBuildingRenderer {
  readonly group = new THREE.Group();
  private batches = new Map<string, Batch>();
  private idToAsset = new Map<number, string>();

  constructor(scene: THREE.Scene, private lib: AssetLibrary) {
    this.group.name = 'buildings';
    scene.add(this.group);
  }

  get count(): number { return this.idToAsset.size; }

  add(records: readonly BuildingRecord[]): void {
    for (const r of records) {
      let b = this.batches.get(r.assetId);
      if (!b) {
        b = { assetId: r.assetId, ready: false, subs: [], ids: [], matrices: [], capacity: 0, dirty: true };
        this.batches.set(r.assetId, b);
        this.loadBatch(b);
      }
      q.setFromAxisAngle(up, rotAngle(r.rot));
      p.set(r.x, r.y, r.z);
      b.ids.push(r.id);
      b.matrices.push(new THREE.Matrix4().compose(p, q, one));
      b.dirty = true;
      this.idToAsset.set(r.id, r.assetId);
    }
    this.flush();
  }

  remove(ids: readonly number[]): void {
    for (const id of ids) {
      const aid = this.idToAsset.get(id);
      if (!aid) continue;
      const b = this.batches.get(aid)!;
      const i = b.ids.indexOf(id);
      const last = b.ids.length - 1;
      b.ids[i] = b.ids[last]!;
      b.matrices[i] = b.matrices[last]!;
      b.ids.pop();
      b.matrices.pop();
      b.dirty = true;
      this.idToAsset.delete(id);
    }
    this.flush();
  }

  private loadBatch(b: Batch): void {
    this.lib.load(b.assetId, 0).then((root) => {
      root.updateMatrixWorld(true);
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) b.subs.push({ geometry: m.geometry, material: m.material, local: m.matrixWorld.clone(), inst: null });
      });
      b.ready = true;
      b.dirty = true;
      this.flush();
    }).catch((e: unknown) => {
      console.error(`Chargement du modèle ${b.assetId} impossible`, e);
    });
  }

  private flush(): void {
    for (const b of this.batches.values()) {
      if (!b.dirty || !b.ready) continue;
      const n = b.ids.length;
      if (n > b.capacity) {
        b.capacity = Math.max(16, 1 << Math.ceil(Math.log2(n)));
        for (const s of b.subs) {
          if (s.inst) { this.group.remove(s.inst); s.inst.dispose(); }
          s.inst = new THREE.InstancedMesh(s.geometry, s.material, b.capacity);
          s.inst.name = `bat_${b.assetId}`;
          s.inst.castShadow = true;
          s.inst.receiveShadow = true;
          s.inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          this.group.add(s.inst);
        }
      }
      for (const s of b.subs) {
        const inst = s.inst!;
        for (let i = 0; i < n; i++) inst.setMatrixAt(i, tmp.multiplyMatrices(b.matrices[i]!, s.local));
        inst.count = n;
        inst.instanceMatrix.needsUpdate = true;
        inst.computeBoundingSphere();
      }
      b.dirty = false;
    }
  }

  update(_cx: number, _cy: number, _cz: number): void {
    // LOD par distance : à implémenter par l'agent bâtiments (phase 1).
  }

  dispose(): void {
    for (const b of this.batches.values()) for (const s of b.subs) s.inst?.dispose();
    this.batches.clear();
    this.idToAsset.clear();
    this.group.removeFromParent();
  }
}
