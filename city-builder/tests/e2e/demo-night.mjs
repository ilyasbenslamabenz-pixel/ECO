/**
 * Vérifie l'éclairage de la scène de démonstration en vue AÉRIENNE selon l'heure (recette QA : « vue aérienne
 * éclairée en plein jour à 00:10 »). Lance ?demo&h=0.2 (nuit) et ?demo&h=13 (jour), capture la vue aérienne,
 * compare la luminance moyenne et relit l'heure affichée. node tests/e2e/demo-night.mjs (après npm run build).
 * Captures : tests/e2e/out/demo-nuit-aerien.png, demo-jour-aerien.png.
 */
import { join } from 'node:path';
import { collectErrors, launch, root, serve } from './lib.mjs';

const out = join(root, 'tests/e2e/out');
const { server, base } = await serve();
const browser = await launch();
let failed = false;
const check = (ok, msg) => { console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${msg}`); if (!ok) failed = true; };
const res = {};
try {
  for (const [name, h] of [['nuit', 0.2], ['jour', 13]]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const errors = collectErrors(page);
    await page.goto(`${base}/index.html?demo&h=${h}&norender`, { timeout: 600000, waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__aube?.demoReady === true || (window.__aube?.errors?.length ?? 0) > 0, null, { timeout: 900000, polling: 1000 });
    await page.evaluate(() => window.__aube.send('setSpeed', { speed: 0 }));
    await page.waitForTimeout(800);
    await page.evaluate(() => window.__aube.renderNow(6, 0.5));
    const date = await page.textContent('#hud-date');
    const lum = await page.evaluate(() => {
      window.__aube.renderNow(1);
      const c = document.getElementById('scene');
      const g = document.createElement('canvas'); g.width = 160; g.height = 100;
      const x = g.getContext('2d'); x.drawImage(c, 0, 0, 160, 100);
      const d = x.getImageData(0, 10, 160, 80).data; let s = 0;
      for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      return s / (d.length / 4);
    });
    res[name] = { date, lum };
    await page.screenshot({ path: join(out, `demo-${name}-aerien.png`), timeout: 600000 });
    check(errors.length === 0, `${name} : aucune erreur de page ${errors.slice(0, 3).join(' | ')}`);
    await page.close();
  }
  console.log(JSON.stringify(res));
  check(res.nuit.lum < res.jour.lum * 0.6, `vue aérienne plus sombre la nuit (${res.nuit.date} : ${res.nuit.lum.toFixed(1)}) que le jour (${res.jour.date} : ${res.jour.lum.toFixed(1)})`);
} catch (e) { console.error(e); failed = true; } finally { await browser.close(); server.close(); }
process.exit(failed ? 1 : 0);
