/**
 * Outils du tiroir Terrain sur iPhone (portrait) : le tiroir, la barre d'options (outils + rayons / largeurs) et
 * l'étiquette du curseur tiennent dans l'écran ; un tap place le départ du quai ; boutons tactiles ≥ 40 px.
 * Captures docs/captures-carte/apres-iphone-*.png.   node tests/e2e/carte-iphone.mjs
 */
import { join } from 'node:path';
import { collectErrors, launch, root, serve } from './lib.mjs';

const outDir = join(root, 'docs', 'captures-carte');
const VIEWS = [{ name: 'se', w: 375, h: 667 }, { name: '13', w: 390, h: 844 }];
let failures = 0;

const overflow = () => {
  const W = window.innerWidth, H = window.innerHeight, res = [];
  if (document.documentElement.scrollWidth > W + 0.5) res.push(`document ${document.documentElement.scrollWidth} px`);
  for (const r of document.querySelectorAll('#toolbar, #build-drawer:not(.hidden), #tool-options:not(.hidden), #cursor-tag:not(.hidden)')) {
    for (const el of [r, ...r.querySelectorAll('*')]) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const b = el.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) continue;
      let sc = el.parentElement, clipped = false;
      while (sc && sc !== r.parentElement) {
        const s = getComputedStyle(sc);
        if (/(auto|scroll|hidden)/.test(s.overflowX + s.overflowY)) { clipped = true; break; }
        sc = sc.parentElement;
      }
      if (clipped && el !== r) continue;
      if (b.left < -0.5 || b.top < -0.5 || b.right > W + 0.5 || b.bottom > H + 0.5) res.push(`${el.id || el.className} [${b.left.toFixed(0)}..${b.right.toFixed(0)}]`);
    }
  }
  for (const b of document.querySelectorAll('#tool-options button, #build-drawer:not(.hidden) button')) {
    if (!b.offsetParent) continue;
    const r = b.getBoundingClientRect();
    if (Math.min(r.width, r.height) < 39.5) res.push(`bouton trop petit « ${b.textContent} » ${r.width.toFixed(0)}×${r.height.toFixed(0)}`);
  }
  return res.slice(0, 10);
};

const { server, base } = await serve();
const browser = await launch();
try {
  for (const v of VIEWS) {
    const ctx = await browser.newContext({ viewport: { width: v.w, height: v.h }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    const errors = collectErrors(page);
    await page.goto(`${base}/index.html?autostart&norender&seed=7`);
    await page.waitForFunction(() => window.__aube?.ready === true && window.__aube.snapshotReceived, null, { timeout: 300000 });
    await page.evaluate(() => window.__aube.send('setSpeed', { speed: 0 }));
    await page.tap('#toolbar button[data-cat="terrain"]');
    await page.waitForTimeout(400);
    const drawerBad = await page.evaluate(overflow);
    const tiles = await page.evaluate(() => [...document.querySelectorAll('#drawer-body [data-terrain]')].map((b) => b.dataset.terrain));
    await page.evaluate(() => window.__aube.renderNow(1));
    await page.screenshot({ path: join(outDir, `apres-iphone-${v.name}-tiroir.png`) });
    await page.tap('#drawer-body button[data-terrain="dig"]');
    await page.waitForTimeout(300);
    // Un tap au centre de l'écran : départ du canal posé (au relâcher).
    await page.touchscreen.tap(v.w / 2, v.h * 0.45);
    await page.evaluate(() => window.__aube.renderNow(1));
    await page.waitForTimeout(300);
    const pv = await page.evaluate(() => window.__aube.toolPreview());
    const optsBad = await page.evaluate(overflow);
    await page.evaluate(() => window.__aube.renderNow(1));
    await page.screenshot({ path: join(outDir, `apres-iphone-${v.name}-creuser.png`) });
    const bad = [...drawerBad, ...optsBad];
    const ok = bad.length === 0 && errors.length === 0 && tiles.join() === 'clear,quay,dig' && pv.kind === 'terrain' && !!pv.start;
    if (!ok) failures++;
    console.log(`${ok ? 'OK' : 'ÉCHEC'} iPhone ${v.name} : tiroir ${tiles.join('/')}, départ ${pv.start ? 'posé' : 'absent'}${bad.length ? `\n  ${bad.join('\n  ')}` : ''}${errors.length ? `\n  erreurs : ${errors.slice(0, 3).join(' | ')}` : ''}`);
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log(failures ? `Terrain iPhone : ${failures} ÉCHEC(S)` : 'Terrain iPhone : OK');
process.exit(failures ? 1 : 0);
