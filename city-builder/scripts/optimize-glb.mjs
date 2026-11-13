/**
 * Compression des GLB distribués (appelée par scripts/build.mjs sur dist/assets) :
 * EXT_meshopt_compression (+ quantification KHR_mesh_quantization faite par gltf-transform `meshopt()`).
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
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const VERSION = 'v1';

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
