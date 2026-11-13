/** Lignes budgétaires, registre d'effets, ordonnanceur multi-fréquence (unitaires, sans simulation). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allocateByWeight, BudgetLedger, MIRROR_CATEGORIES, type EconomyMonthLike } from '../../src/sim/municipal/budget';
import { EffectRegistry } from '../../src/sim/municipal/effects';
import { IndicatorGrid } from '../../src/sim/municipal/grid';
import { MultiRateScheduler, type TaskInfo } from '../../src/sim/municipal/scheduler';

/* ------------------------------- Budget ------------------------------- */

test('budget : répartition par poids en centimes exacts', () => {
  const p = allocateByWeight(100, { a: 1, b: 1, c: 1 });
  assert.deepEqual(p, { a: 33.34, b: 33.33, c: 33.33 });
  assert.equal(Object.values(p).reduce((s, v) => s + v, 0).toFixed(2), '100.00');
  assert.deepEqual(allocateByWeight(10, { x: 0, y: -1 }), {});
  assert.deepEqual(allocateByWeight(9.99, { n: 3, s: 1 }), { n: 7.49, s: 2.5 });
});

test('budget : lignes par poste / service / quartier, clôture et agrégats', () => {
  const b = new BudgetLedger();
  assert.equal(b.isEmpty, true);
  b.post('income', 'vente:electricite', 1200, 'electricite', 'centre');
  b.post('income', 'vente:electricite', 300, 'electricite', 'centre');
  b.post('expense', 'entretien:lignes', 400, 'electricite');
  b.postByDistrict('expense', 'entretien:canalisations', 100, { nord: 1, sud: 3 }, 'eau');
  assert.throws(() => b.post('expense', 'x', -5), /invalide/);
  assert.throws(() => b.post('expense', '', 5), /poste vide/);
  assert.equal(b.pendingModuleBalance(), 1500 - 400 - 100);
  const m = b.closeMonth(0);
  assert.equal(m.income, 1500);
  assert.equal(m.expense, 500);
  assert.equal(m.balance, 1000);
  assert.equal(m.moduleBalance, 1000);
  assert.equal(m.mirroredBalance, 0);
  assert.equal(m.lines.length, 4);
  assert.deepEqual(b.groupBy('service'), { electricite: 1100, eau: -100 });
  assert.deepEqual(b.groupBy('district'), { centre: 1500, '(ville)': -400, nord: -25, sud: -75 });
  assert.equal(b.groupBy('category')['vente:electricite'], 1500);
  assert.equal(b.pendingModuleBalance(), 0, 'mois suivant vierge');
  const back = BudgetLedger.fromJSON(JSON.parse(JSON.stringify(b.toJSON())));
  assert.deepEqual(back.toJSON(), b.toJSON());
});

test('budget : miroir du bilan de l\'économie, montants inchangés, distinct des lignes de modules', () => {
  const rec: EconomyMonthLike = {
    monthIndex: 3,
    income: { residential: 1000.5, commercial: 200, industrial: 0, office: 50.25 },
    expenses: { buildings: 600, roads: 120.75, salaries: 80, loanInterest: 10, loanPrincipal: 40 },
    balance: 1000.5 + 200 + 50.25 - (600 + 120.75 + 80 + 10 + 40),
  };
  const b = new BudgetLedger();
  b.post('expense', 'achat:energie', 30, 'electricite');
  const mirrored = b.mirrorEconomyMonth(rec);
  assert.equal(mirrored, Math.round(rec.balance * 100) / 100);
  const m = b.closeMonth(rec.monthIndex);
  assert.equal(m.mirroredBalance, Math.round(rec.balance * 100) / 100);
  assert.equal(m.moduleBalance, -30);
  assert.equal(m.balance, Math.round((rec.balance - 30) * 100) / 100);
  assert.ok(m.lines.some((l) => l.category === MIRROR_CATEGORIES.tax('residential') && l.amount === 1000.5));
  assert.ok(!m.lines.some((l) => l.category === MIRROR_CATEGORIES.tax('industrial')), 'montant nul non recopié');
  // Ventilation par quartier : total identique.
  const b2 = new BudgetLedger();
  b2.mirrorEconomyMonth(rec, { a: 2, b: 1 });
  const m2 = b2.closeMonth(3);
  assert.equal(m2.mirroredBalance, m.mirroredBalance);
  assert.ok(m2.lines.every((l) => l.district === 'a' || l.district === 'b'));
});

/* ---------------------------- Registre d'effets ---------------------------- */

test('effets : cause, effets localisés, requêtes, synthèse et classement', () => {
  const r = new EffectRegistry(100, 10);
  assert.equal(r.isEmpty, true);
  const usine = r.cause({ kind: 'construction', label: 'Usine chimique', source: 'joueur', at: 60, x: 100, z: 0, ref: 7 });
  const taxe = r.cause({ kind: 'taux_impot', label: 'Impôt résidentiel 9 % -> 12 %', source: 'joueur', at: 90 });
  r.record(usine, 'pollution_air', 320, 'indice·cellules', 120, { x: 110, z: 5, radius: 80 });
  r.record(usine, 'valeur_fonciere', -900, '¢/m²·cellules', 1500, { x: 110, z: 5, radius: 120 }, 'pollution -> foncier');
  r.record(taxe, 'budget:recettes', 4000, '¢/mois', 1440, { district: 'centre' });
  assert.equal(r.record(999, 'x', 1, 'u', 0), null, 'cause inconnue');
  assert.throws(() => r.record(usine, 'x', Number.NaN, 'u', 0), /invalide/);
  assert.equal(r.query().length, 3);
  assert.equal(r.query()[0]!.target, 'budget:recettes', 'du plus récent au plus ancien');
  assert.equal(r.query({ cause: usine }).length, 2);
  assert.equal(r.query({ target: 'valeur_fonciere' })[0]!.note, 'pollution -> foncier');
  assert.equal(r.query({ x: 300, z: 0, radius: 50 }).length, 0);
  assert.equal(r.query({ x: 250, z: 0, radius: 50 }).length, 1, 'rayon de l\'effet pris en compte');
  assert.equal(r.query({ district: 'centre' }).length, 1);
  assert.equal(r.query({ since: 1000 }).length, 2);
  assert.deepEqual(r.summary(usine)!.byTarget, { pollution_air: 320, valeur_fonciere: -900 });
  assert.deepEqual(r.topCauses().map((s) => s.cause.id), [taxe, usine]);
  assert.equal(r.drainRecent().length, 3);
  assert.equal(r.drainRecent().length, 0);
  const back = EffectRegistry.fromJSON(JSON.parse(JSON.stringify(r.toJSON())), 100, 10);
  assert.deepEqual(back.toJSON(), r.toJSON());
  assert.equal(back.cause({ kind: 'k', label: 'l', source: 's', at: 0 }), taxe + 1);
});

test('effets : tampon borné, synthèse conservée ; mesure d\'une grille avant / après', () => {
  const r = new EffectRegistry(5, 3);
  const c = r.cause({ kind: 'k', label: 'l', source: 's', at: 0 });
  for (let k = 0; k < 12; k++) r.record(c, 't', 1, 'u', k);
  assert.equal(r.effectCount, 5);
  assert.equal(r.summary(c)!.count, 12);
  assert.equal(r.summary(c)!.byTarget.t, 12);
  for (let k = 0; k < 3; k++) r.cause({ kind: 'k', label: `${k}`, source: 's', at: 0 });
  assert.equal(r.causeCount, 3);
  assert.equal(r.getCause(c), undefined, 'la plus ancienne cause est oubliée');

  const g = new IndicatorGrid({ id: 'pollution_air', nameFr: 'Air', unit: 'indice', base: 0, min: 0, max: 100 }, { originX: 0, originZ: 0, cellSize: 10, cols: 10, rows: 10 });
  const reg = new EffectRegistry();
  const cause = reg.cause({ kind: 'construction', label: 'Usine', source: 'joueur', at: 0 });
  const before = g.copyValues();
  assert.equal(reg.measureGrid(cause, g, before, 0), null, 'rien changé');
  const added = g.stamp(55, 55, 20, 10);
  const e = reg.measureGrid(cause, g, before, 10)!;
  assert.ok(Math.abs(e.magnitude - added) < 1e-3);
  assert.ok(Math.abs(e.x! - 55) < 1e-6 && Math.abs(e.z! - 55) < 1e-6, 'barycentre au point d\'émission');
  assert.ok(e.radius! >= 10 && e.radius! <= 30);
});

/* ------------------------------ Ordonnanceur ------------------------------ */

function drive(s: MultiRateScheduler, days: number, step: number): void {
  // Reproduit l'ordre de la simulation : événements de base (mois, jour) puis onTick.
  let t = 0;
  while (t < days * 1440) {
    t += step;
    if (Math.floor(t / 1440) !== Math.floor((t - step) / 1440)) {
      if (Math.floor(t / 43200) !== Math.floor((t - step) / 43200)) s.month(Math.floor(t / 43200), t);
      s.day(Math.floor(t / 1440), t);
    }
    s.advance(t, step);
  }
}

test('ordonnanceur : nombre d\'exécutions par fréquence, rattrapage des heures, ordre', () => {
  for (const step of [1, 7, 30, 90]) {
    const s = new MultiRateScheduler();
    const count: Record<string, number> = { tick: 0, hour: 0, day: 0, month: 0 };
    const hours: number[] = [];
    s.add({ id: 't', every: 'tick', run: () => { count.tick!++; } });
    s.add({ id: 'h', every: 'hour', run: (i: TaskInfo) => { count.hour!++; hours.push(i.index); } });
    s.add({ id: 'd', every: 'day', run: () => { count.day!++; } });
    s.add({ id: 'm', every: 'month', run: () => { count.month!++; } });
    drive(s, 31, step);
    const ticks = Math.ceil((31 * 1440) / step);
    assert.equal(count.tick, ticks, `pas ${step}`);
    const lastT = ticks * step;
    assert.equal(count.hour, Math.floor(lastT / 60), `heures, pas ${step}`);
    assert.deepEqual(hours.slice(0, 3), [1, 2, 3], 'chaque heure une fois, dans l\'ordre');
    assert.equal(count.day, Math.floor(lastT / 1440));
    assert.equal(count.month, 1);
  }
  const s = new MultiRateScheduler();
  const order: string[] = [];
  s.add({ id: 'b', every: 'tick', run: () => order.push('b') });
  s.add({ id: 'a', every: 'tick', order: -1, run: () => order.push('a') });
  s.add({ id: 'c', every: 'tick', run: () => order.push('c') });
  assert.throws(() => s.add({ id: 'c', every: 'tick', run: () => {} }), /déjà/);
  s.advance(1, 1);
  assert.deepEqual(order, ['a', 'b', 'c']);
  assert.ok(s.remove('a'));
  assert.deepEqual(s.ids('tick'), ['b', 'c']);
});

test('ordonnanceur : échéance jamais rejouée, tâche en erreur isolée, état sauvegardé', () => {
  const s = new MultiRateScheduler();
  let days = 0, ok = 0;
  const logs: string[] = [];
  s.log = (m) => logs.push(m);
  s.add({ id: 'boom', every: 'tick', run: () => { throw new Error('panne'); } });
  s.add({ id: 'ok', every: 'tick', run: () => { ok++; } });
  s.add({ id: 'd', every: 'day', run: (i) => { days++; assert.equal(i.minutes, days === 1 ? 0 : 1440); } });
  s.day(1, 1440); s.day(1, 1440); s.day(2, 2880);
  assert.equal(days, 2);
  s.advance(1, 1); s.advance(2, 1);
  assert.equal(ok, 2);
  const st = s.stats().find((x) => x.id === 'boom')!;
  assert.equal(st.errors, 2);
  assert.equal(logs.length, 1, 'journalisée une seule fois');
  const j = s.toJSON();
  const t = new MultiRateScheduler();
  t.fromJSON(JSON.parse(JSON.stringify(j)));
  assert.deepEqual(t.toJSON(), j);
  let replay = 0;
  t.add({ id: 'd', every: 'day', run: () => { replay++; } });
  t.day(2, 2880);
  assert.equal(replay, 0, 'jour déjà traité avant la sauvegarde');
  t.resetClock();
  assert.equal(t.lastDay, -1);
});
