/**
 * Construit la démo environnement (hors build du jeu) dans .cache/env-demo/ :
 * env-demo.js (ESM), terrain-gen.worker.js (worker de génération), index.html, lien vers assets/.
 *   node src/render/terrain/demo/build-demo.mjs
 */
import * as esbuild from 'esbuild';
import { copyFileSync, existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const out = join(root, '.cache', 'env-demo');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const common = { bundle: true, minify: true, target: ['es2022', 'safari16'], logLevel: 'warning', legalComments: 'none' };
await esbuild.build({ ...common, entryPoints: [join(root, 'src/render/terrain/demo/env-demo.ts')], outfile: join(out, 'env-demo.js'), format: 'esm' });
await esbuild.build({ ...common, entryPoints: [join(root, 'src/sim/terrain/gen.worker.ts')], outfile: join(out, 'terrain-gen.worker.js'), format: 'iife' });
writeFileSync(join(out, 'index.html'), `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Aube Urbaine — démo environnement</title>
<meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body{margin:0;height:100%;background:#0f1216;overflow:hidden}canvas{display:block;width:100vw;height:100vh}</style></head>
<body><canvas id="c"></canvas><script type="module" src="./env-demo.js"></script></body></html>\n`);
if (!existsSync(join(out, 'assets'))) symlinkSync(join(root, 'assets'), join(out, 'assets'), 'dir');
const frag = join(root, '.cache', 'nature', 'catalog-fragment.json');
if (existsSync(frag)) copyFileSync(frag, join(out, 'nature-fragment.json'));
console.log(`Démo environnement : ${out}`);
