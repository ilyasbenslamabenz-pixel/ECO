/**
 * Sonde QA : (1) croissance réelle dans une partie neuve : avenue + 6 maisons accessibles (commandes du joueur),
 * vitesse max, suivi habitants/emplois/véhicules ; (2) iPhone 13 avec boucle de rendu active : pincer et rotation à deux doigts.
 *   node tests/e2e/qa-growth-touch.mjs
 */
import { join } from 'node:path';
import { collectErrors, launch, root, serve } from './lib.mjs';
const out = join(root, 'tests/e2e/out');
const { server, base } = await serve();
const browser = await launch();
const mode = process.argv[2] ?? 'all';
if (mode !== 'touch') {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })).newPage();
  const errs = collectErrors(page);
  await page.goto(`${base}/index.html?autostart&seed=7&norender`, { timeout: 300000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__aube?.ready && window.__aube.snapshotReceived && window.__aube.lastStats, null, { timeout: 300000, polling: 500 });
  const send = (n, a) => page.evaluate(([n, a]) => window.__aube.send(n, a).then((r) => ({ ok: true, r }), (e) => ({ ok: false, e: e.message })), [n, a]);
  await send('setSpeed', { speed: 0 });
  console.log('avenue', JSON.stringify(await send('buildRoad', { type: 'street', kind: 'avenue', points: [-450, 128, -190, 128] })));
  let n = 0;
  for (const x of [-430, -400, -370, -340, -310, -280, -250, -220]) {
    const r = await send('placeBuilding', { assetId: 'maison_pavillon_enduit', x, z: 128 + 22, rot: 2, variant: 0 });
    if (r.ok) n++; else console.log('refus', x, r.e);
  }
  const r2 = await send('placeBuilding', { assetId: 'immeuble_haussmannien', x: -300, z: 128 + 26, rot: 2, variant: 0 });
  console.log('maisons posées', n, 'immeuble', JSON.stringify(r2));
  const insp = await send('inspectBuilding', { id: 1 });
  console.log('inspect', JSON.stringify(insp).slice(0, 600));
  await send('setSpeed', { speed: 4 });
  for (let k = 0; k < 8; k++) {
    await page.waitForTimeout(15000);
    const s = await page.evaluate(() => window.__aube.lastStats);
    console.log(`t=${(k + 1) * 15}s date j${s.date.day}/${s.date.month} ${s.date.hour}h pop=${s.population} jobs=${s.jobs} veh=${s.vehicles} money=${s.money}`);
  }
  const rep = await page.evaluate(() => window.__aube.lastReport);
  console.log('demande', JSON.stringify(rep?.demography?.demand), 'attract', rep?.demography?.attractiveness, 'logements libres', rep?.demography?.housingFree, 'capacité', rep?.demography?.housingCapacity);
  console.log('erreurs', errs.slice(0, 3));
}
if (mode !== 'growth') {
  const ip = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
  const p2 = await ip.newPage();
  await p2.goto(`${base}/index.html?autostart&seed=7`, { timeout: 300000, waitUntil: 'domcontentloaded' });
  await p2.waitForFunction(() => window.__aube?.ready && window.__aube.snapshotReceived, null, { timeout: 300000, polling: 1000 });
  await p2.evaluate(() => window.__aube.send('setSpeed', { speed: 0 }));
  const cdp = await ip.newCDPSession(p2);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i + 1, radiusX: 4, radiusY: 4, force: 1 })) });
  const pose = () => p2.evaluate(() => window.__aube.cameraPose());
  const p0 = await pose();
  await touch('touchStart', [[150, 450], [240, 450]]);
  for (let k = 1; k <= 10; k++) { await touch('touchMove', [[150 - k * 9, 450], [240 + k * 9, 450]]); await p2.waitForTimeout(400); }
  await touch('touchEnd', []); await p2.waitForTimeout(2000);
  const p1 = await pose();
  const cx = 195, cy = 450, rr = 60;
  await touch('touchStart', [[cx - rr, cy], [cx + rr, cy]]);
  for (let k = 1; k <= 10; k++) { const a = k * 0.08; await touch('touchMove', [[cx - rr * Math.cos(a), cy - rr * Math.sin(a)], [cx + rr * Math.cos(a), cy + rr * Math.sin(a)]]); await p2.waitForTimeout(400); }
  await touch('touchEnd', []); await p2.waitForTimeout(2000);
  const p3 = await pose();
  await touch('touchStart', [[160, 500], [230, 500]]);
  for (let k = 1; k <= 10; k++) { await touch('touchMove', [[160, 500 - k * 12], [230, 500 - k * 12]]); await p2.waitForTimeout(400); }
  await touch('touchEnd', []); await p2.waitForTimeout(2000);
  const p4 = await pose();
  console.log('iPhone poses', JSON.stringify({ p0, p1, p3, p4 }));
  console.log(`pincer: distance ${p0.distance.toFixed(0)} -> ${p1.distance.toFixed(0)} ; rotation: yaw ${p1.yaw.toFixed(2)} -> ${p3.yaw.toFixed(2)} ; glisser 2 doigts: pitch ${p3.pitch.toFixed(2)} -> ${p4.pitch.toFixed(2)}`);
  await p2.screenshot({ path: join(out, 'qa4-iphone-gestes.png'), timeout: 300000 });
}
await browser.close(); server.close();
