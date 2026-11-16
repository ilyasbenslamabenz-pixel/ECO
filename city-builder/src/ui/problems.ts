/**
 * Fenêtre « Problèmes à régler » (au-dessus de la mini-carte, même largeur) : au plus 3 problèmes, triés par
 * gravité puis par nombre de bâtiments touchés. Un clic ouvre le tableau de bord (ou l'outil) où le problème se
 * règle et, s'il est localisé, centre la caméra sur le groupe de bâtiments touchés.
 * Aucune simulation nouvelle : compteurs du module alertes (src/render/plugins/alertes.ts), rapport de la
 * simulation (finances, chômage, couverture des services) et journal regroupé des notifications (notify-log.ts).
 * Mise à jour au plus une fois par seconde, rendu seulement si le contenu change.
 */
import { $, el } from './dom';
import { iconEl } from './icons';
import { journal } from './notify';
import { lastAlertes } from '../render/plugins/alertes';
import { ALERT_BITS, type AlertKind } from '../shared/protocol-ext/alertes';

export type ProblemSeverity = 'urgent' | 'important';

export interface Problem {
  id: string;
  severity: ProblemSeverity;
  text: string;
  /** Compteur affiché à droite (« 14 », « −36 k »). */
  count: string;
  /** Poids de tri à gravité égale (bâtiments touchés, ou équivalent). */
  weight: number;
  icon: string;
  /** Sélecteur du bouton qui ouvre l'endroit où le problème se règle. */
  open: string;
  /** Alerte localisée : la caméra se centre sur les bâtiments qui portent ce bit. */
  alert?: AlertKind;
}

/** Sous-ensemble du rapport de la simulation lu ici (src/sim/sim-protocol.ts). */
interface ReportLike {
  economy?: { forecast?: { balance?: number } };
  demography?: {
    population?: number;
    unemploymentRate?: number;
    cityServices?: { coverage?: { police: number; fire: number; health: number } };
  };
}

const ALERT_PROBLEMS: { kind: AlertKind; severity: ProblemSeverity; icon: string; open: string; text: (n: number) => string }[] = [
  { kind: 'fire', severity: 'urgent', icon: 'fire', open: '#sidebar [data-dash="services"]', text: (n) => `${n} bâtiment${n > 1 ? 's' : ''} en feu` },
  { kind: 'power', severity: 'urgent', icon: 'energy', open: '#sidebar [data-dash="energy"]', text: (n) => `${n} bâtiment${n > 1 ? 's' : ''} sans électricité` },
  { kind: 'water', severity: 'urgent', icon: 'water', open: '#sidebar [data-dash="water"]', text: (n) => `${n} bâtiment${n > 1 ? 's' : ''} sans eau` },
  { kind: 'road', severity: 'important', icon: 'road', open: '#toolbar [data-tool="road"]', text: (n) => `${n} bâtiment${n > 1 ? 's' : ''} sans accès routier` },
  { kind: 'waste', severity: 'important', icon: 'waste', open: '#sidebar [data-dash="waste"]', text: (n) => `Bacs pleins : ${n}` },
  { kind: 'isolated', severity: 'important', icon: 'truck', open: '#sidebar [data-dash="waste"]', text: () => 'Dépôt de déchets isolé' },
  { kind: 'ruin', severity: 'important', icon: 'demolish', open: '#sidebar [data-dash="services"]', text: (n) => `${n} ruine${n > 1 ? 's' : ''} à reconstruire` },
  { kind: 'crime', severity: 'important', icon: 'police', open: '#sidebar [data-dash="services"]', text: (n) => `Criminalité élevée : ${n} bâtiment${n > 1 ? 's' : ''}` },
];

const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const kShort = (v: number): string => {
  const a = Math.abs(v);
  const s = a >= 1e6 ? `${(a / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M` : a >= 1e4 ? `${nf.format(a / 1000)} k` : nf.format(a);
  return `${v < 0 ? '−' : ''}${s}`;
};

/** Liste des problèmes (pure, testable) : alertes, finances, chômage, couverture, trafic signalé. */
export function collectProblems(counts: Partial<Record<AlertKind, number>> | null, report: ReportLike | null, money: number | null, trafficAlert: boolean): Problem[] {
  const out: Problem[] = [];
  for (const a of ALERT_PROBLEMS) {
    const n = counts?.[a.kind] ?? 0;
    if (n > 0) out.push({ id: a.kind, severity: a.severity, text: a.text(n), count: nf.format(n), weight: n, icon: a.icon, open: a.open, alert: a.kind });
  }
  const balance = report?.economy?.forecast?.balance;
  if (typeof balance === 'number' && balance < 0) {
    const broke = money !== null && money < -balance * 3;
    out.push({ id: 'deficit', severity: broke ? 'urgent' : 'important', text: `Déficit ${kShort(balance)} CHF/mois`, count: kShort(balance), weight: Math.min(999, Math.round(-balance / 1000)),
      icon: 'finance', open: '#sidebar [data-dash="finance"]' });
  }
  const pop = report?.demography?.population ?? 0;
  const ur = report?.demography?.unemploymentRate ?? 0;
  if (pop >= 50 && ur >= 0.08) {
    out.push({ id: 'chomage', severity: ur >= 0.2 ? 'urgent' : 'important', text: `Chômage ${Math.round(ur * 100)} %`, count: `${Math.round(ur * 100)} %`, weight: Math.round(ur * pop),
      icon: 'people', open: '#sidebar [data-dash="population"]' });
  }
  const cov = report?.demography?.cityServices?.coverage;
  if (cov && pop >= 100) {
    const worst = (['police', 'fire', 'health'] as const).map((k) => ({ k, v: cov[k] })).sort((x, y) => x.v - y.v)[0]!;
    if (worst.v < 0.6) {
      const name = { police: 'police', fire: 'pompiers', health: 'soins' }[worst.k];
      const share = Math.round((1 - worst.v) * 100);
      out.push({ id: `couverture-${worst.k}`, severity: 'important', text: `Pas de couverture ${name} : ${share} % des habitants`, count: `${share} %`, weight: Math.round((1 - worst.v) * pop),
        icon: worst.k === 'police' ? 'police' : worst.k === 'fire' ? 'fire' : 'hospital', open: '#sidebar [data-dash="services"]' });
    }
  }
  if (trafficAlert) out.push({ id: 'trafic', severity: 'important', text: 'Circulation très lente', count: '!', weight: 1, icon: 'transport', open: '#sidebar [data-dash="transport"]' });
  out.sort((a, b) => (a.severity === b.severity ? b.weight - a.weight : a.severity === 'urgent' ? -1 : 1));
  return out;
}

/** Centre des bâtiments qui portent l'alerte (point du groupe le plus proche du barycentre). */
function alertFocus(kind: AlertKind): { x: number; z: number } | null {
  const items = lastAlertes()?.items;
  if (!items) return null;
  const bit = ALERT_BITS[kind];
  const pts: { x: number; z: number }[] = [];
  for (let i = 0; i + 4 < items.length; i += 5) if (items[i + 1]! & bit) pts.push({ x: items[i + 2]!, z: items[i + 4]! });
  if (!pts.length) return null;
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
  let best = pts[0]!, bd = Infinity;
  for (const p of pts) { const d = (p.x - cx) ** 2 + (p.z - cz) ** 2; if (d < bd) { bd = d; best = p; } }
  return best;
}

interface DebugLike { lastReport?: unknown; lastStats?: unknown; lookAt?: (x: number, z: number, d: number) => void }

export function initProblems(): void {
  const minimap = $('minimap');
  const bottom = $('bottom');
  if (document.getElementById('problems')) return;
  // Colonne de droite : fenêtre des problèmes + mini-carte (même largeur, alignées).
  const col = el('div', { attrs: { id: 'mm-col' } });
  const box = el('section', { attrs: { id: 'problems', 'aria-label': 'Problèmes à régler', 'aria-live': 'polite' } });
  minimap.before(col);
  col.append(box, minimap);
  const head = el('div', { cls: 'pb-head' }, el('span', { cls: 'pb-title', text: 'Problèmes à régler' }), el('span', { cls: 'pb-total' }));
  const list = el('div', { cls: 'pb-list' });
  box.append(head, list);
  let sig = '';
  let current: Problem[] = [];

  const run = (p: Problem): void => {
    const b = document.querySelector<HTMLElement>(p.open);
    // Le tableau de bord n'est ouvert que s'il ne l'est pas déjà (le bouton du rail est une bascule).
    if (b && !b.classList.contains('active')) b.click();
    if (p.alert) {
      const f = alertFocus(p.alert);
      const dbg = (window as unknown as { __aube?: DebugLike }).__aube;
      if (f && dbg?.lookAt) dbg.lookAt(f.x, f.z, 320);
    }
  };

  const render = (): void => {
    const dbg = (window as unknown as { __aube?: DebugLike }).__aube;
    const stats = dbg?.lastStats as { money?: number } | null | undefined;
    const traffic = journal.entries.some((e) => e.key === 'r:trafic' && e.unread);
    const all = collectProblems(lastAlertes()?.counts ?? null, (dbg?.lastReport as ReportLike | undefined) ?? null, stats?.money ?? null, traffic);
    current = all.slice(0, 3);
    const s = current.map((p) => `${p.id}|${p.text}|${p.severity}`).join(';') + `#${all.length}`;
    if (s === sig) return;
    sig = s;
    box.classList.toggle('empty', all.length === 0);
    (head.lastElementChild as HTMLElement).textContent = all.length > 3 ? `${all.length}` : '';
    if (!all.length) {
      list.replaceChildren(el('div', { cls: 'pb-ok', text: 'Aucun problème ✓' }));
      return;
    }
    list.replaceChildren(...current.map((p) => {
      const b = el('button', { cls: `pb-row ${p.severity}`, attrs: { type: 'button', 'data-problem': p.id, 'data-tip': `${p.text} — ${p.alert ? 'ouvrir le tableau de bord et centrer la vue' : 'ouvrir le tableau de bord'}` } },
        el('span', { cls: 'pb-ico' }, iconEl(p.icon)), el('span', { cls: 'pb-txt', text: p.text }), el('span', { cls: 'pb-n', text: p.count }));
      b.addEventListener('click', () => run(p));
      return b;
    }));
  };
  render();
  window.setInterval(() => { if (!document.hidden && !bottom.classList.contains('hidden')) render(); }, 1000);
}
