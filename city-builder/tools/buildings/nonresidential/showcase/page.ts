/**
 * Page de vitrine RAPPROCHÉE des bâtiments non résidentiels (bundlée par run.ts). Utilise le VRAI rendu
 * du jeu (InstancedBuildingRenderer + AssetLibrary + GLTFLoader) avec une caméra libre :
 *   ?ids=a,b&variant=0&lod=0&night=0&cam=x,y,z&look=x,y,z&fov=40&frags=...&layout=row|single&gap=6
 * `layout=row` aligne plusieurs bâtiments le long de l'axe X (rue de démonstration), coordonnées en m.
 * Expose window.__show = { ready, error, info }.
 */
import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import type { AssetCatalog, CatalogAsset, TextureSet } from '../../../../src/shared/catalog';
import { AssetLibrary } from '../../../../src/render/assets';
import { MaterialLibrary } from '../../../../src/render/materials';
import { InstancedBuildingRenderer } from '../../../../src/render/buildings/renderer';
import type { BuildingRecord } from '../../../../src/shared/contracts';

declare global {
  interface Window { __show: { ready: boolean; error: string | null; info: Record<string, unknown> } }
}
window.__show = { ready: false, error: null, info: {} };

const q = new URLSearchParams(location.search);
const night = Number(q.get('night') ?? '0');
const W = Number(q.get('w') ?? '900');
const H = Number(q.get('h') ?? '600');
const num3 = (s: string | null, d: [number, number, number]): [number, number, number] => (s ? (s.split(',').map(Number) as [number, number, number]) : d);

async function main(): Promise<void> {
  const base = new URL('/assets/', location.href);
  const cat = (await (await fetch(new URL('catalog.json', base))).json()) as AssetCatalog;
  for (const frag of (q.get('frags') ?? 'catalog.buildings.other.json').split(',')) {
    const r = await fetch(new URL(frag, base));
    if (!r.ok) continue;
    const f = (await r.json()) as { assets: CatalogAsset[]; textureSets: TextureSet[] };
    for (const a of f.assets) { const i = cat.assets.findIndex((x) => x.id === a.id); if (i >= 0) cat.assets[i] = a; else cat.assets.push(a); }
    for (const t of f.textureSets) { const i = cat.textureSets.findIndex((x) => x.id === t.id); if (i >= 0) cat.textureSets[i] = t; else cat.textureSets.push(t); }
  }
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = night > 0.5 ? 0.9 : 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(Number(q.get('fov') ?? '40'), W / H, 0.3, 6000);
  const hdri = cat.hdris.find((h) => h.id === (night > 0.5 ? 'ciel_crepuscule' : 'ciel_jour')) ?? cat.hdris[0];
  if (hdri) {
    const tex = await new HDRLoader().loadAsync(new URL(hdri.file, base).href);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    const pm = new THREE.PMREMGenerator(renderer);
    const env = pm.fromEquirectangular(tex).texture;
    scene.environment = env;
    scene.background = env;
    scene.backgroundIntensity = night > 0.5 ? 0.08 : 0.9;
    scene.environmentIntensity = night > 0.5 ? 0.12 : 0.85;
  }
  const sun = new THREE.DirectionalLight(0xfff1dd, night > 0.5 ? 0.05 : 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight(night > 0.5 ? 0x223355 : 0xcfe3ff, 0x5a5040, night > 0.5 ? 0.15 : 0.6));
  const mats = new MaterialLibrary(cat, base);
  const lib = new AssetLibrary(cat, base);
  const br = new InstancedBuildingRenderer(scene, lib);
  br.setNight(night);
  br.forceLod = Number(q.get('lod') ?? '0');
  const ids = (q.get('ids') ?? '').split(',').filter(Boolean);
  const variant = Number(q.get('variant') ?? '0');
  const gap = Number(q.get('gap') ?? '6');
  const records: BuildingRecord[] = [];
  let x = 0;
  let maxD = 0;
  ids.forEach((id, i) => {
    const a = cat.assets.find((c) => c.id === id);
    if (!a) throw new Error(`asset ${id} absent`);
    const w = a.footprint.tilesX * 8;
    const v = q.get('variants') === 'all' ? i : Math.min(variant, a.variants.length - 1);
    records.push({ id: i + 1, assetId: id, variant: v, x: x + w / 2, y: 0, z: -a.footprint.tilesZ * 4, rot: 0 });
    maxD = Math.max(maxD, a.footprint.tilesZ * 8);
    x += w + gap;
  });
  const totalW = Math.max(1, x - gap);
  br.add(records);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), mats.get('terrain_herbe', { uv: 'worldXZ', color: '#9fbf72' }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(totalW + 200, 10), mats.get('route_asphalte', { uv: 'worldXZ' }));
  road.rotation.x = -Math.PI / 2;
  road.position.set(totalW / 2, 0.02, 7);
  road.receiveShadow = true;
  scene.add(road);
  const walk = new THREE.Mesh(new THREE.PlaneGeometry(totalW + 200, 2), mats.get('trottoir_dalles', { uv: 'worldXZ' }));
  walk.rotation.x = -Math.PI / 2;
  walk.position.set(totalW / 2, 0.03, 1);
  walk.receiveShadow = true;
  scene.add(walk);
  const cam = num3(q.get('cam'), [totalW / 2 + 30, 25, 60]);
  const look = num3(q.get('look'), [totalW / 2, 8, -maxD / 2]);
  camera.position.set(...cam);
  camera.lookAt(...look);
  const sc = sun.shadow.camera;
  const ext = Math.max(totalW, maxD, 60) * 0.75;
  sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 1; sc.far = 1500;
  sun.target.position.set(totalW / 2, 0, -maxD / 2);
  sun.position.copy(sun.target.position).add(new THREE.Vector3(-150, 260, 180));
  sc.updateProjectionMatrix();
  camera.updateMatrixWorld();
  br.attachCamera(null);
  br.update(camera.position.x, camera.position.y, camera.position.z);
  br.preloadAll();
  await br.whenReady();
  await mats.whenReady();
  br.invalidate();
  br.update(camera.position.x, camera.position.y, camera.position.z);
  renderer.render(scene, camera);
  await new Promise((r) => requestAnimationFrame(r));
  renderer.render(scene, camera);
  let tris = 0;
  let meshes = 0;
  scene.traverse((o) => {
    const m = o as THREE.InstancedMesh;
    if (m.isInstancedMesh && m.count > 0) {
      meshes++;
      const g = m.geometry;
      tris += ((g.index ? g.index.count : g.attributes['position']!.count) / 3) * m.count;
    }
  });
  window.__show.info = { records: records.length, meshes, triangles: tris, errors: [...br.errors, ...br.materials.errors], totalW };
  window.__show.ready = true;
}

main().catch((e: unknown) => { window.__show.error = e instanceof Error ? `${e.message}\n${e.stack}` : String(e); });
