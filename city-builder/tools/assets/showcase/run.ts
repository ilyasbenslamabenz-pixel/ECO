/**
 * Vitrine des assets : `npx tsx tools/assets/showcase/run.ts [--lods]`
 *  1. bundle tools/assets/showcase/showcase.ts (esbuild) dans .cache/showcase/ ;
 *  2. sert le projet en local et ouvre la page dans Chromium (Playwright, rendu logiciel SwiftShader) ;
 *  3. rend chaque modèle du catalogue (LOD0 ; avec --lods aussi LOD1/LOD2) et chaque jeu de textures,
 *     vérifie qu'il est chargé (maillages, triangles, textures décodées) ET visible (pixels différents
 *     d'une image de référence sans objet) ;
 *  4. assemble des planches-contacts PNG : .cache/showcase/out/{modeles,lods,materiaux}.png + rapport.json.
 * Code de sortie 1 si un asset est absent, invisible ou sans texture. Les planches doivent être REGARDÉES.
 */
import { createServer, type Server } from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';
import * as esbuild from 'esbuild';
import sharp from 'sharp';

const root = join(import.meta.dirname, '..', '..', '..');
const outDir = join(root, '.cache', 'showcase');
const shotsDir = join(outDir, 'out');
const withLods = process.argv.includes('--lods');
const TILE = 256;

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.hdr': 'application/octet-stream' };

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
      const addr = server.address();
      resolve({ server, base: `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}` });
    });
  });
}

function loadPlaywright(): { chromium: { launch(o: unknown): Promise<any> } } {
  const req = createRequire(import.meta.url);
  for (const p of ['playwright', '/opt/node-tools/node_modules/playwright']) {
    try { return req(p); } catch { /* suivant */ }
  }
  throw new Error('Playwright introuvable');
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function labelled(png: Buffer, lines: string[], bad: boolean): Promise<Buffer> {
  const h = 16 * lines.length + 6;
  const svg = `<svg width="${TILE}" height="${h}"><rect width="${TILE}" height="${h}" fill="${bad ? '#8b1d1d' : 'rgba(10,12,16,0.78)'}"/>${lines
    .map((l, i) => `<text x="6" y="${15 + i * 16}" font-family="DejaVu Sans, sans-serif" font-size="${i === 0 ? 13 : 11}" fill="#fff">${esc(l)}</text>`).join('')}</svg>`;
  return sharp(png).resize(TILE, TILE).composite([{ input: Buffer.from(svg), top: TILE - h, left: 0 }]).png().toBuffer();
}

async function sheet(tiles: Buffer[], cols: number, file: string, title: string): Promise<void> {
  const rows = Math.ceil(tiles.length / cols);
  const head = 34;
  const svg = `<svg width="${cols * TILE}" height="${head}"><rect width="100%" height="100%" fill="#0f1216"/><text x="10" y="23" font-family="DejaVu Sans, sans-serif" font-size="17" fill="#e8e2d4">${esc(title)}</text></svg>`;
  await sharp({ create: { width: cols * TILE, height: rows * TILE + head, channels: 3, background: '#0f1216' } })
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }, ...tiles.map((t, i) => ({ input: t, left: (i % cols) * TILE, top: head + Math.floor(i / cols) * TILE }))])
    .png().toFile(file);
}

/** Fraction de pixels qui diffèrent nettement de l'image de référence (objet visible ?). */
async function coverage(png: Buffer, ref: Buffer): Promise<number> {
  const a = await sharp(png).raw().toBuffer();
  const b = await sharp(ref).raw().toBuffer();
  let diff = 0;
  const n = Math.min(a.length, b.length) / 4;
  for (let i = 0; i < n; i++) {
    const d = Math.abs(a[i * 4]! - b[i * 4]!) + Math.abs(a[i * 4 + 1]! - b[i * 4 + 1]!) + Math.abs(a[i * 4 + 2]! - b[i * 4 + 2]!);
    if (d > 30) diff++;
  }
  return diff / n;
}

async function main(): Promise<void> {
  mkdirSync(shotsDir, { recursive: true });
  await esbuild.build({ entryPoints: [join(root, 'tools/assets/showcase/showcase.ts')], bundle: true, format: 'esm', outfile: join(outDir, 'showcase.js'), target: 'es2022', logLevel: 'warning' });
  writeFileSync(join(outDir, 'index.html'), '<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Vitrine des assets</title><style>body{margin:0;background:#0f1216}</style></head><body><canvas id="c" width="512" height="512"></canvas><script type="module" src="./showcase.js"></script></body></html>');
  const { server, base } = await serve();
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
  const errors: string[] = [];
  page.on('pageerror', (e: Error) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m: { type(): string; text(): string }) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('response', (r: { status(): number; url(): string }) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });
  page.setDefaultTimeout(180_000);
  await page.goto(`${base}/.cache/showcase/index.html`);
  await page.waitForFunction(() => (window as any).__showcase !== undefined);
  await page.evaluate(() => (window as any).__showcase.ready);
  const inf = await page.evaluate(() => (window as any).__showcase.info());
  const canvas = page.locator('#c');
  const only = process.argv.find((x) => x.startsWith('--only='))?.slice(7).split(',');
  mkdirSync(join(shotsDir, 'individuels'), { recursive: true });
  const report: Record<string, unknown>[] = [];
  const failures: string[] = [];
  const modelTiles: Buffer[] = [];
  const lodTiles: Buffer[] = [];
  for (const a of inf.assets as { id: string; nameFr: string; category: string; lods: number }[]) {
    if (only && !only.includes(a.id)) continue;
    const lods = withLods ? [...Array(a.lods).keys()] : [0];
    for (const lod of lods) {
      const r = await page.evaluate(([id, l]: [string, number]) => (window as any).__showcase.showAsset(id, l), [a.id, lod]);
      const png: Buffer = await canvas.screenshot();
      writeFileSync(join(shotsDir, 'individuels', `${a.id}_lod${lod}.png`), png);
      // Référence au même cadrage, objet masqué : la différence mesure la visibilité réelle.
      await page.evaluate(() => (window as any).__showcase.setVisible(false));
      const ref: Buffer = await canvas.screenshot();
      const cov = await coverage(png, ref);
      const problems: string[] = [];
      if (!r.ok) problems.push(r.error ?? 'échec');
      if (r.meshes === 0 || r.triangles === 0) problems.push('aucun maillage');
      if (r.textures === 0) problems.push('aucune texture');
      if (r.texturesDecoded < r.textures) problems.push(`${r.textures - r.texturesDecoded} texture(s) non décodée(s)`);
      if (cov < 0.02) problems.push(`invisible (${(cov * 100).toFixed(1)} % de pixels)`);
      if (problems.length) failures.push(`${a.id} LOD${lod} : ${problems.join(', ')}`);
      report.push({ id: a.id, lod, ...r, coverage: +cov.toFixed(3), problems });
      const tile = await labelled(png, [`${a.nameFr}`, `${a.id} · LOD${lod} · ${r.triangles} tri · ${r.texturesDecoded}/${r.textures} tex`, `${r.size.map((x: number) => x.toFixed(2)).join(' × ')} m · ${(cov * 100).toFixed(0)} % px`], problems.length > 0);
      (lod === 0 ? modelTiles : lodTiles).push(tile);
      if (lod === 0 && withLods) lodTiles.push(tile);
    }
  }
  const matTiles: Buffer[] = [];
  for (const t of inf.textureSets as { id: string; nameFr: string }[]) {
    if (only && !only.includes(t.id)) continue;
    const r = await page.evaluate((id: string) => (window as any).__showcase.showMaterial(id), t.id);
    const png: Buffer = await canvas.screenshot();
    writeFileSync(join(shotsDir, 'individuels', `materiau_${t.id}.png`), png);
    if (!r.ok) failures.push(`${t.id} : ${r.error}`);
    report.push({ textureSet: t.id, ...r });
    matTiles.push(await labelled(png, [t.nameFr, `${t.id} · sphère UV · mur « box » · dalle XZ`], !r.ok));
  }
  const after = await page.evaluate(() => (window as any).__showcase.info());
  await browser.close();
  server.close();
  if (modelTiles.length) await sheet(modelTiles, 6, join(shotsDir, 'modeles.png'), `Aube Urbaine — modèles du catalogue (LOD0) : ${modelTiles.length}`);
  if (withLods && lodTiles.length) await sheet(lodTiles, 3, join(shotsDir, 'lods.png'), 'LOD0 / LOD1 / LOD2 par modèle');
  if (matTiles.length) await sheet(matTiles, 6, join(shotsDir, 'materiaux.png'), `Matériaux PBR partagés : ${matTiles.length} jeux de textures`);
  writeFileSync(join(shotsDir, 'rapport.json'), JSON.stringify({ date: new Date().toISOString(), materials: after.materials, textures: after.textures, errors, failures, items: report }, null, 1));
  console.log(`Vitrine : ${modelTiles.length} modèles, ${matTiles.length} matériaux (${after.materials} matériaux partagés, ${after.textures} textures chargées une fois).`);
  console.log(`Planches : ${shotsDir}`);
  const all = [...failures, ...errors];
  if (all.length) {
    console.error(`ÉCHEC (${all.length}) :\n - ${all.join('\n - ')}`);
    process.exit(1);
  }
  console.log('Vitrine OK');
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
