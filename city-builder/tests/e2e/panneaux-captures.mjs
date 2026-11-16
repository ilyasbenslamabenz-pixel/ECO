/**
 * Captures des panneaux de gestion (finances, population, énergie, eau, déchets, transports, services, vue ville,
 * fiche bâtiment) au PC (1280×800) et au téléphone (390×844).
 * Usage : node tests/e2e/panneaux-captures.mjs <dossier> [préfixe]   (après npm run build)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { serve, launch, root } from './lib.mjs';

const outDir = process.argv[2] ?? join(root, 'tests/e2e/out/panneaux');
const pre = process.argv[3] ?? 'panneau';
mkdirSync(outDir, { recursive: true });
const fixture = join(outDir, 'ville.json');
if (!existsSync(fixture)) execFileSync(process.execPath, [join(root, 'node_modules/tsx/dist/cli.mjs'), join(root, 'tests/e2e/ui-history-fixture.ts'), fixture, '14']);
const save = JSON.parse(readFileSync(fixture, 'utf8'));
const { server, base } = await serve();
const browser = await launch();
const PANELS = ['finance', 'population', 'energy', 'water', 'waste', 'transport', 'services', 'city'];
try {
  for (const [w, h, tag] of [[1280, 800, 'pc'], [390, 844, 'tel']]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: w < 500, hasTouch: w < 500 });
    await ctx.addInitScript(() => { try { localStorage.setItem('aube.tutorial.v1', JSON.stringify({ skipped: true, open: false, done: false })); } catch { /* */ } });
    const page = await ctx.newPage();
    page.setDefaultTimeout(600000);
    await page.goto(`${base}/index.html?autostart&seed=42`, { timeout: 900000, waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__aube?.ready && window.__aube.snapshotReceived && window.__aube.lastStats, null, { timeout: 900000, polling: 500 });
    await page.evaluate(async (data) => { await window.__aube.send('load', { data }); }, save);
    await page.waitForFunction(() => window.__aube.lastStats?.population > 0, null, { timeout: 60000, polling: 200 });
    await page.evaluate(() => window.__aube.send('setSpeed', { speed: 0 }));
    await page.evaluate(() => window.__aube.lookAt(0, 0, 520, 0.85, 0.5));
    const shot = async (name) => {
      await page.evaluate(() => window.__aube.renderNow(1, 1 / 30));
      await page.waitForTimeout(250);
      await page.screenshot({ path: join(outDir, `${pre}-${tag}-${name}.png`) });
    };
    for (const dash of PANELS) {
      await page.evaluate((d) => document.querySelector(`#sidebar button[data-dash="${d}"]`).click(), dash);
      await page.waitForTimeout(900);
      await shot(dash);
    }
    await page.evaluate(() => { for (const id of ['finance-panel', 'pop-panel', 'dash-panel']) document.getElementById(id)?.classList.add('hidden'); });
    const id = await page.evaluate(async () => {
      const sv = await window.__aube.send('save', { slot: 'cap' });
      for (const b of sv?.data?.buildings ?? sv?.buildings ?? []) {
        const o = await window.__aube.send('inspectBuilding', { buildingId: b.id }).catch(() => null);
        if (o?.residents > 0) return b.id;
      }
      return null;
    });
    if (id != null) { await page.evaluate((i) => window.__aube.selectBuilding(i), id); await page.waitForTimeout(1500); await shot('fiche'); }
    await ctx.close();
  }
} finally { await browser.close(); server.close(); }
console.log('captures OK');
