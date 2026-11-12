/**
 * Eau : mer / lac au niveau global (grand plan prolongé jusqu'à l'horizon) et rivières / lacs d'altitude
 * (maillage suivant la surface d'eau de la simulation, par chunk).
 *
 * Matériau (MeshStandardMaterial + onBeforeCompile, donc ombres, brouillard, IBL et tone mapping de three) :
 * - normales animées : trois couches d'une carte de normales tuilable générée localement (vagues à
 *   fréquences entières => sans couture), défilant dans des directions différentes ; sur les rivières,
 *   défilement selon le sens du courant (flow map à deux phases) ;
 * - réflexion de l'environnement HDRI (PMREM de la scène) avec effet Fresnel ;
 * - couleur et opacité selon la profondeur réelle (hauteur du terrain lue dans une texture de hauteurs) ;
 * - écume douce sur les rives (faible profondeur) animée.
 */
import * as THREE from 'three';
import type { TerrainData } from '../../shared/contracts';
import { NO_WATER, type TerrainPatch, type WorldTerrain } from '../../sim/terrain/types';

/** Carte de normales d'eau tuilable (RGB = normale, A = bruit d'écume). */
export function makeWaterNormalTexture(size = 256, seed = 3): THREE.DataTexture {
  const hgt = new Float32Array(size * size);
  const waves: { kx: number; kz: number; a: number; ph: number }[] = [];
  let s = seed >>> 0;
  const rnd = (): number => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  for (let w = 0; w < 28; w++) {
    const f = 1 + Math.floor(rnd() * (2 + w * 0.6));
    const ang = rnd() * Math.PI * 2;
    // Vecteurs d'onde entiers : périodiques sur la tuile.
    const kx = Math.round(Math.cos(ang) * f);
    const kz = Math.round(Math.sin(ang) * f);
    if (kx === 0 && kz === 0) continue;
    waves.push({ kx, kz, a: 1 / Math.pow(Math.hypot(kx, kz), 1.25), ph: rnd() * Math.PI * 2 });
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let h = 0;
      for (const wv of waves) h += wv.a * Math.sin(((wv.kx * x + wv.kz * y) / size) * Math.PI * 2 + wv.ph);
      hgt[y * size + x] = h;
    }
  }
  const data = new Uint8Array(size * size * 4);
  const k = 2.2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const hl = hgt[y * size + ((x + size - 1) % size)]!;
      const hr = hgt[y * size + ((x + 1) % size)]!;
      const hd = hgt[((y + size - 1) % size) * size + x]!;
      const hu = hgt[((y + 1) % size) * size + x]!;
      let nx = (hl - hr) * k;
      let ny = (hd - hu) * k;
      const nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l;
      const o = (y * size + x) * 4;
      data[o] = Math.round((nx * 0.5 + 0.5) * 255);
      data[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      data[o + 2] = Math.round((nz / l * 0.5 + 0.5) * 255);
      // Écume : crêtes du champ de hauteur.
      const c = hgt[y * size + x]!;
      data[o + 3] = Math.round(THREE.MathUtils.clamp((c + 0.6) / 2.4, 0, 1) * 255);
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

const VERT_DECL = /* glsl */ `
attribute vec2 flow;
varying vec3 vWWorld;
varying vec2 vFlow;
`;
const VERT_MAIN = /* glsl */ `
  vWWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vFlow = flow;
`;

const FRAG_DECL = /* glsl */ `
uniform sampler2D tWaterN;
uniform highp sampler2D tHeights;
uniform vec4 uHMap; // originX, originZ, 1/spacing, (inutilisé)
uniform vec2 uHSize; // samplesX, samplesZ
uniform float uTimeW;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform float uClarity;
uniform float uSeaLevel;
varying vec3 vWWorld;
varying vec2 vFlow;
vec3 wN;
float wSeaMask;
float wFoam;
float wDepth;

float terrainH(vec2 xz) {
  vec2 f0 = (xz - uHMap.xy) * uHMap.z;
  vec2 f = clamp(f0, vec2(0.0), uHSize - 1.001);
  // Hors carte : prolongement du fond marin en pente douce (même règle que l'anneau d'horizon du terrain).
  float outD = max(abs(f0.x - f.x), abs(f0.y - f.y)) / uHMap.z;
  vec2 i = floor(f);
  vec2 t = f - i;
  ivec2 p = ivec2(i);
  vec2 a = texelFetch(tHeights, p, 0).rg;
  vec2 b = texelFetch(tHeights, p + ivec2(1, 0), 0).rg;
  vec2 c = texelFetch(tHeights, p + ivec2(0, 1), 0).rg;
  vec2 d = texelFetch(tHeights, p + ivec2(1, 1), 0).rg;
  vec2 e = mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
  // g : 1 si l'échantillon appartient à la mer / au lac (surface d'eau de la simulation au niveau global).
  wSeaMask = e.g;
  return outD > 0.0 ? e.r - outD * 0.04 : e.r;
}
vec3 wnrm(vec2 uv) { return texture2D(tWaterN, uv).xyz * 2.0 - 1.0; }
`;

const FRAG_MAIN = /* glsl */ `
  {
    vec2 xz = vWWorld.xz;
    float camD = length(vWWorld - cameraPosition);
    float t = uTimeW;
    vec3 n1, n2, n3;
    float flowLen = length(vFlow);
    if (flowLen > 0.001) {
      // Flow map : deux phases décalées, fondu triangulaire (pas de saut visible).
      float ph0 = fract(t * 0.25);
      float ph1 = fract(t * 0.25 + 0.5);
      float bl = abs(ph0 * 2.0 - 1.0);
      vec2 f = vFlow * 0.9;
      n1 = mix(wnrm(xz / 11.0 - f * ph0), wnrm(xz / 11.0 - f * ph1 + 0.37), bl);
      n2 = mix(wnrm(xz / 4.7 - f * ph0 * 1.7 + 0.2), wnrm(xz / 4.7 - f * ph1 * 1.7 + 0.61), bl);
      n3 = wnrm(xz / 61.0 + vec2(t * 0.004, 0.0));
    } else {
      n1 = wnrm(xz / 23.0 + vec2(t * 0.011, t * 0.007));
      n2 = wnrm(vec2(xz.y, -xz.x) / 8.3 + vec2(-t * 0.018, t * 0.013));
      n3 = wnrm(xz / 97.0 + vec2(t * 0.003, -t * 0.004));
    }
    float calm = mix(1.0, 0.35, smoothstep(150.0, 1400.0, camD));
    float strength = flowLen > 0.001 ? 0.35 : 1.0;
    vec3 tn = normalize(vec3((n1.xy * 0.9 + n2.xy * 0.55 + n3.xy * 0.6) * calm * strength, 1.0));
    // Repère tangent du plan d'eau : T = +X, B = -Z, N = +Y.
    wN = normalize(vec3(tn.x, tn.z, -tn.y));
    float th = terrainH(xz);
    // Plan de mer : rien là où la simulation ne place pas d'eau (cuvette sèche sous le niveau de la mer).
    if (flowLen < 0.001 && abs(vWWorld.y - uSeaLevel) < 0.01 && wSeaMask < 0.5) discard;
    wDepth = max(vWWorld.y - th, 0.0);
    float foamN = texture2D(tWaterN, xz / 7.3 + vec2(t * 0.02, -t * 0.015)).a * 0.6 + texture2D(tWaterN, xz / 2.9 - vec2(t * 0.03, 0.0)).a * 0.4;
    float shore = (1.0 - smoothstep(0.0, 0.3 + 0.1 * sin(t * 0.8 + xz.x * 0.05 + xz.y * 0.03), wDepth)) * (flowLen > 0.001 ? 0.45 : 1.0);
    wFoam = clamp(shore * smoothstep(0.3, 0.7, foamN + shore * 0.35), 0.0, 1.0) * (1.0 - smoothstep(250.0, 900.0, camD));
    // Couleur : absorption selon la profondeur.
    float absorb = 1.0 - exp(-wDepth * 0.22);
    vec3 col = mix(uShallow, uDeep, absorb);
    col = mix(col, vec3(0.85, 0.9, 0.92), wFoam * 0.85);
    // L'eau diffuse peu : la couleur vient surtout de la diffusion en volume et des réflexions.
    diffuseColor.rgb = col * mix(0.45, 1.0, wFoam);
    vec3 V = normalize(cameraPosition - vWWorld);
    float fres = pow(1.0 - clamp(dot(wN, V), 0.0, 1.0), 5.0);
    float alpha = clamp(1.0 - exp(-wDepth * uClarity), 0.0, 1.0);
    alpha = clamp(max(alpha * 0.92, fres) + wFoam * 0.6, 0.0, 1.0);
    alpha *= smoothstep(0.0, 0.06, wDepth);
    diffuseColor.a = alpha;
  }
`;

export interface WaterStats {
  seaPlane: boolean;
  inlandMeshes: number;
  inlandTriangles: number;
}

/** Système d'eau (mer/lac + rivières). */
export class WaterSystem {
  readonly group = new THREE.Group();
  readonly material: THREE.MeshStandardMaterial;
  private readonly normalTex = makeWaterNormalTexture();
  private heightTex: THREE.DataTexture | null = null;
  private readonly uniforms = {
    tWaterN: { value: null as THREE.Texture | null },
    tHeights: { value: null as THREE.Texture | null },
    uHMap: { value: new THREE.Vector4() },
    uHSize: { value: new THREE.Vector2(1, 1) },
    uTimeW: { value: 0 },
    uShallow: { value: new THREE.Color(0.06, 0.2, 0.19) },
    uDeep: { value: new THREE.Color(0.006, 0.028, 0.045) },
    uClarity: { value: 0.75 },
    uSeaLevel: { value: 2 },
  };
  private data: (TerrainData & Partial<WorldTerrain>) | null = null;
  private sea: THREE.Mesh | null = null;
  private inland: THREE.Mesh[] = [];

  constructor(scene: THREE.Scene) {
    this.group.name = 'eau';
    scene.add(this.group);
    this.uniforms.tWaterN.value = this.normalTex;
    const m = new THREE.MeshStandardMaterial({ name: 'eau', color: 0xffffff, roughness: 0.035, metalness: 0, transparent: true, envMapIntensity: 1.0 });
    m.customProgramCacheKey = (): string => 'aube-eau-v1';
    m.onBeforeCompile = (shader): void => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${VERT_DECL}`)
        .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\n${VERT_MAIN}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FRAG_DECL}`)
        .replace('#include <map_fragment>', FRAG_MAIN)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(roughness, 0.45, wFoam) + smoothstep(300.0, 2500.0, length(vWWorld - cameraPosition)) * 0.06;')
        .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(wN, 0.0)).xyz);');
    };
    this.material = m;
  }

  build(t: TerrainData): void {
    this.clear();
    this.data = t;
    const W = t.samplesX;
    const H = t.samplesZ;
    // Texture des hauteurs (lecture exacte par texelFetch, interpolation bilinéaire dans le shader).
    this.heightTex = new THREE.DataTexture(this.packHeights(t), W, H, THREE.RGFormat, THREE.FloatType);
    this.uniforms.uSeaLevel.value = t.waterLevel;
    this.heightTex.magFilter = THREE.NearestFilter;
    this.heightTex.minFilter = THREE.NearestFilter;
    this.heightTex.generateMipmaps = false;
    this.heightTex.needsUpdate = true;
    this.uniforms.tHeights.value = this.heightTex;
    this.uniforms.uHMap.value.set(t.originX, t.originZ, 1 / t.spacing, 0);
    this.uniforms.uHSize.value.set(W, H);
    // Mer / lac : grand plan si une partie de la carte est sous le niveau de l'eau.
    let below = false;
    for (let k = 0; k < t.heights.length; k++) if (t.heights[k]! < t.waterLevel) { below = true; break; }
    if (below) {
      // La mer touche-t-elle le bord de la carte ? Alors le plan se prolonge jusqu'à l'horizon ; sinon
      // (lac intérieur) il couvre seulement la carte (l'anneau d'horizon émergé reste sec).
      let border = false;
      for (let i = 0; i < W && !border; i++) border = t.heights[i]! < t.waterLevel || t.heights[(H - 1) * W + i]! < t.waterLevel;
      for (let j = 0; j < H && !border; j++) border = t.heights[j * W]! < t.waterLevel || t.heights[j * W + W - 1]! < t.waterLevel;
      const size = border ? 16000 : Math.max(W, H) * t.spacing;
      const geo = new THREE.PlaneGeometry(size, size, 32, 32);
      geo.rotateX(-Math.PI / 2);
      geo.setAttribute('flow', new THREE.BufferAttribute(new Float32Array(geo.attributes['position']!.count * 2), 2));
      this.sea = new THREE.Mesh(geo, this.material);
      this.sea.name = 'eau_mer';
      this.sea.position.set(t.originX + ((W - 1) * t.spacing) / 2, t.waterLevel, t.originZ + ((H - 1) * t.spacing) / 2);
      this.sea.receiveShadow = true;
      this.sea.renderOrder = 1;
      this.group.add(this.sea);
    }
    this.buildInland(0, 0, W - 1, H - 1);
  }

  /** Hauteurs + masque « mer / lac » (RG32F). Sans surface d'eau fournie : tout ce qui est sous le niveau. */
  private packHeights(t: TerrainData & Partial<WorldTerrain>): Float32Array {
    const n = t.heights.length;
    const out = new Float32Array(n * 2);
    const ws = t.waterSurface;
    for (let k = 0; k < n; k++) {
      out[k * 2] = t.heights[k]!;
      const sea = ws ? ws[k]! !== NO_WATER && ws[k]! >= t.waterLevel - 0.01 && ws[k]! <= t.waterLevel + 0.01 : t.heights[k]! < t.waterLevel;
      out[k * 2 + 1] = sea ? 1 : 0;
    }
    return out;
  }

  /** Maillage des eaux au-dessus du niveau de la mer (rivières, lacs d'altitude), par blocs de 64 cellules. */
  private buildInland(i0: number, j0: number, i1: number, j1: number): void {
    const t = this.data;
    if (!t || !t.waterSurface) return;
    const ws = t.waterSurface;
    const W = t.samplesX;
    const H = t.samplesZ;
    const lv = t.waterLevel + 0.03;
    const B = 64;
    const wet = (i: number, j: number): boolean => {
      if (i < 0 || j < 0 || i >= W || j >= H) return false;
      const k = j * W + i;
      return ws[k]! > lv && ws[k]! > t.heights[k]! - 0.05;
    };
    for (let bj = Math.floor(j0 / B) * B; bj <= j1; bj += B) {
      for (let bi = Math.floor(i0 / B) * B; bi <= i1; bi += B) {
        const name = `eau_riv_${bi}_${bj}`;
        const old = this.inland.findIndex((m) => m.name === name);
        if (old >= 0) { this.inland[old]!.geometry.dispose(); this.group.remove(this.inland[old]!); this.inland.splice(old, 1); }
        const pos: number[] = [];
        const flow: number[] = [];
        const idx: number[] = [];
        const vmap = new Map<number, number>();
        // Surface d'un sommet : max des surfaces mouillées voisines (raccord net sur les berges).
        const surfAt = (i: number, j: number): number => {
          let s = NO_WATER;
          for (let dj = -1; dj <= 0; dj++) for (let di = -1; di <= 0; di++) {
            const a = i + di;
            const b = j + dj;
            if (wet(a, b) || wet(a + 1, b) || wet(a, b + 1) || wet(a + 1, b + 1)) {
              for (const [ii, jj] of [[a, b], [a + 1, b], [a, b + 1], [a + 1, b + 1]] as const) {
                if (ii >= 0 && jj >= 0 && ii < W && jj < H && wet(ii, jj)) s = Math.max(s, ws[jj * W + ii]!);
              }
            }
          }
          return s;
        };
        const vert = (i: number, j: number): number => {
          const key = j * (W + 1) + i;
          let v = vmap.get(key);
          if (v !== undefined) return v;
          const s = surfAt(i, j);
          v = pos.length / 3;
          pos.push(t.originX + i * t.spacing, s, t.originZ + j * t.spacing);
          // Courant : opposé au gradient de surface.
          const sl = surfAt(Math.max(0, i - 1), j);
          const sr = surfAt(Math.min(W - 1, i + 1), j);
          const sd = surfAt(i, Math.max(0, j - 1));
          const su = surfAt(i, Math.min(H - 1, j + 1));
          let fx = sl > NO_WATER && sr > NO_WATER ? (sl - sr) : 0;
          let fz = sd > NO_WATER && su > NO_WATER ? (sd - su) : 0;
          const l = Math.hypot(fx, fz);
          if (l > 1e-4) { const sp = THREE.MathUtils.clamp(l * 2, 0.15, 1); fx = (fx / l) * sp; fz = (fz / l) * sp; } else { fx = 0; fz = 0; }
          // Coordonnées de défilement : uv = (x, z) => flux en (fx, fz).
          flow.push(fx, fz);
          vmap.set(key, v);
          return v;
        };
        for (let j = bj; j < Math.min(bj + B, H - 1); j++) {
          for (let i = bi; i < Math.min(bi + B, W - 1); i++) {
            if (!(wet(i, j) || wet(i + 1, j) || wet(i, j + 1) || wet(i + 1, j + 1))) continue;
            const a = vert(i, j);
            const b = vert(i + 1, j);
            const c = vert(i, j + 1);
            const d = vert(i + 1, j + 1);
            idx.push(a, c, b, b, c, d);
          }
        }
        if (idx.length === 0) continue;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
        geo.setAttribute('flow', new THREE.Float32BufferAttribute(flow, 2));
        geo.setIndex(idx);
        geo.computeBoundingSphere();
        geo.computeBoundingBox();
        const mesh = new THREE.Mesh(geo, this.material);
        mesh.name = name;
        mesh.matrixAutoUpdate = false;
        mesh.receiveShadow = true;
        mesh.renderOrder = 1;
        this.inland.push(mesh);
        this.group.add(mesh);
      }
    }
  }

  /** Après terraformation : met à jour la texture des hauteurs et les rivières touchées. */
  applyPatch(p: TerrainPatch): void {
    const t = this.data;
    if (!t || !this.heightTex) return;
    // Les données (heights/waterSurface) sont partagées avec le terrain qui applique le patch ; on recopie la texture.
    (this.heightTex.image.data as Float32Array).set(this.packHeights(t));
    this.heightTex.needsUpdate = true;
    this.buildInland(p.i0, p.j0, p.i1, p.j1);
  }

  /** À appeler chaque image. */
  update(dt: number): void {
    this.uniforms.uTimeW.value += dt;
  }

  stats(): WaterStats {
    let tris = 0;
    for (const m of this.inland) tris += (m.geometry.index?.count ?? 0) / 3;
    return { seaPlane: !!this.sea, inlandMeshes: this.inland.length, inlandTriangles: tris };
  }

  private clear(): void {
    if (this.sea) { this.sea.geometry.dispose(); this.group.remove(this.sea); this.sea = null; }
    for (const m of this.inland) { m.geometry.dispose(); this.group.remove(m); }
    this.inland = [];
    this.heightTex?.dispose();
    this.heightTex = null;
  }

  dispose(): void {
    this.clear();
    this.material.dispose();
    this.normalTex.dispose();
    this.group.removeFromParent();
  }
}
