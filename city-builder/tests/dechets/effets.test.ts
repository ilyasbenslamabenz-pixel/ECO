/**
 * Tests d'effet obligatoires du module déchets (docs/ROADMAP_PHASE2.md §4), dans une vraie Simulation
 * (bourg de test + modules `municipal` et `dechets` injectés). Chaque test modifie une décision / situation,
 * mesure l'effet ET le retrouve dans le registre d'effets du contrat municipal.
 *  1. Déchets non collectés -> pollution du sol, nuisances, satisfaction et valeur foncière en baisse.
 *  2. Décharge pleine -> débordement (pollution du sol et de l'eau autour de la décharge).
 *  3. Budget réduit -> moins de camions en service -> moins de tournées (et plus de déchets en attente).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NUISANCE_ID } from '../../src/sim/waste/system';
import { buildTown, runDays } from '../sim/fixtures';
import { buildDenseDistrict, buildWasteZone, wasteSim } from './fixtures';

/** Immeubles et maisons du bourg (rue z = 0, côté nord) : points de mesure. */
const HOUSES: [number, number][] = [[-56, -16], [-24, -16], [-204, -16], [-180, -16]];

function meanAt(grid: { at(x: number, z: number): number }, pts: [number, number][]): number {
  return pts.reduce((s, [x, z]) => s + grid.at(x, z), 0) / pts.length;
}

test('effet 1 : déchets non collectés -> pollution du sol, nuisances, satisfaction et valeur foncière en baisse', () => {
  // A : aucune collecte (pas d'installation). B : collecte quotidienne avec toutes les filières.
  const A = wasteSim();
  buildTown(A.sim);
  const B = wasteSim();
  buildTown(B.sim);
  buildWasteZone(B.sim);
  const r = B.sim.plugins.command('dechets', 'reglages', { collectsPerWeek: 7 });
  assert.ok(r.ok);
  runDays(A.sim, 10, 4);
  runDays(B.sim, 10, 4);
  const wa = A.dechets.waste, wb = B.dechets.waste;
  const ma = A.municipal.municipal, mb = B.municipal.municipal;

  // Non-collecte mesurée : A déborde (bacs pleins au bout de ~4 jours), B non.
  assert.ok(wa.totals.uncollectedKg > 500, `A non collecté ${wa.totals.uncollectedKg}`);
  assert.equal(wa.totals.collectedKg, 0);
  assert.ok(wb.totals.collectedKg > 1000, `B collecté ${wb.totals.collectedKg}`);
  assert.ok(wb.totals.uncollectedKg < wa.totals.uncollectedKg * 0.05, `B non collecté ${wb.totals.uncollectedKg}`);
  assert.match(wa.summary(A.sim.clock.dayIndex).blocked ?? '', /dépôt/);

  // Pollution du sol et nuisances au pied des maisons : nettement plus fortes sans collecte.
  const soilA = meanAt(ma.grids.require('pollution_sol'), HOUSES), soilB = meanAt(mb.grids.require('pollution_sol'), HOUSES);
  const nuisA = meanAt(ma.grids.require(NUISANCE_ID), HOUSES), nuisB = meanAt(mb.grids.require(NUISANCE_ID), HOUSES);
  assert.ok(soilA > 0.5 && soilA > soilB * 5 + 0.1, `sol A ${soilA} / B ${soilB}`);
  assert.ok(nuisA > 2 && nuisA > nuisB * 5 + 0.1, `nuisances A ${nuisA} / B ${nuisB}`);
  // Satisfaction (fond 50) et valeur foncière (fond 100) en baisse là où les bacs débordent.
  const satA = meanAt(ma.grids.require('satisfaction'), HOUSES), satB = meanAt(mb.grids.require('satisfaction'), HOUSES);
  const landA = meanAt(ma.grids.require('valeur_fonciere'), HOUSES), landB = meanAt(mb.grids.require('valeur_fonciere'), HOUSES);
  assert.ok(satA < 49 && satA < satB - 1, `satisfaction A ${satA} / B ${satB}`);
  assert.ok(landA < 99 && landA < landB - 1, `valeur foncière A ${landA} / B ${landB}`);

  // Registre d'effets : cause « déchets non collectés » -> pollution du sol (mesurée sur la grille) et masse.
  const causes = ma.effects.topCauses(20).filter((c) => c.cause.kind === 'dechets_non_collectes');
  assert.ok(causes.length >= 1);
  const by = causes[0]!.byTarget;
  assert.ok((by['pollution_sol'] ?? 0) > 0, JSON.stringify(by));
  assert.ok((by['dechets:non_collecte'] ?? 0) > 500, JSON.stringify(by));
  assert.equal(mb.effects.topCauses(20).some((c) => c.cause.kind === 'dechets_non_collectes' && (c.byTarget['dechets:non_collecte'] ?? 0) > 100), false);
});

test('effet 2 : décharge pleine -> débordement, pollution du sol et de l\'eau autour, tracé dans le registre', () => {
  // Dépôt + décharge seulement (pas d'incinérateur ni de tri) ; petite décharge (600 kg) contre grande (3 000 t).
  const run = (landfillKg: number): ReturnType<typeof wasteSim> => {
    const T = wasteSim({ landfillKg });
    buildTown(T.sim);
    buildWasteZone(T.sim, ['t_depot', 't_decharge']);
    T.sim.plugins.command('dechets', 'reglages', { collectsPerWeek: 7, sortShare: 0 });
    runDays(T.sim, 8, 4);
    return T;
  };
  const small = run(600), big = run(3_000_000);
  const ws = small.dechets.waste, wb = big.dechets.waste;
  const lfS = [...ws.facilities.values()].find((f) => f.kind === 'decharge')!;
  const lfB = [...wb.facilities.values()].find((f) => f.kind === 'decharge')!;
  // La petite décharge est pleine et refuse le reste : débordement mesuré.
  assert.equal(lfS.stock, 600);
  assert.ok(ws.totals.overflowKg > 500, `débordement ${ws.totals.overflowKg}`);
  assert.ok(ws.totals.collectedKg > 1000);
  // La grande enfouit tout, sans débordement.
  assert.equal(wb.totals.overflowKg, 0);
  assert.ok(lfB.stock > 1000 && lfB.stock < lfB.capacity);
  // Pollution autour de la décharge : plus forte quand elle déborde (sol ET eau).
  const soil = (T: ReturnType<typeof wasteSim>): number => T.municipal.municipal.grids.require('pollution_sol').meanIn(lfS.x, lfS.z, 100);
  const water = (T: ReturnType<typeof wasteSim>): number => T.municipal.municipal.grids.require('pollution_eau').meanIn(lfS.x, lfS.z, 150);
  assert.ok(soil(small) > soil(big) * 2, `sol ${soil(small)} / ${soil(big)}`);
  assert.ok(water(small) > water(big) * 1.5, `eau ${water(small)} / ${water(big)}`);
  // Registre : cause « décharge pleine » localisée sur la décharge, effets pollution du sol + masse débordée.
  const c = small.municipal.municipal.effects.topCauses(20).find((x) => x.cause.kind === 'decharge_pleine');
  assert.ok(c, 'cause décharge pleine');
  assert.equal(c.cause.ref, lfS.id);
  assert.ok((c.byTarget['pollution_sol'] ?? 0) > 0);
  assert.ok(Math.abs((c.byTarget['dechets:debordement'] ?? 0) - ws.totals.overflowKg) < 1, JSON.stringify(c.byTarget));
  assert.ok(small.sim.notices.some((n) => /Décharge pleine/.test(n.message)));
  assert.equal(big.municipal.municipal.effects.topCauses(20).some((x) => x.cause.kind === 'decharge_pleine'), false);
});

test('effet 3 : budget réduit -> moins de camions en service -> moins de tournées, plus de déchets non collectés', () => {
  // Bourg + quartier dense (≈ 4 000 habitants, ≈ 6 t/jour), 2 collectes par semaine, dépôt de 4 camions.
  const run = (funding: number): ReturnType<typeof wasteSim> => {
    const T = wasteSim({ trucks: 4 });
    buildTown(T.sim);
    buildDenseDistrict(T.sim, 5);
    buildWasteZone(T.sim);
    runDays(T.sim, 1, 4);
    T.sim.plugins.command('dechets', 'reglages', { collectsPerWeek: 2, funding });
    runDays(T.sim, 21, 4);
    return T;
  };
  const full = run(1), low = run(0.25);
  const wf = full.dechets.waste, wl = low.dechets.waste;
  const sf = wf.summary(full.sim.clock.dayIndex), sl = wl.summary(low.sim.clock.dayIndex);
  assert.equal(sf.activeTrucks, 4);
  assert.equal(sl.activeTrucks, 1);
  assert.ok(sl.monthlyBudget < sf.monthlyBudget, `${sl.monthlyBudget} < ${sf.monthlyBudget}`);
  // 6 jours de collecte sur la période : au plus 1 tournée par jour avec 1 camion, jusqu'à 4 avec la flotte.
  assert.ok(wl.totals.tours <= 7, `tournées à 25 % : ${wl.totals.tours}`);
  assert.ok(wf.totals.tours >= 3 * wl.totals.tours, `tournées ${wf.totals.tours} vs ${wl.totals.tours}`);
  // Un camion ne peut vider que 2 bennes par service : moins de déchets ramassés, davantage qui débordent.
  assert.ok(wl.totals.collectedKg < wf.totals.collectedKg * 0.9, `${wl.totals.collectedKg} < ${wf.totals.collectedKg}`);
  assert.ok(wl.totals.uncollectedKg > wf.totals.uncollectedKg + 5000, `non collecté ${wl.totals.uncollectedKg} vs ${wf.totals.uncollectedKg}`);
  // Registre : la décision du joueur (financement 100 % -> 25 %) et ses effets (camions, budget, tournées).
  const c = low.municipal.municipal.effects.topCauses(20).find((x) => x.cause.kind === 'reglage_dechets');
  assert.ok(c, 'cause du réglage');
  assert.equal(c.cause.source, 'joueur');
  assert.match(c.cause.label, /financement 100 → 25 %/);
  assert.equal(c.byTarget['dechets:camions_en_service'], -3);
  assert.ok((c.byTarget['budget:dechets'] ?? 0) < 0);
  // Tournées des jours qui suivent la décision, rattachées à elle (au plus le total, au moins une).
  const after = c.byTarget['dechets:tournees_jour'] ?? 0;
  assert.ok(after >= 1 && after <= wl.totals.tours, `tournées rattachées ${after} / ${wl.totals.tours}`);
});
