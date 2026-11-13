/** QA : l'horloge de la simulation recule-t-elle pendant la pause (démo) ? node tests/e2e/qa-clock-probe.mjs */
import { launch, serve } from './lib.mjs';
const { server, base } = await serve();
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
await page.goto(`${base}/index.html?demo&norender`, { timeout: 600000, waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__aube?.demoReady === true, null, { timeout: 900000, polling: 1000 });
const log = [];
const rd = async (tag) => log.push(`${tag}: stats=${JSON.stringify(await page.evaluate(() => window.__aube.lastStats.date))} hud=${await page.textContent('#hud-date')} speed=${await page.evaluate(() => window.__aube.lastStats.speed)}`);
await rd('prêt');
await page.evaluate(() => window.__aube.send('setSpeed', { speed: 0 }));
await page.waitForTimeout(500); await rd('pause');
for (let i = 0; i < 4; i++) { await page.waitForTimeout(3000); await page.evaluate(() => window.__aube.renderNow(8, 0.5)); await rd(`pause+${i}`); }
await page.click('#btn-camera'); await page.waitForTimeout(500); await page.evaluate(() => window.__aube.renderNow(8, 0.5)); await rd('après bouton caméra');
await page.waitForTimeout(5000); await rd('après 5 s');
const rep = await page.evaluate(() => window.__aube.send('getReport', {}).then((r) => JSON.stringify(r).slice(0, 600)));
console.log(log.join('\n')); console.log(rep);
await browser.close(); server.close();
