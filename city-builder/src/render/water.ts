/**
 * Plan d'eau au niveau WATER_LEVEL. Version de fondation (matériau physique
 * transparent) ; l'agent environnement le remplacera par une eau animée avec normales Poly Haven.
 */
import * as THREE from 'three';
import type { TerrainData } from '../shared/contracts';

export class WaterRenderer {
  private mesh: THREE.Mesh | null = null;
  constructor(private scene: THREE.Scene) {}

  build(t: TerrainData): void {
    this.dispose();
    const sizeX = (t.samplesX - 1) * t.spacing;
    const sizeZ = (t.samplesZ - 1) * t.spacing;
    const geo = new THREE.PlaneGeometry(sizeX, sizeZ, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshPhysicalMaterial({ color: 0x2f5d73, roughness: 0.08, metalness: 0, transmission: 0, transparent: true, opacity: 0.86, clearcoat: 1 });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = 'water';
    this.mesh.position.set(t.originX + sizeX / 2, t.waterLevel, t.originZ + sizeZ / 2);
    this.mesh.receiveShadow = true;
    this.scene.add(this.mesh);
  }

  dispose(): void {
    if (!this.mesh) return;
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.scene.remove(this.mesh);
    this.mesh = null;
  }
}
