/**
 * Parcours de jeu e2e (npm run e2e:game, après npm run build), dans le VRAI jeu (worker réel, rendu réel) :
 *  PC 1440×900 :
 *   1. nouvelle partie (?autostart&seed=7) : terrain WorldTerrain (eau, forêts) ;
 *   2. route courbe (commande buildRoad + point de contrôle, comme l'outil) puis une rue qui la croise
 *      (carrefour automatique) ; trésorerie débitée ; bâtiment posé le long de la route ;
 *   3. les habitants emménagent (population > 0 après quelques heures de jeu) ;
 *   4. sauvegarde par l'INTERFACE (bouton Sauvegarder -> emplacement nommé), RECHARGEMENT de la page,
 *      menu « Charger une partie » -> la ville rechargée est identique (bâtiments, routes, trésorerie, date).
 *  iPhone 13 émulé (390×844, tactile) : pincer = zoom et glisser à deux doigts, via CDP Input.dispatchTouchEvent.
 * Captures (deviceScaleFactor 1) : tests/e2e/out/jeu-*.png, iphone-*.png.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { collectErrors, launch, root, serve } from './lib.mjs';

const out = join(root, 'tests/e2e/out');
mkdirSync(out, { recursive: true });
const { server, base } = await serve();
const browser = await launch();
let failed = false;
const check = (cond, msg) => { console.log(`${cond ? 'OK  ' : 'ÉCHEC'} ${msg}`); if (!cond) failed = true; };
const strip = (s) => ({ buildings: s.buildings, roads: s.roads, money: s.economy.money, minutes: s.clock.totalMinutes, pop: s.population?.citizens?.id?.length ?? 0 });

try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = collectErrors(page);
  await page.goto(`${base}/index.html?autostart&seed=7&norender`);
  await page.waitForFunction(() => window.__aube?.ready && window.__aube.snapshotReceived, null, { timeout: 300000 });
  const send = (name, args) => page.evaluate(([n, a]) => window.__aube.send(n, a).then((r) => ({ ok: true, r }), (e) => ({ ok: false, e: e.message })), [name, args]);
  await send('setSpeed', { speed: 0 });
  const money0 = await page.evaluate(() => window.__aube.lastStats?.money ?? 0);

  // Emplacement sec et plat : on essaie des tracés autour du centre jusqu'à acceptation (validation par la simulation).
  let road = null, at = null;
  for (let r = 0; r < 600 && !road; r += 40) {
    for (let a = 0; a < 6 && !road; a++) {
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const res = await send('buildRoad', { type: 'street', kind: 'avenue', points: [x - 120, z, x + 120, z], control: [x, z + 50] });
      if (res.ok) { road = res.r; at = [x, z]; }
    }
  }
  check(!!road, `route courbe construite (${road?.edgeIds.length} tronçon(s), coût ${road?.cost})`);
  const cross = await send('buildRoad', { type: 'street', points: [at[0], at[1] - 60, at[0], at[1] + 90] });
  check(cross.ok, `rue transversale : carrefour automatique (${cross.ok ? cross.r.edgeIds.length + ' tronçons' : cross.e})`);
  // Bâtiments le long de la rue transversale (façade vers la rue).
  let placed = 0;
  for (const [dx, rot] of [[-14, 3], [14, 1], [-16, 3], [16, 1]]) {
    for (let dz = -50; dz <= 80 && placed < 3; dz += 8) {
      const res = await send('placeBuilding', { assetId: placed === 0 ? 'immeuble_haussmannien' : 'maison_pavillon_enduit', x: at[0] + dx, z: at[1] + dz, rot, variant: 1 });
      if (res.ok) { placed++; dz += 24; }
    }
  }
  check(placed >= 2, `${placed} bâtiments GLB posés le long des routes`);
  await send('setSpeed', { speed: 4 });
  await page.waitForTimeout(8000);
  const st = await page.evaluate(() => window.__aube.lastStats);
  check(st.money < money0, `trésorerie débitée (${money0} -> ${st.money})`);
  check(st.buildings >= placed, `bâtiments dans la simulation : ${st.buildings}`);
  console.log(`     habitants : ${st.population}, emplois : ${st.jobs}, véhicules : ${st.vehicles}, date ${JSON.stringify(st.date)}`);
  await page.evaluate(([x, z]) => window.__aube.lookAt(x, z, 220), at);
  await page.evaluate(() => window.__aube.renderNow(2));
  await page.screenshot({ path: join(out, 'jeu-partie.png'), timeout: 600000 });

  // Sauvegarde par l'interface.
  await send('setSpeed', { speed: 0 });
  await page.waitForTimeout(500);
  await page.click('#btn-save');
  await page.fill('#save-name', 'Partie e2e');
  await page.press('#save-name', 'Enter');
  await page.waitForTimeout(1500);
  const saved = await send('save', { slot: 'cmp' });
  check(saved.ok, 'état de référence lu');
  const ref = strip(saved.r.data);
  const listed = await page.evaluate(() => [...document.querySelectorAll('#save-list .slot .name')].map((e) => e.textContent));
  check(listed.some((t) => t.includes('partie-e2e')), `emplacement listé dans l'interface (${listed.join(', ')})`);
  check(await page.evaluate(() => window.__aube.saveStoreKind) === 'indexeddb', 'sauvegarde stockée dans IndexedDB');

  // Rechargement de la page, puis chargement depuis le menu.
  await page.goto(`${base}/index.html?norender`);
  await page.waitForFunction(() => window.__aube?.ready === true, null, { timeout: 300000 });
  await page.click('#btn-load');
  await page.waitForSelector('#load-list .slot');
  const row = page.locator('#load-list .slot', { hasText: 'partie-e2e' });
  await row.locator('button.primary').click();
  await page.waitForFunction(() => window.__aube.snapshotReceived, null, { timeout: 120000 });
  await page.evaluate(() => window.__aube.send('setSpeed', { speed: 0 }));
  const after = await page.evaluate(() => window.__aube.send('save', { slot: 'cmp' }));
  const got = strip(after.data);
  check(JSON.stringify(got.buildings) === JSON.stringify(ref.buildings), `bâtiments identiques après rechargement (${got.buildings.length})`);
  check(JSON.stringify(got.roads) === JSON.stringify(ref.roads), `routes identiques (${got.roads.edges.length} tronçons, courbes comprises)`);
  check(got.money === ref.money, `trésorerie identique (${got.money})`);
  check(Math.abs(got.minutes - ref.minutes) <= 4, `date identique (${ref.minutes} -> ${got.minutes} min)`);
  check(got.pop === ref.pop, `population identique (${got.pop})`);
  await page.evaluate(() => window.__aube.renderNow(2));
  await page.screenshot({ path: join(out, 'jeu-recharge.png'), timeout: 600000 });
  check(errors.length === 0, `aucune erreur de page${errors.length ? ' : ' + errors.slice(0, 5).join(' | ') : ''}`);
  await ctx.close();

  // iPhone 13 émulé : gestes tactiles par CDP.
  const ip = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
  const p2 = await ip.newPage();
  const errs2 = collectErrors(p2);
  await p2.goto(`${base}/index.html?autostart&seed=7&norender`);
  await p2.waitForFunction(() => window.__aube?.ready && window.__aube.snapshotReceived, null, { timeout: 300000 });
  await p2.evaluate(() => window.__aube.renderNow(2));
  await p2.screenshot({ path: join(out, 'iphone-partie.png'), timeout: 600000 });
  const cdp = await ip.newCDPSession(p2);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i + 1, radiusX: 4, radiusY: 4, force: 1 })) });
  // Pincer (écarter les doigts = zoom avant).
  const cy = 450;
  await touch('touchStart', [[150, cy], [240, cy]]);
  for (let k = 1; k <= 10; k++) { await touch('touchMove', [[150 - k * 9, cy], [240 + k * 9, cy]]); await p2.waitForTimeout(30); }
  await touch('touchEnd', []);
  await p2.evaluate(() => window.__aube.renderNow(4, 0.5)); // amortissement de la caméra
  const camAfterPinch = await p2.evaluate(() => window.__aube.cameraPose());
  // Glisser à deux doigts vers le haut (inclinaison) puis rotation.
  await touch('touchStart', [[160, 500], [230, 500]]);
  for (let k = 1; k <= 10; k++) { await touch('touchMove', [[160, 500 - k * 12], [230, 500 - k * 12]]); await p2.waitForTimeout(30); }
  await touch('touchEnd', []);
  await p2.evaluate(() => window.__aube.renderNow(4, 0.5));
  const camAfterTilt = await p2.evaluate(() => window.__aube.cameraPose());
  console.log(`     iPhone : après pincer ${JSON.stringify(camAfterPinch)} ; après glisser ${JSON.stringify(camAfterTilt)}`);
  check(camAfterPinch.distance < 400, `pincer = zoom (distance 420 -> ${camAfterPinch.distance.toFixed(0)} m)`);
  check(Math.abs(camAfterTilt.pitch - camAfterPinch.pitch) > 0.05 || Math.hypot(camAfterTilt.targetX - camAfterPinch.targetX, camAfterTilt.targetZ - camAfterPinch.targetZ) > 2,
    'glisser à deux doigts = inclinaison ou déplacement');
  await p2.screenshot({ path: join(out, 'iphone-gestes.png'), timeout: 600000 });
  const btnSizes = await p2.evaluate(() => [...document.querySelectorAll('#hud button')].filter((b) => b.offsetParent).map((b) => Math.min(b.getBoundingClientRect().width, b.getBoundingClientRect().height)));
  check(btnSizes.length > 0 && Math.min(...btnSizes) >= 40, `boutons tactiles ≥ 40 px (min ${Math.min(...btnSizes).toFixed(0)})`);
  check(errs2.length === 0, `iPhone : aucune erreur de page${errs2.length ? ' : ' + errs2.slice(0, 3).join(' | ') : ''}`);
  await ip.close();
} catch (e) {
  console.error('ÉCHEC', e);
  failed = true;
} finally {
  await browser.close();
  server.close();
}
console.log(failed ? '\nPARCOURS DE JEU : ÉCHEC' : '\nPARCOURS DE JEU : SUCCÈS');
process.exit(failed ? 1 : 0);
