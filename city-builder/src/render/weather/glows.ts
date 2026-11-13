/**
 * Halos des lampadaires (phase 2C « Atmosphère ») : un billboard additif par lanterne, 1 appel de rendu.
 * Les positions sont lues dans les InstancedMesh du décor routier (`roads_decor_lampadaire_fonte_lod*`,
 * sous-maillage du vitrage) sans modifier src/render/roads : centre du vitrage transformé par chaque instance.
 * Les halos s'élargissent dans le brouillard et la pluie (diffusion), s'éteignent le jour.
 */
import * as THREE from 'three';

const VERT = /* glsl */ `
attribute vec3 aPos;
uniform float uSize;
varying vec2 vUv;
#include <fog_pars_vertex>
void main() {
  vec4 mvPosition = viewMatrix * vec4(aPos, 1.0);
  mvPosition.xy += position.xy * uSize;
  vUv = position.xy;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;
const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
varying vec2 vUv;
#include <fog_pars_fragment>
void main() {
  float r = length(vUv) * 2.0;
  float a = exp(-r * r * 4.5) * 0.8 + exp(-r * 9.0) * 0.6;
  a *= smoothstep(1.0, 0.75, r) * uIntensity;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor * a, 1.0);
  #include <fog_fragment>
}
`;

const LAMP_PREFIX = 'roads_decor_lampadaire_fonte_lod0';
const MAX_GLOWS = 4096;

export class LampGlows {
  readonly mesh: THREE.Mesh;
  private readonly positions: THREE.InstancedBufferAttribute;
  private signature = '';
  private scanTimer = 0;
  private readonly tmpM = new THREE.Matrix4();
  private readonly tmpV = new THREE.Vector3();
  private readonly glassCenter = new Map<THREE.BufferGeometry, THREE.Vector3>();

  constructor(private readonly scene: THREE.Scene) {
    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    this.positions = new THREE.InstancedBufferAttribute(new Float32Array(MAX_GLOWS * 3), 3);
    this.positions.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aPos', this.positions);
    geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      name: 'halo_lampadaire',
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uSize: { value: 3.2 }, uColor: { value: new THREE.Color(1.0, 0.78, 0.5) }, uIntensity: { value: 0 },
      }]),
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = 'halos_lampadaires';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 9;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  get count(): number { return (this.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount; }

  /** Centre (repère local) du sous-maillage le plus haut et le plus petit du modèle : la lanterne. */
  private lanternCenter(meshes: THREE.InstancedMesh[]): THREE.Vector3 | null {
    let best: THREE.InstancedMesh | null = null;
    let bestScore = -Infinity;
    for (const m of meshes) {
      const mat = m.material as THREE.MeshStandardMaterial;
      const glass = !Array.isArray(mat) && (/glass|verre/i.test(mat.name) || (mat.emissive && mat.emissive.getHex() !== 0));
      m.geometry.computeBoundingBox();
      const bb = m.geometry.boundingBox!;
      const score = (glass ? 1000 : 0) + bb.max.y;
      if (score > bestScore) { bestScore = score; best = m; }
    }
    if (!best) return null;
    let c = this.glassCenter.get(best.geometry);
    if (!c) {
      c = best.geometry.boundingBox!.getCenter(new THREE.Vector3());
      this.glassCenter.set(best.geometry, c);
    }
    return c;
  }

  /** Relit les positions des lanternes si le décor a changé (toutes les 2 s au plus). */
  private rescan(): void {
    const groups = new Map<string, THREE.InstancedMesh[]>();
    let sig = 0;
    this.scene.traverse((o) => {
      const im = o as THREE.InstancedMesh;
      if (!im.isInstancedMesh || !im.name.startsWith(LAMP_PREFIX)) return;
      const key = `${im.parent?.uuid ?? ''}|${im.name}`;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = []));
      g.push(im);
      sig += im.count * 31 + im.id;
    });
    const s = `${groups.size}:${sig}`;
    if (s === this.signature) return;
    this.signature = s;
    const seen = new Set<string>();
    let n = 0;
    const arr = this.positions.array as Float32Array;
    for (const meshes of groups.values()) {
      const c = this.lanternCenter(meshes);
      if (!c) continue;
      const ref = meshes[0]!;
      ref.updateWorldMatrix(true, false);
      for (let i = 0; i < ref.count && n < MAX_GLOWS; i++) {
        ref.getMatrixAt(i, this.tmpM);
        this.tmpM.premultiply(ref.matrixWorld);
        const p = this.tmpV.copy(c).applyMatrix4(this.tmpM);
        const key = `${Math.round(p.x * 2)}|${Math.round(p.z * 2)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        arr[n * 3] = p.x; arr[n * 3 + 1] = p.y; arr[n * 3 + 2] = p.z;
        n++;
      }
    }
    (this.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount = n;
    this.positions.needsUpdate = true;
  }

  /** night 0..1, fog 0..1, wet (pluie / neige) 0..1. */
  update(dt: number, night: number, fog: number, precip: number): void {
    this.scanTimer -= dt;
    if (night > 0.02 && this.scanTimer <= 0) { this.scanTimer = 2; this.rescan(); }
    const on = night > 0.02 && this.count > 0;
    this.mesh.visible = on;
    if (!on) return;
    const u = (this.mesh.material as THREE.ShaderMaterial).uniforms;
    u['uIntensity']!.value = night * (0.8 + 0.6 * fog + 0.35 * precip);
    u['uSize']!.value = 3.8 * (1 + 0.9 * fog + 0.4 * precip);
  }

  /** Force une relecture des positions au prochain update. */
  invalidate(): void { this.signature = ''; this.scanTimer = 0; }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.removeFromParent();
  }
}
