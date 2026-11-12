/**
 * Bibliothèque de matériaux PBR partagés, construits depuis les jeux de textures du catalogue
 * (Poly Haven CC0 : albedo + normale OpenGL + ARM = AO/Roughness/Metalness).
 *
 * - Chaque texture (fichier) est chargée UNE fois ; chaque combinaison (jeu, mode d'UV, teinte, échelle)
 *   produit UN matériau mis en cache : `get()` renvoie toujours la même instance pour les mêmes paramètres.
 * - Modes d'UV :
 *     'mesh'    : UV du maillage (modèles glTF, pièces modélisées) ;
 *     'worldXZ' : projection verticale en coordonnées monde (terrain, chaussées, trottoirs) ;
 *     'box'     : projection « boîte » en coordonnées monde selon l'axe dominant de la normale
 *                 (façades, murs, toits générés) : la texture garde son échelle réelle (tileSizeM)
 *                 quelle que soit la taille du bâtiment, sans couture entre instances voisines.
 *   Les modes monde fonctionnent avec InstancedMesh (instanceMatrix pris en compte) et la normal map
 *   (repère tangent dérivé des dérivées écran des UV monde).
 * - Matériaux sans texture partagés : verres (clair, teinté, fenêtre éclairée).
 * Propriétaire : agent pipeline d'assets. Aucun état global : une instance par rendu.
 */
import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import type { AssetCatalog, TextureSet } from '../shared/catalog';

export type UvMode = 'mesh' | 'worldXZ' | 'box';

export interface MaterialOptions {
  /** Mode de coordonnées de texture (défaut 'mesh'). */
  uv?: UvMode;
  /** Teinte multiplicative (#rrggbb) pour les variantes. */
  color?: string;
  /** Taille réelle (m) d'une répétition en mode monde ; défaut = tileSizeM du jeu. */
  tileSizeM?: number;
  /** Intensité de la normal map (défaut 1). */
  normalScale?: number;
  side?: THREE.Side;
}

export type GlassKind = 'clair' | 'teinte' | 'eclaire';

const UV_MODE_DEFINE: Record<Exclude<UvMode, 'mesh'>, number> = { worldXZ: 1, box: 2 };

/** Injection GLSL des UV monde (partagée par tous les matériaux en mode monde). */
function installWorldUv(mat: THREE.MeshStandardMaterial, mode: Exclude<UvMode, 'mesh'>, tileSizeM: number): void {
  const tileInv = { value: 1 / tileSizeM };
  mat.defines = { ...(mat.defines ?? {}), AUBE_UV_MODE: UV_MODE_DEFINE[mode] };
  mat.customProgramCacheKey = (): string => `aube-uv-${mode}`;
  mat.userData['aubeTileInv'] = tileInv;
  mat.onBeforeCompile = (shader): void => {
    shader.uniforms['aubeTileInv'] = tileInv;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vAubeWp;\nvarying vec3 vAubeWn;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
  vec4 aubeW = vec4( transformed, 1.0 );
  vec3 aubeN = objectNormal;
  #ifdef USE_BATCHING
    aubeW = batchingMatrix * aubeW;
    aubeN = mat3( batchingMatrix ) * aubeN;
  #endif
  #ifdef USE_INSTANCING
    aubeW = instanceMatrix * aubeW;
    aubeN = mat3( instanceMatrix ) * aubeN;
  #endif
  aubeW = modelMatrix * aubeW;
  vAubeWp = aubeW.xyz;
  vAubeWn = mat3( modelMatrix ) * aubeN;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vAubeWp;\nvarying vec3 vAubeWn;\nuniform float aubeTileInv;')
      .replace('void main() {', `void main() {
  vec2 aubeUv;
  #if AUBE_UV_MODE == 1
    aubeUv = vec2( vAubeWp.x, - vAubeWp.z ) * aubeTileInv;
  #else
    vec3 aubeAn = abs( normalize( vAubeWn ) );
    if ( aubeAn.y >= aubeAn.x && aubeAn.y >= aubeAn.z ) aubeUv = vec2( vAubeWp.x, - vAubeWp.z );
    else if ( aubeAn.x >= aubeAn.z ) aubeUv = vec2( vAubeWn.x > 0.0 ? - vAubeWp.z : vAubeWp.z, vAubeWp.y );
    else aubeUv = vec2( vAubeWn.z > 0.0 ? vAubeWp.x : - vAubeWp.x, vAubeWp.y );
    aubeUv *= aubeTileInv;
  #endif
  #define vMapUv aubeUv
  #define vNormalMapUv aubeUv
  #define vRoughnessMapUv aubeUv
  #define vMetalnessMapUv aubeUv
  #define vAoMapUv aubeUv`);
  };
}

export class MaterialLibrary {
  private readonly loader = new THREE.TextureLoader();
  private readonly textures = new Map<string, THREE.Texture>();
  private readonly materials = new Map<string, THREE.MeshStandardMaterial>();
  private readonly glasses = new Map<GlassKind, THREE.MeshStandardMaterial>();
  private readonly pending = new Set<Promise<unknown>>();
  private readonly sets: Map<string, TextureSet>;
  private readonly errors: string[] = [];

  constructor(readonly catalog: AssetCatalog, private readonly base: URL, private readonly anisotropy = 8) {
    this.sets = new Map(catalog.textureSets.map((t) => [t.id, t]));
  }

  has(setId: string): boolean { return this.sets.has(setId); }
  setIds(): string[] { return [...this.sets.keys()]; }
  textureSet(setId: string): TextureSet | undefined { return this.sets.get(setId); }

  private texture(file: string, srgb: boolean): THREE.Texture {
    let t = this.textures.get(file);
    if (t) return t;
    t = new THREE.Texture();
    const tex = t;
    tex.name = file;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = this.anisotropy;
    tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    const p = this.loader.loadAsync(new URL(file, this.base).href).then((loaded) => {
      tex.image = loaded.image;
      tex.needsUpdate = true;
      loaded.dispose();
    }).catch((e: unknown) => {
      this.errors.push(`${file} : ${e instanceof Error ? e.message : String(e)}`);
    });
    this.pending.add(p);
    void p.finally(() => this.pending.delete(p));
    this.textures.set(file, tex);
    return tex;
  }

  /**
   * Matériau partagé d'un jeu de textures. Ne pas modifier l'instance renvoyée (elle est partagée) :
   * passer les options voulues, une nouvelle combinaison crée un nouveau matériau mis en cache.
   */
  get(setId: string, opts: MaterialOptions = {}): THREE.MeshStandardMaterial {
    const set = this.sets.get(setId);
    if (!set) throw new Error(`Jeu de textures inconnu : ${setId}`);
    const uv = opts.uv ?? 'mesh';
    const tile = opts.tileSizeM ?? set.tileSizeM;
    const key = `${setId}|${uv}|${opts.color ?? ''}|${uv === 'mesh' ? '' : tile}|${opts.normalScale ?? 1}|${opts.side ?? THREE.FrontSide}`;
    let m = this.materials.get(key);
    if (m) return m;
    m = new THREE.MeshStandardMaterial({
      name: `${setId}${uv === 'mesh' ? '' : `@${uv}`}`,
      map: this.texture(set.albedo, true),
      normalMap: this.texture(set.normal, false),
      normalScale: new THREE.Vector2(opts.normalScale ?? 1, opts.normalScale ?? 1),
      color: opts.color ? new THREE.Color(opts.color) : new THREE.Color(0xffffff),
      side: opts.side ?? THREE.FrontSide,
    });
    if (set.arm) {
      const arm = this.texture(set.arm, false);
      m.aoMap = arm;
      m.roughnessMap = arm;
      m.metalnessMap = arm;
      m.roughness = 1;
      m.metalness = 1;
    } else {
      if (set.roughness) { m.roughnessMap = this.texture(set.roughness, false); m.roughness = 1; }
      if (set.metalness) { m.metalnessMap = this.texture(set.metalness, false); m.metalness = 1; } else m.metalness = 0;
      if (set.ao) m.aoMap = this.texture(set.ao, false);
    }
    if (uv !== 'mesh') installWorldUv(m, uv, tile);
    this.materials.set(key, m);
    return m;
  }

  /** Verres partagés (fenêtres, vitrines, abribus). */
  glass(kind: GlassKind = 'clair'): THREE.MeshStandardMaterial {
    let m = this.glasses.get(kind);
    if (m) return m;
    if (kind === 'eclaire') {
      m = new THREE.MeshStandardMaterial({ name: 'verre_eclaire', color: 0x2a2620, emissive: 0xffd9a0, emissiveIntensity: 0.9, roughness: 0.25, metalness: 0 });
    } else {
      m = new THREE.MeshStandardMaterial({
        name: kind === 'clair' ? 'verre_clair' : 'verre_teinte',
        color: kind === 'clair' ? 0x6f8796 : 0x2d3b45,
        roughness: 0.06,
        metalness: 0.9,
        envMapIntensity: 1.4,
      });
    }
    this.glasses.set(kind, m);
    return m;
  }

  /** Charge un HDRI du catalogue (texture équirectangulaire HDR, à passer à PMREMGenerator). */
  async loadHdri(hdriId: string): Promise<THREE.DataTexture> {
    const h = this.catalog.hdris.find((x) => x.id === hdriId);
    if (!h) throw new Error(`HDRI inconnu : ${hdriId}`);
    const tex = await new HDRLoader().loadAsync(new URL(h.file, this.base).href);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    return tex;
  }

  /** Résout quand toutes les textures demandées jusqu'ici sont chargées (ou en échec, voir `loadErrors`). */
  async whenReady(): Promise<void> {
    while (this.pending.size) await Promise.all([...this.pending]);
  }

  get loadErrors(): readonly string[] { return this.errors; }

  /** Statistiques (contrôle de non-duplication). */
  stats(): { materials: number; textures: number; texturesDecoded: number } {
    let decoded = 0;
    for (const t of this.textures.values()) {
      const img = t.image as { width?: number; height?: number } | null;
      if (img && (img.width ?? 0) > 0 && (img.height ?? 0) > 0) decoded++;
    }
    return { materials: this.materials.size + this.glasses.size, textures: this.textures.size, texturesDecoded: decoded };
  }

  dispose(): void {
    for (const m of this.materials.values()) m.dispose();
    for (const m of this.glasses.values()) m.dispose();
    for (const t of this.textures.values()) t.dispose();
    this.materials.clear();
    this.glasses.clear();
    this.textures.clear();
  }
}
