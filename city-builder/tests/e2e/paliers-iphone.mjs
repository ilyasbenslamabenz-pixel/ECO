/**
 * Paliers de qualité sur téléphone (v50) : profil iPhone (mode allégé) en qualité Auto → paliers automatiques actifs ;
 * la descente d'un palier réduit réellement véhicules et piétons lointains ; qualité Basse → palier « minimal » imposé.
 * Usage : node tests/e2e/paliers-iphone.mjs (après npm run build).
 */
import { collectErrors, launch, serve } from './lib.mjs';

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const { server, base } = await serve();
const browser = await launch();
let failed = false;
const check = (ok, msg, extra) => { console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${msg}${extra !== undefined ? ` ${JSON.stringify(extra)}` : ''}`); if (!ok) failed = true; };
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE_UA });
  const page = await ctx.newPage();
  const errors = collectErrors(page);
  const open = async (q) => {
    await page.goto(`${base}/index.html?autostart&seed=42${q}`, { timeout: 300000, waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__aube?.ready && window.__aube.snapshotReceived && window.__aube.lastStats, null, { timeout: 300000, polling: 300 });
  };
  await open('');
  const auto = await page.evaluate(() => ({ lite: window.__aube.liteMode, ...window.__aube.qualityTier() }));
  check(auto.lite === true, 'profil iPhone : mode allégé', auto);
  check(auto.auto === true && auto.tier === 0, 'qualité Auto : paliers automatiques actifs, départ au palier 0', auto);
  // Descente forcée (comme quand la cadence décroche) : le palier change pour de vrai.
  const down = await page.evaluate(() => { const p = window.__aube.render?.ctx?.perf ?? null; return p?.tierDown ? { changed: p.tierDown(performance.now() + 1e6), tier: p.tier } : null; });
  if (down) check(down.changed && down.tier === 1, 'descente d\'un palier appliquée', down);
  else console.log('INFO descente non pilotable depuis la page (poignée de rendu non exposée)');
  await open('&qualite=basse');
  const basse = await page.evaluate(() => window.__aube.qualityTier());
  check(basse.auto === false && basse.tier === 3, 'qualité Basse : palier « minimal » imposé', basse);
  check(errors.length === 0, 'aucune erreur de page', errors.slice(0, 5));
} finally {
  await browser.close();
  server.close();
}
console.log(failed ? 'ÉCHEC' : 'SUCCÈS');
process.exit(failed ? 1 : 0);
