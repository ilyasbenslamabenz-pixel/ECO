/** QA : après rechargement d'une sauvegarde, la scène (routes, bâtiments) est-elle bien affichée ? node tests/e2e/qa-reload-probe.mjs */
import { join } from 'node:path';
import { collectErrors, launch, root, serve } from './lib.mjs';
const out = join(root, 'tests/e2e/out');
const { server, base } = await serve();
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = collectErrors(page);
const render = (n, dt) => page.evaluate(([k, d]) => window.__aube.renderNow(k, d), [n, dt]);
await page.goto(`${base}/index.html?autostart&seed=42&norender`, { timeout: 300000, waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__aube?.ready && window.__aube.snapshotReceived && window.__aube.lastStats, null, { timeout: 300000, polling: 500 });
await page.evaluate(() => window.__aube.send('setSpeed', { speed: 0 }));
const [cx, cz] = [116, 356];
const r1 = await page.evaluate(async ([x, z]) => {
  const a = window.__aube;
  await a.send('buildRoad', { type: 'street', kind: 'street', points: [x - 120, z, x + 120, z] }).catch((e) => e.message);
  return a.send('placeBuilding', { assetId: 'maison_pavillon_enduit', x: x - 40, z: z + 21, rot: 2 }).then(() => 'ok', (e) => e.message);
}, [cx, cz]);
console.log('place', r1, JSON.stringify(await page.evaluate(() => window.__aube.lastStats)));
await page.evaluate(([x, z]) => window.__aube.lookAt(x, z, 160), [cx, cz + 25]);
await render(16, 0.5);
await page.screenshot({ path: join(out, 'qa4-reload-avant.png') });
console.log('avant', JSON.stringify(await page.evaluate(() => window.__aube.sceneCheck()).then((s) => ({ b: s.buildings, roads: s.roads, terrain: s.terrain }))));
await page.click('#btn-save'); await page.waitForTimeout(500); await page.fill('#save-name', 'qa-reload'); await page.click('#form-save button[type=submit]'); await page.waitForTimeout(1500); await page.click('#save-close');
await page.goto(`${base}/index.html?norender`, { timeout: 300000, waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__aube?.ready === true, null, { timeout: 300000, polling: 500 });
await page.click('#btn-load'); await page.waitForTimeout(800);
await page.click('#load-list li:has-text("qa-reload") button.primary');
await page.waitForFunction(() => window.__aube.snapshotReceived && window.__aube.lastStats, null, { timeout: 300000, polling: 500 });
await page.evaluate(() => window.__aube.send('setSpeed', { speed: 0 }));
await page.evaluate(([x, z]) => window.__aube.lookAt(x, z, 160), [cx, cz + 25]);
for (let i = 0; i < 6; i++) { await page.waitForTimeout(2000); await render(8, 0.5); }
await page.waitForFunction(() => window.__aube.sceneCheck().buildingsLoading === 0, null, { timeout: 120000 }).catch(() => undefined);
await render(8, 0.5);
await page.screenshot({ path: join(out, 'qa4-reload-apres.png') });
console.log('apres', JSON.stringify(await page.evaluate(() => window.__aube.sceneCheck()).then((s) => ({ b: s.buildings, err: s.buildingErrors, roads: s.roads, terrain: s.terrain }))), JSON.stringify(await page.evaluate(() => window.__aube.lastStats)));
console.log('errors', errors);
await browser.close(); server.close();
