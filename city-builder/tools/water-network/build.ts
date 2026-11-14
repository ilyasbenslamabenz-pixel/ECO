/**
 * Construction des modèles du service de l'eau (phase 2B.5) :
 *   npx tsx tools/water-network/build.ts
 * Écrit les GLB LOD0/1/2 dans assets/models/water-network/ et met à jour LEURS SEULES entrées dans
 * assets/catalog.json (remplacées par identifiant, ajoutées en fin de liste sinon ; les autres entrées sont intactes).
 * N'utilise que les jeux de textures déjà présents au catalogue (aucune texture écrite).
 * Budget : total des GLB ≤ 2 Mo (vérifié ici avant compression meshopt du build).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AssetCatalog } from '../../src/shared/catalog';
import { exportBuilding, mergeTextureSets } from '../buildings/kit/index';
import { WATER_MODELS } from './models';

export const WATER_DIR = 'models/water-network';
const BUDGET = 2 * 1024 * 1024;

export function buildWaterModels(assetsDir: string): { bytes: number; ids: string[] } {
  const catPath = join(assetsDir, 'catalog.json');
  const cat = JSON.parse(readFileSync(catPath, 'utf8')) as AssetCatalog;
  const sets = mergeTextureSets(cat, []);
  mkdirSync(join(assetsDir, WATER_DIR), { recursive: true });
  let total = 0;
  const keep = new Set<string>();
  for (const def of WATER_MODELS) {
    const r = exportBuilding(def, assetsDir, WATER_DIR, sets);
    total += r.bytes.reduce((a, b) => a + b, 0);
    for (const l of r.asset.lods) keep.add(l.file.split('/').pop()!);
    console.log(`  ${def.id.padEnd(28)} ${r.triangles.join('/').padEnd(18)} tri  ${r.bytes.map((b) => Math.round(b / 1024)).join('/').padEnd(12)} Ko  ${r.asset.dimensions.width}×${r.asset.dimensions.depth}×${r.asset.dimensions.height} m`);
    const i = cat.assets.findIndex((a) => a.id === def.id);
    if (i >= 0) cat.assets[i] = r.asset; else cat.assets.push(r.asset);
  }
  const dir = join(assetsDir, WATER_DIR);
  if (existsSync(dir)) for (const f of readdirSync(dir)) if (f.endsWith('.glb') && !keep.has(f)) unlinkSync(join(dir, f));
  writeFileSync(catPath, `${JSON.stringify(cat, null, 2)}\n`);
  console.log(`  total GLB : ${(total / 1048576).toFixed(2)} Mo (budget 2 Mo)`);
  if (total > BUDGET) throw new Error(`modèles eau : ${(total / 1048576).toFixed(2)} Mo > 2 Mo`);
  return { bytes: total, ids: WATER_MODELS.map((d) => d.id) };
}

if (process.argv[1] && process.argv[1].endsWith('build.ts')) {
  buildWaterModels(join(import.meta.dirname, '..', '..', 'assets'));
}
