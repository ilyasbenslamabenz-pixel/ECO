/**
 * Module `eau` dans une vraie Simulation : dormant sans installation (partie identique tick à tick), activation,
 * deltas / instantanés, commandes, sauvegarde aller-retour (déterminisme), contrat municipal privé, migrations.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../../src/sim/world';
import { validateSave } from '../../src/sim/save-format';
import { eauSaveSection, migrateEau } from '../../src/sim/save-sections/eau';
import { EAU_SERVICE, type EauService } from '../../src/sim/plugins/eau';
import type { EauDelta, EauSnapshot } from '../../src/shared/protocol-ext/eau';
import { buildTown } from '../sim/fixtures';
import { eauCatalog, eauPlugins, linkTown, newSim, place, runHours } from './helpers';

function fingerprint(s: Simulation): unknown {
  return {
    minutes: s.clock.totalMinutes, money: s.economy.money, rng: s.rng.getState(), pop: s.demography!.population,
    residents: Array.from(s.buildings.residents.subarray(0, s.buildings.count)),
  };
}

/** Ville sèche desservie : forage + usine + château au sud de la rue z = 80. */
function servedTown(s: Simulation): { pump: number; plant: number; tower: number } {
  buildTown(s);
  linkTown(s);
  const pump = place(s, 'eau_station_pompage', 120, 96, 2);
  const plant = place(s, 'eau_usine_potabilisation', 150, 100, 2);
  const tower = place(s, 'eau_chateau_eau', 184, 96, 2);
  return { pump, plant, tower };
}

test('dormant : sans installation d\'eau, partie identique tick à tick, ni ext ni section', () => {
  const a = newSim([]);
  const { plugins, municipal } = eauPlugins();
  const b = newSim(plugins);
  buildTown(a); buildTown(b);
  for (let i = 1; i <= 600; i++) {
    a.tick(5); b.tick(5);
    if (i % 50 === 0) {
      const da = a.takeDelta(), db = b.takeDelta();
      assert.equal(db.ext, undefined, 'aucune clé ext');
      assert.deepEqual(db, da);
      assert.deepEqual(fingerprint(b), fingerprint(a));
    }
  }
  assert.equal(b.snapshot().ext, undefined);
  assert.equal('plugins' in b.toSave(), false);
  assert.ok(municipal!.municipal.isEmpty, 'aucune grille ni réseau créés');
  const ctx = b.plugins.contextOf('eau')!;
  const svc = ctx.use<EauService>(EAU_SERVICE)!;
  assert.equal(svc.growthAllowed(b.buildings.id[0]!), true, 'croissance libre tant que le service n\'existe pas');
});

test('activation : la première installation met le service en route ; delta, instantané, commandes', () => {
  const { plugins, eau, municipal } = eauPlugins();
  const s = newSim(plugins);
  servedTown(s);
  runHours(s, 30);
  const sys = eau.system;
  assert.equal(sys.active, true);
  const b = sys.balance!;
  assert.ok(b.buildings > 10, `bâtiments desservables : ${b.buildings}`);
  assert.equal(b.unserved, 0, `tous desservis (alertes : ${sys.alerts.join(' | ')})`);
  assert.ok(b.delivered > 0 && Math.abs(b.delivered - b.demand) < 1e-6);
  assert.ok(b.quality > 0.85, `qualité ${b.quality}`);
  assert.ok(b.pressure > 1.5, `pression ${b.pressure}`);
  const pump = sys.facilityStates().find((f) => f.kind === 'pompage')!;
  assert.equal(pump.intake, 'forage', 'carte sèche : forage');
  assert.ok(pump.capacity > 0 && pump.capacity < 160, 'rendement de nappe < surface');
  // Réseaux municipaux distincts.
  const m = municipal!.municipal;
  assert.ok(m.networks.get('eau')!.nodeCount > 0 && m.networks.get('egouts')!.nodeCount > 0);
  assert.equal(m.scheduler.stats().filter((t) => t.errors > 0).length, 0, 'aucune tâche en erreur');
  // Delta : présent après un pas horaire, absent ensuite tant que rien ne change.
  const first = s.takeDelta().ext?.eau as EauDelta | undefined;
  assert.ok(first?.pipes && first.river, 'premier delta : canalisations et cellules en eau (service activé après l\'instantané)');
  runHours(s, 1);
  const d = s.takeDelta().ext?.eau as EauDelta | undefined;
  assert.ok(d && d.balance.buildings === b.buildings);
  assert.ok(d.layer.buildingIds.length === b.buildings);
  assert.equal(s.takeDelta().ext?.eau, undefined);
  const snap = s.snapshot().ext?.eau as EauSnapshot;
  assert.ok(snap.pipes.ids.length > 0 && snap.pipes.points.length >= snap.pipes.ids.length * 4);
  assert.equal(snap.layer.pipeLoad.length, snap.pipes.ids.length);
  // Commandes.
  const st = s.pluginCommand({ plugin: 'eau', name: 'state' });
  assert.ok(st.ok);
  const set = s.pluginCommand({ plugin: 'eau', name: 'settings', payload: { tariff: 3.5 } });
  assert.ok(set.ok && (set.data as { data: { tariff: number } }).data.tariff === 3.5);
  const bad = s.pluginCommand({ plugin: 'eau', name: 'inconnue' });
  assert.equal(bad.ok, false);
});

test('sauvegarde : section aller-retour, partie identique après rechargement (contrat partagé et privé)', () => {
  for (const shared of [true, false]) {
    const A = eauPlugins({ shared });
    const s = newSim(A.plugins);
    servedTown(s);
    runHours(s, 26);
    s.pluginCommand({ plugin: 'eau', name: 'settings', payload: { fundingSewer: 0.6 } });
    runHours(s, 3);
    const save = JSON.parse(JSON.stringify(s.toSave())) as unknown;
    assert.ok(validateSave(save).ok);
    const sec = (save as { plugins: Record<string, { v: number; data: { municipal: unknown } }> }).plugins.eau!;
    assert.equal(sec.v, 1);
    assert.equal(sec.data.municipal === null, shared, 'contrat privé sauvegardé dans la section seulement sans module municipal');
    const B = eauPlugins({ shared });
    const t = new Simulation(B.plugins);
    t.setCatalog(eauCatalog());
    assert.equal(t.fromSave(save), null);
    assert.equal(B.eau.system.active, true);
    assert.deepEqual(B.eau.system.settings, A.eau.system.settings);
    runHours(s, 20); runHours(t, 20);
    assert.deepEqual(B.eau.system.balance, A.eau.system.balance, `bilans identiques (partagé=${shared})`);
    const ga = A.eau.municipalOf()!.grids.get('pollution_eau')!.copyValues(), gb = B.eau.municipalOf()!.grids.get('pollution_eau')!.copyValues();
    assert.deepEqual(gb, ga);
    assert.deepEqual(B.eau.municipalOf()!.grids.get('satisfaction')!.copyValues(), A.eau.municipalOf()!.grids.get('satisfaction')!.copyValues());
  }
});

test('section de sauvegarde : migrations et erreurs', () => {
  assert.deepEqual(eauSaveSection.migrate(eauSaveSection.empty(), 1), eauSaveSection.empty());
  assert.throws(() => migrateEau({}, 2), /plus récente/);
  assert.throws(() => migrateEau('x', 1), /objet attendu/);
  assert.throws(() => migrateEau({ system: { active: 'oui' } }, 1), /illisible/);
});
