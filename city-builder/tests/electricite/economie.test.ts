/**
 * Électricité — économie et raccordement : montants versés à la trésorerie en CHF (centimes / 100, comme le panneau
 * Énergie), rattachement des bâtiments à une installation ALIMENTÉE plutôt qu'à un poste isolé plus proche.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { centsToChf } from '../../src/shared/power/model';
import { advanceHours, placeFacilities, powerTown } from './fixtures';

/** Somme d'un poste du grand livre (mois clos + mois en cours). */
function ledgerTotal(lines: { category: string; amount: number }[], category: string): number {
  return lines.filter((l) => l.category === category).reduce((s, l) => s + l.amount, 0);
}

test('unités : vente d\'électricité et entretien du réseau versés en CHF (= affichage du panneau, centimes / 100)', () => {
  const { sim, elec } = powerTown({ days: 1 });
  placeFacilities(sim, 160, -100, 100, ['centrale_gaz']);
  advanceHours(sim, 24 * 31, 30);
  const b = elec.system.budget();
  assert.ok(b.lastIncome > 0 && b.lastExpense > 0, `mois clos : recettes ${b.lastIncome} ¢, dépenses ${b.lastExpense} ¢`);
  const m = elec.municipal()!;
  const lines = [...m.budget.history.flatMap((h) => h.lines), ...m.budget.currentLines()];
  const sale = ledgerTotal(lines, 'vente:electricite');
  const upkeep = ledgerTotal(lines, 'entretien:reseau_electrique');
  assert.ok(Math.abs(sale - centsToChf(b.lastIncome)) < 0.011, `vente au grand livre ${sale} CHF = panneau ${b.lastIncome / 100} CHF`);
  assert.ok(Math.abs(upkeep - centsToChf(b.lastExpense)) < 0.011, `entretien au grand livre ${upkeep} CHF = panneau ${b.lastExpense / 100} CHF`);
  // Ordre de grandeur : une seule centrale pour un bourg ne rapporte pas des centaines de milliers de CHF par mois.
  assert.ok(sale < 20_000, `vente mensuelle plausible (${sale} CHF)`);
  // Entretien des installations du catalogue : exprimé en centimes comme les autres champs du panneau.
  assert.equal(b.facilitiesUpkeep, 4_000 * 100);
});

test('raccordement : un poste isolé plus proche ne coupe pas un logement qu\'une centrale reliée dessert', () => {
  const { sim, elec } = powerTown({ days: 1 });
  // Centrale reliée au bourg par la route (même réseau de distribution).
  placeFacilities(sim, 160, -100, 100, ['centrale_gaz']);
  // Poste sur une rue isolée au sud, à ~60 m des premières maisons : aucune centrale ne l'alimente.
  const [poste] = placeFacilities(sim, -60, -220, -150, ['poste'], false);
  advanceHours(sim, 3);
  const house = sim.buildings.id[[...Array(sim.buildings.count).keys()].find((i) => sim.catalog!.assets[sim.buildings.assetIndex[i]!]!.id === 'maison')!]!;
  const bi = sim.buildings.indexOf(house), pi = sim.buildings.indexOf(poste!);
  const d = Math.hypot(sim.buildings.x[bi]! - sim.buildings.x[pi]!, sim.buildings.z[bi]! - sim.buildings.z[pi]!);
  assert.ok(d <= 80, `scénario : poste isolé à portée locale de la maison (${d.toFixed(0)} m)`);
  assert.equal(elec.system.powerFactor(house), 1, 'maison alimentée par la centrale reliée');
  const s = elec.system.summary()!;
  assert.equal(s.cut, 0, `aucun bâtiment coupé (${s.cut})`);
});
