/**
 * Tramway (module « bus », mode `tram`, docs/TRANSPORTS_COMMUN.md §9) : voies posées sur les routes (voie partagée ou
 * site propre), tracé restreint aux voies, dépôt de tram requis, capacité supérieure, voies conservées quand une route
 * est découpée, site propre insensible aux bouchons, sauvegarde (aller-retour, ancienne section sans voies), entrée de
 * catalogue dérivée `depot_tram`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Simulation } from '../../src/sim/world';
import type { AssetCatalog } from '../../src/shared/catalog';
import { TILE_SIZE } from '../../src/shared/constants';
import { validateSave } from '../../src/sim/save-format';
import { readRecord } from '../../src/sim/transit/system';
import { migrateBus } from '../../src/sim/save-sections/bus';
import { withTransitAssets } from '../../src/shared/transit-assets';
import type { BusState, BusSummary } from '../../src/shared/protocol-ext/bus';
import { buildTown, runDays, townCatalog } from '../sim/fixtures';

function tramCatalog(): AssetCatalog {
  const c = townCatalog();
  const base = c.assets.find((a) => a.id === 'commissariat')!;
  c.assets.push({ ...base, id: 'depot', nameFr: 'Test dépôt de bus', footprint: { tilesX: 3, tilesZ: 2 }, capacity: { residents: 0, jobs: 10 }, tags: ['transport', 'depot_bus', 'bus:12'] });
  c.assets.push({ ...base, id: 'depot_t', nameFr: 'Test dépôt de tram', footprint: { tilesX: 3, tilesZ: 2 }, capacity: { residents: 0, jobs: 10 }, tags: ['transport', 'depot_tram', 'tram:6'] });
  return c;
}

function newSim(): Simulation {
  const s = new Simulation();
  s.setCatalog(tramCatalog());
  s.newGame({ seed: 1234, mapChunks: 4, startMoney: 50_000_000, cityName: 'Bourg-Tram', terrain: { hydrology: 'aucune', rivers: 0 } });
  return s;
}

type R = { ok: boolean; data?: any; error?: { code: string; message: string } };
const cmd = (s: Simulation, name: string, payload?: unknown): R => {
  const r = s.plugins.command('bus', name, payload) as any;
  return r.ok ? { ok: true, data: r.data?.data ?? r.data } : { ok: false, error: r.error ?? r };
};
const must = (r: R, what: string): any => { assert.ok(r.ok, `${what} : ${r.error?.message}`); return r.data; };
const summary = (s: Simulation): BusSummary => must(cmd(s, 'stats'), 'stats');
const state = (s: Simulation): BusState => must(cmd(s, 'state'), 'state');

function loopTown(s: Simulation): void {
  buildTown(s);
  assert.ok(s.buildRoad({ type: 'street', points: [-220, 0, -220, 80] }).ok);
  assert.ok(s.buildRoad({ type: 'street', points: [220, 0, 220, 80] }).ok);
}
const LOOP = [{ x: -150, z: 1 }, { x: 150, z: -1 }, { x: 150, z: 81 }, { x: -150, z: 79 }];
/** Rails sur les quatre côtés de la boucle. */
const SIDES = [{ x: 0, z: 0 }, { x: 0, z: 80 }, { x: -220, z: 40 }, { x: 220, z: 40 }];
function layTracks(s: Simulation, dedicated = false): number {
  let cost = 0;
  for (const p of SIDES) cost += must(cmd(s, 'track', { ...p, dedicated }), 'voie').cost;
  return cost;
}
function placeDepot(s: Simulation, id: string, x: number): number {
  const a = s.getAsset(id)!;
  const r = s.placeBuilding({ assetId: id, x: x + (a.footprint.tilesX * TILE_SIZE) / 2, z: 8 + (a.footprint.tilesZ * TILE_SIZE) / 2, rot: 2 });
  assert.ok(r.ok, !r.ok ? r.error.message : '');
  return r.data.buildingId;
}

test('tram : voies posées sur les routes (coût, refus), tracé restreint aux voies, dépôt de tram requis', () => {
  const s = newSim();
  loopTown(s);
  // Sans voie : aucun arrêt de tram possible (le bus, lui, s'accroche).
  assert.equal(cmd(s, 'snap', { x: -150, z: 1, mode: 'tram' }).ok, false);
  assert.equal(cmd(s, 'snap', { x: -150, z: 1 }).ok, true);
  assert.equal(cmd(s, 'createLine', { mode: 'tram', stops: LOOP }).ok, false, 'pas de ligne sans voie');
  // Refus : rue piétonne, autoroute, loin de toute route.
  assert.ok(s.buildRoad({ type: 'street', kind: 'pedestrian', points: [-100, 200, 100, 200] }).ok);
  assert.equal(cmd(s, 'track', { x: 0, z: 200 }).ok, false, 'pas de voie sur une rue piétonne');
  assert.equal(cmd(s, 'track', { x: 0, z: 500 }).ok, false, 'hors route');
  // Pose : coût = longueur × prix au mètre ; aperçu (dryRun) sans effet.
  const dry = must(cmd(s, 'track', { x: 0, z: 0, dryRun: true }), 'aperçu');
  assert.equal(must(cmd(s, 'tracks'), 'liste').length, 0, 'aperçu sans effet');
  assert.ok(dry.cost > 0 && Math.abs(dry.cost - dry.lengthM * 260) <= 260, `coût ${dry.cost} pour ${dry.lengthM} m`);
  const money0 = s.economy.money;
  const cost = layTracks(s);
  assert.equal(Math.round(money0 - s.economy.money), cost, 'voies payées');
  assert.equal(must(cmd(s, 'tracks'), 'liste').length, 4);
  // Une seconde pose identique ne coûte rien.
  assert.equal(must(cmd(s, 'track', { x: 0, z: 0 }), 'repose').cost, 0);
  // Ligne de tram : tracé sur les voies, avertissement sans dépôt de tram (un dépôt de bus ne suffit pas).
  placeDepot(s, 'depot', 40);
  const c = must(cmd(s, 'createLine', { mode: 'tram', name: 'T1', stops: LOOP, buses: 3 }), 'ligne de tram');
  assert.equal(c.line.mode, 'tram');
  assert.ok(c.warning && /dépôt de tram/.test(c.warning), String(c.warning));
  assert.equal(c.cost, 4 * 1800, 'quais de tram');
  let l = state(s).lines[0]!;
  assert.ok(l.problem && /dépôt de tram/.test(l.problem), String(l.problem));
  assert.ok(l.lengthM > 950 && l.lengthM < 1150, `boucle ${l.lengthM}`);
  // Retrait d'une voie : la ligne est coupée et le signale.
  const rm = must(cmd(s, 'track', { x: 0, z: 80, on: false }), 'retrait');
  assert.equal(rm.previous.on, true);
  l = state(s).lines[0]!;
  assert.ok(l.problem && /voie de tram/.test(l.problem), String(l.problem));
  must(cmd(s, 'track', { x: 0, z: 80 }), 'remise');
  assert.ok(!state(s).lines[0]!.problem || /dépôt/.test(state(s).lines[0]!.problem!));
});

test('tram : dépôt + ligne en service, fréquentation, capacité supérieure au bus, entretien des voies', () => {
  const s = newSim();
  loopTown(s);
  runDays(s, 10, 10);
  layTracks(s);
  placeDepot(s, 'depot_t', 40);
  const id = must(cmd(s, 'createLine', { mode: 'tram', stops: LOOP, buses: 2, fare: 1 }), 'ligne').line.id;
  runDays(s, 3, 10);
  const st = state(s);
  const l = st.lines.find((x) => x.id === id)!;
  assert.equal(l.problem, null, String(l.problem));
  assert.equal(l.activeBuses, 2);
  const sum = summary(s);
  assert.equal(sum.tram?.lines, 1);
  assert.equal(sum.tram?.depots, 1);
  assert.equal(sum.tram?.depotCapacity, 6);
  assert.equal(sum.tram?.vehiclesActive, 2);
  assert.equal(sum.busesActive, 0, 'les rames ne comptent pas comme des bus');
  assert.ok((sum.tram?.trackM ?? 0) > 900, `voies ${sum.tram?.trackM} m`);
  assert.ok(sum.ridersDay > 0 && sum.tram!.ridersDay === sum.ridersDay, `voyages ${sum.ridersDay}`);
  assert.ok(sum.carFactor < 1, `facteur voiture ${sum.carFactor}`);
  // Capacité horaire : une rame emporte trois fois un bus (180 / 60 places).
  const sys = (s.plugins.service('bus') as any).system;
  assert.equal(sys.capacityOf('tram'), 3 * sys.capacityOf('bus'));
  // Plus de rames que de places au dépôt : réparties dans la limite de la capacité.
  must(cmd(s, 'updateLine', { id, buses: 9 }), 'rames');
  runDays(s, 1, 10);
  assert.equal(state(s).lines[0]!.activeBuses, 6);
  // Coûts du mois : entretien des rames ET des voies.
  assert.ok(sum.costMonth > 0);
});

test('tram : voies conservées quand une route est découpée ; site propre insensible aux bouchons', () => {
  const s = newSim();
  loopTown(s);
  layTracks(s);
  placeDepot(s, 'depot_t', 40);
  must(cmd(s, 'createLine', { mode: 'tram', stops: LOOP, buses: 2 }), 'ligne');
  const before = must(cmd(s, 'tracks'), 'liste') as { segId: number; lengthM: number }[];
  const total0 = before.reduce((a, t) => a + t.lengthM, 0);
  // Une rue perpendiculaire découpe la rue z = 0 en deux tronçons (nouveaux identifiants).
  assert.ok(s.buildRoad({ type: 'street', points: [-30, 0, -30, 30] }).ok);
  s.tick(1);
  const after = must(cmd(s, 'tracks'), 'liste') as { segId: number; lengthM: number }[];
  assert.equal(after.length, 5, `voies après découpe : ${JSON.stringify(after)}`);
  const total1 = after.reduce((a, t) => a + t.lengthM, 0);
  assert.ok(Math.abs(total1 - total0) < 15, `longueur ${total0} -> ${total1}`);
  assert.ok(!after.some((t) => t.lengthM > 20 && t.lengthM < 40), 'la nouvelle rue n’hérite pas des voies');
  assert.equal(state(s).lines[0]!.problem, null, String(state(s).lines[0]!.problem));
  // Bouchons : la rame en voie partagée ralentit, en site propre non.
  const sys = (s.plugins.service('bus') as any).system;
  sys.carKmh = 8;
  sys.updateTimes();
  const shared = state(s).lines[0]!.cycleMin;
  for (const t of after) must(cmd(s, 'track', { segId: t.segId, dedicated: true }), 'site propre');
  sys.carKmh = 8;
  sys.updateTimes();
  const ded = state(s).lines[0]!.cycleMin;
  assert.ok(ded < shared * 0.6, `tour ${shared} min en voie partagée, ${ded} min en site propre`);
  assert.equal(summary(s).tram!.dedicatedM, summary(s).tram!.trackM);
});

test('tram : sauvegarde (voies, mode des lignes) identique au rechargement ; sections antérieures lisibles', () => {
  const s = newSim();
  loopTown(s);
  placeDepot(s, 'depot_t', 40);
  placeDepot(s, 'depot', 120);
  layTracks(s, true);
  runDays(s, 3, 10);
  must(cmd(s, 'createLine', { mode: 'tram', name: 'T1', stops: LOOP, buses: 2 }), 'tram');
  must(cmd(s, 'createLine', { name: 'B1', stops: [{ x: -100, z: 0 }, { x: 100, z: 0 }], buses: 2 }), 'bus');
  runDays(s, 2, 10);
  const save = JSON.parse(JSON.stringify(s.toSave()));
  assert.ok(validateSave(save).ok);
  assert.equal(save.plugins.bus.data.tracks.length, 4);
  assert.equal(save.plugins.bus.data.lines[0].mode, 'tram');
  assert.equal(save.plugins.bus.data.lines[1].mode, undefined, 'ligne de bus : format inchangé');
  const u = new Simulation();
  u.setCatalog(tramCatalog());
  assert.equal(u.fromSave(save), null);
  assert.deepEqual(state(u).lines.map((l) => [l.mode, l.name, l.lengthM, l.activeBuses, l.problem]), state(s).lines.map((l) => [l.mode, l.name, l.lengthM, l.activeBuses, l.problem]));
  assert.deepEqual({ ...summary(u).tram, ridersDay: 0 }, { ...summary(s).tram, ridersDay: 0 }, 'voyages recalculés le jour suivant');
  runDays(s, 2, 10);
  runDays(u, 2, 10);
  assert.equal(Math.round(u.economy.money), Math.round(s.economy.money));
  assert.deepEqual(JSON.parse(JSON.stringify(u.toSave().plugins?.bus)), JSON.parse(JSON.stringify(s.toSave().plugins?.bus)));
  // Section antérieure au tramway : lignes sans mode = bus, aucune voie.
  const old = migrateBus({ nextLineId: 2, nextStopId: 3, lines: [{ id: 1, name: 'A', color: '#e5484d', buses: 2, fare: 1, stops: [{ id: 1, x: 0, z: 0, name: 'a' }, { id: 2, x: 50, z: 0, name: 'b' }] }] }, 1);
  assert.equal(old.tracks, undefined);
  assert.equal(old.lines[0]!.mode, undefined);
  assert.equal(readRecord({ id: 3, mode: 'tram', stops: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 1, z: 0 }] })?.mode, 'tram');
  // Voies seules (aucune ligne) : la section est écrite et relue.
  const v = newSim();
  loopTown(v);
  layTracks(v);
  const vs = JSON.parse(JSON.stringify(v.toSave()));
  assert.equal(vs.plugins.bus.data.lines.length, 0);
  const w = new Simulation();
  w.setCatalog(tramCatalog());
  assert.equal(w.fromSave(vs), null);
  assert.equal(must(cmd(w, 'tracks'), 'liste').length, 4);
});

test('tram : entrée de catalogue dérivée depot_tram (sans toucher à assets/)', () => {
  const cat = JSON.parse(readFileSync(new URL('../../assets/catalog.json', import.meta.url), 'utf8')) as AssetCatalog;
  assert.ok(!cat.assets.some((a) => a.id === 'depot_tram'), 'absent du fichier');
  const out = withTransitAssets(cat);
  const t = out.assets.find((a) => a.id === 'depot_tram')!;
  const b = cat.assets.find((a) => a.id === 'depot_bus')!;
  assert.ok(t, 'dépôt de tram ajouté');
  assert.ok(t.tags.includes('depot_tram') && t.tags.includes('tram:10') && t.tags.includes('transport'));
  assert.ok(!t.tags.includes('depot_bus'), 'pas compté comme dépôt de bus');
  assert.deepEqual(t.lods, b.lods, 'modèle réutilisé');
  assert.equal(withTransitAssets(out), out, 'idempotent');
  assert.equal(out.assets.length, cat.assets.length + 1);
});
