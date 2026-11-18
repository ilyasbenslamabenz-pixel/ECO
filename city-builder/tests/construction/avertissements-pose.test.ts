/**
 * Avertissements à la pose (src/sim/world.ts, siteWarnings) : affichés dans l'aperçu (dryRun) avant le clic, sans
 * refuser la pose. Station de pompage loin de l'eau (forage), bâtiment polluant près de logements et l'inverse.
 * Lancer : npx tsx --test tests/construction/avertissements-pose.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TILE_SIZE } from '../../src/shared/constants';
import { SURFACE_INTAKE_RADIUS } from '../../src/sim/water-network/model';
import { eauPlugins, newSim, RIVER_MAP, RIVER_SEED } from '../eau/helpers';

const PUMP = 'eau_station_pompage';

test('station de pompage sur une carte sans eau : aperçu accepté, avertissement « forage » chiffré', () => {
  const s = newSim(eauPlugins().plugins);
  let r: ReturnType<typeof s.placeBuilding> | null = null;
  for (const [x, z] of [[0, 0], [200, 200], [-200, 200], [200, -200]] as const) { r = s.placeBuilding({ assetId: PUMP, x, z, rot: 0, dryRun: true }); if (r.ok) break; }
  assert.ok(r?.ok, 'aperçu accepté (avertissement, pas refus)');
  if (r?.ok) {
    assert.match(r.data.warning ?? '', /Loin de l’eau/);
    assert.match(r.data.warning ?? '', /au plus 72 m³\/h au lieu de 160 m³\/h/);
  }
});

test('station de pompage au bord d’une rivière : pas d’avertissement « forage »', () => {
  const s = newSim(eauPlugins().plugins, RIVER_MAP, RIVER_SEED);
  // Une case sèche à moins de SURFACE_INTAKE_RADIUS d'une case en eau.
  let found = false;
  for (let x = -900; x <= 900 && !found; x += 24) {
    for (let z = -900; z <= 900 && !found; z += 24) {
      if (!s.isWet(x, z)) continue;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const d = SURFACE_INTAKE_RADIUS - 2 * TILE_SIZE;
        const r = s.placeBuilding({ assetId: PUMP, x: x + dx * d, z: z + dz * d, rot: 0, dryRun: true });
        if (r.ok) { assert.doesNotMatch(r.data.warning ?? '', /Loin de l’eau/); found = true; break; }
      }
    }
  }
  assert.ok(found, 'emplacement en bord de rivière trouvé');
});

test('pollution : usine près de logements, et logement près d’une usine', () => {
  const s = newSim(eauPlugins().plugins);
  assert.ok(s.buildRoad({ type: 'street', points: [-200, 0, 200, 0] }).ok);
  const house = s.placeBuilding({ assetId: 'maison', x: -100, z: 16, rot: 0 });
  assert.ok(house.ok);
  const u = s.placeBuilding({ assetId: 'usine', x: 60, z: 40, rot: 0, dryRun: true });
  assert.ok(u.ok);
  if (u.ok) assert.match(u.data.warning ?? '', /Pollution : 1 bâtiment d’habitation à moins de 400 m/);
  assert.ok(s.placeBuilding({ assetId: 'usine', x: 60, z: 40, rot: 0 }).ok);
  const h2 = s.placeBuilding({ assetId: 'maison', x: -140, z: 16, rot: 0, dryRun: true });
  assert.ok(h2.ok);
  if (h2.ok) assert.match(h2.data.warning ?? '', /Pollution : bâtiment polluant à \d+ m \(portée 400 m\)/);
});
