/**
 * Tracé de route vs quadrillage affiché (retour joueur « le tracé n'est pas au milieu du quadrillage », outil Routes,
 * aperçu d'un tracé de 56 m vu dans l'axe).
 *
 *   node tests/e2e/trace-grille.mjs <suffixe> [dist]
 *
 * Partie neuve (graine 7, sans rivière), une rue est-ouest existante en z = Z0 + 3 (hors axes du monde). Cas :
 * tracé en terrain libre (rue, avenue, boulevard), parallèle à la rue existante, perpendiculaire depuis la rue
 * (départ accroché au tronçon). Le curseur suit les points « joueur » (légèrement en biais, hors trame) ; pour chaque
 * aperçu on mesure, avec les lignes AFFICHÉES (`__aube.gridLinesAt`) :
 *  - angle (°) entre le tracé et les lignes ;
 *  - écart (m) de la ligne des façades (demi-largeur + 0,6 m), des deux côtés, à la ligne parallèle la plus proche ;
 *  - écart (m) des extrémités du tracé aux lignes transversales ;
 *  - symétrie : différence des écarts gauche / droite (axe au milieu de la bande) ;
 * puis on pose la route et on compare les lignes affichées APRÈS la pose à celles affichées pendant l'aperçu
 * (même points : écart max des lignes, m). Captures docs/captures-trace/<cas>-{axe,dessus}-<suffixe>.png.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectErrors, launch, root, serve } from './lib.mjs';

const [suffix = 'apres', distDir] = process.argv.slice(2);
const out = join(root, 'docs/captures-trace');
mkdirSync(out, { recursive: true });
const HALF = { street: 6.2, avenue: 11.5, boulevard: 16.4 };
const mod = (a, m) => ((a % m) + m) % m;
const gap = (v) => { const m = mod(v, 8); return Math.min(m, 8 - m); };

const { server, base } = await serve(distDir);
const browser = await launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = collectErrors(page);
  await page.goto(`${base}/index.html?autostart&seed=7&norender`, { timeout: 300000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__aube?.ready && window.__aube.snapshotReceived, null, { timeout: 300000 });
  const send = (name, args) => page.evaluate(([n, a]) => window.__aube.send(n, a).then((r) => ({ ok: true, r }), (e) => ({ ok: false, e: e.message })), [name, args]);
  const render = (n = 2, dt = 1 / 30) => page.evaluate(([k, d]) => window.__aube.renderNow(k, d), [n, dt]);
  const ng = await send('newGame', { seed: 7, mapChunks: 8, startMoney: 50_000_000, cityName: 'Trace', startHour: 11, terrain: { hydrology: 'aucune', rivers: 0 } });
  if (!ng.ok) throw new Error(ng.e);
  await page.waitForTimeout(1500);
  await send('setSpeed', { speed: 0 });
  await page.evaluate(() => document.getElementById('main-menu')?.classList.add('hidden'));

  // Site plat : rue existante est-ouest (240 m) et place libre au nord pour les tracés.
  let site = null;
  for (let r = 0; r < 900 && !site; r += 40) {
    for (let a = 0; a < 8 && !site; a++) {
      const X = Math.round(Math.cos(a * 0.8) * r), Z = Math.round(Math.sin(a * 0.8) * r) + 3;
      const pts = [X - 120, Z, X + 120, Z];
      const probes = [[X - 30, Z + 45, X + 40, Z + 45], [X + 70, Z + 10, X + 70, Z + 70], [X - 80, Z + 160, X + 80, Z + 160], [X - 80, Z + 260, X + 80, Z + 260]];
      const dry = [await send('buildRoad', { type: 'street', points: pts, dryRun: true })];
      for (const p of probes) dry.push(await send('buildRoad', { type: 'street', kind: 'boulevard', points: p, dryRun: true }));
      if (!dry.every((d) => d.ok)) continue;
      if ((await send('buildRoad', { type: 'street', points: pts })).ok) site = { X, Z };
    }
  }
  if (!site) throw new Error('aucun site plat');
  const { X, Z } = site;
  await page.waitForTimeout(800);

  const deg = (d) => (d * Math.PI) / 180;
  const ray = (x, z, len, aDeg) => [x, z, x + len * Math.cos(deg(aDeg)), z + len * Math.sin(deg(aDeg))];
  const cases = [
    { name: 'libre-rue', type: 'street', pts: ray(X - 27.3, Z + 160.6, 56.4, 3) },
    { name: 'libre-avenue', type: 'avenue', pts: ray(X - 23.1, Z + 263.3, 56.7, -4) },
    { name: 'libre-boulevard', type: 'boulevard', pts: ray(X - 20.6, Z + 213.9, 56.2, 2) },
    { name: 'parallele-rue', type: 'street', pts: ray(X - 31.4, Z + 42.7, 56.3, 2.5) },
    { name: 'perpendiculaire-rue', type: 'street', pts: ray(X + 70.7, Z + 0.4, 56.2, 92) },
  ];
  const report = { suffix, site, cases: {} };
  for (const c of cases) {
    const half = HALF[c.type], off = half + 0.6;
    await page.evaluate(([t]) => window.__aube.setTool('road', { roadType: t }), [c.type]);
    await page.evaluate(([x, z]) => window.__aube.toolHover(x, z), [c.pts[0], c.pts[1]]);
    await page.evaluate(() => window.__aube.toolClick());
    await page.evaluate(([x, z]) => window.__aube.toolHover(x, z), [c.pts[2], c.pts[3]]);
    await page.waitForTimeout(200);
    const pv = await page.evaluate(() => window.__aube.toolPreview());
    if (!pv.points) { report.cases[c.name] = { erreur: 'pas d\'aperçu', pv }; continue; }
    const [ax, az] = pv.points, [bx, bz] = pv.points.slice(-2);
    const L = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / L, dz = (bz - az) / L, nx = -dz, nz = dx;
    const at = (t, s) => [ax + dx * L * t + nx * s, az + dz * L * t + nz * s];
    // Points de mesure : de part et d'autre, juste derrière la ligne des façades (première rangée de cases).
    const samples = [];
    for (const t of [0.25, 0.5, 0.75]) for (const side of [-1, 1]) samples.push({ t, side, p: at(t, side * (off + 1.5)) });
    const ends = [{ t: 0, p: at(0.02, off + 1.5) }, { t: 1, p: at(0.98, off + 1.5) }];
    const linesAt = (pts) => page.evaluate((pp) => { window.__aube.gridFieldFlush?.(); return pp.map(([x, z]) => window.__aube.gridLinesAt(x, z)); }, pts);
    const flush = async () => { await render(1); await page.evaluate(() => window.__aube.gridFieldFlush?.()); await render(1); };
    await flush();
    const Ls = await linesAt(samples.map((s) => s.p));
    const Le = await linesAt(ends.map((s) => s.p));
    /** Lignes parallèles / transversales au tracé dans la trame L : [phase, direction unitaire de la coordonnée]. */
    const fam = (Lx, para) => {
      const T = [Lx.tx, Lx.tz], N = [-Lx.tz, Lx.tx];
      // Coordonnée qui mesure la distance aux lignes PARALLÈLES au tracé : selon la normale du tracé.
      const want = para ? [nx, nz] : [dx, dz];
      const dT = T[0] * want[0] + T[1] * want[1], dN = N[0] * want[0] + N[1] * want[1];
      return Math.abs(dT) >= Math.abs(dN) ? { u: T, p: Lx.pu } : { u: N, p: Lx.pv };
    };
    const angleOf = (Lx) => { let a = mod(Math.atan2(dz, dx) - Math.atan2(Lx.tz, Lx.tx), Math.PI / 2); a = Math.min(a, Math.PI / 2 - a); return +(a * 180 / Math.PI).toFixed(2); };
    const rows = samples.map((s, i) => {
      const Lx = Ls[i], f = fam(Lx, true);
      const F = at(s.t, s.side * off), E = at(s.t, s.side * half);
      return { t: s.t, side: s.side, kind: Lx.kind, angle: angleOf(Lx), facade: +gap(F[0] * f.u[0] + F[1] * f.u[1] - f.p).toFixed(2), bord: +gap(E[0] * f.u[0] + E[1] * f.u[1] - f.p).toFixed(2) };
    });
    const endGap = ends.map((s, i) => { const f = fam(Le[i], false); const P = s.t ? [bx, bz] : [ax, az]; return +gap(P[0] * f.u[0] + P[1] * f.u[1] - f.p).toFixed(2); });
    const sym = [0.25, 0.5, 0.75].map((t) => { const l = rows.find((r) => r.t === t && r.side < 0), r = rows.find((q) => q.t === t && q.side > 0); return +Math.abs(l.facade - r.facade).toFixed(2); });
    // Captures : dans l'axe (comme le joueur) et de dessus.
    const mx = (ax + bx) / 2, mz = (az + bz) / 2, yaw = Math.atan2(dx, dz);
    const shots = [['axe', mx, mz, 62, 0.45, yaw], ['dessus', mx, mz, 95, 1.45, 0]];
    for (const [vn, x, z, d, p, y] of shots) {
      await page.evaluate(([a, b, dd, pp, yy]) => window.__aube.lookAt(a, b, dd, pp, yy), [x, z, d, p, y]);
      await page.evaluate(([x2, z2]) => window.__aube.toolHover(x2, z2), [c.pts[2], c.pts[3]]);
      await render(2, 0.2); await page.evaluate(() => window.__aube.gridFieldFlush?.()); await render(2, 0.2);
      await page.waitForTimeout(300); await render(1, 0.2);
      await page.screenshot({ path: join(out, `${c.name}-${vn}-${suffix}.png`) });
    }
    // Pose, puis lignes affichées aux mêmes points.
    await page.evaluate(([x2, z2]) => window.__aube.toolHover(x2, z2), [c.pts[2], c.pts[3]]);
    const before = await page.evaluate(() => window.__aube.constructionApplied());
    await page.evaluate(() => window.__aube.toolClick());
    await page.waitForFunction((n) => window.__aube.constructionApplied() > n, before, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(800);
    await page.evaluate(() => window.__aube.setTool('road', {}));
    await page.evaluate(([x2, z2]) => window.__aube.toolHover(x2, z2), [mx + nx * 90, mz + nz * 90]);
    await flush();
    const Lp = await linesAt(samples.map((s) => s.p));
    const coincide = samples.map((s, i) => {
      const a = Ls[i], b = Lp[i];
      const ang = angleOf(b) - angleOf(a);
      // Écart entre les deux familles : distance de la ligne la plus proche de P dans a à celle de b.
      let d = 0;
      for (const para of [true, false]) { const fa = fam(a, para), fb = fam(b, para); const P = s.p; const ca = mod(P[0] * fa.u[0] + P[1] * fa.u[1] - fa.p, 8), cb = mod(P[0] * fb.u[0] + P[1] * fb.u[1] - fb.p, 8); d = Math.max(d, gap(ca - cb)); }
      return { angle: +Math.abs(ang).toFixed(2), ecart: +d.toFixed(2) };
    });
    const r = {
      type: c.type, points: pv.points.map((v) => +v.toFixed(2)), longueur: +L.toFixed(2), accroche: [pv.start?.snap, pv.hover?.snap],
      angleMax: Math.max(...rows.map((q) => q.angle)), facadeMax: Math.max(...rows.map((q) => q.facade)), bordMax: Math.max(...rows.map((q) => q.bord)),
      extremites: endGap, symetrieMax: Math.max(...sym), apresPose: { angleMax: Math.max(...coincide.map((q) => q.angle)), ecartMax: Math.max(...coincide.map((q) => q.ecart)) }, rows,
    };
    report.cases[c.name] = r;
    console.log(c.name, JSON.stringify({ ...r, rows: undefined }));
  }
  writeFileSync(join(out, `mesures-${suffix}.json`), JSON.stringify(report, null, 1));
  const errs = errors.filter((e) => !/favicon/.test(e));
  if (errs.length) console.log('Erreurs de page :', errs.slice(0, 10));
} finally {
  await browser.close();
  server.close();
}
