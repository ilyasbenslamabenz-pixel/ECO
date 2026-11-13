/**
 * Écriture GLB (glTF 2.0 binaire) des modèles de chantier — propriété p2a-chantiers.
 *
 *  - 1 nœud, 1 maillage, 1 primitive par RÔLE de matériau présent ;
 *  - positions / normales / UV en float32, indices uint16 ou uint32 (la compression meshopt et la
 *    quantification sont appliquées à la distribution par scripts/optimize-glb.mjs) ;
 *  - textures EXTERNES PARTAGÉES par URI relative vers assets/textures/<jeu>/… (Poly Haven, CC0,
 *    déjà au catalogue) : aucun pixel n'est dupliqué dans les GLB ;
 *  - `extras.aube = { role }` sur chaque matériau : le rendu du module reconnaît les rôles
 *    (optiques émissives, filets translucides, béton…).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import type { CMesh, Role } from './mesh';

/** Matériau d'un rôle : jeu de textures du catalogue + facteurs PBR. */
export interface RoleMaterial {
  /** Dossier/jeu de textures sous assets/textures/ (sans suffixe) ; absent = matériau sans texture. */
  textureSet?: string;
  /** Taille d'une répétition de la texture (m) : les UV sont déjà en mètres, ce facteur les met à l'échelle. */
  tileSizeM?: number;
  color: [number, number, number, number];
  metallic: number;
  roughness: number;
  emissive?: [number, number, number];
  /** Mélange alpha (filets, vitres). */
  blend?: boolean;
  doubleSided?: boolean;
  nameFr: string;
}

export const ROLE_MATERIALS: Record<Role, RoleMaterial> = {
  acier_jaune: { textureSet: 'metal_larme', tileSizeM: 0.5, color: [0.82, 0.58, 0.07, 1], metallic: 0.85, roughness: 0.45, nameFr: 'Acier peint jaune' },
  acier_rouge: { textureSet: 'metal_larme', tileSizeM: 0.5, color: [0.62, 0.13, 0.1, 1], metallic: 0.8, roughness: 0.5, nameFr: 'Acier peint rouge' },
  acier_galva: { textureSet: 'metal_rideau', tileSizeM: 2, color: [0.72, 0.74, 0.78, 1], metallic: 0.9, roughness: 0.4, nameFr: 'Acier galvanisé' },
  acier_sombre: { textureSet: 'metal_conteneur', tileSizeM: 1.94, color: [0.3, 0.31, 0.33, 1], metallic: 0.85, roughness: 0.55, nameFr: 'Acier sombre' },
  beton: { textureSet: 'sol_beton_brut', tileSizeM: 2.5, color: [0.78, 0.78, 0.76, 1], metallic: 0, roughness: 0.92, nameFr: 'Béton brut' },
  bois: { textureSet: 'bardage_bois', tileSizeM: 1.57, color: [0.86, 0.74, 0.55, 1], metallic: 0, roughness: 0.85, nameFr: 'Bois de coffrage' },
  bache: { textureSet: 'metal_rideau', tileSizeM: 2, color: [0.1, 0.32, 0.52, 1], metallic: 0, roughness: 0.75, nameFr: 'Bâche' },
  filet: { color: [0.16, 0.38, 0.62, 0.62], metallic: 0, roughness: 0.85, blend: true, doubleSided: true, nameFr: 'Filet de protection' },
  terre: { textureSet: 'terrain_terre', tileSizeM: 2, color: [0.74, 0.62, 0.48, 1], metallic: 0, roughness: 1, nameFr: 'Terre excavée' },
  gravats: { textureSet: 'terrain_gravier', tileSizeM: 2.25, color: [0.72, 0.7, 0.67, 1], metallic: 0, roughness: 1, nameFr: 'Gravats' },
  verre: { color: [0.05, 0.07, 0.08, 1], metallic: 0.1, roughness: 0.08, nameFr: 'Vitrage' },
  optique: { color: [1, 0.72, 0.2, 1], metallic: 0, roughness: 0.3, emissive: [1, 0.6, 0.12], nameFr: 'Optique / gyrophare' },
  caoutchouc: { textureSet: 'metal_conteneur', tileSizeM: 0.6, color: [0.09, 0.09, 0.1, 1], metallic: 0, roughness: 0.95, nameFr: 'Caoutchouc' },
};

export interface GlbStats { bytes: number; triangles: number; vertices: number; roles: Role[] }

/** Écrit le maillage en GLB. `assetsDir` sert à calculer les URI relatives des textures partagées. */
export function writeConstructionGlb(mesh: CMesh, glbPath: string, assetsDir: string, name: string): GlbStats {
  const json = {
    asset: { version: '2.0', generator: 'Meknes City — générateur de chantiers (tools/construction)' },
    extensionsUsed: ['EXT_texture_webp'],
    extensionsRequired: ['EXT_texture_webp'],
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name }],
    meshes: [] as unknown[],
    accessors: [] as unknown[],
    bufferViews: [] as unknown[],
    materials: [] as unknown[],
    images: [] as unknown[],
    textures: [] as unknown[],
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
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

  const imgIndex = new Map<string, number>();
  const texture = (file: string): number => {
    let i = imgIndex.get(file);
    if (i !== undefined) return i;
    const uri = relative(dirname(glbPath), join(assetsDir, file)).split('\\').join('/');
    json.images.push({ uri, mimeType: 'image/webp', name: file.split('/').pop() });
    json.textures.push({ sampler: 0, extensions: { EXT_texture_webp: { source: json.images.length - 1 } } });
    i = json.textures.length - 1;
    imgIndex.set(file, i);
    return i;
  };

  const material = (role: Role): number => {
    const m = ROLE_MATERIALS[role];
    const pbr: Record<string, unknown> = { baseColorFactor: m.color, metallicFactor: m.metallic, roughnessFactor: m.roughness };
    const mat: Record<string, unknown> = { name: role, pbrMetallicRoughness: pbr, extras: { aube: { role, nameFr: m.nameFr } } };
    if (m.textureSet) {
      const base = `textures/${m.textureSet}/${m.textureSet}`;
      pbr['baseColorTexture'] = { index: texture(`${base}_albedo.webp`) };
      pbr['metallicRoughnessTexture'] = { index: texture(`${base}_arm.webp`) };
      mat['normalTexture'] = { index: texture(`${base}_normal.webp`) };
      mat['occlusionTexture'] = { index: texture(`${base}_arm.webp`) };
    }
    if (m.emissive) mat['emissiveFactor'] = m.emissive;
    if (m.blend) { mat['alphaMode'] = 'BLEND'; }
    if (m.doubleSided) mat['doubleSided'] = true;
    return json.materials.push(mat) - 1;
  };

  const primitives: unknown[] = [];
  const roles: Role[] = [];
  let triangles = 0, vertices = 0;
  for (const [role, g] of Object.entries(mesh.groups) as [Role, { pos: number[]; nrm: number[]; uv: number[]; idx: number[] }][]) {
    const n = g.pos.length / 3;
    if (n === 0 || g.idx.length === 0) continue;
    roles.push(role);
    vertices += n;
    triangles += g.idx.length / 3;
    const tile = ROLE_MATERIALS[role].tileSizeM ?? 1;
    const pmin = [Infinity, Infinity, Infinity], pmax = [-Infinity, -Infinity, -Infinity];
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i++) {
      const v = g.pos[i]!;
      pos[i] = v;
      const k = i % 3;
      if (v < pmin[k]!) pmin[k] = v;
      if (v > pmax[k]!) pmax[k] = v;
    }
    const nrm = new Float32Array(g.nrm);
    const uv = new Float32Array(n * 2);
    for (let i = 0; i < n * 2; i++) uv[i] = g.uv[i]! / tile;
    const posAcc = addAccessor({ bufferView: addView(Buffer.from(pos.buffer, pos.byteOffset, pos.byteLength), 34962), componentType: 5126, count: n, type: 'VEC3', min: pmin, max: pmax });
    const nrmAcc = addAccessor({ bufferView: addView(Buffer.from(nrm.buffer, nrm.byteOffset, nrm.byteLength), 34962), componentType: 5126, count: n, type: 'VEC3' });
    const uvAcc = addAccessor({ bufferView: addView(Buffer.from(uv.buffer, uv.byteOffset, uv.byteLength), 34962), componentType: 5126, count: n, type: 'VEC2' });
    const big = n > 65535;
    const idx = big ? new Uint32Array(g.idx) : new Uint16Array(g.idx);
    const idxAcc = addAccessor({ bufferView: addView(Buffer.from(idx.buffer, idx.byteOffset, idx.byteLength), 34963), componentType: big ? 5125 : 5123, count: g.idx.length, type: 'SCALAR' });
    primitives.push({ attributes: { POSITION: posAcc, NORMAL: nrmAcc, TEXCOORD_0: uvAcc }, indices: idxAcc, material: material(role), mode: 4 });
  }
  if (primitives.length === 0) throw new Error(`${name} : maillage vide`);
  json.meshes.push({ name, primitives });
  if (json.images.length === 0) { json.extensionsUsed = []; json.extensionsRequired = []; }

  const bin = Buffer.concat(chunks);
  const binPad = (4 - (bin.length % 4)) % 4;
  const binBuf = binPad ? Buffer.concat([bin, Buffer.alloc(binPad)]) : bin;
  json.buffers.push({ byteLength: binBuf.length });
  let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  const jpad = (4 - (jsonBuf.length % 4)) % 4;
  if (jpad) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jpad, 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binBuf.length, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(jsonBuf.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(binBuf.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  const out = Buffer.concat([header, jh, jsonBuf, bh, binBuf]);
  mkdirSync(dirname(glbPath), { recursive: true });
  writeFileSync(glbPath, out);
  return { bytes: out.length, triangles, vertices, roles };
}
