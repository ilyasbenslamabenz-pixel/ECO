/**
 * Rendu du terrain : un maillage par chunk (frustum culling natif par chunk),
 * normales calculées sur la carte complète (pas de couture entre chunks),
 * coloration par altitude/pente. Implémente IRenderTerrain.
 * À enrichir par l'agent terrain : textures PBR Poly Haven (herbe, terre, roche) en splatting, LOD de chunks.
 */
import * as THREE from 'three';
import { CHUNK_TILES } from '../shared/constants';
import type { IRenderTerrain, TerrainData } from '../shared/contracts';
import { terrainHeightAt } from '../shared/terrain-gen';
import { clamp, smoothstep } from '../shared/math';

export class TerrainRenderer implements IRenderTerrain {
  readonly group = new THREE.Group();
  private data: TerrainData | null = null;
  private material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });

  constructor(scene: THREE.Scene) {
    this.group.name = 'terrain';
    scene.add(this.group);
  }

  build(t: TerrainData): void {
    this.clear();
    this.data = t;
    const W = t.samplesX;
    const H = t.samplesZ;
    // Normales globales par différences centrales.
    const normals = new Float32Array(W * H * 3);
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const hl = t.heights[j * W + Math.max(0, i - 1)]!;
        const hr = t.heights[j * W + Math.min(W - 1, i + 1)]!;
        const hd = t.heights[Math.max(0, j - 1) * W + i]!;
        const hu = t.heights[Math.min(H - 1, j + 1) * W + i]!;
        const nx = hl - hr;
        const nz = hd - hu;
        const ny = 2 * t.spacing;
        const len = Math.hypot(nx, ny, nz);
        const k = (j * W + i) * 3;
        normals[k] = nx / len; normals[k + 1] = ny / len; normals[k + 2] = nz / len;
      }
    }
    const grass = new THREE.Color(0x4a6a2c);
    const grassDry = new THREE.Color(0x8a8a4a);
    const sand = new THREE.Color(0xc2b280);
    const rock = new THREE.Color(0x7a746b);
    const c = new THREE.Color();
    const chunksX = Math.ceil((W - 1) / CHUNK_TILES);
    const chunksZ = Math.ceil((H - 1) / CHUNK_TILES);
    for (let cz = 0; cz < chunksZ; cz++) {
      for (let cx = 0; cx < chunksX; cx++) {
        const i0 = cx * CHUNK_TILES;
        const j0 = cz * CHUNK_TILES;
        const nI = Math.min(CHUNK_TILES, W - 1 - i0) + 1;
        const nJ = Math.min(CHUNK_TILES, H - 1 - j0) + 1;
        const pos = new Float32Array(nI * nJ * 3);
        const nor = new Float32Array(nI * nJ * 3);
        const col = new Float32Array(nI * nJ * 3);
        for (let j = 0; j < nJ; j++) {
          for (let i = 0; i < nI; i++) {
            const gi = i0 + i;
            const gj = j0 + j;
            const h = t.heights[gj * W + gi]!;
            const v = (j * nI + i) * 3;
            pos[v] = t.originX + gi * t.spacing;
            pos[v + 1] = h;
            pos[v + 2] = t.originZ + gj * t.spacing;
            const g = (gj * W + gi) * 3;
            nor[v] = normals[g]!; nor[v + 1] = normals[g + 1]!; nor[v + 2] = normals[g + 2]!;
            const slope = 1 - normals[g + 1]!;
            c.copy(grass).lerp(grassDry, clamp((h - 10) / 40, 0, 1) * 0.7);
            c.lerp(sand, 1 - smoothstep(t.waterLevel + 0.5, t.waterLevel + 3, h));
            c.lerp(rock, smoothstep(0.12, 0.35, slope));
            col[v] = c.r; col[v + 1] = c.g; col[v + 2] = c.b;
          }
        }
        const idx: number[] = [];
        for (let j = 0; j < nJ - 1; j++) {
          for (let i = 0; i < nI - 1; i++) {
            const a = j * nI + i;
            const b = a + 1;
            const d = a + nI;
            const e = d + 1;
            idx.push(a, d, b, b, d, e);
          }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        geo.setIndex(idx);
        geo.computeBoundingSphere();
        geo.computeBoundingBox();
        const mesh = new THREE.Mesh(geo, this.material);
        mesh.name = `terrain_chunk_${cx}_${cz}`;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        this.group.add(mesh);
      }
    }
  }

  heightAt(x: number, z: number): number {
    return this.data ? terrainHeightAt(this.data, x, z) : 0;
  }

  private clear(): void {
    for (const m of this.group.children) (m as THREE.Mesh).geometry.dispose();
    this.group.clear();
  }

  dispose(): void {
    this.clear();
    this.material.dispose();
    this.group.removeFromParent();
  }
}
