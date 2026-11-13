/**
 * Tests du module « chantiers » — propriété de la branche p2a-chantiers (inclus dans `npm test`).
 * Minimal pour l'instant : le module est enregistré partout et sa section de sauvegarde migre.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIM_PLUGINS } from '../../src/sim/plugins';
import { RENDER_PLUGINS } from '../../src/render/plugins';
import { UI_PANELS } from '../../src/ui/panels/index';
import { CHANTIERS_SAVE_VERSION, emptyChantiersSave, migrateChantiers } from '../../src/sim/save-sections/chantiers';

test('chantiers : module enregistré (simulation, rendu, interface)', () => {
  assert.ok(SIM_PLUGINS.some((p) => p.id === 'chantiers'));
  assert.ok(RENDER_PLUGINS.some((p) => p.id === 'chantiers'));
  assert.ok(UI_PANELS.some((p) => p.id === 'chantiers'));
});

test('chantiers : section de sauvegarde courante relue à l\'identique', () => {
  assert.deepEqual(migrateChantiers(emptyChantiersSave(), CHANTIERS_SAVE_VERSION), emptyChantiersSave());
});
