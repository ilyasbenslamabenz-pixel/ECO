/**
 * Interface sur iPhone (vague 5, docs/INTERFACE.md) — 390×844, tactile, agent utilisateur iPhone (mode allégé) :
 *   1. menu Cartes au doigt : boutons ≥ 44 px, légende compacte en tête, une seule carte active, rien hors de l'écran ;
 *   2. fiche « Pourquoi » d'un bâtiment : tout tient sur 390 px (aucun débordement) ;
 *   3. graphiques d'évolution : périodes 3 mois / 1 an / toute la partie, boutons ≥ 44 px ;
 *   4. journal des notifications regroupé et hiérarchisé, « Tout marquer comme lu ».
 * Ville : vraie simulation de 14 mois (tests/e2e/ui-history-fixture.ts). Captures : tests/e2e/out/interface-iphone-*.png
 * (copiées dans le dossier passé en argument, s'il y en a un).
 * Usage : node tests/e2e/interface-iphone.mjs [dossier-captures] (après npm run build).
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectErrors, launch, root, serve } from './lib.mjs';

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const out = join(root, 'tests/e2e/out');
mkdirSync(out, { recursive: true });
const extra = process.argv[2] ?? null;
if (extra) mkdirSync(extra, { recursive: true });
const fixture = join(out, 'ville-interface-iphone.json');
console.log(execFileSync(process.execPath, [join(root, 'node_modules/tsx/dist/cli.mjs'), join(root, 'tests/e2e/ui-history-fixture.ts'), fixture, '14'], { encoding: 'utf8' }).trim());
const save = JSON.parse(readFileSync(fixture, 'utf8'));

const { server, base } = await serve();
const browser = await launch();
let failed = false;
const check = (ok, msg) => { console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${msg}`); if (!ok) failed = true; };

try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE_UA });
  await ctx.addInitScript(() => { try { localStorage.setItem('aube.tutorial.v1', JSON.stringify({ skipped: true, open: false, done: false })); } catch { /* */ } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(240000);
  const errors = collectErrors(page);
  const render = (n = 2, dt = 1 / 30) => page.evaluate(([k, d]) => window.__aube.renderNow(k, d), [n, dt]);
  const shot = async (name) => {
    await render(1);
    const f = join(out, `interface-iphone-${name}.png`);
    await page.screenshot({ path: f, timeout: 600000 });
    if (extra) copyFileSync(f, join(extra, `iphone-${name}.png`));
  };
  /** Débordement : largeur de la page et éléments visibles qui sortent de l'écran ou de leur boîte. */
  const overflow = (sel) => page.evaluate((s) => {
    const docW = document.documentElement.scrollWidth;
    const els = [...document.querySelectorAll(s)].filter((e) => e.offsetParent !== null || getComputedStyle(e).position === 'fixed');
    const out = els.filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.left < -1 || r.right > innerWidth + 1); }).length;
    const clipped = els.filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== 'auto' && getComputedStyle(e).overflowX !== 'scroll').length;
    return { docW, out, clipped, n: els.length };
  }, sel);
  const minSize = (sel) => page.evaluate((s) => [...document.querySelectorAll(s)].filter((b) => b.offsetParent !== null).map((b) => { const r = b.getBoundingClientRect(); return Math.round(Math.min(r.width, r.height)); }), sel);

  await page.goto(`${base}/index.html?autostart&seed=42&norender`, { timeout: 300000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__aube?.ready && window.__aube.snapshotReceived && window.__aube.lastStats, null, { timeout: 300000, polling: 500 });
  await page.evaluate(async (data) => { await window.__aube.send('load', { data }); }, save);
  await page.waitForFunction(() => window.__aube.lastStats?.population > 0, null, { timeout: 60000, polling: 200 });
  await page.evaluate(() => window.__aube.send('setSpeed', { speed: 0 }));
  await page.evaluate(() => window.__aube.lookAt(0, 0, 520, 0.85, 0.5));
  await render(4, 0.5);

  /* ---------- 1. Menu Cartes ---------- */
  await page.tap('#btn-layers');
  await page.waitForTimeout(400);
  await page.tap('#layers-pop [data-layer=happiness]');
  await page.waitForFunction(() => window.__cartes?.visible() && window.__cartes.cells() > 0, null, { timeout: 30000, polling: 200 }).catch(() => undefined);
  await page.waitForTimeout(300);
  const st = await page.evaluate(() => {
    const pop = document.querySelector('#layers-pop').getBoundingClientRect();
    const lg = document.querySelector('#layers-pop .map-legend');
    return { cells: window.__cartes?.cells() ?? 0, on: [...document.querySelectorAll('#layers-pop .layer-item.on')].map((b) => b.getAttribute('data-layer')), pop: { l: pop.left, r: pop.right, t: pop.top, b: pop.bottom }, legend: lg?.textContent ?? '', legendH: lg?.getBoundingClientRect().height ?? 0 };
  });
  check(st.cells > 0 && st.on.length === 1 && st.on[0] === 'happiness', `carte Satisfaction au doigt (${st.cells} cellules, active : ${st.on.join(',')})`);
  check(st.pop.l >= 0 && st.pop.r <= 390 && st.pop.t >= 0, `menu Cartes dans l'écran (${Math.round(st.pop.l)}–${Math.round(st.pop.r)} × ${Math.round(st.pop.t)}–${Math.round(st.pop.b)})`);
  check(/Quoi faire/.test(st.legend) && st.legendH < 140, `légende compacte (${Math.round(st.legendH)} px) : « ${st.legend.slice(0, 90)}… »`);
  const sizes = await minSize('#layers-pop .layer-item');
  check(sizes.length > 15 && sizes.every((v) => v >= 44), `boutons du menu Cartes ≥ 44 px (min ${Math.min(...sizes)} px, ${sizes.length} boutons)`);
  let ov = await overflow('#layers-pop, #layers-pop .layer-item, #layers-pop .map-legend');
  check(ov.docW <= 390 && ov.out === 0, `menu Cartes sans débordement (page ${ov.docW} px, ${ov.out} hors écran)`);
  await shot('cartes-satisfaction');
  await page.tap('#layers-pop [data-layer=unemployment]');
  await page.waitForTimeout(800);
  await shot('cartes-chomage');
  await page.tap('#layers-pop [data-layer=none]');
  await page.tap('#btn-layers');
  await page.waitForTimeout(300);

  /* ---------- 2. Fiche « Pourquoi » ---------- */
  const pick = await page.evaluate(async () => {
    const s = window.__aube;
    const sv = await s.send('save', { slot: 'e2e-pourquoi-iphone' });
    let first = null;
    for (const b of sv?.buildings ?? []) {
      const o = await s.send('inspectBuilding', { buildingId: b.id }).catch(() => null);
      if (!o) continue;
      const neg = (o.diagnosis?.factors ?? []).filter((f) => f.delta <= -0.5).length;
      if (o.residents > 0 && neg >= 2) return { id: b.id, neg };
      if (!first && o.residents > 0) first = { id: b.id, neg };
    }
    return first;
  });
  check(!!pick, `logement à expliquer (${JSON.stringify(pick)})`);
  if (pick) {
    await page.evaluate((id) => window.__aube.selectBuilding(id), pick.id);
    await page.waitForFunction(() => document.querySelector('#info-why')?.childElementCount > 0, null, { timeout: 20000, polling: 200 }).catch(() => undefined);
    const why = await page.evaluate(() => ({ items: document.querySelectorAll('#info-why li').length, acts: document.querySelectorAll('#info-why .why-act').length, text: document.querySelector('#info-why')?.textContent ?? '' }));
    check(why.text.length > 0 && why.acts === why.items, `fiche « Pourquoi » : ${why.items} raison(s) avec action (« ${why.text.slice(0, 100)} »)`);
    ov = await overflow('#info-panel, #info-why, #info-why .why-box, #info-why li, #info-why .why-cause, #info-why .why-act, #info-rows, #info-rows dd');
    check(ov.docW <= 390 && ov.out === 0 && ov.clipped === 0, `fiche sur 390 px sans débordement (page ${ov.docW} px, ${ov.out} hors écran, ${ov.clipped} coupé(s))`);
    await shot('fiche-pourquoi');
    await page.tap('#info-close').catch(() => undefined);
    await page.waitForTimeout(300);
  }

  /* ---------- 3. Graphiques ---------- */
  await page.tap('#btn-sidebar');
  await page.waitForTimeout(400);
  await page.tap('#sidebar [data-proxy=btn-stats]');
  await page.waitForTimeout(1000);
  for (const [tab, range] of [['money', '1a'], ['jobs', 'tout'], ['pop', '3m']]) {
    await page.tap(`#dash-tabs [data-dtab=${tab}]`);
    await page.waitForTimeout(400);
    await page.tap(`#dash-body .hist-ranges [data-range="${range}"]`);
    await page.waitForTimeout(700);
    const std = await page.evaluate(() => {
      const c = document.querySelector('#stats-chart'); if (!c || !c.width) return 0;
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0, m = 0, q = 0;
      for (let i = 0; i < d.length; i += 16) { const l = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11 + d[i + 3] * 0.2; n++; m += l; q += l * l; }
      m /= n; return Math.sqrt(Math.max(0, q / n - m * m));
    });
    check(std > 8, `graphique « ${tab} » sur ${range} dessiné au doigt`);
    if (tab !== 'pop') await shot(`graphique-${tab}-${range}`);
  }
  const rs = await minSize('#dash-body .hist-ranges button');
  check(rs.length === 3 && rs.every((v) => v >= 44), `boutons de période ≥ 44 px (${rs.join(', ')})`);
  ov = await overflow('#dash-panel, #dash-body .hist-ranges, #dash-body .hist-legend, #dash-body .hist-kpis, #stats-chart');
  check(ov.docW <= 390 && ov.out === 0, `Statistiques sans débordement (page ${ov.docW} px, ${ov.out} hors écran)`);
  await page.tap('#dash-close');
  await page.waitForTimeout(300);

  /* ---------- 4. Notifications ---------- */
  await page.evaluate(() => {
    const t = window.__aube.toast;
    for (let i = 0; i < 12; i++) t(`Maison ${i + 1} construit (−40 000 ¢)`, 'ok');
    for (let i = 0; i < 3; i++) t(`Réseau principal : ${10 + i} bâtiments coupés (logements). Construisez une centrale.`, 'error');
    t('Panne : Éolienne n° 3 hors service (réparation ≈ 4 h)', 'error');
  });
  await page.waitForTimeout(400);
  await page.tap('#btn-sidebar');
  await page.waitForTimeout(400);
  await page.tap('#sidebar [data-proxy=btn-notif]');
  await page.waitForTimeout(800);
  const log = await page.evaluate(() => [...document.querySelectorAll('.notif-list li')].map((l) => l.dataset.sev + ':' + (l.querySelector('.ntext')?.textContent ?? '')));
  check(log.some((t) => /^info:.*12 constructions/.test(t)) && log.some((t) => /^urgent:.*Coupures/.test(t)), `journal regroupé et hiérarchisé (${log.length} entrées)`);
  const ns = await minSize('#dash-body .notif-head .chip, #dash-body .notif-filters button');
  check(ns.length >= 4 && ns.every((v) => v >= 44), `boutons du journal ≥ 44 px (${ns.join(', ')})`);
  ov = await overflow('#dash-panel, #dash-body .notif-list li, #dash-body .notif-head');
  check(ov.docW <= 390 && ov.out === 0, `journal sans débordement (page ${ov.docW} px, ${ov.out} hors écran)`);
  await shot('notifications');
  await page.tap('#dash-body [data-act=read-all]');
  await page.waitForTimeout(300);
  const badge = await page.evaluate(() => document.querySelector('#notif-badge')?.classList.contains('hidden'));
  check(badge === true, '« Tout marquer comme lu » vide le badge');
  check(errors.length === 0, `aucune erreur de page ${errors.slice(0, 3).join(' | ')}`);
  await ctx.close();
} catch (e) {
  console.error(e);
  check(false, `exception : ${e instanceof Error ? e.message : String(e)}`);
} finally {
  await browser.close();
  server.close();
}
console.log(failed ? '\nINTERFACE IPHONE : ÉCHEC' : '\nINTERFACE IPHONE : SUCCÈS');
process.exit(failed ? 1 : 0);
