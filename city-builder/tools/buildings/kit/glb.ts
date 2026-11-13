/**
 * Kit bâtiments — écriture GLB (glTF 2.0 binaire) sans dépendance.
 *
 * - Un nœud, un maillage, une primitive par matériau (rôle).
 * - Textures EXTERNES partagées : les images référencent par URI relative les WebP des jeux de textures
 *   (assets/textures/…, assets/buildings/textures/…) au lieu de les embarquer dans chaque GLB
 *   (une texture = un fichier pour toute la bibliothèque ; le GLB ne contient que la géométrie).
 *   EXT_texture_webp (requis), KHR_texture_transform (échelle réelle 1/tileSizeM pour les UV en mètres).
 * - Quantification (KHR_mesh_quantization, lue nativement par GLTFLoader / glTFast / Unreal) : positions int16 normalisées
 *   (échelle + translation du nœud), normales int8, UV uint16 normalisées sur la plage de chaque primitive
 *   (déquantification par KHR_texture_transform offset/scale, combinée à l'échelle 1/tileSizeM ; plage aussi dans extras.aube.uvq).
 * - Soudure des sommets identiques.
 * - `extras.aube` sur chaque matériau : { set, uv, kind } (le rendu instancié reconstruit des matériaux partagés).
 * - Attribut `_LIT` (float) sur les verres : graine d'allumage nocturne par fenêtre.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, join } from 'node:path';
import type { TextureSet } from '../../../src/shared/catalog';
import type { KitMaterial, Palette } from './materials';
import type { MeshBuilder } from './mesh';

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
export function hexToLinear(hex: string | undefined): [number, number, number] {
  if (!hex) return [1, 1, 1];
  const v = parseInt(hex.replace('#', ''), 16);
  return [srgbToLinear(((v >> 16) & 255) / 255), srgbToLinear(((v >> 8) & 255) / 255), srgbToLinear((v & 255) / 255)];
}

export interface GlbStats { bytes: number; triangles: number; vertices: number; materials: string[] }

/**
 * Sérialise le contenu d'un MeshBuilder en GLB.
 * @param glbPath chemin absolu du fichier à écrire
 * @param assetsDir dossier assets/ (racine des chemins des jeux de textures)
 */
/** `compact` (mode économe) : nombres du JSON arrondis (teintes, transformations d'UV) — le JSON pèse lourd par primitive. */
export function writeGlb(mb: MeshBuilder, palette: Palette, sets: Map<string, TextureSet>, glbPath: string, assetsDir: string, compact = false): GlbStats {
  const rd = (x: number, p: number): number => (compact ? +x.toPrecision(p) : x);
  const json: Record<string, unknown> & {
    accessors: unknown[]; bufferViews: unknown[]; materials: unknown[]; images: unknown[]; textures: unknown[];
  } = {
    asset: { version: '2.0', generator: 'Aube Urbaine — kit bâtiments (tools/buildings/kit)' },
    extensionsUsed: ['EXT_texture_webp', 'KHR_texture_transform', 'KHR_mesh_quantization'],
    extensionsRequired: ['EXT_texture_webp', 'KHR_mesh_quantization'],
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'batiment' }],
    meshes: [] as unknown[],
    accessors: [],
    bufferViews: [],
    materials: [],
    images: [],
    textures: [],
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
    buffers: [] as unknown[],
  };
  const chunks: Buffer[] = [];
  let offset = 0;
  const addView = (buf: Buffer, target?: number, byteStride?: number): number => {
    const pad = (4 - (offset % 4)) % 4;
    if (pad) { chunks.push(Buffer.alloc(pad)); offset += pad; }
    const view: Record<string, number> = { buffer: 0, byteOffset: offset, byteLength: buf.length };
    if (target) view['target'] = target;
    if (byteStride) view['byteStride'] = byteStride;
    json.bufferViews.push(view);
    chunks.push(buf);
    offset += buf.length;
    return json.bufferViews.length - 1;
  };
  const addAccessor = (a: Record<string, unknown>): number => { json.accessors.push(a); return json.accessors.length - 1; };

  const imageIdx = new Map<string, number>();
  const textureFor = (file: string): number => {
    let i = imageIdx.get(file);
    if (i === undefined) {
      const uri = relative(dirname(glbPath), join(assetsDir, file)).split('\\').join('/');
      json.images.push({ uri, mimeType: 'image/webp', name: file.split('/').pop() });
      json.textures.push({ sampler: 0, extensions: { EXT_texture_webp: { source: json.images.length - 1 } } });
      i = json.textures.length - 1;
      imageIdx.set(file, i);
    }
    return i;
  };

  const materialIndex = new Map<string, number>();
  const makeMaterial = (role: string, m: KitMaterial, uvq: [number, number, number, number]): number => {
    const col = hexToLinear(m.color).map((c) => rd(c, 4));
    const ex: Record<string, unknown> = { set: m.set ?? null, uv: m.uv ?? 'meters', kind: m.kind ?? 'opaque', uvq: uvq.map((x) => +x.toFixed(6)) };
    if (m.kind === 'glass' || !m.set) {
      json.materials.push({
        name: role,
        pbrMetallicRoughness: { baseColorFactor: [...col, 1], metallicFactor: 0.6, roughnessFactor: 0.08 },
        doubleSided: !!m.doubleSided,
        extras: { aube: ex },
      });
      return json.materials.length - 1;
    }
    const set = sets.get(m.set);
    if (!set) throw new Error(`Jeu de textures inconnu « ${m.set} » (matériau ${role})`);
    // uv_glTF = offset + scale * q  avec  q ∈ [0,1] (uint16 normalisé) ;  uv_mètres = min + plage * q ;  uv_texture = uv_mètres / tuile
    const s = (m.uv ?? 'meters') === 'meters' ? 1 / set.tileSizeM : 1;
    const tt = { offset: [uvq[0] * s, uvq[1] * s].map((x) => (compact ? +x.toFixed(5) : x)), scale: [rd(uvq[2] * s, 7), rd(uvq[3] * s, 7)] };
    const ti = (file: string): Record<string, unknown> => ({ index: textureFor(file), extensions: { KHR_texture_transform: tt } });
    const pbr: Record<string, unknown> = {
      baseColorFactor: [...col, 1],
      baseColorTexture: ti(set.albedo),
      metallicFactor: m.metalness ?? 1,
      roughnessFactor: m.roughness ?? 1,
    };
    const mat: Record<string, unknown> = { name: role, pbrMetallicRoughness: pbr, normalTexture: ti(set.normal), doubleSided: !!m.doubleSided, extras: { aube: ex } };
    if (set.arm) {
      pbr['metallicRoughnessTexture'] = ti(set.arm);
      mat['occlusionTexture'] = ti(set.arm);
    } else {
      pbr['metallicFactor'] = m.metalness ?? 0;
    }
    json.materials.push(mat);
    return json.materials.length - 1;
  };

  // Quantification des positions (KHR_mesh_quantization) : int16 normalisé + échelle/translation du nœud.
  const bb = mb.bounds();
  const ctr = [0, 1, 2].map((k) => (bb.min[k]! + bb.max[k]!) / 2);
  const half = Math.max(1e-3, ...[0, 1, 2].map((k) => (bb.max[k]! - bb.min[k]!) / 2)) * 1.0001;
  (json['nodes'] as Record<string, unknown>[])[0]!['translation'] = ctr;
  (json['nodes'] as Record<string, unknown>[])[0]!['scale'] = [half, half, half];
  const primitives: unknown[] = [];
  let triangles = 0;
  let vertices = 0;
  const roles = [...mb.prims.keys()].sort();
  for (const role of roles) {
    const p = mb.prims.get(role)!;
    if (p.idx.length === 0) continue;
    const m = palette[role];
    if (!m) throw new Error(`Rôle ${role} absent de la palette`);
    const n0 = p.pos.length / 3;
    // UV : uint16 normalisé sur la plage de la primitive ; la déquantification passe par KHR_texture_transform
    let uMin = Infinity, vMin = Infinity, uMax = -Infinity, vMax = -Infinity;
    for (let i = 0; i < n0; i++) {
      const u = p.uv[i * 2]!, v = p.uv[i * 2 + 1]!;
      if (u < uMin) uMin = u; if (u > uMax) uMax = u; if (v < vMin) vMin = v; if (v > vMax) vMax = v;
    }
    const uR = Math.max(1e-4, uMax - uMin);
    const vR = Math.max(1e-4, vMax - vMin);
    // soudure des sommets identiques (après quantification)
    const qPos: number[] = [];
    const qNor: number[] = [];
    const qUv: number[] = [];
    const qLit: number[] = [];
    const remap = new Int32Array(n0);
    const seen = new Map<string, number>();
    const hasLit = p.lit.length === n0;
    for (let i = 0; i < n0; i++) {
      const px = Math.round(((p.pos[i * 3]! - ctr[0]!) / half) * 32767);
      const py = Math.round(((p.pos[i * 3 + 1]! - ctr[1]!) / half) * 32767);
      const pz = Math.round(((p.pos[i * 3 + 2]! - ctr[2]!) / half) * 32767);
      const nx = Math.round(Math.max(-1, Math.min(1, p.nor[i * 3]!)) * 127);
      const ny = Math.round(Math.max(-1, Math.min(1, p.nor[i * 3 + 1]!)) * 127);
      const nz = Math.round(Math.max(-1, Math.min(1, p.nor[i * 3 + 2]!)) * 127);
      const qu = Math.round(((p.uv[i * 2]! - uMin) / uR) * 65535);
      const qv = Math.round(((p.uv[i * 2 + 1]! - vMin) / vR) * 65535);
      const lit = hasLit ? p.lit[i]! : 0;
      const key = `${px},${py},${pz},${nx},${ny},${nz},${qu},${qv},${lit}`;
      let j = seen.get(key);
      if (j === undefined) {
        j = qPos.length / 3;
        seen.set(key, j);
        qPos.push(px, py, pz);
        qNor.push(nx, ny, nz);
        qUv.push(qu, qv);
        if (hasLit) qLit.push(lit);
      }
      remap[i] = j;
    }
    const n = qPos.length / 3;
    const uvq: [number, number, number, number] = [uMin, vMin, uR, vR];
    let mi = materialIndex.get(role);
    if (mi === undefined) { mi = makeMaterial(role, m, uvq); materialIndex.set(role, mi); }
    vertices += n;
    triangles += p.idx.length / 3;
    const attrs: Record<string, number> = {};
    const pos = new Int16Array(n * 4);
    const min = [32767, 32767, 32767];
    const max = [-32767, -32767, -32767];
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) {
      const v = qPos[i * 3 + k]!;
      pos[i * 4 + k] = v;
      if (v < min[k]!) min[k] = v;
      if (v > max[k]!) max[k] = v;
    }
    attrs['POSITION'] = addAccessor({ bufferView: addView(Buffer.from(pos.buffer), 34962, 8), componentType: 5122, normalized: true, count: n, type: 'VEC3', min, max }); // glTF : min/max des accesseurs normalisés en valeurs entières brutes
    const nor = new Int8Array(n * 4);
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) nor[i * 4 + k] = qNor[i * 3 + k]!;
    attrs['NORMAL'] = addAccessor({ bufferView: addView(Buffer.from(nor.buffer), 34962, 4), componentType: 5120, normalized: true, count: n, type: 'VEC3' });
    attrs['TEXCOORD_0'] = addAccessor({ bufferView: addView(Buffer.from(new Uint16Array(qUv).buffer), 34962), componentType: 5123, normalized: true, count: n, type: 'VEC2' });
    if (hasLit) attrs['_LIT'] = addAccessor({ bufferView: addView(Buffer.from(new Float32Array(qLit).buffer), 34962), componentType: 5126, count: n, type: 'SCALAR' });
    const big = n > 65535;
    const idx = p.idx.map((i) => remap[i]!);
    const ib = big ? new Uint32Array(idx) : new Uint16Array(idx);
    const indices = addAccessor({ bufferView: addView(Buffer.from(ib.buffer), 34963), componentType: big ? 5125 : 5123, count: idx.length, type: 'SCALAR' });
    primitives.push({ attributes: attrs, indices, material: mi, mode: 4 });
  }
  (json.meshes as unknown[]).push({ name: 'batiment', primitives });
  const tail = (4 - (offset % 4)) % 4;
  if (tail) { chunks.push(Buffer.alloc(tail)); offset += tail; }
  const bin = Buffer.concat(chunks);
  (json.buffers as unknown[]).push({ byteLength: bin.length });
  if (json.images.length === 0) {
    delete (json as Record<string, unknown>)['images'];
    delete (json as Record<string, unknown>)['textures'];
    json['extensionsUsed'] = ['KHR_mesh_quantization', 'KHR_texture_transform'];
    json['extensionsRequired'] = ['KHR_mesh_quantization'];
  }
  let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  const jpad = (4 - (jsonBuf.length % 4)) % 4;
  if (jpad) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jpad, 0x20)]);
  const total = 12 + 8 + jsonBuf.length + 8 + bin.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(jsonBuf.length, 0);
  jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(bin.length, 0);
  bh.writeUInt32LE(0x004e4942, 4);
  const out = Buffer.concat([header, jh, jsonBuf, bh, bin]);
  mkdirSync(dirname(glbPath), { recursive: true });
  writeFileSync(glbPath, out);
  return { bytes: out.length, triangles, vertices, materials: roles };
}
