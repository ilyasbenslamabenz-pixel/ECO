/**
 * Export de l'état des feux tricolores vers le rendu : disposition des têtes de feu (pied du poteau sur le
 * trottoir de droite, à la ligne d'arrêt, orienté vers le trafic entrant), états par bras cohérents avec la
 * simulation, deltas compacts (rien n'est envoyé quand rien ne change), transférables, et cohérence
 * « véhicule arrêté à la ligne ⇒ son feu est rouge (ou orange) ».
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Control, type TrafficNetworkInput } from '../../src/sim/traffic/network';
import { TrafficSystem } from '../../src/sim/traffic/system';
import { Simulation } from '../../src/sim/world';
import { collectTransferables, SIGNAL_HEAD_STRIDE, type DeltaMessage } from '../../src/shared/protocol';
import type { AssetCatalog } from '../../src/shared/catalog';
import { edge, grid, gridBuildings, vehicleCatalog } from './fixtures';

function cross(): TrafficNetworkInput {
  return {
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: -100, y: 0, z: 0 }, { id: 3, x: 100, y: 0, z: 0 }, { id: 4, x: 0, y: 0, z: -100 }, { id: 5, x: 0, y: 0, z: 100 }],
    edges: [edge(10, 2, 1, -100, 0, 0, 0, 'avenue'), edge(11, 1, 3, 0, 0, 100, 0, 'avenue'), edge(12, 4, 1, 0, -100, 0, 0, 'avenue'), edge(13, 1, 5, 0, 0, 0, 100, 'avenue')],
  };
}

test('feux : disposition d’un carrefour d’avenues (4 bras, poteau à droite de la ligne d’arrêt, face au trafic)', () => {
  const t = new TrafficSystem({ seed: 1, demand: false });
  t.setCatalog(vehicleCatalog());
  t.setNetwork(cross());
  t.ensureNetwork();
  const g = t.graph!;
  assert.equal(g.nodeControl[g.nodeIndex(1)], Control.Signal);
  const { heads, nodeIds } = t.signalLayout();
  assert.equal(nodeIds.length, 4);
  assert.equal(heads.length, 4 * SIGNAL_HEAD_STRIDE);
  assert.ok([...nodeIds].every((id) => id === 1));
  // bras venant de l'ouest (cap +X) : poteau avant le carrefour (x < 0), à droite du conducteur (+Z), hors chaussée
  let found = false;
  for (let i = 0; i < 4; i++) {
    const o = i * SIGNAL_HEAD_STRIDE;
    const x = heads[o]!, z = heads[o + 2]!, h = heads[o + 3]!;
    // tous les poteaux sont à la même distance du centre, hors de la chaussée (demi-chaussée 7,5 m)
    assert.ok(Math.hypot(x, z) > 10 && Math.hypot(x, z) < 16, `poteau ${i} à ${Math.hypot(x, z).toFixed(1)} m`);
    assert.equal(heads[o + 5], 2, '2 voies d’arrivée');
    assert.ok(heads[o + 4]! > 4 && heads[o + 4]! < 6, `portée ${heads[o + 4]}`);
    assert.ok(heads[o + 6]! >= 8, 'rayon du carrefour');
    assert.equal(heads[o + 7], 0, 'un seul carrefour');
    if (Math.abs(Math.sin(h) - 1) < 1e-3) {
      found = true;
      assert.ok(x < -8 && x > -12, `ligne d'arrêt x=${x}`);
      assert.ok(z > 7.5 && z < 11, `trottoir de droite z=${z}`);
    }
  }
  assert.ok(found, 'bras venant de l’ouest');
});

test('feux : états exportés = états simulés, phases opposées, cycle vert -> orange -> rouge', () => {
  const t = new TrafficSystem({ seed: 1, demand: false });
  t.setCatalog(vehicleCatalog());
  t.setNetwork(cross());
  t.step(0.1, 12);
  const g = t.graph!;
  const node = g.nodeIndex(1);
  const seen = new Set<string>();
  for (let k = 0; k < 1200; k++) {
    t.step(0.1, 12);
    const arr = t.signalStateArray();
    const ref = t.signalStates();
    assert.equal(arr.length, ref.length);
    for (let i = 0; i < arr.length; i++) assert.equal(arr[i], ref[i]!.state);
    for (let a = g.nodeArmStart[node]!, i = 0; a < g.nodeArmStart[node + 1]!; a++, i++) assert.equal(arr[i], t.signalState(node, a));
    // jamais deux bras perpendiculaires au vert en même temps
    const green = [...arr.keys()].filter((i) => arr[i] === 0).map((i) => g.armPhase[g.nodeArmStart[node]! + i]);
    assert.ok(new Set(green).size <= 1, 'une seule phase au vert');
    seen.add([...arr].join(''));
  }
  const all = [...seen].join('|');
  assert.ok(all.includes('0') && all.includes('1') && all.includes('2'), `vert, orange et rouge observés : ${all}`);
});

test('feux : deltas compacts (disposition une fois, états seulement s’ils changent), transférables, renvoi après instantané', () => {
  const catalog = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'assets/catalog.json'), 'utf8')) as AssetCatalog;
  const s = new Simulation();
  s.setCatalog(catalog);
  s.newGame({ seed: 7, mapChunks: 8, startMoney: 150_000_000, cityName: 'Feux', startHour: 10.5 });
  const r = s.runExt('buildCity', { preset: 'demo', settleWaves: 0, vehicles: 60 });
  assert.ok(r.ok);
  s.snapshot();
  const d1: DeltaMessage = s.takeDelta();
  assert.ok(d1.signals, 'premier delta : feux présents');
  assert.ok(d1.signals!.layout, 'premier delta : disposition présente');
  const n = d1.signals!.states.length;
  assert.ok(n >= 12, `${n} bras à feux dans la démo`);
  assert.equal(d1.signals!.layout!.heads.length, n * SIGNAL_HEAD_STRIDE);
  assert.equal(d1.signals!.layout!.nodeIds.length, n);
  const tr = collectTransferables(d1);
  assert.ok(tr.includes(d1.signals!.states.buffer as ArrayBuffer) && tr.includes(d1.signals!.layout!.heads.buffer as ArrayBuffer) && tr.includes(d1.signals!.layout!.nodeIds.buffer as ArrayBuffer));
  // sans pas de simulation, rien ne change : aucun octet de feux
  assert.equal(s.takeDelta().signals, undefined);
  // les états changent au fil des pas ; seuls les états sont renvoyés (même version, pas de disposition)
  let changed: DeltaMessage['signals'];
  for (let k = 0; k < 600 && !changed; k++) { s.tick(); changed = s.takeDelta().signals; }
  assert.ok(changed, 'un changement d’état est envoyé');
  assert.equal(changed!.layout, undefined);
  assert.equal(changed!.version, d1.signals!.version);
  assert.equal(changed!.states.length, n);
  // après un instantané, la disposition est renvoyée
  s.snapshot();
  const d3 = s.takeDelta();
  assert.ok(d3.signals?.layout, 'disposition renvoyée après instantané');
});

test('feux : un véhicule arrêté à la ligne d’arrêt d’un bras à feux a son feu au rouge (ou à l’orange)', () => {
  const t = new TrafficSystem({ seed: 5, maxVehicles: 500, demandScale: 2 });
  t.setCatalog(vehicleCatalog());
  t.setNetwork(grid(5, 5, 140, () => 'avenue'));
  t.setBuildings(gridBuildings(5, 5, 140));
  const out = new Float32Array(4);
  let checked = 0;
  for (let k = 0; k < 2400; k++) {
    t.step(0.1, 8);
    if (k < 300 || k % 5 !== 0) continue;
    const g = t.graph!;
    const states = t.signalStateArray();
    const { heads } = t.signalLayout();
    for (let i = 0; i < t.actCount; i++) {
      const v = t.act[i]!;
      const l = t.link[v]!;
      if (g.linkKind[l] !== 0 || t.v[v]! > 0.05) continue;
      if (g.linkLen[l]! - t.s[v]! > 6) continue; // pas en tête de file
      const node = g.linkToNode[l]!;
      if (g.nodeControl[node] !== Control.Signal) continue;
      // bras du véhicule dans la disposition exportée : même nœud et même cap
      t.vehiclePose(v, out, 0);
      let best = -1, bestD = Infinity;
      for (let a = 0; a < states.length; a++) {
        const o = a * SIGNAL_HEAD_STRIDE;
        const dh = Math.abs(Math.atan2(Math.sin(heads[o + 3]! - out[3]!), Math.cos(heads[o + 3]! - out[3]!)));
        const d = Math.hypot(heads[o]! - out[0]!, heads[o + 2]! - out[2]!);
        if (dh < 0.3 && d < bestD) { bestD = d; best = a; }
      }
      assert.ok(best >= 0 && bestD < 15, `tête de feu trouvée à ${bestD.toFixed(1)} m`);
      // un véhicule peut aussi attendre au vert parce que la sortie est bloquée : on ne vérifie que les arrêts dus au feu
      if (t.denyReason[v] === 1) { assert.notEqual(states[best], 0, 'arrêté au feu => feu non vert'); checked++; }
    }
  }
  assert.ok(checked > 20, `${checked} arrêts au feu vérifiés`);
});
