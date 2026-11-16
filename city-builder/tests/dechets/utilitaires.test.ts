/**
 * Déchets sans « raccordement » (16/11, retour joueur) : les ouvrages techniques sans occupants (éoliennes, postes,
 * pompes…) ne produisent pas de déchets et ne portent plus l'icône « bacs pleins » ; sans aucun dépôt de
 * camions-bennes, une alerte globale claire « Aucune collecte des déchets » (pas d'icône sur chaque bâtiment).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../../src/sim/world';
import { createDechetsPlugin } from '../../src/sim/plugins/dechets';
import { createMunicipalPlugin } from '../../src/sim/municipal';
import { createAlertesPlugin } from '../../src/sim/plugins/alertes';
import { isUnstaffedUtility } from '../../src/shared/utility-buildings';
import { ALERT_BITS, type AlertesPayload } from '../../src/shared/protocol-ext/alertes';
import type { CatalogAsset } from '../../src/shared/catalog';
import { collectProblems } from '../../src/ui/problems';
import { buildStreet, buildTown, runDays } from '../sim/fixtures';
import { buildWasteZone, wasteCatalog } from './fixtures';

function utilitySim(): { sim: Simulation; dechets: ReturnType<typeof createDechetsPlugin> } {
  const c = wasteCatalog();
  const house = c.assets.find((a) => a.id === 'maison')!;
  // Éolienne de test : 2 agents d'entretien, étiquette de service technique (comme `elec_eolienne` du catalogue).
  c.assets.push({ ...house, id: 't_eolienne', nameFr: 'Éolienne', category: 'industrial', capacity: { residents: 0, jobs: 2 }, tags: ['electricite', 'service:electricite'] });
  const dechets = createDechetsPlugin();
  const sim = new Simulation([createMunicipalPlugin(), dechets, createAlertesPlugin()]);
  sim.setCatalog(c);
  sim.newGame({ seed: 1234, mapChunks: 4, startMoney: 80_000_000, cityName: 'Bourg-Utilitaires', terrain: { hydrology: 'aucune', rivers: 0 } });
  return { sim, dechets };
}

const alerts = (sim: Simulation): AlertesPayload => (sim.plugins.command('alertes', 'state', undefined) as { data: { data: AlertesPayload } }).data.data;

test('ouvrage technique sans occupants : reconnu (éolienne, poste, pompe…) ; immeubles, usines et dépôts occupés exclus', () => {
  const a = (jobs: number, residents: number, tags: string[]): Pick<CatalogAsset, 'tags' | 'capacity'> => ({ capacity: { residents, jobs }, tags });
  assert.equal(isUnstaffedUtility(a(2, 0, ['service:electricite'])), true, 'éolienne');
  assert.equal(isUnstaffedUtility(a(6, 0, ['service:eau'])), true, 'station de pompage');
  assert.equal(isUnstaffedUtility(a(0, 0, ['decor'])), true, 'sans capacité');
  assert.equal(isUnstaffedUtility(a(60, 0, ['service:electricite'])), false, 'centrale thermique (60 emplois)');
  assert.equal(isUnstaffedUtility(a(24, 0, ['service:dechets'])), false, 'dépôt de camions');
  assert.equal(isUnstaffedUtility(a(4, 0, ['commerce'])), false, 'petit commerce');
  assert.equal(isUnstaffedUtility(a(0, 4, [])), false, 'logement');
});

test('éoliennes : aucun déchet produit, aucune icône « bacs pleins », bac hérité d’une ancienne partie retiré', () => {
  const { sim, dechets } = utilitySim();
  buildTown(sim);
  buildWasteZone(sim);
  const [eol] = buildStreet(sim, 230, -100, 100, ['t_eolienne']);
  // Ancienne partie : l'éolienne avait un bac plein (cause des icônes au-dessus de chaque éolienne).
  dechets.waste.bins.set(eol!, { rec: 20, res: 40, cap: 30, over: 30 });
  runDays(sim, 3);
  assert.equal(dechets.waste.bins.has(eol!), false, 'bac de l’éolienne retiré');
  assert.ok(dechets.waste.bins.size > 0, 'les logements produisent toujours');
  const p = alerts(sim);
  const k = p.items.findIndex((v, i) => i % 5 === 0 && v === eol);
  assert.ok(k < 0 || (p.items[k + 1]! & ALERT_BITS.waste) === 0, 'pas d’icône déchets sur l’éolienne');
});

test('aucun dépôt de camions-bennes : alerte globale « Aucune collecte des déchets », sans icône par bâtiment', () => {
  const { sim } = utilitySim();
  buildTown(sim);
  runDays(sim, 8);
  const p = alerts(sim);
  assert.equal(p.counts.waste, 0, 'pas d’icône sur chaque bâtiment');
  assert.ok((p.noCollection ?? 0) > 0, `bâtiments aux bacs pleins sans collecte : ${p.noCollection}`);
  const probs = collectProblems(p.counts, null, null, false, p.noCollection);
  const pr = probs.find((x) => x.id === 'collecte');
  assert.ok(pr && /Aucune collecte des déchets/.test(pr.text) && /dépôt de camions-bennes/.test(pr.text), pr?.text);
  // Dépôt et décharge construits : l'alerte globale disparaît (collecte en service).
  buildWasteZone(sim);
  runDays(sim, 1);
  assert.equal(alerts(sim).noCollection, undefined);
});
