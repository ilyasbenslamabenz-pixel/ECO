/**
 * Vitrine des bâtiments (page navigateur, bundlée par run.ts). Utilise le VRAI rendu du jeu :
 * InstancedBuildingRenderer (src/render/buildings) + AssetLibrary (GLTFLoader) + matériaux partagés.
 *
 * Paramètres d'URL :
 *   mode=single&id=<asset>&variant=<n>&lod=<0|1|2>&view=<front|back|aerial|street>&night=<0..1>
 *   mode=street&view=<aerial|street|low>&night=<0..1>&cat=<filtre de catégories, virgules>
 * Expose window.__show = { ready, error, info } pour le pilote Playwright.
 */
import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import type { AssetCatalog, CatalogAsset, TextureSet } from '../../../src/shared/catalog';
import { AssetLibrary } from '../../../src/render/assets';
import { MaterialLibrary } from '../../../src/render/materials';
import { InstancedBuildingRenderer } from '../../../src/render/buildings/renderer';
import type { BuildingRecord } from '../../../src/shared/contracts';
import { validateAllAssets } from '../../../src/render/validation';

declare global {
  interface Window { __show: { ready: boolean; error: string | null; info: Record<string, unknown> } }
}
window.__show = { ready: false, error: null, info: {} };

const q = new URLSearchParams(location.search);
const mode = q.get('mode') ?? 'single';
const view = q.get('view') ?? 'front';
const night = Number(q.get('night') ?? '0');
const W = Number(q.get('w') ?? '900');
const H = Number(q.get('h') ?? '600');

async function main(): Promise<void> {
  const base = new URL('/assets/', location.href);
  const cat = (await (await fetch(new URL('catalog.json', base))).json()) as AssetCatalog;
  for (const frag of (q.get('frags') ?? 'catalog.buildings.residential.json').split(',')) {
    const r = await fetch(new URL(frag, base));
    if (!r.ok) continue;
    const f = (await r.json()) as { assets: CatalogAsset[]; textureSets: TextureSet[] };
    for (const a of f.assets) { const i = cat.assets.findIndex((x) => x.id === a.id); if (i >= 0) cat.assets[i] = a; else cat.assets.push(a); }
    for (const t of f.textureSets) { const i = cat.textureSets.findIndex((x) => x.id === t.id); if (i >= 0) cat.textureSets[i] = t; else cat.textureSets.push(t); }
  }
  if (mode === 'gate') {
    // Porte de validation visuelle du QA (src/render/validation.ts, validateAllAssets) appliquée aux bâtiments générés.
    const ids = new Set((q.get('ids') ?? '').split(',').filter(Boolean));
    const sub: AssetCatalog = { ...cat, assets: cat.assets.filter((a) => a.tags.includes('genere') && (ids.size === 0 || ids.has(a.id))) };
    const res = await validateAllAssets(new AssetLibrary(sub, base), 192);
    window.__show.info = { gate: res.reports, sheet: res.contactSheet };
    window.__show.ready = true;
    return;
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
  const camera = new THREE.PerspectiveCamera(40, W / H, 0.5, 4000);

  // Environnement : HDRI Poly Haven (réflexions + fond), soleil avec ombres
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
  sun.position.set(-60, 90, 70);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight(night > 0.5 ? 0x223355 : 0xcfe3ff, 0x5a5040, night > 0.5 ? 0.15 : 0.6));

  const mats = new MaterialLibrary(cat, base);
  const lib = new AssetLibrary(cat, base);
  const br = new InstancedBuildingRenderer(scene, lib);
  br.setNight(night);

  const records: BuildingRecord[] = [];
  let focus = new THREE.Vector3();
  let size = new THREE.Vector3(20, 10, 20);
  if (mode === 'single') {
    const id = q.get('id')!;
    const a = cat.assets.find((x) => x.id === id);
    if (!a) throw new Error(`asset ${id} absent`);
    records.push({ id: 1, assetId: id, variant: Number(q.get('variant') ?? '0'), x: 0, y: 0, z: 0, rot: 0 });
    br.forceLod = Number(q.get('lod') ?? '0');
    size = new THREE.Vector3(a.dimensions.width, a.dimensions.height, a.dimensions.depth);
    focus = new THREE.Vector3(0, a.dimensions.height * 0.42, 0);
  } else {
    // Rue de démonstration : tous les bâtiments résidentiels (une instance par variante), des deux côtés de rues parallèles.
    const cats = (q.get('cat') ?? 'house,townhouse,apartment_low,apartment_mid,apartment_high').split(',');
    const list = cat.assets.filter((a) => cats.includes(a.category));
    const streetW = 16;
    const lineMax = Number(q.get('line') ?? '170');
    const items: { a: CatalogAsset; v: number }[] = [];
    for (const a of list) for (let v = 0; v < Math.min(a.variants.length, Number(q.get('vmax') ?? '2')); v++) items.push({ a, v });
    let id = 1;
    let x = 0;
    let side = 0; // 0 : nord de la rue (façade +Z), 1 : sud (façade -Z)
    let street = 0;
    const streets: number[] = [0];
    for (const it of items) {
      const fw = it.a.footprint.tilesX * 8;
      const fd = it.a.footprint.tilesZ * 8;
      if (x + fw > lineMax) {
        x = 0;
        if (side === 0) side = 1; else { side = 0; street++; streets.push(-street * 90); }
      }
      const zr = -street * 90;
      const z = side === 0 ? zr - streetW / 2 - fd / 2 : zr + streetW / 2 + fd / 2;
      records.push({ id: id++, assetId: it.a.id, variant: it.v, x: x + fw / 2, y: 0, z, rot: side === 0 ? 0 : 2 });
      x += fw + 3;
    }
    const bb = new THREE.Box3();
    for (const r of records) bb.expandByPoint(new THREE.Vector3(r.x, 0, r.z));
    focus = bb.getCenter(new THREE.Vector3());
    size = bb.getSize(new THREE.Vector3());
    for (const zr of streets) {
      const road = new THREE.Mesh(new THREE.PlaneGeometry(lineMax + 80, streetW - 5), mats.get('route_asphalte', { uv: 'worldXZ' }));
      road.rotation.x = -Math.PI / 2;
      road.position.set(lineMax / 2, 0.06, zr);
      road.receiveShadow = true;
      scene.add(road);
      for (const sz of [-1, 1]) {
        const walk = new THREE.Mesh(new THREE.BoxGeometry(lineMax + 80, 0.15, 2.5), mats.get('trottoir_dalles', { uv: 'box' }));
        walk.position.set(lineMax / 2, 0.075, zr + sz * (streetW / 2 - 1.25));
        walk.receiveShadow = true;
        scene.add(walk);
      }
    }
  }
  br.add(records);
  // sol
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), mats.get('terrain_herbe', { uv: 'worldXZ', color: '#9fbf72' }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  ground.receiveShadow = true;
  scene.add(ground);
  if (mode === 'single') {
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(size.x + 8, 4), mats.get('trottoir_dalles', { uv: 'worldXZ' }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(0, 0.02, size.z / 2 + 3);
    pad.receiveShadow = true;
    scene.add(pad);
  }

  // Caméra
  const R = Math.max(size.x, size.y * 1.1, size.z) ;
  const yaw = Number(q.get('yaw') ?? (view === 'back' ? '200' : '28')) * Math.PI / 180;
  if (view === 'aerial') {
    const d = mode === 'single' ? R * 2.1 : Math.max(size.x, size.z) * 0.95;
    camera.position.set(focus.x + Math.sin(yaw) * d * 0.7, d * 0.75, focus.z + Math.cos(yaw) * d * 0.7);
    camera.lookAt(focus.x, mode === 'single' ? focus.y * 0.6 : 0, focus.z);
  } else if (view === 'street') {
    const sx = Number(q.get('sx') ?? '-4');
    camera.position.set(sx, 1.7, mode === 'single' ? size.z / 2 + 9 : 1.5);
    camera.lookAt(sx + 30, 5, mode === 'single' ? 0 : -2);
    camera.fov = 60;
    camera.updateProjectionMatrix();
  } else if (view === 'low') {
    camera.position.set(focus.x - size.x * 0.5, 25, 60);
    camera.lookAt(focus.x - size.x * 0.1, 8, -20);
  } else {
    const d = R * 1.55 + 4;
    const back = view === 'back' ? -1 : 1;
    camera.position.set(Math.sin(yaw) * d, Math.max(2, size.y * 0.42 + d * 0.16), back * Math.abs(Math.cos(yaw)) * d);
    camera.lookAt(focus);
  }
  // ombre cadrée
  const sc = sun.shadow.camera;
  const ext = mode === 'single' ? R * 1.2 + 6 : Math.max(size.x, size.z) * 0.7;
  sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 1; sc.far = 600;
  sun.target.position.copy(focus).setY(0);
  sun.position.copy(sun.target.position).add(new THREE.Vector3(-60, 90, 70));
  sc.updateProjectionMatrix();

  camera.updateMatrixWorld();
  br.attachCamera(mode === 'single' ? null : camera);
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
  window.__show.info = {
    records: records.length, meshes, triangles: tris, visible: [...br.visible], errors: [...br.errors, ...br.materials.errors],
    materials: br.materials.stats(), drawCalls: renderer.info.render.calls,
  };
  window.__show.ready = true;
}

main().catch((e: unknown) => { window.__show.error = e instanceof Error ? `${e.message}\n${e.stack}` : String(e); });
