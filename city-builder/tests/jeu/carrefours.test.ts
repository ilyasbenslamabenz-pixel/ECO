/** Carrefours réglables : feux forcés, stop, retour en automatique ; réglage conservé à la sauvegarde. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../../src/sim/world';
import { buildTown, newTownSim, runDays, townCatalog } from '../sim/fixtures';

const cmd = (s: Simulation, name: string, payload?: unknown): { ok: boolean; data?: unknown } => {
  const r = s.plugins.command('circulation', name, payload) as { ok: boolean; data?: { data?: unknown } };
  return { ok: r.ok, data: r.data?.data };
};
const signals = (s: Simulation): number[] => ((cmd(s, 'feux').data as { junctionId: number }[] | undefined) ?? []).map((j) => j.junctionId);

test('carrefour : feux forcés puis retour automatique ; refus d’un réglage inconnu ; sauvegarde', () => {
  const s = newTownSim(); buildTown(s);
  // Croisement en T de deux rues (3 branches) dans un coin libre.
  let built = false;
  for (const [x, z] of [[300, 300], [-300, 300], [300, -300], [-300, -300], [150, 150], [-150, -150], [0, 250], [250, 0]] as const) {
    if (!s.buildRoad({ type: 'street', kind: 'street', points: [x, z - 80, x, z + 80], dryRun: true }).ok) continue;
    if (!s.buildRoad({ type: 'street', kind: 'street', points: [x, z, x + 120, z], dryRun: true }).ok) continue;
    assert.ok(s.buildRoad({ type: 'street', kind: 'street', points: [x, z - 80, x, z + 80] }).ok);
    const r = s.buildRoad({ type: 'street', kind: 'street', points: [x, z, x + 120, z] });
    assert.ok(r.ok, r.ok ? '' : r.error.message);
    built = true; break;
  }
  assert.ok(built, 'emplacement libre pour le carrefour');
  runDays(s, 1);
  const roads = s.roadRecords();
  const deg = new Map<number, number>();
  for (const e of roads.edges) for (const n of [e.a, e.b]) deg.set(n, (deg.get(n) ?? 0) + 1);
  const before = new Set(signals(s));
  const node = [...deg].find(([n, d]) => d >= 3 && !before.has(n))?.[0];
  assert.ok(node !== undefined, 'carrefour sans feux');
  assert.ok(cmd(s, 'carrefour', { nodeId: node, mode: 'signal' }).ok);
  s.tick(2);
  assert.ok(signals(s).includes(node!), 'feux posés');
  assert.equal(cmd(s, 'carrefour', { nodeId: node, mode: 'rond' }).ok, false);
  const save = JSON.parse(JSON.stringify(s.toSave()));
  const s2 = new Simulation(); s2.setCatalog(townCatalog());
  assert.equal(s2.fromSave(save), null);
  s2.tick(2);
  assert.deepEqual(cmd(s2, 'carrefours').data, [{ nodeId: node, mode: 'signal' }]);
  assert.ok(signals(s2).includes(node!), 'feux conservés au chargement');
  assert.ok(cmd(s, 'carrefour', { nodeId: node, mode: 'auto' }).ok);
  s.tick(2);
  assert.ok(!signals(s).includes(node!), 'retour en automatique');
});
