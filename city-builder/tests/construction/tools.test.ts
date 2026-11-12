/**
 * Tests du module construction (cœur pur, sans navigateur) :
 * géométrie, miroir/picking, snapping façade-route, tracé de route, machine à états,
 * annulation — contre MockSim ET contre la VRAIE simulation (src/sim/world.ts via handleCommand).
 * Lancer : npx tsx --test tests/construction/*.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TILE_SIZE, PROTOCOL_VERSION } from '../../src/shared/constants';
import { rotateQuarter } from '../../src/shared/math';
import type { AssetCatalog } from '../../src/shared/catalog';
import type { CommandArgs, CommandName, CommandResult, DeltaMessage, SnapshotMessage } from '../../src/shared/protocol';
import { distSegmentRect, facadeNormal, gridFootprint, rayBox, rayTerrain, sampleBezier2, segmentIntersectsRect, footprintGroundY } from '../../src/client/tools/geometry';
import { WorldMirror } from '../../src/client/tools/mirror';
import { proposePlacement, rotationFacing } from '../../src/client/tools/snapping';
import { RoadDraft, snapRoadPoint } from '../../src/client/tools/road-draft';
import { ConstructionTools, LatestOnly, type SimPort } from '../../src/client/tools/machine';
import { MockSim } from '../../src/input/mocks';
import { Simulation } from '../../src/sim/world';
import { handleCommand } from '../../src/sim/handler';
import { terrainHeightAt } from '../../src/shared/terrain-gen';
import { testAsset, testCatalog } from '../fixtures/catalog';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
async function settle(): Promise<void> { for (let i = 0; i < 10; i++) await tick(); }

/* ------------------------------ Géométrie ------------------------------ */

test('géométrie : segment/rectangle et rayon/boîte', () => {
  assert.equal(segmentIntersectsRect(-10, 0, 10, 0, -1, -1, 1, 1), true);
  assert.equal(segmentIntersectsRect(-10, 5, 10, 5, -1, -1, 1, 1), false);
  assert.equal(distSegmentRect(-10, 5, 10, 5, -1, -1, 1, 1), 4);
  assert.equal(distSegmentRect(0, 0, 0, 0.5, -1, -1, 1, 1), 0);
  const t = rayBox({ ox: 0, oy: 100, oz: 0, dx: 0, dy: -1, dz: 0 }, -5, 0, -5, 5, 30, 5);
  assert.equal(t, 70);
  assert.equal(rayBox({ ox: 20, oy: 100, oz: 0, dx: 0, dy: -1, dz: 0 }, -5, 0, -5, 5, 30, 5), -1);
});

test('géométrie : rayon/terrain sur une pente', () => {
  const h = (x: number): number => x * 0.5;
  const d = Math.SQRT1_2;
  const p = rayTerrain({ ox: 0, oy: 50, oz: 0, dx: d, dy: -d, dz: 0 }, (x) => h(x));
  assert.ok(p);
  // y = 50 - x et y = x/2 => x = 33,33
  assert.ok(Math.abs(p!.x - 100 / 3) < 0.01, `x=${p!.x}`);
  assert.equal(rayTerrain({ ox: 0, oy: 50, oz: 0, dx: 0, dy: 1, dz: 0 }, () => 0), null);
});

test('géométrie : Bézier échantillonnée, extrémités exactes, segments ≥ 4 m', () => {
  const pts = sampleBezier2(0, 0, 50, 50, 100, 0, 12);
  assert.deepEqual(pts.slice(0, 2), [0, 0]);
  assert.deepEqual(pts.slice(-2), [100, 0]);
  for (let k = 0; k + 3 < pts.length; k += 2) assert.ok(Math.hypot(pts[k + 2]! - pts[k]!, pts[k + 3]! - pts[k + 1]!) >= 4);
});

test('géométrie : empreinte grille identique à Simulation.footprintFor', () => {
  const sim = new Simulation();
  sim.setCatalog(testCatalog());
  sim.newGame({ seed: 3, mapChunks: 2, startMoney: 1e6, cityName: 't' });
  const t = sim.terrain!;
  const a = sim.getAsset('grand_test')!;
  for (const [x, z, rot] of [[13.2, -7.9, 0], [3, 3, 1], [-41.7, 22.2, 2], [0.1, 0.1, 3]] as const) {
    const ref = sim.footprintFor(a, x, z, rot);
    const mine = gridFootprint(t.originX, t.originZ, a.footprint.tilesX, a.footprint.tilesZ, x, z, rot);
    assert.equal(mine.cx, ref.cx); assert.equal(mine.cz, ref.cz); assert.equal(mine.tx, ref.tx); assert.equal(mine.tz, ref.tz);
  }
});

test('géométrie : normale de façade cohérente avec rotateQuarter', () => {
  for (let r = 0; r < 4; r++) assert.deepEqual(facadeNormal(r), rotateQuarter(0, 1, r).map((v) => v + 0));
});

/* ------------------------------ Miroir / sélection ------------------------------ */

function mirrorWithCity(): WorldMirror {
  const cat = testCatalog();
  const m = new WorldMirror(cat);
  const heights = new Float32Array(33 * 33).fill(10);
  m.applySnapshot({
    kind: 'snapshot', params: { seed: 1, mapChunks: 1, startMoney: 0, cityName: 'T' },
    terrain: { samplesX: 33, samplesZ: 33, spacing: 8, originX: -128, originZ: -128, heights, waterLevel: 2 },
    buildings: [{ id: 1, assetId: 'maison_test', variant: 1, x: 40, z: 40, y: 10, rot: 0 }],
    roads: { nodes: [{ id: 1, x: -100, y: 10, z: 0 }, { id: 2, x: 100, y: 10, z: 0 }], edges: [{ id: 7, a: 1, b: 2, type: 'avenue', length: 200 }] },
    stats: new MockSim(cat).stats(),
  });
  return m;
}

test('miroir : sélection bâtiment (boîte 3D, hauteur de variante), route, rien', () => {
  const m = mirrorWithCity();
  // Rayon rasant qui touche le haut du bâtiment (hauteur 9 × 1,2 = 10,8 m au-dessus de y=10).
  const hit = m.pick({ ox: 0, oy: 20.5, oz: 40, dx: 1, dy: 0, dz: 0 }, null);
  assert.equal(hit?.kind, 'building');
  const miss = m.pick({ ox: 0, oy: 21, oz: 40, dx: 1, dy: 0, dz: 0 }, null);
  assert.equal(miss, null);
  const road = m.pick({ ox: 10, oy: 50, oz: 3, dx: 0, dy: -1, dz: 0 }, { x: 10, z: 3 });
  assert.equal(road?.kind, 'road');
  assert.equal(road?.kind === 'road' && road.id, 7);
  assert.equal(m.pick({ ox: 10, oy: 50, oz: 20, dx: 0, dy: -1, dz: 0 }, { x: 10, z: 20 }), null);
});

test('miroir : deltas (ajout/suppression) et version', () => {
  const m = mirrorWithCity();
  const v0 = m.version;
  m.applyDelta({ kind: 'delta', tick: 1, buildingsAdded: [{ id: 2, assetId: 'grand_test', variant: 0, x: -40, z: 40, y: 10, rot: 1 }], buildingsRemoved: [1], roadNodesAdded: [], roadEdgesAdded: [], roadEdgesRemoved: [7], vehicles: null, stats: m.stats! });
  assert.equal(m.buildings.size, 1);
  assert.ok(m.buildings.has(2));
  assert.equal(m.edges.size, 0);
  assert.ok(m.version > v0);
  const r = m.buildingRect(m.buildings.get(2)!)!;
  assert.equal(r.maxX - r.minX, 3 * TILE_SIZE); // tourné d'un quart : 4×3 -> 3×4
});

/* ------------------------------ Snapping ------------------------------ */

test('snapping : façade tournée vers la route, sans chevauchement, glisse le long de la voie', () => {
  const m = mirrorWithCity();
  const a = testAsset('maison_test');
  for (const side of [1, -1]) {
    const p = proposePlacement(m, a, 10, side * 18, { rot: 0, autoAlign: true });
    assert.equal(p.snapped, true);
    const [nx, nz] = rotateQuarter(0, 1, p.rot);
    assert.equal(nx + 0, 0); assert.equal(nz, -side, `façade vers la route (côté ${side})`);
    assert.equal(p.localConflict, false);
    // Bord côté route à ≤ 1,5 case de la chaussée (demi-largeur 8 m).
    const gap = side > 0 ? p.rect.minZ - 8 : -8 - p.rect.maxZ;
    assert.ok(gap >= 0 && gap <= 12, `écart ${gap}`);
  }
  const p1 = proposePlacement(m, a, -30, 18, { rot: 0, autoAlign: true });
  const p2 = proposePlacement(m, a, 30, 18, { rot: 0, autoAlign: true });
  assert.ok(p2.x - p1.x > 50, 'suit le curseur le long de la route');
  // Loin de toute route : placement libre avec la rotation du joueur.
  const free = proposePlacement(m, a, 10, 110, { rot: 3, autoAlign: true });
  assert.equal(free.snapped, false);
  assert.equal(free.rot, 3);
});

test('snapping : rotation choisie depuis la normale catalogue (façade déclarée vers +X)', () => {
  const a = testAsset('x', { frontage: [{ x: 8, z: 0, nx: 1, nz: 0, kind: 'pedestrian' }] });
  const r = rotationFacing(a, 0, -1);
  const [nx, nz] = rotateQuarter(1, 0, r);
  assert.deepEqual([nx + 0, nz], [0, -1]);
});

/* ------------------------------ Tracé de route ------------------------------ */

test('tracé : droite, courbe, retour, accrochage aux nœuds', () => {
  const m = mirrorWithCity();
  const s = snapRoadPoint(m, 97, 2, { radius: 8, angleSnap: false });
  assert.equal(s.snap, 'node'); assert.equal(s.x, 100);
  const e = snapRoadPoint(m, 0, 3, { radius: 8, angleSnap: false });
  assert.equal(e.snap, 'edge'); assert.equal(e.z, 0);
  const a = snapRoadPoint(m, 50, 61, { radius: 8, angleSnap: true }, { x: 50, z: 30 });
  assert.equal(a.snap, 'angle'); assert.ok(Math.abs(a.x - 50) < 1e-9);
  const d = new RoadDraft();
  assert.equal(d.click({ x: 0, z: 50, snap: 'free' }), 'continue');
  d.hover = { x: 60, z: 50, snap: 'free' };
  assert.deepEqual(d.points(), [0, 50, 60, 50]);
  assert.equal(d.click(d.hover), 'build');
  d.reset(); d.mode = 'curve';
  d.click({ x: 0, z: 50, snap: 'free' });
  assert.equal(d.click({ x: 50, z: 100, snap: 'free' }), 'continue');
  assert.equal(d.phase, 'control');
  d.hover = { x: 100, z: 50, snap: 'free' };
  const pts = d.points()!;
  assert.ok(pts.length > 4, 'courbe échantillonnée');
  assert.ok(d.back()); assert.equal(d.phase, 'start');
  assert.ok(d.back()); assert.equal(d.phase, 'idle');
  assert.equal(d.back(), false);
});

/* ------------------------------ Machine à états ------------------------------ */

test('LatestOnly : une seule requête en vol, la plus récente gagne', async () => {
  const q = new LatestOnly();
  const ran: number[] = [];
  let release!: () => void;
  q.run(() => new Promise<void>((r) => { ran.push(1); release = r; }));
  q.run(async () => { ran.push(2); });
  q.run(async () => { ran.push(3); });
  assert.deepEqual(ran, [1]);
  release();
  await settle();
  assert.deepEqual(ran, [1, 3]);
});

function flatMock(): MockSim {
  const cat: AssetCatalog = testCatalog();
  const sim = new MockSim(cat, 7, 2, 1_000_000);
  // Terrain plat au-dessus de l'eau pour des tests déterministes.
  sim.terrain.heights.fill(20);
  return sim;
}

function setup(sim: SimPort & { start?: (n: number) => void; step?: () => void }, cat: AssetCatalog): { m: WorldMirror; tools: ConstructionTools; notes: string[] } {
  const m = new WorldMirror(cat);
  sim.onSnapshot((s) => m.applySnapshot(s));
  sim.onDelta((d) => m.applyDelta(d));
  const notes: string[] = [];
  const tools = new ConstructionTools(m, sim, (t, k) => notes.push(`${k}:${t}`));
  return { m, tools, notes };
}

test('machine (MockSim) : aperçu validé par dryRun, pose, refus expliqué, annulation', async () => {
  const sim = flatMock();
  const { m, tools, notes } = setup(sim, sim.catalog);
  sim.start(0);
  assert.equal(tools.setTool('terraform'), false, 'terraformation indisponible (phase 2)');
  assert.ok(tools.setTool('building', { assetId: 'maison_test' }));
  tools.hover({ x: 20, z: 20 }, null);
  assert.equal(tools.preview.kind === 'building' && tools.preview.validity, 'pending');
  await settle();
  assert.equal(tools.preview.kind === 'building' && tools.preview.validity, 'ok');
  await tools.primary();
  sim.step();
  assert.equal(m.buildings.size, 1, 'bâtiment reçu par delta');
  assert.equal(sim.money, 1_000_000 - 10_000);
  // Même endroit : la simulation refuse, l'aperçu passe au rouge avec son message.
  tools.hover({ x: 20.5, z: 20.5 }, null);
  await settle();
  assert.equal(tools.preview.kind === 'building' && tools.preview.validity, 'error');
  assert.match(tools.preview.kind === 'building' ? tools.preview.message : '', /occupé/);
  await tools.primary();
  assert.ok(notes.some((n) => n.startsWith('error:Construction refusée')));
  // Annuler (Ctrl+Z) = démolition par la simulation.
  assert.ok(await tools.undoLast());
  sim.step();
  assert.equal(m.buildings.size, 0);
  sim.stop();
});

test('machine (MockSim) : route droite puis enchaînement, bulldozer, annulation de démolition', async () => {
  const sim = flatMock();
  const { m, tools } = setup(sim, sim.catalog);
  sim.start(0);
  tools.setTool('road', { roadType: 'street' });
  tools.hover({ x: -60, z: 0 }, null);
  await tools.primary();
  tools.hover({ x: 60, z: 0 }, null);
  await settle();
  assert.equal(tools.preview.kind === 'road' && tools.preview.validity, 'ok');
  assert.equal(tools.preview.kind === 'road' && tools.preview.cost, 120 * 60);
  await tools.primary();
  sim.step();
  assert.equal(m.edges.size, 1);
  assert.equal(tools.draft.phase, 'start', 'le tracé continue depuis l’extrémité');
  tools.secondary(); tools.secondary();
  assert.equal(tools.tool, 'select');
  // Bulldozer sur la route.
  tools.setTool('bulldoze');
  tools.hover({ x: 0, z: 1 }, { ox: 0, oy: 100, oz: 1, dx: 0, dy: -1, dz: 0 });
  assert.equal(tools.preview.kind === 'bulldoze' && tools.preview.target?.kind, 'road');
  await tools.primary();
  sim.step();
  assert.equal(m.edges.size, 0);
  assert.ok(await tools.undoLast(), 'reconstruction de la route');
  sim.step();
  assert.equal(m.edges.size, 1);
  sim.stop();
});

/** Port en processus sur la VRAIE simulation (mêmes messages que le worker). */
class RealSimPort implements SimPort {
  readonly sim = new Simulation();
  private snapL: ((s: SnapshotMessage) => void)[] = [];
  private deltaL: ((d: DeltaMessage) => void)[] = [];
  private req = 1;
  onSnapshot(l: (s: SnapshotMessage) => void): void { this.snapL.push(l); }
  onDelta(l: (d: DeltaMessage) => void): void { this.deltaL.push(l); }
  async send<K extends CommandName>(name: K, args: CommandArgs<K>): Promise<CommandResult<K>> {
    await Promise.resolve();
    const out = handleCommand(this.sim, { kind: 'cmd', reqId: this.req++, name, args });
    if (out.snapshot) { const s = this.sim.snapshot(); for (const l of this.snapL) l(s); }
    const d = this.sim.takeDelta();
    for (const l of this.deltaL) l(d);
    const r = out.result;
    if (r.kind !== 'result') throw new Error('réponse inattendue');
    if (!r.ok) throw { error: r.error };
    return r.data as CommandResult<K>;
  }
}

test('machine (VRAIE simulation) : snapping façade-route accepté, routes, refus, annulation', async () => {
  const port = new RealSimPort();
  const cat = testCatalog();
  const { m, tools, notes } = setup(port, cat);
  await port.send('init', { protocolVersion: PROTOCOL_VERSION, catalog: cat });
  await port.send('newGame', { seed: 11, mapChunks: 4, startMoney: 2_000_000, cityName: 'Réelle' });
  // Trouver une zone plate et sèche près du centre.
  const t = m.terrain!;
  const h = (x: number, z: number): number => terrainHeightAt(port.sim.terrain!, x, z);
  let cx = 0; let cz = 0; let found = false;
  for (let r = 0; r < 400 && !found; r += 16) for (let a = 0; a < 16 && !found; a++) {
    const x = Math.cos(a) * r; const z = Math.sin(a) * r;
    let lo = Infinity; let hi = -Infinity;
    for (let dx = -80; dx <= 80; dx += 8) for (let dz = -40; dz <= 40; dz += 8) { const v = h(x + dx, z + dz); lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (lo > t.waterLevel + 1 && hi - lo < 6) { cx = x; cz = z; found = true; }
  }
  assert.ok(found, 'zone constructible trouvée');
  tools.setTool('road', { roadType: 'street' });
  tools.hover({ x: cx - 70, z: cz }, null); await tools.primary();
  tools.hover({ x: cx + 70, z: cz }, null); await settle(); await tools.primary();
  assert.equal(m.edges.size, 1, notes.join(' | '));
  tools.setTool('building', { assetId: 'maison_test' });
  tools.hover({ x: cx + 5, z: cz + 22 }, null);
  await settle();
  const p = tools.preview;
  assert.equal(p.kind, 'building');
  if (p.kind !== 'building') return;
  assert.equal(p.proposal.snapped, true);
  assert.equal(p.validity, 'ok', p.message);
  await tools.primary();
  assert.equal(m.buildings.size, 1, notes.join(' | '));
  const b = [...m.buildings.values()][0]!;
  const [nx, nz] = rotateQuarter(0, 1, b.rot);
  assert.deepEqual([nx + 0, nz], [0, -1], 'façade tournée vers la route');
  // Altitude prévue côté client = altitude retenue par la simulation.
  const asset = cat.assets[0]!;
  const rect = gridFootprint(t.originX, t.originZ, asset.footprint.tilesX, asset.footprint.tilesZ, b.x, b.z, b.rot);
  assert.ok(Math.abs(footprintGroundY((x, z) => h(x, z), rect) - b.y) < 1e-4);
  // Route à travers le bâtiment : refus expliqué par la simulation.
  tools.setTool('road');
  tools.hover({ x: b.x, z: b.z - 40 }, null); await tools.primary();
  tools.hover({ x: b.x, z: b.z + 40 }, null); await settle();
  assert.equal(tools.preview.kind === 'road' && tools.preview.validity, 'error');
  assert.match(tools.preview.kind === 'road' ? tools.preview.message : '', /bâtiment/);
  tools.secondary(); tools.secondary();
  // Annulation de la pose puis de la route.
  assert.ok(await tools.undoLast());
  assert.equal(m.buildings.size, 0);
  assert.ok(await tools.undoLast());
  assert.equal(m.edges.size, 0);
});

