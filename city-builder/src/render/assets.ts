/**
 * Bibliothèque d'assets : charge le catalogue JSON et les GLB (GLTFLoader) avec
 * cache et déduplication des requêtes. Implémente IAssetLibrary<THREE.Group>.
 * Les modèles chargés sont partagés : cloner (ou instancier) avant de modifier.
 * Propriétaire : agent assets (chargement) / agent bâtiments (usage instancié).
 */
import * as THREE from 'three';
import { createGltfLoader } from './gzip-assets';
import { capModelTextures, imageLimits, liteTextureUrl } from './image-cap';
import { traceStep } from '../boot-trace';
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

/** Gestionnaire de chargement : adresses normalisées ; en mode allégé, textures communes en 256 px (liteTextureUrl). */
function liteManager(): THREE.LoadingManager {
  const m = new THREE.LoadingManager();
  // Adresse normalisée (« …/residential/../../textures/x.webp » -> « …/textures/x.webp ») : sinon le cache
  // d'images de three ne reconnaît pas une texture commune et la redécode pour chaque modèle (×12 mesuré).
  m.setURLModifier((u) => { let n = u; try { n = new URL(u, globalThis.location?.href).href; } catch { /* adresse non standard */ } return liteTextureUrl(n); });
  return m;
}

export class AssetLibrary implements IAssetLibrary<THREE.Group> {
  private loader = createGltfLoader(liteManager());
  private cache = new Map<string, Promise<THREE.Group>>();
  private loaded = new Set<string>();
  private byId: Map<string, CatalogAsset>;
  /** File des chargements GLB (mode allégé : un modèle à la fois, pic mémoire borné). */
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  private async slot(): Promise<void> {
    if (this.active < imageLimits.maxConcurrentModels) { this.active++; return; }
    await new Promise<void>((r) => this.waiting.push(r));
    this.active++;
  }
  private release(): void { this.active--; this.waiting.shift()?.(); }

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
      p = this.slot().then(() => { traceStep(`modèle ${l.file.split('/').pop()}`); return this.loader.loadAsync(this.url(l.file)); }).then((gltf) => {
        const root = gltf.scene;
        // Mode allégé : images réduites dès le chargement, originaux libérés (arbres : plafond plus haut).
        capModelTextures(root, a.category === 'tree' ? imageLimits.treeTextureCap : imageLimits.textureCap);
        root.name = `${assetId}_lod${lod}`;
        root.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) { dequantizeGeometry(m.geometry); m.castShadow = true; m.receiveShadow = true; }
        });
        this.loaded.add(key);
        this.release();
        return root;
      }, (e: unknown) => { this.release(); throw e; });
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
