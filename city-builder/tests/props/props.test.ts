/**
 * Mobilier urbain phase 2C (tools/props + sélection Poly Haven P2C) :
 * générateur (LOD décroissants, seuil de triangles, bornes en mètres), catalogue (entrées présentes, catégorie,
 * licence CC0 + source exacte, fichiers, dimensions = boîte mesurée), LICENSES.md, atlas, budget disque.
 * Lancer : npx tsx --test tests/props/*.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';
import { MIN_TRIANGLES_LOD0, type AssetCatalog } from '../../src/shared/catalog';
import { CELLS, cellRect, paletteRect, PALETTE } from '../../tools/props/atlas';
import { boundsOf } from '../../tools/props/glb';
import { PROPS } from '../../tools/props/models';
import { buildLods, P2C_SOURCE_BUDGET } from '../../tools/props/build';
import { P2C_STREET_FURNITURE_PH } from '../../tools/assets/selection';

const root = join(import.meta.dirname, '..', '..');
const assetsDir = join(root, 'assets');
const cat = JSON.parse(readFileSync(join(assetsDir, 'catalog.json'), 'utf8')) as AssetCatalog;
const ids = [...PROPS.map((p) => p.id), ...P2C_STREET_FURNITURE_PH.map((p) => p.id)];

test('au moins 15 nouveaux éléments de mobilier, identifiants uniques', () => {
  assert.ok(ids.length >= 15, `${ids.length} éléments`);
  assert.equal(new Set(ids).size, ids.length);
});

test('générateur : LOD strictement décroissants, LOD0 au-dessus du seuil, tailles plausibles', () => {
  for (const def of PROPS) {
    const lods = buildLods(def);
    const t = lods.map((m) => m.triangles());
    assert.ok(t[0]! >= MIN_TRIANGLES_LOD0.street_furniture, `${def.id} LOD0 ${t[0]}`);
    assert.ok(t[1]! < t[0]! && t[2]! < t[1]!, `${def.id} LOD ${t.join('/')}`);
    const b = boundsOf(lods[0]!);
    const h = b.max[1] - b.min[1], w = Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]);
    assert.ok(h > 0.3 && h < 4, `${def.id} hauteur ${h}`);
    assert.ok(w > 0.1 && w < 7, `${def.id} emprise ${w}`);
    // UV dans l'atlas
    for (const m of lods) for (const p of m.parts.values()) for (const u of p.uv) assert.ok(u >= 0 && u <= 1, `${def.id} UV ${u}`);
  }
});

test('générateur déterministe', () => {
  for (const def of PROPS.slice(0, 5)) {
    const a = buildLods(def)[0]!, b = buildLods(def)[0]!;
    assert.deepEqual([...a.parts.get('atlas')!.pos], [...b.parts.get('atlas')!.pos]);
  }
});

test('atlas : cellules et aplats dans [0, 1], sans chevauchement', () => {
  const rects = Object.keys(CELLS).map((c) => cellRect(c as keyof typeof CELLS));
  for (const r of rects) assert.ok(r[0] >= 0 && r[1] >= 0 && r[2] <= 1 && r[3] <= 1 && r[0] < r[2] && r[1] < r[3]);
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const a = rects[i]!, b = rects[j]!;
    assert.ok(a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1], `cellules ${i} et ${j} se chevauchent`);
  }
  const pal = cellRect('palette', 0);
  for (const p of Object.keys(PALETTE)) {
    const r = paletteRect(p as keyof typeof PALETTE);
    assert.ok(r[0] >= pal[0] && r[2] <= pal[2] && r[1] >= pal[1] && r[3] <= pal[3], p);
  }
});

test('catalogue : entrées street_furniture, licence CC0 et source exacte, fichiers et dimensions mesurées', async () => {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const licenses = readFileSync(join(assetsDir, 'LICENSES.md'), 'utf8');
  for (const id of ids) {
    const a = cat.assets.find((x) => x.id === id);
    assert.ok(a, `${id} absent du catalogue`);
    assert.equal(a.category, 'street_furniture');
    assert.equal(a.license.spdx, 'CC0-1.0');
    assert.ok(a.license.author.length > 0);
    const ph = P2C_STREET_FURNITURE_PH.find((p) => p.id === id);
    assert.equal(a.license.source, ph ? `https://polyhaven.com/a/${ph.ph}` : `tools/props/models.ts#${id}`);
    assert.ok(licenses.includes(`\`${id}\``), `${id} absent de LICENSES.md`);
    assert.equal(a.lods.length, 3);
    for (const l of a.lods) assert.ok(existsSync(join(assetsDir, l.file)), l.file);
    const doc = await io.read(join(assetsDir, a.lods[0]!.file));
    const b = getBounds(doc.getRoot().getDefaultScene()!);
    const dims = [b.max[0] - b.min[0], b.max[2] - b.min[2], b.max[1] - b.min[1]];
    const cat3 = [a.dimensions.width, a.dimensions.depth, a.dimensions.height];
    dims.forEach((d, k) => assert.ok(Math.abs(d - cat3[k]!) <= 0.25 * Math.max(cat3[k]!, 0.05), `${id} dimension ${k} : ${d} ≠ ${cat3[k]}`));
    assert.ok(Math.abs(b.min[1]) < 0.02, `${id} base à y = ${b.min[1]}`);
    assert.ok(Math.abs((b.min[0] + b.max[0]) / 2) < 0.05 && Math.abs((b.min[2] + b.max[2]) / 2) < 0.05, `${id} décentré`);
    const mats = doc.getRoot().listMaterials();
    assert.ok(mats.some((m) => m.getBaseColorTexture() && m.getNormalTexture()), `${id} sans matériau PBR texturé`);
  }
});

test('budget disque du lot (sources) respecté', () => {
  let bytes = 0;
  for (const id of ids) for (const l of cat.assets.find((x) => x.id === id)!.lods) bytes += statSync(join(assetsDir, l.file)).size;
  assert.ok(bytes <= P2C_SOURCE_BUDGET, `${(bytes / 1048576).toFixed(2)} Mo`);
});
