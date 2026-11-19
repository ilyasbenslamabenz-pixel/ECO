/**
 * Captures d'une partie de joueur (sauvegarde .meknes / .meknes.json) : vue large, vue moyenne, vue rue, autour du
 * point regardé au chargement. Sert à comparer le rendu avant / après une retouche graphique.
 * Usage : npm run build && node tests/e2e/partie-captures.mjs <sauvegarde> <dossier> [suffixe]
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { collectErrors, launch, serve } from './lib.mjs';

const [file, outDir, tag = ''] = process.argv.slice(2);
if (!file || !outDir) { console.error('usage : node tests/e2e/partie-captures.mjs <sauvegarde> <dossier> [suffixe]'); process.exit(2); }
mkdirSync(outDir, { recursive: true });
const { server, base } = await serve();
const browser = await launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errors = collectErrors(page);
  await page.goto(`${base}/index.html${process.env.Q ? `?${process.env.Q}` : ''}`, { timeout: 900000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__aube?.workerReady, null, { timeout: 900000, polling: 500 });
  await page.evaluate(() => { document.querySelector('#btn-load')?.classList.remove('hidden'); document.querySelector('#btn-load')?.click(); });
  await page.setInputFiles('#import-file', file);
  await page.waitForFunction(() => window.__aube?.ready && window.__aube.lastStats?.population > 0, null, { timeout: 900000, polling: 500 });
  await page.evaluate(() => window.__aube.send('setSpeed', { speed: 0 }));
  await page.waitForTimeout(8000);
  const pose = await page.evaluate(() => window.__aube.cameraPose?.() ?? null);
  const cx = Number(process.env.CX ?? pose?.targetX ?? 0), cz = Number(process.env.CZ ?? pose?.targetZ ?? 0);
  console.log('cible', cx, cz, JSON.stringify(pose));
  const views = process.env.VIEWS ? JSON.parse(process.env.VIEWS) : [['large', 1400, 0.9, 0.6], ['moyenne', 520, 0.75, 0.6], ['rue', 120, 0.28, 0.6]];
  for (const [name, d, pitch, yaw] of views) {
    await page.evaluate(([x, z, dd, p, y]) => window.__aube.lookAt(x, z, dd, p, y), [cx, cz, d, pitch, yaw]);
    await page.waitForTimeout(Number(process.env.WAIT ?? 6000));
    await page.evaluate(() => window.__aube.renderNow?.(3, 0.1));
    await page.screenshot({ path: join(outDir, `${name}${tag}.jpg`), quality: 85, timeout: 600000 });
    console.log('capture', name, JSON.stringify(await page.evaluate(() => [window.__aube.buildingTextures?.(), window.__aube.qualityTier?.()])));
  }
  console.log('erreurs', errors.length, errors.slice(0, 3));
} finally {
  await browser.close();
  server.close();
}
