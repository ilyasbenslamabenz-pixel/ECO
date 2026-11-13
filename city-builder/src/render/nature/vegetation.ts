/**
 * Végétation et décors naturels instanciés : forêts semées selon la carte de densité forestière de la
 * simulation, arbustes en lisière, rochers sur les pentes, arbres plantés (alignements de rue, parcs).
 *
 * - Essences : modèles GLB du catalogue (Poly Haven CC0 + générateurs maison), choisies selon l'altitude,
 *   l'humidité et le rôle (tags du catalogue).
 * - Rendu : InstancedMesh par (essence, LOD, sous-maillage) ; LOD0/1/2 = modèles GLB du catalogue,
 *   au-delà = imposteurs (vues précalculées du modèle). LOD choisi par cellule de 128 m, cellules hors
 *   champ ignorées (culling), copie de matrices précalculées : `update()` n'alloue rien.
 * - Données SoA (typed arrays) ; suppression quand on construit (removeInRect / removeAlongSegment /
 *   removeInFootprint) ; ajout d'arbres plantés (plant).
 */
import * as THREE from 'three';
import type { CatalogAsset } from '../../shared/catalog';
import type { AssetLibrary } from '../assets';
import { NO_WATER, type WorldTerrain } from '../../sim/terrain/types';
import { mulberry32 } from '../../shared/math';
import { bakeImpostor, makeImpostorMaterial, type ImpostorAtlas, type ImpostorMaterialUniforms } from './impostor';

export type VegRole = 'feuillu' | 'conifere' | 'ornement' | 'arbuste' | 'rocher' | 'fleur';

export interface VegSpecies {
  asset: CatalogAsset;
  role: VegRole;
  /** Hauteur visée (m) min/max : l'échelle d'instance en découle. */
  minH: number;
  maxH: number;
  /** Poids de tirage en forêt / en lisière. */
  weight: number;
  /** Imposteur au-delà du dernier LOD (arbres). */
  impostor: boolean;
}

export interface VegetationOptions {
  heightAt: (x: number, z: number) => number;
  renderer?: THREE.WebGLRenderer;
  /** Distances de bascule (m) LOD0 -> LOD1 -> LOD2 -> imposteur -> rien. */
  distances?: [number, number, number, number];
  /** Taille des cellules de culling/LOD (m). */
  cellSize?: number;
  /** Arbres par m² en forêt dense. */
  forestDensity?: number;
  /** Capacité max d'instances par (essence, LOD détaillé). */
  detailedCapacity?: number;
}

interface PartMesh {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

interface SpeciesRender {
  sp: VegSpecies;
  /** Par LOD : maillages instanciés partageant le même tampon de matrices. */
  lods: { meshes: THREE.InstancedMesh[]; matrices: THREE.InstancedBufferAttribute; colors: THREE.InstancedBufferAttribute; cap: number; count: number }[];
  imp: { mesh: THREE.InstancedMesh; atlas: ImpostorAtlas; cap: number; count: number } | null;
  baseHeight: number;
}

/** Choisit le rôle d'un asset de végétation d'après sa catégorie et ses tags. */
export function roleOf(a: CatalogAsset): VegRole | null {
  const tags = a.tags.map((t) => t.toLowerCase());
  if (a.category === 'tree') {
    if (tags.some((t) => t.includes('conif') || t.includes('sapin') || t.includes('pin') || t.includes('épicéa'))) return 'conifere';
    if (tags.includes('ornement') || tags.includes('jardin') && !tags.includes('rue')) return 'ornement';
    return 'feuillu';
  }
  if (a.category === 'vegetation') {
    if (tags.some((t) => t.includes('fleur'))) return 'fleur';
    if (tags.includes('pot')) return null; // plantes en pot : mobilier, pas de semis naturel
    return 'arbuste';
  }
  if (tags.some((t) => t.includes('rocher') || t.includes('roche'))) return 'rocher';
  return null;
}

/** Essences par défaut depuis le catalogue (hauteurs visées réalistes pour des arbres adultes). */
export function speciesFromCatalog(assets: readonly CatalogAsset[]): VegSpecies[] {
  const out: VegSpecies[] = [];
  for (const a of assets) {
    const role = roleOf(a);
    if (!role) continue;
    const h = a.dimensions.height;
    let minH = h;
    let maxH = h;
    let weight = 1;
    switch (role) {
      case 'feuillu':
        // Un jeune arbre garde sa taille réelle (sinon il serait agrandi à 8-15 m et paraîtrait clairsemé).
        if (a.id.includes('jeune')) { minH = h * 0.85; maxH = h * 1.2; weight = 0.6; break; }
        minH = Math.max(h * 0.9, 8); maxH = Math.max(h * 1.1, 15); weight = a.id.includes('jacaranda') ? 0.25 : 1; break;
      case 'conifere': minH = Math.max(h * 0.85, 10); maxH = Math.max(h * 1.15, 20); weight = 1; break;
      case 'ornement': minH = Math.max(h, 5); maxH = Math.max(h * 1.3, 8); weight = 0.3; break;
      case 'arbuste': minH = h * 0.8; maxH = h * 1.3; weight = 1; break;
      case 'rocher': minH = h * 0.6; maxH = h * 1.6; weight = 1; break;
      case 'fleur': minH = h * 0.8; maxH = h * 1.2; weight = 1; break;
    }
    out.push({ asset: a, role, minH, maxH, weight, impostor: role === 'feuillu' || role === 'conifere' || role === 'ornement' });
  }
  return out;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

export interface VegetationStats {
  species: number;
  instances: number;
  planted: number;
  visible: number[];
  impostors: number;
  impostorChecks: { id: string; meanRgb: [number, number, number]; coverage: number }[];
  drawn: { lod0: number; lod1: number; lod2: number; impostor: number };
}

export class VegetationSystem {
  readonly group = new THREE.Group();
  private species: VegSpecies[] = [];
  private renders: SpeciesRender[] = [];
  private readonly o: Required<Omit<VegetationOptions, 'renderer'>> & { renderer: THREE.WebGLRenderer | null };
  // SoA brut (non trié).
  private n = 0;
  private cap = 0;
  private px = new Float32Array(0);
  private py = new Float32Array(0);
  private pz = new Float32Array(0);
  private rot = new Float32Array(0);
  private scl = new Float32Array(0);
  private spc = new Uint8Array(0);
  private alive = new Uint8Array(0);
  private planted = new Uint8Array(0);
  private tint = new Float32Array(0);
  // Structure triée par (cellule, essence) : reconstruite quand `dirty`.
  private dirty = true;
  private sortedMat = new Float32Array(0);
  private sortedTint = new Float32Array(0);
  private cellStart = new Int32Array(0);
  private cellCount = new Int32Array(0);
  private cellsX = 0;
  private cellsZ = 0;
  private originX = 0;
  private originZ = 0;
  private cellCY = new Float32Array(0);
  private cellKeys = new Float64Array(0);
  private readonly frustum = new THREE.Frustum();
  private readonly pv = new THREE.Matrix4();
  private readonly sphere = new THREE.Sphere();
  private readonly lastCam = new THREE.Vector3(1e9, 0, 0);
  private readonly lastDir = new THREE.Vector3();
  private readonly camDir = new THREE.Vector3();
  private frameCounter = 0;
  private loaded = false;
  readonly lights: ImpostorMaterialUniforms = {
    uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
    uSunColor: { value: new THREE.Color(1, 0.96, 0.9).multiplyScalar(2.6) },
    uSky: { value: new THREE.Color(0.55, 0.65, 0.85) },
    uGround: { value: new THREE.Color(0.25, 0.22, 0.18) },
    uEnv: { value: 0.55 },
  };
  private readonly drawn = { lod0: 0, lod1: 0, lod2: 0, impostor: 0 };

  constructor(private readonly scene: THREE.Scene, private readonly lib: AssetLibrary, opts: VegetationOptions) {
    this.o = {
      heightAt: opts.heightAt,
      renderer: opts.renderer ?? null,
      distances: opts.distances ?? [50, 120, 240, 3800],
      cellSize: opts.cellSize ?? 128,
      forestDensity: opts.forestDensity ?? 1 / 85,
      detailedCapacity: opts.detailedCapacity ?? 6000,
    };
    this.group.name = 'vegetation';
    scene.add(this.group);
  }

  /** Charge les modèles (3 LOD) de chaque essence et fabrique les imposteurs. */
  async load(species?: VegSpecies[], renderer?: THREE.WebGLRenderer): Promise<void> {
    const r = renderer ?? this.o.renderer;
    this.species = species ?? speciesFromCatalog(this.lib.catalog.assets);
    if (this.species.length > 255) this.species.length = 255;
    this.renders = [];
    for (const sp of this.species) {
      const lodCount = Math.min(3, sp.asset.lods.length);
      const roots = await Promise.all(Array.from({ length: lodCount }, (_, l) => this.lib.load(sp.asset.id, l)));
      const rec: SpeciesRender = { sp, lods: [], imp: null, baseHeight: sp.asset.dimensions.height };
      roots.forEach((root, l) => {
        const parts = extractParts(root);
        const cap = l === lodCount - 1 && !sp.impostor ? this.o.detailedCapacity * 2 : this.o.detailedCapacity;
        const matrices = new THREE.InstancedBufferAttribute(new Float32Array(cap * 16), 16);
        matrices.setUsage(THREE.DynamicDrawUsage);
        const colors = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
        colors.setUsage(THREE.DynamicDrawUsage);
        const meshes = parts.map((p) => {
          const im = new THREE.InstancedMesh(p.geometry, p.material, cap);
          im.instanceMatrix = matrices;
          im.instanceColor = colors;
          im.count = 0;
          im.frustumCulled = false; // culling fait par cellule
          im.castShadow = true;
          im.receiveShadow = true;
          im.name = `veg_${sp.asset.id}_lod${l}`;
          this.group.add(im);
          return im;
        });
        rec.lods.push({ meshes, matrices, colors, cap, count: 0 });
      });
      if (sp.impostor && r) {
        const atlas = bakeImpostor(r, roots[Math.min(1, roots.length - 1)]!);
        const geo = new THREE.PlaneGeometry(2, 2);
        const tintAttr = new THREE.InstancedBufferAttribute(new Float32Array(3 * 20000), 3);
        tintAttr.setUsage(THREE.DynamicDrawUsage);
        geo.setAttribute('instanceTint', tintAttr);
        const im = new THREE.InstancedMesh(geo, makeImpostorMaterial(atlas, this.lights), 20000);
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        im.count = 0;
        im.frustumCulled = false;
        im.name = `veg_${sp.asset.id}_imposteur`;
        this.group.add(im);
        rec.imp = { mesh: im, atlas, cap: 20000, count: 0 };
      }
      this.renders.push(rec);
    }
    this.loaded = true;
  }

  get speciesList(): readonly VegSpecies[] { return this.species; }

  /** Définit les essences sans charger de modèle (semis et suppressions seuls : outils, tests). */
  setSpecies(species: VegSpecies[]): void {
    this.species = species.slice(0, 255);
  }

  /** Position de l'élément vivant d'indice i (diagnostic / tests). */
  positionsOf(role?: VegRole): { x: number; z: number; assetId: string }[] {
    const out: { x: number; z: number; assetId: string }[] = [];
    for (let i = 0; i < this.n; i++) {
      if (!this.alive[i]) continue;
      const sp = this.species[this.spc[i]!]!;
      if (role && sp.role !== role) continue;
      out.push({ x: this.px[i]!, z: this.pz[i]!, assetId: sp.asset.id });
    }
    return out;
  }

  private ensureCap(extra: number): void {
    if (this.n + extra <= this.cap) return;
    const nc = Math.max(1024, (this.n + extra) * 2);
    const grow = <T extends Float32Array | Uint8Array>(a: T, k = 1): T => {
      const b = new (a.constructor as new (n: number) => T)(nc * k);
      b.set(a.subarray(0, this.n * k));
      return b;
    };
    this.px = grow(this.px); this.py = grow(this.py); this.pz = grow(this.pz);
    this.rot = grow(this.rot); this.scl = grow(this.scl); this.spc = grow(this.spc);
    this.alive = grow(this.alive); this.planted = grow(this.planted); this.tint = grow(this.tint, 3);
    this.cap = nc;
  }

  private push(x: number, y: number, z: number, r: number, s: number, sp: number, planted: boolean, rnd: () => number): void {
    this.ensureCap(1);
    const i = this.n++;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z; this.rot[i] = r; this.scl[i] = s; this.spc[i] = sp;
    this.alive[i] = 1; this.planted[i] = planted ? 1 : 0;
    // Variation de teinte (saison, vigueur) : légère, plus marquée sur les feuillus.
    const role = this.species[sp]!.role;
    const v = role === 'rocher' ? 0.12 : 0.22;
    const b = 1 - v / 2 + rnd() * v;
    const warm = role === 'feuillu' || role === 'ornement' ? (rnd() - 0.4) * 0.12 : 0;
    this.tint[i * 3] = b * (1 + warm);
    this.tint[i * 3 + 1] = b;
    this.tint[i * 3 + 2] = b * (1 - warm * 0.8);
  }

  private pick(cands: number[], rnd: () => number): number {
    let tot = 0;
    for (const c of cands) tot += this.species[c]!.weight;
    let r = rnd() * tot;
    for (const c of cands) { r -= this.species[c]!.weight; if (r <= 0) return c; }
    return cands[cands.length - 1]!;
  }

  private scaleFor(sp: number, rnd: () => number): number {
    const s = this.species[sp]!;
    const h = s.minH + (s.maxH - s.minH) * rnd();
    return h / Math.max(0.05, s.asset.dimensions.height);
  }

  /** Sème la végétation naturelle d'après les couches du monde (déterministe pour une graine). */
  scatter(world: WorldTerrain): number {
    this.n = 0;
    this.cellsX = Math.ceil(((world.samplesX - 1) * world.spacing) / this.o.cellSize);
    this.cellsZ = Math.ceil(((world.samplesZ - 1) * world.spacing) / this.o.cellSize);
    this.originX = world.originX;
    this.originZ = world.originZ;
    const rnd = mulberry32(world.params.seed ^ 0x7ee5);
    const byRole = (r: VegRole): number[] => this.species.map((s, i) => (s.role === r ? i : -1)).filter((i) => i >= 0);
    const broad = [...byRole('feuillu'), ...byRole('ornement')];
    const conif = byRole('conifere');
    const shrubs = byRole('arbuste');
    const rocks = byRole('rocher');
    const flowers = byRole('fleur');
    const W = world.samplesX;
    const sp = world.spacing;
    const cellArea = sp * sp;
    const H = this.o.heightAt;
    const nrm = new THREE.Vector3();
    for (let j = 0; j < world.samplesZ - 1; j++) {
      for (let i = 0; i < W - 1; i++) {
        const k = j * W + i;
        const f = world.forest[k]! / 255;
        const x0 = world.originX + i * sp;
        const z0 = world.originZ + j * sp;
        const h = world.heights[k]!;
        // Cellule écartée si l'un de ses coins est en eau (rive comprise).
        const ws = world.waterSurface;
        const hs = world.heights;
        if ((ws[k]! !== NO_WATER && ws[k]! > hs[k]! - 0.3) || (ws[k + 1]! !== NO_WATER && ws[k + 1]! > hs[k + 1]! - 0.3)
          || (ws[k + W]! !== NO_WATER && ws[k + W]! > hs[k + W]! - 0.3) || (ws[k + W + 1]! !== NO_WATER && ws[k + W + 1]! > hs[k + W + 1]! - 0.3)) continue;
        const alt = (h - world.waterLevel) / Math.max(10, world.params.maxAltitude);
        const moist = world.moisture[k]! / 255;
        // Arbres.
        const expected = f * f * this.o.forestDensity * cellArea * 1.6;
        let nTrees = Math.floor(expected + rnd());
        for (; nTrees > 0; nTrees--) {
          const x = x0 + rnd() * sp;
          const z = z0 + rnd() * sp;
          slopeNormal(H, x, z, nrm);
          if (nrm.y < 0.72) continue;
          const conifP = conif.length ? THREE.MathUtils.smoothstep(alt, 0.18, 0.5) * 0.85 + (1 - moist) * 0.1 : 0;
          const pool = conif.length && rnd() < conifP ? conif : broad.length ? broad : conif;
          if (!pool.length) break;
          const s = this.pick(pool, rnd);
          this.push(x, H(x, z) - 0.15, z, rnd() * Math.PI * 2, this.scaleFor(s, rnd), s, false, rnd);
        }
        // Arbustes : lisières et prairies humides.
        if (shrubs.length) {
          const edge = f > 0.05 && f < 0.55 ? 0.5 : f >= 0.55 ? 0.15 : moist > 0.6 ? 0.03 : 0.006;
          if (rnd() < edge * cellArea / 64) {
            const x = x0 + rnd() * sp;
            const z = z0 + rnd() * sp;
            slopeNormal(H, x, z, nrm);
            if (nrm.y > 0.75) {
              const s = this.pick(shrubs, rnd);
              this.push(x, H(x, z) - 0.05, z, rnd() * Math.PI * 2, this.scaleFor(s, rnd), s, false, rnd);
            }
          }
        }
        // Rochers : pentes et montagnes.
        if (rocks.length) {
          slopeNormal(H, x0 + sp / 2, z0 + sp / 2, nrm);
          const steep = 1 - nrm.y;
          const pr = THREE.MathUtils.smoothstep(steep, 0.08, 0.3) * 0.25 + THREE.MathUtils.smoothstep(alt, 0.3, 0.7) * 0.1;
          if (rnd() < pr) {
            const x = x0 + rnd() * sp;
            const z = z0 + rnd() * sp;
            const s = this.pick(rocks, rnd);
            this.push(x, H(x, z) - 0.25 * this.species[s]!.asset.dimensions.height, z, rnd() * Math.PI * 2, this.scaleFor(s, rnd), s, false, rnd);
          }
        }
        // Fleurs : prairies humides près de l'eau.
        if (flowers.length && f < 0.2 && moist > 0.55 && alt < 0.25 && rnd() < 0.05) {
          const x = x0 + rnd() * sp;
          const z = z0 + rnd() * sp;
          const s = this.pick(flowers, rnd);
          this.push(x, H(x, z), z, rnd() * Math.PI * 2, this.scaleFor(s, rnd), s, false, rnd);
        }
      }
    }
    this.dirty = true;
    return this.n;
  }

  /**
   * Plante des arbres/arbustes (alignements de rue, parcs). `assetId` doit être une essence chargée.
   * Renvoie le nombre d'éléments ajoutés.
   */
  plant(items: readonly { x: number; z: number; assetId: string; rot?: number; scale?: number }[], seed = 1): number {
    const rnd = mulberry32(seed);
    let added = 0;
    for (const it of items) {
      const s = this.species.findIndex((x) => x.asset.id === it.assetId);
      if (s < 0) continue;
      this.push(it.x, this.o.heightAt(it.x, it.z) - 0.1, it.z, it.rot ?? rnd() * Math.PI * 2, it.scale ?? this.scaleFor(s, rnd), s, true, rnd);
      added++;
    }
    if (added) this.dirty = true;
    return added;
  }

  /** Retire la végétation dans un rectangle aligné (construction). Renvoie le nombre retiré. */
  removeInRect(minX: number, minZ: number, maxX: number, maxZ: number, includePlanted = false): number {
    let r = 0;
    for (let i = 0; i < this.n; i++) {
      if (!this.alive[i] || (this.planted[i] && !includePlanted)) continue;
      const x = this.px[i]!;
      const z = this.pz[i]!;
      if (x >= minX && x <= maxX && z >= minZ && z <= maxZ) { this.alive[i] = 0; r++; }
    }
    if (r) this.dirty = true;
    return r;
  }

  /** Retire la végétation d'une empreinte orientée (centre, demi-tailles, angle en rad). */
  removeInFootprint(cx: number, cz: number, halfW: number, halfD: number, angle: number, margin = 1.5): number {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    let r = 0;
    for (let i = 0; i < this.n; i++) {
      if (!this.alive[i]) continue;
      const dx = this.px[i]! - cx;
      const dz = this.pz[i]! - cz;
      const lx = dx * c + dz * s;
      const lz = -dx * s + dz * c;
      if (Math.abs(lx) <= halfW + margin && Math.abs(lz) <= halfD + margin) { this.alive[i] = 0; r++; }
    }
    if (r) this.dirty = true;
    return r;
  }

  /** Retire la végétation le long d'un segment (route), à moins de `halfWidth` m de l'axe. */
  removeAlongSegment(ax: number, az: number, bx: number, bz: number, halfWidth: number, includePlanted = false): number {
    const dx = bx - ax;
    const dz = bz - az;
    const l2 = dx * dx + dz * dz || 1e-9;
    let r = 0;
    for (let i = 0; i < this.n; i++) {
      if (!this.alive[i] || (this.planted[i] && !includePlanted)) continue;
      const px = this.px[i]! - ax;
      const pz = this.pz[i]! - az;
      const t = Math.max(0, Math.min(1, (px * dx + pz * dz) / l2));
      const ex = px - dx * t;
      const ez = pz - dz * t;
      if (ex * ex + ez * ez <= halfWidth * halfWidth) { this.alive[i] = 0; r++; }
    }
    if (r) this.dirty = true;
    return r;
  }

  /** Nombre d'éléments vivants. */
  get count(): number {
    let c = 0;
    for (let i = 0; i < this.n; i++) c += this.alive[i]!;
    return c;
  }

  /** Reconstruit la structure triée (tri par comptage, O(n)) et les matrices. */
  private rebuild(): void {
    const S = Math.max(1, this.species.length);
    const C = this.cellsX * this.cellsZ;
    if (C === 0) { this.dirty = false; return; }
    const keys = C * S;
    const count = new Int32Array(keys);
    const key = new Int32Array(this.n);
    for (let i = 0; i < this.n; i++) {
      if (!this.alive[i]) { key[i] = -1; continue; }
      const cx = Math.min(this.cellsX - 1, Math.max(0, Math.floor((this.px[i]! - this.originX) / this.o.cellSize)));
      const cz = Math.min(this.cellsZ - 1, Math.max(0, Math.floor((this.pz[i]! - this.originZ) / this.o.cellSize)));
      const k = (cz * this.cellsX + cx) * S + this.spc[i]!;
      key[i] = k;
      count[k]!++;
    }
    const start = new Int32Array(keys);
    let acc = 0;
    for (let k = 0; k < keys; k++) { start[k] = acc; acc += count[k]!; }
    const fill = new Int32Array(keys);
    const mats = new Float32Array(acc * 16);
    const tints = new Float32Array(acc * 3);
    const cellY = new Float32Array(C);
    const cellN = new Int32Array(C);
    for (let i = 0; i < this.n; i++) {
      const k = key[i]!;
      if (k < 0) continue;
      const dst = start[k]! + fill[k]!++;
      _p.set(this.px[i]!, this.py[i]!, this.pz[i]!);
      _q.setFromAxisAngle(UP, this.rot[i]!);
      _s.setScalar(this.scl[i]!);
      _m.compose(_p, _q, _s);
      _m.toArray(mats, dst * 16);
      tints[dst * 3] = this.tint[i * 3]!;
      tints[dst * 3 + 1] = this.tint[i * 3 + 1]!;
      tints[dst * 3 + 2] = this.tint[i * 3 + 2]!;
      const c = Math.floor(k / S);
      cellY[c] = cellY[c]! + this.py[i]!;
      cellN[c]!++;
    }
    for (let c = 0; c < C; c++) cellY[c] = cellN[c]! ? cellY[c]! / cellN[c]! : this.o.heightAt(this.originX + ((c % this.cellsX) + 0.5) * this.o.cellSize, this.originZ + (Math.floor(c / this.cellsX) + 0.5) * this.o.cellSize);
    this.sortedMat = mats;
    this.sortedTint = tints;
    this.cellStart = start;
    this.cellCount = count;
    this.cellCY = cellY;
    if (this.cellKeys.length !== C) this.cellKeys = new Float64Array(C);
    this.dirty = false;
    this.lastCam.set(1e9, 0, 0); // force la mise à jour des instances
  }

  /** Mise à jour LOD / culling (sans allocation hors reconstruction). */
  update(camera: THREE.Camera): void {
    if (!this.loaded) return;
    if (this.dirty) this.rebuild();
    camera.getWorldDirection(this.camDir);
    this.frameCounter++;
    const moved = camera.position.distanceToSquared(this.lastCam) > 4 || this.camDir.dot(this.lastDir) < 0.9995;
    if (!moved) return;
    this.lastCam.copy(camera.position);
    this.lastDir.copy(this.camDir);
    this.pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.pv);
    const S = Math.max(1, this.species.length);
    const C = this.cellsX * this.cellsZ;
    const cs = this.o.cellSize;
    const [d0, d1, d2, d3] = this.o.distances;
    for (const r of this.renders) {
      for (const l of r.lods) l.count = 0;
      if (r.imp) r.imp.count = 0;
    }
    // Tri des cellules visibles par distance (les plus proches remplissent d'abord les LOD détaillés).
    let nv = 0;
    const cam = camera.position;
    for (let c = 0; c < C; c++) {
      const cx = this.originX + ((c % this.cellsX) + 0.5) * cs;
      const cz = this.originZ + (Math.floor(c / this.cellsX) + 0.5) * cs;
      const cy = this.cellCY[c]!;
      this.sphere.center.set(cx, cy + 8, cz);
      this.sphere.radius = cs * 0.72 + 14;
      const dx = Math.max(0, Math.abs(cam.x - cx) - cs / 2);
      const dz = Math.max(0, Math.abs(cam.z - cz) - cs / 2);
      const dy = cam.y - cy - 6;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > d3 || !this.frustum.intersectsSphere(this.sphere)) continue;
      this.cellKeys[nv++] = Math.floor(d) * 65536 + c;
    }
    const keys = this.cellKeys.subarray(0, nv);
    keys.sort();
    this.drawn.lod0 = this.drawn.lod1 = this.drawn.lod2 = this.drawn.impostor = 0;
    for (let q = 0; q < nv; q++) {
      const key = keys[q]!;
      const c = key % 65536;
      const d = (key - c) / 65536;
      for (let s = 0; s < S; s++) {
        const k = c * S + s;
        const cnt = this.cellCount[k]!;
        if (!cnt) continue;
        const r = this.renders[s]!;
        const nl = r.lods.length;
        let lod = d < d0 ? 0 : d < d1 ? 1 : d < d2 ? 2 : 3;
        if (!r.sp.impostor) {
          // Arbustes / rochers : pas d'imposteur, dernier LOD jusqu'à une distance réduite.
          if (d > d2 * (r.sp.role === 'rocher' ? 3 : 1.6)) continue;
          lod = Math.min(lod, nl - 1);
        } else if (lod >= nl) lod = 3;
        const st = this.cellStart[k]!;
        if (lod === 3 && r.imp) {
          const im = r.imp;
          const n = Math.min(cnt, im.cap - im.count);
          if (n <= 0) continue;
          (im.mesh.instanceMatrix.array as Float32Array).set(this.sortedMat.subarray(st * 16, (st + n) * 16), im.count * 16);
          ((im.mesh.geometry.getAttribute('instanceTint') as THREE.InstancedBufferAttribute).array as Float32Array).set(this.sortedTint.subarray(st * 3, (st + n) * 3), im.count * 3);
          im.count += n;
          this.drawn.impostor += n;
        } else {
          const L = r.lods[Math.min(lod, nl - 1)]!;
          const n = Math.min(cnt, L.cap - L.count);
          if (n <= 0) continue;
          (L.matrices.array as Float32Array).set(this.sortedMat.subarray(st * 16, (st + n) * 16), L.count * 16);
          (L.colors.array as Float32Array).set(this.sortedTint.subarray(st * 3, (st + n) * 3), L.count * 3);
          L.count += n;
          if (lod === 0) this.drawn.lod0 += n; else if (lod === 1) this.drawn.lod1 += n; else this.drawn.lod2 += n;
        }
      }
    }
    for (const r of this.renders) {
      for (let li = 0; li < r.lods.length; li++) {
        const l = r.lods[li]!;
        for (let mi = 0; mi < l.meshes.length; mi++) { const m = l.meshes[mi]!; m.count = l.count; m.castShadow = li <= 1 || r.sp.role !== 'arbuste'; }
        l.matrices.needsUpdate = true;
        l.colors.needsUpdate = true;
        l.matrices.clearUpdateRanges();
        l.matrices.addUpdateRange(0, l.count * 16);
        l.colors.clearUpdateRanges();
        l.colors.addUpdateRange(0, l.count * 3);
      }
      if (r.imp) {
        r.imp.mesh.count = r.imp.count;
        const ia = r.imp.mesh.instanceMatrix;
        ia.clearUpdateRanges();
        ia.addUpdateRange(0, r.imp.count * 16);
        ia.needsUpdate = true;
        const ta = r.imp.mesh.geometry.getAttribute('instanceTint') as THREE.InstancedBufferAttribute;
        ta.clearUpdateRanges();
        ta.addUpdateRange(0, r.imp.count * 3);
        ta.needsUpdate = true;
      }
    }
  }

  /** Recopie l'éclairage de la scène (soleil/lune, hémisphère) pour les imposteurs. */
  syncLights(sun: THREE.DirectionalLight, hemi: THREE.HemisphereLight, ambientSky?: THREE.Color, ambientGround?: THREE.Color): void {
    this.lights.uSunDir.value.copy(sun.position).sub(sun.target.position).normalize();
    // Même convention que three (BRDF de Lambert : albedo / π x éclairement).
    this.lights.uSunColor.value.copy(sun.color).multiplyScalar(sun.intensity / Math.PI);
    // Ambiance : éclairement de la carte d'environnement (fourni par SkySystem) + lumière hémisphérique.
    this.lights.uSky.value.copy(hemi.color).multiplyScalar(hemi.intensity / Math.PI);
    this.lights.uGround.value.copy(hemi.groundColor).multiplyScalar(hemi.intensity / Math.PI);
    if (ambientSky) this.lights.uSky.value.add(ambientSky);
    if (ambientGround) this.lights.uGround.value.add(ambientGround);
    this.lights.uEnv.value = 1;
  }

  get settled(): boolean { return this.loaded && !this.dirty; }

  stats(): VegetationStats {
    const visible: number[] = [];
    let imps = 0;
    let planted = 0;
    for (let i = 0; i < this.n; i++) if (this.alive[i] && this.planted[i]) planted++;
    for (const r of this.renders) {
      visible.push(r.lods.reduce((a, l) => a + l.count, 0) + (r.imp?.count ?? 0));
      if (r.imp) imps++;
    }
    const impostorChecks = this.renders.filter((r) => r.imp).map((r) => ({ id: r.sp.asset.id, ...r.imp!.atlas.check }));
    return { species: this.species.length, instances: this.count, planted, visible, impostors: imps, impostorChecks, drawn: { ...this.drawn } };
  }

  dispose(): void {
    for (const r of this.renders) {
      for (const l of r.lods) for (const m of l.meshes) { m.geometry.dispose(); m.dispose(); }
      if (r.imp) { r.imp.atlas.dispose(); r.imp.mesh.geometry.dispose(); (r.imp.mesh.material as THREE.Material).dispose(); r.imp.mesh.dispose(); }
    }
    this.renders = [];
    this.group.removeFromParent();
  }
}

/** Normale du terrain en (x, z) via la fonction de hauteur. */
function slopeNormal(H: (x: number, z: number) => number, x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
  const e = 2;
  return out.set(H(x - e, z) - H(x + e, z), 2 * e, H(x, z - e) - H(x, z + e)).normalize();
}

/** Extrait les sous-maillages d'un modèle chargé (géométries clonées avec transformation cuite). */
export function extractParts(root: THREE.Object3D): PartMesh[] {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const parts: PartMesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry.clone();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    if (mats.length === 1) parts.push({ geometry: g, material: mats[0]! });
    else for (const grp of g.groups) {
      const sub = g.clone();
      sub.setDrawRange(grp.start, grp.count);
      parts.push({ geometry: sub, material: mats[grp.materialIndex ?? 0]! });
    }
  });
  void _c;
  return parts;
}
