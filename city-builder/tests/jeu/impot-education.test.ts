/** Impôt résidentiel par niveau d'éducation : taux effectif, recettes, satisfaction, migration, sauvegarde rétrocompatible. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../../src/sim/world';
import { DEFAULT_TAX_RATE, EDU_TAX_LEVELS, Economy } from '../../src/sim/economy';
import { IMMIGRANT_EDU_WEIGHTS, immigrantEduWeights, immigrantTaxRate } from '../../src/sim/demography';
import { validateSave } from '../../src/sim/save-format';
import { buildTown, newTownSim, runDays, townCatalog } from '../sim/fixtures';

test('impôt par éducation : économie (taux unique = tous les niveaux, taux effectif pondéré, recettes par niveau, JSON)', () => {
  const e = new Economy();
  e.reset(0);
  assert.deepEqual(e.eduTaxRates, new Array(EDU_TAX_LEVELS).fill(DEFAULT_TAX_RATE));
  assert.ok(e.eduTaxUniform());
  e.setTaxRate('residential', 0.12);
  assert.deepEqual(e.eduTaxRates, [0.12, 0.12, 0.12, 0.12, 0.12], 'le taux résidentiel règle tous les niveaux');
  e.taxBase.residential = 10_000;
  e.setResidentialEduBase([0, 1_000, 3_000, 2_000, 4_000]);
  assert.equal(e.taxRates.residential, 0.12, 'taux égaux : taux effectif exact');
  assert.equal(e.setEduTaxRate(4, 0.2), 0.2);
  assert.equal(e.setEduTaxRate(0, 0.9), 0.25, 'borné à 25 %');
  assert.ok(!e.eduTaxUniform());
  // Taux effectif = moyenne pondérée par l'assiette (0,1·0,12 + 0,3·0,12 + 0,2·0,12 + 0,4·0,2).
  assert.ok(Math.abs(e.taxRates.residential - (0.6 * 0.12 + 0.4 * 0.2)) < 1e-6, String(e.taxRates.residential));
  assert.ok(Math.abs(e.taxIncome('residential') - 10_000 * (0.072 + 0.08)) < 0.05);
  const by = e.residentialIncomeByEdu();
  assert.equal(by[0], 0, 'aucun revenu sans diplôme : aucune recette');
  assert.ok(Math.abs(by.reduce((a, v) => a + v, 0) - e.taxIncome('residential')) < 0.05, 'somme des niveaux = recette résidentielle');
  assert.ok(Math.abs(by[4]! - 10_000 * 0.4 * 0.2) < 0.05);
  // Aller-retour JSON.
  const j = JSON.parse(JSON.stringify(e.toJSON()));
  const f = new Economy(); f.fromJSON(j);
  assert.deepEqual(f.eduTaxRates, e.eduTaxRates);
  assert.equal(f.taxRates.residential, e.taxRates.residential);
  // Ancien format (taux unique) : appliqué à tous les niveaux.
  delete j.eduTaxRates; delete j.resBaseByEdu; j.taxRates.residential = 0.07;
  const g = new Economy(); g.fromJSON(j);
  assert.deepEqual(g.eduTaxRates, [0.07, 0.07, 0.07, 0.07, 0.07]);
  assert.equal(g.taxRates.residential, 0.07);
  assert.throws(() => e.setEduTaxRate(5, 0.1));
});

test('impôt par éducation : arrivants (poids d’origine si taux égaux, niveau surtaxé moins représenté)', () => {
  assert.deepEqual(immigrantEduWeights(null), [...IMMIGRANT_EDU_WEIGHTS]);
  assert.deepEqual(immigrantEduWeights([0.09, 0.09, 0.09, 0.09, 0.09]), [...IMMIGRANT_EDU_WEIGHTS]);
  const w = immigrantEduWeights([0.05, 0.05, 0.09, 0.09, 0.2]);
  assert.ok(w[4]! < IMMIGRANT_EDU_WEIGHTS[4]!, 'études supérieures surtaxées : moins d’arrivants');
  assert.ok(w[0]! > IMMIGRANT_EDU_WEIGHTS[0]!, 'sans diplôme allégé : plus d’arrivants');
  assert.equal(immigrantTaxRate(null, 0.11), 0.11);
  assert.ok(Math.abs(immigrantTaxRate([0.1, 0.1, 0.1, 0.1, 0.1], 0) - 0.1) < 1e-12);
});

test('impôt par éducation : simulation (commande, rapport, satisfaction et attractivité, sauvegarde rétrocompatible)', () => {
  const a = newTownSim(); buildTown(a);
  const b = newTownSim(); buildTown(b);
  runDays(a, 10); runDays(b, 10);
  const bad = b.runExt('setEduTaxRate', { level: 9, rate: 0.1 });
  assert.equal(bad.ok, false);
  for (const level of [2, 3, 4]) {
    const r = b.runExt('setEduTaxRate', { level, rate: 0.25 });
    assert.ok(r.ok);
    if (r.ok) assert.equal(r.data.rate, 0.25);
  }
  const rep = b.report();
  assert.deepEqual(rep.economy.eduTaxRates, [0.09, 0.09, 0.25, 0.25, 0.25]);
  assert.equal(rep.economy.eduTaxNames?.length, 5);
  assert.ok(rep.economy.taxRates.residential > 0.09 && rep.economy.taxRates.residential <= 0.25, 'taux effectif entre les taux');
  assert.ok(Math.abs(rep.economy.eduTaxIncome!.reduce((s, v) => s + v, 0) - rep.economy.forecast.income.residential) < 1, 'recettes par niveau = recette résidentielle');
  assert.ok(b.economy.forecast().income.residential > a.economy.forecast().income.residential, 'plus de recettes');
  runDays(a, 4); runDays(b, 4);
  const ha = a.demography!.report(a.clock.totalMinutes, a.economy.taxRates.residential);
  const hb = b.demography!.report(b.clock.totalMinutes, b.economy.taxRates.residential);
  assert.ok(hb.happiness < ha.happiness, `satisfaction ${hb.happiness} < ${ha.happiness}`);
  assert.ok(b.demography!.computeAttractiveness(b.economy.taxRates.residential) < a.demography!.computeAttractiveness(a.economy.taxRates.residential), 'attractivité en baisse');
  // Sauvegarde : taux par niveau conservés.
  const save = JSON.parse(JSON.stringify(b.toSave()));
  assert.equal(validateSave(save).ok, true);
  const c = new Simulation(); c.setCatalog(townCatalog());
  assert.equal(c.fromSave(save), null);
  assert.deepEqual(c.economy.eduTaxRates, [0.09, 0.09, 0.25, 0.25, 0.25]);
  assert.equal(c.economy.taxRates.residential, b.economy.taxRates.residential);
  // Ancienne sauvegarde (taux unique) : le taux s'applique à tous les niveaux.
  const old = JSON.parse(JSON.stringify(a.toSave()));
  delete old.economy.eduTaxRates; delete old.economy.resBaseByEdu;
  old.economy.taxRates.residential = 0.11;
  assert.equal(validateSave(old).ok, true);
  const o = new Simulation(); o.setCatalog(townCatalog());
  assert.equal(o.fromSave(old), null);
  assert.deepEqual(o.economy.eduTaxRates, [0.11, 0.11, 0.11, 0.11, 0.11]);
  assert.equal(o.economy.taxRates.residential, 0.11);
  // Fichier corrompu : taux par niveau hors bornes refusé.
  const broken = JSON.parse(JSON.stringify(save)); broken.economy.eduTaxRates = [0.1, 0.1, 3, 0.1, 0.1];
  assert.equal(validateSave(broken).ok, false);
});
