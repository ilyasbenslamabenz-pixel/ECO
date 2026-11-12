/**
 * Imposteurs d'arbres (rendu lointain) : chaque essence est rendue une fois, au chargement, sous
 * 8 azimuts x 3 élévations dans deux atlas (albedo sRGB + normales monde). Au-delà de quelques
 * centaines de mètres, chaque arbre devient un quad orienté vers la caméra qui affiche la vue
 * précalculée la plus proche ; il est éclairé (soleil + ciel) avec ses vraies normales et reçoit le brouillard.
 * C'est une vraie vue du modèle GLB, pas un sprite dessiné à la main.
 */
import * as THREE from 'three';

export const IMP_AZ = 8;
export const IMP_EL = 3;
/** Élévations des vues (rad). */
export const IMP_ELEVATIONS = [THREE.MathUtils.degToRad(8), THREE.MathUtils.degToRad(38), THREE.MathUtils.degToRad(72)];

export interface ImpostorAtlas {
  albedo: THREE.Texture;
  normal: THREE.Texture;
  /** Rayon de la sphère englobante (m, échelle 1) et hauteur de son centre. */
  radius: number;
  centerY: number;
  frame: number;
  /** Diagnostic : couleur moyenne (0..255) des pixels couverts et taux de couverture de l'atlas albedo. */
  check: { meanRgb: [number, number, number]; coverage: number };
  dispose(): void;
}

const NORMAL_VERT = /* glsl */ `
varying vec3 vN;
varying vec2 vUv;
void main() {
  vUv = uv;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const NORMAL_FRAG = /* glsl */ `
uniform sampler2D map;
uniform float useMap;
uniform float alphaTest;
varying vec3 vN;
varying vec2 vUv;
void main() {
  float a = useMap > 0.5 ? texture2D(map, vUv).a : 1.0;
  if (a < alphaTest) discard;
  vec3 n = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);
  gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);
}`;

/** Fabrique l'atlas d'imposteur d'un modèle (racine glTF chargée). */
export function bakeImpostor(renderer: THREE.WebGLRenderer, model: THREE.Object3D, frame = 128): ImpostorAtlas {
  const box = new THREE.Box3().setFromObject(model);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const r = sphere.radius;
  const scene = new THREE.Scene();
  const clone = model.clone(true);
  scene.add(clone);
  scene.add(new THREE.AmbientLight(0xffffff, 1));
  const W = frame * IMP_AZ;
  const H = frame * IMP_EL;
  const mk = (srgb: boolean): THREE.WebGLRenderTarget => {
    const rt = new THREE.WebGLRenderTarget(W, H, { depthBuffer: true, samples: 0 });
    rt.texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    rt.texture.generateMipmaps = true;
    rt.texture.minFilter = THREE.LinearMipmapLinearFilter;
    rt.texture.magFilter = THREE.LinearFilter;
    return rt;
  };
  const rtA = mk(true);
  const rtN = mk(false);
  // Matériaux de capture : albedo non éclairé (couleur + texture + alpha test) et normales monde.
  const albedoMats = new Map<THREE.Material, THREE.Material>();
  const normalMats = new Map<THREE.Material, THREE.ShaderMaterial>();
  clone.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const src = m.material as THREE.MeshStandardMaterial;
    if (!albedoMats.has(src)) {
      albedoMats.set(src, new THREE.MeshBasicMaterial({ map: src.map ?? null, color: src.color ?? new THREE.Color(1, 1, 1), alphaTest: Math.max(0.35, src.alphaTest || 0), side: THREE.DoubleSide, transparent: false }));
      normalMats.set(src, new THREE.ShaderMaterial({
        uniforms: { map: { value: src.map ?? null }, useMap: { value: src.map ? 1 : 0 }, alphaTest: { value: Math.max(0.35, src.alphaTest || 0) } },
        vertexShader: NORMAL_VERT, fragmentShader: NORMAL_FRAG, side: THREE.DoubleSide,
      }));
    }
    m.userData['impSrc'] = src;
  });
  const cam = new THREE.OrthographicCamera(-r, r, r, -r, 0.01, r * 4);
  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  const prevShadow = renderer.shadowMap.enabled;
  const prevTone = renderer.toneMapping;
  renderer.shadowMap.enabled = false;
  renderer.toneMapping = THREE.NoToneMapping;
  const pass = (rt: THREE.WebGLRenderTarget, which: 'a' | 'n'): void => {
    clone.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const src = m.userData['impSrc'] as THREE.Material;
      m.material = which === 'a' ? albedoMats.get(src)! : normalMats.get(src)!;
    });
    renderer.setRenderTarget(rt);
    renderer.setClearColor(which === 'a' ? 0x3c4a2e : 0x8080ff, 0);
    rt.scissorTest = false;
    rt.viewport.set(0, 0, W, H);
    renderer.setRenderTarget(rt);
    renderer.clear(true, true, true);
    rt.scissorTest = true;
    for (let e = 0; e < IMP_EL; e++) {
      for (let a = 0; a < IMP_AZ; a++) {
        const az = (a / IMP_AZ) * Math.PI * 2;
        const el = IMP_ELEVATIONS[e]!;
        cam.position.set(sphere.center.x + Math.sin(az) * Math.cos(el) * r * 2, sphere.center.y + Math.sin(el) * r * 2, sphere.center.z + Math.cos(az) * Math.cos(el) * r * 2);
        cam.lookAt(sphere.center);
        cam.updateMatrixWorld();
        rt.viewport.set(a * frame, e * frame, frame, frame);
        rt.scissor.set(a * frame, e * frame, frame, frame);
        renderer.setRenderTarget(rt);
        renderer.render(scene, cam);
      }
    }
    rt.scissorTest = false;
  };
  pass(rtA, 'a');
  pass(rtN, 'n');
  // Contrôle : l'atlas contient bien des pixels couverts et colorés (pas un rendu vide ou noir).
  const px = new Uint8Array(W * H * 4);
  renderer.readRenderTargetPixels(rtA, 0, 0, W, H, px);
  let cov = 0;
  const sum = [0, 0, 0];
  for (let k = 0; k < W * H; k++) {
    if (px[k * 4 + 3]! < 128) continue;
    cov++;
    sum[0]! += px[k * 4]!; sum[1]! += px[k * 4 + 1]!; sum[2]! += px[k * 4 + 2]!;
  }
  const check = { meanRgb: [sum[0]! / Math.max(1, cov), sum[1]! / Math.max(1, cov), sum[2]! / Math.max(1, cov)] as [number, number, number], coverage: cov / (W * H) };
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevClear, prevAlpha);
  renderer.shadowMap.enabled = prevShadow;
  renderer.toneMapping = prevTone;
  for (const m of albedoMats.values()) m.dispose();
  for (const m of normalMats.values()) m.dispose();
  return {
    albedo: rtA.texture,
    normal: rtN.texture,
    radius: r,
    centerY: sphere.center.y,
    frame,
    check,
    dispose() { rtA.dispose(); rtN.dispose(); },
  };
}

const IMP_VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
uniform float uRadius;
uniform float uCenterY;
attribute vec3 instanceTint;
varying vec2 vUv;
varying float vRot;
varying vec3 vTint;
varying vec3 vWorldPos;
varying vec3 vViewDir;
void main() {
  vec3 c = instanceMatrix[3].xyz;
  float s = length(instanceMatrix[0].xyz);
  // makeRotationY(t) : colonne 0 = (cos t, 0, -sin t).
  float rot = atan(-instanceMatrix[0].z, instanceMatrix[0].x);
  vec3 center = c + vec3(0.0, uCenterY * s, 0.0);
  vec3 toCam = cameraPosition - center;
  float dist = length(toCam);
  vec3 v = toCam / dist;
  // Direction de vue dans le repère local de l'arbre (rotation Y inverse).
  float cr = cos(rot), sr = sin(rot);
  vec3 lv = vec3(cr * v.x - sr * v.z, v.y, sr * v.x + cr * v.z);
  float az = atan(lv.x, lv.z);
  if (az < 0.0) az += 6.2831853;
  float ai = mod(floor(az / 6.2831853 * ${IMP_AZ.toFixed(1)} + 0.5), ${IMP_AZ.toFixed(1)});
  float el = asin(clamp(lv.y, -1.0, 1.0));
  float ei = el < ${((IMP_ELEVATIONS[0]! + IMP_ELEVATIONS[1]!) / 2).toFixed(4)} ? 0.0 : (el < ${((IMP_ELEVATIONS[1]! + IMP_ELEVATIONS[2]!) / 2).toFixed(4)} ? 1.0 : 2.0);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), v));
  vec3 up = cross(v, right);
  float R = uRadius * s;
  vec3 wp = center + right * position.x * R + up * position.y * R;
  vUv = (vec2(ai, ei) + (position.xy * 0.5 + 0.5)) / vec2(${IMP_AZ.toFixed(1)}, ${IMP_EL.toFixed(1)});
  vRot = rot;
  vTint = instanceTint;
  vWorldPos = wp;
  vViewDir = v;
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const IMP_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform sampler2D tAlb;
uniform sampler2D tNor;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSky;
uniform vec3 uGround;
uniform float uEnv;
varying vec2 vUv;
varying float vRot;
varying vec3 vTint;
varying vec3 vWorldPos;
varying vec3 vViewDir;
void main() {
  vec4 a = texture2D(tAlb, vUv);
  // Alpha « net » malgré les mipmaps (préserve la couverture du feuillage au loin).
  float al = (a.a - 0.3) / max(fwidth(a.a), 0.0001) + 0.5;
  if (al < 0.5) discard;
  a.rgb /= max(a.a, 0.35);
  vec3 n = texture2D(tNor, vUv).xyz * 2.0 - 1.0;
  // Normales capturées pour l'arbre à rotation nulle : on applique la rotation de l'instance.
  float c = cos(vRot), s = sin(vRot);
  n = normalize(vec3(c * n.x + s * n.z, n.y, -s * n.x + c * n.z));
  vec3 alb = a.rgb * vTint;
  float ndl = max(dot(n, uSunDir), 0.0);
  // Feuillage : transmission diffuse légère (lumière traversant les feuilles).
  float wrap = max(dot(-n, uSunDir), 0.0) * 0.25;
  vec3 amb = mix(uGround, uSky, n.y * 0.5 + 0.5) * uEnv;
  vec3 col = alb * (uSunColor * (ndl + wrap) * 0.95 + amb);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export interface ImpostorMaterialUniforms {
  uSunDir: { value: THREE.Vector3 };
  uSunColor: { value: THREE.Color };
  uSky: { value: THREE.Color };
  uGround: { value: THREE.Color };
  uEnv: { value: number };
}

/** Matériau des imposteurs d'une essence ; `lights` est partagé par toutes les essences. */
export function makeImpostorMaterial(atlas: ImpostorAtlas, lights: ImpostorMaterialUniforms): THREE.ShaderMaterial {
  const uniforms: Record<string, THREE.IUniform> = {
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    tAlb: { value: atlas.albedo },
    tNor: { value: atlas.normal },
    uRadius: { value: atlas.radius },
    uCenterY: { value: atlas.centerY },
    ...lights,
  };
  return new THREE.ShaderMaterial({ name: 'imposteur_arbre', uniforms, vertexShader: IMP_VERT, fragmentShader: IMP_FRAG, fog: true, side: THREE.DoubleSide });
}
