// Vérifie que les GLB portent bien un sous-maillage « plaque » et que la planche a 24 bandes
import { readFileSync } from 'node:fs';
const buf = readFileSync('assets/vehicles/vehicule_berline_lod0.glb');
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
console.log('materiaux', json.materials.map((m: any) => `${m.name}:${m.extras?.aube?.role ?? '?'}${m.extras?.aube?.rows ? '/' + m.extras.aube.rows : ''}`).join(' '));
console.log('primitives', json.meshes[0].primitives.length);
const uvAcc = json.meshes[0].primitives.map((p: any) => p.material);
console.log('materiau par primitive', uvAcc);
