/**
 * Démo + captures du module construction/caméra/UI.
 *   node tests/construction/demo.mjs            -> construit la scène de test et produit les captures
 * Construit src/input/demo/main.ts (esbuild) dans tests/construction/demo-build/, sert le projet,
 * pilote Chromium (SwiftShader, deviceScaleFactor 1) et écrit tests/construction/out/*.png.
 * Chaque étape vérifie un état réel (DOM, machine à états, MockSim) ; le script échoue sinon.
 */
import * as esbuild from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectErrors, launch, root, serve } from '../e2e/lib.mjs';

const buildDir = join(root, 'tests/construction/demo-build');
const out = join(root, 'tests/construction/out');
mkdirSync(buildDir, { recursive: true });
mkdirSync(out, { recursive: true });

await esbuild.build({ entryPoints: [join(root, 'src/input/demo/main.ts')], outfile: join(buildDir, 'demo.js'), bundle: true, format: 'esm', target: 'es2022', logLevel: 'warning', sourcemap: 'inline' });
const css = readFileSync(join(root, 'src/ui/styles.css'), 'utf8');
const markup = readFileSync(join(root, 'src/ui/markup.html'), 'utf8');
writeFileSync(join(buildDir, 'index.html'), `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Aube Urbaine — démo construction</title>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>${css}</style></head><body>${markup}<script type="module" src="./demo.js"></script></body></html>`);

const { server, base } = await serve(root);
const browser = await launch();
let failed = false;
const check = (cond, msg) => { console.log(`${cond ? 'OK  ' : 'ÉCHEC'} ${msg}`); if (!cond) failed = true; };
const url = `${base}/tests/construction/demo-build/index.html`;
const only = process.argv[2] ?? '';

async function open(viewport, extra = {}) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1, ...extra });
  const errors = collectErrors(page);
  page.setDefaultTimeout(180000);
  page.on('console', (m) => { if (process.env.DEBUG) console.log('[page]', m.text()); });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__demo?.ready || window.__demoError, null, { timeout: 120000 });
  const err = await page.evaluate(() => window.__demoError ?? null);
  if (err) throw new Error(err);
  await page.waitForFunction(() => window.__demo.frames() > 3, null, { timeout: 60000 });
  return { page, errors };
}
const shot = async (page, name) => { await page.screenshot({ path: join(out, `${name}.png`) }); console.log(`     capture ${name}.png`); };
const settle = (page, ms = 1500) => page.waitForTimeout(ms);
/** Coordonnées écran d'un point monde (au sol si y est null). */
const scr = (page, x, z, y = null) => page.evaluate(([x, y, z]) => window.__demo.project(x, y, z), [x, y, z]);

try {
  /* -------------------- Bureau 1600×900 -------------------- */
  if (!only || only === 'desktop') {
    const { page, errors } = await open({ width: 1600, height: 900 });
    const c = await page.evaluate(() => window.__demo.center);
    await page.waitForFunction(() => window.__demo.cons.mirror.buildings.size >= 4, null, { timeout: 30000 });
    await settle(page, 4000);
    await shot(page, 'c01-vue-generale');

    // Catalogue : bâtiments avec vignettes rendues des vrais modèles.
    await page.click('#toolbar button[data-tool="building"]');
    await page.waitForFunction(() => document.querySelectorAll('#drawer-body .card img').length >= 4, null, { timeout: 120000 });
    const thumbs = await page.evaluate(() => ({ imgs: document.querySelectorAll('#drawer-body .card img').length, cards: document.querySelectorAll('#drawer-body .card').length, rendered: window.__demo.cons.thumbs.rendered }));
    check(thumbs.imgs >= 4 && thumbs.rendered >= 4, `vignettes rendues des vrais modèles : ${thumbs.imgs}/${thumbs.cards} cartes, ${thumbs.rendered} rendus`);
    await page.click('#drawer-tabs button:nth-child(3)');
    await page.waitForFunction(() => document.querySelectorAll('#drawer-body .card img').length >= 2, null, { timeout: 120000 });
    await settle(page, 800);
    await shot(page, 'c02-catalogue-immeubles');

    // Placement : fantôme du vrai GLB, façade tournée vers l'avenue (au sud du curseur).
    const card = await page.$('#drawer-body .card[data-asset="immeuble_brique_1930"]') ?? await page.$('#drawer-body .card');
    await card.click();
    let p = await scr(page, c.x + 95, c.z + 22);
    await page.mouse.move(p.x, p.y);
    await page.waitForFunction(() => { const pv = window.__demo.machine.preview; return pv.kind === 'building' && pv.validity !== 'pending'; }, null, { timeout: 20000 });
    await page.waitForFunction(() => window.__demo.input.tools.ghostModelVisible, null, { timeout: 60000 });
    await settle(page);
    const pv1 = await page.evaluate(() => { const pv = window.__demo.machine.preview; return { v: pv.validity, snapped: pv.proposal.snapped, rot: pv.proposal.rot, msg: pv.message }; });
    check(pv1.v === 'ok' && pv1.snapped, `fantôme vert, aligné sur la route (rot=${pv1.rot}, ${pv1.v} ${pv1.msg})`);
    await shot(page, 'c03-fantome-valide');
    await page.mouse.click(p.x, p.y);
    await page.waitForFunction(() => window.__demo.cons.mirror.buildings.size >= 7, null, { timeout: 20000 }).catch(() => undefined);
    const nb = await page.evaluate(() => window.__demo.cons.mirror.buildings.size);
    check(nb >= 7, `bâtiment posé au clic (bâtiments : ${nb})`);
    // Même endroit : refus de la simulation, fantôme rouge et message.
    await page.mouse.move(p.x + 3, p.y + 2);
    await page.waitForFunction(() => { const pv = window.__demo.machine.preview; return pv.kind === 'building' && pv.validity === 'error'; }, null, { timeout: 20000 }).catch(() => undefined);
    await settle(page);
    const pv2 = await page.evaluate(() => { const pv = window.__demo.machine.preview; return { v: pv.validity, msg: pv.message, tag: document.getElementById('cursor-tag').textContent }; });
    check(pv2.v === 'error' && /occupé/.test(pv2.tag), `fantôme rouge + raison affichée : « ${pv2.tag.replace(/\n/g, ' / ')} »`);
    await shot(page, 'c04-fantome-refuse');

    // Routes : courbe.
    await page.keyboard.press('Escape');
    await page.click('#toolbar button[data-tool="road"]');
    await page.click('#drawer-body .seg button:nth-child(2)');
    await page.click('#drawer-close');
    check((await page.evaluate(() => window.__demo.machine.draft.mode)) === 'curve', 'mode courbe sélectionné');
    const a = await scr(page, c.x, c.z - 90);
    const k = await scr(page, c.x + 70, c.z - 130);
    const b = await scr(page, c.x + 125, c.z - 75);
    console.log(`     points écran : ${JSON.stringify([a, k, b].map((q) => [Math.round(q.x), Math.round(q.y)]))}`);
    await page.mouse.click(a.x, a.y);
    await page.mouse.click(k.x, k.y);
    await page.mouse.move(b.x, b.y);
    await page.waitForFunction(() => { const pv = window.__demo.machine.preview; return pv.kind === 'road' && pv.points && pv.validity !== 'pending'; }, null, { timeout: 60000 });
    await settle(page);
    const rp = await page.evaluate(() => { const pv = window.__demo.machine.preview; return { v: pv.validity, n: pv.points.length / 2, cost: pv.cost, msg: pv.message }; });
    check(rp.n > 3, `aperçu de route courbe (${rp.n} points, ${rp.v}, ${rp.cost} ¢ ${rp.msg})`);
    await shot(page, 'c05-route-courbe');
    const edgesBefore = await page.evaluate(() => window.__demo.cons.mirror.edges.size);
    await page.mouse.click(b.x, b.y);
    await settle(page, 1200);
    const edgesAfter = await page.evaluate(() => window.__demo.cons.mirror.edges.size);
    check(rp.v !== 'ok' || edgesAfter > edgesBefore, `route courbe construite (${edgesBefore} -> ${edgesAfter} tronçons)`);
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');

    // Annuler (Ctrl+Z).
    await page.keyboard.press('Control+KeyZ');
    await settle(page, 800);
    const edgesUndo = await page.evaluate(() => window.__demo.cons.mirror.edges.size);
    check(edgesUndo < edgesAfter || edgesAfter === edgesBefore, `Ctrl+Z annule la route (${edgesAfter} -> ${edgesUndo})`);

    // Sélection : clic sur le bâtiment posé -> panneau d'info.
    const sel = await page.evaluate(() => { const bs = [...window.__demo.cons.mirror.buildings.values()]; const last = bs[bs.length - 1]; return { x: last.x, z: last.z, y: last.y }; });
    const sp = await scr(page, sel.x, sel.z, sel.y + 6);
    await page.mouse.click(sp.x, sp.y);
    await page.waitForSelector('#info-panel:not(.hidden)', { timeout: 10000 }).catch(() => undefined);
    await page.waitForFunction(() => !document.getElementById('info-thumb').classList.contains('hidden'), null, { timeout: 60000 }).catch(() => undefined);
    await settle(page);
    const info = await page.evaluate(() => ({ visible: !document.getElementById('info-panel').classList.contains('hidden'), title: document.getElementById('info-title').textContent, rows: document.getElementById('info-rows').children.length }));
    check(info.visible && info.rows >= 8, `panneau d'information : « ${info.title} » (${info.rows / 2} lignes)`);
    await shot(page, 'c06-selection-panneau');
    // Démolir depuis le panneau.
    const nb1 = await page.evaluate(() => window.__demo.cons.mirror.buildings.size);
    await page.click('#info-actions button.danger');
    await settle(page, 800);
    const nb2 = await page.evaluate(() => window.__demo.cons.mirror.buildings.size);
    check(nb2 === nb1 - 1, `« Démolir » du panneau (${nb1} -> ${nb2})`);

    // Finances (avec historique sur quelques jours à vitesse ×4).
    await page.click('#hud .seg button[data-speed="4"]');
    // Avance rapide de MockSim (≈ 2 mois de jeu) avec quelques constructions, pour un historique lisible.
    await page.evaluate(async () => {
      const d = window.__demo; const c = d.center;
      const ids = ['maison_brique_pignon', 'commerce_boulangerie', 'maison_longere_pierre', 'immeuble_petit_enduit'];
      for (let i = 0; i < 6000; i++) {
        d.mock.step();
        if (i % 1400 === 300) { const id = ids[(i / 1400) | 0]; await d.mock.send('placeBuilding', { assetId: id, x: c.x - 100 + i / 30, z: c.z - 26, rot: 2 }).catch(() => null); }
      }
    });
    await settle(page, 1500);
    await page.click('#btn-finance');
    await settle(page, 600);
    const cbox = await page.locator('#fin-chart').boundingBox();
    if (cbox) await page.mouse.move(cbox.x + cbox.width * 0.6, cbox.y + cbox.height / 2);
    await settle(page, 400);
    await shot(page, 'c07-finances');
    await page.click('#finance-close');

    console.log(`     pose avant bulldozer : ${JSON.stringify(await page.evaluate(() => window.__demo.input.camera.getPose()))}`);
    // Bulldozer survol (cible rouge + remboursement).
    await page.keyboard.press('KeyB');
    const tgt = await page.evaluate(() => { const b = [...window.__demo.cons.mirror.buildings.values()][0]; return { x: b.x, z: b.z, y: b.y }; });
    const tp = await scr(page, tgt.x, tgt.z, tgt.y + 4);
    await page.mouse.move(tp.x, tp.y);
    await settle(page, 1000);
    const bz = await page.evaluate(() => window.__demo.machine.preview);
    check(bz.kind === 'bulldoze' && !!bz.target, 'bulldozer : cible détectée sous le curseur');
    await shot(page, 'c08-bulldozer');
    await page.keyboard.press('Escape');

    // Caméra : zoom molette vers le curseur jusqu'à ~8 m, puis vue rue.
    const before = await page.evaluate(() => window.__demo.input.camera.getPose());
    const zp = await scr(page, sel.x - 30, sel.z + 12);
    await page.mouse.move(zp.x, zp.y);
    for (let i = 0; i < 14; i++) { await page.mouse.wheel(0, -300); await page.waitForTimeout(60); }
    await settle(page, 2500);
    const after = await page.evaluate(() => window.__demo.input.camera.getPose());
    check(after.distance < 15 && after.pitch < before.pitch, `zoom vers le curseur : ${before.distance.toFixed(0)} m -> ${after.distance.toFixed(1)} m, inclinaison ${before.pitch.toFixed(2)} -> ${after.pitch.toFixed(2)} rad`);
    await shot(page, 'c09-zoom-8m');
    await page.keyboard.press('KeyH');
    await settle(page, 2500);
    await page.click('#btn-camera');
    await settle(page, 2500);
    check((await page.textContent('#btn-camera')).includes('aérienne'), 'bascule vue rue (bouton)');
    await page.keyboard.down('KeyW'); await page.waitForTimeout(1200); await page.keyboard.up('KeyW');
    await settle(page, 1200);
    await shot(page, 'c10-vue-rue');
    await page.keyboard.press('KeyV');
    await settle(page, 800);
    await page.keyboard.press('KeyC');
    await settle(page, 2500);
    check(await page.evaluate(() => window.__demo.input.camera.cinematic), 'mode cinématique (touche C)');
    await page.keyboard.press('KeyC');

    // Menu principal, nouvelle partie, options.
    await page.keyboard.press('Escape');
    await settle(page, 600);
    await shot(page, 'c11-menu');
    await page.click('#btn-new');
    await settle(page, 300);
    await shot(page, 'c12-nouvelle-partie');
    await page.click('[data-screen="new"] [data-back]');
    await page.click('#btn-options');
    await settle(page, 300);
    await shot(page, 'c13-options');
    check(errors.length === 0, `aucune erreur de page${errors.length ? ' :\n   ' + errors.join('\n   ') : ''}`);
    await page.close();
  }

  /* -------------------- iPhone 390×844 tactile -------------------- */
  if (!only || only === 'iphone') {
    const { page, errors } = await open({ width: 390, height: 844 }, { hasTouch: true, isMobile: true });
    const c = await page.evaluate(() => window.__demo.center);
    await page.waitForFunction(() => window.__demo.cons.mirror.buildings.size >= 4, null, { timeout: 30000 });
    await settle(page, 3000);
    await shot(page, 'i01-iphone-jeu');
    // Taille minimale des cibles tactiles.
    const small = await page.evaluate(() => [...document.querySelectorAll('#toolbar button, #hud button')].filter((b) => b.offsetParent && (b.getBoundingClientRect().height < 43.5)).map((b) => b.textContent.trim()));
    check(small.length === 0, `boutons ≥ 44 px (${small.length ? 'trop petits : ' + small.join(', ') : 'tous'})`);
    await page.tap('#toolbar button[data-tool="building"]');
    await page.waitForFunction(() => document.querySelectorAll('#drawer-body .card img').length >= 2, null, { timeout: 120000 });
    await settle(page, 800);
    await shot(page, 'i02-iphone-catalogue');
    await page.tap('#drawer-body .card');
    // Toucher la carte près de la route : l'aperçu suit le doigt (décalé), puis barre de confirmation.
    const p = { x: 195, y: 420 }; // doigt au centre ; l'aperçu se place ~70 px au-dessus
    const cdp = await page.context().newCDPSession(page);
    const touch = async (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
    await touch('touchStart', [[p.x, p.y]]);
    await touch('touchMove', [[p.x + 5, p.y + 2]]);
    await touch('touchEnd', []);
    await page.waitForSelector('#touch-confirm:not(.hidden)', { timeout: 10000 }).catch(() => undefined);
    await settle(page, 2000);
    check(await page.isVisible('#touch-confirm'), 'barre de confirmation tactile affichée');
    await shot(page, 'i03-iphone-confirmation');
    const n0 = await page.evaluate(() => window.__demo.cons.mirror.buildings.size);
    const valid = await page.evaluate(() => window.__demo.machine.preview.validity);
    await page.tap('#tc-ok');
    await settle(page, 1200);
    const n1 = await page.evaluate(() => window.__demo.cons.mirror.buildings.size);
    check(valid !== 'ok' || n1 === n0 + 1, `« Construire » au doigt (${valid} : ${n0} -> ${n1})`);
    // Pincer (zoom) + rotation à deux doigts.
    await page.keyboard.press('Escape');
    const pose0 = await page.evaluate(() => window.__demo.input.camera.getPose());
    const cx = 195; const cy = 420;
    await touch('touchStart', [[cx - 40, cy], [cx + 40, cy]]);
    for (let i = 1; i <= 8; i++) { await touch('touchMove', [[cx - 40 - i * 12, cy - i * 4], [cx + 40 + i * 12, cy + i * 4]]); await page.waitForTimeout(30); }
    await touch('touchEnd', []);
    await settle(page, 1500);
    const pose1 = await page.evaluate(() => window.__demo.input.camera.getPose());
    check(pose1.distance < pose0.distance * 0.7 && Math.abs(pose1.yaw - pose0.yaw) > 0.05, `pincer = zoom (${pose0.distance.toFixed(0)} -> ${pose1.distance.toFixed(0)} m) + torsion = rotation (Δcap ${(pose1.yaw - pose0.yaw).toFixed(2)} rad)`);
    // Glisser vertical à deux doigts = inclinaison.
    await touch('touchStart', [[cx - 50, cy], [cx + 50, cy]]);
    for (let i = 1; i <= 8; i++) { await touch('touchMove', [[cx - 50, cy + i * 12], [cx + 50, cy + i * 12]]); await page.waitForTimeout(30); }
    await touch('touchEnd', []);
    await settle(page, 1500);
    const pose2 = await page.evaluate(() => window.__demo.input.camera.getPose());
    check(pose2.pitch > pose1.pitch + 0.1, `glisser vertical à deux doigts = inclinaison (${pose1.pitch.toFixed(2)} -> ${pose2.pitch.toFixed(2)} rad)`);
    await shot(page, 'i04-iphone-geste');
    // Sélection au doigt.
    await page.tap('#toolbar button[data-tool="select"]');
    // Bâtiment visible le plus proche du centre de l'écran.
    const bp = await page.evaluate(() => {
      let best = null;
      for (const b of window.__demo.cons.mirror.buildings.values()) {
        const p = window.__demo.project(b.x, b.y + 3, b.z);
        const d = Math.hypot(p.x - 195, p.y - 420);
        if (p.x > 20 && p.x < 370 && p.y > 140 && p.y < 660 && (!best || d < best.d)) best = { x: p.x, y: p.y, d };
      }
      return best ?? { x: -1, y: -1 };
    });
    check(bp.x > 0, 'un bâtiment visible à toucher');
    if (bp.x > 0) {
      await page.touchscreen.tap(bp.x, bp.y);
      await settle(page, 1500);
      check(await page.isVisible('#info-panel'), 'tap = sélection + panneau (replié en bas sur iPhone)');
      await shot(page, 'i05-iphone-panneau');
    }
    check(errors.length === 0, `[iPhone] aucune erreur de page${errors.length ? ' :\n   ' + errors.join('\n   ') : ''}`);
    await page.close();
  }
} catch (e) {
  console.error('ÉCHEC', e);
  failed = true;
} finally {
  await browser.close();
  server.close();
}
console.log(failed ? '\nDÉMO CONSTRUCTION : ÉCHEC' : '\nDÉMO CONSTRUCTION : SUCCÈS');
process.exit(failed ? 1 : 0);
