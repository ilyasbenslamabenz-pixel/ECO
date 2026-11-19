/**
 * Ombre de contact au pied des bâtiments (occlusion ambiante au sol, comme dans les city-builders récents) : un
 * halo sombre et doux qui « pose » chaque bâtiment sur le terrain, quelle que soit l'heure (l'ombre du soleil seule
 * laisse les façades à l'ombre flotter au-dessus de l'herbe).
 *
 * Coût : un seul maillage instancié pour toute la ville (un appel de dessin), aucune texture, aucun passage plein
 * écran. Le dégradé est calculé dans le shader, en mètres, à partir de l'échelle de chaque instance : même largeur
 * de halo pour une maison et une tour.
 */
import * as THREE from 'three';
import { rotAngle } from '../../shared/footprint';

/** Largeur du halo autour de l'emprise du modèle (m). */
export const CONTACT_MARGIN_M = 2.6;
/** Opacité du halo au pied du mur (0..1). */
export const CONTACT_STRENGTH = 0.42;
/** Hauteur au-dessus du sol du bâtiment (m) : au-dessus du terrain aplani, sous les allées des jardinets. */
const LIFT = 0.03;

const vertex = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
uniform float uMargin;
varying vec2 vLocal;
varying vec2 vHalf;
void main() {
  vec2 scl = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[2].xyz));
  vLocal = position.xz * scl;
  vHalf = max(scl * 0.5 - uMargin, vec2(0.0));
  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const fragment = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform float uMargin;
uniform float uStrength;
varying vec2 vLocal;
varying vec2 vHalf;
void main() {
  float d = length(max(abs(vLocal) - vHalf, vec2(0.0)));
  float a = uStrength * (1.0 - smoothstep(0.0, uMargin, d));
  a *= a > 0.0 ? 1.0 : 0.0;
  gl_FragColor = vec4(0.0, 0.0, 0.0, a);
  #include <fog_fragment>
}`;

export class ContactShadowLayer {
  readonly group = new THREE.Group();
  private readonly items = new Map<number, Float32Array>();
  /** Bâtiments masqués (chantier en cours) : pas de halo sur un terrain vide. */
  private readonly hidden = new Set<number>();
  private mesh: THREE.InstancedMesh | null = null;
  private dirty = false;
  private readonly geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  readonly material = new THREE.ShaderMaterial({
    name: 'ombre-contact',
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uMargin: { value: CONTACT_MARGIN_M }, uStrength: { value: CONTACT_STRENGTH } }]),
    transparent: true,
    depthWrite: false,
    fog: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });

  constructor(parent: THREE.Object3D) {
    this.group.name = 'ombres_contact';
    parent.add(this.group);
  }

  /** Halo d'un bâtiment : centre du modèle (x, y, z), dimensions au sol (m), rotation (quarts de tour). */
  add(id: number, x: number, y: number, z: number, width: number, depth: number, rot: number): void {
    if (!(width > 0 && depth > 0)) { this.remove(id); return; }
    _q.setFromAxisAngle(_up, rotAngle(rot));
    _p.set(x, y + LIFT, z);
    _s.set(width + 2 * CONTACT_MARGIN_M, 1, depth + 2 * CONTACT_MARGIN_M);
    this.items.set(id, _m.compose(_p, _q, _s).toArray(new Float32Array(16)) as Float32Array);
    this.dirty = true;
  }

  remove(id: number): void { if (this.items.delete(id)) this.dirty = true; this.hidden.delete(id); }

  setVisible(id: number, visible: boolean): void {
    if (visible ? this.hidden.delete(id) : !this.hidden.has(id) && !!this.hidden.add(id)) this.dirty = true;
  }

  get count(): number { return this.items.size; }

  /** Reconstruit le maillage si nécessaire (chaque image ; coût nul sans changement). */
  update(): void {
    if (!this.dirty) return;
    this.dirty = false;
    let n = 0;
    for (const id of this.items.keys()) if (!this.hidden.has(id)) n++;
    let mesh = this.mesh;
    if (mesh && mesh.instanceMatrix.count < n) { this.group.remove(mesh); mesh.dispose(); mesh = null; }
    if (n === 0) { if (mesh) mesh.count = 0; this.mesh = mesh; return; }
    if (!mesh) {
      mesh = new THREE.InstancedMesh(this.geo, this.material, Math.max(64, n * 2));
      mesh.name = 'ombres-contact';
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      // Dessiné après le terrain et les routes opaques, avant les objets transparents (vitres, eau).
      mesh.renderOrder = -1;
      this.group.add(mesh);
    }
    let i = 0;
    for (const [id, m] of this.items) if (!this.hidden.has(id)) mesh.instanceMatrix.array.set(m, 16 * i++);
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    this.mesh = mesh;
  }

  dispose(): void {
    this.mesh?.dispose();
    this.geo.dispose();
    this.material.dispose();
    this.group.removeFromParent();
  }
}

const _up = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();
