/**
 * Test de charge (npm run stress, après npm run build) : ville de 500 bâtiments et 1000 véhicules générée par la
 * simulation (buildCity 'stress'), puis mesures :
 *  - Node (sans navigateur) : temps de génération, temps de tick du worker (moyenne, p95, max) sur 600 pas ;
 *  - Chromium (SwiftShader, rendu LOGICIEL : les i/s ne représentent pas un GPU réel) : appels de rendu,
 *    triangles, géométries/textures en mémoire, tas JS, temps de tick rapporté par le worker, durée CPU des
 *    mises à jour de rendu par image.
 * Écrit tests/e2e/out/stress-rapport.json et stress-aerien.png. Échoue si la ville n'atteint pas 500 bâtiments et
 * 1000 véhicules, ou si le tick dépasse son budget (100 ms par pas en Node, très large) ; les autres chiffres sont
 * des mesures (pas des seuils : le rendu logiciel ne permet pas de juger les performances GPU).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { collectErrors, launch, root, serve } from './lib.mjs';

const out = join(root, 'tests/e2e/out');
mkdirSync(out, { recursive: true });
const failures = [];

// 1. Mesure Node (simulation pure).
const node = spawnSync(process.execPath, ['--import', 'tsx', join(root, 'tests/e2e/stress-node.ts')], { cwd: root, encoding: 'utf8' });
if (node.status !== 0) failures.push(`mesure Node : ${node.stderr.slice(-800)}`);
const nodeReport = node.status === 0 ? JSON.parse(node.stdout.trim().split('\n').pop()) : null;
if (nodeReport) {
  console.log('Node :', JSON.stringify(nodeReport));
  if (nodeReport.buildings < 500) failures.push(`ville de test : ${nodeReport.buildings} bâtiments < 500`);
  if (nodeReport.vehicles < 1000) failures.push(`ville de test : ${nodeReport.vehicles} véhicules < 1000`);
  if (nodeReport.tick.p95 > 100) failures.push(`tick p95 ${nodeReport.tick.p95} ms > 100 ms`);
}

// 2. Mesure navigateur.
const { server, base } = await serve();
const browser = await launch();
let browserReport = null;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors = collectErrors(page);
  const t0 = Date.now();
  await page.goto(`${base}/index.html?stress`);
  await page.waitForFunction(() => window.__aube?.demoReady === true || (window.__aube?.errors?.length ?? 0) > 0, null, { timeout: 900000 });
  const readyS = (Date.now() - t0) / 1000;
  const f0 = await page.evaluate(() => window.__aube.frames());
  const tStart = Date.now();
  await page.waitForTimeout(20000);
  const sample = await page.evaluate(() => {
    const mem = performance.memory;
    return {
      frames: window.__aube.frames(), stats: window.__aube.renderStats(), sim: window.__aube.lastStats, demo: { ...window.__aube.demo },
      scene: window.__aube.sceneCheck(), heapMB: mem ? Math.round(mem.usedJSHeapSize / 1048576) : null, errors: window.__aube.errors,
    };
  });
  await page.screenshot({ path: join(out, 'stress-aerien.png') });
  const fps = (sample.frames - f0) / ((Date.now() - tStart) / 1000);
  browserReport = {
    readySeconds: readyS, swiftshaderFps: Math.round(fps * 10) / 10, drawCalls: sample.stats.calls, triangles: sample.stats.triangles,
    geometries: sample.stats.geometries, textures: sample.stats.textures, renderUpdateMsPerFrame: Math.round(sample.stats.frameMs * 10) / 10,
    workerTickMs: sample.sim?.tickMs, simVehicles: sample.sim?.vehicles, simBuildings: sample.sim?.buildings, population: sample.sim?.population,
    vehiclesDrawn: sample.scene.vehicles.drawn, heapMB: sample.heapMB, pageErrors: errors.slice(0, 5),
  };
  console.log('Chromium :', JSON.stringify(browserReport));
  if (errors.length) failures.push(`erreurs de page : ${errors.slice(0, 5).join(' | ')}`);
  if ((sample.sim?.buildings ?? 0) < 500) failures.push(`navigateur : ${sample.sim?.buildings} bâtiments`);
} catch (e) {
  failures.push(`navigateur : ${e instanceof Error ? e.message : String(e)}`);
} finally {
  await browser.close();
  server.close();
}
writeFileSync(join(out, 'stress-rapport.json'), JSON.stringify({ date: new Date().toISOString(), node: nodeReport, chromium: browserReport, failures }, null, 2));
if (failures.length) { console.error(`\nTEST DE CHARGE : ÉCHEC\n - ${failures.join('\n - ')}`); process.exit(1); }
console.log('\nTEST DE CHARGE : OK (rapport tests/e2e/out/stress-rapport.json)');
