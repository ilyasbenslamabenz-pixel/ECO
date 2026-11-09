// Matériaux des bâtiments (CustomMaterial) : façades texturées en coordonnées monde à l'échelle réelle,
// cartes de normales, toitures (gravier, zinc à lucarnes, tuiles, ardoise, toits végétalisés), vitrages
// réfléchissant le ciel HDR (fresnel + reflet du soleil), fenêtres éclairées la nuit en tons variés.
import { Color3, Constants, HDRTools, RawCubeTexture, Vector3, type BaseTexture, type Scene, type Texture } from '@babylonjs/core';
import { CustomMaterial } from '@babylonjs/materials/custom/customMaterial';
import { ENV } from '../terrain';
import { SKY } from '../sky';

/** Une couche de façade : texture couleur (+ normales), taille d'un motif en km, grille de fenêtres. */
export interface Layer {
  tex: Texture;
  nrm?: Texture;
  w: number; // largeur d'un motif (km)
  h: number; // hauteur d'un motif (km) ; ignorée en mode ajusté
  fit?: boolean; // le motif couvre toute la hauteur du mur (façade haussmannienne)
  cols: number; // fenêtres par motif
  rows: number; // étages par motif
  glass?: number; // force du reflet sur les vitrages (0..1)
  night?: number; // indice de la texture de nuit (photos de fenêtres allumées), -1 sinon
  nightH?: number; // hauteur du motif de nuit (km)
  solid?: string; // couleur unie GLSL (pas de texture)
  proc?: string; // code GLSL procédural (renvoie tx)
  noTint?: boolean; // la teinte d'instance porte d'autres données (héliport)
}

// Ciel HDR CC0 converti une fois en cube 8 bits (compression tonale) : lisible partout, y compris sur
// les GPU sans filtrage des textures flottantes.
let envCube: RawCubeTexture | null = null;
function envTexture(scene: Scene): BaseTexture {
  if (!envCube || envCube.getScene() !== scene) {
    const px = new Uint8Array([150, 175, 205, 255]);
    const cube = new RawCubeTexture(scene, [px, px, px, px, px, px], 1, Constants.TEXTUREFORMAT_RGBA, Constants.TEXTURETYPE_UNSIGNED_BYTE, false);
    envCube = cube;
    fetch('/assets/sky.hdr').then((r) => r.arrayBuffer()).then((buf) => {
      const size = 64;
      const info = HDRTools.GetCubeMapTextureData(buf, size) as unknown as Record<string, Float32Array>;
      const faces = ['right', 'left', 'up', 'down', 'front', 'back'].map((f) => {
        const src = info[f];
        const out = new Uint8Array(size * size * 4);
        for (let i = 0; i < size * size; i++) {
          for (let c = 0; c < 3; c++) {
            const v = src[i * 3 + c];
            out[i * 4 + c] = Math.min(255, Math.round(Math.pow((v / (1 + v)) * 1.5, 1 / 2.2) * 255));
          }
          out[i * 4 + 3] = 255;
        }
        return out;
      });
      const t = new RawCubeTexture(scene, faces, size, Constants.TEXTUREFORMAT_RGBA, Constants.TEXTURETYPE_UNSIGNED_BYTE, true);
      envCube = t;
      console.log('[bld] ciel HDR converti en cube', size);
      cube.dispose();
    }).catch((e) => console.warn('[bld] ciel HDR indisponible', e)); // reste sur la couleur de ciel uniforme
  }
  return envCube;
}

/** Point visé par la caméra et rayon des pavillons détaillés (au-delà, les jardins peignent les toits). */
export const BLD_VIEW = { x: 0, z: 0, houseR: 6 };

/** Ambiance lumineuse dérivée de l'heure (identique au cycle de world.ts). */
export function skyState() {
  const ang = (ENV.time - 0.25) * Math.PI * 2;
  const elev = Math.sin(ang);
  const sunDir = new Vector3(Math.cos(ang), Math.max(-0.4, elev), 0.35).normalize();
  const dusk = Math.max(0, 1 - Math.abs(elev) * 3.2);
  const day = Math.max(0, Math.min(1, elev * 3 + 0.25));
  const sky = Color3.Lerp(new Color3(0.06, 0.08, 0.14), Color3.Lerp(new Color3(1, 1, 1), new Color3(1.35, 0.72, 0.42), dusk), day);
  const sunCol = Color3.Lerp(new Color3(1, 0.95, 0.85), new Color3(1.4, 0.65, 0.3), dusk).scale(Math.max(0, Math.min(1, elev * 6 + 0.2)));
  // part des fenêtres allumées : forte en soirée, plus faible au cœur de la nuit
  const t = ENV.time;
  const late = t < 0.25 ? 1 - Math.min(1, Math.abs(t - 0.12) / 0.14) : 0;
  // les fenêtres s'allument dès le coucher du soleil (heure dorée) et s'éteignent au lever
  const evening = t > 0.5 ? Math.max(0, Math.min(1, 1 - elev / 0.36)) * 0.95 : Math.max(0, Math.min(1, 1 - elev / 0.12)) * 0.5;
  const lights = Math.max(ENV.night, evening) * (1 - late * 0.45);
  return { sunDir, sky, sunCol, lights };
}

export const GLSL_COMMON = /* glsl */ `
  float bHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  float bNoise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(bHash(i), bHash(i + vec2(1.0, 0.0)), u.x), mix(bHash(i + vec2(0.0, 1.0)), bHash(i + vec2(1.0, 1.0)), u.x), u.y); }
  vec3 litColor(float h) {
    return h < 0.62 ? vec3(1.0, 0.66, 0.34) : h < 0.9 ? vec3(1.0, 0.84, 0.6) : h < 0.98 ? vec3(0.82, 0.9, 1.0) : vec3(0.6, 0.7, 1.0);
  }
  // toit plat : gravier, membrane claire ou toiture végétalisée selon la graine
  vec3 flatRoof(vec2 p, float seed) {
    float g = bNoise(p * 900.0) * 0.5 + bNoise(p * 3100.0) * 0.5;
    // gravier, membrane claire, bac acier sombre, terrasse brique, toiture végétalisée
    vec3 c = seed < 0.4 ? vec3(0.44, 0.42, 0.39) : seed < 0.68 ? vec3(0.60, 0.59, 0.56) : seed < 0.8 ? vec3(0.29, 0.30, 0.32) : seed < 0.9 ? vec3(0.50, 0.42, 0.35) : vec3(0.27, 0.36, 0.19);
    // variation par îlot (200 m) : luminosité et nuance chaude / froide, casse la grille uniforme vue de loin
    float blk = bHash(floor(p / 0.2) + 0.37);
    c *= (0.85 + 0.3 * g) * (0.88 + 0.24 * blk) * mix(vec3(0.96, 0.99, 1.04), vec3(1.05, 1.0, 0.93), step(0.5, fract(blk * 7.31)));
    vec2 tl = abs(fract(p / 0.004) - 0.5);
    c *= 1.0 - 0.06 * step(0.47, max(tl.x, tl.y));
    return c;
  }
`;

const VERT_DEFS = /* glsl */ `
  attribute vec4 bdata; attribute vec4 btint; attribute vec2 pinfo;
  varying vec4 vB; varying vec4 vT; varying vec4 vP; varying float vBase;
`;
const VERT_END = /* glsl */ `
  vB = bdata; vT = btint;
  float bSy = length(finalWorld[1].xyz);
  float bSx = length(finalWorld[0].xyz);
  float bWallH = max(pinfo.y * bSy - btint.a, 1e-4);
  vP = vec4(pinfo.x, (positionUpdated.y * bSy - btint.a) / bWallH, bWallH, bSx * 0.5);
  vBase = finalWorld[3].y + btint.a;
`;

export interface MatOptions {
  layers: Layer[];
  nights?: Texture[]; // photos de fenêtres allumées (tours)
  extraSamplers?: Record<string, Texture>;
  roofGLSL: string; // calcule « alb » pour les parties 1 et 2 (toits) ; dispose de fm, nN, vB, vT, part
  reflect?: number; // force globale des reflets
}

/** Construit un matériau de bâtiments à partir de ses couches de façade. */
export function buildingMaterial(scene: Scene, name: string, o: MatOptions) {
  const mat = new CustomMaterial(name, scene);
  mat.specularColor = new Color3(0.06, 0.06, 0.06);
  mat.specularPower = 32;
  mat.AddAttribute('bdata');
  mat.AddAttribute('btint');
  mat.AddAttribute('pinfo');
  mat.AddUniform('uNight', 'float', 0);
  mat.AddUniform('uLights', 'float', 0);
  mat.AddUniform('uSnow', 'float', 0);
  mat.AddUniform('uSky', 'vec3', new Vector3(1, 1, 1));
  mat.AddUniform('uSunDir', 'vec3', new Vector3(0, 1, 0));
  mat.AddUniform('uSunCol', 'vec3', new Vector3(1, 1, 1));
  mat.AddUniform('uView', 'vec3', new Vector3(0, 0, 6));
  mat.AddUniform('uZen', 'vec3', new Vector3(0.2, 0.4, 0.8));
  mat.AddUniform('uHorSun', 'vec3', new Vector3(1, 1, 1));
  mat.AddUniform('uHorAway', 'vec3', new Vector3(0.7, 0.8, 0.9));
  mat.AddUniform('uHaze', 'vec3', new Vector3(0.7, 0.75, 0.8));
  mat.AddUniform('envTex', 'samplerCube', null); // lié à chaque rendu (voir onBind)
  o.layers.forEach((l, i) => {
    if (!l.solid && !l.proc) mat.AddUniform(`fac${i}`, 'sampler2D', l.tex);
    if (l.nrm) mat.AddUniform(`nrm${i}`, 'sampler2D', l.nrm);
  });
  (o.nights ?? []).forEach((t, i) => mat.AddUniform(`ngt${i}`, 'sampler2D', t));
  for (const [k, t] of Object.entries(o.extraSamplers ?? {})) mat.AddUniform(k, 'sampler2D', t);

  // sélection de la couche : chaîne de branches sur l'indice d'instance (cohérent par bâtiment)
  const f = (v: number) => v.toFixed(6);
  const branches = o.layers.map((l, i) => {
    const uv = l.fit ? `vec2(fm.x / ${f(l.w)}, vP.y)` : `fm / vec2(${f(l.w)}, ${f(l.h)})`;
    const sample = l.solid ? `vec4(${l.solid}, 1.0)` : l.proc ? `(${l.proc})` : `texture2D(fac${i}, uv)`;
    const nrm = l.nrm ? `nTs = texture2D(nrm${i}, uv).xyz * 2.0 - 1.0; hasN = 1.0;` : '';
    let ngt = '';
    if (l.night !== undefined && l.night >= 0) {
      const nh = l.nightH ?? 0.05;
      ngt = `nightPhoto = texture2D(ngt${l.night}, fm / vec2(${f(nh)}, ${f(nh)})).rgb; hasNight = 1.0;`;
    }
    return `${i ? 'else ' : ''}if (li == ${i}) { uv = ${uv}; tx = ${sample}; grid = vec2(${l.cols.toFixed(1)}, ${l.rows.toFixed(1)}); glassK = ${(l.glass ?? 0).toFixed(3)}; ${l.noTint ? 'useTint = 0.0;' : ''} ${nrm} ${ngt} }`;
  }).join('\n');

  mat.Vertex_Definitions(VERT_DEFS);
  mat.Vertex_MainEnd(VERT_END);
  mat.Fragment_Definitions(GLSL_COMMON + `
    varying vec4 vB; varying vec4 vT; varying vec4 vP; varying float vBase;
  `);
  mat.Fragment_Custom_Diffuse(/* glsl */ `
    vec3 nN = normalize(vNormalW);
    float part = floor(vP.x + 0.5);
    vec3 T = normalize(vec3(-nN.z, 0.0, nN.x) + vec3(1e-5, 0.0, 0.0));
    vec3 Bv = normalize(cross(T, nN));
    vec2 fm = vec2(dot(vPositionW, T), dot(vPositionW, Bv) - (abs(nN.y) < 0.2 ? vBase : 0.0));
    if (part > 3.5) fm.x = atan(nN.z, nN.x) * vP.w;
    vec3 alb = vec3(0.5);
    vec3 emis = vec3(0.0);
    float gMask = 0.0;
    vec3 nTs = vec3(0.0, 0.0, 1.0);
    float hasN = 0.0;
    float seed = vB.z;
    vec2 pj = vec2(0.0);
    if (part < 0.5 || part > 3.5) {
      int li = int(vB.x + 0.5);
      vec2 uv = fm; vec4 tx = vec4(0.5); vec2 grid = vec2(1.0); float glassK = 0.0;
      vec3 nightPhoto = vec3(0.0); float hasNight = 0.0; float useTint = 1.0;
      ${branches}
      alb = tx.rgb * mix(vec3(1.0), vT.rgb, useTint);
      float lum = dot(tx.rgb, vec3(0.3, 0.55, 0.15));
      float win = (1.0 - smoothstep(0.30, 0.52, lum)) * (1.0 - smoothstep(0.0, 0.07, tx.r - tx.b));
      gMask = glassK > 0.6 ? glassK * (0.55 + 0.45 * win) : win * glassK; // murs-rideaux : vitrage presque partout
      // fenêtres éclairées la nuit
      vec2 cell = floor(uv * grid);
      float floorId = floor(uv.y * grid.y);
      float hc = bHash(cell + seed * 131.7);
      float hf = bHash(vec2(floorId, seed * 71.3));
      // part des fenêtres allumées croissante avec l'heure (uLights), déterministe par bâtiment, étage et fenêtre
      float share = clamp(uLights * 1.5, 0.0, 1.0);
      if (hasNight > 0.5) {
        float on = step(1.0 - share * 0.85, hf) * vB.w * 1.6;
        emis = nightPhoto * mix(vec3(1.0, 0.78, 0.52), vec3(1.0, 0.95, 0.85), hf) * on * (0.45 + 0.55 * win);
        emis += win * step(hc, (0.06 + 0.12 * share) * vB.w) * litColor(bHash(cell * 1.7 + 3.1)) * 0.8;
      } else {
        // rez-de-chaussée : vitrines et halls plus souvent éclairés ; étages entiers allumés ou éteints
        float floorOn = step(hf, 0.35 + 0.65 * share);
        float on = step(hc, vB.w * mix(0.6, 1.25, hf) * share * (floorId < 0.5 ? 2.0 : 1.0)) * mix(0.35, 1.0, floorOn);
        emis = win * on * litColor(bHash(cell * 1.7 + 3.1 + seed)) * (0.7 + 0.7 * bHash(cell + 9.1));
      }
      alb = mix(alb, alb * 0.4, gMask);
      // vitrages : léger gauchissement aléatoire par panneau (reflets moirés réalistes)
      pj = (vec2(bHash(cell + 1.3), bHash(cell + 7.9)) - 0.5) * 0.03 * step(0.01, gMask);
    } else if (part > 2.5) {
      // verrière (sheds, garde-corps vitrés)
      alb = vec3(0.32, 0.38, 0.42);
      gMask = 0.7;
    } else {
      ${o.roofGLSL}
    }
    // neige sur les surfaces horizontales et les pentes
    alb = mix(alb, vec3(0.93, 0.95, 0.98), uSnow * smoothstep(0.35, 0.8, nN.y));
    diffuseColor = alb;
  `);
  mat.Fragment_Before_Lights(/* glsl */ `
    if (hasN > 0.5) normalW = normalize(T * nTs.x + Bv * nTs.y + nN * max(nTs.z, 0.3));
  `);
  const refl = (o.reflect ?? 1).toFixed(3);
  mat.Fragment_Before_Fog(/* glsl */ `
    if (gMask > 0.01) {
      vec3 nR = normalize(normalW + T * pj.x + Bv * pj.y);
      vec3 Rf = reflect(-viewDirectionW, nR);
      // nuages du ciel HDR (modulation du reflet)
      float cloud = dot(textureCube(envTex, vec3(Rf.x, abs(Rf.y) * 0.9 + 0.04, Rf.z)).rgb, vec3(0.33));
      vec3 sd = normalize(vec3(uSunDir.x, 0.0, uSunDir.z) + vec3(1e-4));
      float toward = dot(normalize(vec3(Rf.x, 0.0, Rf.z) + vec3(1e-4)), sd) * 0.5 + 0.5;
      // ciel reflété = le dôme du ciel (mêmes couleurs) ; sous l'horizon, la ville baignée de brume
      vec3 hor = mix(uHorAway, uHorSun, pow(toward, 1.6));
      vec3 skyC = mix(hor, uZen, pow(max(Rf.y, 0.0), 0.42)) * (0.8 + 0.4 * cloud);
      // vers le bas : la ville dans l'ombre (acier bleuté), puis la brume dorée près de l'horizon
      vec3 low = mix(uZen * 0.7 + uHaze * 0.2, uHaze * 0.85, smoothstep(-0.3, 0.0, Rf.y));
      vec3 env = mix(low, skyC, smoothstep(-0.03, 0.05, Rf.y));
      float fres = 0.08 + 0.92 * pow(1.0 - max(dot(nR, viewDirectionW), 0.0), 4.0);
      float k = clamp(gMask * mix(0.55, 1.0, fres) * ${refl}, 0.0, 1.0);
      color.rgb = mix(color.rgb, env * mix(vec3(1.0), vT.rgb, 0.7 * step(0.6, gMask)), k);
      color.rgb += uSunCol * pow(max(dot(Rf, uSunDir), 0.0), 220.0) * 2.5 * gMask;
    }
    // intensité : quasi pleine dès l'allumage (captée par le bloom), la part allumée porte la progression
    color.rgb += emis * smoothstep(0.0, 0.25, uLights) * (1.15 + 0.5 * uLights);
  `);
  mat.onBindObservable.add(() => {
    const e = mat.getEffect();
    if (!e) return;
    const s = skyState();
    e.setFloat('uNight', ENV.night);
    e.setFloat('uLights', s.lights);
    e.setFloat('uSnow', ENV.snow * (0.4 + 0.6 * ENV.winter));
    e.setColor3('uSky', s.sky);
    e.setVector3('uSunDir', s.sunDir);
    e.setColor3('uSunCol', s.sunCol);
    e.setFloat3('uView', BLD_VIEW.x, BLD_VIEW.z, BLD_VIEW.houseR);
    e.setColor3('uZen', SKY.zen);
    e.setColor3('uHorSun', SKY.horSun);
    e.setColor3('uHorAway', SKY.horAway);
    e.setColor3('uHaze', SKY.haze);
    e.setTexture('envTex', envTexture(scene));
  });
  return mat;
}

/** Matériau simple pour les balcons (dalles béton, garde-corps vitrés ou métalliques). */
export function balconyMaterial(scene: Scene) {
  const mat = new CustomMaterial('balconyMat', scene);
  mat.specularColor = new Color3(0.05, 0.05, 0.05);
  mat.AddAttribute('bdata');
  mat.AddAttribute('pinfo');
  mat.Vertex_Definitions('attribute vec4 bdata; attribute vec2 pinfo; varying vec4 vB; varying float vPart;');
  // escamote les niveaux au-delà du nombre d'étages de l'instance
  mat.Vertex_Before_PositionUpdated('if (pinfo.y >= bdata.x) positionUpdated = vec3(0.0);');
  mat.Vertex_MainEnd('vB = bdata; vPart = pinfo.x;');
  mat.Fragment_Definitions(GLSL_COMMON + 'varying vec4 vB; varying float vPart;');
  mat.Fragment_Custom_Diffuse(/* glsl */ `
    vec3 bc = vPart > 2.5 ? (vB.y < 0.5 ? vec3(0.36, 0.42, 0.47) : vec3(0.14, 0.14, 0.15)) : vec3(0.62, 0.61, 0.58);
    diffuseColor = bc * (0.9 + 0.2 * vB.z);
  `);
  return mat;
}

/** Matériau des arbres des cours et jardins (teinte saisonnière). */
export function treeMaterial(scene: Scene) {
  const mat = new CustomMaterial('bldTreeMat', scene);
  mat.specularColor = Color3.Black();
  mat.AddAttribute('bdata');
  mat.AddAttribute('pinfo');
  mat.AddUniform('uAutumn', 'float', 0);
  mat.AddUniform('uWinter', 'float', 0);
  mat.Vertex_Definitions('attribute vec4 bdata; attribute vec2 pinfo; varying vec4 vB; varying float vPart;');
  mat.Vertex_MainEnd('vB = bdata; vPart = pinfo.x;');
  mat.Fragment_Definitions(GLSL_COMMON + 'varying vec4 vB; varying float vPart;');
  mat.Fragment_Custom_Diffuse(/* glsl */ `
    vec3 leaf = mix(vec3(0.20, 0.32, 0.12), vec3(0.30, 0.40, 0.16), vB.z);
    leaf = mix(leaf, vec3(0.55, 0.36, 0.12), uAutumn * 0.7 * vB.y);
    leaf = mix(leaf, vec3(0.36, 0.31, 0.26), uWinter * 0.6);
    leaf *= 0.8 + 0.35 * bNoise(vPositionW.xz * 3000.0 + vPositionW.y * 2000.0);
    diffuseColor = vPart > 1.5 ? leaf : vec3(0.30, 0.22, 0.16);
  `);
  mat.onBindObservable.add(() => {
    const e = mat.getEffect();
    if (!e) return;
    e.setFloat('uAutumn', ENV.autumn);
    e.setFloat('uWinter', ENV.winter);
  });
  return mat;
}
