/**
 * Mesure de fluidité AVEC processeur graphique (machines macOS de GitHub Actions, workflow perf-gpu.yml) :
 * ville de démo, profil iPhone (écran 402×874, densité 3, agent Safari iOS), Chromium (Metal via ANGLE) et WebKit
 * (moteur de Safari). Relève le processeur graphique réellement utilisé (preuve : pas de rendu logiciel),
 * images par seconde, temps d'image (médiane, 95e et 99e centiles), images lentes, calcul de la simulation,
 * mémoire et erreurs, sur trois phases : vue fixe ×1, vitesse ×16, caméra en mouvement.
 *   node tests/perf/gpu-fluidity.mjs [dist] [secondes par phase]
 */
import { writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { serve, root } from '../e2e/lib.mjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pw = require('playwright');
const dist = process.argv[2] ?? join(root, 'dist');
const PHASE = Number(process.argv[3] ?? 60) * 1000;
const out = join(root, 'tests', 'perf', 'out');
mkdirSync(out, { recursive: true });
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const { server, base } = await serve(dist);
const results = [];

for (const engine of ['chromium', 'webkit']) {
  const r = { engine, ok: false, phases: [], errors: [] };
  results.push(r);
  let browser;
  try {
    browser = await pw[engine].launch(engine === 'chromium'
      ? { args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal', '--enable-unsafe-webgpu'] }
      : {});
    const ctx = await browser.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 3, isMobile: engine === 'chromium', hasTouch: true, userAgent: UA });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => r.errors.push(String(e).slice(0, 300)));
    page.on('console', (m) => { if (m.type() === 'error') r.errors.push(`console: ${m.text().slice(0, 300)}`); });
    const t0 = Date.now();
    await page.goto(`${base}/index.html`, { timeout: 300000, waitUntil: 'domcontentloaded' });
    r.gpu = await page.evaluate(() => {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      if (!gl) return { webgl: false };
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return { webgl: true, vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR), renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) };
    });
    console.log(`[${engine}] processeur graphique : ${JSON.stringify(r.gpu)}`);
    await page.waitForSelector('#btn-new-demo:not(.hidden)', { timeout: 180000 });
    await page.click('#btn-new-demo');
    await page.waitForFunction(() => window.__aube?.sceneCheck && window.__aube.sceneCheck().buildings > 50, null, { timeout: 400000 });
    r.loadSeconds = Math.round((Date.now() - t0) / 100) / 10;
    // Chargement des modèles et textures : on laisse la scène se stabiliser.
    await page.waitForTimeout(20000);
    r.quality = await page.evaluate(() => ({ lite: window.__aube.liteMode, render: window.__aube.renderStats?.() }));
    await page.evaluate(() => {
      window.__fr = [];
      let last = performance.now();
      const f = () => { const n = performance.now(); window.__fr.push(n - last); last = n; requestAnimationFrame(f); };
      requestAnimationFrame(f);
    });
    const phases = [
      { name: 'vue fixe ×1', speed: 1, orbit: false },
      { name: 'vitesse ×16', speed: 16, orbit: false },
      { name: 'caméra en mouvement ×4', speed: 4, orbit: true },
    ];
    for (const ph of phases) {
      await page.evaluate((s) => window.__aube.send('setSpeed', { speed: s }), ph.speed);
      await page.evaluate((orbit) => {
        clearInterval(window.__orbit);
        if (!orbit) return;
        const p = window.__aube.cameraPose();
        let yaw = p.yaw ?? 0;
        window.__orbit = setInterval(() => { yaw += 0.02; window.__aube.lookAt(p.targetX ?? 0, p.targetZ ?? 0, p.distance ?? 300, p.pitch ?? 0.8, yaw); }, 50);
      }, ph.orbit);
      await page.evaluate(() => { window.__fr.length = 0; });
      // Chromium, caméra en mouvement : profil du code (fonctions les plus coûteuses) pour cibler l'optimisation.
      let cdp = null;
      if (engine === 'chromium' && ph.orbit) { cdp = await page.context().newCDPSession(page); await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 250 }); await cdp.send('Profiler.start'); }
      await page.waitForTimeout(PHASE);
      if (cdp) {
        const { profile } = await cdp.send('Profiler.stop');
        const byId = new Map(profile.nodes.map((n) => [n.id, n])); const self = new Map(); let total = 0;
        for (const sid of profile.samples) { const n = byId.get(sid); const k = `${n.callFrame.functionName || '(anonyme)'}:${n.callFrame.lineNumber}`; self.set(k, (self.get(k) ?? 0) + 1); total++; }
        r.profile = [...self].sort((a, b) => b[1] - a[1]).slice(0, 18).map(([k, c]) => `${(100 * c / total).toFixed(1)} % ${k}`);
        console.log(`[${engine}] profil caméra en mouvement :\n  ${r.profile.join('\n  ')}`);
      }
      const m = await page.evaluate(() => {
        const fr = window.__fr.splice(0).filter((v) => v > 0);
        const s = [...fr].sort((a, b) => a - b);
        const q = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0;
        const total = fr.reduce((a, b) => a + b, 0);
        const st = window.__aube.lastStats;
        const mem = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
        return {
          frames: fr.length, fps: Math.round((1000 * fr.length) / Math.max(1, total) * 10) / 10,
          p50: Math.round(q(0.5) * 10) / 10, p95: Math.round(q(0.95) * 10) / 10, p99: Math.round(q(0.99) * 10) / 10,
          slow33: Math.round((100 * fr.filter((v) => v > 33.4).length) / Math.max(1, fr.length) * 10) / 10,
          tickMs: st?.tickMs != null ? Math.round(st.tickMs * 100) / 100 : null, population: st?.population, heapMo: mem,
          gpuMo: window.__aube.gpuMemory?.()?.texturesMo ?? null, geometries: window.__aube.memStats?.().geometries ?? null,
          contextLost: window.__aube.contextLost ?? 0,
        };
      });
      r.phases.push({ name: ph.name, ...m });
      console.log(`[${engine}] ${ph.name} : ${m.fps} img/s · médiane ${m.p50} ms · 95e ${m.p95} ms · 99e ${m.p99} ms · lentes ${m.slow33} % · simulation ${m.tickMs} ms · tas ${m.heapMo} Mo · textures ${m.gpuMo} Mo`);
    }
    await page.evaluate(() => clearInterval(window.__orbit));
    // Partie en pause, caméra immobile, aucun geste : le rendu doit tomber à environ 4 images/s.
    await page.evaluate(() => window.__aube.send('setSpeed', { speed: 0 }));
    await page.waitForTimeout(4000);
    const f0 = await page.evaluate(() => window.__aube.frames());
    await page.waitForTimeout(5000);
    const f1 = await page.evaluate(() => window.__aube.frames());
    r.idleFps = Math.round(((f1 - f0) / 5) * 10) / 10;
    r.perf = await page.evaluate(() => window.__aube.renderPerf?.() ?? null);
    console.log(`[${engine}] en pause : ${r.idleFps} img/s dessinées · réglages ${JSON.stringify(r.perf)}`);
    await page.screenshot({ path: join(out, `${engine}.png`) });
    r.ok = true;
  } catch (e) {
    r.errors.push(`échec : ${String(e).slice(0, 400)}`);
    console.log(`[${engine}] échec : ${e}`);
  } finally { await browser?.close(); }
}
server.close();
writeFileSync(join(out, 'resultats.json'), JSON.stringify(results, null, 2));
const md = ['## Fluidité avec processeur graphique (profil iPhone, ville de démo)', ''];
for (const r of results) {
  md.push(`### ${r.engine} — ${r.gpu?.renderer ?? 'processeur inconnu'}`, '', `Chargement ${r.loadSeconds ?? '—'} s · erreurs ${r.errors.length} · en pause ${r.idleFps ?? '—'} img/s · résolution ${r.perf?.ratio ?? '—'} · plafond ${r.perf?.maxFps ?? '—'}`, '', '| Phase | img/s | médiane | 95e | 99e | lentes > 33 ms | simulation | tas | textures |', '|---|---|---|---|---|---|---|---|---|');
  for (const p of r.phases) md.push(`| ${p.name} | ${p.fps} | ${p.p50} ms | ${p.p95} ms | ${p.p99} ms | ${p.slow33} % | ${p.tickMs} ms | ${p.heapMo ?? '—'} Mo | ${p.gpuMo ?? '—'} Mo |`);
  if (r.errors.length) md.push('', '```', ...r.errors.slice(0, 8), '```');
  md.push('');
}
console.log(md.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.join('\n'));
