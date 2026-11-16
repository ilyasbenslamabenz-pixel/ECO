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

// Site du barrage (graine 7) : vallon alimenté par la source posée sur les reliefs du nord-ouest.
const SOURCE = { x: -750, z: -750 };
const DAM_A = { x: -563.15, z: -916.85 }, DAM_B = { x: -732.85, z: -747.15 };
const DAM_C = { x: (DAM_A.x + DAM_B.x) / 2, z: (DAM_A.z + DAM_B.z) / 2 };
const PAINT = { x: -450, z: 150 };

const { server, base } = await serve();
const browser = await launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = collectErrors(page);
  await page.goto(`${base}/index.html?autostart&norender&seed=7`);
  await page.waitForFunction(() => window.__aube?.ready === true && window.__aube.snapshotReceived, null, { timeout: 300000 });
  await page.evaluate(() => window.__aube.send('setSpeed', { speed: 0 }));
  const hydro = () => page.evaluate(() => window.__aube.sendExt('hydroState', {}));
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
    await page.keyboard.press('Escape');
    await page.click('#toolbar button[data-cat="terrain"]');
    await page.click(`#drawer-body button[data-terrain="${mode}"]`);
  };
  const actionButton = (text) => page.locator('button', { hasText: text }).first();

  // Captures « avant ».
  await shot('avant-vallon.png', DAM_C.x, DAM_C.z, 520, 0.9, 0.6);
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
  await page.waitForFunction(async () => (await window.__aube.sendExt('hydroState', {})).edits >= 3, null, { timeout: 30000 }).catch(() => undefined);
  const afterPaint = await hydro();
  check(afterPaint.edits >= 3, 'glisser continu : plusieurs passes appliquées', afterPaint.edits);
  await page.waitForFunction((m) => window.__aube.lastStats.money < m, money0, { timeout: 20000 }).catch(() => undefined);
  const money1 = await page.evaluate(() => window.__aube.lastStats.money);
  check(money1 < money0, 'coût débité', { avant: money0, apres: money1 });
  await page.mouse.move(5, 400);
  await shot('apres-pinceau.png', PAINT.x, PAINT.z, 320, 0.9, 0.4);
  // Ctrl+Z : tout le geste est annulé d'un coup (coût remboursé).
  await page.keyboard.press('Control+z');
  await page.waitForFunction(async () => (await window.__aube.sendExt('hydroState', {})).edits === 0, null, { timeout: 20000 }).catch(() => undefined);
  const afterUndo = await hydro();
  check(afterUndo.edits === 0, 'Ctrl+Z annule le geste entier', afterUndo.edits);
  await page.waitForFunction((m) => Math.abs(window.__aube.lastStats.money - m) < 2, money0, { timeout: 20000 }).catch(() => undefined);
  check(Math.abs((await page.evaluate(() => window.__aube.lastStats.money)) - money0) < 2, 'coût remboursé à l\'annulation');

  // 2. Source d'eau sur les reliefs (un clic).
  await pick('source');
  await actionButton('25 m³/s').click();
  await page.evaluate(([x, z]) => { window.__aube.lookAt(x, z, 520, 0.9, 0.6); window.__aube.renderNow(1); }, [DAM_C.x, DAM_C.z]);
  await hoverWorld(SOURCE);
  await page.waitForFunction(() => { const p = window.__aube.toolPreview(); return p.kind === 'terrain' && p.validity !== 'pending'; }, null, { timeout: 30000 });
  const srcTag = await page.evaluate(() => document.querySelector('#cursor-tag, .cursor-tag')?.textContent ?? '');
  check(/CHF/.test(srcTag), 'aperçu de la source (coût, eau prévue)', srcTag);
  await clickWorld(SOURCE);
  await page.waitForFunction(async () => (await window.__aube.sendExt('hydroState', {})).sources.length === 1, null, { timeout: 30000 }).catch(() => undefined);
  const st1 = await hydro();
  check(st1.sources.length === 1 && st1.sources[0].q === 25, 'source posée (25 m³/s)', st1.sources);

  // 3. Barrage en travers du vallon : aperçu vert (chute, production), puis pose.
  await pick('dam');
  await page.evaluate(([x, z]) => { window.__aube.lookAt(x, z, 520, 0.9, 0.6); window.__aube.renderNow(1); }, [DAM_C.x, DAM_C.z]);
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
  await page.waitForFunction(async () => (await window.__aube.sendExt('hydroState', {})).dams.length === 1, null, { timeout: 30000 }).catch(() => undefined);
  const st2 = await hydro();
  check(st2.dams.length === 1, 'barrage posé', st2.dams);
  check(await page.evaluate(() => window.__aube.quays().length >= 16), 'parements du barrage rendus');

  // 4. Remplissage : la retenue monte jusqu'à la crête.
  await page.evaluate(() => window.__aube.send('setSpeed', { speed: 4 }));
  await page.waitForFunction(async () => { const s = await window.__aube.sendExt('hydroState', {}); return s.dams[0]?.full; }, null, { timeout: 120000, polling: 1000 }).catch(() => undefined);
  await page.evaluate(() => window.__aube.send('setSpeed', { speed: 0 }));
  const st3 = await hydro();
  const d = st3.dams[0];
  check(d && d.full && d.headM > 5 && Math.abs(d.level - d.crest) < 0.5, 'retenue pleine au niveau de la crête, chute mesurée', d);
  check(st3.lastMs < 200, 'calcul de l\'eau léger (ms)', st3.lastMs);
  const wetUp = await page.evaluate(([x, z]) => window.__aube.isWet(x, z), [DAM_C.x - 30, DAM_C.z - 30]);
  check(wetUp, 'eau visible en amont du barrage (rendu)');
  await page.mouse.move(5, 400);
  await shot('apres-retenue.png', DAM_C.x, DAM_C.z, 520, 0.9, 0.6);
  await shot('apres-retenue-proche.png', DAM_C.x, DAM_C.z, 260, 0.7, 2.2);

  // 5. Sauvegarde puis rechargement : source, barrage et retenue conservés.
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__aube.saveSlot('terraform-e2e'));
  await page.evaluate(() => window.__aube.loadSlot('terraform-e2e'));
  await page.waitForFunction(async () => (await window.__aube.sendExt('hydroState', {})).dams.length === 1, null, { timeout: 60000 }).catch(() => undefined);
  const st4 = await hydro();
  check(st4.sources.length === 1 && st4.dams.length === 1 && Math.abs(st4.dams[0].level - d.level) < 0.01, 'après rechargement : source, barrage et retenue identiques', st4.dams[0]);
  check(errors.length === 0, 'aucune erreur de page', errors.slice(0, 5));
  await page.close();
} finally {
  await browser.close();
  server.close();
}
console.log(failed ? `ÉCHEC (${failed})` : 'SUCCÈS');
process.exit(failed ? 1 : 0);
