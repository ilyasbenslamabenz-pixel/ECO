/**
 * Interface (DOM par-dessus le canvas) : écran de chargement, menu principal (nouvelle partie
 * paramétrée, chargement, options, démo, quitter), barre supérieure, barre de construction,
 * panneaux (information, finances), emplacements de sauvegarde, infobulles, notifications,
 * barre de confirmation tactile.
 *
 * Compatibilité : `initUI(handlers)` garde la signature de la fondation. Les fonctions
 * supplémentaires n'apparaissent QUE si le gestionnaire correspondant est fourni (sinon le bouton
 * reste masqué, ou désactivé avec sa phase) : aucun bouton sans action.
 * La construction (outils, catalogue illustré, sélection) s'active par `enableConstruction()`,
 * appelé par `initConstruction()` (src/input/construction.ts).
 * Propriétaire : agent construction/caméra/UI.
 */
import { CityPanels, type ExtPort } from './city-panels';
import type { SimReport } from '../sim/sim-protocol';
import type { CameraMode, SimStats } from '../shared/contracts';
import type { SimSpeed } from '../shared/constants';
import type { PickResult, WorldMirror } from '../client/tools/mirror';
import { roadDef } from '../client/tools/mirror';
import type { ConstructionTools } from '../client/tools/machine';
import type { CameraController } from '../input/camera';
import type { ToolController, ToolUiHooks } from '../input/tools';
import { BuildBar } from './buildbar';
import { $, el, fmt, money, MONTHS, signedMoney } from './dom';
import { FinanceChart, FinanceHistory } from './finance';
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
  readonly buildBar: BuildBar | null;
  readonly info: InfoPanel | null;
}

export function initUI(h: UIHandlers): UIHandle {
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

  /* ---------- Barre supérieure ---------- */
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

  /* ---------- Finances ---------- */
  const history = new FinanceHistory();
  const finPanel = $('finance-panel');
  const chart = new FinanceChart($<HTMLCanvasElement>('fin-chart'), $('fin-tip'), history);
  let api: ConstructionUiApi | null = null;
  let lastStats: SimStats | null = null;
  const btnFinance = $('btn-finance');
  btnFinance.classList.remove('hidden');
  const cityPanels = new CityPanels(showToast);
  const toggleFinance = (): void => {
    finPanel.classList.toggle('hidden');
    if (!finPanel.classList.contains('hidden')) { $('pop-panel').classList.add('hidden'); renderFinance(); }
  };
  btnFinance.addEventListener('click', toggleFinance);
  $('hud-money-btn').addEventListener('click', toggleFinance);
  $('finance-close').addEventListener('click', () => finPanel.classList.add('hidden'));
  $('finance-fold').addEventListener('click', () => finPanel.classList.toggle('folded'));
  const renderFinance = (): void => {
    const s = lastStats;
    if (!s || finPanel.classList.contains('hidden')) return;
    $('fin-money').textContent = money(s.money);
    $('fin-pop').textContent = fmt(s.population);
    const bal = $('fin-balance');
    bal.textContent = signedMoney(s.monthlyBalance);
    bal.className = s.monthlyBalance < 0 ? 'neg' : 'pos';
    if (api) {
      let ub = 0; let ur = 0;
      const m = api.mirror;
      for (const b of m.buildings.values()) ub += m.asset(b.assetId)?.upkeepPerMonth ?? 0;
      for (const e of m.edges.values()) ur += e.length * (roadDef(e.kind ?? e.type)?.upkeepPerMeterMonth ?? 0);
      $('fin-upkeep-b').textContent = `−${money(ub)} / mois`;
      $('fin-upkeep-r').textContent = `−${money(ur)} / mois`;
      $('fin-counts').textContent = `${fmt(m.buildings.size)} · ${fmt(s.roadLengthM)} m`;
    } else {
      $('fin-upkeep-b').textContent = '—'; $('fin-upkeep-r').textContent = '—';
      $('fin-counts').textContent = `${fmt(s.buildings)} · ${fmt(s.roadLengthM)} m`;
    }
    $('fin-range').textContent = history.points.length ? `· ${history.points.length} jour${history.points.length > 1 ? 's' : ''} relevé${history.points.length > 1 ? 's' : ''}` : '';
    chart.draw();
    cityPanels.render();
  };

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
      if (!finPanel.classList.contains('hidden')) { finPanel.classList.add('hidden'); return; }
      if (!$('pop-panel').classList.contains('hidden')) { $('pop-panel').classList.add('hidden'); return; }
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
  const elDate = $('hud-date');
  const elMoney = $('hud-money');
  const elBalance = $('hud-balance');
  const elPop = $('hud-pop');
  let buildBar: BuildBar | null = null;
  let info: InfoPanel | null = null;
  const cursorTag = $('cursor-tag');
  const touchBar = $('touch-confirm');

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
      btnContinue.lastChild!.textContent = inGame ? 'Reprendre' : canContinue ? 'Continuer (sauvegarde rapide)' : 'Continuer — aucune sauvegarde';
      btnQuit.classList.toggle('hidden', !(inGame && h.onQuit));
      showScreen('home');
      menu.classList.remove('hidden');
    },
    hideMenu() { menu.classList.add('hidden'); },
    showHud(cityName) {
      $('hud-city').textContent = cityName;
      hud.classList.remove('hidden');
      toolbar.classList.remove('hidden');
    },
    updateStats(s) {
      lastStats = s;
      const d = s.date;
      elDate.textContent = `${d.day} ${MONTHS[d.month - 1]} an ${d.year} · ${String(d.hour).padStart(2, '0')}:${String(d.minute).padStart(2, '0')}`;
      elMoney.textContent = money(s.money);
      elMoney.classList.toggle('neg', s.money < 0);
      elBalance.textContent = signedMoney(s.monthlyBalance);
      elBalance.classList.toggle('neg', s.monthlyBalance < 0);
      elBalance.classList.toggle('pos', s.monthlyBalance > 0);
      elPop.textContent = fmt(s.population);
      currentSpeed = s.speed;
      for (const b of speedButtons) b.classList.toggle('active', Number(b.dataset['speed']) === s.speed);
      if (history.push(s)) renderFinance(); else if (!finPanel.classList.contains('hidden')) renderFinance();
    },
    setCameraMode(m) {
      const b = $('btn-camera');
      (b.querySelector('.tl') ?? b).textContent = m === 'aerial' ? 'Vue rue' : 'Vue aérienne';
    },
    toast(text, kind = 'info') { showToast(text, kind); },
    setMenuFoot(text) { $('menu-foot').textContent = text; },
    toolHooks() {
      return {
        cursorTag(text, kind, sx, sy) {
          if (!text) { cursorTag.classList.add('hidden'); return; }
          cursorTag.textContent = text;
          cursorTag.className = kind;
          cursorTag.style.left = `${sx}px`;
          cursorTag.style.top = `${sy}px`;
        },
        touchConfirm(o) {
          document.body.classList.toggle('confirming', !!o);
          if (!o) { touchBar.classList.add('hidden'); return; }
          $('tc-ok').textContent = o.label;
          $('tc-rotate').classList.toggle('hidden', !o.canRotate);
          touchBar.classList.remove('hidden');
        },
        selection(p: PickResult | null) { info?.show(p); },
      };
    },
    enableConstruction(a) {
      api = a;
      buildBar = new BuildBar({ catalog: a.mirror.catalog, tools: a.tools, machine: a.machine, thumbs: a.thumbs, notify: showToast });
      info = new InfoPanel({ mirror: a.mirror, camera: a.camera, thumbs: a.thumbs, demolish: (p) => a.machine.demolishTarget(p).then((ok) => { if (ok) a.tools.select(null); return ok; }), close: () => a.tools.select(null) });
      $('tc-ok').addEventListener('click', () => a.tools.confirmTouch());
      $('tc-rotate').addEventListener('click', () => a.tools.rotate());
      $('tc-cancel').addEventListener('click', () => a.tools.cancelTouch());
      const cine = $('btn-cinematic');
      cine.classList.remove('hidden');
      cine.addEventListener('click', () => a.camera.toggleCinematic());
      a.camera.setCinematicListener((on) => { cine.setAttribute('aria-pressed', String(on)); cine.classList.toggle('active', on); });
      a.mirror.onChange(() => { if (!finPanel.classList.contains('hidden')) renderFinance(); });
    },
    currentOptions: () => loadOptions(),
    resetFinance() { history.reset(); cityPanels.reset(); renderFinance(); },
    updateReport(r) { cityPanels.update(r); },
    setExtPort(p) { cityPanels.setPort(p); },
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
