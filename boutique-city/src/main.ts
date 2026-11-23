/**
 * Boutique City — point d'entrée : menu, partie, personnage à la troisième personne (rue et intérieurs), véhicule,
 * interactions (portes, caisse, lit, véhicules), mode aménagement en 3D, interface, sauvegarde automatique.
 * Adresse : ?seed=N, ?nouveau (ignore la sauvegarde), ?auto (partie de test immédiate), ?vitesse=0..3.
 * Aucune boîte de dialogue du navigateur ni téléchargement : la page marche dans un cadre protégé.
 */
import * as THREE from 'three';
import { assets, filesMatching } from './assets';
import { gallery } from './gallery';
import { CLEANING, CONFIG, FURNITURE_BY_ID, HOME_BY_ID, SERVICE_BY_ID, SHOP_TYPE_BY_ID, VEHICLE_BY_ID, productsOf } from './sim/catalog';
import { clockView, formatClock } from './sim/clock';
import { FACE_N, type Building } from './sim/district';
import { Game, dayProfit, type GameSave, type Result, type Shop, type Vehicle } from './sim/game';
import { canPlace, type Rot } from './sim/layout';
import { Controls } from './input/controls';
import { PRODUCT_COLORS } from './render/furniture3d';
import { InteriorAgents, moneyText } from './render/interior-agents';
import { InteriorView, type InteriorItem } from './render/interior-view';
import { Scene3D } from './render/scene';
import type { BuildingState } from './render/district-view';
import { VEHICLE_BODY, VEHICLE_REACH, bodyDistance, drive, forward, type DriveState, type Obstacles } from './world/vehicle';
import { Collider, type Rect } from './world/collide';
import { competitorView, homeView, premiseView, rescueView, serviceView, subletView, type UiCtx } from './ui/dialogs';
import { $, askConfirm, button, chf, el, icon, num, signed, type IconName } from './ui/dom';
import { BigMap, MiniMap, type Poi } from './ui/map';
import { Panel } from './ui/panel';
import { showBankruptcy, showRecap } from './ui/recap';
import { sound, type NotifyLevel } from './ui/sound';
import { ObjectiveCard, showVictory } from './ui/objectives-ui';
import { companyView, shopView, surfaceView } from './ui/shop-panel';
import { Phone } from './ui/phone';
import { warehouseView } from './ui/warehouse-panel';
import { warehouseAt, warehouseName } from './sim/logistics';
import { ECONOMY, HOME_MEAL, NEEDS } from './sim/catalog';
import { unloadInto } from './ui/dialogs';

const SAVE_KEY = 'boutique-city.save.v2';
/** Minutes de jeu par seconde réelle (0 = pause). */
const SPEEDS = [0, 1, 4, 15];
const SLEEP_SPEED = 90;
const WALK = 4.2, RUN = 7.2, IN_WALK = 2.6, IN_RUN = 4;
/** Taxi depuis la grande carte : course à prix fixe ; le trajet prend quelques minutes de jeu selon la distance. */
const TAXI_FARE = 15;
const taxiMinutes = (meters: number): number => Math.max(3, Math.round(3 + meters / 350));
/** Touches de déplacement (position physique) : elles ferment la grande carte au lieu d'être sans effet. */
const MOVE_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const params = new URLSearchParams(location.search);

interface Debug {
  game: Game | null; ready: boolean; errors: string[];
  [k: string]: unknown;
}
const debug: Debug = { game: null, ready: false, errors: [] };
(window as unknown as { __bc: Debug }).__bc = debug;
window.addEventListener('error', (e) => debug.errors.push(String(e.message)));
window.addEventListener('unhandledrejection', (e) => debug.errors.push(String(e.reason)));

function readSave(): GameSave | null {
  try { const t = localStorage.getItem(SAVE_KEY); return t ? JSON.parse(t) as GameSave : null; } catch { return null; }
}
/** Point de reprise : dernière sauvegarde hors zone de faillite (proposé sur l'écran de faillite). */
const RESCUE_KEY = 'boutique-city.save.v2.avant-difficultes';
function writeSave(g: Game): void {
  // Partie terminée par une faillite : rien n'est écrasé (dernière sauvegarde et point de reprise conservés).
  if (g.rescue.bankrupt) return;
  try {
    const t = JSON.stringify(g.save());
    localStorage.setItem(SAVE_KEY, t);
    if (g.rescue.redDays === 0) localStorage.setItem(RESCUE_KEY, t);
  } catch { /* stockage indisponible */ }
}

const TOAST_ICON: Record<'ok' | 'error' | 'info' | 'warn', IconName> = { ok: 'check', error: 'alert', warn: 'alert', info: 'info' };
/**
 * Notification courte (en haut au centre) : pictogramme et couleur selon le type, au plus 3 à la fois (la plus
 * ancienne part), un message identique au précédent encore affiché le rallonge avec un compteur « ×2 ».
 */
function toast(text: string, kind: 'ok' | 'error' | 'info' | 'warn' = 'info'): void {
  const box = $('toasts');
  const life = kind === 'error' ? 5500 : kind === 'warn' ? 4800 : 3800;
  const dismiss = (t: HTMLElement): void => { t.classList.add('out'); setTimeout(() => t.remove(), 250); };
  const arm = (t: HTMLElement): void => { clearTimeout(Number(t.dataset['timer'])); t.dataset['timer'] = String(setTimeout(() => dismiss(t), life)); };
  const same = [...box.children].find((c) => (c as HTMLElement).dataset['text'] === text && !c.classList.contains('out')) as HTMLElement | undefined;
  if (same) {
    const n = Number(same.dataset['n'] ?? '1') + 1;
    same.dataset['n'] = String(n);
    same.querySelector('.toast-n')!.textContent = `×${n}`;
    same.classList.remove('bump'); void same.offsetWidth; same.classList.add('bump');
    arm(same);
    return;
  }
  const t = el('div', { cls: `toast ${kind}`, attrs: { role: kind === 'error' ? 'alert' : 'status', 'data-text': text } },
    el('span', { cls: 'toast-ico' }, icon(TOAST_ICON[kind])), el('span', { cls: 'toast-txt', text }), el('i', { cls: 'toast-n' }));
  box.append(t);
  const live = [...box.children].filter((c) => !c.classList.contains('out'));
  for (const old of live.slice(0, Math.max(0, live.length - 3))) dismiss(old as HTMLElement);
  arm(t);
}

function menu(): void {
  const save = readSave();
  const name = el('input', { attrs: { type: 'text', maxlength: '30', value: 'Mon entreprise', 'aria-label': 'Nom de votre entreprise' } });
  const box = $('menu');
  const begin = (g: Game): void => start(g);
  const resume = save && !params.has('nouveau') ? save : null;
  const keys: [string, string][] = [['Z Q S D', 'marcher, conduire'], ['Maj', 'courir'], ['E', 'interagir, monter en véhicule'], ['T', 'téléphone'], ['M', 'carte'], ['B', 'aménager'], ['P', 'pause'], ['H', 'aide']];
  const steps = ['Louer un local', 'Aménager', 'Approvisionner', 'Embaucher'];
  box.replaceChildren(skyline('menu-sky'), el('div', { cls: 'menu-card' },
    el('div', { cls: 'menu-hero' },
      brandMark(),
      el('div', {}, el('h1', { text: 'Boutique City' }), el('p', { cls: 'tag', text: 'Partez de rien dans un quartier animé et bâtissez votre empire de commerces.' }))),
    resume ? el('div', { cls: 'menu-save' },
      el('div', { cls: 'menu-save-info' }, el('span', { cls: 'kicker', text: 'Partie en cours' }), el('b', { text: resume.companyName }),
        el('span', { cls: 'muted small', text: `Jour ${Math.floor(resume.total / 1440) + 1} · ${chf(resume.cash)} · ${resume.shops.length} commerce(s)` })),
      button(`Continuer : ${resume.companyName} (jour ${Math.floor(resume.total / 1440) + 1})`, () => begin(new Game(resume.seed, resume.companyName, resume)), 'primary wide')) : null,
    el('div', { cls: 'sec', text: 'Nouvelle partie' }),
    el('label', { cls: 'field' }, el('span', { text: 'Nom de l’entreprise' }), name),
    el('ol', { cls: 'menu-steps' }, ...steps.map((s, k) => el('li', {}, el('b', { text: String(k + 1) }), el('span', { text: s })))),
    button(`Nouvelle partie — ${chf(CONFIG.startCash)} en poche`, () => {
      // Nouvelle partie : la sauvegarde précédente est effacée.
      const go = (): void => { try { localStorage.removeItem(SAVE_KEY); } catch { /* stockage indisponible */ } begin(new Game(params.has('seed') ? Number(params.get('seed')) | 0 : (Math.random() * 1e9) | 0, name.value.trim() || 'Mon entreprise')); };
      if (resume) void askConfirm(`Effacer la partie sauvegardée (${resume.companyName}) et recommencer ?`, 'Nouvelle partie', true).then((y) => { if (y) go(); });
      else go();
    }, resume ? 'wide' : 'primary wide'),
    el('div', { cls: 'keys' },
      el('div', { cls: 'sec', text: 'Commandes' }),
      el('div', { cls: 'menu-keys' }, ...keys.map(([k, t]) => el('span', {}, el('kbd', { text: k }), t))),
      el('p', { cls: 'small', text: 'Souris : caméra · Échap : fermer.' })),
  ));
  box.classList.remove('hidden');
}

/** Enseigne du jeu : petite devanture à store rayé (SVG). */
function brandMark(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 64 64'); svg.setAttribute('class', 'brand-mark'); svg.setAttribute('aria-hidden', 'true');
  const add = (tag: string, a: Record<string, string>): void => { const e = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(a)) e.setAttribute(k, v); svg.append(e); };
  add('rect', { x: '8', y: '24', width: '48', height: '34', rx: '3', fill: '#1c2635', stroke: '#2a3647', 'stroke-width': '3' });
  for (let k = 0; k < 6; k++) add('path', { d: `M${6 + k * 9} 14h9v10a4.5 4.5 0 0 1-9 0z`, fill: k % 2 ? '#fff4d6' : '#ffcc4d' });
  add('rect', { x: '4', y: '9', width: '56', height: '6', rx: '2', fill: '#e0a92a' });
  add('rect', { x: '15', y: '36', width: '14', height: '22', rx: '1.5', fill: '#0f151e' });
  add('rect', { x: '34', y: '35', width: '15', height: '12', rx: '1.5', fill: '#5fc3ff', opacity: '.85' });
  add('circle', { cx: '26', cy: '48', r: '1.5', fill: '#ffcc4d' });
  return svg;
}

/** Silhouette de quartier (fenêtres allumées), décor du menu et du chargement. Déterministe. */
function skyline(cls: string): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg', W = 1600, H = 260;
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('preserveAspectRatio', 'xMidYMax slice');
  svg.setAttribute('class', `skyline ${cls}`); svg.setAttribute('aria-hidden', 'true');
  let seed = 11;
  const rnd = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const rect = (x: number, y: number, w: number, h: number, fill: string): void => {
    const r = document.createElementNS(ns, 'rect');
    r.setAttribute('x', String(x)); r.setAttribute('y', String(y)); r.setAttribute('width', String(w)); r.setAttribute('height', String(h)); r.setAttribute('fill', fill);
    svg.append(r);
  };
  // Deux rangs : immeubles du fond (plus clairs), puis devantures du premier plan.
  for (const [base, minH, maxH, col, win] of [[0, 90, 200, '#16263a', 0.10], [0, 50, 120, '#0e1824', 0.22]] as const) {
    for (let x = -10; x < W;) {
      const w = 60 + Math.floor(rnd() * 90), h = minH + Math.floor(rnd() * (maxH - minH));
      rect(x, H - h - base, w, h + base, col);
      for (let wy = H - h + 14; wy < H - 22; wy += 20) for (let wx = x + 10; wx < x + w - 14; wx += 18) if (rnd() < win) rect(wx, wy, 8, 10, rnd() < 0.7 ? '#ffcc4d' : '#5fc3ff');
      x += w + 4;
    }
  }
  rect(0, H - 8, W, 8, '#0a121b');
  return svg;
}

const LOADING_TIPS = [
  'Un prix proche de celui du quartier fait revenir les clients.',
  'Le réassort automatique évite les ruptures pendant la nuit.',
  'Ouvrez sur les heures d’affluence : les salaires se paient à l’heure.',
  'Le grossiste est moins cher que la livraison, si vous transportez vous-même.',
  'Une caisse de plus aux heures de pointe, c’est moins de clients lassés d’attendre.',
];

/** Habille l'écran de chargement (titre, silhouette, astuce) en gardant .bar-fill et .load-label. */
function loadingScreen(box: HTMLElement): void {
  const tip = LOADING_TIPS[Math.floor(Math.random() * LOADING_TIPS.length)]!;
  box.replaceChildren(skyline('load-sky'), el('div', { cls: 'load-card' },
    brandMark(),
    el('h1', { text: 'Boutique City' }),
    el('p', { cls: 'load-sub', text: 'Le quartier s’éveille…' }),
    el('div', { cls: 'bar-track' }, el('div', { cls: 'bar-fill' })),
    el('p', { cls: 'load-label', text: 'Chargement…' }),
    el('p', { cls: 'load-tip' }, el('b', { text: 'Astuce' }), tip)));
}

type Inside = { kind: 'shop'; shopId: number } | { kind: 'home'; homeId: number };

/** Fiche d'aide : raccourcis et boucle de jeu (touche H, et au premier lancement). */
function showHelp(): void {
  if (document.querySelector('.help-card')) return;
  // Groupes de touches : chaque entrée = touches (plusieurs = alternatives), description.
  const groups: [string, [string[], string][]][] = [
    ['Se déplacer', [
      [['ZQSD'], 'marcher, conduire (ou les flèches)'], [['Maj'], 'courir'], [['Espace'], 'freiner en véhicule'],
      [['V'], 'retrouver mon véhicule'], [['Souris'], 'glisser : caméra · molette : zoom']]],
    ['Agir', [
      [['E'], 'entrer, parler, monter / descendre d’un véhicule, tenir la caisse, dormir'], [['B'], 'aménager le commerce'], [['R'], 'tourner le meuble en main'],
      [['Clic droit'], 'annuler la pose d’un meuble']]],
    ['Interface', [
      [['T'], 'téléphone (gestion à distance)'], [['M'], `carte (clic = destination, taxi ${TAXI_FARE} CHF)`],
      [['P'], 'pause / reprise'], [['1–4'], 'vitesse du temps'], [['H'], 'cette aide'], [['Échap'], 'fermer, revenir, se réveiller']]],
  ];
  const steps = ['Louez un local (anneau jaune)', 'Achetez des meubles et aménagez (B)', 'Approvisionnez au grossiste', 'Tenez la caisse ou embauchez'];
  const close = (): void => wrap.remove();
  const wrap = el('div', { cls: 'confirm', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Aide' } },
    el('div', { cls: 'confirm-card help-card' },
      el('div', { cls: 'help-head' }, el('div', {}, el('div', { cls: 'kicker', text: 'Aide · touche H' }), el('h2', { text: 'Comment jouer' })), button('×', close, 'icon-x')),
      el('ol', { cls: 'help-steps' }, ...steps.map((t, k) => el('li', {}, el('b', { text: String(k + 1) }), el('span', { text: t })))),
      el('p', { cls: 'help-goal', text: 'Ensuite, développez votre empire : plusieurs commerces, sous-locations, publicité, véhicules. Suivez la carte d’objectifs en haut à gauche : trois objectifs à la fois, en quatre paliers, jusqu’à devenir la légende du quartier.' }),
      // Besoins du personnage : jauges du HUD, où manger, où dormir, ce qui arrive à zéro.
      el('div', { cls: 'sec', text: 'Faim et énergie' }),
      el('p', { cls: 'help-goal', text: `Deux jauges en haut à droite. La faim se vide en ${Math.round(100 / NEEDS.hungerPerMin / 60)} h, l’énergie en ${Math.round(100 / NEEDS.energyPerMin / 60)} h, et deux fois plus vite le ventre vide. Manger : au snack (café, sandwich, menu du jour) ou chez vous, « Manger (cuisine) » pour ${HOME_MEAL.price} CHF. Dormir : dans votre lit (touche E) ; un logement plus confortable repose plus vite. Alertes à ${NEEDS.tired} puis ${NEEDS.exhausted} d’énergie ; à zéro, vous vous effondrez (taxi ${ECONOMY.faintCost} CHF et longue nuit), sauf le premier jour où vous tenez debout, au ralenti.` }),
      // Conduite : on ne conduit que ses propres véhicules, achetés au garage.
      el('div', { cls: 'sec', text: 'Conduire' }),
      el('p', { cls: 'help-goal', text: 'Achetez un véhicule au garage (scooter, citadine, camionnette, camion…) : il vous attend devant, sous une balise bleue. Approchez-vous et appuyez sur E pour monter. Z / S (ou ↑ ↓) : avancer, freiner puis reculer ; Q / D (ou ← →) : tourner ; Espace : freiner ; E : descendre. V ou Téléphone › Véhicules : retrouver votre véhicule. Les voitures garées et la circulation du quartier ne sont pas à vous.' }),
      el('div', { cls: 'help-cols' }, ...groups.map(([title, keys]) => el('div', { cls: 'help-col' },
        el('div', { cls: 'sec', text: title }),
        el('div', { cls: 'help-grid' }, ...keys.flatMap(([ks, t]) => [el('span', { cls: 'help-keys' }, ...ks.map((k) => el('kbd', { text: k }))), el('span', { text: t })]))))),
      el('div', { cls: 'row end' }, button("C'est parti !", close, 'primary'))));
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape' || e.key === 'Enter') close(); });
  document.body.append(wrap);
  wrap.querySelector<HTMLButtonElement>('button.primary')?.focus();
}

/** Sol et murs de chaque type de commerce. */
const INTERIOR_STYLE: Record<Shop['type'], { floor: 'carrelage' | 'parquet'; wall: string }> = {
  epicerie: { floor: 'carrelage', wall: '#e6efe3' }, cafe: { floor: 'parquet', wall: '#efe2cf' }, vetements: { floor: 'parquet', wall: '#ece8f2' },
  fleuriste: { floor: 'parquet', wall: '#e9f2e4' }, boulangerie: { floor: 'parquet', wall: '#f6e6cc' }, fastfood: { floor: 'carrelage', wall: '#f6dcd5' },
  primeur: { floor: 'carrelage', wall: '#e2eed6' },
};

function start(game: Game): void {
  $('menu').classList.add('hidden');
  debug.game = game;
  const canvas = $<HTMLCanvasElement>('scene');
  const scene = new Scene3D(canvas, game.district);
  const controls = new Controls();
  const panel = new Panel(game);
  let speed = params.has('vitesse') ? Math.max(0, Math.min(3, Number(params.get('vitesse')) | 0)) : 1;
  let lastDay = game.day;
  /** Numéro (Notice.seq) de la dernière notification affichée en toast : l'historique est plafonné, les numéros non. */
  let toastSeq = game.lastNoticeSeq;
  let inside: Inside | null = null;
  let ipos = { x: 0, z: 0, heading: 0 };
  let car: (DriveState & { id: number }) | null = null;
  let walkSpeed = 0;
  let waypoint: { x: number; z: number; label: string } | null = null;
  const build = { on: false, tool: null as string | null, rot: 0 as Rot, cell: null as [number, number] | null };
  let agents: InteriorAgents | null = null;
  let layoutRev = -1;
  let snapCam = true;
  let feedbackT = 0;
  let recapDue = false;
  let recapOpen: HTMLElement | null = null;
  /** Écran de faillite (fin de partie) affiché. */
  let bankruptOpen: HTMLElement | null = null;

  const act = <T,>(r: Result<T>, okText?: string | ((d: T) => string)): boolean => {
    if (!r.ok) { toast(r.message, 'error'); return false; }
    // L'action a déjà son message (notification de la partie, en toast à l'image suivante) : pas de second toast.
    const own = game.notices.some((n) => n.seq > toastSeq && !n.sim);
    if (okText && !own) toast(typeof okText === 'function' ? okText(r.data) : okText, 'ok');
    panel.paint(true);
    return true;
  };
  const ctx: UiCtx = {
    game, panel, act, toast,
    enterShop: (id) => { panel.close(); enterShop(id); },
    openShop: (id) => panel.open(shopView(ctx, id)),
    waypoint: (x, z, label, quiet = false) => { waypoint = { x, z, label }; scene.setBeacon({ x, z }); if (!quiet) toast(`Destination : ${label} (balise bleue)`, 'info'); },
    leave: () => { if (!inside) game.setPlace({ kind: 'rue' }); },
  };
  const clearWaypoint = (): void => { waypoint = null; scene.setBeacon(null); };
  const minimap = new MiniMap(game, document.body);
  /**
   * Taxi jusqu'à la porte d'un lieu de la carte (Game.taxi) : prix fixe, quelques minutes de jeu de trajet ; déposé
   * sur le trottoir face à la porte, caméra dans le dos.
   */
  const takeTaxi = (p: Poi): void => {
    if (car) { toast('Garez d’abord votre véhicule (E pour descendre).', 'error'); return; }
    if (game.cash < TAXI_FARE) { toast(`Trésorerie insuffisante pour le taxi (${TAXI_FARE} CHF).`, 'error'); return; }
    const b = p.b, n = FACE_N[b.face]!;
    const minutes = taxiMinutes(Math.hypot(b.doorX - game.player.x, b.doorZ - game.player.z));
    if (inside) exitInterior();
    panel.close();
    const at = scene.collider.resolve(b.doorX + n[0] * 1.3, b.doorZ + n[1] * 1.3, 0.35);
    const heading = Math.atan2(n[0], n[1]);
    const r = game.taxi(at.x, at.z, heading, TAXI_FARE, minutes);
    if (!r.ok) { toast(r.message, 'error'); return; }
    scene.cam.yaw = heading;
    snapCam = true;
    sound.taxi();
    toast(`Taxi : vous voici devant ${p.label} (${TAXI_FARE} CHF, ${minutes} min de trajet).`, 'ok');
    if (waypoint && Math.hypot(waypoint.x - b.doorX, waypoint.z - b.doorZ) < 4) clearWaypoint();
  };
  const bigmap = new BigMap(game, (p) => ctx.waypoint(p.b.doorX, p.b.doorZ, p.label), {
    taxi: {
      fare: TAXI_FARE, minutes: taxiMinutes, go: takeTaxi,
      unavailable: () => (car ? 'Garez d’abord votre véhicule (E pour descendre).' : game.cash < TAXI_FARE ? `Trésorerie insuffisante (${TAXI_FARE} CHF).` : null),
    },
    clearDest: clearWaypoint,
  });

  /* ------------------------------ Rue : états des bâtiments ------------------------------ */

  let statesVersion = -1;
  const syncStreet = (): void => {
    if (game.version === statesVersion) return;
    statesVersion = game.version;
    const st: BuildingState[] = [];
    for (const b of game.district.buildings) {
      if (b.service) { const s = SERVICE_BY_ID.get(b.service)!; st.push({ buildingId: b.id, sign: s.sign, color: s.color, ring: s.color, pin: false, poster: null }); }
      else if (b.premise) {
        const sh = game.shopAt(b.premise.id);
        if (sh) st.push({ buildingId: b.id, sign: sh.name, color: SHOP_TYPE_BY_ID.get(sh.type)!.color, ring: '#5cc77a', pin: false, poster: null });
        else if (b.premise.warehouse) st.push({ buildingId: b.id, sign: warehouseAt(game, b.premise.id) ? warehouseName(game, b.premise.id) : null, color: '#8a7a5c', ring: '#d9a54a', pin: false, poster: warehouseAt(game, b.premise.id) ? null : 'ENTREPÔT À LOUER' });
        else if (b.premise.competitor) st.push({ buildingId: b.id, sign: b.premise.competitorName, color: mix(SHOP_TYPE_BY_ID.get(b.premise.competitor)!.color), ring: null, pin: false, poster: null });
        else if (game.subletOf('local', b.premise.id)) { const sl = game.subletOf('local', b.premise.id)!; st.push({ buildingId: b.id, sign: sl.tenant, color: '#6f86a8', ring: '#c39bff', pin: false, poster: sl.tenant ? null : 'À SOUS-LOUER' }); }
        else st.push({ buildingId: b.id, sign: null, color: '#9aa0a6', ring: '#ffd166', pin: true, poster: 'À LOUER' });
      } else if (b.home) {
        const mine = b.home.id === game.player.home;
        const sl = game.subletOf('logement', b.home.id);
        st.push({ buildingId: b.id, sign: null, color: '#9aa0a6', ring: mine ? '#ffffff' : sl ? '#c39bff' : '#9ec9ff', pin: false, poster: mine ? null : sl ? (sl.tenant ? null : 'À SOUS-LOUER') : 'APPART. À LOUER' });
      }
    }
    scene.view.setStates(st);
  };

  /* ------------------------------ Intérieurs ------------------------------ */

  const itemsOf = (s: Shop): InteriorItem[] => s.items.map((it) => {
    const def = FURNITURE_BY_ID.get(it.def)!;
    let fill = 0;
    const colors: string[] = [], products: string[] = [];
    if (def.capacity) {
      let stock = 0, cap = 0;
      for (const p of productsOf(s.type)) {
        if (p.store !== def.kind && !(def.kind === 'comptoir' && p.store === 'comptoir')) continue;
        stock += s.products[p.id]!.stock; cap += game.storageFor(s, p);
        if (s.products[p.id]!.stock > 0) { colors.push(PRODUCT_COLORS[p.id] ?? '#cccccc'); products.push(p.id); }
      }
      fill = cap > 0 ? stock / cap : 0;
    }
    return { ...it, fill, colors: colors.length ? colors : ['#cccccc'], products };
  });

  const enterShop = (shopId: number): void => {
    const s = game.shop(shopId)!, p = game.premise(s.premiseId)!, t = SHOP_TYPE_BY_ID.get(s.type)!;
    const b = game.building(p.buildingId)!;
    const view = new InteriorView({ gridW: p.gridW, gridD: p.gridD, floor: INTERIOR_STYLE[s.type].floor, wall: INTERIOR_STYLE[s.type].wall, accent: t.color, title: s.name, kind: s.type, facade: facadeColor(b), floorId: s.floorId, wallId: s.wallId });
    view.setDirt(game.cleanliness(s));
    agents = new InteriorAgents(view, t.color);
    view.setItems(itemsOf(s));
    agents.refreshLayout();
    layoutRev = game.layoutRev;
    scene.enterInterior(view, agents);
    inside = { kind: 'shop', shopId };
    const [ox, oz] = view.outside();
    ipos = { x: ox, z: oz - 2.4, heading: 0 };
    game.setPlace({ kind: 'commerce', shopId });
    sound.chime();
    snapCam = true;
    // Marchandise apportée : rangeable (bouton « Décharger »), ou pourquoi pas (place réservée, rayon plein, aucun meuble).
    const up = game.unloadPlan(shopId);
    if (up.carried > 0) toast(up.now + up.reducing > 0 ? `${up.carried} unités de marchandise à décharger : bouton « Décharger ».` : up.reason ?? '', 'info');
    renderInteriorBar();
  };

  const enterHome = (homeId: number): void => {
    const h = game.district.homes.find((x) => x.id === homeId)!, def = HOME_BY_ID.get(h.def)!;
    const view = new InteriorView({ gridW: def.gridW, gridD: def.gridD, floor: 'parquet', wall: '#e9e1d6', accent: '#2a7fd4', title: `Chez moi · ${def.nameFr}`, kind: 'logement', facade: facadeColor(game.building(h.buildingId)!) });
    view.setItems(homeItems(def.gridW, def.gridD));
    agents = null;
    scene.enterInterior(view, null);
    inside = { kind: 'home', homeId };
    const [ox, oz] = view.outside();
    ipos = { x: ox, z: oz - 2.4, heading: 0 };
    game.setPlace({ kind: 'logement', homeId });
    snapCam = true;
    renderInteriorBar();
  };

  const exitInterior = (): void => {
    if (!inside) return;
    setBuild(false);
    let b: Building | undefined;
    if (inside.kind === 'shop') b = game.building(game.premise(game.shop(inside.shopId)?.premiseId ?? -1)?.buildingId ?? -1);
    else b = game.building(game.district.homes.find((h) => h.id === (inside as { homeId: number }).homeId)!.buildingId);
    if (game.player.tending !== null) game.tend(null);
    scene.exitInterior();
    agents = null;
    inside = null;
    if (b) {
      // Caméra dans le dos du personnage, le long du trottoir (du côté de la destination s'il y en a une) : face à la
      // façade, « avancer » le pousserait dans la porte qu'il vient de franchir.
      const n = FACE_N[b.face]!, t = [n[1], -n[0]] as const;
      const side = waypoint && (waypoint.x - b.doorX) * t[0] + (waypoint.z - b.doorZ) * t[1] < 0 ? -1 : 1;
      const fx = side * t[0] - 0.3 * n[0], fz = side * t[1] - 0.3 * n[1];
      game.setPlayerPose(b.doorX + n[0] * 0.3, b.doorZ + n[1] * 0.3, Math.atan2(-fx, -fz));
      scene.cam.yaw = Math.atan2(-fx, -fz);
      scene.cam.pitch = Math.max(scene.cam.pitch, 0.4);
    }
    game.setPlace({ kind: 'rue' });
    snapCam = true;
    renderInteriorBar();
  };

  /* ------------------------------ Interactions ------------------------------ */

  interface Action { label: string; run: () => void }
  const nearestDoor = (x: number, z: number, max: number): Building | null => {
    let best: Building | null = null, bd = max;
    for (const b of game.district.buildings) {
      if (!b.premise && !b.service && !b.home) continue;
      const d = Math.hypot(b.doorX - x, b.doorZ - z);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  };
  const doorAction = (b: Building): Action => {
    if (b.service) { const s = SERVICE_BY_ID.get(b.service)!; return { label: `Entrer : ${s.sign}`, run: () => { panel.close(); game.setPlace({ kind: 'service', service: b.service!, buildingId: b.id }); panel.open(serviceView(ctx, b)); } }; }
    if (b.home) {
      const h = b.home;
      if (h.id === game.player.home) return { label: 'Rentrer chez moi', run: () => enterHome(h.id) };
      if (game.subletOf('logement', h.id)) return { label: 'Mon appartement en sous-location', run: () => panel.open(homeView(ctx, h)) };
      return { label: `Visiter : ${HOME_BY_ID.get(h.def)!.nameFr} à louer`, run: () => panel.open(homeView(ctx, h)) };
    }
    const p = b.premise!;
    const sh = game.shopAt(p.id);
    if (sh) return { label: `Entrer : ${sh.name}`, run: () => enterShop(sh.id) };
    if (p.warehouse) return { label: warehouseAt(game, p.id) ? `Entrer : ${warehouseName(game, p.id)}` : `Visiter l’entrepôt à louer (${p.area} m²)`, run: () => { panel.close(); game.setPlace({ kind: 'local', premiseId: p.id }); panel.open(warehouseView(ctx, p.id)); } };
    if (p.competitor) return { label: `Regarder : ${p.competitorName}`, run: () => panel.open(competitorView(ctx, p)) };
    const sl = game.subletOf('local', p.id);
    if (sl) return { label: `Mon local sous-loué${sl.tenant ? ` : ${sl.tenant}` : ' (à relouer)'}`, run: () => panel.open(subletView(ctx, sl.id)) };
    return { label: `Visiter le local à louer (${p.area} m²)`, run: () => { panel.close(); game.setPlace({ kind: 'local', premiseId: p.id }); panel.open(premiseView(ctx, p)); } };
  };

  const currentAction = (): Action | null => {
    if (game.player.sleeping) return null;
    if (inside) {
      const view = scene.interior!.view;
      const [dl, dr] = view.doorSpan();
      if (game.player.tending !== null) return { label: 'Lâcher la caisse', run: () => act(game.tend(null)) };
      if (ipos.z > view.D / 2 - 1.3 && ipos.x > dl - 0.4 && ipos.x < dr + 0.4) return { label: 'Sortir', run: exitInterior };
      if (inside.kind === 'shop' && agents) {
        const uid = agents.freeRegisterNear(ipos.x, ipos.z, 1.6);
        if (uid !== null) { const id = inside.shopId; return { label: 'Tenir la caisse', run: () => { if (act(game.tend(id), 'Vous tenez la caisse : les clients passent par vous.')) { agents!.playerRegister = uid; const sp = agents!.registerSpot(uid); if (sp) ipos = sp; } } }; }
      }
      if (inside.kind === 'home') {
        const bed = view.items.find((i) => i.def === 'lit');
        if (bed) { const [bx, bz] = view.cellCenter(bed.x + 1, bed.z + 1); if (Math.hypot(bx - ipos.x, bz - ipos.z) < 2.4) return { label: 'Dormir', run: () => act(game.sleep(), 'Bonne nuit…') }; }
      }
      return null;
    }
    if (car) return { label: 'Descendre du véhicule', run: leaveCar };
    const p = game.player;
    // Véhicule du joueur (distance à sa carrosserie) ou porte : le plus proche l'emporte. Un véhicule garé devant une
    // porte ne la masque plus, et une porte voisine ne prend pas la place du véhicule que l'on touche.
    const v = nearestVehicle(p.x, p.z);
    const b = nearestDoor(p.x, p.z, 2.6);
    if (v && v.d <= VEHICLE_REACH && (!b || v.d < Math.hypot(b.doorX - p.x, b.doorZ - p.z))) {
      const id = v.v.id;
      return { label: `Conduire : ${vehicleName(v.v)}`, run: () => enterCar(id) };
    }
    if (b) return doorAction(b);
    return notMineAction(p.x, p.z);
  };

  /* ------------------------------ Véhicules ------------------------------ */

  /** Véhicule du joueur le plus proche de (x, z), et distance à sa carrosserie. */
  const nearestVehicle = (x: number, z: number): { v: Vehicle; d: number } | null => {
    let best: { v: Vehicle; d: number } | null = null;
    for (const v of game.vehicles) { const d = bodyDistance(v, x, z); if (!best || d < best.d) best = { v, d }; }
    return best;
  };
  const vehicleName = (v: Vehicle): string => VEHICLE_BY_ID.get(v.type)!.nameFr;
  /** « Citadine » → « citadine » (les sigles restent : « SUV de luxe »). */
  const lowerName = (s: string): string => (/^.[a-zà-ÿ]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
  const garageB = game.district.buildings.find((b) => b.service === 'garage') ?? null;
  /**
   * Vitrine du garage : voitures de course et karts exposés sur le trottoir, de part et d'autre de la porte (mêmes
   * places que DistrictView.streetProps, jamais à moins de 2,6 m d'une porte). Décor : on ne les conduit pas.
   */
  const showcase: [number, number][] = [];
  if (garageB) {
    const n = FACE_N[garageB.face]!, t = [n[1], -n[0]] as const, depth = garageB.face % 2 === 0 ? garageB.d : garageB.w;
    const doors = game.district.buildings.filter((b) => b.premise || b.service || b.home);
    filesMatching(/^car-(race|kart)/).filter((k) => assets.has(k)).forEach((_, i) => {
      const side = (i % 2 ? 1 : -1) * (5.5 + Math.floor(i / 2) * 2.4);
      const x = garageB.x + n[0] * (depth / 2 + 1.6) + t[0] * side, z = garageB.z + n[1] * (depth / 2 + 1.6) + t[1] * side;
      if (doors.every((b) => Math.hypot(b.doorX - x, b.doorZ - z) >= 2.6)) showcase.push([x, z]);
    });
  }
  /** Destination : le garage, avec l'explication `why` (on n'y achète un véhicule qu'une fois sur place). */
  const routeToGarage = (why: string): void => {
    if (!garageB) return;
    ctx.waypoint(garageB.doorX, garageB.doorZ, SERVICE_BY_ID.get('garage')!.sign, true);
    toast(`${why} Itinéraire vers le garage (balise bleue) : le véhicule acheté vous attend devant, approchez-vous-en et appuyez sur E.`, 'info');
  };
  /** « Retrouver mon véhicule » (touche V, Téléphone › Véhicules, voiture qui n'est pas au joueur) : destination sur le plus proche. */
  const findMyVehicle = (): void => {
    if (car) { toast('Vous êtes au volant : E pour descendre.', 'info'); return; }
    const near = nearestVehicle(game.player.x, game.player.z);
    if (!near) { routeToGarage('Vous n’avez pas encore de véhicule.'); return; }
    const v = near.v, name = vehicleName(v);
    if (!inside && near.d <= VEHICLE_REACH) { toast(`Votre ${lowerName(name)} est juste là : appuyez sur E pour conduire.`, 'info'); return; }
    ctx.waypoint(v.x, v.z, name, true);
    toast(`Votre ${lowerName(name)} est à ${num(Math.hypot(v.x - game.player.x, v.z - game.player.z))} m (balise bleue${inside ? ', dehors' : ''}) : approchez-vous et appuyez sur E pour conduire.`, 'info');
  };
  /**
   * Près d'une voiture qui n'est pas au joueur (garée, de la circulation, exposée devant le garage) et tourné vers
   * elle (`anyAngle` : touche E pressée, quelle que soit l'orientation) : une invite explique au lieu de ne rien
   * faire. E ouvre le garage (vitrine), retrouve le véhicule du joueur, ou trace l'itinéraire vers le garage.
   */
  const notMineAction = (x: number, z: number, anyAngle = false): Action | null => {
    const [fx, fz] = forward(game.player.heading);
    const sees = (tx: number, tz: number, reach: number): boolean => {
      const d = Math.hypot(tx - x, tz - z);
      return d < reach && (anyAngle || d < 0.3 || ((tx - x) * fx + (tz - z) * fz) / d > 0.35);
    };
    if (garageB && showcase.some(([sx, sz]) => sees(sx, sz, 2.4))) return { label: 'Voitures d’exposition — voir les véhicules à vendre', run: () => doorAction(garageB).run() };
    const nearRect = (r: Rect): boolean => sees(Math.max(r.minX, Math.min(x, r.maxX)), Math.max(r.minZ, Math.min(z, r.maxZ)), 1.4);
    // Circulation : seulement une voiture arrêtée devant le personnage (pas celles qui passent), sauf touche E pressée.
    const tp = scene.traffic.nearestPoint(x, z, 1.8, !anyAngle);
    if (!scene.view.parkedRects.some(nearRect) && !(tp && sees(tp.x, tp.z, 1.8))) return null;
    if (game.vehicles.length) return { label: 'Pas à vous — retrouver votre véhicule', run: findMyVehicle };
    return { label: 'Pas à vous — achetez un véhicule au garage', run: () => routeToGarage('Cette voiture n’est pas à vous : on ne conduit que ses propres véhicules, achetés au garage.') };
  };

  /** Temps (s) pendant lequel la caméra vient vite se placer dans le dos du véhicule où l'on vient de monter. */
  let carCamT = 0;
  const enterCar = (id: number): void => {
    const v = game.vehicle(id)!;
    car = { id, x: v.x, z: v.z, heading: v.heading, speed: 0 };
    game.setDriving(id);
    scene.player.group.visible = false;
    Object.assign(scene.cam, { dist: VEHICLE_BODY[v.type].cam, pitch: 0.3 });
    carCamT = 1;
    if (waypoint && Math.hypot(waypoint.x - v.x, waypoint.z - v.z) < 4) clearWaypoint();
  };
  /**
   * Obstacles du véhicule conduit : la rue, plus les autres véhicules du joueur (boîte englobant leur carrosserie) ;
   * on ne les traverse plus et ils ne finissent plus garés l'un dans l'autre.
   */
  const driveObstacles = (selfId: number): Obstacles => {
    const rects: Rect[] = game.vehicles.filter((o) => o.id !== selfId).map((o) => {
      const b = VEHICLE_BODY[o.type], [fx, fz] = forward(o.heading);
      const hx = Math.abs(fx) * b.l / 2 + Math.abs(fz) * b.w / 2, hz = Math.abs(fz) * b.l / 2 + Math.abs(fx) * b.w / 2;
      return { minX: o.x - hx, maxX: o.x + hx, minZ: o.z - hz, maxZ: o.z + hz, h: 2 };
    });
    if (!rects.length) return scene.collider;
    const mine = new Collider(rects, scene.collider.bounds);
    return { resolve: (x, z, r) => { const a = scene.collider.resolve(x, z, r), b = mine.resolve(a.x, a.z, r), c = scene.collider.resolve(b.x, b.z, r); return { x: c.x, z: c.z, hit: a.hit || b.hit || c.hit }; } };
  };
  /** Point de descente : à droite du véhicule, sinon à gauche, derrière ou devant (le premier qui est dégagé). */
  const exitPoint = (v: { type: Vehicle['type']; x: number; z: number; heading: number }): { x: number; z: number } => {
    const b = VEHICLE_BODY[v.type], [fx, fz] = forward(v.heading), s = b.w / 2 + 0.6, l = b.l / 2 + 0.6;
    let first: { x: number; z: number } | null = null;
    for (const [ox, oz] of [[-fz * s, fx * s], [fz * s, -fx * s], [-fx * l, -fz * l], [fx * l, fz * l]] as const) {
      const r = scene.collider.resolve(v.x + ox, v.z + oz, 0.35);
      first ??= r;
      if (!r.hit) return r;
    }
    return first!;
  };
  const leaveCar = (): void => {
    if (!car) return;
    const v = game.vehicle(car.id);
    game.setVehiclePose(car.id, car.x, car.z, car.heading);
    const at = exitPoint({ type: v?.type ?? 'citadine', x: car.x, z: car.z, heading: car.heading });
    game.setPlayerPose(at.x, at.z, car.heading);
    car = null;
    game.setDriving(null);
    scene.player.group.visible = true;
    scene.cam.dist = 14; scene.cam.pitch = 0.3;
  };

  // E sans action proposée, mais à côté d'une voiture qui n'est pas au joueur : l'explication quand même.
  const interact = (): void => { const a = currentAction() ?? (car || inside ? null : notMineAction(game.player.x, game.player.z, true)); if (a) a.run(); };
  // Invite d'action : touche E (cliquable) et libellé ; le DOM n'est réécrit que si le libellé change.
  const promptLabel = el('span');
  const prompt = el('button', { cls: 'prompt hidden', attrs: { type: 'button' }, on: { click: () => interact() } }, el('kbd', { text: 'E' }), promptLabel);
  document.body.append(prompt);

  /* ------------------------------ Aménagement ------------------------------ */

  const buildBar = el('div', { cls: 'buildbar hidden' });
  document.body.append(buildBar);
  const setBuild = (on: boolean): void => {
    if (on && !(inside?.kind === 'shop')) return;
    if (on && game.player.tending !== null) game.tend(null);
    build.on = on; build.tool = null; build.cell = null;
    scene.cam.leftRotates = !on;
    scene.interior?.view.setBuildMode(on);
    if (on && scene.interior) { scene.cam.pitch = 1.15; scene.cam.yaw = 0; scene.cam.dist = Math.max(scene.interior.view.W, scene.interior.view.D) * 1.35 + 3; } else if (scene.interior) scene.cam.pitch = 0.95;
    buildBar.classList.toggle('hidden', !on);
    renderBuildBar();
    renderInteriorBar();
  };
  let buildSig = '';
  const renderBuildBar = (): void => {
    if (!build.on || inside?.kind !== 'shop') { buildSig = ''; return; }
    const s = game.shop(inside.shopId)!;
    const entries = Object.entries(s.storage);
    const sig = `${build.tool}|${JSON.stringify(entries)}`;
    if (sig === buildSig) return;
    buildSig = sig;
    buildBar.replaceChildren(
      el('div', { cls: 'bb-head' }, el('b', { text: 'Aménagement' }), el('span', { cls: 'muted small', text: build.tool ? `Pose : ${FURNITURE_BY_ID.get(build.tool)!.nameFr} — clic pour poser, R pour tourner, clic droit pour annuler` : 'Choisissez un meuble de la réserve, ou cliquez un meuble posé pour le déplacer.' }),
        button('Sol et murs', () => panel.open(surfaceView(ctx, s.id)), 'small'), button('Terminer (B)', () => setBuild(false), 'small primary')),
      el('div', { cls: 'bb-items' },
        ...(entries.length ? entries.map(([id, n]) => {
          const f = FURNITURE_BY_ID.get(id)!;
          return el('div', { cls: `bb-item${build.tool === id ? ' on' : ''}` },
            button(`${f.nameFr} ×${n}`, () => { build.tool = build.tool === id ? null : id; renderBuildBar(); }, 'bb-pick'),
            button('Vendre', () => { act(game.sellStored(s.id, id), (r) => `Revendu ${chf(r)}.`); if (!s.storage[id]) build.tool = null; renderBuildBar(); }, 'small'));
        }) : [el('p', { cls: 'muted small', text: 'Réserve vide : achetez des meubles au magasin de meubles (ils sont livrés ici).' })])),
      el('p', { cls: 'muted small', text: 'Clic sur un meuble posé : le reprendre pour le déplacer (il revient dans la réserve). Chaque meuble doit rester accessible depuis l’entrée.' }),
    );
  };
  const hoverBuild = (sx: number, sy: number): void => {
    if (!build.on || !scene.interior) return;
    const view = scene.interior.view;
    const p = scene.groundAt(sx, sy);
    if (!p) return;
    const [cx, cz] = view.cellAt(p.x, p.z);
    build.cell = [cx, cz];
    if (build.tool) {
      const f = FURNITURE_BY_ID.get(build.tool)!;
      const w = build.rot % 2 ? f.d : f.w, d = build.rot % 2 ? f.w : f.d;
      const x = cx - Math.floor((w - 1) / 2), z = cz - Math.floor((d - 1) / 2);
      const s = game.shop((inside as { shopId: number }).shopId)!;
      const prem = game.premise(s.premiseId)!;
      const okp = canPlaceUi(s, prem.gridW, prem.gridD, build.tool, x, z, build.rot);
      view.setGhost({ def: build.tool, x, z, rot: build.rot, ok: okp === null });
      view.setHighlight(null);
    } else {
      view.setGhost(null);
      view.setHighlight(view.itemAtCell(cx, cz)?.uid ?? null);
    }
  };
  const tapBuild = (sx: number, sy: number, btn: number): void => {
    if (!build.on || !scene.interior || inside?.kind !== 'shop') return;
    if (btn === 2) { build.tool = null; scene.interior.view.setGhost(null); renderBuildBar(); return; }
    hoverBuild(sx, sy);
    if (!build.cell) return;
    const view = scene.interior.view, id = inside.shopId;
    if (build.tool) {
      const f = FURNITURE_BY_ID.get(build.tool)!;
      const w = build.rot % 2 ? f.d : f.w, d = build.rot % 2 ? f.w : f.d;
      const x = build.cell[0] - Math.floor((w - 1) / 2), z = build.cell[1] - Math.floor((d - 1) / 2);
      if (act(game.place(id, build.tool, x, z, build.rot))) { if (!game.shop(id)!.storage[build.tool]) build.tool = null; refreshInterior(true); }
    } else {
      const it = view.itemAtCell(build.cell[0], build.cell[1]);
      if (it && act(game.pickUp(id, it.uid))) { build.tool = it.def; build.rot = it.rot; refreshInterior(true); }
    }
    renderBuildBar();
    hoverBuild(sx, sy);
  };
  scene.cam.onHover = hoverBuild;
  scene.cam.onTap = tapBuild;

  /* ------------------------------ Interface ------------------------------ */

  const hud = $('hud');
  const clock = el('b', { cls: 'clock' });
  const dayLabel = el('span', { cls: 'day' });
  const cash = el('b', { cls: 'cash' });
  const delta = el('span', { cls: 'delta' });
  // Porte-monnaie : trésorerie (compteur qui défile), ventes du jour, montants « +2,90 CHF » qui s'en échappent.
  const walletPops = el('div', { cls: 'wallet-pops', attrs: { 'aria-hidden': 'true' } });
  const wallet = el('div', { cls: 'wallet' }, cash, delta, walletPops);
  const energy = el('i'), hunger = el('i');
  const energyVal = el('b'), hungerVal = el('b');
  const weatherBox = el('span', { cls: 'weather' });
  const carryNum = el('b');
  const carry = el('span', { cls: 'carry hidden', attrs: { title: 'Marchandise portée' } }, icon('box'), carryNum);
  // Vitesse : pause, puis 1 à 3 chevrons (touches 1 à 4).
  const speedBtns = [0, 1, 2, 3].map((k) => {
    const b = button('', () => { speed = k; paint(); }, 'spd');
    if (k === 0) b.append(icon('pause'));
    else for (let i = 0; i < k; i++) b.append(icon('play'));
    const l = ['Pause', 'Vitesse normale', 'Rapide', 'Très rapide'][k]!;
    b.setAttribute('aria-label', l); b.title = `${l} (${k + 1})`;
    return b;
  });
  let shownWeatherHud = '';
  // Téléphone (applis) : gestion à distance, immobilier, banque, marché, messages…
  const phone = new Phone(ctx, {
    openMap: () => bigmap.toggle(game.player.x, game.player.z, game.player.heading, waypoint),
    openCompany: () => panel.open(companyView(ctx)),
    save: () => { writeSave(game); toast('Partie sauvegardée', 'ok'); },
    toggleSound: () => sound.toggle(),
    muted: () => sound.muted,
    quality: () => qualityPref,
    setQuality: (q) => { qualityPref = q; try { localStorage.setItem('bc-qualite', q); } catch { /* stockage indisponible */ } applyQuality(); },
    qualityNow: () => ['Basse', 'Moyenne', 'Haute', 'Ultra'][scene.quality] ?? '',
    onToggle: (open) => {
      // Pause pendant que le téléphone est ouvert, reprise à la vitesse d'avant.
      if (open) { speedBeforePhone = speed; speed = 0; } else if (speed === 0) speed = speedBeforePhone || 1;
      paint();
    },
    // « Voir sur la carte » : destination posée (balise, flèche à l'écran) et grande carte ouverte dessus. La caméra
    // reste sur le personnage ; une touche de déplacement ferme la carte et le fait marcher aussitôt.
    showOnMap: (x, z, label) => {
      ctx.waypoint(x, z, label);
      bigmap.open(game.player.x, game.player.z, game.player.heading, waypoint);
    },
  });
  let speedBeforePhone = 1;
  const phoneBadge = el('i', { cls: 'badge hidden' });
  const phoneBtn = el('button', { cls: 'round phone-btn', attrs: { type: 'button', 'aria-label': 'Téléphone (T)', title: 'Téléphone (T)' }, on: { click: () => phone.toggle() } }, icon('phone'), el('kbd', { text: 'T' }), phoneBadge);
  const mapBtn = el('button', { cls: 'round map-btn', attrs: { type: 'button', 'aria-label': 'Carte (M)', title: 'Carte (M)' }, on: { click: () => bigmap.toggle(game.player.x, game.player.z, game.player.heading, waypoint) } }, icon('map'), el('kbd', { text: 'M' }));
  const need = (cls: string, title: string, ic: IconName, bar: HTMLElement, val: HTMLElement): HTMLElement =>
    el('div', { cls: `need ${cls}`, attrs: { title } }, icon(ic), el('div', { cls: 'track' }, bar), val);
  hud.replaceChildren(
    el('div', { cls: 'hud-left' },
      el('div', { cls: 'when' }, clock, el('div', { cls: 'when-sub' }, dayLabel, weatherBox)),
      el('div', { cls: 'speeds', attrs: { role: 'group', 'aria-label': 'Vitesse du temps' } }, ...speedBtns)),
    el('div', { cls: 'hud-right' },
      el('div', { cls: 'needs' }, need('e', 'Énergie : dormez chez vous ou buvez un café au snack', 'bolt', energy, energyVal), need('h', 'Faim : mangez au snack ou chez vous (cuisine)', 'food', hunger, hungerVal)),
      carry,
      wallet,
      phoneBtn,
      mapBtn));
  // Objectifs : carte des trois objectifs actifs (en haut à gauche), bannière de palier franchi, écran de victoire.
  let victoryDue = false;
  let victoryOpen: HTMLElement | null = null;
  const objectives = new ObjectiveCard(game, { onTier: () => sound.fanfare(), onVictory: () => { victoryDue = true; } });
  const renderObjective = (): void => objectives.render();
  const paint = (): void => {
    const c = clockView(game.total);
    clock.textContent = `${String(c.hour).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}`;
    dayLabel.textContent = formatClock(game.total).split('·').slice(0, 2).join('·').trim();
    if (game.weather !== shownWeatherHud) {
      shownWeatherHud = game.weather;
      const [wi, wl] = ({ soleil: ['sun', 'Soleil'], nuages: ['cloud', 'Nuageux'], pluie: ['rain', 'Pluie'] } as Record<string, [IconName, string]>)[game.weather] ?? ['sun', 'Soleil'];
      weatherBox.replaceChildren(icon(wi), el('span', { text: wl }));
      weatherBox.className = `weather ${game.weather}`;
    }
    cash.textContent = chf(shownCash);
    cash.classList.toggle('neg', game.cash < 0);
    delta.textContent = `Ventes du jour : ${chf(game.today.revenue)}`;
    const tip = `Trésorerie : ${chf(game.cash)} · résultat du jour : ${signed(dayProfit(game.today))}`;
    if (wallet.title !== tip) wallet.title = tip;
    wallet.classList.toggle('neg', game.cash < 0);
    energy.style.width = `${game.player.energy}%`;
    hunger.style.width = `${game.player.hunger}%`;
    energyVal.textContent = String(Math.round(game.player.energy));
    hungerVal.textContent = String(Math.round(game.player.hunger));
    energy.classList.toggle('low', game.player.energy < 15);
    hunger.classList.toggle('low', game.player.hunger < 15);
    const n = Object.values(game.player.carry).reduce((a, b) => a + b, 0);
    carryNum.textContent = String(n);
    carry.classList.toggle('hidden', n === 0);
    speedBtns.forEach((b, k) => b.classList.toggle('on', k === speed));
    const u = phone.unread;
    phoneBadge.textContent = String(Math.min(99, u));
    phoneBadge.classList.toggle('hidden', u === 0 || phone.isOpen);
  };

  /*
   * Argent visible : la trésorerie affichée rattrape la vraie en défilant (≈ 0,5 s), le porte-monnaie pulse en doré à
   * chaque vente (rouge pour une grosse dépense) et laisse s'échapper le montant (« +2,90 CHF », ventes cumulées par
   * tranches de 0,35 s). Palier de ventes du jour franchi (tous les 100 CHF ; 500 puis 1 000 CHF pour les grosses
   * journées, pour ne pas en jouer un par seconde) : « ka-ching » et bandeau doré.
   */
  let shownCash = game.cash, lastCash = game.cash;
  let seenRevenue = game.today.revenue, seenDay = game.day, popAcc = 0, popT = 0, pulseAt = 0, kachingAt = 0;
  const palier = (r: number): { k: number; at: number } => {
    if (r < 2000) return { k: Math.floor(r / 100), at: Math.floor(r / 100) * 100 };
    if (r < 10000) { const k = Math.floor((r - 2000) / 500); return { k: 20 + k, at: 2000 + k * 500 }; }
    const k = Math.floor((r - 10000) / 1000);
    return { k: 36 + k, at: 10000 + k * 1000 };
  };
  let lastPalier = palier(seenRevenue).k;
  const pulse = (kind: 'gain' | 'spend' | 'palier'): void => {
    const now = performance.now();
    if (kind !== 'palier' && now - pulseAt < 300) return;
    pulseAt = now;
    wallet.classList.remove('gain', 'spend', 'palier');
    void wallet.offsetWidth;
    wallet.classList.add(kind);
  };
  const walletPop = (text: string, cls = ''): void => {
    const p = el('span', { cls: `wpop ${cls}`.trim(), text });
    walletPops.append(p);
    while (walletPops.children.length > 4) walletPops.firstElementChild!.remove();
    setTimeout(() => p.remove(), cls ? 2600 : 1300);
  };
  const walletStep = (dt: number): void => {
    if (game.day !== seenDay) { seenDay = game.day; seenRevenue = game.today.revenue; lastPalier = palier(seenRevenue).k; popAcc = 0; }
    const rev = game.today.revenue;
    if (rev > seenRevenue + 1e-6) {
      popAcc += rev - seenRevenue;
      seenRevenue = rev;
      pulse('gain');
      const p = palier(rev);
      if (p.k > lastPalier) {
        lastPalier = p.k;
        const now = performance.now();
        if (now - kachingAt > 1200) { kachingAt = now; sound.kaching(); }
        pulse('palier');
        walletPop(`${chf(p.at)} de ventes aujourd’hui !`, 'big');
      }
    } else if (rev < seenRevenue) seenRevenue = rev;
    if (popAcc > 0 && (popT += dt) >= 0.35) { walletPop(moneyText(popAcc)); popAcc = 0; popT = 0; }
    // Compteur : rattrapage exponentiel, plus un pas minimal pour finir net.
    const target = game.cash, diff = target - shownCash;
    if (target < lastCash - 20) pulse('spend');
    lastCash = target;
    shownCash = Math.abs(diff) < 0.5 ? target : shownCash + diff * (1 - Math.exp(-dt * 9)) + Math.sign(diff) * Math.min(Math.abs(diff), dt * 4);
  };

  /*
   * Sons des notifications : un par seconde au plus ; celles arrivées entre-temps sont regroupées et la plus grave
   * donne le son (objectif atteint, erreur, avertissement, ok, info : sons distincts, voir sound.notify).
   */
  type NoteLevel = NotifyLevel | 'success';
  const NOTE_RANK: Record<NoteLevel, number> = { info: 0, ok: 1, warn: 2, error: 3, success: 4 };
  let notePending: NoteLevel | null = null, noteAt = -Infinity;
  const noteSound = (l: NoteLevel): void => { if (!notePending || NOTE_RANK[l] > NOTE_RANK[notePending]) notePending = l; };
  const noteSoundStep = (): void => {
    if (!notePending || performance.now() - noteAt < 1000) return;
    noteAt = performance.now();
    if (notePending === 'success') sound.success(); else sound.notify(notePending);
    notePending = null;
  };

  // Qualité graphique : auto (départ selon la carte graphique, puis selon les images par seconde), basse, moyenne,
  // haute ou ultra (Scene3D.setQuality : 0 à 3).
  let shownWeather = '';
  let qualityPref = 'auto';
  try { qualityPref = localStorage.getItem('bc-qualite') ?? 'auto'; } catch { /* stockage indisponible */ }
  const QUALITY_LEVEL: Record<string, number> = { basse: 0, moyenne: 1, haute: 2, ultra: 3 };
  let fpsAcc = 0, fpsFrames = 0, fpsHigh = 0, fpsGrace = 5;
  /** Plafond du mode automatique après une baisse (pas de va-et-vient), levé au bout d'une minute (puis 2, 4…). */
  let autoCeiling = 3, ceilingUntil = 0, autoDrops = 0;
  const applyQuality = (): void => { scene.setQuality(QUALITY_LEVEL[qualityPref] ?? scene.quality); fpsAcc = fpsFrames = fpsHigh = 0; fpsGrace = 2; };
  applyQuality();
  /**
   * Qualité automatique : baisse sous 38 images/s (moyenne sur 3 s), remonte après 12 s au-dessus de 57 jusqu'au
   * plafond ; quelques secondes ignorées après chaque changement (compilation des shaders).
   */
  const adaptQuality = (dt: number): void => {
    if (qualityPref !== 'auto' || document.hidden) return;
    if ((fpsGrace -= dt) > 0) return;
    fpsAcc += dt; fpsFrames++;
    if (fpsAcc < 3) return;
    const fps = fpsFrames / fpsAcc;
    fpsAcc = 0; fpsFrames = 0;
    const now = performance.now();
    if (autoCeiling < 3 && now > ceilingUntil) autoCeiling = 3;
    if (fps < 38 && scene.quality > 0) {
      autoCeiling = scene.quality - 1; ceilingUntil = now + 60000 * 2 ** Math.min(4, autoDrops++);
      scene.setQuality(scene.quality - 1); fpsHigh = 0; fpsGrace = 2;
    } else if (fps > 57 && scene.quality < autoCeiling) { if ((fpsHigh += 3) >= 12) { scene.setQuality(scene.quality + 1); fpsHigh = 0; fpsGrace = 2; } }
    else fpsHigh = 0;
    debug['fps'] = Math.round(fps);
    debug['calls'] = scene.renderer.info.render.calls;
    debug['triangles'] = scene.renderer.info.render.triangles;
  };

  const ibar = el('div', { cls: 'ibar hidden' });
  document.body.append(ibar);
  let ibarSig = '';
  const renderInteriorBar = (): void => {
    if (!inside) { ibar.classList.add('hidden'); ibarSig = ''; return; }
    ibar.classList.remove('hidden');
    if (inside.kind === 'home') {
      // Cuisine du logement : repas maison bon marché (mis en avant quand on a faim).
      const kitchen = inside.homeId === game.player.home && game.hasKitchen(), hungry = game.player.hunger < 50;
      const hsig = `home|${kitchen}|${hungry}`;
      if (ibarSig === hsig) return;
      ibarSig = hsig;
      ibar.replaceChildren(
        el('div', { cls: 'ib-id' }, el('span', { cls: 'ib-sign home' }, icon('home')), el('div', {}, el('b', { text: 'Chez moi' }), el('div', { cls: 'ib-sub', text: kitchen ? `Lit : E pour dormir. Cuisine : repas maison (${HOME_MEAL.price} CHF, ${HOME_MEAL.minutes} min).` : 'Approchez-vous du lit et appuyez sur E pour dormir.' }))),
        el('div', { cls: 'ib-actions' },
          kitchen ? ibtn(`Manger (cuisine) · ${HOME_MEAL.price} CHF`, () => { act(game.cook(), `Repas maison : faim +${HOME_MEAL.hunger}.`); ibarSig = ''; renderInteriorBar(); }, hungry ? 'primary' : '') : null,
          ibtn('Sortir', exitInterior, '', 'Échap')));
      return;
    }
    const s = game.shop(inside.shopId);
    if (!s) { exitInterior(); return; }
    const c = clockView(game.total);
    const open = c.hour >= s.open && c.hour < s.close;
    // Marchandise apportée (portée, véhicules garés devant) et ce qui est rangeable : le bouton n'est mis en avant que si
    // quelque chose peut aller en rayon ; sinon, son infobulle dit pourquoi (place réservée, rayon plein, aucun meuble).
    const up = game.unloadPlan(s.id), n = up.carried, storable = up.now + up.reducing;
    const id = s.id;
    // Alerte sur la propreté réelle (49,7 % s'affiche « 50 % » mais reste sous le seuil).
    const clean = Math.round(game.cleanliness(s)), dirty = game.cleanliness(s) < CLEANING.warn;
    const sig = `${id}|${open}|${s.today.customers}|${Math.round(s.today.revenue)}|${n}|${storable}|${build.on}|${clean}|${dirty}`;
    if (sig === ibarSig) return;
    ibarSig = sig;
    const t = SHOP_TYPE_BY_ID.get(s.type)!;
    ibar.replaceChildren(
      el('div', { cls: 'ib-id', attrs: { style: `--shop:${t.color}` } },
        el('span', { cls: 'ib-sign', text: s.name.charAt(0).toUpperCase() }),
        el('div', {}, el('div', { cls: 'ib-title' }, el('b', { text: s.name }), el('span', { cls: `tag-badge ${open ? 'ok' : 'muted'}`, text: open ? 'Ouvert' : 'Fermé' })),
          el('div', { cls: 'ib-sub', text: `${t.nameFr} · ${s.open} h – ${s.close} h` }))),
      el('div', { cls: 'ib-stats' },
        el('div', {}, el('span', { text: 'Clients' }), el('b', { text: String(s.today.customers) })),
        el('div', {}, el('span', { text: 'Ventes' }), el('b', { text: chf(s.today.revenue) }))),
      el('div', { cls: 'ib-actions' },
        n > 0 ? Object.assign(ibtn(`Décharger (${n})`, () => unloadInto(ctx, id, () => { refreshInterior(true); renderInteriorBar(); }), storable > 0 ? 'primary' : ''), { title: storable > 0 ? '' : up.reason ?? '' }) : null,
        ibtn(build.on ? 'Terminer' : 'Aménager', () => setBuild(!build.on), build.on ? 'primary' : '', 'B'),
        ibtn(`Nettoyer (${clean} %)`, () => { act(game.cleanShop(id), (v) => `Magasin nettoyé : propreté ${v} %.`); refreshInterior(true); renderInteriorBar(); }, dirty ? 'warn' : ''),
        ibtn('Gestion', () => ctx.openShop(id)),
        ibtn('Sortir', exitInterior)));
  };
  /** Bouton de la barre d'intérieur, avec sa touche éventuelle. */
  function ibtn(text: string, run: () => void, cls = '', key?: string): HTMLButtonElement {
    const b = button(text, run, cls);
    if (key) b.append(el('kbd', { text: key }));
    return b;
  }

  /*
   * Barre de conduite (au volant, en bas à gauche, styles de la barre d'intérieur) : véhicule, commandes, vitesse,
   * chargement, « Descendre » (E). Le DOM n'est réécrit que si un chiffre change.
   */
  const driveSign = el('span', { cls: 'ib-sign' }, icon('truck'));
  const driveName = el('b'), driveSpeed = el('b'), driveLoad = el('b');
  const driveBar = el('div', { cls: 'ibar drivebar hidden', attrs: { role: 'status', 'aria-label': 'Conduite' } },
    el('div', { cls: 'ib-id' }, driveSign, el('div', {}, el('div', { cls: 'ib-title' }, driveName),
      el('div', { cls: 'ib-sub', text: 'Z / S : avancer, reculer · Q / D : tourner · Espace : freiner' }))),
    el('div', { cls: 'ib-stats' }, el('div', {}, el('span', { text: 'Vitesse' }), driveSpeed), el('div', {}, el('span', { text: 'Chargement' }), driveLoad)),
    el('div', { cls: 'ib-actions' }, ibtn('Descendre', () => leaveCar(), '', 'E')));
  document.body.append(driveBar);
  let driveSig = '';
  const renderDriveBar = (): void => {
    const v = car && !inside ? game.vehicle(car.id) : undefined;
    driveBar.classList.toggle('hidden', !v);
    if (!v || !car) { driveSig = ''; return; }
    const def = VEHICLE_BY_ID.get(v.type)!, load = Object.values(v.cargo).reduce((a, b) => a + b, 0), kmh = Math.round(Math.abs(car.speed) * 3.6);
    const sig = `${v.id}|${kmh}|${load}`;
    if (sig === driveSig) return;
    driveSig = sig;
    driveName.textContent = def.nameFr;
    driveSign.style.setProperty('--shop', def.color);
    driveSpeed.textContent = `${kmh} km/h`;
    driveLoad.textContent = `${num(load)} / ${num(def.cargo)}`;
  };

  const sleepCover = el('div', { cls: 'sleep hidden' }, el('div', { cls: 'sleep-z', text: 'Zzz…' }), el('p', {}, 'Vous dormez, le temps file. ', el('kbd', { text: 'Échap' }), ' pour vous réveiller.'));
  document.body.append(sleepCover);

  /*
   * Destination à l'écran (dans la rue) : étiquette au-dessus de la balise quand elle est dans le champ (nom,
   * distance), sinon flèche au bord de l'écran qui pointe vers elle ; « × » efface la destination.
   */
  const destArrow = el('i', { cls: 'dp-arrow' });
  const destText = el('span', { cls: 'dp-text' });
  const destBox = el('div', { cls: 'dest-pointer hidden' }, destArrow, destText, button('×', () => clearWaypoint(), 'dp-x'));
  destBox.querySelector('.dp-x')?.setAttribute('aria-label', 'Effacer la destination');
  document.body.append(destBox);
  const destV = new THREE.Vector3();
  const destPointer = (): void => {
    const show = !!waypoint && !inside && !bigmap.isOpen && !recapOpen && !game.player.sleeping && !phone.isOpen;
    destBox.classList.toggle('hidden', !show);
    if (!show || !waypoint) return;
    const txt = `${waypoint.label} · ${num(Math.hypot(waypoint.x - game.player.x, waypoint.z - game.player.z))} m`;
    if (destText.textContent !== txt) destText.textContent = txt;
    const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
    // Repère de la caméra : devant elle (z < 0), projection à l'écran ; derrière, flèche vers le bas de l'écran.
    const cs = destV.set(waypoint.x, 3, waypoint.z).applyMatrix4(scene.camera.matrixWorldInverse);
    const ahead = cs.z < -0.5;
    let sx = 0, sy = 0, dx = cs.x, dy = Math.abs(cs.z) * 0.6 + Math.abs(cs.y);
    if (ahead) {
      const p = cs.clone().applyMatrix4(scene.camera.projectionMatrix);
      sx = ((p.x + 1) / 2) * w; sy = ((1 - p.y) / 2) * h; dx = sx - w / 2; dy = sy - h / 2;
    }
    const mx = 130, top = 112, bottom = 132;
    if (ahead && sx > mx && sx < w - mx && sy > top && sy < h - bottom) {
      destBox.classList.remove('edge');
      destBox.style.transform = `translate(${Math.round(sx)}px, ${Math.round(sy)}px) translate(-50%, -100%)`;
      destArrow.style.transform = 'rotate(90deg)';
    } else {
      // Bord de l'écran, dans la direction de la destination vue du centre.
      const a = Math.atan2(dy, dx), cx = w / 2, cy = (top + h - bottom) / 2;
      const k = Math.min((w / 2 - mx) / Math.max(1e-6, Math.abs(Math.cos(a))), ((h - top - bottom) / 2) / Math.max(1e-6, Math.abs(Math.sin(a))));
      destBox.classList.add('edge');
      destBox.style.transform = `translate(${Math.round(cx + Math.cos(a) * k)}px, ${Math.round(cy + Math.sin(a) * k)}px) translate(-50%, -50%)`;
      destArrow.style.transform = `rotate(${a}rad)`;
    }
  };

  /*
   * Indice contextuel (bandeau en bas) quand il n'y a rien à faire en attendant une livraison (rayons vides, rien à
   * décharger) : accélérer le temps, ou aller manger / dormir. Après quelques secondes sans bouger ; disparaît dès
   * que ça ne s'applique plus ; « × » le fait taire jusqu'à la livraison suivante.
   */
  const hintText = el('span', { cls: 'hint-txt' });
  const hintGo = button('', () => { speed = speed < 2 ? 2 : 3; paint(); }, 'small primary hint-go');
  const hintBox = el('div', { cls: 'hint-bar hidden', attrs: { role: 'status' } }, el('span', { cls: 'hint-ico' }, icon('info')), hintText, hintGo);
  const hintX = button('×', () => { hintMuted = hintNow?.key ?? ''; hintBox.classList.add('hidden'); }, 'hint-x');
  hintX.setAttribute('aria-label', 'Masquer l’indice');
  hintBox.append(hintX);
  document.body.append(hintBox);
  /** Indice affiché ou à afficher, indice masqué par le joueur ; dernier contrôle et dernier mouvement (ms, temps réel). */
  let hintNow: { key: string; text: string; go: string | null } | null = null, hintMuted = '', hintCheck = 0, movedAt = performance.now();
  const waitingHint = (): typeof hintNow => {
    if (!game.shops.length) return null;
    const next = Math.min(...game.orders.filter((o) => o.deliverAt > game.total).map((o) => o.deliverAt));
    if (!Number.isFinite(next)) return null;
    // Rien à vendre ni à décharger.
    if (Object.values(game.player.carry).some((q) => q > 0) || game.shops.some((s) => Object.values(s.products).some((p) => p.stock > 0) || game.unloadable(s.id) > 0)) return null;
    const c = clockView(next), sameDay = Math.floor(next / 1440) === Math.floor(game.total / 1440);
    const when = `${sameDay ? '' : 'demain '}${c.hour} h${c.minute ? String(c.minute).padStart(2, '0') : ''}`;
    const fast = speed < 2 ? 'touche 3 pour accélérer le temps' : speed < 3 ? 'touche 4 pour l’accélérer encore' : null;
    const care = game.player.hunger < 70 ? 'allez manger au snack' : game.player.energy < 45 ? 'allez dormir chez vous' : null;
    const what = [fast, care].filter(Boolean).join(', ou ');
    if (!what) return null;
    return { key: `livraison-${next}`, text: `En attendant la livraison de ${when} : ${what}.`, go: speed < 2 ? 'Accélérer (3)' : speed < 3 ? 'Plus vite (4)' : null };
  };
  const hintStep = (): void => {
    const ax = controls.axis(), now = performance.now();
    if (Math.hypot(ax.x, ax.y) > 0.05) movedAt = now;
    if (now - hintCheck > 500) { hintCheck = now; hintNow = waitingHint(); }
    const busy = !!recapOpen || !!bankruptOpen || !!victoryOpen || bigmap.isOpen || phone.isOpen || panel.isOpen || build.on || game.player.sleeping;
    const show = !!hintNow && !busy && now - movedAt > 4000 && hintNow.key !== hintMuted;
    hintBox.classList.toggle('hidden', !show);
    if (!show || !hintNow) return;
    if (hintText.textContent !== hintNow.text) hintText.textContent = hintNow.text;
    hintGo.classList.toggle('hidden', !hintNow.go);
    if (hintNow.go && hintGo.textContent !== hintNow.go) hintGo.textContent = hintNow.go;
  };

  /* ------------------------------ Clavier ------------------------------ */

  controls.onKey = (k, e) => {
    if (recapOpen || bankruptOpen || victoryOpen) return;
    // Grande carte ouverte : une touche de déplacement la ferme, et le personnage part aussitôt (touche maintenue).
    if (bigmap.isOpen && MOVE_CODES.has(e.code)) { bigmap.close(); return; }
    if (k === 'Escape') {
      if (game.player.sleeping) { game.wake(); return; }
      if (phone.isOpen) { phone.back(); return; }
      if (bigmap.isOpen) { bigmap.close(); return; }
      if (build.on && build.tool) { build.tool = null; scene.interior?.view.setGhost(null); renderBuildBar(); return; }
      if (build.on) { setBuild(false); return; }
      if (panel.isOpen) { panel.close(); return; }
      return;
    }
    if (k === 'h') showHelp();
    else if (k === 't') phone.toggle();
    else if (k === 'm') bigmap.toggle(game.player.x, game.player.z, game.player.heading, waypoint);
    else if (k === 'e') interact();
    else if (k === 'v') findMyVehicle();
    else if (k === 'b') setBuild(!build.on);
    else if (k === 'r' && build.on) { build.rot = ((build.rot + 1) % 4) as Rot; }
    else if (k === 'p') { speed = speed === 0 ? 1 : 0; paint(); }
    else if (k === '1' || k === '2' || k === '3' || k === '4') { speed = Number(k) - 1; paint(); }
  };

  /* ------------------------------ Reprise d'une sauvegarde ------------------------------ */

  const pl = game.player.place;
  if (game.player.driving !== null) game.setDriving(null);
  if (pl.kind === 'commerce' && game.shop(pl.shopId)) enterShop(pl.shopId);
  else if (pl.kind === 'logement' && pl.homeId === game.player.home) enterHome(pl.homeId);
  else game.setPlace({ kind: 'rue' });
  // Partie enregistrée au volant : le personnage reprend à pied à côté du véhicule, pas dans sa carrosserie.
  if (!inside) {
    const nv = nearestVehicle(game.player.x, game.player.z);
    if (nv && nv.d === 0) { const at = exitPoint(nv.v); game.setPlayerPose(at.x, at.z, nv.v.heading); }
  }

  /* ------------------------------ Boucle ------------------------------ */

  let refreshT = 0, interiorT = 0;
  /** Véhicules déjà montrés ; caméra qui se tourne vers un véhicule qui vient d'être acheté (cap visé, durée restante). */
  let shownVehicles = game.vehicles.length, lookYaw = 0, lookT = 0;
  const focus = new THREE.Vector3();
  const refreshInterior = (force = false): void => {
    if (!inside || inside.kind !== 'shop' || !scene.interior) return;
    const s = game.shop(inside.shopId);
    if (!s) return;
    if (!force && interiorT < 0.5) return;
    interiorT = 0;
    scene.interior.view.setItems(itemsOf(s));
    scene.interior.view.setSurfaces(s.floorId, s.wallId);
    scene.interior.view.setDirt(game.cleanliness(s));
    if (agents) agents.dirty = game.cleanliness(s) < CLEANING.warn;
    if (game.layoutRev !== layoutRev) { layoutRev = game.layoutRev; agents?.refreshLayout(); }
    const c = clockView(game.total);
    const open = c.hour >= s.open && c.hour < s.close;
    // Seuls les employés de service sont visibles, caissiers en premier (ils prennent la caisse).
    agents?.setStaff(open ? [...game.onDuty(s.id)].sort((a, b) => Number(game.roleOf(b) === 'caisse') - Number(game.roleOf(a) === 'caisse')).map((e) => ({ id: e.id, look: e.look })) : []);
  };

  let last = performance.now(), acc = 0;
  /** Boucle protégée : une erreur est signalée une fois mais n'arrête jamais le jeu. */
  let loopErrors = 0;
  const loop = (now: number): void => {
    try { frameStep(now); } catch (e) {
      debug.errors.push(String(e));
      if (loopErrors++ === 0) { console.error(e); toast('Une erreur d’affichage est survenue ; le jeu continue.', 'error'); }
    }
    requestAnimationFrame(loop);
  };
  const frameStep = (now: number): void => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const sleeping = game.player.sleeping;
    const rate = sleeping ? SLEEP_SPEED : SPEEDS[speed]!;
    acc += rate * dt;
    const n = Math.min(600, Math.floor(acc));
    if (n > 0) { acc -= n; if (!game.rescue.bankrupt) game.advance(n); }
    sleepCover.classList.toggle('hidden', !sleeping);

    if (game.player.teleportHome) {
      game.player.teleportHome = false;
      if (car) leaveCar();
      if (inside) exitInterior();
      panel.close();
      if (game.player.home) enterHome(game.player.home);
    }

    const canMove = !sleeping && speed > 0 && !bigmap.isOpen && !(panel.isOpen && panel.current?.onClose && !inside);
    const ax = canMove ? controls.axis() : { x: 0, y: 0 };
    const { f, r } = scene.cam.basis();
    walkSpeed = 0;
    if (inside && scene.interior) {
      const view = scene.interior.view;
      if (game.player.tending !== null && agents?.playerRegister != null) {
        const sp = agents.registerSpot(agents.playerRegister);
        if (sp) ipos = sp;
        if (Math.hypot(ax.x, ax.y) > 0.3) game.tend(null);
        scene.player.reach();
      } else if (Math.hypot(ax.x, ax.y) > 0.05) {
        const v = (controls.run ? IN_RUN : IN_WALK) * (game.player.energy < 15 ? 0.6 : 1);
        const dx = f[0] * ax.y + r[0] * ax.x, dz = f[1] * ax.y + r[1] * ax.x;
        const res = view.collider.resolve(ipos.x + dx * v * dt, ipos.z + dz * v * dt, 0.3);
        ipos.x = res.x; ipos.z = res.z;
        ipos.heading = turnTo(ipos.heading, Math.atan2(-dx, -dz), dt * 12);
        walkSpeed = v * Math.hypot(ax.x, ax.y);
      } else {
        const res = view.collider.resolve(ipos.x, ipos.z, 0.3);
        ipos.x = res.x; ipos.z = res.z;
      }
      if (game.player.tending === null && agents) agents.playerRegister = null;
      if (ipos.z > view.D / 2 + 1.0) exitInterior();
    } else if (car) {
      const v = game.vehicle(car.id);
      if (!v) { car = null; scene.player.group.visible = true; }
      else if (speed > 0) {
        // Jeu en pause (téléphone, P) : le véhicule s'immobilise avec le temps.
        const def = VEHICLE_BY_ID.get(v.type)!;
        const body = VEHICLE_BODY[v.type];
        drive(car, { throttle: ax.y, steer: -ax.x, brake: controls.brake }, dt, def.speed, driveObstacles(v.id), body.radius, body.span);
        game.setVehiclePose(car.id, car.x, car.z, car.heading);
        game.setPlayerPose(car.x, car.z, car.heading);
        // Caméra dans le dos du véhicule : elle rattrape son cap dès qu'il roule, et vite juste après être monté. En
        // marche arrière, elle reste derrière le capot (pas de demi-tour de la vue, qui inverserait la direction).
        carCamT = Math.max(0, carCamT - dt);
        if (Math.abs(car.speed) > 1 || carCamT > 0) scene.cam.yaw = turnTo(scene.cam.yaw, car.heading, dt * (carCamT > 0 ? 5 : 2.2));
      }
    } else if (!sleeping) {
      const p = game.player;
      if (Math.hypot(ax.x, ax.y) > 0.05) {
        const v = (controls.run ? RUN : WALK) * (p.energy < 15 ? 0.6 : 1);
        const dx = f[0] * ax.y + r[0] * ax.x, dz = f[1] * ax.y + r[1] * ax.x;
        const res = scene.collider.resolve(p.x + dx * v * dt, p.z + dz * v * dt, 0.35);
        game.setPlayerPose(res.x, res.z, turnTo(p.heading, Math.atan2(-dx, -dz), dt * 12));
        walkSpeed = v * Math.hypot(ax.x, ax.y);
      }
    }
    if (waypoint && !inside && Math.hypot(waypoint.x - game.player.x, waypoint.z - game.player.z) < 4) { toast(`Arrivé : ${waypoint.label}`, 'ok'); waypoint = null; scene.setBeacon(null); }
    // Véhicule acheté : la caméra se tourne vers lui (garé devant le garage, sous la balise bleue).
    if (game.vehicles.length > shownVehicles && !inside && !car) { const v = game.vehicles[game.vehicles.length - 1]!; lookYaw = Math.atan2(-(v.x - game.player.x), -(v.z - game.player.z)); lookT = 1.2; }
    shownVehicles = game.vehicles.length;
    if (lookT > 0) { lookT -= dt; scene.cam.yaw = turnTo(scene.cam.yaw, lookYaw, dt * 6); }

    // Personnage, véhicules, clients.
    scene.player.update(dt, walkSpeed);
    if (inside) { scene.player.group.position.set(ipos.x, 0, ipos.z); scene.player.group.rotation.y = ipos.heading; }
    else { scene.player.group.position.set(game.player.x, 0.16, game.player.z); scene.player.group.rotation.y = game.player.heading; }
    scene.vehicles.sync(game.vehicles, car ?? undefined);
    // Avis des clients (bulles) dans le commerce où l'on se trouve, au plus un toutes les 1,2 s.
    // Les avis en attente sont gardés (au plus 12) jusqu'à la prochaine bulle possible.
    if (game.feedback.length > 12) game.feedback.splice(0, game.feedback.length - 12);
    if ((feedbackT -= dt) <= 0 && inside?.kind === 'shop' && agents) {
      const k = game.feedback.findIndex((x) => x.shopId === (inside as { shopId: number }).shopId);
      if (k >= 0) { agents.feedback(game.feedback[k]!.kind); game.feedback.splice(0, k + 1); feedbackT = 1.2; }
      else game.feedback.length = 0;
    } else if (!inside) game.feedback.length = 0;
    const ev = game.events.splice(0);
    let street = 0;
    for (const e of ev) {
      if (inside?.kind === 'shop' && e.shopId === inside.shopId) {
        // Vente dans le commerce où l'on se trouve : montant doré au-dessus de la caisse dès l'encaissement (qu'un
        // client soit dessiné ou non), client qui entre, tintement.
        const sh = game.shop(e.shopId);
        agents?.sale(e.products.reduce((a, id) => a + (sh?.products[id]?.price ?? 0), 0));
        agents?.spawn(e.products);
        sound.ding();
      }
      else if (!inside && street++ < 4) { const p = game.premise(e.premiseId); if (p) scene.people.addClient(p.doorX, p.doorZ); }
    }
    if (inside && agents) {
      const s = game.shop((inside as { shopId: number }).shopId);
      const c = clockView(game.total);
      agents.playerPos = [ipos.x, ipos.z];
      agents.update(dt, sleeping ? 4 : SPEEDS[speed]!, !!s && c.hour >= s.open && c.hour < s.close);
    }
    if (!inside) scene.traffic.update(dt, [[game.player.x, game.player.z]]);
    interiorT += dt;
    refreshInterior();

    for (const nt of game.notices) {
      if (nt.seq <= toastSeq) continue;
      toastSeq = nt.seq;
      toast(nt.text, nt.level === 'warn' ? 'warn' : nt.level);
      noteSound(/^Objectifs? atteints?/.test(nt.text) ? 'success' : nt.level);
    }
    noteSoundStep();
    if (game.day !== lastDay) { lastDay = game.day; writeSave(game); if (game.shops.length) recapDue = true; }
    // Récapitulatif de fin de journée : jeu en pause tant qu'il est affiché (après le réveil si l'on dort).
    if (recapDue && !game.player.sleeping && !recapOpen && !game.rescue.bankrupt) {
      recapDue = false;
      const before = speed;
      speed = 0;
      recapOpen = showRecap(game, () => { recapOpen = null; speed = before || 1; paint(); }, () => panel.open(rescueView(ctx)));
      if (!recapOpen) speed = before;
    }
    // Faillite : écran de fin (le temps s'arrête) ; reprendre avant les difficultés, charger, ou recommencer.
    if (game.rescue.bankrupt && !bankruptOpen && !recapOpen) {
      recapDue = false; speed = 0; game.wake(); phone.close(); panel.close();
      const read = (key: string): GameSave | null => { try { const t = localStorage.getItem(key); return t ? JSON.parse(t) as GameSave : null; } catch { return null; } };
      const mine = (s: GameSave | null): s is GameSave => !!s && s.seed === game.seed && s.companyName === game.companyName;
      const cp = read(RESCUE_KEY), last = readSave(), dayOf = (s: GameSave): number => Math.floor(s.total / 1440) + 1;
      const acts: { label: string; run: () => void; primary?: boolean }[] = [];
      if (mine(cp)) acts.push({ label: `Reprendre au jour ${dayOf(cp)} (avant les difficultés)`, primary: true, run: () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(cp)); } catch { /* stockage indisponible */ } location.reload(); } });
      else if (mine(last)) acts.push({ label: `Charger la dernière sauvegarde (jour ${dayOf(last)})`, primary: true, run: () => location.reload() });
      acts.push({ label: 'Recommencer une partie', primary: !acts.length, run: () => { try { localStorage.removeItem(SAVE_KEY); localStorage.removeItem(RESCUE_KEY); } catch { /* stockage indisponible */ } location.reload(); } });
      bankruptOpen = showBankruptcy(game, acts);
    }
    // Écran de victoire (légende du quartier) : jeu en pause, jamais par-dessus le récapitulatif ni pendant le sommeil.
    if (victoryDue && !recapDue && !recapOpen && !bankruptOpen && !game.player.sleeping && !victoryOpen) {
      victoryDue = false;
      const before = speed;
      speed = 0;
      victoryOpen = showVictory(game, () => { victoryOpen = null; speed = phone.isOpen ? 0 : before || 1; paint(); });
    }

    syncStreet();
    walletStep(dt);
    paint();
    panel.paint();
    phone.paint();
    adaptQuality(dt);
    if ((refreshT += dt) > 0.5) { refreshT = 0; renderInteriorBar(); renderObjective(); if (build.on) renderBuildBar(); }
    const a = currentAction();
    // Au volant, « Descendre (E) » est dans la barre de conduite : pas d'invite au milieu de la route.
    prompt.classList.toggle('hidden', !a || build.on || !!car);
    if (a && promptLabel.textContent !== a.label) promptLabel.textContent = a.label;
    renderDriveBar();
    minimap.visible = !inside;
    if (!inside) minimap.draw(game.player.x, game.player.z, game.player.heading, waypoint);

    if (inside && build.on) focus.set(0, 0, 0.6);
    else if (inside) focus.set(ipos.x, 1.2, ipos.z);
    else if (car) focus.set(car.x, 1.6, car.z);
    else focus.set(game.player.x, 1.7, game.player.z);
    scene.setTime(game.total % 1440);
    if (game.weather !== shownWeather) { shownWeather = game.weather; scene.setWeather(game.weather); }
    scene.frame(dt, focus, snapCam);
    snapCam = false;
    destPointer();
    hintStep();
  };
  requestAnimationFrame(loop);
  window.addEventListener('beforeunload', () => writeSave(game));

  // Aide au premier lancement.
  let helpSeen = false;
  try { helpSeen = localStorage.getItem('bc-aide') === '1'; } catch { /* stockage indisponible */ }
  if (!helpSeen && !params.has('auto') && !navigator.webdriver) { showHelp(); try { localStorage.setItem('bc-aide', '1'); } catch { /* stockage indisponible */ } }
  if (game.shops.length === 0 && game.total < 8 * 60) {
    toast('Bienvenue ! Sortez de chez vous (E près de la porte), puis cherchez un anneau jaune : un local à louer. La carte (M) montre tout le quartier.', 'info');
  }

  Object.assign(debug, {
    scene,
    teleport: (x: number, z: number) => { if (inside) exitInterior(); game.setPlayerPose(x, z, game.player.heading); snapCam = true; },
    toDoor: (buildingId: number) => { const b = game.building(buildingId)!; if (inside) exitInterior(); game.setPlayerPose(b.doorX, b.doorZ, 0); snapCam = true; },
    interact,
    action: () => currentAction()?.label ?? null,
    state: () => ({ inside, car: car ? { ...car } : null, ipos: { ...ipos }, build: { ...build }, customers: agents?.customerCount ?? 0, panel: panel.current?.title ?? null, waypoint: waypoint ? { ...waypoint } : null }),
    findVehicle: findMyVehicle,
    setIpos: (x: number, z: number) => { ipos.x = x; ipos.z = z; },
    setBuild,
    buildTool: (id: string | null, rot: Rot = 0) => { build.tool = id; build.rot = rot; renderBuildBar(); },
    setSpeed: (k: number) => { speed = k; },
    advance: (m: number) => game.advance(m),
    enterShop, exitInterior,
    cam: scene.cam,
    /** Position à l'écran (pixels de la page) du centre d'une case de l'intérieur. */
    cellScreen: (x: number, z: number) => {
      const view = scene.interior!.view;
      const [wx, wz] = view.cellCenter(x, z);
      const v = new THREE.Vector3(wx, 0, wz).project(scene.camera);
      const r = canvas.getBoundingClientRect();
      return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
    },
    recap: () => !!recapOpen,
    keepAlive: () => { game.player.energy = 100; game.player.hunger = 100; },
    agents: () => agents,
  });
  debug.ready = true;
}

/* ------------------------------ Aides ------------------------------ */

function turnTo(a: number, b: number, k: number): number {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * Math.min(1, k);
}

function mix(hex: string): string {
  const c = new THREE.Color(hex).lerp(new THREE.Color(0x777777), 0.45);
  return `#${c.getHexString()}`;
}

function facadeColor(b: Building): string {
  const pal = ['#d9c7a8', '#e6dccb', '#c9a98a', '#b98b6e', '#d7b48c', '#e9e2d6', '#bfc4c8', '#a9b4bd', '#d2a07a', '#cfc0ad'];
  return pal[Math.floor(b.tint * pal.length) % pal.length]!;
}

function canPlaceUi(s: Shop, gw: number, gd: number, def: string, x: number, z: number, rot: Rot): string | null {
  return canPlace(s.items, gw, gd, FURNITURE_BY_ID.get(def)!, x, z, rot);
}

/** Mobilier fixe du logement. */
function homeItems(W: number, D: number): InteriorItem[] {
  const list: [string, number, number, Rot][] = [['lit', 0, 0, 0], ['armoire', 2, 0, 0], ['cuisine', W - 3, 0, 0], ['canape', W - 1, D - 4, 3], ['plante', 0, D - 2, 0], ['table', W - 4, 2, 0],
    ['bureau-perso', 0, D - 1, 2], ['tele', W - 2, D - 1, 2]];
  // Logements plus grands : salle de bain et buanderie ; loft : baignoire.
  if (W >= 9) list.push(['salle-de-bain', 0, 3, 1], ['buanderie', 4, 0, 0]);
  if (W >= 11) list.push(['baignoire', 1, 3, 1]);
  return list.map(([def, x, z, rot], k) => ({ uid: 100 + k, def, x, z, rot, fill: 0, colors: ['#cccccc'] }));
}

/** Écran de chargement : modèles 3D puis menu (ou partie de test). */
async function boot(): Promise<void> {
  const box = $('loading');
  loadingScreen(box);
  const bar =box.querySelector<HTMLElement>('.bar-fill')!, label = box.querySelector<HTMLElement>('.load-label')!;
  box.classList.remove('hidden');
  await assets.load((p, l) => { bar.style.width = `${Math.round(p * 100)}%`; label.textContent = `Chargement des modèles 3D… ${Math.round(p * 100)} % (${l})`; }, params.has('sansmodeles'));
  box.classList.add('hidden');
  if (assets.failed.length) console.warn(`Modèles indisponibles (formes de remplacement) : ${assets.failed.join(', ')}`);
  debug['assets'] = { loaded: assets.count(), failed: [...assets.failed] };
  if (params.has('galerie')) { gallery($<HTMLCanvasElement>('scene')); debug.ready = true; return; }
  if (params.has('auto')) start(new Game(params.has('seed') ? Number(params.get('seed')) | 0 : 7, 'Test SA'));
  else menu();
}
void boot();
