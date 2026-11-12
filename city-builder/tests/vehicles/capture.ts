/**
 * Captures de la scène de test véhicules / trafic (Chromium + SwiftShader, deviceScaleFactor 1) :
 *   npx tsx tests/vehicles/capture.ts [vue1,vue2…]   (vues : aerien, carrefour, dessus, rue, rue_avenue, nuit, densite)
 * Bundle la page (src/render/vehicles/demo/demo.ts) et le worker de trafic (src/sim/traffic/demo-worker.ts),
 * attend le chargement complet (modèles, textures, simulation), écrit tests/vehicles/out/demo_<vue>.png et
 * demo_rapport.json. Échoue si la page signale une erreur, une erreur console/HTTP, aucun véhicule
 * simulé ou dessiné, ou une erreur de chargement de modèle. Les captures doivent être REGARDÉES.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as esbuild from 'esbuild';
import { loadPlaywright, serveRoot } from '../../tools/vehicles/showcase/run';

const root = join(import.meta.dirname, '..', '..');
const cache = join(root, '.cache', 'vehicles-demo');
const out = join(root, 'tests', 'vehicles', 'out');
const ALL = ['aerien', 'carrefour', 'dessus', 'rue', 'rue_avenue', 'densite', 'nuit'];
const views = process.argv[2] ? process.argv[2].split(',') : ALL;

mkdirSync(cache, { recursive: true });
mkdirSync(out, { recursive: true });
await esbuild.build({ entryPoints: [join(root, 'src/render/vehicles/demo/demo.ts')], bundle: true, format: 'esm', outfile: join(cache, 'demo.js'), logLevel: 'warning', target: 'es2022' });
await esbuild.build({ entryPoints: [join(root, 'src/sim/traffic/demo-worker.ts')], bundle: true, format: 'iife', outfile: join(cache, 'traffic-worker.js'), logLevel: 'warning', target: 'es2022' });
writeFileSync(join(cache, 'demo.html'), '<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Démo trafic</title><style>html,body{margin:0;height:100%;background:#000;overflow:hidden}canvas{width:100vw;height:100vh;display:block}#hud{position:fixed;left:8px;top:8px;font:13px/1.3 DejaVu Sans,sans-serif;color:#f2f4f7;background:rgba(12,15,20,.72);padding:6px 9px;border-radius:6px}</style></head><body><canvas id="c"></canvas><div id="hud"></div><script type="module" src="/demo.js"></script></body></html>');

const { server, base } = await serveRoot(root, { '/demo.html': join(cache, 'demo.html'), '/demo.js': join(cache, 'demo.js'), '/traffic-worker.js': join(cache, 'traffic-worker.js') });
const browser = await loadPlaywright().chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const errors: string[] = [];
let code = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e: Error) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m: any) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('response', (r: any) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });
  const extra = process.argv[3] ?? '';
  await page.goto(`${base}/demo.html?vue=${views[0]}${extra ? `&${extra}` : ''}`);
  await page.waitForFunction('window.__vd && (window.__vd.ready || window.__vd.error)', null, { timeout: 900000 });
  const err = await page.evaluate('window.__vd.error');
  if (err) throw new Error(String(err));
  const shots: Record<string, unknown> = {};
  for (const v of views) {
    await page.evaluate(`window.__vd.view(${JSON.stringify(v)})`);
    await page.screenshot({ path: join(out, `demo_${v}.png`) });
    shots[v] = await page.evaluate('window.__vd.stats');
    console.log(`capture : tests/vehicles/out/demo_${v}.png`, JSON.stringify((shots[v] as { render: unknown }).render));
  }
  const st = shots[views[views.length - 1]!] as { sim: { vehicles: number }; render: { drawn: number[]; errors: number }; errors: string[] };
  if (!(st.sim.vehicles > 0)) { errors.push('aucun véhicule simulé'); }
  if (Object.values(shots).every((s) => (s as { render: { drawn: number[] } }).render.drawn.every((d) => d === 0))) errors.push('aucun véhicule dessiné');
  if (st.errors.length) errors.push(...st.errors);
  writeFileSync(join(out, 'demo_rapport.json'), JSON.stringify({ date: new Date().toISOString(), views, shots, errors }, null, 1));
} catch (e) {
  errors.push(e instanceof Error ? e.message : String(e));
} finally {
  await browser.close();
  server.close();
}
if (errors.length) { console.error(errors.join('\n')); code = 1; }
process.exit(code);
