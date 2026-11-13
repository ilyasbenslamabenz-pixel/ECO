/**
 * Non-régression mémoire sur iPhone (émulé : 390×844, rapport 3, agent utilisateur iPhone → mode allégé) :
 * nouvelle partie, menu Bâtiments ouvert et parcouru, maison choisie, fantôme déplacé, maison posée.
 * Safari plantait à l'ouverture du menu : les vignettes créaient un SECOND contexte WebGL et y renvoyaient en
 * pleine taille les textures d'une soixantaine de modèles. Vérifie à chaque étape : un seul contexte WebGL,
 * tas JS et mémoire graphique bornés.
 * Usage : node tests/e2e/mobile-batiment.mjs (après npm run build)
 */
import { collectErrors, launch, serve } from './lib.mjs';

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const { server, base } = await serve();
const browser = await launch();
let failed = false;
const check = (ok, msg) => { console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${msg}`); if (!ok) failed = true; };
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE_UA });
  await ctx.addInitScript(() => {
    // Contextes WebGL créés, et octets de textures envoyés au GPU (niveau 0, mipmaps comptées).
    const acc = { contexts: 0, tex: 0 };
    window.__memProbe = acc;
    const gc = HTMLCanvasElement.prototype.getContext;
    const seen = new WeakSet();
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      const c = gc.call(this, type, ...rest);
      if (c && /webgl/.test(String(type)) && !seen.has(this)) { seen.add(this); acc.contexts++; }
      return c;
    };
    if (typeof OffscreenCanvas !== 'undefined') {
      const go = OffscreenCanvas.prototype.getContext;
      OffscreenCanvas.prototype.getContext = function (type, ...rest) { const c = go.call(this, type, ...rest); if (c && /webgl/.test(String(type))) acc.contexts++; return c; };
    }
    const P = WebGL2RenderingContext.prototype;
    const ts = P.texStorage2D; P.texStorage2D = function (t, l, f, w, h) { acc.tex += w * h * 4 * (l > 1 ? 1.33 : 1); return ts.apply(this, arguments); };
    const ti = P.texImage2D; P.texImage2D = function (...a) { if (a[1] === 0) { const s = a[a.length - 1]; const w = a.length >= 9 ? a[3] : s?.width ?? 0, h = a.length >= 9 ? a[4] : s?.height ?? 0; acc.tex += w * h * 4 * 1.33; } return ti.apply(this, a); };
  });
  const page = await ctx.newPage();
  const errors = collectErrors(page);
  const cdp = await ctx.newCDPSession(page);
  const measure = async (step) => {
    await cdp.send('HeapProfiler.collectGarbage').catch(() => undefined);
    const heap = await cdp.send('Runtime.getHeapUsage');
    const m = await page.evaluate(() => ({ ...window.__aube.memStats(), contexts: window.__memProbe.contexts, texMo: Math.round(window.__memProbe.tex / 1048576), lite: window.__aube.liteMode }));
    const r = { step, heapMo: +(heap.usedSize / 1048576).toFixed(1), ...m };
    console.log('     ', JSON.stringify(r));
    return r;
  };
  await page.goto(`${base}/index.html?autostart&seed=42&norender`, { timeout: 300000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__aube?.ready && window.__aube.snapshotReceived && window.__aube.lastStats, null, { timeout: 300000, polling: 300 });
  await page.evaluate(() => window.__aube.send('setSpeed', { speed: 0 }));
  const cx = 116, cz = 356;
  await page.evaluate(([x, z]) => window.__aube.send('buildRoad', { type: 'street', kind: 'avenue', points: [x - 120, z, x + 120, z] }), [cx, cz]);
  await page.evaluate(([x, z]) => window.__aube.lookAt(x, z, 120), [cx, cz]);
  await page.evaluate(() => window.__aube.renderNow(4, 0.1));
  const m0 = await measure('partie prête');
  check(m0.lite === true, 'mode allégé actif (agent utilisateur iPhone)');

  await page.tap('#toolbar button[data-tool=building], #toolbar button[data-cat=batiments], #toolbar button[data-cat=residentiel]').catch(async () => {
    await page.locator('#toolbar button', { hasText: 'Bâtiments' }).first().tap();
  });
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.__aube.renderNow(2, 0.1));
  const m1 = await measure('menu Bâtiments ouvert');
  // Défilement du tiroir : les vignettes suivantes se chargent au fil de l'eau.
  await page.evaluate(async () => {
    const d = document.querySelector('#drawer-body');
    for (let i = 0; d && i < 6; i++) { d.scrollLeft += 300; d.scrollTop += 200; await new Promise((r) => setTimeout(r, 300)); }
  });
  await page.waitForTimeout(2500);
  const m2 = await measure('tiroir parcouru');
  const card = page.locator('#drawer-body .card[data-asset]').first();
  await card.tap();
  await page.waitForTimeout(800);
  const p = await page.evaluate(([x, z]) => window.__aube.worldToScreen(x, z + 22), [cx, cz]);
  await page.mouse.move(p.x, p.y);
  for (let i = 0; i < 12; i++) { await page.mouse.move(p.x + i * 4, p.y); await page.evaluate(() => window.__aube.renderNow(1, 0.05)); }
  const m3 = await measure('fantôme déplacé');
  await page.tap('#tc-ok').catch(() => page.mouse.click(p.x + 44, p.y));
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__aube.renderNow(3, 0.1));
  const m4 = await measure('maison posée');
  const placed = await page.evaluate(() => window.__aube.sceneCheck().buildings);
  check(placed >= 1, `maison posée (${placed} bâtiment)`);

  check(Math.max(m1.contexts, m2.contexts, m3.contexts, m4.contexts) === 1, `un seul contexte WebGL (${m4.contexts}) : les vignettes utilisent le renderer principal`);
  check(m2.heapMo - m0.heapMo < 40, `tas JS borné à l'ouverture du menu (+${(m2.heapMo - m0.heapMo).toFixed(1)} Mo)`);
  check(m4.texMo - m0.texMo < 120, `textures envoyées au GPU bornées (+${m4.texMo - m0.texMo} Mo)`);
  check(m4.texMo < 300, `textures GPU au total < 300 Mo (${m4.texMo} Mo)`);
  check(errors.length === 0, `aucune erreur de page (${errors.length}) ${errors.slice(0, 2).join(' | ')}`);
} catch (e) {
  console.error(e);
  check(false, `exception : ${e instanceof Error ? e.message : String(e)}`);
} finally {
  await browser.close();
  server.close();
}
console.log(failed ? '\nMOBILE BÂTIMENT : ÉCHEC' : '\nMOBILE BÂTIMENT : SUCCÈS');
process.exit(failed ? 1 : 0);
