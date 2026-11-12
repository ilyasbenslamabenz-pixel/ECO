import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCatalog } from '../../src/shared/catalog';
import { validateCommandMessage, collectTransferables } from '../../src/shared/protocol';
import { generateTerrain, terrainHeightAt } from '../../src/shared/terrain-gen';
import { mulberry32, rotateQuarter } from '../../src/shared/math';
import { testAsset, testCatalog } from '../fixtures/catalog';

test('catalogue de test valide', () => {
  assert.deepEqual(validateCatalog(testCatalog()), []);
});

test('catalogue : détecte id en double, LOD non croissant, licence manquante, textureSet inconnu', () => {
  const c = testCatalog();
  c.assets.push(testAsset('maison_test'));
  c.assets.push(testAsset('lod_bad', { lods: [{ file: 'a.glb', maxDistance: 100 }, { file: 'b.glb', maxDistance: 50 }] }));
  c.assets.push(testAsset('lic_bad', { license: { spdx: '', source: '', author: '' } }));
  c.assets.push(testAsset('tex_bad', { textureSets: ['inexistant'] }));
  const msgs = validateCatalog(c).map((i) => `${i.assetId}:${i.message}`);
  assert.ok(msgs.some((m) => m.startsWith('maison_test:id en double')));
  assert.ok(msgs.some((m) => m.startsWith('lod_bad:LOD1')));
  assert.ok(msgs.some((m) => m.startsWith('lic_bad:licence')));
  assert.ok(msgs.some((m) => m.startsWith('tex_bad:textureSet inconnu')));
});

test('protocole : validation des commandes', () => {
  assert.equal(validateCommandMessage({ kind: 'cmd', reqId: 1, name: 'setSpeed', args: { speed: 2 } }), null);
  assert.equal(validateCommandMessage({ kind: 'cmd', reqId: 1, name: 'setSpeed', args: { speed: 3 } })?.code, 'INVALID_ARGS');
  assert.equal(validateCommandMessage({ kind: 'cmd', reqId: 1, name: 'buildRoad', args: { type: 'street', points: [0, 0, 10] } })?.code, 'INVALID_ARGS');
  assert.equal(validateCommandMessage({ kind: 'cmd', reqId: 1, name: 'buildRoad', args: { type: 'autoroute', points: [0, 0, 10, 0] } })?.code, 'INVALID_ARGS');
  assert.equal(validateCommandMessage({ kind: 'cmd', reqId: 1, name: 'inconnue', args: {} })?.code, 'INVALID_ARGS');
  assert.equal(validateCommandMessage(null)?.code, 'INVALID_ARGS');
});

test('protocole : buffers transférables des véhicules', () => {
  const positions = new Float32Array(8);
  const assetIndices = new Uint16Array(2);
  const t = collectTransferables({ kind: 'delta', tick: 1, buildingsAdded: [], buildingsRemoved: [], roadNodesAdded: [], roadEdgesAdded: [], roadEdgesRemoved: [],
    vehicles: { count: 2, positions, assetIndices }, stats: {} as never });
  assert.equal(t.length, 2);
  assert.equal(t[0], positions.buffer);
});

test('terrain déterministe et interpolation cohérente', () => {
  const a = generateTerrain(42, 2);
  const b = generateTerrain(42, 2);
  assert.deepEqual(a.heights, b.heights);
  const c = generateTerrain(43, 2);
  assert.notDeepEqual(a.heights, c.heights);
  // Aux nœuds de la grille l'interpolation rend la valeur exacte.
  const i = 10, j = 20;
  const h = terrainHeightAt(a, a.originX + i * a.spacing, a.originZ + j * a.spacing);
  assert.ok(Math.abs(h - a.heights[j * a.samplesX + i]!) < 1e-4);
});

test('maths : PRNG reproductible, rotations par quart de tour', () => {
  const r1 = mulberry32(7), r2 = mulberry32(7);
  for (let i = 0; i < 5; i++) assert.equal(r1(), r2());
  assert.deepEqual(rotateQuarter(1, 0, 1), [0, -1]);
  assert.deepEqual(rotateQuarter(1, 0, 4), [1, 0]);
});
