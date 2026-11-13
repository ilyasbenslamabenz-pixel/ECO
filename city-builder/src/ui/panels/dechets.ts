/**
 * Panneau d'interface « Déchets » (phase 2B.6) — propriété de la branche p2b-dechets.
 * Valeurs RÉELLES de la simulation uniquement (commande `etat`, synthèse `delta.ext.dechets.summary`) :
 * production, collecte, stocks, filières, pollution, budget ; réglages (passages de collecte, part de tri,
 * financement) envoyés par la commande `reglages` ; bascule du calque « déchets ».
 * Montage : par la refonte d'interface (registre UI_PANELS) ; en attendant, par le rendu du module
 * (src/render/plugins/dechets.ts : touche J, `window.__dechets.openPanel()`).
 */
import type { DechetsDelta } from '../../shared/protocol-ext/dechets';
import { WASTE_FACILITY_FR, type WasteSummary } from '../../shared/waste/types';
import { el, fmt, money } from '../dom';
import type { UiPanel, UiPanelApi } from './types';

/** Événement de bascule du calque (écouté par le rendu du module). */
export const DECHETS_LAYER_EVENT = 'dechets:calque';

const t = (kg: number): string => (Math.abs(kg) >= 1000 ? `${(kg / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} t` : `${fmt(Math.round(kg))} kg`);
const pct = (v: number): string => `${Math.round(v * 100)} %`;
const idx = (v: number): string => v.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
const WEEKDAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

const CSS = `
.dechets-panel { width: min(380px, calc(100vw - 24px)); }
.dechets-panel h4 { margin: 4px 0 2px; font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: var(--accent, #7cc4ff); }
.dechets-panel .blocked { border-left: 3px solid var(--danger, #e5534b); padding: 6px 10px; border-radius: 8px; background: rgba(229,83,75,.12); font-size: 12.5px; }
.dechets-panel .reglage { display: grid; grid-template-columns: 1fr auto; gap: 4px 10px; align-items: center; font-size: 13px; }
.dechets-panel .reglage input[type=range] { grid-column: 1 / -1; width: 100%; }
.dechets-panel .reglage select { min-height: 32px; }
.dechets-panel .calque { display: flex; gap: 8px; align-items: center; font-size: 13px; min-height: 32px; }
.dechets-panel .fill { height: 6px; border-radius: 3px; background: rgba(255,255,255,.12); overflow: hidden; }
.dechets-panel .fill > i { display: block; height: 100%; background: linear-gradient(90deg, #5fb85a, #e3b341, #e5534b); }
`;

function rows(pairs: [string, string][]): HTMLDListElement {
  const dl = el('dl', { cls: 'rows' });
  for (const [k, v] of pairs) dl.append(el('dt', { text: k }), el('dd', { text: v }));
  return dl;
}

/** Contenu du panneau (DOM pur, testable) à partir d'une synthèse. */
export function renderSummary(s: WasteSummary, dayIndex?: number): HTMLElement {
  const box = el('div', { cls: 'dechets-content' });
  if (s.blocked) box.append(el('div', { cls: 'blocked', text: `Collecte arrêtée : ${s.blocked}` }));
  const d = s.lastDay;
  box.append(el('h4', { text: 'Production et stocks' }), rows([
    ['Production', `${t(s.productionPerDay)} / jour`],
    ['Bâtiments producteurs', fmt(s.producers)],
    ['En attente dans les bacs', `${t(s.storedKg)} (${s.storageKg > 0 ? pct(s.storedKg / s.storageKg) : '0 %'} de la capacité)`],
    ['Bacs qui débordent', fmt(s.overflowingBuildings)],
  ]));
  const nextWd = WEEKDAYS[((s.nextCollectionDay % 7) + 7) % 7] ?? '';
  box.append(el('h4', { text: 'Collecte' }), rows([
    ['Camions (flotte · en service · en tournée)', `${s.fleet} · ${s.activeTrucks} · ${s.trucksOnRoad}`],
    ['Prochaine collecte', dayIndex !== undefined && s.nextCollectionDay === dayIndex ? `aujourd'hui (${nextWd})` : nextWd],
    ['Hier : collectés', d ? t(d.collectedKg) : '—'],
    ['Hier : non collectés (débordement des bacs)', d ? t(d.uncollectedKg) : '—'],
    ['Hier : tournées · arrêts', d ? `${d.tours} · ${d.stops}` : '—'],
    ['Depuis le début : collectés / non collectés', `${t(s.totals.collectedKg)} / ${t(s.totals.uncollectedKg)}`],
  ]));
  const fac: [string, string][] = s.facilities.map((f) => {
    const name = WASTE_FACILITY_FR[f.kind] + (f.connected ? '' : ' (non reliée)');
    const v = f.kind === 'depot' ? `${f.capacity} camions`
      : f.kind === 'decharge' ? `${pct(f.capacity > 0 ? f.amount / f.capacity : 0)} pleine (${t(f.amount)} / ${t(f.capacity)})`
        : `${t(f.amount)} traités hier / ${t(f.capacity)} par jour`;
    return [name, v];
  });
  box.append(el('h4', { text: 'Filières' }), fac.length ? rows(fac) : el('div', { cls: 'muted', text: 'Aucune installation : posez un dépôt de camions-bennes et une filière (Services publics).' }));
  box.append(rows([
    ['Hier : triés · recyclés', d ? `${t(d.sortedKg)} · ${t(d.recycledKg)}` : '—'],
    ['Hier : incinérés · énergie', d ? `${t(d.burnedKg)} · ${idx(d.energyMWh)} MWh` : '—'],
    ['Hier : enfouis · débordement', d ? `${t(d.landfilledKg)} · ${t(d.overflowKg)}` : '—'],
    ['Depuis le début : recyclés · incinérés · enfouis', `${t(s.totals.recycledKg)} · ${t(s.totals.burnedKg)} · ${t(s.totals.landfilledKg)}`],
  ]));
  for (const f of s.facilities) {
    if (f.kind !== 'decharge' || f.capacity <= 0) continue;
    const bar = el('div', { cls: 'fill', title: 'Remplissage de la décharge' }, el('i'));
    (bar.firstChild as HTMLElement).style.width = `${Math.min(100, (100 * f.amount) / f.capacity).toFixed(1)}%`;
    box.append(bar);
  }
  box.append(el('h4', { text: 'Pollution (moyenne · maximum)' }), rows([
    ['Sol', `${idx(s.pollution.soil)} · ${idx(s.pollution.soilMax)}`],
    ['Air', `${idx(s.pollution.air)} · ${idx(s.pollution.airMax)}`],
    ['Eau', idx(s.pollution.water)],
    ['Nuisances (déchets)', `${idx(s.pollution.nuisance)} · ${idx(s.pollution.nuisanceMax)}`],
  ]));
  box.append(el('h4', { text: 'Budget' }), rows([
    ['Exploitation des camions', `−${money(s.monthlyBudget)} / mois`],
    ['Recettes cumulées : recyclage · énergie', `${money(Math.round(s.totals.incomeRecycling))} · ${money(Math.round(s.totals.incomeEnergy))}`],
    ['Dépenses cumulées', `−${money(s.totals.expenseTrucks)}`],
  ]));
  return box;
}

export const dechetsPanel: UiPanel = {
  id: 'dechets',
  title: 'Déchets',
  phase: '2B',
  mount(root: HTMLElement, api: UiPanelApi): () => void {
    root.classList.add('dechets-panel');
    if (!document.getElementById('dechets-css')) document.head.append(el('style', { attrs: { id: 'dechets-css' } }, CSS));
    const content = el('div');
    // Réglages.
    const freq = el('select', { attrs: { 'aria-label': 'Passages de collecte par semaine', 'data-reglage': 'collectsPerWeek' } });
    for (let n = 1; n <= 7; n++) freq.append(el('option', { text: `${n} / semaine`, attrs: { value: String(n) } }));
    const sort = el('input', { attrs: { type: 'range', min: '0', max: '80', step: '5', 'aria-label': 'Part de tri', 'data-reglage': 'sortShare' } });
    const fund = el('input', { attrs: { type: 'range', min: '0', max: '100', step: '5', 'aria-label': 'Financement', 'data-reglage': 'funding' } });
    const sortV = el('b'), fundV = el('b');
    const layer = el('input', { attrs: { type: 'checkbox', 'aria-label': 'Calque déchets' } });
    const settings = el('div', { cls: 'reglage' },
      el('span', { text: 'Fréquence de collecte' }), freq,
      el('span', { text: 'Part de tri à la source' }), sortV, sort,
      el('span', { text: 'Financement du service (camions en service)' }), fundV, fund);
    root.append(content, el('h4', { text: 'Réglages' }), settings, el('label', { cls: 'calque' }, layer, 'Calque « déchets » (nuisances, sol, bacs)'));

    let last: WasteSummary | null = null;
    let editing = false;
    const show = (s: WasteSummary): void => {
      last = s;
      content.replaceChildren(renderSummary(s));
      if (!editing) {
        freq.value = String(s.settings.collectsPerWeek);
        sort.value = String(Math.round(s.settings.sortShare * 100));
        fund.value = String(Math.round(s.settings.funding * 100));
      }
      sortV.textContent = pct(Number(sort.value) / 100);
      fundV.textContent = `${pct(Number(fund.value) / 100)} · ${s.activeTrucks}/${s.fleet} camions`;
    };
    const send = async (): Promise<void> => {
      editing = false;
      try {
        const r = await api.command('reglages', { collectsPerWeek: Number(freq.value), sortShare: Number(sort.value) / 100, funding: Number(fund.value) / 100 });
        show(r as WasteSummary);
      } catch (e) { api.toast(e instanceof Error ? e.message : String(e), 'error'); }
    };
    freq.addEventListener('change', () => { void send(); });
    for (const r of [sort, fund]) {
      r.addEventListener('input', () => { editing = true; sortV.textContent = pct(Number(sort.value) / 100); fundV.textContent = pct(Number(fund.value) / 100); });
      r.addEventListener('change', () => { void send(); });
    }
    layer.addEventListener('change', () => { window.dispatchEvent(new CustomEvent(DECHETS_LAYER_EVENT, { detail: { visible: layer.checked } })); });
    const onLayer = (e: Event): void => { layer.checked = !!(e as CustomEvent<{ visible: boolean }>).detail?.visible; };
    window.addEventListener(`${DECHETS_LAYER_EVENT}:etat`, onLayer);
    const off = api.onDeltaExt((p) => { const s = (p as DechetsDelta | undefined)?.summary; if (s) show(s); });
    const snap = api.snapshotExt() as { summary?: WasteSummary } | undefined;
    if (snap?.summary) show(snap.summary);
    void api.command('etat').then((s) => show(s as WasteSummary)).catch(() => {
      if (!last) content.replaceChildren(el('div', { cls: 'muted', text: 'Module déchets indisponible.' }));
    });
    return () => { off(); window.removeEventListener(`${DECHETS_LAYER_EVENT}:etat`, onLayer); };
  },
};
