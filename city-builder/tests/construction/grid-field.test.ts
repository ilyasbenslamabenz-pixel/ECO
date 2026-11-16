/**
 * Champ de trames du quadrillage (src/shared/grid-field.ts) : en tout point, les lignes affichées suivent la route la
 * plus proche (rangées intérieures comprises, bien au-delà de 40 m), les bâtiments existants (même posés hors trame
 * par une ancienne version) et, loin des routes, le bâtiment le plus proche ; fondu entre deux trames.
 * Lancer : npx tsx --test tests/construction/grid-field.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { footprintObb, obbCorners, angleToRot, type Obb } from '../../src/shared/footprint';
import { FIELD_ROAD_REACH, GridField, ObbBuckets, sameLines, type GridLines } from '../../src/shared/grid-field';
import { lineGap } from '../../src/shared/road-grid';

const ANG = 0.47;
const T: [number, number] = [Math.cos(ANG), Math.sin(ANG)];
const N: [number, number] = [-T[1], T[0]];
const HALF = 6.2;

/** Angle (°) entre les côtés d'une empreinte et les lignes, et écart max (m) de ses coins aux lignes. */
function fit(L: GridLines, o: Obb): { angle: number; gap: number } {
  const a = Math.atan2(-o.s, o.c) - Math.atan2(L.tz, L.tx);
  let d = ((a % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
  d = Math.min(d, Math.PI / 2 - d) * 180 / Math.PI;
  const c = obbCorners(o);
  let g = 0;
  for (let k = 0; k < 8; k += 2) {
    g = Math.max(g, lineGap(c[k]! * L.tx + c[k + 1]! * L.tz - L.pu), lineGap(c[k]! * -L.tz + c[k + 1]! * L.tx - L.pv));
  }
  return { angle: d, gap: g };
}

/** Bâtiment de w × d cases face à la rue en biais, façade à `front` m du trottoir, côté gauche à `along` m. */
function facing(w: number, d: number, along: number, front: number): Obb {
  const rot = angleToRot(Math.atan2(N[0], N[1]));
  const s = HALF + front + d * 4, u = along + w * 4;
  return footprintObb(w, d, 100 + T[0] * u + N[0] * s, 50 + T[1] * u + N[1] * s, rot);
}

const road = { id: 1, poly: [100 - T[0] * 300, 50 - T[1] * 300, 100 + T[0] * 300, 50 + T[1] * 300], half: HALF };

test('rangées intérieures loin de la route : lignes parallèles aux façades et sur leurs côtés (ancienne partie hors trame)', () => {
  // Rangée de devant sur la trame, rangées intérieures de l'ancienne version (façade au bord de case − 4 m, décalées).
  const obbs = [facing(2, 2, 3.3, 0.6), facing(2, 2, 21.3, 0.6), facing(2, 3, 7.9, 13.1), facing(3, 2, 30.2, 26.7), facing(2, 2, 5.1, 45.5)];
  const field = new GridField([road], new ObbBuckets(obbs).query);
  for (const o of obbs) {
    for (const [lx, lz] of [[0, 0], [o.hx * 0.6, o.hz * 0.6], [-o.hx * 0.6, -o.hz * 0.6]] as const) {
      const L = field.linesAt(o.cx + lx * o.c + lz * o.s, o.cz - lx * o.s + lz * o.c);
      const f = fit(L, o);
      assert.ok(f.angle < 0.01 && f.gap < 0.01, `bâtiment à ${o.cx.toFixed(1)},${o.cz.toFixed(1)} : angle ${f.angle}°, écart ${f.gap} m (${L.kind})`);
      assert.equal(L.kind, 'route');
      assert.ok(L.weight > 0.99);
    }
  }
  // Au-delà de 40 m du bord (ancienne limite), toujours la trame de la route.
  const far = field.linesAt(100 + N[0] * (HALF + 55), 50 + N[1] * (HALF + 55));
  assert.equal(far.kind, 'route');
  assert.ok(Math.abs(far.tx * T[0] + far.tz * T[1]) > 0.9999);
  assert.ok(FIELD_ROAD_REACH >= 56);
});

test('loin de toute route : repère du bâtiment le plus proche ; sinon axes du monde', () => {
  const o = footprintObb(2, 3, 1000, 1000, 0.37);
  const field = new GridField([], new ObbBuckets([o]).query);
  const L = field.linesAt(1010, 1012);
  assert.equal(L.kind, 'batiment');
  const f = fit(L, o);
  assert.ok(f.angle < 0.01 && f.gap < 0.01);
  assert.equal(field.linesAt(2000, 2000).kind, 'monde');
});

test('route courbe : tangente locale, trame continue (pas de saut entre deux points voisins)', () => {
  const poly: number[] = [];
  for (let k = 0; k <= 48; k++) { const a = k / 48 * Math.PI / 2; poly.push(Math.cos(a) * 150, Math.sin(a) * 150); }
  const field = new GridField([{ id: 2, poly, half: HALF }], new ObbBuckets([]).query);
  let prev: GridLines | null = null;
  for (let k = 0; k < 60; k++) {
    const a = 0.2 + k * 0.01, r = 150 + HALF + 10;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const L = field.linesAt(x, z);
    // Tangente perpendiculaire au rayon.
    assert.ok(Math.abs(L.tx * Math.cos(a) + L.tz * Math.sin(a)) < 0.04);
    if (prev) {
      // Même point vu par les deux trames voisines : coordonnées u à moins de 5 cm (≪ 8 m).
      const u1 = x * L.tx + z * L.tz - L.pu, u0 = x * prev.tx + z * prev.tz - prev.pu;
      assert.ok(lineGap(u1 - u0) < 0.3, `saut de trame ${lineGap(u1 - u0)} m`);
    }
    prev = L;
  }
});

test('deux routes en angle : la plus proche gagne, fondu court à la limite', () => {
  const r1 = { id: 1, poly: [0, 0, 300, 0], half: 6 };
  const r2 = { id: 2, poly: [0, 0, 300 * Math.cos(0.8), 300 * Math.sin(0.8)], half: 6 };
  const field = new GridField([r1, r2], new ObbBuckets([]).query);
  const near1 = field.linesAt(200, 15);
  assert.equal(near1.roadId, 1); assert.ok(near1.weight > 0.99);
  // Bissectrice : fondu.
  const b = field.linesAt(Math.cos(0.4) * 150, Math.sin(0.4) * 150);
  assert.ok(b.weight < 0.2, `fondu ${b.weight}`);
  // Tronçons colinéaires (rue coupée par un carrefour) : aucune limite.
  const c = new GridField([{ id: 1, poly: [0, 3, 100, 3], half: 6 }, { id: 3, poly: [100, 3, 250, 3], half: 6 }], new ObbBuckets([]).query);
  const j = c.linesAt(100, 20);
  assert.ok(j.weight > 0.99);
  assert.ok(sameLines(c.linesAt(99, 20), c.linesAt(101, 20)));
});

test('cases de la trame : case propre contenant un point, centre sur la trame', () => {
  const field = new GridField([road], new ObbBuckets([]).query);
  const p = [100 + N[0] * 20 + T[0] * 5, 50 + N[1] * 20 + T[1] * 5];
  const c = field.ownCellAt(p[0]!, p[1]!)!;
  assert.ok(c);
  const L = c.lines;
  const u = c.cx * L.tx + c.cz * L.tz - L.pu, v = c.cx * -L.tz + c.cz * L.tx - L.pv;
  assert.ok(Math.abs(lineGap(u) - 4) < 1e-6 && Math.abs(lineGap(v) - 4) < 1e-6);
  assert.ok(Math.hypot(c.cx - p[0]!, c.cz - p[1]!) < 5.66);
});

test('texture du champ : coût raisonnable (256 × 256 texels de 2 m, quartier dense)', () => {
  const obbs: Obb[] = [];
  const roads = [];
  for (let k = 0; k < 8; k++) roads.push({ id: 10 + k, poly: [-260, -240 + k * 64, 260, -240 + k * 64], half: 6 });
  for (let k = 0; k < 8; k++) roads.push({ id: 30 + k, poly: [-240 + k * 64, -260, -240 + k * 64, 260], half: 6 });
  for (let i = 0; i < 40; i++) for (let j = 0; j < 40; j++) obbs.push(footprintObb(2, 2, -250 + i * 13 + 4, -250 + j * 13 + 4, 0));
  const field = new GridField(roads, new ObbBuckets(obbs).query);
  const out = new Float32Array(256 * 256 * 4);
  const t0 = performance.now();
  field.fill(out, -256, -256, 256, 2);
  const ms = performance.now() - t0;
  assert.ok(ms < 1500, `${ms.toFixed(0)} ms`);
  console.log(`champ 256² : ${ms.toFixed(0)} ms`);
});

test('zonage dans la trame des routes : cases peintes, bâtiments nés du zonage sur les lignes du champ (rue en biais)', async () => {
  const { zoningTown } = await import('../zonage/fixtures');
  const t = zoningTown({ seed: 5 });
  let placed: number[] | null = null;
  for (let r = 0; r < 300 && !placed; r += 24) for (let k = 0; k < 8 && !placed; k++) {
    const x = Math.cos(k) * r, z = Math.sin(k) * r;
    const pts = [x - 90 * T[0], z - 90 * T[1], x + 90 * T[0], z + 90 * T[1]];
    if (t.sim.buildRoad({ type: 'street', points: pts }).ok) placed = pts;
  }
  assert.ok(placed);
  const [x0, z0, x1, z1] = placed!;
  const n = (t.cmd('paint', { points: [x0, z0, x1, z1], zone: 'res_moyen', depth: 3 }).data as { changed: number }).changed;
  // Bande de 3 rangées des deux côtés sur ≈ 180 m : ≈ 2 × 3 × 22 cases.
  assert.ok(n > 90, `${n} cases peintes`);
  t.cmd('tuning', { demandeMin: -1, naissancesParHeure: 3, maxParHeure: 3, maxChantiers: 1000 });
  t.cmd('grow', { attempts: 40 });
  const sys = t.sys, st = t.ctx.buildings.store, field = sys.field(t.ctx);
  let count = 0;
  for (const id of sys.owned.keys()) {
    const i = t.ctx.buildings.indexOf(id);
    const o = footprintObb(st.tilesX[i]!, st.tilesZ[i]!, st.x[i]!, st.z[i]!, st.rot[i]!);
    // Lignes affichées au centre et juste devant chaque côté : sur les côtés du bâtiment.
    for (const [lx, lz] of [[0, 0], [0, o.hz + 1], [0, -o.hz - 1], [o.hx + 1, 0], [-o.hx - 1, 0]] as const) {
      const L = field.linesAt(o.cx + lx * o.c + lz * o.s, o.cz - lx * o.s + lz * o.c);
      if (L.weight < 0.5) continue;
      const f = fit(L, o);
      assert.ok(f.angle < 0.05 && f.gap < 0.05, `bâtiment ${id} : angle ${f.angle.toFixed(2)}°, écart ${f.gap.toFixed(2)} m`);
    }
    // Il couvre des cases de la trame zonées (zone de la case du monde sous leur centre).
    const c = field.cellAt(o.cx, o.cz);
    assert.ok(sys.grid.zone[sys.grid.index(c.cx, c.cz)]! > 0, `bâtiment ${id} sur une case zonée`);
    count++;
  }
  assert.ok(count >= 4, `${count} bâtiments nés du zonage`);
});
