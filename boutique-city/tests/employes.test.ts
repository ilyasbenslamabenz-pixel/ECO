/**
 * Employés : rôles (caisse, rayon, entretien), équipes (matin, soir, journée), salaires à l'heure travaillée,
 * souhaits des candidats (équipe préférée, salaire minimum), compatibilité des anciennes sauvegardes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FURNITURE_BY_ID, STAFF, productsOf } from '../src/sim/catalog';
import { serviceBuilding } from '../src/sim/district';
import { canPlace, layoutStats } from '../src/sim/layout';
import { Game } from '../src/sim/game';

const DAY = 1440;

/** Épicerie (8 h – 20 h) aménagée et approvisionnée sur le meilleur local libre. */
function setup(): { g: Game; id: number } {
  const g = new Game(7);
  const p = g.district.premises.filter((x) => g.isFree(x)).sort((a, b) => b.footfall - a.footfall)[0]!;
  const r = g.rent(p.id, 'epicerie');
  if (!r.ok) throw new Error(r.message);
  const id = r.data.id, s = g.shop(id)!;
  const go = (k: 'meubles' | 'emploi'): void => { const b = serviceBuilding(g.district, k)!; g.setPlace({ kind: 'service', service: k, buildingId: b.id }); };
  go('meubles');
  const items = ['caisse', 'caisse', 'rayon', 'rayon', 'frigo'];
  for (const f of items) assert.ok(g.buyFurniture(f, 1, id).ok);
  for (const f of items) {
    const def = FURNITURE_BY_ID.get(f)!;
    let done = false;
    for (let z = 0; z < p.gridD && !done; z += 2) for (let x = 0; x < p.gridW && !done; x++) {
      if (canPlace(s.items, p.gridW, p.gridD, def, x, z, 0)) continue;
      const q = g.place(id, f, x, z, 0);
      if (q.ok && layoutStats(s.items, p.gridW, p.gridD).blocked.length === 0) done = true; else if (q.ok) g.pickUp(id, q.data.uid);
    }
  }
  for (const pr of productsOf('epicerie')) { g.order(id, pr.id, 1000); g.setAuto(id, pr.id, true); }
  go('emploi');
  g.cash = 100_000;
  return { g, id };
}
const atAgency = (g: Game): void => { const b = serviceBuilding(g.district, 'emploi')!; g.setPlace({ kind: 'service', service: 'emploi', buildingId: b.id }); };
const keepAlive = (g: Game): void => { g.player.energy = 100; g.player.hunger = 100; };
/** Avance jusqu'à l'heure h (du jour courant ou du lendemain). */
function goToHour(g: Game, h: number): void {
  const now = g.total % DAY, target = h * 60;
  keepAlive(g);
  g.advance(target > now ? target - now : DAY - now + target);
}

test('embauche par défaut : caissier en journée complète, souhaits du candidat conservés', () => {
  const { g, id } = setup();
  const c = g.candidates[0]!;
  assert.ok(c.wantShift && c.minWage !== undefined && c.minWage <= c.wage, 'chaque candidat a un souhait');
  const r = g.hire(c.id, id);
  assert.ok(r.ok);
  const e = g.employees[0]!;
  assert.equal(g.roleOf(e), 'caisse');
  assert.equal(g.shiftOf(e), 'journee');
  assert.equal(e.wantShift, c.wantShift);
  assert.equal(e.minWage, c.minWage);
  assert.equal(g.hoursPerDay(e), 12, 'épicerie 8 h – 20 h');
  assert.deepEqual(g.cashierGaps(id), []);
  // Les souhaits varient d'un candidat à l'autre.
  const all = new Set([c, ...g.candidates].map((x) => x.wantShift));
  assert.ok(all.size >= 2, `souhaits variés : ${[...all].join(', ')}`);
});

test('équipes : présence, salaire payé à l’heure travaillée, trous de caisse', () => {
  const { g, id } = setup();
  assert.ok(g.hire(g.candidates[0]!.id, id, { shift: 'matin' }).ok);
  const e = g.employees[0]!;
  assert.equal(g.hoursPerDay(e), 6, 'matin : 8 h – 14 h');
  assert.deepEqual(g.cashierGaps(id), [[14, 20]]);
  assert.ok(g.worksAt(e, 9) && !g.worksAt(e, 15) && !g.worksAt(e, 7));
  goToHour(g, 0);
  keepAlive(g); g.advance(DAY);
  const y = g.ledger.at(-1)!;
  assert.equal(Math.round(y.wages), e.wage * 6, 'six heures payées');
  // Le soir, sans caissier : capacité nulle, clients perdus faute de caissier.
  goToHour(g, 16);
  assert.equal(g.shop(id)!.capacity, 0);
  assert.equal(g.onDuty(id, 'caisse').length, 0);
  goToHour(g, 10);
  assert.ok(g.shop(id)!.capacity > 0, 'le matin, la caisse est tenue');
  atAgency(g);
  // Un second caissier le soir couvre la journée.
  assert.ok(g.hire(g.candidates[0]!.id, id, { shift: 'soir' }).ok);
  assert.deepEqual(g.cashierGaps(id), []);
  assert.equal(g.setShift(e.id, 'journee').ok, true);
  assert.equal(g.hoursPerDay(e), 12);
});

test('rôles : seuls les caissiers encaissent, le rayon attire des clients, l’entretien nettoie', () => {
  const { g, id } = setup();
  const s = g.shop(id)!;
  assert.ok(g.hire(g.candidates[0]!.id, id).ok);
  assert.ok(g.hire(g.candidates[0]!.id, id, { role: 'rayon' }).ok);
  assert.ok(g.hire(g.candidates[0]!.id, id, { role: 'entretien', shift: 'soir' }).ok);
  const [cais, ray, ent] = g.employees as [typeof g.employees[0], typeof g.employees[0], typeof g.employees[0]];
  goToHour(g, 10);
  const cap1 = g.capacityNow(s);
  assert.ok(cap1 > 0);
  assert.ok(Math.abs(g.shelfBonus(s) - STAFF.shelfBonus * ray.skill) < 1e-9, 'bonus de rayon selon la compétence');
  assert.equal(g.cleaningPower(s), 0, 'entretien du soir absent le matin');
  // Le vendeur de rayon passe en caisse : deux caisses tenues.
  assert.ok(g.setRole(ray.id, 'caisse').ok);
  assert.ok(g.capacityNow(s) > cap1 * 1.5);
  assert.equal(g.shelfBonus(s), 0);
  goToHour(g, 15);
  assert.ok(Math.abs(g.cleaningPower(s) - ent.skill) < 1e-9, 'entretien présent le soir');
  assert.equal(g.onDuty(id).length, 3);
  goToHour(g, 21);
  assert.equal(g.cleaningPower(s), 0, 'commerce fermé : personne');
  assert.equal(g.onDuty(id).length, 0);
  // Sans caissier du tout : trou toute la journée.
  assert.ok(g.setRole(cais.id, 'rayon').ok && g.setRole(ray.id, 'entretien').ok);
  assert.deepEqual(g.cashierGaps(id), [[8, 20]]);
  assert.equal(g.setRole(cais.id, 'chef' as never).ok, false, 'rôle inconnu refusé');
});

test('souhaits : équipe imposée ou salaire sous le minimum font baisser la satisfaction', () => {
  // Même candidat dans deux parties identiques : dans son équipe souhaitée, ou dans une autre.
  const A = setup(), B = setup();
  const want = A.g.candidates[0]!.wantShift!;
  const other = want === 'matin' ? 'soir' : 'matin';
  assert.equal(A.g.candidates[0]!.id, B.g.candidates[0]!.id);
  assert.ok(A.g.hire(A.g.candidates[0]!.id, A.id, { shift: want }).ok);
  assert.ok(B.g.hire(B.g.candidates[0]!.id, B.id, { shift: other }).ok);
  const happy = A.g.employees[0]!, sad = B.g.employees[0]!;
  assert.deepEqual(A.g.unmetWishes(happy), []);
  assert.equal(B.g.unmetWishes(sad).length, 1);
  for (let d = 0; d < 5; d++) { keepAlive(A.g); A.g.advance(DAY); keepAlive(B.g); B.g.advance(DAY); }
  assert.ok((sad.mood ?? 0) < (happy.mood ?? 0) - STAFF.shiftMood * 0.5, `satisfaction ${happy.mood} contre ${sad.mood}`);
  // Salaire sous le minimum : satisfaction en chute.
  const before = happy.mood ?? 0;
  assert.ok(A.g.raiseWage(happy.id, happy.minWage! - 1).ok);
  assert.ok(A.g.unmetWishes(happy).some((w) => w.includes('CHF')));
  keepAlive(A.g); A.g.advance(DAY);
  assert.ok((happy.mood ?? 0) < before - 0.05, `satisfaction ${before} → ${happy.mood}`);
});

test('anciennes sauvegardes : employés sans rôle ni équipe → caisse, journée complète', () => {
  const { g, id } = setup();
  assert.ok(g.hire(g.candidates[0]!.id, id).ok);
  const save = JSON.parse(JSON.stringify(g.save()));
  for (const e of save.employees) { delete e.role; delete e.shift; delete e.wantShift; delete e.minWage; }
  for (const c of save.candidates) { delete c.wantShift; delete c.minWage; }
  assert.equal(save.v, 2);
  const h = new Game(g.seed, 'x', save);
  const e = h.employees[0]!;
  assert.equal(e.role, 'caisse');
  assert.equal(e.shift, 'journee');
  assert.deepEqual(h.unmetWishes(e), [], 'aucun souhait inventé');
  assert.equal(h.candidates[0]!.wantShift, 'journee');
  assert.equal(h.candidates[0]!.minWage, h.candidates[0]!.wage);
  assert.deepEqual(h.cashierGaps(id), []);
});
