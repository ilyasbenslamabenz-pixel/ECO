// Tests des modules santé, éducation, logement, sécurité, recherche et construction.
import { describe, expect, it } from 'vitest';
import { applyServiceAction, createGame, schedulePolicy, tick } from '../shared/sim/engine';
import { BUILDINGS, roadDistance, validatePlacement } from '../shared/sim/construction';
import { makeHeightFn } from '../shared/sim/country';
import { TECH_INDEX } from '../shared/sim/research';
import type { GameState, Policy } from '../shared/sim/types';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const base = createGame();
const fresh = (): GameState => clone(base);
const run = (S: GameState, months: number) => { for (let i = 0; i < months; i++) tick(S); return S; };
const withPolicy = (S: GameState, f: (p: Policy) => void) => { const p = clone(S.policy); f(p); schedulePolicy(S, p); return S; };
const ref = (months: number) => run(fresh(), months);

/** Parcourt la carte sur une grille et renvoie le premier point satisfaisant `pred`. */
function scan(S: GameState, pred: (x: number, z: number) => boolean, step = 0.7): [number, number] | null {
  const w = S.country.width / 2 - 1;
  const d = S.country.depth / 2 - 1;
  for (let x = -w; x <= w; x += step) for (let z = -d; z <= d; z += step) if (pred(x, z)) return [x, z];
  return null;
}

describe('Calibrage initial des services', () => {
  it('chaque service modélisé démarre à une qualité de 0,80 et reste stable sans intervention', () => {
    const S = fresh();
    for (const k of ['sante', 'education', 'securite', 'logement'] as const) expect(S.services[k]).toBeCloseTo(0.8, 2);
    run(S, 24);
    for (const k of ['sante', 'education', 'securite', 'logement'] as const) expect(Math.abs(S.services[k] - 0.8)).toBeLessThan(0.04);
    expect(S.accounts.spending.equipements).toBe(0);
  });
});

describe('Santé', () => {
  it('recruter des médecins prend du temps puis réduit le temps d\'attente', () => {
    const S = fresh();
    const d0 = S.health!.doctors.staff;
    const r = applyServiceAction(S, { type: 'recruter', service: 'sante', role: 'medecins', count: 3000 });
    expect(r.ok).toBe(true);
    expect(S.policy.budget.sante).toBeGreaterThan(base.policy.budget.sante); // les postes sont financés
    run(S, 2);
    expect(S.health!.doctors.staff).toBeLessThan(d0 + 500); // pas encore en poste
    run(S, 10);
    const R = ref(12);
    expect(S.health!.doctors.staff).toBeGreaterThan(R.health!.doctors.staff + 2500);
    expect(S.health!.waitDays).toBeLessThan(R.health!.waitDays - 2);
    expect(S.services.sante).toBeGreaterThan(R.services.sante);
  });

  it('une coupe budgétaire dégrade progressivement : départs non remplacés, approvisionnement, attente', () => {
    const S = withPolicy(fresh(), (p) => { p.budget.sante *= 0.6; });
    run(S, 3);
    const early = S.services.sante;
    run(S, 45);
    const R = ref(48);
    expect(S.services.sante).toBeLessThan(early);
    expect(S.health!.doctors.staff).toBeLessThan(R.health!.doctors.staff * 0.85);
    expect(S.health!.waitDays).toBeGreaterThan(R.health!.waitDays * 1.3);
  });
});

describe('Construction et urbanisme', () => {
  it('un programme apparaît aussitôt « en chantier », débite la trésorerie et n\'est en service qu\'après sa durée', () => {
    const S = fresh();
    const cityId = S.country.cities.find((c) => c.capital)?.id ?? 0;
    const beds0 = S.health!.installedBeds;
    const r = applyServiceAction(S, { type: 'programme', building: 'hopital', cityId, count: 1 });
    expect(r.ok).toBe(true);
    const inf = S.country.infra.find((i) => i.id === r.infraId)!;
    expect(inf.status).toBe('chantier');
    // emplacement choisi par le moteur : terre ferme et desservi
    expect(makeHeightFn(S.country)(inf.x, inf.z)).toBeGreaterThan(0.02);
    expect(roadDistance(S, inf.x, inf.z)).toBeLessThanOrEqual(BUILDINGS.hopital.maxRoad);
    const months = BUILDINGS.hopital.months;
    const R = fresh();
    run(S, months - 1);
    run(R, months - 1);
    expect(inf.status).toBe('chantier');
    expect(inf.progress).toBeGreaterThan(0.9);
    expect(S.health!.installedBeds).toBeLessThan(beds0 + 1);
    expect(S.finance.cash + S.finance.reserve - S.finance.debt).toBeLessThan(R.finance.cash + R.finance.reserve - R.finance.debt - (r.cost as number) * 0.8);
    run(S, 1);
    expect(inf.status).toBeUndefined();
    expect(S.health!.installedBeds).toBeGreaterThan(beds0 + BUILDINGS.hopital.capacity * 0.9);
    expect(S.construction!.sites.length).toBe(0);
  });

  it('les dépenses d\'équipement respectent l\'identité de trésorerie', () => {
    const S = fresh();
    applyServiceAction(S, { type: 'programme', building: 'lycee', cityId: 0, count: 2 });
    for (let i = 0; i < 6; i++) {
      const cash0 = S.finance.cash;
      const reserve0 = S.finance.reserve;
      const bonds0 = S.finance.bondsIssued.reduce((s, b) => s + b.amount, 0);
      tick(S);
      const issued = S.finance.bondsIssued.reduce((s, b) => s + b.amount, 0) - bonds0;
      expect(S.accounts.spending.equipements).toBeGreaterThan(0);
      expect(S.finance.cash - cash0).toBeCloseTo(S.accounts.balance / 12 + (reserve0 * S.macro.policyRate) / 12 + issued, -2);
    }
  });

  it('refuse un emplacement dans la mer ou loin des voies', () => {
    const S = fresh();
    const h = makeHeightFn(S.country);
    const sea = scan(S, (x, z) => h(x, z) <= 0.02 && !S.country.lakes.some((l) => Math.hypot(l.x - x, l.z - z) < l.r * 1.6));
    expect(sea).not.toBeNull();
    const a = validatePlacement(S, 'hopital', sea![0], sea![1]);
    expect(a.ok).toBe(false);
    expect(a.code).toBe('MER');
    const far = scan(S, (x, z) => validatePlacement(S, 'ecole', x, z).code === 'LOIN_ROUTE', 0.9);
    expect(far).not.toBeNull();
    const b = validatePlacement(S, 'ecole', far![0], far![1]);
    expect(b.ok).toBe(false);
    expect(b.msg).toMatch(/voie/);
    expect(applyServiceAction(S, { type: 'construire', building: 'ecole', x: far![0], z: far![1] }).ok).toBe(false);
    expect(validatePlacement(S, 'centrale_smr', 0, 0).code).toBe('TECHNOLOGIE');
  });
});

describe('Logement', () => {
  it('une offre insuffisante fait monter les prix, les loyers et la pression', () => {
    const S = run(withPolicy(fresh(), (p) => { p.housing.permits = 0.15; }), 72);
    const R = ref(72);
    expect(S.housing!.stock).toBeLessThan(R.housing!.stock);
    expect(S.housing!.tension).toBeGreaterThan(R.housing!.tension + 0.012);
    expect(S.housing!.avgPrice).toBeGreaterThan(R.housing!.avgPrice * 1.02);
    expect(S.housing!.avgRent).toBeGreaterThan(R.housing!.avgRent);
    expect(S.services.logement).toBeLessThan(R.services.logement - 0.05);
  });

  it('la taxe sur les logements vacants réduit la vacance', () => {
    const S = run(withPolicy(fresh(), (p) => { p.property.vacancyRate = 0.05; }), 24);
    const R = ref(24);
    expect(S.housing!.structuralVacancy).toBeLessThan(R.housing!.structuralVacancy);
    expect(S.housing!.tension).toBeLessThan(R.housing!.tension);
  });

  it('un plan de rénovation améliore la performance énergétique du parc', () => {
    const S = fresh();
    expect(applyServiceAction(S, { type: 'planLogement', kind: 'renovation', units: 200000, months: 24 }).ok).toBe(true);
    run(S, 24);
    const R = ref(24);
    expect(S.housing!.efficient).toBeGreaterThan(R.housing!.efficient + 0.03);
    expect(S.housing!.energyFactor).toBeLessThan(R.housing!.energyFactor);
  });
});

describe('Recherche', () => {
  it('une technologie ne se débloque qu\'après ses prérequis et sa durée minimale', () => {
    const S = fresh();
    const r1 = applyServiceAction(S, { type: 'rechercher', tech: 'batteries_avancees' });
    expect(r1.ok).toBe(false);
    expect(r1.code).toBe('PREREQUIS');
    expect(applyServiceAction(S, { type: 'rechercher', tech: 'reseaux_intelligents' }).ok).toBe(true);
    run(S, TECH_INDEX.reseaux_intelligents.months - 1);
    expect(S.research!.unlocked).not.toContain('reseaux_intelligents');
    run(S, 30);
    expect(S.research!.unlocked).toContain('reseaux_intelligents');
    expect(S.research!.effects.energy.gridLosses).toBeLessThan(1);
    expect(applyServiceAction(S, { type: 'rechercher', tech: 'batteries_avancees' }).ok).toBe(true);
  });

  it('un budget de recherche plus élevé accélère les programmes coûteux', () => {
    const slow = fresh();
    const fast = withPolicy(fresh(), (p) => { p.budget.recherche *= 3; });
    for (const S of [slow, fast]) applyServiceAction(S, { type: 'rechercher', tech: 'materiaux_bas_carbone' });
    run(slow, 30); run(fast, 30);
    for (const S of [slow, fast]) applyServiceAction(S, { type: 'rechercher', tech: 'capture_carbone' });
    run(slow, 15); run(fast, 15);
    expect(fast.research!.progress.capture_carbone ?? 0).toBeGreaterThan(slow.research!.progress.capture_carbone ?? 0);
  });
});

describe('Sécurité', () => {
  it('plus de policiers réduisent la criminalité', () => {
    const S = fresh();
    expect(applyServiceAction(S, { type: 'recruter', service: 'securite', role: 'policiers', count: 4000 }).ok).toBe(true);
    run(S, 48);
    const R = ref(48);
    expect(S.security!.police.staff).toBeGreaterThan(R.security!.police.staff * 1.08);
    expect(S.security!.crimeRate).toBeLessThan(R.security!.crimeRate * 0.98);
    expect(S.security!.policeResponse).toBeLessThan(R.security!.policeResponse);
  });

  it('le chômage fait monter la criminalité', () => {
    const S = run(withPolicy(fresh(), (p) => { p.labour.minWage = 3200; }), 48);
    const R = ref(48);
    expect(S.demography.unemployed / S.demography.labourForce).toBeGreaterThan(R.demography.unemployed / R.demography.labourForce);
    expect(S.security!.crimeRate).toBeGreaterThan(R.security!.crimeRate);
  });
});

describe('Éducation', () => {
  it('le recrutement d\'enseignants améliore la qualité puis, lentement, le capital humain', () => {
    const S = fresh();
    expect(applyServiceAction(S, { type: 'recruter', service: 'education', role: 'enseignants', count: 12000 }).ok).toBe(true);
    run(S, 60);
    const R = ref(60);
    expect(S.education!.pupilsPerTeacher).toBeLessThan(R.education!.pupilsPerTeacher);
    expect(S.services.education).toBeGreaterThan(R.services.education + 0.01);
    expect(S.education!.dropout).toBeLessThan(R.education!.dropout);
    expect(S.education!.humanCapital).toBeGreaterThan(R.education!.humanCapital);
  });
});
