/**
 * Build de Boutique City : bundle unique dist/game.js (ESM, three inclus), page complète dist/index.html et fragment
 * dist/artifact.html (commence par <title>, styles intégrés, charge game.js).
 *   node scripts/build.mjs [--dev]
 */
import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
console.log('dist : game.js, index.html, artifact.html, models/');
