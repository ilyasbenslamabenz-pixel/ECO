/**
 * Captures du menu de construction (tiroirs Bâtiments, Services, Énergie, Routes) et d'un panneau, PC et téléphone.
 *   node tests/e2e/cap-tiroirs.mjs <préfixe> [dossier]   (après npm run build)
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch, root, serve } from './lib.mjs';

const tagName = process.argv[2] || 'tiroirs';
const out = process.argv[3] || join(root, 'tests/e2e/out');
mkdirSync(out, { recursive: true });
const { server, base } = await serve();
const browser = await launch();
const VIEWS = [['pc', { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }], ['tel', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true }]];
try {
  for (const [name, opts] of VIEWS) {
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('pageerror', e.message));
    await page.goto(`${base}/index.html?autostart`, { timeout: 300000, waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__aube?.snapshotReceived && window.__aube.lastStats, null, { timeout: 300000 });
    await page.waitForFunction(() => !document.querySelector('#toolbar').classList.contains('hidden'), null, { timeout: 120000, polling: 500 });
    await page.evaluate(() => window.__aube.send?.('setSpeed', { speed: 0 }));
    const open = (sel) => page.evaluate((s) => { const b = document.querySelector(s); if (b) b.click(); return !!b; }, sel);
    for (const [label, sel, tab] of [['batiments', '#toolbar button[data-tool=building]'], ['services', '#toolbar button[data-cat=services]'], ['services-sante', null, 'sante'], ['energie', '#toolbar button[data-cat=energy]'], ['routes', '#toolbar button[data-tool=road]']]) {
      if (sel && !(await open(sel))) {
        // Téléphone : catégories regroupées dans des familles.
        await page.evaluate((s) => window.dispatchEvent(new CustomEvent('noop', { detail: s })), sel);
      }
      if (tab) await open(`#drawer-tabs [data-tab=${tab}]`);
      await page.waitForTimeout(3500);
      await page.screenshot({ path: join(out, `${tagName}-${name}-${label}.png`) });
      const info = await page.evaluate(() => { const d = document.getElementById('build-drawer'); return d ? { hidden: d.classList.contains('hidden'), drawer: d.dataset.drawer, cards: d.querySelectorAll('.card').length, r: d.getBoundingClientRect().toJSON() } : null; });
      console.log(name, label, JSON.stringify(info));
      if (!tab && label !== 'routes') { /* garder ouvert pour l'onglet suivant */ }
    }
    await ctx.close();
  }
} finally { await browser.close(); server.close(); }
