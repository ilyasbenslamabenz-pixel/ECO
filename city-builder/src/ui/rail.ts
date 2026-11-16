/**
 * Mise en page « rail d'infos » (refonte de la barre du haut, du menu latéral et de la barre d'outils) :
 *  - barre du haut en trois capsules : identité (logo, ville, date, heure, météo) et vitesse | indicateurs
 *    (habitants, satisfaction, trésorerie, demande R C I B) | actions (statistiques, notifications, sauvegarde, réglages) ;
 *  - menu latéral en rail d'icônes groupé (Ville / Réseaux et services / Gouvernance), libellé au survol,
 *    point d'alerte d'après le journal des notifications (src/ui/notify-log.ts) ; tiroir groupé sur téléphone ;
 *  - barre d'outils groupée (Aménager, Réseaux, Paysage) ; sur téléphone, Démolir et Annuler au pouce ;
 *  - « Premiers pas » replié en une ligne au-dessus de la barre d'outils sur téléphone.
 * Les éléments existants sont DÉPLACÉS (mêmes identifiants, mêmes écouteurs) : aucune fonction n'est recréée.
 * Styles : bloc « Rail d'infos » en fin de styles.css (préfixe `body.ui-rail`).
 */
import { $, el } from './dom';
import { iconEl } from './icons';
import { journal, onNotify } from './notify';
import { initProblems } from './problems';

const PHONE = '(max-width: 760px)';

/** Alerte du journal (clé de regroupement de notify-log.ts) → tableau de bord du rail qui la signale. */
const ALERT_DASH: Record<string, string> = {
  'r:courant-coupe': 'energy',
  'r:intermittence': 'energy',
  'r:panne': 'energy',
  'r:eau-coupee': 'water',
  'r:incendie': 'services',
  'r:ruine': 'services',
  'r:criminalite': 'services',
  'r:trafic': 'transport',
  'r:faillite': 'finance',
  'r:palier': 'progression',
  'r:evenement': 'progression',
};

const GROUPS: { before: string; label: string }[] = [
  { before: 'city', label: 'Ville' },
  { before: 'services', label: 'Réseaux et services' },
  { before: 'policy', label: 'Gouvernance' },
];

/**
 * Raccourcis des tableaux de bord : touches libres, au même endroit sur un clavier AZERTY ou QWERTY
 * (codes physiques I, K, L, O, P, U, Y ; J ouvre déjà le tableau Déchets ; les autres lettres servent déjà à la caméra et aux outils).
 */
const SHORTCUTS: { code: string; key: string; target: string }[] = [
  { code: 'KeyY', key: 'Y', target: '#sidebar [data-dash="city"]' },
  { code: 'KeyU', key: 'U', target: '#sidebar [data-dash="finance"]' },
  { code: 'KeyP', key: 'P', target: '#sidebar [data-dash="population"]' },
  { code: 'KeyI', key: 'I', target: '#sidebar [data-dash="policy"]' },
  { code: 'KeyO', key: 'O', target: '#sidebar [data-dash="progression"]' },
  { code: 'KeyK', key: 'K', target: '#btn-notif' },
  { code: 'KeyL', key: 'L', target: '#btn-layers' },
];

/** Touches déjà gérées ailleurs, affichées dans les infobulles qui ne les mentionnaient pas. */
const KNOWN_KEYS: { target: string; key: string }[] = [
  { target: '#toolbar [data-tool="select"]', key: 'Échap' },
  { target: '#toolbar [data-tool="bulldoze"]', key: 'B' },
  { target: '#btn-cinematic', key: 'C' },
  { target: '#sidebar [data-dash="waste"]', key: 'J' },
  { target: '#mm-zoom-in', key: '+' },
  { target: '#mm-zoom-out', key: '−' },
];

export function initRail(): void {
  document.body.classList.add('ui-rail');
  for (const x of SHORTCUTS) tipKey(document.querySelector<HTMLElement>(x.target), x.key);
  for (const k of KNOWN_KEYS) tipKey(document.querySelector<HTMLElement>(k.target), k.key);
  buildHud();
  buildSidebar();
  buildToolbar();
  phoneObjectives();
  initProblems();
  shortcuts();
}

/** Ajoute « (touche X) » à l'infobulle d'un élément, une seule fois. */
function tipKey(t: HTMLElement | null, key: string): void {
  if (!t || !key) return;
  const tip = t.dataset['tip'] ?? t.getAttribute('aria-label') ?? '';
  if (/\((touche|Échap|Ctrl)/.test(tip)) return;
  t.dataset['tip'] = `${tip} (${key.length === 1 || key === '+' || key === '−' ? `touche ${key}` : key})`;
}

function shortcuts(): void {
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if ($('hud').classList.contains('hidden') || document.querySelector('.overlay:not(.hidden)')) return;
    const s = SHORTCUTS.find((x) => x.code === e.code);
    if (!s) return;
    const b = document.querySelector<HTMLElement>(s.target);
    if (!b) return;
    e.preventDefault();
    b.click();
  });
}

/* ------------------------------ Barre du haut ------------------------------ */
function buildHud(): void {
  const hud = $('hud');
  if (hud.querySelector('.hud-cap')) return;
  const capL = el('div', { cls: 'hud-cap cap-id' });
  const capM = el('div', { cls: 'hud-cap cap-kpi' });
  const capR = el('div', { cls: 'hud-cap cap-act' });
  const brandTxt = hud.querySelector('.brand-txt');
  // Date, heure et météo (désactivée tant que le module n'existe pas) : sous le nom de la ville.
  const sub = el('span', { cls: 'hud-sub' });
  sub.append($('hud-date'), $('hud-weather'));
  brandTxt?.append(sub);
  capL.append($('btn-sidebar'), hud.querySelector('.hud-brand')!, hud.querySelector('.speed')!);
  capM.append($('hud-pop-btn'), $('hud-happy-btn'), $('hud-money-btn'), $('hud-demand-btn'));
  capR.append(hud.querySelector('.hud-actions')!);
  hud.append(capL, capM, capR);
  // Satisfaction : petite jauge sous la valeur (lue dans le texte « 38 % » que tient hud.ts).
  const happy = $('hud-happy');
  const bar = el('span', { cls: 'happy-bar', attrs: { 'aria-hidden': 'true' } }, el('i'));
  happy.after(bar);
  const sync = (): void => {
    const v = Number.parseFloat((happy.textContent ?? '').replace(',', '.'));
    const fill = bar.firstElementChild as HTMLElement;
    fill.style.width = Number.isFinite(v) ? `${Math.max(0, Math.min(100, v))}%` : '0%';
    bar.dataset['level'] = !Number.isFinite(v) ? '' : v >= 60 ? 'good' : v >= 35 ? 'mid' : 'bad';
  };
  new MutationObserver(sync).observe(happy, { childList: true, characterData: true, subtree: true });
  sync();
}

/* ------------------------------ Rail (menu latéral) ------------------------------ */
function buildSidebar(): void {
  const sb = $('sidebar');
  if (sb.querySelector('.rail-h')) return;
  for (const g of GROUPS) {
    const b = sb.querySelector(`button[data-dash="${g.before}"]`);
    b?.before(el('span', { cls: 'rail-h', text: g.label, attrs: { role: 'presentation' } }));
  }
  // Cartes d'information : aussi dans le rail (raccourci vers le bouton de la mini-carte).
  const layers = el('button', { cls: 'rail-layers', attrs: { type: 'button', 'data-proxy': 'btn-layers', 'data-tip': 'Cartes d’information : satisfaction, réseaux, pollution, trafic…' } },
    iconEl('layers'), el('span', { cls: 'tl', text: 'Cartes' }));
  layers.addEventListener('click', (e) => { e.stopPropagation(); document.body.classList.remove('sidebar-open'); $('btn-layers').click(); });
  sb.querySelector('.sb-extra')?.before(el('span', { cls: 'rail-h rail-sep', attrs: { role: 'presentation' } }), layers);
  for (const b of Array.from(sb.querySelectorAll<HTMLButtonElement>('button'))) b.dataset['tipSide'] = 'right';
  // Libellé de base de chaque entrée (complété par l'alerte en cours).
  const buttons = Array.from(sb.querySelectorAll<HTMLButtonElement>('button[data-dash]'));
  const baseTip = new Map(buttons.map((b) => [b, b.dataset['tip'] ?? '']));
  for (const b of buttons) b.append(el('span', { cls: 'rail-dot', attrs: { 'aria-hidden': 'true' } }));
  const refresh = (): void => {
    const alerts = new Map<string, { urgent: boolean; text: string }>();
    for (const e of journal.entries) {
      const d = ALERT_DASH[e.key];
      if (!d || !e.unread || e.severity === 'info') continue;
      const prev = alerts.get(d);
      if (!prev || (e.severity === 'urgent' && !prev.urgent)) alerts.set(d, { urgent: e.severity === 'urgent', text: e.text });
    }
    for (const b of buttons) {
      const a = alerts.get(b.dataset['dash'] ?? '');
      b.dataset['alert'] = a ? (a.urgent ? 'urgent' : 'important') : '';
      b.dataset['tip'] = a ? `${baseTip.get(b)} — ${a.text}` : baseTip.get(b) ?? '';
    }
  };
  onNotify(refresh);
  refresh();
}

/* ------------------------------ Barre d'outils ------------------------------ */
function buildToolbar(): void {
  const tb = $('toolbar');
  if (tb.querySelector('.tb-grp')) return;
  // Intitulés de groupes (bureau) : sur le séparateur après Sélection, avant Énergie et avant Nature.
  const first = tb.querySelector('.tb-sep');
  if (first) { first.classList.add('tb-grp'); (first as HTMLElement).dataset['label'] = 'Aménager'; }
  const mark = (sel: string, label: string): void => {
    const b = tb.querySelector(sel);
    b?.before(el('span', { cls: 'tb-sep tb-grp', attrs: { 'aria-hidden': 'true', 'data-label': label } }));
  };
  mark('button[data-cat="energy"]', 'Réseaux');
  mark('button[data-cat="environment"]', 'Paysage');
}

/* ------------------------------ Premiers pas (téléphone) ------------------------------ */
function phoneObjectives(): void {
  const box = $('objectives');
  let collapsedOnce = false;
  // Hauteur occupée par l'encadré (0 s'il est masqué) : les boutons flottants du téléphone se placent au-dessus,
  // les notifications du bureau en dessous.
  const measure = (): void => {
    const h = box.offsetParent !== null ? Math.round(box.getBoundingClientRect().height) + 6 : 0;
    document.documentElement.style.setProperty('--obj-h', `${h}px`);
  };
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(measure).observe(box);
  window.addEventListener('resize', measure);
  const sync = (): void => {
    measure();
    const shown = !box.classList.contains('hidden') && !box.classList.contains('tuto-off');
    // Téléphone : l'encadré démarre replié sur une ligne (il se déplie au toucher de son intitulé).
    if (!collapsedOnce && shown && box.classList.contains('open') && matchMedia(PHONE).matches) {
      collapsedOnce = true;
      $('obj-toggle').click();
    } else if (shown) collapsedOnce = true;
  };
  new MutationObserver(sync).observe(box, { attributes: true, attributeFilter: ['class'] });
  sync();
}
