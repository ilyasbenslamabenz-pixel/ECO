/**
 * Mise en page iPhone : aucun élément d'interface visible ne doit dépasser l'écran (zones sûres incluses),
 * en partie normale et en démo, sur plusieurs tailles d'iPhone (portrait + paysage).
 * Usage : node tests/e2e/iphone-layout.mjs   (après npm run build)
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { serve, launch, collectErrors, root } from './lib.mjs';

const out = join(root, 'tests/e2e/out/iphone-layout');
mkdirSync(out, { recursive: true });
const VIEWS = [
  { name: 'se-portrait', w: 375, h: 667 },
  { name: '13-portrait', w: 390, h: 844 },
  { name: 'promax-portrait', w: 430, h: 932 },
  { name: '13-paysage', w: 844, h: 390 },
  // Artifact ouvert dans l'app Claude sur iPhone : la page est affichée sous la barre de l'app (~390×780).
  { name: 'cadre-claude', w: 390, h: 780 },
];
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const MODES = [
  { name: 'partie', q: 'autostart&seed=42' },
  { name: 'demo', q: 'demo' },
  // Fragment artifact.html enveloppé comme le fait l'hébergeur (claude.ai).
  { name: 'artifact', q: 'autostart&seed=42', page: '__artifact_wrapped.html', only: ['cadre-claude', 'se-portrait'] },
];

const { server, base } = await serve();
const browser = await launch();
let failures = 0;
try {
  for (const mode of MODES) {
    for (const v of VIEWS) {
      if (ONLY && !ONLY.includes(`${mode.name}-${v.name}`)) continue;
      if (mode.only && !mode.only.includes(v.name)) continue;
      const ctx = await browser.newContext({ viewport: { width: v.w, height: v.h }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
      const page = await ctx.newPage();
      const errors = collectErrors(page);
      await page.goto(`${base}/${mode.page ?? 'index.html'}?${mode.q}`, { timeout: 300000, waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => {
        const a = window.__aube;
        return a && (a.demoReady || (a.snapshotReceived && !location.search.includes("demo")));
      }, null, { timeout: 300000 });
      await page.waitForTimeout(2500);
      // Outil route ouvert au doigt : tiroir, options et étiquette « placer le départ » doivent tenir dans l'écran.
      if (mode.page) { await page.tap('#toolbar button[data-tool=road]').catch(() => undefined); await page.waitForTimeout(600); }
      const bad = await page.evaluate(() => {
        const W = window.innerWidth, H = window.innerHeight, res = [];
        // Document plus large que l'écran : dans le cadre de l'app Claude (iframe iOS), l'iframe s'élargit et la
        // barre supérieure paraît coupée à droite.
        if (document.documentElement.scrollWidth > W + 0.5) res.push(`document ${document.documentElement.scrollWidth} px de large, écran ${W}`);
        const roots = document.querySelectorAll('#hud, #toolbar, .panel:not(.hidden), #build-drawer:not(.hidden), #tool-options:not(.hidden), #minimap, #cursor-tag:not(.hidden)');
        for (const r of roots) {
          for (const el of [r, ...r.querySelectorAll('*')]) {
            const cs = getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden') continue;
            const b = el.getBoundingClientRect();
            if (b.width === 0 || b.height === 0) continue;
            // Élément dans un conteneur à défilement explicite : toléré s'il reste dans ce conteneur.
            let sc = el.parentElement, clipped = false;
            while (sc && sc !== r.parentElement) {
              const s = getComputedStyle(sc);
              if (/(auto|scroll|hidden)/.test(s.overflowX + s.overflowY)) {
                const sb = sc.getBoundingClientRect();
                if (b.right <= sb.right + 1 && b.left >= sb.left - 1) { clipped = true; break; }
                clipped = true; break;
              }
              sc = sc.parentElement;
            }
            if (clipped && el !== r) continue;
            if (b.left < -0.5 || b.top < -0.5 || b.right > W + 0.5 || b.bottom > H + 0.5) {
              res.push(`${el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + [...el.classList].join('.')} [${b.left.toFixed(0)},${b.top.toFixed(0)} → ${b.right.toFixed(0)},${b.bottom.toFixed(0)}] écran ${W}×${H}`);
            }
          }
        }
        // Boutons tactiles visibles : au moins 40 px dans les deux dimensions.
        for (const b of document.querySelectorAll('#hud button, #toolbar button, #minimap button, #bottom button')) {
          const cs = getComputedStyle(b);
          if (!b.offsetParent || cs.visibility === 'hidden') continue;
          const r = b.getBoundingClientRect();
          if (Math.min(r.width, r.height) < 39.5) res.push(`bouton trop petit ${b.id || b.dataset.tool || b.dataset.cat || b.dataset.speed || b.className} ${r.width.toFixed(0)}×${r.height.toFixed(0)}`);
        }
        // Chiffres entiers : aucune valeur de la barre supérieure tronquée.
        for (const e of document.querySelectorAll('#hud b, #hud .delta, #hud-day, #hud-clock')) {
          if (!e.offsetParent || !e.textContent) continue;
          if (e.scrollWidth > e.clientWidth + 1 || e.textContent.includes('…')) res.push(`valeur tronquée ${e.id || e.className} « ${e.textContent} » (${e.scrollWidth} > ${e.clientWidth})`);
        }
        return res.slice(0, 15);
      });
      await page.evaluate(() => window.__aube.pauseRender?.(true));
      // Capture pour relecture humaine ; en rendu logiciel elle peut être très lente : son échec n'invalide pas la mesure.
      await page.screenshot({ path: join(out, `${mode.name}-${v.name}.png`), timeout: 240000 }).catch((e) => console.log(`  (capture non prise : ${e.message.split('\n')[0]})`));
      const errs = errors.filter((e) => !/favicon/.test(e));
      const ok = bad.length === 0 && errs.length === 0;
      if (!ok) failures++;
      console.log(`${ok ? 'OK' : 'ÉCHEC'} ${mode.name} ${v.name}${bad.length ? '\n  débordements : ' + bad.join('\n  ') : ''}${errs.length ? '\n  erreurs : ' + errs.slice(0, 5).join('\n  ') : ''}`);
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}
if (failures) { console.log(`${failures} configuration(s) en échec`); process.exit(1); }
console.log('Mise en page iPhone : OK');
