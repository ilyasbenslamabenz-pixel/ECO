/**
 * Scène de test du module construction/caméra/UI (hors jeu, non incluse dans dist/).
 * Vrai rendu (src/render, vrais GLB du catalogue + fragments bâtiments/véhicules), vraie UI,
 * vrais outils ; la simulation est remplacée par MockSim (src/input/mocks.ts).
 * Construite et pilotée par tests/construction/demo.mjs (captures Playwright).
 * Propriétaire : agent construction/caméra/UI.
 */
import * as THREE from 'three';
import type { AssetCatalog, CatalogAsset } from '../../shared/catalog';
import { terrainBounds } from '../../shared/terrain-gen';
import { AssetLibrary } from '../../render/assets';
import { initRender } from '../../render';
import { initUI } from '../../ui/hud';
import { applyGraphicsOptions, loadOptions } from '../../ui/options';
import { initConstruction, initInput } from '../index';
import { MockSim, mergeCatalogs } from '../mocks';

type Frag = { assets?: CatalogAsset[]; textureSets?: AssetCatalog['textureSets'] };

async function getJson<T>(url: URL): Promise<T | null> {
  try { const r = await fetch(url); return r.ok ? ((await r.json()) as T) : null; } catch { return null; }
}

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const assetsBase = new URL(params.get('assets') ?? '../../../assets/', location.href);
  const base = await getJson<AssetCatalog>(new URL('catalog.json', assetsBase));
  if (!base) throw new Error('catalogue introuvable');
  const frags = await Promise.all(['catalog.buildings.residential.json', 'catalog.buildings.other.json', 'catalog.vehicles.json'].map((f) => getJson<Frag>(new URL(f, assetsBase))));
  const catalog = mergeCatalogs(base, ...frags.filter((f): f is Frag => !!f));
  THREE.Cache.enabled = true;
  const lib = new AssetLibrary(catalog, assetsBase);
  const mock = new MockSim(catalog, Number(params.get('seed') ?? 7), 4, 20_000_000, 'Clair-Vallon');

  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const render = await initRender(canvas, lib, catalog, assetsBase);
  const input = initInput(render.ctx.camera, canvas, (x, z) => render.terrain.heightAt(x, z));
  const ui = initUI({
    onNewGame: () => ui.hideMenu(),
    onNewGameWith: (p) => { ui.hideMenu(); ui.toast(`Démo : paramètres reçus (${p.cityName}, graine ${p.seed}, ${p.mapChunks} chunks)`, 'info'); },
    onContinue: () => ui.hideMenu(),
    onSpeed: (speed) => { void mock.send('setSpeed', { speed }); },
    onToggleCamera: () => input.camera.setMode(input.camera.mode === 'aerial' ? 'street' : 'aerial'),
    onSave: () => ui.toast('Démo : sauvegarde non branchée (MockSim)', 'info'),
    onMenu: () => ui.showMenu({ canContinue: false, inGame: true }),
    onOptions: (o) => applyGraphicsOptions(o, { renderer: render.ctx.renderer, scene: render.ctx.scene, sun: render.ctx.sun, camera: input.camera }),
  });
  input.camera.setModeListener((m) => ui.setCameraMode(m));
  mock.onSnapshot((s) => {
    render.applySnapshot(s);
    input.camera.bounds = terrainBounds(s.terrain);
    ui.updateStats(s.stats);
    ui.showHud(s.params.cityName);
  });
  mock.onDelta((d) => { render.applyDelta(d); ui.updateStats(d.stats); });
  const cons = initConstruction({ sim: mock, ui, input, scene: render.ctx.scene, models: lib, catalog, heightAt: (x, z) => render.terrain.heightAt(x, z) });
  render.ctx.onFrame.unshift((dt) => {
    input.camera.update(dt);
    const p = input.camera.getPose();
    render.followView(p);
    cons.update(dt);
  });
  applyGraphicsOptions(loadOptions(), { renderer: render.ctx.renderer, scene: render.ctx.scene, sun: render.ctx.sun, camera: input.camera });
  mock.start(100);

  // Quartier de départ construit par de VRAIES commandes (validées par MockSim) autour d'un site plat et sec.
  const h = mock.heightAt;
  let cx = 0; let cz = 0;
  search: for (let r = 0; r < 500; r += 24) for (let a = 0; a < 12; a++) {
    const x = Math.round((Math.cos(a) * r) / 8) * 8; const z = Math.round((Math.sin(a) * r) / 8) * 8;
    let lo = Infinity; let hi = -Infinity;
    for (let dx = -120; dx <= 120; dx += 12) for (let dz = -80; dz <= 80; dz += 12) { const v = h(x + dx, z + dz); lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (lo > mock.terrain.waterLevel + 1.5 && hi - lo < 9) { cx = x; cz = z; break search; }
  }
  const tryRoad = (pts: number[], type: 'street' | 'avenue' | 'boulevard' = 'street'): Promise<unknown> => mock.send('buildRoad', { type, points: pts }).catch(() => null);
  await tryRoad([cx - 120, cz, cx + 120, cz], 'avenue');
  await tryRoad([cx, cz - 90, cx, cz + 90]);
  const m = cons.machine;
  const place = async (id: string, x: number, z: number): Promise<void> => {
    const a = catalog.assets.find((q) => q.id === id);
    if (!a) return;
    const { proposePlacement } = await import('../../client/tools/snapping');
    mock.step();
    const p = proposePlacement(cons.mirror, a, x, z, { rot: 0, autoAlign: true });
    await mock.send('placeBuilding', { assetId: id, x: p.x, z: p.z, rot: p.rot, variant: a.variants.length ? Math.floor(Math.random() * a.variants.length) : -1 }).catch(() => null);
  };
  mock.step();
  await place('immeuble_haussmannien', cx - 40, cz + 20);
  await place('maison_pavillon_enduit', cx - 75, cz + 18);
  await place('commerce_cafe_terrasse', cx + 25, cz + 16);
  await place('public_ecole', cx + 60, cz - 30);
  await place('tour_residentielle_balcons', cx - 45, cz - 30);
  await place('maison_chalet_bois', cx + 22, cz + 60);
  mock.step();
  input.camera.setPose({ targetX: cx + 10, targetZ: cz + 10, distance: 230, yaw: 0.7, pitch: 0.75 });
  input.camera.setHome();
  render.ctx.start();
  ui.hideLoading();

  const v = new THREE.Vector3();
  (window as unknown as { __demo: unknown }).__demo = {
    mock, cons, input, ui, render, lib, catalog, center: { x: cx, z: cz }, machine: m,
    /** Projection monde -> écran (px CSS). */
    project(x: number, y: number | null, z: number): { x: number; y: number } {
      v.set(x, y ?? render.terrain.heightAt(x, z), z).project(render.ctx.camera);
      return { x: ((v.x + 1) / 2) * canvas.clientWidth, y: ((1 - v.y) / 2) * canvas.clientHeight };
    },
    frames: () => render.ctx.frames,
    ready: true,
  };
}

main().catch((e: unknown) => {
  console.error(e);
  const t = document.getElementById('loading-text');
  if (t) t.textContent = `Erreur : ${e instanceof Error ? e.message : String(e)}`;
  (window as unknown as { __demoError: string }).__demoError = String(e);
});
