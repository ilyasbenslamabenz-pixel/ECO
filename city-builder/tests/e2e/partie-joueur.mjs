/**
 * Contrôle d'une partie de joueur (sauvegarde .meknes / .meknes.json) dans le jeu buildé : import par le menu,
 * puis jeu en vitesse rapide ; relève les erreurs (console, page), les images par seconde, le temps de calcul d'un
 * pas de simulation (`tickMs` du worker) et la mémoire JS.
 * Lancer : npm run build && node tests/e2e/partie-joueur.mjs <sauvegarde> [secondes=40] [vitesse=4]
 * (rendu logiciel SwiftShader : les images par seconde sont bien plus basses que sur un vrai GPU.)
 */
import { collectErrors, launch, serve } from './lib.mjs';

const file = process.argv[2];
const secs = Number(process.argv[3] ?? 40);
const speed = Number(process.argv[4] ?? 4);
if (!file) { console.error('usage : node tests/e2e/partie-joueur.mjs <sauvegarde> [secondes] [vitesse]'); process.exit(2); }
const { server, base } = await serve();
const browser = await launch();
let failed = false;
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 755 } });
  const page = await ctx.newPage();
  const errors = collectErrors(page);
  const warnings = [];
  page.on('console', (m) => { if (m.type() === 'warning') warnings.push(m.text()); });
  const t0 = Date.now();
  await page.goto(`${base}/index.html${process.env.NORENDER ? "?norender" : ""}`, { timeout: 900000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__aube?.workerReady, null, { timeout: 900000, polling: 500 });
  await page.evaluate(() => { document.querySelector('#btn-load')?.classList.remove('hidden'); document.querySelector('#btn-load')?.click(); });
  await page.setInputFiles('#import-file', file);
  await page.waitForFunction(() => window.__aube?.ready && window.__aube.lastStats?.population > 0, null, { timeout: 900000, polling: 500 });
  const loadS = (Date.now() - t0) / 1000;
  const st0 = await page.evaluate(() => window.__aube.lastStats);
  console.log(`partie chargée en ${loadS.toFixed(1)} s : ${st0.population} habitants, ${st0.buildings ?? '?'} bâtiments`);
  await page.click(`[data-speed="${speed}"]`).catch(() => undefined);
  const f0 = await page.evaluate(() => window.__aube.frames());
  const m0 = await page.evaluate(() => window.__aube.lastStats.totalMinutes ?? window.__aube.lastStats.minutes ?? 0);
  const samples = [];
  for (let s = 0; s < secs; s += 5) {
    await page.waitForTimeout(5000);
    samples.push(await page.evaluate(() => ({ tickMs: window.__aube.lastStats?.tickMs ?? null, mem: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null })));
  }
  const f1 = await page.evaluate(() => window.__aube.frames());
  const st1 = await page.evaluate(() => window.__aube.lastStats);
  const fps = (f1 - f0) / secs;
  console.log(`images/s ≈ ${fps.toFixed(1)} (SwiftShader) ; tickMs ${samples.map((x) => x.tickMs?.toFixed?.(1)).join(' ')} ; mémoire JS (Mo) ${samples.map((x) => x.mem).join(' ')}`);
  const dMin = (st1.date?.totalMinutes ?? 0) - (st0.date?.totalMinutes ?? 0);
  console.log(`après ${secs} s à ×${speed} : ${st1.population} habitants ; ${dMin} min de jeu (${(dMin / secs).toFixed(0)} min/s, attendu ${speed * 10})`);
  if (warnings.length) console.log(`avertissements (${warnings.length}) :`, [...new Set(warnings)].slice(0, 8));
  if (errors.length) { failed = true; console.error(`ERREURS (${errors.length}) :`, [...new Set(errors)].slice(0, 12)); }
  void m0;
} finally { await browser.close(); server.close(); }
process.exit(failed ? 1 : 0);
