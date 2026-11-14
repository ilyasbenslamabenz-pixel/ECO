/**
 * Panneau « Eau & égouts » (phase 2B.5) : production / consommation, réserve des châteaux d'eau, qualité, pression,
 * desserte, couverture des égouts, rejets et pollution des cours d'eau, budget du service, installations, alertes,
 * réglages (financements, tarif, restrictions) et choix du calque de la vue « eau ».
 * N'affiche QUE des valeurs reçues de la simulation (`delta.ext.eau` / `snapshot.ext.eau` / commande `state`).
 */
import type { EauDelta, EauSnapshot } from '../../shared/protocol-ext/eau';
import { WATER_FACILITIES, type WaterSettings } from '../../shared/water-network/types';
import { waterView, WATER_LEGEND, WATER_VIEW_MODES } from '../../render/water-network/view';
import { el, fmt, money } from '../dom';
import type { UiPanel, UiPanelApi } from './types';

type State = EauDelta | EauSnapshot;

const pct = (v: number): string => `${Math.round(v * 100)} %`;
const m3h = (v: number): string => `${v < 10 ? v.toFixed(2).replace('.', ',') : fmt(v)} m³/h`;
const dec = (v: number, n = 1): string => v.toFixed(n).replace('.', ',');

function row(label: string, value: string, tip?: string, cls?: string): HTMLElement {
  const r = el('div', { cls: `eau-row${cls ? ` ${cls}` : ''}` }, el('span', { cls: 'eau-k', text: label }), el('b', { cls: 'eau-v', text: value }));
  if (tip) r.title = tip;
  return r;
}

function gauge(v: number, cls = ''): HTMLElement {
  const g = el('div', { cls: `eau-gauge ${cls}` });
  const f = el('i');
  f.style.width = `${Math.max(0, Math.min(100, v * 100)).toFixed(1)}%`;
  g.append(f);
  return g;
}

function mount(root: HTMLElement, api: UiPanelApi): () => void {
  let state: State | undefined = api.snapshotExt() as State | undefined;
  let sending = false;
  const body = el('div', { cls: 'eau-body' });
  root.replaceChildren(body);

  const sendSettings = (p: Partial<WaterSettings>): void => {
    sending = true;
    api.command('settings', p).then((r) => {
      if (state) state = { ...state, settings: r as WaterSettings };
      api.toast('Réglage du service de l\'eau appliqué (effet mesuré à J+1).', 'ok');
    }).catch((e: unknown) => api.toast(e instanceof Error ? e.message : String(e), 'error')).finally(() => { sending = false; render(); });
  };

  const slider = (label: string, key: 'fundingWater' | 'fundingSewer' | 'tariff', min: number, max: number, step: number, show: (v: number) => string, tip: string): HTMLElement => {
    const v = state?.settings[key] ?? 1;
    const out = el('output', { text: show(v) });
    const input = el('input', { attrs: { type: 'range', min: String(min), max: String(max), step: String(step), value: String(v), 'aria-label': label, 'data-eau': key } });
    input.addEventListener('input', () => { out.textContent = show(Number(input.value)); });
    input.addEventListener('change', () => sendSettings({ [key]: Number(input.value) }));
    const l = el('label', { cls: 'eau-slider' }, el('span', { text: label }), out, input);
    l.title = tip;
    return l;
  };

  const render = (): void => {
    const s = state;
    const parts: HTMLElement[] = [];
    // Vue « eau » : calques.
    const modes = el('div', { cls: 'eau-modes', attrs: { role: 'group', 'aria-label': 'Calque de la vue eau' } });
    for (const m of WATER_VIEW_MODES) {
      const b = el('button', { cls: waterView.mode === m.id ? 'on' : '', text: m.label, attrs: { 'data-mode': m.id, 'aria-pressed': String(waterView.mode === m.id) } });
      b.title = m.tip;
      b.addEventListener('click', () => { waterView.set(m.id); render(); });
      modes.append(b);
    }
    parts.push(modes);
    if (waterView.mode !== 'off') {
      const leg = el('div', { cls: 'eau-legend' });
      for (const it of WATER_LEGEND[waterView.mode]) {
        const sw = el('i'); sw.style.background = it.color;
        leg.append(el('span', {}, sw, it.label));
      }
      parts.push(leg);
    }
    if (!s) {
      parts.push(el('p', { cls: 'muted', text: 'Service non créé. Posez une station de pompage (catalogue « public ») près d\'une rivière ou d\'un lac — à défaut, elle fore la nappe — puis une usine de potabilisation, un château d\'eau, une station d\'épuration et un émissaire. Canalisations et égouts suivent les routes.' }));
      body.replaceChildren(...parts);
      return;
    }
    const b = s.balance;
    // Eau potable.
    parts.push(el('h4', { text: 'Eau potable' }));
    parts.push(row('Production disponible', m3h(b.production), 'Usines (limitées par l\'eau pompée), pompages non traités et débit de sortie des châteaux d\'eau'));
    parts.push(row('Consommation (demande)', m3h(b.demand), 'Demande horaire des bâtiments raccordables (profil horaire, tarif, restrictions)'));
    parts.push(row('Livré', m3h(b.delivered)));
    parts.push(gauge(b.demand > 0 ? b.delivered / b.demand : 0, 'blue'));
    parts.push(row('Eau pompée / traitée', `${m3h(b.pumped)} / ${m3h(b.treated)}`));
    parts.push(row('Réserve des châteaux d\'eau', b.storage > 0 ? `${fmt(b.stock)} / ${fmt(b.storage)} m³` : 'aucun château'));
    if (b.storage > 0) parts.push(gauge(b.stock / b.storage, 'blue'));
    parts.push(row('Qualité de l\'eau livrée', b.delivered > 0 ? pct(b.quality) : '—', 'Mélange des sources : pollution de l\'eau captée, abattement des usines', b.delivered > 0 && b.quality < 0.7 ? 'bad' : ''));
    parts.push(row('Pression moyenne', b.pressure > 0 ? `${dec(b.pressure)} bar` : '—', 'Charge des châteaux d\'eau ou refoulement des usines, moins altitude et pertes de charge'));
    parts.push(row('Bâtiments desservis', `${fmt(b.served)} / ${fmt(b.buildings)} (${pct(b.servedShare)})`, 'Desservi = au moins 50 % du besoin avec une pression suffisante ; un bâtiment non desservi perd en satisfaction et ne grandit pas', b.unserved > 0 ? 'bad' : ''));
    parts.push(gauge(b.servedShare, b.unserved > 0 ? 'warn' : 'ok'));
    // Assainissement.
    parts.push(el('h4', { text: 'Égouts et assainissement' }));
    parts.push(row('Eaux usées produites', m3h(b.sewage)));
    parts.push(row('Couverture des égouts', b.sewage > 0 ? pct(b.sewerCoverage) : '—', 'Part des eaux usées acheminée vers une station d\'épuration ou un émissaire'));
    parts.push(row('Épurées', m3h(b.sewageTreated)));
    parts.push(row('Rejets non traités', m3h(b.sewageRaw + b.sewageOverflow), 'Émissaires sans station + débordements du réseau', b.sewageRaw + b.sewageOverflow > 0.01 ? 'bad' : ''));
    parts.push(row('Charge polluante rejetée', `${dec(b.pollutionLoad, 2)} u/h`));
    parts.push(row('Pollution des cours d\'eau (moy. / max.)', `${dec(b.riverPollutionMean)} / ${dec(b.riverPollutionMax)}`, 'Indice 0–100 de la grille municipale pollution_eau, propagée vers l\'aval'));
    // Budget.
    const cur = s.budget.current, last = s.budget.last;
    parts.push(el('h4', { text: 'Budget du service' }));
    parts.push(row('Mois en cours : recettes', money(cur.income)));
    parts.push(row('Mois en cours : dépenses', money(cur.expenses)));
    if (last) parts.push(row('Dernier mois : solde', money(last.income - last.expenses), Object.entries(last.lines).map(([k, v]) => `${k} : ${fmt(v)}`).join('\n')));
    parts.push(el('p', { cls: 'muted small', text: 'Lignes du budget municipal (service « eau ») ; leur application à la trésorerie attend la sous-étape Fiscalité et budget.' }));
    // Réglages.
    parts.push(el('h4', { text: 'Réglages' }));
    parts.push(slider('Financement eau potable', 'fundingWater', 0, 1.5, 0.05, pct, 'Capacité de pompage / traitement et rendement de potabilisation'));
    parts.push(slider('Financement assainissement', 'fundingSewer', 0, 1.5, 0.05, pct, 'Capacité et rendement des stations d\'épuration (sous-financées : épuration partielle)'));
    parts.push(slider('Tarif de l\'eau', 'tariff', 0, 6, 0.1, (v) => `${dec(v, 1)} ¢/m³`, 'Un tarif élevé réduit la consommation et la satisfaction'));
    const chk = el('input', { attrs: { type: 'checkbox', 'data-eau': 'restrictions' } });
    chk.checked = s.settings.restrictions;
    chk.addEventListener('change', () => sendSettings({ restrictions: chk.checked }));
    parts.push(el('label', { cls: 'eau-check' }, chk, 'Restrictions d\'usage (−20 % de demande, léger mécontentement)'));
    if (sending) parts.push(el('p', { cls: 'muted small', text: 'Envoi…' }));
    // Installations.
    parts.push(el('h4', { text: `Installations (${s.facilities.length})` }));
    const list = el('ul', { cls: 'eau-fac' });
    for (const f of s.facilities) {
      const spec = WATER_FACILITIES[f.kind];
      let detail = `${m3h(f.output)} / ${m3h(f.capacity)}`;
      if (f.kind === 'pompage') detail += ` · ${f.intake === 'forage' ? 'forage (nappe)' : 'eau de surface'} · pollution captée ${dec(f.intakePollution ?? 0)}`;
      if (f.kind === 'chateau') detail = `${fmt(f.stock ?? 0)} / ${fmt(f.storage ?? 0)} m³ · sortie ${m3h(f.output)}`;
      if (f.kind === 'epuration') detail += ` · rendement ${pct(f.efficiency ?? 0)}`;
      if (f.kind === 'emissaire') detail = `rejet ${m3h(f.output)}`;
      if ((f.kind === 'epuration' || f.kind === 'emissaire') && f.outfall === null) detail += ' · loin de l\'eau (rejet au sol)';
      if (!f.connected) detail = 'non raccordée (aucune route à 80 m)';
      list.append(el('li', {}, el('b', { text: spec.nameFr }), el('span', { text: detail })));
    }
    parts.push(list);
    if (s.alerts.length) {
      parts.push(el('h4', { text: 'Alertes' }));
      parts.push(el('ul', { cls: 'eau-alerts' }, ...s.alerts.map((a) => el('li', { text: a }))));
    }
    body.replaceChildren(...parts);
  };

  /** Pas de re-rendu pendant qu'un curseur est manipulé (les deltas horaires reconstruiraient le contrôle). */
  const busy = (): boolean => sending || (document.activeElement instanceof HTMLInputElement && root.contains(document.activeElement) && document.activeElement.type === 'range');
  const offDelta = api.onDeltaExt((p) => { state = p as State | undefined; if (!busy()) render(); });
  const offView = waterView.subscribe(() => render());
  render();
  return () => { offDelta(); offView(); };
}

export const eauPanel: UiPanel = { id: 'eau', title: 'Eau & égouts', phase: '2B', mount };
