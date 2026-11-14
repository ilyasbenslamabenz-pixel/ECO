/**
 * Panneaux « Politiques » et « Recherche » (phase 2C), montés dans les tableaux de bord du menu latéral.
 * Toutes les valeurs viennent des modules de simulation `politiques` et `recherche` (commandes `state`,
 * `toggle`, `start`, `budget`) : aucun chiffre inventé.
 */
import type { PolitiquesState } from '../../sim/plugins/politiques';
import type { RechercheState } from '../../sim/plugins/recherche';
import { el, fmt, money } from '../dom';
import type { UiPanel, UiPanelApi } from './types';

const errText = (e: unknown): string => (e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e));

function mountPolitiques(root: HTMLElement, api: UiPanelApi): () => void {
  let st: PolitiquesState | null = null;
  const render = (): void => {
    if (!st) { root.replaceChildren(el('p', { cls: 'muted small', text: 'Chargement…' })); return; }
    const active = st.policies.filter((p) => p.active);
    const head = el('div', { cls: 'kpis' },
      el('div', { cls: 'kpi' }, el('span', { cls: 'lbl', text: 'Politiques actives' }), el('b', { text: String(active.length) })),
      el('div', { cls: 'kpi' }, el('span', { cls: 'lbl', text: 'Coût mensuel' }), el('b', { text: money(st.totalCost) })));
    const list = el('div', { cls: 'gov-list' });
    for (const p of st.policies) {
      const btn = el('button', { cls: `gov-btn${p.active ? ' on' : ''}`, text: p.active ? 'Abandonner' : 'Adopter', attrs: { type: 'button', 'data-policy': p.id } });
      btn.addEventListener('click', () => {
        btn.disabled = true;
        api.command('toggle', { id: p.id, on: !p.active }).then((r) => { st = r as PolitiquesState; render(); }).catch((e: unknown) => { api.toast(errText(e), 'error'); btn.disabled = false; });
      });
      const cost = p.costPerMonth > 0 || p.costPerResident > 0 ? `${money(p.monthlyCost)} / mois${p.costPerResident ? ` (${fmt(p.costPerResident)} CHF par habitant)` : ''}` : 'Sans coût direct';
      list.append(el('div', { cls: `gov-card${p.active ? ' on' : ''}` },
        el('div', { cls: 'gov-top' }, el('b', { text: p.nameFr }), btn),
        el('p', { cls: 'small', text: p.descFr }),
        el('span', { cls: 'muted small', text: cost })));
    }
    root.replaceChildren(head, el('p', { cls: 'muted small', text: 'Le coût est prélevé chaque mois sur la trésorerie (ligne « Services » des Finances). Les effets s’appliquent tout de suite.' }), list);
  };
  render();
  api.command('state').then((r) => { st = r as PolitiquesState; render(); }).catch((e: unknown) => api.toast(errText(e), 'error'));
  const off = api.onDeltaExt((p) => { if (p) { st = p as PolitiquesState; render(); } });
  return off;
}

function mountRecherche(root: HTMLElement, api: UiPanelApi): () => void {
  let st: RechercheState | null = null;
  const send = (name: string, payload: unknown): void => {
    api.command(name, payload).then((r) => { st = r as RechercheState; render(); }).catch((e: unknown) => api.toast(errText(e), 'error'));
  };
  const render = (): void => {
    if (!st) { root.replaceChildren(el('p', { cls: 'muted small', text: 'Chargement…' })); return; }
    const cur = st.projects.find((p) => p.current) ?? null;
    const head = el('div', { cls: 'kpis' },
      el('div', { cls: 'kpi' }, el('span', { cls: 'lbl', text: 'Points par mois' }), el('b', { text: fmt(st.pointsPerMonth) })),
      el('div', { cls: 'kpi' }, el('span', { cls: 'lbl', text: 'Écoles' }), el('b', { text: fmt(st.schools) })));
    const budgets = el('div', { cls: 'gov-budgets' }, el('span', { cls: 'small', text: 'Budget de recherche :' }));
    for (const b of st.budgets) {
      const btn = el('button', { cls: `gov-chip${st.budget === b ? ' on' : ''}`, text: b ? `${fmt(b / 1000)} k/mois` : 'Aucun', attrs: { type: 'button', 'data-budget': String(b) } });
      btn.addEventListener('click', () => send('budget', { budget: b }));
      budgets.append(btn);
    }
    const progress = cur
      ? el('div', { cls: 'gov-progress' }, el('div', { cls: 'small', text: `En cours : ${cur.nameFr} — ${fmt(st.progress)} / ${fmt(cur.cost)} points (${st.pointsPerMonth > 0 ? `≈ ${Math.max(1, Math.ceil((cur.cost - st.progress) / st.pointsPerMonth))} mois` : 'aucun point produit'})` }),
        el('div', { cls: 'gov-bar' }, el('i', { attrs: { style: `width:${Math.min(100, (100 * st.progress) / cur.cost).toFixed(1)}%` } })))
      : el('p', { cls: 'muted small', text: 'Aucun projet en cours : choisissez-en un ci-dessous.' });
    const list = el('div', { cls: 'gov-list' });
    for (const p of st.projects) {
      const state = p.done ? 'Terminé' : p.current ? 'En cours' : p.available ? '' : 'Verrouillé';
      const card = el('div', { cls: `gov-card${p.done ? ' on' : ''}${!p.available && !p.done ? ' locked' : ''}` },
        el('div', { cls: 'gov-top' }, el('b', { text: p.nameFr }), state ? el('span', { cls: 'muted small', text: state }) : null),
        el('p', { cls: 'small', text: p.descFr }),
        el('span', { cls: 'muted small', text: `${fmt(p.cost)} points${p.requires.length && !p.done ? ` · après : ${p.requires.map((q) => st!.projects.find((x) => x.id === q)?.nameFr ?? q).join(', ')}` : ''}` }));
      if (p.available && !p.current) {
        const b = el('button', { cls: 'gov-btn', text: 'Lancer', attrs: { type: 'button', 'data-research': p.id } });
        b.addEventListener('click', () => send('start', { id: p.id }));
        card.querySelector('.gov-top')!.append(b);
      }
      list.append(card);
    }
    root.replaceChildren(head, budgets, progress,
      el('p', { cls: 'muted small', text: 'Points produits chaque mois par les écoles, la population et le budget de recherche (prélevé sur la trésorerie).' }), list);
  };
  render();
  api.command('state').then((r) => { st = r as RechercheState; render(); }).catch((e: unknown) => api.toast(errText(e), 'error'));
  const off = api.onDeltaExt((p) => { if (p) { st = p as RechercheState; render(); } });
  return off;
}

export const politiquesPanel: UiPanel = { id: 'politiques', title: 'Politiques publiques', phase: '2C', mount: mountPolitiques };
export const recherchePanel: UiPanel = { id: 'recherche', title: 'Recherche', phase: '2C', mount: mountRecherche };
