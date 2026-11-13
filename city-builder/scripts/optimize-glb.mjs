/**
 * Compression des GLB distribués (appelée par scripts/build.mjs sur dist/assets), dans l'ordre :
 *  1. `prune` + `dedup` (conservateurs : attributs, extras, nœuds vides et noms uniques gardés) ;
 *  2. images INTÉGRÉES plafonnées à 1024 px (512 px pour les LOD1/LOD2), réencodées en WebP seulement si
 *     elles dépassent (cartes de normales en qualité 95) ; les textures partagées (URI) ne sont pas touchées ;
 *  3. EXT_meshopt_compression (+ quantification KHR_mesh_quantization faite par gltf-transform `meshopt()`) ;
 *  4. enveloppe gzip du fichier entier si elle gagne au moins 10 % (JSON + flux meshopt se compressent ~2×) :
 *     même nom de fichier, reconnu côté client par son en-tête (src/render/gzip-assets.ts). Voir docs/COMPRESSION.md.
 * Les sources (assets/**) restent intactes : les tests des modules et le validateur du pipeline les lisent.
 *
 * Point délicat : les bâtiments et véhicules référencent des textures PARTAGÉES par URI relative
 * (../../textures/x.webp). L'écriture GLB de gltf-transform embarquerait chaque image dans chaque fichier ;
 * on écrit donc en JSON (images = URI conservées) puis on assemble nous-mêmes le conteneur GLB avec le
 * seul tampon de données en chunk BIN (le tampon « fallback » meshopt n'a pas de données, conforme à la spec).
 * Les GLB à textures embarquées (Poly Haven, nature) passent par writeBinary.
 *
 * Cache : .cache/glb-opt/<sha1 du source>.glb (une recompression complète prend ~1 min).
 * Côté client : AssetLibrary enregistre MeshoptDecoder et déquantifie les attributs (src/render/assets.ts).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { dedup, meshopt, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const VERSION = 'v2';
/** Côté max des images intégrées : LOD0 (ou sans LOD) / LOD1 et plus. */
const IMAGE_CAP_LOD0 = 1024;
const IMAGE_CAP_LOD = 512;
/** Gain minimal pour garder l'enveloppe gzip (sinon le fichier reste brut : rien à décompresser). */
const GZIP_MIN_GAIN = 0.1;

/** Enveloppe gzip (niveau 9) si elle gagne au moins GZIP_MIN_GAIN ; sinon renvoie le tampon tel quel. */
export function gzipIfWorth(buf) {
  const gz = gzipSync(buf, { level: 9 });
  return gz.byteLength <= buf.byteLength * (1 - GZIP_MIN_GAIN) ? gz : buf;
}

/** Plafonne les images intégrées (côté max `cap`), réencodage WebP uniquement pour celles qui dépassent. */
async function capEmbeddedImages(doc, cap) {
  const root = doc.getRoot();
  const normals = new Set(root.listMaterials().map((m) => m.getNormalTexture()).filter(Boolean));
  let changed = 0;
  for (const tex of root.listTextures()) {
    const img = tex.getImage();
    if (!img || (tex.getURI() && !tex.getURI().startsWith('data:') && tex.getURI().includes('/'))) continue;
    const meta = await sharp(img).metadata();
    if (!meta.width || !meta.height || Math.max(meta.width, meta.height) <= cap) continue;
    const isNormal = normals.has(tex);
    const out = await sharp(img)
      .resize(cap, cap, { fit: 'inside', kernel: 'lanczos3', withoutEnlargement: true })
      .webp(isNormal ? { quality: 95, alphaQuality: 100, effort: 6 } : { quality: 90, alphaQuality: 100, effort: 6 })
      .toBuffer();
    tex.setImage(new Uint8Array(out)).setMimeType('image/webp');
    if (tex.getURI()) tex.setURI(tex.getURI().replace(/\.(png|jpe?g)$/i, '.webp'));
    changed++;
  }
  if (changed) doc.createExtension(EXTTextureWebP);
  return changed;
}

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.glb')) out.push(p);
  }
  return out;
}

function pad4(buf, fill) {
  const r = buf.byteLength % 4;
  if (!r) return buf;
  return Buffer.concat([buf, Buffer.alloc(4 - r, fill)]);
}

/** Assemble un GLB à partir d'un JSON glTF et d'un tampon binaire (chunk BIN). */
function packGlb(json, bin) {
  const j = pad4(Buffer.from(JSON.stringify(json), 'utf8'), 0x20);
  const b = pad4(Buffer.from(bin), 0);
  const total = 12 + 8 + j.byteLength + 8 + b.byteLength;
  const h = Buffer.alloc(12);
  h.writeUInt32LE(0x46546c67, 0); h.writeUInt32LE(2, 4); h.writeUInt32LE(total, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(j.byteLength, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(b.byteLength, 0); bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([h, jh, j, bh, b]);
}

async function compressOne(io, path) {
  const doc = await io.read(path);
  const textures = doc.getRoot().listTextures();
  const external = textures.some((t) => !!t.getURI() && !t.getURI().startsWith('data:') && t.getURI().includes('/'));
  await doc.transform(
    prune({ keepAttributes: true, keepIndices: true, keepLeaves: true, keepSolidTextures: true, keepExtras: true }),
    dedup({ keepUniqueNames: true }),
  );
  const lod = Number(/_lod(\d+)\.glb$/.exec(path)?.[1] ?? 0);
  if (!external) await capEmbeddedImages(doc, lod > 0 ? IMAGE_CAP_LOD : IMAGE_CAP_LOD0);
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  if (!external) return Buffer.from(await io.writeBinary(doc));
  const { json, resources } = await io.writeJSON(doc, { format: 'GLTF' });
  const dataIdx = json.buffers.findIndex((b) => b.uri && resources[b.uri]);
  if (dataIdx < 0) throw new Error('aucun tampon de données');
  const others = json.buffers.filter((b, i) => i !== dataIdx && b.uri && resources[b.uri]);
  if (others.length) throw new Error('plusieurs tampons de données');
  const bin = resources[json.buffers[dataIdx].uri];
  // Le tampon de données devient le tampon 0 (chunk BIN) ; renumérotation des bufferViews.
  if (dataIdx !== 0) {
    const order = [dataIdx, ...json.buffers.map((_, i) => i).filter((i) => i !== dataIdx)];
    const remap = new Map(order.map((old, neu) => [old, neu]));
    json.buffers = order.map((i) => json.buffers[i]);
    for (const bv of json.bufferViews ?? []) {
      bv.buffer = remap.get(bv.buffer);
      const ext = bv.extensions?.EXT_meshopt_compression;
      if (ext) ext.buffer = remap.get(ext.buffer);
    }
  }
  delete json.buffers[0].uri;
  json.buffers[0].byteLength = bin.byteLength;
  // Images : URI relatives conservées (textures partagées, jamais dupliquées).
  for (const img of json.images ?? []) if (!img.uri) throw new Error('image sans URI dans un GLB à textures externes');
  return packGlb(json, bin);
}

/**
 * Compresse tous les GLB d'un dossier en place. Renvoie { files, before, after }.
 * @param {string} dir dossier (dist/assets)
 * @param {string} cacheDir dossier de cache
 */
export async function optimizeGlbDir(dir, cacheDir) {
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  mkdirSync(cacheDir, { recursive: true });
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
  io.setLogger({ debug() {}, info() {}, warn() {}, error(m) { console.error(m); } });
  let before = 0;
  let after = 0;
  let fresh = 0;
  const files = walk(dir);
  for (const f of files) {
    const src = readFileSync(f);
    before += src.byteLength;
    const key = createHash('sha1').update(VERSION).update(src).digest('hex');
    const cached = join(cacheDir, `${key}.glb`);
    let out;
    if (existsSync(cached)) out = readFileSync(cached);
    else {
      try {
        out = await compressOne(io, f);
        // Ne garde la version compressée que si elle est plus petite.
        if (out.byteLength >= src.byteLength) out = src;
        out = gzipIfWorth(out);
      } catch (e) {
        console.warn(`optimize-glb : ${f} laissé tel quel (${e instanceof Error ? e.message : e})`);
        out = src;
      }
      writeFileSync(cached, out);
      fresh++;
    }
    writeFileSync(f, out);
    after += out.byteLength;
  }
  return { files: files.length, fresh, before, after };
}

/**
 * Enveloppe gzip des fichiers d'un dossier dont l'extension est listée (HDRI .hdr), en place, même nom.
 * Renvoie { files, before, after }.
 */
export function gzipFilesIn(dir, exts) {
  const out = { files: 0, before: 0, after: 0 };
  const rec = (d) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) { rec(p); continue; }
      if (!exts.some((e) => p.endsWith(e))) continue;
      const src = readFileSync(p);
      const res = gzipIfWorth(src);
      if (res !== src) writeFileSync(p, res);
      out.files++; out.before += src.byteLength; out.after += res.byteLength;
    }
  };
  rec(dir);
  return out;
}
