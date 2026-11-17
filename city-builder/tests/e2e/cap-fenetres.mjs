/**
 * Captures des fenêtres (tableaux de bord, fiche bâtiment) sur une ville peuplée et du tracé de route, PC et téléphone.
 *   node tests/e2e/cap-fenetres.mjs <préfixe> [dossier]   (après npm run build)
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, root, serve } from './lib.mjs';

const tagName = process.argv[2] || 'fenetres';
const out = process.argv[3] || join(root, 'tests/e2e/out');
mkdirSync(out, { recursive: true });
const save = JSON.parse(readFileSync(join(root, 'tests/e2e/out/ville-interface-iphone.json'), 'utf8'));
const { server, base } = await serve();
const browser = await launch();
const VIEWS = [['pc', { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }], ['tel', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true }]];
const errors = [];
try {
  for (const [name, opts] of VIEWS) {
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    await page.goto(`${base}/index.html?autostart&seed=42`, { timeout: 300000, waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__aube?.ready && window.__aube.snapshotReceived && window.__aube.lastStats, null, { timeout: 300000, polling: 500 });
    await page.evaluate(async (data) => { await window.__aube.send('load', { data }); }, save);
    await page.waitForFunction(() => window.__aube.lastStats?.population > 0, null, { timeout: 60000, polling: 200 });
    await page.evaluate(() => window.__aube.send('setSpeed', { speed: 0 }));
    await page.evaluate(() => window.__aube.lookAt(0, 0, 420, 0.85, 0.5));
    await page.waitForTimeout(3000);
    const shot = (l) => page.screenshot({ path: join(out, `${tagName}-${name}-${l}.png`) });
    const dashes = name === 'pc' ? ['city', 'finance', 'population', 'services', 'energy', 'water', 'transport', 'progression'] : ['finance', 'population', 'energy', 'progression'];
    for (const d of dashes) {
      await page.evaluate((k) => {
        // Téléphone : le menu latéral s'ouvre d'abord (bouton du HUD).
        const b = document.querySelector(`#sidebar [data-dash="${k}"]`);
        if (b && b.offsetParent === null) document.querySelector('#btn-sidebar, .hud-menu, #hud-menu')?.click();
        document.querySelector(`#sidebar [data-dash="${k}"]`)?.click();
      }, d);
      await page.waitForTimeout(1500);
      await shot(`dash-${d}`);
      const info = await page.evaluate(() => { const p = document.getElementById('dash-panel'); if (!p) return null; const r = p.getBoundingClientRect(); return { hidden: p.classList.contains('hidden'), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom), docW: document.documentElement.scrollWidth }; });
      console.log(name, d, JSON.stringify(info));
      await page.keyboard.press('Escape');
      await page.evaluate(() => document.querySelector('#dash-panel .panel-btns [data-close], #dash-close')?.click());
      await page.waitForTimeout(300);
    }
    // Fiche d'un logement.
    const id = await page.evaluate(async () => { const sv = await window.__aube.send('save', { slot: 'cap-fen' }); const bs = sv?.data?.buildings ?? []; return bs.find((b) => /maison|immeuble|proc_/.test(b.assetId ?? b.asset ?? ''))?.id ?? bs[0]?.id; });
    if (id !== undefined) { await page.evaluate((i) => window.__aube.selectBuilding(i), id); await page.waitForTimeout(1500); await shot('fiche'); await page.keyboard.press('Escape'); }
    // Tracé de route : outil Routes, premier point, aperçu.
    await page.evaluate(() => { document.querySelector('#info-close')?.click(); document.querySelector('#toolbar button[data-tool=road]')?.click(); });
    await page.waitForTimeout(800);
    await page.evaluate(() => document.querySelector('#drawer-body .road-card[data-road=avenue]')?.click());
    await page.waitForTimeout(500);
    const W = opts.viewport.width, H = opts.viewport.height;
    const p1 = [Math.round(W * 0.3), Math.round(H * 0.45)], p2 = [Math.round(W * 0.7), Math.round(H * 0.32)];
    if (name === 'pc') {
      await page.mouse.move(...p1); await page.mouse.click(...p1); await page.waitForTimeout(300);
      await page.mouse.move(...p2); await page.waitForTimeout(1500);
    } else {
      await page.touchscreen.tap(...p1); await page.waitForTimeout(500);
      await page.touchscreen.tap(...p2); await page.waitForTimeout(1500);
    }
    await shot('route-apercu');
    const tag = await page.evaluate(() => ({ tag: document.getElementById('cursor-tag')?.textContent, confirm: !document.getElementById('touch-confirm')?.classList.contains('hidden'), hint: document.getElementById('tool-hint')?.textContent }));
    const okState = await page.evaluate(() => { const b = document.getElementById('tc-ok'); return b && !document.getElementById('touch-confirm').classList.contains('hidden') ? { disabled: b.disabled, text: b.textContent } : null; });
    console.log(name, 'route', JSON.stringify(tag), 'bouton', JSON.stringify(okState));
    // Tracé valide dans une zone vide, confirmé (souris : 2e clic ; téléphone : bouton de la barre tactile).
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    await page.evaluate(() => { document.querySelector('#tc-cancel')?.click(); });
    await page.evaluate(() => window.__aube.lookAt(0, -200, 260, 0.85, 0.5));
    await page.waitForTimeout(1500);
    const edges0 = await page.evaluate(async () => (await window.__aube.send('save', { slot: 'cap-r0' })).data.roads?.edges?.length ?? (await window.__aube.send('save', { slot: 'cap-r0' })).data.edges?.length);
    await page.evaluate(() => { if (!document.querySelector('#toolbar button[data-tool=road]').classList.contains('active')) document.querySelector('#toolbar button[data-tool=road]').click(); });
    await page.waitForTimeout(500);
    await page.evaluate(() => document.querySelector('#drawer-body .road-card[data-road=street]')?.click());
    await page.waitForTimeout(500);
    const q1 = [Math.round(W * 0.3), Math.round(H * 0.5)], q2 = [Math.round(W * 0.65), Math.round(H * 0.42)];
    if (name === 'pc') {
      await page.mouse.move(...q1); await page.mouse.click(...q1); await page.waitForTimeout(300);
      await page.mouse.move(...q2); await page.waitForTimeout(1200); await shot('route-valide-apercu');
      await page.mouse.click(...q2); await page.waitForTimeout(2000);
    } else {
      await page.touchscreen.tap(...q1); await page.waitForTimeout(500);
      await page.touchscreen.tap(...q2); await page.waitForTimeout(1500); await shot('route-valide-apercu');
      const st = await page.evaluate(() => ({ disabled: document.getElementById('tc-ok').disabled, text: document.getElementById('tc-ok').textContent }));
      console.log(name, 'bouton tracé valide', JSON.stringify(st));
      await page.tap('#tc-ok'); await page.waitForTimeout(2000);
    }
    await page.evaluate(() => document.getElementById('road-finish')?.click());
    await page.waitForTimeout(800);
    await shot('route-posee');
    const edges1 = await page.evaluate(async () => { const d = (await window.__aube.send('save', { slot: 'cap-r1' })).data; return d.roads?.edges?.length ?? d.edges?.length; });
    console.log(name, 'tronçons', edges0, '->', edges1);
    await ctx.close();
  }
} finally { await browser.close(); server.close(); }
console.log('erreurs de page', JSON.stringify(errors));
