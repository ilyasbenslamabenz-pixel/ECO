/**
 * Bibliothèque d'assets : charge le catalogue JSON et les GLB (GLTFLoader) avec
 * cache et déduplication des requêtes. Implémente IAssetLibrary<THREE.Group>.
 * Les modèles chargés sont partagés : cloner (ou instancier) avant de modifier.
 * Propriétaire : agent assets (chargement) / agent bâtiments (usage instancié).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { AssetCatalog, CatalogAsset } from '../shared/catalog';
import type { IAssetLibrary } from '../shared/contracts';

export async function fetchCatalog(assetsBase: URL): Promise<AssetCatalog> {
  const res = await fetch(new URL('catalog.json', assetsBase));
  if (!res.ok) throw new Error(`Catalogue d'assets introuvable (${res.status})`);
  return (await res.json()) as AssetCatalog;
}

/**
 * Convertit en float32 les attributs géométriques quantifiés (positions, normales, tangentes) (KHR_mesh_quantization / meshopt : entiers normalisés ou non).
 * Les transformations de nœud (échelle/translation de déquantification) sont conservées : les consommateurs
 * qui « cuisent » `matrixWorld` dans la géométrie (applyMatrix4) obtiennent ainsi des valeurs exactes, sans
 * saturation d'un entier normalisé. Coût mémoire assumé (les géométries sont partagées par instanciation).
 */
export function dequantizeGeometry(g: THREE.BufferGeometry): void {
  for (const name of Object.keys(g.attributes)) {
    // Les UV restent telles quelles : applyMatrix4 ne les touche pas, et le rendu des bâtiments applique lui-même
    // la plage `uvq` du kit aux UV quantifiées.
    if (name.startsWith('uv')) continue;
    const a = g.attributes[name] as THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
    const isIL = (a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute === true;
    if (!isIL && (a as THREE.BufferAttribute).array instanceof Float32Array && !a.normalized) continue;
    const n = a.count, s = a.itemSize;
    const out = new Float32Array(n * s);
    for (let i = 0; i < n; i++) {
      out[i * s] = a.getX(i);
      if (s > 1) out[i * s + 1] = a.getY(i);
      if (s > 2) out[i * s + 2] = a.getZ(i);
      if (s > 3) out[i * s + 3] = a.getW(i);
    }
    g.setAttribute(name, new THREE.BufferAttribute(out, s, false));
  }
}

export class AssetLibrary implements IAssetLibrary<THREE.Group> {
  private loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  private cache = new Map<string, Promise<THREE.Group>>();
  private loaded = new Set<string>();
  private byId: Map<string, CatalogAsset>;

  constructor(readonly catalog: AssetCatalog, private readonly base: URL) {
    this.byId = new Map(catalog.assets.map((a) => [a.id, a]));
  }

  get(assetId: string): CatalogAsset | undefined { return this.byId.get(assetId); }

  /** URL absolue d'un fichier relatif au dossier assets. */
  url(file: string): string { return new URL(file, this.base).href; }

  load(assetId: string, lod = 0): Promise<THREE.Group> {
    const a = this.byId.get(assetId);
    if (!a) return Promise.reject(new Error(`Asset inconnu : ${assetId}`));
    const l = a.lods[Math.min(lod, a.lods.length - 1)];
    if (!l) return Promise.reject(new Error(`Asset sans LOD : ${assetId}`));
    const key = l.file;
    let p = this.cache.get(key);
    if (!p) {
      p = this.loader.loadAsync(this.url(l.file)).then((gltf) => {
        const root = gltf.scene;
        root.name = `${assetId}_lod${lod}`;
        root.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) { dequantizeGeometry(m.geometry); m.castShadow = true; m.receiveShadow = true; }
        });
        this.loaded.add(key);
        return root;
      });
      p.catch(() => this.cache.delete(key));
      this.cache.set(key, p);
    }
    return p;
  }

  isLoaded(assetId: string, lod = 0): boolean {
    const a = this.byId.get(assetId);
    const l = a?.lods[Math.min(lod, a.lods.length - 1)];
    return !!l && this.loaded.has(l.file);
  }

  async preload(ids: readonly string[], onProgress?: (done: number, total: number) => void): Promise<void> {
    let done = 0;
    await Promise.all(ids.map(async (id) => {
      await this.load(id, 0);
      done++;
      onProgress?.(done, ids.length);
    }));
  }

  dispose(): void {
    for (const p of this.cache.values()) {
      p.then((root) => root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.geometry.dispose();
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats) {
          for (const v of Object.values(mat)) if (v instanceof THREE.Texture) v.dispose();
          mat.dispose();
        }
      })).catch(() => undefined);
    }
    this.cache.clear();
    this.loaded.clear();
  }
}
