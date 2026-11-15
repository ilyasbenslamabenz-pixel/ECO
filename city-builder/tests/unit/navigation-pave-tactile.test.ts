/**
 * Navigation sur PC portable : détection pavé tactile / molette à partir de séquences d'événements `wheel`
 * réalistes (Chrome / Edge sous Windows avec pavé tactile de précision, Safari sur Mac, molette classique,
 * Firefox), décision « collante » le temps d'une session, réglages Navigation des options, colonne mise en avant
 * dans la fiche des contrôles.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WheelClassifier, WHEEL_SESSION_GAP_MS, wheelEvidence, type WheelSample } from '../../src/input/camera';
import { DEFAULT_OPTIONS, sanitizeOptions } from '../../src/ui/options';
import { CONTROLS, currentColumn } from '../../src/ui/controls-help';

/** Séquence d'événements espacés de `dt` ms à partir de `t0`. */
function seq(t0: number, dt: number, rows: Partial<WheelSample>[]): WheelSample[] {
  return rows.map((r, i) => ({ deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, shiftKey: false, timeStamp: t0 + i * dt, ...r }));
}
const run = (c: WheelClassifier, s: WheelSample[]): string[] => s.map((e) => c.classify(e));

/** Chrome / Edge, Windows, pavé tactile de précision, mise à l'échelle 150 % : deltas en tiers de pixel, ~120 Hz. */
const winPtpScroll = (t0: number): WheelSample[] => seq(t0, 8.3, [
  0.6666667, 2, 4.6666665, 8.666667, 12, 15.333333, 18, 20.666666, 21.333334, 19.333334, 16, 12.666667, 9.333333, 6, 3.3333333, 1.3333334,
].map((y, i) => ({ deltaY: y, deltaX: [0, 0, 0.6666667, 0, -0.6666667][i % 5]!, wheelDeltaY: Math.round(-y * 1.2) })));

test('pavé tactile Windows (Chrome / Edge, 150 %) : défilement à deux doigts reconnu dès le premier événement', () => {
  const c = new WheelClassifier();
  const r = run(c, winPtpScroll(1000));
  assert.ok(r.every((d) => d === 'touchpad'), r.join(','));
  // Balayage horizontal pur.
  const h = run(c, seq(5000, 8.3, [-1.3333334, -4, -8.666667, -12.666667, -9.333333, -3.3333333].map((x) => ({ deltaX: x }))));
  assert.ok(h.every((d) => d === 'touchpad'));
});

test('pavé tactile Windows : pincement = Ctrl + petits deltas fractionnaires', () => {
  const s = seq(0, 8.3, [-1.92, -3.17, -4.4, -2.65, 1.18, 2.9].map((y) => ({ deltaY: y, ctrlKey: true })));
  for (const e of s) assert.equal(wheelEvidence(e), 'touchpad');
  const c = new WheelClassifier();
  assert.ok(run(c, s).every((d) => d === 'touchpad'));
});

test('pavé tactile Windows à 100 % (deltas entiers) : reconnu au rythme dès le 2e événement, puis collant', () => {
  const c = new WheelClassifier();
  const s = seq(0, 8, [1, 3, 6, 9, 12, 14, 15, 13, 10, 7, 4, 2, 1].map((y) => ({ deltaY: y })));
  const r = run(c, s);
  assert.equal(wheelEvidence(s[0]!), null, 'un petit delta entier isolé est ambigu');
  assert.ok(r.slice(1).every((d) => d === 'touchpad'), r.join(','));
  // Session suivante : un premier événement ambigu suit la décision précédente (pas de zoom parasite).
  assert.equal(c.classify({ deltaX: 0, deltaY: 2, deltaMode: 0, ctrlKey: false, timeStamp: 2000 }), 'touchpad');
});

test('Safari sur Mac, pavé tactile : wheelDeltaY = −3 × deltaY, élan compris', () => {
  const c = new WheelClassifier();
  const ys = [1, 2, 4, 7, 11, 14, 12, 9, 6, 4, 3, 2, 1, 1];
  const r = run(c, seq(0, 16.7, ys.map((y, i) => ({ deltaY: y, wheelDeltaY: -3 * y, deltaX: i === 5 ? 1 : 0 }))));
  assert.ok(r.every((d) => d === 'touchpad'), r.join(','));
  // Le pincement de Safari arrive en gesturechange : la caméra le signale au classeur.
  const c2 = new WheelClassifier();
  c2.markTouchpad(100);
  assert.equal(c2.last, 'touchpad');
});

test('molette classique : crans de ~100 px (Chrome / Edge, 100 % et 150 %), Safari, Firefox (lignes)', () => {
  const c = new WheelClassifier();
  // Chrome Windows 100 % : crans de 100, rotation lente puis rapide (16 ms entre crans).
  assert.ok(run(c, seq(0, 90, [100, 100, -100, -100].map((y) => ({ deltaY: y, wheelDeltaY: -1.2 * y })))).every((d) => d === 'mouse'));
  assert.ok(run(c, seq(1000, 16, [100, 100, 100, 100, 100].map((y) => ({ deltaY: y, wheelDeltaY: -120 })))).every((d) => d === 'mouse'));
  // Edge à 150 % (cran de 150) et à 133 % (cran fractionnaire, mais grand).
  assert.ok(run(c, seq(3000, 60, [150, 150, -150].map((y) => ({ deltaY: y, wheelDeltaY: y > 0 ? -120 : 120 })))).every((d) => d === 'mouse'));
  assert.ok(run(c, seq(5000, 60, [133.33333, 133.33333].map((y) => ({ deltaY: y })))).every((d) => d === 'mouse'));
  // Safari Mac, souris : deltaY ≈ 4,000244, wheelDeltaY = −120 par cran.
  const safari = new WheelClassifier();
  assert.ok(run(safari, seq(0, 110, [4.000244, 4.000244, 8.000488].map((y) => ({ deltaY: y, wheelDeltaY: -120 * Math.round(y / 4) })))).every((d) => d === 'mouse'));
  // Firefox : deltaMode 1 (3 lignes par cran).
  const ff = new WheelClassifier();
  assert.ok(run(ff, seq(0, 80, [3, 3, -3].map((y) => ({ deltaY: y, deltaMode: 1 })))).every((d) => d === 'mouse'));
  // Ctrl + molette : reste une molette (zoom au cran habituel).
  assert.equal(wheelEvidence({ deltaX: 0, deltaY: 100, deltaMode: 0, ctrlKey: true, timeStamp: 0, wheelDeltaY: -120 }), 'mouse');
});

test('décision collante : un grand delta en fin de geste reste « pavé tactile » ; nouvelle session après un silence', () => {
  const c = new WheelClassifier();
  run(c, winPtpScroll(0));
  const t = 16 * 8.3;
  // Grand delta entier (balayage vif) dans la même session : toujours un déplacement.
  assert.equal(c.classify({ deltaX: 0, deltaY: 120, deltaMode: 0, ctrlKey: false, timeStamp: t + 10, wheelDeltaY: -144 }), 'touchpad');
  // Silence plus long qu'une session, puis un cran de molette : molette.
  const t2 = t + 10 + WHEEL_SESSION_GAP_MS + 50;
  assert.equal(c.classify({ deltaX: 0, deltaY: 100, deltaMode: 0, ctrlKey: false, timeStamp: t2, wheelDeltaY: -120 }), 'mouse');
  // Une session « molette » passe au pavé tactile sur un indice net (deltaX fractionnaire), jamais l'inverse.
  assert.equal(c.classify({ deltaX: 0.6666667, deltaY: 3.3333333, deltaMode: 0, ctrlKey: false, timeStamp: t2 + 8 }), 'touchpad');
  assert.equal(c.classify({ deltaX: 0, deltaY: 100, deltaMode: 0, ctrlKey: false, timeStamp: t2 + 16, wheelDeltaY: -120 }), 'touchpad');
});

test('Maj + molette (converti en horizontal par Chrome) n’est pas pris pour un pavé tactile', () => {
  assert.equal(wheelEvidence({ deltaX: 100, deltaY: 0, deltaMode: 0, ctrlKey: false, shiftKey: true, timeStamp: 0 }), null);
  assert.equal(wheelEvidence({ deltaX: 0, deltaY: -100, deltaMode: 0, ctrlKey: false, shiftKey: true, timeStamp: 0, wheelDeltaY: 120 }), 'mouse');
});

test('options Navigation : défauts (Auto, bord désactivé) et valeurs hors domaine', () => {
  assert.equal(DEFAULT_OPTIONS.pointer, 'auto');
  assert.equal(DEFAULT_OPTIONS.edgeScroll, false);
  assert.equal(sanitizeOptions({ pointer: 'touchpad', edgeScroll: true }).pointer, 'touchpad');
  assert.equal(sanitizeOptions({ pointer: 'touchpad', edgeScroll: true }).edgeScroll, true);
  assert.equal(sanitizeOptions({ pointer: 'trackball' as never, edgeScroll: 'oui' as never }).pointer, 'auto');
  assert.equal(sanitizeOptions({ edgeScroll: 'oui' as never }).edgeScroll, false);
});

test('fiche des contrôles : colonnes complètes, mode imposé > mode détecté > écran tactile seul', () => {
  for (const c of ['keyboard', 'mouse', 'touchpad', 'touch'] as const) assert.ok(CONTROLS[c].length >= 4, c);
  assert.ok(CONTROLS.touchpad.some(([a, k]) => a === 'Déplacer' && /deux doigts/i.test(k)));
  assert.equal(currentColumn('auto', 'touchpad', false), 'touchpad');
  assert.equal(currentColumn('mouse', 'touchpad', false), 'mouse');
  assert.equal(currentColumn('auto', null, true), 'touch');
  assert.equal(currentColumn('auto', null, false), null);
});
