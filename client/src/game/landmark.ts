// Couronnement de la tour emblématique de la capitale (voir cities.ts, emblem) : lanterne vitrée effilée,
// éclairée de l'intérieur par bandeaux, et flèche. Un seul maillage, un seul appel de rendu ; l'éclat suit
// l'heure (allumé dès l'heure dorée, capté par le bloom en qualité moyenne et haute).
import { Color3, DynamicTexture, Matrix, Mesh, MeshBuilder, StandardMaterial, Texture, type Scene } from '@babylonjs/core';
import { lightsLevel } from './cityModels';

export interface EmblemTop { x: number; y: number; z: number; w: number; d: number; rot: number }

export function createEmblemCrown(scene: Scene, t: EmblemTop) {
  // lanterne : tronc de cône elliptique dans le prolongement du dernier tronçon du fût
  const lantern = MeshBuilder.CreateCylinder('emblemLantern', { diameterTop: 0.3, diameterBottom: 1, height: 1, tessellation: 24 }, scene);
  lantern.bakeTransformIntoVertices(Matrix.Translation(0, 0.5, 0).multiply(Matrix.Scaling(t.w * 0.98, 0.085, t.d * 0.98)));
  // flèche
  const spire = MeshBuilder.CreateCylinder('emblemSpire', { diameterTop: 0, diameterBottom: 1, height: 1, tessellation: 8 }, scene);
  spire.bakeTransformIntoVertices(Matrix.Translation(0, 0.5, 0).multiply(Matrix.Scaling(0.006, 0.11, 0.006)).multiply(Matrix.Translation(0, 0.08, 0)));
  const crown = Mesh.MergeMeshes([lantern, spire], true, true)!;
  crown.name = 'emblemCrown';
  crown.position.set(t.x, t.y, t.z);
  crown.rotation.y = t.rot;
  crown.isPickable = false;
  crown.freezeWorldMatrix();

  // bandeaux lumineux : lignes d'or chaud séparées par la résille sombre, plus serrées vers le sommet
  const tex = new DynamicTexture('emblemBands', { width: 8, height: 128 }, scene, false);
  const c = tex.getContext() as CanvasRenderingContext2D;
  c.fillStyle = '#0c0a08';
  c.fillRect(0, 0, 8, 128);
  for (let k = 0; k < 11; k++) {
    const y = Math.round(4 + k * 11.2);
    c.fillStyle = k % 3 === 2 ? '#fff4dc' : '#ffc77a';
    c.fillRect(0, y, 8, k % 3 === 2 ? 4 : 3);
  }
  tex.update();
  tex.wrapU = tex.wrapV = Texture.WRAP_ADDRESSMODE;
  const mat = new StandardMaterial('emblemMat', scene);
  mat.diffuseColor = new Color3(0.22, 0.24, 0.28);
  mat.specularColor = new Color3(0.6, 0.55, 0.45);
  mat.specularPower = 64;
  mat.emissiveTexture = tex;
  crown.material = mat;
  scene.onBeforeRenderObservable.add(() => {
    const k = 0.3 + 0.6 * lightsLevel();
    mat.emissiveColor.set(k, k * 0.92, k * 0.82);
  });
  return crown;
}
