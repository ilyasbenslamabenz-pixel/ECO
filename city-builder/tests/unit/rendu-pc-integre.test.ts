/**
 * PC portable à GPU intégré (docs/PERFORMANCE_PC.md) : détection du GPU, densité plafonnée en qualité Auto,
 * plage de résolution dynamique, paliers de qualité automatiques (montée / descente sans oscillation).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deviceProfile, isIntegratedGpuName } from '../../src/render/device-profile';
import { QUALITY_TIERS, TierController, urlTier } from '../../src/render/quality-tiers';
import { baseRatio, desktopDynamic, wantMsaa } from '../../src/ui/options';

test('GPU intégrés reconnus, GPU dédiés non', () => {
  for (const n of ['ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 'ANGLE (AMD, Radeon Vega 8 Graphics Direct3D11 vs_5_0 ps_5_0)']) assert.ok(isIntegratedGpuName(n), n);
  for (const n of ['ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Laptop GPU Direct3D11 vs_5_0 ps_5_0, D3D11)', 'ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0)',
    'ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)', 'ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics Direct3D11)', 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))']) assert.ok(!isIntegratedGpuName(n), n);
});

test('GPU intégré en Auto : densité 1,25 au plus, sans MSAA à densité 1,5 ; Haute et Moyenne inchangées', () => {
  const auto = deviceProfile('auto', false, true);
  assert.equal(auto.igpu, true);
  assert.equal(auto.autoPixelRatio, 1.25);
  assert.equal(baseRatio('auto', 1.5, false, auto.maxPixelRatio, auto.autoPixelRatio), 1.25);
  assert.equal(wantMsaa({ quality: 'auto', aa: 'auto' }, 1.5, false, auto.maxPixelRatio, auto.autoPixelRatio), false);
  const haute = deviceProfile('haute', false, true);
  assert.equal(baseRatio('haute', 1.5, false, haute.maxPixelRatio, haute.autoPixelRatio), 1.5);
  const moy = deviceProfile('moyenne', false, true);
  assert.equal(baseRatio('moyenne', 1.5, false, moy.maxPixelRatio, moy.autoPixelRatio), 1.5);
  // GPU dédié : comportement d'avant.
  const dedie = deviceProfile('auto', false, false);
  assert.equal(baseRatio('auto', 1.5, false, dedie.maxPixelRatio, dedie.autoPixelRatio), 1.5);
});

test('résolution dynamique sur GPU intégré : plancher 1, jamais au-dessus de la densité de départ', () => {
  assert.deepEqual(desktopDynamic('auto', 1.25, 1.5, true), { min: 1, max: 1.25 });
  assert.equal(desktopDynamic('auto', 1, 1, true), null);
  assert.deepEqual(desktopDynamic('auto', 1.5, 2), { min: 0.9, max: 2 });
});

test('paliers : coûts décroissants du palier élevé au palier minimal', () => {
  for (let i = 1; i < QUALITY_TIERS.length; i++) {
    const a = QUALITY_TIERS[i - 1]!, b = QUALITY_TIERS[i]!;
    assert.ok(b.shadowCap <= a.shadowCap && b.buildingLod <= a.buildingLod && b.vegScale <= a.vegScale && b.maxVehicles <= a.maxVehicles
      && b.vehicleDist <= a.vehicleDist && b.pedDist <= a.pedDist && b.smallShadowDist <= a.smallShadowDist, b.name);
  }
  assert.equal(urlTier('?palier=2'), 2);
  assert.equal(urlTier('?palier=9'), null);
  assert.equal(urlTier(''), null);
});

test('contrôleur de paliers : descente espacée, montée après cadence tenue, pas de retour rapide au palier qui a décroché', () => {
  const c = new TierController();
  assert.ok(c.down(1000));
  assert.equal(c.tier, 1);
  assert.ok(!c.down(2000), 'au plus une descente toutes les 4 s');
  assert.ok(c.down(5100));
  assert.equal(c.tier, 2);
  assert.ok(!c.up(10000), 'montée seulement 12 s après le dernier changement');
  // Le palier 1 a décroché à 5,1 s : pas de remontée vers lui avant 2 min.
  assert.ok(!c.up(30000));
  assert.ok(c.up(126000));
  assert.equal(c.tier, 1);
  // Palier fixe (?palier=) : aucune adaptation.
  const f = new TierController();
  f.reset(3); f.fixed = true;
  assert.ok(!f.down(1e6) && !f.up(1e6));
  assert.equal(f.tier, 3);
  // Bornes.
  const b = new TierController();
  assert.ok(!b.up(1e6));
  for (let t = 0; t < 10; t++) b.down(t * 5000);
  assert.equal(b.tier, QUALITY_TIERS.length - 1);
});

test('GPU intégré : résolution dynamique et paliers aussi en Moyenne (fluidité), pas sur GPU dédié', async () => {
  const { dynResEnabled, tiersEnabledFor } = await import('../../src/ui/options');
  assert.equal(dynResEnabled({ quality: 'moyenne', dynRes: 'auto' }, true), true);
  assert.equal(dynResEnabled({ quality: 'haute', dynRes: 'auto' }, true), true);
  assert.equal(dynResEnabled({ quality: 'moyenne', dynRes: 'auto' }, false), false);
  assert.equal(dynResEnabled({ quality: 'moyenne', dynRes: 'off' }, true), false, 'choix « fixe » du joueur respecté');
  assert.deepEqual(desktopDynamic('moyenne', 1.5, 1.5, true), { min: 1, max: 1.5 });
  assert.equal(tiersEnabledFor('moyenne', false, true), true);
  assert.equal(tiersEnabledFor('moyenne', false, false), false);
  assert.equal(tiersEnabledFor('haute', false, true), false);
  assert.equal(tiersEnabledFor('auto', false, false), true);
});

test('Téléphone (mode allégé) : paliers automatiques en qualité Auto ; Basse impose le palier le plus léger', async () => {
  const { tiersEnabledFor, fixedTierFor } = await import('../../src/ui/options');
  const { QUALITY_TIERS } = await import('../../src/render/quality-tiers');
  assert.equal(tiersEnabledFor('auto', true, false), true, 'qualité Auto sur téléphone : adaptation');
  assert.equal(tiersEnabledFor('moyenne', true, true), false, 'choix manuel du joueur respecté');
  assert.equal(tiersEnabledFor('haute', true, false), false);
  assert.equal(fixedTierFor('basse'), QUALITY_TIERS.length - 1);
  assert.equal(fixedTierFor('moyenne'), 0);
  assert.equal(fixedTierFor('auto'), 0);
});

test('Effets d\'image (occlusion ambiante) : auto = ordinateur à GPU dédié ; jamais sur téléphone ni en rendu logiciel', async () => {
  const { postEnabledFor, sanitizeOptions, urlPost } = await import('../../src/ui/options');
  const { isSoftwareRenderer } = await import('../../src/render/post-detect');
  const { QUALITY_TIERS } = await import('../../src/render/quality-tiers');
  assert.equal(postEnabledFor('auto', false, false, false), true, 'GPU dédié');
  assert.equal(postEnabledFor('auto', false, true, false), false, 'GPU intégré');
  assert.equal(postEnabledFor('auto', false, false, true), false, 'rendu logiciel');
  assert.equal(postEnabledFor('auto', true, false, false), false, 'téléphone');
  assert.equal(postEnabledFor('on', false, true, true), true, 'choix du joueur');
  assert.equal(postEnabledFor('on', true, false, false), false, 'jamais sur téléphone');
  assert.equal(postEnabledFor('off', false, false, false), false);
  assert.equal(isSoftwareRenderer('Google SwiftShader'), true);
  assert.equal(isSoftwareRenderer('llvmpipe (LLVM 15.0.7, 256 bits)'), true);
  assert.equal(isSoftwareRenderer('NVIDIA GeForce RTX 3060'), false);
  assert.equal(sanitizeOptions({}).post, 'auto');
  assert.equal(sanitizeOptions({ post: 'x' as never }).post, 'auto');
  assert.equal(urlPost('?effets=1'), 'on');
  assert.equal(urlPost('?effets=0'), 'off');
  assert.equal(urlPost(''), null);
  assert.deepEqual(QUALITY_TIERS.map((t) => t.ao), [true, true, false, false], 'coupés aux paliers réduit et minimal');
});
