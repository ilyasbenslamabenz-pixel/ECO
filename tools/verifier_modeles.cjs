// Vérifie dans Babylon.js (Chromium headless + SwiftShader) que tous les GLB de la bibliothèque se chargent
// sans erreur, aux dimensions du manifeste, avec l'avant vers +Z, et produit deux captures (jour / nuit).
//
// Usage (depuis eco-nation/) : node tools/verifier_modeles.cjs [dossier_captures]
// Lance son propre serveur Vite (port 5199) sur client/modeles.html.
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

function chargerPlaywright() {
  for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(p); } catch { /* suivant */ }
  }
  throw new Error('playwright introuvable');
}

const RACINE = path.resolve(__dirname, '..');
const PORT = 5199;
const SORTIE = process.argv[2] || path.join(require('node:os').tmpdir(), 'eco-modeles');

async function attendreServeur(url, ms) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    try { const r = await fetch(url); if (r.ok) return; } catch { /* pas encore */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('serveur Vite indisponible');
}

(async () => {
  fs.mkdirSync(SORTIE, { recursive: true });
  const vite = spawn(process.execPath, [path.join(RACINE, 'node_modules/vite/bin/vite.js'), '--config', 'client/vite.config.ts',
    '--port', String(PORT), '--strictPort'], { cwd: RACINE, stdio: 'ignore' });
  let code = 1;
  try {
    await attendreServeur(`http://localhost:${PORT}/modeles.html`, 60000);
    const { chromium } = chargerPlaywright();
    const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    const erreursConsole = [];
    page.on('console', (m) => { if (m.type() === 'error') erreursConsole.push(m.text().slice(0, 300)); });
    page.on('pageerror', (e) => erreursConsole.push(e.message));
    await page.goto(`http://localhost:${PORT}/modeles.html`, { timeout: 90000 });
    await page.waitForFunction(() => window.__modeles && window.__modeles.pret, null, { timeout: 180000 });
    const r = await page.evaluate(() => window.__modeles);
    const problemes = [];
    for (const [id, e] of Object.entries(r.erreurs)) problemes.push(`${id} : ${e}`);
    for (const [id, m] of Object.entries(r.mesures)) {
      const ecarts = m.mesure.map((v, k) => Math.abs(v - m.attendu[k]));
      const ok = ecarts.every((d, k) => d <= Math.max(0.05, m.attendu[k] * 0.03));
      const avant = m.zPhares === null || m.zFeux === null || m.zPhares > m.zFeux;
      const oriente = m.accordNormales >= 0.85; // tolérance : faces fines des modèles Poly Haven décimés
      console.log(`${ok && avant && oriente ? 'OK ' : 'KO '} ${id.padEnd(22)} ${m.mesure.map((v) => v.toFixed(2)).join(' × ')} m `
        + `(manifeste ${m.attendu.join(' × ')}), ${m.triangles} tris, faces bien orientées ${(m.accordNormales * 100).toFixed(0)} %`
        + (m.zPhares !== null && m.zFeux !== null ? `, phares z=${m.zPhares.toFixed(2)} > feux z=${m.zFeux.toFixed(2)}` : ''));
      if (!ok) problemes.push(`${id} : dimensions ${m.mesure} ≠ ${m.attendu}`);
      if (!avant) problemes.push(`${id} : l'avant n'est pas vers +Z`);
      if (!oriente) problemes.push(`${id} : faces mal orientées (${(m.accordNormales * 100).toFixed(0)} %)`);
    }
    if (r.total === 0) problemes.push('aucun modèle chargé');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(SORTIE, 'babylon_jour.png') });
    await page.evaluate(() => window.__nuit(1));
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(SORTIE, 'babylon_nuit.png') });
    for (const [id, k, nuit] of [['police', 4, 0], ['bus_articule', 1.2, 1], ['porte_conteneurs', 0.9, 0], ['eolienne', 1.1, 0],
      ['bateau_mouche', 1.0, 1], ['arbre_platane', 2.5, 0]]) {
      await page.evaluate(([id, k, nuit]) => { window.__nuit(nuit); window.__focus(id, k); }, [id, k, nuit]);
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(SORTIE, `babylon_${id}${nuit ? '_nuit' : ''}.png`) });
    }
    await page.evaluate(() => window.__nuit(0));
    await browser.close();
    const filtres = erreursConsole.filter((t) => !/favicon/i.test(t));
    for (const t of filtres) problemes.push('console : ' + t);
    console.log(`\n${r.total} modèles chargés ; captures dans ${SORTIE}`);
    if (problemes.length) { console.log('PROBLÈMES :\n- ' + problemes.join('\n- ')); } else { console.log('Tout est conforme.'); code = 0; }
  } catch (e) {
    console.error(e);
  } finally {
    vite.kill();
  }
  process.exit(code);
})();
