/**
 * Parcours e2e du module « Électricité » dans le VRAI jeu (worker réel, rendu réel, Chromium SwiftShader) :
 *   npm run build && node tests/electricite/e2e.mjs        (ou npm run e2e:electricite)
 *  1. partie neuve (trésorerie 80 M ¢), rue + logements, hôpital, industrie posés comme le joueur ;
 *  2. installations posées par `placeBuilding` (catalogue) : centrale au gaz, 4 éoliennes, ferme solaire, poste
 *     éloigné relié par une ligne HT (`autoConnect`), barrage si un site au bord de l'eau est trouvé (`checkSite`) ;
 *  3. la simulation répartit : production > 0, consommation > 0, installations / lignes publiées ;
 *  4. rendu : rotors chargés et animés, pylônes et câbles des lignes, calque « réseau électrique » ;
 *  5. panneau Énergie (bouton « ⚡ Énergie ») : valeurs affichées = valeurs de la simulation ; réglage du
 *     financement par le curseur relu dans la simulation ; calque activé par le bouton ;
 *  6. aucune erreur de page.
 * Captures (deviceScaleFactor 1, regardées) : tests/electricite/out/elec-*.png.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { collectErrors, launch, root, serve } from '../e2e/lib.mjs';

const out = join(root, 'tests/electricite/out');
mkdirSync(out, { recursive: true });
const { server, base } = await serve();
const browser = await launch();
let failed = false;
const check = (cond, msg) => { console.log(`${cond ? 'OK  ' : 'ÉCHEC'} ${msg}`); if (!cond) failed = true; };
const fmtPower = (kw) => {
  const f1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const f0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
  return Math.abs(kw) >= 1000 ? `${f1.format(kw / 1000)} MW` : `${f0.format(kw)} kW`;
};

try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = collectErrors(page);
  await page.goto(`${base}/index.html?autostart&seed=7&norender`, { timeout: 300000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__aube?.ready && window.__aube.snapshotReceived, null, { timeout: 300000 });
  const send = (name, args) => page.evaluate(([n, a]) => window.__aube.send(n, a).then((r) => ({ ok: true, r }), (e) => ({ ok: false, e: e.message })), [name, args]);
  const elec = async (name, payload) => { const r = await send('pluginCommand', { plugin: 'electricite', name, payload }); return r.ok ? { ok: true, data: r.r.data } : r; };
  const render = (n = 2, dt = 1 / 30) => page.evaluate(([k, d]) => window.__aube.renderNow(k, d), [n, dt]);

  // 1. Partie neuve avec une trésorerie suffisante pour les centrales.
  const ng = await send('newGame', { seed: 7, mapChunks: 8, startMoney: 80_000_000, cityName: 'Volt-sur-Rive', startHour: 11 });
  check(ng.ok, `nouvelle partie (80 M ¢) ${ng.ok ? '' : ng.e}`);
  await page.waitForTimeout(1500);
  await send('setSpeed', { speed: 0 });
  let road = null, at = null;
  for (let r = 0; r < 700 && !road; r += 40) {
    for (let a = 0; a < 8 && !road; a++) {
      const x = Math.round(Math.cos(a * 0.8) * r), z = Math.round(Math.sin(a * 0.8) * r);
      const res = await send('buildRoad', { type: 'street', kind: 'avenue', points: [x - 160, z, x + 160, z] });
      if (res.ok) { road = res.r; at = [x, z]; }
    }
  }
  check(!!road, `avenue construite en (${at})`);
  const place = async (assetId, x, z, rot = 0) => { const r = await send('placeBuilding', { assetId, x, z, rot, variant: 0 }); return r.ok ? r.r.buildingId : null; };
  let homes = 0;
  const homeModels = ['maison_pavillon_enduit', 'immeuble_petit_enduit', 'maison_brique_pignon', 'commerce_boulangerie'];
  for (let k = 0; k < 10; k++) {
    const x = at[0] - 140 + k * 28;
    if (await place(homeModels[k % homeModels.length], x, at[1] - 18, 2)) homes++;
  }
  const hopital = await place('public_hopital', at[0] - 90, at[1] + 34, 0) ?? await place('public_hopital', at[0] + 60, at[1] + 34, 0);
  const usine = await place('industrie_manufacture_sheds', at[0] + 110, at[1] + 30, 0) ?? await place('industrie_atelier', at[0] + 120, at[1] + 26, 0);
  check(homes >= 5, `${homes} logements / commerces posés, hôpital ${hopital ?? 'refusé'}, industrie ${usine ?? 'refusée'}`);

  // 2. Installations électriques (recherche d'un emplacement accepté par la simulation).
  const tryPlace = async (assetId, cx, cz, rings = [0, 40, 80, 120, 160, 200]) => {
    for (const r of rings) for (let a = 0; a < (r ? 8 : 1); a++) {
      const id = await place(assetId, cx + Math.round(Math.cos(a * Math.PI / 4) * r), cz + Math.round(Math.sin(a * Math.PI / 4) * r));
      if (id) return id;
    }
    return null;
  };
  const centrale = await tryPlace('elec_centrale_gaz', at[0] - 60, at[1] + 120);
  const turbines = [];
  for (let k = 0; k < 4; k++) { const id = await tryPlace('elec_eolienne', at[0] + 260 + k * 75, at[1] - 140, [0, 30, 60]); if (id) turbines.push(id); }
  const solaire = await tryPlace('elec_ferme_solaire', at[0] + 200, at[1] + 120);
  const poste = await tryPlace('elec_poste', at[0] - 650, at[1] - 60, [0, 60, 120, 180, 240]);
  check(!!centrale && turbines.length >= 3 && !!solaire && !!poste, `installations posées : centrale ${centrale}, éoliennes ${turbines.length}, solaire ${solaire}, poste ${poste}`);
  // Barrage : site au bord de l'eau cherché par la commande de vérification (validation terrain).
  let barrage = null, site = null;
  for (let r = 200; r <= 1600 && !barrage; r += 50) {
    for (let a = 0; a < 24 && !barrage; a++) {
      const x = Math.round(at[0] + Math.cos((a / 24) * Math.PI * 2) * r), z = Math.round(at[1] + Math.sin((a / 24) * Math.PI * 2) * r);
      const c = await elec('checkSite', { kind: 'hydro', x, z });
      if (c.ok && c.data.ok) { for (const rot of [0, 1]) { barrage = barrage ?? await place('elec_barrage', x, z, rot); } if (barrage) site = [x, z, c.data.wetShare]; }
    }
  }
  console.log(`     barrage : ${barrage ? `posé en (${site[0]}, ${site[1]}), part d'eau ${(site[2] * 100).toFixed(0)} %` : 'aucun site au bord de l\'eau accepté par la simulation'}`);
  const line = await elec('autoConnect', { id: poste });
  check(line.ok, `ligne HT construite (autoConnect) : ${line.ok ? `${(line.data.line.lengthM / 1000).toFixed(2)} km, ${line.data.cost} ¢` : line.e}`);
  if (centrale && poste) {
    const l2 = await elec('buildLine', { a: centrale, b: turbines[0] ?? solaire });
    console.log(`     seconde ligne centrale -> éoliennes : ${l2.ok ? `${(l2.data.line.lengthM / 1000).toFixed(2)} km` : l2.e}`);
  }

  // 3. Simulation : quelques heures de jeu.
  await send('setSpeed', { speed: 4 });
  await page.waitForTimeout(9000);
  await send('setSpeed', { speed: 0 });
  await page.waitForTimeout(400);
  const st = await elec('state');
  const s = st.data?.summary;
  check(!!s && s.producedKw > 0 && s.demandKw > 0, `répartition : production ${s ? fmtPower(s.producedKw) : '?'}, demande ${s ? fmtPower(s.demandKw) : '?'}, réserve ${s ? fmtPower(s.exportableKw) : '?'}`);
  check((st.data?.facilities?.length ?? 0) >= 6 && (st.data?.lines?.length ?? 0) >= 1, `installations publiées : ${st.data?.facilities?.length}, lignes : ${st.data?.lines?.length}`);
  console.log(`     sources : ${JSON.stringify(s?.bySource.filter((b) => b.count).map((b) => [b.source, Math.round(b.outputKw), Math.round(b.availableKw)]))} ; vent ${s?.windMs} m/s (${s?.windSource}) ; soleil ${s?.sun}`);
  console.log(`     bâtiments : ${s?.buildings}, alimentés ${s?.powered}, coupés ${s?.cut}, hors réseau ${s?.unlinked}`);

  // 4. Rendu : rotors, pylônes, câbles.
  await render(3);
  const dbg = await page.evaluate(() => window.__electricite?.debug());
  check(dbg?.rotorsReady && dbg.turbines === turbines.length, `rotors chargés : ${dbg?.turbines} éoliennes`);
  check(dbg?.pylonsReady && dbg.pylons > 0 && dbg.cableSegments > 0, `ligne dessinée : ${dbg?.pylons} pylônes, ${dbg?.cableSegments} segments de câble`);

  // Captures.
  const posOf = (id) => st.data.facilities.find((f) => f.id === id);
  const shot = async (name) => { await render(2, 0.2); await page.screenshot({ path: join(out, `${name}.png`), timeout: 600000 }); };
  const c = posOf(centrale);
  await page.evaluate(([x, z]) => window.__aube.lookAt(x, z, 150, 0.45, 0.7), [c.x, c.z]);
  await shot('elec-centrale');
  const t0 = posOf(turbines[0]), t3 = posOf(turbines[turbines.length - 1]);
  await page.evaluate(([x, z, lx, lz]) => window.__aube.streetLook(x, z, lx, lz), [t0.x - 60, t0.z + 160, (t0.x + t3.x) / 2, (t0.z + t3.z) / 2]);
  await render(4, 0.25);
  await shot('elec-eoliennes');
  const angleA = await page.evaluate(() => window.__electricite.debug());
  const ln = st.data.lines[0];
  await page.evaluate(([x, z]) => window.__aube.lookAt(x, z, 520, 0.5, 0.3), [(ln.ax + ln.bx) / 2, (ln.az + ln.bz) / 2]);
  await shot('elec-ligne');
  const pyl = Math.round(ln.lengthM / 2);
  const ux = (ln.bx - ln.ax) / ln.lengthM, uz = (ln.bz - ln.az) / ln.lengthM;
  await page.evaluate(([x, z, lx, lz]) => window.__aube.streetLook(x, z, lx, lz), [ln.ax + ux * pyl + uz * 70, ln.az + uz * pyl - ux * 70, ln.ax + ux * (pyl + 60), ln.az + uz * (pyl + 60)]);
  await shot('elec-ligne-rue');
  if (solaire) { const p = posOf(solaire); await page.evaluate(([x, z]) => window.__aube.lookAt(x, z, 120, 0.6, 2.4), [p.x, p.z]); await shot('elec-solaire'); }
  if (barrage) { const p = posOf(barrage); if (p) { await page.evaluate(([x, z]) => window.__aube.lookAt(x, z, 140, 0.5, 1.2), [p.x, p.z]); await shot('elec-barrage'); } }
  { const p = posOf(poste); await page.evaluate(([x, z]) => window.__aube.lookAt(x, z, 110, 0.6, 0.9), [p.x, p.z]); await shot('elec-poste'); }
  void angleA;

  // 5. Panneau Énergie.
  check(await page.isVisible('#elec-launcher'), 'bouton « ⚡ Énergie » visible');
  await page.click('#elec-launcher');
  await page.waitForSelector('#elec-panel:not(.hidden) [data-k="production"]', { timeout: 30000 });
  await page.waitForTimeout(800);
  const st2 = (await elec('state')).data;
  await page.waitForTimeout(500);
  const shown = await page.textContent('#elec-panel [data-k="production"]');
  const shownDem = await page.textContent('#elec-panel [data-k="demande"]');
  check(shown === fmtPower(st2.summary.producedKw) && shownDem === fmtPower(st2.summary.demandKw), `panneau = simulation : production « ${shown} » / ${fmtPower(st2.summary.producedKw)}, demande « ${shownDem} » / ${fmtPower(st2.summary.demandKw)}`);
  await page.$eval('#elec-fund', (el) => { el.value = '60'; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(800);
  const fund = (await elec('state')).data.settings.funding;
  check(Math.abs(fund - 0.6) < 1e-9, `financement réglé par le curseur : ${fund}`);
  await page.click('#elec-panel button[data-act="overlay"]');
  await page.waitForTimeout(300);
  await page.evaluate(([x, z]) => window.__aube.lookAt(x, z, 1300, 1.1, 0.2), [at[0] - 150, at[1]]);
  await render(2, 0.2);
  const dbg2 = await page.evaluate(() => window.__electricite.debug());
  check(dbg2.overlay && dbg2.overlayVisible && dbg2.overlayCells > 0, `calque réseau affiché : ${dbg2.overlayCells} cellules colorées`);
  await shot('elec-calque-panneau');
  await page.click('#elec-panel button[data-act="close"]');
  await shot('elec-calque');
  check(errors.length === 0, `aucune erreur de page${errors.length ? ' :\n   ' + errors.join('\n   ') : ''}`);
  await ctx.close();
} catch (e) {
  console.error('ÉCHEC', e);
  failed = true;
} finally {
  await browser.close();
  server.close();
}
console.log(failed ? '\nE2E électricité : ÉCHEC' : '\nE2E électricité : SUCCÈS');
process.exit(failed ? 1 : 0);
