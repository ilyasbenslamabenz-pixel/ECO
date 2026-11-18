/**
 * Audit « tout le jeu » (ordinateur, 1440×900) : un joueur qui clique dans la vraie interface. Chaque étape est
 * indépendante (une erreur n'arrête pas les suivantes) et vérifie l'EFFET dans la simulation, pas seulement l'absence
 * d'erreur : routes (droite, carrefour, courbe, quadrillage, amélioration), zones et croissance, pose de bâtiment et
 * de variante, services et amélioration de niveau, électricité, eau, déchets, politiques, recherche, impôts, emprunt,
 * ligne de bus, terrain (source d'eau), démolition et annulation, tous les tableaux de bord, sauvegarde et chargement.
 *   node tests/e2e/audit-jeu.mjs [dossier]   (après npm run build)
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { collectErrors, launch, root, serve } from './lib.mjs';

const out = process.argv[2] || join(root, 'tests/e2e/out/audit');
mkdirSync(out, { recursive: true });
const { server, base } = await serve();
const browser = await launch();
const results = [];
const check = (ok, msg) => { results.push({ ok: !!ok, msg }); console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${msg}`); };

try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = collectErrors(page);
  await page.goto(`${base}/index.html?autostart&seed=7&norender`, { timeout: 300000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__aube?.ready && window.__aube.snapshotReceived, null, { timeout: 300000 });
  const send = (name, args) => page.evaluate(([n, a]) => window.__aube.send(n, a).then((r) => ({ ok: true, r }), (e) => ({ ok: false, e: e.message })), [name, args]);
  const plug = async (plugin, name, payload) => { const r = await send('pluginCommand', { plugin, name, ...(payload !== undefined ? { payload } : {}) }); return r.ok ? r.r.data : null; };
  const render = (n = 2) => page.evaluate((k) => window.__aube.renderNow(k, 1 / 30), n);
  const screen = (x, z) => page.evaluate(([a, b]) => window.__aube.worldToScreen(a, b), [x, z]);
  const save = async () => (await send('save', { slot: 'audit-etat' })).r?.data;
  const shot = async (name) => { await render(2); await page.screenshot({ path: join(out, `${name}.png`) }); };
  const clickWorld = async (x, z) => { const p = await screen(x, z); if (p.x < 40 || p.y < 70 || p.x > 1400 || p.y > 760) throw new Error(`point (${x}, ${z}) hors de l'écran (${Math.round(p.x)}, ${Math.round(p.y)})`); await page.mouse.move(p.x - 3, p.y); await render(1); await page.mouse.move(p.x, p.y); await render(1); await page.waitForTimeout(250); await page.mouse.click(p.x, p.y); await page.waitForTimeout(500); await render(1); };
  const hoverWorld = async (x, z) => { const p = await screen(x, z); await page.mouse.move(p.x - 3, p.y); await render(1); await page.mouse.move(p.x, p.y); await render(1); await page.waitForTimeout(400); };
  // Échap : quitte l'outil / le tracé en cours, sans jamais laisser le menu principal ouvert (il masque la barre d'outils).
  const menuOpen = () => page.evaluate(() => !document.getElementById('menu')?.classList.contains('hidden'));
  const esc = async () => {
    // Un Échap arrête un tracé enchaîné ; puis retour explicite à la Sélection (jamais d'Échap « à vide », qui ouvre le menu).
    const drawing = await page.evaluate(() => document.body.classList.contains('road-drawing'));
    if (drawing) { await page.keyboard.press('Escape'); await page.waitForTimeout(150); }
    await page.evaluate(() => { document.getElementById('drawer-close')?.click(); document.querySelector('#toolbar button[data-tool="select"]')?.click(); });
    await page.waitForTimeout(150);
    if (await menuOpen()) { await page.evaluate(() => document.getElementById('btn-continue')?.click()); await page.waitForTimeout(300); }
  };
  const tickHours = async (h) => { await send('setSpeed', { speed: 16 }); await page.waitForTimeout(h * 150); await send('setSpeed', { speed: 0 }); };
  const step = async (name, fn) => {
    try { await fn(); } catch (e) {
      const lines = e.message.split('\n'); const why = lines.find((l) => /intercepts|waiting for/.test(l)) ?? '';
      check(false, `${name} : exception ${lines[0]} ${why.trim()}`);
      await shot(`echec-${name.replace(/[^a-z0-9]+/gi, '-')}`).catch(() => undefined);
    }
  };
  const toasts = () => page.evaluate(() => [...document.querySelectorAll('.toast')].slice(-2).map((t) => t.textContent.trim()).join(' | '));
  const focus = async (x, z, d = 360) => { await page.evaluate(([a, b, c]) => window.__aube.lookAt(a, b, c, 1.05, 0), [x, z, d]); await render(2); };
  const openDrawer = async (sel) => { await page.evaluate((s) => { const d = document.getElementById('build-drawer'); const b = document.querySelector(s); if (b && (d.classList.contains('hidden') || d.dataset.drawer !== b.dataset.cat)) b.click(); }, sel); await page.waitForTimeout(600); };
  const pickCard = async (assetId) => { const ok = await page.evaluate((id) => { const c = document.querySelector(`#drawer-body .card[data-asset="${id}"]`); if (c) c.click(); return !!c; }, assetId); await page.waitForTimeout(400); return ok; };
  const tab = async (id) => { await page.evaluate((t) => document.querySelector(`#drawer-tabs [data-tab="${t}"]`)?.click(), id); await page.waitForTimeout(400); };
  const act = async (label) => page.evaluate((l) => { const b = [...document.querySelectorAll('#tool-actions button')].find((x) => x.textContent.trim() === l); if (b) b.click(); return !!b; }, label);

  // Nouvelle partie : carte sans rivière, budget confortable (on teste les fonctions, pas l'équilibre).
  const ng = await send('newGame', { seed: 7, mapChunks: 8, startMoney: 30_000_000, cityName: 'Audit-Ville', startHour: 11, terrain: { hydrology: 'aucune', rivers: 0 } });
  check(ng.ok, `nouvelle partie ${ng.ok ? '' : ng.e}`);
  await page.waitForTimeout(1500);
  await send('setSpeed', { speed: 0 });
  // Site plat et sec : trois tracés à blanc acceptés.
  let X = 0, Z = 0;
  for (let r = 0, found = false; r < 800 && !found; r += 40) for (let a = 0; a < 8 && !found; a++) {
    const x = Math.round(Math.cos(a * 0.8) * r), z = Math.round(Math.sin(a * 0.8) * r);
    const d = [await send('buildRoad', { type: 'street', points: [x - 200, z, x + 200, z], dryRun: true }), await send('buildRoad', { type: 'street', points: [x, z - 150, x, z + 150], dryRun: true }), await send('buildRoad', { type: 'street', points: [x - 200, z + 160, x + 200, z + 160], dryRun: true })];
    if (d.every((q) => q.ok)) { X = x; Z = z; found = true; }
  }
  check(true, `site retenu (${X}, ${Z})`);
  await page.evaluate(([x, z]) => window.__aube.lookAt(x, z + 40, 520, 1.05, 0), [X, Z]);
  await render(3);
  const edges = async () => { const s = await save(); return (s?.roads?.edges ?? s?.edges ?? []); };

  /* ---------------- Routes ---------------- */
  await step('routes', async () => {
    await page.click('#toolbar button[data-tool=road]', { timeout: 5000 }); await page.waitForTimeout(500);
    await page.evaluate(() => document.querySelector('#drawer-body .road-card[data-road=street]')?.click()); await page.waitForTimeout(400);
    const e0 = (await edges()).length;
    await clickWorld(X - 200, Z); await clickWorld(X + 200, Z); await esc();
    const e1 = (await edges()).length;
    check(e1 > e0, `rue droite tracée à la souris (${e0} → ${e1} tronçons)`);
    await page.click('#toolbar button[data-tool=road]', { timeout: 5000 }); await page.waitForTimeout(300);
    await page.evaluate(() => document.querySelector('#drawer-body .road-card[data-road=street]')?.click()); await page.waitForTimeout(300);
    await clickWorld(X, Z - 150); await clickWorld(X, Z + 160); await esc();
    const e2 = (await edges()).length;
    check(e2 >= e1 + 2, `rue transversale : carrefour automatique (${e1} → ${e2} tronçons)`);
    // Rue parallèle au nord (troisième rue) pour les zones et les services.
    await page.click('#toolbar button[data-tool=road]', { timeout: 5000 }); await page.waitForTimeout(300);
    await page.evaluate(() => document.querySelector('#drawer-body .road-card[data-road=street]')?.click()); await page.waitForTimeout(300);
    await clickWorld(X - 200, Z + 160); await clickWorld(X + 200, Z + 160); await esc();
    // Courbe.
    await page.click('#toolbar button[data-tool=road]', { timeout: 5000 }); await page.waitForTimeout(300);
    await page.evaluate(() => document.querySelector('#drawer-body .road-card[data-road=street]')?.click()); await page.waitForTimeout(300);
    await act('Courbe');
    const before = await edges();
    await clickWorld(X + 200, Z); await clickWorld(X + 280, Z + 40); await clickWorld(X + 280, Z + 120); await esc();
    const after = await edges();
    const curved = after.filter((e) => !before.some((b) => b.id === e.id)).some((e) => Array.isArray(e.control) || e.c1 || e.curve || e.cx !== undefined);
    check(after.length > before.length, `route courbe tracée (${before.length} → ${after.length})${curved ? ', courbe confirmée' : ''}`);
    await shot('routes');
  });
  await step('quadrillage', async () => {
    await focus(X - 120, Z - 215);
    await page.click('#toolbar button[data-tool=road]', { timeout: 5000 }); await page.waitForTimeout(300);
    await page.evaluate(() => document.querySelector('#drawer-body .road-card[data-road=street]')?.click()); await page.waitForTimeout(300);
    await act('Quadrillage');
    const n0 = (await edges()).length;
    await clickWorld(X - 200, Z - 260); await clickWorld(X - 40, Z - 170); await page.waitForTimeout(800);
    // Validation éventuelle (souris : 2e clic valide ; sinon bouton de confirmation).
    await page.evaluate(() => { const b = document.getElementById('tc-ok'); if (b && !document.getElementById('touch-confirm').classList.contains('hidden') && !b.disabled) b.click(); });
    await page.waitForTimeout(800); await esc();
    const n1 = (await edges()).length;
    check(n1 >= n0 + 4, `quadrillage : îlot de rues créé (${n0} → ${n1} tronçons)`);
  });
  await step('amélioration de route', async () => {
    await focus(X - 60, Z);
    await page.click('#toolbar button[data-tool=road]', { timeout: 5000 }); await page.waitForTimeout(300);
    await page.evaluate(() => document.querySelector('#drawer-body [data-road-sub="upgrade"]')?.click()); await page.waitForTimeout(400);
    await act('Gamme +');
    const kindAt = async () => { const es = await edges(); const p = (await save())?.roads?.nodes ?? []; return es.map((e) => e.kind ?? e.type); };
    const k0 = await kindAt();
    await hoverWorld(X - 100, Z); await page.waitForTimeout(800);
    const tag = await page.evaluate(() => document.getElementById('cursor-tag')?.textContent ?? '');
    await clickWorld(X - 100, Z); await page.waitForTimeout(800); await esc();
    const k1 = await kindAt();
    const n0 = k0.filter((k) => k === 'avenue').length, n1 = k1.filter((k) => k === 'avenue').length;
    check(n1 > n0, `Améliorer › Gamme + : rue → avenue (avenues ${n0} → ${n1}) — étiquette « ${tag.replace(/\n/g, ' / ').slice(0, 90)} »`);
  });

  /* ---------------- Zones et croissance ---------------- */
  await step('zones', async () => {
    await focus(X, Z + 120, 480);
    await openDrawer('#toolbar button[data-cat=zones]');
    await page.click('#drawer-body [data-zone=res_faible]');
    const drag = async (pts) => { const f = await screen(...pts[0]); await page.mouse.move(f.x, f.y); await page.mouse.down(); for (let s = 1; s <= 30; s++) { const t = s / 30; const p = await screen(pts[0][0] + (pts[1][0] - pts[0][0]) * t, pts[0][1] + (pts[1][1] - pts[0][1]) * t); await page.mouse.move(p.x, p.y); await page.waitForTimeout(10); } await page.mouse.up(); await page.waitForTimeout(400); };
    await drag([[X - 190, Z + 156], [X - 20, Z + 156]]);
    await page.click('#drawer-body [data-zone=commerce]');
    await drag([[X + 20, Z + 156], [X + 190, Z + 156]]);
    await page.click('#drawer-body [data-zone=industrie]');
    await drag([[X + 20, Z - 4], [X + 190, Z - 4]]);
    const st = await plug('zonage', 'state');
    const cells = st ? Object.values(st.stats.cells).reduce((a, b) => a + b, 0) : 0;
    check(cells > 50, `zones peintes à la souris : ${JSON.stringify(st?.stats?.cells)}`);
    await esc();
  });

  /* ---------------- Services publics (raccordements) ---------------- */
  await step('raccordements', async () => {
    const e = await plug('electricite', 'raccordement', { on: true });
    const w = await plug('eau', 'raccordement', { on: true });
    check(!!e && !!w, 'raccordements électricité et eau');
  });
  await step('croissance', async () => {
    await tickHours(30);
    const st = await plug('zonage', 'state');
    const built = st ? Object.values(st.stats.buildings).reduce((a, b) => a + b, 0) : 0;
    const pop = await page.evaluate(() => window.__aube.lastStats?.population ?? 0);
    check(built > 0 && pop > 0, `croissance du zonage : ${built} bâtiments privés, ${pop} habitants`);
    await shot('croissance');
  });

  /* ---------------- Pose de bâtiments ---------------- */
  const buildingCount = async () => (await save())?.buildings?.length ?? 0;
  const placeAt = async (drawerSel, tabId, assetId, x, z) => {
    await openDrawer(drawerSel);
    if (tabId) await tab(tabId);
    const ok = await pickCard(assetId);
    if (!ok) return { ok: false, why: `carte ${assetId} absente` };
    const n0 = await buildingCount();
    await hoverWorld(x, z); await page.waitForTimeout(600);
    const tag = await page.evaluate(() => document.getElementById('cursor-tag')?.textContent ?? '');
    await clickWorld(x, z); await page.waitForTimeout(800);
    const n1 = await buildingCount();
    await esc();
    return { ok: n1 > n0, why: `${tag.replace(/\n/g, ' / ').slice(0, 120)}${n1 > n0 ? '' : ` ; message : ${await toasts()}`}` };
  };
  await step('maison', async () => {
    await focus(X - 120, Z); const r = await placeAt('#toolbar button[data-tool=building]', 'house', 'maison_pavillon_enduit', X - 170, Z + 22);
    check(r.ok, `maison posée à la souris le long d'une rue (${r.why})`);
  });
  await step('variante', async () => {
    await openDrawer('#toolbar button[data-tool=building]'); await tab('house');
    const card = page.locator('#drawer-body .card[data-asset="maison_brique_pignon"]');
    await card.hover(); await page.waitForTimeout(600);
    const nv = await page.evaluate(() => document.querySelectorAll('#card-detail .cd-var').length);
    check(nv > 1, `fiche au survol : ${nv} variantes listées`);
    if (nv > 1) {
      await page.locator('#card-detail .cd-var').nth(1).click(); await page.waitForTimeout(400);
      const n0 = await buildingCount();
      await focus(X - 120, Z); await clickWorld(X - 120, Z + 22); await page.waitForTimeout(800); await esc();
      const s = await save();
      const b = (s?.buildings ?? []).filter((q) => (q.assetId ?? q.asset) === 'maison_brique_pignon').pop();
      check((s?.buildings?.length ?? 0) > n0 && b && b.variant === 1, `variante choisie dans la fiche puis posée (variante ${b?.variant})`);
    }
  });
  let schoolId = null;
  await step('service + amélioration de niveau', async () => {
    await focus(X - 60, Z); const r = await placeAt('#toolbar button[data-cat=services]', 'education', 'proc_ecole_moderne', X - 60, Z + 30);
    check(r.ok, `école posée (${r.why})`);
    const s = await save();
    schoolId = (s?.buildings ?? []).filter((q) => (q.assetId ?? q.asset) === 'proc_ecole_moderne').pop()?.id ?? null;
    if (schoolId !== null) {
      await page.evaluate((i) => window.__aube.selectBuilding(i), schoolId); await page.waitForTimeout(1500);
      const lvl0 = (await plug('ameliorations', 'info', { buildingId: schoolId }))?.level;
      const clicked = await page.evaluate(() => { const b = [...document.querySelectorAll('#info-actions button')].find((x) => /^Améliorer/.test(x.textContent.trim())); if (b) b.click(); return b?.textContent ?? null; });
      await page.waitForTimeout(1200);
      const lvl1 = (await plug('ameliorations', 'info', { buildingId: schoolId }))?.level;
      check(clicked && lvl1 === lvl0 + 1, `fiche de l'école : « ${clicked} » → niveau ${lvl0} → ${lvl1}`);
      await shot('amelioration');
      await page.evaluate(() => document.getElementById('info-close')?.click());
    }
  });
  await step('électricité', async () => {
    await focus(X - 150, Z); const r = await placeAt('#toolbar button[data-cat=energy]', null, 'elec_eolienne', X - 175, Z - 20);
    const st = await plug('electricite', 'state');
    check(r.ok && (st?.facilities?.length ?? 0) > 0, `éolienne posée (${r.why}) ; installations : ${st?.facilities?.length}`);
  });
  await step('eau', async () => {
    await focus(X - 110, Z); const r = await placeAt('#toolbar button[data-cat=water]', null, 'eau_station_pompage', X - 115, Z - 24);
    const st = await plug('eau', 'state');
    check(r.ok && (st?.facilities?.length ?? 0) > 0, `station de pompage posée (${r.why}) ; installations : ${st?.facilities?.length}`);
  });
  await step('déchets', async () => {
    await focus(X, Z + 80);
    const a = await placeAt('#toolbar button[data-cat=waste]', null, 'dechets_depot_camions', X + 24, Z + 75);
    const b = await placeAt('#toolbar button[data-cat=waste]', null, 'dechets_decharge', X - 30, Z + 90);
    check(a.ok && b.ok, `dépôt de camions (${a.why}) et décharge (${b.why}) posés`);
  });

  /* ---------------- Tableaux de bord et gestion ---------------- */
  const openDash = async (k) => { await page.evaluate((d) => { const b = document.querySelector(`#sidebar [data-dash="${d}"]`); if (b && !b.classList.contains('active')) b.click(); }, k); await page.waitForTimeout(1000); };
  await step('politiques', async () => {
    await openDash('policy');
    const id = await page.evaluate(() => { const b = [...document.querySelectorAll('[data-policy].gov-btn')].find((x) => !x.classList.contains('locked') && !x.classList.contains('on')); if (b) b.click(); return b?.dataset.policy ?? null; });
    await page.waitForTimeout(1200);
    const st = await plug('politiques', 'state');
    check(id && st?.policies?.some((p) => p.id === id && p.active), `politique adoptée depuis le tableau de bord : ${id}`);
  });
  await step('recherche', async () => {
    await openDash('research');
    const id = await page.evaluate(() => { const b = document.querySelector('[data-research]:not([disabled])'); if (b) b.click(); return b?.dataset.research ?? null; });
    await page.waitForTimeout(1200);
    const st = await plug('recherche', 'state');
    const running = JSON.stringify(st ?? {}).includes(id ?? '§');
    check(id && running, `projet de recherche lancé : ${id}`);
  });
  await step('impôts', async () => {
    await page.evaluate(() => document.getElementById('btn-finance')?.click()); await page.waitForTimeout(800);
    await page.evaluate(() => document.getElementById('btn-fin-tax')?.click()); await page.waitForTimeout(500);
    await page.evaluate(() => { const i = document.querySelector('#fin-tax-body input[type=range]'); if (i) { i.value = '12'; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); } });
    await page.waitForTimeout(1200);
    const r = (await send('getReport', {})).r;
    const rate = r?.economy?.taxRates?.residential ?? null;
    check(rate !== null && Math.abs(rate - 0.12) < 1e-6, `impôt résidentiel réglé au curseur : ${rate}`);
  });
  await step('emprunt', async () => {
    await page.evaluate(() => document.getElementById('btn-fin-loan')?.click()); await page.waitForTimeout(500);
    const m0 = await page.evaluate(() => window.__aube.lastStats?.money);
    await page.evaluate(() => { const a = document.getElementById('loan-amount'); if (a) { a.value = '200000'; a.dispatchEvent(new Event('input', { bubbles: true })); } document.getElementById('form-loan')?.requestSubmit(); });
    await page.waitForTimeout(1500);
    const r = (await send('getReport', {})).r;
    check((r?.economy?.loans?.length ?? 0) > 0, `emprunt contracté depuis le panneau Dette (${r?.economy?.loans?.length} emprunt(s), trésorerie ${m0} → ${await page.evaluate(() => window.__aube.lastStats?.money)})`);
    await page.evaluate(() => document.getElementById('btn-finance')?.click());
  });
  await step('ligne de bus', async () => {
    await focus(X, Z + 80, 520);
    await openDrawer('#toolbar button[data-cat=transport]');
    await page.evaluate(() => document.querySelector('#drawer-tabs [data-tab="bus"]')?.click()); await page.waitForTimeout(600);
    await page.evaluate(() => document.querySelector('[data-bus="new"]')?.click()); await page.waitForTimeout(400);
    await clickWorld(X - 150, Z); await clickWorld(X + 150, Z); await clickWorld(X + 150, Z + 160); await page.waitForTimeout(1200);
    const prev = await page.evaluate(() => document.querySelector('[data-bus-preview]')?.textContent ?? '');
    await page.evaluate(() => document.querySelector('[data-bus="validate"]:not([disabled])')?.click()); await page.waitForTimeout(1200);
    const st = await plug('bus', 'state');
    check((st?.lines?.length ?? 0) > 0, `ligne de bus créée (${st?.lines?.length} ligne(s)) — « ${prev.slice(0, 80)} »`);
    await page.evaluate(() => document.getElementById('drawer-close')?.click());
  });
  await step('terrain : source', async () => {
    await page.click('#toolbar button[data-cat=terrain]'); await page.waitForTimeout(500);
    await page.evaluate(() => document.querySelector('#drawer-body [data-terrain="source"]')?.click()); await page.waitForTimeout(400);
    const sx = X - 300, sz = Z - 300;
    await focus(sx, sz);
    await hoverWorld(sx, sz); await page.waitForTimeout(1500);
    const tag = await page.evaluate(() => document.getElementById('cursor-tag')?.textContent ?? '');
    await clickWorld(sx, sz); await page.waitForTimeout(800);
    await page.evaluate(() => { const b = document.getElementById('tc-ok'); if (b && !document.getElementById('touch-confirm').classList.contains('hidden') && !b.disabled) b.click(); });
    await esc();
    const h0 = (await send('hydroState', {})).r;
    await tickHours(6);
    const h1 = (await send('hydroState', {})).r;
    check((h1?.sources?.length ?? 0) > 0, `source posée à la souris (${h1?.sources?.length} source(s)) — aperçu « ${tag.replace(/\n/g, ' / ').slice(0, 100)} »`);
  });
  await step('démolir + annuler', async () => {
    const s = await save();
    const house = (s?.buildings ?? []).find((q) => (q.assetId ?? q.asset) === 'maison_pavillon_enduit');
    if (!house) { check(false, 'démolir : maison du joueur introuvable'); return; }
    const n0 = s.buildings.length;
    await focus(house.x, house.z); await page.keyboard.press('KeyB'); await page.waitForTimeout(300);
    await clickWorld(house.x, house.z); await page.waitForTimeout(800);
    await page.evaluate(() => { const b = document.getElementById('tc-ok'); if (b && !document.getElementById('touch-confirm').classList.contains('hidden') && !b.disabled) b.click(); });
    await page.waitForTimeout(600);
    const n1 = await buildingCount();
    await esc();
    await page.keyboard.press('Control+z'); await page.waitForTimeout(1500);
    const n2 = await buildingCount();
    check(n1 === n0 - 1, `Démolir (touche B) : bâtiment démoli (${n0} → ${n1})`);
    check(n2 === n0, `Annuler (Ctrl+Z) : bâtiment rétabli (${n1} → ${n2})`);
  });
  await step('tous les tableaux de bord', async () => {
    const dashes = await page.evaluate(() => [...document.querySelectorAll('#sidebar [data-dash]')].map((b) => b.dataset.dash));
    const bad = [];
    for (const d of dashes) {
      const errBefore = errors.length;
      await page.evaluate((k) => { const b = document.querySelector(`#sidebar [data-dash="${k}"]`); if (b && !b.classList.contains('active')) b.click(); }, d);
      await page.waitForTimeout(700);
      const shown = await page.evaluate(() => [...document.querySelectorAll('.panel')].some((p) => { const cs = getComputedStyle(p); const r = p.getBoundingClientRect(); return !p.classList.contains('hidden') && cs.display !== 'none' && cs.visibility !== 'hidden' && r.height > 80 && r.width > 100; }));
      if (!shown || errors.length > errBefore) bad.push(`${d}${shown ? '' : ' (non affiché)'}${errors.length > errBefore ? ' (erreur)' : ''}`);
    }
    check(bad.length === 0, `${dashes.length} tableaux de bord ouverts : ${bad.length ? `problèmes ${bad.join(', ')}` : dashes.join(', ')}`);
    await esc();
  });
  await step('sauvegarde et chargement', async () => {
    const before = await buildingCount();
    await page.click('#btn-save'); await page.waitForTimeout(400);
    await page.fill('#save-name', 'Audit complet'); await page.press('#save-name', 'Enter'); await page.waitForTimeout(1500);
    await page.goto(`${base}/index.html?norender`, { timeout: 300000, waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__aube?.ready === true, null, { timeout: 300000 });
    await page.click('#btn-load'); await page.waitForSelector('#load-list .slot');
    await page.locator('#load-list .slot', { hasText: /audit complet/i }).locator('button.primary').click();
    await page.waitForFunction(() => window.__aube.snapshotReceived, null, { timeout: 120000 });
    // Le menu se referme une fois les bâtiments visibles préchargés (src/main.ts › loadSlot).
    const closed = await page.waitForFunction(() => document.getElementById('menu')?.classList.contains('hidden'), null, { timeout: 120000 }).then(() => true, () => false);
    check(closed, 'menu refermé après le chargement : retour à la partie');
    await page.waitForTimeout(1000);
    const after = await buildingCount();
    check(after === before, `sauvegarde par l'interface puis chargement après rechargement de la page (${before} → ${after} bâtiments)`);
  });
  check(!(await menuOpen()), 'le menu principal ne s\'est jamais ouvert par erreur en fin de parcours');
  check(errors.length === 0, `aucune erreur de page (${errors.length}) ${errors.slice(0, 3).join(' | ')}`);
} finally { await browser.close(); server.close(); }
const ko = results.filter((r) => !r.ok);
console.log(`\nAUDIT : ${results.length - ko.length}/${results.length} contrôles réussis`);
if (ko.length) { console.log('Échecs :'); for (const r of ko) console.log(`  - ${r.msg}`); }
process.exit(ko.length ? 1 : 0);
