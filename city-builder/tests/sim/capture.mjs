/**
 * Démo du module simulation : bundle le banc d'essai, sert le projet, l'ouvre dans Chromium,
 * attend la fin des contrôles et capture le tableau de bord (deviceScaleFactor 1).
 * Prérequis : `npm run build` (utilise dist/sim.worker.js et dist/assets/catalog.json).
 * Usage : node tests/sim/capture.mjs
 */
import * as esbuild from 'esbuild';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { serve, launch, collectErrors, root } from '../e2e/lib.mjs';

const out = join(root, 'tests/sim/out');
await esbuild.build({ entryPoints: [join(root, 'tests/sim/demo/dashboard.ts')], bundle: true, format: 'esm', outfile: join(out, 'dashboard.js'), target: 'es2022', logLevel: 'warning' });
const { server, base } = await serve(root);
const browser = await launch();
let failed = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1360, height: 1000 }, deviceScaleFactor: 1 });
  const errors = collectErrors(page);
  await page.goto(`${base}/tests/sim/demo/index.html`);
  await page.waitForFunction(() => window.__simDemo?.series?.length >= 8, null, { timeout: 60_000 });
  await page.screenshot({ path: join(out, 'dashboard-en-cours.png'), fullPage: true });
  await page.waitForFunction(() => window.__simDemo?.done === true, null, { timeout: 120_000 });
  await page.screenshot({ path: join(out, 'dashboard.png'), fullPage: true });
  const res = await page.evaluate(() => ({ checks: window.__simDemo.checks, refused: window.__simDemo.refused, placed: window.__simDemo.placed, series: window.__simDemo.series }));
  for (const c of res.checks) { console.log(`${c.ok ? 'OK  ' : 'ECHEC'} ${c.name} — ${c.detail}`); if (!c.ok) failed++; }
  if (res.refused.length) console.log('Refus de placement :', res.refused.join(' | '));
  for (const e of errors) { console.log('ERREUR PAGE', e); failed++; }
  writeFileSync(join(out, 'rapport.json'), JSON.stringify(res, null, 1));
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await phone.goto(`${base}/tests/sim/demo/index.html`);
  await phone.waitForFunction(() => window.__simDemo?.series?.length >= 3, null, { timeout: 60_000 });
  await phone.screenshot({ path: join(out, 'dashboard-iphone.png') });
} finally {
  await browser.close();
  server.close();
}
console.log(failed ? `DÉMO SIMULATION : ${failed} échec(s)` : 'DÉMO SIMULATION : SUCCÈS');
process.exit(failed ? 1 : 0);
