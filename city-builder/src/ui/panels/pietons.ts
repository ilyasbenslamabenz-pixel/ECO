/**
 * Panneau d'interface du module « Piétons » — propriété de la branche p2a-pietons.
 * Seule cette branche modifie ce fichier. Gabarit : voir ./types.ts. Monté par la refonte d'interface (§1bis) ;
 * en attendant, le compteur du HUD est posé par le rendu (src/render/plugins/pietons.ts).
 * Contenu : compteur de piétons dans la rue, détail par état et par motif, état des feux, coût par tick,
 * réglages (module actif, plafond).
 */
import { deltaExt, snapshotExt } from '../../shared/protocol-ext';
import type { PietonsConfig, PietonsStats } from '../../shared/protocol-ext/pietons';
import type { UiPanel, UiPanelApi } from './types';

const nf = new Intl.NumberFormat('fr-FR');
const ms = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

/** Lignes (libellé, valeur) affichées pour des statistiques (exportée pour les tests). */
export function pietonsRows(s: PietonsStats): [string, string][] {
  return [
    ['Piétons dans la rue', nf.format(s.pietons)],
    ['En marche / à l’arrêt / traversant', `${nf.format(s.enMarche)} / ${nf.format(s.enAttente)} / ${nf.format(s.enTraversee)}`],
    ['Habitants suivis', nf.format(s.marcheurs)],
    ['Trajets : travail · école · courses', `${nf.format(s.motifs.travail)} · ${nf.format(s.motifs.ecole)} · ${nf.format(s.motifs.courses)}`],
    ['Trajets : loisirs · retour · flânerie', `${nf.format(s.motifs.loisirs)} · ${nf.format(s.motifs.retour)} · ${nf.format(s.motifs.flanerie)}`],
    ['Trottoirs', `${nf.format(Math.round(s.graphe.trottoirsM))} m`],
    ['Passages (marqués, à feux)', `${nf.format(s.graphe.passages)} (${nf.format(s.graphe.passagesMarques)}, ${nf.format(s.graphe.passagesRegules)})`],
    ['Feux de la circulation', s.feux ? 'raccordés' : 'non raccordés — traversée prudente'],
    ['Traversées au vert / prudentes', `${nf.format(s.cumul.traverseesAuVert)} / ${nf.format(s.cumul.traverseesPrudentes)}`],
    ['Coût par tick (moy. / p95)', `${ms.format(s.tickMs.moyenne)} / ${ms.format(s.tickMs.p95)} ms`],
  ];
}

function mount(root: HTMLElement, api: UiPanelApi): () => void {
  const table = document.createElement('table');
  table.className = 'kv pietons-stats';
  const form = document.createElement('div');
  form.className = 'pietons-config';
  form.innerHTML = '<label><input type="checkbox" name="actif"> Piétons actifs</label> '
    + '<label>Plafond <input type="number" name="max" min="0" max="20000" step="500" style="width:6em"></label>';
  root.append(table, form);
  const actif = form.querySelector<HTMLInputElement>('input[name=actif]')!;
  const max = form.querySelector<HTMLInputElement>('input[name=max]')!;
  const render = (s: PietonsStats | undefined) => {
    table.replaceChildren(...(s ? pietonsRows(s) : [['Piétons dans la rue', '0'] as [string, string]]).map(([k, v]) => {
      const tr = document.createElement('tr');
      const th = document.createElement('th'); th.textContent = k;
      const td = document.createElement('td'); td.textContent = v;
      tr.append(th, td);
      return tr;
    }));
  };
  const setConfig = (c: PietonsConfig | undefined) => { if (c) { actif.checked = c.actif; max.value = String(c.maxPietons); } };
  const snap = snapshotExt({ pietons: api.snapshotExt() }, 'pietons');
  render(snap?.stats);
  setConfig(snap?.config);
  const send = (patch: Partial<PietonsConfig>) => {
    api.command('config', patch).then((c) => setConfig(c as PietonsConfig), (e: unknown) => api.toast(String(e instanceof Error ? e.message : e), 'error'));
  };
  actif.addEventListener('change', () => send({ actif: actif.checked }));
  max.addEventListener('change', () => send({ maxPietons: Number(max.value) }));
  const off = api.onDeltaExt((payload) => {
    const d = deltaExt({ pietons: payload }, 'pietons');
    if (d?.stats) render(d.stats);
    if (d?.config) setConfig(d.config);
  });
  return off;
}

export const pietonsPanel: UiPanel = { id: 'pietons', title: 'Piétons', phase: '2A', mount };
