/**
 * Parcours navigateur de Boutique City (Playwright, Chromium préinstallé), au clavier et à la souris autant que
 * possible : réveil dans l'appartement, sortie à pied, location d'un local, magasin de meubles, grossiste,
 * aménagement en 3D à la souris, déchargement, caisse tenue par le joueur avec clients visibles, embauche, banque,
 * publicité, snack, garage et conduite, carte, entreprise, sauvegarde et reprise. Les longs trajets à pied sont
 * remplacés par une téléportation (outil de test) : le déplacement lui-même est vérifié au début.
 * Usage : npm run build && node tests/e2e.mjs [dossier des captures]
 */
import { createServer } from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';

const out = process.argv[2] ?? 'tests/out';
mkdirSync(out, { recursive: true });
const dist = join(process.cwd(), 'dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary' };
const server = createServer((req, res) => {
  const u = new URL(req.url, 'http://x').pathname;
  const p = join(dist, decodeURIComponent(u === '/' ? '/index.html' : u));
  let body;
  try { body = readFileSync(p); } catch { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[extname(p)] ?? 'application/octet-stream' }); res.end(body);
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
  /** Clic sur le n-ième bouton du panneau dont le texte contient `text` (clic DOM : le pilote voit par intermittence un
   * élément détaché sur cette page à faible cadence d'images). */
  const panelButton = async (text, nth = 0) => {
    await page.waitForFunction(([t, n]) => [...document.querySelectorAll('#panel button')].filter((b) => b.textContent.includes(t)).length > n, [text, nth], { timeout: 30000 });
    await ev(([t, n]) => [...document.querySelectorAll('#panel button')].filter((b) => b.textContent.includes(t))[n].click(), [text, nth]);
    await page.waitForTimeout(250);
  };
  const goIn = async (buildingId) => { await ev((b) => window.__bc.toDoor(b), buildingId); await page.waitForTimeout(250); await page.keyboard.press('e'); await page.waitForTimeout(400); };

  await page.goto(`${base}/index.html?seed=7&nouveau`);
  await page.waitForSelector('.menu-card');
  await shot('01-menu');
  await page.fill('.menu-card input', 'Atlas Commerce');
  await page.click('.menu-card button.primary');
  await page.waitForFunction(() => window.__bc?.ready);
  await page.waitForTimeout(1200);
  await shot('02-appartement');
  check(await ev(() => window.__bc.state().inside?.kind === 'home'), 'réveil dans l’appartement');

  // Sortie à pied : la caméra regarde vers le fond, la porte est derrière (touche S).
  await page.keyboard.down('KeyS');
  await page.waitForFunction(() => window.__bc.state().inside === null, null, { timeout: 30000 }).catch(() => {});
  await page.keyboard.up('KeyS');
  check(await ev(() => window.__bc.state().inside === null), 'sorti dans la rue en marchant');
  const p0 = await ev(() => [window.__bc.game.player.x, window.__bc.game.player.z]);
  await page.keyboard.down('KeyD'); await page.waitForTimeout(3000); await page.keyboard.up('KeyD');
  const p1 = await ev(() => [window.__bc.game.player.x, window.__bc.game.player.z]);
  check(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) > 0.5, 'le personnage marche dans la rue', JSON.stringify([p0, p1]));
  await shot('03-rue');

  // Local libre : visite (E), bail signé par le panneau, entrée automatique.
  const free = await ev(() => { const g = window.__bc.game; return g.district.premises.filter((p) => g.isFree(p)).sort((a, b) => b.footfall - a.footfall)[0].buildingId; });
  await goIn(free);
  await page.waitForSelector('#panel:not(.hidden)');
  await shot('04-local-libre');
  await page.waitForSelector('#panel select');
  await ev(() => { const s = [...document.querySelectorAll('#panel select')].find((e) => e.isConnected && [...e.options].some((o) => o.value === 'epicerie')); s.value = 'epicerie'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(300);
  await page.fill('#panel input[type=text]', 'Épicerie Atlas');
  await page.click('#panel button:has-text("Signer le bail")');
  await page.waitForTimeout(600);
  check(await ev(() => window.__bc.state().inside?.kind === 'shop' && window.__bc.game.shops[0]?.name === 'Épicerie Atlas'), 'bail signé, entrée dans le local vide');
  await shot('05-local-vide');

  // Magasin de meubles : achats par le panneau.
  await goIn(await service('meubles'));
  await page.waitForSelector('#panel:not(.hidden)');
  /** Ligne du panneau dont une cellule porte `name` : quantité saisie puis bouton (actions DOM, relues à chaque fois). */
  const rowAct = async (name, qty, btnText = '') => {
    await page.waitForFunction((n) => [...document.querySelectorAll('#panel tr')].some((tr) => [...tr.querySelectorAll('b, td')].some((c) => c.textContent.trim() === n)), name, { timeout: 30000 });
    await ev(([n, q, t]) => {
      const tr = [...document.querySelectorAll('#panel tr')].find((r) => [...r.querySelectorAll('b, td')].some((c) => c.textContent.trim() === n));
      const inp = tr.querySelector('input.qty');
      if (inp && q !== null) { inp.value = String(q); inp.dispatchEvent(new Event('change', { bubbles: true })); }
      [...tr.querySelectorAll('button')].find((b) => !t || b.textContent.includes(t)).click();
    }, [name, qty, btnText]);
    await page.waitForTimeout(200);
  };
  const buy = (name, qty) => rowAct(name, qty);
  await buy('Caisse', 1); await buy('Rayonnage', 3); await buy('Vitrine réfrigérée', 2); await buy('Plante', 2);
  await shot('06-meubles');
  check(await ev(() => JSON.stringify(window.__bc.game.shops[0].storage) === JSON.stringify({ caisse: 1, rayon: 3, frigo: 2, plante: 2 })), 'meubles livrés dans la réserve', await ev(() => JSON.stringify(window.__bc.game.shops[0].storage)));
  await page.keyboard.press('Escape');

  // Grossiste à pied : 24 pains au plus.
  await goIn(await service('grossiste'));
  await page.waitForSelector('#panel:not(.hidden)');
  await rowAct('Pain', 50, 'Emporter');
  await page.waitForTimeout(200);
  await shot('07-grossiste');
  check(await ev(() => window.__bc.game.player.carry.pain === 24), 'marchandise portée (24 au plus à pied)');
  await page.keyboard.press('Escape');

  // Aménagement en 3D à la souris.
  const shopB = await ev(() => window.__bc.game.premise(window.__bc.game.shops[0].premiseId).buildingId);
  await goIn(shopB);
  check(await ev(() => window.__bc.state().inside?.kind === 'shop'), 'retour dans le commerce (E)');
  await page.keyboard.press('b');
  await page.waitForTimeout(400);
  const grid = await ev(() => { const g = window.__bc.game; const p = g.premise(g.shops[0].premiseId); return [p.gridW, p.gridD]; });
  const NAMES = { caisse: 'Caisse', rayon: 'Rayonnage', frigo: 'Vitrine réfrigérée', plante: 'Plante' };
  const placeAt = async (def, x, z, rot = 0) => {
    // Recliquer le meuble choisi le désélectionne : seulement s'il n'est pas déjà l'outil actif.
    if (await ev(() => window.__bc.state().build.tool) !== def) await page.click(`.buildbar .bb-pick:has-text("${NAMES[def]}")`);
    for (let k = 0; k < 4 && await ev(() => window.__bc.state().build.rot) !== rot; k++) await page.keyboard.press('r');
    const [sx, sy] = await ev(([a, b]) => window.__bc.cellScreen(a, b), [x, z]);
    await page.mouse.move(sx, sy);
    await page.waitForTimeout(150);
    await page.mouse.click(sx, sy);
    await page.waitForTimeout(250);
  };
  await placeAt('rayon', 1, 0);
  await placeAt('rayon', 5, 0);
  await placeAt('frigo', grid[0] - 2, 0);
  await placeAt('caisse', 2, 3);
  await placeAt('rayon', 0, 4, 1);
  await placeAt('frigo', grid[0] - 1, 3, 1);
  await placeAt('plante', 0, grid[1] - 1);
  await placeAt('plante', grid[0] - 1, grid[1] - 1);
  await shot('08-amenagement-3d');
  const st = await ev(() => { const g = window.__bc.game, s = g.shops[0]; return { items: s.items.length, reserve: s.storage, ...g.stats(s) }; });
  check(st.items >= 7 && st.registers === 1 && st.capacity.rayon > 0 && st.capacity.frigo > 0 && st.blocked.length === 0, 'meubles posés à la souris en 3D', JSON.stringify({ items: st.items, reserve: st.reserve, cap: st.capacity, bloqués: st.blocked }));
  // Reprendre un meuble posé (clic) puis le reposer ailleurs.
  const [mx, my] = await ev(() => window.__bc.cellScreen(0, window.__bc.game.premise(window.__bc.game.shops[0].premiseId).gridD - 1));
  await page.mouse.click(mx, my);
  await page.waitForTimeout(200);
  const moving = await ev(() => window.__bc.state().build.tool);
  const [nx, ny] = await ev(() => window.__bc.cellScreen(0, window.__bc.game.premise(window.__bc.game.shops[0].premiseId).gridD - 2));
  await page.mouse.click(nx, ny);
  await page.waitForTimeout(200);
  check(moving === 'plante' && await ev(() => window.__bc.game.shops[0].items.some((i) => i.def === 'plante' && i.x === 0 && i.z === window.__bc.game.premise(window.__bc.game.shops[0].premiseId).gridD - 2)), 'meuble déplacé à la souris');
  await page.keyboard.press('b');
  await page.waitForTimeout(700);
  await page.click('.ibar button:has-text("Décharger")');
  check(await ev(() => window.__bc.game.shops[0].products.pain.stock === 24 && !window.__bc.game.player.carry.pain), 'marchandise déchargée en rayon');

  // Commandes livrées depuis la gestion du commerce.
  await page.click('.ibar button:has-text("Gestion")');
  await page.click('#panel .tabs button:has-text("Prix et stock")');
  for (const name of ['Lait', 'Fruits et légumes', 'Boissons fraîches', 'Conserves et épicerie', 'Snacks', 'Pain']) {
    await rowAct(name, null);
    await ev((n) => { const tr = [...document.querySelectorAll('#panel table.stock tr')].find((r) => r.querySelector('b')?.textContent === n); const cb = tr.querySelector('input[type=checkbox]'); if (!cb.checked) cb.click(); }, name);
    await page.waitForTimeout(120);
  }
  await shot('09-stock');
  check(await ev(() => window.__bc.game.orders.length >= 6), 'commandes passées (livraison demain)');
  await page.keyboard.press('Escape');

  // Le lendemain matin : livraison, le joueur tient la caisse, des clients entrent.
  await ev(() => { for (let k = 0; k < 13; k++) { window.__bc.keepAlive(); window.__bc.advance(120); } window.__bc.keepAlive(); });
  await page.waitForSelector('.recap');
  await page.click('.recap button.primary');
  await ev(() => { const b = window.__bc, v = b.scene.interior.view, it = v.items.find((i) => i.def === 'caisse'); const [x, z] = v.cellCenter(it.x, it.z - 1); b.setIpos(x, z); });
  await page.waitForTimeout(300);
  check(await ev(() => window.__bc.action()) === 'Tenir la caisse', 'invite « Tenir la caisse » derrière la caisse');
  await page.keyboard.press('e');
  await ev(() => window.__bc.setSpeed(2));
  await page.waitForFunction(() => window.__bc.state().customers >= 2, null, { timeout: 60000 }).catch(() => {});
  await ev(() => { window.__bc.cam.pitch = 0.7; window.__bc.cam.dist = 11; });
  await page.waitForTimeout(1500);
  await shot('10-clients-dans-le-magasin');
  const cl = await ev(() => ({ visibles: window.__bc.state().customers, servis: window.__bc.game.shops[0].today.customers, caisse: window.__bc.game.player.tending }));
  check(cl.visibles >= 1 && cl.servis >= 1 && cl.caisse !== null, 'clients visibles et servis par le joueur', JSON.stringify(cl));
  // Avis clients en bulles : un « trop cher » et un « content » injectés dans le flux de la simulation.
  await ev(() => { const g = window.__bc.game; g.feedback.push({ shopId: g.shops[0].id, kind: 'prix' }); });
  await page.waitForTimeout(1500);
  await shot('10b-avis-client');
  check(await ev(() => { let n = 0; window.__bc.scene.interior.view.scene.traverse((o) => { if (o.isSprite) n++; }); return n; }) >= 1, 'bulle d’avis client affichée');
  check(/Objectif \d+ \/ 13/.test(await page.textContent('.objective') ?? ''), 'carte d’objectif affichée', await page.textContent('.objective'));
  await ev(() => window.__bc.setSpeed(1));
  await page.keyboard.press('e');

  // Agence pour l'emploi, banque, publicité, snack (panneaux).
  await goIn(await service('emploi'));
  await panelButton('Embaucher');
  await page.waitForTimeout(200);
  check(await ev(() => window.__bc.game.employees.length === 1), 'employé embauché à l’agence');
  await page.keyboard.press('Escape');
  await goIn(await service('banque'));
  await panelButton('Emprunter');
  await page.waitForTimeout(200);
  check(await ev(() => window.__bc.game.loans.length === 1), 'prêt accordé');
  await shot('11-banque');
  await page.keyboard.press('Escape');
  await goIn(await service('pub'));
  await panelButton('Lancer');
  await page.waitForTimeout(200);
  check(await ev(() => window.__bc.game.campaigns.length === 1), 'campagne de publicité lancée');
  await page.keyboard.press('Escape');
  await ev(() => { window.__bc.game.player.hunger = 30; });
  await goIn(await service('snack'));
  await ev(() => [...document.querySelectorAll('#panel .item button')].at(-1).click());
  await page.waitForTimeout(200);
  check(await ev(() => window.__bc.game.player.hunger > 90), 'repas au snack');
  await page.keyboard.press('Escape');

  // Garage : camionnette (5e véhicule : scooter, citadine, sportive, SUV, camionnette, camion), conduite.
  await goIn(await service('garage'));
  await panelButton('Acheter', 4);
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  const van = await ev(() => window.__bc.game.vehicles[0]);
  check(van?.type === 'camionnette', 'camionnette achetée');
  await ev(([x, z]) => window.__bc.teleport(x + 2.6, z), [van.x, van.z]);
  await page.waitForTimeout(300);
  await page.keyboard.press('e');
  // Durée longue : en rendu logiciel, le jeu tourne à 1–2 images par seconde (pas de temps plafonné à 0,1 s).
  await page.keyboard.down('KeyW'); await page.waitForTimeout(6000); await page.keyboard.up('KeyW');
  await shot('12-conduite');
  const moved = await ev(([x, z]) => { const v = window.__bc.game.vehicles[0]; return Math.hypot(v.x - x, v.z - z); }, [van.x, van.z]);
  check(moved > 1, 'la camionnette roule', `${moved.toFixed(1)} m`);
  await page.keyboard.press('e');
  check(await ev(() => window.__bc.state().car === null), 'descendu du véhicule');

  // Carte et entreprise.
  await page.keyboard.press('m');
  await page.waitForSelector('#map:not(.hidden) canvas');
  await shot('13-carte');
  await page.click('#map .legend-btn:has-text("Grossiste")');
  check(await ev(() => document.getElementById('map').classList.contains('hidden')), 'destination choisie sur la carte');
  await ev(() => { for (let d = 0; d < 4; d++) { window.__bc.keepAlive(); window.__bc.advance(720); } });
  await page.waitForTimeout(400);
  if (await page.locator('.recap').count()) await page.click('.recap button.primary');
  // Téléphone : ouverture (T), pause, applis, Immobilier, Marché, Entreprise.
  await page.keyboard.press('t');
  await page.waitForTimeout(400);
  const ph = await ev(() => ({ open: !document.querySelector('.phone').classList.contains('hidden'), apps: document.querySelectorAll('.ph-app').length, veil: !document.querySelector('.ph-veil').classList.contains('hidden') }));
  check(ph.open && ph.apps === 11 && ph.veil, 'téléphone ouvert (11 applis, scène voilée)', JSON.stringify(ph));
  await shot('14a-telephone');
  await ev(() => document.querySelector('.ph-app[data-app="immo"]').click());
  await page.waitForTimeout(400);
  check(await ev(() => document.querySelectorAll('.ph-body .ph-card').length > 3), 'appli Immobilier : locaux libres listés');
  await ev(() => document.querySelector('.ph-back').click());
  await ev(() => document.querySelector('.ph-app[data-app="marche"]').click());
  await page.waitForTimeout(400);
  check(await ev(() => document.querySelectorAll('.ph-body .ph-line').length > 10), 'appli Marché : prix du grossiste');
  await shot('14b-marche');
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check(await ev(() => document.querySelector('.phone').classList.contains('hidden')), 'téléphone fermé (Échap)');
  await page.keyboard.press('t');
  await page.waitForTimeout(300);
  await ev(() => document.querySelector('.ph-app[data-app="entreprise"]').click());
  await page.waitForTimeout(500);
  await shot('14-entreprise');
  const res = await ev(() => { const s = window.__bc.game.shops[0]; return { clients: s.history.reduce((a, d) => a + d.customers, 0), ventes: Math.round(s.history.reduce((a, d) => a + d.revenue, 0)) }; });
  check(res.clients > 60 && res.ventes > 200, 'le commerce vend avec son employé', JSON.stringify(res));

  // Sauvegarde et reprise.
  await page.keyboard.press('t');
  await page.waitForTimeout(300);
  await ev(() => document.querySelector('.ph-app[data-app="reglages"]').click());
  await page.waitForTimeout(300);
  await ev(() => [...document.querySelectorAll('.ph-body button')].find((b) => b.textContent.includes('Sauvegarder')).click());
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await page.goto(`${base}/index.html`);
  await page.waitForSelector('.menu-card button.primary');
  const label = await page.textContent('.menu-card button.primary');
  check(/Continuer : Atlas Commerce/.test(label ?? ''), 'reprise proposée', label);
  await page.click('.menu-card button.primary');
  await page.waitForFunction(() => window.__bc?.ready);
  check(await ev(() => window.__bc.game.shops.length === 1 && window.__bc.game.vehicles.length === 1 && window.__bc.game.loans.length === 1), 'partie reprise (commerce, véhicule, prêt)');
  const fps = await ev(() => new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { if (++n >= 40) r(Math.round((n * 1000) / (performance.now() - t0))); else requestAnimationFrame(f); }; requestAnimationFrame(f); }));
  console.log('images/s (navigateur sans GPU, rendu logiciel) :', fps);
  check(errors.length === 0, 'aucune erreur de page', errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  server.close();
}
console.log(fails ? `ÉCHECS : ${fails}` : 'BOUTIQUE CITY : SUCCÈS');
process.exit(fails ? 1 : 0);
