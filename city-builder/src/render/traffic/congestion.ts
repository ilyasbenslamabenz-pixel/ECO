/**
 * Carte de congestion (rendu) : un ruban translucide posé au-dessus de la chaussée de chaque tronçon,
 * coloré par le niveau de congestion simulé (0 fluide → 3 à l'arrêt).
 *
 * - Géométrie construite une fois par version de réseau (polylignes envoyées par la simulation dans
 *   `delta.ext.circulation.layout`), un seul maillage pour tout le réseau (1 draw call).
 * - Mise à jour ≈ 1/s : seules les COULEURS de sommets changent (aucune reconstruction, aucune allocation).
 * - Couche purement informative : désactivée par défaut, sans ombre ni écriture de profondeur.
 */
import * as THREE from 'three';
import { CONGESTION_COLORS, type CongestionFrame, type CongestionLayout } from '../../shared/protocol-ext/circulation';

export { CONGESTION_COLORS };

/** Élévation du ruban au-dessus de la chaussée (m). */
const LIFT = 0.28;

export class CongestionOverlay {
  readonly group = new THREE.Group();
  private mesh: THREE.Mesh | null = null;
  private geo: THREE.BufferGeometry | null = null;
  private colors: Float32Array = new Float32Array(0);
  private colAttr: THREE.BufferAttribute | null = null;
  /** Début et nombre de sommets de chaque tronçon (index parallèle à `edgeIds`). */
  private vtxStart: Int32Array = new Int32Array(0);
  private edgeIds: Int32Array = new Int32Array(0);
  private indexOf = new Map<number, number>();
  private readonly palette: Float32Array;
  layoutVersion = -1;

  constructor() {
    this.group.name = 'carte_congestion';
    this.group.visible = false;
    this.palette = new Float32Array(CONGESTION_COLORS.length * 3);
    const c = new THREE.Color();
    CONGESTION_COLORS.forEach((hex, i) => {
      c.set(hex).convertSRGBToLinear();
      this.palette[i * 3] = c.r; this.palette[i * 3 + 1] = c.g; this.palette[i * 3 + 2] = c.b;
    });
  }

  get visible(): boolean { return this.group.visible; }
  set visible(v: boolean) { this.group.visible = v; }

  /** Nombre de tronçons représentés. */
  get edgeCount(): number { return this.edgeIds.length; }

  /** (Re)construit la géométrie à partir des polylignes du réseau. */
  setLayout(layout: CongestionLayout): void {
    this.dispose();
    const n = layout.edgeIds.length;
    this.edgeIds = layout.edgeIds;
    this.vtxStart = new Int32Array(n + 1);
    this.indexOf.clear();
    let verts = 0;
    for (let e = 0; e < n; e++) {
      const pts = layout.ptStart[e + 1]! - layout.ptStart[e]!;
      this.vtxStart[e] = verts;
      verts += Math.max(0, pts) * 2;
      this.indexOf.set(layout.edgeIds[e]!, e);
    }
    this.vtxStart[n] = verts;
    this.layoutVersion = layout.version;
    if (verts === 0) return;
    const pos = new Float32Array(verts * 3);
    const col = new Float32Array(verts * 3).fill(0.6);
    const idx: number[] = [];
    for (let e = 0; e < n; e++) {
      const p0 = layout.ptStart[e]!, p1 = layout.ptStart[e + 1]!;
      const half = Math.max(1, layout.half[e]!) * 0.9;
      let v = this.vtxStart[e]!;
      for (let p = p0; p < p1; p++) {
        // normale : perpendiculaire au segment courant (moyenne aux points intérieurs)
        const a = Math.max(p0, p - 1), b = Math.min(p1 - 1, p + 1);
        let dx = layout.x[b]! - layout.x[a]!, dz = layout.z[b]! - layout.z[a]!;
        const l = Math.hypot(dx, dz) || 1;
        dx /= l; dz /= l;
        const nx = -dz * half, nz = dx * half;
        const x = layout.x[p]!, y = layout.y[p]! + LIFT, z = layout.z[p]!;
        pos[v * 3] = x - nx; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z - nz;
        pos[(v + 1) * 3] = x + nx; pos[(v + 1) * 3 + 1] = y; pos[(v + 1) * 3 + 2] = z + nz;
        if (p + 1 < p1) idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
        v += 2;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const colAttr = new THREE.BufferAttribute(col, 3);
    colAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('color', colAttr);
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, toneMapped: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'congestion_rubans';
    mesh.renderOrder = 3;
    mesh.castShadow = false; mesh.receiveShadow = false;
    this.group.add(mesh);
    this.mesh = mesh; this.geo = geo; this.colors = col; this.colAttr = colAttr;
  }

  /** Applique les niveaux de congestion (couleurs de sommets ; aucune allocation). */
  setLevels(frame: CongestionFrame): void {
    if (!this.colAttr) return;
    const col = this.colors, pal = this.palette;
    for (let i = 0; i < frame.edgeIds.length; i++) {
      const e = this.indexOf.get(frame.edgeIds[i]!);
      if (e === undefined) continue;
      const lvl = Math.min(3, frame.level[i]!);
      const r = pal[lvl * 3]!, g = pal[lvl * 3 + 1]!, b = pal[lvl * 3 + 2]!;
      for (let v = this.vtxStart[e]!; v < this.vtxStart[e + 1]!; v++) {
        col[v * 3] = r; col[v * 3 + 1] = g; col[v * 3 + 2] = b;
      }
    }
    this.colAttr.needsUpdate = true;
  }

  /** Couleur (linéaire) d'un niveau — tests et interface. */
  colorOf(level: number): [number, number, number] {
    const l = Math.min(3, Math.max(0, level | 0));
    return [this.palette[l * 3]!, this.palette[l * 3 + 1]!, this.palette[l * 3 + 2]!];
  }

  /** Couleur de sommet d'un tronçon (tests). */
  edgeColor(edgeId: number): [number, number, number] | null {
    const e = this.indexOf.get(edgeId);
    if (e === undefined || this.vtxStart[e + 1]! <= this.vtxStart[e]!) return null;
    const v = this.vtxStart[e]!;
    return [this.colors[v * 3]!, this.colors[v * 3 + 1]!, this.colors[v * 3 + 2]!];
  }

  dispose(): void {
    if (this.mesh) {
      this.group.remove(this.mesh);
      (this.mesh.material as THREE.Material).dispose();
    }
    this.geo?.dispose();
    this.mesh = null; this.geo = null; this.colAttr = null;
    this.colors = new Float32Array(0);
    this.vtxStart = new Int32Array(0);
    this.edgeIds = new Int32Array(0);
    this.indexOf.clear();
    this.layoutVersion = -1;
  }
}
