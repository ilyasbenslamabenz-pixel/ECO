/**
 * Générateur des bâtiments RÉSIDENTIELS (maisons, mitoyennes, petits / moyens immeubles, haute densité, tours).
 * - GLB LOD0/1/2 dans assets/buildings/residential/ ;
 * - fragment de catalogue assets/catalog.buildings.residential.json ({ assets, textureSets }) ;
 * - compatible avec le registre de tools/generators (type Generator) : à enregistrer par le propriétaire
 *   de tools/generators/index.ts (voir docs/requests/buildings-residential.md).
 */
import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AssetCatalog, CatalogAsset, TextureSet } from '../../../src/shared/catalog';
import { buildKitTextureSets, exportBuilding, mergeTextureSets, type BuildingDef } from '../kit/index';
import { COLLECTIVE } from './collective';
import { HOUSES } from './houses';
import { TOWERS } from './towers';

export const RESIDENTIAL_DIR = 'buildings/residential';
export const RESIDENTIAL_FRAGMENT = 'catalog.buildings.residential.json';

export const RESIDENTIAL: BuildingDef[] = [...HOUSES, ...COLLECTIVE, ...TOWERS];

export interface ResidentialOutput { assets: CatalogAsset[]; textureSets: TextureSet[] }

export async function generateResidential(ctx: { assetsDir: string }, only?: Set<string>): Promise<ResidentialOutput> {
  const { assetsDir } = ctx;
  const cat = JSON.parse(readFileSync(join(assetsDir, 'catalog.json'), 'utf8')) as AssetCatalog;
  const kit = await buildKitTextureSets(assetsDir);
  const sets = mergeTextureSets(cat, kit);
  const fragPath = join(assetsDir, RESIDENTIAL_FRAGMENT);
  const prev: CatalogAsset[] = only && existsSync(fragPath) ? (JSON.parse(readFileSync(fragPath, 'utf8')) as ResidentialOutput).assets : [];
  const assets: CatalogAsset[] = [];
  for (const def of RESIDENTIAL) {
    if (only && !only.has(def.id)) {
      const p = prev.find((a) => a.id === def.id);
      if (p) assets.push(p);
      continue;
    }
    const r = exportBuilding(def, assetsDir, RESIDENTIAL_DIR, sets);
    const kb = r.bytes.map((b) => Math.round(b / 1024)).join('/');
    console.log(`  ${def.id.padEnd(34)} ${r.triangles.join('/').padEnd(20)} tri  ${kb} Ko  ${r.asset.dimensions.width}×${r.asset.dimensions.depth}×${r.asset.dimensions.height} m`);
    assets.push(r.asset);
  }
  // fichiers orphelins (bâtiments retirés)
  if (!only) {
    const keep = new Set(assets.flatMap((a) => a.lods.map((l) => l.file.split('/').pop()!)));
    const dir = join(assetsDir, RESIDENTIAL_DIR);
    if (existsSync(dir)) for (const f of readdirSync(dir)) if (f.endsWith('.glb') && !keep.has(f)) unlinkSync(join(dir, f));
  }
  const out: ResidentialOutput = { assets, textureSets: kit };
  writeFileSync(fragPath, `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
