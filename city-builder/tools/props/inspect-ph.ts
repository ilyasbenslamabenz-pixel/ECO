/** Outil de mise au point : liste les nœuds racine (et leurs dimensions) d'un modèle Poly Haven en cache. */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';
import { cachedGltf } from '../assets/polyhaven';

for (const id of process.argv.slice(2)) {
  const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(await cachedGltf(id, '1k'));
  const scene = doc.getRoot().listScenes()[0]!;
  console.log(`# ${id}`);
  for (const n of scene.listChildren()) {
    const b = getBounds(n);
    console.log(`  ${n.getName().padEnd(40)} ${(b.max[0] - b.min[0]).toFixed(2)} × ${(b.max[2] - b.min[2]).toFixed(2)} × h ${(b.max[1] - b.min[1]).toFixed(2)}  centre ${((b.max[0] + b.min[0]) / 2).toFixed(2)},${((b.max[2] + b.min[2]) / 2).toFixed(2)}`);
  }
}
