/**
 * Construction autonome des bâtiments procéduraux :
 *   npx tsx tools/buildings/procedural/build.ts [--merge]
 *   ONLY=id1,id2 npx tsx tools/buildings/procedural/build.ts
 * Écrit les GLB (assets/buildings/procedural/) et assets/catalog.buildings.procedural.json.
 * `--merge` (ou MERGE=1) fusionne aussi les entrées dans assets/catalog.json : à utiliser tant que le
 * générateur n'est pas enregistré dans tools/generators/index.ts (voir docs/requests/batiments.md).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AssetCatalog } from '../../../src/shared/catalog';
import { generateProcedural } from './index';

const assetsDir = join(import.meta.dirname, '..', '..', '..', 'assets');
const only = process.env['ONLY'] ? new Set(process.env['ONLY'].split(',')) : undefined;
const merge = process.argv.includes('--merge') || process.env['MERGE'] === '1';
const t0 = Date.now();

generateProcedural({ assetsDir }, only).then((r) => {
  const tri = r.assets.reduce((s, a) => s + (a.lods[0]?.triangles ?? 0), 0);
  console.log(`${r.assets.length} bâtiments procéduraux, ${tri} triangles au LOD0 (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  if (merge) {
    const p = join(assetsDir, 'catalog.json');
    const cat = JSON.parse(readFileSync(p, 'utf8')) as AssetCatalog;
    for (const a of r.assets) {
      const i = cat.assets.findIndex((x) => x.id === a.id);
      if (i >= 0) cat.assets[i] = a; else cat.assets.push(a);
    }
    for (const t of r.textureSets) if (!cat.textureSets.some((x) => x.id === t.id)) cat.textureSets.push(t);
    writeFileSync(p, `${JSON.stringify(cat, null, 2)}\n`);
    console.log(`catalog.json : ${cat.assets.length} entrées après fusion.`);
  }
}).catch((e: unknown) => { console.error(e); process.exit(1); });
