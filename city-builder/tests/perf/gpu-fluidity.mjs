/**
 * Mesure de fluidité AVEC processeur graphique (machines macOS de GitHub Actions, workflow perf-gpu.yml) :
 * ville de démo, Chromium (Metal via ANGLE) et WebKit (moteur de Safari). Relève le processeur graphique réellement
 * utilisé (preuve : pas de rendu logiciel), images par seconde, temps d'image (médiane, 95e et 99e centiles),
 * images lentes, appels de rendu et triangles, calcul de la simulation, mémoire et erreurs, sur trois phases :
 * vue fixe ×1, vitesse ×16, caméra en mouvement.
 *
 * Profils (--profils=…, séparés par des virgules ; défaut : iphone) :
 *  - iphone : écran 402×874, densité 3, agent Safari iOS (mode allégé) ;
 *  - bureau1080 : navigateur d'ordinateur 1920×1080, densité 1, souris, qualité Haute ;
 *  - bureau1440 : navigateur d'ordinateur 2560×1440, densité 1, souris, qualité Haute.
 * Comparaison dans le MÊME job (machines macOS bruitées d'un job à l'autre) : --builds=apres:dist,avant:chemin
 * sert chaque version sur son propre port et alterne l'ordre (A B puis B A) d'un profil à l'autre.
 *   node tests/perf/gpu-fluidity.mjs [dist] [secondes par phase] [--profils=iphone,bureau1080] [--builds=nom:dossier,…]
 */
import { writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { serve, root } from '../e2e/lib.mjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pw = require('playwright');
const pos = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flag = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const dist = pos[0] ?? join(root, 'dist');
const PHASE = Number(pos[1] ?? 60) * 1000;
const out = join(root, 'tests', 'perf', 'out');
mkdirSync(out, { recursive: true });
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const OPTIONS_KEY = 'aube-urbaine:options:v1';

const PROFILES = {
  iphone: { viewport: { width: 402, height: 874 }, deviceScaleFactor: 3, mobile: true, hasTouch: true, userAgent: UA, quality: null },
  bureau1080: { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, mobile: false, hasTouch: false, quality: 'haute' },
  bureau1440: { viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1, mobile: false, hasTouch: false, quality: 'haute' },
};
const profiles = (flag('profils') ?? 'iphone').split(',').map((s) => s.trim()).filter((s) => PROFILES[s]);
const builds = (flag('builds') ?? `version:${dist}`).split(',').map((s) => { const [name, ...p] = s.split(':'); return { name, dir: resolve(p.join(':')) }; });
for (const b of builds) { const { server, base } = await serve(b.dir); b.server = server; b.base = base; }

const results = [];

async function run(engine, profName, build) {
  const prof = PROFILES[profName];
  const r = { engine, profile: profName, build: build.name, ok: false, phases: [], errors: [] };
  results.push(r);
  let browser;
  try {
    browser = await pw[engine].launch(engine === 'chromium'
      ? { args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal', '--enable-unsafe-webgpu'] }
      : {});
    const ctx = await browser.newContext({
      viewport: prof.viewport, deviceScaleFactor: prof.deviceScaleFactor, isMobile: prof.mobile && engine === 'chromium', hasTouch: prof.hasTouch,
      ...(prof.userAgent ? { userAgent: prof.userAgent } : {}),
    });
    if (prof.quality) {
      await ctx.addInitScript(([k, q]) => {
        try { const o = JSON.parse(localStorage.getItem(k) ?? 'null') ?? {}; localStorage.setItem(k, JSON.stringify({ ...o, quality: q })); } catch { /* stockage refusé */ }
      }, [OPTIONS_KEY, prof.quality]);
    }
    const page = await ctx.newPage();
    page.on('pageerror', (e) => r.errors.push(String(e).slice(0, 300)));
    page.on('console', (m) => { if (m.type() === 'error') r.errors.push(`console: ${m.text().slice(0, 300)}`); });
    const t0 = Date.now();
    await page.goto(`${build.base}/index.html`, { timeout: 300000, waitUntil: 'domcontentloaded' });
    r.gpu = await page.evaluate(() => {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      if (!gl) return { webgl: false };
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return { webgl: true, multiDraw: !!gl.getExtension('WEBGL_multi_draw'), vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR), renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) };
    });
    const tag = `[${engine} ${profName} ${build.name}]`;
    console.log(`${tag} processeur graphique : ${JSON.stringify(r.gpu)}`);
    await page.waitForSelector('#btn-new-demo:not(.hidden)', { timeout: 180000 });
    r.menuSeconds = Math.round((Date.now() - t0) / 100) / 10;
    // Durées d'image dès le clic (à-coups de compilation des shaders et d'envoi des textures à la première image).
    await page.evaluate(() => {
      window.__boot = [];
      let last = performance.now();
      const f = () => { const n = performance.now(); window.__boot.push([n, n - last]); last = n; if (window.__boot.length < 20000) requestAnimationFrame(f); };
      requestAnimationFrame(f);
    });
    await page.click('#btn-new-demo');
    await page.waitForFunction(() => window.__aube?.sceneCheck && window.__aube.sceneCheck().buildings > 50, null, { timeout: 400000 });
    r.loadSeconds = Math.round((Date.now() - t0) / 100) / 10;
    await page.waitForFunction(() => window.__aube?.demoReady === true, null, { timeout: 400000 }).catch(() => undefined);
    r.readySeconds = Math.round((Date.now() - t0) / 100) / 10;
    await page.evaluate(() => { window.__readyAt = performance.now(); });
    await page.waitForTimeout(3000);
    // Premières images de jeu (de 1,5 s avant « jouable » à 3 s après) : image la plus longue et images > 100 ms.
    r.firstSeconds = await page.evaluate(() => {
      const ready = window.__readyAt - 1500;
      const fr = window.__boot.filter(([t]) => t >= ready).map(([, d]) => d);
      return { frames: fr.length, maxMs: Math.round(Math.max(0, ...fr)), over100: fr.filter((d) => d > 100).length };
    });
    // Chargement des modèles et textures : on laisse la scène se stabiliser.
    await page.waitForTimeout(prof.mobile ? 20000 : 10000);
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
        console.log(`${tag} profil caméra en mouvement :\n  ${r.profile.join('\n  ')}`);
      }
      const m = await page.evaluate(() => {
        const fr = window.__fr.splice(0).filter((v) => v > 0);
        const s = [...fr].sort((a, b) => a - b);
        const q = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0;
        const total = fr.reduce((a, b) => a + b, 0);
        const st = window.__aube.lastStats;
        const rs = window.__aube.renderStats?.();
        const mem = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
        return {
          frames: fr.length, fps: Math.round((1000 * fr.length) / Math.max(1, total) * 10) / 10,
          p50: Math.round(q(0.5) * 10) / 10, p95: Math.round(q(0.95) * 10) / 10, p99: Math.round(q(0.99) * 10) / 10,
          slow33: Math.round((100 * fr.filter((v) => v > 33.4).length) / Math.max(1, fr.length) * 10) / 10,
          slow20: Math.round((100 * fr.filter((v) => v > 20).length) / Math.max(1, fr.length) * 10) / 10,
          calls: rs?.calls ?? null, triangles: rs?.triangles ?? null, updateMs: rs ? Math.round(rs.frameMs * 100) / 100 : null,
          tickMs: st?.tickMs != null ? Math.round(st.tickMs * 100) / 100 : null, population: st?.population, heapMo: mem,
          gpuMo: window.__aube.gpuMemory?.()?.texturesMo ?? null, geometries: window.__aube.memStats?.().geometries ?? null,
          contextLost: window.__aube.contextLost ?? 0,
        };
      });
      r.phases.push({ name: ph.name, ...m });
      console.log(`${tag} ${ph.name} : ${m.fps} img/s · médiane ${m.p50} ms · 95e ${m.p95} ms · 99e ${m.p99} ms · lentes ${m.slow33} % · appels ${m.calls} · triangles ${m.triangles} · simulation ${m.tickMs} ms · tas ${m.heapMo} Mo · textures ${m.gpuMo} Mo`);
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
    console.log(`${tag} en pause : ${r.idleFps} img/s dessinées · réglages ${JSON.stringify(r.perf)}`);
    await page.screenshot({ path: join(out, `${engine}-${profName}-${build.name}.png`) });
    r.ok = true;
  } catch (e) {
    r.errors.push(`échec : ${String(e).slice(0, 400)}`);
    console.log(`[${engine} ${profName} ${build.name}] échec : ${e}`);
  } finally { await browser?.close(); }
}

let flip = false;
for (const profName of profiles) {
  for (const engine of ['chromium', 'webkit']) {
    const order = flip ? [...builds].reverse() : builds;
    for (const b of order) await run(engine, profName, b);
  }
  flip = !flip;
}
for (const b of builds) b.server.close();
writeFileSync(join(out, 'resultats.json'), JSON.stringify(results, null, 2));
const md = ['## Fluidité avec processeur graphique (ville de démo)', ''];
for (const r of results) {
  md.push(`### ${r.engine} · ${r.profile} · ${r.build} — ${r.gpu?.renderer ?? 'processeur inconnu'}`, '', `Menu ${r.menuSeconds ?? '—'} s · démo chargée ${r.loadSeconds ?? '—'} s · jouable ${r.readySeconds ?? '—'} s (3 s suivantes : image max ${r.firstSeconds?.maxMs ?? '—'} ms, ${r.firstSeconds?.over100 ?? '—'} > 100 ms) · erreurs ${r.errors.length} · en pause ${r.idleFps ?? '—'} img/s · résolution ${r.perf?.ratio ?? '—'} · plafond ${r.perf?.maxFps ?? '—'} · multi-draw ${r.gpu?.multiDraw ?? '—'}`, '', '| Phase | img/s | médiane | 95e | 99e | lentes > 33 ms | > 20 ms | appels | triangles | simulation | tas | textures |', '|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const p of r.phases) md.push(`| ${p.name} | ${p.fps} | ${p.p50} ms | ${p.p95} ms | ${p.p99} ms | ${p.slow33} % | ${p.slow20} % | ${p.calls ?? '—'} | ${p.triangles ?? '—'} | ${p.tickMs} ms | ${p.heapMo ?? '—'} Mo | ${p.gpuMo ?? '—'} Mo |`);
  if (r.errors.length) md.push('', '```', ...r.errors.slice(0, 8), '```');
  md.push('');
}
console.log(md.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.join('\n'));
