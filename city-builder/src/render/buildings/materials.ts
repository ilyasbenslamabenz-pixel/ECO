/**
 * Matériaux PARTAGÉS des bâtiments (rendu instancié).
 *
 * Les GLB du kit (tools/buildings/kit) portent sur chaque matériau `extras.aube = { set, uv, kind }` :
 * on reconstruit ici des MeshStandardMaterial partagés à partir des jeux de textures du catalogue
 * (une texture chargée une seule fois par fichier et par échelle), ce qui permet aussi d'appliquer les
 * variantes (`materialOverrides` : autre jeu de textures et/ou teinte) sans dupliquer la géométrie.
 *
 * Verres : réflexion de l'environnement le jour ; la nuit, une partie des fenêtres s'allume
 * (attribut de sommet `_lit` = graine par fenêtre, hachage de la position de l'instance -> chaque
 * immeuble a son propre motif ; 2 = vitrine toujours allumée ; -1 = jamais).
 */
import * as THREE from 'three';
import { downscaleImage } from '../image-cap';
import type { AssetCatalog, TextureSet } from '../../shared/catalog';

export interface AubeMaterialExtras { set: string | null; uv: 'meters' | 'unit'; kind: 'opaque' | 'glass' }

/** Uniformes partagés par tous les verres de bâtiments. */
export interface NightUniforms {
  uNight: { value: number };
  uLitRatio: { value: number };
}

/** Rôles dont la teinte varie légèrement d'une instance à l'autre (patine, salissures). */
export const VARYING_ROLES = new Set(['facade', 'facade_b', 'toiture', 'soubassement', 'encadrement', 'cheminee', 'dalle']);

export class BuildingMaterials {
  private readonly loader = new THREE.TextureLoader();
  private readonly images = new Map<string, Promise<HTMLImageElement | ImageBitmap | HTMLCanvasElement | OffscreenCanvas | ImageData | null>>();
  private readonly textures = new Map<string, THREE.Texture>();
  private readonly materials = new Map<string, THREE.Material>();
  private readonly sets: Map<string, TextureSet>;
  private readonly pending = new Set<Promise<unknown>>();
  readonly errors: string[] = [];
  readonly night: NightUniforms = { uNight: { value: 0 }, uLitRatio: { value: 0.45 } };

  constructor(catalog: AssetCatalog, private readonly url: (file: string) => string, private readonly anisotropy = 8) {
    this.sets = new Map(catalog.textureSets.map((t) => [t.id, t]));
  }

  /**
   * Image décodée HORS du thread principal (createImageBitmap) : l'envoi au GPU ne paie plus le décodage PNG/JPEG,
   * qui figeait la première image d'une ville chargée. Sans ImageBitmap : élément <img> comme avant.
   * Pas de retournement (flipY = false, comme pour l'élément <img>) ni de conversion de couleur (cartes de normales).
   */
  private async loadImage(url: string): Promise<HTMLImageElement | ImageBitmap | HTMLCanvasElement | OffscreenCanvas | ImageData> {
    // Mode allégé : image réduite dès son décodage, original libéré (src/render/image-cap.ts).
    return downscaleImage(await this.decodeImage(url));
  }

  private async decodeImage(url: string): Promise<HTMLImageElement | ImageBitmap> {
    if (typeof createImageBitmap === 'function' && typeof fetch === 'function') {
      try {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return await createImageBitmap(await r.blob(), { imageOrientation: 'from-image', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      } catch (e) {
        if (e instanceof Error && e.message.startsWith('HTTP')) throw e;
        // options non prises en charge (anciens navigateurs) : repli sur l'élément <img>
      }
    }
    return (await this.loader.loadAsync(url)).image as HTMLImageElement;
  }

  private texture(file: string, repeat: number, srgb: boolean): THREE.Texture {
    const key = `${file}|${repeat}`;
    let t = this.textures.get(key);
    if (t) return t;
    const tex = new THREE.Texture();
    tex.name = file;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat, repeat);
    tex.anisotropy = this.anisotropy;
    tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.flipY = false;
    let img = this.images.get(file);
    if (!img) {
      img = this.loadImage(this.url(file)).catch((e: unknown) => {
        this.errors.push(`${file} : ${e instanceof Error ? e.message : String(e)}`);
        return null;
      });
      this.images.set(file, img);
    }
    const p = img.then((im) => { if (im) { tex.image = im; tex.needsUpdate = true; } });
    this.pending.add(p);
    void p.finally(() => this.pending.delete(p));
    this.textures.set(key, tex);
    t = tex;
    return t;
  }

  /**
   * Matériau partagé pour un matériau glTF source (nom = rôle), avec surcharge de variante éventuelle.
   * Les matériaux sans `extras.aube` (GLB d'autres sources) sont renvoyés tels quels.
   */
  resolve(src: THREE.Material, override?: { color?: string; textureSet?: string }): THREE.Material {
    const ex = (src.userData as { aube?: AubeMaterialExtras }).aube;
    if (!ex) return src;
    const s = src as THREE.MeshStandardMaterial;
    const role = src.name;
    const setId = override?.textureSet ?? ex.set;
    const color = override?.color ?? `#${s.color.getHexString(THREE.SRGBColorSpace)}`;
    const key = `${ex.kind}|${role}|${setId ?? ''}|${ex.uv}|${color}|${s.roughness.toFixed(2)}|${s.metalness.toFixed(2)}|${s.side}`;
    let m = this.materials.get(key);
    if (m) return m;
    if (ex.kind === 'glass' || !setId) {
      m = this.glass(role, color);
    } else {
      const set = this.sets.get(setId);
      if (!set) {
        this.errors.push(`jeu de textures inconnu ${setId} (${role})`);
        return src;
      }
      const rep = ex.uv === 'meters' ? 1 / set.tileSizeM : 1;
      const mat = new THREE.MeshStandardMaterial({
        name: `${role}:${setId}`,
        color: new THREE.Color(color),
        map: this.texture(set.albedo, rep, true),
        normalMap: this.texture(set.normal, rep, false),
        roughness: s.roughness,
        metalness: s.metalness,
        side: s.side,
      });
      if (set.arm) {
        const arm = this.texture(set.arm, rep, false);
        mat.roughnessMap = arm;
        mat.metalnessMap = arm;
        mat.aoMap = arm;
        mat.aoMapIntensity = 0.8;
      }
      m = mat;
    }
    this.materials.set(key, m);
    return m;
  }

  /** Verre avec allumage nocturne par fenêtre et par instance. */
  private glass(role: string, color: string): THREE.MeshStandardMaterial {
    const railing = role === 'verre_gc';
    const m = new THREE.MeshStandardMaterial({
      name: `${role}:verre`,
      color: new THREE.Color(color),
      roughness: railing ? 0.15 : 0.06,
      metalness: railing ? 0.3 : 0.65,
      envMapIntensity: 1.3,
      transparent: railing,
      opacity: railing ? 0.55 : 1,
      depthWrite: !railing,
    });
    if (railing) return m;
    const u = this.night;
    m.customProgramCacheKey = (): string => 'aube-bat-verre';
    m.onBeforeCompile = (sh): void => {
      sh.uniforms['uNight'] = u.uNight;
      sh.uniforms['uLitRatio'] = u.uLitRatio;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
attribute float _lit;
varying float vAubeLit;
varying float vAubeHash;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
  vAubeLit = _lit;
  vec3 aubeT = modelMatrix[3].xyz;
  #ifdef USE_INSTANCING
    aubeT += instanceMatrix[3].xyz;
  #endif
  vAubeHash = fract( sin( dot( floor( aubeT.xz * 0.5 ), vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
uniform float uNight;
uniform float uLitRatio;
varying float vAubeLit;
varying float vAubeHash;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
  float aubeR = fract( vAubeLit * 7.31 + vAubeHash * 3.7 );
  diffuseColor.rgb *= 0.7 + 0.6 * fract( vAubeLit * 3.17 + vAubeHash );`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  float aubeOn = vAubeLit > 1.5 ? 1.0 : ( vAubeLit < 0.0 ? 0.0 : step( aubeR, uLitRatio ) );
  vec3 aubeWarm = mix( vec3( 1.0, 0.62, 0.3 ), vec3( 1.0, 0.8, 0.55 ), fract( vAubeLit * 13.7 + vAubeHash * 5.1 ) );
  aubeWarm = mix( aubeWarm, vec3( 0.7, 0.8, 1.0 ), step( 0.88, fract( vAubeLit * 5.3 + vAubeHash ) ) );
  float aubeDim = 0.55 + 0.45 * fract( vAubeLit * 21.1 + vAubeHash * 2.3 );
  totalEmissiveRadiance += aubeWarm * aubeOn * uNight * ( vAubeLit > 1.5 ? 1.5 : 0.95 * aubeDim );`);
    };
    return m;
  }

  async whenReady(): Promise<void> {
    while (this.pending.size) await Promise.all([...this.pending]);
  }

  stats(): { materials: number; textures: number; images: number } {
    return { materials: this.materials.size, textures: this.textures.size, images: this.images.size };
  }

  dispose(): void {
    for (const m of this.materials.values()) m.dispose();
    for (const t of this.textures.values()) t.dispose();
    this.materials.clear();
    this.textures.clear();
    this.images.clear();
  }
}

/** Facteur de nuit (0 = plein jour, 1 = nuit) selon l'heure simulée (0..24). */
export function nightFactorForHour(h: number): number {
  // crépuscule 18 h -> 21 h, aube 5 h -> 7 h 30
  if (h >= 21 || h < 5) return 1;
  if (h >= 18) return (h - 18) / 3;
  if (h < 7.5) return 1 - (h - 5) / 2.5;
  return 0;
}
