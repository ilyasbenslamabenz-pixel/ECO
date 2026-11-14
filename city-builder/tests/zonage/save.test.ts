/**
 * Module « Zonage » : section de sauvegarde versionnée (`save.plugins.zonage`), migration, anciennes
 * sauvegardes (sans section), sections illisibles ou trop récentes, reprise déterministe après chargement.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../../src/sim/world';
import { SIM_PLUGINS } from '../../src/sim/plugins';
import { emptyZonageSave, migrateZonage, ZONAGE_SAVE_VERSION, zonageSaveSection } from '../../src/sim/save-sections/zonage';
import { validateSave } from '../../src/sim/save-format';
import { createZonagePlugin } from '../../src/sim/plugins/zonage';
import { advanceHours, zoningCatalog, zoningTown } from './fixtures';

type SaveWithPlugins = ReturnType<Simulation['toSave']> & { plugins?: Record<string, { v: number; data: unknown; rng?: number[] }> };

function grownTown(seed = 3): ReturnType<typeof zoningTown> {
  const t = zoningTown({ seed });
  t.sim.buildRoad({ type: 'street', points: [-200, 0, 200, 0] });
  t.sim.buildRoad({ type: 'street', points: [-200, 120, 200, 120] });
  t.cmd('paint', { points: [-190, 0, 190, 0], zone: 'res_faible', depth: 2 });
  t.cmd('paint', { points: [-190, 120, 190, 120], zone: 'industrie', depth: 3 });
  advanceHours(t.sim, 24 * 3);
  return t;
}

/** Charge une sauvegarde dans une simulation neuve (registre : le seul module zonage). */
function loaded(save: unknown): ReturnType<typeof zoningTown> {
  const t = zoningTown();
  const err = t.sim.fromSave(JSON.parse(JSON.stringify(save)));
  assert.equal(err, null, `chargement : ${JSON.stringify(err)}`);
  return t;
}

test('section : vide = vide, version courante, refus des versions futures et des données illisibles', () => {
  assert.equal(ZONAGE_SAVE_VERSION, 1);
  assert.deepEqual(zonageSaveSection.migrate(zonageSaveSection.empty(), 1), emptyZonageSave());
  assert.throws(() => migrateZonage({}, 2), /plus récente/);
  assert.throws(() => migrateZonage('texte', 1), /objet attendu/);
  assert.throws(() => migrateZonage({}, 0), /invalide/);
  assert.throws(() => migrateZonage({ grid: { w: 0, h: 2, rle: [] } }, 1), /grille invalide/);
  assert.throws(() => migrateZonage({ grid: { w: 2, h: 1, rle: [9, 2] } }, 1), /code de zone 9/);
  // Champs abîmés : nettoyés, sans perdre le reste.
  const m = migrateZonage({
    grid: { originX: -10, originZ: -10, cell: 8, w: 2, h: 1, rle: [1, 2] },
    owned: [[5, 1, 1, 60], ['x', 1, 1, 0], [6, 99, 1, 0], [7, 4, 2]],
    demand: { R: 3, C: -0.5, B: 'oui' }, settings: { growth: false }, tuning: { baseR: 0.5, nan: Number.NaN }, counters: { grown: 4 },
  }, 1);
  assert.deepEqual(m.owned, [[5, 1, 1, 60], [7, 4, 2, 0]]);
  assert.deepEqual(m.demand, { R: 1, C: -0.5, B: 0, I: 0 });
  assert.equal(m.settings.growth, false);
  assert.deepEqual(m.tuning, { baseR: 0.5 });
  assert.deepEqual(m.counters, { grown: 4, densified: 0 });
});

test('sauvegarde : aller-retour fidèle (zones, bâtiments du zonage, demande, réglages, compteurs)', () => {
  const t = grownTown();
  t.cmd('tuning', { baseR: 0.5 });
  t.cmd('setGrowth', { enabled: false });
  const save = t.sim.toSave() as SaveWithPlugins;
  assert.equal(validateSave(JSON.parse(JSON.stringify(save))).ok, true);
  const sec = save.plugins?.['zonage'];
  assert.ok(sec && sec.v === ZONAGE_SAVE_VERSION && Array.isArray(sec.rng));
  const u = loaded(save);
  const a = t.sys, b = u.sys;
  assert.deepEqual(Array.from(b.grid.zone), Array.from(a.grid.zone));
  assert.deepEqual([...b.owned], [...a.owned]);
  assert.deepEqual(b.demand, a.demand);
  assert.equal(b.growth, false);
  assert.equal(b.tuning.baseR, 0.5);
  assert.equal(b.grown, a.grown);
  assert.deepEqual(b.stats(u.ctx), a.stats(t.ctx));
  // Desserte recalculée au chargement (non sauvegardée).
  assert.deepEqual(Array.from(b.grid.edge), Array.from(a.grid.edge));
});

test('sauvegarde : la partie reprend à l\'identique après chargement (PRNG du module sauvegardé)', () => {
  const t = grownTown(9);
  const save = JSON.parse(JSON.stringify(t.sim.toSave()));
  advanceHours(t.sim, 48);
  const u = loaded(save);
  advanceHours(u.sim, 48);
  const pos = (z: ReturnType<typeof zoningTown>): unknown => [...z.sys.owned.keys()].sort((x, y) => x - y).map((id) => {
    const i = z.sim.buildings.indexOf(id);
    return [id, z.sim.buildings.assetIndex[i], z.sim.buildings.x[i], z.sim.buildings.z[i]];
  });
  assert.deepEqual(pos(u), pos(t));
});

test('ancienne sauvegarde (avant le zonage) : chargée, module vide et inerte, aucune section réécrite', () => {
  // Partie sauvegardée par une version sans module zonage : registre réduit aux autres modules.
  const old = new Simulation(SIM_PLUGINS.filter((p) => p.id !== 'zonage'));
  old.setCatalog(zoningCatalog());
  old.newGame({ seed: 4, mapChunks: 4, startMoney: 5_000_000, cityName: 'Ancienne', terrain: { hydrology: 'aucune', rivers: 0 } });
  old.buildRoad({ type: 'street', points: [-100, 0, 100, 0] });
  old.placeBuilding({ assetId: 'maison_a', x: 0, z: 15, rot: 2 });
  advanceHours(old, 24);
  const save = JSON.parse(JSON.stringify(old.toSave())) as SaveWithPlugins;
  assert.equal(save.plugins?.['zonage'], undefined);
  const full = new Simulation();
  full.setCatalog(zoningCatalog());
  assert.equal(full.fromSave(save), null);
  assert.equal(full.buildings.count, 1);
  const ctx = full.plugins.contextOf('zonage')!;
  const sys = (full.plugins.plugins.find((p) => p.id === 'zonage') as ReturnType<typeof createZonagePlugin>).systemOf(ctx);
  assert.equal(sys.active, false);
  assert.equal(sys.grid.zonedCount, 0);
  advanceHours(full, 24);
  assert.equal(full.buildings.count, 1, 'aucune croissance sans zone');
  const again = full.toSave() as SaveWithPlugins;
  assert.equal(again.plugins?.['zonage'], undefined, 'pas de section zonage écrite');
  // Sauvegarde au format v1 du jeu (antérieure aux modules) : migrée par le cœur, zonage vide et inerte.
  const v1 = {
    format: 'aube-urbaine-save', version: 1, savedAt: save.savedAt, params: save.params, clock: save.clock,
    economy: { money: 777 }, buildings: save.buildings, roads: save.roads, nextIds: save.nextIds,
  };
  const s2 = new Simulation();
  s2.setCatalog(zoningCatalog());
  assert.equal(s2.fromSave(v1), null);
  assert.equal(s2.buildings.count, 1);
  assert.equal(s2.economy.money, 777);
  advanceHours(s2, 12);
  assert.equal(s2.buildings.count, 1);
  assert.equal((s2.toSave() as SaveWithPlugins).plugins?.['zonage'], undefined);
});

test('section trop récente ou illisible : conservée, notifiée, le reste de la partie est chargé', () => {
  const t = grownTown();
  const save = JSON.parse(JSON.stringify(t.sim.toSave())) as SaveWithPlugins;
  // Version future : conservée telle quelle et réécrite.
  const future = JSON.parse(JSON.stringify(save)) as SaveWithPlugins;
  future.plugins!['zonage']!.v = ZONAGE_SAVE_VERSION + 1;
  const u = zoningTown();
  assert.equal(u.sim.fromSave(future), null);
  assert.equal(u.sim.buildings.count, t.sim.buildings.count);
  assert.equal(u.sys.active, false);
  assert.ok(u.sim.notices.some((n) => /zonage.*plus récente/.test(n.message)));
  assert.deepEqual((u.sim.toSave() as SaveWithPlugins).plugins?.['zonage'], future.plugins!['zonage']);
  // Grille incompatible avec la carte : notification, module remis à neuf, section d'origine conservée.
  const bad = JSON.parse(JSON.stringify(save)) as SaveWithPlugins;
  (bad.plugins!['zonage']!.data as { grid: { w: number; rle: number[] } }).grid.w = 3;
  (bad.plugins!['zonage']!.data as { grid: { w: number; rle: number[] } }).grid.rle = [0, 3 * 128];
  const v = zoningTown();
  assert.equal(v.sim.fromSave(bad), null);
  assert.equal(v.sim.buildings.count, t.sim.buildings.count, 'bâtiments chargés');
  assert.ok(v.sim.notices.some((n) => /zonage.*n'a pas pu être chargée/.test(n.message)), v.sim.notices.map((n) => n.message).join(' | '));
  assert.equal(v.sys.grid.zonedCount, 0);
  assert.deepEqual((v.sim.toSave() as SaveWithPlugins).plugins?.['zonage'], bad.plugins!['zonage']);
});
