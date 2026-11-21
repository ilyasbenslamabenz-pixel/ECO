/**
 * Taxi depuis la grande carte (Game.taxi) : course payée (vie courante), personnage déposé à pied devant la porte,
 * temps du trajet écoulé ; refusé en véhicule, endormi ou sans trésorerie suffisante.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serviceBuilding } from '../src/sim/district';
import { Game } from '../src/sim/game';

test('taxi : course payée, déposé devant la porte, minutes de trajet écoulées', () => {
  const g = new Game(7, 'Test');
  const b = serviceBuilding(g.district, 'meubles')!;
  const cash = g.cash, t = g.total, living = g.today.living;
  const r = g.taxi(b.doorX, b.doorZ, 1.5, 15, 5);
  assert.ok(r.ok && r.data === 15);
  assert.equal(g.total, t + 5, 'le trajet prend 5 minutes de jeu');
  assert.ok(g.cash <= cash - 15 + 1e-9, 'course payée');
  assert.ok(g.today.living >= living + 15 - 1e-9, 'comptée en vie courante');
  assert.equal(g.player.place.kind, 'rue');
  assert.deepEqual([g.player.x, g.player.z, g.player.heading], [b.doorX, b.doorZ, 1.5]);
});

test('taxi refusé : en véhicule, endormi, trésorerie insuffisante (rien payé, temps arrêté)', () => {
  const g = new Game(7, 'Test');
  const b = serviceBuilding(g.district, 'banque')!;
  const t = g.total;
  g.player.driving = 1;
  assert.ok(!g.taxi(b.doorX, b.doorZ, 0, 15, 5).ok);
  g.player.driving = null;
  g.player.sleeping = true;
  assert.ok(!g.taxi(b.doorX, b.doorZ, 0, 15, 5).ok);
  g.player.sleeping = false;
  g.cash = 10;
  const r = g.taxi(b.doorX, b.doorZ, 0, 15, 5);
  assert.ok(!r.ok && /insuffisante/.test(r.message));
  assert.equal(g.cash, 10);
  assert.equal(g.total, t);
});
