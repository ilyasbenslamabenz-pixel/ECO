/**
 * Aperçus 3D des outils (Three.js) :
 *  - GhostPreview   : fantôme du VRAI modèle GLB du catalogue (variante comprise), teinté
 *                     vert/orange/rouge selon la réponse dryRun de la simulation, avec dalle
 *                     d'empreinte au sol et flèche de façade ;
 *  - RoadPreview    : ruban de chaussée qui épouse le relief, à la largeur du type de route,
 *                     marqueurs de départ / point de courbure / accrochage ;
 *  - SelectionMarker: contour au sol + équerres verticales (sélection ou cible du bulldozer) ;
 *  - GridPreview    : rues d'un quadrillage (outil Routes › Quadrillage) et coins de l'îlot ;
 *  - flèches de sens (RoadPreview, outil Améliorer : sens unique, inversion).
 * Les géométries ne sont reconstruites que quand l'aperçu change (pas d'allocation par image).
 * Propriétaire : agent construction/caméra/UI.
 */
import * as THREE from 'three';
import type { CatalogAsset } from '../shared/catalog';
import { TILE_SIZE } from '../shared/constants';
import { rotateQuarter } from '../shared/math';
import type { Validity } from '../client/tools/machine';
import { localFacade } from '../client/tools/snapping';
import { footprintObb, obbCorners, obbToWorld, rotAngle } from '../shared/footprint';

export interface ModelSource { load(assetId: string, lod?: number): Promise<THREE.Group> }
export type HeightFn = (x: number, z: number) => number;

export const COLORS = {
  ok: new THREE.Color(0x4fd18b),
  pending: new THREE.Color(0xe8b65a),
  error: new THREE.Color(0xff5a5a),
  select: new THREE.Color(0x5ab0e8),
  snap: new THREE.Color(0xffe08a),
};

const colorOf = (v: Validity): THREE.Color => (v === 'ok' ? COLORS.ok : v === 'error' ? COLORS.error : COLORS.pending);

/**
 * Ruban posé sur le terrain le long d'une polyligne (x,z), largeur `width`.
 * Écrit dans `geo` (réutilisée), échantillonné tous les `step` m.
 */
export function buildGroundRibbon(geo: THREE.BufferGeometry, pts: readonly number[], width: number, heightAt: HeightFn, lift: number, step = 2, closed = false): void {
  const samples: number[] = [];
  const n = pts.length / 2;
  const seg = closed ? n : n - 1;
  for (let k = 0; k < seg; k++) {
    const ax = pts[2 * k]!; const az = pts[2 * k + 1]!;
    const b = (k + 1) % n;
    const bx = pts[2 * b]!; const bz = pts[2 * b + 1]!;
    const len = Math.hypot(bx - ax, bz - az);
    const m = Math.max(1, Math.ceil(len / step));
    for (let i = 0; i < m; i++) samples.push(ax + ((bx - ax) * i) / m, az + ((bz - az) * i) / m);
  }
  if (closed) samples.push(pts[0]!, pts[1]!); else samples.push(pts[2 * (n - 1)]!, pts[2 * (n - 1) + 1]!);
  const count = samples.length / 2;
  const pos = new Float32Array(count * 2 * 3);
  const idx: number[] = [];
  for (let i = 0; i < count; i++) {
    const x = samples[2 * i]!; const z = samples[2 * i + 1]!;
    const pi = Math.max(0, i - 1); const ni = Math.min(count - 1, i + 1);
    let tx = samples[2 * ni]! - samples[2 * pi]!; let tz = samples[2 * ni + 1]! - samples[2 * pi + 1]!;
    const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    const nx = -tz * (width / 2); const nz = tx * (width / 2);
    const lx = x + nx; const lz = z + nz; const rx = x - nx; const rz = z - nz;
    pos.set([lx, heightAt(lx, lz) + lift, lz, rx, heightAt(rx, rz) + lift, rz], i * 6);
    if (i < count - 1) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
}

function overlayMaterial(opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color: COLORS.ok, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
}

/* ------------------------------------------------------------------ */

interface GhostModel { root: THREE.Group; materials: THREE.MeshStandardMaterial[]; baseColors: THREE.Color[]; matNames: string[] }

export class GhostPreview {
  readonly group = new THREE.Group();
  private models = new Map<string, Promise<GhostModel | null>>();
  private current: GhostModel | null = null;
  private currentId = '';
  private plate = new THREE.Mesh(new THREE.BufferGeometry(), overlayMaterial(0.28));
  private border = new THREE.Mesh(new THREE.BufferGeometry(), overlayMaterial(0.9));
  private arrow = new THREE.Mesh(new THREE.BufferGeometry(), overlayMaterial(0.9));
  private t = 0;
  /** Vrai quand le modèle demandé est chargé et visible (diagnostic e2e). */
  modelVisible = false;

  constructor(scene: THREE.Scene, private models_: ModelSource, private heightAt: HeightFn) {
    this.group.name = 'ghost-preview';
    this.plate.renderOrder = 10; this.border.renderOrder = 11; this.arrow.renderOrder = 11;
    this.group.add(this.plate, this.border, this.arrow);
    this.group.visible = false;
    scene.add(this.group);
  }

  private loadGhost(asset: CatalogAsset): Promise<GhostModel | null> {
    let p = this.models.get(asset.id);
    if (!p) {
      p = this.models_.load(asset.id, 0).then((src) => {
        const root = src.clone(true);
        const materials: THREE.MeshStandardMaterial[] = [];
        const baseColors: THREE.Color[] = [];
        const matNames: string[] = [];
        root.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          m.castShadow = false; m.receiveShadow = false;
          const mats = (Array.isArray(m.material) ? m.material : [m.material]).map((orig) => {
            const c = (orig as THREE.MeshStandardMaterial).isMeshStandardMaterial ? (orig as THREE.MeshStandardMaterial).clone() : new THREE.MeshStandardMaterial({ color: 0xcccccc });
            c.transparent = true; c.opacity = 0.78; c.depthWrite = true;
            c.emissive = new THREE.Color(0, 0, 0); c.emissiveIntensity = 1;
            materials.push(c); baseColors.push(c.color.clone()); matNames.push(orig.name);
            return c;
          });
          m.material = Array.isArray(m.material) ? mats : mats[0]!;
          m.renderOrder = 5;
        });
        return { root, materials, baseColors, matNames };
      }).catch((e: unknown) => { console.error(`Fantôme : modèle ${asset.id} indisponible`, e); return null; });
      this.models.set(asset.id, p);
    }
    return p;
  }

  hide(): void { this.group.visible = false; }

  show(asset: CatalogAsset, x: number, y: number, z: number, rot: number, variant: number, validity: Validity): void {
    this.group.visible = true;
    this.lastY = y;
    const tint = colorOf(validity);
    // Dalle d'empreinte : rectangle ORIENTÉ, identique à celui que la simulation occupera.
    const o = footprintObb(asset.footprint.tilesX, asset.footprint.tilesZ, x, z, rot);
    const [p0x, p0z] = obbToWorld(o, 0, -o.hz);
    const [p1x, p1z] = obbToWorld(o, 0, o.hz);
    buildGroundRibbon(this.plate.geometry, [p0x, p0z, p1x, p1z], o.hx * 2, this.heightAt, 0.12, 2);
    buildGroundRibbon(this.border.geometry, obbCorners(o), 0.5, this.heightAt, 0.16, 2, true);
    // Flèche de façade (côté rue).
    const [lx, lz] = localFacade(asset);
    const fx = lx * o.c + lz * o.s, fz = -lx * o.s + lz * o.c;
    const depth = Math.abs(lx) > 0 ? o.hx : o.hz;
    const ax = x + fx * (depth + 1.5); const az = z + fz * (depth + 1.5);
    buildGroundRibbon(this.arrow.geometry, [ax - fx * 1.2, az - fz * 1.2, ax + fx * 1.6, az + fz * 1.6], 2.4, this.heightAt, 0.2, 1);
    for (const m of [this.plate, this.border, this.arrow]) (m.material as THREE.MeshBasicMaterial).color.copy(tint);

    if (this.currentId !== asset.id) {
      if (this.current) this.group.remove(this.current.root);
      this.current = null; this.currentId = asset.id; this.modelVisible = false;
      const want = asset.id;
      void this.loadGhost(asset).then((g) => {
        if (!g || this.currentId !== want) return;
        this.current = g;
        this.group.add(g.root);
        this.modelVisible = true;
        this.applyModel(asset, this.lastX, this.lastZ, this.lastRot, this.lastVariant, this.lastValidity);
      });
    }
    this.lastX = x; this.lastZ = z; this.lastRot = rot; this.lastVariant = variant; this.lastValidity = validity;
    this.applyModel(asset, x, z, rot, variant, validity);
  }

  private lastX = 0; private lastY = 0; private lastZ = 0; private lastRot = 0; private lastVariant = -1; private lastValidity: Validity = 'pending';

  private applyModel(asset: CatalogAsset, x: number, z: number, rot: number, variant: number, validity: Validity): void {
    const g = this.current;
    if (!g) return;
    const v = variant >= 0 ? asset.variants[variant] : undefined;
    // Altitude : même règle que la simulation (moyenne des coins de l'empreinte).
    g.root.position.set(x, this.lastY, z);
    g.root.rotation.set(0, rotAngle(rot), 0);
    g.root.scale.set(1, v?.heightScale ?? 1, 1);
    const tint = colorOf(validity);
    for (let i = 0; i < g.materials.length; i++) {
      const m = g.materials[i]!;
      const over = v?.materialOverrides?.[g.matNames[i] ?? ''];
      m.color.copy(g.baseColors[i]!);
      if (over?.color) m.color.multiply(new THREE.Color(over.color));
      m.emissive.copy(tint).multiplyScalar(validity === 'ok' ? 0.3 : 0.45);
    }
  }

  update(dt: number): void {
    if (!this.group.visible) return;
    this.t += dt;
    const pulse = 0.22 + 0.1 * Math.sin(this.t * 4);
    (this.plate.material as THREE.MeshBasicMaterial).opacity = pulse;
  }

  dispose(): void { this.group.removeFromParent(); }
}

/* ------------------------------------------------------------------ */

export class RoadPreview {
  readonly group = new THREE.Group();
  private ribbon = new THREE.Mesh(new THREE.BufferGeometry(), overlayMaterial(0.45));
  private center = new THREE.Mesh(new THREE.BufferGeometry(), overlayMaterial(0.95));
  private markers: THREE.Mesh[] = [];
  private ctrlLine = new THREE.Mesh(new THREE.BufferGeometry(), overlayMaterial(0.6));
  /** Guide d'aimantation : droite d'alignement (axe de la route, perpendiculaire, 45°…) depuis le départ. */
  private guide = new THREE.Mesh(new THREE.BufferGeometry(), overlayMaterial(0.55));
  /** Chevrons de sens de circulation (outil Améliorer). */
  private arrows = new THREE.Mesh(new THREE.BufferGeometry(), overlayMaterial(0.95));

  constructor(scene: THREE.Scene, private heightAt: HeightFn) {
    this.group.name = 'road-preview';
    this.ribbon.renderOrder = 10; this.center.renderOrder = 11; this.ctrlLine.renderOrder = 11; this.guide.renderOrder = 11;
    (this.guide.material as THREE.MeshBasicMaterial).color.copy(COLORS.snap);
    this.arrows.renderOrder = 12;
    (this.arrows.material as THREE.MeshBasicMaterial).color.set(0xffffff);
    this.group.add(this.ribbon, this.center, this.ctrlLine, this.guide, this.arrows);
    const ring = new THREE.RingGeometry(2.2, 3.2, 40).rotateX(-Math.PI / 2);
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(ring, overlayMaterial(0.95));
      m.renderOrder = 12;
      this.markers.push(m);
      this.group.add(m);
    }
    this.group.visible = false;
    scene.add(this.group);
  }

  hide(): void { this.group.visible = false; }

  show(o: { points: number[] | null; width: number; validity: Validity; start: { x: number; z: number } | null; control: { x: number; z: number } | null; hover: { x: number; z: number; snap: string; guide?: { x0: number; z0: number; x1: number; z1: number } } | null; arrows?: boolean; path?: number[] }): void {
    this.group.visible = true;
    this.arrows.visible = !!o.arrows && !!o.points && o.points.length >= 4;
    if (this.arrows.visible && o.points) this.buildArrows(o.points, o.width);
    const g = o.hover?.guide;
    this.guide.visible = !!g;
    if (g) {
      // Tirets de 4 m (guide discret, distinct de l'aperçu de chaussée).
      const L = Math.hypot(g.x1 - g.x0, g.z1 - g.z0), ux = (g.x1 - g.x0) / L, uz = (g.z1 - g.z0) / L;
      const pos: number[] = [], idx: number[] = [];
      const w = 0.22;
      for (let d = 0; d + 2.5 <= L; d += 4) {
        const ax = g.x0 + ux * d, az = g.z0 + uz * d, bx = ax + ux * 2.5, bz = az + uz * 2.5;
        const i = pos.length / 3;
        for (const [x, z, sgn] of [[ax, az, -1], [ax, az, 1], [bx, bz, 1], [bx, bz, -1]] as const) {
          const px = x - uz * w * sgn, pz = z + ux * w * sgn;
          pos.push(px, this.heightAt(px, pz) + 0.45, pz);
        }
        idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
      }
      const geo = this.guide.geometry;
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setIndex(idx);
      geo.computeBoundingSphere();
    }
    const tint = colorOf(o.validity);
    const hasPath = !!o.points && o.points.length >= 4;
    this.ribbon.visible = hasPath; this.center.visible = hasPath;
    if (o.points && hasPath) {
      // Hauteur imposée (▲ / ▼) : l'aperçu suit le profil 3D calculé par la simulation (rampes, viaduc, tunnel).
      const path = o.path && o.path.length >= 8 ? o.path : null;
      const h: HeightFn = path ? (x, z) => {
        let best = Infinity, y = this.heightAt(x, z);
        for (let i = 0; i + 3 < path.length; i += 4) {
          const d = (path[i]! - x) ** 2 + (path[i + 2]! - z) ** 2;
          if (d < best) { best = d; y = Math.max(path[i + 1]!, path[i + 3] === 2 ? -Infinity : this.heightAt(x, z) - 0.2); }
        }
        return y;
      } : this.heightAt;
      buildGroundRibbon(this.ribbon.geometry, o.points, o.width, h, 0.25, 2);
      buildGroundRibbon(this.center.geometry, o.points, 0.35, h, 0.3, 2);
    }
    (this.ribbon.material as THREE.MeshBasicMaterial).color.copy(tint);
    (this.center.material as THREE.MeshBasicMaterial).color.set(0xffffff);
    const pts = [o.start, o.control, o.hover];
    for (let i = 0; i < 3; i++) {
      const p = pts[i];
      const m = this.markers[i]!;
      m.visible = !!p;
      if (!p) continue;
      m.position.set(p.x, this.heightAt(p.x, p.z) + 0.4, p.z);
      const snapped = i === 2 && o.hover && o.hover.snap !== 'free';
      (m.material as THREE.MeshBasicMaterial).color.copy(i === 1 ? COLORS.select : snapped ? COLORS.snap : tint);
      m.scale.setScalar(Math.max(1, o.width / 8));
    }
    this.ctrlLine.visible = !!(o.control && o.start);
    if (o.control && o.start) {
      const pts2 = [o.start.x, o.start.z, o.control.x, o.control.z];
      if (o.hover) pts2.push(o.hover.x, o.hover.z);
      buildGroundRibbon(this.ctrlLine.geometry, pts2, 0.25, this.heightAt, 0.35, 2);
    }
  }

  /** Chevrons (pointe vers la fin de la polyligne) tous les ~14 m, à plat sur la chaussée. */
  private buildArrows(pts: readonly number[], width: number): void {
    const pos: number[] = [], idx: number[] = [];
    const size = Math.min(3.2, Math.max(1.6, width * 0.18));
    let acc = 7;
    for (let k = 0; k + 3 < pts.length; k += 2) {
      const ax = pts[k]!, az = pts[k + 1]!, bx = pts[k + 2]!, bz = pts[k + 3]!;
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 1e-6) continue;
      const ux = (bx - ax) / len, uz = (bz - az) / len, nx = -uz, nz = ux;
      for (; acc <= len; acc += 14) {
        const cx = ax + ux * acc, cz = az + uz * acc;
        // Chevron : deux bras de largeur 0,5 m.
        for (const sg of [-1, 1]) {
          const tipX = cx + ux * size, tipZ = cz + uz * size;
          const bX = cx + nx * size * sg, bZ = cz + nz * size * sg;
          const i = pos.length / 3, w = 0.28;
          for (const [x, z] of [[tipX - nx * w * sg, tipZ - nz * w * sg], [tipX + nx * w * sg, tipZ + nz * w * sg], [bX + ux * w, bZ + uz * w], [bX - ux * w, bZ - uz * w]] as const) {
            pos.push(x, this.heightAt(x, z) + 0.5, z);
          }
          idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
        }
      }
      acc -= len;
    }
    const geo = this.arrows.geometry;
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
  }

  dispose(): void { this.group.removeFromParent(); }
}

/* ------------------------------------------------------------------ */

/** Aperçu d'un quadrillage : une bande par rue (pool de maillages réutilisés) et marqueurs de coins. */
export class GridPreview {
  readonly group = new THREE.Group();
  private ribbons: THREE.Mesh[] = [];
  private outline = new THREE.Mesh(new THREE.BufferGeometry(), overlayMaterial(0.9));
  private corners: THREE.Mesh[] = [];
  private key = '';

  constructor(private scene: THREE.Scene, private heightAt: HeightFn) {
    this.group.name = 'grid-preview';
    this.outline.renderOrder = 11;
    (this.outline.material as THREE.MeshBasicMaterial).color.copy(COLORS.snap);
    this.group.add(this.outline);
    const ring = new THREE.RingGeometry(2.2, 3.4, 32).rotateX(-Math.PI / 2);
    for (let i = 0; i < 2; i++) {
      const m = new THREE.Mesh(ring, overlayMaterial(0.95));
      m.renderOrder = 12;
      (m.material as THREE.MeshBasicMaterial).color.copy(COLORS.snap);
      this.corners.push(m);
      this.group.add(m);
    }
    this.group.visible = false;
    scene.add(this.group);
  }

  hide(): void { this.group.visible = false; }

  show(o: { start: { x: number; z: number } | null; hover: { x: number; z: number } | null; lines: readonly (readonly number[])[]; rect: readonly number[] | null; width: number; validity: Validity }): void {
    this.group.visible = true;
    const tint = colorOf(o.validity);
    const key = `${o.width}|${o.lines.map((l) => l.join(',')).join(';')}`;
    if (key !== this.key) {
      this.key = key;
      while (this.ribbons.length < o.lines.length) {
        const m = new THREE.Mesh(new THREE.BufferGeometry(), overlayMaterial(0.45));
        m.renderOrder = 10;
        this.ribbons.push(m);
        this.group.add(m);
      }
      this.ribbons.forEach((m, i) => {
        const l = o.lines[i];
        m.visible = !!l;
        if (l) buildGroundRibbon(m.geometry, l, o.width, this.heightAt, 0.25, 3);
      });
      this.outline.visible = !!o.rect;
      if (o.rect) {
        buildGroundRibbon(this.outline.geometry, [...o.rect], 0.5, this.heightAt, 0.35, 3, true);
      }
    }
    for (const m of this.ribbons) (m.material as THREE.MeshBasicMaterial).color.copy(tint);
    const pts = [o.start, o.hover];
    for (let i = 0; i < 2; i++) {
      const p = pts[i], m = this.corners[i]!;
      m.visible = !!p;
      if (p) m.position.set(p.x, this.heightAt(p.x, p.z) + 0.4, p.z);
    }
  }

  dispose(): void { this.group.removeFromParent(); for (const m of this.ribbons) m.geometry.dispose(); void this.scene; }
}

/* ------------------------------------------------------------------ */

export class SelectionMarker {
  readonly group = new THREE.Group();
  private outline = new THREE.Mesh(new THREE.BufferGeometry(), overlayMaterial(0.95));
  private fill = new THREE.Mesh(new THREE.BufferGeometry(), overlayMaterial(0.16));
  private posts: THREE.Mesh[] = [];
  private t = 0;

  constructor(scene: THREE.Scene, private heightAt: HeightFn, color: THREE.Color = COLORS.select) {
    this.group.name = 'selection-marker';
    this.outline.renderOrder = 11; this.fill.renderOrder = 10;
    (this.outline.material as THREE.MeshBasicMaterial).color.copy(color);
    (this.fill.material as THREE.MeshBasicMaterial).color.copy(color);
    this.group.add(this.outline, this.fill);
    const post = new THREE.BoxGeometry(0.35, 1, 0.35).translate(0, 0.5, 0);
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(post, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false }));
      this.posts.push(m); this.group.add(m);
    }
    this.group.visible = false;
    scene.add(this.group);
  }

  setColor(c: THREE.Color): void {
    (this.outline.material as THREE.MeshBasicMaterial).color.copy(c);
    (this.fill.material as THREE.MeshBasicMaterial).color.copy(c);
    for (const p of this.posts) (p.material as THREE.MeshBasicMaterial).color.copy(c);
  }

  hide(): void { this.group.visible = false; }

  /** Encadre un rectangle au sol avec des montants de hauteur `height`. */
  showRect(minX: number, minZ: number, maxX: number, maxZ: number, height: number): void {
    this.group.visible = true;
    const m = 0.8;
    const pts = [minX - m, minZ - m, maxX + m, minZ - m, maxX + m, maxZ + m, minX - m, maxZ + m];
    buildGroundRibbon(this.outline.geometry, pts, 0.7, this.heightAt, 0.2, 2, true);
    buildGroundRibbon(this.fill.geometry, [(minX + maxX) / 2, minZ, (minX + maxX) / 2, maxZ], maxX - minX, this.heightAt, 0.15, 2);
    const corners = [[minX - m, minZ - m], [maxX + m, minZ - m], [maxX + m, maxZ + m], [minX - m, maxZ + m]];
    for (let i = 0; i < 4; i++) {
      const [x, z] = corners[i]!;
      const p = this.posts[i]!;
      p.visible = true;
      p.position.set(x!, this.heightAt(x!, z!), z!);
      p.scale.set(1, Math.max(2, height + 2), 1);
    }
  }

  /** Surligne un tronçon de route. */
  showPath(points: number[], width: number): void {
    this.group.visible = true;
    buildGroundRibbon(this.outline.geometry, points, width + 1.2, this.heightAt, 0.35, 2);
    this.fill.geometry.setIndex([]);
    for (const p of this.posts) p.visible = false;
  }

  /** Anneau autour d'un point (véhicule). */
  showPoint(x: number, z: number, radius: number): void {
    this.group.visible = true;
    const pts: number[] = [];
    for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; pts.push(x + Math.cos(a) * radius, z + Math.sin(a) * radius); }
    buildGroundRibbon(this.outline.geometry, pts, 0.5, this.heightAt, 0.3, 1, true);
    this.fill.geometry.setIndex([]);
    for (const p of this.posts) p.visible = false;
  }

  update(dt: number): void {
    if (!this.group.visible) return;
    this.t += dt;
    (this.outline.material as THREE.MeshBasicMaterial).opacity = 0.7 + 0.25 * Math.sin(this.t * 5);
  }

  dispose(): void { this.group.removeFromParent(); }
}
