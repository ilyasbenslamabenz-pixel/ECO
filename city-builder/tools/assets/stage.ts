/**
 * Étape Poly Haven du pipeline (`npm run assets`) : textures PBR, HDRI et modèles CC0.
 * Renvoie les entrées de catalogue ; tools/pipeline.ts les fusionne avec celles des générateurs.
 * Variables : POLYHAVEN_OFFLINE=1 -> n'utilise que le cache (échoue si un fichier manque) ;
 *             ASSETS_ONLY=<id,id> -> ne (re)construit que ces modèles (mise au point).
 */
import { existsSync, readdirSync, rmdirSync, statSync, unlinkSync } from 'node:fs';
import { CACHE_DIR } from './polyhaven';
import { join } from 'node:path';
import type { CatalogAsset, HdriEntry, TextureSet } from '../../src/shared/catalog';
import { buildModel, type BuiltModel } from './models';
import { HDRIS, MODELS, TEXTURES } from './selection';
import { buildHdri, buildTextureSet } from './textures';

export interface PolyHavenStageOutput {
  assets: CatalogAsset[];
  textureSets: TextureSet[];
  hdris: HdriEntry[];
  /** Identifiants gérés par cette étape (pour retirer du catalogue ceux qui ont été désélectionnés). */
  ownedIds: Set<string>;
  warnings: string[];
}

export async function runPolyHavenStage(assetsDir: string): Promise<PolyHavenStageOutput> {
  const out: PolyHavenStageOutput = { assets: [], textureSets: [], hdris: [], ownedIds: new Set(), warnings: [] };
  console.log(`Poly Haven : ${TEXTURES.length} jeux de textures, ${HDRIS.length} HDRI, ${MODELS.length} modèles`);
  for (const t of TEXTURES) {
    out.textureSets.push(await buildTextureSet(t, assetsDir));
    out.ownedIds.add(t.id);
  }
  for (const h of HDRIS) {
    out.hdris.push(await buildHdri(h, assetsDir));
    out.ownedIds.add(h.id);
  }
  const only = process.env['ASSETS_ONLY']?.split(',').filter(Boolean);
  for (const m of MODELS) {
    out.ownedIds.add(m.id);
    if (only && !only.includes(m.id)) continue;
    const t0 = Date.now();
    const b: BuiltModel = await buildModel(m, assetsDir);
    const kb = b.report.lodBytes.map((x) => `${Math.round(x / 1024)}K`).join('/');
    console.log(`  ${m.id.padEnd(26)} tri ${b.report.lodTriangles.join('/').padEnd(18)} ${kb.padEnd(16)} ${b.asset.dimensions.width}×${b.asset.dimensions.depth}×${b.asset.dimensions.height} m  ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    for (const w of b.report.warnings) out.warnings.push(`${m.id} : ${w}`);
    out.assets.push(b.asset);
  }
  if (!only) {
    removeOrphans(join(assetsDir, 'models', 'polyhaven'), new Set(out.assets.flatMap((a) => a.lods.map((l) => join(assetsDir, l.file)))));
    removeOrphanTextureSets(assetsDir, new Set(TEXTURES.map((t) => t.id)));
  }
  return out;
}

/**
 * Supprime les dossiers de textures produits par cette étape (repérés par leur tampon d'encodage dans
 * .cache/polyhaven/built/textures) dont le jeu n'est plus sélectionné. Les jeux des générateurs ne sont pas touchés.
 */
function removeOrphanTextureSets(assetsDir: string, selected: Set<string>): void {
  const texDir = join(assetsDir, 'textures');
  const stampDir = join(CACHE_DIR, 'built', 'textures');
  if (!existsSync(texDir) || !existsSync(stampDir)) return;
  const stamps = readdirSync(stampDir);
  for (const id of readdirSync(texDir)) {
    const dir = join(texDir, id);
    if (selected.has(id) || !statSync(dir).isDirectory()) continue;
    if (!stamps.some((s) => s.includes(`_textures_${id}_${id}_`))) continue;
    for (const f of readdirSync(dir)) unlinkSync(join(dir, f));
    rmdirSync(dir);
    console.log(`  suppression du jeu de textures désélectionné ${id}`);
  }
}

/** Supprime les GLB Poly Haven qui ne correspondent plus à aucune entrée (modèle désélectionné ou renommé). */
function removeOrphans(dir: string, keep: Set<string>): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) removeOrphans(p, keep);
    else if (p.endsWith('.glb') && !keep.has(p)) {
      console.log(`  suppression du fichier orphelin ${name}`);
      unlinkSync(p);
    }
  }
}
