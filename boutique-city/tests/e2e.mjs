/**
 * Parcours navigateur de Boutique City (Playwright, Chromium préinstallé) : menu, nouvelle entreprise, location d'un
 * local par l'interface, aménagement à la souris dans l'éditeur, embauche, commandes, jours simulés, captures.
 * Usage : npm run build && node tests/e2e.mjs [dossier des captures]
 */
import { createServer } from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';

const out = process.argv[2] ?? 'tests/out';
mkdirSync(out, { recursive: true });
const dist = join(process.cwd(), 'dist');
const types = { '.html': 'text/html', '.js': 'text/javascript' };
const server = createServer((req, res) => {
  const p = join(dist, decodeURIComponent(new URL(req.url, 'http://x').pathname === '/' ? '/index.html' : new URL(req.url, 'http://x').pathname));
  try { res.writeHead(200, { 'content-type': types[extname(p)] ?? 'application/octet-stream' }); res.end(readFileSync(p)); } catch { res.writeHead(404); res.end(); }
}).listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
let fails = 0;
const check = (ok, label, extra = '') => { console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${label}${extra ? ` ${extra}` : ''}`); if (!ok) fails++; };

const browser = await chromium.launch();
try {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${base}/index.html?seed=7&nouveau`);
  await page.waitForSelector('.menu-card');
  await page.screenshot({ path: join(out, '1-menu.png') });
  await page.fill('.menu-card input', 'Atlas Commerce');
  await page.click('.menu-card button.primary');
  await page.waitForFunction(() => window.__bc?.ready);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(out, '2-quartier.png') });
  check(await page.evaluate(() => window.__bc.game.companyName === 'Atlas Commerce'), 'nouvelle entreprise créée');

  // Meilleur local libre : sélection (comme un clic), location par le panneau.
  const pid = await page.evaluate(() => { const g = window.__bc.game; return g.district.premises.filter((p) => g.isFree(p)).sort((a, b) => b.footfall - a.footfall)[0].id; });
  await page.evaluate((id) => window.__bc.select(id), pid);
  await page.waitForSelector('#panel:not(.hidden)');
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(out, '3-local-libre.png') });
  await page.selectOption('#panel select', 'epicerie');
  await page.fill('#panel input[type=text]', 'Épicerie Atlas');
  await page.click('#panel button.primary.wide');
  await page.waitForTimeout(300);
  const shopId = await page.evaluate(() => window.__bc.game.shops[0]?.id ?? null);
  check(shopId !== null, 'local loué par le panneau');

  // Éditeur : poser une caisse, des rayons et des frigos à la souris.
  await page.click('#panel button:has-text("Aménager le local")');
  await page.waitForSelector('#editor:not(.hidden) canvas');
  const place = async (def, cx, cz) => {
    // Recliquer le meuble déjà choisi le désélectionne : seulement s'il n'est pas actif.
    if (!(await page.locator(`#editor .ed-item.on[data-def="${def}"]`).count())) await page.click(`#editor .ed-item[data-def="${def}"]`);
    const box = await page.locator('#editor canvas').boundingBox();
    const cell = await page.evaluate(() => { const c = document.querySelector('#editor canvas'); return c.getBoundingClientRect().width / (c.width / (c.width / window.__bc.game.premise(window.__bc.game.shops[0].premiseId).gridW)); });
    await page.mouse.click(box.x + (cx + 0.5) * cell, box.y + (cz + 0.5) * cell);
    await page.waitForTimeout(120);
  };
  const grid = await page.evaluate(() => { const g = window.__bc.game; const p = g.premise(g.shops[0].premiseId); return [p.gridW, p.gridD]; });
  await place('caisse', 1, 0);
  await place('rayon', 5, 0);
  await place('rayon', 1, 2);
  await place('rayon', 5, 2);
  await place('frigo', 1, 4);
  await place('frigo', Math.min(grid[0] - 2, 6), 4);
  await place('plante', grid[0] - 1, grid[1] - 1);
  await page.screenshot({ path: join(out, '4-amenagement.png') });
  const st = await page.evaluate(() => { const g = window.__bc.game; const s = g.shops[0]; return { items: s.items.length, ...g.stats(s) }; });
  check(st.items >= 7 && st.registers === 1 && st.capacity.rayon > 0 && st.capacity.frigo > 0, 'meubles posés à la souris', JSON.stringify({ items: st.items, caisses: st.registers, cap: st.capacity, bloqués: st.blocked.length }));
  await page.click('#editor button:has-text("Terminer")');

  // Embauche et stock par le panneau.
  await page.click('#panel .tabs button:has-text("Employés")');
  await page.click('#panel button:has-text("Embaucher")');
  check(await page.evaluate(() => window.__bc.game.employees.length === 1), 'employé embauché');
  await page.click('#panel .tabs button:has-text("Stock")');
  for (let k = 0; k < 6; k++) { const b = page.locator('#panel table.stock button:not([disabled])').first(); if (await b.count()) await b.click(); await page.waitForTimeout(80); }
  for (const cb of await page.locator('#panel table.stock input[type=checkbox]').all()) await cb.check();
  await page.screenshot({ path: join(out, '5-stock.png') });
  check(await page.evaluate(() => window.__bc.game.orders.length >= 5), 'commandes passées');

  // Trois jours simulés.
  await page.evaluate(() => window.__bc.advance(3 * 1440));
  await page.waitForTimeout(600);
  await page.click('#panel .tabs button:has-text("Aperçu")');
  await page.evaluate((id) => window.__bc.select(id), pid);
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(out, '6-apres-3-jours.png') });
  const res = await page.evaluate(() => { const s = window.__bc.game.shops[0]; return { clients: s.history.reduce((a, d) => a + d.customers, 0), ventes: Math.round(s.history.reduce((a, d) => a + d.revenue, 0)), cash: Math.round(window.__bc.game.cash) }; });
  check(res.clients > 100 && res.ventes > 500, 'des clients achètent', JSON.stringify(res));
  await page.click('#panel .tabs button:has-text("Résultats")');
  await page.screenshot({ path: join(out, '7-resultats.png') });
  await page.click('#hud button:has-text("Finances")');
  await page.screenshot({ path: join(out, '8-finances.png') });

  // Confirmation dans la page (pas de confirm() du navigateur) : résiliation annulée.
  await page.evaluate((id) => window.__bc.select(id), pid);
  await page.waitForTimeout(300);
  await page.click('#panel button:has-text("Résilier le bail")');
  check(await page.locator('.confirm').isVisible(), 'confirmation affichée dans la page');
  await page.click('.confirm button:has-text("Annuler")');
  check(await page.evaluate(() => window.__bc.game.shops.length === 1), 'résiliation annulée');

  // Sauvegarde et reprise.
  await page.click('#hud button:has-text("Sauvegarder")');
  await page.goto(`${base}/index.html`);
  await page.waitForSelector('.menu-card button.primary');
  const label = await page.textContent('.menu-card button.primary');
  check(/Continuer : Atlas Commerce/.test(label ?? ''), 'reprise proposée', label);
  await page.click('.menu-card button.primary');
  await page.waitForFunction(() => window.__bc?.ready);
  check(await page.evaluate(() => window.__bc.game.shops.length === 1 && window.__bc.game.employees.length === 1), 'partie reprise');
  const fps = await page.evaluate(() => new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { if (++n >= 60) r(Math.round((n * 1000) / (performance.now() - t0))); else requestAnimationFrame(f); }; requestAnimationFrame(f); }));
  console.log('images/s (navigateur sans GPU) :', fps);
  check(errors.length === 0, 'aucune erreur de page', errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  server.close();
}
console.log(fails ? `ÉCHECS : ${fails}` : 'BOUTIQUE CITY : SUCCÈS');
process.exit(fails ? 1 : 0);
