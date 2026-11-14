/**
 * Panneau « Paliers » (tableau de bord Ville) : titre actuel, progression vers le prochain palier, liste des
 * paliers avec leur prime. Données du module de simulation `paliers` (commande `state`, deltas).
 */
import type { PaliersState } from '../../shared/milestones';
import { MILESTONES } from '../../shared/milestones';
import { el, fmt, money } from '../dom';
import type { UiPanel, UiPanelApi } from './types';

function mountPaliers(root: HTMLElement, api: UiPanelApi): () => void {
  let st: PaliersState | null = null;
  const render = (): void => {
    const s: PaliersState = st ?? { population: 0, reached: [], title: null, next: MILESTONES[0] ?? null, milestones: MILESTONES.map((m) => ({ ...m, reached: false, at: null })) };
    const prev = [...s.milestones].reverse().find((m) => m.reached);
    const from = prev?.population ?? 0;
    const nx = s.next;
    const pct = nx ? Math.max(0, Math.min(100, (100 * (s.population - from)) / Math.max(1, nx.population - from))) : 100;
    const head = el('div', { cls: 'kpis' },
      el('div', { cls: 'kpi' }, el('span', { cls: 'lbl', text: 'Titre de la ville' }), el('b', { text: s.title ?? '—' })),
      el('div', { cls: 'kpi' }, el('span', { cls: 'lbl', text: 'Habitants' }), el('b', { text: fmt(s.population) })));
    const prog = nx
      ? el('div', { cls: 'gov-progress' }, el('div', { cls: 'small', text: `Prochain palier : ${nx.nameFr} à ${fmt(nx.population)} habitants — prime de ${money(nx.reward)}` }),
        el('div', { cls: 'gov-bar' }, el('i', { attrs: { style: `width:${pct.toFixed(1)}%` } })))
      : el('p', { cls: 'small', text: 'Tous les paliers sont atteints.' });
    const list = el('div', { cls: 'gov-list' });
    for (const m of s.milestones) {
      list.append(el('div', { cls: `gov-card${m.reached ? ' on' : ''}` },
        el('div', { cls: 'gov-top' }, el('b', { text: m.nameFr }), el('span', { cls: 'muted small', text: m.reached ? 'Atteint' : `${fmt(m.population)} hab.` })),
        el('span', { cls: 'muted small', text: `Prime : ${money(m.reward)}` })));
    }
    root.replaceChildren(head, prog, el('p', { cls: 'muted small', text: 'Chaque palier de population atteint pour la première fois verse une prime à la trésorerie.' }), list);
  };
  render();
  api.command('state').then((r) => { st = r as PaliersState; render(); }).catch(() => undefined);
  return api.onDeltaExt((p) => { if (p) { st = p as PaliersState; render(); } });
}

export const paliersPanel: UiPanel = { id: 'paliers', title: 'Paliers', phase: '2C', mount: mountPaliers };
