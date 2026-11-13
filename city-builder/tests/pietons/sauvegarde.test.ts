/**
 * Sauvegarde du module piétons : section versionnée (v2), aller-retour (marcheurs et trajets en cours restaurés),
 * migration du gabarit v1, anciennes sauvegardes sans section, section corrompue isolée, module vierge = aucune
 * section, simulation de base inchangée par le module.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../../src/sim/world';
import { validateSave } from '../../src/sim/save-format';
import { PIETONS_SAVE_VERSION, emptyPietonsSave, migratePietons, type PietonsSave } from '../../src/sim/save-sections/pietons';
import { createPietonsPlugin } from '../../src/sim/plugins/pietons';
import type { PedestrianSystem } from '../../src/sim/pedestrians/system';
import { pietonsSaveSection } from '../../src/sim/save-sections/pietons';
import { townCatalog } from '../sim/fixtures';
import { buildGrid, pedTown, runHours } from './fixtures';

function loadInto(save: unknown): { sim: Simulation; system: PedestrianSystem } {
  const plugin = createPietonsPlugin();
  const sim = new Simulation([plugin]);
  sim.setCatalog(townCatalog());
  const err = sim.fromSave(JSON.parse(JSON.stringify(save)));
  assert.equal(err, null, err?.message);
  sim.snapshot(); // le worker envoie un instantané après chaque chargement
  return { sim, system: plugin.system };
}

test('section v2 : aller-retour — mêmes marcheurs, piétons remis dans la rue près de leur position', () => {
  const t = pedTown();
  runHours(t.sim, 60);
  while (t.system.crowd.count < 20) t.sim.tick();
  const save = t.sim.toSave();
  const sec = save.plugins!.pietons!;
  assert.equal(sec.v, PIETONS_SAVE_VERSION);
  assert.equal(PIETONS_SAVE_VERSION, 2);
  const data = sec.data as PietonsSave;
  const P = t.system.personas, c = t.system.crowd;
  assert.equal(data.marcheurs.home.length, P.count);
  assert.equal(data.trajets.length, c.count * 6);
  // JSON pur (aucun tableau typé) et de taille raisonnable.
  const json = JSON.stringify(sec);
  assert.ok(json.length < 64 * P.count + 80 * c.count + 400, `${json.length} octets pour ${P.count} marcheurs`);
  const positions = new Map<number, [number, number]>();
  for (let i = 0; i < c.count; i++) positions.set(c.persona[i]!, [c.x[i]!, c.z[i]!]);

  const b = loadInto(save);
  const Q = b.system.personas;
  assert.equal(Q.count, P.count);
  for (const col of ['home', 'anchor', 'role', 'look', 'seed8', 'seed', 'planDay', 'done'] as const) {
    assert.deepEqual(Array.from(Q[col].subarray(0, Q.count)), Array.from(P[col].subarray(0, P.count)), col);
  }
  b.sim.tick(); // le graphe est construit, les trajets en cours sont restaurés
  const d = b.system.crowd;
  assert.ok(d.count >= c.count - 2 && d.count <= c.count + 3, `${d.count} piétons restaurés pour ${c.count} sauvegardés`);
  let near = 0;
  for (let i = 0; i < d.count; i++) {
    const was = positions.get(d.persona[i]!);
    if (!was) continue;
    // Recalé sur le trottoir le plus proche : à quelques mètres au plus (les piétons en sortie de bâtiment repartent du trottoir).
    if (Math.hypot(d.x[i]! - was[0], d.z[i]! - was[1]) < 12) near++;
    assert.equal(Q.travelling[d.persona[i]!], 1);
  }
  assert.ok(near >= c.count * 0.9, `${near}/${c.count} piétons retrouvés près de leur position`);
  // Identifiants jamais réutilisés après chargement.
  assert.ok(d.nextId >= c.nextId);
  // Les épisodes du jour ne sont pas rejoués : un marcheur dont l'épisode était fait reste « fait ».
  for (let k = 0; k < 30; k++) b.sim.tick();
  for (let p = 0; p < Q.count; p++) if (P.done[p] && P.planDay[p] === b.sim.clock.dayIndex) assert.equal(Q.done[p], 1);
  // La partie rechargée continue de vivre : des trajets démarrent et se terminent.
  runHours(b.sim, 30);
  const st = b.system.stats();
  assert.ok(st.cumul.trajets > 0 && st.cumul.arrivees > 0);
  assert.equal(b.sim.plugins.errors.length, 0);
});

test('section : configuration sauvegardée ; module vierge = aucune section ; ancienne sauvegarde sans section', () => {
  // Module jamais attaché à un client, configuration par défaut : rien n'est écrit (sauvegardes de phase 1 inchangées).
  const a = pedTown({ attach: false });
  runHours(a.sim, 30);
  assert.equal(a.system.crowd.count, 0);
  assert.equal(a.system.personas.count, 0);
  const plain = a.sim.toSave();
  assert.equal('plugins' in plain, false);
  // Cette sauvegarde (identique à une sauvegarde de phase 1) se charge ; les marcheurs sont recréés depuis la démographie.
  const b = loadInto(plain);
  assert.equal(b.system.personas.count, 0);
  runHours(b.sim, 6);
  assert.ok(b.system.personas.count > 20, `${b.system.personas.count} marcheurs recréés`);
  assert.equal(b.sim.plugins.errors.length, 0);
  // Configuration non par défaut : sauvegardée même sans marcheur, et restaurée.
  const c = pedTown({ build: false });
  c.system.command(c.ctx, 'config', { maxPietons: 777, foule: 12, actif: false });
  const s2 = c.sim.toSave();
  assert.deepEqual((s2.plugins!.pietons!.data as PietonsSave).config, { actif: false, maxPietons: 777, foule: 12 });
  const d = loadInto(s2);
  assert.deepEqual(d.system.config, { actif: false, maxPietons: 777, foule: 12 });
});

test('migration : gabarit v1 vide -> v2 ; versions futures, données corrompues ou incohérentes refusées', () => {
  const v2 = migratePietons({}, 1);
  assert.deepEqual(v2, emptyPietonsSave());
  assert.deepEqual(migratePietons(emptyPietonsSave(), 2), emptyPietonsSave());
  assert.throws(() => migratePietons({}, 3), /plus récente/);
  assert.throws(() => migratePietons('x', 1), /objet attendu/);
  assert.throws(() => migratePietons({}, 2), /configuration invalide/);
  const bad = emptyPietonsSave();
  bad.marcheurs.home = [1, 2];
  assert.throws(() => migratePietons(bad, 2), /longueur/);
  const bad2 = emptyPietonsSave() as unknown as { trajets: unknown };
  bad2.trajets = ['a'];
  assert.throws(() => migratePietons(bad2, 2), /trajets invalides/);
  // La section enregistrée (moteur de migration commun) donne les mêmes résultats.
  assert.equal(pietonsSaveSection.version, PIETONS_SAVE_VERSION);
  assert.deepEqual(pietonsSaveSection.migrate({}, 1), emptyPietonsSave());
  assert.throws(() => pietonsSaveSection.migrate({}, 2), /configuration invalide/);
  assert.throws(() => pietonsSaveSection.migrate([], 1), /objet attendu/);
});

test('chargement : section v1 (gabarit) acceptée ; section illisible isolée — le reste de la partie est chargé', () => {
  const t = pedTown();
  runHours(t.sim, 30);
  const save = t.sim.toSave();
  // Sauvegarde écrite par la préparation de phase 2 (gabarit vide, version 1).
  const old = JSON.parse(JSON.stringify(save));
  old.plugins.pietons = { v: 1, data: {} };
  const a = loadInto(old);
  assert.equal(a.sim.buildings.count, t.sim.buildings.count);
  assert.equal(a.system.personas.count, 0);
  assert.equal(a.sim.plugins.errors.length, 0);
  runHours(a.sim, 4);
  assert.ok(a.system.personas.count > 0);
  // Section corrompue : erreur attrapée par l'hôte, joueur notifié, partie chargée, section d'origine conservée.
  const corrupt = JSON.parse(JSON.stringify(save));
  corrupt.plugins.pietons.data.marcheurs.home = 'cassé';
  const plugin = createPietonsPlugin();
  const sim = new Simulation([plugin]);
  sim.plugins.log = () => undefined;
  sim.setCatalog(townCatalog());
  assert.equal(validateSave(corrupt).ok, true);
  assert.equal(sim.fromSave(corrupt), null);
  assert.equal(sim.buildings.count, t.sim.buildings.count);
  assert.ok(sim.plugins.errors.some((e) => e.plugin === 'pietons' && e.hook === 'load'));
  assert.equal(plugin.system.personas.count, 0);
  assert.deepEqual(sim.toSave().plugins!.pietons, corrupt.plugins.pietons, 'section d\'origine conservée telle quelle');
});

test('lecture seule : la simulation de base est identique tick à tick avec et sans le module piétons actif', () => {
  const mk = (withPlugin: boolean): { sim: Simulation; crowd: () => number } => {
    const plugin = createPietonsPlugin();
    const sim = new Simulation(withPlugin ? [plugin] : []);
    sim.setCatalog(townCatalog());
    sim.newGame({ seed: 4321, mapChunks: 4, startMoney: 500_000_000, cityName: 'Bourg-Piétons', terrain: { hydrology: 'aucune', rivers: 0 } });
    buildGrid(sim);
    sim.snapshot();
    if (withPlugin) plugin.system.command(sim.plugins.contextOf('pietons')!, 'config', { foule: 120 });
    return { sim, crowd: () => plugin.system.crowd.count };
  };
  const a = mk(false), b = mk(true);
  const print = (s: Simulation): unknown => ({
    minutes: s.clock.totalMinutes, money: s.economy.money, rng: s.rng.getState(), pop: s.demography!.population, vehicles: s.traffic.actCount,
    sched: s.scheduler.toJSON(), residents: Array.from(s.buildings.residents.subarray(0, s.buildings.count)), workers: Array.from(s.buildings.workers.subarray(0, s.buildings.count)),
  });
  for (let k = 1; k <= 3000; k++) {
    a.sim.tick(); b.sim.tick();
    if (k % 250 === 0) {
      assert.deepEqual(print(b.sim), print(a.sim), `tick ${k}`);
      const da = a.sim.takeDelta(), db = b.sim.takeDelta();
      assert.ok(db.ext?.pietons, 'le module envoie ses trames');
      assert.deepEqual({ ...db, ext: undefined, stats: { ...db.stats, tickMs: 0 } }, { ...da, ext: undefined, stats: { ...da.stats, tickMs: 0 } });
    }
  }
  assert.ok(b.crowd() >= 100, 'des piétons marchaient pendant la comparaison');
  const sa = a.sim.toSave(), sb = b.sim.toSave();
  assert.ok(sb.plugins?.pietons);
  assert.deepEqual({ ...sb, plugins: undefined, savedAt: '' }, { ...sa, plugins: undefined, savedAt: '' });
});
