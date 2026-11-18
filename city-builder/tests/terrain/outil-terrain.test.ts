/**
 * Outil Terrain côté client (src/client/tools/terrain-tool.ts) branché sur une vraie simulation :
 * aperçu validé par dryRun, départ / arrivée, application, annulation de l'étape, angle magnétique.
 *   npx tsx --test tests/terrain/outil-terrain.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../../src/sim/world';
import { TerrainTool } from '../../src/client/tools/terrain-tool';
import { townCatalog } from '../sim/fixtures';

const settle = async (): Promise<void> => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };

function setup(): { s: Simulation; tool: TerrainTool; notes: string[]; changes: () => number } {
  const s = new Simulation();
  s.setCatalog(townCatalog());
  s.newGame({ seed: 7, mapChunks: 8, startMoney: 50_000_000, cityName: 'Outil' });
  const notes: string[] = [];
  let n = 0;
  const tool = new TerrainTool({
    terrainEdit: async (args) => { const r = s.terrainEdit(args); if (!r.ok) throw { error: r.error }; return r.data; },
  }, (t) => notes.push(t), () => { n++; });
  return { s, tool, notes, changes: () => n };
}

test('Défricher : aperçu (coût) puis application au clic', async () => {
  const { s, tool, notes } = setup();
  tool.setMode('clear');
  tool.setRadius(30);
  tool.setHover({ x: 600, z: 600 });
  assert.equal(tool.preview().validity, 'pending');
  await settle();
  const p = tool.preview();
  assert.equal(p.validity, 'ok');
  assert.ok(p.cost === 0 && p.outline && p.outline.length > 10);
  const money = s.economy.money;
  assert.equal(await tool.click(), true);
  assert.ok(s.economy.money <= money);
  assert.match(notes.at(-1)!, /Défrichage/);
});

test('Creuser : départ, arrivée aimantée (angle 15°), refus expliqué, annulation de l\'étape', async () => {
  const { s, tool } = setup();
  tool.setMode('dig');
  tool.setWidth(24);
  tool.setHover({ x: -100, z: 40 });
  assert.equal(await tool.click(), false, 'premier clic : départ');
  assert.ok(tool.hasStart);
  tool.angleSnap = true;
  tool.setHover({ x: 98, z: 47 }); // ≈ 2° : aimanté à l'horizontale
  const e = tool.edit()!;
  assert.equal(e.k, 'dig');
  if (e.k === 'dig') assert.ok(Math.abs(e.bz - e.az) < 1e-9, 'angle aimanté');
  tool.preview();
  await settle();
  assert.equal(tool.preview().validity, 'ok');
  assert.equal(await tool.click(), true);
  assert.ok(!tool.hasStart);
  assert.ok(s.isWet(0, 40));
  // Tracé trop court : refus de la simulation affiché.
  tool.setHover({ x: 300, z: 300 });
  await tool.click();
  tool.setHover({ x: 303, z: 300 });
  tool.preview();
  await settle();
  const p = tool.preview();
  assert.equal(p.validity, 'error');
  assert.match(p.message, /court/);
  assert.equal(tool.back(), true);
  assert.equal(tool.back(), false);
});

test('source : l\'aperçu dit ce qui va se passer (ruisseau, creux qui ne retient pas, lac)', async () => {
  const { describeTerrainEdit } = await import('../../src/client/tools/terrain-tool');
  const src = { k: 'source' as const, x: 0, z: 0, q: 25 };
  const base = { cost: 5750, volume: 0, forestM2: 0, wallLength: 0, outline: null };
  // Pas de cuvette, carte sans eau : ruisseau (et non « une eau existante »).
  const stream = describeTerrainEdit(src, { ...base, water: { level: null, areaM2: 6656, storedM3: 0, outlet: '', status: 'capped' } } as never);
  assert.match(stream, /pas de creux ici : l'eau s'écoule en ruisseau/);
  assert.doesNotMatch(stream, /eau existante/);
  // Rejoint vraiment une eau existante.
  assert.match(describeTerrainEdit(src, { ...base, water: { level: null, areaM2: 0, storedM3: 0, outlet: 'eau', status: 'sink' } } as never), /rejoint aussitôt une eau existante/);
  // Niveau trouvé mais aucune surface : le creux ne retient rien (et non « lac prévu 0 m² »).
  const flat = describeTerrainEdit(src, { ...base, water: { level: -3.7, areaM2: 0, storedM3: 0, outlet: '', status: 'capped' } } as never);
  assert.match(flat, /le creux ne retient pas l'eau/);
  assert.doesNotMatch(flat, /lac prévu 0/);
  // Lac.
  assert.match(describeTerrainEdit(src, { ...base, water: { level: 12, areaM2: 25152, storedM3: 95621, outlet: '', status: 'capped' } } as never), /lac prévu 2,5 ha au niveau 12 m/);
});
