/**
 * Arbres sur les routes : aucune végétation (houppier compris) ne doit recouvrir une chaussée, ni après le tracé de
 * routes et la pose de bâtiments, ni après le chargement d'une sauvegarde, ni dans la ville de démonstration.
 * Usage : node tests/e2e/qa-arbres-routes.mjs [partie|demo|all]   (après npm run build)
 */
import { collectErrors, launch, serve } from './lib.mjs';

const only = process.argv[2] ?? 'all';
const { server, base } = await serve();
const browser = await launch();
let failed = false;
const check = (ok, msg) => { console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${msg}`); if (!ok) failed = true; };
const onRoads = (page) => page.evaluate(() => window.__aube.vegOnRoads());
try {
  if (only === 'all' || only === 'partie') {
    const page = await (await browser.newContext({ viewport: { width: 800, height: 600 } })).newPage();
    const errors = collectErrors(page);
    await page.goto(`${base}/index.html?autostart&seed=42&norender&lite=1`, { timeout: 300000, waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__aube?.ready && window.__aube.snapshotReceived && window.__aube.lastStats, null, { timeout: 300000, polling: 300 });
    await page.evaluate(() => window.__aube.send('setSpeed', { speed: 0 }));
    // Routes à travers les forêts : on cherche les zones les plus boisées autour du centre.
    const forest = await page.evaluate(() => {
      const v = window.__aube.sceneCheck().vegetation;
      return v;
    });
    console.log('végétation', JSON.stringify(forest).slice(0, 160));
    const routes = [
      ['avenue', [-4, 356, 236, 356]], ['street', [116, 236, 116, 476]], ['boulevard', [-200, 100, 200, 140]],
      ['street', [300, -200, 300, 200]], ['avenue', [-300, -100, 0, 300]],
    ];
    let built = 0;
    for (const [kind, pts] of routes) {
      const r = await page.evaluate(([k, p]) => window.__aube.send('buildRoad', { type: 'street', kind: k, points: p }).then(() => true, (e) => e.message), [kind, pts]);
      if (r === true) built++; else console.log(`  route ${kind} refusée : ${r}`);
    }
    await page.waitForTimeout(1500);
    let bad = await onRoads(page);
    check(built >= 3 && bad.length === 0, `après ${built} routes : ${bad.length} arbre(s) sur une chaussée ${JSON.stringify(bad.slice(0, 3))}`);
    // Sauvegarde puis chargement : végétation semée de nouveau, retirée sous les routes.
    await page.evaluate(() => window.__aube.saveSlot('qa-arbres'));
    await page.evaluate(() => window.__aube.loadSlot('qa-arbres'));
    await page.waitForTimeout(2500);
    bad = await onRoads(page);
    check(bad.length === 0, `après chargement de la sauvegarde : ${bad.length} arbre(s) sur une chaussée ${JSON.stringify(bad.slice(0, 3))}`);
    check(errors.length === 0, `aucune erreur de page ${errors.slice(0, 2).join(' | ')}`);
  }
  if (only === 'all' || only === 'demo') {
    const page = await (await browser.newContext({ viewport: { width: 800, height: 600 } })).newPage();
    await page.goto(`${base}/index.html?demo&norender&lite=1`, { timeout: 300000, waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__aube?.demoReady, null, { timeout: 900000, polling: 1000 });
    const bad = await onRoads(page);
    check(bad.length === 0, `ville de démonstration : ${bad.length} arbre(s) sur une chaussée ${JSON.stringify(bad.slice(0, 3))}`);
    const decor = await page.evaluate(() => window.__aube.roadDecor().filter((d) => /tree|arbre/.test(d.kind)).length);
    console.log(`  arbres d'alignement : ${decor}`);
  }
} catch (e) {
  console.error(e);
  check(false, `exception : ${e instanceof Error ? e.message : String(e)}`);
} finally {
  await browser.close();
  server.close();
}
console.log(failed ? '\nARBRES / ROUTES : ÉCHEC' : '\nARBRES / ROUTES : SUCCÈS');
process.exit(failed ? 1 : 0);
