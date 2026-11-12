/**
 * Amorçage du jeu (thread principal).
 * Câble : catalogue -> rendu -> worker de simulation -> interface -> entrées.
 * Aucune règle de jeu ici : la simulation tourne dans le worker (src/sim).
 */
import { DEFAULT_MAP_CHUNKS, DEFAULT_START_MONEY, GAME_NAME, PROTOCOL_VERSION, type SimSpeed } from './shared/constants';
import { validateCatalog } from './shared/catalog';
import type { CommandError } from './shared/contracts';
import { terrainBounds } from './shared/terrain-gen';
import { SimBridge, SimCommandError } from './client/sim-bridge';
import { createClientState } from './client/state';
import { AssetLibrary, fetchCatalog } from './render/assets';
import { initRender } from './render';
import { initInput } from './input';
import { initUI } from './ui/hud';
import { hasSave, readSave, writeSave } from './save/storage';

const SAVE_SLOT = 'auto';

/** Diagnostic exposé pour les tests e2e (lecture seule). */
interface DebugInfo {
  ready: boolean;
  workerReady: boolean;
  snapshotReceived: boolean;
  deltas: number;
  frames: () => number;
  catalogAssets: number;
  errors: string[];
  lastStats: unknown;
  /** Mis à true par la scène de démonstration quand la ville est construite et les modèles chargés (phase 1, agent intégration). */
  demoReady: boolean;
  validate?: () => Promise<unknown>;
}
declare global { interface Window { __aube: DebugInfo } }

function errText(e: unknown): string {
  if (e instanceof SimCommandError) return e.error.message;
  return e instanceof Error ? e.message : String(e);
}

async function boot(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const debug: DebugInfo = { ready: false, workerReady: false, snapshotReceived: false, deltas: 0, frames: () => 0, catalogAssets: 0, errors: [], lastStats: null, demoReady: false };
  window.__aube = debug;
  const state = createClientState();
  const assetsBase = new URL('./assets/', import.meta.url);
  const workerUrl = new URL('./sim.worker.js', import.meta.url);

  let speedBeforeMenu: SimSpeed = 1;
  const ui = initUI({
    onNewGame: () => { void startNewGame(); },
    onContinue: () => {
      if (state.inGame) { ui.hideMenu(); void bridge.send('setSpeed', { speed: speedBeforeMenu }); return; }
      const data = readSave(SAVE_SLOT);
      if (!data) { ui.toast('Aucune sauvegarde locale', 'error'); return; }
      bridge.send('load', { data }).then(() => { ui.hideMenu(); ui.toast('Partie chargée', 'ok'); })
        .catch((e: unknown) => ui.toast(`Chargement impossible : ${errText(e)}`, 'error'));
    },
    onSpeed: (speed) => { void bridge.send('setSpeed', { speed }).catch((e: unknown) => ui.toast(errText(e), 'error')); },
    onToggleCamera: () => { input.camera.setMode(input.camera.mode === 'aerial' ? 'street' : 'aerial'); },
    onSave: () => {
      bridge.send('save', { slot: SAVE_SLOT }).then((r) => {
        const w = writeSave(r.slot, r.data);
        if (w.ok) ui.toast('Partie sauvegardée (navigateur)', 'ok'); else ui.toast(w.message, 'error');
      }).catch((e: unknown) => ui.toast(errText(e), 'error'));
    },
    onMenu: () => {
      speedBeforeMenu = (state.stats?.speed ?? 1) || 1;
      void bridge.send('setSpeed', { speed: 0 });
      ui.showMenu({ canContinue: hasSave(SAVE_SLOT), inGame: state.inGame });
    },
  });

  ui.setLoading(0.05, 'Chargement du catalogue d\'assets…');
  const catalog = await fetchCatalog(assetsBase);
  const issues = validateCatalog(catalog);
  if (issues.length) console.warn('Catalogue : problèmes détectés', issues);
  debug.catalogAssets = catalog.assets.length;
  const lib = new AssetLibrary(catalog, assetsBase);

  ui.setLoading(0.2, 'Préparation du rendu 3D…');
  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const render = initRender(canvas, lib);
  debug.frames = () => render.ctx.frames;
  const input = initInput(render.ctx.camera, canvas, (x, z) => render.terrain.heightAt(x, z));
  input.camera.setModeListener((m) => { state.cameraMode = m; ui.setCameraMode(m); });
  render.ctx.onFrame.unshift((dt) => {
    input.camera.update(dt);
    const p = input.camera.getPose();
    render.env.follow(p.targetX, p.targetZ);
  });

  if (params.has('validate')) {
    // Mode porte de validation visuelle : pas de partie, inspection des assets à la demande.
    const { validateAllAssets } = await import('./render/validation');
    debug.validate = () => validateAllAssets(lib);
    debug.ready = true;
    ui.hideLoading();
    return;
  }

  ui.setLoading(0.4, 'Démarrage de la simulation…');
  const bridge = await SimBridge.create(workerUrl);
  bridge.onLog((m) => { (m.level === 'error' ? console.error : console.log)(`[sim] ${m.message}`); if (m.level === 'error') debug.errors.push(m.message); });
  bridge.onSnapshot((s) => {
    debug.snapshotReceived = true;
    state.inGame = true;
    state.cityName = s.params.cityName;
    render.applySnapshot(s);
    const b = terrainBounds(s.terrain);
    input.camera.bounds = b;
    input.camera.setPose({ targetX: 0, targetZ: 0, targetY: render.terrain.heightAt(0, 0) });
    state.stats = s.stats;
    ui.updateStats(s.stats);
    ui.showHud(s.params.cityName);
  });
  bridge.onDelta((d) => {
    debug.deltas++;
    render.applyDelta(d);
    state.stats = d.stats;
    debug.lastStats = d.stats;
    ui.updateStats(d.stats);
  });
  await bridge.ready;
  debug.workerReady = true;
  await bridge.send('init', { protocolVersion: PROTOCOL_VERSION, catalog });

  async function startNewGame(): Promise<void> {
    try {
      await bridge.send('newGame', {
        seed: (Math.random() * 2 ** 31) | 0,
        mapChunks: DEFAULT_MAP_CHUNKS,
        startMoney: DEFAULT_START_MONEY,
        cityName: 'Nouvelle-Aube',
      });
      ui.hideMenu();
    } catch (e) {
      const err = e instanceof SimCommandError ? e.error : ({ code: 'INVALID_ARGS', message: errText(e) } as CommandError);
      ui.toast(`Impossible de créer la partie : ${err.message}`, 'error');
    }
  }

  render.ctx.start();
  ui.setLoading(1, 'Prêt');
  ui.hideLoading();
  if (params.has('demo')) {
    ui.toast('La scène de démonstration arrive en phase 1 (bibliothèque d\'assets en cours de production).', 'info');
  }
  if (params.has('autostart') || params.has('demo')) {
    await startNewGame();
  } else {
    ui.setMenuFoot(`${GAME_NAME} · ${catalog.assets.length} modèles au catalogue`);
    ui.showMenu({ canContinue: hasSave(SAVE_SLOT), inGame: false });
  }
  debug.ready = true;
}

boot().catch((e: unknown) => {
  console.error(e);
  const t = document.getElementById('loading-text');
  if (t) t.textContent = `Erreur au démarrage : ${errText(e)}`;
  window.__aube?.errors.push(errText(e));
});
