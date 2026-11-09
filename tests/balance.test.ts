// Non-régression de l'équilibre de jeu : des joueurs-robots déterministes (tests/playtestLib.ts) jouent plusieurs
// années et l'on vérifie, avec des bornes LARGES, les grandes intentions de design (docs/EQUILIBRAGE.md) :
// l'inaction est sanctionnée, un joueur actif réussit environ une mission sur deux, le jalon climat 2035 est à portée
// d'un jeu équilibré, la dépense sans compter mène au défaut, l'austérité est impopulaire, aucune stratégie isolée ne
// suffit. Ces tests ne figent pas des valeurs exactes : un réglage qui les fait échouer change l'expérience de jeu.
import { beforeAll, describe, expect, it } from 'vitest';
import { applyServiceAction, tick } from '../shared/sim/engine';
import { newGame, runStrategy, type RunResult, type Strategy } from './playtestLib';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const R = {} as Record<Strategy, RunResult>;
const lostElectionAt = (r: RunResult) => r.defeats.find((d) => d.reason === 'elections')?.month ?? Infinity;

beforeAll(() => {
  R.passif = runStrategy('passif', 16);
  R.besoins = runStrategy('besoins', 16);
  R.climat = runStrategy('climat', 16);
  R.equilibre = runStrategy('equilibre', 16);
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

  it('l\'austérité est impopulaire', () => {
    const r = R.austerite;
    expect(r.at[5].satisfaction).toBeLessThan(R.passif.at[5].satisfaction - 3);
    expect(lostElectionAt(r)).toBeLessThanOrEqual(8 * 12);
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
  });

  it('les crises restent occasionnelles (≈ 0,3 à 1 par an)', () => {
    for (const r of [R.passif, R.equilibre]) {
      expect(r.crises / r.years).toBeGreaterThan(0.2);
      expect(r.crises / r.years).toBeLessThan(1.2);
    }
  });
});

describe('équilibre : retour rapide des décisions', () => {
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
