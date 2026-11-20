/**
 * Arbres de près (modèle 3D) et de loin (imposteur) : même arbre, même cadrage relatif, couleur moyenne du centre.
 * Usage : npm run build && node tests/e2e/arbres-loin.mjs <sauvegarde> <dossier>
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { collectErrors, launch, serve } from './lib.mjs';

const [file, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const { server, base } = await serve();
const browser = await launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errors = collectErrors(page);
  await page.goto(`${base}/index.html?${process.env.Q ?? 'palier=0'}`, { timeout: 900000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__aube?.workerReady, null, { timeout: 900000, polling: 500 });
  await page.evaluate(() => { document.querySelector('#btn-load')?.classList.remove('hidden'); document.querySelector('#btn-load')?.click(); });
  await page.setInputFiles('#import-file', file);
  await page.waitForFunction(() => window.__aube?.ready && window.__aube.lastStats?.population > 0, null, { timeout: 900000, polling: 500 });
  await page.evaluate(() => { window.__aube.send('setSpeed', { speed: 0 }); document.querySelectorAll('.panel, #hud, .hud').forEach((e) => { e.style.visibility = 'hidden'; }); });
  await page.waitForTimeout(5000);
  const trees = await page.evaluate(() => window.__aube.treeSample(400, 37));
  // Une forêt : l'arbre qui a le plus de voisins à moins de 40 m.
  let best = trees[0], bn = -1;
  for (const t of trees) { const n = trees.filter((u) => Math.hypot(u.x - t.x, u.z - t.z) < 40).length; if (n > bn) { bn = n; best = t; } }
  console.log('arbre', JSON.stringify(best), 'voisins', bn);
  for (const [name, d] of [['pres', 140], ['loin', 1100]]) {
    await page.evaluate(([x, z, dd]) => window.__aube.lookAt(x, z, dd, 0.75, 0.6), [best.x, best.z, d]);
    await page.waitForTimeout(Number(process.env.WAIT ?? 15000));
    await page.evaluate(() => window.__aube.renderNow?.(3, 0.1));
    await page.screenshot({ path: join(outDir, `${name}.png`), timeout: 600000 });
    console.log('capture', name, JSON.stringify(await page.evaluate(() => window.__aube.sceneCheck().vegetation.drawn)));
  }
  console.log('imposteurs', JSON.stringify(await page.evaluate(() => window.__aube.sceneCheck().vegetation.impostorChecks)));
  console.log('erreurs', errors.length, errors.slice(0, 3));
} finally { await browser.close(); server.close(); }
