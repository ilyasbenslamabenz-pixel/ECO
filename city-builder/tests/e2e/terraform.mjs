/**
 * E2E terraformation et eau (PC 1280 × 800, souris, Chromium SwiftShader) : peindre au pinceau Élever (glisser
 * continu), annuler d'un Ctrl+Z, poser une source d'eau, poser un barrage en travers du vallon qu'elle alimente
 * (aperçu vert avec chute et production), remplissage de la retenue, sauvegarde et rechargement.
 *   node tests/e2e/terraform.mjs            (captures dans tests/e2e/out/terraform, ou $CAPTURES_DIR)
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { collectErrors, launch, root, serve } from './lib.mjs';

const outDir = process.env.CAPTURES_DIR || join(root, 'tests', 'e2e', 'out', 'terraform');
mkdirSync(outDir, { recursive: true });
let failed = 0;
const check = (ok, msg, extra) => { console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${msg}${extra !== undefined ? ` ${JSON.stringify(extra)}` : ''}`); if (!ok) failed++; };

// Graine 7 : plaine à l'ouest. Vallon sculpté (crêtes au pinceau Élever), source au fond, barrage en travers.
const VX = -450, VZ = 150;
const SOURCE = { x: VX - 70, z: VZ };
const DAM_A = { x: VX + 20, z: VZ - 80 }, DAM_B = { x: VX + 20, z: VZ + 80 };
const DAM_C = { x: VX + 20, z: VZ };
const PAINT = { x: -300, z: -450 };

const { server, base } = await serve();
const browser = await launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = collectErrors(page);
  await page.goto(`${base}/index.html?autostart&norender&seed=7`);
  await page.waitForFunction(() => window.__aube?.ready === true && window.__aube.snapshotReceived, null, { timeout: 300000 });
  await page.evaluate(() => window.__aube.send('setSpeed', { speed: 0 }));
  const hydro = () => page.evaluate(() => window.__aube.sendExt('hydroState', {}));
  /** Attend que l'état de l'eau vérifie `pred` (sondage toutes les 500 ms). */
  const waitHydro = async (pred, timeout = 30000) => {
    const t0 = Date.now();
    let st = await hydro();
    while (!pred(st) && Date.now() - t0 < timeout) { await page.waitForTimeout(500); st = await hydro(); }
    return st;
  };
  const shot = async (name, x, z, d, pitch, yaw) => {
    await page.evaluate(([x, z, d, p, y]) => { window.__aube.lookAt(x, z, d, p, y); window.__aube.renderNow(3, 0.5); }, [x, z, d, pitch, yaw]);
    await page.screenshot({ path: join(outDir, name) });
  };
  const toScreen = (p) => page.evaluate(([x, z]) => window.__aube.worldToScreen(x, z), [p.x, p.z]);
  const hoverWorld = async (p) => { const s = await toScreen(p); await page.mouse.move(s.x, s.y); await page.evaluate(() => window.__aube.renderNow(1)); };
  const clickWorld = async (p) => {
    const s = await toScreen(p);
    await page.mouse.move(s.x, s.y);
    await page.waitForTimeout(150);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(200);
  };
  const pick = async (mode) => {
    await page.click('#toolbar button[data-cat="terrain"]');
    await page.click(`#drawer-body button[data-terrain="${mode}"]`);
  };
  const actionButton = (text) => page.locator('button', { hasText: text }).first();

  // Captures « avant ».
  await shot('avant-vallon.png', VX, VZ, 420, 0.8, 0.9);
  await shot('avant-pinceau.png', PAINT.x, PAINT.z, 320, 0.9, 0.4);

  // 1. Pinceau Élever, force forte, forme dure : appuyer et glisser à la souris.
  await pick('raise');
  await actionButton('Forte').click();
  await actionButton('Forme douce').click();
  await page.evaluate(([x, z]) => { window.__aube.lookAt(x, z, 320, 0.9, 0.4); window.__aube.renderNow(1); }, [PAINT.x, PAINT.z]);
  await hoverWorld({ x: PAINT.x - 50, z: PAINT.z });
  await page.waitForFunction(() => { const p = window.__aube.toolPreview(); return p.kind === 'terrain' && p.validity !== 'pending'; }, null, { timeout: 30000 });
  const tag0 = await page.evaluate(() => document.querySelector('#cursor-tag, .cursor-tag')?.textContent ?? '');
  check(/CHF/.test(tag0), 'aperçu du pinceau : coût affiché sous le curseur', tag0);
  const prev0 = await page.evaluate(() => window.__aube.toolPreview());
  check(prev0.hard === true && prev0.innerRadius > 0, 'aperçu : anneau du plein effet (forme dure)', { hard: prev0.hard, inner: prev0.innerRadius });
  const money0 = await page.evaluate(() => window.__aube.lastStats.money);
  const a = await toScreen({ x: PAINT.x - 50, z: PAINT.z }), b = await toScreen({ x: PAINT.x + 50, z: PAINT.z });
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= 24; i++) { await page.mouse.move(a.x + ((b.x - a.x) * i) / 24, a.y + ((b.y - a.y) * i) / 24); await page.waitForTimeout(70); }
  await page.waitForTimeout(400);
  await page.mouse.up();
  const afterPaint = await waitHydro((st) => st.edits >= 3);
  check(afterPaint.edits >= 3, 'glisser continu : plusieurs passes appliquées', afterPaint.edits);
  await page.waitForFunction((m) => window.__aube.lastStats.money < m, money0, { timeout: 20000 }).catch(() => undefined);
  const money1 = await page.evaluate(() => window.__aube.lastStats.money);
  check(money1 < money0, 'coût débité', { avant: money0, apres: money1 });
  await page.mouse.move(5, 400);
  await shot('apres-pinceau.png', PAINT.x, PAINT.z, 320, 0.9, 0.4);
  // Ctrl+Z : tout le geste est annulé d'un coup (coût remboursé).
  await page.keyboard.press('Control+z');
  const afterUndo = await waitHydro((st) => st.edits === 0, 20000);
  check(afterUndo.edits === 0, 'Ctrl+Z annule le geste entier', afterUndo.edits);
  await page.waitForFunction((m) => Math.abs(window.__aube.lastStats.money - m) < 2, money0, { timeout: 20000 }).catch(() => undefined);
  check(Math.abs((await page.evaluate(() => window.__aube.lastStats.money)) - money0) < 2, 'coût remboursé à l\'annulation');

  // 2. Vallon : deux crêtes et un mur amont au pinceau Élever (forme dure), passes envoyées à la simulation.
  const sculpt = await page.evaluate(async ([cx, cz]) => {
    let ok = 0;
    const ridge = async (x0, z0, x1, z1) => {
      const L = Math.hypot(x1 - x0, z1 - z0);
      for (let d = 0; d <= L; d += 24) for (let p = 0; p < 2; p++) {
        try { await window.__aube.sendExt('terrainEdit', { edit: { k: 'raise', x: x0 + ((x1 - x0) * d) / L, z: z0 + ((z1 - z0) * d) / L, r: 30, d: 10, s: 1 } }); ok++; } catch { /* refus */ }
      }
    };
    await ridge(cx - 120, cz - 70, cx + 40, cz - 70);
    await ridge(cx - 120, cz + 70, cx + 40, cz + 70);
    await ridge(cx - 120, cz - 70, cx - 120, cz + 70);
    return ok;
  }, [VX, VZ]);
  check(sculpt >= 36, 'vallon sculpté (passes du pinceau Élever)', sculpt);

  // 3. Source d'eau au fond du vallon (un clic).
  await pick('source');
  await actionButton('25 m³/s').click();
  await page.evaluate(([x, z]) => { window.__aube.lookAt(x, z, 420, 1.0, 0); window.__aube.renderNow(1); }, [VX, VZ]);
  await hoverWorld(SOURCE);
  await page.waitForFunction(() => { const p = window.__aube.toolPreview(); return p.kind === 'terrain' && p.validity !== 'pending'; }, null, { timeout: 30000 });
  const srcTag = await page.evaluate(() => document.querySelector('#cursor-tag, .cursor-tag')?.textContent ?? '');
  check(/CHF/.test(srcTag), 'aperçu de la source (coût, eau prévue)', srcTag);
  await clickWorld(SOURCE);
  const st1 = await waitHydro((st) => st.sources.length === 1);
  check(st1.sources.length === 1 && st1.sources[0].q === 25, 'source posée (25 m³/s)', st1.sources);

  // 4. Barrage en travers du vallon : aperçu vert (chute, production), puis pose.
  await pick('dam');
  await page.evaluate(([x, z]) => { window.__aube.lookAt(x, z, 420, 1.0, 0); window.__aube.renderNow(1); }, [VX, VZ]);
  // Refus clair : un barrage trop court.
  await clickWorld(DAM_A);
  await hoverWorld({ x: DAM_A.x + 6, z: DAM_A.z + 6 });
  await page.waitForFunction(() => { const p = window.__aube.toolPreview(); return p.kind === 'terrain' && p.validity !== 'pending' && p.start; }, null, { timeout: 30000 });
  const bad = await page.evaluate(() => window.__aube.toolPreview());
  check(bad.validity === 'error' && /court/.test(bad.message), 'aperçu rouge avec la raison (trop court)', bad.message);
  await hoverWorld(DAM_B);
  await page.waitForFunction(() => { const p = window.__aube.toolPreview(); return p.kind === 'terrain' && p.validity !== 'pending' && p.length > 100; }, null, { timeout: 60000 });
  const good = await page.evaluate(() => window.__aube.toolPreview());
  check(good.validity === 'ok' && /chute/.test(good.message) && /MW/.test(good.message), 'aperçu vert : chute, débit et production possible', good.message);
  await page.evaluate(() => window.__aube.renderNow(1));
  await page.screenshot({ path: join(outDir, 'barrage-apercu.png') });
  await clickWorld(DAM_B);
  const st2 = await waitHydro((st) => st.dams.length === 1);
  check(st2.dams.length === 1, 'barrage posé', st2.dams);
  check(st2.dams[0] && !st2.dams[0].full, 'retenue vide au départ (remplissage progressif)', st2.dams[0]);
  check(await page.evaluate(() => window.__aube.quays().length >= 16), 'parements du barrage rendus');

  // 5. Remplissage : la retenue monte jusqu'à la crête.
  // Niveaux relevés pendant le remplissage (vitesse ×2), puis retenue pleine.
  await page.evaluate(() => window.__aube.send('setSpeed', { speed: 2 }));
  const levels = [];
  const st3 = await waitHydro((st) => { if (Number.isFinite(st.dams[0]?.level)) levels.push(Math.round(st.dams[0].level * 10) / 10); return st.dams[0]?.full; }, 240000);
  await page.evaluate(() => window.__aube.send('setSpeed', { speed: 0 }));
  check(levels.length >= 2 && levels[0] < levels[levels.length - 1], 'le niveau monte pendant le remplissage', levels.slice(0, 12));
  const d = st3.dams[0];
  check(d && d.full && d.headM > 5 && Math.abs(d.level - d.crest) < 0.5, 'retenue pleine au niveau de la crête, chute mesurée', d);
  check(st3.lastMs < 200, 'calcul de l\'eau léger (ms)', st3.lastMs);
  const wetUp = await page.evaluate(([x, z]) => window.__aube.isWet(x, z), [DAM_C.x - 30, DAM_C.z]);
  check(wetUp, 'eau visible en amont du barrage (rendu)');
  await page.mouse.move(5, 400);
  await shot('apres-retenue.png', VX, VZ, 420, 0.8, 0.9);
  await shot('apres-retenue-proche.png', DAM_C.x + 40, DAM_C.z, 240, 0.6, 1.2);

  // 6. Sauvegarde puis rechargement : source, barrage et retenue conservés.
  await page.evaluate(() => window.__aube.saveSlot('terraform-e2e'));
  await page.evaluate(() => window.__aube.loadSlot('terraform-e2e'));
  const st4 = await waitHydro((st) => st.dams.length === 1 && Number.isFinite(st.dams[0].level), 60000);
  check(st4.sources.length === 1 && st4.dams.length === 1 && Math.abs(st4.dams[0].level - d.level) < 0.01, 'après rechargement : source, barrage et retenue identiques', st4.dams[0]);
  check(errors.length === 0, 'aucune erreur de page', errors.slice(0, 5));
  await page.close();
} finally {
  await browser.close();
  server.close();
}
console.log(failed ? `ÉCHEC (${failed})` : 'SUCCÈS');
process.exit(failed ? 1 : 0);
