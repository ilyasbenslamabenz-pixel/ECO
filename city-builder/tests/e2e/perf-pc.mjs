/**
 * Mesures de rendu « PC portable » (docs/PERFORMANCE_PC.md) : fenêtre 1280×800, densité 1,5 (portable Windows),
 * Chromium headless (SwiftShader : rendu LOGICIEL, les temps GPU / img/s ne représentent pas un GPU Intel).
 * On rapporte surtout ce qui ne dépend pas du GPU : appels de dessin, triangles, temps PROCESSEUR d'image
 * (mises à jour des instances / culling / LOD, puis préparation du rendu three), rapport de pixels, carte d'ombre.
 *
 * Scènes : `?demo` (ville moyenne, ≈ 120 bâtiments) et `?stress` (grande ville, 500 bâtiments, 1 000 véhicules).
 * Vues : aérienne de la démo (560 m), rue, large (900 m).
 *
 *   npm run build && node tests/e2e/perf-pc.mjs [étiquette] [paramètres d'adresse en plus, ex. "qualite=haute"]
 * Écrit tests/e2e/out/perf-pc-<étiquette>.json. `PERF_DIST=/chemin/dist` sert un autre build (mesure « avant »).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectErrors, launch, root, serve } from './lib.mjs';

const label = process.argv[2] ?? 'mesure';
const extra = process.argv[3] ? `&${process.argv[3]}` : '';
const out = join(root, 'tests/e2e/out');
mkdirSync(out, { recursive: true });
// PERF_DIST : autre build à servir (mesure « avant » sur une copie de l'ancien dist/).
const { server, base } = await serve(process.env.PERF_DIST || undefined);
const browser = await launch();
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0';
const report = { label, date: new Date().toISOString(), viewport: '1280x800@1.5', extra, scenes: [] };

const VIEWS = ['aerienne', 'rue', 'large'];

async function measureScene(scene) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.5, userAgent: UA });
  const page = await ctx.newPage();
  const errors = collectErrors(page);
  const t0 = Date.now();
  await page.goto(`${base}/index.html?${scene}${extra}`);
  await page.waitForFunction(() => window.__aube?.demoReady === true || (window.__aube?.errors?.length ?? 0) > 0, null, { timeout: 1200000 });
  const readyS = Math.round((Date.now() - t0) / 100) / 10;
  // Quelques secondes de simulation (véhicules en circulation), boucle d'affichage active.
  await page.waitForTimeout(8000);
  const res = { scene, readyS, views: [] };
  for (const name of VIEWS) {
    await page.evaluate((n) => {
      const a = window.__aube;
      if (n === 'aerienne') a.setCamera('demo-aerial');
      else if (n === 'rue') a.setCamera('demo-street');
      else { a.setCamera('demo-aerial'); const d = a.demo?.views?.aerial ?? [0, 0]; a.lookAt(d[0], d[1], 900, 0.7); }
    }, name);
    // Boucle active 4 s : LOD, culling, qualité adaptative s'installent (img/s SwiftShader relevées, indicatives).
    const f0 = await page.evaluate(() => window.__aube.frames());
    const tA = Date.now();
    await page.waitForTimeout(4000);
    const loopFps = Math.round(((await page.evaluate(() => window.__aube.frames())) - f0) / ((Date.now() - tA) / 1000) * 10) / 10;
    const v = await page.evaluate(() => {
      const a = window.__aube;
      a.pauseRender(true);
      a.renderNow(3, 1 / 30);
      const st = a.renderStats();
      const fixed = a.cpuFrames(15, 0);
      const moving = a.cpuFrames(15, 0.02);
      const bd = a.drawBreakdown();
      const top = Object.entries(bd).sort((x, y) => y[1].draws - x[1].draws).slice(0, 8).map(([k, x]) => `${k}:${x.draws}/${x.shadow}`);
      const tiers = a.qualityTier?.() ?? null;
      const r = { calls: fixed.calls, triangles: fixed.triangles, cpuUpdateMs: fixed.updateMs, cpuRenderMs: fixed.renderMs,
        cpuMovingUpdateMs: moving.updateMs, cpuMovingRenderMs: moving.renderMs,
        vehiclesDrawn: st.vehiclesDrawn, buildings: st.buildings, vegetation: st.vegetation,
        pixelRatio: a.pixelRatio?.() ?? null, tier: tiers, staticDrawsTop: top };
      a.pauseRender(false);
      return r;
    });
    v.view = name; v.swiftshaderLoopFps = loopFps;
    res.views.push(v);
    console.log(`[${label}] ${scene} ${name}: ${JSON.stringify(v)}`);
  }
  res.sim = await page.evaluate(() => ({ vehicles: window.__aube.lastStats?.vehicles, buildings: window.__aube.lastStats?.buildings, population: window.__aube.lastStats?.population }));
  res.env = await page.evaluate(() => {
    const r = document.getElementById('scene');
    return { canvas: `${r.width}x${r.height}`, dpr: devicePixelRatio };
  });
  res.errors = errors.slice(0, 5);
  await ctx.close();
  return res;
}

try {
  for (const s of ['demo', 'stress']) report.scenes.push(await measureScene(s));
} finally {
  await browser.close();
  server.close();
}
writeFileSync(join(out, `perf-pc-${label}.json`), JSON.stringify(report, null, 2));
console.log(`écrit tests/e2e/out/perf-pc-${label}.json`);
