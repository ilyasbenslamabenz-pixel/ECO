/**
 * Outils de voirie (src/client/tools : machine.ts, road-draft.ts, grid.ts) contre la VRAIE simulation :
 * tracé continu + « Terminer », quadrillage (îlots sur la grille de 8 m, coût avant validation, annulation
 * groupée, bord partagé avec un quadrillage voisin), lignes guides parallèles à distance d'îlot, angle affiché,
 * outil « Améliorer » (type, sens, refus motivé, annulation).
 * Lancer : npx tsx --test tests/construction/road-tools.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROTOCOL_VERSION } from '../../src/shared/constants';
import type { AssetCatalog } from '../../src/shared/catalog';
import type { CommandArgs, CommandName, CommandResult, DeltaMessage, SnapshotMessage } from '../../src/shared/protocol';
import { WorldMirror, edgeKind } from '../../src/client/tools/mirror';
import { ConstructionTools, type SimPort } from '../../src/client/tools/machine';
import { angleLabel, parallelGuide, snapRoadPoint } from '../../src/client/tools/road-draft';
import { edgeOnGrid, gridCorner, gridLayout } from '../../src/client/tools/grid';
import { Simulation } from '../../src/sim/world';
import { handleCommand } from '../../src/sim/handler';
import { ROAD_KINDS } from '../../src/sim/roads/types';
import { testCatalog } from '../fixtures/catalog';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
async function settle(): Promise<void> { for (let i = 0; i < 40; i++) await tick(); }

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

async function world(money = 50_000_000): Promise<{ port: RealSimPort; m: WorldMirror; tools: ConstructionTools; notes: string[]; cat: AssetCatalog }> {
  const port = new RealSimPort();
  const cat = testCatalog();
  const m = new WorldMirror(cat);
  port.onSnapshot((s) => m.applySnapshot(s));
  port.onDelta((d) => m.applyDelta(d));
  const notes: string[] = [];
  const tools = new ConstructionTools(m, port, (t, k) => notes.push(`${k}:${t}`));
  await port.send('init', { protocolVersion: PROTOCOL_VERSION, catalog: cat });
  // Carte plate et sèche : les scénarios vérifient des coordonnées et des coûts exacts.
  await port.send('newGame', { seed: 5, mapChunks: 4, startMoney: money, cityName: 'Voirie', terrain: { hydrology: 'aucune', rivers: 0, relief: 0 } });
  return { port, m, tools, notes, cat };
}

async function clickAt(tools: ConstructionTools, x: number, z: number): Promise<void> {
  tools.hover({ x, z }, { ox: x, oy: 300, oz: z, dx: 0, dy: -1, dz: 0 });
  await settle();
  await tools.primary();
  await settle();
}

test('grille : coin sur la grille de 8 m, îlots entiers, plafond, rues déjà construites retirées', () => {
  assert.deepEqual(gridCorner(13, -4.5), { x: 16, z: -8 });
  const g = gridLayout({ x: 0, z: 0 }, { x: 140, z: -70 }, 64);
  assert.equal(g.nx, 2); assert.equal(g.nz, 1);
  assert.deepEqual([g.x0, g.z0, g.x1, g.z1], [0, -64, 128, 0]);
  assert.equal(g.lines.length, 2 + 3);
  assert.equal(g.length, 2 * 128 + 3 * 64);
  const big = gridLayout({ x: 0, z: 0 }, { x: 5000, z: 10 }, 48);
  assert.ok(big.clamped && big.nx === 12 && big.nz === 1);
  assert.ok(edgeOnGrid([0, -64, 64, -64], g));
  assert.ok(edgeOnGrid([64, -64, 64, 0], g));
  assert.ok(!edgeOnGrid([32, -64, 32, 0], g), 'pas une rue du quadrillage');
  assert.ok(!edgeOnGrid([0, 0, 128, -64], g), 'diagonale');
});

test('tracé continu : la route repart de l\'extrémité sans recliquer, « Terminer » arrête l\'enchaînement', async () => {
  const { m, tools, notes } = await world();
  tools.gridSnap = false;
  tools.setTool('road', { roadType: 'street' });
  assert.equal(tools.drawing, false);
  await clickAt(tools, -200, 0);
  assert.equal(tools.drawing, true);
  await clickAt(tools, -100, 0);
  assert.equal(m.edges.size, 1, notes.join(' | '));
  assert.equal(tools.draft.phase, 'start', 'le tracé continue');
  assert.deepEqual([tools.draft.start!.x, tools.draft.start!.z], [-100, 0]);
  // Deuxième tronçon : un seul clic (l'arrivée), à angle droit.
  await clickAt(tools, -100, 80);
  assert.equal(m.edges.size, 2, notes.join(' | '));
  assert.equal(tools.draft.chained, 2);
  const p = tools.preview;
  assert.equal(p.kind, 'road');
  assert.ok(tools.finishRoad());
  assert.equal(tools.draft.phase, 'idle');
  assert.equal(tools.drawing, false);
  assert.equal(tools.tool, 'road', 'l\'outil reste actif');
  assert.ok(notes.some((n) => /Tracé terminé : 2 tronçons/.test(n)));
  assert.equal(tools.finishRoad(), false, 'rien à terminer');
});

test('angle et longueur affichés pendant le tracé', async () => {
  const { m, tools } = await world();
  tools.gridSnap = false;
  tools.setTool('road', { roadType: 'street' });
  await clickAt(tools, -200, 0);
  await clickAt(tools, -100, 0);
  tools.hover({ x: -100, z: 30 }, null);
  await settle();
  const p = tools.preview;
  assert.ok(p.kind === 'road' && p.points);
  if (p.kind !== 'road') return;
  assert.equal(p.angle, '90° / route');
  assert.equal(Math.round(p.length), 30);
  assert.equal(p.validity, 'ok');
  assert.equal(p.cost, 30 * ROAD_KINDS.street.costPerMeter);
  assert.equal(angleLabel(m, { x: 0, z: 0, snap: 'free' }, { x: 0, z: -10 }), 'cap 0°');
  assert.equal(angleLabel(m, { x: 0, z: 0, snap: 'free' }, { x: 10, z: 0 }), 'cap 90°');
});

test('lignes guides : parallèle à une route à distance d\'îlot, et arrêt de la perpendiculaire à l\'îlot', async () => {
  const { m, tools, port } = await world();
  await port.send('buildRoad', { type: 'street', points: [-200, 0, 0, 0] });
  assert.equal(m.edges.size, 1);
  const g = parallelGuide(m, -120, 61, 64, 5);
  assert.ok(g && Math.abs(g.z - 64) < 1e-9 && Math.abs(g.x + 120) < 1e-9);
  assert.equal(parallelGuide(m, -120, 50, 64, 5), null, 'hors tolérance');
  // Premier point : accroché sur la ligne guide (z = −64 de l'autre côté).
  const s0 = snapRoadPoint(m, -120, -66, { radius: 8, angleSnap: false, magnet: true, grid: false, guideSpacing: 64 });
  assert.ok(Math.abs(s0.z + 64) < 1e-9, `z=${s0.z}`);
  assert.match(s0.guide!.label, /parallèle à la route · îlot 64 m/);
  // Perpendiculaire depuis la route : l'arrivée s'arrête exactement sur la ligne guide.
  const s1 = snapRoadPoint(m, -98, 61.5, { radius: 8, angleSnap: false, magnet: true, grid: false, guideSpacing: 64 }, { x: -100, z: 0 });
  assert.ok(Math.abs(s1.x + 100) < 1e-6 && Math.abs(s1.z - 64) < 1e-6, `(${s1.x}, ${s1.z})`);
  assert.match(s1.guide!.label, /perpendiculaire à la route · jusqu'à l'îlot \(64 m\)/);
  // Guides désactivés : aimantation habituelle seulement.
  const s2 = snapRoadPoint(m, -98, 61.5, { radius: 8, angleSnap: false, magnet: true, grid: false, guideSpacing: 0 }, { x: -100, z: 0 });
  assert.ok(Math.abs(s2.z - 62) < 1e-6, 'pas d\'accroche à 64 m (longueur arrondie au mètre)');
  // La machine passe la taille d'îlot aux guides.
  tools.setTool('road');
  tools.setGridBlock(48);
  tools.hover({ x: -150, z: 47 }, null);
  assert.ok(tools.draft.hover && Math.abs(tools.draft.hover.z - 48) < 1e-9);
});

test('quadrillage : coût affiché avant validation, îlots construits avec leurs carrefours, annulation groupée', async () => {
  const { port, m, tools, notes } = await world();
  tools.setTool('road', { roadType: 'street' });
  tools.setRoadSub('grid');
  tools.setGridBlock(64);
  const money0 = port.sim.economy.money;
  await clickAt(tools, -300, -100);
  assert.equal(tools.drawing, true);
  tools.hover({ x: -300 + 130, z: -100 + 128 }, null);
  await settle();
  const p = tools.preview;
  assert.equal(p.kind, 'grid');
  if (p.kind !== 'grid' || !p.layout) return;
  assert.equal(p.validity, 'ok', p.message);
  assert.equal(p.layout.nx, 2); assert.equal(p.layout.nz, 2);
  const expected = Math.round(p.layout.length * ROAD_KINDS.street.costPerMeter);
  assert.equal(p.cost, expected, 'coût chiffré par la simulation avant validation');
  assert.equal(port.sim.economy.money, money0, 'rien n\'est construit pendant l\'aperçu');
  await tools.primary();
  await settle();
  assert.ok(notes.some((n) => /^ok:Quadrillage 2×2 îlots de 64 m/.test(n)), notes.join(' | '));
  assert.equal(port.sim.economy.money, money0 - expected);
  assert.equal(m.nodes.size, 9, '3×3 carrefours');
  assert.equal(m.edges.size, 12, '12 tronçons de 64 m');
  for (const e of m.edges.values()) assert.ok(Math.abs(e.length - 64) < 0.01);
  assert.equal(tools.drawing, false);
  // Quadrillage voisin qui partage le bord est : la rue commune n'est pas reconstruite.
  await clickAt(tools, -300 + 128, -100);
  tools.hover({ x: -300 + 128 + 64, z: -100 + 128 }, null);
  await settle();
  const q = tools.preview;
  assert.ok(q.kind === 'grid' && q.layout);
  if (q.kind !== 'grid' || !q.layout) return;
  assert.equal(q.validity, 'ok', q.message);
  assert.equal(q.layout.lines.length, 4, '3 rues est-ouest + 1 rue nord-sud (la rue commune existe)');
  await tools.primary();
  await settle();
  assert.equal(m.edges.size, 12 + 5, '3 rues est-ouest + la rue nord-sud coupée en 2 au carrefour');
  // Annulation : le second quadrillage seulement, puis le premier.
  assert.ok(await tools.undoLast());
  await settle();
  assert.equal(m.edges.size, 12, notes.join(' | '));
  assert.ok(await tools.undoLast());
  await settle();
  assert.equal(m.edges.size, 0, notes.join(' | '));
});

test('quadrillage : refus expliqué avant construction (fonds insuffisants), Échap abandonne le coin', async () => {
  const { port, tools, m } = await world(30_000);
  tools.setTool('road');
  tools.setRoadSub('grid');
  await clickAt(tools, 0, 0);
  tools.hover({ x: 200, z: 200 }, null);
  await settle();
  const p = tools.preview;
  assert.ok(p.kind === 'grid' && p.validity === 'error' && /Fonds insuffisants/.test(p.message), p.kind === 'grid' ? p.message : p.kind);
  await tools.primary();
  await settle();
  assert.equal(m.edges.size, 0);
  assert.equal(port.sim.economy.money, 30_000);
  assert.ok(tools.secondary(), 'Échap : coin abandonné');
  assert.equal(tools.drawing, false);
  assert.equal(tools.tool, 'road');
});

test('Améliorer : rue → avenue facturée, refus motivé par un bâtiment, sens unique inversé, annulation', async () => {
  const { port, m, tools, notes } = await world();
  await port.send('buildRoad', { type: 'street', points: [-200, 0, 0, 0] });
  const id0 = [...m.edges.keys()][0]!;
  tools.setTool('road');
  tools.setRoadSub('upgrade');
  tools.setUpgradeTarget('next');
  tools.hover({ x: -100, z: 1 }, { ox: -100, oy: 300, oz: 1, dx: 0, dy: -1, dz: 0 });
  await settle();
  const p = tools.preview;
  assert.ok(p.kind === 'upgrade' && p.target?.id === id0);
  if (p.kind !== 'upgrade') return;
  assert.equal(p.toKind, 'avenue');
  assert.equal(p.validity, 'ok', p.message);
  const diff = 200 * (ROAD_KINDS.avenue.costPerMeter - ROAD_KINDS.street.costPerMeter);
  assert.equal(p.cost, Math.round(diff));
  const money0 = port.sim.economy.money;
  await tools.primary();
  await settle();
  assert.equal(m.edges.size, 1);
  const e1 = [...m.edges.values()][0]!;
  assert.equal(edgeKind(e1), 'avenue');
  assert.equal(port.sim.economy.money, money0 - Math.round(diff));
  assert.ok(notes.some((n) => /Rue \(2 voies\) → Avenue/.test(n)), notes.join(' | '));
  // Une maison au bord : l'élargissement en boulevard est refusé avec son nom ; la maison reste.
  const b = await port.send('placeBuilding', { assetId: 'maison_test', x: -100, z: 11.5 + 0.6 + 8, rot: 2 });
  assert.ok(b.buildingId > 0);
  tools.hover({ x: -100, z: 1 }, { ox: -100, oy: 300, oz: 1, dx: 0, dy: -1, dz: 0 });
  await settle();
  const q = tools.preview;
  assert.ok(q.kind === 'upgrade' && q.validity === 'error', q.kind === 'upgrade' ? q.message : q.kind);
  assert.match(q.kind === 'upgrade' ? q.message : '', /Élargissement impossible : « .+ » empiète/);
  await tools.primary();
  await settle();
  assert.equal(edgeKind([...m.edges.values()][0]!), 'avenue');
  assert.equal(m.buildings.size, 1);
  assert.ok(notes.some((n) => /^error:Modification refusée : Élargissement impossible/.test(n)));
  // Sens unique puis inversion.
  tools.setUpgradeTarget('oneway');
  tools.hover({ x: -100, z: 1 }, { ox: -100, oy: 300, oz: 1, dx: 0, dy: -1, dz: 0 });
  await settle();
  await tools.primary();
  await settle();
  const e2 = [...m.edges.values()][0]!;
  assert.equal(edgeKind(e2), 'oneway');
  tools.setUpgradeTarget('reverse');
  tools.hover({ x: -100, z: 1 }, { ox: -100, oy: 300, oz: 1, dx: 0, dy: -1, dz: 0 });
  await settle();
  const r = tools.preview;
  assert.ok(r.kind === 'upgrade' && r.reverse && r.validity === 'ok', r.kind === 'upgrade' ? r.message : r.kind);
  await tools.primary();
  await settle();
  const e3 = [...m.edges.values()][0]!;
  assert.deepEqual([e3.a, e3.b], [e2.b, e2.a], 'sens inversé');
  // Annulations successives : inversion, sens unique, avenue → retour à la rue d'origine.
  assert.ok(await tools.undoLast()); await settle();
  assert.deepEqual([[...m.edges.values()][0]!.a, [...m.edges.values()][0]!.b], [e2.a, e2.b]);
  assert.ok(await tools.undoLast()); await settle();
  assert.equal(edgeKind([...m.edges.values()][0]!), 'avenue');
  assert.ok(await tools.undoLast()); await settle();
  assert.equal(edgeKind([...m.edges.values()][0]!), 'street');
  // Ancienne action (pose de la maison n'est pas dans l'historique : posée par le port) : rien d'autre à annuler.
  assert.equal(tools.undo.size, 0);
});

test('Améliorer : motif local immédiat (inverser une rue à double sens, gamme au maximum)', async () => {
  const { port, tools } = await world();
  await port.send('buildRoad', { type: 'street', kind: 'boulevard', points: [-200, 0, 0, 0] });
  tools.setTool('road');
  tools.setRoadSub('upgrade');
  tools.setUpgradeTarget('reverse');
  tools.hover({ x: -100, z: 1 }, null);
  const p = tools.preview;
  assert.ok(p.kind === 'upgrade' && p.validity === 'error' && /sens unique/.test(p.message));
  tools.setUpgradeTarget('next');
  const q = tools.preview;
  assert.ok(q.kind === 'upgrade' && q.validity === 'error' && /plus large/.test(q.message));
  tools.setUpgradeTarget('prev');
  await settle();
  const r = tools.preview;
  assert.ok(r.kind === 'upgrade' && r.toKind === 'avenue' && r.validity === 'ok' && r.refund > 0 && r.cost === 0, r.kind === 'upgrade' ? r.message : '');
});
