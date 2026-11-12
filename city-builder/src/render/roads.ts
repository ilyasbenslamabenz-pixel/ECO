/**
 * Rendu des routes. Version de fondation : ruban de chaussée posé sur le terrain
 * par tronçon (géométrie fonctionnelle, sans marquage ni intersection).
 * À remplacer par l'agent routes : maillage avec trottoirs, marquages, carrefours,
 * textures PBR asphalte Poly Haven, instancing des lampadaires.
 * Implémente IRoadRenderer.
 */
import * as THREE from 'three';
import { ROAD_TYPES, type IRoadRenderer, type RoadEdgeRecord, type RoadNodeRecord } from '../shared/contracts';

export class RoadRenderer implements IRoadRenderer {
  readonly group = new THREE.Group();
  private nodes = new Map<number, RoadNodeRecord>();
  private meshes = new Map<number, THREE.Mesh>();
  private material = new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.9, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });

  constructor(scene: THREE.Scene, private heightAt: (x: number, z: number) => number) {
    this.group.name = 'roads';
    scene.add(this.group);
  }

  addRoads(nodes: readonly RoadNodeRecord[], edges: readonly RoadEdgeRecord[]): void {
    for (const n of nodes) this.nodes.set(n.id, n);
    for (const e of edges) {
      const a = this.nodes.get(e.a);
      const b = this.nodes.get(e.b);
      if (!a || !b) continue;
      const w = ROAD_TYPES[e.type].width;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      const nx = -dz / len * (w / 2);
      const nz = dx / len * (w / 2);
      const steps = Math.max(1, Math.ceil(len / 4));
      const pos = new Float32Array((steps + 1) * 2 * 3);
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const cx = a.x + dx * t;
        const cz = a.z + dz * t;
        for (let side = 0; side < 2; side++) {
          const sx = cx + (side === 0 ? nx : -nx);
          const sz = cz + (side === 0 ? nz : -nz);
          const k = (s * 2 + side) * 3;
          pos[k] = sx; pos[k + 1] = this.heightAt(sx, sz) + 0.15; pos[k + 2] = sz;
        }
      }
      const idx: number[] = [];
      for (let s = 0; s < steps; s++) {
        const i = s * 2;
        idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, this.material);
      mesh.receiveShadow = true;
      mesh.name = `road_${e.id}`;
      this.group.add(mesh);
      this.meshes.set(e.id, mesh);
    }
  }

  removeRoadEdges(ids: readonly number[]): void {
    for (const id of ids) {
      const m = this.meshes.get(id);
      if (!m) continue;
      m.geometry.dispose();
      this.group.remove(m);
      this.meshes.delete(id);
    }
  }

  dispose(): void {
    this.removeRoadEdges([...this.meshes.keys()]);
    this.material.dispose();
    this.group.removeFromParent();
  }
}
