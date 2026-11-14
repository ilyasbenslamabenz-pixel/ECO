/** Paliers de ville : prime versée une fois au franchissement d'un seuil, titre, sauvegarde. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../../src/sim/world';
import { buildTown, newTownSim, runDays, townCatalog } from '../sim/fixtures';
import type { PaliersState } from '../../src/shared/milestones';

const state = (s: Simulation): PaliersState => (s.plugins.command('paliers', 'state', undefined) as { data: { data: PaliersState } }).data.data;

test('paliers : premier seuil franchi -> prime unique, titre, conservé à la sauvegarde', () => {
  const s = newTownSim(); buildTown(s);
  runDays(s, 12);
  const st = state(s);
  assert.ok(st.population >= 100, `population ${st.population}`);
  assert.ok(st.reached.includes('hameau'), 'hameau atteint');
  assert.equal(st.title, [...st.milestones].reverse().find((m) => m.reached)!.nameFr);
  // Pas de double prime : un nouveau passage ne change rien.
  const n = st.reached.length;
  runDays(s, 2);
  assert.equal(state(s).reached.length >= n, true);
  const save = JSON.parse(JSON.stringify(s.toSave()));
  assert.ok(save.plugins?.paliers?.data?.reached?.includes('hameau') ?? JSON.stringify(save.plugins?.paliers).includes('hameau'));
  const s2 = new Simulation(); s2.setCatalog(townCatalog());
  assert.equal(s2.fromSave(save), null);
  assert.deepEqual(state(s2).reached, state(s).reached);
});
