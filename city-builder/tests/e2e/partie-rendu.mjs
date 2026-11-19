/**
 * Coût du rendu d'une partie de joueur par couche de la scène : appels de dessin et triangles de l'image entière, puis
 * de l'image sans chaque couche (la différence = coût de la couche). Vue de la caméra au chargement.
 * Lancer : npm run build && node tests/e2e/partie-rendu.mjs <sauvegarde>
 */
import { collectErrors, launch, serve } from './lib.mjs';

const file = process.argv[2];
const { server, base } = await serve();
const browser = await launch();
try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 755 } })).newPage();
  const errors = collectErrors(page);
  if (process.env.ROADCHUNK) await page.addInitScript((v) => { window.__roadChunk = v; }, Number(process.env.ROADCHUNK));
  await page.goto(`${base}/index.html?norender`, { timeout: 900000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__aube?.workerReady, null, { timeout: 900000, polling: 500 });
  await page.evaluate(() => { document.querySelector('#btn-load')?.classList.remove('hidden'); document.querySelector('#btn-load')?.click(); });
  await page.setInputFiles('#import-file', file);
  await page.waitForFunction(() => window.__aube?.ready && window.__aube.lastStats?.population > 0, null, { timeout: 900000, polling: 500 });
  await page.waitForTimeout(8000);
  const out = await page.evaluate(() => {
    const a = window.__aube;
    a.renderNow(3);
    const full = a.benchFrame();
    const names = a.setLayerVisible('__aucune__', true);
    const rows = [];
    for (const n of [...new Set(names)]) {
      a.setLayerVisible(n, false);
      a.renderNow(1);
      const r = a.benchFrame();
      a.setLayerVisible(n, true);
      rows.push({ couche: n, appels: full.calls - r.calls, triangles: full.triangles - r.triangles });
    }
    // Détail d'une couche : maillages visibles (nom, instances, triangles).
    const detail = (name) => {
      const out = [];
      a.debugScene?.(name, out);
      return out;
    };
    void detail;
    const ch = a.chantiers ? a.chantiers() : null;
    const chInfo = ch ? { chantiers: ch.chantiers, instances: ch.instances, maillages: ch.maillages, sites: (ch.sites ?? []).slice(0, 3) } : null;
    const roads = a.layerMeshes ? a.layerMeshes('roads') : null;
    const bat = a.layerMeshes ? a.layerMeshes('batiments') : null;
    const rr = window.__routes ? { reconstructions: window.__routes.rebuilds(), ms: Math.round(window.__routes.ms()), chunks: window.__routes.chunks() } : null;
    return { rr, roads, bat, chInfo, full, rows: rows.filter((r) => r.appels > 0 || r.triangles > 1000).sort((x, y) => y.appels - x.appels) };
  });
  console.log(`image entière : ${out.full.calls} appels de dessin, ${out.full.triangles} triangles, ${out.full.ms} ms (SwiftShader)`);
  for (const r of out.rows) console.log(`  ${r.couche.padEnd(28)} ${String(r.appels).padStart(5)} appels  ${String(r.triangles).padStart(9)} triangles`);
  const show = (t, o) => { if (!o) return; console.log(t); for (const [k, v] of Object.entries(o).sort((x, y) => y[1].n - x[1].n).slice(0, 14)) console.log(`    ${k.padEnd(40)} maillages ${String(v.n).padStart(4)}  instances ${String(v.inst).padStart(6)}  triangles ${String(Math.round(v.tris)).padStart(8)}`); };
  console.log('reconstruction des routes :', JSON.stringify(out.rr));
  show('routes (maillages visibles) :', out.roads);
  show('bâtiments :', out.bat);
  console.log('chantiers :', JSON.stringify(out.chInfo).slice(0, 900));
  if (errors.length) console.error('ERREURS', errors.slice(0, 8));
} finally { await browser.close(); server.close(); }
