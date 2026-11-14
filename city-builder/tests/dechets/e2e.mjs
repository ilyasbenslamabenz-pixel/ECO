/**
 * Parcours e2e du module « Déchets » dans le VRAI jeu (worker réel, rendu réel SwiftShader), après `npm run build` :
 *   node tests/dechets/e2e.mjs
 *  1. nouvelle partie, avenue + rue, logements et commerces au nord, installations au sud (dépôt, tri, incinérateur,
 *     décharge : modèles GLB du catalogue) ; la ville se peuple, les bacs se remplissent ;
 *  2. collecte lancée : camions-bennes dessinés sur la chaussée (positions = simulation) ;
 *  3. panneau « Déchets » (touche J) : valeurs = commande `etat` de la simulation ; réglage du financement relu ;
 *  4. calque « déchets » (Maj+J) : grille drapée + colonnes de remplissage des bacs ;
 *  5. tumulus de la décharge : état de la décharge porté à 60 % par une SAUVEGARDE MODIFIÉE puis rechargée (montré
 *     comme tel : seule façon de voir un remplissage avancé sans des mois de jeu) ; le tumulus suit le remplissage.
 * Captures (deviceScaleFactor 1, regardées) : tests/dechets/out/*.png ; rapport : tests/dechets/out/rapport.json.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { collectErrors, launch, root, serve } from '../e2e/lib.mjs';

const out = join(root, 'tests/dechets/out');
mkdirSync(out, { recursive: true });
const cat = JSON.parse(readFileSync(join(root, 'dist/assets/catalog.json'), 'utf8'));
const byId = new Map(cat.assets.map((a) => [a.id, a]));
const { server, base } = await serve();
const browser = await launch();
let failed = false;
const report = { checks: [], shots: [] };
const check = (cond, msg, extra) => { console.log(`${cond ? 'OK  ' : 'ÉCHEC'} ${msg}`); report.checks.push({ ok: !!cond, msg }); if (!cond) { failed = true; if (extra !== undefined) console.log('   ', JSON.stringify(extra).slice(0, 600)); } };

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = collectErrors(page);
  await page.goto(`${base}/index.html?autostart&seed=11&norender`, { timeout: 300000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__aube?.ready && window.__aube.snapshotReceived && window.__dechets, null, { timeout: 300000 });
  const send = (name, args) => page.evaluate(([n, a]) => window.__aube.send(n, a).then((r) => ({ ok: true, r }), (e) => ({ ok: false, e: e.message })), [name, args]);
  const cmd = async (name, payload) => { const r = await send('pluginCommand', { plugin: 'dechets', name, payload }); return r.ok ? r.r.data ?? r.r : null; };
  const stats = () => page.evaluate(() => window.__aube.lastStats);
  const shot = async (name, meta = {}) => {
    await page.evaluate(() => window.__aube.renderNow(2, 0.5));
    await page.waitForTimeout(3500);
    await page.evaluate(() => window.__aube.renderNow(3, 0.1));
    const path = join(out, `${name}.png`);
    await page.screenshot({ path, timeout: 900000 });
    const st = await sharp(path).stats();
    const sd = st.channels.slice(0, 3).reduce((a, c) => a + c.stdev, 0) / 3;
    report.shots.push({ file: `${name}.png`, stdev: Math.round(sd * 10) / 10, ...meta });
    check(sd > 10, `${name}.png : image non uniforme (écart-type ${sd.toFixed(1)})`);
  };

  // 1. Partie avec un budget suffisant pour les installations.
  const snapWait = page.evaluate(() => new Promise((res) => { const n0 = window.__aube.deltas; const t = setInterval(() => { if (window.__aube.deltas > n0 + 2) { clearInterval(t); res(true); } }, 200); }));
  const ng = await send('newGame', { seed: 11, mapChunks: 8, startMoney: 60_000_000, cityName: 'Bourg-Déchets', startHour: 7 });
  check(ng.ok, 'nouvelle partie (60 M ¢)');
  await snapWait;
  await send('setSpeed', { speed: 0 });

  // Site : rue est-ouest dont les deux rives sont sèches (essais `dryRun` de tous les lots AVANT de tracer la rue).
  const north = ['immeuble_petit_enduit', 'immeuble_petit_enduit', 'commerce_boulangerie', 'maison_pavillon_enduit', 'immeuble_petit_enduit', 'maison_brique_pignon', 'immeuble_petit_enduit', 'maison_pavillon_enduit', 'immeuble_petit_enduit'].filter((id) => byId.has(id));
  const south = ['dechets_depot_camions', 'dechets_centre_tri', 'dechets_incinerateur', 'dechets_decharge'];
  const OFF = 9.5; // demi-emprise d'une rue (6,7 m) + marge
  const lots = (x0, z0) => {
    const l = [];
    let x = x0 - 180;
    for (const id of north) { const a = byId.get(id); const w = a.footprint.tilesX * 8, d = a.footprint.tilesZ * 8; l.push({ id, x: x + w / 2, z: z0 - OFF - d / 2, rot: 0 }); x += w + 4; }
    x = x0 - 180;
    for (const id of south) { const a = byId.get(id); const w = a.footprint.tilesX * 8, d = a.footprint.tilesZ * 8; l.push({ id, x: x + w / 2, z: z0 + OFF + d / 2, rot: 2 }); x += w + 6; }
    return l;
  };
  let z0 = null, x0 = null, plan = null;
  for (let r = 0; r < 900 && z0 === null; r += 60) {
    for (let a = 0; a < 10 && z0 === null; a++) {
      const cx = Math.round(Math.cos(a * 0.63) * r), cz = Math.round(Math.sin(a * 0.63) * r);
      const l = lots(cx, cz);
      let ok = true;
      for (const lot of l) { const res = await send('placeBuilding', { assetId: lot.id, x: lot.x, z: lot.z, rot: lot.rot, dryRun: true }); if (!res.ok) { ok = false; break; } }
      if (!ok) continue;
      const rd = await send('buildRoad', { type: 'street', points: [cx - 200, cz, cx + 200, cz] });
      if (rd.ok) { z0 = cz; x0 = cx; plan = l; }
    }
  }
  check(z0 !== null, `rue construite sur un site sec (x0 ${x0}, z0 ${z0})`);
  const fac = {};
  let placedN = 0;
  for (const lot of plan ?? []) {
    const res = await send('placeBuilding', { assetId: lot.id, x: lot.x, z: lot.z, rot: lot.rot });
    if (!res.ok) { console.log(`   refus ${lot.id} : ${res.e}`); continue; }
    if (lot.id.startsWith('dechets_')) fac[lot.id] = { id: res.r.buildingId, x: lot.x, z: lot.z }; else placedN++;
  }
  check(placedN >= 6, `logements et commerces posés au nord : ${placedN}`);
  for (const id of south) check(!!fac[id], `${id} posé`);
  const etat0 = await cmd('etat');
  check(etat0 && etat0.facilities.length === 4 && etat0.facilities.every((f) => f.connected), 'simulation : 4 installations reliées à la route', etat0?.facilities);
  check(etat0 && etat0.fleet === 4, `flotte : ${etat0?.fleet} camions`);

  // La ville se peuple et produit (vitesse ×8). NB : en ×16 sans boucle d'affichage, l'onglet se fige puis plante vers
  // la minute 5 350 de jeu, AUSSI sur la base sans ce module (docs/requests/dechets.md §8) : on reste sous ce seuil.
  await send('setSpeed', { speed: 8 });
  await page.waitForFunction(() => (window.__aube.lastStats?.date?.totalMinutes ?? 0) > 1440 + 9 * 60, null, { timeout: 600000, polling: 1000 });
  await send('setSpeed', { speed: 0 });
  const s1 = await cmd('etat');
  check(s1.producers > 0 && s1.productionPerDay > 0, `production : ${Math.round(s1.productionPerDay)} kg/j, ${s1.producers} producteurs, ${Math.round(s1.storedKg)} kg en attente`);
  const st1 = await stats();
  console.log(`   population ${st1?.population ?? '?'} ; jour ${Math.floor((st1?.date?.totalMinutes ?? 0) / 1440)}`);

  // 2. Collecte : camions sur la chaussée.
  const col = await cmd('collecter');
  check(col && col.tours >= 1, `collecte lancée : ${col?.tours} tournée(s)`);
  await send('setSpeed', { speed: 1 });
  await page.waitForFunction(() => window.__dechets.trucks() > 0, null, { timeout: 120000, polling: 250 });
  await page.waitForTimeout(1500);
  await send('setSpeed', { speed: 0 });
  await page.waitForTimeout(600);
  const pos = await page.evaluate(() => window.__dechets.truckPositions());
  check(pos.length >= 4, `camions dessinés : ${pos.length / 4}`);
  const tx = pos[0], tz = pos[1];
  await page.evaluate(([x, z]) => window.__aube.lookAt(x, z, 45, 0.55, 0.8), [tx, tz]);
  await shot('dechets-camion', { truck: [tx, tz] });
  await page.evaluate(([x, z]) => window.__aube.lookAt(x, z, 230, 0.75, -0.3), [x0 - 60, z0 + 20]);
  await shot('dechets-installations');

  // 3. Panneau « Déchets » (touche J) : valeurs réelles + réglage relu dans la simulation.
  await page.keyboard.press('KeyJ');
  await page.waitForSelector('#dechets-panel .rows', { timeout: 20000 });
  await page.waitForTimeout(800);
  const panelText = await page.evaluate(() => document.getElementById('dechets-panel').innerText);
  const s2 = await cmd('etat');
  check(/production/i.test(panelText) && /filières/i.test(panelText) && /budget/i.test(panelText), 'panneau : sections production, filières, budget');
  check(panelText.includes(`${s2.fleet} · ${s2.activeTrucks}`), `panneau : camions ${s2.fleet} · ${s2.activeTrucks} = simulation`);
  await page.evaluate(() => { const r = document.querySelector('#dechets-panel input[data-reglage="funding"]'); r.value = '50'; r.dispatchEvent(new Event('change')); });
  await page.waitForTimeout(800);
  const s3 = await cmd('etat');
  check(s3.settings.funding === 0.5 && s3.activeTrucks === 2, `réglage financement 50 % relu : ${s3.settings.funding}, ${s3.activeTrucks} camions en service`);
  await page.evaluate(([x, z]) => window.__aube.lookAt(x, z, 260, 0.8, -0.3), [x0 - 60, z0]);
  await shot('dechets-panneau');

  // 4. Calque « déchets ».
  await page.keyboard.press('Shift+KeyJ');
  await page.waitForTimeout(300);
  check(await page.evaluate(() => window.__dechets.layerVisible()), 'calque affiché (Maj+J)');
  await send('setSpeed', { speed: 8 });
  await page.waitForTimeout(4000);
  await send('setSpeed', { speed: 0 });
  const ls = await page.evaluate(() => window.__dechets.layerStats());
  check(ls.bins > 0, `calque : ${ls.bins} colonnes de bacs, ${ls.cells} cellules colorées`);
  await page.keyboard.press('KeyJ'); // ferme le panneau pour la vue du calque
  await page.evaluate(([x, z]) => window.__aube.lookAt(x, z, 330, 0.95, -0.2), [x0 - 40, z0 - 10]);
  await shot('dechets-calque', ls);
  await page.keyboard.press('Shift+KeyJ');

  // 5. Tumulus : décharge portée à 60 % par une sauvegarde modifiée, rechargée par la commande `load`.
  const sv = await send('save', { slot: 'e2e-dechets' });
  check(sv.ok, 'sauvegarde');
  const data = sv.r.data;
  const lf = data.plugins.dechets.data.facilities.find((f) => f.kind === 'decharge');
  lf.stock = lf.capacity * 0.6;
  const ld = await send('load', { data });
  check(ld.ok, 'rechargement de la sauvegarde modifiée (décharge à 60 %)');
  await page.waitForTimeout(1500);
  const ms = await page.evaluate((id) => window.__dechets.moundScale(id), lf.id);
  check(ms !== null && Math.abs(ms - 0.6) < 0.02, `tumulus à l'échelle du remplissage : ${ms}`);
  await page.evaluate(([x, z]) => window.__aube.lookAt(x, z, 120, 0.5, -0.5), [lf.x, lf.z]);
  await shot('dechets-decharge-60', { fill: 0.6 });

  check(errors.length === 0, `aucune erreur de page (${errors.length})`, errors.slice(0, 5));
  const ae = await page.evaluate(() => window.__aube.errors);
  check(ae.length === 0, 'aucune erreur interne', ae.slice(0, 5));
} catch (e) {
  console.error(e);
  failed = true;
} finally {
  writeFileSync(join(out, 'rapport.json'), JSON.stringify(report, null, 2));
  await browser.close();
  server.close();
}
console.log(failed ? 'ÉCHEC' : 'SUCCÈS');
process.exit(failed ? 1 : 0);
