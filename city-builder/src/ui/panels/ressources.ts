/**
 * Panneau du module « Ressources » (registre UI_PANELS) : bois et nourriture des zones spécialisées (production,
 * consommation, exportations), état de la forêt exploitée (stock, cases déboisées et repoussées), fermes, zone
 * mixte, recette municipale. Données : `snapshot.ext.ressources`, `delta.ext.ressources`, commande `state`.
 */
import type { ResourceFlow, RessourcesSnapshot, RessourcesStats } from '../../shared/protocol-ext/ressources';
import { el } from '../dom';
import type { UiPanel } from './types';

const n1 = (v: number): string => (Math.round(v * 10) / 10).toLocaleString('fr-CH');
const chf = (v: number): string => `${Math.round(v).toLocaleString('fr-CH')} CHF`;

function flowRow(label: string, unit: string, f: ResourceFlow): HTMLElement {
  return el('tr', {},
    el('td', { text: label }),
    el('td', { text: `${n1(f.production)} ${unit}` }),
    el('td', { text: `${n1(f.consumption)} ${unit}` }),
    el('td', { text: f.exported > 0 ? `+${n1(f.exported)}` : f.imported > 0 ? `−${n1(f.imported)}` : '0' }));
}

export const ressourcesPanel: UiPanel = {
  id: 'ressources',
  title: 'Ressources',
  phase: '2B',
  mount(root, api) {
    let stats: RessourcesStats | null = (api.snapshotExt() as RessourcesSnapshot | undefined)?.stats ?? null;
    const draw = (): void => {
      const s = stats;
      if (!s) {
        root.replaceChildren(el('p', { cls: 'muted', text: 'Aucune zone spécialisée : peignez une zone Forêt, Agricole ou Mixte (onglet Zones).' }));
        return;
      }
      root.replaceChildren(el('div', { cls: 'zn-panel' },
        el('table', {},
          el('tr', {}, el('th', { text: 'Par jour' }), el('th', { text: 'Production' }), el('th', { text: 'Consommation' }), el('th', { text: 'Export / import' })),
          flowRow('Bois', 'm³', s.bois),
          flowRow('Nourriture', 't', s.nourriture)),
        el('p', { cls: 'muted', text: `Forêt exploitée : ${s.foret.exploitations} exploitation(s), ${s.foret.cells} cases, stock ${Math.round(s.foret.stock * 100)} % · ${s.foret.deboisees} cases déboisées, ${s.foret.repoussees} repoussées` }),
        el('p', { cls: 'muted', text: `Agricole : ${s.agricole.fermes} ferme(s), ${s.agricole.champs} cases, fertilité ${Math.round(s.agricole.fertilite * 100)} %` }),
        el('p', { cls: 'muted', text: `Mixte : ${s.mixte.batiments} bâtiment(s), ${s.mixte.logements} habitants, ${s.mixte.emplois} emplois de commerce` }),
        el('p', { cls: 'muted', text: `Recette des exportations : ${chf(s.recetteMois)} ce mois (${chf(s.recetteMoisPrecedent)} le mois dernier)` }),
      ));
    };
    const unsub = api.onDeltaExt((p) => { const d = p as { stats?: RessourcesStats } | undefined; if (d?.stats) { stats = d.stats; draw(); } });
    void api.command('state').then((r) => { const snap = r as RessourcesSnapshot | undefined; if (snap?.stats) stats = snap.stats; }).catch(() => undefined).finally(draw);
    draw();
    return unsub;
  },
};
