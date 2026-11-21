/**
 * Intérieur d'un commerce ou d'un logement, en 3D : sol carrelé ou parquet, murs (coupés automatiquement du côté
 * de la caméra), vitrine et porte sur la façade (+z), trottoir et rue devant, mobilier, réserve au fond.
 * Grille de cases de 1 m : la case (x, z) a son centre en (x + 0.5 − W/2, z + 0.5 − D/2). Fournit les collisions
 * (meubles, murs) et, en mode aménagement, la grille, le fantôme du meuble à poser et la surbrillance.
 * Dépend de three.
 */
import * as THREE from 'three';
import { FURNITURE_BY_ID } from '../sim/catalog';
import { doorCells, footprint, type PlacedItem, type Rot } from '../sim/layout';
import { Collider, type Rect } from '../world/collide';
import { buildFurniture, furnitureSize } from './furniture3d';
import { box, disposeOwn, mat, textPlane } from './kit';

export const WALL_H = 3.2;

export interface InteriorItem extends PlacedItem { fill: number; colors: string[]; products?: string[] }
export interface InteriorOpts { gridW: number; gridD: number; floor: 'carrelage' | 'parquet'; wall: string; accent: string; title: string; facade: string }

interface WallGroup { g: THREE.Group; n: [number, number]; d: number }

export class InteriorView {
  readonly scene = new THREE.Scene();
  readonly W: number;
  readonly D: number;
  collider!: Collider;
  /** Occupation pour la marche (les tapis ne gênent pas) : 0 libre, sinon uid + 1. */
  walk!: Int32Array;
  private readonly furniture = new THREE.Group();
  private readonly itemObjs = new Map<number, { obj: THREE.Group; key: string }>();
  private readonly walls: WallGroup[] = [];
  private readonly grid: THREE.LineSegments;
  private ghost: THREE.Group | null = null;
  private ghostKey = '';
  private readonly highlight: THREE.Mesh;
  items: InteriorItem[] = [];
  readonly sun: THREE.DirectionalLight;

  constructor(readonly opts: InteriorOpts) {
    this.W = opts.gridW; this.D = opts.gridD;
    const W = this.W, D = this.D;
    this.scene.background = new THREE.Color(0x1b2129);
    this.scene.add(new THREE.HemisphereLight(0xfff6ea, 0x4a4036, 1.6));
    const sun = new THREE.DirectionalLight(0xfff0dc, 1.6);
    sun.position.set(-W * 0.4, 12, D * 0.9);
    sun.target.position.set(0, 0, 0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const s = Math.max(W, D) / 2 + 3;
    Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 40 });
    sun.shadow.bias = -0.0008;
    this.sun = sun;
    this.scene.add(sun, sun.target);

    // Sol intérieur, trottoir et rue devant la vitrine, sol sombre autour.
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: floorTexture(opts.floor, W, D), roughness: opts.floor === 'carrelage' ? 0.35 : 0.6 }));
    floor.receiveShadow = true;
    this.scene.add(floor);
    const walkway = box(this.scene, W + 8, 0.12, 3, 0, -0.12, D / 2 + 1.6, mat('#b9b4aa', { rough: 0.9 }), false);
    walkway.receiveShadow = true;
    box(this.scene, W + 30, 0.02, 14, 0, -0.16, D / 2 + 10, mat('#3b3f45', { rough: 0.95 }), false);
    box(this.scene, W + 30, 0.02, 0.2, 0, -0.14, D / 2 + 10, mat('#d8d8d0'), false);
    box(this.scene, W + 60, 0.01, D + 60, 0, -0.2, 0, mat('#151a20'), false);

    // Murs : fond, gauche, droite (pleins), façade (vitrines et porte).
    const wallM = mat(opts.wall, { rough: 0.9 }), base = mat('#5a5048');
    const mk = (n: [number, number], d: number): THREE.Group => { const g = new THREE.Group(); this.scene.add(g); this.walls.push({ g, n, d }); return g; };
    const back = mk([0, -1], D / 2);
    box(back, W + 0.4, WALL_H, 0.2, 0, 0, -D / 2 - 0.1, wallM);
    box(back, W, 0.12, 0.04, 0, 0, -D / 2 + 0.02, base, false);
    box(back, 1.0, 2.2, 0.06, W / 2 - 1.2, 0, -D / 2 + 0.03, mat('#8a6a4a'), false);
    const sign = textPlane(opts.title, 0.55, opts.accent, '#ffffff', W * 0.7);
    sign.position.set(-0.4, 2.45, -D / 2 + 0.04);
    back.add(sign);
    const left = mk([-1, 0], W / 2);
    box(left, 0.2, WALL_H, D, -W / 2 - 0.1, 0, 0, wallM);
    const right = mk([1, 0], W / 2);
    box(right, 0.2, WALL_H, D, W / 2 + 0.1, 0, 0, wallM);
    const front = mk([0, 1], D / 2);
    const [dl, dr] = this.doorSpan();
    const glass = mat('#a9d4ea', { opacity: 0.28, rough: 0.05 }), frame = mat('#2c3036', { metal: 0.5, rough: 0.4 }), facade = mat(opts.facade, { rough: 0.85 });
    for (const [a, b] of [[-W / 2 - 0.2, dl], [dr, W / 2 + 0.2]] as const) {
      const cx = (a + b) / 2, len = b - a;
      box(front, len, 0.5, 0.2, cx, 0, D / 2 + 0.1, facade);
      box(front, len, 2.1, 0.06, cx, 0.5, D / 2 + 0.1, glass, false);
      box(front, len, WALL_H - 2.6, 0.2, cx, 2.6, D / 2 + 0.1, facade);
      for (let x = a + 0.05; x <= b; x += Math.max(1, len / Math.max(1, Math.round(len / 1.6)))) box(front, 0.06, 2.1, 0.12, x, 0.5, D / 2 + 0.1, frame, false);
    }
    box(front, dr - dl, WALL_H - 2.4, 0.2, (dl + dr) / 2, 2.4, D / 2 + 0.1, facade);
    box(front, 0.08, 2.4, 0.16, dl, 0, D / 2 + 0.1, frame, false);
    box(front, 0.08, 2.4, 0.16, dr, 0, D / 2 + 0.1, frame, false);
    // Paillasson.
    box(this.scene, dr - dl - 0.2, 0.01, 0.9, (dl + dr) / 2, 0, D / 2 - 0.5, mat('#3a3430', { rough: 1 }), false);

    this.scene.add(this.furniture);
    // Grille d'aménagement.
    const pts: number[] = [];
    for (let x = 0; x <= W; x++) pts.push(x - W / 2, 0.012, -D / 2, x - W / 2, 0.012, D / 2);
    for (let z = 0; z <= D; z++) pts.push(-W / 2, 0.012, z - D / 2, W / 2, 0.012, z - D / 2);
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.grid = new THREE.LineSegments(gg, new THREE.LineBasicMaterial({ color: 0x5fc3ff, transparent: true, opacity: 0.45 }));
    this.grid.visible = false;
    this.scene.add(this.grid);
    this.highlight = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.22, depthWrite: false }));
    this.highlight.visible = false;
    this.scene.add(this.highlight);
    this.setItems([]);
  }

  /** Abscisses de l'ouverture de la porte (2 cases au milieu de la façade). */
  doorSpan(): [number, number] {
    const [[x0]] = doorCells(this.W, this.D) as [[number, number]];
    return [x0 - this.W / 2, x0 + 2 - this.W / 2];
  }
  /** Point dans la rue, devant la porte (entrée et sortie). */
  outside(): [number, number] { const [a, b] = this.doorSpan(); return [(a + b) / 2, this.D / 2 + 1.6]; }
  cellCenter(x: number, z: number): [number, number] { return [x + 0.5 - this.W / 2, z + 0.5 - this.D / 2]; }
  cellAt(wx: number, wz: number): [number, number] { return [Math.floor(wx + this.W / 2), Math.floor(wz + this.D / 2)]; }
  inside(x: number, z: number): boolean { return x >= 0 && z >= 0 && x < this.W && z < this.D; }
  walkBlocked(x: number, z: number): boolean { return !this.inside(x, z) || this.walk[z * this.W + x]! > 0; }

  /** Met à jour le mobilier (ne reconstruit que les meubles modifiés : position, remplissage). */
  setItems(items: InteriorItem[]): void {
    this.items = items;
    const keep = new Set<number>();
    for (const it of items) {
      const key = `${it.def}|${it.x}|${it.z}|${it.rot}|${Math.round(it.fill * 12)}|${it.colors.join(',')}|${(it.products ?? []).join(',')}`;
      keep.add(it.uid);
      const cur = this.itemObjs.get(it.uid);
      if (cur && cur.key === key) continue;
      if (cur) { this.furniture.remove(cur.obj); disposeOwn(cur.obj); }
      const obj = buildFurniture(it.def, it.fill, it.colors, it.uid, it.products);
      this.placeObj(obj, it.def, it.x, it.z, it.rot);
      this.furniture.add(obj);
      this.itemObjs.set(it.uid, { obj, key });
    }
    for (const [uid, cur] of this.itemObjs) if (!keep.has(uid)) { this.furniture.remove(cur.obj); disposeOwn(cur.obj); this.itemObjs.delete(uid); }
    this.rebuildCollision();
  }

  private placeObj(obj: THREE.Object3D, def: string, x: number, z: number, rot: Rot): void {
    const f = rotSize(def, rot);
    obj.position.set(x + f.w / 2 - this.W / 2, 0, z + f.d / 2 - this.D / 2);
    obj.rotation.y = (rot * Math.PI) / 2;
  }

  private rebuildCollision(): void {
    const W = this.W, D = this.D;
    this.walk = new Int32Array(W * D);
    const rects: Rect[] = [];
    for (const it of this.items) {
      if (it.def === 'tapis') continue;
      const f = rotSize(it.def, it.rot);
      for (let z = it.z; z < it.z + f.d; z++) for (let x = it.x; x < it.x + f.w; x++) if (this.inside(x, z)) this.walk[z * W + x] = it.uid + 1;
      const [cx, cz] = [it.x - W / 2, it.z - D / 2];
      rects.push({ minX: cx + 0.08, maxX: cx + f.w - 0.08, minZ: cz + 0.08, maxZ: cz + f.d - 0.08, h: 2 });
    }
    const [dl, dr] = this.doorSpan();
    const t = 0.3;
    rects.push({ minX: -W / 2 - t, maxX: W / 2 + t, minZ: -D / 2 - t, maxZ: -D / 2, h: 3 });
    rects.push({ minX: -W / 2 - t, maxX: -W / 2, minZ: -D / 2, maxZ: D / 2 + 0.2, h: 3 });
    rects.push({ minX: W / 2, maxX: W / 2 + t, minZ: -D / 2, maxZ: D / 2 + 0.2, h: 3 });
    rects.push({ minX: -W / 2 - t, maxX: dl, minZ: D / 2, maxZ: D / 2 + 0.2, h: 3 });
    rects.push({ minX: dr, maxX: W / 2 + t, minZ: D / 2, maxZ: D / 2 + 0.2, h: 3 });
    this.collider = new Collider(rects, { minX: -W / 2 - 3, maxX: W / 2 + 3, minZ: -D / 2 - 0.5, maxZ: D / 2 + 3 });
  }

  /** Murs du côté de la caméra abaissés (vue en coupe), en douceur. */
  updateCutaway(cam: THREE.Camera, dt: number): void {
    for (const w of this.walls) {
      const outside = cam.position.x * w.n[0] + cam.position.z * w.n[1] > w.d + 0.2;
      const target = outside ? 0.06 : 1;
      w.g.scale.y += (target - w.g.scale.y) * Math.min(1, dt * 8);
    }
  }

  /* ------------------------------ Mode aménagement ------------------------------ */

  setBuildMode(on: boolean): void { this.grid.visible = on; if (!on) { this.setGhost(null); this.setHighlight(null); } }

  /** Fantôme du meuble à poser (vert : possible, rouge : impossible), ou null. */
  setGhost(g: { def: string; x: number; z: number; rot: Rot; ok: boolean } | null): void {
    if (!g) { if (this.ghost) { this.scene.remove(this.ghost); this.ghost = null; this.ghostKey = ''; } return; }
    const key = `${g.def}|${g.ok}`;
    if (!this.ghost || this.ghostKey !== key) {
      if (this.ghost) this.scene.remove(this.ghost);
      const obj = buildFurniture(g.def, 0.6, ['#ffffff'], 1);
      const m = new THREE.MeshBasicMaterial({ color: g.ok ? 0x5cc77a : 0xef6b6b, transparent: true, opacity: 0.5, depthWrite: false });
      obj.traverse((c) => { const me = c as THREE.Mesh; if (me.isMesh) { me.material = m; me.castShadow = false; } });
      const f = furnitureSize(g.def);
      const pad = new THREE.Mesh(new THREE.PlaneGeometry(f.w, f.d).rotateX(-Math.PI / 2), m);
      pad.position.y = 0.02;
      obj.add(pad);
      this.ghost = obj;
      this.ghostKey = key;
      this.scene.add(obj);
    }
    this.placeObj(this.ghost, g.def, g.x, g.z, g.rot);
  }

  /** Surbrillance d'un meuble posé (uid) ou null. */
  setHighlight(uid: number | null): void {
    const it = uid === null ? undefined : this.items.find((i) => i.uid === uid);
    this.highlight.visible = !!it;
    if (!it) return;
    const f = rotSize(it.def, it.rot);
    this.highlight.scale.set(f.w + 0.08, 2.2, f.d + 0.08);
    this.highlight.position.set(it.x + f.w / 2 - this.W / 2, 1.1, it.z + f.d / 2 - this.D / 2);
  }

  /** Meuble posé sur une case (uid) ou null. */
  itemAtCell(x: number, z: number): InteriorItem | null {
    for (const it of this.items) {
      const f = rotSize(it.def, it.rot);
      if (x >= it.x && x < it.x + f.w && z >= it.z && z < it.z + f.d) return it;
    }
    return null;
  }

  dispose(): void {
    this.scene.traverse((c) => {
      const me = c as THREE.Mesh;
      if (me.isMesh || (c as THREE.LineSegments).isLineSegments) {
        if (me.geometry && !me.geometry.userData['shared'] && (me.geometry.type === 'PlaneGeometry' || me.geometry.type === 'BufferGeometry')) me.geometry.dispose();
      }
    });
    disposeOwn(this.scene);
  }
}

/** Emprise d'un meuble (catalogue du magasin ou du logement) selon la rotation. */
export function rotSize(def: string, rot: Rot): { w: number; d: number } {
  const f = FURNITURE_BY_ID.get(def);
  if (f) return footprint(f, rot);
  const s = furnitureSize(def);
  return rot % 2 ? { w: s.d, d: s.w } : s;
}

/** Texture du sol : carreaux de 1 m à joints clairs, ou lames de parquet. */
function floorTexture(kind: 'carrelage' | 'parquet', W: number, D: number): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d')!;
  if (kind === 'carrelage') {
    g.fillStyle = '#e9e5de'; g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#dcd6cc'; g.fillRect(0, 0, 64, 64); g.fillRect(64, 64, 64, 64);
    g.strokeStyle = '#c4bdb2'; g.lineWidth = 3; g.strokeRect(0, 0, 128, 128); g.strokeRect(0, 0, 64, 64); g.strokeRect(64, 64, 64, 64);
  } else {
    for (let k = 0; k < 8; k++) {
      g.fillStyle = ['#b8875a', '#a87a50', '#c09062', '#9e7048'][k % 4]!;
      g.fillRect(0, k * 16, 128, 16);
      g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, k * 16, 128, 1.5);
      g.fillRect(((k * 53) % 128), k * 16, 1.5, 16);
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(W, D);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
