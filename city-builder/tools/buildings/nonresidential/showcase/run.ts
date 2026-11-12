/**
 * Captures rapprochées des bâtiments non résidentiels (Chromium + SwiftShader, deviceScaleFactor 1) :
 *   npx tsx tools/buildings/nonresidential/showcase/run.ts --shots=<fichier JSON | nom prédéfini>
 * Chaque prise : { name, ids, cam:[x,y,z], look:[x,y,z], lod?, variant?, variants?, night?, fov?, w?, h? }.
 * Écrit les PNG dans tests/buildings-other/out/ ; échoue si une prise n'a aucun maillage ou signale une erreur.
 */
import { createServer, type Server } from 'node:http';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';
import * as esbuild from 'esbuild';
import sharp from 'sharp';

const root = join(import.meta.dirname, '..', '..', '..', '..');
const work = join(root, '.cache', 'buildings-other-showcase');
const outDir = join(root, 'tests', 'buildings-other', 'out');
const arg = (k: string): string | undefined => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=');

export interface Shot { name: string; ids: string[]; cam?: number[]; look?: number[]; lod?: number; variant?: number; variants?: 'all'; night?: number; fov?: number; w?: number; h?: number; gap?: number }

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary', '.webp': 'image/webp', '.png': 'image/png', '.hdr': 'application/octet-stream' };

function serve(): Promise<{ server: Server; base: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://x');
      const p = normalize(join(root, decodeURIComponent(url.pathname)));
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

function loadPlaywright(): { chromium: { launch(o: unknown): Promise<any> } } {
  const req = createRequire(import.meta.url);
  for (const p of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { return req(p); } catch { /* suivant */ } }
  throw new Error('Playwright introuvable');
}

async function main(): Promise<void> {
  mkdirSync(work, { recursive: true });
  mkdirSync(outDir, { recursive: true });
  await esbuild.build({ entryPoints: [join(import.meta.dirname, 'page.ts')], bundle: true, format: 'esm', outfile: join(work, 'page.js'), logLevel: 'error', target: 'es2022' });
  writeFileSync(join(work, 'index.html'), '<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>body{margin:0;background:#000}</style></head><body><script type="module" src="page.js"></script></body></html>');
  const spec = arg('shots') ?? join(import.meta.dirname, 'shots.json');
  const shots = JSON.parse(readFileSync(spec, 'utf8')) as Shot[];
  const only = arg('only')?.split(',');
  const { server, base } = await serve();
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
  const failures: string[] = [];
  const tiles: Buffer[] = [];
  for (const s of shots) {
    if (only && !only.some((o) => s.name.startsWith(o))) continue;
    const w = s.w ?? 900, h = s.h ?? 600;
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const errs: string[] = [];
    page.on('pageerror', (e: Error) => errs.push(e.message));
    page.on('console', (m: { type(): string; text(): string }) => { if (m.type() === 'error') errs.push(m.text()); });
    page.on('response', (r: { status(): number; url(): string }) => { if (r.status() >= 400) errs.push(`HTTP ${r.status()} ${r.url()}`); });
    const p = new URLSearchParams({ ids: s.ids.join(','), lod: String(s.lod ?? 0), variant: String(s.variant ?? 0), night: String(s.night ?? 0), fov: String(s.fov ?? 40), w: String(w), h: String(h), gap: String(s.gap ?? 6) });
    if (s.cam) p.set('cam', s.cam.join(','));
    if (s.look) p.set('look', s.look.join(','));
    if (s.variants) p.set('variants', s.variants);
    await page.goto(`${base}/.cache/buildings-other-showcase/index.html?${p.toString()}`);
    await page.waitForFunction('window.__show && (window.__show.ready || window.__show.error)', null, { timeout: 300000 });
    const st = await page.evaluate('window.__show') as { ready: boolean; error: string | null; info: Record<string, unknown> };
    const png = await page.screenshot({ type: 'png' }) as Buffer;
    await page.close();
    const all = [...errs, ...((st.info['errors'] as string[] | undefined) ?? []), ...(st.error ? [st.error] : [])];
    if (all.length || !((st.info['meshes'] as number) > 0)) failures.push(`${s.name} : ${all.join(' | ') || 'aucun maillage'}`);
    writeFileSync(join(outDir, `${s.name}.png`), png);
    tiles.push(await sharp(png).resize(450, 300).png().toBuffer());
    console.log(`${all.length ? 'ÉCHEC' : 'OK   '} ${s.name} ${JSON.stringify(st.info)}`);
  }
  if (tiles.length > 1 && arg('sheet')) {
    const cols = 3, rows = Math.ceil(tiles.length / cols);
    await sharp({ create: { width: cols * 450, height: rows * 300, channels: 3, background: '#111418' } })
      .composite(tiles.map((t, i) => ({ input: t, left: (i % cols) * 450, top: Math.floor(i / cols) * 300 }))).png().toFile(join(outDir, `${arg('sheet')}.png`));
  }
  await browser.close();
  server.close();
  if (failures.length) { console.error(`ÉCHECS :\n - ${failures.join('\n - ')}`); process.exit(1); }
  console.log('Vitrine rapprochée OK');
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
