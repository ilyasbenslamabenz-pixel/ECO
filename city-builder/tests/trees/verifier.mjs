// Vérifie les GLB générés avec les mêmes critères que tools/assets/validate.ts du projet (lecture seule des
// modules du projet) : lecture gltf-transform, triangles (== catalog-patch, strictement décroissants), boîte
// englobante (== dimensions ±25 %, centrée, base au sol, hauteur plausible), baseColor + normal au LOD0,
// textures décodables par sharp, alphaMode du feuillage.
import { NodeIO, getBounds } from '/home/user/ECO/city-builder/node_modules/@gltf-transform/core/dist/index.js';
import { ALL_EXTENSIONS } from '/home/user/ECO/city-builder/node_modules/@gltf-transform/extensions/dist/index.js';
import sharp from '/home/user/ECO/city-builder/node_modules/sharp/dist/index.mjs';
import { readFileSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = dirname(fileURLToPath(import.meta.url));
const patch = JSON.parse(readFileSync(join(ICI, 'catalog-patch.json'), 'utf8'));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
let errors = 0;
const err = (m) => { errors++; console.log('  ERREUR ' + m); };
for (const a of patch.assets) {
  console.log(a.id);
  const tris = [];
  for (const [i, l] of a.lods.entries()) {
    const p = join(ICI, basename(l.file));
    const doc = await io.read(p);
    const r = doc.getRoot();
    let t = 0;
    for (const m of r.listMeshes()) for (const pr of m.listPrimitives()) t += pr.getIndices().getCount() / 3;
    tris.push(t);
    if (t !== l.triangles) err(`LOD${i} : ${t} ≠ catalogue ${l.triangles}`);
    const b = getBounds(r.getDefaultScene());
    const w = b.max[0] - b.min[0], h = b.max[1] - b.min[1], d = b.max[2] - b.min[2];
    const mats = r.listMaterials().map((m) => `${m.getName()}[${m.getAlphaMode()}${m.getAlphaMode() === 'MASK' ? ' ' + m.getAlphaCutoff() : ''}${m.getDoubleSided() ? ' 2faces' : ''}]`);
    const texs = [];
    for (const tx of r.listTextures()) {
      const meta = await sharp(Buffer.from(tx.getImage())).metadata();
      texs.push(`${meta.format} ${meta.width}x${meta.height}${meta.hasAlpha ? ' α' : ''}`);
    }
    console.log(`  LOD${i} ${String(t).padStart(6)} tri  ${(statSync(p).size / 1024).toFixed(0).padStart(5)} Ko  boîte ${w.toFixed(2)}×${d.toFixed(2)}×${h.toFixed(2)} (y ${b.min[1].toFixed(2)}..${b.max[1].toFixed(2)})  ${mats.join(' ')}  textures : ${texs.join(', ')}`);
    if (i === 0) {
      const within = (m, c) => Math.abs(m - c) <= 0.25 * Math.max(c, 0.05);
      if (!within(w, a.dimensions.width) || !within(d, a.dimensions.depth) || !within(h, a.dimensions.height)) err('boîte ≠ dimensions');
      const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
      if (Math.abs(cx) > 0.1 * w + 0.05 || Math.abs(cz) > 0.1 * d + 0.05) err(`origine décentrée (${cx.toFixed(2)}, ${cz.toFixed(2)})`);
      else console.log(`  centre de la boîte (${cx.toFixed(2)}, ${cz.toFixed(2)}) OK`);
      if (b.min[1] > 0.25 || b.min[1] < -3) err('base hors sol');
      if (h < 1.5 || h > 40 || Math.max(w, d) > 30) err('dimensions non plausibles pour tree');
      if (!r.listMaterials().some((m) => m.getBaseColorTexture() && m.getNormalTexture())) err('pas de baseColor + normal');
      if (t < 200) err('LOD0 < 200 triangles');
    }
  }
  for (let i = 1; i < tris.length; i++) if (!(tris[i] < tris[i - 1])) err(`LOD${i} non décroissant`);
  if (a.license.spdx !== 'CC0-1.0' || !/^tools\/(generators|buildings|vehicles)\//.test(a.license.source)) err('licence/source');
}
console.log(errors ? `\nÉCHEC : ${errors} erreur(s)` : '\nVérification : OK');
