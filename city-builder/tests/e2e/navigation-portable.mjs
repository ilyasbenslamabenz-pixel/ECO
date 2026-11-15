/**
 * e2e « PC portable » (fenêtre 1280 × 800) : navigation au pavé tactile et à la souris.
 *  - wheel à deltaX / deltaY fractionnaires (pavé tactile de précision, Chrome / Edge) → la caméra se déplace sans zoomer ;
 *  - fiche des contrôles (touche ?) : le mode « Pavé tactile » est détecté ;
 *  - wheel avec ctrlKey (pincement) → zoom ;
 *  - molette à crans (deltaY = 100) → zoom, comme avant ;
 *  - défilement au-dessus d'un panneau → la caméra ne bouge pas ;
 *  - bouton « Pivoter à gauche » près de la boussole → la vue pivote.
 * Appelé par tests/e2e/smoke.mjs (npm run e2e) sur une page déjà chargée en vue aérienne.
 */

/** Pose de la caméra une fois l'amortissement achevé (images rendues à la demande, pas de 0,2 s). */
async function settledPose(page) {
  await page.evaluate(() => window.__aube.renderNow(6, 0.2));
  return page.evaluate(() => window.__aube.cameraPose());
}

/** Envoie une rafale d'événements wheel synthétiques sur la vue 3D (centre de l'écran). */
function wheelBurst(page, events) {
  return page.evaluate((evs) => {
    const c = document.getElementById('scene');
    const r = c.getBoundingClientRect();
    for (const e of evs) {
      c.dispatchEvent(new WheelEvent('wheel', { deltaX: e.dx ?? 0, deltaY: e.dy ?? 0, deltaMode: 0, ctrlKey: !!e.ctrl, shiftKey: !!e.shift, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true }));
    }
  }, events);
}

const rel = (a, b) => Math.abs(a - b) / Math.max(1e-6, Math.abs(b));

export async function checkLaptopNavigation(page, check, label) {
  // Pose connue, vue aérienne.
  await page.evaluate(() => { window.__aube.lookAt?.(0, 0, 420, 0.8, 0.3); });
  const p0 = await settledPose(page);

  // 1. Pavé tactile : deux doigts (deltas fractionnaires dans les deux axes) → déplacement, pas de zoom.
  await wheelBurst(page, Array.from({ length: 14 }, (_, i) => ({ dx: 2.6666667 + (i % 3) * 0.6666667, dy: 5.3333335 })));
  const p1 = await settledPose(page);
  const moved = Math.hypot(p1.targetX - p0.targetX, p1.targetZ - p0.targetZ);
  check(moved > 5, `[${label}] pavé tactile : deux doigts déplacent la carte (${moved.toFixed(1)} m)`);
  check(rel(p1.distance, p0.distance) < 0.01, `[${label}] pavé tactile : deux doigts ne zooment pas (${p0.distance.toFixed(1)} → ${p1.distance.toFixed(1)} m)`);

  // 2. Fiche des contrôles : touche ?, mode détecté = pavé tactile ; Échap la ferme.
  await page.keyboard.press('Shift+Slash');
  const help = await page.evaluate(() => {
    const b = document.getElementById('controls-help');
    return { open: !!b && !b.classList.contains('hidden'), mode: document.getElementById('controls-help-mode')?.dataset.mode ?? '', cols: b ? b.querySelectorAll('.ch-col').length : 0, current: b?.querySelector('.ch-col.current')?.getAttribute('data-col') ?? '' };
  });
  check(help.open && help.cols >= 3, `[${label}] touche ? : fiche des contrôles ouverte (${help.cols} colonnes)`);
  check(help.mode === 'touchpad' && help.current === 'touchpad', `[${label}] fiche des contrôles : mode détecté « pavé tactile » (${help.mode || 'aucun'})`);
  await page.keyboard.press('Escape');
  const closed = await page.evaluate(() => document.getElementById('controls-help')?.classList.contains('hidden') ?? true);
  const menuHidden = await page.evaluate(() => document.getElementById('main-menu')?.classList.contains('hidden') ?? true);
  check(closed && menuHidden, `[${label}] Échap ferme la fiche (sans ouvrir le menu)`);

  // 3. Pincement (Ctrl + petits deltas, nouvelle session) → zoom avant.
  await page.waitForTimeout(450);
  await wheelBurst(page, Array.from({ length: 10 }, () => ({ dy: -4.5, ctrl: true })));
  const p2 = await settledPose(page);
  check(p2.distance < p1.distance * 0.85, `[${label}] pincement (ctrlKey) : zoom avant (${p1.distance.toFixed(1)} → ${p2.distance.toFixed(1)} m)`);

  // 4. Molette à crans (nouvelle session) : zoom arrière, comme avant ; puis vraie molette de Chromium (zoom avant).
  await page.waitForTimeout(450);
  for (let i = 0; i < 3; i++) { await wheelBurst(page, [{ dy: 100 }]); await page.waitForTimeout(60); }
  const p3 = await settledPose(page);
  check(p3.distance > p2.distance * 1.3, `[${label}] molette à crans : zoom arrière (${p2.distance.toFixed(1)} → ${p3.distance.toFixed(1)} m)`);
  check(Math.abs(p3.yaw - p2.yaw) < 1e-3, `[${label}] molette à crans : pas de rotation`);
  await page.waitForTimeout(450);
  await page.mouse.move(640, 420);
  await page.mouse.wheel(0, -100);
  await page.waitForTimeout(50);
  const p4 = await settledPose(page);
  check(p4.distance < p3.distance * 0.95, `[${label}] molette (événement natif) : zoom avant (${p3.distance.toFixed(1)} → ${p4.distance.toFixed(1)} m)`);

  // 5. Défilement au-dessus d'un panneau ouvert : la caméra ne bouge jamais.
  await page.click('#hud-pop-btn');
  await page.waitForTimeout(100);
  const box = await page.evaluate(() => {
    const el = document.querySelector('#pop-panel:not(.hidden) .panel-body');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, 120) };
  });
  if (box) {
    await page.waitForTimeout(450);
    await page.mouse.move(box.x, box.y);
    await page.mouse.wheel(0, 300);
    await page.mouse.wheel(2.5, 5.3333335);
    await page.waitForTimeout(50);
    const p5 = await settledPose(page);
    const d5 = Math.hypot(p5.targetX - p4.targetX, p5.targetZ - p4.targetZ);
    check(d5 < 0.01 && rel(p5.distance, p4.distance) < 1e-4, `[${label}] défilement dans un panneau : caméra immobile (${d5.toFixed(3)} m)`);
    await page.click('#pop-close').catch(() => undefined);
  } else check(false, `[${label}] panneau Population introuvable`);

  // 6. Bouton « Pivoter à gauche » près de la boussole.
  const y0 = (await settledPose(page)).yaw;
  await page.click('#mm-rot-left');
  const y1 = (await settledPose(page)).yaw;
  check(Math.abs(y1 - y0 - Math.PI / 12) < 0.02, `[${label}] bouton Pivoter à gauche : +15° (${(((y1 - y0) * 180) / Math.PI).toFixed(1)}°)`);
}
