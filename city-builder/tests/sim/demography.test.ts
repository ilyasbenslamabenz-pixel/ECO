/** Démographie : migrations, emploi, scolarité, naissances, décès, émigration, emploi du temps, LOD. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MINUTES_PER_DAY, MINUTES_PER_YEAR } from '../../src/sim/clock';
import { Activity, Education, Role, SimLod } from '../../src/sim/population';
import { annualMortality, LOD_DETAILED_M } from '../../src/sim/demography';
import { FIRST_NAMES_F, FIRST_NAMES_M, SURNAMES } from '../../src/sim/names';
import type { Simulation } from '../../src/sim/world';
import { buildDistrict, buildStreet, buildTown, newTownSim, runDays } from './fixtures';

/** Vérifie que les compteurs incrémentaux d'occupation égalent un recomptage complet. */
function assertConsistent(s: Simulation): void {
  const d = s.demography!;
  const b = s.buildings;
  const res = new Map<number, number>(), wrk = new Map<number, number>();
  const c = d.citizens.col;
  for (let i = 0; i < d.citizens.count; i++) {
    res.set(c.home[i]!, (res.get(c.home[i]!) ?? 0) + 1);
    if (c.job[i]! >= 0) wrk.set(c.job[i]!, (wrk.get(c.job[i]!) ?? 0) + 1);
  }
  for (let i = 0; i < b.count; i++) {
    const a = s.catalog!.assets[b.assetIndex[i]!]!;
    assert.equal(b.residents[i], res.get(b.id[i]!) ?? 0, `habitants du bâtiment ${b.id[i]}`);
    assert.equal(b.workers[i], wrk.get(b.id[i]!) ?? 0, `employés du bâtiment ${b.id[i]}`);
    assert.ok(b.residents[i]! <= a.capacity.residents, 'capacité de logement respectée');
    assert.ok(b.workers[i]! <= a.capacity.jobs, 'capacité d\'emploi respectée');
  }
  let members = 0;
  for (let k = 0; k < d.households.count; k++) members += d.households.col.size[k]!;
  assert.equal(members, d.citizens.count, 'taille des ménages = nombre de citoyens');
}

test('migration : pas d\'habitant sans route ; emménagements dès qu\'une route dessert les logements', () => {
  const s = newTownSim();
  for (let k = 0; k < 4; k++) assert.ok(s.placeBuilding({ assetId: 'maison', x: -100 + k * 24, z: -16, rot: 0 }).ok);
  runDays(s, 3);
  assert.equal(s.demography!.population, 0, 'aucun logement desservi');
  assert.ok(s.buildRoad({ type: 'street', points: [-140, 0, 40, 0] }).ok);
  for (let i = 0; i < s.buildings.count; i++) assert.equal(s.buildings.roadAccess[i], 1, 'accès route recalculé après la pose de la route');
  runDays(s, 4);
  const pop = s.demography!.population;
  assert.ok(pop > 0 && pop <= 20, `population ${pop}`);
  assert.equal(s.getStats().population, pop);
  assertConsistent(s);
});

test('ville complète : remplissage, emplois, scolarité, cohérence des compteurs, revenus', () => {
  const s = newTownSim();
  buildTown(s);
  runDays(s, 20);
  const r = s.report().demography;
  assert.ok(r.population > 200, `population ${r.population}`);
  assert.ok(r.housingFree < r.housingCapacity * 0.1, 'logements presque tous occupés');
  assert.ok(r.employed > 0 && r.employed <= r.jobsTotal);
  assert.ok(r.pupils > 0, 'enfants scolarisés (école présente)');
  assert.ok(r.averageIncome > 1000);
  assert.ok(Object.values(r.services).every((v) => v > 0.9), 'tous les services couvrent la ville');
  assertConsistent(s);
  // Chaque citoyen a un nom français tiré des tables.
  const info = s.runExt('inspectBuilding', { buildingId: s.buildings.id[0]! });
  assert.ok(info.ok);
  const occ = info.ok ? info.data.occupants : [];
  assert.ok(occ.length > 0);
  for (const o of occ) {
    const [first, ...rest] = o.name.split(' ');
    assert.ok(FIRST_NAMES_F.includes(first!) || FIRST_NAMES_M.includes(first!), o.name);
    assert.ok(SURNAMES.includes(rest.join(' ')), o.name);
  }
});

test('recherche d\'emploi : le plus proche d\'abord ; bureaux réservés aux bacheliers quand un autre emploi existe', () => {
  const s = newTownSim();
  buildStreet(s, 0, -220, 220, ['immeuble', 'boutique']);
  buildStreet(s, -120, -220, 220, ['maison', 'maison', 'maison', 'maison', 'maison', 'maison', 'maison', 'maison', 'maison', 'maison', 'boutique']);
  // Les citoyens de l'immeuble (x≈-200) : la boutique voisine (x≈-170) est plus proche que celle du bout de l'autre rue.
  s.runExt('settle', { waves: 30 });
  const d = s.demography!;
  const c = d.citizens.col;
  const nearShop = s.buildings.id[1]!;
  let nearCount = 0;
  for (let i = 0; i < d.citizens.count; i++) {
    if (c.home[i] === s.buildings.id[0]! && c.job[i]! >= 0) {
      if (c.job[i] === nearShop) nearCount++;
      else assert.equal(s.buildings.workers[s.buildings.indexOf(nearShop)], 20, 'ne va plus loin que si la boutique voisine est pleine');
    }
  }
  assert.ok(nearCount > 0);

  const s2 = newTownSim();
  buildStreet(s2, 0, -220, 220, ['immeuble', 'bureaux', 'usine', 'usine']);
  s2.runExt('settle', { waves: 30 });
  const d2 = s2.demography!;
  const office = s2.buildings.id[1]!;
  let inOffice = 0;
  for (let i = 0; i < d2.citizens.count; i++) {
    if (d2.citizens.col.job[i] === office) { inOffice++; assert.ok(d2.citizens.col.education[i]! >= Education.Baccalaureate, 'employé de bureau bachelier'); }
  }
  assert.ok(inOffice > 0);
  assertConsistent(s2);
});

test('mortalité : croissante avec l\'âge ; décès effectifs d\'une population très âgée', () => {
  assert.ok(annualMortality(30) < annualMortality(60));
  assert.ok(annualMortality(60) < annualMortality(90));
  assert.ok(annualMortality(80) > 0.03 && annualMortality(80) < 0.08, `80 ans : ${annualMortality(80)}`);
  const s = newTownSim();
  buildDistrict(s, 1);
  s.runExt('settle', { waves: 40 });
  const d = s.demography!;
  const n0 = d.population;
  const now = s.clock.totalMinutes;
  for (let i = 0; i < d.citizens.count; i++) d.citizens.col.birth[i] = Math.floor(now - 97 * MINUTES_PER_YEAR);
  for (let day = 0; day < 360; day++) { s.clock.totalMinutes += MINUTES_PER_DAY; d.daily(s.clock.totalMinutes, 0.09); }
  const dead = d.month.deaths;
  assert.ok(dead > n0 * 0.15 && dead < n0 * 0.6, `décès ${dead} sur ${n0}`);
  assert.equal(d.population, n0 - dead);
  assertConsistent(s);
});

test('vieillissement, retraite, naissances dans les logements qui ont de la place', () => {
  const s = newTownSim();
  buildDistrict(s, 2);
  buildStreet(s, 40, -220, 220, ['ecole', 'hopital', 'boutique', 'boutique', 'usine', 'usine', 'bureaux']);
  s.runExt('settle', { waves: 3 }); // remplissage partiel : il reste de la place pour les naissances
  const d = s.demography!;
  const c = d.citizens.col;
  assert.ok(d.report(s.clock.totalMinutes, 0.09).housingFree > 200);
  // Un actif proche de la retraite.
  let worker = -1;
  for (let i = 0; i < d.citizens.count; i++) if (c.job[i]! >= 0) { worker = c.id[i]!; c.birth[i] = Math.floor(s.clock.totalMinutes - 63.5 * MINUTES_PER_YEAR); break; }
  assert.ok(worker > 0);
  const ages0 = new Map<number, number>();
  for (let i = 0; i < d.citizens.count; i++) ages0.set(c.id[i]!, d.ageOf(i, s.clock.totalMinutes));
  let births = 0;
  for (let day = 0; day < 3 * 360; day++) {
    s.clock.totalMinutes += MINUTES_PER_DAY;
    d.daily(s.clock.totalMinutes, 0.09);
    births += d.month.births; d.month.births = 0;
  }
  assert.ok(births > 0, 'au moins une naissance en 3 ans');
  for (let i = 0; i < d.citizens.count; i++) {
    const id = c.id[i]!;
    const a0 = ages0.get(id);
    if (a0 !== undefined) assert.ok(Math.abs(d.ageOf(i, s.clock.totalMinutes) - a0 - 3) < 1e-6, 'trois ans de plus');
    else { assert.equal(c.role[i], Role.Child); assert.ok(d.ageOf(i, s.clock.totalMinutes) < 3); }
  }
  const wi = d.citizens.indexOf(worker);
  if (wi >= 0) { assert.equal(c.job[wi], -1, 'retraité : emploi libéré'); assert.ok(c.income[wi]! > 0, 'pension versée'); }
  assertConsistent(s);
});

test('émigration : sans route ni services, les ménages mécontents quittent la ville en quelques mois', () => {
  const s = newTownSim();
  const r = s.buildRoad({ type: 'street', points: [-220, 0, 220, 0] });
  assert.ok(r.ok);
  for (let k = 0; k < 6; k++) assert.ok(s.placeBuilding({ assetId: 'maison', x: -200 + k * 24, z: -16, rot: 0 }).ok);
  assert.ok(s.placeBuilding({ assetId: 'boutique', x: 100, z: -16, rot: 0 }).ok);
  s.runExt('settle', { waves: 20 });
  const pop0 = s.demography!.population;
  assert.ok(pop0 > 10);
  assert.ok(s.removeRoad({ edgeId: r.ok ? r.data.edgeIds[0]! : -1 }).ok);
  for (let i = 0; i < s.buildings.count; i++) assert.equal(s.buildings.roadAccess[i], 0);
  runDays(s, 150);
  const rep = s.report().demography;
  assert.ok(rep.population < pop0 * 0.2, `population ${rep.population} (départ ${pop0})`);
  assert.ok(s.economy.history.some(() => true));
  assertConsistent(s);
});

test('démolition : habitants relogés ailleurs si possible, employés licenciés', () => {
  const s = newTownSim();
  const ids = buildStreet(s, 0, -220, 220, ['maison', 'maison', 'boutique', 'immeuble']);
  s.runExt('settle', { waves: 2 });
  const d = s.demography!;
  const house = ids[0]!;
  const shop = ids[2]!;
  const inHouse = s.buildings.residents[s.buildings.indexOf(house)]!;
  const pop0 = d.population;
  assert.ok(inHouse > 0);
  assert.ok(s.demolish({ buildingId: shop }).ok);
  for (let i = 0; i < d.citizens.count; i++) assert.notEqual(d.citizens.col.job[i], shop);
  assert.ok(s.demolish({ buildingId: house }).ok);
  for (let i = 0; i < d.citizens.count; i++) assert.notEqual(d.citizens.col.home[i], house);
  assert.ok(d.population <= pop0);
  assert.ok(d.population >= pop0 - inHouse);
  assertConsistent(s);
});

test('emploi du temps : réveil, trajet, travail, pause, retour, sommeil ; repos le week-end', () => {
  const s = newTownSim();
  buildStreet(s, 0, -220, 220, ['maison', 'boutique']);
  s.runExt('settle', { waves: 4 });
  const d = s.demography!;
  const c = d.citizens.col;
  let w = -1;
  for (let i = 0; i < d.citizens.count; i++) if (c.job[i]! >= 0) { w = i; break; }
  assert.ok(w >= 0);
  c.wake[w] = 360; c.workStart[w] = 480; c.workEnd[w] = 1020; c.sleep[w] = 1380; c.commute[w] = 4500; // 15 min de trajet
  const at = (h: number, m = 0, weekend = false): number => d.activityAt(w, h * 60 + m, weekend);
  assert.equal(at(5), Activity.Sleep);
  assert.equal(at(6, 30), Activity.Home);
  assert.equal(at(7, 50), Activity.CommuteOut);
  assert.equal(at(9), Activity.Work);
  assert.equal(at(12, 30), Activity.Break);
  assert.equal(at(15), Activity.Work);
  assert.equal(at(17, 5), Activity.CommuteBack);
  assert.equal(at(23, 30), Activity.Sleep);
  assert.notEqual(at(9, 0, true), Activity.Work, 'pas de travail le week-end');
});

test('LOD de simulation : trajets individuels près de la caméra uniquement', () => {
  const s = newTownSim();
  buildTown(s);
  s.runExt('settle', { waves: 20 });
  const d = s.demography!;
  const far = s.runExt('setFocus', { x: 5000, z: 5000 });
  assert.ok(far.ok && far.data.detailed === 0 && far.data.statistical === d.population);
  const t0 = d.tripsEmitted;
  runDays(s, 1);
  assert.equal(d.tripsEmitted, t0, 'aucun trajet individuel en LOD statistique');
  const rep = s.report().demography;
  const total = Object.values(rep.activities).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - d.population) <= 8, 'activités estimées par échantillonnage');
  const near = s.runExt('setFocus', { x: 0, z: 0 });
  assert.ok(near.ok && near.data.detailed === d.population, `tout est à moins de ${LOD_DETAILED_M} m`);
  runDays(s, 1);
  assert.ok(d.tripsEmitted - t0 > d.population * 0.5, `trajets émis : ${d.tripsEmitted - t0}`);
  for (let i = 0; i < d.citizens.count; i++) assert.equal(d.citizens.col.lod[i], SimLod.Detailed);
  const mid = s.runExt('setFocus', { x: 1000, z: 0 });
  assert.ok(mid.ok && mid.data.simplified === d.population);
});

test('performance : 6 000 citoyens, coût du tick et de la journée (indicatif, Node)', () => {
  const s = newTownSim(500_000_000);
  buildDistrict(s, 8);
  buildStreet(s, 136, -220, 220, ['bureaux', 'usine', 'boutique', 'boutique', 'ecole', 'hopital', 'usine', 'bureaux', 'bureaux']);
  s.runExt('settle', { waves: 60 });
  const d = s.demography!;
  assert.ok(d.population > 5000, `population ${d.population}`);
  let t0 = performance.now();
  for (let i = 0; i < 200; i++) s.tick();
  const tickMs = (performance.now() - t0) / 200;
  t0 = performance.now();
  d.daily(s.clock.totalMinutes, 0.09);
  const dayMs = performance.now() - t0;
  console.log(`# ${d.population} citoyens : tick ${tickMs.toFixed(3)} ms, journée ${dayMs.toFixed(1)} ms`);
  assert.ok(tickMs < 4, `tick ${tickMs} ms (budget 4 ms à x4 pour 10 000 bâtiments)`);
  assert.ok(dayMs < 200, `journée ${dayMs} ms`);
});
