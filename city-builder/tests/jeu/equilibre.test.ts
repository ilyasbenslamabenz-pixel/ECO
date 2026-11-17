/**
 * Équilibrage du jeu : raccordement extérieur (électricité, eau), pénalité « sans service » progressive avec période
 * de grâce, première installation sans coupure générale, entretien des lots privés, cases intérieures des zones,
 * capacité des équipements, effet des impôts, détail de la satisfaction et indice de croissance, et une partie type
 * scriptée (catalogue réel) en budget serré.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Simulation } from '../../src/sim/world';
import type { AssetCatalog } from '../../src/shared/catalog';
import { TILE_SIZE } from '../../src/shared/constants';
import { IMPORT_SPEC } from '../../src/shared/power/model';
import { WATER_IMPORT } from '../../src/shared/water-network/types';
import { residentialTaxPenalty, type DemographyReport } from '../../src/sim/demography';
import { computeDemand } from '../../src/sim/zoning';
import { buildStreet, buildTown, newTownSim, runDays, townCatalog } from '../sim/fixtures';
import { advanceHours, placeFacilities, powerCatalog } from '../electricite/fixtures';
import { zoningTown } from '../zonage/fixtures';

const cmd = (s: Simulation, plugin: string, name: string, payload?: unknown): { ok: boolean; data?: any; error?: any } => {
  const r = s.plugins.command(plugin, name, payload) as any;
  return r.ok ? { ok: true, data: r.data?.data ?? r.data } : { ok: false, error: r.error ?? r };
};
const report = (s: Simulation): DemographyReport => s.demography!.report(s.clock.totalMinutes, s.economy.taxRates.residential);
const factor = (r: DemographyReport, key: string): number => r.satisfactionFactors.find((f) => f.key === key)!.delta;
const elecService = (s: Simulation): { serviceState(id: number): string; hasNetwork(): boolean } => s.plugins.service('electricite')!;
const houses = (s: Simulation): number[] => {
  const out: number[] = [];
  for (let i = 0; i < s.buildings.count; i++) if (s.catalog!.assets[s.buildings.assetIndex[i]!]!.capacity.residents > 0) out.push(s.buildings.id[i]!);
  return out;
};

/* ------------------------------ Raccordement extérieur ------------------------------ */

test('raccordement électrique : ville desservie sans centrale, frais uniques, achat facturé au kWh, appoint des centrales', () => {
  const s = newTownSim(20_000_000); buildTown(s);
  assert.ok(s.buildRoad({ type: 'street', points: [-220, 0, -220, 80] }).ok);
  runDays(s, 1);
  assert.equal(elecService(s).hasNetwork(), false);
  const m0 = s.economy.money;
  const r = cmd(s, 'electricite', 'raccordement', { on: true });
  assert.ok(r.ok, JSON.stringify(r.error));
  assert.equal(r.data.raccordement, true);
  assert.equal(Math.round(m0 - s.economy.money), IMPORT_SPEC.connectionChf, 'frais de raccordement');
  assert.ok(elecService(s).hasNetwork());
  runDays(s, 1);
  const st = cmd(s, 'electricite', 'state').data;
  assert.ok(st.summary.importedKw > 0, `import ${st.summary.importedKw} kW`);
  assert.equal(st.summary.cut, 0);
  for (const id of houses(s)) assert.equal(elecService(s).serviceState(id), 'ok');
  // Facture du mois : achat > vente (le kWh importé coûte plus cher que le tarif de revente).
  runDays(s, 31);
  const b = cmd(s, 'electricite', 'state').data.budget;
  assert.ok(b.lastImportCost > b.lastIncome, `achat ${b.lastImportCost} ¢ > vente ${b.lastIncome} ¢`);
  // Résiliation gratuite ; nouveau raccordement refusé sans trésorerie.
  assert.ok(cmd(s, 'electricite', 'raccordement', { on: false }).ok);
  s.economy.money = 1000;
  const refused = cmd(s, 'electricite', 'raccordement', { on: true });
  assert.ok(!refused.ok && /Fonds insuffisants/.test(refused.error.message));
});

test('raccordement électrique : appoint d\'une centrale trop faible (aucune coupure), sauvegarde fidèle', () => {
  const s = new Simulation(); s.setCatalog(powerCatalog());
  s.newGame({ seed: 1234, mapChunks: 4, startMoney: 80_000_000, cityName: 'Bourg-Appoint', terrain: { hydrology: 'aucune', rivers: 0 } });
  buildTown(s);
  assert.ok(s.buildRoad({ type: 'street', points: [-220, 0, -220, 80] }).ok);
  advanceHours(s, 48);
  placeFacilities(s, 160, -100, 100, ['petite_centrale']); // 150 kW pour une demande bien supérieure
  advanceHours(s, 3);
  assert.ok(cmd(s, 'electricite', 'state').data.summary.cut > 0, 'pénurie sans raccordement');
  assert.ok(cmd(s, 'electricite', 'raccordement', { on: true }).ok);
  advanceHours(s, 2);
  const sum = cmd(s, 'electricite', 'state').data.summary;
  assert.equal(sum.cut, 0, 'le réseau extérieur complète la centrale');
  assert.ok(sum.importedKw > 0 && sum.producedKw > 0, 'centrale appelée d\'abord, import en appoint');
  const save = JSON.parse(JSON.stringify(s.toSave()));
  const c = new Simulation(); c.setCatalog(powerCatalog());
  assert.equal(c.fromSave(save), null);
  assert.equal(cmd(c, 'electricite', 'state').data.settings.raccordement, true, 'raccordement conservé');
});

test('raccordement eau : ville desservie sans installation, eau achetée au m³, frais uniques', () => {
  const s = newTownSim(20_000_000); buildTown(s);
  assert.ok(s.buildRoad({ type: 'street', points: [-220, 0, -220, 80] }).ok);
  runDays(s, 1);
  const eau = s.plugins.service<{ serviceState(id: number): string }>('eau')!;
  for (const id of houses(s)) assert.equal(eau.serviceState(id), 'aucun', 'aucun service d\'eau');
  const m0 = s.economy.money;
  const r = cmd(s, 'eau', 'raccordement', { on: true });
  assert.ok(r.ok && r.data.raccordement === true);
  assert.equal(Math.round(m0 - s.economy.money), WATER_IMPORT.connectionChf);
  // Le réglage ordinaire ne peut pas raccorder gratuitement.
  assert.ok(cmd(s, 'eau', 'settings', { raccordement: false }).data.raccordement === true);
  runDays(s, 2);
  const st = cmd(s, 'eau', 'state').data;
  assert.ok(st.active);
  assert.ok(st.balance.servedShare > 0.9, `desserte ${st.balance.servedShare}`);
  assert.ok(st.budget.current.lines['achat:eau_exterieure'] > 0, 'eau achetée au voisin');
  for (const id of houses(s)) assert.equal(eau.serviceState(id), 'ok');
});

test('lieux de travail délestés : l\'indice de croissance réclame du courant (pas « créez des emplois »)', () => {
  const s = new Simulation(); s.setCatalog(powerCatalog());
  s.newGame({ seed: 1234, mapChunks: 4, startMoney: 80_000_000, cityName: 'Bourg-Délesté', terrain: { hydrology: 'aucune', rivers: 0 } });
  buildTown(s);
  assert.ok(s.buildRoad({ type: 'street', points: [-220, 0, -220, 80] }).ok);
  advanceHours(s, 48);
  placeFacilities(s, 160, -100, 100, ['petite_centrale']); // 150 kW : l'industrie et les bureaux sont délestés en premier
  advanceHours(s, 3);
  const sum = cmd(s, 'electricite', 'state').data.summary;
  assert.ok(sum.jobsWithoutPower > 0, `emplois sans courant ${sum.jobsWithoutPower}`);
  assert.equal(report(s).growthHint, 'need-power');
  // Courant rétabli (raccordement) : l'indice disparaît.
  assert.ok(cmd(s, 'electricite', 'raccordement', { on: true }).ok);
  advanceHours(s, 3);
  assert.notEqual(report(s).growthHint, 'need-power');
});

/* ------------------------------ Sans service, première installation ------------------------------ */

test('sans service : aucune pénalité pendant le premier mois, puis pénalité progressive (électricité, eau)', () => {
  const s = newTownSim(); buildTown(s);
  runDays(s, 10);
  const early = report(s);
  assert.ok(early.population > 50);
  assert.equal(factor(early, 'electricite'), 0, 'période de grâce');
  assert.equal(factor(early, 'eau'), 0);
  runDays(s, 35); // jour 45 : mi-rampe
  const mid = report(s);
  runDays(s, 25); // jour 70 : pleine pénalité
  const late = report(s);
  assert.ok(factor(mid, 'electricite') < -2 && factor(mid, 'electricite') > -9, `mi-rampe ${factor(mid, 'electricite')}`);
  assert.ok(factor(late, 'electricite') <= -9.5, `pleine pénalité ${factor(late, 'electricite')}`);
  assert.ok(factor(late, 'eau') <= -9.5);
  assert.ok(late.vacancyReasons.sansEau + late.vacancyReasons.sansElectricite + late.vacancyReasons.demandeFaible + late.vacancyReasons.sansAcces >= 0);
});

test('première installation : les bâtiments qu\'elle ne dessert pas restent « sans service » (ni coupés, ni privés d\'emploi)', () => {
  const s = new Simulation(); s.setCatalog(powerCatalog());
  s.newGame({ seed: 1234, mapChunks: 4, startMoney: 80_000_000, cityName: 'Bourg-Premier', terrain: { hydrology: 'aucune', rivers: 0 } });
  buildTown(s); // deux rues non reliées
  advanceHours(s, 48);
  const pop0 = report(s).population;
  // Éolienne sur une rue isolée : elle ne dessert aucun bâtiment de la ville.
  placeFacilities(s, 240, 60, 200, ['eolienne'], false);
  advanceHours(s, 24);
  const e = elecService(s);
  assert.ok(e.hasNetwork());
  for (const id of houses(s)) assert.equal(e.serviceState(id), 'aucun');
  assert.equal(s.demography!.activity(houses(s)[0]!), 1, 'activité maintenue');
  const r = report(s);
  assert.ok(r.population >= pop0 * 0.95, `population ${pop0} -> ${r.population}`);
  assert.ok(r.unemploymentRate < 0.5, `chômage ${r.unemploymentRate}`);
});

/* ------------------------------ Zonage : entretien privé, cases intérieures ------------------------------ */

test('lots privés : leur entretien n\'est pas payé par la ville (pose, démolition, rechargement)', () => {
  const s = newTownSim();
  assert.ok(s.buildRoad({ type: 'street', points: [-200, 0, 200, 0] }).ok);
  const up0 = s.economy.buildingUpkeep;
  const p = s.placePrivateBuilding({ assetId: 'immeuble', x: -100, z: -20, rot: 0 });
  assert.ok(p.ok);
  assert.equal(s.economy.buildingUpkeep, up0, 'aucun entretien ajouté');
  const own = s.placeBuilding({ assetId: 'immeuble', x: 0, z: -20, rot: 0 });
  assert.ok(own.ok);
  assert.equal(s.economy.buildingUpkeep, up0 + 800, 'bâtiment du joueur : entretien facturé');
  const save = JSON.parse(JSON.stringify(s.toSave()));
  const c = new Simulation(); c.setCatalog(townCatalog());
  assert.equal(c.fromSave(save), null);
  assert.equal(c.economy.buildingUpkeep, up0 + 800, 'rechargement : lots privés toujours exclus');
  assert.ok(s.demolish({ buildingId: p.data.buildingId }).ok);
  assert.equal(s.economy.buildingUpkeep, up0 + 800);
});

test('zonage : les 2e et 3e rangées se construisent et sont desservies (allée)', () => {
  const t = zoningTown();
  assert.ok(t.sim.buildRoad({ type: 'street', points: [-200, 0, 200, 0] }).ok);
  t.cmd('paint', { points: [-190, 0, 190, 0], zone: 'res_faible', depth: 3 });
  advanceHours(t.sim, 24 * 8);
  const st = t.sim.buildings;
  let back = 0;
  for (const id of t.sys.owned.keys()) {
    const i = st.indexOf(id);
    if (i < 0) continue;
    // Centre à plus de 1,5 case de l'axe : bâtiment de 2e/3e rangée (la 1re rangée a son centre vers 13 m).
    if (Math.abs(st.z[i]!) > 5 + 1.5 * TILE_SIZE + 4) { back++; assert.equal(st.roadAccess[i], 1, 'lot intérieur desservi'); }
  }
  assert.ok(back >= 4, `${back} bâtiments en 2e/3e rangée`);
  const lots = t.sys.residentialLots();
  assert.ok(lots.zoned > 0 && lots.free >= 0);
});

/* ------------------------------ Capacité, impôts ------------------------------ */

test('capacité des équipements : un centre de santé ne couvre que les habitants qu\'il peut soigner', () => {
  const cat = townCatalog();
  cat.assets.find((a) => a.id === 'hopital')!.tags = ['service:sante', 'rayon:2500', 'capacite_service:2']; // 2 × 20 habitants
  const s = new Simulation(); s.setCatalog(cat);
  s.newGame({ seed: 1234, mapChunks: 4, startMoney: 50_000_000, cityName: 'Bourg-Soins', terrain: { hydrology: 'aucune', rivers: 0 } });
  buildTown(s);
  runDays(s, 6);
  const r = report(s);
  assert.ok(r.population > 100);
  const share = r.services['Santé']!;
  assert.ok(share > 0 && share < 0.6, `part soignée ${share}`);
});

test('impôts : au-delà de 12 %, satisfaction et demande baissent nettement', () => {
  assert.ok(residentialTaxPenalty(0.12) < 5);
  assert.ok(residentialTaxPenalty(0.15) > 20, 'pénalité marquée à 15 %');
  assert.ok(residentialTaxPenalty(0.07) < 0, 'impôts bas : bonus');
  const base = { population: 500, workforce: 300, housingCapacity: 600, housingFree: 30, jobsBySector: { R: 0, C: 20, B: 0, I: 300, public: 0 } };
  const d9 = computeDemand({ ...base, tax: { R: 0.09 } }).R, d12 = computeDemand({ ...base, tax: { R: 0.12 } }).R, d15 = computeDemand({ ...base, tax: { R: 0.15 } }).R;
  assert.ok(d9 - d12 < 0.15 && d12 - d15 > 0.4, `demande R ${d9.toFixed(2)} / ${d12.toFixed(2)} / ${d15.toFixed(2)}`);
  const s = newTownSim(); buildTown(s);
  runDays(s, 3);
  const f9 = factor(report(s), 'impots');
  assert.ok(s.runExt('setTaxRate', { sector: 'residential', rate: 0.15 }).ok);
  runDays(s, 1);
  assert.ok(factor(report(s), 'impots') < f9 - 15, 'impôts visibles dans le détail de la satisfaction');
});

/* ------------------------------ Rapport : détail, vacance, indice ------------------------------ */

test('rapport : détail de la satisfaction, logements vides par raison, indice de croissance', () => {
  const s = newTownSim();
  let r = report(s);
  assert.equal(r.growthHint, 'need-roads', 'aucune route');
  assert.deepEqual(r.satisfactionFactors.map((f) => f.key), ['emploi', 'loyer', 'logement', 'electricite', 'eau', 'dechets', 'sante', 'police', 'pompiers', 'education', 'loisirs', 'equipements', 'pollution', 'bruit', 'trajet', 'impots', 'politiques']);
  assert.ok(r.satisfactionFactors.every((f) => typeof f.label === 'string' && f.label.length > 0 && Number.isFinite(f.delta)));
  assert.ok(s.buildRoad({ type: 'street', points: [-200, 0, 200, 0] }).ok);
  assert.equal(report(s).growthHint, 'need-zones', 'routes sans zone');
  buildStreet(s, 80, -220, 220, ['maison', 'maison']);
  // Maison sans accès : comptée « sans accès ».
  assert.ok(s.placeBuilding({ assetId: 'maison', x: 0, z: -150, rot: 0 }).ok);
  runDays(s, 2);
  r = report(s);
  assert.ok(r.vacancyReasons.sansAcces >= 1, JSON.stringify(r.vacancyReasons));
  const sum = r.satisfactionFactors.reduce((a, f) => a + f.delta, 0);
  assert.ok(Math.abs(55 + sum - r.happiness) < 25, `55 + Σ facteurs (${(55 + sum).toFixed(1)}) proche de la satisfaction ${r.happiness.toFixed(1)}`);
  // Chemin exposé au client : rapport de la simulation (getReport / livraison périodique du worker).
  const rep = s.report(false);
  assert.ok(Array.isArray(rep.demography.satisfactionFactors) && 'vacancyReasons' in rep.demography && 'growthHint' in rep.demography);
});

/* ------------------------------ Partie type (catalogue réel) ------------------------------ */

const realCatalog = (): AssetCatalog => JSON.parse(readFileSync(join(import.meta.dirname, '../../assets/catalog.json'), 'utf8')) as AssetCatalog;

test('partie type en budget serré (1 M) : raccordement, services de base, ni faillite ni trésor qui explose (4 mois)', () => {
  const s = new Simulation(); s.setCatalog(realCatalog());
  s.newGame({ seed: 4242, mapChunks: 8, startMoney: 1_000_000, cityName: 'Essai-Serré', startHour: 9, startMonth: 4, terrain: { hydrology: 'aucune', rivers: 0 } });
  for (const z of [-160, -80, 0, 80]) assert.ok(s.buildRoad({ type: 'street', points: [-240, z, 240, z] }).ok);
  for (const x of [-240, 0, 240]) assert.ok(s.buildRoad({ type: 'street', points: [x, -240, x, 160] }).ok);
  assert.ok(s.buildRoad({ type: 'street', points: [-240, -240, 240, -240] }).ok);
  for (const [z, zone] of [[-160, 'res_faible'], [-80, 'res_faible'], [0, 'commerce'], [80, 'industrie']] as const) assert.ok(cmd(s, 'zonage', 'paint', { points: [-236, z, 236, z], zone, depth: 3 }).ok);
  assert.ok(cmd(s, 'electricite', 'raccordement', { on: true }).ok);
  assert.ok(cmd(s, 'eau', 'raccordement', { on: true }).ok);
  let x = -232;
  const place = (id: string): void => {
    const a = s.getAsset(id)!;
    const w = a.footprint.tilesX * TILE_SIZE, d = a.footprint.tilesZ * TILE_SIZE;
    const r = s.placeBuilding({ assetId: id, x: x + w / 2, z: -240 - 7 - d / 2, rot: 0 });
    assert.ok(r.ok, `${id} : ${!r.ok ? r.error.message : ''}`);
    x += w + 4;
  };
  place('dechets_depot_camions'); place('dechets_decharge');
  const spent = 1_000_000 - s.economy.money;
  assert.ok(s.economy.money > 0, `reste ${s.economy.money} après ${spent} d'investissements`);
  // Puis les services dès que la trésorerie le permet (choix d'un budget serré : un équipement à la fois).
  const next = ['proc_ecole_moderne', 'proc_centre_sante', 'public_commissariat'];
  const money: number[] = [];
  for (let d = 0; d < 120; d++) {
    if (next.length && s.economy.money > s.getAsset(next[0]!)!.cost + 50_000) place(next.shift()!);
    runDays(s, 1, 10);
    if (d % 30 === 29) money.push(s.economy.money);
  }
  assert.ok(next.length < 3, 'au moins un service construit avec les recettes');
  const r = report(s);
  assert.ok(!s.economy.bankrupt && Math.min(...money) > 0, `trésorerie ${money.map((v) => Math.round(v / 1000)).join(' / ')} k`);
  assert.ok(money[3]! < 3_000_000, 'trésorerie maîtrisée');
  // 450 habitants et plus : depuis le calage des lots sur la trame de la route (a57b90a), sans replis hors trame, une
  // rangée zonée porte un peu moins de lots (454 mesurés, contre ~500 avant).
  assert.ok(r.population > 430, `population ${r.population}`);
  assert.ok(r.happiness > 33, `satisfaction ${r.happiness.toFixed(1)} : ${r.satisfactionFactors.map((f) => `${f.key} ${f.delta}`).join(', ')}`);
});
