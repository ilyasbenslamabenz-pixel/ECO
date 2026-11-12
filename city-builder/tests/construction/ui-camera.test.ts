/**
 * Tests des parties pures de la caméra et de l'interface : inclinaison automatique,
 * amortissement, historique financier, graduations, options graphiques, emplacements.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoPitch, damp, MAX_DISTANCE, MIN_DISTANCE } from '../../src/input/camera';
import { FinanceHistory, axisLabel, niceStep } from '../../src/ui/finance';
import { DEFAULT_OPTIONS, sanitizeOptions } from '../../src/ui/options';
import { describeSave, slotId } from '../../src/ui/save-slots';
import { DRAWER_TABS, assetsForTab } from '../../src/ui/buildbar';
import { BUILDING_CATEGORIES } from '../../src/shared/catalog';
import type { SimStats } from '../../src/shared/contracts';
import { testCatalog } from '../fixtures/catalog';

test('caméra : inclinaison automatique croissante de la vue rue (rasante) à la vue aérienne (plongeante)', () => {
  let prev = -1;
  for (let d = MIN_DISTANCE; d <= MAX_DISTANCE; d *= 1.3) { const p = autoPitch(d); assert.ok(p >= prev); prev = p; }
  assert.ok(autoPitch(MIN_DISTANCE) < 0.25, 'quasi horizontale à 8 m');
  assert.ok(autoPitch(MAX_DISTANCE) > 1.0, 'plongeante à 2 000 m');
  // À 8 m avec l'inclinaison auto, l'œil est à hauteur de piéton (~1,6 m).
  assert.ok(Math.sin(autoPitch(MIN_DISTANCE)) * MIN_DISTANCE < 2.2);
});

test('caméra : amortissement indépendant du pas de temps', () => {
  let a = 0; for (let i = 0; i < 10; i++) a = damp(a, 100, 5, 0.01);
  const b = damp(0, 100, 5, 0.1);
  assert.ok(Math.abs(a - b) < 1e-9);
  assert.ok(b > 0 && b < 100);
});

const stats = (minutes: number, money: number): SimStats => ({
  date: { totalMinutes: minutes, year: 1, month: 1, day: Math.floor(minutes / 1440) % 30 + 1, hour: 0, minute: 0 },
  money, population: 0, jobs: 0, buildings: 0, roadLengthM: 0, vehicles: 0, monthlyBalance: -100, speed: 1, tickMs: 0,
});

test('finances : un point par jour de jeu, mise à jour intra-journée, remise à zéro au chargement', () => {
  const h = new FinanceHistory(5);
  assert.equal(h.push(stats(0, 1000)), true);
  assert.equal(h.push(stats(600, 900)), false);
  assert.equal(h.points.length, 1);
  assert.equal(h.points[0]!.money, 900);
  for (let d = 1; d <= 7; d++) h.push(stats(d * 1440, 1000 - d));
  assert.equal(h.points.length, 5, 'borné');
  h.push(stats(0, 5)); // retour dans le temps = nouvelle partie
  assert.equal(h.points.length, 1);
});

test('finances : graduations 1/2/5', () => {
  assert.equal(niceStep(1000, 4), 500);
  assert.equal(niceStep(10, 10), 1);
  assert.equal(niceStep(70000, 3), 50000);
  // Libellés distincts même pour de petits pas sur de grandes valeurs.
  assert.deepEqual([15_350_000, 15_400_000, 15_450_000].map((v) => axisLabel(v, 50_000)), ['15,35 M', '15,40 M', '15,45 M']);
  assert.equal(axisLabel(2_000_000, 1_000_000), '2 M');
  assert.equal(axisLabel(12_500, 2_500), '12,5 k');
});

test('options : valeurs hors domaine ramenées aux valeurs par défaut / bornes', () => {
  assert.deepEqual(sanitizeOptions(null), DEFAULT_OPTIONS);
  const o = sanitizeOptions({ quality: 'haute', shadows: 'ultra', viewDistance: 99999 });
  assert.equal(o.quality, 'haute'); assert.equal(o.viewDistance, 8000);
  assert.equal(sanitizeOptions({ quality: 'x' as never }).quality, DEFAULT_OPTIONS.quality);
});

test('emplacements : identifiant sûr et description lisible', () => {
  assert.equal(slotId('Ma Ville — été 2026 !'), 'ma-ville-ete-2026');
  assert.equal(slotId('***'), 'partie');
  const d = describeSave('a', { format: 'aube-urbaine-save', version: 1, savedAt: '2026-01-01T00:00:00Z', params: { seed: 1, mapChunks: 8, startMoney: 0, cityName: 'Lyre' },
    clock: { totalMinutes: 361 * 1440 + 31 * 1440 }, economy: { money: 42 }, buildings: [], roads: { nodes: [], edges: [] }, nextIds: { building: 1, roadNode: 1, roadEdge: 1 } });
  assert.equal(d.gameDate, 'an 2, févr.');
  assert.equal(d.cityName, 'Lyre');
});

test('barre de construction : chaque catégorie de bâtiment a un onglet', () => {
  const covered = new Set([...DRAWER_TABS.building, ...DRAWER_TABS.services].flatMap((t) => t.cats));
  for (const c of BUILDING_CATEGORIES) assert.ok(covered.has(c), `catégorie ${c} sans onglet`);
  const cat = testCatalog();
  assert.equal(assetsForTab(cat, DRAWER_TABS.building[0]!).length, 1);
});
