// Eau réfléchissante : mer, rivières et lacs en miroir (reflets de la ville et du ciel), vagues animées
// par une carte de normales procédurale, reflet du soleil, transparence de Fresnel.
import { Color3, DynamicTexture, FresnelParameters, MirrorTexture, Plane, StandardMaterial, Texture, type AbstractMesh, type Scene } from '@babylonjs/core';
import { ENV } from './terrain';
import { SKY } from './sky';

/** Carte de normales de vagues (bruit périodique), générée une fois. */
function waveNormals(scene: Scene) {
  const N = 256;
  const tex = new DynamicTexture('waveNormals', N, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const img = ctx.createImageData(N, N);
  const h = new Float32Array(N * N);
  const waves = Array.from({ length: 14 }, (_, k) => ({ fx: Math.round(Math.cos(k * 2.399) * (2 + k)), fz: Math.round(Math.sin(k * 2.399) * (2 + k)), a: 1 / (1 + k * 0.6), p: k * 1.7 }));
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let v = 0;
    for (const w of waves) v += w.a * Math.sin(((w.fx * x + w.fz * y) / N) * Math.PI * 2 + w.p);
    h[y * N + x] = v;
  }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = h[y * N + ((x + 1) % N)] - h[y * N + ((x + N - 1) % N)];
    const dy = h[((y + 1) % N) * N + x] - h[((y + N - 1) % N) * N + x];
    const nx = -dx * 0.6, ny = -dy * 0.6, nz = 1;
    const l = Math.hypot(nx, ny, nz);
    const k = (y * N + x) * 4;
    img.data[k] = (nx / l * 0.5 + 0.5) * 255;
    img.data[k + 1] = (ny / l * 0.5 + 0.5) * 255;
    img.data[k + 2] = (nz / l * 0.5 + 0.5) * 255;
    img.data[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  tex.update();
  tex.wrapU = tex.wrapV = Texture.WRAP_ADDRESSMODE;
  return tex;
}

export function upgradeWater(scene: Scene, mirrorSize: number) {
  const water = scene.meshes.filter((m) => m.name === 'sea' || m.name === 'lake' || m.name === 'rivers');
  const waterSet = new Set<AbstractMesh>(water);
  const mat = new StandardMaterial('waterMat', scene);
  mat.diffuseColor = new Color3(0.03, 0.1, 0.14);
  mat.specularColor = new Color3(1, 0.9, 0.75);
  mat.specularPower = 320;
  mat.alpha = 0.96;
  mat.zOffset = -1;
  const normals = waveNormals(scene);
  normals.uScale = normals.vScale = 1;
  mat.bumpTexture = normals;
  mat.bumpTexture.level = 0.35;
  let mirror: MirrorTexture | null = null;
  if (mirrorSize > 0) {
    mirror = new MirrorTexture('waterMirror', mirrorSize, scene, true);
    mirror.mirrorPlane = new Plane(0, -1, 0, 0.032);
    mirror.renderListPredicate = (m) => !waterSet.has(m) && m.name !== 'terrain' && m.isVisible && m.isEnabled() && m.name !== 'stars' && m.name !== 'precip';
    mirror.level = 0.75;
    mirror.adaptiveBlurKernel = 12;
    mat.reflectionTexture = mirror;
    mat.reflectionFresnelParameters = new FresnelParameters();
    mat.reflectionFresnelParameters.bias = 0.15;
    mat.reflectionFresnelParameters.power = 2.2;
    mat.reflectionFresnelParameters.leftColor = Color3.White();
    mat.reflectionFresnelParameters.rightColor = new Color3(0.35, 0.35, 0.35);
  }
  // les UV de la mer couvrent 192 × 144 km : on répète la carte de vagues environ tous les 60 m
  // lacs et rivières : même miroir, sans carte de vagues (UV absentes ou d'une autre échelle)
  // sans miroir (qualité basse), une eau très sombre paraît noire : teinte plus claire et légère émission (reflet du ciel)
  if (!mirror) { mat.emissiveColor = new Color3(0.08, 0.16, 0.22); }
  const calm = mat.clone('waterCalmMat');
  calm.bumpTexture = null;
  calm.diffuseColor = mirror ? new Color3(0.04, 0.12, 0.15) : new Color3(0.06, 0.13, 0.17);
  for (const m of water) {
    m.material = m.name === 'sea' ? mat : calm;
    m.isPickable = false;
  }
  let t = 0;
  return {
    update: (dt: number, cameraRadius: number) => {
      t += dt;
      // échelle des vagues adaptée à la distance de la caméra (évite le moiré au loin)
      const tiles = Math.max(400, Math.min(3200, 3200 / Math.max(1, cameraRadius / 4)));
      normals.uScale = normals.vScale = tiles;
      normals.uOffset = t * 0.004;
      normals.vOffset = t * 0.0025;
      const k = mirror ? 1 : 2.2; // sans miroir : eau plus claire
      mat.diffuseColor.set((0.03 - ENV.night * 0.02) * k, (0.1 - ENV.night * 0.06) * k, (0.14 - ENV.night * 0.06) * k);
      if (!mirror) {
        // sans miroir : l'eau prend la teinte du ciel (zénith reflété au pied, horizon embrasé au loin)
        const e = Color3.Lerp(SKY.zen, SKY.haze, 0.55).scale(0.3);
        mat.emissiveColor.set(e.r * 0.85 + 0.01, e.g * 0.9 + 0.03, e.b + 0.05);
        calm.emissiveColor.copyFrom(mat.emissiveColor);
      }
      if (mirror) mirror.level = 0.65 + ENV.night * 0.25;
    },
    dispose: () => { mirror?.dispose(); normals.dispose(); mat.dispose(); calm.dispose(); },
  };
}
