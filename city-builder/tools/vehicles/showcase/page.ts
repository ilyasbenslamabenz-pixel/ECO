/**
 * Page de vitrine des véhicules (bundlée par run.ts) : rend la flotte avec le VRAI rendu instancié du jeu
 * (src/render/vehicles/renderer.ts), éclairage HDRI Poly Haven, sol en asphalte PBR.
 * Paramètres d'URL : view=34av|34ar|profil|dessus|rue, lod=0|1|2, night=0|1, variant=k, cols=n, ids=a,b
 * Expose window.__vs = { ready, error, report }.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import type { AssetCatalog, CatalogAsset, TextureSet } from '../../../src/shared/catalog';
import { InstancedVehicleRenderer, type VehicleModelSource } from '../../../src/render/vehicles/renderer';

interface Report { ok: boolean; errors: string[]; models: { id: string; lods: number[]; meshes: number; textured: boolean }[]; stats: unknown }
const w = window as unknown as { __vs: { ready: boolean; error: string | null; report: Report | null } };
w.__vs = { ready: false, error: null, report: null };

const q = new URLSearchParams(location.search);
const view = q.get('view') ?? '34av';
const lod = Number(q.get('lod') ?? '0');
const night = q.get('night') === '1';
const variantArg = q.get('variant');
const cellW = Number(q.get('cw') ?? '384'), cellH = Number(q.get('ch') ?? '288');

async function main(): Promise<void> {
  THREE.Cache.enabled = true;
  const base = new URL('/assets/', location.href);
  const main = await (await fetch(new URL('catalog.json', base))).json() as AssetCatalog;
  const frag = await (await fetch(new URL('catalog.vehicles.json', base))).json() as { assets: CatalogAsset[]; textureSets: TextureSet[] };
  const ids = q.get('ids')?.split(',');
  const assets = frag.assets.filter((a) => !ids || ids.includes(a.id));
  const catalog: AssetCatalog = { ...main, assets, textureSets: [...main.textureSets, ...frag.textureSets] };
  const cols = Number(q.get('cols') ?? String(Math.min(5, assets.length)));
  const rows = Math.ceil(assets.length / cols);
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  const W = cols * cellW, H = rows * cellH;
  canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = night ? 0.8 : 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const hdr = await new HDRLoader().loadAsync(new URL(main.hdris.find((h) => h.id === (night ? 'ciel_crepuscule' : 'ciel_jour'))!.file, base).href);
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  const env = pmrem.fromEquirectangular(hdr).texture;
  scene.environment = env;
  scene.environmentIntensity = night ? 0.12 : 1.0;
  scene.background = new THREE.Color(night ? 0x0b1020 : 0x9db4c8);
  const sun = new THREE.DirectionalLight(night ? 0x8090c0 : 0xfff1dc, night ? 0.25 : 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  scene.add(sun, sun.target);
  // sol : asphalte PBR Poly Haven
  const tl = new THREE.TextureLoader();
  const asph = main.textureSets.find((t) => t.id === 'route_asphalte')!;
  const tex = (f: string, srgb: boolean): THREE.Texture => {
    const t = tl.load(new URL(f, base).href);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(60 / asph.tileSizeM, 60 / asph.tileSizeM);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ map: tex(asph.albedo, true), normalMap: tex(asph.normal, false), roughnessMap: tex(asph.arm!, false), color: 0xbbbbbb }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  // marquage de voie pour l'échelle
  const mark = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 3), new THREE.MeshStandardMaterial({ color: 0xe8e8e0, roughness: 0.6 }));
  mark.rotation.x = -Math.PI / 2; mark.position.set(-2.4, 0.01, 0);
  scene.add(mark);

  const loader = new GLTFLoader();
  const src: VehicleModelSource = {
    catalog,
    url: (f) => new URL(f, base).href,
    load: async (id, l = 0) => {
      const a = catalog.assets.find((x) => x.id === id)!;
      const g = await loader.loadAsync(new URL(a.lods[Math.min(l, a.lods.length - 1)]!.file, base).href);
      return g.scene;
    },
  };
  const vr = new InstancedVehicleRenderer(scene, src, { now: () => 0 });
  vr.forceLod = lod;
  vr.setNight(night ? 1 : 0);
  const errors: string[] = [];
  const report: Report = { ok: true, errors, models: [], stats: null };
  const cam = new THREE.PerspectiveCamera(32, cellW / cellH, 0.1, 400);
  for (let k = 0; k < assets.length; k++) {
    const a = assets[k]!;
    const idx = catalog.assets.indexOf(a);
    const variant = variantArg !== null ? Number(variantArg) : 0;
    vr.setFrame({ count: 1, positions: new Float32Array([0, 0, 0, 0]), assetIndices: new Uint16Array([idx]), ids: new Uint32Array([k]), variants: new Uint8Array([variant]) });
    vr.update(0);
    await vr.whenReady();
    vr.update(0);
    // contrôle de chargement réel
    let meshes = 0, textured = false;
    vr.group.traverse((o) => {
      const m = o as THREE.InstancedMesh;
      if (m.isInstancedMesh && m.count > 0 && m.name.startsWith(a.id)) {
        meshes++;
        const mat = m.material as THREE.MeshStandardMaterial;
        if (mat.map && (mat.map.image as { width?: number } | undefined)?.width) textured = true;
      }
    });
    report.models.push({ id: a.id, lods: a.lods.map((l) => l.triangles ?? 0), meshes, textured });
    if (meshes < 2) errors.push(`${a.id} : ${meshes} maillage(s) instancié(s) visible(s)`);
    if (!textured) errors.push(`${a.id} : textures non chargées`);
    // cadrage
    const L = a.dimensions.depth, Hh = a.dimensions.height;
    const r = Math.max(L * 0.62, Hh * 1.2, 2.6);
    const yaw = view === '34av' ? 0.75 : view === '34ar' ? Math.PI - 0.75 : view === 'profil' ? Math.PI / 2 : view === 'rue' ? 0.35 : 0.6;
    const elev = view === 'dessus' ? 1.1 : view === 'rue' ? 0.08 : view === 'profil' ? 0.12 : 0.32;
    const dist = view === 'rue' ? r * 2.0 : r * 2.25;
    cam.position.set(Math.sin(yaw) * Math.cos(elev) * dist, Math.max(view === 'rue' ? 1.6 : 0.5, Math.sin(elev) * dist), Math.cos(yaw) * Math.cos(elev) * dist);
    cam.lookAt(0, Hh * 0.42, 0);
    sun.position.set(12, 18, 10); sun.target.position.set(0, 0, 0);
    const sc = sun.shadow.camera; sc.left = -12; sc.right = 12; sc.top = 12; sc.bottom = -12; sc.updateProjectionMatrix();
    const col = k % cols, row = Math.floor(k / cols);
    const y0 = H - (row + 1) * cellH;
    renderer.setViewport(col * cellW, y0, cellW, cellH);
    renderer.setScissor(col * cellW, y0, cellW, cellH);
    renderer.setScissorTest(true);
    renderer.render(scene, cam);
  }
  errors.push(...vr.loadErrors);
  report.ok = errors.length === 0;
  report.stats = vr.stats();
  w.__vs.report = report;
  w.__vs.ready = true;
}

main().catch((e: unknown) => { w.__vs.error = e instanceof Error ? `${e.message}\n${e.stack}` : String(e); });
