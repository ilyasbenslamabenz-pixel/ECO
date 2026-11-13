/**
 * Recette QA n° 2 : après rechargement + chargement d'un emplacement, les bâtiments sont-ils AFFICHÉS
 * (pas seulement présents dans la simulation) et où est la caméra ? node tests/e2e/qa-reload-render.mjs
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectErrors, launch, root, serve } from './lib.mjs';

const out = join(root, 'tests/e2e/out');
const { server, base } = await serve();
const browser = await launch();
const R = {};
const send = (page, n, a) => page.evaluate(([n, a]) => window.__aube.send(n, a).then((r) => ({ ok: true, r }), (e) => ({ ok: false, e: e.message })), [n, a]);
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = collectErrors(page);
  await page.goto(`${base}/index.html?autostart&seed=42&norender`, { timeout: 300000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__aube?.ready && window.__aube.snapshotReceived && window.__aube.lastStats, null, { timeout: 300000, polling: 500 });
  await send(page, 'setSpeed', { speed: 0 });
  const cx = 116, cz = 356;
  R.road = await send(page, 'buildRoad', { type: 'street', kind: 'avenue', points: [cx - 120, cz, cx + 120, cz] });
  R.b = [];
  for (const [x, z, rot, a] of [[cx - 60, cz + 21, 2, 'maison_pavillon_enduit'], [cx, cz + 21, 2, 'maison_brique_pignon'], [cx + 60, cz - 21, 0, 'maison_chalet_bois']]) {
    R.b.push(await send(page, 'placeBuilding', { assetId: a, x, z, rot }));
  }
  await page.evaluate(([x, z]) => window.__aube.lookAt(x, z, 160), [cx, cz]);
  await page.evaluate(() => window.__aube.renderNow(4, 0.3));
  await page.screenshot({ path: join(out, 'qa2r-avant-immediat.png'), timeout: 240000 });
  for (let i = 0; i < 20; i++) { const l = await page.evaluate(() => { window.__aube.renderNow(2, 0.3); return window.__aube.sceneCheck().buildingsLoading; }); if (l === 0) break; await page.waitForTimeout(3000); }
  await page.waitForTimeout(20000);
  await page.evaluate(() => window.__aube.renderNow(12, 0.3));
  R.before = await page.evaluate(() => ({ sc: window.__aube.sceneCheck(), pose: window.__aube.cameraPose() }));
  await page.screenshot({ path: join(out, 'qa2r-avant.png'), timeout: 240000 });
  // Sauvegarde via l'interface
  await page.click('#btn-save');
  await page.waitForTimeout(800);
  const inp = await page.$('input[name=slot]:visible, #save-name:visible, form input[type=text]:visible');
  await inp.fill('qa-recharge');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2000);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__aube?.ready, null, { timeout: 300000, polling: 500 });
  await page.waitForTimeout(1000);
  R.menuContinue = await page.evaluate(() => { const b = document.querySelector('#btn-continue'); return { disabled: b.disabled, text: b.textContent.trim() }; });
  await page.screenshot({ path: join(out, 'qa2r-menu-apres-recharge.png'), timeout: 120000 });
  await page.click('#btn-load');
  await page.click('li:has-text("qa-recharge") button:has-text("Charger")');
  await page.waitForFunction(() => window.__aube.snapshotReceived && window.__aube.snapshotStats, null, { timeout: 300000, polling: 500 });
  await page.waitForTimeout(1500);
  for (let i = 0; i < 20; i++) { const l = await page.evaluate(() => { window.__aube.renderNow(2, 0.3); return window.__aube.sceneCheck().buildingsLoading; }); if (l === 0) break; await page.waitForTimeout(3000); }
  await page.evaluate(() => window.__aube.renderNow(12, 0.3));
  R.afterLoad = await page.evaluate(() => ({ sc: window.__aube.sceneCheck(), pose: window.__aube.cameraPose() }));
  await page.screenshot({ path: join(out, 'qa2r-apres-chargement.png'), timeout: 240000 });
  await page.evaluate(([x, z]) => window.__aube.lookAt(x, z, 160), [cx, cz]);
  await page.evaluate(() => window.__aube.renderNow(12, 0.3));
  await page.screenshot({ path: join(out, 'qa2r-apres-chargement-ville.png'), timeout: 240000 });
  R.errors = errors;
} catch (e) { R.exception = String(e.stack ?? e); }
writeFileSync(join(out, 'qa2r.json'), JSON.stringify(R, null, 2));
console.log(JSON.stringify(R, null, 1).slice(0, 4000));
await browser.close();
server.close();
