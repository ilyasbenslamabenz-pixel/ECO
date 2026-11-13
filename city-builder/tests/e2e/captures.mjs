/**
 * Banc de captures multi-angles de la scène de démonstration (npm run captures, après npm run build).
 * Préparation phase 2 (§0 de docs/ROADMAP_PHASE2.md) : à relancer après chaque étape / fusion.
 *
 * Vues (≥ 12) : aérien général, aérien rapproché, horizon, rue, carrefour à feux (aérien + rue), quatre quartiers
 * (centre, collectif, pavillons, activités : barycentres calculés depuis la sauvegarde et le catalogue), nuit
 * (aérien, rue, carrefour), iPhone portrait (aérien, rue).
 * Échec si : image quasi uniforme (écart-type moyen des canaux < MIN_STDEV), erreur de page / console / requête,
 * modèle manquant (erreurs de chargement bâtiments ou véhicules, bâtiments non dessinés, chargements en cours).
 * Sorties : tests/e2e/out/captures/<nn>-<vue>.png + rapport.json.
 * Options : ONLY=jour,nuit,iphone (sessions à exécuter), MIN_STDEV=N.
 * Rendu logiciel (SwiftShader) : une image de la démo coûte 1 à 4 min ; compter une à deux heures.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { collectErrors, launch, root, serve } from './lib.mjs';

const out = join(root, 'tests/e2e/out/captures');
mkdirSync(out, { recursive: true });
const MIN_STDEV = Number(process.env.MIN_STDEV ?? 10);
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const report = { minStdev: MIN_STDEV, views: [], checks: [] };
let failed = false;
let index = 0;
const check = (ok, msg, extra) => {
  report.checks.push({ ok: !!ok, msg, ...(extra !== undefined ? { extra } : {}) });
  console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${msg}`);
  if (!ok) failed = true;
};

const { server, base } = await serve();
const browser = await launch();

/** Ouvre la démo (rendu à la demande), simulation en pause. */
async function openDemo({ h, viewport = { width: 1280, height: 800 }, mobile = false } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
  const page = await ctx.newPage();
  const errors = collectErrors(page);
  await page.goto(`${base}/index.html?demo&norender${h !== undefined ? `&h=${h}` : ''}`, { timeout: 600000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__aube?.demoReady === true || (window.__aube?.errors?.length ?? 0) > 0, null, { timeout: 1800000, polling: 1000 });
  await page.evaluate(() => window.__aube.send('setSpeed', { speed: 0 }));
  await page.waitForTimeout(800);
  return { ctx, page, errors };
}

/** Modèles : aucune erreur de chargement, rien en cours, tous les bâtiments de la ville dessinés. */
async function checkModels(page, label) {
  const r = await page.evaluate(() => ({ scene: window.__aube.sceneCheck(), demo: window.__aube.demo, errors: window.__aube.errors }));
  const s = r.scene;
  check(s.buildingErrors.length === 0 && s.vehicleErrors.length === 0, `${label} : aucun modèle en erreur`, { buildings: s.buildingErrors, vehicles: s.vehicleErrors });
  check(s.buildingsLoading === 0, `${label} : aucun modèle en cours de chargement (${s.buildingsLoading})`);
  check(r.demo && s.buildings === r.demo.buildings && s.buildings > 0, `${label} : bâtiments dessinés ${s.buildings} / ville ${r.demo?.buildings}`);
  check(r.errors.length === 0, `${label} : aucune erreur interne (__aube.errors)`, r.errors.slice(0, 5));
  return r;
}

/** Rend la vue courante (terrain affiné, LOD), capture, mesure l'uniformité. */
async function shoot(page, name, meta = {}) {
  await page.evaluate(() => window.__aube.renderNow(2, 0.5));
  await page.waitForTimeout(4000); // maillage des chunks de terrain (worker)
  await page.evaluate(() => window.__aube.renderNow(2, 0.1));
  const file = `${String(++index).padStart(2, '0')}-${name}.png`;
  const path = join(out, file);
  await page.screenshot({ path, timeout: 900000 });
  const st = await sharp(path).stats();
  const rgb = st.channels.slice(0, 3);
  const stdev = rgb.reduce((a, c) => a + c.stdev, 0) / 3;
  const mean = rgb.reduce((a, c) => a + c.mean, 0) / 3;
  report.views.push({ file, name, stdev: Math.round(stdev * 10) / 10, mean: Math.round(mean * 10) / 10, ...meta });
  check(stdev >= MIN_STDEV, `${file} : image non uniforme (écart-type ${stdev.toFixed(1)}, moyenne ${mean.toFixed(1)})`);
}

/** Barycentres des quartiers de la démo (même classement que src/sim/city-builder.ts). */
async function districtCenters(page) {
  return page.evaluate(async () => {
    const save = (await window.__aube.send('save', { slot: 'captures' })).data;
    const cat = await (await fetch(new URL('./assets/catalog.json', location.href))).json();
    const catOf = new Map(cat.assets.map((a) => [a.id, a.category]));
    const DISTRICT = { skyscraper: 'centre', commercial: 'centre', apartment_mid: 'centre', public: 'collectif', apartment_high: 'collectif',
      apartment_low: 'collectif', townhouse: 'pavillons', house: 'pavillons', industrial: 'activites' };
    const acc = {};
    for (const b of save.buildings) {
      const d = DISTRICT[catOf.get(b.assetId)];
      if (!d) continue;
      (acc[d] ??= []).push(b);
    }
    const res = {};
    for (const [d, list] of Object.entries(acc)) {
      // cœur du quartier : bâtiment ayant le plus de voisins du même quartier à moins de 70 m (un quartier
      // éclaté en plusieurs îlots ne donne pas un barycentre tombé ailleurs), puis moyenne de ces voisins
      let best = list[0], bestN = -1;
      for (const b of list) {
        const n = list.filter((o) => Math.hypot(o.x - b.x, o.z - b.z) < 70).length;
        if (n > bestN) { best = b; bestN = n; }
      }
      const near = list.filter((o) => Math.hypot(o.x - best.x, o.z - best.z) < 70);
      res[d] = { x: near.reduce((s, o) => s + o.x, 0) / near.length, z: near.reduce((s, o) => s + o.z, 0) / near.length, n: list.length, core: near.length };
    }
    return res;
  });
}

/** Carrefour à feux (centre, bras de référence) et vue rue derrière la ligne d'arrêt (approche au niveau du sol). */
async function signalJunction(page) {
  const sig = await page.evaluate(() => window.__aube.signals());
  if (!sig.arms.length) return null;
  const arms = [...sig.arms].sort((a, b) => Number(b.mast) - Number(a.mast));
  for (const arm of arms) {
    const dx = Math.sin(arm.heading), dz = Math.cos(arm.heading), rx = -dz, rz = dx;
    const camX = arm.x - dx * 15 - rx * 0.3, camZ = arm.z - dz * 15 - rz * 0.3;
    const h = await page.evaluate(([x, z]) => window.__aube.heightAt(x, z), [camX, camZ]);
    if (Math.abs(h - arm.y) > 1.2) continue; // pas sur un pont
    const same = sig.arms.filter((a) => a.node === arm.node);
    return {
      cx: same.reduce((s, a) => s + a.x, 0) / same.length, cz: same.reduce((s, a) => s + a.z, 0) / same.length, yaw: arm.heading + Math.PI,
      street: [camX, camZ, arm.x + dx * 2 - rx * arm.reach * 0.55, arm.z + dz * 2 - rz * arm.reach * 0.55], arms: same.length,
    };
  }
  return null;
}

const want = (s) => !ONLY || ONLY.includes(s);
let junction = null;
try {
  if (want('jour')) {
    const { ctx, page, errors } = await openDemo({ h: 10.5 });
    const r = await checkModels(page, 'jour');
    const [ax, az] = r.demo.views.aerial;
    await page.evaluate(() => window.__aube.setCamera('demo-aerial'));
    await shoot(page, 'aerien-general');
    await page.evaluate(([x, z]) => window.__aube.lookAt(x, z, 260, 0.75, -0.4), [ax, az]);
    await shoot(page, 'aerien-rapproche');
    await page.evaluate(([x, z]) => window.__aube.lookAt(x, z, 700, 0.22, 2.2), [ax, az]);
    await shoot(page, 'horizon');
    await page.evaluate(() => window.__aube.setCamera('demo-street'));
    await shoot(page, 'rue');
    junction = await signalJunction(page);
    check(!!junction, `carrefour à feux trouvé (${junction?.arms ?? 0} bras)`);
    if (junction) {
      await page.evaluate(([x, z, yaw]) => window.__aube.lookAt(x, z, 85, 0.95, yaw), [junction.cx, junction.cz, junction.yaw]);
      await shoot(page, 'carrefour-feux-aerien', { x: junction.cx, z: junction.cz });
      await page.evaluate(([x, z, lx, lz]) => window.__aube.streetLook(x, z, lx, lz), junction.street);
      await shoot(page, 'carrefour-feux-rue');
    }
    const districts = await districtCenters(page);
    report.districts = districts;
    for (const d of ['centre', 'collectif', 'pavillons', 'activites']) {
      const c = districts[d];
      check(!!c, `quartier ${d} présent (${c?.n ?? 0} bâtiments)`);
      if (!c) continue;
      await page.evaluate(([x, z]) => window.__aube.lookAt(x, z, 190, 0.7, 0.9), [c.x, c.z]);
      await shoot(page, `quartier-${d}`, c);
    }
    await checkModels(page, 'jour (après captures)');
    check(errors.length === 0, `jour : aucune erreur de page / console (${errors.length})`, errors.slice(0, 5));
    await ctx.close();
  }

  if (want('nuit')) {
    const { ctx, page, errors } = await openDemo({ h: 21.5 });
    await checkModels(page, 'nuit');
    await page.evaluate(() => window.__aube.setCamera('demo-aerial'));
    await shoot(page, 'nuit-aerien');
    await page.evaluate(() => window.__aube.setCamera('demo-street'));
    await shoot(page, 'nuit-rue');
    junction ??= await signalJunction(page);
    if (junction) {
      await page.evaluate(([x, z, lx, lz]) => window.__aube.streetLook(x, z, lx, lz), junction.street);
      await shoot(page, 'nuit-carrefour-feux');
    }
    check(errors.length === 0, `nuit : aucune erreur de page / console (${errors.length})`, errors.slice(0, 5));
    await ctx.close();
  }

  if (want('iphone')) {
    const { ctx, page, errors } = await openDemo({ h: 16, viewport: { width: 390, height: 844 }, mobile: true });
    await checkModels(page, 'iPhone');
    await page.evaluate(() => window.__aube.setCamera('demo-aerial'));
    await shoot(page, 'iphone-portrait-aerien');
    await page.evaluate(() => window.__aube.setCamera('demo-street'));
    await shoot(page, 'iphone-portrait-rue');
    check(errors.length === 0, `iPhone : aucune erreur de page / console (${errors.length})`, errors.slice(0, 5));
    await ctx.close();
  }
  if (!ONLY) check(report.views.length >= 12, `au moins 12 vues (${report.views.length})`);
} catch (e) {
  console.error(e);
  check(false, `exception : ${e instanceof Error ? e.message : String(e)}`);
} finally {
  writeFileSync(join(out, 'rapport.json'), JSON.stringify(report, null, 2));
  await browser.close();
  server.close();
}
console.log(`\n${report.views.length} vues dans tests/e2e/out/captures — ${failed ? 'CAPTURES : ÉCHEC' : 'CAPTURES : SUCCÈS'}`);
process.exit(failed ? 1 : 0);
