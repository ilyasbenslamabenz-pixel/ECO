// Tests des moteurs sectoriels : transports, industrie, agriculture, déchets (phase 4b).
import { describe, expect, it } from 'vitest';
import { applyProgramAction, createGame, schedulePolicy, tick } from '../shared/sim/engine';
import { triggerDrought } from '../shared/sim/agriculture';
import { SECTOR_INDEX } from '../shared/sim/data';
import { TRANSPORT_PROJECTS } from '../shared/sim/transport';
import { PROGRAM_DEFS } from '../shared/sim/industry';
import type { GameState, Policy } from '../shared/sim/types';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const base = createGame();
const fresh = (): GameState => clone(base);
const run = (S: GameState, months: number) => { for (let i = 0; i < months; i++) tick(S); return S; };
const withPolicy = (S: GameState, f: (p: Policy) => void) => { const p = clone(S.policy); f(p); schedulePolicy(S, p); return S; };

describe('État initial des secteurs', () => {
  it('le pays démarre entièrement équipé (bus partout, métro, tram, RER, installations de déchets, logistique)', () => {
    const S = fresh();
    const T = S.transport!;
    expect(T.sites.filter((s) => s.kind === 'bus').length).toBe(S.country.cities.length);
    expect(T.network.metroKm).toBeGreaterThan(50);
    expect(T.network.tramKm).toBeGreaterThan(20);
    expect(T.sites.some((s) => s.kind === 'metro' && s.status === 'service' && (s.points?.length ?? 0) > 1)).toBe(true);
    expect(S.waste!.sites.some((s) => s.kind === 'tri')).toBe(true);
    expect(S.waste!.sites.some((s) => s.kind === 'incineration')).toBe(true);
    expect(S.industry!.sites.length).toBeGreaterThan(0);
    expect(S.agriculture!.farms).toBeGreaterThan(1000);
    const hw = S.country.width / 2;
    const hd = S.country.depth / 2;
    for (const s of [...S.waste!.sites, ...S.industry!.sites]) { expect(Math.abs(s.x)).toBeLessThanOrEqual(hw); expect(Math.abs(s.z)).toBeLessThanOrEqual(hd); }
  });
  it('reste à l\'équilibre : modes, prix alimentaires et parts restent stables la première année', () => {
    const S = run(fresh(), 12);
    expect(Math.abs(S.transport!.modal.voiture - base.transport!.modal.voiture)).toBeLessThan(0.02);
    expect(Math.abs(S.agriculture!.foodPrice - 1)).toBeLessThan(0.02);
    expect(S.transport!.extraCost).toBeCloseTo(0, -3);
  });
  it('le placement automatique est déterministe', () => {
    const a = fresh();
    const b = fresh();
    applyProgramAction(a, { type: 'waste:build', facility: 'tri', count: 3 });
    applyProgramAction(b, { type: 'waste:build', facility: 'tri', count: 3 });
    expect(JSON.stringify(a.waste!.sites)).toBe(JSON.stringify(b.waste!.sites));
    expect(a.waste!.sites.filter((s) => s.status === 'construction').length).toBe(3);
  });
  it('reprend une ancienne sauvegarde sans modules sectoriels', () => {
    const S = fresh();
    delete S.transport; delete S.industry; delete S.agriculture; delete S.waste;
    run(S, 2);
    expect(S.transport).toBeDefined();
    expect(Number.isFinite(S.accounts.emissions)).toBe(true);
  });
});

describe('Transports', () => {
  it("une nouvelle ligne de tram n'est opérationnelle qu'après sa durée de construction et coûte au budget", () => {
    const S = fresh();
    const ref = fresh();
    const km0 = S.transport!.network.tramKm;
    const r = applyProgramAction(S, { type: 'transport:build', kind: 'tram', size: 10 });
    expect(r.ok).toBe(true);
    const months = TRANSPORT_PROJECTS.tram.months(10);
    const site = S.transport!.sites.at(-1)!;
    expect(site.status).toBe('construction');
    expect(site.points!.length).toBeGreaterThan(1);
    run(S, months - 1);
    run(ref, months - 1);
    expect(S.transport!.network.tramKm).toBe(km0);
    expect(S.accounts.spending.transports).toBeGreaterThan(ref.accounts.spending.transports + 0.9 * (30e6 * 10 * 12) / months);
    // position financière nette (trésorerie − dette) dégradée d'environ le coût déjà payé
    expect((S.finance.cash - S.finance.debt) - (ref.finance.cash - ref.finance.debt)).toBeLessThan(-0.8 * 30e6 * 10 * (months - 1) / months);
    tick(S);
    expect(S.transport!.network.tramKm).toBeCloseTo(km0 + 10);
    expect(S.transport!.sites.find((s) => s.id === site.id)!.status).toBe('service');
    // l'entretien de la ligne est ensuite payé chaque mois
    tick(S); tick(ref); tick(ref);
    expect(S.accounts.spending.transports).toBeGreaterThan(ref.accounts.spending.transports);
  });

  it("l'électrification (bonus, bornes, bus électriques) réduit les émissions du transport", () => {
    const S = withPolicy(fresh(), (p) => { p.transport!.evBonus = 8000; p.transport!.thermalMalus = 6000; });
    applyProgramAction(S, { type: 'transport:build', kind: 'bornes', size: 300 });
    applyProgramAction(S, { type: 'transport:buy', vehicle: 'busElectrique', count: 1500, replace: true });
    run(S, 72);
    const ref = run(fresh(), 72);
    expect(S.transport!.fleet.evShare).toBeGreaterThan(ref.transport!.fleet.evShare + 0.05);
    expect(S.transport!.emissions.total).toBeLessThan(ref.transport!.emissions.total * 0.95);
    expect(S.accounts.emissions).toBeLessThan(ref.accounts.emissions);
    expect(S.accounts.spending.subventions).toBeGreaterThan(ref.accounts.spending.subventions); // le bonus coûte
  });

  it('des fréquences plus élevées attirent des usagers vers les transports publics mais coûtent', () => {
    const S = run(withPolicy(fresh(), (p) => { p.transport!.frequency = 1.25; }), 36);
    const ref = run(fresh(), 36);
    expect(S.transport!.modal.transportsCommuns).toBeGreaterThan(ref.transport!.modal.transportsCommuns);
    expect(S.accounts.spending.transports).toBeGreaterThan(ref.accounts.spending.transports);
  });

  it('la satisfaction « transports » provient du moteur des transports', () => {
    const S = run(fresh(), 3);
    expect(S.satisfaction.factors.transports).toBeCloseTo(S.transport!.satisfaction, 6);
  });
});

describe('Industrie', () => {
  it('la modernisation industrielle augmente la productivité après sa réalisation', () => {
    const S = fresh();
    expect(applyProgramAction(S, { type: 'industry:program', program: 'modernisation', tranches: 5 }).ok).toBe(true);
    const n = PROGRAM_DEFS.modernisation.months + 1;
    run(S, n);
    const ref = run(fresh(), n);
    const i = SECTOR_INDEX.industrie;
    expect(S.industry!.productivityIndex).toBeGreaterThan(1.03);
    expect(S.sectors[i].productivity).toBeGreaterThan(ref.sectors[i].productivity * 1.03);
  });
  it("l'électrification et l'hydrogène réduisent l'intensité d'émission de l'industrie", () => {
    const S = fresh();
    applyProgramAction(S, { type: 'industry:program', program: 'electrification', tranches: 8 });
    applyProgramAction(S, { type: 'industry:program', program: 'hydrogene', tranches: 5 });
    run(S, 48);
    const ref = run(fresh(), 48);
    const i = SECTOR_INDEX.industrie;
    expect(S.sectors[i].emissionIntensity).toBeLessThan(ref.sectors[i].emissionIntensity * 0.85);
    expect(S.industry!.electricityMWh).toBeGreaterThan(ref.industry!.electricityMWh);
  });
});

describe('Agriculture', () => {
  it("l'agriculture biologique réduit pesticides et émissions mais baisse les rendements", () => {
    const S = run(withPolicy(fresh(), (p) => { p.agriculture!.bioAid = 1200; }), 72);
    const ref = run(fresh(), 72);
    const G = S.agriculture!;
    const R = ref.agriculture!;
    expect(G.practices.bio).toBeGreaterThan(R.practices.bio + 0.15);
    expect(G.pesticideKg).toBeLessThan(R.pesticideKg * 0.85);
    expect(G.emissions.total).toBeLessThan(R.emissions.total);
    expect(G.yieldIndex).toBeLessThan(R.yieldIndex);
    expect(G.soilHealth).toBeGreaterThan(R.soilHealth);
  });
  it('une sécheresse fait monter les prix alimentaires (et l\'indice des prix)', () => {
    const S = fresh();
    const ref = fresh();
    triggerDrought(S, 0.9, 6);
    run(S, 5);
    run(ref, 5);
    expect(S.agriculture!.production).toBeLessThan(ref.agriculture!.production * 0.9);
    expect(S.agriculture!.foodPrice).toBeGreaterThan(ref.agriculture!.foodPrice);
    expect(S.macro.priceLevel).toBeGreaterThan(ref.macro.priceLevel);
  });
});

describe('Déchets', () => {
  it("plus de recyclage réduit l'enfouissement", () => {
    const S = withPolicy(fresh(), (p) => { p.waste!.sortingIncentive = 1; });
    applyProgramAction(S, { type: 'waste:build', facility: 'tri', count: 4 });
    applyProgramAction(S, { type: 'waste:build', facility: 'recyclage', count: 4 });
    run(S, 36);
    const ref = run(fresh(), 36);
    expect(S.waste!.flows.recyclage).toBeGreaterThan(ref.waste!.flows.recyclage * 1.2);
    expect(S.waste!.flows.enfouissement).toBeLessThan(ref.waste!.flows.enfouissement);
    expect(S.waste!.emissions).toBeLessThan(ref.waste!.emissions);
  });
  it('une taxe déchets plus élevée réduit la production de déchets et en augmente le tri', () => {
    const S = run(withPolicy(fresh(), (p) => { p.eco.waste = 150; }), 6);
    const ref = run(fresh(), 6);
    expect(S.waste!.household + S.waste!.industrial).toBeLessThan(ref.waste!.household + ref.waste!.industrial);
    expect(S.waste!.sortingRate).toBeGreaterThan(ref.waste!.sortingRate);
  });
});
