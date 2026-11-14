/**
 * Tests d'effet du module « Électricité » (docs/ROADMAP_PHASE2.md §4) dans une vraie Simulation : chaque décision
 * (puissance installée, financement, priorités, vent, lignes) est modifiée, l'effet est mesuré ET retrouvé dans le
 * registre d'effets du contrat municipal.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../../src/sim/world';
import type { SimPlugin } from '../../src/sim/plugins';
import { createElectricitePlugin } from '../../src/sim/plugins/electricite';
import type { ConsumerClass } from '../../src/shared/power/types';
import { advanceHours, advanceToHour, placeFacilities, powerCatalog, powerTown } from './fixtures';
import { buildStreet } from '../sim/fixtures';

const cls = (s: { byClass: { cls: ConsumerClass; cut: number; demandKw: number; deliveredKw: number }[] }, c: ConsumerClass) => s.byClass.find((b) => b.cls === c)!;

test('effet : pénurie électrique -> coupures des moins prioritaires (industrie, commerces) ; hôpital servi ; tracé dans le registre', () => {
  const { sim, elec } = powerTown({ days: 2 });
  placeFacilities(sim, 160, -100, 100, ['petite_centrale', 'petite_centrale']); // 2 × 150 kW pour ≈ 750 kW de demande à midi
  advanceToHour(sim, 11);
  advanceHours(sim, 1);
  const s = elec.system.summary()!;
  assert.ok(s.demandKw > s.availableKw * 1.5, `demande ${s.demandKw} kW > offre ${s.availableKw} kW`);
  assert.ok(s.shortfallKw > 0);
  assert.equal(cls(s, 'sante').cut, 0, 'hôpital alimenté');
  assert.ok(Math.abs(cls(s, 'sante').deliveredKw - cls(s, 'sante').demandKw) < 1e-6);
  // Invariant de délestage : une classe n'est touchée que si toutes les classes moins prioritaires sont coupées.
  const order: ConsumerClass[] = ['sante', 'services', 'residentiel', 'commerce', 'industrie'];
  for (let k = 0; k < order.length; k++) {
    if (cls(s, order[k]!).deliveredKw < cls(s, order[k]!).demandKw - 1e-6) {
      for (const lower of order.slice(k + 1)) assert.equal(cls(s, lower).deliveredKw, 0, `${lower} coupé avant ${order[k]}`);
    }
  }
  assert.equal(cls(s, 'industrie').deliveredKw, 0, 'industrie coupée en premier');
  assert.equal(cls(s, 'commerce').deliveredKw, 0, 'commerces coupés ensuite');
  assert.ok(s.cut > 0 && s.jobsWithoutPower > 0, 'emplois sans courant comptés');
  // Service publié aux autres modules : part servie par bâtiment.
  const usine = sim.buildings.id[[...Array(sim.buildings.count).keys()].find((i) => sim.catalog!.assets[sim.buildings.assetIndex[i]!]!.id === 'usine')!]!;
  const hopital = sim.buildings.id[[...Array(sim.buildings.count).keys()].find((i) => sim.catalog!.assets[sim.buildings.assetIndex[i]!]!.id === 'hopital')!]!;
  assert.equal(elec.system.powerFactor(usine), 0);
  assert.equal(elec.system.powerFactor(hopital), 1);
  // Registre : cause « pénurie », effets par classe coupée, emplois et habitants sans courant.
  const m = elec.municipal()!;
  const causes = m.effects.topCauses(100).filter((c) => c.cause.kind === 'electricite:penurie');
  assert.equal(causes.length, 1);
  const recs = m.effects.query({ cause: causes[0]!.cause.id });
  const ind = recs.find((r) => r.target === 'electricite:coupure:industrie');
  assert.ok(ind && ind.magnitude < 0, 'coupure de l\'industrie tracée');
  assert.ok(!recs.some((r) => r.target === 'electricite:coupure:sante'), 'aucune coupure de l\'hôpital');
  assert.ok(recs.some((r) => r.target === 'emplois:sans_courant' && r.magnitude < 0));

  // Réglage du joueur : l'industrie passe en tête -> elle est servie, le résidentiel est davantage coupé.
  const resCutBefore = cls(s, 'residentiel').cut;
  const r = sim.plugins.command('electricite', 'setPriorities', { order: ['industrie', 'sante', 'services', 'residentiel', 'commerce'] });
  assert.ok(r.ok);
  const s2 = elec.system.summary()!;
  assert.ok(cls(s2, 'industrie').deliveredKw > 0, 'industrie servie après changement de priorité');
  assert.ok(cls(s2, 'residentiel').cut > resCutBefore, 'résidentiel davantage coupé');
  assert.ok(m.effects.topCauses(100).some((c) => c.cause.kind === 'electricite:reglage'));

  // Construction d'une grande centrale : fin de la pénurie, rétablissement tracé.
  sim.plugins.command('electricite', 'setPriorities', { order: ['sante', 'services', 'residentiel', 'commerce', 'industrie'] });
  placeFacilities(sim, 230, -100, 100, ['centrale_gaz']);
  advanceHours(sim, 2);
  const s3 = elec.system.summary()!;
  assert.equal(s3.cut, 0);
  assert.equal(s3.shortfallKw, 0);
  assert.ok(s3.exportableKw > 50_000, `surplus exportable publié : ${s3.exportableKw} kW`);
  assert.ok(m.effects.query({ cause: causes[0]!.cause.id }).some((e) => e.target === 'electricite:retablissement'));
});

test('effet : entretien réduit -> pannes plus fréquentes (même graine), tracées dans le registre', () => {
  const run = (funding: number): { failures: number; registry: number } => {
    const { sim, elec } = powerTown({ seed: 77 });
    placeFacilities(sim, 160, -220, 220, ['eolienne', 'eolienne', 'eolienne', 'eolienne', 'eolienne', 'eolienne', 'eolienne', 'eolienne', 'eolienne', 'eolienne', 'poste', 'poste', 'poste']);
    placeFacilities(sim, 230, -220, 220, ['centrale_gaz', 'centrale_gaz', 'ferme_solaire', 'ferme_solaire']);
    const r = sim.plugins.command('electricite', 'setFunding', { funding });
    assert.ok(r.ok);
    advanceHours(sim, 24 * 40, 30);
    const failures = Object.values(elec.system.state.facilities).reduce((n, f) => n + f.failures, 0);
    const registry = elec.municipal()!.effects.topCauses(1000).filter((c) => c.cause.kind === 'electricite:panne').length;
    return { failures, registry };
  };
  const nominal = run(1);
  const reduit = run(0.4);
  assert.ok(nominal.failures > 0, `pannes à 100 % : ${nominal.failures}`);
  assert.ok(reduit.failures > nominal.failures * 2.5, `pannes à 40 % (${reduit.failures}) >> à 100 % (${nominal.failures})`);
  assert.ok(reduit.registry >= reduit.failures, 'chaque panne est une cause du registre');
});

test('effet : éolien sans vent -> production éolienne nulle, coupures (météo publiée par un autre module)', () => {
  const weather = { wind: 13, cloud: 0 };
  const meteo: SimPlugin = { id: 'weather', init(ctx) { ctx.provide('weather', weather); } };
  const { sim, elec } = powerTown({ days: 2, plugins: (e) => [meteo, e] });
  placeFacilities(sim, 160, -100, 100, ['eolienne', 'eolienne', 'eolienne']); // 3 × 600 kW
  advanceToHour(sim, 12);
  advanceHours(sim, 1);
  const venteux = elec.system.summary()!;
  const eolV = venteux.bySource.find((b) => b.source === 'eolien')!;
  assert.equal(venteux.windSource, 'meteo');
  assert.ok(eolV.availableKw >= 1800 - 1e-6, `éolien disponible par vent de 13 m/s : ${eolV.availableKw} kW`);
  assert.equal(venteux.cut, 0);
  weather.wind = 0.5;
  advanceHours(sim, 1);
  const calme = elec.system.summary()!;
  const eolC = calme.bySource.find((b) => b.source === 'eolien')!;
  assert.equal(eolC.availableKw, 0, 'aucune production sans vent');
  assert.ok(eolC.outputKw < eolV.outputKw);
  assert.ok(calme.cut > 0, 'coupures faute de vent');
  // Forçage (démonstration) : prioritaire sur la météo.
  const r = sim.plugins.command('electricite', 'forceWind', { ms: 13 });
  assert.ok(r.ok);
  assert.equal(elec.system.summary()!.windSource, 'force');
  assert.ok(elec.system.summary()!.bySource.find((b) => b.source === 'eolien')!.availableKw >= 1800 - 1e-6);
});

test('effet : sans courant -> satisfaction en baisse dans les cellules coupées, rétablie ensuite ; thermique -> pollution de l\'air', () => {
  const { sim, elec } = powerTown({ days: 2 });
  const [plant] = placeFacilities(sim, 160, -100, 100, ['petite_centrale']);
  advanceToHour(sim, 19); // pointe résidentielle
  advanceHours(sim, 4);
  const m = elec.municipal()!;
  const sat = m.grids.get('satisfaction')!;
  assert.ok(sat.stats().min < 50, `satisfaction minimale ${sat.stats().min} < 50`);
  const air = m.grids.get('pollution_air')!;
  const p = sim.buildings.indexOf(plant!);
  assert.ok(air.at(sim.buildings.x[p]!, sim.buildings.z[p]!) > 0, 'pollution de l\'air près de la centrale');
  // Rétablissement : grande centrale -> la pénalité disparaît progressivement (réversible, bornée).
  placeFacilities(sim, 230, -100, 100, ['centrale_gaz']);
  advanceHours(sim, 24);
  assert.equal(elec.system.summary()!.cut, 0);
  assert.ok(Math.abs(sat.stats().min - 50) < 1e-6, `satisfaction revenue au fond : ${sat.stats().min}`);
});

test('réseau : un poste hors de portée n\'alimente rien sans ligne ; ligne HT construite -> quartier alimenté ; ligne en panne -> coupure', () => {
  const { sim, elec } = powerTown({ days: 1 });
  const [plant] = placeFacilities(sim, 160, -100, 100, ['centrale_gaz']);
  // Hameau éloigné (> 450 m de la centrale) avec son poste.
  const far = buildStreet(sim, -250, 200, 480, ['maison', 'maison', 'maison', 'poste', 'maison']);
  const poste = far[3]!;
  advanceHours(sim, 2);
  let s = elec.system.summary()!;
  for (const id of [far[0]!, far[1]!, far[4]!]) assert.equal(elec.system.powerFactor(id), 0, 'hameau non alimenté sans ligne');
  assert.equal(s.unlinked, 0, 'le hameau est à portée de son poste');
  const q = sim.plugins.command('electricite', 'quoteLine', { a: plant!, b: poste });
  assert.ok(q.ok);
  const b = sim.plugins.command('electricite', 'buildLine', { a: plant!, b: poste });
  assert.ok(b.ok, !b.ok ? b.error.message : '');
  s = elec.system.summary()!;
  for (const id of [far[0]!, far[1]!, far[4]!]) assert.equal(elec.system.powerFactor(id), 1, 'hameau alimenté par la ligne');
  assert.ok(s.lossesKw > 0, 'pertes en ligne');
  // Panne de la ligne -> coupure du hameau.
  elec.system.state.lines[0]!.failedUntil = sim.clock.totalMinutes + 600;
  sim.plugins.command('electricite', 'refresh', undefined);
  assert.equal(elec.system.powerFactor(far[0]!), 0);
  assert.ok(sim.plugins.command('electricite', 'buildLine', { a: plant!, b: poste }).ok === false, 'ligne en double refusée');
});

test('sauvegarde : section electricite (contrat intégré) aller-retour, même évolution après rechargement', () => {
  const { sim, elec } = powerTown({ days: 1 });
  const [plant] = placeFacilities(sim, 160, -100, 100, ['petite_centrale', 'poste']);
  sim.plugins.command('electricite', 'setFunding', { funding: 0.6 });
  sim.plugins.command('electricite', 'setRooftops', { enabled: true });
  void plant;
  advanceHours(sim, 30);
  const save = JSON.parse(JSON.stringify(sim.toSave())) as ReturnType<Simulation['toSave']>;
  assert.ok(save.plugins?.electricite, 'section écrite');
  const data = save.plugins.electricite.data as { power: unknown; municipal: unknown };
  assert.ok(data.power && data.municipal, 'état du service et contrat municipal intégré');

  const e2 = createElectricitePlugin();
  const t = new Simulation([e2]);
  t.setCatalog(powerCatalog());
  assert.equal(t.fromSave(save), null);
  assert.equal(e2.system.state.settings.funding, 0.6);
  assert.ok(e2.system.rooftopCount() > 0);
  advanceHours(sim, 12);
  advanceHours(t, 12);
  const a = elec.system.summary()!, b = e2.system.summary()!;
  assert.deepEqual({ ...b }, { ...a });
  assert.deepEqual(t.toSave().plugins, sim.toSave().plugins);
});

test('partie sans installation électrique : aucun delta, aucune section, aucun effet municipal', () => {
  const { sim, elec } = powerTown({ days: 1 });
  assert.equal(sim.toSave().plugins, undefined);
  assert.equal(elec.system.summary(), undefined);
  assert.equal(elec.municipal()!.isEmpty, true);
});

test('effet réel : sans courant, un bâtiment n\'offre plus ses emplois ; sans réseau construit, aucun effet', () => {
  const { sim, elec } = powerTown({ days: 2 });
  const jobsOf = (): number => (sim as unknown as { demography: { report(t: number, r: number): { jobsTotal: number } } }).demography.report(sim.clock.totalMinutes, 0.1).jobsTotal;
  const before = jobsOf();
  assert.ok(before > 0, 'emplois offerts avant tout réseau');
  // Une petite centrale ne suffit pas à toute la demande : une partie des bâtiments est délestée.
  placeFacilities(sim, 160, -100, 100, ['petite_centrale']);
  advanceToHour(sim, 12);
  advanceHours(sim, 2);
  const unpowered = sim.buildings.count > 0 ? Array.from(sim.buildings.id.subarray(0, sim.buildings.count)).filter((id) => elec.system.powerFactor(id) < 1).length : 0;
  assert.ok(unpowered > 0, 'des bâtiments délestés');
  assert.ok(jobsOf() < before, `emplois offerts en baisse (${before} -> ${jobsOf()})`);
});

test('distribution le long des routes : rue non reliée = non raccordée même à 100 m ; reliée par une route = alimentée', () => {
  const { sim, elec } = powerTown({ days: 1 });
  placeFacilities(sim, 160, -100, 100, ['centrale_gaz']);
  // Rue isolée à ~100 m de la centrale, sans liaison routière.
  const iso = buildStreet(sim, 260, 120, 260, ['maison', 'maison']);
  advanceHours(sim, 2);
  for (const id of iso) assert.equal(elec.system.powerFactor(id), 0, 'rue isolée non alimentée');
  assert.ok(elec.system.summary()!.unlinked >= 2, 'comptée non raccordée');
  // Liaison routière avec la rue des installations : courant rétabli.
  const r = sim.buildRoad({ type: 'street', points: [100, 160, 120, 260] });
  assert.ok(r.ok, !r.ok ? r.error.message : '');
  advanceHours(sim, 2);
  for (const id of iso) assert.equal(elec.system.powerFactor(id), 1, 'rue reliée alimentée');
});
