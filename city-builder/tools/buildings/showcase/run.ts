/**
 * Pilote de la vitrine des bâtiments (Chromium + SwiftShader via Playwright) :
 *   npx tsx tools/buildings/showcase/run.ts [--ids=a,b] [--views=front,back,aerial] [--lods] [--variants] [--night] [--street]
 * Rend chaque bâtiment avec le VRAI rendu instancié du jeu, contrôle le chargement (maillages instanciés,
 * triangles, aucune erreur de texture) et assemble des planches PNG dans tests/buildings/out/.
 * Les planches doivent être REGARDÉES (deviceScaleFactor 1).
 */
import { createServer, type Server } from 'node:http';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';
import * as esbuild from 'esbuild';
import sharp from 'sharp';

const root = join(import.meta.dirname, '..', '..', '..');
const work = join(root, '.cache', 'buildings-showcase');
const outDir = join(root, 'tests', 'buildings', 'out');
const arg = (k: string): string | undefined => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
const flag = (k: string): boolean => process.argv.includes(`--${k}`);

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

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
async function label(png: Buffer, w: number, h: number, lines: string[], bad: boolean): Promise<Buffer> {
  const lh = 17 * lines.length + 6;
  const svg = `<svg width="${w}" height="${lh}"><rect width="${w}" height="${lh}" fill="${bad ? '#8b1d1d' : 'rgba(10,12,16,0.72)'}"/>${lines
    .map((l, i) => `<text x="7" y="${16 + i * 17}" font-family="DejaVu Sans, sans-serif" font-size="${i === 0 ? 14 : 12}" fill="#fff">${esc(l)}</text>`).join('')}</svg>`;
  return sharp(png).resize(w, h).composite([{ input: Buffer.from(svg), top: h - lh, left: 0 }]).png().toBuffer();
}
async function sheet(tiles: Buffer[], cols: number, tw: number, th: number, file: string): Promise<void> {
  const rows = Math.ceil(tiles.length / cols);
  await sharp({ create: { width: cols * tw, height: rows * th, channels: 3, background: '#111418' } })
    .composite(tiles.map((t, i) => ({ input: t, left: (i % cols) * tw, top: Math.floor(i / cols) * th })))
    .png().toFile(file);
  console.log(`planche : ${file}`);
}

async function main(): Promise<void> {
  mkdirSync(work, { recursive: true });
  mkdirSync(outDir, { recursive: true });
  await esbuild.build({ entryPoints: [join(import.meta.dirname, 'page.ts')], bundle: true, format: 'esm', outfile: join(work, 'page.js'), logLevel: 'error', target: 'es2022' });
  writeFileSync(join(work, 'index.html'), '<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>body{margin:0;background:#000}</style></head><body><script type="module" src="page.js"></script></body></html>');
  const frags = arg('frags') ?? 'catalog.buildings.residential.json';
  const frag = JSON.parse(readFileSync(join(root, 'assets', frags.split(',')[0]!), 'utf8')) as { assets: { id: string; nameFr: string; category: string; variants: { nameFr: string }[]; lods: { triangles?: number }[] }[] };
  const ids = arg('ids')?.split(',') ?? frag.assets.map((a) => a.id);
  const views = (arg('views') ?? 'front').split(',');
  const { server, base } = await serve();
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
  const failures: string[] = [];
  const shot = async (params: string, w: number, h: number, name: string): Promise<{ png: Buffer; info: Record<string, unknown> }> => {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const errs: string[] = [];
    page.on('pageerror', (e: Error) => errs.push(e.message));
    page.on('console', (m: { type(): string; text(): string }) => { if (m.type() === 'error') errs.push(m.text()); });
    page.on('response', (r: { status(): number; url(): string }) => { if (r.status() >= 400) errs.push(`HTTP ${r.status()} ${r.url()}`); });
    await page.goto(`${base}/.cache/buildings-showcase/index.html?${params}&w=${w}&h=${h}&frags=${frags}`);
    await page.waitForFunction('window.__show && (window.__show.ready || window.__show.error)', null, { timeout: 240000 });
    const st = await page.evaluate('window.__show') as { ready: boolean; error: string | null; info: Record<string, unknown> };
    const png = await page.screenshot({ type: 'png' }) as Buffer;
    await page.close();
    const infoErrs = (st.info['errors'] as string[] | undefined) ?? [];
    const allErrs = [...errs, ...infoErrs, ...(st.error ? [st.error] : [])];
    if (allErrs.length || (!st.info['gate'] && !((st.info['meshes'] as number) > 0))) failures.push(`${name} : ${allErrs.join(' | ') || 'aucun maillage instancié visible'}`);
    writeFileSync(join(outDir, `${name}.png`), png);
    return { png, info: st.info };
  };
  const TW = 420, TH = 300;
  if (flag('gate')) {
    const { info } = await shot(`mode=gate&ids=${ids.join(',')}`, 400, 300, 'porte_qa');
    const reps = (info['gate'] as { id: string; ok: boolean; errors: string[]; triangles: number; texturesDecoded: number; normalMaps: number; texturedTriangleRatio: number; pixelCoverage: number; uniqueVertices: number }[]) ?? [];
    const sheetUrl = info['sheet'] as string | undefined;
    if (sheetUrl) writeFileSync(join(outDir, 'porte_qa_planche.png'), Buffer.from(sheetUrl.split(',')[1]!, 'base64'));
    for (const r of reps) {
      console.log(`${r.ok ? 'OK   ' : 'ÉCHEC'} porte QA ${r.id.padEnd(30)} ${r.triangles} tri, ${r.uniqueVertices} sommets distincts, ${r.texturesDecoded} textures décodées, ${r.normalMaps} normal maps, ${(r.texturedTriangleRatio * 100).toFixed(0)} % texturé, couverture ${(r.pixelCoverage * 100).toFixed(1)} % ${r.errors.join(' ; ')}`);
      if (!r.ok) failures.push(`porte QA ${r.id} : ${r.errors.join(' ; ')}`);
    }
    if (reps.length !== ids.length) failures.push(`porte QA : ${reps.length} rapports pour ${ids.length} bâtiments`);
  }
  if (flag('street')) {
    for (const v of ['aerial', 'street', 'low']) {
      for (const n of flag('night') ? [0, 1] : [0]) {
        const { info } = await shot(`mode=street&view=${v}&night=${n}&vmax=${arg('vmax') ?? '2'}`, 1280, 720, `rue_${v}${n ? '_nuit' : ''}`);
        console.log(`rue ${v}${n ? ' nuit' : ''} : ${JSON.stringify(info)}`);
      }
    }
  }
  if (!flag('nosingle')) {
    const tiles: Buffer[] = [];
    for (const id of ids) {
      const a = frag.assets.find((x) => x.id === id);
      if (!a) { failures.push(`${id} : absent du fragment`); continue; }
      const variants = flag('variants') ? a.variants.map((_, i) => i) : [0];
      const lods = flag('lods') ? [0, 1, 2] : [0];
      for (const v of variants) for (const l of lods) for (const vw of views) for (const n of flag('night') ? [0, 1] : [0]) {
        const name = `${id}_v${v}_lod${l}_${vw}${n ? '_nuit' : ''}`;
        const { png, info } = await shot(`mode=single&id=${id}&variant=${v}&lod=${l}&view=${vw}&night=${n}`, 840, 600, name);
        const bad = failures.some((f) => f.startsWith(name));
        tiles.push(await label(png, TW, TH, [`${a.nameFr}`, `${a.category} · var. ${a.variants[v]?.nameFr ?? v} · LOD${l} · ${vw}${n ? ' · nuit' : ''} · ${a.lods[l]?.triangles ?? '?'} tri`], bad));
        console.log(`${bad ? 'ÉCHEC' : 'OK   '} ${name} ${JSON.stringify(info)}`);
      }
    }
    const tag = arg('tag') ?? 'residentiel';
    await sheet(tiles, Number(arg('cols') ?? '3'), TW, TH, join(outDir, `planche_${tag}.png`));
  }
  await browser.close();
  server.close();
  if (failures.length) {
    console.error(`ÉCHECS (${failures.length}) :\n - ${failures.join('\n - ')}`);
    process.exit(1);
  }
  console.log('Vitrine OK');
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
