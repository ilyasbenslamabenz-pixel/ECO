/**
 * Perte / restauration du contexte WebGL en mode allégé (npm run build, puis node tests/e2e/context-loss.mjs [dossier dist]) :
 *   1. le plafond de textures de 512 px du mode allégé est toujours appliqué après restauration ;
 *   2. aucun « object does not belong to this context » pendant la reconstruction ;
 *   3. sans restauration, un message (en français) propose de recharger la page au bout d'environ 5 s.
 * Rapport : tests/e2e/out/context-loss.json.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launch, root, serve } from './lib.mjs';

const out = join(root, 'tests/e2e/out');
mkdirSync(out, { recursive: true });
const { server, base } = await serve(process.argv[2] ? resolve(process.argv[2]) : undefined);
const browser = await launch();
let failed = false;
const R = { checks: [] };
const check = (ok, msg) => { R.checks.push({ ok: !!ok, msg }); console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${msg}`); if (!ok) failed = true; };
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
  await page.goto(`${base}/index.html?autostart&seed=42&norender&lite=1`, { timeout: 300000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__aube?.ready && window.__aube.snapshotReceived && window.__aube.lastStats, null, { timeout: 300000, polling: 500 });
  await page.evaluate(() => window.__aube.renderNow(2));
  const capBefore = await page.evaluate(() => window.__aube.maxTextureSize());
  check(capBefore <= 512, `plafond de textures du mode allégé avant la perte : ${capBefore}`);
  const n0 = logs.length;
  await page.evaluate(() => { const gl = document.getElementById('scene').getContext('webgl2'); window.__lc = gl.getExtension('WEBGL_lose_context'); window.__lc.loseContext(); });
  await page.waitForFunction(() => (window.__aube.contextLost ?? 0) >= 1, null, { timeout: 10000 });
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__lc.restoreContext());
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__aube.renderNow(3));
  const capAfter = await page.evaluate(() => window.__aube.maxTextureSize());
  check(capAfter <= 512, `plafond de textures après restauration du contexte : ${capAfter}`);
  const during = logs.slice(n0);
  const foreign = during.filter((l) => /does not belong to this context/i.test(l));
  R.restoreLogs = during.filter((l) => !/^(log|debug|info):/.test(l)).slice(0, 30);
  check(foreign.length === 0, `aucun « object does not belong to this context » après restauration (${foreign.length})`);
  check(!(await page.$('#contexte-perdu')), 'pas de message de rechargement quand le contexte revient');

  // Perte sans restauration : message au bout de ~5 s.
  await page.evaluate(() => window.__lc.loseContext());
  await page.waitForTimeout(3500);
  check(!(await page.$('#contexte-perdu')), 'pas de message avant 5 s');
  await page.waitForSelector('#contexte-perdu', { timeout: 6000 }).catch(() => undefined);
  const msg = await page.evaluate(() => document.querySelector('#contexte-perdu')?.textContent ?? '');
  R.message = msg;
  check(/rechargez la page/i.test(msg) && /Recharger la page/.test(msg), `message de rechargement affiché (« ${msg} »)`);
  await ctx.close();
} catch (e) {
  failed = true; R.exception = String(e?.stack ?? e); console.error(e);
} finally {
  writeFileSync(join(out, 'context-loss.json'), JSON.stringify(R, null, 2));
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
