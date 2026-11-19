/**
 * Amorçage du jeu (thread principal) — intégration.
 * Câble : catalogue -> rendu -> worker de simulation -> interface -> entrées -> construction -> sauvegardes.
 * Aucune règle de jeu ici : la simulation tourne dans le worker (src/sim) ; ce fichier ne fait que relayer.
 *
 * Modes d'URL : ?demo (scène de démonstration), ?autostart (partie immédiate), ?validate (porte visuelle),
 * ?seed=N (graine de la partie), ?h=H (heure de départ), ?bench (page de mesure de performance : src/ui/bench.ts).
 */
import { initToolFamilies } from './ui/tool-families';
import { initLayersMenu } from './ui/layers-menu';
import { initRail } from './ui/rail';
import * as THREE from 'three';
import { previousTrace, traceStart, traceStep, tracePlaying } from './boot-trace';
import { powerView } from './shared/power/view';
import { waterView } from './render/water-network/view';
import { bootDone, bootStarted, deviceProfile, isSafeMode, safeModeReason, setSafeMode } from './render/device-profile';
import { imageLimits } from './render/image-cap';
import { DEFAULT_MAP_CHUNKS, DEFAULT_START_MONEY, GAME_NAME, PROTOCOL_VERSION, type SimSpeed } from './shared/constants';
import { validateCatalog } from './shared/catalog';
import type { CommandError, NewGameParams, SaveFile, SimStats } from './shared/contracts';
import { terrainBounds } from './shared/terrain-gen';
import type { CityBuildResult } from './sim/city-builder';
import type { SimNotice, SimReport } from './sim/sim-protocol';
import type { SnapshotMessage } from './shared/protocol';
import { SimBridge, SimCommandError } from './client/sim-bridge';
import { createClientState } from './client/state';
import { fieldFor, fieldWithPreview, localRoadGrid, previewBox, previewKey, type PreviewRoad } from './client/tools/road-grid';
import { roadWidth } from './client/tools/mirror';
import { zoningView } from './client/zoning-view';
import { GridFieldTexture } from './render/terrain/grid-field-texture';
import { AssetLibrary, fetchCatalog } from './render/assets';
import { initRender, type RenderStats } from './render';
import { PropLayer } from './render/props';
import { initConstruction, initInput } from './input';
import { initUI } from './ui/hud';
import { applyGraphicsOptions, applyTheme, loadOptions, urlQuality, wantMsaa } from './ui/options';
import { setColorMode } from './render/palette';
import { setStreetTrees } from './render/roads/builder';
import { ab } from './render/ab';
import { benchCompareStart, benchMode, benchTrace, benchWatchRenderer, installBenchLink, runBench, startBenchRecorder } from './ui/bench';
import { gameDateLabel, installCloudSaveBadge, installSaveFileUi, setSlotProvider, type SlotInfo as UiSlotInfo } from './ui/save-slots';
import { Autosaver, SaveStore, attachCloudSaves, type CloudSaveStatus } from './save';
import { autoPrefixFor } from './save/autosave';
import { AutoSaveTriggers, IMPORTANT_COMMANDS, latestSlot } from './save/auto-triggers';
import { CloudSlotProvider } from './save/cloud';
import { AccountStore, attachAccounts } from './save/account';
import { installAccountUi } from './ui/account';
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
  quays?: () => number[];
  forestSpot?: () => { x: number; z: number } | null;
  isWet?: (x: number, z: number) => boolean;
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
  applyTheme(loadOptions().theme);
  setStreetTrees(loadOptions().streetTrees); // arbres d'alignement : lus avant la construction des routes
  setColorMode(loadOptions().colors); // palette choisie avant la création du rendu (pas de recompilation au démarrage)
  // iPhone : pas de zoom de PAGE (pincement ou double toucher sur l'interface la décalait hors de l'écran) ;
  // le zoom de la carte reste géré par la caméra.
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend'] as const) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
  document.addEventListener('touchmove', (e) => { if ((e as TouchEvent & { scale?: number }).scale !== undefined && (e as TouchEvent & { scale?: number }).scale !== 1) e.preventDefault(); }, { passive: false });
  window.addEventListener('resize', () => { if (window.visualViewport && window.visualViewport.scale > 1.01) window.scrollTo(0, 0); });
  const params = new URLSearchParams(location.search);
  // Page de mesure : images enregistrées dès le démarrage (à-coups du chargement compris).
  const bench = benchMode();
  // Mode comparaison (?bench&comparer) : la première page lance tout de suite l'étape A (rien n'est chargé ici).
  if (bench && benchCompareStart()) return;
  if (bench) startBenchRecorder();
  const debug: DebugInfo = {
    ready: false, workerReady: false, snapshotReceived: false, deltas: 0, frames: () => 0, catalogAssets: 0, errors: [],
    lastStats: null, demoReady: false, demo: null, renderStats: () => null,
  };
  window.__aube = debug;
  // Repli sûr : si le chargement précédent ne s'est pas terminé (Safari a fermé l'onglet), on redémarre en
  // mode allégé forcé et qualité basse.
  const crashedBefore = bootStarted();
  // Journal du lancement précédent : affiché si la page a été fermée par un plantage (chargement ou partie).
  const prevTrace = previousTrace();
  const crashReport = prevTrace && !prevTrace.updated && (crashedBefore || prevTrace.playing) && prevTrace.steps.length
    ? `Arrêt précédent (${prevTrace.playing ? 'après le chargement' : 'au chargement'}) après : ${prevTrace.steps.slice(-5).join(' › ')}` : null;
  traceStart();
  tracePlaying(false);
  // Qualité imposée par l'adresse (?qualite=, page de mesure) : prioritaire sur le mode sûr, qu'elle retire.
  const forcedQuality = urlQuality();
  if (forcedQuality) setSafeMode(false);
  const enteredSafeMode = crashedBefore && !forcedQuality && !isSafeMode();
  if (enteredSafeMode) setSafeMode(true, `chargement précédent interrompu (${new Date().toLocaleString('fr-FR')})${prevTrace?.steps.length ? `, dernière étape : ${prevTrace.steps[prevTrace.steps.length - 1]}` : ''}`);
  debug.safeMode = isSafeMode();
  // GLTFLoader : les textures externes partagées entre GLB ne sont téléchargées qu'une fois.
  THREE.Cache.enabled = true;
  const state = createClientState();
  const assetsBase = new URL('./assets/', import.meta.url);
  const workerUrl = new URL('./sim.worker.js', import.meta.url);
  workerUrl.search = new URL(import.meta.url).search; // même version que game.js (cache de GitHub Pages)

  let speedBeforeMenu: SimSpeed = 1;
  let bridge: SimBridge | null = null;
  let store: SaveStore | null = null;
  let autosaver: Autosaver | null = null;
  let autoTriggers: AutoSaveTriggers | null = null;
  /** Partie la plus récente (locale ou en ligne), proposée par « Continuer ». */
  let continueSlot: string | null = null;
  let demoRunning = false;
  const needBridge = (): SimBridge => { if (!bridge) throw new Error('Simulation non démarrée'); return bridge; };

  // Menu affiché dès le début du chargement : une partie demandée avant la fin attend `booted` (les fonctions de
  // lancement utilisent la simulation et le rendu, prêts seulement à la fin du chargement).
  let isBooted = false;
  let bootDoneResolve: () => void = () => undefined;
  const booted = new Promise<void>((r) => { bootDoneResolve = r; });
  const afterBoot = (fn: () => void): void => { if (isBooted) fn(); else { ui.bootQueued(); void booted.then(fn); } };
  const ui = initUI({
    onNewGame: () => { afterBoot(() => { void startNewGame(); }); },
    onNewGameWith: (p) => { afterBoot(() => { void startNewGame({ cityName: p.cityName, seed: p.seed, mapChunks: p.mapChunks, startMoney: p.startMoney, terrain: { riverMode: p.riverMode ?? 'une', hydrology: p.hydrology ?? 'mer' } }, p.paliers !== false); }); },
    onContinue: () => {
      if (state.inGame) { ui.hideMenu(); void needBridge().send('setSpeed', { speed: speedBeforeMenu }); return; }
      afterBoot(() => { void loadSlot(continueSlot ?? QUICK_SLOT); });
    },
    onLoadSlot: (slot) => { afterBoot(() => { void loadSlot(slot); }); },
    onSaveSlot: (slot) => saveSlot(slot),
    onDemo: () => { afterBoot(() => { void startDemo(); }); },
    // « Nouvelle partie (ville de départ) » : remise le 14/11 après les corrections mémoire du mode allégé (images
    // partagées, textures 256 px, qualité Basse sur téléphone) ; retirée le 13/11 après des plantages Safari iPhone.
    onDemoGame: () => { afterBoot(() => { void startDemo(true); }); },
    onQuit: () => {
      void autoTriggers?.saveAndFlush();
      autosaver?.stop();
      void bridge?.send('setSpeed', { speed: 0 });
      state.inGame = false;
      void refreshMenu();
    },
    onOptions: (o) => { if (o.quality !== 'auto') setSafeMode(false); applyGraphicsOptions(o, { renderer: render.ctx.renderer, scene: render.ctx.scene, sun: render.ctx.sun, camera: input.camera, perf: render.ctx.perf }); render.onOptionsApplied(); },
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
  // Chaque étape du chargement est notée dans le journal de plantage.
  const setLoadingRaw = ui.setLoading.bind(ui);
  ui.setLoading = (p: number, text: string): void => { traceStep(text.replace(/…$/, '')); setLoadingRaw(p, text); };
  const refreshMenu = async (): Promise<void> => {
    // Menu affiché pendant le chargement : pas de retour à l'accueil (formulaire en cours) ; fin du chargement : endBootMenu.
    if (!isBooted && earlyMenu) return;
    continueSlot = store ? latestSlot(await store.list()) : null;
    ui.showMenu({ canContinue: state.inGame || continueSlot !== null, inGame: state.inGame });
  };

  // Menu tout de suite (partie normale) ; lancements automatiques (autostart, démo, banc d'essai) : écran de chargement.
  const earlyMenu = !params.has('autostart') && !params.has('demo') && !params.has('stress') && !params.has('validate') && !bench;
  if (earlyMenu) ui.showBootMenu();
  ui.setLoading(0.05, 'Chargement du catalogue d\'assets…');
  const catalog = await fetchCatalog(assetsBase);
  const issues = validateCatalog(catalog);
  if (issues.length) console.warn('Catalogue : problèmes détectés', issues);
  debug.catalogAssets = catalog.assets.length;
  // Mode allégé (téléphone) : images réduites dès leur chargement, modèles chargés un par un.
  const bootProfile = deviceProfile(ui.currentOptions().quality);
  imageLimits.textureCap = bootProfile.textureCap;
  imageLimits.treeTextureCap = bootProfile.treeTextureCap;
  imageLimits.maxConcurrentModels = bootProfile.maxConcurrentModels;
  imageLimits.colorMapsOnly = bootProfile.colorMapsOnly;
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

  // Simulation (téléchargement et démarrage du Worker) en parallèle de la préparation du rendu.
  const bridgeStart = SimBridge.create(workerUrl);
  bridgeStart.catch(() => undefined);
  ui.setLoading(0.2, 'Préparation du rendu 3D (ciel, terrain, végétation)…');
  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const render = await initRender(canvas, lib, catalog, assetsBase, undefined, ui.currentOptions().quality,
    wantMsaa(ui.currentOptions(), window.devicePixelRatio || 1, bootProfile.lite, bootProfile.maxPixelRatio, bootProfile.autoPixelRatio));
  if (bench) { benchWatchRenderer(render.ctx.renderer); if (ab.trace) render.ctx.perf.trace = benchTrace; }
  debug.frames = () => render.ctx.frames;
  debug.renderStats = () => render.stats();
  // Diagnostic (docs/PERFORMANCE_PC.md) : palier de qualité automatique, densité de rendu, GPU intégré.
  (debug as unknown as Record<string, unknown>).qualityTier = () => ({ tier: render.ctx.perf.tier ?? 0, auto: !!render.ctx.perf.tiersEnabled, igpu: render.profile.igpu });
  (debug as unknown as Record<string, unknown>).pixelRatio = () => render.ctx.renderer.getPixelRatio();
  debug.gpuMemory = () => estimateGpuMemory(render.ctx.scene, render.ctx.renderer);
  debug.memStats = () => {
    const r = render.ctx.renderer;
    let objects = 0, instanced = 0, meshes = 0;
    render.ctx.scene.traverse((o) => { objects++; if ((o as THREE.InstancedMesh).isInstancedMesh) instanced++; else if ((o as THREE.Mesh).isMesh) meshes++; });
    return { geometries: r.info.memory.geometries, textures: r.info.memory.textures, programs: r.info.programs?.length ?? 0, objects, instanced, meshes, dom: document.getElementsByTagName('*').length };
  };
  // Diagnostic (performance) : appels de rendu probables par groupe de premier niveau (maillages visibles, dont
  // ceux qui projettent une ombre : un appel de plus dans la carte d'ombre), instances et triangles dessinés.
  (debug as unknown as Record<string, unknown>).drawBreakdown = () => {
    const out: Record<string, { draws: number; shadow: number; instances: number; tris: number; materials: number }> = {};
    const mats = new Map<string, Set<unknown>>();
    for (const top of render.ctx.scene.children) {
      const k = top.name || top.type;
      const cur = out[k] ?? (out[k] = { draws: 0, shadow: 0, instances: 0, tris: 0, materials: 0 });
      const ms = mats.get(k) ?? new Set<unknown>();
      mats.set(k, ms);
      top.traverseVisible((o) => {
        const m = o as THREE.InstancedMesh;
        if (!m.isMesh) return;
        const bm = o as THREE.BatchedMesh;
        if (bm.isBatchedMesh) { cur.draws++; if (bm.castShadow) cur.shadow++; cur.instances += bm.instanceCount; return; }
        const n = m.isInstancedMesh ? m.count : 1;
        if (n <= 0) return;
        const g = m.geometry;
        const groups = Array.isArray(m.material) ? Math.max(1, g.groups.length) : 1;
        cur.draws += groups;
        if (m.castShadow) cur.shadow += groups;
        for (const mt of Array.isArray(m.material) ? m.material : [m.material]) ms.add(mt);
        cur.materials = ms.size;
        cur.instances += n;
        cur.tris += Math.round(((g.index ? g.index.count : g.getAttribute('position')?.count ?? 0) / 3) * n);
      });
    }
    return out;
  };
  // Diagnostic (e2e mémoire) : objets et géométries par groupe de premier niveau de la scène.
  (debug as unknown as Record<string, unknown>).sceneCensus = () => {
    const out: Record<string, { obj: number; geo: number }> = {};
    for (const top of render.ctx.scene.children) {
      const geos = new Set<unknown>(); let obj = 0;
      top.traverse((o) => { obj++; const g = (o as THREE.Mesh).geometry; if (g) geos.add(g); });
      const k = top.name || top.type;
      const cur = out[k] ?? { obj: 0, geo: 0 };
      out[k] = { obj: cur.obj + obj, geo: cur.geo + geos.size };
    }
    return out;
  };
  // Diagnostic (e2e) : visibilité et étendue d'un calque de la scène.
  (debug as unknown as Record<string, unknown>).layerInfo = (name: string) => {
    const o = render.ctx.scene.getObjectByName(name);
    if (!o) return null;
    const box = new THREE.Box3().setFromObject(o);
    let shown = 0; o.traverse((c) => { if (c.visible && (c as THREE.Mesh).isMesh) shown++; });
    return { visible: o.visible, meshes: shown, min: box.min.toArray().map(Math.round), max: box.max.toArray().map(Math.round) };
  };
  // Diagnostic (e2e mémoire) : textures de la scène regroupées par origine.
  (debug as unknown as Record<string, unknown>).textureReport = () => {
    const tex = new Set<THREE.Texture>();
    render.ctx.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (!m) return;
      for (const mat of Array.isArray(m) ? m : [m]) for (const v of Object.values(mat)) if ((v as THREE.Texture | null)?.isTexture) tex.add(v as THREE.Texture);
    });
    const imgs = new Set<unknown>(), srcs = new Set<unknown>();
    const by: Record<string, number> = {};
    for (const t of tex) {
      imgs.add(t.image); srcs.add(t.source);
      const im = t.image as { width?: number; height?: number; constructor?: { name: string } } | null;
      const k = `${im?.constructor?.name ?? '?'} ${im?.width ?? 0}x${im?.height ?? 0} ${t.name ? t.name.split('/').slice(-2, -1)[0] ?? t.name : '(sans nom)'}`;
      by[k] = (by[k] ?? 0) + 1;
    }
    return { textures: tex.size, images: imgs.size, sources: srcs.size, top: Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 25) };
  };
  const props = new PropLayer(render.ctx.scene, lib);
  (debug as unknown as Record<string, unknown>).buildingDebug = (id: number) => render.buildings.debugInstance(id);
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
  (debug as unknown as Record<string, unknown>).cameraGoalDistance = () => input.camera.goalDistance();
  debug.signals = () => render.signals.debug();
  debug.roadDecor = () => render.roads.decorItems();
  debug.heightAt = (x, z) => render.terrain.heightAt(x, z);
  debug.riverBlocks = () => render.water.inlandCenters();
  debug.quays = () => render.quays.list();
  debug.forestSpot = () => {
    // Échantillon le plus boisé (moyenne sur un disque de 24 m) : cible de l'e2e Défricher.
    const t = render.terrain.terrain;
    if (!t?.forest) return null;
    let best = 0, bx = 0, bz = 0;
    for (let j = 3; j < t.samplesZ - 3; j += 2) for (let i = 3; i < t.samplesX - 3; i += 2) {
      let s = 0;
      for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) s += t.forest[(j + dj) * t.samplesX + i + di]!;
      if (s > best) { best = s; bx = t.originX + i * t.spacing; bz = t.originZ + j * t.spacing; }
    }
    return best > 0 ? { x: bx, z: bz } : null;
  };
  debug.isWet = (x, z) => {
    const t = render.terrain.terrain;
    if (!t?.waterSurface) return false;
    const i = Math.round((x - t.originX) / t.spacing), j = Math.round((z - t.originZ) / t.spacing);
    if (i < 0 || j < 0 || i >= t.samplesX || j >= t.samplesZ) return false;
    const k = j * t.samplesX + i;
    return t.waterSurface[k]! > t.heights[k]! + 0.05;
  };
  debug.plantVeg = (items) => render.veg.plant(items);
  debug.streetLook = (x, z, lx, lz) => {
    input.camera.setStreetPosition(x, z, Math.atan2(-(lx - x), -(lz - z)));
    if (input.camera.mode !== 'street') input.camera.setMode('street');
  };
  debug.lookAt = (x, z, distance, pitch, yaw) => {
    if (input.camera.mode === 'street') input.camera.setMode('aerial');
    input.camera.setPose({ targetX: x, targetZ: z, targetY: render.terrain.heightAt(x, z), distance, ...(pitch !== undefined ? { pitch } : {}), ...(yaw !== undefined ? { yaw } : {}) });
  };
  // Diagnostic (performance) : temps PROCESSEUR d'une image, carte graphique attendue avant (gl.finish) pour ne
  // pas compter son travail : mises à jour JS (culling, LOD, instances…) puis rendu three (préparation et envoi des
  // commandes). Boucle d'affichage à suspendre avant (pauseRender). Caméra tournée de `yawStep` entre deux images.
  (debug as unknown as Record<string, unknown>).cpuFrames = (n = 30, yawStep = 0.02) => {
    const ctx = render.ctx, gl = ctx.renderer.getContext();
    const p = input.camera.getPose();
    const upd: number[] = [], rnd: number[] = [];
    for (let i = 0; i < n; i++) {
      if (yawStep) input.camera.setPose({ yaw: p.yaw + yawStep * (i + 1) });
      gl.finish();
      const t0 = performance.now();
      for (const f of ctx.onFrame) f(1 / 60);
      const t1 = performance.now();
      ctx.renderer.render(ctx.scene, ctx.camera);
      const t2 = performance.now();
      upd.push(t1 - t0); rnd.push(t2 - t1);
    }
    const med = (a: number[]): number => { const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.floor(s.length / 2)]! * 100) / 100; };
    return { updateMs: med(upd), renderMs: med(rnd), calls: ctx.renderer.info.render.calls, triangles: ctx.renderer.info.render.triangles };
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
  // Diagnostic : maillages visibles d'une couche de la scène, regroupés par nom (sans numéro de chunk).
  (debug as unknown as Record<string, unknown>)['layerMeshes'] = (name: string) => {
    const out: Record<string, { n: number; inst: number; tris: number }> = {};
    const root = render.ctx.scene.children.find((o) => o.name === name);
    root?.traverseVisible((o) => {
      const m = o as THREE.Mesh & { count?: number; isInstancedMesh?: boolean };
      if (!m.isMesh) return;
      const key = (o.name || o.type).replace(/_\d+/g, '_#');
      const g = m.geometry, tri = (g.index ? g.index.count : g.getAttribute('position')?.count ?? 0) / 3;
      const k = (out[key] ??= { n: 0, inst: 0, tris: 0 });
      k.n++; k.inst += m.isInstancedMesh ? (m.count ?? 0) : 1; k.tris += tri * (m.isInstancedMesh ? (m.count ?? 0) : 1);
    });
    return out;
  };
  debug.setLayerVisible = (name, visible) => {
    const names: string[] = [];
    for (const o of render.ctx.scene.children) { names.push(o.name || o.type); if (o.name === name) o.visible = visible; }
    return names;
  };
  applyGraphicsOptions(ui.currentOptions(), { renderer: render.ctx.renderer, scene: render.ctx.scene, sun: render.ctx.sun, camera: input.camera, perf: render.ctx.perf }); render.onOptionsApplied();

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
  bridge = await bridgeStart;
  const b = bridge;
  // Sauvegarde automatique après construction/démolition (au plus 1/min) : src/save/auto-triggers.ts.
  const rawSend = b.send.bind(b);
  b.send = ((name, args) => {
    const p = rawSend(name, args);
    if (IMPORTANT_COMMANDS.has(name)) void p.then(() => autoTriggers?.noteAction(), () => undefined);
    return p;
  }) as typeof b.send;
  debug.send = (name, args) => b.send(name as never, args as never);
  // Commandes étendues (e2e : état de l'eau dynamique, annulation du terrain).
  (debug as unknown as Record<string, unknown>).sendExt = (name: string, args: unknown) => b.sendExt(name as never, args as never);
  b.onLog((m) => { (m.level === 'error' ? console.error : console.log)(`[sim] ${m.message}`); if (m.level === 'error') debug.errors.push(m.message); });

  // Construction (miroir de la simulation, outils, aperçus) : branchée AVANT le premier instantané.
  const cons = initConstruction({ sim: b, ui, input, scene: render.ctx.scene, models: lib, catalog, heightAt: (x, z) => render.terrain.heightAt(x, z), renderer: render.ctx.renderer, lite: render.profile.lite });
  render.ctx.onFrame.push((dt) => cons.update(dt));
  // La grille de construction s'estompe autour du curseur (au lieu de couvrir toute la carte jusqu'à l'horizon).
  render.ctx.onFrame.push(() => render.terrain.setGridFocus(cons.machine.hoverGround));
  // Quadrillage LOCAL dans tous les outils où il apparaît (Routes, Bâtiment, Terrain, Zones) : en chaque point, trame
  // de la route la plus proche (rangées intérieures comprises), des bâtiments voisins, sinon axes du monde
  // (src/shared/grid-field.ts) — comme les cases de zonage attachées aux routes. Texture calculée par morceaux.
  const gridTex = new GridFieldTexture();
  let gridVisible = false;
  // Route en cours de tracé (outil Routes) : sa trame est affichée dès l'aperçu, telle qu'elle sera une fois posée.
  const previewRoad = (): PreviewRoad | null => {
    const pv = cons.machine.preview;
    if (cons.machine.tool !== 'road' || pv.kind !== 'road' || !pv.points || pv.points.length < 4 || pv.mode === 'roundabout') return null;
    return { poly: pv.points, half: roadWidth(pv.type) / 2 };
  };
  const shownField = (x: number, z: number) => {
    const pr = previewRoad(), b = previewBox(pr);
    return b && x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1 ? fieldWithPreview(cons.machine.mirror, pr) : fieldFor(cons.machine.mirror);
  };
  const updateGridField = (budget: number): void => {
    if (!gridVisible) return;
    const mc = cons.machine, g = mc.hoverGround;
    const p = input.camera.getPose();
    const cx = g?.x ?? p.targetX, cz = g?.z ?? p.targetZ;
    const pr = previewRoad();
    if (gridTex.update(fieldWithPreview(mc.mirror, pr), mc.mirror.version, cx, cz, budget, { key: previewKey(pr), box: previewBox(pr) })) render.terrain.setGridField(gridTex.texture, gridTex.box);
  };
  render.ctx.onFrame.push(() => updateGridField(4));
  // Le champ suit aussi les modifications du réseau et des bâtiments : les cases de l'outil Zones sont redessinées.
  cons.machine.mirror.onChange(() => zoningView.fieldChanged());
  zoningView.fieldSource = () => fieldFor(cons.machine.mirror);
  // Grille de construction au sol (cases de 8 m) pendant le tracé des routes, la pose et le terrassement.
  // Calques des réseaux affichés automatiquement pendant la pose (électricité : ligne HT ou installation ;
  // eau : installation d'eau), retirés ensuite s'ils avaient été ouverts ainsi.
  let autoPower = false, autoWater = false;
  const syncGrid = (): void => {
    const t = cons.machine.tool;
    gridVisible = t === 'road' || t === 'building' || t === 'terraform' || zoningView.toolActive;
    render.terrain.setGrid(gridVisible);
  };
  zoningView.on((c) => { if (c.kind === 'tool') syncGrid(); });
  cons.machine.onToolChange((t) => {
    traceStep(`outil ${t}`);
    syncGrid();
    const id = t === 'building' ? cons.machine.asset?.id ?? '' : '';
    const wantPower = t === 'powerline' || id.startsWith('elec_');
    const wantWater = id.startsWith('eau_');
    // Choisir un bâtiment ne zoome plus la caméra (le saut 600 m → 170 m désorientait) : la vue reste celle du joueur.
    if (wantPower && !powerView.overlay) { powerView.setOverlay(true); autoPower = true; }
    else if (!wantPower && autoPower) { powerView.setOverlay(false); autoPower = false; }
    if (wantWater && waterView.mode === 'off') { waterView.set('desserte'); autoWater = true; }
    else if (!wantWater && autoWater) { waterView.set('off'); autoWater = false; }
  });
  // Rendu au ralenti (4 images/s) quand rien ne bouge : partie en pause, caméra immobile, aucun geste depuis 2 s.
  {
    let lastInput = performance.now(), poseKey = '';
    for (const ev of ['pointerdown', 'pointermove', 'wheel', 'keydown', 'touchstart'] as const) window.addEventListener(ev, () => { lastInput = performance.now(); }, { passive: true, capture: true });
    render.ctx.perf.idle = () => {
      const st = debug.lastStats as { speed?: number } | undefined;
      if (!st || st.speed !== 0) return false;
      const p = input.camera.getPose();
      const k = `${p.targetX.toFixed(2)},${p.targetZ.toFixed(2)},${p.distance.toFixed(2)},${p.yaw.toFixed(3)},${p.pitch.toFixed(3)}`;
      if (k !== poseKey) { poseKey = k; lastInput = Math.max(lastInput, performance.now()); return false; }
      return performance.now() - lastInput > 2000;
    };
  }
  (debug as unknown as Record<string, unknown>).renderPerf = () => ({ ...render.ctx.perf, idle: render.ctx.perf.idle(), ratio: render.ctx.renderer.getPixelRatio() });
  debug.constructionApplied = () => cons.machine.applied;
  // Diagnostic (e2e) : ouvre la fiche d'un bâtiment.
  (debug as unknown as Record<string, unknown>).selectBuilding = (id: number) => { const r = cons.machine.mirror.buildings.get(id); if (r) cons.machine.onSelect({ kind: 'building', id, record: r, asset: cons.machine.mirror.asset(r.assetId), distance: 0 }); return !!r; };
  // Diagnostic (e2e) : outil Déplacer sur un bâtiment donné.
  (debug as unknown as Record<string, unknown>).startMove = (id: number) => { const r = cons.machine.mirror.buildings.get(id); return r ? cons.machine.startMove(r) : false; };
  // Diagnostic (e2e) : notification par le même chemin que la simulation et les outils (journal, regroupement, badge).
  (debug as unknown as Record<string, unknown>).toast = (text: string, kind?: 'info' | 'ok' | 'error') => ui.toast(text, kind ?? 'info');
  // Diagnostic (e2e) : pose rendue d'un bâtiment (comparaison emprise simulée / modèle affiché / quadrillage).
  (debug as unknown as Record<string, unknown>).buildingPose = (id: number) => render.buildings.instancePose(id);
  // Diagnostic (e2e) : trame locale du quadrillage en (x, z) (null : axes du monde) et trame affichée en ce moment.
  (debug as unknown as Record<string, unknown>).roadGridAt = (x: number, z: number) => localRoadGrid(cons.machine.mirror, x, z)?.frame ?? null;
  (debug as unknown as Record<string, unknown>).gridFrame = () => { const g = cons.machine.hoverGround; return g ? localRoadGrid(cons.machine.mirror, g.x, g.z)?.frame ?? null : null; };
  // Lignes du quadrillage affichées en (x, z) (champ de trames) ; calcul complet immédiat de la texture (captures).
  (debug as unknown as Record<string, unknown>).gridLinesAt = (x: number, z: number) => {
    if (!gridVisible) return null;
    const box = gridTex.box;
    if (!box || x < box.x0 || z < box.z0 || x >= box.x0 + box.size || z >= box.z0 + box.size) return { tx: 1, tz: 0, pu: 0, pv: 0, weight: 1, kind: 'monde' };
    const L = shownField(x, z).linesAt(x, z);
    return { tx: L.tx, tz: L.tz, pu: L.pu, pv: L.pv, weight: L.weight, kind: L.kind };
  };
  (debug as unknown as Record<string, unknown>).gridFieldFlush = () => { for (let k = 0; k < 4; k++) updateGridField(1e6); return gridTex.box; };
  debug.worldToScreen = (x, z) => {
    const v = new THREE.Vector3(x, render.terrain.heightAt(x, z), z).project(render.ctx.camera);
    const r = canvas.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  };
  debug.toolPreview = () => {
    const p = cons.machine.preview;
    if (p.kind === 'building') return { kind: p.kind, assetId: p.asset.id, x: p.proposal.x, z: p.proposal.z, rot: p.proposal.rot, snapped: p.proposal.snapped, validity: p.validity, message: p.message };
    if (p.kind === 'road') return { kind: p.kind, type: p.type, mode: p.mode, validity: p.validity, message: p.message, length: p.length, cost: p.cost, angle: p.angle, chained: p.chained, drawing: cons.machine.drawing, guide: p.hover?.guide?.label ?? null, points: p.points, start: p.start, hover: p.hover };
    if (p.kind === 'grid') return { kind: p.kind, validity: p.validity, message: p.message, cost: p.cost, lines: p.layout?.lines.length ?? 0, nx: p.layout?.nx ?? 0, nz: p.layout?.nz ?? 0, length: p.layout?.length ?? 0, drawing: cons.machine.drawing };
    if (p.kind === 'upgrade') return { kind: p.kind, validity: p.validity, message: p.message, cost: p.cost, refund: p.refund, target: p.target?.id ?? null, from: p.target?.kindId ?? null, toKind: p.toKind, reverse: p.reverse };
    if (p.kind === 'bulldoze') return { kind: p.kind, area: cons.machine.bulldozeArea, areaStart: p.areaStart ?? null, buildings: p.area?.buildings.length ?? 0, edges: p.area?.edges.length ?? 0, refund: p.area?.refund ?? p.refund, target: p.target?.kind ?? null };
    if (p.kind === 'terrain') return { kind: p.kind, mode: p.mode, validity: p.validity, message: p.message, cost: p.cost, length: p.length, start: p.start, hard: p.hard, innerRadius: p.innerRadius, stroke: p.stroke };
    return { kind: p.kind };
  };

  // Diagnostic (e2e) : outil, survol d'un point au sol et clic principal sans souris (mesures du tracé de route).
  (debug as unknown as Record<string, unknown>).setTool = (t: string, opts?: { roadType?: string }) => cons.machine.setTool(t as never, opts as never);
  (debug as unknown as Record<string, unknown>).toolHover = (x: number, z: number) => cons.machine.hover({ x, z }, null);
  (debug as unknown as Record<string, unknown>).toolClick = () => cons.machine.primary();
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
    tracePlaying(true);
    traceStep('partie lancée');
    state.cityName = s.params.cityName;
    autosaver?.setPrefix(autoPrefixFor(s.params.cityName));
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
    const tr = render.ctx.perf.trace, ta = tr ? performance.now() : 0;
    render.applyDelta(d);
    const tb = tr ? performance.now() : 0;
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
    if (tr) { const tc = performance.now(); tr('simulation reçue : rendu', tb - ta); tr('simulation reçue : interface', tc - tb); }
  });
  await b.ready;
  debug.workerReady = true;
  ui.setExtPort(b);
  initToolFamilies();
  initRail();
  initLayersMenu({ pluginCommand: async (plugin, name, payload) => (await b.send('pluginCommand', { plugin, name, ...(payload !== undefined ? { payload } : {}) })).data });
  ui.setModuleBridge({ pluginCommand: async (plugin, name, payload) => (await b.send('pluginCommand', { plugin, name, ...(payload !== undefined ? { payload } : {}) })).data });
  await b.send('init', { protocolVersion: PROTOCOL_VERSION, catalog });

  // Sauvegardes : IndexedDB (gzip) -> localStorage -> mémoire ; emplacements listés par l'interface.
  store = await SaveStore.open();
  debug.saveStoreKind = store.backend.kind;
  // Sauvegardes en ligne (docs/SAUVEGARDES.md) : dans l'artifact claude.ai, SaveStore synchronisé
  // (locale immédiate + envoi en arrière-plan) ; ailleurs (window.claude absent), store inchangé.
  installCloudSaveBadge();
  // Comptes joueurs Supabase (docs/COMPTES.md) : seulement hors artifact et si src/save/account-config.ts est
  // renseigné ; sinon null (aucune requête) et le comportement reste celui d'avant.
  const accounts = typeof (globalThis as { claude?: { use?: unknown } }).claude?.use === 'function' ? null : attachAccounts(store);
  store = accounts ? accounts.store : await attachCloudSaves(store);
  const st = store;
  if (accounts) {
    installAccountUi(accounts, { toast: (m, k) => ui.toast(m, k ?? 'info') });
    // Changement de compte : « Continuer / Charger » montrent les parties du joueur courant.
    accounts.onChange(() => { if (document.getElementById('main-menu')?.classList.contains('hidden') === false) void refreshMenu(); });
  }
  setSlotProvider({
    list: async () => (await st.list()).map((s): UiSlotInfo => ({
      slot: s.slot, cityName: s.cityName, savedAt: s.savedAt, money: s.money, buildings: s.buildings, gameDate: gameDateLabel(s.totalMinutes), version: s.version,
    })),
    remove: async (slot) => { await st.remove(slot); return true; },
  });
  // Toutes les minutes (au lieu de 3) : une fermeture brutale (Safari iPhone) perd au plus une minute de jeu,
  // la sauvegarde à la fermeture de la page n'ayant pas toujours le temps de finir.
  autosaver = new Autosaver(async () => (await b.send('save', { slot: 'auto' })).data as SaveFile, st, { intervalMs: 60_000, onError: (m: string) => ui.toast(m, 'error') });
  if (state.cityName) autosaver.setPrefix(autoPrefixFor(state.cityName));
  const auto = autosaver;
  // Sauvegarde entièrement automatique : arrière-plan/fermeture, retour au menu, actions importantes.
  autoTriggers = new AutoSaveTriggers({
    saveNow: () => auto.saveNow(), isActive: () => auto.running && !demoRunning,
    flushCloud: () => (st instanceof CloudSlotProvider || st instanceof AccountStore ? st.flush() : Promise.resolve()),
  });
  autoTriggers.install();

  // Perte du contexte WebGL (iPhone : mémoire graphique) : rendu suspendu, partie sauvegardée tout de suite,
  // message ; à la restauration, three ré-envoie textures et géométries, on reconstruit ce qui n'existait que
  // sur le GPU (imposteurs, environnement) et l'affichage reprend.
  let contextLost = false;
  // Diagnostic (e2e perte de contexte) : plafond de textures effectif du rendu.
  (debug as unknown as Record<string, unknown>).maxTextureSize = () => render.ctx.renderer.capabilities.maxTextureSize;
  let lossSave: Promise<void> = Promise.resolve();
  // Restauration qui n'arrive jamais (certains navigateurs mobiles) : après 5 s, message proposant de recharger.
  let lossTimer: ReturnType<typeof setTimeout> | null = null;
  let lossHelp: HTMLElement | null = null;
  const hideLossHelp = (): void => {
    if (lossTimer) { clearTimeout(lossTimer); lossTimer = null; }
    lossHelp?.remove(); lossHelp = null;
  };
  const showLossHelp = (): void => {
    if (lossHelp || !contextLost) return;
    const box = document.createElement('div');
    box.id = 'contexte-perdu';
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-live', 'assertive');
    box.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:10000;max-width:min(420px,calc(100vw - 32px));'
      + 'box-sizing:border-box;padding:18px 20px;border-radius:12px;background:#1d2430;color:#f2f4f8;font:15px/1.45 system-ui,sans-serif;'
      + 'box-shadow:0 10px 40px rgba(0,0,0,.45);text-align:center';
    const p = document.createElement('p');
    p.style.margin = '0 0 14px';
    p.textContent = 'L\'affichage 3D ne revient pas (mémoire graphique de l\'appareil saturée). Votre partie est sauvegardée automatiquement : rechargez la page pour la reprendre.';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Recharger la page';
    btn.style.cssText = 'min-height:44px;padding:0 18px;border:0;border-radius:8px;background:#4fd18b;color:#0d1a12;font:600 15px system-ui,sans-serif;cursor:pointer';
    btn.addEventListener('click', () => {
      btn.disabled = true;
      btn.textContent = 'Sauvegarde…';
      // Sauvegarde automatique terminée (celle de la perte, puis une dernière) avant de recharger.
      void lossSave.then(() => autoTriggers?.saveAndFlush()).catch(() => undefined).finally(() => location.reload());
    });
    box.append(p, btn);
    document.body.appendChild(box);
    lossHelp = box;
  };
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault(); // autorise la restauration
    contextLost = true;
    debug.contextLost = (debug.contextLost ?? 0) + 1;
    render.ctx.stop();
    ui.setLoading(0.5, 'Reprise de l\'affichage…');
    lossSave = (autoTriggers?.saveAndFlush() ?? Promise.resolve()).catch(() => undefined);
    hideLossHelp();
    lossTimer = setTimeout(showLossHelp, 5000);
  }, false);
  canvas.addEventListener('webglcontextrestored', () => {
    if (!contextLost) return;
    contextLost = false;
    hideLossHelp();
    // (Le plafond de textures du mode allégé est réappliqué par rebuildGpu : three recrée ses `capabilities`.)
    try {
      render.rebuildGpu();
      applyGraphicsOptions(ui.currentOptions(), { renderer: render.ctx.renderer, scene: render.ctx.scene, sun: render.ctx.sun, camera: input.camera, perf: render.ctx.perf }); render.onOptionsApplied();
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
      hasCloud: () => (st instanceof CloudSlotProvider && (st.status.state === 'online' || st.status.state === 'syncing')) || (st instanceof AccountStore && st.cloudActive),
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
    // Téléphone : pas de préparation groupée (boucle d'affichage arrêtée, tous les modèles et textures envoyés
    // d'un coup) ; Safari iOS fermait la page à cette étape. Les bâtiments apparaissent au fil du chargement.
    if (render.profile.lite) { traceStep('bâtiments progressifs'); return; }
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
    await render.precompile(1500); // shaders compilés ici plutôt qu'à la première image affichée (ordinateur)
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

  /**
   * Nouvelle partie. `paliers` : déblocages progressifs (docs/PROGRESSION.md), activés AVANT le premier tick sur la
   * ville vide (écran Nouvelle partie : case cochée par défaut ; ?autostart : seulement avec ?paliers, tests).
   */
  async function startNewGame(p: Partial<NewGameParams> = {}, paliers = params.has('paliers')): Promise<void> {
    try {
      demoRunning = false;
      // Génération de la carte (≈ 2 s dans la simulation, puis mise en place du rendu) : écran de progression
      // plutôt qu'un menu figé.
      ui.setLoading(0.85, 'Création de la carte (relief, rivières, forêts)…');
      const snap = waitSnapshot();
      await b.send('newGame', {
        seed: p.seed ?? (params.has('seed') ? Number(params.get('seed')) | 0 : (Math.random() * 2 ** 31) | 0),
        mapChunks: p.mapChunks ?? (params.has('chunks') ? Number(params.get('chunks')) | 0 : DEFAULT_MAP_CHUNKS),
        startMoney: p.startMoney ?? DEFAULT_START_MONEY,
        cityName: p.cityName ?? 'Nouvelle-Aube',
        startHour: params.has('h') ? Number(params.get('h')) : 9,
        startMonth: START_MONTH,
        // Carte : choix de l'écran Nouvelle partie, ou ?rivieres=aucune|une|plusieurs&cote=mer|aucune (tests).
        terrain: p.terrain ?? {
          ...(params.has('rivieres') ? { riverMode: params.get('rivieres') as 'aucune' | 'une' | 'plusieurs' } : {}),
          ...(params.has('cote') ? { hydrology: params.get('cote') === 'aucune' ? 'aucune' as const : 'mer' as const } : {}),
        },
      });
      await snap;
      if (paliers) await b.send('pluginCommand', { plugin: 'paliers', name: 'mode', payload: { verrous: true } }).catch(() => undefined);
      focusCamera(0, 0, 420, 0.6);
      ui.hideMenu();
      ui.hideLoading();
      autosaver?.start();
      await b.send('setSpeed', { speed: 1 });
    } catch (e) {
      ui.hideLoading();
      const err = e instanceof SimCommandError ? e.error : ({ code: 'INVALID_ARGS', message: errText(e) } as CommandError);
      ui.toast(`Impossible de créer la partie : ${err.message}`, 'error');
    }
  }

  /** Scène de démonstration : vraie partie, ville construite par la simulation avec les opérations du joueur. */
  async function startDemo(asGame = false): Promise<void> {
    try {
      // asGame : la ville de démonstration sert de point de départ d'une vraie partie (nom, sauvegarde auto).
      demoRunning = !asGame;
      debug.demoReady = false;
      ui.hideMenu();
      ui.setLoading(0.55, 'Scène de démonstration : génération du terrain…');
      let snap = waitSnapshot();
      await b.send('newGame', { seed: DEMO_SEED, mapChunks: params.has('chunks') ? Number(params.get('chunks')) | 0 : 8, startMoney: DEMO_START_MONEY, cityName: asGame ? 'Meknes City' : 'Aube-sur-Mer (démonstration)', startHour: params.has('h') ? Number(params.get('h')) : 10.5, startMonth: START_MONTH });
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
      ui.setLoading(0.88, 'Préparation des shaders et des textures…');
      await render.precompile();
      startLoop();
      const [ax, az] = city.views.aerial;
      demoViews = { ax, az, street: city.views.street };
      setDemoCamera('aerial');
      input.camera.setHome();
      render.terrain.refineAround(ax, az, 560);
      // Première image rendue sous l'écran de chargement (envois de textures et de géométrie, derniers shaders) :
      // pas d'image figée juste après son retrait.
      if (!render.profile.lite) {
        ui.setLoading(0.95, 'Première image…');
        // Aussi la vue rue et la vue large (LOD proches, terrain lointain, leurs textures et shaders), puis retour :
        // le premier passage dans ces vues ne fige plus l'image (mesures de la page ?bench).
        setDemoCamera('street'); render.ctx.renderNow(1 / 60);
        input.camera.setPose({ distance: 900 }); setDemoCamera('aerial'); input.camera.setPose({ distance: 900 }); render.ctx.renderNow(1 / 60);
        setDemoCamera('aerial'); render.ctx.renderNow(1 / 60);
        // 3 images RÉELLEMENT présentées par la boucle (taille, cible et passes finales), écran de chargement HTML
        // par-dessus : sous ANGLE/D3D11, la première présentation coûtait encore ≈ 1 s après son retrait.
        if (!params.has('norender')) await new Promise<void>((r) => { let n = 0; const f = (): void => { if (++n >= 3) r(); else requestAnimationFrame(f); }; requestAnimationFrame(f); });
      }
      debug.demo = { ...city, decor: city.decor.length };
      ui.hideLoading();
      ui.toast(asGame ? `Nouvelle partie : ville de départ de ${city.buildings} bâtiments, sauvegarde automatique activée.` : `Démonstration : ${city.buildings} bâtiments (${city.distinctBuildings} modèles différents), ${city.vehicles} véhicules. Touche V : vue rue.`, 'info');
      await b.send('setSpeed', { speed: 1 });
      if (asGame) { autosaver?.start(); void autoTriggers?.saveAndFlush(); }
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
      await render.precompile();
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
  installBenchLink();
  if (params.has('stress')) await startStress();
  else if (bench) {
    await startDemo();
    const readyAt = performance.now();
    const cpuFrames = (debug as unknown as Record<string, unknown>).cpuFrames as (n: number, y: number) => { updateMs: number; renderMs: number; calls: number; triangles: number };
    if (debug.demoReady) void runBench({
      renderer: render.ctx.renderer, canvas, quality: ui.currentOptions().quality, lite: render.profile.lite, safeMode: safeModeReason(),
      batched: !render.profile.lite && params.get('lots') !== '0' && render.ctx.renderer.extensions.has('WEBGL_multi_draw'),
      renderStats: () => render.stats(), cpuFrames, setCamera: (m) => setDemoCamera(m === 'demo-street' ? 'street' : 'aerial'),
      cameraPose: () => input.camera.getPose(), lookAt: (x, z, d, p, y) => debug.lookAt?.(x, z, d, p, y),
      setSpeed: (speed) => b.send('setSpeed', { speed: speed as SimSpeed }), pixelRatio: () => render.ctx.renderer.getPixelRatio(),
      shadowSize: () => (render.ctx.sun.castShadow ? render.ctx.sun.shadow.mapSize.x : 0),
      dynamicRange: () => render.ctx.perf.adaptive,
      scene: render.ctx.scene, camera: render.ctx.camera, pauseRender: (p) => { if (p) render.ctx.stop(); else render.ctx.start(); },
      tier: () => { const st = render.stats(); return { tier: st.tier, name: st.tierName, auto: !!render.ctx.perf.tiersEnabled }; }, igpu: render.profile.igpu,
    }, bench, readyAt).catch((e: unknown) => debug.errors.push(`bench: ${errText(e)}`));
  }
  else if (params.has('demo')) await startDemo();
  else if (params.has('autostart')) await startNewGame();
  else if (earlyMenu) {
    // Menu déjà affiché : on garde l'écran en cours (formulaire rempli pendant le chargement), « Continuer » activé.
    continueSlot = latestSlot(await store.list());
    ui.endBootMenu({ canContinue: continueSlot !== null });
  } else await refreshMenu();
  isBooted = true;
  bootDoneResolve();
  // Arbres en pleine définition (vus de près seulement) : chargés après le démarrage, sans retarder le jeu.
  window.setTimeout(() => { void render.veg.loadDetail(); }, 4000);
  debug.ready = true;
  traceStep('prêt');
  // Surveillance continue (menu compris) : un plantage après le chargement est aussi signalé au relancement.
  tracePlaying(true);
  let beat = 0;
  window.setInterval(() => { beat += 20; traceStep(`${state.inGame ? 'en jeu' : 'menu'} ${beat}s`); }, 20000);
  bootDone();
  if (crashReport) { console.warn(crashReport); ui.toast(crashReport, 'error'); }
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
