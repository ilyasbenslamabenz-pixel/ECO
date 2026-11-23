/**
 * Ciel et éclairage d'environnement.
 *  - SkyDome : dôme du ciel. Dégradé zénith / horizon, lueur autour du soleil et sur l'horizon au lever et au
 *    coucher ; en qualité haute et ultra, disque du soleil, nuages procéduraux qui dérivent (éclairés côté soleil),
 *    étoiles et lune la nuit. Couleurs gérées comme le reste de la scène (tone mapping, sRGB).
 *  - AnalyticEnv : carte d'environnement (« PMREM ») calculée directement, sans échantillonnage : chaque niveau de
 *    flou (rugosité) de la carte cubique est rendu par une formule du ciel déjà adoucie (ou d'une pièce éclairée pour
 *    les intérieurs). Quelques dizaines de petits rendus : peut suivre l'heure et la météo en continu.
 * Dépend de three.
 */
import * as THREE from 'three';

/** État du ciel (couleurs linéaires, directions monde normalisées vers l'astre). */
export interface SkyState {
  zenith: THREE.Color; horizon: THREE.Color; ground: THREE.Color;
  sunDir: THREE.Vector3; sunColor: THREE.Color; moonDir: THREE.Vector3;
  /** 0..1 : couverture nuageuse, nuit, crépuscule (lueur de l'horizon). */
  cloud: number; night: number; dusk: number;
}

export function makeSkyState(): SkyState {
  return {
    zenith: new THREE.Color(0.1, 0.3, 0.75), horizon: new THREE.Color(0.55, 0.7, 0.85), ground: new THREE.Color(0.2, 0.22, 0.2),
    sunDir: new THREE.Vector3(0.3, 0.8, 0.3).normalize(), sunColor: new THREE.Color(1, 0.95, 0.85), moonDir: new THREE.Vector3(-0.3, 0.7, 0.4).normalize(),
    cloud: 0, night: 0, dusk: 0,
  };
}

const NOISE = `
float hash2(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float hash3(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), u.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.07 + vec2(17.1, 9.2); a *= 0.5; } return s; }
`;

const SKY_VERT = `varying vec3 vDir;
void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const SKY_FRAG = `uniform vec3 zenith; uniform vec3 horizon; uniform vec3 ground; uniform vec3 sunColor; uniform vec3 sunDir; uniform vec3 moonDir;
uniform float cloud; uniform float night; uniform float dusk; uniform float time;
varying vec3 vDir;
${NOISE}
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(horizon, zenith, pow(clamp(h, 0.0, 1.0), 0.5));
  col = mix(col, ground, smoothstep(0.0, -0.25, h));
  float mu = dot(d, sunDir);
  vec2 hz = normalize(d.xz + vec2(1.0e-4)), sz = normalize(sunDir.xz + vec2(1.0e-4));
  float az = max(dot(hz, sz), 0.0);
  float day = 1.0 - night;
  // Lueur de l'horizon côté soleil (lever, coucher), et halo autour du soleil.
  col += sunColor * (dusk * (0.5 * az * az * az + 0.12) * exp(-max(h, 0.0) * 6.0));
  col += sunColor * day * (0.05 * pow(max(mu, 0.0), 6.0) + 0.3 * pow(max(mu, 0.0), 90.0));
#ifdef SKY_HQ
  // Disque du soleil (très lumineux : le halo de l'image le fait rayonner), voilé par les nuages.
  col += sunColor * (smoothstep(0.99935, 0.9997, mu) * 14.0 * day * (1.0 - 0.85 * cloud));
  if (h > 0.0) {
    // Nuages : bruit projeté sur un plan au-dessus de la ville, qui dérive avec le vent.
    vec2 uv = d.xz / (h + 0.12) * 0.75 + vec2(time * 0.006, time * 0.0025);
    float n = fbm(uv * 1.7);
    float th = mix(0.6, 0.3, cloud);
    float dens = smoothstep(th, th + 0.2, n) * smoothstep(0.0, 0.15, h);
    float n2 = fbm(uv * 1.7 + sunDir.xz * 0.12);
    float lit = clamp(0.62 + (n - n2) * 3.5, 0.0, 1.0);
    float sl = max(sunColor.r, max(sunColor.g, sunColor.b));
    vec3 base = mix(horizon, zenith, 0.35) * mix(0.8, 0.55, cloud);
    vec3 hi = mix(vec3(1.0), sunColor / max(sl, 1.0e-3), 0.55 + 0.45 * dusk) * (0.35 + 0.95 * sl) * day + horizon * 0.25;
    vec3 cc = mix(base, hi, lit * (1.0 - 0.6 * cloud));
    cc += sunColor * (pow(max(mu, 0.0), 12.0) * 0.6 * day);
    col = mix(col, cc, dens * mix(0.85, 0.97, cloud));
    // Étoiles et lune, la nuit (cachées par les nuages).
    float clear = 1.0 - dens;
    if (night > 0.02) {
      vec3 sd = d * 260.0;
      vec3 cell = floor(sd);
      float r = hash3(cell);
      float st = step(0.9965, r) * smoothstep(0.45, 0.05, length(fract(sd) - 0.5));
      col += vec3(0.9, 0.95, 1.0) * st * (0.6 + 1.4 * hash3(cell + 7.0)) * night * clear * smoothstep(0.02, 0.25, h) * (1.0 - cloud);
      float mm = dot(d, moonDir);
      col += vec3(0.75, 0.82, 1.0) * (smoothstep(0.99955, 0.99975, mm) * 3.0 + pow(max(mm, 0.0), 60.0) * 0.12) * night * (1.0 - 0.8 * cloud) * mix(1.0, clear, 0.7);
    }
  }
#endif
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class SkyDome {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  private hq = false;

  constructor(radius: number) {
    this.material = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        zenith: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, ground: { value: new THREE.Color() },
        sunColor: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, moonDir: { value: new THREE.Vector3(0, 1, 0) },
        cloud: { value: 0 }, night: { value: 0 }, dusk: { value: 0 }, time: { value: 0 },
      },
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), this.material);
    this.mesh.renderOrder = 10;
    this.mesh.frustumCulled = false;
  }

  /** Disque du soleil, nuages, étoiles (qualités haute et ultra). */
  setHQ(on: boolean): void {
    if (on === this.hq) return;
    this.hq = on;
    if (on) this.material.defines['SKY_HQ'] = ''; else delete this.material.defines['SKY_HQ'];
    this.material.needsUpdate = true;
  }

  update(s: SkyState, time: number): void {
    const u = this.material.uniforms;
    (u['zenith']!.value as THREE.Color).copy(s.zenith);
    (u['horizon']!.value as THREE.Color).copy(s.horizon);
    (u['ground']!.value as THREE.Color).copy(s.ground);
    (u['sunColor']!.value as THREE.Color).copy(s.sunColor);
    (u['sunDir']!.value as THREE.Vector3).copy(s.sunDir);
    (u['moonDir']!.value as THREE.Vector3).copy(s.moonDir);
    u['cloud']!.value = s.cloud; u['night']!.value = s.night; u['dusk']!.value = s.dusk; u['time']!.value = time;
  }
}

/* ------------------------------ Environnement analytique ------------------------------ */

const ENV_VERT = `varying vec3 vDir;
void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

/**
 * Radiance de l'environnement pour une direction et une rugosité (flou du niveau) : ciel (mode 0) ou pièce éclairée
 * (mode 1 : sol, murs, plafond, plafonniers, vitrine côté +z). Le soleil lui-même n'y est pas (la lumière directe
 * s'en charge) : seulement le ciel, le halo autour du soleil et la lueur de l'horizon.
 */
const ENV_FRAG = `uniform vec3 zenith; uniform vec3 horizon; uniform vec3 ground; uniform vec3 sunColor; uniform vec3 sunDir;
uniform float night; uniform float dusk; uniform float cloud; uniform float roughness; uniform float mode;
uniform vec3 wallColor; uniform vec3 floorColor; uniform vec3 ceilColor; uniform vec3 lampColor; uniform vec3 windowColor;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float r = roughness, h = d.y;
  vec3 c;
  if (mode < 0.5) {
    float w = 0.04 + 0.5 * r;
    vec3 up = mix(horizon, zenith, pow(clamp(h, 0.0, 1.0), mix(0.5, 0.8, r)));
    c = mix(ground, up, smoothstep(-w, w, h));
    // Nuages : ciel plus uniforme et plus gris.
    c = mix(c, vec3(dot(c, vec3(0.3, 0.5, 0.2))) * 1.1, 0.5 * cloud);
    float mu = max(dot(d, sunDir), 0.0);
    vec2 hz = normalize(d.xz + vec2(1.0e-4)), sz = normalize(sunDir.xz + vec2(1.0e-4));
    float az = max(dot(hz, sz), 0.0);
    c += sunColor * (dusk * (0.4 * pow(az, mix(3.0, 1.0, r)) + 0.1) * exp(-abs(h) * mix(6.0, 1.5, r)));
    c += sunColor * ((1.0 - night) * (1.0 - 0.7 * cloud) * 0.08 * pow(mu, mix(10.0, 1.5, r)));
  } else {
    float w = 0.15 + 0.4 * r;
    c = mix(floorColor, wallColor, smoothstep(-0.35 - w, -0.05 + w, h));
    c = mix(c, ceilColor, smoothstep(0.45 - w, 0.8, h));
    float az = atan(d.z, d.x);
    float panels = pow(0.5 + 0.5 * cos(az * 3.0), mix(6.0, 1.0, r));
    c += lampColor * smoothstep(0.78 - 0.5 * r, 0.93, h) * panels * mix(3.0, 1.2, r);
    c += windowColor * smoothstep(0.55 - 0.45 * r, 0.85, d.z) * smoothstep(0.5 + 0.3 * r, 0.05, abs(h - 0.05));
  }
  gl_FragColor = vec4(c, 1.0);
}`;

export interface RoomState { wall: THREE.Color; floor: THREE.Color; ceil: THREE.Color; lamp: THREE.Color; window: THREE.Color }

export class AnalyticEnv {
  readonly target: THREE.WebGLCubeRenderTarget;
  private readonly mat: THREE.ShaderMaterial;
  private readonly box: THREE.Mesh;
  private readonly cubeCam: THREE.CubeCamera;
  private readonly maxLod: number;
  private key = '';

  constructor(size: number, readonly mode: 'ciel' | 'piece') {
    this.target = new THREE.WebGLCubeRenderTarget(size, {
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false,
      type: THREE.HalfFloatType, colorSpace: THREE.LinearSRGBColorSpace, depthBuffer: false,
    });
    this.maxLod = Math.log2(size) - 3;
    const mips = this.target.texture.mipmaps as unknown as { width: number; height: number }[];
    for (let lod = 0; lod <= this.maxLod; lod++) mips.push({ width: size >> lod, height: size >> lod });
    this.target.texture.name = mode === 'ciel' ? 'environnement-ciel' : 'environnement-piece';
    (this.target.texture as THREE.Texture & { isPMREMTexture: boolean }).isPMREMTexture = true;
    this.mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false,
      uniforms: {
        zenith: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, ground: { value: new THREE.Color() },
        sunColor: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3(0, 1, 0) },
        night: { value: 0 }, dusk: { value: 0 }, cloud: { value: 0 }, roughness: { value: 0 }, mode: { value: mode === 'ciel' ? 0 : 1 },
        wallColor: { value: new THREE.Color() }, floorColor: { value: new THREE.Color() }, ceilColor: { value: new THREE.Color() },
        lampColor: { value: new THREE.Color() }, windowColor: { value: new THREE.Color() },
      },
      vertexShader: ENV_VERT, fragmentShader: ENV_FRAG,
    });
    this.box = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 4), this.mat);
    this.box.frustumCulled = false;
    this.cubeCam = new THREE.CubeCamera(0.1, 10, this.target);
  }

  get texture(): THREE.Texture { return this.target.texture; }

  /** Ciel (mode « ciel ») : rendu seulement si l'état a changé. */
  updateSky(r: THREE.WebGLRenderer, s: SkyState): void {
    const key = [s.zenith, s.horizon, s.ground, s.sunColor].map((c) => c.getHex(THREE.LinearSRGBColorSpace)).join() + `|${s.sunDir.x.toFixed(2)},${s.sunDir.y.toFixed(2)},${s.sunDir.z.toFixed(2)}|${s.night.toFixed(2)}|${s.dusk.toFixed(2)}|${s.cloud.toFixed(2)}`;
    if (key === this.key) return;
    this.key = key;
    const u = this.mat.uniforms;
    (u['zenith']!.value as THREE.Color).copy(s.zenith);
    (u['horizon']!.value as THREE.Color).copy(s.horizon);
    (u['ground']!.value as THREE.Color).copy(s.ground);
    (u['sunColor']!.value as THREE.Color).copy(s.sunColor);
    (u['sunDir']!.value as THREE.Vector3).copy(s.sunDir);
    u['night']!.value = s.night; u['dusk']!.value = s.dusk; u['cloud']!.value = s.cloud;
    this.render(r);
  }

  /** Pièce (mode « piece »). */
  updateRoom(r: THREE.WebGLRenderer, s: RoomState): void {
    const key = [s.wall, s.floor, s.ceil, s.lamp, s.window].map((c) => c.getHex(THREE.LinearSRGBColorSpace)).join();
    if (key === this.key) return;
    this.key = key;
    const u = this.mat.uniforms;
    (u['wallColor']!.value as THREE.Color).copy(s.wall);
    (u['floorColor']!.value as THREE.Color).copy(s.floor);
    (u['ceilColor']!.value as THREE.Color).copy(s.ceil);
    (u['lampColor']!.value as THREE.Color).copy(s.lamp);
    (u['windowColor']!.value as THREE.Color).copy(s.window);
    this.render(r);
  }

  private render(r: THREE.WebGLRenderer): void {
    const prev = r.getRenderTarget(), prevFace = r.getActiveCubeFace(), prevLod = r.getActiveMipmapLevel();
    const size = this.target.width;
    for (let lod = 0; lod <= this.maxLod; lod++) {
      // Même correspondance niveau → rugosité que les matériaux de three (PMREMGenerator.lodToRoughness).
      this.mat.uniforms['roughness']!.value = this.maxLod > 0 ? 1 - Math.sqrt(1 - lod / this.maxLod) : 0;
      this.cubeCam.activeMipmapLevel = lod;
      const s = size >> lod;
      this.target.viewport.set(0, 0, s, s);
      this.cubeCam.update(r, this.box);
    }
    this.target.viewport.set(0, 0, size, size);
    r.setRenderTarget(prev, prevFace, prevLod);
  }

  dispose(): void { this.target.dispose(); this.mat.dispose(); this.box.geometry.dispose(); }
}
