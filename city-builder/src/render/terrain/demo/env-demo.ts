/**
 * Démo de l'agent environnement (hors jeu) : génère un monde dans le worker de génération et affiche
 * terrain + eau + ciel + végétation avec les vrais assets du catalogue.
 * Paramètres d'URL : seed, chunks, hyd (mer|lac|aucune), forest, h (heure), cam (aerien|survol|rue|riviere|montagne),
 * veg=0 (sans végétation). Expose window.__env (état, statistiques) pour les captures Playwright.
 */
import * as THREE from 'three';
import { fetchCatalog, AssetLibrary } from '../../assets';
import { TerrainSystem } from '../renderer';
import { WaterSystem } from '../../water/water-system';
import { SkySystem } from '../../sky/sky-system';
import { VegetationSystem } from '../../nature/vegetation';
import type { GenRequest, GenResponse } from '../../../sim/terrain/gen.worker';
import type { WorldTerrain } from '../../../sim/terrain/types';
import { applyTerraform, extractPatch } from '../../../sim/terrain/terraform';

interface EnvState {
  phase: string;
  ready: boolean;
  error: string | null;
  stats: Record<string, unknown>;
  frames: number;
}
const state: EnvState = { phase: 'init', ready: false, error: null, stats: {}, frames: 0 };
(window as unknown as { __env: EnvState }).__env = state;

const q = new URLSearchParams(location.search);
const num = (k: string, d: number): number => (q.has(k) ? Number(q.get(k)) : d);

function generate(params: Record<string, unknown>): Promise<WorldTerrain> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./terrain-gen.worker.js', import.meta.url));
    w.onmessage = (e: MessageEvent<GenResponse>): void => {
      w.terminate();
      if (e.data.kind === 'world') resolve(e.data.world); else reject(new Error(e.data.message));
    };
    w.onerror = (e): void => { w.terminate(); reject(new Error(e.message)); };
    w.postMessage({ kind: 'generate', reqId: 1, params } satisfies GenRequest);
  });
}

async function main(): Promise<void> {
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.5, 9000);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.4);
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  scene.add(hemi, sun, sun.target);

  const base = new URL('./assets/', location.href);
  state.phase = 'catalogue';
  const catalog = await fetchCatalog(base);
  // Démo : assets d'environnement générés mais pas encore fusionnés au catalogue par `npm run assets`
  // (fragment écrit par tools/generators/environment.ts ; ignoré s'il est absent).
  try {
    const r = await fetch('./nature-fragment.json');
    if (r.ok) {
      const frag = (await r.json()) as { assets: typeof catalog.assets };
      for (const a of frag.assets) if (!catalog.assets.some((x) => x.id === a.id)) catalog.assets.push(a);
      state.stats['fragment'] = frag.assets.map((a) => a.id);
    }
  } catch { /* fragment facultatif */ }
  state.phase = 'génération';
  const t0 = performance.now();
  const world = await generate({
    seed: num('seed', 7), mapChunks: num('chunks', 8), hydrology: q.get('hyd') ?? 'mer', forest: num('forest', 0.55),
    relief: num('relief', 0.5), maxAltitude: num('alt', 140), rivers: num('rivers', 0.5), erosion: num('erosion', 0.6),
  });
  state.stats['generationMs'] = Math.round(performance.now() - t0);
  state.stats['world'] = world.stats;
  state.phase = 'ciel';
  const sky = await SkySystem.create({ renderer, scene, sun, hemi, catalog, assetsBase: base, shadowMapSize: 2048 });
  sky.setTimeOfDay(num('h', 15));
  state.phase = 'terrain';
  const terrain = new TerrainSystem(scene, { catalog, assetsBase: base });
  terrain.build(world);
  const water = new WaterSystem(scene);
  water.build(world);
  await terrain.ready;

  // Cadrages.
  const H = (x: number, z: number): number => terrain.heightAt(x, z);
  const camName = q.get('cam') ?? 'aerien';
  const half = ((world.samplesX - 1) * world.spacing) / 2;
  let target = new THREE.Vector3(0, H(0, 0), 0);
  let dist = 1000;
  // Point de rivière (premier tracé) et point de montagne (plus haut échantillon).
  const river = world.rivers[0];
  let rx = 0;
  let rz = 0;
  if (river) {
    const mid = Math.floor(river.points.length / 8) * 4;
    rx = river.points[mid]!; rz = river.points[mid + 2]!;
  }
  let mx = 0;
  let mz = 0;
  let mh = -1e9;
  for (let k = 0; k < world.heights.length; k += 7) if (world.heights[k]! > mh) { mh = world.heights[k]!; mx = world.originX + (k % world.samplesX) * world.spacing; mz = world.originZ + Math.floor(k / world.samplesX) * world.spacing; }
  switch (camName) {
    case 'survol':
      camera.position.set(-half * 0.2, H(0, 0) + 420, half * 0.85);
      target.set(0, H(0, 0), 0);
      break;
    case 'rue': {
      const x = num('x', rx + 60);
      const z = num('z', rz + 40);
      camera.position.set(x, H(x, z) + 1.7, z);
      target.set(x + 80, H(x + 80, z - 60) + 4, z - 60);
      break;
    }
    case 'riviere':
      camera.position.set(rx + 90, H(rx, rz) + 45, rz + 120);
      target.set(rx, H(rx, rz), rz);
      break;
    case 'foret': {
      // Point de forêt dense le plus proche du centre.
      let best = 1e18;
      let fx = 0;
      let fz = 0;
      for (let k = 0; k < world.forest.length; k += 3) {
        if (world.forest[k]! < 200) continue;
        const x = world.originX + (k % world.samplesX) * world.spacing;
        const z = world.originZ + Math.floor(k / world.samplesX) * world.spacing;
        const d = x * x + z * z;
        if (d < best) { best = d; fx = x; fz = z; }
      }
      camera.position.set(fx + 70, H(fx + 70, fz + 90) + 40, fz + 90);
      target.set(fx, H(fx, fz) + 5, fz);
      break;
    }
    case 'montagne':
      camera.position.set(mx * 0.55, H(mx * 0.55, mz * 0.55) + 160, mz * 0.55);
      target.set(mx, mh * 0.8, mz);
      break;
    default:
      camera.position.set(0, 1500, half * 1.25);
      target.set(0, 0, -half * 0.05);
  }
  camera.lookAt(target);
  dist = camera.position.distanceTo(target);
  sky.followView(target.x, target.y, target.z, Math.min(dist, 900));

  let veg: VegetationSystem | null = null;
  if (q.get('veg') !== '0') {
    state.phase = 'végétation';
    const lib = new AssetLibrary(catalog, base);
    veg = new VegetationSystem(scene, lib, { heightAt: H, renderer });
    await veg.load();
    veg.syncLights(sun, hemi, sky.ambientSky, sky.ambientGround);
    veg.scatter(world);
  }

  // ?cam=vitrine : une rangée de chaque essence / décor naturel, au premier plan (contrôle visuel des modèles).
  if (camName === 'vitrine' && veg) {
    const list = veg.speciesList;
    const cx = num('x', 0);
    const cz = num('z', 0);
    veg.removeInRect(cx - 120, cz - 60, cx + 120, cz + 60);
    const items = list.map((sp, i) => ({ x: cx - (list.length - 1) * 6 + i * 12, z: cz, assetId: sp.asset.id, rot: 0.6, scale: sp.role === 'rocher' || sp.role === 'fleur' || sp.role === 'arbuste' ? 1.6 : undefined }));
    veg.plant(items);
    // Mobilier généré par l'agent environnement (hors végétation) : fontaine au premier plan.
    const lib2 = new AssetLibrary(catalog, base);
    if (lib2.get('fontaine_place')) {
      const f = (await lib2.load('fontaine_place', 0)).clone(true);
      const fx = cx + 14;
      const fz = cz + 40;
      f.position.set(fx, H(fx, fz) - 0.05, fz);
      scene.add(f);
      state.stats['fontaine'] = true;
    }
    camera.position.set(cx, H(cx, cz + 75) + 9, cz + 75);
    target.set(cx, H(cx, cz) + 6, cz);
    camera.lookAt(target);
    sky.followView(target.x, target.y, target.z, 90);
    state.stats['vitrine'] = items.map((i) => i.assetId);
  }

  // ?terra=1 : démonstration de terraformation (rôle de la simulation joué ici) : aplanissement d'un plateau
  // et creusement d'un bassin au point visé, patch appliqué au terrain, à l'eau et à la végétation.
  if (q.get('terra') === '1') {
    // Zone sèche (aucune eau à moins de 160 m) la plus proche du point visé.
    let bx = target.x;
    let bz = target.z;
    let bd = 1e18;
    const W = world.samplesX;
    for (let j = 25; j < world.samplesZ - 25; j += 4) {
      for (let i = 25; i < W - 25; i += 4) {
        const x = world.originX + i * world.spacing;
        const z = world.originZ + j * world.spacing;
        const d = (x - target.x) ** 2 + (z - target.z) ** 2;
        if (d >= bd) continue;
        let dry = true;
        for (let dj = -20; dj <= 20 && dry; dj += 2) for (let di = -20; di <= 20 && dry; di += 2) {
          const k = (j + dj) * W + i + di;
          if (world.waterSurface[k]! > world.heights[k]!) dry = false;
        }
        if (dry) { bd = d; bx = x; bz = z; }
      }
    }
    target.set(bx, H(bx, bz), bz);
    camera.position.set(bx + 160, H(bx, bz) + 110, bz + 190);
    camera.lookAt(target);
    sky.followView(target.x, target.y, target.z, 260);
    const ops = [
      applyTerraform(world, { kind: 'flatten', x: target.x - 60, z: target.z, radius: 70, strength: 1, targetHeight: H(target.x - 60, target.z) + 6 }),
      applyTerraform(world, { kind: 'lower', x: target.x + 70, z: target.z + 20, radius: 45, strength: 9 }),
      applyTerraform(world, { kind: 'raise', x: target.x, z: target.z - 90, radius: 55, strength: 14 }),
      applyTerraform(world, { kind: 'smooth', x: target.x, z: target.z - 90, radius: 70, strength: 1 }),
    ];
    let vol = 0;
    for (const r of ops) {
      if (!r) continue;
      vol += r.volume;
      const patch = extractPatch(world, r.rect);
      terrain.applyPatch(patch);
      water.applyPatch(patch);
      const x0 = world.originX + r.rect.i0 * world.spacing;
      const z0 = world.originZ + r.rect.j0 * world.spacing;
      veg?.removeInRect(x0, z0, world.originX + r.rect.i1 * world.spacing, world.originZ + r.rect.j1 * world.spacing);
    }
    state.stats['terraformVolumeM3'] = Math.round(vol);
  }

  const resize = (): void => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();

  // Pré-chargement sans rendu : le streaming des chunks (worker) se stabilise pour ce cadrage.
  state.phase = 'streaming';
  camera.updateMatrixWorld();
  for (let it = 0; it < 4000; it++) {
    terrain.update(camera);
    if (terrain.settled && it > 2) break;
    await new Promise((r) => setTimeout(r, 15));
  }
  veg?.update(camera);
  state.phase = 'rendu';
  let last = performance.now();
  let settledFrames = 0;
  let afterReady = 0;
  // En capture (par défaut), la boucle s'arrête 2 images après la stabilisation : le rendu logiciel
  // (SwiftShader) est très lent et la capture doit voir une image figée. ?live=1 pour une boucle continue.
  const live = q.get('live') === '1';
  const loop = (): void => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    camera.updateMatrixWorld();
    terrain.update(camera);
    water.update(dt);
    sky.update(dt, camera);
    veg?.update(camera);
    renderer.render(scene, camera);
    state.frames++;
    if (terrain.settled && (veg?.settled ?? true)) settledFrames++; else settledFrames = 0;
    if (settledFrames > 1 && !state.ready) {
      state.stats['terrain'] = terrain.stats();
      state.stats['water'] = water.stats();
      state.stats['vegetation'] = veg?.stats() ?? null;
      state.stats['renderer'] = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, textures: renderer.info.memory.textures };
      state.ready = true;
      state.phase = 'prêt';
    }
    if (state.ready && !live && ++afterReady > 2) return;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

main().catch((e: unknown) => {
  state.error = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e);
  console.error(e);
});
