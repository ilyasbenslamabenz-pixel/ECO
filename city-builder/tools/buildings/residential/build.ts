/**
 * Construction autonome des bâtiments résidentiels :
 *   npx tsx tools/buildings/residential/build.ts            (tous)
 *   ONLY=id1,id2 npx tsx tools/buildings/residential/build.ts
 * Écrit les GLB (assets/buildings/residential/) et assets/catalog.buildings.residential.json.
 */
import { join } from 'node:path';
import { generateResidential } from './index';

const assetsDir = join(import.meta.dirname, '..', '..', '..', 'assets');
const only = process.env['ONLY'] ? new Set(process.env['ONLY'].split(',')) : undefined;
const t0 = Date.now();
generateResidential({ assetsDir }, only).then((r) => {
  console.log(`${r.assets.length} bâtiments résidentiels, ${r.textureSets.length} jeux de textures du kit (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}).catch((e: unknown) => { console.error(e); process.exit(1); });
