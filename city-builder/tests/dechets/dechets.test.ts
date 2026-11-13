/**
 * Module déchets : graphe des camions (Dijkstra, sens unique, rues piétonnes), production et bacs, tournées
 * (camions sur les routes, retour au dépôt), filières, réglages bornés, protocole (delta, instantané, transfert),
 * sauvegarde (aller-retour, déterminisme, section illisible), module inactif sans le contrat municipal.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../../src/sim/world';
import { createDechetsPlugin } from '../../src/sim/plugins/dechets';
import { createMunicipalPlugin } from '../../src/sim/municipal';
import { TruckGraph } from '../../src/sim/waste/graph';
import { activeTrucksFor, monthlyTruckBudget } from '../../src/sim/waste/system';
import { DECHETS_SAVE_VERSION, emptyDechetsSave, migrateDechets } from '../../src/sim/save-sections/dechets';
import { COLLECTION_DAYS, WASTE_PARAMS, clampSetting, facilityKindOfTags, tagNumber } from '../../src/shared/waste/types';
import { PLUGIN_TRANSFER_KEY, collectTransferables } from '../../src/shared/protocol';
import { validateSave } from '../../src/sim/save-format';
import type { DechetsDelta, DechetsSnapshot } from '../../src/shared/protocol-ext/dechets';
import { buildTown, runDays } from '../sim/fixtures';
import { buildWasteZone, wasteCatalog, wasteSim } from './fixtures';

test('étiquettes et réglages : rôles, capacités, bornes, jours de collecte', () => {
  assert.equal(facilityKindOfTags(['public', 'dechets:incinerateur']), 'incinerateur');
  assert.equal(facilityKindOfTags(['dechets:inconnu']), null);
  assert.equal(tagNumber(['camions:6'], 'camions'), 6);
  assert.equal(clampSetting('collectsPerWeek', 9.4), 7);
  assert.equal(clampSetting('collectsPerWeek', 2.6), 3);
  assert.equal(clampSetting('sortShare', 1), 0.8);
  assert.equal(clampSetting('funding', -1), 0);
  assert.equal(clampSetting('funding', Number.NaN), 1);
  for (let n = 1; n <= 7; n++) assert.equal(COLLECTION_DAYS[n]!.length, n);
  assert.equal(activeTrucksFor(4, 0.25), 1);
  assert.equal(activeTrucksFor(4, 0.74), 2);
  assert.equal(activeTrucksFor(4, 1), 4);
  assert.equal(monthlyTruckBudget(4, 0.5), 2 * WASTE_PARAMS.truckCostPerMonth);
});

test('graphe des camions : temps = longueur / vitesse, sens unique respecté, rue piétonne exclue', () => {
  const s = new Simulation([]);
  s.setCatalog(wasteCatalog());
  s.newGame({ seed: 3, mapChunks: 4, startMoney: 50_000_000, cityName: 'G', terrain: { hydrology: 'aucune', rivers: 0 } });
  assert.ok(s.buildRoad({ type: 'street', points: [0, 0, 400, 0] }).ok);
  assert.ok(s.buildRoad({ type: 'street', kind: 'oneway', points: [0, 100, 400, 100] }).ok);
  assert.ok(s.buildRoad({ type: 'street', kind: 'pedestrian', points: [0, 200, 400, 200] }).ok);
  const g = TruckGraph.build(s.net, [{ ref: 1, x: 100, z: 6 }, { ref: 2, x: 300, z: 6 }, { ref: 3, x: 100, z: 106 }, { ref: 4, x: 300, z: 106 }, { ref: 5, x: 200, z: 206 }], 18);
  assert.equal(g.attached.has(5), false, 'pas de desserte par une rue piétonne');
  const a = g.attached.get(1)!, b = g.attached.get(2)!;
  const d = g.shortest(a.node);
  const mpm = (18 * 1000) / 60;
  assert.ok(Math.abs(d[b.node]! - 200 / mpm) < 0.2, `rue : ${d[b.node]} min`);
  const pts: number[] = [];
  const tmin = g.pathTo(b.node, pts);
  assert.ok(tmin > 0 && pts.length >= 4);
  // voie de droite : vers +x, la droite est +z (repère three, y vers le haut)
  for (let i = 1; i < pts.length; i += 2) assert.ok(Math.abs(pts[i]! - 1.7) < 0.05, `décalage ${pts[i]}`);
  // Sens unique (sens du tracé : 0 -> 400) : 3 -> 4 possible, 4 -> 3 impossible.
  const c = g.attached.get(3)!, e = g.attached.get(4)!;
  assert.ok(Number.isFinite(g.shortest(c.node)[e.node]!));
  assert.equal(g.shortest(e.node)[c.node], Infinity);
});

test('production et bacs : kg/jour par habitant et par emploi, débordement au-delà de la capacité', () => {
  const T = wasteSim();
  buildTown(T.sim);
  runDays(T.sim, 3, 4);
  const w = T.dechets.waste;
  const st = T.sim.buildings;
  let expected = 0;
  for (let i = 0; i < st.count; i++) {
    const a = T.sim.getAsset(T.sim.catalog!.assets[st.assetIndex[i]!]!.id)!;
    expected += st.residents[i]! * WASTE_PARAMS.kgPerResident + st.workers[i]! * (WASTE_PARAMS.kgPerJob[a.category] ?? WASTE_PARAMS.kgPerJobDefault);
  }
  assert.ok(Math.abs(w.productionPerDay - expected) < 1e-6 * Math.max(1, expected), `${w.productionPerDay} vs ${expected}`);
  for (const b of w.bins.values()) assert.ok(b.rec + b.res <= b.cap + 1e-6);
  const s = w.summary(T.sim.clock.dayIndex);
  assert.ok(s.storedKg > 0 && s.storedKg <= s.storageKg);
  // Part triée = réglage (25 % par défaut) tant que rien n'a débordé.
  const anyBin = [...w.bins.values()].find((b) => b.rec + b.res > 1)!;
  assert.ok(Math.abs(anyBin.rec / (anyBin.rec + anyBin.res) - 0.25) < 1e-6);
});

test('tournées : camions sur les routes, arrêts aux bâtiments, vidage aux filières, retour au dépôt', () => {
  const T = wasteSim();
  buildTown(T.sim);
  buildWasteZone(T.sim);
  runDays(T.sim, 2, 4);
  const w = T.dechets.waste;
  const stored0 = w.summary(T.sim.clock.dayIndex).storedKg;
  const r = T.sim.plugins.command('dechets', 'collecter', {});
  assert.ok(r.ok);
  const tours = (r.data as { data: { tours: number } }).data.tours;
  assert.ok(tours >= 1, `tournées ${tours}`);
  assert.equal(w.runs.length, tours);
  for (const run of w.runs) {
    assert.equal(run.events.at(-1)!.kind, 'end');
    assert.ok(run.events.some((e) => e.kind === 'unload'));
    for (let k = 1; k < run.times.length; k++) assert.ok(run.times[k]! >= run.times[k - 1]! - 1e-9, 'temps croissants');
  }
  // Pendant la tournée : chaque camion est sur une chaussée (≤ 4 m de l'axe d'un tronçon carrossable).
  let samples = 0, onRoad = 0;
  for (let k = 0; k < 600 && w.runs.length; k++) {
    T.sim.tick(1);
    const p = w.truckPoses(T.sim.clock.totalMinutes);
    for (let i = 0; i < p.length; i += 4) {
      samples++;
      const near = T.sim.net.segmentNear(p[i]!, p[i + 1]!, 4);
      if (near && T.sim.net.kindOf(near.segId) !== 'pedestrian') onRoad++;
    }
  }
  assert.ok(samples > 50, `échantillons ${samples}`);
  assert.equal(onRoad, samples, 'camion hors chaussée');
  assert.equal(w.runs.length, 0, 'toutes les tournées sont terminées');
  assert.ok(w.today.collectedKg > 0.5 * stored0, `collecté ${w.today.collectedKg} / ${stored0}`);
  const tri = [...w.facilities.values()].find((f) => f.kind === 'tri')!;
  const inc = [...w.facilities.values()].find((f) => f.kind === 'incinerateur')!;
  assert.ok(tri.inToday > 0 && inc.inToday > 0, 'vidage au tri et à l\'incinérateur');
  assert.ok(Math.abs(tri.inToday + inc.inToday - w.today.collectedKg) < 1, 'tout ce qui est collecté est vidé');
  // Clôture de la journée : tri (70 % recyclés), incinération (énergie), refus de tri -> incinérateur.
  runDays(T.sim, 1, 4);
  const d = w.lastDay!;
  assert.ok(d.recycledKg > 0 && Math.abs(d.recycledKg - d.sortedKg * WASTE_PARAMS.sortRecoveryRate) < 1);
  assert.ok(d.burnedKg > 0 && Math.abs(d.energyMWh - (d.burnedKg / 1000) * WASTE_PARAMS.incinerationMWhPerTonne) < 1e-6);
  assert.ok(T.municipal.municipal.grids.require('pollution_air').at(inc.x, inc.z) > 0, 'fumées de l\'incinérateur');
});

test('protocole : delta (camions transférés, synthèse, calque), instantané, commandes', () => {
  const T = wasteSim();
  buildTown(T.sim);
  buildWasteZone(T.sim);
  runDays(T.sim, 2, 4);
  T.sim.takeDelta();
  T.sim.plugins.command('dechets', 'collecter', {});
  T.sim.tick(5);
  const d = T.sim.takeDelta().ext?.dechets as DechetsDelta | undefined;
  assert.ok(d?.trucks && d.trucks.length >= 4);
  assert.ok(d[PLUGIN_TRANSFER_KEY]?.includes(d.trucks));
  const tr = collectTransferables({ kind: 'delta', ext: { dechets: d } } as never);
  assert.ok(tr.includes(d.trucks.buffer as ArrayBuffer));
  // Synthèse et calque au plus une fois par heure de jeu.
  for (let k = 0; k < 70; k++) T.sim.tick(1);
  let sum = 0, lay = 0;
  for (let k = 0; k < 120; k++) {
    T.sim.tick(1);
    const x = T.sim.takeDelta().ext?.dechets as DechetsDelta | undefined;
    if (x?.summary) sum++;
    if (x?.layer) { lay++; assert.equal(x.layer.nuisance.length, x.layer.cols * x.layer.rows); }
  }
  assert.ok(sum >= 1 && sum <= 3, `synthèses ${sum}`);
  assert.equal(lay, sum);
  const snap = T.sim.snapshot().ext?.dechets as DechetsSnapshot;
  assert.ok(snap.summary.facilities.length === 4 && snap.layer && snap.containers.length % 3 === 0 && snap.containers.length > 0);
  const etat = T.sim.plugins.command('dechets', 'etat', {});
  assert.ok(etat.ok);
  const reg = T.sim.plugins.command('dechets', 'reglages', { collectsPerWeek: 12, sortShare: 0.5, funding: 0.5 });
  assert.ok(reg.ok);
  assert.deepEqual((reg.data as { data: { settings: unknown } }).data.settings, { collectsPerWeek: 7, sortShare: 0.5, funding: 0.5 });
  const bad = T.sim.plugins.command('dechets', 'inconnue', {});
  assert.ok(!bad.ok && bad.error.code === 'INVALID_ARGS');
});

test('sauvegarde : section dechets aller-retour, validée, déterminisme après rechargement, section illisible', () => {
  const T = wasteSim();
  buildTown(T.sim);
  buildWasteZone(T.sim);
  T.sim.plugins.command('dechets', 'reglages', { collectsPerWeek: 5, sortShare: 0.4 });
  runDays(T.sim, 4, 4);
  // Sauvegarde pendant une tournée (camions en route).
  T.sim.plugins.command('dechets', 'collecter', {});
  T.sim.tick(10);
  assert.ok(T.dechets.waste.runs.length > 0);
  const save = T.sim.toSave();
  assert.equal(save.plugins?.dechets?.v, DECHETS_SAVE_VERSION);
  const json = JSON.parse(JSON.stringify(save)) as unknown;
  assert.ok(validateSave(json).ok);
  const mp = createMunicipalPlugin(), dp = createDechetsPlugin();
  const U = new Simulation([mp, dp]);
  U.setCatalog(wasteCatalog());
  assert.equal(U.fromSave(json), null);
  const a = T.dechets.waste, b = dp.waste;
  assert.deepEqual(b.settings, a.settings);
  assert.equal(b.runs.length, a.runs.length);
  assert.equal(b.bins.size, a.bins.size);
  runDays(T.sim, 3, 4);
  runDays(U, 3, 4);
  const sa = a.summary(T.sim.clock.dayIndex), sb = b.summary(U.clock.dayIndex);
  assert.deepEqual(sb.lastDay, sa.lastDay);
  assert.ok(Math.abs(sb.totals.collectedKg - sa.totals.collectedKg) < 0.5, `${sb.totals.collectedKg} vs ${sa.totals.collectedKg}`);
  assert.ok(Math.abs(sb.storedKg - sa.storedKg) < 0.5);
  // Section illisible : notification, module remis à neuf, reste de la partie chargé.
  const bad = JSON.parse(JSON.stringify(save)) as { plugins: Record<string, { v: number; data: unknown }> };
  bad.plugins.dechets!.data = { bins: 3 };
  const dp3 = createDechetsPlugin();
  const V = new Simulation([createMunicipalPlugin(), dp3]);
  V.setCatalog(wasteCatalog());
  V.plugins.log = () => {};
  assert.equal(V.fromSave(bad), null);
  assert.equal(V.buildings.count, T.sim.buildings.count);
  assert.ok(V.notices.some((n) => n.message.includes('dechets')));
  assert.equal(dp3.waste.bins.size, 0);
  // Migration : vide -> vide ; version future refusée ; non-objet refusé.
  assert.deepEqual(migrateDechets(emptyDechetsSave(), 1), emptyDechetsSave());
  assert.throws(() => migrateDechets({}, DECHETS_SAVE_VERSION + 1), /plus récente/);
  assert.throws(() => migrateDechets('x', 1), /objet attendu/);
});

test('sans le contrat municipal : module inactif (aucun ext, aucune section, commande refusée)', () => {
  const dp = createDechetsPlugin();
  const s = new Simulation([dp]);
  s.setCatalog(wasteCatalog());
  s.newGame({ seed: 1234, mapChunks: 4, startMoney: 80_000_000, cityName: 'Sans', terrain: { hydrology: 'aucune', rivers: 0 } });
  buildTown(s);
  buildWasteZone(s);
  runDays(s, 2, 10);
  assert.equal(s.takeDelta().ext, undefined);
  assert.equal(s.snapshot().ext, undefined);
  assert.equal(s.toSave().plugins, undefined);
  const r = s.plugins.command('dechets', 'etat', {});
  assert.ok(!r.ok && r.error.code === 'NOT_IMPLEMENTED');
});
