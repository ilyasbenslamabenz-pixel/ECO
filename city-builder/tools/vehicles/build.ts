/**
 * Générateur de la flotte de véhicules : textures PBR (atlas + peinture), GLB LOD0/1/2 par modèle,
 * fragment de catalogue `assets/catalog.vehicles.json` ({ assets, textureSets }).
 *   npx tsx tools/vehicles/build.ts [--only=id,id]
 * Exporte aussi `generateVehicles(ctx)` (signature des générateurs du pipeline `tools/generators`).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CatalogAsset, TextureSet } from '../../src/shared/catalog';
import { writeVehicleGlb } from './glb';
import { PAINT_TILE, VMesh } from './mesh';
import { VEHICLES, type VehicleDef } from './models';
import { writeVehicleTextures, type VehicleTextureFiles } from './textures';

export const VEHICLE_DIR = 'vehicles';
const LICENSE_AUTHOR = 'Projet Aube Urbaine (générateur procédural, CC0)';

export interface BuiltVehicle { asset: CatalogAsset; lodTriangles: number[]; lodBytes: number[] }

/** Construit un modèle au LOD donné, recentré (centre de l'emprise en (0,0), roues au sol y = 0). */
export function buildVehicleMesh(def: VehicleDef, lod: number): VMesh {
  const probe = new VMesh(0);
  def.build(probe);
  const b = probe.bounds();
  const mb = new VMesh(lod);
  mb.push().translate(-(b.min[0] + b.max[0]) / 2, -b.min[1], -(b.min[2] + b.max[2]) / 2);
  def.build(mb);
  mb.pop();
  return mb;
}

export function textureSetsFor(tex: VehicleTextureFiles): TextureSet[] {
  const license = { spdx: 'CC0-1.0', source: 'tools/vehicles/textures.ts#writeVehicleTextures', author: LICENSE_AUTHOR };
  return [
    { id: 'vehicules_atlas', nameFr: 'Véhicules — atlas de détails (pneus, optiques, chromes, lettrages)', albedo: tex.atlas.albedo, normal: tex.atlas.normal, arm: tex.atlas.arm, tileSizeM: 1, license },
    { id: 'vehicules_peinture', nameFr: 'Véhicules — peinture carrosserie (teintée par variante)', albedo: tex.paint.albedo, normal: tex.paint.normal, arm: tex.paint.arm, tileSizeM: PAINT_TILE, license },
  ];
}

export async function buildVehicle(def: VehicleDef, assetsDir: string, tex: VehicleTextureFiles): Promise<BuiltVehicle> {
  const lods: CatalogAsset['lods'] = [];
  const tris: number[] = [], bytes: number[] = [];
  let dims = { width: 0, depth: 0, height: 0 };
  for (let lod = 0; lod < 3; lod++) {
    const mb = buildVehicleMesh(def, lod);
    if (lod === 0) {
      const b = mb.bounds();
      dims = { width: +(b.max[0] - b.min[0]).toFixed(3), depth: +(b.max[2] - b.min[2]).toFixed(3), height: +(b.max[1] - b.min[1]).toFixed(3) };
    }
    const file = `${VEHICLE_DIR}/${def.id}_lod${lod}.glb`;
    const st = writeVehicleGlb(mb, tex, join(assetsDir, file), assetsDir, `${def.id}_lod${lod}`);
    tris.push(st.triangles); bytes.push(st.bytes);
    lods.push({ file, maxDistance: lod === 0 ? def.lodDistances[0] : lod === 1 ? def.lodDistances[1] : 1e9, triangles: st.triangles });
  }
  for (let i = 1; i < tris.length; i++) if (!(tris[i]! < tris[i - 1]!)) throw new Error(`${def.id} : LOD${i} (${tris[i]}) non moins détaillé que LOD${i - 1} (${tris[i - 1]})`);
  const asset: CatalogAsset = {
    id: def.id,
    nameFr: def.nameFr,
    category: 'vehicle',
    lods,
    dimensions: dims,
    footprint: { tilesX: 0, tilesZ: 0 },
    cost: 0,
    upkeepPerMonth: 0,
    capacity: { residents: 0, jobs: 0 },
    frontage: [],
    variants: def.paints.map((p) => ({ id: p.id, nameFr: p.nameFr, materialOverrides: { peinture: { color: p.color } } })),
    textureSets: ['vehicules_atlas', 'vehicules_peinture'],
    license: { spdx: 'CC0-1.0', source: `tools/vehicles/models.ts#${def.id}`, author: LICENSE_AUTHOR },
    tags: ['vehicule', `usage:${def.usage}`, `type:${def.kind}`, 'genere'],
    vehicle: { kind: def.kind, maxSpeedKmh: def.maxSpeedKmh, lengthM: +Math.max(dims.depth, def.lengthM * 0).toFixed(3) || def.lengthM },
  };
  return { asset, lodTriangles: tris, lodBytes: bytes };
}

/** Générateur (même signature que tools/generators) : écrit textures + GLB, renvoie les entrées de catalogue. */
export async function generateVehicles(ctx: { assetsDir: string; only?: string[] }): Promise<{ assets: CatalogAsset[]; textureSets: TextureSet[] }> {
  mkdirSync(join(ctx.assetsDir, VEHICLE_DIR), { recursive: true });
  const tex = await writeVehicleTextures(ctx.assetsDir);
  const assets: CatalogAsset[] = [];
  for (const def of VEHICLES) {
    if (ctx.only && !ctx.only.includes(def.id)) continue;
    const b = await buildVehicle(def, ctx.assetsDir, tex);
    assets.push(b.asset);
    console.log(`  ${def.id.padEnd(28)} LOD ${b.lodTriangles.join(' / ').padEnd(20)} tri · ${(b.lodBytes.reduce((s, x) => s + x, 0) / 1024).toFixed(0)} Ko · ${b.asset.dimensions.width}×${b.asset.dimensions.height}×${b.asset.dimensions.depth} m`);
  }
  return { assets, textureSets: textureSetsFor(tex) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = join(import.meta.dirname, '..', '..');
  const assetsDir = join(root, 'assets');
  const onlyArg = process.argv.find((a) => a.startsWith('--only='));
  const only = onlyArg ? onlyArg.slice(7).split(',') : undefined;
  const out = await generateVehicles({ assetsDir, ...(only ? { only } : {}) });
  if (!only) writeFileSync(join(assetsDir, 'catalog.vehicles.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log(`${out.assets.length} véhicules, ${out.textureSets.length} jeux de textures${only ? '' : ' -> assets/catalog.vehicles.json'}`);
}
