/**
 * Page de vitrine des assets transport (bundlée par run.ts) : charge chaque GLB avec GLTFLoader (three),
 * éclairage HDRI Poly Haven + soleil avec ombres, sol béton (bâtiments, véhicules) ou plan d'eau (navires, quais).
 * Paramètres : lod=0|1|2, ids=a,b, cols, cw, ch, view=34|haut|profil, pose=0|1 (pièces animables déplacées), variant=k.
 * Expose window.__ts = { ready, error, report }.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import type { AssetCatalog, CatalogAsset, TextureSet } from '../../../src/shared/catalog';

interface Report { ok: boolean; errors: string[]; models: { id: string; meshes: number; textured: number; tris: number }[] }
const w = window as unknown as { __ts: { ready: boolean; error: string | null; report: Report | null } };
w.__ts = { ready: false, error: null, report: null };
const q = new URLSearchParams(location.search);
const lod = Number(q.get('lod') ?? '0');
const cellW = Number(q.get('cw') ?? '480'), cellH = Number(q.get('ch') ?? '360');
const view = q.get('view') ?? '34';
const pose = q.get('pose') === '1';
const variantK = Number(q.get('variant') ?? '0');

async function main(): Promise<void> {
  const base = new URL('/assets/', location.href);
  const main = await (await fetch(new URL('catalog.json', base))).json() as AssetCatalog;
  const frag = await (await fetch(new URL('catalog.transport.json', base))).json() as { assets: CatalogAsset[]; textureSets: TextureSet[] };
  const ids = q.get('ids')?.split(',');
  const assets = frag.assets.filter((a) => !ids || ids.includes(a.id));
  const cols = Number(q.get('cols') ?? String(Math.min(5, assets.length)));
  const rows = Math.ceil(assets.length / cols);
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  const W = cols * cellW, H = rows * cellH;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const hdr = await new HDRLoader().loadAsync(new URL(main.hdris.find((h) => h.id === 'ciel_jour')!.file, base).href);
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = pmrem.fromEquirectangular(hdr).texture;
  scene.background = new THREE.Color(0xa9bfd2);
  scene.fog = new THREE.Fog(0xa9bfd2, 900, 2800);
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
  sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  const tl = new THREE.TextureLoader();
  const beton = main.textureSets.find((t) => t.id === 'sol_beton_brut')!;
  const tex = (f: string, srgb: boolean, rep: number): THREE.Texture => { const t = tl.load(new URL(f, base).href); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
  const groundMat = new THREE.MeshStandardMaterial({ map: tex(beton.albedo, true, 1200), normalMap: tex(beton.normal, false, 1200), roughnessMap: tex(beton.arm!, false, 1200), color: 0x9a9890 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), groundMat);
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
  const water = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshStandardMaterial({ color: 0x1f4a5a, roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.86 }));
  water.rotation.x = -Math.PI / 2; water.receiveShadow = true;
  scene.add(ground, water);
  const loader = new GLTFLoader();
  const errors: string[] = [];
  const report: Report = { ok: true, errors, models: [] };
  const cam = new THREE.PerspectiveCamera(30, cellW / cellH, 0.5, 5000);
  for (let k = 0; k < assets.length; k++) {
    const a = assets[k]!;
    const g = await loader.loadAsync(new URL(a.lods[Math.min(lod, a.lods.length - 1)]!.file, base).href);
    const root = g.scene;
    let meshes = 0, textured = 0, tris = 0;
    const variant = a.variants[variantK % a.variants.length];
    const pending: Promise<unknown>[] = [];
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      meshes++; m.castShadow = true; m.receiveShadow = true;
      tris += (m.geometry.index?.count ?? 0) / 3;
      const mat = m.material as THREE.MeshStandardMaterial;
      if (mat.map) { textured++; if (!(mat.map.image as { width?: number } | undefined)?.width) errors.push(`${a.id} : texture non décodée ${mat.name}`); }
      const ov = variant?.materialOverrides?.[mat.name];
      if (ov?.color) { m.material = mat.clone(); (m.material as THREE.MeshStandardMaterial).color.set(ov.color).convertSRGBToLinear(); }
    });
    await Promise.all(pending);
    if (pose) root.traverse((o) => {
      const an = (o.userData as { aube?: { anim?: { kind: string; axis: 'x' | 'y' | 'z'; min: number; max: number } } }).aube?.anim;
      if (!an) return;
      const v = an.min + (an.max - an.min) * 0.75;
      if (an.kind === 'rotate') o.rotation[an.axis] = (v * Math.PI) / 180;
      else if (an.kind === 'translate') o.position[an.axis] = v;
      else o.scale[an.axis] = v;
    });
    report.models.push({ id: a.id, meshes, textured, tris });
    if (meshes === 0) errors.push(`${a.id} : aucun maillage`);
    if (textured === 0) errors.push(`${a.id} : aucune texture`);
    scene.add(root);
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3()), ctr = box.getCenter(new THREE.Vector3());
    const isShip = a.tags.includes('origine:flottaison'), isQuay = a.tags.includes('niveau:quai_y0');
    ground.visible = !isShip && !isQuay;
    water.visible = isShip || isQuay;
    water.position.y = isQuay ? -1.6 : 0;
    ground.position.y = a.tags.includes('niveau:sol_y0') ? -0.08 : 0;
    const R = Math.max(size.x, size.z, size.y * 1.2) * 0.62 + 1.5;
    const yaw = view === 'profil' ? Math.PI / 2 : view === 'arriere' ? Math.PI + 0.7 : 0.75;
    const elev = view === 'haut' ? 1.0 : view === 'profil' ? 0.1 : 0.42;
    const dist = R / Math.tan((cam.fov * Math.PI) / 360) * 0.95;
    const look = new THREE.Vector3(ctr.x, Math.max(0, box.min.y) + size.y * 0.35, ctr.z);
    cam.position.set(look.x + Math.sin(yaw) * Math.cos(elev) * dist, look.y + Math.sin(elev) * dist, look.z + Math.cos(yaw) * Math.cos(elev) * dist);
    cam.near = dist / 50; cam.far = dist * 6; cam.updateProjectionMatrix();
    cam.lookAt(look);
    const sd = Math.max(size.x, size.z, size.y) * 0.8 + 5;
    sun.position.set(ctr.x + sd * 0.6, sd * 1.2, ctr.z + sd * 0.8); sun.target.position.copy(ctr);
    const sc = sun.shadow.camera; sc.left = -sd; sc.right = sd; sc.top = sd; sc.bottom = -sd; sc.near = 0.5; sc.far = sd * 4; sc.updateProjectionMatrix();
    const col = k % cols, row = Math.floor(k / cols);
    const y0 = H - (row + 1) * cellH;
    renderer.setViewport(col * cellW, y0, cellW, cellH);
    renderer.setScissor(col * cellW, y0, cellW, cellH);
    renderer.setScissorTest(true);
    renderer.render(scene, cam);
    scene.remove(root);
  }
  report.ok = errors.length === 0;
  w.__ts.report = report;
  w.__ts.ready = true;
}
main().catch((e: unknown) => { w.__ts.error = e instanceof Error ? `${e.message}\n${e.stack}` : String(e); });
