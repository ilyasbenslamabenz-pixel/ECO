/**
 * Passants (ambiance) et clients (retour visuel des ventes) : silhouettes instanciées qui marchent sur les trottoirs,
 * en boucle autour des îlots. Un client part d'un point du trottoir et marche jusqu'à la porte du commerce, puis
 * entre (disparaît). Un seul appel de dessin. Dépend de three.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BLOCK, SIDEWALK_W, blockCenter, type District } from '../sim/district';

const WANDERERS = 220;
const MAX_CLIENTS = 60;
const COLORS = [0x2f5d8a, 0x8a2f3c, 0x3c7a4a, 0xc9a227, 0x6b4a8a, 0x2b2b2b, 0xd06a3a, 0x4a8a8a, 0xe0e0e0, 0x7a5a3a];

interface Walker { i: number; j: number; s: number; v: number; color: number; target: number | null; life: number }

/** Boucle de trottoir d'un îlot : rectangle de demi-côté L, paramètre s ∈ [0, 8L). */
const L = BLOCK / 2 + SIDEWALK_W / 2;
function loopPos(cx: number, cz: number, s: number): [number, number, number] {
  const p = ((s % (8 * L)) + 8 * L) % (8 * L);
  const side = Math.floor(p / (2 * L)), t = p - side * 2 * L - L;
  // 0 : bord +z (vers +x), 1 : bord +x (vers −z), 2 : bord −z (vers −x), 3 : bord −x (vers +z)
  if (side === 0) return [cx + t, cz + L, Math.PI / 2];
  if (side === 1) return [cx + L, cz - t, Math.PI];
  if (side === 2) return [cx - t, cz - L, -Math.PI / 2];
  return [cx - L, cz + t, 0];
}
/** Paramètre de boucle du point le plus proche de (x, z). */
function loopParam(cx: number, cz: number, x: number, z: number): number {
  const dx = x - cx, dz = z - cz;
  if (Math.abs(dz) >= Math.abs(dx)) return dz > 0 ? L + dx : 5 * L - dx;
  return dx > 0 ? 3 * L - dz : 7 * L + dz;
}

/** Géométrie à couleur de sommet uniforme. */
function colored(g: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const ng = g.toNonIndexed();
  const c = new THREE.Color(hex), n = ng.attributes['position']!.count;
  const a = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) { a[k * 3] = c.r; a[k * 3 + 1] = c.g; a[k * 3 + 2] = c.b; }
  ng.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return ng;
}

export class People {
  /** Torse et bras (couleur du vêtement par instance) ; `rest` : jambes, tête (couleurs fixes). */
  readonly mesh: THREE.InstancedMesh;
  private readonly rest: THREE.InstancedMesh;
  private walkers: Walker[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly c = new THREE.Color();
  private seed: number;

  constructor(private readonly d: District) {
    const torso = new THREE.BoxGeometry(0.42, 0.62, 0.24).translate(0, 1.2, 0);
    const armL = new THREE.BoxGeometry(0.1, 0.56, 0.12).translate(-0.27, 1.18, 0);
    const armR = new THREE.BoxGeometry(0.1, 0.56, 0.12).translate(0.27, 1.18, 0);
    const legL = new THREE.BoxGeometry(0.15, 0.9, 0.16).translate(-0.11, 0.45, 0);
    const legR = new THREE.BoxGeometry(0.15, 0.9, 0.16).translate(0.11, 0.45, 0);
    const head = new THREE.SphereGeometry(0.13, 10, 8).scale(1, 1.1, 1).translate(0, 1.7, 0);
    const neck = new THREE.BoxGeometry(0.1, 0.1, 0.1).translate(0, 1.55, 0);
    this.mesh = new THREE.InstancedMesh(mergeGeometries([torso.toNonIndexed(), armL.toNonIndexed(), armR.toNonIndexed()])!, new THREE.MeshStandardMaterial({ roughness: 0.8 }), WANDERERS + MAX_CLIENTS);
    this.rest = new THREE.InstancedMesh(mergeGeometries([colored(legL, 0x2a3142), colored(legR, 0x2a3142), colored(head, 0xd9a47e), colored(neck, 0xd9a47e)])!, new THREE.MeshStandardMaterial({ roughness: 0.8, vertexColors: true }), WANDERERS + MAX_CLIENTS);
    this.mesh.name = 'passants';
    for (const m of [this.mesh, this.rest]) { m.castShadow = true; m.frustumCulled = false; }
    this.mesh.add(this.rest);
    this.seed = d.seed * 7 + 3;
    for (let k = 0; k < WANDERERS; k++) this.walkers.push(this.spawn(null, -1));
  }

  private rnd(): number { this.seed = (this.seed * 16807) % 2147483647; return this.seed / 2147483647; }

  private spawn(target: { x: number; z: number } | null, blockHint: number): Walker {
    let i = Math.floor(this.rnd() * this.d.nx), j = Math.floor(this.rnd() * this.d.nz);
    if (blockHint >= 0) { i = blockHint % this.d.nx; j = Math.floor(blockHint / this.d.nx); }
    const v = (1.1 + this.rnd() * 0.5) * (this.rnd() < 0.5 ? 1 : -1);
    const color = COLORS[Math.floor(this.rnd() * COLORS.length)]!;
    if (!target) return { i, j, s: this.rnd() * 8 * L, v, color, target: null, life: 0 };
    const c = blockCenter(this.d, i, j);
    const ts = loopParam(c.x, c.z, target.x, target.z);
    // Départ à 25–60 m de la porte, marche vers elle.
    const off = 25 + this.rnd() * 35;
    const s = ts - Math.sign(v) * off;
    return { i, j, s, v, color, target: ts, life: off / Math.abs(v) };
  }

  /** Un client se dirige vers la porte (x, z) d'un commerce. */
  addClient(doorX: number, doorZ: number): void {
    if (this.walkers.length >= WANDERERS + MAX_CLIENTS) return;
    // Îlot du commerce : le plus proche de la porte.
    let best = 0, bd = Infinity;
    for (let i = 0; i < this.d.nx; i++) for (let j = 0; j < this.d.nz; j++) {
      const c = blockCenter(this.d, i, j);
      const dist = Math.hypot(c.x - doorX, c.z - doorZ);
      if (dist < bd) { bd = dist; best = j * this.d.nx + i; }
    }
    this.walkers.push(this.spawn({ x: doorX, z: doorZ }, best));
  }

  get clients(): number { return this.walkers.length - WANDERERS; }

  update(dt: number): void {
    const out: Walker[] = [];
    let k = 0;
    for (const w of this.walkers) {
      w.s += w.v * dt;
      if (w.target !== null) { w.life -= dt; if (w.life <= 0) continue; } // entré dans le commerce
      out.push(w);
      const c = blockCenter(this.d, w.i, w.j);
      const [x, z, rot] = loopPos(c.x, c.z, w.s);
      const bob = Math.abs(Math.sin(w.s * 3.2)) * 0.05;
      this.q.setFromAxisAngle(this.up, rot + (w.v < 0 ? Math.PI : 0));
      // Décalage latéral : les deux sens de marche se croisent sans se traverser.
      const lat = w.v > 0 ? 0.6 : -0.6;
      const [dx, dz] = [Math.cos(rot) * lat, -Math.sin(rot) * lat];
      this.m.compose(new THREE.Vector3(x + dx, 0.16 + bob, z + dz), this.q, new THREE.Vector3(1, 1, 1));
      this.mesh.setMatrixAt(k, this.m);
      this.rest.setMatrixAt(k, this.m);
      this.mesh.setColorAt(k, this.c.set(w.color));
      k++;
    }
    this.walkers = out;
    this.mesh.count = k;
    this.rest.count = k;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.rest.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
