/**
 * Captures du module « Chantiers » (node tests/chantiers/capture.mjs, après npm run build).
 * Propriété de la branche p2a-chantiers.
 *
 * Déroulement dans le VRAI jeu (worker réel, rendu réel ; `?norender` + `renderNow` pour des images à la
 * demande en rendu logiciel) :
 *   1. nouvelle partie sur une zone plate, rue tracée, quatre bâtiments de tailles très différentes posés
 *      à la suite : chacun ouvre un chantier ;
 *   2. la simulation tourne à ×16 ; on capture la scène à plusieurs moments, en notant pour chaque
 *      chantier sa phase, son avancement et ce qui est réellement dessiné (`window.__aube.chantiers()`) ;
 *   3. vue de rue sur le plus grand chantier (grue, échafaudages, palissade, engins) ;
 *   4. vue de nuit (hors horaires : tout est à l'arrêt, gyrophares allumés) ;
 *   5. démolition d'un bâtiment achevé : vestiges, gravats, engins.
 * Sorties : tests/chantiers/out/*.png et rapport.json (phases vues, instances, erreurs de page).
 * Échec si une image est quasi uniforme, si la page journalise une erreur ou si une phase attendue
 * n'a jamais été observée.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectErrors, launch, root, serve } from '../e2e/lib.mjs';

const out = join(root, 'tests/chantiers/out');
mkdirSync(out, { recursive: true });
const { server, base } = await serve();
const browser = await launch();
const R = { checks: [], shots: [], phases: {}, notes: {} };
let failed = false;
const check = (ok, msg) => { R.checks.push({ ok: !!ok, msg }); console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${msg}`); if (!ok) failed = true; };
const render = (page, n = 2) => page.evaluate((k) => window.__aube.renderNow(k), n);
const send = (page, n, a) => page.evaluate(([n, a]) => window.__aube.send(n, a).then((r) => ({ ok: true, r }), (e) => ({ ok: false, e: e.message })), [n, a]);
const chantiers = (page) => page.evaluate(() => (window.__aube.chantiers ? window.__aube.chantiers() : null));

/** Capture + mesure de variance (une image quasi uniforme = scène vide ou rendu cassé). */
async function shot(page, name, label) {
  await render(page, 2);
  const file = join(out, `${name}.png`);
  await page.screenshot({ path: file, timeout: 600000 });
  const stat = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    const g = document.createElement('canvas');
    g.width = 160; g.height = 100;
    const ctx = g.getContext('2d');
    ctx.drawImage(c, 0, 0, 160, 100);
    const d = ctx.getImageData(0, 0, 160, 100).data;
    let s = 0, s2 = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; s += l; s2 += l * l; n++; }
    const m = s / n;
    return { mean: Math.round(m * 10) / 10, std: Math.round(Math.sqrt(Math.max(0, s2 / n - m * m)) * 10) / 10 };
  });
  const info = await chantiers(page);
  R.shots.push({ name, label, ...stat, chantiers: info?.sites?.length ?? 0 });
  console.log(`  image ${name} : moyenne ${stat.mean}, écart-type ${stat.std} (${label})`);
  check(stat.std > 8, `image ${name} non uniforme (écart-type ${stat.std})`);
  return info;
}

/** Note les phases observées pour chaque modèle. */
function noteSites(info) {
  if (!info) return;
  for (const s of info.sites ?? []) {
    const key = `${s.kind}:${s.phase}`;
    R.phases[key] = (R.phases[key] ?? 0) + 1;
  }
}

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = collectErrors(page);
  await page.goto(`${base}/index.html?autostart&seed=42&norender`, { timeout: 300000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__aube?.ready && window.__aube.snapshotReceived && window.__aube.lastStats, null, { timeout: 300000, polling: 500 });
  await send(page, 'setSpeed', { speed: 0 });
  // Partie dédiée : terrain sans eau, argent abondant, départ à 7 h (les chantiers travaillent de 6 h à 20 h).
  const ng = await send(page, 'newGame', { seed: 42, mapChunks: 6, startMoney: 400_000_000, cityName: 'Chantiers', startHour: 7, terrain: { hydrology: 'aucune', rivers: 0 } });
  check(ng.ok, 'nouvelle partie dédiée aux chantiers');
  await page.waitForFunction(() => window.__aube.snapshotReceived, null, { timeout: 120000 });
  await send(page, 'setSpeed', { speed: 0 });

  // Zone plate : vérifiée par la simulation elle-même (dryRun sur toute la bande).
  const C = [0, 0];
  const pts = [];
  for (let dx = -120; dx <= 160; dx += 40) pts.push([C[0] + dx, C[1] - 26]);
  const dry = await page.evaluate(async (list) => {
    const bad = [];
    for (const [px, pz] of list) {
      try { await window.__aube.send('placeBuilding', { assetId: 'maison_pavillon_enduit', x: px, z: pz, rot: 0, dryRun: true }); } catch (e) { bad.push(`${px},${pz}: ${e.message}`); }
    }
    return bad;
  }, pts);
  R.notes.dryRun = dry;
  check(dry.length === 0, `bande constructible validée par la simulation (${dry.length} refus)`);

  const road = await send(page, 'buildRoad', { type: 'avenue', kind: 'avenue', points: [-200, 0, 240, 0] });
  check(road.ok, 'avenue tracée');

  // Quatre chantiers de tailles très différentes, posés dans cet ordre (durées croissantes).
  const plan = [
    { id: 'tour_vitree_mur_rideau', x: 120, z: -40, nom: 'tour' },
    { id: 'immeuble_haussmannien', x: 40, z: -30, nom: 'immeuble' },
    { id: 'public_ecole', x: -40, z: -32, nom: 'ecole' },
    { id: 'maison_pavillon_enduit', x: -120, z: -26, nom: 'pavillon' },
  ];
  const ids = {};
  for (const p of plan) {
    const r = await send(page, 'placeBuilding', { assetId: p.id, x: p.x, z: p.z, rot: 0 });
    check(r.ok, `pose ${p.nom} (${p.id})${r.ok ? '' : ' : ' + r.e}`);
    if (r.ok) ids[p.nom] = r.r.data.buildingId;
  }
  await page.waitForTimeout(600);
  await send(page, 'setSpeed', { speed: 1 });
  await page.waitForTimeout(1500);
  const info0 = await chantiers(page);
  R.notes.premierEtat = info0;
  check((info0?.sites?.length ?? 0) === plan.length, `${info0?.sites?.length ?? 0} chantiers ouverts (4 attendus)`);
  check((info0?.erreurs?.length ?? 0) === 0, `aucune erreur du rendu des chantiers (${JSON.stringify(info0?.erreurs ?? [])})`);
  // Tous les modèles de chantier chargés avant la première image (sinon la capture serait vide).
  await page.evaluate(async () => { const r = window.__aube.chantiersPreload; if (r) await r(); });
  await page.waitForFunction(() => { const d = window.__aube.chantiers?.(); return d && d.chargements === 0; }, null, { timeout: 180000, polling: 1000 });

  await page.evaluate(() => window.__aube.lookAt(0, -30, 330, 0.62));
  noteSites(await shot(page, 'chantiers-depart', 'quatre chantiers au terrassement'));

  // Accélération : on laisse la simulation avancer et on capture à plusieurs moments.
  await send(page, 'setSpeed', { speed: 16 });
  const etapes = [
    { attente: 14000, nom: 'fondations', vue: () => page.evaluate(() => window.__aube.lookAt(0, -30, 330, 0.62)) },
    { attente: 20000, nom: 'structure', vue: () => page.evaluate(() => window.__aube.lookAt(0, -30, 330, 0.62)) },
    { attente: 28000, nom: 'facades', vue: () => page.evaluate(() => window.__aube.lookAt(0, -30, 300, 0.55)) },
  ];
  for (const e of etapes) {
    await page.waitForTimeout(e.attente);
    await send(page, 'setSpeed', { speed: 0 });
    await e.vue();
    noteSites(await shot(page, `chantiers-${e.nom}`, `avancement : ${e.nom}`));
    await send(page, 'setSpeed', { speed: 16 });
  }

  // Vue rapprochée de la tour (grue, échafaudages, ossature) puis vue de rue.
  await send(page, 'setSpeed', { speed: 0 });
  await page.evaluate(() => window.__aube.lookAt(120, -40, 150, 0.45));
  noteSites(await shot(page, 'chantiers-tour', 'grue et ossature de la tour'));
  await page.evaluate(() => window.__aube.streetLook(120, 60, 120, -40));
  noteSites(await shot(page, 'chantiers-rue', 'vue de rue : palissade, baraque, engins'));

  // Pavillon : chantier court, vu de près.
  await page.evaluate(() => window.__aube.lookAt(-120, -26, 70, 0.4));
  noteSites(await shot(page, 'chantiers-pavillon', 'petit chantier vu de près'));

  // Nuit : hors horaires, tout est à l'arrêt.
  await send(page, 'setSpeed', { speed: 16 });
  await page.waitForFunction(() => { const h = window.__aube.lastStats?.date?.hour; return h !== undefined && (h >= 21 || h < 4); }, null, { timeout: 180000, polling: 500 });
  await send(page, 'setSpeed', { speed: 0 });
  await page.evaluate(() => window.__aube.lookAt(60, -40, 220, 0.5));
  const nuit = await shot(page, 'chantiers-nuit', 'chantiers la nuit (travaux suspendus)');
  check(nuit && nuit.enTravail === false, 'la nuit, les chantiers sont déclarés hors horaires');

  // Démolition : on attend qu'un chantier s'achève puis on démolit le bâtiment.
  await send(page, 'setSpeed', { speed: 16 });
  await page.waitForFunction(() => {
    const d = window.__aube.chantiers?.();
    return d && !d.sites.some((s) => s.buildingId === window.__chantierPavillon);
  }, null, { timeout: 240000, polling: 1000 }).catch(() => undefined);
  await page.evaluate((id) => { window.__chantierPavillon = id; }, ids.pavillon ?? 0);
  await send(page, 'setSpeed', { speed: 0 });
  const dem = await send(page, 'demolish', { buildingId: ids.pavillon });
  check(dem.ok, `démolition du pavillon${dem.ok ? '' : ' : ' + dem.e}`);
  await send(page, 'setSpeed', { speed: 2 });
  await page.waitForTimeout(3000);
  await send(page, 'setSpeed', { speed: 0 });
  await page.evaluate(() => window.__aube.lookAt(-120, -26, 80, 0.42));
  const demInfo = await shot(page, 'chantiers-demolition', 'chantier de démolition');
  noteSites(demInfo);
  check((demInfo?.sites ?? []).some((s) => s.kind === 'demolition'), 'un chantier de démolition est dessiné');

  // Bilan.
  const info = await chantiers(page);
  R.notes.dernierEtat = info;
  R.notes.erreursPage = errors;
  check(errors.length === 0, `aucune erreur de page (${errors.slice(0, 3).join(' | ')})`);
  for (const p of ['construction:terrassement', 'construction:fondations', 'construction:structure']) {
    check(R.phases[p] > 0, `phase observée : ${p}`);
  }
} catch (e) {
  failed = true;
  R.notes.exception = e instanceof Error ? e.stack : String(e);
  console.error(e);
} finally {
  writeFileSync(join(out, 'rapport.json'), `${JSON.stringify(R, null, 2)}\n`);
  await browser.close();
  server.close();
  console.log(`\n${R.checks.filter((c) => c.ok).length}/${R.checks.length} vérifications ; images dans ${out}`);
  process.exit(failed ? 1 : 0);
}
