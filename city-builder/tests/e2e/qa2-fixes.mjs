/**
 * Défauts mineurs de la recette QA n° 2 (node tests/e2e/qa2-fixes.mjs, après npm run build) :
 *  (b) vue d'ouverture d'une nouvelle partie : terrain affiné tout de suite autour de la caméra (plus de maillage
 *      grossier de 64 m qui recouvre les rivières par blocs) — capture immédiate, sans attendre le worker ;
 *  (a) pose d'une route : le chunk nivelé est re-maillé au LOD fin (l'herbe ne recouvre plus la chaussée) —
 *      capture juste après la pose ;
 *  (c) horloge : une journée ≈ 2 min 24 s réelles à x1 (constante GAME_MINUTES_PER_TICK, minutes de jeu écoulées en 10 s réelles) ;
 *  (d) chargement d'une sauvegarde par le chemin de l'interface : caméra recentrée sur la ville.
 * Captures : tests/e2e/out/qa2fix-ouverture.png, qa2fix-route.png, qa2fix-charge.png ; rapport qa2fix.json.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectErrors, launch, root, serve } from './lib.mjs';

const out = join(root, 'tests/e2e/out');
const { server, base } = await serve();
const browser = await launch();
let failed = false;
const R = { checks: [] };
const check = (ok, msg, extra) => { R.checks.push({ ok: !!ok, msg, extra }); console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${msg}`); if (!ok) failed = true; };
const SEED = 566201304; // graine de la partie de la recette QA n° 2

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const errors = collectErrors(page);
  await page.goto(`${base}/index.html?autostart&norender&seed=${SEED}`, { timeout: 300000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__aube?.ready === true && window.__aube.snapshotReceived, null, { timeout: 300000, polling: 500 });
  await page.evaluate(() => window.__aube.send('setSpeed', { speed: 0 }));
  // (b) ouverture : une seule image, tout de suite (le maillage fin vient de refineAround, pas du worker)
  await page.evaluate(() => window.__aube.renderNow(1, 0.05));
  const t0 = await page.evaluate(() => window.__aube.sceneCheck().terrain);
  R.opening = t0;
  await page.screenshot({ path: join(out, 'qa2fix-ouverture.png'), timeout: 600000 });
  check(t0.lodCounts[0] >= 4, `ouverture : chunks proches au LOD fin dès la première image (LOD ${t0.lodCounts.join('/')})`, t0);

  // (a) route posée près du centre puis capture immédiate en gros plan
  const site = await page.evaluate(async () => {
    for (const [x, z] of [[0, 0], [60, 40], [-80, 60], [120, -60], [-140, -100], [200, 150], [-220, 180], [260, -200], [-300, -250], [320, 280], [-380, 300], [400, -350], [0, 420], [0, -420], [450, 0], [-450, 0]]) {
      const r = await window.__aube.send('buildRoad', { type: 'avenue', kind: 'avenue', points: [x - 90, z - 30, x + 90, z + 30], dryRun: true }).then((v) => v.data ?? v, () => null);
      // sur la terre ferme (pas de pont : coût proche de 190 m × 150 ¢)
      if (r && r.cost < 190 * 150 * 1.3) return [x, z];
    }
    return null;
  });
  check(!!site, `site de route trouvé ${JSON.stringify(site)}`);
  if (site) {
    const [x, z] = site;
    // la caméra regarde d'abord ailleurs (chunk encore grossier au moment de la pose), puis vient sur la route
    await page.evaluate(() => window.__aube.lookAt(-600, -600, 300));
    await page.evaluate(() => window.__aube.renderNow(1, 0.05));
    const built = await page.evaluate(([x, z]) => window.__aube.send('buildRoad', { type: 'avenue', kind: 'avenue', points: [x - 90, z - 30, x + 90, z + 30] }).then((r) => r, (e) => ({ error: e.message })), [x, z]);
    check(!built.error, `route posée ${JSON.stringify(built).slice(0, 120)}`);
    await page.waitForFunction(() => window.__aube.sceneCheck().roads.segments >= 1, null, { timeout: 60000 });
    await page.evaluate(([x, z]) => window.__aube.lookAt(x, z, 55, 0.75), [x, z]);
    await page.evaluate(() => window.__aube.renderNow(1, 0.05));
    await page.screenshot({ path: join(out, 'qa2fix-route.png'), timeout: 600000 });
    R.roadTerrain = await page.evaluate(() => window.__aube.sceneCheck().terrain);
  }

  // (c) horloge : minutes de jeu écoulées en 10 s réelles à x1
  await page.evaluate(() => window.__aube.send('setSpeed', { speed: 1 }));
  const m0 = await page.evaluate(() => window.__aube.lastStats.date.totalMinutes);
  await page.waitForTimeout(10000);
  const m1 = await page.evaluate(() => window.__aube.lastStats.date.totalMinutes);
  const perDayMin = ((24 * 60) / Math.max(1e-6, m1 - m0)) * 10 / 60;
  R.clock = { m0, m1, realMinutesPerDay: perDayMin };
  check(perDayMin > 2 && perDayMin < 3.5, `journée de jeu ≈ ${perDayMin.toFixed(1)} min réelles à x1 (${(m1 - m0).toFixed(1)} min de jeu en 10 s)`);

  // (d) sauvegarde, caméra déplacée loin, chargement par le chemin de l'interface -> recentrage
  await page.evaluate(() => window.__aube.saveSlot('qa2fix'));
  await page.evaluate(() => window.__aube.lookAt(-700, 700, 300));
  const away = await page.evaluate(() => window.__aube.cameraPose());
  await page.evaluate(() => window.__aube.loadSlot('qa2fix'));
  await page.waitForTimeout(500);
  const pose = await page.evaluate(() => window.__aube.cameraPose());
  R.load = { away, pose, site };
  if (site) {
    const d = Math.hypot(pose.targetX - site[0], pose.targetZ - site[1]);
    check(d < 40, `après chargement : caméra recentrée sur la ville (cible à ${d.toFixed(1)} m du centre de la route, ${pose.distance.toFixed(0)} m de distance)`, pose);
  }
  await page.evaluate(() => window.__aube.renderNow(1, 0.05));
  await page.screenshot({ path: join(out, 'qa2fix-charge.png'), timeout: 600000 });
  check(errors.length === 0, `aucune erreur de page (${errors.length})`, errors.slice(0, 5));
  await page.close();
} catch (e) {
  console.error(e);
  check(false, `exception : ${e instanceof Error ? e.message : String(e)}`);
} finally {
  writeFileSync(join(out, 'qa2fix.json'), JSON.stringify(R, null, 2));
  await browser.close();
  server.close();
}
console.log(failed ? '\nQA2 CORRECTIFS : ÉCHEC' : '\nQA2 CORRECTIFS : SUCCÈS');
process.exit(failed ? 1 : 0);
