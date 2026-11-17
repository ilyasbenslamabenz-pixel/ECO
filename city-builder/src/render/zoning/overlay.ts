/**
 * Zonage — superposition colorée des cases zonées au sol.
 *
 * Coût minimal (mode allégé iPhone compris) : UN seul maillage instancié (InstancedBufferGeometry, 4 sommets
 * par case) et un petit shader. Chaque instance porte le centre de la case, sa direction, la hauteur du terrain à ses
 * quatre coins (la case épouse la pente) et sa couleur ; le shader dessine un liseré plus opaque et des hachures sur
 * les cases non desservies. Pas d'ombre, pas d'écriture de profondeur, pas de texture. Le maillage n'est
 * visible qu'avec l'outil Zones ; les hauteurs sont relues à chaque ouverture de l'outil (terrassement).
 *
 * Cases dans la TRAME DES ROUTES (comme le quadrillage au sol, src/shared/grid-field.ts) : la donnée sauvegardée
 * reste la grille du monde (src/sim/zoning/grid.ts) ; une case de la trame est dessinée, avec la zone de la case du
 * monde qui contient son centre (règle commune avec la peinture et la croissance de la simulation). Les anciennes
 * parties s'affichent donc alignées sur les routes, sans conversion de la sauvegarde.
 */
import * as THREE from 'three';
import { CELL_CONNECTED, ZONE_COLORS, ZONE_COUNT, zoneOf } from '../../shared/protocol-ext/zonage';
import type { GridField } from '../../shared/grid-field';
import type { ZoningChange, ZoningView } from '../../client/zoning-view';

const LIFT = 0.18;
const INITIAL_CAPACITY = 1024;

const VERT = /* glsl */ `
attribute vec2 corner;
attribute vec2 iPos;
attribute vec2 iAxis;
attribute vec4 iH;
attribute vec4 iCol;
uniform float uCell;
varying vec2 vUv;
varying vec4 vCol;
void main() {
  vUv = corner;
  vCol = iCol;
  float h = mix(mix(iH.x, iH.y, corner.x), mix(iH.w, iH.z, corner.x), corner.y);
  vec2 N = vec2(-iAxis.y, iAxis.x);
  vec2 q = iPos + ((corner.x - 0.5) * iAxis + (corner.y - 0.5) * N) * uCell;
  vec3 p = vec3(q.x, h, q.y);
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
  private axis!: THREE.InstancedBufferAttribute;
  private hts!: THREE.InstancedBufferAttribute;
  private col!: THREE.InstancedBufferAttribute;
  private capacity = 0;
  private count = 0;
  /** Case de la trame (clé) -> emplacement d'instance ; emplacement -> clé ; case du monde -> cases de la trame. */
  private readonly slotOf = new Map<string, number>();
  private cellOf: string[] = [];
  private readonly keysOf = new Map<number, string[]>();
  /** Champ utilisé pour les cases (null : cases du monde). */
  private field: GridField | null = null;
  /** Routes ou bâtiments modifiés depuis la dernière reconstruction. */
  private fieldStale = false;
  private fieldTimer: ReturnType<typeof setTimeout> | null = null;
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
    for (let c = 1; c <= ZONE_COUNT; c++) this.colors.set(c, new THREE.Color(ZONE_COLORS[zoneOf(c)!]));
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
    const old = this.capacity ? { pos: this.pos, axis: this.axis, hts: this.hts, col: this.col } : null;
    this.capacity = cap;
    this.pos = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2);
    this.axis = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2);
    this.hts = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    this.col = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    for (const a of [this.pos, this.axis, this.hts, this.col]) a.setUsage(THREE.DynamicDrawUsage);
    if (old) {
      (this.pos.array as Float32Array).set(old.pos.array as Float32Array);
      (this.axis.array as Float32Array).set(old.axis.array as Float32Array);
      (this.hts.array as Float32Array).set(old.hts.array as Float32Array);
      (this.col.array as Float32Array).set(old.col.array as Float32Array);
    }
    this.geo.setAttribute('iPos', this.pos);
    this.geo.setAttribute('iAxis', this.axis);
    this.geo.setAttribute('iH', this.hts);
    this.geo.setAttribute('iCol', this.col);
  }

  private onChange(c: ZoningChange): void {
    if (c.kind === 'all') { this.rebuild(); return; }
    if (c.kind === 'cells') {
      // (cases du monde : pas de reconstruction sur le champ de trames)
      const seen = new Set<number>();
      for (let k = 0; k + 1 < c.cells.length; k += 2) {
        const w = c.cells[k]!;
        if (seen.has(w)) continue;
        seen.add(w);
        this.removeWorld(w);
        this.addWorld(w);
      }
      this.commit();
      return;
    }
    if (c.kind === 'field') {
      // Routes / bâtiments modifiés : la trame a pu changer (reconstruction regroupée, outil ouvert seulement).
      this.fieldStale = true;
      if (this.view.toolActive && !this.fieldTimer) this.fieldTimer = setTimeout(() => { this.fieldTimer = null; if (this.view.toolActive) this.rebuild(); }, 300);
      return;
    }
    if (c.kind === 'tool') {
      if (this.view.toolActive) {
        this.heightsStale = true;
        if (this.fieldStale || (!this.field && this.view.field)) this.rebuild();
      }
      this.syncVisible();
    }
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
    this.keysOf.clear();
    this.cellOf = [];
    this.count = 0;
    this.field = null; // Cases du monde (carrés de 8 m identiques partout, choix du joueur)
    this.fieldStale = false;
    const codes = this.view.codes;
    for (let i = 0; i < codes.length; i++) if (codes[i]! & 15) this.addWorld(i);
    this.commit();
  }

  /** Index de la case du monde contenant (x, z), -1 hors grille. */
  private worldIndex(x: number, z: number): number {
    const g = this.view.grid!;
    const i = Math.floor((x - g.originX) / g.cell), j = Math.floor((z - g.originZ) / g.cell);
    return i < 0 || j < 0 || i >= g.w || j >= g.h ? -1 : j * g.w + i;
  }

  /**
   * Cases de la trame dont le centre est dans la case du monde `w` (zonée) : échantillons de `w`, case de la trame
   * qui les contient, gardée si son centre est dans `w` et si la trame y est la même (pas de case à cheval sur deux
   * trames, aux carrefours). Sans champ : la case du monde elle-même.
   */
  private addWorld(w: number): void {
    const g = this.view.grid;
    if (!g) return;
    const code = this.view.codes[w] ?? 0;
    if (!(code & 15)) return;
    const s = g.cell;
    const x0 = g.originX + (w % g.w) * s, z0 = g.originZ + Math.floor(w / g.w) * s;
    const f = this.field;
    const keys: string[] = [];
    if (!f) {
      const key = `w${w}`;
      this.addQuad(key, x0 + s / 2, z0 + s / 2, 1, 0, s, code);
      keys.push(key);
    } else {
      const L = f.linesAt(x0 + s / 2, z0 + s / 2);
      const off = [0.0625, 0.5, 0.9375];
      for (const a of off) for (const b of off) {
        const c = f.ownCell(f.cellAt(x0 + a * s, z0 + b * s, L));
        if (!c || this.worldIndex(c.cx, c.cz) !== w) continue;
        const key = `${c.cx.toFixed(2)},${c.cz.toFixed(2)}`;
        if (keys.includes(key) || this.slotOf.has(key)) continue;
        this.addQuad(key, c.cx, c.cz, c.tx, c.tz, f.cell, code);
        keys.push(key);
      }
    }
    if (keys.length) this.keysOf.set(w, keys);
  }

  private removeWorld(w: number): void {
    const keys = this.keysOf.get(w);
    if (!keys) return;
    this.keysOf.delete(w);
    for (const key of keys) {
      const slot = this.slotOf.get(key);
      if (slot === undefined) continue;
      // Retrait : la dernière instance prend la place libérée.
      const last = this.count - 1;
      if (slot !== last) {
        const moved = this.cellOf[last]!;
        const P = this.pos.array as Float32Array, A = this.axis.array as Float32Array, H = this.hts.array as Float32Array, C = this.col.array as Float32Array;
        P.copyWithin(slot * 2, last * 2, last * 2 + 2);
        A.copyWithin(slot * 2, last * 2, last * 2 + 2);
        H.copyWithin(slot * 4, last * 4, last * 4 + 4);
        C.copyWithin(slot * 4, last * 4, last * 4 + 4);
        this.cellOf[slot] = moved;
        this.slotOf.set(moved, slot);
      }
      this.slotOf.delete(key);
      this.cellOf.length = last;
      this.count = last;
    }
  }

  private addQuad(key: string, cx: number, cz: number, tx: number, tz: number, size: number, code: number): void {
    if (this.count >= this.capacity) this.grow(this.capacity * 2);
    const slot = this.count++;
    this.slotOf.set(key, slot);
    this.cellOf[slot] = key;
    (this.pos.array as Float32Array).set([cx, cz], slot * 2);
    (this.axis.array as Float32Array).set([tx, tz], slot * 2);
    this.writeHeights(slot, cx, cz, tx, tz, size);
    const c = this.colors.get(code & 15) ?? this.colors.get(1)!;
    (this.col.array as Float32Array).set([c.r, c.g, c.b, code & CELL_CONNECTED ? 1 : 0], slot * 4);
  }

  /** Hauteurs du terrain aux quatre coins (légèrement rentrés) d'une case de centre (cx, cz), direction (tx, tz). */
  private writeHeights(slot: number, cx: number, cz: number, tx: number, tz: number, s: number): void {
    const r = s * 0.47;
    const h = (a: number, b: number): number => { const v = this.heightAt(cx + (a * tx - b * tz) * r, cz + (a * tz + b * tx) * r); return (Number.isFinite(v) ? v : 0) + LIFT; };
    (this.hts.array as Float32Array).set([h(-1, -1), h(1, -1), h(1, 1), h(-1, 1)], slot * 4);
  }

  private refreshHeights(): void {
    const g = this.view.grid;
    if (!g) return;
    const P = this.pos.array as Float32Array, A = this.axis.array as Float32Array;
    for (let slot = 0; slot < this.count; slot++) this.writeHeights(slot, P[slot * 2]!, P[slot * 2 + 1]!, A[slot * 2]!, A[slot * 2 + 1]!, g.cell);
    this.hts.needsUpdate = true;
  }

  private commit(): void {
    this.geo.instanceCount = this.count;
    this.pos.needsUpdate = true;
    this.axis.needsUpdate = true;
    this.hts.needsUpdate = true;
    this.col.needsUpdate = true;
    const g = this.view.grid;
    if (g) this.mesh.material.uniforms['uCell']!.value = g.cell * 0.94;
    this.syncVisible();
  }

  /** Lignes des cases dessinées en (x, z) (diagnostic e2e) : trame du champ, ou cases du monde. */
  cellFrameAt(x: number, z: number): { tx: number; tz: number; pu: number; pv: number; kind: string } {
    const f = this.field ?? this.view.field;
    if (!f) return { tx: 1, tz: 0, pu: 0, pv: 0, kind: 'monde' };
    const L = f.linesAt(x, z);
    return { tx: L.tx, tz: L.tz, pu: L.pu, pv: L.pv, kind: L.kind };
  }

  dispose(): void {
    if (this.fieldTimer) clearTimeout(this.fieldTimer);
    this.unsub?.();
    this.scene.remove(this.mesh);
    this.scene.remove(this.ring);
    this.ring.geometry.dispose();
    this.ring.material.dispose();
    this.geo.dispose();
    this.mesh.material.dispose();
  }
}
