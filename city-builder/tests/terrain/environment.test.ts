/**
 * Tests de l'environnement côté rendu (sans WebGL) : position du soleil, rôles et semis de la végétation,
 * suppressions lors des constructions, plantations.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { sunPosition, sunColorForElevation, type SunState } from '../../src/render/sky/sky-system';
import { roleOf, speciesFromCatalog, VegetationSystem } from '../../src/render/nature/vegetation';
import { generateWorld } from '../../src/sim/terrain/index';
import { terrainHeightAt } from '../../src/shared/terrain-gen';
import type { AssetCatalog } from '../../src/shared/catalog';
import type { AssetLibrary } from '../../src/render/assets';

const root = join(import.meta.dirname, '..', '..');
const catalog = JSON.parse(readFileSync(join(root, 'assets', 'catalog.json'), 'utf8')) as AssetCatalog;

test('soleil : levé le matin à l\'est, haut à midi au sud, couché la nuit', () => {
  const s: SunState = { elevation: 0, azimuth: 0, direction: new THREE.Vector3() };
  sunPosition(12, 46, 172, s);
  assert.ok(THREE.MathUtils.radToDeg(s.elevation) > 60 && THREE.MathUtils.radToDeg(s.elevation) < 70);
  assert.ok(s.direction.z > 0, 'midi : soleil au sud (+Z)');
  sunPosition(7, 46, 172, s);
  assert.ok(s.direction.x > 0 && s.elevation > 0, 'matin : est (+X)');
  sunPosition(19, 46, 172, s);
  assert.ok(s.direction.x < 0, 'soir : ouest (-X)');
  sunPosition(0, 46, 172, s);
  assert.ok(s.elevation < 0, 'minuit : sous l\'horizon');
  assert.ok(Math.abs(s.direction.length() - 1) < 1e-9);
  // Couleur : chaude près de l'horizon, presque blanche haut dans le ciel.
  const low = sunColorForElevation(THREE.MathUtils.degToRad(3), new THREE.Color());
  const high = sunColorForElevation(THREE.MathUtils.degToRad(60), new THREE.Color());
  assert.ok(low.b < high.b * 0.6 && low.r >= 0.99);
});

test('végétation : rôles déduits du catalogue (arbres, arbustes, pas de plantes en pot)', () => {
  const sp = speciesFromCatalog(catalog.assets);
  const ids = new Set(sp.map((s) => s.asset.id));
  assert.ok(sp.filter((s) => s.role === 'feuillu' || s.role === 'conifere' || s.role === 'ornement').length >= 4);
  assert.ok(sp.some((s) => s.role === 'arbuste'));
  assert.ok(!ids.has('jardiniere_plante_a'), 'plante en pot exclue du semis naturel');
  for (const s of sp) assert.ok(s.maxH >= s.minH && s.minH > 0);
  const conif = { ...catalog.assets[0]!, id: 'x', category: 'tree' as const, tags: ['arbre', 'conifere'] };
  assert.equal(roleOf(conif), 'conifere');
  assert.equal(roleOf({ ...conif, category: 'prop', tags: ['rocher'] }), 'rocher');
});

function system(): { veg: VegetationSystem; world: ReturnType<typeof generateWorld> } {
  const world = generateWorld({ seed: 7, mapChunks: 6, forest: 0.7 });
  const lib = { catalog } as unknown as AssetLibrary;
  const veg = new VegetationSystem(new THREE.Scene(), lib, { heightAt: (x, z) => terrainHeightAt(world, x, z) });
  veg.setSpecies(speciesFromCatalog(catalog.assets));
  return { veg, world };
}

test('semis : déterministe, forêts là où la densité est forte, jamais dans l\'eau', () => {
  const { veg, world } = system();
  const n = veg.scatter(world);
  assert.ok(n > 1000, `éléments semés ${n}`);
  assert.equal(veg.scatter(world), n, 'même graine => même semis');
  const trees = veg.positionsOf('feuillu');
  let inForest = 0;
  for (const t of trees) {
    const i = Math.round((t.x - world.originX) / world.spacing);
    const j = Math.round((t.z - world.originZ) / world.spacing);
    const k = j * world.samplesX + i;
    assert.ok(!(world.waterSurface[k]! > world.heights[k]! + 0.5), 'arbre dans l\'eau');
    if (world.forest[k]! > 60) inForest++;
  }
  assert.ok(inForest / trees.length > 0.8, `part en forêt ${inForest / trees.length}`);
});

test('construction : suppression par empreinte, le long d\'une route, par rectangle ; plantation', () => {
  const { veg, world } = system();
  veg.scatter(world);
  const all = veg.positionsOf();
  const p = all[Math.floor(all.length / 2)]!;
  const before = veg.count;
  const r1 = veg.removeInFootprint(p.x, p.z, 10, 6, 0.3);
  assert.ok(r1 >= 1);
  assert.equal(veg.count, before - r1);
  for (const q of veg.positionsOf()) {
    const dx = q.x - p.x; const dz = q.z - p.z;
    const lx = dx * Math.cos(0.3) + dz * Math.sin(0.3);
    const lz = -dx * Math.sin(0.3) + dz * Math.cos(0.3);
    assert.ok(!(Math.abs(lx) <= 11.5 && Math.abs(lz) <= 7.5), 'élément resté dans l\'empreinte');
  }
  const q = veg.positionsOf()[0]!;
  const r2 = veg.removeAlongSegment(q.x - 50, q.z, q.x + 50, q.z, 6);
  assert.ok(r2 >= 1);
  for (const o of veg.positionsOf()) assert.ok(!(Math.abs(o.z - q.z) <= 6 && o.x >= q.x - 50 && o.x <= q.x + 50));
  const added = veg.plant([{ x: 0, z: 0, assetId: 'arbre_feuillu_rond' }, { x: 12, z: 0, assetId: 'arbre_feuillu_rond' }, { x: 0, z: 0, assetId: 'inconnu' }]);
  assert.equal(added, 2);
  assert.equal(veg.stats().planted, 2);
  // Les arbres plantés ne sont pas retirés par défaut par un rectangle (ils appartiennent à la ville).
  veg.removeInRect(-1, -1, 13, 1);
  assert.equal(veg.stats().planted, 2);
  veg.removeInRect(-1, -1, 13, 1, true);
  assert.equal(veg.stats().planted, 0);
});
