/**
 * Pénurie progressive : les lieux de travail (commerces, industrie) partagent le courant de leur classe et tournent
 * au ralenti (embauche plafonnée à la part reçue) au lieu d'être coupés un par un ; sous 10 % de part, la classe est
 * délestée. Réserve de courant faible signalée avant toute coupure (module alertes).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../../src/sim/world';
import { buildTown } from '../sim/fixtures';
import { advanceHours, placeFacilities, powerCatalog } from './fixtures';
import { BROWNOUT_MIN_SHARE } from '../../src/sim/power/system';
import { powerReserveShare } from '../../src/sim/plugins/alertes';
import { POWER_RESERVE_WARN } from '../../src/shared/protocol-ext/alertes';
import type { PluginContext } from '../../src/sim/plugins/types';

const town = (plants: string[]): Simulation => {
  const s = new Simulation(); s.setCatalog(powerCatalog());
  s.newGame({ seed: 1234, mapChunks: 4, startMoney: 80_000_000, cityName: 'Bourg-Régime', terrain: { hydrology: 'aucune', rivers: 0 } });
  buildTown(s);
  assert.ok(s.buildRoad({ type: 'street', points: [-220, 0, -220, 80] }).ok);
  advanceHours(s, 48);
  placeFacilities(s, 160, -100, 100, plants);
  advanceHours(s, 3);
  return s;
};
const idOf = (s: Simulation, asset: string): number => {
  for (let i = 0; i < s.buildings.count; i++) if (s.catalog!.assets[s.buildings.assetIndex[i]!]!.id === asset) return s.buildings.id[i]!;
  throw new Error(asset);
};
const elec = (s: Simulation): { powerFactor(id: number): number; serviceState(id: number): string } => s.plugins.service('electricite')!;
const summary = (s: Simulation): any => { const r = s.plugins.command('electricite', 'state', {}) as any; return (r.data?.data ?? r.data).summary; };

test('courant partiel : l\'usine tourne au ralenti (part partagée) au lieu d\'être coupée', () => {
  const s = town(['petite_centrale', 'petite_centrale']); // 300 kW pour ~370 kW demandés
  const usine = idOf(s, 'usine');
  const f = elec(s).powerFactor(usine);
  assert.ok(f > BROWNOUT_MIN_SHARE && f < 1, `part reçue ${f}`);
  assert.equal(elec(s).serviceState(usine), 'coupe', 'signalée comme délestée (icône, panneau)');
  // Logements et services restent servis en entier (priorités inchangées).
  assert.equal(elec(s).powerFactor(idOf(s, 'hopital')), 1);
  const ind = summary(s).byClass.find((b: any) => b.cls === 'industrie');
  assert.ok(Math.abs(ind.deliveredKw - ind.demandKw * f) < 1, 'courant livré = part × demande');
  // Embauche plafonnée : la démographie voit une activité partielle, pas un bâtiment fermé.
  assert.ok(Math.abs(s.demography!.activity(usine) - f) < 1e-9);
  // Plus de courant : pleine activité.
  placeFacilities(s, 240, -100, 100, ['petite_centrale'], false);
  assert.ok(s.buildRoad({ type: 'street', points: [-100, 160, -100, 240] }).ok);
  advanceHours(s, 2);
  assert.equal(elec(s).powerFactor(usine), 1);
});

test('courant très insuffisant : sous la part minimale, les lieux de travail sont délestés', () => {
  const s = town(['petite_centrale']); // 150 kW : rien ne reste pour le commerce et l'industrie
  assert.equal(elec(s).powerFactor(idOf(s, 'usine')), 0);
  assert.equal(s.demography!.activity(idOf(s, 'usine')), 0);
});

test('réserve de courant : marge calculée avant les coupures, aucune pendant une coupure', () => {
  const ctxWith = (sum: object | undefined): PluginContext => ({ use: () => ({ hasNetwork: () => true, summary: () => sum }) }) as unknown as PluginContext;
  const base = { demandKw: 1000, unlinkedKw: 0, cut: 0, availableKw: 1080 };
  assert.ok(Math.abs(powerReserveShare(ctxWith(base))! - 0.08) < 1e-9);
  assert.ok(powerReserveShare(ctxWith(base))! < POWER_RESERVE_WARN);
  assert.equal(powerReserveShare(ctxWith({ ...base, cut: 3 })), null, 'coupure : l\'alerte « sans électricité » prend le relais');
  assert.ok(powerReserveShare(ctxWith({ ...base, importedKw: 0 }))! > 3, 'appoint du réseau voisin compté dans la capacité');
  // Dans une vraie partie : 3 petites centrales (450 kW pour ~370 kW) = marge confortable, pas d'alerte.
  const s = town(['petite_centrale', 'petite_centrale', 'petite_centrale']);
  advanceHours(s, 2);
  const r = s.plugins.command('alertes', 'state', {}) as any;
  assert.equal((r.data?.data ?? r.data).powerReserve, undefined);
});
