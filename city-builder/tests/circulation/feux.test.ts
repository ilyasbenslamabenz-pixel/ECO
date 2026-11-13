/**
 * API des feux publiée par la circulation pour les piétons (service « feux ») :
 * état par carrefour et par bras, feu piéton et temps restant, position des passages,
 * annonce de piétons qui fait céder les véhicules, et absence de lampadaire contre un mât.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TrafficSystem } from '../../src/sim/traffic/system';
import { inputFromRoadNetwork, CROSSWALK_CENTER, STOP_LINE_SIDEWALK } from '../../src/sim/traffic/adapters';
import { TrafficGraph, Control } from '../../src/sim/traffic/network';
import { grid, gridBuildings, vehicleCatalog } from '../vehicles/fixtures';
import { FEUX_SERVICE, FEU_ORANGE, FEU_ROUGE, FEU_VERT, type FeuxApi } from '../../src/shared/protocol-ext/circulation';
import { Simulation } from '../../src/sim/world';
import { townCatalog } from '../sim/fixtures';
import { signalPolePositions, tooCloseToSignalPole } from '../../src/render/traffic/poles';
import { SIGNAL_HEAD_STRIDE } from '../../src/shared/protocol';

/** Réseau d'avenues : 3 × 3 carrefours, tous à feux. */
function avenues(): TrafficSystem {
  const t = new TrafficSystem({ seed: 3, maxVehicles: 400, demandScale: 1.5 });
  t.setCatalog(vehicleCatalog());
  t.setNetwork(grid(3, 3, 140, () => 'avenue'));
  t.setBuildings(gridBuildings(3, 3, 140));
  t.step(0, 8);
  return t;
}

test('feux : chaque bras de carrefour porte un passage piéton, entre la ligne d\'arrêt et le carrefour', () => {
  const t = avenues();
  const g = (t as unknown as { graph: TrafficGraph }).graph;
  const centre = g.nodeIndex(5); // nœud central de la grille 3×3
  assert.equal(g.nodeControl[centre], Control.Signal, 'carrefour central à feux');
  let n = 0;
  for (let leg = g.nodeLegStart[centre]!; leg < g.nodeLegStart[centre + 1]!; leg++) {
    const cross = g.legCross[leg]!, stop = g.legStop[leg]!;
    assert.ok(cross > 0, 'passage présent');
    assert.ok(cross < stop, `passage (${cross.toFixed(1)} m) en deçà de la ligne d'arrêt (${stop.toFixed(1)} m)`);
    assert.ok(g.legHalf[leg]! > 3, 'largeur traversée plausible');
    n++;
  }
  assert.equal(n, 4, 'quatre bras');
  const ids = t.crossings().map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, 'identifiants de passage uniques');
  assert.ok(ids.length >= 12, `passages du réseau : ${ids.length}`);
});

test('feux : le feu piéton d\'un bras est rouge quand le bras a le vert, et inversement', () => {
  const t = avenues();
  const api: FeuxApi = t.feuxApi();
  const j = api.junctions().find((x) => x.arms.length === 4)!;
  assert.ok(j, 'carrefour à 4 bras');
  let vus = { vert: 0, orange: 0, rouge: 0 };
  for (let k = 0; k < 1200; k++) {
    t.step(0.1, 9);
    const etat = api.junction(j.junctionId)!;
    for (const bras of etat.arms) {
      if (bras.crossingId < 0) continue;
      const passage = api.crossing(bras.crossingId)!;
      assert.equal(passage.controlled, true);
      if (bras.state === FEU_VERT) assert.equal(passage.walk, FEU_ROUGE, 'véhicules au vert -> piétons au rouge');
      if (passage.walk === FEU_VERT) assert.notEqual(bras.state, FEU_VERT);
      assert.ok(passage.remaining >= 0 && passage.remaining < 200, `temps restant ${passage.remaining}`);
      if (passage.walk === FEU_VERT) vus.vert++;
      else if (passage.walk === FEU_ORANGE) vus.orange++;
      else vus.rouge++;
    }
  }
  assert.ok(vus.vert > 0 && vus.orange > 0 && vus.rouge > 0, `états piétons observés : ${JSON.stringify(vus)}`);
});

test('feux : le temps restant annoncé correspond au changement d\'état observé', () => {
  const t = avenues();
  const api = t.feuxApi();
  const id = api.crossings()[0]!.id;
  let verifs = 0;
  for (let k = 0; k < 2000 && verifs < 3; k++) {
    const avant = api.crossing(id)!;
    const restant = avant.remaining;
    if (avant.walk !== FEU_VERT || restant < 1 || restant > 60) { t.step(0.1, 9); continue; }
    const pas = Math.round(restant / 0.1);
    for (let i = 0; i < pas - 2; i++) t.step(0.1, 9);
    assert.equal(api.crossing(id)!.walk, FEU_VERT, 'encore vert juste avant l\'échéance');
    t.step(0.1, 9); t.step(0.1, 9); t.step(0.1, 9);
    assert.notEqual(api.crossing(id)!.walk, FEU_VERT, 'changement d\'état à l\'échéance annoncée');
    verifs++;
  }
  assert.equal(verifs, 3, 'trois échéances vérifiées');
});

test('feux : des piétons annoncés sur un passage arrêtent les véhicules qui doivent le franchir', () => {
  // carrefour simple sans feux (priorité à droite) : seul l'effet des piétons est mesuré
  const t = new TrafficSystem({ seed: 9, maxVehicles: 200, demand: false });
  t.setCatalog(vehicleCatalog());
  t.setNetwork(grid(3, 3, 140, () => 'rue'));
  t.step(0, 8);
  const api = t.feuxApi();
  assert.equal(api.announcePedestrians(999999, 5), false, 'passage inconnu refusé');

  const g = (t as unknown as { graph: TrafficGraph }).graph;
  // véhicule sur l'arc qui arrive au nœud central, destination au-delà
  const run = (avecPietons: boolean): number => {
    const sys = new TrafficSystem({ seed: 9, maxVehicles: 200, demand: false });
    sys.setCatalog(vehicleCatalog());
    sys.setNetwork(grid(3, 3, 140, () => 'rue'));
    sys.step(0, 8);
    const gg = (sys as unknown as { graph: TrafficGraph }).graph;
    const e = gg.edgeIndex(1); // nœud 1 -> nœud 2 (ligne du haut)
    const e2 = gg.edgeIndex(2); // nœud 2 -> nœud 3
    const v = sys.spawnVehicle(e * 2, 0, 5, e2 * 2, 60, 0);
    assert.ok(v >= 0, 'véhicule créé');
    if (avecPietons) {
      // passage à l'entrée du nœud 2 côté tronçon 2 (extrémité a) et côté tronçon 1 (extrémité b)
      for (const c of sys.feuxApi().crossingsNear(gg.nodeX[gg.nodeIndex(2)]!, gg.nodeZ[gg.nodeIndex(2)]!, 30)) {
        sys.feuxApi().announcePedestrians(c.id, 25);
      }
    }
    for (let k = 0; k < 200; k++) sys.step(0.1, 9);
    if (!sys.alive[v]) return 1e6; // arrivé : distance maximale
    const pose = new Float32Array(4);
    sys.vehiclePose(v, pose, 0);
    return pose[0]!; // progression le long de l'axe x (ligne du haut de la grille)
  };
  const libre = run(false);
  const bloque = run(true);
  assert.ok(libre > bloque + 20, `véhicule retenu par les piétons (libre ${libre.toFixed(1)} vs ${bloque.toFixed(1)})`);
  void g;
});

test('feux : API publiée par le module et consommable par un autre module (ctx.use)', () => {
  const s = new Simulation();
  s.setCatalog(townCatalog());
  s.newGame({ seed: 4, mapChunks: 4, startMoney: 50_000_000, cityName: 'Feux', terrain: { hydrology: 'aucune', rivers: 0 } });
  assert.ok(s.buildRoad({ kind: 'avenue', type: 'avenue', points: [-200, 0, 200, 0] }).ok);
  assert.ok(s.buildRoad({ kind: 'avenue', type: 'avenue', points: [0, -200, 0, 200] }).ok);
  s.tick(1);
  const ctx = s.plugins.contextOf('pietons')!;
  const api = ctx.use<FeuxApi>(FEUX_SERVICE);
  assert.ok(api, 'service « feux » publié par la circulation');
  assert.ok(api!.version >= 1);
  const passages = api!.crossings();
  assert.equal(passages.length, 4, 'quatre passages au carrefour unique');
  for (const p of passages) {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.z), 'position du passage');
    assert.ok(Math.hypot(p.ax - p.bx, p.az - p.bz) > 5, 'extrémités de part et d\'autre de la chaussée');
    assert.ok(Math.abs(Math.hypot(p.ax - p.bx, p.az - p.bz) - p.widthM) < 1.5, 'largeur cohérente');
  }
  const proche = api!.crossingsNear(passages[0]!.x, passages[0]!.z, 1);
  assert.equal(proche.length, 1);
  assert.equal(proche[0]!.id, passages[0]!.id);
});

test('feux : les mâts sont connus du rendu (aucun lampadaire ne doit s\'y coller)', () => {
  const t = avenues();
  const { heads } = t.signalLayout();
  const poles = signalPolePositions(heads);
  assert.equal(poles.length, heads.length / SIGNAL_HEAD_STRIDE);
  assert.ok(poles.length >= 12, `mâts : ${poles.length}`);
  assert.ok(tooCloseToSignalPole(poles[0]!.x + 1, poles[0]!.z, poles), 'lampadaire à 1 m : refusé');
  assert.ok(!tooCloseToSignalPole(poles[0]!.x + 9, poles[0]!.z + 9, poles), 'lampadaire à 12 m : accepté');
});

test('feux : marquage et simulation aux mêmes cotes (ligne d\'arrêt, passage)', () => {
  const s = new Simulation();
  s.setCatalog(townCatalog());
  s.newGame({ seed: 4, mapChunks: 4, startMoney: 50_000_000, cityName: 'Cotes', terrain: { hydrology: 'aucune', rivers: 0 } });
  assert.ok(s.buildRoad({ kind: 'avenue', type: 'avenue', points: [-200, 0, 200, 0] }).ok);
  assert.ok(s.buildRoad({ kind: 'avenue', type: 'avenue', points: [0, -200, 0, 200] }).ok);
  const input = inputFromRoadNetwork(s.net);
  const avecArret = input.edges.filter((e) => e.stopA !== undefined || e.stopB !== undefined);
  assert.equal(avecArret.length, 4, 'quatre tronçons débouchant sur le carrefour');
  for (const e of input.edges) {
    for (const [stop, cross] of [[e.stopA, e.crossA], [e.stopB, e.crossB]] as [number | undefined, number | undefined][]) {
      if (stop === undefined) continue;
      assert.ok(cross !== undefined && cross > 0, 'passage peint sur une avenue (trottoirs)');
      // mêmes cotes que src/render/roads/builder.ts : recul + 5,6 m (arrêt) et recul + 2,8 m (passage)
      assert.ok(Math.abs(stop - cross! - (STOP_LINE_SIDEWALK - CROSSWALK_CENTER)) < 1e-6);
    }
  }
});
