/**
 * Assets transport (port / aéroport) : fragment de catalogue valide, GLB conformes (validateur dédié),
 * génération déterministe, nœuds animables présents avec leurs plages.
 *   npx tsx --test tests/transport-assets/*.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { ALL_DEFS, buildModel } from '../../tools/transport/build';
import { validateTransport } from '../../tools/transport/validate';

const assets = join(import.meta.dirname, '..', '..', 'assets');
const frag = JSON.parse(readFileSync(join(assets, 'catalog.transport.json'), 'utf8')) as { assets: { id: string; lods: { file: string; triangles: number }[]; tags: string[] }[] };

test('le fragment couvre tous les modèles du générateur, dans l’ordre', () => {
  assert.deepEqual(frag.assets.map((a) => a.id), ALL_DEFS.map((d) => d.id));
  assert.ok(frag.assets.length >= 30);
});

test('validateur transport : aucun écart', async () => {
  const r = await validateTransport(assets);
  assert.deepEqual(r.errors, []);
});

test('génération déterministe (triangles identiques au catalogue)', () => {
  for (const id of ['port_grue_portique', 'port_porte_conteneurs', 'aero_avion_moyen_courrier']) {
    const def = ALL_DEFS.find((d) => d.id === id)!;
    const a = frag.assets.find((x) => x.id === id)!;
    for (let lod = 0; lod < 3; lod++) assert.equal(buildModel(def, lod).triangleCount(), a.lods[lod]!.triangles, `${id} LOD${lod}`);
  }
});

test('pièces animables : nœuds nommés avec extras.aube.anim', async () => {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const expect: Record<string, string[]> = {
    port_grue_portique: ['fleche', 'chariot', 'cables', 'palonnier'],
    port_grue_mobile: ['tourelle', 'fleche'],
    port_quai_rampe: ['rampe'],
    aero_passerelle: ['tunnel', 'tunnel_ext', 'cabine'],
  };
  for (const [id, names] of Object.entries(expect)) {
    const a = frag.assets.find((x) => x.id === id)!;
    const doc = await io.read(join(assets, a.lods[0]!.file));
    for (const n of names) {
      const node = doc.getRoot().listNodes().find((x) => x.getName() === n);
      assert.ok(node, `${id} : nœud ${n}`);
      const anim = (node.getExtras() as { aube?: { anim?: { min: number; max: number } } }).aube?.anim;
      assert.ok(anim && anim.max > anim.min, `${id}/${n} : plage d'animation`);
      assert.ok(a.tags.includes(`anim:${n}`));
    }
  }
});
