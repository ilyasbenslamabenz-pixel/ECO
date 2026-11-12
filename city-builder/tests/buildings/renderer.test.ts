/**
 * Tests du rendu instancié des bâtiments (src/render/buildings) sans WebGL :
 * lots par (asset, variante), LOD par distance avec chargement progressif, culling, suppression,
 * déquantification des GLB du kit, facteur de nuit.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { AssetCatalog, CatalogAsset } from '../../src/shared/catalog';
import { emptyCatalog } from '../../src/shared/catalog';
import { dequantize, InstancedBuildingRenderer, type ModelSource } from '../../src/render/buildings/renderer';
import { nightFactorForHour } from '../../src/render/buildings/materials';

function asset(id: string, variants = 2): CatalogAsset {
  return {
    id, nameFr: id, category: 'house',
    lods: [{ file: `${id}_0.glb`, maxDistance: 100 }, { file: `${id}_1.glb`, maxDistance: 400 }, { file: `${id}_2.glb`, maxDistance: 1e9 }],
    dimensions: { width: 10, depth: 10, height: 8 }, footprint: { tilesX: 2, tilesZ: 2 }, cost: 1, upkeepPerMonth: 1,
    capacity: { residents: 1, jobs: 0 }, frontage: [{ x: 0, z: 5, nx: 0, nz: 1, kind: 'pedestrian' }],
    variants: Array.from({ length: variants }, (_, i) => ({ id: `v${i}`, nameFr: `v${i}`, heightScale: i === 1 ? 1.2 : 1 })),
    textureSets: [], license: { spdx: 'CC0-1.0', source: 'test', author: 'test' }, tags: [],
  };
}

/** Source de modèles factice : deux sous-maillages (matériaux « facade » et « verre ») par LOD. */
class FakeSource implements ModelSource {
  readonly catalog: AssetCatalog;
  readonly calls: string[] = [];
  private resolvers: (() => void)[] = [];
  constructor(ids: string[], private readonly manual = false) {
    this.catalog = { ...emptyCatalog(), assets: ids.map((i) => asset(i)) };
  }
  url(f: string): string { return f; }
  load(assetId: string, lod = 0): Promise<THREE.Group> {
    this.calls.push(`${assetId}:${lod}`);
    const g = new THREE.Group();
    const facade = new THREE.MeshStandardMaterial({ name: 'facade' });
    const verre = new THREE.MeshStandardMaterial({ name: 'verre' });
    g.add(new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3)), facade));
    g.add(new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3)), verre));
    if (!this.manual) return Promise.resolve(g);
    return new Promise((res) => this.resolvers.push(() => res(g)));
  }
  flush(): void { for (const r of this.resolvers.splice(0)) r(); }
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

test('lots par variante, LOD par distance, comptes d’instances', async () => {
  const scene = new THREE.Scene();
  const src = new FakeSource(['a', 'b']);
  const r = new InstancedBuildingRenderer(scene, src, { castShadow: false });
  r.add([
    { id: 1, assetId: 'a', variant: 0, x: 0, y: 0, z: 0, rot: 0 },
    { id: 2, assetId: 'a', variant: 0, x: 300, y: 0, z: 0, rot: 1 },
    { id: 3, assetId: 'a', variant: 1, x: 2000, y: 0, z: 0, rot: 2 },
    { id: 4, assetId: 'b', variant: 0, x: 50, y: 0, z: 0, rot: 3 },
  ]);
  assert.equal(r.count, 4);
  r.update(0, 10, 0); // déclenche les chargements nécessaires
  await r.whenReady();
  r.update(0, 10, 0);
  assert.deepEqual([...r.visible], [2, 1, 1]);
  // un InstancedMesh par (lot, LOD, sous-maillage) ; matrices partagées entre sous-maillages d'un même LOD
  const meshes = r.group.children as THREE.InstancedMesh[];
  const a0 = meshes.filter((m) => m.name.startsWith('a#0_lod0_'));
  assert.equal(a0.length, 2);
  assert.equal(a0[0]!.instanceMatrix, a0[1]!.instanceMatrix);
  assert.equal(a0[0]!.count, 1);
  // la variante 1 applique heightScale = 1.2 sur Y
  const v1 = meshes.find((m) => m.name.startsWith('a#1_lod2_'))!;
  const m = new THREE.Matrix4();
  v1.getMatrixAt(0, m);
  const s = new THREE.Vector3();
  m.decompose(new THREE.Vector3(), new THREE.Quaternion(), s);
  assert.ok(Math.abs(s.y - 1.2) < 1e-6 && Math.abs(s.x - 1) < 1e-6);
  // patine : couleur d'instance uniquement sur les rôles de façade
  const fac = meshes.find((m) => m.name === 'a#0_lod0_facade')!;
  const gl = meshes.find((m) => m.name === 'a#0_lod0_verre')!;
  assert.ok(fac.instanceColor && !gl.instanceColor);
  // suppression
  r.remove([1, 4]);
  r.update(0, 10, 0);
  assert.equal(r.count, 2);
  assert.deepEqual([...r.visible], [0, 1, 1]);
  r.dispose();
});

test('chargement progressif : seuls les LOD utiles sont demandés, repli sur un LOD chargé', async () => {
  const scene = new THREE.Scene();
  const src = new FakeSource(['a'], true);
  const r = new InstancedBuildingRenderer(scene, src, { castShadow: false });
  r.add([{ id: 1, assetId: 'a', variant: 0, x: 0, y: 0, z: 0, rot: 0 }]);
  r.update(1000, 10, 0); // loin : LOD2 seulement
  assert.deepEqual(src.calls, ['a:2']);
  assert.equal(r.loading, 1);
  src.flush();
  await r.whenReady();
  r.update(0, 10, 0); // près : demande le LOD0 et affiche le LOD2 en attendant
  assert.deepEqual(src.calls, ['a:2', 'a:0']);
  assert.deepEqual([...r.visible], [0, 0, 1]);
  src.flush();
  await r.whenReady();
  r.update(0, 10, 0);
  assert.deepEqual([...r.visible], [1, 0, 0]);
  r.dispose();
});

test('culling par instance contre le frustum de la caméra', async () => {
  const scene = new THREE.Scene();
  const src = new FakeSource(['a']);
  const r = new InstancedBuildingRenderer(scene, src, { castShadow: false });
  r.add([
    { id: 1, assetId: 'a', variant: 0, x: 0, y: 0, z: -50, rot: 0 },
    { id: 2, assetId: 'a', variant: 0, x: 0, y: 0, z: 50, rot: 0 }, // derrière la caméra
  ]);
  const cam = new THREE.PerspectiveCamera(60, 1, 0.5, 5000);
  cam.position.set(0, 5, 0);
  cam.lookAt(0, 5, -10);
  cam.updateMatrixWorld();
  r.attachCamera(cam);
  r.preloadAll();
  await r.whenReady();
  r.update(0, 5, 0);
  assert.equal(r.visible[0]! + r.visible[1]! + r.visible[2]!, 1);
  r.dispose();
});

test('update() sans changement de caméra ne réécrit rien', async () => {
  const scene = new THREE.Scene();
  const src = new FakeSource(['a']);
  const r = new InstancedBuildingRenderer(scene, src, { castShadow: false });
  r.add([{ id: 1, assetId: 'a', variant: 0, x: 0, y: 0, z: 0, rot: 0 }]);
  r.preloadAll();
  await r.whenReady();
  r.update(0, 10, 0);
  const mesh = (r.group.children as THREE.InstancedMesh[]).find((m) => m.name === 'a#0_lod0_facade')!;
  const v = mesh.instanceMatrix.version;
  r.update(0, 10, 0);
  assert.equal(mesh.instanceMatrix.version, v);
  r.update(0, 10, 5);
  assert.ok(mesh.instanceMatrix.version > v);
  r.dispose();
  await tick();
});

test('dequantize : positions int16 + transformation de nœud, UV uint16 ramenées en mètres', () => {
  const g = new THREE.BufferGeometry();
  const pos = new THREE.BufferAttribute(new Int16Array([32767, 0, -32767, 0, 32767, 0, -32767, -32767, 0]), 3, true);
  g.setAttribute('position', pos);
  g.setAttribute('normal', new THREE.BufferAttribute(new Int8Array([127, 0, 0, 0, 127, 0, 0, 0, 127]), 3, true));
  g.setAttribute('uv', new THREE.BufferAttribute(new Uint16Array([0, 0, 65535, 65535, 32768, 0]), 2, true));
  const m = new THREE.Matrix4().compose(new THREE.Vector3(1, 2, 3), new THREE.Quaternion(), new THREE.Vector3(10, 10, 10));
  const out = dequantize(g, m, [5, -2, 4, 8]);
  const p = out.getAttribute('position');
  assert.ok(p.array instanceof Float32Array);
  assert.ok(Math.abs(p.getX(0) - 11) < 1e-3 && Math.abs(p.getZ(0) + 7) < 1e-3 && Math.abs(p.getY(1) - 12) < 1e-3);
  const uv = out.getAttribute('uv');
  assert.ok(Math.abs(uv.getX(0) - 5) < 1e-4 && Math.abs(uv.getY(0) + 2) < 1e-4);
  assert.ok(Math.abs(uv.getX(1) - 9) < 1e-4 && Math.abs(uv.getY(1) - 6) < 1e-4);
  const n = out.getAttribute('normal');
  assert.ok(Math.abs(n.getX(0) - 1) < 1e-3 && !n.normalized);
});

test('facteur de nuit selon l’heure', () => {
  assert.equal(nightFactorForHour(12), 0);
  assert.equal(nightFactorForHour(23), 1);
  assert.equal(nightFactorForHour(2), 1);
  assert.ok(nightFactorForHour(19.5) > 0.4 && nightFactorForHour(19.5) < 0.6);
  assert.ok(nightFactorForHour(6) > 0 && nightFactorForHour(6) < 1);
});
