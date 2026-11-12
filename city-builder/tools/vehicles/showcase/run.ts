/**
 * Vitrine des véhicules (Chromium + SwiftShader, deviceScaleFactor 1) :
 *   npx tsx tools/vehicles/showcase/run.ts [--view=34av|34ar|profil|dessus|rue] [--lod=0|1|2] [--night] [--variant=k] [--ids=a,b] [--cols=n] [--tag=nom]
 * Rend chaque véhicule avec le rendu instancié du jeu, vérifie que chaque modèle est chargé, visible
 * (maillages instanciés, textures décodées) puis écrit une planche étiquetée dans tests/vehicles/out/.
 * Les planches doivent être REGARDÉES.
 */
import { createServer, type Server } from 'node:http';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';
import * as esbuild from 'esbuild';
import sharp from 'sharp';

const root = join(import.meta.dirname, '..', '..', '..');
const work = join(root, '.cache', 'vehicles-showcase');
const outDir = join(root, 'tests', 'vehicles', 'out');
const arg = (k: string): string | undefined => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
const flag = (k: string): boolean => process.argv.includes(`--${k}`);
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary', '.webp': 'image/webp', '.png': 'image/png', '.hdr': 'application/octet-stream' };

export function serveRoot(dir: string, extra: Record<string, string> = {}): Promise<{ server: Server; base: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://x');
      const mapped = extra[url.pathname];
      const p = mapped ?? normalize(join(dir, decodeURIComponent(url.pathname)));
      if ((!mapped && !p.startsWith(dir)) || !existsSync(p) || statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': TYPES[extname(p)] ?? 'application/octet-stream' });
      createReadStream(p).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => {
      const a = server.address();
      resolve({ server, base: `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}` });
    });
  });
}

export function loadPlaywright(): { chromium: { launch(o: unknown): Promise<any> } } {
  const req = createRequire(import.meta.url);
  for (const p of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { return req(p); } catch { /* suivant */ } }
  throw new Error('Playwright introuvable');
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function main(): Promise<void> {
  mkdirSync(work, { recursive: true });
  mkdirSync(outDir, { recursive: true });
  await esbuild.build({ entryPoints: [join(import.meta.dirname, 'page.ts')], bundle: true, format: 'esm', outfile: join(work, 'page.js'), logLevel: 'warning', target: 'es2022' });
  writeFileSync(join(work, 'page.html'), '<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Vitrine véhicules</title><style>html,body{margin:0;background:#111}canvas{display:block}</style></head><body><canvas id="c"></canvas><script type="module" src="/page.js"></script></body></html>');
  const frag = JSON.parse(readFileSync(join(root, 'assets', 'catalog.vehicles.json'), 'utf8')) as { assets: { id: string; nameFr: string; lods: { triangles?: number }[]; dimensions: { width: number; height: number; depth: number } }[] };
  const ids = arg('ids')?.split(',');
  const assets = frag.assets.filter((a) => !ids || ids.includes(a.id));
  const cols = Number(arg('cols') ?? Math.min(5, assets.length));
  const cw = Number(arg('cw') ?? 384), ch = Number(arg('ch') ?? 288);
  const rows = Math.ceil(assets.length / cols);
  const view = arg('view') ?? '34av', lod = arg('lod') ?? '0';
  const params = new URLSearchParams({ view, lod, cols: String(cols), cw: String(cw), ch: String(ch), ...(flag('night') ? { night: '1' } : {}), ...(arg('variant') ? { variant: arg('variant')! } : {}), ...(ids ? { ids: ids.join(',') } : {}) });
  const { server, base } = await serveRoot(root, { '/page.html': join(work, 'page.html'), '/page.js': join(work, 'page.js') });
  const browser = await loadPlaywright().chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
  const errors: string[] = [];
  let code = 0;
  try {
    const page = await browser.newPage({ viewport: { width: cols * cw, height: rows * ch }, deviceScaleFactor: 1 });
    page.on('pageerror', (e: Error) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m: any) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    page.on('response', (r: any) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });
    await page.goto(`${base}/page.html?${params}`);
    await page.waitForFunction('window.__vs && (window.__vs.ready || window.__vs.error)', null, { timeout: 600000 });
    const st = await page.evaluate('({ error: window.__vs.error, report: window.__vs.report })') as { error: string | null; report: { ok: boolean; errors: string[] } | null };
    if (st.error) throw new Error(st.error);
    const shot: Buffer = await page.screenshot({ clip: { x: 0, y: 0, width: cols * cw, height: rows * ch } });
    const comps: sharp.OverlayOptions[] = assets.map((a, k) => {
      const t = a.lods.map((l) => l.triangles ?? 0).join('/');
      const svg = `<svg width="${cw}" height="38"><rect width="${cw}" height="38" fill="rgba(10,12,16,0.72)"/><text x="7" y="16" font-family="DejaVu Sans, sans-serif" font-size="14" fill="#fff">${esc(a.nameFr)}</text><text x="7" y="32" font-family="DejaVu Sans, sans-serif" font-size="11" fill="#cfd6df">${esc(`${a.id} · ${a.dimensions.depth.toFixed(2)} m · tri ${t}`)}</text></svg>`;
      return { input: Buffer.from(svg), left: (k % cols) * cw, top: Math.floor(k / cols) * ch + ch - 38 };
    });
    const tag = arg('tag') ?? `planche_${view}_lod${lod}${flag('night') ? '_nuit' : ''}${arg('variant') ? `_v${arg('variant')}` : ''}`;
    const file = join(outDir, `${tag}.png`);
    await sharp(shot).composite(comps).png().toFile(file);
    writeFileSync(join(outDir, `${tag}.json`), JSON.stringify({ date: new Date().toISOString(), params: Object.fromEntries(params), ...st.report, pageErrors: errors }, null, 1));
    console.log(`planche : ${file}`);
    if (!st.report?.ok) { console.error(st.report?.errors.join('\n')); code = 1; }
  } finally {
    await browser.close();
    server.close();
  }
  if (errors.length) { console.error(errors.join('\n')); code = 1; }
  process.exit(code);
}

if (import.meta.url === `file://${process.argv[1]}`) void main();
