/**
 * Ombres de contact au pied des bâtiments (src/render/buildings/contact-shadows.ts) : un halo par bâtiment, retiré à
 * la démolition, masqué pendant un chantier, un seul maillage instancié ; emprise = modèle + marge de chaque côté.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ContactShadowLayer, CONTACT_MARGIN_M } from '../../src/render/buildings/contact-shadows';

const meshOf = (l: ContactShadowLayer): THREE.InstancedMesh => l.group.children[0] as THREE.InstancedMesh;

test('ombres de contact : ajout, chantier masqué, démolition, un seul maillage', () => {
  const root = new THREE.Group();
  const l = new ContactShadowLayer(root);
  l.add(1, 10, 2, 20, 8, 6, 0);
  l.add(2, 40, 2, 20, 12, 10, 1);
  l.update();
  assert.equal(l.group.children.length, 1, 'un seul maillage instancié');
  assert.equal(meshOf(l).count, 2);
  // Emprise : modèle + marge de chaque côté (échelle de l'instance).
  const m = new THREE.Matrix4(); meshOf(l).getMatrixAt(0, m);
  const s = new THREE.Vector3(); m.decompose(new THREE.Vector3(), new THREE.Quaternion(), s);
  assert.ok(Math.abs(s.x - (8 + 2 * CONTACT_MARGIN_M)) < 1e-4 && Math.abs(s.z - (6 + 2 * CONTACT_MARGIN_M)) < 1e-4, `échelle ${s.x} × ${s.z}`);
  l.setVisible(2, false); l.update();
  assert.equal(meshOf(l).count, 1, 'chantier : pas de halo sur un terrain vide');
  l.setVisible(2, true); l.update();
  assert.equal(meshOf(l).count, 2);
  l.remove(1); l.update();
  assert.equal(meshOf(l).count, 1, 'démolition : halo retiré');
  l.add(3, 0, 0, 0, 0, 0, 0); l.update();
  assert.equal(meshOf(l).count, 1, 'modèle sans emprise : aucun halo');
  assert.equal(meshOf(l).castShadow, false);
  assert.equal((meshOf(l).material as THREE.ShaderMaterial).depthWrite, false);
  l.dispose();
});
