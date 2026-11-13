/**
 * Captures « routes et relief » (après npm run build) : plage, bord de rivière, colline, viaduc, tunnel, rond-point.
 * Partie neuve (graine fixe), routes construites par la vraie commande buildRoad, images rendues à la demande.
 * Usage : node tests/e2e/routes-relief.mjs [préfixe=apres] [vues=plage,riviere,...]
 * Sorties : docs/captures-routes-relief/<préfixe>-<vue>.jpg + <préfixe>-rapport.json.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { collectErrors, launch, root, serve } from './lib.mjs';

const PREFIX = process.argv[2] ?? 'apres';
const ONLY = process.argv[3] ? process.argv[3].split(',') : null;
const SEED = Number(process.env.SEED ?? 7);
const out = join(root, 'docs/captures-routes-relief');
mkdirSync(out, { recursive: true });
const report = { seed: SEED, views: [], builds: [] };
const { server, base } = await serve();
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1100, height: 700 } });
const page = await ctx.newPage();
const errors = collectErrors(page);
let failed = false;
try {
  await page.goto(`${base}/index.html?autostart&norender&seed=${SEED}&h=11`, { timeout: 600000 });
  await page.waitForFunction(() => window.__aube?.snapshotReceived === true, null, { timeout: 600000, polling: 500 });
  await page.evaluate(() => window.__aube.send('setSpeed', { speed: 0 }));
  await page.waitForTimeout(1500);

  const H = (x, z) => page.evaluate(([a, b]) => window.__aube.heightAt(a, b), [x, z]);
  /** Construit une route ; renvoie le résultat (ok / erreur). */
  const build = async (label, points, extra = {}) => {
    const r = await page.evaluate(async ([p, e]) => {
      try { const res = await window.__aube.send('buildRoad', { type: e.kind === 'avenue' ? 'avenue' : 'street', kind: e.kind ?? 'street', points: p, ...e }); return { ok: true, data: res }; }
      catch (err) { return { ok: false, message: String(err?.error?.message ?? err?.message ?? err) }; }
    }, [points, extra]);
    report.builds.push({ label, points, extra, ...r });
    console.log(`${r.ok ? 'OK   ' : 'REFUS'} ${label} ${r.ok ? '' : r.message}`);
    await page.waitForTimeout(600);
    return r;
  };
  const shoot = async (name, x, z, dist, pitch, yaw, noVeg = false) => {
    await page.evaluate((v) => window.__aube.setLayerVisible('vegetation', v), !noVeg);
    await page.evaluate(([a, b, d, p, y]) => window.__aube.lookAt(a, b, d, p, y), [x, z, dist, pitch, yaw]);
    await page.evaluate(() => window.__aube.renderNow(2, 0.5));
    await page.waitForTimeout(3500);
    await page.evaluate(() => window.__aube.renderNow(2, 0.1));
    const file = `${PREFIX}-${name}.jpg`;
    const buf = await page.screenshot({ timeout: 900000 });
    await sharp(buf).jpeg({ quality: 82 }).toFile(join(out, file));
    report.views.push({ name, file, x, z, dist, pitch, yaw });
    console.log(`capture ${file}`);
  };
  // Échantillonnage du terrain (rendu) : grille de 16 m.
  const grid = await page.evaluate(() => {
    const res = [];
    for (let z = -960; z <= 960; z += 16) for (let x = -960; x <= 960; x += 16) res.push([x, z, window.__aube.heightAt(x, z)]);
    return res;
  });
  const at = new Map(grid.map(([x, z, h]) => [`${x},${z}`, h]));
  const g = (x, z) => at.get(`${x},${z}`);
  const want = (v) => !ONLY || ONLY.includes(v);

  // Plage : point sec bas (2,3–3,4 m) avec la mer à 48 m d'un côté et du sec de l'autre ; route parallèle au rivage.
  if (want('plage')) {
    let best = null;
    for (const [x, z, h] of grid) {
      if (h < 2.3 || h > 3.4 || Math.abs(x) > 760 || Math.abs(z) > 760) continue;
      for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        const sea = g(x + dx * 48, z + dz * 48), land = g(x - dx * 32, z - dz * 32);
        if (sea === undefined || land === undefined || sea > 1.2 || land < 2.5) continue;
        const a = g(x + dz * 64, z - dx * 64), b = g(x - dz * 64, z + dx * 64);
        if (a === undefined || b === undefined || a < 2.3 || b < 2.3 || a > 5 || b > 5) continue;
        const score = Math.abs(h - 2.8);
        if (!best || score < best.score) best = { x, z, dx, dz, score };
      }
    }
    report.plage = best;
    if (best) {
      const { x, z, dx, dz } = best;
      await build('plage : rue le long du rivage', [x + dz * 64, z - dx * 64, x - dz * 64, z + dx * 64]);
      // Quai : rue au ras de l'eau (le pied du talus tomberait dans la mer : mur).
      // Rue de quai : le long du rivage, à quelques mètres de l'eau (extrémités au sec), plus loin sur la côte.
      let quai = null;
      for (const along of [170, -170, 260, -260, 120, -120]) {
        const ox = x - dz * along, oz = z + dx * along;
        let q = 0;
        for (let d = -30; d < 70; d += 2) { if ((await H(ox + dx * d, oz + dz * d)) < 2.1) { q = d; break; } }
        if (!q) continue;
        const qx = ox + dx * (q - 10), qz = oz + dz * (q - 10);
        const ends = [[qx + dz * 40, qz - dx * 40], [qx - dz * 40, qz + dx * 40]];
        if ((await H(ends[0][0], ends[0][1])) < 2.6 || (await H(ends[1][0], ends[1][1])) < 2.6) continue;
        const r = await build('plage : rue de quai au ras de l\'eau', [...ends[0], ...ends[1]]);
        if (r.ok) { quai = { qx, qz }; break; }
      }
      const qx = quai?.qx ?? x, qz = quai?.qz ?? z;
      await shoot('plage', x, z, 95, 0.42, Math.atan2(-dx, -dz) + 0.5);
      await shoot('plage-quai', qx, qz, 60, 0.32, Math.atan2(-dx, -dz) + 0.7);
    }
  }
  // Bord de rivière : rue parallèle à un bloc de rivière, puis rue qui la traverse (pont).
  if (want('riviere')) {
    const blocks = await page.evaluate(() => window.__aube.riverBlocks());
    let done = false;
    for (const bl of blocks.sort((p, q) => q.tris - p.tris)) {
      const cx = Math.round(bl.x / 16) * 16, cz = Math.round(bl.z / 16) * 16;
      if (Math.abs(cx) > 760 || Math.abs(cz) > 760) continue;
      // direction de la rivière : direction de plus faible variation de hauteur autour du centre
      let bestDir = null;
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 8, ux = Math.cos(a), uz = Math.sin(a);
        let s = 0;
        for (const d of [-40, -20, 20, 40]) s += Math.abs((await H(cx + ux * d, cz + uz * d)) - (await H(cx, cz)));
        if (!bestDir || s < bestDir.s) bestDir = { ux, uz, s };
      }
      const { ux, uz } = bestDir;
      const nx = -uz, nz = ux;
      // berge : premier point sec à partir du centre, côté +n
      let off = 0;
      for (let d = 6; d < 80; d += 2) { if ((await H(cx + nx * d, cz + nz * d)) > 3.6) { off = d; break; } }
      if (!off) continue;
      let off2 = 0;
      for (let d = 6; d < 80; d += 2) { if ((await H(cx - nx * d, cz - nz * d)) > 3.6) { off2 = d; break; } }
      if (!off2) continue;
      const bx = cx + nx * (off + 8), bz = cz + nz * (off + 8);
      const r1 = await build('rivière : rue sur la berge', [bx - ux * 70, bz - uz * 70, bx + ux * 70, bz + uz * 70]);
      const r2 = await build('rivière : rue qui traverse (pont)', [cx + nx * (off + 55) + ux * 60, cz + nz * (off + 55) + uz * 60, cx - nx * (off2 + 45) + ux * 60, cz - nz * (off2 + 45) + uz * 60]);
      report.riviere = { cx, cz, ux, uz, off, off2 };
      if (r1.ok || r2.ok) {
        await shoot('riviere', cx + ux * 30, cz + uz * 30, 130, 0.5, Math.atan2(nx, nz) + 0.6);
        if (r2.ok) {
          const mx = cx + ux * 60 + nx * (off - off2) / 2, mz = cz + uz * 60 + nz * (off - off2) / 2;
          await shoot('riviere-pont', mx, mz, 70, 0.3, Math.atan2(ux, uz) + 0.5, true);
        }
        done = true; break;
      }
    }
    if (!done) console.log('rivière : aucun site trouvé');
  }
  // Colline : rue en travers d'une pente moyenne (déblai d'un côté, remblai de l'autre).
  if (want('colline')) {
    let best = null;
    for (const [x, z, h] of grid) {
      if (h < 12 || Math.abs(x) > 700 || Math.abs(z) > 700) continue;
      const gx = (g(x + 16, z) - g(x - 16, z)) / 32, gz = (g(x, z + 16) - g(x, z - 16)) / 32;
      if (!Number.isFinite(gx + gz)) continue;
      const slope = Math.hypot(gx, gz);
      if (slope < 0.18 || slope > 0.35) continue;
      const score = Math.abs(slope - 0.25);
      if (!best || score < best.score) best = { x, z, gx, gz, score, h };
    }
    report.colline = best;
    if (best) {
      const l = Math.hypot(best.gx, best.gz), tx = -best.gz / l, tz = best.gx / l;
      await build('colline : rue à flanc de coteau', [best.x - tx * 70, best.z - tz * 70, best.x + tx * 70, best.z + tz * 70]);
      await shoot('colline', best.x, best.z, 100, 0.38, Math.atan2(best.gx, best.gz) + Math.PI + 0.5, true);
    }
  }
  // Terrain plat pour viaduc et rond-point.
  const flat = (minH, skip) => {
    let best = null;
    for (const [x, z, h] of grid) {
      if (h < minH || Math.abs(x) > 600 || Math.abs(z) > 600) continue;
      if (skip && skip.some((p) => Math.hypot(p.x - x, p.z - z) < 260)) continue;
      let ok = true, v = 0;
      for (let dz = -96; dz <= 96 && ok; dz += 32) for (let dx = -96; dx <= 96; dx += 32) { const q = g(x + dx, z + dz); if (q === undefined || q < 3) { ok = false; break; } v = Math.max(v, Math.abs(q - h)); }
      if (!ok) continue;
      if (!best || v < best.v) best = { x, z, v };
    }
    return best;
  };
  const used = [report.plage, report.colline, report.riviere && { x: report.riviere.cx, z: report.riviere.cz }].filter(Boolean);
  if (want('viaduc')) {
    const f = flat(3.5, used);
    report.viaduc = f;
    if (f) {
      used.push(f);
      await build('viaduc : rue au sol', [f.x - 90, f.z, f.x + 90, f.z]);
      const r = await build('viaduc : rue +8 m au-dessus', [f.x, f.z - 110, f.x, f.z + 110], { elevation: 8 });
      if (!r.ok) await build('viaduc (repli sans hauteur)', [f.x + 0.1, f.z - 110, f.x + 0.1, f.z + 110]);
      await shoot('viaduc', f.x, f.z, 110, 0.42, 0.7);
    }
  }
  // Interface : outil Routes, ▲ ▲ (+8 m), aperçu 3D du tracé renvoyé par la simulation.
  if (want('apercu') && report.viaduc) {
    const f = report.viaduc;
    await page.click('#toolbar button[data-tool=road]');
    await page.waitForTimeout(500);
    const card = page.locator('[data-road=street]');
    if (await card.count()) await card.first().click();
    await page.waitForTimeout(300);
    const up = page.locator('#tool-actions button', { hasText: '▲' });
    await up.click(); await up.click();
    const hint = await page.locator('.tool-hint').textContent().catch(() => '');
    report.ui = { hint, label: await page.locator('#tool-actions').textContent() };
    console.log('interface', JSON.stringify(report.ui));
    await page.evaluate(([x, z]) => window.__aube.lookAt(x, z, 160, 0.6, 0.7), [f.x + 50, f.z]);
    await page.evaluate(() => window.__aube.renderNow(1, 0.1));
    const a = await page.evaluate(([x, z]) => window.__aube.worldToScreen(x, z), [f.x + 50, f.z - 70]);
    const b = await page.evaluate(([x, z]) => window.__aube.worldToScreen(x, z), [f.x + 50, f.z + 70]);
    await page.mouse.move(a.x, a.y); await page.mouse.click(a.x, a.y);
    await page.mouse.move(b.x, b.y, { steps: 4 });
    await page.waitForTimeout(2500);
    report.ui.preview = await page.evaluate(() => window.__aube.toolPreview());
    console.log('aperçu', JSON.stringify(report.ui.preview));
    await page.evaluate(() => window.__aube.renderNow(2, 0.1));
    const buf = await page.screenshot({ timeout: 900000 });
    await sharp(buf).jpeg({ quality: 82 }).toFile(join(out, `${PREFIX}-apercu-hauteur.jpg`));
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  }
  if (want('tunnel')) {
    // Colline marquée : point haut entouré de terrain plus bas à ±100 m.
    let best = null;
    for (const [x, z, h] of grid) {
      if (Math.abs(x) > 760 || Math.abs(z) > 760 || h < 12) continue;
      if (used.some((p) => Math.hypot(p.x - x, p.z - z) < 200)) continue;
      for (const [dx, dz] of [[1, 0], [0, 1]]) {
        const a = g(x - dx * 112, z - dz * 112), b = g(x + dx * 112, z + dz * 112);
        if (a === undefined || b === undefined || a < 3.5 || b < 3.5) continue;
        const prom = h - Math.max(a, b);
        if (prom < 8) continue;
        const score = prom - Math.abs(a - b) * 0.5;
        if (!best || score > best.score) best = { x, z, dx, dz, prom, score };
      }
    }
    report.tunnel = best;
    if (best) {
      const { x, z, dx, dz } = best;
      let r = await build('tunnel : rue −16 m sous la colline', [x - dx * 110, z - dz * 110, x + dx * 110, z + dz * 110], { elevation: -16 });
      if (!r.ok) r = await build('tunnel : rue −8 m sous la colline', [x - dx * 110, z - dz * 110, x + dx * 110, z + dz * 110], { elevation: -8 });
      const rep = await page.evaluate(async () => (await window.__aube.send('save', { slot: 'rr' })).data.roads.edges.filter((e) => e.tunnelRuns).map((e) => ({ id: e.id, runs: e.tunnelRuns, n: e.profile.length })));
      report.tunnelEdges = rep;
      console.log('tunnels', JSON.stringify(rep));
      await shoot('tunnel', x - dx * 85, z - dz * 85, 75, 0.35, Math.atan2(dx, dz) + Math.PI + 0.5, true);
      await shoot('tunnel-sortie', x + dx * 85, z + dz * 85, 75, 0.35, Math.atan2(dx, dz) + 0.5, true);
    }
  }
  if (want('rondpoint')) {
    const f = flat(3.5, used);
    report.rondpoint = f;
    if (f) {
      await build('rond-point : rue est-ouest', [f.x - 90, f.z, f.x + 90, f.z]);
      await build('rond-point : rue nord-sud', [f.x, f.z - 90, f.x, f.z + 90]);
      const r = await page.evaluate(async ([x, z]) => {
        try { return { ok: true, data: await window.__aube.send('buildRoundabout', { x, z, size: 'small' }) }; }
        catch (err) { return { ok: false, message: String(err?.error?.message ?? err?.message ?? err) }; }
      }, [f.x, f.z]);
      console.log('rond-point', JSON.stringify(r).slice(0, 200));
      report.builds.push({ label: 'rond-point', ...r });
      await page.waitForTimeout(800);
      await shoot('rondpoint', f.x, f.z, 95, 0.75, 0.4);
    }
  }
  report.errors = errors;
} catch (e) {
  console.error(e);
  failed = true;
} finally {
  writeFileSync(join(out, `${PREFIX}-rapport.json`), JSON.stringify(report, null, 2));
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
