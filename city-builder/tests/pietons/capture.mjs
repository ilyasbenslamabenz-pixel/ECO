/**
 * Captures des piétons dans la démo (après npm run build) : node tests/pietons/capture.mjs
 *  1. foule issue des seuls emplois du temps (démographie) pendant ~20 s de jeu ;
 *  2. foule imposée (FOULE, défaut 1500) ; vues rue (trottoir, traversée) et aérienne ; deux images à 1 s
 *     d'écart pour prouver le mouvement (positions + phases d'animation).
 * Sorties : tests/pietons/out/*.png + rapport.json. Échec : erreur de page/console, modèles non chargés,
 * aucun piéton dessiné. Rendu logiciel (SwiftShader) : plusieurs minutes.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectErrors, launch, root, serve } from '../e2e/lib.mjs';

const out = join(root, 'tests/pietons/out');
mkdirSync(out, { recursive: true });
const FOULE = Number(process.env.FOULE ?? 1500);
const report = { checks: [], shots: [] };
let failed = false;
const check = (ok, msg, extra) => {
  report.checks.push({ ok: !!ok, msg, ...(extra !== undefined ? { extra } : {}) });
  console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${msg}${extra !== undefined ? ' ' + JSON.stringify(extra) : ''}`);
  if (!ok) failed = true;
};

const { server, base } = await serve();
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const errors = collectErrors(page);
const t0 = Date.now();
const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)} s] ${m}`);
try {
  await page.goto(`${base}/index.html?demo&norender&h=${process.env.H ?? 8}`, { timeout: 600000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__aube?.demoReady === true || (window.__aube?.errors?.length ?? 0) > 0, null, { timeout: 1800000, polling: 1000 });
  log('démo prête');
  await page.waitForFunction(() => window.__pietons?.pret === true || window.__pietons?.erreur, null, { timeout: 600000, polling: 500 });
  const dbg0 = await page.evaluate(() => ({ pret: window.__pietons.pret, erreur: window.__pietons.erreur }));
  check(dbg0.pret && !dbg0.erreur, 'personnages chargés et cuits', dbg0);
  const send = (name, args) => page.evaluate(([n, a]) => window.__aube.send(n, a), [name, args]);
  const pc = (name, payload) => send('pluginCommand', { plugin: 'pietons', name, payload });

  // 1. Emplois du temps seuls.
  // Journée = 144 s réelles à ×1 : 20 s ≈ 3 h 20 de jeu (départ 8 h : heure de pointe du matin).
  await send('setSpeed', { speed: 1 });
  await page.waitForTimeout(20000);
  const s1 = (await pc('stats')).data;
  report.horaires = s1;
  log(`emplois du temps : ${s1.pietons} piétons, ${s1.marcheurs} marcheurs, graphe ${JSON.stringify(s1.graphe)}`);
  check(s1.graphe.aretes > 0 && s1.marcheurs > 0, `graphe piéton et marcheurs issus de la démographie (${s1.marcheurs} marcheurs, ${s1.pietons} dans la rue)`);

  // 2. Foule imposée.
  await pc('config', { foule: FOULE });
  await send('setSpeed', { speed: 1 });
  await page.waitForFunction((n) => (window.__pietons?.stats?.pietons ?? 0) >= n * 0.8, FOULE, { timeout: 300000, polling: 1000 });
  await page.waitForTimeout(4000);
  const s2 = (await pc('stats')).data;
  report.foule = s2;
  log(`foule : ${s2.pietons} piétons ; tick ${JSON.stringify(s2.tickMs)}`);
  check(s2.pietons >= FOULE * 0.8, `foule imposée atteinte (${s2.pietons} / ${FOULE})`);

  // Choix d'un piéton en traversée (sinon un piéton qui marche).
  const sample = await page.evaluate(() => window.__pietons.echantillon(400));
  let target = null, crossing = null;
  for (const p of sample.slice(0, 200)) {
    const info = (await pc('inspecter', { id: p.id }).catch(() => null))?.data;
    if (!info) continue;
    if (info.etat === 'traversee') { crossing = { ...p, info }; break; }
    if (!target && info.etat === 'marche') target = { ...p, info };
  }
  report.cible = { target, crossing };

  const shoot = async (name, meta = {}) => {
    await page.evaluate(() => window.__aube.renderNow(2, 0.05));
    const file = join(out, `${name}.png`);
    await page.screenshot({ path: file });
    const r = await page.evaluate(() => ({ rendu: { ...window.__pietons.rendu, lod: [...window.__pietons.rendu.lod] }, compteur: document.querySelector('#hud-pietons b')?.textContent ?? null }));
    report.shots.push({ name, ...meta, ...r });
    log(`capture ${name} : ${JSON.stringify(r)}`);
    return r;
  };
  const streetAt = async (p, name) => {
    const back = 6, side = 0;
    const fx = Math.sin(p.h), fz = Math.cos(p.h);
    const cx = p.x - fx * back + fz * side, cz = p.z - fz * back - fx * side;
    await page.evaluate(([x, z, lx, lz]) => window.__aube.streetLook(x, z, lx, lz), [cx, cz, p.x + fx * 4, p.z + fz * 4]);
    return shoot(name, { ped: p });
  };

  const main = crossing ?? target ?? sample[0];
  // Deux images rue à ~1 s de jeu d'écart (simulation en marche entre les deux).
  await send('setSpeed', { speed: 0 });
  const a = await streetAt(main, '01-rue-trottoir');
  check(a.rendu.dessines > 0 && a.rendu.lod[0] > 0, `vue rue : piétons dessinés en LOD0 (${a.rendu.lod.join('/')})`);
  const before = await page.evaluate(() => window.__pietons.echantillon(30));
  await send('setSpeed', { speed: 1 });
  await page.waitForTimeout(1500);
  await send('setSpeed', { speed: 0 });
  await page.waitForTimeout(300);
  // Rendu en mode `norender` : les positions affichées n'avancent qu'aux images rendues.
  await page.evaluate(() => window.__aube.renderNow(3, 0.1));
  const after = await page.evaluate(() => window.__pietons.echantillon(400));
  const byId = new Map(after.map((p) => [p.id, p]));
  let movedN = 0, phaseN = 0;
  for (const p of before) {
    const q = byId.get(p.id);
    if (!q) continue;
    if (Math.hypot(q.x - p.x, q.z - p.z) > 0.3) movedN++;
    if (Math.abs(q.phase - p.phase) > 0.01) phaseN++;
  }
  check(movedN > 0 && phaseN > 0, `mouvement entre deux images : ${movedN}/${before.length} déplacés, ${phaseN} phases d'animation changées`);
  await streetAt(byId.get(main.id) ?? main, '02-rue-trottoir-1s-apres');
  if (crossing) {
    const c = byId.get(crossing.id) ?? crossing;
    // Vue de côté sur la traversée.
    const fx = Math.sin(c.h), fz = Math.cos(c.h);
    await page.evaluate(([x, z, lx, lz]) => window.__aube.streetLook(x, z, lx, lz), [c.x + fz * 9 - fx * 3, c.z - fx * 9 - fz * 3, c.x, c.z]);
    await shoot('03-rue-traversee', { ped: c });
  } else check(true, 'aucun piéton en traversée dans l’échantillon (vue traversée non prise)');
  await page.evaluate(([x, z]) => window.__aube.lookAt(x, z, 90, 0.75, -0.4), [main.x, main.z]);
  const m = await shoot('04-aerien-proche');
  check(m.rendu.lod[1] + m.rendu.lod[2] > 0, `aérien proche : LOD1/LOD2 utilisés (${m.rendu.lod.join('/')})`);
  await page.evaluate(([x, z]) => window.__aube.lookAt(x, z, 700, 0.6, -0.4), [main.x, main.z]);
  const f = await shoot('05-aerien-ville');
  check(f.rendu.lod[3] > 0, `aérien lointain : imposteurs utilisés (${f.rendu.lod.join('/')}, ${f.rendu.appels} appels)`);
  check(f.compteur !== null && Number(f.compteur.replace(/\s/g, '').replace(/ /g, '')) > 0, `compteur HUD affiché (${f.compteur})`);
} catch (e) {
  check(false, `exception : ${e instanceof Error ? e.message : String(e)}`);
}
const internal = await page.evaluate(() => window.__aube?.errors ?? []).catch(() => []);
check(errors.length === 0 && internal.length === 0, 'aucune erreur de page / console / interne', [...errors, ...internal].slice(0, 8));
writeFileSync(join(out, 'rapport.json'), JSON.stringify(report, null, 2));
await browser.close();
server.close();
console.log(failed ? 'ÉCHEC' : 'OK');
process.exit(failed ? 1 : 0);
