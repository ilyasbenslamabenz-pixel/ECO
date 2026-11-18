/**
 * Valeur des cartes d'information au survol (outil Sélection) : la carte « Valeur foncière » affichée, le curseur sur
 * la carte → l'étiquette du curseur donne la valeur en clair (ou « aucun bâtiment ici »).
 * Lancer : npm run build && node tests/e2e/carte-survol.mjs
 */
import { collectErrors, launch, serve } from './lib.mjs';

const { server, base } = await serve();
const browser = await launch();
let failed = false;
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors = collectErrors(page);
  await page.goto(`${base}/index.html?autostart&seed=42`, { timeout: 900000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__aube?.ready && window.__aube.snapshotReceived && window.__aube.lastStats, null, { timeout: 900000, polling: 500 });
  await page.click('#btn-layers');
  await page.click('#layers-pop [data-layer=landValue]');
  await page.waitForFunction(() => window.__cartes?.layer() && window.__cartes.kind() === 'foncier', null, { timeout: 60000, polling: 200 });
  await page.click('#btn-layers').catch(() => undefined);
  let text = '';
  for (const [x, y] of [[640, 420], [600, 460], [700, 380], [520, 500]]) {
    await page.mouse.move(x, y, { steps: 4 });
    await page.waitForTimeout(600);
    text = await page.evaluate(() => { const t = document.querySelector('#cursor-tag'); return t && !t.classList.contains('hidden') ? t.textContent ?? '' : ''; });
    if (text) break;
  }
  console.log('étiquette au survol :', JSON.stringify(text));
  if (!/Valeur foncière/.test(text)) { failed = true; console.error('ÉCHEC : pas de valeur au survol'); }
  if (errors.length) { failed = true; console.error('Erreurs :', errors); }
} finally { await browser.close(); server.close(); }
process.exit(failed ? 1 : 0);
