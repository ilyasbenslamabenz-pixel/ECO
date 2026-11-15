/**
 * Ligne de bus tracée AU DOIGT sur le profil iPhone (390×844, tactile, agent utilisateur iPhone → mode allégé) :
 *   1. rues en boucle et dépôt de bus posés par commandes ; tiroir Transports › Lignes de bus ouvert au doigt ;
 *   2. « Nouvelle ligne », quatre arrêts posés par des TOUCHERS sur la carte ; l'aperçu du tracé s'affiche avant
 *      validation ; cibles tactiles ≥ 44 px ;
 *   3. « Valider la ligne » : la simulation a une ligne de 4 arrêts, le rendu dessine la ligne et ses arrêts ;
 *   4. un arrêt déplacé en le faisant GLISSER (événements tactiles bruts touchStart / touchMove / touchEnd), puis
 *      Annuler (bouton de la barre) le remet en place ; un bus de plus (bouton +) ;
 *   5. le temps avance : des bus roulent sur le tracé ; aucune erreur de page.
 * Usage : node tests/e2e/bus-iphone.mjs (après npm run build). Captures : tests/e2e/out/bus-iphone-*.png.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { collectErrors, launch, root, serve } from './lib.mjs';

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const out = join(root, 'tests/e2e/out');
mkdirSync(out, { recursive: true });
const { server, base } = await serve();
const browser = await launch();
let failed = false;
const check = (ok, msg) => { console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${msg}`); if (!ok) failed = true; };
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE_UA });
  const page = await ctx.newPage();
  const errors = collectErrors(page);
  const cdp = await ctx.newCDPSession(page);
  const send = (n, a) => page.evaluate(([n, a]) => window.__aube.send(n, a).then((r) => ({ ok: true, r }), (e) => ({ ok: false, e: e?.error?.message ?? e?.message ?? String(e) })), [n, a]);
  const bus = async (name, payload) => { const r = await send('pluginCommand', { plugin: 'bus', name, payload }); return r.ok ? r.r.data : null; };
  const render = (n = 2) => page.evaluate((k) => window.__aube.renderNow(k, 0.1), n);
  const w2s = (x, z) => page.evaluate(([a, b]) => window.__aube.worldToScreen(a, b), [x, z]);
  const shot = (name) => page.screenshot({ path: join(out, `bus-iphone-${name}.png`), timeout: 600000 });

  await page.goto(`${base}/index.html?autostart&seed=42&norender`, { timeout: 300000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__aube?.ready && window.__aube.snapshotReceived && window.__aube.lastStats, null, { timeout: 300000, polling: 300 });
  await send('setSpeed', { speed: 0 });

  // 1) Boucle de rues (zone plate repérée par le test mobile existant) et dépôt.
  const cx = 116, cz = 356, W = 110, H = 35;
  for (const p of [[cx - W, cz - H, cx + W, cz - H], [cx - W, cz + H, cx + W, cz + H], [cx - W, cz - H, cx - W, cz + H], [cx + W, cz - H, cx + W, cz + H]]) {
    const r = await send('buildRoad', { type: 'street', kind: 'street', points: p });
    check(r.ok, `rue ${p.join(',')}${r.ok ? '' : ` : ${r.e}`}`);
  }
  let depot = false;
  for (const dx of [0, -40, 40, -80, 80]) {
    for (const [z, rot] of [[cz - H - 22, 0], [cz + H + 22, 2]]) {
      const r = await send('placeBuilding', { assetId: 'depot_bus', x: cx + dx, z, rot });
      if (r.ok) { depot = true; break; }
    }
    if (depot) break;
  }
  check(depot, 'dépôt de bus posé (catalogue : depot_bus)');

  // 2) Tiroir Transports › Lignes de bus, au doigt.
  await page.evaluate(([x, z]) => window.__aube.lookAt(x, z, 420, 1.25, 0), [cx, cz]);
  await render(4);
  // Téléphone : famille « Réseaux » puis « Transports » (même tiroir que le bouton de bureau).
  await page.tap('#toolbar button[data-family=reseaux]');
  await page.waitForTimeout(300);
  await page.tap('#family-pop [data-family-cat=transport]');
  await page.waitForTimeout(500);
  await page.tap('#drawer-tabs [data-tab=bus]');
  await page.waitForTimeout(600);
  await page.tap('[data-bus=new]');
  await page.waitForTimeout(300);
  const drawerTop = await page.evaluate(() => document.querySelector('#build-drawer').getBoundingClientRect().top);
  // Caméra : la boucle au-dessus du tiroir (correction par la jacobienne écran / monde).
  let tx = cx, tz = cz;
  for (let it = 0; it < 3; it++) {
    const s0 = await w2s(cx, cz), sx = await w2s(cx + 50, cz), sz = await w2s(cx, cz + 50);
    const want = { x: 200, y: Math.max(150, drawerTop * 0.56) };
    const a = (sx.x - s0.x) / 50, b = (sz.x - s0.x) / 50, c = (sx.y - s0.y) / 50, d = (sz.y - s0.y) / 50;
    const det = a * d - b * c || 1;
    const ex = s0.x - want.x, ey = s0.y - want.y;
    tx += (d * ex - b * ey) / det; tz += (-c * ex + a * ey) / det;
    await page.evaluate(([x, z]) => window.__aube.lookAt(x, z, 420, 1.25, 0), [tx, tz]);
    await render(3);
  }
  const stops = [[cx - 50, cz - H], [cx + 50, cz - H], [cx + 50, cz + H], [cx - 50, cz + H]];
  const targets = await page.evaluate(() => [...document.querySelectorAll('.bus-ed button')].map((b) => { const r = b.getBoundingClientRect(); return { h: r.height, w: r.width, t: b.textContent }; }));
  check(targets.length > 0 && targets.every((t) => t.h >= 44 && t.w >= 44), `boutons de l’éditeur ≥ 44 px (${targets.map((t) => `${Math.round(t.w)}×${Math.round(t.h)}`).join(', ')})`);
  for (const [x, z] of stops) {
    const p = await w2s(x, z);
    check(p.y > 60 && p.y < drawerTop - 10 && p.x > 10 && p.x < 380, `arrêt (${x}, ${z}) visible au-dessus du tiroir : écran ${Math.round(p.x)}, ${Math.round(p.y)} (tiroir à ${Math.round(drawerTop)})`);
    const before = await page.evaluate(() => document.querySelector('.bus-ed .note')?.textContent ?? '');
    await page.touchscreen.tap(p.x, p.y);
    // Arrêt posé quand la simulation a répondu (accroche à la route puis aperçu du tracé).
    await page.waitForFunction((b) => (document.querySelector('.bus-ed .note')?.textContent ?? '') !== b, before, { timeout: 8000, polling: 100 }).catch(() => undefined);
    await page.waitForTimeout(250);
  }
  const placed = await page.evaluate(() => document.querySelector('.bus-ed .note')?.textContent ?? '');
  check(/^4 arrêts/.test(placed), `quatre arrêts posés au doigt (« ${placed} »)`);
  await page.waitForTimeout(500);
  await render(2);
  const draftPts = await page.evaluate(() => window.__busRender.draftPoints());
  check(draftPts > 20, `aperçu du tracé affiché avant validation (${draftPts} points)`);
  const pv = await page.evaluate(() => document.querySelector('[data-bus-preview]')?.getAttribute('data-bus-preview') + ' : ' + document.querySelector('[data-bus-preview]')?.textContent);
  check(/^ok/.test(pv ?? ''), `aperçu sans problème (${pv})`);
  await shot('apercu');

  // 3) Validation.
  await page.tap('[data-bus=validate]');
  await page.waitForTimeout(900);
  let st = await bus('state');
  check(st?.lines?.length === 1 && st.lines[0].stopIds.length === 4, `ligne créée dans la simulation (${st?.lines?.length} ligne, ${st?.lines?.[0]?.stopIds.length} arrêts)`);
  check(st?.lines?.[0]?.problem === null, `ligne en service (dépôt) : ${st?.lines?.[0]?.problem}`);
  await page.waitForTimeout(600);
  await render(2);
  const drawn = await page.evaluate(() => ({ lines: window.__busRender.lines(), stops: window.__busRender.stops() }));
  check(drawn.lines === 1 && drawn.stops === 4, `rendu : ${drawn.lines} ligne, ${drawn.stops} arrêts`);

  // 4) Glisser un arrêt au doigt (le long de la rue), puis Annuler.
  const s1 = st.stops.find((q) => q.id === st.lines[0].stopIds[1]);
  const a = await w2s(s1.x, s1.z), b = await w2s(s1.x - 30, s1.z);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y }] });
  for (let k = 1; k <= 8; k++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x + ((b.x - a.x) * k) / 8, y: a.y + ((b.y - a.y) * k) / 8 }] });
    await page.waitForTimeout(40);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(900);
  st = await bus('state');
  const moved = st.stops.find((q) => q.id === s1.id);
  check(moved && Math.abs(moved.x - (s1.x - 30)) < 8, `arrêt déplacé au doigt (${Math.round(s1.x)} → ${Math.round(moved?.x)})`);
  await page.tap('#btn-undo');
  await page.waitForTimeout(900);
  st = await bus('state');
  const back = st.stops.find((q) => q.id === s1.id);
  check(back && Math.abs(back.x - s1.x) < 1, `Annuler : arrêt revenu (${Math.round(back?.x)})`);
  await page.tap('[data-bus=buses-plus]');
  await page.waitForTimeout(700);
  st = await bus('state');
  check(st.lines[0].buses === 4, `un bus de plus (${st.lines[0].buses})`);

  // 5) Le temps passe : bus visibles sur le tracé.
  await send('setSpeed', { speed: 4 });
  await page.waitForTimeout(2500);
  await send('setSpeed', { speed: 0 });
  await render(3);
  const buses = await page.evaluate(() => window.__busRender.buses());
  check(buses === 4, `bus visibles sur la ligne (${buses})`);
  await shot('ligne');
  // Coût de rendu des bus : 20 bus (capacité du dépôt), mise à jour des instances mesurée sur 30 images.
  await bus('updateLine', { id: st.lines[0].id, buses: 20 });
  await send('setSpeed', { speed: 1 });
  await page.waitForTimeout(1200);
  await render(30);
  const cost = await page.evaluate(() => ({ buses: window.__busRender.buses(), ms: window.__busRender.frameMs(), draws: window.__busRender.drawCalls() }));
  await send('setSpeed', { speed: 0 });
  console.log(`     coût CPU des bus par image : ${cost.ms.toFixed(3)} ms pour ${cost.buses} bus ; ${cost.draws} appels de dessin du module`);
  check(cost.buses === 20 && cost.ms < 2, `20 bus mis à jour en ${cost.ms.toFixed(3)} ms par image`);
  check(errors.length === 0, `aucune erreur de page (${errors.length}) ${errors.slice(0, 3).join(' | ')}`);
} catch (e) {
  console.error(e);
  check(false, `exception : ${e instanceof Error ? e.message : String(e)}`);
} finally {
  await browser.close();
  server.close();
}
console.log(failed ? '\nLIGNE DE BUS IPHONE : ÉCHEC' : '\nLIGNE DE BUS IPHONE : SUCCÈS');
process.exit(failed ? 1 : 0);
