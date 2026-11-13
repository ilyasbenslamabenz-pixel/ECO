/**
 * Évolution des quartiers (src/sim/districts/evolution.ts) : valeur, stade, propositions de densification et de
 * valorisation, application réelle d'une proposition dans une `Simulation`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Simulation } from '../../src/sim/world';
import type { AssetCatalog, CatalogAsset } from '../../src/shared/catalog';
import {
  applyProposal, emptyDistrictState, EVOLUTION_THRESHOLDS, proposeEvolutions, targetValue, updateDistrictState,
  type DistrictActions, type DistrictMeasures, type EvolutionCandidate,
} from '../../src/sim/districts/index';

const root = join(import.meta.dirname, '..', '..');
const catalog = JSON.parse(readFileSync(join(root, 'assets', 'catalog.json'), 'utf8')) as AssetCatalog;
const asset = (id: string): CatalogAsset => catalog.assets.find((a) => a.id === id)!;

function measures(over: Partial<DistrictMeasures> = {}): DistrictMeasures {
  return {
    buildings: 20, residents: 180, capacity: 200, jobs: 40, roadAccessRate: 1,
    attractivity: 3, pollution: 0, services: 3, repetitionIndex: 0.1, ...over,
  };
}

function candidate(id: string, over: Partial<EvolutionCandidate> = {}): EvolutionCandidate {
  return { buildingId: 1, asset: asset(id), variant: 0, x: 0, z: 0, rot: 0, occupancy: 1, roadAccess: true, ...over };
}

test('évolution : la valeur suit les mesures (services et attractivité montent, pollution descend)', () => {
  const bon = targetValue(measures());
  const pollue = targetValue(measures({ pollution: 12, services: 0, attractivity: 0 }));
  const vide = targetValue(measures({ residents: 10, roadAccessRate: 0.2 }));
  assert.ok(bon > pollue + 15, `${bon} vs ${pollue}`);
  assert.ok(bon > vide + 10, `${bon} vs ${vide}`);
  assert.ok(targetValue(measures({ buildings: 0 })) === 50, 'quartier vide : valeur neutre');
});

test('évolution : montée de stade par pression, déclin quand la valeur s\'effondre', () => {
  let st = emptyDistrictState();
  for (let m = 0; m < 12; m++) st = updateDistrictState(st, measures());
  assert.ok(st.value >= EVOLUTION_THRESHOLDS.value, `valeur ${st.value}`);
  assert.ok(st.stage >= 2, `stade ${st.stage}`);
  assert.equal(st.ageMonths, 12);
  const mauvais = measures({ residents: 0, pollution: 20, services: 0, attractivity: 0, roadAccessRate: 0.1, repetitionIndex: 0.9 });
  let bas = st;
  for (let m = 0; m < 40; m++) bas = updateDistrictState(bas, mauvais);
  assert.ok(bas.value < EVOLUTION_THRESHOLDS.decline, `valeur ${bas.value}`);
  assert.equal(bas.stage, 0, 'retour au stade initial après déclin');
});

test('évolution : aucune proposition sous les seuils', () => {
  const st = { ...emptyDistrictState(), value: 40, stage: 1 };
  const out = proposeEvolutions([candidate('maison_pavillon_enduit')], catalog.assets, {
    districtId: 1, type: 'pavillonnaire', state: st, measures: measures(), nextId: 1, rand: () => 0.5,
  });
  assert.deepEqual(out, []);
  // Valeur haute mais stade 0 (quartier jeune) : pas de densification, au plus une valorisation.
  const jeune = { ...emptyDistrictState(), value: 70, stage: 0 };
  const out2 = proposeEvolutions([candidate('maison_pavillon_enduit')], catalog.assets, {
    districtId: 1, type: 'pavillonnaire', state: jeune, measures: measures(), nextId: 1, rand: () => 0.5,
  });
  assert.ok(out2.every((p) => p.kind === 'valorisation'), JSON.stringify(out2.map((p) => p.kind)));
});

test('évolution : densification vers la catégorie supérieure, emprise compatible', () => {
  const st = { ...emptyDistrictState(), value: 80, stage: 2 };
  const out = proposeEvolutions([candidate('mitoyennes_brique')], catalog.assets, {
    districtId: 3, type: 'faubourg', state: st, measures: measures(), nextId: 10, rand: () => 0.3,
  });
  assert.ok(out.length >= 1);
  const p = out[0]!;
  assert.equal(p.kind, 'densification');
  assert.equal(p.id, 10);
  assert.equal(p.districtId, 3);
  assert.equal(p.fromAsset, 'mitoyennes_brique');
  const to = asset(p.toAsset);
  assert.equal(to.category, 'apartment_low', `catégorie ${to.category}`);
  const from = asset(p.fromAsset);
  assert.ok(to.footprint.tilesX <= from.footprint.tilesX && to.footprint.tilesZ <= from.footprint.tilesZ, 'emprise compatible');
  assert.ok(p.reason.includes('occupation'));
});

test('évolution : une proposition s\'applique réellement (démolition + construction au même endroit)', () => {
  const s = new Simulation();
  s.setCatalog(catalog);
  s.newGame({ seed: 5, mapChunks: 8, startMoney: 5e9, cityName: 'Évolution', terrain: { hydrology: 'aucune', rivers: 0 } });
  const road = s.buildRoad({ type: 'street', points: [-120, 0, 120, 0] });
  assert.ok(road.ok, road.ok ? '' : road.error.message);
  const placed = s.placeBuilding({ assetId: 'mitoyennes_brique', x: 0, z: -16, rot: 0, variant: 0 });
  assert.ok(placed.ok, placed.ok ? '' : placed.error.message);
  const id = placed.ok ? placed.data.buildingId : 0;
  const i = s.buildings.indexOf(id);
  assert.equal(s.buildings.roadAccess[i], 1, 'accès route avant remplacement');

  const st = { ...emptyDistrictState(), value: 82, stage: 2 };
  const [proposal] = proposeEvolutions(
    [candidate('mitoyennes_brique', { buildingId: id, x: s.buildings.x[i]!, z: s.buildings.z[i]!, rot: s.buildings.rot[i]! })],
    catalog.assets,
    { districtId: 1, type: 'faubourg', state: st, measures: measures(), nextId: 1, rand: () => 0.1 },
  );
  assert.ok(proposal);
  const actions: DistrictActions = { buildRoad: (a) => s.buildRoad(a), placeBuilding: (a) => s.placeBuilding(a), demolish: (a) => s.demolish(a) };
  const r = applyProposal(proposal, actions);
  assert.ok(r.ok, r.message);
  assert.equal(s.buildings.count, 1, 'un seul bâtiment sur la parcelle');
  const j = s.buildings.indexOf(r.buildingId);
  assert.ok(j >= 0);
  assert.equal(s.catalog!.assets[s.buildings.assetIndex[j]!]!.id, proposal.toAsset);
  assert.equal(s.buildings.roadAccess[j], 1, 'le remplaçant garde son accès route');
  assert.ok(r.cost > 0);
});

test('évolution : en cas de refus, l\'ancien bâtiment est reposé', () => {
  const s = new Simulation();
  s.setCatalog(catalog);
  s.newGame({ seed: 6, mapChunks: 8, startMoney: 5e9, cityName: 'Repli', terrain: { hydrology: 'aucune', rivers: 0 } });
  assert.ok(s.buildRoad({ type: 'street', points: [-120, 0, 120, 0] }).ok);
  const placed = s.placeBuilding({ assetId: 'maison_pavillon_enduit', x: 0, z: -16, rot: 0, variant: 0 });
  assert.ok(placed.ok);
  const id = placed.ok ? placed.data.buildingId : 0;
  const actions: DistrictActions = { buildRoad: (a) => s.buildRoad(a), placeBuilding: (a) => s.placeBuilding(a), demolish: (a) => s.demolish(a) };
  const r = applyProposal({
    id: 1, districtId: 1, buildingId: id, fromAsset: 'maison_pavillon_enduit', fromVariant: 0,
    toAsset: 'modele_inexistant', variant: 0, x: 0, z: -16, rot: 0, kind: 'densification', reason: 'test', cost: 0,
  }, actions);
  assert.equal(r.ok, false);
  assert.equal(s.buildings.count, 1, 'le bâtiment d\'origine est reposé');
  const j = s.buildings.indexOf(r.buildingId);
  assert.equal(s.catalog!.assets[s.buildings.assetIndex[j]!]!.id, 'maison_pavillon_enduit');
});
