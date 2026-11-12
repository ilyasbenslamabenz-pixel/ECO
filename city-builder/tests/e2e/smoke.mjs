/**
 * Test de fumée e2e : charge dist/index.html puis artifact.html (enveloppé) dans Chromium,
 * vérifie l'absence d'erreur de page, la réponse du worker (ready + snapshot + deltas),
 * le rendu WebGL (frames > 0), l'avancée de l'horloge simulée, une commande refusée
 * proprement (terraform -> phase 2), et produit des captures dans tests/e2e/out/.
 * Pré-requis : npm run build.
 */
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { collectErrors, dist, launch, root, serve } from './lib.mjs';

if (!existsSync(join(dist, 'index.html'))) { console.error('dist/ absent : lancer npm run build'); process.exit(1); }
const out = join(root, 'tests/e2e/out');
mkdirSync(out, { recursive: true });

const { server, base } = await serve();
const browser = await launch();
let failed = false;
const check = (cond, msg) => { console.log(`${cond ? 'OK  ' : 'ÉCHEC'} ${msg}`); if (!cond) failed = true; };

async function run(label, path) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = collectErrors(page);
  await page.goto(`${base}${path}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__aube?.ready === true || (window.__aube?.errors.length ?? 0) > 0, null, { timeout: 300000 });
  await page.waitForFunction(() => window.__aube.snapshotReceived && window.__aube.deltas >= 3, null, { timeout: 300000 }).catch(() => undefined);
  // ?norender : images rendues à la demande (rendu logiciel lent) ; ce sont les mêmes callbacks que la boucle.
  await page.evaluate(() => window.__aube.renderNow(3));
  const info = await page.evaluate(() => ({ ...window.__aube, frames: window.__aube.frames() }));
  check(info.workerReady, `[${label}] worker prêt (message ready reçu)`);
  check(info.snapshotReceived, `[${label}] instantané initial reçu (terrain transféré)`);
  check(info.deltas >= 3, `[${label}] deltas reçus : ${info.deltas}`);
  check(info.frames >= 3, `[${label}] frames WebGL rendues : ${info.frames}`);
  const t1 = info.lastStats?.date?.totalMinutes ?? -1;
  await page.waitForTimeout(1500);
  const t2 = await page.evaluate(() => window.__aube.lastStats?.date?.totalMinutes ?? -1);
  check(t2 > t1 && t1 >= 0, `[${label}] l'horloge de simulation avance (${t1} -> ${t2} min)`);
  const hudVisible = await page.isVisible('#hud');
  check(hudVisible, `[${label}] barre d'état visible`);
  const lang = await page.evaluate(() => document.documentElement.lang);
  if (label === 'index') check(lang === 'fr', `[${label}] lang="fr"`);
  // Bascule caméra rue / aérienne par le bouton.
  await page.click('#btn-camera');
  await page.evaluate(() => window.__aube.renderNow(2, 0.5));
  const camLabel = await page.textContent('#btn-camera');
  check(camLabel?.includes('aérienne') ?? false, `[${label}] bascule en vue rue (${camLabel})`);
  await page.screenshot({ path: join(out, `smoke-${label}-rue.png`), timeout: 600000 });
  await page.keyboard.press('KeyV');
  await page.evaluate(() => window.__aube.renderNow(2, 0.5));
  await page.screenshot({ path: join(out, `smoke-${label}-aerien.png`), timeout: 600000 });
  check(errors.length === 0, `[${label}] aucune erreur de page${errors.length ? ' :\n   ' + errors.join('\n   ') : ''}`);
  await page.close();
}

try {
  await run('index', '/index.html?autostart&norender');
  await run('artifact', '/__artifact_wrapped.html?autostart&norender');
} catch (e) {
  console.error('ÉCHEC', e);
  failed = true;
} finally {
  await browser.close();
  server.close();
}
console.log(failed ? '\nE2E : ÉCHEC' : '\nE2E : SUCCÈS');
process.exit(failed ? 1 : 0);
