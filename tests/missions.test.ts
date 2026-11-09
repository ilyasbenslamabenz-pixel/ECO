// Tests des missions et de la progression du joueur : génération déterministe à partir des besoins, avancement,
// récompense à la réussite, pénalité à l'échec, trophées, retours « avant → après », bilan annuel, migration.
import { describe, expect, it } from 'vitest';
import { applyServiceAction, createGame, migrate, tick } from '../shared/sim/engine';
import { METRICS, TROPHIES, missionsPre, missionsStep, titleOf, type Mission } from '../shared/sim/missions';
import type { GameState } from '../shared/sim/types';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const base = createGame();
const fresh = (): GameState => clone(base);
const run = (S: GameState, months: number) => { for (let i = 0; i < months; i++) tick(S); return S; };

/** Remplace la première mission active par une mission de satisfaction contrôlée (60 → 70). */
function controlled(S: GameState): Mission {
  const M = S.missions!;
  const m: Mission = {
    ...M.active[0], metric: 'satisfaction', start: 60, target: 70, value: 60, progress: 0, startMonth: S.month, deadline: S.month + 12, status: 'active',
  };
  M.active = [m, ...M.active.slice(1).filter((x) => x.metric !== 'satisfaction')];
  return m;
}

describe('missions', () => {
  it('trois missions actives, générées de façon déterministe à partir de l\'état', () => {
    const a = createGame(), b = createGame();
    expect(a.missions!.active).toHaveLength(3);
    expect(JSON.stringify(a.missions!.active)).toBe(JSON.stringify(b.missions!.active));
    const metrics = new Set(a.missions!.active.map((m) => m.metric));
    expect(metrics.size).toBe(3); // pas deux missions sur le même indicateur
    for (const m of a.missions!.active) {
      expect(m.title).toMatch(/d'ici [a-zéû]+ \d{4}$/);
      expect(m.deadline - m.startMonth).toBeGreaterThanOrEqual(6);
      expect(m.deadline - m.startMonth).toBeLessThanOrEqual(24);
      expect(Number.isFinite(m.start) && Number.isFinite(m.target)).toBe(true);
      expect(m.start).not.toBe(m.target);
      expect(m.reward.xp).toBeGreaterThan(0);
      expect(m.reward.cash).toBeGreaterThan(0);
      expect(METRICS[m.metric]).toBeDefined();
    }
    // le besoin urgent du départ (électricité verte, niveau 2) donne une mission ciblée
    expect(a.missions!.active.some((m) => m.source === 'besoin' && m.needId === 'verte')).toBe(true);
    // la simulation reste déterministe avec les missions
    const x = run(fresh(), 14), y = run(fresh(), 14);
    expect(JSON.stringify(x.missions)).toBe(JSON.stringify(y.missions));
    expect(x.missions!.active).toHaveLength(3);
  });

  it('calcule la progression entre la valeur de départ et la cible', () => {
    const S = run(fresh(), 1);
    const m = controlled(S);
    const pre = missionsPre(S);
    S.satisfaction.overall = 65;
    missionsStep(S, pre);
    expect(m.value).toBe(65);
    expect(m.progress).toBeCloseTo(0.5, 6);
    expect(m.status).toBe('active');
  });

  it('applique la récompense quand la cible est atteinte', () => {
    const S = run(fresh(), 1);
    const m = controlled(S);
    const M = S.missions!;
    const trust0 = 50;
    S.satisfaction.trust = trust0;
    const cash0 = S.finance.cash, xp0 = M.xp, won0 = M.won;
    const coal = S.politics!.parties.filter((p) => S.politics!.coalition.includes(p.id));
    const mood0 = coal.map((p) => p.mood);
    const pre = missionsPre(S);
    S.satisfaction.overall = 71;
    missionsStep(S, pre);
    expect(m.status).toBe('reussie');
    expect(M.won).toBe(won0 + 1);
    expect(M.xp).toBeGreaterThanOrEqual(xp0 + m.reward.xp);
    expect(S.satisfaction.trust).toBeCloseTo(trust0 + m.reward.trust, 6);
    expect(S.finance.cash).toBeCloseTo(cash0 + m.reward.cash, 0);
    coal.forEach((p, k) => expect(p.mood).toBeGreaterThan(mood0[k]));
    expect(S.notices.some((n) => n.title.includes('Mission réussie'))).toBe(true);
    expect(M.history.at(-1)).toBe(m);
    expect(M.active).toHaveLength(3); // une nouvelle mission remplace la mission réussie
    expect(M.active.some((x) => x.metric === 'satisfaction')).toBe(false); // délai avant de reproposer le même indicateur
  });

  it('applique une petite pénalité à l\'échéance si la cible n\'est pas atteinte', () => {
    const S = run(fresh(), 1);
    const m = controlled(S);
    const M = S.missions!;
    S.satisfaction.trust = 50;
    const cash0 = S.finance.cash;
    S.month = m.deadline;
    const pre = missionsPre(S);
    S.satisfaction.overall = 62;
    missionsStep(S, pre);
    expect(m.status).toBe('echouee');
    expect(M.failed).toBeGreaterThanOrEqual(1);
    expect(M.streak).toBe(0);
    expect(S.satisfaction.trust).toBeCloseTo(50 - m.penalty.trust, 6);
    expect(m.penalty.trust).toBeLessThanOrEqual(2); // pénalité modeste
    expect(S.finance.cash).toBe(cash0);
    expect(S.notices.some((n) => n.title === 'Mission échouée')).toBe(true);
    expect(M.active).toHaveLength(3);
  });

  it('débloque les trophées et fait monter le titre', () => {
    const S = run(fresh(), 1);
    const M = S.missions!;
    expect(M.trophies.vert_50).toBeUndefined();
    const xp0 = M.xp;
    S.energy!.elecRenShare = 0.55;
    M.won = 10;
    const pre = missionsPre(S);
    missionsStep(S, pre);
    expect(M.trophies.vert_30).toBe(S.month);
    expect(M.trophies.vert_50).toBe(S.month);
    expect(M.trophies.missions_10).toBe(S.month);
    expect(M.trophies.vert_80).toBeUndefined();
    const gained = ['vert_30', 'vert_50', 'missions_10', 'premiere_mission'].reduce((s, id) => s + TROPHIES.find((t) => t.id === id)!.xp, 0);
    expect(M.xp).toBeGreaterThanOrEqual(xp0 + gained);
    expect(titleOf(M.xp).index).toBeGreaterThan(0);
    expect(M.titleIndex).toBe(titleOf(M.xp).index);
    expect(S.notices.some((n) => n.title.includes('Trophée : Moitié verte'))).toBe(true);
    expect(S.notices.some((n) => n.title.includes('Promotion'))).toBe(true);
    // un trophée n'est obtenu qu'une fois
    const n = S.notices.filter((x) => x.title.includes('Moitié verte')).length;
    missionsStep(S, missionsPre(S));
    expect(S.notices.filter((x) => x.title.includes('Moitié verte')).length).toBe(n);
  });

  it('publie un retour « avant → après » à la mise en service d\'un équipement, puis un suivi à 3 mois', () => {
    const S = run(fresh(), 1);
    const r = applyServiceAction(S, { type: 'programme', building: 'lycee', cityId: 0, count: 2 });
    expect(r.ok).toBe(true);
    let fb: NonNullable<GameState['missions']>['feedback'][number] | undefined;
    for (let i = 0; i < 60 && !fb; i++) { tick(S); fb = S.missions!.feedback.find((f) => f.kind === 'chantier'); }
    expect(fb).toBeDefined();
    expect(fb!.text).toMatch(/en service : \+1\s?200 élèves/u);
    expect(fb!.text).toMatch(/occupation des écoles [\d,]+ % → [\d,]+ %/);
    expect(S.missions!.trophies.premier_chantier).toBeDefined();
    run(S, 3);
    expect(S.missions!.feedback.some((f) => f.kind === 'suivi' && f.text.startsWith('3 mois après'))).toBe(true);
  });

  it('produit un bilan annuel en janvier', () => {
    const S = run(fresh(), 12);
    const R = S.missions!.review!;
    expect(R).toBeTruthy();
    expect(R.year).toBe(S.startYear);
    expect(R.month).toBe(12);
    const ids = R.rows.map((r) => r.metric);
    for (const id of ['emissions', 'pib', 'chomage', 'satisfaction', 'dette']) expect(ids).toContain(id);
    for (const mv of R.moves) expect(mv.cause.length).toBeGreaterThan(5);
    expect(S.missions!.yearStart.month).toBe(12);
  });

  it('migre une ancienne sauvegarde sans missions', () => {
    const S = run(fresh(), 3);
    delete (S as Partial<GameState>).missions;
    migrate(S);
    expect(S.missions!.active).toHaveLength(3);
    expect(S.missions!.xp).toBe(0);
    run(S, 2);
    expect(S.missions!.active).toHaveLength(3);
    // une sauvegarde sans missions passée directement au pas mensuel est aussi complétée
    const T = run(fresh(), 2);
    delete (T as Partial<GameState>).missions;
    tick(T);
    expect(T.missions!.active).toHaveLength(3);
  });
});
