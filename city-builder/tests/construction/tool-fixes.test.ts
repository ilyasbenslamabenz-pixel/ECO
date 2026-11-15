/**
 * Correctifs des outils de construction (contre la VRAIE simulation) : annulation d'un quadrillage qui épargne la
 * rue existante, annulation d'une route découpée depuis, viaduc reconstruit à sa hauteur, actions sans inverse qui
 * marquent la pile, outils et pile remis à zéro au chargement, état du Terrain et hauteur ▲▼ remis à zéro,
 * giratoire chiffré avant pose, geste à deux doigts (déplacement / inclinaison).
 * Lancer : npx tsx --test tests/construction/tool-fixes.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROTOCOL_VERSION } from '../../src/shared/constants';
import type { CommandArgs, CommandName, CommandResult, DeltaMessage, SnapshotMessage } from '../../src/shared/protocol';
import { WorldMirror } from '../../src/client/tools/mirror';
import { ConstructionTools, type SimPort } from '../../src/client/tools/machine';
import { UndoStack } from '../../src/client/tools/undo';
import { polyOnPaths } from '../../src/client/tools/grid';
import { classifyTwoFinger, TILT_HOLD_MS } from '../../src/input/camera';
import { Simulation } from '../../src/sim/world';
import { handleCommand } from '../../src/sim/handler';
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

const NEW_GAME = { seed: 5, mapChunks: 4, startMoney: 50_000_000, cityName: 'Correctifs', terrain: { hydrology: 'aucune' as const, rivers: 0, relief: 0 } };

async function world(): Promise<{ port: RealSimPort; m: WorldMirror; tools: ConstructionTools; notes: string[] }> {
  const port = new RealSimPort();
  const cat = testCatalog();
  const m = new WorldMirror(cat);
  port.onSnapshot((s) => m.applySnapshot(s));
  port.onDelta((d) => m.applyDelta(d));
  const notes: string[] = [];
  const tools = new ConstructionTools(m, port, (t, k) => notes.push(`${k}:${t}`));
  await port.send('init', { protocolVersion: PROTOCOL_VERSION, catalog: cat });
  await port.send('newGame', NEW_GAME);
  return { port, m, tools, notes };
}

async function clickAt(tools: ConstructionTools, x: number, z: number): Promise<void> {
  tools.hover({ x, z }, { ox: x, oy: 300, oz: z, dx: 0, dy: -1, dz: 0 });
  await settle();
  await tools.primary();
  await settle();
}

async function road(tools: ConstructionTools, ax: number, az: number, bx: number, bz: number): Promise<void> {
  tools.setTool('road', { roadType: 'street' });
  await clickAt(tools, ax, az);
  await clickAt(tools, bx, bz);
  tools.finishRoad();
}

test('caméra : deux doigts glissés verticalement = déplacement ; inclinaison après un temps d\'immobilité', () => {
  const vertical = { mx: 1, my: 40, d: 0.5, a: 0 };
  assert.equal(classifyTwoFinger(vertical, 0), 'free', 'glisser vertical immédiat : la carte se déplace');
  assert.equal(classifyTwoFinger(vertical, TILT_HOLD_MS - 50), 'free');
  assert.equal(classifyTwoFinger(vertical, TILT_HOLD_MS + 10), 'tilt', 'doigts posés immobiles puis glissés : inclinaison');
  assert.equal(classifyTwoFinger({ mx: 40, my: 2, d: 0, a: 0 }, 1000), 'free', 'glisser horizontal : toujours un déplacement');
  assert.equal(classifyTwoFinger({ mx: 0, my: 40, d: 30, a: 0 }, 1000), 'free', 'pincer : zoom');
});

test('annulation d\'un quadrillage : la rue existante découpée par le quadrillage est conservée', async () => {
  const { m, tools, notes } = await world();
  // Rue existante sur le bord ouest du futur quadrillage, qui en couvre le début (z -96 → -56).
  await road(tools, -304, -200, -304, -56);
  assert.equal(m.edges.size, 1);
  const before = [...m.edges.values()].reduce((s, e) => s + e.length, 0);
  tools.setRoadSub('grid');
  tools.setGridBlock(64);
  await clickAt(tools, -304, -96);
  tools.hover({ x: -304 + 130, z: -96 + 128 }, null);
  await settle();
  const p = tools.preview;
  assert.ok(p.kind === 'grid' && p.layout && p.validity === 'ok', p.kind === 'grid' ? p.message : p.kind);
  await tools.primary();
  await settle();
  assert.ok(m.edges.size > 10, `quadrillage construit (${m.edges.size} tronçons)`);
  assert.ok(await tools.undoLast(), notes.join(' | '));
  await settle();
  const after = [...m.edges.values()].reduce((s, e) => s + e.length, 0);
  assert.ok(Math.abs(after - before) < 0.5, `la rue existante est entière après l'annulation (${after.toFixed(1)} m / ${before.toFixed(1)} m) — ${notes.join(' | ')}`);
  for (const e of m.edges.values()) { const v = m.edgeView(e)!; assert.ok(Math.abs(v.ax + 304) < 0.5 && Math.abs(v.bx + 304) < 0.5, 'seuls restent des morceaux de la rue existante'); }
});

test('annulation d\'une route découpée ensuite par une route en travers', async () => {
  const { m, tools, notes } = await world();
  await road(tools, -200, 200, 0, 200);
  const idA = [...m.edges.keys()][0]!;
  await road(tools, -96, 104, -96, 296);
  assert.ok(!m.edges.has(idA), 'la première route a été découpée (nouveaux identifiants)');
  assert.ok(m.edges.size >= 4);
  assert.ok(await tools.undoLast(), 'annule la route en travers');
  await settle();
  assert.ok(await tools.undoLast(), `annule la première route malgré la découpe — ${notes.join(' | ')}`);
  await settle();
  assert.equal(m.edges.size, 0, notes.join(' | '));
  assert.ok(notes.some((n) => /^ok:Annulé : Route/.test(n)), notes.join(' | '));
});

test('annuler la démolition d\'un viaduc le reconstruit à la même hauteur', async () => {
  const { m, tools, notes } = await world();
  tools.setTool('road', { roadType: 'street' });
  tools.setRoadElevation(1);
  tools.setRoadElevation(1);
  await clickAt(tools, -200, -304);
  await clickAt(tools, 0, -304);
  tools.finishRoad();
  assert.equal(tools.draft.elevation, 0, 'hauteur ▲▼ remise à 0 m à la fin du tracé');
  const rec = [...m.edges.values()][0] as { id: number; elev?: number } | undefined;
  assert.ok(rec, notes.join(' | '));
  assert.equal(rec!.elev, 8, 'viaduc +8 m');
  const view = m.edgeView(m.edges.get(rec!.id)!)!;
  assert.ok(await tools.demolishTarget({ kind: 'road', id: rec!.id, edge: view, distance: 0 }));
  await settle();
  assert.equal(m.edges.size, 0);
  assert.ok(await tools.undoLast(), notes.join(' | '));
  await settle();
  const back = [...m.edges.values()][0] as { elev?: number } | undefined;
  assert.equal(back?.elev, 8, 'reconstruit en viaduc, pas au sol');
});

test('action sans inverse (terrain) : Ctrl+Z ne défait pas l\'action précédente par erreur', async () => {
  const { m, tools, notes } = await world();
  await road(tools, -200, 200, 0, 200);
  tools.markTerrainEdit();
  assert.equal(await tools.undoLast(), false);
  assert.equal(m.edges.size, 1, 'la route est toujours là');
  assert.ok(notes.some((n) => /impossible à annuler/.test(n)), notes.join(' | '));
  assert.ok(await tools.undoLast(), 'second Ctrl+Z : la route');
  await settle();
  assert.equal(m.edges.size, 0);
});

test('giratoire : coût chiffré par la simulation avant la pose, pile marquée après', async () => {
  const { m, tools, notes, port } = await world();
  await road(tools, -200, 0, 0, 0);
  await road(tools, -96, -104, -96, 104);
  tools.setRoundaboutSize('small');
  tools.hover({ x: -96, z: 0 }, { ox: -96, oy: 300, oz: 0, dx: 0, dy: -1, dz: 0 });
  await settle();
  const p = tools.preview;
  assert.ok(p.kind === 'road' && p.mode === 'roundabout', p.kind);
  if (p.kind !== 'road') return;
  assert.equal(p.validity, 'ok', p.message);
  assert.ok(p.cost > 0 && /Giratoire · /.test(p.message), p.message);
  const money0 = port.sim.economy.money;
  assert.equal(port.sim.economy.money, money0, 'rien de construit pendant l\'aperçu');
  const n0 = m.edges.size;
  await tools.primary();
  await settle();
  assert.ok(m.edges.size > n0, notes.join(' | '));
  assert.equal(tools.undo.peek()?.irreversible, true, 'Ctrl+Z n\'annule pas la route d\'avant par erreur');
});

test('chargement d\'une partie : outil, tracé, déplacement et pile d\'annulation remis à zéro', async () => {
  const { port, tools } = await world();
  await road(tools, -200, 200, 0, 200);
  tools.setRoadSub('grid');
  await clickAt(tools, 0, 0);
  assert.equal(tools.drawing, true);
  assert.ok(tools.undo.size > 0);
  await port.send('newGame', NEW_GAME);
  assert.equal(tools.tool, 'select');
  assert.equal(tools.drawing, false);
  assert.equal(tools.undo.size, 0);
  assert.equal(tools.moving, null);
});

test('Ctrl+Z abandonne l\'étape en cours (coin de quadrillage) ; Terrain et hauteur remis à zéro au changement d\'outil', async () => {
  const { tools } = await world();
  await road(tools, -200, 200, 0, 200);
  tools.setRoadSub('grid');
  await clickAt(tools, 0, 0);
  assert.equal(tools.drawing, true);
  let abandoned = 0;
  tools.onAbandon(() => abandoned++);
  await tools.undoLast();
  assert.equal(tools.drawing, false, 'le coin précédent ne sert plus de départ au prochain toucher');
  assert.equal(abandoned, 1);
  tools.setRoadSub('draw');
  tools.setRoadElevation(1);
  tools.setTool('terraform');
  assert.equal(tools.draft.elevation, 0);
  tools.terrain.setMode('quay');
  await clickAt(tools, 40, 40);
  assert.equal(tools.terrain.hasStart, true);
  tools.setTool('road');
  assert.equal(tools.terrain.hasStart, false, 'départ du quai abandonné au changement d\'outil');
});

test('pile d\'annulation : le déplacement d\'un bâtiment démoli est oublié ; marques consécutives fusionnées', () => {
  const u = new UndoStack();
  u.push({ label: 'Déplacement', steps: [{ kind: 'moveBuilding', buildingId: 5, x: 0, z: 0, rot: 0 }] });
  u.forgetBuilding(5);
  assert.equal(u.size, 0);
  u.push({ label: 'Terrain', steps: [], irreversible: true });
  u.push({ label: 'Terrain', steps: [], irreversible: true });
  assert.equal(u.size, 1);
  assert.ok(polyOnPaths([0, 0, 10, 0.5], [[-5, 0, 20, 0]]));
  assert.ok(!polyOnPaths([0, 0, 30, 0], [[-5, 0, 20, 0]]), 'hors de l\'étendue du tracé');
});
