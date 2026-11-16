/**
 * Quadrillage UNIQUE au sol (retour joueur « regarde le quadrillage au sol est pas partout le même ») : configuration
 * de la capture du joueur, construite avec l'outil Routes (tracé aimanté) : rue droite, rue perpendiculaire, giratoire
 * sur la rue perpendiculaire, zones des deux côtés, croissance forcée. Puis :
 *  - mesure : grille de points (pas 2 m) autour des routes, lignes AFFICHÉES (`__aube.gridLinesAt`) ; pour chaque
 *    point (hors fondu), écart (m) de ses deux familles de lignes au treillis de référence (celui de la majorité des
 *    points) ; pourcentage de points hors treillis (> 0,05 m), nombre de phases distinctes ;
 *  - captures : vue de dessus et vue rasante, outils Routes et Zones.
 *
 *   node tests/e2e/quadrillage-unique.mjs <suffixe> <dossier-sortie> [dist]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectErrors, launch, serve } from './lib.mjs';

const [suffix = 'apres', out = '/tmp/quadrillage', distDir] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const mod = (a, m) => ((a % m) + m) % m;
const gap = (v) => { const m = mod(v, 8); return Math.min(m, 8 - m); };

const { server, base } = await serve(distDir);
const browser = await launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = collectErrors(page);
  await page.goto(`${base}/index.html?autostart&seed=7`, { timeout: 300000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__aube?.ready && window.__aube.snapshotReceived, null, { timeout: 300000 });
  const send = (name, args) => page.evaluate(([n, a]) => window.__aube.send(n, a).then((r) => ({ ok: true, r }), (e) => ({ ok: false, e: e.message })), [name, args]);
  const zon = (name, payload) => send('pluginCommand', { plugin: 'zonage', name, payload });
  const render = (n = 2, dt = 1 / 30) => page.evaluate(([k, d]) => window.__aube.renderNow(k, d), [n, dt]);
  const ng = await send('newGame', { seed: 7, mapChunks: 8, startMoney: 50_000_000, cityName: 'Quadrillage', startHour: 11, terrain: { hydrology: 'aucune', rivers: 0 } });
  if (!ng.ok) throw new Error(ng.e);
  await page.waitForTimeout(1500);
  await send('setSpeed', { speed: 0 });
  await page.evaluate(() => document.getElementById('main-menu')?.classList.add('hidden'));

  // Site plat : rue est-ouest de 260 m, rue nord-sud de 150 m depuis la rue.
  let site = null;
  for (let r = 0; r < 900 && !site; r += 40) {
    for (let a = 0; a < 8 && !site; a++) {
      const X = Math.round(Math.cos(a * 0.8) * r), Z = Math.round(Math.sin(a * 0.8) * r);
      const d1 = await send('buildRoad', { type: 'street', points: [X - 130, Z, X + 130, Z], dryRun: true });
      const d2 = await send('buildRoad', { type: 'street', points: [X - 60, Z, X - 60, Z + 160], dryRun: true });
      if (d1.ok && d2.ok) site = { X, Z };
    }
  }
  if (!site) throw new Error('aucun site plat');
  const { X, Z } = site;
  // Tracés « joueur » à l'outil Routes (aimantation au quadrillage affiché), points volontairement hors trame.
  const trace = async (type, ax, az, bx, bz) => {
    await page.evaluate(([t]) => window.__aube.setTool('road', { roadType: t }), [type]);
    await page.evaluate(([x, z]) => window.__aube.toolHover(x, z), [ax, az]);
    await page.evaluate(() => window.__aube.toolClick());
    await page.evaluate(([x, z]) => window.__aube.toolHover(x, z), [bx, bz]);
    await page.waitForTimeout(250);
    const pv = await page.evaluate(() => window.__aube.toolPreview());
    const n0 = await page.evaluate(() => window.__aube.constructionApplied());
    await page.evaluate(() => window.__aube.toolClick());
    await page.waitForFunction((n) => window.__aube.constructionApplied() > n, n0, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(600);
    await page.evaluate(() => window.__aube.setTool('road', {}));
    return pv.points;
  };
  const main = await trace('street', X - 127.3, Z + 3.3, X + 126.1, Z + 4.1);
  const zMain = main[1];
  // Rue perpendiculaire depuis la rue (départ accroché au tronçon), vers le nord.
  const perp = await trace('street', X - 58.7, zMain, X - 57.9, Z + 150.6);
  const xPerp = perp[0];
  // Giratoire sur la rue perpendiculaire, à 70 m de la rue principale.
  const rb = await send('buildRoundabout', { x: xPerp, z: zMain + 72, size: 'small' });
  await page.waitForTimeout(600);
  // Zones des deux côtés de la rue principale et de la rue perpendiculaire, croissance forcée.
  const paint = [
    await zon('paint', { points: [X - 120, zMain, X + 120, zMain], zone: 'res_dense', depth: 4 }),
    await zon('paint', { points: [xPerp, zMain + 12, xPerp, zMain + 52], zone: 'commerce', depth: 3 }),
    await zon('paint', { points: [xPerp, zMain + 95, xPerp, zMain + 145], zone: 'res_moyen', depth: 3 }),
  ].map((r) => (r.ok ? r.r.data?.changed : r.e));
  await zon('tuning', { demandeMin: -1, maxChantiers: 1000, naissancesParHeure: 3, maxParHeure: 3 });
  let grown = 0;
  for (let k = 0; k < 6; k++) { const g = await zon('grow', { attempts: 80 }); grown += g.ok ? (g.r.data?.grown ?? 0) : 0; }
  // Chantiers terminés (immeubles visibles) : quelques heures simulées.
  await send('setSpeed', { speed: 3 });
  await page.waitForTimeout(6000);
  await send('setSpeed', { speed: 0 });
  await page.waitForTimeout(500);

  // Mesure : lignes affichées sur une grille de points autour des routes (outil Routes ouvert, curseur au carrefour).
  await page.evaluate(() => window.__aube.setTool('road', { roadType: 'street' }));
  await page.evaluate(([x, z]) => window.__aube.toolHover(x, z), [xPerp + 20, zMain + 20]);
  await render(1);
  const pts = [];
  for (let z = zMain - 56; z <= zMain + 156; z += 2) for (let x = X - 120; x <= X + 120; x += 2) pts.push([x + 0.31, z + 0.47]);
  const Ls = await page.evaluate((pp) => { window.__aube.gridFieldFlush?.(); return pp.map(([x, z]) => window.__aube.gridLinesAt(x, z)); }, pts);
  // Familles de lignes ramenées aux axes du monde : lignes x ≡ px et z ≡ pz (routes est-ouest / nord-sud).
  const rows = [];
  for (let i = 0; i < pts.length; i++) {
    const L = Ls[i];
    if (!L || L.weight < 0.5) continue;
    const ang = mod(Math.atan2(L.tz, L.tx), Math.PI / 2);
    if (Math.min(ang, Math.PI / 2 - ang) > 0.002) { rows.push({ p: pts[i], kind: L.kind, biais: true }); continue; }
    // N = (−tz, tx). Ligne P·T ≡ pu, P·N ≡ pv.
    let px, pz;
    if (Math.abs(L.tx) > 0.5) { px = L.tx > 0 ? L.pu : -L.pu; pz = L.tx > 0 ? L.pv : -L.pv; } else { pz = L.tz > 0 ? L.pu : -L.pu; px = L.tz > 0 ? -L.pv : L.pv; }
    rows.push({ p: pts[i], kind: L.kind, px: mod(px, 8), pz: mod(pz, 8) });
  }
  const key = (v) => (Math.round(v * 20) / 20) % 8;
  const hist = (f) => { const h = new Map(); for (const r of rows) if (!r.biais) h.set(key(r[f]), (h.get(key(r[f])) ?? 0) + 1); return [...h.entries()].sort((a, b) => b[1] - a[1]); };
  const hx = hist('px'), hz = hist('pz');
  const refX = hx[0]?.[0] ?? 0, refZ = hz[0]?.[0] ?? 0;
  const straight = rows.filter((r) => !r.biais);
  const off = straight.filter((r) => gap(r.px - refX) > 0.05 || gap(r.pz - refZ) > 0.05);
  const report = {
    suffix, site, main, perp, roundabout: rb.ok ? rb.r.data : rb.e, paint, grown,
    points: rows.length, biais: rows.length - straight.length,
    reference: { x: refX, z: refZ }, phasesX: hx.slice(0, 6), phasesZ: hz.slice(0, 6),
    horsTreillis: off.length, horsTreillisPct: +(100 * off.length / Math.max(1, straight.length)).toFixed(1),
    ecartMax: +Math.max(0, ...straight.map((r) => Math.max(gap(r.px - refX), gap(r.pz - refZ)))).toFixed(3),
    treillisDuMonde: refX === 0 && refZ === 0,
  };
  console.log(JSON.stringify(report));
  writeFileSync(join(out, `mesure-${suffix}.json`), JSON.stringify({ ...report, horsPoints: off.slice(0, 400) }, null, 1));

  // Captures (outil Routes puis outil Zones).
  const shots = [
    ['dessus', xPerp + 30, zMain + 40, 150, 1.45, 0],
    ['rasante', xPerp + 25, zMain - 10, 70, 0.5, Math.PI * 0.85],
    ['carrefour', xPerp + 5, zMain + 5, 60, 1.2, 0.3],
  ];
  for (const tool of ['routes', 'zones']) {
    if (tool === 'zones') { await page.evaluate(() => window.__aube.setTool('none', {})).catch(() => {}); await page.click('#toolbar button[data-cat=zones]').catch(() => {}); await page.waitForTimeout(500); }
    for (const [vn, x, z, d, p, y] of shots) {
      await page.evaluate(([a, b, dd, pp, yy]) => window.__aube.lookAt(a, b, dd, pp, yy), [x, z, d, p, y]);
      if (tool === 'routes') await page.evaluate(([x2, z2]) => window.__aube.toolHover(x2, z2), [x + 2, z + 2]);
      await render(2, 0.2); await page.evaluate(() => window.__aube.gridFieldFlush?.()); await render(2, 0.2);
      await page.waitForTimeout(400); await render(1, 0.2);
      await page.screenshot({ path: join(out, `${tool}-${vn}-${suffix}.png`) });
    }
  }
  const errs = errors.filter((e) => !/favicon/.test(e));
  if (errs.length) console.log('Erreurs de page :', errs.slice(0, 10));
} finally {
  await browser.close();
  server.close();
}
