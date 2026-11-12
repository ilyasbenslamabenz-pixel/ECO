/**
 * PORTE DE VALIDATION VISUELLE (npm run validate:visual) — à passer avant chaque livraison.
 *  1. Ouvre dist/index.html?validate dans Chromium et appelle window.__aube.validate() :
 *     chaque asset du catalogue est réellement chargé (GLB), inspecté (maillages, triangles
 *     >= seuil de catégorie, boîte englobante non triviale et conforme au catalogue, pas de
 *     maillage-boîte), ses textures décodées (dimensions valides, map + normalMap présentes),
 *     puis rendu en vignette (couverture de pixels mesurée).
 *  2. Écrit la planche-contact tests/e2e/out/planche-contact.png et le rapport JSON.
 *  3. Ouvre la scène de démonstration (?demo), capture la vue aérienne puis la vue rue.
 *  4. Échoue si un asset échoue, si la bibliothèque compte < 30 bâtiments ou n'a pas
 *     toutes les catégories, ou si la scène de démo est indisponible.
 * Les captures produites DOIVENT être regardées par un humain/agent avant livraison.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectErrors, dist, launch, root, serve } from './lib.mjs';

const MIN_BUILDINGS = 30;
const BUILDING_CATEGORIES = ['house', 'townhouse', 'apartment_low', 'apartment_mid', 'apartment_high', 'skyscraper', 'commercial', 'industrial', 'public'];
const OTHER_REQUIRED = ['vehicle', 'tree', 'street_furniture'];

if (!existsSync(join(dist, 'index.html'))) { console.error('dist/ absent : lancer npm run build'); process.exit(1); }
const out = join(root, 'tests/e2e/out');
mkdirSync(out, { recursive: true });

const { server, base } = await serve();
const browser = await launch();
const failures = [];

try {
  // 1-2. Inspection de chaque asset + planche-contact.
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = collectErrors(page);
  await page.goto(`${base}/index.html?validate`);
  await page.waitForFunction(() => window.__aube?.ready === true, null, { timeout: 120000 });
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
  await page.close();

  // 3. Scène de démonstration : vue aérienne puis vue rue.
  const demo = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const demoErrors = collectErrors(demo);
  await demo.goto(`${base}/index.html?demo`);
  const demoReady = await demo.waitForFunction(() => window.__aube?.demoReady === true, null, { timeout: 180000 }).then(() => true).catch(() => false);
  if (!demoReady) {
    failures.push('scène de démonstration indisponible (window.__aube.demoReady jamais vrai)');
  } else {
    await demo.waitForTimeout(3000);
    await demo.screenshot({ path: join(out, 'demo-aerien.png') });
    await demo.click('#btn-camera');
    await demo.waitForTimeout(3000);
    await demo.screenshot({ path: join(out, 'demo-rue.png') });
    if (demoErrors.length) failures.push(`erreurs de page (démo) : ${demoErrors.join(' | ')}`);
  }
  await demo.close();
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
