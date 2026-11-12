/**
 * Build : bundle principal (dist/game.js, ESM) + bundle worker (dist/sim.worker.js, classique),
 * copie des assets (dist/assets/**), génération de dist/index.html (page complète)
 * et dist/artifact.html (fragment : commence par <title> et <meta viewport>).
 * Vérifie les budgets : total dist <= 60 Mo, chaque fichier <= 15 Mo.
 *   node scripts/build.mjs [--watch] [--dev]
 */
import * as esbuild from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { optimizeGlbDir } from './optimize-glb.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const watch = process.argv.includes('--watch');
const dev = process.argv.includes('--dev') || watch;

const TOTAL_BUDGET = 60 * 1024 * 1024;
const FILE_BUDGET = 15 * 1024 * 1024;

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const common = {
  bundle: true,
  sourcemap: dev ? 'inline' : false,
  minify: !dev,
  target: ['es2022', 'safari16'],
  logLevel: 'info',
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': dev ? '"development"' : '"production"' },
};

const mainOpts = { ...common, entryPoints: [join(root, 'src/main.ts')], outfile: join(dist, 'game.js'), format: 'esm', splitting: false };
const workerOpts = { ...common, entryPoints: [join(root, 'src/sim/worker.ts')], outfile: join(dist, 'sim.worker.js'), format: 'iife' };

function html({ fragment }) {
  const css = readFileSync(join(root, 'src/ui/styles.css'), 'utf8');
  const markup = readFileSync(join(root, 'src/ui/markup.html'), 'utf8');
  const head = [
    '<title>Aube Urbaine</title>',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    '<meta name="description" content="Aube Urbaine — city-builder 3D">',
    '<meta name="theme-color" content="#0f1216">',
    `<style>\n${css}</style>`,
  ].join('\n');
  const body = `${markup}\n<script type="module" src="./game.js"></script>`;
  if (fragment) return `${head}\n${body}\n`;
  return `<!doctype html>\n<html lang="fr">\n<head>\n<meta charset="utf-8">\n${head}\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
}

function copyAssets() {
  const src = join(root, 'assets');
  const dst = join(dist, 'assets');
  if (existsSync(src)) cpSync(src, dst, { recursive: true, filter: (p) => !p.endsWith('.md') && !/[\/]_src([\/]|$)/.test(p) && !/catalog\.[a-z.]+\.json$/.test(p) });
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else out.push({ path: p, size: st.size });
  }
  return out;
}

function checkBudget() {
  const files = walk(dist);
  const total = files.reduce((s, f) => s + f.size, 0);
  const tooBig = files.filter((f) => f.size > FILE_BUDGET);
  const mb = (n) => (n / 1024 / 1024).toFixed(2);
  console.log(`dist : ${files.length} fichiers, ${mb(total)} Mo (budget 60 Mo)`);
  let ok = true;
  if (total > TOTAL_BUDGET) { console.error(`ERREUR : dist dépasse 60 Mo (${mb(total)} Mo)`); ok = false; }
  for (const f of tooBig) { console.error(`ERREUR : ${relative(dist, f.path)} dépasse 15 Mo (${mb(f.size)} Mo)`); ok = false; }
  return ok;
}

function writePages() {
  writeFileSync(join(dist, 'index.html'), html({ fragment: false }));
  writeFileSync(join(dist, 'artifact.html'), html({ fragment: true }));
}

if (watch) {
  const c1 = await esbuild.context(mainOpts);
  const c2 = await esbuild.context(workerOpts);
  copyAssets();
  writePages();
  await Promise.all([c1.watch(), c2.watch()]);
  console.log('Surveillance active (Ctrl+C pour arrêter).');
} else {
  await Promise.all([esbuild.build(mainOpts), esbuild.build(workerOpts)]);
  copyAssets();
  if (!process.argv.includes('--no-glb-opt')) {
    const r = await optimizeGlbDir(join(dist, 'assets'), join(root, '.cache/glb-opt'));
    const mb = (n) => (n / 1024 / 1024).toFixed(2);
    console.log(`GLB compressés (meshopt) : ${r.files} fichiers (${r.fresh} recompressés), ${mb(r.before)} Mo -> ${mb(r.after)} Mo`);
  }
  writePages();
  if (!checkBudget()) process.exit(1);
}
