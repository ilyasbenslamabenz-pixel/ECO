/**
 * Captures de la carte (forêts, côtes, rivières) : `node tests/e2e/carte-captures.mjs <préfixe> [graines...]`.
 * Écrit docs/captures-carte/<préfixe>-*.png : vue d'ensemble et vue moyenne d'une nouvelle partie par graine,
 * puis la ville de départ de la démo. Rendu logiciel (SwiftShader) : images à la demande (?norender).
 * Options d'environnement : CARTE_QUERY (paramètres d'URL ajoutés), CARTE_NODEMO=1 (sans la démo).
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { collectErrors, launch, root, serve } from './lib.mjs';

const prefix = process.argv[2] ?? 'capture';
const seeds = process.argv.slice(3).map(Number).filter(Number.isFinite);
if (!seeds.length) seeds.push(7, 1234);
const outDir = join(root, 'docs', 'captures-carte');
mkdirSync(outDir, { recursive: true });
const extra = process.env.CARTE_QUERY ? `&${process.env.CARTE_QUERY}` : '';

const { server, base } = await serve();
const browser = await launch();
try {
  for (const seed of seeds) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = collectErrors(page);
    await page.goto(`${base}/index.html?autostart&norender&seed=${seed}${extra}`);
    await page.waitForFunction(() => window.__aube?.ready === true && window.__aube.snapshotReceived, null, { timeout: 300000 });
    await page.evaluate(() => window.__aube.send('setSpeed', { speed: 0 }));
    for (const [name, dist, pitch] of [['ensemble', 2600, 1.15], ['moyenne', 900, 0.75]]) {
      await page.evaluate(([d, p]) => { window.__aube.lookAt(0, 0, d, p, -0.6); window.__aube.renderNow(3, 0.5); }, [dist, pitch]);
      const file = join(outDir, `${prefix}-graine${seed}-${name}.png`);
      await page.screenshot({ path: file });
      console.log('capture', file);
    }
    const stats = await page.evaluate(() => window.__aube.renderStats());
    console.log(`graine ${seed} : végétation ${stats.vegetation}, ${errors.length} erreur(s)`);
    for (const e of errors.slice(0, 5)) console.log('  ', e);
    await page.close();
  }
  if (!process.env.CARTE_NODEMO) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`${base}/index.html?demo&norender${extra}`);
    await page.waitForFunction(() => window.__aube?.demoReady === true || (window.__aube?.errors.length ?? 0) > 0, null, { timeout: 600000 });
    await page.evaluate(() => window.__aube.send('setSpeed', { speed: 0 }));
    await page.evaluate(() => { window.__aube.setCamera('demo-aerial'); window.__aube.renderNow(3, 0.5); });
    await page.screenshot({ path: join(outDir, `${prefix}-demo-aerien.png`) });
    await page.evaluate(() => { const p = window.__aube.cameraPose(); window.__aube.lookAt(p.targetX, p.targetZ, 2200, 1.1, -0.6); window.__aube.renderNow(3, 0.5); });
    await page.screenshot({ path: join(outDir, `${prefix}-demo-ensemble.png`) });
    const stats = await page.evaluate(() => ({ ...window.__aube.renderStats(), demo: window.__aube.demo }));
    console.log(`démo : végétation ${stats.vegetation}, bâtiments ${stats.buildings}`);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
