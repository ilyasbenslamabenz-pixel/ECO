/**
 * Rendu du module « bus » (lignes de bus tracées par le joueur) — NOUVEAU fichier : aucun fichier cœur du rendu n'est
 * modifié. Contenu :
 *  - le tracé de chaque ligne : un ruban de sa couleur posé sur la voie de droite (un maillage par ligne, reconstruit
 *    seulement quand la géométrie change) ;
 *  - les arrêts : poteau + panneau de la couleur de la ligne + pastille au sol (3 `InstancedMesh` pour tous les arrêts) ;
 *  - les bus : caisse de la couleur de la ligne + bandeau vitré (2 `InstancedMesh`), positions calculées à chaque image
 *    le long du tracé depuis le temps physique de la simulation (0,1 s par minute de jeu, comme le trafic), avec arrêt
 *    à chaque station ; aucune trame de positions n'est transférée par le worker ;
 *  - l'aperçu d'une ligne en cours de tracé (ruban translucide et anneaux d'arrêts, avant validation) ;
 *  - la carte « Transports en commun » (menu Calques) : maillage drapé, couleurs de sommets.
 * Le rendu ne modifie jamais l'état du jeu.
 */
import * as THREE from 'three';
import type { BusDelta, BusLayer, BusLineGeometry, BusStopView } from '../../shared/protocol-ext/bus';
import type { RenderPlugin, RenderPluginContext } from './types';

const MAX_STOPS = 2048;
const RIBBON_HALF = 0.9;

export interface BusDraftView {
  /** Polyligne x, y, z de l'aperçu (vide tant qu'il y a moins de deux arrêts). */
  points: number[];
  stops: { x: number; z: number; ok: boolean }[];
  color: string;
  /** Arrêt sélectionné (rang dans `stops`), -1 sinon. */
  selected: number;
}

/** Ruban plat le long d'une polyligne (x, y, z), décalé de `lift` au-dessus. */
function ribbonGeometry(pts: readonly number[], half: number, lift: number): THREE.BufferGeometry {
  const n = pts.length / 3;
  const pos = new Float32Array(n * 2 * 3);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    let dx = pts[b * 3]! - pts[a * 3]!, dz = pts[b * 3 + 2]! - pts[a * 3 + 2]!;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    const x = pts[i * 3]!, y = pts[i * 3 + 1]! + lift, z = pts[i * 3 + 2]!;
    pos.set([x - dz * half, y, z + dx * half, x + dz * half, y, z - dx * half], i * 6);
  }
  const idx: number[] = [];
  for (let i = 0; i + 1 < n; i++) { const p = i * 2; idx.push(p, p + 2, p + 1, p + 1, p + 2, p + 3); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

interface LineDraw { geo: BusLineGeometry; mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; cycle: number; legs: { s0: number; s1: number; t0: number; tMove: number }[] }

class BusScene {
  readonly group = new THREE.Group();
  private lines: LineDraw[] = [];
  private stops: BusStopView[] = [];
  private colorOfLine = new Map<number, string>();
  private readonly poles: THREE.InstancedMesh;
  private readonly signs: THREE.InstancedMesh;
  private readonly disks: THREE.InstancedMesh;
  private bodies!: THREE.InstancedMesh;
  private glass!: THREE.InstancedMesh;
  private busCap = 0;
  private readonly bodyGeo = new THREE.BoxGeometry(2.5, 2.4, 11.2);
  private readonly glassGeo = new THREE.BoxGeometry(2.56, 0.85, 10.2);
  private readonly bodyMat = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.1 });
  private readonly glassMat = new THREE.MeshStandardMaterial({ color: 0x1b2633, roughness: 0.2, metalness: 0.3 });
  phys = 0;
  speed = 0;
  busCount = 0;
  // Aperçu.
  private draftMesh: THREE.Mesh | null = null;
  private readonly draftMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
  private readonly ringGeo = new THREE.RingGeometry(3.2, 4.6, 28);
  private readonly ringMats = { ok: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }), bad: new THREE.MeshBasicMaterial({ color: 0xff4d4d, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }), sel: new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide }) };
  private rings: THREE.Mesh[] = [];
  draftPoints = 0;
  // Carte.
  private layerMesh: THREE.Mesh | null = null;
  private readonly layerMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide });
  layer: BusLayer | null = null;
  layerOn = false;
  layerCells = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly sc = new THREE.Vector3(1, 1, 1);
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly c = new THREE.Color();

  constructor(private readonly ctx: RenderPluginContext) {
    this.group.name = 'bus-lignes';
    ctx.scene.add(this.group);
    const pole = new THREE.CylinderGeometry(0.09, 0.09, 3, 6); pole.translate(0, 1.5, 0);
    const sign = new THREE.BoxGeometry(0.75, 0.75, 0.1); sign.translate(0, 2.75, 0);
    const disk = new THREE.CircleGeometry(2.4, 20); disk.rotateX(-Math.PI / 2); disk.translate(0, 0.35, 0);
    this.poles = new THREE.InstancedMesh(pole, new THREE.MeshStandardMaterial({ color: 0x8a939c, metalness: 0.6, roughness: 0.4 }), MAX_STOPS);
    this.signs = new THREE.InstancedMesh(sign, new THREE.MeshStandardMaterial({ roughness: 0.5, emissive: 0x111111 }), MAX_STOPS);
    this.disks = new THREE.InstancedMesh(disk, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.75, depthWrite: false }), MAX_STOPS);
    for (const im of [this.poles, this.signs, this.disks]) { im.count = 0; im.frustumCulled = false; this.group.add(im); }
    this.signs.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_STOPS * 3), 3);
    this.disks.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_STOPS * 3), 3);
    this.disks.renderOrder = 4;
    this.ensureBuses(64);
  }

  private makeBuses(n: number): { bodies: THREE.InstancedMesh; glass: THREE.InstancedMesh } {
    const bodies = new THREE.InstancedMesh(this.bodyGeo, this.bodyMat, n);
    bodies.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    const glass = new THREE.InstancedMesh(this.glassGeo, this.glassMat, n);
    for (const im of [bodies, glass]) { im.count = 0; im.frustumCulled = false; im.castShadow = true; }
    return { bodies, glass };
  }

  private ensureBuses(n: number): void {
    if (n <= this.busCap) return;
    const cap = Math.max(64, 1 << Math.ceil(Math.log2(n)));
    if (this.busCap) { this.group.remove(this.bodies, this.glass); this.bodies.dispose(); this.glass.dispose(); }
    const b = this.makeBuses(cap);
    this.bodies = b.bodies; this.glass = b.glass; this.busCap = cap;
    this.group.add(this.bodies, this.glass);
  }

  /* ------------------------------ Données ------------------------------ */

  apply(d: BusDelta | undefined, full: boolean): void {
    if (!d) { if (full) { this.setGeometry([]); this.setStops([]); } return; }
    if (Number.isFinite(d.phys)) this.phys = d.phys;
    if (Number.isFinite(d.speed)) this.speed = d.speed;
    if (d.lines) { this.colorOfLine.clear(); for (const l of d.lines) this.colorOfLine.set(l.id, l.color); }
    if (d.geometry) this.setGeometry(d.geometry);
    else if (full) this.setGeometry([]);
    if (d.stops) this.setStops(d.stops);
    if (d.layer !== undefined && d.layer !== null) { this.layer = d.layer; if (this.layerOn) this.rebuildLayer(); }
  }

  private setGeometry(list: BusLineGeometry[]): void {
    for (const l of this.lines) { this.group.remove(l.mesh); l.mesh.geometry.dispose(); l.mat.dispose(); }
    this.lines = [];
    let buses = 0;
    for (const g of list) {
      if (g.points.length < 6) continue;
      const mat = new THREE.MeshBasicMaterial({ color: g.color, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      const mesh = new THREE.Mesh(ribbonGeometry(g.points, RIBBON_HALF, 0.12), mat);
      mesh.renderOrder = 3;
      mesh.name = `bus-ligne-${g.id}`;
      this.group.add(mesh);
      // Étapes d'un tour : arrêt (dwell) puis trajet jusqu'à l'arrêt suivant.
      const L = g.cum[g.cum.length - 1] ?? 0;
      const v = Math.max(0.5, g.speed);
      const legs: LineDraw['legs'] = [];
      let t = 0;
      for (let i = 0; i < g.stopS.length; i++) {
        const s0 = g.stopS[i]!, s1 = i + 1 < g.stopS.length ? g.stopS[i + 1]! : L;
        const tMove = Math.max(0, s1 - s0) / v;
        legs.push({ s0, s1, t0: t, tMove });
        t += g.dwellS + tMove;
      }
      this.lines.push({ geo: g, mesh, mat, cycle: Math.max(1, t), legs });
      buses += g.activeBuses;
    }
    this.ensureBuses(buses);
  }

  private setStops(list: BusStopView[]): void {
    this.stops = list;
    const n = Math.min(MAX_STOPS, list.length);
    for (let i = 0; i < n; i++) {
      const s = list[i]!;
      const h = this.ctx.heightAt(s.x, s.z);
      this.v.set(s.x, Number.isFinite(h) ? h : 0, s.z);
      this.m.compose(this.v, this.q.identity(), this.sc.set(1, 1, 1));
      this.poles.setMatrixAt(i, this.m); this.signs.setMatrixAt(i, this.m); this.disks.setMatrixAt(i, this.m);
      this.c.set(s.ok ? this.colorOfLine.get(s.lineId) ?? '#ffffff' : '#ff4d4d');
      this.signs.setColorAt(i, this.c); this.disks.setColorAt(i, this.c);
    }
    for (const im of [this.poles, this.signs, this.disks]) {
      im.count = n;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }

  /* ------------------------------ Bus ------------------------------ */

  /** Position (x, y, z) et cap le long de la polyligne à l'abscisse s. */
  private at(g: BusLineGeometry, s: number, out: THREE.Vector3): number {
    const cum = g.cum, p = g.points;
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid]! <= s) lo = mid; else hi = mid; }
    const span = cum[hi]! - cum[lo]!;
    const f = span > 0 ? (s - cum[lo]!) / span : 0;
    const ax = p[lo * 3]!, ay = p[lo * 3 + 1]!, az = p[lo * 3 + 2]!, bx = p[hi * 3]!, by = p[hi * 3 + 1]!, bz = p[hi * 3 + 2]!;
    out.set(ax + (bx - ax) * f, ay + (by - ay) * f, az + (bz - az) * f);
    return Math.atan2(bx - ax, bz - az);
  }

  frame(dt: number): void {
    if (this.speed > 0) this.phys += Math.min(dt, 0.25) * this.speed;
    let k = 0;
    for (const l of this.lines) {
      const g = l.geo, n = g.activeBuses;
      if (n <= 0) continue;
      for (let b = 0; b < n && k < this.busCap; b++) {
        let tau = (this.phys + (b * l.cycle) / n) % l.cycle;
        if (tau < 0) tau += l.cycle;
        let s = 0;
        for (const leg of l.legs) {
          if (tau < leg.t0 + g.dwellS) { s = leg.s0; break; }
          if (tau < leg.t0 + g.dwellS + leg.tMove) { s = leg.s0 + (tau - leg.t0 - g.dwellS) * (leg.s1 - leg.s0) / Math.max(1e-6, leg.tMove); break; }
          s = leg.s1;
        }
        // Cap : regard un peu en avant pour des virages lissés.
        const yaw = this.at(g, Math.min(s + 3, g.cum[g.cum.length - 1]!), this.v);
        this.at(g, s, this.v);
        this.q.setFromAxisAngle(this.up, yaw);
        this.v.y += 1.45;
        this.m.compose(this.v, this.q, this.sc.set(1, 1, 1));
        this.bodies.setMatrixAt(k, this.m);
        this.v.y += 0.55;
        this.m.compose(this.v, this.q, this.sc);
        this.glass.setMatrixAt(k, this.m);
        this.c.set(g.color);
        this.bodies.setColorAt(k, this.c);
        k++;
      }
    }
    this.bodies.count = k; this.glass.count = k;
    if (k) {
      this.bodies.instanceMatrix.needsUpdate = true; this.glass.instanceMatrix.needsUpdate = true;
      if (this.bodies.instanceColor) this.bodies.instanceColor.needsUpdate = true;
    }
    this.busCount = k;
  }

  /* ------------------------------ Aperçu ------------------------------ */

  setDraft(d: BusDraftView | null): void {
    if (this.draftMesh) { this.group.remove(this.draftMesh); this.draftMesh.geometry.dispose(); this.draftMesh = null; }
    for (const r of this.rings) this.group.remove(r);
    this.rings = [];
    this.draftPoints = 0;
    if (!d) return;
    if (d.points.length >= 6) {
      this.draftMat.color.set(d.color);
      this.draftMesh = new THREE.Mesh(ribbonGeometry(d.points, 1.4, 0.35), this.draftMat);
      this.draftMesh.renderOrder = 6;
      this.group.add(this.draftMesh);
      this.draftPoints = d.points.length / 3;
    }
    d.stops.forEach((s, i) => {
      const r = new THREE.Mesh(this.ringGeo, i === d.selected ? this.ringMats.sel : s.ok ? this.ringMats.ok : this.ringMats.bad);
      r.rotation.x = -Math.PI / 2;
      const h = this.ctx.heightAt(s.x, s.z);
      r.position.set(s.x, (Number.isFinite(h) ? h : 0) + 0.6, s.z);
      r.renderOrder = 7;
      this.group.add(r);
      this.rings.push(r);
    });
  }

  /* ------------------------------ Carte ------------------------------ */

  showLayer(on: boolean): void {
    this.layerOn = on;
    if (this.layerMesh) this.layerMesh.visible = on;
    if (on && this.layer) this.rebuildLayer();
  }

  private rebuildLayer(): void {
    const l = this.layer;
    if (!l) return;
    const { cols, rows, cellSize, originX, originZ } = l;
    const nv = (cols + 1) * (rows + 1);
    let geo = this.layerMesh?.geometry as THREE.BufferGeometry | undefined;
    if (!geo || geo.getAttribute('position').count !== nv) {
      geo?.dispose();
      geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(nv * 4), 4));
      const idx = new Uint32Array(cols * rows * 6);
      let p = 0;
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1;
        idx[p++] = a; idx[p++] = c; idx[p++] = b; idx[p++] = b; idx[p++] = c; idx[p++] = d;
      }
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      if (!this.layerMesh) { this.layerMesh = new THREE.Mesh(geo, this.layerMat); this.layerMesh.frustumCulled = false; this.layerMesh.renderOrder = 5; this.group.add(this.layerMesh); }
      else this.layerMesh.geometry = geo;
    }
    this.layerMesh!.visible = this.layerOn;
    const pos = geo.getAttribute('position') as THREE.BufferAttribute, col = geo.getAttribute('color') as THREE.BufferAttribute;
    const cell = (i: number, j: number): number => (i < 0 || j < 0 || i >= cols || j >= rows ? 0 : l.quality[j * cols + i]!);
    let shown = 0;
    for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
      const v = Math.max(cell(i - 1, j - 1), cell(i, j - 1), cell(i - 1, j), cell(i, j));
      const x = originX + i * cellSize, z = originZ + j * cellSize;
      const h = this.ctx.heightAt(x, z);
      const k = j * (cols + 1) + i;
      pos.setXYZ(k, x, (Number.isFinite(h) ? h : 0) + 1.5, z);
      if (v === 0) col.setXYZW(k, 0, 0, 0, 0);
      else if (v === 1) col.setXYZW(k, 0.92, 0.3, 0.22, 0.5); // occupé, sans arrêt à moins de 400 m
      else { const q = (v - 2) / 253; col.setXYZW(k, 0.15 + 0.2 * (1 - q), 0.55 + 0.35 * q, 0.95 - 0.5 * q, 0.45 + 0.35 * q); }
      if (v) shown++;
    }
    pos.needsUpdate = true; col.needsUpdate = true;
    this.layerCells = shown;
  }

  get lineCount(): number { return this.lines.length; }
  get stopCount(): number { return this.stops.length; }

  dispose(): void {
    this.setGeometry([]); this.setDraft(null);
    this.ctx.scene.remove(this.group);
    for (const im of [this.poles, this.signs, this.disks, this.bodies, this.glass]) { im.geometry.dispose(); (im.material as THREE.Material).dispose(); im.dispose(); }
    this.layerMesh?.geometry.dispose(); this.layerMat.dispose(); this.draftMat.dispose(); this.ringGeo.dispose();
    for (const m of Object.values(this.ringMats)) m.dispose();
  }
}

let scene: BusScene | null = null;
let wantedDraft: BusDraftView | null = null;
let wantedLayer = false;

/** Aperçu de la ligne en cours de tracé (interface) ; null l'efface. */
export function setBusDraft(d: BusDraftView | null): void { wantedDraft = d; scene?.setDraft(d); }
/** Carte « Transports en commun » (menu Calques) ; `layer` = données renvoyées par la commande `calque`. */
export function setBusLayer(on: boolean, layer?: BusLayer | null): void {
  wantedLayer = on;
  if (scene && layer) scene.layer = layer;
  scene?.showLayer(on);
}
export const busLayerOn = (): boolean => wantedLayer;

export function createBusRenderPlugin(): RenderPlugin {
  return {
    id: 'bus',
    init(ctx) {
      scene = new BusScene(ctx);
      scene.setDraft(wantedDraft);
      scene.showLayer(wantedLayer);
      // Diagnostic e2e (lecture seule).
      (window as unknown as { __busRender?: unknown }).__busRender = {
        lines: () => scene?.lineCount ?? 0, stops: () => scene?.stopCount ?? 0, buses: () => scene?.busCount ?? 0,
        draftPoints: () => scene?.draftPoints ?? 0, layerCells: () => scene?.layerCells ?? 0, phys: () => scene?.phys ?? 0,
      };
    },
    applySnapshotExt(p) { scene?.apply(p as BusDelta | undefined, true); },
    applyDeltaExt(p) { scene?.apply(p as BusDelta, false); },
    frame(dt) { scene?.frame(dt); },
    dispose() { scene?.dispose(); scene = null; },
  };
}

export const busRenderPlugin = createBusRenderPlugin();
