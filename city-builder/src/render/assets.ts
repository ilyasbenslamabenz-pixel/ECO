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

/** Catégories chargées en priorité sur téléphone (ce que le joueur pose et regarde). */
const BUILDING_CATS = new Set(['house', 'townhouse', 'apartment_low', 'apartment_mid', 'apartment_high', 'skyscraper', 'commercial', 'industrial', 'public', 'transport']);

/** Image 1×1 (remplace les cartes retirées en qualité Basse : une seule entrée de cache pour toutes). */
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

/** Gestionnaire de chargement : adresses normalisées ; en mode allégé, textures communes en 256 px (liteTextureUrl). */
function liteManager(): THREE.LoadingManager {
  const m = new THREE.LoadingManager();
  // Adresse normalisée (« …/residential/../../textures/x.webp » -> « …/textures/x.webp ») : sinon le cache
  // d'images de three ne reconnaît pas une texture commune et la redécode pour chaque modèle (×12 mesuré).
  m.setURLModifier((u) => {
    let n = u; try { n = new URL(u, globalThis.location?.href).href; } catch { /* adresse non standard */ }
    // Qualité Basse : relief et ARM jamais téléchargés ni décodés (retirés des matériaux ensuite).
    if (imageLimits.colorMapsOnly && /(^|\/)assets\/(textures|buildings)\/.*_(normal|arm)\.webp(\?|$)/.test(n)) return TINY_PNG;
    return liteTextureUrl(n);
  });
  return m;
}

export class AssetLibrary implements IAssetLibrary<THREE.Group> {
  private loader = createGltfLoader(liteManager());
  private cache = new Map<string, Promise<THREE.Group>>();
  private loaded = new Set<string>();
  private byId: Map<string, CatalogAsset>;
  /** File des chargements GLB (mode allégé : un modèle à la fois, pic mémoire borné). */
  private active = 0;
  /** File d'attente : priorité 0 (bâtiments) avant 1 (décors, mobilier, véhicules), puis ordre d'arrivée. */
  private readonly waiting: { p: number; r: () => void }[] = [];
  private async slot(priority = 1): Promise<void> {
    if (this.active < imageLimits.maxConcurrentModels) { this.active++; return; }
    await new Promise<void>((r) => {
      const i = this.waiting.findIndex((w) => w.p > priority);
      if (i < 0) this.waiting.push({ p: priority, r }); else this.waiting.splice(i, 0, { p: priority, r });
    });
    this.active++;
  }
  private release(): void { this.active--; this.waiting.shift()?.r(); }

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
      let released = false;
      const free = (): void => { if (!released) { released = true; this.release(); } };
      const prio = BUILDING_CATS.has(a.category) ? 0 : 1;
      p = this.slot(prio).then(() => { traceStep(`modèle ${l.file.split('/').pop()}`); return this.loader.loadAsync(this.url(l.file)); }).then((gltf) => {
        // Libère toujours la place dans la file (une erreur ici bloquait tous les chargements suivants).
        try { return this.finishModel(gltf, a, assetId, lod, l.file, key); } finally { free(); }
      }, (e: unknown) => { free(); throw e; });
      p.catch(() => this.cache.delete(key));
      this.cache.set(key, p);
    }
    return p;
  }

  private finishModel(gltf: { scene: THREE.Group }, a: CatalogAsset, assetId: string, lod: number, file: string, key: string): THREE.Group {
        const root = gltf.scene;
        const l = { file };
        const short = l.file.split('/').pop()?.replace('.glb', '') ?? l.file;
        traceStep(`${short} chargé`);
        // Mode allégé : images réduites dès le chargement, originaux libérés (arbres : plafond plus haut).
        capModelTextures(root, a.category === 'tree' ? imageLimits.treeTextureCap : imageLimits.textureCap);
        root.name = `${assetId}_lod${lod}`;
        root.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) { dequantizeGeometry(m.geometry); m.castShadow = true; m.receiveShadow = true; }
        });
        this.loaded.add(key);
        // Journal de plantage : étape franchie quand une image a été dessinée après ce modèle (affichage,
        // compilation des shaders) — distingue un arrêt au chargement d'un arrêt au rendu.
        traceStep(`${short} prêt`);
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(() => traceStep(`${short} affiché`)));
        return root;
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
