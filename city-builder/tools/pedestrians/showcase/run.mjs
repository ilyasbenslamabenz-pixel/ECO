#!/usr/bin/env node
// Planches-contact des piétons : rendu three dans Chromium headless (SwiftShader) via Playwright.
// Usage : node tools/pedestrians/showcase/run.mjs [--dir assets/models/pedestrians] [--only id,…]
// Sorties : tools/pedestrians/showcase/out/*.png (non versionnées).
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ici = dirname(fileURLToPath(import.meta.url));
const racine = resolve(ici, '..', '..', '..');
const require = createRequire(join(racine, 'package.json'));
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const dirModeles = resolve(arg('dir', join(racine, 'assets', 'models', 'pedestrians')));
const only = (arg('only', '') || '').split(',').filter(Boolean);
const out = join(ici, 'out');
mkdirSync(out, { recursive: true });

// 1. bundle de la page
const esbuild = require('esbuild');
await esbuild.build({ entryPoints: [join(ici, 'page.js')], bundle: true, format: 'esm', outfile: join(out, 'page.bundle.js'), absWorkingDir: racine, logLevel: 'error' });
writeFileSync(join(out, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#222}#w{position:relative;display:inline-block}canvas{display:block}
#etiquettes{position:absolute;left:0;top:0;pointer-events:none}
.et{position:absolute;font:600 12px/1.2 system-ui,sans-serif;color:#10202e;background:rgba(255,255,255,.72);padding:1px 5px;border-radius:3px;white-space:pre}
</style></head><body><div id="w"><canvas id="c"></canvas><div id="etiquettes"></div></div><script type="module" src="./page.bundle.js"></script></body></html>`);

// 2. serveur statique : /  -> out/, /modeles/ -> dossier des GLB
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary' };
const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  let p = decodeURIComponent(url.pathname);
  let base = out;
  if (p.startsWith('/modeles/')) { base = dirModeles; p = p.slice('/modeles'.length); }
  const f = normalize(join(base, p === '/' ? '/index.html' : p));
  if (!f.startsWith(base) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(f)] ?? 'application/octet-stream' });
  createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

function playwright() {
  for (const t of [() => require('playwright'), () => createRequire('/opt/node-tools/')('playwright'), () => require('/opt/node-tools/node_modules/playwright')]) {
    try { return t(); } catch { /* suivant */ }
  }
  throw new Error('Playwright introuvable');
}
const { chromium } = playwright();
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 2000, height: 1200 } });
const erreurs = [];
page.on('pageerror', (e) => erreurs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') erreurs.push('console: ' + m.text()); });
await page.goto(baseUrl + '/');
await page.waitForFunction('window.pret === true');

const manifest = JSON.parse(readFileSync(join(dirModeles, 'manifest.json'), 'utf8'));
const pal = new Map(manifest.palettes.map((p) => [p.id, p.colors]));
const modeles = manifest.models.filter((m) => only.length === 0 || only.includes(m.id));

async function planche(nom, spec) {
  await page.setViewportSize({ width: spec.largeur, height: spec.hauteur });
  const infos = await page.evaluate((s) => window.rendrePlanche(s), spec);
  await page.locator('#w').screenshot({ path: join(out, nom + '.png') });
  if (infos.some((i) => i.maillages !== 1)) erreurs.push(`${nom}: une cellule ne contient pas exactement 1 maillage`);
  console.log('écrit', join(out, nom + '.png'));
}

function cellules(m) {
  const u = (i) => `/modeles/${m.lods[i].file}`;
  const P = (k) => pal.get(m.palettes[k % m.palettes.length]);
  const pid = (k) => m.palettes[k % m.palettes.length];
  const t = (i) => `${m.lods[i].triangles} tri`;
  const cy = m.height * 0.5 + 0.02;
  const champ = Math.max(1.45, m.height + 0.3);
  const b = { cible: [0, cy, 0], champ };
  return [
    { ...b, url: u(0), palette: P(0), lacet: 0, etiquette: `${m.id}\nLOD0 face · ${t(0)} · ${pid(0)}` },
    { ...b, url: u(0), palette: P(0), lacet: 40, etiquette: 'LOD0 trois-quarts' },
    { ...b, url: u(0), palette: P(1), lacet: 90, etiquette: `LOD0 profil · ${pid(1)}` },
    { ...b, url: u(0), palette: P(1), lacet: 180, etiquette: 'LOD0 dos' },
    { ...b, url: u(1), palette: P(0), lacet: 40, etiquette: `LOD1 · ${t(1)}` },
    { ...b, url: u(2), palette: P(0), lacet: 40, etiquette: `LOD2 · ${t(2)}` },
    { ...b, url: u(0), palette: P(2), lacet: 90, clip: 'marche', phase: 0.0, etiquette: `marche 0 % · ${pid(2)}` },
    { ...b, url: u(0), palette: P(2), lacet: 90, clip: 'marche', phase: 0.25, etiquette: 'marche 25 %' },
    { ...b, url: u(0), palette: P(3), lacet: 90, clip: 'marche', phase: 0.5, etiquette: `marche 50 % · ${pid(3)}` },
    { ...b, url: u(0), palette: P(3), lacet: 90, clip: 'marche', phase: 0.75, etiquette: 'marche 75 %' },
    { ...b, url: u(0), palette: P(4), lacet: 30, clip: 'marche', phase: 0.1, etiquette: `marche 10 % (3/4) · ${pid(4)}` },
    { ...b, url: u(1), urlAnim: u(0), palette: P(4), lacet: 150, clip: 'marche', phase: 0.6, etiquette: 'LOD1 marche 60 % (3/4 dos)' },
    { ...b, url: u(2), urlAnim: u(0), palette: P(5), lacet: 60, clip: 'marche', phase: 0.35, etiquette: `LOD2 marche 35 % · ${pid(5)}` },
    { ...b, url: u(0), palette: P(5), lacet: 20, clip: 'attente', phase: 0.3, etiquette: 'attente 30 %' },
    { ...b, url: u(0), palette: P(0), lacet: 25, cible: [0, m.height - 0.13 * m.height * (m.age === 'enfant' ? 1.25 : 1), 0.02], champ: 0.5 * (m.height / 1.75) * (m.age === 'enfant' ? 1.25 : 1), elevation: 4, etiquette: 'tête (LOD0)' },
    { ...b, url: u(0), palette: P(2), lacet: 0, clip: 'marche', phase: 0.3, etiquette: 'marche 30 % face' },
  ];
}

for (const m of modeles) {
  const cs = cellules(m);
  await planche(m.id, { largeur: 8 * 300, hauteur: 2 * 450, cols: 8, rows: 2, cellules: cs });
}
// planche-contact générale : une rangée par personnage
{
  const cs = [];
  for (const m of modeles) {
    const c = cellules(m);
    for (const i of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) cs.push({ ...c[i], champ: 2.15, cible: [0, 0.98, 0], etiquette: i === 0 ? m.id : (c[i].etiquette || '').split(' · ')[0] });
  }
  await planche('planche_contact', { largeur: 10 * 190, hauteur: modeles.length * 270, cols: 10, rows: modeles.length, cellules: cs });
}
await browser.close();
server.close();
if (erreurs.length) { console.error(erreurs.join('\n')); process.exit(1); }
