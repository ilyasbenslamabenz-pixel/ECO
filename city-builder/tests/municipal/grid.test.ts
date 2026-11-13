/** Grilles d'indicateurs : adressage, lecture / écriture bornées, émission, diffusion, couplage, sauvegarde. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IndicatorGrid, geometryFor, checkDiffusion } from '../../src/sim/municipal/grid';
import { IndicatorGrids } from '../../src/sim/municipal/grids';
import { decodeFloat32, encodeFloat32 } from '../../src/sim/municipal/codec';
import type { IndicatorSpec } from '../../src/shared/municipal/types';

const spec = (o: Partial<IndicatorSpec> = {}): IndicatorSpec => ({ id: 'test:x', nameFr: 'X', unit: 'u', base: 0, min: 0, max: 1000, ...o });
const geo = { originX: -40, originZ: -40, cellSize: 10, cols: 8, rows: 8 };
const sum = (g: IndicatorGrid): number => g.data.reduce((s, v) => s + v, 0);

test('géométrie : couverture d\'un rectangle, résolution configurable, erreurs', () => {
  const g = geometryFor({ minX: -1024, minZ: -1024, maxX: 1024, maxZ: 1024 }, 32);
  assert.deepEqual(g, { originX: -1024, originZ: -1024, cellSize: 32, cols: 64, rows: 64 });
  assert.equal(geometryFor({ minX: 0, minZ: 0, maxX: 100, maxZ: 50 }, 30).cols, 4);
  assert.throws(() => new IndicatorGrid(spec(), { ...geo, cellSize: 0 }), /cellSize/);
  assert.throws(() => new IndicatorGrid(spec(), { ...geo, cols: 0 }), /cols/);
  assert.throws(() => new IndicatorGrid(spec({ base: 5, max: 1 }), geo), /min ≤ base ≤ max/);
});

test('adressage monde <-> cellule, lecture et écriture bornées', () => {
  const g = new IndicatorGrid(spec({ base: 2 }), geo);
  assert.equal(g.size, 64);
  assert.equal(g.cellAt(-40, -40), 0);
  assert.equal(g.cellAt(-30.01, -40), 0);
  assert.equal(g.cellAt(-30, -40), 1);
  assert.equal(g.cellAt(39.9, 39.9), 63);
  assert.equal(g.cellAt(40, 0), -1);
  assert.equal(g.at(1000, 1000), 2, 'hors grille = valeur de fond');
  assert.equal(g.setAt(5, 5, 50), 48);
  assert.equal(g.at(5, 5), 50);
  assert.equal(g.get(4, 4), 50);
  assert.equal(g.add(4, 4, 2000), 950, 'bornée au max');
  assert.equal(g.get(4, 4), 1000);
  assert.equal(g.add(4, 4, -5000), -1000);
  assert.equal(g.get(4, 4), 0, 'bornée au min');
  assert.equal(g.set(99, 0, 3), 0, 'hors grille : rien');
  g.set(0, 0, Number.NaN);
  assert.equal(g.get(0, 0), 2, 'NaN -> valeur de fond');
  const v0 = g.version;
  g.add(1, 1, 1);
  assert.ok(g.version > v0);
});

test('échantillonnage bilinéaire et moyenne de zone', () => {
  const g = new IndicatorGrid(spec(), { originX: 0, originZ: 0, cellSize: 10, cols: 2, rows: 1 });
  g.set(0, 0, 0); g.set(1, 0, 100);
  assert.equal(g.sample(5, 5), 0);
  assert.equal(g.sample(15, 5), 100);
  assert.equal(g.sample(10, 5), 50);
  assert.equal(g.sample(-100, 5), 0, 'bords prolongés');
  assert.equal(g.meanIn(10, 5, 6), 50);
});

test('émission (stamp) : décroissance, somme renvoyée, petit rayon', () => {
  const g = new IndicatorGrid(spec(), geo);
  const added = g.stamp(5, 5, 25, 10, 'linear');
  assert.ok(Math.abs(added - sum(g)) < 1e-4);
  assert.ok(g.at(5, 5) > g.at(25, 5) && g.at(25, 5) > 0);
  assert.equal(g.at(-35, -35), 0);
  const h = new IndicatorGrid(spec(), geo);
  assert.equal(h.stamp(1, 1, 0.1, 7), 7, 'rayon minuscule : la cellule du point');
  const f = new IndicatorGrid(spec(), geo);
  f.stamp(5, 5, 15, 4, 'flat');
  assert.equal(f.at(5, 5), 4);
  assert.equal(f.at(15, 5), 4);
});

test('diffusion : bords fermés sans atténuation = masse conservée ; étalement ; atténuation ; bords ouverts', () => {
  const d = { rate: 0.2, decay: 0, steps: 1, every: 'hour' as const, boundary: 'closed' as const };
  const g = new IndicatorGrid(spec({ diffusion: d }), geo);
  g.set(3, 3, 640);
  for (let k = 0; k < 50; k++) g.diffuse();
  assert.ok(Math.abs(sum(g) - 640) < 1e-2, `masse ${sum(g)}`);
  assert.ok(g.get(3, 3) < 640 && g.get(0, 0) > 0, 'étalée jusqu\'aux coins');
  // Longtemps après : uniforme (640 / 64 = 10).
  for (let k = 0; k < 2000; k++) g.diffuse();
  assert.ok(Math.abs(g.get(7, 7) - 10) < 0.05);

  const decayed = new IndicatorGrid(spec({ diffusion: { ...d, decay: 0.1 } }), geo);
  decayed.set(3, 3, 640);
  decayed.diffuse();
  assert.ok(Math.abs(sum(decayed) - 576) < 1e-2, 'perte de 10 % par pas');

  const open = new IndicatorGrid(spec({ diffusion: { ...d, boundary: 'open' } }), geo);
  open.fill(10);
  open.diffuse();
  assert.ok(sum(open) < 640, 'la masse s\'échappe par les bords ouverts');
  assert.equal(open.get(3, 3), 10, 'intérieur uniforme inchangé');
});

test('diffusion : advection (vent) déplace le panache vers l\'aval, masse conservée en bords fermés', () => {
  const d = { rate: 0.05, decay: 0, steps: 1, every: 'hour' as const, boundary: 'closed' as const, advectX: 0.2 };
  const g = new IndicatorGrid(spec({ diffusion: d }), geo);
  g.set(1, 4, 100);
  for (let k = 0; k < 10; k++) g.diffuse();
  let cx = 0;
  for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) cx += i * g.get(i, j);
  cx /= sum(g);
  assert.ok(cx > 2.5, `barycentre déplacé vers +x (${cx.toFixed(2)})`);
  assert.ok(Math.abs(sum(g) - 100) < 1e-3);
});

test('diffusion : paramètres instables refusés', () => {
  assert.throws(() => checkDiffusion({ rate: 0.3, decay: 0, steps: 1, every: 'hour', boundary: 'open' }), /rate/);
  assert.throws(() => checkDiffusion({ rate: 0.25, decay: 0, steps: 1, every: 'hour', boundary: 'open', advectX: 0.1 }), /instable/);
  assert.throws(() => checkDiffusion({ rate: 0.1, decay: 2, steps: 1, every: 'hour', boundary: 'open' }), /decay/);
});

test('registre de grilles : définition paresseuse, standard / module, lecture typée, propagation par fréquence', () => {
  const r = new IndicatorGrids(geo);
  assert.equal(r.count, 0);
  assert.equal(r.read('valeur_fonciere', 0, 0), 100, 'fond standard sans grille');
  assert.ok(Number.isNaN(r.read('mod:inconnu', 0, 0)));
  const air = r.ensure('pollution_air');
  assert.equal(air.spec.nameFr, 'Pollution de l\'air');
  assert.equal(r.ensure('pollution_air'), air, 'même objet');
  assert.throws(() => r.ensure('mod:x'), /spécification complète/);
  assert.throws(() => r.ensure('sans-prefixe' as 'mod:x', { nameFr: 'a', unit: 'u', base: 0, min: 0, max: 1 }), /module:nom/);
  r.ensure('elec:tension', { nameFr: 'Tension', unit: 'V', base: 230, min: 0, max: 400 });
  assert.equal(r.read('elec:tension', 0, 0), 230);
  r.add('pollution_air', 5, 5, 50);
  const before = r.require('pollution_air').at(5, 5);
  r.propagate('day');
  assert.equal(r.require('pollution_air').at(5, 5), before, 'air diffusé à l\'heure, pas au jour');
  r.propagate('hour');
  assert.ok(r.require('pollution_air').at(5, 5) < before);
  assert.throws(() => r.require('bruit'), /non défini/);
});

test('couplage : la source modifie la cible (valeur foncière - k · pollution)', () => {
  const r = new IndicatorGrids(geo);
  r.ensure('pollution_air').setAt(5, 5, 40);
  r.ensure('valeur_fonciere');
  r.addCoupling({ id: 'air->foncier', from: 'pollution_air', to: 'valeur_fonciere', factor: -0.5, every: 'day' });
  assert.throws(() => r.addCoupling({ id: 'air->foncier', from: 'pollution_air', to: 'valeur_fonciere', factor: 1, every: 'day' }), /déjà/);
  r.propagate('day');
  assert.equal(r.read('valeur_fonciere', 5, 5), 80);
  assert.equal(r.read('valeur_fonciere', -35, -35), 100);
});

test('résolution : rééchantillonnage des grilles existantes', () => {
  const r = new IndicatorGrids(geo);
  r.ensure('satisfaction').fill(70);
  r.setDefaultGeometry({ originX: -40, originZ: -40, cellSize: 5, cols: 16, rows: 16 });
  const s = r.require('satisfaction');
  assert.equal(s.cols, 16);
  assert.ok(Math.abs(s.at(0, 0) - 70) < 1e-4);
});

test('sauvegarde : base64 Float32 exact et registre aller-retour', () => {
  const v = new Float32Array([0, 1.5, -2.25, 1e-7, 3.4e38, Math.PI]);
  assert.deepEqual(decodeFloat32(encodeFloat32(v), v.length), v);
  for (const n of [1, 2, 3, 4]) {
    const w = new Float32Array(n).map((_, i) => i * 0.1 + 7);
    assert.deepEqual(decodeFloat32(encodeFloat32(w), n), w);
  }
  assert.throws(() => decodeFloat32('AAAA', 3), /valeurs/);
  assert.throws(() => decodeFloat32('A!A=', 0), /base64|valeurs/);
  const r = new IndicatorGrids(geo);
  r.ensure('bruit').stamp(0, 0, 30, 20);
  r.ensure('valeur_fonciere');
  r.addCoupling({ id: 'c', from: 'bruit', to: 'valeur_fonciere', factor: -1, every: 'month' });
  const j = JSON.parse(JSON.stringify(r.toJSON())) as ReturnType<IndicatorGrids['toJSON']>;
  const back = IndicatorGrids.fromJSON(j);
  assert.deepEqual(back.ids().sort(), ['bruit', 'valeur_fonciere']);
  assert.deepEqual(back.require('bruit').data, r.require('bruit').data);
  assert.equal(back.listCouplings().length, 1);
  assert.deepEqual(back.toJSON(), r.toJSON());
});
