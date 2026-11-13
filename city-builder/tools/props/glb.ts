/**
 * Écriture GLB du mobilier généré : un nœud, un maillage, une primitive par matériau
 * (« atlas » PBR : baseColor + normale + rugosité/métal de l'atlas partagé ; « verre » : transparent sans texture).
 * Toutes les LOD d'un modèle sont recentrées avec le décalage de la LOD0 (centre d'emprise en (0, 0), base à y = 0).
 */
import { Document, NodeIO, type Material } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import type { Model } from './geom';

export interface AtlasLod { albedo: Uint8Array; normal: Uint8Array; mr: Uint8Array }
export interface Bounds { min: [number, number, number]; max: [number, number, number] }

export function boundsOf(m: Model): Bounds {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const b of m.parts.values()) for (let i = 0; i < b.pos.length; i += 3) {
    for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k]!, b.pos[i + k]!); max[k] = Math.max(max[k]!, b.pos[i + k]!); }
  }
  return { min, max };
}

let io: NodeIO | null = null;

/** Sérialise le modèle (décalé de `offset`) en GLB. */
export async function writeGlb(m: Model, atlas: AtlasLod, offset: [number, number, number], name: string): Promise<Uint8Array> {
  const doc = new Document();
  doc.createExtension(EXTTextureWebP).setRequired(true);
  const buffer = doc.createBuffer();
  const tex = (img: Uint8Array, n: string) => doc.createTexture(n).setImage(img).setMimeType('image/webp');
  const mats: Record<string, Material> = {
    atlas: doc.createMaterial('mobilier_atlas')
      .setBaseColorTexture(tex(atlas.albedo, 'mobilier_albedo'))
      .setNormalTexture(tex(atlas.normal, 'mobilier_normal'))
      .setMetallicRoughnessTexture(tex(atlas.mr, 'mobilier_rugosite_metal'))
      .setMetallicFactor(1).setRoughnessFactor(1),
    verre: doc.createMaterial('mobilier_verre')
      .setBaseColorFactor([0.72, 0.82, 0.86, 0.3]).setAlphaMode('BLEND').setDoubleSided(true)
      .setMetallicFactor(0).setRoughnessFactor(0.08),
  };
  const mesh = doc.createMesh(name);
  for (const [mat, b] of m.parts) {
    if (b.idx.length === 0) continue;
    const pos = new Float32Array(b.pos.length);
    for (let i = 0; i < b.pos.length; i++) pos[i] = b.pos[i]! + offset[i % 3]!;
    const nVerts = pos.length / 3;
    const idx = nVerts < 65536 ? Uint16Array.from(b.idx) : Uint32Array.from(b.idx);
    const prim = doc.createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buffer))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(Float32Array.from(b.nor)).setBuffer(buffer))
      .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(Float32Array.from(b.uv)).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(idx).setBuffer(buffer))
      .setMaterial(mats[mat]!);
    mesh.addPrimitive(prim);
  }
  for (const [k, mt] of Object.entries(mats)) if (!m.parts.get(k as 'atlas' | 'verre')?.idx.length) mt.dispose();
  const node = doc.createNode(name).setMesh(mesh);
  doc.createScene('scene').addChild(node);
  doc.getRoot().setDefaultScene(doc.getRoot().listScenes()[0]!);
  if (!io) io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  return io.writeBinary(doc);
}
