/**
 * Fuite de tampons GPU des aperçus d'outils (npm run build, puis node tests/e2e/preview-leak.mjs [dossier dist]).
 * Compte les tampons WebGL vivants (createBuffer − deleteBuffer, compteur posé avant le chargement du jeu)
 * pendant 40 déplacements de l'aperçu de route (ruban, axe, guide, marqueurs) ; l'aperçu reconstruit ses
 * géométries à chaque déplacement : sans libération, chaque déplacement laisse des tampons orphelins.
 * Rapport : tests/e2e/out/preview-leak.json. Échec si plus de 8 tampons restent après les 40 déplacements.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { collectErrors, launch, root, serve } from './lib.mjs';

const out = join(root, 'tests/e2e/out');
mkdirSync(out, { recursive: true });
const { server, base } = await serve(process.argv[2] ? resolve(process.argv[2]) : undefined);
const browser = await launch();
let failed = false;
const R = {};
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => {
    const live = { n: 0 };
    window.__glBuffers = live;
    for (const C of [globalThis.WebGL2RenderingContext, globalThis.WebGLRenderingContext]) {
      if (!C) continue;
      const cb = C.prototype.createBuffer, db = C.prototype.deleteBuffer;
      C.prototype.createBuffer = function () { live.n++; return cb.call(this); };
      C.prototype.deleteBuffer = function (b) { if (b) live.n--; return db.call(this, b); };
    }
  });
  const page = await ctx.newPage();
  const errors = collectErrors(page);
  await page.goto(`${base}/index.html?autostart&seed=42&norender`, { timeout: 300000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__aube?.ready && window.__aube.snapshotReceived && window.__aube.lastStats, null, { timeout: 300000, polling: 500 });
  await page.evaluate(() => window.__aube.send('setSpeed', { speed: 0 }));
  const [cx, cz] = [116, 356];
  await page.evaluate(([x, z]) => window.__aube.lookAt(x, z, 470), [cx, cz + 20]);
  await page.keyboard.press('KeyT');
  await page.evaluate(() => window.__aube.renderNow(4));
  await page.click('#toolbar button[data-tool=road]');
  await page.click('#drawer-body .road-card[data-road=street]');
  const scr = (x, z) => page.evaluate(([a, b]) => window.__aube.worldToScreen(a, b), [x, z]);
  const s = await scr(cx - 170, cz + 60);
  await page.mouse.move(s.x, s.y); await page.waitForTimeout(300);
  await page.mouse.click(s.x, s.y); await page.waitForTimeout(400);
  const sample = () => page.evaluate(() => ({ buffers: window.__glBuffers.n, geometries: window.__aube.memStats().geometries }));
  // Préchauffage : premiers déplacements (création des géométries de l'aperçu).
  for (let i = 0; i < 4; i++) {
    const p = await scr(cx - 150 + i * 10, cz + 70);
    await page.mouse.move(p.x, p.y); await page.waitForTimeout(150);
    await page.evaluate(() => window.__aube.renderNow(1));
  }
  const before = await sample();
  for (let i = 0; i < 40; i++) {
    const p = await scr(cx - 110 + (i % 20) * 6, cz + 80 + Math.floor(i / 20) * 25 + (i % 3) * 4);
    await page.mouse.move(p.x, p.y); await page.waitForTimeout(120);
    await page.evaluate(() => window.__aube.renderNow(1));
  }
  const after = await sample();
  R.before = before; R.after = after; R.leakedBuffers = after.buffers - before.buffers;
  R.errors = errors.filter((e) => !/favicon/.test(e)).slice(0, 10);
  console.log(`tampons WebGL : ${before.buffers} → ${after.buffers} (${R.leakedBuffers >= 0 ? '+' : ''}${R.leakedBuffers}) ; géométries three : ${before.geometries} → ${after.geometries}`);
  if (R.leakedBuffers > 8) { failed = true; console.log('ÉCHEC fuite de tampons GPU des aperçus'); } else console.log('OK  pas de fuite de tampons GPU des aperçus');
  await ctx.close();
} catch (e) {
  failed = true; R.exception = String(e?.stack ?? e); console.error(e);
} finally {
  writeFileSync(join(out, 'preview-leak.json'), JSON.stringify(R, null, 2));
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
