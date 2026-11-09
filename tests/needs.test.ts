// Tests du diagnostic « Besoins du pays » : chaque besoin est calculé, ses actions sont exécutables par le moteur,
// et agir sur un besoin change réellement les indicateurs (les décisions ont un effet mesurable).
import { describe, expect, it } from 'vitest';
import { applyAction, applyServiceAction, createGame, tick } from '../shared/sim/engine';
import { assessNeeds, type NeedAction } from '../shared/sim/needs';
import type { GameState } from '../shared/sim/types';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const base = createGame();
const fresh = (): GameState => clone(base);
const run = (S: GameState, months: number) => { for (let i = 0; i < months; i++) tick(S); return S; };

describe('besoins du pays', () => {
  it('diagnostique tous les domaines au départ, sans tout déclarer urgent', () => {
    const S = run(fresh(), 1);
    const needs = assessNeeds(S);
    const ids = needs.map((n) => n.id);
    for (const id of ['ecoles', 'sante', 'logement', 'electricite', 'verte', 'securite', 'emploi', 'transports', 'air']) expect(ids).toContain(id);
    expect(needs.filter((n) => n.level === 2).length).toBeLessThan(needs.length / 2);
    for (const n of needs) {
      expect(Number.isFinite(n.score)).toBe(true);
      for (const a of n.actions) if ('cost' in a) expect(a.cost).toBeGreaterThan(0);
    }
  });

  it('les programmes proposés sont acceptés par le moteur', () => {
    const S = run(fresh(), 1);
    const actions = assessNeeds(S).flatMap((n) => n.actions).filter((a): a is Extract<NeedAction, { kind: 'program' }> => a.kind === 'program');
    expect(actions.length).toBeGreaterThan(0);
    const a = actions[0];
    const r = applyServiceAction(S, { type: 'programme', building: a.building, cityId: a.cityId, count: a.count });
    expect(r.ok).toBe(true);
  });

  it('construire des écoles augmente les places et fait baisser l\'occupation', () => {
    const A = run(fresh(), 1);
    const B = clone(A);
    const r = applyServiceAction(B, { type: 'programme', building: 'lycee', cityId: 0, count: 10 });
    expect(r.ok).toBe(true);
    run(A, 40); run(B, 40);
    expect(B.education!.schoolPlaces).toBeGreaterThan(A.education!.schoolPlaces + 5000);
    expect(B.education!.occupancySchool).toBeLessThan(A.education!.occupancySchool);
  });

  it('démolir un hôpital réduit la capacité de soins', () => {
    const A = run(fresh(), 1);
    const B = clone(A);
    const h = B.country.infra.find((i) => i.type === 'hopital')!;
    expect(applyServiceAction(B, { type: 'demolir', infraId: h.id }).ok).toBe(true);
    run(A, 6); run(B, 6);
    expect(B.health!.installedBeds).toBeLessThan(A.health!.installedBeds);
  });

  it('construire de l\'éolien en mer augmente la part renouvelable', () => {
    const A = run(fresh(), 1);
    const B = clone(A);
    expect(applyAction(B, { type: 'energyBuild', tech: 'eolienMer', mw: 1500 }).ok).toBe(true);
    run(A, 72); run(B, 72);
    expect(B.energy!.elecRenShare).toBeGreaterThan(A.energy!.elecRenShare + 0.03);
  });
});
