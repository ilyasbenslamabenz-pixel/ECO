/**
 * Auto-test de la porte de validation visuelle (npm run e2e:gate).
 * Construit une copie de dist/ avec un catalogue de test contenant :
 *  - « faux_cube » : un cube texturé (placeholder) -> DOIT être rejeté ;
 *  - « faux_sans_texture » : maillage détaillé sans texture -> DOIT être rejeté ;
 *  - « vrai_detaille » : maillage détaillé (> seuil), albedo + normal -> DOIT être accepté.
 * Prouve que la porte détecte réellement les placeholders et les textures manquantes.
 */
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import sharp from 'sharp';
import { dist, launch, root, serve } from './lib.mjs';

const work = join(root, 'tests/e2e/out/gate-dist');
rmSync(work, { recursive: true, force: true });
cpSync(dist, work, { recursive: true });
mkdirSync(join(work, 'assets/models/test'), { recursive: true });

async function png(w, h, fn) {
  const px = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b] = fn(x, y); const k = (y * w + x) * 3; px[k] = r; px[k + 1] = g; px[k + 2] = b; }
  return new Uint8Array(await sharp(px, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer());
}

/** Géométrie : tour à 16 côtés, 20 étages, avec UV — ou cube à 8 sommets. */
function geometry(kind) {
  if (kind === 'cube') {
    const p = [-5, 0, -5, 5, 0, -5, 5, 10, -5, -5, 10, -5, -5, 0, 5, 5, 0, 5, 5, 10, 5, -5, 10, 5];
    const uv = [0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1];
    const i = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5];
    return { p, uv, i };
  }
  const sides = 16, rings = 21, r = 5, h = 30;
  const p = [], uv = [], i = [];
  for (let y = 0; y < rings; y++) for (let s = 0; s <= sides; s++) {
    const a = (s / sides) * Math.PI * 2;
    const rr = r * (1 - 0.15 * (y / (rings - 1))) + (y % 2 ? 0.25 : 0);
    p.push(Math.cos(a) * rr, (y / (rings - 1)) * h, Math.sin(a) * rr);
    uv.push(s / sides, y / (rings - 1));
  }
  for (let y = 0; y < rings - 1; y++) for (let s = 0; s < sides; s++) {
    const a = y * (sides + 1) + s, b = a + sides + 1;
    i.push(a, b, a + 1, a + 1, b, b + 1);
  }
  return { p, uv, i };
}

async function makeGlb(file, kind, textured) {
  const doc = new Document();
  const buf = doc.createBuffer();
  const g = geometry(kind);
  const mat = doc.createMaterial('facade').setRoughnessFactor(0.8);
  if (textured) {
    const albedo = await png(64, 64, (x, y) => ((x >> 3) + (y >> 3)) % 2 ? [180, 160, 140] : [120, 90, 70]);
    const normal = await png(64, 64, () => [128, 128, 255]);
    mat.setBaseColorTexture(doc.createTexture('albedo').setImage(albedo).setMimeType('image/png'));
    mat.setNormalTexture(doc.createTexture('normal').setImage(normal).setMimeType('image/png'));
  }
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(g.p)).setBuffer(buf))
    .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(g.uv)).setBuffer(buf))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(g.i)).setBuffer(buf))
    .setMaterial(mat);
  const mesh = doc.createMesh('m').addPrimitive(prim);
  doc.createScene('s').addChild(doc.createNode('n').setMesh(mesh));
  writeFileSync(join(work, 'assets', file), await new NodeIO().writeBinary(doc));
}

await makeGlb('models/test/cube.glb', 'cube', true);
await makeGlb('models/test/tour_nue.glb', 'tower', false);
await makeGlb('models/test/tour.glb', 'tower', true);
const lic = { spdx: 'CC0-1.0', source: 'tests/e2e/gate-selftest.mjs', author: 'tests' };
const base = { category: 'apartment_high', footprint: { tilesX: 2, tilesZ: 2 }, cost: 1, upkeepPerMonth: 0, capacity: { residents: 0, jobs: 0 },
  frontage: [{ x: 0, z: 5, nx: 0, nz: 1, kind: 'pedestrian' }], variants: [], textureSets: [], license: lic, tags: [] };
const catalog = { schemaVersion: 1, generatedAt: new Date().toISOString(), textureSets: [], hdris: [], assets: [
  { ...base, id: 'faux_cube', nameFr: 'Cube (placeholder)', lods: [{ file: 'models/test/cube.glb', maxDistance: 1e9 }], dimensions: { width: 10, depth: 10, height: 10 } },
  { ...base, id: 'faux_sans_texture', nameFr: 'Tour sans texture', lods: [{ file: 'models/test/tour_nue.glb', maxDistance: 1e9 }], dimensions: { width: 10.5, depth: 10.5, height: 30 } },
  { ...base, id: 'vrai_detaille', nameFr: 'Tour détaillée', lods: [{ file: 'models/test/tour.glb', maxDistance: 1e9 }], dimensions: { width: 10.5, depth: 10.5, height: 30 } },
] };
writeFileSync(join(work, 'assets/catalog.json'), JSON.stringify(catalog));

const { server, base: url } = await serve(work);
const browser = await launch();
let failed = false;
try {
  const page = await browser.newPage();
  await page.goto(`${url}/index.html?validate`);
  await page.waitForFunction(() => window.__aube?.ready === true, null, { timeout: 60000 });
  const res = await page.evaluate(() => window.__aube.validate());
  writeFileSync(join(root, 'tests/e2e/out/gate-selftest.png'), Buffer.from(res.contactSheet.split(',')[1], 'base64'));
  const by = Object.fromEntries(res.reports.map((r) => [r.id, r]));
  const expect = (cond, msg, r) => { console.log(`${cond ? 'OK  ' : 'ÉCHEC'} ${msg}${r ? ` — ${r.errors.join(' ; ') || 'aucune erreur'}` : ''}`); if (!cond) failed = true; };
  expect(by.faux_cube && !by.faux_cube.ok && by.faux_cube.errors.some((e) => e.includes('boîte')), 'le cube placeholder est rejeté', by.faux_cube);
  expect(by.faux_sans_texture && !by.faux_sans_texture.ok && by.faux_sans_texture.errors.some((e) => e.includes('texture')), 'le modèle sans texture est rejeté', by.faux_sans_texture);
  expect(by.vrai_detaille?.ok === true, 'le modèle détaillé texturé est accepté', by.vrai_detaille);
  expect((by.vrai_detaille?.pixelCoverage ?? 0) > 0.02, `vignette visible (couverture ${((by.vrai_detaille?.pixelCoverage ?? 0) * 100).toFixed(1)} %)`);
} finally {
  await browser.close();
  server.close();
}
console.log(failed ? '\nAUTO-TEST PORTE : ÉCHEC' : '\nAUTO-TEST PORTE : SUCCÈS');
process.exit(failed ? 1 : 0);
