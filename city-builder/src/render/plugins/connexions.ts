/**
 * Rendu du module « connexions » (connexions extérieures) — NOUVEAU fichier ; seul le registre gagne une ligne.
 * À chaque point d'entrée en bord de carte : un portique (deux poteaux et une traverse) et un panneau fléché orienté
 * vers l'extérieur, vert si la connexion est reliée à la ville, gris sinon (4 `InstancedMesh` pour toutes les
 * connexions). Le rendu ne modifie jamais l'état du jeu.
 */
import * as THREE from 'three';
import type { ConnexionsDelta, ConnexionView } from '../../shared/protocol-ext/connexions';
import type { RenderPlugin, RenderPluginContext } from './types';

const MAX = 64;

class ConnexionsScene {
  readonly group = new THREE.Group();
  private readonly posts: THREE.InstancedMesh;
  private readonly beams: THREE.InstancedMesh;
  private readonly signs: THREE.InstancedMesh;
  private readonly arrows: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3(1, 1, 1);
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly c = new THREE.Color();
  count = 0;

  constructor(private readonly ctx: RenderPluginContext) {
    this.group.name = 'connexions-exterieures';
    ctx.scene.add(this.group);
    const post = new THREE.CylinderGeometry(0.25, 0.25, 7, 8); post.translate(0, 3.5, 0);
    const beam = new THREE.BoxGeometry(14, 0.5, 0.5); beam.translate(0, 7, 0);
    const sign = new THREE.BoxGeometry(6, 2.2, 0.2); sign.translate(0, 5.6, 0.3);
    const arrow = new THREE.ConeGeometry(0.9, 2.2, 3); arrow.rotateZ(-Math.PI / 2); arrow.translate(0, 5.6, 0.5);
    const metal = new THREE.MeshStandardMaterial({ color: 0x8a939c, metalness: 0.6, roughness: 0.4 });
    this.posts = new THREE.InstancedMesh(post, metal, MAX * 2);
    this.beams = new THREE.InstancedMesh(beam, metal, MAX);
    this.signs = new THREE.InstancedMesh(sign, new THREE.MeshStandardMaterial({ roughness: 0.5, emissive: 0x0b1a10 }), MAX);
    this.arrows = new THREE.InstancedMesh(arrow, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, emissive: 0x222222 }), MAX);
    this.signs.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    for (const im of [this.posts, this.beams, this.signs, this.arrows]) { im.count = 0; im.frustumCulled = false; im.castShadow = true; this.group.add(im); }
  }

  apply(list: readonly ConnexionView[]): void {
    const n = Math.min(MAX, list.length);
    for (let i = 0; i < n; i++) {
      const c = list[i]!;
      const h = this.ctx.heightAt(c.x, c.z);
      const y = Number.isFinite(h) ? h : c.y;
      // Repère local : X le long de la traverse (en travers de la route), Z vers l'extérieur de la carte.
      this.q.setFromAxisAngle(this.up, Math.atan2(c.dirX, c.dirZ));
      this.v.set(c.x, y, c.z);
      this.m.compose(this.v, this.q, this.s);
      this.beams.setMatrixAt(i, this.m); this.signs.setMatrixAt(i, this.m);
      // Flèche : pointe vers l'extérieur (sortie) ; poteaux de part et d'autre de la chaussée.
      const back = new THREE.Quaternion().setFromAxisAngle(this.up, Math.atan2(c.dirX, c.dirZ) + Math.PI / 2);
      this.m.compose(this.v, back, this.s);
      this.arrows.setMatrixAt(i, this.m);
      for (const side of [-1, 1]) {
        const ox = -c.dirZ * 7 * side, oz = c.dirX * 7 * side;
        this.v.set(c.x + ox, y, c.z + oz);
        this.m.compose(this.v, this.q, this.s);
        this.posts.setMatrixAt(i * 2 + (side > 0 ? 1 : 0), this.m);
      }
      this.c.set(c.linked ? (c.kind === 'autoroute' ? '#1f7a3a' : '#2e8b57') : '#7a7f86');
      this.signs.setColorAt(i, this.c);
    }
    this.posts.count = n * 2; this.beams.count = n; this.signs.count = n; this.arrows.count = n;
    for (const im of [this.posts, this.beams, this.signs, this.arrows]) { im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
    this.count = n;
  }

  dispose(): void {
    this.ctx.scene.remove(this.group);
    for (const im of [this.posts, this.beams, this.signs, this.arrows]) { im.geometry.dispose(); (im.material as THREE.Material).dispose(); im.dispose(); }
  }
}

let scene: ConnexionsScene | null = null;

export function createConnexionsRenderPlugin(): RenderPlugin {
  return {
    id: 'connexions',
    init(ctx) {
      scene = new ConnexionsScene(ctx);
      (window as unknown as { __connexionsRender?: unknown }).__connexionsRender = { count: () => scene?.count ?? 0 };
    },
    applySnapshotExt(p) { scene?.apply((p as ConnexionsDelta | undefined)?.connexions ?? []); },
    applyDeltaExt(p) { const d = p as ConnexionsDelta; if (d?.connexions) scene?.apply(d.connexions); },
    dispose() { scene?.dispose(); scene = null; },
  };
}

export const connexionsRenderPlugin = createConnexionsRenderPlugin();
