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

import { readFileSync } from 'node:fs';
import type { CatalogAsset } from '../../src/shared/catalog';
import { createAlertesPlugin, needsWater } from '../../src/sim/plugins/alertes';
import { Simulation } from '../../src/sim/world';
import { wasteSim } from '../dechets/fixtures';
import { eauCatalog, eauPlugins, linkTown, newSim, place, runHours } from '../eau/helpers';

const stateOf = (s: Simulation): AlertesPayload => (s.plugins.command('alertes', 'state', undefined) as { data: { data: AlertesPayload } }).data.data;

test('alertes eau : ni éolienne, ni poste électrique, ni décharge (pas besoin d’eau) ; logements et usines oui', () => {
  const cat = JSON.parse(readFileSync(new URL('../../assets/catalog.buildings.procedural.json', import.meta.url), 'utf8')) as { assets: CatalogAsset[] };
  const byId = new Map(cat.assets.map((a) => [a.id, a]));
  for (const id of ['elec_eolienne', 'elec_poste', 'elec_ferme_solaire', 'dechets_decharge', 'eau_chateau_eau']) {
    const a = byId.get(id);
    if (a) assert.equal(needsWater(a), false, id);
  }
  for (const id of ['elec_centrale_gaz', 'industrie_atelier', 'public_ecole', 'commerce_boulangerie']) {
    const a = byId.get(id);
    if (a) assert.equal(needsWater(a), true, id);
  }
});

test('alertes déchets : pas de « poubelles pleines » sans service de collecte ; dépôt sur route isolée signalé', () => {
  const { sim: s } = wasteSim({ extra: [createAlertesPlugin()] });
  buildTown(s);
  runDays(s, 12);
  const svc = s.plugins.contextOf('dechets')!.use<{ binFull(id: number): boolean }>('dechets')!;
  let full = 0; for (let i = 0; i < s.buildings.count; i++) if (svc.binFull(s.buildings.id[i]!)) full++;
  assert.ok(full > 0, 'bacs pleins (aucune collecte)');
  assert.equal(stateOf(s).counts.waste, 0, 'aucun service de déchets : pas d’icône « poubelles pleines »');
  // Zone de traitement sur une rue NON reliée au bourg : le dépôt ne peut faire aucune tournée.
  const r = s.buildRoad({ type: 'street', points: [-220, 160, 220, 160] });
  assert.ok(r.ok);
  const ids: number[] = [];
  for (const [a, x] of [['t_depot', -180], ['t_incinerateur', -100]] as const) {
    const as = s.getAsset(a)!;
    const d = as.footprint.tilesZ * 8;
    const p = s.placeBuilding({ assetId: a, x, z: 160 - 8 - d / 2, rot: 0 });
    assert.ok(p.ok, p.ok ? '' : p.error.message);
    ids.push(p.data.buildingId);
  }
  runHours(s, 2);
  const p = stateOf(s);
  const maskOf = (id: number): number => { const k = p.items.findIndex((v, i) => i % 5 === 0 && v === id); return k >= 0 ? p.items[k + 1]! : 0; };
  assert.ok(maskOf(ids[0]!) & ALERT_BITS.isolated, 'dépôt sur réseau isolé signalé');
  assert.ok(p.counts.isolated >= 1);
  // Liaison au bourg : l'alerte disparaît.
  assert.ok(s.buildRoad({ type: 'street', points: [220, 0, 220, 160] }).ok);
  runHours(s, 2);
  const q = stateOf(s);
  const k = q.items.findIndex((v, i) => i % 5 === 0 && v === ids[0]);
  assert.ok(k < 0 || !(q.items[k + 1]! & ALERT_BITS.isolated), 'plus isolé une fois relié');
});

test('alertes eau : signalées dès le chargement (pas d’heure muette)', () => {
  const { plugins } = eauPlugins();
  const s = newSim(plugins);
  buildTown(s);
  linkTown(s);
  place(s, 'eau_station_pompage', 120, 96, 2);
  place(s, 'eau_usine_potabilisation', 150, 100, 2);
  runHours(s, 20);
  s.pluginCommand({ plugin: 'eau', name: 'settings', payload: { fundingWater: 0 } });
  runHours(s, 40);
  const before = stateOf(s).counts.water;
  assert.ok(before > 0, 'pénurie : alertes eau');
  const save = JSON.parse(JSON.stringify(s.toSave()));
  const s2 = new Simulation(eauPlugins().plugins);
  s2.setCatalog(eauCatalog());
  assert.equal(s2.fromSave(save), null);
  assert.equal(stateOf(s2).counts.water, before, 'mêmes alertes eau juste après le chargement');
});

test('pose sans accès routier : avertissement dans le résultat (aperçu dryRun compris), pas de refus', () => {
  const s = newTownSim(); buildTown(s);
  let far: { ok: boolean; data?: { noRoadAccess?: true; warning?: string } } | null = null;
  for (const [x, z] of [[360, 360], [-360, 360], [360, -360], [-360, -360], [400, 0], [0, 400]] as const) {
    const r = s.placeBuilding({ assetId: 'maison', x, z, rot: 0, dryRun: true });
    if (r.ok) { far = r; break; }
  }
  assert.ok(far?.ok, 'aperçu accepté');
  assert.equal(far!.data!.noRoadAccess, true);
  assert.match(far!.data!.warning ?? '', /accès routier/);
  // En bord de rue (emplacement d'une maison existante, démolie) : pas d'avertissement.
  const st = s.buildings;
  let k = -1;
  for (let i = 0; i < st.count; i++) if (st.roadAccess[i] && s.catalog!.assets[st.assetIndex[i]!]!.id === 'maison') { k = i; break; }
  assert.ok(k >= 0);
  const x = st.x[k]!, z = st.z[k]!, rot = st.rot[k]!;
  assert.ok(s.demolish({ buildingId: st.id[k]! }).ok);
  const r = s.placeBuilding({ assetId: 'maison', x, z, rot, dryRun: true });
  assert.ok(r.ok);
  assert.equal(r.data.noRoadAccess, undefined);
  assert.equal(r.data.warning, undefined);
});
