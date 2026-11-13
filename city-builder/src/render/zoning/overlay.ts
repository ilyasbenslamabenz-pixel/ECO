/**
 * Zonage — superposition colorée des cases zonées au sol.
 *
 * Coût minimal (mode allégé iPhone compris) : UN seul maillage instancié (InstancedBufferGeometry, 4 sommets
 * par case) et un petit shader. Chaque instance porte le centre de la case, la hauteur du terrain à ses quatre
 * coins (la case épouse la pente) et sa couleur ; le shader dessine un liseré plus opaque et des hachures sur
 * les cases non desservies. Pas d'ombre, pas d'écriture de profondeur, pas de texture. Le maillage n'est
 * visible qu'avec l'outil Zones ; les hauteurs sont relues à chaque ouverture de l'outil (terrassement).
 */
import * as THREE from 'three';
import { CELL_CONNECTED, ZONE_COLORS, zoneOf } from '../../shared/protocol-ext/zonage';
import type { ZoningChange, ZoningView } from '../../client/zoning-view';

const LIFT = 0.18;
const INITIAL_CAPACITY = 1024;

const VERT = /* glsl */ `
attribute vec2 corner;
attribute vec2 iPos;
attribute vec4 iH;
attribute vec4 iCol;
uniform float uCell;
varying vec2 vUv;
varying vec4 vCol;
void main() {
  vUv = corner;
  vCol = iCol;
  float h = mix(mix(iH.x, iH.y, corner.x), mix(iH.w, iH.z, corner.x), corner.y);
  vec3 p = vec3(iPos.x + (corner.x - 0.5) * uCell, h, iPos.y + (corner.y - 0.5) * uCell);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const FRAG = /* glsl */ `
uniform float uOpacity;
varying vec2 vUv;
varying vec4 vCol;
void main() {
  vec2 e = min(vUv, 1.0 - vUv);
  float edge = 1.0 - smoothstep(0.035, 0.085, min(e.x, e.y));
  float connected = vCol.a;
  float stripes = step(0.5, fract((vUv.x + vUv.y) * 3.0));
  float fill = connected > 0.5 ? 0.36 : 0.12 + 0.2 * stripes;
  float a = mix(fill, 0.85, edge) * uOpacity;
  gl_FragColor = vec4(vCol.rgb, a);
  #include <colorspace_fragment>
}`;

export class ZoningOverlay {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private geo: THREE.InstancedBufferGeometry;
  private pos!: THREE.InstancedBufferAttribute;
  private hts!: THREE.InstancedBufferAttribute;
  private col!: THREE.InstancedBufferAttribute;
  private capacity = 0;
  private count = 0;
  /** Case -> emplacement d'instance ; emplacement -> case. */
  private readonly slotOf = new Map<number, number>();
  private cellOf: number[] = [];
  private readonly colors = new Map<number, THREE.Color>();
  private unsub: (() => void) | null = null;
  /** Hauteurs à relire avant le prochain affichage. */
  private heightsStale = true;
  /** Cercle du pinceau (48 segments, hauteurs du terrain). */
  readonly ring: THREE.LineLoop<THREE.BufferGeometry, THREE.LineBasicMaterial>;

  constructor(private readonly scene: THREE.Scene, private readonly view: ZoningView, private readonly heightAt: (x: number, z: number) => number) {
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.setAttribute('corner', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    // `position` factice : three exige l'attribut pour calculer le nombre de sommets.
    this.geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(12), 3));
    this.geo.setIndex([0, 2, 1, 0, 3, 2]);
    this.grow(INITIAL_CAPACITY);
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { uCell: { value: 8 * 0.94 }, uOpacity: { value: 1 } },
      transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.name = 'zonage';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.visible = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    for (let c = 1; c <= 6; c++) this.colors.set(c, new THREE.Color(ZONE_COLORS[zoneOf(c)!]));
    scene.add(this.mesh);
    const ringGeo = new THREE.BufferGeometry();
    ringGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(48 * 3), 3));
    this.ring = new THREE.LineLoop(ringGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false, toneMapped: false, fog: false }));
    this.ring.name = 'zonage-pinceau';
    this.ring.frustumCulled = false;
    this.ring.renderOrder = 6;
    this.ring.visible = false;
    scene.add(this.ring);
    this.unsub = view.on((c) => this.onChange(c));
    this.rebuild();
  }

  /** Nombre de cases dessinées (diagnostic e2e). */
  get instances(): number { return this.count; }

  private grow(cap: number): void {
    const old = this.capacity ? { pos: this.pos, hts: this.hts, col: this.col } : null;
    this.capacity = cap;
    this.pos = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2);
    this.hts = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    this.col = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    for (const a of [this.pos, this.hts, this.col]) a.setUsage(THREE.DynamicDrawUsage);
    if (old) {
      (this.pos.array as Float32Array).set(old.pos.array as Float32Array);
      (this.hts.array as Float32Array).set(old.hts.array as Float32Array);
      (this.col.array as Float32Array).set(old.col.array as Float32Array);
    }
    this.geo.setAttribute('iPos', this.pos);
    this.geo.setAttribute('iH', this.hts);
    this.geo.setAttribute('iCol', this.col);
  }

  private onChange(c: ZoningChange): void {
    if (c.kind === 'all') { this.rebuild(); return; }
    if (c.kind === 'cells') {
      for (let k = 0; k + 1 < c.cells.length; k += 2) this.setCell(c.cells[k]!, c.cells[k + 1]!);
      this.commit();
      return;
    }
    if (c.kind === 'tool') { if (this.view.toolActive) this.heightsStale = true; this.syncVisible(); }
    if (c.kind === 'cursor' || c.kind === 'tool') this.updateRing();
  }

  private updateRing(): void {
    const c = this.view.cursor;
    if (!c || !this.view.toolActive) { this.ring.visible = false; return; }
    const a = this.ring.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = a.array as Float32Array;
    for (let k = 0; k < 48; k++) {
      const t = (k / 48) * Math.PI * 2;
      const x = c.x + Math.cos(t) * c.r, z = c.z + Math.sin(t) * c.r;
      const h = this.heightAt(x, z);
      arr[k * 3] = x; arr[k * 3 + 1] = (Number.isFinite(h) ? h : 0) + LIFT + 0.1; arr[k * 3 + 2] = z;
    }
    a.needsUpdate = true;
    this.ring.material.color.set(this.view.brush ? ZONE_COLORS[this.view.brush] : '#ff6b6b');
    this.ring.visible = true;
  }

  private syncVisible(): void {
    if (this.view.toolActive && this.heightsStale) { this.refreshHeights(); this.heightsStale = false; }
    this.mesh.visible = this.view.toolActive && this.count > 0;
  }

  /** Reconstruit toutes les instances depuis la vue. */
  rebuild(): void {
    this.slotOf.clear();
    this.cellOf = [];
    this.count = 0;
    const codes = this.view.codes;
    for (let i = 0; i < codes.length; i++) if (codes[i]! & 15) this.setCell(i, codes[i]!);
    this.commit();
  }

  private setCell(cell: number, code: number): void {
    const g = this.view.grid;
    if (!g) return;
    const zone = code & 15;
    let slot = this.slotOf.get(cell);
    if (!zone) {
      if (slot === undefined) return;
      // Retrait : la dernière instance prend la place libérée.
      const last = this.count - 1;
      if (slot !== last) {
        const moved = this.cellOf[last]!;
        const P = this.pos.array as Float32Array, H = this.hts.array as Float32Array, C = this.col.array as Float32Array;
        P.copyWithin(slot * 2, last * 2, last * 2 + 2);
        H.copyWithin(slot * 4, last * 4, last * 4 + 4);
        C.copyWithin(slot * 4, last * 4, last * 4 + 4);
        this.cellOf[slot] = moved;
        this.slotOf.set(moved, slot);
      }
      this.slotOf.delete(cell);
      this.cellOf.length = last;
      this.count = last;
      return;
    }
    if (slot === undefined) {
      if (this.count >= this.capacity) this.grow(this.capacity * 2);
      slot = this.count++;
      this.slotOf.set(cell, slot);
      this.cellOf[slot] = cell;
      const i = cell % g.w, j = Math.floor(cell / g.w);
      const x0 = g.originX + i * g.cell, z0 = g.originZ + j * g.cell;
      (this.pos.array as Float32Array).set([x0 + g.cell / 2, z0 + g.cell / 2], slot * 2);
      this.writeHeights(slot, x0, z0, g.cell);
    }
    const c = this.colors.get(zone) ?? this.colors.get(1)!;
    (this.col.array as Float32Array).set([c.r, c.g, c.b, code & CELL_CONNECTED ? 1 : 0], slot * 4);
  }

  private writeHeights(slot: number, x0: number, z0: number, s: number): void {
    const m = s * 0.03;
    const h = (x: number, z: number): number => { const v = this.heightAt(x, z); return (Number.isFinite(v) ? v : 0) + LIFT; };
    (this.hts.array as Float32Array).set([h(x0 + m, z0 + m), h(x0 + s - m, z0 + m), h(x0 + s - m, z0 + s - m), h(x0 + m, z0 + s - m)], slot * 4);
  }

  private refreshHeights(): void {
    const g = this.view.grid;
    if (!g) return;
    for (let slot = 0; slot < this.count; slot++) {
      const cell = this.cellOf[slot]!;
      this.writeHeights(slot, g.originX + (cell % g.w) * g.cell, g.originZ + Math.floor(cell / g.w) * g.cell, g.cell);
    }
    this.hts.needsUpdate = true;
  }

  private commit(): void {
    this.geo.instanceCount = this.count;
    this.pos.needsUpdate = true;
    this.hts.needsUpdate = true;
    this.col.needsUpdate = true;
    const g = this.view.grid;
    if (g) this.mesh.material.uniforms['uCell']!.value = g.cell * 0.94;
    this.syncVisible();
  }

  dispose(): void {
    this.unsub?.();
    this.scene.remove(this.mesh);
    this.scene.remove(this.ring);
    this.ring.geometry.dispose();
    this.ring.material.dispose();
    this.geo.dispose();
    this.mesh.material.dispose();
  }
}
