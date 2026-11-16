/**
 * Captures des retours de construction (étiquette du curseur) : tracé de route valide et refusé, pose de bâtiment.
 *   node tests/e2e/cap-construction.mjs <préfixe> [dossier]   (après npm run build) — 1280×800.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch, root, serve } from './lib.mjs';

const tagName = process.argv[2] || 'capture';
const out = process.argv[3] || join(root, 'tests/e2e/out');
mkdirSync(out, { recursive: true });
const { server, base } = await serve();
const browser = await launch();
const render = (page, n = 2) => page.evaluate((k) => window.__aube.renderNow?.(k), n);
const tagOf = (page) => page.evaluate(() => {
  const t = document.getElementById('cursor-tag');
  return { text: t.textContent, cls: t.className, r: t.getBoundingClientRect().toJSON() };
});
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto(`${base}/index.html?autostart`, { timeout: 300000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__aube?.snapshotReceived && window.__aube.lastStats, null, { timeout: 300000 });
  await page.waitForFunction(() => !document.querySelector('#toolbar').classList.contains('hidden'), null, { timeout: 120000, polling: 500 });
  await page.evaluate(() => window.__aube.send?.('setSpeed', { speed: 0 }));
  await page.evaluate(() => window.__aube.lookAt(0, 0, 260));
  await render(page, 4);
  await page.evaluate(() => document.querySelector('#toolbar button[data-tool=road]').click());
  await page.waitForTimeout(800);
  const card = await page.$('#drawer-body .road-card[data-road=avenue]');
  if (card) await card.evaluate((e) => e.click());
  // Tracé valide.
  await page.mouse.move(420, 430); await render(page, 1);
  await page.mouse.click(420, 430); await render(page, 1);
  await page.mouse.move(820, 330); await page.waitForTimeout(800); await render(page, 2);
  console.log('route valide', JSON.stringify(await tagOf(page)));
  await page.screenshot({ path: join(out, `${tagName}-route-valide.png`) });
  // Tracé refusé : trop court, puis vers les bords de l'écran (étiquette jamais hors écran).
  for (const [x, y] of [[423, 431], [1270, 790], [1275, 20], [10, 10]]) {
    await page.mouse.move(x, y); await page.waitForTimeout(800); await render(page, 2);
    const t = await tagOf(page);
    console.log('route essai', x, y, JSON.stringify(t));
    if (t.cls.includes('error')) { await page.screenshot({ path: join(out, `${tagName}-route-refusee-${x}x${y}.png`) }); }
  }
  await page.mouse.click(700, 400, { button: 'right' });
  await page.mouse.click(700, 400, { button: 'right' });
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.querySelector('#toolbar button[data-tool=building]').click());
  await page.waitForTimeout(2500);
  await page.evaluate(() => document.querySelector('#drawer-body .card[data-asset]')?.click());
  let i = 0;
  for (const [x, y] of [[640, 470], [700, 300], [1240, 760]]) {
    await page.mouse.move(x, y); await page.waitForTimeout(800); await render(page, 2);
    const t = await tagOf(page);
    console.log('batiment', x, y, JSON.stringify(t));
    await page.screenshot({ path: join(out, `${tagName}-batiment-${t.cls.includes('error') ? 'refuse' : 'ok'}-${i++}.png`) });
  }
} finally { await browser.close(); server.close(); }
