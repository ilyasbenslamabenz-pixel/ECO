/**
 * Validateur des assets transport (fragment `assets/catalog.transport.json`), mêmes contrôles que
 * tools/validate-models.ts + tools/assets/validate.ts, avec les plages de la catégorie `transport` demandée :
 *   npx tsx tools/transport/validate.ts
 *  - structure (validateCatalog), licence CC0 + source `tools/transport/…` + auteur ;
 *  - 3 LOD présents, lisibles, triangles strictement décroissants et égaux au catalogue, LOD0 ≥ seuil ;
 *  - au moins un matériau baseColor + normal ; textures externes présentes et décodables (sharp) ;
 *  - boîte englobante (transformations comprises) = dimensions (±25 %), emprise centrée en (0,0),
 *    base au sol (origine « sol ») ou plage de la convention déclarée (flottaison / niveau) ;
 *  - plages plausibles (hauteur 0,05–90 m, emprise ≤ 260 m), bâtiments contenus dans leur empreinte en cases.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/core';
import sharp from 'sharp';
import { MIN_TRIANGLES_LOD0, isBuildingCategory, validateCatalog, type AssetCatalog, type CatalogAsset, type TextureSet } from '../../src/shared/catalog';
import { CATALOG_SCHEMA_VERSION, TILE_SIZE } from '../../src/shared/constants';

export interface TransportReport { errors: string[]; rows: { id: string; tris: number[]; kb: number[]; dims: string }[] }

const root = join(import.meta.dirname, '..', '..');

export async function validateTransport(assetsDir = join(root, 'assets')): Promise<TransportReport> {
  const frag = JSON.parse(readFileSync(join(assetsDir, 'catalog.transport.json'), 'utf8')) as { assets: CatalogAsset[]; textureSets: TextureSet[] };
  const main = JSON.parse(readFileSync(join(assetsDir, 'catalog.json'), 'utf8')) as AssetCatalog;
  const errors: string[] = [];
  const err = (id: string, m: string): void => { errors.push(`${id} : ${m}`); };
  const cat: AssetCatalog = { schemaVersion: CATALOG_SCHEMA_VERSION, generatedAt: '', assets: frag.assets, textureSets: [...main.textureSets.filter((t) => !frag.textureSets.some((f) => f.id === t.id)), ...frag.textureSets], hdris: [] };
  for (const i of validateCatalog(cat)) err(i.assetId, i.message);
  for (const t of frag.textureSets) for (const f of [t.albedo, t.normal, t.arm!]) {
    try { const m = await sharp(join(assetsDir, f)).metadata(); if (!m.width || m.width < 4) err(t.id, `texture invalide ${f}`); } catch { err(t.id, `texture illisible ${f}`); }
  }
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const rows: TransportReport['rows'] = [];
  const checkedImg = new Set<string>();
  for (const a of frag.assets) {
    if (a.license.spdx !== 'CC0-1.0' || !/^tools\/transport\//.test(a.license.source) || !a.license.author) err(a.id, 'licence/source/auteur non conformes');
    // Assets branchés au jeu par le module hubs (phase 2C) : tag `unused` retiré, catégorie `transport`.
    if (a.tags.includes('unused')) err(a.id, 'tag « unused » présent alors que l\'asset est branché (module hubs)');
    if (a.category !== 'transport') err(a.id, `catégorie ${a.category} (transport attendue)`);
    if (a.lods.length !== 3) err(a.id, `${a.lods.length} LOD (3 attendus)`);
    const tris: number[] = [], kb: number[] = [];
    let bbox: { min: number[]; max: number[] } | null = null;
    for (const [k, l] of a.lods.entries()) {
      const p = join(assetsDir, l.file);
      if (!existsSync(p)) { err(a.id, `${l.file} manquant`); continue; }
      kb.push(Math.round(statSync(p).size / 1024));
      const doc = await io.read(p);
      const r = doc.getRoot();
      let t = 0;
      for (const m of r.listMeshes()) for (const pr of m.listPrimitives()) t += (pr.getIndices()?.getCount() ?? 0) / 3;
      tris.push(t);
      if (l.triangles !== t) err(a.id, `LOD${k} : ${t} triangles ≠ catalogue ${l.triangles}`);
      if (k === 0) {
        bbox = getBounds(r.getDefaultScene()!);
        if (!r.listMaterials().some((m) => m.getBaseColorTexture() && m.getNormalTexture())) err(a.id, 'aucun matériau baseColor + normal');
        for (const tx of r.listTextures()) {
          const uri = join(dirname(p), tx.getURI());
          if (checkedImg.has(uri)) continue;
          checkedImg.add(uri);
          if (!existsSync(uri)) err(a.id, `texture externe absente ${tx.getURI()}`);
        }
      }
    }
    if (tris[0]! < MIN_TRIANGLES_LOD0[a.category]) err(a.id, `LOD0 : ${tris[0]} triangles < seuil ${MIN_TRIANGLES_LOD0[a.category]}`);
    for (let k = 1; k < tris.length; k++) if (!(tris[k]! < tris[k - 1]!)) err(a.id, `LOD${k} non décroissant`);
    if (bbox) {
      const [w, h, d] = [0, 1, 2].map((k) => bbox!.max[k]! - bbox!.min[k]!) as [number, number, number];
      const dm = a.dimensions;
      for (const [n, mes, cat2] of [['largeur', w, dm.width], ['hauteur', h, dm.height], ['profondeur', d, dm.depth]] as [string, number, number][]) {
        if (Math.abs(mes - cat2) > 0.25 * cat2) err(a.id, `${n} mesurée ${mes.toFixed(2)} ≠ catalogue ${cat2}`);
      }
      const cx = (bbox.min[0]! + bbox.max[0]!) / 2, cz = (bbox.min[2]! + bbox.max[2]!) / 2;
      if (Math.abs(cx) > 0.05 * w + 0.05 || Math.abs(cz) > 0.05 * d + 0.05) err(a.id, `emprise non centrée (${cx.toFixed(2)}, ${cz.toFixed(2)})`);
      const y0 = bbox.min[1]!;
      if (a.tags.includes('origine:flottaison')) {
        const draft = Number(a.tags.find((t) => t.startsWith('tirant_eau:'))?.split(':')[1] ?? 0);
        if (Math.abs(-y0 - draft) > 0.6) err(a.id, `quille à ${y0.toFixed(2)} m ≠ −tirant d'eau ${draft}`);
      } else if (a.tags.includes('niveau:quai_y0') || a.tags.includes('niveau:sol_y0')) {
        if (y0 < -3.05 || y0 > 0.01) err(a.id, `base ${y0.toFixed(2)} hors [−3, 0] (niveau fini y = 0)`);
      } else if (Math.abs(y0) > 0.05) err(a.id, `base à ${y0.toFixed(2)} m (attendu 0)`);
      if (h < 0.05 || h > 90) err(a.id, `hauteur ${h.toFixed(1)} m hors [0,05 ; 90]`);
      if (Math.max(w, d) > 260) err(a.id, `emprise ${Math.max(w, d).toFixed(1)} m > 260`);
      if (isBuildingCategory(a.category) && (w > a.footprint.tilesX * TILE_SIZE + 0.5 || d > a.footprint.tilesZ * TILE_SIZE + 0.5)) err(a.id, `bâtiment ${w.toFixed(1)}×${d.toFixed(1)} m > empreinte ${a.footprint.tilesX}×${a.footprint.tilesZ} cases`);
      if (a.vehicle && Math.abs(Math.max(w, d) - a.vehicle.lengthM) > 0.25 * a.vehicle.lengthM) err(a.id, 'longueur véhicule ≠ vehicle.lengthM');
      rows.push({ id: a.id, tris, kb, dims: `${w.toFixed(1)}×${h.toFixed(1)}×${d.toFixed(1)}` });
    }
  }
  return { errors, rows };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await validateTransport();
  for (const row of r.rows) console.log(`${r.errors.some((e) => e.startsWith(row.id + ' ')) ? 'ÉCHEC' : 'OK   '} ${row.id.padEnd(28)} ${row.tris.join('/').padEnd(20)} ${row.dims.padEnd(18)} ${row.kb.join('/')} Ko`);
  if (r.errors.length) { console.error(`\nValidation transport : ÉCHEC (${r.errors.length})\n - ${r.errors.join('\n - ')}`); process.exit(1); }
  console.log(`\nValidation transport : OK (${r.rows.length} modèles)`);
}
