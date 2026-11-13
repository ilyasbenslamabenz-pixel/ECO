/**
 * Test croisé d'intégration piétons × feux : les piétons consomment l'API des feux RÉELLE publiée par la
 * circulation (`ctx.provide('feux', FeuxApi)`) via l'adaptateur `adaptFeux` (forme `crossing(id)`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { circulationPlugin } from '../../src/sim/plugins/circulation';
import { FEUX_SERVICE, type FeuxApi } from '../../src/shared/protocol-ext/circulation';
import { adaptFeux } from '../../src/sim/pedestrians/feux';
import { pedTown, runHours } from './fixtures';

test('piétons × feux : le service « feux » de la circulation est raccordé et les passages régulés sont vus', () => {
  const t = pedTown({ extra: [circulationPlugin] });
  runHours(t.sim, 0.2);
  const api = t.ctx.use<FeuxApi>(FEUX_SERVICE);
  assert.ok(api, 'la circulation publie le service « feux »');
  const port = adaptFeux(api);
  assert.ok(port, 'la FeuxApi de la circulation est acceptée par l\'adaptateur piétons');
  const controlled = api.crossings().filter((c) => c.controlled);
  assert.ok(controlled.length > 0, 'au moins un passage régulé (avenue × rues)');
  // Pour chaque passage régulé : l'état vu par les piétons = feu piéton de la circulation.
  const out = { etat: -1, restant: 0 };
  for (const c of controlled) {
    const seg = c.id >> 1;
    assert.ok(port.passage(c.junctionId, seg, out), `passage ${c.id} régulé vu par les piétons`);
    assert.equal(out.etat, c.walk);
    assert.ok(Math.abs(out.restant - c.remaining) < 1e-6);
  }
  // Passage non régulé : traversée prudente.
  const free = api.crossings().find((c) => !c.controlled);
  if (free) assert.equal(port.passage(free.junctionId, free.id >> 1, out), false);
  // Carrefour inconnu : pas d'information.
  assert.equal(port.passage(-12345, 0, out), false);
  const st = t.system.stats();
  assert.equal(st.feux, true, 'stats.feux = true (service raccordé)');
  assert.ok(st.graphe.passagesRegules > 0, `${st.graphe.passagesRegules} passages peints régulés`);
});

test('piétons × feux : en jeu, des traversées se font au vert du feu piéton de la circulation', () => {
  const t = pedTown({ extra: [circulationPlugin] });
  t.sim.plugins.command('pietons', 'config', { foule: 120 });
  runHours(t.sim, 1);
  const st = t.system.stats();
  assert.equal(st.feux, true);
  assert.ok(st.cumul.traversees > 0, `${st.cumul.traversees} traversées`);
  assert.ok(st.cumul.traverseesAuVert > 0, `${st.cumul.traverseesAuVert} traversées au vert`);
});
