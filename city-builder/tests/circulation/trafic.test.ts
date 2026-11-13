/**
 * Circulation : changements de voie MOBIL, réacheminement sur la congestion observée, anti-blocage,
 * carte de congestion et embouteillages émergents.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TrafficSystem } from '../../src/sim/traffic/system';
import { TrafficGraph } from '../../src/sim/traffic/network';
import { mandatoryBSafe, mobilGain, mobilSafe, MOBIL_DEFAULT } from '../../src/sim/traffic/mobil';
import { congestionLevel } from '../../src/shared/protocol-ext/circulation';
import { edge, grid, gridBuildings, vehicleCatalog } from '../vehicles/fixtures';
import type { TrafficNetworkInput } from '../../src/sim/traffic/network';

const g = (t: TrafficSystem): TrafficGraph => (t as unknown as { graph: TrafficGraph }).graph;

test('MOBIL : sécurité et gain (politesse, biais à droite, seuil)', () => {
  // le suiveur de la voie cible ne doit pas être forcé de freiner plus que bSafe
  assert.equal(mobilSafe(-1.2, -0.3, 2.5), true);
  assert.equal(mobilSafe(-3.0, -0.3, 2.5), false);
  assert.equal(mobilSafe(-1.0, -4.0, 2.5), false);
  // gain : le véhicule accélère (+1), personne n'est gêné -> gain positif ; la politesse pénalise la gêne
  assert.ok(mobilGain(1, 0, 0, 0, 0, 0, 0, MOBIL_DEFAULT) > MOBIL_DEFAULT.threshold);
  const gene = mobilGain(1, 0, -2, 0, 0, 0, 0, MOBIL_DEFAULT);
  assert.ok(gene < 1 && gene > 0, 'la gêne du nouveau suiveur réduit le gain');
  // à gain égal, le retour à droite est préféré
  assert.ok(mobilGain(0, 0, 0, 0, 0, 0, 1, MOBIL_DEFAULT) > mobilGain(0, 0, 0, 0, 0, 0, -1, MOBIL_DEFAULT));
  // la tolérance d'un changement obligatoire croît quand la fin de voie approche
  assert.ok(mandatoryBSafe(200) < mandatoryBSafe(60));
  assert.ok(mandatoryBSafe(60) < mandatoryBSafe(10));
});

test('MOBIL : dépassement d\'un véhicule lent sur une avenue, puis retour à droite', () => {
  const t = new TrafficSystem({ seed: 2, maxVehicles: 10, demand: false });
  t.setCatalog(vehicleCatalog());
  const nodes = [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 900, y: 0, z: 0 }];
  const net: TrafficNetworkInput = { nodes, edges: [edge(1, 1, 2, 0, 0, 900, 0, 'avenue')] };
  t.setNetwork(net);
  t.step(0, 9);
  const gg = g(t);
  const arc = gg.edgeIndex(1) * 2;
  // lent devant (voie de droite), rapide derrière sur la même voie
  const lent = t.spawnVehicle(arc, 1, 120, arc, 850, 0, 0, 6);
  const vif = t.spawnVehicle(arc, 1, 60, arc, 860, 0, 0, 14);
  assert.ok(lent >= 0 && vif >= 0);
  t.vDes[lent] = 6; t.vDes[vif] = 22;
  const rangInitial = gg.linkRank[t.link[vif]!]!;
  let rangMax = rangInitial, depasse = false, revenu = false;
  for (let k = 0; k < 900; k++) {
    t.step(0.1, 9);
    t.vDes[lent] = 6;
    if (!t.alive[vif]) break;
    const r = gg.linkRank[t.link[vif]!]!;
    rangMax = Math.min(rangMax, r);
    if (r < rangInitial) depasse = true;
    if (depasse && r === rangInitial && t.s[vif]! > t.s[lent]!) revenu = true;
  }
  assert.ok(depasse, 'le véhicule rapide est passé sur la voie de gauche');
  assert.ok(revenu, 'puis revenu sur la voie de droite devant le lent (biais à droite)');
  assert.ok(t.stats.laneChanges >= 2);
});

test('MOBIL : aucun changement de voie quand l\'écart est insuffisant', () => {
  const t = new TrafficSystem({ seed: 2, maxVehicles: 10, demand: false });
  t.setCatalog(vehicleCatalog());
  const net: TrafficNetworkInput = { nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 900, y: 0, z: 0 }], edges: [edge(1, 1, 2, 0, 0, 900, 0, 'avenue')] };
  t.setNetwork(net);
  t.step(0, 9);
  const gg = g(t);
  const arc = gg.edgeIndex(1) * 2;
  const lent = t.spawnVehicle(arc, 1, 100, arc, 850, 0, 0, 4);
  const vif = t.spawnVehicle(arc, 1, 80, arc, 860, 0, 0, 10);
  // voie de gauche saturée autour du véhicule rapide
  const packs: number[] = [];
  for (let s = 30; s <= 400; s += 26) { const u = t.spawnVehicle(arc, 0, s, arc, 870, 0, 0, 4); if (u >= 0) packs.push(u); }
  // resserrement du flot de gauche à 10 m d'intervalle (écarts libres ≈ 5 m : insertion impossible)
  packs.forEach((u, i) => { t.s[u] = 30 + i * 10; });
  assert.ok(lent >= 0 && vif >= 0);
  assert.ok(packs.length >= 10, `voie de gauche remplie : ${packs.length}`);
  let insere = false;
  for (let k = 0; k < 200; k++) {
    for (const u of packs) t.vDes[u] = 4; // le flot de gauche reste lent et serré
    t.vDes[lent] = 4;
    t.step(0.1, 9);
    if (gg.linkRank[t.link[vif]!]! === 0) insere = true;
  }
  assert.equal(insere, false, 'le véhicule rapide ne s\'insère pas dans un flot serré');
});

test('Réacheminement : un itinéraire devenu lent est abandonné pour un parallèle libre', () => {
  // le véhicule part sur un réseau fluide ; le bouchon se forme DEVANT lui pendant son trajet
  const t = new TrafficSystem({ seed: 8, maxVehicles: 400, demand: false });
  t.setCatalog(vehicleCatalog());
  t.setNetwork(grid(6, 3, 300, () => 'rue'));
  t.step(0, 9);
  const gg = g(t);
  const arcOf = (id: number, dir = 0): number => gg.edgeIndex(id) * 2 + dir;
  const arena = (t as unknown as { arena: Int32Array }).arena;
  const routeOff = (t as unknown as { routeOff: Int32Array }).routeOff;

  const v = t.spawnVehicle(arcOf(1), 0, 10, arcOf(5), 100, 0);
  assert.ok(v >= 0);
  const itineraire = (): string => Array.from(arena.subarray(routeOff[v]!, routeOff[v]! + t.routeLen[v]!)).join(',');
  const initial = itineraire();
  assert.ok(initial.split(',').length >= 5, `itinéraire direct : ${initial}`);
  for (let k = 0; k < 50; k++) t.step(0.1, 9);

  // bouchon sur deux tronçons de la ligne du haut, loin devant
  for (const id of [3, 4]) {
    const a = arcOf(id);
    for (let s2 = 5; s2 < gg.edgeLen[a >> 1]! - 10; s2 += 7) {
      const u = t.spawnVehicle(a, 0, s2, a, gg.edgeLen[a >> 1]! - 5, 0, 0, 0);
      if (u >= 0) { t.vDes[u] = 0.05; t.v[u] = 0; }
    }
  }
  let change = '';
  for (let k = 0; k < 900 && t.alive[v] && !change; k++) {
    t.step(0.1, 9);
    const cur = itineraire();
    if (cur !== initial) change = cur;
  }
  assert.ok(t.stats.rerouted > 0, `réacheminements : ${t.stats.rerouted}`);
  assert.ok(change && change !== initial, 'le véhicule a changé d\'itinéraire');
  // l'itinéraire de secours évite les tronçons bouchés
  const evites = change.split(',').map(Number);
  assert.ok(!evites.includes(arcOf(3)) && !evites.includes(arcOf(4)), `nouvel itinéraire : ${change}`);
});

test('Réacheminement : désactivable (réglage du joueur)', () => {
  const t = new TrafficSystem({ seed: 8, maxVehicles: 200, demandScale: 3, reroute: false });
  t.setCatalog(vehicleCatalog());
  t.setNetwork(grid(4, 4, 140, () => 'rue'));
  t.setBuildings(gridBuildings(4, 4, 140));
  for (let k = 0; k < 600; k++) t.step(0.1, 8);
  assert.equal(t.stats.rerouted, 0);
  t.rerouteEnabled = true;
  for (let k = 0; k < 600; k++) t.step(0.1, 8);
  assert.ok(t.stats.rerouted >= 0);
});

test('Carte de congestion : géométrie du réseau, niveaux croissants avec l\'embouteillage', () => {
  assert.deepEqual([congestionLevel(1), congestionLevel(0.6), congestionLevel(0.4), congestionLevel(0.05)], [0, 1, 2, 3]);
  const t = new TrafficSystem({ seed: 5, maxVehicles: 400, demand: false });
  t.setCatalog(vehicleCatalog());
  t.setNetwork(grid(3, 3, 150, () => 'rue'));
  t.step(0, 9);
  const layout = t.congestionLayout();
  const gg = g(t);
  assert.equal(layout.edgeIds.length, gg.edgeCount);
  assert.equal(layout.ptStart.length, gg.edgeCount + 1);
  assert.ok(layout.half.every((h) => h > 1 && h < 30));
  const vide = t.congestionFrame();
  assert.ok(vide.level.every((l) => l === 0), 'réseau vide = fluide');

  const a = gg.edgeIndex(1) * 2;
  for (let s = 5; s < gg.edgeLen[a >> 1]! - 10; s += 7) {
    const v = t.spawnVehicle(a, 0, s, a, gg.edgeLen[a >> 1]! - 5, 0, 0, 0);
    if (v >= 0) { t.vDes[v] = 0.05; t.v[v] = 0; }
  }
  for (let k = 0; k < 400; k++) t.step(0.1, 9);
  const frame = t.congestionFrame();
  const i = frame.edgeIds.indexOf(1);
  assert.ok(frame.level[i]! >= 2, `tronçon saturé : niveau ${frame.level[i]}`);
  assert.ok(frame.density[i]! > 20, `densité ${frame.density[i]}`);
  assert.ok(frame.ratio[i]! < 0.5);
  const { congested, total } = t.congestedLength(2);
  assert.ok(congested > 0 && congested < total);
});

test('Anti-blocage : un véhicule sur une voie sans issue repart par une autre manœuvre', () => {
  const t = new TrafficSystem({ seed: 6, maxVehicles: 200, demandScale: 6, spawnPerStep: 10 });
  t.setCatalog(vehicleCatalog());
  t.setNetwork(grid(5, 5, 120, (h, i) => (h && i === 2 ? 'avenue' : 'rue')));
  t.setBuildings(gridBuildings(5, 5, 120));
  for (let k = 0; k < 4000; k++) t.step(0.1, 8);
  assert.ok(t.stats.arrived > 100, `trajets terminés : ${t.stats.arrived}`);
  // aucun interblocage durable : les retraits pour blocage restent marginaux
  assert.ok(t.stats.removedStuck <= t.stats.arrived * 0.02, `retirés ${t.stats.removedStuck} / arrivés ${t.stats.arrived}`);
});

test('Feux : l\'état des carrefours survit à une modification du réseau ailleurs', () => {
  const t = new TrafficSystem({ seed: 1, maxVehicles: 50, demand: false });
  t.setCatalog(vehicleCatalog());
  const net = grid(3, 3, 140, () => 'avenue');
  t.setNetwork(net);
  for (let k = 0; k < 200; k++) t.step(0.1, 9);
  const avant = t.signalSnapshot();
  // nouveau tronçon ajouté loin des carrefours existants
  const net2: TrafficNetworkInput = {
    nodes: [...net.nodes, { id: 99, x: -140, y: 0, z: 0 }],
    edges: [...net.edges, edge(99, 99, 1, -140, 0, 0, 0, 'rue')],
  };
  t.setNetwork(net2);
  t.step(0.1, 9);
  const apres = new Map(t.signalSnapshot().map((x) => [x.nodeId, x]));
  let compares = 0;
  for (const s of avant) {
    const a = apres.get(s.nodeId);
    if (!a) continue;
    assert.equal(a.phase, s.phase, `phase conservée (nœud ${s.nodeId})`);
    assert.equal(a.stage, s.stage, `étape conservée (nœud ${s.nodeId})`);
    compares++;
  }
  assert.ok(compares >= 4, `carrefours comparés : ${compares}`);
});
