/**
 * Progression sur le profil iPhone (390×844, tactile, agent utilisateur iPhone → mode allégé), partie en déblocages
 * progressifs (?paliers) :
 *   1. menu latéral › Progression : onglets Paliers / Objectifs / Événements ; « Prochain palier : … points » et
 *      « Débloque : … » lisibles ; aucun débordement horizontal ; boutons ≥ 44 px ;
 *   2. Services : l'hôpital porte un cadenas (« Bourg ») ;
 *   3. événement annoncé (commande de diagnostic) : notification avec bouton « Voir » (≥ 44 px) qui ouvre l'onglet
 *      Événements ; rappel de l'objectif en cours dans l'encadré du haut (premiers pas masqués) ;
 *   4. Options › Événements : « Rares » transmis à la simulation ; aucune erreur de page.
 * Usage : node tests/e2e/progression-iphone.mjs (après npm run build). Captures : tests/e2e/out/progression-iphone-*.png.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { collectErrors, launch, root, serve } from './lib.mjs';

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const out = join(root, 'tests/e2e/out');
mkdirSync(out, { recursive: true });
const { server, base } = await serve();
const browser = await launch();
let failed = false;
const check = (ok, msg) => { console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${msg}`); if (!ok) failed = true; };
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE_UA });
  // Premiers pas déjà passés : l'encadré du haut rappelle l'objectif en cours.
  await ctx.addInitScript(() => { try { localStorage.setItem('aube.tutorial.v1', JSON.stringify({ skipped: true, open: true, done: false })); } catch { /* */ } });
  const page = await ctx.newPage();
  const errors = collectErrors(page);
  const send = (n, a) => page.evaluate(([n, a]) => window.__aube.send(n, a).then((r) => ({ ok: true, r }), (e) => ({ ok: false, e: e?.error?.message ?? e?.message ?? String(e) })), [n, a]);
  const plug = async (plugin, name, payload) => { const r = await send('pluginCommand', { plugin, name, payload }); return r.ok ? r.r.data : { error: r.e }; };
  const render = (n = 2) => page.evaluate((k) => window.__aube.renderNow(k, 0.1), n);
  const shot = (name) => page.screenshot({ path: join(out, `progression-iphone-${name}.png`), timeout: 600000 });
  /** Débordement horizontal de la page et éléments visibles hors de l'écran (sélecteur). */
  const overflow = (sel) => page.evaluate((s) => {
    const docW = document.documentElement.scrollWidth;
    const bad = [...document.querySelectorAll(s)].filter((e) => e.offsetParent !== null).map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && (r.left < -1 || r.right > innerWidth + 1));
    return { docW, bad: bad.length };
  }, sel);
  const minButtons = (sel) => page.evaluate((s) => [...document.querySelectorAll(s)].filter((b) => b.offsetParent !== null).map((b) => { const r = b.getBoundingClientRect(); return Math.min(r.width, r.height); }), sel);

  await page.goto(`${base}/index.html?autostart&seed=42&norender&paliers`, { timeout: 300000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__aube?.ready && window.__aube.snapshotReceived && window.__aube.lastStats, null, { timeout: 300000, polling: 300 });
  await send('setSpeed', { speed: 0 });
  const st = await plug('paliers', 'state');
  check(st?.locked === true, `partie en déblocages progressifs (verrous : ${st?.locked})`);
  await render(2);

  // 1) Progression par le menu latéral.
  await page.tap('#btn-sidebar');
  await page.waitForTimeout(300);
  await page.tap('#sidebar [data-dash=progression]');
  await page.waitForTimeout(800);
  const tabs = await page.evaluate(() => [...document.querySelectorAll('#dash-tabs [data-dtab]')].map((b) => b.textContent));
  check(['Paliers', 'Objectifs', 'Événements'].every((t) => tabs.includes(t)), `onglets du tableau Progression : ${tabs.join(', ')}`);
  const next = await page.evaluate(() => document.querySelector('.prog-next')?.textContent ?? '');
  check(/Prochain palier : Hameau — 0 \/ 100 points/.test(next) && /Débloque/.test(next), `prochain palier lisible : « ${next.slice(0, 140)} »`);
  let ov = await overflow('#dash-panel, #dash-panel .gov-card, .prog-next');
  check(ov.docW <= 390 && ov.bad === 0, `Progression › Paliers sans débordement (page ${ov.docW} px, ${ov.bad} élément(s) hors écran)`);
  await shot('paliers');
  await page.tap('#dash-tabs [data-dtab="mod:objectifs"]');
  await page.waitForTimeout(500);
  const objTxt = await page.evaluate(() => document.querySelector('#dash-body .module-root')?.textContent ?? '');
  check(/150 habitants|Objectifs en cours/.test(objTxt) && /Réalisations|150 habitants/.test(objTxt), `onglet Objectifs : « ${objTxt.slice(0, 120)} »`);
  ov = await overflow('#dash-panel, #dash-panel .prog-ach-i');
  check(ov.docW <= 390 && ov.bad === 0, `Progression › Objectifs sans débordement (${ov.bad} hors écran)`);
  await shot('objectifs');
  await page.tap('#dash-close');
  await page.waitForTimeout(300);

  // 2) Cadenas dans la barre de construction (Services).
  await page.tap('#toolbar button[data-cat=services]').catch(async () => { await page.tap('#toolbar [data-family]'); });
  await page.waitForTimeout(800);
  const lock = await page.evaluate(() => { const c = document.querySelector('#drawer-body .card[data-asset="public_hopital"]'); return c ? { locked: c.classList.contains('locked'), badge: c.querySelector('.lock-badge')?.textContent ?? '' } : null; });
  check(lock?.locked && /Bourg/.test(lock.badge), `hôpital verrouillé dans le tiroir Services (${JSON.stringify(lock)})`);
  await shot('cadenas');
  await page.tap('#drawer-close').catch(() => undefined);
  await page.waitForTimeout(300);

  // 3) Événement annoncé : notification « Voir ».
  const d = await plug('evenements', 'declencher', { kind: 'afflux' });
  check(d?.current?.kind === 'afflux', `événement annoncé par la simulation (${d?.current?.title ?? d?.error})`);
  await send('setSpeed', { speed: 1 });
  await page.waitForFunction(() => !!document.querySelector('#toasts .toast-act'), null, { timeout: 30000, polling: 200 }).catch(() => undefined);
  await send('setSpeed', { speed: 0 });
  const toast = await page.evaluate(() => { const b = document.querySelector('#toasts .toast-act'); if (!b) return null; const r = b.getBoundingClientRect(); const t = b.closest('.toast').getBoundingClientRect(); return { w: r.width, h: r.height, left: t.left, right: t.right, text: b.closest('.toast').textContent }; });
  check(!!toast && toast.h >= 44 && toast.w >= 44, `notification avec bouton « Voir » ≥ 44 px (${toast ? `${Math.round(toast.w)}×${Math.round(toast.h)}` : 'absente'})`);
  check(!!toast && toast.left >= 0 && toast.right <= 390, `notification dans l'écran (${toast ? `${Math.round(toast.left)}–${Math.round(toast.right)}` : '—'})`);
  await render(1);
  await shot('notification');
  if (toast) {
    await page.tap('#toasts .toast-act');
    await page.waitForTimeout(800);
    const evCard = await page.evaluate(() => ({ open: !document.querySelector('#dash-panel').classList.contains('hidden'), card: document.querySelector('[data-event="afflux"]')?.textContent ?? '' }));
    check(evCard.open && /Afflux/.test(evCard.card) && /Que faire/.test(evCard.card), `« Voir » ouvre Progression › Événements (« ${evCard.card.slice(0, 90)} »)`);
    const sizes = await minButtons('#dash-body .prog-btn');
    check(sizes.length > 0 && sizes.every((v) => v >= 44), `boutons de l'onglet Événements ≥ 44 px (${sizes.map(Math.round).join(', ')})`);
    ov = await overflow('#dash-panel, #dash-panel .gov-card');
    check(ov.docW <= 390 && ov.bad === 0, `Progression › Événements sans débordement (${ov.bad} hors écran)`);
    await shot('evenement');
    await page.tap('#dash-close');
    await page.waitForTimeout(300);
  }

  // Rappel de l'objectif (ou du palier suivant) dans l'encadré du haut.
  const goal = await page.evaluate(() => { const o = document.querySelector('#objectives'); if (!o || o.offsetParent === null && getComputedStyle(o).display === 'none') return null; const r = o.getBoundingClientRect(); return { cls: o.className, title: o.querySelector('.obj-t')?.textContent ?? '', left: r.left, right: r.right, h: o.querySelector('#obj-toggle').getBoundingClientRect().height }; });
  check(!!goal && /goal-mode/.test(goal.cls) && /Palier suivant|Objectif|Atteins|Couvre|Ramène/.test(goal.title), `rappel dans la barre : « ${goal?.title} »`);
  check(!!goal && goal.left >= 0 && goal.right <= 390 && goal.h >= 44, `rappel dans l'écran, bouton ≥ 44 px (${goal ? `${Math.round(goal.left)}–${Math.round(goal.right)}, ${Math.round(goal.h)} px` : '—'})`);
  const goalBtns = await minButtons('#objectives .obj-actions button');
  check(goalBtns.every((v) => v >= 44), `boutons du rappel ≥ 44 px (${goalBtns.map(Math.round).join(', ')})`);
  await render(1);
  await shot('rappel');

  // 4) Options › Événements.
  await page.tap('#btn-menu');
  await page.waitForTimeout(400);
  await page.tap('#btn-options');
  await page.waitForTimeout(400);
  const sel = await page.$('#form-options select[name=events]');
  check(!!sel, 'réglage « Événements » présent dans les options');
  if (sel) {
    await sel.selectOption('rares');
    await page.waitForTimeout(800);
    const ev = await plug('evenements', 'state');
    check(ev?.setting === 'rares', `réglage transmis à la simulation (${ev?.setting})`);
  }
  check(errors.length === 0, `aucune erreur de page ${errors.slice(0, 3).join(' | ')}`);
  await ctx.close();
} catch (e) {
  console.error('ERREUR', e); failed = true;
} finally {
  await browser.close(); server.close();
}
console.log(failed ? '\nPROGRESSION IPHONE : ÉCHEC' : '\nPROGRESSION IPHONE : SUCCÈS');
process.exit(failed ? 1 : 0);
