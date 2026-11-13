/**
 * Vitrine des assets transport (Chromium + SwiftShader) :
 *   npx tsx tools/transport/showcase/run.ts [--lod=0|1|2] [--ids=a,b] [--cols=n] [--view=34|haut|profil|arriere] [--pose] [--variant=k] [--tag=nom]
 * Rend chaque modèle, contrôle chargement et textures, écrit une planche étiquetée dans tests/transport-assets/out/.
 * Les planches doivent être REGARDÉES.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as esbuild from 'esbuild';
import sharp from 'sharp';
import { loadPlaywright, serveRoot } from '../../vehicles/showcase/run';

const root = join(import.meta.dirname, '..', '..', '..');
const work = join(root, '.cache', 'transport-showcase');
const outDir = join(root, 'tests', 'transport-assets', 'out');
const arg = (k: string): string | undefined => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
const flag = (k: string): boolean => process.argv.includes(`--${k}`);
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function main(): Promise<void> {
  mkdirSync(work, { recursive: true }); mkdirSync(outDir, { recursive: true });
  await esbuild.build({ entryPoints: [join(import.meta.dirname, 'page.ts')], bundle: true, format: 'esm', outfile: join(work, 'page.js'), logLevel: 'warning', target: 'es2022' });
  writeFileSync(join(work, 'page.html'), '<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Vitrine transport</title><style>html,body{margin:0;background:#111}canvas{display:block}</style></head><body><canvas id="c"></canvas><script type="module" src="/page.js"></script></body></html>');
  const frag = JSON.parse(readFileSync(join(root, 'assets', 'catalog.transport.json'), 'utf8')) as { assets: { id: string; nameFr: string; lods: { triangles?: number }[]; dimensions: { width: number; height: number; depth: number } }[] };
  const ids = arg('ids')?.split(',');
  const assets = frag.assets.filter((a) => !ids || ids.includes(a.id));
  const cols = Number(arg('cols') ?? Math.min(5, assets.length));
  const cw = Number(arg('cw') ?? 480), ch = Number(arg('ch') ?? 360);
  const rows = Math.ceil(assets.length / cols);
  const lod = arg('lod') ?? '0', view = arg('view') ?? '34';
  const params = new URLSearchParams({ lod, view, cols: String(cols), cw: String(cw), ch: String(ch), ...(ids ? { ids: ids.join(',') } : {}), ...(flag('pose') ? { pose: '1' } : {}), ...(arg('variant') ? { variant: arg('variant')! } : {}) });
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
    await page.waitForFunction('window.__ts && (window.__ts.ready || window.__ts.error)', null, { timeout: 900000 });
    const st = await page.evaluate('({ error: window.__ts.error, report: window.__ts.report })') as { error: string | null; report: { ok: boolean; errors: string[] } | null };
    if (st.error) throw new Error(st.error);
    const shot: Buffer = await page.screenshot({ clip: { x: 0, y: 0, width: cols * cw, height: rows * ch } });
    const comps = assets.map((a, k) => {
      const t = a.lods.map((l) => l.triangles ?? 0).join('/');
      const d = a.dimensions;
      const svg = `<svg width="${cw}" height="38"><rect width="${cw}" height="38" fill="rgba(10,12,16,0.72)"/><text x="7" y="16" font-family="DejaVu Sans, sans-serif" font-size="14" fill="#fff">${esc(a.nameFr)}</text><text x="7" y="32" font-family="DejaVu Sans, sans-serif" font-size="11" fill="#cfd6df">${esc(`${a.id} · ${d.width.toFixed(1)}×${d.height.toFixed(1)}×${d.depth.toFixed(1)} m · tri ${t}`)}</text></svg>`;
      return { input: Buffer.from(svg), left: (k % cols) * cw, top: Math.floor(k / cols) * ch + ch - 38 };
    });
    const tag = arg('tag') ?? `planche_lod${lod}_${view}${flag('pose') ? '_pose' : ''}`;
    const file = join(outDir, `${tag}.png`);
    await sharp(shot).composite(comps).png().toFile(file);
    writeFileSync(join(outDir, `${tag}.json`), JSON.stringify({ date: new Date().toISOString(), params: Object.fromEntries(params), ...st.report, pageErrors: errors }, null, 1));
    console.log(`planche : ${file}`);
    if (!st.report?.ok) { console.error(st.report?.errors.join('\n')); code = 1; }
  } finally { await browser.close(); server.close(); }
  if (errors.length) { console.error(errors.join('\n')); code = 1; }
  process.exit(code);
}
void main();
