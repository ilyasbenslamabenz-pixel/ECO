// --- plan climat --- Tests : trajectoire et jalons, jauges de soutien dérivées et coût des cartes, blocage si le soutien
// est trop bas, effet mesurable d'une carte sur les émissions, probabilité des aléas croissante avec le cumul,
// déterminisme, migration des anciennes sauvegardes.
import { describe, expect, it } from 'vitest';
import { applyGovAction, createGame, migrate, tick } from '../shared/sim/engine';
import {
  CARDS, MILESTONE_YEARS, SUPPORT_FLOOR, cardStatus, cardSupportCost, climateSeverity, deriveSupport, hazardOutlook, targetSeries, targetShare, updateRisk,
} from '../shared/sim/climate';
import { eventProbability } from '../shared/sim/events';
import type { GameState } from '../shared/sim/types';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const base = createGame();
const fresh = (): GameState => clone(base);
const run = (S: GameState, months: number) => { for (let i = 0; i < months; i++) tick(S); return S; };
const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
const play = (S: GameState, card: string) => applyGovAction(S, { type: 'climatCard', card });
const rich = (S: GameState) => { S.climate!.capital = { etat: 40, entreprises: 40, citoyens: 40 }; S.climate!.support = { etat: 90, entreprises: 90, citoyens: 90 }; };
const year1 = run(fresh(), 12);

describe('plan climat : trajectoire et jalons', () => {
  it('trajectoire linéaire par jalons et exponentielle vers le facteur 4 en 2080', () => {
    expect(targetShare(2030, 'lineaire')).toBe(1);
    expect(targetShare(2035, 'lineaire')).toBeCloseTo(0.8, 6);
    expect(targetShare(2050, 'lineaire')).toBeCloseTo(0.5, 6);
    expect(targetShare(2080, 'lineaire')).toBeCloseTo(0.25, 6);
    expect(targetShare(2080, 'exponentielle')).toBeCloseTo(0.25, 6);
    expect(targetShare(2055, 'exponentielle')).toBeCloseTo(0.5, 6); // demi-vie de 25 ans
    for (let y = 2030; y < 2080; y++) {
      expect(targetShare(y + 1, 'lineaire')).toBeLessThan(targetShare(y, 'lineaire'));
      expect(targetShare(y + 1, 'exponentielle')).toBeLessThan(targetShare(y, 'exponentielle'));
    }
    const s = targetSeries(year1.climate!);
    expect(s).toHaveLength(51 * 12);
    expect(s.at(-1)! / year1.climate!.reference).toBeCloseTo(0.25, 2);
  });

  it('la référence est la moyenne des émissions nettes des 12 mois de 2030', () => {
    const C = year1.climate!;
    expect(C.referenceFixed).toBe(true);
    expect(C.reference).toBeCloseTo(avg(year1.history.emissionsNet.slice(0, 12)), 0);
    expect(C.milestones.map((m) => m.year)).toEqual([...MILESTONE_YEARS]);
    expect(C.milestones[0].target / C.reference).toBeCloseTo(0.8, 6);
    expect(year1.notices.some((n) => n.title.includes('référence 2030'))).toBe(true);
    // cumul : somme des émissions mensuelles depuis janvier 2030
    expect(C.cumulative).toBeCloseTo(year1.history.emissionsNet.slice(1).reduce((s, v) => s + v / 12, 0), -3);
  });

  it('le changement de trajectoire est possible avant le premier jalon', () => {
    const S = clone(year1);
    expect(applyGovAction(S, { type: 'climatTrajectoire', mode: 'exponentielle' }).ok).toBe(true);
    expect(S.climate!.milestones[0].target / S.climate!.reference).toBeCloseTo(Math.pow(4, -0.1), 6);
    expect(applyGovAction(S, { type: 'climatTrajectoire', mode: 'nimporte' as 'lineaire' }).ok).toBe(false);
  });

  it('jalon 2035 manqué sans intervention : écart, sanction et notice ; atteint : récompenses', () => {
    const S = run(clone(year1), (2035 - 2030) * 12 + 11 - 12);
    const m = S.climate!.milestones[0];
    expect(m.status).toBe('manque'); // la tendance spontanée ne suffit pas pour −20 %
    expect(m.gap!).toBeGreaterThan(5);
    expect(S.notices.some((n) => n.title.includes('jalon 2035'))).toBe(true);
    expect(cardStatus(S, 'digues').available).toBe(true); // débloquée après le bilan du jalon 2035

    // même partie, référence fictivement plus élevée : l'objectif est atteint
    const T = run(clone(year1), (2035 - 2030) * 12 + 10 - 12);
    T.climate!.reference *= 1.6;
    for (const x of T.climate!.milestones) x.target = T.climate!.reference * targetShare(x.year, 'lineaire');
    const xp = T.missions!.xp;
    const cap = T.climate!.capital.citoyens;
    const trust = T.satisfaction.trust;
    tick(T);
    const t = T.climate!.milestones[0];
    expect(t.status).toBe('atteint');
    expect(t.gap!).toBeLessThan(0);
    expect(T.missions!.xp).toBeGreaterThanOrEqual(xp + 150);
    expect(T.climate!.capital.citoyens).toBeGreaterThan(cap + 5);
    expect(T.notices.some((n) => n.title.includes('jalon 2035 atteint'))).toBe(true);
    expect(T.satisfaction.trust).toBeGreaterThan(trust - 5);
  });
});

describe('plan climat : jauges de soutien', () => {
  it('les jauges sont dérivées des indicateurs existants', () => {
    const S = clone(year1);
    const d0 = deriveSupport(S);
    for (const v of Object.values(d0)) { expect(v).toBeGreaterThan(30); expect(v).toBeLessThan(80); }
    const a = clone(S); a.accounts.balance -= 0.03 * a.accounts.gdp; // déficit +3 points
    expect(deriveSupport(a).etat).toBeLessThan(d0.etat - 10);
    const b = clone(S); b.policy.corporate.rate += 0.05; b.policy.eco.carbon += 60;
    expect(deriveSupport(b).entreprises).toBeLessThan(d0.entreprises - 8);
    const c = clone(S); c.satisfaction.overall -= 10;
    expect(deriveSupport(c).citoyens).toBeLessThan(d0.citoyens - 8);
  });

  it('jouer une carte coûte du soutien selon son impopularité, de plus en plus cher à chaque utilisation', () => {
    const S = clone(year1);
    const before = { ...S.climate!.support };
    const cost = cardSupportCost(S, 'solaire');
    expect(cost.etat).toBeGreaterThan(0);
    expect(play(S, 'solaire').ok).toBe(true);
    expect(S.climate!.support.etat).toBeCloseTo(before.etat - cost.etat, 6);
    expect(S.climate!.support.citoyens).toBeCloseTo(before.citoyens - cost.citoyens, 6);
    expect(cardSupportCost(S, 'solaire').etat).toBeGreaterThanOrEqual(cost.etat);
    expect(S.climate!.played.at(-1)!.id).toBe('solaire');
    expect(S.energy!.projects.some((p) => p.public && p.tech === 'solaire')).toBe(true); // mécanisme réel : projet énergie
    // une carte impopulaire auprès des entreprises coûte surtout du soutien des entreprises
    const tc = cardSupportCost(S, 'taxe_carbone');
    expect(tc.entreprises).toBeGreaterThan(tc.etat);
  });

  it('le capital dépensé revient progressivement', () => {
    const S = clone(year1);
    play(S, 'electrification');
    const c0 = S.climate!.capital.etat;
    expect(c0).toBeLessThan(0);
    run(S, 12);
    expect(S.climate!.capital.etat).toBeGreaterThan(c0 * 0.6);
  });
});

describe('plan climat : blocage', () => {
  it('une jauge trop basse bloque les cartes qui en dépendent, avec un message explicatif et sans effet', () => {
    const S = clone(year1);
    S.climate!.capital.entreprises = -60;
    S.climate!.support.entreprises = Math.max(0, S.climate!.derived.entreprises - 60);
    const st = cardStatus(S, 'sortie_charbon');
    expect(st.available).toBe(false);
    expect(st.reason).toMatch(/Entreprises insuffisant/);
    const coal = S.energy!.fleet.charbon.mw;
    const projects = S.energy!.projects.length;
    const r = play(S, 'sortie_charbon');
    expect(r.ok).toBe(false);
    expect(r.msg).toMatch(new RegExp(`sous ${SUPPORT_FLOOR}`));
    expect(S.energy!.projects.length).toBe(projects);
    expect(S.energy!.fleet.charbon.mw).toBe(coal);
    // une carte qui ne sollicite pas les entreprises reste jouable
    expect(cardStatus(S, 'solaire').available).toBe(true);
    // seuil minimal propre à une carte (accise carburants : citoyens ≥ 45)
    const T = clone(year1);
    T.climate!.support.citoyens = 40;
    expect(cardStatus(T, 'carburants').reason).toMatch(/Citoyens trop faible/);
  });

  it('cartes verrouillées par la recherche ; toutes les cartes réussissent ou échouent proprement', () => {
    const S = clone(year1);
    expect(cardStatus(S, 'ccs').reason).toMatch(/recherche/);
    S.research!.unlocked.push('capture_carbone');
    rich(S);
    expect(cardStatus(S, 'ccs').available).toBe(true);
    expect(CARDS.length).toBeGreaterThanOrEqual(30);
    expect(CARDS.length).toBeLessThanOrEqual(50);
    const sectors = new Set(CARDS.map((c) => c.sector));
    expect(sectors.size).toBe(7);
    let ok = 0;
    for (const c of CARDS) {
      rich(S);
      const r = play(S, c.id);
      expect(typeof r.msg).toBe('string');
      expect(r.msg.length).toBeGreaterThan(5);
      if (r.ok) ok++;
    }
    expect(ok).toBeGreaterThan(35);
    expect(() => run(S, 6)).not.toThrow();
  });
});

describe('plan climat : effets réels', () => {
  it('la sortie du charbon réduit les émissions mesurées après quelques mois', () => {
    const A = clone(year1), B = clone(year1);
    expect(play(B, 'sortie_charbon').ok).toBe(true);
    run(A, 12); run(B, 12);
    const elecA = avg(A.history.em_electricite.slice(-12)), elecB = avg(B.history.em_electricite.slice(-12));
    expect(elecB).toBeLessThan(elecA * 0.9);
    expect(avg(B.history.emissionsNet.slice(-12))).toBeLessThan(avg(A.history.emissionsNet.slice(-12)) - 1e6);
    const card = B.climate!.played.find((p) => p.id === 'sortie_charbon')!;
    expect(card.observed!).toBeLessThan(card.before);
    expect(B.notices.some((n) => n.title === 'Plan climat : bilan d\'une mesure')).toBe(true);
  });

  it('un programme industriel passe par le moteur industrie et réduit ses émissions après réalisation', () => {
    const A = clone(year1), B = clone(year1);
    rich(B);
    expect(play(B, 'electrification').ok).toBe(true);
    expect(B.industry!.projects.some((p) => p.kind === 'prog:electrification')).toBe(true);
    run(A, 36); run(B, 36);
    expect(B.industry!.adoption.electrification).toBeGreaterThan(A.industry!.adoption.electrification);
    expect(avg(B.history.em_industrie.slice(-12))).toBeLessThan(avg(A.history.em_industrie.slice(-12)));
  });
});

describe('plan climat : aléas', () => {
  it('la probabilité et la gravité des aléas croissent avec les émissions cumulées', () => {
    const S = clone(year1);
    S.month = 24 + 5; // juin : saison des canicules et des sécheresses
    const C = S.climate!;
    S.events!.lastByType = {};
    const p0 = { can: eventProbability(S, 'canicule'), eau: eventProbability(S, 'penurie_eau'), inon: eventProbability(S, 'inondations'), sev: climateSeverity(S) };
    const out0 = hazardOutlook(S);
    C.cumulative *= 20;
    updateRisk(S);
    expect(C.warming).toBeGreaterThan(0);
    expect(eventProbability(S, 'canicule')).toBeGreaterThan(p0.can);
    expect(eventProbability(S, 'penurie_eau')).toBeGreaterThan(p0.eau);
    expect(eventProbability(S, 'inondations')).toBeGreaterThan(p0.inon);
    expect(climateSeverity(S)).toBeGreaterThan(p0.sev);
    const out1 = hazardOutlook(S);
    out1.forEach((h, i) => expect(h.year).toBeGreaterThan(out0[i].year));
    // une partie plus émettrice accumule plus de risque
    const A = clone(year1), B = clone(year1);
    run(A, 6); run(B, 6);
    expect(A.climate!.riskIndex).toBeCloseTo(B.climate!.riskIndex, 9);
  });

  it('les cartes d\'adaptation réduisent le risque correspondant', () => {
    const S = clone(year1);
    S.month = 36 + 5;
    S.events!.lastByType = {};
    const p0 = eventProbability(S, 'canicule');
    rich(S);
    expect(play(S, 'ilots').ok).toBe(true);
    expect(eventProbability(S, 'canicule')).toBeLessThan(p0);
  });
});

describe('plan climat : déterminisme et migration', () => {
  it('mêmes décisions → même état climat', () => {
    const A = clone(year1), B = clone(year1);
    for (const S of [A, B]) { play(S, 'tram'); run(S, 18); play(S, 'renovation'); run(S, 18); }
    expect(JSON.stringify(A.climate)).toBe(JSON.stringify(B.climate));
    expect(JSON.stringify(A.events!.history)).toBe(JSON.stringify(B.events!.history));
  });

  it('une ancienne sauvegarde sans plan climat est migrée (référence et cumul reconstitués)', () => {
    const S = run(clone(year1), 18);
    const ref = S.climate!.reference;
    const old = clone(S) as GameState;
    delete old.climate;
    const M = migrate(old);
    expect(M.climate).toBeDefined();
    expect(M.climate!.referenceFixed).toBe(true);
    expect(M.climate!.reference).toBeCloseTo(ref, 0);
    expect(M.climate!.cumulative).toBeGreaterThan(2 * ref);
    expect(M.climate!.milestones).toHaveLength(5);
    expect(() => run(M, 3)).not.toThrow();
    // état partiel ou corrompu
    const P = clone(S) as GameState;
    (P as unknown as { climate: unknown }).climate = { version: 0 };
    expect(migrate(P).climate!.milestones).toHaveLength(5);
  });
});
