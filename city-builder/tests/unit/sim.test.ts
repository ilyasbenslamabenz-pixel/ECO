import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../../src/sim/world';
import { handleCommand } from '../../src/sim/handler';
import { BuildingStore, RoadGraph } from '../../src/sim/ecs';
import { findPath } from '../../src/sim/pathfinding';
import { MINUTES_PER_MONTH } from '../../src/sim/clock';
import { GAME_MINUTES_PER_TICK, PROTOCOL_VERSION } from '../../src/shared/constants';
import { terrainHeightAt } from '../../src/shared/terrain-gen';
import { testCatalog } from '../fixtures/catalog';

function newSim(money = 1_000_000): Simulation {
  const s = new Simulation();
  s.setCatalog(testCatalog());
  s.newGame({ seed: 1234, mapChunks: 4, startMoney: money, cityName: 'Test' });
  return s;
}

/** Cherche un emplacement plat et sec près du centre. */
function flatSpot(s: Simulation): [number, number] {
  for (let r = 0; r < 400; r += 16) {
    for (let a = 0; a < 8; a++) {
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (s.placeBuilding({ assetId: 'grand_test', x, z, rot: 0, dryRun: true }).ok) return [x, z];
    }
  }
  throw new Error('aucun emplacement plat');
}

test('ECS : ajout, suppression par permutation, croissance', () => {
  const b = new BuildingStore(2);
  for (let i = 1; i <= 5; i++) b.add(i, 0, -1, i, 0, i, 0, 1, 1);
  assert.equal(b.count, 5);
  assert.ok(b.capacity >= 5);
  b.remove(2);
  assert.equal(b.count, 4);
  assert.equal(b.indexOf(2), -1);
  assert.equal(b.x[b.indexOf(5)], 5);
});

test('placement : coût débité, collision, empreinte alignée', () => {
  const s = newSim();
  const [x, z] = flatSpot(s);
  const r = s.placeBuilding({ assetId: 'maison_test', x, z, rot: 0 });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(s.economy.money, 1_000_000 - 10_000);
  const again = s.placeBuilding({ assetId: 'maison_test', x, z, rot: 1 });
  assert.equal(again.ok, false);
  assert.equal(!again.ok && again.error.code, 'COLLISION');
  assert.equal(s.buildings.count, 1);
  const d = s.takeDelta();
  assert.equal(d.buildingsAdded.length, 1);
  assert.equal(s.takeDelta().buildingsAdded.length, 0);
});

test('placement : refus pour fonds insuffisants, asset inconnu, hors carte, véhicule', () => {
  const s = newSim();
  const [x, z] = flatSpot(s);
  s.economy.money = 5_000;
  const r = s.placeBuilding({ assetId: 'maison_test', x, z, rot: 0 });
  assert.equal(!r.ok && r.error.code, 'INSUFFICIENT_FUNDS');
  const u = s.placeBuilding({ assetId: 'nope', x, z, rot: 0 });
  assert.equal(!u.ok && u.error.code, 'UNKNOWN_ASSET');
  const o = s.placeBuilding({ assetId: 'maison_test', x: 99999, z, rot: 0 });
  assert.equal(!o.ok && o.error.code, 'OUT_OF_BOUNDS');
  const v = s.placeBuilding({ assetId: 'voiture_test', x, z, rot: 0 });
  assert.equal(!v.ok && v.error.code, 'INVALID_ARGS');
});

test('placement : refus dans l\'eau', () => {
  const s = newSim();
  const t = s.terrain!;
  let wet: [number, number] | null = null;
  for (let j = 4; j < t.samplesZ - 4 && !wet; j++) for (let i = 4; i < t.samplesX - 4 && !wet; i++) {
    if (t.heights[j * t.samplesX + i]! < t.waterLevel - 1) wet = [t.originX + i * t.spacing, t.originZ + j * t.spacing];
  }
  assert.ok(wet, 'la carte de test doit contenir de l\'eau');
  const r = s.placeBuilding({ assetId: 'maison_test', x: wet[0], z: wet[1], rot: 0 });
  assert.equal(r.ok, false);
  assert.ok(!r.ok && (r.error.code === 'UNDER_WATER' || r.error.code === 'TOO_STEEP'));
});

test('routes : construction, coût, collision avec bâtiment, suppression', () => {
  const s = newSim();
  const [x, z] = flatSpot(s);
  const money0 = s.economy.money;
  const road = s.buildRoad({ type: 'street', points: [x - 40, z + 40, x + 40, z + 40] });
  assert.ok(road.ok, JSON.stringify(road));
  assert.equal(s.roads.edgeCount, 1);
  assert.ok(s.economy.money < money0);
  // Bâtiment sur la route -> collision
  const b = s.placeBuilding({ assetId: 'maison_test', x, z: z + 40, rot: 0 });
  assert.equal(!b.ok && b.error.code, 'COLLISION');
  // Route à travers un bâtiment -> collision
  assert.ok(s.placeBuilding({ assetId: 'maison_test', x, z: z - 20, rot: 0 }).ok);
  const r2 = s.buildRoad({ type: 'street', points: [x - 30, z - 20, x + 30, z - 20] });
  assert.equal(!r2.ok && r2.error.code, 'COLLISION');
  // Raccordement : un 2e tronçon partant de l'extrémité réutilise le nœud.
  assert.ok(s.buildRoad({ type: 'street', points: [x + 40, z + 40, x + 40, z + 90] }).ok);
  assert.equal(s.roads.nodeCount, 3);
  const edgeId = road.ok ? road.data.edgeIds[0]! : -1;
  assert.ok(s.removeRoad({ edgeId }).ok);
  assert.equal(s.roads.edgeCount, 1);
  assert.equal(s.roads.nodeCount, 2);
});

test('horloge et économie : entretien prélevé au changement de mois', () => {
  const s = newSim();
  const [x, z] = flatSpot(s);
  assert.ok(s.placeBuilding({ assetId: 'maison_test', x, z, rot: 0 }).ok);
  const before = s.economy.money;
  const ticks = Math.ceil(MINUTES_PER_MONTH / GAME_MINUTES_PER_TICK);
  for (let i = 0; i < ticks; i++) s.tick();
  const st = s.getStats();
  assert.equal(st.date.month, 2);
  assert.equal(s.economy.money, before - 100);
  assert.equal(st.monthlyBalance, -100);
});

test('sauvegarde : aller-retour JSON identique', () => {
  const s = newSim();
  const [x, z] = flatSpot(s);
  assert.ok(s.placeBuilding({ assetId: 'maison_test', x, z, rot: 1, variant: 1 }).ok);
  assert.ok(s.buildRoad({ type: 'avenue', points: [x - 60, z + 50, x + 60, z + 50] }).ok);
  for (let i = 0; i < 50; i++) s.tick();
  const save = JSON.parse(JSON.stringify(s.toSave()));
  const s2 = new Simulation();
  s2.setCatalog(testCatalog());
  assert.equal(s2.fromSave(save), null);
  assert.deepEqual(s2.buildingRecords(), s.buildingRecords());
  assert.deepEqual(s2.roadRecords(), s.roadRecords());
  assert.equal(s2.economy.money, s.economy.money);
  assert.equal(s2.clock.totalMinutes, s.clock.totalMinutes);
  assert.equal(s2.fromSave({ ...save, version: 999 })?.code, 'BAD_SAVE');
});

test('handler : init, newGame, snapshot, terraform non implémenté', () => {
  const s = new Simulation();
  const noCat = handleCommand(s, { kind: 'cmd', reqId: 1, name: 'newGame', args: { seed: 1, mapChunks: 2, startMoney: 1, cityName: 'x' } });
  assert.equal(noCat.result.kind === 'result' && !noCat.result.ok && noCat.result.error.code, 'NO_GAME');
  const init = handleCommand(s, { kind: 'cmd', reqId: 2, name: 'init', args: { protocolVersion: PROTOCOL_VERSION, catalog: testCatalog() } });
  assert.ok(init.result.kind === 'result' && init.result.ok);
  const ng = handleCommand(s, { kind: 'cmd', reqId: 3, name: 'newGame', args: { seed: 1, mapChunks: 2, startMoney: 1000, cityName: 'x' } });
  assert.ok(ng.snapshot);
  const snap = s.snapshot();
  assert.equal(snap.terrain.heights.length, snap.terrain.samplesX * snap.terrain.samplesZ);
  assert.notEqual(snap.terrain.heights, s.terrain!.heights, 'la carte envoyée doit être une copie transférable');
  const tf = handleCommand(s, { kind: 'cmd', reqId: 4, name: 'terraform', args: { x: 0, z: 0, radius: 5, delta: 1 } });
  assert.ok(tf.result.kind === 'result' && !tf.result.ok && tf.result.error.code === 'NOT_IMPLEMENTED' && tf.result.error.phase === 2);
});

test('pathfinding A* : plus court chemin en temps', () => {
  const g = new RoadGraph(4, 4);
  g.addNode(1, 0, 0, 0); g.addNode(2, 100, 0, 0); g.addNode(3, 100, 0, 100); g.addNode(4, 0, 0, 100);
  g.addEdge(1, 1, 2, 0, 100); g.addEdge(2, 2, 3, 0, 100); g.addEdge(3, 1, 4, 2, 100); g.addEdge(4, 4, 3, 2, 100);
  // Les deux chemins font 200 m mais 1-4-3 est en boulevard (plus rapide).
  assert.deepEqual(findPath(g, 1, 3), [1, 4, 3]);
  g.addNode(5, 500, 0, 500);
  assert.equal(findPath(g, 1, 5), null);
});

test('hauteur des bâtiments posée sur le terrain', () => {
  const s = newSim();
  const [x, z] = flatSpot(s);
  const r = s.placeBuilding({ assetId: 'maison_test', x, z, rot: 0 });
  assert.ok(r.ok);
  const rec = s.buildingRecords()[0]!;
  assert.ok(Math.abs(rec.y - terrainHeightAt(s.terrain!, rec.x, rec.z)) < 3);
});

test('démolition : libère l\'emplacement, rembourse 25 %, retire l\'entretien', () => {
  const s = newSim();
  const [x, z] = flatSpot(s);
  const r = s.placeBuilding({ assetId: 'maison_test', x, z, rot: 0 });
  assert.ok(r.ok);
  const money = s.economy.money;
  const d = s.demolish({ buildingId: r.ok ? r.data.buildingId : -1 });
  assert.ok(d.ok && d.data.refund === 2_500);
  assert.equal(s.economy.money, money + 2_500);
  assert.equal(s.economy.monthlyUpkeep, 0);
  assert.equal(s.buildings.count, 0);
  assert.ok(s.placeBuilding({ assetId: 'maison_test', x, z, rot: 0 }).ok, 'emplacement de nouveau libre');
  const nf = s.demolish({ buildingId: 9999 });
  assert.equal(!nf.ok && nf.error.code, 'NOT_FOUND');
});
