/**
 * Tests du module terrain (agent environnement) : génération, hydrologie, couches, terraformation,
 * patchs, maillage des chunks (y compris exécution du code source autonome du worker).
 *   npx tsx --test tests/terrain/*.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyPatch, applyTerraform, computeFlow, extractPatch, generateWorld, isWorldTerrain, NO_WATER, normalizeParams,
  RESOURCE, worldTransferables, type WorldTerrain,
} from '../../src/sim/terrain/index';
import { terrainHeightAt } from '../../src/shared/terrain-gen';
import { chunkIndices, chunkVertexCount, meshChunk, type MeshSource } from '../../src/render/terrain/mesher';
import { mesherWorkerSource } from '../../src/render/terrain/mesher-worker';

const small = (o: Partial<Parameters<typeof generateWorld>[0]> = {}): WorldTerrain => generateWorld({ seed: 11, mapChunks: 4, ...o });

test('génération déterministe (même graine => mêmes données)', () => {
  const a = small();
  const b = small();
  assert.deepEqual(a.heights, b.heights);
  assert.deepEqual(a.waterSurface, b.waterSurface);
  assert.deepEqual(a.forest, b.forest);
  const c = small({ seed: 12 });
  assert.notDeepEqual(a.heights, c.heights);
});

test('dimensions compatibles avec la simulation (TerrainData, pas de 8 m par défaut)', () => {
  const t = small();
  assert.equal(t.spacing, 8);
  assert.equal(t.samplesX, 4 * 32 + 1);
  assert.equal(t.heights.length, t.samplesX * t.samplesZ);
  for (const layer of [t.waterSurface, t.moisture, t.forest, t.resources]) assert.equal(layer.length, t.heights.length);
  assert.equal(t.originX, -512);
  assert.ok(isWorldTerrain(t));
  const t2 = generateWorld({ seed: 11, mapChunks: 2, samplesPerTile: 2 });
  assert.equal(t2.spacing, 4);
  assert.equal(t2.samplesX, 2 * 64 + 1);
});

test('paramètres bornés (entrées non fiables)', () => {
  const p = normalizeParams({ seed: 3.7, mapChunks: 999, maxAltitude: -5, relief: 9, hydrology: 'volcan' as never, forest: Number.NaN });
  assert.equal(p.mapChunks, 32);
  assert.equal(p.maxAltitude, 20);
  assert.equal(p.relief, 1);
  assert.equal(p.hydrology, 'mer');
  assert.equal(p.forest, 0.55);
});

test('mer : une partie de la carte est sous l\'eau, plaine centrale constructible, montagnes en bordure', () => {
  const t = generateWorld({ seed: 7, mapChunks: 8, hydrology: 'mer' });
  assert.ok(t.stats.waterFraction > 0.05, `eau ${t.stats.waterFraction}`);
  assert.ok(t.stats.buildableFraction > 0.3, `constructible ${t.stats.buildableFraction}`);
  assert.ok(t.stats.maxHeight > 60, `altitude max ${t.stats.maxHeight}`);
  // Centre : au-dessus de l'eau et peu pentu.
  const hc = terrainHeightAt(t, 0, 0);
  assert.ok(hc > t.waterLevel + 0.5, `centre ${hc}`);
  assert.ok(Math.abs(terrainHeightAt(t, 40, 0) - hc) < 6);
});

test('lac intérieur et aucune étendue d\'eau', () => {
  const lac = generateWorld({ seed: 3, mapChunks: 8, hydrology: 'lac', rivers: 0 });
  assert.ok(lac.stats.waterFraction > 0.01);
  const sec = generateWorld({ seed: 3, mapChunks: 6, hydrology: 'aucune', rivers: 0 });
  assert.ok(sec.stats.waterFraction < lac.stats.waterFraction);
});

test('hydrologie : les rivières descendent jusqu\'à l\'eau ou au bord', () => {
  const t = generateWorld({ seed: 7, mapChunks: 8, hydrology: 'mer', rivers: 0.7 });
  assert.ok(t.rivers.length >= 2, `rivières ${t.rivers.length}`);
  for (const r of t.rivers.slice(0, 5)) {
    const n = r.points.length / 4;
    assert.ok(n >= 3);
    // Surface non croissante vers l'aval.
    for (let i = 1; i < n; i++) assert.ok(r.points[i * 4 + 1]! <= r.points[(i - 1) * 4 + 1]! + 1e-3, 'surface croissante');
  }
  // Le plus grand cours se termine dans l'eau (mer) ou au bord.
  const main = t.rivers[0]!;
  const last = (main.points.length / 4 - 1) * 4;
  const x = main.points[last]!;
  const z = main.points[last + 2]!;
  const edge = Math.max(Math.abs(x), Math.abs(z)) > 1024 - 16;
  assert.ok(edge || main.points[last + 1]! <= t.waterLevel + 0.5 || terrainHeightAt(t, x, z) < t.waterLevel + 1, 'embouchure');
  // Les cellules de rivière ont une surface d'eau au-dessus du lit.
  let wetRiver = 0;
  for (let k = 0; k < t.heights.length; k++) if (t.waterSurface[k]! > t.waterLevel + 0.05 && t.waterSurface[k]! > t.heights[k]!) wetRiver++;
  assert.ok(wetRiver > 50, `échantillons de rivière ${wetRiver}`);
});

test('priority-flood : tout échantillon s\'écoule jusqu\'à un exutoire sans boucle', () => {
  const W = 20;
  const H = 20;
  const h = new Float32Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) h[j * W + i] = 10 + Math.sin(i) * 2 + Math.cos(j * 1.3) * 2 - (i === 10 && j === 10 ? 5 : 0);
  const f = computeFlow(h, W, H, -100);
  for (let k = 0; k < W * H; k++) {
    let c = k;
    let guard = 0;
    while (f.down[c]! >= 0) { assert.ok(f.filled[f.down[c]!]! < f.filled[c]!); c = f.down[c]!; assert.ok(guard++ < W * H); }
    const i = c % W;
    const j = Math.floor(c / W);
    assert.ok(i === 0 || j === 0 || i === W - 1 || j === H - 1, 'exutoire hors bord');
  }
  // La cuvette (10,10) est remplie.
  assert.ok(f.filled[10 * W + 10]! > h[10 * W + 10]!);
  // Accumulation totale à l'exutoire = nombre d'échantillons.
  let sum = 0;
  for (let k = 0; k < W * H; k++) if (f.down[k] === -1) sum += f.acc[k]!;
  assert.equal(sum, W * H);
});

test('couches : forêt absente de l\'eau, ressources présentes, humidité plus forte près de l\'eau', () => {
  const t = generateWorld({ seed: 7, mapChunks: 8, forest: 0.7, resources: 0.8 });
  let forestInWater = 0;
  const kinds = new Set<number>();
  let mNear = 0; let nNear = 0; let mFar = 0; let nFar = 0;
  for (let k = 0; k < t.heights.length; k++) {
    const wet = t.waterSurface[k]! > t.heights[k]!;
    if (wet && t.forest[k]! > 0) forestInWater++;
    kinds.add(t.resources[k]!);
    if (!wet) {
      const nearWater = t.heights[k]! < t.waterLevel + 3;
      if (nearWater) { mNear += t.moisture[k]!; nNear++; } else if (t.heights[k]! > 40) { mFar += t.moisture[k]!; nFar++; }
    }
  }
  assert.equal(forestInWater, 0);
  assert.ok(t.stats.forestFraction > 0.05, `forêt ${t.stats.forestFraction}`);
  assert.ok(kinds.has(RESOURCE.TERRE_FERTILE) && kinds.has(RESOURCE.PIERRE), `ressources ${[...kinds]}`);
  assert.ok(mNear / nNear > mFar / nFar, 'humidité');
});

test('terraformation : élever / abaisser / aplanir / lisser, volume et région', () => {
  const t = small();
  const x = 0;
  const z = 0;
  const h0 = terrainHeightAt(t, x, z);
  const r = applyTerraform(t, { kind: 'raise', x, z, radius: 30, strength: 4 })!;
  assert.ok(r.volume > 0 && r.maxDelta <= 4 + 1e-6);
  assert.ok(terrainHeightAt(t, x, z) > h0 + 3.5);
  const r2 = applyTerraform(t, { kind: 'lower', x, z, radius: 30, strength: 4 })!;
  assert.ok(Math.abs(terrainHeightAt(t, x, z) - h0) < 1e-3);
  assert.ok(r2.rect.i0 <= r2.rect.i1);
  applyTerraform(t, { kind: 'flatten', x: 50, z: 50, radius: 40, strength: 1, targetHeight: 20 });
  assert.ok(Math.abs(terrainHeightAt(t, 50, 50) - 20) < 0.01);
  // Lisser réduit l'écart local.
  applyTerraform(t, { kind: 'raise', x: -100, z: -100, radius: 6, strength: 10 });
  const peak = terrainHeightAt(t, -100, -100);
  applyTerraform(t, { kind: 'smooth', x: -100, z: -100, radius: 30, strength: 1 });
  assert.ok(terrainHeightAt(t, -100, -100) < peak);
  assert.equal(applyTerraform(t, { kind: 'raise', x: 99999, z: 0, radius: 10, strength: 1 }), null);
  assert.equal(applyTerraform(t, { kind: 'raise', x: Number.NaN, z: 0, radius: 10, strength: 1 }), null);
});

test('terraformation : abaisser sous le niveau de la mer à côté de la mer inonde', () => {
  const t = generateWorld({ seed: 7, mapChunks: 8, hydrology: 'mer' });
  // Trouve un échantillon sec juste au bord de la mer.
  const W = t.samplesX;
  let target = -1;
  for (let k = W + 1; k < t.heights.length - W - 1 && target < 0; k++) {
    if (t.waterSurface[k] === NO_WATER && t.heights[k]! > t.waterLevel && t.heights[k]! < t.waterLevel + 3 && t.waterSurface[k + 1] === t.waterLevel && t.heights[k + 1]! < t.waterLevel) target = k;
  }
  assert.ok(target >= 0, 'rivage trouvé');
  const x = t.originX + (target % W) * t.spacing;
  const z = t.originZ + Math.floor(target / W) * t.spacing;
  applyTerraform(t, { kind: 'lower', x, z, radius: 12, strength: 6 });
  assert.equal(t.waterSurface[target], t.waterLevel);
});

test('patch : extraction puis application => données identiques', () => {
  const a = small();
  const b = small();
  const r = applyTerraform(a, { kind: 'raise', x: 10, z: -20, radius: 25, strength: 3 })!;
  const p = extractPatch(a, r.rect);
  assert.equal(p.heights.length, (r.rect.i1 - r.rect.i0 + 1) * (r.rect.j1 - r.rect.j0 + 1));
  applyPatch(b, p);
  assert.deepEqual(b.heights, a.heights);
  assert.deepEqual(b.waterSurface, a.waterSurface);
});

test('transferables : tous les grands tableaux sont listés et distincts', () => {
  const t = small();
  const tr = worldTransferables(t);
  assert.ok(tr.includes(t.heights.buffer as ArrayBuffer) && tr.includes(t.forest.buffer as ArrayBuffer));
  assert.equal(new Set(tr).size, tr.length);
});

const srcOf = (t: WorldTerrain): MeshSource => ({
  heights: t.heights, waterSurface: t.waterSurface, moisture: t.moisture, forest: t.forest,
  samplesX: t.samplesX, samplesZ: t.samplesZ, spacing: t.spacing, originX: t.originX, originZ: t.originZ,
  waterLevel: t.waterLevel, maxAltitude: t.params.maxAltitude,
});

test('maillage : sommets sur la surface exacte, indices valides, jupe sous la surface', () => {
  const t = small();
  const src = srcOf(t);
  for (const step of [1, 2, 4, 8]) {
    const m = meshChunk(src, { i0: 32, j0: 64, cells: 32, step, skirt: 5 });
    const nv = chunkVertexCount(32, step);
    assert.equal(m.positions.length, nv * 3);
    const idx = chunkIndices(32, step);
    for (const v of idx) assert.ok(v < nv);
    const n = 32 / step + 1;
    for (let v = 0; v < n * n; v++) {
      const x = m.positions[v * 3]!;
      const z = m.positions[v * 3 + 2]!;
      assert.ok(Math.abs(m.positions[v * 3 + 1]! - terrainHeightAt(t, x, z)) < 1e-3);
      const ny = m.normals[v * 3 + 1]!;
      assert.ok(ny > 0 && ny <= 1);
      const s = m.splat[v * 4]! + m.splat[v * 4 + 1]! + m.splat[v * 4 + 2]! + m.splat[v * 4 + 3]!;
      assert.ok(s <= 256, `poids ${s}`);
    }
    for (let v = n * n; v < nv; v++) {
      const x = m.positions[v * 3]!;
      const z = m.positions[v * 3 + 2]!;
      assert.ok(m.positions[v * 3 + 1]! < terrainHeightAt(t, x, z) - 4.9);
    }
  }
});

test('maillage : arêtes communes identiques entre chunks voisins (pas de fissure au même LOD)', () => {
  const t = small();
  const src = srcOf(t);
  const a = meshChunk(src, { i0: 0, j0: 0, cells: 32, step: 2, skirt: 3 });
  const b = meshChunk(src, { i0: 32, j0: 0, cells: 32, step: 2, skirt: 3 });
  const n = 17;
  for (let j = 0; j < n; j++) {
    const va = j * n + (n - 1);
    const vb = j * n;
    for (let c = 0; c < 3; c++) {
      assert.ok(Math.abs(a.positions[va * 3 + c]! - b.positions[vb * 3 + c]!) < 1e-4);
      assert.ok(Math.abs(a.normals[va * 3 + c]! - b.normals[vb * 3 + c]!) < 1e-4, 'normales de couture');
    }
  }
});

test('maillage : anneau d\'horizon hors carte (indices négatifs) sans NaN', () => {
  const t = small();
  const m = meshChunk(srcOf(t), { i0: -64, j0: -32, cells: 32, step: 4, skirt: 3 });
  for (const v of m.positions) assert.ok(Number.isFinite(v));
});

test('worker de maillage : le code source autonome s\'exécute et donne le même résultat', () => {
  const t = small();
  const src = srcOf(t);
  const code = mesherWorkerSource();
  const posted: unknown[] = [];
  const scope: { onmessage: ((e: { data: unknown }) => void) | null; postMessage: (m: unknown) => void } = { onmessage: null, postMessage: (m) => posted.push(m) };
  // Exécution isolée : seul `self` est fourni (aucune dépendance au bundle).
  new Function('self', code)(scope);
  scope.onmessage!({ data: { kind: 'source', src } });
  scope.onmessage!({ data: { kind: 'mesh', job: { id: 9, i0: 32, j0: 32, cells: 32, step: 2, skirt: 4 } } });
  const res = posted[0] as { kind: string; id: number; mesh: { positions: Float32Array } };
  assert.equal(res.kind, 'mesh');
  assert.equal(res.id, 9);
  const ref = meshChunk(src, { i0: 32, j0: 32, cells: 32, step: 2, skirt: 4 });
  assert.deepEqual(res.mesh.positions, ref.positions);
});

test('architecture : src/sim/terrain sans three ni DOM', () => {
  const dir = join(import.meta.dirname, '..', '..', 'src', 'sim', 'terrain');
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory() || !f.endsWith('.ts')) continue;
    const s = readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    assert.ok(!/from\s+['"]three/.test(s), `${f} importe three`);
    assert.ok(!/\b(document|window|localStorage|HTMLElement)\b/.test(s), `${f} utilise le DOM`);
  }
});
