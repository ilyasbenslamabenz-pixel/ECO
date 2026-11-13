/**
 * Module `municipal` injecté dans une vraie Simulation (registre SIM_PLUGINS + municipal) :
 * contrat inutilisé = aucun effet ; service publié aux autres modules ; delta / instantané ; commandes ;
 * sauvegarde versionnée (aller-retour, déterminisme après rechargement, section en erreur isolée) ;
 * miroir budgétaire sans changer les montants de l'économie.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../../src/sim/world';
import { SIM_PLUGINS, type SimPlugin } from '../../src/sim/plugins';
import { validateSave } from '../../src/sim/save-format';
import { createMunicipalPlugin, Municipal, MUNICIPAL_SERVICE } from '../../src/sim/municipal';
import { emptyMunicipalSave, migrateMunicipal, municipalSaveSection, MUNICIPAL_SAVE_VERSION } from '../../src/sim/save-sections/municipal';
import type { MunicipalDelta } from '../../src/shared/municipal';
import { buildTown, runDays, townCatalog } from '../sim/fixtures';

const PARAMS = { seed: 1234, mapChunks: 4, startMoney: 50_000_000, cityName: 'Bourg-Municipal', terrain: { hydrology: 'aucune' as const, rivers: 0 } };

function town(plugins: readonly SimPlugin[]): Simulation {
  const s = new Simulation(plugins);
  s.setCatalog(townCatalog());
  s.newGame(PARAMS);
  return s;
}

function fingerprint(s: Simulation): unknown {
  return {
    minutes: s.clock.totalMinutes, money: s.economy.money, rng: s.rng.getState(), pop: s.demography!.population,
    sched: s.scheduler.toJSON(), vehicles: s.traffic.actCount, notices: s.notices.map((n) => n.message),
    residents: Array.from(s.buildings.residents.subarray(0, s.buildings.count)),
  };
}

/** Module consommateur de test : émissions industrielles horaires et couplage pollution -> valeur foncière. */
function pollueur(): SimPlugin & { causeId: number } {
  const p: SimPlugin & { causeId: number } = {
    id: 'pollueur', causeId: 0,
    init(ctx) {
      const m = ctx.use<Municipal>(MUNICIPAL_SERVICE)!;
      m.scheduler.add({
        id: 'pollueur:emission', every: 'hour',
        run: () => {
          const st = ctx.buildings.store;
          for (let i = 0; i < ctx.buildings.count; i++) {
            if (ctx.buildings.assetOf(st.id[i]!)?.category !== 'industrial') continue;
            m.grids.ensure('pollution_air').stamp(st.x[i]!, st.z[i]!, 60, 6);
          }
        },
      });
    },
    onNewGame(ctx) {
      const m = ctx.use<Municipal>(MUNICIPAL_SERVICE)!;
      m.grids.ensure('pollution_air');
      m.grids.ensure('valeur_fonciere');
      m.grids.addCoupling({ id: 'air->foncier', from: 'pollution_air', to: 'valeur_fonciere', factor: -0.05, every: 'day' });
      p.causeId = m.effects.cause({ kind: 'module', label: 'Émissions industrielles', source: 'pollueur', at: ctx.clock.totalMinutes });
    },
  };
  return p;
}

test('section de sauvegarde : gabarit, migrations, erreurs', () => {
  assert.equal(municipalSaveSection.id, 'municipal');
  assert.equal(municipalSaveSection.version, MUNICIPAL_SAVE_VERSION);
  assert.deepEqual(migrateMunicipal(emptyMunicipalSave(), 1), emptyMunicipalSave());
  assert.throws(() => migrateMunicipal({}, MUNICIPAL_SAVE_VERSION + 1), /plus récente/);
  assert.throws(() => migrateMunicipal('texte', 1), /objet attendu/);
  assert.throws(() => migrateMunicipal({ ...emptyMunicipalSave(), budget: null }, 1), /budget mal formé/);
  assert.throws(() => migrateMunicipal({ ...emptyMunicipalSave(), networks: {} }, 1), /réseaux/);
});

test('contrat inutilisé : simulation identique tick à tick avec et sans le module, aucune section, aucun delta', () => {
  const a = town(SIM_PLUGINS);
  const b = town([...SIM_PLUGINS, createMunicipalPlugin()]);
  buildTown(a); buildTown(b);
  for (let i = 1; i <= 800; i++) {
    a.tick(5); b.tick(5);
    if (i % 20 === 0) assert.deepEqual(b.takeDelta(), a.takeDelta());
    if (i % 200 === 0) assert.deepEqual(fingerprint(b), fingerprint(a), `tick ${i}`);
  }
  assert.equal(b.snapshot().ext, undefined);
  const save = b.toSave();
  assert.equal('plugins' in save, false, 'aucune section municipal tant que rien n\'est défini');
  assert.deepEqual({ ...save, savedAt: '' }, { ...a.toSave(), savedAt: '' });
});

test('service publié : un module consommateur émet, la grille diffuse ; delta, instantané, commandes', () => {
  const muniPlugin = createMunicipalPlugin({ cellSize: 32 });
  const s = town([...SIM_PLUGINS, muniPlugin, pollueur()]);
  const m = muniPlugin.municipal;
  assert.equal(s.plugins.contextOf('pollueur')!.use(MUNICIPAL_SERVICE), m, 'service stable');
  const b = s.terrain ? m.grids.defaultGeometry : null;
  assert.ok(b && b.cols === 32 && b.rows === 32, 'carte de 4 chunks (1 024 m) en cellules de 32 m');
  buildTown(s);
  runDays(s, 2, 10);
  const air = m.grids.require('pollution_air');
  assert.ok(air.stats().max > 0, 'pollution émise');
  const d = s.takeDelta().ext?.municipal as MunicipalDelta | undefined;
  assert.ok(d?.grids?.some((g) => g.id === 'pollution_air' && g.stats.max > 0));
  const snap = s.snapshot().ext?.municipal as MunicipalDelta;
  assert.deepEqual(snap.grids?.map((g) => g.id), ['pollution_air', 'valeur_fonciere']);
  // Commandes.
  const ind = s.plugins.command('municipal', 'indicators', undefined);
  assert.ok(ind.ok && Array.isArray(ind.data.data) && (ind.data.data as unknown[]).length === 2);
  const g = s.plugins.command('municipal', 'grid', { id: 'pollution_air' });
  assert.ok(g.ok);
  const vals = (g.data.data as { values: Float32Array }).values;
  assert.deepEqual(vals, air.data);
  assert.notEqual(vals, air.data, 'copie');
  const missing = s.plugins.command('municipal', 'grid', { id: 'bruit' });
  assert.ok(!missing.ok && missing.error.code === 'NOT_FOUND');
  const unk = s.plugins.command('municipal', 'nope', {});
  assert.ok(!unk.ok && unk.error.code === 'INVALID_ARGS');
  const net = s.plugins.command('municipal', 'network', { kind: 'electricite' });
  assert.ok(net.ok && net.data.data === null);
});

test('sauvegarde : section municipal aller-retour, validée, déterminisme après rechargement', () => {
  const mp = createMunicipalPlugin();
  const s = town([...SIM_PLUGINS, mp, pollueur()]);
  buildTown(s);
  runDays(s, 3, 10);
  mp.municipal.networks.ensure('electricite').addNode({ role: 'producer', capacity: 10 });
  mp.municipal.budget.post('expense', 'entretien:lignes', 12.5, 'electricite');
  const save = s.toSave();
  assert.equal(save.plugins?.municipal?.v, MUNICIPAL_SAVE_VERSION);
  const json = JSON.parse(JSON.stringify(save)) as unknown;
  assert.ok(validateSave(json).ok);

  const mp2 = createMunicipalPlugin();
  const t = new Simulation([...SIM_PLUGINS, mp2, pollueur()]);
  t.setCatalog(townCatalog());
  assert.equal(t.fromSave(json), null);
  assert.deepEqual(mp2.municipal.toJSON(), mp.municipal.toJSON());
  assert.equal(mp2.municipal.budget.pendingModuleBalance(), -12.5);
  runDays(s, 2, 10);
  runDays(t, 2, 10);
  assert.deepEqual(mp2.municipal.grids.require('valeur_fonciere').data, mp.municipal.grids.require('valeur_fonciere').data);
  assert.deepEqual(t.toSave().plugins?.municipal, s.toSave().plugins?.municipal);

  // Section corrompue : notification, module remis à neuf, reste de la partie chargé.
  const bad = JSON.parse(JSON.stringify(save)) as { plugins: Record<string, { v: number; data: unknown }> };
  bad.plugins.municipal!.data = { grids: 3 };
  const mp3 = createMunicipalPlugin();
  const u = new Simulation([...SIM_PLUGINS, mp3]);
  u.setCatalog(townCatalog());
  u.plugins.log = () => {};
  assert.equal(u.fromSave(bad), null);
  assert.equal(u.buildings.count, s.buildings.count);
  assert.ok(u.notices.some((n) => n.message.includes('municipal')));
  assert.equal(mp3.municipal.isEmpty, true);
});

test('budget : miroir de l\'économie existante, montants et trésorerie inchangés', () => {
  const ref = town(SIM_PLUGINS);
  const mp = createMunicipalPlugin();
  const s = town([...SIM_PLUGINS, mp]);
  // Simule le branchement demandé (docs/requests/municipal.md) : source = dernier bilan de l'économie.
  mp.municipal.economySource = () => s.economy.history[s.economy.history.length - 1];
  buildTown(ref); buildTown(s);
  runDays(ref, 31, 30);
  runDays(s, 31, 30);
  assert.equal(s.economy.history.length, 1);
  assert.equal(s.economy.money, ref.economy.money, 'trésorerie identique : le contrat ne dépense rien');
  assert.deepEqual(s.economy.history, ref.economy.history);
  const rec = s.economy.history[0]!;
  const m = mp.municipal.budget.lastMonth!;
  assert.equal(m.monthIndex, rec.monthIndex);
  assert.ok(Math.abs(m.mirroredBalance - rec.balance) < 0.05, `${m.mirroredBalance} vs ${rec.balance}`);
  assert.equal(m.moduleBalance, 0);
  const taxes = Object.values(rec.income).reduce((a, v) => a + v, 0);
  assert.ok(Math.abs(m.income - taxes) < 0.05);
  const cmd = s.plugins.command('municipal', 'budget', { groupBy: 'service' });
  assert.ok(cmd.ok);
  assert.ok(Math.abs((cmd.data.data as { groups: Record<string, number> }).groups.economie! - rec.balance) < 0.05);
});
