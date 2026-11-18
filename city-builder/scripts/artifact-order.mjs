// Ordre de chargement réel des binaires (.glb / .hdr), pour la version artifact (scripts/pack-artifact.mjs) :
// lance le jeu construit (dist/) dans Chromium, ouvre une nouvelle partie et note l'ordre des premières demandes.
// Les paquets suivent cet ordre : le démarrage ne télécharge que les paquets qu'il utilise.
// Une liste périmée ne casse rien (fichiers absents : rangés après, par dossier) ; elle est seulement moins efficace.
//   npm run build && node scripts/artifact-order.mjs   → scripts/artifact-order.json
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(fileURLToPath(import.meta.url), '../..');
const { launch, serve } = await import(join(root, 'tests/e2e/lib.mjs'));
const { server, base } = await serve();
const browser = await launch();
const order = [];
try {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  page.on('request', (r) => {
    const m = /\/(assets\/[^?#]+\.(?:glb|hdr))(?:[?#]|$)/i.exec(r.url());
    if (m && !order.includes(decodeURIComponent(m[1]))) order.push(decodeURIComponent(m[1]));
  });
  await page.goto(`${base}/index.html?autostart`, { waitUntil: 'domcontentloaded', timeout: 300000 });
  await page.waitForFunction(() => window.__aube?.ready && window.__aube.lastStats, null, { timeout: 300000, polling: 200 });
  await page.waitForTimeout(6000); // modèles de la ville de départ (bâtiments, véhicules) demandés après la première image
} finally { await browser.close(); server.close(); }
writeFileSync(join(root, 'scripts/artifact-order.json'), `${JSON.stringify(order, null, 0)}\n`);
console.log(`ordre de chargement : ${order.length} fichiers → scripts/artifact-order.json`);
