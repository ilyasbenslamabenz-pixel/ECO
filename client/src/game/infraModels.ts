// Boîte à outils des modèles d'équipements : géométrie fusionnée à couleurs par sommet, matériau unique
// (textures CC0 ambientCG plaquées en coordonnées monde, fenêtres éclairées la nuit, balisage lumineux),
// feux en instances fines et maillages réutilisables (avions, navires, voitures, conteneurs).
// Toutes les dimensions sont en km réels (1 unité = 1 km).
import {
  Color3, CreateBoxVertexData, CreateCylinderVertexData, CreateSphereVertexData, Engine, Matrix, Mesh, Quaternion, StandardMaterial, Texture, Vector3, VertexBuffer, VertexData,
  type Scene,
} from '@babylonjs/core';
import { CustomMaterial } from '@babylonjs/materials/custom/customMaterial';
import { ENV } from './terrain';

/** Identifiants de matière (attribut `mid`) interprétés par le shader des équipements. */
export const M = {
  plain: 0,
  asphalt: 1,
  concrete: 2,
  steel: 3, // tôle ondulée (hangars, entrepôts)
  metal: 4, // plaques métalliques (toitures)
  glass: 5, // façade vitrée (terminal, hôpital)
  brick: 6, // façade de briques à fenêtres (université, gare)
  office: 7, // façade de bureaux
  grass: 8,
  paving: 9,
} as const;

/** Intensité nocturne des feux (rampe dès le crépuscule pour l'heure dorée). */
export const nightGlow = () => Math.min(1, ENV.night * 1.6);

export type Col = string | Color3;
const colCache = new Map<string, Color3>();
export const col3 = (c: Col): Color3 => {
  if (typeof c !== 'string') return c;
  let v = colCache.get(c);
  if (!v) { v = Color3.FromHexString(c); colCache.set(c, v); }
  return v;
};

export interface PartOpts { ry?: number; rx?: number; rz?: number; mat?: number; glow?: number }

const tv = new Vector3();
const tn = new Vector3();

/** Accumulateur de géométrie : chaque pièce est transformée puis concaténée en un seul maillage. */
export class Kit {
  p: number[] = [];
  n: number[] = [];
  c: number[] = [];
  m: number[] = [];
  g: number[] = [];
  i: number[] = [];
  /** repère courant (appliqué après la transformation locale de chaque pièce) */
  base: Matrix = Matrix.Identity();

  get vertexCount() { return this.p.length / 3; }

  /** Place le repère courant (translation + rotation autour de Y). */
  frame(x: number, y: number, z: number, ry = 0) {
    this.base = Matrix.RotationY(ry).multiply(Matrix.Translation(x, y, z));
    return this;
  }

  raw(pos: ArrayLike<number>, nor: ArrayLike<number>, ind: ArrayLike<number>, local: Matrix | null, c: Col, mat = 0, glow = 0) {
    const M2 = local ? local.multiply(this.base) : this.base;
    const off = this.p.length / 3;
    const cc = col3(c);
    for (let k = 0; k < pos.length; k += 3) {
      Vector3.TransformCoordinatesFromFloatsToRef(pos[k], pos[k + 1], pos[k + 2], M2, tv);
      Vector3.TransformNormalFromFloatsToRef(nor[k], nor[k + 1], nor[k + 2], M2, tn);
      tn.normalize();
      this.p.push(tv.x, tv.y, tv.z);
      this.n.push(tn.x, tn.y, tn.z);
      this.c.push(cc.r, cc.g, cc.b, 1);
      this.m.push(mat);
      this.g.push(glow);
    }
    for (let k = 0; k < ind.length; k++) this.i.push(ind[k] + off);
  }

  vd(vd: VertexData, local: Matrix | null, c: Col, mat = 0, glow = 0) {
    this.raw(vd.positions!, vd.normals!, vd.indices!, local, c, mat, glow);
  }

  private static local(x: number, y: number, z: number, o?: PartOpts) {
    let l = Matrix.Identity();
    if (o?.rx) l = l.multiply(Matrix.RotationX(o.rx));
    if (o?.rz) l = l.multiply(Matrix.RotationZ(o.rz));
    if (o?.ry) l = l.multiply(Matrix.RotationY(o.ry));
    return l.multiply(Matrix.Translation(x, y, z));
  }

  /** Pavé posé sur y (base), centré en x/z. */
  box(x: number, y: number, z: number, w: number, h: number, d: number, c: Col, o?: PartOpts) {
    const vd = CreateBoxVertexData({ width: w, height: h, depth: d });
    vd.positions = Array.from(vd.positions!).map((v, k) => (k % 3 === 1 ? v + h / 2 : v));
    this.vd(vd, Kit.local(x, y, z, o), c, o?.mat ?? 0, o?.glow ?? 0);
  }

  /** Cylindre (ou tronc de cône) posé sur y. */
  cyl(x: number, y: number, z: number, rb: number, rt: number, h: number, c: Col, o?: PartOpts & { tess?: number; arc?: number }) {
    const vd = CreateCylinderVertexData({ height: h, diameterBottom: rb * 2, diameterTop: rt * 2, tessellation: o?.tess ?? 16, arc: o?.arc ?? 1, enclose: !!o?.arc && o.arc < 1 });
    vd.positions = Array.from(vd.positions!).map((v, k) => (k % 3 === 1 ? v + h / 2 : v));
    this.vd(vd, Kit.local(x, y, z, o), c, o?.mat ?? 0, o?.glow ?? 0);
  }

  sphere(x: number, y: number, z: number, r: number, c: Col, o?: PartOpts & { seg?: number; slice?: number }) {
    const vd = CreateSphereVertexData({ diameter: r * 2, segments: o?.seg ?? 8, slice: o?.slice ?? 1 });
    this.vd(vd, Kit.local(x, y, z, o), c, o?.mat ?? 0, o?.glow ?? 0);
  }

  /**
   * Révolution d'un profil [rayon, hauteur] autour de l'axe Y (tours aéroréfrigérantes, cheminées, dômes).
   * sx/sz : facteurs d'ellipse (tribunes de stade).
   */
  lathe(profile: [number, number][], x: number, y: number, z: number, c: Col | ((k: number) => Col), o?: PartOpts & { tess?: number; sx?: number; sz?: number }) {
    const tess = o?.tess ?? 24;
    const sx = o?.sx ?? 1, sz = o?.sz ?? 1;
    const pos: number[] = [];
    const ind: number[] = [];
    const cols: Color3[] = [];
    for (let j = 0; j < profile.length; j++) {
      const [r, py] = profile[j];
      const cj = col3(typeof c === 'function' ? c(j) : c);
      for (let k = 0; k <= tess; k++) {
        const a = (k / tess) * Math.PI * 2;
        pos.push(Math.cos(a) * r * sx, py, Math.sin(a) * r * sz);
        cols.push(cj);
      }
    }
    for (let j = 0; j < profile.length - 1; j++) {
      for (let k = 0; k < tess; k++) {
        const a = j * (tess + 1) + k, b = a + tess + 1;
        ind.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const nor: number[] = [];
    VertexData.ComputeNormals(pos, ind, nor);
    const start = this.p.length / 3;
    this.raw(pos, nor, ind, Kit.local(x, y, z, o), '#ffffff', o?.mat ?? 0, o?.glow ?? 0);
    for (let k = 0; k < cols.length; k++) {
      const q = (start + k) * 4;
      this.c[q] = cols[k].r; this.c[q + 1] = cols[k].g; this.c[q + 2] = cols[k].b;
    }
  }

  /** Polygone horizontal convexe (triangulation en éventail), à l'altitude y. */
  flat(pts: [number, number][], y: number, c: Col, mat = 0, glow = 0) {
    const pos: number[] = [];
    const nor: number[] = [];
    const ind: number[] = [];
    // sens trigonométrique dans le plan (x, z) = face avant vers le haut
    let area = 0;
    for (let q = 0; q < pts.length; q++) { const [ax, az] = pts[q], [bx, bz] = pts[(q + 1) % pts.length]; area += ax * bz - bx * az; }
    if (area < 0) pts = pts.slice().reverse();
    for (const [x, z] of pts) { pos.push(x, y, z); nor.push(0, 1, 0); }
    for (let k = 1; k < pts.length - 1; k++) ind.push(0, k, k + 1);
    this.raw(pos, nor, ind, null, c, mat, glow);
  }

  /** Rectangle horizontal (cx, cz, longueur w selon x local, largeur d selon z local) tourné de ry. */
  rect(cx: number, y: number, cz: number, w: number, d: number, c: Col, mat = 0, ry = 0, glow = 0) {
    const cs = Math.cos(ry), sn = Math.sin(ry);
    const P = (u: number, v: number): [number, number] => [cx + u * cs + v * sn, cz - u * sn + v * cs];
    this.flat([P(-w / 2, -d / 2), P(w / 2, -d / 2), P(w / 2, d / 2), P(-w / 2, d / 2)], y, c, mat, glow);
  }

  /** Bande horizontale entre deux points (taxiways, marquages, routes). */
  strip(x0: number, z0: number, x1: number, z1: number, width: number, y: number, c: Col, mat = 0, glow = 0) {
    const dx = x1 - x0, dz = z1 - z0;
    const l = Math.hypot(dx, dz) || 1;
    const ox = (-dz / l) * width * 0.5, oz = (dx / l) * width * 0.5;
    this.flat([[x0 + ox, z0 + oz], [x1 + ox, z1 + oz], [x1 - ox, z1 - oz], [x0 - ox, z0 - oz]], y, c, mat, glow);
  }

  /** Poutre de section w × h entre deux points 3D (passerelles, flèches de grues, convoyeurs). */
  beam(a: Vector3, b: Vector3, w: number, h: number, c: Col, mat = 0, glow = 0) {
    const d = b.subtract(a);
    const hl = Math.hypot(d.x, d.z);
    const len = d.length();
    const vd = CreateBoxVertexData({ width: len, height: h, depth: w });
    const l = Matrix.RotationZ(Math.atan2(d.y, hl)).multiply(Matrix.RotationY(Math.atan2(-d.z, d.x))).multiply(Matrix.Translation((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2));
    this.vd(vd, l, c, mat, glow);
  }

  /** Toit à deux pans (prisme triangulaire) posé sur y, faîtage selon x local. */
  gable(x: number, y: number, z: number, w: number, h: number, d: number, c: Col, o?: PartOpts) {
    const hw = w / 2, hd = d / 2;
    const pos = [
      -hw, 0, -hd, hw, 0, -hd, hw, h, 0, -hw, h, 0, // pan sud
      -hw, 0, hd, hw, 0, hd, hw, h, 0, -hw, h, 0, // pan nord
      -hw, 0, -hd, -hw, 0, hd, -hw, h, 0, // pignon ouest
      hw, 0, -hd, hw, 0, hd, hw, h, 0, // pignon est
    ];
    const ind = [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 8, 9, 10, 11, 13, 12];
    const nor: number[] = [];
    VertexData.ComputeNormals(pos, ind, nor);
    this.raw(pos, nor, ind, Kit.local(x, y, z, o), c, o?.mat ?? 0, o?.glow ?? 0);
  }

  /** Voûte (demi-cylindre aplati) : portée w selon x local, longueur len selon z local, flèche h. */
  vault(cx: number, y: number, cz: number, w: number, len: number, h: number, c: Col, o?: PartOpts & { seg?: number; ends?: boolean }) {
    const seg = o?.seg ?? 10;
    const pos: number[] = [];
    const ind: number[] = [];
    for (let s = 0; s <= seg; s++) {
      const a = (s / seg) * Math.PI;
      const x = -Math.cos(a) * w / 2, yy = Math.sin(a) * h;
      pos.push(x, yy, -len / 2, x, yy, len / 2);
      if (s < seg) { const b = s * 2; ind.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); }
    }
    if (o?.ends !== false) {
      for (const zz of [-len / 2, len / 2]) {
        const c0 = pos.length / 3;
        pos.push(0, 0, zz);
        for (let s = 0; s <= seg; s++) { const a = (s / seg) * Math.PI; pos.push(-Math.cos(a) * w / 2, Math.sin(a) * h, zz); }
        for (let s = 0; s < seg; s++) ind.push(c0, c0 + 1 + s, c0 + 2 + s);
      }
    }
    const nor: number[] = [];
    VertexData.ComputeNormals(pos, ind, nor);
    this.raw(pos, nor, ind, Kit.local(cx, y, cz, o), c, o?.mat ?? 0, o?.glow ?? 0);
  }

  /** Quadrilatère quelconque (4 sommets 3D), normales calculées. */
  quad(a: number[], b: number[], c2: number[], d: number[], c: Col, mat = 0, glow = 0) {
    const pos = [...a, ...b, ...c2, ...d];
    let ind = [0, 1, 2, 0, 2, 3];
    let nor: number[] = [];
    VertexData.ComputeNormals(pos, ind, nor);
    if (nor[1] < -1e-4) { ind = [0, 2, 1, 0, 3, 2]; nor = []; VertexData.ComputeNormals(pos, ind, nor); }
    this.raw(pos, nor, ind, null, c, mat, glow);
  }

  /** Génère le maillage (matériau partagé des équipements). */
  build(name: string, scene: Scene, material?: StandardMaterial | CustomMaterial) {
    const mesh = new Mesh(name, scene);
    if (!this.i.length) { this.box(0, 0, 0, 0.001, 0.001, 0.001, '#000000'); }
    const vd = new VertexData();
    vd.positions = new Float32Array(this.p);
    vd.normals = new Float32Array(this.n);
    vd.colors = new Float32Array(this.c);
    vd.indices = this.p.length / 3 > 65535 ? new Uint32Array(this.i) : new Uint16Array(this.i);
    vd.applyToMesh(mesh, false);
    mesh.setVerticesData('mid', new Float32Array(this.m), false, 1);
    mesh.setVerticesData('glow', new Float32Array(this.g), false, 1);
    mesh.material = material ?? infraMaterial(scene);
    return mesh;
  }
}

// ---------- Textures et matériau partagé ----------
const acg = (scene: Scene, id: string) => {
  const t = new Texture(`/assets/acg/${id}/color.jpg`, scene);
  t.wrapU = t.wrapV = Texture.WRAP_ADDRESSMODE;
  t.anisotropicFilteringLevel = 4;
  return t;
};

const matCache = new WeakMap<Scene, CustomMaterial>();
/**
 * Matériau unique des équipements : couleur par sommet × détail photographique selon `mid`,
 * fenêtres allumées aléatoirement la nuit sur les façades, feux (`glow`) : 1 = la nuit, 2 = toujours.
 */
export function infraMaterial(scene: Scene) {
  let mat = matCache.get(scene);
  if (mat) return mat;
  mat = new CustomMaterial('infraMat', scene);
  mat.specularColor = new Color3(0.12, 0.12, 0.12);
  mat.specularPower = 32;
  mat.backFaceCulling = false;
  mat.twoSidedLighting = true;
  mat.AddUniform('tAsph', 'sampler2D', acg(scene, 'Asphalt025C'));
  mat.AddUniform('tConc', 'sampler2D', acg(scene, 'Concrete034'));
  mat.AddUniform('tSteel', 'sampler2D', acg(scene, 'CorrugatedSteel007A'));
  mat.AddUniform('tMetal', 'sampler2D', acg(scene, 'MetalPlates006'));
  mat.AddUniform('tGlass', 'sampler2D', acg(scene, 'Facade006'));
  mat.AddUniform('tBrick', 'sampler2D', acg(scene, 'Facade018A'));
  mat.AddUniform('tOffice', 'sampler2D', acg(scene, 'Facade020A'));
  mat.AddUniform('tPave', 'sampler2D', acg(scene, 'PavingStones138'));
  mat.AddUniform('uNight', 'float', 0);
  mat.AddUniform('uBlink', 'float', 0);
  mat.AddAttribute('mid');
  mat.AddAttribute('glow');
  mat.Vertex_Definitions('attribute float mid; attribute float glow; varying float vMid; varying float vGlow;');
  mat.Vertex_MainEnd('vMid = mid; vGlow = glow;');
  mat.Fragment_Definitions(/* glsl */ `
    varying float vMid; varying float vGlow;
    float iHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float iNoise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(iHash(i), iHash(i + vec2(1.0, 0.0)), u.x), mix(iHash(i + vec2(0.0, 1.0)), iHash(i + vec2(1.0, 1.0)), u.x), u.y); }
    float iLum(vec3 c) { return dot(c, vec3(0.3, 0.59, 0.11)); }
  `);
  mat.Fragment_Custom_Diffuse(/* glsl */ `
    float id = floor(vMid + 0.5);
    vec3 nW = normalize(vNormalW);
    bool top = abs(nW.y) > 0.6;
    vec2 gp = vPositionW.xz;
    vec2 wp = vec2(dot(vPositionW.xz, vec2(-nW.z, nW.x)), vPositionW.y);
    vec2 uvp = top ? gp : wp;
    vec3 det = vec3(1.0);
    if (id > 0.5 && id < 1.5) {
      float l = iLum(texture2D(tAsph, gp / 0.012).rgb) * 0.55 + iLum(texture2D(tAsph, gp / 0.09).rgb) * 0.45;
      det = vec3(l / 0.168) * (0.9 + 0.2 * iNoise(gp * 3.0));
    } else if (id < 2.5 && id > 1.5) {
      float l = iLum(texture2D(tConc, uvp / 0.02).rgb) * 0.6 + iLum(texture2D(tConc, uvp / 0.15).rgb) * 0.4;
      vec2 sl = abs(fract(gp / 0.0075) - 0.5);
      float joint = top ? 1.0 - 0.12 * (1.0 - smoothstep(0.0, 0.03, min(sl.x, sl.y))) : 1.0;
      det = vec3(l / 0.723) * joint * (0.93 + 0.14 * iNoise(gp * 2.0));
    } else if (id < 3.5 && id > 2.5) {
      float rib = 0.82 + 0.18 * sin(uvp.x * 6283.0 / 0.9);
      float l = iLum(texture2D(tSteel, uvp / 0.012).rgb);
      det = vec3(rib * l / 0.621);
    } else if (id < 4.5 && id > 3.5) {
      det = vec3(iLum(texture2D(tMetal, uvp / 0.008).rgb) / 0.282);
    } else if (id < 7.5 && id > 4.5) {
      if (top) det = vec3(0.55 * iLum(texture2D(tConc, gp / 0.02).rgb) / 0.723);
      else if (id < 5.5) det = texture2D(tGlass, wp / vec2(0.028, 0.028)).rgb * 1.15;
      else if (id < 6.5) det = texture2D(tBrick, wp / vec2(0.021, 0.021)).rgb * 1.2;
      else det = texture2D(tOffice, wp / vec2(0.03, 0.03)).rgb * 1.3;
    } else if (id < 8.5 && id > 7.5) {
      float n = iNoise(gp * 9.0) * 0.35 + iNoise(gp * 40.0) * 0.25 + iNoise(gp * 1.2) * 0.4;
      float mow = 0.93 + 0.07 * step(0.5, fract(gp.x / 0.03 + iNoise(gp * 0.7) * 2.0));
      det = mix(vec3(0.62, 0.74, 0.48), vec3(1.18, 1.12, 0.86), n) * mow;
    } else if (id > 8.5) {
      det = texture2D(tPave, uvp / 0.006).rgb / 0.56;
    }
    diffuseColor = det;
  `);
  mat.Fragment_Before_FragColor(/* glsl */ `
    {
      float id2 = floor(vMid + 0.5);
      vec3 nW2 = normalize(vNormalW);
      // fenêtres éclairées la nuit (façades texturées)
      if (id2 > 4.5 && id2 < 7.5 && abs(nW2.y) < 0.6) {
        vec2 wp2 = vec2(dot(vPositionW.xz, vec2(-nW2.z, nW2.x)), vPositionW.y);
        vec3 tc = id2 < 5.5 ? texture2D(tGlass, wp2 / 0.028).rgb : id2 < 6.5 ? texture2D(tBrick, wp2 / 0.021).rgb : texture2D(tOffice, wp2 / 0.03).rgb;
        float glass = 1.0 - smoothstep(0.32, 0.5, iLum(tc));
        vec2 cell = floor(wp2 / vec2(0.004, 0.0035));
        float lit = step(0.42, iHash(cell));
        color.rgb += glass * lit * uNight * vec3(1.0, 0.78, 0.48) * 0.85;
      }
      // feux et éclairages
      float gl = vGlow > 2.5 ? uBlink : vGlow > 1.5 ? 1.0 : vGlow * uNight;
      color.rgb = mix(color.rgb, vColor.rgb * 1.3, clamp(gl, 0.0, 1.0));
    }
  `);
  mat.onBindObservable.add(() => {
    const e = mat!.getEffect();
    if (!e) return;
    e.setFloat('uNight', nightGlow());
    e.setFloat('uBlink', (performance.now() % 1300) < 160 ? 1 : 0);
  });
  matCache.set(scene, mat);
  scene.onDisposeObservable.addOnce(() => matCache.delete(scene));
  return mat;
}

// ---------- Feux en instances fines (balisage, éclairage de quais) ----------
const lightMats = new WeakMap<Scene, { mat: StandardMaterial; meshes: Set<Mesh> }>();
function lightMaterial(scene: Scene) {
  let L = lightMats.get(scene);
  if (L) return L;
  const mat = new StandardMaterial('feuxMat', scene);
  mat.disableLighting = true;
  mat.diffuseColor = Color3.Black();
  mat.emissiveColor = Color3.White();
  mat.specularColor = Color3.Black();
  mat.fogEnabled = true;
  L = { mat, meshes: new Set() };
  const LL = L;
  const obs = scene.onBeforeRenderObservable.add(() => {
    const k = nightGlow();
    mat.emissiveColor.setAll(0.5 + 0.5 * k);
    for (const m of LL.meshes) m.setEnabled(k > 0.12);
  });
  scene.onDisposeObservable.addOnce(() => { scene.onBeforeRenderObservable.remove(obs); lightMats.delete(scene); });
  lightMats.set(scene, L);
  return L;
}

export interface LightSet { pos: number[]; col: number[]; size: number[] }
export const newLights = (): LightSet => ({ pos: [], col: [], size: [] });
export function addLight(L: LightSet, x: number, y: number, z: number, c: Col, size = 1) {
  const cc = col3(c);
  L.pos.push(x, y, z);
  L.col.push(cc.r, cc.g, cc.b, 1);
  L.size.push(size);
}

/** Crée le maillage des feux (un seul appel de rendu), allumés au crépuscule et la nuit. */
export function buildLights(scene: Scene, name: string, L: LightSet, base = 0.004) {
  const n = L.pos.length / 3;
  if (!n) return null;
  const mesh = new Mesh(name, scene);
  CreateSphereVertexData({ diameter: base, segments: 2 }).applyToMesh(mesh);
  mesh.material = lightMaterial(scene).mat;
  const mats = new Float32Array(n * 16);
  const m = new Matrix();
  const s = new Vector3();
  const t = new Vector3();
  const q = Quaternion.Identity();
  for (let k = 0; k < n; k++) {
    s.setAll(L.size[k]);
    t.set(L.pos[k * 3], L.pos[k * 3 + 1], L.pos[k * 3 + 2]);
    Matrix.ComposeToRef(s, q, t, m);
    m.copyToArray(mats, k * 16);
  }
  mesh.thinInstanceSetBuffer('matrix', mats, 16, true);
  mesh.thinInstanceSetBuffer('color', new Float32Array(L.col), 4, true);
  mesh.isPickable = false;
  mesh.freezeWorldMatrix();
  const LM = lightMaterial(scene);
  LM.meshes.add(mesh);
  mesh.setEnabled(nightGlow() > 0.12);
  mesh.onDisposeObservable.addOnce(() => LM.meshes.delete(mesh));
  return mesh;
}

// ---------- Halos d'éclairage au sol (nappes additives chaudes sous les mâts) ----------
const poolMats = new WeakMap<Scene, StandardMaterial>();
function poolMaterial(scene: Scene) {
  let mat = poolMats.get(scene);
  if (mat) return mat;
  mat = new StandardMaterial('haloMat', scene);
  mat.disableLighting = true;
  mat.diffuseColor = Color3.Black();
  mat.specularColor = Color3.Black();
  mat.emissiveColor = Color3.White();
  mat.alphaMode = Engine.ALPHA_ADD;
  mat.alpha = 0.99;
  mat.disableDepthWrite = true;
  mat.backFaceCulling = false;
  mat.zOffset = -4;
  poolMats.set(scene, mat);
  const m2 = mat;
  const obs = scene.onBeforeRenderObservable.add(() => { m2.emissiveColor.setAll(0.55 * nightGlow()); });
  scene.onDisposeObservable.addOnce(() => { scene.onBeforeRenderObservable.remove(obs); poolMats.delete(scene); });
  return mat;
}

/** Halos lumineux au sol (un appel de rendu), visibles au crépuscule et la nuit. */
export function buildPools(scene: Scene, name: string, L: LightSet) {
  const n = L.pos.length / 3;
  if (!n) return null;
  const mesh = new Mesh(name, scene);
  // disque à dégradé radial par couleurs de sommets (centre lumineux, bord noir = transparent en additif)
  const pos: number[] = [0, 0, 0], col: number[] = [1, 1, 1, 1], ind: number[] = [];
  const seg = 16, rings: [number, number][] = [[0.18, 0.6], [0.32, 0.3], [0.5, 0]];
  rings.forEach(([r, c]) => { for (let q = 0; q < seg; q++) { const a = (q / seg) * Math.PI * 2; pos.push(Math.cos(a) * r, 0, Math.sin(a) * r); col.push(c, c, c, 1); } });
  for (let q = 0; q < seg; q++) ind.push(0, 1 + ((q + 1) % seg), 1 + q);
  for (let rr = 0; rr < rings.length - 1; rr++) for (let q = 0; q < seg; q++) {
    const a = 1 + rr * seg + q, b = 1 + rr * seg + ((q + 1) % seg);
    ind.push(a, b, a + seg, b, b + seg, a + seg);
  }
  const vd = new VertexData();
  vd.positions = pos; vd.colors = col; vd.indices = ind;
  vd.normals = pos.map((_, k) => (k % 3 === 1 ? 1 : 0));
  vd.applyToMesh(mesh);
  mesh.material = poolMaterial(scene);
  const mats = new Float32Array(n * 16);
  const m = new Matrix();
  for (let k = 0; k < n; k++) {
    Matrix.ComposeToRef(new Vector3(L.size[k], 1, L.size[k]), Quaternion.Identity(), new Vector3(L.pos[k * 3], L.pos[k * 3 + 1], L.pos[k * 3 + 2]), m);
    m.copyToArray(mats, k * 16);
  }
  mesh.thinInstanceSetBuffer('matrix', mats, 16, true);
  mesh.thinInstanceSetBuffer('color', new Float32Array(L.col), 4, true);
  mesh.isPickable = false;
  mesh.freezeWorldMatrix();
  const LM = lightMaterial(scene);
  LM.meshes.add(mesh);
  mesh.setEnabled(nightGlow() > 0.12);
  mesh.onDisposeObservable.addOnce(() => LM.meshes.delete(mesh));
  return mesh;
}

// ---------- Instances fines génériques ----------
export interface Inst { m: number[]; c: number[] }
export const newInst = (): Inst => ({ m: [], c: [] });
const im = new Matrix();
const iq = new Quaternion();
const isv = new Vector3();
const itv = new Vector3();
export function addInst(I: Inst, x: number, y: number, z: number, ry: number, sx: number, sy: number, sz: number, c: Col) {
  Quaternion.RotationYawPitchRollToRef(ry, 0, 0, iq);
  isv.set(sx, sy, sz);
  itv.set(x, y, z);
  Matrix.ComposeToRef(isv, iq, itv, im);
  for (let k = 0; k < 16; k++) I.m.push(im.m[k]);
  const cc = col3(c);
  I.c.push(cc.r, cc.g, cc.b, 1);
}
/** Applique les instances à un maillage de base (le maillage est renvoyé, ou null si vide). */
export function applyInst(mesh: Mesh, I: Inst) {
  const n = I.c.length / 4;
  if (!n) { mesh.dispose(); return null; }
  mesh.thinInstanceSetBuffer('matrix', new Float32Array(I.m), 16, true);
  mesh.thinInstanceSetBuffer('color', new Float32Array(I.c), 4, true);
  mesh.freezeWorldMatrix();
  return mesh;
}

/** Boîte unitaire posée sur sa base (conteneurs, voitures, panneaux…), avec matière donnée. */
export function unitBox(scene: Scene, name: string, mat = 0, glow = 0) {
  const k = new Kit();
  k.box(0, 0, 0, 1, 1, 1, '#ffffff', { mat, glow });
  return k.build(name, scene);
}

/** Conteneur 40 pieds (12,2 × 2,4 × 2,6 m) avec nervures et portes, couleur par instance. */
export function containerMesh(scene: Scene, name = 'conteneurs') {
  const k = new Kit();
  k.box(0, 0, 0, 0.0121, 0.0025, 0.00238, '#ffffff');
  for (let r = -5; r <= 5; r++) k.box(r * 0.0011, 0.0001, 0, 0.0003, 0.0023, 0.00244, '#d8d8d8');
  k.box(0, 0.0025, 0, 0.0121, 0.00008, 0.0023, '#bdbdbd');
  return k.build(name, scene);
}

/** Voiture particulière (≈ 4,5 m), couleur par instance. */
export function carMesh(scene: Scene, name = 'voitures') {
  const k = new Kit();
  k.box(0, 0.0002, 0, 0.0045, 0.0008, 0.0018, '#ffffff');
  k.box(-0.0003, 0.001, 0, 0.0024, 0.0006, 0.0016, '#6f7b85');
  return k.build(name, scene);
}

/** Arbre bas poly (houppier + tronc) de hauteur 1, mis à l'échelle par instance. */
export function treeMesh(scene: Scene, name = 'arbres') {
  const k = new Kit();
  k.cyl(0, 0, 0, 0.04, 0.04, 0.35, '#6b4f36', { tess: 5 });
  k.sphere(0, 0.62, 0, 0.32, '#ffffff', { seg: 3 });
  return k.build(name, scene);
}

// ---------- Avions de ligne (nez selon +x local) ----------
export interface PlaneSpec { len: number; span: number; r: number; engines: 2 | 4; engR: number; name: string }
export const PLANES: PlaneSpec[] = [
  { name: 'monocouloir', len: 0.0376, span: 0.0358, r: 0.00198, engines: 2, engR: 0.00105 }, // type A320
  { name: 'gros-porteur', len: 0.0668, span: 0.0646, r: 0.00305, engines: 2, engR: 0.0019 }, // type 777/A350
  { name: 'très gros porteur', len: 0.0727, span: 0.0798, r: 0.0036, engines: 4, engR: 0.0015 }, // type A380/747
  { name: 'régional', len: 0.0273, span: 0.0272, r: 0.00145, engines: 2, engR: 0.0008 }, // type ATR/CRJ
];

/** Construit la géométrie d'un avion : fuselage, ailes en flèche, empennage, réacteurs, feux de navigation. */
export function buildPlane(k: Kit, s: PlaneSpec) {
  const L = s.len, r = s.r;
  const body = '#f4f5f7', belly = '#c9ced6', grey = '#8a929c', dark = '#2b2f36';
  // fuselage : profil de révolution couché selon x
  const prof: [number, number][] = [
    [0.0001, 0], [r * 0.55, L * 0.015], [r * 0.85, L * 0.04], [r, L * 0.09], [r, L * 0.62], [r * 0.82, L * 0.78], [r * 0.45, L * 0.93], [r * 0.12, L],
  ];
  const save = k.base;
  k.base = Matrix.RotationZ(Math.PI / 2).multiply(Matrix.Translation(L / 2, r * 1.15, 0)).multiply(save);
  k.lathe(prof.map(([pr, py]) => [pr, py] as [number, number]), 0, 0, 0, (j) => (j === 0 ? grey : body), { tess: 10 });
  k.base = save;
  const cy = r * 1.15; // axe du fuselage
  // cockpit (vitres)
  k.box(L / 2 - L * 0.04, cy + r * 0.35, 0, L * 0.02, r * 0.35, r * 1.1, dark);
  // ventre gris
  k.box(0, cy - r * 0.98, 0, L * 0.5, r * 0.25, r * 1.2, belly);
  // ailes en flèche : trapèzes
  const sweep = s.engines === 4 ? 0.62 : 0.55;
  const rootX = L * 0.04, rootC = L * 0.2, tipC = rootC * 0.28;
  const wing = (side: number) => {
    const y0 = cy - r * 0.55;
    const tipZ = side * s.span / 2;
    const tipX = rootX - Math.tan(sweep) * s.span / 2 * 0.9;
    const pos = [rootX + rootC / 2, y0, 0, rootX - rootC / 2, y0, 0, tipX - tipC / 2, y0 + s.span * 0.03, tipZ, tipX + tipC / 2, y0 + s.span * 0.03, tipZ];
    const top = pos.map((v, i) => (i % 3 === 1 ? v + r * 0.12 : v));
    const all = [...pos, ...top];
    const ind = [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 1, 1, 4, 5, 2, 6, 3, 3, 6, 7, 1, 5, 2, 2, 5, 6, 0, 3, 4, 3, 7, 4];
    const nor: number[] = [];
    VertexData.ComputeNormals(all, ind, nor);
    k.raw(all, nor, ind, null, body);
    // feux de navigation (rouge à gauche = +z, vert à droite)
    k.box(tipX, y0 + s.span * 0.03, tipZ, 0.0006, 0.0005, 0.0006, side > 0 ? '#ff2020' : '#20ff40', { glow: 2 });
    // réacteurs sous l'aile
    const engs = s.engines === 2 ? [0.33] : [0.27, 0.6];
    for (const f of engs) {
      const ez = side * f * s.span / 2;
      const ex = rootX - Math.tan(sweep) * Math.abs(ez) * 0.9 + rootC * 0.25;
      const ey = y0 - s.engR * 1.1;
      k.base = Matrix.RotationZ(Math.PI / 2).multiply(Matrix.Translation(ex + s.engR * 2.2, ey, ez)).multiply(save);
      k.lathe([[s.engR * 0.9, 0], [s.engR, s.engR * 0.6], [s.engR, s.engR * 3.2], [s.engR * 0.7, s.engR * 4.4]], 0, 0, 0, (j) => (j === 0 ? dark : grey), { tess: 8 });
      k.base = save;
      k.box(ex + s.engR, ey + s.engR * 0.7, ez, s.engR * 2, s.engR * 0.8, s.engR * 0.3, grey);
    }
  };
  wing(1); wing(-1);
  // empennage horizontal
  const tx = -L / 2 + L * 0.06;
  for (const side of [1, -1]) {
    const hs = s.span * 0.18;
    const pos = [tx + L * 0.07, cy + r * 0.2, 0, tx - L * 0.0, cy + r * 0.2, 0, tx - L * 0.06, cy + r * 0.35, side * hs, tx - L * 0.02, cy + r * 0.35, side * hs];
    const ind = [0, 1, 2, 0, 2, 3];
    const nor: number[] = [];
    VertexData.ComputeNormals(pos, ind, nor);
    k.raw(pos, nor, ind, null, body);
  }
  // feu de queue blanc et feu anticollision clignotant
  k.box(-L / 2, cy, 0, 0.0005, 0.0005, 0.0005, '#ffffff', { glow: 2 });
  k.box(0, cy + r * 1.02, 0, 0.0007, 0.0004, 0.0007, '#ff3030', { glow: 3 });
  k.box(0, cy - r * 1.05, 0, 0.0007, 0.0004, 0.0007, '#ff3030', { glow: 3 });
  // phares d'atterrissage (emplanture)
  k.box(rootX + rootC / 2, cy - r * 0.6, r * 1.3, 0.0005, 0.0004, 0.0005, '#fff6d8', { glow: 1 });
  k.box(rootX + rootC / 2, cy - r * 0.6, -r * 1.3, 0.0005, 0.0004, 0.0005, '#fff6d8', { glow: 1 });
  // train d'atterrissage
  k.box(L * 0.36, 0, 0, 0.0006, cy - r * 0.8, 0.0004, dark);
  for (const z of [-r * 1.1, r * 1.1]) k.box(-L * 0.02, 0, z, 0.0016, cy - r * 0.8, 0.0008, dark);
}

/** Dérive verticale (livrée colorée par instance), même repère que buildPlane. */
export function buildFin(k: Kit, s: PlaneSpec) {
  const L = s.len, r = s.r, cy = r * 1.15;
  const h = s.span * 0.2;
  const x0 = -L / 2 + L * 0.02;
  const pos = [x0 + L * 0.13, cy + r * 0.6, 0, x0 + L * 0.02, cy + r * 0.6, 0, x0 - L * 0.03, cy + r + h, 0, x0 + L * 0.03, cy + r + h, 0];
  const th = r * 0.12;
  const a = pos.map((v, i) => (i % 3 === 2 ? v + th : v));
  const b = pos.map((v, i) => (i % 3 === 2 ? v - th : v));
  const all = [...a, ...b];
  const ind = [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 1, 5, 2, 2, 5, 6, 0, 3, 4, 3, 7, 4, 2, 6, 3, 3, 6, 7];
  const nor: number[] = [];
  VertexData.ComputeNormals(all, ind, nor);
  k.raw(all, nor, ind, null, '#ffffff');
  // bande de livrée sur le fuselage arrière
  k.box(-L * 0.25, cy + r * 0.85, 0, L * 0.25, r * 0.18, r * 0.6, '#ffffff');
}

export const LIVERIES = ['#c1121f', '#003f88', '#2a9d8f', '#f77f00', '#5a189a', '#0b6e4f', '#1d3557', '#d00000', '#118ab2', '#e9c46a', '#3a0ca3', '#9d0208'];

// ---------- Navires (proue selon +x local) ----------
export type ShipKind = 'conteneurs' | 'petrolier' | 'vraquier' | 'feeder' | 'remorqueur' | 'ferry';
export const SHIP_DIM: Record<ShipKind, { len: number; beam: number }> = {
  conteneurs: { len: 0.3, beam: 0.045 },
  petrolier: { len: 0.25, beam: 0.044 },
  vraquier: { len: 0.2, beam: 0.032 },
  feeder: { len: 0.14, beam: 0.022 },
  remorqueur: { len: 0.03, beam: 0.011 },
  ferry: { len: 0.18, beam: 0.028 },
};

/** Coque effilée (proue pointue, poupe arrondie) : flottaison à y = 0, franc-bord fb. */
function hull(k: Kit, len: number, beam: number, fb: number, c: Col, deck: Col) {
  const n = 9;
  const outline: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n; // 0 poupe → 1 proue
    const x = -len / 2 + t * len;
    let w = beam / 2;
    if (t > 0.72) w *= Math.cos(((t - 0.72) / 0.28) * Math.PI / 2) ** 0.8;
    if (t < 0.08) w *= 0.86 + 0.14 * (t / 0.08);
    outline.push([x, Math.max(w, 0.0004)]);
  }
  const pos: number[] = [];
  const ind: number[] = [];
  // flancs : bas (y = -0.3 fb, légèrement rentré) et haut (y = fb)
  const ring = (y: number, shrink: number) => {
    const out: [number, number, number][] = [];
    for (const [x, w] of outline) out.push([x, y, w * shrink]);
    for (let i = outline.length - 1; i >= 0; i--) out.push([outline[i][0], y, -outline[i][1] * shrink]);
    return out;
  };
  const lo = ring(-fb * 0.4, 0.92), hi = ring(fb, 1);
  const N = lo.length;
  for (const p of lo) pos.push(...p);
  for (const p of hi) pos.push(...p);
  for (let i = 0; i < N; i++) { const j = (i + 1) % N; ind.push(i, j, N + i, j, N + j, N + i); }
  const nor: number[] = [];
  VertexData.ComputeNormals(pos, ind, nor);
  k.raw(pos, nor, ind, null, c);
  // ligne de flottaison rouge
  const pos2: number[] = [];
  const lo2 = ring(-fb * 0.4, 0.92), mid = ring(fb * 0.08, 0.985);
  for (const p of lo2) pos2.push(...p);
  for (const p of mid) pos2.push(...p);
  const ind2: number[] = [];
  for (let i = 0; i < N; i++) { const j = (i + 1) % N; ind2.push(i, j, N + i, j, N + j, N + i); }
  const nor2: number[] = [];
  VertexData.ComputeNormals(pos2, ind2, nor2);
  for (let q = 0; q < pos2.length; q += 3) { const s = 1.003; pos2[q + 2] *= s; }
  k.raw(pos2, nor2, ind2, null, '#8c1c13');
  // pont
  const deckPts: [number, number][] = hi.map(([x, , z]) => [x, z]);
  const dpos: number[] = [];
  const dnor: number[] = [];
  const dind: number[] = [];
  const cx = deckPts.reduce((s, p) => s + p[0], 0) / deckPts.length;
  dpos.push(cx, fb, 0); dnor.push(0, 1, 0);
  for (const [x, z] of deckPts) { dpos.push(x, fb, z); dnor.push(0, 1, 0); }
  for (let i = 1; i <= deckPts.length; i++) dind.push(0, i, (i % deckPts.length) + 1);
  k.raw(dpos, dnor, dind, null, deck);
}

/** Construit un navire bas poly avec sa cargaison (rnd pour la variété des conteneurs). */
export function buildShip(k: Kit, kind: ShipKind, rnd: () => number, loaded = true) {
  const { len, beam } = SHIP_DIM[kind];
  const white = '#f2f2ee';
  const accLight = (x: number, y: number, z: number, c = '#fff1c9') => k.box(x, y, z, 0.0012, 0.0008, 0.0012, c, { glow: 1 });
  if (kind === 'remorqueur') {
    hull(k, len, beam, 0.0028, '#c1121f', '#3d3d3d');
    k.box(0.002, 0.0028, 0, 0.01, 0.004, 0.0075, white);
    k.box(0.003, 0.0068, 0, 0.005, 0.0022, 0.006, '#22313f');
    k.cyl(-0.002, 0.0068, 0, 0.0008, 0.0008, 0.004, '#222');
    accLight(0.003, 0.009, 0);
    return;
  }
  if (kind === 'conteneurs' || kind === 'feeder') {
    const fb = kind === 'conteneurs' ? 0.012 : 0.008;
    hull(k, len, beam, fb, kind === 'conteneurs' ? '#1d3557' : '#2f4858', '#6c757d');
    // château à l'arrière (au 1/4 pour les grands porte-conteneurs)
    const hx = kind === 'conteneurs' ? -len * 0.28 : -len * 0.4;
    const hh = kind === 'conteneurs' ? 0.03 : 0.018;
    k.box(hx, fb, 0, 0.014, hh, beam * 0.92, white);
    k.box(hx, fb + hh, 0, 0.016, 0.0025, beam * 1.05, '#d9d9d4');
    k.box(hx + 0.0072, fb + hh - 0.004, 0, 0.0008, 0.0025, beam * 0.98, '#1b263b', { glow: 1 });
    k.box(hx - 0.022, fb, 0, 0.006, 0.026, 0.004, '#343a40');
    accLight(hx + 0.008, fb + hh + 0.003, 0);
    if (loaded) {
      const tiers = kind === 'conteneurs' ? 6 : 4;
      const rows = Math.floor((beam * 0.92) / 0.00244);
      const cols = ['#c1121f', '#1d3557', '#2a9d8f', '#e9c46a', '#f4a261', '#6c757d', '#e76f51', '#264653', '#8d99ae', '#457b9d', '#d62828', '#ffffff', '#3a5a40', '#9b2226'];
      const bays: number[] = [];
      for (let x = -len / 2 + 0.03; x < len / 2 - 0.035; x += 0.0128) if (Math.abs(x - hx) > 0.012) bays.push(x);
      for (const bx of bays) {
        const t = (bx + len / 2) / len;
        const taper = t > 0.8 ? 1 - (t - 0.8) * 2.2 : 1;
        const nr = Math.max(2, Math.floor(rows * taper));
        const h = 1 + Math.floor(rnd() * tiers);
        for (let r = 0; r < nr; r++) {
          const z = (r - (nr - 1) / 2) * 0.00244;
          const hr = Math.max(1, h - (rnd() < 0.3 ? 1 : 0));
          for (let j = 0; j < hr; j++) k.box(bx, fb + j * 0.0026, z, 0.0121, 0.0025, 0.00236, cols[Math.floor(rnd() * cols.length)]);
        }
      }
    }
    return;
  }
  if (kind === 'petrolier') {
    const fb = 0.011;
    hull(k, len, beam, fb, '#3d0c11', '#a63c2b');
    k.box(-len * 0.42, fb, 0, 0.016, 0.022, beam * 0.8, white);
    k.box(-len * 0.42 + 0.008, fb + 0.017, 0, 0.0008, 0.0025, beam * 0.75, '#1b263b', { glow: 1 });
    k.box(-len * 0.47, fb + 0.022, 0, 0.004, 0.012, 0.004, '#c1121f');
    k.box(0.005, fb, 0, len * 0.72, 0.0012, 0.0016, '#d9d9d4');
    for (let x = -len * 0.3; x < len * 0.38; x += 0.03) k.box(x, fb, 0, 0.0016, 0.004, beam * 0.6, '#6c757d');
    accLight(-len * 0.42, fb + 0.024, 0);
    return;
  }
  if (kind === 'vraquier') {
    const fb = 0.01;
    hull(k, len, beam, fb, '#264653', '#7f5539');
    k.box(-len * 0.42, fb, 0, 0.014, 0.02, beam * 0.85, white);
    k.box(-len * 0.42 + 0.0072, fb + 0.015, 0, 0.0008, 0.0025, beam * 0.8, '#1b263b', { glow: 1 });
    for (let x = -len * 0.3; x < len * 0.38; x += 0.026) k.box(x, fb, 0, 0.018, 0.0018, beam * 0.7, '#9c6644');
    for (const x of [-len * 0.18, 0.0, len * 0.18]) { k.cyl(x, fb, beam * 0.3, 0.0008, 0.0006, 0.016, '#e9c46a'); k.beam(new Vector3(x, fb + 0.015, beam * 0.3), new Vector3(x + 0.02, fb + 0.012, 0), 0.0007, 0.0007, '#e9c46a'); }
    accLight(-len * 0.42, fb + 0.022, 0);
    return;
  }
  // ferry / roulier
  const fb = 0.009;
  hull(k, len, beam, fb, white, '#adb5bd');
  k.box(-0.005, fb, 0, len * 0.78, 0.014, beam * 0.96, white);
  for (let j = 0; j < 3; j++) k.box(-0.005, fb + 0.003 + j * 0.0035, 0, len * 0.76, 0.0012, beam * 0.985, '#1b263b', { glow: 1 });
  k.box(-len * 0.2, fb + 0.014, 0, 0.012, 0.008, 0.008, '#003f88');
  accLight(len * 0.3, fb + 0.016, 0);
}

/** Matrice de pose (position, cap autour de Y, tangage) pour les instances animées. */
export function poseMatrix(out: Matrix, x: number, y: number, z: number, yaw: number, pitch: number, scale = 1, roll = 0) {
  Quaternion.RotationYawPitchRollToRef(yaw, roll, pitch, iq);
  isv.setAll(scale);
  itv.set(x, y, z);
  Matrix.ComposeToRef(isv, iq, itv, out);
  return out;
}

export { VertexBuffer };
