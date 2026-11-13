/**
 * Rendu de la foule des piétons.
 *
 *  - Chargement : manifest.json + 3 LOD GLB par personnage (tools/pedestrians/generate_pedestrians.py) ;
 *    les clips `marche` / `attente` du LOD0 sont cuits en texture (skin.ts) et servent aux trois LOD
 *    (même squelette, mêmes noms d'os, rotations de repos identité).
 *  - Instanciation : un InstancedMesh par (personnage, LOD) ; attribut d'instance `aPed` = (ligne d'animation,
 *    rangée de palette). Au-delà du LOD2 : imposteurs (quadrilatères face caméra, silhouette générée, deux
 *    couleurs de palette), un seul appel de dessin pour tous.
 *  - Mouvement : la simulation envoie ~10 trames/s (ids instables en ordre) ; le rendu interpole chaque piéton
 *    entre la position affichée au moment de la trame et la nouvelle cible. La phase de marche avance de la
 *    distance réellement parcourue / foulée : aucun patinage, quelle que soit la vitesse du jeu.
 * Le rendu ne modifie jamais l'état du jeu.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import {
  PIETON_IDLE_BIT, PIETON_META_STRIDE, PIETON_POS_STRIDE, type PietonsFrame,
} from '../../shared/protocol-ext/pietons';
import { PED_MANIFEST_FILE, PED_MODELS_DIR, PedCasting, checkManifest, type PedManifest } from './manifest';
import { bakeSkeleton, paletteTexture, patchPedMaterial, type BakedSkeleton, type PedUniforms } from './skin';

/** Distances de bascule (m) : LOD0 → LOD1 → LOD2 → imposteur ; au-delà : rien. */
export const PED_LOD_DIST = [35, 110, 320] as const;
export const PED_MAX_DIST = 1400;

interface Ped {
  model: number;
  row: number;
  scale: number;
  idle: boolean;
  /** Position/cap au moment de la dernière trame (départ de l'interpolation). */
  ax: number; ay: number; az: number; ah: number;
  /** Cible (trame). */
  bx: number; by: number; bz: number; bh: number;
  /** Position affichée courante. */
  x: number; y: number; z: number; h: number;
  phase: number;
  gen: number;
}

interface Group {
  mesh: THREE.InstancedMesh;
  aPed: THREE.InstancedBufferAttribute;
  capacity: number;
  n: number;
}

interface ModelRender {
  bake: BakedSkeleton;
  uniforms: PedUniforms;
  stride: number;
  walkSpeed: number;
  idleDur: number;
  lods: Group[];
  geometries: THREE.BufferGeometry[];
}

export interface PedRenderStats { pietons: number; dessines: number; lod: [number, number, number, number]; appels: number }

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const frustum = new THREE.Frustum();
const projView = new THREE.Matrix4();
const sphere = new THREE.Sphere(new THREE.Vector3(), 1.2);

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/** Silhouette d'imposteur (alpha) : tête, buste, jambes — 32 × 64 px. */
function silhouetteTexture(): THREE.DataTexture {
  const W = 32, H = 64;
  const d = new Uint8Array(W * H * 4);
  const put = (x: number, y: number, part: number) => {
    const o = (y * W + x) * 4;
    d[o] = part; d[o + 1] = 255; d[o + 2] = 255; d[o + 3] = 255;
  };
  for (let y = 0; y < H; y++) {
    const v = y / (H - 1); // 0 = pieds, 1 = sommet de la tête
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W - 0.5;
      // R : 0 = bas (jambes), 128 = haut (buste), 255 = peau (tête).
      if (v > 0.84) { if (Math.hypot(u / 0.16, (v - 0.92) / 0.075) < 1) put(x, y, 255); }
      else if (v > 0.47) { const w = 0.27 - (v - 0.47) * 0.25; if (Math.abs(u) < w) put(x, y, 128); }
      else if (Math.abs(Math.abs(u) - 0.09) < 0.075 + v * 0.06) put(x, y, 0);
    }
  }
  const t = new THREE.DataTexture(d, W, H, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

export class PedestrianCrowdRenderer {
  readonly group = new THREE.Group();
  private manifest: PedManifest | null = null;
  private casting: PedCasting | null = null;
  private models: ModelRender[] = [];
  private palette: THREE.DataTexture | null = null;
  private peds = new Map<number, Ped>();
  private gen = 0;
  private frameAge = 0;
  private frameInterval = 0.1;
  private impostor: Group | null = null;
  private impostorMat: THREE.ShaderMaterial | null = null;
  private impostorColor: THREE.InstancedBufferAttribute | null = null;
  private pending: PietonsFrame | null = null;
  /** Par rangée de palette : couleur du haut (rgb linéaire) et gris du bas, pour les imposteurs. */
  private impostorRgb = new Float32Array(0);
  ready = false;
  readonly stats: PedRenderStats = { pietons: 0, dessines: 0, lod: [0, 0, 0, 0], appels: 0 };

  constructor(private readonly camera: THREE.PerspectiveCamera) {
    this.group.name = 'pietons';
  }

  /** Charge le manifeste et les modèles (URL résolue par `url(fichier relatif au dossier assets)`). */
  async load(url: (file: string) => string): Promise<void> {
    const res = await fetch(url(PED_MANIFEST_FILE));
    if (!res.ok) throw new Error(`Manifeste des piétons introuvable (${res.status})`);
    const manifest = checkManifest(await res.json());
    this.manifest = manifest;
    this.casting = new PedCasting(manifest);
    this.palette = paletteTexture(manifest.palettes);
    this.impostorRgb = new Float32Array(manifest.palettes.length * 4);
    const top = new THREE.Color(), bot = new THREE.Color();
    manifest.palettes.forEach((pal, r) => {
      top.set(pal.colors[2] ?? '#808080'); bot.set(pal.colors[3] ?? '#808080');
      this.impostorRgb.set([top.r, top.g, top.b, (bot.r + bot.g + bot.b) / 3], r * 4);
    });
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    this.models = await Promise.all(manifest.models.map(async (info) => {
      const gltfs = await Promise.all(info.lods.map((l) => loader.loadAsync(url(PED_MODELS_DIR + l.file))));
      const g0 = gltfs[0]!;
      const sk0 = findSkinned(g0.scene);
      const bake = bakeSkeleton(g0.scene, sk0, g0.animations, ['marche', 'attente']);
      const uniforms: PedUniforms = { uPedBones: { value: bake.texture }, uPedPalette: { value: this.palette } };
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0, vertexColors: true });
      patchPedMaterial(mat, uniforms, true);
      const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
      patchPedMaterial(depth, uniforms, false);
      const geometries: THREE.BufferGeometry[] = [];
      const lods = gltfs.map((g, lod) => {
        const geo = findSkinned(g.scene).geometry;
        geometries.push(geo);
        return this.makeGroup(geo, mat, lod < 2 ? depth : null, 64);
      });
      while (lods.length < 3) lods.push(lods[lods.length - 1]!);
      return { bake, uniforms, stride: info.strideM, walkSpeed: info.walkSpeed, idleDur: info.animations.attente.duration, lods, geometries };
    }));
    this.buildImpostors();
    this.ready = true;
    if (this.pending) { const f = this.pending; this.pending = null; this.applyFrame(f); }
  }

  private makeGroup(geo: THREE.BufferGeometry, mat: THREE.Material, depth: THREE.Material | null, capacity: number): Group {
    const aPed = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    aPed.setUsage(THREE.DynamicDrawUsage);
    const g = geo.clone();
    g.setAttribute('aPed', aPed);
    const mesh = new THREE.InstancedMesh(g, mat, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = depth !== null;
    mesh.receiveShadow = true;
    if (depth) mesh.customDepthMaterial = depth;
    this.group.add(mesh);
    return { mesh, aPed, capacity, n: 0 };
  }

  private grow(gr: Group, need: number): void {
    if (need <= gr.capacity) return;
    let cap = gr.capacity;
    while (cap < need) cap *= 2;
    const old = gr.mesh;
    const geo = old.geometry;
    // Agrandissement en cours d'image : les instances déjà écrites sont recopiées.
    const aPed = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    aPed.setUsage(THREE.DynamicDrawUsage);
    aPed.array.set(gr.aPed.array as Float32Array);
    geo.setAttribute('aPed', aPed);
    if (gr === this.impostor && this.impostorColor) {
      const extra = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
      extra.setUsage(THREE.DynamicDrawUsage);
      extra.array.set(this.impostorColor.array as Float32Array);
      geo.setAttribute('aCol', extra);
      this.impostorColor = extra;
    }
    const mesh = new THREE.InstancedMesh(geo, old.material, cap);
    mesh.instanceMatrix.array.set(old.instanceMatrix.array);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.castShadow = old.castShadow;
    mesh.receiveShadow = old.receiveShadow;
    mesh.customDepthMaterial = old.customDepthMaterial;
    mesh.count = 0;
    this.group.remove(old);
    old.dispose();
    this.group.add(mesh);
    gr.mesh = mesh;
    gr.aPed = aPed;
    gr.capacity = cap;
  }

  private buildImpostors(): void {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uSil: { value: silhouetteTexture() }, uNight: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute vec4 aPed;   // largeur, hauteur
        attribute vec4 aCol;   // haut (rgb packé 0..1 en x,y,z), bas = w (gris)
        varying vec2 vUv; varying vec4 vCol;
        void main() {
          vUv = uv; vCol = aCol;
          vec4 base = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          base.xy += vec2(position.x * aPed.x, position.y * aPed.y);
          gl_Position = projectionMatrix * base;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uSil; uniform float uNight;
        varying vec2 vUv; varying vec4 vCol;
        void main() {
          vec4 s = texture2D(uSil, vUv);
          if (s.a < 0.5) discard;
          vec3 top = vCol.rgb;
          vec3 c = s.r > 0.75 ? vec3(0.78, 0.6, 0.48) : (s.r > 0.25 ? top : vec3(vCol.a) * vec3(0.55, 0.6, 0.75));
          gl_FragColor = vec4(c * mix(0.85, 0.25, uNight), 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.impostorMat = mat;
    const gr = this.makeGroup(geo, mat, null, 256);
    gr.mesh.castShadow = false;
    gr.mesh.receiveShadow = false;
    const col = new THREE.InstancedBufferAttribute(new Float32Array(256 * 4), 4);
    col.setUsage(THREE.DynamicDrawUsage);
    gr.mesh.geometry.setAttribute('aCol', col);
    this.impostorColor = col;
    this.impostor = gr;
  }

  /** Nouvelle trame de la simulation. */
  applyFrame(f: PietonsFrame): void {
    if (!this.ready || !this.casting) { this.pending = f; return; }
    const gen = ++this.gen;
    const cast = this.casting;
    // Intervalle lissé entre trames (pour l'interpolation).
    if (this.frameAge > 0.02 && this.frameAge < 2) this.frameInterval = this.frameInterval * 0.8 + this.frameAge * 0.2;
    this.frameAge = 0;
    for (let i = 0; i < f.count; i++) {
      const id = f.ids[i]!;
      const o = i * PIETON_POS_STRIDE, m = i * PIETON_META_STRIDE;
      const x = f.pos[o]!, y = f.pos[o + 1]!, z = f.pos[o + 2]!, h = f.pos[o + 3]!;
      let p = this.peds.get(id);
      if (!p) {
        const profil = f.meta[m]!, seed = f.meta[m + 1]! ^ ((id * 2654435761) >>> 24);
        const model = cast.model(profil, seed);
        p = {
          model, row: cast.paletteRow(model, seed), scale: PedCasting.scale(seed), idle: false,
          ax: x, ay: y, az: z, ah: h, bx: x, by: y, bz: z, bh: h, x, y, z, h, phase: (seed % 97) / 97, gen,
        };
        this.peds.set(id, p);
      } else {
        p.ax = p.x; p.ay = p.y; p.az = p.z; p.ah = p.h;
        p.bx = x; p.by = y; p.bz = z; p.bh = p.ah + wrapAngle(h - p.ah);
        p.gen = gen;
        // Saut (sortie d'un bâtiment, téléportation) : pas d'interpolation.
        if (Math.abs(x - p.ax) + Math.abs(z - p.az) > 15) { p.ax = x; p.az = z; p.ay = y; p.x = x; p.z = z; p.y = y; }
      }
      p.idle = (f.meta[m + 2]! & PIETON_IDLE_BIT) !== 0;
    }
    for (const [id, p] of this.peds) if (p.gen !== gen) this.peds.delete(id);
    this.stats.pietons = this.peds.size;
  }

  /** Diagnostic : jusqu'à `n` piétons affichés (id, position, cap, à l'arrêt, personnage, phase). */
  sample(n: number): { id: number; x: number; y: number; z: number; h: number; idle: boolean; model: string; phase: number }[] {
    const out = [];
    for (const [id, p] of this.peds) {
      if (out.length >= n) break;
      out.push({ id, x: p.x, y: p.y, z: p.z, h: p.h, idle: p.idle, model: this.manifest?.models[p.model]?.id ?? '?', phase: p.phase });
    }
    return out;
  }

  clear(): void {
    this.peds.clear();
    this.pending = null;
    this.stats.pietons = 0;
  }

  /** À chaque image : interpolation, choix du LOD, remplissage des instances. */
  frame(dt: number, night: number): void {
    if (!this.ready) return;
    this.frameAge += dt;
    const t = Math.min(1, this.frameAge / Math.max(0.03, this.frameInterval));
    const cam = this.camera;
    cam.updateMatrixWorld();
    projView.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projView);
    const cx = cam.position.x, cy = cam.position.y, cz = cam.position.z;
    const models = this.models;
    for (const m of models) for (const g of m.lods) g.n = 0;
    const imp = this.impostor!;
    imp.n = 0;
    const lodCount: [number, number, number, number] = [0, 0, 0, 0];
    // Passe 1 : interpolation + comptage par groupe (pour dimensionner avant d'écrire).
    for (const p of this.peds.values()) {
      const nx = p.ax + (p.bx - p.ax) * t, nz = p.az + (p.bz - p.az) * t;
      const moved = Math.hypot(nx - p.x, nz - p.z);
      p.x = nx; p.z = nz;
      p.y = p.ay + (p.by - p.ay) * t;
      p.h = p.ah + (p.bh - p.ah) * t;
      const mr = models[p.model]!;
      if (p.idle && moved < 0.002) p.phase = (p.phase + dt / mr.idleDur) % 1;
      else p.phase = (p.phase + moved / (mr.stride * p.scale)) % 1;
    }
    for (const p of this.peds.values()) {
      sphere.center.set(p.x, p.y + 0.9, p.z);
      if (!frustum.intersectsSphere(sphere)) continue;
      const d = Math.hypot(p.x - cx, p.y - cy, p.z - cz);
      if (d > PED_MAX_DIST) continue;
      const lod = d < PED_LOD_DIST[0] ? 0 : d < PED_LOD_DIST[1] ? 1 : d < PED_LOD_DIST[2] ? 2 : 3;
      lodCount[lod]++;
      const mr = models[p.model]!;
      const info = this.manifest!.models[p.model]!;
      if (lod === 3) {
        if (imp.n >= imp.capacity) this.grow(imp, imp.n + 1);
        const k = imp.n++;
        tmpM.makeTranslation(p.x, p.y, p.z);
        imp.mesh.setMatrixAt(k, tmpM);
        const hgt = info.height * p.scale;
        imp.aPed.setXYZW(k, hgt * 0.42, hgt, 0, 0);
        const c = this.impostorRgb, o = p.row * 4;
        this.impostorColor!.setXYZW(k, c[o]!, c[o + 1]!, c[o + 2]!, c[o + 3]!);
        continue;
      }
      const gr = mr.lods[lod]!;
      if (gr.n >= gr.capacity) this.grow(gr, gr.n + 1);
      const k = gr.n++;
      tmpQ.setFromAxisAngle(UP, p.h);
      tmpP.set(p.x, p.y, p.z);
      tmpS.setScalar(p.scale);
      tmpM.compose(tmpP, tmpQ, tmpS);
      gr.mesh.setMatrixAt(k, tmpM);
      const clip = p.idle ? mr.bake.clips.attente! : mr.bake.clips.marche!;
      const frameRow = clip.row0 + Math.min(clip.frames - 1, Math.floor(p.phase * clip.frames));
      gr.aPed.setXYZW(k, frameRow, p.row, 0, 0);
    }
    let calls = 0, drawn = 0;
    const seen = new Set<Group>();
    for (const m of models) for (const g of m.lods) {
      if (seen.has(g)) continue;
      seen.add(g);
      g.mesh.count = g.n;
      if (g.n > 0) { g.mesh.instanceMatrix.needsUpdate = true; g.aPed.needsUpdate = true; calls++; drawn += g.n; }
    }
    imp.mesh.count = imp.n;
    if (imp.n > 0) { imp.mesh.instanceMatrix.needsUpdate = true; imp.aPed.needsUpdate = true; this.impostorColor!.needsUpdate = true; calls++; drawn += imp.n; }
    if (this.impostorMat) this.impostorMat.uniforms.uNight!.value = night;
    this.stats.dessines = drawn;
    this.stats.lod = lodCount;
    this.stats.appels = calls;
  }

  dispose(): void {
    for (const m of this.models) {
      m.bake.texture.dispose();
      for (const g of m.lods) { g.mesh.geometry.dispose(); g.mesh.dispose(); }
      for (const g of m.geometries) g.dispose();
    }
    this.palette?.dispose();
    this.impostor?.mesh.geometry.dispose();
    this.impostorMat?.dispose();
    this.group.removeFromParent();
    this.models = [];
    this.peds.clear();
    this.ready = false;
  }
}

function findSkinned(root: THREE.Object3D): THREE.SkinnedMesh {
  let found: THREE.SkinnedMesh | null = null;
  root.traverse((o) => { if (!found && (o as THREE.SkinnedMesh).isSkinnedMesh) found = o as THREE.SkinnedMesh; });
  if (!found) throw new Error('Personnage sans maillage skinné');
  return found;
}

