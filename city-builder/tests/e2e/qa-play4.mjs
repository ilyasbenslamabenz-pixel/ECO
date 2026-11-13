/**
 * Recette QA n°4 (fin de phase 1) — joue le jeu construit (dist/) comme un joueur :
 *   A. menu principal -> bouton Démo (pas ?demo) ; bascule vue aérienne / vue rue (bouton puis touche V) ;
 *   B. audit des boutons visibles : chaque bouton actif a une action, chaque bouton désactivé dit « Phase N » ;
 *   C. démo de nuit (?demo&h=0.2) vue aérienne + rue, et démo de jour qui avance jusqu'à la nuit ;
 *   D. nouvelle partie : route, bâtiment (R pour pivoter), démolition, sauvegarde dans 2 emplacements via l'UI,
 *      rechargement de la page, chargement d'un emplacement, autosave présent.
 *   node tests/e2e/qa-play4.mjs (après npm run build) -> tests/e2e/out/qa4-*.png, qa-play4.json
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectErrors, launch, root, serve } from './lib.mjs';

const out = join(root, 'tests/e2e/out');
mkdirSync(out, { recursive: true });
const { server, base } = await serve();
const browser = await launch();
const R = { checks: [], notes: {} };
const check = (ok, msg) => { R.checks.push({ ok: !!ok, msg }); console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${msg}`); };
const shot = (page, name) => page.screenshot({ path: join(out, `qa4-${name}.png`), timeout: 600000 });
const render = (page, n = 2, dt) => page.evaluate(([k, d]) => window.__aube.renderNow(k, d), [n, dt]);
const stats = (page) => page.evaluate(() => window.__aube.lastStats);
const lum = (page) => page.evaluate(() => {
  window.__aube.renderNow(1);
  const c = document.getElementById('scene');
  const g = document.createElement('canvas'); g.width = 160; g.height = 100;
  const x = g.getContext('2d'); x.drawImage(c, 0, 0, 160, 100);
  const d = x.getImageData(0, 10, 160, 80).data; let s = 0;
  for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  return s / (d.length / 4);
});
const sel = process.argv[2] ?? 'ABCD';

try {
  if (sel.includes('A') || sel.includes('B')) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = collectErrors(page);
    await page.goto(`${base}/index.html?norender`, { timeout: 300000, waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__aube?.ready === true, null, { timeout: 300000, polling: 500 });
    await page.waitForTimeout(800);
    await shot(page, 'menu');
    const menuBtns = await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => b.offsetParent).map((b) => ({ id: b.id, t: b.textContent.trim(), dis: b.disabled, title: b.title })));
    R.notes.menuBtns = menuBtns;
    const demoBtn = menuBtns.find((b) => b.id === 'btn-demo');
    check(demoBtn && !demoBtn.dis, `menu : bouton Démo actif (${JSON.stringify(demoBtn)})`);
    await page.click('#btn-demo');
    await page.waitForFunction(() => window.__aube?.demoReady === true || (window.__aube?.errors?.length ?? 0) > 0, null, { timeout: 900000, polling: 1000 });
    await page.evaluate(() => window.__aube.send('setSpeed', { speed: 0 }));
    await render(page, 8, 0.5);
    R.notes.demo = await page.evaluate(() => window.__aube.demo);
    R.notes.demoScene = await page.evaluate(() => window.__aube.sceneCheck());
    check((R.notes.demo?.distinctBuildings ?? 0) >= 30, `démo : ${R.notes.demo?.buildings} bâtiments, ${R.notes.demo?.distinctBuildings} modèles distincts, ${R.notes.demo?.vehicles} véhicules`);
    await shot(page, 'demo-aerien');
    await page.click('#btn-camera');
    await render(page, 8, 0.5);
    const m1 = await page.evaluate(() => window.__aube.cameraPose());
    R.notes.streetPose = m1;
    await shot(page, 'demo-rue-bouton');
    await page.keyboard.press('KeyV');
    await render(page, 8, 0.5);
    const m2 = await page.evaluate(() => window.__aube.sceneCheck().camera);
    await page.keyboard.press('KeyV');
    await render(page, 4, 0.5);
    const m3 = await page.evaluate(() => window.__aube.sceneCheck().camera);
    check(m2 === 'aerial' && m3 === 'street', `bascule caméra bouton + touche V (après bouton : rue, V : ${m2}, V : ${m3})`);
    // Marche en vue rue (touches ZQSD / flèches).
    const p0 = await page.evaluate(() => window.__aube.cameraPose());
    await page.keyboard.down('KeyW'); for (let i = 0; i < 20; i++) await render(page, 1, 0.1); await page.keyboard.up('KeyW');
    const p1 = await page.evaluate(() => window.__aube.cameraPose());
    R.notes.walk = { p0, p1 };
    await render(page, 4, 0.5);
    await shot(page, 'demo-rue-marche');
    // Avance le temps : les véhicules circulent-ils ?
    await page.evaluate(() => window.__aube.send('setSpeed', { speed: 1 }));
    const v0 = await page.evaluate(() => window.__aube.sceneCheck().vehicles);
    await page.waitForTimeout(8000);
    const v1 = await page.evaluate(() => window.__aube.sceneCheck().vehicles);
    R.notes.vehicles = { v0, v1 };
    await page.evaluate(() => window.__aube.setCamera('demo-street'));
    await render(page, 6, 0.5);
    await shot(page, 'demo-rue-trafic');

    // B. Audit des boutons visibles en partie.
    const audit = await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => b.offsetParent).map((b) => ({ id: b.id || b.dataset.tool || b.dataset.cat || b.dataset.speed || b.textContent.trim().slice(0, 20), dis: b.disabled, tip: b.dataset.tip || b.title || '' })));
    R.notes.buttons = audit;
    const badDisabled = audit.filter((b) => b.dis && !/Phase\s*\d/.test(b.tip) && b.id !== 'btn-undo');
    check(badDisabled.length === 0, `boutons désactivés sans « Phase N » : ${JSON.stringify(badDisabled)}`);
    // Chaque bouton actif visible doit avoir un écouteur (sur lui ou délégué à un ancêtre), via CDP.
    const cdp = await ctx.newCDPSession(page);
    const dead = [];
    const { result: arr } = await cdp.send('Runtime.evaluate', { expression: "[...document.querySelectorAll('button')].filter((b) => b.offsetParent && !b.disabled)" });
    const { result: props } = await cdp.send('Runtime.getProperties', { objectId: arr.objectId, ownProperties: true });
    for (const pr of props.filter((x) => /^\d+$/.test(x.name))) {
      let obj = pr.value.objectId, found = false, depth = 0;
      while (obj && depth < 8 && !found) {
        const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: obj });
        if (listeners.some((l) => ['click', 'pointerdown', 'pointerup', 'mousedown', 'touchstart', 'submit'].includes(l.type))) found = true;
        const { result: par } = await cdp.send('Runtime.callFunctionOn', { objectId: obj, functionDeclaration: 'function(){ return this.type === "submit" && this.form ? this.form : this.parentElement; }' });
        obj = par.objectId; depth++;
      }
      if (!found) { const { result: d } = await cdp.send('Runtime.callFunctionOn', { objectId: pr.value.objectId, functionDeclaration: 'function(){ return this.id || this.dataset.tool || this.dataset.cat || this.textContent.trim().slice(0, 20); }', returnByValue: true }); dead.push(d.value); }
    }
    R.notes.deadCandidates = dead;
    check(dead.length === 0, `boutons actifs sans écouteur : ${JSON.stringify(dead)}`);
    R.errorsA = errors;
    check(errors.length === 0, `démo : aucune erreur de page ${errors.slice(0, 4).join(' | ')}`);
    await ctx.close();
  }

  if (sel.includes('C')) {
    // Nuit à 00:10 via ?demo&h=0.17, puis démo de jour accélérée jusqu'à la nuit.
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const errors = collectErrors(page);
    await page.goto(`${base}/index.html?demo&h=22.5&norender`, { timeout: 600000, waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__aube?.demoReady === true || (window.__aube?.errors?.length ?? 0) > 0, null, { timeout: 900000, polling: 1000 });
    await page.evaluate(() => window.__aube.send('setSpeed', { speed: 0 }));
    await render(page, 6, 0.5);
    const d0 = await page.textContent('#hud-date');
    const l0 = await lum(page);
    await shot(page, 'nuit-2230-aerien');
    // Laisse tourner en ×4 pour franchir minuit avec le rendu actif.
    await page.evaluate(() => window.__aube.send('setSpeed', { speed: 4 }));
    let d1 = d0;
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(3000);
      await render(page, 2, 0.5);
      d1 = await page.textContent('#hud-date');
      if (/\b0[0-1]:\d\d/.test(d1)) break;
    }
    await page.evaluate(() => window.__aube.send('setSpeed', { speed: 0 }));
    await render(page, 6, 0.5);
    const l1 = await lum(page);
    await shot(page, 'nuit-apres-minuit-aerien');
    await page.evaluate(() => window.__aube.setCamera('demo-street'));
    await render(page, 6, 0.5);
    const l2 = await lum(page);
    await shot(page, 'nuit-apres-minuit-rue');
    R.notes.night = { d0, l0, d1, l1, l2 };
    check(l1 < 60, `vue aérienne la nuit après passage de minuit (${d1}) : luminance ${l1.toFixed(1)} (avant : ${d0} ${l0.toFixed(1)})`);
    check(errors.length === 0, `nuit : aucune erreur ${errors.slice(0, 3).join(' | ')}`);
    await page.close();
  }

  if (sel.includes('D')) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = collectErrors(page);
    await page.goto(`${base}/index.html?autostart&seed=42&norender`, { timeout: 300000, waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__aube?.ready && window.__aube.snapshotReceived && window.__aube.lastStats, null, { timeout: 300000, polling: 500 });
    await page.evaluate(() => window.__aube.send('setSpeed', { speed: 0 }));
    const [cx, cz] = [116, 356];
    await page.evaluate(([x, z]) => window.__aube.lookAt(x, z, 360), [cx, cz]);
    await page.keyboard.press('KeyT');
    await render(page, 16, 0.5);
    const scr = (x, z) => page.evaluate(([a, b]) => window.__aube.worldToScreen(a, b), [x, z]);
    const click = async (x, z) => { const p = await scr(x, z); await page.mouse.move(p.x, p.y); await render(page, 1); await page.mouse.click(p.x, p.y); };
    await page.click('#toolbar button[data-tool=road]');
    await page.click('#drawer-body .road-card[data-road=street]');
    await page.click('#tool-actions button:has-text("Droite")').catch(() => undefined);
    await click(cx - 120, cz); await click(cx + 120, cz);
    await page.waitForTimeout(1000);
    await page.click('#toolbar button[data-tool=select]');
    await page.click('#toolbar button[data-tool=building]');
    await page.waitForTimeout(800);
    const cards = await page.evaluate(() => [...document.querySelectorAll('#drawer-body .card[data-asset]')].map((c) => c.dataset.asset));
    R.notes.buildCards = cards;
    await page.click('#drawer-body .card[data-asset="maison_pavillon_enduit"]').catch(() => page.click('#drawer-body .card[data-asset]'));
    await page.evaluate(([x, z]) => window.__aube.lookAt(x, z, 160), [cx, cz + 25]);
    await render(page, 16, 0.5);
    let p = await scr(cx - 40, cz + 21);
    await page.mouse.move(p.x, p.y); await page.waitForTimeout(300); await render(page, 2);
    const pv0 = await page.evaluate(() => window.__aube.toolPreview());
    await page.keyboard.press('KeyR'); await page.waitForTimeout(300); await render(page, 2);
    const pv1 = await page.evaluate(() => window.__aube.toolPreview());
    R.notes.rotate = { pv0, pv1 };
    check(pv0.rot !== pv1.rot, `touche R pivote l'aperçu (${pv0.rot} -> ${pv1.rot})`);
    await shot(page, 'apercu-rot');
    await page.keyboard.press('KeyR'); await page.keyboard.press('KeyR'); await page.keyboard.press('KeyR');
    await page.mouse.move(p.x + 1, p.y); await page.waitForTimeout(300); await render(page, 2);
    // Aperçu invalide (sur la route).
    const pr = await scr(cx + 30, cz);
    await page.mouse.move(pr.x, pr.y); await page.waitForTimeout(300); await render(page, 2);
    const pvBad = await page.evaluate(() => window.__aube.toolPreview());
    const tagBad = await page.evaluate(() => document.querySelector('#cursor-tag')?.textContent ?? '');
    R.notes.invalid = { pvBad, tagBad };
    check(pvBad.validity && pvBad.validity !== 'ok', `aperçu refusé sur la chaussée (${pvBad.validity} — ${tagBad.replace(/\n/g, ' / ')})`);
    await shot(page, 'apercu-invalide');
    const b0 = (await stats(page)).buildings;
    for (const x of [cx - 40, cx + 40]) { p = await scr(x, cz + 21); await page.mouse.move(p.x, p.y); await page.waitForTimeout(300); await render(page, 1); await page.mouse.click(p.x, p.y); await page.waitForTimeout(900); }
    const b1 = (await stats(page)).buildings;
    check(b1 === b0 + 2, `2 bâtiments posés à la souris (${b0} -> ${b1})`);
    // Démolition d'un bâtiment.
    await page.keyboard.press('Escape');
    await page.click('#toolbar button[data-tool=bulldoze]');
    p = await scr(cx + 40, cz + 21);
    await page.mouse.move(p.x, p.y); await page.waitForTimeout(300); await render(page, 1);
    R.notes.bullTag = await page.evaluate(() => document.querySelector('#cursor-tag')?.textContent ?? '');
    await page.mouse.click(p.x, p.y); await page.waitForTimeout(1000);
    const b2 = (await stats(page)).buildings;
    check(b2 === b1 - 1, `démolition à la souris (${b1} -> ${b2}) ${R.notes.bullTag.replace(/\n/g, ' / ')}`);
    await page.keyboard.press('Escape');
    await page.click('#toolbar button[data-tool=select]');
    await render(page, 3);
    await shot(page, 'partie');
    // Sauvegarde via l'UI : bouton Sauvegarder -> panneau d'emplacements -> nouvel emplacement nommé.
    const road0 = (await stats(page)).roadLengthM;
    const slotsSaved = [];
    for (const name of ['QA alpha', 'QA beta']) {
      await page.click('#btn-save');
      await page.waitForTimeout(600);
      await page.fill('#save-name', name);
      await page.click('#form-save button[type=submit]');
      await page.waitForTimeout(1500);
      await shot(page, `save-ui-${name.replace(' ', '-')}`);
      slotsSaved.push(await page.evaluate(() => [...document.querySelectorAll('#save-list li')].map((l) => l.textContent.trim().replace(/\s+/g, ' '))));
      await page.click('#save-close');
      if (name === 'QA alpha') {
        const pe = await scr(cx + 40, cz - 21);
        await page.click('#toolbar button[data-tool=building]'); await page.waitForTimeout(500);
        await page.click('#drawer-body .card[data-asset="maison_pavillon_enduit"]').catch(() => page.click('#drawer-body .card[data-asset]'));
        await page.mouse.move(pe.x, pe.y); await page.waitForTimeout(300); await render(page, 1);
        await page.mouse.click(pe.x, pe.y); await page.waitForTimeout(1000);
        await page.keyboard.press('Escape');
        await page.click('#toolbar button[data-tool=select]');
      }
    }
    R.notes.slotsSaved = slotsSaved;
    const statsBefore = await stats(page);
    R.notes.statsBefore = statsBefore;
    const storeKind = await page.evaluate(() => window.__aube.saveStoreKind ?? null);
    R.notes.storeKind = storeKind;
    // Recharge la page (sans autostart) puis charge QA-alpha.
    await page.goto(`${base}/index.html?norender`, { timeout: 300000, waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__aube?.ready === true, null, { timeout: 300000, polling: 500 });
    await page.waitForTimeout(800);
    const contEnabled = await page.evaluate(() => { const b = document.querySelector('#btn-continue'); return b && !b.disabled && b.offsetParent !== null; });
    await page.click('#btn-load').catch(() => undefined);
    await page.waitForTimeout(800);
    await shot(page, 'chargement-liste');
    const slotList = await page.evaluate(() => [...document.querySelectorAll('#panel-load li, #load-list li, .slot, [data-slot]')].map((e) => e.textContent.trim().replace(/\s+/g, ' ').slice(0, 120)));
    R.notes.slotList = slotList;
    check(slotList.some((s) => /qa-alpha/.test(s)) && slotList.some((s) => /qa-beta/.test(s)), `après rechargement : emplacements QA-alpha et QA-beta listés (${slotList.length} : ${slotList.join(' || ')})`);
    
    const alpha = await page.$('#load-list li:has-text("qa-alpha") button.primary');
    if (alpha) {
      await alpha.click();
      await page.waitForFunction(() => window.__aube.snapshotReceived && window.__aube.lastStats, null, { timeout: 300000, polling: 500 });
      await page.waitForTimeout(1500);
      const sa = await stats(page);
      R.notes.statsAlpha = sa;
      check(sa.buildings === b2 && Math.abs(sa.roadLengthM - road0) < 1, `QA-alpha rechargé : ${sa.buildings} bâtiment(s) (attendu ${b2}), routes ${sa.roadLengthM} m (attendu ${road0})`);
      check(statsBefore.buildings === b2 + 1, `QA-beta contenait un bâtiment de plus (${statsBefore.buildings})`);
      await page.evaluate(([x, z]) => window.__aube.lookAt(x, z, 160), [cx, cz + 25]);
      await render(page, 10, 0.5);
      await shot(page, 'apres-chargement');
    } else check(false, 'emplacement QA-alpha cliquable introuvable');
    R.notes.contEnabled = contEnabled;
    R.errorsD = errors;
    check(errors.length === 0, `partie : aucune erreur ${errors.slice(0, 4).join(' | ')}`);
    await ctx.close();
  }
} catch (e) {
  console.error('ERREUR', e); R.crash = String(e?.stack ?? e);
} finally {
  writeFileSync(join(out, `qa-play4-${sel}.json`), JSON.stringify(R, null, 2));
  await browser.close(); server.close();
}
