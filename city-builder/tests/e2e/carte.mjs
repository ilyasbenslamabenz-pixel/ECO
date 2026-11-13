/**
 * E2E carte (Chromium SwiftShader) : nouvelle partie v2, outils du tiroir Terrain utilisés à la souris
 * (Quai / remblai, Creuser, Défricher), rendu cohérent (murs de quai, eau, végétation), sauvegarde et rechargement,
 * écran Nouvelle partie (choix Rivières / Côte). Captures dans docs/captures-carte/apres-outils-*.png.
 *   node tests/e2e/carte.mjs
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { collectErrors, launch, root, serve } from './lib.mjs';

const outDir = join(root, 'docs', 'captures-carte');
mkdirSync(outDir, { recursive: true });
let failed = 0;
const check = (ok, msg, extra) => { console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${msg}${extra !== undefined ? ` ${JSON.stringify(extra)}` : ''}`); if (!ok) failed++; };

const { server, base } = await serve();
const browser = await launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = collectErrors(page);
  await page.goto(`${base}/index.html?autostart&norender&seed=7`);
  await page.waitForFunction(() => window.__aube?.ready === true && window.__aube.snapshotReceived, null, { timeout: 300000 });
  await page.evaluate(() => window.__aube.send('setSpeed', { speed: 0 }));
  const veg0 = await page.evaluate(() => window.__aube.renderStats().vegetation);

  // Côte : premier rayon depuis le centre qui touche la mer.
  const sea = await page.evaluate(() => {
    const a = window.__aube;
    let best = null;
    for (let k = 0; k < 32; k++) {
      const dx = Math.cos((k / 32) * Math.PI * 2), dz = Math.sin((k / 32) * Math.PI * 2);
      for (let d = 0; d < 1000; d += 4) {
        if (a.isWet(dx * d, dz * d)) {
          let open = true;
          for (let e = 8; e <= 60; e += 8) if (!a.isWet(dx * (d + e), dz * (d + e))) open = false;
          if (open && (!best || d < best.dist)) best = { dx, dz, dist: d };
          break;
        }
      }
    }
    return best;
  });
  check(!!sea, 'mer trouvée depuis le centre', sea);
  const cx = sea.dx * (sea.dist + 40), cz = sea.dz * (sea.dist + 40);
  const tx = -sea.dz, tz = sea.dx;
  const A = { x: cx - tx * 60, z: cz - tz * 60 }, B = { x: cx + tx * 60, z: cz + tz * 60 };

  // Tiroir Terrain -> Quai / remblai, puis deux clics au sol.
  await page.evaluate(([x, z]) => { window.__aube.lookAt(x, z, 420, 1.1, 0); window.__aube.renderNow(1); }, [cx - sea.dx * 30, cz - sea.dz * 30]);
  await page.click('#toolbar button[data-cat="terrain"]');
  await page.click('#drawer-body button[data-terrain="quay"]');
  // Survol : traité par la boucle d'image (une image forcée en ?norender).
  const hoverWorld = async (p) => {
    const s = await page.evaluate(([x, z]) => window.__aube.worldToScreen(x, z), [p.x, p.z]);
    await page.mouse.move(s.x, s.y);
    await page.evaluate(() => window.__aube.renderNow(1));
  };
  const clickWorld = async (p) => {
    const s = await page.evaluate(([x, z]) => window.__aube.worldToScreen(x, z), [p.x, p.z]);
    await page.mouse.move(s.x, s.y);
    await page.waitForTimeout(150);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(150);
  };
  const money0 = await page.evaluate(() => window.__aube.lastStats.money);
  await clickWorld(A);
  await hoverWorld(B);
  await page.waitForFunction(() => { const p = window.__aube.toolPreview(); return p.kind === 'terrain' && p.validity !== 'pending' && p.start; }, null, { timeout: 30000 });
  const prev = await page.evaluate(() => window.__aube.toolPreview());
  check(prev.validity === 'ok' && prev.cost > 0, 'aperçu du quai validé par la simulation (coût affiché)', prev);
  const tag = await page.evaluate(() => document.querySelector('#cursor-tag, .cursor-tag')?.textContent ?? '');
  check(/CHF/.test(tag), 'étiquette du curseur avec le coût', tag);
  await page.evaluate(() => window.__aube.renderNow(1));
  await page.screenshot({ path: join(outDir, 'apres-outils-quai-apercu.png') });
  await clickWorld(B);
  await page.waitForFunction(() => window.__aube.quays().length > 0, null, { timeout: 30000 }).catch(() => undefined);
  const quays = await page.evaluate(() => window.__aube.quays());
  check(quays.length >= 8, 'mur de quai reçu et affiché par le rendu', quays.length / 8);
  await page.waitForFunction((m) => window.__aube.lastStats.money < m, money0, { timeout: 30000 }).catch(() => undefined);
  const money1 = await page.evaluate(() => window.__aube.lastStats.money);
  check(money1 < money0, 'coût débité', { avant: money0, apres: money1 });
  const dryBehind = await page.evaluate(([x, z]) => !window.__aube.isWet(x, z), [sea.dx * (sea.dist + 20), sea.dz * (sea.dist + 20)]);
  const wetFront = await page.evaluate(([x, z]) => window.__aube.isWet(x, z), [sea.dx * (sea.dist + 60), sea.dz * (sea.dist + 60)]);
  check(dryBehind && wetFront, 'rendu : remblai sec derrière la ligne, eau devant', { dryBehind, wetFront });
  await page.evaluate(([x, z]) => { window.__aube.lookAt(x, z, 260, 0.75, 0.9); window.__aube.renderNow(3, 0.5); }, [cx, cz]);
  await page.screenshot({ path: join(outDir, 'apres-outils-quai.png') });

  // Creuser : canal dans la plaine centrale.
  await page.keyboard.press('Escape');
  await page.click('#toolbar button[data-cat="terrain"]');
  await page.click('#drawer-body button[data-terrain="dig"]');
  await page.evaluate(() => { window.__aube.lookAt(0, 60, 520, 1.1, 0); window.__aube.renderNow(1); });
  await clickWorld({ x: -150, z: 60 });
  await hoverWorld({ x: 150, z: 60 });
  await page.waitForFunction(() => { const p = window.__aube.toolPreview(); return p.kind === 'terrain' && p.validity !== 'pending' && p.start; }, null, { timeout: 30000 });
  const digPrev = await page.evaluate(() => window.__aube.toolPreview());
  check(digPrev.validity === 'ok', 'aperçu du canal validé', digPrev);
  await clickWorld({ x: 150, z: 60 });
  await page.waitForFunction(() => window.__aube.isWet(0, 60), null, { timeout: 30000 }).catch(() => undefined);
  check(await page.evaluate(() => window.__aube.isWet(0, 60)), 'canal en eau dans le rendu');
  await page.evaluate(() => { window.__aube.lookAt(0, 60, 300, 0.8, 0.5); window.__aube.renderNow(3, 0.5); });
  await page.screenshot({ path: join(outDir, 'apres-outils-canal.png') });

  // Défricher : zone la plus boisée visible, clic au pinceau.
  await page.keyboard.press('Escape');
  await page.click('#toolbar button[data-cat="terrain"]');
  await page.click('#drawer-body button[data-terrain="clear"]');
  const target = await page.evaluate(() => window.__aube.forestSpot?.() ?? null);
  const vegBefore = await page.evaluate(() => window.__aube.renderStats().vegetation);
  if (target) {
    await page.evaluate(([x, z]) => { window.__aube.lookAt(x, z, 320, 1.0, 0); window.__aube.renderNow(1); }, [target.x, target.z]);
    await page.evaluate(([x, z]) => { window.__aube.renderNow(1); return [x, z]; }, [target.x, target.z]);
    await hoverWorld(target);
    await page.waitForFunction(() => { const p = window.__aube.toolPreview(); return p.kind === 'terrain' && p.validity !== 'pending'; }, null, { timeout: 30000 });
    await page.evaluate(() => window.__aube.renderNow(1));
    await page.screenshot({ path: join(outDir, 'apres-outils-defricher-avant.png') });
    await clickWorld(target);
    await page.waitForFunction((n) => window.__aube.renderStats().vegetation < n, vegBefore, { timeout: 30000 }).catch(() => undefined);
    const vegAfter = await page.evaluate(() => window.__aube.renderStats().vegetation);
    check(vegAfter < vegBefore, 'Défricher retire des arbres du rendu', { avant: vegBefore, apres: vegAfter });
    await page.mouse.move(5, 400);
    await page.evaluate(() => window.__aube.renderNow(3, 0.5));
    await page.screenshot({ path: join(outDir, 'apres-outils-defricher.png') });
  } else check(false, 'zone boisée trouvée');
  check(veg0 > 0, 'végétation semée', veg0);

  // Sauvegarde puis rechargement : murs et éditions conservés.
  await page.keyboard.press('Escape');
  const quaysBeforeSave = await page.evaluate(() => window.__aube.quays());
  await page.evaluate(() => window.__aube.saveSlot('carte-e2e'));
  await page.evaluate(() => window.__aube.loadSlot('carte-e2e'));
  await page.waitForFunction(() => window.__aube.isWet(0, 60), null, { timeout: 60000 }).catch(() => undefined);
  const quays2 = await page.evaluate(() => window.__aube.quays());
  check(JSON.stringify(quays2) === JSON.stringify(quaysBeforeSave) && quays2.length > quays.length, 'après rechargement : murs du quai et du canal identiques', quays2.length / 8);
  check(await page.evaluate(() => window.__aube.isWet(0, 60)), 'après rechargement : canal toujours en eau');
  check(errors.length === 0, 'aucune erreur de page', errors.slice(0, 5));
  await page.close();

  // Écran Nouvelle partie : choix Rivières / Côte.
  const p2 = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const err2 = collectErrors(p2);
  await p2.goto(`${base}/index.html?norender`);
  await p2.waitForFunction(() => window.__aube?.ready === true, null, { timeout: 300000 });
  await p2.click('#btn-new');
  const opts = await p2.evaluate(() => ({ rivers: [...document.querySelectorAll('#new-rivers option')].map((o) => o.value), coast: [...document.querySelectorAll('#new-coast option')].map((o) => o.value), def: document.querySelector('#new-rivers').value }));
  check(opts.rivers.join() === 'aucune,une,plusieurs' && opts.coast.join() === 'mer,aucune' && opts.def === 'une', 'choix Rivières (défaut : une) et Côte', opts);
  await p2.selectOption('#new-rivers', 'aucune');
  await p2.selectOption('#new-coast', 'aucune');
  await p2.fill('#new-seed', '7');
  await p2.click('#form-new button[type="submit"]');
  await p2.waitForFunction(() => window.__aube.snapshotReceived, null, { timeout: 300000 });
  const wetAny = await p2.evaluate(() => { let n = 0; for (let x = -1000; x <= 1000; x += 16) for (let z = -1000; z <= 1000; z += 16) if (window.__aube.isWet(x, z)) n++; return n; });
  check(wetAny < 40, 'partie « sans rivière, sans mer » : pas d\'eau', wetAny);
  await p2.evaluate(() => { window.__aube.lookAt(0, 0, 2600, 1.15, -0.6); window.__aube.renderNow(3, 0.5); });
  await p2.screenshot({ path: join(outDir, 'apres-sans-riviere-sans-mer.png') });
  check(err2.length === 0, 'aucune erreur de page (nouvelle partie)', err2.slice(0, 5));
  await p2.close();
} finally {
  await browser.close();
  server.close();
}
console.log(failed ? `\nCARTE : ${failed} ÉCHEC(S)` : '\nCARTE : SUCCÈS');
process.exit(failed ? 1 : 0);
