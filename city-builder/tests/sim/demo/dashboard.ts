/**
 * Banc d'essai navigateur du module simulation : pilote le VRAI worker (dist/sim.worker.js)
 * avec le VRAI catalogue (dist/assets/catalog.json) par le protocole de messages, construit
 * une petite ville par commandes validées, accélère le temps, affiche les rapports
 * (démographie, économie, LOD, trafic), puis teste la sauvegarde IndexedDB + gzip dans le
 * navigateur (aller-retour et fichier corrompu). Résultats dans window.__simDemo.
 */
import { SimBridge } from '../../../src/client/sim-bridge';
import { PROTOCOL_VERSION, TILE_SIZE } from '../../../src/shared/constants';
import type { AssetCatalog } from '../../../src/shared/catalog';
import type { DeltaMessageExt, SimReport } from '../../../src/sim/sim-protocol';
import { SaveStore } from '../../../src/save/store';

interface Check { name: string; ok: boolean; detail: string }
const checks: Check[] = [];
const series: { minute: number; pop: number; vehicles: number; atWork: number; home: number; commute: number }[] = [];
const state = { done: false, checks, series, report: null as SimReport | null, placed: 0, refused: [] as string[] };
(window as unknown as { __simDemo: typeof state }).__simDemo = state;
const check = (name: string, ok: boolean, detail = ''): void => { checks.push({ name, ok, detail }); };
const $ = (id: string): HTMLElement => document.getElementById(id)!;
const fmt = (n: number): string => (Math.round(n) || 0).toLocaleString('fr-FR');
const pct = (n: number): string => `${(n * 100).toFixed(1).replace('.', ',')} %`;

async function main(): Promise<void> {
  const base = new URL('../../../dist/', location.href);
  const catalog = (await (await fetch(new URL('assets/catalog.json', base))).json()) as AssetCatalog;
  // Tant que les bâtiments ne sont pas fusionnés dans catalog.json (agent assets / intégration),
  // on ajoute en mémoire les fragments du dépôt : la simulation n'utilise que les données.
  for (const frag of ['catalog.buildings.residential.json', 'catalog.buildings.other.json', 'catalog.vehicles.json']) {
    try {
      const r = await fetch(new URL(`../../../assets/${frag}`, location.href));
      if (!r.ok) continue;
      const j = (await r.json()) as { assets?: AssetCatalog['assets'] };
      for (const a of j.assets ?? []) if (!catalog.assets.some((b) => b.id === a.id)) catalog.assets.push(a);
    } catch { /* fragment absent : ignoré */ }
  }
  check('catalogue chargé', catalog.assets.some((a) => a.category === 'house'), `${catalog.assets.length} assets (dont fragments non fusionnés du dépôt)`);
  const bridge = await SimBridge.create(new URL('sim.worker.js', base));
  await bridge.ready;
  check('worker prêt', true, 'message ready reçu');
  let last: SimReport | null = null;
  let deltas = 0;
  bridge.onDelta((d: DeltaMessageExt) => {
    deltas++;
    if (d.report) {
      last = d.report;
      const a = d.report.demography.activities;
      series.push({ minute: d.report.date.totalMinutes, pop: d.report.demography.population, vehicles: d.report.traffic.vehicles,
        atWork: (a['Au travail'] ?? 0) + (a['Pause'] ?? 0), home: (a['À la maison'] ?? 0) + (a['Sommeil'] ?? 0), commute: (a['Trajet aller'] ?? 0) + (a['Trajet retour'] ?? 0) });
      render(d.report);
    }
  });
  await bridge.send('init', { protocolVersion: PROTOCOL_VERSION, catalog });
  await bridge.send('newGame', { seed: 2026, mapChunks: 8, startMoney: 80_000_000, cityName: 'Val-d\'Aube' });

  // Ville construite par de vraies commandes (validées par le worker).
  const has = (id: string): boolean => catalog.assets.some((a) => a.id === id);
  const street = async (z: number, ids: string[]): Promise<void> => {
    await bridge.send('buildRoad', { type: 'street', points: [-232, z, 232, z] });
    let x = -224;
    for (const id of ids) {
      const a = catalog.assets.find((c) => c.id === id);
      if (!a) { state.refused.push(`${id} : absent du catalogue`); continue; }
      const w = a.footprint.tilesX * TILE_SIZE, dz = a.footprint.tilesZ * TILE_SIZE;
      if (x + w > 224) break;
      try {
        await bridge.send('placeBuilding', { assetId: id, x: x + w / 2, z: z - 8 - dz / 2, rot: 0 });
        state.placed++;
      } catch (e) { state.refused.push(`${id} : ${(e as Error).message}`); }
      x += w + 8;
    }
  };
  const pick = (ids: string[]): string[] => ids.filter(has);
  await street(-160, pick(['maison_pavillon_enduit', 'maison_brique_pignon', 'maison_chalet_bois', 'maison_longere_pierre', 'maison_ville_etroite', 'maison_mas_provencal', 'mitoyennes_brique', 'mitoyennes_modernes', 'maison_villa_moderne']));
  await street(-96, pick(['immeuble_petit_enduit', 'immeuble_brique_1930', 'immeuble_haussmannien', 'immeuble_commerces_moderne', 'commerce_boulangerie', 'commerce_cafe_terrasse', 'tour_residentielle_balcons']));
  await street(-24, pick(['barre_logements_r9', 'residence_gradins', 'public_ecole', 'public_parc_kiosque', 'tour_brique_gradins']));
  await street(56, pick(['bureaux_brise_soleil', 'tour_vitree_mur_rideau', 'commerce_supermarche', 'public_hopital', 'public_caserne_pompiers', 'public_commissariat']));
  await street(136, pick(['industrie_manufacture_sheds', 'industrie_atelier', 'industrie_atelier', 'commerce_station_service', 'industrie_silos_cooperative']));
  // Avenue transversale qui relie les rues (réseau connexe pour le trafic).
  for (const [z0, z1] of [[-160, -96], [-96, -24], [-24, 56], [56, 136]] as const) {
    await bridge.send('buildRoad', { type: 'avenue', points: [-232, z0, -232, z1] });
    await bridge.send('buildRoad', { type: 'avenue', points: [232, z0, 232, z1] });
  }
  check('ville construite par commandes', state.placed >= 20, `${state.placed} bâtiments posés, ${state.refused.length} refus`);
  const settle = await bridge.send('settle' as never, { waves: 30 } as never) as unknown as { population: number };
  check('peuplement (vagues d\'immigration réelles)', settle.population > 500, `${settle.population} habitants`);
  await bridge.send('setFocus' as never, { x: 0, z: 0 } as never);
  await bridge.send('setSpeed', { speed: 4 });
  $('state').textContent = 'Simulation ×4 en cours…';
  // ~ 30 s réelles à ×4 : un peu plus d'une journée de jeu (emplois du temps visibles).
  await new Promise((r) => setTimeout(r, 30_000));
  await bridge.send('setSpeed', { speed: 0 });
  check('deltas reçus à pas fixe', deltas > 150, `${deltas} deltas`);
  const rep = (await bridge.send('getReport' as never, { fullHistory: true } as never)) as unknown as SimReport;
  state.report = rep;
  render(rep);
  check('horloge et calendrier', rep.date.totalMinutes > 1200, rep.dateFr);
  check('population réelle', rep.demography.population > 500, `${rep.demography.population} habitants, ${rep.demography.households} ménages`);
  check('emplois pourvus', rep.demography.employed > 100, `${rep.demography.employed} actifs occupés / ${rep.demography.jobsTotal} emplois`);
  check('élèves scolarisés', rep.demography.pupils > 0, `${rep.demography.pupils} élèves`);
  const acts = new Set(series.filter((s) => s.atWork > 0).map(() => 'travail'));
  check('emplois du temps (travail observé)', acts.size > 0 && series.some((s) => s.commute > 0), 'trajets et présence au travail observés au fil de la journée');
  check('trajets individuels émis (LOD détaillé)', rep.demography.tripsEmitted > 100, `${rep.demography.tripsEmitted} demandes de trajet`);
  check('recettes fiscales prévues', rep.economy.forecast.totalIncome > 0, `${fmt(rep.economy.forecast.totalIncome)} crédits/mois`);

  // Sauvegarde dans le navigateur : IndexedDB + gzip, aller-retour, fichier corrompu.
  const store = await SaveStore.open();
  check('support de stockage', store.kind === 'indexeddb', store.kind);
  const sv = await bridge.send('save', { slot: 'demo' });
  const w = await store.save('demo-1', sv.data);
  const rawLen = JSON.stringify(sv.data).length;
  check('sauvegarde compressée', w.ok && w.value.compressed && w.value.bytes < rawLen / 3, w.ok ? `${fmt(rawLen / 1024)} Ko JSON -> ${fmt(w.value.bytes / 1024)} Ko gzip` : w.message);
  const list = await store.list();
  check('liste des emplacements', list.some((l) => l.slot === 'demo-1'), list.map((l) => `${l.slot} (${l.population} hab.)`).join(', '));
  const back = await store.load('demo-1');
  if (back.ok) {
    await bridge.send('load', { data: back.value });
    const rep2 = (await bridge.send('getReport' as never, {} as never)) as unknown as SimReport;
    check('rechargement identique', rep2.demography.population === rep.demography.population && rep2.economy.money === rep.economy.money,
      `${rep2.demography.population} habitants, ${fmt(rep2.economy.money)} crédits`);
  } else check('rechargement identique', false, back.message);
  const bad = await store.importFile(new Blob(['{"format":"aube-urbaine-save","version":2,"buildings":"oups"}']));
  check('fichier corrompu refusé proprement', !bad.ok, bad.ok ? '' : bad.message);
  try {
    await bridge.send('load', { data: { format: 'aube-urbaine-save', version: 2 } as never });
    check('load corrompu refusé par le worker', false, 'accepté !');
  } catch (e) { check('load corrompu refusé par le worker', true, (e as Error).message); }
  $('state').textContent = checks.every((c) => c.ok) ? 'Tous les contrôles sont passés' : 'Des contrôles ont échoué';
  renderChecks();
  state.done = true;
}

function spark(values: number[], color: string, h = 60): string {
  if (values.length < 2) return '<p class="muted">En attente de données…</p>';
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 300},${h - (v / max) * (h - 6) - 3}`).join(' ');
  return `<svg viewBox="0 0 300 ${h}" width="100%" height="${h}" preserveAspectRatio="none"><polyline fill="none" stroke="${color}" stroke-width="2" points="${pts}"/><text x="2" y="10">${fmt(max)}</text></svg>`;
}

function render(r: SimReport): void {
  $('date').textContent = `${r.dateFr} · ${({ printemps: 'Printemps', ete: 'Été', automne: 'Automne', hiver: 'Hiver' })[r.season]}`;
  const d = r.demography, e = r.economy;
  const rows = (o: Record<string, number>, f: (v: number) => string): string => Object.entries(o).map(([k, v]) => `<tr><td>${k}</td><td>${f(v)}</td></tr>`).join('');
  const rciCol = (label: string, v: number): string => `<div><span>${v.toFixed(2).replace('.', ',')}</span><i class="col" style="height:${Math.abs(v) * 80 + 2}px;background:${v >= 0 ? 'var(--good)' : 'var(--bad)'}"></i><span>${label}</span></div>`;
  const totalAct = Object.values(d.activities).reduce((a, b) => a + b, 0) || 1;
  $('main').innerHTML = `
  <section><h2>Population</h2><div class="kpis">
    <div class="kpi"><b>${fmt(d.population)}</b><span>habitants</span></div>
    <div class="kpi"><b>${fmt(d.households)}</b><span>ménages</span></div>
    <div class="kpi"><b>${pct(d.unemploymentRate)}</b><span>chômage</span></div>
    <div class="kpi"><b>${fmt(d.employed)}</b><span>actifs occupés</span></div>
    <div class="kpi"><b>${fmt(d.pupils)}</b><span>élèves</span></div>
    <div class="kpi"><b>${d.happiness.toFixed(0)}</b><span>bonheur /100</span></div></div>
    <table style="margin-top:8px">${d.ageBands.map((v, i) => `<tr><td>${i * 10}${i === 8 ? '+' : `–${i * 10 + 9}`} ans</td><td style="width:55%"><div class="bar"><i style="width:${(v / Math.max(1, ...d.ageBands)) * 100}%"></i></div></td><td>${v}</td></tr>`).join('')}</table></section>
  <section><h2>Activités en ce moment</h2><table>${Object.entries(d.activities).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<tr><td>${k}</td><td style="width:50%"><div class="bar"><i style="width:${(v / totalAct) * 100}%;background:var(--accent)"></i></div></td><td>${v}</td></tr>`).join('')}</table>
    <h2 style="margin-top:10px">LOD de simulation</h2><table>${rows({ 'Détaillé (trajets individuels)': d.lod.detailed, 'Simplifié': d.lod.simplified, 'Statistique': d.lod.statistical }, fmt)}<tr><td>Demandes de trajet émises</td><td>${fmt(d.tripsEmitted)}</td></tr><tr><td>Véhicules en circulation</td><td>${fmt(r.traffic.vehicles)}</td></tr></table></section>
  <section><h2>Au fil du temps</h2><div class="muted">Population</div>${spark(series.map((s) => s.pop), 'var(--blue)')}<div class="muted">Au travail</div>${spark(series.map((s) => s.atWork), 'var(--accent)')}<div class="muted">En trajet</div>${spark(series.map((s) => s.commute), 'var(--good)')}</section>
  <section><h2>Budget (prévision du mois)</h2><div class="kpis"><div class="kpi"><b>${fmt(e.money)}</b><span>trésorerie</span></div><div class="kpi"><b class="${e.forecast.balance >= 0 ? 'ok' : 'ko'}">${fmt(e.forecast.balance)}</b><span>solde mensuel</span></div><div class="kpi"><b>${fmt(e.debt)}</b><span>dette</span></div></div>
    <table style="margin-top:8px">${rows({ 'Impôts résidentiels': e.forecast.income.residential, 'Impôts commerces': e.forecast.income.commercial, 'Impôts industrie': e.forecast.income.industrial, 'Impôts bureaux': e.forecast.income.office }, fmt)}
    ${rows({ 'Entretien bâtiments': -e.forecast.expenses.buildings, 'Entretien routes': -e.forecast.expenses.roads, 'Salaires des services': -e.forecast.expenses.salaries, 'Intérêts': -e.forecast.expenses.loanInterest }, fmt)}</table>
    <div class="muted" style="margin-top:6px">Taux : ${Object.entries(e.taxRates).map(([k, v]) => `${({ residential: 'R', commercial: 'C', industrial: 'I', office: 'B' } as Record<string, string>)[k]} ${pct(v)}`).join(' · ')}${e.bankrupt ? ' · <span class="ko">FAILLITE</span>' : ''}</div></section>
  <section><h2>Demande</h2><div class="rci">${rciCol('Résid.', d.demand.residential)}${rciCol('Comm.', d.demand.commercial)}${rciCol('Indus.', d.demand.industrial)}${rciCol('Bureaux', d.demand.office)}</div>
    <h2 style="margin-top:10px">Services (part des habitants couverts)</h2><table>${rows(d.services, pct)}</table>
    <div class="muted" style="margin-top:6px">Attractivité ${pct(d.attractiveness)} · logements libres ${fmt(d.housingFree)} / ${fmt(d.housingCapacity)}</div></section>
  <section id="checks"><h2>Contrôles</h2><p class="muted">En cours…</p></section>`;
  renderChecks();
}

function renderChecks(): void {
  const el = document.getElementById('checks');
  if (!el) return;
  el.innerHTML = `<h2>Contrôles</h2><ul>${checks.map((c) => `<li class="${c.ok ? 'ok' : 'ko'}">${c.ok ? '✓' : '✗'} ${c.name} <span class="muted">— ${c.detail}</span></li>`).join('')}</ul>`;
}

main().catch((e) => { check('exécution', false, String(e)); $('state').textContent = `Erreur : ${String(e)}`; renderChecks(); state.done = true; });
