/**
 * Boucle commerce sur 3 jours de jeu, par l'interface : louer → meubler (magasin de meubles, aménagement 3D à la
 * souris) → acheter du stock (grossiste, livraisons) → embaucher → ouvrir → ventes → récapitulatif de fin de journée
 * (×3, captures) → sauvegarde → rechargement de la page → reprise identique.
 * Usage : npm run build && node tests/e2e-boucle.mjs [dossier des captures]
 */
import { createServer } from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';

const out = process.argv[2] ?? 'tests/out-boucle';
mkdirSync(out, { recursive: true });
const dist = join(process.cwd(), 'dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary' };
const server = createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let body;
  try { body = readFileSync(join(dist, u === '/' ? 'index.html' : u)); } catch { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[extname(u)] ?? 'text/html' }); res.end(body);
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
  const ev = (f, a) => page.evaluate(f, a);
  const shot = (n) => page.screenshot({ path: join(out, `${n}.png`) });
  const service = (kind) => ev((k) => window.__bc.game.district.buildings.find((b) => b.service === k).id, kind);
  /** Clic réel au centre de l'élément (comme un joueur). */
  /** Clic réel (souris) au centre de l'élément, relu dans la page à chaque essai (le panneau peut être redessiné). */
  const tap = async (loc) => {
    const l = typeof loc === 'string' ? page.locator(loc).first() : loc.first();
    // Résolution et mesure en une seule étape dans la page : le panneau peut être redessiné entre deux allers-retours
    // (rendu logiciel ≈ 1 image/s) ; le bouton redessiné reste au même endroit, le clic souris tombe donc dessus.
    for (let k = 0; k < 40; k++) {
      const b = await l.evaluate((e) => { const r = e.getBoundingClientRect(); return r.width ? { x: r.x, y: r.y, width: r.width, height: r.height } : null; }, null, { timeout: 1500 }).catch(() => null);
      if (b) { await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await page.waitForTimeout(150); return; }
      await page.waitForTimeout(200);
    }
    await shot('echec-tap').catch(() => {}); console.log('PANEL', (await page.locator('#panel').innerText().catch(() => '')).slice(0, 4000));
    throw new Error(`élément introuvable : ${typeof loc === 'string' ? loc : 'localisateur'}`);
  };
  const goIn = async (id) => { await ev((b) => window.__bc.toDoor(b), id); await page.waitForTimeout(250); await page.keyboard.press('e'); await page.waitForTimeout(400); };

  await page.goto(`${base}/index.html?seed=21&nouveau`);
  await page.waitForSelector('.menu-card', { timeout: 120000 });
  check(await ev(() => window.__bc.assets?.loaded >= 50 && window.__bc.assets.failed.length === 0), 'tous les modèles 3D sont chargés', JSON.stringify(await ev(() => window.__bc.assets)));
  await page.fill('.menu-card input', 'Boucle SA');
  await tap('.menu-card button.primary');
  await page.waitForFunction(() => window.__bc?.ready);
  await ev(() => window.__bc.exitInterior());

  // 1. Louer.
  const free = await ev(() => { const g = window.__bc.game; return g.district.premises.filter((p) => g.isFree(p)).sort((a, b) => b.footfall - a.footfall)[0].buildingId; });
  await goIn(free);
  await page.waitForSelector('#panel select');
  await ev(() => { const s = [...document.querySelectorAll('#panel select')].find((e) => e.isConnected && [...e.options].some((o) => o.value === 'cafe')); s.value = 'cafe'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(300);
  await tap('#panel button:has-text("Signer le bail")');
  await page.waitForTimeout(500);
  check(await ev(() => window.__bc.state().inside?.kind === 'shop'), '1. local loué (café)');

  // 2. Meubler.
  await goIn(await service('meubles'));
  const buy = async (name) => { console.log('achat', name); const row = page.locator('#panel tr', { has: page.locator(`b:text-is("${name}")`) }); await tap(row.locator('button')); await page.waitForTimeout(150); };
  for (const n of ['Caisse', 'Machine à café', 'Comptoir', 'Vitrine à pâtisseries', 'Vitrine réfrigérée', 'Table et 4 chaises', 'Table et 4 chaises', 'Plante', 'Lampadaire design']) await buy(n);
  await page.keyboard.press('Escape');
  await goIn(await ev(() => window.__bc.game.premise(window.__bc.game.shops[0].premiseId).buildingId));
  await page.keyboard.press('b');
  await page.waitForTimeout(400);
  const W = await ev(() => window.__bc.game.premise(window.__bc.game.shops[0].premiseId).gridW);
  const D = await ev(() => window.__bc.game.premise(window.__bc.game.shops[0].premiseId).gridD);
  const NAMES = { caisse: 'Caisse', machine: 'Machine à café', comptoir: 'Comptoir', vitrine: 'Vitrine à pâtisseries', frigo: 'Vitrine réfrigérée', table: 'Table et 4 chaises', plante: 'Plante', lampe: 'Lampadaire design' };
  const placeAt = async (def, x, z, rot = 0) => {
    if (await ev(() => window.__bc.state().build.tool) !== def) await tap(`.buildbar .bb-pick:has-text("${NAMES[def]}")`);
    for (let k = 0; k < 4 && await ev(() => window.__bc.state().build.rot) !== rot; k++) await page.keyboard.press('r');
    const [sx, sy] = await ev(([a, b]) => window.__bc.cellScreen(a, b), [x, z]);
    await page.mouse.move(sx, sy); await page.waitForTimeout(120); await page.mouse.click(sx, sy); await page.waitForTimeout(220);
  };
  await placeAt('comptoir', 0, 0); await placeAt('machine', 2, 0); await placeAt('vitrine', 3, 0); await placeAt('frigo', 5, 0);
  await placeAt('caisse', 2, 2);
  await placeAt('table', W - 3, 3); await placeAt('table', W - 3, 6 < D - 2 ? 6 : D - 3);
  await placeAt('plante', 0, D - 1); await placeAt('lampe', W - 1, D - 1);
  const st = await ev(() => { const g = window.__bc.game, s = g.shops[0]; return { n: s.items.length, reserve: s.storage, ...g.stats(s) }; });
  check(st.n === 9 && st.registers === 1 && st.machines === 1 && st.seats === 8 && st.blocked.length === 0, '2. café meublé à la souris (9 meubles, tous accessibles)', JSON.stringify({ n: st.n, reserve: st.reserve, bloqués: st.blocked }));
  await page.waitForTimeout(600);
  await shot('1-cafe-amenage');
  await page.keyboard.press('b');

  // 3. Stock : grossiste (emporté à pied) puis commandes livrées avec réassort automatique.
  await goIn(await service('grossiste'));
  // Quantité et « Emporter » dans la même action DOM (le panneau peut être redessiné entre deux actions du pilote).
  await page.waitForFunction(() => [...document.querySelectorAll('#panel tr')].some((r) => r.querySelector('td')?.textContent === 'Croissant'));
  await ev(() => {
    const tr = [...document.querySelectorAll('#panel tr')].find((r) => r.querySelector('td')?.textContent === 'Croissant');
    const i = tr.querySelector('input');
    i.value = '24'; i.dispatchEvent(new Event('input', { bubbles: true }));
    [...tr.querySelectorAll('button')].find((b) => b.textContent.includes('Emporter')).click();
  });
  await page.keyboard.press('Escape');
  await goIn(await ev(() => window.__bc.game.premise(window.__bc.game.shops[0].premiseId).buildingId));
  await page.waitForTimeout(700);
  await tap('.ibar button:has-text("Décharger")');
  await tap('.ibar button:has-text("Gestion")');
  await tap('#panel .tabs button:has-text("Prix et stock")');
  for (const name of ['Café', 'Thé à la menthe', 'Sandwich', 'Jus d’orange pressé', "Jus d'orange pressé", 'Croissant']) {
    const r = page.locator('#panel table.stock tr', { has: page.locator(`b:text-is("${name}")`) });
    if (!(await r.count())) continue;
    await tap(r.locator('button'));
    await r.locator('input[type=checkbox]').check();
    await page.waitForTimeout(100);
  }
  const stock = await ev(() => ({ croissants: window.__bc.game.shops[0].products.croissant.stock, commandes: window.__bc.game.orders.length }));
  check(stock.croissants === 24 && stock.commandes >= 5, '3. stock : 24 croissants en vitrine, commandes livrées demain', JSON.stringify(stock));
  await page.keyboard.press('Escape');

  // 4. Embaucher.
  await goIn(await service('emploi'));
  // Clic DOM sur le premier « Embaucher » (le pilote rend ici un élément détaché par intermittence).
  await page.waitForFunction(() => [...document.querySelectorAll('#panel button')].some((b) => b.textContent === 'Embaucher'), null, { timeout: 30000 });
  await ev(() => [...document.querySelectorAll('#panel button')].find((b) => b.textContent === 'Embaucher').click());
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  check(await ev(() => window.__bc.game.employees.length === 1), '4. employé embauché (une caisse, un caissier)');

  // 5-6. Ouvrir, ventes, récapitulatifs sur 3 jours.
  await goIn(await ev(() => window.__bc.game.premise(window.__bc.game.shops[0].premiseId).buildingId));
  const recaps = [];
  for (let day = 1; day <= 3; day++) {
    // Jusqu'à 23 h 59 par tranches (le personnage reste nourri et reposé), puis minuit.
    await ev(() => { const g = window.__bc.game; while ((g.total % 1440) < 1439) { window.__bc.keepAlive(); window.__bc.advance(Math.min(120, 1439 - (g.total % 1440))); } window.__bc.keepAlive(); });
    if (day === 2) {
      await ev(() => window.__bc.advance(0));
    }
    await ev(() => window.__bc.advance(1));
    await page.waitForSelector('.recap', { timeout: 10000 }).catch(() => {});
    const visible = await page.locator('.recap').isVisible().catch(() => false);
    const d = await ev(() => { const y = window.__bc.game.ledger.at(-1); return { jour: y.day + 1, clients: y.customers, ventes: Math.round(y.revenue), perdus: y.lostStaff + y.lostStock + y.lostCapacity }; });
    recaps.push(d);
    check(visible, `récapitulatif affiché à la fin du jour ${day}`, JSON.stringify(d));
    await shot(`2-recap-jour-${day}`);
    const paused = await ev(() => { const t = window.__bc.game.total; return new Promise((r) => setTimeout(() => r(window.__bc.game.total === t), 1200)); });
    check(paused, `jeu en pause pendant le récapitulatif du jour ${day}`);
    if (visible) await tap('.recap button.primary');
    if (day === 2) { await ev(() => { window.__bc.cam.pitch = 0.75; window.__bc.cam.dist = 12; }); await ev(() => { for (let k = 0; k < 6; k++) { window.__bc.keepAlive(); window.__bc.advance(120); } }); await ev(() => window.__bc.setSpeed(2)); await page.waitForTimeout(4000); await shot('3-cafe-ouvert'); await ev(() => window.__bc.setSpeed(1)); }
  }
  const obj = await ev(() => window.__bc.game.achieved);
  check(['sortir', 'louer', 'meubler', 'stock', 'servir10', 'embaucher', 'jour500'].every((id) => obj.includes(id)), 'objectifs atteints au fil de la boucle', JSON.stringify(obj));
  check(recaps[1].clients > 20 && recaps[2].clients > 20 && recaps[2].ventes > 100, '5-6. ventes les jours 2 et 3 (stock livré, employés en caisse)', JSON.stringify(recaps));

  // 7. Sauvegarde, rechargement, reprise.
  const before = await ev(() => { const g = window.__bc.game; const s0 = g.shops[0]; return { total: g.total, cash: Math.round(g.cash), shops: g.shops.length, items: s0.items.length, emp: g.employees.length, hist: s0.history.length, produits: JSON.stringify(s0.products), rentDue: Math.round(s0.rentDue ?? 0), rep: Math.round(s0.reputation * 1000), obj: g.achieved.length, ledger: g.ledger.length, day: g.day }; });
  await page.keyboard.press('t');
  await page.waitForTimeout(300);
  await ev(() => document.querySelector('.ph-app[data-app="reglages"]').click());
  await page.waitForTimeout(300);
  await ev(() => [...document.querySelectorAll('.ph-body button')].find((b) => b.textContent.includes('Sauvegarder')).click());
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  // Rechargement de la page à l'adresse normale (« ?nouveau » ignorerait la sauvegarde).
  await page.goto(`${base}/index.html`);
  const t0 = Date.now();
  await page.waitForSelector('.menu-card button.primary', { timeout: 120000 }).catch(async (e) => {
    console.log('DIAG', JSON.stringify(await ev(() => [document.getElementById('loading')?.className, document.querySelector('.load-label')?.textContent, document.getElementById('menu')?.className, document.getElementById('menu')?.innerHTML.slice(0, 300), window.__bc?.errors, location.href]).catch(String)), errors.slice(0, 5));
    throw e;
  });
  console.log(`rechargement : menu affiché en ${((Date.now() - t0) / 1000).toFixed(1)} s (rendu logiciel)`);
  await tap('.menu-card button.primary');
  await page.waitForFunction(() => window.__bc?.ready, null, { timeout: 60000 });
  const after = await ev(() => { const g = window.__bc.game; const s0 = g.shops[0]; return { total: g.total, cash: Math.round(g.cash), shops: g.shops.length, items: s0.items.length, emp: g.employees.length, hist: s0.history.length, produits: JSON.stringify(s0.products), rentDue: Math.round(s0.rentDue ?? 0), rep: Math.round(s0.reputation * 1000), obj: g.achieved.length, ledger: g.ledger.length, day: g.day }; });
  // L'horloge peut avancer d'une ou deux minutes entre le clic et le départ (la sauvegarde de sortie les garde).
  const same = Math.abs(after.total - before.total) <= 2 && JSON.stringify({ ...before, total: 0 }) === JSON.stringify({ ...after, total: 0 });
  check(same, '7. rechargement : partie identique', `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
  check(await ev(() => window.__bc.state().inside?.kind === 'shop'), '7. reprise à l’intérieur du café');
  await page.waitForTimeout(1500);
  await shot('4-apres-rechargement');
  check(errors.length === 0, 'aucune erreur de page', errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  server.close();
}
console.log(fails ? `ÉCHECS : ${fails}` : 'BOUCLE COMMERCE 3 JOURS : SUCCÈS');
process.exit(fails ? 1 : 0);
