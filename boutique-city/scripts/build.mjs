/**
 * Build de Boutique City : bundle unique dist/game.js (ESM, three inclus), page complète dist/index.html et fragment
 * dist/artifact.html (commence par <title>, styles intégrés, charge game.js).
 *   node scripts/build.mjs [--dev]
 */
import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const dev = process.argv.includes('--dev');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

await esbuild.build({
  entryPoints: [join(root, 'src/main.ts')], outfile: join(dist, 'game.js'), bundle: true, format: 'esm',
  minify: !dev, sourcemap: dev ? 'inline' : false, target: ['es2022', 'safari16'], legalComments: 'none', logLevel: 'info',
});

const css = readFileSync(join(root, 'src/ui/styles.css'), 'utf8');
const body = `<canvas id="scene" aria-label="Quartier en 3D"></canvas>
<header id="hud"></header>
<aside id="panel" class="hidden"></aside>
<div id="map" class="hidden"></div>
<div id="toasts" aria-live="polite"></div>
<div id="menu" class="hidden"></div>
<div id="loading" class="hidden"><div class="load-card"><h1>Boutique City</h1><div class="bar-track"><div class="bar-fill"></div></div><p class="load-label">Chargement…</p></div></div>
<script type="module" src="game.js"></script>`;
const head = `<title>Boutique City</title>
<meta name="description" content="Boutique City — partez de rien et bâtissez votre empire de commerces">
<style>${css}</style>`;
// Page complète : sa propre balise viewport (le fragment artifact.html reçoit celle de l'enveloppe de publication).
writeFileSync(join(dist, 'index.html'), `<!doctype html>\n<html lang="fr">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${head}\n</head>\n<body>\n${body}\n</body>\n</html>\n`);
writeFileSync(join(dist, 'artifact.html'), `${head}\n${body}\n`);
cpSync(join(root, 'models'), join(dist, 'models'), { recursive: true });
// Paquet des modèles : les GLB bout à bout, compressés (gzip) puis en base64 dans du JSON, avec leur index
// (fichier → [début, longueur]), en plusieurs parties de 24 Mo bruts au plus (limite de taille par fichier de la
// page publiée). models/pack.json liste les parties. Servi là où les .glb ne le sont pas ; décompressé dans le
// navigateur par DecompressionStream.
const PART_RAW = 24e6;
const glbs = readdirSync(join(root, 'models')).filter((f) => f.endsWith('.glb')).sort();
const partsOut = [];
let cur = [], curIndex = {}, off = 0, total = 0, totalGz = 0;
const flush = () => {
  if (!cur.length) return;
  const gz = gzipSync(Buffer.concat(cur), { level: 9 });
  const name = `pack-${partsOut.length}.json`;
  writeFileSync(join(dist, 'models', name), JSON.stringify({ index: curIndex, gz: gz.toString('base64') }));
  partsOut.push(name); totalGz += gz.length;
  cur = []; curIndex = {}; off = 0;
};
for (const f of glbs) {
  const b = readFileSync(join(root, 'models', f));
  if (off + b.length > PART_RAW) flush();
  curIndex[f] = [off, b.length]; cur.push(b); off += b.length; total += b.length;
}
flush();
writeFileSync(join(dist, 'models', 'pack.json'), JSON.stringify({ v: 4, parts: partsOut }));
console.log(`paquet : ${glbs.length} modèles, ${(total / 1e6).toFixed(1)} Mo → ${(totalGz / 1e6).toFixed(1)} Mo compressés, ${partsOut.length} parties`);
console.log('dist : game.js, index.html, artifact.html, models/');
