/**
 * Écriture GLB (glTF 2.0 binaire) des véhicules, sans dépendance :
 *  - 1 nœud, 1 maillage, 1 primitive par matériau (`peinture`, `atlas`, `verre`) ;
 *  - positions quantifiées int16 normalisées (KHR_mesh_quantization ; échelle + translation sur le nœud),
 *    normales int8 normalisées, UV float32 ; indices uint16/uint32 ;
 *  - textures EXTERNES partagées (URI relative vers assets/vehicles/textures/*.webp, EXT_texture_webp) :
 *    aucun pixel n'est dupliqué dans les GLB ;
 *  - `extras.aube = { role }` sur chaque matériau (le rendu instancié reconnaît la peinture à teinter).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { MATS, type Mat, type VMesh } from './mesh';
import type { VehicleTextureFiles } from './textures';

export interface GlbStats { bytes: number; triangles: number; vertices: number }

export function writeVehicleGlb(mesh: VMesh, tex: VehicleTextureFiles, glbPath: string, assetsDir: string, name: string): GlbStats {
  const { min, max } = mesh.bounds();
  const ctr = [0, 1, 2].map((k) => (min[k]! + max[k]!) / 2);
  const half = (Math.max(...[0, 1, 2].map((k) => (max[k]! - min[k]!) / 2)) || 1) * 1.0001;

  const json = {
    asset: { version: '2.0', generator: 'Aube Urbaine — générateur de véhicules (tools/vehicles)' },
    extensionsUsed: ['EXT_texture_webp', 'KHR_mesh_quantization'],
    extensionsRequired: ['EXT_texture_webp', 'KHR_mesh_quantization'],
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name, translation: ctr, scale: [half, half, half] }],
    meshes: [] as unknown[],
    accessors: [] as unknown[],
    bufferViews: [] as unknown[],
    materials: [] as unknown[],
    images: [] as unknown[],
    textures: [] as unknown[],
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }, { magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }],
    buffers: [] as unknown[],
  };
  const chunks: Buffer[] = [];
  let offset = 0;
  const addView = (buf: Buffer, target?: number): number => {
    const pad = (4 - (offset % 4)) % 4;
    if (pad) { chunks.push(Buffer.alloc(pad)); offset += pad; }
    chunks.push(buf);
    json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: buf.length, ...(target ? { target } : {}) });
    offset += buf.length;
    return json.bufferViews.length - 1;
  };
  const addAccessor = (a: Record<string, unknown>): number => { json.accessors.push(a); return json.accessors.length - 1; };
  const texIndex = new Map<string, number>();
  const tex2 = (file: string, sampler: number): number => {
    const key = `${file}|${sampler}`;
    let i = texIndex.get(key);
    if (i === undefined) {
      const uri = relative(dirname(glbPath), join(assetsDir, file)).split('\\').join('/');
      let img = (json.images as { uri: string }[]).findIndex((im) => im.uri === uri);
      if (img < 0) { json.images.push({ uri, mimeType: 'image/webp', name: file.split('/').pop() }); img = json.images.length - 1; }
      json.textures.push({ sampler, extensions: { EXT_texture_webp: { source: img } } });
      i = json.textures.length - 1;
      texIndex.set(key, i);
    }
    return i;
  };
  const material = (m: Mat): number => {
    if (m === 'peinture') {
      json.materials.push({
        name: 'peinture',
        pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], baseColorTexture: { index: tex2(tex.paint.albedo, 0) }, metallicFactor: 1, roughnessFactor: 1, metallicRoughnessTexture: { index: tex2(tex.paint.arm, 0) } },
        normalTexture: { index: tex2(tex.paint.normal, 0), scale: 0.6 },
        occlusionTexture: { index: tex2(tex.paint.arm, 0) },
        extras: { aube: { role: 'peinture' } },
      });
    } else if (m === 'atlas') {
      json.materials.push({
        name: 'details',
        pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], baseColorTexture: { index: tex2(tex.atlas.albedo, 1) }, metallicFactor: 1, roughnessFactor: 1, metallicRoughnessTexture: { index: tex2(tex.atlas.arm, 1) } },
        normalTexture: { index: tex2(tex.atlas.normal, 1) },
        occlusionTexture: { index: tex2(tex.atlas.arm, 1) },
        emissiveTexture: { index: tex2(tex.atlas.emissive, 1) },
        emissiveFactor: [0.6, 0.6, 0.6],
        extras: { aube: { role: 'details' } },
      });
    } else {
      json.materials.push({
        name: 'verre',
        pbrMetallicRoughness: { baseColorFactor: [0.035, 0.045, 0.055, 1], metallicFactor: 0.1, roughnessFactor: 0.06 },
        extras: { aube: { role: 'verre' } },
      });
    }
    return json.materials.length - 1;
  };

  const primitives: unknown[] = [];
  let triangles = 0, vertices = 0;
  for (const m of MATS) {
    const g = mesh.groups[m];
    const n = g.pos.length / 3;
    if (n === 0 || g.idx.length === 0) continue;
    vertices += n; triangles += g.idx.length / 3;
    // positions int16 normalisées
    const pq = Buffer.alloc(n * 8);
    const pmin = [Infinity, Infinity, Infinity], pmax = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) {
      const q = Math.max(-32767, Math.min(32767, Math.round(((g.pos[i * 3 + k]! - ctr[k]!) / half) * 32767)));
      pq.writeInt16LE(q, i * 8 + k * 2);
      pmin[k] = Math.min(pmin[k]!, q); pmax[k] = Math.max(pmax[k]!, q); // glTF : valeurs entières brutes
    }
    const posAcc = addAccessor({ bufferView: addView(pq, 34962), componentType: 5122, normalized: true, count: n, type: 'VEC3', min: pmin, max: pmax });
    (json.bufferViews[json.bufferViews.length - 1] as Record<string, unknown>)['byteStride'] = 8;
    const nq = Buffer.alloc(n * 4);
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) nq.writeInt8(Math.max(-127, Math.min(127, Math.round(g.nrm[i * 3 + k]! * 127))), i * 4 + k);
    const nrmAcc = addAccessor({ bufferView: addView(nq, 34962), componentType: 5120, normalized: true, count: n, type: 'VEC3' });
    (json.bufferViews[json.bufferViews.length - 1] as Record<string, unknown>)['byteStride'] = 4;
    // UV : uint16 normalisés si toutes dans [0, 1] (atlas), sinon float32 (peinture en mètres)
    const inUnit = g.uv.every((v) => v >= 0 && v <= 1);
    const uvb = inUnit ? Buffer.from(new Uint16Array(g.uv.map((v) => Math.round(v * 65535))).buffer) : Buffer.from(new Float32Array(g.uv).buffer);
    const uvAcc = addAccessor({ bufferView: addView(uvb, 34962), componentType: inUnit ? 5123 : 5126, ...(inUnit ? { normalized: true } : {}), count: n, type: 'VEC2' });
    const big = n > 65535;
    const ib = big ? Buffer.from(new Uint32Array(g.idx).buffer) : Buffer.from(new Uint16Array(g.idx).buffer);
    const idxAcc = addAccessor({ bufferView: addView(ib, 34963), componentType: big ? 5125 : 5123, count: g.idx.length, type: 'SCALAR' });
    primitives.push({ attributes: { POSITION: posAcc, NORMAL: nrmAcc, TEXCOORD_0: uvAcc }, indices: idxAcc, material: material(m), mode: 4 });
  }
  json.meshes.push({ name, primitives });
  const bin = Buffer.concat(chunks);
  const binPad = (4 - (bin.length % 4)) % 4;
  const binBuf = binPad ? Buffer.concat([bin, Buffer.alloc(binPad)]) : bin;
  json.buffers.push({ byteLength: binBuf.length });
  let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  const jpad = (4 - (jsonBuf.length % 4)) % 4;
  if (jpad) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jpad, 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binBuf.length, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(jsonBuf.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(binBuf.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  const out = Buffer.concat([header, jh, jsonBuf, bh, binBuf]);
  mkdirSync(dirname(glbPath), { recursive: true });
  writeFileSync(glbPath, out);
  return { bytes: out.length, triangles, vertices };
}
