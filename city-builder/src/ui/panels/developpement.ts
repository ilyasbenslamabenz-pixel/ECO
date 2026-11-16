/**
 * Panneau « Développement » (tableau de bord Progression) : points de développement gagnés aux paliers et arbres par
 * domaine (électricité, eau, transports, santé, éducation, police). Données du module de simulation `developpement`
 * (commandes `state`, `unlock`, deltas) : aucun chiffre inventé.
 */
import type { DevelopmentState } from '../../shared/development';
import { el, fmt } from '../dom';
import type { UiPanel, UiPanelApi } from './types';

const errText = (e: unknown): string => (e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e));

function mountDeveloppement(root: HTMLElement, api: UiPanelApi): () => void {
  let st: DevelopmentState | null = (api.snapshotExt() as DevelopmentState | undefined) ?? null;
  let domain: string | null = null;
  const send = (name: string, payload: unknown): void => {
    api.command(name, payload).then((r) => { st = r as DevelopmentState; render(); }).catch((e: unknown) => api.toast(errText(e), 'error'));
  };
  const render = (): void => {
    if (!st) { root.replaceChildren(el('p', { cls: 'muted small', text: 'Chargement…' })); return; }
    const s = st;
    const head = el('div', { cls: 'kpis' },
      el('div', { cls: 'kpi' }, el('span', { cls: 'lbl', text: 'Points à dépenser' }), el('b', { text: fmt(s.available) })),
      el('div', { cls: 'kpi' }, el('span', { cls: 'lbl', text: 'Gagnés / dépensés' }), el('b', { text: `${fmt(s.earned)} / ${fmt(s.spent)}` })));
    const hint = el('p', { cls: 'muted small', text: s.nextMilestone
      ? `Chaque palier rapporte des points de développement : le prochain (« ${s.nextMilestone} ») en donnera ${fmt(s.nextPoints)}. Une amélioration débloquée est permanente.`
      : 'Tous les paliers sont atteints. Une amélioration débloquée est permanente.' });
    if (!domain || !s.domains.some((d) => d.id === domain)) domain = s.domains[0]?.id ?? null;
    const tabs = el('div', { cls: 'gov-budgets dev-tabs', attrs: { role: 'tablist' } });
    for (const d of s.domains) {
      const b = el('button', { cls: `gov-chip${d.id === domain ? ' on' : ''}`, text: `${d.nameFr} ${d.unlocked}/${d.total}`, attrs: { type: 'button', role: 'tab', 'aria-selected': String(d.id === domain), 'data-dev-domain': d.id } });
      b.addEventListener('click', () => { domain = d.id; render(); });
      tabs.append(b);
    }
    const list = el('div', { cls: 'gov-list' });
    for (const n of s.nodes.filter((x) => x.domain === domain)) {
      const status = n.unlocked ? '✓ Débloqué' : n.available ? '' : 'Verrouillé';
      const card = el('div', { cls: `gov-card dev-node${n.unlocked ? ' on' : ''}${!n.available && !n.unlocked ? ' locked' : ''}`, attrs: { 'data-dev-node': n.id } },
        el('div', { cls: 'gov-top' }, el('b', { text: n.nameFr }), status ? el('span', { cls: 'muted small', text: status }) : null),
        el('p', { cls: 'small', text: n.descFr }),
        el('span', { cls: 'muted small', text: `${fmt(n.cost)} point${n.cost > 1 ? 's' : ''}${n.requires.length && !n.unlocked ? ` · après : ${n.requires.map((q) => s.nodes.find((x) => x.id === q)?.nameFr ?? q).join(', ')}` : ''}` }));
      if (n.available) {
        const b = el('button', { cls: 'gov-btn', text: n.affordable ? 'Débloquer' : `${fmt(n.cost)} pts requis`, attrs: { type: 'button', 'data-dev-unlock': n.id } });
        if (!n.affordable) { b.classList.add('locked'); b.dataset['tip'] = 'Points insuffisants : franchissez le prochain palier'; }
        b.addEventListener('click', () => {
          if (!n.affordable) { api.toast(`${n.nameFr} : ${fmt(n.cost)} points requis, ${fmt(s.available)} disponible(s)`, 'info'); return; }
          b.disabled = true;
          send('unlock', { id: n.id });
        });
        card.querySelector('.gov-top')!.append(b);
      }
      list.append(card);
    }
    root.replaceChildren(head, hint, tabs, list);
  };
  render();
  api.command('state').then((r) => { st = r as DevelopmentState; render(); }).catch(() => undefined);
  return api.onDeltaExt((p) => { if (p) { st = p as DevelopmentState; render(); } });
}

export const developpementPanel: UiPanel = { id: 'developpement', title: 'Développement', phase: '2C', mount: mountDeveloppement };
