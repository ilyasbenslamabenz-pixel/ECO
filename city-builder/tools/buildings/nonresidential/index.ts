/**
 * Générateur des bâtiments NON résidentiels : commerces, bureaux et gratte-ciel, industrie, équipements publics, parc.
 * - GLB LOD0/1/2 dans assets/buildings/nonresidential/ ;
 * - fragment de catalogue assets/catalog.buildings.other.json ({ assets, textureSets }) ;
 * - à enregistrer dans le registre tools/generators par son propriétaire (voir docs/requests/buildings-other.md).
 */
import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AssetCatalog, CatalogAsset, TextureSet } from '../../../src/shared/catalog';
import { buildKitTextureSets, buildLods, exportBuilding, mergeTextureSets, type BuildingDef } from '../kit/index';
import { COMMERCE } from './commerce';
import { INDUSTRY } from './industry';
import { OFFICES } from './offices';
import { PUBLIC } from './public';

export const OTHER_DIR = 'buildings/nonresidential';
export const OTHER_FRAGMENT = 'catalog.buildings.other.json';

export const NONRESIDENTIAL: BuildingDef[] = [...COMMERCE, ...OFFICES, ...INDUSTRY, ...PUBLIC];

/**
 * Les points de façade (`frontage`) sont écrits dans le repère de build() ; exportBuilding recentre la géométrie
 * (centre de l'emprise en 0,0) sans les déplacer : on leur applique ici la même translation.
 */
export function withCenteredFrontage(def: BuildingDef): BuildingDef {
  if (!def.frontage) return def;
  const b = buildLods(def)[0]!.bounds();
  const dx = -(b.min[0] + b.max[0]) / 2;
  const dz = -(b.min[2] + b.max[2]) / 2;
  const r2 = (x: number): number => Math.round(x * 100) / 100;
  return { ...def, frontage: def.frontage.map((f) => ({ ...f, x: r2(f.x + dx), z: r2(f.z + dz) })) };
}

export interface OtherOutput { assets: CatalogAsset[]; textureSets: TextureSet[] }

export async function generateNonResidential(ctx: { assetsDir: string }, only?: Set<string>): Promise<OtherOutput> {
  const { assetsDir } = ctx;
  const cat = JSON.parse(readFileSync(join(assetsDir, 'catalog.json'), 'utf8')) as AssetCatalog;
  const kit = await buildKitTextureSets(assetsDir);
  const sets = mergeTextureSets(cat, kit);
  const fragPath = join(assetsDir, OTHER_FRAGMENT);
  const prev: CatalogAsset[] = only && existsSync(fragPath) ? (JSON.parse(readFileSync(fragPath, 'utf8')) as OtherOutput).assets : [];
  const assets: CatalogAsset[] = [];
  let total = 0;
  for (const def of NONRESIDENTIAL) {
    if (only && !only.has(def.id)) {
      const p = prev.find((a) => a.id === def.id);
      if (p) assets.push(p);
      continue;
    }
    const r = exportBuilding(withCenteredFrontage(def), assetsDir, OTHER_DIR, sets);
    total += r.bytes.reduce((a, b) => a + b, 0);
    const kb = r.bytes.map((b) => Math.round(b / 1024)).join('/');
    console.log(`  ${def.id.padEnd(30)} ${r.triangles.join('/').padEnd(20)} tri  ${kb.padEnd(14)} Ko  ${r.asset.dimensions.width}×${r.asset.dimensions.depth}×${r.asset.dimensions.height} m`);
    assets.push(r.asset);
  }
  if (!only) {
    const keep = new Set(assets.flatMap((a) => a.lods.map((l) => l.file.split('/').pop()!)));
    const dir = join(assetsDir, OTHER_DIR);
    if (existsSync(dir)) for (const f of readdirSync(dir)) if (f.endsWith('.glb') && !keep.has(f)) unlinkSync(join(dir, f));
    console.log(`  total GLB : ${(total / 1048576).toFixed(2)} Mo`);
  }
  const out: OtherOutput = { assets, textureSets: kit };
  writeFileSync(fragPath, `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
