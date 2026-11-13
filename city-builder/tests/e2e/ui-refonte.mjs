/**
 * Refonte de l'interface « Meknes City » (npm run build puis node tests/e2e/ui-refonte.mjs) : CHAQUE bouton de la
 * barre supérieure, de la barre latérale, de la barre d'outils et de la mini-carte est cliqué et son EFFET RÉEL
 * est vérifié (vitesse relue dans la simulation, panneau ouvert, outil actif, caméra déplacée…).
 * Historique réel : une petite ville est simulée 13 mois par la vraie simulation (tests/e2e/ui-history-fixture.ts),
 * puis chargée dans le jeu : le graphique « 12 mois » et les statistiques affichent ces mois clos.
 * Captures (à regarder) : tests/e2e/out/ui-refonte/*.png — bureau 1440×900 et iPhone 390×844.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectErrors, launch, root, serve } from './lib.mjs';

const out = join(root, 'tests/e2e/out/ui-refonte');
mkdirSync(out, { recursive: true });
const fixture = join(out, 'ville-13-mois.json');
console.log('Simulation de 13 mois (vraie simulation, nœud)…');
console.log(execFileSync(process.execPath, [join(root, 'node_modules/tsx/dist/cli.mjs'), join(root, 'tests/e2e/ui-history-fixture.ts'), fixture, '13'], { encoding: 'utf8' }).trim());
const save = JSON.parse(readFileSync(fixture, 'utf8'));

const { server, base } = await serve();
const browser = await launch();
const R = { checks: [], notes: {} };
let failed = false;
const check = (ok, msg) => { R.checks.push({ ok: !!ok, msg }); console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${msg}`); if (!ok) failed = true; };
const render = (page, n = 2, dt = 1 / 30) => page.evaluate(([k, d]) => window.__aube.renderNow(k, d), [n, dt]);
const shot = async (page, name) => { await render(page, 1); await page.screenshot({ path: join(out, `${name}.png`), timeout: 600000 }); };
const visible = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; }, sel);
const text = (page, sel) => page.evaluate((s) => document.querySelector(s)?.textContent ?? '', sel);
const pose = (page) => page.evaluate(() => window.__aube.cameraPose());
const tool = (page) => page.evaluate(() => window.__aube.toolPreview());
/** Canvas réellement dessiné : écart-type de luminance des pixels. */
const canvasStd = (page, sel) => page.evaluate((s) => {
  const c = document.querySelector(s); if (!c || !c.width) return 0;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0, m = 0, q = 0;
  for (let i = 0; i < d.length; i += 16) { const l = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11 + d[i + 3] * 0.2; n++; m += l; q += l * l; }
  m /= n; return Math.sqrt(Math.max(0, q / n - m * m));
}, sel);
/** Onglets : aucun libellé tronqué. */
const tabsWhole = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].filter((b) => b.offsetParent).every((b) => b.scrollWidth <= b.clientWidth + 1 && b.scrollHeight <= b.clientHeight + 1), sel);

async function waitGame(page, url) {
  await page.goto(url, { timeout: 300000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__aube?.ready && window.__aube.snapshotReceived && window.__aube.lastStats, null, { timeout: 300000, polling: 500 });
}
async function loadFixture(page) {
  await page.evaluate(async (data) => { await window.__aube.send('load', { data }); }, save);
  await page.waitForFunction(() => window.__aube.lastStats?.population > 0, null, { timeout: 60000, polling: 200 });
  await page.evaluate(() => window.__aube.send('setSpeed', { speed: 0 }));
  await page.waitForFunction(() => !!window.__aube.lastReport && window.__aube.lastReport.economy.history.length >= 12, null, { timeout: 60000, polling: 200 });
  await page.evaluate(() => window.__aube.lookAt(0, 0, 520, 0.75, 0.5));
  await render(page, 8, 0.5);
}

try {
  /* =============================== Bureau 1440×900 =============================== */
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = collectErrors(page);
  await waitGame(page, `${base}/index.html?autostart&seed=42&norender`);
  check(await page.title() === 'Meknes City', `titre de la page « ${await page.title()} »`);
  await loadFixture(page);
  const rep = await page.evaluate(() => window.__aube.lastReport);
  R.notes.history = rep.economy.history.length;

  // --- Barre supérieure : vitesses (relues dans la simulation).
  for (const sp of [0, 2, 4, 8, 16, 1]) {
    await page.click(`#hud .seg button[data-speed="${sp}"]`);
    await page.waitForFunction((v) => window.__aube.lastStats?.speed === v, sp, { timeout: 15000 }).catch(() => undefined);
    const st = await page.evaluate(() => window.__aube.lastStats.speed);
    const active = await page.evaluate((v) => document.querySelector(`#hud [data-speed="${v}"]`).classList.contains('active'), sp);
    check(st === sp && active, `vitesse ×${sp} : simulation ${st}, bouton actif ${active}`);
  }
  await page.click('#hud .seg button[data-speed="0"]');
  await page.waitForFunction(() => window.__aube.lastStats?.speed === 0, null, { timeout: 15000 });
  await page.waitForFunction(() => !!window.__aube.lastReport, null, { timeout: 15000 });

  const hudMoney = await text(page, '#hud-money');
  check(/CHF/.test(hudMoney) && /CHF \/ mois/.test(await text(page, '#hud-balance')), `trésorerie en CHF (« ${hudMoney} », « ${await text(page, '#hud-balance')} »)`);
  const bodyText = await page.evaluate(() => document.body.innerText);
  check(!bodyText.includes('¢'), 'aucun symbole « ¢ » affiché');
  check(/Meknes City/.test(await text(page, '.hud-brand')), 'logo et nom « Meknes City » dans la barre supérieure');
  const st0 = await page.evaluate(() => window.__aube.lastStats);
  const popTxt = (await text(page, '#hud-pop')).replace(/\s/g, '');
  check(Number(popTxt) === st0.population, `population affichée ${popTxt} = simulation ${st0.population}`);
  const happy = await text(page, '#hud-happy');
  const rep2 = await page.evaluate(() => window.__aube.lastReport);
  check(happy.replace(/\s/g, '') === `${Math.round(rep2.demography.happiness)}%`, `satisfaction affichée « ${happy} » = simulation ${rep2.demography.happiness.toFixed(1)}`);
  check(await page.evaluate(() => document.querySelector('#hud-weather').getAttribute('aria-disabled') === 'true' && /2C/.test(document.querySelector('#hud-weather').textContent)), 'météo grisée « 2C » (non simulée)');

  await page.click('#hud-pop-btn');
  check(await visible(page, '#pop-panel'), 'bouton Population → panneau Population');
  await page.click('#pop-close');
  await page.click('#hud-happy-btn');
  check(await visible(page, '#pop-panel') && (await text(page, '#pop-happy')).includes('%'), `bouton Satisfaction → Population (satisfaction ${await text(page, '#pop-happy')})`);
  for (const t of ['demand', 'acts', 'ages', 'overview']) {
    await page.click(`#pop-panel [data-ptab=${t}]`);
    check(await visible(page, `#pop-panel [data-ppage=${t}]`), `Population : onglet ${t}`);
  }
  check(await tabsWhole(page, '#pop-panel .ptabs button'), 'Population : onglets non tronqués');
  await page.click('#hud-money-btn');
  check(await visible(page, '#finance-panel') && !(await visible(page, '#pop-panel')), 'bouton Trésorerie → Finances (un seul panneau ouvert)');
  await page.click('#btn-stats');
  check(await visible(page, '#dash-panel') && (await text(page, '#dash-title')) === 'Statistiques' && !(await visible(page, '#finance-panel')), 'bouton Statistiques → panneau Statistiques');
  for (const t of ['money', 'happy', 'jobs', 'pop']) {
    await page.click(`#dash-tabs [data-dtab=${t}]`);
    check(await canvasStd(page, '#stats-chart') > 8, `Statistiques : graphique « ${t} » dessiné (historique réel de ${R.notes.history} mois)`);
  }
  await shot(page, 'bureau-statistiques');
  // Notifications : une vraie notification (sauvegarde) puis le centre de notifications.
  await page.evaluate(() => window.__aube.saveSlot('ui-e2e'));
  await page.waitForTimeout(300);
  const badge = await page.evaluate(() => !document.querySelector('#notif-badge').classList.contains('hidden') && Number(document.querySelector('#notif-badge').textContent) > 0);
  check(badge, `badge de notifications (${await text(page, '#notif-badge')} non lue(s))`);
  await page.click('#btn-notif');
  const notifItems = await page.evaluate(() => [...document.querySelectorAll('.notif-list li')].map((l) => l.textContent));
  check(await visible(page, '#dash-panel') && notifItems.some((t) => /sauvegardée/.test(t)) && await page.evaluate(() => document.querySelector('#notif-badge').classList.contains('hidden')), `bouton Notifications → journal (${notifItems.length} entrée(s)), badge remis à zéro`);
  await page.click('#dash-close');
  check(!(await visible(page, '#dash-panel')), 'fermeture du panneau');
  await page.click('#btn-save');
  check(await visible(page, '#save-panel'), 'bouton Sauvegarder → emplacements');
  await page.click('#save-close');
  await page.click('#btn-menu');
  check(await visible(page, '#main-menu'), 'bouton Réglages → menu (pause)');
  await page.click('#btn-continue');
  check(!(await visible(page, '#main-menu')), 'menu → reprendre');
  await page.click('#hud .seg button[data-speed="0"]');

  // --- Barre latérale : tableaux de bord.
  const dashes = await page.evaluate(() => [...document.querySelectorAll('#sidebar button[data-dash]')].map((b) => ({ id: b.dataset.dash, disabled: b.disabled, phase: b.querySelector('.phase')?.textContent ?? '' })));
  check(dashes.length === 11, `11 tableaux de bord dans la barre latérale (${dashes.map((d) => d.id).join(', ')})`);
  const expectTitle = { city: 'Vue ville', services: 'Services publics', transport: 'Transports', environment: 'Environnement' };
  for (const d of dashes) {
    if (d.disabled) { check(/^2[BC]$/.test(d.phase), `${d.id} : grisé avec sa phase (${d.phase})`); continue; }
    await page.click(`#sidebar button[data-dash=${d.id}]`);
    await page.waitForTimeout(150);
    const sel = d.id === 'finance' ? '#finance-panel' : d.id === 'population' ? '#pop-panel' : '#dash-panel';
    const ok = await visible(page, sel) && (sel !== '#dash-panel' || (await text(page, '#dash-title')) === expectTitle[d.id]);
    const active = await page.evaluate((id) => document.querySelector(`#sidebar button[data-dash=${id}]`).classList.contains('active'), d.id);
    check(ok && active, `barre latérale « ${d.id} » → panneau ouvert, bouton actif`);
    if (sel === '#dash-panel') {
      const body = await text(page, '#dash-body');
      check(body.length > 20 && !/NaN|undefined/.test(body), `${d.id} : contenu réel (${body.slice(0, 70).replace(/\s+/g, ' ')}…)`);
    }
  }
  // Vue ville : boutons de caméra.
  await page.click('#sidebar button[data-dash=city]');
  await page.evaluate(() => window.__aube.lookAt(150, 150, 300, 0.7, 1.2));
  await render(page, 2, 0.5);
  await page.click('#dash-body [data-act=north]');
  await render(page, 20, 0.5);
  check(Math.abs((await pose(page)).yaw) < 0.05, `Vue ville → « Nord en haut » : cap ${(await pose(page)).yaw.toFixed(3)}`);
  await page.click('#dash-body [data-act=top]');
  await render(page, 20, 0.5);
  check((await pose(page)).pitch > 1.2, `Vue ville → « Vue de dessus » : inclinaison ${(await pose(page)).pitch.toFixed(2)}`);
  // Finances : onglets, grand livre, graphique 12 mois.
  await page.click('#btn-finance');
  check(await visible(page, '#finance-panel'), 'Finances ouvert');
  for (const t of ['tax', 'budget', 'debt', 'overview']) {
    await page.click(`#finance-panel [data-ftab=${t}]`);
    await page.waitForTimeout(200);
    check(await visible(page, `#finance-panel [data-fpage=${t}]`), `Finances : onglet ${t}`);
  }
  check(await tabsWhole(page, '#finance-panel .ptabs button'), 'Finances : onglets non tronqués');
  const ledger = await page.evaluate(() => {
    const num = (t) => Number((t ?? '').replace(/[^\d−-]/g, '').replace('−', '-'));
    const inc = [...document.querySelectorAll('#fin-inc-rows dd')].reduce((a, d) => a + num(d.textContent), 0);
    const exp = [...document.querySelectorAll('#fin-exp-rows dd')].reduce((a, d) => a + num(d.textContent), 0);
    return { inc, exp, incTotal: num(document.querySelector('#fin-income').textContent), expTotal: num(document.querySelector('#fin-expense').textContent), net: num(document.querySelector('#fin-net').textContent) };
  });
  const f = (await page.evaluate(() => window.__aube.lastReport)).economy.forecast;
  check(Math.abs(ledger.incTotal - f.totalIncome) <= 1 && Math.abs(ledger.inc - f.totalIncome) <= 4, `recettes ventilées = simulation (${ledger.inc} / ${f.totalIncome})`);
  check(Math.abs(-ledger.expTotal - f.totalExpenses) <= 1 && Math.abs(-ledger.exp - f.totalExpenses) <= 5, `dépenses ventilées = simulation (${-ledger.exp} / ${f.totalExpenses})`);
  check(Math.abs(ledger.net - f.balance) <= 1, `solde mensuel = simulation (${ledger.net} / ${f.balance})`);
  check(await canvasStd(page, '#fin-month-chart') > 8 && /→/.test(await text(page, '#fin-mrange')), `graphique 12 mois dessiné (${await text(page, '#fin-mrange')})`);
  R.notes.ledger = ledger;
  await shot(page, 'bureau-finances');

  // --- Barre d'outils : chaque bouton.
  await page.click('#finance-close');
  const tb = await page.evaluate(() => [...document.querySelectorAll('#toolbar button')].map((b) => ({ tool: b.dataset.tool ?? null, cat: b.dataset.cat ?? null, id: b.id, disabled: b.disabled, label: b.querySelector('.tl')?.textContent })));
  check(tb.length === 13, `13 boutons dans la barre d'outils (${tb.map((b) => b.label).join(', ')})`);
  for (const b of tb) {
    if (b.id === 'btn-undo') continue;
    const sel = b.tool ? `#toolbar button[data-tool=${b.tool}]` : `#toolbar button[data-cat=${b.cat}]`;
    check(!b.disabled, `${b.label} : activable`);
    await page.click(sel);
    await page.waitForTimeout(150);
    if (b.tool === 'select' || b.tool === 'bulldoze') {
      const tp = await tool(page);
      const active = await page.evaluate((s) => document.querySelector(s).classList.contains('active'), sel);
      check(active && !(await visible(page, '#build-drawer')) && (b.tool === 'select' ? tp.kind === 'none' || tp.kind === 'select' || !tp.kind : true), `${b.label} → outil actif (${JSON.stringify(tp)})`);
      if (b.tool === 'bulldoze') check(await visible(page, '#tool-options') && /Démolir/.test(await text(page, '#tool-hint')), `${b.label} → barre d'options « ${await text(page, '#tool-hint')} »`);
      continue;
    }
    const open = await visible(page, '#build-drawer');
    const info = await page.evaluate(() => ({ title: document.querySelector('#drawer-title').textContent, cards: document.querySelectorAll('#drawer-body .card:not(:disabled)').length, planned: document.querySelectorAll('#drawer-body .tile:disabled').length, tabs: document.querySelectorAll('#drawer-tabs .chip-tab').length }));
    const real = b.cat === 'zones' || b.cat === 'energy' || b.cat === 'water' || b.cat === 'waste' || b.cat === 'terrain' ? info.planned > 0 && info.cards === 0 : info.cards > 0;
    check(open && real, `${b.label} → sous-barre « ${info.title} » (${info.cards} élément(s) constructible(s), ${info.planned} prévu(s) grisé(s), ${info.tabs} onglet(s))`);
    if (b.tool === 'road') check((await tool(page)).kind === 'road', `Routes → outil route actif`);
    if (b.cat === 'zones') await shot(page, 'bureau-zones');
    if (b.tool === 'building') await shot(page, 'bureau-batiments');
  }
  // Pose réelle depuis la sous-barre Services, puis Annuler.
  await page.click('#toolbar button[data-tool=select]');
  const before = (await page.evaluate(() => window.__aube.lastStats)).buildings;
  await page.click('#toolbar button[data-cat=services]');
  const asset = await page.evaluate(() => document.querySelector('#drawer-body .card[data-asset]:not(:disabled)')?.getAttribute('data-asset'));
  await page.click(`#drawer-body .card[data-asset="${asset}"]`);
  const hintB = await text(page, '#tool-hint');
  const nameB = await page.evaluate((id) => document.querySelector(`#drawer-body .card[data-asset="${id}"] .nm`)?.textContent ?? '', asset).catch(() => '');
  check(await visible(page, '#tool-options') && !(await visible(page, '#build-drawer')) && hintB.length > 0, `carte « ${asset} » → outil bâtiment actif (« ${hintB} »)`);
  R.notes.cardName = nameB;
  // Recherche d'un emplacement valide le long des rues de la ville de test.
  let placed = false;
  for (const [x, z] of [[-150, -30], [-120, 30], [100, 30], [0, -110], [0, 110], [-60, 30]]) {
    await page.evaluate(([a, b]) => window.__aube.lookAt(a, b, 260, 1.1, 0), [x, z]);
    await render(page, 6, 0.5);
    const p = await page.evaluate(([a, b]) => window.__aube.worldToScreen(a, b), [x, z]);
    await page.mouse.move(p.x, p.y); await page.waitForTimeout(300); await render(page, 1);
    const tp = await tool(page);
    if (tp.validity !== 'ok') continue;
    await page.mouse.click(p.x, p.y);
    await page.waitForFunction((n) => window.__aube.lastStats.buildings > n, before, { timeout: 8000 }).catch(() => undefined);
    if ((await page.evaluate(() => window.__aube.lastStats.buildings)) > before) { placed = true; break; }
  }
  check(placed, `bâtiment posé depuis la sous-barre (${before} → ${await page.evaluate(() => window.__aube.lastStats.buildings)})`);
  await page.click('#toolbar button[data-tool=select]');
  const undoOn = await page.evaluate(() => !document.querySelector('#btn-undo').disabled);
  await page.click('#btn-undo');
  await page.waitForFunction((n) => window.__aube.lastStats.buildings === n, before, { timeout: 8000 }).catch(() => undefined);
  check(undoOn && (await page.evaluate(() => window.__aube.lastStats.buildings)) === before, `Annuler → bâtiment retiré (${await page.evaluate(() => window.__aube.lastStats.buildings)})`);

  // --- Mini-carte : rendu réel et commandes de caméra.
  await page.evaluate(() => window.__aube.lookAt(0, 0, 500, 0.8, 0.9));
  await render(page, 4, 0.5);
  await page.waitForTimeout(1700);
  check(await page.evaluate(() => (window.__aubeMinimap?.renders ?? 0) > 0) && await canvasStd(page, '#mm-canvas') > 10, `mini-carte rendue (écart-type ${(await canvasStd(page, '#mm-canvas')).toFixed(1)})`);
  const box = await page.evaluate(() => { const r = document.querySelector('#mm-canvas').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  const tb2 = save.params; R.notes.mapParams = { chunks: tb2.mapChunks };
  await page.mouse.click(box.x + box.w * 0.25, box.y + box.h * 0.75);
  await render(page, 2, 0.5);
  const pAfter = await pose(page);
  const expected = await page.evaluate(([u, v]) => { const t = window.__aube.sceneCheck().terrain; return { u, v, t }; }, [0.25, 0.75]);
  check(pAfter.targetX < -100 && pAfter.targetZ > 100, `clic mini-carte (bas gauche) → caméra en (${pAfter.targetX.toFixed(0)}, ${pAfter.targetZ.toFixed(0)})`);
  R.notes.minimapClick = { pose: pAfter, expected };
  const d0 = (await pose(page)).distance;
  await page.click('#mm-zoom-in'); await render(page, 20, 0.5);
  const d1 = (await pose(page)).distance;
  await page.click('#mm-zoom-out'); await render(page, 20, 0.5); await page.click('#mm-zoom-out'); await render(page, 20, 0.5);
  const d2 = (await pose(page)).distance;
  check(d1 < d0 * 0.8 && d2 > d1 * 1.6, `zoom mini-carte : ${d0.toFixed(0)} → ${d1.toFixed(0)} → ${d2.toFixed(0)} m`);
  await page.evaluate(() => window.__aube.lookAt(0, 0, 500, 0.8, 2.0)); await render(page, 2, 0.5);
  await page.click('#mm-north'); await render(page, 20, 0.5);
  check(Math.abs((await pose(page)).yaw) < 0.05, `orientation → nord (cap ${(await pose(page)).yaw.toFixed(3)})`);
  await page.click('#btn-camera'); await render(page, 2, 0.5);
  const m1 = await page.evaluate(() => window.__aube.sceneCheck().camera);
  check(m1 === 'street' && /aérienne/.test(await text(page, '#btn-camera')), `vue rue (${m1})`);
  await page.click('#btn-camera'); await render(page, 2, 0.5);
  check(await page.evaluate(() => window.__aube.sceneCheck().camera) === 'aerial', 'retour vue aérienne');
  await page.click('#btn-cinematic');
  check(await page.evaluate(() => document.querySelector('#btn-cinematic').getAttribute('aria-pressed')) === 'true', 'survol cinématique activé');
  await page.click('#btn-cinematic');
  await page.click('#mm-toggle');
  check(!(await visible(page, '#mm-map')), 'mini-carte masquée');
  await page.click('#mm-toggle');
  check(await visible(page, '#mm-map'), 'mini-carte réaffichée');
  // --- Objectifs (phase 2C).
  await page.click('#obj-toggle');
  check(await visible(page, '#obj-body') && /2C/.test(await text(page, '#objectives')), 'Objectifs : panneau « phase 2C » déplié');
  await page.click('#obj-toggle');
  check(!(await visible(page, '#obj-body')), 'Objectifs : replié');

  // Capture de référence : finances + sous-barre Zones, vue de la ville.
  await page.evaluate(() => window.__aube.lookAt(0, 0, 330, 0.62, 0.7));
  await render(page, 6, 0.5);
  await page.click('#hud-money-btn');
  await page.click('#toolbar button[data-cat=zones]');
  await page.waitForTimeout(1700);
  await shot(page, 'bureau-reference');
  R.errors = errors;
  check(errors.length === 0, `bureau : aucune erreur de page ${errors.slice(0, 3).join(' | ')}`);
  await ctx.close();

  /* =============================== iPhone 13 (390×844) =============================== */
  const ip = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
  const p2 = await ip.newPage();
  const e2 = collectErrors(p2);
  await waitGame(p2, `${base}/index.html?autostart&seed=42&norender`);
  await loadFixture(p2);
  const small = await p2.evaluate(() => [...document.querySelectorAll('#hud button, #toolbar button, #minimap button')].filter((b) => b.offsetParent && getComputedStyle(b).visibility !== 'hidden').map((b) => ({ id: b.id || b.dataset.tool || b.dataset.cat || b.dataset.speed, s: Math.min(b.getBoundingClientRect().width, b.getBoundingClientRect().height) })).filter((x) => x.s < 40));
  check(small.length === 0, `iPhone : boutons ≥ 40 px ${JSON.stringify(small)}`);
  await shot(p2, 'iphone-jeu');
  check(!(await visible(p2, '#sidebar button[data-dash=finance]')), 'iPhone : barre latérale repliée (tiroir)');
  await p2.tap('#btn-sidebar');
  await p2.waitForTimeout(400);
  check(await visible(p2, '#sidebar button[data-dash=finance]'), 'iPhone : bouton tiroir → tableaux de bord visibles');
  await shot(p2, 'iphone-tiroir');
  await p2.tap('#sidebar button[data-dash=finance]');
  await p2.waitForTimeout(500);
  const sheet = await p2.evaluate(() => { const p = document.querySelector('#finance-panel').getBoundingClientRect(); const t = document.querySelector('#toolbar').getBoundingClientRect(); const h = document.querySelector('#hud').getBoundingClientRect(); return { l: p.left, r: p.right, top: p.top, bottom: p.bottom, tb: t.top, hud: h.bottom, W: innerWidth }; });
  check(sheet.l <= 6 && sheet.r >= sheet.W - 6 && sheet.top >= sheet.hud && sheet.bottom <= sheet.tb + 1, `iPhone : Finances en feuille pleine largeur entre la barre du haut et les outils (${JSON.stringify(sheet)})`);
  check(!(await p2.evaluate(() => document.body.classList.contains('sidebar-open'))), 'iPhone : le tiroir se referme après le choix');
  check(await tabsWhole(p2, '#finance-panel .ptabs button'), 'iPhone : onglets non tronqués');
  await shot(p2, 'iphone-finances');
  await p2.tap('#finance-close');
  await p2.tap('#toolbar button[data-cat=zones]');
  await p2.waitForTimeout(300);
  await shot(p2, 'iphone-zones');
  await p2.tap('#drawer-close');
  const tbx = await p2.evaluate(() => { const t = document.querySelector('#toolbar'); return { sw: t.scrollWidth, cw: t.clientWidth, docW: document.documentElement.scrollWidth }; });
  check(tbx.sw <= tbx.cw + 1 && tbx.docW <= 390, `iPhone : aucun débordement horizontal (${JSON.stringify(tbx)})`);
  check(e2.length === 0, `iPhone : aucune erreur ${e2.slice(0, 3).join(' | ')}`);
  await ip.close();
} catch (e) {
  console.error('ERREUR', e); R.crash = String(e?.stack ?? e); failed = true;
} finally {
  writeFileSync(join(out, 'ui-refonte.json'), JSON.stringify(R, null, 2));
  await browser.close(); server.close();
}
console.log(failed ? '\nREFONTE INTERFACE : ÉCHEC' : `\nREFONTE INTERFACE : SUCCÈS (${R.checks.length} vérifications)`);
process.exit(failed ? 1 : 0);
