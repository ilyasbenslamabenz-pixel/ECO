/**
 * Amorçage du jeu (thread principal) — intégration.
 * Câble : catalogue -> rendu -> worker de simulation -> interface -> entrées -> construction -> sauvegardes.
 * Aucune règle de jeu ici : la simulation tourne dans le worker (src/sim) ; ce fichier ne fait que relayer.
 *
 * Modes d'URL : ?demo (scène de démonstration), ?autostart (partie immédiate), ?validate (porte visuelle),
 * ?seed=N (graine de la partie), ?h=H (heure de départ).
 */
import * as THREE from 'three';
import { DEFAULT_START_MONEY, GAME_NAME, PROTOCOL_VERSION, type SimSpeed } from './shared/constants';
import { validateCatalog } from './shared/catalog';
import type { CommandError, NewGameParams, SaveFile } from './shared/contracts';
import { terrainBounds } from './shared/terrain-gen';
import type { CityBuildResult } from './sim/city-builder';
import type { SimNotice } from './sim/sim-protocol';
import { SimBridge, SimCommandError } from './client/sim-bridge';
import { createClientState } from './client/state';
import { AssetLibrary, fetchCatalog } from './render/assets';
import { initRender, type RenderStats } from './render';
import { PropLayer } from './render/props';
import { initConstruction, initInput } from './input';
import { initUI } from './ui/hud';
import { applyGraphicsOptions } from './ui/options';
import { gameDateLabel, setSlotProvider, type SlotInfo as UiSlotInfo } from './ui/save-slots';
import { Autosaver, SaveStore } from './save';

const QUICK_SLOT = 'rapide';
const DEMO_SEED = 7;

/** Diagnostic exposé pour les tests e2e et la porte visuelle (lecture seule, plus quelques commandes de test). */
interface DebugInfo {
  ready: boolean;
  workerReady: boolean;
  snapshotReceived: boolean;
  deltas: number;
  frames: () => number;
  catalogAssets: number;
  errors: string[];
  lastStats: unknown;
  /** Vrai quand la scène de démonstration est construite ET que tous ses modèles sont chargés. */
  demoReady: boolean;
  demo: (Omit<CityBuildResult, 'decor'> & { vehicles: number; decor: number }) | null;
  renderStats: () => RenderStats | null;
  /** Commandes de test : caméra et requêtes au worker. */
  setCamera?: (mode: 'aerial' | 'street' | 'demo-aerial' | 'demo-street') => void;
  send?: (name: string, args: unknown) => Promise<unknown>;
  saveStoreKind?: string;
  constructionApplied?: () => number;
  validate?: () => Promise<unknown>;
  lastReport?: unknown;
  /** État détaillé de la scène (porte visuelle) : modèles chargés, erreurs, décor, terrain, eau. */
  sceneCheck?: () => unknown;
  cameraPose?: () => unknown;
}
declare global { interface Window { __aube: DebugInfo } }

function errText(e: unknown): string {
  if (e instanceof SimCommandError) return e.error.message;
  return e instanceof Error ? e.message : String(e);
}

async function boot(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const debug: DebugInfo = {
    ready: false, workerReady: false, snapshotReceived: false, deltas: 0, frames: () => 0, catalogAssets: 0, errors: [],
    lastStats: null, demoReady: false, demo: null, renderStats: () => null,
  };
  window.__aube = debug;
  // GLTFLoader : les textures externes partagées entre GLB ne sont téléchargées qu'une fois.
  THREE.Cache.enabled = true;
  const state = createClientState();
  const assetsBase = new URL('./assets/', import.meta.url);
  const workerUrl = new URL('./sim.worker.js', import.meta.url);

  let speedBeforeMenu: SimSpeed = 1;
  let bridge: SimBridge | null = null;
  let store: SaveStore | null = null;
  let autosaver: Autosaver | null = null;
  let demoRunning = false;
  const needBridge = (): SimBridge => { if (!bridge) throw new Error('Simulation non démarrée'); return bridge; };

  const ui = initUI({
    onNewGame: () => { void startNewGame(); },
    onNewGameWith: (p) => { void startNewGame({ cityName: p.cityName, seed: p.seed, mapChunks: p.mapChunks, startMoney: p.startMoney }); },
    onContinue: () => {
      if (state.inGame) { ui.hideMenu(); void needBridge().send('setSpeed', { speed: speedBeforeMenu }); return; }
      void loadSlot(QUICK_SLOT);
    },
    onLoadSlot: (slot) => { void loadSlot(slot); },
    onSaveSlot: (slot) => saveSlot(slot),
    onDemo: () => { void startDemo(); },
    onQuit: () => {
      autosaver?.stop();
      void bridge?.send('setSpeed', { speed: 0 });
      state.inGame = false;
      void refreshMenu();
    },
    onOptions: (o) => applyGraphicsOptions(o, { renderer: render.ctx.renderer, scene: render.ctx.scene, sun: render.ctx.sun, camera: input.camera }),
    onSpeed: (speed) => { void needBridge().send('setSpeed', { speed }).catch((e: unknown) => ui.toast(errText(e), 'error')); },
    onToggleCamera: () => { input.camera.setMode(input.camera.mode === 'aerial' ? 'street' : 'aerial'); },
    onSave: () => { void saveSlot(QUICK_SLOT); },
    onMenu: () => {
      speedBeforeMenu = (state.stats?.speed ?? 1) || 1;
      void bridge?.send('setSpeed', { speed: 0 });
      void refreshMenu();
    },
  });
  const refreshMenu = async (): Promise<void> => {
    const can = state.inGame || (store ? await store.has(QUICK_SLOT) : false);
    ui.showMenu({ canContinue: can, inGame: state.inGame });
  };

  ui.setLoading(0.05, 'Chargement du catalogue d\'assets…');
  const catalog = await fetchCatalog(assetsBase);
  const issues = validateCatalog(catalog);
  if (issues.length) console.warn('Catalogue : problèmes détectés', issues);
  debug.catalogAssets = catalog.assets.length;
  const lib = new AssetLibrary(catalog, assetsBase);

  ui.setLoading(0.2, 'Préparation du rendu 3D (ciel, terrain, végétation)…');
  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const render = await initRender(canvas, lib, catalog, assetsBase);
  debug.frames = () => render.ctx.frames;
  debug.renderStats = () => render.stats();
  const props = new PropLayer(render.ctx.scene, lib);
  debug.sceneCheck = () => ({
    buildings: render.buildings.count, buildingErrors: render.buildings.errors.slice(0, 20), buildingsLoading: render.buildings.loading,
    buildingsVisibleByLod: Array.from(render.buildings.visible), vehicles: render.vehicles.stats(), vehicleErrors: render.vehicles.loadErrors.slice(0, 20),
    vegetation: render.veg.stats(), props: Object.fromEntries(props.counts), terrain: render.terrain.stats(), water: render.water.stats(),
    roads: { segments: render.roads.net.segCount, nodes: render.roads.net.nodeCount }, camera: input.camera.mode,
  });
  const input = initInput(render.ctx.camera, canvas, (x, z) => render.terrain.heightAt(x, z));
  input.camera.setModeListener((m) => { state.cameraMode = m; ui.setCameraMode(m); });
  debug.cameraPose = () => input.camera.getPose();
  applyGraphicsOptions(ui.currentOptions(), { renderer: render.ctx.renderer, scene: render.ctx.scene, sun: render.ctx.sun, camera: input.camera });

  // LOD de simulation : point focal envoyé quand la caméra s'est déplacée de plus de 50 m.
  let focusX = Infinity, focusZ = Infinity;
  render.ctx.onFrame.unshift((dt) => {
    input.camera.update(dt);
    const p = input.camera.getPose();
    render.followView(p);
    if (bridge && state.inGame && Math.hypot(p.targetX - focusX, p.targetZ - focusZ) > 50) {
      focusX = p.targetX; focusZ = p.targetZ;
      void bridge.sendExt('setFocus', { x: focusX, z: focusZ }).catch(() => undefined);
    }
  });

  if (params.has('validate')) {
    // Mode porte de validation visuelle : pas de partie, inspection des assets à la demande.
    const { validateAllAssets } = await import('./render/validation');
    debug.validate = () => validateAllAssets(lib);
    debug.ready = true;
    ui.hideLoading();
    return;
  }

  ui.setLoading(0.5, 'Démarrage de la simulation…');
  bridge = await SimBridge.create(workerUrl);
  const b = bridge;
  debug.send = (name, args) => b.send(name as never, args as never);
  b.onLog((m) => { (m.level === 'error' ? console.error : console.log)(`[sim] ${m.message}`); if (m.level === 'error') debug.errors.push(m.message); });

  // Construction (miroir de la simulation, outils, aperçus) : branchée AVANT le premier instantané.
  const cons = initConstruction({ sim: b, ui, input, scene: render.ctx.scene, models: lib, catalog, heightAt: (x, z) => render.terrain.heightAt(x, z) });
  render.ctx.onFrame.push((dt) => cons.update(dt));
  debug.constructionApplied = () => cons.machine.applied;

  let firstSnapshot: (() => void) | null = null;
  const seenNotices = new Set<string>();
  b.onSnapshot((s) => {
    debug.snapshotReceived = true;
    state.inGame = true;
    state.cityName = s.params.cityName;
    render.applySnapshot(s);
    if (!demoRunning) props.clear();
    input.camera.bounds = terrainBounds(s.terrain);
    state.stats = s.stats;
    ui.updateStats(s.stats);
    ui.showHud(s.params.cityName);
    focusX = Infinity;
    firstSnapshot?.();
    firstSnapshot = null;
  });
  b.onDelta((d) => {
    debug.deltas++;
    render.applyDelta(d);
    state.stats = d.stats;
    debug.lastStats = d.stats;
    ui.updateStats(d.stats);
    if (d.report) {
      debug.lastReport = d.report;
      // Notifications de la simulation (faillite, nouvelle année, démolition…) : affichées une fois.
      for (const n of d.report.notices as SimNotice[]) {
        const key = `${n.minute}|${n.message}`;
        if (seenNotices.has(key)) continue;
        seenNotices.add(key);
        if (seenNotices.size > 1 && state.inGame) ui.toast(n.message, n.level === 'info' ? 'info' : 'error');
      }
    }
  });
  await b.ready;
  debug.workerReady = true;
  await b.send('init', { protocolVersion: PROTOCOL_VERSION, catalog });

  // Sauvegardes : IndexedDB (gzip) -> localStorage -> mémoire ; emplacements listés par l'interface.
  store = await SaveStore.open();
  debug.saveStoreKind = store.backend.kind;
  const st = store;
  setSlotProvider({
    list: async () => (await st.list()).map((s): UiSlotInfo => ({
      slot: s.slot, cityName: s.cityName, savedAt: s.savedAt, money: s.money, buildings: s.buildings, gameDate: gameDateLabel(s.totalMinutes), version: s.version,
    })),
    remove: async (slot) => { await st.remove(slot); return true; },
  });
  autosaver = new Autosaver(async () => (await b.send('save', { slot: 'auto' })).data as SaveFile, st, { onError: (m: string) => ui.toast(m, 'error') });

  const waitSnapshot = (): Promise<void> => new Promise((res) => { firstSnapshot = res; });

  async function saveSlot(slot: string): Promise<void> {
    try {
      const r = await b.send('save', { slot });
      const w = await st.save(slot, r.data);
      if (w.ok) ui.toast(`Partie sauvegardée (« ${slot} »)`, 'ok'); else ui.toast(w.message, 'error');
    } catch (e) { ui.toast(errText(e), 'error'); }
  }

  async function loadSlot(slot: string): Promise<void> {
    const r = await st.load(slot);
    if (!r.ok) { ui.toast(`Chargement impossible : ${r.message}`, 'error'); return; }
    try {
      demoRunning = false;
      const snap = waitSnapshot();
      await b.send('load', { data: r.value });
      await snap;
      ui.hideMenu();
      ui.toast('Partie chargée', 'ok');
      autosaver?.start();
      await b.send('setSpeed', { speed: 1 });
    } catch (e) { ui.toast(`Chargement impossible : ${errText(e)}`, 'error'); }
  }

  async function startNewGame(p: Partial<NewGameParams> = {}): Promise<void> {
    try {
      demoRunning = false;
      const snap = waitSnapshot();
      await b.send('newGame', {
        seed: p.seed ?? (params.has('seed') ? Number(params.get('seed')) | 0 : (Math.random() * 2 ** 31) | 0),
        mapChunks: p.mapChunks ?? 8,
        startMoney: p.startMoney ?? DEFAULT_START_MONEY,
        cityName: p.cityName ?? 'Nouvelle-Aube',
        startHour: params.has('h') ? Number(params.get('h')) : 9,
      });
      await snap;
      const s = render.terrain.heightAt(0, 0);
      input.camera.setPose({ targetX: 0, targetZ: 0, targetY: s, distance: 420, yaw: 0.6 });
      input.camera.setHome();
      ui.hideMenu();
      autosaver?.start();
      await b.send('setSpeed', { speed: 1 });
    } catch (e) {
      const err = e instanceof SimCommandError ? e.error : ({ code: 'INVALID_ARGS', message: errText(e) } as CommandError);
      ui.toast(`Impossible de créer la partie : ${err.message}`, 'error');
    }
  }

  /** Scène de démonstration : vraie partie, ville construite par la simulation avec les opérations du joueur. */
  async function startDemo(): Promise<void> {
    try {
      demoRunning = true;
      debug.demoReady = false;
      ui.hideMenu();
      ui.setLoading(0.55, 'Scène de démonstration : génération du terrain…');
      let snap = waitSnapshot();
      await b.send('newGame', { seed: DEMO_SEED, mapChunks: 8, startMoney: 2_000_000_000, cityName: 'Aube-sur-Mer (démonstration)', startHour: params.has('h') ? Number(params.get('h')) : 10.5 });
      await snap;
      ui.setLoading(0.65, 'Construction de la ville (routes, ponts, bâtiments, habitants)…');
      snap = waitSnapshot();
      const city = await b.sendExt('buildCity', { preset: 'demo', vehicles: 140 });
      await snap;
      ui.setLoading(0.8, 'Chargement de tous les modèles 3D…');
      const H = (x: number, z: number): number => render.terrain.heightAt(x, z);
      const vegIds = new Set(render.veg.speciesList.map((sp) => sp.asset.id));
      props.clear();
      render.veg.plant(city.decor.filter((d) => vegIds.has(d.assetId)).map((d) => ({ x: d.x, z: d.z, assetId: d.assetId })));
      await props.add(city.decor.filter((d) => !vegIds.has(d.assetId)), H);
      await render.whenReady(true);
      const [ax, az] = city.views.aerial;
      demoViews = { ax, az, street: city.views.street };
      setDemoCamera('aerial');
      input.camera.setHome();
      debug.demo = { ...city, decor: city.decor.length };
      ui.hideLoading();
      ui.toast(`Démonstration : ${city.buildings} bâtiments (${city.distinctBuildings} modèles différents), ${city.vehicles} véhicules. Touche V : vue rue.`, 'info');
      await b.send('setSpeed', { speed: 1 });
      debug.demoReady = true;
    } catch (e) {
      ui.hideLoading();
      ui.toast(`Scène de démonstration impossible : ${errText(e)}`, 'error');
      debug.errors.push(`demo: ${errText(e)}`);
    }
  }

  /** Ville de test de charge (?stress) : 500 bâtiments et 1000 véhicules réels, mesures via __aube.renderStats(). */
  async function startStress(): Promise<void> {
    try {
      demoRunning = true;
      ui.hideMenu();
      ui.setLoading(0.6, 'Test de charge : génération…');
      let snap = waitSnapshot();
      await b.send('newGame', { seed: Number(params.get('seed') ?? 7) | 0, mapChunks: 10, startMoney: 4_000_000_000, cityName: 'Test de charge', startHour: 11, terrain: { hydrology: 'lac', rivers: 0.2 } });
      await snap;
      snap = waitSnapshot();
      const city = await b.sendExt('buildCity', { preset: 'stress', maxBuildings: Number(params.get('n') ?? 500), vehicles: Number(params.get('v') ?? 1000) });
      await snap;
      await render.whenReady(true);
      const [ax, az] = city.views.aerial;
      demoViews = { ax, az, street: city.views.street };
      setDemoCamera('aerial');
      input.camera.setPose({ distance: 1100 });
      debug.demo = { ...city, decor: city.decor.length };
      ui.hideLoading();
      await b.send('setSpeed', { speed: 1 });
      debug.demoReady = true;
    } catch (e) {
      ui.hideLoading();
      debug.errors.push(`stress: ${errText(e)}`);
    }
  }

  let demoViews: { ax: number; az: number; street: CityBuildResult['views']['street'] } | null = null;
  const setDemoCamera = (m: 'aerial' | 'street'): void => {
    if (!demoViews) return;
    const v = demoViews;
    if (m === 'aerial') {
      if (input.camera.mode === 'street') input.camera.setMode('aerial');
      input.camera.setPose({ targetX: v.ax, targetZ: v.az, targetY: render.terrain.heightAt(v.ax, v.az), distance: 560, yaw: -0.75, pitch: 0.62 });
    } else {
      const s = v.street;
      input.camera.setStreetPosition(s.x, s.z, Math.atan2(-(s.lookX - s.x), -(s.lookZ - s.z)));
      input.camera.setMode('street');
    }
  };
  debug.setCamera = (m) => {
    if (m === 'demo-aerial') setDemoCamera('aerial');
    else if (m === 'demo-street') setDemoCamera('street');
    else input.camera.setMode(m);
  };

  render.ctx.start();
  ui.setLoading(1, 'Prêt');
  ui.hideLoading();
  ui.setMenuFoot(`${GAME_NAME} · ${catalog.assets.length} modèles 3D au catalogue · sauvegardes : ${store.backend.kind}`);
  if (params.has('stress')) await startStress();
  else if (params.has('demo')) await startDemo();
  else if (params.has('autostart')) await startNewGame();
  else await refreshMenu();
  debug.ready = true;
}

boot().catch((e: unknown) => {
  console.error(e);
  const t = document.getElementById('loading-text');
  if (t) t.textContent = `Erreur au démarrage : ${errText(e)}`;
  window.__aube?.errors.push(errText(e));
});
