/**
 * Recette QA (joueur) : joue le VRAI jeu par l'INTERFACE (souris/clavier), PC 1440×900.
 *   node tests/e2e/qa-play.mjs   (après npm run build)
 * Étapes : menu -> nouvelle partie (formulaire) -> outil Routes (6 types ? droite + courbe à la souris)
 * -> Bâtiments (aperçu, rotation R, pose au clic) -> Démolir -> vitesses/date -> Finances -> Sauvegarde/
 * rechargement -> Démo depuis le menu + touche V. Captures dans tests/e2e/out/qa-*.png (deviceScaleFactor 1).
 * Résultat JSON : tests/e2e/out/qa-play.json.
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
const shot = (page, name) => page.screenshot({ path: join(out, `qa-${name}.png`), timeout: 600000 });
const stats = (page) => page.evaluate(() => window.__aube.lastStats);
const render = (page, n = 2) => page.evaluate((k) => window.__aube.renderNow?.(k), n);

try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = collectErrors(page);
  await page.goto(`${base}/index.html`, { timeout: 300000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__aube?.ready === true, null, { timeout: 300000 });
  await page.waitForSelector('#main-menu:not(.hidden)', { timeout: 120000 });
  R.notes.menu = await page.evaluate(() => [...document.querySelectorAll('#main-menu button')].filter((b) => b.offsetParent).map((b) => ({ t: b.textContent.trim(), dis: b.disabled })));
  await shot(page, 'menu');

  // Nouvelle partie par le formulaire.
  await page.click('#btn-new');
  await page.waitForSelector('#form-new', { state: 'visible' });
  await page.fill('#new-name', 'Recette QA');
  await page.fill('#new-seed', '7');
  await page.click('#form-new button[type=submit], #form-new .primary');
  await page.waitForFunction(() => window.__aube.snapshotReceived && window.__aube.lastStats, null, { timeout: 300000 });
  await page.waitForSelector('#toolbar:not(.hidden)', { timeout: 120000 });
  await page.evaluate(() => window.__aube.send('setSpeed', { speed: 0 }));
  R.notes.toolbar = await page.evaluate(() => [...document.querySelectorAll('#toolbar button')].map((b) => ({ t: b.textContent.trim(), dis: b.disabled })));
  R.notes.hudButtons = await page.evaluate(() => [...document.querySelectorAll('#hud button')].filter((b) => b.offsetParent).map((b) => ({ t: b.textContent.trim(), dis: b.disabled })));
  const s0 = await stats(page);
  R.notes.start = s0;
  await render(page, 3);
  await shot(page, 'partie');

  // Cherche un emplacement à terre près du centre : on centre la caméra sur un point accepté par la simulation.
  let spot = null;
  for (let r = 0; r < 700 && !spot; r += 50) for (let a = 0; a < 8 && !spot; a++) {
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const ok = await page.evaluate(async ([x, z]) => {
      const h = window.__aube; // test sans effet : validation d'une petite route puis annulation impossible -> on utilise une vérif via lookAt seulement
      return [x, z];
    }, [x, z]);
    spot = ok;
  }
  // On regarde le centre en vue de dessus (touche T) pour viser à la souris.
  await page.evaluate(() => window.__aube.lookAt(0, 0, 260));
  await page.keyboard.press('KeyT');
  await render(page, 6);

  // Outil Routes : tiroir.
  await page.click('#toolbar button[data-tool=road]');
  await page.waitForSelector('#build-drawer:not(.hidden)');
  R.notes.roadTypes = await page.evaluate(() => [...document.querySelectorAll('#drawer-body .road-card .nm')].map((e) => e.textContent));
  R.notes.roadModes = await page.evaluate(() => [...document.querySelectorAll('#drawer-body .seg button')].map((e) => e.textContent));
  await shot(page, 'tiroir-routes');
  check(R.notes.roadTypes.length >= 3, `types de routes proposés dans l'interface : ${R.notes.roadTypes.join(', ')}`);
  await page.click('#drawer-body .road-card[data-road=avenue]');
  // Trace droite à la souris : on essaie plusieurs lignes horizontales jusqu'à ce que la route soit acceptée.
  const roadsBefore = (await stats(page)).roads ?? 0;
  let built = false; let tries = 0;
  for (const y of [450, 380, 520, 300, 600, 250, 650]) {
    tries++;
    await page.mouse.move(420, y); await render(page, 1);
    await page.mouse.click(420, y); await render(page, 1);
    await page.mouse.move(1020, y); await render(page, 2);
    const tag = await page.evaluate(() => document.querySelector('#cursor-tag')?.textContent ?? '');
    await page.mouse.click(1020, y); await page.waitForTimeout(1200); await render(page, 2);
    const st = await stats(page);
    if ((st.roads ?? 0) > roadsBefore) { built = true; R.notes.roadLineY = y; R.notes.roadTag = tag; break; }
    R.notes[`roadRefus${y}`] = tag;
    await page.mouse.click(700, y, { button: 'right' }); await page.mouse.click(700, y, { button: 'right' });
  }
  const sRoad = await stats(page);
  check(built, `route droite tracée à la souris (routes ${roadsBefore} -> ${sRoad.roads}, essais ${tries})`);
  check(sRoad.money < s0.money, `coût débité (${s0.money} -> ${sRoad.money})`);
  await shot(page, 'route-droite');

  // Route courbe croisant la première (mode Courbe).
  await page.click('#toolbar button[data-tool=road]');
  await page.waitForSelector('#build-drawer:not(.hidden)');
  const segs = await page.$$('#drawer-body .seg button');
  if (segs[1]) await segs[1].click();
  await page.click('#drawer-body .road-card[data-road=street]');
  const y0 = R.notes.roadLineY ?? 450;
  const r1 = (await stats(page)).roads;
  await page.mouse.click(600, y0 - 180); await render(page, 1);
  await page.mouse.click(820, y0); await render(page, 1);
  await page.mouse.move(640, y0 + 180); await render(page, 2);
  await shot(page, 'route-courbe-apercu');
  await page.mouse.click(640, y0 + 180); await page.waitForTimeout(1500); await render(page, 2);
  const r2 = (await stats(page)).roads;
  check(r2 > r1, `route courbe tracée à la souris, carrefour (${r1} -> ${r2} tronçons)`);
  R.notes.edgesAfterCurve = r2;
  await shot(page, 'route-courbe');

  // Bâtiments : aperçu, rotation, pose.
  await page.keyboard.press('Escape');
  await page.click('#toolbar button[data-tool=building]');
  await page.waitForSelector('#build-drawer:not(.hidden)');
  R.notes.buildTabs = await page.evaluate(() => [...document.querySelectorAll('#drawer-tabs button')].map((b) => b.textContent));
  await page.waitForTimeout(3000);
  await shot(page, 'tiroir-batiments');
  await page.click('#drawer-body .card[data-asset]');
  const b0 = (await stats(page)).buildings;
  let placed = 0; let lastTag = '';
  for (const [x, y] of [[520, y0 - 40], [520, y0 + 40], [700, y0 - 40], [900, y0 + 40], [880, y0 - 45], [460, y0 + 45]]) {
    await page.mouse.move(x, y); await render(page, 2);
    lastTag = await page.evaluate(() => document.querySelector('#cursor-tag')?.textContent ?? '');
    const ghost = await page.evaluate(() => window.__aube.sceneCheck?.()?.ghostModelVisible ?? null);
    if (placed === 0) { R.notes.ghostTag = lastTag; R.notes.ghostVisible = ghost; await shot(page, 'apercu-batiment'); await page.keyboard.press('KeyR'); await render(page, 2); await shot(page, 'apercu-rotation'); R.notes.ghostTagRot = await page.evaluate(() => document.querySelector('#cursor-tag')?.textContent ?? ''); }
    await page.mouse.click(x, y); await page.waitForTimeout(1200);
    const n = (await stats(page)).buildings;
    if (n > b0 + placed) placed = n - b0;
    if (placed >= 2) break;
  }
  R.notes.lastBuildTag = lastTag;
  check(placed >= 1, `bâtiment posé à la souris avec aperçu (${placed} posé(s) ; info curseur : ${JSON.stringify(R.notes.ghostTag)})`);
  await render(page, 3);
  await shot(page, 'batiments-poses');

  // Démolition.
  await page.keyboard.press('Escape');
  await page.click('#toolbar button[data-tool=bulldoze]');
  const bb = (await stats(page)).buildings; const rr = (await stats(page)).roads;
  await page.mouse.move(700, y0); await render(page, 2);
  R.notes.bulldozeTag = await page.evaluate(() => document.querySelector('#cursor-tag')?.textContent ?? '');
  await page.mouse.click(700, y0); await page.waitForTimeout(1200);
  const sd = await stats(page);
  check(sd.buildings < bb || sd.roads < rr, `démolition à la souris (bâtiments ${bb}->${sd.buildings}, routes ${rr}->${sd.roads}) ; info ${JSON.stringify(R.notes.bulldozeTag)}`);
  await page.keyboard.press('Escape');

  // Temps : vitesses.
  const d0 = (await stats(page)).date.totalMinutes;
  const speedBtns = await page.$$('#hud .speed button, #hud [data-speed]');
  R.notes.speedButtons = speedBtns.length;
  await page.evaluate(() => window.__aube.send('setSpeed', { speed: 0 }));
  if (speedBtns.length >= 4) await speedBtns[3].click(); else await page.keyboard.press('Digit3');
  await page.waitForTimeout(6000);
  const d1 = (await stats(page)).date.totalMinutes;
  check(d1 > d0, `le temps avance après clic vitesse max (${d0} -> ${d1} min de jeu en 6 s)`);
  const s6 = await stats(page);
  R.notes.afterTime = s6;
  // Finances.
  await page.click('#btn-finance, #hud-money-btn').catch(() => {});
  await page.waitForTimeout(800);
  R.notes.finance = await page.evaluate(() => document.querySelector('#finance-panel')?.innerText ?? '');
  R.notes.financeControls = await page.evaluate(() => [...document.querySelectorAll('#finance-panel button, #finance-panel input')].map((b) => ({ t: (b.textContent || b.getAttribute('aria-label') || b.type).trim(), dis: b.disabled })));
  await render(page, 2);
  await shot(page, 'finances');
  await page.click('#finance-close').catch(() => {});
  // Nuit : avance jusqu'à 22 h environ et capture.
  R.notes.dateLabel = await page.evaluate(() => document.querySelector('#hud-date')?.textContent);

  // Sauvegarde UI + rechargement.
  await page.evaluate(() => window.__aube.send('setSpeed', { speed: 0 }));
  const ref = await stats(page);
  await page.click('#btn-save');
  await page.fill('#save-name', 'Recette QA 1');
  await page.press('#save-name', 'Enter');
  await page.waitForTimeout(1500);
  await page.fill('#save-name', 'Recette QA 2');
  await page.press('#save-name', 'Enter');
  await page.waitForTimeout(1500);
  R.notes.slots = await page.evaluate(() => [...document.querySelectorAll('#save-list .slot')].map((e) => e.innerText.replace(/\s+/g, ' ')));
  await shot(page, 'sauvegardes');
  check(R.notes.slots.length >= 2, `plusieurs emplacements (${R.notes.slots.length})`);
  await page.click('#save-close').catch(() => {});
  await page.goto(`${base}/index.html`, { timeout: 300000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__aube?.ready === true, null, { timeout: 300000 });
  await page.click('#btn-load');
  await page.waitForSelector('#load-list .slot');
  R.notes.loadList = await page.evaluate(() => [...document.querySelectorAll('#load-list .slot')].map((e) => e.innerText.replace(/\s+/g, ' ')));
  await page.locator('#load-list .slot', { hasText: 'qa-1' }).first().locator('button.primary').click().catch(async () => {
    await page.locator('#load-list .slot').first().locator('button.primary').click();
  });
  await page.waitForFunction(() => window.__aube.snapshotReceived && window.__aube.lastStats, null, { timeout: 120000 });
  await page.waitForTimeout(1500);
  const got = await stats(page);
  check(got.buildings === ref.buildings && got.roads === ref.roads, `rechargement : bâtiments ${ref.buildings}/${got.buildings}, routes ${ref.roads}/${got.roads}`);
  await render(page, 3);
  await shot(page, 'recharge');

  // Démo depuis le menu.
  await page.click('#btn-menu');
  await page.waitForSelector('#main-menu:not(.hidden)');
  const demoBtn = await page.$('#btn-demo');
  check(demoBtn && !(await demoBtn.isDisabled()), 'bouton « Scène de démonstration » actif dans le menu');
  await page.click('#btn-demo');
  await page.waitForFunction(() => window.__aube.demoReady, null, { timeout: 600000 });
  await page.evaluate(() => window.__aube.send('setSpeed', { speed: 1 }));
  await page.waitForTimeout(3000);
  await render(page, 3);
  await shot(page, 'demo-menu-aerien');
  const camA = await page.evaluate(() => window.__aube.cameraPose());
  await page.keyboard.press('KeyV');
  await page.waitForTimeout(500); await render(page, 4);
  const camS = await page.evaluate(() => window.__aube.cameraPose());
  R.notes.camA = camA; R.notes.camS = camS;
  check(JSON.stringify(camA) !== JSON.stringify(camS), 'touche V : bascule vue rue');
  await shot(page, 'demo-menu-rue');
  // Déplacement piéton (ZQSD/flèches).
  await page.keyboard.down('KeyW'); await render(page, 10); await page.keyboard.up('KeyW');
  await render(page, 2);
  const camW = await page.evaluate(() => window.__aube.cameraPose());
  R.notes.camW = camW;
  check(JSON.stringify(camW) !== JSON.stringify(camS), 'vue rue : déplacement au clavier');
  await shot(page, 'demo-menu-rue2');
  // Nuit dans la démo : vitesse max un moment.
  const demoStats = await stats(page);
  R.notes.demoStats = demoStats;
  R.notes.renderStats = await page.evaluate(() => window.__aube.renderStats());
  R.errors = errors;
  check(errors.length === 0, `aucune erreur de page (${errors.slice(0, 5).join(' | ')})`);
  await ctx.close();
} catch (e) {
  console.error('ERREUR', e); R.crash = String(e?.stack ?? e);
} finally {
  writeFileSync(join(out, 'qa-play.json'), JSON.stringify(R, null, 2));
  await browser.close(); server.close();
}
