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
import { Dashboards, ModuleHost, type ModuleBridge } from './dashboards';
import { hydrateIcons, iconEl } from './icons';
import { Minimap } from './minimap';
import type { SimReport } from '../sim/sim-protocol';
import type { CameraMode, SimStats } from '../shared/contracts';
import type { SimSpeed } from '../shared/constants';
import type { PickResult, WorldMirror } from '../client/tools/mirror';
import { roadDef } from '../client/tools/mirror';
import type { ConstructionTools } from '../client/tools/machine';
import type { CameraController } from '../input/camera';
import type { ToolController, ToolUiHooks } from '../input/tools';
import { BuildBar } from './buildbar';
import { $, chfText, el, fmt, money, moneyShort, signedShort } from './dom';
import { FinanceHistory } from './finance';
import { MONTHS_SHORT } from './charts';
import { toast as showToast } from './notify';
import { loadOptions, sanitizeOptions, saveOptions, type GraphicsOptions } from './options';
import { InfoPanel } from './panels';
import { listSlotsAsync, removeSlotAsync, slotId } from './save-slots';
import type { ThumbnailSource } from './thumbnails';
import { initTooltips } from './tooltips';

export interface NewGameChoice { cityName: string; seed: number; mapChunks: number; startMoney: number }

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
    h.onNewGameWith?.({ cityName, seed: Number.isFinite(seed) ? seed | 0 : randomSeed(), mapChunks: Number(f.get('mapChunks')) || 8, startMoney: Number(f.get('startMoney')) || 500000 });
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
      ul.append(el('li', { cls: 'slot' }, el('div', { cls: 'meta' }, el('div', { cls: 'name', text: `${s.cityName} — ${s.slot === 'auto' ? 'sauvegarde rapide' : s.slot}` }),
        el('div', { cls: 'sub', text: `${s.gameDate} · ${money(s.money)} · ${fmt(s.buildings)} bâtiments · ${formatSavedAt(s.savedAt)}` })), load, del));
    }
  };
  const deleteButton = (slot: string, after: () => void): HTMLButtonElement => {
    const del = el('button', { cls: 'danger icon-btn', text: '🗑', attrs: { 'aria-label': `Supprimer ${slot}` } });
    del.dataset['tip'] = 'Supprimer (cliquer deux fois)';
    let armed = false;
    del.addEventListener('click', () => {
      if (!armed) { armed = true; del.textContent = 'Confirmer ?'; setTimeout(() => { armed = false; if (del.isConnected) del.textContent = '🗑'; }, 2500); return; }
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
    (optForm.elements.namedItem('viewDistance') as HTMLInputElement).value = String(o.viewDistance);
    distOut.textContent = `${fmt(o.viewDistance)} m`;
  };
  optForm.addEventListener('input', () => {
    const f = new FormData(optForm);
    const o = sanitizeOptions({ quality: String(f.get('quality')) as GraphicsOptions['quality'], shadows: String(f.get('shadows')) as GraphicsOptions['shadows'], viewDistance: Number(f.get('viewDistance')) });
    distOut.textContent = `${fmt(o.viewDistance)} m`;
    saveOptions(o);
    h.onOptions?.(o);
  });
  optForm.addEventListener('submit', (e) => e.preventDefault());

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
      ul.append(el('li', { cls: 'slot' }, el('div', { cls: 'meta' }, el('div', { cls: 'name', text: s.slot === 'auto' ? 'Sauvegarde rapide' : s.slot }),
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
    const id = slotId(input.value);
    input.value = '';
    void Promise.resolve(h.onSaveSlot?.(id)).then(() => renderSaveList());
  });
  $('btn-menu').addEventListener('click', () => h.onMenu());
  const speedButtons = Array.from(hud.querySelectorAll<HTMLButtonElement>('[data-speed]'));
  for (const b of speedButtons) b.addEventListener('click', () => h.onSpeed(Number(b.dataset['speed']) as SimSpeed));

  /* ---------- Panneaux de droite : un seul ouvert à la fois ---------- */
  const history = new FinanceHistory();
  let api: ConstructionUiApi | null = null;
  let lastStats: SimStats | null = null;
  let cityName = '';
  const modules = new ModuleHost(showToast);
  let dash: Dashboards | null = null;
  /** Ferme les panneaux de droite autres que `id` (finance, population, dash, info). */
  const opened = (id: string): void => {
    if (id !== 'finance') cityPanels.finPanel.classList.add('hidden');
    if (id !== 'population') cityPanels.popPanel.classList.add('hidden');
    if (id !== 'dash') dash?.hide();
    if (id !== 'info' && info?.current) api?.tools.select(null);
    if (id !== 'info') $('info-panel').classList.add('hidden');
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
    modules,
  });
  const dashboards = dash;
  for (const id of ['finance-close', 'pop-close']) $(id).addEventListener('click', () => dashboards.syncSidebar());
  $('hud-money-btn').addEventListener('click', () => { cityPanels.toggleFinance(); dashboards.syncSidebar(); });
  $('hud-pop-btn').addEventListener('click', () => { cityPanels.togglePop(); dashboards.syncSidebar(); });
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

  /* ---------- Objectifs (phase 2C : aucun objectif simulé, panneau discret repliable) ---------- */
  const objToggle = $('obj-toggle');
  objToggle.addEventListener('click', () => {
    const open = $('obj-body').classList.toggle('hidden') === false;
    objToggle.setAttribute('aria-expanded', String(open));
    $('objectives').classList.toggle('open', open);
  });

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
  const touchBar = $('touch-confirm');
  const ensureMinimap = (): void => {
    if (minimap || !api || !heightAt) return;
    minimap = new Minimap({ camera: api.camera, mirror: api.mirror, heightAt });
    (window as unknown as { __aubeMinimap?: Minimap }).__aubeMinimap = minimap;
  };
  /** Satisfaction et variation de population : rapport de la simulation (jamais inventées). */
  const renderReportStats = (): void => {
    const r = cityPanels.report;
    if (!r) return;
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
    },
    updateStats(s) {
      lastStats = s;
      const d = s.date;
      elDay.textContent = `${d.day} ${MONTHS_SHORT[d.month - 1] ?? ''} an ${d.year}`;
      elClock.textContent = `${String(d.hour).padStart(2, '0')}:${String(d.minute).padStart(2, '0')}`;
      elMoney.textContent = moneyShort(s.money);
      elMoney.classList.toggle('neg', s.money < 0);
      elBalance.replaceChildren(signedShort(s.monthlyBalance), el('span', { cls: 'per', text: ' / mois' }));
      elBalance.classList.toggle('neg', s.monthlyBalance < 0);
      elBalance.classList.toggle('pos', s.monthlyBalance > 0);
      elPop.textContent = fmt(s.population);
      currentSpeed = s.speed;
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
    toast(text, kind = 'info') { showToast(text, kind); },
    setMenuFoot(text) { $('menu-foot').textContent = text; },
    toolHooks() {
      return {
        cursorTag(text, kind, sx, sy) {
          if (!text) { cursorTag.classList.add('hidden'); return; }
          cursorTag.textContent = chfText(text);
          cursorTag.className = kind;
          // Étiquette toujours entière à l'écran (centrée sous le doigt en tactile, à droite du curseur sinon).
          const w = cursorTag.offsetWidth, W = window.innerWidth;
          const centered = matchMedia('(max-width: 760px)').matches; // même règle que styles.css (étiquette centrée)
          const x = centered ? Math.min(Math.max(sx, w / 2 + 6), W - w / 2 - 6) : Math.min(sx, W - w - 22);
          cursorTag.style.left = `${Math.max(0, x)}px`;
          cursorTag.style.top = `${sy}px`;
        },
        touchConfirm(o) {
          document.body.classList.toggle('confirming', !!o);
          if (!o) { touchBar.classList.add('hidden'); return; }
          $('tc-ok').textContent = chfText(o.label);
          $('tc-rotate').classList.toggle('hidden', !o.canRotate);
          touchBar.classList.remove('hidden');
        },
        selection(p: PickResult | null) {
          if (p) opened('info');
          info?.show(p);
        },
      };
    },
    enableConstruction(a) {
      api = a;
      buildBar = new BuildBar({ catalog: a.mirror.catalog, tools: a.tools, machine: a.machine, thumbs: a.thumbs, notify: showToast });
      info = new InfoPanel({ mirror: a.mirror, camera: a.camera, thumbs: a.thumbs, demolish: (p) => a.machine.demolishTarget(p).then((ok) => { if (ok) a.tools.select(null); return ok; }), close: () => a.tools.select(null) });
      $('tc-ok').addEventListener('click', () => a.tools.confirmTouch());
      $('tc-rotate').addEventListener('click', () => a.tools.rotate());
      const mag = $('tc-magnet');
      mag.addEventListener('click', () => { a.machine.setMagnet(!a.machine.magnet); mag.setAttribute('aria-pressed', String(a.machine.magnet)); mag.classList.toggle('active', a.machine.magnet); });
      mag.classList.toggle('active', a.machine.magnet);
      $('tc-cancel').addEventListener('click', () => a.tools.cancelTouch());
      a.mirror.onChange(() => { if (cityPanels.financeOpen) cityPanels.renderFinance(); });
      ensureMinimap();
    },
    currentOptions: () => loadOptions(),
    resetFinance() { history.reset(); cityPanels.reset(); cityPanels.renderFinance(); },
    updateReport(r) {
      cityPanels.update(r);
      renderReportStats();
      dashboards.render();
    },
    setExtPort(p) { cityPanels.setPort(p); },
    attachWorld(o) { heightAt = o.heightAt; ensureMinimap(); },
    setModuleBridge(b) { modules.bridge = b; },
    moduleSnapshot(ext) { modules.setSnapshot(ext); },
    moduleDelta(ext) { modules.pushDelta(ext); },
    get buildBar() { return buildBar; },
    get info() { return info; },
  };
  return handle;
}

function randomSeed(): number { return (Math.random() * 2 ** 31) | 0; }

function formatSavedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
