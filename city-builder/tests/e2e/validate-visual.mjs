/**
 * PORTE DE VALIDATION VISUELLE (npm run validate:visual) — à passer avant chaque livraison (après npm run build).
 *  1. dist/index.html?validate : window.__aube.validate() charge RÉELLEMENT chaque asset du catalogue (GLB compressés
 *     meshopt, comme en production), l'inspecte (maillages, triangles >= seuil de catégorie, boîte englobante non
 *     triviale et conforme au catalogue, pas de maillage-boîte), vérifie ses textures (images décodées, dimensions
 *     valides, map + normalMap), le rend en vignette et mesure sa couverture de pixels.
 *     -> tests/e2e/out/planche-contact.png + rapport-assets.json
 *  2. Bibliothèque : >= 30 bâtiments, toutes les familles, véhicules, arbres, mobilier.
 *  3. Scène de démonstration (?demo, 1440×900, deviceScaleFactor 1) : ville construite par la simulation ; on vérifie
 *     que TOUS les bâtiments du catalogue y sont posés, que les modèles sont chargés sans erreur (bâtiments,
 *     véhicules, végétation, décor), que des véhicules circulent, puis capture vue aérienne et vue rue et contrôle
 *     que les images ne sont pas vides (écart-type des pixels, différence entre les deux vues).
 *     -> tests/e2e/out/demo-aerien.png, demo-rue.png, demo-rapport.json
 * Échoue (code 1) au moindre problème. Les captures DOIVENT être regardées avant livraison.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { collectErrors, dist, launch, root, serve } from './lib.mjs';

const MIN_BUILDINGS = 30;
const BUILDING_CATEGORIES = ['house', 'townhouse', 'apartment_low', 'apartment_mid', 'apartment_high', 'skyscraper', 'commercial', 'industrial', 'public'];
const OTHER_REQUIRED = ['vehicle', 'tree', 'street_furniture'];
const only = process.argv.includes('--demo-only') ? 'demo' : process.argv.includes('--assets-only') ? 'assets' : 'all';

if (!existsSync(join(dist, 'index.html'))) { console.error('dist/ absent : lancer npm run build'); process.exit(1); }
const out = join(root, 'tests/e2e/out');
mkdirSync(out, { recursive: true });

const { server, base } = await serve();
const browser = await launch();
const failures = [];

/** Statistiques d'image : écart-type moyen des canaux et part de pixels « ciel » (très uniformes). */
async function imageStats(path) {
  const s = await sharp(path).stats();
  const sd = s.channels.slice(0, 3).reduce((a, c) => a + c.stdev, 0) / 3;
  return { stdev: sd, entropy: s.entropy };
}

try {
  if (only !== 'demo') {
    // 1-2. Inspection de chaque asset + planche-contact.
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const errors = collectErrors(page);
    await page.goto(`${base}/index.html?validate`);
    await page.waitForFunction(() => window.__aube?.ready === true, null, { timeout: 300000 });
    const result = await page.evaluate(() => window.__aube.validate(), null);
    const png = Buffer.from(result.contactSheet.split(',')[1], 'base64');
    writeFileSync(join(out, 'planche-contact.png'), png);
    writeFileSync(join(out, 'rapport-assets.json'), JSON.stringify(result.reports, null, 2));
    for (const r of result.reports) {
      console.log(`${r.ok ? 'OK  ' : 'ÉCHEC'} ${r.id.padEnd(32)} ${r.category.padEnd(16)} ${String(r.triangles).padStart(7)} tri  ${r.texturesDecoded} tex  couverture ${(r.pixelCoverage * 100).toFixed(1)} %`);
      if (!r.ok) failures.push(`${r.id} : ${r.errors.join(' ; ')}`);
    }
    if (result.buildingCount < MIN_BUILDINGS) failures.push(`bibliothèque : ${result.buildingCount} bâtiments < ${MIN_BUILDINGS}`);
    const cats = new Set(result.reports.map((r) => r.category));
    for (const c of [...BUILDING_CATEGORIES, ...OTHER_REQUIRED]) if (!cats.has(c)) failures.push(`bibliothèque : catégorie ${c} absente`);
    if (errors.length) failures.push(`erreurs de page (validation) : ${errors.join(' | ')}`);
    console.log(`\n${result.reports.length} assets inspectés, ${result.buildingCount} bâtiments.`);
    await page.close();
  }

  if (only !== 'assets') {
    // 3. Scène de démonstration : vue aérienne puis vue rue.
    const demo = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const demoErrors = collectErrors(demo);
    const t0 = Date.now();
    await demo.goto(`${base}/index.html?demo`);
    const demoReady = await demo.waitForFunction(() => window.__aube?.demoReady === true || (window.__aube?.errors?.length ?? 0) > 0, null, { timeout: 900000 })
      .then(() => demo.evaluate(() => window.__aube.demoReady)).catch(() => false);
    if (!demoReady) {
      failures.push(`scène de démonstration indisponible : ${await demo.evaluate(() => JSON.stringify(window.__aube?.errors ?? [])).catch(() => '?')}`);
    } else {
      console.log(`Scène de démonstration prête en ${((Date.now() - t0) / 1000).toFixed(0)} s (rendu logiciel).`);
      await demo.waitForTimeout(6000);
      const info = await demo.evaluate(() => ({ demo: window.__aube.demo, scene: window.__aube.sceneCheck(), stats: window.__aube.renderStats(), catalog: window.__aube.catalogAssets }));
      await demo.screenshot({ path: join(out, 'demo-aerien.png') });
      const aerialStats = info.stats;
      await demo.evaluate(() => window.__aube.setCamera('demo-street'));
      await demo.waitForTimeout(6000);
      await demo.screenshot({ path: join(out, 'demo-rue.png') });
      const street = await demo.evaluate(() => ({ scene: window.__aube.sceneCheck(), stats: window.__aube.renderStats() }));
      // Retour en vue aérienne par le bouton (vérifie aussi le basculement par l'interface).
      await demo.click('#btn-camera');
      await demo.waitForTimeout(1500);
      const modeAfterButton = await demo.evaluate(() => window.__aube.sceneCheck().camera);
      const a = await imageStats(join(out, 'demo-aerien.png'));
      const r = await imageStats(join(out, 'demo-rue.png'));
      const diff = await sharp(join(out, 'demo-aerien.png')).composite([{ input: join(out, 'demo-rue.png'), blend: 'difference' }]).stats();
      const viewDiff = diff.channels.slice(0, 3).reduce((s, c) => s + c.mean, 0) / 3;
      const report = { demo: info.demo, aerial: { scene: info.scene, stats: aerialStats, image: a }, street: { ...street, image: r }, viewDiff, modeAfterButton };
      writeFileSync(join(out, 'demo-rapport.json'), JSON.stringify(report, null, 2));
      const d = info.demo;
      console.log(`Démo : ${d.buildings} bâtiments, ${d.distinctBuildings} modèles distincts, ${d.vehicles} véhicules, ${d.roadsOk} tronçons, décor ${d.decor}.`);
      console.log(`Vue aérienne : ${aerialStats.calls} appels, ${aerialStats.triangles} triangles ; vue rue : ${street.stats.calls} appels, ${street.stats.triangles} triangles.`);
      if (d.missing.length) failures.push(`démo : bâtiments absents ${d.missing.join(', ')}`);
      if (d.distinctBuildings < MIN_BUILDINGS) failures.push(`démo : ${d.distinctBuildings} modèles de bâtiments < ${MIN_BUILDINGS}`);
      if (info.scene.buildings !== d.buildings) failures.push(`démo : ${info.scene.buildings} bâtiments rendus pour ${d.buildings} posés`);
      if (info.scene.buildingErrors.length) failures.push(`démo : erreurs de chargement bâtiments ${info.scene.buildingErrors.join(' | ')}`);
      if (info.scene.buildingsLoading > 0) failures.push(`démo : ${info.scene.buildingsLoading} modèles de bâtiments encore en chargement`);
      if (info.scene.vehicleErrors.length) failures.push(`démo : erreurs de chargement véhicules ${info.scene.vehicleErrors.join(' | ')}`);
      if (info.scene.vehicles.vehicles < 20) failures.push(`démo : seulement ${info.scene.vehicles.vehicles} véhicules en circulation`);
      if (info.scene.vegetation.instances !== undefined && info.scene.vegetation.instances < 100) failures.push('démo : végétation absente');
      if (Object.keys(info.scene.props).length < 5) failures.push(`démo : décor urbain incomplet (${Object.keys(info.scene.props).join(', ')})`);
      if (a.stdev < 12 || r.stdev < 12) failures.push(`captures quasi uniformes (écart-type ${a.stdev.toFixed(1)} / ${r.stdev.toFixed(1)})`);
      if (viewDiff < 10) failures.push(`vue rue identique à la vue aérienne (différence ${viewDiff.toFixed(1)})`);
      if (aerialStats.triangles < 200000) failures.push(`vue aérienne : ${aerialStats.triangles} triangles (scène vide ?)`);
      if (modeAfterButton !== 'aerial') failures.push(`bouton caméra : mode ${modeAfterButton} après bascule`);
      if (demoErrors.length) failures.push(`erreurs de page (démo) : ${demoErrors.slice(0, 8).join(' | ')}`);
    }
    await demo.close();
  }
} catch (e) {
  failures.push(`exception : ${e instanceof Error ? e.message : String(e)}`);
} finally {
  await browser.close();
  server.close();
}

console.log(`\nCaptures à REGARDER : ${join(out, 'planche-contact.png')}, ${join(out, 'demo-aerien.png')}, ${join(out, 'demo-rue.png')}`);
if (failures.length) {
  console.error(`\nVALIDATION VISUELLE : ÉCHEC (${failures.length})\n - ${failures.join('\n - ')}`);
  process.exit(1);
}
console.log('\nVALIDATION VISUELLE : SUCCÈS');
