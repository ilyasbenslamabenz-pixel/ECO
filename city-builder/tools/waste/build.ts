/**
 * Construction des modèles du module « Déchets » (npm run waste:build) :
 *  - GLB LOD0/1/2 dans assets/models/waste/ (kit de bâtiments, textures externes partagées) ;
 *  - fragment de catalogue assets/catalog.waste.json ;
 *  - entrées insérées / mises à jour dans assets/catalog.json (triangles mesurés), LICENSES.md régénéré.
 * Les GLB qui ne correspondent plus à un modèle sont supprimés du dossier.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AssetCatalog, CatalogAsset } from '../../src/shared/catalog';
import { buildKitTextureSets, exportBuilding, mergeTextureSets } from '../buildings/kit/index';
import { withCenteredFrontage } from '../buildings/nonresidential/index';
import { WASTE_BUILDINGS, WASTE_DECOR_CATEGORY } from './models';

export const WASTE_DIR = 'models/waste';
export const WASTE_FRAGMENT = 'catalog.waste.json';

export async function generateWaste(assetsDir: string): Promise<{ assets: CatalogAsset[]; bytes: number }> {
  const catPath = join(assetsDir, 'catalog.json');
  const cat = JSON.parse(readFileSync(catPath, 'utf8')) as AssetCatalog;
  const kit = await buildKitTextureSets(assetsDir);
  const sets = mergeTextureSets(cat, kit);
  mkdirSync(join(assetsDir, WASTE_DIR), { recursive: true });
  const assets: CatalogAsset[] = [];
  let total = 0;
  for (const def of WASTE_BUILDINGS) {
    const r = exportBuilding(withCenteredFrontage(def), assetsDir, WASTE_DIR, sets);
    const b = r.bytes.reduce((a, x) => a + x, 0);
    total += b;
    console.log(`  ${def.id.padEnd(26)} ${r.triangles.join('/').padEnd(18)} tri  ${r.bytes.map((x) => Math.round(x / 1024)).join('/').padEnd(12)} Ko  ${r.asset.dimensions.width}×${r.asset.dimensions.depth}×${r.asset.dimensions.height} m`);
    const decor = WASTE_DECOR_CATEGORY[def.id];
    if (decor) { r.asset.category = decor; r.asset.frontage = []; r.asset.cost = 0; }
    assets.push(r.asset);
  }
  const keep = new Set(assets.flatMap((a) => a.lods.map((l) => l.file.split('/').pop()!)));
  const dir = join(assetsDir, WASTE_DIR);
  for (const f of readdirSync(dir)) if (f.endsWith('.glb') && !keep.has(f)) unlinkSync(join(dir, f));
  writeFileSync(join(assetsDir, WASTE_FRAGMENT), `${JSON.stringify({ assets, textureSets: [] }, null, 2)}\n`);
  for (const a of assets) {
    const i = cat.assets.findIndex((x) => x.id === a.id);
    if (i >= 0) cat.assets[i] = a; else cat.assets.push(a);
  }
  for (const t of kit) if (!cat.textureSets.some((x) => x.id === t.id)) cat.textureSets.push(t);
  writeFileSync(catPath, `${JSON.stringify(cat, null, 2)}\n`);
  updateLicenses(assets, assetsDir);
  return { assets, bytes: total };
}

/**
 * Inscrit les modèles déchets dans assets/LICENSES.md (lignes `dechets_*` remplacées, insérées après les autres
 * modèles) sans régénérer les lignes des autres modules.
 */
function updateLicenses(assets: CatalogAsset[], assetsDir: string): void {
  const p = join(assetsDir, 'LICENSES.md');
  if (!existsSync(p)) return;
  const esc = (s: string): string => s.replace(/\|/g, '\\|');
  const lines = readFileSync(p, 'utf8').split('\n').filter((l) => !l.startsWith('| `dechets_'));
  const rows = assets.map((a) => `| \`${a.id}\` — ${esc(a.nameFr)} | modèle (${a.category}) | ${a.lods.map((l) => l.file).join(', ')} | ${a.license.spdx} | ${esc(a.license.source)} | ${esc(a.license.author)} | — | — |`);
  let at = lines.findIndex((l) => / \| textures PBR \| /.test(l));
  if (at < 0) at = lines.length;
  lines.splice(at, 0, ...rows);
  writeFileSync(p, lines.join('\n'));
}

if (process.argv[1] && /tools[\\/]waste[\\/]build\.ts$/.test(process.argv[1])) {
  const assetsDir = join(import.meta.dirname, '..', '..', 'assets');
  const t0 = Date.now();
  generateWaste(assetsDir).then((r) => {
    const onDisk = existsSync(join(assetsDir, WASTE_DIR)) ? readdirSync(join(assetsDir, WASTE_DIR)).reduce((s, f) => s + statSync(join(assetsDir, WASTE_DIR, f)).size, 0) : 0;
    console.log(`${r.assets.length} modèles déchets, ${(r.bytes / 1024).toFixed(0)} Ko (disque ${(onDisk / 1024).toFixed(0)} Ko), ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }).catch((e: unknown) => { console.error(e); process.exit(1); });
}
