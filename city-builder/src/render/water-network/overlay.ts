/**
 * Calque souterrain de la vue « eau » : canalisations d'eau potable et égouts (tracé de la voirie, décalés de part
 * et d'autre de l'axe), pastilles de desserte des bâtiments, cellules des cours d'eau colorées par la pollution.
 * Dessiné par-dessus la scène (sans test de profondeur) sous un voile sombre qui atténue la surface : effet de
 * « vue en coupe ». Masqué en vue normale. Le rendu ne modifie jamais l'état du jeu.
 */
import * as THREE from 'three';
import type { PipeGeometry, RiverLayer, WaterLayerState } from '../../shared/water-network/types';
import type { WaterViewMode } from './view';

const C = {
  ok: new THREE.Color('#5fd39a'), partial: new THREE.Color('#f2c230'), ko: new THREE.Color('#ff6b6b'),
  fed: new THREE.Color('#4fb3ff'), dry: new THREE.Color('#596270'), sewer: new THREE.Color('#b07a45'),
  pLow: new THREE.Color('#ff6b6b'), pMid: new THREE.Color('#ff9f43'), pGood: new THREE.Color('#5fd39a'), pHigh: new THREE.Color('#4fb3ff'),
  clean: new THREE.Color('#3d8fd6'), mid: new THREE.Color('#9a8f3a'), dirty: new THREE.Color('#8b4a22'),
};

const OVERLAY_ORDER = 20;

function overlayMaterial(opacity = 1): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity, depthTest: false, depthWrite: false, fog: false, toneMapped: false });
}

export class WaterOverlay {
  readonly group = new THREE.Group();
  private readonly pipeGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
  private readonly diskGeo = new THREE.CylinderGeometry(1, 1, 1, 14, 1, false);
  private readonly cellGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private readonly pipeMat = overlayMaterial(0.95);
  private readonly sewerMat = overlayMaterial(0.9);
  private readonly diskMat = overlayMaterial(0.95);
  private readonly cellMat = overlayMaterial(0.62);
  private water: THREE.InstancedMesh | null = null;
  private sewer: THREE.InstancedMesh | null = null;
  private disks: THREE.InstancedMesh | null = null;
  private cells: THREE.InstancedMesh | null = null;
  private readonly veil: THREE.Mesh;
  /** Tronçon (index dans PipeGeometry.ids) de chaque morceau de conduite. */
  private pieceSeg = new Int32Array(0);
  private pieceLen = new Float32Array(0);
  private pipes: PipeGeometry | null = null;
  private layer: WaterLayerState | null = null;
  private river: RiverLayer | null = null;
  private riverPollution: Float32Array | null = null;
  mode: WaterViewMode = 'off';
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly col = new THREE.Color();

  constructor(private readonly heightAt: (x: number, z: number) => number) {
    this.group.name = 'eau:calque';
    this.group.visible = false;
    this.group.renderOrder = OVERLAY_ORDER;
    const veilMat = new THREE.MeshBasicMaterial({ color: 0x0a0f16, transparent: true, opacity: 0.58, depthTest: false, depthWrite: false, fog: false });
    this.veil = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), veilMat);
    this.veil.name = 'eau:voile';
    this.veil.renderOrder = OVERLAY_ORDER - 1;
    this.veil.frustumCulled = false;
    this.group.add(this.veil);
  }

  /** Nombre d'instances dessinées (diagnostic e2e). */
  stats(): { pipes: number; sewers: number; buildings: number; riverCells: number; visible: boolean } {
    return { pipes: this.water?.count ?? 0, sewers: this.sewer?.count ?? 0, buildings: this.disks?.count ?? 0, riverCells: this.cells?.count ?? 0, visible: this.group.visible };
  }

  setMode(mode: WaterViewMode): void {
    this.mode = mode;
    this.group.visible = mode !== 'off';
    this.recolor();
  }

  clear(): void {
    for (const k of ['water', 'sewer', 'disks', 'cells'] as const) {
      const mesh = this[k];
      if (mesh) { this.group.remove(mesh); mesh.dispose(); this[k] = null; }
    }
    this.pipes = null; this.layer = null; this.river = null; this.riverPollution = null;
  }

  /** Géométrie des canalisations : une instance par morceau de polyligne, pour l'eau et pour les égouts. */
  setPipes(p: PipeGeometry): void {
    this.pipes = p;
    for (const k of ['water', 'sewer'] as const) { const mesh = this[k]; if (mesh) { this.group.remove(mesh); mesh.dispose(); this[k] = null; } }
    let pieces = 0;
    for (let s = 0; s < p.ids.length; s++) pieces += Math.max(0, p.offsets[s + 1]! - p.offsets[s]! - 1);
    this.pieceSeg = new Int32Array(pieces);
    this.pieceLen = new Float32Array(pieces);
    const water = new THREE.InstancedMesh(this.pipeGeo, this.pipeMat, Math.max(1, pieces));
    const sewer = new THREE.InstancedMesh(this.pipeGeo, this.sewerMat, Math.max(1, pieces));
    for (const mesh of [water, sewer]) { mesh.renderOrder = OVERLAY_ORDER + 1; mesh.frustumCulled = false; }
    water.name = 'eau:conduites'; sewer.name = 'eau:egouts';
    let n = 0;
    for (let s = 0; s < p.ids.length; s++) {
      for (let k = p.offsets[s]!; k < p.offsets[s + 1]! - 1; k++) {
        const x0 = p.points[2 * k]!, z0 = p.points[2 * k + 1]!, x1 = p.points[2 * k + 2]!, z1 = p.points[2 * k + 3]!;
        const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz) || 1e-3;
        const nx = -dz / L, nz = dx / L;
        this.pieceSeg[n] = s; this.pieceLen[n] = L;
        this.placePiece(water, n, x0 + nx * 1.6, z0 + nz * 1.6, x1 + nx * 1.6, z1 + nz * 1.6, 0.55, -0.6);
        this.placePiece(sewer, n, x0 - nx * 1.6, z0 - nz * 1.6, x1 - nx * 1.6, z1 - nz * 1.6, 0.7, -1.4);
        n++;
      }
    }
    water.count = pieces; sewer.count = pieces;
    for (const mesh of [water, sewer]) { mesh.instanceMatrix.needsUpdate = true; this.group.add(mesh); }
    this.water = water; this.sewer = sewer;
    this.recolor();
  }

  private placePiece(mesh: THREE.InstancedMesh, i: number, x0: number, z0: number, x1: number, z1: number, r: number, dy: number): void {
    const y0 = this.heightAt(x0, z0) + dy, y1 = this.heightAt(x1, z1) + dy;
    const a = new THREE.Vector3(x0, Number.isFinite(y0) ? y0 : 0, z0), b = new THREE.Vector3(x1, Number.isFinite(y1) ? y1 : 0, z1);
    const d = b.clone().sub(a);
    const len = d.length() || 1e-3;
    this.q.setFromUnitVectors(this.up, d.divideScalar(len));
    this.v.copy(a).add(b).multiplyScalar(0.5);
    this.s.set(r, len + r * 0.8, r);
    this.m.compose(this.v, this.q, this.s);
    mesh.setMatrixAt(i, this.m);
  }

  /** État par tronçon et par bâtiment (pastilles reconstruites si la liste change). */
  setLayer(l: WaterLayerState): void {
    const same = this.layer && this.layer.buildingIds.length === l.buildingIds.length && this.layer.buildingIds.every((v, i) => v === l.buildingIds[i]);
    this.layer = l;
    if (!same) {
      if (this.disks) { this.group.remove(this.disks); this.disks.dispose(); }
      const n = l.buildingIds.length;
      const disks = new THREE.InstancedMesh(this.diskGeo, this.diskMat, Math.max(1, n));
      disks.name = 'eau:desserte'; disks.renderOrder = OVERLAY_ORDER + 2; disks.frustumCulled = false;
      for (let i = 0; i < n; i++) {
        const x = l.buildingXZ[2 * i]!, z = l.buildingXZ[2 * i + 1]!;
        const y = this.heightAt(x, z);
        this.v.set(x, (Number.isFinite(y) ? y : 0) + 0.6, z);
        this.q.identity();
        this.s.set(3.2, 0.5, 3.2);
        this.m.compose(this.v, this.q, this.s);
        disks.setMatrixAt(i, this.m);
      }
      disks.count = n;
      disks.instanceMatrix.needsUpdate = true;
      this.group.add(disks);
      this.disks = disks;
    }
    this.recolor();
  }

  setRiver(r: RiverLayer): void {
    this.river = r;
    this.riverPollution = r.pollution;
    if (this.cells) { this.group.remove(this.cells); this.cells.dispose(); }
    const n = r.cells.length;
    const cells = new THREE.InstancedMesh(this.cellGeo, this.cellMat, Math.max(1, n));
    cells.name = 'eau:rivieres'; cells.renderOrder = OVERLAY_ORDER; cells.frustumCulled = false;
    for (let t = 0; t < n; t++) {
      const k = r.cells[t]!;
      const x = r.originX + ((k % r.cols) + 0.5) * r.cellSize, z = r.originZ + (Math.floor(k / r.cols) + 0.5) * r.cellSize;
      const y = this.heightAt(x, z);
      this.v.set(x, (Number.isFinite(y) ? y : 0) + 2.5, z);
      this.q.identity();
      this.s.set(r.cellSize, 1, r.cellSize);
      this.m.compose(this.v, this.q, this.s);
      cells.setMatrixAt(t, this.m);
    }
    cells.count = n;
    cells.instanceMatrix.needsUpdate = true;
    this.group.add(cells);
    this.cells = cells;
    this.recolor();
  }

  setRiverPollution(p: Float32Array): void {
    this.riverPollution = p;
    this.recolor();
  }

  private servedColor(v: number): THREE.Color { return v >= 0.9 ? C.ok : v >= 0.5 ? C.partial : C.ko; }
  private pressureColor(bar: number): THREE.Color { return bar < 0.5 ? C.pLow : bar < 1.5 ? C.pMid : bar < 3 ? C.pGood : C.pHigh; }
  private pollutionColor(v: number): THREE.Color {
    const t = Math.max(0, Math.min(1, v / 20));
    return t < 0.5 ? this.col.copy(C.clean).lerp(C.mid, t * 2) : this.col.copy(C.mid).lerp(C.dirty, (t - 0.5) * 2);
  }

  /** Couleurs selon le mode (appelé à chaque changement d'état ou de mode). */
  recolor(): void {
    if (this.mode === 'off') return;
    const L = this.layer, mode = this.mode;
    if (this.water && this.pipes) {
      for (let i = 0; i < this.pieceSeg.length; i++) {
        const s = this.pieceSeg[i]!;
        const fed = L ? L.pipeFed[s] === 1 : false;
        let c: THREE.Color;
        if (mode === 'pression') c = fed ? this.pressureColor(L!.pipePressure[s]!) : C.dry;
        else if (mode === 'pollution') c = this.col.copy(fed ? C.fed : C.dry).multiplyScalar(0.45);
        else c = fed ? this.col.copy(C.dry).lerp(C.fed, 0.55 + 0.45 * Math.min(1, (L?.pipeLoad[s] ?? 0) * 3 + 0.4)) : C.dry;
        this.water.setColorAt(i, c);
      }
      if (this.water.instanceColor) this.water.instanceColor.needsUpdate = true;
    }
    if (this.sewer && this.pipes) {
      for (let i = 0; i < this.pieceSeg.length; i++) {
        const s = this.pieceSeg[i]!;
        const load = L?.sewerLoad[s] ?? 0;
        const c = mode === 'pression' ? this.col.copy(C.sewer).multiplyScalar(0.35) : this.col.copy(C.sewer).multiplyScalar(load > 0 ? 1 : 0.55);
        this.sewer.setColorAt(i, c);
      }
      if (this.sewer.instanceColor) this.sewer.instanceColor.needsUpdate = true;
    }
    if (this.disks && L) {
      for (let i = 0; i < L.buildingIds.length; i++) {
        const c = mode === 'pollution'
          ? this.col.copy(C.ko).lerp(C.ok, Math.max(0, Math.min(1, (L.buildingQuality[i]! - 0.4) / 0.6)))
          : this.servedColor(L.buildingServed[i]!);
        this.disks.setColorAt(i, c);
      }
      if (this.disks.instanceColor) this.disks.instanceColor.needsUpdate = true;
    }
    if (this.cells) this.cells.visible = mode === 'pollution';
    if (this.cells && this.river && mode === 'pollution') {
      const p = this.riverPollution;
      for (let t = 0; t < this.river.cells.length; t++) {
        const v = p?.[t] ?? 0;
        this.cells.setColorAt(t, this.pollutionColor(v));
      }
      if (this.cells.instanceColor) this.cells.instanceColor.needsUpdate = true;
    }
  }

  /** Voile devant la caméra (couvre tout le champ). */
  frame(camera: THREE.PerspectiveCamera): void {
    if (!this.group.visible) return;
    const dist = camera.near * 2;
    const h = 2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.2;
    camera.getWorldDirection(this.v);
    this.veil.position.copy(camera.position).addScaledVector(this.v, dist);
    this.veil.quaternion.copy(camera.quaternion);
    this.veil.scale.set(h * camera.aspect, h, 1);
    this.veil.updateMatrixWorld();
  }

  dispose(): void {
    this.clear();
    this.pipeGeo.dispose(); this.diskGeo.dispose(); this.cellGeo.dispose();
    this.pipeMat.dispose(); this.sewerMat.dispose(); this.diskMat.dispose(); this.cellMat.dispose();
    this.veil.geometry.dispose(); (this.veil.material as THREE.Material).dispose();
  }
}
