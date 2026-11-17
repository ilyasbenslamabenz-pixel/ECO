/**
 * Interface « Meknes City » (DOM par-dessus le canvas) : écran de chargement, menu principal (nouvelle
 * partie paramétrée, chargement, options, démo, quitter), barre supérieure (vitesses, date, météo,
 * population, satisfaction, trésorerie, statistiques, notifications, réglages), barre latérale de
 * TABLEAUX DE BORD, barre inférieure d'OUTILS DE CONSTRUCTION avec sous-barre, panneaux à onglets à
 * droite (feuille glissante sur téléphone), objectifs, mini-carte, emplacements de sauvegarde,
 * infobulles, notifications, barre de confirmation tactile.
 *
 * Compatibilité : `initUI(handlers)` garde la signature de la fondation. Les fonctions
 * supplémentaires n'apparaissent QUE si le gestionnaire correspondant est fourni (sinon le bouton
 * reste masqué, ou désactivé avec sa phase) : aucun bouton sans action.
 * La construction (outils, catalogue illustré, sélection) s'active par `enableConstruction()`,
 * appelé par `initConstruction()` (src/input/construction.ts).
 * Propriétaire : agent construction/caméra/UI.
 */
import { CityPanels, type ExtPort } from './city-panels';
import { SECTOR_COLORS, SECTOR_LABELS_FR, type DemandSector } from '../shared/protocol-ext/zonage';
import { cityDemand, DEMAND_NOTE, DEMAND_ORDER, demandPct } from './demand';
import { closeFloatingModulePanels, Dashboards, ModuleHost, type ModuleBridge } from './dashboards';
import { hydrateIcons, iconEl } from './icons';
import { Minimap } from './minimap';
import type { SimReport } from '../sim/sim-protocol';
import type { CameraMode, SimStats } from '../shared/contracts';
import { DEFAULT_MAP_CHUNKS, type SimSpeed } from '../shared/constants';
import type { PickResult, WorldMirror } from '../client/tools/mirror';
import { roadDef } from '../client/tools/mirror';
import type { ConstructionTools } from '../client/tools/machine';
import type { CameraController } from '../input/camera';
import type { ToolController, ToolUiHooks } from '../input/tools';
import { BuildBar } from './buildbar';
import { $, chfText, el, fmt, money, moneyShort, signedMoney } from './dom';
import { FinanceHistory } from './finance';
import { MONTHS_SHORT } from './charts';
import { setNotifyDate, toast as showToast } from './notify';
import { loadOptions, sanitizeOptions, saveOptions, type GraphicsOptions } from './options';
import { initControlsHelp } from './controls-help';
import { InfoPanel } from './panels';
import { listSlotsAsync, removeSlotAsync, slotIdKeepCase, slotLabel } from './save-slots';
import type { ThumbnailSource } from './thumbnails';
import { initTooltips } from './tooltips';
import { GROWTH_HINT_FR, GROWTH_HINTS, growthHint } from './satisfaction';
import { Tutorial, type GoalInfo } from './tutorial';
import { openView, progressionView } from '../client/progression-view';
import { nextMilestoneLine, nextMilestonePct } from './panels/paliers';
import { objProgressText, objStreakText } from './panels/objectifs';
import type { DashId } from './dashboards';

export interface NewGameChoice {
  cityName: string; seed: number; mapChunks: number; startMoney: number;
  /** Carte : rivières (aucune / une / plusieurs) et côte (mer / sans mer). */
  riverMode?: 'aucune' | 'une' | 'plusieurs';
  hydrology?: 'mer' | 'aucune';
  /** Déblocages progressifs (paliers) : case de l'écran Nouvelle partie (cochée par défaut). */
  paliers?: boolean;
}

export interface UIHandlers {
  onNewGame(): void;
  onContinue(): void;
  onSpeed(s: SimSpeed): void;
  onToggleCamera(): void;
  onSave(): void;
  onMenu(): void;
  /* --- Facultatifs (fonctions avancées : le bouton n'apparaît que s'ils sont fournis) --- */
  /** Nouvelle partie avec paramètres de carte (sinon « Nouvelle partie » appelle onNewGame). */
  onNewGameWith?(p: NewGameChoice): void;
  /** Charger un emplacement précis (affiche « Charger une partie »). */
  onLoadSlot?(slot: string): void;
  /** Sauvegarder dans un emplacement nommé (affiche le gestionnaire d'emplacements). */
  onSaveSlot?(slot: string): Promise<unknown> | void;
  /** Lancer la scène de démonstration (active le bouton du menu). */
  onDemo?(): void;
  /** Nouvelle partie qui part de la ville de démonstration (sauvegardée comme une partie normale). */
  onDemoGame?(): void;
  /** Quitter la partie en cours (retour à l'accueil). */
  onQuit?(): void;
  /** Appliquer des options graphiques (affiche « Options »). */
  onOptions?(o: GraphicsOptions): void;
}

export interface ConstructionUiApi {
  mirror: WorldMirror;
  machine: ConstructionTools;
  tools: ToolController;
  camera: CameraController;
  thumbs: ThumbnailSource | null;
}

export interface UIHandle {
  setLoading(progress: number, text: string): void;
  hideLoading(): void;
  showMenu(opts: { canContinue: boolean; inGame: boolean }): void;
  hideMenu(): void;
  showHud(cityName: string): void;
  updateStats(s: SimStats): void;
  setCameraMode(m: CameraMode): void;
  toast(text: string, kind?: 'info' | 'error' | 'ok'): void;
  setMenuFoot(text: string): void;
  /* --- Ajouts --- */
  /** Crochets d'interface pour le contrôleur d'outils (étiquette curseur, confirmation tactile, sélection). */
  toolHooks(): ToolUiHooks;
  /** Active barre de construction, panneaux et vue cinématique. */
  enableConstruction(api: ConstructionUiApi): void;
  /** Options graphiques mémorisées. */
  currentOptions(): GraphicsOptions;
  /** Rapport périodique de la simulation (finances détaillées, population). */
  updateReport(r: SimReport): void;
  /** Port des commandes étendues (impôts, emprunts, rapport). */
  setExtPort(p: ExtPort | null): void;
  /** Réinitialise l'historique financier (nouvelle partie / chargement). */
  resetFinance(): void;
  /** Hauteur du terrain rendu (mini-carte). */
  attachWorld(o: { heightAt: (x: number, z: number) => number }): void;
  /** Commandes des modules de phase 2 (panneaux UiPanel). */
  setModuleBridge(b: ModuleBridge | null): void;
  /** États / deltas des modules de phase 2 (`snapshot.ext`, `delta.ext`). */
  moduleSnapshot(ext: Record<string, unknown> | undefined): void;
  moduleDelta(ext: Record<string, unknown> | undefined): void;
  readonly buildBar: BuildBar | null;
  readonly info: InfoPanel | null;
}

export function initUI(h: UIHandlers): UIHandle {
  hydrateIcons();
  initTooltips();
  const menu = $('main-menu');
  const hud = $('hud');
  const toolbar = $('toolbar');
  const btnContinue = $<HTMLButtonElement>('btn-continue');
  const screens = Array.from(menu.querySelectorAll<HTMLElement>('.menu-screen'));
  let inGameFlag = false;
  const showScreen = (name: string): void => {
    for (const s of screens) s.classList.toggle('hidden', s.dataset['screen'] !== name);
    const first = screens.find((s) => s.dataset['screen'] === name)?.querySelector<HTMLElement>('input, select, button:not([disabled])');
    if (name !== 'home' && first && window.matchMedia('(pointer: fine)').matches) first.focus();
  };
  for (const b of Array.from(menu.querySelectorAll<HTMLButtonElement>('[data-back]'))) b.addEventListener('click', () => showScreen('home'));

  /* ---------- Accueil ---------- */
  $('btn-new').addEventListener('click', () => {
    if (h.onNewGameWith) { ($('new-seed') as HTMLInputElement).value = String(randomSeed()); showScreen('new'); } else h.onNewGame();
  });
  btnContinue.addEventListener('click', () => h.onContinue());
  const btnDemo = $<HTMLButtonElement>('btn-demo');
  if (h.onDemo) {
    btnDemo.disabled = false;
    btnDemo.querySelector('.phase')?.remove();
    btnDemo.removeAttribute('title');
    btnDemo.dataset['tip'] = 'Ville déjà construite montrant toute la bibliothèque (vue aérienne et vue rue)';
    btnDemo.addEventListener('click', () => h.onDemo?.());
  }
  const btnNewDemo = $<HTMLButtonElement>('btn-new-demo');
  if (h.onDemoGame) {
    btnNewDemo.classList.remove('hidden');
    btnNewDemo.dataset['tip'] = 'Nouvelle partie sur la ville de démonstration déjà construite, sauvegardée automatiquement';
    btnNewDemo.addEventListener('click', () => h.onDemoGame?.());
  }
  const btnLoad = $<HTMLButtonElement>('btn-load');
  if (h.onLoadSlot) { btnLoad.classList.remove('hidden'); btnLoad.addEventListener('click', () => { void renderLoadList(); showScreen('load'); }); }
  const btnOptions = $<HTMLButtonElement>('btn-options');
  if (h.onOptions) { btnOptions.classList.remove('hidden'); btnOptions.addEventListener('click', () => { fillOptions(); showScreen('options'); }); }
  const btnQuit = $<HTMLButtonElement>('btn-quit');
  if (h.onQuit) btnQuit.addEventListener('click', () => h.onQuit?.());

  /* ---------- Nouvelle partie ---------- */
  $('new-seed-dice').addEventListener('click', () => { ($('new-seed') as HTMLInputElement).value = String(randomSeed()); });
  $<HTMLFormElement>('form-new').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(e.target as HTMLFormElement);
    const cityName = String(f.get('cityName') ?? '').trim().slice(0, 40) || 'Nouvelle-Aube';
    const seed = Number.parseInt(String(f.get('seed') ?? ''), 10);
    const rm = String(f.get('riverMode') ?? 'une');
    const riverMode = rm === 'aucune' || rm === 'plusieurs' ? rm : 'une';
    const hydrology = String(f.get('hydrology') ?? 'mer') === 'aucune' ? 'aucune' : 'mer';
    h.onNewGameWith?.({ cityName, seed: Number.isFinite(seed) ? seed | 0 : randomSeed(), mapChunks: Number(f.get('mapChunks')) || DEFAULT_MAP_CHUNKS, startMoney: Number(f.get('startMoney')) || 500000, riverMode, hydrology, paliers: f.get('paliers') !== null });
  });

  /* ---------- Chargement ---------- */
  const renderLoadList = async (): Promise<void> => {
    const ul = $('load-list');
    const slots = await listSlotsAsync();
    ul.replaceChildren();
    if (!slots.length) { ul.append(el('li', { cls: 'slot-empty', text: 'Aucune sauvegarde dans ce navigateur.' })); return; }
    for (const s of slots) {
      const load = el('button', { cls: 'primary', text: 'Charger' });
      load.addEventListener('click', () => h.onLoadSlot?.(s.slot));
      const del = deleteButton(s.slot, () => { void renderLoadList(); });
      ul.append(el('li', { cls: 'slot' }, el('div', { cls: 'meta' }, el('div', { cls: 'name', text: `${s.cityName} — ${s.slot === 'auto' ? 'sauvegarde rapide' : slotLabel(s.slot)}` }),
        el('div', { cls: 'sub', text: `${s.gameDate} · ${money(s.money)} · ${fmt(s.buildings)} bâtiments · ${formatSavedAt(s.savedAt)}` })), load, del));
    }
  };
  const deleteButton = (slot: string, after: () => void): HTMLButtonElement => {
    const del = el('button', { cls: 'danger icon-btn', attrs: { 'aria-label': `Supprimer ${slot}` } }, iconEl('trash'));
    del.dataset['tip'] = 'Supprimer (cliquer deux fois)';
    let armed = false;
    del.addEventListener('click', () => {
      if (!armed) { armed = true; del.textContent = 'Confirmer ?'; setTimeout(() => { armed = false; if (del.isConnected) del.replaceChildren(iconEl('trash')); }, 2500); return; }
      void removeSlotAsync(slot).then((ok) => {
        if (ok) showToast('Sauvegarde supprimée', 'ok'); else showToast('Suppression impossible', 'error');
        after();
      });
    });
    return del;
  };

  /* ---------- Options ---------- */
  const optForm = $<HTMLFormElement>('form-options');
  const distOut = $('opt-dist-out');
  const fillOptions = (): void => {
    const o = loadOptions();
    (optForm.elements.namedItem('quality') as HTMLSelectElement).value = o.quality;
    (optForm.elements.namedItem('shadows') as HTMLSelectElement).value = o.shadows;
    const dyn = optForm.elements.namedItem('dynRes') as HTMLSelectElement | null;
    if (dyn) dyn.value = o.dynRes;
    const aa = optForm.elements.namedItem('aa') as HTMLSelectElement | null;
    if (aa) aa.value = o.aa;
    (optForm.elements.namedItem('viewDistance') as HTMLInputElement).value = String(o.viewDistance);
    (optForm.elements.namedItem('fps') as HTMLSelectElement).value = o.fps;
    (optForm.elements.namedItem('theme') as HTMLSelectElement).value = o.theme;
    const ev = optForm.elements.namedItem('events') as HTMLSelectElement | null;
    if (ev) ev.value = o.events;
    const ptr = optForm.elements.namedItem('pointer') as HTMLSelectElement | null;
    if (ptr) ptr.value = o.pointer;
    const edge = optForm.elements.namedItem('edgeScroll') as HTMLInputElement | null;
    if (edge) edge.checked = o.edgeScroll;
    const trees = optForm.elements.namedItem('streetTrees') as HTMLInputElement | null;
    if (trees) trees.checked = o.streetTrees;
    const col = optForm.elements.namedItem('colors') as HTMLSelectElement | null;
    if (col) col.value = o.colors;
    distOut.textContent = `${fmt(o.viewDistance)} m`;
    $<HTMLInputElement>('opt-tutorial').checked = tutorial.enabled;
  };
  optForm.addEventListener('input', (e) => {
    if ((e.target as HTMLElement | null)?.id === 'opt-tutorial') return; // case « Premiers pas » : gérée à part
    const f = new FormData(optForm);
    const o = sanitizeOptions({ quality: String(f.get('quality')) as GraphicsOptions['quality'], shadows: String(f.get('shadows')) as GraphicsOptions['shadows'], viewDistance: Number(f.get('viewDistance')), fps: String(f.get('fps')) as GraphicsOptions['fps'], theme: String(f.get('theme')) as GraphicsOptions['theme'], dynRes: String(f.get('dynRes') ?? 'auto') as GraphicsOptions['dynRes'], aa: String(f.get('aa') ?? 'auto') as GraphicsOptions['aa'], events: String(f.get('events') ?? 'normal') as GraphicsOptions['events'], pointer: String(f.get('pointer') ?? 'auto') as GraphicsOptions['pointer'], edgeScroll: f.get('edgeScroll') !== null, streetTrees: f.get('streetTrees') !== null, colors: String(f.get('colors') ?? 'vives') as GraphicsOptions['colors'] });
    distOut.textContent = `${fmt(o.viewDistance)} m`;
    saveOptions(o);
    sendEventsSetting(o.events);
    h.onOptions?.(o);
  });
  optForm.addEventListener('submit', (e) => e.preventDefault());

  /* ---------- Fiche des contrôles (touche ?, bouton du menu), astuce pavé tactile, boutons d'orientation ---------- */
  const controlsHelp = initControlsHelp(() => api?.camera ?? null);
  $('btn-controls').addEventListener('click', () => controlsHelp.open());

  /* ---------- Barre supérieure : sauvegarde, menu, vitesses ---------- */
  $('btn-camera').addEventListener('click', () => h.onToggleCamera());
  const savePanel = $('save-panel');
  const renderSaveList = async (): Promise<void> => {
    const ul = $('save-list');
    const slots = await listSlotsAsync();
    ul.replaceChildren();
    if (!slots.length) ul.append(el('li', { cls: 'slot-empty', text: 'Aucun emplacement : créez-en un ci-dessous.' }));
    for (const s of slots) {
      const over = el('button', { text: 'Écraser' });
      over.addEventListener('click', () => { void Promise.resolve(h.onSaveSlot?.(s.slot)).then(() => renderSaveList()); });
      ul.append(el('li', { cls: 'slot' }, el('div', { cls: 'meta' }, el('div', { cls: 'name', text: s.slot === 'auto' ? 'Sauvegarde rapide' : slotLabel(s.slot) }),
        el('div', { cls: 'sub', text: `${s.cityName} · ${s.gameDate} · ${formatSavedAt(s.savedAt)}` })), over, deleteButton(s.slot, () => { void renderSaveList(); })));
    }
  };
  $('btn-save').addEventListener('click', () => {
    if (h.onSaveSlot) { void renderSaveList(); savePanel.classList.remove('hidden'); } else h.onSave();
  });
  $('save-close').addEventListener('click', () => savePanel.classList.add('hidden'));
  $<HTMLFormElement>('form-save').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $<HTMLInputElement>('save-name');
    const id = slotIdKeepCase(input.value);
    input.value = '';
    void Promise.resolve(h.onSaveSlot?.(id)).then(() => renderSaveList());
  });
  $('btn-menu').addEventListener('click', () => h.onMenu());
  const speedButtons = Array.from(hud.querySelectorAll<HTMLButtonElement>('[data-speed]'));
  // Pause : un second appui reprend à la dernière vitesse ; bouton « vitesse suivante » (barre compacte du téléphone).
  let lastSpeed: SimSpeed = 1;
  for (const b of speedButtons) b.addEventListener('click', () => { const v = Number(b.dataset['speed']) as SimSpeed; h.onSpeed(v === 0 && currentSpeed === 0 ? lastSpeed : v); });
  $('spd-cycle').addEventListener('click', () => {
    const order: SimSpeed[] = [1, 2, 4, 8, 16];
    h.onSpeed(currentSpeed === 0 ? lastSpeed : order[(order.indexOf(currentSpeed as SimSpeed) + 1) % order.length]!);
  });

  /* ---------- Panneaux de droite : un seul ouvert à la fois ---------- */
  const history = new FinanceHistory();
  let api: ConstructionUiApi | null = null;
  let extPort: ExtPort | null = null;
  let lastStats: SimStats | null = null;
  let cityName = '';
  const modules = new ModuleHost(showToast);
  let dash: Dashboards | null = null;
  /**
   * Un seul panneau à la fois : ferme les panneaux de droite autres que `id` (finance, population, dash, info),
   * les anciens panneaux flottants des modules, et, sur téléphone, le tiroir de construction (il passerait dessous).
   * `id = 'drawer'` : un tiroir de construction s'ouvre, tous les tableaux se ferment.
   */
  const opened = (id: string): void => {
    if (id !== 'finance') cityPanels.finPanel.classList.add('hidden');
    if (id !== 'population') cityPanels.popPanel.classList.add('hidden');
    if (id !== 'dash') dash?.hide();
    if (id !== 'info' && info?.current) api?.tools.select(null);
    if (id !== 'info') $('info-panel').classList.add('hidden');
    closeFloatingModulePanels();
    if (id !== 'drawer' && buildBar?.openDrawerId && matchMedia('(max-width: 760px)').matches) buildBar.closeDrawer();
    queueMicrotask(() => dash?.syncSidebar());
  };
  const cityPanels = new CityPanels({
    toast: showToast,
    stats: () => lastStats,
    counts: () => {
      if (!api) return null;
      let road = 0;
      for (const e of api.mirror.edges.values()) road += e.length;
      return { buildings: api.mirror.buildings.size, roadM: road };
    },
    history,
    opened,
  });
  dash = new Dashboards({
    report: () => cityPanels.report,
    stats: () => lastStats,
    mirror: () => api?.mirror ?? null,
    camera: () => api?.camera ?? null,
    cityName: () => cityName,
    toggleCamera: () => h.onToggleCamera(),
    openFinance: () => { if (cityPanels.financeOpen) cityPanels.finPanel.classList.add('hidden'); else cityPanels.openFinance(); },
    openPop: () => { if (cityPanels.popOpen) cityPanels.popPanel.classList.add('hidden'); else cityPanels.openPop(); },
    opened,
    closeSidebar: () => setSidebar(false),
    modules,
  });
  const dashboards = dash;
  for (const id of ['finance-close', 'pop-close']) $(id).addEventListener('click', () => dashboards.syncSidebar());
  $('hud-money-btn').addEventListener('click', () => { cityPanels.toggleFinance(); dashboards.syncSidebar(); });
  $('hud-pop-btn').addEventListener('click', () => { cityPanels.togglePop(); dashboards.syncSidebar(); });
  $('hud-demand-btn').addEventListener('click', () => { if (cityPanels.popOpen) cityPanels.popPanel.classList.add('hidden'); else cityPanels.openPop('demand'); dashboards.syncSidebar(); });
  $('hud-happy-btn').addEventListener('click', () => { if (cityPanels.popOpen) cityPanels.popPanel.classList.add('hidden'); else cityPanels.openPop('overview'); dashboards.syncSidebar(); });

  /* ---------- Barre latérale (tiroir sur téléphone) ---------- */
  const sideBtn = $('btn-sidebar');
  const setSidebar = (open: boolean): void => {
    document.body.classList.toggle('sidebar-open', open);
    sideBtn.setAttribute('aria-expanded', String(open));
    sideBtn.classList.toggle('active', open);
  };
  sideBtn.addEventListener('click', () => setSidebar(!document.body.classList.contains('sidebar-open')));
  $('sidebar-scrim').addEventListener('click', () => setSidebar(false));
  // Raccourcis du menu latéral (téléphone) vers les boutons de la barre du haut : le menu se referme proprement
  // (même état que le bouton ☰, un seul toucher suffit ensuite pour le rouvrir).
  for (const b of Array.from(document.querySelectorAll<HTMLButtonElement>('#sidebar [data-proxy]'))) {
    b.addEventListener('click', () => { setSidebar(false); $(b.dataset['proxy']!).click(); dashboards.syncSidebar(); });
  }

  /* ---------- Premiers pas : objectifs guidés vérifiés d'après la ville (ui/tutorial.ts) ---------- */
  const tutorial = new Tutorial(showToast);
  const optTuto = $<HTMLInputElement>('opt-tutorial');
  optTuto.checked = tutorial.enabled;
  optTuto.addEventListener('change', (e) => { e.stopPropagation(); tutorial.setEnabled(optTuto.checked); tutorial.update(api?.mirror ?? null); });

  /* ---------- Progression : tableaux de bord, rappel de l'objectif, réglage des événements ---------- */
  window.addEventListener('ui:open-view', (e) => {
    const d = (e as CustomEvent<{ dash: string; tab?: string }>).detail;
    if (!d) return;
    setSidebar(false);
    if (d.dash === 'population') cityPanels.openPop();
    else if (d.dash === 'finance') cityPanels.openFinance();
    else dashboards.open(d.dash as DashId, d.tab);
    dashboards.syncSidebar();
  });
  /** Fréquence des événements (Options) transmise à la simulation (partie neuve, chargement, changement). */
  const sendEventsSetting = (f: GraphicsOptions['events']): void => {
    if (!modules.bridge || !inGameFlagSim) return;
    if (progressionView.evenements?.setting === f) return;
    modules.bridge.pluginCommand('evenements', 'reglage', { frequence: f }).catch(() => undefined);
  };
  let inGameFlagSim = false;
  const goalOf = (): GoalInfo | null => {
    const o = progressionView.objectifs, p = progressionView.paliers;
    const prog = { label: 'Progression', run: () => openView('progression', 'mod:objectifs') };
    const act = o?.active ?? [];
    if (act.length) {
      const best = [...act].sort((a, b) => b.progress - a.progress || a.since - b.since)[0]!;
      const streak = objStreakText(best);
      return {
        title: best.title, count: `${Math.round(best.progress * 100)} %`, pct: best.progress * 100,
        lines: [`${objProgressText(best)}${streak ? ` · ${streak}` : ''}`, `Récompense : ${money(best.rewardMoney)} · ${fmt(best.rewardXp)} points`, ...(p ? [nextMilestoneLine(p)] : [])],
        actions: [{ label: 'Voir', run: () => openView(best.dash), primary: true }, prog],
      };
    }
    if (p?.next) {
      return { title: `Palier suivant : ${p.next.nameFr}`, count: `${Math.round(nextMilestonePct(p))} %`, pct: nextMilestonePct(p), lines: [nextMilestoneLine(p)], actions: [{ label: 'Progression', run: () => openView('progression', 'mod:paliers'), primary: true }] };
    }
    return null;
  };
  progressionView.onChange(() => tutorial.setGoal(goalOf()));

  /** Raccordements aux réseaux voisins : réglage `raccordement` des modules électricité et eau (charge utile). */
  const readRaccord = (ext: Record<string, unknown> | undefined): void => {
    const on = (id: string): boolean | undefined => {
      const set = (ext?.[id] as { settings?: { raccordement?: unknown } } | undefined)?.settings;
      return set ? set.raccordement === true : undefined;
    };
    const p = on('electricite'), w = on('eau');
    if (p === undefined && w === undefined) return;
    if (p !== undefined) tutorial.raccord.power = p;
    if (w !== undefined) tutorial.raccord.water = w;
    tutorial.update(api?.mirror ?? null);
  };

  /* ---------- Alertes non répétitives (aide de croissance, circulation) ---------- */
  const alertAt = new Map<string, number>();
  /** Une alerte par clé, au plus une fois par `cooldownMs` (temps réel), réarmée par `rearm(key)`. */
  const alertOnce = (key: string, text: string, cooldownMs: number): void => {
    const now = Date.now();
    const last = alertAt.get(key);
    if (last !== undefined && (last < 0 || now - last < cooldownMs)) return;
    alertAt.set(key, -now); // armée de nouveau seulement quand la condition disparaît
    showToast(text, 'info', 7000);
  };
  const rearm = (key: string): void => { const v = alertAt.get(key); if (v !== undefined && v < 0) alertAt.set(key, -v); };

  /* ---------- Mesures de mise en page (feuilles sur téléphone : entre la barre du haut et les outils) ---------- */
  const rootStyle = document.documentElement.style;
  const measure = (): void => {
    const hr = hud.getBoundingClientRect();
    const tr = toolbar.getBoundingClientRect();
    if (hr.height) rootStyle.setProperty('--hud-h', `${Math.round(hr.bottom)}px`);
    if (tr.height) rootStyle.setProperty('--tb-h', `${Math.max(0, Math.round(window.innerHeight - tr.top))}px`);
  };
  if (typeof ResizeObserver !== 'undefined') { const ro = new ResizeObserver(measure); ro.observe(hud); ro.observe(toolbar); }
  window.addEventListener('resize', measure);
  // Safari iOS : la barre d'adresse qui se replie déplace la page sans redimensionner la barre du haut.
  window.visualViewport?.addEventListener('resize', measure);
  window.visualViewport?.addEventListener('scroll', measure);
  window.setInterval(measure, 1500);

  /* ---------- Clavier global ---------- */
  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    if (e.code === 'Escape') {
      if (!savePanel.classList.contains('hidden')) { savePanel.classList.add('hidden'); return; }
      if (!menu.classList.contains('hidden')) {
        const sub = screens.find((s) => !s.classList.contains('hidden') && s.dataset['screen'] !== 'home');
        if (sub) showScreen('home'); else if (inGameFlag) h.onContinue();
        return;
      }
      if (document.body.classList.contains('sidebar-open')) { setSidebar(false); return; }
      if (cityPanels.financeOpen) { cityPanels.finPanel.classList.add('hidden'); dashboards.syncSidebar(); return; }
      if (cityPanels.popOpen) { cityPanels.popPanel.classList.add('hidden'); dashboards.syncSidebar(); return; }
      if (dashboards.current) { dashboards.close(); return; }
      if (!hud.classList.contains('hidden')) h.onMenu();
      return;
    }
    if (hud.classList.contains('hidden') || !menu.classList.contains('hidden') || !savePanel.classList.contains('hidden')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Space') { e.preventDefault(); h.onSpeed(currentSpeed === 0 ? 1 : 0); }
    else if (e.code === 'Digit1') h.onSpeed(1);
    else if (e.code === 'Digit2') h.onSpeed(2);
    else if (e.code === 'Digit3') h.onSpeed(4);
    else if (e.code === 'Digit4') h.onSpeed(8);
    else if (e.code === 'Digit5') h.onSpeed(16);
    else if (e.code === 'KeyV') h.onToggleCamera();
  });

  let currentSpeed: SimSpeed = 1;
  let lastFinRender = 0;
  // Journal : messages datés en date de jeu (jour, mois, an, heure).
  setNotifyDate(() => {
    const d = lastStats?.date;
    return d ? `${d.day} ${MONTHS_SHORT[d.month - 1] ?? ''} an ${d.year}, ${String(d.hour).padStart(2, '0')}:${String(d.minute).padStart(2, '0')}` : '';
  });
  const elDay = $('hud-day');
  const elClock = $('hud-clock');
  const elMoney = $('hud-money');
  const elBalance = $('hud-balance');
  const elPop = $('hud-pop');
  const elPopDelta = $('hud-pop-delta');
  const elHappy = $('hud-happy');
  let buildBar: BuildBar | null = null;
  let info: InfoPanel | null = null;
  let minimap: Minimap | null = null;
  let heightAt: ((x: number, z: number) => number) | null = null;
  const cursorTag = $('cursor-tag');
  let tagKey = '';
  const touchBar = $('touch-confirm');
  /**
   * Bouton « Construire » de la barre tactile : reflète la validation (dryRun) de l'emplacement par la simulation,
   * grisé avec la raison au lieu d'un refus après coup.
   */
  let tcLabel = '';
  const syncTouchConfirm = (): void => {
    const ok = $<HTMLButtonElement>('tc-ok');
    const reason = $('tc-reason');
    const m = api?.machine;
    const p = m?.preview;
    const shown = !touchBar.classList.contains('hidden') && !!m;
    const bad = shown && m!.tool === 'building' && p?.kind === 'building' && p.validity === 'error';
    // Route, quadrillage, giratoire, ligne, terrain refusés : bouton grisé aussi (il restait vert avec « Tracé refusé »).
    // La démolition garde son bouton (son aperçu rouge signale l'action, pas un refus).
    const refused = shown && !bad && m!.tool !== 'bulldoze' && !!p && 'validity' in p && (p as { validity?: string }).validity === 'error';
    ok.disabled = bad || refused;
    ok.textContent = bad ? 'Emplacement invalide' : tcLabel || 'Construire';
    // Avertissement de la simulation sur un emplacement valide (ex. aucune route ne dessert le bâtiment).
    const warn = !bad && !touchBar.classList.contains('hidden') && m?.tool === 'building' && p?.kind === 'building' && p.validity === 'ok' && !!p.message;
    reason.textContent = p?.kind === 'building' && (bad || warn) ? `${chfText(p.message || 'Emplacement refusé par la simulation')}` : '';
    reason.classList.toggle('hidden', !bad && !warn);
    reason.classList.toggle('warn', warn);
  };
  const ensureMinimap = (): void => {
    if (minimap || !api || !heightAt) return;
    minimap = new Minimap({ camera: api.camera, mirror: api.mirror, heightAt });
    (window as unknown as { __aubeMinimap?: Minimap }).__aubeMinimap = minimap;
  };
  let demandTip = $('hud-demand-btn').dataset['tip'] ?? '';
  /** Jauge de demande : même source et même échelle que Population > Demande (voir ui/demand.ts). */
  const renderDemand = (r: SimReport): void => {
    const v = cityDemand(r);
    if (!v) return;
    const box = $('hud-demand');
    if (!box.childElementCount) for (const s of DEMAND_ORDER) box.append(el('span', { cls: 'col', attrs: { 'data-sector': s } }, el('span', { cls: 'bar' }, el('i', { attrs: { style: `background:${SECTOR_COLORS[s]}` } })), el('b', { text: s, attrs: { style: `color:${SECTOR_COLORS[s]}` } })));
    const parts: string[] = [];
    for (const col of box.children) {
      const s = (col as HTMLElement).dataset['sector'] as DemandSector;
      const x = Math.max(-1, Math.min(1, v[s] ?? 0));
      const i = col.querySelector('i') as HTMLElement;
      i.style.height = `${Math.round(Math.abs(x) * 50)}%`;
      i.style.bottom = x >= 0 ? '50%' : ''; i.style.top = x < 0 ? '50%' : '';
      (col as HTMLElement).dataset['value'] = x.toFixed(2);
      parts.push(`${SECTOR_LABELS_FR[s]} ${demandPct(x)}`);
    }
    demandTip = `Demande de construction — ${parts.join(' · ')}. ${DEMAND_NOTE} Ouvrir le détail.`;
    $('hud-demand-btn').dataset['tip'] = demandTip;
  };

  /** Aide de croissance (champ facultatif `growthHint` de la démographie) : pastille sur la jauge + notification unique. */
  const renderGrowthHint = (r: SimReport): void => {
    const hint = growthHint(r);
    const dot = $('hud-growth-dot');
    dot.classList.toggle('hidden', !hint);
    const btn = $('hud-demand-btn');
    if (hint) {
      btn.dataset['tip'] = `${GROWTH_HINT_FR[hint]}. ${demandTip}`;
      btn.setAttribute('aria-label', `Demande — ${GROWTH_HINT_FR[hint]}`);
      // Début de partie : les Premiers pas disent déjà de tracer des routes et de zoner (pas de notification en double).
      const step = tutorial.currentStepId;
      const covered = (hint === 'need-roads' && step === 'roads') || ((hint === 'need-zones' || hint === 'need-roads') && step === 'zones');
      if (!covered) alertOnce(`growth:${hint}`, GROWTH_HINT_FR[hint], 10 * 60_000);
    } else { btn.setAttribute('aria-label', 'Demande'); btn.dataset['tip'] = demandTip; }
    for (const k of GROWTH_HINTS) if (k !== hint) rearm(`growth:${k}`);
  };
  /** Circulation très lente (vitesse moyenne des véhicules du rapport) : conseil du calque Circulation, sans répétition. */
  const renderTrafficAlert = (r: SimReport): void => {
    const t = r.traffic;
    if (!t || !Number.isFinite(t.meanSpeedKmh)) return;
    if (t.vehicles >= 30 && t.meanSpeedKmh > 0 && t.meanSpeedKmh < 10) {
      alertOnce('traffic', `Circulation très lente (${fmt(Math.round(t.meanSpeedKmh))} km/h en moyenne) : ouvrez Cartes › Trafic (saturation) pour repérer les bouchons, puis élargissez ou doublez les axes saturés.`, 15 * 60_000);
    } else if (t.meanSpeedKmh >= 18) rearm('traffic');
  };

  /** Satisfaction et variation de population : rapport de la simulation (jamais inventées). */
  const renderReportStats = (): void => {
    const r = cityPanels.report;
    if (!r) return;
    renderDemand(r);
    renderGrowthHint(r);
    renderTrafficAlert(r);
    const d = r.demography;
    const net = d.month.immigrants + d.month.births - d.month.emigrants - d.month.deaths;
    elPopDelta.textContent = `${net >= 0 ? '+' : '−'}${fmt(Math.abs(net))}`;
    elPopDelta.className = `delta ${net > 0 ? 'pos' : net < 0 ? 'neg' : ''}`;
    $('hud-pop-btn').dataset['tip'] = `Habitants — variation ce mois : ${elPopDelta.textContent} (arrivées + naissances − départs − décès). Ouvrir Population.`;
    const happyBtn = $('hud-happy-btn');
    if (d.population > 0) {
      const v = Math.round(d.happiness);
      elHappy.textContent = `${fmt(v)} %`;
      const mood = v >= 60 ? 'smile' : v >= 40 ? 'meh' : 'frown';
      const ico = happyBtn.querySelector('svg');
      if (ico && ico.dataset['mood'] !== mood) { const n = iconEl(mood, 'ic-happy'); n.dataset['mood'] = mood; ico.replaceWith(n); }
      happyBtn.dataset['level'] = v >= 60 ? 'good' : v >= 40 ? 'mid' : 'bad';
    } else { elHappy.textContent = '—'; happyBtn.dataset['level'] = ''; }
  };

  const handle: UIHandle = {
    setLoading(p, text) {
      $('loading').classList.remove('hidden');
      $('loading-bar').style.width = `${Math.round(p * 100)}%`;
      $('loading-text').textContent = text;
    },
    hideLoading() { $('loading').classList.add('hidden'); },
    showMenu({ canContinue, inGame }) {
      inGameFlag = inGame;
      btnContinue.disabled = !canContinue && !inGame;
      btnContinue.lastChild!.textContent = inGame ? 'Reprendre' : canContinue ? 'Continuer (dernière partie)' : 'Continuer — aucune sauvegarde';
      btnQuit.classList.toggle('hidden', !(inGame && h.onQuit));
      showScreen('home');
      menu.classList.remove('hidden');
    },
    hideMenu() { menu.classList.add('hidden'); },
    showHud(name) {
      cityName = name;
      $('hud-city').textContent = name;
      for (const id of ['hud', 'toolbar', 'sidebar', 'bottom', 'objectives']) $(id).classList.remove('hidden');
      document.body.classList.add('in-game');
      measure();
      minimap?.invalidate();
      controlsHelp.maybeShowTip();
    },
    updateStats(s) {
      lastStats = s;
      const d = s.date;
      elDay.textContent = `${d.day} ${MONTHS_SHORT[d.month - 1] ?? ''} an ${d.year}`;
      elClock.textContent = `${String(d.hour).padStart(2, '0')}:${String(d.minute).padStart(2, '0')}`;
      const phoneBar = matchMedia('(max-width: 760px)').matches;
      // Téléphone (barre sur une ligne) : montant compact dès 10 000 (« 509 k »), jamais tronqué.
      elMoney.textContent = phoneBar && Math.abs(s.money) >= 1e4 ? tinyNumber(s.money) : moneyShort(s.money);
      elMoney.classList.toggle('neg', s.money < 0);
      // Solde MENSUEL prévu : la même valeur que « Solde mensuel prévu » du panneau Finances (rapport de la
      // simulation : impôts + services − entretien − salaires − emprunts), sinon celle des statistiques.
      const fc = cityPanels.report?.economy.forecast;
      const mb = fc ? fc.balance : s.monthlyBalance;
      const sign = mb > 0 ? '+' : mb < 0 ? '−' : '±';
      elBalance.replaceChildren(phoneBar ? `${sign}${tinyNumber(Math.abs(mb))}` : `${sign}${moneyShort(Math.abs(mb))}`, el('span', { cls: 'per', text: phoneBar ? '/mois' : ' / mois' }));
      elBalance.classList.toggle('neg', mb < 0);
      elBalance.classList.toggle('pos', mb > 0);
      $('hud-money-btn').dataset['tip'] = `Trésorerie ${money(s.money)} · solde mensuel prévu ${signedMoney(mb)} (même calcul que le panneau Finances) — ouvrir les finances`;
      // Téléphone : habitants compacts dès 1 000 (« 2,9 k »).
      elPop.textContent = phoneBar && s.population >= 1000 ? `${(s.population / 1000).toLocaleString('fr-FR', { maximumFractionDigits: s.population >= 1e5 ? 0 : 1 })}k` : fmt(s.population);
      currentSpeed = s.speed;
      if (s.speed !== 0) lastSpeed = s.speed;
      const cyc = $('spd-cycle');
      cyc.textContent = `×${s.speed === 0 ? lastSpeed : s.speed}`;
      cyc.classList.toggle('paused', s.speed === 0);
      for (const b of speedButtons) { const on = Number(b.dataset['speed']) === s.speed; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); }
      const newDay = history.push(s);
      // Panneau Finances : trésorerie à jour, sans redessiner les graphiques à chaque delta (≤ 2 fois/s).
      const now = performance.now();
      if (cityPanels.financeOpen && (newDay || now - lastFinRender > 500)) { lastFinRender = now; cityPanels.renderFinance(); }
    },
    setCameraMode(m) {
      const b = $('btn-camera');
      const label = m === 'aerial' ? 'Vue rue' : 'Vue aérienne';
      (b.querySelector('.tl') ?? b).textContent = label;
      b.classList.toggle('active', m === 'street');
      const ico = b.querySelector('svg');
      if (ico) ico.replaceWith(iconEl(m === 'aerial' ? 'walk' : 'eye'));
      if (dashboards.current === 'city') dashboards.render(true);
    },
    toast(text, kind = 'info') {
      // Messages de la progression : bouton « Voir » vers le bon onglet du tableau de bord Progression.
      const tab = /^Événement/.test(text) ? 'mod:evenements' : /^(Nouvel objectif|Objectif accompli|Réalisation)/.test(text) ? 'mod:objectifs' : /^Palier atteint/.test(text) ? 'mod:paliers' : null;
      if (tab) showToast(text, kind, /^Événement/.test(text) ? 9000 : 6000, { label: 'Voir', run: () => openView('progression', tab) });
      // Conseil électricité (réseau seulement éolien / solaire) : bouton vers le tableau de bord Énergie, qui propose
      // le raccordement au réseau voisin en un geste.
      else if (/^La nuit sans vent/.test(text)) showToast(text, kind, 12000, { label: 'Énergie', run: () => openView('energy') });
      else showToast(text, kind);
    },
    // Pied du menu : sans détail technique (support de stockage des sauvegardes).
    setMenuFoot(text) { $('menu-foot').textContent = text.replace(/\s*·\s*sauvegardes\s*:\s*\S+/i, ' · sauvegardes dans ce navigateur'); },
    toolHooks() {
      return {
        cursorTag(text, kind, sx, sy) {
          if (!text) { cursorTag.classList.add('hidden'); tagKey = ''; return; }
          // Étiquette structurée : une ligne par rangée (1re = coût et longueur/surface, suivantes = angle, pente, aides) ;
          // en refus, la dernière ligne porte la cause. textContent inchangé (lignes séparées par « \n ») pour les tests.
          const key = `${kind}|${text}`;
          if (key !== tagKey) {
            tagKey = key;
            const lines = chfText(text).split('\n').filter((l) => l.trim());
            const nodes: (Node | string)[] = [];
            lines.forEach((l, i) => {
              if (i) nodes.push('\n');
              const cls = ['ct-row'];
              if (i === 0) cls.push('ct-head');
              if (kind === 'error' && i === lines.length - 1) cls.push('ct-reason');
              nodes.push(el('span', { cls: cls.join(' '), text: l }));
            });
            cursorTag.replaceChildren(...nodes);
          }
          cursorTag.className = kind;
          cursorTag.dataset.state = kind === 'error' ? 'refus' : kind === 'pending' ? 'attention' : kind === 'ok' ? 'ok' : 'info';
          // Étiquette toujours entière à l'écran (centrée sous le doigt en tactile, à droite du curseur sinon).
          const w = cursorTag.offsetWidth, W = window.innerWidth;
          const centered = matchMedia('(max-width: 760px)').matches; // même règle que styles.css (étiquette centrée)
          if (centered) {
            // Téléphone : étiquette fixée en haut, sous la barre (elle ne cache plus le bâtiment sous le doigt).
            const hud = document.getElementById('hud');
            const top = hud && !hud.classList.contains('hidden') ? hud.getBoundingClientRect().bottom + 6 : 8;
            cursorTag.style.left = `${W / 2}px`;
            cursorTag.style.top = `${Math.round(top)}px`;
            cursorTag.classList.add('pinned');
            return;
          }
          const x = Math.min(sx, W - w - 22);
          cursorTag.style.left = `${Math.max(0, x)}px`;
          cursorTag.style.top = `${sy}px`;
          // Jamais par-dessus la barre d'outils, ses options (« Terminer », « Pivoter »…) ni le bouton « Terminer le tracé » :
          // si l'étiquette les chevauche (curseur près du bas de l'écran), elle remonte juste au-dessus.
          const tr = cursorTag.getBoundingClientRect();
          let limit = Infinity;
          for (const id of ['tool-options', 'toolbar', 'road-finish']) {
            const el = document.getElementById(id);
            if (!el || el.classList.contains('hidden')) continue;
            const r = el.getBoundingClientRect();
            if (r.width && tr.left < r.right && tr.right > r.left && tr.bottom > r.top) limit = Math.min(limit, r.top);
          }
          if (limit === Infinity && tr.bottom > window.innerHeight - 8) limit = window.innerHeight - 8; // jamais sous le bord de l'écran
          if (limit !== Infinity) cursorTag.style.top = `${Math.max(0, sy - (tr.bottom - limit) - 8)}px`;
        },
        touchConfirm(o) {
          document.body.classList.toggle('confirming', !!o);
          if (!o) { touchBar.classList.add('hidden'); tcLabel = ''; syncTouchConfirm(); return; }
          tcLabel = chfText(o.label);
          $('tc-rotate').classList.toggle('hidden', !o.canRotate);
          touchBar.classList.remove('hidden');
          syncTouchConfirm();
        },
        selection(p: PickResult | null) {
          if (p) opened('info');
          info?.show(p);
        },
      };
    },
    enableConstruction(a) {
      api = a;
      buildBar = new BuildBar({ catalog: a.mirror.catalog, tools: a.tools, machine: a.machine, thumbs: a.thumbs, notify: showToast, onDrawerOpen: () => opened('drawer') });
      info = new InfoPanel({ mirror: a.mirror, camera: a.camera, thumbs: a.thumbs, demolish: (p) => a.machine.demolishTarget(p).then((ok) => { if (ok) a.tools.select(null); return ok; }), move: (rec) => { a.tools.select(null); a.machine.startMove(rec); },
        serviceInfo: async (id) => (await a.machine.pluginCommand('ameliorations', 'info', { buildingId: id })) as { level: number; max: number; upgradeCost: number | null; radiusFactor: number; capacityFactor: number; extraUpkeep: number },
        inspect: async (id) => (extPort ? await extPort.sendExt('inspectBuilding', { buildingId: id }) : null),
        upgradeService: async (id) => { try { await a.machine.pluginCommand('ameliorations', 'upgrade', { buildingId: id }); return true; } catch (e) { showToast(`Amélioration refusée : ${(e as { error?: { message?: string } })?.error?.message ?? String(e)}`, 'error'); return false; } },
        rebuild: async (id) => { try { await a.machine.pluginCommand('services', 'reconstruire', { buildingId: id }); showToast('Bâtiment reconstruit', 'ok'); return true; } catch (e) { showToast(`Reconstruction refusée : ${(e as { error?: { message?: string } })?.error?.message ?? String(e)}`, 'error'); return false; } },
        close: () => a.tools.select(null) });
      $('tc-ok').addEventListener('click', () => { if (!$<HTMLButtonElement>('tc-ok').disabled) a.tools.confirmTouch(); });
      a.machine.onPreview(() => syncTouchConfirm());
      $('tc-rotate').addEventListener('click', () => a.tools.rotate());
      const mag = $('tc-magnet');
      mag.addEventListener('click', () => { a.machine.setMagnet(!a.machine.magnet); mag.setAttribute('aria-pressed', String(a.machine.magnet)); mag.classList.toggle('active', a.machine.magnet); });
      mag.classList.toggle('active', a.machine.magnet);
      $('tc-cancel').addEventListener('click', () => a.tools.cancelTouch());
      a.mirror.onChange(() => { if (cityPanels.financeOpen) cityPanels.renderFinance(); tutorial.update(a.mirror); });
      ensureMinimap();
    },
    currentOptions: () => loadOptions(),
    resetFinance() { history.reset(); cityPanels.reset(); cityPanels.renderFinance(); },
    updateReport(r) {
      cityPanels.update(r);
      renderReportStats();
      dashboards.render();
      tutorial.update(api?.mirror ?? null);
    },
    setExtPort(p) { extPort = p; cityPanels.setPort(p); },
    attachWorld(o) { heightAt = o.heightAt; ensureMinimap(); },
    setModuleBridge(b) { modules.bridge = b; },
    moduleSnapshot(ext) {
      modules.setSnapshot(ext); tutorial.raccord = { power: false, water: false }; readRaccord(ext);
      progressionView.setSnapshot(ext);
      inGameFlagSim = true;
      sendEventsSetting(loadOptions().events);
    },
    moduleDelta(ext) { modules.pushDelta(ext); readRaccord(ext); progressionView.pushDelta(ext); },
    get buildBar() { return buildBar; },
    get info() { return info; },
  };
  return handle;
}

function randomSeed(): number { return (Math.random() * 2 ** 31) | 0; }

/** Nombre très compact pour la barre du téléphone : « 2,95 M », « 509 k », « 37 k », « 3,7 k », « 845 ». */
export function tinyNumber(n: number): string {
  const a = Math.abs(n);
  const s = n < 0 ? '−' : '';
  const d = (v: number, max: number): string => v.toLocaleString('fr-FR', { maximumFractionDigits: max });
  if (a >= 1e9) return `${s}${d(a / 1e9, 1)} Md`;
  if (a >= 1e6) return `${s}${d(a / 1e6, a >= 1e7 ? 1 : 2)} M`;
  if (a >= 1e4) return `${s}${d(a / 1e3, 0)} k`;
  if (a >= 1e3) return `${s}${d(a / 1e3, 1)} k`;
  return `${s}${fmt(a)}`;
}

function formatSavedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
