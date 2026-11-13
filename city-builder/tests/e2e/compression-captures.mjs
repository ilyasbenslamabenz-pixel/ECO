/**
 * Captures avant/après de la compression des assets (docs/COMPRESSION.md).
 *   node tests/e2e/compression-captures.mjs <dossier dist> <dossier de sortie>
 *   node tests/e2e/compression-captures.mjs --compare <sortie avant> <sortie après>
 * Vues : démo ordinateur (1280×800 : aérien rapproché, rue) et iPhone 13 émulé en mode allégé (?lite=1 : aérien, rue).
 * Contrôles : aucun modèle en erreur ni en cours de chargement, aucune erreur de page / console / requête.
 * --compare : écart moyen absolu par pixel (0-255) et PSNR entre images de même nom.
 * Rendu logiciel (SwiftShader) : 1 à 4 min par image.
 */
import { mkdirSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { collectErrors, launch, serve } from './lib.mjs';

if (process.argv[2] === '--compare') {
  const [a, b] = [resolve(process.argv[3]), resolve(process.argv[4])];
  for (const f of readdirSync(a).filter((n) => n.endsWith('.png')).sort()) {
    const [x, y] = await Promise.all([join(a, f), join(b, f)].map((p) => sharp(p).removeAlpha().raw().toBuffer({ resolveWithObject: true })));
    if (x.info.width !== y.info.width || x.info.height !== y.info.height) { console.log(`${f} : tailles différentes`); continue; }
    let sad = 0, sse = 0;
    for (let i = 0; i < x.data.length; i++) { const d = x.data[i] - y.data[i]; sad += Math.abs(d); sse += d * d; }
    const n = x.data.length, mse = sse / n;
    console.log(`${f} : écart moyen ${(sad / n).toFixed(2)} / 255, PSNR ${mse ? (10 * Math.log10(255 * 255 / mse)).toFixed(1) : '∞'} dB`);
  }
  process.exit(0);
}

const dir = resolve(process.argv[2] ?? 'dist');
const out = resolve(process.argv[3] ?? 'tests/e2e/out/compression');
mkdirSync(out, { recursive: true });
const { server, base } = await serve(dir);
const browser = await launch();
const require = createRequire(import.meta.url);
const { devices } = (() => { try { return require('playwright'); } catch { return require('/opt/node-tools/node_modules/playwright'); } })();
let failed = false;
const check = (ok, msg, extra) => { console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${msg}${ok || extra === undefined ? '' : ` ${JSON.stringify(extra)}`}`); if (!ok) failed = true; };

async function session(label, ctxOpts, query, views) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const errors = collectErrors(page);
  const t0 = Date.now();
  await page.goto(`${base}/index.html?demo&norender&h=10.5${query}`, { timeout: 600000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__aube?.demoReady === true || (window.__aube?.errors?.length ?? 0) > 0, null, { timeout: 1800000, polling: 1000 });
  console.log(`${label} : démo prête en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  await page.evaluate(() => window.__aube.send('setSpeed', { speed: 0 }));
  const r = await page.evaluate(() => ({ s: window.__aube.sceneCheck(), demo: window.__aube.demo, errors: window.__aube.errors, lite: window.__aube.liteMode }));
  check(r.s.buildingErrors.length === 0 && r.s.vehicleErrors.length === 0, `${label} : aucun modèle en erreur`, { b: r.s.buildingErrors, v: r.s.vehicleErrors });
  check(r.s.buildingsLoading === 0 && r.s.buildings === r.demo.buildings, `${label} : bâtiments dessinés ${r.s.buildings} / ${r.demo.buildings}`);
  check(r.errors.length === 0, `${label} : aucune erreur interne`, r.errors.slice(0, 5));
  check(r.lite === query.includes('lite=1'), `${label} : mode allégé ${r.lite ? 'actif' : 'inactif'}`);
  for (const [name, setup] of views) {
    await page.evaluate(setup, r.demo.views.aerial);
    await page.evaluate(() => window.__aube.renderNow(2, 0.5));
    await page.waitForTimeout(4000);
    await page.evaluate(() => window.__aube.renderNow(2, 0.1));
    await page.screenshot({ path: join(out, `${label}-${name}.png`), timeout: 900000 });
    console.log(`${label}-${name}.png`);
  }
  check(errors.length === 0, `${label} : aucune erreur de page / console / requête`, errors.slice(0, 5));
  await ctx.close();
}

const VIEWS = [
  ['aerien', ([x, z]) => window.__aube.lookAt(x, z, 260, 0.75, -0.4)],
  ['rue', () => window.__aube.setCamera('demo-street')],
];
try {
  await session('ordinateur', { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }, '', VIEWS);
  await session('iphone-lite', { ...devices['iPhone 13'] }, '&lite=1', VIEWS);
} catch (e) {
  console.error(e);
  failed = true;
} finally {
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
