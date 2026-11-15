/**
 * Aide à la navigation (PC portable et ordinateur) :
 *  - FICHE DES CONTRÔLES (touche « ? », bouton « Contrôles » du menu) : colonnes Clavier / Souris / Pavé tactile,
 *    plus l'écran tactile du téléphone ; la colonne du périphérique détecté (src/input/camera.ts, `detectedInput`)
 *    ou imposé dans les options (Navigation) est mise en avant ;
 *  - ASTUCE unique au premier lancement sur ordinateur (non bloquante, disparaît seule) ;
 *  - boutons d'ORIENTATION près de la boussole (pivoter ↺ ↻, incliner ▲ ▼) : un clic = un pas, maintenir = continu.
 * Styles injectés ici (fichier autonome) ; masqués sur téléphone, où les gestes à deux doigts suffisent.
 * Propriétaire : agent construction/caméra/UI.
 */
import type { CameraController } from '../input/camera';
import { loadOptions } from './options';

const TIP_KEY = 'aube-urbaine:astuce-pave-tactile:v1';
export const TOUCHPAD_TIP = 'Pavé tactile : deux doigts pour déplacer, pincer pour zoomer, Maj + deux doigts pour pivoter';

type Col = 'keyboard' | 'mouse' | 'touchpad' | 'touch';
const COL_TITLES: Record<Col, string> = { keyboard: 'Clavier', mouse: 'Souris', touchpad: 'Pavé tactile', touch: 'Écran tactile (téléphone)' };

/** Contenu de la fiche : [action, commande] par colonne. */
export const CONTROLS: Record<Col, [string, string][]> = {
  keyboard: [
    ['Déplacer', 'Z Q S D (W A S D en QWERTY) ou flèches ; Maj = plus vite'],
    ['Pivoter', 'A / E (Q / E en QWERTY)'],
    ['Incliner', 'R / F ou Page↑ / Page↓'],
    ['Zoom', '+ / −'],
    ['Vue de dessus · nord en haut', 'T · N'],
    ['Retour au départ · survol', 'H · C'],
    ['Vue rue / aérienne', 'V (en rue : Z Q S D pour marcher, Maj = courir)'],
    ['Vitesse · pause', '1 à 5 · Espace'],
    ['Cette fiche', '?'],
  ],
  mouse: [
    ['Déplacer', 'Glisser avec le clic gauche (outil Sélection)'],
    ['Pivoter / incliner', 'Glisser avec le clic droit ou la molette enfoncée (ou Maj + clic gauche)'],
    ['Zoom', 'Molette, vers le curseur'],
    ['Pivoter', 'Maj + molette'],
    ['Bord de l’écran', 'Déplace la carte (à activer dans Options)'],
    ['Sélectionner · étape précédente', 'Clic · clic droit'],
  ],
  touchpad: [
    ['Déplacer', 'Deux doigts glissés, dans tous les sens'],
    ['Zoom', 'Pincer ou écarter deux doigts, vers le curseur'],
    ['Pivoter', 'Maj (ou Alt) + deux doigts à gauche / à droite'],
    ['Incliner', 'Maj (ou Alt) + deux doigts vers le haut / le bas'],
    ['Outils · déplacer en Sélection', 'Clic · clic-glissé à un doigt'],
    ['Sans geste', 'Boutons ↺ ↻ ▲ ▼ près de la boussole ; boussole = nord en haut'],
  ],
  touch: [
    ['Déplacer', 'Un doigt (outil Sélection) ou deux doigts'],
    ['Zoom', 'Pincer ; double toucher = zoom avant ; toucher à deux doigts = zoom arrière'],
    ['Pivoter', 'Tourner deux doigts'],
    ['Incliner', 'Deux doigts immobiles un instant, puis glissés vers le haut / le bas'],
  ],
};

const CSS = `
.mm-orient { display: flex; flex-direction: column; gap: 4px; justify-content: flex-start; }
.mm-orient button { width: 30px; height: 30px; min-height: 30px; padding: 0; border-radius: 10px; background: rgba(var(--ink), .05); }
.mm-orient button svg.ic { width: 17px; height: 17px; }
@media (max-width: 760px), (max-height: 500px) and (orientation: landscape), (hover: none) and (pointer: coarse) { .mm-orient { display: none !important; } }
#controls-help { z-index: 46; }
#controls-help .ch-card { background: var(--panel); border: 1px solid var(--line); border-radius: 20px; padding: 22px 24px; width: min(980px, 100%);
  display: flex; flex-direction: column; gap: 12px; box-shadow: var(--shadow); backdrop-filter: var(--blur); -webkit-backdrop-filter: var(--blur); color: var(--text); }
#controls-help h2 { margin: 0; font-size: 20px; font-weight: 650; color: var(--text-strong); }
#controls-help .ch-mode { margin: 0; font-size: 13px; color: var(--muted); }
#controls-help .ch-mode b { color: var(--accent); }
#controls-help .ch-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
#controls-help .ch-col { border: 1px solid var(--line); border-radius: 14px; padding: 10px 12px; background: rgba(var(--ink), .03); }
#controls-help .ch-col.current { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent) inset; }
#controls-help .ch-col h3 { margin: 0 0 6px; font-size: 14px; display: flex; align-items: center; gap: 8px; color: var(--text-strong); }
#controls-help .ch-col h3 .ch-badge { font-size: 10.5px; font-weight: 600; color: #062a14; background: var(--accent); border-radius: 6px; padding: 1px 6px; }
#controls-help dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 4px 10px; font-size: 12.5px; }
#controls-help dt { color: var(--muted); }
#controls-help dd { margin: 0; }
#controls-help .ch-touch dl { grid-template-columns: auto 1fr auto 1fr; }
#controls-help .ch-foot { display: flex; justify-content: space-between; align-items: center; gap: 10px; font-size: 12px; color: var(--muted); }
@media (max-width: 760px) {
  #controls-help .ch-grid { grid-template-columns: 1fr; }
  #controls-help .ch-touch dl { grid-template-columns: auto 1fr; }
}
#nav-tip { position: fixed; z-index: 30; left: 50%; top: calc(var(--hud-h, 56px) + 10px); transform: translateX(-50%); max-width: min(560px, calc(100vw - 32px));
  display: flex; align-items: center; gap: 10px; padding: 8px 8px 8px 14px; border-radius: 14px; font-size: 13px; line-height: 1.35;
  background: var(--panel); color: var(--text); border: 1px solid var(--line); box-shadow: var(--shadow); pointer-events: none; animation: fade .3s ease-out; }
#nav-tip b { color: var(--accent); font-weight: 650; }
#nav-tip button { pointer-events: auto; min-height: 28px; padding: 2px 10px; font-size: 12px; }
`;

let styled = false;
function injectStyles(): void {
  if (styled || typeof document === 'undefined') return;
  styled = true;
  const s = document.createElement('style');
  s.id = 'controls-help-style';
  s.textContent = CSS;
  document.head.append(s);
}

/** Colonne à mettre en avant : réglage imposé, sinon périphérique détecté, sinon écran tactile seul. */
export function currentColumn(pref: 'auto' | 'touchpad' | 'mouse', detected: 'touchpad' | 'mouse' | 'touch' | null, touchOnly: boolean): Col | null {
  if (pref !== 'auto') return pref;
  if (detected) return detected;
  return touchOnly ? 'touch' : null;
}

export interface ControlsHelpHandle {
  open(): void;
  close(): void;
  readonly isOpen: boolean;
  /** Astuce du pavé tactile, une seule fois par navigateur, sur ordinateur seulement. */
  maybeShowTip(): void;
}

export function initControlsHelp(camera: () => CameraController | null): ControlsHelpHandle {
  injectStyles();
  let box: HTMLElement | null = null;
  const touchOnly = (): boolean => typeof matchMedia !== 'undefined' && matchMedia('(hover: none) and (pointer: coarse)').matches;

  const render = (): HTMLElement => {
    if (!box) {
      box = document.createElement('div');
      box.id = 'controls-help';
      box.className = 'overlay hidden';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      box.setAttribute('aria-labelledby', 'controls-help-title');
      box.addEventListener('click', (e) => { if (e.target === box) handle.close(); });
      document.body.append(box);
    }
    const pref = loadOptions().pointer;
    const detected = camera()?.detectedInput ?? null;
    const cur = currentColumn(pref, detected, touchOnly());
    const card = document.createElement('div');
    card.className = 'ch-card';
    const h = document.createElement('h2');
    h.id = 'controls-help-title';
    h.textContent = 'Contrôles de la caméra';
    const mode = document.createElement('p');
    mode.className = 'ch-mode';
    mode.id = 'controls-help-mode';
    mode.dataset['mode'] = cur ?? '';
    const name = cur ? COL_TITLES[cur] : null;
    if (pref !== 'auto') mode.append('Navigation imposée dans les options : ', bold(COL_TITLES[pref]), '.');
    else if (name) mode.append('Mode détecté : ', bold(name), ' (réglable dans Options › Navigation).');
    else mode.append('Mode détecté : aucun pour l’instant — faites défiler à deux doigts ou tournez la molette au-dessus de la carte.');
    const grid = document.createElement('div');
    grid.className = 'ch-grid';
    const cols: Col[] = touchOnly() ? ['touch', 'keyboard', 'mouse', 'touchpad'] : ['keyboard', 'mouse', 'touchpad', 'touch'];
    for (const c of cols) {
      const col = document.createElement('section');
      col.className = `ch-col${c === cur ? ' current' : ''}${c === 'touch' && !touchOnly() ? ' ch-touch' : ''}`;
      col.dataset['col'] = c;
      if (c === 'touch' && !touchOnly()) col.style.gridColumn = '1 / -1';
      const t = document.createElement('h3');
      t.textContent = COL_TITLES[c];
      if (c === cur) { const b = document.createElement('span'); b.className = 'ch-badge'; b.textContent = pref !== 'auto' ? 'choisi' : 'détecté'; t.append(b); }
      const dl = document.createElement('dl');
      for (const [a, k] of CONTROLS[c]) {
        const dt = document.createElement('dt'); dt.textContent = a;
        const dd = document.createElement('dd'); dd.textContent = k;
        dl.append(dt, dd);
      }
      col.append(t, dl);
      grid.append(col);
    }
    const foot = document.createElement('div');
    foot.className = 'ch-foot';
    const hint = document.createElement('span');
    hint.textContent = 'Le défilement dans les panneaux et les listes ne déplace jamais la caméra.';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'primary';
    close.id = 'controls-help-close';
    close.textContent = 'Fermer';
    close.addEventListener('click', () => handle.close());
    foot.append(hint, close);
    card.append(h, mode, grid, foot);
    box.replaceChildren(card);
    return box;
  };

  let tipEl: HTMLElement | null = null;
  let tipTimer = 0;
  const hideTip = (): void => { clearTimeout(tipTimer); tipEl?.remove(); tipEl = null; };

  const handle: ControlsHelpHandle = {
    open() {
      hideTip();
      const b = render();
      b.classList.remove('hidden');
      b.querySelector<HTMLButtonElement>('#controls-help-close')?.focus({ preventScroll: true });
    },
    close() { box?.classList.add('hidden'); },
    get isOpen() { return !!box && !box.classList.contains('hidden'); },
    maybeShowTip() {
      if (tipEl || typeof matchMedia === 'undefined' || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;
      try { if (localStorage.getItem(TIP_KEY)) return; localStorage.setItem(TIP_KEY, '1'); } catch { return; }
      const el = document.createElement('div');
      el.id = 'nav-tip';
      el.setAttribute('role', 'status');
      const txt = document.createElement('span');
      txt.append(bold('Pavé tactile :'), ' deux doigts pour déplacer, pincer pour zoomer, Maj + deux doigts pour pivoter. Touche ? : tous les contrôles.');
      const ok = document.createElement('button');
      ok.type = 'button';
      ok.textContent = 'Compris';
      ok.addEventListener('click', hideTip);
      el.append(txt, ok);
      document.body.append(el);
      tipEl = el;
      tipTimer = window.setTimeout(hideTip, 14000);
    },
  };

  // Touche « ? » (Maj + , en AZERTY, Maj + / en QWERTY) : en capture, avant les raccourcis d'outils (Maj + , = KeyM).
  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (handle.isOpen && (e.code === 'Escape' || e.key === '?')) { e.preventDefault(); e.stopImmediatePropagation(); handle.close(); return; }
    if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); e.stopImmediatePropagation(); handle.open(); }
  }, true);

  // Boutons d'orientation : un pas au clic, mouvement continu en maintenant appuyé.
  const hold = (id: string, step: number, perSec: number, act: (cam: CameraController, v: number) => void): void => {
    const b = document.getElementById(id);
    if (!b) return;
    let raf = 0, t0 = 0, last = 0;
    const stop = (): void => { cancelAnimationFrame(raf); raf = 0; };
    const loop = (now: number): void => {
      const cam = camera();
      if (!cam) { stop(); return; }
      if (now - t0 > 320) act(cam, perSec * Math.min(0.05, (now - last) / 1000));
      last = now;
      raf = requestAnimationFrame(loop);
    };
    b.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const cam = camera();
      if (!cam) return;
      act(cam, step);
      stop();
      t0 = last = performance.now();
      raf = requestAnimationFrame(loop);
    });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel', 'blur'] as const) b.addEventListener(ev, stop);
    // Clavier (Entrée / Espace) : un pas (le clic de la souris est déjà traité à l'appui).
    b.addEventListener('click', (e) => { if (e.detail === 0) { const cam = camera(); if (cam) act(cam, step); } });
  };
  hold('mm-rot-left', Math.PI / 12, 1.4, (c, v) => c.rotateBy(v));
  hold('mm-rot-right', Math.PI / 12, 1.4, (c, v) => c.rotateBy(-v));
  hold('mm-tilt-up', 0.15, 0.9, (c, v) => c.tiltBy(v));
  hold('mm-tilt-down', 0.15, 0.9, (c, v) => c.tiltBy(-v));

  return handle;
}

function bold(text: string): HTMLElement {
  const b = document.createElement('b');
  b.textContent = text;
  return b;
}
