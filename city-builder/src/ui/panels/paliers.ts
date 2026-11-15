/**
 * Panneau « Paliers » (tableau de bord Progression) : titre de la ville, points d'expansion, prochain palier avec ce
 * qu'il débloque (« Prochain palier : X / Y points — débloque : … »), origine des points, liste des paliers. Données du
 * module de simulation `paliers` (commande `state`, deltas) : aucun chiffre inventé.
 */
import type { MilestoneDef, PaliersState } from '../../shared/milestones';
import { MILESTONES } from '../../shared/milestones';
import { el, fmt, money } from '../dom';
import type { UiPanel, UiPanelApi } from './types';

const SOURCES: Record<string, string> = { croissance: 'Croissance', bonheur: 'Bonheur', objectifs: 'Objectifs', realisations: 'Réalisations', evenements: 'Événements', reprise: 'Acquis (ancienne partie)' };

const emptyState = (): PaliersState => ({
  population: 0, reached: [], title: null, next: MILESTONES[0] ?? null, milestones: MILESTONES.map((m) => ({ ...m, reached: false, at: null })),
  xp: 0, xpBy: {}, xpLastDay: 0, locked: false, locks: null, loanBonus: 0,
});

/** Libellés des déblocages d'un palier (texte court, séparés par des virgules). */
export const unlockList = (m: MilestoneDef): string => m.unlocks.map((u) => u.label).join(', ');

/** Ligne « Prochain palier : X — a / b points » (même texte que le rappel de la barre). */
export function nextMilestoneLine(s: PaliersState): string {
  const nx = s.next;
  return nx ? `Prochain palier : ${nx.nameFr} — ${fmt(s.xp)} / ${fmt(nx.xp)} points` : 'Tous les paliers sont atteints';
}

/** Avancement 0..100 vers le prochain palier (depuis le palier précédent). */
export function nextMilestonePct(s: PaliersState): number {
  const nx = s.next;
  if (!nx) return 100;
  const prev = [...s.milestones].reverse().find((m) => m.reached);
  const from = prev?.xp ?? 0;
  return Math.max(0, Math.min(100, (100 * (s.xp - from)) / Math.max(1, nx.xp - from)));
}

function mountPaliers(root: HTMLElement, api: UiPanelApi): () => void {
  let st: PaliersState | null = (api.snapshotExt() as PaliersState | undefined) ?? null;
  const render = (): void => {
    const s = st ?? emptyState();
    const nx = s.next;
    const head = el('div', { cls: 'kpis' },
      el('div', { cls: 'kpi' }, el('span', { cls: 'lbl', text: 'Titre de la ville' }), el('b', { text: s.title ?? '—' })),
      el('div', { cls: 'kpi' }, el('span', { cls: 'lbl', text: 'Points d’expansion' }), el('b', { text: fmt(s.xp) })));
    const box = el('div', { cls: 'prog-next', attrs: { 'data-next': nx?.id ?? '' } },
      el('div', { cls: 'prog-next-t', text: nextMilestoneLine(s) }),
      el('div', { cls: 'gov-bar' }, el('i', { attrs: { style: `width:${nextMilestonePct(s).toFixed(1)}%` } })));
    if (nx) {
      box.append(el('p', { cls: 'small prog-unlocks' }, el('b', { text: 'Débloque : ' }), `${unlockList(nx) || 'titre de la ville'} ; prime de ${money(nx.reward)}.`));
      box.append(el('p', { cls: 'muted small', text: s.xpLastDay > 0 ? `+${fmt(s.xpLastDay)} points hier (croissance et bonheur), plus les objectifs et réalisations.` : 'Les points viennent de la croissance, du bonheur des habitants, des objectifs et des réalisations.' }));
    }
    const src = Object.entries(s.xpBy).filter(([, v]) => v > 0);
    const sources = src.length
      ? el('div', { cls: 'prog-src' }, ...src.map(([k, v]) => el('span', { cls: 'prog-chip', text: `${SOURCES[k] ?? k} ${fmt(v)}` })))
      : null;
    const mode = el('p', { cls: 'muted small', text: s.locked
      ? 'Déblocages progressifs : ce qui n’est pas encore débloqué porte un cadenas et le nom du palier requis (bâtiments, zones, politiques, niveaux d’amélioration, lignes de bus).'
      : 'Mode libre : tout est déjà accessible ; chaque palier verse sa prime et augmente la capacité d’emprunt.' });
    const list = el('div', { cls: 'gov-list' });
    for (const m of s.milestones) {
      const status = m.reached ? '✓ Atteint' : nx?.id === m.id ? 'En cours' : `${fmt(m.xp)} pts`;
      list.append(el('div', { cls: `gov-card prog-ms${m.reached ? ' on' : ''}`, attrs: { 'data-milestone': m.id } },
        el('div', { cls: 'gov-top' }, el('b', { text: m.nameFr }), el('span', { cls: 'muted small', text: status })),
        el('span', { cls: 'muted small', text: `${fmt(m.xp)} points · prime ${money(m.reward)}` }),
        m.unlocks.length ? el('p', { cls: 'small', text: unlockList(m) }) : null));
    }
    root.replaceChildren(head, box, sources ?? '', mode, s.loanBonus > 0 ? el('p', { cls: 'muted small', text: `Capacité d’emprunt acquise grâce aux paliers : +${money(s.loanBonus)}.` }) : '', list);
  };
  render();
  api.command('state').then((r) => { st = r as PaliersState; render(); }).catch(() => undefined);
  return api.onDeltaExt((p) => { if (p) { st = p as PaliersState; render(); } });
}

export const paliersPanel: UiPanel = { id: 'paliers', title: 'Paliers', phase: '2C', mount: mountPaliers };
