/** Briques de base : horloge/calendrier, planificateur, PRNG, tables SoA, index par chunk, boucle à pas fixe. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameClock, MINUTES_PER_DAY, MINUTES_PER_MONTH, MINUTES_PER_YEAR, formatDateFr, seasonOfMonth, weekdayOf } from '../../src/sim/clock';
import { EventScheduler, SimEvent } from '../../src/sim/scheduler';
import { Rng } from '../../src/sim/rng';
import { createCitizenTable } from '../../src/sim/population';
import { ChunkIndex } from '../../src/sim/ecs';
import { FixedStepLoop, MAX_CATCHUP_STEPS, STEP_MS } from '../../src/sim/loop';
import type { GameDate } from '../../src/shared/contracts';

test('horloge : changements d\'heure, de jour, de mois et d\'année signalés exactement une fois', () => {
  const c = new GameClock();
  let hours = 0, days = 0, months = 0, years = 0;
  for (let m = 0; m < MINUTES_PER_YEAR + MINUTES_PER_MONTH; m += 2) {
    const f = c.advance(2);
    if (f.hourChanged) hours++;
    if (f.dayChanged) days++;
    if (f.monthChanged) months++;
    if (f.yearChanged) years++;
  }
  assert.equal(days, 390);
  assert.equal(months, 13);
  assert.equal(years, 1);
  assert.equal(hours, 390 * 24);
  const d: GameDate = { totalMinutes: 0, year: 0, month: 0, day: 0, hour: 0, minute: 0 };
  c.toDate(d);
  assert.deepEqual([d.year, d.month, d.day, d.hour, d.minute], [2, 2, 1, 0, 0]);
});

test('calendrier : saisons, jours de la semaine, date en français', () => {
  assert.equal(seasonOfMonth(1), 'hiver');
  assert.equal(seasonOfMonth(4), 'printemps');
  assert.equal(seasonOfMonth(7), 'ete');
  assert.equal(seasonOfMonth(10), 'automne');
  assert.equal(seasonOfMonth(12), 'hiver');
  assert.equal(weekdayOf(0), 0);
  assert.equal(weekdayOf(6 * MINUTES_PER_DAY + 5), 6);
  assert.equal(weekdayOf(7 * MINUTES_PER_DAY), 0);
  const c = new GameClock();
  c.totalMinutes = 2 * MINUTES_PER_MONTH + 2 * MINUTES_PER_DAY + 8 * 60 + 5;
  assert.equal(c.season, 'printemps');
  const d: GameDate = { totalMinutes: 0, year: 0, month: 0, day: 0, hour: 0, minute: 0 };
  assert.equal(formatDateFr(c.toDate(d)), `${['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'][62 % 7]} 3 mars an 1, 08:05`);
});

test('planificateur : ordre chronologique, ordre d\'insertion à égalité, récurrence, sérialisation', () => {
  const s = new EventScheduler();
  const seen: string[] = [];
  s.schedule(30, 7, 1);
  s.schedule(10, 7, 2);
  s.schedule(10, 7, 3);
  s.schedule(5, SimEvent.DayStart, 0, 0, 20);
  s.runDue(30, (type, a, _b, at) => seen.push(`${type}:${a}@${at}`));
  assert.deepEqual(seen, ['1:0@5', '7:2@10', '7:3@10', '1:0@25', '7:1@30']);
  assert.equal(s.size, 1, 'seul l\'événement récurrent reste');
  assert.equal(s.peekTime(), 45);
  const j = JSON.parse(JSON.stringify(s.toJSON()));
  const s2 = new EventScheduler();
  s2.fromJSON(j);
  const a: number[] = [], b: number[] = [];
  s.runDue(200, (_t, _a, _b, at) => a.push(at));
  s2.runDue(200, (_t, _a, _b, at) => b.push(at));
  assert.deepEqual(a, b);
  assert.deepEqual(a, [45, 65, 85, 105, 125, 145, 165, 185]);
  s.schedule(300, SimEvent.DeficitWarning);
  assert.ok(s.has(SimEvent.DeficitWarning));
  s.cancelType(SimEvent.DeficitWarning);
  assert.ok(!s.has(SimEvent.DeficitWarning));
});

test('PRNG : déterministe, état restaurable, bornes respectées', () => {
  const a = new Rng(42), b = new Rng(42);
  for (let i = 0; i < 100; i++) assert.equal(a.nextU32(), b.nextU32());
  const st = a.getState();
  const seq = [a.next(), a.next(), a.next()];
  const c = new Rng(7);
  c.setState(st);
  assert.deepEqual([c.next(), c.next(), c.next()], seq);
  for (let i = 0; i < 1000; i++) { const v = a.int(3, 5); assert.ok(v >= 3 && v <= 5 && Number.isInteger(v)); }
  const counts = [0, 0, 0];
  for (let i = 0; i < 3000; i++) counts[a.weighted([1, 0, 2])]!++;
  assert.equal(counts[1], 0);
  assert.ok(counts[2]! > counts[0]!);
});

test('table SoA : ajout, suppression par permutation, croissance, aller-retour JSON', () => {
  const t = createCitizenTable(2);
  for (let id = 1; id <= 10; id++) { const i = t.add(id); t.col.birth[i] = -id * 100; t.col.income[i] = id * 10; }
  assert.equal(t.count, 10);
  assert.ok(t.capacity >= 10);
  t.remove(3);
  assert.equal(t.indexOf(3), -1);
  assert.equal(t.col.income[t.indexOf(10)], 100);
  assert.throws(() => t.add(5));
  const j = JSON.parse(JSON.stringify(t.toJSON()));
  const t2 = createCitizenTable(1);
  t2.fromJSON(j);
  assert.equal(t2.count, 9);
  for (let id = 1; id <= 10; id++) {
    if (id === 3) continue;
    assert.equal(t2.col.birth[t2.indexOf(id)], -id * 100);
  }
});

test('index par chunk : requêtes par rectangle sans doublon, suppression', () => {
  const idx = new ChunkIndex(-512, -512, 1024, 256);
  idx.insert(1, -10, -10, 10, 10); // à cheval sur 4 cellules
  idx.insert(2, 300, 300, 310, 310);
  idx.insert(3, -500, 400, 400, 410); // longue route
  const out: number[] = [];
  assert.deepEqual(idx.query(-5, -5, 5, 5, out).sort(), [1]);
  assert.deepEqual(idx.query(-600, -600, 600, 600, out).sort(), [1, 2, 3]);
  assert.deepEqual(idx.query(200, 380, 220, 420, out).sort(), [3]);
  idx.remove(3);
  assert.deepEqual(idx.query(-600, -600, 600, 600, out).sort(), [1, 2]);
  idx.insert(1, 400, 400, 401, 401); // réinsertion = déplacement
  assert.deepEqual(idx.query(-5, -5, 5, 5, out), []);
  assert.equal(idx.count, 2);
});

test('boucle à pas fixe : vitesses, pause, rattrapage borné', () => {
  let t = 0;
  const target = { speed: 1, ticks: 0, tickMs: 0, tick(): void { this.ticks++; } };
  const loop = new FixedStepLoop(target, () => t);
  t += STEP_MS * 3;
  assert.equal(loop.pump(), 3);
  assert.equal(target.ticks, 3);
  target.speed = 4;
  t += STEP_MS * 2;
  loop.pump();
  assert.equal(target.ticks, 3 + 8);
  target.speed = 0;
  t += STEP_MS * 2;
  assert.equal(loop.pump(), 2, 'en pause les pas continuent (deltas de stats) sans tick');
  assert.equal(target.ticks, 11);
  target.speed = 1;
  t += 60_000; // onglet endormi une minute
  assert.equal(loop.pump(), MAX_CATCHUP_STEPS);
  assert.equal(target.ticks, 11 + MAX_CATCHUP_STEPS);
  t += STEP_MS * 0.5;
  assert.equal(loop.pump(), 0, 'retard abandonné : pas de spirale');
});
