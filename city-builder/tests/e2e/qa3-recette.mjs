/**
 * Recette QA n° 3 (phase 1) — contrôle indépendant des corrections de la recette n° 2 et recherche de régressions.
 * Usage : node tests/e2e/qa3-recette.mjs [demo|ouverture|game|iphone|all]   (après npm run build)
 *  demo      : menu -> démo ; boutons ×1..×16 et touches 1..5 relus dans la simulation ; durée réelle d'une journée
 *              à ×1 (et ×16) ; vue rue par la touche V et vue rue devant un carrefour à feux (pixels de lentille) ;
 *              arbres à 3 distances (LOD) ; erreurs de page.
 *  ouverture : nouvelle partie (graine de la recette n° 2) : 1re image immédiate (rivières), LOD du terrain.
 *  game      : partie à la souris (route, gros plan immédiat de la chaussée, bâtiments, bulldozer), ×8/×16,
 *              sauvegarde par l'interface, rechargement de la page, chargement -> caméra recentrée, état identique.
 *  iphone    : iPhone 13 portrait et paysage : boutons ×8/×16 visibles et actifs au toucher, pas de débordement.
 * Captures : tests/e2e/out/qa3-*.png ; rapport : tests/e2e/out/qa3-<mode>.json. Aucune mesure de FPS (rendu logiciel).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { collectErrors, launch, root, serve } from './lib.mjs';

const out = join(root, 'tests/e2e/out');
mkdirSync(out, { recursive: true });
const only = process.argv[2] ?? 'all';
const { server, base } = await serve();
const browser = await launch();
const R = { mode: only, checks: [], notes: {} };
let failed = false;
const check = (ok, msg, extra) => {
  R.checks.push({ ok: !!ok, msg, extra });
  if (!ok) failed = true;
  console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${msg}${extra !== undefined ? ' ' + JSON.stringify(extra).slice(0, 300) : ''}`);
};
const save = () => writeFileSync(join(out, `qa3-${only}.json`), JSON.stringify(R, null, 2));
const shot = async (page, name) => {
  const path = join(out, `qa3-${name}.png`);
  await page.screenshot({ path, timeout: 600000 }).catch((e) => check(false, `capture ${name} impossible : ${e.message.split('\n')[0]}`));
  return path;
};
const render = (page, n = 2, dt = 0.1) => page.evaluate(([k, d]) => window.__aube.renderNow?.(k, d), [n, dt]);
const send = (page, n, a) => page.evaluate(([n, a]) => window.__aube.send(n, a).then((r) => ({ ok: true, r }), (e) => ({ ok: false, e: e.message })), [n, a]);
const speedNow = (page) => page.evaluate(() => window.__aube.lastStats?.speed);
const waitSpeed = async (page, s) => {
  for (let i = 0; i < 20; i++) { if ((await speedNow(page)) === s) return s; await page.waitForTimeout(250); }
  return speedNow(page);
};
const minutes = (page) => page.evaluate(() => window.__aube.lastStats?.date?.totalMinutes);

/** Pixels de lentille allumée (mêmes seuils que tests/e2e/signals.mjs). */
async function lensPixels(path) {
  const { data, info } = await sharp(path).raw().toBuffer({ resolveWithObject: true });
  let red = 0, amber = 0, green = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (r > 200 && g < 135 && b < 120 && r - g > 110) red++;
    else if (r > 200 && g > 135 && g < 215 && b < 90) amber++;
    else if (g > 190 && r < 140 && g - r > 80) green++;
  }
  return { red, amber, green };
}

/** Boutons de vitesse : clic sur chacun puis touches 1..5, vitesse relue dans la simulation. */
async function speedControls(page, label) {
  const btns = await page.evaluate(() => [...document.querySelectorAll('button[data-speed]')].map((b) => {
    const r = b.getBoundingClientRect();
    return { s: Number(b.dataset.speed), text: b.textContent.trim(), visible: b.offsetParent !== null && r.width > 0, w: Math.round(r.width), h: Math.round(r.height), disabled: b.disabled };
  }));
  R.notes[`${label}SpeedButtons`] = btns;
  check([8, 16].every((s) => btns.some((b) => b.s === s && b.visible && !b.disabled)), `${label} : boutons ×8 et ×16 visibles et actifs`, btns.map((b) => `${b.text}:${b.w}x${b.h}`));
  const clicked = {};
  for (const s of [1, 2, 4, 8, 16, 0]) {
    await page.click(`button[data-speed="${s}"]`);
    clicked[s] = await waitSpeed(page, s);
  }
  check(Object.entries(clicked).every(([k, v]) => Number(k) === v), `${label} : clic ×1/×2/×4/×8/×16/pause appliqué dans la simulation`, clicked);
  const keys = {};
  await page.mouse.click(5, 450).catch(() => undefined); // focus sur la page (hors champ de saisie)
  for (const [k, s] of [['Digit4', 8], ['Digit5', 16], ['Digit1', 1], ['Digit3', 4], ['Digit2', 2]]) {
    await page.keyboard.press(k);
    keys[k] = await waitSpeed(page, s);
  }
  check(keys.Digit4 === 8 && keys.Digit5 === 16 && keys.Digit1 === 1 && keys.Digit3 === 4 && keys.Digit2 === 2, `${label} : touches 1..5 -> ×1/×2/×4/×8/×16`, keys);
  const active = await page.evaluate(() => [...document.querySelectorAll('button[data-speed]')].filter((b) => b.classList.contains('active') || b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.speed));
  R.notes[`${label}ActiveSpeed`] = active;
  check(active.length === 1 && active[0] === '2', `${label} : bouton actif = vitesse courante (×2)`, active);
}

try {
  /* ---------------- démo ---------------- */
  if (only === 'all' || only === 'demo') {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = collectErrors(page);
    await page.goto(`${base}/index.html?norender`, { timeout: 300000, waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__aube?.ready, null, { timeout: 300000, polling: 500 });
    await page.waitForTimeout(1000);
    const menu = await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => b.offsetParent !== null).map((b) => ({ id: b.id, text: b.textContent.trim(), disabled: b.disabled })));
    R.notes.menu = menu;
    check(menu.find((b) => b.id === 'btn-demo' && !b.disabled), 'menu : bouton démo actif', menu);
    await page.click('#btn-demo');
    await page.waitForFunction(() => window.__aube.demoReady || (window.__aube.errors?.length ?? 0) > 0, null, { timeout: 900000, polling: 1000 });
    check(await page.evaluate(() => window.__aube.demoReady), 'démo prête par le bouton du menu');
    R.notes.demo = await page.evaluate(() => window.__aube.demo);
    save();
    await speedControls(page, 'démo');
    save();
    // Durée de la journée à ×1 : minutes de jeu écoulées en 20 s réelles
    await page.click('button[data-speed="1"]'); await waitSpeed(page, 1);
    await page.waitForTimeout(1500);
    const m0 = await minutes(page); const t0 = Date.now();
    await page.waitForTimeout(20000);
    const m1 = await minutes(page); const dt = (Date.now() - t0) / 1000;
    const dayReal = (1440 / Math.max(1e-6, m1 - m0)) * dt;
    R.notes.clockX1 = { m0, m1, dt, dayRealSeconds: dayReal };
    check(dayReal > 120 && dayReal < 200, `journée à ×1 ≈ ${Math.floor(dayReal / 60)} min ${Math.round(dayReal % 60)} s réelles (${(m1 - m0).toFixed(0)} min de jeu en ${dt.toFixed(1)} s ; attendu 2 min 24 s)`);
    const hud1 = await page.evaluate(() => document.querySelector('#hud-date')?.textContent);
    // ×16 : rythme (le rendu logiciel peut freiner le worker : mesure informative, contrôle large)
    await page.click('button[data-speed="16"]'); await waitSpeed(page, 16);
    const m2 = await minutes(page); const t2 = Date.now();
    await page.waitForTimeout(10000);
    const m3 = await minutes(page); const dt2 = (Date.now() - t2) / 1000;
    const ratio = ((m3 - m2) / dt2) / ((m1 - m0) / dt);
    R.notes.clockX16 = { m2, m3, dt2, ratioVsX1: ratio };
    check(ratio > 8, `×16 : l'horloge avance ${ratio.toFixed(1)} fois plus vite qu'à ×1 (worker non freiné par le rendu)`);
    const hud2 = await page.evaluate(() => document.querySelector('#hud-date')?.textContent);
    R.notes.hudClock = { hud1, hud2 };
    check(hud1 && hud2 && hud1 !== hud2, `horloge du HUD qui avance (${hud1} -> ${hud2})`);
    await page.click('button[data-speed="1"]');
    save();

    // Vue aérienne d'ensemble
    await render(page, 2, 0.5); await page.waitForTimeout(3000); await render(page, 2);
    await shot(page, 'demo-aerien');
    // Vue rue par la touche V (point de vue proposé au joueur)
    await page.keyboard.press('KeyV');
    await render(page, 3, 0.5); await page.waitForTimeout(3000); await render(page, 2);
    R.notes.poseStreetV = await page.evaluate(() => window.__aube.cameraPose());
    const pV = await shot(page, 'demo-rue-V');
    R.notes.lensStreetV = await lensPixels(pV);
    // Feux : vue rue devant un carrefour à feux (bras à mât, au niveau du terrain)
    await page.click('button[data-speed="0"]'); await waitSpeed(page, 0);
    const sig = await page.evaluate(() => window.__aube.signals());
    R.notes.signals = { arms: sig.arms.length, heads: sig.heads, junctions: new Set(sig.arms.map((a) => a.node)).size, meshes: sig.meshes };
    check(sig.arms.length >= 12, `feux dessinés : ${sig.arms.length} bras, ${sig.heads} têtes, ${R.notes.signals.junctions} carrefours`);
    let arm = null;
    for (const a of [...sig.arms.filter((x) => x.mast), ...sig.arms.filter((x) => !x.mast)]) {
      const cx = a.x - Math.sin(a.heading) * 15, cz = a.z - Math.cos(a.heading) * 15;
      const h = await page.evaluate(([x, z]) => window.__aube.heightAt(x, z), [cx, cz]);
      if (Math.abs(h - a.y) < 1.2) { arm = a; break; }
    }
    check(!!arm, 'bras de feu au niveau du terrain trouvé', arm);
    if (arm) {
      const dx = Math.sin(arm.heading), dz = Math.cos(arm.heading), rx = -dz, rz = dx;
      // conducteur : au milieu de sa voie, 25 m avant la ligne d'arrêt, regard droit devant
      const camX = arm.x - dx * 25 - rx * (arm.reach * 0.5 + 1.5), camZ = arm.z - dz * 25 - rz * (arm.reach * 0.5 + 1.5);
      await page.evaluate(([x, z, lx, lz]) => window.__aube.streetLook(x, z, lx, lz), [camX, camZ, camX + dx * 50, camZ + dz * 50]);
      await render(page, 3, 0.5); await page.waitForTimeout(4000); await render(page, 2);
      const st = await page.evaluate(() => window.__aube.signals());
      R.notes.armState = st.arms.find((a) => a.node === arm.node && Math.abs(a.heading - arm.heading) < 1e-3)?.state;
      const p = await shot(page, 'feux-conducteur');
      const px = await lensPixels(p);
      R.notes.lensDriver = px;
      check(px.red + px.amber + px.green > 6, `vue conducteur à 25 m d'un carrefour à feux : lentille allumée visible (${JSON.stringify(px)}, état ${R.notes.armState})`);
      // gros plan aérien du carrefour (feux, arbres d'alignement)
      const same = sig.arms.filter((a) => a.node === arm.node);
      const jx = same.reduce((s, a) => s + a.x, 0) / same.length, jz = same.reduce((s, a) => s + a.z, 0) / same.length;
      R.notes.junction = { jx, jz };
      // Arbres : 3 distances pour voir les bascules de LOD (50 m / 120 m) et l'imposteur au-delà
      for (const [d, pitch] of [[45, 0.55], [140, 0.7], [420, 0.8]]) {
        await page.evaluate(([x, z, dd, p]) => window.__aube.lookAt(x, z, dd, p), [jx, jz, d, pitch]);
        await render(page, 3, 0.5); await page.waitForTimeout(3000); await render(page, 2);
        R.notes[`veg${d}`] = await page.evaluate(() => window.__aube.sceneCheck().vegetation);
        await shot(page, `arbres-${d}m`);
      }
      save();
    }
    // Forêt hors ville vue de près en vue rue : imposteurs / LOD
    const veg = await page.evaluate(() => window.__aube.sceneCheck().vegetation);
    R.notes.vegetation = veg;
    check(veg.instances > 0 && veg.impostorChecks.every((c) => c.ok !== false), `végétation : ${veg.instances} arbres, ${veg.species} essences, imposteurs ${veg.impostors}`, veg.impostorChecks);
    R.notes.renderStats = await page.evaluate(() => window.__aube.renderStats());
    R.notes.errorsDemo = errors.slice(0, 20);
    check(errors.length === 0, `démo : aucune erreur de page (${errors.length})`, errors.slice(0, 5));
    await ctx.close();
    save();
  }

  /* ---------------- ouverture d'une partie : rivières ---------------- */
  if (only === 'all' || only === 'ouverture') {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const errors = collectErrors(page);
    await page.goto(`${base}/index.html?autostart&norender&seed=566201304`, { timeout: 300000, waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__aube?.ready && window.__aube.snapshotReceived, null, { timeout: 300000, polling: 250 });
    await render(page, 1, 0.05);
    R.notes.openingTerrain = await page.evaluate(() => window.__aube.sceneCheck().terrain);
    R.notes.openingPose = await page.evaluate(() => window.__aube.cameraPose());
    await shot(page, 'ouverture-immediate');
    await page.waitForTimeout(15000);
    await render(page, 2, 0.1);
    await shot(page, 'ouverture-15s');
    const t = R.notes.openingTerrain;
    check(t.lodCounts[0] >= 4, `ouverture : chunks au LOD fin dès la 1re image (${t.lodCounts.join('/')})`);
    check(errors.length === 0, `ouverture : aucune erreur de page (${errors.length})`, errors.slice(0, 5));
    await page.close();
    save();
  }

  /* ---------------- partie jouée ---------------- */
  if (only === 'all' || only === 'game') {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = collectErrors(page);
    await page.goto(`${base}/index.html?norender`, { timeout: 300000, waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__aube?.ready, null, { timeout: 300000, polling: 500 });
    await page.click('#btn-new');
    await page.waitForTimeout(800);
    await page.fill('#new-seed', '42').catch(() => undefined);
    await page.click('form button[type=submit]:visible');
    await page.waitForFunction(() => window.__aube.snapshotReceived && window.__aube.lastStats, null, { timeout: 300000, polling: 500 });
    await page.waitForTimeout(1500);
    await speedControls(page, 'partie');
    await page.click('button[data-speed="0"]'); await waitSpeed(page, 0);
    const deadPhase = await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => b.offsetParent !== null && !b.disabled && /Phase \d/.test(b.textContent)).map((b) => b.id || b.textContent.trim()));
    check(deadPhase.length === 0, 'aucun bouton actif marqué « Phase N »', deadPhase);
    // Site (même zone que la recette n° 2, graine 42)
    const cx = 516, cz = 416;
    let site = null;
    for (const [dx, dz] of [[0, 0], [-300, 0], [0, -300], [-400, -200], [-400, 0]]) {
      const r2 = await send(page, 'buildRoad', { type: 'street', kind: 'street', points: [cx + dx - 90, cz + dz, cx + dx + 90, cz + dz], dryRun: true });
      if (r2.ok) { site = [cx + dx, cz + dz]; break; }
    }
    check(!!site, `site de test trouvé ${JSON.stringify(site)}`);
    const [sx, sz] = site;
    await page.evaluate(([x, z]) => window.__aube.lookAt(x, z, 300), [sx, sz]);
    await page.keyboard.press('KeyT');
    await render(page, 8);
    const scr = (x, z) => page.evaluate(([a, b]) => window.__aube.worldToScreen(a, b), [x, z]);
    await page.click('#toolbar button[data-tool=road]');
    await page.click('#drawer-body .road-card[data-road=avenue]');
    const money0 = (await page.evaluate(() => window.__aube.lastStats)).money;
    for (const [x, z] of [[sx - 90, sz], [sx + 90, sz]]) { const p = await scr(x, z); await page.mouse.move(p.x, p.y); await render(page, 1); await page.mouse.click(p.x, p.y); }
    await page.waitForTimeout(1500);
    await page.keyboard.press('Escape');
    let sd = (await send(page, 'save', { slot: 'qa3-probe' })).r.data;
    check(sd.roads.edges.length >= 1, `avenue tracée à la souris (${sd.roads.edges.length} tronçon(s))`);
    // gros plan immédiat de la chaussée (herbe sur la route ?)
    await page.evaluate(([x, z]) => window.__aube.lookAt(x, z, 60, 0.8), [sx, sz]);
    await render(page, 1, 0.05);
    await shot(page, 'route-immediate');
    // Bâtiments à la souris
    await page.evaluate(([x, z]) => window.__aube.lookAt(x, z, 300), [sx, sz]);
    await render(page, 2);
    await page.click('#toolbar button[data-tool=building]');
    await page.waitForTimeout(600);
    await page.click('#drawer-body .card[data-asset="maison_pavillon_enduit"]');
    for (const [x, z] of [[sx - 40, sz + 30], [sx + 40, sz - 30], [sx, sz + 30]]) {
      const p = await scr(x, z);
      await page.mouse.move(p.x, p.y); await page.waitForTimeout(400); await render(page, 1);
      await page.mouse.click(p.x, p.y); await page.waitForTimeout(1200);
    }
    const p3 = await scr(sx + 60, sz);
    await page.mouse.move(p3.x + 2, p3.y); await page.waitForTimeout(500); await render(page, 1);
    const prevOnRoad = await page.evaluate(() => window.__aube.toolPreview());
    R.notes.prevOnRoad = prevOnRoad;
    check(prevOnRoad && (prevOnRoad.validity !== 'valid' || prevOnRoad.snapped), `aperçu sur la chaussée refusé ou décalé hors chaussée (${prevOnRoad?.validity} ${prevOnRoad?.message ?? ''})`, prevOnRoad);
    await page.keyboard.press('Escape');
    sd = (await send(page, 'save', { slot: 'qa3-probe' })).r.data;
    check(sd.buildings.length >= 2, `bâtiments posés à la souris : ${sd.buildings.length}`);
    const money1 = (await page.evaluate(() => window.__aube.lastStats)).money;
    check(money1 < money0, `trésorerie débitée (${money0} -> ${money1})`);
    // Bulldozer
    await page.click('#toolbar button[data-tool=bulldoze]');
    const b0 = sd.buildings[0];
    const pb = await scr(b0.x, b0.z);
    await page.mouse.move(pb.x, pb.y); await page.waitForTimeout(400); await render(page, 1);
    await page.mouse.click(pb.x, pb.y); await page.waitForTimeout(1500);
    const conf = await page.$('#tc-ok:visible'); if (conf) { await conf.click(); await page.waitForTimeout(1000); }
    sd = (await send(page, 'save', { slot: 'qa3-probe' })).r.data;
    check(!sd.buildings.some((b) => b.id === b0.id), `démolition au bulldozer (reste ${sd.buildings.length})`);
    await page.keyboard.press('Escape');
    await page.click('#toolbar button[data-tool=select]').catch(() => undefined);
    // Vie de la ville à ×16 (touche 5)
    await page.mouse.click(5, 450).catch(() => undefined);
    await page.keyboard.press('Digit5'); await waitSpeed(page, 16);
    const d0 = (await page.evaluate(() => window.__aube.lastStats.date));
    await page.waitForTimeout(20000);
    await page.keyboard.press('Space');
    await page.waitForTimeout(800);
    const st = await page.evaluate(() => window.__aube.lastStats);
    R.notes.after16 = { d0, d1: st.date, pop: st.population, money: st.money, speed: st.speed };
    check(st.speed === 0, `Espace = pause (speed ${st.speed})`);
    check(st.date.totalMinutes - d0.totalMinutes > 600, `×16 en partie : ${(st.date.totalMinutes - d0.totalMinutes).toFixed(0)} min de jeu en 20 s`);
    await render(page, 3);
    await shot(page, 'ville-apres');
    // Sauvegarde par l'interface
    await page.click('#btn-save'); await page.waitForTimeout(800);
    const slotInput = await page.$('input[name=slot]:visible, #save-name:visible, form input[type=text]:visible');
    check(!!slotInput, 'dialogue de sauvegarde avec champ de nom');
    if (slotInput) { await slotInput.fill('Recette QA3'); await page.keyboard.press('Enter'); await page.waitForTimeout(1500); await page.click('#save-close').catch(() => undefined); }
    const statsSaved = await page.evaluate(() => JSON.parse(JSON.stringify(window.__aube.lastStats)));
    const ref = (await send(page, 'save', { slot: 'qa3-probe' })).r.data;
    const bx = [...ref.buildings.map((b) => [b.x, b.z]), ...(ref.roads.nodes ?? []).map((n) => [n.x, n.z])];
    const bary = bx.length ? [bx.reduce((s, p) => s + p[0], 0) / bx.length, bx.reduce((s, p) => s + p[1], 0) / bx.length] : [sx, sz];
    R.notes.saved = { buildings: ref.buildings.length, edges: ref.roads.edges.length, money: statsSaved.money, date: statsSaved.date, bary };
    // Rechargement de la page puis chargement
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__aube?.ready, null, { timeout: 300000, polling: 500 });
    await page.waitForTimeout(1500);
    const loadBtn = await page.$('#btn-load:visible');
    check(!!loadBtn, 'bouton « Charger une partie » visible après rechargement');
    if (loadBtn) {
      await loadBtn.click(); await page.waitForTimeout(1000);
      const slots = await page.evaluate(() => [...document.querySelectorAll('#load-list li, .slot, [data-slot]')].map((e) => e.textContent.trim().slice(0, 100)));
      R.notes.slots = slots;
      const el = await page.$('li:has-text("recette-qa3") button:has-text("Charger"), li:has-text("Recette QA3") button:has-text("Charger")');
      check(!!el, `emplacement « Recette QA3 » listé (${slots.length} emplacements)`, slots);
      if (el) {
        await el.click();
        await page.waitForFunction(() => window.__aube.snapshotReceived && window.__aube.snapshotStats, null, { timeout: 300000, polling: 500 });
        await page.waitForTimeout(2000);
        const pose = await page.evaluate(() => window.__aube.cameraPose());
        const dCam = Math.hypot(pose.targetX - bary[0], pose.targetZ - bary[1]);
        R.notes.loadPose = { pose, dCam };
        check(dCam < 40, `après chargement : caméra recentrée (cible à ${dCam.toFixed(1)} m du barycentre de la ville, distance ${pose.distance?.toFixed?.(0)} m)`);
        const ld = (await send(page, 'save', { slot: 'qa3-probe2' })).r.data;
        const ss = await page.evaluate(() => window.__aube.snapshotStats);
        R.notes.afterLoad = { buildings: ld.buildings.length, edges: ld.roads.edges.length, ss };
        check(ld.buildings.length === ref.buildings.length && ld.roads.edges.length === ref.roads.edges.length, `chargement : ${ld.buildings.length}/${ref.buildings.length} bâtiments, ${ld.roads.edges.length}/${ref.roads.edges.length} tronçons`);
        check(ss && Math.abs(ss.money - statsSaved.money) <= Math.abs(statsSaved.money) * 0.02 + 500, `trésorerie restaurée (${ss?.money} / ${statsSaved.money})`);
        check(ss && Math.abs(ss.date.totalMinutes - statsSaved.date.totalMinutes) < 60, `date restaurée (${ss?.date?.totalMinutes} / ${statsSaved.date.totalMinutes} min)`);
        await render(page, 1, 0.05);
        await shot(page, 'apres-chargement');
      }
    }
    R.notes.errorsGame = errors.slice(0, 20);
    check(errors.length === 0, `partie : aucune erreur de page (${errors.length})`, errors.slice(0, 5));
    await ctx.close();
    save();
  }

  /* ---------------- iPhone ---------------- */
  if (only === 'all' || only === 'iphone') {
    for (const [name, vp] of [['portrait', { width: 390, height: 844 }], ['paysage', { width: 844, height: 390 }]]) {
      const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
      const page = await ctx.newPage();
      const errors = collectErrors(page);
      await page.goto(`${base}/index.html?autostart&seed=42&norender`, { timeout: 300000, waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__aube?.ready && window.__aube.snapshotReceived && window.__aube.lastStats, null, { timeout: 300000, polling: 500 });
      await page.waitForTimeout(1500);
      const btns = await page.evaluate(() => [...document.querySelectorAll('button[data-speed]')].map((b) => { const r = b.getBoundingClientRect(); return { s: b.dataset.speed, t: b.textContent.trim(), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), vis: b.offsetParent !== null }; }));
      R.notes[`iphone-${name}`] = btns;
      const small = btns.filter((b) => b.vis && (b.w < 28 || b.h < 28));
      check(btns.filter((b) => b.vis).length === 6, `iPhone ${name} : 6 boutons de vitesse visibles`, btns.map((b) => `${b.t}:${b.w}x${b.h}@${b.x},${b.y}`));
      check(small.length === 0, `iPhone ${name} : boutons de vitesse ≥ 28 px`, small);
      const off = btns.filter((b) => b.vis && (b.x < 0 || b.x + b.w > vp.width || b.y < 0 || b.y + b.h > vp.height));
      check(off.length === 0, `iPhone ${name} : boutons de vitesse dans l'écran`, off);
      for (const s of ['16', '8', '0']) {
        await page.tap(`button[data-speed="${s}"]`);
        const got = await waitSpeed(page, Number(s));
        check(got === Number(s), `iPhone ${name} : toucher ×${s} -> vitesse ${got}`);
      }
      await render(page, 1, 0.05);
      await shot(page, `iphone-${name}`);
      const ov = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: innerWidth }));
      check(ov.sw <= ov.w, `iPhone ${name} : pas de défilement horizontal (${ov.sw}/${ov.w})`);
      check(errors.length === 0, `iPhone ${name} : aucune erreur de page (${errors.length})`, errors.slice(0, 5));
      await ctx.close();
      save();
    }
  }
} catch (e) {
  check(false, `exception : ${e.stack ?? e}`);
} finally {
  save();
  await browser.close();
  server.close();
}
console.log(failed ? `\nQA3 (${only}) : ÉCHEC` : `\nQA3 (${only}) : SUCCÈS`);
process.exit(failed ? 1 : 0);
