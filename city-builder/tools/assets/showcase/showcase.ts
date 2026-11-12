/**
 * Vitrine des assets (page de contrôle visuel du pipeline, hors jeu).
 * Construite par tools/assets/showcase/run.ts ; pilotée par Playwright via window.__showcase.
 * Rend un modèle du catalogue (LOD au choix) ou un jeu de textures (sphère UV + mur en projection monde)
 * sous l'HDRI de jour du catalogue, avec ombres, sur un sol en pavés (projection monde XZ).
 */
import * as THREE from 'three';
import { AssetLibrary, fetchCatalog } from '../../../src/render/assets';
import { MaterialLibrary } from '../../../src/render/materials';

interface ShowResult { ok: boolean; error?: string; meshes: number; triangles: number; textures: number; texturesDecoded: number; size: [number, number, number] }

const W = 512;
const H = 512;
const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, W / H, 0.05, 2000);
const sun = new THREE.DirectionalLight(0xfff1dd, 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);

const base = new URL('../../assets/', location.href);
const ready = (async () => {
  const catalog = await fetchCatalog(base);
  const lib = new AssetLibrary(catalog, base);
  const mats = new MaterialLibrary(catalog, base, renderer.capabilities.getMaxAnisotropy());
  const hdr = await mats.loadHdri('ciel_jour');
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(hdr).texture;
  scene.background = hdr;
  scene.backgroundBlurriness = 0.15;
  scene.environmentIntensity = 0.9;
  const ground = new THREE.Mesh(new THREE.CircleGeometry(400, 64).rotateX(-Math.PI / 2), mats.get('paves_granit', { uv: 'worldXZ' }));
  ground.receiveShadow = true;
  scene.add(ground);
  return { catalog, lib, mats, ground };
})();

let current: THREE.Object3D | null = null;

function frame(size: THREE.Vector3, center: THREE.Vector3, dir = new THREE.Vector3(0.9, 0.55, 1.35)): void {
  const radius = Math.max(size.length() / 2, 0.3);
  const dist = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.05;
  camera.position.copy(center).addScaledVector(dir.normalize(), dist);
  camera.near = dist / 100;
  camera.far = dist * 20;
  camera.updateProjectionMatrix();
  camera.lookAt(center);
  const r = Math.max(radius * 1.5, 2);
  sun.position.copy(center).add(new THREE.Vector3(r * 1.2, r * 2, r * 0.9));
  sun.target.position.copy(center);
  const cam = sun.shadow.camera;
  cam.left = cam.bottom = -r;
  cam.right = cam.top = r;
  cam.near = 0.1;
  cam.far = r * 6;
  cam.updateProjectionMatrix();
}

async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    renderer.render(scene, camera);
    await new Promise((r) => requestAnimationFrame(r));
  }
}

function stats(root: THREE.Object3D): Omit<ShowResult, 'ok' | 'size'> {
  let meshes = 0;
  let triangles = 0;
  const tex = new Set<THREE.Texture>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    meshes++;
    const g = m.geometry;
    triangles += (g.index ? g.index.count : g.attributes['position']!.count) / 3;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      for (const v of Object.values(mat)) if (v instanceof THREE.Texture) tex.add(v);
    }
  });
  let decoded = 0;
  for (const t of tex) {
    const img = t.image as { width?: number; height?: number } | null;
    if (img && (img.width ?? 0) > 0 && (img.height ?? 0) > 0) decoded++;
  }
  return { meshes, triangles, textures: tex.size, texturesDecoded: decoded };
}

async function showAsset(id: string, lod = 0): Promise<ShowResult> {
  const { lib } = await ready;
  if (current) scene.remove(current);
  const root = (await lib.load(id, lod)).clone();
  scene.add(root);
  current = root;
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  frame(size, box.getCenter(new THREE.Vector3()));
  await settle();
  return { ok: true, ...stats(root), size: [size.x, size.y, size.z] };
}

async function showMaterial(setId: string): Promise<ShowResult> {
  const { mats } = await ready;
  if (current) scene.remove(current);
  const g = new THREE.Group();
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.9, 64, 32), mats.get(setId));
  sphere.position.set(-1.15, 0.9, 0.6);
  // Mur échantillon 3 × 2,6 m en projection « boîte » monde : l'échelle réelle du jeu (tileSizeM) est respectée.
  const wall = new THREE.Mesh(new THREE.BoxGeometry(3, 2.6, 0.4), mats.get(setId, { uv: 'box' }));
  wall.position.set(1.0, 1.3, -0.4);
  wall.rotation.y = -0.35;
  const slab = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.06, 2.0), mats.get(setId, { uv: 'worldXZ' }));
  slab.position.set(0, 0.03, 1.7);
  for (const m of [sphere, wall, slab]) { m.castShadow = true; m.receiveShadow = true; g.add(m); }
  scene.add(g);
  current = g;
  await mats.whenReady();
  frame(new THREE.Vector3(5, 2.6, 4), new THREE.Vector3(0, 1.0, 0.4), new THREE.Vector3(0.35, 0.45, 1.3));
  await settle();
  const s = mats.stats();
  return { ok: mats.loadErrors.length === 0, error: mats.loadErrors.join('; ') || undefined, meshes: 3, triangles: 0, textures: s.textures, texturesDecoded: s.texturesDecoded, size: [0, 0, 0] };
}

async function info(): Promise<{ assets: { id: string; nameFr: string; category: string; lods: number }[]; textureSets: { id: string; nameFr: string }[]; materials: number; textures: number }> {
  const { catalog, mats } = await ready;
  const s = mats.stats();
  return {
    assets: catalog.assets.map((a) => ({ id: a.id, nameFr: a.nameFr, category: a.category, lods: a.lods.length })),
    textureSets: catalog.textureSets.map((t) => ({ id: t.id, nameFr: t.nameFr })),
    materials: s.materials,
    textures: s.textures,
  };
}

/** Masque/affiche l'objet courant (image de référence pour mesurer la visibilité à cadrage identique). */
async function setVisible(v: boolean): Promise<void> {
  if (current) current.visible = v;
  await settle();
}

(window as unknown as Record<string, unknown>)['__showcase'] = {
  setVisible,
  ready: ready.then(() => true),
  showAsset: (id: string, lod?: number) => showAsset(id, lod).catch((e: unknown) => ({ ok: false, error: String(e), meshes: 0, triangles: 0, textures: 0, texturesDecoded: 0, size: [0, 0, 0] })),
  showMaterial: (id: string) => showMaterial(id).catch((e: unknown) => ({ ok: false, error: String(e), meshes: 0, triangles: 0, textures: 0, texturesDecoded: 0, size: [0, 0, 0] })),
  info,
};
