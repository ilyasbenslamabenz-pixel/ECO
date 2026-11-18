/**
 * Chargement différé du LOD0 de la végétation (src/render/nature/vegetation.ts, `load` puis `loadDetail`) :
 * au démarrage, seuls les LOD réduits sont demandés (la case LOD0 montre le LOD1) ; `loadDetail` charge ensuite le
 * LOD0 et l'échange sur les mêmes tampons d'instances.
 * Lancer : npx tsx --test tests/terrain/vegetation-detail.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { speciesFromCatalog, VegetationSystem } from '../../src/render/nature/vegetation';
import type { AssetCatalog } from '../../src/shared/catalog';
import type { AssetLibrary } from '../../src/render/assets';

const catalog = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'assets', 'catalog.json'), 'utf8')) as AssetCatalog;

test('végétation : LOD0 chargé après coup, échangé sur les mêmes tampons d’instances', async () => {
  const asked: string[] = [];
  const lib = {
    catalog,
    load: async (id: string, lod: number): Promise<THREE.Object3D> => {
      asked.push(`${id}#${lod}`);
      const g = new THREE.BoxGeometry(1, 1 + lod, 1); // hauteur = 1 + LOD : reconnaissable après copie
      return new THREE.Mesh(g, new THREE.MeshStandardMaterial());
    },
  } as unknown as AssetLibrary;
  const scene = new THREE.Scene();
  const veg = new VegetationSystem(scene, lib, { heightAt: () => 0 });
  // Sans moteur de rendu (pas d'imposteur) : règles de LOD du catalogue.
  const species = speciesFromCatalog(catalog.assets).filter((s) => s.asset.lods.length >= 2).slice(0, 3);
  assert.ok(species.length > 0);
  await veg.load(species);
  const id = species[0]!.asset.id;
  assert.ok(!asked.includes(`${id}#0`), 'LOD0 non demandé au démarrage');
  assert.ok(asked.includes(`${id}#1`));
  const h = (g: THREE.BufferGeometry): number => { g.computeBoundingBox(); return Math.round(g.boundingBox!.max.y - g.boundingBox!.min.y); };
  const lod0Mesh = (): THREE.InstancedMesh => scene.getObjectByName(`veg_${id}_lod0`) as THREE.InstancedMesh;
  const before = lod0Mesh();
  assert.equal(h(before.geometry), 2, 'case LOD0 provisoirement remplie par le LOD1');
  const matrices = before.instanceMatrix;
  await veg.loadDetail();
  assert.ok(asked.includes(`${id}#0`), 'LOD0 chargé par loadDetail');
  const after = lod0Mesh();
  assert.equal(h(after.geometry), 1, 'LOD0 en place');
  assert.equal(after.instanceMatrix, matrices, 'mêmes tampons d’instances');
  assert.equal(before.parent, null, 'maillage provisoire retiré de la scène');
  // Le LOD1 garde son maillage.
  assert.equal(h((scene.getObjectByName(`veg_${id}_lod1`) as THREE.InstancedMesh).geometry), 2);
});
