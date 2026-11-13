/**
 * Panneau d'interface du module « Bâtiments & quartiers » — propriété de la branche p2a-batiments.
 *
 * Contenu : liste des quartiers suivis (type, bâtiments, diversité, valeur, stade), propositions d'évolution
 * (appliquer / écarter), bascules « contours des quartiers » et « évolution automatique », formulaire de
 * planification (type, centre, dimensions, graine) affichant le résumé du plan calculé par la simulation.
 * Aucun accès direct à la simulation : tout passe par `UiPanelApi.command` (commande `pluginCommand`).
 * Le DOM est créé via `root.ownerDocument` (aucun `document` global : le panneau est montable hors page).
 */
import type { UiPanel, UiPanelApi } from './types';

const TYPES: [string, string][] = [
  ['centre_historique', 'Centre historique'],
  ['faubourg', 'Faubourg'],
  ['pavillonnaire', 'Pavillonnaire'],
  ['affaires', 'Quartier d\'affaires'],
  ['activites', 'Zone d\'activités'],
  ['grands_ensembles', 'Grands ensembles'],
];

interface DistrictRow {
  id: number; nameFr: string; buildings: number; distinctAssets: number; repetitionIndex: number;
  value: number; stage: number; residents: number; capacity: number;
}
interface ProposalRow { id: number; kind: string; reason: string; cost: number }
interface Payload { overlay?: boolean; autoEvolve?: boolean; districts?: DistrictRow[]; proposals?: ProposalRow[] }

export const batimentsPanel: UiPanel = {
  id: 'batiments',
  title: 'Bâtiments & quartiers',
  phase: '2A',

  mount(root: HTMLElement, api: UiPanelApi): () => void {
    const doc = root.ownerDocument;
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
      const n = doc.createElement(tag);
      if (cls) n.className = cls;
      if (text !== undefined) n.textContent = text;
      return n;
    };

    const wrap = el('div', 'panel-batiments');
    const options = el('div', 'quartiers-options');
    const overlay = el('input');
    overlay.type = 'checkbox';
    overlay.id = 'quartiers-overlay';
    const overlayLabel = el('label', undefined, 'Contours des quartiers');
    overlayLabel.htmlFor = overlay.id;
    const auto = el('input');
    auto.type = 'checkbox';
    auto.id = 'quartiers-auto';
    const autoLabel = el('label', undefined, 'Évolution automatique');
    autoLabel.htmlFor = auto.id;
    options.append(overlay, overlayLabel, auto, autoLabel);

    // Formulaire de planification.
    const form = el('form', 'quartiers-form');
    const type = el('select');
    for (const [value, label] of TYPES) {
      const o = el('option', undefined, label);
      o.value = value;
      type.append(o);
    }
    const mkNum = (name: string, value: number, label: string): HTMLInputElement => {
      const i = el('input');
      i.type = 'number';
      i.name = name;
      i.value = String(value);
      i.title = label;
      i.setAttribute('aria-label', label);
      return i;
    };
    const fx = mkNum('x', 0, 'Centre X (m)');
    const fz = mkNum('z', 0, 'Centre Z (m)');
    const fw = mkNum('width', 320, 'Largeur (m)');
    const fd = mkNum('depth', 240, 'Profondeur (m)');
    const fs = mkNum('seed', 1, 'Graine');
    const plan = el('button', undefined, 'Calculer un plan');
    plan.type = 'submit';
    const build = el('button', undefined, 'Construire');
    build.type = 'button';
    form.append(type, fx, fz, fw, fd, fs, plan, build);

    const summary = el('p', 'quartiers-resume', 'Aucun plan calculé.');
    const list = el('ul', 'quartiers-liste');
    const proposals = el('ul', 'quartiers-propositions');
    wrap.append(options, form, summary, el('h4', undefined, 'Quartiers suivis'), list, el('h4', undefined, 'Propositions'), proposals);
    root.append(wrap);

    const spec = (): Record<string, number | string> => ({
      type: type.value, x: Number(fx.value), z: Number(fz.value), width: Number(fw.value), depth: Number(fd.value), seed: Number(fs.value),
    });
    const fail = (e: unknown): void => { api.toast(e instanceof Error ? e.message : String(e), 'error'); };

    const render = (p: Payload | null): void => {
      overlay.checked = !!p?.overlay;
      auto.checked = !!p?.autoEvolve;
      list.textContent = '';
      for (const d of p?.districts ?? []) {
        const li = el('li');
        li.textContent = `${d.nameFr} n° ${d.id} — ${d.buildings} bâtiments, ${d.distinctAssets} modèles, `
          + `répétition ${(d.repetitionIndex * 100).toFixed(0)} %, ${d.residents}/${d.capacity} habitants, `
          + `valeur ${Math.round(d.value)}/100, stade ${d.stage}`;
        list.append(li);
      }
      if (!p?.districts?.length) list.append(el('li', undefined, 'Aucun quartier suivi.'));
      proposals.textContent = '';
      for (const q of p?.proposals ?? []) {
        const li = el('li');
        li.append(el('span', undefined, `${q.kind === 'densification' ? 'Densification' : 'Valorisation'} — ${q.reason} (${q.cost} CHF)`));
        const apply = el('button', undefined, 'Appliquer');
        apply.type = 'button';
        apply.addEventListener('click', () => {
          api.command('applyProposal', { id: q.id }).then(() => api.toast('Proposition appliquée.', 'ok')).catch(fail);
        });
        const drop = el('button', undefined, 'Écarter');
        drop.type = 'button';
        drop.addEventListener('click', () => { api.command('dismissProposal', { id: q.id }).catch(fail); });
        li.append(apply, drop);
        proposals.append(li);
      }
      if (!p?.proposals?.length) proposals.append(el('li', undefined, 'Aucune proposition.'));
    };

    const refresh = (): void => {
      api.command('listDistricts')
        .then((d) => {
          const districts = (d as { districts?: DistrictRow[] }).districts ?? [];
          return api.command('listProposals').then((q) => render({
            districts, proposals: (q as { proposals?: ProposalRow[] }).proposals ?? [],
            overlay: overlay.checked, autoEvolve: auto.checked,
          }));
        })
        .catch(fail);
    };

    overlay.addEventListener('change', () => { api.command('setOverlay', { on: overlay.checked }).catch(fail); });
    auto.addEventListener('change', () => { api.command('setAutoEvolve', { on: auto.checked }).catch(fail); });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      api.command('planDistrict', spec())
        .then((r) => {
          const s = (r as { plan?: { stats?: Record<string, number> } }).plan?.stats;
          summary.textContent = s
            ? `Plan : ${s['roads']} tronçons (${s['roadLength']} m), ${s['lots']} bâtiments, ${s['distinctAssets']} modèles, `
              + `répétition ${((s['repetitionIndex'] ?? 0) * 100).toFixed(0)} %, ${s['residents']} habitants, ${s['jobs']} emplois, coût ${s['cost']} CHF.`
            : 'Plan vide.';
        })
        .catch(fail);
    });
    build.addEventListener('click', () => {
      api.command('applyDistrict', spec())
        .then(() => { api.toast('Quartier construit.', 'ok'); refresh(); })
        .catch(fail);
    });

    const off = api.onDeltaExt((raw) => { render(raw as Payload); });
    render((api.snapshotExt() as Payload | null) ?? null);
    refresh();
    return (): void => { off(); root.textContent = ''; };
  },
};
