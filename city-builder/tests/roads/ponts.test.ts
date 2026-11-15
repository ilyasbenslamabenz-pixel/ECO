/**
 * Profil en long des ponts (src/sim/roads/profile.ts) : non-régression des ponts réunis à tort / allongés.
 *   npx tsx --test tests/roads/ponts.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ArcTable, straightCubic } from '../../src/sim/roads/bezier';
import { MAX_BRIDGE_LENGTH, computeProfile, flagRuns, type ProfileEnv } from '../../src/sim/roads/profile';

const WL = 4;
/** Terrain à `land` m avec des bras d'eau (lit à 0 m, surface à 4 m) aux abscisses données, berges en pente douce. */
function channels(chans: [number, number][], land: number, bankSlope = 0.15): ProfileEnv {
  const hAt = (x: number): number => {
    let h = land;
    for (const [c0, c1] of chans) {
      const d = x < c0 ? c0 - x : x > c1 ? x - c1 : -1;
      h = Math.min(h, d < 0 ? 0 : Math.min(land, WL - 0.5 + d * bankSlope));
    }
    return h;
  };
  return { heightAt: (x) => hAt(x), waterLevel: -10, waterAt: (x) => (hAt(x) < WL ? WL : -Infinity) };
}
function profile(env: ProfileEnv, L: number, grade = 0.1) {
  const c = straightCubic(0, 0, L, 0);
  return computeProfile(c, new ArcTable(c), env.heightAt(0, 0), env.heightAt(L, 0), grade, env);
}
/** Creux (minimum local marqué) à l'intérieur d'une travée de pont. */
function dipsOnBridge(p: ReturnType<typeof profile>): number {
  let n = 0;
  for (let i = 1; i < p.count - 1; i++) if (p.bridge[i] && p.bridge[i - 1] && p.bridge[i + 1] && p.heights[i]! < Math.min(p.heights[i - 1]!, p.heights[i + 1]!) - 0.05) n++;
  return n;
}

test('deux bras d’eau proches sur terrain bas : deux ponts, jamais un pont réuni au-delà de la limite', () => {
  // Deux bras de 300 m séparés par une île basse de 60 m : réunis, le pont ferait ~680 m (> 600 m, refusé).
  const p = profile(channels([[100, 400], [460, 760]], 5.5), 900);
  assert.ok(!p.wet);
  assert.ok(p.longestBridge <= MAX_BRIDGE_LENGTH, `plus long pont ${Math.round(p.longestBridge)} m`);
  assert.equal(flagRuns(p.bridge).length / 2, 2, 'deux ponts distincts');
  assert.equal(dipsOnBridge(p), 0, 'aucun creux sur les tabliers');
  // Île assez large pour que la route y repose : deux ponts, même s'ils tiendraient réunis.
  const q = profile(channels([[100, 300], [360, 560]], 5.5), 700);
  assert.equal(flagRuns(q.bridge).length / 2, 2, 'route posée sur l’île');
});

test('bras très proches : un seul tablier plat (pas de V entre eux) tant qu’il reste sous la limite', () => {
  const p = profile(channels([[100, 300], [340, 540]], 5.5), 640);
  assert.equal(flagRuns(p.bridge).length / 2, 1, 'un seul pont');
  assert.ok(p.longestBridge <= MAX_BRIDGE_LENGTH);
  assert.equal(dipsOnBridge(p), 0, 'tablier sans creux');
  const mid = Math.round(320 / p.step);
  assert.ok(Math.abs(p.heights[mid]! - (WL + 5.5)) < 0.3, `tablier plat au-dessus de l’île (${p.heights[mid]})`);
});

test('pont simple : allongement limité au-delà de l’eau, tablier plat sans pointe', () => {
  // Bras de 100 m (eau ≈ x 197–303) : le pont ne déborde que des culées et rampes (version régressée : 140 m).
  const p = profile(channels([[200, 300]], 12), 500);
  assert.ok(p.longestBridge <= 136, `pont de ${Math.round(p.longestBridge)} m`);
  // Bras étroit (12 m) : tablier plat d'au moins ~16 m au sommet (pas de pointe).
  const n = profile(channels([[200, 212]], 12, 0.3), 500);
  let top = -Infinity; for (let i = 0; i < n.count; i++) top = Math.max(top, n.heights[i]!);
  let flat = 0; for (let i = 0; i < n.count; i++) if (n.heights[i]! > top - 0.15) flat++;
  assert.ok(flat * n.step >= 16, `plat au sommet ${flat * n.step} m`);
  assert.ok(n.longestBridge <= 36, `pont étroit de ${Math.round(n.longestBridge)} m`);
});
