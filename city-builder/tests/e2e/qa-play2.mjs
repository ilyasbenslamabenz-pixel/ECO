/**
 * Recette QA n°2 : carrefour de deux routes DROITES tracées à la souris (rendu du tronçon croisé),
 * pose de bâtiments à la souris le long d'une route (aperçu, rotation R, alignement), démolition d'un bâtiment,
 * croissance (habitants, emplois, véhicules) puis iPhone 13 (menu, gestes).
 *   node tests/e2e/qa-play2.mjs  (après npm run build) -> tests/e2e/out/qa2-*.png, qa-play2.json
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectErrors, launch, root, serve } from './lib.mjs';

const out = join(root, 'tests/e2e/out');
mkdirSync(out, { recursive: true });
const { server, base } = await serve();
const browser = await launch();
const R = { checks: [], notes: {} };
const check = (ok, msg) => { R.checks.push({ ok: !!ok, msg }); console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${msg}`); };
const shot = (page, name) => page.screenshot({ path: join(out, `qa2-${name}.png`), timeout: 600000 });
const stats = (page) => page.evaluate(() => window.__aube.lastStats);
const render = (page, n = 2) => page.evaluate((k) => window.__aube.renderNow?.(k), n);
const tag = (page) => page.evaluate(() => document.querySelector('#cursor-tag')?.textContent ?? '');

try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = collectErrors(page);
  await page.goto(`${base}/index.html?autostart&seed=7&norender`, { timeout: 300000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__aube?.ready && window.__aube.snapshotReceived && window.__aube.lastStats, null, { timeout: 300000, polling: 500 });
  await page.evaluate(() => window.__aube.send('setSpeed', { speed: 0 }));
  await page.evaluate(() => window.__aube.lookAt(-320, 128, 260));
  await page.keyboard.press('KeyT');
  await render(page, 6);
  // Route 1 : avenue horizontale ; route 2 : rue verticale qui la croise (deux droites à la souris).
  await page.click('#toolbar button[data-tool=road]');
  await page.click('#drawer-body .road-card[data-road=avenue]');
  await page.mouse.click(420, 450); await render(page, 1); await page.mouse.move(1020, 450); await render(page, 1);
  await page.mouse.click(1020, 450); await page.waitForTimeout(1200);
  const L1 = (await stats(page)).roadLengthM;
  await page.click('#toolbar button[data-tool=road]');
  await page.click('#drawer-body .road-card[data-road=street]');
  await page.mouse.click(720, 250); await render(page, 1); await page.mouse.move(720, 650); await render(page, 1);
  await page.mouse.click(720, 650); await page.waitForTimeout(1500);
  const L2 = (await stats(page)).roadLengthM;
  const snap = await page.evaluate(() => window.__aube.send('save', { slot: 'qa-probe' }));
  R.notes.edges = snap.data.roads.edges.map((e) => ({ id: e.id, type: e.type, a: e.a ?? e.ax, b: e.b ?? e.bx }));
  R.notes.edgeCount = snap.data.roads.edges.length;
  check(L2 > L1 && L1 > 0, `deux routes droites à la souris (longueur ${L1} -> ${L2} m), ${R.notes.edgeCount} tronçons dans la simulation`);
  await page.keyboard.press('Escape');
  await render(page, 3);
  await shot(page, 'carrefour');
  R.notes.scene = await page.evaluate(() => { const s = window.__aube.sceneCheck?.(); return s ? JSON.stringify(s).slice(0, 1500) : null; });

  // Bâtiments à la souris le long de l'avenue (au nord, façade côté route).
  await page.click('#toolbar button[data-tool=building]');
  await page.waitForTimeout(1500);
  await page.click('#drawer-body .card[data-asset]');
  const b0 = (await stats(page)).buildings;
  const tags = [];
  let placed = 0;
  for (const y of [415, 405, 395, 385, 375, 485, 495, 505]) {
    for (const x of [480, 560, 640, 820, 900]) {
      await page.mouse.move(x, y); await render(page, 1);
      const t = await tag(page);
      tags.push(`${x},${y}: ${t.replace(/\n/g, ' / ')}`);
      if (placed === 0 && !/empiète|refus|Impossible|occupé|pentu/.test(t)) {
        await render(page, 2); await shot(page, 'apercu');
        await page.keyboard.press('KeyR'); await render(page, 2); await shot(page, 'apercu-rot');
        R.notes.tagRot = await tag(page);
        await page.keyboard.press('KeyR'); await page.keyboard.press('KeyR'); await page.keyboard.press('KeyR');
        await page.mouse.move(x + 1, y); await render(page, 2);
      }
      if (/empiète|Impossible|occupé|pentu/.test(t)) continue;
      await page.mouse.click(x, y); await page.waitForTimeout(900);
      const n = (await stats(page)).buildings - b0;
      if (n > placed) { placed = n; }
      if (placed >= 4) break;
    }
    if (placed >= 4) break;
  }
  R.notes.buildTags = tags;
  check(placed >= 1, `bâtiments posés à la souris : ${placed}`);
  await page.keyboard.press('Escape');
  await render(page, 3);
  await shot(page, 'batiments');
  // Croissance.
  await page.evaluate(() => window.__aube.send('setSpeed', { speed: 4 }));
  await page.waitForTimeout(20000);
  const sg = await stats(page);
  R.notes.growth = sg;
  check(sg.population > 0, `habitants emménagent (${sg.population}), emplois ${sg.jobs}, véhicules ${sg.vehicles}`);
  await page.evaluate(() => window.__aube.send('setSpeed', { speed: 0 }));
  R.notes.report = await page.evaluate(() => JSON.stringify(window.__aube.lastReport ?? null).slice(0, 1500));
  await render(page, 3);
  await shot(page, 'croissance');
  // Démolition d'un bâtiment.
  if (placed) {
    await page.click('#toolbar button[data-tool=bulldoze]');
    const bb = (await stats(page)).buildings;
    let done = false;
    for (const y of [415, 405, 395, 385, 485, 495]) for (const x of [480, 560, 640, 820, 900]) {
      if (done) break;
      await page.mouse.move(x, y); await render(page, 1);
      const t = await tag(page);
      if (/Démolir : (?!Tronçon)/.test(t)) { R.notes.bullTag = t; await page.mouse.click(x, y); await page.waitForTimeout(1000); done = true; }
    }
    const ba = (await stats(page)).buildings;
    check(ba < bb, `bâtiment démoli à la souris (${bb} -> ${ba}) ; ${JSON.stringify(R.notes.bullTag)}`);
    await page.keyboard.press('Escape');
  }
  R.errors = errors;
  check(errors.length === 0, `PC : aucune erreur de page ${errors.slice(0, 4).join(' | ')}`);
  await ctx.close();

  // iPhone 13.
  const ip = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
  const p2 = await ip.newPage();
  const e2 = collectErrors(p2);
  await p2.goto(`${base}/index.html?norender`, { timeout: 300000, waitUntil: 'domcontentloaded' });
  await p2.waitForFunction(() => window.__aube?.ready === true, null, { timeout: 300000, polling: 500 });
  await p2.waitForTimeout(1000);
  await p2.screenshot({ path: join(out, 'qa2-iphone-menu.png') });
  await p2.tap('#btn-new');
  await p2.waitForTimeout(500);
  await p2.screenshot({ path: join(out, 'qa2-iphone-form.png') });
  await p2.tap('#form-new .primary, #form-new button[type=submit]');
  await p2.waitForFunction(() => window.__aube.snapshotReceived && window.__aube.lastStats, null, { timeout: 300000, polling: 500 });
  await p2.evaluate(() => window.__aube.renderNow(3));
  await p2.screenshot({ path: join(out, 'qa2-iphone-partie.png'), timeout: 600000 });
  const cdp = await ip.newCDPSession(p2);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i + 1, radiusX: 4, radiusY: 4, force: 1 })) });
  const pose0 = await p2.evaluate(() => window.__aube.cameraPose());
  await touch('touchStart', [[150, 450], [240, 450]]);
  for (let k = 1; k <= 10; k++) { await touch('touchMove', [[150 - k * 9, 450], [240 + k * 9, 450]]); await p2.waitForTimeout(30); }
  await touch('touchEnd', []);
  await p2.evaluate(() => window.__aube.renderNow(4, 0.5));
  const pose1 = await p2.evaluate(() => window.__aube.cameraPose());
  // Rotation à deux doigts (les doigts tournent autour du centre).
  const cx = 195, cy = 450, rr = 60;
  await touch('touchStart', [[cx - rr, cy], [cx + rr, cy]]);
  for (let k = 1; k <= 10; k++) { const a = k * 0.08; await touch('touchMove', [[cx - rr * Math.cos(a), cy - rr * Math.sin(a)], [cx + rr * Math.cos(a), cy + rr * Math.sin(a)]]); await p2.waitForTimeout(30); }
  await touch('touchEnd', []);
  await p2.evaluate(() => window.__aube.renderNow(4, 0.5));
  const pose2 = await p2.evaluate(() => window.__aube.cameraPose());
  // Un doigt : déplacement.
  await touch('touchStart', [[195, 400]]);
  for (let k = 1; k <= 10; k++) { await touch('touchMove', [[195 + k * 10, 400 + k * 6]]); await p2.waitForTimeout(30); }
  await touch('touchEnd', []);
  await p2.evaluate(() => window.__aube.renderNow(4, 0.5));
  const pose3 = await p2.evaluate(() => window.__aube.cameraPose());
  R.notes.iphonePoses = { pose0, pose1, pose2, pose3 };
  check(pose1.distance < pose0.distance, `iPhone pincer = zoom (${pose0.distance.toFixed(0)} -> ${pose1.distance.toFixed(0)})`);
  check(Math.abs(pose2.yaw - pose1.yaw) > 0.05, `iPhone rotation deux doigts (yaw ${pose1.yaw.toFixed(2)} -> ${pose2.yaw.toFixed(2)})`);
  check(Math.hypot(pose3.targetX - pose2.targetX, pose3.targetZ - pose2.targetZ) > 1, 'iPhone un doigt = déplacement');
  await p2.screenshot({ path: join(out, 'qa2-iphone-gestes.png'), timeout: 600000 });
  // Outils au doigt.
  await p2.tap('#toolbar button[data-tool=building]').catch((e) => { R.notes.iphoneToolErr = String(e); });
  await p2.waitForTimeout(1500);
  await p2.screenshot({ path: join(out, 'qa2-iphone-tiroir.png'), timeout: 600000 });
  R.notes.iphoneOverflow = await p2.evaluate(() => ({ sw: document.documentElement.scrollWidth, toolbarW: document.querySelector('#toolbar').scrollWidth, hud: document.querySelector('#hud').getBoundingClientRect().height }));
  R.errorsIphone = e2;
  check(e2.length === 0, `iPhone : aucune erreur ${e2.slice(0, 3).join(' | ')}`);
  await ip.close();
} catch (e) {
  console.error('ERREUR', e); R.crash = String(e?.stack ?? e);
} finally {
  writeFileSync(join(out, 'qa-play2.json'), JSON.stringify(R, null, 2));
  await browser.close(); server.close();
}
