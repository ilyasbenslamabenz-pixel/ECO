/**
 * Captures de la vue « eau » dans le VRAI jeu (dist/, Chromium SwiftShader) : nouvelle partie (graine 1234, rivières),
 * bourg riverain construit par les commandes du joueur (rue, logements, station de pompage, usine, château d'eau,
 * émissaire SANS station d'épuration), deux jours de jeu à x16, puis panneau « Eau & égouts » ouvert et calques
 * Surface / Desserte / Pression / Pollution. Échoue sur erreur de page, service inactif ou image quasi uniforme.
 *   npm run build && node tests/eau/capture.mjs      -> tests/eau/out/*.png + rapport.json
 * Les images DOIVENT être regardées.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { collectErrors, launch, root, serve } from '../e2e/lib.mjs';

const out = join(root, 'tests/eau/out');
mkdirSync(out, { recursive: true });
const { server, base } = await serve();
const browser = await launch();
const failures = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = collectErrors(page);

try {
  await page.goto(`${base}/index.html?autostart&norender&h=11`);
  await page.waitForFunction(() => window.__aube?.ready === true && window.__aube.snapshotReceived, null, { timeout: 300000 });
  const report = await page.evaluate(async () => {
    const a = window.__aube;
    const send = (n, args) => a.send(n, args);
    await send('setSpeed', { speed: 0 });
    await send('newGame', { seed: 1234, mapChunks: 4, startMoney: 500000000, cityName: 'Riviera (eau)', startHour: 11, terrain: { hydrology: 'aucune', rivers: 0.6 } });
    await new Promise((r) => setTimeout(r, 1500));
    const cat = await (await fetch('./assets/catalog.json')).json();
    const byId = new Map(cat.assets.map((x) => [x.id, x]));
    const log = [];
    await send('buildRoad', { type: 'street', points: [-352, 240, -168, 240] });
    await send('buildRoad', { type: 'street', points: [-352, 240, -352, 168] });
    // Logements au nord de la rue (façade vers la rue).
    const houses = cat.assets.filter((x) => (x.category === 'house' || x.category === 'townhouse') && x.footprint.tilesX <= 2 && x.footprint.tilesZ <= 2);
    let x = -344, k = 0, nHouses = 0;
    while (x < -180 && k < 60) {
      const h = houses[k % houses.length];
      const w = h.footprint.tilesX * 8, d = h.footprint.tilesZ * 8;
      try { await send('placeBuilding', { assetId: h.id, x: x + w / 2, z: 240 - 8 - d / 2, rot: 0 }); nHouses++; x += w + 2; } catch { x += 8; }
      k++;
    }
    log.push(`logements : ${nHouses}`);
    // Installations au sud (côté rivière) : premier emplacement accepté.
    const tryPlace = async (id, xs, zs, rot) => {
      const as = byId.get(id);
      for (const z of zs) for (const xx of xs) {
        try { const r = await send('placeBuilding', { assetId: id, x: xx, z: z + (as.footprint.tilesZ * 8) / 2, rot }); return { id, x: xx, z, b: r.buildingId }; } catch { /* suivant */ }
      }
      return { id, error: 'aucun emplacement' };
    };
    const range = (a0, a1, s) => { const o = []; for (let v = a0; v <= a1; v += s) o.push(v); return o; };
    log.push(await tryPlace('eau_emissaire', range(-344, -200, 8), [248, 252, 256], 2));
    log.push(await tryPlace('eau_station_pompage', range(-320, -176, 8), [248, 252, 256], 2));
    log.push(await tryPlace('eau_usine_potabilisation', range(-320, -176, 8), [248, 252, 256, 260], 2));
    log.push(await tryPlace('eau_chateau_eau', range(-360, -160, 8), [168, 176, 184, 192, 248, 252], 2));
    await send('setSpeed', { speed: 16 });
    return log;
  });
  console.log(JSON.stringify(report, null, 1));
  // Deux jours de jeu, arrêt en plein jour (11 h – 15 h) pour des images lisibles.
  await page.waitForFunction(() => { const l = window.__aube.eau?.last(); if (!l) return false; const h = (l.balance.at / 60) % 24; return l.balance.at > 2 * 1440 && h >= 11 && h <= 15; }, null, { timeout: 900000, polling: 200 });
  await page.evaluate(() => window.__aube.send('setSpeed', { speed: 0 }));
  const last = await page.evaluate(() => window.__aube.eau.last());
  writeFileSync(join(out, 'rapport.json'), JSON.stringify({ construction: report, ...last }, null, 2));
  console.log('bilan', JSON.stringify(last.balance));
  if (!(last.balance.buildings > 0)) failures.push('aucun bâtiment desservable');
  if (!(last.balance.riverPollutionMax > 1)) failures.push(`pollution aval non visible (${last.balance.riverPollutionMax})`);
  await page.evaluate(() => { window.__aube.lookAt(-262, 236, 330, 0.95, 0.35); window.__aube.eau.open(true); });
  for (const mode of ['off', 'desserte', 'pression', 'pollution']) {
    if (mode === 'pollution') await page.evaluate(() => window.__aube.lookAt(-300, 330, 520, 1.05, 0.35));
    await page.evaluate((m) => { window.__aube.eau.setMode(m); }, mode);
    await page.evaluate(() => window.__aube.renderNow(3));
    const file = join(out, `eau-${mode}.png`);
    await page.screenshot({ path: file, type: 'png' });
    const st = await sharp(file).stats();
    const sd = st.channels.slice(0, 3).reduce((s, c) => s + c.stdev, 0) / 3;
    const stats = await page.evaluate(() => window.__aube.eau.stats());
    console.log(`${mode} : écart-type ${sd.toFixed(1)} ; calque ${JSON.stringify(stats)}`);
    if (sd < 10) failures.push(`${mode} : image quasi uniforme`);
    if (mode !== 'off' && !(stats.visible && stats.pipes > 0 && stats.buildings > 0 && stats.riverCells > 0)) failures.push(`${mode} : calque vide`);
  }
  // Vue rapprochée des modèles (surface).
  await page.evaluate(() => { window.__aube.eau.open(false); window.__aube.lookAt(-262, 262, 130, 0.6, 0.5); window.__aube.renderNow(3); });
  await page.screenshot({ path: join(out, 'eau-modeles.png'), type: 'png' });
  if (errors.length) failures.push(`erreurs de page : ${errors.join(' | ')}`);
} catch (e) {
  failures.push(String(e?.stack ?? e));
} finally {
  await browser.close();
  server.close();
}
if (failures.length) { console.error(`ÉCHEC :\n- ${failures.join('\n- ')}`); process.exit(1); }
console.log('Captures eau : SUCCÈS (tests/eau/out/) — à regarder.');
