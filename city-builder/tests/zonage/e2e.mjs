/**
 * Parcours e2e du module « Zonage » dans le VRAI jeu (worker réel, rendu réel, Chromium SwiftShader) :
 *   npm run build && node tests/zonage/e2e.mjs        (ou npm run e2e:zonage)
 *  1. partie neuve, petit réseau de rues posé comme le joueur ;
 *  2. onglet « Zones » : tiroir réel (types, Retirer, profondeur, jauge R/C/B/I), superposition visible
 *     seulement avec l'outil ; peinture À LA SOURIS le long des rues (résidentiel faible, dense, commerces,
 *     bureaux, industrie) ; retrait d'une partie ; profondeur réglée par le bouton ;
 *  3. croissance par la simulation qui tourne : des bâtiments du catalogue apparaissent, façade vers la rue
 *     (chantiers s'ils sont actifs) ; jauge = demande de la simulation ;
 *  4. densification (réglages abaissés par la commande `tuning`) : un petit bâtiment remplacé par un plus grand ;
 *  5. sauvegarde / chargement : zones et bâtiments conservés ;
 *  6. iPhone : peinture AU DOIGT (événements tactiles), tiroir dans l'écran ;
 *  7. aucune erreur de page.
 * Captures (regardées) : docs/captures-zonage/*.png.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { collectErrors, launch, root, serve } from '../e2e/lib.mjs';

const out = join(root, 'docs/captures-zonage');
mkdirSync(out, { recursive: true });
const { server, base } = await serve();
const browser = await launch();
let failed = false;
const check = (cond, msg) => { console.log(`${cond ? 'OK  ' : 'ÉCHEC'} ${msg}`); if (!cond) failed = true; };

async function waitGame(page, url) {
  await page.goto(url, { timeout: 300000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__aube?.ready && window.__aube.snapshotReceived, null, { timeout: 300000 });
}

function helpers(page) {
  const send = (name, args) => page.evaluate(([n, a]) => window.__aube.send(n, a).then((r) => ({ ok: true, r }), (e) => ({ ok: false, e: e.message })), [name, args]);
  const zon = async (name, payload) => { const r = await send('pluginCommand', { plugin: 'zonage', name, payload }); return r.ok ? { ok: true, data: r.r.data } : r; };
  const render = (n = 2, dt = 1 / 30) => page.evaluate(([k, d]) => window.__aube.renderNow(k, d), [n, dt]);
  const shot = async (name) => {
    await render(2, 0.2); await page.waitForTimeout(1500); await render(2, 0.2); await page.waitForTimeout(800); await render(1, 0.2);
    await page.screenshot({ path: join(out, `${name}.png`), timeout: 600000 });
  };
  const screen = (x, z) => page.evaluate(([a, b]) => window.__aube.worldToScreen(a, b), [x, z]);
  return { send, zon, render, shot, screen };
}

/** Réseau de rues autour d'un centre constructible : deux rues est-ouest, une rue nord-sud. */
async function buildStreets(send) {
  for (let r = 0; r < 700; r += 40) {
    for (let a = 0; a < 8; a++) {
      const x = Math.round(Math.cos(a * 0.8) * r), z = Math.round(Math.sin(a * 0.8) * r);
      // Vérification à blanc des trois tracés avant de construire.
      const dry = [
        await send('buildRoad', { type: 'street', points: [x - 180, z, x + 180, z], dryRun: true }),
        await send('buildRoad', { type: 'avenue', kind: 'avenue', points: [x - 180, z + 110, x + 180, z + 110], dryRun: true }),
        await send('buildRoad', { type: 'street', points: [x, z - 90, x, z + 200], dryRun: true }),
      ];
      if (!dry.every((d) => d.ok)) continue;
      const ok1 = await send('buildRoad', { type: 'street', points: [x - 180, z, x + 180, z] });
      if (!ok1.ok) continue;
      const ok2 = await send('buildRoad', { type: 'avenue', kind: 'avenue', points: [x - 180, z + 110, x + 180, z + 110] });
      const ok3 = await send('buildRoad', { type: 'street', points: [x, z - 90, x, z + 200] });
      return { x, z, second: ok2.ok, cross: ok3.ok };
    }
  }
  return null;
}

/** Glisser à la souris d'un point du monde à un autre (pas de 6 m). */
async function dragWorld(page, screen, pts) {
  const first = await screen(pts[0][0], pts[0][1]);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (let k = 1; k < pts.length; k++) {
    const [ax, az] = pts[k - 1], [bx, bz] = pts[k];
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 6));
    for (let s = 1; s <= n; s++) {
      const p = await screen(ax + ((bx - ax) * s) / n, az + ((bz - az) * s) / n);
      await page.mouse.move(p.x, p.y);
      await page.waitForTimeout(15);
    }
  }
  await page.mouse.up();
  await page.waitForTimeout(400);
}

const zoneCount = (st) => Object.values(st.stats.cells).reduce((a, b) => a + b, 0);
const builtCount = (st) => Object.values(st.stats.buildings).reduce((a, b) => a + b, 0);

try {
  /* ================================ Bureau ================================ */
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = collectErrors(page);
  await waitGame(page, `${base}/index.html?autostart&seed=7&norender`);
  const { send, zon, render, shot, screen } = helpers(page);
  // Carte sans rivière intérieure : le petit réseau de rues tient d'un seul tenant (aucun pont).
  const ng = await send('newGame', { seed: 7, mapChunks: 8, startMoney: 30_000_000, cityName: 'Zonage-sur-Rive', startHour: 11, terrain: { hydrology: 'aucune', rivers: 0 } });
  check(ng.ok, `nouvelle partie ${ng.ok ? '' : ng.e}`);
  await page.waitForTimeout(1500);
  await send('setSpeed', { speed: 0 });
  const at = await buildStreets(send);
  check(!!at && at.second && at.cross, `rues construites autour de (${at?.x}, ${at?.z})`);
  const [X, Z] = [at.x, at.z];
  const money0 = (await page.evaluate(() => window.__aube.lastStats?.money)) ?? null;

  // Onglet Zones : tiroir réel, superposition invisible tant qu'aucune zone n'existe.
  const btn = await page.evaluate(() => { const b = document.querySelector('#toolbar button[data-cat=zones]'); return { disabled: b.disabled, soon: b.classList.contains('soon'), badge: !!b.querySelector('.phase') }; });
  check(!btn.disabled && !btn.soon && !btn.badge, `bouton Zones actif, sans badge « prévu » (${JSON.stringify(btn)})`);
  await page.evaluate(([x, z]) => window.__aube.lookAt(x, z + 55, 300, 1.05, 0), [X, Z]);
  await render(3);
  await page.click('#toolbar button[data-cat=zones]');
  await page.waitForTimeout(600);
  const drawer = await page.evaluate(() => ({
    zones: [...document.querySelectorAll('#drawer-body [data-zone]')].map((b) => b.dataset.zone),
    depth: [...document.querySelectorAll('#drawer-body [data-depth]')].map((b) => b.dataset.depth),
    gauge: [...document.querySelectorAll('#build-drawer .zn-col')].map((c) => c.dataset.sector).join(''),
    planned: document.querySelectorAll('#drawer-body .tile:disabled').length,
  }));
  check(drawer.zones.join(',') === 'res_faible,res_moyen,res_dense,commerce,bureaux,industrie,retirer', `tiroir Zones : ${drawer.zones.join(', ')}`);
  check(drawer.depth.join('') === '1234' && drawer.gauge === 'RCBI', `profondeur ${drawer.depth.join('/')} · jauge ${drawer.gauge} · ${drawer.planned} zones prévues grisées`);
  check(await page.evaluate(() => window.__zonage.view.toolActive), 'outil Zones actif (gestes capturés)');

  // Peinture à la souris : résidentiel faible au nord de la rue principale (profondeur 3 par défaut).
  await page.click('#drawer-body [data-zone=res_faible]');
  await dragWorld(page, screen, [[X - 170, Z - 4], [X - 15, Z - 4]]);
  await page.click('#drawer-body [data-zone=commerce]');
  await page.click('#drawer-body [data-depth="2"]');
  check(await page.evaluate(() => window.__zonage.view.depth) === 2, 'profondeur réglée à 2 par le bouton');
  await dragWorld(page, screen, [[X + 15, Z - 4], [X + 170, Z - 4]]);
  await page.click('#drawer-body [data-zone=industrie]');
  await page.click('#drawer-body [data-depth="4"]');
  await dragWorld(page, screen, [[X + 15, Z + 110], [X + 170, Z + 110]]);
  await page.click('#drawer-body [data-zone=res_dense]');
  await page.click('#drawer-body [data-depth="3"]');
  await dragWorld(page, screen, [[X - 170, Z + 110], [X - 15, Z + 110]]);
  await page.click('#drawer-body [data-zone=bureaux]');
  await dragWorld(page, screen, [[X, Z + 20], [X, Z + 90]]);
  await page.click('#drawer-body [data-zone=res_moyen]');
  await dragWorld(page, screen, [[X, Z - 85], [X, Z - 20]]);
  await page.waitForTimeout(600);
  let st = (await zon('state')).data;
  const cells0 = zoneCount(st);
  check(cells0 > 100 && Object.values(st.stats.cells).every((n) => n > 0), `zones peintes à la souris : ${JSON.stringify(st.stats.cells)}`);
  check(st.stats.connected === cells0, `toutes les cases peintes sont desservies (${st.stats.connected}/${cells0})`);
  const inst = await page.evaluate(() => ({ n: window.__zonage.instances(), vis: window.__zonage.visible() }));
  check(inst.vis && inst.n === cells0, `superposition visible avec l'outil : ${inst.n} cases dessinées`);
  // Aucune case sur la chaussée.
  const onRoad = await zon('cellAt', { x: X - 100, z: Z });
  check(onRoad.ok && onRoad.data.zone === null, `axe de la rue non zoné (${JSON.stringify(onRoad.data)})`);
  await page.mouse.move(720, 450);
  await shot('zonage-peinture');

  // Retirer : une partie de la bande commerciale.
  await page.click('#drawer-body [data-zone=retirer]');
  await dragWorld(page, screen, [[X + 120, Z - 4], [X + 170, Z - 4]]);
  st = (await zon('state')).data;
  check(zoneCount(st) < cells0 && st.stats.cells.commerce > 0, `retrait du zonage : ${cells0} → ${zoneCount(st)} cases (commerces ${st.stats.cells.commerce})`);
  check(await page.evaluate(() => window.__zonage.instances()) === zoneCount(st), 'superposition à jour après retrait');

  // Jauge = demande de la simulation.
  const gauge = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#build-drawer .zn-col')].map((c) => [c.dataset.sector, Number(c.dataset.value)])));
  const dem = st.demand;
  check(['R', 'C', 'B', 'I'].every((k) => Math.abs(gauge[k] - dem[k]) < 0.05), `jauge R/C/B/I = demande de la simulation ${JSON.stringify(gauge)} / ${JSON.stringify(dem)}`);
  check(dem.R > 0 && dem.I > 0, `ville vide : demande résidentielle et industrielle positives (R ${dem.R.toFixed(2)}, I ${dem.I.toFixed(2)})`);

  // Fermer l'outil : la superposition disparaît.
  await page.click('#drawer-close');
  await page.waitForTimeout(300);
  check(!(await page.evaluate(() => window.__zonage.visible())) && !(await page.evaluate(() => window.__zonage.view.toolActive)), 'outil fermé : superposition masquée, gestes rendus à la caméra');

  // Croissance : la simulation tourne en accéléré (×16) ; les chantiers s'ouvrent puis s'achèvent, les
  // habitants arrivent, les emplois de l'industrie relancent le logement.
  await send('setSpeed', { speed: 16 });
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < 150000) {
    await page.waitForTimeout(3000);
    last = (await zon('state')).data;
    if (builtCount(last) >= 25 && last.stats.residents > 60 && last.stats.jobs > 10) break;
  }
  await send('setSpeed', { speed: 0 });
  await page.waitForTimeout(400);
  st = (await zon('state')).data;
  const date = await page.evaluate(() => window.__aube.lastStats?.date);
  console.log(`     ${Math.round((Date.now() - t0) / 1000)} s réelles, date de jeu ${JSON.stringify(date)} ; demande ${JSON.stringify(st.demand)} ; entrées ${JSON.stringify(st.inputs)}`);
  check(builtCount(st) >= 15, `croissance en jeu : ${builtCount(st)} bâtiments nés du zonage ${JSON.stringify(st.stats.buildings)} · ${st.stats.residents} habitants, ${st.stats.jobs} emplois`);
  check(['res_faible', 'industrie'].every((z) => st.stats.buildings[z] > 0), 'résidentiel et industrie ont poussé');
  const money1 = (await page.evaluate(() => window.__aube.lastStats?.money)) ?? null;
  console.log(`     trésorerie ${money0} → ${money1} (constructions privées : non payées par la ville ; entretien et impôts courants)`);
  await page.evaluate(([x, z]) => window.__aube.lookAt(x, z + 55, 260, 0.95, 0.35), [X, Z]);
  await render(8, 0.5);
  await page.waitForTimeout(2500);
  await shot('zonage-croissance');
  await page.click('#toolbar button[data-cat=zones]');
  await page.waitForTimeout(600);
  await shot('zonage-croissance-calque');
  await page.click('#drawer-close');
  // Vue de rue : maisons alignées, façade côté rue.
  await page.evaluate(([x, z]) => window.__aube.streetLook(x - 40, z + 7, x - 140, z + 7), [X, Z]);
  await render(6, 0.5);
  await page.waitForTimeout(2000);
  await shot('zonage-rue');

  // Densification : réglages abaissés, quelques jours simulés d'un coup.
  const tun = await zon('tuning', { ageMinJours: 0, seuilNiveau2: 0, seuilNiveau3: 0, probaDensification: 1, maxDensificationsParJour: 6, demandeMinDensification: -1 });
  check(tun.ok && tun.data.seuilNiveau2 === 0, 'réglages de densification modifiés (commande tuning)');
  const dn = await zon('grow', { densify: 3 });
  st = (await zon('state')).data;
  check(dn.ok && dn.data.densified > 0 && st.stats.densified > 0, `densification : ${dn.data?.densified} bâtiments remplacés par un plus grand de la même zone`);
  await page.evaluate(([x, z]) => window.__aube.lookAt(x, z + 55, 260, 0.95, 0.35), [X, Z]);
  await render(8, 0.5);
  await page.waitForTimeout(2500);
  await shot('zonage-densification');

  // Sauvegarde / chargement.
  const before = (await zon('state')).data;
  await page.evaluate(() => window.__aube.saveSlot('zonage-e2e'));
  await send('newGame', { seed: 8, mapChunks: 4, startMoney: 1_000_000, cityName: 'Autre' });
  await page.waitForTimeout(800);
  const blank = await zon('state');
  check(blank.ok && zoneCount(blank.data) === 0, 'nouvelle partie : aucune zone');
  await page.evaluate(() => window.__aube.loadSlot('zonage-e2e'));
  await page.waitForTimeout(1500);
  const after = (await zon('state')).data;
  check(JSON.stringify(after.stats.cells) === JSON.stringify(before.stats.cells) && builtCount(after) === builtCount(before),
    `chargement : zones ${zoneCount(after)}/${zoneCount(before)}, bâtiments du zonage ${builtCount(after)}/${builtCount(before)}`);
  check(errors.length === 0, `bureau : aucune erreur de page ${errors.slice(0, 3).join(' | ')}`);
  await ctx.close();

  /* ================================ iPhone ================================ */
  const ip = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
  const p2 = await ip.newPage();
  const e2 = collectErrors(p2);
  await waitGame(p2, `${base}/index.html?autostart&seed=7&norender`);
  const h2 = helpers(p2);
  await h2.send('newGame', { seed: 7, mapChunks: 8, startMoney: 30_000_000, cityName: 'Zonage-Mobile', startHour: 11, terrain: { hydrology: 'aucune', rivers: 0 } });
  await p2.waitForTimeout(1500);
  await h2.send('setSpeed', { speed: 0 });
  const at2 = await buildStreets(h2.send);
  await p2.evaluate(([x, z]) => window.__aube.lookAt(x - 60, z + 20, 220, 1.1, 0), [at2.x, at2.z]);
  await h2.render(3);
  check(await p2.evaluate(() => window.__aube.liteMode === true), 'iPhone : mode allégé actif');
  await p2.tap('#toolbar button[data-cat=zones]');
  await p2.waitForTimeout(500);
  // Glisser au doigt : vrais événements tactiles (protocole DevTools), convertis en pointeurs « touch » par Chromium.
  const pts = [];
  for (let x = at2.x - 170; x <= at2.x - 20; x += 6) pts.push(await h2.screen(x, at2.z - 4));
  const cdp = await ip.newCDPSession(p2);
  const touch = (type, p) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y, id: 1 }] : [] });
  await touch('touchStart', pts[0]);
  for (const p of pts.slice(1)) { await touch('touchMove', p); await p2.waitForTimeout(16); }
  await touch('touchEnd', null);
  await p2.waitForTimeout(800);
  const s2 = (await h2.zon('state')).data;
  check(s2.stats.cells.res_faible > 20, `iPhone : zone peinte au doigt (${s2.stats.cells.res_faible} cases résidentielles)`);
  check(await p2.evaluate(() => window.__zonage.instances() > 0 && window.__zonage.visible()), 'iPhone : superposition visible (instanciée)');
  const fit = await p2.evaluate(() => {
    const W = innerWidth, H = innerHeight, bad = [];
    for (const e of document.querySelectorAll('#build-drawer, #build-drawer *')) {
      const b = e.getBoundingClientRect();
      if (!b.width || !b.height || getComputedStyle(e).visibility === 'hidden') continue;
      let sc = e.parentElement, clipped = false;
      while (sc) { const cs = getComputedStyle(sc); if (/(auto|scroll|hidden)/.test(cs.overflowX)) { clipped = true; break; } sc = sc.parentElement; }
      if (!clipped && (b.left < -0.5 || b.right > W + 0.5 || b.top < -0.5 || b.bottom > H + 0.5)) bad.push(e.className || e.tagName);
    }
    return { bad, docW: document.documentElement.scrollWidth, W };
  });
  check(fit.bad.length === 0 && fit.docW <= fit.W, `iPhone : tiroir Zones dans l'écran ${JSON.stringify(fit)}`);
  await h2.shot('zonage-iphone');
  check(e2.length === 0, `iPhone : aucune erreur ${e2.slice(0, 3).join(' | ')}`);
  await ip.close();
} catch (e) {
  console.error(e);
  failed = true;
} finally {
  await browser.close();
  server.close();
}
console.log(failed ? 'ÉCHEC du parcours zonage' : 'Parcours zonage : tout est vert');
process.exit(failed ? 1 : 0);
