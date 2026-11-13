/**
 * Réduction des images en mode allégé (src/render/image-cap.ts) :
 * - les texels transparents récupèrent une couleur (feuillage : plus de liseré noir aux bords des feuilles) ;
 * - une même image d'origine (partagée par THREE.Cache entre plusieurs GLB) donne toujours la même réduction,
 *   même après sa fermeture (façades noires des vignettes).
 * Lancer : npx tsx --test tests/unit/image-cap.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { downscaleImage, refillTransparent } from '../../src/render/image-cap';

function img(w: number, h: number, fill: (x: number, y: number) => [number, number, number, number]): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(fill(x, y), (y * w + x) * 4);
  return { data, width: w, height: h, colorSpace: 'srgb' } as ImageData;
}

test('texels transparents remplis : voisins proches puis couleur moyenne, alpha inchangé', () => {
  // Feuille verte au centre (4×4), fond transparent noir (ce que rend un canevas 2D prémultiplié).
  const im = img(16, 16, (x, y) => (x >= 6 && x < 10 && y >= 6 && y < 10 ? [60, 120, 30, 255] : [0, 0, 0, 0]));
  refillTransparent(im);
  for (let p = 0; p < 256; p++) {
    const [r, g, b, a] = im.data.subarray(p * 4, p * 4 + 4);
    assert.ok(r! > 50 && g! > 100 && b! > 20, `texel ${p} sans couleur : ${r},${g},${b}`);
    const inside = (p % 16) >= 6 && (p % 16) < 10 && Math.floor(p / 16) >= 6 && Math.floor(p / 16) < 10;
    assert.equal(a, inside ? 255 : 0);
  }
});

test('image opaque : inchangée', () => {
  const im = img(4, 4, () => [10, 20, 30, 255]);
  refillTransparent(im);
  assert.deepEqual([...im.data.subarray(0, 4)], [10, 20, 30, 255]);
});

test('image déjà réduite puis fermée : même résultat pour le modèle suivant', () => {
  // Image factice sans canevas (Node) : la réduction n'a pas lieu, l'objet est rendu tel quel, sans exception.
  const src = { width: 2048, height: 2048, close() { this.width = 0; this.height = 0; } };
  const a = downscaleImage(src, 256);
  const b = downscaleImage(src, 256);
  assert.equal(a, b);
});
