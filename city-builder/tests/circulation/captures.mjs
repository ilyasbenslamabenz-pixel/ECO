/**
 * Captures de contrôle du module circulation (node tests/circulation/captures.mjs, après npm run build).
 * Ville de charge (?stress) avec 2 000 véhicules, rendu logiciel (SwiftShader), images à la demande.
 *  1. circ-carrefour.png : vue aérienne rapprochée du carrefour à feux le plus chargé ;
 *  2. circ-voies.png     : vue rue derrière un véhicule en plein changement de voie (route à plusieurs voies) ;
 *  3. circ-congestion.png : carte de congestion (commande `afficherCongestion`) sur la ville.
 * Rapport : tests/e2e/out/circ-captures.json (statistiques du module, véhicules repérés).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectErrors, launch, root, serve } from '../e2e/lib.mjs';

const out = join(root, 'tests/e2e/out');
mkdirSync(out, { recursive: true });
const { server, base } = await serve();
const browser = await launch();
const report = {};
const nV = Number(process.argv.find((a) => a.startsWith('--v='))?.slice(4) ?? 2000);
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const errors = collectErrors(page);
  await page.goto(`${base}/index.html?stress&norender&n=300&v=${nV}`, { timeout: 600000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__aube?.demoReady === true || (window.__aube?.errors?.length ?? 0) > 0, null, { timeout: 1800000, polling: 2000 });
  const send = (name, args) => page.evaluate(([n, a]) => window.__aube.send(n, a), [name, args]);
  const cmd = (name, payload = {}) => send('pluginCommand', { plugin: 'circulation', name, payload });
  await page.evaluate(() => { window.__aube.trackVehicles = true; });
  await send('setSpeed', { speed: 4 });
  await page.waitForTimeout(45000); // files d'attente qui se forment
  report.statsBefore = await cmd('stats');
  console.log('stats', JSON.stringify(report.statsBefore));

  const shoot = async (file) => {
    await page.evaluate(() => window.__aube.renderNow(2, 0.5));
    await page.waitForTimeout(5000);
    await page.evaluate(() => window.__aube.renderNow(2, 0.1));
    await page.screenshot({ path: join(out, file), timeout: 900000 });
    console.log('capture', file);
  };

  // 1. changement de voie : déplacement latéral entre deux trames
  let lc = null;
  for (let k = 0; k < 40 && !lc; k++) {
    const a = await page.evaluate(() => window.__aube.lastVehicles);
    await page.waitForTimeout(400);
    const b = await page.evaluate(() => window.__aube.lastVehicles);
    if (!a || !b || a.tick === b.tick) continue;
    const prev = new Map(a.ids.map((id, i) => [id, i]));
    let best = null;
    for (let j = 0; j < b.ids.length; j++) {
      const i = prev.get(b.ids[j]); if (i === undefined) continue;
      const h = b.positions[j * 4 + 3], fx = Math.sin(h), fz = Math.cos(h);
      const dx = b.positions[j * 4] - a.positions[i * 4], dz = b.positions[j * 4 + 2] - a.positions[i * 4 + 2];
      const fwd = dx * fx + dz * fz, lat = Math.abs(dx * fz - dz * fx);
      const dh = Math.abs(Math.atan2(Math.sin(h - a.positions[i * 4 + 3]), Math.cos(h - a.positions[i * 4 + 3])));
      if (fwd > 1 && lat > 0.12 && lat < 1.5 && dh < 0.03 && (!best || lat > best.lat)) best = { id: b.ids[j], lat, fwd, x: b.positions[j * 4], z: b.positions[j * 4 + 2], h };
    }
    if (best) {
      await send('setSpeed', { speed: 0 });
      await page.waitForTimeout(500);
      const c = await page.evaluate(() => window.__aube.lastVehicles);
      const j = c.ids.indexOf(best.id);
      if (j >= 0) lc = { ...best, x: c.positions[j * 4], z: c.positions[j * 4 + 2], h: c.positions[j * 4 + 3] };
      else await send('setSpeed', { speed: 4 });
    }
  }
  report.laneChange = lc;
  console.log('changement de voie', JSON.stringify(lc));
  if (lc) {
    const fx = Math.sin(lc.h), fz = Math.cos(lc.h);
    await page.evaluate(([x, z, lx, lz]) => window.__aube.streetLook(x, z, lx, lz), [lc.x - fx * 13, lc.z - fz * 13, lc.x + fx * 10, lc.z + fz * 10]);
    await shoot('circ-voies.png');
    // clignotants (≈ 1,5 Hz) : seconde image décalée d'une demi-période
    await page.waitForTimeout(330);
    await page.evaluate(() => window.__aube.renderNow(1, 0.01));
    await page.screenshot({ path: join(out, 'circ-voies-b.png'), timeout: 900000 });
    await page.evaluate(([x, z, yaw]) => window.__aube.lookAt(x, z, 45, 0.9, yaw), [lc.x, lc.z, lc.h + Math.PI]);
    await shoot('circ-voies-aerien.png');
  }

  // 2. carrefour à feux le plus chargé
  const sig = await page.evaluate(() => window.__aube.signals());
  const veh = await page.evaluate(() => window.__aube.lastVehicles);
  const nodes = new Map();
  for (const a of sig.arms) { const n = nodes.get(a.node) ?? { x: 0, z: 0, k: 0 }; n.x += a.x; n.z += a.z; n.k++; nodes.set(a.node, n); }
  let bestN = null;
  for (const [id, n] of nodes) {
    const x = n.x / n.k, z = n.z / n.k;
    let cnt = 0;
    for (let j = 0; j < veh.ids.length; j++) if (Math.hypot(veh.positions[j * 4] - x, veh.positions[j * 4 + 2] - z) < 45) cnt++;
    if (!bestN || cnt > bestN.cnt) bestN = { id, x, z, cnt, arms: n.k };
  }
  report.junction = bestN;
  console.log('carrefour', JSON.stringify(bestN));
  if (bestN) {
    await page.evaluate(([x, z]) => window.__aube.lookAt(x, z, 80, 0.95, 0.6), [bestN.x, bestN.z]);
    await shoot('circ-carrefour.png');
  }

  // 3. carte de congestion
  report.overlay = await cmd('afficherCongestion', { on: true });
  await send('setSpeed', { speed: 1 });
  await page.waitForTimeout(3000);
  await send('setSpeed', { speed: 0 });
  await page.waitForTimeout(800);
  const cx = bestN ? bestN.x : 0, cz = bestN ? bestN.z : 0;
  await page.evaluate(([x, z]) => window.__aube.lookAt(x, z, 650, 1.15, 0.3), [cx, cz]);
  await shoot('circ-congestion.png');
  await page.evaluate(([x, z]) => window.__aube.lookAt(x, z, 220, 1.0, 0.3), [cx, cz]);
  await shoot('circ-congestion-proche.png');
  report.congestionLevels = await page.evaluate(async () => {
    const r = await window.__aube.send('pluginCommand', { plugin: 'circulation', name: 'congestion', payload: {} });
    const lv = Object.values(r.data?.level ?? r.level ?? {});
    const h = [0, 0, 0, 0, 0, 0];
    for (const x of lv) h[Math.min(5, x)]++;
    return { tronçons: lv.length, histogrammeNiveaux: h };
  });
  console.log('congestion', JSON.stringify(report.congestionLevels));
  report.statsAfter = await cmd('stats');
  report.errors = errors;
  console.log('erreurs de page', errors.length, errors.slice(0, 3));
} catch (e) {
  console.error(e);
  report.exception = String(e);
  process.exitCode = 1;
} finally {
  writeFileSync(join(out, 'circ-captures.json'), JSON.stringify(report, null, 2));
  await browser.close();
  server.close();
}
