// Ciel et atmosphère : dôme dégradé maison (zénith bleu-violet, horizon embrasé côté soleil, rose-mauve à
// l'opposé, disque solaire et halo, cirrus éclairés par en dessous), palette d'ambiance dérivée de la hauteur
// du soleil et de la météo, partagée par la brume, les lumières et le ciel pour que tout reste cohérent.
import { Color3, Effect, MeshBuilder, ShaderMaterial, Vector3, type Scene } from '@babylonjs/core';

Effect.ShadersStore.ecoSkyVertexShader = /* glsl */ `
  precision highp float;
  attribute vec3 position;
  uniform mat4 worldViewProjection;
  varying vec3 vDir;
  void main() { vDir = position; gl_Position = worldViewProjection * vec4(position, 1.0); }
`;
Effect.ShadersStore.ecoSkyFragmentShader = /* glsl */ `
  precision highp float;
  varying vec3 vDir;
  uniform vec3 uSun; uniform vec3 uZen; uniform vec3 uHorSun; uniform vec3 uHorAway; uniform vec3 uHaze;
  uniform vec3 uSunCol; uniform float uCloud; uniform float uTone; uniform float uTime; uniform float uDark;
  float h1(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n2(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(h1(i), h1(i + vec2(1.0, 0.0)), u.x), mix(h1(i + vec2(0.0, 1.0)), h1(i + vec2(1.0, 1.0)), u.x), u.y); }
  float fbm(vec2 p) { return n2(p) * 0.5 + n2(p * 2.1 + 3.7) * 0.27 + n2(p * 4.3 + 9.1) * 0.15 + n2(p * 8.7) * 0.08; }
  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    float mu = dot(d, uSun);
    // côté soleil : azimut (dégradé large, comme la diffusion de Mie au couchant)
    vec2 dh = normalize(d.xz + vec2(1e-5));
    vec2 sh = normalize(uSun.xz + vec2(1e-5));
    float az = dot(dh, sh) * 0.5 + 0.5;
    vec3 hor = mix(uHorAway, uHorSun, pow(az, 1.6));
    float hp = clamp(h, 0.0, 1.0);
    vec3 col = mix(hor, uZen, pow(hp, 0.32));
    // bande claire juste au-dessus de l'horizon (couche de brume)
    col = mix(col, uHaze * 1.05, exp(-hp * 22.0) * 0.3);
    // sous l'horizon : la brume (raccord avec le brouillard du sol)
    col = mix(col, uHaze, smoothstep(0.0, -0.04, h));
    // cirrus : bandes étirées, éclairées en orange côté soleil, mauves à l'opposé
    vec2 cp = d.xz / max(h + 0.12, 0.05);
    float cn = fbm(cp * vec2(0.9, 3.2) + vec2(uTime * 0.004, 0.0));
    float cl = smoothstep(0.48 - uCloud * 0.25, 0.78, cn) * smoothstep(-0.01, 0.05, h) * (1.0 - smoothstep(0.3, 0.75, h));
    // dessous des nuages : mauve sombre loin du soleil, liseré embrasé près du soleil
    vec3 cc = mix(mix(uHorAway, uZen, 0.45) * 0.8, uHorSun * 1.35 + uSunCol * 0.35, pow(az, 2.5));
    col = mix(col, cc, cl * (0.7 + uCloud * 0.2));
    // couverture nuageuse : voile gris chaud qui atténue le dégradé
    col = mix(col, uHaze * 0.92, uCloud * 0.55 * smoothstep(-0.02, 0.4, h));
    // soleil : disque, auréole et halo large (captés par le bloom)
    float vis = 1.0 - uCloud * 0.75;
    col += uSunCol * (smoothstep(0.99955, 0.99975, mu) * 14.0 * vis + pow(max(mu, 0.0), 900.0) * 3.0 * vis + pow(max(mu, 0.0), 24.0) * 0.45 + pow(max(mu, 0.0), 5.0) * 0.18);
    if (uTone > 0.5) {
      // qualité basse : pas de post-traitement, on applique la compression ACES ici
      vec3 x = col * 1.05;
      col = clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

/** Couleurs courantes du ciel, lues par l'eau et les vitrages. */
export const SKY = { haze: new Color3(0.7, 0.75, 0.8), horSun: new Color3(1, 1, 1), horAway: new Color3(0.7, 0.78, 0.9), zen: new Color3(0.2, 0.4, 0.8), golden: 0, dark: 0 };

export interface Atmosphere {
  zen: Color3; horSun: Color3; horAway: Color3; haze: Color3; sunCol: Color3;
  sunI: number; hemiSky: Color3; hemiGround: Color3; hemiI: number; dark: number; lamps: number; golden: number;
}

const C = (r: number, g: number, b: number) => new Color3(r, g, b);
const lerp3 = (a: Color3, b: Color3, t: number) => Color3.Lerp(a, b, Math.max(0, Math.min(1, t)));
const sstep = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * Ambiance selon la hauteur du soleil (elev = sinus de l'élévation) et la nébulosité (0..1).
 * golden : poids « heure dorée » ; dark : obscurité réelle ; lamps : éclairage artificiel (fenêtres, rues).
 */
export function atmosphere(elev: number, cloud: number): Atmosphere {
  const dark = sstep(0.03, -0.16, elev);
  const golden = (1 - sstep(0.06, 0.45, elev)) * (1 - dark);
  const lamps = sstep(0.3, -0.06, elev);
  // ciel
  const zenDay = C(0.16, 0.36, 0.78), zenGold = C(0.13, 0.17, 0.40), zenNight = C(0.04, 0.06, 0.13);
  const horDay = C(0.62, 0.76, 0.92), horSunDay = C(0.92, 0.92, 0.88);
  const horGoldSun = C(1.75, 0.78, 0.30), horGoldAway = C(0.78, 0.55, 0.50);
  const horNight = C(0.12, 0.13, 0.22);
  let zen = lerp3(zenDay, zenGold, golden);
  let horSun = lerp3(horSunDay, horGoldSun, golden);
  let horAway = lerp3(horDay, horGoldAway, golden);
  zen = lerp3(zen, zenNight, dark);
  horSun = lerp3(horSun, C(0.12, 0.07, 0.07), dark);
  horAway = lerp3(horAway, horNight, dark);
  // nuages : désature et assombrit, en gardant une chaleur résiduelle à l'heure dorée
  const grey = (c: Color3, k: number) => { const l = (c.r + c.g + c.b) / 3; return lerp3(c, C(l, l, l * 1.02), k).scale(1 - cloud * 0.3); };
  zen = grey(zen, cloud * 0.8); horSun = grey(horSun, cloud * 0.55); horAway = grey(horAway, cloud * 0.6);
  const hz = lerp3(horAway, horSun, 0.42);
  const hl = (hz.r + hz.g + hz.b) / 3;
  const haze = lerp3(hz, C(hl * 0.95, hl * 0.97, hl * 1.08), 0.08).scale(0.86);
  SKY.haze.copyFrom(haze); SKY.horSun.copyFrom(horSun); SKY.zen.copyFrom(zen); SKY.horAway.copyFrom(horAway); SKY.golden = golden; SKY.dark = dark;
  // soleil
  const sunCol = lerp3(C(1, 0.96, 0.9), C(1, 0.66, 0.36), golden).scale(1 - dark);
  const sunI = sstep(-0.02, 0.05, elev) * (1.65 + golden * 2.0) * (1 - cloud * 0.6);
  // appoint du ciel : bleu lavande côté ombre, sol chaud
  const hemiSky = lerp3(lerp3(C(0.78, 0.86, 1), C(0.66, 0.67, 0.84), golden), C(0.22, 0.28, 0.5), dark);
  const hemiGround = lerp3(lerp3(C(0.36, 0.33, 0.28), C(0.5, 0.37, 0.27), golden), C(0.05, 0.05, 0.07), dark);
  const hemiI = (0.62 + golden * 0.33) * (1 - dark * 0.55) * (1 - cloud * 0.15) + cloud * 0.15;
  return { zen, horSun, horAway, haze, sunCol, sunI, hemiSky, hemiGround, hemiI, dark, lamps, golden };
}

export function createSky(scene: Scene, toneMapInShader: boolean) {
  const mat = new ShaderMaterial('ecoSky', scene, { vertex: 'ecoSky', fragment: 'ecoSky' }, {
    attributes: ['position'],
    uniforms: ['worldViewProjection', 'uSun', 'uZen', 'uHorSun', 'uHorAway', 'uHaze', 'uSunCol', 'uCloud', 'uTone', 'uTime', 'uDark'],
  });
  mat.backFaceCulling = false;
  mat.disableDepthWrite = true;
  mat.setFloat('uTone', toneMapInShader ? 1 : 0);
  const dome = MeshBuilder.CreateSphere('skybox', { diameter: 1900, segments: 32 }, scene);
  dome.material = mat;
  dome.infiniteDistance = true;
  dome.isPickable = false;
  dome.applyFog = false;
  let t = 0;
  return {
    mesh: dome,
    update: (a: Atmosphere, sunDir: Vector3, cloud: number, dt: number) => {
      t += dt;
      mat.setVector3('uSun', sunDir);
      mat.setColor3('uZen', a.zen);
      mat.setColor3('uHorSun', a.horSun);
      mat.setColor3('uHorAway', a.horAway);
      mat.setColor3('uHaze', a.haze);
      mat.setColor3('uSunCol', a.sunCol.scale(1 - a.dark));
      mat.setFloat('uCloud', cloud);
      mat.setFloat('uTime', t);
      mat.setFloat('uDark', a.dark);
    },
  };
}
