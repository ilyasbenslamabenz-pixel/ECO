// Tests du module énergie, émissions et environnement.
import { describe, expect, it } from 'vitest';
import { applyAction, createGame, schedulePolicy, tick } from '../shared/sim/engine';
import { potentialMW } from '../shared/sim/energy';
import { TECH_IDS, TECHS } from '../shared/sim/energyData';
import { makeHeightFn } from '../shared/sim/country';
import type { GameState, Policy } from '../shared/sim/types';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const base = createGame();
const fresh = (): GameState => clone(base);
const run = (S: GameState, months: number) => { for (let i = 0; i < months; i++) tick(S); return S; };
const withPolicy = (S: GameState, f: (p: Policy) => void) => { const p = clone(S.policy); f(p); schedulePolicy(S, p); return S; };
const close = (S: GameState, tech: string, mw = 1e6) => applyAction(S, { type: 'energyClose', tech: tech as never, mw: Math.min(mw, 10000) });

describe('Système électrique', () => {
  it('le parc initial couvre la demande sans délestage toute l\'année, avec une marge à la pointe', () => {
    const S = fresh();
    expect(S.energy!.balance.margin).toBeGreaterThan(0.05);
    for (let i = 0; i < 12; i++) {
      tick(S);
      expect(S.energy!.balance.unserved).toBe(0);
    }
    expect(S.energy!.shortageRisk).toBeLessThan(0.2);
    expect(S.macro.energyPrice).toBeGreaterThan(0.9);
    expect(S.macro.energyPrice).toBeLessThan(1.1);
  });

  it('bilan : production + importations = consommation + pertes + exportations + stockage net', () => {
    const S = fresh();
    applyAction(S, { type: 'energyBuild', tech: 'batteries', mw: 1500 });
    applyAction(S, { type: 'energyBuild', tech: 'solaire', mw: 3000 });
    for (let i = 0; i < 30; i++) {
      tick(S);
      const b = S.energy!.balance;
      const lhs = b.production + b.imports;
      const rhs = b.consumption + b.losses + b.exports + (b.storageCharge - b.storageDischarge);
      expect(Math.abs(lhs - rhs)).toBeLessThan(1e-6 * lhs);
      const sum = TECH_IDS.reduce((s, t) => s + b.byTech[t], 0);
      expect(sum).toBeCloseTo(b.production, 3);
    }
    expect(S.energy!.storage.mw).toBeGreaterThanOrEqual(1500);
    expect(S.energy!.balance.storageDischarge).toBeGreaterThan(0);
  });

  it('les émissions de la production électrique viennent du mix réel (t CO₂/MWh par filière)', () => {
    const S = run(fresh(), 3);
    const b = S.energy!.balance;
    const expected = TECH_IDS.reduce((s, t) => s + b.byTech[t] * TECHS[t].co2, 0);
    expect(b.co2).toBeCloseTo(expected, 0);
    expect(S.energy!.emissions.power).toBeCloseTo(expected * 12, -1);
  });

  it('fermer le charbon réduit les émissions', () => {
    const ref = run(fresh(), 6);
    const S = fresh();
    expect(close(S, 'charbon').ok).toBe(true);
    run(S, 6);
    expect(S.energy!.balance.byTech.charbon).toBe(0);
    expect(S.energy!.emissions.power).toBeLessThan(ref.energy!.emissions.power * 0.9);
    expect(S.accounts.emissions).toBeLessThan(ref.accounts.emissions);
    // le démantèlement est payé par l'État
    expect(S.accounts.spending.energie).toBeGreaterThan(0);
  });

  it('fermer toutes les centrales pilotables sans stockage provoque une pénurie', () => {
    const S = fresh();
    for (const t of TECH_IDS) if (TECHS[t].dispatchable) close(S, t);
    tick(S);
    const b = S.energy!.balance;
    expect(b.unserved).toBeGreaterThan(0);
    expect(S.energy!.shortageRisk).toBeGreaterThan(0.9);
    expect(b.margin).toBeLessThan(0);
    expect(S.macro.energyPrice).toBeGreaterThan(1.3); // prix de pénurie
  });

  it('une fermeture programmée n\'intervient qu\'à son échéance et retire les sites de la carte', () => {
    const S = fresh();
    const at = S.month + 5;
    expect(applyAction(S, { type: 'energyClose', tech: 'charbon', mw: 10000, atMonth: at }).ok).toBe(true);
    run(S, 4);
    expect(S.energy!.fleet.charbon.mw).toBeGreaterThan(0);
    run(S, 1);
    expect(S.energy!.fleet.charbon.mw).toBe(0);
    expect(S.country.infra.filter((i) => i.type === 'centrale_charbon' && (i.status ?? 'active') === 'active').length).toBe(0);
  });

  it('une taxe carbone élevée change le mix (moins de charbon, plus de renouvelables)', () => {
    const ref = run(fresh(), 60);
    const S = run(withPolicy(fresh(), (p) => { p.eco.industrial = 250; p.eco.carbon = 250; }), 60);
    const coal = (G: GameState) => G.energy!.roll.length && G.energy!.balance.byTech.charbon / G.energy!.balance.production;
    expect(coal(S)).toBeLessThan(coal(ref) * 0.5);
    expect(S.energy!.elecRenShare).toBeGreaterThan(ref.energy!.elecRenShare);
    expect(S.energy!.emissions.intensityElec).toBeLessThan(ref.energy!.emissions.intensityElec);
    expect(S.energy!.final.renewableShare).toBeGreaterThan(ref.energy!.final.renewableShare);
  });

  it('un projet public est financé par la trésorerie, prend son délai de construction puis augmente la capacité', () => {
    const S = fresh();
    const mw0 = S.energy!.fleet.eolienMer.mw;
    expect(applyAction(S, { type: 'energyBuild', tech: 'eolienMer', mw: 1000 }).ok).toBe(true);
    const site = S.country.infra.at(-1)!;
    expect(site.type).toBe('parc_eolien_mer');
    expect(site.status).toBe('construction');
    const h = makeHeightFn(S.country);
    expect(h(site.x, site.z)).toBeLessThan(S.country.seaLevel + 0.02); // en mer
    run(S, TECHS.eolienMer.buildMonths - 1);
    expect(S.energy!.fleet.eolienMer.mw).toBe(mw0);
    expect(S.accounts.spending.energie).toBeGreaterThan(0);
    tick(S);
    expect(S.energy!.fleet.eolienMer.mw).toBe(mw0 + 1000);
    expect(S.energy!.fleet.eolienMer.publicMw).toBe(1000);
    expect(S.country.infra.find((i) => i.id === site.id)!.status).toBe('active');
  });

  it('les capacités constructibles sont bornées par les surfaces disponibles', () => {
    const S = fresh();
    const pot = potentialMW(S, 'eolien');
    const L = S.environment!.land;
    expect(pot).toBeCloseTo(Math.max(S.energy!.fleet.eolien.mw, (L.agricole + L.naturel + L.foret) * 0.6), 3);
    const r = applyAction(S, { type: 'energyBuild', tech: 'eolien', mw: Math.ceil(pot) + 100 });
    expect(r.ok).toBe(false);
    expect(potentialMW(S, 'eolienMer')).toBeGreaterThan(pot);
  });
});

describe('Bilan énergétique et émissions', () => {
  it('distingue électricité et énergie finale', () => {
    const S = run(fresh(), 12);
    const E = S.energy!;
    const f = E.final;
    // l'électricité n'est qu'une partie de l'énergie finale
    expect(f.byCarrier.elec).toBeLessThan(f.total * 0.6);
    expect(f.total).toBeCloseTo(Object.values(f.byCarrier).reduce((s, v) => s + v, 0), -2);
    // l'électricité finale du bilan énergétique = consommation desservie sur 12 mois
    const cons = E.roll.reduce((s, r) => s + r.cons, 0);
    expect(f.byCarrier.elec / cons).toBeGreaterThan(0.97);
    expect(f.byCarrier.elec / cons).toBeLessThan(1.03);
    // part renouvelable de l'énergie finale ≠ part renouvelable de l'électricité : elle se rapporte à toute l'énergie
    // finale et inclut des renouvelables non électriques (biomasse, biocarburants, chaleur)
    expect(f.renewableShare).toBeGreaterThan(E.elecRenShare * (f.byCarrier.elec / f.total) + 0.001);
    expect(f.renewableShare).toBeLessThan(1);
  });

  it('les absorptions et la compensation ne réduisent jamais les émissions brutes', () => {
    const ref = run(fresh(), 48);
    const S = fresh();
    expect(applyAction(S, { type: 'envProject', kind: 'reboisement', km2: 60 }).ok).toBe(true);
    expect(applyAction(S, { type: 'envProject', kind: 'restauration', km2: 10 }).ok).toBe(true);
    withPolicy(S, (p) => { p.energy.offsets = 20e6; });
    run(S, 48);
    const a = S.energy!.emissions;
    const r = ref.energy!.emissions;
    expect(a.absorptions).toBeGreaterThan(r.absorptions);
    expect(Math.abs(a.territorialGross / r.territorialGross - 1)).toBeLessThan(0.01);
    expect(a.net).toBeCloseTo(a.territorialGross + a.landUse - a.absorptions, -2);
    expect(a.net).toBeLessThan(a.territorialGross);
    expect(a.netAfterOffsets).toBeCloseTo(a.net - 20e6, -2);
    expect(a.territorialGross).toBeGreaterThan(a.netAfterOffsets);
    expect(S.accounts.spending.ecologie).toBeGreaterThan(0);
  });

  it('expose les composantes des émissions et l\'avancement des objectifs', () => {
    const S = run(fresh(), 1);
    const em = S.energy!.emissions;
    expect(em.direct).toBe(em.territorialGross);
    expect(em.indirect).toBeGreaterThan(em.imported);
    expect(em.fossilCO2).toBeLessThan(em.territorialGross);
    expect(em.footprint).toBeGreaterThan(0);
    const ids = S.energy!.goals.map((g) => g.id);
    expect(ids).toEqual(['elec100', 'final100', 'netZero', 'zeroFossil']);
    for (const g of S.energy!.goals) { expect(g.progress).toBeGreaterThanOrEqual(0); expect(g.progress).toBeLessThanOrEqual(1); expect(g.achieved).toBe(false); }
  });

  it('la cohérence budgétaire est conservée avec les flux du module énergie', () => {
    const S = fresh();
    applyAction(S, { type: 'energyBuild', tech: 'nucleaire', mw: 1600 });
    withPolicy(S, (p) => { p.energy.evSubsidy = 5000; p.energy.renovationBudget = 2e9; });
    for (let i = 0; i < 24; i++) {
      const cash0 = S.finance.cash;
      const reserve0 = S.finance.reserve;
      const bonds0 = S.finance.bondsIssued.reduce((s, b) => s + b.amount, 0);
      tick(S);
      const issued = S.finance.bondsIssued.reduce((s, b) => s + b.amount, 0) - bonds0;
      const A = S.accounts;
      expect(Object.values(A.spending).reduce((s, v) => s + v, 0)).toBeCloseTo(A.spendingTotal, -2);
      expect(Object.values(A.revenue).reduce((s, v) => s + v, 0)).toBeCloseTo(A.revenueTotal, -2);
      expect(S.finance.cash - cash0).toBeCloseTo(A.balance / 12 + (reserve0 * S.macro.policyRate) / 12 + issued, -2);
    }
    expect(S.energy!.finance.ev).toBeGreaterThan(0);
    expect(S.energy!.evShare).toBeGreaterThan(base.energy!.evShare);
  });
});

describe('Environnement et biodiversité', () => {
  it('la qualité de l\'air suit les polluants locaux et alimente la santé', () => {
    const ref = run(fresh(), 24);
    const S = fresh();
    close(S, 'charbon');
    withPolicy(S, (p) => { p.eco.carbon = 300; p.eco.industrial = 300; });
    run(S, 24);
    expect(S.environment!.airQuality).toBeGreaterThan(ref.environment!.airQuality);
  });

  it('aires protégées et restauration améliorent la biodiversité avec retard', () => {
    const ref = run(fresh(), 60);
    const S = fresh();
    expect(applyAction(S, { type: 'envProject', kind: 'aireProtegee', km2: 80 }).ok).toBe(true);
    expect(applyAction(S, { type: 'envProject', kind: 'restauration', km2: 10 }).ok).toBe(true);
    expect(applyAction(S, { type: 'envProject', kind: 'parc', km2: 5 }).ok).toBe(true);
    run(S, 60);
    expect(S.environment!.biodiversity).toBeGreaterThan(ref.environment!.biodiversity);
    expect(S.environment!.quality).toBeGreaterThan(ref.environment!.quality);
    expect(S.environment!.protectedKm2).toBeGreaterThan(ref.environment!.protectedKm2);
  });

  it('les surfaces restent cohérentes (somme constante)', () => {
    const S = run(fresh(), 36);
    const env = S.environment!;
    const sum = Object.values(env.land).reduce((s, v) => s + v, 0);
    expect(sum).toBeCloseTo(env.landTotal, 3);
  });
});
