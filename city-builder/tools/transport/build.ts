/**
 * Générateur des assets transport (port de commerce, port de passagers, aéroport) :
 * textures PBR partagées, GLB LOD0/1/2 par modèle, fragment de catalogue `assets/catalog.transport.json`.
 *   npx tsx tools/transport/build.ts [--only=id,id]
 *
 * Les fichiers sont écrits sous `assets/models/transport/_src/` : le segment `_src` est exclu de la copie
 * vers dist par scripts/build.mjs, donc ces assets ne pèsent RIEN dans le build tant qu'ils ne sont pas utilisés
 * (voir docs/requests/assets-transport.md pour l'activation). Le fragment `catalog.*.json` n'est pas copié non plus.
 * Exporte `generateTransport(ctx)` (même signature que les générateurs de tools/generators).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CatalogAsset, TextureSet } from '../../src/shared/catalog';
import { AIRPORT_DEFS } from './airport';
import type { TransportDef } from './defs';
import { writeModelGlb } from './glb';
import { MATERIALS } from './materials';
import { TModel } from './mesh';
import { PORT_DEFS } from './port';
import { writeTransportTextures, type TransportTextureFiles } from './textures';

export const TRANSPORT_DIR = 'models/transport/_src';
export const ALL_DEFS: TransportDef[] = [...PORT_DEFS, ...AIRPORT_DEFS];
const AUTHOR = 'Projet Aube Urbaine (générateur procédural, œuvre originale CC0)';

export interface BuiltTransport { asset: CatalogAsset; lodTriangles: number[]; lodBytes: number[]; nodes: string[] }

export function buildModel(def: TransportDef, lod: number): TModel {
  const m = new TModel(lod);
  def.build(m);
  if (def.origin === 'flottaison' || def.origin === 'niveau') {
    const b = m.bounds();
    const dx = -(b.min[0] + b.max[0]) / 2, dz = -(b.min[2] + b.max[2]) / 2;
    m.root.mesh.shift(dx, 0, dz);
    for (const n of m.nodes) if (n.parent === m.root) n.t = [n.t[0] + dx, n.t[1], n.t[2] + dz];
  } else m.recenter();
  return m;
}

export function textureSetsFor(tex: TransportTextureFiles): TextureSet[] {
  const license = { spdx: 'CC0-1.0', source: 'tools/transport/textures.ts#writeTransportTextures', author: AUTHOR };
  return [
    { id: 'transport_atlas', nameFr: 'Transport — atlas de détails (vitrages, livrées, logos, marquages, feux, découpes)', albedo: tex.atlas.albedo, normal: tex.atlas.normal, arm: tex.atlas.arm, tileSizeM: 1, license },
    { id: 'transport_peinture', nameFr: 'Transport — acier peint (teinté par matériau)', albedo: tex.peinture.albedo, normal: tex.peinture.normal, arm: tex.peinture.arm, tileSizeM: 1.5, license },
    { id: 'transport_tole', nameFr: 'Transport — tôle nervurée (conteneurs, bardages)', albedo: tex.tole.albedo, normal: tex.tole.normal, arm: tex.tole.arm, tileSizeM: 1.12, license },
  ];
}

export async function buildTransport(def: TransportDef, assetsDir: string, tex: TransportTextureFiles): Promise<BuiltTransport> {
  const lods: CatalogAsset['lods'] = [];
  const tris: number[] = [], bytes: number[] = [];
  let dims = { width: 0, depth: 0, height: 0 };
  let nodes: string[] = [];
  const usedSets = new Set<string>();
  for (let lod = 0; lod < 3; lod++) {
    const m = buildModel(def, lod);
    if (lod === 0) {
      const b = m.bounds();
      dims = { width: +(b.max[0] - b.min[0]).toFixed(3), depth: +(b.max[2] - b.min[2]).toFixed(3), height: +(b.max[1] - b.min[1]).toFixed(3) };
      nodes = m.nodes.map((n) => n.anim ? `${n.name}(${n.anim.kind} ${n.anim.axis} ${n.anim.min}..${n.anim.max})` : n.name);
    }
    for (const n of m.nodes) for (const k of n.mesh.groups.keys()) { const s = MATERIALS[k].set; if (s) usedSets.add(s); }
    const file = `${TRANSPORT_DIR}/${def.group}/${def.id}_lod${lod}.glb`;
    const st = writeModelGlb(m, tex, join(assetsDir, file), assetsDir, `${def.id}_lod${lod}`);
    tris.push(st.triangles); bytes.push(st.bytes);
    lods.push({ file, maxDistance: lod === 0 ? def.lodDistances[0] : lod === 1 ? def.lodDistances[1] : 1e9, triangles: st.triangles });
  }
  for (let i = 1; i < tris.length; i++) if (!(tris[i]! < tris[i - 1]!)) throw new Error(`${def.id} : LOD${i} (${tris[i]}) non moins détaillé que LOD${i - 1} (${tris[i - 1]})`);
  const anims = nodes.filter((n) => n.includes('(')).map((n) => `anim:${n.split('(')[0]}`);
  const asset: CatalogAsset = {
    id: def.id,
    nameFr: def.nameFr,
    category: def.category,
    lods,
    dimensions: dims,
    footprint: def.footprint ?? { tilesX: 0, tilesZ: 0 },
    cost: def.cost ?? 0,
    upkeepPerMonth: def.upkeepPerMonth ?? 0,
    capacity: def.capacity ?? { residents: 0, jobs: 0 },
    frontage: def.frontage ?? [],
    variants: [{ id: 'origine', nameFr: 'Teintes d’origine' }, ...(def.variants ?? []).map((v) => ({ id: v.id, nameFr: v.nameFr, materialOverrides: Object.fromEntries(Object.entries(v.overrides).map(([k, c]) => [k, { color: c! }])) }))],
    textureSets: [...usedSets].sort(),
    license: { spdx: 'CC0-1.0', source: `tools/transport/${def.group === 'port' ? 'port' : 'airport'}.ts#${def.id}`, author: AUTHOR },
    tags: ['transport', 'categorie:transport', 'unused', `groupe:${def.group}`, `type:${def.kind}`, 'genere', ...(def.origin === 'flottaison' ? ['origine:flottaison', `tirant_eau:${def.draftM ?? 0}`] : []), ...anims, ...(def.tags ?? [])],
    ...(def.vehicle ? { vehicle: { ...def.vehicle, lengthM: +Math.max(dims.depth, dims.width).toFixed(3) } } : {}),
  };
  return { asset, lodTriangles: tris, lodBytes: bytes, nodes };
}

/** Générateur : écrit textures + GLB, renvoie les entrées de catalogue. */
export async function generateTransport(ctx: { assetsDir: string; only?: string[] }): Promise<{ assets: CatalogAsset[]; textureSets: TextureSet[] }> {
  mkdirSync(join(ctx.assetsDir, TRANSPORT_DIR), { recursive: true });
  const tex = await writeTransportTextures(ctx.assetsDir, TRANSPORT_DIR);
  const assets: CatalogAsset[] = [];
  for (const def of ALL_DEFS) {
    if (ctx.only && !ctx.only.includes(def.id)) continue;
    const t0 = Date.now();
    const b = await buildTransport(def, ctx.assetsDir, tex);
    assets.push(b.asset);
    const d = b.asset.dimensions;
    console.log(`  ${def.id.padEnd(26)} LOD ${b.lodTriangles.join(' / ').padEnd(22)} tri · ${(b.lodBytes.reduce((s, x) => s + x, 0) / 1024).toFixed(0).padStart(5)} Ko · ${d.width}×${d.height}×${d.depth} m · ${Date.now() - t0} ms${b.nodes.length > 1 ? ` · nœuds ${b.nodes.join(', ')}` : ''}`);
  }
  return { assets, textureSets: textureSetsFor(tex) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = join(import.meta.dirname, '..', '..');
  const assetsDir = join(root, 'assets');
  const onlyArg = process.argv.find((a) => a.startsWith('--only='));
  const only = onlyArg ? onlyArg.slice(7).split(',') : undefined;
  const out = await generateTransport({ assetsDir, ...(only ? { only } : {}) });
  const fragPath = join(assetsDir, 'catalog.transport.json');
  if (only && existsSync(fragPath)) {
    // mise à jour partielle : on remplace seulement les entrées reconstruites
    const prev = JSON.parse(readFileSync(fragPath, 'utf8')) as { assets: CatalogAsset[]; textureSets: TextureSet[] };
    const ids = new Set(out.assets.map((a) => a.id));
    const order = ALL_DEFS.map((d) => d.id);
    const merged = [...prev.assets.filter((a) => !ids.has(a.id) && order.includes(a.id)), ...out.assets].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    writeFileSync(fragPath, `${JSON.stringify({ assets: merged, textureSets: out.textureSets }, null, 2)}\n`);
  } else writeFileSync(fragPath, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`${out.assets.length} modèles transport -> assets/catalog.transport.json`);
}
