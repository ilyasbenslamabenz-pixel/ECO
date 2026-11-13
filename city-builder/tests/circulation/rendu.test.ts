/**
 * Rendu du module circulation : carte de congestion (géométrie, couleurs, affichage) et planche de
 * plaques d'immatriculation (variété des numéros, matériau dédié dans les GLB du catalogue).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CongestionOverlay } from '../../src/render/traffic/congestion';
import { circulationRenderPlugin, congestionOverlay } from '../../src/render/plugins/circulation';
import { CONGESTION_COLORS, type CirculationDelta, type CongestionFrame, type CongestionLayout } from '../../src/shared/protocol-ext/circulation';
import { plateNumbers, PLATE_ROWS } from '../../tools/vehicles/textures';

const root = join(import.meta.dirname, '..', '..');

function layout(): CongestionLayout {
  // deux tronçons : 3 points et 2 points
  return {
    version: 1,
    edgeIds: Int32Array.from([10, 20]),
    ptStart: Int32Array.from([0, 3, 5]),
    x: Float32Array.from([0, 50, 100, 0, 0]),
    y: Float32Array.from([0, 0, 0, 0, 0]),
    z: Float32Array.from([0, 0, 0, 0, 80]),
    half: Float32Array.from([6, 4]),
  };
}

function frame(levels: number[]): CongestionFrame {
  return {
    edgeIds: Int32Array.from([10, 20]),
    density: Float32Array.from([30, 1]),
    speed: Float32Array.from([2, 11]),
    ratio: Float32Array.from([0.15, 0.95]),
    level: Uint8Array.from(levels),
  };
}

test('congestion : géométrie du ruban construite depuis les polylignes', () => {
  const o = new CongestionOverlay();
  o.setLayout(layout());
  assert.equal(o.edgeCount, 2);
  const mesh = o.group.children[0] as unknown as { geometry: { attributes: Record<string, { count: number }>; index: { count: number } | null } };
  assert.ok(mesh, 'maillage unique pour tout le réseau');
  assert.equal(o.group.children.length, 1, 'un seul objet (1 draw call)');
  assert.equal(mesh.geometry.attributes['position']!.count, (3 + 2) * 2, 'deux sommets par point de polyligne');
  assert.equal(mesh.geometry.index!.count, (2 + 1) * 6, 'deux triangles par segment');
  o.dispose();
  assert.equal(o.group.children.length, 0);
  assert.equal(o.edgeCount, 0);
});

test('congestion : les couleurs suivent les niveaux, palette commune à l\'interface', () => {
  const o = new CongestionOverlay();
  o.setLayout(layout());
  o.setLevels(frame([3, 0]));
  assert.deepEqual(o.edgeColor(10), o.colorOf(3));
  assert.deepEqual(o.edgeColor(20), o.colorOf(0));
  o.setLevels(frame([1, 2]));
  assert.deepEqual(o.edgeColor(10), o.colorOf(1));
  assert.deepEqual(o.edgeColor(20), o.colorOf(2));
  assert.equal(o.edgeColor(999), null, 'tronçon inconnu ignoré');
  assert.equal(CONGESTION_COLORS.length, 4);
  // rouge (à l'arrêt) nettement plus rouge que vert (fluide)
  const rouge = o.colorOf(3), vert = o.colorOf(0);
  assert.ok(rouge[0] > vert[0] && vert[1] > rouge[1]);
});

test('congestion : le module de rendu applique instantané puis deltas, et l\'affichage du joueur', () => {
  congestionOverlay.dispose();
  circulationRenderPlugin.applySnapshotExt!({ version: 1, layout: layout(), congestion: frame([2, 0]), overlay: false });
  assert.equal(congestionOverlay.edgeCount, 2);
  assert.equal(congestionOverlay.visible, false);
  const d: CirculationDelta = { version: 1, overlay: true };
  circulationRenderPlugin.applyDeltaExt!(d);
  assert.equal(congestionOverlay.visible, true, 'carte affichée à la demande du joueur');
  circulationRenderPlugin.applyDeltaExt!({ version: 1, congestion: frame([0, 3]) } satisfies CirculationDelta);
  assert.deepEqual(congestionOverlay.edgeColor(20), congestionOverlay.colorOf(3));
  // instantané sans charge utile (module inactif) : la couche se vide
  circulationRenderPlugin.applySnapshotExt!(undefined);
  assert.equal(congestionOverlay.edgeCount, 0);
  assert.equal(congestionOverlay.visible, false);
});

test('plaques : numéros tous différents, format européen', () => {
  const nums = plateNumbers();
  assert.equal(nums.length, PLATE_ROWS);
  assert.ok(PLATE_ROWS >= 16, 'au moins 16 plaques différentes');
  assert.equal(new Set(nums).size, nums.length, 'aucun doublon');
  for (const n of nums) assert.match(n, /^[A-Z]{2}-\d{3}-[A-Z]{2}$/);
  assert.notEqual(nums[0], 'AU-207-BE');
  assert.deepEqual(plateNumbers(), nums, 'génération déterministe');
});

test('plaques : les véhicules du catalogue portent un sous-maillage « plaque » dédié', () => {
  const cat = JSON.parse(readFileSync(join(root, 'assets', 'catalog.json'), 'utf8')) as {
    assets: { id: string; category: string; lods: { file: string }[]; textureSets: string[] }[];
    textureSets: { id: string }[];
  };
  assert.ok(cat.textureSets.some((t) => t.id === 'vehicules_plaques'), 'planche de plaques au catalogue');
  const vehicules = cat.assets.filter((a) => a.category === 'vehicle');
  assert.ok(vehicules.length >= 15);
  for (const v of vehicules) assert.ok(v.textureSets.includes('vehicules_plaques'), `${v.id} : planche de plaques`);
  // le GLB LOD0 déclare un matériau de rôle « plaque » et le nombre de bandes
  const glb = readFileSync(join(root, 'assets', vehicules[0]!.lods[0]!.file));
  const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8')) as {
    materials: { name: string; extras?: { aube?: { role?: string; rows?: number } } }[];
  };
  const plaque = json.materials.find((m) => m.extras?.aube?.role === 'plaque');
  assert.ok(plaque, `${vehicules[0]!.id} : matériau plaque`);
  assert.equal(plaque!.extras!.aube!.rows, PLATE_ROWS);
});
