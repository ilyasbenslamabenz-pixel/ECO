/**
 * Captures ordinateur sur une ville peuplée, trois tailles d'écran : tiroir Bâtiments, options Routes, fiche, tableaux.
 *   node tests/e2e/cap-pc.mjs <préfixe> [dossier]   (après npm run build)
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, root, serve } from './lib.mjs';

const tagName = process.argv[2] || 'pc';
const out = process.argv[3] || join(root, 'tests/e2e/out');
mkdirSync(out, { recursive: true });
const save = JSON.parse(readFileSync(join(root, 'tests/e2e/out/ville-interface-iphone.json'), 'utf8'));
const { server, base } = await serve();
const browser = await launch();
const SIZES = (process.argv[4] ?? '1366x768,1440x900,1920x1080').split(',').map((s) => s.split('x').map(Number));
const errors = [];
try {
  for (const [w, h] of SIZES) {
    const name = `${w}`;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    await page.goto(`${base}/index.html?autostart&seed=42`, { timeout: 300000, waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__aube?.ready && window.__aube.snapshotReceived && window.__aube.lastStats, null, { timeout: 300000, polling: 500 });
    await page.evaluate(async (data) => { await window.__aube.send('load', { data }); }, save);
    await page.waitForFunction(() => window.__aube.lastStats?.population > 0, null, { timeout: 60000, polling: 200 });
    await page.evaluate(() => window.__aube.send('setSpeed', { speed: 0 }));
    await page.evaluate(() => window.__aube.lookAt(0, 0, 420, 0.85, 0.5));
    await page.waitForTimeout(2500);
    const shot = (l) => page.screenshot({ path: join(out, `${tagName}-${name}-${l}.png`) });
    const overlaps = () => page.evaluate(() => {
      const ids = ['hud', 'toolbar', 'build-drawer', 'tool-options', 'info-panel', 'dash-panel', 'finance-panel', 'objectives', 'mm-col', 'sidebar', 'problems'];
      const vis = ids.map((id) => [id, document.getElementById(id)]).filter(([, e]) => e && e.offsetParent !== null && !e.classList.contains('hidden') && getComputedStyle(e).visibility !== 'hidden')
        .map(([id, e]) => [id, e.getBoundingClientRect()]).filter(([, r]) => r.width > 0 && r.height > 0);
      const res = [];
      for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++) {
        const [a, ra] = vis[i], [b, rb] = vis[j];
        if ((a === 'mm-col' && b === 'problems') || (a === 'problems' && b === 'mm-col')) continue;
        const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        if (ox > 4 && oy > 4) res.push(`${a}×${b} ${Math.round(ox)}×${Math.round(oy)}`);
      }
      const off = vis.filter(([, r]) => r.left < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1 || r.top < -1).map(([id]) => id);
      return { res, off };
    });
    await shot('base'); console.log(name, 'base', JSON.stringify(await overlaps()));
    await page.evaluate(() => document.querySelector('#toolbar button[data-tool=building]').click()); await page.waitForTimeout(1500);
    await shot('tiroir'); console.log(name, 'tiroir', JSON.stringify(await overlaps()));
    await page.evaluate(() => document.querySelector('#drawer-close').click());
    await page.evaluate(() => document.querySelector('#toolbar button[data-tool=road]').click()); await page.waitForTimeout(600);
    await page.evaluate(() => document.querySelector('#drawer-body .road-card[data-road=street]')?.click()); await page.waitForTimeout(800);
    await shot('options-route'); console.log(name, 'options-route', JSON.stringify(await overlaps()));
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    const id = await page.evaluate(async () => (await window.__aube.send('save', { slot: 'cap-pc' })).data.buildings[3].id);
    await page.evaluate((i) => window.__aube.selectBuilding(i), id); await page.waitForTimeout(1500);
    await shot('fiche'); console.log(name, 'fiche', JSON.stringify(await overlaps()));
    await page.evaluate(() => document.querySelector('#info-close')?.click());
    for (const d of ['finance', 'energy']) {
      await page.evaluate((k) => document.querySelector(`#sidebar [data-dash="${k}"]`)?.click(), d); await page.waitForTimeout(1200);
      await shot(`dash-${d}`); console.log(name, d, JSON.stringify(await overlaps()));
      await page.evaluate((k) => document.querySelector(`#sidebar [data-dash="${k}"]`)?.click(), d); await page.waitForTimeout(300);
    }
    await ctx.close();
  }
} finally { await browser.close(); server.close(); }
console.log('erreurs de page', JSON.stringify(errors));
