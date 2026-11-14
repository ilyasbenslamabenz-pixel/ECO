/** Outil Déplacer : bâtiment déplacé (même identifiant, occupants conservés), contrôles de pose, gratuit. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTown, newTownSim, runDays } from '../sim/fixtures';

test('déplacer : même identifiant, habitants conservés, gratuit ; refus sur un autre bâtiment ; dryRun sans effet', () => {
  const s = newTownSim(); buildTown(s); runDays(s, 3);
  const st = s.buildings;
  let i = -1;
  for (let k = 0; k < st.count; k++) if (st.residents[k]! > 0) { i = k; break; }
  assert.ok(i >= 0, 'maison habitée');
  const id = st.id[i]!, x0 = st.x[i]!, z0 = st.z[i]!, rot = st.rot[i]!, res = st.residents[i]!;
  const money = s.economy.money;
  // Sur un autre bâtiment : refus.
  const j = i === 0 ? 1 : 0;
  const bad = s.runExt('moveBuilding', { buildingId: id, x: st.x[j]!, z: st.z[j]!, rot });
  assert.equal(bad.ok, false);
  // Petit déplacement (quelques mètres) : accepté, ou essai d'autres positions proches.
  let moved = false;
  for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2], [4, 0], [0, 4]] as const) {
    const dry = s.runExt('moveBuilding', { buildingId: id, x: x0 + dx, z: z0 + dz, rot, dryRun: true });
    if (!dry.ok) continue;
    assert.equal(st.x[st.indexOf(id)], x0, 'dryRun sans effet');
    const r = s.runExt('moveBuilding', { buildingId: id, x: x0 + dx, z: z0 + dz, rot });
    assert.ok(r.ok);
    moved = true;
    const k = st.indexOf(id);
    assert.ok(Math.abs(st.x[k]! - (x0 + dx)) < 0.01 && Math.abs(st.z[k]! - (z0 + dz)) < 0.01);
    assert.equal(st.residents[k], res, 'habitants conservés');
    break;
  }
  assert.ok(moved, 'déplacement accepté à quelques mètres');
  assert.equal(s.economy.money, money, 'gratuit');
  const d = s.takeDelta();
  assert.ok(d.buildingsRemoved.includes(id) && d.buildingsAdded.some((b) => b.id === id), 'delta retiré + rajouté');
});
