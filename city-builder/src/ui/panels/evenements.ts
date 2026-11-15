/**
 * Panneau « Événements » (tableau de bord Progression) : événement annoncé ou en cours (dates, effets chiffrés, que
 * faire, « Voir »), réglage de fréquence (Options) et historique. Données du module `evenements`.
 */
import { openView } from '../../client/progression-view';
import { EVENT_FREQUENCY_LABELS, type EvenementsState } from '../../shared/protocol-ext/evenements';
import { el } from '../dom';
import type { UiPanel, UiPanelApi } from './types';

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
/** « 12 juin an 2 » d'une minute de jeu. */
export function gameDay(minute: number): string {
  const d = Math.floor(minute / 1440);
  return `${(d % 30) + 1} ${MONTHS[Math.floor(d / 30) % 12]} an ${Math.floor(d / 360) + 1}`;
}

function mountEvenements(root: HTMLElement, api: UiPanelApi): () => void {
  let st: EvenementsState | null = (api.snapshotExt() as EvenementsState | undefined) ?? null;
  const render = (): void => {
    const s = st;
    const parts: HTMLElement[] = [];
    const c = s?.current ?? null;
    if (c) {
      const voir = el('button', { cls: 'prog-btn primary', text: 'Voir', attrs: { type: 'button', 'data-event-voir': c.kind } });
      voir.addEventListener('click', () => openView(c.dash));
      const when = c.phase === 'annonce' ? `Annoncé : à partir du ${gameDay(c.startsAt)}` : `En cours jusqu’au ${gameDay(c.endsAt)}`;
      parts.push(el('div', { cls: `gov-card prog-event ${c.phase}`, attrs: { 'data-event': c.kind } },
        el('div', { cls: 'gov-top' }, el('b', { text: c.title }), el('span', { cls: `prog-badge ${c.phase}`, text: c.phase === 'annonce' ? 'Annoncé' : 'En cours' })),
        el('div', { cls: 'small', text: when }),
        el('p', { cls: 'small', text: c.text }),
        c.effects.length ? el('ul', { cls: 'prog-effects small' }, ...c.effects.map((e) => el('li', { text: e }))) : null,
        el('p', { cls: 'small prog-advice' }, el('b', { text: 'Que faire : ' }), c.advice),
        el('div', { cls: 'prog-actions' }, voir)));
    } else {
      const quiet = s && s.setting !== 'off' ? ` Prochain événement possible à partir du ${gameDay(s.quietUntil)}.` : '';
      parts.push(el('p', { cls: 'muted small', text: `Aucun événement en cours.${quiet} Chaque événement est annoncé à l’avance, avec ce qu’il faut faire.` }));
    }
    const setting = s?.setting ?? 'normal';
    parts.push(el('p', { cls: 'muted small', text: `Fréquence : ${EVENT_FREQUENCY_LABELS[setting]} (réglable dans Options › Événements).` }));
    if (s?.history.length) {
      parts.push(el('div', { cls: 'sec-title', text: 'Historique' }));
      parts.push(el('div', { cls: 'prog-recent' }, ...[...s.history].reverse().map((h) => el('div', { cls: 'small' }, el('b', { text: `${h.title} ` }), el('span', { cls: 'muted', text: `(${gameDay(h.at)}) ` }), h.outcome))));
    }
    root.replaceChildren(...parts);
  };
  render();
  api.command('state').then((r) => { st = r as EvenementsState; render(); }).catch(() => undefined);
  return api.onDeltaExt((p) => { if (p) { st = p as EvenementsState; render(); } });
}

export const evenementsPanel: UiPanel = { id: 'evenements', title: 'Événements', phase: '2C', mount: mountEvenements };
