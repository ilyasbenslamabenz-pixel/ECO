/**
 * Module routes : relief (hauteur imposée ▲ / ▼, viaducs et passages dénivelés, tunnels, talus et murs de
 * soutènement, nivellement), giratoires, sauvegarde (champs facultatifs, anciennes sauvegardes).
 *   npx tsx --test tests/roads/relief.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ArcTable, RoadNetwork, ROAD_KINDS, commitRoadPlan, commitRoundabout, computeProfile, deserializeNetwork, gradeTerrainForRoads,
  networkRecords, planRoad, planRoundabout, serializeNetwork, sideTreatment, straightCubic, totalWidth, FILL_RATIO,
  GRADE_SEPARATION, TUNNEL_MIN_COVER, type ProfileEnv, type RoadRequest,
} from '../../src/sim/roads';
import type { TerrainData } from '../../src/shared/contracts';
import { Simulation } from '../../src/sim/world';
import { newTownSim, townCatalog } from '../sim/fixtures';

const flat: ProfileEnv = { heightAt: () => 10, waterLevel: 2 };
/** Colline gaussienne de 40 m centrée en (0, 0), terrain à 10 m ailleurs. */
const hill: ProfileEnv = { heightAt: (x, z) => 10 + 40 * Math.exp(-(x * x + z * z) / (2 * 70 * 70)), waterLevel: 2 };

function build(net: RoadNetwork, req: RoadRequest): number[] {
  const r = planRoad(net, req);
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return commitRoadPlan(net, r.plan).segmentIds;
}
const road = (x0: number, z0: number, x1: number, z1: number, elevation = 0): RoadRequest =>
  ({ kind: 'street', start: { x: x0, z: z0 }, end: { x: x1, z: z1 }, ...(elevation ? { elevation } : {}) });

test('Profil : hauteur imposée +8 m → viaduc au milieu, rampes, extrémités au sol, pente respectée', () => {
  const c = straightCubic(0, 0, 300, 0);
  const p = computeProfile(c, new ArcTable(c), 10, 10, ROAD_KINDS.street.maxGrade, flat, 8);
  const mid = Math.floor(p.count / 2);
  assert.ok(Math.abs(p.heights[mid]! - 18) < 0.3, `milieu à 18 m (${p.heights[mid]})`);
  assert.equal(p.heights[0], 10);
  assert.equal(p.heights[p.count - 1], 10);
  assert.equal(p.bridge[mid], 1, 'milieu en viaduc');
  assert.ok(p.piers.length > 0, 'piles de viaduc');
  assert.ok(p.maxGrade <= ROAD_KINDS.street.maxGrade * 1.05);
  assert.equal(p.tunnel.reduce((a, b) => a + b, 0), 0);
  // Sans hauteur imposée : route au sol.
  const g = computeProfile(c, new ArcTable(c), 10, 10, ROAD_KINDS.street.maxGrade, flat);
  assert.ok(g.heights.every((h) => Math.abs(h - 10) < 1e-3) && g.bridge.every((b) => b === 0));
});

test('Profil : hauteur imposée négative sous une colline → tunnel rectiligne ; sans ▼, pas de tunnel', () => {
  const c = straightCubic(-200, 0, 200, 0);
  const arc = new ArcTable(c);
  const p = computeProfile(c, arc, 10.2, 10.2, ROAD_KINDS.street.maxGrade, hill, -8);
  const mid = Math.floor(p.count / 2);
  assert.equal(p.tunnel[mid], 1, 'tunnel sous le sommet');
  assert.ok(p.ground[mid]! - p.heights[mid]! >= TUNNEL_MIN_COVER);
  assert.ok(p.longestTunnel > 60, `tunnel de ${p.longestTunnel} m`);
  assert.equal(p.tunnel[0], 0, 'extrémités à l\'air libre');
  assert.equal(p.tunnel[p.count - 1], 0);
  const q = computeProfile(c, arc, 10.2, 10.2, 0.5, hill);
  assert.equal(q.tunnel.reduce((a, b) => a + b, 0), 0, 'route au niveau du terrain : déblais, jamais de tunnel');
});

test('Passage supérieur : +8 m au-dessus d\'une route → pas de carrefour ; +4 m refusé ; à niveau : carrefour', () => {
  const net = new RoadNetwork(flat);
  const [base] = build(net, road(-150, 0, 150, 0));
  // +4 m : dénivelé insuffisant (refus explicite, pas de carrefour silencieux).
  const low = planRoad(net, road(0, -150, 0, 150, 4));
  assert.ok(!low.ok && low.error.code === 'COLLISION' && /▲|davantage/.test(low.error.message), JSON.stringify(low));
  const r = planRoad(net, road(0, -150, 0, 150, 8));
  assert.ok(r.ok, r.ok ? '' : r.error.message);
  if (!r.ok) return;
  assert.equal(r.plan.crossings.length, 0);
  assert.equal(r.plan.passes.length, 1);
  assert.ok(r.plan.passes[0]!.above);
  const ids = commitRoadPlan(net, r.plan).segmentIds;
  assert.equal(ids.length, 1, 'un seul tronçon : la route existante n\'est pas coupée');
  assert.ok(net.hasSegment(base!), 'route du dessous intacte');
  assert.equal(net.elevationOf(ids[0]!), 8);
  const prof = net.profile(ids[0]!);
  const s = 150; // abscisse du croisement
  const h = prof.heights[Math.round(s / prof.step)]!;
  assert.ok(h - 10 >= GRADE_SEPARATION, `tirant d'air ${h - 10} m`);
  // Une route au sol qui croise reste un carrefour.
  const net2 = new RoadNetwork(flat);
  build(net2, road(-150, 0, 150, 0));
  const r2 = planRoad(net2, road(0, -150, 0, 150));
  assert.ok(r2.ok && r2.plan.crossings.length === 1);
});

test('Passage inférieur : route au sol sous un viaduc existant (sans carrefour) ; carrefour sur un viaduc refusé', () => {
  const net = new RoadNetwork(flat);
  build(net, road(0, -150, 0, 150, 8));
  const r = planRoad(net, road(-150, 0, 150, 0));
  assert.ok(r.ok, r.ok ? '' : r.error.message);
  if (r.ok) { assert.equal(r.plan.crossings.length, 0); assert.equal(r.plan.passes.length, 1); assert.equal(r.plan.passes[0]!.above, false); }
});

test('Tunnel : route ▼ sous une colline, coût majoré, profil transmis au rendu (tunnelRuns)', () => {
  const net = new RoadNetwork(hill);
  const flatRoute = planRoad(net, { ...road(-200, 0, 200, 0), kind: 'street' });
  const r = planRoad(net, road(-200, 0, 200, 0, -12));
  assert.ok(r.ok, r.ok ? '' : r.error.message);
  if (!r.ok) return;
  assert.ok(r.plan.tunnelLength > 50, `tunnel ${r.plan.tunnelLength} m`);
  if (flatRoute.ok) assert.ok(r.plan.cost > flatRoute.plan.cost);
  const [id] = commitRoadPlan(net, r.plan).segmentIds;
  const rec = networkRecords(net).edges.find((e) => e.id === id)!;
  assert.ok(rec.tunnelRuns && rec.tunnelRuns.length >= 2);
  assert.equal(rec.elev, -12);
  // Le rendu reconstruit le même profil (tunnel compris).
  const view = new RoadNetwork(hill);
  for (const n of networkRecords(net).nodes) view.addNode(n.x, n.z, n.y, n.id);
  view.addSegment(rec.a, rec.b, 'street', undefined, rec.id, rec.elev);
  view.setProfile(rec.id, rec.profile!, rec.bridgeRuns ?? [], rec.tunnelRuns ?? [], rec.walls ?? []);
  assert.deepEqual(Array.from(view.profile(rec.id).tunnel), Array.from(net.profile(id!).tunnel));
});

test('Bords : talus en remblai ou déblai modéré, mur au bord de l\'eau, en remblai très haut et en déblai profond', () => {
  const water = (): number => 2;
  // Remblai de 1 m sur terrain plat : talus de ~2 m (1/2).
  const a = sideTreatment(11, () => 10, water);
  assert.equal(a.kind, 'fill');
  assert.ok(Math.abs(a.width - 1 * FILL_RATIO) <= 0.5);
  // Remblai au bord de l'eau : le pied tomberait dans la mer → mur (quai).
  const b = sideTreatment(3.2, (d) => 2.3 - d * 0.5, water);
  assert.equal(b.kind, 'wall-fill');
  // Remblai de 9 m : talus > 14 m → mur.
  assert.equal(sideTreatment(19, () => 10, water).kind, 'wall-fill');
  // Déblai de 2 m : talus ; de 5 m : mur.
  assert.equal(sideTreatment(10, () => 12, water).kind, 'cut');
  assert.equal(sideTreatment(10, () => 15, water).kind, 'wall-cut');
  assert.equal(sideTreatment(10, () => 10.05, water).kind, 'flat');
});

test('Nivellement : terrain sous la chaussée, sous le talus maillé (remblai), jamais au-dessus du talus (déblai)', () => {
  // Terrain en pente douce vers z+ : remblai d'un côté, déblai de l'autre.
  const W = 81, sp = 8, origin = -320;
  const heights = new Float32Array(W * W);
  for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) heights[j * W + i] = 10 + (origin + j * sp) * 0.15;
  const terrain: TerrainData = { samplesX: W, samplesZ: W, spacing: sp, originX: origin, originZ: origin, heights, waterLevel: 2 } as unknown as TerrainData;
  const natural = new Float32Array(heights);
  const env: ProfileEnv = {
    heightAt: (x, z) => 10 + Math.max(origin, Math.min(origin + (W - 1) * sp, z)) * 0.15, waterLevel: 2,
  };
  const net = new RoadNetwork(env);
  const [id] = build(net, road(-120, 0, 120, 0));
  gradeTerrainForRoads(terrain, net);
  const prof = net.profile(id!);
  const ht = totalWidth(ROAD_KINDS.street) / 2;
  let checked = 0;
  for (let j = 0; j < W; j++) {
    for (let i = 0; i < W; i++) {
      const x = origin + i * sp, z = origin + j * sp;
      if (Math.abs(x) > 80) continue;
      const k = j * W + i;
      const s = x + 120;
      const road = prof.heights[Math.round(s / prof.step)]!;
      if (prof.bridge[Math.round(s / prof.step)]) continue;
      const lat = Math.abs(z);
      if (lat <= ht) { assert.ok(terrain.heights[k]! <= road - 0.19, `plateforme ${terrain.heights[k]} / ${road}`); checked++; }
      else if (natural[k]! < road) {
        const talus = road + ROAD_KINDS.street.curbHeight - (lat - ht) / FILL_RATIO;
        assert.ok(terrain.heights[k]! <= Math.max(natural[k]!, talus) + 1e-4, 'terrain sous le talus');
        checked++;
      }
    }
  }
  assert.ok(checked > 20);
});

test('Giratoire sur un carrefour en + : anneau à sens unique (sens antihoraire), branches raccordées, centre supprimé', () => {
  const net = new RoadNetwork(flat);
  build(net, road(-150, 0, 150, 0));
  build(net, road(0, -150, 0, 150));
  const center = net.nodeNear(0, 0, 1);
  assert.ok(center >= 0);
  const r = planRoundabout(net, { x: 2, z: -3, size: 'small' });
  assert.ok(r.ok, r.ok ? '' : r.error.message);
  if (!r.ok) return;
  assert.equal(r.plan.arms.length, 4);
  const { segmentIds } = commitRoundabout(net, r.plan);
  assert.ok(segmentIds.length >= 4);
  assert.ok(!net.hasNode(center), 'centre supprimé');
  for (const id of segmentIds) {
    assert.equal(net.kindOf(id), 'oneway');
    assert.deepEqual(net.ringOf(id), [0, 0, 18]);
  }
  // Sens antihoraire vu du dessus (nord = −z) : l'angle atan2(z, x) décroît de a vers b.
  for (const id of segmentIds) {
    const [a, b] = net.endpoints(id);
    const pa = net.nodePos(a), pb = net.nodePos(b);
    let d = Math.atan2(pb.z, pb.x) - Math.atan2(pa.z, pa.x);
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    assert.ok(d < 0, 'sens de circulation');
  }
  // Chaque entrée : nœud de degré 3 (deux arcs + la branche).
  const entries = net.nodeIds().filter((n) => net.incident(n).length === 3);
  assert.equal(entries.length, 4);
  // Second giratoire au même endroit refusé.
  assert.ok(!planRoundabout(net, { x: 18, z: 0, size: 'small' }).ok);
});

test('Giratoire sur une route droite (2 branches), grand modèle ; refus loin de toute route ou branche trop courte', () => {
  const net = new RoadNetwork(flat);
  build(net, road(-200, 40, 200, 40));
  const r = planRoundabout(net, { x: 10, z: 42, size: 'large' });
  assert.ok(r.ok, r.ok ? '' : r.error.message);
  if (r.ok) {
    assert.equal(r.plan.arms.length, 2);
    assert.equal(r.plan.r, 28);
    const ids = commitRoundabout(net, r.plan).segmentIds;
    assert.ok(ids.length >= 4, 'arcs ≤ 90°');
  }
  assert.ok(!planRoundabout(net, { x: 0, z: -120, size: 'small' }).ok, 'aucune route');
  const net2 = new RoadNetwork(flat);
  build(net2, road(0, 0, 30, 0));
  const short = planRoundabout(net2, { x: 0, z: 0, size: 'large' });
  assert.ok(!short.ok && /trop courte/.test(short.error.message));
});

test('Sérialisation : hauteur imposée et giratoire conservés ; ancien JSON sans ces champs lisible', () => {
  const net = new RoadNetwork(flat);
  build(net, road(-150, 0, 150, 0));
  build(net, road(0, -150, 0, 150, 8));
  const rb = planRoundabout(net, { x: 150, z: 0, size: 'small' });
  void rb;
  const json = serializeNetwork(net);
  const back = deserializeNetwork(JSON.parse(JSON.stringify(json)), flat);
  assert.ok(back.ok);
  if (back.ok) {
    assert.deepEqual(serializeNetwork(back.network), json);
    assert.ok(back.network.segmentIds().some((id) => back.network.elevationOf(id) === 8));
  }
  const old = JSON.parse(JSON.stringify(json));
  for (const s of old.segments) { delete s.elev; delete s.ring; }
  const o = deserializeNetwork(old, flat);
  assert.ok(o.ok && o.network.segmentIds().every((id) => o.network.elevationOf(id) === 0));
});

test('Sauvegarde : viaduc, tunnel et giratoire rechargés à l\'identique ; sauvegarde antérieure (sans champs) chargée', () => {
  const s = newTownSim();
  assert.ok(s.buildRoad({ type: 'street', points: [-200, 0, 200, 0] }).ok);
  assert.ok(s.buildRoad({ type: 'street', points: [-200, 120, 200, 120] }).ok);
  const via = s.buildRoad({ type: 'street', points: [0, -120, 0, 240], elevation: 12 });
  assert.ok(via.ok, via.ok ? '' : via.error.message);
  const rb = s.runExt('buildRoundabout', { x: -120, z: 120, size: 'small' });
  assert.ok(rb.ok, rb.ok ? '' : rb.error.message);
  const save = JSON.parse(JSON.stringify(s.toSave()));
  assert.ok(save.roads.edges.some((e: { elev?: number }) => e.elev === 12), 'hauteur sauvegardée');
  assert.ok(save.roads.edges.some((e: { ring?: unknown }) => Array.isArray(e.ring)), 'giratoire sauvegardé');
  const b = new Simulation();
  b.setCatalog(townCatalog());
  assert.equal(b.fromSave(save), null);
  assert.deepEqual(b.roadRecords(), s.roadRecords());
  // Sauvegarde d'avant le module : mêmes routes sans les champs facultatifs → routes ordinaires, chargement sans erreur.
  const old = JSON.parse(JSON.stringify(save));
  for (const e of old.roads.edges) { delete e.elev; delete e.ring; delete e.tunnelRuns; delete e.walls; }
  const c = new Simulation();
  c.setCatalog(townCatalog());
  const err = c.fromSave(old);
  assert.ok(err === null || err.code === 'BAD_SAVE', JSON.stringify(err));
  if (err === null) assert.ok(c.roadRecords().edges.every((e) => (e as { elev?: number }).elev === undefined));
});
