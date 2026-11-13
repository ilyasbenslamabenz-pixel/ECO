/**
 * Foule : marche le long des trottoirs (jamais sur la chaussée hors traversée), arrivée, évitement local
 * (croisement de face, dépassement d'un piéton lent, file derrière un piéton arrêté), anti-blocage, trame.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../../src/sim/world';
import { Crowd, MAX_PATH, PED_DT, ST_LEG_IN, ST_LEG_OUT, ST_WALK, type SpawnParams } from '../../src/sim/pedestrians/crowd';
import { buildPedGraph, EDGE_SIDEWALK, type PedGraph } from '../../src/sim/pedestrians/graph';
import { PedRouter } from '../../src/sim/pedestrians/router';
import { ROAD_KINDS, carriagewayWidth } from '../../src/sim/roads/types';
import { PIETON_IDLE_BIT, PIETON_META_STRIDE, PIETON_POS_STRIDE, PIETON_SPEED_UNIT } from '../../src/shared/protocol-ext/pietons';
import { townCatalog } from '../sim/fixtures';

const HC = carriagewayWidth(ROAD_KINDS.street) / 2;

function street(): { sim: Simulation; g: PedGraph; router: PedRouter; crowd: Crowd } {
  const sim = new Simulation([]);
  sim.setCatalog(townCatalog());
  sim.newGame({ seed: 5, mapChunks: 4, startMoney: 500_000_000, cityName: 'Foule', terrain: { hydrology: 'aucune', rivers: 0 } });
  // Rue de 100 m (pas de traversée de pleine rue) : chaque trottoir est une seule arête de 100 m.
  assert.ok(sim.buildRoad({ type: 'street', points: [-50, 0, 50, 0] }).ok);
  const g = buildPedGraph(sim.net);
  const crowd = new Crowd();
  crowd.setGraph(g);
  let k = 0;
  crowd.random = () => ((k = (k * 16807 + 11) % 2147483647) / 2147483647);
  return { sim, g, router: new PedRouter(g), crowd };
}

/** Trottoir nord (z < 0) de la rue de test. */
function northSidewalk(g: PedGraph): number {
  for (let e = 0; e < g.edgeCount; e++) if (g.eKind[e] === EDGE_SIDEWALK && g.pts[g.ePt0[e]! * 3 + 2]! < 0) return e;
  throw new Error('trottoir introuvable');
}

function params(over: Partial<SpawnParams>): SpawnParams {
  return { persona: -1, look: 2, seed: 100, motif: 5, v0: 1.3, from: -1, dest: -1, ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 0, s0: 0, s1: 0, skipLeg: true, ...over };
}

const buf = new Int32Array(MAX_PATH);

test('foule : sortie du bâtiment, marche sur le trottoir, entrée à destination, vitesse bornée', () => {
  const { g, router, crowd } = street();
  const e = northSidewalk(g);
  const n = router.route(e, 10, e, 90, buf, 0, MAX_PATH, 1000);
  assert.equal(n, 1);
  const P = [0, 0, 0, 0, 0];
  g.pointAt(e, 10, P);
  const ax = P[0]!, az = P[2]!;
  g.pointAt(e, 90, P);
  const bx = P[0]!, bz = P[2]!;
  const i = crowd.spawn(params({ skipLeg: false, ox: ax, oy: P[1]!, oz: az - 8, dx: bx, dy: P[1]!, dz: bz - 8, s0: 10, s1: 90 }), buf, n);
  assert.equal(crowd.state[i], ST_LEG_OUT);
  const seen = new Set<number>();
  let t = 0, maxV = 0, lastX = crowd.x[0]!, lastZ = crowd.z[0]!;
  while (crowd.count > 0 && t < 200) {
    crowd.step(PED_DT);
    t += PED_DT;
    if (crowd.arrived.length) { for (const k of crowd.arrived) crowd.remove(k); break; }
    seen.add(crowd.state[0]!);
    const d = Math.hypot(crowd.x[0]! - lastX, crowd.z[0]! - lastZ);
    maxV = Math.max(maxV, d / PED_DT);
    lastX = crowd.x[0]!; lastZ = crowd.z[0]!;
    if (crowd.state[0] === ST_WALK) {
      // Sur le trottoir : au-delà de la bordure (|z| > demi-chaussée), dans la largeur du trottoir.
      assert.ok(Math.abs(crowd.z[0]!) > HC + 0.2 && Math.abs(crowd.z[0]!) < HC + ROAD_KINDS.street.sidewalk, `z=${crowd.z[0]}`);
    }
  }
  assert.equal(crowd.count, 0, 'arrivé et retiré');
  assert.deepEqual([...seen].sort(), [ST_LEG_OUT, ST_WALK, ST_LEG_IN]);
  // 8 m de sortie + 80 m de trottoir + 8 m d'entrée à 1,3 m/s ≈ 74 s (+ accélérations).
  assert.ok(t > 70 && t < 85, `durée ${t} s`);
  assert.ok(maxV <= 1.3 * 1.05 + 0.75, `vitesse max ${maxV} m/s`); // marche + décalage latéral
});

test('foule : deux piétons face à face se croisent sans se traverser et arrivent tous les deux', () => {
  const { g, router, crowd } = street();
  const e = northSidewalk(g);
  router.route(e, 5, e, 95, buf, 0, MAX_PATH, 1000);
  crowd.spawn(params({ s0: 5, s1: 95 }), buf, 1);
  router.route(e, 95, e, 5, buf, 0, MAX_PATH, 1000);
  crowd.spawn(params({ s0: 95, s1: 5 }), buf, 1);
  // Même couloir au départ : collision frontale assurée sans évitement.
  crowd.lat[0] = 0.3; crowd.lat0[0] = 0.3; crowd.latT[0] = 0.3;
  crowd.lat[1] = -0.3; crowd.lat0[1] = -0.3; crowd.latT[1] = -0.3;
  let minD = Infinity, done = 0;
  for (let k = 0; k < 1200 && done < 2; k++) {
    crowd.step(PED_DT);
    if (crowd.count === 2 && crowd.state[0] === ST_WALK && crowd.state[1] === ST_WALK) minD = Math.min(minD, Math.hypot(crowd.x[0]! - crowd.x[1]!, crowd.z[0]! - crowd.z[1]!));
    for (const a of crowd.arrived) { crowd.remove(a); done++; }
    for (let i = 0; i < crowd.count; i++) if (crowd.state[i] === ST_WALK) assert.ok(Math.abs(crowd.z[i]!) > HC + 0.2, 'reste sur le trottoir pendant l\'évitement');
  }
  assert.equal(done, 2);
  assert.ok(minD > 0.45, `distance minimale au croisement ${minD.toFixed(2)} m`);
});

test('foule : un piéton rapide double un piéton lent ; sans place, il le suit sans le traverser', () => {
  const { g, router, crowd } = street();
  const e = northSidewalk(g);
  router.route(e, 20, e, 95, buf, 0, MAX_PATH, 1000);
  const slow = crowd.spawn(params({ s0: 20, s1: 95, v0: 0.7 }), buf, 1);
  router.route(e, 5, e, 95, buf, 0, MAX_PATH, 1000);
  const fast = crowd.spawn(params({ s0: 5, s1: 95, v0: 1.6 }), buf, 1);
  for (const i of [slow, fast]) { crowd.lat[i] = 0.2; crowd.lat0[i] = 0.2; crowd.latT[i] = 0.2; }
  const idSlow = crowd.id[slow]!, idFast = crowd.id[fast]!;
  let minD = Infinity, first = 0;
  for (let k = 0; k < 2000 && crowd.count > 0; k++) {
    crowd.step(PED_DT);
    if (crowd.count === 2) minD = Math.min(minD, Math.hypot(crowd.x[0]! - crowd.x[1]!, crowd.z[0]! - crowd.z[1]!));
    for (const a of crowd.arrived) { if (!first) first = crowd.id[a]!; crowd.remove(a); }
  }
  assert.equal(first, idFast, 'le rapide est arrivé le premier : il a doublé');
  assert.notEqual(idSlow, idFast);
  assert.ok(minD > 0.45, `distance minimale pendant le dépassement ${minD.toFixed(2)} m`);

  // Trottoir rétréci (demi-largeur 0,15 m) : dépassement impossible, le rapide reste derrière.
  const t = street();
  const e2 = northSidewalk(t.g);
  t.g.eHalf[e2] = 0.15;
  t.router.route(e2, 20, e2, 95, buf, 0, MAX_PATH, 1000);
  t.crowd.spawn(params({ s0: 20, s1: 95, v0: 0.7 }), buf, 1);
  t.router.route(e2, 5, e2, 95, buf, 0, MAX_PATH, 1000);
  t.crowd.spawn(params({ s0: 5, s1: 95, v0: 1.6 }), buf, 1);
  let gapMin = Infinity;
  for (let k = 0; k < 600; k++) {
    t.crowd.step(PED_DT);
    assert.equal(t.crowd.arrived.length, 0);
    gapMin = Math.min(gapMin, t.crowd.x[0]! - t.crowd.x[1]!);
  }
  assert.ok(gapMin > 0.4, `le suiveur garde ses distances (écart minimal ${gapMin.toFixed(2)} m)`);
  assert.ok(t.crowd.speed[1]! < 0.9, `le suiveur a ralenti à ${t.crowd.speed[1]} m/s`);
});

test('foule : anti-blocage — un piéton coincé derrière un obstacle immobile finit par passer', () => {
  const { g, router, crowd } = street();
  const e = northSidewalk(g);
  g.eHalf[e] = 0.15;
  router.route(e, 30, e, 31, buf, 0, MAX_PATH, 1000);
  const wall = crowd.spawn(params({ s0: 30, s1: 31, v0: 0.0001 }), buf, 1); // quasi immobile
  router.route(e, 20, e, 60, buf, 0, MAX_PATH, 1000);
  const walker = crowd.spawn(params({ s0: 20, s1: 60, v0: 1.3 }), buf, 1);
  const idW = crowd.id[walker]!;
  void wall;
  let arrived = false;
  for (let k = 0; k < 900 && !arrived; k++) {
    crowd.step(PED_DT);
    for (const a of crowd.arrived) { if (crowd.id[a] === idW) arrived = true; crowd.remove(a); }
  }
  assert.ok(arrived, 'le piéton s\'est faufilé après quelques secondes');
});

test('foule : trame du rendu (positions, cap, profil, animation) et suppression par permutation', () => {
  const { g, router, crowd } = street();
  const e = northSidewalk(g);
  for (let k = 0; k < 5; k++) {
    router.route(e, 10 + k * 5, e, 90, buf, 0, MAX_PATH, 1000);
    crowd.spawn(params({ s0: 10 + k * 5, s1: 90, look: k % 8, seed: k * 40 }), buf, 1);
  }
  for (let k = 0; k < 30; k++) crowd.step(PED_DT);
  const f = crowd.frame();
  assert.equal(f.count, 5);
  assert.equal(f.ids.length, 5);
  assert.equal(f.pos.length, 5 * PIETON_POS_STRIDE);
  assert.equal(f.meta.length, 5 * PIETON_META_STRIDE);
  assert.deepEqual(Array.from(f.ids), [1, 2, 3, 4, 5]);
  for (let i = 0; i < 5; i++) {
    assert.equal(f.meta[i * 3], i % 8);
    assert.equal(f.meta[i * 3 + 1], i * 40);
    const anim = f.meta[i * 3 + 2]!;
    assert.equal(anim & PIETON_IDLE_BIT, 0, 'en marche');
    assert.ok(Math.abs(anim * PIETON_SPEED_UNIT - crowd.speed[i]!) <= PIETON_SPEED_UNIT);
    // Cap : vers +x (avant = (sin cap, cos cap)).
    assert.ok(Math.abs(Math.sin(f.pos[i * 4 + 3]!) - 1) < 0.05, `cap ${f.pos[i * 4 + 3]}`);
  }
  crowd.remove(1);
  assert.equal(crowd.count, 4);
  assert.deepEqual(Array.from(crowd.id.subarray(0, 4)), [1, 5, 3, 4]);
  // Le piéton déplacé garde son chemin et continue d'avancer.
  const x = crowd.x[1]!;
  for (let k = 0; k < 10; k++) crowd.step(PED_DT);
  assert.ok(crowd.x[1]! > x + 0.5);
});
