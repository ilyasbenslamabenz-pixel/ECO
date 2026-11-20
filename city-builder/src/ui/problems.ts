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
import { BUILD, goTo } from './goto';

export type ProblemSeverity = 'urgent' | 'important';

export interface Problem {
  id: string;
  severity: ProblemSeverity;
  text: string;
  /** Libellé court de la ligne (le compteur porte le nombre) ; `text` reste dans l'infobulle. */
  short: string;
  /** Compteur affiché à droite (« 14 », « −36 k »). */
  count: string;
  /** Poids de tri à gravité égale (bâtiments touchés, ou équivalent). */
  weight: number;
  icon: string;
  /** Sélecteur du bouton qui ouvre l'endroit où le problème se règle (de préférence l'outil qui le règle). */
  open: string;
  /** Onglet du tiroir de construction à sélectionner après l'ouverture (ex. « securite » dans Services). */
  tab?: string;
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

const ALERT_PROBLEMS: { kind: AlertKind; severity: ProblemSeverity; icon: string; open: string; tab?: string; short: string; text: (n: number) => string }[] = [
  { kind: 'fire', severity: 'urgent', icon: 'fire', open: BUILD.services, tab: 'securite', short: 'En feu', text: (n) => `${n} bâtiment${n > 1 ? 's' : ''} en feu` },
  { kind: 'power', severity: 'urgent', icon: 'energy', open: BUILD.energy, short: 'Sans électricité', text: (n) => `${n} bâtiment${n > 1 ? 's' : ''} sans électricité` },
  { kind: 'water', severity: 'urgent', icon: 'water', open: BUILD.water, short: 'Sans eau', text: (n) => `${n} bâtiment${n > 1 ? 's' : ''} sans eau` },
  { kind: 'road', severity: 'important', icon: 'road', open: '#toolbar [data-tool="road"]', short: 'Sans accès routier', text: (n) => `${n} bâtiment${n > 1 ? 's' : ''} sans accès routier` },
  { kind: 'waste', severity: 'important', icon: 'waste', open: BUILD.waste, short: 'Bacs pleins', text: (n) => `Bacs pleins : ${n}` },
  { kind: 'isolated', severity: 'important', icon: 'truck', open: '#toolbar [data-tool="road"]', short: 'Dépôt de déchets isolé', text: () => 'Dépôt de déchets isolé' },
  { kind: 'ruin', severity: 'important', icon: 'demolish', open: '#sidebar [data-dash="services"]', short: 'Ruines à reconstruire', text: (n) => `${n} ruine${n > 1 ? 's' : ''} à reconstruire` },
  { kind: 'crime', severity: 'important', icon: 'police', open: BUILD.services, tab: 'securite', short: 'Criminalité élevée', text: (n) => `Criminalité élevée : ${n} bâtiment${n > 1 ? 's' : ''}` },
];

const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const kShort = (v: number): string => {
  const a = Math.abs(v);
  const s = a >= 1e6 ? `${(a / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M` : a >= 1e4 ? `${nf.format(a / 1000)} k` : nf.format(a);
  return `${v < 0 ? '−' : ''}${s}`;
};

/** Liste des problèmes (pure, testable) : alertes, finances, chômage, couverture, trafic signalé. */
/** Vitesse moyenne (km/h) au-delà de laquelle la circulation n'est plus un problème (réarmement de l'alerte, hud.ts). */
export const TRAFFIC_OK_KMH = 18;

export function collectProblems(counts: Partial<Record<AlertKind, number>> | null, report: ReportLike | null, money: number | null, trafficAlert: boolean, noCollection = 0, powerReserve?: number): Problem[] {
  const out: Problem[] = [];
  // Réserve de courant faible : prévenir AVANT la baisse de régime des commerces et de l'industrie.
  if (powerReserve !== undefined) {
    const pct = Math.round(powerReserve * 100);
    out.push({ id: 'reserve-courant', severity: 'important', short: 'Réserve de courant faible', count: `${pct} %`, weight: 1, icon: 'energy', open: BUILD.energy,
      text: `Réserve de courant faible : ${pct} % de marge (au plus bas sur 24 h). Au-delà, commerces et industrie tournent au ralenti et embauchent moins. Ajoutez une centrale (Énergie).` });
  }
  // Aucun dépôt de camions-bennes : un seul message clair (pas d'icône sur chaque bâtiment).
  if (noCollection > 0) {
    out.push({ id: 'collecte', severity: 'important', text: `Aucune collecte des déchets : ${noCollection} bâtiment${noCollection > 1 ? 's ont leurs' : ' a ses'} bacs pleins. Construisez un dépôt de camions-bennes et une décharge reliés aux rues (aucun branchement : les camions passent par les routes).`,
      short: 'Aucune collecte des déchets', count: nf.format(noCollection), weight: noCollection, icon: 'waste', open: BUILD.waste });
  }
  for (const a of ALERT_PROBLEMS) {
    const n = counts?.[a.kind] ?? 0;
    if (n > 0) out.push({ id: a.kind, severity: a.severity, text: a.text(n), short: a.short, count: nf.format(n), weight: n, icon: a.icon, open: a.open, ...(a.tab ? { tab: a.tab } : {}), alert: a.kind });
  }
  const balance = report?.economy?.forecast?.balance;
  if (typeof balance === 'number' && balance < 0) {
    const broke = money !== null && money < -balance * 3;
    out.push({ id: 'deficit', severity: broke ? 'urgent' : 'important', text: `Déficit ${kShort(balance)} CHF/mois`, short: 'Déficit mensuel', count: kShort(balance), weight: Math.min(999, Math.round(-balance / 1000)),
      icon: 'finance', open: '#sidebar [data-dash="finance"]' });
  }
  const pop = report?.demography?.population ?? 0;
  const ur = report?.demography?.unemploymentRate ?? 0;
  if (pop >= 50 && ur >= 0.08) {
    out.push({ id: 'chomage', severity: ur >= 0.2 ? 'urgent' : 'important', text: `Chômage ${Math.round(ur * 100)} %`, short: 'Chômage', count: `${Math.round(ur * 100)} %`, weight: Math.round(ur * pop),
      icon: 'people', open: BUILD.zones });
  }
  const cov = report?.demography?.cityServices?.coverage;
  if (cov && pop >= 100) {
    const worst = (['police', 'fire', 'health'] as const).map((k) => ({ k, v: cov[k] })).sort((x, y) => x.v - y.v)[0]!;
    if (worst.v < 0.6) {
      const name = { police: 'police', fire: 'pompiers', health: 'soins' }[worst.k];
      const share = Math.round((1 - worst.v) * 100);
      out.push({ id: `couverture-${worst.k}`, severity: 'important', text: `Pas de couverture ${name} : ${share} % des habitants`, short: `Sans ${name === 'soins' ? 'soins' : name} à proximité`, count: `${share} %`, weight: Math.round((1 - worst.v) * pop),
        icon: worst.k === 'police' ? 'police' : worst.k === 'fire' ? 'fire' : 'hospital', open: BUILD.services, tab: worst.k === 'health' ? 'sante' : 'securite' });
    }
  }
  if (trafficAlert) out.push({ id: 'trafic', severity: 'important', text: 'Circulation très lente', short: 'Circulation très lente', count: '!', weight: 1, icon: 'transport', open: '#sidebar [data-dash="transport"]' });
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
    goTo(p);
    if (p.alert) {
      const f = alertFocus(p.alert);
      const dbg = (window as unknown as { __aube?: DebugLike }).__aube;
      if (f && dbg?.lookAt) dbg.lookAt(f.x, f.z, 320);
    }
  };

  const render = (): void => {
    const dbg = (window as unknown as { __aube?: DebugLike }).__aube;
    const stats = dbg?.lastStats as { money?: number } | null | undefined;
    // Circulation : alerte non lue ET encore lente maintenant (même seuil de réarmement que l'alerte, 18 km/h) ; sinon
    // le problème restait affiché après le retour d'une circulation fluide, jusqu'à la lecture du journal.
    const tr = (dbg?.lastReport as { traffic?: { vehicles: number; meanSpeedKmh: number } } | null | undefined)?.traffic;
    const slowNow = !tr || !Number.isFinite(tr.meanSpeedKmh) || (tr.vehicles >= 30 && tr.meanSpeedKmh < TRAFFIC_OK_KMH);
    const traffic = slowNow && journal.entries.some((e) => e.key === 'r:trafic' && e.unread);
    const all = collectProblems(lastAlertes()?.counts ?? null, (dbg?.lastReport as ReportLike | undefined) ?? null, stats?.money ?? null, traffic, lastAlertes()?.noCollection ?? 0, lastAlertes()?.powerReserve);
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
        el('span', { cls: 'pb-ico' }, iconEl(p.icon)), el('span', { cls: 'pb-txt', text: p.short }), el('span', { cls: 'pb-n', text: p.count }));
      b.addEventListener('click', () => run(p));
      return b;
    }));
  };
  render();
  window.setInterval(() => { if (!document.hidden && !bottom.classList.contains('hidden')) render(); }, 1000);
}
