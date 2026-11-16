/**
 * Quadrillage affiché vs bâtiments et zones, DANS TOUS LES OUTILS (retour joueur « c'est pas du tout corrigé » :
 * vue rasante, rangées intérieures loin de la route, cases en biais par rapport aux façades).
 *
 *   node tests/e2e/grille-partout.mjs fabriquer <partie.json> [dist]   partie de référence (à lancer avec un ANCIEN
 *        build pour reproduire une « partie existante ») : rue droite, rue en biais à 27°, rue courbe, zones sur 4 rangées
 *        des deux côtés, croissance forcée ; la sauvegarde est écrite dans <partie.json>.
 *   node tests/e2e/grille-partout.mjs mesurer <partie.json> <suffixe> [dist]
 *        charge la partie et, pour chaque outil (Bâtiment curseur sur le bâtiment, Bâtiment curseur loin de la route,
 *        Routes, Terrain, Zones), mesure pour CHAQUE bâtiment l'angle entre ses côtés et les lignes affichées à son
 *        emplacement et l'écart (m) de ses côtés à la ligne la plus proche ; captures docs/captures-grille/partout-*.png.
 *
 * Lignes affichées en un point : `__aube.gridLinesAt(x, z)` (champ de trames local) si présent ; sinon (ancien code)
 * la trame unique `__aube.gridFrame()` de l'outil Bâtiment, ou les axes du monde. Outil Zones : cases de la
 * superposition (`__zonage.cellFrameAt`, sinon cases du monde) ; les lignes du sol n'y étaient pas affichées avant.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectErrors, launch, root, serve } from './lib.mjs';

const [mode, file, a3, a4] = process.argv.slice(2);
const suffix = mode === 'mesurer' ? a3 ?? 'apres' : '';
const distDir = mode === 'mesurer' ? a4 : a3;
const out = join(root, 'docs/captures-grille');
mkdirSync(out, { recursive: true });
const assets = new Map();
for (const f of readdirSync(join(root, 'assets')).filter((n) => n.startsWith('catalog') && n.endsWith('.json'))) {
  for (const a of JSON.parse(readFileSync(join(root, 'assets', f), 'utf8')).assets ?? []) assets.set(a.id, a);
}
const lineGap = (v) => { const m = ((v % 8) + 8) % 8; return Math.min(m, 8 - m); };

const { server, base } = await serve(distDir);
const browser = await launch();
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

  if (mode === 'fabriquer') {
    const ng = await send('newGame', { seed: 7, mapChunks: 8, startMoney: 50_000_000, cityName: 'Partout', startHour: 11, terrain: { hydrology: 'aucune', rivers: 0 } });
    if (!ng.ok) throw new Error(ng.e);
    await page.waitForTimeout(1500);
    await send('setSpeed', { speed: 0 });
    let at = null;
    for (let r = 0; r < 900 && !at; r += 40) {
      for (let a = 0; a < 8 && !at; a++) {
        const x = Math.round(Math.cos(a * 0.8) * r), z = Math.round(Math.sin(a * 0.8) * r) + 3;
        const ew = [x - 150, z, x + 60, z];
        const dg = [x + 130, z - 60, x + 130 + 170 * Math.cos(0.47), z - 60 + 170 * Math.sin(0.47)];
        // Rue courbe au sud (quadratique), loin des deux autres.
        const cv = { points: [x - 150, z + 150, x + 40, z + 170], control: [x - 50, z + 90] };
        const dry = [
          await send('buildRoad', { type: 'street', points: ew, dryRun: true }),
          await send('buildRoad', { type: 'street', points: dg, dryRun: true }),
          await send('buildRoad', { type: 'street', points: cv.points, control: cv.control, dryRun: true }),
        ];
        if (!dry.every((d) => d.ok)) continue;
        const ok = [await send('buildRoad', { type: 'street', points: ew }), await send('buildRoad', { type: 'street', points: dg }), await send('buildRoad', { type: 'street', points: cv.points, control: cv.control })];
        if (ok.every((o) => o.ok)) at = { x, z, ew, dg, cv };
      }
    }
    if (!at) throw new Error('aucun emplacement pour les rues');
    const { x: X, z: Z, dg, cv } = at;
    const mid = (t) => [dg[0] + (dg[2] - dg[0]) * t, dg[1] + (dg[3] - dg[1]) * t];
    const q = (t) => { const [x0, z0, x1, z1] = cv.points, [cx, cz] = cv.control; const u = 1 - t; return [u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * z0 + 2 * u * t * cz + t * t * z1]; };
    const paint = [
      await zon('paint', { points: [X - 140, Z, X - 50, Z], zone: 'res_dense', depth: 4 }),
      await zon('paint', { points: [X - 50, Z, X + 50, Z], zone: 'commerce', depth: 4 }),
      await zon('paint', { points: [...mid(0.1), ...mid(0.9)], zone: 'res_moyen', depth: 4 }),
      await zon('paint', { points: [...q(0.1), ...q(0.5), ...q(0.9)], zone: 'res_faible', depth: 4 }),
    ].map((r) => (r.ok ? r.r.data?.changed : r.e));
    await zon('tuning', { demandeMin: -1, maxChantiers: 1000, naissancesParHeure: 3, maxParHeure: 3 });
    let grown = 0;
    for (let k = 0; k < 6; k++) { const g = await zon('grow', { attempts: 80 }); grown += g.ok ? (g.r.data?.grown ?? 0) : 0; }
    const sd = (await send('save', { slot: 'grille-partout' })).r.data;
    sd.__site = at;
    writeFileSync(file, JSON.stringify(sd));
    console.log(JSON.stringify({ at, paint, grown, buildings: sd.buildings.length }));
  } else if (mode === 'mesurer') {
    const sd = JSON.parse(readFileSync(file, 'utf8'));
    const at = sd.__site;
    const ld = await send('load', { data: sd });
    if (!ld.ok) throw new Error(ld.e);
    await page.waitForTimeout(2500);
    await send('setSpeed', { speed: 0 });
    await page.evaluate(() => document.getElementById('main-menu')?.classList.add('hidden'));
    const report = { suffix, site: at, tools: {} };
    const blds = [];
    for (const b of sd.buildings) {
      const a = assets.get(b.assetId);
      if (!a?.footprint) continue;
      const th = (((b.rot % 4) + 4) % 4) * Math.PI / 2, c = Math.cos(th), s = Math.sin(th);
      const hx = a.footprint.tilesX * 4, hz = a.footprint.tilesZ * 4;
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [b.x + u * hx * c + v * hz * s, b.z - u * hx * s + v * hz * c]);
      // Points où l'on regarde les lignes : centre et 1,5 m devant chaque côté (les cases autour du bâtiment).
      const pts = [[0, 0], [hx + 1.5, 0], [-hx - 1.5, 0], [0, hz + 1.5], [0, -hz - 1.5]].map(([u, v]) => [b.x + u * c + v * s, b.z - u * s + v * c]);
      blds.push({ id: b.id, x: b.x, z: b.z, th, corners, pts, o: { cx: b.x, cz: b.z, hx, hz, c, s } });
    }
    // Lignes affichées en (x, z) pour l'outil courant : { tx, tz, pu, pv } (lignes P·T ≡ pu, P·N ≡ pv mod 8, N = (−tz, tx)).
    const linesAt = (pts, zones) => page.evaluate(([pp, zz]) => pp.map(([x, z]) => {
      const A = window.__aube, Zn = window.__zonage;
      A.gridFieldFlush?.();
      if (zz) {
        if (Zn?.cellFrameAt) return Zn.cellFrameAt(x, z);
        return { tx: 1, tz: 0, pu: 0, pv: 0, kind: 'monde' };
      }
      if (A.gridLinesAt) return A.gridLinesAt(x, z) ?? { tx: 1, tz: 0, pu: 0, pv: 0, kind: 'aucun' };
      const f = A.gridFrame?.();
      if (!f) return { tx: 1, tz: 0, pu: 0, pv: 0, kind: 'monde' };
      const side = x * f.nx + z * f.nz - f.cn >= 0 ? 1 : -1;
      return { tx: f.tx, tz: f.tz, pu: f.phase, pv: f.cn + side * f.offset, kind: 'route' };
    }), [pts, zones]);
    const measure = (L, b) => {
      const ang = Math.atan2(L.tz, L.tx), bAng = -b.th; // axe local x du bâtiment en monde : (c, −s)
      let d = ((bAng - ang) % (Math.PI / 2) + Math.PI / 2) % (Math.PI / 2);
      d = Math.min(d, Math.PI / 2 - d) * 180 / Math.PI;
      if (d > 0.5) return { angle: +d.toFixed(2), gap: null };
      const nx = -L.tz, nz = L.tx;
      let g = 0;
      for (const [px, pz] of b.corners) g = Math.max(g, lineGap(px * L.tx + pz * L.tz - L.pu), lineGap(px * nx + pz * nz - L.pv));
      return { angle: +d.toFixed(2), gap: +g.toFixed(2) };
    };
    const dist = (o, x, z) => { const dx = x - o.cx, dz = z - o.cz; const lx = Math.abs(dx * o.c - dz * o.s) - o.hx, lz = Math.abs(dx * o.s + dz * o.c) - o.hz; return Math.hypot(Math.max(0, lx), Math.max(0, lz)); };
    /** Pire cas sur les points d'un bâtiment dont il est le bâtiment le plus proche (pas les cases d'un voisin). */
    const worst = (Ls, b) => {
      let angle = 0, gap = 0;
      for (let k = 0; k < Ls.length; k++) {
        const L = Ls[k], [px, pz] = b.pts[k];
        if (k > 0 && blds.some((q) => q !== b && dist(q.o, px, pz) < dist(b.o, px, pz))) continue; const m = measure(L, b); angle = Math.max(angle, m.angle); gap = m.gap === null || gap === null ? null : Math.max(gap, m.gap); }
      return { angle, gap, kind: [...new Set(Ls.map((L) => L.kind))].join('+') };
    };
    const tools = [
      { name: 'batiment-sur', sel: 'building', cursor: 'on' },
      { name: 'batiment-loin', sel: 'building', cursor: 'far' },
      { name: 'routes', sel: 'road', cursor: 'on' },
      { name: 'terrain', sel: 'terraform', cursor: 'on' },
      { name: 'zones', sel: 'zones', cursor: 'ref' },
    ];
    // Bâtiment de référence (vue rasante) : un bâtiment de 2e/3e rangée de la rue en biais.
    const dg = at.dg, T = [dg[2] - dg[0], dg[3] - dg[1]], Lg = Math.hypot(...T);
    const along = (b) => { const t = ((b.x - dg[0]) * T[0] + (b.z - dg[1]) * T[1]) / Lg; const n = Math.abs(((b.x - dg[0]) * -T[1] + (b.z - dg[1]) * T[0]) / Lg); return { t, n }; };
    const interior = blds.filter((b) => { const g = along(b); return g.t > 20 && g.t < Lg - 20 && g.n > 22 && g.n < 45; });
    const ref = interior[0] ?? blds[0];
    report.ref = ref && { id: ref.id, x: ref.x, z: ref.z, n: along(ref).n };
    const views = [
      ['rasante', ref.x, ref.z, 38, 0.32, 0.6],
      ['dessus', ref.x, ref.z, 90, 1.45, 0],
    ];
    for (const t of tools) {
      // Ouvrir l'outil.
      await page.evaluate(() => document.getElementById('main-menu')?.classList.add('hidden'));
      await page.evaluate(([x, z]) => window.__aube.lookAt(x, z, 200, 0.95, 0), [ref.x, ref.z]);
      await render(2);
      if (t.sel === 'zones') await page.click('#toolbar button[data-cat=zones]');
      else if (t.sel === 'terraform') await page.click('#toolbar button[data-cat="terrain"]');
      else await page.click(`#toolbar button[data-tool=${t.sel}]`);
      await page.waitForTimeout(500);
      if (t.sel === 'building') {
        const card = await page.evaluate(() => {
          const c = [...document.querySelectorAll('#drawer-body .card[data-asset]')].map((e) => e.dataset.asset);
          return c.find((id) => /maison_ville|townhouse|immeuble|commerce/.test(id)) ?? c[0];
        });
        await page.click(`#drawer-body .card[data-asset="${card}"]`);
      }
      const rows = [];
      let cursorAt = null;
      if (t.cursor === 'on') {
        // Curseur sur chaque bâtiment (comme le joueur qui survole le quartier) : lignes à l'emplacement du bâtiment.
        for (let k = 0; k < blds.length; k += 24) {
          const chunk = blds.slice(k, k + 24);
          const res = [];
          for (const b of chunk) {
            await page.evaluate(([x, z]) => window.__aube.lookAt(x, z, 200, 0.95, 0), [b.x, b.z]);
            const p = await screen(b.x, b.z);
            await page.mouse.move(p.x + 3, p.y + 3); await page.mouse.move(p.x, p.y);
            await render(1);
            res.push(await linesAt(b.pts, t.sel === 'zones'));
          }
          chunk.forEach((b, i) => rows.push({ id: b.id, ...worst(res[i], b) }));
        }
      } else if (t.cursor === 'ref') {
        // Outils où la trame ne dépend pas de la position du curseur : curseur sur le bâtiment de référence.
        await page.evaluate(([x, z]) => window.__aube.lookAt(x, z, 200, 0.95, 0), [ref.x, ref.z]);
        const p = await screen(ref.x, ref.z);
        await page.mouse.move(p.x + 3, p.y + 3); await page.mouse.move(p.x, p.y); await render(1);
        cursorAt = [ref.x, ref.z];
        const res = await linesAt(blds.flatMap((b) => b.pts), t.sel === 'zones');
        blds.forEach((b, i) => rows.push({ id: b.id, ...worst(res.slice(5 * i, 5 * i + 5), b) }));
      } else {
        // Curseur loin de la route (≈ 45 m de son bord), dans le quartier : tous les bâtiments avec la trame affichée.
        const fx = ref.x + (ref.x - (dg[0] + T[0] / Lg * along(ref).t)) / along(ref).n * 20, fz = ref.z + (ref.z - (dg[1] + T[1] / Lg * along(ref).t)) / along(ref).n * 20;
        await page.evaluate(([x, z]) => window.__aube.lookAt(x, z, 200, 0.95, 0), [fx, fz]);
        const p = await screen(fx, fz);
        await page.mouse.move(p.x + 3, p.y + 3); await page.mouse.move(p.x, p.y); await render(1);
        cursorAt = [fx, fz];
        const res = await linesAt(blds.flatMap((b) => b.pts), false);
        blds.forEach((b, i) => rows.push({ id: b.id, ...worst(res.slice(5 * i, 5 * i + 5), b) }));
      }
      // Quadrillage visible à 220 m du curseur au plus (estompé au-delà) : bâtiments plus loin non comptés.
      const seen = cursorAt ? rows.filter((r) => { const b = blds.find((q) => q.id === r.id); return Math.hypot(b.x - cursorAt[0], b.z - cursorAt[1]) <= 200; }) : rows;
      const hidden = rows.length - seen.length;
      rows.length = 0; rows.push(...seen);
      const ok = rows.filter((r) => r.gap !== null && r.gap <= 0.1).length;
      const angles = rows.map((r) => r.angle);
      const gaps = rows.filter((r) => r.gap !== null).map((r) => r.gap);
      report.tools[t.name] = {
        buildings: rows.length, horsVue: hidden, aligned: ok, alignedPct: +(100 * ok / Math.max(1, rows.length)).toFixed(1),
        angleMax: Math.max(0, ...angles), angleMean: +(angles.reduce((s, v) => s + v, 0) / Math.max(1, angles.length)).toFixed(2),
        gapMax: gaps.length ? Math.max(...gaps) : null, biais: rows.filter((r) => r.gap === null).length, rows,
      };
      console.log(t.name, JSON.stringify({ ...report.tools[t.name], rows: undefined }));
      // Captures (vue rasante proche comme celle du joueur, et vue de dessus), curseur sur le bâtiment de référence.
      for (const [vn, x, z, dist, pitch, yaw] of views) {
        await page.evaluate(([a, b, d, p, y]) => window.__aube.lookAt(a, b, d, p, y), [x, z, dist, pitch, yaw]);
        await render(2, 0.2);
        const p = await screen(x + 3, z + 3);
        await page.mouse.move(p.x, p.y); await page.waitForTimeout(250);
        await render(1, 0.2);
        await page.evaluate(() => window.__aube.gridFieldFlush?.());
        await render(2, 0.2); await page.waitForTimeout(700); await render(2, 0.2);
        await page.screenshot({ path: join(out, `partout-${t.name}-${vn}-${suffix}.png`) });
      }
    }
    writeFileSync(join(out, `partout-mesures-${suffix}.json`), JSON.stringify(report, null, 1));
    const errs = errors.filter((e) => !/favicon/.test(e));
    if (errs.length) console.log('Erreurs de page :', errs.slice(0, 10));
  } else {
    throw new Error('mode : fabriquer | mesurer');
  }
} finally {
  await browser.close();
  server.close();
}
