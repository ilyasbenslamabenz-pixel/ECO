/**
 * Mesure CPU de InstancedBuildingRenderer.update() avec 10 000 bâtiments (sans WebGL) :
 *   npx tsx tools/buildings/showcase/perf.ts
 */
import * as THREE from 'three';
import { emptyCatalog } from '../../../src/shared/catalog';
import { InstancedBuildingRenderer, type ModelSource } from '../../../src/render/buildings/renderer';
import type { AssetCatalog } from '../../../src/shared/catalog';
const ids = ['a','b','c','d','e'];
const cat = { ...emptyCatalog(), assets: ids.map((id) => ({ id, nameFr: id, category: 'house', lods: [{file:'x',maxDistance:150},{file:'y',maxDistance:600},{file:'z',maxDistance:1e9}], dimensions:{width:10,depth:10,height:8}, footprint:{tilesX:2,tilesZ:2}, cost:1, upkeepPerMonth:1, capacity:{residents:1,jobs:0}, frontage:[], variants:[{id:'v',nameFr:'v'},{id:'w',nameFr:'w'}], textureSets:[], license:{spdx:'CC0-1.0',source:'t',author:'t'}, tags:[] })) } as unknown as AssetCatalog;
const src = { catalog: cat, url: (f: string) => f, load: async () => { const g = new THREE.Group(); for (const n of ['facade','toiture','verre','menuiserie','volet','dalle','zinc','garde_corps']) g.add(new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3)), new THREE.MeshStandardMaterial({ name: n }))); return g; } };
const r = new InstancedBuildingRenderer(new THREE.Scene(), src as unknown as ModelSource, { castShadow: false });
const recs = [];
for (let i = 0; i < 10000; i++) recs.push({ id: i + 1, assetId: ids[i % 5]!, variant: i % 2, x: (i % 100) * 20, y: 0, z: Math.floor(i / 100) * 20, rot: i & 3 });
r.add(recs);
const cam = new THREE.PerspectiveCamera(50, 16 / 9, 1, 5000); cam.position.set(1000, 300, 2300); cam.lookAt(1000, 0, 1000); cam.updateMatrixWorld();
r.attachCamera(cam); r.preloadAll(); await r.whenReady();
const t: number[] = [];
for (let k = 0; k < 50; k++) { cam.position.x += 3; cam.updateMatrixWorld(); const t0 = performance.now(); r.update(cam.position.x, 300, 2300); t.push(performance.now() - t0); }
t.sort((a, b) => a - b);
console.log(`10 000 bâtiments, 10 lots, update() médiane ${t[25]!.toFixed(2)} ms, max ${t[49]!.toFixed(2)} ms, visibles par LOD ${[...r.visible]}`);
