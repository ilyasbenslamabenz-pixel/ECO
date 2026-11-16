/**
 * Fenêtre « Problèmes à régler » (src/ui/problems.ts), PC 1280×800 (npm run build puis node tests/e2e/problemes-pc.mjs) :
 *  - même largeur que le bloc mini-carte et alignée dessus ;
 *  - au plus 3 lignes, triées par gravité ;
 *  - un clic ouvre le bon tableau de bord (et centre la caméra pour un problème localisé).
 * Ville réelle : petite ville simulée 2 mois par la vraie simulation (tests/e2e/ui-history-fixture.ts), sans centrale
 * électrique : l'alerte « sans électricité » existe donc. Captures : tests/e2e/out/problemes/*.png.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectErrors, launch, root, serve } from './lib.mjs';

const out = join(root, 'tests/e2e/out/problemes');
mkdirSync(out, { recursive: true });
const fixture = join(out, 'ville.json');
execFileSync(process.execPath, [join(root, 'node_modules/tsx/dist/cli.mjs'), join(root, 'tests/e2e/ui-history-fixture.ts'), fixture, '2'], { encoding: 'utf8' });
const save = JSON.parse(readFileSync(fixture, 'utf8'));

const { server, base } = await serve();
const browser = await launch();
let failed = false;
const check = (ok, msg) => { console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${msg}`); if (!ok) failed = true; };
const render = (page, n = 2, dt = 1 / 30) => page.evaluate(([k, d]) => window.__aube.renderNow(k, d), [n, dt]);

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = collectErrors(page);
  await page.goto(`${base}/index.html?autostart&seed=42&norender`, { timeout: 300000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__aube?.ready && window.__aube.snapshotReceived && window.__aube.lastStats, null, { timeout: 300000, polling: 500 });
  await page.evaluate(async (data) => { await window.__aube.send('load', { data }); }, save);
  await page.waitForFunction(() => window.__aube.lastStats?.population > 0, null, { timeout: 60000, polling: 200 });
  await page.evaluate(() => window.__aube.send('setSpeed', { speed: 1 }));
  // Rapport et alertes reçus, fenêtre mise à jour (au plus 1 fois/s).
  await page.waitForFunction(() => !!window.__aube.lastReport && document.querySelectorAll('#problems .pb-row').length > 0, null, { timeout: 60000, polling: 300 }).catch(() => undefined);
  await page.evaluate(() => window.__aube.send('setSpeed', { speed: 0 }));
  await page.evaluate(() => window.__aube.lookAt(0, 0, 520, 0.75, 0.5));
  await render(page, 6, 0.5);

  const g = await page.evaluate(() => {
    const r = (s) => { const b = document.querySelector(s)?.getBoundingClientRect(); return b ? { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width } : null; };
    return { pb: r('#problems'), mm: r('#minimap'), rows: [...document.querySelectorAll('#problems .pb-row')].map((b) => ({ id: b.dataset.problem, sev: b.classList.contains('urgent') ? 'urgent' : 'important', text: b.textContent })) };
  });
  check(!!g.pb && !!g.mm && Math.abs(g.pb.w - g.mm.w) <= 1 && Math.abs(g.pb.l - g.mm.l) <= 1, `même largeur et alignement que la mini-carte (fenêtre ${g.pb?.l}–${g.pb?.r}, mini-carte ${g.mm?.l}–${g.mm?.r})`);
  check(!!g.pb && !!g.mm && g.pb.b <= g.mm.t, `au-dessus de la mini-carte (bas ${g.pb?.b}, haut de la mini-carte ${g.mm?.t})`);
  check(g.rows.length >= 1 && g.rows.length <= 3, `1 à 3 lignes (${g.rows.length} : ${g.rows.map((x) => x.text).join(' | ')})`);
  const order = g.rows.map((x) => (x.sev === 'urgent' ? 0 : 1));
  check(order.every((v, i) => i === 0 || order[i - 1] <= v), `triées par gravité (${g.rows.map((x) => x.sev).join(', ')})`);
  check(g.rows.some((x) => x.id === 'power'), `alerte « sans électricité » présente (${g.rows.map((x) => x.id).join(', ')})`);
  await page.screenshot({ path: join(out, 'problemes-1280.png') });

  // Clic sur « sans électricité » : tableau de bord Énergie ouvert, caméra centrée sur le groupe.
  const before = await page.evaluate(() => window.__aube.cameraPose?.() ?? null);
  await page.evaluate(() => document.querySelector('#problems .pb-row[data-problem="power"]')?.click());
  await page.waitForTimeout(800);
  const after = await page.evaluate(() => ({
    open: !document.querySelector('#dash-panel').classList.contains('hidden'),
    title: document.querySelector('#dash-title')?.textContent ?? '',
    active: document.querySelector('#sidebar [data-dash="energy"]')?.classList.contains('active') ?? false,
    pose: window.__aube.cameraPose?.() ?? null,
  }));
  check(after.open && /Énergie/.test(after.title), `le clic ouvre le tableau de bord Énergie (« ${after.title} »)`);
  check(after.active, 'entrée Énergie du rail active');
  const moved = before && after.pose ? Math.hypot((after.pose.targetX ?? 0) - (before.targetX ?? 0), (after.pose.targetZ ?? 0) - (before.targetZ ?? 0)) : 0;
  check(!before || moved > 1, `caméra centrée sur les bâtiments touchés (déplacement ${Math.round(moved)} m)`);
  await render(page, 2);
  await page.screenshot({ path: join(out, 'problemes-clic-energie.png') });
  const errs = errors.filter((e) => !/favicon/.test(e));
  check(errs.length === 0, `aucune erreur de page (${errs.slice(0, 3).join(' ; ')})`);
  await ctx.close();
} finally {
  await browser.close();
  server.close();
}
if (failed) { console.error('problemes-pc : ÉCHEC'); process.exit(1); }
console.log('problemes-pc : OK');
