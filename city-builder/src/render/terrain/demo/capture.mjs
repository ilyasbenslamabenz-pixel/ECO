/**
 * Captures Playwright (Chromium + SwiftShader) de la démo environnement.
 *   node src/render/terrain/demo/capture.mjs [vue ...]   (vues : nom=paramètres d'URL)
 * Sortie : .cache/env-demo-out/<nom>.png + rapport.json (statistiques, erreurs).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectErrors, launch, root, serve } from '../../../../tests/e2e/lib.mjs';

const dir = join(root, '.cache', 'env-demo');
const out = join(root, '.cache', 'env-demo-out');
mkdirSync(out, { recursive: true });
const DEFAULT = {
  aerien: 'cam=aerien&h=15',
  survol: 'cam=survol&h=10',
  riviere: 'cam=riviere&h=16.5',
  rue: 'cam=rue&h=11',
  montagne: 'cam=montagne&h=9',
  coucher: 'cam=survol&h=20.3',
  nuit: 'cam=survol&h=23.5',
  lac: 'cam=aerien&h=13&hyd=lac&seed=3',
  foret: 'cam=foret&h=15',
  vitrine: 'cam=vitrine&h=15.5&x=-150&z=-250',
  terraformation: 'cam=survol&terra=1&h=16',
  nuit_rue: 'cam=rue&h=22.5',
};
const args = process.argv.slice(2);
const views = args.length ? Object.fromEntries(args.map((a) => { const [k, v] = a.split('='); return [k, a.slice(k.length + 1) || DEFAULT[k]]; })) : DEFAULT;
const { server, base } = await serve(dir);
const browser = await launch();
const report = {};
let failed = false;
for (const [name, qs] of Object.entries(views)) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const errors = collectErrors(page);
  const t0 = Date.now();
  await page.goto(`${base}/index.html?${qs}`);
  try {
    await page.waitForFunction(() => window.__env && (window.__env.ready || window.__env.error), null, { timeout: 420000, polling: 1000 });
  } catch { errors.push('timeout'); }
  const env = await page.evaluate(() => window.__env);
  // Quelques images de plus après stabilisation.
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(out, `${name}.png`), timeout: 300000 });
  report[name] = { qs, ms: Date.now() - t0, env, errors };
  if (env?.error || errors.length) failed = true;
  console.log(name, `${Date.now() - t0} ms`, env?.error ?? '', errors.slice(0, 5).join(' | '));
  await page.close();
}
writeFileSync(join(out, 'rapport.json'), JSON.stringify(report, null, 1));
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
