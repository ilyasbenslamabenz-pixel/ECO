/**
 * Banc de captures « Atmosphère » (phase 2C) : saisons, météo, nuit, coucher de soleil sur la scène de démonstration.
 *   npm run build && node tests/weather/captures.mjs        (ONLY=jour,soir,nuit ; QUALITY=haut|bas|off)
 * Chaque scénario force la météo par la commande du module (`pluginCommand weather force`), l'applique au rendu
 * (`__atmo.apply`), rend et capture. Mesure le coût : appels de rendu et triangles avec et sans atmosphère.
 * Sorties : tests/weather/out/<nn>-<scénario>.png + rapport.json. Rendu logiciel (SwiftShader) : lent.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { collectErrors, launch, root, serve } from '../e2e/lib.mjs';

const out = join(root, 'tests/weather/out');
mkdirSync(out, { recursive: true });
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const QUALITY = process.env.QUALITY ?? 'haut';
const report = { quality: QUALITY, views: [], cost: [], errors: [] };
let index = 0;
let failed = false;

const { server, base } = await serve();
const browser = await launch();

async function openDemo(h) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = collectErrors(page);
  await page.goto(`${base}/index.html?demo&norender&h=${h}&atmo=${QUALITY}`, { timeout: 600000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__aube?.demoReady === true || (window.__aube?.errors?.length ?? 0) > 0, null, { timeout: 1800000, polling: 1000 });
  await page.evaluate(() => window.__aube.send('setSpeed', { speed: 0 }));
  await page.waitForTimeout(800);
  const views = await page.evaluate(() => window.__aube.demo?.views);
  return { ctx, page, errors, views };
}

async function force(page, payload) {
  return page.evaluate(async (p) => {
    const r = await window.__aube.send('pluginCommand', { plugin: 'weather', name: 'force', payload: { settle: true, ...p } });
    const w = r?.data?.data ?? r?.data;
    window.__atmo.apply(w);
    return w;
  }, payload);
}

async function camera(page, views, kind) {
  const [x, z] = views.aerial;
  if (kind === 'aerien') await page.evaluate(([a, b]) => window.__aube.lookAt(a, b, 260, 0.75, -0.4), [x, z]);
  else if (kind === 'horizon') await page.evaluate(([a, b]) => window.__aube.lookAt(a, b, 520, 0.2, 2.2), [x, z]);
  else if (kind === 'large') await page.evaluate(([a, b]) => window.__aube.lookAt(a, b, 600, 0.6, 0.6), [x, z]);
  else await page.evaluate(() => window.__aube.setCamera('demo-street'));
}

async function shoot(page, name, meta = {}, strike = false) {
  await page.evaluate(() => window.__aube.renderNow(3, 0.5));
  await page.waitForTimeout(3500);
  if (strike) await page.evaluate(() => window.__atmo.strike());
  await page.evaluate((s) => window.__aube.renderNow(1, s ? 0.02 : 0.1), strike);
  const stats = await page.evaluate(() => ({ r: window.__aube.renderStats(), a: window.__atmo?.stats() }));
  const file = `${String(++index).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: join(out, file), timeout: 900000 });
  const st = await sharp(join(out, file)).stats();
  const stdev = st.channels.slice(0, 3).reduce((a, c) => a + c.stdev, 0) / 3;
  report.views.push({ file, ...meta, stdev: Math.round(stdev), calls: stats.r?.calls, triangles: stats.r?.triangles, atmo: stats.a });
  console.log(`${file} : écart-type ${stdev.toFixed(1)}, ${stats.r?.calls} appels, ${stats.r?.triangles} triangles, atmo ${JSON.stringify(stats.a)}`);
  if (stdev < 8) { failed = true; console.log(`ÉCHEC ${file} quasi uniforme`); }
}

const SCENARIOS = {
  jour: {
    h: 11,
    list: [
      ['ete', { kind: 'ensoleille', dayOfYear: 195, wetness: 0, snowCover: 0 }, ['aerien', 'rue']],
      ['printemps', { kind: 'ensoleille', dayOfYear: 110, wetness: 0, snowCover: 0 }, ['aerien']],
      ['automne', { kind: 'nuageux', dayOfYear: 292, wetness: 0.15, snowCover: 0 }, ['aerien', 'rue']],
      ['hiver', { kind: 'nuageux', dayOfYear: 25, wetness: 0.2, snowCover: 0.75 }, ['aerien', 'rue']],
      ['pluie', { kind: 'pluie', dayOfYear: 280 }, ['aerien', 'rue']],
      ['neige', { kind: 'neige', dayOfYear: 20 }, ['aerien', 'rue']],
      ['brouillard', { kind: 'brouillard', dayOfYear: 305, wetness: 0.35, snowCover: 0 }, ['large', 'rue']],
      ['orage', { kind: 'orage', dayOfYear: 200 }, ['horizon']],
    ],
  },
  soir: {
    h: 19.6,
    list: [['coucher', { kind: 'ensoleille', dayOfYear: 172, wetness: 0, snowCover: 0 }, ['horizon', 'aerien']]],
  },
  nuit: {
    h: 21.8,
    list: [
      ['nuit', { kind: 'ensoleille', dayOfYear: 172, wetness: 0, snowCover: 0 }, ['aerien', 'rue']],
      ['nuit-pluie', { kind: 'pluie', dayOfYear: 290 }, ['rue', 'aerien']],
      ['nuit-brouillard', { kind: 'brouillard', dayOfYear: 300, wetness: 0.4 }, ['rue']],
    ],
  },
};

try {
  for (const [session, def] of Object.entries(SCENARIOS)) {
    if (ONLY && !ONLY.includes(session)) continue;
    const t0 = Date.now();
    const { ctx, page, errors, views } = await openDemo(def.h);
    console.log(`Session ${session} (h=${def.h}) prête en ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    if (session === 'jour') {
      // Coût de l'atmosphère : même vue, pluie forte, qualité haute puis désactivée.
      await force(page, { kind: 'pluie', dayOfYear: 280 });
      await camera(page, views, 'rue');
      const cost = {};
      for (const q of ['haut', 'bas', 'off']) {
        await page.evaluate((qq) => window.__atmo.setQuality(qq), q);
        await page.evaluate(() => window.__aube.renderNow(3, 0.3));
        cost[q] = await page.evaluate(() => ({ r: window.__aube.renderStats(), a: window.__atmo.stats() }));
      }
      await page.evaluate((qq) => window.__atmo.setQuality(qq), QUALITY);
      report.cost.push({ view: 'rue-pluie', ...cost });
      console.log('Coût (rue, pluie) :', JSON.stringify(Object.fromEntries(Object.entries(cost).map(([k, v]) => [k, { calls: v.r.calls, triangles: v.r.triangles, extra: v.a }]))));
    }
    for (const [name, payload, cams] of def.list) {
      const w = await force(page, payload);
      for (const cam of cams) {
        await camera(page, views, cam);
        await shoot(page, `${name}-${cam}`, { session, weather: w }, name === 'orage');
      }
    }
    if (errors.length) { failed = true; report.errors.push(...errors.slice(0, 10)); console.log('Erreurs de page :', errors.slice(0, 10)); }
    await ctx.close();
  }
} catch (e) {
  failed = true;
  report.errors.push(String(e?.stack ?? e));
  console.error(e);
} finally {
  writeFileSync(join(out, 'rapport.json'), JSON.stringify(report, null, 2));
  await browser.close();
  server.close();
}
console.log(failed ? 'CAPTURES ATMOSPHÈRE : ÉCHEC' : 'CAPTURES ATMOSPHÈRE : OK');
process.exit(failed ? 1 : 0);
