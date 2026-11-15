/**
 * Services qui comptent (docs/SERVICES.md) : criminalité (chômage, pauvreté, densité, police), incendies (départ,
 * pompiers, dégâts, ruine, reconstruction, propagation), santé (pollution, âge, soins, maladies), période de grâce,
 * rapport et fiche du bâtiment, alertes, sauvegarde exacte et ANCIENNE sauvegarde chargée avec des valeurs sensées.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../../src/sim/world';
import { validateSave } from '../../src/sim/save-format';
import type { DemographyReport } from '../../src/sim/demography';
import { Activity } from '../../src/sim/population';
import {
  CrimeKind, DEFAULT_SERVICES_TUNING, crimeOwn, crimeTarget, fireResponseHours, fireRisk, hash01, healthTarget, sicknessChance,
} from '../../src/sim/services/tuning';
import { buildStreet, buildTown, newTownSim, runDays, townCatalog } from '../sim/fixtures';

const report = (s: Simulation): DemographyReport => s.demography!.report(s.clock.totalMinutes, s.economy.taxRates.residential);
const cmd = (s: Simulation, name: string, payload?: unknown): { ok: boolean; data?: any; error?: any } => {
  const r = s.plugins.command('services', name, payload) as any;
  return r.ok ? { ok: true, data: r.data?.data ?? r.data } : { ok: false, error: r.error ?? r };
};
const reload = (s: Simulation, mutate?: (save: any) => void): Simulation => {
  const save = JSON.parse(JSON.stringify(s.toSave()));
  mutate?.(save);
  const c = new Simulation(); c.setCatalog(townCatalog());
  assert.equal(c.fromSave(save), null);
  return c;
};
const hours = (s: Simulation, h: number): void => { for (let i = 0; i < h * 6; i++) s.tick(10); };

/** Quartier sans emploi ni service : maisons et immeubles le long de deux rues. */
function jobless(s: Simulation): number[] {
  return [
    ...buildStreet(s, 0, -220, 220, ['immeuble', 'immeuble', 'immeuble', 'maison', 'maison', 'maison', 'maison', 'maison', 'maison']),
    ...buildStreet(s, 80, -220, 220, ['immeuble', 'immeuble', 'maison', 'maison', 'maison', 'maison']),
  ];
}

/* ------------------------------ Formules ------------------------------ */

test('formules : criminalité, risque d\'incendie, délai des pompiers, santé, maladie, tirage déterministe', () => {
  const t = { ...DEFAULT_SERVICES_TUNING };
  // Chômage, pauvreté et densité font monter la criminalité ; la police et le début de partie la font baisser.
  assert.ok(crimeOwn(t, CrimeKind.Housing, 1, 0.5, 0) > crimeOwn(t, CrimeKind.Housing, 1, 0, 0));
  assert.ok(crimeOwn(t, CrimeKind.Housing, 1, 0, 0.5) > crimeOwn(t, CrimeKind.Housing, 1, 0, 0));
  assert.ok(crimeOwn(t, CrimeKind.Housing, 3, 0, 0) > crimeOwn(t, CrimeKind.Housing, 1, 0, 0));
  assert.equal(crimeOwn(t, CrimeKind.None, 3, 1, 1), 0);
  const own = crimeOwn(t, CrimeKind.Housing, 2, 0.4, 0.3);
  assert.ok(crimeTarget(t, own, own, 1, 1) < crimeTarget(t, own, own, 0, 1) * 0.3, 'commissariat proche : −75 %');
  assert.equal(crimeTarget(t, own, own, 0, 0), 0, 'période de grâce : aucune criminalité');
  // Incendie : industrie > logement, âge, prévention de la caserne ; délai plus court près de la caserne.
  assert.ok(fireRisk(t, 2.2, 1, 0, 0) > fireRisk(t, 1, 1, 0, 0));
  assert.ok(fireRisk(t, 1, 1, 30, 0) > fireRisk(t, 1, 1, 0, 0));
  assert.ok(fireRisk(t, 1, 1, 0, 1) < fireRisk(t, 1, 1, 0, 0) * 0.5);
  assert.ok(fireResponseHours(t, 1) < fireResponseHours(t, 0.5));
  // Santé : pollution et âge la dégradent, les soins l'améliorent ; maladie plus probable en mauvaise santé et chez les aînés.
  assert.ok(healthTarget(t, 3, 40, 0) < healthTarget(t, 0, 40, 0));
  assert.ok(healthTarget(t, 0, 70, 0) < healthTarget(t, 0, 35, 0));
  assert.ok(healthTarget(t, 0, 40, 1) > healthTarget(t, 0, 40, 0) + 20);
  assert.ok(sicknessChance(t, 40, 30, 1) > sicknessChance(t, 90, 30, 1));
  assert.ok(sicknessChance(t, 80, 75, 1) > sicknessChance(t, 80, 30, 1));
  assert.equal(sicknessChance(t, 10, 80, 0), 0, 'aucune maladie pendant la grâce');
  for (let i = 0; i < 200; i++) { const v = hash01(i, 7, 3); assert.ok(v >= 0 && v < 1); }
  assert.equal(hash01(12, 34, 5), hash01(12, 34, 5));
});

/* ------------------------------ Grâce ------------------------------ */

test('période de grâce : ni délit, ni incendie, ni maladie le premier mois, même sans aucun service', () => {
  const s = newTownSim(); jobless(s);
  runDays(s, 29, 10);
  const r = report(s).cityServices!;
  assert.ok(report(s).population > 50);
  assert.equal(r.pressure, 0);
  assert.equal(r.crime.average, 0);
  assert.deepEqual([r.month.fires, r.lastMonth.fires, r.month.incidents, r.month.sickCases, r.health.sick], [0, 0, 0, 0, 0]);
  assert.equal(s.notices.filter((n) => /Incendie|Délits/.test(n.message)).length, 0);
});

/* ------------------------------ Criminalité ------------------------------ */

test('criminalité : monte avec le chômage sans police, baisse sous un commissariat ; effets sur satisfaction et foncier', () => {
  const s = newTownSim(); const ids = jobless(s);
  runDays(s, 75, 10);
  const r1 = report(s);
  const c1 = r1.cityServices!.crime.average;
  assert.ok(r1.unemploymentRate > 0.5, `chômage ${r1.unemploymentRate}`);
  assert.ok(c1 > 20, `criminalité sans police ni emploi : ${c1}`);
  assert.ok(r1.cityServices!.month.incidents + r1.cityServices!.lastMonth.incidents > 0, 'délits comptés');
  const police1 = r1.satisfactionFactors.find((f) => f.key === 'police')!.delta;
  const card = s.demography!.inspectBuilding(ids[0]!, s.clock.totalMinutes)!;
  assert.ok(card.safety && card.safety.crime > 15 && card.safety.police === 0, JSON.stringify(card.safety));
  const land1 = card.economy!.landValue;
  // Commissariat au centre du quartier.
  const pol = s.placeBuilding({ assetId: 'commissariat', x: 0, z: 18, rot: 0 });
  assert.ok(pol.ok && !pol.data.noRoadAccess);
  runDays(s, 30, 10);
  const r2 = report(s);
  const c2 = r2.cityServices!.crime.average;
  assert.ok(c2 < c1 * 0.6, `criminalité ${c1} -> ${c2} sous la police`);
  assert.ok(r2.satisfactionFactors.find((f) => f.key === 'police')!.delta > police1, 'satisfaction « Police » améliorée');
  const card2 = s.demography!.inspectBuilding(ids[0]!, s.clock.totalMinutes)!;
  assert.ok(card2.safety!.police > 0);
  assert.ok(card2.economy!.landValue > land1, `valeur foncière ${land1} -> ${card2.economy!.landValue}`);
});

/* ------------------------------ Incendies ------------------------------ */

test('incendie sans caserne : bâtiment détruit, habitants évacués, ruine signalée, reconstruction payante', () => {
  const s = newTownSim(); const ids = jobless(s);
  runDays(s, 61, 10); // pleine pression
  const id = ids[0]!;
  const bi = s.buildings.indexOf(id);
  assert.ok(s.buildings.residents[bi]! > 0);
  const f = cmd(s, 'incendie', { buildingId: id });
  assert.ok(f.ok, JSON.stringify(f.error));
  assert.equal(f.data.state, 'feu');
  assert.ok(s.notices.some((n) => /Incendie.*aucune caserne/.test(n.message)), 'départ de feu notifié');
  hours(s, 2);
  const al = s.plugins.command('alertes', 'state', undefined) as any;
  const items: number[] = (al.data?.data ?? al.data).items;
  let mask = 0;
  for (let k = 0; k + 4 < items.length; k += 5) if (items[k] === id) mask = items[k + 1]!;
  assert.ok(mask & 32, 'icône « en feu »');
  hours(s, 12);
  const card = s.demography!.inspectBuilding(id, s.clock.totalMinutes)!;
  assert.equal(card.safety!.state, 'ruine');
  assert.equal(card.residents, 0, 'habitants évacués');
  assert.ok(s.notices.some((n) => /détruit par le feu/.test(n.message)));
  assert.equal(s.demography!.services.isRuined(id), true);
  runDays(s, 2, 10);
  assert.equal(s.buildings.residents[s.buildings.indexOf(id)], 0, 'une ruine n’accueille personne');
  // Reconstruction (bâtiment du joueur) : coût payé, logement de nouveau habitable.
  const cost = card.safety!.rebuildCost!;
  assert.ok(cost > 0);
  const m0 = s.economy.money;
  assert.ok(cmd(s, 'reconstruire', { buildingId: id }).ok);
  assert.equal(Math.round(m0 - s.economy.money), cost);
  assert.equal(s.demography!.services.isRuined(id), false);
  runDays(s, 3, 10);
  assert.ok(s.buildings.residents[s.buildings.indexOf(id)]! > 0, 'de nouveau habité');
  assert.equal(cmd(s, 'reconstruire', { buildingId: id }).ok, false, 'pas une ruine');
});

test('incendie sous une caserne : pompiers dépêchés, feu maîtrisé sans ruine', () => {
  const s = newTownSim(); buildTown(s); // la ville de test a sa caserne
  runDays(s, 61, 10);
  let target = -1;
  for (let i = 0; i < s.buildings.count; i++) if (s.buildings.residents[i]! > 0) { target = s.buildings.id[i]!; break; }
  const f = cmd(s, 'incendie', { buildingId: target });
  assert.ok(f.ok && f.data.fire > 0, 'bâtiment couvert par la caserne');
  assert.ok(s.notices.some((n) => /pompiers en route/.test(n.message)));
  hours(s, 6);
  const card = s.demography!.inspectBuilding(target, s.clock.totalMinutes)!;
  assert.notEqual(card.safety!.state, 'ruine');
  assert.notEqual(card.safety!.state, 'feu');
  assert.ok(s.notices.some((n) => /Incendie maîtrisé/.test(n.message)));
  assert.equal(report(s).cityServices!.month.destroyed, 0);
});

/* ------------------------------ Santé ------------------------------ */

test('santé : malades après la grâce, ils restent chez eux ; les soins réduisent la part de malades', () => {
  const sick = (s: Simulation): number => { const c = s.demography!.citizens; let n = 0; for (let i = 0; i < c.count; i++) if (c.col.sick[i]! > 0) n++; return n / Math.max(1, c.count); };
  const a = newTownSim(); jobless(a);
  const b = newTownSim(); jobless(b);
  const hop = b.placeBuilding({ assetId: 'hopital', x: 0, z: 22, rot: 0 });
  assert.ok(hop.ok && !hop.data.noRoadAccess);
  runDays(a, 120, 10); runDays(b, 120, 10);
  const ra = report(a).cityServices!, rb = report(b).cityServices!;
  assert.ok(ra.month.sickCases + ra.lastMonth.sickCases > 0, 'des habitants tombent malades');
  assert.ok(rb.health.average > ra.health.average + 15, `santé ${ra.health.average} sans soins, ${rb.health.average} avec`);
  assert.ok(rb.health.uncoveredResidents === 0 && ra.health.uncoveredResidents > 0);
  assert.ok(sick(b) <= sick(a), `malades ${sick(a)} sans soins, ${sick(b)} avec`);
  // Un malade ne part ni au travail ni à l'école.
  const d = a.demography!, c = d.citizens.col;
  for (let i = 0; i < d.citizens.count; i++) if (c.sick[i]! > 0) { assert.equal(d.activityAt(i, 10 * 60, false), Activity.Home); break; }
});

/* ------------------------------ Rapport, cartes ------------------------------ */

test('rapport et carte : synthèse complète, carte d\'information par cellule à la demande', () => {
  const s = newTownSim(); buildTown(s);
  runDays(s, 2, 10);
  const r = report(s).cityServices!;
  assert.deepEqual(r.stations.map((x) => x.service), ['police', 'pompiers', 'sante']);
  assert.ok(r.stations.every((x) => x.count === 1 && x.upkeep > 0));
  assert.ok(r.coverage.police > 0.9 && r.coverage.fire > 0.9 && r.coverage.health > 0.9);
  assert.equal(s.takeDelta().ext?.services, undefined, 'aucune carte envoyée tant qu’elle n’est pas affichée');
  const l = cmd(s, 'calque', { on: true });
  assert.ok(l.ok && l.data.cols > 0 && l.data.crime.length === l.data.cols * l.data.rows);
  assert.ok([...l.data.coverFire].some((v: number) => v === 1));
  assert.ok([...l.data.health].some((v: number) => v !== 255 && v > 50), 'santé des logements');
  runDays(s, 1, 10);
  assert.ok(s.takeDelta().ext?.services, 'carte mise à jour chaque jour quand elle est affichée');
  assert.ok(cmd(s, 'calque', { on: false }).ok);
});

/* ------------------------------ Sauvegarde ------------------------------ */

test('sauvegarde : feu en cours, ruine et criminalité restitués ; la partie rechargée se poursuit à l\'identique', () => {
  const s = newTownSim(); const ids = jobless(s);
  runDays(s, 62, 10);
  assert.ok(cmd(s, 'incendie', { buildingId: ids[1]! }).ok);
  assert.ok(cmd(s, 'incendie', { buildingId: ids[5]! }).ok);
  hours(s, 9); // ids[5] (maison) détruite ; l'immeuble ids[1] brûle encore (bâtiment plus grand)
  const sv = s.demography!.services;
  const c = reload(s);
  const cv = c.demography!.services;
  for (const id of ids) {
    assert.equal(cv.isBurning(id), sv.isBurning(id));
    assert.equal(cv.isRuined(id), sv.isRuined(id));
    assert.equal(cv.crimeOf(id), sv.crimeOf(id));
  }
  assert.ok(sv.ruinCount + sv.burningCount > 0);
  runDays(s, 5, 10); runDays(c, 5, 10);
  assert.equal(c.demography!.population, s.demography!.population);
  assert.deepEqual(report(c).cityServices!.month, report(s).cityServices!.month);
  for (const id of ids) assert.equal(cv.crimeOf(id), sv.crimeOf(id));
});

test('ancienne sauvegarde (sans services) : chargée, valeurs par défaut sensées, montée progressive après chargement', () => {
  const s = newTownSim(); jobless(s);
  runDays(s, 80, 10);
  const strip = (save: any): void => { delete save.population.citizens.sick; delete save.population.services; };
  const save = JSON.parse(JSON.stringify(s.toSave()));
  strip(save);
  const v = validateSave(save);
  assert.ok(v.ok, v.ok ? '' : v.message);
  const c = reload(s, strip);
  const d = c.demography!;
  assert.equal(d.population, s.demography!.population, 'population conservée');
  for (let i = 0; i < d.citizens.count; i++) assert.equal(d.citizens.col.sick[i], 0, 'personne n’est malade');
  const r0 = report(c).cityServices!;
  assert.equal(r0.crime.average, 0, 'criminalité repartie de zéro');
  assert.equal(r0.fire.burning + r0.fire.ruins, 0);
  assert.equal(r0.pressure, 0, 'montée propre à partir du chargement (la ville n’avait aucun service)');
  runDays(c, 10, 10); runDays(s, 10, 10);
  const r1 = report(c).cityServices!;
  assert.ok(r1.pressure > 0 && r1.pressure < 0.5, `pression ${r1.pressure}`);
  assert.ok(r1.crime.average > 0, 'la criminalité réapparaît progressivement');
  assert.ok(r1.crime.average < report(s).cityServices!.crime.average, 'plus faible que dans la partie qui avait déjà les services');
  assert.ok(report(c).population >= s.demography!.population * 0.9, `la partie continue normalement (${report(c).population} / ${s.demography!.population})`);
});
