/**
 * Boutique City — point d'entrée : menu, partie (simulation), scène 3D, interface, boucle, sauvegarde automatique.
 * Adresse : ?seed=N (quartier), ?nouveau (ignore la sauvegarde), ?vitesse=0..3.
 */
import { formatClock } from './sim/clock';
import { Game, type GameSave } from './sim/game';
import type { Premise } from './sim/district';
import { Scene3D } from './render/scene';
import { $, button, chf, el } from './ui/dom';
import { InteriorEditor } from './ui/editor';
import { SidePanel } from './ui/panels';

const SAVE_KEY = 'boutique-city.save.v1';
/** Minutes de jeu par seconde réelle, pour chaque vitesse (0 = pause). */
const SPEEDS = [0, 3, 10, 30];
const params = new URLSearchParams(location.search);

interface Debug { game: Game | null; scene: Scene3D | null; ready: boolean; errors: string[]; advance(min: number): void; select(premiseId: number): void }
const debug: Debug = { game: null, scene: null, ready: false, errors: [], advance: () => undefined, select: () => undefined };
(window as unknown as { __bc: Debug }).__bc = debug;
window.addEventListener('error', (e) => debug.errors.push(String(e.message)));
window.addEventListener('unhandledrejection', (e) => debug.errors.push(String(e.reason)));

function readSave(): GameSave | null {
  try { const t = localStorage.getItem(SAVE_KEY); return t ? JSON.parse(t) as GameSave : null; } catch { return null; }
}
function writeSave(g: Game): void {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(g.save())); } catch { /* stockage indisponible : la partie continue */ }
}

function toast(text: string, kind: 'ok' | 'error' | 'info' | 'warn' = 'info'): void {
  const box = $('toasts');
  const t = el('div', { cls: `toast ${kind}`, text });
  box.append(t);
  while (box.children.length > 4) box.firstElementChild?.remove();
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, kind === 'error' ? 5000 : 4200);
}

function menu(): void {
  const save = readSave();
  const name = el('input', { attrs: { type: 'text', maxlength: '30', value: 'Mon entreprise', 'aria-label': 'Nom de votre entreprise' } });
  const box = $('menu');
  box.replaceChildren(el('div', { cls: 'menu-card' },
    el('h1', { text: 'Boutique City' }),
    el('p', { cls: 'tag', text: 'Louez un local, aménagez-le, embauchez, remplissez les rayons… et bâtissez votre réseau de commerces.' }),
    save && !params.has('nouveau') ? button(`Continuer : ${save.companyName} (jour ${Math.floor(save.total / 1440) + 1})`, () => start(new Game(save.seed, save.companyName, save)), 'primary wide') : null,
    el('div', { cls: 'sec', text: 'Nouvelle entreprise' }),
    el('label', { cls: 'field' }, el('span', { text: 'Nom de l’entreprise' }), name),
    button('Créer — 40 000 CHF de capital', () => {
      if (save && !params.has('nouveau') && !confirm('Remplacer la partie sauvegardée ?')) return;
      start(new Game(params.has('seed') ? Number(params.get('seed')) | 0 : (Math.random() * 1e9) | 0, name.value.trim() || 'Mon entreprise'));
    }, save ? 'wide' : 'primary wide'),
    el('p', { cls: 'muted small', text: 'Sauvegarde automatique chaque jour de jeu (dans ce navigateur).' }),
  ));
  box.classList.remove('hidden');
}

function start(game: Game): void {
  $('menu').classList.add('hidden');
  debug.game = game;
  const canvas = $<HTMLCanvasElement>('scene');
  const scene = new Scene3D(canvas, game.district);
  debug.scene = scene;
  let speed = params.has('vitesse') ? Math.max(0, Math.min(3, Number(params.get('vitesse')) | 0)) : 1;
  let lastDay = game.day;
  let noticeIdx = game.notices.length;

  const editor = new InteriorEditor(game, toast, () => { syncPremises(); panel.refresh(true); });
  const focusPremise = (premiseId: number): void => {
    const p = game.premise(premiseId)!;
    scene.controls.setPose({ targetX: p.doorX, targetZ: p.doorZ, distance: 120 });
    scene.view.setSelected(p.buildingId);
  };
  const panel = new SidePanel(game, { toast, openEditor: (s) => editor.open(s), focus: focusPremise, changed: () => syncPremises() });

  /** Étiquettes et auvents des locaux selon leur état. */
  const syncPremises = (): void => {
    scene.view.setPremises(game.district.premises.map((p: Premise) => {
      const sh = game.shopAt(p.id);
      return { premiseId: p.id, buildingId: p.buildingId, kind: sh ? 'joueur' as const : p.competitor ? 'concurrent' as const : 'libre' as const, type: sh?.type ?? p.competitor, label: sh ? sh.name : 'À louer' };
    }));
    renderShops();
  };

  // Barre du haut.
  const hud = $('hud');
  const clock = el('span', { cls: 'clock' });
  const cash = el('b', { cls: 'cash' });
  const speedBtns = ['⏸', '▶', '▶▶', '▶▶▶'].map((t, k) => button(t, () => { speed = k; paint(); }, 'spd'));
  speedBtns.forEach((b, k) => b.setAttribute('aria-label', k === 0 ? 'Pause' : `Vitesse ${k}`));
  hud.replaceChildren(
    el('div', { cls: 'brand' }, el('b', { text: 'Boutique City' }), el('span', { text: game.companyName })),
    el('div', { cls: 'time' }, clock, el('div', { cls: 'speeds' }, ...speedBtns)),
    el('div', { cls: 'money' }, el('span', { text: 'Trésorerie' }), cash),
    el('div', { cls: 'acts' },
      button('Finances', () => panel.show({ kind: 'finances' })),
      button('Sauvegarder', () => { writeSave(game); toast('Partie sauvegardée', 'ok'); }),
      button('Exporter', () => {
        const a = el('a', { attrs: { href: URL.createObjectURL(new Blob([JSON.stringify(game.save())], { type: 'application/json' })), download: `boutique-city_${game.companyName.replace(/\W+/g, '-')}_jour${game.day + 1}.json` } });
        a.click();
      }),
      button('Menu', () => { writeSave(game); location.search = ''; }),
    ));
  const paint = (): void => {
    clock.textContent = formatClock(game.total);
    cash.textContent = chf(game.cash);
    cash.classList.toggle('neg', game.cash < 0);
    speedBtns.forEach((b, k) => b.classList.toggle('on', k === speed));
  };

  // Mes commerces (liste à gauche).
  const renderShops = (): void => {
    const list = $('shops');
    list.replaceChildren(el('div', { cls: 'sec', text: 'Mes commerces' }),
      ...(game.shops.length ? game.shops.map((s) => button(`${s.name} · ${s.today.customers} clients`, () => { panel.show({ kind: 'shop', shopId: s.id }); focusPremise(s.premiseId); }, 'shop-btn'))
        : [el('p', { cls: 'muted small', text: 'Cliquez sur un repère rond (local à louer) ou approchez-vous pour lire « À louer ».' })]));
  };

  // Sélection au clic, survol.
  scene.controls.toolSink = {
    capturesPrimary: () => false,
    hover: (sx, sy) => { const b = scene.view.pick(scene.ray(sx, sy)); scene.view.setHover(b?.id ?? null); canvas.style.cursor = b ? 'pointer' : ''; },
    down: () => undefined, move: () => undefined, cancel: () => undefined, secondary: () => panel.show(null),
    up: (sx, sy, _t, tap) => {
      if (!tap) return;
      const b = scene.view.pick(scene.ray(sx, sy));
      scene.view.setSelected(b?.id ?? null);
      if (!b) { panel.show(null); return; }
      panel.show(b.premise ? { kind: 'premise', premiseId: b.premise.id } : { kind: 'building', buildingId: b.id });
    },
  };
  debug.select = (premiseId) => { panel.show({ kind: 'premise', premiseId }); focusPremise(premiseId); };
  debug.advance = (min) => { game.advance(min); paint(); panel.refresh(); };

  syncPremises();
  paint();
  if (game.shops.length === 0) toast('Bienvenue ! Les repères ronds marquent les locaux à louer : cliquez sur l’immeuble. Le passage devant la vitrine fait les clients.', 'info');

  let acc = 0, last = performance.now(), shopsTick = 0;
  const loop = (now: number): void => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!editor.isOpen || speed > 0) {
      acc += SPEEDS[speed]! * dt;
      const n = Math.min(240, Math.floor(acc));
      if (n > 0) { acc -= n; game.advance(n); }
      if (acc > 240) acc = 0;
    }
    // Clients : quelques silhouettes par image au plus.
    const ev = game.events.splice(0);
    for (const e of ev.slice(0, 4)) { const p = game.premise(e.premiseId); if (p) scene.people.addClient(p.doorX, p.doorZ); }
    for (; noticeIdx < game.notices.length; noticeIdx++) { const n = game.notices[noticeIdx]!; toast(n.text, n.level === 'warn' ? 'warn' : n.level); }
    if (noticeIdx > game.notices.length) noticeIdx = game.notices.length;
    if (game.day !== lastDay) { lastDay = game.day; writeSave(game); }
    paint();
    panel.refresh();
    if ((shopsTick += dt) > 1) { shopsTick = 0; renderShops(); }
    scene.frame(dt);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  window.addEventListener('beforeunload', () => writeSave(game));
  debug.ready = true;
}

if (params.has('auto')) start(new Game(params.has('seed') ? Number(params.get('seed')) | 0 : 7, 'Test SA'));
else menu();
