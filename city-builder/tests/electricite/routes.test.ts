/**
 * Réseau électrique intégré aux routes (16/11, retour joueur « raccordements compliqués ») : routes alimentées /
 * non alimentées (calque), centrale isolée signalée (« Reliez la centrale à une route »), parc éolien d'un seul
 * tenant, distribution non bloquante, espacement minimal des éoliennes, sauvegardes avec lignes HT manuelles.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../../src/sim/world';
import { createElectricitePlugin } from '../../src/sim/plugins/electricite';
import { WIND_MIN_SPACING_M } from '../../src/shared/power/render-spec';
import type { ElectriciteDelta } from '../../src/shared/power/types';
import { buildStreet, buildTown } from '../sim/fixtures';
import { advanceHours, advanceToHour, placeFacilities, powerCatalog, powerTown } from './fixtures';

const full = (sim: Simulation): ElectriciteDelta => (sim.plugins.command('electricite', 'state', undefined) as { data: { data: ElectriciteDelta } }).data.data;

/** Pose libre (hors rue) : premier emplacement accepté parmi des candidats. */
function placeAt(sim: Simulation, assetId: string, spots: readonly (readonly [number, number])[]): { id: number; x: number; z: number } {
  for (const [x, z] of spots) {
    const r = sim.placeBuilding({ assetId, x, z, rot: 0 });
    if (r.ok) return { id: r.data.buildingId, x, z };
  }
  throw new Error(`${assetId} : aucun emplacement libre`);
}

test('routes : une centrale au bord d’une route alimente tout le réseau routier connecté, sans ligne ; calque des routes alimentées', () => {
  const { sim, elec } = powerTown({ days: 1 });
  placeFacilities(sim, 160, -100, 100, ['centrale_gaz']);
  // Rue séparée (non reliée) : ses tronçons restent « non alimentés ».
  buildStreet(sim, 260, 120, 260, ['maison', 'maison']);
  advanceHours(sim, 2);
  const s = elec.system.summary()!;
  assert.equal(elec.system.state.lines.length, 0, 'aucune ligne posée');
  assert.equal(s.cut, 0);
  assert.ok(s.powered > 10, `bâtiments alimentés par la route : ${s.powered}`);
  assert.ok((s.roadsPowered ?? 0) > 0 && (s.roadsUnpowered ?? 0) >= 1, `routes : ${s.roadsPowered} alimentées / ${s.roadsUnpowered} non`);
  const roads = full(sim).roads!;
  assert.ok(roads, 'tracé des routes dans l’instantané');
  assert.equal(roads.ids.length, roads.powered.length);
  assert.equal(roads.offsets.length, roads.ids.length + 1);
  assert.equal(roads.points.length, 2 * roads.offsets[roads.ids.length]!);
  const seg = sim.net.segmentNear(190, 260, 5)!;
  assert.equal(elec.system.roadPowered(seg.segId), false, 'rue séparée non alimentée');
  const town = sim.net.segmentNear(0, 0, 5)!;
  assert.equal(elec.system.roadPowered(town.segId), true, 'rue du bourg alimentée');
  // Reliée par la route : elle passe au vert, sans rien poser d'autre.
  assert.ok(sim.buildRoad({ type: 'street', points: [100, 160, 120, 260] }).ok);
  advanceHours(sim, 1);
  assert.equal(elec.system.roadPowered(sim.net.segmentNear(190, 260, 5)!.segId), true);
});

test('routes : centrale isolée -> « Reliez la centrale à une route » (une fois), puis reliée par une route -> plus isolée', () => {
  const { sim, elec } = powerTown({ days: 1 });
  const plant = placeAt(sim, 'petite_centrale', [[-420, 380], [420, 380], [-420, -380], [420, -380], [0, 420]]);
  advanceHours(sim, 2);
  const v = full(sim).facilities!.find((f) => f.id === plant.id)!;
  assert.equal(v.isolated, true);
  assert.equal(v.roadLinked, false);
  assert.equal(elec.system.summary()!.isolatedFacilities, 1);
  const msgs = (): number => sim.notices.filter((n) => n.message.includes('reliez la centrale à une route')).length;
  assert.equal(msgs(), 1, 'notification claire');
  advanceHours(sim, 3);
  assert.equal(msgs(), 1, 'pas de répétition');
  // Route jusqu'à la centrale (raccordée au bourg) : plus isolée, ses bâtiments alimentés.
  const r = sim.buildRoad({ type: 'street', points: [plant.x > 0 ? 220 : -220, plant.z > 0 ? 80 : 0, plant.x, plant.z + (plant.z > 0 ? -30 : 30)] });
  assert.ok(r.ok, !r.ok ? r.error.message : '');
  advanceHours(sim, 2);
  const v2 = full(sim).facilities!.find((f) => f.id === plant.id)!;
  assert.equal(v2.isolated, undefined);
  assert.equal(v2.roadLinked, true);
  assert.equal(elec.system.summary()!.isolatedFacilities, undefined);
  assert.equal(elec.system.summary()!.unlinked, 0, 'tout le bourg raccordé par la route');
});

test('routes : parc éolien hors route — une seule éolienne près d’une route suffit (voisines reliées automatiquement)', () => {
  const { sim, elec } = powerTown({ days: 1 });
  // Rue d'accès, puis deux éoliennes au-delà, à plus de 80 m de toute route (espacement ≈ 100 m).
  const [near] = placeFacilities(sim, 230, -100, 100, ['eolienne']);
  const i = sim.buildings.indexOf(near!);
  const x0 = sim.buildings.x[i]!, z0 = sim.buildings.z[i]!;
  const far1 = placeAt(sim, 'eolienne', [[x0 - 100, z0], [x0 - 100, z0 - 10], [x0 - 105, z0 + 10]]);
  const far2 = placeAt(sim, 'eolienne', [[far1.x - 100, far1.z], [far1.x - 100, far1.z - 10], [far1.x - 105, far1.z + 10]]);
  for (const f of [far1, far2]) assert.equal(sim.net.segmentNear(f.x, f.z, 80), null, 'à l’écart des routes');
  sim.plugins.command('electricite', 'forceWind', { ms: 13 });
  advanceHours(sim, 2);
  const views = full(sim).facilities!;
  for (const f of views) assert.notEqual(f.isolated, true, `éolienne n° ${f.id} isolée`);
  assert.equal(elec.system.state.lines.length, 0);
  const s = elec.system.summary()!;
  const eol = s.bySource.find((b) => b.source === 'eolien')!;
  assert.ok(eol.availableKw >= 1800 - 1e-6, `trois éoliennes disponibles : ${eol.availableKw} kW`);
  assert.ok(eol.outputKw > 0 && s.cut === 0 && s.unlinked === 0, 'la ville est alimentée par le parc');
  for (const f of views) assert.equal(f.energized, true, `éolienne n° ${f.id} reliée au réseau`);
});

test('routes : distribution non bloquante — un petit poste proche des maisons ne plafonne plus leur alimentation', () => {
  // Poste de 20 kW au sud du bourg, plus proche de la rue z = 0 que la centrale : avant le 16/11, les bâtiments
  // rattachés au poste étaient plafonnés par son transformateur (20 kW) et coupés malgré une centrale de 60 MW.
  const cat = powerCatalog();
  const base = cat.assets.find((a) => a.id === 'poste')!;
  cat.assets.push({ ...base, id: 'mini_poste', tags: [...base.tags.filter((t) => !t.startsWith('elec:kw:')), 'elec:kw:20'] });
  const elec = createElectricitePlugin();
  const sim = new Simulation([elec]);
  sim.setCatalog(cat);
  sim.newGame({ seed: 1234, mapChunks: 4, startMoney: 80_000_000, cityName: 'Bourg-Volt', terrain: { hydrology: 'aucune', rivers: 0 } });
  buildTown(sim);
  assert.ok(sim.buildRoad({ type: 'street', points: [-220, 0, -220, 80] }).ok);
  advanceHours(sim, 48);
  placeFacilities(sim, 160, -100, 100, ['centrale_gaz']);
  placeFacilities(sim, -120, -220, 100, ['mini_poste'], false);
  const link = sim.buildRoad({ type: 'street', points: [-220, -120, -220, 0] });
  assert.ok(link.ok, !link.ok ? link.error.message : '');
  advanceToHour(sim, 19);
  advanceHours(sim, 1);
  const s = elec.system.summary()!;
  assert.ok(s.demandKw > 20, `demande ${s.demandKw} kW > transformateur du poste`);
  assert.equal(s.cut, 0, 'aucune coupure : la route distribue tout le courant');
  assert.ok(s.shortfallKw < 1e-6);
});

test('éoliennes : espacement minimal à la pose (rotors sans chevauchement) — refus et aperçu (dryRun) rouges', () => {
  const { sim } = powerTown();
  const [a] = placeFacilities(sim, 160, -100, 100, ['eolienne']);
  const i = sim.buildings.indexOf(a!);
  const x = sim.buildings.x[i]!, z = sim.buildings.z[i]!;
  const close = sim.placeBuilding({ assetId: 'eolienne', x: x + 40, z, rot: 0, dryRun: true });
  assert.equal(close.ok, false);
  assert.ok(!close.ok && close.error.code === 'COLLISION' && /rotors/.test(close.error.message), !close.ok ? close.error.message : '');
  assert.equal(sim.placeBuilding({ assetId: 'eolienne', x: x + 40, z, rot: 0 }).ok, false, 'pose refusée');
  const ok = sim.placeBuilding({ assetId: 'eolienne', x: x + WIND_MIN_SPACING_M + 1, z, rot: 0 });
  assert.ok(ok.ok, !ok.ok ? ok.error.message : '');
  // Les autres installations ne sont pas concernées.
  const p = sim.placeBuilding({ assetId: 'poste', x: x + 24, z: z - 4, rot: 0 });
  assert.ok(p.ok, !p.ok ? p.error.message : '');
  assert.ok(WIND_MIN_SPACING_M >= 2 * 37, 'au moins un diamètre de rotor');
});

test('sauvegarde : une ancienne partie avec ligne HT manuelle se recharge, réseau manuel et réseau routier fusionnés', () => {
  const { sim, elec } = powerTown({ days: 1 });
  placeFacilities(sim, 160, -100, 100, ['centrale_gaz']);
  // Hameau séparé (aucune route commune) avec son poste, relié par une ligne HT manuelle.
  const far = buildStreet(sim, -250, 200, 480, ['maison', 'maison', 'poste', 'maison']);
  const poste = far[2]!;
  sim.plugins.command('electricite', 'refresh', undefined);
  const plant = elec.system.facilityList().find((f) => f.kind === 'thermique')!.id;
  const line = sim.plugins.command('electricite', 'buildLine', { a: plant, b: poste });
  assert.ok(line.ok);
  advanceHours(sim, 2);
  for (const id of [far[0]!, far[1]!, far[3]!]) assert.equal(elec.system.powerFactor(id), 1, 'hameau alimenté par la ligne');
  const save = JSON.parse(JSON.stringify(sim.toSave())) as ReturnType<Simulation['toSave']>;
  const data = save.plugins!.electricite!.data as { power: Record<string, unknown> };
  delete data.power.isolatedNotified; // format d'avant le réseau intégré aux routes
  const e2 = createElectricitePlugin();
  const t = new Simulation([e2]);
  t.setCatalog(powerCatalog());
  assert.equal(t.fromSave(save), null);
  advanceHours(t, 1);
  advanceHours(sim, 1);
  assert.equal(e2.system.state.lines.length, 1, 'ligne manuelle conservée');
  for (const id of [far[0]!, far[1]!, far[3]!]) assert.equal(e2.system.powerFactor(id), 1);
  assert.deepEqual(e2.system.summary(), elec.system.summary());
});
