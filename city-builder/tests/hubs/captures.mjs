/**
 * Captures du module hubs (npm run hubs:captures, après npm run build) — rendu logiciel SwiftShader, lent.
 * Nouvelle partie sur la carte côtière de la démonstration, sans rivière (?autostart puis commande newGame ; la ville
 * de démonstration occupe toute la plaine, d'où une carte vierge) : la simulation propose des emplacements valides (commande `suggest`),
 * on pose un port de commerce et de passagers puis un aéroport (commande `place`, comme l'outil de pose), on fait
 * tourner la simulation jusqu'à ce qu'un navire soit à quai puis qu'un avion décolle, et on rend une image à
 * chaque fois : tests/hubs/out/port-navire-a-quai.png, tests/hubs/out/aeroport-decollage.png (+ rapport.json).
 * Échoue au moindre problème (pose refusée, modèle manquant, erreur de page, image quasi uniforme).
 * Les captures DOIVENT être regardées.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { collectErrors, launch, root, serve } from '../e2e/lib.mjs';

const out = join(root, 'tests/hubs/out');
mkdirSync(out, { recursive: true });
const { server, base } = await serve();
const browser = await launch();
const failures = [];
const report = {};
const t0 = Date.now();
const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)} s] ${m}`);

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const errors = collectErrors(page);
  await page.goto(`${base}/index.html?autostart&seed=7&h=11&norender`);
  await page.waitForFunction(() => (window.__aube?.snapshotReceived === true && window.__aube?.lastStats) || (window.__aube?.errors?.length ?? 0) > 0, null, { timeout: 900000 });
  if ((await page.evaluate(() => window.__aube.errors.length)) > 0) throw new Error(`partie indisponible : ${await page.evaluate(() => JSON.stringify(window.__aube.errors))}`);
  // Même carte côtière, sans rivière dans la plaine (la plaine de la carte par défaut est coupée par une rivière :
  // pas de place pour une piste de 900 m) : nouvelle partie par la commande du jeu (même chemin que l'interface).
  await page.evaluate(() => { window.__aube.snapshotReceived = false; return window.__aube.send('newGame', { seed: 7, mapChunks: 8, startMoney: 500000000, cityName: 'Port-Aube', startHour: 11, terrain: { hydrology: 'mer', rivers: 0, relief: 0.15 } }); });
  await page.waitForFunction(() => window.__aube.snapshotReceived === true, null, { timeout: 300000 });
  log('partie prête');
  const cmd = (name, payload) => page.evaluate(([n, p]) => window.__aube.send('pluginCommand', { plugin: 'hubs', name: n, payload: p }).then((r) => r.data), [name, payload]);
  const speed = (s) => page.evaluate((v) => window.__aube.send('setSpeed', { speed: v }), s);
  await speed(0);

  // 1. Emplacements proposés par la simulation, puis pose (validation complète côté simulation).
  let portType = 'port_passagers';
  let ports = await cmd('suggest', { type: portType, step: 24, max: 12 });
  if (!ports.length) { portType = 'port_commerce'; ports = await cmd('suggest', { type: portType, step: 24, max: 12 }); }
  const airports = await cmd('suggest', { type: 'aeroport', step: 64, max: 6, rots: [0, 0.5, 1, 1.5] });
  log(`emplacements : ${ports.length} port(s), ${airports.length} aéroport(s)`);
  report.suggestions = { ports, airports };
  if (!ports.length) throw new Error('aucun emplacement de port sur la carte de démonstration');
  if (!airports.length) throw new Error('aucun emplacement d\'aéroport sur la carte de démonstration');
  // Port le plus proche du centre de la ville (vue avec contexte urbain).
  ports.sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
  const P = ports[0];
  const pr = await cmd('place', { type: portType, x: P.x, z: P.z, rot: P.rot });
  log(`port posé n° ${pr.id} en (${P.x}, ${P.z}) rot ${P.rot}, coût ${pr.cost}`);
  let A = null;
  for (const a of airports) {
    try { const r = await cmd('place', { assetId: 'hub_aeroport', x: a.x, z: a.z, rot: a.rot }); A = { ...a, id: r.id }; break; } catch (e) { log(`aéroport refusé en (${a.x}, ${a.z}) : ${e?.error?.message ?? e}`); }
  }
  if (!A) throw new Error('aucun aéroport posé');
  log(`aéroport posé n° ${A.id} en (${A.x}, ${A.z}) rot ${A.rot}`);
  report.port = { ...P, ...pr };
  report.airport = A;

  // 2. Un navire de commerce à quai.
  await speed(16);
  const waitFor = async (pred, label, maxS = 600) => {
    const t = Date.now();
    while (Date.now() - t < maxS * 1000) {
      const mv = await cmd('movements');
      const hit = mv.find(pred);
      if (hit) return hit;
      await page.waitForTimeout(250);
    }
    throw new Error(`attente dépassée : ${label}`);
  };
  const ship = await waitFor((m) => (m.role === 'cargo' || m.role === 'vraquier') && m.phase === 'a_quai' && m.u > 0.15 && m.u < 0.6, 'navire à quai');
  await speed(0);
  await page.waitForTimeout(400);
  log(`navire à quai : ${ship.asset} (${ship.phase} ${(ship.u * 100).toFixed(0)} %)`);
  const shoot = async (file, x, z, dist, pitch, yaw) => {
    await page.evaluate(([x, z, d, p, y]) => window.__aube.lookAt(x, z, d, p, y), [x, z, dist, pitch, yaw]);
    await page.evaluate(() => window.__aube.renderNow(2));
    await page.waitForTimeout(5000); // maillage des chunks de terrain et chargement des modèles
    await page.evaluate(() => window.__aube.renderNow(2));
    for (let i = 0; i < 40; i++) {
      const s = await page.evaluate(() => window.__hubs?.stats());
      if (s && s.loading === 0) break;
      await page.waitForTimeout(500);
    }
    const ms = await page.evaluate(() => window.__aube.renderNow(1));
    await page.screenshot({ path: join(out, file), timeout: 900000 });
    const st = await sharp(join(out, file)).stats();
    const sd = st.channels.slice(0, 3).reduce((a, c) => a + c.stdev, 0) / 3;
    const hs = await page.evaluate(() => window.__hubs?.stats());
    log(`${file} : rendu ${ms} ms, écart-type ${sd.toFixed(1)}, ${hs.pieces} pièces, ${hs.visibleMovers} mobiles visibles, ${hs.errors.length} erreur(s)`);
    if (sd < 12) failures.push(`${file} : image quasi uniforme (${sd.toFixed(1)})`);
    if (hs.errors.length) failures.push(`${file} : ${hs.errors.join(' | ')}`);
    return { ms, stdev: sd, hubs: hs };
  };
  report.portShot = await shoot('port-navire-a-quai.png', ship.x * 0.6 + P.x * 0.4, ship.z * 0.6 + P.z * 0.4, 330, 0.62, P.rot * Math.PI / 2 + Math.PI * 0.85);
  if (!report.portShot.hubs.poses.some((p) => p.phase === 'a_quai')) failures.push('capture port : aucun navire à quai dans le rendu');

  // 3. Un avion au décollage (fin du roulage, rotation) ou en tout début de montée.
  await speed(16);
  const plane = await waitFor((m) => m.asset.startsWith('aero_avion') && ((m.phase === 'decollage' && m.u > 0.78) || (m.phase === 'montee' && m.u < 0.12)), 'avion au décollage', 900);
  await speed(0);
  await page.waitForTimeout(400);
  log(`avion : ${plane.asset} ${plane.phase} ${(plane.u * 100).toFixed(0)} %, altitude ${plane.alt.toFixed(1)} m`);
  report.airportShot = await shoot('aeroport-decollage.png', plane.x, plane.z, 260, 0.38, A.rot * Math.PI / 2 - Math.PI * 0.62);
  if (!report.airportShot.hubs.poses.some((p) => p.phase === 'decollage' || p.phase === 'montee')) failures.push('capture aéroport : aucun avion au décollage dans le rendu');
  // Vue d'ensemble de l'aéroport (aérogare, tour, hangar, piste).
  report.airportOverview = await shoot('aeroport-ensemble.png', A.x, A.z, 900, 0.75, A.rot * Math.PI / 2 + Math.PI);

  report.summary = await cmd('summary');
  if (errors.length) failures.push(`erreurs de page : ${errors.slice(0, 8).join(' | ')}`);
  await page.close();
} catch (e) {
  failures.push(`exception : ${e instanceof Error ? e.message : JSON.stringify(e)}`);
} finally {
  writeFileSync(join(out, 'rapport.json'), JSON.stringify(report, null, 2));
  await browser.close();
  server.close();
}
console.log(`\nCaptures à REGARDER : ${out}/port-navire-a-quai.png, aeroport-decollage.png, aeroport-ensemble.png`);
if (failures.length) { console.error(`\nCAPTURES HUBS : ÉCHEC\n - ${failures.join('\n - ')}`); process.exit(1); }
console.log('CAPTURES HUBS : SUCCÈS');
