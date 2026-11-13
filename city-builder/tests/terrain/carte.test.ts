/**
 * Carte v2 (retour du propriétaire : « trop d'arbres, côtes non réglables, fleuves gênants ») :
 * génération (forêt ≈ ÷3 en bosquets, une rivière étroite peu sinueuse, choix aucune / une / plusieurs, mer ou non),
 * compatibilité de la génération d'origine (v1) pour les anciennes sauvegardes.
 *   npx tsx --test tests/terrain/carte.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld, normalizeParams, type WorldTerrain } from '../../src/sim/terrain/index';

const fnv = (arrs: ArrayBufferView[]): string => {
  let h = 0x811c9dc5;
  for (const a of arrs) {
    const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    for (let i = 0; i < u.length; i++) { h ^= u[i]!; h = Math.imul(h, 0x01000193) >>> 0; }
  }
  return h.toString(16);
};
/** Arbres attendus (même formule que le semis du rendu : densité ∝ forêt²). */
const trees = (t: WorldTerrain): number => { let s = 0; for (let k = 0; k < t.forest.length; k++) { const f = t.forest[k]! / 255; s += f * f; } return s; };

test('génération d\'origine (v1) reproduite à l\'identique (empreintes relevées avant la v2)', () => {
  const a = generateWorld({ seed: 7, mapChunks: 4, genVersion: 1 });
  assert.equal(fnv([a.heights, a.waterSurface, a.forest, a.moisture, a.resources]), 'a25d1506');
  assert.equal(a.rivers.length, 12);
  const b = generateWorld({ seed: 3, mapChunks: 4, hydrology: 'lac', rivers: 0.8, genVersion: 1 });
  assert.equal(fnv([b.heights, b.waterSurface, b.forest, b.moisture, b.resources]), '2da7c897');
});

test('paramètres v2 : version et mode de rivières par défaut, valeurs invalides bornées', () => {
  const p = normalizeParams({});
  assert.equal(p.genVersion, 2);
  assert.equal(p.riverMode, 'une');
  const q = normalizeParams({ genVersion: 9 as never, riverMode: 'cascade' as never });
  assert.equal(q.genVersion, 2);
  assert.equal(q.riverMode, 'une');
  assert.equal(normalizeParams({ genVersion: 1 }).genVersion, 1);
});

test('forêt v2 : environ trois fois moins d\'arbres, plaine centrale dégagée', () => {
  let r = 0;
  const seeds = [7, 1234, 42, 99];
  for (const seed of seeds) {
    const v1 = generateWorld({ seed, mapChunks: 8, genVersion: 1 });
    const v2 = generateWorld({ seed, mapChunks: 8 });
    r += trees(v2) / trees(v1);
    // Carré central de 1,2 km : au moins 80 % du terrain sec sans forêt (grandes clairières constructibles).
    let n = 0, clear = 0;
    const W = v2.samplesX;
    for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
      const x = v2.originX + i * v2.spacing, z = v2.originZ + j * v2.spacing;
      const k = j * W + i;
      if (Math.abs(x) > 600 || Math.abs(z) > 600 || v2.waterSurface[k]! > v2.heights[k]!) continue;
      n++;
      if (v2.forest[k]! < 20) clear++;
    }
    assert.ok(clear / n > 0.8, `graine ${seed} : clairières ${(clear / n).toFixed(2)}`);
    assert.ok(v2.stats.forestFraction > 0.02, `graine ${seed} : il reste des bosquets`);
  }
  const mean = r / seeds.length;
  assert.ok(mean > 0.22 && mean < 0.45, `rapport moyen v2/v1 ${mean.toFixed(2)}`);
});

test('une rivière (défaut) : un seul cours, étroit, peu sinueux, descendant jusqu\'à la mer', () => {
  for (const seed of [7, 1234, 42]) {
    const t = generateWorld({ seed, mapChunks: 8 });
    assert.equal(t.rivers.length, 1, `graine ${seed}`);
    const p = t.rivers[0]!.points;
    const n = p.length / 4;
    let len = 0;
    let maxW = 0;
    for (let i = 1; i < n; i++) {
      len += Math.hypot(p[i * 4]! - p[(i - 1) * 4]!, p[i * 4 + 2]! - p[(i - 1) * 4 + 2]!);
      assert.ok(p[i * 4 + 1]! <= p[(i - 1) * 4 + 1]! + 1e-3, 'surface croissante');
    }
    for (let i = 0; i < n; i++) maxW = Math.max(maxW, p[i * 4 + 3]!);
    const chord = Math.hypot(p[(n - 1) * 4]! - p[0]!, p[(n - 1) * 4 + 2]! - p[2]!);
    assert.ok(maxW <= 22, `largeur ${maxW}`);
    assert.ok(len / chord < 1.6, `sinuosité ${(len / chord).toFixed(2)}`);
    assert.ok(p[(n - 1) * 4 + 1]! <= t.waterLevel + 0.5, 'embouchure au niveau de la mer');
    // Bien moins d'eau intérieure que le réseau complet.
    const many = generateWorld({ seed, mapChunks: 8, riverMode: 'plusieurs' });
    const inland = (w: WorldTerrain): number => { let c = 0; for (let k = 0; k < w.heights.length; k++) if (w.waterSurface[k]! > w.waterLevel + 0.05 && w.waterSurface[k]! > w.heights[k]!) c++; return c; };
    assert.ok(inland(t) > 30 && inland(t) < inland(many) * 0.6, `eau intérieure ${inland(t)} / ${inland(many)}`);
  }
});

test('choix « aucune rivière », « plusieurs » et « sans mer »', () => {
  const none = generateWorld({ seed: 7, mapChunks: 8, riverMode: 'aucune' });
  assert.equal(none.rivers.length, 0);
  for (let k = 0; k < none.heights.length; k++) assert.ok(!(none.waterSurface[k]! > none.waterLevel + 0.05), 'eau intérieure sans rivière');
  const many = generateWorld({ seed: 7, mapChunks: 8, riverMode: 'plusieurs' });
  assert.ok(many.rivers.length >= 2);
  const dry = generateWorld({ seed: 7, mapChunks: 8, hydrology: 'aucune' });
  const sea = generateWorld({ seed: 7, mapChunks: 8, hydrology: 'mer' });
  assert.ok(dry.stats.waterFraction < sea.stats.waterFraction * 0.3, `eau ${dry.stats.waterFraction} / ${sea.stats.waterFraction}`);
  assert.equal(dry.rivers.length, 1, 'sans mer, la rivière rejoint le bord de la carte');
});
