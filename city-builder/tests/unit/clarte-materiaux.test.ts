/**
 * Clarté des matériaux : toits / façades trop sombres (teinte × texture) et essences au feuillage presque noir.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALBEDO_FLOOR, ALBEDO_FLOOR_MAX_GAIN, ALBEDO_FLOOR_METAL, ALBEDO_FLOOR_METAL_MAX_GAIN, albedoFloorGain, metalFloorColor } from '../../src/render/buildings/materials';
import { FOLIAGE_MAX_GAIN, FOLIAGE_MIN_LUMA, foliageGain } from '../../src/render/nature/vegetation';
import { IMP_MAX_LOD } from '../../src/render/nature/impostor';

const lin = (c: number): number => Math.pow(c / 255, 2.2);

test('plancher de clarté : tôle teintée gris éclaircie, tuiles rouges intactes, borné', () => {
  const tole: [number, number, number] = [lin(88), lin(88), lin(81)];
  const gris = { r: lin(0x7d), g: lin(0x83), b: lin(0x86) };
  const g = albedoFloorGain(tole, gris, ALBEDO_FLOOR['toiture']!);
  assert.ok(g > 1.5 && g <= ALBEDO_FLOOR_MAX_GAIN, `gain ${g}`);
  const tuiles: [number, number, number] = [lin(145), lin(80), lin(43)];
  assert.equal(albedoFloorGain(tuiles, { r: 1, g: 1, b: 1 }, ALBEDO_FLOOR['toiture']!), 1);
  assert.equal(albedoFloorGain([0.0001, 0.0001, 0.0001], { r: 0.01, g: 0.01, b: 0.01 }, 0.075), 1, 'noir voulu (ou texture illisible) : inchangé');
  assert.equal(albedoFloorGain([0.01, 0.01, 0.01], { r: 1, g: 1, b: 1 }, 0.075), ALBEDO_FLOOR_MAX_GAIN);
  assert.ok(ALBEDO_FLOOR['zinc'] && ALBEDO_FLOOR['facade'] && ALBEDO_FLOOR['garde_corps'], 'toits de tôle et de métal sombre');
  assert.equal(ALBEDO_FLOOR['verre'], undefined, 'verres non concernés');
});

test('toit de zinc métallique sombre : reflet ramené à celui d\'un zinc réel', () => {
  const larme: [number, number, number] = [lin(61), lin(50), lin(28)];
  const teinte = { r: lin(0x3a), g: lin(0x3d), b: lin(0x40) };
  const g = albedoFloorGain(larme, teinte, ALBEDO_FLOOR_METAL, ALBEDO_FLOOR_METAL_MAX_GAIN);
  const v = Math.max(larme[0] * teinte.r * g, larme[1] * teinte.g * g, larme[2] * teinte.b * g);
  assert.ok(Math.abs(v - ALBEDO_FLOOR_METAL) < 1e-6 || g === ALBEDO_FLOOR_METAL_MAX_GAIN, `reflet ${v}, gain ${g}`);
});

test('métal sombre à dominante brune : reflet ramené au gris de la teinte, pas doré', () => {
  const larme: [number, number, number] = [lin(61), lin(50), lin(28)];
  const c = metalFloorColor(larme, { r: 0.04, g: 0.04, b: 0.04 })!;
  const reflet = [0, 1, 2].map((k) => larme[k]! * c[k]!);
  for (const v of reflet) assert.ok(Math.abs(v - ALBEDO_FLOOR_METAL) < 1e-6, `reflet ${reflet}`);
  assert.equal(metalFloorColor([0.5, 0.5, 0.5], { r: 1, g: 1, b: 1 }), null, 'métal déjà clair : inchangé');
});

test('feuillage : seul l\'épicéa (très sombre) est éclairci, sans dépasser les feuillus', () => {
  const epicea = foliageGain([38.5, 62.6, 28.1]);
  assert.ok(epicea > 1.3 && epicea <= FOLIAGE_MAX_GAIN, `épicéa ${epicea}`);
  assert.equal(foliageGain([68.9, 92.4, 31]), 1, 'feuillu rond');
  assert.equal(foliageGain([72.3, 76.5, 46.2]), 1, 'jacaranda');
  assert.equal(foliageGain([0, 0, 0]), 1, 'atlas vide : inchangé');
  assert.ok(FOLIAGE_MIN_LUMA < 80);
});

test('imposteurs : niveau de mip borné (silhouette conservée au loin)', () => {
  assert.ok(IMP_MAX_LOD >= 2 && IMP_MAX_LOD <= 4);
});
