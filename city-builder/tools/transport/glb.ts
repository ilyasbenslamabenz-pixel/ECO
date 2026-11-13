/**
 * Écriture GLB (glTF 2.0 binaire) des assets transport, sans dépendance :
 *  - nœud racine `structure` SANS transformation (géométrie au repère du modèle, origine au sol au centre) ;
 *  - nœuds enfants animables (chariot, flèche, palonnier, tourelle, tunnel…) : translation = pivot,
 *    `extras.aube.anim = { kind, axis, min, max, note }` ;
 *  - 1 primitive par matériau ; positions float32 (boîte englobante lisible sans transformation),
 *    normales int8 normalisées (KHR_mesh_quantization, déjà utilisé par les véhicules), UV float32 ;
 *  - textures EXTERNES partagées (URI relatives, EXT_texture_webp) : aucun pixel dans les GLB ;
 *  - `extras.aube.role` sur chaque matériau.
 * La compression meshopt est appliquée à la distribution par scripts/optimize-glb.mjs (comme tous les GLB du jeu).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { MAT, MAT_KEYS, type MatKey, type TexSetId } from './materials';
import type { TModel } from './mesh';
import type { TransportTextureFiles } from './textures';

export interface GlbStats { bytes: number; triangles: number; vertices: number }

/** Fichiers (relatifs à assets/) d'un jeu de textures. */
export function texFiles(set: TexSetId, tex: TransportTextureFiles): { albedo: string; normal: string; arm: string; emissive?: string } {
  if (set === 'transport_atlas') return tex.atlas;
  if (set === 'transport_peinture') return tex.peinture;
  if (set === 'transport_tole') return tex.tole;
  return { albedo: `textures/${set}/${set}_albedo.webp`, normal: `textures/${set}/${set}_normal.webp`, arm: `textures/${set}/${set}_arm.webp` };
}

const lin = (h: string): number[] => {
  const v = parseInt(h.replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => { const s = c / 255; return +(s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4).toFixed(4); });
};

export function writeModelGlb(model: TModel, tex: TransportTextureFiles, glbPath: string, assetsDir: string, name: string): GlbStats {
  const json = {
    asset: { version: '2.0', generator: 'Aube Urbaine — générateur transport (tools/transport)' },
    extensionsUsed: ['EXT_texture_webp', 'KHR_mesh_quantization'],
    extensionsRequired: ['EXT_texture_webp', 'KHR_mesh_quantization'],
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [] as Record<string, unknown>[],
    meshes: [] as unknown[],
    accessors: [] as unknown[],
    bufferViews: [] as Record<string, unknown>[],
    materials: [] as unknown[],
    images: [] as { uri: string }[],
    textures: [] as unknown[],
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }, { magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }],
    buffers: [] as unknown[],
  };
  const chunks: Buffer[] = [];
  let offset = 0;
  const addView = (buf: Buffer, target?: number, stride?: number): number => {
    const pad = (4 - (offset % 4)) % 4;
    if (pad) { chunks.push(Buffer.alloc(pad)); offset += pad; }
    chunks.push(buf);
    json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: buf.length, ...(target ? { target } : {}), ...(stride ? { byteStride: stride } : {}) });
    offset += buf.length;
    return json.bufferViews.length - 1;
  };
  const addAccessor = (a: Record<string, unknown>): number => { json.accessors.push(a); return json.accessors.length - 1; };
  const texIndex = new Map<string, number>();
  const texture = (file: string, sampler: number): number => {
    const key = `${file}|${sampler}`;
    let i = texIndex.get(key);
    if (i === undefined) {
      const uri = relative(dirname(glbPath), join(assetsDir, file)).split('\\').join('/');
      let img = json.images.findIndex((im) => im.uri === uri);
      if (img < 0) { json.images.push({ uri, mimeType: 'image/webp', name: file.split('/').pop() } as { uri: string }); img = json.images.length - 1; }
      json.textures.push({ sampler, extensions: { EXT_texture_webp: { source: img } } });
      i = json.textures.length - 1;
      texIndex.set(key, i);
    }
    return i;
  };
  const matIndex = new Map<MatKey, number>();
  const material = (k: MatKey): number => {
    let i = matIndex.get(k);
    if (i !== undefined) return i;
    const d = MAT[k];
    const [r, g, b] = lin(d.color);
    const m: Record<string, unknown> = { name: k, extras: { aube: { role: d.role } } };
    if (d.set) {
      const f = texFiles(d.set, tex);
      const s = d.set === 'transport_atlas' ? 1 : 0;
      m['pbrMetallicRoughness'] = { baseColorFactor: [r, g, b, 1], baseColorTexture: { index: texture(f.albedo, s) }, metallicFactor: d.metal ?? 1, roughnessFactor: d.rough ?? 1, metallicRoughnessTexture: { index: texture(f.arm, s) } };
      m['normalTexture'] = { index: texture(f.normal, s), ...(d.normalScale ? { scale: d.normalScale } : {}) };
      m['occlusionTexture'] = { index: texture(f.arm, s) };
      if (d.emissive && f.emissive) { m['emissiveTexture'] = { index: texture(f.emissive, s) }; m['emissiveFactor'] = [1, 1, 1]; }
    } else {
      m['pbrMetallicRoughness'] = { baseColorFactor: [r, g, b, 1], metallicFactor: d.metal ?? 0, roughnessFactor: d.rough ?? 0.5 };
    }
    if (d.alpha === 'MASK') { m['alphaMode'] = 'MASK'; m['alphaCutoff'] = 0.5; }
    if (d.doubleSided) m['doubleSided'] = true;
    json.materials.push(m);
    i = json.materials.length - 1;
    matIndex.set(k, i);
    return i;
  };

  let triangles = 0, vertices = 0;
  const nodeIndex = new Map<string, number>();
  for (const node of model.nodes) {
    const primitives: unknown[] = [];
    for (const k of MAT_KEYS) {
      const g = node.mesh.groups.get(k);
      if (!g || g.idx.length === 0) continue;
      const n = g.pos.length / 3;
      vertices += n; triangles += g.idx.length / 3;
      const pmin = [Infinity, Infinity, Infinity], pmax = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) { const v = Math.fround(g.pos[i * 3 + c]!); pmin[c] = Math.min(pmin[c]!, v); pmax[c] = Math.max(pmax[c]!, v); }
      const posAcc = addAccessor({ bufferView: addView(Buffer.from(new Float32Array(g.pos).buffer), 34962), componentType: 5126, count: n, type: 'VEC3', min: pmin, max: pmax });
      const nq = Buffer.alloc(n * 4);
      for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) nq.writeInt8(Math.max(-127, Math.min(127, Math.round(g.nrm[i * 3 + c]! * 127))), i * 4 + c);
      const nrmAcc = addAccessor({ bufferView: addView(nq, 34962, 4), componentType: 5120, normalized: true, count: n, type: 'VEC3' });
      const uvAcc = addAccessor({ bufferView: addView(Buffer.from(new Float32Array(g.uv).buffer), 34962), componentType: 5126, count: n, type: 'VEC2' });
      const big = n > 65535;
      const ib = big ? Buffer.from(new Uint32Array(g.idx).buffer) : Buffer.from(new Uint16Array(g.idx).buffer);
      const idxAcc = addAccessor({ bufferView: addView(ib, 34963), componentType: big ? 5125 : 5123, count: g.idx.length, type: 'SCALAR' });
      primitives.push({ attributes: { POSITION: posAcc, NORMAL: nrmAcc, TEXCOORD_0: uvAcc }, indices: idxAcc, material: material(k), mode: 4 });
    }
    const jn: Record<string, unknown> = { name: node.name };
    if (primitives.length) { json.meshes.push({ name: `${name}_${node.name}`, primitives }); jn['mesh'] = json.meshes.length - 1; }
    if (node.parent) jn['translation'] = node.t.map((v) => +v.toFixed(4));
    if (node.s) jn['scale'] = node.s.map((v) => +v.toFixed(4));
    if (node.anim) jn['extras'] = { aube: { anim: node.anim } };
    json.nodes.push(jn);
    nodeIndex.set(node.name, json.nodes.length - 1);
    if (node.parent) {
      const p = json.nodes[nodeIndex.get(node.parent.name)!]!;
      p['children'] = [...((p['children'] as number[] | undefined) ?? []), json.nodes.length - 1];
    }
  }
  json.nodes[0]!['name'] = name;
  const bin = Buffer.concat(chunks);
  const binBuf = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
  json.buffers.push({ byteLength: binBuf.length });
  let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binBuf.length, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(jsonBuf.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(binBuf.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  const out = Buffer.concat([header, jh, jsonBuf, bh, binBuf]);
  mkdirSync(dirname(glbPath), { recursive: true });
  writeFileSync(glbPath, out);
  return { bytes: out.length, triangles, vertices };
}
