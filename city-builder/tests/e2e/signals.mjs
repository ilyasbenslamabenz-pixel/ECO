/**
 * Feux tricolores dans la scène de démonstration (node tests/e2e/signals.mjs, après npm run build ; npm run e2e:signals).
 *  1. ?demo : la simulation envoie la disposition et l'état des feux ; le rendu dessine un poteau ou un mât à potence
 *     et des têtes de feu à chaque bras des carrefours à feux (instances), état = état simulé.
 *  2. Pendant que le trafic roule : repère les véhicules immobiles en tête de file devant un feu (deux trames à
 *     1,5 s d'intervalle) et vérifie que leur feu est au rouge (au moins un cas), puis met en pause.
 *  3. Captures : gros plan aérien d'un carrefour à feux, vue rue derrière le véhicule arrêté (feux visibles),
 *     puis la même vue rue la nuit (?demo&h=21.5). Contrôle automatique : pixels de lentille allumée présents.
 * Captures : tests/e2e/out/feux-aerien.png, feux-rue.png, feux-rue-nuit.png ; rapport : feux-rapport.json.
 * Option --no-night : saute la vue de nuit (une scène de démo de plus à construire, lent en rendu logiciel).
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { collectErrors, launch, root, serve } from './lib.mjs';

const out = join(root, 'tests/e2e/out');
const { server, base } = await serve();
const browser = await launch();
let failed = false;
const report = { checks: [] };
const check = (ok, msg, extra) => { report.checks.push({ ok: !!ok, msg, extra }); console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${msg}`); if (!ok) failed = true; };

/** Pixels de lentille allumée (rouge / orange / vert saturés) dans une capture. */
async function lensPixels(path) {
  const { data, info } = await sharp(path).raw().toBuffer({ resolveWithObject: true });
  let red = 0, amber = 0, green = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    // (lentilles hors tone mapping : la composante faible d'une couleur saturée ressort vers 90-110 en sRGB)
    if (r > 200 && g < 135 && b < 120 && r - g > 110) red++;
    else if (r > 200 && g > 135 && g < 215 && b < 90) amber++;
    else if (g > 190 && r < 140 && g - r > 80) green++;
  }
  return { red, amber, green };
}

async function openDemo(h) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const errors = collectErrors(page);
  await page.goto(`${base}/index.html?demo&norender${h !== undefined ? `&h=${h}` : ''}`, { timeout: 600000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__aube?.demoReady === true || (window.__aube?.errors?.length ?? 0) > 0, null, { timeout: 900000, polling: 1000 });
  return { page, errors };
}

const shoot = async (page, file) => {
  await page.evaluate(() => window.__aube.renderNow(2, 0.5));
  await page.waitForTimeout(4000); // maillage des chunks de terrain (worker)
  await page.evaluate(() => window.__aube.renderNow(2, 0.1));
  await page.screenshot({ path: join(out, file), timeout: 900000 });
};

/** Véhicules immobiles en tête de file devant un bras à feux : { v, arm, dist }. */
function stoppedAtSignals(a, b, sig) {
  const res = [];
  const prev = new Map();
  for (let i = 0; i < a.ids.length; i++) prev.set(a.ids[i], i);
  for (let j = 0; j < b.ids.length; j++) {
    const i = prev.get(b.ids[j]);
    if (i === undefined) continue;
    const x = b.positions[j * 4], z = b.positions[j * 4 + 2], hd = b.positions[j * 4 + 3];
    if (Math.hypot(x - a.positions[i * 4], z - a.positions[i * 4 + 2]) > 0.05) continue;
    const dx = Math.sin(hd), dz = Math.cos(hd);
    let best = null;
    for (let k = 0; k < sig.arms.length; k++) {
      const arm = sig.arms[k];
      const dh = Math.abs(Math.atan2(Math.sin(arm.heading - hd), Math.cos(arm.heading - hd)));
      if (dh > 0.35) continue;
      const rx = arm.x - x, rz = arm.z - z;
      const along = rx * dx + rz * dz; // le poteau est devant le véhicule, à la ligne d'arrêt
      const lat = Math.abs(rx * dz - rz * dx);
      if (along < 0.5 || along > 9 || lat > arm.reach + 4) continue;
      if (!best || along < best.dist) best = { k, dist: along, lat };
    }
    if (best) res.push({ id: b.ids[j], x, z, heading: hd, arm: best.k, dist: best.dist, state: sig.arms[best.k].state });
  }
  return res;
}

try {
  const { page, errors } = await openDemo();
  const ready = await page.evaluate(() => window.__aube.demoReady);
  check(ready, 'scène de démonstration prête');
  await page.evaluate(() => { window.__aube.trackVehicles = true; });
  await page.waitForTimeout(6000);
  const sig0 = await page.evaluate(() => window.__aube.signals());
  const junctions = new Set(sig0.arms.map((a) => a.node)).size;
  report.layout = { arms: sig0.arms.length, junctions, heads: sig0.heads, meshes: sig0.meshes, masts: sig0.arms.filter((a) => a.mast).length };
  check(sig0.arms.length >= 12 && junctions >= 3, `feux dessinés : ${sig0.arms.length} bras, ${junctions} carrefours, ${sig0.heads} têtes`, report.layout);
  check(sig0.meshes.length === 7 && sig0.meshes.every((m) => m.count > 0 || m.name === 'feux_poteaux' || m.name === 'feux_mats' || m.name === 'feux_potences'), `7 maillages instanciés (${sig0.meshes.map((m) => `${m.name}:${m.count}`).join(', ')})`);
  const states = sig0.arms.map((a) => a.state);
  check(states.includes(0) && states.includes(2), `états réels (vert et rouge présents) : ${states.join('')}`);
  // l'état change au fil du temps (les feux suivent la simulation)
  await page.waitForTimeout(5000);
  const sig1 = await page.evaluate(() => window.__aube.signals());
  check(sig1.updates > sig0.updates && sig1.arms.map((a) => a.state).join('') !== states.join(''), `les feux changent avec la simulation (${sig0.updates} -> ${sig1.updates} mises à jour)`);

  // Véhicule arrêté au feu rouge
  let found = null;
  let stats = { red: 0, amber: 0, green: 0 };
  for (let attempt = 0; attempt < 25 && !found; attempt++) {
    const a = await page.evaluate(() => window.__aube.lastVehicles);
    await page.waitForTimeout(1500);
    const [b, sig] = await page.evaluate(() => [window.__aube.lastVehicles, window.__aube.signals()]);
    if (!a || !b) continue;
    const list = stoppedAtSignals(a, b, sig);
    for (const s of list) stats[['green', 'amber', 'red'][s.state]]++;
    // préférence : un mât à potence (grand carrefour), feu rouge, approche au niveau du terrain (pas sur un pont :
    // la caméra rue, posée sur le terrain, serait sous le tablier)
    const reds = list.filter((s) => s.state === 2);
    const ground = [];
    for (const s of reds) {
      const a = sig.arms[s.arm];
      const cx = a.x - Math.sin(a.heading) * 15, cz = a.z - Math.cos(a.heading) * 15;
      const h = await page.evaluate(([x, z]) => window.__aube.heightAt(x, z), [cx, cz]);
      if (Math.abs(h - a.y) < 1.2) ground.push(s);
    }
    found = ground.find((s) => sig.arms[s.arm].mast) ?? ground[0] ?? null;
    if (found) {
      // pause : l'état et la position restent figés pour la capture ; on relit les deux
      await page.evaluate(() => window.__aube.send('setSpeed', { speed: 0 }));
      await page.waitForTimeout(600);
      const [c, sig2] = await page.evaluate(() => [window.__aube.lastVehicles, window.__aube.signals()]);
      const j = c.ids.indexOf(found.id);
      found.stillThere = j >= 0 && Math.hypot(c.positions[j * 4] - found.x, c.positions[j * 4 + 2] - found.z) < 0.5;
      found.stateAfterPause = sig2.arms[found.arm].state;
      found.armInfo = sig2.arms[found.arm];
    }
  }
  report.stopped = { found, stats };
  check(!!found, `véhicule immobile en tête de file devant un feu ROUGE (arrêts observés : ${JSON.stringify(stats)})`, found);
  if (found) check(found.stillThere && found.stateAfterPause === 2, `après pause : véhicule ${found.id} toujours à la ligne d'arrêt (à ${found.dist.toFixed(1)} m du poteau), feu rouge`);
  else await page.evaluate(() => window.__aube.send('setSpeed', { speed: 0 }));

  // Captures : gros plan aérien puis vue rue derrière le véhicule arrêté
  const arm = found ? found.armInfo : sig0.arms.find((a) => a.mast) ?? sig0.arms[0];
  const dx = Math.sin(arm.heading), dz = Math.cos(arm.heading);
  const rx = -dz, rz = dx; // droite du conducteur
  // centre du carrefour : moyenne des pieds de poteau de ses bras (aux coins)
  const same = sig0.arms.filter((a) => a.node === arm.node);
  const cx = same.reduce((s, a) => s + a.x, 0) / same.length, cz = same.reduce((s, a) => s + a.z, 0) / same.length;
  report.junction = { node: arm.node, x: cx, z: cz, arms: same.length };
  await page.evaluate(([x, z, yaw]) => window.__aube.lookAt(x, z, 85, 0.95, yaw), [cx, cz, arm.heading + Math.PI]);
  await shoot(page, 'feux-aerien.png');
  // vue rue : sur le bord du trottoir, 15 m avant la ligne d'arrêt, regard vers la tête suspendue
  const camX = arm.x - dx * 15 - rx * 0.3, camZ = arm.z - dz * 15 - rz * 0.3;
  const lookX = arm.x + dx * 2 - rx * arm.reach * 0.55, lookZ = arm.z + dz * 2 - rz * arm.reach * 0.55;
  report.street = { camX, camZ, lookX, lookZ, arm };
  await page.evaluate(([x, z, lx, lz]) => window.__aube.streetLook(x, z, lx, lz), [camX, camZ, lookX, lookZ]);
  await shoot(page, 'feux-rue.png');
  const px = await lensPixels(join(out, 'feux-rue.png'));
  report.streetPixels = px;
  check(px.red > 6, `vue rue : lentilles rouges allumées visibles (${px.red} px rouges, ${px.amber} orange, ${px.green} verts)`);
  report.renderStats = await page.evaluate(() => window.__aube.renderStats());
  check(errors.length === 0, `aucune erreur de page (${errors.length})`, errors.slice(0, 5));
  await page.close();

  if (!process.argv.includes('--no-night')) {
    const n = await openDemo(21.5);
    await n.page.evaluate(() => window.__aube.send('setSpeed', { speed: 0 }));
    await n.page.waitForTimeout(800);
    await n.page.evaluate(([x, z, lx, lz]) => window.__aube.streetLook(x, z, lx, lz), [camX, camZ, lookX, lookZ]);
    await shoot(n.page, 'feux-rue-nuit.png');
    const pn = await lensPixels(join(out, 'feux-rue-nuit.png'));
    report.nightPixels = pn;
    const sigN = await n.page.evaluate(() => window.__aube.signals());
    check(sigN.arms.length === sig0.arms.length, `nuit : mêmes feux (${sigN.arms.length} bras)`);
    check(pn.red + pn.amber + pn.green > 6, `nuit : lentilles allumées visibles (${JSON.stringify(pn)})`);
    check(n.errors.length === 0, `nuit : aucune erreur de page (${n.errors.length})`, n.errors.slice(0, 5));
    await n.page.close();
  }
} catch (e) {
  console.error(e);
  check(false, `exception : ${e instanceof Error ? e.message : String(e)}`);
} finally {
  writeFileSync(join(out, 'feux-rapport.json'), JSON.stringify(report, null, 2));
  await browser.close();
  server.close();
}
console.log(failed ? '\nFEUX : ÉCHEC' : '\nFEUX : SUCCÈS');
process.exit(failed ? 1 : 0);
