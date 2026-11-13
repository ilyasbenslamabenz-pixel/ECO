/**
 * Animation squelettique INSTANCIÉE : les clips d'un personnage sont cuits dans une texture flottante
 * (une ligne par image, 4 texels par os = une matrice 4×4) ; le nuanceur de sommets lit les matrices des os de
 * la ligne propre à chaque instance (`aPed.x`), ce qui anime des milliers de piétons en un appel de dessin par
 * (personnage, LOD), chacun à sa phase de marche. La couleur vient d'une palette (texture 8 × N) : la colonne
 * est la « partie » du sommet (peau, cheveux, haut, bas… = TEXCOORD_0.x), la ligne est propre à l'instance
 * (`aPed.y`). Fonctionne en WebGL2 (texelFetch, textures RGBA32F en lecture ponctuelle).
 */
import * as THREE from 'three';
import { PED_PARTS } from './manifest';

export interface BakedClip { row0: number; frames: number; duration: number }
export interface BakedSkeleton { texture: THREE.DataTexture; clips: Record<string, BakedClip>; bones: number }

/** Images cuites par seconde de clip. */
export const BAKE_FPS = 40;

/**
 * Cuit les clips `names` (pris dans `clips`, souvent ceux du LOD0) sur le squelette du maillage skinné de `root`.
 * Chaque matrice cuite vaut boneMatrix × bindMatrix : elle transforme un sommet au repos (attributs bruts de la
 * géométrie, éventuellement quantifiés) vers l'espace du modèle (mètres, pieds à y = 0, regard vers +Z).
 */
export function bakeSkeleton(root: THREE.Object3D, mesh: THREE.SkinnedMesh, clips: readonly THREE.AnimationClip[], names: readonly string[]): BakedSkeleton {
  const skeleton = mesh.skeleton;
  const nb = skeleton.bones.length;
  const plan = names.map((name) => {
    const clip = clips.find((c) => c.name === name);
    if (!clip) throw new Error(`Animation « ${name} » absente`);
    return { name, clip, frames: Math.max(2, Math.round(clip.duration * BAKE_FPS)) };
  });
  const rows = plan.reduce((s, p) => s + p.frames, 0);
  const width = nb * 4;
  const data = new Float32Array(width * rows * 4);
  const mixer = new THREE.AnimationMixer(root);
  const m = new THREE.Matrix4();
  const out: Record<string, BakedClip> = {};
  let row = 0;
  for (const p of plan) {
    const action = mixer.clipAction(p.clip);
    action.play();
    out[p.name] = { row0: row, frames: p.frames, duration: p.clip.duration };
    for (let f = 0; f < p.frames; f++) {
      // Boucle : l'image `frames` serait identique à l'image 0, on échantillonne [0, durée[.
      mixer.setTime((f / p.frames) * p.clip.duration);
      root.updateMatrixWorld(true);
      skeleton.update();
      for (let b = 0; b < nb; b++) {
        m.fromArray(skeleton.boneMatrices, b * 16).multiply(mesh.bindMatrix);
        data.set(m.elements, (row * width + b * 4) * 4);
      }
      row++;
    }
    action.stop();
    mixer.uncacheAction(p.clip);
  }
  mixer.stopAllAction();
  const texture = new THREE.DataTexture(data, width, rows, THREE.RGBAFormat, THREE.FloatType);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return { texture, clips: out, bones: nb };
}

/** Texture de palette : PED_PARTS colonnes × N rangées (sRGB 8 bits). */
export function paletteTexture(palettes: readonly { colors: readonly string[] }[]): THREE.DataTexture {
  const data = new Uint8Array(PED_PARTS * palettes.length * 4);
  const c = new THREE.Color();
  palettes.forEach((p, r) => {
    for (let k = 0; k < PED_PARTS; k++) {
      c.set(p.colors[k] ?? '#808080');
      // THREE.Color.set convertit en linéaire : on réécrit les octets sRGB d'origine.
      const hex = c.getHex(THREE.SRGBColorSpace);
      const o = (r * PED_PARTS + k) * 4;
      data[o] = (hex >> 16) & 255; data[o + 1] = (hex >> 8) & 255; data[o + 2] = hex & 255; data[o + 3] = 255;
    }
  });
  const t = new THREE.DataTexture(data, PED_PARTS, palettes.length, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = THREE.SRGBColorSpace;
  t.minFilter = THREE.NearestFilter;
  t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

/** Déclarations GLSL communes (sommets) : os par texture, palette. */
export const PED_VERTEX_PARS = /* glsl */ `
uniform highp sampler2D uPedBones;
uniform sampler2D uPedPalette;
attribute vec4 aPed;
attribute vec4 skinIndex;
attribute vec4 skinWeight;
varying vec3 vPedColor;
mat4 pedBone(float b, int row) {
  int x = int(b + 0.5) * 4;
  return mat4(texelFetch(uPedBones, ivec2(x, row), 0), texelFetch(uPedBones, ivec2(x + 1, row), 0),
              texelFetch(uPedBones, ivec2(x + 2, row), 0), texelFetch(uPedBones, ivec2(x + 3, row), 0));
}
mat4 pedSkinMatrix() {
  int row = int(aPed.x + 0.5);
  vec4 w = skinWeight / max(1e-5, skinWeight.x + skinWeight.y + skinWeight.z + skinWeight.w);
  return w.x * pedBone(skinIndex.x, row) + w.y * pedBone(skinIndex.y, row) + w.z * pedBone(skinIndex.z, row) + w.w * pedBone(skinIndex.w, row);
}
vec3 pedPaletteColor() {
  return texelFetch(uPedPalette, ivec2(int(clamp(uv.x, 0.0, 0.999) * ${PED_PARTS}.0), int(aPed.y + 0.5)), 0).rgb;
}
`;

export interface PedUniforms { uPedBones: { value: THREE.Texture | null }; uPedPalette: { value: THREE.Texture | null } }

/**
 * Greffe l'animation par texture et la palette sur un matériau standard (ou de profondeur) de three.
 * `color` : applique la palette (inutile pour le matériau de profondeur des ombres).
 */
export function patchPedMaterial(mat: THREE.Material, uniforms: PedUniforms, color: boolean): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uPedBones = uniforms.uPedBones;
    shader.uniforms.uPedPalette = uniforms.uPedPalette;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${PED_VERTEX_PARS}`)
      .replace('#include <skinbase_vertex>', 'mat4 pedSkin = pedSkinMatrix();')
      .replace('#include <skinnormal_vertex>', 'objectNormal = mat3(pedSkin) * objectNormal;')
      .replace('#include <skinning_vertex>', 'transformed = (pedSkin * vec4(transformed, 1.0)).xyz;');
    if (color) {
      shader.vertexShader = shader.vertexShader.replace('#include <color_vertex>', '#include <color_vertex>\nvPedColor = pedPaletteColor();');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vPedColor;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vPedColor;');
    }
  };
  // Un programme par jeu d'uniformes n'est pas nécessaire : les uniformes sont mis à jour par objet (onBeforeRender).
  mat.customProgramCacheKey = () => (color ? 'pieton-couleur' : 'pieton-profondeur');
}
