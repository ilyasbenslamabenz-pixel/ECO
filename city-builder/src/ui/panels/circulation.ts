/**
 * Panneau d'interface du module « Circulation (véhicules, feux) » — propriété de la branche p2a-circulation.
 *
 * Contenu : indicateurs du trafic (véhicules, vitesse moyenne, arrêts, réacheminements, changements de voie),
 * part du réseau saturée, bouton d'affichage de la carte de congestion et réglage du réacheminement.
 * Le montage reste optionnel : le registre des panneaux n'est pas encore affiché (refonte d'interface §1bis) ;
 * `mount` est écrit pour fonctionner tel quel dès que la barre latérale l'appellera.
 * `formatCirculation` est pur (testé sans DOM).
 */
import { CONGESTION_COLORS, type CirculationDelta, type CirculationStats } from '../../shared/protocol-ext/circulation';
import type { UiPanel, UiPanelApi } from './types';

/** Lignes affichées par le panneau (valeurs déjà formatées en français). */
export function formatCirculation(s: CirculationStats): { label: string; value: string }[] {
  const pct = s.networkMeters > 0 ? (s.congestedMeters / s.networkMeters) * 100 : 0;
  const nf = (v: number): string => v.toLocaleString('fr-FR');
  return [
    { label: 'Véhicules en circulation', value: nf(s.vehicles) },
    { label: 'Vitesse moyenne', value: `${s.meanSpeedKmh.toFixed(1)} km/h` },
    { label: 'À l’arrêt', value: `${nf(s.stopped)} (${s.vehicles > 0 ? Math.round((s.stopped / s.vehicles) * 100) : 0} %)` },
    { label: 'Réseau saturé', value: `${pct.toFixed(1)} % (${(s.congestedMeters / 1000).toFixed(1)} km)` },
    { label: 'Trajets terminés', value: nf(s.arrived) },
    { label: 'Changements de voie', value: `${nf(s.laneChanges)} (dont ${nf(s.mandatoryLaneChanges)} de présélection)` },
    { label: 'Réacheminements', value: nf(s.rerouted) },
    { label: 'Déblocages', value: `${nf(s.unblocked)} (${nf(s.removedStuck)} retirés)` },
    { label: 'Carrefours', value: `${nf(s.signals)} à feux, ${nf(s.priorityJunctions)} prioritaires, ${nf(s.yieldJunctions)} cédez-le-passage` },
    { label: 'Bâtiments reliés', value: nf(s.connectedBuildings) },
  ];
}

/** Légende de la carte de congestion (couleur, libellé). */
export const CONGESTION_LEGEND: { color: string; label: string }[] = [
  { color: CONGESTION_COLORS[0], label: 'Fluide' },
  { color: CONGESTION_COLORS[1], label: 'Dense' },
  { color: CONGESTION_COLORS[2], label: 'Saturé' },
  { color: CONGESTION_COLORS[3], label: 'À l’arrêt' },
];

export const circulationPanel: UiPanel = {
  id: 'circulation',
  title: 'Circulation (véhicules, feux)',
  phase: '2A',

  mount(root: HTMLElement, api: UiPanelApi): () => void {
    const doc = root.ownerDocument;
    const table = doc.createElement('dl');
    table.className = 'panneau-circulation-indicateurs';
    const rows = new Map<string, HTMLElement>();
    const render = (stats: CirculationStats): void => {
      for (const { label, value } of formatCirculation(stats)) {
        let dd = rows.get(label);
        if (!dd) {
          const dt = doc.createElement('dt');
          dt.textContent = label;
          dd = doc.createElement('dd');
          table.append(dt, dd);
          rows.set(label, dd);
        }
        if (dd.textContent !== value) dd.textContent = value;
      }
    };

    const legend = doc.createElement('ul');
    legend.className = 'panneau-circulation-legende';
    for (const { color, label } of CONGESTION_LEGEND) {
      const li = doc.createElement('li');
      const pastille = doc.createElement('span');
      pastille.className = 'pastille';
      pastille.style.background = color;
      li.append(pastille, doc.createTextNode(` ${label}`));
      legend.append(li);
    }

    const carte = doc.createElement('button');
    carte.type = 'button';
    let on = false;
    const majCarte = (): void => {
      carte.textContent = on ? 'Masquer la carte de congestion' : 'Afficher la carte de congestion';
      carte.setAttribute('aria-pressed', String(on));
      legend.hidden = !on;
    };
    majCarte();
    carte.addEventListener('click', () => {
      on = !on;
      majCarte();
      void api.command('afficherCongestion', { on }).catch((e: unknown) => {
        on = !on; majCarte();
        api.toast(`Carte de congestion : ${e instanceof Error ? e.message : String(e)}`, 'error');
      });
    });

    const reroute = doc.createElement('label');
    const caseAC = doc.createElement('input');
    caseAC.type = 'checkbox';
    caseAC.checked = true;
    caseAC.addEventListener('change', () => {
      void api.command('reglages', { reroute: caseAC.checked }).catch(() => { caseAC.checked = !caseAC.checked; });
    });
    reroute.append(caseAC, doc.createTextNode(' Réacheminement selon la congestion'));

    root.append(table, carte, legend, reroute);

    const first = api.snapshotExt() as { stats?: CirculationStats } | undefined;
    if (first?.stats) render(first.stats);
    const off = api.onDeltaExt((payload) => {
      const d = payload as CirculationDelta;
      if (d?.stats) render(d.stats);
    });
    return () => { off(); root.replaceChildren(); };
  },
};
