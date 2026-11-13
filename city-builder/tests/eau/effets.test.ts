/**
 * Tests d'effet du service de l'eau (docs/ROADMAP_PHASE2.md §4) : une décision ou une situation est modifiée,
 * l'effet est MESURÉ dans la simulation et retrouvé dans le registre d'effets du contrat municipal.
 *  1. Pénurie d'eau (financement coupé) -> bâtiments non desservis, satisfaction en baisse, croissance bloquée.
 *  2. Égouts sans station (émissaire seul) -> pollution du cours d'eau en aval, décroissante, nulle en amont.
 *  3. Station d'épuration sous-financée -> épuration partielle : charge rejetée et pollution aval plus fortes.
 *  4. Pompage en aval d'un rejet -> eau captée polluée -> qualité, risque sanitaire et satisfaction dégradés.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Simulation } from '../../src/sim/world';
import { EAU_SERVICE, type EauService } from '../../src/sim/plugins/eau';
import { GRID_HEALTH, GRID_SERVED } from '../../src/sim/water-network/system';
import { buildTown } from '../sim/fixtures';
import { buildRiverTown, eauPlugins, linkTown, newSim, place, RIVER_MAP, RIVER_SEED, runHours } from './helpers';

const cellMean = (g: { cellAt(x: number, z: number): number; data: Float32Array }, pts: [number, number][]): number =>
  pts.reduce((a, [x, z]) => a + g.data[g.cellAt(x, z)]!, 0) / pts.length;

function housesXZ(s: Simulation, ids: number[]): [number, number][] {
  return ids.map((id) => { const i = s.buildings.indexOf(id); return [s.buildings.x[i]!, s.buildings.z[i]!]; });
}

test('effet 1 : pénurie d\'eau (financement coupé) -> non desservis, satisfaction en baisse, croissance bloquée', (t) => {
  const { plugins, eau } = eauPlugins();
  const s = newSim(plugins);
  buildTown(s);
  linkTown(s);
  place(s, 'eau_station_pompage', 120, 96, 2);
  place(s, 'eau_usine_potabilisation', 150, 100, 2);
  runHours(s, 50);
  const sys = eau.system, m = eau.municipalOf()!;
  const homes: number[] = [];
  for (let i = 0; i < s.buildings.count; i++) if (s.buildings.residents[i]! > 0) homes.push(s.buildings.id[i]!);
  const pts = housesXZ(s, homes);
  const sat = m.grids.get('satisfaction')!, served = m.grids.get(GRID_SERVED)!;
  const before = { unserved: sys.balance!.unserved, sat: cellMean(sat, pts), served: cellMean(served, pts) };
  assert.equal(before.unserved, 0, 'situation de départ : tous desservis');
  const svc = s.plugins.contextOf('eau')!.use<EauService>(EAU_SERVICE)!;
  assert.ok(homes.every((id) => svc.growthAllowed(id)));

  // Décision : financement du service d'eau coupé (production nulle).
  s.pluginCommand({ plugin: 'eau', name: 'settings', payload: { fundingWater: 0 } });
  runHours(s, 50);
  const b = sys.balance!;
  assert.equal(b.served, 0, `plus aucun bâtiment desservi (${b.unserved}/${b.buildings})`);
  assert.ok(b.delivered === 0 && b.demand > 0);
  const after = { sat: cellMean(sat, pts), served: cellMean(served, pts) };
  assert.ok(after.served < 0.05 && before.served > 0.95, `desserte ${before.served} -> ${after.served}`);
  assert.ok(after.sat < before.sat - 15, `satisfaction ${before.sat.toFixed(1)} -> ${after.sat.toFixed(1)}`);
  assert.ok(homes.every((id) => !svc.growthAllowed(id)), 'croissance refusée aux logements non desservis');
  t.diagnostic(`desserte ${before.served.toFixed(2)} -> ${after.served.toFixed(2)} ; satisfaction ${before.sat.toFixed(1)} -> ${after.sat.toFixed(1)} ; non desservis ${b.unserved}/${b.buildings}`);
  // Registre : cause « pénurie » avec le nombre de bâtiments touchés, décision du joueur mesurée à J+1.
  const causes = m.effects.topCauses(20);
  const pen = causes.find((c) => c.cause.kind === 'penurie_eau');
  assert.ok(pen && pen.byTarget['eau:batiments_non_desservis']! >= b.buildings);
  const reg = causes.find((c) => c.cause.kind === 'reglage_eau' && c.cause.source === 'joueur');
  assert.ok(reg, 'décision du joueur tracée');
  assert.ok((reg.byTarget[GRID_SERVED] ?? 0) < 0, `effet mesuré sur la desserte : ${JSON.stringify(reg.byTarget)}`);
  assert.ok((reg.byTarget['satisfaction'] ?? 0) < 0, 'effet mesuré sur la satisfaction');

  // Rétablissement : financement rendu -> desservis à nouveau.
  s.pluginCommand({ plugin: 'eau', name: 'settings', payload: { fundingWater: 1 } });
  runHours(s, 30);
  assert.equal(sys.balance!.unserved, 0);
});

/** Bourg riverain + installations ; `withStep` : station d'épuration en plus de l'émissaire. */
function riverTown(opts: { withStep: boolean; plant: boolean }): { s: Simulation; eau: ReturnType<typeof eauPlugins>['eau']; homes: number[] } {
  const { plugins, eau } = eauPlugins();
  const s = newSim(plugins, RIVER_MAP, RIVER_SEED);
  const homes = buildRiverTown(s);
  place(s, 'eau_emissaire', -328, 256, 2);
  place(s, 'eau_station_pompage', -296, 264, 2);
  if (opts.plant) place(s, 'eau_usine_potabilisation', -264, 264, 2);
  if (opts.withStep) place(s, 'eau_station_epuration', -232, 264, 2);
  return { s, eau, homes };
}

test('effet 2 : égouts sans station d\'épuration -> pollution du cours d\'eau mesurée en aval (décroissante), nulle en amont', (t) => {
  const { s, eau } = riverTown({ withStep: false, plant: true });
  runHours(s, 60);
  const sys = eau.system, m = eau.municipalOf()!, river = sys.hydro!;
  const b = sys.balance!;
  assert.ok(b.sewageRaw > 0.1, `rejet brut ${b.sewageRaw}`);
  assert.equal(b.sewageTreated, 0);
  const em = sys.facilityStates().find((f) => f.kind === 'emissaire')!;
  assert.ok(em.outfall, 'émissaire au bord de l\'eau');
  const k = river.cellAt(em.outfall[0], em.outfall[1]);
  const path = river.pathFrom(k, 40);
  const g = m.grids.get('pollution_eau')!;
  const along = path.map((c) => g.data[c]!);
  assert.ok(along[0]! > 5, `pollution à l'exutoire : ${along[0]}`);
  assert.ok(along[10]! > 0 && along[10]! < along[0]!, `aval à 10 cellules : ${along[10]}`);
  for (let i = 1; i < along.length; i++) assert.ok(along[i]! <= along[i - 1]! + 1e-4, `décroissante vers l'aval (${i})`);
  t.diagnostic(`rejet brut ${b.sewageRaw.toFixed(2)} m³/h ; pollution_eau le long de l'aval : ${[0, 1, 2, 5, 10, 20, 39].map((i) => along[i]!.toFixed(2)).join(' / ')}`);
  // Cellules en eau qui ne sont pas en aval du rejet : propres.
  const downstream = new Set(path.concat(river.pathFrom(path[path.length - 1]!, 100000)));
  let clean = 0, dirty = 0;
  for (const c of river.cells()) { if (downstream.has(c)) continue; if (g.data[c]! > 1e-3) dirty++; else clean++; }
  assert.ok(clean > 50 && dirty === 0, `hors aval : ${clean} propres, ${dirty} polluées`);
  // Registre : cause « rejet » mesurée sur pollution_eau.
  const c = m.effects.topCauses(20).find((x) => x.cause.kind === 'rejet_eaux_usees');
  assert.ok(c && (c.byTarget['pollution_eau'] ?? 0) > 0, `effet mesuré : ${JSON.stringify(c?.byTarget)}`);
});

test('effet 3 : station d\'épuration sous-financée -> épuration partielle (charge et pollution aval plus fortes)', (t) => {
  const run = (fundingSewer: number): { load: number; eff: number; treated: number; raw: number; downstream: number } => {
    const { s, eau } = riverTown({ withStep: true, plant: true });
    s.pluginCommand({ plugin: 'eau', name: 'settings', payload: { fundingSewer } });
    runHours(s, 60);
    const sys = eau.system;
    const step = sys.facilityStates().find((f) => f.kind === 'epuration')!;
    const g = eau.municipalOf()!.grids.get('pollution_eau')!;
    const river = sys.hydro!;
    const k = river.cellAt(step.outfall![0], step.outfall![1]);
    const path = river.pathFrom(k, 30);
    const avg = sys.history.slice(-24);
    const mean = (f: (h: (typeof avg)[number]) => number): number => avg.reduce((a, h) => a + f(h), 0) / avg.length;
    return { load: mean((h) => h.pollutionLoad), eff: step.efficiency!, treated: mean((h) => h.sewageTreated), raw: mean((h) => h.sewageRaw + h.sewageOverflow), downstream: path.reduce((a, c) => a + g.data[c]!, 0) };
  };
  const full = run(1), under = run(0.35);
  t.diagnostic(`financement 100 % : ${JSON.stringify(full)} ; 35 % : ${JSON.stringify(under)}`);
  assert.ok(full.treated > 0.1 && full.raw < 1e-6, `station à 100 % : tout est traité (${full.treated} traités, ${full.raw} bruts)`);
  assert.ok(Math.abs(full.eff - 0.92) < 1e-9 && under.eff < 0.5, `rendements ${full.eff} / ${under.eff}`);
  assert.ok(under.load > full.load * 3, `charge rejetée ${full.load.toFixed(3)} -> ${under.load.toFixed(3)}`);
  assert.ok(under.downstream > full.downstream * 2, `pollution aval ${full.downstream.toFixed(2)} -> ${under.downstream.toFixed(2)}`);
});

test('effet 4 : pompage en aval d\'un rejet -> eau polluée -> qualité, risque sanitaire et satisfaction en baisse', (t) => {
  // Sans usine de potabilisation : l'eau captée est distribuée telle quelle.
  const run = (withStep: boolean): { intake: number; quality: number; health: number; sat: number; downstreamIntake: boolean } => {
    const { s, eau, homes } = riverTown({ withStep, plant: false });
    runHours(s, 72);
    const sys = eau.system, m = eau.municipalOf()!, river = sys.hydro!;
    const pump = sys.facilityStates().find((f) => f.kind === 'pompage')!;
    const em = sys.facilityStates().find((f) => f.kind === 'emissaire')!;
    const intakeCell = river.nearestWet(pump.x, pump.z, 56);
    const downstreamIntake = river.pathFrom(river.cellAt(em.outfall![0], em.outfall![1])).includes(intakeCell);
    const pts = housesXZ(s, homes);
    return {
      intake: pump.intakePollution!, quality: sys.balance!.quality,
      health: cellMean(m.grids.get(GRID_HEALTH)!, pts), sat: cellMean(m.grids.get('satisfaction')!, pts), downstreamIntake,
    };
  };
  const clean = run(true), polluted = run(false);
  t.diagnostic(`avec station : ${JSON.stringify(clean)} ; sans station : ${JSON.stringify(polluted)}`);
  assert.ok(polluted.downstreamIntake, 'la prise d\'eau est en aval de l\'émissaire');
  assert.ok(polluted.intake > clean.intake + 3, `pollution captée ${clean.intake.toFixed(2)} -> ${polluted.intake.toFixed(2)}`);
  assert.ok(polluted.quality < clean.quality - 0.02, `qualité ${clean.quality.toFixed(3)} -> ${polluted.quality.toFixed(3)}`);
  assert.ok(polluted.health > clean.health, `risque sanitaire ${clean.health.toFixed(3)} -> ${polluted.health.toFixed(3)}`);
  assert.ok(polluted.sat < clean.sat, `satisfaction ${clean.sat.toFixed(2)} -> ${polluted.sat.toFixed(2)}`);
});
