/**
 * Décor urbain de présentation (mobilier, petits éléments) : modèles GLB du catalogue instanciés
 * (un InstancedMesh par modèle et sous-maillage, LOD0, géométrie et matériaux partagés).
 * Utilisé par la scène de démonstration (square, parc) ; ces objets ne sont pas des entités simulées
 * (le placement des décors par le joueur est prévu en phase 2).
 */
import * as THREE from 'three';
import type { AssetLibrary } from './assets';

export interface PropItem { assetId: string; x: number; z: number; rot: number }

export class PropLayer {
  readonly group = new THREE.Group();
  private readonly meshes: THREE.InstancedMesh[] = [];
  /** Instances posées par modèle (diagnostic / porte de validation). */
  readonly counts = new Map<string, number>();

  constructor(scene: THREE.Scene, private readonly lib: AssetLibrary) {
    this.group.name = 'decor_urbain';
    scene.add(this.group);
  }

  async add(items: readonly PropItem[], heightAt: (x: number, z: number) => number): Promise<void> {
    const byAsset = new Map<string, PropItem[]>();
    for (const it of items) {
      if (!this.lib.get(it.assetId)) continue;
      let l = byAsset.get(it.assetId);
      if (!l) { l = []; byAsset.set(it.assetId, l); }
      l.push(it);
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
    const up = new THREE.Vector3(0, 1, 0);
    await Promise.all([...byAsset].map(async ([id, list]) => {
      const root = await this.lib.load(id, 0);
      root.updateMatrixWorld(true);
      const parts: { g: THREE.BufferGeometry; mat: THREE.Material | THREE.Material[] }[] = [];
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const g = mesh.geometry.clone();
        g.applyMatrix4(mesh.matrixWorld);
        parts.push({ g, mat: mesh.material });
      });
      for (const part of parts) {
        const im = new THREE.InstancedMesh(part.g, part.mat, list.length);
        im.name = `decor_${id}`;
        im.castShadow = true;
        im.receiveShadow = true;
        list.forEach((it, i) => {
          q.setFromAxisAngle(up, (it.rot & 3) * (Math.PI / 2));
          p.set(it.x, heightAt(it.x, it.z), it.z);
          im.setMatrixAt(i, m.compose(p, q, s));
        });
        im.instanceMatrix.needsUpdate = true;
        im.computeBoundingSphere();
        this.group.add(im);
        this.meshes.push(im);
      }
      this.counts.set(id, (this.counts.get(id) ?? 0) + list.length);
    }));
  }

  clear(): void {
    for (const im of this.meshes) { im.geometry.dispose(); this.group.remove(im); }
    this.meshes.length = 0;
    this.counts.clear();
  }
}
