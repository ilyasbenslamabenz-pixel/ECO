/**
 * Intérieur d'un commerce ou d'un logement, en 3D : sol carrelé ou parquet, murs (coupés automatiquement du côté
 * de la caméra), vitrine et porte sur la façade (+z), trottoir et rue devant, mobilier, réserve au fond.
 * Ambiance propre à chaque type de commerce (motif et teintes du sol, soubassement des murs, décor mural au-dessus
 * de 2 m : étagères garnies, cadres, ardoise, miroir, horloge, appliques) et éclairage intérieur chaud. Revêtements
 * de sol et de murs choisis par le joueur (remplacent ceux du type) et saleté visible au sol selon la propreté.
 * Grille de cases de 1 m : la case (x, z) a son centre en (x + 0.5 − W/2, z + 0.5 − D/2). Fournit les collisions
 * (meubles, murs) et, en mode aménagement, la grille, le fantôme du meuble à poser et la surbrillance.
 * Dépend de three.
 */
import * as THREE from 'three';
import { FURNITURE_BY_ID } from '../sim/catalog';
import { doorCells, footprint, type PlacedItem, type Rot } from '../sim/layout';
import { Collider, type Rect } from '../world/collide';
import type { ShopType } from '../sim/catalog';
import { assets } from '../assets';
import { buildFurniture, furnitureSize } from './furniture3d';
import { box, cyl, disposeOwn, hashRand, mat, textPlane } from './kit';

export const WALL_H = 3.2;

export interface InteriorItem extends PlacedItem { fill: number; colors: string[]; products?: string[] }
/** Type d'intérieur : commerce ou logement (ambiance, décor mural). */
export type InteriorKind = ShopType | 'logement';
/**
 * `kind` (facultatif) : type d'intérieur ; à défaut, il est déduit de la couleur des murs (styles de main.ts) ou du
 * titre (« Chez moi »), sinon ambiance neutre selon `floor`.
 */
export interface InteriorOpts {
  gridW: number; gridD: number; floor: 'carrelage' | 'parquet'; wall: string; accent: string; title: string; facade: string; kind?: InteriorKind;
  /** Revêtements choisis (ids du catalogue FLOORINGS / WALLINGS) ; absent ou « origine » : sol et murs du type. */
  floorId?: string; wallId?: string;
}

/** Mur : groupe abaissé en vue de coupe, normale extérieure, distance au centre ; `deco` : décor mural (caché abaissé). */
interface WallGroup { g: THREE.Group; n: [number, number]; d: number; deco: THREE.Group }

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
  /** Sol, matériaux des murs intérieurs (fond, côtés), soubassement du type, voile de saleté (revêtements, propreté). */
  private readonly floorMat: THREE.MeshStandardMaterial;
  private readonly floorBase: { spec: FloorSpec; rough: number };
  private readonly wallMats: [THREE.MeshStandardMaterial, THREE.MeshStandardMaterial];
  private readonly wainscot: THREE.Object3D[] = [];
  private readonly dirt: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  private surfKey = '';
  private dirtLevel = -1;

  constructor(readonly opts: InteriorOpts) {
    this.W = opts.gridW; this.D = opts.gridD;
    const W = this.W, D = this.D;
    this.scene.background = backdrop();
    const kind = opts.kind ?? guessKind(opts);
    const theme = kind ? THEMES[kind] : null;
    // Éclairage intérieur chaud : ciel crème et sol ambré, lumière principale dorée (ombres), et deux à trois
    // lampes ponctuelles sans ombre au plafond (halo chaud sur le mobilier).
    this.scene.add(new THREE.HemisphereLight(0xfff0d8, 0x5a4434, 1.2));
    const sun = new THREE.DirectionalLight(0xffe4bf, 1.35);
    sun.position.set(-W * 0.4, 12, D * 0.9);
    sun.target.position.set(0, 0, 0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const s = Math.max(W, D) / 2 + 3;
    Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 40 });
    sun.shadow.bias = -0.0008;
    this.sun = sun;
    this.scene.add(sun, sun.target);
    const lamps = W * D > 60 ? 3 : 2;
    for (let i = 0; i < lamps; i++) {
      const pl = new THREE.PointLight(theme?.lamp ?? 0xffc98a, 5 + Math.max(W, D) * 0.6, 0, 2);
      pl.position.set(((i + 0.5) / lamps - 0.5) * W * 0.8, WALL_H - 0.3, -D * 0.12 + (i % 2 ? D * 0.18 : -D * 0.05));
      this.scene.add(pl);
    }

    // Sol intérieur, trottoir et rue devant la vitrine, sol sombre autour.
    this.floorBase = { spec: theme?.floor ?? (opts.floor === 'carrelage' ? FLOORS.carreaux : FLOORS.parquet), rough: opts.floor === 'carrelage' ? 0.35 : 0.6 };
    this.floorMat = new THREE.MeshStandardMaterial({ map: floorTexture(this.floorBase.spec, W, D), roughness: this.floorBase.rough });
    this.floorMat.userData['own'] = true;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2), this.floorMat);
    floor.receiveShadow = true;
    this.scene.add(floor);
    // Voile de saleté (taches et traces de pas), invisible tant que le magasin est propre.
    this.dirt = new THREE.Mesh(new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: dirtTexture(W, D, this.doorSpan()), transparent: true, opacity: 0, depthWrite: false, roughness: 0.95 }));
    this.dirt.material.userData['own'] = true;
    this.dirt.position.y = 0.006;
    this.dirt.receiveShadow = true;
    this.dirt.visible = false;
    this.scene.add(this.dirt);
    // Socle sombre sous la pièce et seuil étroit devant la porte (plus de grand trottoir ni de fond noir).
    box(this.scene, W + 0.8, 0.35, D + 0.8, 0, -0.36, 0, mat('#232a35', { rough: 0.9 }), false);
    const [sl, sr] = this.doorSpan();
    box(this.scene, sr - sl + 1.2, 0.08, 2.2, (sl + sr) / 2, -0.09, D / 2 + 1.2, mat('#3a4250', { rough: 0.9 }), false);

    // Murs : fond, gauche, droite (pleins), façade (vitrines et porte).
    // Murs intérieurs : matériaux propres à cet intérieur (revêtement choisi : texture répétée tous les mètres).
    const wallMat = (): THREE.MeshStandardMaterial => { const m = new THREE.MeshStandardMaterial({ color: opts.wall, roughness: 0.9 }); m.userData['own'] = true; return m; };
    this.wallMats = [wallMat(), wallMat()];
    const [wallB, wallS] = this.wallMats, base = mat('#5a5048');
    const mk = (n: [number, number], d: number): THREE.Group => { const g = new THREE.Group(), deco = new THREE.Group(); g.add(deco); this.scene.add(g); this.walls.push({ g, n, d, deco }); return g; };
    const back = mk([0, -1], D / 2);
    box(back, W + 0.4, WALL_H, 0.2, 0, 0, -D / 2 - 0.1, wallB);
    box(back, W, 0.12, 0.04, 0, 0, -D / 2 + 0.02, base, false);
    box(back, 1.0, 2.2, 0.06, W / 2 - 1.2, 0, -D / 2 + 0.03, mat('#8a6a4a'), false);
    const sign = textPlane(opts.title, 0.55, opts.accent, '#ffffff', W * 0.7);
    sign.position.set(-0.4, 2.45, -D / 2 + 0.04);
    back.add(sign);
    const left = mk([-1, 0], W / 2);
    box(left, 0.2, WALL_H, D, -W / 2 - 0.1, 0, 0, wallS);
    box(left, 0.04, 0.12, D, -W / 2 + 0.02, 0, 0, base, false);
    const right = mk([1, 0], W / 2);
    box(right, 0.2, WALL_H, D, W / 2 + 0.1, 0, 0, wallS);
    box(right, 0.04, 0.12, D, W / 2 - 0.02, 0, 0, base, false);
    if (theme) this.decorate(theme, kind!, sign);
    const front = mk([0, 1], D / 2);
    const [dl, dr] = this.doorSpan();
    // Façade basse (vue dégagée sur la boutique) : allège de 0,9 m avec une tablette, cadre de porte.
    const frame = mat('#2c3036', { metal: 0.5, rough: 0.4 }), facade = mat(opts.facade, { rough: 0.85 });
    for (const [a, b] of [[-W / 2 - 0.2, dl], [dr, W / 2 + 0.2]] as const) {
      const cx = (a + b) / 2, len = b - a;
      box(front, len, 0.9, 0.2, cx, 0, D / 2 + 0.1, facade);
      box(front, len + 0.04, 0.06, 0.3, cx, 0.9, D / 2 + 0.1, frame, false);
    }
    box(front, 0.1, 0.96, 0.24, dl, 0, D / 2 + 0.1, frame, false);
    box(front, 0.1, 0.96, 0.24, dr, 0, D / 2 + 0.1, frame, false);
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
    this.setSurfaces(opts.floorId, opts.wallId);
  }

  /**
   * Revêtements de sol et de murs (ids du catalogue) : remplacent le sol et les murs du type d'intérieur (le
   * soubassement du type disparaît sous un revêtement mural). « origine » ou absent : rendu du type.
   */
  setSurfaces(floorId = 'origine', wallId = 'origine'): void {
    const key = `${floorId}|${wallId}`;
    if (key === this.surfKey) return;
    this.surfKey = key;
    const fs = FLOOR_SURF[floorId];
    this.floorMat.map?.dispose();
    this.floorMat.map = floorTexture(fs?.spec ?? this.floorBase.spec, this.W, this.D);
    this.floorMat.roughness = fs?.rough ?? this.floorBase.rough;
    this.floorMat.needsUpdate = true;
    const ws = WALL_SURF[wallId];
    this.wallMats.forEach((m, k) => {
      m.map?.dispose();
      m.map = ws ? wallTexture(ws, k === 0 ? this.W + 0.4 : this.D) : null;
      m.color.set(ws ? '#ffffff' : this.opts.wall);
      m.roughness = ws?.rough ?? 0.9;
      m.needsUpdate = true;
    });
    for (const o of this.wainscot) o.visible = !ws;
  }

  /** Saleté visible selon la propreté (0..100) : sol terni puis taches et traces de pas sous 85 %. */
  setDirt(clean: number): void {
    const d = Math.round(Math.max(0, Math.min(1, (85 - clean) / 85)) * 20) / 20;
    if (d === this.dirtLevel) return;
    this.dirtLevel = d;
    this.dirt.visible = d > 0;
    this.dirt.material.opacity = 0.95 * Math.sqrt(d);
    this.floorMat.color.set('#ffffff').lerp(DIRT_TINT, 0.5 * d);
  }

  /**
   * Ambiance du type d'intérieur : soubassement (lambris ou carrelage mural sur 1 m) avec cimaise, décor mural
   * au-dessus de 2,05 m (hors de portée du mobilier posé sur la grille), horloge au-dessus de la porte de la réserve,
   * appliques de part et d'autre de l'enseigne. Petits objets sans ombre, articles des étagères instanciés.
   */
  private decorate(t: Theme, kind: InteriorKind, sign: THREE.Mesh): void {
    const W = this.W, D = this.D;
    const [back, left, right] = this.walls as [WallGroup, WallGroup, WallGroup];
    const lam = mat(t.wainscot, { rough: 0.8 }), rail = mat(t.trim, { rough: 0.5 });
    // Soubassement et cimaise sur les trois murs intérieurs.
    this.wainscot.push(box(back.g, W, 1.0, 0.03, 0, 0, -D / 2 + 0.015, lam, false), box(back.g, W, 0.06, 0.06, 0, 1.0, -D / 2 + 0.03, rail, false));
    for (const [w, sx] of [[left, -1], [right, 1]] as const) {
      this.wainscot.push(box(w.g, 0.03, 1.0, D, sx * (W / 2 - 0.015), 0, 0, lam, false), box(w.g, 0.06, 0.06, D, sx * (W / 2 - 0.03), 1.0, 0, rail, false));
    }
    const r = hashRand(W * 31 + D * 7 + kind.length);
    /** Pose un élément (face avant +z) contre un mur, à l'abscisse u le long du mur et à la hauteur y. */
    const at = (w: WallGroup, u: number, y: number, o: THREE.Object3D): void => {
      if (w === back) o.position.set(u, y, -D / 2 + 0.03);
      else if (w === left) { o.position.set(-W / 2 + 0.03, y, u); o.rotation.y = Math.PI / 2; }
      else { o.position.set(W / 2 - 0.03, y, u); o.rotation.y = -Math.PI / 2; }
      o.traverse((c) => { if ((c as THREE.Mesh).isMesh) { c.castShadow = false; c.receiveShadow = false; } });
      w.deco.add(o);
    };
    // Mur du fond : horloge au-dessus de la porte de la réserve, appliques de part et d'autre de l'enseigne.
    at(back, W / 2 - 1.2, 2.32, clock());
    const sw = (sign.geometry as THREE.PlaneGeometry).parameters.width;
    for (const x of [sign.position.x - sw / 2 - 0.4, sign.position.x + sw / 2 + 0.4]) if (x > -W / 2 + 0.4 && x < W / 2 - 1.85) at(back, x, 2.25, sconce(t.lamp));
    // Murs latéraux : suite d'éléments propres au type (décalée d'un mur à l'autre), espacés d'au moins 1,6 m,
    // jamais tout près de la façade.
    const u0 = -D / 2 + 0.9, u1 = D / 2 - 1.7;
    const n = Math.max(1, Math.floor((u1 - u0) / 1.6) + 1);
    const step = n > 1 ? (u1 - u0) / (n - 1) : 0;
    [left, right].forEach((w, side) => {
      for (let i = 0; i < n; i++) {
        const spec = t.wall[(i + side * 2) % t.wall.length]!;
        const o = wallItem(spec, kind, r);
        if (o) at(w, n > 1 ? u0 + i * step : (u0 + u1) / 2, spec.startsWith('sconce') ? 2.25 : 2.12, o);
      }
    });
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
      w.deco.visible = w.g.scale.y > 0.7;
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

/* ------------------------------ Ambiances ------------------------------ */

/** Motif du sol (texture répétée tous les mètres) : couleurs [a, b, joint ou ombre]. */
interface FloorSpec { pattern: 'carreaux' | 'damier' | 'tomettes' | 'lames' | 'chevrons' | 'lino' | 'marbre' | 'dalles'; c: string[] }
const FLOORS = {
  carreaux: { pattern: 'carreaux', c: ['#e9e5de', '#dcd6cc', '#c4bdb2'] },
  parquet: { pattern: 'lames', c: ['#b8875a', '#a87a50', '#c09062', '#9e7048'] },
} satisfies Record<string, FloorSpec>;

/**
 * Ambiance d'un type d'intérieur : sol, soubassement et cimaise, teinte des lampes, décor des murs latéraux
 * (« etagere:<modèles> », « cadre », « applique », « ardoise:<titre> », « miroir », « menu »).
 */
interface Theme { floor: FloorSpec; wainscot: string; trim: string; lamp: number; wall: string[] }
const THEMES: Record<InteriorKind, Theme> = {
  epicerie: {
    floor: { pattern: 'carreaux', c: ['#eef0ea', '#dfe6dc', '#c3cbbf'] }, wainscot: '#8fb89a', trim: '#5f8a6c', lamp: 0xfff0d0,
    wall: ['etagere:food-can,food-soda-can,food-bottle-oil,food-can-small', 'applique', 'ardoise:Offres du jour', 'applique', 'etagere:food-carton,food-honey,food-bag,food-peanut-butter'],
  },
  cafe: {
    floor: { pattern: 'lames', c: ['#7a5236', '#6a4630', '#83593b', '#5f3f2a'] }, wainscot: '#5c3d2a', trim: '#3e2a1d', lamp: 0xffb873,
    wall: ['cadre', 'applique', 'etagere:food-cup-coffee,food-mug,food-cup-saucer,food-cup-tea', 'applique', 'ardoise:Menu café'],
  },
  vetements: {
    floor: { pattern: 'chevrons', c: ['#d9c09a', '#cdb289', '#e2caa6', '#b99c74'] }, wainscot: '#f4f1f6', trim: '#b9acc9', lamp: 0xfff1e0,
    wall: ['miroir', 'applique', 'cadre', 'etagere:', 'applique'],
  },
  fleuriste: {
    floor: { pattern: 'lames', c: ['#d8cdb8', '#cfc2aa', '#e0d6c3', '#c4b79e'] }, wainscot: '#a9c7a0', trim: '#6f9a66', lamp: 0xfff0d6,
    wall: ['etagere:plantSmall1,plantSmall2,plantSmall3', 'cadre', 'applique', 'etagere:nat-flower_redA,nat-flower_yellowA,nat-flower_purpleA'],
  },
  boulangerie: {
    floor: { pattern: 'chevrons', c: ['#c99a62', '#b98a55', '#d4a870', '#a87a48'] }, wainscot: '#e7cfa6', trim: '#9a6b3e', lamp: 0xffc27a,
    wall: ['etagere:food-loaf,food-loaf-round,food-loaf-baguette,food-croissant', 'applique', 'ardoise:Pains du jour', 'applique'],
  },
  fastfood: {
    floor: { pattern: 'damier', c: ['#f1eee8', '#30343b', '#c9c4bb'] }, wainscot: '#d64b3c', trim: '#f2c84a', lamp: 0xffe2b0,
    wall: ['menu', 'applique', 'etagere:food-soda,food-fries,food-burger,food-soda-can', 'cadre', 'applique'],
  },
  primeur: {
    floor: { pattern: 'tomettes', c: ['#c9774e', '#b8673f', '#e8d6c4'] }, wainscot: '#8a6a48', trim: '#5e4630', lamp: 0xffd49a,
    wall: ['etagere:food-apple,food-orange,food-pear,food-lemon', 'ardoise:Prix au kilo', 'applique', 'etagere:food-carrot,food-broccoli,food-cabbage,food-onion'],
  },
  logement: {
    floor: FLOORS.parquet, wainscot: '#d9cdbd', trim: '#9a876f', lamp: 0xffc98a,
    wall: ['cadre', 'applique', 'etagere:books,plantSmall2,books', 'cadre', 'applique'],
  },
};
/** Couleurs des murs de main.ts (INTERIOR_STYLE, logement) → type, quand l'appelant ne le précise pas. */
const WALL_KIND: Record<string, InteriorKind> = {
  '#e6efe3': 'epicerie', '#efe2cf': 'cafe', '#ece8f2': 'vetements', '#e9f2e4': 'fleuriste', '#f6e6cc': 'boulangerie',
  '#f6dcd5': 'fastfood', '#e2eed6': 'primeur', '#e9e1d6': 'logement',
};
function guessKind(o: InteriorOpts): InteriorKind | null {
  if (o.title.startsWith('Chez moi')) return 'logement';
  return WALL_KIND[o.wall.toLowerCase()] ?? null;
}

/** Textures de sol, partagées entre intérieurs (même motif) ; la répétition est propre à chaque sol (clone). */
const floorCache = new Map<FloorSpec, THREE.CanvasTexture>();
function floorTexture(f: FloorSpec, W: number, D: number): THREE.CanvasTexture {
  let base = floorCache.get(f);
  if (!base) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const g = cv.getContext('2d')!;
    const [a, b, j] = f.c as [string, string, string];
    if (f.pattern === 'carreaux' || f.pattern === 'damier') {
      // Carreaux de 50 cm (damier contrasté pour le fast-food), joints fins.
      g.fillStyle = a; g.fillRect(0, 0, 128, 128);
      g.fillStyle = b; g.fillRect(0, 0, 64, 64); g.fillRect(64, 64, 64, 64);
      g.strokeStyle = j; g.lineWidth = f.pattern === 'damier' ? 1.5 : 3; g.strokeRect(0, 0, 128, 128); g.strokeRect(0, 0, 64, 64); g.strokeRect(64, 64, 64, 64);
    } else if (f.pattern === 'tomettes') {
      // Tomettes de terre cuite (carrés de 25 cm, teintes variées), joints clairs.
      g.fillStyle = j; g.fillRect(0, 0, 128, 128);
      const rr = hashRand(5);
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { g.fillStyle = rr() < 0.5 ? a : b; g.globalAlpha = 0.85 + rr() * 0.15; g.fillRect(x * 32 + 1.5, y * 32 + 1.5, 29, 29); }
      g.globalAlpha = 1;
    } else if (f.pattern === 'lino') {
      // Lino moucheté : fond uni, mouchetures claires et sombres, lé de 1 m marqué d'un trait fin.
      g.fillStyle = a; g.fillRect(0, 0, 128, 128);
      const rr = hashRand(11);
      for (let k = 0; k < 420; k++) { g.fillStyle = rr() < 0.5 ? b : j; g.globalAlpha = 0.35 + rr() * 0.4; g.fillRect(rr() * 128, rr() * 128, 1.5 + rr() * 2, 1.5 + rr() * 2); }
      g.globalAlpha = 0.25; g.fillStyle = j; g.fillRect(0, 0, 128, 1);
      g.globalAlpha = 1;
    } else if (f.pattern === 'dalles') {
      // Grandes dalles d'un mètre, légèrement nuancées, joint fin.
      const gr = g.createLinearGradient(0, 0, 128, 128); gr.addColorStop(0, a); gr.addColorStop(1, b);
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
      g.strokeStyle = j; g.lineWidth = 2; g.strokeRect(0, 0, 128, 128);
    } else if (f.pattern === 'marbre') {
      // Marbre poli : dalles de 50 cm, veines sinueuses grises, joint très fin.
      g.fillStyle = a; g.fillRect(0, 0, 128, 128);
      g.fillStyle = b; g.globalAlpha = 0.5; g.fillRect(0, 0, 64, 64); g.fillRect(64, 64, 64, 64); g.globalAlpha = 1;
      const rr = hashRand(23);
      g.strokeStyle = j; g.lineCap = 'round';
      for (let k = 0; k < 7; k++) {
        g.globalAlpha = 0.25 + rr() * 0.35; g.lineWidth = 0.6 + rr() * 1.4;
        g.beginPath(); let x = rr() * 128, y = 0; g.moveTo(x, y);
        while (y < 128) { const nx = x + (rr() - 0.5) * 28, ny = y + 10 + rr() * 16; g.quadraticCurveTo((x + nx) / 2 + (rr() - 0.5) * 14, (y + ny) / 2, nx, ny); x = nx; y = ny; }
        g.stroke();
      }
      g.globalAlpha = 0.5; g.lineWidth = 1; g.strokeRect(0, 0, 128, 128); g.strokeRect(0, 0, 64, 64); g.strokeRect(64, 64, 64, 64);
      g.globalAlpha = 1;
    } else if (f.pattern === 'chevrons') {
      // Bâtons rompus : lames de 12,5 × 50 cm alternées à 90°.
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
        g.fillStyle = f.c[(x + y * 3) % f.c.length]!;
        g.fillRect(x * 32, y * 32, 32, 32);
        g.fillStyle = 'rgba(0,0,0,0.16)';
        for (let k = 1; k < 4; k++) { if ((x + y) % 2) g.fillRect(x * 32 + k * 8, y * 32, 1.2, 32); else g.fillRect(x * 32, y * 32 + k * 8, 32, 1.2); }
        g.fillRect(x * 32, y * 32, 32, 1.2); g.fillRect(x * 32, y * 32, 1.2, 32);
      }
    } else {
      for (let k = 0; k < 8; k++) {
        g.fillStyle = f.c[k % f.c.length]!;
        g.fillRect(0, k * 16, 128, 16);
        g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, k * 16, 128, 1.5);
        g.fillRect(((k * 53) % 128), k * 16, 1.5, 16);
      }
    }
    base = new THREE.CanvasTexture(cv);
    base.wrapS = base.wrapT = THREE.RepeatWrapping;
    base.colorSpace = THREE.SRGBColorSpace;
    base.anisotropy = 8;
    floorCache.set(f, base);
  }
  // Clone : même image (envoyée une fois au GPU), répétition propre à ce sol.
  const t = base.clone();
  t.repeat.set(W, D);
  t.needsUpdate = true;
  return t;
}

/* ------------------------------ Revêtements et saleté ------------------------------ */

/** Sols du catalogue des revêtements (ids de FLOORINGS) : motif et rugosité (« origine » : sol du type). */
const FLOOR_SURF: Record<string, { spec: FloorSpec; rough: number }> = {
  lino: { spec: { pattern: 'lino', c: ['#a9bdb1', '#e4ece6', '#5f6f66'] }, rough: 0.55 },
  carrelage: { spec: { pattern: 'dalles', c: ['#f1eee8', '#e2ddd3', '#bdb6aa'] }, rough: 0.3 },
  chene: { spec: { pattern: 'lames', c: ['#c08a55', '#b07c4a', '#c99760', '#a87444'] }, rough: 0.5 },
  marbre: { spec: { pattern: 'marbre', c: ['#f2f0ec', '#e4e1db', '#8e8a86'] }, rough: 0.15 },
};
/** Revêtements muraux (ids de WALLINGS) : motif, couleurs [fond, motif, joint], rugosité. */
interface WallSpec { pattern: 'uni' | 'papier' | 'lambris' | 'brique'; c: [string, string, string]; rough: number }
const WALL_SURF: Record<string, WallSpec> = {
  peinture: { pattern: 'uni', c: ['#f4f0e6', '#ebe6da', '#e0dace'], rough: 0.85 },
  papier: { pattern: 'papier', c: ['#cfe0ea', '#7fa6c2', '#b8cfdd'], rough: 0.8 },
  lambris: { pattern: 'lambris', c: ['#c2925f', '#b08050', '#7a5634'], rough: 0.65 },
  brique: { pattern: 'brique', c: ['#b5573a', '#9c4a31', '#d8cbb8'], rough: 0.9 },
};
const DIRT_TINT = new THREE.Color('#9c8a6c');

const wallCache = new Map<WallSpec, THREE.CanvasTexture>();
/** Texture murale (1 m par répétition) d'un mur de longueur `len` et de hauteur WALL_H. */
function wallTexture(w: WallSpec, len: number): THREE.CanvasTexture {
  let base = wallCache.get(w);
  if (!base) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const g = cv.getContext('2d')!;
    const [a, b, j] = w.c;
    g.fillStyle = a; g.fillRect(0, 0, 128, 128);
    const rr = hashRand(31);
    if (w.pattern === 'uni') {
      for (let k = 0; k < 160; k++) { g.fillStyle = rr() < 0.5 ? b : j; g.globalAlpha = 0.25; g.fillRect(rr() * 128, rr() * 128, 3, 3); }
    } else if (w.pattern === 'papier') {
      // Rayures fines et petits losanges (motif répété tous les 50 cm).
      g.fillStyle = j; for (let x = 0; x < 128; x += 32) g.fillRect(x + 14, 0, 4, 128);
      g.fillStyle = b;
      for (let y = 0; y < 2; y++) for (let x = 0; x < 4; x++) { const cx = x * 32 + 8 + (y ? 16 : 0), cy = y * 64 + 32; g.beginPath(); g.moveTo(cx, cy - 9); g.lineTo(cx + 6, cy); g.lineTo(cx, cy + 9); g.lineTo(cx - 6, cy); g.closePath(); g.fill(); }
    } else if (w.pattern === 'lambris') {
      // Lames verticales de 16 cm, rainures sombres, veinage léger.
      for (let k = 0; k < 8; k++) {
        g.fillStyle = k % 2 ? a : b; g.fillRect(k * 16, 0, 16, 128);
        g.fillStyle = j; g.globalAlpha = 0.7; g.fillRect(k * 16, 0, 1.5, 128); g.globalAlpha = 0.12;
        for (let v = 0; v < 3; v++) g.fillRect(k * 16 + 3 + rr() * 10, 0, 1, 128);
        g.globalAlpha = 1;
      }
    } else {
      // Briques de 25 × 8 cm en quinconce, joints clairs, teintes variées.
      g.fillStyle = j; g.fillRect(0, 0, 128, 128);
      const bh = 128 / 12;
      for (let r = 0; r < 12; r++) for (let x = -1; x < 4; x++) {
        g.fillStyle = rr() < 0.5 ? a : b; g.globalAlpha = 0.8 + rr() * 0.2;
        g.fillRect(x * 32 + (r % 2 ? 16 : 0) + 1.5, r * bh + 1.2, 29, bh - 2.4);
      }
      g.globalAlpha = 1;
    }
    g.globalAlpha = 1;
    base = new THREE.CanvasTexture(cv);
    base.wrapS = base.wrapT = THREE.RepeatWrapping;
    base.colorSpace = THREE.SRGBColorSpace;
    base.anisotropy = 4;
    wallCache.set(w, base);
  }
  const t = base.clone();
  t.repeat.set(len, WALL_H);
  t.needsUpdate = true;
  return t;
}

/**
 * Voile de saleté de tout le sol (un seul canevas, non répété) : taches brunes éparses, plus nombreuses près de la
 * porte et le long de l'allée centrale, et traces de pas depuis l'entrée. Transparent ailleurs.
 */
function dirtTexture(W: number, D: number, door: [number, number]): THREE.CanvasTexture {
  const px = 48, cv = document.createElement('canvas');
  cv.width = Math.max(64, Math.round(W * px)); cv.height = Math.max(64, Math.round(D * px));
  const g = cv.getContext('2d')!;
  const rr = hashRand(W * 131 + D * 17);
  const toX = (x: number): number => (x + W / 2) * px, toY = (z: number): number => (z + D / 2) * px;
  const dx = (door[0] + door[1]) / 2;
  const blot = (x: number, y: number, r: number, a: number): void => {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(78,58,36,${a})`); gr.addColorStop(0.6, `rgba(92,70,44,${a * 0.6})`); gr.addColorStop(1, 'rgba(92,70,44,0)');
    g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, r, r * (0.6 + rr() * 0.4), rr() * Math.PI, 0, Math.PI * 2); g.fill();
  };
  // Taches éparses dans toute la pièce.
  for (let k = 0; k < W * D * 0.6; k++) blot(rr() * cv.width, rr() * cv.height, px * (0.15 + rr() * 0.45), 0.25 + rr() * 0.35);
  // Zone d'entrée et allée : plus encrassées.
  for (let k = 0; k < D * 6; k++) { const z = D / 2 - rr() * D * 0.9; blot(toX(dx + (rr() - 0.5) * 2.4), toY(z), px * (0.2 + rr() * 0.5), 0.3 + rr() * 0.3); }
  // Traces de pas depuis la porte.
  g.fillStyle = 'rgba(60,44,28,0.55)';
  for (let t = 0; t < 3; t++) {
    let x = dx + (rr() - 0.5) * 1.2, z = D / 2 - 0.3;
    const ang = (rr() - 0.5) * 1.2;
    for (let s = 0; s < D * 2.2; s++) {
      const side = s % 2 ? 0.09 : -0.09;
      g.beginPath(); g.ellipse(toX(x + side), toY(z), px * 0.05, px * 0.1, ang, 0, Math.PI * 2); g.fill();
      x += Math.sin(ang) * 0.32 + (rr() - 0.5) * 0.05; z -= Math.cos(ang) * 0.32;
      if (z < -D / 2 + 0.3 || Math.abs(x) > W / 2 - 0.3) break;
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ------------------------------ Décor mural ------------------------------ */

/** Élément du décor mural (face avant +z, posé à sa base), ou null. */
function wallItem(spec: string, kind: InteriorKind, r: () => number): THREE.Object3D | null {
  const [what, arg = ''] = spec.split(':') as [string, string?];
  switch (what) {
    case 'etagere': return wallShelf(arg.split(',').filter(Boolean).map((n) => `f:${n}`), r);
    case 'cadre': return frame(Math.floor(r() * 6), kind);
    case 'applique': return sconce(THEMES[kind].lamp);
    case 'ardoise': return board(arg, kind);
    case 'miroir': return mirror();
    case 'menu': return board('MENU', kind, true);
    default: return null;
  }
}

/** Étagère murale (planche sur consoles) garnie de modèles (instanciés) ; sans modèle : piles de linge pliées. */
function wallShelf(keys: string[], r: () => number): THREE.Group {
  const g = new THREE.Group(), len = 1.3;
  box(g, len, 0.04, 0.26, 0, 0, 0.13, mat('#8a6446', { rough: 0.7 }));
  for (const x of [-len / 2 + 0.15, len / 2 - 0.15]) box(g, 0.04, 0.16, 0.2, x, -0.16, 0.1, mat('#3a3f46', { metal: 0.4 }));
  const ok = keys.filter((k) => assets.has(k));
  const n = 5;
  if (!ok.length) {
    const cols = ['#4a7fd0', '#d0603a', '#e8e2d6', '#3a3a3a', '#8a5ad0'];
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) box(g, 0.2, 0.05, 0.18, -len / 2 + 0.17 + i * 0.24, 0.04 + k * 0.055, 0.13, mat(cols[(i + k) % cols.length]!, { rough: 0.9 }), false);
    return g;
  }
  const by = new Map<string, THREE.Matrix4[]>();
  for (let i = 0; i < n; i++) {
    const k = ok[i % ok.length]!;
    if (!by.has(k)) by.set(k, []);
    by.get(k)!.push(new THREE.Matrix4().makeRotationY((r() - 0.5) * 0.6).setPosition(-len / 2 + 0.17 + i * 0.24, 0.04, 0.13));
  }
  for (const [k, ms] of by) { const im = assets.instances(k, ms, 0.2, 0.28, 0.2); if (im) { im.receiveShadow = false; g.add(im); } }
  return g;
}

/** Applique murale : modèle « lampWall » (sinon socle et globe) et globe lumineux chaud. */
function sconce(color: number): THREE.Group {
  const g = new THREE.Group();
  const o = assets.fitted('f:lampWall', 0.26, 0.36, 0.24);
  if (o) g.add(o);
  else { box(g, 0.08, 0.16, 0.05, 0, 0, 0.025, mat('#3a3f46', { metal: 0.5 })); box(g, 0.04, 0.04, 0.16, 0, 0.06, 0.1, mat('#3a3f46', { metal: 0.5 })); }
  const globe = new THREE.Mesh(GLOBE, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.15) }));
  globe.material.userData['own'] = true;
  globe.position.set(0, o ? 0.2 : 0.1, o ? 0.12 : 0.2);
  g.add(globe);
  return g;
}
const GLOBE = new THREE.SphereGeometry(0.075, 12, 8);
GLOBE.userData['shared'] = true;

/** Horloge murale (cadran, chiffres marqués, aiguilles à 10 h 10). */
function clock(): THREE.Group {
  const g = new THREE.Group();
  const rim = cyl(g, 0.52, 0.06, 0, 0, 0, mat('#2c3036', { metal: 0.4, rough: 0.4 }));
  rim.rotation.x = Math.PI / 2; rim.position.set(0, 0.26, 0.03);
  const face = cyl(g, 0.45, 0.02, 0, 0, 0, mat('#f6f2ea', { rough: 0.6 }));
  face.rotation.x = Math.PI / 2; face.position.set(0, 0.26, 0.065);
  const ink = mat('#1d2733');
  for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; const m = box(g, 0.02, k % 3 ? 0.03 : 0.05, 0.01, Math.sin(a) * 0.18, 0.26 + Math.cos(a) * 0.18, 0.075, ink, false); m.rotation.z = -a; m.position.y = 0.26 + Math.cos(a) * 0.18; }
  // Aiguilles (pivot au centre du cadran) : heures vers 10, minutes vers 2.
  for (const [len, a] of [[0.12, Math.PI / 3], [0.17, -Math.PI / 3]] as const) {
    const h = box(g, 0.022, len, 0.01, 0, 0, 0.082, ink, false);
    h.position.set((-Math.sin(a) * len) / 2, 0.26 + (Math.cos(a) * len) / 2, 0.082);
    h.rotation.z = a;
  }
  return g;
}

/** Peintures des cadres (paysages simples), partagées entre intérieurs. */
const artCache = new Map<number, THREE.Material>();
function art(k: number): THREE.Material {
  let m = artCache.get(k);
  if (m) return m;
  const cv = document.createElement('canvas');
  cv.width = 160; cv.height = 120;
  const g = cv.getContext('2d')!;
  const pal = [['#9fd0f0', '#5aa05a', '#f2c84a'], ['#f2b8a0', '#c0563a', '#fff2c8'], ['#2a3a5c', '#3a7ab0', '#f4f4f4'], ['#e8e2d6', '#d8344a', '#3f8a45'], ['#cfe6d8', '#4f9a6a', '#e07a2a'], ['#f6e6cc', '#8a5ad0', '#f2a02a']][k % 6]!;
  const gr = g.createLinearGradient(0, 0, 0, 120); gr.addColorStop(0, pal[0]!); gr.addColorStop(1, '#ffffff');
  g.fillStyle = gr; g.fillRect(0, 0, 160, 120);
  g.fillStyle = pal[2]!; g.beginPath(); g.arc(40 + (k * 23) % 80, 36, 16, 0, Math.PI * 2); g.fill();
  g.fillStyle = pal[1]!; g.beginPath(); g.moveTo(0, 120); g.lineTo(0, 80); g.quadraticCurveTo(50, 50 + k * 4, 90, 78); g.quadraticCurveTo(130, 96, 160, 70); g.lineTo(160, 120); g.fill();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 });
  artCache.set(k, m);
  return m;
}
/** Cadre (baguette de bois ou noire) et sa peinture. */
function frame(k: number, kind: InteriorKind): THREE.Group {
  const g = new THREE.Group();
  const w = 0.8 + (k % 2) * 0.2, h = 0.6;
  box(g, w, h, 0.04, 0, 0, 0.02, mat(kind === 'vetements' || kind === 'fastfood' ? '#2b2b30' : '#8a6446', { rough: 0.6 }));
  const p = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.1, h - 0.1), art(k));
  p.position.set(0, h / 2, 0.042);
  g.add(p);
  return g;
}
/** Miroir mural (cadre fin, verre clair et brillant). */
function mirror(): THREE.Group {
  const g = new THREE.Group();
  box(g, 0.7, 0.9, 0.04, 0, 0, 0.02, mat('#c9a227', { metal: 0.6, rough: 0.35 }));
  // Verre : clair et légèrement lumineux (sans carte d'environnement, un vrai métal paraîtrait noir).
  box(g, 0.6, 0.8, 0.01, 0, 0.05, 0.045, mat('#d6e8f2', { rough: 0.12, emissive: 0.25 }), false);
  box(g, 0.08, 0.6, 0.012, -0.15, 0.15, 0.046, mat('#ffffff', { opacity: 0.5 }), false);
  return g;
}

/** Lignes des ardoises et du menu, par type. */
const BOARD_LINES: Partial<Record<InteriorKind, string[]>> = {
  epicerie: ['Fruits de saison', 'Pain frais', 'Lait local'], cafe: ['Espresso', 'Cappuccino', 'Thé menthe'],
  boulangerie: ['Baguette', 'Campagne', 'Croissant'], primeur: ['Pommes', 'Carottes', 'Agrumes'],
  fastfood: ['Burger', 'Frites', 'Soda'], fleuriste: ['Roses', 'Bouquets', 'Plantes'],
};
const boardCache = new Map<string, THREE.Material>();
/** Ardoise (craie sur fond sombre, cadre bois) ou menu lumineux (fast-food). */
function board(title: string, kind: InteriorKind, lit = false): THREE.Group {
  const g = new THREE.Group();
  const w = lit ? 1.3 : 1.0, h = 0.72;
  box(g, w, h, 0.05, 0, 0, 0.025, mat(lit ? '#1d2027' : '#7a5236', { rough: 0.6 }));
  const key = `${kind}|${title}|${lit}`;
  let m = boardCache.get(key);
  if (!m) {
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 176;
    const c = cv.getContext('2d')!;
    c.fillStyle = lit ? '#14161b' : '#2f3a34'; c.fillRect(0, 0, 256, 176);
    c.fillStyle = lit ? '#f2c84a' : '#f4f1e8'; c.textAlign = 'center'; c.font = '700 30px Rubik, system-ui, sans-serif';
    c.fillText(title, 128, 38, 236);
    c.font = '500 22px Rubik, system-ui, sans-serif'; c.textAlign = 'left';
    (BOARD_LINES[kind] ?? ['Bienvenue']).forEach((l, i) => {
      c.fillStyle = lit ? '#ffffff' : 'rgba(244,241,232,0.9)';
      c.fillText(l, 22, 82 + i * 32, 150);
      c.textAlign = 'right'; c.fillStyle = lit ? '#7dffa8' : '#f2d06b'; c.fillText(`${(3 + ((i * 7 + title.length) % 6) + 0.5).toFixed(2)}`, 234, 82 + i * 32); c.textAlign = 'left';
    });
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    m = lit ? new THREE.MeshBasicMaterial({ map: tex }) : new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 });
    boardCache.set(key, m);
  }
  const p = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.1, h - 0.1), m);
  p.position.set(0, h / 2, 0.052);
  g.add(p);
  return g;
}

/** Fond dégradé sombre (bleu nuit vers violet) derrière les intérieurs. */
let backdropTex: THREE.CanvasTexture | null = null;
function backdrop(): THREE.CanvasTexture {
  if (backdropTex) return backdropTex;
  const cv = document.createElement('canvas');
  cv.width = 4; cv.height = 256;
  const g = cv.getContext('2d')!;
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#2a3a5c'); gr.addColorStop(0.55, '#1a2236'); gr.addColorStop(1, '#2a1b33');
  g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
  backdropTex = new THREE.CanvasTexture(cv);
  backdropTex.colorSpace = THREE.SRGBColorSpace;
  return backdropTex;
}
