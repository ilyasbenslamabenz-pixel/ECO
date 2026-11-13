/** Sonde QA : après une avenue droite, quelles positions de bâtiment la simulation accepte-t-elle ? (dryRun) */
import { collectErrors, launch, serve } from './lib.mjs';
const { server, base } = await serve();
const browser = await launch();
const page = await (await browser.newContext()).newPage();
collectErrors(page);
await page.goto(`${base}/index.html?autostart&seed=7&norender`, { timeout: 300000, waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__aube?.ready && window.__aube.snapshotReceived, null, { timeout: 300000, polling: 500 });
const send = (n, a) => page.evaluate(([n, a]) => window.__aube.send(n, a).then((r) => ({ ok: true, r }), (e) => ({ ok: false, e: e.message, code: e.error?.code })), [n, a]);
await send('setSpeed', { speed: 0 });
const before = await send('placeBuilding', { assetId: 'maison_pavillon_enduit', x: -320, z: 60, rot: 0, variant: 0, dryRun: true });
console.log('sans route, (-320,60):', JSON.stringify(before));
const road = await send('buildRoad', { type: 'street', kind: 'avenue', points: [-450, 128, -190, 128] });
console.log('avenue', JSON.stringify(road).slice(0, 200));
for (const dz of [-12, -16, -20, -30, -50, -80, -120, -200, 200]) {
  const r = await send('placeBuilding', { assetId: 'maison_pavillon_enduit', x: -320, z: 128 + dz, rot: 0, variant: 0, dryRun: true });
  console.log(`dz=${dz}`, JSON.stringify(r));
}
const far = await send('placeBuilding', { assetId: 'maison_pavillon_enduit', x: 300, z: -300, rot: 0, variant: 0, dryRun: true });
console.log('loin (300,-300):', JSON.stringify(far));
await browser.close(); server.close();
