/** Icônes de problèmes (module « alertes ») : bâtiment sans route signalé, module inerte sans problème. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTown, newTownSim, runDays } from '../sim/fixtures';
import { ALERT_BITS, type AlertesPayload } from '../../src/shared/protocol-ext/alertes';

test('alertes : un bâtiment posé loin des routes est signalé « pas d’accès routier », avec sa position', () => {
  const s = newTownSim(); buildTown(s); runDays(s, 1);
  const st = (): AlertesPayload => (s.plugins.command('alertes', 'state', undefined) as { data: { data: AlertesPayload } }).data.data;
  const before = st().counts.road;
  let placed: number | null = null;
  for (const [x, z] of [[600, 600], [-600, 600], [600, -600], [-600, -600], [400, 0], [0, 400]] as const) {
    const r = s.placeBuilding({ assetId: 'maison', x, z, rot: 0 });
    if (r.ok) { placed = r.data.buildingId; break; }
  }
  assert.ok(placed !== null, 'maison isolée posée');
  runDays(s, 1);
  const p = st();
  assert.equal(p.counts.road, before + 1);
  const k = p.items.findIndex((v, i) => i % 5 === 0 && v === placed);
  assert.ok(k >= 0 && (p.items[k + 1]! & ALERT_BITS.road) !== 0, 'masque « route »');
  assert.ok(Number.isFinite(p.items[k + 3]!), 'hauteur de l’icône');
  // Démolie : l'alerte disparaît.
  assert.ok(s.demolish({ buildingId: placed! }).ok);
  runDays(s, 1);
  assert.equal(st().counts.road, before);
});
