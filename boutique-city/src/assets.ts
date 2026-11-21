/**
 * CONFIG puis ASSETS : modèles 3D (Kenney, CC0 — voir models/CREDITS.txt).
 * Chargement unique par GLTFLoader + LoadingManager (barre de progression), puis clones : SkeletonUtils.clone pour
 * les personnages animés, clone simple sinon ; géométrie fusionnée pour les bâtiments instanciés. Mise à l'échelle
 * automatique par boîte englobante (Box3). Un modèle absent ou en erreur n'empêche rien : le jeu garde alors la
 * forme faite en code (chaque appel rend null). Dépend de three.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/* ------------------------------ CONFIG ------------------------------ */

export const CONFIG = {
  /** Dossier des modèles, relatif à la page. */
  modelsDir: 'models/',
  /** Taille d'un personnage non joueur (m) : modèles « mini » à grosse tête, plus petits que le joueur pour garder
   * une largeur d'épaules réaliste (≈ 0,5 m). */
  npcHeight: 1.0,
  /** Délai maximal du chargement avant de jouer avec les formes faites en code (ms). */
  loadTimeoutMs: 25000,
} as const;

/* ------------------------------ ASSETS ------------------------------ */

export type AssetKind = 'batiment' | 'meuble' | 'personnage' | 'vehicule' | 'produit';
export interface AssetDef {
  file: string;
  kind: AssetKind;
  /** Facteur d'échelle appliqué après l'ajustement automatique. */
  scale: number;
  /** Rotation (quarts de tour) pour que la face avant regarde vers +z (meubles, bâtiments) ou −z (personnages). */
  rot: number;
}

export const ASSETS: Record<string, AssetDef> = {
  // City Kit (Commercial) : bâtiments du quartier, choisis selon la hauteur et le loyer.
  'bat.a': { file: 'building-a.glb', kind: 'batiment', scale: 1, rot: 0 },
  'bat.d': { file: 'building-d.glb', kind: 'batiment', scale: 1, rot: 0 },
  'bat.f': { file: 'building-f.glb', kind: 'batiment', scale: 1, rot: 0 },
  'bat.h': { file: 'building-h.glb', kind: 'batiment', scale: 1, rot: 0 },
  'bat.l': { file: 'building-l.glb', kind: 'batiment', scale: 1, rot: 0 },
  'bat.b': { file: 'building-b.glb', kind: 'batiment', scale: 1, rot: 0 },
  'bat.e': { file: 'building-e.glb', kind: 'batiment', scale: 1, rot: 0 },
  'bat.g': { file: 'building-g.glb', kind: 'batiment', scale: 1, rot: 0 },
  // City Kit Suburban : petits immeubles d'habitation.
  'maison.a': { file: 'house-a.glb', kind: 'batiment', scale: 1, rot: 0 },
  'maison.c': { file: 'house-c.glb', kind: 'batiment', scale: 1, rot: 0 },
  'maison.g': { file: 'house-g.glb', kind: 'batiment', scale: 1, rot: 0 },
  'maison.k': { file: 'house-k.glb', kind: 'batiment', scale: 1, rot: 0 },
  // City Kit Roads : lampadaire (rue, allumé la nuit).
  'rue.lampadaire': { file: 'streetlight.glb', kind: 'meuble', scale: 1, rot: 0 },
  // Car Kit : circulation et camionnette du joueur.
  'auto.berline': { file: 'car-sedan.glb', kind: 'vehicule', scale: 1, rot: 2 },
  'auto.taxi': { file: 'car-taxi.glb', kind: 'vehicule', scale: 1, rot: 2 },
  'auto.camionnette': { file: 'car-van.glb', kind: 'vehicule', scale: 1, rot: 2 },
  'auto.suv': { file: 'car-suv.glb', kind: 'vehicule', scale: 1, rot: 2 },
  'auto.livraison': { file: 'car-delivery.glb', kind: 'vehicule', scale: 1, rot: 2 },
  // Food Kit : marchandise visible sur les présentoirs.
  'produit.pain': { file: 'food-loaf.glb', kind: 'produit', scale: 1, rot: 0 },
  'produit.lait': { file: 'food-carton.glb', kind: 'produit', scale: 1, rot: 0 },
  'produit.fruits': { file: 'food-apple.glb', kind: 'produit', scale: 1, rot: 0 },
  'produit.boissons': { file: 'food-soda.glb', kind: 'produit', scale: 1, rot: 0 },
  'produit.conserves': { file: 'food-can.glb', kind: 'produit', scale: 1, rot: 0 },
  'produit.snacks': { file: 'food-cheese.glb', kind: 'produit', scale: 1, rot: 0 },
  'produit.cafe': { file: 'food-cup.glb', kind: 'produit', scale: 1, rot: 0 },
  'produit.the': { file: 'food-mug.glb', kind: 'produit', scale: 1, rot: 0 },
  'produit.croissant': { file: 'food-croissant.glb', kind: 'produit', scale: 1, rot: 0 },
  'produit.sandwich': { file: 'food-sandwich.glb', kind: 'produit', scale: 1, rot: 0 },
  'produit.jus': { file: 'food-lemon.glb', kind: 'produit', scale: 1, rot: 0 },
  'produit.plantes': { file: 'pottedPlant.glb', kind: 'produit', scale: 1, rot: 0 },
  'bat.tour-a': { file: 'building-skyscraper-a.glb', kind: 'batiment', scale: 1, rot: 0 },
  'bat.tour-b': { file: 'building-skyscraper-b.glb', kind: 'batiment', scale: 1, rot: 0 },
  // Mini Characters : clients et employés animés.
  'perso.f-a': { file: 'character-female-a.glb', kind: 'personnage', scale: 1, rot: 2 },
  'perso.f-c': { file: 'character-female-c.glb', kind: 'personnage', scale: 1, rot: 2 },
  'perso.h-a': { file: 'character-male-a.glb', kind: 'personnage', scale: 1, rot: 2 },
  'perso.h-c': { file: 'character-male-c.glb', kind: 'personnage', scale: 1, rot: 2 },
  'perso.f-d': { file: 'character-female-d.glb', kind: 'personnage', scale: 1, rot: 2 },
  'perso.h-e': { file: 'character-male-e.glb', kind: 'personnage', scale: 1, rot: 2 },
  // Furniture Kit : mobilier des commerces et du logement.
  'meuble.bureau': { file: 'desk.glb', kind: 'meuble', scale: 1, rot: 2 },
  'meuble.ecran': { file: 'computerScreen.glb', kind: 'meuble', scale: 1, rot: 2 },
  'meuble.bibliotheque': { file: 'bookcaseOpen.glb', kind: 'meuble', scale: 1, rot: 2 },
  'meuble.bar': { file: 'kitchenBar.glb', kind: 'meuble', scale: 1, rot: 2 },
  'meuble.placard': { file: 'kitchenCabinet.glb', kind: 'meuble', scale: 1, rot: 2 },
  'meuble.cafetiere': { file: 'kitchenCoffeeMachine.glb', kind: 'meuble', scale: 1, rot: 2 },
  'meuble.table-ronde': { file: 'tableRound.glb', kind: 'meuble', scale: 1, rot: 0 },
  'meuble.chaise': { file: 'chair.glb', kind: 'meuble', scale: 1, rot: 2 },
  'meuble.plante': { file: 'pottedPlant.glb', kind: 'meuble', scale: 1, rot: 0 },
  'meuble.lampe': { file: 'lampRoundFloor.glb', kind: 'meuble', scale: 1, rot: 0 },
  'meuble.tapis': { file: 'rugRectangle.glb', kind: 'meuble', scale: 1, rot: 0 },
  'meuble.lit': { file: 'bedDouble.glb', kind: 'meuble', scale: 1, rot: 2 },
  'meuble.canape': { file: 'loungeSofa.glb', kind: 'meuble', scale: 1, rot: 2 },
  'meuble.frigo': { file: 'kitchenFridgeLarge.glb', kind: 'meuble', scale: 1, rot: 2 },
};

/* ------------------------------ Bibliothèque ------------------------------ */

interface Loaded { scene: THREE.Object3D; animations: THREE.AnimationClip[]; skinned: boolean }

export class AssetLib {
  private readonly loaded = new Map<string, Loaded>();
  readonly failed: string[] = [];
  private readonly mergedCache = new Map<string, { geo: THREE.BufferGeometry; mat: THREE.Material | THREE.Material[] } | null>();
  done = false;

  has(key: string): boolean { return this.loaded.has(key); }
  count(kind?: AssetKind): number { return [...this.loaded.keys()].filter((k) => !kind || ASSETS[k]!.kind === kind).length; }

  /**
   * Charge tous les modèles (progression 0..1). D'abord le paquet models/pack.json (tous les GLB en base64 : la page
   * publiée ne sert pas les .glb), sinon chaque fichier .glb. Ne rejette jamais : les échecs sont listés dans `failed`.
   */
  async load(onProgress: (p: number, label: string) => void, disabled = false): Promise<void> {
    const keys = Object.keys(ASSETS);
    if (disabled) { this.failed.push(...keys); this.done = true; return; }
    const pack = await fetchPack(CONFIG.modelsDir + 'pack.json', (p) => onProgress(p * 0.8, 'paquet de modèles'));
    if (pack) {
      const loader = new GLTFLoader();
      let n = 0;
      for (const key of keys) {
        const def = ASSETS[key]!;
        const b64 = pack[def.file];
        try {
          if (!b64) throw new Error('absent du paquet');
          const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          const gltf = await loader.parseAsync(bin.buffer, '');
          this.register(key, gltf.scene, gltf.animations);
        } catch { this.failed.push(key); }
        onProgress(0.8 + (0.2 * ++n) / keys.length, def.file);
      }
      this.done = true;
      return;
    }
    return this.loadFiles(keys, onProgress);
  }

  private register(key: string, scene: THREE.Object3D, animations: THREE.AnimationClip[]): void {
    let skinned = false;
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; m.geometry.userData['shared'] = true; }
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned = true;
    });
    this.loaded.set(key, { scene, animations, skinned });
  }

  /** Chargement fichier par fichier (GLTFLoader + LoadingManager). */
  private loadFiles(keys: string[], onProgress: (p: number, label: string) => void): Promise<void> {
    return new Promise((resolve) => {
      const manager = new THREE.LoadingManager();
      let finished = false;
      const end = (): void => { if (finished) return; finished = true; this.done = true; resolve(); };
      manager.onProgress = (url, n, total) => onProgress(n / Math.max(1, total), url.split('/').pop() ?? '');
      manager.onLoad = end;
      manager.onError = (url) => onProgress(0, `erreur : ${url}`);
      const loader = new GLTFLoader(manager);
      let pending = keys.length;
      for (const key of keys) {
        const def = ASSETS[key]!;
        loader.load(CONFIG.modelsDir + def.file, (gltf) => {
          this.register(key, gltf.scene, gltf.animations);
          if (--pending === 0) end();
        }, undefined, () => { this.failed.push(key); if (--pending === 0) end(); });
      }
      setTimeout(end, CONFIG.loadTimeoutMs);
    });
  }

  /** Clone d'un modèle (personnage animé : squelette cloné), tourné selon ASSETS, ou null. */
  clone(key: string): { obj: THREE.Object3D; animations: THREE.AnimationClip[] } | null {
    const l = this.loaded.get(key);
    if (!l) return null;
    const inner = l.skinned ? SkeletonUtils.clone(l.scene) : l.scene.clone(true);
    inner.rotation.y = (ASSETS[key]!.rot * Math.PI) / 2;
    const wrap = new THREE.Group();
    wrap.add(inner);
    return { obj: wrap, animations: l.animations };
  }

  /**
   * Clone ajusté dans une boîte w × h × d (m), posé au sol (y = 0) et centré. `stretch` : déformation pour remplir
   * exactement la boîte ; sinon échelle uniforme (la plus grande qui tient). `h` nul : hauteur libre.
   */
  fitted(key: string, w: number, h: number | null, d: number, stretch = false): THREE.Object3D | null {
    const c = this.clone(key);
    if (!c) return null;
    return fitInto(c.obj, w, h, d, stretch, ASSETS[key]!.scale);
  }

  /**
   * Géométrie fusionnée (unité : boîte 1 × 1 × 1, base en y = 0, centrée) et matériau(x), pour l'instanciation des
   * bâtiments. Null si le modèle manque.
   */
  merged(key: string): { geo: THREE.BufferGeometry; mat: THREE.Material | THREE.Material[] } | null {
    if (this.mergedCache.has(key)) return this.mergedCache.get(key)!;
    const l = this.loaded.get(key);
    let out: { geo: THREE.BufferGeometry; mat: THREE.Material | THREE.Material[] } | null = null;
    if (l) {
      const root = l.scene.clone(true);
      root.rotation.y = (ASSETS[key]!.rot * Math.PI) / 2;
      root.updateMatrixWorld(true);
      const geos: THREE.BufferGeometry[] = [];
      const mats: THREE.Material[] = [];
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
        for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
        geos.push(g.index ? g.toNonIndexed() : g);
        mats.push(Array.isArray(m.material) ? m.material[0]! : m.material);
      });
      const geo = geos.length === 1 ? geos[0]! : mergeGeometries(geos, true);
      if (geo) {
        geo.computeBoundingBox();
        const b = geo.boundingBox!, size = b.getSize(new THREE.Vector3());
        geo.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
        geo.scale(1 / size.x, 1 / size.y, 1 / size.z);
        geo.computeBoundingSphere();
        geo.userData['shared'] = true;
        out = { geo, mat: mats.length === 1 ? mats[0]! : mats };
      }
    }
    this.mergedCache.set(key, out);
    return out;
  }

  /** Dimensions d'origine d'un modèle (après sa rotation d'ASSETS), ou null. */
  size(key: string): THREE.Vector3 | null {
    const c = this.sizeCache.get(key);
    if (c) return c;
    const l = this.loaded.get(key);
    if (!l) return null;
    const root = l.scene.clone(true);
    root.rotation.y = (ASSETS[key]!.rot * Math.PI) / 2;
    root.updateMatrixWorld(true);
    const v = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
    this.sizeCache.set(key, v);
    return v;
  }
  private readonly sizeCache = new Map<string, THREE.Vector3>();

  /**
   * InstancedMesh d'un modèle (géométrie fusionnée) pour `mats` positions ; chaque instance garde les proportions
   * du modèle et tient dans la boîte w × h × d. Null si le modèle manque.
   */
  instances(key: string, at: THREE.Matrix4[], w: number, h: number, d: number): THREE.InstancedMesh | null {
    const mg = this.merged(key), sz = this.size(key);
    if (!mg || !sz || !at.length) return null;
    const k = Math.min(w / sz.x, h / sz.y, d / sz.z);
    const scale = new THREE.Matrix4().makeScale(sz.x * k, sz.y * k, sz.z * k);
    const m = new THREE.InstancedMesh(mg.geo, mg.mat as THREE.Material, at.length);
    at.forEach((a, i) => m.setMatrixAt(i, a.clone().multiply(scale)));
    m.castShadow = false;
    m.receiveShadow = true;
    m.computeBoundingSphere();
    return m;
  }

  /** Proportions d'origine (hauteur / largeur moyenne) d'un modèle, ou 0. */
  aspect(key: string): number {
    const l = this.loaded.get(key);
    if (!l) return 0;
    const s = new THREE.Box3().setFromObject(l.scene).getSize(new THREE.Vector3());
    return s.y / ((s.x + s.z) / 2);
  }
}

/** Télécharge le paquet de modèles avec progression ; null s'il est absent ou illisible. */
async function fetchPack(url: string, onProgress: (p: number) => void): Promise<Record<string, string> | null> {
  try {
    const res = await fetch(url);
    if (!res.ok || !res.body) return null;
    const total = Number(res.headers.get('content-length')) || 0;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      onProgress(total ? Math.min(1, got / total) : 0.5);
    }
    const all = new Uint8Array(got);
    let o = 0;
    for (const c of chunks) { all.set(c, o); o += c.length; }
    return JSON.parse(new TextDecoder().decode(all)) as Record<string, string>;
  } catch { return null; }
}

/** Ajuste un objet dans une boîte (voir AssetLib.fitted). */
export function fitInto(obj: THREE.Object3D, w: number, h: number | null, d: number, stretch: boolean, extra = 1): THREE.Object3D {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj, true);
  const s = box.getSize(new THREE.Vector3());
  let sx: number, sy: number, sz: number;
  if (stretch) { sx = w / s.x; sz = d / s.z; sy = h ? h / s.y : (sx + sz) / 2; }
  else { const k = Math.min(w / s.x, d / s.z, h ? h / s.y : Infinity); sx = sy = sz = k; }
  obj.scale.set(sx * extra, sy * extra, sz * extra);
  obj.updateMatrixWorld(true);
  const b2 = new THREE.Box3().setFromObject(obj, true);
  obj.position.x -= (b2.min.x + b2.max.x) / 2;
  obj.position.z -= (b2.min.z + b2.max.z) / 2;
  obj.position.y -= b2.min.y;
  const g = new THREE.Group();
  g.add(obj);
  return g;
}

export const assets = new AssetLib();
