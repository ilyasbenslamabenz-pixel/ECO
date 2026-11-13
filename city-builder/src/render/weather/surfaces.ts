/**
 * Surfaces météo et saisonnières (phase 2C « Atmosphère ») : un patch de shader commun, chaîné à
 * `onBeforeCompile` des MeshStandardMaterial / MeshPhysicalMaterial existants (sans toucher aux GLB ni aux
 * fichiers des autres systèmes) :
 *  - neige au sol et sur les toits : faces tournées vers le ciel, motif de bruit en monde, routes moins enneigées ;
 *  - sol mouillé : albédo assombri, rugosité réduite (reflets du ciel), flaques sur les surfaces planes ;
 *  - herbe saisonnière (terrain) : vert tendre au printemps, jaunie en fin d'été, terne en hiver ;
 *  - feuillage caduc : coloration d'automne par arbre, défoliation (fragments verts écartés) en hiver ;
 *  - imposteurs d'arbres lointains (ShaderMaterial `imposteur_arbre`) : mêmes teintes saisonnières.
 * Les uniformes sont PARTAGÉS : changer la météo ou la saison ne recompile rien. Un matériau n'est patché
 * qu'une fois (une recompilation de son programme). Les feuillus / conifères sont reconnus par le nom des
 * maillages de la végétation (`veg_<asset>_lod<n>`) et le rôle du catalogue.
 */
import * as THREE from 'three';

/** Rôle d'un matériau pour le patch. */
export type SurfaceRole = 'generic' | 'grass' | 'road' | 'leaf' | 'conifer' | 'impostorLeaf';

export interface SurfaceUniforms {
  uAtmoSnow: { value: number };
  uAtmoWet: { value: number };
  uAtmoAutumn: { value: number };
  uAtmoBare: { value: number };
  uAtmoSpring: { value: number };
  uAtmoDry: { value: number };
  uAtmoDormant: { value: number };
}

export function createSurfaceUniforms(): SurfaceUniforms {
  return {
    uAtmoSnow: { value: 0 }, uAtmoWet: { value: 0 }, uAtmoAutumn: { value: 0 }, uAtmoBare: { value: 0 },
    uAtmoSpring: { value: 0 }, uAtmoDry: { value: 0 }, uAtmoDormant: { value: 0 },
  };
}

const ROLE_DEFINE: Record<SurfaceRole, string> = {
  generic: '', grass: '#define ATMO_GRASS\n', road: '#define ATMO_ROAD\n', leaf: '#define ATMO_LEAF\n',
  conifer: '#define ATMO_CONIFER\n', impostorLeaf: '',
};

const COMMON_FUNCS = /* glsl */ `
uniform float uAtmoSnow;
uniform float uAtmoWet;
uniform float uAtmoAutumn;
uniform float uAtmoBare;
uniform float uAtmoSpring;
uniform float uAtmoDry;
uniform float uAtmoDormant;
float atmoH21(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float atmoNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(atmoH21(i), atmoH21(i + vec2(1.0, 0.0)), u.x), mix(atmoH21(i + vec2(0.0, 1.0)), atmoH21(i + vec2(1.0, 1.0)), u.x), u.y);
}
float atmoLuma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
/** Part « verte » d'une couleur (feuillage, herbe) 0..1. */
float atmoGreen(vec3 c) { return smoothstep(0.03, 0.16, (c.g - max(c.r, c.b)) / (c.g + 0.002)); }
/** Feuillage (tolérant : verts olive des textures de feuilles) ; l'écorce brune ou grise donne 0. */
float atmoLeafness(vec3 c) { return smoothstep(-0.02, 0.07, (c.g - max(c.r, c.b)) / (c.g + 0.002)); }
/** Teinte d'automne d'un arbre (graine 0..1) : jaune, orange, roux, encore vert. */
vec3 atmoAutumnTint(float seed) {
  vec3 a = seed < 0.3 ? vec3(0.95, 0.68, 0.12) : seed < 0.62 ? vec3(0.92, 0.42, 0.08) : seed < 0.85 ? vec3(0.66, 0.16, 0.06) : vec3(0.55, 0.62, 0.16);
  return a;
}
`;

const VERT_DECL = /* glsl */ `
varying vec3 vAtmoWorld;
varying vec3 vAtmoNormal;
varying float vAtmoSeed;
`;

const VERT_MAIN = /* glsl */ `
{
  vec4 atmoW = vec4(transformed, 1.0);
  vec3 atmoN = objectNormal;
  vAtmoSeed = 0.0;
  #ifdef USE_BATCHING
    atmoW = batchingMatrix * atmoW;
    atmoN = mat3(batchingMatrix) * atmoN;
  #endif
  #ifdef USE_INSTANCING
    atmoW = instanceMatrix * atmoW;
    atmoN = mat3(instanceMatrix) * atmoN;
    vAtmoSeed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
  #endif
  atmoW = modelMatrix * atmoW;
  vAtmoWorld = atmoW.xyz;
  vAtmoNormal = normalize(mat3(modelMatrix) * atmoN);
}
`;

const FRAG_MAIN = /* glsl */ `
{
  vec3 atmoN = normalize(vAtmoNormal);
  float atmoUp = atmoN.y;
  vec2 wxz = vAtmoWorld.xz;
  float n1 = atmoNoise(wxz * 0.31);
  float n2 = atmoNoise(wxz * 1.7 + 11.0);
  float n3 = atmoNoise(wxz * 0.045 + 3.0);
  vec3 c = diffuseColor.rgb;
  float lum = atmoLuma(c);
  float leafMask = 0.0;
  #if defined(ATMO_GRASS) || defined(ATMO_LEAF) || defined(ATMO_CONIFER)
    float green = atmoGreen(c);
  #endif
  #ifdef ATMO_GRASS
    // Herbe : printemps vif, été sec par plaques, hiver terne.
    vec3 straw = vec3(lum * 1.32, lum * 1.12, lum * 0.52);
    c = mix(c, straw, green * uAtmoDry * (0.45 + 0.4 * n3));
    vec3 dull = vec3(lum * 1.04, lum * 1.0, lum * 0.8);
    c = mix(c, dull, green * uAtmoDormant * 0.55);
    c = mix(c, c * vec3(0.9, 1.2, 0.78), green * uAtmoSpring * 0.75);
  #endif
  #ifdef ATMO_LEAF
    green = atmoLeafness(c);
    leafMask = green;
    // Automne : chaque arbre prend sa teinte (graine d'instance), avec des variations à l'intérieur du houppier.
    float seed = fract(vAtmoSeed + n2 * 0.12);
    vec3 tint = atmoAutumnTint(seed);
    vec3 autumn = tint * (lum / max(atmoLuma(tint), 0.05)) * 1.08;
    float progress = clamp(uAtmoAutumn * 1.25 - n2 * 0.25, 0.0, 1.0);
    c = mix(c, autumn, green * progress);
    // Hiver : défoliation — les fragments de feuillage disparaissent, quelques feuilles sèches restent.
    float keep = atmoH21(floor(vAtmoWorld.xz * 3.1) + floor(vAtmoWorld.y * 3.1) * 7.13);
    if (green > 0.25 && keep < uAtmoBare * 0.97) discard;
    c = mix(c, vec3(0.42, 0.27, 0.13) * (lum * 2.2 + 0.05), green * smoothstep(0.2, 0.8, uAtmoBare));
    c = mix(c, c * vec3(0.9, 1.15, 0.82), green * uAtmoSpring * 0.5);
  #endif
  #ifdef ATMO_CONIFER
    c = mix(c, c * vec3(0.92, 0.95, 1.0), green * uAtmoDormant * 0.4);
  #endif
  // Neige : faces tournées vers le ciel, plaques irrégulières ; routes déneigées (traces), feuillage clairsemé.
  float snowAmt = uAtmoSnow;
  #ifdef ATMO_ROAD
    snowAmt *= 0.3;
  #endif
  #ifdef ATMO_LEAF
    snowAmt *= 0.6;
  #endif
  float patchN = n1 * 0.65 + n2 * 0.35;
  float snowMask = smoothstep(0.38, 0.78, atmoUp) * smoothstep(0.0, 0.45, snowAmt * 1.5 - (1.0 - patchN) * 0.8);
  // Sol mouillé : les surfaces exposées foncent et brillent, les flaques s'étendent sur le plat.
  float wet = uAtmoWet * (0.25 + 0.75 * smoothstep(0.2, 0.85, atmoUp)) * (1.0 - snowMask) * (1.0 - leafMask * 0.7);
  float puddle = 0.0;
  #ifndef ATMO_GRASS
  puddle = uAtmoWet * smoothstep(0.93, 0.985, atmoUp) * smoothstep(0.58, 0.72, n1 * 0.7 + n3 * 0.3 + uAtmoWet * 0.12) * (1.0 - snowMask);
  #endif
  #ifdef ATMO_GRASS
    wet *= 0.6; // l'herbe fonce mais ne miroite pas
  #endif
  c *= 1.0 - 0.38 * wet - 0.2 * puddle;
  roughnessFactor = mix(roughnessFactor, min(roughnessFactor, 0.42), wet * 0.8);
  roughnessFactor = mix(roughnessFactor, 0.12, puddle);
  metalnessFactor = mix(metalnessFactor, 0.0, puddle);
  vec3 snowCol = vec3(0.86, 0.89, 0.94) * (0.92 + 0.08 * n2);
  c = mix(c, snowCol, snowMask);
  roughnessFactor = mix(roughnessFactor, 0.82, snowMask);
  metalnessFactor = mix(metalnessFactor, 0.0, snowMask);
  diffuseColor.rgb = c;
}
`;

/** Patch d'un shader standard (vertex + fragment). Renvoie faux si les points d'insertion manquent. */
function injectStandard(shader: THREE.WebGLProgramParametersWithUniforms, role: SurfaceRole, u: SurfaceUniforms): boolean {
  const vs = shader.vertexShader, fs = shader.fragmentShader;
  if (!vs.includes('#include <project_vertex>') || !fs.includes('#include <lights_physical_fragment>') || !fs.includes('#include <common>')) return false;
  Object.assign(shader.uniforms, u);
  shader.vertexShader = vs.replace('#include <common>', `#include <common>\n${VERT_DECL}`)
    .replace('#include <project_vertex>', `#include <project_vertex>\n${VERT_MAIN}`);
  shader.fragmentShader = fs.replace('#include <common>', `#include <common>\n${ROLE_DEFINE[role]}${VERT_DECL}${COMMON_FUNCS}`)
    .replace('#include <lights_physical_fragment>', `${FRAG_MAIN}\n#include <lights_physical_fragment>`);
  return true;
}

/** Patch de l'imposteur d'arbre (ShaderMaterial de src/render/nature/impostor.ts) : teintes saisonnières. */
function injectImpostor(shader: THREE.WebGLProgramParametersWithUniforms, deciduous: boolean, u: SurfaceUniforms): boolean {
  const anchor = 'vec3 alb = a.rgb * vTint;';
  if (!shader.fragmentShader.includes(anchor)) return false;
  Object.assign(shader.uniforms, u);
  const code = deciduous ? /* glsl */ `
  {
    float green = atmoLeafness(alb);
    float lum = atmoLuma(alb);
    float seed = fract(sin(dot(vTint, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    vec3 tint = atmoAutumnTint(seed);
    alb = mix(alb, tint * (lum / max(atmoLuma(tint), 0.05)) * 1.08, green * clamp(uAtmoAutumn * 1.2, 0.0, 1.0));
    float keep = atmoH21(floor(vUv * 64.0) + seed * 17.0);
    if (green > 0.25 && keep < uAtmoBare * 0.9) discard;
    alb = mix(alb, vec3(0.42, 0.27, 0.13) * (lum * 2.2 + 0.05), green * smoothstep(0.2, 0.8, uAtmoBare));
    alb = mix(alb, alb * vec3(0.9, 1.15, 0.82), green * uAtmoSpring * 0.5);
    alb = mix(alb, vec3(0.86, 0.89, 0.94), uAtmoSnow * 0.25 * (1.0 - green));
  }` : /* glsl */ `
  alb = mix(alb, vec3(0.86, 0.89, 0.94), uAtmoSnow * 0.3 * smoothstep(0.55, 0.95, vUv.y));
  `;
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${COMMON_FUNCS}`)
    .replace(anchor, `${anchor}\n${code}`);
  return true;
}

/** Applique le patch aux matériaux, une seule fois chacun ; `restore` remet les crochets d'origine. */
export class SurfacePatcher {
  readonly uniforms = createSurfaceUniforms();
  private readonly patched = new Map<THREE.Material, { prev: THREE.Material['onBeforeCompile']; prevKey: THREE.Material['customProgramCacheKey']; hadOwnKey: boolean; hadOwnHook: boolean }>();
  private generation = 0;
  /** Matériaux patchés (diagnostic). */
  get count(): number { return this.patched.size; }

  isPatched(m: THREE.Material): boolean { return this.patched.has(m); }

  patch(m: THREE.Material, role: SurfaceRole): boolean {
    if (this.patched.has(m)) return false;
    const std = (m as THREE.MeshStandardMaterial).isMeshStandardMaterial === true;
    const imp = !std && m.name === 'imposteur_arbre' && (m as THREE.ShaderMaterial).isShaderMaterial === true;
    if (!std && !imp) return false;
    const hadOwnHook = Object.prototype.hasOwnProperty.call(m, 'onBeforeCompile');
    const hadOwnKey = Object.prototype.hasOwnProperty.call(m, 'customProgramCacheKey');
    const prev = m.onBeforeCompile;
    const prevKey = m.customProgramCacheKey;
    const u = this.uniforms;
    m.onBeforeCompile = function (this: THREE.Material, shader, renderer): void {
      prev.call(this, shader, renderer);
      if (std) injectStandard(shader, role, u);
      else injectImpostor(shader, role === 'impostorLeaf', u);
    };
    // Clé de cache : celle d'origine (patchs des autres systèmes) + rôle atmosphère.
    const baseKey = hadOwnKey ? prevKey.call(m) : hadOwnHook ? prev.toString() : 'std';
    // La génération change à chaque `restore` : three garde par matériau les programmes déjà compilés (par clé) et ne
    // rappelle pas onBeforeCompile pour une clé connue — les uniformes partagés ne seraient plus liés.
    const gen = this.generation;
    m.customProgramCacheKey = (): string => `${baseKey}|atmo-${role}-${gen}`;
    m.needsUpdate = true;
    this.patched.set(m, { prev, prevKey, hadOwnKey, hadOwnHook });
    return true;
  }

  /** Retire tous les patchs (qualité « désactivée ») : programmes d'origine recompilés. */
  restore(): void {
    if (this.patched.size) this.generation++;
    for (const [m, r] of this.patched) {
      if (r.hadOwnHook) m.onBeforeCompile = r.prev; else delete (m as { onBeforeCompile?: unknown }).onBeforeCompile;
      if (r.hadOwnKey) m.customProgramCacheKey = r.prevKey; else delete (m as { customProgramCacheKey?: unknown }).customProgramCacheKey;
      m.needsUpdate = true;
    }
    this.patched.clear();
  }
}
