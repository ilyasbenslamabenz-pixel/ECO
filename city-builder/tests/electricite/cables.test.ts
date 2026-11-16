/**
 * Câbles souterrains (16/11, demande joueur « pour les éoliennes je dois pouvoir les raccorder avec des câbles sous
 * terre ») : une éolienne (ou un parc) loin de toute route, reliée par un câble au réseau routier, alimente la ville ;
 * démolition / annulation coupent ; sauvegarde et rechargement ; refus des tracés invalides.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../../src/sim/world';
import { createElectricitePlugin } from '../../src/sim/plugins/electricite';
import { CABLE_SPEC, LINE_SPEC } from '../../src/shared/power/model';
import type { ElectriciteDelta } from '../../src/shared/power/types';
import { advanceHours, powerCatalog, powerTown } from './fixtures';

const full = (sim: Simulation): ElectriciteDelta => (sim.plugins.command('electricite', 'state', undefined) as { data: { data: ElectriciteDelta } }).data.data;
const cmd = (sim: Simulation, name: string, payload: unknown): { ok: boolean; data?: unknown; message?: string } => {
  const r = sim.plugins.command('electricite', name, payload);
  return r.ok ? { ok: true, data: r.data.data } : { ok: false, message: r.error.message };
};

function placeAt(sim: Simulation, assetId: string, spots: readonly (readonly [number, number])[]): { id: number; x: number; z: number } {
  for (const [x, z] of spots) {
    const r = sim.placeBuilding({ assetId, x, z, rot: 0 });
    if (r.ok) return { id: r.data.buildingId, x, z };
  }
  throw new Error(`${assetId} : aucun emplacement libre`);
}

/** Parc de trois éoliennes à ≈ 250 m au sud du bourg, loin de toute route (voisines reliées entre elles). */
function farPark(sim: Simulation): { id: number; x: number; z: number }[] {
  const out = [placeAt(sim, 'eolienne', [[-100, -250], [-100, -260], [-110, -250]])];
  for (let k = 0; k < 2; k++) {
    const p = out[out.length - 1]!;
    out.push(placeAt(sim, 'eolienne', [[p.x + 100, p.z], [p.x + 100, p.z - 10], [p.x + 105, p.z + 8]]));
  }
  for (const f of out) assert.equal(sim.net.segmentNear(f.x, f.z, 80), null, 'éolienne à l’écart des routes');
  return out;
}

test('câble souterrain : une éolienne loin de toute route, reliée par câble à une rue, alimente la ville', () => {
  const { sim, elec } = powerTown({ days: 1 });
  const park = farPark(sim);
  sim.plugins.command('electricite', 'forceWind', { ms: 13 });
  advanceHours(sim, 2);
  let s = elec.system.summary()!;
  assert.equal(s.isolatedFacilities, 3, 'parc isolé avant le câble');
  assert.ok(s.unlinked > 0, 'bourg sans courant');
  const road = sim.net.segmentNear(0, 0, 10)!;
  const money0 = sim.economy.money;
  const q = cmd(sim, 'quoteCable', { a: { id: park[0]!.id }, b: { x: road.x, z: road.z + 3 } });
  assert.ok(q.ok, q.message);
  const quote = q.data as { lengthM: number; cost: number };
  assert.ok(quote.lengthM > 230 && quote.lengthM < 300, `longueur ${quote.lengthM}`);
  assert.equal(quote.cost, Math.round(quote.lengthM * CABLE_SPEC.costPerM));
  assert.ok(CABLE_SPEC.costPerM > LINE_SPEC.costPerM, 'plus cher au mètre que la ligne HT');
  const b = cmd(sim, 'buildCable', { a: { id: park[0]!.id }, b: { x: road.x, z: road.z + 3 } });
  assert.ok(b.ok, b.message);
  const built = b.data as { cable: { id: number; b: number; active: boolean }; cost: number };
  assert.equal(built.cable.b, 0, 'extrémité route');
  assert.equal(built.cable.active, true);
  assert.ok(sim.economy.money < money0 - quote.cost / 100 + 1, 'coût débité');
  advanceHours(sim, 2);
  s = elec.system.summary()!;
  assert.equal(s.isolatedFacilities, undefined, 'plus d’installation isolée');
  assert.equal(s.unlinked, 0, 'tout le bourg raccordé');
  assert.equal(s.cut, 0, 'aucune coupure (capacité non bloquante)');
  const eol = s.bySource.find((x) => x.source === 'eolien')!;
  assert.ok(eol.outputKw > 0, 'le parc produit pour la ville');
  assert.equal(elec.system.roadPowered(sim.net.segmentNear(0, 0, 5)!.segId), true, 'rue du bourg alimentée');
  const views = full(sim);
  assert.equal(views.cables?.length, 1);
  for (const f of views.facilities!) assert.equal(f.energized, true);
  assert.equal(views.lines!.length, 0, 'aucune ligne HT ni pylône');
});

test('câble souterrain : démolition (commande, annulation) ou démolition de l’éolienne -> coupure', () => {
  const { sim, elec } = powerTown({ days: 1 });
  const park = farPark(sim);
  sim.plugins.command('electricite', 'forceWind', { ms: 13 });
  const road = sim.net.segmentNear(0, 0, 10)!;
  const b = cmd(sim, 'buildCable', { a: { x: road.x, z: road.z }, b: { id: park[0]!.id } }); // sens inverse accepté
  assert.ok(b.ok, b.message);
  const id = (b.data as { cable: { id: number } }).cable.id;
  advanceHours(sim, 1);
  assert.equal(elec.system.summary()!.unlinked, 0);
  const r = cmd(sim, 'removeCable', { id });
  assert.ok(r.ok && (r.data as { removed: boolean }).removed);
  assert.equal((cmd(sim, 'removeCable', { id }).data as { removed: boolean }).removed, false, 'déjà retiré');
  advanceHours(sim, 1);
  assert.ok(elec.system.summary()!.unlinked > 0, 'coupé sans le câble');
  assert.equal(elec.system.summary()!.isolatedFacilities, 3);
  // Nouveau câble puis démolition de l'éolienne raccordée : le câble disparaît avec elle.
  assert.ok(cmd(sim, 'buildCable', { a: { id: park[0]!.id }, b: { x: road.x, z: road.z } }).ok);
  advanceHours(sim, 1);
  assert.equal(elec.system.summary()!.unlinked, 0);
  assert.ok(sim.demolish({ buildingId: park[0]!.id }).ok);
  advanceHours(sim, 1);
  assert.equal(elec.system.state.cables!.length, 0, 'câble retiré avec l’installation');
  assert.ok(elec.system.summary()!.unlinked > 0, 'le reste du parc est de nouveau isolé');
});

test('câble souterrain : entre deux installations éloignées, sauvegarde et rechargement identiques ; ancienne partie sans câble', () => {
  const { sim, elec } = powerTown({ days: 1 });
  const park = farPark(sim);
  // Éolienne isolée au nord-est, reliée au parc par un câble entre installations.
  const lone = placeAt(sim, 'eolienne', [[400, 400], [400, 300], [300, 400]]);
  sim.plugins.command('electricite', 'forceWind', { ms: 13 });
  const road = sim.net.segmentNear(0, 0, 10)!;
  // Sauvegarde avant tout câble : aucun champ `cables` (format inchangé).
  const before = JSON.parse(JSON.stringify(sim.toSave())) as ReturnType<Simulation['toSave']>;
  assert.equal('cables' in (before.plugins!.electricite!.data as { power: Record<string, unknown> }).power, false);
  assert.ok(cmd(sim, 'buildCable', { a: { id: park[0]!.id }, b: { x: road.x, z: road.z } }).ok);
  const c2 = cmd(sim, 'buildCable', { a: { id: lone.id }, b: { id: park[2]!.id } });
  assert.ok(c2.ok, c2.message);
  advanceHours(sim, 2);
  const v = full(sim).facilities!.find((f) => f.id === lone.id)!;
  assert.notEqual(v.isolated, true, 'éolienne isolée reliée au parc');
  assert.equal(v.energized, true);
  const save = JSON.parse(JSON.stringify(sim.toSave())) as ReturnType<Simulation['toSave']>;
  const e2 = createElectricitePlugin();
  const t = new Simulation([e2]);
  t.setCatalog(powerCatalog());
  assert.equal(t.fromSave(save), null);
  advanceHours(t, 1);
  advanceHours(sim, 1);
  assert.equal(e2.system.state.cables!.length, 2, 'câbles rechargés');
  assert.deepEqual(e2.system.summary(), elec.system.summary());
  assert.equal(e2.system.summary()!.unlinked, 0);
  // Nouveau câble après rechargement : identifiant suivant.
  const road2 = t.net.segmentNear(-100, 80, 10)!;
  const c3 = cmd(t, 'buildCable', { a: { id: lone.id }, b: { x: road2.x, z: road2.z } });
  assert.ok(c3.ok, c3.message);
  assert.equal((c3.data as { cable: { id: number } }).cable.id, 3);
  // Ancienne partie (sans champ `cables`) : se recharge à l'identique.
  const e3 = createElectricitePlugin();
  const u = new Simulation([e3]);
  u.setCatalog(powerCatalog());
  assert.equal(u.fromSave(before), null);
  assert.equal(e3.system.state.cables, undefined);
  advanceHours(u, 1);
  assert.equal(e3.system.summary()!.isolatedFacilities, 4);
});

test('câble souterrain : refus des tracés invalides', () => {
  const { sim, elec } = powerTown({ days: 1 });
  const park = farPark(sim);
  const road = sim.net.segmentNear(0, 0, 10)!;
  const road2 = sim.net.segmentNear(-100, 80, 10)!;
  const no = (a: unknown, b: unknown, re: RegExp): void => {
    const r = cmd(sim, 'quoteCable', { a, b });
    assert.equal(r.ok, false, `refus attendu : ${JSON.stringify({ a, b })}`);
    assert.match(r.message ?? '', re);
    assert.equal(cmd(sim, 'buildCable', { a, b }).ok, false);
  };
  no({ x: road.x, z: road.z }, { x: road2.x, z: road2.z }, /pas deux routes/);
  no({ id: park[0]!.id }, { x: 300, z: -200 }, /Aucune route/);
  no({ id: park[0]!.id }, { id: park[0]!.id }, /différentes/);
  no({ id: 999_999 }, { x: road.x, z: road.z }, /installation électrique/);
  const house = sim.buildings.id[0]!;
  no({ id: house }, { x: road.x, z: road.z }, /installation électrique/);
  no({ id: park[0]!.id }, { x: 'a' }, /./);
  assert.equal(elec.system.state.cables, undefined, 'rien posé');
  assert.ok(cmd(sim, 'buildCable', { a: { id: park[0]!.id }, b: { x: road.x, z: road.z } }).ok);
  // Doublon : même installation, même réseau routier (autre point de la même rue).
  no({ id: park[0]!.id }, { x: road.x - 40, z: road.z }, /déjà reliée/);
  assert.ok(cmd(sim, 'buildCable', { a: { id: park[1]!.id }, b: { id: park[2]!.id } }).ok);
  no({ id: park[2]!.id }, { id: park[1]!.id }, /déjà reliées/);
  // Trop long : la carte de test (1 km) est plus petite que le plafond (3 km) ; plafond abaissé le temps du contrôle.
  assert.ok(CABLE_SPEC.maxLengthM >= 1000);
  const maxL = CABLE_SPEC.maxLengthM;
  CABLE_SPEC.maxLengthM = 100;
  try { no({ id: park[2]!.id }, { x: road2.x, z: road2.z }, /trop long/); } finally { CABLE_SPEC.maxLengthM = maxL; }
  // Fonds insuffisants.
  sim.economy.money = 1;
  no({ id: park[2]!.id }, { x: road2.x, z: road2.z }, /Fonds insuffisants/);
  assert.equal(elec.system.state.cables!.length, 2);
});
