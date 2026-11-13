/**
 * Tests du module « pietons » — propriété de la branche p2a-pietons (inclus dans `npm test`).
 * Minimal pour l'instant : le module est enregistré partout et sa section de sauvegarde migre.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIM_PLUGINS } from '../../src/sim/plugins';
import { RENDER_PLUGINS } from '../../src/render/plugins';
import { UI_PANELS } from '../../src/ui/panels/index';
import { PIETONS_SAVE_VERSION, emptyPietonsSave, migratePietons } from '../../src/sim/save-sections/pietons';

test('pietons : module enregistré (simulation, rendu, interface)', () => {
  assert.ok(SIM_PLUGINS.some((p) => p.id === 'pietons'));
  assert.ok(RENDER_PLUGINS.some((p) => p.id === 'pietons'));
  assert.ok(UI_PANELS.some((p) => p.id === 'pietons'));
});

test('pietons : section de sauvegarde courante relue à l\'identique', () => {
  assert.deepEqual(migratePietons(emptyPietonsSave(), PIETONS_SAVE_VERSION), emptyPietonsSave());
});
