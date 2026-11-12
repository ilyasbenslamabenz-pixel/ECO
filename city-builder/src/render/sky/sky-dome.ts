/**
 * Dôme de ciel : HDRI Poly Haven (jour + crépuscule, CC0) tournés pour que leur soleil coïncide
 * avec l'azimut du soleil simulé, soleil « effacé » des images (sa lumière est portée par la
 * lumière directionnelle), disque solaire réel, nuit étoilée procédurale et lune avec phase.
 * Le même dôme sert de source à la carte d'environnement (PMREM) : fond, réflexions et éclairage
 * ambiant restent cohérents à toute heure.
 */
import * as THREE from 'three';

export interface HdriSource {
  texture: THREE.DataTexture;
  /** Direction du soleil détecté dans l'image (repère monde, avant rotation). */
  sunAzimuth: number;
  sunElevation: number;
  /** Couleur moyenne de l'horizon (linéaire, avant exposition) pour le brouillard. */
  horizon: THREE.Color;
  /** Couleur moyenne du zénith. */
  zenith: THREE.Color;
}

/**
 * Prépare un HDRI équirectangulaire (Float32 RGBA) : repère le soleil, le remplace par le ciel
 * environnant (inpainting radial), borne les valeurs extrêmes, convertit en demi-flottants (filtrables partout).
 */
export function prepareHdri(src: { width: number; height: number; data: Float32Array | Uint16Array }, isHalf: boolean): HdriSource {
  const { width: W, height: H } = src;
  const n = W * H;
  const f = new Float32Array(n * 4);
  for (let k = 0; k < n * 4; k++) f[k] = isHalf ? THREE.DataUtils.fromHalfFloat((src.data as Uint16Array)[k]!) : (src.data as Float32Array)[k]!;
  // Soleil = pixel le plus lumineux de l'hémisphère supérieur.
  let best = 0;
  let bi = 0;
  let bj = 0;
  for (let j = 0; j < H / 2; j++) {
    for (let i = 0; i < W; i++) {
      const o = (j * W + i) * 4;
      const l = f[o]! * 0.2126 + f[o + 1]! * 0.7152 + f[o + 2]! * 0.0722;
      if (l > best) { best = l; bi = i; bj = j; }
    }
  }
  // Conventions three (equirect) : u = atan(dir.z, dir.x) / 2π + 0.5 ; v = asin(dir.y) / π + 0.5 ; ligne 0 = haut (flipY false).
  const u = (bi + 0.5) / W;
  const v = 1 - (bj + 0.5) / H;
  const sunAz = (u - 0.5) * Math.PI * 2;
  const sunEl = (v - 0.5) * Math.PI;
  const dir = (i: number, j: number, out: THREE.Vector3): THREE.Vector3 => {
    const uu = (i + 0.5) / W;
    const vv = 1 - (j + 0.5) / H;
    const az = (uu - 0.5) * Math.PI * 2;
    const el = (vv - 0.5) * Math.PI;
    return out.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
  };
  const sunDir = new THREE.Vector3(Math.cos(sunEl) * Math.cos(sunAz), Math.sin(sunEl), Math.cos(sunEl) * Math.sin(sunAz));
  const tmp = new THREE.Vector3();
  // Anneau de référence (6..9°) : couleur moyenne du ciel autour du soleil.
  const ring = [0, 0, 0];
  let rn = 0;
  const inner = Math.cos(THREE.MathUtils.degToRad(6));
  const outer = Math.cos(THREE.MathUtils.degToRad(9));
  const r0 = Math.max(0, bj - Math.ceil(H * 0.06));
  const r1 = Math.min(H - 1, bj + Math.ceil(H * 0.06));
  for (let j = r0; j <= r1; j++) {
    for (let i = 0; i < W; i++) {
      const c = dir(i, j, tmp).dot(sunDir);
      if (c < inner && c > outer) {
        const o = (j * W + i) * 4;
        ring[0]! += f[o]!; ring[1]! += f[o + 1]!; ring[2]! += f[o + 2]!; rn++;
      }
    }
  }
  if (rn > 0) { ring[0]! /= rn; ring[1]! /= rn; ring[2]! /= rn; }
  const cut = Math.cos(THREE.MathUtils.degToRad(6));
  const soft = Math.cos(THREE.MathUtils.degToRad(3));
  for (let j = r0; j <= r1; j++) {
    for (let i = 0; i < W; i++) {
      const c = dir(i, j, tmp).dot(sunDir);
      if (c <= cut) continue;
      const o = (j * W + i) * 4;
      const t = THREE.MathUtils.smoothstep(c, cut, soft);
      for (let ch = 0; ch < 3; ch++) f[o + ch] = f[o + ch]! * (1 - t) + ring[ch]! * t;
    }
  }
  // Bornage : plus aucune source ponctuelle (le soleil est porté par la lumière directionnelle).
  const lim = Math.max(ring[0]!, ring[1]!, ring[2]!) * 1.6 + 0.5;
  const hz = [0, 0, 0];
  const zn = [0, 0, 0];
  let hn = 0;
  let zc = 0;
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const o = (j * W + i) * 4;
      for (let ch = 0; ch < 3; ch++) f[o + ch] = Math.min(f[o + ch]!, lim);
      f[o + 3] = 1;
      const vv = 1 - (j + 0.5) / H;
      if (vv > 0.5 && vv < 0.53) { hz[0]! += f[o]!; hz[1]! += f[o + 1]!; hz[2]! += f[o + 2]!; hn++; }
      if (vv > 0.9) { zn[0]! += f[o]!; zn[1]! += f[o + 1]!; zn[2]! += f[o + 2]!; zc++; }
    }
  }
  const half = new Uint16Array(n * 4);
  for (let k = 0; k < n * 4; k++) half[k] = THREE.DataUtils.toHalfFloat(f[k]!);
  const tex = new THREE.DataTexture(half, W, H, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return {
    texture: tex,
    sunAzimuth: sunAz,
    sunElevation: sunEl,
    horizon: new THREE.Color(hz[0]! / Math.max(1, hn), hz[1]! / Math.max(1, hn), hz[2]! / Math.max(1, hn)),
    zenith: new THREE.Color(zn[0]! / Math.max(1, zc), zn[1]! / Math.max(1, zc), zn[2]! / Math.max(1, zc)),
  };
}

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // toujours au plan lointain
}
`;

const FRAG = /* glsl */ `
#define PI 3.141592653589793
uniform sampler2D tDay;
uniform sampler2D tDusk;
uniform float uRotDay;
uniform float uRotDusk;
uniform float uDayW;
uniform float uDuskW;
uniform float uNight;
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunDisc;
uniform vec3 uMoonDir;
uniform float uMoonPhase;
uniform vec3 uFogColor;
uniform float uHorizonFog;
uniform vec3 uNightTint;
varying vec3 vDir;

vec2 equirect(vec3 d, float rot) {
  float az = atan(d.z, d.x) - rot;
  // Ligne 0 de l'image (haut, zénith) = v 0 de la texture (pas de retournement des DataTexture).
  return vec2(az / (2.0 * PI) + 0.5, 0.5 - asin(clamp(d.y, -1.0, 1.0)) / PI);
}
float h31(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }

void main() {
  vec3 d = normalize(vDir);
  vec3 dd = vec3(d.x, max(d.y, 0.02), d.z);
  dd = normalize(dd);
  vec3 col = vec3(0.0);
  if (uDayW > 0.001) col += texture2D(tDay, equirect(dd, uRotDay)).rgb * uDayW;
  if (uDuskW > 0.001) col += texture2D(tDusk, equirect(dd, uRotDusk)).rgb * uDuskW;
  // Nuit : dégradé bleu nuit + étoiles + lune.
  if (uNight > 0.001) {
    float up = clamp(d.y, 0.0, 1.0);
    vec3 nightSky = mix(uNightTint * 1.6, uNightTint * 0.45, pow(up, 0.5));
    // Étoiles : grille de directions, une étoile au plus par cellule.
    vec3 sp = d * 220.0;
    vec3 cell = floor(sp);
    float r = h31(cell);
    float star = 0.0;
    if (r > 0.985) {
      vec3 c = cell + vec3(h31(cell + 1.3), h31(cell + 2.7), h31(cell + 4.1));
      float dist = length(sp - c);
      float tw = 0.75 + 0.25 * sin(uTime * (1.5 + 3.0 * h31(cell + 9.0)) + r * 40.0);
      star = smoothstep(0.42, 0.0, dist) * (r - 0.985) * 66.0 * tw;
    }
    // Voie lactée diffuse.
    float band = exp(-pow(dot(d, normalize(vec3(0.3, 0.55, -0.78))) * 3.2, 2.0));
    float mw = band * 0.045;
    float horizonFade = smoothstep(-0.02, 0.18, d.y);
    vec3 night = nightSky + (vec3(star) * vec3(0.9, 0.95, 1.0) + vec3(mw * 0.8, mw * 0.85, mw)) * horizonFade;
    // Lune : disque éclairé selon la phase, relief en taches.
    float mc = dot(d, uMoonDir);
    float mr = 0.0105;
    if (mc > cos(mr * 1.8)) {
      vec3 mu = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
      vec3 mv = cross(mu, uMoonDir);
      vec2 q = vec2(dot(d - uMoonDir, mu), dot(d - uMoonDir, mv)) / mr;
      float rr = length(q);
      if (rr < 1.0) {
        vec3 sn = vec3(q, sqrt(1.0 - rr * rr));
        float lit = smoothstep(-0.05, 0.08, dot(sn, normalize(vec3(sin(uMoonPhase * 2.0 * PI), 0.0, -cos(uMoonPhase * 2.0 * PI)))));
        float mare = 0.75 + 0.25 * h31(floor(vec3(q * 6.0, 1.0)));
        night = mix(night, vec3(0.95, 0.93, 0.86) * (0.04 + 1.6 * lit * mare), smoothstep(1.0, 0.94, rr));
      }
      night += vec3(0.5, 0.55, 0.7) * 0.25 * pow(max(mc, 0.0), 2000.0);
    }
    col += night * uNight;
  }
  // Disque solaire et halo (absents de la carte d'environnement : uSunDisc = 0).
  float sc = dot(d, uSunDir);
  col += uSunColor * uSunDisc * (smoothstep(0.99996, 0.99999, sc) * 40.0 + pow(max(sc, 0.0), 900.0) * 1.6 + pow(max(sc, 0.0), 12.0) * 0.06);
  // Brume d'horizon raccordée au brouillard de la scène.
  float hf = (1.0 - smoothstep(-0.05, 0.22, d.y)) * uHorizonFog;
  col = mix(col, uFogColor, hf);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createSkyDome(day: HdriSource, dusk: HdriSource): { mesh: THREE.Mesh; uniforms: Record<string, THREE.IUniform> } {
  const uniforms: Record<string, THREE.IUniform> = {
    tDay: { value: day.texture },
    tDusk: { value: dusk.texture },
    uRotDay: { value: 0 },
    uRotDusk: { value: 0 },
    uDayW: { value: 1 },
    uDuskW: { value: 0 },
    uNight: { value: 0 },
    uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color(1, 1, 1) },
    uSunDisc: { value: 1 },
    uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
    uMoonPhase: { value: 0.5 },
    uFogColor: { value: new THREE.Color(0.7, 0.75, 0.8) },
    uHorizonFog: { value: 0.65 },
    uNightTint: { value: new THREE.Color(0.012, 0.018, 0.04) },
  };
  const mat = new THREE.ShaderMaterial({
    name: 'ciel_dome',
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    fog: false,
    toneMapped: true,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
  mesh.name = 'ciel';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.scale.setScalar(5000);
  return { mesh, uniforms };
}
