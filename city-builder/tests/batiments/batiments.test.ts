/**
 * Tests du module « batiments » — propriété de la branche p2a-batiments (inclus dans `npm test`).
 * Minimal pour l'instant : le module est enregistré partout et sa section de sauvegarde migre.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIM_PLUGINS } from '../../src/sim/plugins';
import { RENDER_PLUGINS } from '../../src/render/plugins';
import { UI_PANELS } from '../../src/ui/panels/index';
import { BATIMENTS_SAVE_VERSION, emptyBatimentsSave, migrateBatiments } from '../../src/sim/save-sections/batiments';

test('batiments : module enregistré (simulation, rendu, interface)', () => {
  assert.ok(SIM_PLUGINS.some((p) => p.id === 'batiments'));
  assert.ok(RENDER_PLUGINS.some((p) => p.id === 'batiments'));
  assert.ok(UI_PANELS.some((p) => p.id === 'batiments'));
});

test('batiments : section de sauvegarde courante relue à l\'identique', () => {
  assert.deepEqual(migrateBatiments(emptyBatimentsSave(), BATIMENTS_SAVE_VERSION), emptyBatimentsSave());
});
