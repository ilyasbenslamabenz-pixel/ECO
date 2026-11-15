/**
 * Test e2e léger de la page de mesure (src/ui/bench.ts) : lance `?bench=court` (parcours raccourci) sur
 * index.html puis artifact.html (enveloppé comme chez l'hébergeur), vérifie que le tableau de résultats
 * s'affiche (4 scènes, chiffres présents), que le bouton « Copier les résultats » et les liens de relance
 * existent, qu'aucune requête ne part hors du serveur local et qu'il n'y a aucune erreur de page.
 * Pré-requis : npm run build.   node tests/e2e/bench.mjs
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { collectErrors, dist, launch, root, serve } from './lib.mjs';

if (!existsSync(join(dist, 'index.html'))) { console.error('dist/ absent : lancer npm run build'); process.exit(1); }
const out = join(root, 'tests/e2e/out');
mkdirSync(out, { recursive: true });
const { server, base } = await serve();
const browser = await launch();
let failed = false;
const check = (cond, msg) => { console.log(`${cond ? 'OK  ' : 'ÉCHEC'} ${msg}`); if (!cond) failed = true; };

/** Artifact (page « artifact.html » enveloppée) : le paramètre lance bien le mode mesure (parcours non attendu). */
async function runArtifact(path) {
  const page = await browser.newPage({ viewport: { width: 640, height: 400 }, deviceScaleFactor: 0.5 });
  const errors = collectErrors(page);
  await page.goto(`${base}${path}`, { waitUntil: 'load' });
  await page.waitForSelector('#bench-progress', { timeout: 600000 });
  const txt = await page.textContent('#bench-progress');
  check(/Mesure/.test(txt ?? ''), `[artifact] mode mesure lancé (« ${txt} »)`);
  const q = await page.getAttribute('#bench-progress', 'data-qualite');
  check(q === 'moyenne', `[artifact] qualité imposée par l'adresse (?qualite=moyenne) : ${q}`);
  check(errors.length === 0, `[artifact] aucune erreur de page${errors.length ? ' :\n   ' + errors.join('\n   ') : ''}`);
  await page.close();
}

async function run(label, path) {
  // Petite fenêtre : rendu logiciel (SwiftShader) lent.
  const page = await browser.newPage({ viewport: { width: 800, height: 450 }, deviceScaleFactor: 0.5 });
  const errors = collectErrors(page);
  const foreign = [];
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith(base) && !u.startsWith('blob:') && !u.startsWith('data:')) foreign.push(u); });
  const t0 = Date.now();
  await page.goto(`${base}${path}`, { waitUntil: 'load' });
  await page.waitForSelector('#bench-results', { timeout: 600000 });
  console.log(`[${label}] tableau affiché après ${Math.round((Date.now() - t0) / 1000)} s`);
  // Rendu logiciel : boucle d'affichage suspendue pour que les clics ne fassent pas la queue derrière les images.
  await page.evaluate(() => window.__aube.pauseRender(true));
  const r = await page.evaluate(() => window.__benchResult);
  check(!!r && r.scenes.length === 4, `[${label}] 4 scènes mesurées (${r?.scenes.map((s) => s.id).join(', ')})`);
  check(r?.scenes.every((s) => s.frames > 0 && s.fpsMean > 0 && s.calls > 0 && s.triangles > 0), `[${label}] images, img/s, appels et triangles relevés pour chaque scène`);
  check(r?.load.playableS > 0, `[${label}] temps jusqu'à « jouable » : ${r?.load.playableS} s, plus longue image au chargement ${r?.load.maxLoadFrameMs} ms`);
  check(typeof r?.env.carteGraphique === 'string' && r.env.carteGraphique.length > 0, `[${label}] carte graphique : ${r?.env.carteGraphique}`);
  check(r?.version && r.version !== 'inconnue', `[${label}] version du jeu : ${r?.version}`);
  const rows = await page.$$eval('#bench-results > div > table > tbody > tr', (trs) => trs.length);
  check(rows === 4, `[${label}] tableau : ${rows} lignes`);
  check(r?.breakdown?.length === 2 && r.breakdown.every((b) => b.totalMs > 0 && b.layers.length > 0), `[${label}] coût GPU par calque (${r?.breakdown?.map((b) => `${b.view} : ${b.totalMs} ms, ${b.layers.slice(0, 3).map((l) => `${l.layer} ${l.share} %`).join(', ')}`).join(' | ')})`);
  check(await page.isVisible('#bench-copy'), `[${label}] bouton « Copier les résultats » visible`);
  const links = await page.$$eval('#bench-results a', (as) => as.map((a) => a.getAttribute('href')));
  check(links.some((h) => /[?&]qualite=haute/.test(h)) && links.some((h) => /[?&]lots=0/.test(h)) && links.every((h) => /[?&]bench(=court)?(&|$)/.test(h)),
    `[${label}] liens de relance (Haute, Moyenne, Auto, ?lots=0) : ${links.length}`);
  // Capture du tableau à une taille d'écran d'ordinateur portable (boucle suspendue : rien n'est redessiné).
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.screenshot({ path: join(out, `bench-${label}.png`), scale: 'css' });
  // Repli de copie (presse-papiers indisponible en test) : le texte est sélectionné, sans erreur.
  await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }); });
  await page.evaluate(() => document.getElementById('bench-copy').click());
  const txt = await page.$eval('#bench-text', (t) => t.value);
  check(txt.includes('Vue aérienne fixe') && txt.includes('"scenes"'), `[${label}] texte copiable (résumé + JSON, ${txt.length} caractères)`);
  check(foreign.length === 0, `[${label}] aucune requête hors du serveur local${foreign.length ? ' : ' + foreign.slice(0, 3).join(', ') : ''}`);
  check(errors.length === 0, `[${label}] aucune erreur de page${errors.length ? ' :\n   ' + errors.join('\n   ') : ''}`);
  await page.close();
}

try {
  await run('index', '/index.html?bench=court');
  await runArtifact('/__artifact_wrapped.html?bench=court&qualite=moyenne');
} catch (e) {
  console.error('ÉCHEC', e);
  failed = true;
} finally {
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
