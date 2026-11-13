/**
 * Parcours « joueur » À LA SOURIS (npm run e2e:play, après npm run build) — vérifie les corrections de la
 * recette QA de phase 1 dans le vrai jeu (worker réel, rendu réel ; ?norender + renderNow pour des captures
 * rapides en rendu logiciel) :
 *   1. tiroir Routes : les 6 types de la simulation sont proposés ;
 *   2. avenue droite puis rue COURBE qui la croise (mode Courbe, 3 clics) : la rue est UNE vraie courbe et
 *      TOUS les tronçons de la simulation restent affichés (rendu = simulation) ;
 *   3. route en BIAIS : l'aperçu du bâtiment s'aligne exactement sur la route (rotation décimale, « façade
 *      côté route ») et la pose est acceptée juste derrière le trottoir ; idem le long de l'avenue ;
 *   4. finances : recettes fiscales affichées, impôt résidentiel modifié par le curseur (taux relu dans la
 *      simulation), emprunt accordé (trésorerie + liste) ;
 *   5. population : panneau Habitants avec emploi / trajets après croissance ;
 *   6. iPhone 13 : la barre d'outils tient dans l'écran (pas de débordement).
 * Captures : tests/e2e/out/play-*.png ; rapport : tests/e2e/out/play.json.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectErrors, launch, root, serve } from './lib.mjs';

const out = join(root, 'tests/e2e/out');
mkdirSync(out, { recursive: true });
const { server, base } = await serve();
const browser = await launch();
const R = { checks: [], notes: {} };
let failed = false;
const check = (ok, msg) => { R.checks.push({ ok: !!ok, msg }); console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${msg}`); if (!ok) failed = true; };
const shot = (page, name) => page.screenshot({ path: join(out, `play-${name}.png`), timeout: 600000 });
const render = (page, n = 2) => page.evaluate((k) => window.__aube.renderNow(k), n);
/** Caméra stabilisée (amortissement terminé) avant de projeter des points monde -> écran. */
const settle = (page) => page.evaluate(() => window.__aube.renderNow(16, 0.5));
const stats = (page) => page.evaluate(() => window.__aube.lastStats);
const scr = (page, x, z) => page.evaluate(([a, b]) => window.__aube.worldToScreen(a, b), [x, z]);
const preview = (page) => page.evaluate(() => window.__aube.toolPreview());
const send = (page, n, a) => page.evaluate(([n, a]) => window.__aube.send(n, a).then((r) => ({ ok: true, r }), (e) => ({ ok: false, e: e.message })), [n, a]);
const saveData = async (page) => (await send(page, 'save', { slot: 'e2e-probe' })).r.data;
const tag = (page) => page.evaluate(() => document.querySelector('#cursor-tag')?.textContent ?? '');

async function clickWorld(page, x, z) {
  const p = await scr(page, x, z);
  if (p.y > 700 || p.y < 110 || p.x < 20 || p.x > 1420) throw new Error(`point (${x}, ${z}) hors de la zone cliquable : écran ${Math.round(p.x)}, ${Math.round(p.y)}`);
  await page.mouse.move(p.x, p.y); await render(page, 1);
  await page.mouse.click(p.x, p.y);
  return p;
}
async function hoverWorld(page, x, z) {
  const p = await scr(page, x, z);
  await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(250); // validation dryRun par le worker
  await render(page, 1);
  return p;
}

try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = collectErrors(page);
  await page.goto(`${base}/index.html?autostart&seed=42&norender`, { timeout: 300000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__aube?.ready && window.__aube.snapshotReceived && window.__aube.lastStats, null, { timeout: 300000, polling: 500 });
  await send(page, 'setSpeed', { speed: 0 });
  // Zone sèche et plate trouvée par la simulation elle-même (dryRun d'une maison sur toute la zone de test).
  // Carte seed 42 : zone repérée hors ligne (scratch) puis REVÉRIFIÉE ici (dryRun d'une maison sur toute la zone).
  const C0 = [116, 356];
  const pts = [];
  for (let dx = -180; dx <= 200; dx += 40) for (let dz = -110; dz <= 180; dz += 40) pts.push([C0[0] + dx, C0[1] + dz]);
  const dry = await page.evaluate(async (list) => {
    for (const [px, pz] of list) {
      try { await window.__aube.send('placeBuilding', { assetId: 'maison_pavillon_enduit', x: px, z: pz, rot: 0, dryRun: true }); } catch (e) { return `${px},${pz}: ${e.message}`; }
    }
    return 'ok';
  }, pts);
  const C = dry === 'ok' ? C0 : null;
  R.notes.site = dry;
  check(!!C, `zone constructible trouvée ${JSON.stringify(C)}`);
  const [cx, cz] = C;
  await page.evaluate(([x, z]) => window.__aube.lookAt(x, z, 560), [cx, cz]);
  await page.keyboard.press('KeyT'); // vue de dessus
  await settle(page);

  // 1. Tiroir Routes : 6 types.
  await page.click('#toolbar button[data-tool=road]');
  const cards = await page.evaluate(() => [...document.querySelectorAll('#drawer-body .road-card')].map((c) => c.getAttribute('data-road')));
  R.notes.roadCards = cards;
  check(['street', 'avenue', 'boulevard', 'oneway', 'pedestrian', 'highway'].every((k) => cards.includes(k)), `6 types de route dans le tiroir (${cards.join(', ')})`);
  await render(page, 1);
  await shot(page, 'tiroir-routes');

  // 2. Avenue droite puis rue courbe qui la croise.
  await page.click('#drawer-body .road-card[data-road=avenue]');
  await clickWorld(page, cx - 160, cz); await clickWorld(page, cx + 160, cz);
  await page.waitForTimeout(1000);
  await page.click('#toolbar button[data-tool=select]');
  await page.click('#toolbar button[data-tool=road]');
  await page.click('#drawer-body .road-card[data-road=street]');
  await page.click('#tool-actions button:has-text("Courbe")');
  await page.evaluate(([x, z]) => window.__aube.lookAt(x, z, 520), [cx, cz]);
  await settle(page);
  await clickWorld(page, cx - 60, cz - 90);
  await clickWorld(page, cx + 70, cz);
  await hoverWorld(page, cx - 60, cz + 90);
  R.notes.curvePreview = await preview(page);
  await render(page, 2);
  await shot(page, 'courbe-apercu');
  await clickWorld(page, cx - 60, cz + 90);
  await page.waitForTimeout(1200);
  await page.click('#toolbar button[data-tool=select]');
  await render(page, 3);
  let sd = await saveData(page);
  const sc = await page.evaluate(() => window.__aube.sceneCheck());
  const curved = sd.roads.edges.filter((e) => e.kind === 'street' && e.c1 && e.c2 && Math.hypot(e.c1[0] - e.c2[0], e.c1[1] - e.c2[1]) > 1);
  R.notes.edgesAfterCurve = sd.roads.edges.map((e) => ({ id: e.id, kind: e.kind, len: Math.round(e.length) }));
  check(sd.roads.edges.filter((e) => e.kind === 'avenue').length >= 2, `l'avenue a été coupée en carrefour (${sd.roads.edges.length} tronçons)`);
  check(curved.length >= 1, `la rue courbe est une vraie courbe de Bézier (${curved.length} tronçon(s) courbe(s))`);
  check(sc.roads.segments === sd.roads.edges.length, `rendu = simulation : ${sc.roads.segments} tronçons affichés / ${sd.roads.edges.length} simulés`);
  await shot(page, 'courbe-carrefour');

  // 3. Route en biais (≈ 34°) puis bâtiment aligné à la souris.
  await page.click('#toolbar button[data-tool=road]');
  await page.click('#drawer-body .road-card[data-road=street]');
  await page.click('#tool-actions button:has-text("Droite")');
  await page.evaluate(([x, z]) => window.__aube.lookAt(x, z, 420), [cx + 95, cz + 110]);
  await settle(page);
  await clickWorld(page, cx + 20, cz + 60); await clickWorld(page, cx + 170, cz + 160);
  await page.waitForTimeout(1000);
  await page.click('#toolbar button[data-tool=select]');
  await page.click('#toolbar button[data-tool=building]');
  await page.waitForTimeout(800);
  await page.click('#drawer-body .card[data-asset="maison_pavillon_enduit"]').catch(async () => { await page.click('#drawer-body .card[data-asset]'); });
  // Côté sud-est de la rue en biais, à ~20 m de l'axe.
  const ux = 150 / Math.hypot(150, 100), uz = 100 / Math.hypot(150, 100);
  const mx = cx + 95 + uz * 20, mz = cz + 110 - ux * 20;
  await page.evaluate(([x, z]) => window.__aube.lookAt(x, z, 160), [mx, mz]);
  await settle(page);
  await hoverWorld(page, mx, mz);
  await page.waitForTimeout(400); await render(page, 1);
  const pv = await preview(page);
  R.notes.biasPreview = pv;
  const roadAngle = Math.atan2(150, 100); // direction (dx, dz) de la route
  const facade = (pv.rot ?? 0) * Math.PI / 2; // façade locale +Z tournée de rot quarts de tour : (sin, cos)
  const dotAlong = Math.abs(Math.sin(facade) * Math.sin(roadAngle) + Math.cos(facade) * Math.cos(roadAngle));
  check(pv.kind === 'building' && pv.snapped, `aperçu aimanté à la route en biais (${JSON.stringify(pv)})`);
  check(Math.abs(pv.rot - Math.round(pv.rot)) > 0.05 && dotAlong < 0.02, `façade perpendiculaire à la route en biais (rot ${pv.rot?.toFixed(3)} quart(s) de tour, |cos| = ${dotAlong.toFixed(3)})`);
  const t1 = await tag(page);
  check(/façade côté route/.test(t1), `étiquette au curseur : « ${t1.replace(/\n/g, ' / ')} »`);
  check(pv.validity === 'ok', `pose jugée valide par la simulation (${pv.message || 'ok'})`);
  await render(page, 2);
  await shot(page, 'biais-apercu');
  const b0 = (await stats(page)).buildings;
  const p0 = await scr(page, mx, mz);
  await page.mouse.click(p0.x, p0.y);
  await page.waitForTimeout(1200);
  sd = await saveData(page);
  const placedBias = sd.buildings[sd.buildings.length - 1];
  check(sd.buildings.length === b0 + 1 && Math.abs(placedBias.rot - pv.rot) < 1e-3, `bâtiment posé en biais à la souris (rot ${placedBias?.rot})`);
  // Le long de l'avenue (horizontale) : deux bâtiments au plus près, côté nord puis côté sud.
  let near = 0;
  for (const [x, side] of [[cx + 110, -1], [cx + 120, 1]]) {
    await page.evaluate(([a, b]) => window.__aube.lookAt(a, b, 160), [x, cz]);
    await settle(page);
    await hoverWorld(page, x, cz + side * 22);
    await page.waitForTimeout(300);
    const p = await preview(page);
    if (p.validity === 'ok') {
      const s = await scr(page, x, cz + side * 22);
      await page.mouse.click(s.x, s.y); await page.waitForTimeout(1000);
      const d = await saveData(page);
      const b = d.buildings[d.buildings.length - 1];
      const gap = Math.abs(b.z - cz);
      R.notes[`avenue${side}`] = { preview: p, center: b };
      if (d.buildings.length > sd.buildings.length && gap < 11.5 + 8 + 2.5) near++;
      sd = d;
    } else R.notes[`avenue${side}`] = { preview: p };
  }
  check(near === 2, `2 maisons posées à la souris au ras de l'avenue (centre à ≤ 22 m de l'axe : trottoir 11,5 m + demi-maison 8 m)`);
  await page.click('#toolbar button[data-tool=select]');
  await page.evaluate(([x, z]) => window.__aube.lookAt(x, z + 50, 260), [cx, cz]);
  await settle(page);
  await page.waitForFunction(() => window.__aube.sceneCheck().buildingsLoading === 0, null, { timeout: 120000 }).catch(() => undefined);
  await render(page, 3);
  const scB = await page.evaluate(() => window.__aube.sceneCheck());
  check(scB.buildings === sd.buildings.length && scB.buildingErrors.length === 0, `bâtiments affichés = simulés (${scB.buildings} / ${sd.buildings.length}, ${scB.buildingErrors.length} erreur(s) de chargement)`);
  await shot(page, 'batiments');
  // Gros plan sur le bâtiment en biais.
  await page.evaluate(([x, z]) => window.__aube.lookAt(x, z, 70), [placedBias.x, placedBias.z]);
  await settle(page); await render(page, 2);
  await shot(page, 'biais-pose');

  // 4. Finances : impôts et emprunt.
  await page.click('#btn-finance');
  await page.evaluate(() => window.__aube.send('setSpeed', { speed: 1 }));
  await page.waitForFunction(() => !!window.__aube.lastReport, null, { timeout: 60000 });
  await page.click('#btn-fin-tax');
  await page.waitForTimeout(600);
  const slider = page.locator('#fin-tax-body input[type=range]').first();
  await slider.evaluate((el) => { el.value = '14'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(1200);
  const rep = await send(page, 'getReport', {});
  check(rep.ok && Math.abs(rep.r.economy.taxRates.residential - 0.14) < 1e-9, `impôt résidentiel réglé à 14 % dans la simulation (${rep.r?.economy.taxRates.residential})`);
  const incomeTxt = await page.textContent('#fin-income');
  check(/\+/.test(incomeTxt ?? ''), `recettes fiscales affichées (« ${incomeTxt} »)`);
  await render(page, 1);
  await shot(page, 'finances-impots');
  const m0 = (await stats(page)).money;
  await page.click('#btn-fin-loan');
  await page.fill('#loan-amount', '200000');
  await page.waitForTimeout(800);
  R.notes.loanOffer = await page.textContent('#loan-offer');
  await page.click('#loan-take');
  await page.waitForTimeout(1500);
  const rep2 = await send(page, 'getReport', {});
  const loans = await page.evaluate(() => [...document.querySelectorAll('#loan-list li')].map((l) => l.textContent));
  check(rep2.ok && rep2.r.economy.loans.length === 1 && rep2.r.economy.money >= m0 + 190000, `emprunt de 200 000 ¢ accordé (trésorerie ${m0} -> ${rep2.r?.economy.money}, ${loans.length} ligne(s) affichée(s))`);
  await render(page, 1);
  await shot(page, 'finances-emprunt');
  await page.click('#finance-close');

  // 5. Croissance puis panneau Population.
  await page.evaluate(() => window.__aube.send('setSpeed', { speed: 4 }));
  await page.waitForTimeout(30000);
  await page.evaluate(() => window.__aube.send('setSpeed', { speed: 0 }));
  await page.waitForTimeout(1500);
  await page.click('#hud-pop-btn');
  await page.waitForTimeout(600);
  const popTxt = await page.textContent('#pop-total');
  const rows = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#pop-rows dt')].map((dt) => [dt.textContent, dt.nextElementSibling?.textContent])));
  R.notes.popRows = rows;
  const st = await stats(page);
  check(Number((popTxt ?? '0').replace(/\s/g, '')) === st.population && st.population > 0, `panneau Population : ${popTxt} habitants (simulation : ${st.population})`);
  check('En emploi' in rows && 'Chômeurs' in rows && 'En trajet maintenant' in rows, `emploi, chômage et trajets affichés (${rows['En emploi']} en emploi, ${rows['Chômeurs']} au chômage, ${rows['En trajet maintenant']} en trajet)`);
  await render(page, 1);
  await shot(page, 'population');
  R.errors = errors;
  check(errors.length === 0, `PC : aucune erreur de page ${errors.slice(0, 4).join(' | ')}`);
  await ctx.close();

  // 6. iPhone 13 : barre d'outils dans l'écran.
  const ip = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
  const p2 = await ip.newPage();
  const e2 = collectErrors(p2);
  await p2.goto(`${base}/index.html?autostart&seed=7&norender`, { timeout: 300000, waitUntil: 'domcontentloaded' });
  await p2.waitForFunction(() => window.__aube?.ready && window.__aube.snapshotReceived && window.__aube.lastStats, null, { timeout: 300000, polling: 500 });
  await p2.evaluate(() => window.__aube.renderNow(3));
  const tb = await p2.evaluate(() => {
    const t = document.querySelector('#toolbar');
    const r = t.getBoundingClientRect();
    const btns = [...t.querySelectorAll('button')].map((b) => b.getBoundingClientRect());
    return { left: r.left, right: r.right, scrollW: t.scrollWidth, clientW: t.clientWidth, docW: document.documentElement.scrollWidth,
      allInside: btns.every((b) => b.left >= 0 && b.right <= innerWidth), minBtn: Math.min(...btns.map((b) => Math.min(b.width, b.height))) };
  });
  R.notes.iphoneToolbar = tb;
  check(tb.allInside && tb.scrollW <= tb.clientW + 1 && tb.docW <= 390, `iPhone : les ${9} outils tiennent dans l'écran (barre ${Math.round(tb.right - tb.left)} px)`);
  check(tb.minBtn >= 40, `iPhone : boutons d'outils ≥ 40 px (${Math.round(tb.minBtn)})`);
  await p2.screenshot({ path: join(out, 'play-iphone.png'), timeout: 600000 });
  await p2.tap('#hud-pop-btn');
  await p2.waitForTimeout(500);
  await p2.screenshot({ path: join(out, 'play-iphone-population.png'), timeout: 600000 });
  const ov = await p2.evaluate(() => ({ panel: document.querySelector('#pop-panel').getBoundingClientRect().bottom, toolbar: document.querySelector('#toolbar').getBoundingClientRect().top }));
  check(ov.panel <= ov.toolbar + 1, `iPhone : le panneau ne recouvre pas la barre d'outils (bas ${Math.round(ov.panel)} ≤ haut ${Math.round(ov.toolbar)})`);
  check(e2.length === 0, `iPhone : aucune erreur ${e2.slice(0, 3).join(' | ')}`);
  await ip.close();
} catch (e) {
  console.error('ERREUR', e); R.crash = String(e?.stack ?? e); failed = true;
} finally {
  writeFileSync(join(out, 'play.json'), JSON.stringify(R, null, 2));
  await browser.close(); server.close();
}
console.log(failed ? '\nPARCOURS SOURIS : ÉCHEC' : '\nPARCOURS SOURIS : SUCCÈS');
process.exit(failed ? 1 : 0);
