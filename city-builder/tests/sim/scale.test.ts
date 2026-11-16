/**
 * Passage à l'échelle (docs/SIMULATION.md, « Grandes villes ») : nivellement local des routes, recherche d'école,
 * simulation agrégée (représentants pondérés) et rétrocompatibilité des sauvegardes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../../src/sim/world';
import { AGGREGATE_THRESHOLD } from '../../src/sim/demography';
import { TrafficGraph, type ConflictCache } from '../../src/sim/traffic/network';
import { inputFromRoadNetwork } from '../../src/sim/traffic/adapters';
import { buildDistrict, buildStreet, newTownSim, runDays, townCatalog } from './fixtures';

function reliefSim(seed = 77): Simulation {
  const s = new Simulation();
  s.setCatalog(townCatalog());
  s.newGame({ seed, mapChunks: 4, startMoney: 1e9, cityName: 'Relief', terrain: { hydrology: 'aucune', rivers: 0, relief: 0.6 } });
  return s;
}

test('nivellement local des routes : hauteurs identiques au nivellement complet (rechargement)', () => {
  const s = reliefSim();
  let ok = 0;
  // Quadrillage (carrefours créés par découpe), courbes, suppressions, nouvelles traversées.
  for (let k = -3; k <= 3; k++) {
    if (s.buildRoad({ type: 'street', kind: 'street', points: [-300, k * 90, 300, k * 90] }).ok) ok++;
    if (s.buildRoad({ type: 'street', kind: 'avenue', points: [k * 90, -300, k * 90, 300] }).ok) ok++;
  }
  const curve = s.buildRoad({ type: 'street', kind: 'boulevard', points: [-320, -320, 320, 250], control: [0, 380] });
  if (curve.ok) ok++;
  assert.ok(ok >= 8, `routes construites : ${ok}`);
  const ids = s.roadRecords().edges.map((e) => e.id);
  for (let i = 0; i < ids.length; i += 7) s.removeRoad({ edgeId: ids[i]! });
  s.buildRoad({ type: 'street', kind: 'street', points: [-250, 40, 260, -30] });
  s.takeDelta();
  const live = new Float32Array(s.terrain!.heights);
  const t = new Simulation();
  t.setCatalog(townCatalog());
  assert.equal(t.fromSave(JSON.parse(JSON.stringify(s.toSave()))), null);
  const loaded = t.terrain!.heights;
  assert.equal(loaded.length, live.length);
  let diff = 0;
  for (let k = 0; k < live.length; k++) if (live[k] !== loaded[k]) diff++;
  assert.equal(diff, 0, `${diff} échantillons diffèrent du nivellement complet`);
});

test('graphe de circulation : conflits réutilisés par carrefour identiques au calcul complet', () => {
  const s = reliefSim(91);
  for (let k = -2; k <= 2; k++) {
    s.buildRoad({ type: 'street', kind: 'avenue', points: [-260, k * 100, 260, k * 100] });
    s.buildRoad({ type: 'street', kind: 'street', points: [k * 110, -260, k * 110, 260] });
  }
  const cache: ConflictCache = new Map();
  new TrafficGraph(inputFromRoadNetwork(s.net), cache);
  assert.ok(cache.size > 5);
  // Nouveau tracé (nouveaux carrefours) puis suppression : graphe avec cache = graphe recalculé entièrement.
  s.buildRoad({ type: 'street', kind: 'street', points: [-240, 50, 240, 70] });
  const ids = s.roadRecords().edges.map((e) => e.id);
  s.removeRoad({ edgeId: ids[3]! });
  const input = inputFromRoadNetwork(s.net);
  const withCache = new TrafficGraph(input, cache);
  const full = new TrafficGraph(input);
  assert.ok(full.conflicts.length > 0);
  assert.deepEqual(Array.from(withCache.conflictStart), Array.from(full.conflictStart));
  assert.deepEqual(Array.from(withCache.conflicts), Array.from(full.conflicts));
});

/* ------------------------- Simulation agrégée (représentants pondérés) ------------------------- */

interface Observed { population: number; households: number; employed: number; laborForce: number; jobsFilled: number; unemploymentRate: number; happiness: number; taxRes: number; taxCom: number; taxInd: number; taxOff: number; dR: number; dC: number; dI: number; dO: number; rows: number }

/** Ville moyenne (≈ 4 700 logements, ≈ 3 000 emplois) jouée `days` jours ; poids imposé ou simulation individuelle. */
function playCity(seed: number, weight: number, days: number): Observed {
  const s = newTownSim(5e9, seed);
  const demo = s.demography!;
  if (weight > 1) demo.forcedWeight = weight; else demo.aggregateThreshold = Infinity;
  buildDistrict(s, 6);
  buildStreet(s, 60, -220, 220, ['bureaux', 'usine', 'bureaux', 'usine', 'boutique', 'bureaux', 'usine', 'boutique', 'bureaux', 'usine']);
  buildStreet(s, 100, -220, 220, ['usine', 'bureaux', 'usine', 'bureaux', 'ecole', 'hopital', 'commissariat', 'caserne', 'parc', 'boutique']);
  buildStreet(s, 140, -220, 220, ['bureaux', 'usine', 'bureaux', 'usine', 'bureaux', 'usine', 'ecole', 'boutique', 'boutique', 'boutique']);
  runDays(s, days, 10);
  const r = s.report().demography;
  const tb = s.economy.taxBase;
  return {
    population: r.population, households: r.households, employed: r.employed, laborForce: r.laborForce, jobsFilled: r.jobsFilled,
    unemploymentRate: r.unemploymentRate, happiness: r.happiness, taxRes: tb.residential, taxCom: tb.commercial, taxInd: tb.industrial, taxOff: tb.office,
    dR: r.demand.residential, dC: r.demand.commercial, dI: r.demand.industrial, dO: r.demand.office, rows: demo.citizens.count,
  };
}

const mean = (xs: Observed[]): Observed => {
  const out = {} as Record<string, number>;
  for (const k of Object.keys(xs[0]!)) out[k] = xs.reduce((a, x) => a + (x as unknown as Record<string, number>)[k]!, 0) / xs.length;
  return out as unknown as Observed;
};

test('simulation agrégée : grandeurs observables dans les tolérances (poids 4 contre individuel, 3 graines, 30 jours)', () => {
  const seeds = [3, 17, 29];
  const ind = mean(seeds.map((g) => playCity(g, 1, 30)));
  const agg = mean(seeds.map((g) => playCity(g, 4, 30)));
  const rel = (k: keyof Observed): number => Math.abs(agg[k] - ind[k]) / Math.max(1, Math.abs(ind[k]));
  const msg = `individuel ${JSON.stringify(ind)}\nagrégé ${JSON.stringify(agg)}`;
  if (process.env.SCALE_DEBUG) console.log(msg);
  assert.ok(ind.population > 2000, msg);
  // Tolérances testées (docs/SIMULATION.md) : 6 % sur les effectifs et l'assiette résidentielle, 12 % sur les assiettes
  // des entreprises, 0,15 sur les demandes et le taux de chômage, 4 points de bonheur.
  for (const k of ['population', 'households', 'employed', 'laborForce', 'jobsFilled', 'taxRes'] as const) assert.ok(rel(k) <= 0.06, `${k} : écart ${(rel(k) * 100).toFixed(1)} %\n${msg}`);
  for (const k of ['taxCom', 'taxInd', 'taxOff'] as const) assert.ok(rel(k) <= 0.12, `${k} : écart ${(rel(k) * 100).toFixed(1)} %\n${msg}`);
  for (const k of ['dR', 'dC', 'dI', 'dO', 'unemploymentRate'] as const) assert.ok(Math.abs(agg[k] - ind[k]) <= 0.15, `${k} : ${ind[k]} -> ${agg[k]}\n${msg}`);
  assert.ok(Math.abs(agg.happiness - ind.happiness) <= 4, `bonheur\n${msg}`);
  // Le gain : environ quatre fois moins de lignes de citoyens.
  assert.ok(agg.rows < ind.rows * 0.4, `lignes ${ind.rows} -> ${agg.rows}`);
});

test('simulation agrégée : ville en croissance (4 jours, non saturée), mêmes tolérances élargies au bruit', () => {
  const seeds = [3, 17, 29, 41];
  const ind = mean(seeds.map((g) => playCity(g, 1, 4)));
  const agg = mean(seeds.map((g) => playCity(g, 4, 4)));
  const rel = (k: keyof Observed): number => Math.abs(agg[k] - ind[k]) / Math.max(1, Math.abs(ind[k]));
  const msg = `individuel ${JSON.stringify(ind)}\nagrégé ${JSON.stringify(agg)}`;
  if (process.env.SCALE_DEBUG) console.log(msg);
  for (const k of ['population', 'households', 'employed', 'laborForce', 'taxRes'] as const) assert.ok(rel(k) <= 0.1, `${k} : écart ${(rel(k) * 100).toFixed(1)} %\n${msg}`);
  for (const k of ['dR', 'dC', 'dI', 'dO', 'unemploymentRate'] as const) assert.ok(Math.abs(agg[k] - ind[k]) <= 0.15, `${k} : ${ind[k]} -> ${agg[k]}\n${msg}`);
});

test('simulation agrégée : activation au seuil, comptes pondérés, sauvegarde aller-retour et anciennes sauvegardes', () => {
  const s = newTownSim(5e9, 5);
  const demo = s.demography!;
  buildDistrict(s, 4);
  buildStreet(s, 60, -220, 220, ['bureaux', 'usine', 'bureaux', 'usine', 'boutique', 'ecole']);
  // Ville individuelle : pas de colonne de poids dans la sauvegarde (format identique à l'ancien).
  runDays(s, 3, 10);
  assert.equal(demo.aggregateInfo().aggregatedRows, 0);
  const plain = s.toSave() as unknown as { population: { citizens: Record<string, unknown>; households: Record<string, unknown> } };
  assert.equal(plain.population.citizens.weight, undefined);
  assert.equal(plain.population.households.weight, undefined);
  // Poids automatique : 1 sous le seuil ; au-delà, ≥ 1 et plafonné.
  assert.equal(demo.newHouseholdWeight(), 1);
  demo.aggregateThreshold = 1;
  assert.ok(demo.newHouseholdWeight() >= 1);
  demo.forcedWeight = 3;
  const before = demo.population;
  runDays(s, 4, 10);
  const info = demo.aggregateInfo();
  assert.ok(info.aggregatedRows > 0, JSON.stringify(info));
  assert.ok(info.population > info.rows, JSON.stringify(info));
  assert.ok(demo.population > before);
  // Comptes d'occupation = somme des poids (aucune double source de vérité).
  let res = 0, wk = 0;
  for (let i = 0; i < s.buildings.count; i++) { res += s.buildings.residents[i]!; wk += s.buildings.workers[i]!; }
  assert.equal(res, demo.population);
  let emp = 0;
  for (let i = 0; i < demo.citizens.count; i++) if (demo.citizens.col.job[i]! >= 0) emp += demo.weightOf(i);
  assert.equal(wk, emp);
  // Aller-retour : même population et mêmes ménages, puis même suite (déterminisme).
  const save = JSON.parse(JSON.stringify(s.toSave()));
  assert.ok(Array.isArray(save.population.citizens.weight));
  const t = new Simulation();
  t.setCatalog(townCatalog());
  assert.equal(t.fromSave(save), null);
  t.demography!.forcedWeight = 3;
  t.demography!.aggregateThreshold = 1;
  assert.equal(t.demography!.population, demo.population);
  assert.equal(t.demography!.householdCount, demo.householdCount);
  runDays(s, 2, 10); runDays(t, 2, 10);
  assert.equal(t.demography!.population, demo.population);
  // Ancienne sauvegarde (sans colonne de poids) : chargée, poids 1 partout.
  delete save.population.citizens.weight; delete save.population.households.weight;
  const u = new Simulation();
  u.setCatalog(townCatalog());
  assert.equal(u.fromSave(save), null);
  assert.equal(u.demography!.population, u.demography!.citizens.count);
  assert.equal(u.demography!.aggregateThreshold, AGGREGATE_THRESHOLD);
});
