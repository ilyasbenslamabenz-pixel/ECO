/**
 * Validateur du pipeline d'assets (npx tsx tools/assets/validate.ts ; appelé aussi en fin de `npm run assets`).
 * Pour CHAQUE entrée du catalogue (Poly Haven et générateurs) :
 *  - fichiers présents, tailles (≤ 15 Mo bloquant, > 4 Mo signalé) ;
 *  - triangles mesurés par LOD : LOD0 ≥ seuil de la catégorie, LOD strictement décroissants, valeur du catalogue exacte ;
 *  - bornes et échelle : boîte englobante (transformations de nœuds comprises) = dimensions du catalogue (±25 %),
 *    origine au centre de l'empreinte, base au sol, dimensions plausibles en mètres pour la catégorie,
 *    empreinte en cases cohérente pour les bâtiments ;
 *  - matériaux PBR texturés (baseColor + normal) et textures décodables (dimensions valides) ;
 *  - licence : SPDX autorisé, source exacte (page Poly Haven ou générateur du projet), auteur, ligne dans LICENSES.md.
 * Jeux de textures et HDRI : fichiers présents et décodables, licence. Budget disque des assets.
 * Code de sortie 1 en cas d'erreur.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';
import sharp from 'sharp';
import { MIN_TRIANGLES_LOD0, isBuildingCategory, type AssetCatalog, type AssetCategory, type AssetLicense } from '../../src/shared/catalog';
import { TILE_SIZE } from '../../src/shared/constants';

const root = join(import.meta.dirname, '..', '..');
const assetsDir = join(root, 'assets');
const MB = 1024 * 1024;
const FILE_LIMIT = 15 * MB;
const FILE_WARN = 4 * MB;
/**
 * Budget des assets SOURCES (non compressés). Le budget distribué réel (dist ≤ 60 Mo) est contrôlé par
 * scripts/build.mjs APRÈS compression EXT_meshopt_compression des GLB (scripts/optimize-glb.mjs) :
 * ici on borne seulement la croissance des sources (intégration).
 */
const ASSETS_BUDGET = 75 * MB;
/** Budget de la part Poly Haven (exigence de l'étape pipeline). */
/** Part Poly Haven des sources (les GLB sont ensuite compressés meshopt dans dist). */
const POLYHAVEN_BUDGET = 40 * MB;

/** Plages plausibles (m) : [hauteur min, hauteur max, plus grande dimension horizontale max]. */
const PLAUSIBLE: Record<AssetCategory, [number, number, number]> = {
  house: [3, 20, 40], townhouse: [5, 25, 40], apartment_low: [6, 25, 80], apartment_mid: [12, 45, 100],
  apartment_high: [25, 120, 120], skyscraper: [60, 450, 120], commercial: [3, 60, 150], industrial: [4, 60, 200],
  public: [4, 80, 200], vehicle: [1, 5, 20], tree: [1.5, 40, 30], vegetation: [0.1, 8, 12],
  street_furniture: [0.05, 15, 15], prop: [0.05, 10, 15],
};

const errors: string[] = [];
const warnings: string[] = [];
const err = (id: string, m: string): void => { errors.push(`${id} : ${m}`); };
const warn = (id: string, m: string): void => { warnings.push(`${id} : ${m}`); };

function checkLicense(id: string, lic: AssetLicense | undefined, licensesMd: string): void {
  if (!lic) { err(id, 'licence absente'); return; }
  if (lic.spdx !== 'CC0-1.0') err(id, `licence ${lic.spdx} non autorisée (CC0-1.0 attendu)`);
  if (!lic.author) err(id, 'auteur absent');
  const ph = /^https:\/\/polyhaven\.com\/a\/[A-Za-z0-9_-]+$/.test(lic.source);
  const gen = /^tools\/(generators|buildings|vehicles)\//.test(lic.source);
  if (!ph && !gen) err(id, `source non autorisée ou imprécise : « ${lic.source} »`);
  if (!licensesMd.includes(`\`${id}\``)) err(id, 'absent de assets/LICENSES.md');
}

async function checkImage(id: string, rel: string, maxSide = 2048): Promise<number> {
  const p = join(assetsDir, rel);
  if (!existsSync(p)) { err(id, `fichier manquant ${rel}`); return 0; }
  const size = statSync(p).size;
  try {
    const m = await sharp(p).metadata();
    if (!m.width || !m.height || m.width < 4 || m.height < 4) err(id, `${rel} : dimensions invalides ${m.width}x${m.height}`);
    else if (m.width > maxSide || m.height > maxSide) err(id, `${rel} : ${m.width}x${m.height} > ${maxSide}`);
  } catch (e) {
    err(id, `${rel} : image non décodable (${e instanceof Error ? e.message : String(e)})`);
  }
  return size;
}

function dirSize(dir: string, filter: (p: string) => boolean): number {
  let s = 0;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) s += dirSize(p, filter);
    else if (filter(p)) s += st.size;
  }
  return s;
}

async function main(): Promise<void> {
  const cat = JSON.parse(readFileSync(join(assetsDir, 'catalog.json'), 'utf8')) as AssetCatalog;
  const licensesMd = existsSync(join(assetsDir, 'LICENSES.md')) ? readFileSync(join(assetsDir, 'LICENSES.md'), 'utf8') : '';
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  let phBytes = 0;
  console.log(`${'asset'.padEnd(28)} ${'catégorie'.padEnd(16)} ${'triangles LOD0/1/2'.padEnd(22)} ${'dimensions (m)'.padEnd(20)} Ko`);
  for (const a of cat.assets) {
    const n0 = errors.length;
    checkLicense(a.id, a.license, licensesMd);
    const isPh = a.license?.source.startsWith('https://polyhaven.com/') ?? false;
    const tris: number[] = [];
    let bytes = 0;
    for (const [i, l] of a.lods.entries()) {
      const p = join(assetsDir, l.file);
      if (!existsSync(p)) { err(a.id, `LOD${i} manquant : ${l.file}`); continue; }
      const size = statSync(p).size;
      bytes += size;
      if (size > FILE_LIMIT) err(a.id, `${l.file} : ${(size / MB).toFixed(1)} Mo > 15 Mo`);
      else if (size > FILE_WARN) warn(a.id, `${l.file} : ${(size / MB).toFixed(1)} Mo (lourd)`);
      const doc = await io.read(p);
      const r = doc.getRoot();
      let t = 0;
      for (const m of r.listMeshes()) for (const pr of m.listPrimitives()) {
        if (pr.getMode() !== 4) continue;
        const idx = pr.getIndices();
        t += (idx ? idx.getCount() : (pr.getAttribute('POSITION')?.getCount() ?? 0)) / 3;
      }
      tris.push(t);
      if (l.triangles !== undefined && l.triangles !== t) err(a.id, `LOD${i} : catalogue ${l.triangles} triangles ≠ mesuré ${t}`);
      if (i === 0) {
        if (t < MIN_TRIANGLES_LOD0[a.category]) err(a.id, `LOD0 : ${t} triangles < seuil ${MIN_TRIANGLES_LOD0[a.category]} (${a.category})`);
        const mats = r.listMaterials();
        if (!mats.some((m) => m.getBaseColorTexture() && m.getNormalTexture())) err(a.id, 'aucun matériau PBR avec baseColor + normal');
        for (const tex of r.listTextures()) {
          const s = tex.getSize();
          if (!s || s[0] < 4 || s[1] < 4) err(a.id, `texture ${tex.getName()} : taille invalide`);
          const img = tex.getImage();
          if (img) {
            try { await sharp(Buffer.from(img)).metadata(); } catch { err(a.id, `texture ${tex.getName()} non décodable`); }
          }
        }
        const scene = r.getDefaultScene() ?? r.listScenes()[0];
        if (!scene) { err(a.id, 'aucune scène'); continue; }
        const b = getBounds(scene);
        const w = b.max[0] - b.min[0];
        const h = b.max[1] - b.min[1];
        const d = b.max[2] - b.min[2];
        const within = (m: number, c: number): boolean => Math.abs(m - c) <= 0.25 * Math.max(c, 0.05);
        if (!within(w, a.dimensions.width) || !within(d, a.dimensions.depth) || !within(h, a.dimensions.height)) {
          err(a.id, `boîte mesurée ${w.toFixed(2)}×${d.toFixed(2)}×${h.toFixed(2)} ≠ catalogue ${a.dimensions.width}×${a.dimensions.depth}×${a.dimensions.height} (±25 %)`);
        }
        const cx = (b.min[0] + b.max[0]) / 2;
        const cz = (b.min[2] + b.max[2]) / 2;
        if (Math.abs(cx) > 0.1 * w + 0.05 || Math.abs(cz) > 0.1 * d + 0.05) err(a.id, `origine décentrée (centre ${cx.toFixed(2)}, ${cz.toFixed(2)})`);
        if (b.min[1] > 0.25) err(a.id, `objet flottant : base à y = ${b.min[1].toFixed(2)} m`);
        if (b.min[1] < -3) err(a.id, `base trop enterrée : y = ${b.min[1].toFixed(2)} m`);
        const [hMin, hMax, horizMax] = PLAUSIBLE[a.category];
        if (h < hMin || h > hMax) err(a.id, `hauteur ${h.toFixed(2)} m hors plage plausible [${hMin}, ${hMax}] pour ${a.category}`);
        if (Math.max(w, d) > horizMax) err(a.id, `emprise ${Math.max(w, d).toFixed(1)} m > ${horizMax} m plausible pour ${a.category}`);
        if (isBuildingCategory(a.category)) {
          if (w > a.footprint.tilesX * TILE_SIZE + 0.5 || d > a.footprint.tilesZ * TILE_SIZE + 0.5) {
            err(a.id, `bâtiment ${w.toFixed(1)}×${d.toFixed(1)} m dépasse son empreinte ${a.footprint.tilesX}×${a.footprint.tilesZ} cases`);
          }
          if (a.variants.length < 1) err(a.id, 'aucune variante');
        }
        if (a.category === 'vehicle' && a.vehicle && Math.abs(Math.max(w, d) - a.vehicle.lengthM) > 0.25 * a.vehicle.lengthM) {
          err(a.id, `longueur mesurée ${Math.max(w, d).toFixed(2)} m ≠ vehicle.lengthM ${a.vehicle.lengthM}`);
        }
      }
    }
    for (let i = 1; i < tris.length; i++) if (!(tris[i]! < tris[i - 1]!)) err(a.id, `LOD${i} (${tris[i]}) n'est pas moins détaillé que LOD${i - 1} (${tris[i - 1]})`);
    if (isPh) phBytes += bytes;
    const dim = `${a.dimensions.width}×${a.dimensions.depth}×${a.dimensions.height}`;
    console.log(`${errors.length > n0 ? 'ÉCHEC' : 'OK   '} ${a.id.padEnd(22)} ${a.category.padEnd(16)} ${tris.join('/').padEnd(22)} ${dim.padEnd(20)} ${Math.round(bytes / 1024)}`);
  }
  for (const t of cat.textureSets) {
    checkLicense(t.id, t.license, licensesMd);
    if (!(t.tileSizeM > 0)) err(t.id, 'tileSizeM invalide');
    let bytes = 0;
    for (const f of [t.albedo, t.normal, t.arm, t.roughness, t.metalness, t.ao]) if (f) bytes += await checkImage(t.id, f);
    if (t.license?.source.startsWith('https://polyhaven.com/')) phBytes += bytes;
  }
  for (const h of cat.hdris) {
    checkLicense(h.id, h.license, licensesMd);
    const p = join(assetsDir, h.file);
    if (!existsSync(p)) { err(h.id, `HDRI manquant ${h.file}`); continue; }
    const head = readFileSync(p).subarray(0, 10).toString('latin1');
    if (!head.startsWith('#?RADIANCE') && !head.startsWith('#?RGBE')) err(h.id, `${h.file} n'est pas un fichier Radiance .hdr`);
    if (h.license?.source.startsWith('https://polyhaven.com/')) phBytes += statSync(p).size;
  }
  const total = dirSize(assetsDir, (p) => !p.endsWith('.md') && !/[\\/]_src[\\/]/.test(p));
  console.log(`\nTextures : ${cat.textureSets.length} jeux · HDRI : ${cat.hdris.length} · Modèles : ${cat.assets.length}`);
  console.log(`Poids : assets distribués ${(total / MB).toFixed(1)} Mo (budget ${ASSETS_BUDGET / MB}) · part Poly Haven ${(phBytes / MB).toFixed(1)} Mo (budget ${POLYHAVEN_BUDGET / MB})`);
  if (total > ASSETS_BUDGET) err('*', `assets ${(total / MB).toFixed(1)} Mo > budget ${ASSETS_BUDGET / MB} Mo`);
  if (phBytes > POLYHAVEN_BUDGET) err('*', `part Poly Haven ${(phBytes / MB).toFixed(1)} Mo > budget ${POLYHAVEN_BUDGET / MB} Mo`);
  if (warnings.length) console.log(`\nAvertissements (${warnings.length}) :\n - ${warnings.join('\n - ')}`);
  if (errors.length) {
    console.error(`\nValidation du pipeline : ÉCHEC (${errors.length})\n - ${errors.join('\n - ')}`);
    process.exit(1);
  }
  console.log('\nValidation du pipeline : OK');
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
