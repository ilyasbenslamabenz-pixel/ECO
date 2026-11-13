/**
 * Tests du module « circulation » — propriété de la branche p2a-circulation (inclus dans `npm test`).
 * Minimal pour l'instant : le module est enregistré partout et sa section de sauvegarde migre.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIM_PLUGINS } from '../../src/sim/plugins';
import { RENDER_PLUGINS } from '../../src/render/plugins';
import { UI_PANELS } from '../../src/ui/panels/index';
import { CIRCULATION_SAVE_VERSION, emptyCirculationSave, migrateCirculation } from '../../src/sim/save-sections/circulation';

test('circulation : module enregistré (simulation, rendu, interface)', () => {
  assert.ok(SIM_PLUGINS.some((p) => p.id === 'circulation'));
  assert.ok(RENDER_PLUGINS.some((p) => p.id === 'circulation'));
  assert.ok(UI_PANELS.some((p) => p.id === 'circulation'));
});

test('circulation : section de sauvegarde courante relue à l\'identique', () => {
  assert.deepEqual(migrateCirculation(emptyCirculationSave(), CIRCULATION_SAVE_VERSION), emptyCirculationSave());
});
