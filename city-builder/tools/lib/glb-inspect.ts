/** Inspection Node d'un fichier GLB (gltf-transform) : triangles, matériaux, textures. */
import { NodeIO, type Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

export interface GlbInfo {
  file: string;
  meshes: number;
  primitives: number;
  triangles: number;
  materials: { name: string; baseColor: boolean; normal: boolean; metallicRoughness: boolean; occlusion: boolean }[];
  textures: { name: string; mime: string; width: number; height: number; bytes: number }[];
  bbox: { min: number[]; max: number[] };
}

let io: NodeIO | null = null;
export function getIO(): NodeIO {
  io ??= new NodeIO().registerExtensions(ALL_EXTENSIONS);
  return io;
}

export async function inspectGlb(file: string): Promise<GlbInfo> {
  const doc: Document = await getIO().read(file);
  const root = doc.getRoot();
  let triangles = 0;
  let primitives = 0;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      primitives++;
      const idx = prim.getIndices();
      const pos = prim.getAttribute('POSITION');
      if (prim.getMode() === 4) triangles += (idx ? idx.getCount() : pos?.getCount() ?? 0) / 3;
      if (pos) {
        const mn = pos.getMin([]);
        const mx = pos.getMax([]);
        for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k]!, mn[k]!); max[k] = Math.max(max[k]!, mx[k]!); }
      }
    }
  }
  return {
    file,
    meshes: root.listMeshes().length,
    primitives,
    triangles,
    materials: root.listMaterials().map((m) => ({
      name: m.getName(),
      baseColor: !!m.getBaseColorTexture(),
      normal: !!m.getNormalTexture(),
      metallicRoughness: !!m.getMetallicRoughnessTexture(),
      occlusion: !!m.getOcclusionTexture(),
    })),
    textures: root.listTextures().map((t) => {
      const size = t.getSize();
      return { name: t.getName() || t.getURI(), mime: t.getMimeType(), width: size?.[0] ?? 0, height: size?.[1] ?? 0, bytes: t.getImage()?.byteLength ?? 0 };
    }),
    // Boîte en coordonnées locales des primitives (approximation : sans transformations de nœuds).
    bbox: { min, max },
  };
}
