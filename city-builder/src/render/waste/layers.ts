/**
 * Rendu du module « Déchets » : camions-bennes (LOD par distance), tumulus des décharges (relief qui monte avec
 * le remplissage), panache de l'incinérateur, conteneurs de tri de rue (instanciés), calque « déchets »
 * (nuisances + pollution du sol drapées sur le terrain, remplissage des bacs par bâtiment).
 * Lecture seule de l'état de la simulation (charges utiles `ext.dechets`).
 */
import * as THREE from 'three';
import type { DechetsLayer } from '../../shared/protocol-ext/dechets';
import { WASTE_MODEL_ANCHORS, WASTE_MODEL_IDS, type WasteFacilityInfo } from '../../shared/waste/types';
import type { RenderPluginContext } from '../plugins/types';

/** Couleur de peinture des bennes municipales (variante « vert propreté » du catalogue). */
const TRUCK_PAINT = '#3d7a3a';

/** Transforme un groupe glTF en InstancedMesh (un par maillage), matrices locales comprises. */
function instanced(src: THREE.Object3D, count: number): { group: THREE.Group; meshes: { mesh: THREE.InstancedMesh; local: THREE.Matrix4 }[] } {
  const group = new THREE.Group();
  const meshes: { mesh: THREE.InstancedMesh; local: THREE.Matrix4 }[] = [];
  src.updateMatrixWorld(true);
  src.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const im = new THREE.InstancedMesh(m.geometry, m.material, Math.max(1, count));
    im.count = 0;
    im.castShadow = true; im.receiveShadow = true;
    im.frustumCulled = false;
    group.add(im);
    meshes.push({ mesh: im, local: m.matrixWorld.clone() });
  });
  return { group, meshes };
}

/* ------------------------------------------------------------------ */
/* Camions                                                             */
/* ------------------------------------------------------------------ */

export class TruckLayer {
  readonly group = new THREE.Group();
  private lods: (THREE.Object3D | null)[] = [null, null, null];
  private trucks: THREE.LOD[] = [];
  private poses: Float32Array = new Float32Array(0);
  private shown = 0;

  constructor(private readonly ctx: RenderPluginContext) {
    this.group.name = 'dechets-camions';
    ctx.scene.add(this.group);
    const a = ctx.catalog.assets.find((x) => x.id === WASTE_MODEL_IDS.camion);
    if (!a) return;
    a.lods.forEach((l, i) => {
      void ctx.lib.load(a.id, i).then((g) => {
        const c = g.clone(true);
        c.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          const repl = mats.map((mat) => {
            if (mat.name !== 'peinture') return mat;
            const k = (mat as THREE.MeshStandardMaterial).clone();
            k.color.set(TRUCK_PAINT);
            return k;
          });
          m.material = Array.isArray(m.material) ? repl : repl[0]!;
        });
        this.lods[i] = c;
        this.rebuild();
      }).catch(() => undefined);
    });
  }

  private rebuild(): void {
    for (const t of this.trucks) this.group.remove(t);
    this.trucks = [];
    this.apply(this.poses);
  }

  private make(): THREE.LOD {
    const lod = new THREE.LOD();
    const dist = [0, 150, 500];
    this.lods.forEach((g, i) => { if (g) lod.addLevel(g.clone(true), dist[i]); });
    lod.name = 'benne';
    return lod;
  }

  /** [x, z, cap, charge] par camion. */
  apply(poses: Float32Array): void {
    this.poses = poses;
    if (!this.lods.some(Boolean)) return;
    const n = Math.floor(poses.length / 4);
    while (this.trucks.length < n) { const t = this.make(); this.trucks.push(t); this.group.add(t); }
    for (let i = 0; i < this.trucks.length; i++) {
      const t = this.trucks[i]!;
      t.visible = i < n;
      if (i >= n) continue;
      const x = poses[i * 4]!, z = poses[i * 4 + 1]!, h = poses[i * 4 + 2]!;
      t.position.set(x, this.ctx.heightAt(x, z), z);
      t.rotation.set(0, h, 0);
    }
    this.shown = n;
  }

  frame(): void { for (let i = 0; i < this.shown; i++) this.trucks[i]?.update(this.ctx.camera); }
  get count(): number { return this.shown; }
  positions(): number[] { return Array.from(this.poses); }
  dispose(): void { this.ctx.scene.remove(this.group); }
}

/* ------------------------------------------------------------------ */
/* Installations : tumulus des décharges, panache de l'incinérateur    */
/* ------------------------------------------------------------------ */

export class FacilityLayer {
  readonly group = new THREE.Group();
  private moundSrc: THREE.Object3D | null = null;
  private mounds = new Map<number, THREE.Object3D>();
  private smokes = new Map<number, THREE.Group>();
  private facilities: WasteFacilityInfo[] = [];
  private t = 0;
  private puffGeo = new THREE.SphereGeometry(1, 10, 8);
  private puffMat = new THREE.MeshStandardMaterial({ color: '#d8d6d0', transparent: true, opacity: 0.35, roughness: 1, depthWrite: false });

  constructor(private readonly ctx: RenderPluginContext) {
    this.group.name = 'dechets-installations';
    ctx.scene.add(this.group);
    if (ctx.catalog.assets.some((a) => a.id === WASTE_MODEL_IDS.tumulus)) {
      void ctx.lib.load(WASTE_MODEL_IDS.tumulus, 0).then((g) => { this.moundSrc = g; this.apply(this.facilities); }).catch(() => undefined);
    }
  }

  apply(list: WasteFacilityInfo[]): void {
    this.facilities = list;
    const keepM = new Set<number>(), keepS = new Set<number>();
    for (const f of list) {
      const c = Math.cos(f.rot), s = Math.sin(f.rot);
      const local = (lx: number, lz: number): [number, number] => [f.x + lx * c + lz * s, f.z - lx * s + lz * c];
      if (f.kind === 'decharge' && this.moundSrc) {
        keepM.add(f.buildingId);
        let m = this.mounds.get(f.buildingId);
        if (!m) { m = this.moundSrc.clone(true); m.name = `tumulus-${f.buildingId}`; this.mounds.set(f.buildingId, m); this.group.add(m); }
        const fill = f.capacity > 0 ? Math.min(1, f.amount / f.capacity) : 0;
        const [mx, mz] = local(WASTE_MODEL_ANCHORS.moundCenter[0], WASTE_MODEL_ANCHORS.moundCenter[1]);
        m.position.set(mx, this.ctx.heightAt(f.x, f.z) + 0.05, mz);
        m.rotation.set(0, f.rot, 0);
        // Le modèle est le tumulus plein (100 %) : la hauteur suit le remplissage, l'emprise grandit un peu.
        const sxz = 0.55 + 0.45 * Math.sqrt(fill);
        m.scale.set(sxz, Math.max(0.02, fill), sxz);
        m.visible = fill > 0.002;
      }
      if (f.kind === 'incinerateur') {
        keepS.add(f.buildingId);
        let g = this.smokes.get(f.buildingId);
        if (!g) {
          g = new THREE.Group();
          g.name = `panache-${f.buildingId}`;
          for (let i = 0; i < 9; i++) { const p = new THREE.Mesh(this.puffGeo, this.puffMat); p.userData.k = i / 9; g.add(p); }
          this.smokes.set(f.buildingId, g);
          this.group.add(g);
        }
        const [cx, cz] = local(WASTE_MODEL_ANCHORS.chimneyTop[0], WASTE_MODEL_ANCHORS.chimneyTop[2]);
        g.position.set(cx, this.ctx.heightAt(f.x, f.z) + WASTE_MODEL_ANCHORS.chimneyTop[1], cz);
        g.visible = f.amount > 0; // a brûlé la veille
        g.userData.rate = f.capacity > 0 ? Math.min(1, f.amount / f.capacity) : 0;
      }
    }
    for (const [id, m] of this.mounds) if (!keepM.has(id)) { this.group.remove(m); this.mounds.delete(id); }
    for (const [id, g] of this.smokes) if (!keepS.has(id)) { this.group.remove(g); this.smokes.delete(id); }
  }

  frame(dt: number): void {
    this.t += Math.min(0.1, dt);
    for (const g of this.smokes.values()) {
      if (!g.visible) continue;
      const rate = 0.4 + 0.6 * ((g.userData.rate as number) ?? 0);
      for (const p of g.children) {
        const k = ((p.userData.k as number) + this.t * 0.06) % 1;
        const r = (1.6 + k * 7) * rate;
        p.position.set(k * 14, k * 26, Math.sin(k * 6 + (p.userData.k as number) * 9) * 2);
        p.scale.setScalar(r);
      }
    }
  }

  moundScale(id: number): number | null { const m = this.mounds.get(id); return m ? m.scale.y : null; }
  dispose(): void { this.ctx.scene.remove(this.group); this.puffGeo.dispose(); this.puffMat.dispose(); }
}

/* ------------------------------------------------------------------ */
/* Conteneurs de tri de rue                                            */
/* ------------------------------------------------------------------ */

export class ContainerLayer {
  readonly group = new THREE.Group();
  private parts: { mesh: THREE.InstancedMesh; local: THREE.Matrix4 }[] = [];
  private data: Float32Array = new Float32Array(0);
  private tmp = new THREE.Matrix4();
  private placement = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private up = new THREE.Vector3(0, 1, 0);

  constructor(private readonly ctx: RenderPluginContext) {
    this.group.name = 'dechets-conteneurs';
    ctx.scene.add(this.group);
    if (ctx.catalog.assets.some((a) => a.id === WASTE_MODEL_IDS.conteneurs)) {
      void ctx.lib.load(WASTE_MODEL_IDS.conteneurs, 1).then((g) => {
        const r = instanced(g, 256);
        this.parts = r.meshes;
        this.group.add(r.group);
        this.apply(this.data);
      }).catch(() => undefined);
    }
  }

  /** [x, z, cap] par groupe de conteneurs. */
  apply(data: Float32Array): void {
    this.data = data;
    if (!this.parts.length) return;
    const n = Math.min(256, Math.floor(data.length / 3));
    for (let i = 0; i < n; i++) {
      const x = data[i * 3]!, z = data[i * 3 + 1]!, h = data[i * 3 + 2]!;
      this.q.setFromAxisAngle(this.up, h);
      this.placement.compose(new THREE.Vector3(x, this.ctx.heightAt(x, z), z), this.q, new THREE.Vector3(1, 1, 1));
      for (const p of this.parts) { this.tmp.multiplyMatrices(this.placement, p.local); p.mesh.setMatrixAt(i, this.tmp); }
    }
    for (const p of this.parts) { p.mesh.count = n; p.mesh.instanceMatrix.needsUpdate = true; }
  }

  get count(): number { return this.parts[0]?.mesh.count ?? 0; }
  dispose(): void { this.ctx.scene.remove(this.group); }
}

/* ------------------------------------------------------------------ */
/* Calque « déchets »                                                  */
/* ------------------------------------------------------------------ */

const ramp = (v: number, out: THREE.Color): THREE.Color => {
  // 0 vert pâle -> 0,5 jaune -> 1 rouge brique
  const t = Math.min(1, Math.max(0, v));
  if (t < 0.5) return out.setRGB(0.35 + t * 1.2, 0.75, 0.3 - t * 0.3);
  return out.setRGB(0.95, 0.75 - (t - 0.5) * 1.2, 0.1);
};

export class WasteOverlay {
  readonly group = new THREE.Group();
  private mesh: THREE.Mesh | null = null;
  private bins: THREE.InstancedMesh;
  private binGeo = new THREE.CylinderGeometry(1.6, 1.6, 1, 10);
  private binMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  private gridMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
  private last: DechetsLayer | null = null;
  binCount = 0;
  cellsShown = 0;

  constructor(private readonly ctx: RenderPluginContext) {
    this.group.name = 'dechets-calque';
    this.group.visible = false;
    this.bins = new THREE.InstancedMesh(this.binGeo, this.binMat, 1);
    this.bins.count = 0;
    this.bins.frustumCulled = false;
    this.group.add(this.bins);
    ctx.scene.add(this.group);
  }

  get visible(): boolean { return this.group.visible; }
  setVisible(v: boolean): void { this.group.visible = v; if (v && this.last) this.apply(this.last); }

  apply(l: DechetsLayer): void {
    this.last = l;
    if (!this.group.visible) return;
    const { cols, rows, cellSize, originX, originZ } = l;
    // Grille drapée : un sommet par coin de cellule, valeur = moyenne des cellules voisines.
    const nv = (cols + 1) * (rows + 1);
    let geo = this.mesh?.geometry as THREE.BufferGeometry | undefined;
    if (!geo || geo.getAttribute('position').count !== nv) {
      geo?.dispose();
      geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(nv * 4), 4));
      const idx: number[] = [];
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
      geo.setIndex(idx);
      if (!this.mesh) { this.mesh = new THREE.Mesh(geo, this.gridMat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 5; this.group.add(this.mesh); }
      else this.mesh.geometry = geo;
    }
    const pos = geo.getAttribute('position') as THREE.BufferAttribute, col = geo.getAttribute('color') as THREE.BufferAttribute;
    const c = new THREE.Color();
    const val = (i: number, j: number): number => {
      if (i < 0 || j < 0 || i >= cols || j >= rows) return 0;
      const k = j * cols + i;
      return Math.max(l.nuisance[k]! / 60, l.soil[k]! / 40);
    };
    let shown = 0;
    for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
      const v = Math.max(val(i - 1, j - 1), val(i, j - 1), val(i - 1, j), val(i, j));
      const x = originX + i * cellSize, z = originZ + j * cellSize;
      const h = this.ctx.heightAt(x, z);
      const k = j * (cols + 1) + i;
      pos.setXYZ(k, x, (Number.isFinite(h) ? h : 0) + 1.5, z);
      ramp(v, c);
      col.setXYZW(k, c.r, c.g, c.b, v > 0.02 ? Math.min(0.85, 0.25 + v) : 0);
      if (v > 0.02) shown++;
    }
    pos.needsUpdate = true; col.needsUpdate = true;
    this.cellsShown = shown;
    // Bacs : colonne dont la hauteur et la couleur suivent le remplissage.
    const n = Math.floor(l.bins.length / 3);
    if (this.bins.instanceMatrix.count < n) {
      this.group.remove(this.bins);
      this.bins.dispose();
      this.bins = new THREE.InstancedMesh(this.binGeo, this.binMat, Math.max(16, n * 2));
      this.bins.frustumCulled = false;
      this.group.add(this.bins);
    }
    const m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      const x = l.bins[i * 3]!, z = l.bins[i * 3 + 1]!, f = l.bins[i * 3 + 2]!;
      const hgt = 2 + Math.min(1, f) * 14;
      m.makeScale(1, hgt, 1);
      m.setPosition(x, this.ctx.heightAt(x, z) + 14 + hgt / 2, z);
      this.bins.setMatrixAt(i, m);
      this.bins.setColorAt(i, ramp(f, c));
    }
    this.bins.count = n;
    this.bins.instanceMatrix.needsUpdate = true;
    if (this.bins.instanceColor) this.bins.instanceColor.needsUpdate = true;
    this.binCount = n;
  }

  dispose(): void {
    this.ctx.scene.remove(this.group);
    this.mesh?.geometry.dispose();
    this.binGeo.dispose(); this.binMat.dispose(); this.gridMat.dispose();
  }
}
