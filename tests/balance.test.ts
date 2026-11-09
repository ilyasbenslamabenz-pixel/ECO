// Non-régression de l'équilibre de jeu : des joueurs-robots déterministes (tests/playtestLib.ts) jouent plusieurs
// années et l'on vérifie, avec des bornes LARGES, les grandes intentions de design (docs/EQUILIBRAGE.md) :
// l'inaction est sanctionnée, un joueur actif réussit environ une mission sur deux, le jalon climat 2035 est à portée
// d'un jeu équilibré et le jalon 2050 d'un jeu expert, la dépense sans compter mène au défaut, l'austérité est viable mais
// coûteuse, aucune stratégie isolée ne suffit, et la satisfaction réagit lisiblement aux décisions. Ces tests ne figent pas des valeurs exactes : un réglage qui les fait échouer change l'expérience de jeu.
import { beforeAll, describe, expect, it } from 'vitest';
import { applyServiceAction, schedulePolicy, tick } from '../shared/sim/engine';
import { newGame, runStrategy, type RunResult, type Strategy } from './playtestLib';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const R = {} as Record<Strategy, RunResult>;
const lostElectionAt = (r: RunResult) => r.defeats.find((d) => d.reason === 'elections')?.month ?? Infinity;

beforeAll(() => {
  R.passif = runStrategy('passif', 16);
  R.besoins = runStrategy('besoins', 16);
  R.climat = runStrategy('climat', 16);
  R.equilibre = runStrategy('equilibre', 22); // jusqu'au bilan du jalon 2050 (décembre 2050)
  R.expert = runStrategy('expert', 22);
  R.austerite = runStrategy('austerite', 8);
  R.depensier = runStrategy('depensier', 10);
}, 240_000);

describe('équilibre : inaction et stratégies isolées', () => {
  it('le joueur passif stagne : peu de missions, jalon 2035 manqué, élection perdue entre 6 et 14 ans', () => {
    const r = R.passif;
    expect(r.successRate).toBeLessThan(0.3);
    expect(r.milestones[2035]).toBe('manque');
    expect(lostElectionAt(r)).toBeGreaterThanOrEqual(6 * 12);
    expect(lostElectionAt(r)).toBeLessThanOrEqual(14 * 12);
    // sanctionné sans être injouable : pas de défaut de paiement ni d'émeutes
    expect(r.defeats.some((d) => d.reason !== 'elections')).toBe(false);
  });

  it('suivre seulement les besoins ou seulement le plan climat donne des résultats partiels', () => {
    for (const r of [R.besoins, R.climat]) {
      expect(r.successRate).toBeGreaterThan(R.passif.successRate);
      expect(r.successRate).toBeLessThan(R.equilibre.successRate);
    }
    expect(R.besoins.milestones[2035]).toBe('manque'); // les besoins seuls ne décarbonent pas assez
    expect(R.climat.milestoneGap[2035]).toBeLessThan(6); // les cartes seules approchent le jalon 2035…
    expect(R.climat.successRate).toBeLessThan(0.4); // … mais délaissent les autres missions
  });

  it('dépenser sans compter mène au défaut de paiement', () => {
    const r = R.depensier;
    expect(r.maxDebt).toBeGreaterThan(1.2);
    expect(r.defeats.some((d) => d.reason === 'defaut')).toBe(true);
  });

  it('l\'austérité est viable mais coûteuse : impopulaire, elle passe la première élection et perd la suivante', () => {
    const r = R.austerite;
    expect(r.at[5].satisfaction).toBeLessThan(R.passif.at[5].satisfaction - 3);
    expect(lostElectionAt(r)).toBeGreaterThan(4 * 12); // les comptes redressés lui valent le crédit des électeurs centristes
    expect(lostElectionAt(r)).toBeLessThanOrEqual(8 * 12);
    expect(r.at[5].debt).toBeLessThan(R.passif.at[5].debt - 0.03); // … et elle désendette
  });
});

describe('équilibre : joueur actif', () => {
  it('le joueur équilibré réussit environ une mission sur deux, en un an environ', () => {
    const r = R.equilibre;
    expect(r.successRate).toBeGreaterThan(0.35);
    expect(r.successRate).toBeLessThan(0.75);
    expect(r.meanDelay).toBeGreaterThan(4);
    expect(r.meanDelay).toBeLessThan(20);
  });

  it('premier trophée dans les 24 premiers mois, progression de titre mesurée', () => {
    const r = R.equilibre;
    expect(r.firstTrophy).not.toBeNull();
    expect(r.firstTrophy!).toBeLessThanOrEqual(24);
    expect(r.at[10].titleIndex).toBeGreaterThanOrEqual(3); // au moins Ministre délégué à 10 ans
    expect(r.at[10].titleIndex).toBeLessThanOrEqual(5); // pas encore Chef d'État
    expect(R.passif.at[10].titleIndex).toBeLessThan(r.at[10].titleIndex);
  });

  it('le jalon 2035 est à portée et la majorité tient plus longtemps que sans rien faire', () => {
    const r = R.equilibre;
    expect(r.milestoneGap[2035]).toBeLessThan(3);
    expect(lostElectionAt(r)).toBeGreaterThan(lostElectionAt(R.passif));
    expect(r.defeats.some((d) => d.reason === 'defaut')).toBe(false);
    expect(r.maxDebt).toBeLessThan(1.0);
    // le joueur expert fait mieux que l'équilibré, sans garantie absolue
    expect(R.expert.successRate).toBeGreaterThan(r.successRate);
  });

  it('facteur 4 : le joueur expert atteint le jalon 2050, le joueur équilibré s\'en approche', () => {
    expect(R.expert.milestones[2050]).toBe('atteint');
    expect(R.equilibre.milestoneGap[2050]).toBeLessThan(5); // « proche » au moins
    expect(R.passif.milestones[2035]).toBe('manque');
    expect(R.expert.defeats.some((d) => d.reason === 'defaut')).toBe(false);
  });

  it('les crises restent occasionnelles (≈ 0,3 à 1 par an)', () => {
    for (const r of [R.passif, R.equilibre]) {
      expect(r.crises / r.years).toBeGreaterThan(0.2);
      expect(r.crises / r.years).toBeLessThan(1.2);
    }
  });
});

describe('équilibre : retour rapide des décisions', () => {
  it('la satisfaction réagit aux décisions : effet d\'annonce en 3 mois, effet de fond à 12 mois', () => {
    const A = newGame();
    for (let i = 0; i < 3; i++) tick(A);
    const B = clone(A);
    const C = clone(A);
    expect(applyServiceAction(B, { type: 'recruter', service: 'sante', role: 'medecins', count: Math.round(B.health!.doctors.staff * 0.08) }).ok).toBe(true);
    applyServiceAction(C, { type: 'recruter', service: 'securite', role: 'policiers', count: Math.round(C.security!.police.staff * 0.08) });
    tick(A); tick(B); tick(C);
    // le mois suivant, la décision apparaît dans « pourquoi la satisfaction bouge »
    const d = B.satisfaction.drivers!.find((x) => x.id === 'sante')!;
    expect(d.announce).toBeGreaterThan(0.2);
    expect(d.delta).toBeGreaterThan(0.05);
    for (let i = 0; i < 2; i++) { tick(A); tick(B); tick(C); }
    expect(B.satisfaction.overall - A.satisfaction.overall).toBeGreaterThan(0.3); // 3 mois (moteur d'origine : +0,01)
    for (let i = 0; i < 9; i++) { tick(A); tick(B); tick(C); }
    expect(B.satisfaction.overall - A.satisfaction.overall).toBeGreaterThan(0.8); // 12 mois (moteur d'origine : +0,2)
    expect(C.satisfaction.overall - A.satisfaction.overall).toBeGreaterThan(0.4); // 12 mois (moteur d'origine : +0,09)
  });

  it('le calibrage de départ est intact : ressenti = mesuré à la création, pas d\'impulsion', () => {
    const S = newGame();
    for (const [k, v] of Object.entries(S.satisfaction.factors)) expect(S.satisfaction.felt![k]).toBeCloseTo(v, 9);
    expect(S.satisfaction.overall).toBeCloseTo(65.8, 0);
    for (const d of S.satisfaction.drivers!) { expect(d.level).toBeCloseTo(0, 9); expect(d.announce).toBeCloseTo(0, 9); }
  });

  it('une coupe budgétaire est ressentie tout de suite, puis l\'accoutumance en absorbe une partie', () => {
    const A = newGame();
    for (let i = 0; i < 3; i++) tick(A);
    const B = clone(A);
    const p = clone(B.policy);
    for (const k of Object.keys(p.budget) as (keyof typeof p.budget)[]) p.budget[k] *= 0.96;
    schedulePolicy(B, p);
    const gap: number[] = [];
    for (let m = 1; m <= 48; m++) { tick(A); tick(B); gap[m] = B.satisfaction.overall - A.satisfaction.overall; }
    expect(gap[3]).toBeLessThan(-0.8);
    expect(gap[48]).toBeGreaterThan(gap[12]); // accoutumance : la colère retombe en partie
  });

  it('un recrutement de médecins proposé par le diagnostic améliore les soins en moins d\'un an', () => {
    const A = newGame();
    for (let i = 0; i < 3; i++) tick(A);
    const B = clone(A);
    const n = Math.round(B.health!.doctors.staff * 0.08);
    expect(applyServiceAction(B, { type: 'recruter', service: 'sante', role: 'medecins', count: n }).ok).toBe(true);
    for (let i = 0; i < 9; i++) { tick(A); tick(B); }
    expect(B.health!.ratio).toBeGreaterThan(A.health!.ratio + 0.01);
    expect(B.health!.waitDays).toBeLessThan(A.health!.waitDays - 1);
  });
});
