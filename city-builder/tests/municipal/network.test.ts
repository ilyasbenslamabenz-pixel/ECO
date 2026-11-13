/** Graphe de réseau générique : édition, répartition offre / demande, pertes, capacités, priorités, pannes, sauvegarde. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Networks, ResourceNetwork } from '../../src/sim/municipal/network';

const close = (a: number, b: number, eps = 1e-6): void => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test('réseau simple : offre suffisante, tout le monde est servi, bilan cohérent', () => {
  const n = new ResourceNetwork('electricite');
  const p = n.addNode({ role: 'producer', capacity: 100 });
  const j = n.addNode({ role: 'junction' });
  const c1 = n.addNode({ role: 'consumer', demand: 30 });
  const c2 = n.addNode({ role: 'consumer', demand: 50 });
  n.addEdge(p, j, 1000); n.addEdge(j, c1, 1000); n.addEdge(j, c2, 1000);
  const r = n.allocate();
  assert.equal(r.supply, 100);
  assert.equal(r.demand, 80);
  close(r.delivered, 80);
  close(r.shortfall, 0);
  close(r.losses, 0);
  assert.ok(r.consumers.every((c) => !c.shed && c.ratio === 1));
  assert.deepEqual(r.shedByPriority, {});
  close(r.producers[0]!.output, 80);
});

test('pertes : le producteur fournit plus que ce que reçoit le consommateur', () => {
  const n = new ResourceNetwork('eau');
  const p = n.addNode({ role: 'producer', capacity: 1000 });
  const m = n.addNode({ role: 'junction' });
  const c = n.addNode({ role: 'consumer', demand: 81 });
  n.addEdge(p, m, 1000, 0.1); n.addEdge(m, c, 1000, 0.1);
  const r = n.allocate();
  close(r.delivered, 81);
  close(r.produced, 100, 1e-6);
  close(r.losses, 19, 1e-6);
  // La charge de la première arête porte le flux entrant (100), la seconde 90.
  close(r.edges[0]!.load * 1000, 100);
  close(r.edges[1]!.load * 1000, 90);
});

test('capacité de transit : goulot d\'étranglement, chemin alternatif utilisé', () => {
  const n = new ResourceNetwork('electricite');
  const p = n.addNode({ role: 'producer', capacity: 100 });
  const a = n.addNode({ role: 'junction' });
  const b = n.addNode({ role: 'junction' });
  const c = n.addNode({ role: 'consumer', demand: 70 });
  n.addEdge(p, a, 40); n.addEdge(a, c, 40);
  n.addEdge(p, b, 20, 0.5); n.addEdge(b, c, 100);
  const r = n.allocate();
  // 40 par le chemin sans perte, puis 20 envoyés sur le chemin à 50 % de pertes -> 10 livrés : 50 au total.
  close(r.delivered, 50);
  close(r.produced, 60);
  assert.equal(r.consumers[0]!.shed, true);
  close(r.consumers[0]!.ratio, 50 / 70);
});

test('pénurie : délestage des consommateurs les moins prioritaires d\'abord', () => {
  const n = new ResourceNetwork('electricite');
  const p = n.addNode({ role: 'producer', capacity: 100 });
  const hop = n.addNode({ role: 'consumer', demand: 40, priority: 10 });   // hôpital
  const eco = n.addNode({ role: 'consumer', demand: 40, priority: 5 });    // école
  const res = n.addNode({ role: 'consumer', demand: 40, priority: 0 });    // logements
  for (const c of [hop, eco, res]) n.addEdge(p, c, 1000);
  const r = n.allocate();
  const by = (id: number) => r.consumers.find((c) => c.node === id)!;
  assert.equal(by(hop).ratio, 1);
  assert.equal(by(eco).ratio, 1);
  close(by(res).delivered, 20);
  assert.equal(by(res).shed, true);
  assert.deepEqual(r.shedByPriority, { 0: 1 });
  close(r.shortfall, 20);
});

test('tout ou rien : un consommateur non entièrement servi est coupé et sa part reste disponible', () => {
  const n = new ResourceNetwork('electricite');
  const p = n.addNode({ role: 'producer', capacity: 100 });
  const big = n.addNode({ role: 'consumer', demand: 80, priority: 1, allOrNothing: true });
  const small = n.addNode({ role: 'consumer', demand: 30, priority: 1 });
  const smaller = n.addNode({ role: 'consumer', demand: 50, priority: 0 });
  for (const c of [big, small, smaller]) n.addEdge(p, c, 1000);
  // Ordre : priorité 1 (big puis small par identifiant), puis priorité 0.
  const r = n.allocate();
  const by = (id: number) => r.consumers.find((c) => c.node === id)!;
  assert.equal(by(big).delivered, 80);
  close(by(small).delivered, 20);
  close(by(smaller).delivered, 0);
  // Capacité réduite : big ne peut plus être entièrement servi -> coupé, small et smaller en profitent.
  n.setCapacity(p, 70);
  const r2 = n.allocate();
  const by2 = (id: number) => r2.consumers.find((c) => c.node === id)!;
  assert.equal(by2(big).delivered, 0);
  assert.equal(by2(big).shed, true);
  close(by2(small).delivered, 30);
  close(by2(smaller).delivered, 40);
  close(r2.produced, 70);
});

test('pannes : nœud ou arête hors service, composantes isolées', () => {
  const n = new ResourceNetwork('electricite');
  const p1 = n.addNode({ role: 'producer', capacity: 50 });
  const p2 = n.addNode({ role: 'producer', capacity: 50 });
  const c = n.addNode({ role: 'consumer', demand: 80 });
  const e1 = n.addEdge(p1, c, 100);
  n.addEdge(p2, c, 100);
  close(n.allocate().delivered, 80);
  n.setEdgeEnabled(e1, false);
  close(n.allocate().delivered, 50, 1e-9);
  n.setEdgeEnabled(e1, true);
  n.setNodeEnabled(p2, false);
  const r = n.allocate();
  close(r.delivered, 50);
  assert.equal(r.supply, 50, 'producteur en panne exclu de l\'offre');
  const isolated = n.addNode({ role: 'consumer', demand: 10 });
  const comps = n.components();
  assert.notEqual(comps.get(isolated), comps.get(c));
  assert.equal(n.allocate().consumers.find((x) => x.node === isolated)!.delivered, 0);
});

test('ordre de mérite : le producteur le moins cher est appelé d\'abord', () => {
  const n = new ResourceNetwork('electricite');
  const cher = n.addNode({ role: 'producer', capacity: 100, cost: 50 });
  const eco = n.addNode({ role: 'producer', capacity: 60, cost: 10 });
  const c = n.addNode({ role: 'consumer', demand: 80 });
  n.addEdge(cher, c, 1000); n.addEdge(eco, c, 1000);
  const r = n.allocate();
  const out = (id: number) => r.producers.find((p) => p.node === id)!.output;
  close(out(eco), 60);
  close(out(cher), 20);
});

test('édition et validation ; suppression d\'un nœud retire ses arêtes', () => {
  const n = new ResourceNetwork('egouts');
  const a = n.addNode({ role: 'producer', capacity: 10 });
  const b = n.addNode({ role: 'consumer', demand: 5 });
  assert.throws(() => n.addEdge(a, a, 1), /boucle/);
  assert.throws(() => n.addEdge(a, b, 1, 1), /pertes/);
  assert.throws(() => n.addEdge(a, 999, 1), /inconnu/);
  assert.throws(() => n.addNode({ role: 'consumer', demand: Number.NaN }), /invalide/);
  n.addEdge(a, b, 10);
  const v = n.version;
  n.setDemand(b, 8);
  assert.ok(n.version > v);
  assert.equal(n.node(b)!.demand, 8);
  assert.ok(n.removeNode(a));
  assert.equal(n.edgeCount, 0);
  assert.equal(n.allocate().delivered, 0);
});

test('déterminisme et sauvegarde : même bilan après aller-retour JSON', () => {
  const nets = new Networks();
  const n = nets.ensure('electricite');
  const ids: number[] = [];
  for (let k = 0; k < 6; k++) ids.push(n.addNode({ role: k % 3 === 0 ? 'producer' : 'consumer', capacity: 40, demand: 25, priority: k % 2, x: k * 10 }));
  for (let k = 1; k < ids.length; k++) n.addEdge(ids[k - 1]!, ids[k]!, 30, 0.05);
  n.addEdge(ids[0]!, ids[5]!, 15, 0.02);
  const r1 = nets.allocate('electricite');
  assert.deepEqual(n.allocate(), r1, 'répartition déterministe');
  const back = Networks.fromJSON(JSON.parse(JSON.stringify(nets.toJSON())));
  assert.deepEqual(back.allocate('electricite'), r1);
  assert.deepEqual(nets.lastReport('electricite'), r1);
  const added = back.get('electricite')!.addNode({ role: 'junction' });
  assert.ok(added > Math.max(...ids), 'identifiants poursuivis après chargement');
});

test('performance indicative : 2 000 consommateurs en arbre, répartition < 2 s', () => {
  const n = new ResourceNetwork('electricite');
  const p = n.addNode({ role: 'producer', capacity: 1e9 });
  let prev = p;
  for (let k = 0; k < 200; k++) {
    const j = n.addNode({ role: 'junction' });
    n.addEdge(prev, j, 1e9, 0.001);
    for (let c = 0; c < 10; c++) n.addEdge(j, n.addNode({ role: 'consumer', demand: 1, priority: c % 3 }), 10);
    prev = j;
  }
  const t0 = performance.now();
  const r = n.allocate();
  const dt = performance.now() - t0;
  close(r.delivered, 2000, 1e-6);
  assert.ok(dt < 2000, `${dt.toFixed(0)} ms`);
});
