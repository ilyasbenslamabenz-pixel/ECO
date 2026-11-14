/** Politiques publiques et recherche municipale (phase 2C) : coûts, effets mesurés, sauvegarde. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../../src/sim/world';
import { buildTown, newTownSim, runDays, townCatalog } from '../sim/fixtures';

const cmd = (s: Simulation, plugin: string, name: string, payload?: unknown): { ok: boolean; data?: unknown; message?: string } => {
  const r = s.plugins.command(plugin, name, payload) as { ok: boolean; data?: { data?: unknown }; error?: { message: string } };
  return { ok: r.ok, data: r.data?.data, message: r.error?.message };
};
const happiness = (s: Simulation): number => s.demography!.report(s.clock.totalMinutes, s.economy.taxRates.residential).happiness;

test('politique : coût mensuel prélevé (ligne services) et effet sur le bonheur (aide au logement)', () => {
  const a = newTownSim(); buildTown(a); runDays(a, 10);
  const b = newTownSim(); buildTown(b); runDays(b, 10);
  assert.ok(cmd(b, 'politiques', 'toggle', { id: 'aide_logement', on: true }).ok);
  runDays(a, 40); runDays(b, 40);
  const lastCost = (cmd(b, 'politiques', 'state').data as { lastCost: number }).lastCost;
  assert.ok(lastCost > 0, `coût du mois prélevé (${lastCost} CHF)`);
  assert.ok(happiness(b) > happiness(a) + 1, `bonheur ${happiness(a).toFixed(1)} -> ${happiness(b).toFixed(1)}`);
  const st = cmd(b, 'politiques', 'state').data as { totalCost: number; policies: { id: string; active: boolean }[] };
  assert.ok(st.policies.find((p) => p.id === 'aide_logement')!.active && st.totalCost > 0);
  // Abandon : plus de coût le mois suivant.
  assert.ok(cmd(b, 'politiques', 'toggle', { id: 'aide_logement', on: false }).ok);
  assert.equal((cmd(b, 'politiques', 'state').data as { totalCost: number }).totalCost, 0);
  assert.equal(cmd(b, 'politiques', 'toggle', { id: 'inconnue' }).ok, false);
});

test('politique : filtres industriels -> pollution subie par les habitants en baisse', () => {
  const a = newTownSim(); buildTown(a);
  const b = newTownSim(); buildTown(b);
  assert.ok(cmd(b, 'politiques', 'toggle', { id: 'filtres_industriels', on: true }).ok);
  runDays(a, 6); runDays(b, 6);
  const pol = (s: Simulation): number => s.demography!.report(s.clock.totalMinutes, 0.09).pollution ?? 0;
  assert.ok(pol(b) < pol(a) * 0.8 || pol(a) === 0, `pollution ${pol(a)} -> ${pol(b)}`);
});

test('recherche : points (écoles + budget), projet terminé -> entretien des routes réduit ; prérequis respectés', () => {
  const s = newTownSim(); buildTown(s); runDays(s, 2);
  const locked = cmd(s, 'recherche', 'start', { id: 'urbanisme_durable' });
  assert.equal(locked.ok, false); assert.match(locked.message ?? '', /Il faut d'abord/);
  assert.ok(cmd(s, 'recherche', 'budget', { budget: 30000 }).ok);
  assert.ok(cmd(s, 'recherche', 'start', { id: 'bitume_recycle' }).ok);
  const st0 = cmd(s, 'recherche', 'state').data as { pointsPerMonth: number; schools: number };
  assert.ok(st0.pointsPerMonth >= 60 && st0.schools >= 1, `points ${st0.pointsPerMonth}, écoles ${st0.schools}`);
  const roadsBefore = s.economy.forecast().expenses.roads;
  runDays(s, 75);
  const st = cmd(s, 'recherche', 'state').data as { projects: { id: string; done: boolean }[] };
  assert.ok(st.projects.find((p) => p.id === 'bitume_recycle')!.done, 'projet terminé');
  const roadsAfter = s.economy.forecast().expenses.roads;
  assert.ok(Math.abs(roadsAfter - roadsBefore * 0.85) < 0.5, `entretien des routes ${roadsBefore} -> ${roadsAfter}`);
  assert.ok(s.notices.some((n) => /Recherche terminée/.test(n.message)));
});

test('sauvegarde : politiques et recherche conservées, même évolution après rechargement', () => {
  const a = newTownSim(); buildTown(a); runDays(a, 3);
  cmd(a, 'politiques', 'toggle', { id: 'ville_verte', on: true });
  cmd(a, 'recherche', 'budget', { budget: 5000 });
  cmd(a, 'recherche', 'start', { id: 'eclairage_led' });
  runDays(a, 35);
  const save = JSON.parse(JSON.stringify(a.toSave()));
  assert.ok(save.plugins?.politiques && save.plugins?.recherche, 'sections écrites');
  const b = new Simulation(); b.setCatalog(townCatalog());
  assert.equal(b.fromSave(save), null);
  const sa = cmd(a, 'recherche', 'state').data, sb = cmd(b, 'recherche', 'state').data;
  assert.deepEqual(sb, sa);
  assert.deepEqual(cmd(b, 'politiques', 'state').data, cmd(a, 'politiques', 'state').data);
  runDays(a, 20); runDays(b, 20);
  assert.equal(Math.round(b.economy.money), Math.round(a.economy.money));
  assert.equal(b.demography!.population, a.demography!.population);
});
