/**
 * Outils de voirie dans le vrai jeu (npm run e2e:routes, après npm run build) — souris puis iPhone au doigt :
 *   1. tracé continu : 2 tronçons enchaînés sans recliquer le départ, bouton « Terminer le tracé » ;
 *   2. quadrillage : îlots de 48 m, coût affiché AVANT validation puis débité exactement ;
 *   3. ligne guide parallèle à distance d'îlot (étiquette) ;
 *   4. Améliorer : rue → avenue (différence facturée), refus motivé par un bâtiment riverain (resté en place) ;
 *   5. iPhone 13 au doigt : départ, arrivée, barre de confirmation avec le coût, enchaînement, « Terminer »
 *      bien visible (≥ 44 px, dans l'écran), options Routes dans l'écran.
 * Captures : docs/captures-outils-routes/*.png ; rapport : tests/e2e/out/road-tools.json.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectErrors, launch, root, serve } from './lib.mjs';

const caps = join(root, 'docs/captures-outils-routes');
const out = join(root, 'tests/e2e/out');
mkdirSync(caps, { recursive: true });
mkdirSync(out, { recursive: true });
const NO_SHOTS = !!process.env.NO_SHOTS;
const { server, base } = await serve();
const browser = await launch();
const R = { checks: [], notes: {} };
let failed = false;
const check = (ok, msg) => { R.checks.push({ ok: !!ok, msg }); console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${msg}`); if (!ok) failed = true; };
const render = (page, n = 2) => page.evaluate((k) => window.__aube.renderNow(k), n);
const settle = (page) => page.evaluate(() => window.__aube.renderNow(16, 0.5));
const shot = async (page, name) => { if (NO_SHOTS) return; await render(page, 2); await page.screenshot({ path: join(caps, `${name}.png`), timeout: 600000 }); };
const scr = (page, x, z) => page.evaluate(([a, b]) => window.__aube.worldToScreen(a, b), [x, z]);
const preview = (page) => page.evaluate(() => window.__aube.toolPreview());
const send = (page, n, a) => page.evaluate(([n, a]) => window.__aube.send(n, a).then((r) => ({ ok: true, r }), (e) => ({ ok: false, e: e.message })), [n, a]);
const roads = async (page) => (await send(page, 'save', { slot: 'e2e-routes' })).r.data.roads;
const money = (page) => page.evaluate(() => window.__aube.lastStats.money);
const tag = (page) => page.evaluate(() => document.querySelector('#cursor-tag')?.textContent ?? '');
const visibleBox = (page, sel) => page.evaluate((s) => {
  const e = document.querySelector(s);
  if (!e || e.classList.contains('hidden') || getComputedStyle(e).display === 'none') return null;
  const r = e.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height, right: r.right, bottom: r.bottom, W: innerWidth, H: innerHeight };
}, sel);

async function hoverWorld(page, x, z) {
  const p = await scr(page, x, z);
  await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(300); // validation dryRun par le worker
  await render(page, 1);
  return p;
}
async function clickWorld(page, x, z) {
  const p = await hoverWorld(page, x, z);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(400);
  return p;
}
async function waitMoney(page, before) {
  await page.waitForFunction((m) => window.__aube.lastStats.money !== m, before, { timeout: 10000 }).catch(() => undefined);
  return money(page);
}

async function open(ctxOpts) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const errors = collectErrors(page);
  await page.goto(`${base}/index.html?autostart&seed=42&norender`, { timeout: 300000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__aube?.ready && window.__aube.snapshotReceived && window.__aube.lastStats, null, { timeout: 300000, polling: 500 });
  await send(page, 'setSpeed', { speed: 0 });
  return { ctx, page, errors };
}

// Zone sèche et plate de la carte 42 (celle du parcours play.mjs).
const [cx, cz] = [116, 356];

try {
  /* ------------------------------ Souris ------------------------------ */
  const { ctx, page, errors } = await open({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await page.evaluate(([x, z]) => window.__aube.lookAt(x, z, 470), [cx, cz + 20]);
  await page.keyboard.press('KeyT');
  await settle(page);

  // 1. Tracé continu.
  await page.click('#toolbar button[data-tool=road]');
  await page.click('#drawer-body .road-card[data-road=street]');
  await clickWorld(page, cx - 170, cz + 60);
  await clickWorld(page, cx - 90, cz + 60);
  await page.waitForTimeout(600);
  let p = await preview(page);
  check(p.drawing && p.chained === 1, `après le 1er tronçon, le tracé continue depuis l'extrémité (enchaînés : ${p.chained})`);
  await hoverWorld(page, cx - 90, cz + 130);
  p = await preview(page);
  const t1 = await tag(page);
  R.notes.chainTag = t1;
  check(/m · 90° \/ route · [\d  ]+ ¢/.test(t1), `étiquette longueur · angle · coût pendant le tracé (« ${t1.replace(/\n/g, ' | ')} »)`);
  let fin = await visibleBox(page, '#road-finish');
  check(!!fin, 'bouton « Terminer le tracé » visible pendant l\'enchaînement');
  await shot(page, '01-trace-continu');
  await clickWorld(page, cx - 90, cz + 130);
  await page.waitForTimeout(600);
  let rd = await roads(page);
  check(rd.edges.length === 2, `2 tronçons construits avec 3 clics (${rd.edges.length})`);
  await page.click('#road-finish');
  await page.waitForTimeout(200);
  p = await preview(page);
  fin = await visibleBox(page, '#road-finish');
  check(!p.drawing && !fin, '« Terminer » arrête le tracé (bouton masqué, outil Routes toujours actif)');

  // 2. Quadrillage 48 m.
  await page.click('#tool-actions button:has-text("Quadrillage")');
  await page.click('#tool-actions button:has-text("48 m")');
  await clickWorld(page, cx, cz - 60);
  await hoverWorld(page, cx + 150, cz + 80);
  await page.waitForTimeout(800);
  await render(page, 1);
  p = await preview(page);
  const gtag = await tag(page);
  R.notes.grid = { preview: p, tag: gtag };
  check(p.kind === 'grid' && p.validity === 'ok' && p.cost > 0, `quadrillage ${p.nx}×${p.nz} validé par la simulation avant construction : ${p.cost} ¢ (${p.message || 'ok'})`);
  check(/îlots? de 48 m/.test(gtag) && /¢/.test(gtag), `coût affiché avant validation (« ${gtag.replace(/\n/g, ' | ')} »)`);
  await shot(page, '02-quadrillage-apercu');
  const m0 = await money(page);
  const gp = await scr(page, cx + 150, cz + 80);
  await page.mouse.click(gp.x, gp.y);
  const m1 = await waitMoney(page, m0);
  await page.waitForTimeout(800);
  rd = await roads(page);
  check(m0 - m1 === p.cost, `coût débité = coût affiché (${m0 - m1} ¢ / ${p.cost} ¢)`);
  const gridEdges = rd.edges.length - 2;
  check(gridEdges >= p.lines && gridEdges >= 2 * p.nx * p.nz, `îlots construits avec leurs carrefours (${gridEdges} tronçons pour ${p.lines} rues)`);
  await page.keyboard.press('Escape');
  await shot(page, '03-quadrillage-construit');

  // Bornes du quadrillage (nœuds créés à l'est de cx − 8).
  const nodeXZ = rd.nodes.map((n) => (Array.isArray(n) ? [n[1], n[3]] : [n.x, n.z])).filter(([x]) => x >= cx - 8);
  const x0 = Math.min(...nodeXZ.map((q) => q[0])), x1 = Math.max(...nodeXZ.map((q) => q[0]));
  const z0 = Math.min(...nodeXZ.map((q) => q[1])), z1 = Math.max(...nodeXZ.map((q) => q[1]));
  R.notes.gridBounds = { x0, x1, z0, z1, nodes: nodeXZ.length };

  // 3. Ligne guide parallèle à 48 m de la rue ouest du quadrillage.
  await page.click('#tool-actions button:has-text("Droite")');
  await page.click('#tool-actions button:has-text("48 m")');
  await hoverWorld(page, x0 - 49.5, (z0 + z1) / 2 + 3);
  p = await preview(page);
  const guideTag = await tag(page);
  R.notes.guide = { preview: p, tag: guideTag };
  check(/parallèle à la route · îlot 48 m/.test(p.guide ?? ''), `ligne guide parallèle à distance d'îlot (« ${p.guide} »)`);
  await shot(page, '04-ligne-guide');
  await page.keyboard.press('Escape');

  // 4. Améliorer : rue sud du quadrillage → avenue.
  await page.click('#toolbar button[data-tool=road]').catch(() => undefined);
  if (await visibleBox(page, '#build-drawer')) await page.click('#drawer-close');
  await page.click('#tool-actions button:has-text("Améliorer")');
  await page.click('#tool-actions button:has-text("Gamme +")');
  const sx = x0 + 24, sz = z0;
  await hoverWorld(page, sx, sz);
  await page.waitForTimeout(500);
  await render(page, 1);
  p = await preview(page);
  const utag = await tag(page);
  R.notes.upgrade = { preview: p, tag: utag };
  check(p.kind === 'upgrade' && p.from === 'street' && p.toKind === 'avenue' && p.validity === 'ok' && p.cost > 0, `aperçu rue → avenue : ${p.cost} ¢ (${p.message || 'ok'})`);
  check(/Rue → Avenue/.test(utag) && /différence/.test(utag), `étiquette de l'outil Améliorer (« ${utag.replace(/\n/g, ' | ')} »)`);
  await shot(page, '05-ameliorer-apercu');
  const m2 = await money(page);
  const up = await scr(page, sx, sz);
  await page.mouse.click(up.x, up.y);
  const m3 = await waitMoney(page, m2);
  await page.waitForTimeout(600);
  rd = await roads(page);
  check(m2 - m3 === p.cost, `différence facturée (${m2 - m3} ¢)`);
  check(rd.edges.some((e) => e.kind === 'avenue'), 'le tronçon est devenu une avenue sans démolition');
  await render(page, 2);
  await shot(page, '06-ameliorer-avenue');

  // Refus motivé : maison posée au plus près de la rue nord (au sud de son axe), puis tentative rue → avenue.
  const house = await page.evaluate(async ([x, z]) => {
    for (let k = 7; k <= 40; k += 0.5) {
      try { const r = await window.__aube.send('placeBuilding', { assetId: 'maison_pavillon_enduit', x, z: z - k, rot: 2 }); return { ok: true, k, id: r.buildingId }; } catch { /* plus loin */ }
    }
    return { ok: false };
  }, [x0 + 24, z1]);
  R.notes.house = house;
  await page.waitForTimeout(600);
  await hoverWorld(page, x0 + 24, z1);
  await page.waitForTimeout(600);
  await render(page, 1);
  p = await preview(page);
  R.notes.refusal = { preview: p, tag: await tag(page) };
  if (house.ok) {
    check(p.kind === 'upgrade' && p.validity === 'error' && /empiète/.test(p.message), `refus motivé avant le clic (« ${p.message} »)`);
    await shot(page, '07-ameliorer-refus');
    const pr = await scr(page, x0 + 24, z1);
    await page.mouse.click(pr.x, pr.y);
    await page.waitForTimeout(800);
    const toast = await page.evaluate(() => [...document.querySelectorAll('#toasts > *')].map((t) => t.textContent).join(' | '));
    R.notes.refusalToast = toast;
    check(/Modification refusée : Élargissement impossible/.test(toast), `notification de refus (« ${toast.slice(0, 160)} »)`);
    const still = await send(page, 'save', { slot: 'e2e-routes' });
    check(still.r.data.buildings.some((b) => b.id === house.id), 'la maison riveraine est restée en place');
  } else check(false, 'maison de test non posée');
  check(errors.length === 0, `aucune erreur de page (souris)${errors.length ? ' : ' + errors.slice(0, 4).join(' | ') : ''}`);
  await ctx.close();

  /* ------------------------------ iPhone 13 au doigt ------------------------------ */
  const ph = await open({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const P = ph.page;
  await P.evaluate(([x, z]) => window.__aube.lookAt(x, z, 300), [cx - 40, cz + 40]);
  await P.evaluate(() => window.__aube.renderNow(16, 0.5));
  await P.tap('#toolbar button[data-tool=road]');
  await P.waitForTimeout(400);
  await P.tap('#drawer-body .road-card[data-road=street]');
  await P.waitForTimeout(300);
  let box = await visibleBox(P, '#tool-options');
  check(box && box.x >= 0 && box.right <= box.W && box.bottom <= box.H, `options Routes dans l'écran (${box ? `${Math.round(box.w)}×${Math.round(box.h)}` : 'masquées'})`);
  await shot(P, '08-iphone-options-routes');
  // Le doigt est décalé de 70 px : on touche 70 px sous le point visé.
  const tapWorld = async (x, z) => { const q = await scr(P, x, z); await P.touchscreen.tap(q.x, q.y + 70); await P.waitForTimeout(500); await P.evaluate(() => window.__aube.renderNow(1, 0.1)); };
  await tapWorld(cx - 120, cz + 10);
  await tapWorld(cx - 40, cz + 10);
  const tc = await P.evaluate(() => ({ shown: !document.querySelector('#touch-confirm').classList.contains('hidden'), label: document.querySelector('#tc-ok').textContent }));
  R.notes.iphoneConfirm = tc;
  check(tc.shown && /Tracer · [\d  ]+ ¢/.test(tc.label), `barre de confirmation au doigt avec le coût (« ${tc.label} »)`);
  await shot(P, '09-iphone-confirmation');
  await P.tap('#tc-ok');
  await P.waitForTimeout(800);
  let prd = await roads(P);
  check(prd.edges.length >= 1, `route construite au doigt (${prd.edges.length} tronçon)`);
  box = await visibleBox(P, '#road-finish');
  R.notes.iphoneFinish = box;
  check(box && box.h >= 44 && box.x >= 0 && box.right <= box.W && box.bottom <= box.H, `« Terminer le tracé » bien visible au doigt (${box ? `${Math.round(box.w)}×${Math.round(box.h)} à y=${Math.round(box.y)}` : 'absent'})`);
  // Enchaînement au doigt : un seul toucher pour l'arrivée suivante, puis confirmation.
  await tapWorld(cx - 40, cz + 80);
  const tc2 = await P.evaluate(() => !document.querySelector('#touch-confirm').classList.contains('hidden'));
  box = await visibleBox(P, '#road-finish');
  check(tc2 && !!box, 'tronçon suivant : confirmation ET bouton Terminer visibles ensemble');
  await shot(P, '10-iphone-enchainement');
  await P.tap('#tc-ok');
  await P.waitForTimeout(800);
  prd = await roads(P);
  check(prd.edges.length >= 2, `2e tronçon enchaîné au doigt (${prd.edges.length})`);
  await P.tap('#road-finish');
  await P.waitForTimeout(300);
  const after = await preview(P);
  check(!after.drawing && !(await visibleBox(P, '#road-finish')), 'Terminer au doigt : tracé arrêté');
  // Quadrillage au doigt : options visibles.
  await P.tap('#tool-actions button:has-text("Quadrillage")');
  await P.waitForTimeout(300);
  box = await visibleBox(P, '#tool-options');
  check(box && box.right <= box.W && box.bottom <= box.H, 'options du quadrillage dans l\'écran (iPhone)');
  await tapWorld(cx - 150, cz + 120);
  await tapWorld(cx - 60, cz + 200);
  const tc3 = await P.evaluate(() => document.querySelector('#tc-ok').textContent);
  R.notes.iphoneGrid = { label: tc3, preview: await preview(P) };
  check(/Construire l’îlot · [\d  ]+ ¢|Îlot refusé/.test(tc3), `quadrillage au doigt : coût dans la confirmation (« ${tc3} »)`);
  await shot(P, '11-iphone-quadrillage');
  await P.tap('#tc-cancel');
  check(ph.errors.length === 0, `aucune erreur de page (iPhone)${ph.errors.length ? ' : ' + ph.errors.slice(0, 4).join(' | ') : ''}`);
  await ph.ctx.close();
} catch (e) {
  console.error('ÉCHEC', e);
  failed = true;
} finally {
  writeFileSync(join(out, 'road-tools.json'), JSON.stringify(R, null, 2));
  await browser.close();
  server.close();
}
if (failed) { console.log('Outils de voirie : ÉCHEC'); process.exit(1); }
console.log('Outils de voirie : OK');
