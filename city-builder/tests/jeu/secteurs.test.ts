/** Secteurs : politique locale (bonheur des habitants du secteur), coût mensuel par bâtiment, chevauchement refusé, sauvegarde. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../../src/sim/world';
import { buildTown, newTownSim, runDays, townCatalog } from '../sim/fixtures';
import type { SecteursState } from '../../src/shared/secteurs';

const cmd = (s: Simulation, name: string, payload?: unknown): { ok: boolean; data?: SecteursState; message?: string } => {
  const r = s.plugins.command('secteurs', name, payload) as { ok: boolean; data?: { data?: SecteursState }; error?: { message: string } };
  return { ok: r.ok, data: r.data?.data, message: r.error?.message };
};
const happiness = (s: Simulation): number => s.demography!.report(s.clock.totalMinutes, s.economy.taxRates.residential).happiness;

test('secteur : embellissement -> bonheur en hausse, coût prélevé ; chevauchement refusé ; sauvegarde', () => {
  const a = newTownSim(); buildTown(a); runDays(a, 5);
  const b = newTownSim(); buildTown(b); runDays(b, 5);
  // Rectangle couvrant toute la ville de test.
  const st = b.buildings;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < st.count; i++) { x0 = Math.min(x0, st.x[i]!); z0 = Math.min(z0, st.z[i]!); x1 = Math.max(x1, st.x[i]!); z1 = Math.max(z1, st.z[i]!); }
  const r = cmd(b, 'create', { name: 'Centre', x0: x0 - 20, z0: z0 - 20, x1: x1 + 20, z1: z1 + 20 });
  assert.ok(r.ok, r.message);
  const id = r.data!.secteurs[0]!.id;
  assert.equal(r.data!.secteurs[0]!.buildings, st.count);
  assert.equal(cmd(b, 'create', { x0, z0, x1: x0 + 100, z1: z0 + 100 }).ok, false, 'chevauchement refusé');
  assert.ok(cmd(b, 'toggle', { id, policy: 'embellissement', on: true }).ok);
  assert.ok(cmd(b, 'toggle', { id, policy: 'police_proximite', on: true }).ok);
  assert.ok(cmd(b, 'state').data!.totalCost > 0);
  runDays(a, 35); runDays(b, 35);
  assert.ok(happiness(b) > happiness(a) + 1.5, `bonheur ${happiness(a).toFixed(1)} -> ${happiness(b).toFixed(1)}`);
  const save = JSON.parse(JSON.stringify(b.toSave()));
  const c = new Simulation(); c.setCatalog(townCatalog());
  assert.equal(c.fromSave(save), null);
  const back = cmd(c, 'state').data!;
  assert.deepEqual(back.secteurs.map((d) => [d.name, d.policies]), [['Centre', ['embellissement', 'police_proximite']]]);
});

test('secteur : cache à jour après démolition + pose (même nombre de bâtiments) et suppression', () => {
  const s = newTownSim(); buildTown(s); runDays(s, 1);
  const svc = s.plugins.contextOf('secteurs')!.use<{ happinessOf(id: number): number }>('secteurs')!;
  const st = s.buildings;
  // Secteur couvrant la rue z = 0 (côté nord, bâtiments vers z < 0).
  const r = cmd(s, 'create', { name: 'Sud', x0: -240, z0: -70, x1: 240, z1: 2 });
  assert.ok(r.ok, r.message);
  const id = r.data!.secteurs[0]!.id;
  assert.ok(cmd(s, 'toggle', { id, policy: 'embellissement', on: true }).ok);
  let inside = -1;
  for (let i = 0; i < st.count; i++) if (st.z[i]! < 0 && st.z[i]! > -70) { inside = st.id[i]!; break; }
  assert.ok(inside > 0);
  assert.equal(svc.happinessOf(inside), 3, 'politique appliquée');
  const count = cmd(s, 'state').data!.secteurs[0]!.buildings;
  // Démolition puis pose d'un nouveau bâtiment au même endroit (même nombre de bâtiments, nouvel identifiant).
  const k = st.indexOf(inside);
  const x = st.x[k]!, z = st.z[k]!, rot = st.rot[k]!;
  assert.ok(s.demolish({ buildingId: inside }).ok);
  const p1 = s.placeBuilding({ assetId: 'maison', x, z, rot });
  assert.ok(p1.ok, p1.ok ? '' : p1.error.message);
  assert.equal(svc.happinessOf(p1.data.buildingId), 3, 'nouveau bâtiment du secteur : politique appliquée');
  assert.equal(cmd(s, 'state').data!.secteurs[0]!.buildings, count, 'décompte à jour');
  // Suppression du secteur : plus d'effet.
  assert.ok(cmd(s, 'remove', { id }).ok);
  assert.equal(svc.happinessOf(p1.data.buildingId), 0, 'secteur supprimé : plus d’effet');
});
