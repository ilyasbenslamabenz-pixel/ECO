// Tests des modules politique, international, événements et victoire.
import { describe, expect, it } from 'vitest';
import { applyGovAction, createGame, schedulePolicy, tick } from '../shared/sim/engine';
import { classifyChanges, computePopularity, allocateSeats, PARTY_IDS } from '../shared/sim/politics';
import { triggerEvent, EVENT_DEFS } from '../shared/sim/events';
import type { GameState, Policy } from '../shared/sim/types';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const base = createGame();
const fresh = (): GameState => clone(base);
const run = (S: GameState, months: number) => { for (let i = 0; i < months; i++) tick(S); return S; };
const propose = (S: GameState, f: (p: Policy) => void) => { const p = clone(S.policy); f(p); return schedulePolicy(S, p, { parliament: true }); };

describe('Politique : partis et parlement', () => {
  it('démarre avec un parlement complet et une coalition majoritaire', () => {
    const P = base.politics!;
    expect(P.parties.reduce((s, p) => s + p.seats, 0)).toBe(P.seatsTotal);
    expect(P.parties.reduce((s, p) => s + p.popularity, 0)).toBeCloseTo(1, 6);
    const coal = P.parties.filter((p) => P.coalition.includes(p.id)).reduce((s, p) => s + p.seats, 0);
    expect(coal).toBeGreaterThan(P.seatsTotal / 2);
    expect(P.mode).toBe('majorite');
  });
  it('répartit les sièges à la proportionnelle avec un seuil de 5 %', () => {
    const seats = allocateSeats({ ecologistes: 0.04, sociaux_democrates: 0.3, centristes: 0.2, liberaux: 0.16, conservateurs: 0.3 }, 100);
    expect(seats.ecologistes).toBe(0);
    expect(Object.values(seats).reduce((s, v) => s + v, 0)).toBe(100);
    expect(seats.sociaux_democrates).toBe(seats.conservateurs);
  });
  it('la popularité du camp gouvernemental dépend de la satisfaction', () => {
    const happy = fresh();
    const angry = fresh();
    for (const c of Object.keys(happy.satisfaction.byCategory)) {
      (happy.satisfaction.byCategory as Record<string, number>)[c] += 15;
      (angry.satisfaction.byCategory as Record<string, number>)[c] -= 15;
    }
    const gov = (S: GameState) => { const pop = computePopularity(S); return S.politics!.coalition.reduce((s, p) => s + pop[p], 0); };
    expect(gov(happy)).toBeGreaterThan(gov(fresh()) + 0.02);
    expect(gov(angry)).toBeLessThan(gov(fresh()) - 0.02);
  });
  it('une élection a lieu au mois 48 et redistribue les sièges', () => {
    const S = run(fresh(), 47);
    expect(S.politics!.elections.length).toBe(0);
    tick(S);
    expect(S.month).toBe(48);
    expect(S.politics!.elections.length).toBe(1);
    const e = S.politics!.elections[0];
    expect(e.month).toBe(48);
    expect(Object.values(e.seats).reduce((s, v) => s + v, 0)).toBe(S.politics!.seatsTotal);
    expect(S.politics!.nextElection).toBe(96);
    // résultats par arrondissement (entrées de country.cities)
    expect(e.districts!.length).toBe(S.country.cities.length);
    for (const d of e.districts!) expect(Object.values(d.shares).reduce((s, v) => s + v, 0)).toBeCloseTo(1, 6);
    expect(new Set(e.districts!.map((d) => d.winner)).size).toBeGreaterThanOrEqual(1);
  });
  it('une coalition effondrée dans les sondages perd les élections (défaite politique)', () => {
    const S = run(fresh(), 47);
    const P = S.politics!;
    for (const p of P.parties) p.mood = P.coalition.includes(p.id) ? -1 : 0;
    const pops: Record<string, number> = { centristes: 0.05, sociaux_democrates: 0.05, ecologistes: 0.05, liberaux: 0.1, conservateurs: 0.75 };
    P.parties.forEach((p) => (p.popularity = pops[p.id]));
    tick(S);
    expect(P.elections.length).toBe(1);
    expect(P.elections[0].outcome).toBe('defaite');
    expect(S.victory!.status).toBe('defaite');
    expect(S.victory!.defeat!.reason).toBe('elections');
  });
});

describe('Lois : décrets et projets de loi', () => {
  it('classe les changements : petits ajustements = décrets, réformes majeures = lois', () => {
    const a = base.policy;
    const small = clone(a); small.vat.normal = 0.21; small.budget.sante *= 1.05;
    expect(classifyChanges(a, small).every((c) => !c.major)).toBe(true);
    const big = clone(a); big.vat.normal = 0.23; big.labour.retirementAge = 66; big.wealth.rate = 0.01;
    const ch = classifyChanges(a, big);
    expect(ch.filter((c) => c.major).map((c) => c.category).sort()).toEqual(['fiscal', 'fiscal', 'retraites']);
  });
  it('un petit ajustement est un décret appliqué au mois suivant sans vote', () => {
    const S = fresh();
    const r = propose(S, (p) => { p.vat.normal = 0.21; });
    expect(r.bills.length).toBe(0);
    tick(S);
    expect(S.policy.vat.normal).toBeCloseTo(0.21);
  });
  it('une loi majeure soutenue par la majorité est adoptée et entre en vigueur', () => {
    const S = fresh();
    const r = propose(S, (p) => { p.budget.sante *= 1.2; });
    expect(r.bills.length).toBe(1);
    const before = S.policy.budget.sante;
    tick(S);
    const bill = S.politics!.bills.find((b) => b.id === r.bills[0].id)!;
    expect(bill.status).toBe('adoptee');
    expect(S.policy.budget.sante).toBeGreaterThan(before * 1.15);
  });
  it("une loi majeure sans majorité est rejetée et n'entre pas en vigueur", () => {
    const S = fresh();
    S.politics!.coalition = ['ecologistes']; // gouvernement minoritaire
    S.politics!.mode = 'minorite';
    const r = propose(S, (p) => { p.eco.carbon = 300; p.eco.industrial = 250; p.trade = { tariff: 0 }; });
    expect(r.bills.length).toBe(1);
    expect(S.pending!.policy.eco.carbon).toBe(base.policy.eco.carbon); // le décret ne contient pas la réforme
    tick(S);
    const bill = S.politics!.bills.find((b) => b.id === r.bills[0].id)!;
    expect(bill.status).toBe('rejetee');
    expect(bill.yes!).toBeLessThanOrEqual(bill.no!);
    expect(S.policy.eco.carbon).toBe(base.policy.eco.carbon);
    run(S, 3);
    expect(S.policy.eco.carbon).toBe(base.policy.eco.carbon);
  });
  it('la procédure directe (sans option) reste inchangée', () => {
    const S = fresh();
    const p = clone(S.policy); p.labour.retirementAge = 67;
    schedulePolicy(S, p);
    tick(S);
    expect(S.policy.labour.retirementAge).toBe(67);
  });
});

describe('International : droits de douane et représailles', () => {
  it('des droits de douane réduisent les importations et provoquent des représailles sur les exportations', () => {
    const ref = run(fresh(), 24);
    const S = fresh();
    const p = clone(S.policy); p.trade = { tariff: 0.2 };
    schedulePolicy(S, p);
    run(S, 24);
    expect(S.accounts.imports).toBeLessThan(ref.accounts.imports * 0.85);
    expect(S.international!.retaliation).toBeGreaterThan(0.05);
    expect(S.accounts.exports).toBeLessThan(ref.accounts.exports * 0.95);
    expect(S.accounts.revenue.douanes).toBeGreaterThan(0);
    expect(S.international!.neighbors.every((n) => !n.agreements.includes('commerce'))).toBe(true);
    const relRef = ref.international!.avgRelation;
    expect(S.international!.avgRelation).toBeLessThan(relRef);
  });
  it('compte 3 à 5 voisins et un accord énergétique réduit le prix de l\'énergie', () => {
    const S = fresh();
    const N = S.international!.neighbors;
    expect(N.length).toBeGreaterThanOrEqual(3);
    expect(N.length).toBeLessThanOrEqual(5);
    const exp = N.find((n) => n.energyExporter)!;
    exp.relation = 80;
    expect(applyGovAction(S, { type: 'accord', neighbor: exp.id, kind: 'energie' }).ok).toBe(true);
    const ref = fresh();
    run(S, 3); run(ref, 3);
    expect(S.macro.energyPrice).toBeLessThan(ref.macro.energyPrice);
  });
});

describe('Événements et crises', () => {
  it('même graine → mêmes événements ; graine différente → séquence différente', () => {
    const ids = (S: GameState) => [...S.events!.history, ...S.events!.active].map((e) => `${e.month}:${e.id}`).join(',');
    const a = run(createGame({ seed: 4242 }), 180);
    const b = run(createGame({ seed: 4242 }), 180);
    const c = run(createGame({ seed: 99 }), 180);
    expect(ids(a).length).toBeGreaterThan(0);
    expect(ids(a)).toBe(ids(b));
    expect(ids(a)).not.toBe(ids(c));
  });
  it("un événement non traité applique l'option par défaut à l'échéance", () => {
    const S = run(fresh(), 1);
    S.events!.enabled = false; // aucun autre tirage pendant le test
    const ev = triggerEvent(S, 'crise_energetique')!;
    expect(S.events!.active.length).toBe(1);
    expect(S.macro.energyPrice).toBeCloseTo(base.macro.energyPrice, 1); // l'effet passe par le module international au mois suivant
    tick(S);
    expect(S.macro.energyPrice).toBeGreaterThan(1.2);
    run(S, 2);
    expect(S.events!.active.length).toBe(0);
    const done = S.events!.history.find((e) => e.uid === ev.uid)!;
    expect(done.choice).toBe('marche');
    expect(done.auto).toBe(true);
  });
  it('une décision coûteuse passe par le budget (identité de trésorerie respectée) et atténue le choc', () => {
    const A = run(fresh(), 1);
    const B = run(fresh(), 1);
    A.events!.enabled = false; B.events!.enabled = false;
    const ea = triggerEvent(A, 'crise_energetique')!;
    triggerEvent(B, 'crise_energetique');
    expect(applyGovAction(A, { type: 'evenement', uid: ea.uid, option: 'bouclier' }).ok).toBe(true);
    const cash0 = A.finance.cash, reserve0 = A.finance.reserve, bonds0 = A.finance.bondsIssued.reduce((s, b) => s + b.amount, 0);
    const sub0 = A.policy.budget.subventions;
    tick(A); tick(B);
    const issued = A.finance.bondsIssued.reduce((s, b) => s + b.amount, 0) - bonds0;
    expect(A.finance.cash - cash0).toBeCloseTo(A.accounts.balance / 12 + (reserve0 * A.macro.policyRate) / 12 + issued, -2);
    expect(A.accounts.spending.subventions).toBeGreaterThan(sub0 * 1.2);
    expect(A.policy.budget.subventions).toBeLessThan(sub0 * 1.01); // crédit retiré après le mois
    expect(A.macro.energyPrice).toBeLessThan(B.macro.energyPrice);
  });
  it('les probabilités dépendent de l\'état (pénurie de médecins si le budget santé est faible)', () => {
    const S = fresh();
    S.month = 30;
    const def = EVENT_DEFS.find((d) => d.id === 'penurie_medecins')!;
    const p0 = def.prob(S);
    S.policy.budget.sante *= 0.6;
    S.services.sante = 0.6;
    expect(def.prob(S)).toBeGreaterThan(p0 * 5);
  });
});

describe('Conditions de victoire et défaites', () => {
  it('une victoire se déclenche quand ses critères sont tenus assez longtemps', () => {
    const S = fresh();
    const pol = S.victory!.conditions.find((c) => c.id === 'politique')!;
    S.politics!.electionsWon = 2;
    let month = -1;
    for (let i = 0; i < 20 && pol.achieved === null; i++) {
      S.satisfaction.trust = 80; // maintenu artificiellement
      tick(S);
      if (pol.achieved !== null) month = i + 1;
      else expect(pol.held).toBe(i + 1);
    }
    expect(month).toBe(pol.required);
    expect(pol.progress).toBe(1);
  });
  it('le compteur repart de zéro si un critère n\'est plus tenu', () => {
    const S = fresh();
    S.politics!.electionsWon = 2;
    for (let i = 0; i < 5; i++) { S.satisfaction.trust = 80; tick(S); }
    const pol = S.victory!.conditions.find((c) => c.id === 'politique')!;
    expect(pol.held).toBe(5);
    S.satisfaction.trust = 30;
    tick(S);
    expect(pol.held).toBe(0);
  });
  it('un défaut de paiement met fin au mandat', () => {
    const S = fresh();
    S.finance.debt = S.accounts.gdp * 2.5;
    tick(S);
    expect(S.victory!.status).toBe('defaite');
    expect(S.victory!.defeat!.reason).toBe('defaut');
    expect(applyGovAction(S, { type: 'continuer' }).ok).toBe(true);
    expect(S.victory!.status).toBe('en_cours');
  });
  it('les identifiants de partis sont stables', () => {
    expect(PARTY_IDS.length).toBe(5);
  });
});
