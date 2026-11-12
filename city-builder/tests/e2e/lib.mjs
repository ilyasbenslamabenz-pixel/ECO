/** Outils e2e : serveur statique de dist/ et lancement de Chromium (rendu logiciel SwiftShader). */
import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
export const dist = join(root, 'dist');

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ktx2': 'image/ktx2', '.hdr': 'application/octet-stream', '.css': 'text/css' };

/** Sert dist/ ; `wrapFragment` enveloppe artifact.html dans un squelette (comme le fait l'hébergeur). */
export function serve(dir = dist) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://x');
      if (url.pathname === '/__artifact_wrapped.html') {
        const frag = readFileSync(join(dir, 'artifact.html'), 'utf8');
        res.writeHead(200, { 'content-type': TYPES['.html'] });
        res.end(`<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${frag}</body></html>`);
        return;
      }
      const p = normalize(join(dir, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)));
      if (!p.startsWith(dir) || !existsSync(p) || statSync(p).isDirectory()) { res.writeHead(404); res.end('404'); return; }
      res.writeHead(200, { 'content-type': TYPES[extname(p)] ?? 'application/octet-stream' });
      createReadStream(p).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

const require = createRequire(import.meta.url);
function loadPlaywright() {
  const tries = [() => require('playwright'), () => require('/opt/node-tools/node_modules/playwright')];
  for (const t of tries) { try { return t(); } catch { /* suivant */ } }
  throw new Error('Playwright introuvable (préinstallé attendu dans NODE_PATH ou /opt/node-tools)');
}

export async function launch() {
  const { chromium } = loadPlaywright();
  return chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
}

/** Attache la collecte d'erreurs de page à un onglet. */
export function collectErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText ?? ''}`));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url()}`); });
  return errors;
}
