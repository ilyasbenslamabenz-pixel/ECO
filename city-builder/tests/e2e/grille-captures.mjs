/**
 * Quadrillage de construction vs bâtiments (retour joueur « le quadrillage n'est pas précis, les bâtiments débordent »).
 *   npm run build && node tests/e2e/grille-captures.mjs [suffixe]
 * Partie neuve : une rue est-ouest et une rue en biais (≈ 27°), zonage résidentiel / commerces des deux côtés,
 * croissance forcée, deux bâtiments posés À LA SOURIS avec l'outil Bâtiment. Mesures (console, JSON) :
 *  - emprise simulée (OBB) de chaque bâtiment ; pose rendue du modèle (origine, angle) et rectangle du modèle
 *    (dimensions du catalogue) ; le modèle tient-il dans l'emprise ?
 *  - écart des bords de l'emprise aux lignes du quadrillage AXIAL (multiples de 8 m) et à celles du quadrillage
 *    LOCAL de la route (src/client/tools/road-grid.ts) ;
 * Captures : docs/captures-grille/<vue>-<suffixe>.png (vue de l'outil Bâtiment, curseur près de chaque rue).
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectErrors, launch, root, serve } from './lib.mjs';

const suffix = process.argv[2] ?? 'apres';
const out = join(root, 'docs/captures-grille');
mkdirSync(out, { recursive: true });
const assets = new Map();
for (const f of readdirSync(join(root, 'assets')).filter((n) => n.startsWith('catalog') && n.endsWith('.json'))) {
  for (const a of JSON.parse(readFileSync(join(root, 'assets', f), 'utf8')).assets ?? []) assets.set(a.id, a);
}

const { server, base } = await serve();
const browser = await launch();
const report = { suffix, buildings: [] };
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = collectErrors(page);
  await page.goto(`${base}/index.html?autostart&seed=7&norender`, { timeout: 300000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__aube?.ready && window.__aube.snapshotReceived, null, { timeout: 300000 });
  const send = (name, args) => page.evaluate(([n, a]) => window.__aube.send(n, a).then((r) => ({ ok: true, r }), (e) => ({ ok: false, e: e.message })), [name, args]);
  const zon = (name, payload) => send('pluginCommand', { plugin: 'zonage', name, payload });
  const render = (n = 2, dt = 1 / 30) => page.evaluate(([k, d]) => window.__aube.renderNow(k, d), [n, dt]);
  const screen = (x, z) => page.evaluate(([a, b]) => window.__aube.worldToScreen(a, b), [x, z]);

  const ng = await send('newGame', { seed: 7, mapChunks: 8, startMoney: 30_000_000, cityName: 'Grille', startHour: 11, terrain: { hydrology: 'aucune', rivers: 0 } });
  if (!ng.ok) throw new Error(ng.e);
  await page.waitForTimeout(1500);
  await send('setSpeed', { speed: 0 });
  // Emplacement plat : la rue est-ouest en z = Z + 3 (pas un multiple de 8 : cas général), la rue en biais à l'est.
  let at = null;
  for (let r = 0; r < 700 && !at; r += 40) {
    for (let a = 0; a < 8 && !at; a++) {
      const x = Math.round(Math.cos(a * 0.8) * r), z = Math.round(Math.sin(a * 0.8) * r) + 3;
      const ew = [x - 150, z, x + 60, z];
      const dg = [x + 110, z - 40, x + 110 + 160 * Math.cos(0.47), z - 40 + 160 * Math.sin(0.47)];
      const dry = [await send('buildRoad', { type: 'street', points: ew, dryRun: true }), await send('buildRoad', { type: 'street', points: dg, dryRun: true })];
      if (!dry.every((d) => d.ok)) continue;
      if ((await send('buildRoad', { type: 'street', points: ew })).ok && (await send('buildRoad', { type: 'street', points: dg })).ok) at = { x, z, ew, dg };
    }
  }
  if (!at) throw new Error('aucun emplacement pour les rues');
  report.streets = at;
  const { x: X, z: Z, dg } = at;
  // Zonage des deux côtés et croissance forcée.
  const mid = (t) => [dg[0] + (dg[2] - dg[0]) * t, dg[1] + (dg[3] - dg[1]) * t];
  report.paint = [
    await zon('paint', { points: [X - 140, Z, X - 40, Z], zone: 'res_faible', depth: 2 }),
    await zon('paint', { points: [X - 40, Z, X + 50, Z], zone: 'commerce', depth: 2 }),
    await zon('paint', { points: [...mid(0.15), ...mid(0.9)], zone: 'res_faible', depth: 2 }),
  ].map((r) => (r.ok ? r.r.data?.changed : r.e));
  report.tuning = (await zon('tuning', { demandeMin: -1, maxChantiers: 1000, naissancesParHeure: 3, maxParHeure: 3 })).ok;
  const g = await zon('grow', { attempts: 60 });
  report.grown = g.ok ? g.r.data : g.e;
  const st = await zon('state', {});
  report.demand = st.ok ? st.r.data?.demand : st.e;

  // Deux bâtiments à la souris (outil Bâtiment, aimantation à la route), un par rue.
  await page.evaluate(([x, z]) => window.__aube.lookAt(x, z, 260, 0.95, 0), [X, Z]);
  await render(3);
  await page.click('#toolbar button[data-tool=building]');
  await page.waitForTimeout(600);
  const card = await page.evaluate(() => {
    const c = [...document.querySelectorAll('#drawer-body .card[data-asset]')].map((e) => e.dataset.asset);
    return c.find((id) => /maison_ville|townhouse|immeuble|commerce/.test(id)) ?? c[0];
  });
  await page.click(`#drawer-body .card[data-asset="${card}"]`);
  const hand = [];
  for (const [x, z] of [[X - 20, Z - 14], [...mid(0.5).map((v, k) => v + (k === 0 ? 9 : -14))]]) {
    const p = await screen(x, z);
    await page.mouse.move(p.x, p.y); await page.waitForTimeout(300); await render(1);
    hand.push(await page.evaluate(() => window.__aube.toolPreview()));
    await page.mouse.click(p.x, p.y); await page.waitForTimeout(900);
  }
  report.hand = hand;
  await page.waitForTimeout(800);

  // Mesures : emprise simulée, pose rendue, quadrillages.
  const sd = (await send('save', { slot: 'grille-diag' })).r.data;
  const lineGap = (v) => { const m = ((v % 8) + 8) % 8; return Math.min(m, 8 - m); };
  for (const b of sd.buildings) {
    const a = assets.get(b.assetId);
    if (!a?.footprint) continue;
    const pose = (await page.evaluate((id) => window.__aube.buildingPose?.(id) ?? null, b.id)) ?? { x: b.x, z: b.z, rotY: 0, width: 0, depth: 0, missing: true };
    const th = (((b.rot % 4) + 4) % 4) * Math.PI / 2, c = Math.cos(th), s = Math.sin(th);
    const hx = a.footprint.tilesX * 4, hz = a.footprint.tilesZ * 4;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [b.x + u * hx * c + v * hz * s, b.z - u * hx * s + v * hz * c]);
    // Modèle (dimensions du catalogue autour de l'origine rendue) exprimé dans le repère de l'emprise.
    const dx = pose.x - b.x, dz = pose.z - b.z;
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    const dRot = Math.abs(Math.atan2(Math.sin(pose.rotY - th), Math.cos(pose.rotY - th)));
    const overX = Math.abs(lx) + pose.width / 2 - hx, overZ = Math.abs(lz) + pose.depth / 2 - hz;
    // Bords de l'emprise : écart aux lignes axiales de 8 m (0 = sur une ligne) — seulement si l'emprise est axiale.
    const axial = Math.abs(Math.sin(2 * th)) < 1e-3;
    const edgeGaps = axial ? [Math.min(...corners.map((p) => lineGap(p[0]))), Math.min(...corners.map((p) => lineGap(p[1])))] : null;
    // Quadrillage LOCAL tel qu'affiché quand le curseur est sur ce bâtiment (null : axes du monde).
    const fr = await page.evaluate(([x, z]) => window.__aube.roadGridAt?.(x, z) ?? null, [b.x, b.z]);
    let localGridGap = null;
    if (fr) {
      const gu = [], gv = [];
      for (const [px, pz] of corners) {
        const n = px * fr.nx + pz * fr.nz - fr.cn;
        gu.push(lineGap(px * fr.tx + pz * fr.tz - fr.phase)); gv.push(lineGap(Math.abs(n) - fr.offset));
      }
      localGridGap = [+Math.max(...gu).toFixed(2), +Math.max(...gv).toFixed(2)];
    }
    report.buildings.push({ localGridGap,
      id: b.id, asset: b.assetId, tiles: [a.footprint.tilesX, a.footprint.tilesZ], x: b.x, z: b.z, rotDeg: +(th * 180 / Math.PI).toFixed(2),
      modelOffsetLocal: [+lx.toFixed(3), +lz.toFixed(3)], modelRotErrDeg: +(dRot * 180 / Math.PI).toFixed(3),
      modelOverflow: [+overX.toFixed(2), +overZ.toFixed(2)], axialGridGap: edgeGaps && edgeGaps.map((v) => +v.toFixed(2)),
    });
  }
  console.log(JSON.stringify(report, null, 1));

  // Captures : outil Bâtiment ouvert (quadrillage visible), curseur près de chaque rue.
  for (const [name, [cx, cz], yaw, pitch] of [['rue-droite', [X - 40, Z + 6], 0.0, 0.95], ['rue-biais', [...mid(0.5)], 0.0, 0.95], ['rue-biais-dessus', [...mid(0.62)], 0.0, 1.45], ['rue-droite-dessus', [X - 90, Z], 0.0, 1.45]]) {
    await page.evaluate(([x, z, y, pt]) => window.__aube.lookAt(x, z, 95, pt, y), [cx, cz, yaw, pitch]);
    await render(2, 0.2);
    const p = await screen(cx + 4, cz - 10);
    await page.mouse.move(p.x, p.y); await page.waitForTimeout(300);
    await render(2, 0.2); await page.waitForTimeout(1200); await render(2, 0.2); await page.waitForTimeout(600); await render(1, 0.2);
    report[`frame-${name}`] = await page.evaluate(() => ({ frame: window.__aube.gridFrame?.() ?? null, preview: window.__aube.toolPreview() }));
    await page.screenshot({ path: join(out, `${name}-${suffix}.png`) });
  }
  writeFileSync(join(out, `mesures-${suffix}.json`), JSON.stringify(report, null, 1));
  console.log(JSON.stringify({ droite: report['frame-rue-droite'], biais: report['frame-rue-biais'] }));
  const errs = errors.filter((e) => !/favicon/.test(e));
  if (errs.length) console.log('Erreurs de page :', errs.slice(0, 10));
} finally {
  await browser.close();
  server.close();
}
