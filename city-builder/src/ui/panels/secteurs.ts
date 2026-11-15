/**
 * Panneau « Secteurs » (tableau de bord Politiques) : création d'un secteur à l'endroit regardé (taille au choix),
 * politiques locales de chaque secteur (coût par bâtiment), renommage et suppression. Données du module `secteurs`.
 */
import { DISTRICT_POLICIES, type SecteursState } from '../../shared/secteurs';
import { setSecteursHighlight } from '../../render/plugins/secteurs';
import { el, fmt, money } from '../dom';
import type { UiPanel, UiPanelApi } from './types';

const SIZES = [200, 400, 700] as const;
const errText = (e: unknown): string => (e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e));

function cameraTarget(): { x: number; z: number } {
  const p = (window as unknown as { __aube?: { cameraPose?: () => { targetX?: number; targetZ?: number } } }).__aube?.cameraPose?.();
  return { x: p?.targetX ?? 0, z: p?.targetZ ?? 0 };
}

function mountSecteurs(root: HTMLElement, api: UiPanelApi): () => void {
  let st: SecteursState | null = null;
  let size: number = SIZES[1];
  const send = (name: string, payload: unknown): void => {
    api.command(name, payload).then((r) => { st = r as SecteursState; render(); }).catch((e: unknown) => api.toast(errText(e), 'error'));
  };
  const render = (): void => {
    const s = st ?? { secteurs: [], totalCost: 0, max: 24 };
    const head = el('div', { cls: 'kpis' },
      el('div', { cls: 'kpi' }, el('span', { cls: 'lbl', text: 'Secteurs' }), el('b', { text: `${s.secteurs.length} / ${s.max}` })),
      el('div', { cls: 'kpi' }, el('span', { cls: 'lbl', text: 'Coût mensuel' }), el('b', { text: money(s.totalCost) })));
    const sizes = el('div', { cls: 'gov-budgets' }, el('span', { cls: 'small', text: 'Taille :' }));
    for (const z of SIZES) {
      const b = el('button', { cls: `gov-chip${size === z ? ' on' : ''}`, text: `${z} m`, attrs: { type: 'button' } });
      b.addEventListener('click', () => { size = z; render(); });
      sizes.append(b);
    }
    const create = el('button', { cls: 'gov-btn', text: 'Créer un secteur au centre de la vue', attrs: { type: 'button', 'data-secteur-create': '1' } });
    create.addEventListener('click', () => { const c = cameraTarget(); const h = size / 2; send('create', { x0: c.x - h, z0: c.z - h, x1: c.x + h, z1: c.z + h }); });
    const list = el('div', { cls: 'gov-list' });
    for (const d of s.secteurs) {
      const rm = el('button', { cls: 'gov-btn', text: 'Supprimer', attrs: { type: 'button' } });
      rm.addEventListener('click', () => send('remove', { id: d.id }));
      const rn = el('button', { cls: 'gov-btn', text: 'Renommer', attrs: { type: 'button' } });
      rn.addEventListener('click', () => { const n = window.prompt('Nom du secteur', d.name); if (n && n.trim()) send('rename', { id: d.id, name: n }); });
      const pols = el('div', { cls: 'gov-budgets' });
      for (const p of DISTRICT_POLICIES) {
        const on = d.policies.includes(p.id);
        const b = el('button', { cls: `gov-chip${on ? ' on' : ''}`, text: p.nameFr, attrs: { type: 'button', 'data-policy': p.id } });
        b.dataset['tip'] = `${p.descFr} — ${fmt(p.costPerBuilding)} CHF par bâtiment et par mois`;
        b.addEventListener('click', () => send('toggle', { id: d.id, policy: p.id, on: !on }));
        pols.append(b);
      }
      list.append(el('div', { cls: `gov-card${d.policies.length ? ' on' : ''}` },
        el('div', { cls: 'gov-top' }, el('b', { text: d.name }), el('span', { cls: 'muted small', text: `${fmt(d.buildings)} bâtiments · ${money(d.monthlyCost)} / mois` })),
        pols,
        el('div', { cls: 'gov-top' }, rn, rm)));
    }
    root.replaceChildren(head,
      el('p', { cls: 'muted small', text: 'Un secteur regroupe les bâtiments d’une zone : ses politiques ne s’appliquent qu’à eux (coût par bâtiment, prélevé chaque mois). Contours visibles sur la carte pendant que ce panneau est ouvert.' }),
      sizes, create, list);
  };
  render();
  setSecteursHighlight(true);
  api.command('state').then((r) => { st = r as SecteursState; render(); }).catch(() => undefined);
  const off = api.onDeltaExt((p) => { if (p) { st = p as SecteursState; render(); } });
  return () => { off(); setSecteursHighlight(false); };
}

export const secteursPanel: UiPanel = { id: 'secteurs', title: 'Secteurs', phase: '2C', mount: mountSecteurs };
