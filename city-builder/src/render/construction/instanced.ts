/**
 * Pools d'instances des modèles de chantier (rendu) — propriété p2a-chantiers.
 *
 * Un pool par (modèle, LOD, partie) : un `InstancedMesh` dont le tampon de matrices est réécrit
 * seulement quand la scène des chantiers change (`begin()` … `push()` … `end()`). Les éléments
 * répétitifs (palissades, travées d'échafaudage, tas, baraques, éléments de mât) passent tous par là :
 * un chantier coûte quelques instances, pas quelques dizaines d'objets.
 */
import * as THREE from 'three';
import type { ConstructionAssets, ModelPart } from './assets';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

interface Pool {
  key: string;
  parts: ModelPart[];
  meshes: THREE.InstancedMesh[];
  /** 16 flottants par instance (matrices écrites pendant la passe courante). */
  mats: Float32Array;
  count: number;
  capacity: number;
}

export class InstancePools {
  private readonly pools = new Map<string, Pool>();
  readonly group = new THREE.Group();
  /** Instances dessinées à la dernière passe (diagnostic). */
  drawn = 0;

  constructor(private readonly assets: ConstructionAssets, parent: THREE.Object3D, private readonly castShadow = true) {
    this.group.name = 'chantiers-instances';
    parent.add(this.group);
  }

  /** Démarre une passe : tous les pools repartent à zéro instance. */
  begin(): void {
    this.drawn = 0;
    for (const p of this.pools) p[1].count = 0;
  }

  /**
   * Ajoute une instance du modèle `id` au LOD `lod`, posée en (x, y, z), tournée de `rotY` (radians),
   * éventuellement mise à l'échelle. Sans effet tant que le modèle n'est pas chargé.
   */
  push(id: string, lod: number, x: number, y: number, z: number, rotY: number, sx = 1, sy = 1, sz = 1): void {
    const key = `${id}#${lod}`;
    let pool = this.pools.get(key);
    if (!pool) {
      const parts = this.assets.partsOf(id, lod);
      if (!parts || parts.length === 0) return;
      pool = { key, parts, meshes: [], mats: new Float32Array(16 * 8), count: 0, capacity: 8 };
      this.pools.set(key, pool);
      this.alloc(pool);
    }
    if (pool.count >= pool.capacity) this.grow(pool, pool.capacity * 2);
    _q.setFromAxisAngle(_up, rotY);
    _p.set(x, y, z);
    _s.set(sx, sy, sz);
    _m.compose(_p, _q, _s).toArray(pool.mats, pool.count * 16);
    pool.count++;
    this.drawn++;
  }

  /** Termine la passe : recopie les matrices dans les InstancedMesh et ajuste les compteurs. */
  end(): void {
    for (const pool of this.pools.values()) {
      for (const mesh of pool.meshes) {
        const arr = mesh.instanceMatrix.array as Float32Array;
        arr.set(pool.mats.subarray(0, pool.count * 16));
        mesh.count = pool.count;
        mesh.visible = pool.count > 0;
        mesh.instanceMatrix.needsUpdate = true;
      }
    }
  }

  private alloc(pool: Pool): void {
    for (const mesh of pool.meshes) { mesh.removeFromParent(); mesh.dispose(); }
    pool.meshes = pool.parts.map((part) => {
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, pool.capacity);
      mesh.name = `chantier_${pool.key}_${part.role}`;
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.visible = false;
      mesh.castShadow = this.castShadow && part.role !== 'filet';
      mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(mesh);
      return mesh;
    });
  }

  private grow(pool: Pool, capacity: number): void {
    const mats = new Float32Array(capacity * 16);
    mats.set(pool.mats);
    pool.mats = mats;
    pool.capacity = capacity;
    this.alloc(pool);
  }

  /** Nombre d'InstancedMesh actuellement visibles (diagnostic e2e). */
  stats(): { pools: number; meshes: number; instances: number } {
    let meshes = 0, instances = 0;
    for (const p of this.pools.values()) {
      if (p.count === 0) continue;
      meshes += p.meshes.length;
      instances += p.count;
    }
    return { pools: this.pools.size, meshes, instances };
  }

  dispose(): void {
    for (const pool of this.pools.values()) for (const mesh of pool.meshes) { mesh.removeFromParent(); mesh.dispose(); }
    this.pools.clear();
    this.group.removeFromParent();
  }
}
