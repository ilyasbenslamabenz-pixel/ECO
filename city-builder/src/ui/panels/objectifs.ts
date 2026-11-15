/**
 * Panneau « Objectifs » (tableau de bord Progression) : objectifs en cours (avancement, tenue, récompense, conseil,
 * « Voir » et « Autre objectif »), derniers objectifs accomplis et réalisations. Données du module `objectifs`.
 */
import { openView } from '../../client/progression-view';
import type { ObjectiveView, ObjectifsState } from '../../shared/protocol-ext/objectifs';
import { el, fmt, money } from '../dom';
import type { UiPanel, UiPanelApi } from './types';

const errText = (e: unknown): string => (e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e));

/** Valeur d'un objectif dans son unité (« 7,2 % », « 450 voyageurs/jour », « −12 000 CHF »). */
export function objValue(v: number, unit: string): string {
  if (unit === 'CHF') return money(v);
  if (unit.startsWith('%')) return `${v.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} ${unit}`;
  if (unit === '/100') return `${v.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}/100`;
  return `${fmt(v)} ${unit}`;
}

/** « 7,2 % → sous 5 % » : valeur actuelle et cible. */
export function objProgressText(o: ObjectiveView): string {
  const target = o.unit === 'CHF' ? 'solde positif' : `${o.higher ? '' : 'sous '}${objValue(o.target, o.unit)}`;
  return `${objValue(o.current, o.unit)} → ${target}`;
}

export function objStreakText(o: ObjectiveView): string {
  return o.streakNeeded > 1 ? `Tenu ${o.streak} / ${o.streakNeeded} ${o.streakUnit}` : '';
}

function mountObjectifs(root: HTMLElement, api: UiPanelApi): () => void {
  let st: ObjectifsState | null = (api.snapshotExt() as ObjectifsState | undefined) ?? null;
  const render = (): void => {
    if (!st) {
      root.replaceChildren(el('p', { cls: 'muted small', text: 'Les objectifs arrivent dès que la ville compte 150 habitants : ils s’adaptent à ses problèmes du moment et récompensent en argent et en points d’expansion.' }));
      return;
    }
    const s = st;
    const doneAch = s.achievements.filter((a) => a.done).length;
    const head = el('div', { cls: 'kpis' },
      el('div', { cls: 'kpi' }, el('span', { cls: 'lbl', text: 'Objectifs accomplis' }), el('b', { text: fmt(s.completedCount) })),
      el('div', { cls: 'kpi' }, el('span', { cls: 'lbl', text: 'Réalisations' }), el('b', { text: `${doneAch} / ${s.achievements.length}` })));
    const list = el('div', { cls: 'gov-list' });
    if (!s.active.length) list.append(el('p', { cls: 'muted small', text: 'Aucun objectif en cours : un nouvel objectif est proposé au plus tous les deux jours de jeu.' }));
    for (const o of s.active) {
      const voir = el('button', { cls: 'prog-btn primary', text: 'Voir', attrs: { type: 'button', 'data-obj-voir': o.key } });
      voir.addEventListener('click', () => openView(o.dash));
      const other = el('button', { cls: 'prog-btn', text: 'Autre objectif', attrs: { type: 'button', 'data-obj-replace': o.key } });
      other.dataset['tip'] = 'Remplacer cet objectif par un autre (une fois par semaine de jeu)';
      other.addEventListener('click', () => {
        other.disabled = true;
        api.command('remplacer', { key: o.key }).then((r) => { st = r as ObjectifsState; render(); }).catch((e: unknown) => { api.toast(errText(e), 'error'); other.disabled = false; });
      });
      const streak = objStreakText(o);
      list.append(el('div', { cls: 'gov-card prog-obj', attrs: { 'data-objective': o.id } },
        el('b', { cls: 'prog-obj-t', text: o.title }),
        el('div', { cls: 'gov-bar' }, el('i', { attrs: { style: `width:${(o.progress * 100).toFixed(1)}%` } })),
        el('div', { cls: 'prog-obj-row small' }, el('span', { text: objProgressText(o) }), streak ? el('span', { cls: 'muted', text: streak }) : null),
        el('div', { cls: 'small prog-reward', text: `Récompense : ${money(o.rewardMoney)} et ${fmt(o.rewardXp)} points d’expansion` }),
        el('p', { cls: 'muted small', text: o.hint }),
        el('div', { cls: 'prog-actions' }, voir, other)));
    }
    const recent = s.recent.slice(-5).reverse();
    const done = recent.length
      ? el('div', { cls: 'prog-recent' }, ...recent.map((r) => el('div', { cls: 'small' }, el('span', { cls: 'ok-mark', text: '✓ ' }), `${r.title} — ${money(r.rewardMoney)}, ${fmt(r.rewardXp)} pts`)))
      : null;
    const ach = el('div', { cls: 'prog-ach' }, ...s.achievements.map((a) => el('div', { cls: `prog-ach-i${a.done ? ' on' : ''}`, attrs: { 'data-achievement': a.id } },
      el('b', { text: `${a.done ? '✓' : '○'} ${a.title}` }), el('span', { cls: 'muted small', text: `${a.detail} · +${fmt(a.xp)} pts` }))));
    root.replaceChildren(head, el('div', { cls: 'sec-title', text: 'Objectifs en cours' }), list,
      ...(done ? [el('div', { cls: 'sec-title', text: 'Derniers accomplis' }), done] : []),
      el('div', { cls: 'sec-title', text: 'Réalisations' }), ach);
  };
  render();
  api.command('state').then((r) => { st = r as ObjectifsState; render(); }).catch(() => undefined);
  return api.onDeltaExt((p) => { if (p) { st = p as ObjectifsState; render(); } });
}

export const objectifsPanel: UiPanel = { id: 'objectifs', title: 'Objectifs', phase: '2C', mount: mountObjectifs };
