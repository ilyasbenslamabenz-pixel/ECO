/**
 * Fenêtre « Problèmes à régler » (src/ui/problems.ts), PC 1280×800 (npm run build puis node tests/e2e/problemes-pc.mjs) :
 *  - même largeur que le bloc mini-carte et alignée dessus ;
 *  - au plus 3 lignes, triées par gravité ;
 *  - un clic ouvre le bon tableau de bord (et centre la caméra pour un problème localisé).
 * Ville réelle : petite ville simulée 2 mois par la vraie simulation (tests/e2e/ui-history-fixture.ts) : chômage,
 * couverture police et déficit y sont réels. Chaque ligne affichée est cliquée et vérifiée. Captures : tests/e2e/out/problemes/*.png.
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
  await page.screenshot({ path: join(out, 'problemes-1280.png') });

  // Clic sur chaque ligne : l'outil qui règle le problème s'ouvre (tiroir de construction et son onglet), ou le
  // tableau de bord quand il n'y a rien à construire (déficit, trafic, ruines) ; un problème localisé recentre la caméra.
  const D = (drawer, tab) => ({ drawer, tab });
  const P = (sel, title) => ({ sel, title });
  const EXPECT = {
    power: D('energy'), water: D('water'), waste: D('waste'), collecte: D('waste'), 'reserve-courant': D('energy'),
    isolated: D('road'), fire: D('services', 'securite'), crime: D('services', 'securite'), chomage: D('zones'),
    'couverture-police': D('services', 'securite'), 'couverture-fire': D('services', 'securite'), 'couverture-health': D('services', 'sante'),
    ruin: P('#dash-panel', /Services/), deficit: P('#finance-panel', /Finances/), trafic: P('#dash-panel', /Transports/),
  };
  const ids = g.rows.map((x) => x.id);
  for (const id of ids) {
    const exp = EXPECT[id];
    if (!exp) { check(false, `problème « ${id} » sans destination connue du test`); continue; }
    const before = await page.evaluate(() => window.__aube.cameraPose?.() ?? null);
    await page.evaluate((i) => document.querySelector(`#problems .pb-row[data-problem="${i}"]`)?.click(), id);
    await page.waitForTimeout(800);
    const r = await page.evaluate((sel) => {
      const d = document.getElementById('build-drawer');
      const p = sel ? document.querySelector(sel) : null;
      return { drawer: d && !d.classList.contains('hidden') ? d.dataset.drawer : null, tab: document.querySelector('#drawer-tabs .chip-tab.active')?.dataset.tab ?? null,
        open: !!p && !p.classList.contains('hidden'), title: p?.querySelector('h3')?.textContent ?? '', pose: window.__aube.cameraPose?.() ?? null };
    }, exp.sel ?? null);
    if (exp.drawer) check(r.drawer === exp.drawer && (!exp.tab || r.tab === exp.tab), `clic sur « ${id} » : outil ${exp.drawer}${exp.tab ? ` › ${exp.tab}` : ''} ouvert (${r.drawer ?? 'aucun'}${r.tab ? ` › ${r.tab}` : ''})`);
    else check(r.open && exp.title.test(r.title), `clic sur « ${id} » : ${exp.sel} ouvert (« ${r.title} »)`);
    if (id === ids[0]) { await render(page, 2); await page.screenshot({ path: join(out, `problemes-clic-${id}.png`) }); }
    if (['power', 'water', 'waste', 'isolated', 'fire', 'ruin', 'crime', 'road'].includes(id) && before && r.pose) {
      const moved = Math.hypot(r.pose.targetX - before.targetX, r.pose.targetZ - before.targetZ);
      check(moved > 1, `« ${id} » : caméra centrée sur les bâtiments touchés (${Math.round(moved)} m)`);
    }
    await page.evaluate(() => { document.getElementById('drawer-close')?.click(); });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
  const errs = errors.filter((e) => !/favicon/.test(e));
  check(errs.length === 0, `aucune erreur de page (${errs.slice(0, 3).join(' ; ')})`);
  await ctx.close();
} finally {
  await browser.close();
  server.close();
}
if (failed) { console.error('problemes-pc : ÉCHEC'); process.exit(1); }
console.log('problemes-pc : OK');
