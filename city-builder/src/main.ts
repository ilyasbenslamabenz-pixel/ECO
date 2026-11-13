/**
 * Amorçage du jeu (thread principal) — intégration.
 * Câble : catalogue -> rendu -> worker de simulation -> interface -> entrées -> construction -> sauvegardes.
 * Aucune règle de jeu ici : la simulation tourne dans le worker (src/sim) ; ce fichier ne fait que relayer.
 *
 * Modes d'URL : ?demo (scène de démonstration), ?autostart (partie immédiate), ?validate (porte visuelle),
 * ?seed=N (graine de la partie), ?h=H (heure de départ).
 */
import * as THREE from 'three';
import { bootDone, bootStarted, deviceProfile, isSafeMode, setSafeMode } from './render/device-profile';
import { imageLimits } from './render/image-cap';
import { DEFAULT_START_MONEY, GAME_NAME, PROTOCOL_VERSION, type SimSpeed } from './shared/constants';
import { validateCatalog } from './shared/catalog';
import type { CommandError, NewGameParams, SaveFile, SimStats } from './shared/contracts';
import { terrainBounds } from './shared/terrain-gen';
import type { CityBuildResult } from './sim/city-builder';
import type { SimNotice, SimReport } from './sim/sim-protocol';
import type { SnapshotMessage } from './shared/protocol';
import { SimBridge, SimCommandError } from './client/sim-bridge';
import { createClientState } from './client/state';
import { AssetLibrary, fetchCatalog } from './render/assets';
import { initRender, type RenderStats } from './render';
import { PropLayer } from './render/props';
import { initConstruction, initInput } from './input';
import { initUI } from './ui/hud';
import { applyGraphicsOptions } from './ui/options';
import { gameDateLabel, installCloudSaveBadge, installSaveFileUi, setSlotProvider, type SlotInfo as UiSlotInfo } from './ui/save-slots';
import { Autosaver, SaveStore, attachCloudSaves, type CloudSaveStatus } from './save';
import { AutoSaveTriggers, IMPORTANT_COMMANDS, latestSlot } from './save/auto-triggers';
import { CloudSlotProvider } from './save/cloud';
import { BackupReminder, deliverFile, exportMeknes, importMeknes, importSlotName, requestPersistentStorage, resolveDownloads, type ExportFile } from './save/file-transfer';

const QUICK_SLOT = 'rapide';
const DEMO_SEED = 7;
/** Mois de départ des parties et de la démo : avril (printemps : arbres en feuilles avec l'atmosphère, docs/requests/atmosphere.md §7). */
const START_MONTH = 4;
/** Budget de la démo : la ville construite coûte ≈ 138 M ¢ ; il reste une trésorerie crédible (≈ 12 M ¢). */
const DEMO_START_MONEY = 150_000_000;

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
  /** Sauvegardes en ligne (artifact claude.ai) : état publié par src/save/cloud.ts. */
  cloudSave?: CloudSaveStatus;
  /** navigator.storage.persist() accordé (null : non pris en charge). */
  storagePersisted?: boolean | null;
  constructionApplied?: () => number;
  validate?: () => Promise<unknown>;
  lastReport?: unknown;
  /** État détaillé de la scène (porte visuelle) : modèles chargés, erreurs, décor, terrain, eau. */
  sceneCheck?: () => unknown;
  cameraPose?: () => unknown;
  /** Diagnostic de performance : masque / affiche un groupe de la scène par son nom (ex. « vegetation »). */
  setLayerVisible?: (name: string, visible: boolean) => string[];
  /** Rend une image de façon synchrone (lecture d'un pixel) et renvoie sa durée, ses appels et triangles. */
  benchFrame?: () => { ms: number; calls: number; triangles: number };
  pauseRender?: (paused: boolean) => void;
  /** Rend `n` images immédiatement (boucle suspendue : captures rapides en rendu logiciel). */
  renderNow?: (n?: number, dt?: number) => number;
  lookAt?: (x: number, z: number, distance: number, pitch?: number, yaw?: number) => void;
  /** Aperçu courant de l'outil de construction (e2e : rotation proposée, aimantation, validité). */
  toolPreview?: () => unknown;
  /** Statistiques portées par le dernier instantané complet (état exact au chargement). */
  snapshotStats?: SimStats;
  /** Projection écran (px CSS) d'un point au sol (e2e : clics souris à des positions monde précises). */
  worldToScreen?: (x: number, z: number) => { x: number; y: number };
  /** Feux tricolores dessinés (e2e) : bras, positions, états, instances. */
  signals?: () => unknown;
  /** Décor routier posé (e2e) : type et position de chaque lampadaire, arbre, banc… */
  roadDecor?: () => { kind: string; x: number; z: number }[];
  /** Dernier préchargement des bâtiments au chargement d'une partie (e2e : attente, préchauffage, plafond atteint). */
  lastPreload?: { totalMs: number; capped: boolean; pending: number };
  /** Compteurs de la scène et du rendu (e2e : non-régression mémoire). */
  memStats?: () => { geometries: number; textures: number; programs: number; objects: number; instanced: number; meshes: number; dom: number };
  /** Mode allégé retenu au démarrage, et mode sûr (après un chargement planté). */
  liteMode?: boolean;
  safeMode?: boolean;
  /** Nombre de pertes du contexte WebGL depuis le chargement (e2e). */
  contextLost?: number;
  /** Estimation de la mémoire GPU (Mo) : textures, géométries, cibles de rendu (e2e : mode mobile). */
  gpuMemory?: () => { texturesMo: number; textures: number; geometriesMo: number; geometries: number; ombresMo: number };
  /** Plante des arbres / plantes (e2e : planche des essences). */
  plantVeg?: (items: { x: number; z: number; assetId: string }[]) => number;
  /** Blocs de rivière maillés (e2e : cadrer une berge). */
  riverBlocks?: () => { x: number; z: number; tris: number }[];
  /** Copie de la dernière trame véhicules reçue (e2e : véhicules arrêtés aux feux). */
  lastVehicles?: { tick: number; ids: number[]; positions: number[] } | null;
  /** Active la copie `lastVehicles` (désactivée par défaut : aucune allocation en jeu). */
  trackVehicles?: boolean;
  /** Caméra rue placée en (x, z) regardant (lookX, lookZ). */
  streetLook?: (x: number, z: number, lookX: number, lookZ: number) => void;
  /** Hauteur du terrain (rendu) en (x, z). */
  heightAt?: (x: number, z: number) => number;
  /** Sauvegarde / chargement d'un emplacement nommé par le même chemin que l'interface (e2e). */
  saveSlot?: (slot: string) => Promise<void>;
  loadSlot?: (slot: string) => Promise<void>;
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
  // Repli sûr : si le chargement précédent ne s'est pas terminé (Safari a fermé l'onglet), on redémarre en
  // mode allégé forcé et qualité basse.
  const crashedBefore = bootStarted();
  const enteredSafeMode = crashedBefore && !isSafeMode();
  if (enteredSafeMode) setSafeMode(true);
  debug.safeMode = isSafeMode();
  // GLTFLoader : les textures externes partagées entre GLB ne sont téléchargées qu'une fois.
  THREE.Cache.enabled = true;
  const state = createClientState();
  const assetsBase = new URL('./assets/', import.meta.url);
  const workerUrl = new URL('./sim.worker.js', import.meta.url);

  let speedBeforeMenu: SimSpeed = 1;
  let bridge: SimBridge | null = null;
  let store: SaveStore | null = null;
  let autosaver: Autosaver | null = null;
  let autoTriggers: AutoSaveTriggers | null = null;
  /** Partie la plus récente (locale ou en ligne), proposée par « Continuer ». */
  let continueSlot: string | null = null;
  let demoRunning = false;
  const needBridge = (): SimBridge => { if (!bridge) throw new Error('Simulation non démarrée'); return bridge; };

  const ui = initUI({
    onNewGame: () => { void startNewGame(); },
    onNewGameWith: (p) => { void startNewGame({ cityName: p.cityName, seed: p.seed, mapChunks: p.mapChunks, startMoney: p.startMoney }); },
    onContinue: () => {
      if (state.inGame) { ui.hideMenu(); void needBridge().send('setSpeed', { speed: speedBeforeMenu }); return; }
      void loadSlot(continueSlot ?? QUICK_SLOT);
    },
    onLoadSlot: (slot) => { void loadSlot(slot); },
    onSaveSlot: (slot) => saveSlot(slot),
    onDemo: () => { void startDemo(); },
    onQuit: () => {
      void autoTriggers?.saveAndFlush();
      autosaver?.stop();
      void bridge?.send('setSpeed', { speed: 0 });
      state.inGame = false;
      void refreshMenu();
    },
    onOptions: (o) => { if (o.quality !== 'auto') setSafeMode(false); applyGraphicsOptions(o, { renderer: render.ctx.renderer, scene: render.ctx.scene, sun: render.ctx.sun, camera: input.camera }); },
    onSpeed: (speed) => { void needBridge().send('setSpeed', { speed }).catch((e: unknown) => ui.toast(errText(e), 'error')); },
    onToggleCamera: () => {
      if (input.camera.mode === 'aerial') {
        // Démo : tant que la vue aérienne est restée sur le centre (un carrefour), la vue rue part du trottoir prévu.
        const p = input.camera.getPose();
        if (demoRunning && demoViews && Math.hypot(p.targetX - demoViews.ax, p.targetZ - demoViews.az) < 40) setDemoCamera('street');
        else input.camera.setMode('street');
      } else input.camera.setMode('aerial');
    },
    onSave: () => { void saveSlot(QUICK_SLOT); },
    onMenu: () => {
      speedBeforeMenu = (state.stats?.speed ?? 1) || 1;
      void bridge?.send('setSpeed', { speed: 0 });
      void autoTriggers?.saveAndFlush();
      void refreshMenu();
    },
  });
  const refreshMenu = async (): Promise<void> => {
    continueSlot = store ? latestSlot(await store.list()) : null;
    ui.showMenu({ canContinue: state.inGame || continueSlot !== null, inGame: state.inGame });
  };

  ui.setLoading(0.05, 'Chargement du catalogue d\'assets…');
  const catalog = await fetchCatalog(assetsBase);
  const issues = validateCatalog(catalog);
  if (issues.length) console.warn('Catalogue : problèmes détectés', issues);
  debug.catalogAssets = catalog.assets.length;
  // Mode allégé (téléphone) : images réduites dès leur chargement, modèles chargés un par un.
  const bootProfile = deviceProfile(ui.currentOptions().quality);
  imageLimits.textureCap = bootProfile.textureCap;
  imageLimits.maxConcurrentModels = bootProfile.maxConcurrentModels;
  debug.liteMode = bootProfile.lite;
  const lib = new AssetLibrary(catalog, assetsBase);

  if (params.has('validate')) {
    // Mode porte de validation visuelle : pas de partie ni de scène, inspection des assets (renderer dédié).
    const { validateAllAssets } = await import('./render/validation');
    debug.validate = () => validateAllAssets(lib);
    debug.ready = true;
    bootDone();
    ui.hideLoading();
    return;
  }

  ui.setLoading(0.2, 'Préparation du rendu 3D (ciel, terrain, végétation)…');
  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const render = await initRender(canvas, lib, catalog, assetsBase, undefined, ui.currentOptions().quality);
  debug.frames = () => render.ctx.frames;
  debug.renderStats = () => render.stats();
  debug.gpuMemory = () => estimateGpuMemory(render.ctx.scene, render.ctx.renderer);
  debug.memStats = () => {
    const r = render.ctx.renderer;
    let objects = 0, instanced = 0, meshes = 0;
    render.ctx.scene.traverse((o) => { objects++; if ((o as THREE.InstancedMesh).isInstancedMesh) instanced++; else if ((o as THREE.Mesh).isMesh) meshes++; });
    return { geometries: r.info.memory.geometries, textures: r.info.memory.textures, programs: r.info.programs?.length ?? 0, objects, instanced, meshes, dom: document.getElementsByTagName('*').length };
  };
  const props = new PropLayer(render.ctx.scene, lib);
  debug.sceneCheck = () => ({
    buildings: render.buildings.count, buildingErrors: render.buildings.errors.slice(0, 20), buildingsLoading: render.buildings.loading,
    buildingsVisibleByLod: Array.from(render.buildings.visible), vehicles: render.vehicles.stats(), vehicleErrors: render.vehicles.loadErrors.slice(0, 20),
    vegetation: render.veg.stats(), props: Object.fromEntries(props.counts), terrain: render.terrain.stats(), water: render.water.stats(),
    roads: { segments: render.roads.net.segCount, nodes: render.roads.net.nodeCount }, camera: input.camera.mode,
  });
  const input = initInput(render.ctx.camera, canvas, (x, z) => render.terrain.heightAt(x, z));
  ui.attachWorld({ heightAt: (x, z) => render.terrain.heightAt(x, z) });
  input.camera.setModeListener((m) => { state.cameraMode = m; ui.setCameraMode(m); });
  debug.cameraPose = () => input.camera.getPose();
  debug.signals = () => render.signals.debug();
  debug.roadDecor = () => render.roads.decorItems();
  debug.heightAt = (x, z) => render.terrain.heightAt(x, z);
  debug.riverBlocks = () => render.water.inlandCenters();
  debug.plantVeg = (items) => render.veg.plant(items);
  debug.streetLook = (x, z, lx, lz) => {
    input.camera.setStreetPosition(x, z, Math.atan2(-(lx - x), -(lz - z)));
    if (input.camera.mode !== 'street') input.camera.setMode('street');
  };
  debug.lookAt = (x, z, distance, pitch, yaw) => {
    if (input.camera.mode === 'street') input.camera.setMode('aerial');
    input.camera.setPose({ targetX: x, targetZ: z, targetY: render.terrain.heightAt(x, z), distance, ...(pitch !== undefined ? { pitch } : {}), ...(yaw !== undefined ? { yaw } : {}) });
  };
  debug.benchFrame = () => {
    const r = render.ctx.renderer;
    const t0 = performance.now();
    r.render(render.ctx.scene, render.ctx.camera);
    const gl = r.getContext();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    return { ms: Math.round(performance.now() - t0), calls: r.info.render.calls, triangles: r.info.render.triangles };
  };
  // ?norender : la boucle d'affichage ne démarre jamais seule (tests en rendu logiciel : images à la demande via renderNow).
  const startLoop = (): void => { if (!params.has('norender')) render.ctx.start(); };
  debug.pauseRender = (p) => { if (p) render.ctx.stop(); else render.ctx.start(); };
  debug.renderNow = (n = 1, dt = 1 / 30) => {
    const t0 = performance.now();
    for (let i = 0; i < n; i++) render.ctx.renderNow(dt);
    const gl = render.ctx.renderer.getContext();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    return Math.round(performance.now() - t0);
  };
  debug.setLayerVisible = (name, visible) => {
    const names: string[] = [];
    for (const o of render.ctx.scene.children) { names.push(o.name || o.type); if (o.name === name) o.visible = visible; }
    return names;
  };
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

  ui.setLoading(0.5, 'Démarrage de la simulation…');
  bridge = await SimBridge.create(workerUrl);
  const b = bridge;
  // Sauvegarde automatique après construction/démolition (au plus 1/min) : src/save/auto-triggers.ts.
  const rawSend = b.send.bind(b);
  b.send = ((name, args) => {
    const p = rawSend(name, args);
    if (IMPORTANT_COMMANDS.has(name)) void p.then(() => autoTriggers?.noteAction(), () => undefined);
    return p;
  }) as typeof b.send;
  debug.send = (name, args) => b.send(name as never, args as never);
  b.onLog((m) => { (m.level === 'error' ? console.error : console.log)(`[sim] ${m.message}`); if (m.level === 'error') debug.errors.push(m.message); });

  // Construction (miroir de la simulation, outils, aperçus) : branchée AVANT le premier instantané.
  const cons = initConstruction({ sim: b, ui, input, scene: render.ctx.scene, models: lib, catalog, heightAt: (x, z) => render.terrain.heightAt(x, z) });
  render.ctx.onFrame.push((dt) => cons.update(dt));
  debug.constructionApplied = () => cons.machine.applied;
  debug.worldToScreen = (x, z) => {
    const v = new THREE.Vector3(x, render.terrain.heightAt(x, z), z).project(render.ctx.camera);
    const r = canvas.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  };
  debug.toolPreview = () => {
    const p = cons.machine.preview;
    if (p.kind === 'building') return { kind: p.kind, assetId: p.asset.id, x: p.proposal.x, z: p.proposal.z, rot: p.proposal.rot, snapped: p.proposal.snapped, validity: p.validity, message: p.message };
    if (p.kind === 'road') return { kind: p.kind, type: p.type, mode: p.mode, validity: p.validity, message: p.message, length: p.length };
    return { kind: p.kind };
  };

  let firstSnapshot: (() => void) | null = null;
  /** Barycentre et étendue de la ville du dernier instantané (bâtiments + nœuds de routes), null si vide. */
  let cityCenter: { x: number; z: number; extent: number } | null = null;
  const computeCityCenter = (s: SnapshotMessage): typeof cityCenter => {
    const pts: { x: number; z: number }[] = [...s.buildings, ...s.roads.nodes];
    if (pts.length === 0) return null;
    let x = 0, z = 0;
    for (const p of pts) { x += p.x; z += p.z; }
    x /= pts.length; z /= pts.length;
    // étendue : 90e centile des distances au barycentre (quelques routes isolées ne font pas dézoomer)
    const d = pts.map((p) => Math.hypot(p.x - x, p.z - z)).sort((a, b) => a - b);
    return { x, z, extent: d[Math.min(d.length - 1, Math.floor(d.length * 0.9))] ?? 0 };
  };
  /** Place la caméra aérienne sur (x, z) et affine aussitôt le terrain autour (pas de maillage grossier visible). */
  const focusCamera = (x: number, z: number, distance: number, yaw?: number): void => {
    if (input.camera.mode === 'street') input.camera.setMode('aerial');
    input.camera.setPose({ targetX: x, targetZ: z, targetY: render.terrain.heightAt(x, z), distance, ...(yaw !== undefined ? { yaw } : {}) });
    input.camera.setHome();
    render.terrain.refineAround(x, z, distance);
  };
  const seenNotices = new Set<string>();
  b.onSnapshot((s) => {
    debug.snapshotReceived = true;
    debug.snapshotStats = s.stats;
    cityCenter = computeCityCenter(s);
    state.inGame = true;
    state.cityName = s.params.cityName;
    render.applySnapshot(s);
    if (!demoRunning) props.clear();
    input.camera.bounds = terrainBounds(s.terrain);
    state.stats = s.stats;
    ui.updateStats(s.stats);
    ui.moduleSnapshot(s.ext);
    ui.showHud(s.params.cityName);
    focusX = Infinity;
    firstSnapshot?.();
    firstSnapshot = null;
  });
  b.onDelta((d) => {
    debug.deltas++;
    // Copie pour les tests (les tampons sont ensuite confiés au rendu) : quelques centaines de nombres par trame.
    if (debug.trackVehicles && d.vehicles) debug.lastVehicles = { tick: d.tick, ids: Array.from(d.vehicles.ids ?? []), positions: Array.from(d.vehicles.positions.subarray(0, d.vehicles.count * 4)) };
    render.applyDelta(d);
    if (d.ext) ui.moduleDelta(d.ext);
    state.stats = d.stats;
    debug.lastStats = d.stats;
    ui.updateStats(d.stats);
    if (d.report) {
      debug.lastReport = d.report;
      ui.updateReport(d.report as SimReport);
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
  ui.setExtPort(b);
  ui.setModuleBridge({ pluginCommand: async (plugin, name, payload) => (await b.send('pluginCommand', { plugin, name, ...(payload !== undefined ? { payload } : {}) })).data });
  await b.send('init', { protocolVersion: PROTOCOL_VERSION, catalog });

  // Sauvegardes : IndexedDB (gzip) -> localStorage -> mémoire ; emplacements listés par l'interface.
  store = await SaveStore.open();
  debug.saveStoreKind = store.backend.kind;
  // Sauvegardes en ligne (docs/SAUVEGARDES.md) : dans l'artifact claude.ai, SaveStore synchronisé
  // (locale immédiate + envoi en arrière-plan) ; ailleurs (window.claude absent), store inchangé.
  installCloudSaveBadge();
  store = await attachCloudSaves(store);
  const st = store;
  setSlotProvider({
    list: async () => (await st.list()).map((s): UiSlotInfo => ({
      slot: s.slot, cityName: s.cityName, savedAt: s.savedAt, money: s.money, buildings: s.buildings, gameDate: gameDateLabel(s.totalMinutes), version: s.version,
    })),
    remove: async (slot) => { await st.remove(slot); return true; },
  });
  autosaver = new Autosaver(async () => (await b.send('save', { slot: 'auto' })).data as SaveFile, st, { onError: (m: string) => ui.toast(m, 'error') });
  const auto = autosaver;
  // Sauvegarde entièrement automatique : arrière-plan/fermeture, retour au menu, actions importantes.
  autoTriggers = new AutoSaveTriggers({
    saveNow: () => auto.saveNow(), isActive: () => auto.running && !demoRunning,
    flushCloud: () => (st instanceof CloudSlotProvider ? st.flush() : Promise.resolve()),
  });
  autoTriggers.install();

  // Perte du contexte WebGL (iPhone : mémoire graphique) : rendu suspendu, partie sauvegardée tout de suite,
  // message ; à la restauration, three ré-envoie textures et géométries, on reconstruit ce qui n'existait que
  // sur le GPU (imposteurs, environnement) et l'affichage reprend.
  let contextLost = false;
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault(); // autorise la restauration
    contextLost = true;
    debug.contextLost = (debug.contextLost ?? 0) + 1;
    render.ctx.stop();
    ui.setLoading(0.5, 'Reprise de l\'affichage…');
    void autoTriggers?.saveAndFlush();
  }, false);
  canvas.addEventListener('webglcontextrestored', () => {
    if (!contextLost) return;
    contextLost = false;
    try {
      render.rebuildGpu();
      applyGraphicsOptions(ui.currentOptions(), { renderer: render.ctx.renderer, scene: render.ctx.scene, sun: render.ctx.sun, camera: input.camera });
    } catch (err) { console.warn('Reconstruction après perte du contexte WebGL :', err); }
    startLoop();
    if (params.has('norender')) render.ctx.renderNow(1 / 60);
    ui.hideLoading();
    ui.toast('Affichage rétabli', 'ok');
  }, false);

  // Copies de secours en fichier .meknes (export/import), rappel ~30 min sans sauvegarde en ligne,
  // stockage persistant (Safari) : src/save/file-transfer.ts, docs/SAUVEGARDES.md.
  void requestPersistentStorage().then((p) => { debug.storagePersisted = p; });
  const claudeApi = (globalThis as { claude?: { use?: (n: string) => Promise<unknown> } }).claude;
  void resolveDownloads(claudeApi).then((downloads) => {
    const fileUi = installSaveFileUi({
      exportAvailable: typeof claudeApi?.use !== 'function' || downloads !== null,
      prepareExport: async () => (state.inGame ? exportMeknes((await b.send('save', { slot: 'export' })).data as SaveFile, { artifact: downloads !== null }) : null),
      deliverExport: async (f) => {
        try {
          if ((await deliverFile(f as ExportFile, { downloads })) !== 'cancelled') { reminder.reset(); ui.toast(`Copie de secours : ${(f as ExportFile).filename}`, 'ok'); }
        } catch (e) { ui.toast(errText(e), 'error'); }
      },
      importFile: async (file) => {
        const r = await importMeknes(file);
        if (!r.ok) { ui.toast(`Import impossible : ${r.message}`, 'error'); return; }
        const slot = importSlotName(r.value.params.cityName, (await st.list()).map((s) => s.slot));
        const w = await st.save(slot, r.value);
        if (!w.ok) { ui.toast(w.message, 'error'); return; }
        ui.toast(`Fichier importé dans « ${slot} »`, 'ok');
        await loadSlot(slot);
      },
    });
    const reminder = new BackupReminder({
      isPlaying: () => auto.running && !demoRunning && (state.stats?.speed ?? 0) > 0,
      hasCloud: () => st instanceof CloudSlotProvider && (st.status.state === 'online' || st.status.state === 'syncing'),
      remind: () => fileUi.remind(() => reminder.disable()),
    });
    reminder.start();
  });

  const waitSnapshot = (): Promise<void> => new Promise((res) => { firstSnapshot = res; });

  async function saveSlot(slot: string): Promise<void> {
    try {
      const r = await b.send('save', { slot });
      const w = await st.save(slot, r.data);
      if (w.ok) ui.toast(`Partie sauvegardée (« ${slot} »)`, 'ok'); else ui.toast(w.message, 'error');
    } catch (e) { ui.toast(errText(e), 'error'); }
  }

  /**
   * Partie chargée : les modèles des bâtiments VUS depuis la caméra se chargent, et leurs textures partent au GPU,
   * sous l'écran de chargement, avant la première image (sinon la ville apparaît vide puis se remplit pendant
   * quelques secondes, avec une image figée le temps des envois). Attente plafonnée (PRELOAD_CAP_MS) : au-delà,
   * la scène s'affiche, les derniers modèles arrivent par petites tranches et un message le signale.
   */
  const PRELOAD_CAP_MS = 1000;
  async function preloadVisibleBuildings(): Promise<void> {
    if (render.buildings.count === 0) return;
    ui.setLoading(0.9, 'Chargement des bâtiments…');
    const wasRunning = !params.has('norender');
    const t0 = performance.now();
    render.ctx.stop(); // pas de boucle d'affichage : le thread principal décode les modèles et envoie les textures
    let ready = false;
    render.ctx.renderNow(1 / 60); // calcule les LOD visibles : les modèles voulus sont demandés
    // whenReady() envoie au GPU, par tranches, les textures des modèles reçus, entrelacé avec le téléchargement
    // et le décodage des modèles restants.
    await Promise.race([
      render.buildings.whenReady().then(() => { ready = true; }),
      new Promise<void>((r) => setTimeout(r, Math.max(0, PRELOAD_CAP_MS - (performance.now() - t0)))),
    ]);
    render.ctx.renderNow(1 / 60); // instances reçues posées : la première image visible les montre déjà
    debug.lastPreload = { totalMs: Math.round(performance.now() - t0), capped: !ready, pending: render.buildings.loading };
    if (wasRunning) render.ctx.start();
    if (!ready) ui.toast('Chargement des derniers bâtiments…', 'info');
  }

  async function loadSlot(slot: string): Promise<void> {
    const r = await st.load(slot);
    if (!r.ok) { ui.toast(`Chargement impossible : ${r.message}`, 'error'); return; }
    try {
      demoRunning = false;
      const snap = waitSnapshot();
      await b.send('load', { data: r.value });
      await snap;
      // Recentrage sur la ville chargée (barycentre des bâtiments et des routes), sinon sur le centre de la carte.
      const c = cityCenter;
      if (c) focusCamera(c.x, c.z, Math.min(900, Math.max(220, c.extent * 2.2)));
      else focusCamera(0, 0, 420);
      await preloadVisibleBuildings();
      ui.hideMenu();
      ui.hideLoading();
      ui.toast('Partie chargée', 'ok');
      autosaver?.start();
      await b.send('setSpeed', { speed: 1 });
    } catch (e) { ui.hideLoading(); ui.toast(`Chargement impossible : ${errText(e)}`, 'error'); }
  }

  debug.saveSlot = saveSlot;
  debug.loadSlot = loadSlot;

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
        startMonth: START_MONTH,
      });
      await snap;
      focusCamera(0, 0, 420, 0.6);
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
      await b.send('newGame', { seed: DEMO_SEED, mapChunks: 8, startMoney: DEMO_START_MONEY, cityName: 'Aube-sur-Mer (démonstration)', startHour: params.has('h') ? Number(params.get('h')) : 10.5, startMonth: START_MONTH });
      await snap;
      ui.setLoading(0.65, 'Construction de la ville (routes, ponts, bâtiments, habitants)…');
      snap = waitSnapshot();
      const city = await b.sendExt('buildCity', { preset: 'demo', vehicles: 140 });
      await snap;
      ui.setLoading(0.8, 'Chargement de tous les modèles 3D…');
      // Pendant le chargement (écran de chargement opaque), on suspend le rendu : le thread principal
      // décode les GLB au lieu de dessiner une scène encore incomplète.
      render.ctx.stop();
      const H = (x: number, z: number): number => render.terrain.heightAt(x, z);
      const vegIds = new Set(render.veg.speciesList.map((sp) => sp.asset.id));
      props.clear();
      render.veg.plant(city.decor.filter((d) => vegIds.has(d.assetId)).map((d) => ({ x: d.x, z: d.z, assetId: d.assetId })));
      await props.add(city.decor.filter((d) => !vegIds.has(d.assetId)), H);
      await render.whenReady(true);
      startLoop();
      const [ax, az] = city.views.aerial;
      demoViews = { ax, az, street: city.views.street };
      setDemoCamera('aerial');
      input.camera.setHome();
      render.terrain.refineAround(ax, az, 560);
      debug.demo = { ...city, decor: city.decor.length };
      ui.hideLoading();
      ui.toast(`Démonstration : ${city.buildings} bâtiments (${city.distinctBuildings} modèles différents), ${city.vehicles} véhicules. Touche V : vue rue.`, 'info');
      await b.send('setSpeed', { speed: 1 });
      debug.demoReady = true;
    } catch (e) {
      startLoop();
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
      render.ctx.stop();
      snap = waitSnapshot();
      const city = await b.sendExt('buildCity', { preset: 'stress', maxBuildings: Number(params.get('n') ?? 500), vehicles: Number(params.get('v') ?? 1000) });
      await snap;
      await render.whenReady(true);
      startLoop();
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

  startLoop();
  ui.setLoading(1, 'Prêt');
  ui.hideLoading();
  ui.setMenuFoot(`${GAME_NAME} · ${catalog.assets.length} modèles 3D au catalogue · sauvegardes : ${store.backend.kind}`);
  if (params.has('stress')) await startStress();
  else if (params.has('demo')) await startDemo();
  else if (params.has('autostart')) await startNewGame();
  else await refreshMenu();
  debug.ready = true;
  bootDone();
  if (enteredSafeMode) ui.toast('Le chargement précédent a échoué : mode sûr activé (qualité basse, affichage allégé). Réglages pour revenir à la qualité normale.', 'info');
}

boot().catch((e: unknown) => {
  console.error(e);
  const t = document.getElementById('loading-text');
  if (t) t.textContent = `Erreur au démarrage : ${errText(e)}`;
  window.__aube?.errors.push(errText(e));
});

/**
 * Estimation grossière de la mémoire GPU occupée par la scène (diagnostic). Taille des images CÔTÉ CPU : la
 * réduction faite par three à l'envoi (mode allégé) n'y apparaît pas ; mesure réelle : docs/PERFORMANCE_MOBILE.md.
 */
function estimateGpuMemory(scene: THREE.Scene, renderer: THREE.WebGLRenderer): { texturesMo: number; textures: number; geometriesMo: number; geometries: number; ombresMo: number } {
  const tex = new Set<THREE.Texture>();
  const geo = new Set<THREE.BufferGeometry>();
  const addTex = (v: unknown): void => { if (v && (v as THREE.Texture).isTexture) tex.add(v as THREE.Texture); };
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) geo.add(m.geometry);
    const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
    for (const mat of mats) {
      for (const v of Object.values(mat)) addTex(v);
      const u = (mat as THREE.ShaderMaterial).uniforms;
      if (u) for (const x of Object.values(u)) addTex(x?.value);
    }
  });
  addTex(scene.environment); addTex(scene.background);
  let tb = 0;
  for (const t of tex) {
    const img = t.image as { width?: number; height?: number; data?: ArrayBufferView } | undefined;
    const w = img?.width ?? 0, h = img?.height ?? 0;
    const bpp = (img?.data as { BYTES_PER_ELEMENT?: number } | undefined)?.BYTES_PER_ELEMENT === 4 ? 16 : (img?.data as { BYTES_PER_ELEMENT?: number } | undefined)?.BYTES_PER_ELEMENT === 2 ? 8 : 4;
    tb += w * h * bpp * (t.generateMipmaps || t.mipmaps?.length ? 1.33 : 1);
  }

  let gb = 0;
  for (const g of geo) {
    for (const a of Object.values(g.attributes)) gb += (a as THREE.BufferAttribute).array?.byteLength ?? 0;
    gb += g.index?.array.byteLength ?? 0;
  }
  let sb = 0;
  scene.traverse((o) => { const l = o as THREE.DirectionalLight; if (l.isDirectionalLight && l.castShadow) sb += l.shadow.mapSize.x * l.shadow.mapSize.y * 4; });
  void renderer;
  const mo = (b: number): number => Math.round(b / 1048576);
  return { texturesMo: mo(tb), textures: tex.size, geometriesMo: mo(gb), geometries: geo.size, ombresMo: mo(sb) };
}
