/**
 * Post-traitement des qualités haute et ultra. La scène est rendue dans une cible HDR (demi-flottants, MSAA 4×,
 * profondeur en texture) ; puis, en quelques passes plein écran :
 *  - occlusion ambiante tirée de la seule profondeur (normales reconstruites, pas de second rendu de la scène),
 *    en demi-résolution (haute) ou pleine résolution (ultra), floutée sans baver sur les bords (flou bilatéral) ;
 *  - halo lumineux (« bloom ») des parties très claires (lampadaires, enseignes, vitrines la nuit) : seuil doux,
 *    chaîne de réductions puis d'agrandissements additionnés (filtre « dual », peu de lectures) ;
 *  - passe finale unique : occlusion, brume atmosphérique (distance, altitude, teinte vers le soleil), halo,
 *    exposition, tone mapping ACES (celui de three), étalonnage (teintes des ombres et des lumières, saturation,
 *    contraste), sortie sRGB, vignettage et léger tramage contre les bandes du ciel ;
 *  - FXAA ensuite seulement si la cible n'a pas de MSAA (écrans haute densité).
 * Dépend de three.
 */
import * as THREE from 'three';

/** Réglages d'une image (varient avec l'heure, la météo, la rue ou l'intérieur). */
export interface PostParams {
  /** Intensité de l'occlusion ambiante (0 : coupée) et rayon (m). */
  ao: number; aoRadius: number;
  /** Intensité du halo et seuil (luminance HDR au-delà de laquelle une surface rayonne). */
  bloom: number; bloomThreshold: number;
  /** Exposition (multiplie l'image avant le tone mapping). */
  exposure: number;
  contrast: number; saturation: number;
  /** Multiplicateurs de couleur des tons sombres et des tons clairs (étalonnage selon l'heure). */
  shadowTint: THREE.Color; highlightTint: THREE.Color;
  vignette: number;
  /** Brume : densité (1/m, 0 : aucune), décroissance avec l'altitude (1/m), opacité maximale, couleurs. */
  fog: number; fogHeight: number; fogMax: number;
  fogColor: THREE.Color; fogSunColor: THREE.Color;
  /** Direction vers le soleil (monde, normalisée). */
  sunDir: THREE.Vector3;
}

export function defaultPostParams(): PostParams {
  return {
    ao: 0.9, aoRadius: 1.2, bloom: 0.3, bloomThreshold: 2.5, exposure: 1, contrast: 1.06, saturation: 1.1,
    shadowTint: new THREE.Color(1, 1, 1), highlightTint: new THREE.Color(1, 1, 1), vignette: 0.22,
    fog: 0, fogHeight: 0.02, fogMax: 0.9, fogColor: new THREE.Color(0.7, 0.8, 0.9), fogSunColor: new THREE.Color(1, 0.9, 0.7),
    sunDir: new THREE.Vector3(0, 1, 0),
  };
}

/** Configuration du pipeline selon la qualité. */
export interface PostConfig {
  /** MSAA 4× de la cible (sinon FXAA en fin de chaîne si les pixels sont gros). */
  msaa: boolean; fxaa: boolean;
  /** Occlusion : pleine résolution (sinon moitié), nombre d'échantillons. */
  aoFull: boolean; aoSamples: number;
  /** Niveaux de la chaîne du halo (4 ou 5). */
  bloomLevels: number;
}

const VERT = `precision highp float;
in vec3 position;
out vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

/** Bruit de gradient entrelacé (Jimenez) : rotation par pixel des échantillons, tramage. */
const IGN = 'float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }';

const VIEWPOS = `vec3 viewPos(vec2 uv, float d) { vec4 c = vec4(vec3(uv, d) * 2.0 - 1.0, 1.0); vec4 v = projInv * c; return v.xyz / v.w; }`;

/**
 * Occlusion ambiante (hémisphère orienté par la normale reconstruite) : échantillons sur une spirale dorée dans un
 * disque dont le rayon à l'écran correspond à `radius` mètres à la profondeur du pixel ; contribution
 * cos(angle) × atténuation avec la distance. Sortie : (visibilité, profondeur de vue) pour le flou bilatéral.
 */
const AO_FRAG = `precision highp float;
uniform highp sampler2D tDepth;
uniform vec2 resolution;
uniform vec2 depthTexel;
uniform mat4 projInv;
uniform float projScale;
uniform float radius;
uniform float intensity;
in vec2 vUv;
out vec4 outColor;
${IGN}
${VIEWPOS}
float depthAt(vec2 uv) { return textureLod(tDepth, uv, 0.0).r; }
void main() {
  float d = depthAt(vUv);
  if (d >= 1.0) { outColor = vec4(1.0, 1.0e4, 0.0, 1.0); return; }
  vec3 p = viewPos(vUv, d);
  vec2 dx = vec2(depthTexel.x, 0.0), dy = vec2(0.0, depthTexel.y);
  vec3 pl = viewPos(vUv - dx, depthAt(vUv - dx)), pr = viewPos(vUv + dx, depthAt(vUv + dx));
  vec3 pb = viewPos(vUv - dy, depthAt(vUv - dy)), pt = viewPos(vUv + dy, depthAt(vUv + dy));
  vec3 ex = abs(pr.z - p.z) < abs(p.z - pl.z) ? pr - p : p - pl;
  vec3 ey = abs(pt.z - p.z) < abs(p.z - pb.z) ? pt - p : p - pb;
  vec3 n = normalize(cross(ex, ey));
  float rpx = min(radius * projScale * resolution.y / -p.z, resolution.y * 0.12);
  if (rpx < 1.5) { outColor = vec4(1.0, -p.z, 0.0, 1.0); return; }
  float ang = ign(gl_FragCoord.xy) * 6.2831853;
  float occ = 0.0;
  float r2 = radius * radius;
  for (int i = 0; i < SAMPLES; i++) {
    float t = (float(i) + 0.5) / float(SAMPLES);
    float a = ang + float(i) * 2.3999632;
    vec2 suv = vUv + vec2(cos(a), sin(a)) * (rpx * sqrt(t)) / resolution;
    vec3 sp = viewPos(suv, depthAt(suv));
    vec3 v = sp - p;
    float vv = dot(v, v);
    occ += max(0.0, dot(v, n) * inversesqrt(vv + 1.0e-4) - 0.08) * max(0.0, 1.0 - vv / r2);
  }
  float ao = clamp(1.0 - intensity * occ * (2.0 / float(SAMPLES)), 0.0, 1.0);
  outColor = vec4(ao, -p.z, 0.0, 1.0);
}`;

/** Flou bilatéral séparable de l'occlusion (poids gaussiens, écartés si la profondeur diffère). */
const BLUR_FRAG = `precision highp float;
uniform sampler2D tAO;
uniform vec2 dir;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec4 c = texture(tAO, vUv);
  float z = c.y, sum = c.x, wsum = 1.0;
  float tol = 0.03 * z + 0.05;
  for (int i = 1; i <= 3; i++) {
    float g = exp(-float(i * i) / 6.0);
    vec4 a = texture(tAO, vUv + dir * float(i)), b = texture(tAO, vUv - dir * float(i));
    float wa = g * max(0.0, 1.0 - abs(a.y - z) / tol), wb = g * max(0.0, 1.0 - abs(b.y - z) / tol);
    sum += a.x * wa + b.x * wb; wsum += wa + wb;
  }
  outColor = vec4(sum / wsum, z, 0.0, 1.0);
}`;

/** Halo : réduction de moitié avec seuil doux (première passe), lue en 4 points bilinéaires (16 texels). */
const PREFILTER_FRAG = `precision highp float;
uniform sampler2D tSrc;
uniform vec2 texel;
uniform float threshold;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec3 c = 0.25 * (texture(tSrc, vUv + texel * vec2(-1.0, -1.0)).rgb + texture(tSrc, vUv + texel * vec2(1.0, -1.0)).rgb
    + texture(tSrc, vUv + texel * vec2(-1.0, 1.0)).rgb + texture(tSrc, vUv + texel * vec2(1.0, 1.0)).rgb);
  c = min(c, vec3(64.0));
  float br = max(c.r, max(c.g, c.b));
  float knee = threshold * 0.5;
  float soft = clamp(br - threshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 1.0e-4);
  outColor = vec4(c * (max(soft, br - threshold) / max(br, 1.0e-4)), 1.0);
}`;

/** Halo : réduction (filtre dual, 5 lectures). */
const DOWN_FRAG = `precision highp float;
uniform sampler2D tSrc;
uniform vec2 texel;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec3 s = texture(tSrc, vUv).rgb * 4.0 + texture(tSrc, vUv - texel).rgb + texture(tSrc, vUv + texel).rgb
    + texture(tSrc, vUv + vec2(texel.x, -texel.y)).rgb + texture(tSrc, vUv - vec2(texel.x, -texel.y)).rgb;
  outColor = vec4(s * 0.125, 1.0);
}`;

/** Halo : agrandissement (filtre dual en tente, 8 lectures), ajouté au niveau supérieur. */
const UP_FRAG = `precision highp float;
uniform sampler2D tSrc;
uniform vec2 texel;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec2 h = texel;
  vec3 s = texture(tSrc, vUv + vec2(-2.0 * h.x, 0.0)).rgb + texture(tSrc, vUv + vec2(2.0 * h.x, 0.0)).rgb
    + texture(tSrc, vUv + vec2(0.0, -2.0 * h.y)).rgb + texture(tSrc, vUv + vec2(0.0, 2.0 * h.y)).rgb
    + 2.0 * (texture(tSrc, vUv + vec2(-h.x, h.y)).rgb + texture(tSrc, vUv + vec2(h.x, h.y)).rgb
    + texture(tSrc, vUv + vec2(h.x, -h.y)).rgb + texture(tSrc, vUv + vec2(-h.x, -h.y)).rgb);
  outColor = vec4(s / 12.0, 1.0);
}`;

/** Passe finale (voir l'en-tête du module). */
const COMPOSITE_FRAG = `precision highp float;
uniform sampler2D tScene;
uniform highp sampler2D tDepth;
uniform sampler2D tAO;
uniform sampler2D tBloom;
uniform mat4 projInv;
uniform mat4 camWorld;
uniform vec3 camPos;
uniform float aoStrength;
uniform float bloomStrength;
uniform float fogDensity;
uniform float fogHeight;
uniform float fogMax;
uniform vec3 fogColor;
uniform vec3 fogSunColor;
uniform vec3 sunDir;
uniform vec3 shadowTint;
uniform vec3 highlightTint;
uniform float saturation;
uniform float contrast;
uniform float vignette;
uniform float aspect;
uniform float frame;
in vec2 vUv;
out vec4 outColor;
#include <tonemapping_pars_fragment>
#include <colorspace_pars_fragment>
${IGN}
${VIEWPOS}
void main() {
  vec3 c = texture(tScene, vUv).rgb;
  #ifdef USE_AO
    c *= mix(1.0, texture(tAO, vUv).r, aoStrength);
  #endif
  #ifdef USE_FOG
    float d = textureLod(tDepth, vUv, 0.0).r;
    if (d < 1.0) {
      vec3 vp = viewPos(vUv, d);
      vec3 wp = (camWorld * vec4(vp, 1.0)).xyz;
      float dist = length(vp);
      vec3 rd = (wp - camPos) / max(dist, 1.0e-3);
      float h = max(0.0, 0.5 * (camPos.y + wp.y));
      float f = min(fogMax, 1.0 - exp(-fogDensity * dist * exp(-fogHeight * h)));
      float s = pow(max(dot(rd, sunDir), 0.0), 6.0);
      c = mix(c, mix(fogColor, fogSunColor, s), f);
    }
  #endif
  #ifdef USE_BLOOM
    c += texture(tBloom, vUv).rgb * bloomStrength;
  #endif
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c *= mix(shadowTint, highlightTint, smoothstep(0.02, 0.9, l));
  c = ACESFilmicToneMapping(c);
  float L = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = max(mix(vec3(L), c, saturation), 0.0);
  vec4 o = sRGBTransferOETF(vec4(clamp(c, 0.0, 1.0), 1.0));
  o.rgb = (o.rgb - 0.5) * contrast + 0.5;
  vec2 q = (vUv - 0.5) * vec2(aspect, 1.0);
  o.rgb *= 1.0 - vignette * smoothstep(0.2, 0.95, length(q) * 1.15);
  o.rgb += (ign(gl_FragCoord.xy + frame * 5.588238) - 0.5) / 255.0;
  outColor = vec4(o.rgb, 1.0);
}`;

/** FXAA « console » (Lottes) sur l'image finale sRGB : 4 voisins diagonaux, puis 2 ou 4 lectures le long du bord. */
export const FXAA_FRAG = `precision highp float;
uniform sampler2D tDiffuse; uniform vec2 texel; varying vec2 vUv;
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
void main() {
  vec4 m = texture2D(tDiffuse, vUv);
  float lNW = luma(texture2D(tDiffuse, vUv + vec2(-1.0, -1.0) * texel).rgb), lNE = luma(texture2D(tDiffuse, vUv + vec2(1.0, -1.0) * texel).rgb);
  float lSW = luma(texture2D(tDiffuse, vUv + vec2(-1.0, 1.0) * texel).rgb), lSE = luma(texture2D(tDiffuse, vUv + vec2(1.0, 1.0) * texel).rgb);
  float lM = luma(m.rgb);
  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE))), lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  if (lMax - lMin < max(0.0312, lMax * 0.125)) { gl_FragColor = m; return; }
  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
  float reduce = max((lNW + lNE + lSW + lSE) * 0.03125, 0.0078125);
  dir = clamp(dir / (min(abs(dir.x), abs(dir.y)) + reduce), -8.0, 8.0) * texel;
  vec3 a = 0.5 * (texture2D(tDiffuse, vUv - dir / 6.0).rgb + texture2D(tDiffuse, vUv + dir / 6.0).rgb);
  vec3 b = 0.5 * a + 0.25 * (texture2D(tDiffuse, vUv - dir * 0.5).rgb + texture2D(tDiffuse, vUv + dir * 0.5).rgb);
  float lB = luma(b);
  gl_FragColor = vec4(lB < lMin || lB > lMax ? a : b, m.a);
}`;
export const FXAA_VERT = `precision highp float;
attribute vec3 position; attribute vec2 uv; varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

function passMaterial(frag: string, uniforms: Record<string, THREE.IUniform>, defines: Record<string, string | number> = {}): THREE.RawShaderMaterial {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: frag, uniforms, defines,
    depthTest: false, depthWrite: false, blending: THREE.NoBlending,
  });
}

function target(w: number, h: number, o: THREE.RenderTargetOptions): THREE.WebGLRenderTarget {
  const t = new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), { depthBuffer: false, ...o });
  t.texture.generateMipmaps = false;
  return t;
}

export class PostFX {
  private readonly quad: THREE.Mesh;
  private readonly cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private sceneRT: THREE.WebGLRenderTarget | null = null;
  private aoA: THREE.WebGLRenderTarget | null = null;
  private aoB: THREE.WebGLRenderTarget | null = null;
  private bloomRT: THREE.WebGLRenderTarget[] = [];
  private ldrRT: THREE.WebGLRenderTarget | null = null;
  private readonly aoMat: THREE.RawShaderMaterial;
  private readonly blurMat: THREE.RawShaderMaterial;
  private readonly prefilterMat: THREE.RawShaderMaterial;
  private readonly downMat: THREE.RawShaderMaterial;
  private readonly upMat: THREE.RawShaderMaterial;
  private readonly compMat: THREE.RawShaderMaterial;
  private readonly fxaaMat: THREE.RawShaderMaterial;
  private w = 0;
  private h = 0;
  private cfg: PostConfig = { msaa: true, fxaa: false, aoFull: false, aoSamples: 12, bloomLevels: 4 };
  private frameN = 0;

  constructor() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    this.quad = new THREE.Mesh(geo);
    this.quad.frustumCulled = false;
    this.aoMat = passMaterial(AO_FRAG, {
      tDepth: { value: null }, resolution: { value: new THREE.Vector2() }, depthTexel: { value: new THREE.Vector2() },
      projInv: { value: new THREE.Matrix4() }, projScale: { value: 1 }, radius: { value: 1 }, intensity: { value: 1 },
    }, { SAMPLES: 12 });
    this.blurMat = passMaterial(BLUR_FRAG, { tAO: { value: null }, dir: { value: new THREE.Vector2() } });
    this.prefilterMat = passMaterial(PREFILTER_FRAG, { tSrc: { value: null }, texel: { value: new THREE.Vector2() }, threshold: { value: 1 } });
    this.downMat = passMaterial(DOWN_FRAG, { tSrc: { value: null }, texel: { value: new THREE.Vector2() } });
    this.upMat = passMaterial(UP_FRAG, { tSrc: { value: null }, texel: { value: new THREE.Vector2() } });
    this.upMat.blending = THREE.AdditiveBlending;
    this.compMat = passMaterial(COMPOSITE_FRAG, {
      tScene: { value: null }, tDepth: { value: null }, tAO: { value: null }, tBloom: { value: null },
      projInv: { value: new THREE.Matrix4() }, camWorld: { value: new THREE.Matrix4() }, camPos: { value: new THREE.Vector3() },
      aoStrength: { value: 1 }, bloomStrength: { value: 0 }, fogDensity: { value: 0 }, fogHeight: { value: 0 }, fogMax: { value: 1 },
      fogColor: { value: new THREE.Color() }, fogSunColor: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3(0, 1, 0) },
      shadowTint: { value: new THREE.Color(1, 1, 1) }, highlightTint: { value: new THREE.Color(1, 1, 1) },
      saturation: { value: 1 }, contrast: { value: 1 }, vignette: { value: 0 }, aspect: { value: 1 }, frame: { value: 0 },
      toneMappingExposure: { value: 1 },
    });
    this.fxaaMat = new THREE.RawShaderMaterial({
      uniforms: { tDiffuse: { value: null }, texel: { value: new THREE.Vector2() } },
      vertexShader: FXAA_VERT, fragmentShader: FXAA_FRAG, depthTest: false, depthWrite: false,
    });
  }

  /** Change la configuration (qualité) : cibles recréées à la prochaine image. */
  configure(cfg: PostConfig): void {
    const same = cfg.msaa === this.cfg.msaa && cfg.fxaa === this.cfg.fxaa && cfg.aoFull === this.cfg.aoFull && cfg.bloomLevels === this.cfg.bloomLevels;
    if (cfg.aoSamples !== this.cfg.aoSamples) { this.aoMat.defines['SAMPLES'] = cfg.aoSamples; this.aoMat.needsUpdate = true; }
    this.cfg = { ...cfg };
    if (!same) this.disposeTargets();
  }

  private disposeTargets(): void {
    this.sceneRT?.depthTexture?.dispose();
    for (const t of [this.sceneRT, this.aoA, this.aoB, this.ldrRT, ...this.bloomRT]) t?.dispose();
    this.sceneRT = this.aoA = this.aoB = this.ldrRT = null;
    this.bloomRT = [];
    this.w = this.h = 0;
  }

  private ensure(w: number, h: number): void {
    if (w === this.w && h === this.h && this.sceneRT) return;
    this.disposeTargets();
    this.w = w; this.h = h;
    const depth = new THREE.DepthTexture(w, h);
    depth.type = THREE.UnsignedIntType;
    this.sceneRT = target(w, h, { type: THREE.HalfFloatType, depthBuffer: true, depthTexture: depth, samples: this.cfg.msaa ? 4 : 0 });
    const aw = this.cfg.aoFull ? w : Math.ceil(w / 2), ah = this.cfg.aoFull ? h : Math.ceil(h / 2);
    const aoOpts: THREE.RenderTargetOptions = { type: THREE.HalfFloatType, format: THREE.RGFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.aoA = target(aw, ah, aoOpts);
    this.aoB = target(aw, ah, aoOpts);
    let bw = w, bh = h;
    for (let k = 0; k < this.cfg.bloomLevels; k++) {
      bw = Math.max(1, Math.ceil(bw / 2)); bh = Math.max(1, Math.ceil(bh / 2));
      this.bloomRT.push(target(bw, bh, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }));
    }
    if (this.cfg.fxaa) this.ldrRT = target(w, h, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  }

  /** Cible de rendu de la scène (créée au besoin) : pour précompiler les shaders dans la bonne variante. */
  sceneTarget(r: THREE.WebGLRenderer): THREE.WebGLRenderTarget {
    const size = r.getDrawingBufferSize(this.size);
    this.ensure(size.x, size.y);
    return this.sceneRT!;
  }
  private readonly size = new THREE.Vector2();

  private pass(r: THREE.WebGLRenderer, m: THREE.Material, to: THREE.WebGLRenderTarget | null): void {
    this.quad.material = m;
    r.setRenderTarget(to);
    r.render(this.quad, this.cam);
  }

  /** Rendu complet d'une image de `scene` vue par `camera`, jusqu'à l'écran. */
  render(r: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, p: PostParams): void {
    const size = r.getDrawingBufferSize(this.size);
    this.ensure(size.x, size.y);
    const sceneRT = this.sceneRT!, aoA = this.aoA!, aoB = this.aoB!;
    const autoClear = r.autoClear;
    r.autoClear = true;
    r.setRenderTarget(sceneRT);
    r.render(scene, camera);
    r.autoClear = false;
    const depth = sceneRT.depthTexture!;
    const useAO = p.ao > 0.01, useBloom = p.bloom > 0.005;
    if (useAO) {
      const u = this.aoMat.uniforms;
      u['tDepth']!.value = depth;
      (u['resolution']!.value as THREE.Vector2).set(aoA.width, aoA.height);
      (u['depthTexel']!.value as THREE.Vector2).set(1 / this.w, 1 / this.h);
      (u['projInv']!.value as THREE.Matrix4).copy(camera.projectionMatrixInverse);
      u['projScale']!.value = camera.projectionMatrix.elements[5]! * 0.5;
      u['radius']!.value = p.aoRadius;
      u['intensity']!.value = 1;
      this.pass(r, this.aoMat, aoA);
      const b = this.blurMat.uniforms;
      b['tAO']!.value = aoA.texture; (b['dir']!.value as THREE.Vector2).set(1 / aoA.width, 0);
      this.pass(r, this.blurMat, aoB);
      b['tAO']!.value = aoB.texture; (b['dir']!.value as THREE.Vector2).set(0, 1 / aoA.height);
      this.pass(r, this.blurMat, aoA);
    }
    if (useBloom) {
      const mips = this.bloomRT;
      const pf = this.prefilterMat.uniforms;
      pf['tSrc']!.value = sceneRT.texture; (pf['texel']!.value as THREE.Vector2).set(1 / this.w, 1 / this.h); pf['threshold']!.value = p.bloomThreshold;
      this.pass(r, this.prefilterMat, mips[0]!);
      const du = this.downMat.uniforms;
      for (let k = 1; k < mips.length; k++) {
        du['tSrc']!.value = mips[k - 1]!.texture; (du['texel']!.value as THREE.Vector2).set(0.5 / mips[k - 1]!.width, 0.5 / mips[k - 1]!.height);
        this.pass(r, this.downMat, mips[k]!);
      }
      const uu = this.upMat.uniforms;
      for (let k = mips.length - 1; k > 0; k--) {
        uu['tSrc']!.value = mips[k]!.texture; (uu['texel']!.value as THREE.Vector2).set(0.5 / mips[k]!.width, 0.5 / mips[k]!.height);
        this.pass(r, this.upMat, mips[k - 1]!);
      }
    }
    const c = this.compMat, u = c.uniforms;
    const defs = c.defines as Record<string, string>;
    const want = `${useAO}|${useBloom}|${p.fog > 0}`;
    if (c.userData['defs'] !== want) {
      c.userData['defs'] = want;
      for (const k of ['USE_AO', 'USE_BLOOM', 'USE_FOG']) delete defs[k];
      if (useAO) defs['USE_AO'] = '';
      if (useBloom) defs['USE_BLOOM'] = '';
      if (p.fog > 0) defs['USE_FOG'] = '';
      c.needsUpdate = true;
    }
    u['tScene']!.value = sceneRT.texture;
    u['tDepth']!.value = depth;
    u['tAO']!.value = aoA.texture;
    u['tBloom']!.value = this.bloomRT[0]?.texture ?? null;
    (u['projInv']!.value as THREE.Matrix4).copy(camera.projectionMatrixInverse);
    (u['camWorld']!.value as THREE.Matrix4).copy(camera.matrixWorld);
    (u['camPos']!.value as THREE.Vector3).setFromMatrixPosition(camera.matrixWorld);
    u['aoStrength']!.value = Math.min(1, p.ao);
    u['bloomStrength']!.value = p.bloom / Math.max(1, this.bloomRT.length);
    u['fogDensity']!.value = p.fog; u['fogHeight']!.value = p.fogHeight; u['fogMax']!.value = p.fogMax;
    (u['fogColor']!.value as THREE.Color).copy(p.fogColor);
    (u['fogSunColor']!.value as THREE.Color).copy(p.fogSunColor);
    (u['sunDir']!.value as THREE.Vector3).copy(p.sunDir);
    (u['shadowTint']!.value as THREE.Color).copy(p.shadowTint);
    (u['highlightTint']!.value as THREE.Color).copy(p.highlightTint);
    u['saturation']!.value = p.saturation; u['contrast']!.value = p.contrast; u['vignette']!.value = p.vignette;
    u['aspect']!.value = this.w / Math.max(1, this.h);
    u['frame']!.value = (this.frameN = (this.frameN + 1) % 64);
    u['toneMappingExposure']!.value = p.exposure;
    if (this.ldrRT) {
      this.pass(r, c, this.ldrRT);
      const f = this.fxaaMat.uniforms;
      f['tDiffuse']!.value = this.ldrRT.texture; (f['texel']!.value as THREE.Vector2).set(1 / this.w, 1 / this.h);
      this.pass(r, this.fxaaMat, null);
    } else this.pass(r, c, null);
    r.autoClear = autoClear;
  }

  dispose(): void {
    this.disposeTargets();
    for (const m of [this.aoMat, this.blurMat, this.prefilterMat, this.downMat, this.upMat, this.compMat, this.fxaaMat]) m.dispose();
    this.quad.geometry.dispose();
  }
}
