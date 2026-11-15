/** Améliorations des services : niveaux 1 à 3, coût des travaux, refus hors service, entretien, sauvegarde. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../../src/sim/world';
import { buildTown, newTownSim, runDays, townCatalog } from '../sim/fixtures';

const cmd = (s: Simulation, name: string, payload?: unknown): { ok: boolean; data?: Record<string, unknown>; message?: string } => {
  const r = s.plugins.command('ameliorations', name, payload) as { ok: boolean; data?: { data?: Record<string, unknown> }; error?: { message: string } };
  return { ok: r.ok, data: r.data?.data, message: r.error?.message };
};

test('améliorations : école niveau 2 puis 3 (coût payé), maison refusée, niveau max, sauvegarde', () => {
  const s = newTownSim(); buildTown(s); runDays(s, 1);
  const st = s.buildings;
  let svc = -1, house = -1;
  for (let i = 0; i < st.count; i++) {
    const a = s.catalog!.assets[st.assetIndex[i]!]!;
    if (svc < 0 && a.tags.some((t) => t.startsWith('service:'))) svc = st.id[i]!;
    if (house < 0 && a.capacity.residents > 0) house = st.id[i]!;
  }
  if (svc < 0) {
    // Ville de test sans équipement : on en pose un.
    const asset = s.catalog!.assets.find((a) => a.tags.some((t) => t.startsWith('service:')))!;
    for (const [x, z] of [[400, 400], [-400, 400], [400, -400], [-400, -400]] as const) { const r = s.placeBuilding({ assetId: asset.id, x, z, rot: 0 }); if (r.ok) { svc = r.data.buildingId; break; } }
  }
  assert.ok(svc > 0 && house > 0);
  assert.equal(cmd(s, 'upgrade', { buildingId: house }).ok, false, 'maison refusée');
  const i1 = cmd(s, 'info', { buildingId: svc }).data!;
  assert.equal(i1['level'], 1);
  const money = s.economy.money;
  const r = cmd(s, 'upgrade', { buildingId: svc });
  assert.ok(r.ok, r.message);
  assert.equal(Math.round(money - s.economy.money), i1['upgradeCost'], 'coût des travaux payé');
  assert.ok(cmd(s, 'upgrade', { buildingId: svc }).ok);
  assert.equal(cmd(s, 'info', { buildingId: svc }).data!['level'], 3);
  assert.equal(cmd(s, 'upgrade', { buildingId: svc }).ok, false, 'niveau maximal');
  const save = JSON.parse(JSON.stringify(s.toSave()));
  const c = new Simulation(); c.setCatalog(townCatalog());
  assert.equal(c.fromSave(save), null);
  assert.equal(cmd(c, 'info', { buildingId: svc }).data!['level'], 3);
});
