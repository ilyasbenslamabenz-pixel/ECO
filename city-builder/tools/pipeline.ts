/**
 * Pipeline d'assets (npm run assets) :
 *  0. étape Poly Haven (tools/assets/stage.ts) : textures PBR, HDRI, modèles CC0 téléchargés (cache .cache/polyhaven)
 *     et optimisés ; les entrées Poly Haven désélectionnées sont retirées du catalogue ;
 *  1. exécute les générateurs enregistrés (tools/generators) -> GLB dans assets/models ;
 *  2. fusionne leurs entrées dans assets/catalog.json (les entrées manuelles/Poly Haven sont conservées) ;
 *  3. valide le catalogue (structure, licences), vérifie l'existence de chaque fichier référencé ;
 *  4. mesure les triangles de chaque LOD (gltf-transform) et les inscrit dans le catalogue.
 *  5. régénère assets/LICENSES.md depuis le catalogue puis lance le validateur tools/assets/validate.ts.
 * Code de sortie 1 en cas de problème.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateCatalog, type AssetCatalog } from '../src/shared/catalog';
import { GENERATORS } from './generators/index';
import { inspectGlb } from './lib/glb-inspect';
import { spawnSync } from 'node:child_process';
import { runPolyHavenStage } from './assets/stage';
import { writeLicenses } from './assets/licenses';

const root = join(import.meta.dirname, '..');
const assetsDir = join(root, 'assets');
const catalogPath = join(assetsDir, 'catalog.json');

async function main(): Promise<void> {
  const cat = JSON.parse(readFileSync(catalogPath, 'utf8')) as AssetCatalog;
  if (process.env['SKIP_POLYHAVEN'] !== '1') {
    const ph = await runPolyHavenStage(assetsDir);
    const isPh = (src: string | undefined): boolean => !!src?.startsWith('https://polyhaven.com/');
    const only = !!process.env['ASSETS_ONLY'];
    // Retire les entrées Poly Haven qui ne sont plus sélectionnées.
    if (!only) {
      cat.assets = cat.assets.filter((a) => !isPh(a.license?.source) || ph.ownedIds.has(a.id));
      cat.textureSets = cat.textureSets.filter((t) => !isPh(t.license?.source) || ph.ownedIds.has(t.id));
      cat.hdris = cat.hdris.filter((h) => !isPh(h.license?.source) || ph.ownedIds.has(h.id));
    }
    const upsert = <T extends { id: string }>(list: T[], items: T[]): void => {
      for (const it of items) {
        const i = list.findIndex((x) => x.id === it.id);
        if (i >= 0) list[i] = it; else list.push(it);
      }
    };
    upsert(cat.assets, ph.assets);
    upsert(cat.textureSets, ph.textureSets);
    upsert(cat.hdris, ph.hdris);
    for (const w of ph.warnings) console.warn(`AVERTISSEMENT ${w}`);
  }
  for (const g of GENERATORS) {
    console.log(`Générateur : ${g.name}`);
    const out = await g.run({ assetsDir });
    for (const a of out.assets) {
      const i = cat.assets.findIndex((x) => x.id === a.id);
      if (i >= 0) cat.assets[i] = a; else cat.assets.push(a);
    }
    for (const t of out.textureSets) {
      const i = cat.textureSets.findIndex((x) => x.id === t.id);
      if (i >= 0) cat.textureSets[i] = t; else cat.textureSets.push(t);
    }
  }
  const problems: string[] = validateCatalog(cat).map((i) => `${i.assetId} : ${i.message}`);
  const mustExist = (rel: string, owner: string): void => { if (!existsSync(join(assetsDir, rel))) problems.push(`${owner} : fichier manquant ${rel}`); };
  for (const t of cat.textureSets) for (const f of [t.albedo, t.normal, t.roughness, t.metalness, t.ao, t.arm]) if (f) mustExist(f, t.id);
  for (const h of cat.hdris) mustExist(h.file, h.id);
  for (const a of cat.assets) {
    for (const l of a.lods) {
      mustExist(l.file, a.id);
      if (existsSync(join(assetsDir, l.file))) l.triangles = (await inspectGlb(join(assetsDir, l.file))).triangles;
    }
  }
  cat.generatedAt = new Date().toISOString();
  writeFileSync(catalogPath, `${JSON.stringify(cat, null, 2)}\n`);
  writeLicenses(cat, assetsDir);
  console.log(`Catalogue : ${cat.assets.length} assets, ${cat.textureSets.length} jeux de textures, ${cat.hdris.length} HDRI.`);
  if (problems.length) {
    console.error(`${problems.length} problème(s) :\n - ${problems.join('\n - ')}`);
    process.exit(1);
  }
  const v = spawnSync(process.execPath, [...process.execArgv, join(root, 'tools/assets/validate.ts')], { stdio: 'inherit' });
  if (v.status !== 0) process.exit(1);
  console.log('Pipeline OK');
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
