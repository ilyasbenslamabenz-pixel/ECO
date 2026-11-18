/**
 * Fiche détaillée des cartes, conseils cliquables de la fiche bâtiment, actions directes des Problèmes (ordinateur).
 *   node tests/e2e/cap-actions.mjs <préfixe> [dossier]   (après npm run build)
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, root, serve } from './lib.mjs';

const tagName = process.argv[2] || 'actions';
const out = process.argv[3] || join(root, 'tests/e2e/out');
mkdirSync(out, { recursive: true });
const save = JSON.parse(readFileSync(join(root, 'tests/e2e/out/ville-interface-iphone.json'), 'utf8'));
const { server, base } = await serve();
const browser = await launch();
const errors = [];
let failed = false;
const check = (ok, msg) => { console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${msg}`); if (!ok) failed = true; };
try {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })).newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/index.html?autostart&seed=42`, { timeout: 300000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__aube?.ready && window.__aube.snapshotReceived && window.__aube.lastStats, null, { timeout: 300000, polling: 500 });
  await page.evaluate(async (data) => { await window.__aube.send('load', { data }); }, save);
  await page.waitForFunction(() => window.__aube.lastStats?.population > 0, null, { timeout: 60000, polling: 200 });
  await page.evaluate(() => window.__aube.send('setSpeed', { speed: 1 }));
  await page.waitForTimeout(4000);
  await page.evaluate(() => window.__aube.send('setSpeed', { speed: 0 }));
  await page.evaluate(() => window.__aube.lookAt(0, 0, 420, 0.85, 0.5));
  const shot = (l) => page.screenshot({ path: join(out, `${tagName}-${l}.png`) });

  // 1. Fiche détaillée au survol d'une carte (Services › Éducation : variantes, dépendances, rayon).
  await page.click('#toolbar button[data-cat=services]');
  await page.waitForTimeout(800);
  const card = page.locator('#drawer-body .card[data-asset]').first();
  await card.hover();
  await page.waitForTimeout(800);
  const det = await page.evaluate(() => { const d = document.getElementById('card-detail'); const r = d.getBoundingClientRect(); return { shown: !d.classList.contains('hidden'), title: d.querySelector('h4')?.textContent, vars: d.querySelectorAll('.cd-var').length, clipped: d.scrollHeight > d.clientHeight + 1, top: Math.round(r.top), bottom: Math.round(r.bottom), right: Math.round(r.right), text: d.textContent.slice(0, 160) }; });
  check(det.shown && det.title && det.top >= 60 && det.right <= 1440, `fiche au survol : « ${det.title} », ${det.vars} variantes (${JSON.stringify(det)})`);
  await shot('fiche-carte');
  // Variante cliquée : outil Bâtiment avec cette variante.
  if (det.vars > 1) {
    await page.locator('#card-detail .cd-var').nth(1).click();
    await page.waitForTimeout(500);
    const st = await page.evaluate(() => ({ tool: window.__aube.machine?.tool ?? null, variant: window.__aube.machine?.variant ?? null, drawer: !document.getElementById('build-drawer').classList.contains('hidden') }));
    check(st.drawer === false, `variante choisie : tiroir refermé pour viser (${JSON.stringify(st)})`);
    await page.keyboard.press('Escape');
  }

  // 2. Fiche bâtiment : conseils cliquables.
  const id = await page.evaluate(async () => {
    const sv = await window.__aube.send('save', { slot: 'cap-act' });
    for (const b of sv.data.buildings) { const o = await window.__aube.send('inspectBuilding', { buildingId: b.id }).catch(() => null); if (o?.residents > 0) return b.id; }
    return sv.data.buildings[0].id;
  });
  await page.evaluate((i) => window.__aube.selectBuilding(i), id);
  await page.waitForTimeout(1500);
  const gos = await page.evaluate(() => [...document.querySelectorAll('#info-why .why-go')].map((b) => b.querySelector('.why-go-k').textContent));
  check(gos.length > 0, `conseils cliquables dans la fiche : ${gos.join(', ')}`);
  await shot('fiche-pourquoi');
  if (gos.length) {
    const target = await page.evaluate(() => document.querySelector('#info-why .why-go').dataset.go);
    await page.locator('#info-why .why-go').first().click();
    await page.waitForTimeout(900);
    const st = await page.evaluate(() => ({ drawer: document.getElementById('build-drawer').dataset.drawer, open: !document.getElementById('build-drawer').classList.contains('hidden'), tab: document.querySelector('#drawer-tabs .chip-tab.active')?.dataset.tab ?? null, dash: !document.getElementById('dash-panel')?.classList.contains('hidden') }));
    check(st.open || st.dash, `clic sur le 1er conseil (${target}) → ${JSON.stringify(st)}`);
    await shot('conseil-ouvert');
    await page.evaluate(() => document.getElementById('drawer-close')?.click());
  }

  // 3. Problèmes à régler : action directe.
  const probs = await page.evaluate(() => [...document.querySelectorAll('#problems .pb-row')].map((r) => r.textContent.trim().slice(0, 40)));
  console.log('problèmes affichés', JSON.stringify(probs));
  if (probs.length) {
    await page.locator('#problems .pb-row').first().click();
    await page.waitForTimeout(900);
    const st = await page.evaluate(() => ({ drawer: document.getElementById('build-drawer').dataset.drawer, open: !document.getElementById('build-drawer').classList.contains('hidden'), tab: document.querySelector('#drawer-tabs .chip-tab.active')?.dataset.tab ?? null, dash: document.getElementById('dash-panel')?.dataset.dash ?? null }));
    check(st.open || st.dash, `clic sur « ${probs[0]} » → ${JSON.stringify(st)}`);
    await shot('probleme-ouvert');
  }
} finally { await browser.close(); server.close(); }
check(errors.length === 0, `aucune erreur de page ${JSON.stringify(errors)}`);
console.log(failed ? 'ACTIONS : ÉCHEC' : 'ACTIONS : SUCCÈS');
process.exit(failed ? 1 : 0);
