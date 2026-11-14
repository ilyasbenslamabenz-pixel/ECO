/**
 * Devant des bâtiments, côté rue :
 *  - `frontShift` : recul de la façade réduit. Les modèles sont centrés dans leur parcelle (jardin réparti tout
 *    autour) ; on les avance vers la rue pour ne garder qu'un jardinet (pavillons) ou presque rien (maisons de
 *    ville, immeubles, commerces), le reste de la parcelle passe derrière.
 *  - `FrontYardLayer` : jardinet des maisons (haie basse avec passages, allée piétonne vers la porte, allée de
 *    garage) en deux maillages instanciés pour toute la ville (deux appels de dessin, aucune texture).
 */
import * as THREE from 'three';
import { TILE_SIZE } from '../../shared/constants';
import type { CatalogAsset } from '../../shared/catalog';
import { rotAngle } from '../../shared/footprint';

/** Jardinet visé devant la façade (m), par catégorie ; absent = modèle laissé centré (industrie, services…). */
const FRONT_YARD: Record<string, number> = {
  house: 1.8, townhouse: 0.4, apartment_low: 0.3, apartment_mid: 0.3, apartment_high: 0.3, skyscraper: 0.3, commercial: 0.3,
};

/** Axe local de la façade (premier point de connexion, ramené à l'axe dominant), comme l'outil de pose. */
export function facadeAxis(a: CatalogAsset): [number, number] {
  const f = a.frontage[0];
  if (!f) return [0, 1];
  return Math.abs(f.nz) >= Math.abs(f.nx) ? [0, Math.sign(f.nz) || 1] : [Math.sign(f.nx), 0];
}

/** Profondeur de parcelle et du modèle selon l'axe de façade. */
function depths(a: CatalogAsset): { lot: number; model: number; width: number } {
  const [lx] = facadeAxis(a);
  const alongX = lx !== 0;
  return {
    lot: (alongX ? a.footprint.tilesX : a.footprint.tilesZ) * TILE_SIZE,
    model: alongX ? a.dimensions.width : a.dimensions.depth,
    width: (alongX ? a.footprint.tilesZ : a.footprint.tilesX) * TILE_SIZE,
  };
}

/** Avancée (m) du modèle vers la rue, dans son repère local (le long de l'axe de façade). */
export function frontShift(a: CatalogAsset): number {
  const yard = FRONT_YARD[a.category];
  if (yard === undefined || a.footprint.tilesX <= 0) return 0;
  const d = depths(a);
  return Math.max(0, (d.lot - d.model) / 2 - yard);
}

/** Décalage monde (x, z) du modèle pour une rotation donnée. */
export function frontOffset(a: CatalogAsset, rot: number, out: THREE.Vector3): THREE.Vector3 {
  const s = frontShift(a);
  const [lx, lz] = facadeAxis(a);
  out.set(lx * s, 0, lz * s);
  if (s > 0) out.applyAxisAngle(_up, rotAngle(rot));
  return out;
}

const _up = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();

interface Piece { kind: 'hedge' | 'path'; m: Float32Array }

/** Haies et allées des jardinets de maisons (catégorie `house`). */
export class FrontYardLayer {
  readonly group = new THREE.Group();
  private readonly pieces = new Map<number, Piece[]>();
  private hedge: THREE.InstancedMesh | null = null;
  private path: THREE.InstancedMesh | null = null;
  private dirty = false;
  private readonly hedgeGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  private readonly pathGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  private readonly hedgeMat = new THREE.MeshStandardMaterial({ color: 0x3f6b35, roughness: 0.95 });
  private readonly pathMat = new THREE.MeshStandardMaterial({ color: 0xb9ad98, roughness: 0.9 });

  constructor(parent: THREE.Object3D) {
    this.group.name = 'jardinets';
    parent.add(this.group);
  }

  add(id: number, a: CatalogAsset, x: number, y: number, z: number, rot: number): void {
    this.pieces.delete(id);
    if (a.category !== 'house' || a.footprint.tilesX <= 0) return;
    const d = depths(a);
    const [lx, lz] = facadeAxis(a);
    // Repère local : « avant » = axe de façade, « côté » = perpendiculaire. Limite avant de la parcelle à lot/2.
    const front = d.lot / 2;
    const facade = d.model / 2 + frontShift(a); // position de la façade après l'avancée
    const half = d.width / 2 - 0.2;
    // Passages : porte (point piéton) et garage (point véhicule), le long du « côté ».
    const side = (fx: number, fz: number): number => (lx !== 0 ? fz * lx : -fx * lz); // coordonnée latérale
    const gaps: [number, number][] = [];
    const out: Piece[] = [];
    const ang = rotAngle(rot);
    const put = (kind: Piece['kind'], s: number, f: number, w: number, depth: number, h: number): void => {
      // (s, f) dans le repère côté / avant -> local (x, z) -> monde.
      const locX = lx !== 0 ? f * lx : -s * lz;
      const locZ = lx !== 0 ? s * lx : f * lz;
      _v.set(locX, 0, locZ).applyAxisAngle(_up, ang);
      _q.setFromAxisAngle(_up, ang + (lx !== 0 ? Math.PI / 2 : 0));
      _p.set(x + _v.x, y, z + _v.z);
      _s.set(w, h, depth);
      out.push({ kind, m: _m.compose(_p, _q, _s).toArray(new Float32Array(16)) as Float32Array });
    };
    for (const fp of a.frontage) {
      const s = side(fp.x, fp.z);
      const w = fp.kind === 'vehicle' ? 3 : 1.4;
      gaps.push([s - w / 2, s + w / 2]);
      // Allée du trottoir jusqu'à la façade.
      // Jusqu'au trottoir (l'outil de pose laisse 0,6 m entre le trottoir et la parcelle).
      if (front - facade > 0.2) put('path', s, (front + 0.6 + facade) / 2, w, front + 0.6 - facade, 0.04);
    }
    // Haie basse sur la limite avant, interrompue aux passages.
    gaps.sort((p, q) => p[0] - q[0]);
    let cur = -half;
    const segs: [number, number][] = [];
    for (const [g0, g1] of gaps) { if (g0 > cur + 0.3) segs.push([cur, Math.min(g0, half)]); cur = Math.max(cur, g1); }
    if (half > cur + 0.3) segs.push([cur, half]);
    for (const [s0, s1] of segs) put('hedge', (s0 + s1) / 2, front - 0.3, s1 - s0, 0.5, 0.75);
    this.pieces.set(id, out);
    this.dirty = true;
  }

  remove(id: number): void { if (this.pieces.delete(id)) this.dirty = true; }

  /** Reconstruit les maillages instanciés si nécessaire (appelé à chaque image, coût nul sans changement). */
  update(): void {
    if (!this.dirty) return;
    this.dirty = false;
    let nh = 0, np = 0;
    for (const ps of this.pieces.values()) for (const p of ps) { if (p.kind === 'hedge') nh++; else np++; }
    this.hedge = this.rebuild(this.hedge, this.hedgeGeo, this.hedgeMat, 'hedge', nh);
    this.path = this.rebuild(this.path, this.pathGeo, this.pathMat, 'path', np);
  }

  private rebuild(mesh: THREE.InstancedMesh | null, geo: THREE.BufferGeometry, mat: THREE.Material, kind: Piece['kind'], n: number): THREE.InstancedMesh | null {
    if (mesh && mesh.instanceMatrix.count < n) { this.group.remove(mesh); mesh.dispose(); mesh = null; }
    if (n === 0) { if (mesh) mesh.count = 0; return mesh; }
    if (!mesh) {
      mesh = new THREE.InstancedMesh(geo, mat, Math.max(64, n * 2));
      mesh.name = `jardinets-${kind}`;
      mesh.castShadow = kind === 'hedge';
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    let i = 0;
    for (const ps of this.pieces.values()) for (const p of ps) if (p.kind === kind) mesh.instanceMatrix.array.set(p.m, 16 * i++);
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    return mesh;
  }

  dispose(): void {
    for (const m of [this.hedge, this.path]) m?.dispose();
    this.hedgeGeo.dispose(); this.pathGeo.dispose(); this.hedgeMat.dispose(); this.pathMat.dispose();
    this.group.removeFromParent();
  }
}
