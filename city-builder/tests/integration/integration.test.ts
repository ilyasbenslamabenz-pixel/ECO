/**
 * Tests d'intégration (agent intégration) : simulation complète avec le VRAI catalogue fusionné
 * (assets/catalog.json : 40 bâtiments, 15 véhicules, végétation, mobilier), terrain WorldTerrain,
 * réseau routier courbe avec ponts et nivellement, ville de démonstration, sauvegarde v2, protocole.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Simulation } from '../../src/sim/world';
import { handleCommand } from '../../src/sim/handler';
import { collectTransferables, type SnapshotMessage } from '../../src/shared/protocol';
import { isBuildingCategory, validateCatalog, type AssetCatalog } from '../../src/shared/catalog';
import { SAVE_FORMAT_VERSION } from '../../src/shared/constants';
import { CURRENT_SAVE_VERSION } from '../../src/sim/save-format';

const root = join(import.meta.dirname, '..', '..');
const catalog = JSON.parse(readFileSync(join(root, 'assets/catalog.json'), 'utf8')) as AssetCatalog;

function sim(seed = 7, terrain?: Parameters<Simulation['newGame']>[0]['terrain']): Simulation {
  const s = new Simulation();
  s.setCatalog(catalog);
  s.newGame({ seed, mapChunks: 8, startMoney: 2e9, cityName: 'Intégration', startHour: 10, ...(terrain ? { terrain } : {}) });
  return s;
}

test('catalogue fusionné : ≥ 30 bâtiments distincts répartis dans toutes les familles, véhicules, arbres, mobilier', () => {
  assert.deepEqual(validateCatalog(catalog), []);
  const by = (c: string): number => catalog.assets.filter((a) => a.category === c).length;
  const buildings = catalog.assets.filter((a) => isBuildingCategory(a.category));
  assert.ok(buildings.length >= 30, `${buildings.length} bâtiments`);
  for (const c of ['house', 'townhouse', 'apartment_low', 'apartment_mid', 'apartment_high', 'skyscraper', 'commercial', 'industrial', 'public']) assert.ok(by(c) >= 1, c);
  assert.ok(by('vehicle') >= 10);
  assert.ok(by('tree') >= 4);
  assert.ok(by('street_furniture') >= 6);
  // Chaque bâtiment a 3 LOD, des variantes et une silhouette propre (dimensions toutes différentes).
  const dims = new Set(buildings.map((a) => `${a.dimensions.width}|${a.dimensions.depth}|${a.dimensions.height}`));
  assert.equal(dims.size, buildings.length);
  for (const a of buildings) { assert.equal(a.lods.length, 3, a.id); assert.ok(a.variants.length >= 3, a.id); }
  assert.equal(SAVE_FORMAT_VERSION, CURRENT_SAVE_VERSION);
});

test('ville de démonstration : tous les bâtiments posés par les règles du joueur, routes, ponts, habitants, trafic', () => {
  const s = sim();
  const r = s.runExt('buildCity', { preset: 'demo', vehicles: 100 });
  assert.ok(r.ok, JSON.stringify(r));
  const d = r.data;
  const nb = catalog.assets.filter((a) => isBuildingCategory(a.category)).length;
  assert.equal(d.distinctBuildings, nb, `manquants : ${d.missing.join(', ')}`);
  assert.ok(d.buildings >= 100, `${d.buildings} bâtiments`);
  assert.equal(s.buildings.count, d.buildings);
  assert.ok(d.roadsOk >= 30);
  const kinds = new Set(s.roadRecords().edges.map((e) => e.kind));
  for (const k of ['boulevard', 'avenue', 'street', 'pedestrian', 'oneway']) assert.ok(kinds.has(k as never), `type ${k}`);
  assert.ok(s.roadRecords().edges.some((e) => e.c1 && Math.hypot(e.c1[0] - (e.c2?.[0] ?? 0), e.c1[1] - (e.c2?.[1] ?? 0)) > 0.1), 'route courbe');
  assert.ok((s.demography?.population ?? 0) > 1000, 'habitants installés');
  assert.ok(d.vehicles >= 100, `${d.vehicles} véhicules`);
  // Tous les bâtiments posés sont desservis par une route (la démo refuse sinon).
  for (let i = 0; i < s.buildings.count; i++) assert.equal(s.buildings.roadAccess[i], 1);
  // La ville vit : quelques secondes de simulation, véhicules en mouvement, aucun en double.
  for (let i = 0; i < 50; i++) s.tick();
  const f = s.traffic.takeFrame();
  assert.ok(f.count > 50);
  assert.equal(new Set(Array.from(f.ids!.subarray(0, f.count))).size, f.count);
});

test('ville déterministe : même graine -> mêmes bâtiments et routes', () => {
  const a = sim(11), b = sim(11);
  a.runExt('buildCity', { preset: 'demo', settleWaves: 0 });
  b.runExt('buildCity', { preset: 'demo', settleWaves: 0 });
  assert.deepEqual(a.buildingRecords(), b.buildingRecords());
  assert.deepEqual(a.roadRecords(), b.roadRecords());
});

test('routes : courbe, carrefour automatique, pont au-dessus d\'une rivière, nivellement transmis au rendu', () => {
  const s = sim(7);
  const t = s.terrain!;
  // Cherche un échantillon de rivière (surface d'eau au-dessus du terrain) près du centre.
  let river: [number, number] | null = null;
  for (let r = 40; r < 700 && !river; r += 8) {
    for (let a = 0; a < 64 && !river; a++) {
      const x = Math.cos((a / 64) * Math.PI * 2) * r, z = Math.sin((a / 64) * Math.PI * 2) * r;
      const i = Math.round((x - t.originX) / t.spacing), j = Math.round((z - t.originZ) / t.spacing);
      const k = j * t.samplesX + i;
      if (t.waterSurface[k]! > t.heights[k]! + 0.5 && t.waterSurface[k]! > t.waterLevel + 1) river = [x, z];
    }
  }
  assert.ok(river, 'la carte de test doit avoir une rivière');
  // Tracé droit qui franchit la rivière, en essayant plusieurs orientations.
  let built = false;
  for (let a = 0; a < 16 && !built; a++) {
    const dx = Math.cos((a / 16) * Math.PI) * 70, dz = Math.sin((a / 16) * Math.PI) * 70;
    const r = s.buildRoad({ type: 'street', points: [river[0] - dx, river[1] - dz, river[0] + dx, river[1] + dz] });
    built = r.ok;
  }
  assert.ok(built, 'aucune orientation de pont acceptée');
  const edges = s.roadRecords().edges;
  assert.ok(edges.some((e) => (e.bridgeRuns?.length ?? 0) > 0), 'pont attendu');
  const d = s.takeDelta();
  assert.ok(d.roadEdgesAdded.length >= 1 && d.roadEdgesAdded[0]!.profile!.length >= 2, 'profil transmis');
  assert.ok(d.terrainPatch, 'zone nivelée transmise');
  const p = d.terrainPatch!;
  assert.equal(p.heights.length, (p.i1 - p.i0 + 1) * (p.j1 - p.j0 + 1));
  // Courbe + croisement : une avenue courbe qui coupe la route -> découpe et carrefour.
  const e0 = edges[0]!;
  const nodes = s.roadRecords().nodes;
  const A = nodes.find((n) => n.id === e0.a)!, B = nodes.find((n) => n.id === e0.b)!;
  const mx = (A.x + B.x) / 2, mz = (A.z + B.z) / 2;
  const nx = -(B.z - A.z), nz = B.x - A.x, l = Math.hypot(nx, nz);
  const segBefore = s.net.segCount;
  const c = s.buildRoad({ type: 'avenue', kind: 'avenue', points: [mx - (nx / l) * 120 + 30, mz - (nz / l) * 120, mx + (nx / l) * 120 + 30, mz + (nz / l) * 120], control: [mx - 20, mz] });
  if (c.ok) {
    assert.ok(s.net.segCount >= segBefore + 2, 'la courbe doit couper la route existante');
    const d2 = s.takeDelta();
    assert.ok(d2.roadEdgesRemoved.length >= 1, 'tronçon découpé retiré du rendu');
  }
});

test('sauvegarde v2 : routes courbes, nivellement et ville rechargés à l\'identique', () => {
  const s = sim(11);
  s.runExt('buildCity', { preset: 'demo', settleWaves: 5 });
  for (let i = 0; i < 30; i++) s.tick();
  const save = JSON.parse(JSON.stringify(s.toSave()));
  assert.equal(save.version, 2);
  const s2 = new Simulation();
  s2.setCatalog(catalog);
  assert.equal(s2.fromSave(save), null);
  assert.deepEqual(s2.roadRecords(), s.roadRecords());
  assert.deepEqual(s2.buildingRecords(), s.buildingRecords());
  assert.deepEqual(Array.from(s2.terrain!.heights), Array.from(s.terrain!.heights));
  assert.equal(s2.economy.money, s.economy.money);
  assert.equal(s2.demography!.population, s.demography!.population);
});

test('protocole : instantané avec couches de terrain transférables ; buildCity renvoie un instantané', () => {
  const s = new Simulation();
  assert.ok(handleCommand(s, { kind: 'cmd', reqId: 1, name: 'init', args: { protocolVersion: 1, catalog } }).result);
  const ng = handleCommand(s, { kind: 'cmd', reqId: 2, name: 'newGame', args: { seed: 3, mapChunks: 8, startMoney: 1e9, cityName: 'P', startHour: 9 } });
  assert.equal(ng.snapshot, true);
  const snap = s.snapshot() as SnapshotMessage;
  const tr = collectTransferables(snap);
  assert.ok(tr.length >= 5, 'hauteurs + eau + humidité + forêt + ressources');
  assert.ok(!tr.includes(s.terrain!.heights.buffer as ArrayBuffer), 'jamais les tampons de la simulation elle-même');
  assert.equal(snap.stats.date.hour, 9);
  const bc = handleCommand(s, { kind: 'cmd', reqId: 3, name: 'buildCity', args: { preset: 'demo', settleWaves: 0 } });
  assert.equal(bc.snapshot, true);
  const bad = handleCommand(s, { kind: 'cmd', reqId: 4, name: 'buildRoad', args: { type: 'street', points: [0, 0, 10, 0, 20, 0], control: [5, 5] } });
  assert.equal(bad.result.kind === 'result' && !bad.result.ok && bad.result.error.code, 'INVALID_ARGS');
});
