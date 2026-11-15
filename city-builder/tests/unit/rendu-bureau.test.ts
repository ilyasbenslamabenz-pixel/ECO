/**
 * Rendu ordinateur (sans WebGL) : ombres des bâtiments en lots fusionnés, rendu principal en lots par matériau
 * (BatchedMesh), masquage des chantiers, résolution adaptative des écrans Retina / 4K.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { AssetCatalog, CatalogAsset } from '../../src/shared/catalog';
import { emptyCatalog } from '../../src/shared/catalog';
import { InstancedBuildingRenderer, type ModelSource } from '../../src/render/buildings/renderer';
import { mergePositions, mergeableForShadow, SHADOW_PROXY_LAYER, weldPositions } from '../../src/render/buildings/shadow-proxy';
import { desktopAdaptive } from '../../src/ui/options';

function asset(id: string): CatalogAsset {
  return {
    id, nameFr: id, category: 'house',
    lods: [{ file: `${id}_0.glb`, maxDistance: 100 }, { file: `${id}_1.glb`, maxDistance: 400 }, { file: `${id}_2.glb`, maxDistance: 1e9 }],
    dimensions: { width: 10, depth: 10, height: 8 }, footprint: { tilesX: 2, tilesZ: 2 }, cost: 1, upkeepPerMonth: 1,
    capacity: { residents: 1, jobs: 0 }, frontage: [{ x: 0, z: 5, nx: 0, nz: 1, kind: 'pedestrian' }],
    variants: [{ id: 'v0', nameFr: 'v0', heightScale: 1 }],
    textureSets: [], license: { spdx: 'CC0-1.0', source: 'test', author: 'test' }, tags: [],
  };
}
const tri = (): THREE.BufferGeometry => new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
/** Deux sous-maillages par LOD (façade, toiture) et un verre transparent (ombre non fusionnable). */
class Source implements ModelSource {
  readonly catalog: AssetCatalog = { ...emptyCatalog(), assets: [asset('a')] };
  private readonly mats = [new THREE.MeshStandardMaterial({ name: 'facade' }), new THREE.MeshStandardMaterial({ name: 'toiture' }), new THREE.MeshStandardMaterial({ name: 'verre_gc', transparent: true })];
  url(f: string): string { return f; }
  load(): Promise<THREE.Group> {
    const g = new THREE.Group();
    for (const m of this.mats) g.add(new THREE.Mesh(tri(), m));
    return Promise.resolve(g);
  }
}
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const batched = (scene: THREE.Object3D): THREE.BatchedMesh[] => {
  const out: THREE.BatchedMesh[] = [];
  scene.traverse((o) => { if ((o as THREE.BatchedMesh).isBatchedMesh) out.push(o as THREE.BatchedMesh); });
  return out;
};
const visibleInstances = (bm: THREE.BatchedMesh): number => {
  let n = 0;
  for (let i = 0; i < bm.instanceCount; i++) { try { if (bm.getVisibleAt(i)) n++; } catch { /* identifiant libéré */ } }
  return n;
};

test('fusion des géométries d’ombre : positions concaténées, indices recalés, géométrie sans indices indexée', () => {
  const a = tri().setIndex([0, 1, 2]);
  const b = tri();
  const m = mergePositions([a, b])!;
  assert.equal(m.getAttribute('position').count, 3, 'deux fois le même triangle : 3 sommets après soudure');
  assert.deepEqual(Array.from(m.index!.array), [0, 1, 2, 0, 1, 2]);
  assert.equal(mergePositions([]), null);
  // Soudure : deux triangles partageant une arête (coins dupliqués) -> 4 sommets, indices réécrits.
  const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
  const idx = new Uint32Array([0, 1, 2, 3, 4, 5]);
  const w = weldPositions(pos, idx);
  assert.equal(w.length, 12);
  assert.deepEqual(Array.from(idx), [0, 1, 2, 1, 3, 2]);
  for (let k = 0; k < 6; k++) for (let c = 0; c < 3; c++) assert.equal(w[idx[k]! * 3 + c], pos[k * 3 + c]);
  assert.equal(mergeableForShadow(new THREE.MeshStandardMaterial()), true);
  assert.equal(mergeableForShadow(new THREE.MeshStandardMaterial({ transparent: true })), false);
  assert.equal(mergeableForShadow(new THREE.MeshStandardMaterial({ alphaTest: 0.5 })), false);
});

test('ordinateur : ombres fusionnées et lots par matériau suivent ajout, LOD, masquage et suppression', async () => {
  const scene = new THREE.Scene();
  const r = new InstancedBuildingRenderer(scene, new Source(), { shadowProxies: true, batchByMaterial: true });
  r.add([{ id: 1, assetId: 'a', variant: 0, x: 0, y: 0, z: 0, rot: 0 }, { id: 2, assetId: 'a', variant: 0, x: 50, y: 0, z: 0, rot: 1 }]);
  r.update(0, 10, 0); await tick(); r.update(0, 10, 0);
  // Pas d'InstancedMesh de bâtiment : 3 lots (façade, toiture, verre) pour le LOD0 + 1 lot d'ombre (côté avant).
  let inst = 0; scene.traverse((o) => { if ((o as THREE.InstancedMesh).isInstancedMesh && o.name.includes('_lod')) inst++; });
  assert.equal(inst, 0);
  const shadow = batched(scene).filter((b) => b.layers.mask === 1 << SHADOW_PROXY_LAYER);
  const main = batched(scene).filter((b) => b.layers.mask === 1);
  assert.equal(shadow.length, 1, 'un lot d’ombre (sous-maillages opaques fusionnés)');
  assert.equal(main.length, 3, 'un lot par matériau');
  assert.ok(main.every((b) => !b.castShadow || (b.material as THREE.Material).transparent === false), 'ombres opaques portées par le lot d’ombre');
  assert.equal(main.filter((b) => b.castShadow).length, 0, 'aucun lot principal ne projette d’ombre (verre transparent : pas d’ombre)');
  assert.deepEqual(r.batchStats(), { meshes: 3, instances: 6 });
  assert.equal(visibleInstances(shadow[0]!), 2);

  // Chantier : le bâtiment 2 disparaît (instances et ombre), puis revient.
  r.setBuildingsVisible([2], false); r.update(0, 10, 0);
  assert.equal(visibleInstances(shadow[0]!), 1);
  assert.ok(main.every((b) => visibleInstances(b) === 1));
  r.setBuildingsVisible([2], true); r.update(0, 10, 0);
  assert.ok(main.every((b) => visibleInstances(b) === 2));

  // Caméra lointaine : LOD2 (pas d'ombre aux LOD ≥ 2), instances recréées dans les lots du LOD2.
  r.update(5000, 10, 0); await tick(); r.update(5000, 10, 0); await tick(); r.update(5000, 10, 0);
  assert.equal(visibleInstances(shadow[0]!), 0, 'LOD2 : pas d’ombre');
  assert.deepEqual(r.visible.slice(), new Int32Array([0, 0, 2]));
  assert.equal(r.batchStats()!.instances, 6, 'instances du LOD0 supprimées, celles du LOD2 créées');

  r.remove([1]); r.update(5000, 10, 0);
  assert.equal(r.batchStats()!.instances, 3);
  r.dispose();
  assert.equal(batched(scene).length, 0);
});

test('rendu instancié (téléphone) inchangé : masquage par l’API, ombres par sous-maillage', async () => {
  const scene = new THREE.Scene();
  const r = new InstancedBuildingRenderer(scene, new Source());
  r.add([{ id: 1, assetId: 'a', variant: 0, x: 0, y: 0, z: 0, rot: 0 }, { id: 2, assetId: 'a', variant: 0, x: 50, y: 0, z: 0, rot: 1 }]);
  r.update(0, 10, 0); await tick(); r.update(0, 10, 0);
  assert.equal(batched(scene).length, 0);
  const meshes: THREE.InstancedMesh[] = [];
  scene.traverse((o) => { if ((o as THREE.InstancedMesh).isInstancedMesh && o.name.includes('_lod0')) meshes.push(o as THREE.InstancedMesh); });
  assert.equal(meshes.length, 3);
  assert.equal(meshes.filter((m) => m.castShadow).length, 2, 'façade et toiture projettent leur ombre, pas le verre');
  r.setBuildingsVisible([1], false); r.update(0, 10, 0);
  assert.ok(meshes.every((m) => m.count === 1));
});

test('résolution adaptative de l’ordinateur : Retina 1 → 2, 4K à 100 % jusqu’à 0,75, écran ordinaire fixe', () => {
  assert.deepEqual(desktopAdaptive(2, 1440 * 900), { min: 1, max: 2 });
  assert.deepEqual(desktopAdaptive(3, 1440 * 900), { min: 1, max: 2 });
  assert.deepEqual(desktopAdaptive(1.25, 1536 * 864), { min: 1, max: 1.25 });
  assert.equal(desktopAdaptive(1, 1920 * 1080), null);
  assert.deepEqual(desktopAdaptive(1, 3840 * 2160), { min: 0.75, max: 1 });
});
