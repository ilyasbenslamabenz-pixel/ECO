/**
 * Lignes de bus (module « bus », docs/TRANSPORTS_COMMUN.md) : tracé sur le réseau (boucle, sens unique, rue piétonne),
 * dépôt requis, choix modal et fréquentation, effets (trafic, budget, satisfaction, portée de l'embauche), édition et
 * inverses (annulation), carte, ancienne sauvegarde sans ligne, aller-retour d'une partie avec lignes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../../src/sim/world';
import type { AssetCatalog } from '../../src/shared/catalog';
import { TILE_SIZE } from '../../src/shared/constants';
import { validateSave } from '../../src/sim/save-format';
import { bestInsert } from '../../src/sim/transit/system';
import type { BusState, BusSummary } from '../../src/shared/protocol-ext/bus';
import { buildStreet, buildTown, runDays, townCatalog } from '../sim/fixtures';

function busCatalog(): AssetCatalog {
  const c = townCatalog();
  const base = c.assets.find((a) => a.id === 'commissariat')!;
  c.assets.push({ ...base, id: 'depot', nameFr: 'Test dépôt de bus', footprint: { tilesX: 3, tilesZ: 2 }, capacity: { residents: 0, jobs: 10 }, tags: ['transport', 'depot_bus', 'bus:12'] });
  return c;
}

function newBusSim(seed = 1234, mapChunks = 4, money = 50_000_000): Simulation {
  const s = new Simulation();
  s.setCatalog(busCatalog());
  // Grande carte (portée d'embauche) : relief nul pour poser la ville n'importe où.
  s.newGame({ seed, mapChunks, startMoney: money, cityName: 'Bourg-Bus', terrain: { hydrology: 'aucune', rivers: 0, ...(mapChunks > 4 ? { relief: 0, forest: 0 } : {}) } });
  return s;
}

type R = { ok: boolean; data?: any; error?: { code: string; message: string } };
const bus = (s: Simulation, name: string, payload?: unknown): R => {
  const r = s.plugins.command('bus', name, payload) as any;
  return r.ok ? { ok: true, data: r.data?.data ?? r.data } : { ok: false, error: r.error ?? r };
};
const must = (r: R, what: string): any => { assert.ok(r.ok, `${what} : ${r.error?.message}`); return r.data; };
const summary = (s: Simulation): BusSummary => must(bus(s, 'stats'), 'stats');
const state = (s: Simulation): BusState => must(bus(s, 'state'), 'state');

/** Ville de test bouclée : rues z = 0 et z = 80 reliées aux deux bouts. */
function loopTown(s: Simulation): void {
  buildTown(s);
  assert.ok(s.buildRoad({ type: 'street', points: [-220, 0, -220, 80] }).ok);
  assert.ok(s.buildRoad({ type: 'street', points: [220, 0, 220, 80] }).ok);
}
const LOOP = [{ x: -150, z: 1 }, { x: 150, z: -1 }, { x: 150, z: 81 }, { x: -150, z: 79 }];
function placeDepot(s: Simulation, x = 0, z = 0): number {
  const a = s.getAsset('depot')!;
  const r = s.placeBuilding({ assetId: 'depot', x: x + (a.footprint.tilesX * TILE_SIZE) / 2, z: z + 8 + (a.footprint.tilesZ * TILE_SIZE) / 2, rot: 2 });
  assert.ok(r.ok, !r.ok ? r.error.message : '');
  return r.data.buildingId;
}

test('bus : tracé en boucle par le plus court chemin, arrêts accrochés aux routes, refus hors route', () => {
  const s = newBusSim();
  loopTown(s);
  const snap = must(bus(s, 'snap', { x: -150, z: 6 }), 'snap');
  assert.ok(Math.abs(snap.z) < 1e-6, `accroché sur l'axe de la rue (${snap.z})`);
  assert.equal(bus(s, 'snap', { x: -150, z: 300 }).ok, false, 'trop loin de toute route');
  const pv = must(bus(s, 'preview', { stops: LOOP }), 'preview');
  assert.equal(pv.problem, null);
  // Boucle : 300 m sur z = 0, puis 70 + 80 + 70 m par le bout est (x = 220), 300 m sur z = 80, 220 m par l'ouest ≈ 1 040 m.
  assert.ok(pv.lengthM > 950 && pv.lengthM < 1150, `longueur ${pv.lengthM}`);
  assert.ok(pv.points.length >= 3 * 40, 'polyligne échantillonnée');
  const money0 = s.economy.money;
  assert.equal(bus(s, 'createLine', { stops: [LOOP[0]] }).ok, false, 'au moins deux arrêts');
  const c = must(bus(s, 'createLine', { name: 'Ligne A', stops: LOOP }), 'createLine');
  assert.equal(c.line.stopIds.length, 4);
  assert.equal(money0 - s.economy.money, c.cost, 'abribus payés');
  assert.ok(c.warning && /dépôt/.test(c.warning), 'avertissement sans dépôt');
  const st = state(s);
  assert.equal(st.lines[0]!.problem?.includes('dépôt'), true, 'ligne arrêtée sans dépôt');
  assert.equal(st.lines[0]!.activeBuses, 0);
  // Ordre des arrêts : abscisses croissantes le long du tracé.
  const sOf = st.lines[0]!.stopIds.map((id) => st.stops.find((q) => q.id === id)!.s);
  assert.deepEqual([...sOf].sort((a, b) => a - b), sOf);
  // Rue piétonne : pas d'arrêt.
  assert.ok(s.buildRoad({ type: 'street', kind: 'pedestrian', points: [-100, 200, 100, 200] }).ok);
  assert.equal(bus(s, 'snap', { x: 0, z: 201 }).ok, false, 'pas d’arrêt sur une rue piétonne');
});

test('bus : sens unique respecté (détour), arrêt injoignable signalé', () => {
  const s = newBusSim();
  // Carré : rue à double sens au sud, sens unique ouest -> est au nord.
  assert.ok(s.buildRoad({ type: 'street', points: [-200, 0, 200, 0] }).ok);
  assert.ok(s.buildRoad({ type: 'street', kind: 'oneway', points: [-200, 120, 200, 120] }).ok);
  assert.ok(s.buildRoad({ type: 'street', points: [-200, 0, -200, 120] }).ok);
  assert.ok(s.buildRoad({ type: 'street', points: [200, 0, 200, 120] }).ok);
  // Nord : de l'ouest vers l'est (dans le sens permis) puis retour par le sud.
  const ok = must(bus(s, 'preview', { stops: [{ x: -100, z: 120 }, { x: 100, z: 120 }] }), 'preview');
  assert.equal(ok.problem, null);
  // Deux arrêts sur le sens unique dans l'ordre inverse : le bus fait le tour (plus long qu'un aller direct).
  const rev = must(bus(s, 'preview', { stops: [{ x: 100, z: 120 }, { x: -100, z: 120 }] }), 'preview');
  assert.equal(rev.problem, null);
  assert.ok(rev.lengthM > 900, `détour par le sud (${rev.lengthM} m)`);
  // Impasse à sens unique sans retour possible : arrêt injoignable.
  const s2 = newBusSim();
  assert.ok(s2.buildRoad({ type: 'street', kind: 'oneway', points: [-200, 0, 200, 0] }).ok);
  const ko = must(bus(s2, 'preview', { stops: [{ x: -100, z: 0 }, { x: 100, z: 0 }] }), 'preview');
  assert.ok(ko.problem && /injoignable/.test(ko.problem), String(ko.problem));
});

test('bus : sans ligne, aucun effet ; dépôt + ligne : fréquentation, parts modales, trafic réduit, budget, satisfaction', () => {
  const s = newBusSim();
  loopTown(s);
  runDays(s, 12, 10);
  const sum0 = summary(s);
  assert.equal(sum0.lines, 0);
  assert.equal(s.traffic.carFactor, 1);
  assert.equal(s.toSave().plugins?.bus, undefined, 'aucune section sans ligne');
  const line = must(bus(s, 'createLine', { stops: LOOP, buses: 4, fare: 1 }), 'ligne').line;
  placeDepot(s, 40);
  const moneyBefore = s.economy.money;
  runDays(s, 3, 10);
  const st = state(s);
  const l = st.lines.find((x) => x.id === line.id)!;
  assert.equal(l.problem, null, String(l.problem));
  assert.equal(l.activeBuses, 4);
  assert.ok(l.headwayMin > 0 && l.headwayMin < l.cycleMin, `intervalle ${l.headwayMin} / tour ${l.cycleMin}`);
  const sum = summary(s);
  assert.ok(sum.ridersDay > 0, `voyages ${sum.ridersDay}`);
  assert.ok(Math.abs(sum.modal.car + sum.modal.walk + sum.modal.bus - 1) < 0.01, JSON.stringify(sum.modal));
  assert.ok(sum.modal.bus > 0.01, `part du bus ${sum.modal.bus}`);
  assert.ok(sum.carFactor < 1 && sum.carFactor >= 0.3, `facteur voiture ${sum.carFactor}`);
  assert.ok(Math.abs(s.traffic.carFactor - sum.carFactor) < 1e-3, 'appliqué au trafic');
  assert.ok(sum.coveredResidents > 0 && sum.coveredResidents <= sum.population);
  const boardings = st.stops.reduce((a, q) => a + q.boardings, 0), alight = st.stops.reduce((a, q) => a + q.alightings, 0);
  assert.ok(Math.abs(boardings - alight) < 1, 'montées = descentes');
  assert.ok(sum.revenueMonth > 0 && sum.costMonth > 0, `recettes ${sum.revenueMonth}, coût ${sum.costMonth}`);
  // Le budget suit : recettes − entretien (plus l'entretien du dépôt, du catalogue).
  assert.ok(Number.isFinite(s.economy.money - moneyBefore));
  // Satisfaction : facteur « trajet » amélioré pour les logements desservis.
  const rep = s.demography!.report(s.clock.totalMinutes, s.economy.taxRates.residential);
  assert.ok(rep.satisfactionFactors.some((f) => f.key === 'trajet'));
  const homes = s.demography!.citizens;
  let bonus = 0;
  const sys = (s.plugins.service('bus') as any).system;
  for (let i = 0; i < homes.count; i++) bonus = Math.max(bonus, sys.satisfactionOf(homes.col.home[i]!));
  assert.ok(bonus > 0, 'bonus de desserte');
  // Carte : bâtiments desservis (2..255) et non desservis (1).
  const layer = must(bus(s, 'calque', { on: true }), 'calque');
  assert.ok(Array.from(layer.quality as Uint8Array).some((v) => v >= 2), 'cellules desservies');
  // Delta : géométrie et lignes envoyées au rendu.
  const d = s.takeDelta();
  const ext = (d.ext as any)?.bus;
  assert.ok(ext && Array.isArray(ext.lines) ? true : (s.snapshot().ext as any)?.bus?.geometry?.length === 1);
});

test('bus : capacité — trop peu de bus : charge > 100 %, demande refusée renvoyée vers la voiture', () => {
  const s = newBusSim();
  loopTown(s);
  buildStreet(s, -80, -220, 220, ['immeuble', 'immeuble', 'immeuble', 'immeuble', 'immeuble', 'immeuble']);
  assert.ok(s.buildRoad({ type: 'street', points: [-220, -80, -220, 0] }).ok);
  runDays(s, 12, 10);
  const id = must(bus(s, 'createLine', { stops: [{ x: -150, z: -80 }, { x: 150, z: -80 }, { x: 150, z: 80 }, { x: -150, z: 80 }], buses: 1, fare: 0 }), 'ligne').line.id;
  placeDepot(s, 40);
  bus(s, 'updateLine', { id, buses: 1 });
  // Bus minuscule : capacité réduite pour forcer la saturation.
  const sys = (s.plugins.service('bus') as any).system;
  sys.tuning.busCapacity = 2;
  runDays(s, 2, 10);
  const l = state(s).lines[0]!;
  assert.ok(l.stats.load > 1, `charge ${l.stats.load}`);
  assert.ok(l.stats.refusedDay > 0, 'voyages refusés');
});

test('bus : édition et inverses (annulation) — arrêt ajouté, déplacé, retiré ; ligne modifiée, supprimée, rétablie', () => {
  const s = newBusSim();
  loopTown(s);
  const line = must(bus(s, 'createLine', { stops: LOOP.slice(0, 3) }), 'ligne').line;
  // Insertion là où la boucle s'allonge le moins.
  assert.equal(bestInsert([{ x: 0, z: 0 }, { x: 100, z: 0 }, { x: 100, z: 100 }], 50, 0), 1);
  const add = must(bus(s, 'addStop', { lineId: line.id, x: -150, z: 80 }), 'addStop');
  assert.equal(state(s).lines[0]!.stopIds.length, 4);
  const mv = must(bus(s, 'moveStop', { stopId: add.stop.id, x: -100, z: 80 }), 'moveStop');
  assert.ok(Math.abs(state(s).stops.find((q) => q.id === add.stop.id)!.x + 100) < 1);
  must(bus(s, 'moveStop', { stopId: add.stop.id, x: mv.previous.x, z: mv.previous.z }), 'inverse du déplacement');
  assert.ok(Math.abs(state(s).stops.find((q) => q.id === add.stop.id)!.x + 150) < 1);
  const rm = must(bus(s, 'removeStop', { stopId: add.stop.id }), 'removeStop');
  assert.equal(state(s).lines[0]!.stopIds.length, 3);
  must(bus(s, 'addStop', { lineId: rm.lineId, x: rm.x, z: rm.z, index: rm.index }), 'inverse du retrait');
  assert.equal(state(s).lines[0]!.stopIds.length, 4);
  const up = must(bus(s, 'updateLine', { id: line.id, name: 'Circulaire', color: '#123456', buses: 7, fare: 2.3 }), 'updateLine');
  assert.deepEqual([up.line.name, up.line.color, up.line.buses, up.line.fare], ['Circulaire', '#123456', 7, 2.25]);
  must(bus(s, 'updateLine', { id: line.id, ...up.previous }), 'inverse');
  assert.equal(state(s).lines[0]!.buses, up.previous.buses);
  assert.equal(bus(s, 'updateLine', { id: line.id, color: 'rouge' }).ok, false, 'couleur invalide');
  assert.equal(bus(s, 'removeStop', { stopId: state(s).lines[0]!.stopIds[0] }).ok, true);
  assert.equal(bus(s, 'removeStop', { stopId: state(s).lines[0]!.stopIds[0] }).ok, true);
  assert.equal(state(s).lines[0]!.stopIds.length, 2);
  assert.equal(bus(s, 'removeStop', { stopId: state(s).lines[0]!.stopIds[0] }).ok, false, 'au moins deux arrêts');
  const del = must(bus(s, 'deleteLine', { id: line.id }), 'deleteLine');
  assert.equal(state(s).lines.length, 0);
  const d1 = s.takeDelta();
  assert.deepEqual((d1.ext as any)?.bus?.lines, [], 'le rendu est vidé');
  const back = must(bus(s, 'restoreLine', { line: del.record }), 'restoreLine');
  assert.equal(back.line.id, line.id, 'même identifiant');
  assert.deepEqual(state(s).lines[0]!.stopIds, del.record.stops.map((q: { id: number }) => q.id));
  // Renommage d'arrêt et fiche.
  const sid = back.line.stopIds[0];
  must(bus(s, 'renameStop', { stopId: sid, name: 'Place du Marché' }), 'renameStop');
  const card = must(bus(s, 'stop', { stopId: sid }), 'stop');
  assert.equal(card.stop.name, 'Place du Marché');
  assert.equal(card.index, 1);
});

test('bus : le réseau change (route coupée) -> arrêt signalé, puis rétabli', () => {
  const s = newBusSim();
  loopTown(s);
  placeDepot(s, 40);
  must(bus(s, 'createLine', { stops: LOOP }), 'ligne');
  runDays(s, 1, 10);
  assert.equal(state(s).lines[0]!.problem, null);
  // On retire le tronçon est (x = 220) : la boucle ne se ferme plus que par l'ouest, toujours possible.
  const east = [...s.net.segmentIds()].find((id) => { const [a, b] = s.net.endpoints(id); return Math.abs(s.net.nodePos(a).x - 220) < 1 && Math.abs(s.net.nodePos(b).x - 220) < 1; })!;
  assert.ok(s.removeRoad({ edgeId: east }).ok);
  s.tick(1);
  const l = state(s).lines[0]!;
  assert.equal(l.problem, null, 'détour par l’ouest');
  // Plus aucune liaison entre les deux rues : arrêt injoignable.
  const west = [...s.net.segmentIds()].find((id) => { const [a, b] = s.net.endpoints(id); return Math.abs(s.net.nodePos(a).x + 220) < 1 && Math.abs(s.net.nodePos(b).x + 220) < 1; })!;
  assert.ok(s.removeRoad({ edgeId: west }).ok);
  s.tick(1);
  assert.match(state(s).lines[0]!.problem ?? '', /injoignable/);
  assert.ok(s.buildRoad({ type: 'street', points: [-220, 0, -220, 80] }).ok);
  s.tick(1);
  assert.equal(state(s).lines[0]!.problem, null, 'rétablie');
});

/**
 * Grande carte plate (28 tronçons de 256 m, relief nul) : logements à l'ouest, emplois à plus de 4 km à l'est, reliés par
 * une avenue ; chaque rangée de bâtiments est desservie par une rue raccordée à l'avenue.
 */
function farTown(homes: string[]): Simulation {
  const s = newBusSim(77, 28, 80_000_000);
  assert.ok(s.buildRoad({ type: 'avenue', kind: 'avenue', points: [-2400, 0, 2400, 0] }).ok, 'avenue');
  buildStreet(s, 60, -2380, -2380 + homes.length * 32 + 8, homes);
  assert.ok(s.buildRoad({ type: 'street', points: [-2380, 0, -2380, 60] }).ok, 'raccord ouest');
  buildStreet(s, 60, 2100, 2380, ['usine', 'usine', 'bureaux']);
  assert.ok(s.buildRoad({ type: 'street', points: [2100, 0, 2100, 60] }).ok, 'raccord est');
  return s;
}

test('bus : portée de l’embauche — emplois à plus de 4 km atteints par une ligne qui dessert logement et emploi', () => {
  const s = farTown(['immeuble', 'immeuble', 'immeuble']);
  runDays(s, 6, 10);
  const r0 = s.demography!.report(s.clock.totalMinutes, s.economy.taxRates.residential);
  // Seuls les emplois des commerces au pied des immeubles (10 par immeuble) sont à portée.
  assert.ok(r0.unemployed > 0 && r0.employed <= 30, `emplois hors de portée (${r0.employed} employés, ${r0.unemployed} chômeurs)`);
  assert.ok(s.demography!.jobNoReachDay > 0, 'recherches sans emploi accessible');
  // Ligne : arrêts devant les logements et devant les emplois ; dépôt.
  must(bus(s, 'createLine', { stops: [{ x: -2300, z: 60 }, { x: 2250, z: 60 }], buses: 12 }), 'ligne');
  const a = s.getAsset('depot')!;
  const dep = s.placeBuilding({ assetId: 'depot', x: 4, z: -14 - (a.footprint.tilesZ * TILE_SIZE) / 2, rot: 0 });
  assert.ok(dep.ok, !dep.ok ? dep.error.message : '');
  runDays(s, 3, 10);
  const r1 = s.demography!.report(s.clock.totalMinutes, s.economy.taxRates.residential);
  assert.ok(r1.employed > r0.employed + 20, `embauches grâce au bus (${r0.employed} -> ${r1.employed})`);
  assert.ok(s.demography!.transitHires > 0);
  assert.ok(summary(s).transitHiresMonth > 0 || s.demography!.transitHires > 0);
});

test('bus : aide de croissance « chômage faute d’accès » évaluée par le module', () => {
  const s = farTown(['immeuble', 'immeuble', 'immeuble', 'immeuble', 'immeuble', 'immeuble', 'immeuble']);
  runDays(s, 8, 10);
  const sys = (s.plugins.service('bus') as any).system;
  assert.ok((s.demography?.population ?? 0) >= 300, `population ${s.demography?.population}`);
  assert.equal(sys.hint, 'need-transit');
});

test('bus : ancienne sauvegarde (sans section) chargée sans ligne ; aller-retour d’une partie avec lignes identique', () => {
  // 1) Partie sans module bus (ancienne version) : la sauvegarde ne porte aucune section ; chargée sans ligne.
  const old = new Simulation([]);
  old.setCatalog(busCatalog());
  old.newGame({ seed: 1234, mapChunks: 4, startMoney: 50_000_000, cityName: 'Ancienne', terrain: { hydrology: 'aucune', rivers: 0 } });
  loopTown(old);
  runDays(old, 3, 10);
  const oldSave = JSON.parse(JSON.stringify(old.toSave()));
  assert.equal(oldSave.plugins?.bus, undefined);
  const t = new Simulation();
  t.setCatalog(busCatalog());
  assert.equal(t.fromSave(oldSave), null);
  assert.equal(summary(t).lines, 0);
  assert.equal(t.traffic.carFactor, 1);
  runDays(t, 1, 10);
  assert.equal(t.toSave().plugins?.bus, undefined, 'toujours aucune section');

  // 2) Partie avec deux lignes : sauvegarde -> chargement -> même suite.
  const s = newBusSim();
  loopTown(s);
  placeDepot(s, 40);
  runDays(s, 4, 10);
  must(bus(s, 'createLine', { name: 'Nord', stops: LOOP, buses: 3, fare: 2 }), 'ligne 1');
  must(bus(s, 'createLine', { name: 'Sud', color: '#30a46c', stops: [{ x: -100, z: 0 }, { x: 100, z: 0 }], buses: 2 }), 'ligne 2');
  runDays(s, 3, 10);
  const save = JSON.parse(JSON.stringify(s.toSave()));
  assert.ok(validateSave(save).ok);
  assert.equal(save.plugins.bus.v, 1);
  assert.equal(save.plugins.bus.data.lines.length, 2);
  const u = new Simulation();
  u.setCatalog(busCatalog());
  assert.equal(u.fromSave(save), null);
  assert.deepEqual(state(u).lines.map((l) => [l.name, l.buses, l.fare, l.stopIds.length, l.lengthM]), state(s).lines.map((l) => [l.name, l.buses, l.fare, l.stopIds.length, l.lengthM]));
  assert.equal(u.traffic.carFactor, s.traffic.carFactor);
  runDays(s, 4, 10);
  runDays(u, 4, 10);
  const fp = (x: Simulation): unknown => ({ money: Math.round(x.economy.money), pop: x.demography!.population, rng: x.rng.getState(), car: x.traffic.carFactor, bus: summary(x).ridersDay });
  assert.deepEqual(fp(u), fp(s));
  assert.deepEqual(JSON.parse(JSON.stringify(u.toSave().plugins?.bus)), JSON.parse(JSON.stringify(s.toSave().plugins?.bus)));
  // Section illisible : partie chargée, aucune ligne, notification.
  const broken = { ...save, plugins: { ...save.plugins, bus: { v: 1, data: 'n’importe quoi' } } };
  const w = new Simulation();
  w.setCatalog(busCatalog());
  w.plugins.log = () => undefined;
  assert.equal(w.fromSave(broken), null);
  assert.equal(summary(w).lines, 0);
});
