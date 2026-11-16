/**
 * Palette du rendu (src/render/palette.ts) : option « Couleurs », ancien rendu conservé, étalonnage intégré au
 * tone mapping (aucun passage plein écran).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PALETTE_NATURELLES, PALETTE_VIVES, applyToneMapping, onPaletteChange, palette, setColorMode } from '../../src/render/palette';
import { DEFAULT_OPTIONS, sanitizeOptions } from '../../src/ui/options';

test('palette : vives par défaut, option « Couleurs » validée', () => {
  assert.equal(DEFAULT_OPTIONS.colors, 'vives');
  assert.equal(sanitizeOptions({ colors: 'naturelles' }).colors, 'naturelles');
  assert.equal(sanitizeOptions({ colors: 'fluo' as never }).colors, 'vives');
  assert.equal(palette().mode, 'vives');
});

test('palette : changement notifié, tone mapping ACES (naturelles) / ACES étalonné (vives)', () => {
  const seen: string[] = [];
  const off = onPaletteChange((p) => seen.push(p.mode));
  const r = { toneMapping: THREE.NoToneMapping } as unknown as THREE.WebGLRenderer;
  setColorMode('naturelles');
  applyToneMapping(r);
  assert.equal(r.toneMapping, THREE.ACESFilmicToneMapping);
  setColorMode('naturelles'); // sans effet
  setColorMode('vives');
  applyToneMapping(r);
  assert.equal(r.toneMapping, THREE.CustomToneMapping);
  off();
  assert.deepEqual(seen, ['naturelles', 'vives']);
  assert.ok(THREE.ShaderChunk.tonemapping_pars_fragment.includes('Couleurs vives'), 'étalonnage dans la fonction de tone mapping');
});

test('palette : ancien rendu (naturelles) = valeurs d\'origine, herbe vive réellement verte', () => {
  assert.equal(PALETTE_NATURELLES.grade, null);
  assert.equal(PALETTE_NATURELLES.exposure, 0.85);
  assert.equal(PALETTE_NATURELLES.fog.density, 0.00022);
  assert.equal(PALETTE_NATURELLES.terrain.grassRemap, 0);
  assert.equal(PALETTE_NATURELLES.terrain.macroStrength, 0.32);
  const [r, g, b] = PALETTE_VIVES.terrain.grassLush;
  assert.ok(g > r * 1.5 && g > b * 2, 'herbe grasse verte');
  assert.ok(PALETTE_VIVES.fog.maxLum < PALETTE_NATURELLES.fog.maxLum, 'brume moins blanche');
});
