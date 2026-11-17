/**
 * Non-régression « la maison n'apparaît pas » (bâtiment resté masqué après un changement de partie).
 *
 * Un bâtiment en chantier est masqué dans le rendu de base (API setBuildingsVisible, src/render/construction/mask.ts).
 * Les identifiants de bâtiment repartent de 1 à chaque nouvelle partie et reprennent ceux de la sauvegarde au
 * chargement : si le masque d'une partie précédente survit à l'instantané complet, le bâtiment de même identifiant
 * dans la nouvelle partie reste invisible (seuls le cadre de sélection et l'empreinte apparaissent), sans chantier.
 *
 *   node tests/e2e/batiment-masque-perime.mjs [dossier dist | paquet artifact] [--artifact]   (après npm run build)
 */
import { resolve } from 'node:path';
import { collectErrors, dist, launch, serve } from './lib.mjs';

const args = process.argv.slice(2);
const dir = resolve(args.find((a) => !a.startsWith('--')) ?? dist);
const artifact = args.includes('--artifact');
const { server, base } = await serve(dir);
const browser = await launch();
const fails = [];
try {
  const page = await (await browser.newContext({ viewport: { width: 1024, height: 700 } })).newPage();
  const errors = collectErrors(page);
  await page.goto(artifact ? `${base}/__artifact_wrapped.html?autostart&norender` : `${base}/index.html?autostart&norender`, { timeout: 300000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__aube?.snapshotReceived && window.__aube.lastStats && window.__aube.send, null, { timeout: 300000, polling: 500 });
  const send = (n, a) => page.evaluate(([n, a]) => window.__aube.send(n, a).then((r) => ({ ok: true, r }), (e) => ({ ok: false, e: e.message })), [n, a]);
  const newGame = async () => {
    await send('newGame', { seed: 7, mapChunks: 8, startMoney: 50_000_000, cityName: 'Masque' });
    await page.waitForTimeout(2500);
    await send('setSpeed', { speed: 0 });
  };
  /** Avenue puis maison posée à la main près d'elle ; renvoie son identifiant. */
  const placeHouse = async () => {
    const road = await send('buildRoad', { type: 'street', kind: 'avenue', points: [-300, -180, 300, -180] });
    if (!road.ok) throw new Error(`avenue refusée : ${road.e}`);
    for (let x = -280; x < 280; x += 20) for (let dz = 12; dz <= 30; dz += 2) for (const rot of [0, 2]) {
      const r = await send('placeBuilding', { assetId: 'maison_pavillon_enduit', x, z: -180 + dz, rot, variant: 0 });
      if (r.ok) return { id: r.r.buildingId, x, z: -180 + dz };
    }
    throw new Error('maison non posée');
  };
  const state = async (id) => {
    await page.evaluate(() => window.__aube.renderNow?.(2));
    return page.evaluate((i) => {
      const ch = window.__aube.chantiers?.();
      return { d: window.__aube.buildingDebug(i), chantier: ch?.sites?.some((s) => s.buildingId === i && s.kind === 'construction') ?? false, actif: ch?.actif };
    }, id);
  };

  // Partie 1 : maison posée, chantier ouvert -> masquée (normal : le chantier se voit à sa place).
  await newGame();
  await send('pluginCommand', { plugin: 'chantiers', name: 'configurer', payload: { actif: true } });
  const h1 = await placeHouse();
  const s1 = await state(h1.id);
  console.log('partie 1, en chantier :', JSON.stringify(s1));
  if (!s1.d?.hidden || !s1.chantier) fails.push('partie 1 : maison en chantier attendue (masquée, chantier présent)');

  // Partie 2 (nouvelle partie dans la même page), chantiers désactivés : maison posée, achevée d'emblée.
  await newGame();
  await send('pluginCommand', { plugin: 'chantiers', name: 'configurer', payload: { actif: false } });
  const h2 = await placeHouse();
  await page.evaluate(([x, z]) => window.__aube.lookAt(x, z, 70, 0.7), [h2.x, h2.z]);
  let s2 = null;
  for (let t = 0; t < 40; t++) {
    s2 = await state(h2.id);
    if (s2.d && !s2.d.hidden && s2.d.drawnLod >= 0) break;
    if (s2.d && !s2.d.pool && !s2.d.hidden && s2.d.counts.some((c) => c > 0)) break;
    await page.waitForTimeout(250);
  }
  console.log(`partie 2, maison #${h2.id} (même identifiant que #${h1.id} : ${h2.id === h1.id}) :`, JSON.stringify(s2));
  if (s2.d?.hidden) fails.push(`partie 2 : maison #${h2.id} restée masquée par le chantier de la partie précédente`);
  else if (!(s2.d && (s2.d.pool ? s2.d.drawnLod >= 0 : s2.d.counts.some((c) => c > 0)))) fails.push(`partie 2 : maison #${h2.id} non dessinée`);

  // Partie 3 : chargement d'une sauvegarde (instantané complet) pendant un chantier, maison de la sauvegarde achevée.
  const saved = await send('save', { slot: 'masque-e2e' });
  await newGame();
  await send('pluginCommand', { plugin: 'chantiers', name: 'configurer', payload: { actif: true } });
  const h3 = await placeHouse();
  const s3a = await state(h3.id);
  if (!s3a.d?.hidden) fails.push('partie 3 : maison en chantier attendue masquée');
  const ld = await send('load', { data: saved.r.data });
  if (!ld.ok) fails.push(`chargement refusé : ${ld.e}`);
  await page.waitForTimeout(2500);
  const s3 = await state(h2.id);
  console.log(`après chargement, maison #${h2.id} :`, JSON.stringify(s3));
  if (s3.d?.hidden && !s3.chantier) fails.push(`chargement : maison #${h2.id} masquée sans chantier`);

  const errs = errors.filter((e) => !/favicon/.test(e));
  if (errs.length) console.log('erreurs console', JSON.stringify(errs.slice(0, 10)));
} finally { await browser.close(); server.close(); }
for (const f of fails) console.log(`ÉCHEC : ${f}`);
console.log(fails.length ? `${fails.length} échec(s)` : 'OK');
process.exit(fails.length ? 1 : 0);
