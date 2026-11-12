/**
 * Rendu instancié des véhicules (implémente IVehicleRenderer).
 *
 * - Un lot par (modèle, LOD) : trois InstancedMesh (peinture / détails / verre) qui PARTAGENT le même
 *   tampon de matrices d'instance ; la peinture reçoit une couleur par instance (variante du catalogue).
 * - Matériaux partagés par toute la flotte (une seule copie de chaque texture en mémoire GPU) :
 *   peinture vernie (MeshPhysicalMaterial, vernis), détails (atlas PBR + carte émissive des optiques),
 *   verre sombre réfléchissant.
 * - Trames de la simulation (Float32Array x, y, z, cap) INTERPOLÉES entre deux ticks, identité des
 *   véhicules par `ids` (trame étendue du trafic) ; à défaut, par l'ordre.
 * - LOD par distance (distances du catalogue) avec chargement progressif ; culling par instance contre
 *   le frustum ; phares la nuit (intensité émissive + halos au sol instanciés).
 * - `update()` n'alloue rien (tableaux préalloués, croissance par doublement hors régime établi).
 */
import * as THREE from 'three';
import type { AssetCatalog, CatalogAsset } from '../../shared/catalog';
import { VEHICLE_STRIDE } from '../../shared/constants';
import type { IVehicleRenderer } from '../../shared/contracts';
import type { VehicleFrame } from '../../shared/protocol';

/** Champs optionnels ajoutés par la simulation de trafic (src/sim/traffic) à la trame véhicules. */
export interface VehicleFrameExt extends VehicleFrame {
  /** Identifiant stable de chaque véhicule (emplacement dans le stock du trafic). */
  ids?: Uint32Array;
  /** Index de variante de peinture (0..n-1). */
  variants?: Uint8Array;
  /** Bits d'état : 1 = freine, 2 = clignotant gauche, 4 = clignotant droit, 8 = urgence. */
  flags?: Uint8Array;
}

/** Source de modèles : la bibliothèque d'assets du jeu (src/render/assets.ts) convient. */
export interface VehicleModelSource {
  readonly catalog: AssetCatalog;
  load(assetId: string, lod?: number): Promise<THREE.Group>;
  url(file: string): string;
}

interface Lot {
  state: 0 | 1 | 2 | 3; // non demandé, en cours, prêt, échec
  meshes: THREE.InstancedMesh[];
  paint: THREE.InstancedMesh | null;
  matrices: Float32Array;
  colors: Float32Array;
  capacity: number;
  count: number;
  matAttr: THREE.InstancedBufferAttribute | null;
  colAttr: THREE.InstancedBufferAttribute | null;
}
interface Model {
  asset: CatalogAsset;
  lods: Lot[];
  maxDist: number[];
  radius: number;
  palette: Float32Array; // r, g, b linéaires par variante
}

const _frustum = new THREE.Frustum();
const _pv = new THREE.Matrix4();
const _sphere = new THREE.Sphere();
const _col = new THREE.Color();
const _m = new THREE.Matrix4();

function srgbHexToLinear(hex: string, out: Float32Array, o: number): void {
  _col.set(hex).convertSRGBToLinear();
  out[o] = _col.r; out[o + 1] = _col.g; out[o + 2] = _col.b;
}

function hash32(x: number): number {
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}

/** Facteur de nuit (0 jour .. 1 nuit) selon l'heure du jeu, transitions à l'aube et au crépuscule. */
export function nightFactorForHour(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 7.5 && h <= 18.5) return 0;
  if (h >= 20 || h <= 6) return 1;
  if (h < 7.5) return (7.5 - h) / 1.5;
  return (h - 18.5) / 1.5;
}

export class InstancedVehicleRenderer implements IVehicleRenderer {
  count = 0;
  /** Nombre d'instances dessinées à la dernière mise à jour (après culling), par LOD. */
  readonly drawn = [0, 0, 0];
  readonly group = new THREE.Group();
  readonly loadErrors: string[] = [];

  private readonly models: (Model | null)[] = [];
  private readonly vehicleAssets: number[] = [];
  private paintMat!: THREE.MeshPhysicalMaterial;
  private detailMat!: THREE.MeshStandardMaterial;
  private glassMat!: THREE.MeshPhysicalMaterial;
  private camera: THREE.Camera | null = null;
  private night = 0;
  private texturesReady: Promise<void>;
  private pending = new Set<Promise<unknown>>();

  // trames
  private curPos = new Float32Array(0);
  private curAsset = new Uint16Array(0);
  private curIds = new Uint32Array(0);
  private curVar = new Uint8Array(0);
  private curFlags = new Uint8Array(0);
  private curCount = 0;
  private curTime = 0;
  private interval = 100;
  // état par identifiant (position affichée au moment de la trame précédente)
  private prevX = new Float32Array(1024);
  private prevY = new Float32Array(1024);
  private prevZ = new Float32Array(1024);
  private prevH = new Float32Array(1024);
  private prevSeen = new Uint32Array(1024);
  private frameSeq = 1;
  // positions affichées de la trame courante (interpolées)
  private dispX = new Float32Array(0);
  private dispY = new Float32Array(0);
  private dispZ = new Float32Array(0);
  private dispH = new Float32Array(0);

  // halos des phares
  private beams: THREE.InstancedMesh;
  private beamCap = 0;
  private now: () => number;

  constructor(private readonly scene: THREE.Scene, private readonly src: VehicleModelSource, opts: { now?: () => number; shadows?: boolean } = {}) {
    this.now = opts.now ?? (() => performance.now());
    this.shadows = opts.shadows ?? true;
    this.group.name = 'vehicules';
    scene.add(this.group);
    const cat = src.catalog;
    cat.assets.forEach((a, i) => {
      if (a.category !== 'vehicle') { this.models.push(null); return; }
      this.vehicleAssets.push(i);
      const palette = new Float32Array(Math.max(1, a.variants.length) * 3);
      if (a.variants.length === 0) palette.fill(0.8);
      a.variants.forEach((v, k) => srgbHexToLinear(v.materialOverrides?.['peinture']?.color ?? '#cccccc', palette, k * 3));
      const maxDist = a.lods.map((l) => l.maxDistance);
      const radius = 0.5 * Math.hypot(a.dimensions.width, a.dimensions.height, a.dimensions.depth);
      this.models.push({ asset: a, lods: a.lods.map(() => this.emptyLot()), maxDist, radius, palette });
    });
    this.texturesReady = this.buildMaterials();
    this.beams = this.buildBeams();
    this.group.add(this.beams);
  }
  private readonly shadows: boolean;

  private emptyLot(): Lot {
    return { state: 0, meshes: [], paint: null, matrices: new Float32Array(0), colors: new Float32Array(0), capacity: 0, count: 0, matAttr: null, colAttr: null };
  }

  /* ----------------------------- matériaux ----------------------------- */

  private async buildMaterials(): Promise<void> {
    const sets = new Map(this.src.catalog.textureSets.map((t) => [t.id, t]));
    const loader = new THREE.TextureLoader();
    const load = (file: string | undefined, srgb: boolean): Promise<THREE.Texture | null> => {
      if (!file) return Promise.resolve(null);
      return loader.loadAsync(this.src.url(file)).then((t) => {
        t.flipY = false; // UV glTF : origine en haut à gauche
        t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = 4;
        t.needsUpdate = true;
        return t;
      }).catch((e: unknown) => { this.loadErrors.push(`texture ${file} : ${e instanceof Error ? e.message : String(e)}`); return null; });
    };
    this.paintMat = new THREE.MeshPhysicalMaterial({ name: 'vehicule_peinture', color: 0xffffff, roughness: 1, metalness: 1, clearcoat: 1, clearcoatRoughness: 0.12 });
    this.detailMat = new THREE.MeshStandardMaterial({ name: 'vehicule_details', color: 0xffffff, roughness: 1, metalness: 1, emissive: 0xffffff, emissiveIntensity: 0.3 });
    this.glassMat = new THREE.MeshPhysicalMaterial({ name: 'vehicule_verre', color: 0x18222b, roughness: 0.04, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.6 });
    const atlas = sets.get('vehicules_atlas');
    const paint = sets.get('vehicules_peinture');
    if (!atlas || !paint) { this.loadErrors.push('jeux de textures véhicules absents du catalogue'); return; }
    const emissiveFile = atlas.albedo.replace('_albedo.', '_emissive.');
    const [pa, pn, parm, aa, an, aarm, ae] = await Promise.all([
      load(paint.albedo, true), load(paint.normal, false), load(paint.arm, false),
      load(atlas.albedo, true), load(atlas.normal, false), load(atlas.arm, false), load(emissiveFile, true),
    ]);
    Object.assign(this.paintMat, { map: pa, normalMap: pn, roughnessMap: parm, metalnessMap: parm, aoMap: parm });
    this.paintMat.normalScale.set(0.25, 0.25);
    Object.assign(this.detailMat, { map: aa, normalMap: an, roughnessMap: aarm, metalnessMap: aarm, aoMap: aarm, emissiveMap: ae });
    for (const m of [this.paintMat, this.detailMat]) m.needsUpdate = true;
    this.setNight(this.night);
  }

  /** Texture radiale du halo de phare (générée, aucune ressource externe). */
  private buildBeams(): THREE.InstancedMesh {
    const S = 64;
    const data = new Uint8Array(S * S * 4);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S - 0.5, v = (y + 0.5) / S;
      // cône allongé vers l'avant (v croissant), plus large au loin
      const w = 0.18 + v * 0.32;
      const a = Math.max(0, 1 - Math.abs(u) / w) * Math.sin(Math.min(1, v * 1.4) * Math.PI) * (1 - v * 0.55);
      const i = (y * S + x) * 4;
      data[i] = 255; data[i + 1] = 236; data[i + 2] = 200; data[i + 3] = Math.round(Math.max(0, Math.min(1, a)) * 255);
    }
    const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
    tex.needsUpdate = true;
    const geo = new THREE.PlaneGeometry(4.2, 11);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0.06, 5.5);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0, color: 0xffe8c8, toneMapped: false });
    const mesh = new THREE.InstancedMesh(geo, mat, 16);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.name = 'halos_phares';
    mesh.renderOrder = 2;
    this.beamCap = 16;
    return mesh;
  }

  /** 0 = plein jour, 1 = nuit : optiques émissives (feux de jour le jour) et halos au sol. */
  setNight(f: number): void {
    this.night = Math.max(0, Math.min(1, f));
    if (this.detailMat) this.detailMat.emissiveIntensity = 0.35 + 2.4 * this.night;
    (this.beams.material as THREE.MeshBasicMaterial).opacity = 0.55 * this.night;
    this.beams.visible = this.night > 0.05;
  }

  attachCamera(camera: THREE.Camera): void { this.camera = camera; }

  /** Force un LOD (vitrine, validation) ; null = LOD par distance. */
  forceLod: number | null = null;

  /* ----------------------------- chargement ----------------------------- */

  private requestLod(model: Model, lod: number): void {
    const lot = model.lods[lod]!;
    if (lot.state !== 0) return;
    lot.state = 1;
    const p = Promise.all([this.src.load(model.asset.id, lod), this.texturesReady]).then(([root]) => {
      this.buildLot(model, lot, root);
      lot.state = 2;
    }).catch((e: unknown) => {
      lot.state = 3;
      this.loadErrors.push(`${model.asset.id} LOD${lod} : ${e instanceof Error ? e.message : String(e)}`);
    });
    this.pending.add(p);
    void p.finally(() => this.pending.delete(p));
  }

  private buildLot(model: Model, lot: Lot, root: THREE.Group): void {
    root.updateMatrixWorld(true);
    const parts: { geo: THREE.BufferGeometry; role: string }[] = [];
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as THREE.Material;
      const role = (mat.userData?.['aube'] as { role?: string } | undefined)?.role ?? (mat.name === 'details' ? 'details' : mat.name);
      parts.push({ geo: bakeGeometry(mesh.geometry, mesh.matrixWorld), role });
    });
    lot.capacity = 32;
    lot.matrices = new Float32Array(lot.capacity * 16);
    lot.colors = new Float32Array(lot.capacity * 3);
    lot.matAttr = new THREE.InstancedBufferAttribute(lot.matrices, 16);
    lot.matAttr.setUsage(THREE.DynamicDrawUsage);
    lot.colAttr = new THREE.InstancedBufferAttribute(lot.colors, 3);
    lot.colAttr.setUsage(THREE.DynamicDrawUsage);
    for (const { geo, role } of parts) {
      const mat = role === 'peinture' ? this.paintMat : role === 'verre' ? this.glassMat : this.detailMat;
      const im = new THREE.InstancedMesh(geo, mat, lot.capacity);
      im.instanceMatrix = lot.matAttr;
      if (role === 'peinture') { im.instanceColor = lot.colAttr; lot.paint = im; }
      im.count = 0;
      im.frustumCulled = false;
      im.castShadow = this.shadows && lot === model.lods[0];
      im.receiveShadow = false;
      im.name = `${model.asset.id}_${role}`;
      this.group.add(im);
      lot.meshes.push(im);
    }
  }

  private growLot(lot: Lot, need: number): void {
    let cap = lot.capacity;
    while (cap < need) cap *= 2;
    const m = new Float32Array(cap * 16); m.set(lot.matrices);
    const c = new Float32Array(cap * 3); c.set(lot.colors);
    lot.matrices = m; lot.colors = c; lot.capacity = cap;
    lot.matAttr = new THREE.InstancedBufferAttribute(m, 16);
    lot.matAttr.setUsage(THREE.DynamicDrawUsage);
    lot.colAttr = new THREE.InstancedBufferAttribute(c, 3);
    lot.colAttr.setUsage(THREE.DynamicDrawUsage);
    for (const im of lot.meshes) {
      // libère les anciens tampons GPU (les nouveaux sont créés au prochain rendu), puis remplace les attributs
      if (im === lot.meshes[0]) im.dispose();
      im.instanceMatrix = lot.matAttr;
      if (im === lot.paint) im.instanceColor = lot.colAttr;
      im.count = 0;
    }
  }

  /** Demande le chargement de tous les LOD de tous les véhicules (démo, validation). */
  preloadAll(): void {
    for (const m of this.models) if (m) for (let l = 0; l < m.lods.length; l++) this.requestLod(m, l);
  }

  /** Résout quand les textures et tous les LOD demandés sont chargés. */
  async whenReady(): Promise<void> {
    await this.texturesReady;
    while (this.pending.size) await Promise.all([...this.pending]);
  }

  /* ----------------------------- trames ----------------------------- */

  setVehicles(positions: Float32Array, assetIndices: Uint16Array, count: number): void {
    this.setFrame({ count, positions, assetIndices });
  }

  /** Reçoit une trame de la simulation (positions transférées, éventuellement ids/variantes/états). */
  setFrame(f: VehicleFrameExt): void {
    const t = this.now();
    if (this.curTime > 0) {
      const dt = t - this.curTime;
      if (dt > 5 && dt < 1000) this.interval = this.interval * 0.8 + dt * 0.2;
    }
    // mémorise la position AFFICHÉE de chaque véhicule de la trame courante comme point de départ
    const alpha = this.alphaAt(t);
    this.frameSeq++;
    for (let i = 0; i < this.curCount; i++) {
      const id = this.curIds[i]!;
      this.ensureId(id);
      this.interpolate(i, alpha);
      this.prevX[id] = this.dispX[i]!; this.prevY[id] = this.dispY[i]!; this.prevZ[id] = this.dispZ[i]!; this.prevH[id] = this.dispH[i]!;
      this.prevSeen[id] = this.frameSeq;
    }
    const n = f.count;
    if (this.curIds.length < n) {
      const cap = Math.max(64, 1 << Math.ceil(Math.log2(n)));
      this.curIds = new Uint32Array(cap); this.curVar = new Uint8Array(cap); this.curFlags = new Uint8Array(cap);
      this.dispX = new Float32Array(cap); this.dispY = new Float32Array(cap); this.dispZ = new Float32Array(cap); this.dispH = new Float32Array(cap);
    }
    this.curPos = f.positions;
    this.curAsset = f.assetIndices;
    for (let i = 0; i < n; i++) {
      const id = f.ids ? f.ids[i]! : i;
      this.curIds[i] = id;
      this.curVar[i] = f.variants ? f.variants[i]! : hash32(id + 17) & 0xff;
      this.curFlags[i] = f.flags ? f.flags[i]! : 0;
      this.ensureId(id);
      if (this.prevSeen[id] !== this.frameSeq) {
        // nouveau véhicule : pas d'interpolation
        const o = i * VEHICLE_STRIDE;
        this.prevX[id] = f.positions[o]!; this.prevY[id] = f.positions[o + 1]!; this.prevZ[id] = f.positions[o + 2]!; this.prevH[id] = f.positions[o + 3]!;
      }
    }
    this.curCount = n;
    this.count = n;
    this.curTime = t;
  }

  private ensureId(id: number): void {
    if (id < this.prevX.length) return;
    let cap = this.prevX.length;
    while (cap <= id) cap *= 2;
    const g = (a: Float32Array): Float32Array => { const b = new Float32Array(cap); b.set(a); return b; };
    this.prevX = g(this.prevX); this.prevY = g(this.prevY); this.prevZ = g(this.prevZ); this.prevH = g(this.prevH);
    const s = new Uint32Array(cap); s.set(this.prevSeen); this.prevSeen = s;
  }

  private alphaAt(t: number): number {
    return Math.max(0, Math.min(1, (t - this.curTime) / Math.max(16, this.interval)));
  }

  private interpolate(i: number, alpha: number): void {
    const id = this.curIds[i]!;
    const o = i * VEHICLE_STRIDE;
    const p = this.curPos;
    const x1 = p[o]!, y1 = p[o + 1]!, z1 = p[o + 2]!, h1 = p[o + 3]!;
    const x0 = this.prevX[id]!, y0 = this.prevY[id]!, z0 = this.prevZ[id]!, h0 = this.prevH[id]!;
    // saut (téléportation, réapparition) : pas d'interpolation
    if (Math.abs(x1 - x0) + Math.abs(z1 - z0) > 30) { this.dispX[i] = x1; this.dispY[i] = y1; this.dispZ[i] = z1; this.dispH[i] = h1; return; }
    let dh = h1 - h0;
    if (dh > Math.PI) dh -= Math.PI * 2; else if (dh < -Math.PI) dh += Math.PI * 2;
    this.dispX[i] = x0 + (x1 - x0) * alpha;
    this.dispY[i] = y0 + (y1 - y0) * alpha;
    this.dispZ[i] = z0 + (z1 - z0) * alpha;
    this.dispH[i] = h0 + dh * alpha;
  }

  /* ----------------------------- mise à jour ----------------------------- */

  update(_dt: number): void {
    const t = this.now();
    const alpha = this.alphaAt(t);
    const cam = this.camera;
    let cx = 0, cy = 1e6, cz = 0;
    if (cam) {
      cam.updateMatrixWorld();
      _pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      _frustum.setFromProjectionMatrix(_pv);
      const e = cam.matrixWorld.elements;
      cx = e[12]!; cy = e[13]!; cz = e[14]!;
    }
    for (const m of this.models) if (m) for (const lot of m.lods) lot.count = 0;
    this.drawn[0] = this.drawn[1] = this.drawn[2] = 0;
    let beams = 0;
    const night = this.night > 0.05;
    for (let i = 0; i < this.curCount; i++) {
      const model = this.models[this.curAsset[i]!];
      if (!model) continue;
      this.interpolate(i, alpha);
      const x = this.dispX[i]!, y = this.dispY[i]!, z = this.dispZ[i]!, h = this.dispH[i]!;
      if (cam) {
        _sphere.center.set(x, y + 1, z);
        _sphere.radius = model.radius;
        if (!_frustum.intersectsSphere(_sphere)) continue;
      }
      const d = Math.hypot(x - cx, y - cy, z - cz);
      let lod = 0;
      if (this.forceLod !== null) lod = Math.min(this.forceLod, model.lods.length - 1);
      else while (lod < model.maxDist.length - 1 && d > model.maxDist[lod]!) lod++;
      // LOD prêt le plus proche (chargement progressif)
      if (model.lods[lod]!.state === 0) this.requestLod(model, lod);
      let use = -1;
      for (let k = 0; k < model.lods.length && use < 0; k++) {
        const a = lod + k, b = lod - k;
        if (a < model.lods.length && model.lods[a]!.state === 2) use = a;
        else if (b >= 0 && model.lods[b]!.state === 2) use = b;
      }
      if (use < 0) continue;
      const lot = model.lods[use]!;
      if (lot.count >= lot.capacity) this.growLot(lot, lot.count + 1);
      const s = Math.sin(h), c = Math.cos(h);
      const mo = lot.count * 16;
      const M = lot.matrices;
      // rotation autour de Y (cap h : l'avant +Z du modèle pointe vers (sin h, 0, cos h))
      M[mo] = c; M[mo + 1] = 0; M[mo + 2] = -s; M[mo + 3] = 0;
      M[mo + 4] = 0; M[mo + 5] = 1; M[mo + 6] = 0; M[mo + 7] = 0;
      M[mo + 8] = s; M[mo + 9] = 0; M[mo + 10] = c; M[mo + 11] = 0;
      M[mo + 12] = x; M[mo + 13] = y; M[mo + 14] = z; M[mo + 15] = 1;
      const pal = model.palette;
      const nv = pal.length / 3;
      const v = (this.curVar[i]! % nv) * 3;
      const co = lot.count * 3;
      const bright = 0.92 + (hash32(this.curIds[i]! * 7 + 3) & 255) / 255 * 0.14;
      lot.colors[co] = pal[v]! * bright; lot.colors[co + 1] = pal[v + 1]! * bright; lot.colors[co + 2] = pal[v + 2]! * bright;
      lot.count++;
      this.drawn[use]!++;
      if (night && d < 260) {
        if (beams >= this.beamCap) this.growBeams(beams + 1);
        _m.set(c, 0, s, x, 0, 1, 0, y, -s, 0, c, z, 0, 0, 0, 1);
        // décale le halo à l'avant du véhicule
        _m.elements[12] = x + s * (model.asset.dimensions.depth / 2 - 0.3);
        _m.elements[14] = z + c * (model.asset.dimensions.depth / 2 - 0.3);
        this.beams.setMatrixAt(beams, _m);
        beams++;
      }
    }
    for (const m of this.models) if (m) for (const lot of m.lods) {
      if (lot.state !== 2) continue;
      for (const im of lot.meshes) im.count = lot.count;
      if (lot.count > 0) {
        lot.matAttr!.clearUpdateRanges();
        lot.matAttr!.addUpdateRange(0, lot.count * 16);
        lot.matAttr!.needsUpdate = true;
        lot.colAttr!.clearUpdateRanges();
        lot.colAttr!.addUpdateRange(0, lot.count * 3);
        lot.colAttr!.needsUpdate = true;
      }
    }
    this.beams.count = beams;
    if (beams) this.beams.instanceMatrix.needsUpdate = true;
  }

  private growBeams(need: number): void {
    let cap = this.beamCap;
    while (cap < need) cap *= 2;
    const old = this.beams;
    const nb = new THREE.InstancedMesh(old.geometry, old.material, cap);
    nb.frustumCulled = false; nb.name = old.name; nb.renderOrder = old.renderOrder; nb.visible = old.visible;
    nb.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.remove(old);
    old.dispose();
    this.group.add(nb);
    this.beams = nb;
    this.beamCap = cap;
  }

  /** Statistiques (diagnostic, démo). */
  stats(): { vehicles: number; drawn: number[]; lotsReady: number; drawCalls: number; errors: number } {
    let ready = 0, calls = 0;
    for (const m of this.models) if (m) for (const lot of m.lods) if (lot.state === 2) { ready++; if (lot.count) calls += lot.meshes.length; }
    return { vehicles: this.curCount, drawn: [...this.drawn], lotsReady: ready, drawCalls: calls, errors: this.loadErrors.length };
  }

  /** Index catalogue des assets véhicules (utile pour la simulation et la démo). */
  vehicleAssetIndices(): readonly number[] { return this.vehicleAssets; }

  dispose(): void {
    for (const m of this.models) if (m) for (const lot of m.lods) for (const im of lot.meshes) { im.geometry.dispose(); im.dispose(); }
    for (const mat of [this.paintMat, this.detailMat, this.glassMat]) {
      if (!mat) continue;
      for (const v of Object.values(mat)) if (v instanceof THREE.Texture) v.dispose();
      mat.dispose();
    }
    this.beams.geometry.dispose();
    (this.beams.material as THREE.Material).dispose();
    this.beams.dispose();
    this.scene.remove(this.group);
    this.count = 0;
    this.curCount = 0;
  }
}

/**
 * Géométrie flottante prête à instancier : positions/normales quantifiées (KHR_mesh_quantization)
 * converties en float32, transformation du nœud appliquée. Exécuté une fois par chargement de LOD.
 */
export function bakeGeometry(src: THREE.BufferGeometry, matrix: THREE.Matrix4): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const pos = src.getAttribute('position') as THREE.BufferAttribute;
  const nrm = src.getAttribute('normal') as THREE.BufferAttribute | undefined;
  const uv = src.getAttribute('uv') as THREE.BufferAttribute | undefined;
  const n = pos.count;
  const P = new Float32Array(n * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(matrix); P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z; }
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  if (nrm) {
    const N = new Float32Array(n * 3);
    const nm = new THREE.Matrix3().getNormalMatrix(matrix);
    for (let i = 0; i < n; i++) { v.fromBufferAttribute(nrm, i).applyMatrix3(nm).normalize(); N[i * 3] = v.x; N[i * 3 + 1] = v.y; N[i * 3 + 2] = v.z; }
    g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  }
  if (uv) {
    const U = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { U[i * 2] = uv.getX(i); U[i * 2 + 1] = uv.getY(i); }
    g.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  }
  if (src.index) g.setIndex(new THREE.BufferAttribute(src.index.array.slice() as Uint16Array | Uint32Array, 1));
  g.computeBoundingSphere();
  return g;
}
