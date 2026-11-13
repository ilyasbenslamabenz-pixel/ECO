/**
 * Recette QA n° 5 — barre supérieure sur bureau : à 1280, 1440, 1680 et 1920 px de large, partie et démo,
 * chaque élément de la barre est-il entièrement dans l'écran (réglages, sauvegarde, notifications compris) ?
 * Contenu : météo (simulée ou grisée ?), variation de population, montants CHF.
 * Lancement : npm run build puis node tests/e2e/qa5-hud.mjs. Sorties : tests/e2e/out/qa5/hud-*.png + hud.json.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectErrors, launch, root, serve } from './lib.mjs';

const out = join(root, 'tests/e2e/out/qa5');
mkdirSync(out, { recursive: true });
const R = { checks: [], notes: {} };
let failed = false;
const check = (ok, msg) => { R.checks.push({ ok: !!ok, msg }); console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${msg}`); if (!ok) failed = true; };
const note = (k, v) => { R.notes[k] = v; console.log(`     ${k}: ${JSON.stringify(v).slice(0, 500)}`); };

const audit = () => {
  const W = innerWidth;
  const items = [...document.querySelectorAll('#hud > *, #hud button, #hud .hud-stat')].filter((e) => getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0);
  const cut = items.map((e) => ({ id: e.id || e.dataset.speed || e.className.split(' ')[0], r: e.getBoundingClientRect() })).filter(({ r }) => r.right > W + 0.5 || r.left < -0.5).map(({ id, r }) => ({ id, left: Math.round(r.left), right: Math.round(r.right) }));
  const btn = (s) => { const e = document.querySelector(s); if (!e) return 'absent'; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return cs.display === 'none' ? 'masqué' : `${Math.round(r.left)}→${Math.round(r.right)}`; };
  const hud = document.querySelector('#hud');
  return { W, hudScroll: hud.scrollWidth, hudClient: hud.clientWidth, cut,
    boutons: { stats: btn('#btn-stats'), notif: btn('#btn-notif'), save: btn('#btn-save'), menu: btn('#btn-menu') },
    meteo: document.querySelector('#hud-weather')?.textContent.replace(/\s+/g, ' ').trim(),
    pop: document.querySelector('#hud-pop')?.textContent.trim(), popDelta: document.querySelector('#hud-pop-delta')?.textContent.trim(),
    money: document.querySelector('#hud-money')?.textContent.trim(), balance: document.querySelector('#hud-balance')?.textContent.trim(),
    city: document.querySelector('#hud-city')?.textContent.replace(/\s+/g, ' ').trim() };
};

const { server, base } = await serve();
const browser = await launch();
try {
  for (const mode of ['partie', 'demo']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const errors = collectErrors(page);
    await page.goto(`${base}/index.html?${mode === 'demo' ? 'demo' : 'autostart&seed=42'}&norender`, { timeout: 600000, waitUntil: 'domcontentloaded' });
    if (mode === 'demo') await page.waitForFunction(() => window.__aube?.demoReady === true, null, { timeout: 1500000, polling: 1000 });
    else await page.waitForFunction(() => window.__aube?.ready && window.__aube.snapshotReceived && window.__aube.lastStats, null, { timeout: 300000, polling: 500 });
    await page.evaluate(() => window.__aube.send('setSpeed', { speed: 1 }));
    await page.waitForTimeout(3000);
    await page.evaluate(() => window.__aube.send('setSpeed', { speed: 0 }));
    const meteoSim = await page.evaluate(() => window.__aube.send('pluginCommand', { plugin: 'weather', name: 'state' }).then((r) => r?.data ?? r, (e) => ({ error: e.message })));
    note(`${mode}-meteoSimulee`, meteoSim && { kind: meteoSim.kind, label: meteoSim.label, tempC: meteoSim.tempC, season: meteoSim.season });
    for (const w of [1280, 1440, 1680, 1920]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForTimeout(300);
      const a = await page.evaluate(audit);
      note(`${mode}-${w}`, a);
      const allIn = a.cut.length === 0 && !/masqué|absent/.test(a.boutons.menu) && !/masqué|absent/.test(a.boutons.save);
      check(allIn, `${mode} ${w} px : barre supérieure entière (coupés : ${JSON.stringify(a.cut)} ; réglages ${a.boutons.menu}, sauvegarde ${a.boutons.save})`);
      await page.evaluate(() => window.__aube.renderNow(1, 0.05));
      await page.screenshot({ path: join(out, `hud-${mode}-${w}.png`), clip: { x: 0, y: 0, width: w, height: 80 } });
    }
    const a = await page.evaluate(audit);
    check(!(meteoSim && meteoSim.kind && /2C/.test(a.meteo ?? '')), `${mode} : la barre affiche la météo simulée (« ${a.meteo} » ; simulation : ${meteoSim?.label} ${meteoSim?.tempC} °C)`);
    check(errors.length === 0, `${mode} : aucune erreur (${errors.slice(0, 3).join(' | ')})`);
    await page.close();
  }
} catch (e) {
  console.error('ERREUR', e); R.crash = String(e?.stack ?? e); failed = true;
} finally {
  writeFileSync(join(out, 'hud.json'), JSON.stringify(R, null, 2));
  await browser.close(); server.close();
}
console.log(failed ? '\nQA5 HUD : ÉCHEC' : `\nQA5 HUD : SUCCÈS (${R.checks.length} vérifications)`);
process.exit(failed ? 1 : 0);
