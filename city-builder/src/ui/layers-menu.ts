/**
 * Menu unique des CARTES d'information (bouton « Cartes » de la barre caméra) : une seule carte colorée à la fois,
 * classées par thème, avec légende (dégradé et libellés) et une phrase « ce que ça montre / quoi faire ».
 *  - cartes des modules existants : électricité, eau (desserte, pression, pollution), nuisances des déchets,
 *    trafic, transports en commun, quartiers, criminalité, risque d'incendie, santé ;
 *  - cartes du module « cartes » (vague 5) : valeur foncière, pollution de l'air, bruit, chômage par quartier,
 *    éducation, satisfaction par logement, couverture des écoles, remplissage des bacs à déchets.
 * À part : les icônes de problèmes au-dessus des bâtiments. Chaque entrée pilote le calque de son module ; les
 * panneaux des modules restent synchronisés. Au doigt : boutons ≥ 44 px, légende compacte.
 */
import { powerView } from '../shared/power/view';
import { waterView, type WaterViewMode } from '../render/water-network/view';
import { DECHETS_LAYER_EVENT } from './panels/dechets';
import { setAlertsVisible, alertsVisible } from '../render/plugins/alertes';
import { setSecteursLayer } from '../render/plugins/secteurs';
import { setServicesLayer } from '../render/plugins/services';
import { setBusLayer } from '../render/plugins/bus';
import { carteGradientCss, cartesLastLayer, onCartesLayer, setCartesLayer } from '../render/plugins/cartes';
import type { BusLayer } from '../shared/protocol-ext/bus';
import type { ServicesLayer, ServicesLayerKind } from '../shared/protocol-ext/services';
import { CARTE_PALETTE, type CarteKind, type CarteLayer } from '../shared/protocol-ext/cartes';
import { $, el } from './dom';
import { iconEl } from './icons';

export type LayerId = 'none' | 'power' | 'water' | 'pressure' | 'waterPollution' | 'waste' | 'traffic' | 'transit' | 'districts' | 'crime' | 'fire' | 'health'
  | 'landValue' | 'airPollution' | 'noise' | 'unemployment' | 'education' | 'happiness' | 'schools' | 'wasteBins';
/** Cartes d'information du module « services ». */
const SERVICE_LAYERS: Partial<Record<LayerId, ServicesLayerKind>> = { crime: 'crime', fire: 'fire', health: 'health' };
/** Cartes du module « cartes » (vague 5). */
const CARTE_LAYERS: Partial<Record<LayerId, CarteKind>> = {
  landValue: 'foncier', airPollution: 'pollution', noise: 'bruit', unemployment: 'chomage', education: 'education', happiness: 'satisfaction', schools: 'ecoles', wasteBins: 'dechets',
};

/** Légende : dégradé (palette) ou pastilles, libellés des deux extrémités. */
interface Legend { palette: 'risque' | 'valeur' | 'bleu-rouge' | 'contours'; low: string; high: string }
export interface MapDef { id: LayerId; group: string; label: string; icon: string; what: string; todo: string; legend?: Legend }

/** Cartes, dans l'ordre d'affichage (groupes). Textes propres au jeu. */
export const MAPS: readonly MapDef[] = [
  { id: 'none', group: '', label: 'Aucune', icon: 'eye', what: 'Vue normale de la ville.', todo: '' },
  // Population
  { id: 'happiness', group: 'Habitants', label: 'Satisfaction', icon: 'smile', what: 'Satisfaction moyenne des habitants de chaque logement.', todo: 'Touchez un logement rouge : sa fiche explique pourquoi et quoi faire.', legend: { palette: 'risque', low: 'contents', high: 'mécontents' } },
  { id: 'unemployment', group: 'Habitants', label: 'Chômage', icon: 'people', what: 'Part des actifs sans emploi, par quartier (secteurs, sinon îlots de 500 m).', todo: 'Zonez des emplois à portée des quartiers rouges ou reliez-les par une ligne de bus.', legend: { palette: 'risque', low: '0 %', high: '25 % et plus' } },
  { id: 'education', group: 'Habitants', label: 'Éducation', icon: 'school', what: 'Niveau d’études moyen des adultes de chaque logement.', todo: 'Couvrez les quartiers rouges par des écoles : les bureaux exigent des diplômés.', legend: { palette: 'risque', low: 'études supérieures', high: 'sans diplôme' } },
  { id: 'landValue', group: 'Habitants', label: 'Valeur foncière', icon: 'cash', what: 'Valeur du terrain, qui fixe les loyers : services, équipements, pollution, criminalité.', todo: 'Loyers chers (jaune) : les ménages modestes peinent à payer ; les quartiers bleus manquent de services.', legend: { palette: 'valeur', low: 'basse (loyers faibles)', high: 'élevée (loyers chers)' } },
  // Services
  { id: 'schools', group: 'Services', label: 'Écoles', icon: 'school', what: 'Logements couverts par une école (vert : école proche).', todo: 'Construisez une école au centre des logements rouges.', legend: { palette: 'risque', low: 'école proche', high: 'aucune école' } },
  { id: 'health', group: 'Services', label: 'Santé', icon: 'hospital', what: 'Santé des habitants : pollution, âge, accès aux soins.', todo: 'Construisez un centre de santé près des logements rouges ; éloignez l’industrie.', legend: { palette: 'risque', low: 'bonne', high: 'mauvaise' } },
  { id: 'crime', group: 'Services', label: 'Criminalité', icon: 'police', what: 'Criminalité par bâtiment : chômage, pauvreté, densité, absence de police.', todo: 'Construisez un commissariat près des zones rouges et luttez contre le chômage.', legend: { palette: 'risque', low: 'faible', high: 'élevée' } },
  { id: 'fire', group: 'Services', label: 'Risque d’incendie', icon: 'fire', what: 'Risque d’incendie, prévention des casernes comprise.', todo: 'Construisez une caserne de pompiers près des zones rouges (souvent industrielles).', legend: { palette: 'risque', low: 'faible', high: 'élevé' } },
  { id: 'wasteBins', group: 'Services', label: 'Collecte des déchets', icon: 'truck', what: 'Remplissage des bacs à déchets de chaque bâtiment.', todo: 'Bacs pleins : construisez un dépôt de camions-bennes et une décharge à portée.', legend: { palette: 'risque', low: 'vidés', high: 'pleins' } },
  // Réseaux
  { id: 'power', group: 'Réseaux', label: 'Électricité', icon: 'energy', what: 'Installations, câbles, bâtiments alimentés ou coupés.', todo: 'Bâtiments coupés : raccordez-les, ajoutez une centrale ou achetez au réseau voisin.' },
  { id: 'water', group: 'Réseaux', label: 'Eau : desserte', icon: 'water', what: 'Bâtiments desservis en eau potable.', todo: 'Prolongez les canalisations vers les bâtiments non desservis.' },
  { id: 'pressure', group: 'Réseaux', label: 'Eau : pression', icon: 'pump', what: 'Pression dans les canalisations.', todo: 'Pression faible : ajoutez une pompe ou un château d’eau.' },
  { id: 'waterPollution', group: 'Réseaux', label: 'Eau : pollution', icon: 'treatment', what: 'Pollution des rivières et de la nappe.', todo: 'Traitez les eaux usées et éloignez les captages des rejets.' },
  // Environnement
  { id: 'airPollution', group: 'Environnement', label: 'Pollution de l’air', icon: 'factory', what: 'Pollution subie par chaque bâtiment : industrie proche, centrales, déchets.', todo: 'Éloignez logements et industrie, plantez des parcs, adoptez « Filtres industriels ».', legend: { palette: 'risque', low: 'air sain', high: 'très pollué' } },
  { id: 'noise', group: 'Environnement', label: 'Bruit', icon: 'alert', what: 'Bruit et nuisances : centrales, gares, port, aéroport, décharges.', todo: 'Gardez les logements à distance des sources de bruit.', legend: { palette: 'risque', low: 'calme', high: 'bruyant' } },
  { id: 'waste', group: 'Environnement', label: 'Nuisances des déchets', icon: 'waste', what: 'Nuisances autour des décharges et bacs débordés.', todo: 'Éloignez les décharges des logements ; videz les bacs.' },
  // Déplacements
  { id: 'traffic', group: 'Déplacements', label: 'Trafic (saturation)', icon: 'transport', what: 'Saturation des routes (vert fluide → rouge saturé).', todo: 'Élargissez ou doublez les axes rouges, ajoutez des lignes de bus.', legend: { palette: 'risque', low: 'fluide', high: 'saturé' } },
  { id: 'transit', group: 'Déplacements', label: 'Transports en commun', icon: 'busstop', what: 'Bâtiments à moins de 400 m de marche d’un arrêt en service.', todo: 'Tracez une ligne de bus qui passe près des bâtiments rouges.', legend: { palette: 'bleu-rouge', low: 'bus fréquents', high: 'aucun arrêt' } },
  { id: 'districts', group: 'Territoire', label: 'Quartiers', icon: 'home', what: 'Contours des quartiers et des secteurs (politiques locales).', todo: 'Créez des secteurs pour appliquer des politiques locales.', legend: { palette: 'contours', low: '', high: '' } },
];

export interface LayersPort {
  pluginCommand(plugin: string, name: string, payload?: unknown): Promise<unknown>;
}

const unwrap = <T>(l: unknown): T | null => (l && typeof l === 'object' && 'data' in (l as object) ? (l as { data: T }).data : l as T) ?? null;

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
    if (CARTE_LAYERS[prev] && !CARTE_LAYERS[id]) { setCartesLayer(null); void port.pluginCommand('cartes', 'calque', { kind: null }).catch(() => undefined); }
    if (id === 'transit') {
      setBusLayer(true);
      void port.pluginCommand('bus', 'calque', { on: true }).then((l) => {
        const v = unwrap<BusLayer>(l);
        if (current === 'transit') setBusLayer(true, v && typeof v === 'object' && 'cols' in v ? v : null);
      }).catch(() => undefined);
    }
    if (SERVICE_LAYERS[prev] && !SERVICE_LAYERS[id]) { setServicesLayer(null); void port.pluginCommand('services', 'calque', { on: false }).catch(() => undefined); }
    const sk = SERVICE_LAYERS[id];
    if (sk) {
      setServicesLayer(sk);
      // Réponse du pont : `{ data: carte }` (repli : la carte elle-même).
      void port.pluginCommand('services', 'calque', { on: true }).then((l) => {
        const v = unwrap<ServicesLayer>(l);
        if (current === id) setServicesLayer(sk, v && typeof v === 'object' && 'cols' in v ? v : null);
      }).catch(() => undefined);
    }
    const ck = CARTE_LAYERS[id];
    if (ck) {
      setCartesLayer(ck);
      void port.pluginCommand('cartes', 'calque', { kind: ck }).then((l) => {
        const v = unwrap<CarteLayer>(l);
        if (current === id) setCartesLayer(ck, v && typeof v === 'object' && 'cols' in v ? v : null);
        render();
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
    btn.dataset['map'] = id;
    render();
  };

  /** Légende compacte : dégradé et libellés, résumé de la grille (cartes du module « cartes »). */
  const legendOf = (m: MapDef): HTMLElement | null => {
    const lg = m.legend;
    const box = el('div', { cls: 'map-legend', attrs: { 'data-legend': m.id } });
    if (lg && lg.palette !== 'contours') {
      const grad = lg.palette === 'bleu-rouge' ? 'linear-gradient(90deg, rgb(40, 130, 240), rgb(150, 120, 200), rgb(235, 70, 60))' : carteGradientCss(lg.palette === 'valeur' ? 'valeur' : 'risque');
      box.append(el('div', { cls: 'map-grad', attrs: { style: `background:${grad}`, 'aria-hidden': 'true' } }), el('div', { cls: 'map-ends' }, el('span', { text: lg.low }), el('span', { text: lg.high })));
    }
    const ck = CARTE_LAYERS[m.id];
    const l = ck ? cartesLastLayer() : null;
    if (ck && l && l.kind === ck) {
      const hi = (l.high ?? 0).toLocaleString('fr-FR');
      const avgTxt = CARTE_PALETTE[ck] === 'valeur' ? `${hi} à valeur élevée` : `${hi} en rouge (« ${m.legend?.high ?? 'problème'} »)`;
      box.append(el('p', { cls: 'map-stat muted', text: l.buildings ? `${l.buildings.toLocaleString('fr-FR')} bâtiment(s) · ${avgTxt}` : 'Aucun bâtiment concerné pour l’instant.' }));
    }
    box.append(el('p', { cls: 'map-what', text: m.what }));
    if (m.todo) box.append(el('p', { cls: 'map-todo' }, el('b', { text: 'Quoi faire : ' }), el('span', { text: m.todo })));
    return box;
  };

  const render = (): void => {
    // État réel des calques pilotés aussi ailleurs (panneaux des modules, calques automatiques pendant la pose).
    if (current === 'none' || current === 'power' || current === 'water' || current === 'pressure' || current === 'waterPollution') {
      const wm: Record<string, LayerId> = { desserte: 'water', pression: 'pressure', pollution: 'waterPollution' };
      current = powerView.overlay ? 'power' : wm[waterView.mode] ?? (current === 'power' || wm[waterView.mode] === undefined && current !== 'none' ? 'none' : current);
    }
    const list = el('div', { cls: 'layers-list', attrs: { role: 'radiogroup', 'aria-label': 'Carte d’information' } });
    let group = '';
    for (const m of MAPS) {
      if (m.group !== group) { group = m.group; list.append(el('div', { cls: 'layers-group', text: group })); }
      const on = current === m.id;
      const b = el('button', { cls: `layer-item${on ? ' on' : ''}`, attrs: { type: 'button', role: 'radio', 'aria-checked': String(on), 'data-layer': m.id } }, iconEl(m.icon), el('span', { text: m.label }));
      b.dataset['tip'] = `${m.what}${m.todo ? ` ${m.todo}` : ''}`;
      b.addEventListener('click', () => apply(m.id));
      list.append(b);
    }
    const alerts = el('button', { cls: `layer-item layer-check${alertsVisible() ? ' on' : ''}`, attrs: { type: 'button', role: 'switch', 'aria-checked': String(alertsVisible()), 'data-layer': 'alerts' } }, iconEl('alert'), el('span', { text: 'Icônes de problèmes' }));
    alerts.dataset['tip'] = 'Pastilles au-dessus des bâtiments : sans route, sans électricité, sans eau, poubelles pleines, en feu, ruine, criminalité élevée';
    alerts.addEventListener('click', () => { setAlertsVisible(!alertsVisible()); render(); });
    const def = MAPS.find((m) => m.id === current);
    const legend = def && current !== 'none' ? legendOf(def) : null;
    const scroll = list.scrollTop;
    // Légende en tête (toujours visible sans défiler, même sur iPhone), puis la liste.
    const head = el('div', { cls: 'layers-head' }, el('span', { text: 'Cartes' }), el('span', { cls: 'layers-cur', text: def && current !== 'none' ? def.label : '' }));
    pop.replaceChildren(head, ...(legend ? [legend] : []), list, alerts);
    list.scrollTop = scroll;
  };

  onCartesLayer(() => { if (!pop.classList.contains('hidden') && CARTE_LAYERS[current]) render(); });
  const close = (): void => { pop.classList.add('hidden'); btn.setAttribute('aria-expanded', 'false'); };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = pop.classList.contains('hidden');
    if (open) { render(); pop.classList.remove('hidden'); btn.setAttribute('aria-expanded', 'true'); } else close();
  });
  document.addEventListener('pointerdown', (e) => { if (!pop.classList.contains('hidden') && !pop.contains(e.target as Node) && e.target !== btn && !btn.contains(e.target as Node)) close(); });
  render();
  const handle = { set: apply, current: () => current };
  (window as unknown as { __cartesMenu?: unknown }).__cartesMenu = handle;
  return handle;
}
