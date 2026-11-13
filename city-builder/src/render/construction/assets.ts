/**
 * Bibliothèque des modèles de CHANTIER (rendu) — propriété p2a-chantiers.
 *
 * Les modèles de chantier ne sont pas des assets de jeu (ni bâtiments, ni véhicules) : ils vivent dans
 * `assets/models/construction/` avec leur propre manifeste (`manifest.json`, écrit par
 * tools/construction/build.ts). Ce module charge le manifeste puis les GLB à la demande, et prépare pour
 * chaque (modèle, LOD) une liste de PARTS prêtes à instancier : une géométrie fusionnée par matériau,
 * transformations de nœud « cuites » (les GLB distribués sont quantifiés/compressés meshopt).
 */
import * as THREE from 'three';
import { createGltfLoader } from '../gzip-assets';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export interface ManifestLod { file: string; maxDistance: number; triangles: number; bytes: number }
export interface ManifestEntry {
  id: string;
  nameFr: string;
  anchor: string;
  lods: ManifestLod[];
  dimensions: { width: number; height: number; depth: number };
  bounds: { min: number[]; max: number[] };
  roles: string[];
}
export interface ConstructionManifest {
  version: number;
  generatedAt: string;
  license: { spdx: string; author: string; note: string };
  pivots: Record<string, number | number[]>;
  models: ManifestEntry[];
}

/** Une partie prête à dessiner : géométrie fusionnée + matériau partagé. */
export interface ModelPart { geometry: THREE.BufferGeometry; material: THREE.Material; role: string }

/** Rôles qui s'allument la nuit (gyrophares, projecteurs de chantier). */
const EMISSIVE_ROLES = new Set(['optique']);

const roleOf = (m: THREE.Material): string => {
  const extras = (m.userData as { aube?: { role?: string } } | undefined)?.aube;
  return extras?.role ?? m.name ?? 'inconnu';
};

export class ConstructionAssets {
  private manifest: ConstructionManifest | null = null;
  private readonly entries = new Map<string, ManifestEntry>();
  private readonly loader = createGltfLoader();
  private readonly parts = new Map<string, Promise<ModelPart[]>>();
  private readonly ready = new Map<string, ModelPart[]>();
  /** Matériaux par rôle (partagés entre modèles et LOD). */
  private readonly materials = new Map<string, THREE.Material>();
  readonly errors: string[] = [];
  private night = 0;

  constructor(private readonly url: (file: string) => string) {}

  /** Charge le manifeste (une fois). Renvoie faux si le fichier est absent (module de rendu inactif). */
  async load(): Promise<boolean> {
    if (this.manifest) return true;
    try {
      const res = await fetch(this.url('models/construction/manifest.json'));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const man = (await res.json()) as ConstructionManifest;
      if (!Array.isArray(man.models) || man.models.length === 0) throw new Error('manifeste vide');
      this.manifest = man;
      for (const e of man.models) this.entries.set(e.id, e);
      return true;
    } catch (e) {
      this.errors.push(`manifeste des chantiers : ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  get loaded(): boolean { return this.manifest !== null; }
  get models(): readonly ManifestEntry[] { return this.manifest?.models ?? []; }
  entry(id: string): ManifestEntry | undefined { return this.entries.get(id); }

  /** Valeur d'un pivot du manifeste (nombre). */
  pivot(name: string, fallback: number): number {
    const v = this.manifest?.pivots[name];
    return typeof v === 'number' ? v : fallback;
  }

  /** Valeur d'un pivot du manifeste (vecteur). */
  pivotArray(name: string, fallback: readonly number[]): readonly number[] {
    const v = this.manifest?.pivots[name];
    return Array.isArray(v) ? v : fallback;
  }

  /** Nombre de LOD disponibles pour un modèle. */
  lodCount(id: string): number { return this.entries.get(id)?.lods.length ?? 0; }

  /** LOD voulu à une distance caméra donnée. */
  lodFor(id: string, distance: number): number {
    const e = this.entries.get(id);
    if (!e) return 0;
    for (let i = 0; i < e.lods.length; i++) if (distance < e.lods[i]!.maxDistance) return i;
    return e.lods.length - 1;
  }

  /** Parties déjà chargées (null si le chargement n'est pas terminé ; il est alors lancé). */
  partsOf(id: string, lod: number): ModelPart[] | null {
    const key = `${id}#${lod}`;
    const done = this.ready.get(key);
    if (done) return done;
    if (!this.parts.has(key)) void this.request(id, lod);
    return null;
  }

  /** Charge explicitement un (modèle, LOD). */
  request(id: string, lod: number): Promise<ModelPart[]> {
    const key = `${id}#${lod}`;
    let p = this.parts.get(key);
    if (p) return p;
    const e = this.entries.get(id);
    const file = e?.lods[Math.min(lod, e.lods.length - 1)]?.file;
    if (!file) {
      p = Promise.resolve([]);
      this.errors.push(`modèle de chantier inconnu : ${id}`);
    } else {
      p = this.loader.loadAsync(this.url(file)).then((gltf) => {
        const out = this.bake(gltf.scene);
        this.ready.set(key, out);
        return out;
      }).catch((err: unknown) => {
        this.errors.push(`${id} LOD${lod} : ${err instanceof Error ? err.message : String(err)}`);
        this.ready.set(key, []);
        return [] as ModelPart[];
      });
    }
    this.parts.set(key, p);
    return p;
  }

  /** Précharge tous les modèles au LOD donné (démo, porte visuelle). */
  async preload(lod = 0): Promise<void> {
    await Promise.all(this.models.map((m) => this.request(m.id, lod)));
  }

  /** Vrai quand aucun chargement n'est en cours. */
  get pending(): number { return this.parts.size - this.ready.size; }

  /** Facteur de nuit (0 jour .. 1 nuit) : gyrophares et projecteurs. */
  setNight(n: number): void {
    this.night = Math.max(0, Math.min(1, n));
    for (const [role, m] of this.materials) {
      if (!EMISSIVE_ROLES.has(role)) continue;
      const s = m as THREE.MeshStandardMaterial;
      s.emissiveIntensity = 0.25 + 2.2 * this.night;
    }
  }

  /**
   * Modèle qui fournit le matériau d'un rôle (les matériaux sont créés en « cuisant » un GLB).
   * La géométrie procédurale du chantier (plateforme, dalle, structure) réutilise ces matériaux
   * partagés plutôt que de recharger les mêmes textures.
   */
  private static readonly ROLE_PROVIDER: Record<string, string> = {
    beton: 'grue_base', bois: 'echafaudage', acier_galva: 'echafaudage', acier_jaune: 'grue_base',
    acier_sombre: 'baraque', terre: 'tas_terre', gravats: 'tas_gravats', filet: 'echafaudage', bache: 'palissade',
  };

  /** Couleurs de repli si le modèle fournisseur n'est pas encore chargé. */
  private static readonly ROLE_FALLBACK: Record<string, number> = {
    beton: 0xc3c2bd, bois: 0xcbb183, acier_galva: 0xb4b8bd, acier_jaune: 0xd1942a,
    acier_sombre: 0x4c4f53, terre: 0xb79c76, gravats: 0xb5b2ac, filet: 0x3c6ea5, bache: 0x1b5280,
  };

  /**
   * Matériau partagé d'un rôle pour la géométrie procédurale : celui du GLB fournisseur s'il est chargé
   * (le chargement est lancé sinon), sinon un matériau de repli de la bonne teinte, remplacé ensuite.
   */
  sharedMaterial(role: string): THREE.Material {
    const have = this.materials.get(role);
    if (have) return have;
    const provider = ConstructionAssets.ROLE_PROVIDER[role];
    if (provider) this.partsOf(provider, 0); // déclenche le chargement
    const m = new THREE.MeshStandardMaterial({
      color: ConstructionAssets.ROLE_FALLBACK[role] ?? 0xb0b0b0,
      roughness: role === 'terre' || role === 'gravats' || role === 'beton' ? 0.95 : 0.6,
      metalness: role.startsWith('acier') ? 0.8 : 0,
    });
    m.name = `${role}_repli`;
    return m;
  }

  /** Vrai si le matériau partagé définitif d'un rôle est disponible (le repli peut être remplacé). */
  hasSharedMaterial(role: string): boolean { return this.materials.has(role); }

  /** Matériau partagé d'un rôle (le premier rencontré fait foi). */
  private material(src: THREE.Material): THREE.Material {
    const role = roleOf(src);
    let m = this.materials.get(role);
    if (m) return m;
    m = src.clone();
    m.name = role;
    const s = m as THREE.MeshStandardMaterial;
    if (EMISSIVE_ROLES.has(role)) {
      s.emissive = new THREE.Color(1, 0.6, 0.12);
      s.emissiveIntensity = 0.25;
      s.toneMapped = false;
    }
    if (role === 'filet') {
      s.transparent = true;
      s.depthWrite = false;
      s.side = THREE.DoubleSide;
      s.opacity = 0.55;
    }
    if (role === 'verre') { s.envMapIntensity = 1.4; }
    this.materials.set(role, m);
    return m;
  }

  /** Cuit les transformations de nœud et fusionne les géométries par matériau. */
  private bake(root: THREE.Object3D): ModelPart[] {
    root.updateMatrixWorld(true);
    const byRole = new Map<string, { geos: THREE.BufferGeometry[]; material: THREE.Material }>();
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const src = mats[0];
      if (!src) return;
      const role = roleOf(src);
      const g = mesh.geometry.clone();
      // Attributs quantifiés (meshopt) -> float32 avant applyMatrix4.
      for (const name of ['position', 'normal']) {
        const a = g.getAttribute(name) as THREE.BufferAttribute | undefined;
        if (!a || (a.array instanceof Float32Array && !a.normalized)) continue;
        const out = new Float32Array(a.count * a.itemSize);
        for (let i = 0; i < a.count; i++) {
          out[i * a.itemSize] = a.getX(i);
          if (a.itemSize > 1) out[i * a.itemSize + 1] = a.getY(i);
          if (a.itemSize > 2) out[i * a.itemSize + 2] = a.getZ(i);
        }
        g.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize));
      }
      const uv = g.getAttribute('uv') as THREE.BufferAttribute | undefined;
      if (uv && !(uv.array instanceof Float32Array)) {
        const out = new Float32Array(uv.count * 2);
        for (let i = 0; i < uv.count; i++) { out[i * 2] = uv.getX(i); out[i * 2 + 1] = uv.getY(i); }
        g.setAttribute('uv', new THREE.BufferAttribute(out, 2));
      }
      // Attributs superflus : la fusion exige des jeux d'attributs identiques.
      for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
      g.applyMatrix4(mesh.matrixWorld);
      const slot = byRole.get(role) ?? { geos: [], material: this.material(src) };
      slot.geos.push(g);
      byRole.set(role, slot);
    });
    const out: ModelPart[] = [];
    for (const [role, slot] of byRole) {
      const geometry = slot.geos.length === 1 ? slot.geos[0]! : (mergeGeometries(slot.geos, false) ?? slot.geos[0]!);
      if (slot.geos.length > 1) for (const g of slot.geos) if (g !== geometry) g.dispose();
      geometry.computeBoundingSphere();
      out.push({ geometry, material: slot.material, role });
    }
    // Ordre stable : opaques d'abord, filets (transparents) en dernier.
    out.sort((a, b) => (a.role === 'filet' ? 1 : 0) - (b.role === 'filet' ? 1 : 0));
    return out;
  }

  dispose(): void {
    for (const parts of this.ready.values()) for (const p of parts) p.geometry.dispose();
    for (const m of this.materials.values()) {
      for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
      m.dispose();
    }
    this.ready.clear();
    this.parts.clear();
    this.materials.clear();
  }
}
