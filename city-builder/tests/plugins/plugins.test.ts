/**
 * Points d'extension de phase 2 : registres chargés, modules vides sans effet, ordre des crochets,
 * sections de sauvegarde (aller-retour, anciennes sauvegardes, sections inconnues, erreurs), exceptions
 * isolées, commande `pluginCommand` validée, transfert des tableaux d'un module.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../../src/sim/world';
import { handleCommand } from '../../src/sim/handler';
import { SIM_PLUGINS, type PluginContext, type SimPlugin } from '../../src/sim/plugins';
import { SAVE_SECTIONS } from '../../src/sim/save-sections';
import { PHASE2_MODULES } from '../../src/shared/protocol-ext';
import { RENDER_PLUGINS } from '../../src/render/plugins';
import { UI_PANELS } from '../../src/ui/panels/index';
import { PROTOCOL_VERSION } from '../../src/shared/constants';
import { collectTransferables, validateCommandMessage, type DeltaMessage, type ResultMessage } from '../../src/shared/protocol';
import { validateSave } from '../../src/sim/save-format';
import { buildTown, runDays, townCatalog } from '../sim/fixtures';

/**
 * Modules de phase 2A DÉJÀ IMPLÉMENTÉS par une branche : ils ont des crochets, envoient des `ext` et écrivent
 * une section de sauvegarde. Les contrôles « module vide = aucun effet » ci-dessous portent sur les AUTRES
 * (le mécanisme reste vérifié : registre complet, plugin de test injecté, sections, commandes).
 */
const IMPLEMENTED = new Set(['circulation', 'pietons']);
const EMPTY_PLUGINS: readonly SimPlugin[] = SIM_PLUGINS.filter((p) => !IMPLEMENTED.has(p.id));

function town(plugins?: readonly SimPlugin[]): Simulation {
  const s = plugins ? new Simulation(plugins) : new Simulation();
  s.setCatalog(townCatalog());
  s.newGame({ seed: 1234, mapChunks: 4, startMoney: 50_000_000, cityName: 'Bourg-Module', terrain: { hydrology: 'aucune', rivers: 0 } });
  return s;
}

function fingerprint(s: Simulation): unknown {
  return {
    minutes: s.clock.totalMinutes, money: s.economy.money, rng: s.rng.getState(), pop: s.demography!.population,
    sched: s.scheduler.toJSON(), vehicles: s.traffic.actCount, notices: s.notices.map((n) => n.message),
    residents: Array.from(s.buildings.residents.subarray(0, s.buildings.count)),
  };
}

/** Module de test : journal des crochets, état sauvegardé, commandes. */
function recorder(id = 'essai', opts: { failTick?: boolean } = {}): SimPlugin & { log: string[]; state: { ticks: number; draws: number[] } } {
  const log: string[] = [];
  const state = { ticks: 0, draws: [] as number[] };
  let pending = false;
  return {
    id, log, state, saveVersion: 3,
    init: (ctx) => { log.push(`init:${ctx.catalog ? 'cat' : 'nocat'}`); },
    onNewGame: (ctx) => { log.push(`newGame:${ctx.inGame}`); state.ticks = 0; state.draws = []; },
    onTick: (_ctx, minutes) => {
      if (opts.failTick) throw new Error('panne simulée');
      if (state.ticks === 0) log.push(`tick:${minutes}`);
      state.ticks++; pending = true;
    },
    onDayStart: (ctx) => { log.push(`day:${ctx.clock.dayIndex}`); state.draws.push(Math.floor(ctx.rng.next() * 1000)); },
    onMonthStart: (ctx) => { log.push(`month:${ctx.clock.monthIndex}`); },
    takeDelta: () => { if (!pending) return undefined; pending = false; return { ticks: state.ticks }; },
    snapshot: (ctx) => ({ ticks: state.ticks, buildings: ctx.buildings.count }),
    command: (ctx, name, payload) => {
      if (name === 'echo') return { ok: true, data: { payload, roads: ctx.roads.segCount } };
      if (name === 'boom') throw new Error('commande en panne');
      if (name === 'missing') return { ok: false, code: 'NOT_FOUND', message: 'introuvable' };
      return { ok: false, code: 'CODE_MODULE', message: `commande ${name} inconnue` };
    },
    save: () => ({ ticks: state.ticks, draws: state.draws }),
    load: (_ctx, data, version) => {
      log.push(`load:v${version}`);
      const d = data as { ticks: number; draws: number[] };
      if (typeof d.ticks !== 'number') throw new Error('section illisible');
      state.ticks = d.ticks; state.draws = d.draws;
    },
  };
}

test('registres : les quatre modules sont enregistrés partout, vides, avec leur section de sauvegarde', () => {
  const ids = [...PHASE2_MODULES];
  assert.deepEqual(SIM_PLUGINS.map((p) => p.id), ids);
  assert.deepEqual(RENDER_PLUGINS.map((p) => p.id), ids);
  assert.deepEqual(UI_PANELS.map((p) => p.id), ids);
  assert.deepEqual(SAVE_SECTIONS.map((p) => p.id), ids);
  for (const p of EMPTY_PLUGINS) assert.deepEqual(Object.keys(p), ['id'], `${p.id} : plugin vide attendu`);
  for (const sec of SAVE_SECTIONS) {
    assert.deepEqual(sec.migrate(sec.empty(), sec.version), sec.empty());
    assert.throws(() => sec.migrate({}, sec.version + 1), /plus récente/);
    assert.throws(() => sec.migrate('texte', 1), /objet attendu/);
  }
  assert.deepEqual(new Simulation().plugins.ids(), ids);
  assert.throws(() => new Simulation([{ id: 'a' }, { id: 'a' }]), /double/);
});

test('modules vides : simulation identique tick à tick avec et sans le registre', () => {
  const a = town([]);
  const b = town(EMPTY_PLUGINS); // registre des modules encore vides
  buildTown(a);
  buildTown(b);
  assert.deepEqual(a.takeDelta(), b.takeDelta());
  for (let i = 1; i <= 1500; i++) {
    a.tick(2);
    b.tick(2);
    if (i % 10 === 0) {
      const da = a.takeDelta(), db = b.takeDelta();
      assert.equal(db.ext, undefined, 'pas de clé ext sans module actif');
      assert.deepEqual(db, da);
    }
    if (i % 100 === 0) assert.deepEqual(fingerprint(b), fingerprint(a), `tick ${i}`);
  }
  const sa = a.snapshot(), sb = b.snapshot();
  assert.equal(sb.ext, undefined);
  assert.deepEqual({ ...sb, terrain: null }, { ...sa, terrain: null });
  const saveA = a.toSave(), saveB = b.toSave();
  assert.equal('plugins' in saveB, false, 'aucune section écrite par des modules vides');
  assert.deepEqual({ ...saveB, savedAt: '' }, { ...saveA, savedAt: '' });
});

test('module injecté : crochets dans l\'ordre, ext du delta et de l\'instantané, PRNG propre', () => {
  const p = recorder();
  const s = town([p]);
  assert.deepEqual(p.log, ['init:cat', 'newGame:true']);
  const baseRng = s.rng.getState();
  buildTown(s);
  assert.equal(s.takeDelta().ext?.essai, undefined, 'rien à envoyer avant le premier tick');
  // 31 jours en pas de 30 min : 31 débuts de journée, 1 début de mois.
  for (let i = 0; i < 31 * 48; i++) s.tick(30);
  const days = p.log.filter((l) => l.startsWith('day:'));
  assert.equal(days.length, 31);
  assert.deepEqual(p.log.slice(0, 4), ['init:cat', 'newGame:true', 'tick:30', 'day:1']);
  const month = p.log.indexOf('month:1');
  // Le début du mois 1 coïncide avec le jour 30 : les deux crochets sont appelés dans le même tick
  // (ordre du planificateur de base : (minute, n° de planification)), avant les jours suivants.
  const day30 = p.log.indexOf('day:30');
  assert.ok(month > 0 && Math.abs(month - day30) === 1 && month < p.log.indexOf('day:31'), `ordre ${p.log.slice(-4).join(',')}`);
  assert.equal(p.state.ticks, 31 * 48);
  const d = s.takeDelta();
  assert.deepEqual(d.ext, { essai: { ticks: 31 * 48 } });
  assert.equal(s.takeDelta().ext, undefined, 'clé ext absente si aucun module n\'envoie rien');
  const snap = s.snapshot();
  assert.deepEqual(snap.ext, { essai: { ticks: 31 * 48, buildings: s.buildings.count } });
  // PRNG du module distinct du PRNG de base : les tirages du module ne changent pas la simulation.
  const ref = town([]);
  buildTown(ref);
  for (let i = 0; i < 31 * 48; i++) ref.tick(30);
  assert.deepEqual(s.rng.getState(), ref.rng.getState());
  assert.notDeepEqual(baseRng, s.rng.getState());
  // Façade : lecture seule de l'état courant.
  const ctx = s.plugins.contextOf('essai') as PluginContext;
  assert.equal(ctx.roads.segCount, s.net.segCount);
  const id = s.buildings.id[0]!;
  assert.equal(ctx.buildings.record(id)?.assetId, ctx.buildings.assetOf(id)?.id);
  assert.ok(ctx.buildings.query(-300, -300, 300, 300, []).includes(id));
  assert.equal(ctx.demography?.population, s.demography!.population);
  assert.ok(Number.isFinite(ctx.terrain.heightAt(0, 0)));
  ctx.provide('feux', { etat: () => 'vert' });
  assert.equal(ctx.use<{ etat(): string }>('feux')?.etat(), 'vert');
  assert.equal(ctx.use('absent'), undefined);
});

test('sauvegarde : section du module aller-retour (version, données, PRNG), déterminisme après rechargement', () => {
  const p = recorder();
  const s = town([p]);
  buildTown(s);
  runDays(s, 3, 10);
  const save = s.toSave();
  assert.ok(save.plugins?.essai);
  assert.equal(save.plugins.essai.v, 3);
  assert.deepEqual(save.plugins.essai.data, { ticks: p.state.ticks, draws: p.state.draws });
  const json = JSON.parse(JSON.stringify(save)) as unknown;
  assert.ok(validateSave(json).ok, 'le champ plugins passe la validation du format');

  const p2 = recorder();
  const t = new Simulation([p2]);
  t.setCatalog(townCatalog());
  assert.equal(t.fromSave(json), null);
  assert.deepEqual(p2.log, ['init:cat', 'newGame:true', 'load:v3']);
  assert.deepEqual(p2.state, p.state);
  // Même suite de tirages du module après rechargement.
  runDays(s, 2, 10);
  runDays(t, 2, 10);
  assert.deepEqual(p2.state.draws, p.state.draws);
  assert.deepEqual(t.toSave().plugins, s.toSave().plugins);
});

test('sauvegarde : ancienne sauvegarde sans plugins chargée ; section inconnue conservée ; section en erreur isolée', () => {
  const base = town([]);
  buildTown(base);
  runDays(base, 1, 10);
  const old = JSON.parse(JSON.stringify(base.toSave())) as Record<string, unknown>;
  assert.equal('plugins' in old, false);

  // 1) Sauvegarde sans `plugins` : chargée, le module repart de zéro.
  const p = recorder();
  const s = new Simulation([p]);
  s.setCatalog(townCatalog());
  assert.equal(s.fromSave(old), null);
  assert.equal(s.buildings.count, base.buildings.count);
  assert.deepEqual(p.log, ['init:cat', 'newGame:true']);

  // 2) Section d'un module inconnu (et section trop récente) : conservées telles quelles.
  const withForeign = { ...old, plugins: { futur: { v: 7, data: { a: [1, 2, 3] } }, essai: { v: 9, data: { ticks: 5, draws: [] } } } };
  const s2 = new Simulation([recorder()]);
  s2.setCatalog(townCatalog());
  assert.equal(s2.fromSave(withForeign), null);
  s2.tick(1);
  const out = s2.toSave();
  assert.deepEqual(out.plugins?.futur, { v: 7, data: { a: [1, 2, 3] } });
  assert.deepEqual(out.plugins?.essai, { v: 9, data: { ticks: 5, draws: [] } });
  assert.ok(s2.notices.some((n) => n.message.includes('plus récente')));

  // 3) Section illisible : notification, le reste de la partie est chargé, la section est conservée.
  const broken = { ...old, plugins: { essai: { v: 3, data: { ticks: 'beaucoup' } }, autre: 'pas un objet' } };
  const p3 = recorder();
  const s3 = new Simulation([p3]);
  s3.setCatalog(townCatalog());
  s3.plugins.log = () => undefined;
  assert.equal(s3.fromSave(broken), null);
  assert.equal(s3.buildings.count, base.buildings.count);
  assert.equal(s3.clock.totalMinutes, base.clock.totalMinutes);
  assert.ok(s3.notices.some((n) => n.message.includes('« essai »') && n.message.includes('le reste de la partie est chargé')));
  assert.ok(s3.notices.some((n) => n.message.includes('« autre »') && n.message.includes('mal formée')));
  assert.equal(p3.state.ticks, 0, 'module remis à neuf');
  assert.deepEqual(s3.toSave().plugins?.essai, { v: 3, data: { ticks: 'beaucoup' } });

  // 4) Champ `plugins` de mauvais type : ignoré avec notification.
  const s4 = new Simulation([recorder()]);
  s4.setCatalog(townCatalog());
  assert.equal(s4.fromSave({ ...old, plugins: [1, 2] }), null);
  assert.ok(s4.notices.some((n) => n.message.includes('illisibles')));
});

test('exceptions de module : attrapées, journalisées une fois, la boucle et les autres modules continuent', () => {
  const bad = recorder('panne', { failTick: true });
  const good = recorder('sain');
  const s = town([bad, good]);
  const logs: string[] = [];
  s.plugins.log = (m) => logs.push(m);
  buildTown(s);
  for (let i = 0; i < 200; i++) s.tick(2);
  assert.equal(good.state.ticks, 200);
  assert.equal(logs.length, 1, 'une seule ligne de journal par module et par crochet');
  assert.match(logs[0]!, /panne.*onTick.*panne simulée/);
  const rec = s.plugins.errors.find((e) => e.plugin === 'panne' && e.hook === 'onTick');
  assert.equal(rec?.count, 200);
  assert.equal(s.notices.filter((n) => n.message.includes('« panne »')).length, 1, 'une seule notification');
  // Un crochet de delta / instantané / sauvegarde qui lève n'empêche pas le message.
  const thrower: SimPlugin = {
    id: 'casse', takeDelta: () => { throw new Error('x'); }, snapshot: () => { throw new Error('y'); }, save: () => { throw new Error('z'); },
    init: () => { throw new Error('i'); }, onNewGame: () => { throw new Error('n'); },
  };
  const s2 = new Simulation([thrower, good]);
  s2.plugins.log = () => undefined; // silencieux : init et onNewGame lèvent
  s2.setCatalog(townCatalog());
  s2.newGame({ seed: 1, mapChunks: 4, startMoney: 1e6, cityName: 'C', terrain: { hydrology: 'aucune', rivers: 0 } });
  assert.ok(s2.plugins.errors.some((e) => e.plugin === 'casse' && e.hook === 'init'));
  s2.tick(1);
  assert.ok(s2.takeDelta().ext?.sain);
  assert.ok(s2.snapshot().ext?.sain);
  assert.ok(s2.toSave().plugins?.sain);
  assert.equal(s2.toSave().plugins?.casse, undefined);
});

test('pluginCommand : validation du message, module inconnu, codes d\'erreur, exception isolée', () => {
  let req = 1;
  const p = recorder();
  const s = new Simulation([p]);
  s.plugins.log = () => undefined;
  const cmd = (name: string, args: unknown): ResultMessage => handleCommand(s, { kind: 'cmd', reqId: req++, name, args }).result as ResultMessage;
  assert.ok(cmd('init', { protocolVersion: PROTOCOL_VERSION, catalog: townCatalog() }).ok);
  const noGame = cmd('pluginCommand', { plugin: 'essai', name: 'echo' });
  assert.ok(!noGame.ok && noGame.error.code === 'NO_GAME');
  assert.ok(cmd('newGame', { seed: 1, mapChunks: 4, startMoney: 1e6, cityName: 'C', terrain: { hydrology: 'aucune', rivers: 0 } }).ok);

  for (const args of [{}, { plugin: 3, name: 'echo' }, { plugin: '', name: 'echo' }, { plugin: 'Essai!', name: 'echo' }, { plugin: 'essai' }, { plugin: 'essai', name: '' }]) {
    const r = cmd('pluginCommand', args);
    assert.ok(!r.ok && r.error.code === 'INVALID_ARGS', JSON.stringify(args));
  }
  assert.equal(validateCommandMessage({ kind: 'cmd', reqId: 1, name: 'pluginCommand', args: { plugin: 'essai', name: 'echo', payload: { a: 1 } } }), null);

  const unknown = cmd('pluginCommand', { plugin: 'inconnu', name: 'echo' });
  assert.ok(!unknown.ok && unknown.error.code === 'INVALID_ARGS' && unknown.error.message.includes('Module inconnu'));
  const echo = cmd('pluginCommand', { plugin: 'essai', name: 'echo', payload: { a: 1 } });
  assert.ok(echo.ok);
  assert.deepEqual(echo.data, { data: { payload: { a: 1 }, roads: 0 } });
  const missing = cmd('pluginCommand', { plugin: 'essai', name: 'missing' });
  assert.ok(!missing.ok && missing.error.code === 'NOT_FOUND');
  const custom = cmd('pluginCommand', { plugin: 'essai', name: 'autre' });
  assert.ok(!custom.ok && custom.error.code === 'INVALID_ARGS' && custom.error.message.startsWith('[CODE_MODULE]'));
  const boom = cmd('pluginCommand', { plugin: 'essai', name: 'boom' });
  assert.ok(!boom.ok && boom.error.message.includes('Erreur interne'));

  // Registre par défaut : modules connus mais sans commandes.
  const d = new Simulation();
  d.setCatalog(townCatalog());
  d.newGame({ seed: 1, mapChunks: 4, startMoney: 1e6, cityName: 'C', terrain: { hydrology: 'aucune', rivers: 0 } });
  const r = d.pluginCommand({ plugin: 'chantiers', name: 'feux' });
  assert.ok(!r.ok && r.error.code === 'NOT_IMPLEMENTED');
});

test('protocole : tableaux d\'un module transférés seulement sur demande ($transfer)', () => {
  const kept = new Float32Array(4), sent = new Float32Array(8);
  const msg: DeltaMessage = {
    kind: 'delta', tick: 1, buildingsAdded: [], buildingsRemoved: [], roadNodesAdded: [], roadEdgesAdded: [], roadEdgesRemoved: [],
    vehicles: null, stats: town([]).getStats(), ext: { pietons: { positions: sent, cache: kept, $transfer: [sent] }, vide: null },
  };
  const t = collectTransferables(msg);
  assert.deepEqual(t, [sent.buffer]);
});
