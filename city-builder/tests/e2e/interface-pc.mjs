/**
 * Interface sur PC (vague 5, docs/INTERFACE.md) — fenêtre 1280×800, densité 1,5 (PC Windows / Edge du joueur) :
 *   1. CORRECTIF de l'étiquette du curseur : outil Bâtiments, choix d'un bâtiment, curseur juste au-dessus de la barre
 *      d'options (#tool-options) à plusieurs positions : l'étiquette ne chevauche ni #tool-options ni #toolbar ;
 *      « Terminer » est visible (au premier plan à son centre) et cliquable (retour à l'outil Sélection) ;
 *   2. menu Cartes : une seule carte active, légende et « quoi faire », grille drapée reçue ;
 *   3. fiche « Pourquoi » d'un bâtiment ; 4. graphiques d'évolution (3 mois, 1 an, toute la partie) ;
 *   5. journal des notifications regroupé et hiérarchisé, badge limité aux importantes, « Tout marquer comme lu ».
 * Ville : vraie simulation de 14 mois (tests/e2e/ui-history-fixture.ts). Captures : tests/e2e/out/interface-pc-*.png
 * (copiées dans le dossier passé en argument, s'il y en a un).
 * Usage : node tests/e2e/interface-pc.mjs [dossier-captures] (après npm run build).
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectErrors, launch, root, serve } from './lib.mjs';

const out = join(root, 'tests/e2e/out');
mkdirSync(out, { recursive: true });
const extra = process.argv[2] ?? null;
if (extra) mkdirSync(extra, { recursive: true });
const fixture = join(out, 'ville-interface.json');
console.log(execFileSync(process.execPath, [join(root, 'node_modules/tsx/dist/cli.mjs'), join(root, 'tests/e2e/ui-history-fixture.ts'), fixture, '14'], { encoding: 'utf8' }).trim());
const save = JSON.parse(readFileSync(fixture, 'utf8'));

const { server, base } = await serve();
const browser = await launch();
let failed = false;
const check = (ok, msg) => { console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${msg}`); if (!ok) failed = true; };
const overlap = (a, b) => !!a && !!b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.5 });
  const page = await ctx.newPage();
  // Rendu logiciel (SwiftShader) sur une machine partagée : délais larges.
  page.setDefaultTimeout(240000);
  const errors = collectErrors(page);
  const render = (n = 2, dt = 1 / 30) => page.evaluate(([k, d]) => window.__aube.renderNow(k, d), [n, dt]);
  const shot = async (name) => {
    await render(1);
    const f = join(out, `interface-pc-${name}.png`);
    await page.screenshot({ path: f, timeout: 600000 });
    if (extra) copyFileSync(f, join(extra, `pc-${name}.png`));
  };
  const rect = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e || e.classList.contains('hidden')) return null; const r = e.getBoundingClientRect(); return r.width ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom } : null; }, sel);

  await page.goto(`${base}/index.html?autostart&seed=42&norender`, { timeout: 300000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__aube?.ready && window.__aube.snapshotReceived && window.__aube.lastStats, null, { timeout: 300000, polling: 500 });
  await page.evaluate(async (data) => { await window.__aube.send('load', { data }); }, save);
  await page.waitForFunction(() => window.__aube.lastStats?.population > 0, null, { timeout: 60000, polling: 200 });
  await page.evaluate(() => window.__aube.send('setSpeed', { speed: 0 }));
  await page.evaluate(() => window.__aube.lookAt(0, 0, 420, 0.8, 0.5));
  await render(6, 0.5);

  /* ---------- 1. Étiquette du curseur et barre d'options ---------- */
  await page.click('#toolbar button[data-tool=building]');
  await page.waitForTimeout(1500);
  const card = page.locator('#drawer-body .card[data-asset]').first();
  await card.click();
  await page.waitForTimeout(800);
  const opts = await rect('#tool-options');
  check(!!opts, `barre d'options affichée après le choix d'un bâtiment (${opts ? `${Math.round(opts.left)}–${Math.round(opts.right)} × ${Math.round(opts.top)}–${Math.round(opts.bottom)}` : 'absente'})`);
  if (opts) {
    const xs = [opts.left + 20, (opts.left + opts.right) / 2, opts.right - 30, Math.max(10, opts.left - 120)];
    let worst = null;
    for (const x of xs) {
      for (const dy of [3, 12, 30]) {
        const y = opts.top - dy;
        await page.mouse.move(x, y, { steps: 2 });
        await page.waitForTimeout(250);
        const tag = await rect('#cursor-tag');
        const tb = await rect('#toolbar');
        const o = await rect('#tool-options');
        const bad = overlap(tag, o) || overlap(tag, tb);
        if (bad && !worst) worst = { x: Math.round(x), y: Math.round(y), tag, o };
        if (bad) check(false, `étiquette du curseur sur la barre (curseur ${Math.round(x)}, ${Math.round(y)} : étiquette ${JSON.stringify(tag)})`);
      }
    }
    check(!worst, 'l’étiquette ne chevauche jamais #tool-options ni #toolbar (12 positions juste au-dessus de la barre)');
    // Curseur juste au-dessus de la barre, au droit de « Terminer » : le bouton reste visible et au premier plan.
    const fin = await page.evaluate(() => { const b = [...document.querySelectorAll('#tool-actions button')].find((x) => x.textContent?.trim() === 'Terminer'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, top: r.top }; });
    check(!!fin, 'bouton « Terminer » présent dans la barre d’options');
    if (fin) {
      await page.mouse.move(fin.x, fin.top - 4, { steps: 2 });
      await page.waitForTimeout(250);
      await shot('curseur-barre');
      const tag = await rect('#cursor-tag');
      check(!!tag, `étiquette du curseur affichée au droit de « Terminer » (${tag ? `${Math.round(tag.top)}–${Math.round(tag.bottom)} px` : 'masquée'})`);
      const finRect = { left: fin.x - fin.w / 2, right: fin.x + fin.w / 2, top: fin.y - fin.h / 2, bottom: fin.y + fin.h / 2 };
      check(!overlap(tag, finRect), `étiquette au-dessus de « Terminer » sans le recouvrir (étiquette bas ${tag ? Math.round(tag.bottom) : '—'} px, bouton haut ${Math.round(finRect.top)} px)`);
      const front = await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e?.closest('button')?.textContent?.trim() ?? e?.id ?? e?.tagName; }, [fin.x, fin.y]);
      check(front === 'Terminer', `« Terminer » au premier plan à son centre (${front})`);
      await page.mouse.click(fin.x, fin.y);
      await page.waitForTimeout(500);
      const after = await page.evaluate(() => ({ tool: document.querySelector('#toolbar button[data-tool=select]')?.classList.contains('active'), opts: document.querySelector('#tool-options')?.classList.contains('hidden') }));
      check(after.tool === true, `clic sur « Terminer » : retour à l'outil Sélection (${JSON.stringify(after)})`);
    }
  }

  /* ---------- 2. Menu Cartes ---------- */
  await page.click('#btn-layers');
  await page.waitForTimeout(300);
  const items = await page.evaluate(() => [...document.querySelectorAll('#layers-pop [data-layer]')].map((b) => b.getAttribute('data-layer')));
  const wanted = ['crime', 'fire', 'health', 'transit', 'power', 'water', 'landValue', 'airPollution', 'noise', 'unemployment', 'education', 'happiness', 'schools', 'wasteBins', 'traffic'];
  check(wanted.every((w) => items.includes(w)), `menu Cartes : ${items.length} entrées (${wanted.filter((w) => !items.includes(w)).join(', ') || 'toutes les cartes attendues'})`);
  for (const id of ['happiness', 'landValue']) {
    await page.click(`#layers-pop [data-layer=${id}]`);
    await page.waitForFunction(() => window.__cartes?.visible() && window.__cartes.cells() > 0, null, { timeout: 20000, polling: 200 }).catch(() => undefined);
    const st = await page.evaluate(() => ({ kind: window.__cartes?.kind(), cells: window.__cartes?.cells(), on: [...document.querySelectorAll('#layers-pop .layer-item.on:not([data-layer=alerts])')].map((b) => b.getAttribute('data-layer')), legend: document.querySelector('#layers-pop .map-legend')?.textContent ?? '' }));
    check(st.cells > 0 && st.on.length === 1 && st.on[0] === id && /Quoi faire/.test(st.legend), `carte « ${id} » : ${st.cells} cellules, une seule active (${st.on.join(',')}), légende « ${st.legend.slice(0, 80)}… »`);
    await page.evaluate(() => window.__aube.lookAt(0, 0, 420, 0.8, 0.5));
    await render(3, 0.2);
    await shot(`carte-${id}`);
  }
  // Une autre famille de carte éteint la précédente.
  await page.click('#layers-pop [data-layer=crime]');
  await page.waitForTimeout(500);
  const sw = await page.evaluate(() => ({ cartes: window.__cartes?.visible(), services: window.__services?.visible(), kind: window.__services?.kind() }));
  check(sw.cartes === false && sw.kind === 'crime', `passage à Criminalité : la carte précédente est éteinte (${JSON.stringify(sw)})`);
  await page.click('#layers-pop [data-layer=none]');
  await page.click('#btn-layers');

  /* ---------- 3. Fiche « Pourquoi » ---------- */
  const pick = await page.evaluate(async () => {
    const s = window.__aube;
    // Bâtiments du miroir : premier logement habité dont la fiche donne au moins une raison, sinon un logement habité.
    const save = await s.send('save', { slot: 'e2e-pourquoi' });
    const blds = (save?.data?.buildings ?? save?.buildings ?? []).map((b) => b.id);
    let first = null;
    for (const id of blds) {
      const o = await s.send('inspectBuilding', { buildingId: id }).catch(() => null);
      if (!o) continue;
      const neg = (o.diagnosis?.factors ?? []).filter((f) => f.delta <= -0.5).length;
      if (o.residents > 0 && neg > 0) return { id, neg };
      if (!first && (o.residents > 0 || o.jobCapacity > 0)) first = { id, neg };
    }
    return first;
  });
  check(!!pick, `bâtiment à expliquer trouvé (${JSON.stringify(pick)})`);
  if (pick) {
    await page.evaluate((id) => window.__aube.selectBuilding(id), pick.id);
    await page.waitForFunction(() => document.querySelector('#info-why')?.childElementCount > 0, null, { timeout: 15000, polling: 200 }).catch(() => undefined);
    const why = await page.evaluate(() => ({ text: document.querySelector('#info-why')?.textContent ?? '', items: document.querySelectorAll('#info-why li').length, acts: document.querySelectorAll('#info-why .why-act').length }));
    check(why.items === 0 || why.acts === why.items, `fiche « Pourquoi » : ${why.items} raison(s), une action chacune (« ${why.text.slice(0, 120)} »)`);
    check(why.text.length > 0, 'fiche « Pourquoi » affichée');
    await shot('fiche-pourquoi');
    await page.click('#info-close').catch(() => undefined);
  }

  /* ---------- 4. Graphiques d'évolution ---------- */
  await page.click('#btn-stats');
  await page.waitForTimeout(800);
  for (const [tab, range] of [['pop', '1a'], ['money', 'tout'], ['jobs', '3m'], ['happy', '1a']]) {
    await page.click(`#dash-tabs [data-dtab=${tab}]`);
    await page.waitForTimeout(400);
    await page.click(`#dash-body .hist-ranges [data-range="${range}"]`);
    await page.waitForTimeout(600);
    const std = await page.evaluate(() => {
      const c = document.querySelector('#stats-chart'); if (!c || !c.width) return 0;
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0, m = 0, q = 0;
      for (let i = 0; i < d.length; i += 16) { const l = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11 + d[i + 3] * 0.2; n++; m += l; q += l * l; }
      m /= n; return Math.sqrt(Math.max(0, q / n - m * m));
    });
    const note = await page.evaluate(() => document.querySelector('#dash-body p.muted')?.textContent ?? '');
    check(std > 8, `graphique « ${tab} » sur ${range} dessiné (${note})`);
    if (tab === 'money' || tab === 'jobs') await shot(`graphique-${tab}-${range}`);
  }
  await page.click('#dash-close');

  /* ---------- 5. Notifications ---------- */
  await page.evaluate(() => {
    const t = window.__aube.toast;
    for (let i = 0; i < 12; i++) t(`Maison ${i + 1} construit (−40 000 ¢)`, 'ok');
    for (let i = 0; i < 4; i++) t(`Réseau principal : ${10 + i} bâtiments coupés (logements). Construisez une centrale.`, 'error');
    t('Panne : Éolienne n° 3 hors service (réparation ≈ 4 h)', 'error');
    for (let i = 0; i < 3; i++) t('Partie sauvegardée (« auto »)', 'ok');
  });
  await page.waitForTimeout(400);
  const badge = await page.evaluate(() => ({ n: document.querySelector('#notif-badge')?.textContent, hidden: document.querySelector('#notif-badge')?.classList.contains('hidden') }));
  check(!badge.hidden && Number(badge.n) >= 2 && Number(badge.n) <= 6, `badge limité aux importantes (${badge.n}) malgré 20 messages`);
  await page.click('#btn-notif');
  await page.waitForTimeout(500);
  const log = await page.evaluate(() => ({ items: [...document.querySelectorAll('.notif-list li')].map((l) => ({ sev: l.dataset.sev, text: l.querySelector('.ntext')?.textContent ?? '' })), sections: [...document.querySelectorAll('[data-sev-list]')].map((u) => u.getAttribute('data-sev-list')) }));
  check(log.items.some((i) => /12 constructions/.test(i.text)), `constructions regroupées (« ${log.items.find((i) => /constructions/.test(i.text))?.text ?? '—'} »)`);
  check(log.items.some((i) => i.sev === 'urgent' && /Coupures d’électricité : 4 alertes/.test(i.text)), 'coupures regroupées et urgentes');
  check(log.sections[0] === 'urgent' && log.sections.indexOf('info') === log.sections.length - 1, `classement par gravité (${log.sections.join(' > ')})`);
  await shot('notifications');
  await page.click('#dash-body [data-act=read-all]');
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => document.querySelector('#notif-badge')?.classList.contains('hidden'));
  check(after === true, '« Tout marquer comme lu » vide le badge');
  check(errors.length === 0, `aucune erreur de page ${errors.slice(0, 3).join(' | ')}`);
  await ctx.close();
} catch (e) {
  console.error(e);
  check(false, `exception : ${e instanceof Error ? e.message : String(e)}`);
} finally {
  await browser.close();
  server.close();
}
console.log(failed ? '\nINTERFACE PC : ÉCHEC' : '\nINTERFACE PC : SUCCÈS');
process.exit(failed ? 1 : 0);
