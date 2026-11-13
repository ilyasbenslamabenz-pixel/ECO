/**
 * Générateur des modèles du réseau électrique (phase 2B, sous-étape 4) :
 *   npx tsx tools/power/build.ts          (ou npm run power:build)
 * - GLB LOD0/1/2 dans assets/models/power/ (kit tools/buildings/kit : quantification, textures externes partagées) ;
 * - entrées du catalogue assets/catalog.json mises à jour (upsert de NOS 5 bâtiments seulement) + fragment
 *   assets/catalog.power.json (traçabilité, non copié dans dist) qui décrit aussi les 2 éléments instanciés (rotor,
 *   pylône : GLB chargés directement par le rendu, hors catalogue — voir POWER_ELEMENT_FILES) ;
 * - assets/LICENSES.md régénéré depuis le catalogue (même fonction que le pipeline).
 * Aucun jeu de textures n'est créé : les matériaux réutilisent les jeux déjà présents dans le catalogue.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AssetCatalog, CatalogAsset, TextureSet } from '../../src/shared/catalog';
import { exportBuilding, hashSeed, MeshBuilder, mergeTextureSets, rng, writeGlb, type Ctx, type Palette } from '../buildings/kit/index';
import { writeLicenses } from '../assets/licenses';
import { POWER_ASSETS } from '../../src/shared/power/render-spec';
import { buildPylon, buildRotor, POWER_BUILDINGS, PYLON_PALETTE, ROTOR_PALETTE } from './models';

export const POWER_DIR = 'models/power';
export const POWER_FRAGMENT = 'catalog.power.json';

interface PropDef {
  id: string;
  nameFr: string;
  palette: Palette;
  lodDistances: [number, number];
  tags: string[];
  source: string;
  build(ctx: Ctx): void;
}

const PROPS: PropDef[] = [
  { id: POWER_ASSETS.rotor, nameFr: 'Rotor d\'éolienne (animé)', palette: ROTOR_PALETTE, lodDistances: [350, 2100], tags: ['electricite', 'elec:element', 'anime', 'rotor'], source: 'tools/power/models.ts#buildRotor', build: buildRotor },
  { id: POWER_ASSETS.pylone, nameFr: 'Pylône de ligne haute tension', palette: PYLON_PALETTE, lodDistances: [350, 1400], tags: ['electricite', 'elec:element', 'pylone', 'ligne_ht'], source: 'tools/power/models.ts#buildPylon', build: buildPylon },
];

function modes(p: Palette): { uv: Record<string, 'meters' | 'unit'>; glass: Set<string> } {
  const uv: Record<string, 'meters' | 'unit'> = {};
  const glass = new Set<string>();
  for (const [k, m] of Object.entries(p)) { uv[k] = m.uv ?? 'meters'; if (m.kind === 'glass' || !m.set) glass.add(k); }
  return { uv, glass };
}

/** Élément instancié (pas d'emprise, origine conservée : moyeu du rotor, pied du pylône). */
function exportProp(def: PropDef, assetsDir: string, sets: Map<string, TextureSet>): { asset: CatalogAsset; triangles: number[]; bytes: number[] } {
  const { uv, glass } = modes(def.palette);
  const lods = ([0, 1, 2] as const).map((lod) => { const mb = new MeshBuilder(uv, glass); def.build({ mb, lod, r: rng(hashSeed(def.id)) }); return mb; });
  const triangles: number[] = [], bytes: number[] = [];
  const lodEntries = lods.map((mb, i) => {
    const file = `${POWER_DIR}/${def.id}_lod${i}.glb`;
    const st = writeGlb(mb, def.palette, sets, join(assetsDir, file), assetsDir);
    triangles.push(st.triangles); bytes.push(st.bytes);
    return { file, maxDistance: i === 0 ? def.lodDistances[0] : i === 1 ? def.lodDistances[1] : 1e9, triangles: st.triangles };
  });
  for (let i = 1; i < triangles.length; i++) if (!(triangles[i]! < triangles[i - 1]!)) throw new Error(`${def.id} : LOD${i} pas moins détaillé`);
  const b = lods[0]!.bounds();
  const r2 = (x: number): number => Math.round(x * 100) / 100;
  const used = new Set<string>();
  for (const role of lods[0]!.prims.keys()) { const s = def.palette[role]?.set; if (s) used.add(s); }
  const asset: CatalogAsset = {
    id: def.id, nameFr: def.nameFr, category: 'prop', lods: lodEntries,
    dimensions: { width: r2(b.max[0] - b.min[0]), depth: r2(b.max[2] - b.min[2]), height: r2(b.max[1] - b.min[1]) },
    footprint: { tilesX: 0, tilesZ: 0 }, cost: 0, upkeepPerMonth: 0, capacity: { residents: 0, jobs: 0 }, frontage: [],
    variants: [{ id: 'origine', nameFr: 'Origine' }], textureSets: [...used].sort(),
    license: { spdx: 'CC0-1.0', source: def.source, author: 'Projet Aube Urbaine (générateur réseau électrique)' },
    tags: [...def.tags, 'genere'],
  };
  return { asset, triangles, bytes };
}

export async function generatePower(assetsDir: string): Promise<CatalogAsset[]> {
  const catPath = join(assetsDir, 'catalog.json');
  const cat = JSON.parse(readFileSync(catPath, 'utf8')) as AssetCatalog;
  const sets = mergeTextureSets(cat, []);
  mkdirSync(join(assetsDir, POWER_DIR), { recursive: true });
  const out: CatalogAsset[] = [];
  let total = 0;
  const log = (a: CatalogAsset, tri: number[], by: number[]): void => {
    total += by.reduce((s, x) => s + x, 0);
    console.log(`  ${a.id.padEnd(24)} ${tri.join('/').padEnd(18)} tri  ${by.map((x) => Math.round(x / 1024)).join('/').padEnd(12)} Ko  ${a.dimensions.width}×${a.dimensions.depth}×${a.dimensions.height} m`);
  };
  for (const def of POWER_BUILDINGS) {
    const r = exportBuilding(def, assetsDir, POWER_DIR, sets);
    log(r.asset, r.triangles, r.bytes);
    out.push(r.asset);
  }
  const elements: CatalogAsset[] = [];
  for (const def of PROPS) {
    const r = exportProp(def, assetsDir, sets);
    log(r.asset, r.triangles, r.bytes);
    elements.push(r.asset);
  }
  console.log(`  total GLB (avant meshopt) : ${(total / 1048576).toFixed(2)} Mo`);
  for (const a of out) {
    const i = cat.assets.findIndex((x) => x.id === a.id);
    if (i >= 0) cat.assets[i] = a; else cat.assets.push(a);
  }
  // Les éléments instanciés ne sont pas des entrées de catalogue (voir POWER_ELEMENT_FILES) : retirés s'ils y figuraient.
  cat.assets = cat.assets.filter((a) => !elements.some((e) => e.id === a.id));
  writeFileSync(catPath, `${JSON.stringify(cat, null, 2)}\n`);
  writeFileSync(join(assetsDir, POWER_FRAGMENT), `${JSON.stringify({ assets: out, elements, textureSets: [] }, null, 2)}\n`);
  writeLicenses(cat, assetsDir);
  return out;
}

if (process.argv[1] && dirname(process.argv[1]).endsWith('power')) {
  const assetsDir = join(import.meta.dirname, '..', '..', 'assets');
  const t0 = Date.now();
  generatePower(assetsDir).then((a) => console.log(`${a.length} modèles électriques (${((Date.now() - t0) / 1000).toFixed(1)} s)`)).catch((e: unknown) => { console.error(e); process.exit(1); });
}
