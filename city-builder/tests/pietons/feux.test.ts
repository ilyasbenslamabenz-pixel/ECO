/**
 * Traversées : respect des feux via le service « feux » (adaptateur), repli « traversée prudente » sans service,
 * créneaux entre véhicules via le service « trafic », service invalide ignoré, occupation publiée (« pietons »).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../../src/sim/world';
import { Crowd, MAX_PATH, MAX_WAIT_GAP, MAX_WAIT_SIGNAL, PED_DT, ST_WAIT, type SpawnParams } from '../../src/sim/pedestrians/crowd';
import { FEU_DEGAGEMENT, FEU_ROUGE, FEU_VERT, adaptFeux, adaptTrafic, type FeuxService, type PietonsService, type TraficService } from '../../src/sim/pedestrians/feux';
import { buildPedGraph, EDGE_CROSS_MARKED, type PedGraph } from '../../src/sim/pedestrians/graph';
import { PedRouter } from '../../src/sim/pedestrians/router';
import type { SimPlugin } from '../../src/sim/plugins';
import { townCatalog } from '../sim/fixtures';
import { pedTown } from './fixtures';

interface Scene { g: PedGraph; router: PedRouter; crowd: Crowd; cross: number; node: number; seg: number; spawnAcross(v0?: number): number }

/** Carrefour avenue × rue ; `spawnAcross` crée un piéton qui doit traverser l'avenue par le passage peint ouest. */
function crossroads(): Scene {
  const sim = new Simulation([]);
  sim.setCatalog(townCatalog());
  sim.newGame({ seed: 9, mapChunks: 4, startMoney: 500_000_000, cityName: 'Feux', terrain: { hydrology: 'aucune', rivers: 0 } });
  assert.ok(sim.buildRoad({ type: 'avenue', kind: 'avenue', points: [-150, 0, 150, 0] }).ok);
  assert.ok(sim.buildRoad({ type: 'street', points: [0, -120, 0, 120] }).ok);
  const g = buildPedGraph(sim.net);
  const router = new PedRouter(g);
  const crowd = new Crowd();
  crowd.setGraph(g);
  let k = 7;
  crowd.random = () => ((k = (k * 16807 + 11) % 2147483647) / 2147483647);
  // Passage peint du bras ouest de l'avenue (x < 0, traverse z).
  let cross = -1;
  for (let e = 0; e < g.edgeCount; e++) {
    if (g.eKind[e] !== EDGE_CROSS_MARKED) continue;
    const p = g.ePt0[e]! * 3;
    if (g.pts[p]! < -5 && Math.abs(g.pts[p]! - g.pts[p + (g.ePtN[e]! - 1) * 3]!) < 0.5) cross = e;
  }
  assert.ok(cross >= 0);
  const hitA = { edge: 0, s: 0, x: 0, y: 0, z: 0, d: 0 }, hitB = { ...hitA };
  const buf = new Int32Array(MAX_PATH);
  const spawnAcross = (v0 = 1.3): number => {
    // Du trottoir nord au trottoir sud de l'avenue, 12 m à l'ouest du passage.
    const x = g.pts[g.ePt0[cross]! * 3]! - 12;
    assert.ok(g.nearest(x, -11, 6, true, hitA));
    assert.ok(g.nearest(x, 11, 6, true, hitB));
    const n = router.route(hitA.edge, hitA.s, hitB.edge, hitB.s, buf, 0, MAX_PATH, 1000);
    assert.ok(n >= 3);
    assert.ok(Array.from(buf.subarray(0, n)).includes(cross), 'le chemin passe par le passage peint');
    const p: SpawnParams = { persona: -1, look: 2, seed: 100, motif: 5, v0, from: -1, dest: -1, ox: 0, oy: 0, oz: 0, dx: hitB.x, dy: hitB.y, dz: hitB.z, s0: hitA.s, s1: hitB.s, skipLeg: true };
    return crowd.spawn(p, buf, n);
  };
  return { g, router, crowd, cross, node: g.eNode[cross]!, seg: g.eSeg[cross]!, spawnAcross };
}

function run(s: Scene, seconds: number, each?: (t: number) => void): void {
  for (let k = 0; k < Math.round(seconds / PED_DT); k++) {
    s.crowd.step(PED_DT);
    for (const a of s.crowd.arrived) s.crowd.remove(a);
    each?.((k + 1) * PED_DT);
  }
}

test('feux : rouge = attente au bord du trottoir ; vert = traversée ; personne sur la chaussée au rouge', () => {
  const s = crossroads();
  const feu = { etat: FEU_ROUGE, restant: 30 };
  const asked: [number, number][] = [];
  const svc: FeuxService = { passage: (n, e) => { asked.push([n, e]); return n === s.node && e === s.seg ? feu : null; } };
  s.crowd.feux = adaptFeux(svc);
  assert.ok(s.crowd.feux);
  for (let i = 0; i < 6; i++) { s.spawnAcross(1.2 + i * 0.05); run(s, 1.5); }
  run(s, 40, () => assert.equal(s.crowd.crossOn[s.cross], 0, 'aucun piéton engagé au rouge'));
  assert.equal(s.crowd.count, 6);
  let waiting = 0;
  for (let i = 0; i < s.crowd.count; i++) if (s.crowd.state[i] === ST_WAIT) waiting++;
  assert.equal(waiting, 6, 'tous attendent');
  assert.equal(s.crowd.crossWait[s.cross], 6);
  assert.ok(asked.some(([n, e]) => n === s.node && e === s.seg), 'le service est interrogé avec (carrefour, tronçon du bras)');
  // Les piétons en attente ne s'empilent pas au même point.
  for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) {
    assert.ok(Math.hypot(s.crowd.x[i]! - s.crowd.x[j]!, s.crowd.z[i]! - s.crowd.z[j]!) > 0.3, 'piétons en attente espacés');
  }
  // Dégagement (orange) : on ne s'engage pas.
  feu.etat = FEU_DEGAGEMENT; feu.restant = 5;
  run(s, 5, () => assert.equal(s.crowd.crossOn[s.cross], 0));
  // Vert trop court pour traverser 16 m : on ne s'engage pas non plus.
  feu.etat = FEU_VERT; feu.restant = 3;
  run(s, 2, () => assert.equal(s.crowd.crossOn[s.cross], 0));
  // Vert franc : tout le monde traverse.
  feu.restant = 40;
  let maxOn = 0;
  run(s, 40, () => { maxOn = Math.max(maxOn, s.crowd.crossOn[s.cross]!); });
  assert.ok(maxOn >= 4, `${maxOn} piétons simultanément sur le passage`);
  assert.equal(s.crowd.count, 0, 'tous arrivés de l\'autre côté');
  assert.equal(s.crowd.counters.green, 6);
  assert.equal(s.crowd.counters.prudent + s.crowd.counters.forced, 0);
  assert.equal(s.crowd.crossWait[s.cross], 0);
  assert.equal(s.crowd.crossOn[s.cross], 0);
});

test('feux : feu bloqué au rouge — traversée forcée après l\'attente maximale (jamais de blocage définitif)', () => {
  const s = crossroads();
  s.crowd.feux = adaptFeux({ passage: () => ({ etat: FEU_ROUGE, restant: 1e9 }) } satisfies FeuxService);
  s.spawnAcross();
  run(s, MAX_WAIT_SIGNAL - 5);
  assert.equal(s.crowd.count, 1);
  assert.equal(s.crowd.state[0], ST_WAIT);
  run(s, 40);
  assert.equal(s.crowd.count, 0);
  assert.equal(s.crowd.counters.forced, 1);
});

test('sans service « feux » : traversée prudente (arrêt, observation, puis traversée ; effet de groupe)', () => {
  const s = crossroads();
  s.spawnAcross();
  let stopped = 0, crossedAt = -1;
  run(s, 60, (t) => {
    if (s.crowd.count === 1 && s.crowd.state[0] === ST_WAIT) stopped += PED_DT;
    if (crossedAt < 0 && s.crowd.crossOn[s.cross]! > 0) crossedAt = t;
  });
  assert.ok(stopped >= 0.6 && stopped <= 2.1, `temps d'observation au bord : ${stopped.toFixed(1)} s`);
  assert.ok(crossedAt > 0);
  assert.equal(s.crowd.count, 0);
  assert.equal(s.crowd.counters.prudent, 1);
  assert.equal(s.crowd.counters.green, 0);
});

test('service « trafic » : on attend un créneau entre les véhicules, puis on force après l\'attente maximale', () => {
  const s = crossroads();
  let gap = 2; // un véhicule arrive dans 2 s : pas le temps de traverser
  const asked: [number, number][] = [];
  s.crowd.trafic = adaptTrafic({ creneau: (seg, at) => { asked.push([seg, at]); return gap; } } satisfies TraficService);
  s.spawnAcross();
  run(s, 30, () => assert.equal(s.crowd.crossOn[s.cross], 0));
  assert.equal(s.crowd.state[0], ST_WAIT);
  assert.ok(asked.length > 0 && asked[0]![0] === s.seg && Math.abs(asked[0]![1] - s.g.eRoadS[s.cross]!) < 1e-3, 'créneau demandé pour (tronçon, abscisse du passage)');
  gap = Infinity;
  run(s, 30);
  assert.equal(s.crowd.count, 0);
  assert.equal(s.crowd.counters.prudent, 1);
  // Flot continu de véhicules : le piéton finit par s'engager (attente bornée).
  gap = 1;
  s.spawnAcross();
  run(s, MAX_WAIT_GAP + 40);
  assert.equal(s.crowd.count, 0);
  assert.equal(s.crowd.counters.forced, 1);
});

test('adaptateurs : services absents, mal formés ou en panne = pas d\'information (repli prudent)', () => {
  assert.equal(adaptFeux(undefined), null);
  assert.equal(adaptFeux({}), null);
  assert.equal(adaptFeux({ passage: 3 }), null);
  assert.equal(adaptTrafic(null), null);
  const out = { etat: 9, restant: 9 };
  const boom = adaptFeux({ passage: () => { throw new Error('panne'); } })!;
  assert.equal(boom.passage(1, 2, out), false);
  const bad = adaptFeux({ passage: () => ({ etat: 7, restant: 1 }) })!;
  assert.equal(bad.passage(1, 2, out), false);
  const noTime = adaptFeux({ passage: () => ({ etat: FEU_VERT }) })!;
  assert.equal(noTime.passage(1, 2, out), true);
  assert.deepEqual(out, { etat: FEU_VERT, restant: Infinity });
  assert.equal(adaptFeux({ passage: () => null })!.passage(1, 2, out), false);
  assert.equal(adaptTrafic({ creneau: () => { throw new Error('x'); } })!.creneau(1, 2), Infinity);
  assert.equal(adaptTrafic({ creneau: () => -3 })!.creneau(1, 2), Infinity);
});

test('intégration : un module « circulation » publie les feux ; les piétons les respectent et publient l\'occupation', () => {
  // Faux module de circulation : cycle de 40 s (20 s vert piéton, 5 s dégagement, 15 s rouge) sur tous les passages peints.
  let simTime = 0;
  const feux: FeuxService = {
    version: 1,
    passage: (nodeId) => {
      if (nodeId < 0) return null;
      const ph = (simTime + nodeId * 7) % 40;
      return ph < 20 ? { etat: FEU_VERT, restant: 20 - ph } : ph < 25 ? { etat: FEU_DEGAGEMENT, restant: 25 - ph } : { etat: FEU_ROUGE, restant: 40 - ph };
    },
  };
  let seen: PietonsService | undefined;
  const circulation: SimPlugin = {
    id: 'circulation',
    init: (ctx) => { ctx.provide('feux', feux); },
    onTick: (ctx) => { simTime += PED_DT; seen = ctx.use<PietonsService>('pietons'); },
  };
  const t = pedTown({ extra: [circulation] });
  assert.equal(t.system.command(t.ctx, 'config', { foule: 300 }).ok, true);
  let occMax = 0, waitMax = 0;
  for (let k = 0; k < 4000; k++) {
    t.sim.tick();
    const g = t.system.graph!, c = t.system.crowd;
    for (let e = 0; e < g.edgeCount; e++) {
      if (g.eKind[e] !== EDGE_CROSS_MARKED) continue;
      occMax = Math.max(occMax, c.crossOn[e]!);
      waitMax = Math.max(waitMax, c.crossWait[e]!);
    }
  }
  const st = t.system.stats();
  assert.equal(st.feux, true);
  assert.ok(st.graphe.passagesRegules >= 30, `${st.graphe.passagesRegules} passages régulés`);
  assert.ok(st.cumul.traverseesAuVert > 50, `${st.cumul.traverseesAuVert} traversées au vert`);
  // Les traversées prudentes restantes sont celles des passages NON régulés (traversées libres de pleine rue, impasses).
  assert.equal(st.cumul.traverseesForcees, 0);
  assert.ok(occMax >= 2, `${occMax} piétons au plus sur un même passage`);
  assert.ok(waitMax >= 2, `${waitMax} piétons au plus en attente à un même feu`);
  assert.ok(seen, 'service « pietons » publié');
  assert.equal(seen!.count, t.system.crowd.count);
  // L'occupation publiée pour la circulation est celle de la foule, passage par passage.
  const g = t.system.graph!, c = t.system.crowd;
  for (let e = 0; e < g.edgeCount; e++) {
    if (g.eKind[e] !== EDGE_CROSS_MARKED) continue;
    const o: { engages: number; enAttente: number } = (seen as PietonsService).passage(g.eNode[e]!, g.eSeg[e]!);
    assert.equal(o.engages, c.crossOn[e]);
    assert.equal(o.enAttente, c.crossWait[e]);
  }
});

test('intégration : engagement uniquement au vert sur les passages régulés (contrôle tick par tick)', () => {
  let simTime = 0;
  const etatDe = (nodeId: number): number => { const ph = (simTime + nodeId * 7) % 40; return ph < 20 ? FEU_VERT : ph < 25 ? FEU_DEGAGEMENT : FEU_ROUGE; };
  const feux: FeuxService = { passage: (nodeId) => (nodeId < 0 ? null : { etat: etatDe(nodeId), restant: ((): number => { const ph = (simTime + nodeId * 7) % 40; return ph < 20 ? 20 - ph : ph < 25 ? 25 - ph : 40 - ph; })() }) };
  const circulation: SimPlugin = { id: 'circulation', init: (ctx) => { ctx.provide('feux', feux); } };
  const t = pedTown({ extra: [circulation] });
  t.system.command(t.ctx, 'config', { foule: 250 });
  let prev = new Uint16Array(0), entriesGreen = 0, entriesOther = 0;
  for (let k = 0; k < 3000; k++) {
    // L'état du feu vu par les piétons pendant ce tick est celui d'avant l'avance du temps.
    t.sim.tick();
    const g = t.system.graph!, c = t.system.crowd;
    if (prev.length !== g.edgeCount) prev = new Uint16Array(g.edgeCount);
    for (let e = 0; e < g.edgeCount; e++) {
      if (g.eKind[e] === EDGE_CROSS_MARKED && g.eNode[e]! >= 0 && c.crossOn[e]! > prev[e]!) {
        if (etatDe(g.eNode[e]!) === FEU_VERT) entriesGreen += c.crossOn[e]! - prev[e]!; else entriesOther += c.crossOn[e]! - prev[e]!;
      }
      prev[e] = c.crossOn[e]!;
    }
    simTime += PED_DT;
  }
  assert.ok(entriesGreen > 40, `${entriesGreen} engagements au vert`);
  // Tolérance : un piéton autorisé à 3 m du bord pendant la dernière seconde utile du vert peut poser le pied juste après.
  assert.ok(entriesOther <= entriesGreen * 0.03, `${entriesOther} engagements hors vert pour ${entriesGreen} au vert`);
});
