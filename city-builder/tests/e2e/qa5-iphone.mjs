/**
 * Recette QA n° 5 — iPhone 13 émulé, portrait 390×844 et paysage 844×390, au DOIGT (tap) :
 *  barre supérieure (contenu lisible, vitesses), tiroir des tableaux de bord (chaque tableau ouvert),
 *  barre d'outils (chaque catégorie), mini-carte, panneaux en feuille, chevauchements et débordements.
 * Lancement : npm run build puis node tests/e2e/qa5-iphone.mjs. Sorties : tests/e2e/out/qa5/iphone-*.png + iphone.json.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectErrors, launch, root, serve } from './lib.mjs';

const out = join(root, 'tests/e2e/out/qa5');
mkdirSync(out, { recursive: true });
const R = { checks: [], notes: {} };
let failed = false;
const check = (ok, msg) => { R.checks.push({ ok: !!ok, msg }); console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${msg}`); if (!ok) failed = true; };
const note = (k, v) => { R.notes[k] = v; console.log(`     ${k}: ${JSON.stringify(v).slice(0, 400)}`); };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

/** Éléments visibles qui sortent de l'écran ou se chevauchent (barres et panneaux). */
const layoutAudit = () => {
  const W = innerWidth, H = innerHeight;
  const vis = (e) => { if (!e) return false; const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > 0.05 && r.width > 0 && r.height > 0; };
  const offscreen = [...document.querySelectorAll('#hud button, #hud .hud-stat, #toolbar, #minimap, #objectives, #finance-panel, #pop-panel, #dash-panel, #build-drawer, #sidebar')]
    .filter(vis).map((e) => ({ id: e.id || e.className.split(' ')[0] || e.tagName, r: e.getBoundingClientRect() }))
    .filter(({ r }) => r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1).map(({ id, r }) => ({ id, l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) }));
  const blocks = ['#hud', '#toolbar', '#minimap', '#objectives', '#finance-panel', '#pop-panel', '#dash-panel', '#build-drawer'].map((s) => [s, document.querySelector(s)]).filter(([, e]) => vis(e)).map(([s, e]) => [s, e.getBoundingClientRect()]);
  const overlaps = [];
  for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) {
    const [a, ra] = blocks[i], [b, rb] = blocks[j];
    const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
    if (w > 4 && h > 4) overlaps.push(`${a}×${b} (${Math.round(w)}×${Math.round(h)})`);
  }
  const small = [...document.querySelectorAll('#hud button, #toolbar button, #minimap button, #sidebar button')].filter(vis)
    .map((b) => ({ id: b.id || b.dataset.tool || b.dataset.cat || b.dataset.speed || b.dataset.dash, s: Math.round(Math.min(b.getBoundingClientRect().width, b.getBoundingClientRect().height)) })).filter((x) => x.s < 40);
  const truncated = [...document.querySelectorAll('#hud .v, #hud span, .ptabs button, #toolbar .tl')].filter(vis).filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'visible').map((e) => e.id || e.textContent.trim()).slice(0, 10);
  return { W, H, docW: document.documentElement.scrollWidth, offscreen, overlaps, small, truncated,
    hud: [...document.querySelectorAll('#hud .hud-stat, #hud-city, #hud-date, #hud-money, #hud-pop')].filter(vis).map((e) => e.textContent.replace(/\s+/g, ' ').trim()).slice(0, 12) };
};

const { server, base } = await serve();
const browser = await launch();
try {
  for (const [orient, vw, vh] of [['portrait', 390, 844], ['paysage', 844, 390]]) {
    const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, userAgent: UA });
    const page = await ctx.newPage();
    const errors = collectErrors(page);
    const render = (n = 1, dt = 1 / 30) => page.evaluate(([k, d]) => window.__aube.renderNow(k, d), [n, dt]);
    const shot = async (name) => { await render(2, 0.3); await page.waitForTimeout(1500); await render(1, 0.05); await page.screenshot({ path: join(out, `iphone-${orient}-${name}.png`), timeout: 600000 }); };
    await page.goto(`${base}/index.html?autostart&seed=42&norender`, { timeout: 300000, waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__aube?.ready && window.__aube.snapshotReceived && window.__aube.lastStats, null, { timeout: 300000, polling: 500 });
    await page.evaluate(() => window.__aube.send('setSpeed', { speed: 0 }));
    await page.evaluate(() => window.__aube.lookAt(0, 0, 500, 0.8, 0.5));
    await render(6, 0.5);
    const a0 = await page.evaluate(layoutAudit);
    note(`${orient}-audit`, a0);
    check(a0.docW <= vw && a0.offscreen.length === 0, `${orient} : rien hors écran (${JSON.stringify(a0.offscreen)}, largeur doc ${a0.docW})`);
    check(a0.small.length === 0, `${orient} : cibles tactiles ≥ 40 px ${JSON.stringify(a0.small)}`);
    check(a0.overlaps.length === 0, `${orient} : aucun chevauchement des barres ${JSON.stringify(a0.overlaps)}`);
    check(/CHF/.test(a0.hud.join(' ')), `${orient} : trésorerie en CHF visible (${a0.hud.join(' | ')})`);
    await shot('jeu');
    // Vitesses au doigt.
    for (const sp of [2, 16, 0]) {
      const b = page.locator(`#hud .seg button[data-speed="${sp}"]`);
      if (!(await b.isVisible())) { check(false, `${orient} : bouton ×${sp} visible`); continue; }
      await b.tap();
      await page.waitForFunction((v) => window.__aube.lastStats?.speed === v, sp, { timeout: 15000 }).catch(() => undefined);
      check((await page.evaluate(() => window.__aube.lastStats.speed)) === sp, `${orient} : tap vitesse ×${sp}`);
    }
    // Tiroir des tableaux de bord : chacun.
    const dashes = await page.evaluate(() => [...document.querySelectorAll('#sidebar button[data-dash]')].map((b) => ({ id: b.dataset.dash, disabled: b.disabled })));
    let opened = 0;
    for (const d of dashes.filter((x) => !x.disabled)) {
      if (await page.locator('#btn-sidebar').isVisible()) { await page.locator('#btn-sidebar').tap(); await page.waitForTimeout(350); }
      await page.locator(`#sidebar button[data-dash=${d.id}]`).tap();
      await page.waitForTimeout(450);
      const a = await page.evaluate(layoutAudit);
      const panel = await page.evaluate(() => ['#finance-panel', '#pop-panel', '#dash-panel'].find((s) => { const e = document.querySelector(s); return e && getComputedStyle(e).display !== 'none' && !e.classList.contains('hidden') && e.getBoundingClientRect().height > 0; }) ?? null);
      if (panel) opened++;
      note(`${orient}-dash-${d.id}`, { panel, offscreen: a.offscreen, overlaps: a.overlaps });
      check(panel && a.offscreen.length === 0, `${orient} : tableau « ${d.id} » ouvert dans l'écran (${panel})`);
      if (['finance', 'transport', 'city'].includes(d.id)) await shot(`dash-${d.id}`);
      const close = await page.evaluate(() => ['#finance-close', '#pop-close', '#dash-close'].find((s) => { const e = document.querySelector(s); return e && e.offsetParent; }));
      if (close) await page.locator(close).tap();
    }
    note(`${orient}-tableaux`, { total: dashes.length, actifs: dashes.filter((d) => !d.disabled).length, ouverts: opened });
    // Barre d'outils : chaque catégorie.
    const cats = await page.evaluate(() => [...document.querySelectorAll('#toolbar button[data-cat], #toolbar button[data-tool=road], #toolbar button[data-tool=building]')].map((b) => b.dataset.cat ?? b.dataset.tool));
    for (const c of cats) {
      const sel = ['road', 'building'].includes(c) ? `#toolbar button[data-tool=${c}]` : `#toolbar button[data-cat=${c}]`;
      await page.locator(sel).scrollIntoViewIfNeeded();
      await page.locator(sel).tap();
      await page.waitForTimeout(350);
      const a = await page.evaluate(layoutAudit);
      const dr = await page.evaluate(() => { const d = document.querySelector('#build-drawer'); const r = d.getBoundingClientRect(); return { open: getComputedStyle(d).display !== 'none' && r.height > 0, top: Math.round(r.top), bottom: Math.round(r.bottom), cards: d.querySelectorAll('.card, .tile, .road-card').length }; });
      check(dr.open && a.offscreen.length === 0, `${orient} : outil « ${c} » → sous-barre dans l'écran (${JSON.stringify(dr)})`);
      if (['zones', 'road', 'transport'].includes(c)) await shot(`outil-${c}`);
      if (await page.locator('#drawer-close').isVisible()) await page.locator('#drawer-close').tap();
      await page.locator('#toolbar button[data-tool=select]').tap().catch(() => undefined);
    }
    // Mini-carte.
    const mm = await page.evaluate(() => { const e = document.querySelector('#minimap'); const r = e?.getBoundingClientRect(); return e ? { shown: getComputedStyle(e).display !== 'none' && r.height > 0, w: Math.round(r.width), h: Math.round(r.height) } : null; });
    note(`${orient}-minicarte`, mm);
    if (mm?.shown && await page.locator('#mm-zoom-in').isVisible()) {
      const d0 = (await page.evaluate(() => window.__aube.cameraPose())).distance;
      await page.locator('#mm-zoom-in').tap(); await render(20, 0.5);
      const d1 = (await page.evaluate(() => window.__aube.cameraPose())).distance;
      check(d1 < d0, `${orient} : mini-carte zoom + (${d0.toFixed(0)} → ${d1.toFixed(0)} m)`);
    }
    check(errors.length === 0, `${orient} : aucune erreur console (${errors.length}) ${errors.slice(0, 3).join(' | ')}`);
    await ctx.close();
  }
} catch (e) {
  console.error('ERREUR', e); R.crash = String(e?.stack ?? e); failed = true;
} finally {
  writeFileSync(join(out, 'iphone.json'), JSON.stringify(R, null, 2));
  await browser.close(); server.close();
}
console.log(failed ? '\nQA5 IPHONE : ÉCHEC' : `\nQA5 IPHONE : SUCCÈS (${R.checks.length} vérifications)`);
process.exit(failed ? 1 : 0);
