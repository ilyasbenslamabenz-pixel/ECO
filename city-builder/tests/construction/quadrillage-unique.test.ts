/**
 * Quadrillage UNIQUE au sol (retour joueur « le quadrillage au sol n'est pas partout le même ») : bande des façades en
 * cases entières, mêmes lignes des deux côtés d'une rue et d'une route à l'autre (routes parallèles / perpendiculaires
 * calées par le tracé aimanté), cases de 8 m sur le treillis du monde.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GridField, type FieldRoad, type ObbQuery } from '../../src/shared/grid-field';
import { facadeGap, facadeOffset, lineGap } from '../../src/shared/road-grid';
import { alignTrace } from '../../src/client/tools/road-align';

/** Demi-largeurs (trottoirs compris) des types de route (src/sim/roads/types.ts). */
const HALF: Record<string, number> = { street: 6.2, oneway: 6.1, avenue: 11.5, highway: 10.1, pedestrian: 2.5, boulevard: 16.4 };
const none: ObbQuery = (_a, _b, _c, _d, out) => { out.length = 0; return out; };

test('recul de façade par type : bande des façades multiple de 8 m, recul ≥ 0,5 m', () => {
  const want: Record<string, number> = { street: 1.8, oneway: 1.9, avenue: 0.5, highway: 1.9, pedestrian: 1.5, boulevard: 3.6 };
  for (const [k, h] of Object.entries(HALF)) {
    const off = facadeOffset(h);
    assert.ok(lineGap(2 * off) < 1e-9, `${k} : bande ${2 * off} m`);
    assert.ok(Math.abs(facadeGap(h) - want[k]!) < 1e-9, `${k} : recul ${facadeGap(h)}`);
  }
});

/** Écart max (m) des lignes affichées au treillis du monde (x ≡ 0, z ≡ 0 mod 8) sur une grille de points. */
function worldLatticeGap(f: GridField, x0: number, z0: number, x1: number, z1: number, step = 1.7): { gap: number; n: number } {
  let gap = 0, n = 0;
  for (let z = z0; z <= z1; z += step) for (let x = x0; x <= x1; x += step) {
    const L = f.linesAt(x, z);
    if (L.weight < 0.5) continue;
    assert.ok(Math.abs(L.tx * L.tz) < 1e-9, `direction (${L.tx}, ${L.tz}) en ${x}, ${z}`);
    gap = Math.max(gap, lineGap(L.pu), lineGap(L.pv));
    n++;
  }
  return { gap, n };
}

test('rues parallèles et perpendiculaires tracées avec l\'aimantation : un seul treillis de 8 m partout', () => {
  const roads: FieldRoad[] = [];
  // Chaque route est calée sur le quadrillage affiché au moment du tracé (champ des routes déjà posées).
  const add = (id: number, kind: string, x0: number, z0: number, x1: number, z1: number, slide?: { tx: number; tz: number }): void => {
    const f = new GridField(roads, none);
    const L = f.linesAt(x0 + (x1 - x0) * 0.1, z0 + (z1 - z0) * 0.1);
    const r = alignTrace({ x: x0, z: z0, slide: slide ?? null }, { x: x1, z: z1 }, HALF[kind]!, L);
    assert.ok(r, `tracé ${id} calé`);
    roads.push({ id, poly: [r!.start.x, r!.start.z, r!.end.x, r!.end.z], half: HALF[kind]! });
  };
  add(1, 'street', -150.3, 3.1, 150.4, 3.4); // rue principale est-ouest
  add(2, 'avenue', -149.6, 61.2, 151.1, 61.0); // avenue parallèle au nord
  add(3, 'street', 40.2, roads[0]!.poly[1]!, 40.9, -120.5, { tx: 1, tz: 0 }); // rue perpendiculaire depuis la rue
  add(4, 'boulevard', -60.7, -70.3, 120.2, -71.4); // boulevard parallèle au sud
  add(5, 'oneway', -90.4, -10, -91.3, -140); // sens unique perpendiculaire
  const f = new GridField(roads, none);
  const m = worldLatticeGap(f, -140, -130, 140, 120);
  assert.ok(m.n > 5000, `${m.n} points`);
  assert.ok(m.gap < 0.05, `lignes hors du treillis unique : ${m.gap.toFixed(3)} m`);
});

test('route posée hors treillis (ancienne partie) : mêmes lignes des deux côtés de la rue', () => {
  for (const [k, h] of Object.entries(HALF)) {
    const f = new GridField([{ id: 1, poly: [-100, 3.37, 100, 3.37], half: h }], none);
    const a = f.linesAt(10, 3.37 + h + 3), b = f.linesAt(10, 3.37 - h - 3);
    assert.ok(lineGap(a.pv - b.pv) < 1e-9 && lineGap(a.pu - b.pu) < 1e-9, `${k} : côtés ${a.pv} / ${b.pv}`);
  }
});
