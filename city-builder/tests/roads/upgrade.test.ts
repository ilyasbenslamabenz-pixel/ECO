/**
 * Commande upgradeRoad (src/sim/roads/upgrade.ts + Simulation.upgradeRoad) : changement de type sans démolir,
 * inversion du sens d'une rue à sens unique, coût de la différence, refus motivés, sauvegarde, protocole.
 *   npx tsx --test tests/roads/upgrade.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROAD_KINDS, RoadNetwork, commitRoadPlan, commitUpgrade, nextUpgradeKind, prevUpgradeKind, planRoad, planUpgrade, type ProfileEnv } from '../../src/sim/roads';
import { Simulation } from '../../src/sim/world';
import { handleCommand } from '../../src/sim/handler';
import { validateCommandMessage, type ResultMessage } from '../../src/shared/protocol';
import { PROTOCOL_VERSION, TILE_SIZE } from '../../src/shared/constants';
import { newTownSim, townCatalog } from '../sim/fixtures';

const flat: ProfileEnv = { heightAt: () => 10, waterLevel: 2 };

function seg(s: Simulation, x0: number, z0: number, x1: number, z1: number, kind: 'street' | 'avenue' | 'oneway' | 'highway' = 'street'): number {
  const r = s.buildRoad({ type: 'street', kind, points: [x0, z0, x1, z1] });
  if (!r.ok) throw new Error(r.error.message);
  assert.equal(r.data.edgeIds.length, 1);
  return r.data.edgeIds[0]!;
}

test('réseau pur : le tronçon change de type, garde ses nœuds et sa courbe', () => {
  const net = new RoadNetwork(flat);
  const p = planRoad(net, { kind: 'street', start: { x: 0, z: 0 }, end: { x: 120, z: 0 } });
  assert.ok(p.ok);
  const [id] = commitRoadPlan(net, p.plan).segmentIds;
  const [a, b] = net.endpoints(id!);
  net.takeChanges();
  const up = planUpgrade(net, { segId: id!, kind: 'avenue' });
  assert.ok(up.ok, !up.ok ? up.error.message : '');
  assert.equal(up.plan.cost, Math.round(120 * (ROAD_KINDS.avenue.costPerMeter - ROAD_KINDS.street.costPerMeter)));
  assert.equal(up.plan.refund, 0);
  const { edgeId } = commitUpgrade(net, up.plan);
  assert.notEqual(edgeId, id, 'nouvel identifiant (le rendu reçoit suppression + ajout)');
  assert.equal(net.segCount, 1);
  assert.equal(net.nodeCount, 2, 'aucun nœud créé ni supprimé');
  assert.deepEqual(net.endpoints(edgeId), [a, b]);
  assert.equal(net.kindOf(edgeId), 'avenue');
  assert.ok(Math.abs(net.length(edgeId) - 120) < 1e-6);
  const ch = net.takeChanges();
  assert.deepEqual(ch.segmentsRemoved, [id]);
  assert.ok(ch.segmentsAdded.includes(edgeId));
  assert.deepEqual(ch.nodesRemoved, []);
});

test('échelle de l\'outil : rue → avenue → boulevard → rue', () => {
  assert.equal(nextUpgradeKind('street'), 'avenue');
  assert.equal(nextUpgradeKind('avenue'), 'boulevard');
  assert.equal(nextUpgradeKind('boulevard'), 'street');
  assert.equal(nextUpgradeKind('oneway'), 'street');
  assert.equal(prevUpgradeKind('boulevard'), 'avenue');
  assert.equal(prevUpgradeKind('avenue'), 'street');
  assert.equal(prevUpgradeKind('street'), 'street');
});

test('simulation : amélioration facturée à la différence, déclassement remboursé à 25 %', () => {
  const s = newTownSim();
  const id = seg(s, -200, 0, -40, 0);
  s.takeDelta();
  const m0 = s.economy.money;
  const dry = s.upgradeRoad({ edgeId: id, kind: 'avenue', dryRun: true });
  assert.ok(dry.ok);
  assert.equal(s.economy.money, m0, 'dryRun : rien n\'est dépensé');
  assert.ok(s.roadRecords().edges.some((e) => e.id === id), 'dryRun : tronçon inchangé');
  const diff = 160 * (ROAD_KINDS.avenue.costPerMeter - ROAD_KINDS.street.costPerMeter);
  assert.equal(dry.data.cost, Math.round(diff));
  const up = s.upgradeRoad({ edgeId: id, kind: 'avenue' });
  assert.ok(up.ok, !up.ok ? up.error.message : '');
  assert.equal(s.economy.money, m0 - up.data.cost);
  const e = s.roadRecords().edges.find((r) => r.id === up.data.edgeId) as { kind?: string } | undefined;
  assert.equal(e?.kind, 'avenue');
  const d = s.takeDelta();
  assert.ok(d.roadEdgesRemoved.includes(id) && d.roadEdgesAdded.some((r) => r.id === up.data.edgeId), 'delta : suppression + ajout');
  const m1 = s.economy.money;
  const down = s.upgradeRoad({ edgeId: up.data.edgeId, kind: 'street' });
  assert.ok(down.ok);
  assert.equal(down.data.cost, 0);
  assert.equal(down.data.refund, Math.round(diff * 0.25));
  assert.equal(s.economy.money, m1 + down.data.refund);
  const same = s.upgradeRoad({ edgeId: down.data.edgeId, kind: 'street' });
  assert.ok(!same.ok && same.error.code === 'INVALID_ARGS');
});

test('simulation : carrefour conservé (tronçon au milieu d\'un T)', () => {
  const s = newTownSim();
  seg(s, -200, 40, 0, 40);
  const mid = seg(s, 0, 40, 200, 40);
  seg(s, 0, 40, 0, 200);
  const nodes0 = s.roadRecords().nodes.length;
  const up = s.upgradeRoad({ edgeId: mid, kind: 'avenue' });
  assert.ok(up.ok, !up.ok ? up.error.message : '');
  const rec = s.roadRecords();
  assert.equal(rec.nodes.length, nodes0);
  assert.equal(rec.edges.length, 3);
  const junction = rec.nodes.find((n) => Math.abs(n.x) < 0.01 && Math.abs(n.z - 40) < 0.01)!;
  assert.equal(rec.edges.filter((e) => e.a === junction.id || e.b === junction.id).length, 3, 'le carrefour garde ses 3 branches');
});

test('simulation : un bâtiment riverain qui gêne l\'élargissement est nommé, il reste en place s\'il ne gêne pas', () => {
  const s = newTownSim();
  const id = seg(s, -240, 0, 0, 0);
  const a = s.getAsset('maison')!;
  const d = a.footprint.tilesZ * TILE_SIZE;
  // Maison au nord, façade à 8 m de l'axe (la rue fait 12,4 m, l'avenue 23 m) ; une autre loin au sud.
  const near = s.placeBuilding({ assetId: 'maison', x: -120, z: -8 - d / 2, rot: 0 });
  const far = s.placeBuilding({ assetId: 'maison', x: -120, z: 30 + d / 2, rot: 2 });
  assert.ok(near.ok && far.ok);
  const m0 = s.economy.money;
  const r = s.upgradeRoad({ edgeId: id, kind: 'avenue' });
  assert.ok(!r.ok);
  assert.equal(r.error.code, 'COLLISION');
  assert.match(r.error.message, /Test maison/);
  assert.match(r.error.message, /empiète de 3,5 m/);
  assert.equal(s.economy.money, m0);
  assert.equal(s.buildings.count, 2);
  // Sens unique (12,2 m) : plus étroit, accepté ; les deux maisons restent.
  const ow = s.upgradeRoad({ edgeId: id, kind: 'oneway' });
  assert.ok(ow.ok, !ow.ok ? ow.error.message : '');
  assert.equal(s.buildings.count, 2);
  assert.ok(s.buildings.indexOf(near.data.buildingId) >= 0 && s.buildings.indexOf(far.data.buildingId) >= 0);
  // Démolition de la maison gênante : l'avenue passe, la maison éloignée reste.
  assert.ok(s.demolish({ buildingId: near.data.buildingId }).ok);
  const ok = s.upgradeRoad({ edgeId: ow.data.edgeId, kind: 'avenue' });
  assert.ok(ok.ok, !ok.ok ? ok.error.message : '');
  assert.ok(s.buildings.indexOf(far.data.buildingId) >= 0);
});

test('simulation : route voisine parallèle trop proche pour un élargissement', () => {
  const s = newTownSim();
  const id = seg(s, -240, 0, 0, 0);
  seg(s, -240, 16, 0, 16);
  const r = s.upgradeRoad({ edgeId: id, kind: 'boulevard' });
  assert.ok(!r.ok && r.error.code === 'COLLISION' && /route voisine/.test(r.error.message), !r.ok ? r.error.message : 'accepté');
});

test('simulation : sens unique inversé (extrémités échangées), refus sur une rue à double sens', () => {
  const s = newTownSim();
  const id = seg(s, -200, -80, -40, -80, 'oneway');
  const before = s.roadRecords().edges.find((e) => e.id === id)!;
  const m0 = s.economy.money;
  const r = s.upgradeRoad({ edgeId: id, reverse: true });
  assert.ok(r.ok, !r.ok ? r.error.message : '');
  assert.ok(r.data.cost > 0 && s.economy.money === m0 - r.data.cost);
  const after = s.roadRecords().edges.find((e) => e.id === r.data.edgeId)!;
  assert.equal(after.a, before.b);
  assert.equal(after.b, before.a);
  // Rue à double sens : rien à inverser.
  const st = seg(s, -200, 80, -40, 80);
  const bad = s.upgradeRoad({ edgeId: st, reverse: true });
  assert.ok(!bad.ok && bad.error.code === 'INVALID_ARGS' && /sens unique/.test(bad.error.message));
  // Rue → sens unique inversé en une seule commande.
  const both = s.upgradeRoad({ edgeId: st, kind: 'oneway', reverse: true });
  assert.ok(both.ok);
});

test('simulation : autoroute raccordée à des rues refusée, tronçon inconnu, fonds insuffisants', () => {
  const s = newTownSim();
  seg(s, -200, 0, 0, 0);
  const b = seg(s, 0, 0, 200, 0);
  const hw = s.upgradeRoad({ edgeId: b, kind: 'highway' });
  assert.ok(!hw.ok && hw.error.code === 'NOT_IMPLEMENTED');
  const nf = s.upgradeRoad({ edgeId: 9999, kind: 'avenue' });
  assert.ok(!nf.ok && nf.error.code === 'NOT_FOUND');
  const poor = newTownSim(20_000);
  const p = seg(poor, -100, 0, 60, 0);
  const r = poor.upgradeRoad({ edgeId: p, kind: 'boulevard' });
  assert.ok(!r.ok && r.error.code === 'INSUFFICIENT_FUNDS');
});

test('sauvegarde : type et sens modifiés conservés au rechargement (format inchangé)', () => {
  const s = newTownSim();
  const id = seg(s, -200, 0, -40, 0, 'oneway');
  const r = s.upgradeRoad({ edgeId: id, kind: 'oneway', reverse: true });
  assert.ok(r.ok);
  const a = s.upgradeRoad({ edgeId: seg(s, -200, 60, -40, 60), kind: 'avenue' });
  assert.ok(a.ok);
  const save = JSON.parse(JSON.stringify(s.toSave()));
  const t = new Simulation();
  t.setCatalog(townCatalog());
  assert.equal(t.fromSave(save), null);
  const norm = (sim: Simulation): string => JSON.stringify(sim.roadRecords().edges.map((e) => [e.id, e.a, e.b, (e as { kind?: string }).kind]).sort());
  assert.equal(norm(t), norm(s));
});

test('protocole : validation des arguments et aller-retour par le répartiteur', () => {
  const v = (args: unknown): string | null => validateCommandMessage({ kind: 'cmd', reqId: 1, name: 'upgradeRoad', args })?.message ?? null;
  assert.equal(v({ edgeId: 3, kind: 'avenue' }), null);
  assert.equal(v({ edgeId: 3, reverse: true }), null);
  assert.ok(v({ edgeId: 'x', kind: 'avenue' }));
  assert.ok(v({ edgeId: 3, kind: 'autoroute-volante' }));
  assert.ok(v({ edgeId: 3 }), 'rien à modifier');
  assert.ok(v({ edgeId: 3, reverse: 'oui' }));
  const s = new Simulation();
  let req = 1;
  const cmd = (name: string, args: unknown): ResultMessage => handleCommand(s, { kind: 'cmd', reqId: req++, name, args }).result as ResultMessage;
  assert.ok(cmd('init', { protocolVersion: PROTOCOL_VERSION, catalog: townCatalog() }).ok);
  assert.ok(cmd('newGame', { seed: 7, mapChunks: 4, startMoney: 5_000_000, cityName: 'P', terrain: { hydrology: 'aucune', rivers: 0 } }).ok);
  const b = cmd('buildRoad', { type: 'street', points: [-100, 0, 60, 0] });
  assert.ok(b.ok);
  const id = (b.data as { edgeIds: number[] }).edgeIds[0]!;
  const u = cmd('upgradeRoad', { edgeId: id, kind: 'boulevard' });
  assert.ok(u.ok, !u.ok ? u.error.message : '');
  assert.equal((u.data as { kind: string }).kind, 'boulevard');
  const bad = cmd('upgradeRoad', { edgeId: id });
  assert.ok(!bad.ok && bad.error.code === 'INVALID_ARGS');
});

test('delta : tronçon créé puis découpé entre deux deltas absent des deux listes (pas de fantôme chez le client)', () => {
  const s = newTownSim();
  s.takeDelta();
  const a = s.buildRoad({ type: 'street', points: [-200, 0, 0, 0] });
  assert.ok(a.ok);
  const first = a.data.edgeIds[0]!;
  // Deuxième commande dans le même lot : coupe la première rue en carrefour.
  assert.ok(s.buildRoad({ type: 'street', points: [-100, -80, -100, 80] }).ok);
  const d = s.takeDelta();
  assert.ok(!d.roadEdgesAdded.some((e) => e.id === first) && !d.roadEdgesRemoved.includes(first), 'tronçon transitoire omis');
  const live = new Set(s.roadRecords().edges.map((e) => e.id));
  assert.deepEqual(new Set(d.roadEdgesAdded.map((e) => e.id)), live, 'le delta décrit exactement le réseau final');
});
