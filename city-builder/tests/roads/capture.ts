/**
 * Captures de la démo du module routier (Chromium + SwiftShader, deviceScaleFactor 1) :
 *   npx tsx tests/roads/capture.ts [vue1,vue2…]
 * 1. bundle src/render/roads/demo/roads-demo.ts dans .cache/roads-demo/ ;
 * 2. sert le projet, ouvre la page, attend le chargement complet (textures + GLB) ;
 * 3. enregistre une capture par vue dans tests/roads/out/<vue>.png et un rapport JSON.
 * Échoue si la page signale une erreur, un tracé refusé, une texture en échec ou une erreur console.
 * Les captures doivent être REGARDÉES.
 */
import { createServer, type Server } from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';
import * as esbuild from 'esbuild';

const root = join(import.meta.dirname, '..', '..');
const cache = join(root, '.cache', 'roads-demo');
const out = join(root, 'tests', 'roads', 'out');
const ALL = ['aerien', 'carrefour', 'carrefour_dessus', 'rue', 'pietonne', 'courbe', 'pont', 'autoroute', 'nuit'];
const views = process.argv[2] ? process.argv[2].split(',') : ALL;
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary', '.webp': 'image/webp', '.png': 'image/png', '.hdr': 'application/octet-stream' };

function serve(): Promise<{ server: Server; base: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://x');
      let p = normalize(join(root, decodeURIComponent(url.pathname)));
      if (url.pathname === '/' || url.pathname === '/demo.html') p = join(cache, 'demo.html');
      if (url.pathname === '/demo.js') p = join(cache, 'demo.js');
      if (url.pathname.startsWith('/assets/')) p = normalize(join(root, decodeURIComponent(url.pathname)));
      if (!p.startsWith(root) || !existsSync(p) || statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': TYPES[extname(p)] ?? 'application/octet-stream' });
      createReadStream(p).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => {
      const a = server.address();
      resolve({ server, base: `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}` });
    });
  });
}

function playwright(): { chromium: { launch(o: unknown): Promise<any> } } {
  const req = createRequire(import.meta.url);
  for (const p of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { return req(p); } catch { /* suivant */ } }
  throw new Error('Playwright introuvable');
}

mkdirSync(cache, { recursive: true });
mkdirSync(out, { recursive: true });
await esbuild.build({ entryPoints: [join(root, 'src/render/roads/demo/roads-demo.ts')], bundle: true, format: 'esm', outfile: join(cache, 'demo.js'), logLevel: 'warning', target: 'es2022' });
writeFileSync(join(cache, 'demo.html'), '<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Démo routes</title><style>html,body{margin:0;height:100%;background:#000}canvas{width:100vw;height:100vh;display:block}</style></head><body><canvas id="c"></canvas><script type="module" src="./demo.js"></script></body></html>');

const { server, base } = await serve();
const browser = await playwright().chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const errors: string[] = [];
let code = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e: Error) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m: any) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('response', (r: any) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });
  await page.goto(`${base}/demo.html?cam=${views[0]}`);
  await page.waitForFunction('window.__roadsDemo && (window.__roadsDemo.ready || window.__roadsDemo.error)', null, { timeout: 300000 });
  const st = await page.evaluate('({ error: window.__roadsDemo.error, failures: window.__roadsDemo.failures, stats: window.__roadsDemo.stats })');
  console.log(JSON.stringify(st, null, 1));
  if (st.error) throw new Error(st.error);
  if (st.failures.length) { console.error('Tracés refusés :', st.failures); code = 1; }
  if (st.stats.textureErrors > 0) { console.error('Textures en échec'); code = 1; }
  for (const v of views) {
    await page.evaluate(`window.__roadsDemo.view(${JSON.stringify(v)})`);
    await page.screenshot({ path: join(out, `${v}.png`) });
    console.log(`capture : tests/roads/out/${v}.png`);
  }
  writeFileSync(join(out, 'rapport.json'), JSON.stringify({ date: new Date().toISOString(), ...st, errors }, null, 1));
} finally {
  await browser.close();
  server.close();
}
if (errors.length) { console.error(errors.join('\n')); code = 1; }
process.exit(code);
