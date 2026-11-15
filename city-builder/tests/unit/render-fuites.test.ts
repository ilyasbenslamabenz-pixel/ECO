/**
 * Fuites GPU du rendu (sans WebGL) : géométries des aperçus d'outils libérées avant remplacement de leurs
 * attributs, tampons d'instances des bâtiments libérés à l'agrandissement d'un lot, LOD abandonnés libérés ;
 * rayon des cercles d'action des installations électriques = rayon de distribution de la simulation.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildGroundRibbon } from '../../src/input/previews';
import { serviceRadius } from '../../src/input/coverage-rings';
import { FACILITY_SPECS } from '../../src/shared/power/model';
import type { AssetCatalog, CatalogAsset } from '../../src/shared/catalog';
import { emptyCatalog } from '../../src/shared/catalog';
import { InstancedBuildingRenderer, type ModelSource } from '../../src/render/buildings/renderer';

test('aperçus : chaque reconstruction libère les tampons GPU de la géométrie précédente', () => {
  const geo = new THREE.BufferGeometry();
  let disposed = 0;
  geo.addEventListener('dispose', () => { disposed++; });
  const flat = (): number => 0;
  buildGroundRibbon(geo, [0, 0, 10, 0], 2, flat, 0.1);
  assert.equal(disposed, 0, 'géométrie neuve : rien à libérer');
  for (let i = 0; i < 40; i++) buildGroundRibbon(geo, [0, 0, 10 + i, 3], 2, flat, 0.1);
  assert.equal(disposed, 40, 'un dispose() (tampons GPU libérés par three) par remplacement des attributs');
  assert.ok(geo.getAttribute('position').count > 0 && geo.index && geo.index.count > 0, 'géométrie toujours valide');
});

test('cercle d’action des centrales : rayon de distribution réel, pas 800 m', () => {
  assert.equal(serviceRadius({ tags: ['electricite', 'elec:centrale:thermique', 'service:electricite'] }), FACILITY_SPECS.thermique.radius);
  assert.equal(serviceRadius({ tags: ['elec:centrale:eolien', 'service:electricite'] }), FACILITY_SPECS.eolien.radius);
  assert.equal(serviceRadius({ tags: ['elec:poste', 'service:electricite'] }), FACILITY_SPECS.poste.radius);
  assert.equal(serviceRadius({ tags: ['service:ecole', 'rayon:600'] }), 600);
  assert.equal(serviceRadius({ tags: ['service:police'] }), 800);
});

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
class Source implements ModelSource {
  readonly catalog: AssetCatalog = { ...emptyCatalog(), assets: [asset('a')] };
  url(f: string): string { return f; }
  load(): Promise<THREE.Group> {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3)), new THREE.MeshStandardMaterial({ name: 'facade' })));
    return Promise.resolve(g);
  }
}
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const meshes = (scene: THREE.Scene): THREE.InstancedMesh[] => {
  const out: THREE.InstancedMesh[] = [];
  scene.traverse((o) => { if ((o as THREE.InstancedMesh).isInstancedMesh && o.name.includes('_lod')) out.push(o as THREE.InstancedMesh); });
  return out;
};

test('bâtiments : agrandissement d’un lot = anciens tampons d’instances libérés ; LOD abandonnés libérés', async () => {
  const scene = new THREE.Scene();
  const r = new InstancedBuildingRenderer(scene, new Source(), { castShadow: false });
  r.add([{ id: 1, assetId: 'a', variant: 0, x: 0, y: 0, z: 0, rot: 0 }]);
  r.update(0, 10, 0); await tick(); r.update(0, 10, 0);
  const [m0] = meshes(scene);
  assert.ok(m0, 'LOD0 chargé');
  let disposed = 0;
  m0.addEventListener('dispose', () => { disposed++; });
  const oldMatrix = m0.instanceMatrix;
  // 17 bâtiments : capacité 16 -> 32, réallocation des tampons d'instances.
  r.add(Array.from({ length: 16 }, (_, i) => ({ id: 10 + i, assetId: 'a', variant: 0, x: i * 2, y: 0, z: 0, rot: 0 })));
  assert.ok(m0.instanceMatrix !== oldMatrix, 'nouveaux tampons d’instances');
  assert.equal(disposed, 1, 'maillage « disposé » une fois : three supprime l’ancien tampon GPU');
  r.update(0, 10, 0);
  assert.equal(m0.count, 17);

  // Lot vidé : tous ses LOD libérés après le délai (rien avant).
  r.remove([1, ...Array.from({ length: 16 }, (_, i) => 10 + i)]);
  r.update(0, 10, 0);
  const t = performance.now();
  assert.equal(r.releaseUnusedLods(t + 1000), 0, 'pas de libération immédiate (démolition + reconstruction)');
  const geo = meshes(scene)[0]!.geometry;
  let geoDisposed = 0;
  geo.addEventListener('dispose', () => { geoDisposed++; });
  assert.ok(r.releaseUnusedLods(t + 60_000) >= 1, 'LOD du lot vide libérés');
  assert.equal(meshes(scene).length, 0, 'maillages retirés de la scène');
  assert.equal(geoDisposed, 1, 'géométrie propre au lot libérée');

  // Reconstruction : le LOD est rechargé à la demande.
  r.add([{ id: 99, assetId: 'a', variant: 0, x: 0, y: 0, z: 0, rot: 0 }]);
  r.update(0, 10, 0); await tick(); r.update(0, 10, 0);
  assert.equal(meshes(scene).filter((m) => m.visible && m.count === 1).length, 1, 'LOD rechargé et affiché');
});
