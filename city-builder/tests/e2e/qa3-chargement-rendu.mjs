/**
 * Recette QA n° 3 — sonde : rendu des bâtiments après rechargement de la page puis chargement d'une sauvegarde.
 * (constat de qa3-recette.mjs game : capture immédiate après chargement sans les maisons posées).
 * Partie graine 42 : avenue + 2 maisons par commandes, sauvegarde « qa3-rendu », rechargement de la page, chargement
 * par le chemin de l'interface, puis relevé de sceneCheck() (bâtiments rendus, en chargement, LOD visibles) à
 * 0 / 3 / 10 / 20 s et captures. Usage : node tests/e2e/qa3-chargement-rendu.mjs (après npm run build).
 * Captures : tests/e2e/out/qa3cr-*.png ; rapport : qa3cr.json.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectErrors, launch, root, serve } from './lib.mjs';

const out = join(root, 'tests/e2e/out');
const { server, base } = await serve();
const browser = await launch();
const R = { checks: [], samples: [] };
let failed = false;
const check = (ok, msg, extra) => { R.checks.push({ ok: !!ok, msg, extra }); if (!ok) failed = true; console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${msg}${extra !== undefined ? ' ' + JSON.stringify(extra).slice(0, 300) : ''}`); };
const sc = (page) => page.evaluate(() => { const s = window.__aube.sceneCheck(); return { buildings: s.buildings, loading: s.buildingsLoading, byLod: s.buildingsVisibleByLod, errors: s.buildingErrors }; });

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = collectErrors(page);
  await page.goto(`${base}/index.html?autostart&norender&seed=42`, { timeout: 300000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__aube?.ready && window.__aube.snapshotReceived && window.__aube.lastStats, null, { timeout: 300000, polling: 500 });
  await page.evaluate(() => window.__aube.send('setSpeed', { speed: 0 }));
  const [sx, sz] = [216, 416];
  const road = await page.evaluate(([x, z]) => window.__aube.send('buildRoad', { type: 'avenue', kind: 'avenue', points: [x - 90, z, x + 90, z] }).then(() => true, (e) => e.message), [sx, sz]);
  check(road === true, `avenue posée (${road})`);
  const placed = [];
  for (const [x, z, rot] of [[sx - 40, sz + 20.1, 2], [sx + 40, sz - 20.1, 0]]) {
    const r = await page.evaluate(([x, z, rot]) => window.__aube.send('placeBuilding', { assetId: 'maison_pavillon_enduit', x, z, rot }).then((v) => v, (e) => ({ err: e.message })), [x, z, rot]);
    placed.push(r);
  }
  R.placed = placed;
  await page.waitForTimeout(3000);
  await page.evaluate(([x, z]) => window.__aube.lookAt(x, z, 120, 0.9), [sx, sz]);
  await page.evaluate(() => window.__aube.renderNow(2, 0.1));
  const before = await sc(page);
  R.before = before;
  check(before.buildings >= 2, `avant sauvegarde : ${before.buildings} bâtiments rendus`, before);
  await page.screenshot({ path: join(out, 'qa3cr-avant.png'), timeout: 600000 });
  await page.evaluate(() => window.__aube.saveSlot('qa3-rendu'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__aube?.ready, null, { timeout: 300000, polling: 500 });
  await page.evaluate(() => window.__aube.loadSlot('qa3-rendu'));
  await page.waitForFunction(() => window.__aube.snapshotReceived, null, { timeout: 300000, polling: 250 });
  await page.evaluate(() => window.__aube.send('setSpeed', { speed: 0 }));
  const t0 = Date.now();
  for (const at of [0, 3, 10, 20]) {
    const wait = at * 1000 - (Date.now() - t0);
    if (wait > 0) await page.waitForTimeout(wait);
    await page.evaluate(() => window.__aube.renderNow(1, 0.05));
    const s = await sc(page);
    R.samples.push({ at, ...s, pose: await page.evaluate(() => window.__aube.cameraPose()) });
    console.log(`t=${at}s`, JSON.stringify(s));
    if (at === 0 || at === 20) await page.screenshot({ path: join(out, `qa3cr-apres-${at}s.png`), timeout: 600000 });
  }
  const last = R.samples[R.samples.length - 1];
  check(R.samples[0].buildings >= 2, `après chargement, 1re image : ${R.samples[0].buildings} bâtiments rendus (en chargement : ${R.samples[0].loading})`);
  check(last.buildings >= 2, `après chargement, 20 s : ${last.buildings} bâtiments rendus`);
  // même cadrage qu'avant la sauvegarde pour comparaison
  await page.evaluate(([x, z]) => window.__aube.lookAt(x, z, 120, 0.9), [sx, sz]);
  await page.evaluate(() => window.__aube.renderNow(2, 0.1));
  await page.screenshot({ path: join(out, 'qa3cr-apres-meme-cadrage.png'), timeout: 600000 });
  check(errors.length === 0, `aucune erreur de page (${errors.length})`, errors.slice(0, 5));
  await ctx.close();
} catch (e) {
  check(false, `exception : ${e.stack ?? e}`);
} finally {
  writeFileSync(join(out, 'qa3cr.json'), JSON.stringify(R, null, 2));
  await browser.close();
  server.close();
}
console.log(failed ? '\nQA3 CHARGEMENT-RENDU : ÉCHEC' : '\nQA3 CHARGEMENT-RENDU : SUCCÈS');
process.exit(failed ? 1 : 0);
