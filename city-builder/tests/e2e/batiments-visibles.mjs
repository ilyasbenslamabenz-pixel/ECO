/**
 * Non-régression « la maison n'apparaît pas » : chaque logement posable à la main (et quelques bâtiments d'autres
 * catégories) est posé le long d'une avenue ; on vérifie que le rendu dessine bien quelque chose pour lui
 * (chantier, ou bâtiment à un LOD chargé), pendant le chantier puis une fois le chantier achevé.
 *   node tests/e2e/batiments-visibles.mjs [dossier dist | dossier du paquet artifact] [--artifact] [--lite] [--variantes]  (--variantes : chaque variante, long en rendu logiciel)
 * Après `npm run build` (ou `node scripts/pack-artifact.mjs dist <dossier>` puis `--artifact`).
 */
import { resolve } from 'node:path';
import { collectErrors, dist, launch, serve } from './lib.mjs';

const args = process.argv.slice(2);
const dir = resolve(args.find((a) => !a.startsWith('--')) ?? dist);
const artifact = args.includes('--artifact');
const lite = args.includes('--lite');
const { server, base } = await serve(dir);
const browser = await launch();
let failures = 0;
try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const errors = collectErrors(page);
  const url = artifact ? `${base}/__artifact_wrapped.html?autostart&norender` : `${base}/index.html?autostart&norender${lite ? '&lite=1' : ''}`;
  await page.goto(url, { timeout: 300000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__aube?.snapshotReceived && window.__aube.lastStats && window.__aube.send, null, { timeout: 300000, polling: 500 });
  const send = (n, a) => page.evaluate(([n, a]) => window.__aube.send(n, a).then((r) => ({ ok: true, r }), (e) => ({ ok: false, e: e.message })), [n, a]);
  // Partie neuve bien dotée : tous les modèles posables d'un coup (fonds de départ ordinaires insuffisants).
  await send('newGame', { seed: 7, mapChunks: 8, startMoney: 2_000_000_000, cityName: 'Test des bâtiments' });
  await page.waitForTimeout(3000);
  await send('setSpeed', { speed: 0 });
  await send('pluginCommand', { plugin: 'chantiers', name: 'configurer', payload: { actif: true } });
  // Assets étudiés : tous les logements (pose manuelle), puis un échantillon des autres catégories.
  const assets = await page.evaluate(async () => {
    const r = await fetch(new URL('assets/catalog.json', location.href));
    const c = await r.json();
    return c.assets.filter((a) => a.footprint?.tilesX > 0 && a.lods?.length && a.cost > 0)
      .map((a) => ({ nv: Math.max(1, a.variants?.length ?? 0), id: a.id, cat: a.category, res: a.capacity?.residents ?? 0, tx: a.footprint.tilesX, tz: a.footprint.tilesZ }));
  });
  const res = assets.filter((a) => a.res > 0);
  const others = [];
  for (const cat of ['commercial', 'industrial', 'public', 'office']) others.push(...assets.filter((a) => a.cat === cat && a.res === 0).slice(0, 2));
  const allVariants = args.includes("--variantes");
  const todo = [...res, ...others].flatMap((a) => Array.from({ length: allVariants ? a.nv : 1 }, (_, v) => ({ ...a, v: allVariants ? v : (a.id.length % a.nv) })));
  console.log(`${res.length} logements + ${others.length} autres à poser`);
  // Avenues parallèles : z = -400 … 400 tous les 120 m, de x = -700 à 700.
  const rows = [];
  for (let z = -420; z <= 420; z += 120) { const r = await send('buildRoad', { type: 'street', kind: 'avenue', points: [-700, z, 700, z] }); if (r.ok) rows.push({ z, x: [-680, -680] }); else console.log('avenue refusée', z, r.e); }
  if (!rows.length) throw new Error('aucune avenue posée');
  const placed = [];
  for (const a of todo) {
    let ok = null;
    const lw = Math.max(a.tx, a.tz) * 8;
    search: for (const row of rows) for (const side of [0, 1]) {
      while (row.x[side] < 680) {
        const x = row.x[side] + lw / 2 + 2;
        row.x[side] = x + lw / 2 + 2;
        for (let dz = lw / 2 + 4; dz <= lw / 2 + 26; dz += 2) {
          const z = row.z + (side ? 1 : -1) * dz;
          for (const rot of [0, 1, 2, 3]) {
            const t = await send('placeBuilding', { assetId: a.id, x, z, rot, variant: a.v, dryRun: true });
            if (!t.ok) { if (/argent|fonds|budget/i.test(t.e)) { console.log('fonds épuisés', a.id); break search; } continue; }
            if (t.r.noRoadAccess) continue;
            const r = await send('placeBuilding', { assetId: a.id, x, z, rot, variant: a.v });
            if (r.ok) { ok = { ...a, x, z, bid: r.r.buildingId }; break search; }
          }
        }
      }
    }
    if (ok) placed.push(ok); else console.log(`non posé : ${a.id}#${a.v}`);
  }
  console.log(`${placed.length} posés`);
  console.log('rendu en lots par matériau :', await page.evaluate((id) => window.__aube.buildingDebug(id)?.pool, placed[0]?.bid));
  const check = async (phase) => {
    let bad = 0;
    for (const b of placed) {
      await page.evaluate(([x, z]) => window.__aube.lookAt(x, z, 70, 0.7), [b.x, b.z]);
      await page.evaluate(() => window.__aube.renderNow?.(3));
      let st = null;
      for (let t = 0; t < 60; t++) {
        st = await page.evaluate((id) => {
          const d = window.__aube.buildingDebug(id);
          const ch = window.__aube.chantiers?.();
          const site = ch?.sites?.find((s) => s.buildingId === id && s.kind === 'construction') ?? null;
          return { d, site };
        }, b.bid);
        const drawn = st.d && !st.d.hidden && (st.d.pool ? st.d.drawnLod >= 0 : st.d.lods.some((s, l) => s === 2 && st.d.counts[l] > 0));
        st.visible = drawn || !!(st.site && st.site.palissade + st.site.travees + st.site.structure > 0 || st.site?.phase);
        st.drawn = drawn;
        if (drawn || (phase === 'chantier' && st.site)) break;
        await page.waitForTimeout(250);
        await page.evaluate(() => window.__aube.renderNow?.(2));
      }
      const failed = phase === 'chantier' ? !st.visible : !st.drawn;
      if (failed) { bad++; console.log(`INVISIBLE (${phase}) ${b.id}#${b.v} bâtiment ${b.bid}`, JSON.stringify(st)); }
    }
    console.log(`${phase} : ${placed.length - bad}/${placed.length} visibles`);
    return bad;
  };
  failures += await check('chantier');
  await send('pluginCommand', { plugin: 'chantiers', name: 'configurer', payload: { actif: false } });
  await send('setSpeed', { speed: 1 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__aube.renderNow?.(3));
  await send('setSpeed', { speed: 0 });
  const ch = await page.evaluate(() => window.__aube.chantiers?.());
  console.log('chantiers restants', ch?.chantiers, 'erreurs chantier', JSON.stringify(ch?.erreurs ?? []));
  failures += await check('achevé');
  const sc = await page.evaluate(() => window.__aube.sceneCheck());
  if (sc.buildingErrors.length) { console.log('erreurs de bâtiments', JSON.stringify(sc.buildingErrors)); }
  const errs = errors.filter((e) => !/favicon/.test(e));
  if (errs.length) console.log('erreurs console', JSON.stringify(errs.slice(0, 20)));
} finally { await browser.close(); server.close(); }
console.log(failures ? `ÉCHEC : ${failures} bâtiment(s) invisible(s)` : 'OK');
process.exit(failures ? 1 : 0);
