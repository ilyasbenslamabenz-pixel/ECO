/**
 * Phase 2C — mobilier urbain européen : `npx tsx tools/props/build.ts [--only=id,id]`
 *  1. génère les modèles procéduraux de tools/props/models.ts (LOD0/1/2, atlas partagé) dans assets/models/props/ ;
 *  2. construit le mobilier Poly Haven (CC0) de tools/assets/selection.ts (P2C_STREET_FURNITURE_PH)
 *     avec le pipeline standard, dans assets/models/polyhaven/street_furniture/ ;
 *  3. met à jour CES SEULES entrées de assets/catalog.json (catégorie street_furniture ; triangles mesurés) ;
 *  4. régénère assets/LICENSES.md depuis le catalogue (tools/assets/licenses.ts).
 * Contrôles bloquants : LOD strictement décroissants, LOD0 ≥ seuil de la catégorie, budget disque du lot.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIN_TRIANGLES_LOD0, validateCatalog, type AssetCatalog, type CatalogAsset } from '../../src/shared/catalog';
import { writeLicenses } from '../assets/licenses';
import { inspectGlb } from '../lib/glb-inspect';
import { encodeAtlas, renderAtlas } from './atlas';
import { buildPhStreetFurniture } from './build-ph';
import { Model } from './geom';
import { boundsOf, writeGlb } from './glb';
import { PROPS, type PropDef } from './models';

const root = join(import.meta.dirname, '..', '..');
const assetsDir = join(root, 'assets');
export const PROPS_DIR = 'models/props';
/** Budget disque (sources non compressées) de TOUT le lot phase 2C (générés + Poly Haven). */
export const P2C_SOURCE_BUDGET = 4.6 * 1024 * 1024;
export const PROPS_AUTHOR = 'Œuvre originale générée par le projet (tools/props : géométrie paramétrique + atlas dessiné, gltf-transform + sharp)';

export function buildLods(def: PropDef): Model[] {
  return [0, 1, 2].map((l) => { const m = new Model(l); def.build(m); return m; });
}

export function propEntry(def: PropDef, dims: CatalogAsset['dimensions'], tris: number[]): CatalogAsset {
  return {
    id: def.id,
    nameFr: def.nameFr,
    category: 'street_furniture',
    lods: [0, 1, 2].map((l) => ({ file: `${PROPS_DIR}/${def.id}_lod${l}.glb`, maxDistance: l === 0 ? def.lodDistances[0] : l === 1 ? def.lodDistances[1] : 1e9, triangles: tris[l] })),
    dimensions: dims,
    footprint: { tilesX: 0, tilesZ: 0 },
    cost: def.cost,
    upkeepPerMonth: 0,
    capacity: { residents: 0, jobs: 0 },
    frontage: [],
    variants: [{ id: 'standard', nameFr: 'Standard' }],
    textureSets: [],
    license: { spdx: 'CC0-1.0', source: `tools/props/models.ts#${def.id}`, author: PROPS_AUTHOR },
    tags: ['procedural', 'mobilier_p2c', ...def.tags],
  };
}

async function main(): Promise<void> {
  const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');
  const atlas = await renderAtlas();
  const enc = await Promise.all([0, 1, 2].map((l) => encodeAtlas(atlas, l)));
  mkdirSync(join(assetsDir, PROPS_DIR), { recursive: true });
  const entries: CatalogAsset[] = [];
  const problems: string[] = [];
  let bytes = 0;
  console.log('Mobilier généré (tools/props) :');
  for (const def of PROPS) {
    if (only && !only.includes(def.id)) continue;
    const lods = buildLods(def);
    const tris = lods.map((m) => m.triangles());
    for (let i = 1; i < 3; i++) if (!(tris[i]! < tris[i - 1]!)) problems.push(`${def.id} : LOD${i} ${tris[i]} ≥ LOD${i - 1} ${tris[i - 1]}`);
    if (tris[0]! < MIN_TRIANGLES_LOD0.street_furniture) problems.push(`${def.id} : LOD0 ${tris[0]} triangles < seuil`);
    const b = boundsOf(lods[0]!);
    const off: [number, number, number] = [-(b.min[0] + b.max[0]) / 2, -b.min[1], -(b.min[2] + b.max[2]) / 2];
    const sizes: number[] = [];
    for (let l = 0; l < 3; l++) {
      const bin = await writeGlb(lods[l]!, enc[l]!, off, def.id);
      const file = join(assetsDir, `${PROPS_DIR}/${def.id}_lod${l}.glb`);
      if (!existsSync(file) || !Buffer.from(readFileSync(file)).equals(Buffer.from(bin))) writeFileSync(file, bin);
      sizes.push(bin.byteLength);
    }
    bytes += sizes.reduce((a, c) => a + c, 0);
    const dims = { width: +(b.max[0] - b.min[0]).toFixed(3), depth: +(b.max[2] - b.min[2]).toFixed(3), height: +(b.max[1] - b.min[1]).toFixed(3) };
    entries.push(propEntry(def, dims, tris));
    console.log(`  ${def.id.padEnd(24)} tri ${tris.join('/').padEnd(16)} ${sizes.map((s) => `${Math.round(s / 1024)}K`).join('/').padEnd(14)} ${dims.width}×${dims.depth}×${dims.height} m`);
  }
  console.log('Mobilier Poly Haven (CC0) :');
  const ph = await buildPhStreetFurniture(assetsDir, (s) => console.log(s));
  for (const a of ph.assets) if (!only || only.includes(a.id)) entries.push(a);
  for (const a of ph.assets) for (const l of a.lods) bytes += statSync(join(assetsDir, l.file)).size;
  for (const w of ph.warnings) console.warn(`AVERTISSEMENT ${w}`);

  // Fusion dans le catalogue (uniquement nos entrées) + triangles mesurés.
  const catPath = join(assetsDir, 'catalog.json');
  const cat = JSON.parse(readFileSync(catPath, 'utf8')) as AssetCatalog;
  for (const e of entries) {
    for (const l of e.lods) l.triangles = (await inspectGlb(join(assetsDir, l.file))).triangles;
    const i = cat.assets.findIndex((x) => x.id === e.id);
    if (i >= 0) cat.assets[i] = e; else cat.assets.push(e);
  }
  for (const iss of validateCatalog(cat)) if (entries.some((e) => e.id === iss.assetId)) problems.push(`${iss.assetId} : ${iss.message}`);
  writeFileSync(catPath, `${JSON.stringify(cat, null, 2)}\n`);
  writeLicenses(cat, assetsDir);
  if (!only) {
    console.log(`Lot phase 2C : ${(bytes / 1024 / 1024).toFixed(2)} Mo de sources (budget ${(P2C_SOURCE_BUDGET / 1024 / 1024).toFixed(1)} Mo ; compressés meshopt au build)`);
    if (bytes > P2C_SOURCE_BUDGET) problems.push(`lot phase 2C : ${(bytes / 1024 / 1024).toFixed(2)} Mo > budget`);
  }
  if (problems.length) { console.error(`ÉCHEC :\n - ${problems.join('\n - ')}`); process.exit(1); }
  console.log(`${entries.length} entrées street_furniture à jour dans assets/catalog.json ; LICENSES.md régénéré.`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e: unknown) => { console.error(e); process.exit(1); });
