/**
 * Tests du rendu et des modèles du module « Chantiers » (sans navigateur) — propriété p2a-chantiers.
 * Manifeste cohérent avec les fichiers livrés, budget de taille, géométrie procédurale bien formée.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildPlatform, buildRemains, buildSlab, buildStructure } from '../../src/render/construction/geometry';

const root = join(import.meta.dirname, '..', '..');
const manifest = JSON.parse(readFileSync(join(root, 'assets/models/construction/manifest.json'), 'utf8')) as {
  license: { spdx: string };
  models: { id: string; lods: { file: string; maxDistance: number; triangles: number; bytes: number }[] }[];
};

test('chantiers/rendu : manifeste cohérent avec les fichiers livrés (3 LOD, tailles exactes, licence)', () => {
  assert.equal(manifest.license.spdx, 'CC0-1.0');
  assert.ok(manifest.models.length >= 10, `${manifest.models.length} modèles`);
  const ids = new Set<string>();
  for (const m of manifest.models) {
    assert.ok(!ids.has(m.id), `id en double : ${m.id}`);
    ids.add(m.id);
    assert.equal(m.lods.length, 3, `${m.id} : 3 LOD attendus`);
    for (let k = 0; k < m.lods.length; k++) {
      const l = m.lods[k]!;
      const p = join(root, 'assets', l.file);
      assert.ok(existsSync(p), `${l.file} manquant`);
      assert.equal(statSync(p).size, l.bytes, `${l.file} : taille du manifeste périmée`);
      assert.equal(readFileSync(p).subarray(0, 4).toString('latin1'), 'glTF', `${l.file} : pas un GLB`);
      if (k > 0) {
        assert.ok(l.triangles <= m.lods[k - 1]!.triangles, `${m.id} : LOD${k} plus lourd que LOD${k - 1}`);
        assert.ok(l.maxDistance > m.lods[k - 1]!.maxDistance, `${m.id} : distances de LOD non croissantes`);
      }
    }
  }
  for (const id of ['grue_base', 'grue_mat', 'grue_tete']) assert.ok(ids.has(id), `modèle ${id} manquant`);
});

test('chantiers/rendu : budget des modèles de chantier < 3 Mo', () => {
  const total = manifest.models.reduce((s, m) => s + m.lods.reduce((t, l) => t + l.bytes, 0), 0);
  assert.ok(total < 3 * 1024 * 1024, `${(total / 1048576).toFixed(2)} Mo`);
});

function checkGeometry(name: string, g: import('three').BufferGeometry): void {
  const pos = g.getAttribute('position');
  assert.ok(pos && pos.count > 0, `${name} : sommets`);
  assert.ok(g.getAttribute('normal'), `${name} : normales`);
  for (let i = 0; i < pos.array.length; i++) assert.ok(Number.isFinite(pos.array[i]), `${name} : coordonnée non finie`);
  const idx = g.getIndex();
  if (idx) {
    assert.equal(idx.count % 3, 0, `${name} : indices non multiples de 3`);
    for (let i = 0; i < idx.count; i++) assert.ok(idx.getX(i) < pos.count, `${name} : indice hors bornes`);
  }
}

test('chantiers/rendu : géométrie procédurale bien formée, ossature montée étage par étage', () => {
  checkGeometry('plateforme', buildPlatform(20, 14));
  checkGeometry('dalle', buildSlab(20, 14));
  for (const [w, d, h] of [[8, 8, 6], [24, 18, 40], [30, 30, 120]] as const) {
    const s = buildStructure(w, d, h);
    checkGeometry(`ossature ${w}x${d}x${h}`, s.geometry);
    assert.equal(s.floorRanges.length, s.floors);
    for (let k = 1; k < s.floorRanges.length; k++) assert.ok(s.floorRanges[k]! > s.floorRanges[k - 1]!, 'étages croissants');
    assert.equal(s.floorRanges[s.floors - 1], s.geometry.getIndex()!.count, 'dernier étage = tout le tampon');
    const r = buildRemains(w, d, h);
    checkGeometry(`vestiges ${w}x${d}x${h}`, r.geometry);
  }
});

test('chantiers/panneau : durées et ligne de chantier en français', async () => {
  const { formatDureeFr, ligneChantier } = await import('../../src/ui/panels/chantiers');
  assert.equal(formatDureeFr(45), '45 min');
  assert.equal(formatDureeFr(200), '3 h 20');
  assert.equal(formatDureeFr(2 * 1440 + 4 * 60 + 10), '2 j 04 h');
  assert.equal(formatDureeFr(-5), '0 min');
  const info = { kind: 'demolition', nomFr: 'Pavillon', phaseFr: 'Déblaiement', avancement: 0.426, resteCalendaire: 90 } as unknown as Parameters<typeof ligneChantier>[0];
  assert.equal(ligneChantier(info), 'Démolition — Pavillon · Déblaiement · 43 % · reste 1 h 30');
});

test('chantiers/rendu : masque de repli — instance neutralisée pendant le chantier puis restituée', async () => {
  const THREE = await import('three');
  const { BuildingMask } = await import('../../src/render/construction/mask');
  const scene = new THREE.Scene();
  const group = new THREE.Group();
  group.name = 'batiments';
  scene.add(group);
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), 2);
  mesh.name = 'maison#0_lod0';
  group.add(mesh);
  const m = new THREE.Matrix4().compose(new THREE.Vector3(10, 2, -5), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.7), new THREE.Vector3(1, 1.5, 1));
  mesh.setMatrixAt(0, m);
  mesh.setMatrixAt(1, new THREE.Matrix4().makeTranslation(40, 0, 40));
  const before = Array.from(mesh.instanceMatrix.array);
  const mask = new BuildingMask(scene);
  mask.hide(7, 'maison', 0, 10, 2, -5);
  mask.apply();
  assert.equal(mask.masked, 1);
  const arr = mesh.instanceMatrix.array;
  assert.equal(arr[0], 0); assert.equal(arr[5], 0); assert.equal(arr[10], 0);
  assert.equal(arr[12], 10, 'translation conservée');
  assert.deepEqual(Array.from(arr.slice(16, 32)), before.slice(16, 32), 'autre instance intacte');
  mask.apply();
  assert.equal(mask.masked, 1, 'déjà neutralisée : comptée sans réécriture');
  mask.show(7);
  mask.apply();
  assert.equal(mask.masked, 0);
  assert.deepEqual(Array.from(mesh.instanceMatrix.array), before, 'matrice restituée à l\'identique');
});

test('chantiers/rendu : masque par l\'API rétabli à l\'instantané complet et au retrait du bâtiment (« la maison n\'apparaît pas »)', async () => {
  const THREE = await import('three');
  const { BuildingMask } = await import('../../src/render/construction/mask');
  const { InstancedBuildingRenderer } = await import('../../src/render/buildings/renderer');
  const { emptyCatalog } = await import('../../src/shared/catalog');
  const asset = {
    id: 'maison', nameFr: 'maison', category: 'house',
    lods: [{ file: 'm0.glb', maxDistance: 1e9 }], dimensions: { width: 10, depth: 10, height: 8 }, footprint: { tilesX: 2, tilesZ: 2 },
    cost: 1, upkeepPerMonth: 1, capacity: { residents: 1, jobs: 0 }, frontage: [{ x: 0, z: 5, nx: 0, nz: 1, kind: 'pedestrian' }],
    variants: [{ id: 'v0', nameFr: 'v0', heightScale: 1 }], textureSets: [], license: { spdx: 'CC0-1.0', source: 't', author: 't' }, tags: [],
  };
  const src = {
    catalog: { ...emptyCatalog(), assets: [asset] } as never,
    url: (f: string) => f,
    load: () => Promise.resolve(new THREE.Group().add(new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3)), new THREE.MeshStandardMaterial({ name: 'facade' })))),
  };
  const scene = new THREE.Scene();
  const r = new InstancedBuildingRenderer(scene, src, { castShadow: false });
  const rec = { id: 1, assetId: 'maison', variant: 0, x: 0, y: 0, z: 0, rot: 0 };
  const hidden = (): boolean => r.debugInstance(1)!.hidden;
  // Partie 1 : maison #1 en chantier, masquée par l'API.
  const mask = new BuildingMask(scene, r);
  r.add([rec]);
  mask.hide(1, 'maison', 0, 0, 0, 0);
  assert.equal(hidden(), true);
  // Remplacement du même bâtiment (même identifiant) : masquage conservé.
  r.add([rec]);
  assert.equal(hidden(), true, 'remplacé : toujours en chantier');
  // Instantané complet (nouvelle partie / chargement) : bâtiments retirés puis rajoutés, puis chantiers effacés.
  r.remove([1]);
  r.add([rec]);
  assert.equal(hidden(), false, 'retiré puis rajouté : plus masqué');
  mask.hide(1, 'maison', 0, 0, 0, 0);
  mask.clear();
  assert.equal(hidden(), false, 'clear() rétablit les bâtiments masqués par l\'API');
  mask.hide(1, 'maison', 0, 0, 0, 0);
  mask.show(1);
  assert.equal(hidden(), false);
  // Rendu effectif : la maison est dessinée une fois son LOD chargé.
  r.update(0, 10, 30);
  await new Promise((res) => setTimeout(res, 0));
  r.update(0, 10, 30.5);
  assert.ok(r.debugInstance(1)!.counts[0]! > 0, 'maison dessinée');
});
