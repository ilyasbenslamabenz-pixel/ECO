/**
 * Tests du module « circulation » — propriété de la branche p2a-circulation (inclus dans `npm test`).
 * Enregistrement, section de sauvegarde (aller-retour, migration, anciennes sauvegardes sans section),
 * deltas / instantané du module et commandes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIM_PLUGINS } from '../../src/sim/plugins';
import { RENDER_PLUGINS } from '../../src/render/plugins';
import { UI_PANELS } from '../../src/ui/panels/index';
import { CIRCULATION_SAVE_VERSION, emptyCirculationSave, migrateCirculation, readCirculationSave } from '../../src/sim/save-sections/circulation';
import { Simulation } from '../../src/sim/world';
import { buildTown, townCatalog } from '../sim/fixtures';
import type { CirculationDelta, CirculationSnapshot, CirculationStats, FeuJunctionState } from '../../src/shared/protocol-ext/circulation';
import { formatCirculation } from '../../src/ui/panels/circulation';

/** Avenues nord-sud (x) et rues est-ouest (z) du réseau de test : 6 carrefours à feux. */
const AVENUES = [-120, 0, 120];
const RUES = [0, 80];

/**
 * Ville de test du module : deux rues est-ouest croisées par trois avenues (carrefours à feux),
 * logements au nord, emplois au sud, tous reliés au réseau.
 */
function sim(): Simulation {
  const s = new Simulation();
  s.setCatalog(townCatalog());
  s.newGame({ seed: 7, mapChunks: 4, startMoney: 200_000_000, cityName: 'Circulation', terrain: { hydrology: 'aucune', rivers: 0 } });
  for (const z of RUES) assert.ok(s.buildRoad({ kind: 'street', type: 'street', points: [-240, z, 240, z] }).ok, `rue z=${z}`);
  for (const x of AVENUES) assert.ok(s.buildRoad({ kind: 'avenue', type: 'avenue', points: [x, -80, x, 170] }).ok, `avenue x=${x}`);
  let posees = 0;
  for (let x = -220; x <= 220; x += 30) {
    if (AVENUES.some((a) => Math.abs(x - a) < 26)) continue;
    for (const [z, id] of [[-16, 'immeuble'], [100, 'bureaux'], [40, 'boutique']] as [number, string][]) {
      if (s.placeBuilding({ assetId: id, x, z, rot: 0 }).ok) posees++;
    }
  }
  assert.ok(posees >= 20, `bâtiments posés : ${posees}`);
  for (let i = 0; i < 300; i++) s.tick(1);
  return s;
}

test('circulation : module enregistré (simulation, rendu, interface)', () => {
  assert.ok(SIM_PLUGINS.some((p) => p.id === 'circulation'));
  assert.ok(RENDER_PLUGINS.some((p) => p.id === 'circulation'));
  assert.ok(UI_PANELS.some((p) => p.id === 'circulation'));
});

test('circulation : section de sauvegarde courante relue à l\'identique', () => {
  assert.deepEqual(migrateCirculation(emptyCirculationSave(), CIRCULATION_SAVE_VERSION), emptyCirculationSave());
  assert.throws(() => migrateCirculation({}, CIRCULATION_SAVE_VERSION + 1), /plus récente/);
  assert.throws(() => migrateCirculation('texte', 1), /objet attendu/);
});

test('circulation : lecture robuste d\'une section (champs exotiques ignorés, valeurs par défaut)', () => {
  const r = readCirculationSave({ feux: [{ n: 3, p: 9, st: 7, t: -2 }, null as never, { n: NaN, p: 0, st: 0, t: 0 }], overlay: true });
  assert.deepEqual(r.feux, [{ n: 3, p: 9, st: 2, t: 0 }]);
  assert.equal(r.reroute, true, 'réacheminement actif par défaut');
  assert.equal(r.overlay, true);
  const vide = readCirculationSave({});
  assert.deepEqual(vide.feux, []);
  assert.equal(vide.overlay, false);
});

test('circulation : les feux sont sauvegardés puis restaurés à l\'identique', () => {
  const s = sim();
  const before = s.traffic.signalSnapshot();
  assert.ok(before.length >= 2, `carrefours à feux : ${before.length}`);
  const save = s.toSave() as unknown as { plugins?: Record<string, { v: number; data: unknown }> };
  const section = save.plugins?.['circulation'];
  assert.ok(section, 'section circulation écrite');
  assert.equal(section!.v, CIRCULATION_SAVE_VERSION);
  assert.ok((section!.data as { feux: unknown[] }).feux.length === before.length);

  const s2 = new Simulation();
  s2.setCatalog(townCatalog());
  assert.equal(s2.fromSave(save as never), null);
  s2.tick(1); // reconstruit le graphe de circulation
  const after = s2.traffic.signalSnapshot();
  const by = (l: typeof before): Map<number, (typeof before)[number]> => new Map(l.map((x) => [x.nodeId, x]));
  const a = by(after), b = by(before);
  assert.equal(a.size, b.size, 'mêmes carrefours à feux');
  for (const [id, exp] of b) {
    const got = a.get(id);
    assert.ok(got, `carrefour ${id} restauré`);
    assert.equal(got!.phase, exp.phase, `phase du carrefour ${id}`);
    assert.equal(got!.stage, exp.stage, `étape du carrefour ${id}`);
    // le chargement a consommé un pas de 0,1 s pour reconstruire le graphe
    assert.ok(Math.abs(got!.timer - exp.timer - 0.1) < 0.02, `chronomètre du carrefour ${id} : ${got!.timer} vs ${exp.timer}`);
  }
});

test('circulation : une sauvegarde SANS section du module se charge (rétrocompatibilité)', () => {
  const s = sim();
  const save = s.toSave() as unknown as { plugins?: Record<string, unknown> };
  delete save.plugins; // sauvegarde d'avant le module
  const s2 = new Simulation();
  s2.setCatalog(townCatalog());
  assert.equal(s2.fromSave(save as never), null);
  s2.tick(1);
  assert.ok(s2.traffic.signalSnapshot().length >= 2, 'feux reconstruits depuis le réseau');
  assert.equal(s2.notices.filter((n) => n.level === 'danger').length, 0);
});

test('circulation : delta et instantané portent la carte de congestion et les indicateurs', () => {
  const s = sim();
  const snap = s.snapshot();
  const ext = snap.ext?.['circulation'] as CirculationSnapshot | undefined;
  assert.ok(ext, 'snapshot.ext.circulation présent');
  assert.ok(ext!.layout && ext!.layout.edgeIds.length > 0, 'géométrie des tronçons envoyée');
  assert.ok(ext!.congestion && ext!.congestion.level.length === ext!.layout!.edgeIds.length);
  assert.equal(ext!.overlay, false);
  assert.ok((ext!.stats as CirculationStats).connectedBuildings > 0);

  // la géométrie n'est pas renvoyée à chaque delta ; la carte l'est environ une fois par seconde (10 deltas)
  let withMap = 0, withLayout = 0;
  for (let i = 0; i < 30; i++) {
    s.tick(1);
    const d = s.takeDelta().ext?.['circulation'] as CirculationDelta | undefined;
    if (!d) continue;
    if (d.congestion) withMap++;
    if (d.layout) withLayout++;
  }
  assert.equal(withLayout, 0, 'géométrie envoyée seulement après un changement de réseau');
  assert.ok(withMap >= 2 && withMap <= 4, `cartes envoyées : ${withMap}`);
});

test('circulation : commandes du module (indicateurs, feux, passages, réglages, carte)', () => {
  const s = sim();
  const cmd = (name: string, payload?: unknown): { ok: boolean; data?: unknown; error?: { code: string; message: string } } =>
    s.pluginCommand({ plugin: 'circulation', name, payload }) as never;

  const stats = cmd('stats');
  assert.ok(stats.ok);
  assert.ok((stats.data as { data: CirculationStats }).data.signals >= 2);

  const feux = (cmd('feux').data as { data: FeuJunctionState[] }).data;
  assert.ok(feux.length >= 2);
  assert.ok(feux.every((j) => j.arms.length >= 3 && j.phases >= 2));

  const passages = (cmd('passages').data as { data: unknown[] }).data;
  assert.ok(passages.length >= 4, `passages piétons : ${passages.length}`);
  const proches = (cmd('passages', { x: feux[0]!.x, z: feux[0]!.z, radius: 40 }).data as { data: unknown[] }).data;
  assert.ok(proches.length > 0 && proches.length < passages.length);

  assert.deepEqual((cmd('afficherCongestion', { on: true }).data as { data: unknown }).data, { on: true });
  const reglages = (cmd('reglages', { reroute: false, demandScale: 2 }).data as { data: { reroute: boolean; demandScale: number } }).data;
  assert.deepEqual(reglages, { reroute: false, demandScale: 2 });
  assert.equal(s.traffic.rerouteEnabled, false);
  cmd('reglages', { reroute: true });

  const inconnue = cmd('inconnue');
  assert.ok(!inconnue.ok && inconnue.error!.code === 'INVALID_ARGS');
});

test('circulation : le panneau formate les indicateurs en français', () => {
  const s = sim();
  const stats = (s.pluginCommand({ plugin: 'circulation', name: 'stats' }) as { data: { data: CirculationStats } }).data.data;
  const lignes = formatCirculation(stats);
  assert.ok(lignes.some((l) => l.label === 'Véhicules en circulation'));
  assert.ok(lignes.find((l) => l.label === 'Vitesse moyenne')!.value.endsWith(' km/h'));
  assert.ok(lignes.find((l) => l.label === 'Réseau saturé')!.value.includes('%'));
});
