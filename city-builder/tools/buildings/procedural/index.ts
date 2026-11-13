/**
 * GÉNÉRATEUR PROCÉDURAL DE BÂTIMENTS (phase 2A — module « Bâtiments & quartiers »).
 *
 * Produit les GLB LOD0/1/2 de tous les bâtiments procéduraux dans `assets/buildings/procedural/` et le fragment
 * de catalogue `assets/catalog.buildings.procedural.json` ({ assets, textureSets }). Les entrées portent les tags
 * attendus par le générateur de quartiers (`src/sim/districts`) : `procedural`, `style:<id>`, `densite:<…>`,
 * `quartier:<type>` (un ou plusieurs) et `mitoyen` quand les murs latéraux sont aveugles.
 *
 * Emplacement des fichiers : `assets/buildings/procedural/` (et non `assets/models/buildings/`) pour rester
 * cohérent avec les bâtiments existants du kit (`assets/buildings/residential`, `.../nonresidential`), qui
 * partagent les textures du kit sous `assets/buildings/textures/`.
 *
 *   npx tsx tools/buildings/procedural/build.ts            (tous)
 *   ONLY=id1,id2 npx tsx tools/buildings/procedural/build.ts
 */
import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AssetCatalog, CatalogAsset, TextureSet } from '../../../src/shared/catalog';
import { buildKitTextureSets, exportBuilding, mergeTextureSets, type BuildingDef } from '../kit/index';
import { RESIDENCES } from './models/residences';
import { COLLECTIFS } from './models/collectifs';
import { TERTIAIRE } from './models/tertiaire';
import { COMMERCES } from './models/commerces';
import { ACTIVITES } from './models/activites';
import { EQUIPEMENTS } from './models/equipements';

export const PROCEDURAL_DIR = 'buildings/procedural';
export const PROCEDURAL_FRAGMENT = 'catalog.buildings.procedural.json';

export const PROCEDURAL: BuildingDef[] = [...RESIDENCES, ...COLLECTIFS, ...TERTIAIRE, ...COMMERCES, ...ACTIVITES, ...EQUIPEMENTS];

export interface ProceduralOutput { assets: CatalogAsset[]; textureSets: TextureSet[] }

export async function generateProcedural(ctx: { assetsDir: string }, only?: Set<string>): Promise<ProceduralOutput> {
  const { assetsDir } = ctx;
  const cat = JSON.parse(readFileSync(join(assetsDir, 'catalog.json'), 'utf8')) as AssetCatalog;
  const kit = await buildKitTextureSets(assetsDir);
  const sets = mergeTextureSets(cat, kit);
  const fragPath = join(assetsDir, PROCEDURAL_FRAGMENT);
  const prev: CatalogAsset[] = only && existsSync(fragPath) ? (JSON.parse(readFileSync(fragPath, 'utf8')) as ProceduralOutput).assets : [];
  const assets: CatalogAsset[] = [];
  const ids = new Set<string>();
  for (const def of PROCEDURAL) {
    if (ids.has(def.id)) throw new Error(`identifiant en double : ${def.id}`);
    ids.add(def.id);
    if (only && !only.has(def.id)) {
      const p = prev.find((a) => a.id === def.id);
      if (p) assets.push(p);
      continue;
    }
    const r = exportBuilding(def, assetsDir, PROCEDURAL_DIR, sets);
    const kb = r.bytes.map((b) => Math.round(b / 1024)).join('/');
    console.log(`  ${def.id.padEnd(36)} ${r.triangles.join('/').padEnd(20)} tri  ${kb} Ko  ${r.asset.dimensions.width}×${r.asset.dimensions.depth}×${r.asset.dimensions.height} m`);
    assets.push(r.asset);
  }
  if (!only) {
    const keep = new Set(assets.flatMap((a) => a.lods.map((l) => l.file.split('/').pop()!)));
    const dir = join(assetsDir, PROCEDURAL_DIR);
    if (existsSync(dir)) for (const f of readdirSync(dir)) if (f.endsWith('.glb') && !keep.has(f)) unlinkSync(join(dir, f));
  }
  const out: ProceduralOutput = { assets, textureSets: kit };
  writeFileSync(fragPath, `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
