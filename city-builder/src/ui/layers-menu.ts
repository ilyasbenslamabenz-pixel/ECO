/**
 * Menu unique des calques (bouton « Calques » de la barre caméra) : une seule carte thématique à la fois
 * (électricité, eau, pression, pollution de l'eau, nuisances des déchets, congestion, quartiers, criminalité,
 * risque d'incendie, santé) et, à part,
 * les icônes de problèmes au-dessus des bâtiments. Chaque entrée pilote le calque existant de son module
 * (aucun calque nouveau, aucun chiffre inventé) ; les panneaux des modules restent synchronisés.
 */
import { powerView } from '../shared/power/view';
import { waterView, type WaterViewMode } from '../render/water-network/view';
import { DECHETS_LAYER_EVENT } from './panels/dechets';
import { setAlertsVisible, alertsVisible } from '../render/plugins/alertes';
import { setSecteursLayer } from '../render/plugins/secteurs';
import { SERVICES_LEGEND, setServicesLayer } from '../render/plugins/services';
import { setBusLayer } from '../render/plugins/bus';
import type { BusLayer } from '../shared/protocol-ext/bus';
import type { ServicesLayer, ServicesLayerKind } from '../shared/protocol-ext/services';
import { $, el } from './dom';
import { iconEl } from './icons';

export type LayerId = 'none' | 'power' | 'water' | 'pressure' | 'waterPollution' | 'waste' | 'traffic' | 'transit' | 'districts' | 'crime' | 'fire' | 'health';
/** Cartes d'information du module « services ». */
const SERVICE_LAYERS: Partial<Record<LayerId, ServicesLayerKind>> = { crime: 'crime', fire: 'fire', health: 'health' };

const LAYERS: readonly { id: LayerId; label: string; icon: string; tip: string }[] = [
  { id: 'none', label: 'Aucun', icon: 'eye', tip: 'Vue normale de la ville' },
  { id: 'power', label: 'Électricité', icon: 'energy', tip: 'Réseau électrique : installations, câbles, bâtiments alimentés ou coupés' },
  { id: 'water', label: 'Eau : desserte', icon: 'water', tip: 'Bâtiments desservis en eau potable' },
  { id: 'pressure', label: 'Eau : pression', icon: 'pump', tip: 'Pression dans les canalisations' },
  { id: 'waterPollution', label: 'Eau : pollution', icon: 'treatment', tip: 'Pollution des rivières et de la nappe' },
  { id: 'waste', label: 'Déchets', icon: 'waste', tip: 'Nuisances des déchets et remplissage des bacs' },
  { id: 'traffic', label: 'Circulation', icon: 'transport', tip: 'Congestion des routes (vert fluide → rouge saturé)' },
  { id: 'transit', label: 'Transports en commun', icon: 'busstop', tip: 'Desserte en bus : bâtiments à moins de 400 m de marche d’un arrêt en service (bleu : bien desservi, rouge : sans arrêt)' },
  { id: 'districts', label: 'Quartiers', icon: 'home', tip: 'Contours des quartiers et des secteurs (politiques locales)' },
  { id: 'crime', label: 'Criminalité', icon: 'police', tip: 'Criminalité par bâtiment (vert faible → rouge élevée) : chômage, pauvreté, densité, absence de police' },
  { id: 'fire', label: 'Risque d’incendie', icon: 'fire', tip: 'Risque d’incendie par bâtiment, prévention des casernes comprise (rouge : risque élevé, souvent hors de portée des pompiers)' },
  { id: 'health', label: 'Santé', icon: 'hospital', tip: 'Santé des habitants (vert bonne → rouge mauvaise) : pollution, âge, accès aux soins' },
];

export interface LayersPort {
  pluginCommand(plugin: string, name: string, payload?: unknown): Promise<unknown>;
}

export function initLayersMenu(port: LayersPort): { set(id: LayerId): void; current(): LayerId } {
  let current: LayerId = 'none';
  const btn = $('btn-layers');
  const pop = $('layers-pop');

  const apply = (id: LayerId): void => {
    const prev = current;
    current = id;
    // Éteint le calque précédent, puis allume le nouveau.
    if (prev === 'power' && id !== 'power') powerView.setOverlay(false);
    if ((prev === 'water' || prev === 'pressure' || prev === 'waterPollution') && !(id === 'water' || id === 'pressure' || id === 'waterPollution')) waterView.set('off');
    if (prev === 'waste' && id !== 'waste') window.dispatchEvent(new CustomEvent(DECHETS_LAYER_EVENT, { detail: { visible: false } }));
    if (prev === 'traffic' && id !== 'traffic') void port.pluginCommand('circulation', 'afficherCongestion', { on: false }).catch(() => undefined);
    if (prev === 'districts' && id !== 'districts') { void port.pluginCommand('batiments', 'setOverlay', { on: false }).catch(() => undefined); setSecteursLayer(false); }
    if (prev === 'transit' && id !== 'transit') { setBusLayer(false); void port.pluginCommand('bus', 'calque', { on: false }).catch(() => undefined); }
    if (id === 'transit') {
      setBusLayer(true);
      void port.pluginCommand('bus', 'calque', { on: true }).then((l) => {
        const v = (l && typeof l === 'object' && 'data' in l ? (l as { data: unknown }).data : l) as BusLayer | null;
        if (current === 'transit') setBusLayer(true, v && typeof v === 'object' && 'cols' in v ? v : null);
      }).catch(() => undefined);
    }
    if (SERVICE_LAYERS[prev] && !SERVICE_LAYERS[id]) { setServicesLayer(null); void port.pluginCommand('services', 'calque', { on: false }).catch(() => undefined); }
    const sk = SERVICE_LAYERS[id];
    if (sk) {
      setServicesLayer(sk);
      // Réponse du pont : `{ data: carte }` (repli : la carte elle-même).
      void port.pluginCommand('services', 'calque', { on: true }).then((l) => {
        const v = (l && typeof l === 'object' && 'data' in l ? (l as { data: unknown }).data : l) as ServicesLayer | null;
        if (current === id) setServicesLayer(sk, v && typeof v === 'object' && 'cols' in v ? v : null);
      }).catch(() => undefined);
    }
    if (id === 'power') powerView.setOverlay(true);
    const wm: Partial<Record<LayerId, WaterViewMode>> = { water: 'desserte', pressure: 'pression', waterPollution: 'pollution' };
    if (wm[id]) waterView.set(wm[id]!);
    if (id === 'waste') window.dispatchEvent(new CustomEvent(DECHETS_LAYER_EVENT, { detail: { visible: true } }));
    if (id === 'traffic') void port.pluginCommand('circulation', 'afficherCongestion', { on: true }).catch(() => undefined);
    if (id === 'districts') { void port.pluginCommand('batiments', 'setOverlay', { on: true }).catch(() => undefined); setSecteursLayer(true); }
    btn.classList.toggle('active', id !== 'none');
    btn.setAttribute('aria-pressed', String(id !== 'none'));
    render();
  };

  const render = (): void => {
    // État réel des calques pilotés aussi ailleurs (panneaux des modules, calques automatiques pendant la pose).
    if (current === 'none' || current === 'power' || current === 'water' || current === 'pressure' || current === 'waterPollution') {
      const wm: Record<string, LayerId> = { desserte: 'water', pression: 'pressure', pollution: 'waterPollution' };
      current = powerView.overlay ? 'power' : wm[waterView.mode] ?? (current === 'power' || wm[waterView.mode] === undefined && current !== 'none' ? 'none' : current);
    }
    const list = el('div', { cls: 'layers-list', attrs: { role: 'radiogroup', 'aria-label': 'Carte thématique' } });
    for (const l of LAYERS) {
      const b = el('button', { cls: `layer-item${current === l.id ? ' on' : ''}`, attrs: { type: 'button', role: 'radio', 'aria-checked': String(current === l.id), 'data-layer': l.id } }, iconEl(l.icon), el('span', { text: l.label }));
      b.dataset['tip'] = l.tip;
      b.addEventListener('click', () => apply(l.id));
      list.append(b);
    }
    const alerts = el('button', { cls: `layer-item layer-check${alertsVisible() ? ' on' : ''}`, attrs: { type: 'button', role: 'switch', 'aria-checked': String(alertsVisible()), 'data-layer': 'alerts' } }, iconEl('alert'), el('span', { text: 'Icônes de problèmes' }));
    alerts.dataset['tip'] = 'Pastilles au-dessus des bâtiments : sans route, sans électricité, sans eau, poubelles pleines, en feu, ruine, criminalité élevée';
    alerts.addEventListener('click', () => { setAlertsVisible(!alertsVisible()); render(); });
    const sk = SERVICE_LAYERS[current];
    const transitLegend = current === 'transit' ? el('div', { cls: 'layers-legend small', attrs: { 'data-legend': 'transit' } },
      el('span', { cls: 'muted', text: 'Arrêt à moins de 400 m : ' }), el('span', { cls: 'neg', text: 'aucun' }), el('span', { text: ' → ' }), el('span', { cls: 'pos', text: 'bus fréquents' })) : null;
    const legend = transitLegend ?? (sk ? el('div', { cls: 'layers-legend small', attrs: { 'data-legend': sk } },
      el('span', { cls: 'muted', text: `${SERVICES_LEGEND[sk].title} : ` }),
      el('span', { cls: 'pos', text: SERVICES_LEGEND[sk].low }), el('span', { text: ' → ' }), el('span', { cls: 'neg', text: SERVICES_LEGEND[sk].high })) : null);
    pop.replaceChildren(el('div', { cls: 'layers-head', text: 'Calques' }), list, ...(legend ? [legend] : []), alerts);
  };

  const close = (): void => { pop.classList.add('hidden'); btn.setAttribute('aria-expanded', 'false'); };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = pop.classList.contains('hidden');
    if (open) { render(); pop.classList.remove('hidden'); btn.setAttribute('aria-expanded', 'true'); } else close();
  });
  document.addEventListener('pointerdown', (e) => { if (!pop.classList.contains('hidden') && !pop.contains(e.target as Node) && e.target !== btn && !btn.contains(e.target as Node)) close(); });
  render();
  return { set: apply, current: () => current };
}
