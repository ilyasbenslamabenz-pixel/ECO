/**
 * Tests du maillage routier (builder pur, sans GPU) et du RoadNetworkRenderer en mode
 * « enregistrements » (contrat IRoadRenderer), exécutés en Node.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RoadNetwork, commitRoadPlan, planRoad, networkRecords, type ProfileEnv, type RoadRequest } from '../../src/sim/roads';
import { LAYERS, buildJunction, buildRoundaboutIsland, buildSegment, newOutput, talusFoot } from '../../src/render/roads/builder';
import { commitRoundabout, planRoundabout } from '../../src/sim/roads';
import { RoadNetworkRenderer } from '../../src/render/roads/renderer';

const flat: ProfileEnv = { heightAt: () => 10, waterLevel: 2 };
const river: ProfileEnv = { heightAt: (_x, z) => (Math.abs(z - 200) < 40 ? -1 : 10), waterLevel: 2 };
const R = (kind: RoadRequest['kind'], x0: number, z0: number, x1: number, z1: number): RoadRequest => ({ kind, start: { x: x0, z: z0 }, end: { x: x1, z: z1 } });
function build(net: RoadNetwork, req: RoadRequest): number[] {
  const r = planRoad(net, req);
  if (!r.ok) throw new Error(r.error.message);
  return commitRoadPlan(net, r.plan).segmentIds;
}

function meshAll(net: RoadNetwork): ReturnType<typeof newOutput> {
  const out = newOutput();
  const ctx = { net, junctions: new Map() };
  for (const s of net.segmentIds()) buildSegment(out, ctx, s);
  for (const n of net.nodeIds()) buildJunction(out, ctx, n);
  return out;
}

/** Normale (y) d'un triangle. */
function triNy(p: number[], a: number, b: number, c: number): number {
  const e1x = p[b * 3]! - p[a * 3]!, e1z = p[b * 3 + 2]! - p[a * 3 + 2]!;
  const e2x = p[c * 3]! - p[a * 3]!, e2z = p[c * 3 + 2]! - p[a * 3 + 2]!;
  return e1z * e2x - e1x * e2z;
}

test('Maillage : couches attendues, aucune valeur invalide, surfaces de roulement orientées vers le haut', () => {
  const net = new RoadNetwork(flat);
  build(net, R('boulevard', -200, 0, 200, 0));
  build(net, R('street', 0, -150, 0, 150));
  build(net, R('pedestrian', 100, 0, 100, 120));
  build(net, R('oneway', -100, -150, -100, 0));
  const out = meshAll(net);
  // Bords : talus raccordé au terrain (la jupe sombre d'origine est remplacée par le talus du module routes).
  for (const l of ['asphalt', 'sidewalk', 'curb', 'grass', 'paint', 'pavers', 'talus'] as const) {
    assert.ok(out.layers.get(l)!.idx.length > 0, `couche ${l} non vide`);
  }
  for (const l of LAYERS) {
    const b = out.layers.get(l)!;
    assert.ok(b.pos.every(Number.isFinite), `${l} : coordonnées finies`);
    assert.ok(b.idx.every((i) => i >= 0 && i < b.vertexCount), `${l} : indices valides`);
  }
  for (const l of ['asphalt', 'paint', 'pavers', 'sidewalk', 'grass', 'talus'] as const) {
    const b = out.layers.get(l)!;
    let down = 0, flatTris = 0;
    for (let i = 0; i < b.idx.length; i += 3) {
      const ny = triNy(b.pos, b.idx[i]!, b.idx[i + 1]!, b.idx[i + 2]!);
      if (Math.abs(ny) < 1e-9) continue;
      flatTris++;
      if (ny < 0) down++;
    }
    assert.equal(down, 0, `${l} : ${down}/${flatTris} triangles retournés`);
  }
  // Décor : lampadaires et arbres d'alignement, mobilier de la rue piétonne.
  const kinds = new Set(out.decor.map((d) => d.kind));
  for (const k of ['lamp', 'tree', 'bench', 'planter'] as const) assert.ok(kinds.has(k), `décor ${k}`);
  assert.ok(out.decor.every((d) => Number.isFinite(d.x + d.y + d.z + d.rot)));
});

test('Maillage : la dalle de carrefour couvre le nœud, passages piétons peints sur les branches', () => {
  const net = new RoadNetwork(flat);
  build(net, R('street', -100, 0, 100, 0));
  build(net, R('street', 0, -100, 0, 100));
  const center = net.nodeNear(0, 0, 1);
  const out = newOutput();
  buildJunction(out, { net, junctions: new Map() }, center);
  const a = out.layers.get('asphalt')!;
  // Point (0,0) et points proches couverts par un triangle de la dalle.
  const covered = (x: number, z: number): boolean => {
    for (let i = 0; i < a.idx.length; i += 3) {
      const [p, q, r] = [a.idx[i]!, a.idx[i + 1]!, a.idx[i + 2]!].map((k) => [a.pos[k * 3]!, a.pos[k * 3 + 2]!] as const);
      const s = (u: readonly [number, number], v: readonly [number, number]): number => (v[0] - u[0]) * (z - u[1]) - (v[1] - u[1]) * (x - u[0]);
      const d1 = s(p!, q!), d2 = s(q!, r!), d3 = s(r!, p!);
      if ((d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0)) return true;
    }
    return false;
  };
  for (const [x, z] of [[0, 0], [3, 3], [-3, 2], [0, -5], [5, 0]]) assert.ok(covered(x!, z!), `(${x}, ${z}) couvert`);
  const full = meshAll(net);
  // 4 branches x (passage piéton ≈ 7 bandes + ligne d'arrêt) : beaucoup de peinture près du carrefour.
  const P = full.layers.get('paint')!;
  let nearPaint = 0;
  for (let i = 0; i < P.vertexCount; i++) if (Math.hypot(P.pos[i * 3]!, P.pos[i * 3 + 2]!) < 20) nearPaint++;
  assert.ok(nearPaint > 100, `peinture près du carrefour : ${nearPaint} sommets`);
});

test('Maillage : pont avec piles, tablier en béton et garde-corps au-dessus de l\'eau', () => {
  const net = new RoadNetwork(river);
  build(net, R('avenue', 0, 0, 0, 400));
  const out = meshAll(net);
  const c = out.layers.get('concrete')!, m = out.layers.get('metal')!;
  assert.ok(c.idx.length > 300, 'béton (tablier, corniche, poutre, parapet, piles)');
  assert.ok(m.idx.length > 100, 'garde-corps métalliques');
  // Des sommets de béton descendent jusqu'au lit de la rivière (piles).
  let low = Infinity;
  for (let i = 0; i < c.vertexCount; i++) low = Math.min(low, c.pos[i * 3 + 1]!);
  assert.ok(low < 1, `pile fondée sous l'eau (y min ${low.toFixed(1)})`);
  // Pas de jupe de rive (talus) sur le pont : la jupe reste hors de la zone d'eau.
  const sk = out.layers.get('skirt')!;
  for (let i = 0; i < sk.vertexCount; i++) {
    const z = sk.pos[i * 3 + 2]!;
    assert.ok(!(z > 175 && z < 225), 'pas de talus au-dessus de l\'eau');
  }
});

test('RoadNetworkRenderer (IRoadRenderer) : ajout par enregistrements, chunks, suppression', () => {
  const src = new RoadNetwork(flat);
  build(src, R('avenue', -300, 0, 300, 0));
  build(src, R('street', 0, -200, 0, 200));
  const recs = networkRecords(src);
  const scene = new THREE.Scene();
  const rr = new RoadNetworkRenderer(scene, () => 10, { waterLevel: 2 });
  rr.addRoads(recs.nodes, recs.edges);
  const st = rr.stats();
  assert.equal(st.segments, src.segCount);
  assert.ok(st.chunks >= 2, 'réseau réparti en chunks');
  assert.ok(st.meshes >= 5 && st.triangles > 2000, `maillage fusionné (${st.meshes} maillages, ${st.triangles} triangles)`);
  assert.ok(st.decorInstances > 10);
  let meshCount = 0;
  scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshCount++; });
  assert.equal(meshCount, st.meshes);
  // Compatibilité : enregistrement « contrat actuel » (type seul, sans courbe ni kind).
  rr.addRoads([{ id: 900, x: 400, y: 10, z: 400 }, { id: 901, x: 500, y: 10, z: 400 }], [{ id: 900, a: 900, b: 901, type: 'boulevard', length: 100 }]);
  assert.equal(rr.stats().segments, src.segCount + 1);
  rr.removeRoadEdges([...src.segmentIds(), 900]);
  const after = rr.stats();
  assert.equal(after.segments, 0);
  assert.equal(after.nodes, 0);
  assert.equal(after.chunks, 0);
  rr.dispose();
});

test('RoadNetworkRenderer : un tronçon coupé par un carrefour (delta retrait + ajout) reste affiché', () => {
  // Reproduit le delta de la simulation : l'avenue existante est retirée puis remplacée par ses morceaux,
  // qui réutilisent ses nœuds d'extrémité (absents de roadNodesAdded) — régression QA « route disparue ».
  const src = new RoadNetwork(flat);
  build(src, R('avenue', -300, 0, 300, 0));
  const rr = new RoadNetworkRenderer(new THREE.Scene(), () => 10, { waterLevel: 2 });
  const first = networkRecords(src);
  rr.addRoads(first.nodes, first.edges);
  src.takeChanges();
  const r = planRoad(src, { kind: 'street', start: { x: -60, z: -150 }, end: { x: 60, z: 150 }, control: { x: 120, z: 0 } });
  assert.ok(r.ok);
  commitRoadPlan(src, r.plan);
  const ch = src.takeChanges();
  const removed = ch.segmentsRemoved.filter((id) => !ch.segmentsAdded.includes(id));
  const added = ch.segmentsAdded.filter((id) => src.hasSegment(id));
  assert.ok(removed.length >= 1, 'l\'avenue a été coupée');
  const rec = networkRecords(src, ch.nodesAdded, added);
  rr.removeRoadEdges(removed);
  rr.addRoads(rec.nodes, rec.edges);
  assert.equal(rr.stats().segments, src.segCount, 'tous les tronçons (morceaux de l\'avenue compris) sont affichés');
  assert.equal(rr.stats().nodes, src.nodeCount);
  rr.dispose();
});

test('Enregistrements étendus : le rendu reprend le profil validé par la simulation (pont compris)', () => {
  const src = new RoadNetwork(river);
  build(src, R('street', 0, 0, 0, 400));
  const recs = networkRecords(src);
  assert.ok(recs.edges.every((e) => e.profile && e.profile.length >= 2 && Array.isArray(e.bridgeRuns)));
  // Le rendu connaît un terrain différent (ex. nivelé) : il doit garder les hauteurs de la simulation.
  const rr = new RoadNetworkRenderer(new THREE.Scene(), () => 0, { waterLevel: 2 });
  rr.addRoads(recs.nodes, recs.edges);
  for (const e of recs.edges) {
    const p = rr.net.profile(e.id), q = src.profile(e.id);
    assert.equal(p.count, q.count);
    for (let i = 0; i < p.count; i++) assert.ok(Math.abs(p.heights[i]! - q.heights[i]!) < 0.006);
    assert.ok(Math.abs(p.bridgeLength - q.bridgeLength) < 1e-6);
    assert.deepEqual(p.piers.map((v) => Math.round(v)), q.piers.map((v) => Math.round(v)));
  }
  rr.dispose();
});

test('Relief : talus raccordé au terrain, mur au bord de l\'eau, portails de tunnel, culées, îlot de giratoire', () => {
  // Pied du talus : remblai de 2 m sur sol plat → pied ~4 m plus loin, sous le terrain.
  const f = talusFoot(() => 10, 0, 12, 0, 1, 0);
  assert.equal(f.kind, 'fill');
  assert.ok(f.x > 3.5 && f.x < 5.5 && f.y <= 10, JSON.stringify(f));
  const c = talusFoot(() => 13, 0, 10, 0, 1, 0);
  assert.equal(c.kind, 'cut');
  // Viaduc : piles et culées en béton, talus aux rampes ; pile jamais sur la route du dessous.
  const net = new RoadNetwork(flat);
  build(net, R('street', -150, 0, 150, 0));
  const r = planRoad(net, { ...R('street', 0, -150, 0, 150), elevation: 8 });
  assert.ok(r.ok);
  if (!r.ok) return;
  const [via] = commitRoadPlan(net, r.plan).segmentIds;
  const out = newOutput();
  buildSegment(out, { net, junctions: new Map() }, via!);
  assert.ok(out.layers.get('concrete')!.idx.length > 0, 'tablier, piles, culées');
  const con = out.layers.get('concrete')!;
  // Aucun sommet de pile (sous le tablier) dans l'emprise de la rue croisée (|z| < 6,2 m, |x| < 2 m).
  let onRoad = 0;
  for (let i = 0; i < con.pos.length; i += 3) if (Math.abs(con.pos[i + 2]!) < 6 && Math.abs(con.pos[i]!) < 2 && con.pos[i + 1]! < 12) onRoad++;
  assert.equal(onRoad, 0, 'pile sur la route croisée');
  // Tunnel : revêtement sombre et portails.
  const hill: ProfileEnv = { heightAt: (x, z) => 10 + 40 * Math.exp(-(x * x + z * z) / (2 * 70 * 70)), waterLevel: 2 };
  const tn = new RoadNetwork(hill);
  const t = planRoad(tn, { ...R('street', -200, 0, 200, 0), elevation: -12 });
  assert.ok(t.ok);
  if (!t.ok) return;
  const [tid] = commitRoadPlan(tn, t.plan).segmentIds;
  const to = newOutput();
  buildSegment(to, { net: tn, junctions: new Map() }, tid!);
  assert.ok(to.layers.get('tunnel')!.idx.length > 0, 'revêtement de tunnel');
  assert.ok(to.layers.get('concrete')!.idx.length > 0, 'portails');
  // Au milieu du tunnel, aucune chaussée dessinée (sous le terrain).
  const asp = to.layers.get('asphalt')!;
  let inside = 0;
  for (let i = 0; i < asp.pos.length; i += 3) if (Math.abs(asp.pos[i]!) < 25) inside++;
  assert.equal(inside, 0);
  // Quai : remblai au bord de l'eau → mur de soutènement (béton) au lieu d'un talus.
  const sea: ProfileEnv = { heightAt: (_x, z) => (z > 7 ? 0 : 2.45), waterLevel: 2 };
  const qn = new RoadNetwork(sea);
  const [q] = build(qn, R('street', -80, 0, 80, 0));
  const qp = qn.profile(q!);
  assert.ok(qp.wallL!.some((v) => v === 1) || qp.wallR!.some((v) => v === 1), 'mur côté mer');
  // Giratoire : îlot engazonné + arbres.
  const rn = new RoadNetwork(flat);
  build(rn, R('street', -150, 0, 150, 0));
  build(rn, R('street', 0, -150, 0, 150));
  const rb = planRoundabout(rn, { x: 0, z: 0, size: 'large' });
  assert.ok(rb.ok);
  if (!rb.ok) return;
  commitRoundabout(rn, rb.plan);
  const io = newOutput();
  buildRoundaboutIsland(io, { net: rn, junctions: new Map() }, 0, 0, 28);
  assert.ok(io.layers.get('grass')!.idx.length > 0 && io.decor.some((d) => d.kind === 'tree'));
  const whole = meshAll(rn);
  for (const l of LAYERS) assert.ok(whole.layers.get(l)!.pos.every(Number.isFinite), l);
});

test('Aperçu du tracé (▲ / ▼) : le ruban suit le profil 3D renvoyé par la simulation', async () => {
  const { RoadPreview } = await import('../../src/input/previews');
  const scene = new THREE.Scene();
  const p = new RoadPreview(scene, () => 10);
  const path: number[] = [];
  for (let x = 0; x <= 100; x += 4) path.push(x, 10 + 8 * Math.sin((Math.PI * x) / 100), 0, 1);
  p.show({ points: [0, 0, 100, 0], width: 12, validity: 'ok', start: { x: 0, z: 0 }, control: null, hover: { x: 100, z: 0, snap: 'free' }, path });
  const pos = (p as unknown as { ribbon: THREE.Mesh }).ribbon.geometry.getAttribute('position');
  let max = 0;
  for (let i = 0; i < pos.count; i++) max = Math.max(max, pos.getY(i));
  assert.ok(max > 17.5, `ruban à ${max} m (viaduc +8 m)`);
});
