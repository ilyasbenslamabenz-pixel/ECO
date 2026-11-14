/**
 * Panneau « Énergie » (phase 2B, sous-étape 4) — propriété de la branche p2b-electricite.
 * Production / consommation / réserve, part par source, coupures par classe, budget du service, réglages
 * (financement de l'entretien, priorités de délestage, toitures solaires), installations, lignes HT, journal.
 * Toutes les valeurs affichées viennent de la simulation (`delta.ext.electricite` / commande `state`).
 *
 * `electricitePanel` est le panneau du registre UI_PANELS. Tant que l'interface ne monte pas les panneaux du
 * registre (refonte §1bis), `mountElectriciteLauncher()` (appelé par le module de rendu) ajoute un bouton
 * « ⚡ Énergie » qui ouvre ce même panneau ; les commandes passent par `window.__aube.send('pluginCommand', …)`.
 */
import {
  CLASS_LABELS_FR, type ConsumerClass, type ElectriciteDelta, type ElectriciteSummary, FUNDING_MAX, FUNDING_MIN,
  SOURCE_LABELS_FR, type FacilityView,
} from '../../shared/power/types';
import { powerView } from '../../shared/power/view';
import type { UiPanel, UiPanelApi } from './types';

/* --------------------------------- Formats --------------------------------- */

const nf1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
/** Puissance (kW interne) : « 12,5 MW » ou « 850 kW ». */
export const fmtPower = (kw: number): string => (Math.abs(kw) >= 1000 ? `${nf1.format(kw / 1000)} MW` : `${nf0.format(kw)} kW`);
/** Énergie (kWh interne) : « 1,2 GWh », « 35,0 MWh », « 800 kWh ». */
export const fmtEnergy = (kwh: number): string => (kwh >= 1e6 ? `${nf1.format(kwh / 1e6)} GWh` : kwh >= 1000 ? `${nf1.format(kwh / 1000)} MWh` : `${nf0.format(kwh)} kWh`);
/** Montant (centimes internes) en francs suisses : « 12,5 M CHF », « 3 400 CHF ». */
export const fmtChf = (cents: number): string => {
  const chf = cents / 100;
  return Math.abs(chf) >= 1e6 ? `${nf1.format(chf / 1e6)} M CHF` : `${nf0.format(chf)} CHF`;
};
const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const hhmm = (min: number): string => {
  const d = Math.floor(min / 1440) + 1, h = Math.floor((min % 1440) / 60), m = Math.floor(min % 60);
  return `j${d} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};
const KIND_FR: Record<FacilityView['kind'], string> = { thermique: 'Thermique', eolien: 'Éolienne', solaire: 'Solaire', hydro: 'Barrage', poste: 'Poste' };

const SOURCE_COLORS: Record<string, string> = { thermique: '#d0743c', eolien: '#5ab0e8', solaire: '#f2c230', hydro: '#3c7fd0', toitures: '#e8e070' };

const CSS = `
#elec-launcher{position:fixed;right:calc(8px + env(safe-area-inset-right,0px));top:46%;z-index:40;min-width:44px;height:44px;padding:0 12px;border-radius:12px;border:1px solid rgba(255,255,255,.16);background:rgba(17,21,27,.88);color:#e8edf2;font:600 14px/1 system-ui,sans-serif;cursor:pointer;backdrop-filter:blur(6px)}
#elec-launcher.on{background:#e8b65a;color:#1b1408}
#elec-panel{position:fixed;right:calc(60px + env(safe-area-inset-right,0px));top:72px;bottom:96px;width:min(420px,calc(100vw - 76px));z-index:41;overflow:auto;padding:12px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.16);background:rgba(17,21,27,.94);color:#e8edf2;font:13px/1.35 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.4)}
#elec-panel.hidden{display:none}
@media (max-width:560px){#elec-panel{left:8px;right:8px;width:auto;top:auto;bottom:calc(150px + env(safe-area-inset-bottom,0px));max-height:55vh}#elec-launcher{top:auto;bottom:calc(210px + env(safe-area-inset-bottom,0px))}}
.elec h3{margin:0 0 8px;font-size:15px;display:flex;justify-content:space-between;align-items:center}
.elec h4{margin:12px 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#8f9baa}
.elec .kpis{display:grid;grid-template-columns:repeat(2,1fr);gap:6px}
.elec .kpi{background:rgba(255,255,255,.045);border-radius:8px;padding:6px 8px}
.elec .kpi b{display:block;font-size:16px}
.elec .kpi span{color:#8f9baa;font-size:11px}
.elec .bar{height:8px;border-radius:4px;background:rgba(255,255,255,.08);overflow:hidden;display:flex}
.elec .bar i{display:block;height:100%}
.elec table{width:100%;border-collapse:collapse;font-size:12px}
.elec td,.elec th{padding:3px 4px;border-bottom:1px solid rgba(255,255,255,.07);text-align:right}
.elec td:first-child,.elec th:first-child{text-align:left}
.elec .warn{color:#ff6b6b}.elec .ok{color:#5fd39a}.elec .muted{color:#8f9baa}
.elec button{min-height:32px;padding:4px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:#e8edf2;cursor:pointer;font:inherit}
.elec button.primary{background:#e8b65a;color:#1b1408;border-color:#e8b65a}
.elec .row{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:4px 0}
.elec select,.elec input[type=range]{flex:1;min-width:0}
.elec select{min-height:32px;background:#141920;color:#e8edf2;border:1px solid rgba(255,255,255,.16);border-radius:8px}
.elec ol{margin:0;padding-left:20px}.elec li{margin:2px 0}
.elec .log{max-height:140px;overflow:auto;font-size:11.5px}
`;

/* --------------------------------- Panneau --------------------------------- */

function renderSummary(s: ElectriciteSummary | undefined, st: ElectriciteDelta): string {
  if (!s) {
    return `<p class="muted">Aucune installation électrique. Construisez une centrale (onglet Industrie) : centrale thermique, éolienne,
      ferme solaire ou barrage (au bord d'un cours d'eau), puis des postes de transformation reliés par des lignes haute tension.</p>`;
  }
  const reserve = s.exportableKw;
  const totalOut = s.bySource.reduce((t, b) => t + b.outputKw, 0) || 1;
  const bar = s.bySource.filter((b) => b.outputKw > 0).map((b) => `<i style="width:${(100 * b.outputKw / totalOut).toFixed(2)}%;background:${SOURCE_COLORS[b.source]}" title="${esc(SOURCE_LABELS_FR[b.source])}"></i>`).join('');
  const src = s.bySource.filter((b) => b.count > 0).map((b) => `<tr><td><span style="color:${SOURCE_COLORS[b.source]}">■</span> ${esc(SOURCE_LABELS_FR[b.source])} <span class="muted">×${b.count}</span></td>
      <td>${fmtPower(b.outputKw)}</td><td class="muted">${fmtPower(b.availableKw)} / ${fmtPower(b.nominalKw)}</td><td>${(100 * b.outputKw / totalOut).toFixed(0)} %</td></tr>`).join('');
  const cls = s.byClass.filter((b) => b.buildings > 0).map((b) => `<tr><td>${esc(CLASS_LABELS_FR[b.cls])}</td><td>${fmtPower(b.demandKw)}</td><td>${fmtPower(b.deliveredKw)}</td>
      <td class="${b.cut ? 'warn' : 'ok'}">${b.cut}</td><td class="${b.unlinked ? 'warn' : 'muted'}">${b.unlinked}</td></tr>`).join('');
  const bud = st.budget;
  return `
  <div class="kpis">
    <div class="kpi"><span>Production</span><b data-k="production">${fmtPower(s.producedKw)}</b><span>dispo. ${fmtPower(s.availableKw)}</span></div>
    <div class="kpi"><span>Consommation</span><b data-k="demande">${fmtPower(s.demandKw)}</b><span>livré ${fmtPower(s.deliveredKw)} · pertes ${fmtPower(s.lossesKw)}</span></div>
    <div class="kpi"><span>Réserve (surplus exportable)</span><b data-k="reserve" class="${reserve > 0 ? 'ok' : 'warn'}">${fmtPower(reserve)}</b><span>déficit ${fmtPower(s.shortfallKw)}</span></div>
    <div class="kpi"><span>Coupures</span><b data-k="coupures" class="${s.cut + s.unlinked ? 'warn' : 'ok'}">${s.cut} coupés · ${s.unlinked} non raccordés</b><span>${s.powered} / ${s.buildings} bâtiments alimentés</span></div>
  </div>
  <p class="muted" style="margin:6px 0">Relevé ${hhmm(s.at)} · vent ${nf1.format(s.windMs)} m/s (${s.windSource === 'meteo' ? 'météo' : s.windSource === 'force' ? 'forcé' : 'profil'}) · soleil ${(s.sun * 100).toFixed(0)} %
    · sans courant : ${nf0.format(s.jobsWithoutPower)} emplois, ${nf0.format(s.residentsWithoutPower)} habitants</p>
  <h4>Part par source</h4>
  <div class="bar">${bar}</div>
  <table><tr><th>Source</th><th>Produit</th><th>Dispo / nominal</th><th>Part</th></tr>${src}</table>
  <h4>Consommation et délestage</h4>
  <table><tr><th>Classe</th><th>Demande</th><th>Livré</th><th>Coupés</th><th>Hors réseau</th></tr>${cls}</table>
  ${bud ? `<h4>Budget du service</h4>
  <table>
    <tr><td>Entretien du réseau (mois)</td><td>${fmtChf(bud.upkeepActual)} <span class="muted">/ ${fmtChf(bud.upkeepNominal)} nominal</span></td></tr>
    <tr><td>Entretien des installations (catalogue)</td><td>${fmtChf(bud.facilitiesUpkeep)}</td></tr>
    <tr><td>Mois passé : recettes / dépenses</td><td>${fmtChf(bud.lastIncome)} / ${fmtChf(bud.lastExpense)}</td></tr>
    <tr><td>Investissements (lignes, toitures)</td><td>${fmtChf(bud.investments)}</td></tr>
    <tr><td>Ce mois : produit / livré / délesté</td><td>${fmtEnergy(bud.monthProducedKwh)} / ${fmtEnergy(bud.monthDeliveredKwh)} / ${fmtEnergy(bud.monthShedKwh)}</td></tr>
    <tr><td>Pannes : ce mois / mois passé</td><td>${bud.monthFailures} / ${bud.lastMonthFailures}</td></tr>
  </table>` : ''}`;
}

function renderSettings(st: ElectriciteDelta): string {
  const set = st.settings;
  if (!set) return '';
  const pr = set.priorities.map((c, i) => `<li>${esc(CLASS_LABELS_FR[c])}
      <button data-act="prio-up" data-i="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Monter">▲</button>
      <button data-act="prio-down" data-i="${i}" ${i === set.priorities.length - 1 ? 'disabled' : ''} aria-label="Descendre">▼</button></li>`).join('');
  return `<h4>Réglages</h4>
  <div class="row"><label for="elec-fund">Financement de l'entretien</label><b data-k="financement">${Math.round(set.funding * 100)} %</b></div>
  <div class="row"><input id="elec-fund" type="range" min="${FUNDING_MIN * 100}" max="${FUNDING_MAX * 100}" step="5" value="${Math.round(set.funding * 100)}"></div>
  <p class="muted" style="margin:2px 0 6px">Sous-financer augmente les pannes (×4 à 50 %) et allonge les réparations.</p>
  <div>Priorités de délestage (servie en premier → coupée en premier) :</div>
  <ol>${pr}</ol>
  <div class="row"><label><input id="elec-roof" type="checkbox" ${set.rooftops ? 'checked' : ''}> Programme de toitures solaires (installation progressive sur les logements)</label></div>`;
}

function renderNetwork(st: ElectriciteDelta): string {
  const facs = st.facilities ?? [];
  const lines = st.lines ?? [];
  if (!facs.length) return '';
  const fRows = facs.map((f) => {
    const state = f.failedUntil > 0 ? `<span class="warn">panne</span>` : !f.siteOk ? `<span class="warn">site invalide</span>` : f.energized ? `<span class="ok">en service</span>` : `<span class="warn">hors réseau</span>`;
    return `<tr><td>${esc(KIND_FR[f.kind])} n° ${f.id}</td><td>${f.kind === 'poste' ? `<span class="muted">${fmtPower(f.nominalKw)}</span>` : fmtPower(f.outputKw)}</td><td>${state}</td>
      <td><button data-act="auto" data-id="${f.id}" title="Ligne HT vers l'installation la plus proche">Relier</button></td></tr>`;
  }).join('');
  const lRows = lines.map((l) => `<tr><td>Ligne n° ${l.id} <span class="muted">(${l.a} – ${l.b})</span></td><td>${nf1.format(l.lengthM / 1000)} km</td>
      <td class="${l.failedUntil > 0 ? 'warn' : l.load > 0.9 ? 'warn' : ''}">${l.failedUntil > 0 ? 'panne' : `${Math.round(l.load * 100)} %`}</td>
      <td><button data-act="rm-line" data-id="${l.id}">Démolir</button></td></tr>`).join('');
  const opts = facs.map((f) => `<option value="${f.id}">${esc(KIND_FR[f.kind])} n° ${f.id}</option>`).join('');
  return `<h4>Installations</h4><table>${fRows}</table>
  <h4>Lignes haute tension</h4>
  ${lines.length ? `<table>${lRows}</table>` : '<p class="muted">Aucune ligne : le courant suit les routes ; une ligne haute tension relie une installation à un réseau routier séparé (centrale éloignée, hameau).</p>'}
  <div class="row"><select id="elec-a">${opts}</select><select id="elec-b">${opts}</select></div>
  <div class="row"><button data-act="quote">Devis</button><button class="primary" data-act="build">Construire la ligne</button><span id="elec-quote" class="muted"></span></div>`;
}

function renderLog(st: ElectriciteDelta): string {
  const ev = (st.events ?? []).slice(-15).reverse();
  if (!ev.length) return '';
  return `<h4>Journal</h4><div class="log">${ev.map((e) => `<div class="${e.kind === 'panne' || e.kind === 'penurie' ? 'warn' : ''}"><span class="muted">${hhmm(e.at)}</span> ${esc(e.message)}</div>`).join('')}</div>`;
}

/** Monte le panneau dans `root` ; renvoie la fonction de démontage. */
function mountPanel(root: HTMLElement, api: UiPanelApi): () => void {
  root.classList.add('elec');
  let state: ElectriciteDelta = { ...(api.snapshotExt() as ElectriciteDelta | undefined ?? powerView.state) };
  const draw = (): void => {
    const keepScroll = root.scrollTop;
    root.innerHTML = `<h3>⚡ Énergie <span><button data-act="overlay" class="${powerView.overlay ? 'primary' : ''}">Calque réseau</button>
      <button data-act="close" aria-label="Fermer">✕</button></span></h3>
      ${renderSummary(state.summary, state)}${renderSettings(state)}${renderNetwork(state)}${renderLog(state)}
      ${state.municipal === 'integre' ? '<p class="muted" style="margin-top:8px">Contrat municipal hébergé par le module (module « municipal » non enregistré).</p>' : ''}`;
    root.scrollTop = keepScroll;
  };
  const run = async (name: string, payload?: unknown): Promise<unknown> => {
    try { return await api.command(name, payload); } catch (e) { api.toast(e instanceof Error ? e.message : String(e), 'error'); return undefined; }
  };
  const refresh = async (): Promise<void> => {
    const r = await run('state');
    if (r && typeof r === 'object') { state = r as ElectriciteDelta; draw(); }
  };
  const onClick = (ev: Event): void => {
    const b = (ev.target as HTMLElement).closest('button');
    if (!b) return;
    const act = b.dataset['act'];
    const sel = (id: string): number => Number((root.querySelector(`#${id}`) as HTMLSelectElement | null)?.value);
    const set = state.settings;
    if (act === 'close') { root.dispatchEvent(new CustomEvent('elec-close', { bubbles: true })); return; }
    if (act === 'overlay') { powerView.setOverlay(!powerView.overlay); draw(); return; }
    if ((act === 'prio-up' || act === 'prio-down') && set) {
      const i = Number(b.dataset['i']);
      const order = [...set.priorities];
      const j = act === 'prio-up' ? i - 1 : i + 1;
      [order[i], order[j]] = [order[j]!, order[i]!];
      void run('setPriorities', { order: order as ConsumerClass[] }).then(refresh);
      return;
    }
    if (act === 'auto') { void run('autoConnect', { id: Number(b.dataset['id']) }).then((r) => { if (r) api.toast('Ligne HT construite', 'ok'); return refresh(); }); return; }
    if (act === 'rm-line') { void run('removeLine', { id: Number(b.dataset['id']) }).then(refresh); return; }
    if (act === 'quote' || act === 'build') {
      const a = sel('elec-a'), bb = sel('elec-b');
      if (act === 'quote') {
        void run('quoteLine', { a, b: bb }).then((r) => {
          const q = r as { lengthM: number; cost: number; upkeepPerMonth: number } | undefined;
          const out = root.querySelector('#elec-quote');
          if (q && out) out.textContent = `${nf1.format(q.lengthM / 1000)} km : ${fmtChf(q.cost)} + ${fmtChf(q.upkeepPerMonth)}/mois`;
        });
      } else void run('buildLine', { a, b: bb }).then((r) => { if (r) api.toast('Ligne HT construite', 'ok'); return refresh(); });
    }
  };
  const onChange = (ev: Event): void => {
    const t = ev.target as HTMLInputElement;
    if (t.id === 'elec-fund') void run('setFunding', { funding: Number(t.value) / 100 }).then(refresh);
    if (t.id === 'elec-roof') void run('setRooftops', { enabled: t.checked }).then(refresh);
  };
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  const off = api.onDeltaExt((p) => {
    const d = p as ElectriciteDelta;
    state = { ...state, ...d, events: [...(state.events ?? []), ...(d.events ?? [])].slice(-40) };
    // Pas de redessin pendant une interaction avec un contrôle (curseur, liste).
    const a = document.activeElement;
    if (a && root.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'SELECT')) return;
    draw();
  });
  draw();
  void refresh();
  return () => { off(); root.removeEventListener('click', onClick); root.removeEventListener('change', onChange); root.innerHTML = ''; };
}

export const electricitePanel: UiPanel = {
  id: 'electricite',
  title: 'Énergie',
  phase: '2B',
  mount: (root, api) => mountPanel(root, api),
};

/* ----------------------- Lanceur provisoire (avant §1bis) ----------------------- */

interface AubeDebug { send?: (name: string, args: unknown) => Promise<unknown> }

/** Construit une `UiPanelApi` à partir du pont de diagnostic du jeu et de l'état partagé `powerView`. */
function launcherApi(): UiPanelApi {
  return {
    async command(name, payload) {
      const send = (window as unknown as { __aube?: AubeDebug }).__aube?.send;
      if (!send) throw new Error('Simulation non démarrée');
      const r = await send('pluginCommand', { plugin: 'electricite', name, payload }) as { data?: unknown };
      return r?.data;
    },
    onDeltaExt(listener) {
      let last = powerView.state;
      return powerView.on(() => { if (powerView.state !== last) { last = powerView.state; listener(powerView.state); } });
    },
    snapshotExt: () => powerView.state,
    toast(message, kind = 'info') {
      const t = document.createElement('div');
      t.textContent = message;
      t.style.cssText = `position:fixed;left:50%;top:84px;transform:translateX(-50%);z-index:60;padding:8px 14px;border-radius:10px;font:13px system-ui;color:#fff;background:${kind === 'error' ? '#b03a3a' : kind === 'ok' ? '#2f8f5a' : '#2d3640'}`;
      document.body.appendChild(t);
      setTimeout(() => t.remove(), 2600);
    },
  };
}

/** Ajoute le bouton « ⚡ Énergie » et le panneau flottant (idempotent). */
export function mountElectriciteLauncher(): void {
  if (typeof document === 'undefined' || document.getElementById('elec-launcher')) return;
  const style = document.createElement('style');
  style.id = 'elec-style';
  style.textContent = CSS;
  document.head.appendChild(style);
  const btn = document.createElement('button');
  btn.id = 'elec-launcher';
  btn.type = 'button';
  btn.title = 'Énergie : production, consommation, réseau électrique';
  btn.textContent = '⚡ Énergie';
  const panel = document.createElement('div');
  panel.id = 'elec-panel';
  panel.className = 'hidden';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Énergie');
  document.body.append(btn, panel);
  let unmount: (() => void) | null = null;
  const close = (): void => { unmount?.(); unmount = null; panel.classList.add('hidden'); btn.classList.remove('on'); };
  btn.addEventListener('click', () => {
    if (unmount) { close(); return; }
    panel.classList.remove('hidden');
    btn.classList.add('on');
    unmount = mountPanel(panel, launcherApi());
  });
  panel.addEventListener('elec-close', close);
}
