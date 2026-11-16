/**
 * Aimantation du tracé de route au quadrillage affiché (src/client/tools/road-align.ts) : direction calée sur les
 * lignes (< 8°), ligne des façades sur une ligne affichée, extrémités sur les lignes transversales, priorité aux
 * accroches (nœud fixe, tronçon : glissement le long du tronçon) ; la trame de la route posée (src/shared/grid-field.ts)
 * prolonge les lignes affichées avant le tracé, pour toutes les largeurs de route.
 * Lancer : npx tsx --test tests/construction/road-align.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GridField, sameLines, worldLines, type FieldRoad, type ObbQuery } from '../../src/shared/grid-field';
import { FACADE_GAP, lineGap } from '../../src/shared/road-grid';
import { ROAD_KINDS, halfWidth } from '../../src/sim/roads/types';
import type { RoadKindId } from '../../src/shared/contracts';
import { alignTrace } from '../../src/client/tools/road-align';

const none: ObbQuery = (_a, _b, _c, _d, out) => { out.length = 0; return out; };
const field = (roads: FieldRoad[]): GridField => new GridField(roads, none);
const ray = (x: number, z: number, len: number, deg: number): [number, number, number, number] => [x, z, x + len * Math.cos(deg * Math.PI / 180), z + len * Math.sin(deg * Math.PI / 180)];
const HALVES = (Object.keys(ROAD_KINDS) as RoadKindId[]).map((k) => [k, halfWidth(k)] as const);

test('terrain libre (axes du monde) : direction, façades et extrémités sur les lignes, toutes largeurs', () => {
  for (const [kind, half] of HALVES) {
    const [x0, z0, x1, z1] = ray(3.3, 150.7, 56.4, 3);
    const r = alignTrace({ x: x0, z: z0 }, { x: x1, z: z1 }, half, worldLines());
    assert.ok(r, kind);
    // Direction est-ouest exacte.
    assert.ok(Math.abs(r.end.z - r.start.z) < 1e-9, `${kind} : direction`);
    // Ligne des façades d'un côté sur une ligne du monde (z ≡ 0 mod 8), décalage < une demi-case.
    const off = half + FACADE_GAP;
    assert.ok(Math.min(lineGap(r.start.z + off), lineGap(r.start.z - off)) < 1e-9, `${kind} : façade`);
    assert.ok(Math.abs(r.shift) <= 4 + 1e-9);
    // Extrémités sur les lignes transversales, longueur en cases entières.
    assert.ok(lineGap(r.start.x) < 1e-9 && lineGap(r.end.x) < 1e-9, `${kind} : extrémités`);
    assert.ok(Math.abs(r.end.x - r.start.x - 56) < 1e-9, `${kind} : longueur ${r.end.x - r.start.x}`);
  }
});

test('après la pose, la trame de la route prolonge les lignes affichées (côté calé) et ses deux côtés sont entiers', () => {
  for (const [kind, half] of HALVES) {
    const [x0, z0, x1, z1] = ray(-27.3, 160.6, 56.4, -2.5);
    const r = alignTrace({ x: x0, z: z0 }, { x: x1, z: z1 }, half, worldLines())!;
    const f = field([{ id: 1, poly: [r.start.x, r.start.z, r.end.x, r.end.z], half }]);
    const off = half + FACADE_GAP, zc = r.start.z, xm = (r.start.x + r.end.x) / 2;
    for (const side of [-1, 1]) {
      const L = f.linesAt(xm, zc + side * (off + 2));
      assert.equal(L.kind, 'route');
      // Ligne des façades de CHAQUE côté sur une ligne de la trame de la route : cases de zone entières des deux côtés.
      const fz = zc + side * off;
      assert.ok(lineGap(xm * -L.tz + fz * L.tx - L.pv) < 1e-6, `${kind} façade ${side}`);
      // Côté calé : mêmes lignes que les axes du monde affichés avant le tracé.
      if (side === r.side) assert.ok(sameLines(L, worldLines()), `${kind} : trame prolongée`);
    }
  }
});

test('parallèle à une route existante : façade côté route sur ses lignes, cases entières entre les deux routes', () => {
  const half = 6.2, old: FieldRoad = { id: 1, poly: [-200, 3, 200, 3], half };
  const f0 = field([old]);
  const [x0, z0, x1, z1] = ray(-31.4, 45.7, 56.3, 2.5);
  const L = f0.linesAt(x0 + 8, z0);
  const r = alignTrace({ x: x0, z: z0 }, { x: x1, z: z1 }, half, L)!;
  assert.ok(r);
  assert.equal(r.side, -1, 'façade calée du côté de la route existante');
  const f1 = field([old, { id: 2, poly: [r.start.x, r.start.z, r.end.x, r.end.z], half }]);
  // Entre les deux routes, les deux trames coïncident (pas de fondu, cases entières).
  const zMid = (3 + r.start.z) / 2;
  const a = f0.linesAt(0, 3 + half + 3), b = f1.linesAt(0, r.start.z - half - 3);
  assert.ok(sameLines(a, b), `trames ${JSON.stringify(a)} ${JSON.stringify(b)}`);
  assert.equal(f1.linesAt(0, zMid).weight, 1);
});

test('perpendiculaire depuis un tronçon : le départ glisse le long du tronçon, la façade tombe sur ses lignes', () => {
  const half = 6.2, old: FieldRoad = { id: 1, poly: [-200, 3, 200, 3], half };
  const f0 = field([old]);
  const [x0, z0, x1, z1] = ray(10.7, 3, 56.2, 92);
  const L = f0.linesAt(x0, z0 + 8);
  const r = alignTrace({ x: x0, z: z0, slide: { tx: 1, tz: 0 } }, { x: x1, z: z1 }, half, L)!;
  assert.ok(r);
  assert.equal(r.start.z, 3, 'le départ reste sur l\'axe du tronçon');
  assert.ok(Math.abs(r.end.x - r.start.x) < 1e-9, 'tracé perpendiculaire');
  assert.ok(Math.min(lineGap(r.start.x + half + FACADE_GAP - L.pu), lineGap(r.start.x - half - FACADE_GAP - L.pu)) < 1e-9);
  assert.ok(lineGap(r.end.z) < 1e-9, 'arrivée sur une ligne transversale');
});

test('priorités : nœud fixe (pas de décalage), deux accroches (rien), trop en biais (rien)', () => {
  const r = alignTrace({ x: 10.7, z: 3, fixed: true }, { x: 60, z: 6 }, 6.2, worldLines())!;
  assert.deepEqual(r.start, { x: 10.7, z: 3 });
  assert.ok(Math.abs(r.end.z - 3) < 1e-9 && lineGap(r.end.x) < 1e-9);
  assert.equal(alignTrace({ x: 0, z: 0, fixed: true }, { x: 50, z: 3, fixed: true }, 6.2, worldLines()), null);
  assert.equal(alignTrace({ x: 0, z: 0 }, ...[{ x: 50, z: 50 * Math.tan(10 * Math.PI / 180) }], 6.2, worldLines()), null);
  // 45° : reste tel quel (angles prioritaires de l'aimant).
  assert.equal(alignTrace({ x: 0, z: 0 }, { x: 40, z: 40 }, 6.2, worldLines()), null);
});
