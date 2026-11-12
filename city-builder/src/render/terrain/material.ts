/**
 * Matériau PBR du terrain : mélange de 5 jeux de textures Poly Haven (herbe, terre, roche, sable, gravier)
 * empilés dans des tableaux de textures (DataArrayTexture : albedo sRGB, normale, ARM) => 3 échantillonneurs
 * seulement, compatible iPhone (WebGL2).
 *
 * Mélange : poids par sommet (pente / altitude / humidité / forêt / eau, calculés par le mailleur),
 * affinés par fragment : roche selon la pente réelle du fragment, mélange « par hauteur » (AO comme carte
 * de hauteur) pour des transitions naturelles, sable mouillé au bord de l'eau.
 * Anti-répétition : chaque couche est échantillonnée à deux échelles (dont une tournée), variation
 * macroscopique de teinte/luminosité par bruit basse fréquence, projection triplanaire de la roche
 * sur les pentes fortes (pas d'étirement).
 * Basé sur MeshStandardMaterial (onBeforeCompile) : ombres, brouillard, IBL et tone mapping de three conservés.
 */
import * as THREE from 'three';
import type { AssetCatalog, TextureSet } from '../../shared/catalog';

/** Ordre des couches dans les tableaux de textures. */
export const TERRAIN_LAYERS = ['terrain_herbe', 'terrain_terre', 'terrain_roche', 'terrain_sable', 'terrain_gravier'] as const;

export interface TerrainTextures {
  albedo: THREE.DataArrayTexture;
  normal: THREE.DataArrayTexture;
  arm: THREE.DataArrayTexture;
  macro: THREE.DataTexture;
  /** Taille réelle d'une répétition par couche (m). */
  tileSizes: number[];
  /** Dimensions décodées (contrôle). */
  sizes: { albedo: number; normal: number; arm: number };
  dispose(): void;
}

async function decode(url: string, size: number): Promise<Uint8ClampedArray> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Texture de terrain introuvable (${res.status}) : ${url}`);
  const blob = await res.blob();
  const bmp = await createImageBitmap(blob);
  if (bmp.width <= 0 || bmp.height <= 0) throw new Error(`Texture vide : ${url}`);
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(size, size) : Object.assign(document.createElement('canvas'), { width: size, height: size });
  const g = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!g) throw new Error('Contexte 2D indisponible');
  g.drawImage(bmp, 0, 0, size, size);
  bmp.close();
  return g.getImageData(0, 0, size, size).data;
}

function arrayTexture(layers: Uint8ClampedArray[], size: number, srgb: boolean, anisotropy: number): THREE.DataArrayTexture {
  const data = new Uint8Array(size * size * 4 * layers.length);
  layers.forEach((l, i) => data.set(l, i * size * size * 4));
  const t = new THREE.DataArrayTexture(data, size, size, layers.length);
  t.format = THREE.RGBAFormat;
  t.type = THREE.UnsignedByteType;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = anisotropy;
  t.needsUpdate = true;
  return t;
}

/** Texture de variation macroscopique (bruit de valeur multi-octaves, tuilable) générée localement. */
export function makeMacroTexture(size = 256, seed = 7): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const hash = (x: number, y: number, s: number): number => {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 2147483647)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const noise = (x: number, y: number, period: number, s: number): number => {
    const fx = (x / size) * period;
    const fy = (y / size) * period;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = fx - ix;
    const ty = fy - iy;
    const ux = tx * tx * (3 - 2 * tx);
    const uy = ty * ty * (3 - 2 * ty);
    const w = (v: number): number => ((v % period) + period) % period;
    const a = hash(w(ix), w(iy), s);
    const b = hash(w(ix + 1), w(iy), s);
    const c = hash(w(ix), w(iy + 1), s);
    const d = hash(w(ix + 1), w(iy + 1), s);
    return (a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4;
      const f = (s: number): number => (noise(x, y, 4, s) * 0.5 + noise(x, y, 8, s + 1) * 0.3 + noise(x, y, 16, s + 2) * 0.2);
      data[o] = Math.round(f(seed) * 255);
      data[o + 1] = Math.round(f(seed + 10) * 255);
      data[o + 2] = Math.round(f(seed + 20) * 255);
      data[o + 3] = Math.round(noise(x, y, 32, seed + 30) * 255);
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** Charge et empile les 5 jeux de textures de terrain du catalogue. */
export async function loadTerrainTextures(catalog: AssetCatalog, base: URL, anisotropy = 8, size = 1024): Promise<TerrainTextures> {
  const sets: TextureSet[] = TERRAIN_LAYERS.map((id) => {
    const s = catalog.textureSets.find((t) => t.id === id);
    if (!s) throw new Error(`Jeu de textures de terrain manquant dans le catalogue : ${id}`);
    if (!s.arm) throw new Error(`Jeu ${id} sans carte ARM`);
    return s;
  });
  const armSize = Math.max(256, size >> 1);
  const [alb, nor, arm] = await Promise.all([
    Promise.all(sets.map((s) => decode(new URL(s.albedo, base).href, size))),
    Promise.all(sets.map((s) => decode(new URL(s.normal, base).href, size))),
    Promise.all(sets.map((s) => decode(new URL(s.arm!, base).href, armSize))),
  ]);
  const albedo = arrayTexture(alb, size, true, anisotropy);
  const normal = arrayTexture(nor, size, false, anisotropy);
  const armT = arrayTexture(arm, armSize, false, anisotropy);
  const macro = makeMacroTexture();
  return {
    albedo, normal, arm: armT, macro,
    tileSizes: sets.map((s) => s.tileSizeM),
    sizes: { albedo: size, normal: size, arm: armSize },
    dispose() { albedo.dispose(); normal.dispose(); armT.dispose(); macro.dispose(); },
  };
}

const VERT_DECL = /* glsl */ `
attribute vec4 splat;
attribute vec4 envw;
varying vec4 vSplat;
varying vec4 vEnv;
varying vec3 vTWorld;
varying vec3 vTNormal;
`;

const VERT_MAIN = /* glsl */ `
  vSplat = splat;
  vEnv = envw;
  vTWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vTNormal = normalize(mat3(modelMatrix) * objectNormal);
`;

const FRAG_DECL = /* glsl */ `
uniform highp sampler2DArray tAlb;
uniform highp sampler2DArray tNor;
uniform highp sampler2DArray tArm;
uniform sampler2D tMacro;
uniform vec4 uTileA;
uniform float uTileB;
uniform float uWaterLevel;
uniform float uMacroStrength;
varying vec4 vSplat;
varying vec4 vEnv;
varying vec3 vTWorld;
varying vec3 vTNormal;
uniform vec3 uGrassDry;
uniform vec3 uGrassLush;
vec3 tAlbedo;
vec3 tWorldN;
float tRough;
float tAO;

// Échantillonnage d'une couche à deux échelles (anti-répétition) avec dérivées explicites.
void tSample(int layer, vec2 uv, vec2 dx, vec2 dy, float far, out vec3 alb, out vec3 nrm, out vec3 arm) {
  float L = float(layer);
  vec3 a1 = textureGrad(tAlb, vec3(uv, L), dx, dy).rgb;
  // Seconde échelle : 0,29x, tournée de 37° (casse la périodicité visible de loin).
  mat2 R = mat2(0.7986, -0.6018, 0.6018, 0.7986);
  vec2 uv2 = R * uv * 0.29 + vec2(0.37, 0.71);
  vec3 a2 = textureGrad(tAlb, vec3(uv2, L), R * dx * 0.29, R * dy * 0.29).rgb;
  alb = mix(a1, a2, 0.3 + 0.45 * far);
  vec4 n1 = textureGrad(tNor, vec3(uv, L), dx, dy);
  nrm = n1.xyz * 2.0 - 1.0;
  arm = textureGrad(tArm, vec3(uv, L), dx, dy).rgb;
}
`;

const FRAG_MAIN = /* glsl */ `
  {
    vec3 Nw = normalize(vTNormal);
    float camDist = length(vTWorld - cameraPosition);
    float far = smoothstep(40.0, 350.0, camDist);
    // Poids : herbe, terre, roche, sable, gravier.
    float wDirt = vSplat.x;
    float wRock = vSplat.y;
    float wSand = vSplat.z;
    float wGrav = vSplat.w;
    // Roche selon la pente réelle du fragment.
    float slopeF = 1.0 - Nw.y;
    vec4 mac = texture2D(tMacro, vTWorld.xz / 900.0);
    vec4 mac2 = texture2D(tMacro, vTWorld.xz / 173.0 + 0.5);
    wRock = max(wRock, smoothstep(0.30, 0.48, slopeF + (mac2.a - 0.5) * 0.12));
    float wGrass = max(0.0, 1.0 - wDirt - wRock - wSand - wGrav);
    // Taches de terre et d'herbe sèche (macro) pour casser l'uniformité.
    float patchD = smoothstep(0.66, 0.86, mac2.r * 0.7 + mac.a * 0.3) * 0.35 * wGrass;
    wDirt += patchD; wGrass -= patchD;
    float w[5];
    w[0] = wGrass; w[1] = wDirt; w[2] = wRock; w[3] = wSand; w[4] = wGrav;

    vec3 Tf = normalize(vec3(1.0, 0.0, 0.0) - Nw * Nw.x);
    vec3 Bf = normalize(cross(Nw, Tf));
    vec2 baseUv = vec2(vTWorld.x, -vTWorld.z);
    vec2 bdx = dFdx(baseUv);
    vec2 bdy = dFdy(baseUv);
    vec3 albs[5];
    vec3 nrms[5];
    vec3 arms[5];
    float hmax = 0.0;
    float hb[5];
    for (int k = 0; k < 5; k++) {
      albs[k] = vec3(0.0); nrms[k] = vec3(0.0, 0.0, 1.0); arms[k] = vec3(1.0, 0.8, 0.0); hb[k] = 0.0;
      if (w[k] > 0.004) {
        float s = k == 0 ? uTileA.x : k == 1 ? uTileA.y : k == 2 ? uTileA.z : k == 3 ? uTileA.w : uTileB;
        if (k == 2 && slopeF > 0.12) {
          // Roche triplanaire (pentes fortes), normales en mélange « UDN » (B. Golus).
          vec3 bw = pow(abs(Nw), vec3(4.0));
          bw /= (bw.x + bw.y + bw.z);
          vec3 sg = sign(Nw + 1e-5);
          vec3 aX, nX, rX, aY, nY, rY, aZ, nZ, rZ;
          vec2 uX = vec2(vTWorld.z * sg.x, vTWorld.y) * s;
          vec2 uY = vec2(vTWorld.x * sg.y, vTWorld.z) * s;
          vec2 uZ = vec2(-vTWorld.x * sg.z, vTWorld.y) * s;
          tSample(k, uX, dFdx(uX), dFdy(uX), far, aX, nX, rX);
          tSample(k, uY, dFdx(uY), dFdy(uY), far, aY, nY, rY);
          tSample(k, uZ, dFdx(uZ), dFdy(uZ), far, aZ, nZ, rZ);
          albs[k] = aX * bw.x + aY * bw.y + aZ * bw.z;
          arms[k] = rX * bw.x + rY * bw.y + rZ * bw.z;
          nX.x *= sg.x; nY.x *= sg.y; nZ.x *= -sg.z;
          vec3 tX = vec3(nX.xy + Nw.zy, Nw.x);
          vec3 tY = vec3(nY.xy + Nw.xz, Nw.y);
          vec3 tZ = vec3(nZ.xy + Nw.xy, Nw.z);
          vec3 nw = normalize(tX.zyx * bw.x + tY.xzy * bw.y + tZ.xyz * bw.z);
          // Ramené dans le repère tangent commun (T, B, N).
          nrms[k] = vec3(dot(nw, Tf), dot(nw, Bf), dot(nw, Nw));
        } else {
          tSample(k, baseUv * s, bdx * s, bdy * s, far, albs[k], nrms[k], arms[k]);
        }
        hb[k] = w[k] * (0.35 + arms[k].r);
        hmax = max(hmax, hb[k]);
      }
    }
    // Étalonnage par couche : herbe selon l'humidité (sèche -> grasse), roche désaturée (granite gris),
    // sol forestier assombri. Indispensable de loin, où la moyenne des textures domine.
    float moist = vEnv.x;
    float forestD = vEnv.y;
    albs[0] *= mix(uGrassDry, uGrassLush, smoothstep(0.25, 0.8, moist + (mac.g - 0.5) * 0.35)) * mix(1.0, 0.94, far);
    float lr = dot(albs[2], vec3(0.299, 0.587, 0.114));
    albs[2] = mix(albs[2], vec3(lr) * vec3(1.02, 0.99, 0.94), 0.78);
    albs[1] *= mix(1.0, 0.72, forestD);
    // Mélange par hauteur : transitions franches et naturelles.
    float wsum = 0.0;
    for (int k = 0; k < 5; k++) { hb[k] = max(hb[k] - hmax * 0.55, 0.0); wsum += hb[k]; }
    vec3 alb = vec3(0.0); vec3 tn = vec3(0.0); vec3 arm = vec3(0.0);
    for (int k = 0; k < 5; k++) {
      float f = hb[k] / max(wsum, 1e-4);
      alb += albs[k] * f; tn += nrms[k] * f; arm += arms[k] * f;
    }
    // Variation macroscopique (teinte et luminosité, deux fréquences).
    float m = (mac.r - 0.5) * 0.9 + (mac2.g - 0.5) * 0.5;
    alb *= 1.0 + m * uMacroStrength;
    alb = mix(alb, alb * vec3(1.06, 1.0, 0.86), clamp((mac.b - 0.45) * 2.0, 0.0, 1.0) * 0.35 * (w[0]));
    // Sable / berge mouillés juste au-dessus de l'eau.
    float wet = 1.0 - smoothstep(uWaterLevel + 0.05, uWaterLevel + 0.9, vTWorld.y);
    alb *= 1.0 - 0.38 * wet;
    // Normale finale (repère tangent XZ : T = +X, B = -Z, N = normale géométrique).
    tn.xy *= mix(1.0, 0.45, far);
    tWorldN = normalize(Tf * tn.x + Bf * tn.y + Nw * max(tn.z, 0.2));
    tAlbedo = alb;
    tRough = clamp(mix(arm.g, 0.25, wet * 0.8), 0.04, 1.0);
    tAO = arm.r;
  }
  diffuseColor.rgb *= tAlbedo;
`;

export interface TerrainMaterialHandle {
  material: THREE.MeshStandardMaterial;
  uniforms: { uWaterLevel: { value: number }; uMacroStrength: { value: number } };
}

/** Crée le matériau de terrain (partagé par tous les chunks). */
export function createTerrainMaterial(tex: TerrainTextures, waterLevel: number): TerrainMaterialHandle {
  const uniforms = {
    tAlb: { value: tex.albedo },
    tNor: { value: tex.normal },
    tArm: { value: tex.arm },
    tMacro: { value: tex.macro },
    uTileA: { value: new THREE.Vector4(1 / tex.tileSizes[0]!, 1 / tex.tileSizes[1]!, 1 / tex.tileSizes[2]!, 1 / tex.tileSizes[3]!) },
    uTileB: { value: 1 / tex.tileSizes[4]! },
    uWaterLevel: { value: waterLevel },
    uMacroStrength: { value: 0.32 },
    uGrassDry: { value: new THREE.Color(0.9, 0.9, 0.64) },
    uGrassLush: { value: new THREE.Color(0.66, 0.88, 0.5) },
  };
  const material = new THREE.MeshStandardMaterial({ name: 'terrain_pbr', roughness: 1, metalness: 0 });
  material.customProgramCacheKey = (): string => 'aube-terrain-v1';
  material.onBeforeCompile = (shader): void => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_DECL}`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\n${VERT_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_DECL}`)
      .replace('#include <map_fragment>', FRAG_MAIN)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = tRough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = 0.0;')
      .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(tWorldN, 0.0)).xyz);')
      .replace('#include <aomap_fragment>', `
        float ambientOcclusion = mix(1.0, tAO, 0.85);
        reflectedLight.indirectDiffuse *= ambientOcclusion;
        reflectedLight.indirectSpecular *= ambientOcclusion;
      `);
  };
  return { material, uniforms };
}
