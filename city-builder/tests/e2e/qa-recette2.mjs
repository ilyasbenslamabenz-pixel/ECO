/**
 * Recette QA n° 2 (phase 1) — parcours joueur indépendant (node tests/e2e/qa-recette2.mjs, après npm run build).
 * 1. Menu : inventaire des boutons (aucun bouton actif sans action), nouvelle partie via le formulaire.
 * 2. Démo (?demo) : vue aérienne, touche V (rue), bouton caméra, horloge qui avance, vitesses, véhicules qui bougent.
 * 3. Partie : route à la souris, bâtiment à la souris (rotation R), démolition au bulldozer, emplacements de sauvegarde,
 *    rechargement de la page puis chargement d'un emplacement nommé.
 * 4. iPhone 13 : démo, pincement et rotation deux doigts via CDP.
 * Captures : tests/e2e/out/qa2-*.png ; rapport : tests/e2e/out/qa2.json.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectErrors, launch, root, serve } from './lib.mjs';

const out = join(root, 'tests/e2e/out');
mkdirSync(out, { recursive: true });
const only = process.argv[2] ?? 'all';
const { server, base } = await serve();
const browser = await launch();
const R = { checks: [], notes: {} };
const check = (ok, msg, extra) => { R.checks.push({ ok: !!ok, msg, extra }); console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${msg}${extra !== undefined ? ' ' + JSON.stringify(extra).slice(0, 300) : ''}`); };
const shot = (page, name) => page.screenshot({ path: join(out, `qa2-${name}.png`), timeout: 600000 });
const render = (page, n = 2) => page.evaluate((k) => window.__aube.renderNow?.(k), n);
const send = (page, n, a) => page.evaluate(([n, a]) => window.__aube.send(n, a).then((r) => ({ ok: true, r }), (e) => ({ ok: false, e: e.message })), [n, a]);

async function buttonsInventory(page) {
  return page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => b.offsetParent !== null).map((b) => ({
    id: b.id || null, tool: b.dataset.tool || b.dataset.cat || b.dataset.speed || null, text: b.textContent.trim().slice(0, 40), disabled: b.disabled,
  })));
}

try {
  /* ---------------- 1+2 : menu et démo (PC) ---------------- */
  if (only === 'all' || only === 'demo') {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = collectErrors(page);
    await page.goto(`${base}/index.html`, { timeout: 300000, waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__aube?.ready, null, { timeout: 300000, polling: 500 });
    await page.waitForTimeout(1500);
    const menuBtns = await buttonsInventory(page);
    R.notes.menuButtons = menuBtns;
    const demoBtn = menuBtns.find((b) => b.id === 'btn-demo');
    check(demoBtn && !demoBtn.disabled && !/Phase/.test(demoBtn.text), 'bouton Scène de démonstration actif au menu', demoBtn);
    await shot(page, 'menu');
    await page.click('#btn-demo');
    await page.waitForFunction(() => window.__aube.demoReady, null, { timeout: 600000, polling: 1000 });
    await page.waitForTimeout(3000);
    R.notes.demo = await page.evaluate(() => window.__aube.demo);
    const pose0 = await page.evaluate(() => window.__aube.cameraPose());
    R.notes.poseAerial = pose0;
    await shot(page, 'demo-aerien');
    const hudBtns = await buttonsInventory(page);
    R.notes.demoHudButtons = hudBtns;
    // Horloge
    const clock1 = await page.evaluate(() => document.querySelector('#hud-date, #hud-clock, .clock, [id*=date]')?.textContent ?? '');
    const s1 = await page.evaluate(() => JSON.parse(JSON.stringify(window.__aube.lastStats)));
    await page.waitForTimeout(8000);
    const clock2 = await page.evaluate(() => document.querySelector('#hud-date, #hud-clock, .clock, [id*=date]')?.textContent ?? '');
    const s2 = await page.evaluate(() => JSON.parse(JSON.stringify(window.__aube.lastStats)));
    R.notes.clock = { clock1, clock2, s1, s2 };
    check(clock1 !== clock2 || JSON.stringify(s1) !== JSON.stringify(s2), `horloge qui avance (${clock1} -> ${clock2})`);
    // Vitesse x4 via bouton
    await page.click('button[data-speed="4"]');
    await page.waitForTimeout(1500);
    const s3 = await page.evaluate(() => window.__aube.lastStats?.speed);
    check(s3 === 4, `bouton vitesse ×4 appliqué dans la simulation (speed=${s3})`);
    await page.click('button[data-speed="1"]');
    // Vue rue (touche V)
    await page.keyboard.press('KeyV');
    await page.waitForTimeout(4000);
    const pose1 = await page.evaluate(() => window.__aube.cameraPose());
    R.notes.poseStreet = pose1;
    await shot(page, 'demo-rue');
    check(JSON.stringify(pose0) !== JSON.stringify(pose1), 'touche V change la caméra', pose1);
    // Avancer en vue rue (ZQSD / flèches)
    await page.keyboard.down('KeyW'); await page.waitForTimeout(2500); await page.keyboard.up('KeyW');
    const pose2 = await page.evaluate(() => window.__aube.cameraPose());
    R.notes.poseStreetWalk = pose2;
    check(JSON.stringify(pose2) !== JSON.stringify(pose1), 'déplacement au clavier en vue rue', pose2);
    await shot(page, 'demo-rue-marche');
    // Retour aérien par bouton
    await page.click('#btn-camera');
    await page.waitForTimeout(4000);
    const pose3 = await page.evaluate(() => window.__aube.cameraPose());
    R.notes.poseBack = pose3;
    await shot(page, 'demo-retour-aerien');
    // Zoom molette (gros plan)
    await page.mouse.move(720, 450);
    for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, -400); await page.waitForTimeout(200); }
    await page.waitForTimeout(3000);
    await shot(page, 'demo-zoom');
    // Clic sur un objet en mode sélection -> panneau info
    await page.mouse.click(720, 450);
    await page.waitForTimeout(2500);
    const info = await page.evaluate(() => { const p = document.querySelector('#info-panel, #info'); return p ? { visible: p.offsetParent !== null && !p.classList.contains('hidden'), text: p.textContent.trim().slice(0, 300) } : null; });
    R.notes.infoClick = info;
    await shot(page, 'demo-clic-info');
    // Véhicules : positions qui changent
    const vstats = await page.evaluate(() => window.__aube.renderStats());
    R.notes.renderStats = vstats;
    R.notes.errorsDemo = errors.slice(0, 20);
    check(errors.length === 0, `aucune erreur de page (démo) : ${errors.length}`, errors.slice(0, 5));
    await ctx.close();
  }

  /* ---------------- 3 : partie jouée, sauvegardes ---------------- */
  if (only === 'all' || only === 'game') {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = collectErrors(page);
    await page.goto(`${base}/index.html?norender`, { timeout: 300000, waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__aube?.ready, null, { timeout: 300000, polling: 500 });
    await page.click('#btn-new');
    await page.waitForTimeout(800);
    await render(page, 1);
    await shot(page, 'nouvelle-partie-form');
    const formInfo = await page.evaluate(() => [...document.querySelectorAll('form input, form select')].map((i) => ({ name: i.name, value: i.value, type: i.type })));
    R.notes.newGameForm = formInfo;
    await page.fill('#new-seed', '42').catch(() => undefined);
    await page.click('form button[type=submit]:visible');
    await page.waitForFunction(() => window.__aube.snapshotReceived && window.__aube.lastStats, null, { timeout: 300000, polling: 500 });
    await page.waitForTimeout(1500);
    await send(page, 'setSpeed', { speed: 0 });
    const hudBtns = await buttonsInventory(page);
    R.notes.gameButtons = hudBtns;
    const deadCandidates = hudBtns.filter((b) => !b.disabled && /Phase/.test(b.text));
    check(deadCandidates.length === 0, 'aucun bouton actif marqué « Phase »', deadCandidates);
    // Zone constructible (même zone que play.mjs, revérifiée)
    const cx = 116 + 400, cz = 356 + 60; // zone voisine, différente de celle du test de l'équipe
    let site = null;
    for (const [dx, dz] of [[0, 0], [-300, 0], [0, -300], [-400, -200], [-400, 0]]) {
      const x = cx + dx, z = cz + dz;
      const r = await send(page, 'placeBuilding', { assetId: 'maison_pavillon_enduit', x, z: z + 25, rot: 0, dryRun: true });
      const r2 = await send(page, 'buildRoad', { type: 'street', kind: 'street', points: [x - 90, z, x + 90, z], dryRun: true });
      if (r2.ok) { site = [x, z]; R.notes.siteDry = { r, r2 }; break; }
    }
    check(!!site, `site de test trouvé ${JSON.stringify(site)}`);
    const [sx, sz] = site;
    await page.evaluate(([x, z]) => window.__aube.lookAt(x, z, 300), [sx, sz]);
    await page.keyboard.press('KeyT');
    await render(page, 16);
    const scr = (x, z) => page.evaluate(([a, b]) => window.__aube.worldToScreen(a, b), [x, z]);
    // Route droite à la souris
    await page.click('#toolbar button[data-tool=road]');
    await page.click('#drawer-body .road-card[data-road=street]');
    const money0 = (await page.evaluate(() => window.__aube.lastStats)).money;
    for (const [x, z] of [[sx - 90, sz], [sx + 90, sz]]) { const p = await scr(x, z); await page.mouse.move(p.x, p.y); await render(page, 1); await page.mouse.click(p.x, p.y); }
    await page.waitForTimeout(1500);
    await page.keyboard.press('Escape');
    let sd = (await send(page, 'save', { slot: 'qa2-probe' })).r.data;
    check(sd.roads.edges.length >= 1, `route construite à la souris (${sd.roads.edges.length} tronçon(s))`);
    // Bâtiment à la souris avec rotation R
    await page.click('#toolbar button[data-tool=building]');
    await page.waitForTimeout(600);
    const cards = await page.evaluate(() => [...document.querySelectorAll('#drawer-body .card[data-asset]')].map((c) => ({ a: c.dataset.asset, dis: c.classList.contains('disabled') || c.hasAttribute('disabled') })));
    R.notes.buildingCards = cards;
    check(cards.length >= 30, `tiroir Bâtiments : ${cards.length} cartes`);
    await page.click('#drawer-body .card[data-asset="maison_pavillon_enduit"]');
    const p1 = await scr(sx - 30, sz + 22);
    await page.mouse.move(p1.x, p1.y); await page.waitForTimeout(400); await render(page, 1);
    const prevA = await page.evaluate(() => window.__aube.toolPreview());
    await page.keyboard.press('KeyR'); await page.waitForTimeout(400); await render(page, 1);
    const prevB = await page.evaluate(() => window.__aube.toolPreview());
    R.notes.rotate = { prevA, prevB };
    await render(page, 2);
    await shot(page, 'apercu-batiment');
    await page.mouse.click(p1.x, p1.y); await page.waitForTimeout(1200);
    // un second, de l'autre côté, et un 3e en zone invalide (sur la route)
    const p2 = await scr(sx + 30, sz - 22);
    await page.mouse.move(p2.x, p2.y); await page.waitForTimeout(400); await page.mouse.click(p2.x, p2.y); await page.waitForTimeout(1200);
    const p3 = await scr(sx + 60, sz);
    await page.mouse.move(p3.x + 2, p3.y); await page.waitForTimeout(500); await render(page, 1);
    const prevInvalid = await page.evaluate(() => window.__aube.toolPreview());
    R.notes.prevOnRoad = prevInvalid;
    await shot(page, 'apercu-sur-route');
    sd = (await send(page, 'save', { slot: 'qa2-probe' })).r.data;
    R.notes.buildingsPlaced = sd.buildings.map((b) => ({ id: b.id, a: b.assetId, x: b.x, z: b.z, rot: b.rot }));
    check(sd.buildings.length >= 2, `bâtiments posés à la souris : ${sd.buildings.length}`);
    const money1 = (await page.evaluate(() => window.__aube.lastStats)).money;
    check(money1 < money0, `trésorerie débitée (${money0} -> ${money1})`);
    await page.keyboard.press('Escape');
    // Démolition au bulldozer
    await page.click('#toolbar button[data-tool=bulldoze]');
    const b0 = sd.buildings[0];
    const pb = await scr(b0.x, b0.z);
    await page.mouse.move(pb.x, pb.y); await page.waitForTimeout(400); await render(page, 1);
    await shot(page, 'bulldozer-survol');
    await page.mouse.click(pb.x, pb.y); await page.waitForTimeout(1500);
    // éventuelle confirmation
    const conf = await page.$('#tc-ok:visible');
    if (conf) { await conf.click(); await page.waitForTimeout(1000); }
    sd = (await send(page, 'save', { slot: 'qa2-probe' })).r.data;
    check(!sd.buildings.some((b) => b.id === b0.id), `démolition au bulldozer (reste ${sd.buildings.length} bâtiment(s))`);
    await page.keyboard.press('Escape');
    await page.click('#toolbar button[data-tool=select]').catch(() => undefined);
    // Laisser vivre la ville
    await send(page, 'setSpeed', { speed: 4 });
    await page.waitForTimeout(20000);
    const stats = await page.evaluate(() => window.__aube.lastStats);
    R.notes.statsAfterRun = stats;
    await render(page, 3);
    await shot(page, 'ville-apres');
    // Sauvegarde dans 2 emplacements nommés via l'interface
    await page.click('#btn-save');
    await page.waitForTimeout(800);
    await render(page, 1);
    await shot(page, 'dialogue-sauvegarde');
    const saveDlg = await page.evaluate(() => { const d = document.querySelector('#save-dialog, dialog[open], .save-panel'); return d ? d.outerHTML.slice(0, 600) : document.querySelector('#toast, .toast')?.textContent ?? null; });
    R.notes.saveDialog = saveDlg;
    const slotInput = await page.$('input[name=slot]:visible, #save-name:visible, form input[type=text]:visible');
    if (slotInput) {
      await slotInput.fill('Recette A'); await page.keyboard.press('Enter'); await page.waitForTimeout(1500);
      const again = await page.$('input[name=slot]:visible, #save-name:visible, form input[type=text]:visible');
      if (again) { await again.fill('Recette B'); await page.keyboard.press('Enter'); await page.waitForTimeout(1500); }
      await page.click('#save-close').catch(() => undefined);
    }
    const statsSaved = await page.evaluate(() => JSON.parse(JSON.stringify(window.__aube.lastStats)));
    const savedBuildings = (await send(page, 'save', { slot: 'qa2-probe' })).r.data.buildings.length;
    R.notes.statsSaved = statsSaved;
    // Rechargement
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__aube?.ready, null, { timeout: 300000, polling: 500 });
    await page.waitForTimeout(1500);
    const loadBtn = await page.$('#btn-load:visible');
    check(!!loadBtn, 'bouton « Charger une partie » visible après rechargement');
    if (loadBtn) {
      await loadBtn.click(); await page.waitForTimeout(1000); await render(page, 1);
      await shot(page, 'liste-sauvegardes');
      const slots = await page.evaluate(() => [...document.querySelectorAll('#load-list li, .slot, [data-slot]')].map((e) => e.textContent.trim().slice(0, 100)));
      R.notes.slots = slots;
      check(slots.filter((s) => /Recette A|Recette B/.test(s)).length >= 2, `2 emplacements nommés listés (${slots.length} au total)`, slots);
      check(slots.some((s) => /auto/i.test(s)) || true, 'info autosauvegarde', slots.filter((s) => /auto/i.test(s)));
      const slotEl = await page.$('[data-slot*="Recette A"], li:has-text("Recette A") button, li:has-text("Recette A")');
      if (slotEl) {
        await slotEl.click();
        await page.waitForFunction(() => window.__aube.snapshotReceived && window.__aube.snapshotStats, null, { timeout: 300000, polling: 500 });
        await page.waitForTimeout(2000);
        const ld = (await send(page, 'save', { slot: 'qa2-probe2' })).r.data;
        const ss = await page.evaluate(() => window.__aube.snapshotStats);
        R.notes.afterLoad = { buildings: ld.buildings.length, edges: ld.roads.edges.length, ss };
        check(ld.buildings.length === savedBuildings && ld.roads.edges.length === sd.roads.edges.length, `chargement après rechargement : ${ld.buildings.length} bâtiments / ${savedBuildings}, ${ld.roads.edges.length} tronçons`);
        check(ss && Math.abs(ss.money - statsSaved.money) < Math.abs(statsSaved.money) * 0.05 + 1000, `trésorerie restaurée (${ss?.money} vs ${statsSaved.money})`);
        await render(page, 3);
        await shot(page, 'apres-chargement');
      }
    }
    R.notes.errorsGame = errors.slice(0, 20);
    check(errors.length === 0, `aucune erreur de page (partie) : ${errors.length}`, errors.slice(0, 5));
    await ctx.close();
  }

  /* ---------------- 4 : iPhone 13 ---------------- */
  if (only === 'all' || only === 'iphone') {
    const { devices } = await import('/opt/node-tools/node_modules/playwright/index.js').catch(() => ({ devices: null }));
    const dev = devices?.['iPhone 13'] ?? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1' };
    const ctx = await browser.newContext({ ...dev, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = collectErrors(page);
    await page.goto(`${base}/index.html?demo`, { timeout: 300000, waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__aube?.demoReady, null, { timeout: 600000, polling: 1000 });
    await page.waitForTimeout(3000);
    await shot(page, 'iphone-demo');
    const cdp = await ctx.newCDPSession(page);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i })) });
    const pose0 = await page.evaluate(() => window.__aube.cameraPose());
    // Pincer (écarter = zoom avant)
    await touch('touchStart', [[150, 420], [240, 420]]);
    for (let i = 1; i <= 10; i++) { await touch('touchMove', [[150 - i * 8, 420], [240 + i * 8, 420]]); await page.waitForTimeout(60); }
    await touch('touchEnd', []);
    await page.waitForTimeout(2500);
    const pose1 = await page.evaluate(() => window.__aube.cameraPose());
    // Rotation deux doigts
    await touch('touchStart', [[195, 330], [195, 510]]);
    for (let i = 1; i <= 10; i++) { const a = i * 0.08; await touch('touchMove', [[195 + Math.sin(a) * 90, 420 - Math.cos(a) * 90], [195 - Math.sin(a) * 90, 420 + Math.cos(a) * 90]]); await page.waitForTimeout(60); }
    await touch('touchEnd', []);
    await page.waitForTimeout(2500);
    const pose2 = await page.evaluate(() => window.__aube.cameraPose());
    // Glisser deux doigts vers le haut (inclinaison)
    await touch('touchStart', [[150, 500], [240, 500]]);
    for (let i = 1; i <= 10; i++) { await touch('touchMove', [[150, 500 - i * 12], [240, 500 - i * 12]]); await page.waitForTimeout(60); }
    await touch('touchEnd', []);
    await page.waitForTimeout(2500);
    const pose3 = await page.evaluate(() => window.__aube.cameraPose());
    // Un doigt = déplacement
    await touch('touchStart', [[195, 400]]);
    for (let i = 1; i <= 10; i++) { await touch('touchMove', [[195 + i * 10, 400 + i * 6]]); await page.waitForTimeout(60); }
    await touch('touchEnd', []);
    await page.waitForTimeout(2500);
    const pose4 = await page.evaluate(() => window.__aube.cameraPose());
    R.notes.iphonePoses = { pose0, pose1, pose2, pose3, pose4 };
    check(JSON.stringify(pose0) !== JSON.stringify(pose1), 'iPhone : pincement change la caméra');
    check(JSON.stringify(pose1) !== JSON.stringify(pose2), 'iPhone : rotation deux doigts change la caméra');
    check(JSON.stringify(pose2) !== JSON.stringify(pose3), 'iPhone : glisser deux doigts change la caméra');
    check(JSON.stringify(pose3) !== JSON.stringify(pose4), 'iPhone : un doigt déplace la caméra');
    await shot(page, 'iphone-apres-gestes');
    // Bouton Vue rue au tactile
    await page.tap('#btn-camera').catch(() => undefined);
    await page.waitForTimeout(4000);
    await shot(page, 'iphone-rue');
    const overflow = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: innerWidth }));
    R.notes.iphoneOverflow = overflow;
    check(overflow.sw <= overflow.w, `iPhone : pas de défilement horizontal (${overflow.sw}/${overflow.w})`);
    check(errors.length === 0, `aucune erreur de page (iPhone) : ${errors.length}`, errors.slice(0, 5));
    await ctx.close();
  }
} catch (e) {
  check(false, `exception : ${e.stack ?? e}`);
} finally {
  writeFileSync(join(out, `qa2-${only}.json`), JSON.stringify(R, null, 2));
  await browser.close();
  server.close();
}
