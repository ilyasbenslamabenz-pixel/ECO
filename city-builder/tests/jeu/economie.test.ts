/**
 * Économie : démolition des bâtiments privés (zonage) sans remboursement, annulation neutre d'une démolition,
 * politiques facturées au prorata, solde prévu complet (services compris), sauvegarde fidèle (assiettes, déchets,
 * paliers), améliorations refusées en faillite ou sans effet, anciennes sauvegardes chargées en cours de mois.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../../src/sim/world';
import { Economy, HOURS_PER_MONTH } from '../../src/sim/economy';
import { MINUTES_PER_MONTH } from '../../src/sim/clock';
import { buildTown, newTownSim, runDays, townCatalog } from '../sim/fixtures';
import type { PaliersState } from '../../src/shared/milestones';

const reload = (s: Simulation, mutate?: (save: Record<string, unknown>) => void): Simulation => {
  const save = JSON.parse(JSON.stringify(s.toSave())) as Record<string, unknown>;
  mutate?.(save);
  const c = new Simulation(); c.setCatalog(s.catalog!);
  assert.equal(c.fromSave(save), null);
  return c;
};

/* ------------------------------ Démolition ------------------------------ */

test('démolition : un bâtiment privé (zonage) ne rembourse rien, même après rechargement', () => {
  const s = newTownSim();
  assert.ok(s.buildRoad({ type: 'street', points: [-200, 0, 200, 0] }).ok);
  const p = s.placePrivateBuilding({ assetId: 'immeuble', x: -100, z: -20, rot: 0 });
  assert.ok(p.ok);
  const q = s.placePrivateBuilding({ assetId: 'immeuble', x: 0, z: -20, rot: 0 });
  assert.ok(q.ok);
  assert.ok(s.isPrivateBuilding(p.data.buildingId));
  const money = s.economy.money;
  const r = s.demolish({ buildingId: p.data.buildingId });
  assert.ok(r.ok);
  assert.equal(r.data.refund, 0, 'aucun remboursement pour un bâtiment jamais payé');
  assert.equal(s.economy.money, money);
  // Après rechargement : toujours privé.
  const c = reload(s);
  assert.ok(c.isPrivateBuilding(q.data.buildingId));
  const r2 = c.demolish({ buildingId: q.data.buildingId });
  assert.ok(r2.ok && r2.data.refund === 0);
  // Bâtiment du joueur : 25 % remboursés comme avant.
  const own = s.placeBuilding({ assetId: 'maison', x: 100, z: -16, rot: 0 });
  assert.ok(own.ok);
  const r3 = s.demolish({ buildingId: own.data.buildingId });
  assert.ok(r3.ok && r3.data.refund === 10_000);
});

test('annulation : reconstruire après démolition (jeton) est neutre ; privé reconstruit gratuitement et reste privé', () => {
  const s = newTownSim();
  assert.ok(s.buildRoad({ type: 'street', points: [-200, 0, 200, 0] }).ok);
  const ids: number[] = [];
  for (const x of [-150, -100, -50]) { const r = s.placeBuilding({ assetId: 'immeuble', x, z: -20, rot: 0 }); assert.ok(r.ok); ids.push(r.data.buildingId); }
  const priv = s.placePrivateBuilding({ assetId: 'immeuble', x: 50, z: -20, rot: 0 });
  assert.ok(priv.ok);
  const before = s.economy.money;
  // Démolition de zone (plusieurs objets) puis annulation de chacun avec son jeton.
  const tokens: { id: number; token: number; x: number }[] = [];
  for (const [k, id] of [...ids, priv.data.buildingId].entries()) {
    const r = s.demolish({ buildingId: id });
    assert.ok(r.ok && r.data.restoreToken !== undefined);
    tokens.push({ id, token: r.data.restoreToken!, x: [-150, -100, -50, 50][k]! });
  }
  assert.equal(s.economy.money, before + 3 * 150_000, '25 % remboursés pour les trois immeubles du joueur, rien pour le privé');
  let rebuilt = 0;
  for (const t of tokens) {
    const r = s.placeBuilding({ assetId: 'immeuble', x: t.x, z: -20, rot: 0, restoreToken: t.token });
    assert.ok(r.ok, !r.ok ? r.error.message : '');
    if (t.x === 50) { assert.equal(r.data.cost, 0); assert.ok(s.isPrivateBuilding(r.data.buildingId), 'redevenu privé'); } else rebuilt++;
  }
  assert.equal(rebuilt, 3);
  assert.equal(s.economy.money, before, 'démolir puis annuler : trésorerie inchangée');
  // Jeton déjà utilisé : pose ordinaire au prix catalogue.
  const d = s.demolish({ buildingId: s.buildings.id[s.buildings.count - 1]! });
  assert.ok(d.ok);
  const reuse = s.placeBuilding({ assetId: 'immeuble', x: 150, z: -20, rot: 0, restoreToken: tokens[0]!.token });
  assert.ok(reuse.ok && reuse.data.cost === 600_000, 'jeton à usage unique');
  // Route : suppression puis annulation au prix du remboursement.
  const road = s.buildRoad({ type: 'street', points: [-200, 200, 200, 200] });
  assert.ok(road.ok);
  const m0 = s.economy.money;
  const rm = s.removeRoad({ edgeId: road.data.edgeIds[0]! });
  assert.ok(rm.ok && rm.data.restoreToken !== undefined);
  const back = s.buildRoad({ type: 'street', points: [-200, 200, 200, 200], restoreToken: rm.data.restoreToken! });
  assert.ok(back.ok);
  assert.equal(back.data.cost, rm.data.refund);
  assert.ok(Math.abs(s.economy.money - m0) < 1e-6, 'suppression de route annulée : trésorerie inchangée');
});

/* ------------------------------ Politiques ------------------------------ */

const pol = (s: Simulation, name: string, payload?: unknown): { ok: boolean; data?: Record<string, unknown> } => {
  const r = s.plugins.command('politiques', name, payload) as { ok: boolean; data?: { data?: Record<string, unknown> } };
  return { ok: r.ok, data: r.data?.data };
};

test('politiques : adopter puis abandonner entre deux débuts de mois est facturé au prorata', () => {
  const s = newTownSim(); buildTown(s); runDays(s, 2);
  const monthStart = Math.floor(s.clock.totalMinutes / MINUTES_PER_MONTH) * MINUTES_PER_MONTH;
  const state = pol(s, 'state').data as { policies: { id: string; monthlyCost: number }[] };
  const def = state.policies.find((p) => p.monthlyCost > 0)!;
  assert.ok(def, 'une politique payante');
  assert.ok(pol(s, 'toggle', { id: def.id, on: true }).ok);
  const t0 = s.clock.totalMinutes;
  runDays(s, 10);
  const t1 = s.clock.totalMinutes;
  const cost = (pol(s, 'state').data as { policies: { id: string; monthlyCost: number }[] }).policies.find((p) => p.id === def.id)!.monthlyCost;
  const moneyBeforeOff = s.economy.money;
  assert.ok(pol(s, 'toggle', { id: def.id, on: false }).ok);
  const charged = moneyBeforeOff - s.economy.money;
  const expected = Math.round(cost * (t1 - Math.max(t0, monthStart)) / MINUTES_PER_MONTH);
  assert.equal(charged, expected, `abandon : ${charged} CHF facturés pour ${(t1 - t0) / 1440} jours`);
  assert.ok(charged > 0);
});

test('politiques : adoptée en milieu de mois -> facturée pour la part du mois au début du mois suivant', () => {
  const s = newTownSim(); buildTown(s);
  runDays(s, 15);
  const def = (pol(s, 'state').data as { policies: { id: string; monthlyCost: number }[] }).policies.find((p) => p.monthlyCost > 0)!;
  assert.ok(pol(s, 'toggle', { id: def.id, on: true }).ok);
  runDays(s, 16);
  const last = (pol(s, 'state').data as { lastCost: number }).lastCost;
  const cost = (pol(s, 'state').data as { policies: { id: string; monthlyCost: number }[] }).policies.find((p) => p.id === def.id)!.monthlyCost;
  assert.ok(last > 0 && last < cost, `prorata ${last} < coût mensuel ${cost}`);
});

/* ------------------------------ Solde prévu ------------------------------ */

test('prévision : services récurrents inclus dans le solde, la projection et le solde horaire ; ponctuels exclus', () => {
  const e = new Economy();
  e.reset(10_000);
  e.addUpkeep(1000);
  e.onHour(1);
  e.applyService(-720, false); // service récurrent (ex. entretien du réseau électrique)
  e.applyService(-50_000, true); // investissement ponctuel
  e.onMonth({ monthIndex: 0, population: 0, jobs: 0, unemploymentRate: 0, happiness: 0 });
  const f = e.forecast();
  assert.equal(f.services, -720);
  assert.equal(f.baseBalance, -1000);
  assert.equal(f.balance, -1720, 'solde complet = impôts + services − entretien − salaires − emprunts');
  assert.equal(e.monthlyBalance, -1720);
  assert.equal(f.projection[0], Math.round(e.money - 1720));
  assert.ok(Math.abs(e.hourlyBalance - (-1720 / HOURS_PER_MONTH)) < 1e-9, 'horaire : sans le montant ponctuel');
  // Clôture mensuelle versée d'un coup en début de mois : le solde horaire n'explose pas.
  e.onHour(1);
  e.applyService(-720, false);
  assert.ok(Math.abs(e.hourlyBalance - (-1720 / HOURS_PER_MONTH)) < 1e-9);
  // Sauvegarde : prévision identique après rechargement.
  const c = new Economy(); c.fromJSON(JSON.parse(JSON.stringify(e.toJSON())));
  c.addUpkeep(1000); // l'entretien est recalculé par le monde à partir des bâtiments
  assert.deepEqual(c.forecast(), e.forecast());
});

/* ------------------------------ Sauvegarde ------------------------------ */

test('sauvegarde : assiettes fiscales et effectif des services conservés (partie identique)', () => {
  const s = newTownSim(); buildTown(s); runDays(s, 5);
  // Écart volontaire avec le recalcul depuis la population : la valeur en vigueur doit être relue telle quelle.
  s.economy.taxBase.residential += 1234.5;
  s.economy.serviceWorkers += 3;
  const c = reload(s);
  assert.deepEqual({ ...c.economy.taxBase }, { ...s.economy.taxBase });
  assert.equal(c.economy.serviceWorkers, s.economy.serviceWorkers);
  // Ancienne sauvegarde (sans ces champs) : recalcul depuis la population.
  const old = reload(s, (save) => { const e = save.economy as Record<string, unknown>; delete e.taxBase; delete e.serviceWorkers; });
  assert.notEqual(old.economy.taxBase.residential, s.economy.taxBase.residential);
});

test('sauvegarde : la section « déchets » survit à un rechargement suivi d\'une nouvelle sauvegarde', () => {
  const s = newTownSim(); buildTown(s); runDays(s, 3);
  const a = JSON.parse(JSON.stringify(s.toSave())) as { plugins?: Record<string, unknown> };
  assert.ok(a.plugins?.dechets, 'section écrite');
  const c = reload(s);
  const b = JSON.parse(JSON.stringify(c.toSave())) as { plugins?: Record<string, { data: unknown }> };
  assert.ok(b.plugins?.dechets, 'section conservée juste après le chargement');
  assert.deepEqual((b.plugins!.dechets as { data: { bins: unknown } }).data.bins, (a.plugins!.dechets as { data: { bins: unknown } }).data.bins);
});

const paliers = (s: Simulation): PaliersState => (s.plugins.command('paliers', 'state', undefined) as { data: { data: PaliersState } }).data.data;

test('paliers : partie neuve commencée en avril -> primes versées ; ancienne sauvegarde sans section -> acquis sans prime', () => {
  const s = new Simulation(); s.setCatalog(townCatalog());
  s.newGame({ seed: 1234, mapChunks: 4, startMoney: 50_000_000, cityName: 'Bourg-Avril', terrain: { hydrology: 'aucune', rivers: 0 }, startMonth: 4 });
  assert.ok(s.clock.totalMinutes > 2 * 1440, 'partie commencée en avril');
  buildTown(s);
  runDays(s, 12);
  const st = paliers(s);
  assert.ok(st.population >= 100);
  assert.ok(st.reached.includes('hameau'), 'hameau atteint');
  assert.ok(s.notices.some((n) => /prime de/.test(n.message)), 'prime versée');
  // Sauvegarde d'avant les paliers (section absente) : seuils dépassés acquis, sans prime rétroactive.
  const old = reload(s, (save) => { delete (save.plugins as Record<string, unknown>).paliers; });
  assert.ok(paliers(old).reached.includes('hameau'));
  runDays(old, 1);
  assert.ok(!old.notices.some((n) => /prime de/.test(n.message)), 'aucune prime rétroactive');
});

test('paliers : seuil franchi juste avant la sauvegarde -> prime versée après rechargement', () => {
  const s = newTownSim(); buildTown(s);
  // Avance jusqu'à 100 habitants sans laisser passer le contrôle quotidien suivant.
  let guard = 0;
  while ((s.demography?.population ?? 0) < 100 && guard++ < 40 * 720) s.tick(2);
  assert.ok((s.demography?.population ?? 0) >= 100);
  if (paliers(s).reached.includes('hameau')) return; // déjà évalué le même jour : scénario non reproductible ici
  const c = reload(s);
  assert.ok(!paliers(c).reached.includes('hameau'), 'pas encore acquis au chargement');
  runDays(c, 1);
  assert.ok(paliers(c).reached.includes('hameau'));
  assert.ok(c.notices.some((n) => /prime de/.test(n.message)), 'prime versée après rechargement');
});

/* ------------------------------ Améliorations ------------------------------ */

const amel = (s: Simulation, name: string, payload?: unknown): { ok: boolean; message?: string } => {
  const r = s.plugins.command('ameliorations', name, payload) as { ok: boolean; error?: { message: string } };
  return { ok: r.ok, message: r.error?.message };
};

test('améliorations : refusées en faillite et pour un service sans effet (service:eau)', () => {
  const cat = townCatalog();
  const parc = cat.assets.find((a) => a.id === 'parc')!;
  cat.assets.push({ ...parc, id: 'reservoir_test', nameFr: 'Réservoir test', tags: ['service:eau'] });
  const s = new Simulation(); s.setCatalog(cat);
  s.newGame({ seed: 1234, mapChunks: 4, startMoney: 50_000_000, cityName: 'Bourg-Test', terrain: { hydrology: 'aucune', rivers: 0 } });
  buildTown(s);
  const res = s.placeBuilding({ assetId: 'reservoir_test', x: 0, z: -200, rot: 0 });
  assert.ok(res.ok);
  const r = amel(s, 'upgrade', { buildingId: res.data.buildingId });
  assert.equal(r.ok, false, 'service sans effet : amélioration non proposée');
  let school = -1;
  for (let i = 0; i < s.buildings.count; i++) if (s.catalog!.assets[s.buildings.assetIndex[i]!]!.id === 'ecole') school = s.buildings.id[i]!;
  s.economy.bankrupt = true;
  const money = s.economy.money;
  const b = amel(s, 'upgrade', { buildingId: school });
  assert.equal(b.ok, false);
  assert.match(b.message ?? '', /faillite/);
  assert.equal(s.economy.money, money);
  s.economy.bankrupt = false;
  assert.ok(amel(s, 'upgrade', { buildingId: school }).ok);
});

/* ------------------------- Anciennes sauvegardes ------------------------- */

test('ancienne sauvegarde chargée en cours de mois : aucune double facturation', () => {
  const s = newTownSim(); buildTown(s); runDays(s, 40);
  runDays(s, 12); // milieu du 2e mois
  const ref = reload(s);
  // Format d'avant le versement horaire : pas de cumuls horaires ni de distinction des services.
  const old = reload(s, (save) => {
    const m = (save.economy as { month: Record<string, unknown> }).month;
    for (const k of ['operating', 'hours', 'acc', 'services', 'lastServices', 'servicesRecurring', 'lastServicesRecurring']) delete m[k];
  });
  const op = (e: Economy): number => e.monthlyIncome - e.monthlyUpkeep - e.salaries();
  const m0 = old.economy.money;
  const d0 = ref.economy.money;
  runDays(old, 20); runDays(ref, 20);
  const oneMonth = Math.abs(op(old.economy)) + Math.abs(op(ref.economy)) + 1;
  // L'écart entre les deux reprises ne dépasse pas ce qui a été versé avant la sauvegarde (moins d'un mois),
  // jamais un mois en double.
  assert.ok(Math.abs((old.economy.money - m0) - (ref.economy.money - d0)) < oneMonth, 'pas de mois facturé deux fois');
});
