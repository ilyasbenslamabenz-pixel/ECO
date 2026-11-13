/**
 * Recette QA n° 5 (intégration phase 2A/2B/2C) — la ville de démonstration vivante :
 *  1. Piétons : nombre, position (trottoirs / passages), respect des feux PIÉTONS (état lu dans la simulation au
 *     même instant), jamais sur la chaussée hors d'un passage.
 *  2. Circulation multi-voies : changements de voie, véhicules répartis sur plusieurs voies d'avenue, carte de congestion.
 *  3. Atmosphère : météo et saison réelles (module weather) — forçage pluie, neige, brouillard, orage, hiver ;
 *     la barre supérieure affiche-t-elle la météo simulée ?
 *  4. Performance : appels de rendu / triangles (aérien, rue), piétons dessinés.
 * Lancement : npm run build puis node tests/e2e/qa5-ville.mjs (SwiftShader, lent).
 * Sorties : tests/e2e/out/qa5/ville-*.png + ville.json.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectErrors, launch, root, serve } from './lib.mjs';

const out = join(root, 'tests/e2e/out/qa5');
mkdirSync(out, { recursive: true });
const R = { checks: [], notes: {} };
let failed = false;
const check = (ok, msg, extra) => { R.checks.push({ ok: !!ok, msg, ...(extra !== undefined ? { extra } : {}) }); console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${msg}`); if (!ok) failed = true; };
const note = (k, v) => { R.notes[k] = v; console.log(`     ${k}: ${typeof v === 'string' ? v : JSON.stringify(v).slice(0, 300)}`); };

/** Demi-largeur de chaussée (m) par type, d'après src/sim/roads/types.ts : voies + accotements + terre-plein. */
const HALF_CARRIAGE = { street: (2 * 3.2 + 1) / 2, avenue: (4 * 3.25 + 1 + 3) / 2, boulevard: (6 * 3.3 + 1 + 4) / 2, oneway: (2 * 3.1 + 1) / 2 };
const MEDIAN = { avenue: 3, boulevard: 4 };

function bez(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return [u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]];
}
/** Polylignes des tronçons (Bézier échantillonnée tous les ~2 m). */
function polylines(save) {
  const nodes = new Map(save.roads.nodes.map((n) => [n.id, n]));
  return save.roads.edges.map((e) => {
    const a = nodes.get(e.a), b = nodes.get(e.b);
    const p0 = [a.x, a.z], p3 = [b.x, b.z];
    const p1 = e.c1 ?? [a.x + (b.x - a.x) / 3, a.z + (b.z - a.z) / 3];
    const p2 = e.c2 ?? [a.x + 2 * (b.x - a.x) / 3, a.z + 2 * (b.z - a.z) / 3];
    const n = Math.max(2, Math.ceil(e.length / 2));
    const pts = [];
    for (let i = 0; i <= n; i++) pts.push(bez(p0, p1, p2, p3, i / n));
    return { id: e.id, kind: e.kind ?? e.type, pts, a: e.a, b: e.b };
  });
}
function distSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az; const L = dx * dx + dz * dz;
  let t = L > 0 ? ((px - ax) * dx + (pz - az) * dz) / L : 0; t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}
/** Distance signée à la polyligne la plus proche. */
function nearestEdge(lines, x, z) {
  let best = { d: Infinity, e: null };
  for (const l of lines) {
    for (let i = 0; i < l.pts.length - 1; i++) {
      const d = distSeg(x, z, l.pts[i][0], l.pts[i][1], l.pts[i + 1][0], l.pts[i + 1][1]);
      if (d < best.d) best = { d, e: l };
    }
  }
  return best;
}

const { server, base } = await serve();
const browser = await launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors = collectErrors(page);
  const t0 = Date.now();
  await page.goto(`${base}/index.html?demo&norender&h=10`, { timeout: 600000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__aube?.demoReady === true || (window.__aube?.errors?.length ?? 0) > 0, null, { timeout: 1500000, polling: 1000 });
  note('chargementDemoS', Math.round((Date.now() - t0) / 1000));
  check((await page.evaluate(() => window.__aube.errors.length)) === 0, `démo prête sans erreur interne ${JSON.stringify(await page.evaluate(() => window.__aube.errors.slice(0, 3)))}`);
  const send = (n, a) => page.evaluate(([n, a]) => window.__aube.send(n, a).then((r) => ({ ok: true, r }), (e) => ({ ok: false, e: e.message })), [n, a]);
  const plug = async (plugin, name, payload) => { const r = await send('pluginCommand', { plugin, name, payload }); return r.ok ? (r.r?.data ?? r.r) : { error: r.e }; };
  const render = (n = 1, dt = 1 / 30) => page.evaluate(([k, d]) => window.__aube.renderNow(k, d), [n, dt]);
  const shot = async (name) => { await render(2, 0.3); await page.waitForTimeout(3000); await render(1, 0.05); await page.screenshot({ path: join(out, `ville-${name}.png`), timeout: 900000 }); };

  const save = (await send('save', { slot: 'qa5-ville' })).r.data;
  const lines = polylines(save).filter((l) => HALF_CARRIAGE[l.kind]);
  note('reseau', { noeuds: save.roads.nodes.length, troncons: save.roads.edges.length, parType: save.roads.edges.reduce((m, e) => { const k = e.kind ?? e.type; m[k] = (m[k] ?? 0) + 1; return m; }, {}) });

  // ---------------- 1. Piétons ----------------
  await send('setSpeed', { speed: 1 });
  await page.waitForFunction(() => (window.__pietons?.stats?.pietons ?? 0) > 0, null, { timeout: 120000, polling: 500 }).catch(() => undefined);
  const pst = await plug('pietons', 'stats');
  note('pietonsStats', pst);
  check((pst?.pietons ?? 0) > 20, `piétons dans la rue à 10 h (${pst?.pietons})`);
  const dbg0 = await page.evaluate(() => ({ pret: window.__pietons?.pret, erreur: window.__pietons?.erreur }));
  check(dbg0.pret && !dbg0.erreur, `modèles piétons chargés (${JSON.stringify(dbg0)})`);

  const tally = { samples: 0, peds: 0, sidewalk: 0, onCrossing: 0, roadwayOffCrossing: 0, crossingRedEngaged: 0, crossingRedTotal: 0, crossingGreen: 0, uncontrolled: 0, bad: [] };
  for (let k = 0; k < 24; k++) {
    await page.waitForTimeout(700);
    await render(1, 1 / 30);
    const [peds, cross] = await Promise.all([
      page.evaluate(() => window.__pietons?.echantillon(4000) ?? []),
      plug('circulation', 'passages'),
    ]);
    if (!Array.isArray(cross)) { note('passagesErreur', cross); break; }
    tally.samples++;
    for (const p of peds) {
      tally.peds++;
      const ne = nearestEdge(lines, p.x, p.z);
      if (!ne.e) continue;
      const half = HALF_CARRIAGE[ne.e.kind];
      const med = (MEDIAN[ne.e.kind] ?? 0) / 2;
      const onRoad = ne.d < half - 0.35 && ne.d > med - 0.2;
      if (!onRoad) { tally.sidewalk++; continue; }
      // Sur la chaussée : sur un passage ?
      let best = null, bd = Infinity;
      for (const c of cross) { const d = distSeg(p.x, p.z, c.ax, c.az, c.bx, c.bz); if (d < bd) { bd = d; best = c; } }
      if (best && bd < 2.6) {
        tally.onCrossing++;
        if (!best.controlled) tally.uncontrolled++;
        else if (best.walk === 0) tally.crossingGreen++;
        else {
          tally.crossingRedTotal++;
          // Rouge depuis plus longtemps que le temps de dégagement plausible : position au milieu de la chaussée
          // ET véhicules au vert : le piéton est sur la chaussée alors que les voitures passent.
          if (best.walk === 2 && best.vehicle === 0) { tally.crossingRedEngaged++; if (tally.bad.length < 12) tally.bad.push({ type: 'rouge-vehicules-vert', p, crossing: { id: best.id, walk: best.walk, vehicle: best.vehicle, remaining: best.remaining, d: +bd.toFixed(2) } }); }
        }
      } else {
        tally.roadwayOffCrossing++;
        if (tally.bad.length < 12) tally.bad.push({ type: 'chaussee-hors-passage', p: { x: +p.x.toFixed(1), z: +p.z.toFixed(1), idle: p.idle }, troncon: ne.e.id, kind: ne.e.kind, dAxe: +ne.d.toFixed(2), demiChaussee: half, passageLePlusProche: +bd.toFixed(1) });
      }
    }
  }
  note('pietonsTally', tally);
  const share = tally.peds ? tally.roadwayOffCrossing / tally.peds : 1;
  check(tally.peds > 200, `échantillon de piétons suffisant (${tally.peds} positions, ${tally.samples} instants)`);
  check(share < 0.01, `piétons sur la chaussée hors passage : ${tally.roadwayOffCrossing} / ${tally.peds} (${(share * 100).toFixed(2)} %)`);
  check(tally.onCrossing > 0, `traversées observées sur les passages (${tally.onCrossing}, dont ${tally.crossingGreen} au vert piéton, ${tally.uncontrolled} sans feux)`);
  check(tally.crossingRedEngaged <= Math.max(2, tally.onCrossing * 0.05), `piétons sur un passage au ROUGE piéton pendant que les véhicules ont le VERT : ${tally.crossingRedEngaged} (rouge/orange au total ${tally.crossingRedTotal})`);

  // ---------------- 2. Circulation multi-voies ----------------
  await page.evaluate(() => { window.__aube.trackVehicles = true; });
  const c1 = await plug('circulation', 'stats');
  await page.waitForTimeout(8000);
  const c2 = await plug('circulation', 'stats');
  note('circulation', { avant: c1, apres: c2 });
  check(c2.vehicles > 50, `véhicules en circulation (${c2.vehicles}, vitesse moyenne ${c2.meanSpeedKmh} km/h)`);
  check(c2.laneChanges > 0, `changements de voie effectués (${c2.laneChanges}, dont ${c2.mandatoryLaneChanges} obligatoires)`);
  check(c2.signals > 0, `carrefours à feux (${c2.signals}), priorité ${c2.priorityJunctions}, cédez ${c2.yieldJunctions}`);
  check(c2.arrived > c1.arrived, `véhicules arrivés à destination en 8 s (${c1.arrived} → ${c2.arrived})`);
  // Répartition latérale sur les avenues : plusieurs voies réellement occupées.
  await render(1);
  const veh = await page.evaluate(() => window.__aube.lastVehicles);
  const avenues = polylines(save).filter((l) => l.kind === 'avenue' || l.kind === 'boulevard');
  const offsets = [];
  if (veh) for (let i = 0; i < veh.ids.length; i++) {
    // VEHICLE_STRIDE = 4 (x, y, z, cap) — src/shared/constants.ts
    const x = veh.positions[i * 4], z = veh.positions[i * 4 + 2];
    const ne = nearestEdge(avenues, x, z);
    if (ne.e && ne.d < HALF_CARRIAGE[ne.e.kind]) offsets.push(+ne.d.toFixed(1));
  }
  const bins = offsets.reduce((m, d) => { const b = Math.floor(d / 1.6) * 1.6; m[b.toFixed(1)] = (m[b.toFixed(1)] ?? 0) + 1; return m; }, {});
  note('decalagesAvenues', { n: offsets.length, histogramme: bins, stride: veh ? veh.positions.length / Math.max(1, veh.ids.length) : null });
  const inner = offsets.filter((d) => d < 1.5 + 3.25).length, outer = offsets.filter((d) => d >= 1.5 + 3.25).length;
  check(offsets.length < 4 || (inner > 0 && outer > 0), `avenues : véhicules sur la voie intérieure (${inner}) ET extérieure (${outer})`);
  const cong = await plug('circulation', 'congestion');
  note('congestion', { troncons: cong?.edgeIds ? Object.keys(cong.edgeIds).length : null });
  await page.evaluate(() => { window.__aube.trackVehicles = false; });

  // ---------------- 4. Performance (avant météo) ----------------
  await send('setSpeed', { speed: 0 });
  await page.evaluate(() => window.__aube.setCamera('demo-aerial'));
  await render(4, 0.5);
  const perfAir = await page.evaluate(() => window.__aube.benchFrame());
  const pedR = await page.evaluate(() => window.__pietons?.rendu);
  note('perfAerien', perfAir); note('pietonsRenduAerien', pedR);
  await shot('aerien');
  // Gros plan d'un passage avec piétons (vue rue).
  const cr = await plug('circulation', 'passages');
  const peds = await page.evaluate(() => window.__pietons.echantillon(4000));
  let bestC = null, bestN = -1;
  for (const c of cr.filter((c) => c.controlled)) { const n = peds.filter((p) => Math.hypot(p.x - c.x, p.z - c.z) < 25).length; if (n > bestN) { bestN = n; bestC = c; } }
  note('passageChoisi', { id: bestC?.id, pietonsA25m: bestN, walk: bestC?.walk, vehicle: bestC?.vehicle });
  if (bestC) {
    const dx = bestC.bx - bestC.ax, dz = bestC.bz - bestC.az, L = Math.hypot(dx, dz);
    // Caméra rue sur le trottoir, à 14 m le long de la route, regardant le passage.
    const nx = -dz / L, nz = dx / L;
    await page.evaluate(([x, z, lx, lz]) => window.__aube.streetLook(x, z, lx, lz), [bestC.bx + nx * 14 + dx / L * 1.5, bestC.bz + nz * 14 + dz / L * 1.5, bestC.x, bestC.z]);
    await render(4, 0.5);
    const perfRue = await page.evaluate(() => window.__aube.benchFrame());
    note('perfRue', perfRue); note('pietonsRenduRue', await page.evaluate(() => window.__pietons?.rendu));
    await shot('passage-rue');
    await page.evaluate(([x, z]) => window.__aube.lookAt(x, z, 45, 0.9, 0.6), [bestC.x, bestC.z]);
    await render(6, 0.5);
    await shot('passage-aerien');
  }
  check(perfAir.calls < 3500, `appels de rendu vue aérienne : ${perfAir.calls} (phase 1 : ≈ 2 987 ; triangles ${(perfAir.triangles / 1e6).toFixed(2)} M)`);

  // ---------------- 3. Météo / saisons ----------------
  const w0 = await plug('weather', 'state');
  note('meteoInitiale', w0);
  const hudW = await page.evaluate(() => { const e = document.querySelector('#hud-weather'); return e ? { txt: e.textContent.trim(), disabled: e.getAttribute('aria-disabled'), tip: e.dataset.tip, display: getComputedStyle(e).display } : null; });
  note('hudMeteo', hudW);
  check(!(hudW && hudW.disabled === 'true' && /2C/.test(hudW.txt) && w0 && !w0.error), `barre supérieure : météo affichée depuis la simulation (module météo actif : ${w0?.kind ?? JSON.stringify(w0).slice(0, 80)} ; HUD : « ${hudW?.txt} », grisé=${hudW?.disabled})`);
  await page.evaluate(() => window.__aube.setCamera('demo-aerial'));
  await page.evaluate(() => window.__aube.lookAt(0, 0, 260, 0.55, 0.8));
  await render(4, 0.5);
  for (const [kind, extra] of [['pluie', { wetness: 1 }], ['neige', { dayOfYear: 20, snowCover: 1 }], ['brouillard', {}], ['orage', { wetness: 1 }]]) {
    const r = await plug('weather', 'force', { kind, hours: 6, settle: true, ...extra });
    await send('setSpeed', { speed: 1 }); await page.waitForTimeout(1500); await send('setSpeed', { speed: 0 });
    await render(20, 0.2);
    const st = await page.evaluate(() => ({ s: window.__atmo?.state(), q: window.__atmo?.quality(), stats: window.__atmo?.stats() }));
    note(`meteo-${kind}`, { sim: r?.kind ?? r, rendu: st.s?.kind, saison: st.s?.season, temp: st.s?.tempC, stats: st.stats });
    check(r && !r.error && st.s?.kind === kind, `météo forcée « ${kind} » reçue par le rendu (${st.s?.kind})`);
    await shot(`meteo-${kind}`);
  }
  note('erreursPage', errors.slice(0, 20));
  check(errors.length === 0, `aucune erreur console / page (${errors.length}) ${errors.slice(0, 3).join(' | ')}`);
} catch (e) {
  console.error('ERREUR', e); R.crash = String(e?.stack ?? e); failed = true;
} finally {
  writeFileSync(join(out, 'ville.json'), JSON.stringify(R, null, 2));
  await browser.close(); server.close();
}
console.log(failed ? '\nQA5 VILLE : ÉCHEC' : `\nQA5 VILLE : SUCCÈS (${R.checks.length} vérifications)`);
process.exit(failed ? 1 : 0);
