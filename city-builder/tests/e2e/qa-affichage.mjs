/**
 * Parcours QA « affichage » : captures de chaque écran sur iPhone (390×844, tactile, mode allégé) et ordinateur
 * (1440×900). Relecture humaine des images ; contrôles automatiques légers (texte tronqué, éléments hors écran,
 * vignettes trop sombres, arbres sur les routes).
 * Usage : node tests/e2e/qa-affichage.mjs [iphone|paysage|desktop|all] [préfixe]   (après npm run build ; STEPS=03-partie,04-batiments pour un sous-ensemble)
 * Captures : docs/captures-qa-affichage/<préfixe>-<appareil>-<étape>.jpg
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectErrors, launch, root, serve } from './lib.mjs';

const only = process.argv[2] ?? 'all';
const prefix = process.argv[3] ?? 'apres';
const steps = process.env.STEPS ? process.env.STEPS.split(',') : null;
const out = join(root, 'docs/captures-qa-affichage');
mkdirSync(out, { recursive: true });
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const DEVICES = {
  iphone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, userAgent: IPHONE_UA, q: 'lite=1' },
  // iPhone 17 Pro (402×874) en paysage : barre d'outils sur une rangée.
  paysage: { viewport: { width: 874, height: 402 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, userAgent: IPHONE_UA, q: 'lite=1' },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, q: 'lite=0' },
};
const { server, base } = await serve();
const browser = await launch();
const report = {};
let failures = 0;
const render = (page, n = 2, dt = 0.1) => page.evaluate(([k, d]) => window.__aube.renderNow?.(k, d), [n, dt]);

async function shot(page, dev, name) {
  if (steps && !steps.includes(name)) return;
  await render(page, 2);
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(out, `${prefix}-${dev}-${name}.jpg`), type: 'jpeg', quality: 78, timeout: 600000 }).catch((e) => console.log(`  capture ${name} : ${e.message.split('\n')[0]}`));
  const issues = await layoutIssues(page);
  report[`${dev}/${name}`] = issues;
  if (issues.length) console.log(`  ${dev}/${name} :\n    ${issues.join('\n    ')}`);
  else console.log(`  ${dev}/${name} : OK`);
}

/** Textes tronqués, éléments visibles hors écran ou sous la barre du haut. */
function layoutIssues(page) {
  return page.evaluate(() => {
    const W = innerWidth, H = innerHeight, res = [];
    const hud = document.querySelector('#hud:not(.hidden)')?.getBoundingClientRect();
    const vis = (el) => { const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false; const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
    const name = (el) => el.id ? '#' + el.id : `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''}«${(el.textContent || '').trim().slice(0, 24)}»`;
    // Ancêtre à défilement : un élément hors de l'écran mais dans un conteneur défilant est normal.
    const inScroller = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { const s = getComputedStyle(p); if (/(auto|scroll)/.test(s.overflowX + s.overflowY)) return true; } return false; };
    for (const el of document.querySelectorAll('body *')) {
      if (el.closest('.hidden') || !vis(el) || el.tagName === 'CANVAS' && el.id === 'scene') continue;
      if (el.closest('#loading')) continue;
      const b = el.getBoundingClientRect();
      if (!inScroller(el) && (b.left < -1 || b.right > W + 1 || b.top < -1 || b.bottom > H + 1)) res.push(`hors écran ${name(el)} [${b.left|0},${b.top|0}→${b.right|0},${b.bottom|0}]`);
      // Texte tronqué (ellipse CSS ou débordement d'une boîte qui coupe).
      const cs = getComputedStyle(el);
      if (el.matches('.sr')) continue;
      if (el.children.length === 0 && el.textContent.trim() && (cs.textOverflow === 'ellipsis' || cs.overflow === 'hidden' || cs.overflowX === 'hidden') && el.scrollWidth > el.clientWidth + 1) res.push(`texte tronqué ${name(el)} (${el.scrollWidth}>${el.clientWidth})`);
      // Panneau sous la barre du haut.
      if (hud && el.matches('.panel:not(.hidden), .sheet, #build-drawer, #notif-panel') && b.top < hud.bottom - 1 && b.bottom > hud.top) res.push(`sous la barre du haut ${name(el)} (haut ${b.top|0} < ${hud.bottom|0})`);
    }
    return [...new Set(res)].slice(0, 20);
  });
}

/** Luminance moyenne des vignettes visibles (0..255), lue dans les images data:. */
function thumbLuma(page, sel) {
  return page.evaluate(async (sel) => {
    const imgs = [...document.querySelectorAll(sel)].filter((i) => i.complete && i.naturalWidth > 0).slice(0, 12);
    const c = document.createElement('canvas'); const x = c.getContext('2d', { willReadFrequently: true });
    const out = [];
    for (const im of imgs) {
      c.width = im.naturalWidth; c.height = im.naturalHeight; x.clearRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height).data; let s = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 128) { s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; n++; }
      out.push(n ? Math.round(s / n) : -1);
    }
    return out;
  }, sel);
}

/** Ferme tiroirs et panneaux sans passer par Échap (qui ouvre le menu quand rien n'est ouvert). */
async function closeAll(page) {
  for (const sel of ['#drawer-close', '#info-close', '#finance-close', '.panel:not(.hidden) .icon-btn[id$=close]', '#sidebar-scrim:not(.hidden)']) {
    const l = page.locator(sel).first();
    if (await l.isVisible().catch(() => false)) await l.click({ timeout: 2000 }).catch(() => undefined);
  }
  if (await page.locator('#main-menu:not(.hidden)').isVisible().catch(() => false)) await page.keyboard.press('Escape');
  await page.locator('#toolbar button[data-tool=select]').click({ timeout: 2000 }).catch(() => undefined);
  await page.waitForTimeout(300);
}

async function tap(page, dev, sel) {
  const loc = page.locator(sel).first();
  if (dev !== 'desktop') await loc.tap({ timeout: 5000 }); else await loc.click({ timeout: 5000 });
  await page.waitForTimeout(500);
}

async function runDevice(dev) {
  const d = DEVICES[dev];
  console.log(`== ${dev}`);
  const ctx = await browser.newContext({ viewport: d.viewport, deviceScaleFactor: d.deviceScaleFactor, isMobile: !!d.isMobile, hasTouch: !!d.hasTouch, ...(d.userAgent ? { userAgent: d.userAgent } : {}) });
  const page = await ctx.newPage();
  const errors = collectErrors(page);
  // Menu principal.
  await page.goto(`${base}/index.html?${d.q}&norender`, { timeout: 300000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__aube?.ready || !document.querySelector('#main-menu.hidden'), null, { timeout: 300000 });
  await page.waitForSelector('#main-menu:not(.hidden)', { timeout: 300000 });
  await page.waitForTimeout(800);
  await shot(page, dev, '01-menu');
  await tap(page, dev, '#btn-new');
  await shot(page, dev, '02-nouvelle-partie');
  // Partie avec la ville de départ (seed fixe).
  await page.goto(`${base}/index.html?${d.q}&autostart&seed=42&norender`, { timeout: 300000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__aube?.ready && window.__aube.snapshotReceived && window.__aube.lastStats, null, { timeout: 300000, polling: 300 });
  await page.evaluate(() => window.__aube.send('setSpeed', { speed: 0 }));
  const cx = 116, cz = 356;
  // Route ordinaire, bâtiment posé par la simulation, arbres plantés de part et d'autre.
  await page.evaluate(([x, z]) => window.__aube.send('buildRoad', { type: 'street', kind: 'avenue', points: [x - 120, z, x + 120, z] }), [cx, cz]);
  await page.evaluate(([x, z]) => window.__aube.lookAt(x, z, 140), [cx, cz]);
  await render(page, 4);
  await shot(page, dev, '03-partie');
  for (const [sel, nm] of [['#toolbar button[data-tool=building]', '04-batiments'], ['#toolbar button[data-tool=road]', '05-routes'], ['#toolbar button[data-cat=services]', '06-services'], ['#toolbar button[data-cat=transport]', '07-transports'], ['#toolbar button[data-cat=environment]', '08-nature'], ['#toolbar button[data-tool=bulldoze]', '09-demolir']]) {
    if (steps && !steps.includes(nm)) continue;
    await tap(page, dev, sel).catch((e) => console.log(`  ${nm} : ${e.message.split('\n')[0]}`));
    await page.waitForTimeout(1500);
    if (nm === '04-batiments') {
      await page.waitForFunction(() => document.querySelectorAll('#drawer-body img').length > 0 && [...document.querySelectorAll('#drawer-body img')].slice(0, 3).every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 120000 }).catch(() => undefined);
      const l = await thumbLuma(page, '#drawer-body img');
      report[`${dev}/vignettes-barre`] = l;
      console.log(`  luminance vignettes barre : ${l.join(' ')}`);
    }
    await shot(page, dev, nm);
    await closeAll(page);
  }
  // Placement d'un bâtiment.
  if (!steps || steps.includes('10-placement') || steps.includes('11-info-batiment')) {
    await tap(page, dev, '#toolbar button[data-tool=building]');
    await page.waitForTimeout(1000);
    await tap(page, dev, '#drawer-body .card[data-asset]');
    await page.waitForTimeout(800);
    const p = await page.evaluate(([x, z]) => window.__aube.worldToScreen(x, z + 22), [cx, cz]);
    await page.mouse.move(p.x, p.y);
    for (let i = 0; i < 4; i++) { await page.mouse.move(p.x + i * 3, p.y); await render(page, 1, 0.05); }
    if (dev !== 'desktop') await page.touchscreen.tap(p.x, p.y);
    await page.waitForTimeout(500);
    await shot(page, dev, '10-placement');
    await page.locator('button', { hasText: 'Construire' }).first().click({ timeout: 3000 }).catch(() => page.mouse.click(p.x, p.y));
    await page.waitForTimeout(1500);
    await closeAll(page);
    await render(page, 3);
    // Panneau d'information du bâtiment posé.
    let b = await page.evaluate(async () => (await window.__aube.send('save', { slot: 'qa' })).data?.buildings?.[0] ?? null).catch(() => null);
    if (!b) {
      // Geste non abouti (rendu logiciel lent) : maison posée par la simulation, comme le ferait l'outil.
      for (const dz of [16, 22, -16, -22, 30]) {
        const ok = await page.evaluate(([x, z]) => window.__aube.send('placeBuilding', { assetId: 'maison_pavillon_enduit', x, z, rot: 0 }).then(() => true, (e) => e.message), [cx, cz + dz]);
        if (ok === true) break;
        console.log(`  pose directe refusée : ${ok}`);
      }
      await page.waitForTimeout(1200);
      await render(page, 3);
      b = await page.evaluate(async () => (await window.__aube.send('save', { slot: 'qa' })).data?.buildings?.[0] ?? null).catch(() => null);
    }
    if (b) {
      const s = await page.evaluate(([x, z]) => window.__aube.worldToScreen(x, z), [b.x, b.z]);
      if (dev !== 'desktop') await page.touchscreen.tap(s.x, s.y); else await page.mouse.click(s.x, s.y);
      await page.waitForTimeout(800);
      await page.waitForFunction(() => { const i = document.querySelector('#info-thumb'); return i && !i.classList.contains('hidden') && i.complete && i.naturalWidth > 0; }, null, { timeout: 60000 }).catch(() => undefined);
      const l = await thumbLuma(page, '#info-thumb');
      report[`${dev}/vignette-info`] = l;
      console.log(`  luminance vignette info : ${l.join(' ')}`);
      await shot(page, dev, '11-info-batiment');
      await closeAll(page);
    } else console.log('  aucun bâtiment posé');
  }
  // Panneau d'information d'une route.
  {
    const s = await page.evaluate(([x, z]) => window.__aube.worldToScreen(x + 24, z), [cx, cz]);
    if (dev !== 'desktop') await page.touchscreen.tap(s.x, s.y); else await page.mouse.click(s.x, s.y);
    await page.waitForTimeout(800);
    await shot(page, dev, '12-info-route');
    await closeAll(page);
  }
  // Tracé d'une route avec la grille.
  if (!steps || steps.includes('13-trace-route')) {
    await tap(page, dev, '#toolbar button[data-tool=road]');
    await page.waitForTimeout(800);
    const a = await page.evaluate(([x, z]) => window.__aube.worldToScreen(x - 40, z - 50), [cx, cz]);
    const e = await page.evaluate(([x, z]) => window.__aube.worldToScreen(x + 40, z - 70), [cx, cz]);
    if (dev !== 'desktop') await page.touchscreen.tap(a.x, a.y); else await page.mouse.click(a.x, a.y);
    await page.mouse.move(e.x, e.y);
    for (let i = 0; i < 3; i++) { await page.mouse.move(e.x - 6 + i * 3, e.y); await render(page, 1, 0.05); }
    await shot(page, dev, '13-trace-route');
    await page.keyboard.press('Escape');
    await closeAll(page);
  }
  // Tableaux de bord et feuilles.
  for (const [sel, nm, close] of [['#hud-money-btn', '14-finances', '#finance-close'], ['#hud-pop-btn', '15-population', null], ['#btn-notif', '16-notifications', null], ['#btn-menu', '17-options', null]]) {
    if (steps && !steps.includes(nm)) continue;
    await tap(page, dev, sel).catch((e) => console.log(`  ${nm} : ${e.message.split('\n')[0]}`));
    await page.waitForTimeout(800);
    await shot(page, dev, nm);
    if (close) await page.locator(close).click({ timeout: 1000 }).catch(() => undefined);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    await closeAll(page);
  }
  // Vue haute (arbres) et vue rue.
  if (!steps || steps.includes('18-vue-haute')) {
    await page.evaluate(([x, z]) => window.__aube.lookAt(x, z, 420, 0.9), [cx, cz]);
    await render(page, 4);
    await shot(page, dev, '18-vue-haute');
  }
  if (!steps || steps.includes('19-vue-rue')) {
    await page.evaluate(([x, z]) => window.__aube.streetLook(x - 50, z + 4, x + 40, z), [cx, cz]);
    await render(page, 4);
    await shot(page, dev, '19-vue-rue');
  }
  report[`${dev}/erreurs`] = errors.filter((e) => !/favicon/.test(e));
  if (report[`${dev}/erreurs`].length) { failures++; console.log(`  erreurs : ${report[`${dev}/erreurs`].slice(0, 5).join('\n  ')}`); }
  await ctx.close();
}

async function runDemo(dev) {
  const d = DEVICES[dev];
  const ctx = await browser.newContext({ viewport: d.viewport, deviceScaleFactor: d.deviceScaleFactor, isMobile: !!d.isMobile, hasTouch: !!d.hasTouch, ...(d.userAgent ? { userAgent: d.userAgent } : {}) });
  const page = await ctx.newPage();
  await page.goto(`${base}/index.html?${d.q}&demo&norender`, { timeout: 300000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__aube?.demoReady, null, { timeout: 600000, polling: 1000 });
  await render(page, 4);
  await shot(page, dev, '20-demo');
  await ctx.close();
}

try {
  for (const dev of ['iphone', 'paysage', 'desktop']) {
    if (only === 'all' && dev === 'paysage') continue;
    if (only !== 'all' && only !== dev) continue;
    await runDevice(dev);
    if (!steps || steps.includes('20-demo')) await runDemo(dev);
  }
} finally {
  await browser.close();
  server.close();
  writeFileSync(join(root, 'tests/e2e/out', `qa-affichage-${prefix}.json`), JSON.stringify(report, null, 2));
}
process.exit(failures ? 1 : 0);
