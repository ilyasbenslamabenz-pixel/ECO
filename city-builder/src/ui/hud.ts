/**
 * Interface (DOM) : écran de chargement, menu principal, barre d'état, outils, notifications.
 * Toute action visible est reliée à une fonction réelle ; les fonctions futures sont
 * désactivées avec leur phase dans le balisage (markup.html).
 * Propriétaire : agent construction/caméra/UI.
 */
import type { CameraMode, SimStats } from '../shared/contracts';
import type { SimSpeed } from '../shared/constants';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Élément #${id} absent du balisage`);
  return el as T;
};

export interface UIHandlers {
  onNewGame(): void;
  onContinue(): void;
  onSpeed(s: SimSpeed): void;
  onToggleCamera(): void;
  onSave(): void;
  onMenu(): void;
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
}

const fmt = new Intl.NumberFormat('fr-FR');
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

export function initUI(h: UIHandlers): UIHandle {
  const menu = $('main-menu');
  const hud = $('hud');
  const toolbar = $('toolbar');
  const btnContinue = $<HTMLButtonElement>('btn-continue');
  $('btn-new').addEventListener('click', () => h.onNewGame());
  btnContinue.addEventListener('click', () => h.onContinue());
  $('btn-camera').addEventListener('click', () => h.onToggleCamera());
  $('btn-save').addEventListener('click', () => h.onSave());
  $('btn-menu').addEventListener('click', () => h.onMenu());
  const speedButtons = [...hud.querySelectorAll<HTMLButtonElement>('[data-speed]')];
  for (const b of speedButtons) b.addEventListener('click', () => h.onSpeed(Number(b.dataset['speed']) as SimSpeed));

  window.addEventListener('keydown', (e) => {
    if (hud.classList.contains('hidden')) return;
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    if (e.code === 'Space') { e.preventDefault(); h.onSpeed(currentSpeed === 0 ? 1 : 0); }
    else if (e.code === 'Digit1') h.onSpeed(1);
    else if (e.code === 'Digit2') h.onSpeed(2);
    else if (e.code === 'Digit3') h.onSpeed(4);
    else if (e.code === 'KeyV') h.onToggleCamera();
    else if (e.code === 'Escape') h.onMenu();
  });

  let currentSpeed: SimSpeed = 1;
  const elDate = $('hud-date');
  const elMoney = $('hud-money');
  const elBalance = $('hud-balance');
  const elPop = $('hud-pop');

  return {
    setLoading(p, text) {
      $('loading').classList.remove('hidden');
      $('loading-bar').style.width = `${Math.round(p * 100)}%`;
      $('loading-text').textContent = text;
    },
    hideLoading() { $('loading').classList.add('hidden'); },
    showMenu({ canContinue, inGame }) {
      btnContinue.disabled = !canContinue && !inGame;
      btnContinue.textContent = inGame ? 'Reprendre' : canContinue ? 'Continuer (sauvegarde locale)' : 'Continuer — aucune sauvegarde';
      menu.classList.remove('hidden');
    },
    hideMenu() { menu.classList.add('hidden'); },
    showHud(cityName) {
      $('hud-city').textContent = cityName;
      hud.classList.remove('hidden');
      toolbar.classList.remove('hidden');
    },
    updateStats(s) {
      const d = s.date;
      elDate.textContent = `${d.day} ${MONTHS[d.month - 1]} an ${d.year} · ${String(d.hour).padStart(2, '0')}:${String(d.minute).padStart(2, '0')}`;
      elMoney.textContent = `${fmt.format(s.money)} ¢`;
      elBalance.textContent = `${s.monthlyBalance >= 0 ? '+' : ''}${fmt.format(s.monthlyBalance)} ¢`;
      elPop.textContent = fmt.format(s.population);
      if (s.speed !== currentSpeed) currentSpeed = s.speed;
      for (const b of speedButtons) b.classList.toggle('active', Number(b.dataset['speed']) === s.speed);
    },
    setCameraMode(m) {
      $('btn-camera').textContent = m === 'aerial' ? 'Vue rue' : 'Vue aérienne';
    },
    toast(text, kind = 'info') {
      const t = document.createElement('div');
      t.className = `toast ${kind}`;
      t.textContent = text;
      $('toasts').appendChild(t);
      setTimeout(() => t.remove(), 4200);
    },
    setMenuFoot(text) { $('menu-foot').textContent = text; },
  };
}
