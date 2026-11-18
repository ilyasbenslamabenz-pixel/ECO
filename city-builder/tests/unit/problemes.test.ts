/**
 * Fenêtre « Problèmes à régler » (src/ui/problems.ts) : liste pure tirée des compteurs d'alertes et du rapport.
 * Tri par gravité puis par nombre de bâtiments touchés ; destination du clic ; aucun problème sur une ville saine.
 * Lancer : npx tsx --test tests/unit/problemes.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectProblems } from '../../src/ui/problems';

test('tri : urgents d’abord, puis par nombre de bâtiments touchés', () => {
  const p = collectProblems({ power: 14, waste: 3, crime: 5, water: 2 }, { economy: { forecast: { balance: -36402 } }, demography: { population: 120, unemploymentRate: 0.12 } }, 35_800_000, false);
  assert.deepEqual(p.slice(0, 2).map((x) => x.id), ['power', 'water']);
  assert.ok(p.slice(2).every((x) => x.severity === 'important'));
  assert.equal(p.find((x) => x.id === 'power')?.text, '14 bâtiments sans électricité');
  assert.equal(p.find((x) => x.id === 'waste')?.text, 'Bacs pleins : 3');
  assert.equal(p.find((x) => x.id === 'deficit')?.count, '−36 k');
  assert.equal(p.find((x) => x.id === 'chomage')?.count, '12 %');
  // Chaque problème localisé recentre la caméra ; chaque problème ouvre un tableau de bord ou un outil.
  assert.equal(p.find((x) => x.id === 'power')?.alert, 'power');
  assert.match(p.find((x) => x.id === 'power')!.open, /energy/);
  assert.match(p.find((x) => x.id === 'deficit')!.open, /finance/);
});

test('couverture des services : le service le moins couvert, en part d’habitants non desservis', () => {
  const p = collectProblems(null, { demography: { population: 400, unemploymentRate: 0, cityServices: { coverage: { police: 0.6, fire: 0.9, health: 0.3 } } } }, 1e6, false);
  assert.equal(p.length, 1);
  assert.equal(p[0]!.text, 'Pas de couverture soins : 70 % des habitants');
});

test('ville saine : aucun problème', () => {
  const p = collectProblems({ power: 0, water: 0 }, { economy: { forecast: { balance: 5000 } }, demography: { population: 300, unemploymentRate: 0.03, cityServices: { coverage: { police: 1, fire: 1, health: 1 } } } }, 1e6, false);
  assert.equal(p.length, 0);
});

test('réserve de courant faible : prévenue avant les coupures, ouvre le tableau Énergie', () => {
  const p = collectProblems(null, null, 1e6, false, 0, 0.08);
  assert.equal(p.length, 1);
  assert.equal(p[0]!.id, 'reserve-courant');
  assert.equal(p[0]!.count, '8 %');
  assert.match(p[0]!.open, /energy/);
  assert.equal(collectProblems(null, null, 1e6, false, 0, undefined).length, 0);
});

test('action directe : chaque problème ouvre l’outil qui le règle (tiroir de construction et onglet)', () => {
  const p = collectProblems({ power: 2, water: 1, waste: 1, crime: 3, fire: 1 }, { demography: { population: 400, unemploymentRate: 0.15, cityServices: { coverage: { police: 1, fire: 1, health: 0.2 } } } }, 1e6, false);
  const by = (id: string) => p.find((x) => x.id === id)!;
  assert.match(by('power').open, /#toolbar \[data-cat="energy"\]/);
  assert.match(by('water').open, /data-cat="water"/);
  assert.match(by('waste').open, /data-cat="waste"/);
  assert.equal(by('crime').tab, 'securite');
  assert.equal(by('fire').tab, 'securite');
  assert.match(by('chomage').open, /data-cat="zones"/);
  assert.equal(by('couverture-health').tab, 'sante');
});
