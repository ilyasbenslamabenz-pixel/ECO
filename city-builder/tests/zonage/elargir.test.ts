/**
 * Élargir une rue zonée (outil Améliorer, « Démolir les bâtiments gênants ») : refus sans l'option, démolition des
 * lots riverains avec, puis le zonage reconstruit en retrait de la nouvelle emprise (aucun bâtiment sur l'avenue).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zoningTown } from './fixtures';
import { advanceHours } from '../electricite/fixtures';

test('rue zonée élargie en avenue : lots démolis puis reconstruits en retrait', () => {
  const t = zoningTown();
  assert.ok(t.sim.buildRoad({ type: 'street', points: [-200, 0, 200, 0] }).ok);
  assert.ok(t.cmd('paint', { points: [-190, 0, 190, 0], zone: 'res_faible', depth: 2 }).ok);
  advanceHours(t.sim, 24 * 6);
  assert.ok(t.sys.owned.size >= 4, `${t.sys.owned.size} lots construits`);
  const edge = t.sim.roadRecords().edges[0]!.id;
  const no = t.sim.upgradeRoad({ edgeId: edge, kind: 'avenue' });
  assert.ok(!no.ok && /empiète/.test(no.error.message), 'refus sans l\'option');
  const up = t.sim.upgradeRoad({ edgeId: edge, kind: 'avenue', demolishBuildings: true });
  assert.ok(up.ok, !up.ok ? up.error.message : '');
  assert.ok((up.data.demolishedIds?.length ?? 0) > 0);
  advanceHours(t.sim, 24 * 8);
  assert.ok(t.sys.owned.size >= 4, `reconstruction : ${t.sys.owned.size} lots`);
  // Demi-avenue 11,5 m : aucun bâtiment centré sur la chaussée ou le trottoir.
  const st = t.sim.buildings;
  for (let i = 0; i < st.count; i++) assert.ok(Math.abs(st.z[i]!) > 13.5, `bâtiment à ${st.z[i]!.toFixed(1)} m de l'axe`);
});
