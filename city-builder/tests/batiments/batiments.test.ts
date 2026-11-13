/**
 * Module « batiments » — propriété de la branche p2a-batiments (inclus dans `npm test`).
 * Enregistrement dans les registres, commandes du module (via le protocole), deltas et instantané,
 * section de sauvegarde versionnée (migration v1 -> v2, aller-retour) et absence totale d'effet sans quartier.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SIM_PLUGINS } from '../../src/sim/plugins';
import { RENDER_PLUGINS } from '../../src/render/plugins';
import { UI_PANELS } from '../../src/ui/panels/index';
import { BATIMENTS_SAVE_VERSION, emptyBatimentsSave, migrateBatiments } from '../../src/sim/save-sections/batiments';
import { Simulation } from '../../src/sim/world';
import { handleCommand } from '../../src/sim/handler';
import { PROTOCOL_VERSION } from '../../src/shared/constants';
import type { ResultMessage } from '../../src/shared/protocol';
import type { AssetCatalog } from '../../src/shared/catalog';
import type {
  BatimentsApplyReport, BatimentsDelta, BatimentsDistrictView, BatimentsPlanView, BatimentsProposalView,
} from '../../src/shared/protocol-ext/batiments';
import { applyPlan, type DistrictActions, type DistrictPlan } from '../../src/sim/districts/index';
import { ACTIONS_SERVICE } from '../../src/sim/plugins/batiments';

const root = join(import.meta.dirname, '..', '..');
const catalog = JSON.parse(readFileSync(join(root, 'assets', 'catalog.json'), 'utf8')) as AssetCatalog;

function sim(seed = 3): Simulation {
  const s = new Simulation();
  s.setCatalog(catalog);
  s.newGame({ seed, mapChunks: 8, startMoney: 5e9, cityName: 'Quartiers', terrain: { hydrology: 'aucune', rivers: 0 } });
  return s;
}

/** Commande de module par le protocole (comme le thread principal). */
let reqId = 1;
function cmd(s: Simulation, name: string, payload?: unknown): ResultMessage {
  const args: Record<string, unknown> = { plugin: 'batiments', name };
  if (payload !== undefined) args['payload'] = payload;
  return handleCommand(s, { kind: 'cmd', reqId: reqId++, name: 'pluginCommand', args }).result as ResultMessage;
}
function data<T>(r: ResultMessage): T {
  assert.ok(r.ok, r.ok ? '' : r.error.message);
  return (r.ok ? (r.data as { data: T }).data : undefined) as T;
}

/** Publie l'API d'écriture attendue du cœur (docs/requests/batiments.md) sur le contexte du module. */
function provideActions(s: Simulation): void {
  const actions: DistrictActions = { buildRoad: (a) => s.buildRoad(a), placeBuilding: (a) => s.placeBuilding(a), demolish: (a) => s.demolish(a) };
  s.plugins.contextOf('batiments')!.provide(ACTIONS_SERVICE, actions);
}

test('batiments : module enregistré (simulation, rendu, interface)', () => {
  assert.ok(SIM_PLUGINS.some((p) => p.id === 'batiments'));
  assert.ok(RENDER_PLUGINS.some((p) => p.id === 'batiments'));
  assert.ok(UI_PANELS.some((p) => p.id === 'batiments'));
});

test('batiments : section de sauvegarde courante relue à l\'identique, migration v1 -> v2', () => {
  assert.equal(BATIMENTS_SAVE_VERSION, 2);
  assert.deepEqual(migrateBatiments(emptyBatimentsSave(), BATIMENTS_SAVE_VERSION), emptyBatimentsSave());
  // v1 = gabarit vide de la préparation §0 : migrée vers un état vide, sans erreur.
  assert.deepEqual(migrateBatiments({}, 1), emptyBatimentsSave());
  assert.throws(() => migrateBatiments({}, BATIMENTS_SAVE_VERSION + 1), /plus récente/);
  assert.throws(() => migrateBatiments('texte', 1), /objet attendu/);
  assert.throws(() => migrateBatiments({ districts: 'non' }, 2), /illisibles/);
});

test('batiments : sans quartier, le module n\'écrit ni delta, ni instantané, ni sauvegarde', () => {
  const s = sim();
  for (let i = 0; i < 48 * 31; i++) s.tick(30); // plus d'un mois
  assert.equal(s.takeDelta().ext, undefined);
  assert.equal(s.snapshot().ext, undefined);
  assert.equal('plugins' in s.toSave(), false);
});

test('batiments : planDistrict renvoie un plan sans rien construire ni enregistrer', () => {
  const s = sim();
  const spec = { type: 'faubourg', x: 0, z: 0, width: 320, depth: 240, seed: 11 };
  const plan = data<{ plan: BatimentsPlanView }>(cmd(s, 'planDistrict', spec)).plan;
  assert.ok(plan.roads.length > 8);
  assert.ok(plan.lots.length > 20);
  assert.equal(s.buildings.count, 0, 'aucune construction');
  assert.equal(s.net.segCount, 0, 'aucune route');
  assert.deepEqual(data<{ districts: BatimentsDistrictView[] }>(cmd(s, 'listDistricts')).districts, [], 'aucun quartier enregistré');
  // Déterminisme à travers le protocole.
  const plan2 = data<{ plan: BatimentsPlanView }>(cmd(s, 'planDistrict', spec)).plan;
  assert.deepEqual(plan2, plan);
  // Arguments invalides.
  const bad = cmd(s, 'planDistrict', { type: 'inconnu', x: 0, z: 0, width: 200, depth: 200 });
  assert.ok(!bad.ok && bad.error.code === 'INVALID_ARGS');
  const bad2 = cmd(s, 'planDistrict', { type: 'faubourg', x: 'a', z: 0, width: 200, depth: 200 });
  assert.ok(!bad2.ok && bad2.error.code === 'INVALID_ARGS');
  const unknown = cmd(s, 'commandeInconnue');
  assert.ok(!unknown.ok && unknown.error.code === 'NOT_FOUND');
});

test('batiments : applyDistrict exige l\'API d\'écriture, puis construit réellement', () => {
  const s = sim(4);
  const spec = { type: 'pavillonnaire', x: 0, z: 0, width: 288, depth: 208, seed: 21 };
  const refus = cmd(s, 'applyDistrict', spec);
  assert.ok(!refus.ok && refus.error.code === 'NOT_IMPLEMENTED' && refus.error.message.includes('planDistrict'));
  assert.equal(s.buildings.count, 0, 'rien construit en l\'absence d\'API');

  provideActions(s);
  const r = data<{ district: BatimentsDistrictView; report: BatimentsApplyReport }>(cmd(s, 'applyDistrict', spec));
  assert.ok(r.report.lotsOk > 20, JSON.stringify(r.report));
  assert.equal(s.buildings.count, r.report.lotsOk);
  assert.ok(s.net.segCount >= r.report.roadsOk);
  assert.equal(r.district.buildings, r.report.lotsOk, 'le quartier enregistré voit ses bâtiments');
  assert.ok(r.district.distinctAssets >= 4);
  assert.ok(r.district.repetitionIndex <= 0.4);
  const report = data<{ district: BatimentsDistrictView; diversity: Record<string, number> }>(cmd(s, 'districtReport', { id: r.district.id }));
  assert.equal(report.district.id, r.district.id);
  assert.equal(report.diversity['count'], s.buildings.count);
  assert.ok(!cmd(s, 'districtReport', { id: 999 }).ok);
});

test('batiments : deltas, instantané et bascules overlay / évolution automatique', () => {
  const s = sim(7);
  assert.equal(s.takeDelta().ext, undefined);
  assert.equal(data<{ overlay: boolean }>(cmd(s, 'setOverlay', { on: true })).overlay, true);
  const d = s.takeDelta().ext?.['batiments'] as BatimentsDelta | undefined;
  assert.ok(d && d.overlay === true && d.version === 1);
  assert.equal(s.takeDelta().ext, undefined, 'aucun delta tant que rien ne change');
  data<unknown>(cmd(s, 'registerDistrict', { type: 'affaires', x: 0, z: 0, width: 256, depth: 192, seed: 3 }));
  const d2 = s.takeDelta().ext?.['batiments'] as BatimentsDelta;
  assert.equal(d2.districts.length, 1);
  assert.equal(d2.districts[0]!.type, 'affaires');
  assert.ok(d2.districts[0]!.bounds.maxX > d2.districts[0]!.bounds.minX);
  const snap = s.snapshot().ext?.['batiments'] as BatimentsDelta;
  assert.equal(snap.districts.length, 1);
  assert.equal(data<{ autoEvolve: boolean }>(cmd(s, 'setAutoEvolve', { on: true })).autoEvolve, true);
  assert.equal(data<{ removed: boolean }>(cmd(s, 'forgetDistrict', { id: d2.districts[0]!.id })).removed, true);
  assert.deepEqual(data<{ districts: BatimentsDistrictView[] }>(cmd(s, 'listDistricts')).districts, []);
});

test('batiments : propositions d\'évolution produites, appliquées ou écartées', () => {
  const s = sim(8);
  provideActions(s);
  const plan = data<{ plan: BatimentsPlanView }>(cmd(s, 'planDistrict', { type: 'faubourg', x: 0, z: 0, width: 320, depth: 240, seed: 31 })).plan;
  const actions: DistrictActions = { buildRoad: (a) => s.buildRoad(a), placeBuilding: (a) => s.placeBuilding(a), demolish: (a) => s.demolish(a) };
  const rep = applyPlan(plan as unknown as DistrictPlan, actions);
  assert.ok(rep.lotsOk > 20);
  data<unknown>(cmd(s, 'registerDistrict', { type: 'faubourg', x: 0, z: 0, width: 320, depth: 240, seed: 31 }));
  // 14 mois de jeu : la valeur monte, des propositions apparaissent (début de mois).
  for (let i = 0; i < 48 * 30 * 14; i++) s.tick(30);
  const proposals = data<{ proposals: BatimentsProposalView[] }>(cmd(s, 'listProposals')).proposals;
  assert.ok(proposals.length > 0, 'au moins une proposition après 14 mois');
  const p = proposals[0]!;
  assert.ok(['densification', 'valorisation'].includes(p.kind));
  assert.ok(s.buildings.indexOf(p.buildingId) >= 0, 'la proposition vise un bâtiment existant');
  const before = s.buildings.count;
  const applied = data<{ buildingId: number; cost: number }>(cmd(s, 'applyProposal', { id: p.id }));
  assert.ok(applied.buildingId > 0);
  assert.equal(s.buildings.count, before, 'un bâtiment remplacé, pas ajouté');
  assert.equal(s.catalog!.assets[s.buildings.assetIndex[s.buildings.indexOf(applied.buildingId)!]!]!.id, p.toAsset);
  assert.ok(!cmd(s, 'applyProposal', { id: p.id }).ok, 'proposition consommée');
  const rest = data<{ proposals: BatimentsProposalView[] }>(cmd(s, 'listProposals')).proposals;
  if (rest.length > 0) {
    assert.equal(data<{ removed: boolean }>(cmd(s, 'dismissProposal', { id: rest[0]!.id })).removed, true);
  }
});

test('batiments : sauvegarde aller-retour (quartiers, propositions, options) et ancienne sauvegarde', () => {
  const s = sim(9);
  data<unknown>(cmd(s, 'registerDistrict', { type: 'grands_ensembles', x: 64, z: -32, width: 256, depth: 192, seed: 77 }));
  data<unknown>(cmd(s, 'setOverlay', { on: true }));
  const save = JSON.parse(JSON.stringify(s.toSave())) as Record<string, unknown>;
  const sections = save['plugins'] as Record<string, { v: number; data: { districts: unknown[] } }>;
  assert.equal(sections['batiments']!.v, BATIMENTS_SAVE_VERSION);
  assert.equal(sections['batiments']!.data.districts.length, 1);

  const t = new Simulation();
  t.setCatalog(catalog);
  assert.equal(t.fromSave(save), null);
  const districts = data<{ districts: BatimentsDistrictView[] }>(cmd(t, 'listDistricts')).districts;
  assert.equal(districts.length, 1);
  assert.equal(districts[0]!.type, 'grands_ensembles');
  assert.equal(districts[0]!.x, 64);
  assert.equal(districts[0]!.seed, 77);
  assert.deepEqual(t.toSave().plugins?.['batiments'], s.toSave().plugins?.['batiments']);

  // Sauvegarde ancienne (section v1 vide) : chargée, le module repart d'un état vide.
  const old = { ...save, plugins: { batiments: { v: 1, data: {} } } };
  const u = new Simulation();
  u.setCatalog(catalog);
  assert.equal(u.fromSave(old), null);
  assert.deepEqual(data<{ districts: BatimentsDistrictView[] }>(cmd(u, 'listDistricts')).districts, []);
  assert.ok(!u.notices.some((n) => n.message.includes('batiments')), 'aucune notification d\'erreur');

  // Sauvegarde sans aucune section de module : toujours chargeable.
  const bare = { ...save };
  delete bare['plugins'];
  const v = new Simulation();
  v.setCatalog(catalog);
  assert.equal(v.fromSave(bare), null);
  assert.equal('plugins' in v.toSave(), false);
});

test('batiments : init du protocole puis commande hors partie', () => {
  const s = new Simulation();
  const r = handleCommand(s, { kind: 'cmd', reqId: reqId++, name: 'init', args: { protocolVersion: PROTOCOL_VERSION, catalog } }).result as ResultMessage;
  assert.ok(r.ok);
  const noGame = cmd(s, 'listDistricts');
  assert.ok(!noGame.ok && noGame.error.code === 'NO_GAME');
});
