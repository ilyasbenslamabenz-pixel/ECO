/**
 * Recette QA n° 5 — partie jouée À LA SOURIS par le menu, bureau 1440×900 :
 *  nouvelle partie (formulaire), avenue droite, rue courbe, RANGÉE de maisons alignées le long de l'avenue,
 *  démolition au bulldozer, vitesses ×1 → ×16 (rythme réel de l'horloge mesuré), sauvegarde par le panneau,
 *  rechargement de la page puis chargement par le menu (ville identique), démo depuis le menu.
 *  Contrôles d'interface : « Meknes City », montants en CHF (aucun ¢, aucun NaN), boutons grisés avec leur phase,
 *  barre d'outils Transports / Nature (modèles port, aéroport, mobilier ?), erreurs console.
 * Lancement : npm run build puis node tests/e2e/qa5-jeu.mjs. Sorties : tests/e2e/out/qa5/jeu-*.png + jeu.json.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectErrors, launch, root, serve } from './lib.mjs';

const out = join(root, 'tests/e2e/out/qa5');
mkdirSync(out, { recursive: true });
const R = { checks: [], notes: {} };
let failed = false;
const check = (ok, msg) => { R.checks.push({ ok: !!ok, msg }); console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${msg}`); if (!ok) failed = true; };
const note = (k, v) => { R.notes[k] = v; console.log(`     ${k}: ${typeof v === 'string' ? v : JSON.stringify(v).slice(0, 400)}`); };

const { server, base } = await serve();
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
let page = await ctx.newPage();
let errors = collectErrors(page);
const render = (n = 1, dt = 1 / 30) => page.evaluate(([k, d]) => window.__aube.renderNow(k, d), [n, dt]);
const settle = () => render(16, 0.5);
const stats = () => page.evaluate(() => window.__aube.lastStats);
const scr = (x, z) => page.evaluate(([a, b]) => window.__aube.worldToScreen(a, b), [x, z]);
const preview = () => page.evaluate(() => window.__aube.toolPreview());
const send = (n, a) => page.evaluate(([n, a]) => window.__aube.send(n, a).then((r) => ({ ok: true, r }), (e) => ({ ok: false, e: e.message })), [n, a]);
const saveData = async () => (await send('save', { slot: 'qa5-probe' })).r.data;
const shot = async (name) => { await render(2, 0.3); await page.waitForTimeout(2500); await render(1, 0.05); await page.screenshot({ path: join(out, `jeu-${name}.png`), timeout: 600000 }); };
const visible = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; }, sel);
async function clickWorld(x, z) {
  const p = await scr(x, z);
  if (p.y > 720 || p.y < 90 || p.x < 120 || p.x > 1300) throw new Error(`(${x}, ${z}) hors zone cliquable : ${Math.round(p.x)}, ${Math.round(p.y)}`);
  await page.mouse.move(p.x, p.y); await page.waitForTimeout(250); await render(1);
  await page.mouse.click(p.x, p.y);
  return p;
}
async function hoverWorld(x, z) { const p = await scr(x, z); await page.mouse.move(p.x, p.y); await page.waitForTimeout(350); await render(1); return p; }
async function uiAudit(label) {
  const a = await page.evaluate(() => {
    const txt = document.body.innerText;
    const money = [...txt.matchAll(/[-−+]?\d[\d\s  ,.]*\s?(?:k|K|M|Md)?\s?CHF/g)].map((m) => m[0]).slice(0, 30);
    return { cents: txt.includes('¢'), nan: /\bNaN\b|undefined|Infinity/.test(txt), aube: /Aube Urbaine/i.test(txt), money, brand: document.querySelector('.hud-brand')?.textContent?.trim() };
  });
  check(!a.cents && !a.nan && !a.aube, `${label} : ni « ¢ », ni NaN/undefined, ni « Aube Urbaine » à l'écran`);
  return a;
}

try {
  // ---------- Menu → nouvelle partie ----------
  await page.goto(`${base}/index.html?norender`, { timeout: 300000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__aube?.ready, null, { timeout: 300000, polling: 500 });
  check(await page.title() === 'Meknes City', `titre « ${await page.title()} »`);
  const menuTxt = await page.evaluate(() => document.querySelector('#main-menu')?.innerText ?? '');
  check(/Meknes City/i.test(menuTxt), 'menu : nom « Meknes City »');
  note('nomVilleParDefaut', await page.evaluate(() => document.querySelector('#new-name')?.value));
  await page.screenshot({ path: join(out, 'jeu-menu.png') });
  await page.click('#btn-new');
  await page.fill('#new-name', 'Recette QA5');
  await page.fill('#new-seed', '42');
  await page.screenshot({ path: join(out, 'jeu-nouvelle-partie.png') });
  await page.click('#form-new button[type=submit]');
  await page.waitForFunction(() => window.__aube.snapshotReceived && window.__aube.lastStats, null, { timeout: 300000, polling: 500 });
  check(/Recette QA5/.test(await page.textContent('#hud-city')), `nom de la ville dans la barre (« ${(await page.textContent('#hud-city')).trim()} »)`);
  await send('setSpeed', { speed: 0 });
  const m0 = (await stats()).money;
  note('tresorerieDepart', { sim: m0, hud: (await page.textContent('#hud-money')).trim(), solde: (await page.textContent('#hud-balance')).trim() });
  check(/CHF/.test(await page.textContent('#hud-money')), 'trésorerie affichée en CHF');
  await uiAudit('partie neuve');

  // Zone sèche repérée par play.mjs (graine 42, carte moyenne).
  const [cx, cz] = [116, 356];
  await page.evaluate(([x, z]) => window.__aube.lookAt(x, z, 520), [cx, cz]);
  await page.keyboard.press('KeyT');
  await settle();

  // ---------- Avenue droite + rue courbe ----------
  await page.click('#toolbar button[data-tool=road]');
  await page.click('#drawer-body .road-card[data-road=avenue]');
  await clickWorld(cx - 170, cz); await clickWorld(cx + 170, cz);
  await page.waitForTimeout(1200);
  await page.click('#toolbar button[data-tool=select]');
  let sd = await saveData();
  check(sd.roads.edges.some((e) => (e.kind ?? e.type) === 'avenue'), `avenue posée à la souris (${sd.roads.edges.length} tronçon(s))`);
  await page.click('#toolbar button[data-tool=road]');
  await page.click('#drawer-body .road-card[data-road=street]');
  await page.click('#tool-actions button:has-text("Courbe")');
  await clickWorld(cx - 120, cz - 30); await clickWorld(cx - 40, cz - 140); await clickWorld(cx + 80, cz - 110);
  await page.waitForTimeout(1200);
  await page.click('#toolbar button[data-tool=select]');
  sd = await saveData();
  const curved = sd.roads.edges.filter((e) => e.c1 && e.c2 && (e.kind ?? e.type) === 'street');
  check(curved.length >= 1, `rue courbe posée (${curved.length} tronçon(s) courbe(s))`);
  const sc = await page.evaluate(() => window.__aube.sceneCheck());
  check(sc.roads.segments === sd.roads.edges.length, `rendu = simulation : ${sc.roads.segments} / ${sd.roads.edges.length} tronçons`);
  await shot('routes');

  // ---------- Rangée de maisons alignées le long de l'avenue (côté sud) ----------
  await page.click('#toolbar button[data-tool=building]');
  await page.waitForTimeout(800);
  const asset = await page.evaluate(() => (document.querySelector('#drawer-body .card[data-asset="maison_pavillon_enduit"]') ?? document.querySelector('#drawer-body .card[data-asset]'))?.getAttribute('data-asset'));
  note('modeleMaison', asset);
  await page.click(`#drawer-body .card[data-asset="${asset}"]`);
  await page.evaluate(([x, z]) => window.__aube.lookAt(x, z + 20, 230), [cx, cz]);
  await settle();
  const placed = [];
  const tries = [];
  for (let k = 0; k < 6; k++) {
    const x = cx - 100 + k * 24, z = cz + 21;
    await hoverWorld(x, z);
    const pv = await preview();
    tries.push({ x, validity: pv.validity, msg: pv.message, snapped: pv.snapped, rot: pv.rot });
    if (pv.validity !== 'ok') continue;
    const b0 = (await stats()).buildings;
    const p = await scr(x, z); await page.mouse.click(p.x, p.y);
    await page.waitForFunction((n) => window.__aube.lastStats.buildings > n, b0, { timeout: 8000 }).catch(() => undefined);
    if ((await stats()).buildings > b0) placed.push(x);
  }
  note('essaisMaisons', tries);
  sd = await saveData();
  const row = sd.buildings.filter((b) => Math.abs(b.z - cz) < 40 && b.z > cz);
  note('rangee', row.map((b) => ({ x: +b.x.toFixed(2), z: +b.z.toFixed(2), rot: +b.rot.toFixed(3) })));
  check(row.length >= 4, `au moins 4 maisons posées en rangée le long de l'avenue (${row.length})`);
  const zs = row.map((b) => b.z), rots = row.map((b) => b.rot);
  check(row.length > 1 && Math.max(...zs) - Math.min(...zs) < 0.05 && Math.max(...rots) - Math.min(...rots) < 1e-3, `maisons alignées : même recul (écart ${(Math.max(...zs) - Math.min(...zs)).toFixed(3)} m) et même orientation`);
  const xs = row.map((b) => b.x).sort((a, b) => a - b);
  const gaps = xs.slice(1).map((x, i) => +(x - xs[i]).toFixed(2));
  note('ecartsRangee', gaps);
  await page.click('#toolbar button[data-tool=select]');
  await page.waitForFunction(() => window.__aube.sceneCheck().buildingsLoading === 0, null, { timeout: 120000 }).catch(() => undefined);
  await page.evaluate(([x, z]) => window.__aube.lookAt(x, z + 25, 150, 0.75, 0.3), [cx - 40, cz]);
  await settle();
  await shot('rangee');

  // ---------- Démolition au bulldozer ----------
  if (row.length) {
    const victim = row[0];
    const n0 = (await stats()).buildings, money0 = (await stats()).money;
    await page.click('#toolbar button[data-tool=bulldoze]');
    await page.evaluate(([x, z]) => window.__aube.lookAt(x, z, 150, 1.1, 0), [victim.x, victim.z]);
    await settle();
    await hoverWorld(victim.x, victim.z);
    const p = await scr(victim.x, victim.z); await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(600);
    // Confirmation éventuelle
    const conf = await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => b.offsetParent && /Confirmer|Démolir/.test(b.textContent) && !b.closest('#toolbar')).map((b) => b.textContent.trim()));
    note('boutonsConfirmation', conf);
    await page.waitForFunction((n) => window.__aube.lastStats.buildings < n, n0, { timeout: 8000 }).catch(() => undefined);
    const s1 = await stats();
    check(s1.buildings === n0 - 1, `bulldozer : maison démolie (${n0} → ${s1.buildings}, trésorerie ${money0} → ${s1.money})`);
    await page.click('#toolbar button[data-tool=select]');
    await page.waitForTimeout(400);
    await page.click('#btn-undo').catch(() => undefined);
    await page.waitForTimeout(1200);
    note('apresAnnulerDemolition', (await stats()).buildings);
  }

  // ---------- Vitesses ×1 → ×16 : rythme réel de l'horloge ----------
  const rates = {};
  for (const sp of [1, 2, 4, 8, 16]) {
    await page.click(`#hud .seg button[data-speed="${sp}"]`);
    await page.waitForFunction((v) => window.__aube.lastStats?.speed === v, sp, { timeout: 15000 }).catch(() => undefined);
    const a = await page.evaluate(() => ({ t: performance.now(), m: window.__aube.lastStats.date.totalMinutes }));
    await page.waitForTimeout(4000);
    const b = await page.evaluate(() => ({ t: performance.now(), m: window.__aube.lastStats.date.totalMinutes }));
    rates[sp] = +((b.m - a.m) / ((b.t - a.t) / 1000)).toFixed(2);
  }
  note('minutesDeJeuParSeconde', rates);
  const base1 = rates[1];
  check(base1 > 5 && base1 < 15, `×1 : ${base1} min de jeu / s (attendu ≈ 10 : journée de 2 min 24 s)`);
  for (const sp of [2, 4, 8, 16]) check(rates[sp] > base1 * sp * 0.6, `×${sp} : ${rates[sp]} min/s (≥ 60 % de ${(base1 * sp).toFixed(1)})`);
  // Clavier : pause (espace ou 0)
  await page.keyboard.press('Digit1'); await page.waitForTimeout(500);
  note('toucheDigit1', (await stats()).speed);
  await page.click('#hud .seg button[data-speed="0"]');
  await page.waitForFunction(() => window.__aube.lastStats?.speed === 0, null, { timeout: 15000 }).catch(() => undefined);
  const after16 = await stats();
  note('apresVitesses', { date: after16.date, pop: after16.population, money: after16.money, tickMs: after16.tickMs });
  await uiAudit('après ×16');

  // ---------- Barre d'outils : Transports, Nature, Services ----------
  for (const cat of ['transport', 'environment', 'services']) {
    await page.click(`#toolbar button[data-cat=${cat}]`);
    await page.waitForTimeout(400);
    const info = await page.evaluate(() => ({
      titre: document.querySelector('#drawer-title')?.textContent,
      onglets: [...document.querySelectorAll('#drawer-tabs .chip-tab')].map((t) => t.textContent.trim()),
      actifs: [...document.querySelectorAll('#drawer-body .card:not(:disabled)')].map((c) => c.getAttribute('data-asset') ?? c.textContent.trim()).slice(0, 40),
      grises: [...document.querySelectorAll('#drawer-body :disabled')].map((c) => c.textContent.replace(/\s+/g, ' ').trim()).slice(0, 40),
    }));
    note(`tiroir-${cat}`, info);
    await shot(`tiroir-${cat}`);
    await page.click('#drawer-close').catch(() => undefined);
  }
  // Boutons grisés : tous avec une phase.
  const greyed = await page.evaluate(() => [...document.querySelectorAll('#toolbar button:disabled, #sidebar button:disabled, .soon')].filter((b) => b.offsetParent).map((b) => ({ t: b.textContent.replace(/\s+/g, ' ').trim(), tip: b.dataset.tip ?? '' })));
  note('grises', greyed);
  check(greyed.every((g) => /2[ABC]|[Pp]hase\s*\d/.test(g.t + g.tip)), `chaque fonction grisée porte sa phase (${greyed.length})`);

  // ---------- Sauvegarde par le panneau, rechargement de page, chargement par le menu ----------
  await page.click('#btn-save');
  await page.fill('#save-name', 'qa5-ville');
  await page.click('#form-save button[type=submit]');
  await page.waitForTimeout(1500);
  const slots = await page.evaluate(() => [...document.querySelectorAll('#save-list li')].map((l) => l.textContent.replace(/\s+/g, ' ').trim()));
  note('emplacements', slots);
  check(slots.some((s) => /qa5-ville/.test(s)), 'sauvegarde « qa5-ville » listée');
  await page.click('#save-close');
  const ref = await saveData();
  const refStats = await stats();
  await page.reload({ waitUntil: 'domcontentloaded' });
  errors = collectErrors(page);
  await page.waitForFunction(() => window.__aube?.ready, null, { timeout: 300000, polling: 500 });
  await page.click('#btn-load');
  await page.waitForTimeout(800);
  const loadItems = await page.evaluate(() => [...document.querySelectorAll('#load-list li')].map((l) => l.textContent.replace(/\s+/g, ' ').trim()));
  note('menuCharger', loadItems);
  const target = page.locator('#load-list li', { hasText: 'qa5-ville' }).locator('button').first();
  await target.click();
  await page.waitForFunction(() => window.__aube.snapshotReceived && window.__aube.lastStats, null, { timeout: 300000, polling: 500 });
  await page.waitForTimeout(1500);
  await send('setSpeed', { speed: 0 });
  const back = await saveData();
  const s2 = await stats();
  check(back.buildings.length === ref.buildings.length && back.roads.edges.length === ref.roads.edges.length && Math.abs(s2.money - refStats.money) <= Math.abs(refStats.monthlyBalance) + 5, `chargement : ${back.buildings.length}/${ref.buildings.length} bâtiments, ${back.roads.edges.length}/${ref.roads.edges.length} tronçons, trésorerie ${s2.money} / ${refStats.money}`);
  check(JSON.stringify(back.buildings.map((b) => [b.assetId, +b.x.toFixed(2), +b.z.toFixed(2), +b.rot.toFixed(3)])) === JSON.stringify(ref.buildings.map((b) => [b.assetId, +b.x.toFixed(2), +b.z.toFixed(2), +b.rot.toFixed(3)])), 'chargement : bâtiments identiques (modèle, position, angle)');
  await page.waitForFunction(() => window.__aube.sceneCheck().buildingsLoading === 0, null, { timeout: 120000 }).catch(() => undefined);
  await shot('apres-chargement');
  check(errors.length === 0, `aucune erreur console après chargement (${errors.length}) ${errors.slice(0, 3).join(' | ')}`);

  // ---------- Démo depuis le menu ----------
  await page.click('#btn-menu');
  await page.waitForTimeout(500);
  await page.click('#btn-demo');
  await page.waitForFunction(() => window.__aube.demoReady === true || window.__aube.errors.length > 0, null, { timeout: 1500000, polling: 1000 });
  const demo = await page.evaluate(() => window.__aube.demo);
  note('demo', { buildings: demo?.buildings?.length ?? demo?.buildings, vehicles: demo?.vehicles, decor: demo?.decor });
  check(await page.evaluate(() => window.__aube.errors.length === 0), 'démo lancée depuis le menu sans erreur');
  await uiAudit('démo');
  await shot('demo-menu');
  R.errors = errors;
  check(errors.length === 0, `aucune erreur console / page (${errors.length}) ${errors.slice(0, 3).join(' | ')}`);
} catch (e) {
  console.error('ERREUR', e); R.crash = String(e?.stack ?? e); failed = true;
  await page.screenshot({ path: join(out, 'jeu-crash.png') }).catch(() => undefined);
} finally {
  writeFileSync(join(out, 'jeu.json'), JSON.stringify(R, null, 2));
  await browser.close(); server.close();
}
console.log(failed ? '\nQA5 JEU : ÉCHEC' : `\nQA5 JEU : SUCCÈS (${R.checks.length} vérifications)`);
process.exit(failed ? 1 : 0);
