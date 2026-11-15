/** Outil Déplacer et réseau d'eau : un bâtiment déplacé est rebranché (pas d'ancien branchement conservé). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTown } from '../sim/fixtures';
import { eauPlugins, linkTown, newSim, place, runHours } from './helpers';

test('déplacer un logement loin de toute route : branchement d’eau et accès routier recalculés', () => {
  const { plugins, eau } = eauPlugins();
  const s = newSim(plugins);
  buildTown(s);
  linkTown(s);
  place(s, 'eau_station_pompage', 120, 96, 2);
  place(s, 'eau_usine_potabilisation', 150, 100, 2);
  runHours(s, 30);
  const sys = eau.system;
  const st = s.buildings;
  let id = -1;
  for (let i = 0; i < st.count; i++) if (st.residents[i]! > 0 && (sys.buildingState(st.id[i]!)?.pressure ?? 0) > 0) { id = st.id[i]!; break; }
  assert.ok(id > 0, 'logement desservi sous pression');
  const k0 = st.indexOf(id);
  assert.equal(st.roadAccess[k0], 1);
  // Emplacement libre loin de toute route.
  let moved = false;
  for (const [x, z] of [[360, 360], [-360, 360], [360, -360], [-360, -360], [300, -250]] as const) {
    const r = s.runExt('moveBuilding', { buildingId: id, x, z, rot: st.rot[st.indexOf(id)]! });
    if (r.ok) { moved = true; break; }
  }
  assert.ok(moved, 'déplacement accepté');
  assert.equal(st.roadAccess[st.indexOf(id)], 0, 'plus d’accès routier');
  runHours(s, 2);
  const b = sys.buildingState(id);
  assert.ok(b, 'toujours suivi par le réseau d’eau');
  assert.equal(b.pressure, 0, 'plus de pression : l’ancien branchement n’est pas conservé');
});
