/**
 * Scénario « ville du joueur » (panneau Déchets : « Camions 8 · 8 · 7 », « Hier : 0 tournée · 0 arrêt »,
 * « Prochaine collecte : vendredi », deux lignes « Centre de tri » à 0 kg, bacs qui débordent).
 *
 * Reproduction (même résultat, au kg près, sur 0e8e0be et après le correctif du trafic : les camions-bennes sont
 * simulés par le module, hors du trafic) : 65 producteurs, 2 dépôts (8 camions), 2 centres de tri, une décharge,
 * collecte 3 fois par semaine (lundi, mercredi, vendredi, départ 6 h).
 *  - « 7 en tournée » + « hier 0 · 0 » : capture faite le vendredi entre 6 h et 7 h, pendant la tournée ; jeudi
 *    n'est pas un jour de collecte. Les tournées durent < 1 h de jeu et se terminent toutes (aucun camion retenu).
 *  - « 0 kg traités hier » aux deux centres : rien n'arrive les jours sans collecte, et seul le centre le plus
 *    proche reçoit la part triée (l'autre ne sert jamais).
 *  - Débordements (vrai défaut) : un bac de moins de 20 kg était sauté à chaque passage ; les petits producteurs
 *    (maisons de 4 habitants : 4,8 kg/j, bac de 30 kg) débordaient le week-end. Avant : 321 kg non collectés en
 *    30 jours chez des bâtiments desservis (19 à 25 bacs pleins chaque dimanche) ; après : 0.
 *  - Un bâtiment sur une rue isolée n'était jamais collecté, sans aucune explication : il est maintenant signalé.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../../src/sim/world';
import { createMunicipalPlugin } from '../../src/sim/municipal';
import { createDechetsPlugin } from '../../src/sim/plugins/dechets';
import { facilityLabels, recommendedCollectsPerWeek, WASTE_PARAMS } from '../../src/shared/waste/types';
import { buildStreet } from '../sim/fixtures';
import { wasteCatalog } from './fixtures';

function playerTown(opts: { isolated?: boolean } = {}) {
  const municipal = createMunicipalPlugin(), dechets = createDechetsPlugin();
  const sim = new Simulation([municipal, dechets]);
  const cat = wasteCatalog({ trucks: 4 });
  const maison = cat.assets.find((a) => a.id === 'maison')!;
  cat.assets.push({ ...maison, id: 'maison4', capacity: { residents: 4, jobs: 0 } });
  sim.setCatalog(cat);
  sim.newGame({ seed: 1234, mapChunks: 4, startMoney: 80_000_000, cityName: 'Scénario', terrain: { hydrology: 'aucune', rivers: 0 } });
  const mix = ['maison4', 'maison', 'maison4', 'immeuble', 'maison', 'maison4', 'boutique', 'maison', 'maison4', 'maison', 'immeuble', 'immeuble', 'maison4'];
  for (const z of [80, 0, -80, -120, -160]) buildStreet(sim, z, -220, 220, mix);
  assert.ok(sim.buildRoad({ type: 'street', points: [220, -160, 220, 160] }).ok);
  if (opts.isolated) buildStreet(sim, -240, -220, -150, ['maison4']); // rue isolée : aucun camion n'y arrive
  buildStreet(sim, 160, -220, 220, ['t_depot', 't_depot', 't_tri', 't_tri', 't_decharge']);
  return { sim, waste: dechets.waste };
}

test('scénario joueur : « 7 en tournée, 0 hier » = tournée du vendredi matin ; plus aucun bac desservi ne déborde', () => {
  const { sim, waste } = playerTown();
  const DAY = 1440;
  let maxRun = 0, captured = false, sundayFull = 0;
  for (let m = 0; m < 30 * DAY; m += 2) {
    sim.tick(2);
    const now = sim.clock.totalMinutes;
    for (const r of waste.runs) maxRun = Math.max(maxRun, now - r.depart);
    // Vendredi de la 4e semaine, 6 h 30 : l'état de la capture du joueur.
    if (sim.clock.dayIndex === 25 && now % DAY === 6 * 60 + 30) {
      captured = true;
      const s = waste.summary(sim.clock.dayIndex, now);
      assert.equal(s.fleet, 8);
      assert.equal(s.activeTrucks, 8);
      assert.ok(s.trucksOnRoad >= 1, `camions en tournée : ${s.trucksOnRoad}`);
      assert.equal(s.lastDay!.tours, 0, 'jeudi : pas de collecte');
      assert.equal(s.lastDay!.stops, 0);
      assert.equal(s.lastDay!.collectedKg, 0);
      assert.ok(s.today!.tours >= 1 && s.today!.stops > 0, 'les tournées du jour sont comptées');
      assert.deepEqual(s.collectionDays, [0, 2, 4]);
      assert.equal(s.nextCollectionDay, 28, 'après le départ de 6 h, la prochaine tournée est lundi');
      assert.ok(!(s.diagnostics ?? []).some((d) => d.text.includes('anormalement')), 'aucun camion retenu');
    }
    if (sim.clock.dayIndex % 7 === 6 && now % DAY === 23 * 60) sundayFull = Math.max(sundayFull, waste.summary(sim.clock.dayIndex).overflowingBuildings);
  }
  assert.ok(captured);
  assert.ok(maxRun < WASTE_PARAMS.shiftMinutes, `tournée la plus longue : ${maxRun} min`);
  assert.equal(waste.runs.length, 0);
  const s = waste.summary(sim.clock.dayIndex, sim.clock.totalMinutes);
  assert.ok(s.producers >= 60, `producteurs ${s.producers}`);
  assert.equal(s.totals.uncollectedKg, 0, `non collectés : ${s.totals.uncollectedKg} kg`);
  assert.equal(sundayFull, 0, 'bacs pleins le dimanche soir');
  assert.equal(s.unservedProducers, 0);
  // Deux vrais centres de tri, numérotés ; le plus proche reçoit tout, l'autre est signalé inutilisé.
  const tris = s.facilities.filter((f) => f.kind === 'tri');
  assert.equal(tris.length, 2);
  const labels = facilityLabels(s.facilities);
  assert.deepEqual(tris.map((f) => labels.get(f.buildingId)), ['Centre de tri n° 1', 'Centre de tri n° 2']);
  assert.equal(tris.filter((f) => (f.lastAmount ?? 0) > 0).length, 1);
  assert.ok((s.diagnostics ?? []).some((d) => /Centre de tri n° \d inutilisé/.test(d.text)));
});

test('scénario joueur : bâtiment hors d\'atteinte signalé, fréquence trop faible signalée avec le réglage à toucher', () => {
  const { sim, waste } = playerTown({ isolated: true });
  for (let m = 0; m < 9 * 1440; m += 2) sim.tick(2);
  let s = waste.summary(sim.clock.dayIndex, sim.clock.totalMinutes);
  assert.equal(s.unservedProducers, 1);
  const d = (s.diagnostics ?? []).find((x) => x.text.includes('hors d\'atteinte'));
  assert.ok(d?.fix?.includes('dépôt'), JSON.stringify(s.diagnostics));
  // Les seuls débordements viennent du bâtiment isolé (4,8 kg/j, bac de 30 kg).
  assert.ok(s.totals.uncollectedKg > 0 && s.totals.uncollectedKg < 4.8 * 9, `${s.totals.uncollectedKg}`);
  // Fréquence : 2 passages tiennent dans les 4 jours de réserve, 1 ne tient pas.
  assert.equal(recommendedCollectsPerWeek(), 2);
  sim.plugins.command('dechets', 'reglages', { collectsPerWeek: 1 });
  s = waste.summary(sim.clock.dayIndex, sim.clock.totalMinutes);
  assert.ok((s.diagnostics ?? []).some((x) => x.fix === 'Fréquence de collecte : 2 / semaine au moins.'), JSON.stringify(s.diagnostics));
});
