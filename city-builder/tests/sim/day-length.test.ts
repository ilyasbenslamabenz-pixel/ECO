/**
 * Durée de la journée (recette QA n° 2 : « cycle jour/nuit de 72 s, trop rapide ») : une journée de jeu dure
 * 7 200 ticks = 12 min réelles à x1 ; l'horloge ne dérive pas en cumulant des pas de 0,2 min ; les événements
 * au rythme réel (immigration, synchronisation du trafic) gardent leur cadence en ticks ; une sauvegarde faite
 * avec l'ancienne horloge (périodes 360 / 60 min) se recharge et reprend les nouvelles périodes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GAME_MINUTES_PER_TICK, SIM_TICKS_PER_SECOND } from '../../src/shared/constants';
import { GameClock, MINUTES_PER_DAY } from '../../src/sim/clock';
import { SimEvent } from '../../src/sim/scheduler';
import { buildTown, newTownSim } from './fixtures';

test('journée de jeu = 12 min réelles à x1 (entre 12 et 24 min demandées)', () => {
  const ticksPerDay = MINUTES_PER_DAY / GAME_MINUTES_PER_TICK;
  assert.equal(Math.round(ticksPerDay), 7200);
  const realMinutes = ticksPerDay / SIM_TICKS_PER_SECOND / 60;
  assert.ok(realMinutes >= 12 && realMinutes <= 24, `${realMinutes} min`);
});

test('horloge : 7 200 pas de 0,2 min = exactement un jour, sans dérive', () => {
  const c = new GameClock();
  let days = 0;
  for (let i = 0; i < 7200 * 3; i++) if (c.advance(GAME_MINUTES_PER_TICK).dayChanged) days++;
  assert.equal(c.totalMinutes, 3 * MINUTES_PER_DAY);
  assert.equal(days, 3);
});

test('simulation : immigration au même rythme réel (une vague / 180 ticks), journée inchangée côté calendrier', () => {
  const s = newTownSim();
  buildTown(s);
  const ev = s.scheduler.toJSON().events;
  const mig = ev.find((e) => e.type === SimEvent.Migration)!;
  const sync = ev.find((e) => e.type === SimEvent.TrafficSync)!;
  assert.equal(Math.round(mig.every / GAME_MINUTES_PER_TICK), 180);
  assert.equal(Math.round(sync.every / GAME_MINUTES_PER_TICK), 30);
  const pop0 = s.demography!.population;
  for (let i = 0; i < 1800; i++) s.tick(); // 3 min réelles, 6 h de jeu
  assert.ok(s.demography!.population > pop0, `la ville se peuple en quelques minutes réelles (${pop0} -> ${s.demography!.population})`);
  assert.equal(s.getStats().date.day, 1);
});

test('sauvegarde de l’ancienne horloge : chargée, périodes temps réel remises à jour', () => {
  const s = newTownSim();
  buildTown(s);
  for (let i = 0; i < 100; i++) s.tick();
  const save = s.toSave();
  for (const e of save.sim!.scheduler.events) {
    if (e.type === SimEvent.Migration) e.every = 360;
    if (e.type === SimEvent.TrafficSync) e.every = 60;
  }
  const t = newTownSim();
  assert.equal(t.fromSave(JSON.parse(JSON.stringify(save))), null);
  assert.equal(t.clock.totalMinutes, s.clock.totalMinutes);
  const ev = t.scheduler.toJSON().events;
  assert.equal(Math.round(ev.find((e) => e.type === SimEvent.Migration)!.every / GAME_MINUTES_PER_TICK), 180);
  assert.equal(Math.round(ev.find((e) => e.type === SimEvent.TrafficSync)!.every / GAME_MINUTES_PER_TICK), 30);
  assert.ok(ev.every((e) => e.at <= t.clock.totalMinutes + 43200 * 13));
});
