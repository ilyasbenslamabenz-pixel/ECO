/** Outil de mise au point : matériaux (mode alpha, textures) d'un GLB. */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
for (const f of process.argv.slice(2)) {
  const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(f);
  for (const m of doc.getRoot().listMaterials()) console.log(f.split('/').pop(), m.getName(), m.getAlphaMode(), m.getAlphaCutoff(), m.getDoubleSided(), m.getBaseColorFactor().map((x) => x.toFixed(2)).join(','), m.getBaseColorTexture()?.getSize()?.join('x'), m.getBaseColorTexture()?.getMimeType());
}
