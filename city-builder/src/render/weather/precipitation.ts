/**
 * Précipitations (phase 2C « Atmosphère ») : pluie et neige en particules instanciées, animées entièrement
 * dans le vertex shader (aucune mise à jour CPU par particule) — 1 appel de rendu par type, 2 au plus.
 *
 * Les particules sont ancrées dans le monde (elles ne suivent pas la caméra) et répliquées dans une boîte qui,
 * elle, accompagne la caméra (repliement modulo la taille de la boîte) ; la boîte grandit avec l'altitude de la
 * caméra pour que la pluie reste lisible en vue aérienne. Le nombre d'instances dessinées suit l'intensité.
 */
import * as THREE from 'three';

const VERT = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime;
uniform vec3 uOrigin;
uniform vec3 uBox;
uniform vec3 uVel;
uniform float uSize;
uniform float uLength;
uniform float uSnow;
uniform vec3 uCam;
varying float vAlpha;
varying vec2 vUv;
#include <fog_pars_vertex>
void main() {
  vec3 base = aSeed.xyz * uBox + uVel * uTime * (0.85 + 0.3 * aSeed.w);
  if (uSnow > 0.5) {
    // Flocons : balancement latéral propre à chacun.
    float ph = aSeed.w * 6.2831 + uTime * (0.6 + aSeed.w);
    base.x += sin(ph) * 0.9;
    base.z += cos(ph * 0.8) * 0.9;
  }
  vec3 rel = mod(base - uOrigin, uBox);
  vec3 wp = uOrigin + rel;
  // Fondu sur les bords de la boîte (pas d'apparition brutale au repliement).
  vec3 e = min(rel, uBox - rel) / (uBox * 0.12);
  float edge = clamp(min(min(e.x, e.y), e.z), 0.0, 1.0);
  vec3 toCam = uCam - wp;
  float dist = length(toCam);
  vec3 view = toCam / max(dist, 1e-3);
  vec3 axis = uSnow > 0.5 ? vec3(0.0, 1.0, 0.0) : normalize(uVel);
  vec3 side = normalize(cross(axis, view));
  vec3 upv = uSnow > 0.5 ? normalize(cross(view, side)) : axis;
  float len = uSnow > 0.5 ? uSize : uLength * (0.7 + 0.6 * aSeed.w);
  float wid = uSize * (uSnow > 0.5 ? 1.0 : 1.0);
  wp += side * position.x * wid + upv * position.y * len;
  vUv = position.xy + 0.5;
  // Les gouttes trop proches (taille écran énorme) ou trop lointaines s'estompent.
  vAlpha = edge * smoothstep(1.5, 5.0, dist);
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uSnow;
varying float vAlpha;
varying vec2 vUv;
#include <fog_pars_fragment>
void main() {
  float a;
  if (uSnow > 0.5) {
    vec2 q = vUv - 0.5;
    a = smoothstep(0.5, 0.15, length(q));
  } else {
    // Trait fin, plus dense au centre, effilé aux extrémités.
    a = smoothstep(0.5, 0.0, abs(vUv.x - 0.5)) * smoothstep(0.0, 0.3, vUv.y) * smoothstep(1.0, 0.6, vUv.y);
  }
  a *= vAlpha * uOpacity;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, a);
  #include <fog_fragment>
}
`;

export interface PrecipOptions {
  /** Nombre maximal de gouttes / flocons. */
  maxRain: number;
  maxSnow: number;
}

function makeLayer(count: number, snow: boolean, seed: number): THREE.Mesh {
  const geo = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(1, 1);
  geo.index = quad.index;
  geo.setAttribute('position', quad.getAttribute('position'));
  const seeds = new Float32Array(count * 4);
  let s = seed >>> 0;
  const rnd = (): number => { s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0; return ((s ^ (s >>> 13)) >>> 0) / 4294967296; };
  for (let i = 0; i < count * 4; i++) seeds[i] = rnd();
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
  geo.instanceCount = 0;
  const mat = new THREE.ShaderMaterial({
    name: snow ? 'meteo_neige' : 'meteo_pluie',
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uOrigin: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(60, 40, 60) },
      uVel: { value: new THREE.Vector3(0, -9, 0) }, uSize: { value: snow ? 0.12 : 0.02 }, uLength: { value: 0.9 },
      uSnow: { value: snow ? 1 : 0 }, uCam: { value: new THREE.Vector3() },
      uColor: { value: new THREE.Color(snow ? 0xf4f7ff : 0xb8c4d2) }, uOpacity: { value: snow ? 0.9 : 0.35 },
    }]),
    vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, fog: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = snow ? 'meteo_neige' : 'meteo_pluie';
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  mesh.visible = false;
  return mesh;
}

export class PrecipitationSystem {
  readonly rain: THREE.Mesh;
  readonly snow: THREE.Mesh;
  private time = 0;
  private readonly fwd = new THREE.Vector3();
  private readonly camPos = new THREE.Vector3();

  constructor(private readonly scene: THREE.Scene, readonly opts: PrecipOptions) {
    this.rain = makeLayer(opts.maxRain, false, 0x51a7);
    this.snow = makeLayer(opts.maxSnow, true, 0x9e3d);
    scene.add(this.rain, this.snow);
  }

  /** Intensités 0..1, vent (m/s, direction d'où il vient), éclairage (couleur ambiante linéaire). */
  update(dt: number, camera: THREE.PerspectiveCamera, rain: number, snow: number, wind: number, windDir: number, light: THREE.Color): void {
    this.time += dt;
    camera.getWorldPosition(this.camPos);
    camera.getWorldDirection(this.fwd);
    const ground = 0;
    const alt = Math.max(5, this.camPos.y - ground);
    // Boîte : plus grande en vue aérienne, centrée devant la caméra.
    const size = THREE.MathUtils.clamp(alt * 0.55, 34, 190);
    const height = THREE.MathUtils.clamp(alt * 0.6, 26, 160);
    // Vent : vers où il souffle (direction d'origine + π). Nord = -Z, est = +X.
    const wx = -Math.sin(windDir) * wind, wz = Math.cos(windDir) * wind;
    const layers: [THREE.Mesh, number, number][] = [[this.rain, rain, this.opts.maxRain], [this.snow, snow, this.opts.maxSnow]];
    for (const [mesh, k, max] of layers) {
      const geo = mesh.geometry as THREE.InstancedBufferGeometry;
      const n = Math.floor(max * Math.min(1, k * 1.15));
      mesh.visible = n > 16;
      geo.instanceCount = n;
      if (!mesh.visible) continue;
      const u = (mesh.material as THREE.ShaderMaterial).uniforms;
      const isSnow = mesh === this.snow;
      const scale = size / 60;
      (u['uBox']!.value as THREE.Vector3).set(size, height, size);
      (u['uOrigin']!.value as THREE.Vector3).copy(this.camPos).addScaledVector(this.fwd, size * 0.42).sub(new THREE.Vector3(size / 2, height / 2, size / 2));
      (u['uCam']!.value as THREE.Vector3).copy(this.camPos);
      if (isSnow) (u['uVel']!.value as THREE.Vector3).set(wx * 0.35, -1.3, wz * 0.35);
      else (u['uVel']!.value as THREE.Vector3).set(wx * 0.6, -11, wz * 0.6);
      u['uTime']!.value = this.time;
      // Taille apparente constante d'une vue à l'autre (l'œil voit autant de traits en vue aérienne qu'en rue).
      u['uSize']!.value = (isSnow ? 0.13 : 0.024) * Math.max(1, scale * 0.9);
      u['uLength']!.value = 0.95 * Math.max(1, scale * 0.8);
      const l = (light.r + light.g + light.b) / 3;
      const c = u['uColor']!.value as THREE.Color;
      if (isSnow) c.setRGB(1, 1, 1).multiplyScalar(THREE.MathUtils.clamp(0.25 + l * 1.4, 0.18, 1.0));
      else c.setRGB(0.72, 0.78, 0.86).multiplyScalar(THREE.MathUtils.clamp(0.2 + l * 1.3, 0.14, 1.0));
      u['uOpacity']!.value = isSnow ? 0.95 : 0.32 + 0.25 * k;
    }
  }

  stats(): { calls: number; instances: number } {
    let calls = 0, instances = 0;
    for (const m of [this.rain, this.snow]) if (m.visible) { calls++; instances += (m.geometry as THREE.InstancedBufferGeometry).instanceCount; }
    return { calls, instances };
  }

  setEnabled(on: boolean): void {
    if (!on) { this.rain.visible = false; this.snow.visible = false; }
  }

  dispose(): void {
    for (const m of [this.rain, this.snow]) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
      m.removeFromParent();
    }
    void this.scene;
  }
}
