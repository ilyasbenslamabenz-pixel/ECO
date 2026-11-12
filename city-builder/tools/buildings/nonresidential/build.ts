/**
 * Construction autonome des bâtiments non résidentiels :
 *   npx tsx tools/buildings/nonresidential/build.ts            (tous)
 *   ONLY=id1,id2 npx tsx tools/buildings/nonresidential/build.ts
 * Écrit les GLB (assets/buildings/nonresidential/) et assets/catalog.buildings.other.json.
 */
import { join } from 'node:path';
import { generateNonResidential } from './index';

const assetsDir = join(import.meta.dirname, '..', '..', '..', 'assets');
const only = process.env['ONLY'] ? new Set(process.env['ONLY'].split(',')) : undefined;
const t0 = Date.now();
generateNonResidential({ assetsDir }, only).then((r) => {
  console.log(`${r.assets.length} bâtiments non résidentiels (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}).catch((e: unknown) => { console.error(e); process.exit(1); });
