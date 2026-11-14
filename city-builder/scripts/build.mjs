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
import { gzipFilesIn, optimizeGlbDir } from './optimize-glb.mjs';

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
    '<title>Meknes City</title>',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    '<meta name="description" content="Meknes City — city-builder 3D">',
    '<meta name="theme-color" content="#0b0f13">',
    `<style>\n${css}</style>`,
  ].join('\n');
  const body = `${markup}\n<script type="module" src="./game.js"></script>`;
  if (fragment) return `${head}\n${body}\n`;
  // Page complète (GitHub Pages, cache navigateur de 10 min) : numéro de version sur le script pour que
  // chaque publication soit chargée tout de suite ; game.js le transmet au Worker (src/main.ts).
  const ver = (process.env.GITHUB_SHA ?? Date.now().toString(36)).slice(0, 10);
  const bodyFull = body.replace('src="./game.js"', `src="./game.js?v=${ver}"`);
  // Page complète : icône locale (évite le 404 /favicon.ico qu'un Chromium complet demande, compté comme erreur par l'e2e).
  return `<!doctype html>\n<html lang="fr">\n<head>\n<meta charset="utf-8">\n<link rel="icon" href="./favicon.svg" type="image/svg+xml">\n${head}\n</head>\n<body>\n${bodyFull}\n</body>\n</html>\n`;
}

const FAVICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#10161c"/><path d="M16 50V32a16 16 0 0132 0v18M24 50V36a8 8 0 0116 0v14M11 50h42M32 9v7" fill="none" stroke="#3ddc84" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/></svg>\n';

/** Copies 256 px des textures communes (x.webp -> x.256.webp) : le mode allégé ne décode jamais les 1024 px. */
async function liteTextures(assetsDir) {
  const sharp = (await import('sharp')).default;
  let files = 0, bytes = 0;
  const walk = async (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) { await walk(p); continue; }
      if (!f.endsWith('.webp') || /\.(256|512)\.webp$/.test(f)) continue;
      for (const size of [256, 512]) {
        const out = p.replace(/\.webp$/, `.${size}.webp`);
        await sharp(p).resize(size, size, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toFile(out);
        files++; bytes += statSync(out).size;
      }
    }
  };
  for (const sub of ['textures', 'buildings']) if (existsSync(join(assetsDir, sub))) await walk(join(assetsDir, sub));
  return { files, bytes };
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
  writeFileSync(join(dist, 'favicon.svg'), FAVICON);
  writeFileSync(join(dist, 'artifact.html'), html({ fragment: true }));
}

if (watch) {
  const c1 = await esbuild.context(mainOpts);
  const c2 = await esbuild.context(workerOpts);
  copyAssets();
  await liteTextures(join(dist, 'assets'));
  writePages();
  await Promise.all([c1.watch(), c2.watch()]);
  console.log('Surveillance active (Ctrl+C pour arrêter).');
} else {
  await Promise.all([esbuild.build(mainOpts), esbuild.build(workerOpts)]);
  copyAssets();
  if (!process.argv.includes('--no-glb-opt')) {
    const r = await optimizeGlbDir(join(dist, 'assets'), join(root, '.cache/glb-opt'));
    const mb = (n) => (n / 1024 / 1024).toFixed(2);
    console.log(`GLB compressés (prune/dedup, images plafonnées, meshopt, gzip) : ${r.files} fichiers (${r.fresh} recompressés), ${mb(r.before)} Mo -> ${mb(r.after)} Mo`);
    const h = gzipFilesIn(join(dist, 'assets'), ['.hdr']);
    console.log(`HDRI gzip : ${h.files} fichiers, ${mb(h.before)} Mo -> ${mb(h.after)} Mo`);
  }
  const lt = await liteTextures(join(dist, 'assets'));
  console.log(`Textures 256 px (mode allégé) : ${lt.files} fichiers, ${(lt.bytes / 1024 / 1024).toFixed(2)} Mo`);
  writePages();
  if (!checkBudget()) process.exit(1);
}
