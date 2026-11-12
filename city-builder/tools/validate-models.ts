/**
 * Validation hors navigateur des modèles du catalogue (npm run validate:assets).
 * Échoue si : GLB illisible, triangles sous le seuil de la catégorie, aucun matériau
 * avec texture de base ET normal map, texture de taille invalide, moins de 30 bâtiments,
 * catégories de bâtiments non couvertes. Complète la porte visuelle navigateur (validate:visual).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUILDING_CATEGORIES, MIN_TRIANGLES_LOD0, isBuildingCategory, type AssetCatalog } from '../src/shared/catalog';
import { inspectGlb } from './lib/glb-inspect';

export const MIN_BUILDINGS = 30;
const root = join(import.meta.dirname, '..');
const assetsDir = join(root, 'assets');

async function main(): Promise<void> {
  const cat = JSON.parse(readFileSync(join(assetsDir, 'catalog.json'), 'utf8')) as AssetCatalog;
  const errors: string[] = [];
  for (const a of cat.assets) {
    const lod0 = a.lods[0];
    if (!lod0) { errors.push(`${a.id} : aucun LOD`); continue; }
    const p = join(assetsDir, lod0.file);
    if (!existsSync(p)) { errors.push(`${a.id} : ${lod0.file} manquant`); continue; }
    const info = await inspectGlb(p);
    const min = MIN_TRIANGLES_LOD0[a.category];
    if (info.triangles < min) errors.push(`${a.id} : ${info.triangles} triangles < ${min}`);
    if (!info.materials.some((m) => m.baseColor && m.normal)) errors.push(`${a.id} : aucun matériau avec baseColor + normal`);
    for (const t of info.textures) if (t.width < 4 || t.height < 4) errors.push(`${a.id} : texture ${t.name} de taille invalide ${t.width}x${t.height}`);
    console.log(`${errors.some((e) => e.startsWith(a.id + ' ')) ? 'ÉCHEC' : 'OK  '} ${a.id.padEnd(32)} ${String(info.triangles).padStart(7)} tri  ${info.materials.length} mat  ${info.textures.length} tex`);
  }
  const buildings = cat.assets.filter((a) => isBuildingCategory(a.category));
  if (buildings.length < MIN_BUILDINGS) errors.push(`bibliothèque : ${buildings.length} bâtiments < ${MIN_BUILDINGS} exigés`);
  for (const c of BUILDING_CATEGORIES) if (!buildings.some((b) => b.category === c)) errors.push(`bibliothèque : aucune entrée pour la catégorie ${c}`);
  for (const c of ['vehicle', 'tree', 'street_furniture'] as const) if (!cat.assets.some((a) => a.category === c)) errors.push(`bibliothèque : aucune entrée ${c}`);
  if (errors.length) {
    console.error(`\nValidation des modèles : ÉCHEC (${errors.length})\n - ${errors.join('\n - ')}`);
    process.exit(1);
  }
  console.log('\nValidation des modèles : OK');
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
